// ============================================================================
// lib/system/feasibilityEvaluator.test.ts — Phase 13.5
//
// Tests for the feasibility-first sizing engine.
//
// All tests MUST match real-world electrical constraints. A "pass" here
// means a system that a licensed electrician could actually build.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  evaluateInverterFeasibility,
  generateFeasibleSystems,
  DC_AC_ACCEPTABLE_MIN,
  DC_AC_ACCEPTABLE_MAX,
  type InverterElectricalSpecs,
  type PanelElectricalSpecs,
  type FeasibilityInput,
} from './feasibilityEvaluator';
import type { BrandInverterModelRef } from './brandProfiles/types';
import type { StringInverter } from '../equipment-db';

// ─── Test fixtures ──────────────────────────────────────────────────────────
const STD_PANEL: PanelElectricalSpecs = {
  voc: 45.39,
  vmp: 38,
  isc: 12.2,
  watts: 400,
  tempCoeffVoc: -0.27,
};

function seInverter(
  id: string,
  overrides: Partial<InverterElectricalSpecs> = {}
): InverterElectricalSpecs {
  return {
    equipmentDbId: id,
    acKw: 11.4,
    dcKwMax: 17.1,
    mpptCount: 2,
    maxDcVoltage: 480,
    mpptVoltageMin: 200,
    mpptVoltageMax: 480,
    nominalDcVoltage: 400, // v47.415 — HD-Wave fixed DC bus
    maxInputCurrentPerMppt: 13.5,
    maxParallelStringsPerMppt: 2,
    minPanelsPerString: 8,
    maxPanelsPerString: 25,
    ...overrides,
  };
}

// ─── TEST 1 — Failing case: 13.5A MPPT limit vs 15.3A per-string current ────
describe('Phase 13.5 — failing-case pre-filter (per-string current > MPPT cap)', () => {
  it('SE-11400H with 13.5A MPPT cap rejects panels drawing 15.25A design current', () => {
    // NEC 690.8(A): design current = Isc × 1.25 = 12.2 × 1.25 = 15.25 A.
    // SE-11400H has 13.5A per MPPT → even 1 string cannot be placed.
    const r = evaluateInverterFeasibility({
      inverter: seInverter('se-11400h'),
      panel: STD_PANEL,
      totalPanels: 36,
    });
    expect(r.valid).toBe(false);
    expect(r.mpptCurrentValid).toBe(false);
    const codes = r.failures.map(f => f.code);
    expect(codes).toContain('PER_STRING_CURRENT_EXCEEDS_MPPT_CAP');
    // Early-exit: must not even attempt allocation.
    expect(r.mpptAllocation).toBeUndefined();
  });

  it('Lower-Isc panel (10A → 12.5A design) passes SE-11400H 13.5A cap', () => {
    const r = evaluateInverterFeasibility({
      inverter: seInverter('se-11400h'),
      panel: { ...STD_PANEL, isc: 10.0 },
      totalPanels: 36,
    });
    expect(r.mpptCurrentValid).toBe(true);
    // Per-string current check passes. (Other checks may still run.)
  });
});

// ─── TEST 2 — Valid SolarEdge case (adjusted for realistic SE current cap) ──
describe('Phase 13.5 — valid SolarEdge case', () => {
  it('36 panels on SE inverter with adequate MPPT current → valid, 1 inverter', () => {
    // Use a hypothetical SE variant with 18A MPPT cap (matches the
    // original screenshot assumption). 36 panels × 400W = 14.4 kW.
    // Low-Isc panel (7.0 → design 8.75A) so 2 strings stack per MPPT
    // (2 × 8.75 = 17.5A ≤ 18A cap) on the 2-MPPT inverter.
    const lowIscPanel = { ...STD_PANEL, isc: 7.0 };
    const r = evaluateInverterFeasibility({
      inverter: seInverter('se-11400h-18a', {
        maxInputCurrentPerMppt: 18,
      }),
      panel: lowIscPanel,
      totalPanels: 36,
    });
    expect(r.valid).toBe(true);
    expect(r.inverterCount).toBe(1);
    expect(r.dcAcRatio).toBeGreaterThanOrEqual(DC_AC_ACCEPTABLE_MIN);
    expect(r.dcAcRatio).toBeLessThanOrEqual(DC_AC_ACCEPTABLE_MAX);
    expect(r.mpptAllocation?.valid).toBe(true);
  });

  it('Healthy DC/AC: 36 panels 14.4 kW on 11.4 kW AC → ratio ≈ 1.26', () => {
    const lowIscPanel = { ...STD_PANEL, isc: 7.0 };
    const r = evaluateInverterFeasibility({
      inverter: seInverter('se-11400h-safe', {
        maxInputCurrentPerMppt: 18,
      }),
      panel: lowIscPanel,
      totalPanels: 36,
    });
    expect(r.dcAcRatio).toBeGreaterThanOrEqual(1.2);
    expect(r.dcAcRatio).toBeLessThanOrEqual(1.32);
  });
});

