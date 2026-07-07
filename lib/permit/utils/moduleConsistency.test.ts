// Phase 1 single-source guard: surface module-wattage drift between the
// engineering-resolved value and every other stored copy.
import { describe, it, expect, vi } from 'vitest';
import { assertModuleConsistency } from './canonical';
import type { PermitInput } from '../types';

function mk(over: { totalDcKw?: number; totalPanels?: number; selectedPanelW?: number; panelPosW?: number }): PermitInput {
  return {
    system: { totalDcKw: over.totalDcKw, totalPanels: over.totalPanels },
    project: {
      selectedPanel: over.selectedPanelW ? { wattage: over.selectedPanelW } : undefined,
      panelPositions: over.panelPosW ? Array.from({ length: 5 }, () => ({ wattage: over.panelPosW })) : undefined,
    },
  } as unknown as PermitInput;
}

describe('assertModuleConsistency', () => {
  it('flags the Melvin drift: engineering 440W vs stale 600W sources', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Authoritative (strings) = 440, but totalDcKw÷panels = 600 (stale engineering).
    const drift = assertModuleConsistency(mk({ totalDcKw: 31.2, totalPanels: 52, selectedPanelW: 440 }), 440);
    expect(drift.some(d => d.source.includes('totalDcKw') && d.watts === 600)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no drift when all sources agree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 440 everywhere: 22.88kW/52 = 440.
    const drift = assertModuleConsistency(mk({ totalDcKw: 22.88, totalPanels: 52, selectedPanelW: 440, panelPosW: 440 }), 440);
    expect(drift).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tolerates <2% rounding differences', () => {
    const drift = assertModuleConsistency(mk({ totalDcKw: 22.9, totalPanels: 52, selectedPanelW: 440 }), 440);
    expect(drift).toHaveLength(0); // 22.9k/52 = 440.4 ≈ 440
  });

  it('is a safe no-op with no authoritative wattage', () => {
    expect(assertModuleConsistency(mk({ totalDcKw: 31.2, totalPanels: 52 }), 0)).toHaveLength(0);
  });
});
