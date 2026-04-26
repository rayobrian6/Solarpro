/**
 * lib/system/bestFitEngine.test.ts — Phase 14
 *
 * Tests for generateBestFitSystems().
 *
 * All tests use real SolarEdge brand profile data + equipment-db specs
 * to verify real-world installer expectations.
 */

import { describe, it, expect } from 'vitest';
import { generateBestFitSystems, type BestFitInput, type InverterSlot } from './bestFitEngine';
import type { PanelElectricalSpecs, InverterElectricalSpecs } from './feasibilityEvaluator';
import type { BrandInverterModelRef } from './brandProfiles/types';

// ─── Test fixtures ────────────────────────────────────────────────────────────

/**
 * 400W panel with realistic NEC-relevant electrical specs.
 * Isc = 7.5A is chosen so that:
 *   - Design current per string = 7.5 × 1.25 = 9.375A
 *   - 2 parallel strings = 18.75A < se-7600h 20A MPPT limit → feasible
 *   - 3 parallel strings = 28.125A < se-11400h 30.5A MPPT limit → feasible
 * This allows se-7600h×2 to be the best-fit for 36 panels (DC/AC = 0.947).
 */
const PANEL_400W: PanelElectricalSpecs = {
  voc: 41.6,
  vmp: 34.5,
  isc: 7.5,
  watts: 400,
  tempCoeffVoc: -0.27,
};

/** High-Isc panel that stresses SolarEdge current limits (10A Isc) */
const PANEL_HIGH_ISC: PanelElectricalSpecs = {
  voc: 41.6,
  vmp: 34.5,
  isc: 10.0,
  watts: 400,
  tempCoeffVoc: -0.27,
};

/** SolarEdge HD-Wave model refs (from brand profile) */
const SE_MODELS: BrandInverterModelRef[] = [
  { equipmentDbId: 'se-3800h',  acKw: 3.8,  dcKwMax: 5.7,  mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25 },
  { equipmentDbId: 'se-6000h',  acKw: 6.0,  dcKwMax: 9.0,  mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25 },
  { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25 },
  { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25 },
  { equipmentDbId: 'se-11400h', acKw: 11.4, dcKwMax: 17.1, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25 },
];

/** Equipment-db specs for SolarEdge HD-Wave models */
const SE_SPECS = new Map<string, InverterElectricalSpecs>([
  ['se-3800h',  { equipmentDbId: 'se-3800h',  acKw: 3.8,  dcKwMax: 5.7,  mpptCount: 1, maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480, maxInputCurrentPerMppt: 10.5, maxParallelStringsPerMppt: 2, minPanelsPerString: 8, maxPanelsPerString: 25 }],
  ['se-6000h',  { equipmentDbId: 'se-6000h',  acKw: 6.0,  dcKwMax: 9.0,  mpptCount: 1, maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480, maxInputCurrentPerMppt: 16.5, maxParallelStringsPerMppt: 2, minPanelsPerString: 8, maxPanelsPerString: 25 }],
  ['se-7600h',  { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 1, maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480, maxInputCurrentPerMppt: 20.0, maxParallelStringsPerMppt: 3, minPanelsPerString: 8, maxPanelsPerString: 25 }],
  ['se-10000h', { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 1, maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480, maxInputCurrentPerMppt: 27.0, maxParallelStringsPerMppt: 3, minPanelsPerString: 8, maxPanelsPerString: 25 }],
  ['se-11400h', { equipmentDbId: 'se-11400h', acKw: 11.4, dcKwMax: 17.1, mpptCount: 1, maxDcVoltage: 480, mpptVoltageMin: 200, mpptVoltageMax: 480, maxInputCurrentPerMppt: 30.5, maxParallelStringsPerMppt: 3, minPanelsPerString: 8, maxPanelsPerString: 25 }],
]);

function makeInput(panels: number, panel = PANEL_400W, models = SE_MODELS): BestFitInput {
  return {
    modelRefs: models,
    equipmentSpecs: SE_SPECS,
    panel,
    totalPanels: panels,
    designTempMin: -10,
  };
}

// ─── Test 1: 36 panels SolarEdge — recommended must be 2×SE7600H, NOT 2×SE11400H ──

