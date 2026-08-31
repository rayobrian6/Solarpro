// ═══════════════════════════════════════════════════════════════════════════
// N6 — RAY'S RULING, PROVEN THROUGH THE PRODUCTION ENTRY POINT.
//
//   "automatically queue governed authority discovery and hold only
//    authority-dependent permit release. Do not block design work. Do not
//    release a permit-ready package with the government merely substituted as
//    the AHJ... Failure to discover must terminate in a typed manual-review
//    state, never fallback substitution."
//
// `ahj-record-missing.test.ts` proves the no-substitution rule at the RESOLVER.
// This proves it survives the whole route: resolveSnapshotAuthorityInputs ->
// buildPermitDesignSnapshot -> generatePermitHTML, on the SNAPSHOT a reviewer
// would actually receive.
//
// ── WHY THIS USES INJECTED PROVIDERS ──────────────────────────────────────
// `providers: {}` makes every resolver report PROVIDER-NOT-INJECTED, which
// lifecycle.ts:184-188 is explicit is "a different fact from 'the provider
// answered with nothing'". A harness with `providers: {}` CANNOT exercise the
// boundary path — I once reported a package "verified end-to-end" off exactly
// that shape. Every case here injects a real fixture provider, and the
// boundary-established / record-missing state is produced by the PROVIDER's
// answer, not by hand-editing the snapshot.
//
// The place name is deliberately impossible so no registry row can satisfy
// these tests now or after the registry grows.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import { generatePermitHTML } from '@/lib/permit';
import { createFixturePropertyProvider, BRAIDON_PROPERTY_FIXTURE } from '@/lib/providers/property/fixtures';
import { braidonOriginalAuditFixture } from '@/tests/fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const NOW = '2026-08-30T12:00:00.000Z';
const ABSENT_PLACE = 'Zzzqx Springs village';
const MAILING_CITY = 'GRANITE CITY';
const COUNTY = 'Madison County';

const offlineRead = (async (_l: string, _r: unknown, failSoftTo: unknown) =>
  ({ value: failSoftTo, ok: false, error: 'offline (test)' })) as never;

/** The parcel resolves cleanly INSIDE an incorporated place we hold no row for.
 *  This is the ordinary national case: ~4,000 rows against ~19,500 places. */
const insideAbsentPlace = {
  ...BRAIDON_PROPERTY_FIXTURE,
  incorporatedPlace: ABSENT_PLACE,
  unincorporated: false,
  placeFips: '1799999',
  boundaryLayersResolved: true,
  boundaryEvidence:
    `Census Geocoder placed the parcel inside the incorporated place "${ABSENT_PLACE}". `
    + 'The municipality governs; SolarPro holds no permitting record for it.',
};

let seq = 0;
async function build(record: typeof BRAIDON_PROPERTY_FIXTURE) {
  const input = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
  input.generatedAtIso = NOW;
  // Distinct per build: two builds in ONE test with the same projectId returned
  // a snapshot with no permitReadiness, so state is keyed on it somewhere.
  input.projectId = `c0ffee00-0000-4000-8000-0000000000${String(++seq).padStart(2, '0')}`;
  const authority = await resolveSnapshotAuthorityInputs(input, {
    safeDbRead: offlineRead,
    nowIso: NOW,
    providers: { propertyIdentity: createFixturePropertyProvider({ nowIso: NOW, record }) },
  } as never);
  const html = generatePermitHTML(input, undefined, authority as never) as unknown as string;
  const snap: PermitDesignSnapshot = input._snapshot;
  return { snap, html, authority };
}

const openCodes = (s: PermitDesignSnapshot) =>
  s.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);

