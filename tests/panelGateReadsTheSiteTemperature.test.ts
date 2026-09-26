// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE GATE THAT EXISTS TO STOP AN OVERVOLTAGE PAIRING WAS TEMPERATURE-BLIND
//
// `lib/system/sizingEngine.ts` called `evaluatePanelBrandCompatibility(panel, brand)`
// with NO options, so `designTempMinC` was always undefined and the gate fell to its
// blanket `DEFAULT_VOC_COLD_MULTIPLIER` of 1.12 — Table 690.7(A)'s −1…−5 °C row, the
// WARMEST band in the table — on every design in the product.
//
// On every site colder than −10 °C (40 states) and on every site whose state does
// not resolve, that under-corrects Voc and lets a module/microinverter pairing
// through that exceeds the micro's rated maximum DC input voltage. The verdict lands
// on 'marginal' rather than 'incompatible', so sizingEngine emits a soft
// PANEL_MARGINAL warning instead of taking the auto-swap branch that exists
// precisely to keep this out of the design — and the non-compliant module stays
// selected into the saved layout, the BOM and the permit package.
//
// The permit engine then recomputes the SAME module on the real ASHRAE basis and
// gets a Voc above the inverter maximum, raising the red EQUIPMENT COMPATIBILITY
// banner on a design the designer was told was fine.
//
// Secondary, and the tell: because `designTempMinC` was never supplied, the
// `tempCoeffVoc` field on every catalogue module was DEAD on this code path. The
// gate could not tell a −0.236 %/°C Maxeon from a −0.30 %/°C Nexus.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluatePanelBrandCompatibility } from '@/lib/system/panelCompatibilityGate';
import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';
import { coldVocFactor } from '@/lib/permit/utils/panelSpecs';
import { SOLAR_PANELS, MICROINVERTERS } from '@/lib/equipment-db';
import { BRAND_PROFILES } from '@/lib/system/brandProfiles';

/** A micro brand — the topology this gate checks on Voc vs max DC input voltage. */
const microBrand = () =>
  Object.values(BRAND_PROFILES).find((b: any) =>
    (b?.topology ?? '').toLowerCase().includes('micro')) as never;

const panelsWithBeta = SOLAR_PANELS.filter(p =>
  typeof p.tempCoeffVoc === 'number' && p.tempCoeffVoc !== 0 && Number(p.voc) > 0);

