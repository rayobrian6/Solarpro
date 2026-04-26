// ============================================================================
// lib/system/fixEngine.test.ts — Phase 13.7
//
// Tests for the feasibility-driven Fix Engine.
//
// CONTRACT:
//   • When no model passes feasibility → success=false, reason present.
//   • When a valid model exists → success=true, appliedConfig present.
//   • Calling twice with identical params returns identical result (pure).
//   • success=true enables the caller to reset userHasEditedInverters.
//   • applyFeasibleFix() never mutates its input params object.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { applyFeasibleFix, type FixEngineParams } from './fixEngine';

// ─── Shared panel specs ─────────────────────────────────────────────────────

/**
 * A standard 400W panel with moderate Isc (12.2A).
 * On SolarEdge HD-Wave with 20 panels this is genuinely infeasible —
 * the single-input constraint means all strings enter one MPPT, and
 * stacking 2+ strings of 12.2A × 1.25 = 15.25A each quickly exceeds
 * the rated maxInputCurrentPerMppt on every HD-Wave model.
 */
const SE_INFEASIBLE_PANEL = {
  panelIsc: 12.2,
  panelTempCoeffVoc: -0.27,
  panelVoc: 45.39,
  panelVmp: 38.0,
  panelWattage: 400,
} as const;

/**
 * A lower-Isc panel (6.5A) that gives SolarEdge more breathing room
 * and is realistically feasible on a moderate panel count.
 */
const SE_FEASIBLE_PANEL = {
  panelIsc: 6.5,
  panelTempCoeffVoc: -0.27,
  panelVoc: 45.39,
  panelVmp: 38.0,
  panelWattage: 400,
} as const;

/**
 * Standard residential panel that is feasible on Fronius Primo
 * (2-MPPT, 18A per MPPT — much more headroom than SolarEdge 1-MPPT).
 */