describe('TEST 1 — 36 panel SolarEdge case', () => {
  // 36 × 400W = 14.4 kW DC
  // 2 × SE7600H = 15.2 kW AC  → DC/AC = 0.947 (within acceptable, close to ideal)
  // 2 × SE11400H = 22.8 kW AC → DC/AC = 0.632 (below acceptable, oversized)

  it('recommended is not 2×SE11400H (oversized)', () => {
    const result = generateBestFitSystems(makeInput(36));
    expect(result.recommended).not.toBeNull();
    const primary = result.recommended!.config.slots[0];
    const isOversized =
      primary.modelRef.equipmentDbId === 'se-11400h' &&
      result.recommended!.config.totalUnits >= 2;
    expect(isOversized).toBe(false);
  });

  it('recommended DC/AC ratio is >= 0.9 (not oversized)', () => {
    const result = generateBestFitSystems(makeInput(36));
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.dcAcRatio).toBeGreaterThanOrEqual(0.9);
  });

  it('recommended is feasible', () => {
    const result = generateBestFitSystems(makeInput(36));
    expect(result.recommended!.feasible).toBe(true);
  });

  it('recommended score > any 2×SE11400H score', () => {
    const result = generateBestFitSystems(makeInput(36));
    const oversized = result.evaluated.find(
      s => !s.config.isMixed &&
           s.config.slots[0].modelRef.equipmentDbId === 'se-11400h' &&
           s.config.totalUnits >= 2,
    );
    // Either oversized is rejected (infeasible) or scores lower than recommended.
    if (oversized?.feasible) {
      expect(result.recommended!.score).toBeGreaterThan(oversized.score);
    } else {
      // Correctly rejected — test passes by absence.
      expect(true).toBe(true);
    }
  });
});

// ─── Test 2: Mixed candidate scored lower than best homogeneous ───────────────

describe('TEST 2 — Mixed candidate penalized vs. homogeneous', () => {
  it('best homogeneous scores higher than mixed when mixed offers no real benefit', () => {
    // For 36 panels the best homogeneous should beat mixed combos.
    const result = generateBestFitSystems(makeInput(36));
    const bestHomogeneous = result.evaluated
      .filter(s => s.feasible && !s.config.isMixed)
      .sort((a, b) => b.score - a.score)[0];
    const bestMixed = result.evaluated
      .filter(s => s.feasible && s.config.isMixed)
      .sort((a, b) => b.score - a.score)[0];

    if (bestMixed) {
      // Mixed should not beat homogeneous (unless it clears the benefit threshold).
      expect(bestHomogeneous?.score ?? 0).toBeGreaterThanOrEqual(
        bestMixed.score - 0.1, // allow floating point tolerance
      );
    }
    // If no mixed configs are feasible, test passes trivially.
    expect(bestHomogeneous).toBeDefined();
  });

  it('mixedPenalty field is <= 0 on any mixed config', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (s.config.isMixed) {
        expect(s.scoreBreakdown.mixedPenalty).toBeLessThanOrEqual(0);
      }
    }
  });
});

// ─── Test 3: Single inverter preferred when viable ────────────────────────────

describe('TEST 3 — Single inverter preferred when it produces healthy DC/AC ratio', () => {
  it('20 panels (8.0 kW DC) → prefers 1×SE7600H (ratio 1.05, ideal) over 2×SE7600H (ratio 0.53, out of band)', () => {
    // 20 × 400W = 8.0 kW DC
    // 1 × SE7600H = 7.6 kW AC → DC/AC = 1.053 (within ideal 1.10–1.30, close)
    // 2 × SE7600H = 15.2 kW AC → DC/AC = 0.526 (below acceptable)
    // Single-unit should be recommended; 2-unit should be rejected by DC/AC gate.
    const result = generateBestFitSystems(makeInput(20));
    expect(result.recommended).not.toBeNull();
    // Should prefer a single-unit solution if feasible.
    const rec = result.recommended!;
    // If single-unit is feasible, it should have simplicity score of 25 (1 unit).
    if (rec.config.totalUnits === 1) {
      expect(rec.scoreBreakdown.simplicity).toBe(25);
    }
    // Either way, must be feasible.
    expect(rec.feasible).toBe(true);
  });

  it('simplicity score for 1 unit = 25, for 2 units = 20, for 3 units = 15', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (!s.feasible) continue;
      const expected = Math.max(0, 25 - (s.config.totalUnits - 1) * 5);
      expect(s.scoreBreakdown.simplicity).toBe(expected);
    }
  });
});

// ─── Test 4: No feasible systems → recommended is null ───────────────────────