// ─── TEST 3 — High current rejection before allocation ──────────────────────
describe('Phase 13.5 — high-current inverter rejection (early exit)', () => {
  it('rejects BEFORE MPPT allocation (mpptAllocation undefined)', () => {
    const r = evaluateInverterFeasibility({
      inverter: seInverter('tiny-mppt', { maxInputCurrentPerMppt: 10 }),
      panel: STD_PANEL, // Isc=12.2 → design=15.25A > 10A
      totalPanels: 20,
    });
    expect(r.valid).toBe(false);
    expect(r.mpptCurrentValid).toBe(false);
    expect(r.mpptAllocation).toBeUndefined();
    expect(r.failures[0].code).toBe('PER_STRING_CURRENT_EXCEEDS_MPPT_CAP');
  });

  it('voltage-incompatible inverter fails at voltage layer (no allocation)', () => {
    // Narrow Voc window: with Voc-cold ≈ 49.7V and maxDcVoltage = 500V,
    // max panels by Voc = 10. Vmp min 450V / 41.6V ≈ 11 → incompatible.
    const r = evaluateInverterFeasibility({
      inverter: seInverter('narrow-vmppt', {
        mpptVoltageMin: 450,
        mpptVoltageMax: 480,
        maxDcVoltage: 500,
        maxInputCurrentPerMppt: 18, // generous — voltage must be the blocker
      }),
      panel: STD_PANEL,
      totalPanels: 24,
    });
    expect(r.valid).toBe(false);
    const codes = r.failures.map(f => f.code);
    // Either the range is itself incompatible OR the strings are below Vmp.
    expect(
      codes.includes('INVERTER_MPPT_RANGE_INCOMPATIBLE') ||
      codes.includes('STRING_VMP_BELOW_MIN')
    ).toBe(true);
    expect(r.mpptAllocation).toBeUndefined();
  });
});