const FRONIUS_FEASIBLE_PANEL = {
  panelIsc: 10.0,
  panelTempCoeffVoc: -0.29,
  panelVoc: 45.39,
  panelVmp: 38.0,
  panelWattage: 400,
} as const;

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('Phase 13.7 — applyFeasibleFix() fix engine', () => {

  // ── Test 1: Current failure case — returns success=false ────────────────
  // v47.411 revision: 20 panels x 12.2A Isc on SolarEdge USED to be infeasible
  // because the evaluator incorrectly used panel Isc x 1.25 (15.25A) for
  // optimizer topology. With topology-aware current (optimizer -> regulated
  // 15.0A cap), SolarEdge is now correctly feasible for that scenario.
  // This test now uses a tiny 3-panel system whose DC/AC ratio (1.2 kW DC
  // vs SE minimum 3.8 kW AC = 0.32) is below the 0.9 floor on every model.
  it('returns success=false when no valid configuration exists (tiny system, DC/AC out-of-band)', () => {
    const result = applyFeasibleFix({
      totalPanels: 3,                 // 1.2 kW DC -- far below SE minimum
      selectedBrand: 'solaredge',
      ...SE_INFEASIBLE_PANEL,
    });

    expect(result.success).toBe(false);
    expect(result.appliedConfig).toBeUndefined();
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
    expect(Array.isArray(result.rejectedDetails)).toBe(true);
    expect(result.rejectedDetails!.length).toBeGreaterThan(0);
  });

  // ── Test 2: Valid fix exists — returns success=true with appliedConfig ──
  it('returns success=true with a complete appliedConfig when a feasible system exists', () => {
    // 20 panels on Fronius Primo — 2 MPPT, generous 18A cap, easily feasible.
    const result = applyFeasibleFix({
      totalPanels: 20,
      selectedBrand: 'fronius',
      ...FRONIUS_FEASIBLE_PANEL,
    });

    expect(result.success).toBe(true);
    expect(result.appliedConfig).toBeDefined();

    const cfg = result.appliedConfig!;

    // inverterModel sanity checks
    expect(typeof cfg.inverterModel.equipmentDbId).toBe('string');
    expect(cfg.inverterModel.equipmentDbId.length).toBeGreaterThan(0);
    expect(cfg.inverterModel.qty).toBeGreaterThanOrEqual(1);
    expect(cfg.inverterModel.acKw).toBeGreaterThan(0);
    expect(cfg.inverterModel.dcAcRatio).toBeGreaterThan(0);

    // String plans sanity checks
    expect(Array.isArray(cfg.strings)).toBe(true);
    expect(cfg.strings.length).toBeGreaterThan(0);

    // totalPanels must match sum of all string.panelCount
    const panelSum = cfg.strings.reduce((s, str) => s + str.panelCount, 0);
    expect(panelSum).toBe(cfg.totalPanels);
    expect(cfg.totalPanels).toBe(20);

    // recommended and alternatives should be populated
    expect(result.recommended).toBeDefined();
    expect(Array.isArray(result.alternatives)).toBe(true);
  });

  // ── Test 3: No double-apply — calling twice returns same result ──────────
  it('is pure: identical params produce identical results on repeated calls', () => {
    const params: FixEngineParams = {
      totalPanels: 20,
      selectedBrand: 'fronius',
      ...FRONIUS_FEASIBLE_PANEL,
    };

    const r1 = applyFeasibleFix(params);
    const r2 = applyFeasibleFix(params);

    expect(r1.success).toBe(r2.success);
    expect(r1.appliedConfig?.inverterModel.equipmentDbId)
      .toBe(r2.appliedConfig?.inverterModel.equipmentDbId);
    expect(r1.appliedConfig?.inverterModel.qty)
      .toBe(r2.appliedConfig?.inverterModel.qty);
    expect(r1.appliedConfig?.strings.length)
      .toBe(r2.appliedConfig?.strings.length);
    expect(r1.appliedConfig?.totalPanels)
      .toBe(r2.appliedConfig?.totalPanels);
  });

  // ── Test 4: User intent lock reset — success=true signals unlock ─────────
  it('success=true enables the caller to reset userHasEditedInverters', () => {
    // This test verifies the contract: the caller checks fix.success before
    // clearing the user intent lock. If success=false the lock must NOT be
    // cleared. If success=true the lock CAN be cleared.
    // v47.411 revision: uses 3-panel system so DC/AC floor rejects every
    // SolarEdge model (previously relied on panel Isc x 1.25 exceeding the
    // MPPT cap, which no longer applies to optimizer topology).
    let userHasEditedInverters = true;

    const failResult = applyFeasibleFix({
      totalPanels: 3,
      selectedBrand: 'solaredge',
      ...SE_INFEASIBLE_PANEL,
    });
    if (failResult.success) {
      // Should NOT reach here
      userHasEditedInverters = false;
    }
    // Lock must remain engaged — fix failed
    expect(userHasEditedInverters).toBe(true);

    const successResult = applyFeasibleFix({
      totalPanels: 20,
      selectedBrand: 'fronius',
      ...FRONIUS_FEASIBLE_PANEL,
    });
    if (successResult.success) {
      // Caller resets lock on success
      userHasEditedInverters = false;
    }
    // Lock must be cleared after successful fix
    expect(userHasEditedInverters).toBe(false);
  });

  // ── Test 5: No mutation — input params are unchanged after call ──────────
  it('does not mutate the input params object', () => {
    const params: FixEngineParams = {
      totalPanels: 20,
      selectedBrand: 'fronius',
      panelIsc: 10.0,
      panelTempCoeffVoc: -0.29,
      panelVoc: 45.39,
      panelVmp: 38.0,
      panelWattage: 400,
    };

    // Deep-clone original values for comparison
    const original = { ...params };

    applyFeasibleFix(params);

    expect(params.totalPanels).toBe(original.totalPanels);
    expect(params.selectedBrand).toBe(original.selectedBrand);
    expect(params.panelIsc).toBe(original.panelIsc);
    expect(params.panelTempCoeffVoc).toBe(original.panelTempCoeffVoc);
    expect(params.panelVoc).toBe(original.panelVoc);
    expect(params.panelVmp).toBe(original.panelVmp);
    expect(params.panelWattage).toBe(original.panelWattage);
  });

});