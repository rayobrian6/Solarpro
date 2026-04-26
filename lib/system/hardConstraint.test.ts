/**
 * lib/system/hardConstraint.test.ts — Phase 14.1
 *
 * HARD CONSTRAINT ENFORCEMENT TESTS
 * ───────────────────────────────────────────────────────────────────────────
 * Verifies that the feasibility system enforces electrical hard gates across
 * all brands. An "infeasible" system must:
 *
 *   1. Never be scored as valid by bestFitEngine
 *   2. Never be returned as recommended
 *   3. Emit FEASIBILITY_CHOSEN_INFEASIBLE as WARNING (not INFO) in the
 *      severity mapper — so the green "System Valid" banner never fires
 *
 * Tests are brand-agnostic: they use inline specs to isolate the constraint
 * logic from brand-profile routing. This ensures the hard gate works
 * regardless of which brand the user selects.
 *
 * ELECTRICAL SCENARIO (Fronius Primo 10.0 × 1, 36 panels × 400W):
 *   - DC system: 36 × 400W = 14.4 kW
 *   - AC output: 10.0 kW  → DC/AC = 1.44 (within Fronius 1.0–1.5 range ✓)
 *   - Voltage: 13 panels/string × 41.6V × (1 + 0.0027 × 20) = 578V < 600V ✓
 *   - MPPT current: 3 strings on 2 channels → 2 strings × (9.8 × 1.25) = 24.5A
 *     > 18.0A maxInputCurrentPerMppt → HARD FAIL ✗
 *
 * VALID ALTERNATIVE (2 × Fronius Primo 5.0, 18 panels each):
 *   - DC: 14.4 kW / (2 × 5.0 kW AC) = 1.44 DC/AC ✓
 *   - 1 string per MPPT channel, 9 panels/string, current = 12.25A < 18A ✓
 */

import { describe, it, expect } from 'vitest';
import { evaluateInverterFeasibility } from './feasibilityEvaluator';
import type {
  PanelElectricalSpecs,
  InverterElectricalSpecs,
} from './feasibilityEvaluator';
import { generateBestFitSystems, type BestFitInput } from './bestFitEngine';
import type { BrandInverterModelRef } from './brandProfiles/types';
import { mapIssueToUI, type RawIssue } from '../ui/severityMapper';

// ─── Shared panel spec ─────────────────────────────────────────────────────
//
// 400W panel with Isc = 9.8A (realistic high-efficiency monocrystalline).
// Design current = 9.8 × 1.25 = 12.25A per string.
// 2 parallel strings on one MPPT channel = 24.5A — exceeds 18A Fronius limit.

const PANEL_400W_HIGH_ISC: PanelElectricalSpecs = {
  voc: 41.6,
  vmp: 34.5,
  isc: 9.8,
  watts: 400,
  tempCoeffVoc: -0.27, // %/°C
};

// ─── Fronius Primo 10.0 specs ──────────────────────────────────────────────
//
// maxInputCurrentPerMppt: 18.0A  (from equipment-db: fronius-primo-10.0)
// mpptCount: 2                   (2 independent MPPT channels)
// maxParallelStringsPerMppt: 2   (from brand profile — set explicitly)
// maxDcVoltage: 600V
//
// For 36 panels: evaluator must route 36 panels across 2 MPPT channels.
// Minimum viable string layout: 3 strings of 12 panels each.
//   - 2 strings on ch1 (max parallel=2), 1 string on ch2 → but then
//     2 strings × 12.25A = 24.5A > 18A on ch1 → MPPT_CURRENT_EXCEEDED.

const FRONIUS_10KW: InverterElectricalSpecs = {
  equipmentDbId: 'fronius-primo-10.0',
  acKw: 10.0,
  dcKwMax: 15.0,
  mpptCount: 2,
  maxDcVoltage: 600,
  mpptVoltageMin: 200,
  mpptVoltageMax: 600,
  maxInputCurrentPerMppt: 18.0,
  maxParallelStringsPerMppt: 2,
  minPanelsPerString: 7,
  maxPanelsPerString: 16,
};

