// ═══════════════════════════════════════════════════════════════════════════
// THE SIX FINDINGS THAT WERE BLOCKED ON A PEER SESSION'S UNCOMMITTED FILES
//
// All six were VERIFIED in Phase 4 and could not be touched, because the files they
// live in were mid-edit in another checkout. The peer committed, so they are now
// consumable — and their exact touch surfaces were re-audited first, because the peer
// had rewritten those files in the meantime.
//
// 1. A HARD 40 °C CLAMP on the design ambient, justified by a comment that
//    misdescribes the field. `app/engineering/page.tsx` had
//        ambientTempC: Math.min(autoDetected?.designTempMax ?? 40, 40)
//    with a comment claiming designTempMax is "the CONDUCTOR temp (air + rooftop
//    adder), NOT the air ambient" and that "using 95 °C here causes massive
//    over-derating". Both halves are false and both are checkable:
//      · app/api/engineering/calculate/route.ts:446 sets it from
//        getThermalDesignBasis(...).maxDesignTempC = ashrae2pctHighC — the AIR AMBIENT;
//      · electrical-calc.ts:754, ocpd-resolver.ts:83/139 and manufacturer-specs.ts:250
//        all compute `designTempMax + rooftopTempAdderC`. It cannot be the conductor
//        temp AND the thing the adder is added to;
//      · the highest value in the whole state envelope is 43 °C, so 95 °C is
//        unreachable and the over-derating the clamp guarded against was impossible.
//    UNSAFE DIRECTION: in AZ (43 °C) and NV (41 °C) it credited more ampacity than the
//    site's own ASHRAE authority allows — 0.91 instead of 0.87 bare, and with the roof
//    adder 70 °C → 0.58 instead of 73 °C → 0.50, a 16 % over-credit.
//
// 2. THREE DIFFERENT ROOFTOP ADDER VALUES (33 / 30 / 35) for the same physical roof
//    run. All three are moot under the adopted edition: NEC 310.15(B)(3)(c) was
//    DELETED for PV by NEC 2017 690.31(A). `lib/computed-system.ts` already knew this
//    privately (its `_necYear < 2017` gate and its per-segment gate), but
//    `lib/wire-autosizer.ts` — which is what the page's memo feeds — applies the adder
//    UNCONDITIONALLY at three sites and has no edition parameter at all. One engine
//    gated it, the other did not. DIRECTION: applying a deleted adder OVER-derates —
//    a cost, not a hazard. It partially cancelled defect 1, which is very likely why
//    neither was noticed.
//
// 3. EIGHT `designTempMin: -10` LITERALS. −10 °C is a third cold basis agreeing with
//    neither the engine nor the plan set, and it is warmer than almost every real site
//    (national default −25; MN −31, MT −32, AK −40). The string layout this page WRITES
//    INTO THE PROJECT was computed at −10 while the permit recomputes at the ASHRAE
//    extreme low and rejects it — near the boundary, a saved and ordered design whose
//    strings are one panel too long for the inverter.
//
// 4. THE SLD ROUTE RESOLVED THE THERMAL AUTHORITY AND THREW ITS HOT SIDE AWAY for a
//    flat 30 °C, and applied a flat 30 °C rooftop adder to every system type including
//    ground and fence.
//
// 5. THE STANDALONE SLD ROUTE NEVER PASSED batteryCount, so the manufacturer's step
//    function was evaluated at ONE unit and the 705.12(B) total lost 40–100 A in the
//    permissive direction — a printed "120% Rule PASS ✓" where the answer is FAIL.
//
// 6. THE BATTERY WAS COUNTED TWICE on the single-lane E-1 panel, because the renderer
//    added `batteryBackfeedA` to a `backfeedAmps` that already included it.
//
// Plus the last five `Math.ceil(x / 5) * 5` OCPD sites, in three files.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import {
  rooftopAmbientAdderC,
  rooftopAdderAppliesToEdition,
  ROOFTOP_ADDER_MAX_C,
} from '@/lib/nec/rooftopAdder';
import { necAmbientCorrection90C } from '@/lib/nec/ampacity';
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

