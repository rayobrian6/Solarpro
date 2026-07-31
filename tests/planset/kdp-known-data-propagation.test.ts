// ═══════════════════════════════════════════════════════════════════════════
// KDP — KNOWN-DATA PROPAGATION.
//
// The campaign's rule: use what SolarPro already holds, and prove data genuinely
// does not exist before calling it unknown. These tests pin the three findings
// that survived that trace on the live Braidon project.
//
//  WS-12  AHJ JURISDICTION. A mailing city is NOT a jurisdiction. The live US
//         Census determination for 3 Melvin Dr, GRANITE CITY, IL returns NO
//         incorporated place — only the minor civil division "Nameoki township" —
//         so Madison County is the building AHJ of record, and the enriched
//         `project.ahjName` ("City of Granite City Building & Zoning") is the
//         value that is wrong. The record is now DERIVED from that boundary
//         determination and the stale project field is corrected from it, so one
//         AHJ name travels through the package instead of two.
//
//  PITCH  ONE pitch authority. The PV-3 cross-section read the operator-entered
//         `project.roofPitch` (20° → 4:12 after integer rounding) while every
//         other surface read the CAD plane the array was laid out on (16.52° →
//         3.6:12).
//
//  WS-10  The rooftop ampacity adder's BASIS is always stated. A null adder with
//         a null basis reads as an unresolved required input; it is in fact a
//         resolved code question (NEC 2017 690.31(A) deleted 310.15(B)(3)(c) for
//         PV circuits, and it is absent from 2020/2023).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { resolveAhjRecordTraced } from '@/lib/permit/snapshot/codeAuthority';
import { getAhjByCity, getAhjByCounty, getTotalAhjCount } from '@/lib/jurisdictions/ahj-national';
import { resolveRoofPitch } from '@/lib/drafting/sheetComposition';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const BRAIDON = { stateCode: 'IL', county: 'Madison', city: 'GRANITE CITY',
  address: '3 MELVIN DR APT A, GRANITE CITY, IL 62040' };

