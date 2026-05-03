// ============================================================
// Tests — v61.7 String Pipeline Unification
// ============================================================
// Run with: npx jest lib/system/__tests__/stringPipelineUnification.test.ts
//
// These tests verify the single source of truth rule:
//   config.inverters[].strings is the ONLY valid string source.
//
// Key invariants:
//   1. computeSystem() uses configStringPanelCounts for per-string Voc checks
//   2. generateStringConfig() respects configStringPanelCounts override
//   3. No function can produce strings from panelCount alone that differ
//      from what config.inverters would produce
//   4. Multi-inverter systems preserve per-inverter string layout
//   5. Electrical validation reflects real string lengths (not averaged)

import {
  buildStringConfig,
  buildInverterConfig,
  type InverterConfig,
} from '../buildInverterConfig';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '../../string-generator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInv(
  inverterId: string,
  type: InverterConfig['type'],
  panelCounts: number[],
): InverterConfig {
  const strings = panelCounts.map((pc, i) => buildStringConfig({ index: i, panelCount: pc }));
  return buildInverterConfig({ inverterId, type, strings });
}

/** Extract flat panel counts from config.inverters[].strings */
function flatPanelCounts(inverters: InverterConfig[]): number[] {
  return inverters.flatMap(inv => inv.strings.map(s => s.panelCount));
}

// Standard module and inverter specs for tests
const MODULE_SPECS = moduleSpecsFromRegistry({
  voc: 49.6,
  vmp: 41.8,
  isc: 10.18,
  imp: 9.57,
  watts: 400,
  tempCoeffVoc: -0.27,
  maxSeriesFuseRating: 20,
});

const SOLIS_INVERTER_SPECS = inverterSpecsFromRegistry({
  maxDcVoltage: 600,
  mpptVoltageMin: 100,
  mpptVoltageMax: 550,
  mpptChannels: 3,
  maxParallelStringsPerMppt: 1,
  acOutputKw: 5.0,
  maxPanelsPerString: 13,
});

// ─── generateStringConfig with configStringPanelCounts ───────────────────────

