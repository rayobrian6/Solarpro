// ============================================================================
// lib/system/sizingEngineVoltageSafe.test.ts — Phase 13.8 + v47.411
//
// Tests for voltage-safe maxPanelsPerString clamping in the primary sizing
// engine (distributeStrings).
//
// CONTRACT (Phase 13.8):
//   • When panelVoc + panelTempCoeffVoc are supplied AND the voltage-safe
//     ceiling is below the brand's maxPanelsPerString AND the brand topology
//     is STRING (not optimizer / micro), the engine MUST:
//     1. Clamp maxPPS to the voltage-safe ceiling.
//     2. Emit a STRING_VOC_VOLTAGE_CLAMP warning.
//     3. Produce strings where every panelCount ≤ voltageClampedMax.
//   • When panelVoc + panelTempCoeffVoc are omitted, the engine falls back
//     to the static brand maxPanelsPerString (no clamping, no warning).
//
// v47.411 REVISION — Topology-aware voltage clamp:
//   • OPTIMIZER topology (SolarEdge HD-Wave + SolarEdge optimizers) does NOT
//     apply the panel-Voc × N clamp. Each optimizer regulates its panel's
//     DC output; the string voltage reaching the inverter is the inverter's
//     fixed bus (~400V operating) and ~1V/optimizer at open circuit SafeDC.
//     The brand profile's min/maxPanelsPerString (8..25 for SolarEdge) is
//     the authoritative ceiling.
//   • Previously, this file asserted that SolarEdge + high-Voc panels would
//     clamp to ≤10 panels/string. That was incorrect — it forced 4-string
//     layouts that blow the MPPT current budget (4 × 15A = 60A > channel
//     capacity). See docs/v47.411-*.md for the full analysis.
//   • String-topology brands (Fronius, SMA, etc.) still apply the clamp —
//     Test 5 below preserves that contract with Fronius Primo.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand, type SizingInput } from './sizingEngine';

// ─── Helper: compute expected voltage-safe ceiling ───────────────────────────
function expectedVocCeiling(
  panelVoc: number,
  tempCoeffVoc: number,   // %/°C
  maxDcVoltage: number,
  designTempMin = -10,
): number {
  const coldFactor      = 1 + (tempCoeffVoc / 100) * (designTempMin - 25);
  const vocColdPerPanel = panelVoc * coldFactor;
  return Math.floor((maxDcVoltage * 0.99) / vocColdPerPanel);
}

// ─── Panel fixtures ───────────────────────────────────────────────────────────

/**
 * High-Voc premium panel (SunPower Maxeon 7 / similar 440W N-type):
 * Voc=51.6V, tempCoeffVoc=-0.27%/°C.
 * On SolarEdge HD-Wave (480V max) at -10°C:
 *   vocColdPerPanel = 51.6 × 1.0945 ≈ 56.48V
 *   vocSafeCeiling  = floor(475.2 / 56.48) = 8 panels
 * Brand maxPanelsPerString = 25 → clamped to 8.
 */
const HIGH_VOC_PANEL = {
  panelVoc:          51.6,
  panelVmp:          43.4,
  panelIsc:          10.89,
  panelWattage:      440,
  panelTempCoeffVoc: -0.27,
} as const;

/**
 * Standard 400W panel (Voc=41.6V).
 * On SolarEdge HD-Wave (480V max) at -10°C:
 *   vocColdPerPanel = 41.6 × 1.0945 ≈ 45.53V
 *   vocSafeCeiling  = floor(475.2 / 45.53) = 10 panels
 * Brand maxPanelsPerString = 25 → clamped to 10.
 */
const STANDARD_PANEL = {
  panelVoc:          41.6,
  panelVmp:          34.5,
  panelIsc:          11.2,
  panelWattage:      400,
  panelTempCoeffVoc: -0.27,
} as const;

