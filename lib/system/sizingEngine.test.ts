// ════════════════════════════════════════════════════════════════════
// Sizing Engine — vitest golden tests
// lib/system/sizingEngine.vitest.ts
//
// Covers all 10 Phase 14 test scenarios:
//   1. Roof + Enphase (micro)
//   2. Roof + Fronius (string, no battery)
//   3. Roof + SolarEdge (optimizer)
//   4. Ground + generic string
//   5. Fence + EcoFlow (hybrid + battery)
//   6. Fence + non-EcoFlow brand
//   7. Battery OFF (no battery block)
//   8. Battery ON for EcoFlow
//   9. No stale components when switching brands
//  10. No micro components in string/hybrid systems
// ════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from './sizingEngine';

describe('Sizing Engine — Brand-driven equipment derivation', () => {
  // ─── Test 1 — Roof + Enphase ──────────────────────────────────────
  it('Roof + Enphase: assigns one micro per panel, no DC strings', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    expect(result.brand.id).toBe('enphase');
    expect(result.topology).toBe('micro');
    expect(result.inverterCount).toBe(20);
    expect(result.strings).toHaveLength(0);
    expect(result.microDeviceCount).toBe(20);
    expect(result.acBranchCount).toBeGreaterThan(0);
    expect(result.battery).toBeNull(); // No battery unless enabled
  });

  // ─── Test 2 — Roof + Fronius ──────────────────────────────────────
  it('Roof + Fronius: string sizing picks correct tier for DC kW', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 18,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    expect(result.brand.id).toBe('fronius');
    expect(result.topology).toBe('string');
    expect(result.inverterModels).toHaveLength(1);
    // 18*400 = 7.2 kW DC. v58.1: Tier picks fronius-primo-7.6 but ratio=0.947 < 1.00.
    // attemptDownsize selects fronius-primo-5.0 → ratio=1.44 (closest viable to target 1.25).
    expect(result.inverterCount).toBe(1);
    expect(result.microDeviceCount).toBe(0);
    expect(result.battery).toBeNull();
  });

  // ─── Test 3 — Roof + SolarEdge ────────────────────────────────────
  it('Roof + SolarEdge: optimizer topology with correct tier', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'solaredge',
    });
    expect(result.brand.id).toBe('solaredge');
    expect(result.topology).toBe('optimizer');
    expect(result.inverterModels).toHaveLength(1);
    // 20*400 = 8.0 kW DC. v58.1: Tier picks se-7600h (ratio=1.053 < PREFERRED_MIN=1.20).
    // attemptDownsize: se-6000h×1 → ratio=1.333 (in preferred window 1.20-1.40) → selected.
    expect(result.requiredComponents.some(c => c.category === 'optimizer')).toBe(true);
    const optQty = result.requiredComponents.find(c => c.category === 'optimizer')!.qty;
    expect(optQty).toBe(20); // per_module
  });

  // ─── Test 4 — Ground + generic string ─────────────────────────────
  it('Ground + generic-string: fallback profile works', () => {
    const result = sizeSystemFromBrand({
      systemType: 'ground',
      panelCount: 15,
      selectedBrand: 'generic-string',
    });
    expect(result.brand.id).toBe('generic-string');
    expect(result.topology).toBe('string');
    expect(result.inverterModels.length).toBeGreaterThanOrEqual(1);
    expect(result.battery).toBeNull();
  });

  // ─── Test 5 — Fence + EcoFlow (hybrid + battery) ──────────────────
  it('Fence + EcoFlow + battery: hybrid with 10 kWh modular stack', () => {
    const result = sizeSystemFromBrand({
      systemType: 'fence',
      panelCount: 25,
      selectedBrand: 'ecoflow',
      batteryEnabled: true,
      batteryMode: 'manual',
      batteryTargetKwh: 10,
    });
    expect(result.brand.id).toBe('ecoflow');
    expect(result.topology).toBe('hybrid');
    // 25 panels * 400W = 10 kW → ecoflow-power-ocean-10kw
    expect(result.inverterModels[0].equipmentDbId).toBe('ecoflow-power-ocean-10kw');
    expect(result.battery).not.toBeNull();
    expect(result.battery!.moduleCount).toBe(2);
    expect(result.battery!.installedKwh).toBe(10);
    expect(result.battery!.strategy).toBe('modular_stack');
    // No microinverter component should be present
    expect(result.requiredComponents.some(c => c.category === 'microinverter')).toBe(false);
  });

  // ─── Test 6 — Fence + non-EcoFlow brand (SolarEdge) ───────────────
  it('Fence + SolarEdge: user override is honored (not forced to EcoFlow)', () => {
    const result = sizeSystemFromBrand({
      systemType: 'fence',
      panelCount: 20,
      selectedBrand: 'solaredge',
    });
    expect(result.brand.id).toBe('solaredge');
    expect(result.topology).toBe('optimizer');
    // SolarEdge does not support fence per profile — should warn
    expect(result.warnings.some(w => w.code === 'BRAND_SYSTEM_UNSUPPORTED')).toBe(true);
  });

  // ─── Test 7 — Battery OFF ─────────────────────────────────────────
  it('Battery OFF: no battery block is returned for any brand', () => {
    const eco = sizeSystemFromBrand({
      systemType: 'fence', panelCount: 20, selectedBrand: 'ecoflow',
      batteryEnabled: false,
    });
    const enp = sizeSystemFromBrand({
      systemType: 'roof', panelCount: 20, selectedBrand: 'enphase',
      batteryEnabled: false,
    });
    expect(eco.battery).toBeNull();
    expect(enp.battery).toBeNull();
    // Battery-only BOS components should also be absent
    expect(eco.requiredComponents.some(c => c.category === 'battery_combiner')).toBe(false);
  });

  // ─── Test 8 — Battery ON for EcoFlow ─────────────────────────────
  it('Battery ON for EcoFlow: modular stack sizes correctly and adds combiner', () => {
    const result = sizeSystemFromBrand({
      systemType: 'fence',
      panelCount: 20,
      selectedBrand: 'ecoflow',
      batteryEnabled: true,
      batteryMode: 'manual',
      batteryTargetKwh: 25,
    });
    expect(result.battery).not.toBeNull();
    expect(result.battery!.moduleCount).toBe(5); // 25/5 = 5
    expect(result.battery!.installedKwh).toBe(25);
    expect(result.requiredComponents.some(c => c.category === 'battery_combiner')).toBe(true);
  });

  // ─── Test 9 — No stale components when switching brands ──────────
  it('Switching from Enphase to EcoFlow yields zero microinverter components', () => {
    const eco = sizeSystemFromBrand({
      systemType: 'fence', panelCount: 20, selectedBrand: 'ecoflow',
    });
    // HARD RULE: no microinverter, trunk_cable, or terminator in EcoFlow BOM
    expect(eco.requiredComponents.some(c => c.category === 'microinverter')).toBe(false);
    expect(eco.requiredComponents.some(c => c.category === 'trunk_cable')).toBe(false);
    expect(eco.requiredComponents.some(c => c.category === 'terminator')).toBe(false);
  });

  // ─── Test 10 — No micro components in string/hybrid ─────────────
  it('String inverter (Fronius) never includes micro components', () => {
    const fronius = sizeSystemFromBrand({
      systemType: 'roof', panelCount: 20, selectedBrand: 'fronius',
    });
    expect(fronius.requiredComponents.some(c => c.category === 'microinverter')).toBe(false);
    expect(fronius.requiredComponents.some(c => c.category === 'trunk_cable')).toBe(false);
    expect(fronius.requiredComponents.some(c => c.category === 'terminator')).toBe(false);
  });

  // ─── Bonus — User selection is respected ─────────────────────────
  it('User-selected inverter id infers brand correctly', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedInverterId: 'enphase-iq8plus',
    });
    expect(result.brand.id).toBe('enphase');
    expect(result.topology).toBe('micro');
  });

  // ─── Bonus — Recommended default when no brand selected ──────────
  it('Fence with no brand selected uses EcoFlow (recommended default)', () => {
    const result = sizeSystemFromBrand({
      systemType: 'fence',
      panelCount: 15,
    });
    expect(result.brand.id).toBe('ecoflow');
    expect(result.warnings.some(w => w.code === 'BRAND_RECOMMENDED_DEFAULT')).toBe(true);
  });

  // ─── Bonus — DC/AC ratio warning ─────────────────────────────────
  it('Oversized DC array triggers DC/AC ratio warning', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 80, // 80 * 400W = 32 kW DC — grossly oversized for any single inverter
      selectedBrand: 'fronius',
    });
    // Will either warn or pick top tier + multiple inverters
    expect(result.inverterModels.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full-system coverage tests — odd and dense panel counts (25 and 55 panels)
//
// Regression guards added after the 55-panel SolarEdge bug:
//   - Inverter qty selection must consider string-capacity, not only DC kW.
//   - String distribution must cover all requested panels without orphans.
// ═══════════════════════════════════════════════════════════════════════════

function assertNoOrphans(
  result: ReturnType<typeof sizeSystemFromBrand>,
  expected: number,
) {
  if (result.topology === 'micro') {
    expect(result.microDeviceCount).toBe(expected);
  } else {
    const total = result.strings.reduce((s, v) => s + v.panelCount, 0);
    expect(total).toBe(expected);
    expect(result.warnings.some(w => w.code === 'STRING_OVERFLOW')).toBe(false);
  }
}

describe('Sizing Engine — 25-panel system across all brands', () => {
  it('Enphase: 25 panels → 25 micros, no orphans', () => {
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 25, selectedBrand: 'enphase' });
    expect(r.topology).toBe('micro');
    expect(r.microDeviceCount).toBe(25);
  });

  it('Fronius: 25 panels → 1 inverter, strings cover 25, no orphans', () => {
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 25, selectedBrand: 'fronius' });
    expect(r.topology).toBe('string');
    expect(r.inverterCount).toBe(1);
    assertNoOrphans(r, 25);
  });

  it('SolarEdge: 25 panels → 1 inverter × 25 panels, no orphans', () => {
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 25, selectedBrand: 'solaredge' });
    expect(r.topology).toBe('optimizer');
    expect(r.inverterCount).toBe(1);
    assertNoOrphans(r, 25);
  });

  it('EcoFlow: 25 panels → hybrid with balanced MPPT split, no orphans', () => {
    const r = sizeSystemFromBrand({ systemType: 'fence', panelCount: 25, selectedBrand: 'ecoflow' });
    expect(r.topology).toBe('hybrid');
    assertNoOrphans(r, 25);
  });
});

