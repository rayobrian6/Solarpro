// app/api/admin/engineering-review/route.ts
// AAC WS-8 / WS-9 — the DIGEST-BOUND ENGINEERING-REVIEW surface (migration 116).
//
// GET  ?project_id=&digest=   — the review history for a project + the coverage
//                               verdict for a specific snapshot digest
// POST { op: 'record' }       — a licensed reviewer records a decision bound to
//                               an exact snapshot digest
//
// THIS ROUTE IS WHAT MAKES ENGINEERING-REVIEW-PENDING CLEARABLE (audit §2.19:
// "an unclearable requirement is not honesty, it is a missing feature"). It is
// also the ONLY writer: the permit engine reads coverage and never records an
// approval.
//
// FOUR REFUSALS, enforced here and again in the store:
//   1. no digest, or a digest that is not the 64-char SHA-256 the snapshot
//      emits → 400. An approval that names no snapshot covers nothing.
//   2. a reviewerRole that is not engineer_of_record / approving_engineer → 400.
//   3. an approval with no scope statement → 400 ("approved" is never a bare
//      boolean).
//   4. a licence number / state that is absent, or expired at approval → 400.
//
// The reviewer IDENTITY is taken from the authenticated admin session, never
// from the request body — the body supplies only the licence facts being
// attested to, and `reviewerUserId` is stamped server-side.
//
// Mirrors app/api/admin/personnel/route.ts: requireAdminApi, rate limit,
// handleRouteDbError (fail-LOUD, so an admin sees 42P01 until 116 is run), and
// logAdminAction on every write.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
// A.1.1 §1 — the governed licensed-professional record is the ONLY source of a
// reviewer's professional identity.
import { resolveLicensedProfessionalForUser } from '@/lib/personnel/store';
import { isPersonnelRole } from '@/lib/personnel/types';
import {
  listEngineeringReviews, recordEngineeringReview, resolveEngineeringReviewCoverage,
} from '@/lib/engineeringReview/store';
import {
  LICENSED_REVIEW_ROLES, REVIEW_DECISIONS, validateEngineeringReviewInput,
  type EngineeringReviewInput,
} from '@/lib/engineeringReview/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  const digest = searchParams.get('digest');
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'project_id is required' }, { status: 400 });
  }
  try {
    const [records, coverage] = await Promise.all([
      listEngineeringReviews(projectId),
      resolveEngineeringReviewCoverage(projectId, digest),
    ]);
    return NextResponse.json({
      success: true, records, coverage,
      licensedRoles: LICENSED_REVIEW_ROLES, decisions: REVIEW_DECISIONS,
    });
  } catch (err) {
    // Fail-LOUD: an admin must see "relation engineering_review_records does not
    // exist" so migration 116 gets run — never a silent "no approval".
    return handleRouteDbError('[admin/engineering-review GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  // ── A.1.1 §1 — PROFESSIONAL IDENTITY IS DERIVED, NEVER ACCEPTED ───────────
  // This block previously stamped only `reviewerUserId` from the session and
  // read reviewerName / reviewerLicense / reviewerLicenseState straight off the
  // request body — beneath a comment asserting the identity was server-stamped.
  // Any admin could therefore record an approval under another professional's
  // name and licence number, which destroys exactly the attestation the record
  // exists to carry.
  //
  // The reviewer's professional identity now comes from an ACTIVE personnel row
  // in the requested LICENSED role, tied to the AUTHENTICATED actor. No such row
  // ⇒ refuse. It is never back-filled from the request, and a client-supplied
  // name/licence is not merged in as a fallback: a licence number the server
  // cannot vouch for is not evidence.
  const _requestedRole = String(body.reviewerRole ?? '');
  if (!isPersonnelRole(_requestedRole)) {
    return NextResponse.json(
      { success: false, error: `reviewerRole '${_requestedRole}' is not a recognised personnel role` },
      { status: 400 });
  }
  const _licensed = await resolveLicensedProfessionalForUser(admin.id, _requestedRole);
  if (!_licensed) {
    return NextResponse.json({
      success: false,
      error: 'No governed licensed-professional record is on file for the authenticated user in role '
        + `'${_requestedRole}'. A professional approval may only be recorded by the licensed professional `
        + 'themselves, from their own governed personnel record — reviewer identity is never accepted from '
        + 'the request. Add or activate the personnel record first (Admin → Personnel).',
    }, { status: 403 });
  }

  const input: EngineeringReviewInput = {
    projectId: String(body.projectId ?? ''),
    snapshotDigest: String(body.snapshotDigest ?? '').trim().toLowerCase(),
    snapshotId: (body.snapshotId as string | undefined) ?? null,
    plansetEngineVersion: (body.plansetEngineVersion as string | undefined) ?? null,
    reviewerRole: _requestedRole,
    // Every identity field below is SERVER-DERIVED from the governed record.
    reviewerUserId: admin.id,
    reviewerName: _licensed.personName,
    reviewerLicense: _licensed.licenseNumber ?? '',
    reviewerLicenseState: _licensed.licenseState ?? '',
    reviewerLicenseExpiresOn: _licensed.licenseExpiresOn ?? null,
    decision: String(body.decision ?? ''),
    scopeStatement: (body.scopeStatement as string | undefined) ?? null,
    notes: (body.notes as string | undefined) ?? null,
    evidenceRef: (body.evidenceRef as string | undefined) ?? null,
    createdBy: admin.id,
  };

  const v = validateEngineeringReviewInput(input);
  if (v.ok !== true) return NextResponse.json({ success: false, error: v.error }, { status: 400 });

  try {
    const record = await recordEngineeringReview(input);
    await logAdminAction({
      adminId: admin.id, action: 'engineering_review_recorded',
      metadata: {
        projectId: input.projectId, decision: input.decision,
        snapshotDigest: input.snapshotDigest.slice(0, 16), recordId: record.id,
        reviewerRole: input.reviewerRole,
      },
    });
    return NextResponse.json({ success: true, record });
  } catch (err: unknown) {
    if (err instanceof Error && /required|must be|licence|license|expired|digest/i.test(err.message)) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    return handleRouteDbError('[admin/engineering-review POST]', err);
  }
}
