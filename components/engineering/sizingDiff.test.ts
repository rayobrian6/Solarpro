/**
 * Phase 11 — SizingRecommendation component logic tests.
 *
 * Tests the pure diff function `diffCurrentVsRecommended()` which powers
 * the recommendation panel's mismatch display, and `detectStringLayoutMismatch()`
 * which powers the AUTO STRING REBUILD trigger on inverter/brand changes.
 * UI rendering is not tested here (JSX would require jsdom + React Testing Library setup).
 */

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from '../../lib/system/sizingEngine';
import {
  diffCurrentVsRecommended,
  detectStringLayoutMismatch,
  type CurrentConfigSnapshot,
} from './sizingDiff';

/**
 * Test helper — build a snapshot that matches a given sizing recommendation.
 * Callers can override any field to create mismatch scenarios.
 */
function snapshotMatching(
  rec: ReturnType<typeof sizeSystemFromBrand>,
  overrides: Partial<CurrentConfigSnapshot> = {},
): CurrentConfigSnapshot {
  const perString = rec.topology === 'micro'
    ? [rec.microDeviceCount]
    : rec.strings.map(s => s.panelCount);
  return {
    inverterCount: rec.inverterCount,
    inverterId: rec.inverterModels[0]?.equipmentDbId ?? '',
    topology: rec.topology,
    stringCount: rec.topology === 'micro' ? 1 : rec.strings.length,
    panelsPerString: perString[0] ?? 0,
    stringPanelCounts: perString,
    microDeviceCount: rec.microDeviceCount,
    batteryEnabled: false,
    batteryModuleCount: 0,
    ...overrides,
  };
}

describe('Phase 11 — diffCurrentVsRecommended', () => {
  it('reports NO mismatch when current exactly matches recommendation', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
      batteryEnabled: false,
    });
    const current = snapshotMatching(rec);
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(true);
    expect(diff.mismatches).toHaveLength(0);
    expect(diff.stringLayoutMismatch).toBe(false);
  });

  it('reports topology mismatch when user has string but engine recommends micro', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    const current: CurrentConfigSnapshot = {
      inverterCount: 1,
      inverterId: 'se-7600h',
      topology: 'string',
      stringCount: 2,
      panelsPerString: 10,
      stringPanelCounts: [10, 10],
      microDeviceCount: 0,
      batteryEnabled: false,
      batteryModuleCount: 0,
    };
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(false);
    expect(diff.mismatches.some(m => m.field === 'Topology')).toBe(true);
  });

  it('reports inverter-model mismatch', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 18,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    const current = snapshotMatching(rec, { inverterId: 'se-7600h' });
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(false);
    expect(diff.mismatches.some(m => m.field === 'Inverter model')).toBe(true);
  });

  it('reports battery mismatch when engine recommends battery but user has none', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'fence',
      panelCount: 14,
      selectedBrand: 'ecoflow',
      batteryEnabled: true,
      batteryTargetKwh: 10,
    });
    const current = snapshotMatching(rec, { batteryEnabled: false, batteryModuleCount: 0 });
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(false);
    expect(diff.mismatches.some(m => m.field === 'Battery')).toBe(true);
  });

  it('reports battery mismatch when user wants battery but brand cannot', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 18,
      selectedBrand: 'fronius',
      batteryEnabled: true,
      batteryTargetKwh: 10,
    });
    const current = snapshotMatching(rec, { batteryEnabled: true });
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(false);
    const batteryMiss = diff.mismatches.find(m => m.field === 'Battery');
    expect(batteryMiss).toBeDefined();
    expect(String(batteryMiss?.recommended)).toContain('not supported');
  });

  it('reports inverter-count mismatch', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'ground',
      panelCount: 60,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    const current = snapshotMatching(rec, { inverterCount: rec.inverterCount + 1 });
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.mismatches.some(m => m.field === 'Inverter count')).toBe(true);
  });

  it('no battery mismatch when both current and recommendation lack battery', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
      batteryEnabled: false,
    });
    const current = snapshotMatching(rec);
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(true);
  });
});