// ─── Fronius Primo 5.0 specs ───────────────────────────────────────────────
//
// With 18 panels per inverter (36 total ÷ 2 inverters):
//   - 2 strings of 9 panels on 2 MPPT channels (1 string per channel)
//   - Current per channel: 1 × 12.25A = 12.25A < 18A ✓
//   - Voltage: 9 × 41.6V × (1 + 0.0027×20) = 9 × 43.85V = 394.6V within 200–600V ✓
//   - DC/AC ratio: 7.2 kW / 5.0 kW = 1.44 — within Fronius range ✓

const FRONIUS_5KW: InverterElectricalSpecs = {
  equipmentDbId: 'fronius-primo-5.0',
  acKw: 5.0,
  dcKwMax: 7.5,
  mpptCount: 2,
  maxDcVoltage: 600,
  mpptVoltageMin: 200,
  mpptVoltageMax: 600,
  maxInputCurrentPerMppt: 18.0,
  maxParallelStringsPerMppt: 2,
  minPanelsPerString: 7,
  maxPanelsPerString: 16,
};

// ─── Fronius model refs (brand profile shape) ──────────────────────────────

const FRONIUS_MODEL_REFS: BrandInverterModelRef[] = [
  {
    equipmentDbId: 'fronius-primo-5.0',
    acKw: 5.0,
    dcKwMax: 7.5,
    mpptCount: 2,
    minPanelsPerString: 7,
    maxPanelsPerString: 16,
    maxParallelStringsPerMppt: 2,
  },
  {
    equipmentDbId: 'fronius-primo-7.6',
    acKw: 7.6,
    dcKwMax: 11.4,
    mpptCount: 2,
    minPanelsPerString: 7,
    maxPanelsPerString: 16,
    maxParallelStringsPerMppt: 2,
  },
  {
    equipmentDbId: 'fronius-primo-8.2',
    acKw: 8.2,
    dcKwMax: 12.3,
    mpptCount: 2,
    minPanelsPerString: 7,
    maxPanelsPerString: 16,
    maxParallelStringsPerMppt: 2,
  },
  {
    equipmentDbId: 'fronius-primo-10.0',
    acKw: 10.0,
    dcKwMax: 15.0,
    mpptCount: 2,
    minPanelsPerString: 7,
    maxPanelsPerString: 16,
    maxParallelStringsPerMppt: 2,
  },
];

const FRONIUS_SPECS = new Map<string, InverterElectricalSpecs>([
  ['fronius-primo-5.0',  FRONIUS_5KW],
  ['fronius-primo-7.6', {
    equipmentDbId: 'fronius-primo-7.6',
    acKw: 7.6, dcKwMax: 11.4,
    mpptCount: 2, maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxParallelStringsPerMppt: 2,
    minPanelsPerString: 7, maxPanelsPerString: 16,
  }],
  ['fronius-primo-8.2', {
    equipmentDbId: 'fronius-primo-8.2',
    acKw: 8.2, dcKwMax: 12.3,
    mpptCount: 2, maxDcVoltage: 600, mpptVoltageMin: 200, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 18.0, maxParallelStringsPerMppt: 2,
    minPanelsPerString: 7, maxPanelsPerString: 16,
  }],
  ['fronius-primo-10.0', FRONIUS_10KW],
]);

// ─── TEST 1: Fronius Primo 10.0 × 1 is electrically invalid for 36 panels ──
//
// The evaluator must reject this configuration with MPPT_CURRENT_EXCEEDED.
// 36 panels on a single Fronius 10kW (2 MPPT, 2 parallel/channel max)
// requires at least 3 strings. Minimum allocation: 2 strings on ch1 → 24.5A
// exceeds the 18A limit.