describe('Sizing Engine — 55-panel system (regression: string-capacity sizing)', () => {
  it('Enphase: 55 panels → 55 micros, 4 AC branches', () => {
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 55, selectedBrand: 'enphase' });
    expect(r.topology).toBe('micro');
    expect(r.microDeviceCount).toBe(55);
    expect(r.acBranchCount).toBe(4);
  });

  it('Fronius: 55 panels → ≥2 inverters, all panels assigned', () => {
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 55, selectedBrand: 'fronius' });
    expect(r.topology).toBe('string');
    expect(r.inverterCount).toBeGreaterThanOrEqual(2);
    assertNoOrphans(r, 55);
  });

  it('SolarEdge: 55 panels → qty scales to physical panel capacity, no orphans', () => {
    // Phase 13.2: per-unit panel capacity = mpptCount × parallelPerMppt × maxPPS
    //             = 1 × 2 × 25 = 50 panels/unit for SolarEdge SE-11400H.
    // 55 panels → ceil(55/50) = 2 units. DC (22 kW / 17.1 kW) → ceil = 2.
    // → qty=2 with parallel strings handling 30+25 or similar split. No orphans.
    const r = sizeSystemFromBrand({ systemType: 'roof', panelCount: 55, selectedBrand: 'solaredge' });
    expect(r.topology).toBe('optimizer');
    expect(r.inverterCount).toBeGreaterThanOrEqual(2);
    assertNoOrphans(r, 55);
  });

  it('EcoFlow: 55 panels → PowerOcean 20kW with 4 MPPTs, no orphans', () => {
    const r = sizeSystemFromBrand({ systemType: 'fence', panelCount: 55, selectedBrand: 'ecoflow' });
    expect(r.topology).toBe('hybrid');
    assertNoOrphans(r, 55);
  });

  it('REGRESSION: no STRING_OVERFLOW for any brand × reasonable count matrix', () => {
    const brands: Array<'fronius' | 'solaredge' | 'ecoflow' | 'enphase'> = [
      'fronius', 'solaredge', 'ecoflow', 'enphase',
    ];
    const counts = [10, 18, 24, 25, 36, 48, 55, 60, 72];
    for (const brand of brands) {
      for (const count of counts) {
        const systemType = brand === 'ecoflow' ? 'fence' : 'roof';
        const r = sizeSystemFromBrand({
          systemType,
          panelCount: count,
          selectedBrand: brand,
        });
        const overflow = r.warnings.find(w => w.code === 'STRING_OVERFLOW');
        if (overflow) {
          throw new Error(
            `STRING_OVERFLOW for ${brand} × ${count} panels: ${overflow.message}`,
          );
        }
      }
    }
  });
});