describe('Phase 11 touch-up — detectStringLayoutMismatch (AUTO STRING REBUILD)', () => {
  it('returns false when per-string distribution exactly matches recommendation', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    expect(rec.topology).toBe('string');
    const current = snapshotMatching(rec);
    expect(detectStringLayoutMismatch(current, rec)).toBe(false);
  });

  it('returns true when string count differs (e.g. 1 string vs 2 strings)', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    const recPanels = rec.strings.reduce((s, v) => s + v.panelCount, 0);
    const current = snapshotMatching(rec, {
      stringCount: 1,
      stringPanelCounts: [recPanels],
      panelsPerString: recPanels,
    });
    expect(detectStringLayoutMismatch(current, rec)).toBe(true);
  });

  it('returns true when total matches but distribution differs (e.g. 13/7 vs 10/10)', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    // Intentionally mis-distribute the same total across same string count.
    const total = rec.strings.reduce((s, v) => s + v.panelCount, 0);
    if (rec.strings.length >= 2) {
      const skewed = [total - 2, 2, ...new Array(rec.strings.length - 2).fill(0)].slice(
        0,
        rec.strings.length,
      );
      const current = snapshotMatching(rec, { stringPanelCounts: skewed });
      expect(detectStringLayoutMismatch(current, rec)).toBe(true);
    } else {
      // Skip meaningfully if the engine produced a single string.
      expect(true).toBe(true);
    }
  });

  it('is order-independent (10/10 vs 10/10 in swapped order does NOT mismatch)', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    if (rec.strings.length >= 2) {
      const reversed = [...rec.strings.map(s => s.panelCount)].reverse();
      const current = snapshotMatching(rec, { stringPanelCounts: reversed });
      expect(detectStringLayoutMismatch(current, rec)).toBe(false);
    } else {
      expect(true).toBe(true);
    }
  });

  it('micro: returns true when total panel count differs', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    expect(rec.topology).toBe('micro');
    const current = snapshotMatching(rec, {
      microDeviceCount: rec.microDeviceCount - 1,
    });
    expect(detectStringLayoutMismatch(current, rec)).toBe(true);
  });

  it('micro: returns false when total panel count matches', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    const current = snapshotMatching(rec);
    expect(detectStringLayoutMismatch(current, rec)).toBe(false);
  });
});

describe('Phase 11 touch-up — diff surfaces Panels-per-string mismatch', () => {
  it('reports "Panels per string" when distribution differs but count matches', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    if (rec.strings.length >= 2) {
      const total = rec.strings.reduce((s, v) => s + v.panelCount, 0);
      const skewed = [total - 2, 2, ...new Array(rec.strings.length - 2).fill(0)].slice(
        0,
        rec.strings.length,
      );
      const current = snapshotMatching(rec, { stringPanelCounts: skewed });
      const diff = diffCurrentVsRecommended(current, rec);
      expect(diff.stringLayoutMismatch).toBe(true);
      expect(diff.mismatches.some(m => m.field === 'Panels per string')).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  it('does NOT double-report panels-per-string when string count already mismatches', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    const total = rec.strings.reduce((s, v) => s + v.panelCount, 0);
    const current = snapshotMatching(rec, {
      stringCount: 1,
      stringPanelCounts: [total],
      panelsPerString: total,
    });
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.mismatches.some(m => m.field === 'String count')).toBe(true);
    // 'Panels per string' is suppressed when the count itself mismatches.
    expect(diff.mismatches.some(m => m.field === 'Panels per string')).toBe(false);
    // But the structural flag is still true so the watcher can auto-rebuild.
    expect(diff.stringLayoutMismatch).toBe(true);
  });

  it('matches=true implies stringLayoutMismatch=false', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    const current = snapshotMatching(rec);
    const diff = diffCurrentVsRecommended(current, rec);
    expect(diff.matches).toBe(true);
    expect(diff.stringLayoutMismatch).toBe(false);
  });
});