// ── 1. The rooftop adder gate — behavioural, on the new authority ────────────
describe('🚨 the rooftop adder is gated on the ADOPTED edition', () => {
  it('310.15(B)(3)(c) does not exist in 2017 or later', () => {
    for (const ed of ['2017', '2020', '2023', 'NEC 2020', 'NEC 2023']) {
      expect(rooftopAdderAppliesToEdition(ed), `${ed}`).toBe(false);
      expect(rooftopAmbientAdderC({ systemType: 'roof', necEdition: ed }).adderC, `${ed}`).toBe(0);
    }
    // And it DOES exist before 2017 — so this is a gate, not a blanket zero.
    for (const ed of ['2014', 'NEC 2011']) {
      expect(rooftopAdderAppliesToEdition(ed), `${ed}`).toBe(true);
      expect(rooftopAmbientAdderC({ systemType: 'roof', necEdition: ed }).adderC, `${ed}`)
        .toBe(ROOFTOP_ADDER_MAX_C);
    }
  });

  it('an unknown edition invents nothing', () => {
    // Matching computed-system's own established rule: fabricating a code requirement
    // from a missing input is the defect class this campaign exists to remove.
    for (const ed of [null, undefined, '', 'unknown']) {
      expect(rooftopAmbientAdderC({ systemType: 'roof', necEdition: ed as never }).adderC).toBe(0);
    }
  });

  it('a ground or fence run never carries a rooftop adder, even pre-2017', () => {
    for (const st of ['ground', 'fence', 'carport']) {
      const r = rooftopAmbientAdderC({ systemType: st, necEdition: '2014' });
      expect(r.adderC, `${st}`).toBe(0);
      expect(r.applies, 'the edition gate should still report the section as present').toBe(true);
      expect(r.basis).toMatch(/not on a roof surface/);
    }
  });

  it("the SEGMENT's own roof-ness overrides the project's system type", () => {
    // This is the V3 requirement: key on the segment, not on which branch of a
    // topology `if` the caller sits in. An open-air run on a roof project gets 0.
    expect(rooftopAmbientAdderC({ systemType: 'roof', necEdition: '2014', onRoof: false }).adderC).toBe(0);
    // ...and an on-roof raceway on a "ground" project gets the adder.
    expect(rooftopAmbientAdderC({ systemType: 'ground', necEdition: '2014', onRoof: true }).adderC)
      .toBe(ROOFTOP_ADDER_MAX_C);
  });

  it('carries the REAL four-row height table, not a flat 33', () => {
    const at = (h: number) => rooftopAmbientAdderC({ systemType: 'roof', necEdition: '2014', heightAboveRoofIn: h }).adderC;
    expect(at(0.25)).toBe(33);   // 0 to 1/2 in.
    expect(at(2)).toBe(22);      // above 1/2 through 3-1/2 in.
    expect(at(8)).toBe(17);      // above 3-1/2 through 12 in.
    expect(at(24)).toBe(14);     // above 12 through 36 in.
    expect(at(48)).toBe(0);      // above 36 in. — the section applied none
    // Unrecorded height takes the most conservative row and SAYS so.
    const unknown = rooftopAmbientAdderC({ systemType: 'roof', necEdition: '2014' });
    expect(unknown.adderC).toBe(33);
    expect(unknown.basis).toMatch(/not recorded/);
  });

  it('always states a basis — the sheet can say why either way', () => {
    for (const ed of ['2014', '2020', null]) {
      expect(rooftopAmbientAdderC({ systemType: 'roof', necEdition: ed as never }).basis.length)
        .toBeGreaterThan(20);
    }
  });
});