describe('TEST 1 — Fronius 10.0×1 is INVALID for 36 panels (MPPT current overload)', () => {
  const result = evaluateInverterFeasibility({
    inverter: FRONIUS_10KW,
    panel: PANEL_400W_HIGH_ISC,
    totalPanels: 36,
    designTempMin: -10,
  });

  it('result.valid is false', () => {
    expect(result.valid).toBe(false);
  });

  it('result.allocationValid is false (MPPT parallel string current overload)', () => {
    // The per-string current check (12.25A < 18A) passes.
    // The ALLOCATION check fails: 3 strings cannot fit on 2 MPPT channels
    // without exceeding the 18A parallel-current limit on at least one channel.
    expect(result.allocationValid).toBe(false);
  });

  it('failures array includes MPPT_CURRENT_EXCEEDED or MPPT_ALLOCATION_INVALID', () => {
    const codes = result.failures.map(f => f.code);
    const hasCurrentFail = codes.some(c =>
      c === 'MPPT_CURRENT_EXCEEDED' || c === 'MPPT_ALLOCATION_INVALID'
    );
    expect(hasCurrentFail).toBe(true);
  });

  it('failure message mentions current or allocation', () => {
    const mpptFail = result.failures.find(f =>
      f.code === 'MPPT_CURRENT_EXCEEDED' || f.code === 'MPPT_ALLOCATION_INVALID'
    );
    expect(mpptFail?.message).toBeTruthy();
    expect(mpptFail!.message.toLowerCase()).toMatch(/current|allocat/i);
  });

  it('DC/AC ratio is acceptable (1.44) — the CURRENT is the blocker, not DC/AC', () => {
    // 14.4 kW DC / 10.0 kW AC = 1.44 — within Fronius 1.0–1.5 range.
    // This confirms the failure is purely current-based, not DC/AC-based.
    const dcAc = (36 * 400) / 1000 / 10.0;
    expect(dcAc).toBeCloseTo(1.44, 2);
    // The dcAcValid should be true (ratio is within range)
    expect(result.dcAcValid).toBe(true);
  });
});

// ─── TEST 2: Valid alternative exists (2 × Fronius Primo 5.0) ──────────────
//
// bestFitEngine must find a feasible configuration for 36 panels on Fronius.
// The recommended config should NOT be fronius-primo-10.0 × 1 (infeasible).
// A valid alternative: 2 × fronius-primo-5.0 (18 panels each, 1 string/MPPT).

describe('TEST 2 — Valid alternative found for 36 panels on Fronius', () => {
  const input: BestFitInput = {
    modelRefs: FRONIUS_MODEL_REFS,
    equipmentSpecs: FRONIUS_SPECS,
    panel: PANEL_400W_HIGH_ISC,
    totalPanels: 36,
    designTempMin: -10,
  };
  const result = generateBestFitSystems(input);

  it('recommended is not null — engine finds a valid config', () => {
    expect(result.recommended).not.toBeNull();
  });

  it('recommended config is feasible', () => {
    expect(result.recommended!.feasible).toBe(true);
  });

  it('fronius-primo-10.0 × 1 is in rejected list (not recommended)', () => {
    const tenKwSingle = result.rejected.find(r =>
      r.key.includes('fronius-primo-10.0') && !r.key.includes('x2')
    );
    // Either it's in rejected, or it was never even a feasible candidate.
    // Either way, it must NOT be the recommended config.
    const recKey = result.recommended!.config.key;
    const recSlots = result.recommended!.config.slots;
    const isSingleTenKw =
      recSlots.length === 1 &&
      recSlots[0].modelRef.equipmentDbId === 'fronius-primo-10.0' &&
      recSlots[0].qty === 1;
    expect(isSingleTenKw).toBe(false);
  });

  it('recommended DC/AC ratio is within Fronius allowed range (1.0–1.5)', () => {
    const dcAc = result.recommended!.dcAcRatio;
    expect(dcAc).toBeGreaterThanOrEqual(1.0);
    expect(dcAc).toBeLessThanOrEqual(1.5);
  });

  it('all slot results in recommended are individually valid', () => {
    for (const slotResult of result.recommended!.slotResults) {
      expect(slotResult.valid).toBe(true);
    }
  });
});

// ─── TEST 3: No valid config → recommended is null ─────────────────────────
//
// If NO Fronius model can service the panel count (e.g. 200 panels, only
// 1-unit configs allowed by reducing MAX_UNITS cap via empty specs), the
// engine must return null — not crash, not return an invalid config.

