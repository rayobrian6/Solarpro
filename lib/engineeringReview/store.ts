// lib/engineeringReview/store.ts
// AAC WS-8 / WS-9 — the digest-bound engineering-review store (migration 116).
//
// Mirrors lib/documents/registry.ts and lib/personnel/store.ts exactly: raw
// async DB functions that THROW the Postgres error (so the admin API stays
// fail-loud through handleRouteDbError), with every permit-path read wrapped by
// the resolver's shared `safeDbRead` guard. Migration 116 is written but not
// run, so today every read raises 42P01 and the resolver reports that precisely
// and retryably — nothing swallowed, nothing defaulted, and above all nothing
// APPROVED.
//
// THE ENGINE NEVER WRITES HERE. `recordEngineeringReview` is reachable only from
// the admin API, behind an authenticated licensed reviewer. The resolver in the
// permit path calls `resolveEngineeringReviewCoverage` and nothing else.

import { getDbReady } from '@/lib/db/core';
import { randomUUID } from 'node:crypto';
import {
  isLicensedReviewRole, validateEngineeringReviewInput, uncoveredReview,
  type EngineeringReviewCoverage, type EngineeringReviewInput, type EngineeringReviewRecord,
  type LicensedReviewRole, type ReviewDecision,
} from './types';

// Raw pg rows are `any` here exactly as in lib/documents/registry.ts and
// lib/personnel/store.ts — the row shape is the migration's, and each field is
// narrowed on the way into the typed record below. No eslint suppression: this
// project extends `next/core-web-vitals`, which registers @typescript-eslint as
// a PARSER only, so `no-explicit-any` is not a defined rule and a disable
// directive naming it is an orphan ESLint rejects.
function rowToReview(r: any): EngineeringReviewRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    snapshotDigest: r.snapshot_digest,
    snapshotId: r.snapshot_id ?? null,
    plansetEngineVersion: r.planset_engine_version ?? null,
    reviewerRole: r.reviewer_role as LicensedReviewRole,
    reviewerUserId: r.reviewer_user_id ?? null,
    reviewerName: r.reviewer_name,
    reviewerLicense: r.reviewer_license,
    reviewerLicenseState: r.reviewer_license_state,
    reviewerLicenseExpiresOn: r.reviewer_license_expires_on ? String(r.reviewer_license_expires_on) : null,
    decision: r.decision as ReviewDecision,
    decidedAt: String(r.decided_at),
    scopeStatement: r.scope_statement ?? null,
    notes: r.notes ?? null,
    evidenceRef: r.evidence_ref ?? null,
    supersededAt: r.superseded_at ? String(r.superseded_at) : null,
    supersededBy: r.superseded_by ?? null,
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

/** Record a decision. Append-only: an existing ACTIVE record for the same
 *  project+digest is SUPERSEDED, never mutated. */
export async function recordEngineeringReview(input: EngineeringReviewInput): Promise<EngineeringReviewRecord> {
  const v = validateEngineeringReviewInput(input);
  if (v.ok !== true) throw new Error(v.error);
  const sql = await getDbReady();
  const id = input.id ?? randomUUID();
  const digest = input.snapshotDigest.toLowerCase();

  // Supersede any active record for this project + digest (all decisions, so a
  // withdrawal retires the approval it replaces).
  await sql`
    UPDATE engineering_review_records
    SET superseded_at = now(), superseded_by = ${id}
    WHERE project_id = ${input.projectId}
      AND snapshot_digest = ${digest}
      AND superseded_at IS NULL
  `;

  const [row] = await sql`
    INSERT INTO engineering_review_records (
      id, project_id, snapshot_digest, snapshot_id, planset_engine_version,
      reviewer_role, reviewer_user_id, reviewer_name, reviewer_license,
      reviewer_license_state, reviewer_license_expires_on,
      decision, scope_statement, notes, evidence_ref, created_by
    ) VALUES (
      ${id}, ${input.projectId}, ${digest}, ${input.snapshotId ?? null},
      ${input.plansetEngineVersion ?? null}, ${input.reviewerRole},
      ${input.reviewerUserId ?? null}, ${input.reviewerName}, ${input.reviewerLicense},
      ${input.reviewerLicenseState}, ${input.reviewerLicenseExpiresOn ?? null},
      ${input.decision}, ${input.scopeStatement ?? null}, ${input.notes ?? null},
      ${input.evidenceRef ?? null}, ${input.createdBy ?? null}
    )
    RETURNING *
  `;
  return rowToReview(row);
}