describe('Phase 12.5 — Unified inverter-count semantics (normalized state)', () => {
  it('MICRO false-positive fix: 36-panel micro with 1 UI card ≠ mismatch', () => {
    // This is the exact scenario that motivated Phase 12.5. The UI
    // represents a 36-panel Enphase system as ONE inverter card (the
    // "system" group), but the sizing engine reports inverterCount=36
    // because physically there are 36 microinverters. Before Phase 12.5
    // this produced a false-positive "Inverter count" mismatch.
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'enphase',
    });
    const current: CurrentConfigSnapshot = {
      inverterCount: 1, // UI: ONE card
      inverterId: rec.inverterModels[0]?.equipmentDbId ?? '',
      topology: 'micro',
      stringCount: 1,
      panelsPerString: 36,
      stringPanelCounts: [36],
      microDeviceCount: 36,
      batteryEnabled: false,
      batteryModuleCount: 0,
    };
    const diff = diffCurrentVsRecommended(current, rec);
    // Inverter count should NOT be in mismatches — physicalUnits match
    // (36 micros == 36 micros) even though logicalGroups differ (1 card vs 1).
    const invCountMismatch = diff.mismatches.find(m => m.field === 'Inverter count');
    expect(invCountMismatch).toBeUndefined();
    // Micro device count also matches, so diff overall should be matches=true.
    expect(diff.matches).toBe(true);
  });

  it('MICRO real mismatch: 24-panel current vs 36-panel recommendation DOES mismatch', () => {
    // Sanity check: when physical units genuinely differ we still catch it.
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'enphase',
    });
    const current: CurrentConfigSnapshot = {
      inverterCount: 1,
      inverterId: rec.inverterModels[0]?.equipmentDbId ?? '',
      topology: 'micro',
      stringCount: 1,
      panelsPerString: 24,
      stringPanelCounts: [24],
      microDeviceCount: 24, // Real drift: 24 ≠ 36
      batteryEnabled: false,
      batteryModuleCount: 0,
    };
    const diff = diffCurrentVsRecommended(current, rec);
    // Should report EITHER "Inverter count" (physical 24 vs 36) OR
    // "Micro device count" (or both). Both are the same underlying fact.
    const hasCountFinding = diff.mismatches.some(
      m => m.field === 'Inverter count' || m.field === 'Micro device count',
    );
    expect(hasCountFinding).toBe(true);
    expect(diff.matches).toBe(false);
  });

  it('STRING topology: physicalUnits drift reported as "Inverter count"', () => {
    const rec = sizeSystemFromBrand({
      systemType: 'ground',
      panelCount: 60,
      panelWattage: 400,
      selectedBrand: 'fronius',
    });
    const matching = snapshotMatching(rec);
    const current: CurrentConfigSnapshot = {
      ...matching,
      inverterCount: matching.inverterCount + 1, // Real drift in string topology
    };
    const diff = diffCurrentVsRecommended(current, rec);
    const invCountMismatch = diff.mismatches.find(m => m.field === 'Inverter count');
    expect(invCountMismatch).toBeDefined();
  });

  it('Topology mismatch suppresses inverter-count finding (reported separately)', () => {
    // When topologies differ, comparing physicalUnits across topologies
    // is meaningless — the topology mismatch is the headline finding.
    const rec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase', // micro
    });
    const current: CurrentConfigSnapshot = {
      inverterCount: 1,
      inverterId: '',
      topology: 'string', // Wrong topology
      stringCount: 1,
      panelsPerString: 20,
      stringPanelCounts: [20],
      microDeviceCount: 0,
      batteryEnabled: false,
      batteryModuleCount: 0,
    };
    const diff = diffCurrentVsRecommended(current, rec);
    const topologyMismatch = diff.mismatches.find(m => m.field === 'Topology');
    expect(topologyMismatch).toBeDefined();
    const invCountMismatch = diff.mismatches.find(m => m.field === 'Inverter count');
    // Should NOT be a standalone inverter-count finding when topology
    // mismatches — that would be misleading.
    expect(invCountMismatch).toBeUndefined();
  });
});