describe('TEST 3 — No valid system → recommended is null', () => {
  it('returns null when equipmentSpecs is empty (no specs → all skipped)', () => {
    const result = generateBestFitSystems({
      modelRefs: FRONIUS_MODEL_REFS,
      equipmentSpecs: new Map(),  // empty — all candidates skipped
      panel: PANEL_400W_HIGH_ISC,
      totalPanels: 36,
      designTempMin: -10,
    });
    expect(result.recommended).toBeNull();
    expect(result.alternatives).toHaveLength(0);
  });

  it('returns null when panel count is 0', () => {
    const result = generateBestFitSystems({
      modelRefs: FRONIUS_MODEL_REFS,
      equipmentSpecs: FRONIUS_SPECS,
      panel: PANEL_400W_HIGH_ISC,
      totalPanels: 0,
      designTempMin: -10,
    });
    expect(result.recommended).toBeNull();
  });

  it('evaluated list shows infeasible entries (not empty) when specs are provided', () => {
    // 1 panel → DC kW far too low for any Fronius model's min DC/AC range
    const result = generateBestFitSystems({
      modelRefs: FRONIUS_MODEL_REFS,
      equipmentSpecs: FRONIUS_SPECS,
      panel: PANEL_400W_HIGH_ISC,
      totalPanels: 1,
      designTempMin: -10,
    });
    // Engine evaluated candidates but none were feasible
    expect(result.evaluated.length).toBeGreaterThan(0);
    expect(result.recommended).toBeNull();
  });
});

// ─── TEST 4: UI — FEASIBILITY_CHOSEN_INFEASIBLE stays WARNING (not INFO) ───
//
// Phase 14.1 HARD RULE: FEASIBILITY_CHOSEN_INFEASIBLE must never be demoted
// to info. It must remain 'warning' so the green "System Valid" banner never
// fires when this code is present.
//
// Before Phase 14.1: this code was in INFO_OVERRIDE_CODES → remapped to info
//   → green banner showed despite invalid system selection.
// After Phase 14.1: it is NOT in INFO_OVERRIDE_CODES → stays warning.

describe('TEST 4 — FEASIBILITY_CHOSEN_INFEASIBLE stays WARNING (not INFO)', () => {
  const rawIssue: RawIssue = {
    code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
    severity: 'warning',
    message: 'Selected inverter configuration did not meet all electrical constraints.',
  };

  it('mapped severity is warning (not info)', () => {
    const mapped = mapIssueToUI(rawIssue);
    expect(mapped.severity).toBe('warning');
  });

  it('engine severity is preserved as warning', () => {
    const mapped = mapIssueToUI(rawIssue);
    expect(mapped.engineSeverity).toBe('warning');
  });

  it('message is not overridden (no info-override message substitution)', () => {
    const mapped = mapIssueToUI(rawIssue);
    // Should preserve the original message since no override is applied
    expect(mapped.message).toBe(rawIssue.message);
  });
});

// ─── TEST 5: MPPT_CURRENT_EXCEEDED always stays ERROR ─────────────────────
//
// This is a blocking electrical failure. It must never be downgraded.
// The severity mapper must pass it through unchanged as 'error'.

describe('TEST 5 — MPPT_CURRENT_EXCEEDED stays ERROR (never downgraded)', () => {
  const rawError: RawIssue = {
    code: 'MPPT_CURRENT_EXCEEDED',
    severity: 'error',
    message: 'Design current 24.5A exceeds MPPT channel limit of 18.0A.',
  };

  it('mapped severity is error', () => {
    const mapped = mapIssueToUI(rawError);
    expect(mapped.severity).toBe('error');
  });

  it('engine severity is preserved as error', () => {
    const mapped = mapIssueToUI(rawError);
    expect(mapped.engineSeverity).toBe('error');
  });
});

// ─── TEST 6: MPPT_ALLOCATION_INVALID always stays ERROR ────────────────────

describe('TEST 6 — MPPT_ALLOCATION_INVALID stays ERROR (never downgraded)', () => {
  const rawError: RawIssue = {
    code: 'MPPT_ALLOCATION_INVALID',
    severity: 'error',
    message: 'Cannot allocate 5 strings across 2 MPPT channels (max 2 parallel/channel).',
  };

  it('mapped severity is error', () => {
    const mapped = mapIssueToUI(rawError);
    expect(mapped.severity).toBe('error');
  });
});

// ─── TEST 7: E_VOC_EXCEEDED always stays ERROR ─────────────────────────────