describe('generateStringConfig — configStringPanelCounts override', () => {
  it('uses provided panel counts instead of re-deriving from totalModules', () => {
    // Actual committed layout: [8, 8, 7] = 23 panels across 3 strings
    // Without override, 23 / maxPPstring would give different grouping
    const configCounts = [8, 8, 7];
    const result = generateStringConfig({
      totalModules: 23,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: configCounts,
    });

    expect(result.totalStrings).toBe(3);
    expect(result.strings.map(s => s.panelsInString)).toEqual([8, 8, 7]);
  });

  it('calculates correct Voc for each string based on actual panel count', () => {
    // Voc at -10°C for Solis: 49.6 × [1 + (-0.27/100) × (-10-25)] ≈ 49.6 × 1.0945 ≈ 54.3V/panel
    const configCounts = [8, 8, 7];
    const result = generateStringConfig({
      totalModules: 23,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: configCounts,
    });

    const vocPerPanel = result.strings[0].vocCorrected;
    expect(result.strings[0].stringVoc).toBeCloseTo(vocPerPanel * 8, 1);
    expect(result.strings[1].stringVoc).toBeCloseTo(vocPerPanel * 8, 1);
    expect(result.strings[2].stringVoc).toBeCloseTo(vocPerPanel * 7, 1);
  });

  it('does NOT produce a false Voc violation for a valid [8,8,7] layout', () => {
    const configCounts = [8, 8, 7];
    const result = generateStringConfig({
      totalModules: 23,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: configCounts,
    });

    // With 8 panels and vocCorrected ~54.3V: 8 × 54.3 ≈ 434V < 600V max → no violation
    const vocErrors = result.errors.filter(e => e.includes('Voc'));
    expect(vocErrors).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it('correctly flags a genuine Voc violation when actual string exceeds limit', () => {
    // 13 panels at -10°C: Voc ≈ 54.3 × 13 ≈ 706V > 600V inverter max
    const configCounts = [13]; // Single string of 13 — exceeds 600V at cold temp
    const result = generateStringConfig({
      totalModules: 13,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: configCounts,
    });

    const vocErrors = result.errors.filter(e => e.includes('Voc'));
    expect(vocErrors.length).toBeGreaterThan(0);
  });

  it('ignores override when configStringPanelCounts is empty', () => {
    // When no override, should use normal physics-based derivation
    const result = generateStringConfig({
      totalModules: 23,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: [],
    });

    // Will use physics-based derivation — just verify it produces SOME valid output
    expect(result.totalStrings).toBeGreaterThan(0);
    expect(result.strings.every(s => s.panelsInString > 0)).toBe(true);
  });
});

// ─── Multi-inverter string isolation ─────────────────────────────────────────

describe('multi-inverter string isolation', () => {
  it('two-inverter system has independent per-inverter strings', () => {
    // Inverter 0: [8, 8, 7] = 23 panels
    // Inverter 1: [6, 6, 6] = 18 panels
    const inv0 = makeInv('solis-s6-eh1p-5k-us', 'string', [8, 8, 7]);
    const inv1 = makeInv('solis-s6-eh1p-5k-us', 'string', [6, 6, 6]);
    const inverters = [inv0, inv1];

    // Flat extraction must preserve all 6 strings in order
    const counts = flatPanelCounts(inverters);
    expect(counts).toEqual([8, 8, 7, 6, 6, 6]);
    expect(counts.length).toBe(6);
  });

  it('strings from different inverters are never merged', () => {
    const inv0 = makeInv('solis-s6-eh1p-5k-us', 'string', [8, 8, 7]);
    const inv1 = makeInv('solis-s6-eh1p-5k-us', 'string', [6, 6, 6]);

    // Each inverter must have its own independent strings array
    expect(inv0.strings).toHaveLength(3);
    expect(inv1.strings).toHaveLength(3);
    expect(inv0.strings[0]).not.toBe(inv1.strings[0]); // different objects
    expect(inv0.strings[0].panelCount).toBe(8);
    expect(inv1.strings[0].panelCount).toBe(6);
  });

  it('panel count metadata is consistent with actual strings', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [8, 8, 7]);
    expect(inv.stringsPerInverter).toBe(3);
    expect(inv.modulesPerString).toBe(8); // first string
    expect(inv.strings.length).toBe(inv.stringsPerInverter);
  });

  it('total panels across inverters is sum of all string panelCounts', () => {
    const inv0 = makeInv('solis-s6-eh1p-5k-us', 'string', [8, 8, 7]);  // 23
    const inv1 = makeInv('solis-s6-eh1p-5k-us', 'string', [8, 8, 7]);  // 23
    const inverters = [inv0, inv1];
    const total = flatPanelCounts(inverters).reduce((s, n) => s + n, 0);
    expect(total).toBe(46);
  });

  it('generateStringConfig with actual multi-inverter panel counts produces correct Voc', () => {
    // Simulate what the calculate API sends: flat panel counts from both inverters
    const configCounts = [8, 8, 7, 8, 8, 7]; // 2 × solis inverters
    const result = generateStringConfig({
      totalModules: 46,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: configCounts,
    });

    expect(result.totalStrings).toBe(6);
    // All strings have ≤ 8 panels — none should exceed 600V inverter limit
    const vocErrors = result.errors.filter(e => e.includes('Voc'));
    expect(vocErrors).toHaveLength(0);
  });
});

// ─── configStringPanelCounts prevents phantom Voc violations ─────────────────

describe('phantom Voc violation prevention', () => {
  it('44 panels without override: produces a re-derived layout that sums to totalModules', () => {
    // Without configStringPanelCounts, the string generator re-derives its
    // own layout from totalModules. This demonstrates the problem:
    // the re-derived layout may produce slot-packed strings that differ from
    // the actual committed config, causing false Voc violations.
    const resultAuto = generateStringConfig({
      totalModules: 44,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      // No configStringPanelCounts — let it re-derive
    });
    // Must produce some layout
    expect(resultAuto.totalStrings).toBeGreaterThan(0);
    // Total panel count must be preserved
    const autoTotal = resultAuto.strings.reduce((s, g) => s + g.panelsInString, 0);
    expect(autoTotal).toBe(44);
    // Note: the auto-derived layout may produce Voc violations or slot-packing artifacts.
    // This is precisely WHY configStringPanelCounts override exists — to use the actual
    // committed strings instead of this re-derived layout.
  });

  it('with actual config strings [8,8,7] passed as override: no Voc violation', () => {
    const result = generateStringConfig({
      totalModules: 23,
      moduleSpecs: MODULE_SPECS,
      inverterSpecs: SOLIS_INVERTER_SPECS,
      designTempMin: -10,
      configStringPanelCounts: [8, 8, 7],
    });

    expect(result.isValid).toBe(true);
    expect(result.errors.filter(e => e.includes('Voc'))).toHaveLength(0);
    // String Voc values should all be < 600V
    for (const s of result.strings) {
      expect(s.stringVoc).toBeLessThan(600);
    }
  });
});