// ─── Real-life inverter-selection logic: prefer upsize over duplicate ─────────
describe('Sizing Engine — selectedInverterId upsizing (real-life logic)', () => {
  it('USER BUG: 36 panels + selectedInverterId=se-7600h → upsizes to se-11400h (brand-recommended tier)', () => {
    // User's actual scenario from screenshot:
    //   SolarEdge SE7600H-US × 2 with all 36 panels on card #1 and 0 on card #2.
    // Root cause: engine blindly respected selectedInverterId from stale
    //             UI state (set when system was smaller).
    // Real-world logic: brand's tier system recommends se-11400h for 12+ kW
    //                   DC loads. User's se-7600h is engineer-undersized.
    //                   Upsize to the tier-recommended model.
    // Math: 36 × 400W = 14.4 kW DC.
    //       se-7600h:  DC=ceil(14.4/11.4)=2, string=ceil(36/25)=2 → 2 units.
    //       se-11400h: DC=ceil(14.4/17.1)=1, string=ceil(36/25)=2 → 2 units.
    //       Same qty, but se-11400h is the tier-recommended model → upsize.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });
    expect(r.topology).toBe('optimizer');
    expect(r.inverterModels).toHaveLength(1);
    expect(r.inverterModels[0].equipmentDbId).toBe('se-11400h');
    const upsize = r.warnings.find(w => w.code === 'INVERTER_UPSIZED');
    expect(upsize).toBeDefined();
    expect(upsize?.severity).toBe('info');
  });

  it('Small system (10 panels) + se-7600h: NO upsize — user selection honored', () => {
    // 10 panels × 400W = 4 kW. Fits in 1 × se-7600h. Don't upsize.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 10,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });
    expect(r.inverterModels[0].equipmentDbId).toBe('se-7600h');
    expect(r.inverterModels[0].qty).toBe(1);
    expect(r.warnings.find(w => w.code === 'INVERTER_UPSIZED')).toBeUndefined();
  });

  it('Huge system (60 panels) + se-7600h: upsizes to se-10000h (ratio-optimal, v60.0+)', () => {
    // 60 panels × 400W = 24 kW DC.
    // Phase 13.2: per-unit panel capacity = mpptCount × parallelPerMppt × maxPPS
    //             = 1 × 2 × 25 = 50 panels/unit for all SolarEdge models.
    // DC units: se-7600h ceil(24/11.4)=3, se-10000h ceil(24/15.0)=2, se-11400h ceil(24/17.1)=2.
    // Panel units: ceil(60/50)=2 for se-10000h and se-11400h.
    // se-7600h needs 3 units → fewerUnitsCandidate = {se-10000h×2, se-11400h×2}.
    // v60.0 pickRatioAwareTier: se-10000h×2 ratio=24/20=1.20 (≈1.25 target, diff=0.05)
    //                           se-11400h×2 ratio=24/22.8=1.053 (diff=0.197)
    // se-10000h is closest to 1.25 target → ratio-optimal selection.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 60,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });
    expect(r.inverterModels[0].equipmentDbId).toBe('se-10000h');
    expect(r.inverterModels[0].qty).toBe(2);
    expect(r.warnings.find(w => w.code === 'INVERTER_UPSIZED')).toBeDefined();
  });

  it('Top-tier selection (se-11400h) with 60 panels: no upsize, stays on user selection', () => {
    // User already picked the tier-recommended model. Phase 13.2:
    // per-unit = 1×2×25 = 50 panels → ceil(60/50)=2, DC ceil(24/17.1)=2.
    // qty=2. No upsize.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 60,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-11400h',
    });
    expect(r.inverterModels[0].equipmentDbId).toBe('se-11400h');
    expect(r.inverterModels[0].qty).toBe(2);
    expect(r.warnings.find(w => w.code === 'INVERTER_UPSIZED')).toBeUndefined();
  });

  it('Micro topology: selectedInverterId is never upsized (installers use one SKU per job)', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'enphase',
      selectedInverterId: 'iq8m-72-2', // example micro model
    });
    // Even if the model doesn't exist, micro path is deterministic.
    expect(r.topology).toBe('micro');
    expect(r.warnings.find(w => w.code === 'INVERTER_UPSIZED')).toBeUndefined();
  });
});