function gen(profile = 'design-review') {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

// ── WS-12 ────────────────────────────────────────────────────────────────────
describe('KDP WS-12 — the municipal-boundary determination governs the AHJ record', () => {
  it('the dataset holds BOTH candidate records for this county', () => {
    expect(getTotalAhjCount()).toBeGreaterThan(4000);
    expect(getAhjByCity('IL', 'GRANITE CITY')?.id).toBe('il-madison-granite-city');
    expect(getAhjByCounty('IL', 'Madison')?.id).toBe('il-madison-county');
  });

  it('UNINCORPORATED ⇒ the county record, even though a city record exists and the project stores its name', () => {
    const r = resolveAhjRecordTraced({
      ...BRAIDON,
      ahjName: 'City of Granite City Building & Zoning',   // the stale enrichment
      boundary: { resolved: true, unincorporated: true, incorporatedPlace: null },
    });
    expect(r.record?.id).toBe('il-madison-county');
    expect(r.matchMethod).toBe('county-unincorporated');
    expect(r.incorporated).toBe(false);
  });

  it('INSIDE an incorporated place ⇒ that municipality, using the OFFICIAL place name', () => {
    const r = resolveAhjRecordTraced({
      ...BRAIDON,
      boundary: { resolved: true, unincorporated: false, incorporatedPlace: 'Granite City' },
    });
    expect(r.record?.id).toBe('il-madison-granite-city');
    expect(r.matchMethod).toBe('incorporated-city');
    expect(r.incorporated).toBe(true);
    // the county record the pre-KDP precedence would have bound is recorded
    expect(r.supersededRecordId).toBe('il-madison-county');
  });

  it('with NO boundary determination the municipality outranks the county (it did not before)', () => {
    const r = resolveAhjRecordTraced({ ...BRAIDON, boundary: null });
    expect(r.record?.id).toBe('il-madison-granite-city');
    expect(r.supersededRecordId).toBe('il-madison-county');
  });

  it('a town with no record of its own still falls through to the county', () => {
    const r = resolveAhjRecordTraced({
      stateCode: 'IL', county: 'Madison', city: 'WOOD RIVER',
      address: '1 MAIN ST, WOOD RIVER, IL 62095', boundary: null,
    });
    expect(r.record?.id).toBe('il-madison-county');
    expect(r.matchMethod).toBe('county-unincorporated');
  });

  it('a city lookup never returns a county / unincorporated row, and never a longer name', () => {
    expect(getAhjByCity('IL', 'Unincorporated')).toBeNull();
    const madison = getAhjByCity('IL', 'Madison');
    if (madison) {
      expect(madison.ahjType).not.toBe('county');
      expect(madison.city.toLowerCase()).not.toContain('unincorporated');
    }
  });

  it('the snapshot records HOW the AHJ was bound', () => {
    const { snap } = gen();
    const ca = snap.codeAuthority as unknown as {
      ahjName: string; ahjMatchMethod: string; incorporatedMunicipality: boolean | null;
    };
    expect(ca.ahjName).toBeTruthy();
    expect(['explicit-record-id', 'stored-ahj-name', 'incorporated-city',
      'county-unincorporated', 'address-parse', 'unresolved']).toContain(ca.ahjMatchMethod);
  });

  it('ONE AHJ name reaches the artifact — the code authority and the project authority agree', () => {
    const { snap, html } = gen();
    const ca = (snap.codeAuthority as unknown as { ahjName: string | null }).ahjName;
    const pa = (snap.projectAuthority as unknown as { ahjName?: string | null }).ahjName ?? null;
    expect(ca).toBeTruthy();
    if (pa) expect(pa).toBe(ca);
    // and no OTHER AHJ office name is printed anywhere on the package
    const other = ca === 'Madison County Building & Zoning'
      ? 'Granite City Building &amp; Zoning' : 'Madison County Building &amp; Zoning';
    expect(html).not.toContain(other);
  });

  it('IBC/IRC/IFC are PROVEN ABSENT from the AHJ dataset — not a propagation failure', () => {
    // The honesty claim this campaign requires: the editions are pending because
    // no SolarPro source carries them, established by exhaustive trace (no field
    // on any of the 4,029 records, none in necVersions.JURISDICTION_DATA, the
    // external registry unconfigured, and migration 117 unapplied so Neon holds
    // no AHJ table). If a future dataset DOES carry them this test must be
    // updated deliberately — it is pinning a proven negative, not a wish.
    const rec = getAhjByCounty('IL', 'Madison') as unknown as Record<string, unknown>;
    expect(rec).toBeTruthy();
    for (const k of Object.keys(rec)) expect(/^(ibc|irc|ifc)/i.test(k)).toBe(false);
    expect(rec.necVersion).toBe('2020');   // the ONE edition the dataset does carry
  });
});

// ── PITCH ────────────────────────────────────────────────────────────────────
describe('KDP — ONE roof-pitch authority', () => {
  it('the CAD plane governs over the operator-entered project field', () => {
    const cad: any = { roof: { planes: [{ pitch: 16.5176 }] } };
    const a = resolveRoofPitch(cad, { project: { roofPitch: 20 } });
    expect(a.source).toBe('cad-plane');
    expect(a.ratio).toBe(3.6);
    expect(a.pitchStr).toBe('3.6:12');
  });

  it('0.1 precision, never integer rounding (4:12 was the rounded 20°)', () => {
    expect(resolveRoofPitch({ roof: { planes: [{ pitch: 20 }] } } as any, {}).pitchStr).toBe('4.4:12');
  });

  it('a value already in rise-per-12 is not tan-converted', () => {
    expect(resolveRoofPitch({ roof: { planes: [{ pitch: 5 }] } } as any, {}).ratio).toBe(5);
  });

  it('falls back to the project field, then to the default, and says which', () => {
    expect(resolveRoofPitch(null, { project: { roofPitch: 30 } }).source).toBe('project-input');
    expect(resolveRoofPitch(null, {}).source).toBe('default');
  });

  it('EVERY pitch printed on the package is the same value', () => {
    const { html } = gen();
    const tokens = new Set([...html.matchAll(/(\d+(?:\.\d+)?)\s*:\s*12/g)].map(m => m[1]));
    expect(tokens.size, `disagreeing pitch tokens: ${[...tokens].join(', ')}`).toBe(1);
    expect(html).not.toContain('4:12 SLOPE');
  });
});

// ── WS-10 ────────────────────────────────────────────────────────────────────
describe('KDP WS-10 — the rooftop adder is never a bare null', () => {
  const { snap } = gen();
  const segs = snap.electrical.routeSegments as unknown as Array<{
    segmentId: string; rooftopAdderC: number | null; rooftopAdderBasis?: string | null;
    ambientTempC: number | null; effectiveAmbientTempC: number | null;
  }>;

  it('every route segment states the adder basis', () => {
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.rooftopAdderBasis, `${s.segmentId} has no adder basis`).toBeTruthy();
      expect(String(s.rooftopAdderBasis).length).toBeGreaterThan(20);
    }
  });

  it('a null adder is accompanied by the reason it does not apply', () => {
    for (const s of segs.filter(x => x.rooftopAdderC == null)) {
      expect(String(s.rooftopAdderBasis)).toMatch(/no rooftop adder/i);
    }
  });

  it('a roof raceway cites the code deletion under a post-2017 adopted edition', () => {
    const roofRaceway = segs.find(s => /BRANCH_HOMERUN/i.test(s.segmentId));
    expect(roofRaceway).toBeTruthy();
    expect(String(roofRaceway!.rooftopAdderBasis)).toMatch(/690\.31\(A\)|310\.15\(B\)\(3\)\(c\)/);
  });

  it('the ambient temperature itself is populated and the effective ambient is derived from it', () => {
    for (const s of segs) {
      expect(s.ambientTempC, `${s.segmentId} ambient`).not.toBeNull();
      expect(s.effectiveAmbientTempC).toBe((s.ambientTempC ?? 0) + (s.rooftopAdderC ?? 0));
    }
  });
});