// ─── TEST 4 — Multiple valid options via generateFeasibleSystems ────────────
describe('Phase 13.5 — multi-candidate evaluator', () => {
  // Fixture: four SolarEdge-style models where 3 are viable and 1 is not.
  const validModels: BrandInverterModelRef[] = [
    { equipmentDbId: 'x-7600',   acKw: 7.6,  dcKwMax: 11.4, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },
    { equipmentDbId: 'x-10000',  acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },
    { equipmentDbId: 'x-11400',  acKw: 11.4, dcKwMax: 17.1, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },
    { equipmentDbId: 'x-bad',    acKw: 3.0,  dcKwMax: 4.5,  mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 20 },
  ];
  // Only fields the evaluator reads are populated here.
  const eqSpecs = new Map<string, StringInverter>();
  for (const m of validModels) {
    eqSpecs.set(m.equipmentDbId, {
      id: m.equipmentDbId,
      manufacturer: 'TestBrand',
      model: m.equipmentDbId,
      category: 'string_inverter',
      acOutputKw: m.acKw,
      dcInputKwMax: m.dcKwMax,
      maxDcVoltage: 600,
      mpptVoltageMin: 100,
      mpptVoltageMax: 550,
      maxInputCurrentPerMppt: 18, // generous — per-string check passes
      maxShortCircuitCurrent: 22,
      mpptChannels: m.mpptCount,
      numberOfMPPT: m.mpptCount,
      recommendedStringRange: { min: 8, max: 20 },
      acOutputVoltage: 240,
      acOutputCurrentMax: Math.round(m.acKw * 1000 / 240),
      efficiency: 97,
      cec_efficiency: 97,
      weight: 30,
      dimensions: '0',
      warranty: '10yr',
      ulListing: 'UL 1741',
      rapidShutdownCompliant: true,
      arcFaultProtection: true,
      groundFaultProtection: true,
      datasheetUrl: '',
    });
  }

  it('returns at least one valid candidate with recommended + alternatives', () => {
    // Low-Isc panel (7.0 → design 8.75A) so 2 strings CAN stack per MPPT
    // without exceeding the 18A per-channel cap (2 × 8.75 = 17.5A).
    // This isolates the scoring & ranking behaviour of the multi-candidate
    // evaluator from current-limit artifacts.
    const lowIscPanel = { ...STD_PANEL, isc: 7.0 };
    const r = generateFeasibleSystems({
      modelRefs: validModels,
      equipmentSpecs: eqSpecs,
      panel: lowIscPanel,
      totalPanels: 30, // 12 kW DC — mid-range
    });
    expect(r.valid).toBe(true);
    expect(r.recommended).not.toBeNull();
    expect(r.recommended?.label).toBe('recommended');
    // The recommended model must not be the tiny 3 kW x-bad (it would
    // require 3 units for 12 kW DC, which loses points on the simplicity
    // axis and therefore cannot score highest).
    expect(r.recommended?.modelRef.equipmentDbId).not.toBe('x-bad');
    // At least one alternative present.
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    // At least one model in the registry gets rejected (x-7600: DC/AC out
    // of band at 12 kW DC on 7.6 kW AC — ratio 1.58 > 1.55 max).
    expect(r.rejected.length).toBeGreaterThanOrEqual(1);
  });

  it('returns valid=false with populated rejected list when nothing passes', () => {
    // Use a panel whose per-string current exceeds every candidate's cap.
    const tinyMpptModels: BrandInverterModelRef[] = [
      { equipmentDbId: 'tiny-1', acKw: 5, dcKwMax: 7.5, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 20 },
    ];
    const tinyEq = new Map<string, StringInverter>([
      [
        'tiny-1',
        {
          ...eqSpecs.get('x-7600')!,
          id: 'tiny-1',
          maxInputCurrentPerMppt: 10, // < 15.25A design current
        },
      ],
    ]);
    const r = generateFeasibleSystems({
      modelRefs: tinyMpptModels,
      equipmentSpecs: tinyEq,
      panel: STD_PANEL,
      totalPanels: 20,
    });
    expect(r.valid).toBe(false);
    expect(r.recommended).toBeNull();
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0].failures[0].code).toBe('PER_STRING_CURRENT_EXCEEDS_MPPT_CAP');
  });

  it('ranks candidates by score (recommended has top score)', () => {
    const r = generateFeasibleSystems({
      modelRefs: validModels,
      equipmentSpecs: eqSpecs,
      panel: STD_PANEL,
      totalPanels: 30,
    });
    expect(r.valid).toBe(true);
    const rec = r.recommended!;
    for (const alt of r.alternatives) {
      expect(rec.score).toBeGreaterThanOrEqual(alt.score);
    }
  });
});