/** Every record for a project, newest first (audit view). */
export async function listEngineeringReviews(projectId: string): Promise<EngineeringReviewRecord[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM engineering_review_records
    WHERE project_id = ${projectId}
    ORDER BY decided_at DESC
  `;
  return (rows as any[]).map(rowToReview);
}

/** The ONE active approval covering an EXACT digest, or null. */
export async function findActiveApproval(
  projectId: string,
  snapshotDigest: string,
): Promise<EngineeringReviewRecord | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM engineering_review_records
    WHERE project_id = ${projectId}
      AND snapshot_digest = ${snapshotDigest.toLowerCase()}
      AND decision = 'approved'
      AND superseded_at IS NULL
    ORDER BY decided_at DESC
    LIMIT 1
  `;
  const r = (rows as any[])[0];
  return r ? rowToReview(r) : null;
}

/**
 * THE resolver-facing read. PURE about its verdict: coverage requires an ACTIVE
 * 'approved' record whose digest matches EXACTLY and whose recorded role is
 * licensed. A store that cannot be read is `storeUnavailable`, never covered.
 *
 * This function does not throw for a business reason; it throws only if the DB
 * itself fails, and the caller wraps it in `safeDbRead`.
 */
export async function resolveEngineeringReviewCoverage(
  projectId: string,
  snapshotDigest: string | null,
): Promise<EngineeringReviewCoverage> {
  if (!snapshotDigest) {
    return uncoveredReview(
      'no snapshot digest is available at resolution time, so no digest-bound approval can be matched — the review '
      + 'coverage question is answered against the FROZEN digest, which does not exist until the build completes',
    );
  }
  const rec = await findActiveApproval(projectId, snapshotDigest);
  if (!rec) {
    return uncoveredReview(
      `no active approved engineering-review record covers snapshot digest ${snapshotDigest.slice(0, 12)}…`,
    );
  }
  if (!isLicensedReviewRole(rec.reviewerRole)) {
    return uncoveredReview(
      `the record covering this digest names role '${rec.reviewerRole}', which is not a licensed review role — refused`,
    );
  }
  return {
    covered: true,
    reviewedDigest: rec.snapshotDigest,
    approvedAtIso: rec.decidedAt,
    reviewerName: rec.reviewerName,
    reviewerRole: rec.reviewerRole,
    reviewerLicense: rec.reviewerLicense,
    reviewerLicenseState: rec.reviewerLicenseState,
    scopeStatement: rec.scopeStatement,
    recordId: rec.id,
    // ── A.1.1 §2 — NO SEAL EVIDENCE EXISTS IN THIS SCHEMA ────────────────────
    // migration 116's engineering_review_records carries the REVIEW: who
    // approved, under what licence, of which digest, with what scope. It carries
    // no sealed instrument, no artifact hash and no seal date, because a seal is
    // a separate authority event recorded at a different moment.
    //
    // Emitting nulls here is the honest answer and is deliberately NOT a
    // placeholder to be filled in later by inference: until a governed seal
    // store exists, `signatureSealSatisfied` is false for every project, and the
    // ISSUED-FOR-PERMIT seal precondition stays unmet. A review still covers the
    // design; the two facts are simply no longer conflated.
    sealRecordId: null,
    sealArtifactSha256: null,
    sealedAtIso: null,
    sealLicenseState: null,
    sealVerified: false,
    storeUnavailable: false,
    storeError: null,
    basis: `${rec.reviewerName} (${rec.reviewerRole}, licence ${rec.reviewerLicense} ${rec.reviewerLicenseState}) approved `
      + `snapshot digest ${rec.snapshotDigest.slice(0, 12)}… on ${rec.decidedAt}`,
  };
}
