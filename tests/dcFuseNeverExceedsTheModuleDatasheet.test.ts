// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A STAMPED PERMIT SPECIFIED — AND THE BOM BOUGHT — A FUSE THE MODULE FORBIDS
//
// `lib/permit/utils/conductorAuthority.ts` dcStringRow() derived the DC string
// OCPD as:
//
//     ocpdAmps: isc ? necNextStandardOcpd(isc * 1.56) : (str.ocpd ?? null)
//
// with nothing above it. NEC 690.9(B) makes the module's own listed maximum
// series fuse rating a HARD CAP, and `lib/ocpd-resolver.ts` already implements
// that cap correctly (its step 5, with `wasCapped` and a `PASS_CAPPED` status).
// This row is the duplicate that dropped it.
//
// The consequence is not a display artifact. `lib/permit/utils/bomForPermit.ts`
// takes `dcOCPD` as the max `ocpdAmps` across this authority's strings, so the
// installer RECEIVES the oversized fuse. And the same package reproduces the
// module's datasheet two sheets earlier — `lib/permit/sections/compliancePages.ts`
// prints "Max Series Fuse Rating ... 20 A" — so the package contradicts itself in
// print, which is a plan-review rejection on its own. Built as drawn, the module's
// bypass diodes and ribbon are protected 25 % above the rating they were listed at.
//
// 🚨 AND THE FALLBACK MUST NOT FABRICATE. `lib/permit/generatePermit.ts` carries
// `maxSeriesFuseRating: db?.maxSeriesFuseRating ?? 20` in three places — a
// datasheet number no datasheet supplied, for any module whose record does not
// resolve. This authority reports an unresolved limit as `null` instead, so a
// consumer can say "unresolved" rather than assert 20 A.
//
// These cases run the REAL `buildConductorAuthority` over the REAL catalog.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildConductorAuthority } from '@/lib/permit/utils/conductorAuthority';
import { necNextStandardOcpd } from '@/lib/permit/utils/helpers';
import { SOLAR_PANELS } from '@/lib/equipment-db';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../test-fixtures/roofProject';

const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;

/**
 * A STRING-topology single-sub fixture whose module is chosen by id, so
 * `resolvePanelSpecs` step 1 (`project.subSystems[key].panelId` → getPanelById)
 * resolves it through the canonical accessor — the same path production uses.
 */
function stringFixture(panelId: string | undefined, isc: number) {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.subSystems = panelId ? { roof: { panelId } } : {};
  p.system.topology = 'string';
  p.system.inverters = [{
    manufacturer: 'Solis', model: 'S6-EH1P-7.6K-US', type: 'string',
    acOutputKw: 7.6, maxDcVoltage: 600, efficiency: 0.975, ulListing: 'UL 1741 SA',
    strings: [{
      label: 'String 1', panelCount: 12,
      panelWatts: 430, panelVoc: 41.7, panelIsc: isc,
      wireGauge: '10 AWG', wireLength: 45,
      isc, ampacity: 30, voltageDrop: 1.8,
      // Deliberately NOT carrying maxSeriesFuseRating: the sub-level resolution
      // is the path under test.
    }],
  }];
  return p;
}

const dcRows = (fx: unknown) => buildConductorAuthority(fx as never, cad).subSystems
  .flatMap(s => s.dcStrings);

/** Catalog modules whose Isc × 1.56 rounds ABOVE their own listed maximum. */
const OVERFUSED = SOLAR_PANELS.filter(p =>
  Number(p.isc) > 0 && Number(p.maxSeriesFuseRating) > 0
  && necNextStandardOcpd(Number(p.isc) * 1.56) > Number(p.maxSeriesFuseRating));

/** Catalog modules where the derivation already fits — the control group. */
const WITHIN = SOLAR_PANELS.filter(p =>
  Number(p.isc) > 0 && Number(p.maxSeriesFuseRating) > 0
  && necNextStandardOcpd(Number(p.isc) * 1.56) <= Number(p.maxSeriesFuseRating));