describe('N6 — boundary established, permitting record missing, through the route', () => {
  it('does not substitute the county or the mailing city as the AHJ', async () => {
    const { snap } = await build(insideAbsentPlace);
    const ahj = snap.codeAuthority?.ahjName ?? null;

    // The failure this whole campaign exists to prevent: a resolved boundary
    // whose registry row is missing, quietly answered with the county or the
    // postal city, and then printed as though it were the authority.
    if (ahj) {
      expect(ahj).not.toContain(COUNTY);
      expect(ahj.toUpperCase()).not.toContain(MAILING_CITY);
    }
  }, 300_000);

  it('terminates in the typed manual-review state, naming no substitute', async () => {
    // "Failure to discover must terminate in a typed manual-review state,
    // never fallback substitution." The state is the assertion — an absent
    // ahjName alone could be read as "not looked up yet".
    const { snap } = await build(insideAbsentPlace);
    expect(snap.codeAuthority?.ahjName ?? null).toBeNull();
    expect(snap.codeAuthority?.ahjMatchMethod).toBe('boundary-established-record-missing');
  }, 300_000);

  it('holds permit release with a typed, open requirement', async () => {
    // "hold only authority-dependent permit release" — the hold must be a typed
    // registry state, not an absent field someone might read as satisfied.
    const { snap } = await build(insideAbsentPlace);
    expect(openCodes(snap)).toContain('CODE-AUTHORITY-INCOMPLETE');
    const rec = snap.permitReadiness.registry.find(r => r.code === 'CODE-AUTHORITY-INCOMPLETE');
    expect(rec?.resolved).toBe(false);
  }, 300_000);

  it('the hold is CAUSED by the missing record, not always present', async () => {
    // The strongest form: the same pipeline, same providers, same everything
    // except the boundary answer. If CODE-AUTHORITY-INCOMPLETE were simply
    // always open, the assertion above would be vacuous.
    const missing = await build(insideAbsentPlace);
    const control = await build(BRAIDON_PROPERTY_FIXTURE);
    expect(openCodes(missing.snap)).toContain('CODE-AUTHORITY-INCOMPLETE');
    expect(openCodes(control.snap)).not.toContain('CODE-AUTHORITY-INCOMPLETE');
  }, 300_000);

  it('does NOT block design work — the package still generates', async () => {
    // "Do not block design work." A missing AUTHORITY must not take out the
    // DESIGN deliverable; the two are separate concerns.
    const { html, snap } = await build(insideAbsentPlace);
    expect(html.length).toBeGreaterThan(10_000);
    expect(html).toContain('SHEET 1 OF');
    expect(snap.meta.digest).toMatch(/^[0-9a-f]{24,}$/);
  }, 300_000);

  it('invents no code edition when there is no authority to adopt one', async () => {
    // A missing record must not become a fabricated adoption. Whatever the NEC
    // edition resolves to, it may not claim a retrieval that never happened.
    const { snap } = await build(insideAbsentPlace);
    const nec = snap.codeAuthority?.editions?.nec;
    // With no record the edition fails to UNKNOWN rather than defaulting — the
    // ruling on the 2020 skeleton, holding at the route level.
    expect(nec?.edition ?? null).toBeNull();
    expect(nec?.source).toBe('unknown');
    expect(snap.codeAuthority?.verificationStatus).not.toBe('verified');
  }, 300_000);

  it('the rendered sheet never prints the absent place as an established AHJ', async () => {
    // The artifact is what a plan reviewer reads. If the name leaks onto the
    // sheet as the authority, the snapshot being correct does not save us.
    const { html } = await build(insideAbsentPlace);
    expect(html).not.toMatch(new RegExp(`${ABSENT_PLACE}[^<]{0,40}Building Department`, 'i'));
  }, 300_000);

  it('CONTROL: the unincorporated fixture still binds the county legitimately', async () => {
    // Proves these assertions are not vacuously passing. The Braidon parcel is
    // genuinely unincorporated, so the COUNTY *is* the correct AHJ there — the
    // rule forbids SUBSTITUTION, not county authority where it is real.
    const { snap } = await build(BRAIDON_PROPERTY_FIXTURE);
    expect(snap.codeAuthority?.ahjName).toBe('Madison County Building & Zoning');
    expect(snap.codeAuthority?.ahjMatchMethod).toBe('county-unincorporated');
    // and the state adoption still supplies an edition there, so the contrast
    // above is about the missing RECORD, not about the pipeline being broken.
    expect(snap.codeAuthority?.editions?.nec?.edition).toBe('2020');
    expect(snap.codeAuthority?.editions?.nec?.source).toBe('state-adoption-table');
  }, 300_000);
});
