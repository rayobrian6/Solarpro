// ═════════════════════════════════════════════════════════════════════════════
// Phase 12.5 — Normalized Inverter State tests
// ═════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from './sizingEngine';
import type { SizingInput } from './sizingEngine';
import {
  normalizeInverterState,
  diffNormalizedInverterState,
  formatNormalizedInverterSummary,
  type CurrentInverterConfigSnapshot,
} from './normalizedInverter';

function runSizing(overrides: Partial<SizingInput> = {}) {
  return sizeSystemFromBrand({
    systemType: 'roof',
    panelCount: 20,
    selectedBrand: 'solaredge',
    ...overrides,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// fromSizingResult — topology-by-topology contract
// ═════════════════════════════════════════════════════════════════════════════

describe('normalizeInverterState — sizing result inputs', () => {
  it('micro: physicalUnits = panelCount, logicalGroups = 1', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'enphase' });
    const state = normalizeInverterState({ sizingResult: sizing });
    expect(state.topology).toBe('micro');
    expect(state.physicalUnits).toBe(36); // one microinverter per panel
    expect(state.logicalGroups).toBe(1);  // one UI card regardless of count
    expect(state.optimizerCount).toBe(0);
  });

  it('string (Fronius): physicalUnits = logicalGroups = inverterCount', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'fronius' });
    const state = normalizeInverterState({ sizingResult: sizing });
    expect(state.topology).toBe('string');
    expect(state.physicalUnits).toBe(sizing.inverterCount);
    expect(state.logicalGroups).toBe(sizing.inverterCount);
    expect(state.physicalUnits).toBeGreaterThan(0);
    expect(state.optimizerCount).toBe(0);
  });

  it('optimizer (SolarEdge 36): physicalUnits=groups=inverterCount, optimizerCount=panelCount', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'solaredge' });
    const state = normalizeInverterState({ sizingResult: sizing });
    expect(state.topology).toBe('optimizer');
    expect(state.physicalUnits).toBe(sizing.inverterCount);
    expect(state.logicalGroups).toBe(sizing.inverterCount);
    expect(state.optimizerCount).toBe(36);
  });

  it('hybrid (EcoFlow fence): physicalUnits = logicalGroups = inverterCount', () => {
    const sizing = runSizing({
      panelCount: 14,
      selectedBrand: 'ecoflow',
      systemType: 'fence',
      batteryEnabled: true,
    });
    const state = normalizeInverterState({ sizingResult: sizing });
    expect(state.topology).toBe('hybrid');
    expect(state.physicalUnits).toBe(sizing.inverterCount);
    expect(state.logicalGroups).toBe(sizing.inverterCount);
    expect(state.optimizerCount).toBe(0);
  });

  it('empty input: returns zero-state', () => {
    const state = normalizeInverterState({});
    expect(state.physicalUnits).toBe(0);
    expect(state.logicalGroups).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// fromCurrentConfig — the false-positive fix
// ═════════════════════════════════════════════════════════════════════════════

describe('normalizeInverterState — current config inputs (false-positive fix)', () => {
  it('micro current config: cardCount=1, panelCount=36 → physicalUnits=36, groups=1', () => {
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 36,
      topology: 'micro',
    };
    const state = normalizeInverterState({ currentConfig: cfg });
    expect(state.physicalUnits).toBe(36); // NOT 1 — the bug Phase 12.5 fixes
    expect(state.logicalGroups).toBe(1);
    expect(state.topology).toBe('micro');
  });

  it('string current: cardCount=2, panelCount=36 → physicalUnits=2, groups=2', () => {
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 2,
      panelCount: 36,
      topology: 'string',
    };
    const state = normalizeInverterState({ currentConfig: cfg });
    expect(state.physicalUnits).toBe(2);
    expect(state.logicalGroups).toBe(2);
    expect(state.topology).toBe('string');
  });

  it('legacy ecoflow topology is remapped to hybrid', () => {
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 14,
      topology: 'ecoflow',
    };
    const state = normalizeInverterState({ currentConfig: cfg });
    expect(state.topology).toBe('hybrid');
    expect(state.physicalUnits).toBe(1);
  });

  it('throws when both sizingResult and currentConfig are passed (must diff via diffNormalizedInverterState)', () => {
    const sizing = runSizing({ panelCount: 20 });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 20,
      topology: 'optimizer',
    };
    expect(() => normalizeInverterState({ sizingResult: sizing, currentConfig: cfg })).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// diffNormalizedInverterState — mismatch logic (THE contract)
// ═════════════════════════════════════════════════════════════════════════════

describe('diffNormalizedInverterState — mismatch semantics', () => {
  // ─── Micro ─────────────────────────────────────────────────────────────────

  it('Micro 36 panels: current (1 card, 36 panels) matches sizing (36 micros) → NO mismatch', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'enphase' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 36,
      topology: 'micro',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.physicalMismatch).toBe(false);
    expect(diff.topologyMismatch).toBe(false);
    expect(diff.current.physicalUnits).toBe(36);
    expect(diff.recommended.physicalUnits).toBe(36);
  });

  it('Micro panel-count drift: current 30 vs sizing 36 → mismatch', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'enphase' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 30,
      topology: 'micro',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.physicalMismatch).toBe(true);
  });

  // ─── String (Fronius) ──────────────────────────────────────────────────────

  it('String 36 panels: current cardCount matches sizing inverterCount → NO mismatch', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'fronius' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: sizing.inverterCount,
      panelCount: 36,
      topology: 'string',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.physicalMismatch).toBe(false);
  });

  it('String wrong card count: 1 card vs 2 recommended → mismatch', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'fronius' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 36,
      topology: 'string',
    };
    // Only asserts mismatch when sizing actually recommends >1 inverter.
    if (sizing.inverterCount > 1) {
      const diff = diffNormalizedInverterState(cfg, sizing);
      expect(diff.physicalMismatch).toBe(true);
    }
  });

  // ─── Hybrid (EcoFlow) ──────────────────────────────────────────────────────

  it('Hybrid fence 14 panels: 1 card matches sizing → NO mismatch', () => {
    const sizing = runSizing({
      panelCount: 14,
      selectedBrand: 'ecoflow',
      systemType: 'fence',
      batteryEnabled: true,
    });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: sizing.inverterCount,
      panelCount: 14,
      topology: 'hybrid',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.physicalMismatch).toBe(false);
  });

  // ─── Optimizer (SolarEdge) ─────────────────────────────────────────────────

  it('Optimizer 36 panels: current matches recommended physical unit count → NO mismatch', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'solaredge' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: sizing.inverterCount,
      panelCount: 36,
      topology: 'optimizer',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.physicalMismatch).toBe(false);
  });

  // ─── Cross-topology ────────────────────────────────────────────────────────

  it('Cross-topology switch: current=string, recommended=micro → topologyMismatch + physicalMismatch', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const cfg: CurrentInverterConfigSnapshot = {
      cardCount: 1,
      panelCount: 20,
      topology: 'string',
    };
    const diff = diffNormalizedInverterState(cfg, sizing);
    expect(diff.topologyMismatch).toBe(true);
    expect(diff.physicalMismatch).toBe(true);
  });

  it('null inputs: both states empty, no mismatch', () => {
    const diff = diffNormalizedInverterState(null, null);
    expect(diff.physicalMismatch).toBe(false);
    expect(diff.topologyMismatch).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// formatNormalizedInverterSummary — UI display contract
// ═════════════════════════════════════════════════════════════════════════════

describe('formatNormalizedInverterSummary', () => {
  it('micro with > 1 units: shows physical count AND group hint', () => {
    const sizing = runSizing({ panelCount: 36, selectedBrand: 'enphase' });
    const state = normalizeInverterState({ sizingResult: sizing });
    const text = formatNormalizedInverterSummary(state);
    expect(text).toContain('36 microinverters');
    expect(text).toContain('1 system group');
    expect(text).not.toBe('1 microinverter'); // critical — do NOT collapse to "1"
  });

  it('string: shows physical count only', () => {
    const state = normalizeInverterState({
      sizingResult: runSizing({ panelCount: 36, selectedBrand: 'fronius' }),
    });
    const text = formatNormalizedInverterSummary(state);
    expect(text).toMatch(/string inverters?/);
  });

  it('optimizer: shows both inverter and optimizer counts', () => {
    const state = normalizeInverterState({
      sizingResult: runSizing({ panelCount: 36, selectedBrand: 'solaredge' }),
    });
    const text = formatNormalizedInverterSummary(state);
    expect(text).toMatch(/string inverter/);
    expect(text).toContain('36 optimizer');
  });

  it('hybrid: shows hybrid inverter count', () => {
    const state = normalizeInverterState({
      sizingResult: runSizing({
        panelCount: 14,
        selectedBrand: 'ecoflow',
        systemType: 'fence',
        batteryEnabled: true,
      }),
    });
    const text = formatNormalizedInverterSummary(state);
    expect(text).toMatch(/hybrid inverter/);
  });

  it('zero state: "(no inverter)"', () => {
    const state = normalizeInverterState({});
    expect(formatNormalizedInverterSummary(state)).toBe('(no inverter)');
  });
});