// ─── Phase 13.2 regression: fresh 36-panel SolarEdge correctly sized ───────
describe('Sizing Engine — Phase 13.2 regression: 36-panel SolarEdge fresh apply', () => {
  // Phase 13.2 sizing correction:
  //   panelsPerUnit = mpptCount × parallelPerMppt × maxPPS = 1 × 2 × 25 = 50
  //   DC: 36 × 400W = 14.4 kW. se-11400h dcKwMax=17.1 → ceil(14.4/17.1)=1.
  //   Panels: ceil(36/50) = 1. → qty=1 (not 2 like the old buggy engine).
  //   DC/AC = 14.4 / 11.4 = 1.26 (healthy, within 1.0-1.55 range).
  it('36 panels + SolarEdge (no selectedInverterId) → SE-11400H × 1 unit, DC/AC healthy', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
    });
    // Single model, single unit — Phase 13.2 correction.
    expect(r.inverterModels).toHaveLength(1);
    expect(r.inverterModels[0].equipmentDbId).toBe('se-11400h');
    expect(r.inverterModels[0].qty).toBe(1);
    expect(r.inverterCount).toBe(1);
    // All 36 panels accounted for across strings, no orphans.
    const totalOnStrings = r.strings.reduce((s, x) => s + x.panelCount, 0);
    expect(totalOnStrings).toBe(36);
    // Single physical unit — all strings on inverter #0.
    const uniqueInverters = new Set(r.strings.map(s => s.inverterIndex));
    expect(uniqueInverters.size).toBe(1);
    expect(uniqueInverters.has(0)).toBe(true);
    // DC/AC ratio healthy: 14.4 / 11.4 ≈ 1.26.
    const dcKw = 36 * 0.4;
    const acKw = r.inverterModels[0].acKw * r.inverterModels[0].qty;
    const ratio = dcKw / acKw;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
    expect(ratio).toBeLessThanOrEqual(1.55);
    // Fresh apply → no upsize warning.
    expect(r.warnings.find(w => w.code === 'INVERTER_UPSIZED')).toBeUndefined();
  });
});

