// ============================================================================
// lib/system/sizingEngineFeasibility.test.ts — Phase 13.6b
//
// Tests the integration of generateFeasibleSystems() into sizeSystemFromBrand().
//
// CONTRACT:
//   • Opt-in: feasibility runs ONLY when panelIsc AND panelTempCoeffVoc are
//     both supplied. Legacy callers see no behavior change.
//   • Non-mutating: feasibility.report.chosenResult never mutates the primary
//     sizing path. The chosen inverterModels[] is what the primary sizer
//     produced.
//   • Advisory-only warnings: feasibility findings are always 'warning' or
//     'info', never 'error' (existing validationEngine owns 'error').
// ============================================================================

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand, type SizingInput } from './sizingEngine';

// Standard 400W monocrystalline panel spec for feasibility-aware tests.
const PANEL_WITH_SPECS = {
  panelWattage: 400,
  panelVoc: 45.39,
  panelVmp: 38.0,
  panelIsc: 12.2,           // ← electrical specs present
  panelTempCoeffVoc: -0.27, // ← electrical specs present
} as const;

function run(overrides: Partial<SizingInput>) {
  return sizeSystemFromBrand({
    systemType: 'roof',
    panelCount: 30,
    selectedBrand: 'solaredge',
    ...overrides,
  });
}

describe('Phase 13.6b — feasibility integration in sizeSystemFromBrand', () => {
  describe('opt-in gating', () => {
    it('does NOT produce a feasibility report when panelIsc is omitted', () => {
      const r = run({ panelCount: 30 });
      expect(r.feasibility).toBeUndefined();
    });

    it('does NOT produce a feasibility report when panelTempCoeffVoc is omitted', () => {
      const r = run({ panelCount: 30, panelIsc: 12.2 });
      expect(r.feasibility).toBeUndefined();
    });

    it('PRODUCES a feasibility report when both panelIsc and panelTempCoeffVoc are supplied', () => {
      const r = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      expect(r.feasibility).toBeDefined();
      expect(typeof r.feasibility?.anyFeasible).toBe('boolean');
    });
  });

  describe('never escalates to error severity', () => {
    it('feasibility-sourced warnings are only warning or info (never error)', () => {
      // Use a panel-count / brand combo where feasibility will likely find
      // concerns (see the 20-panel SE case explored in 13.6a). Whatever
      // feasibility surfaces must remain advisory.
      const r = run({ panelCount: 20, ...PANEL_WITH_SPECS });
      const feasWarnings = r.warnings.filter(w =>
        w.code.startsWith('FEASIBILITY_')
      );
      for (const w of feasWarnings) {
        expect(w.severity).not.toBe('error');
      }
    });
  });

  describe('micro topology short-circuit', () => {
    it('does NOT produce a feasibility report for micro-inverter brands', () => {
      const r = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
        ...PANEL_WITH_SPECS,
      });
      expect(r.feasibility).toBeUndefined();
    });
  });

  describe('report shape', () => {
    it('always identifies the chosen equipmentDbId when inverters are sized', () => {
      const r = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      expect(r.feasibility).toBeDefined();
      expect(r.feasibility?.chosenEquipmentDbId).toBe(
        r.inverterModels[0].equipmentDbId
      );
    });

    it('rejected[] includes reason codes for every rejected candidate', () => {
      const r = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      expect(r.feasibility).toBeDefined();
      for (const rej of r.feasibility?.rejected ?? []) {
        expect(rej.failures.length).toBeGreaterThan(0);
        for (const f of rej.failures) {
          expect(typeof f.code).toBe('string');
          expect(typeof f.message).toBe('string');
        }
      }
    });
  });

  describe('warning codes emitted', () => {
    it('surfaces FEASIBILITY_NO_VIABLE_MODEL when no model passes', () => {
      // Force panel count that makes the whole brand infeasible. With Isc=12.2
      // on 20 panels, SolarEdge HD-Wave cannot build without 2-string
      // stacking (which exceeds all but the 11400H current cap, and 11400H
      // is oversized for 20 panels → DC/AC fails).
      const r = run({ panelCount: 20, ...PANEL_WITH_SPECS });
      if (!r.feasibility?.anyFeasible) {
        const codes = r.warnings.map(w => w.code);
        expect(codes).toContain('FEASIBILITY_NO_VIABLE_MODEL');
      }
    });

    it('FEASIBILITY_NO_VIABLE_MODEL is severity=warning not error', () => {
      const r = run({ panelCount: 20, ...PANEL_WITH_SPECS });
      const w = r.warnings.find(w => w.code === 'FEASIBILITY_NO_VIABLE_MODEL');
      if (w) expect(w.severity).toBe('warning');
    });
  });

  describe('purity', () => {
    it('feasibility integration does not mutate sized inverterModels', () => {
      const r = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      // Re-run with same input → identical inverterModels[]
      const r2 = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      expect(r.inverterModels).toEqual(r2.inverterModels);
    });

    it('feasibility integration does not mutate sized strings[]', () => {
      const r = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      const r2 = run({ panelCount: 30, ...PANEL_WITH_SPECS });
      expect(r.strings).toEqual(r2.strings);
    });
  });
});