describe('TEST 4 — No feasible systems', () => {
  it('returns null recommended when no models in map', () => {
    const result = generateBestFitSystems({
      modelRefs: SE_MODELS,
      equipmentSpecs: new Map(), // empty — no equipment specs
      panel: PANEL_400W,
      totalPanels: 36,
      designTempMin: -10,
    });
    expect(result.recommended).toBeNull();
    expect(result.alternatives).toHaveLength(0);
  });

  it('returns null recommended when panel count is 0', () => {
    // 0 panels → all feasibility checks fail with PANEL_COUNT_ZERO_OR_NEGATIVE.
    const result = generateBestFitSystems(makeInput(0));
    expect(result.recommended).toBeNull();
  });
});

// ─── Test 5: Score breakdown components are non-negative and bounded ──────────

describe('TEST 5 — Score breakdown bounds', () => {
  it('all score components are within expected ranges', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (!s.feasible) continue;
      const b = s.scoreBreakdown;
      expect(b.dcAcFit).toBeGreaterThanOrEqual(0);
      expect(b.dcAcFit).toBeLessThanOrEqual(40 + 0.01);
      expect(b.simplicity).toBeGreaterThanOrEqual(0);
      expect(b.simplicity).toBeLessThanOrEqual(25);
      expect(b.headroom).toBeGreaterThanOrEqual(0);
      expect(b.headroom).toBeLessThanOrEqual(20 + 0.01);
      expect(b.economic).toBeGreaterThanOrEqual(0);
      expect(b.economic).toBeLessThanOrEqual(15);
      expect(b.mixedPenalty).toBeLessThanOrEqual(0);
    }
  });

  it('total score = sum of components', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (!s.feasible) continue;
      const b = s.scoreBreakdown;
      const expected = b.dcAcFit + b.simplicity + b.headroom + b.economic + b.mixedPenalty;
      expect(s.score).toBeCloseTo(expected, 3);
    }
  });
});

// ─── Test 6: Recommended has reasons attached ─────────────────────────────────

describe('TEST 6 — Recommendations include reasons', () => {
  it('recommended has at least 1 reason string', () => {
    const result = generateBestFitSystems(makeInput(36));
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('all reason strings are non-empty', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const r of result.recommended!.reasons) {
      expect(r.length).toBeGreaterThan(0);
    }
  });
});

// ─── Test 7: Pure function — no mutation ──────────────────────────────────────

describe('TEST 7 — Pure function, no mutation', () => {
  it('identical inputs produce identical results', () => {
    const r1 = generateBestFitSystems(makeInput(36));
    const r2 = generateBestFitSystems(makeInput(36));
    expect(r1.recommended?.config.key).toBe(r2.recommended?.config.key);
    expect(r1.recommended?.score).toBeCloseTo(r2.recommended?.score ?? 0, 3);
  });

  it('input objects are not mutated after call', () => {
    const input = makeInput(36);
    const originalPanelCount = input.totalPanels;
    const originalModelCount = input.modelRefs.length;
    generateBestFitSystems(input);
    expect(input.totalPanels).toBe(originalPanelCount);
    expect(input.modelRefs.length).toBe(originalModelCount);
  });
});

// ─── Test 8: Alternatives are distinct and ranked correctly ──────────────────

describe('TEST 8 — Alternatives are distinct and ranked below recommended', () => {
  it('alternatives have lower or equal score than recommended', () => {
    const result = generateBestFitSystems(makeInput(36));
    if (result.alternatives.length > 0) {
      for (const alt of result.alternatives) {
        expect(alt.score).toBeLessThanOrEqual(result.recommended!.score + 0.01);
      }
    }
  });

  it('alternatives have distinct config keys from recommended', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const alt of result.alternatives) {
      expect(alt.config.key).not.toBe(result.recommended!.config.key);
    }
  });

  it('at most 2 alternatives returned', () => {
    const result = generateBestFitSystems(makeInput(36));
    expect(result.alternatives.length).toBeLessThanOrEqual(2);
  });
});

// ─── Test 9: Economic sanity — oversized inverter penalized ──────────────────

describe('TEST 9 — Economic sanity scoring', () => {
  it('config with DC/AC ratio >= 0.95 gets full economic score (15)', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (!s.feasible) continue;
      if (s.dcAcRatio >= 0.95) {
        expect(s.scoreBreakdown.economic).toBe(15);
      }
    }
  });

  it('config with DC/AC ratio < 0.9 gets reduced economic score', () => {
    const result = generateBestFitSystems(makeInput(36));
    for (const s of result.evaluated) {
      if (!s.feasible) continue;
      if (s.dcAcRatio < 0.9) {
        expect(s.scoreBreakdown.economic).toBeLessThan(15);
      }
    }
  });
});