describe('🚨 the DC string fuse never exceeds the module datasheet', () => {
  it('the catalog really does contain modules the old derivation over-fused', () => {
    // If this is ever 0, every case below is vacuous and must be re-aimed.
    expect(OVERFUSED.length,
      'no catalog module is over-fused by Isc×1.56 — the cases below prove nothing').toBeGreaterThan(0);
    expect(WITHIN.length, 'no control group — a cap that caps everything is not a cap').toBeGreaterThan(0);
  });

  it('every over-fused catalog module is capped at its own listed maximum', () => {
    for (const p of OVERFUSED) {
      const rows = dcRows(stringFixture(p.id, Number(p.isc)));
      expect(rows.length, `${p.id}: no DC string row was built`).toBeGreaterThan(0);
      const row = rows[0];
      const uncapped = necNextStandardOcpd(Number(p.isc) * 1.56);

      expect(row.ocpdAmps,
        `${p.manufacturer} ${p.model}: ${row.ocpdAmps} A fuse on a module listed for `
        + `${p.maxSeriesFuseRating} A max (NEC 690.9(B))`,
      ).toBeLessThanOrEqual(Number(p.maxSeriesFuseRating));

      expect(row.ocpdAmps, `${p.id}: still the uncapped ${uncapped} A`).not.toBe(uncapped);
      expect(row.maxSeriesFuseA, `${p.id}: the datasheet limit was not carried out`)
        .toBe(Number(p.maxSeriesFuseRating));
      expect(row.ocpdWasCapped, `${p.id}: the cap fired but was not reported`).toBe(true);
    }
  });

  it('a module whose derivation already fits is NOT reduced', () => {
    // A cap that lowers everything would hide the real constraint and under-protect
    // nothing while over-protecting the strings that were already correct.
    for (const p of WITHIN.slice(0, 12)) {
      const row = dcRows(stringFixture(p.id, Number(p.isc)))[0];
      expect(row.ocpdAmps, `${p.id}: a compliant fuse was reduced`)
        .toBe(necNextStandardOcpd(Number(p.isc) * 1.56));
      expect(row.ocpdWasCapped).toBe(false);
    }
  });

  it('🚨 an UNRESOLVED module reports no limit — it does not fabricate 20 A', () => {
    // generatePermit's `?? 20` is the fabricated absence this authority exists to
    // stop. 13.85 A × 1.56 → 25 A, which a fabricated 20 A cap would silently
    // reduce while asserting a datasheet figure that came from nowhere.
    const row = dcRows(stringFixture(undefined, 13.85))[0];
    expect(row.maxSeriesFuseA, 'an unresolved module was given an invented 20 A limit').toBeNull();
    expect(row.ocpdWasCapped).toBe(false);
    expect(row.ocpdAmps, 'the uncapped derivation should stand when no limit is known').toBe(25);
  });

  it('a per-string rating on the payload wins, but only when it is a real number', () => {
    const fx = stringFixture(undefined, 13.85);
    fx.system.inverters[0].strings[0].maxSeriesFuseRating = 20;
    const row = dcRows(fx)[0];
    expect(row.ocpdAmps).toBe(20);
    expect(row.maxSeriesFuseA).toBe(20);
    expect(row.ocpdWasCapped).toBe(true);

    // A junk value must not become a cap.
    const junk = stringFixture(undefined, 13.85);
    junk.system.inverters[0].strings[0].maxSeriesFuseRating = 'twenty';
    expect(dcRows(junk)[0].maxSeriesFuseA).toBeNull();
  });

  it('the capped rating is still a real NEC 240.6(A)-orderable fuse', () => {
    // The module's listed maximum is itself a standard rating in every catalog
    // entry; assert it rather than trusting it, since the cap is what ships.
    for (const p of OVERFUSED) {
      const row = dcRows(stringFixture(p.id, Number(p.isc)))[0];
      expect([10, 15, 20, 25, 30, 35, 40],
        `${p.id}: capped to ${row.ocpdAmps} A, which is not an orderable fuse`,
      ).toContain(row.ocpdAmps);
    }
  });
});