// ── 2. The clamp's consequence, in real correction factors ──────────────────
describe('🚨 the 40 °C clamp credited ampacity the site does not allow', () => {
  it('AZ and NV are the states it bit, and the numbers are the finding numbers', () => {
    const az = getThermalDesignBasis({ state: 'AZ' }).maxDesignTempC;
    const nv = getThermalDesignBasis({ state: 'NV' }).maxDesignTempC;
    expect(az, 'AZ ASHRAE 2% high').toBe(43);
    expect(nv, 'NV ASHRAE 2% high').toBe(41);

    // Bare conductor: the clamp gave 0.91, the site requires 0.87.
    expect(necAmbientCorrection90C(40)).toBe(0.91);
    expect(necAmbientCorrection90C(az)).toBe(0.87);
    expect(necAmbientCorrection90C(nv)).toBe(0.87);

    // With a 30 °C roof adder — the 16 % over-credit the finding measured.
    expect(necAmbientCorrection90C(40 + 30)).toBe(0.58);
    expect(necAmbientCorrection90C(az + 30)).toBe(0.50);
    expect((0.58 - 0.50) / 0.50).toBeCloseTo(0.16, 2);
  });

  it('the clamp was a NO-OP everywhere else, which is why it hid', () => {
    // Every state at or below 40 °C is unaffected — so the defect was invisible
    // outside two states, and a fixture in any other state could not have seen it.
    for (const st of ['IL', 'MN', 'FL', 'CA']) {
      const t = getThermalDesignBasis({ state: st }).maxDesignTempC;
      expect(t, `${st}`).toBeLessThanOrEqual(40);
      expect(Math.min(t, 40)).toBe(t);
    }
  });

  it('95 °C — the value the clamp feared — is unreachable from this field', () => {
    // The comment justifying the clamp claimed the field could be 95 °C. The highest
    // value in the entire state envelope is AZ at 43.
    const highs = ['AZ', 'NV', 'TX', 'FL', 'CA', 'AK', 'MN']
      .map(s => getThermalDesignBasis({ state: s }).maxDesignTempC);
    expect(Math.max(...highs)).toBeLessThan(50);
  });
});

// ── 3. The battery is not counted twice on E-1 ──────────────────────────────
describe('🚨 the E-1 backfeed table does not count the battery twice', () => {
  const base = (over: Partial<SLDProfessionalInput> = {}): SLDProfessionalInput => ({
    projectName: 'Battery Double Count', clientName: 'Ray', address: '1 Test St',
    designer: 'T', drawingDate: '2026-09-26', drawingNumber: 'SLD-1', revision: 'A',
    scale: 'NTS', mainPanelAmps: 200, panelBusRating: 200, utilityName: 'Ameren Illinois',
    acWireLength: 50, topologyType: 'MICROINVERTER',
    totalModules: 24, totalStrings: 0,
    panelModel: 'PV', panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
    acOutputKw: 8, acOutputAmps: 33, acWireGauge: '#6 AWG', acConduitType: 'EMT',
    acOCPD: 50,
    interconnection: 'LOAD_SIDE',
    hasBattery: true, batteryModel: 'IQ Battery 5P', batteryKwh: 5,
    ...over,
  } as SLDProfessionalInput);

  /** The E-1 rows as flat text, so a doubled figure is visible. */
  const rows = (svg: string) => svg.replace(/<[^>]*>/g, '|');

  it('a combined backfeedAmps is labelled combined and NOT re-added', () => {
    // 60 A here is PV + battery, which is what computed-system.ts:2948 exposes
    // (`backfeedBreakerAmps: totalBackfeedA`) and what computeSystemProjection.ts:72
    // passes through as both backfeedBreakerRequired and solarBreakerRequired.
    const svg = renderSLDProfessional(base({ backfeedAmps: 60, batteryBackfeedA: 20 }));
    const text = rows(svg);
    expect(text, 'the battery was added to a total that already contained it')
      .not.toMatch(/Total Backfeed[^0-9]*80 A/);
    expect(text, 'the combined figure is still labelled PV-only').not.toMatch(/\|PV Breaker\|/);
    expect(text).toMatch(/PV \+ Storage Bkr/);
    expect(text, 'the battery row does not say it is already included').toMatch(/incl\. above/);
  });

  it('a caller that supplies the PV-ONLY figure gets three additive rows', () => {
    const svg = renderSLDProfessional(base({
      backfeedAmps: 60, batteryBackfeedA: 20, pvOnlyBackfeedA: 40,
    }));
    const text = rows(svg);
    expect(text).toMatch(/\|PV Breaker\|/);          // honest label
    expect(text).toMatch(/Total Backfeed[^0-9]*60 A/); // 40 + 20, added once
    expect(text, 'the included note must NOT appear when the figure really is PV-only')
      .not.toMatch(/incl\. above/);
  });

  it('a design with NO battery is untouched', () => {
    const svg = renderSLDProfessional(base({ backfeedAmps: 50, hasBattery: false, batteryKwh: 0 }));
    const text = rows(svg);
    expect(text).toMatch(/\|PV Breaker\|/);
    expect(text).toMatch(/Total Backfeed[^0-9]*50 A/);
  });
});

