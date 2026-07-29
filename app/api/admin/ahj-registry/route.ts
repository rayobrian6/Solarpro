// app/api/admin/ahj-registry/route.ts
// TAC WS-19 — the CENTRAL AHJ / ADOPTED-CODE REGISTRY surface (migration 117).
//
// GET  ?state=&county=&city=&id=  — registry rows for a jurisdiction (or one row)
// POST { op: 'verify' }           — a governed OPERATOR VERIFICATION of adopted
//                                   code editions, with the ordinance/official
//                                   source. This is precedence slot 5 (genuine-
//                                   conflict / research confirmation); the
//                                   resolver's write-back handles slot 3.
//
// REFUSALS, enforced here (the store's provenance ladder additionally refuses
// any downgrade of an existing evidence-carrying row):
//   1. no adopted edition at all → 400. A verification that names no edition
//      verifies nothing.
//   2. no source URL / citation → 400. Operator entry without a source is an
//      observation, never authority (the campaign's standing rule).
//   3. no jurisdiction identity (state + county/city + name) → 400.
//
// The verifier IDENTITY is taken from the authenticated admin session, never
// from the request body. sha256 is computed server-side over the canonical
// verification payload so the code-authority gate's hash requirement is met by
// real bytes, not a typed-in value.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { findAhjRegistryRow, findById, upsertAhjRegistryRow } from '@/lib/jurisdictions/internalAhjRegistry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const state = searchParams.get('state');
  try {
    if (id) {
      const row = await findById(id);
      return NextResponse.json({ success: true, rows: row ? [row] : [] });
    }
    if (!state) {
      return NextResponse.json({ success: false, error: 'state (or id) is required' }, { status: 400 });
    }
    const { allMatches, match, matchMethod } = await findAhjRegistryRow({
      stateCode: state, county: searchParams.get('county'), city: searchParams.get('city'),
    });
    return NextResponse.json({ success: true, rows: allMatches, match, matchMethod });
  } catch (err) {
    // Fail-LOUD: an admin must see "relation ahj_registry does not exist" so
    // migration 117 gets run — never a silent empty registry.
    return handleRouteDbError('[admin/ahj-registry GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limited' }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.op !== 'verify') {
    return NextResponse.json({ success: false, error: "op must be 'verify'" }, { status: 400 });
  }
  const s = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
  const stateCode = s(body.stateCode);
  const county = s(body.county);
  const city = s(body.city);
  const ahjName = s(body.ahjName);
  const sourceUrl = s(body.sourceUrl);
  const editions = {
    nec: s((body.editions as Record<string, unknown> | undefined)?.nec),
    ibc: s((body.editions as Record<string, unknown> | undefined)?.ibc),
    irc: s((body.editions as Record<string, unknown> | undefined)?.irc),
    ifc: s((body.editions as Record<string, unknown> | undefined)?.ifc),
  };
  if (!stateCode || (!county && !city) || !ahjName) {
    return NextResponse.json({ success: false, error: 'stateCode, ahjName and county or city are required' }, { status: 400 });
  }
  if (!editions.nec && !editions.ibc && !editions.irc && !editions.ifc) {
    return NextResponse.json({ success: false, error: 'at least one adopted edition is required — a verification that names no edition verifies nothing' }, { status: 400 });
  }
  if (!sourceUrl) {
    return NextResponse.json({ success: false, error: 'sourceUrl (ordinance / official adoption source) is required — operator entry without a source is observation, never authority' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const verifiedBy = `operator-verification:${admin.id}`;
  const slug = (x: string | null): string =>
    (x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const id = s(body.id) ?? `${stateCode.toLowerCase()}-${slug(county) || 'x'}-${slug(city) || slug(ahjName) || 'ahj'}`;
  // canonical payload hash — the evidence hash the code-authority gate demands,
  // computed over the exact facts being attested.
  const canonical = JSON.stringify({
    id, stateCode: stateCode.toUpperCase(), county, city, ahjName,
    editions, sourceUrl, effectiveDate: s(body.effectiveDate),
    localAmendments: Array.isArray(body.localAmendments) ? body.localAmendments : [],
    verifiedBy, verifiedAtIso: nowIso,
  });
  const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');

  try {
    const row = await upsertAhjRegistryRow({
      id, stateCode, county, city, ahjName,
      jurisdictionType: s(body.jurisdictionType) ?? (city ? 'city' : 'county'),
      editions,
      localAmendments: Array.isArray(body.localAmendments) ? body.localAmendments as string[] : [],
      effectiveDate: s(body.effectiveDate),
      sourceUrl, sourceSha256: sha256,
      provenance: 'operator-verified',
      verifiedBy, verifiedAtIso: nowIso,
      rawPayload: JSON.parse(canonical),
      notes: s(body.notes),
      enrichmentAttempt: { atIso: nowIso, source: 'admin/ahj-registry', outcome: 'OPERATOR-VERIFIED' },
    });
    await logAdminAction({
      adminId: admin.id, action: 'ahj_registry_operator_verified',
      metadata: { id, stateCode, county, city, editions, sourceUrl, sha256: sha256.slice(0, 16) },
    });
    return NextResponse.json({ success: true, row });
  } catch (err) {
    return handleRouteDbError('[admin/ahj-registry POST]', err);
  }
}