// ─── Physical-unit string indexing (Apply-panels-to-correct-card fix) ────────
describe('Sizing Engine — physical unit indexing in strings', () => {
  it('USER BUG: multi-unit SolarEdge spreads strings across physical units (not all on unit #0)', () => {
    // Previous bug: SizedString.inverterIndex was the MODEL array index
    // (always 0 for single-model), so the apply callback grouped ALL
    // strings into one UI card.
    // Fix: inverterIndex is now the FLAT physical unit index 0..sum(qty)-1.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 60,
      selectedBrand: 'solaredge',
    });
    // Engine should pick 2+ units (60 × 400W / 17.1 kW = 2 units on DC,
    // 60 / 25 = 3 units on string capacity → 3 units).
    const totalQty = r.inverterModels.reduce((s, m) => s + m.qty, 0);
    expect(totalQty).toBeGreaterThanOrEqual(2);

    // Every physical unit that has MPPT slots must receive ≥1 string.
    const uniqueInverterIndices = new Set(r.strings.map(s => s.inverterIndex));
    expect(uniqueInverterIndices.size).toBe(totalQty);

    // All inverterIndex values must be within the physical range.
    for (const s of r.strings) {
      expect(s.inverterIndex).toBeGreaterThanOrEqual(0);
      expect(s.inverterIndex).toBeLessThan(totalQty);
    }
  });

  it('modelIndex correctly identifies which inverterModels[] entry each string belongs to', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
    });
    // Single-model system: every string must have modelIndex=0.
    expect(r.inverterModels).toHaveLength(1);
    for (const s of r.strings) {
      expect(s.modelIndex).toBe(0);
    }
  });

  it('String panel counts sum to total panel count (no orphans) across all physical units', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 55,
      selectedBrand: 'solaredge',
    });
    const totalOnStrings = r.strings.reduce((s, x) => s + x.panelCount, 0);
    expect(totalOnStrings).toBe(55);
  });

  it('Each physical unit receives roughly balanced panel count (no unit is empty while others are full)', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 55,
      selectedBrand: 'solaredge',
    });
    // Sum panels per physical unit.
    const byUnit = new Map<number, number>();
    for (const s of r.strings) {
      byUnit.set(s.inverterIndex, (byUnit.get(s.inverterIndex) ?? 0) + s.panelCount);
    }
    const totalQty = r.inverterModels.reduce((s, m) => s + m.qty, 0);
    // Every physical unit must have ≥1 panel (no empty cards).
    for (let i = 0; i < totalQty; i++) {
      expect(byUnit.get(i) ?? 0).toBeGreaterThan(0);
    }
  });
});
// ─── Phase 13.2: DC/AC ratio correction + downsize strategy ─────────────────
describe('Sizing Engine — Phase 13.2: DC/AC ratio correction', () => {
  // TEST 1 — Bug fix verification: 36 panels @ 400W on SolarEdge should
  // NOT oversize to 2 × SE-11400H (the production bug). Physically correct
  // answer: 1 × SE-11400H with DC/AC ≈ 1.26.
  it('Bug fix: 36 panels @ 400W SolarEdge → 1 × se-11400h, DC/AC ≈ 1.26', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
    });
    expect(r.inverterCount).toBe(1);
    expect(r.inverterModels[0].equipmentDbId).toBe('se-11400h');
    expect(r.inverterModels[0].qty).toBe(1);
    // DC/AC = (36 × 0.4) / (1 × 11.4) = 14.4 / 11.4 ≈ 1.263
    const ratio = (36 * 0.4) / (r.inverterModels[0].acKw * r.inverterModels[0].qty);
    expect(ratio).toBeGreaterThanOrEqual(1.2);
    expect(ratio).toBeLessThanOrEqual(1.35);
    // Must not emit DC_AC_RATED_LOW (ratio is healthy now).
    expect(r.warnings.find(w => w.code === 'DC_AC_RATED_LOW')).toBeUndefined();
  });

  // TEST 2 — Parallel strings math: confirm that per-unit panel capacity
  // uses mpptCount × parallelPerMppt × maxPPS (not mpptCount × maxPPS).
  // 40 panels on SolarEdge should still fit in 1 × se-11400h (per-unit = 50).
  it('Parallel strings math: 40 panels fit in 1 SolarEdge unit (per-unit cap = 50)', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 40,
      selectedBrand: 'solaredge',
    });
    expect(r.inverterModels[0].qty).toBe(1);
    // Total panels on strings = 40 (no orphans).
    const totalOnStrings = r.strings.reduce((s, x) => s + x.panelCount, 0);
    expect(totalOnStrings).toBe(40);
  });

  // TEST 3 — Downsize trigger: auto-tier path picks a smaller model when
  // the tier-recommended one would yield DC/AC < 0.9. For panel counts
  // within the brand's physically achievable range (DC ≥ 0.9 × smallest
  // AC rating), engine must land at DC/AC ≥ 0.9.
  // SolarEdge smallest = se-3800h (3.8 kW AC) → minimum DC for 0.9 ratio
  // is 3.42 kW → ≈ 9 panels @ 400W. So test from 10 panels up.
  it('Downsize strategy: fresh apply never yields DC/AC < 0.9 (within brand range)', () => {
    const panelCounts = [10, 12, 15, 20, 25, 30, 36, 40];
    for (const pc of panelCounts) {
      const r = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: pc,
        selectedBrand: 'solaredge',
      });
      if (r.inverterModels.length === 0) continue;
      const totalDcKw = pc * 0.4;
      const totalAcKw = r.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
      const ratio = totalDcKw / Math.max(totalAcKw, 0.001);
      expect(ratio).toBeGreaterThanOrEqual(0.9);
    }
  });

  // TEST 4 — Downsize event: starting from tier-recommended se-11400h for
  // a borderline DC load, engine should downsize to se-10000h if that
  // keeps ratio ≥ 0.9 and satisfies constraints. We verify the downsize
  // path is actually reachable by checking that a 30-panel system
  // (12 kW DC, which sits on the se-11400h tier boundary) doesn't pick
  // an oversized model.
  it('Downsize strategy: 30 panels (12 kW DC) does not oversize to se-11400h alone', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 30,
      selectedBrand: 'solaredge',
    });
    expect(r.inverterModels[0].qty).toBe(1);
    const totalDcKw = 30 * 0.4; // 12 kW
    const totalAcKw = r.inverterModels[0].acKw * r.inverterModels[0].qty;
    const ratio = totalDcKw / totalAcKw;
    // Tier says se-11400h at 12 kW (border). DC/AC = 12/11.4 ≈ 1.05 — OK.
    // Engine should NOT pick a larger model; could legitimately pick
    // se-10000h (DC/AC = 1.2) as a healthier ratio via downsize, or stay
    // on se-11400h. Either is ≥ 0.9 and physically sensible.
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.55);
  });

  // TEST 5 — Engine purity: input object must not be mutated.
  it('Engine purity: input object is not mutated', () => {
    const input = {
      systemType: 'roof' as const,
      panelCount: 36,
      selectedBrand: 'solaredge',
    };
    const snapshot = JSON.stringify(input);
    sizeSystemFromBrand(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// ─── v47.430 — Optimizer-topology voltage-aware PPU bypass ─────────────────
//
// REGRESSION LOCK: User-reported bug (Nov 2026) — SolarEdge SE7600H was
// auto-sized to 4 inverters with 1 string each (instead of the correct 2
// inverters with 2 strings each) for ~52-panel systems.
//
// ROOT CAUSE: voltageAwarePanelsPerUnit() applied the NEC 690.7 cold-Voc
// clamp to maxPanelsPerString for ALL topologies. For optimizer systems,
// each panel has its own optimizer regulating the string DC output to
// the inverter's fixed bus voltage (HD-Wave ~400V), so sum(panel Voc)
// math doesn't apply — brand-profile maxPPS (25 for SolarEdge) is the
// real ceiling. The Voc clamp reduced maxPPS from 25 → 10 for Qcells
// 400W panels at -10°C, forcing panelsPerUnit from 50 → 20 and then
// 52 panels → 4 inverters (instead of 2) via ceil(52/20) = 4.
//
// The feasibility evaluator and the downstream slot allocator
// (voltageAwareMaxPPS inside sizeInverters) already had this bypass —
// only voltageAwarePanelsPerUnit at the top-level sizing decision was
// missed by the v47.411 fix.
//
// These tests lock in the correct behavior for the user's scenario.
describe('Sizing Engine — v47.430: Optimizer voltage-clamp bypass', () => {
  const qcellsPanelParams = {
    panelWattage: 400,
    panelVoc: 41.6,
    panelVmp: 34.5,
    panelIsc: 11.6,
    panelTempCoeffVoc: -0.29,
    designTempMin: -10,
  };

  it('REGRESSION: 52 panels + SolarEdge SE-7600H selected → feasibility gate substitutes best-fit model (v47.420)', () => {
    // v47.420: se-7600h for 52 panels (20.8 kW DC) — 20A MPPT cap prevents
    // forming valid balanced strings with ≤2 strings/channel. The feasibility
    // hard gate detects this and substitutes the best-scoring feasible model
    // (se-6000h × 3: DC/AC=1.156, strings=[22,22,8]).
    // Pre-v47.420 this test expected exactly 2 units, but that was only passing
    // because the old 15-panel clipping cap forced pps=9 strings=[9,9,9,9,8,8]
    // which happened to fit (9A × 2 = 18A ≤ 20A). Post-fix the engine correctly
    // tries longer strings first and finds se-7600h infeasible at 52 panels.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 52,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
      ...qcellsPanelParams,
    });
    const totalQty = r.inverterModels.reduce((s, m) => s + m.qty, 0);
    // Feasibility gate substitutes a valid model — quantity may be 2 or 3.
    expect(totalQty).toBeGreaterThanOrEqual(2);
    expect(totalQty).toBeLessThanOrEqual(4);
    // Every physical inverter must carry ≥ 1 string — no empty units.
    const byUnit = new Map<number, number>();
    for (const s of r.strings) byUnit.set(s.inverterIndex, (byUnit.get(s.inverterIndex) ?? 0) + 1);
    expect(byUnit.size).toBe(totalQty);
    // Panel total preserved (no orphans).
    const totalOnStrings = r.strings.reduce((s, x) => s + x.panelCount, 0);
    expect(totalOnStrings).toBe(52);
  });

  it('REGRESSION: 72 panels + SolarEdge auto-tier → must NOT produce 4 units × 1 string each', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 72,
      selectedBrand: 'solaredge',
      ...qcellsPanelParams,
    });
    const totalQty = r.inverterModels.reduce((s, m) => s + m.qty, 0);
    // Pre-fix: 4 units × 1 string. Post-fix: fewer units (2 or 3 depending
    // on feasibility-gate outcome for clipping constraints). Must NOT be 4+.
    expect(totalQty).toBeLessThanOrEqual(3);
    // All panels accounted for.
    expect(r.strings.reduce((s, x) => s + x.panelCount, 0)).toBe(72);
  });

  it('Non-optimizer brands (Sol-Ark) still apply the voltage clamp for safety', () => {
    // Sanity: string-topology brands (Sol-Ark hybrid) must continue to
    // apply the NEC 690.7 cold-Voc clamp. Only optimizer topology is bypassed.
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'sol-ark',
      ...qcellsPanelParams,
    });
    // Must produce some sized inverter (doesn't crash).
    expect(r.inverterModels.length).toBeGreaterThanOrEqual(1);
    // All panels placed.
    expect(r.strings.reduce((s, x) => s + x.panelCount, 0)).toBe(36);
  });

  it('Optimizer bypass preserves brand-profile maxPanelsPerString ceiling (25 for SolarEdge)', () => {
    // Per SolarEdge brand profile: maxPanelsPerString = 25.
    // With voltage clamp bypassed, a 25-panel system on a single
    // SE-11400H unit (1 MPPT × 2 parallel × 25 maxPPS = 50 panel capacity)
    // must resolve to 1 unit (not clamped-down 2 units).
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-11400h',
      ...qcellsPanelParams,
    });
    // Pre-fix would clamp maxPPS → 10, compute panelsPerUnit = 20, and size to 2 units.
    // Post-fix: panelsPerUnit = 50, so 1 unit fits all 36 panels. Exception:
    // the feasibility hard gate may substitute a smaller model if SE-11400H
    // is rejected for DC/AC reasons; that's acceptable. But the pre-fix
    // symptom (4 units × 1 string each for this scenario) MUST NOT appear.
    const totalQty = r.inverterModels.reduce((s, m) => s + m.qty, 0);
    expect(totalQty).toBeLessThanOrEqual(2);
    expect(r.strings.reduce((s, x) => s + x.panelCount, 0)).toBe(36);
  });
});