// ── 4. Source guards for the three files no unit test can drive ─────────────
describe('the thermal literals are gone from the files that write the project', () => {
  // 🚨 SOURCE SCANS, said plainly. `app/engineering/page.tsx` is a 17k-line client
  // component bound to useParams, an app store and live fetches, and the two SLD routes
  // need a request and a database. What these CAN discriminate is the presence of a
  // literal, which is exactly what the findings are about. Comment-stripped, because
  // every repair here quotes the value it removed in its own explanation — that trap
  // has caught guards in this campaign twice.
  it('the engineering page has no designTempMin: -10 and no 40 °C clamp', () => {
    const src = read('app', 'engineering', 'page.tsx');
    expect(src, 'a -10 °C cold basis is back').not.toMatch(/designTempMin:\s*-10\b/);
    expect(src, 'the 40 °C ambient clamp is back').not.toMatch(/Math\.min\([^)]*designTempMax[^)]*40\s*\)/);
    expect(src, 'designTempMax: 40 is back').not.toMatch(/designTempMax:\s*40\b/);
    expect(src, "necVersion is hardcoded again").not.toMatch(/necVersion:\s*'20\d\d'/);
    expect(src, 'the page does not consult the cold-temperature authority')
      .toMatch(/resolveDesignTempMinC\(/);
    expect(src, 'the page does not consult the rooftop-adder gate')
      .toMatch(/rooftopAmbientAdderC\(/);
  });

  it('no file in the repo still rounds an OCPD to a multiple of five', () => {
    // The last five sites were in three files. This walks app/ and lib/ with a LINE
    // filter rather than the parser-backed stripper, because that helper throws by
    // design on unparseable input and one such file would fail this case for a reason
    // with nothing to do with OCPD rounding.
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
        const hits = readFileSync(p, 'utf8').split('\n').filter((l) => {
          const t = l.trimStart();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
          return /Math\.ceil\([^)]*\/\s*5\)\s*\*\s*5/.test(l);
        });
        if (hits.length) offenders.push(p.slice(ROOT.length + 1).replace(/\\/g, '/'));
      }
    };
    walk(join(ROOT, 'app'));
    walk(join(ROOT, 'lib'));
    expect(offenders.sort(), 'the banned OCPD rounding is back').toEqual([]);
  });

  it('the SLD route uses the thermal hot side, gates the adder, and passes batteryCount', () => {
    const src = read('app', 'api', 'engineering', 'sld', 'route.ts');
    expect(src, 'the ambient fell back to a flat 30 again')
      .not.toMatch(/ambientTempC:\s*Number\(body\.ambientTempC\s*\?\?\s*30\)/);
    expect(src, 'the route ignores the hot side it already resolved')
      .toMatch(/_sldThermal\.maxDesignTempC/);
    expect(src, 'the adder fell back to a flat 30 again')
      .not.toMatch(/rooftopTempAdderC:\s*Number\(body\.rooftopTempAdderC\s*\?\?\s*30\)/);
    expect(src, 'the route does not consult the adder gate').toMatch(/rooftopAmbientAdderC\(/);
    // The battery step function must see the fleet, not one unit.
    expect(src, 'batteryCount still never reaches the engine input')
      .toMatch(/batteryCount:\s*body\.batteryCount/);
  });
});