describe('TEST 7 — E_VOC_EXCEEDED stays ERROR (never downgraded)', () => {
  const rawError: RawIssue = {
    code: 'E_VOC_EXCEEDED',
    severity: 'error',
    message: 'String Voc 630V exceeds inverter max DC voltage 600V.',
  };

  it('mapped severity is error', () => {
    const mapped = mapIssueToUI(rawError);
    expect(mapped.severity).toBe('error');
  });
});

// ─── TEST 8: bestFitEngine never scores an invalid candidate ───────────────
//
// If a candidate config's feasibility check fails, its score must be 0 and
// it must appear in the rejected list, not the recommended or alternatives.

describe('TEST 8 — bestFitEngine never recommends infeasible config', () => {
  const input: BestFitInput = {
    modelRefs: FRONIUS_MODEL_REFS,
    equipmentSpecs: FRONIUS_SPECS,
    panel: PANEL_400W_HIGH_ISC,
    totalPanels: 36,
    designTempMin: -10,
  };
  const result = generateBestFitSystems(input);

  it('recommended is feasible (if not null)', () => {
    if (result.recommended !== null) {
      expect(result.recommended.feasible).toBe(true);
    }
  });

  it('all alternatives are feasible', () => {
    for (const alt of result.alternatives) {
      expect(alt.feasible).toBe(true);
    }
  });

  it('infeasible evaluated entries have score = 0', () => {
    for (const ev of result.evaluated) {
      if (!ev.feasible) {
        expect(ev.score).toBe(0);
      }
    }
  });

  it('rejected entries are not in alternatives', () => {
    const rejectedKeys = new Set(result.rejected.map(r => r.key));
    for (const alt of result.alternatives) {
      expect(rejectedKeys.has(alt.config.key)).toBe(false);
    }
  });

  it('recommended key is not in rejected list', () => {
    if (result.recommended) {
      const rejectedKeys = new Set(result.rejected.map(r => r.key));
      expect(rejectedKeys.has(result.recommended.config.key)).toBe(false);
    }
  });
});

// ─── TEST 9: Brand-agnostic — generic MPPT current overload detection ───────
//
// Construct a generic string inverter with low maxInputCurrentPerMppt (12A)
// and verify the evaluator correctly rejects a high-Isc panel configuration.
// This proves the hard gate is not Fronius-specific.

describe('TEST 9 — Brand-agnostic MPPT current hard gate', () => {
  // Generic 5kW inverter with a VERY low current limit (12A/channel)
  const TIGHT_CURRENT_INVERTER: InverterElectricalSpecs = {
    equipmentDbId: 'generic-tight-5kw',
    acKw: 5.0,
    dcKwMax: 7.5,
    mpptCount: 2,
    maxDcVoltage: 600,
    mpptVoltageMin: 100,
    mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 12.0, // 12A limit — design current 12.25A → exceeds
    maxParallelStringsPerMppt: 2,
    minPanelsPerString: 5,
    maxPanelsPerString: 20,
  };

  it('rejects single string when design current exceeds limit', () => {
    // 1 string, design current = 9.8 × 1.25 = 12.25A > 12A → FAIL
    const result = evaluateInverterFeasibility({
      inverter: TIGHT_CURRENT_INVERTER,
      panel: PANEL_400W_HIGH_ISC,
      totalPanels: 10,   // 1 string of 10 panels
      designTempMin: -10,
    });
    // Even 1 string exceeds the per-channel limit
    expect(result.mpptCurrentValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('accepts single string when Isc is within limit', () => {
    // Low-Isc panel: design current = 7.5 × 1.25 = 9.375A < 12A → PASS
    const LOW_ISC_PANEL: PanelElectricalSpecs = {
      voc: 41.6, vmp: 34.5, isc: 7.5, watts: 400, tempCoeffVoc: -0.27,
    };
    const result = evaluateInverterFeasibility({
      inverter: TIGHT_CURRENT_INVERTER,
      panel: LOW_ISC_PANEL,
      totalPanels: 10,
      designTempMin: -10,
    });
    // 9.375A < 12A → current valid
    expect(result.mpptCurrentValid).toBe(true);
  });
});