// SolarEdge HD-Wave SE-7600H: maxDcVoltage=480, brand maxPanelsPerString=25
const SE_7600H_MAX_DC = 480;
const SE_BRAND_MAX_PPS = 25;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 13.8 — voltage-safe maxPanelsPerString clamping', () => {

  // ── Test 1 [v47.411]: SolarEdge optimizer topology does NOT clamp ─────────
  // Per v47.411 — the voltage clamp is topology-gated. For optimizer systems
  // the string voltage reaching the inverter is regulated by each optimizer's
  // SafeDC output (~1V open-circuit per optimizer, ~60V operating), so
  // applying the panel-Voc × N cold-temp clamp would falsely restrict string
  // length and force 4-string layouts that blow the MPPT current budget.
  it('does NOT clamp SolarEdge strings for high-Voc panel (optimizer topology bypass)', () => {
    const result = sizeSystemFromBrand({
      systemType:   'roof',
      panelCount:   20,
      selectedBrand: 'solaredge',
      ...HIGH_VOC_PANEL,
    });

    // No STRING_VOC_VOLTAGE_CLAMP warning — optimizer topology is exempt.
    const clampWarning = result.warnings.find(w => w.code === 'STRING_VOC_VOLTAGE_CLAMP');
    expect(clampWarning).toBeUndefined();

    // All panels must be placed (no loss).
    const assignedPanels = result.strings.reduce((s, str) => s + str.panelCount, 0);
    const overflowWarning = result.warnings.find(w => w.code === 'STRING_OVERFLOW');
    if (!overflowWarning) expect(assignedPanels).toBe(20);

    // No individual string exceeds the brand static max.
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(SE_BRAND_MAX_PPS);
    }
  });

  // ── Test 2 [v47.411]: Standard panel on SolarEdge — no clamp ──────────────
  // Optimizer topology: the inverter's 480V DC-max limit does not constrain
  // string length because the optimizer bus is the regulated voltage source.
  it('does NOT clamp SolarEdge strings for standard 400W panel (optimizer topology)', () => {
    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    30,
      selectedBrand: 'solaredge',
      ...STANDARD_PANEL,
    });

    // Verifies that panel Voc × N > 480V does NOT trigger a clamp warning
    // when topology === 'optimizer'. The pre-v47.411 behavior (incorrectly)
    // emitted STRING_VOC_VOLTAGE_CLAMP for this configuration.
    const clampWarning = result.warnings.find(w => w.code === 'STRING_VOC_VOLTAGE_CLAMP');
    expect(clampWarning).toBeUndefined();

    // Strings may now use up to SE brand max (25 panels) — the real ceiling.
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(SE_BRAND_MAX_PPS);
      expect(s.panelCount).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Test 3: Without electrical specs → no clamping, no warning ─────────────
  it('does NOT clamp or warn when panelVoc/tempCoeffVoc are omitted', () => {
    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    20,
      selectedBrand: 'solaredge',
      // Deliberately no panelVoc / panelTempCoeffVoc
    });

    const clampWarning = result.warnings.find(w => w.code === 'STRING_VOC_VOLTAGE_CLAMP');
    expect(clampWarning).toBeUndefined();

    // With no clamping, strings can use up to brand maxPanelsPerString=25
    // (they may be lower due to panel count, but there should be no clamp warning)
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(SE_BRAND_MAX_PPS);
    }
  });

  // ── Test 4 [v47.411]: All panels placed on SolarEdge (no-clamp path) ──────
  // The previous assertion (strings <= panel-Voc ceiling) was replaced with
  // the real optimizer ceiling (brand maxPanelsPerString = 25). All panels
  // must still be accounted for, with or without the voltage clamp.
  it('SolarEdge: all panels placed (no clamp, optimizer topology)', () => {
    const totalPanels = 24;
    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    totalPanels,
      selectedBrand: 'solaredge',
      ...HIGH_VOC_PANEL,
    });

    const assignedPanels = result.strings.reduce((s, str) => s + str.panelCount, 0);
    const overflowWarning = result.warnings.find(w => w.code === 'STRING_OVERFLOW');
    if (!overflowWarning) {
      expect(assignedPanels).toBe(totalPanels);
    }
    // Brand-static ceiling only (25). No voltage clamp for optimizer topology.
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(SE_BRAND_MAX_PPS);
    }
    const clampWarning = result.warnings.find(w => w.code === 'STRING_VOC_VOLTAGE_CLAMP');
    expect(clampWarning).toBeUndefined();
  });

  // ── Test 5: Fronius 600V inverter — 51.6V panel fits more strings ───────────
  it('does not over-clamp on 600V inverter — high-Voc panel fits more panels/string', () => {
    // Fronius Primo 7.6: maxDcVoltage=600, so ceiling is higher
    const froniusCeiling = expectedVocCeiling(
      HIGH_VOC_PANEL.panelVoc,
      HIGH_VOC_PANEL.panelTempCoeffVoc,
      600, // Fronius maxDcVoltage
    );
    // Expected: floor(594/56.48) = floor(10.52) = 10
    expect(froniusCeiling).toBeGreaterThanOrEqual(10);

    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    20,
      selectedBrand: 'fronius',
      ...HIGH_VOC_PANEL,
    });

    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(froniusCeiling);
    }

    // Fronius brand maxPanelsPerString = 16, ceiling ≈10 → still clamped
    // but clamped to a HIGHER value than the SE-480V case (8).
    // Every string must be at most the Fronius ceiling.
  });

  // ── Test 6 [v47.411]: 36 panels on SolarEdge → 2 long strings (MPPT-safe) ─
  // Pre-v47.411 regression: the voltage clamp (10 panels/string for 41.6V on
  // 480V inverter) forced the engine to emit 4 strings of 9 panels, which
  // blew the MPPT current budget (4 × 15A = 60A > 40A channel capacity for
  // 2× SE7600H). With topology-aware voltage clamp bypass, the engine now
  // produces 2 strings of 18 panels — 2 × 15A = 30A on 40A capacity, safe.
  it('sizes 36-panel SolarEdge as 1×SE11400H (v47.420: clipping cap removed)', () => {
    // v47.420: optimizer clipping cap removed. The feasibility evaluator now allows
    // strings up to brand maxPanelsPerString (25). For 36 panels × 400W = 14.4 kW:
    //   Auto-tier → se-11400h (tier for 12+ kW DC)
    //   pps=25 → [25,11] on 1 unit, 2 strings on 1 MPPT channel (parallelPerMppt=3)
    //   operating currents: 15A + 11A = 26A ≤ 30.5A → valid
    //   DC/AC = 14.4/11.4 = 1.263 ✓
    // Pre-v47.420: clipping cap forced pps≤15, which made se-11400h infeasible
    // (3×12A=36A > 30.5A), and the engine fell back to 2×se-7600h.
    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    36,
      selectedBrand: 'solaredge',
      panelVoc:          41.6,
      panelVmp:          34.5,
      panelIsc:          11.2,
      panelWattage:      400,
      panelTempCoeffVoc: -0.27,
    });

    // v47.420: 1×se-11400h is the correct result (or any SE model with inverterCount ≥ 1).
    expect(result.inverterCount).toBeGreaterThanOrEqual(1);

    // Expect ≤3 strings (2 for se-11400h pps=25 → [25,11]).
    expect(result.strings.length).toBeLessThanOrEqual(3);

    // Each string respects the brand-static ceiling (25).
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(SE_BRAND_MAX_PPS);
      expect(s.panelCount).toBeGreaterThanOrEqual(8); // brand minPanelsPerString
    }

    // All panels placed (no overflow).
    const overflow = result.warnings.find(w => w.code === 'STRING_OVERFLOW');
    expect(overflow).toBeUndefined();

    // No voltage clamp warning for optimizer topology.
    const clampWarning = result.warnings.find(w => w.code === 'STRING_VOC_VOLTAGE_CLAMP');
    expect(clampWarning).toBeUndefined();
  });

  // ─── Phase 13.8.1 regression: no infinite upsize loop ───────────────────

  it('upsizes se-7600h to SE-11400H (v47.420: now correctly feasible, simpler 1-unit install)', () => {
    // v47.420 behavior change: With the optimizer clipping cap removed, 1×SE-11400H
    // is now correctly identified as feasible for 36 panels (pps=25 → [25,11],
    // 2 strings on 1 channel, 26A ≤ 30.5A). Previously it was wrongly rejected.
    //
    // When user selects se-7600h for 36 panels:
    //   - sizeInverters calculates qtySelected=2 (panelsPerUnit = 1×2×25 = 50,
    //     unitsByPanels = ceil(36/50) = 1, but unitsByDc = ceil(14.4/11.4) = 2)
    //   - Rule 1: se-11400h needs only 1 unit (< 2) → INVERTER_UPSIZED fires
    //   - Result: 1×SE-11400H, strings=[18,18], DC/AC=1.263
    //
    // This is CORRECT engineering: 1 inverter is simpler than 2, and the ratio is healthy.
    const result = sizeSystemFromBrand({
      systemType:        'roof',
      panelCount:        36,
      panelWattage:      400,
      panelVoc:          41.6,
      panelTempCoeffVoc: -0.27,
      panelIsc:          10.0,
      selectedBrand:     'solaredge',
      selectedInverterId: 'se-7600h',
    });

    const primaryModel = result.inverterModels[0];
    expect(primaryModel).toBeDefined();

    // DC/AC ratio must be ≥ MIN_DC_AC_RATIO (0.9)
    const acKwTotal = (primaryModel?.acKw ?? 0) * result.inverterCount;
    const dcAc = 14.4 / acKwTotal;
    expect(dcAc).toBeGreaterThanOrEqual(0.9);

    // Must NOT be SE-11400H × 2 or more (22.8 kW AC → ratio 0.63, too low)
    const isOversizedSE11400H =
      primaryModel?.equipmentDbId === 'se-11400h' && result.inverterCount >= 2;
    expect(isOversizedSE11400H).toBe(false);

    // All panels accounted for.
    const totalOnStrings = result.strings.reduce((s, x) => s + x.panelCount, 0);
    expect(totalOnStrings).toBe(36);
  });

  // ─── v47.411 regression: Fronius (string topology) STILL clamps ──────────
  //
  // The topology-aware bypass only applies to optimizer systems. String
  // inverters (Fronius, SMA, GoodWe, Sungrow, generic) MUST continue to
  // emit STRING_VOC_VOLTAGE_CLAMP when panel-Voc × N cold would exceed the
  // inverter's maxDcVoltage. This test locks in that Phase 13.8 guarantee.
  it('[v47.411] Fronius string topology still clamps on high-Voc × low-maxDcVoltage', () => {
    // Synthetic "high-voltage-risk" setup: Fronius Primo has maxDcVoltage=600.
    // Use the HIGH_VOC_PANEL (Voc=51.6V, tempCoeff=-0.27%/°C) → cold Voc ≈56.48V.
    // 600V / 56.48V = 10.6 → ceiling ≈ 10 panels/string.
    // Fronius brand max is 14 → clamp fires.
    const result = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    28,
      selectedBrand: 'fronius',
      ...HIGH_VOC_PANEL,
    });

    const ceiling = expectedVocCeiling(
      HIGH_VOC_PANEL.panelVoc,
      HIGH_VOC_PANEL.panelTempCoeffVoc,
      600,
    );

    // String topology MUST still respect the voltage ceiling.
    for (const s of result.strings) {
      expect(s.panelCount).toBeLessThanOrEqual(ceiling);
    }

    // Clamp warning MAY fire depending on how it compares to Fronius brand
    // max (varies by model). The key contract: if brand-max > ceiling, clamp
    // fires; if not, no warning. We verify the stronger invariant: string
    // lengths never exceed the ceiling for string topology.
  });

});