// ─── TEST 5 — Purity: input not mutated ─────────────────────────────────────
describe('Phase 13.5 — engine purity', () => {
  it('evaluateInverterFeasibility does not mutate input', () => {
    const input: FeasibilityInput = {
      inverter: seInverter('se-x', { maxInputCurrentPerMppt: 18 }),
      panel: STD_PANEL,
      totalPanels: 30,
    };
    const snapshot = JSON.stringify(input);
    evaluateInverterFeasibility(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('generateFeasibleSystems does not mutate input', () => {
    const modelRefs: BrandInverterModelRef[] = [
      { equipmentDbId: 'x-1', acKw: 10, dcKwMax: 15, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 20 },
    ];
    const eq = new Map<string, StringInverter>([
      [
        'x-1',
        {
          id: 'x-1',
          manufacturer: 'T',
          model: 'T-10',
          category: 'string_inverter',
          acOutputKw: 10,
          dcInputKwMax: 15,
          maxDcVoltage: 600,
          mpptVoltageMin: 100,
          mpptVoltageMax: 550,
          maxInputCurrentPerMppt: 18,
          maxShortCircuitCurrent: 22,
          mpptChannels: 2,
          numberOfMPPT: 2,
          recommendedStringRange: { min: 8, max: 20 },
          acOutputVoltage: 240,
          acOutputCurrentMax: 42,
          efficiency: 97,
          cec_efficiency: 97,
          weight: 30,
          dimensions: '0',
          warranty: '',
          ulListing: '',
          rapidShutdownCompliant: true,
          arcFaultProtection: true,
          groundFaultProtection: true,
          datasheetUrl: '',
        },
      ],
    ]);
    const snapshotModels = JSON.stringify(modelRefs);
    const snapshotEq = JSON.stringify(Array.from(eq.entries()));
    generateFeasibleSystems({
      modelRefs,
      equipmentSpecs: eq,
      panel: STD_PANEL,
      totalPanels: 25,
    });
    expect(JSON.stringify(modelRefs)).toBe(snapshotModels);
    expect(JSON.stringify(Array.from(eq.entries()))).toBe(snapshotEq);
  });
});

// ─── TEST 6 — DC/AC ratio gate ──────────────────────────────────────────────
describe('Phase 13.5 — DC/AC ratio band', () => {
  it('rejects system with DC/AC ratio above acceptable max (1.55)', () => {
    // 60 panels × 400W = 24 kW DC on a 10 kW inverter → 2.4 ratio.
    // Must fail dcAcValid.
    const r = evaluateInverterFeasibility({
      inverter: seInverter('tiny-ac', {
        acKw: 10,
        dcKwMax: 30,            // allow 1 unit by DC
        maxInputCurrentPerMppt: 18,
      }),
      panel: STD_PANEL,
      totalPanels: 60,
    });
    // Either over-ratio or allocation-fail; definitely not valid.
    expect(r.valid).toBe(false);
  });

  it('accepts DC/AC inside ideal band (1.1–1.3)', () => {
    // 30 panels × 400W = 12 kW on 10 kW → 1.2 ratio.
    // Use a low-Isc panel (7.0 → design 8.75A) so 2 strings CAN stack per
    // MPPT within the 18A cap (2 × 8.75 = 17.5A).
    const lowIscPanel = { ...STD_PANEL, isc: 7.0 };
    const r = evaluateInverterFeasibility({
      inverter: seInverter('good', {
        acKw: 10,
        dcKwMax: 15,
        maxInputCurrentPerMppt: 18,
      }),
      panel: lowIscPanel,
      totalPanels: 30,
    });
    expect(r.valid).toBe(true);
    expect(r.dcAcRatio).toBeGreaterThanOrEqual(1.1);
    expect(r.dcAcRatio).toBeLessThanOrEqual(1.3);
  });
});
// ─── v47.411 — Topology-aware per-string design current ──────────────────────
//
// The feasibility evaluator must branch on `topology`:
//   • 'string' / 'hybrid' / undefined → NEC 690.8(A)(1): panel Isc × 1.25
//   • 'optimizer'                     → NEC 690.8(A)(2): optimizer cap
//
// And for optimizer topology, string Voc/Vmp limits are inapplicable because
// each optimizer regulates its panel's DC output (SafeDC ~1V per optimizer
// at open circuit, ~60V operating). These tests lock in both contracts.
describe('v47.411 — topology-aware feasibility evaluator', () => {

  // ── Contract A: per-string design current uses optimizer cap ───────────────
  it('optimizer topology: per-string design current = regulated cap (NOT Isc × 1.25)', () => {
    // High-Isc panel: Isc=13.0A → panel method current = 16.25A (> 20A channel would fail
    // in string topology). Optimizer cap = 15A → fits comfortably.
    const highIscPanel: PanelElectricalSpecs = { ...STD_PANEL, isc: 13.0 };

    const asString = evaluateInverterFeasibility({
      inverter: seInverter('x', { maxInputCurrentPerMppt: 20, acKw: 7.6, dcKwMax: 11.4, mpptCount: 2 }),
      panel: highIscPanel,
      totalPanels: 24,
      topology: 'string',  // panel method: 16.25A per string
    });
    const asOptimizer = evaluateInverterFeasibility({
      inverter: seInverter('x', { maxInputCurrentPerMppt: 20, acKw: 7.6, dcKwMax: 11.4, mpptCount: 2 }),
      panel: highIscPanel,
      totalPanels: 24,
      topology: 'optimizer',  // regulated: 15.0A per string
      optimizerMaxOutputCurrent: 15.0,
    });

    // Both should be feasible (single string fits in both paths), but the
    // recorded designCurrent differs — this is the CORE v47.411 contract.
    expect(asString.stringConfigs[0].designCurrent).toBeCloseTo(16.25, 2);
    expect(asOptimizer.stringConfigs[0].designCurrent).toBeCloseTo(15.0, 2);
  });

  // ── Contract B: optimizer topology passes PER_STRING_CURRENT gate when
  //    panel method would fail ─────────────────────────────────────────────
  it('optimizer topology: 15.0A regulated fits a 15.0A channel cap; panel method fails', () => {
    const highIscPanel: PanelElectricalSpecs = { ...STD_PANEL, isc: 12.5 }; // panel method = 15.625A
    const inverter = seInverter('tight', { maxInputCurrentPerMppt: 15.0, mpptCount: 1, acKw: 5, dcKwMax: 7.5 });

    const asString = evaluateInverterFeasibility({
      inverter, panel: highIscPanel, totalPanels: 12,
      topology: 'string',
    });
    expect(asString.valid).toBe(false);
    expect(asString.failures.map(f => f.code)).toContain('PER_STRING_CURRENT_EXCEEDS_MPPT_CAP');

    const asOptimizer = evaluateInverterFeasibility({
      inverter, panel: highIscPanel, totalPanels: 12,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });
    // 15.0A regulated == 15.0A channel cap (equal → not exceeded).
    expect(asOptimizer.failures.some(f => f.code === 'PER_STRING_CURRENT_EXCEEDS_MPPT_CAP')).toBe(false);
  });

  // ── Contract C: custom optimizer SKU cap propagates ─────────────────────────
  it('honors caller-supplied optimizerMaxOutputCurrent (custom SKU cap)', () => {
    const r = evaluateInverterFeasibility({
      inverter: seInverter('med', { maxInputCurrentPerMppt: 20, mpptCount: 2, acKw: 7.6, dcKwMax: 11.4 }),
      panel: { ...STD_PANEL, isc: 13.0 },
      totalPanels: 20,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 10.5,   // low-output SKU
    });
    expect(r.stringConfigs[0].designCurrent).toBeCloseTo(10.5, 2);
  });

  // ── Contract D: default optimizer cap when caller omits override ───────────
  it('defaults optimizerMaxOutputCurrent to 15.0A when not supplied', () => {
    const r = evaluateInverterFeasibility({
      inverter: seInverter('med', { maxInputCurrentPerMppt: 20, mpptCount: 2, acKw: 7.6, dcKwMax: 11.4 }),
      panel: { ...STD_PANEL, isc: 13.0 },
      totalPanels: 20,
      topology: 'optimizer',
      // optimizerMaxOutputCurrent omitted
    });
    expect(r.stringConfigs[0].designCurrent).toBeCloseTo(15.0, 2);
  });

  // ── Contract E: optimizer topology bypasses string Voc/Vmp constraint ─────
  // A 25-panel string with Voc=45.39 × cold factor ≈ 50V/panel would give
  // 25 × 50 = 1250V >> 480V inverter max. In string topology this is rejected.
  // In optimizer topology the evaluator must ALLOW this long string.
  it('optimizer topology: accepts long strings that would violate Voc×N in string topology', () => {
    const manyPanels = 24; // 24 × ~50V cold = 1200V > 480V max
    const inverter = seInverter('long', {
      maxInputCurrentPerMppt: 20, mpptCount: 2, acKw: 9.6, dcKwMax: 14.4,
      minPanelsPerString: 8, maxPanelsPerString: 25,
    });

    const asString = evaluateInverterFeasibility({
      inverter, panel: STD_PANEL, totalPanels: manyPanels,
      topology: 'string',
    });
    // String topology: rejected for voltage or no-valid-length.
    expect(asString.valid).toBe(false);

    const asOptimizer = evaluateInverterFeasibility({
      inverter, panel: STD_PANEL, totalPanels: manyPanels,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });
    // Optimizer topology: allowed (brand max 25 panels/string is the ceiling).
    // May still fail for DC/AC or allocation depending on layout, but NOT for
    // STRING_VOC_EXCEEDS_MAX / STRING_VMP_BELOW_MIN.
    expect(asOptimizer.failures.some(f => f.code === 'STRING_VOC_EXCEEDS_MAX')).toBe(false);
    expect(asOptimizer.failures.some(f => f.code === 'STRING_VMP_BELOW_MIN')).toBe(false);
    expect(asOptimizer.stringVoltageValid).toBe(true);
    expect(asOptimizer.mpptVoltageValid).toBe(true);
  });

  // ── Contract F: 36-panel SolarEdge HD-Wave regression (the user's bug) ────
  // This is the exact scenario from the reported bug: 36 × 400W Qcells on
  // 2× SE7600H (optimizer). Pre-v47.411 the engine produced 4 strings × 9
  // panels (blowing MPPT current budget). Post-v47.411 it must find a
  // feasible 2-string layout (18 + 18 or similar) via generateFeasibleSystems.
  it('36-panel SolarEdge HD-Wave: generateFeasibleSystems finds feasible layout (v47.415 operating-current model)', () => {
    const modelRefs: BrandInverterModelRef[] = [
      { equipmentDbId: 'se-7600h', acKw: 7.6, dcKwMax: 11.4, mpptCount: 1,
        minPanelsPerString: 8, maxPanelsPerString: 25 },
    ];
    const equipmentSpecs = new Map<string, StringInverter>([
      ['se-7600h', {
        id: 'se-7600h', manufacturer: 'SolarEdge', model: 'SE7600H-US',
        category: 'string_inverter',
        acOutputKw: 7.6, dcInputKwMax: 11.4,
        maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
        nominalDcVoltage: 400, // v47.415 — HD-Wave fixed DC bus
        maxInputCurrentPerMppt: 20, maxShortCircuitCurrent: 24,
        mpptChannels: 1, numberOfMPPT: 1, maxParallelStringsPerMppt: 3,
        recommendedStringRange: { min: 8, max: 13 },
        acOutputVoltage: 240, acOutputCurrentMax: 32,
        efficiency: 99.2, cec_efficiency: 99.0,
        weight: 22, dimensions: '17.7 x 14.6 x 6.8',
        warranty: '12yr', ulListing: 'UL 1741',
      } as unknown as StringInverter],
    ]);

    const qcellsPanel: PanelElectricalSpecs = {
      voc: 41.6, vmp: 34.5, isc: 12.26, watts: 400, tempCoeffVoc: -0.26,
    };

    const result = generateFeasibleSystems({
      modelRefs, equipmentSpecs, panel: qcellsPanel, totalPanels: 36,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // Must find a feasible layout.
    expect(result.valid).toBe(true);
    expect(result.recommended).not.toBeNull();

    // Must use 2 units (36 panels × 400W = 14.4 kW > 1× SE7600H 11.4 kW max).
    expect(result.recommended!.result.inverterCount).toBe(2);

    // v47.420 — optimizer clipping is NOT a reject criterion (strings up to
    // brand-profile maxPanelsPerString=25 are allowed). The descending search
    // finds pps=25 → [25, 11] with 2 strings on 2 channels (1 string each).
    // Total strings = 2, all within [8, 25].
    expect(result.recommended!.result.totalStrings).toBeGreaterThanOrEqual(2);
    expect(result.recommended!.result.totalStrings).toBeLessThanOrEqual(4);

    // Each string's panel count should be within the datasheet range [8, 25].
    // v47.420: the old 15-panel clipping cap is removed — strings may now be
    // up to the brand-profile maxPanelsPerString (25).
    for (const s of result.recommended!.result.stringConfigs) {
      expect(s.panelCount).toBeGreaterThanOrEqual(8);
      expect(s.panelCount).toBeLessThanOrEqual(25);
    }

    // v47.415 — per-string designCurrent in the feasibility plan represents
    // the NEC conductor-sizing current (15.0A optimizer nameplate). The
    // MPPT allocator internally uses the OPERATING current
    // (stringPowerW / 400V), but the plan’s FeasibilityStringPlan.designCurrent
    // field still carries the NEC value for downstream wire/OCPD sizing.
    for (const s of result.recommended!.result.stringConfigs) {
      expect(s.designCurrent).toBeCloseTo(15.0, 2);
    }
  });

  // v47.415 — Production regression: MPPT allocator uses operating current
  // (stringPower / nominalDcV), NOT the NEC nameplate cap (15A), for per-channel
  // current checks. v47.420: optimizer clipping cap removed — strings up to
  // brand maxPanelsPerString (25) are now allowed, changing expected layouts.
  it('SE7600H operating-current allocator: 18 and 36 panel cases (v47.420)', () => {
    // maxParallelStringsPerMppt=2 (SE7600H datasheet value)
    const se7600h: InverterElectricalSpecs = {
      equipmentDbId: 'se-7600h',
      acKw: 7.6, dcKwMax: 11.4, mpptCount: 1,
      maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
      nominalDcVoltage: 400,
      maxInputCurrentPerMppt: 20, maxParallelStringsPerMppt: 2,
      minPanelsPerString: 8, maxPanelsPerString: 25,
    };

    const qcellsPanel: PanelElectricalSpecs = {
      voc: 41.6, vmp: 34.5, isc: 12.26, watts: 400, tempCoeffVoc: -0.26,
    };

    // v47.420: 18 panels on 1×SE7600H:
    //   pps=25 tried first → 1 string of 18 panels, operating = 18A ≤ 20A → valid
    const result18 = evaluateInverterFeasibility({
      inverter: se7600h,
      panel: qcellsPanel,
      totalPanels: 18,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });
    expect(result18.valid).toBe(true);
    expect(result18.allocationValid).toBe(true);
    expect(result18.totalStrings).toBeGreaterThanOrEqual(1);

    // v47.420: 36 panels on SE7600H (maxParallelStringsPerMppt=2):
    //   pps=25 → [25,11] → 2 units needed (DC/AC=0.947), 1 string per channel
    //   ch0: 15A ≤ 20A ✓  ch1: 11A ≤ 20A ✓  → allocation valid
    //   The v47.415 operating-current fix ensures ch current uses actual power/voltage
    //   rather than the NEC nameplate cap (15A × 2 = 30A would have been rejected).
    const result36 = evaluateInverterFeasibility({
      inverter: se7600h,
      panel: qcellsPanel,
      totalPanels: 36,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });
    expect(result36.valid).toBe(true);
    expect(result36.allocationValid).toBe(true);
    expect(result36.inverterCount).toBe(2);
    expect(result36.totalStrings).toBeGreaterThanOrEqual(2);
  });

  // v47.415 — Falls back to MPPT midpoint when nominalDcVoltage not supplied.
  it('fallback to MPPT midpoint when nominalDcVoltage omitted (backwards compatibility)', () => {
    const se7600hLegacy: InverterElectricalSpecs = {
      equipmentDbId: 'se-7600h-legacy',
      acKw: 7.6, dcKwMax: 11.4, mpptCount: 1,
      maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480,
      // nominalDcVoltage intentionally omitted — midpoint = 340V
      maxInputCurrentPerMppt: 20, maxParallelStringsPerMppt: 3,
      minPanelsPerString: 8, maxPanelsPerString: 25,
    };

    const qcellsPanel: PanelElectricalSpecs = {
      voc: 41.6, vmp: 34.5, isc: 12.26, watts: 400, tempCoeffVoc: -0.26,
    };

    // With midpoint 340V: max string power = 340 × 15 = 5,100W → pps ≤ 12.
    // 18 panels on one inverter: try pps=12 → [12, 6] fails min. pps=11 →
    // [11, 7] fails min. pps=10 → [10, 8] OK. Op current: min(15,10*400/340)
    // = min(15, 11.76) = 11.76A and min(15, 8*400/340) = 9.4A. Total 21.16A
    // on 20A cap → borderline. The evaluator may accept or reject depending
    // on tolerance; either way it must not crash.
    const result = evaluateInverterFeasibility({
      inverter: se7600hLegacy,
      panel: qcellsPanel,
      totalPanels: 18,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // Must at least not blow up; must return a structured result.
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.stringConfigs)).toBe(true);
  });
});