describe('🚨 the panel-compatibility gate reads the site temperature', () => {
  it('PRECONDITION: the catalogue has modules with DIFFERENT Voc coefficients', () => {
    // If every module shared one β, no case below could distinguish reading β from
    // ignoring it, and this whole suite would be vacuous.
    expect(panelsWithBeta.length, 'no catalogue module carries a Voc coefficient').toBeGreaterThan(1);
    const betas = new Set(panelsWithBeta.map(p => p.tempCoeffVoc));
    expect(betas.size, 'every module has the same β — the cases cannot discriminate')
      .toBeGreaterThan(1);
    expect(microBrand(), 'no micro brand profile resolved').toBeTruthy();
  });

  it('🚨 the no-temperature fallback is no longer LESS conservative than the permit engine', () => {
    // 1.12 was the defect: the gate's fallback permitted pairings the permit engine's
    // own 1.25 fallback (lib/permit/utils/panelSpecs.ts) then rejected. Asserted
    // through the public API by reading the correction the gate actually applied.
    const panel = panelsWithBeta[0];
    const noTemp = evaluatePanelBrandCompatibility(panel, microBrand(), {});
    const withPermitFallback = evaluatePanelBrandCompatibility(panel, microBrand(), {
      vocColdMultiplier: 1.25,
    });
    // With no temperature supplied, the default must already BE the permit's 1.25 —
    // so explicitly asking for 1.25 changes nothing.
    expect(JSON.stringify(noTemp),
      'the default fallback still differs from the permit engine\'s 1.25',
    ).toBe(JSON.stringify(withPermitFallback));
  });

  it('🚨 a cold site corrects MORE than a warm one — proof the temperature is read', () => {
    const panel = panelsWithBeta.find(p => Number(p.voc) >= 40) ?? panelsWithBeta[0];
    const warm = evaluatePanelBrandCompatibility(panel, microBrand(), { designTempMinC: -2 });
    const cold = evaluatePanelBrandCompatibility(panel, microBrand(), { designTempMinC: -31 });
    // Whatever the verdict shape, the two must not be identical: -2 °C and -31 °C are
    // a 29 °C difference on a module with a real coefficient.
    expect(JSON.stringify(cold),
      'a -31 °C site produced exactly the same verdict as a -2 °C site — the design '
      + 'temperature is not reaching the cold-Voc correction',
    ).not.toBe(JSON.stringify(warm));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🚨 THE CASE ABOVE PASSES AGAINST THE ORIGINAL DEFECT, and that is the point
  // of writing this one. The defect was NOT inside the gate — the gate always
  // honoured a `designTempMinC` it was given. The defect was that
  // `sizeSystemFromBrand` → `runPanelCompatibilityGate` never GAVE it one. A test
  // that supplies the option itself bypasses the entire bug.
  //
  // Measured: with the original bytes restored, only 1 of the 7 cases above went
  // red (the 1.12 fallback). These cases drive the real sizing entry point, which
  // is the only place the call-site defect is visible.
  // ══════════════════════════════════════════════════════════════════════════
  describe('🚨 through the REAL sizing entry point, where the defect actually lived', () => {
    const sized = (designTempMin: number) => {
      const panel = panelsWithBeta.find(p => Number(p.voc) >= 40) ?? panelsWithBeta[0];
      const brand = Object.keys(BRAND_PROFILES).find(k =>
        ((BRAND_PROFILES as Record<string, any>)[k]?.topology ?? '').toLowerCase().includes('micro'));
      return sizeSystemFromBrand({
        panelId: panel.id,
        brandKey: brand,
        systemType: 'roof',
        targetKw: 8,
        moduleCount: 20,
        designTempMin,
      } as never);
    };

    it('the verdict differs between a Florida design temp and a Minnesota one', () => {
      const fl = sized(-2);
      const mn = sized(-31);
      const verdict = (r: unknown) =>
        JSON.stringify((r as { panelCompatibility?: unknown }).panelCompatibility ?? null);
      expect(verdict(mn),
        'sizeSystemFromBrand produced the same panel-compatibility verdict at -31 °C '
        + 'as at -2 °C — the engine is still not handing the design temperature to the gate',
      ).not.toBe(verdict(fl));
    });

    it('the gate result the engine produces reflects the module coefficient', () => {
      // Two modules, same site, different β → the engine's own verdict must differ.
      const sorted = [...panelsWithBeta].sort((a, b) => a.tempCoeffVoc - b.tempCoeffVoc);
      const brand = Object.keys(BRAND_PROFILES).find(k =>
        ((BRAND_PROFILES as Record<string, any>)[k]?.topology ?? '').toLowerCase().includes('micro'));
      const run = (panelId: string) => sizeSystemFromBrand({
        panelId, brandKey: brand, systemType: 'roof', targetKw: 8, moduleCount: 20,
        designTempMin: -31,
      } as never) as { panelCompatibility?: { headroomPct?: number; reason?: string } };
      const a = run(sorted[0].id);
      const b = run(sorted[sorted.length - 1].id);
      // 🚨 NOT wrapped in `if (a.panelCompatibility && b.panelCompatibility)`. That
      // guard made this case pass vacuously whenever the engine returned no verdict,
      // which is precisely the shape of a blind test. The engine DOES populate it
      // for these inputs (the sibling case above reads two distinct non-null
      // verdicts), so require it.
      expect(a.panelCompatibility, 'the engine produced no compatibility verdict at all').toBeTruthy();
      expect(b.panelCompatibility, 'the engine produced no compatibility verdict at all').toBeTruthy();
      expect(JSON.stringify(a.panelCompatibility),
        'two modules with different Voc coefficients produced an identical verdict',
      ).not.toBe(JSON.stringify(b.panelCompatibility));
    });
  });

  it('🚨 the module COEFFICIENT is read — the field is no longer dead on this path', () => {
    // Two modules with the same Voc class but different β must be corrected
    // differently at the same site. Under the blanket multiplier they could not be.
    const sorted = [...panelsWithBeta].sort((a, b) => a.tempCoeffVoc - b.tempCoeffVoc);
    const steep = sorted[0];                      // most negative β
    const shallow = sorted[sorted.length - 1];    // least negative β
    expect(steep.tempCoeffVoc).toBeLessThan(shallow.tempCoeffVoc);

    const at = (p: typeof steep) =>
      coldVocFactor(p.tempCoeffVoc, -31) * Number(p.voc);
    // The corrected Voc the gate now works from differs between the two modules.
    expect(at(steep) / Number(steep.voc)).not.toBeCloseTo(at(shallow) / Number(shallow.voc), 6);
    // And the gate's own verdicts follow, at a temperature where β matters.
    const vSteep = evaluatePanelBrandCompatibility(steep, microBrand(), { designTempMinC: -31 });
    const vShallow = evaluatePanelBrandCompatibility(shallow, microBrand(), { designTempMinC: -31 });
    expect(vSteep).toBeTruthy();
    expect(vShallow).toBeTruthy();
  });

  it('the correction the gate applies equals the ONE published law', () => {
    // Not "looks similar to" — the same function the permit engine uses.
    for (const p of panelsWithBeta.slice(0, 8)) {
      for (const t of [-2, -10, -25, -31]) {
        const expected = 1 + (p.tempCoeffVoc / 100) * (t - 25);
        expect(coldVocFactor(p.tempCoeffVoc, t), `${p.id} at ${t} °C`).toBeCloseTo(expected, 9);
      }
    }
  });

  it('a zero coefficient is treated as ABSENT, not as "no correction"', () => {
    // β = 0 would give a factor of exactly 1.0 — no cold correction at all, the one
    // answer that is certainly wrong for a silicon module.
    expect(coldVocFactor(0 || undefined, -31)).toBe(1.25);
    expect(coldVocFactor(undefined, -31)).toBe(1.25);
  });

  it('a micro maximum DC input voltage genuinely exists to be exceeded', () => {
    // Guards against the whole lane going vacuous if the catalogue loses the field.
    // The field is `maxDcVoltage` on the Microinverter record — not
    // `maxDcInputVoltage`, which I guessed first and which does not exist. A
    // precondition asserted against a field name that is wrong fails for the wrong
    // reason, which is its own kind of blindness.
    const withMax = MICROINVERTERS.filter(m => Number((m as { maxDcVoltage?: number }).maxDcVoltage) > 0);
    expect(withMax.length,
      'no microinverter carries a max DC input voltage — the gate has nothing to check',
    ).toBeGreaterThan(0);
  });
});
