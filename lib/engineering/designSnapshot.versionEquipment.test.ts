// Phase 0 (full-duplex panel sync): the design version MUST change when the
// selected panel changes — otherwise engineering keeps a stale report (the
// "reverted to 600W" bug). Covers model, wattage, and physical-dimension
// changes (the last drives array-footprint recompute).
import { describe, it, expect } from 'vitest';
import { buildDesignSnapshot } from './designSnapshot';
import type { Project, Layout, SolarPanel } from '@/types';

const basePanel: SolarPanel = {
  id: 'p440', manufacturer: 'Canadian Solar', model: 'CS 440W', wattage: 440,
  width: 1.13, height: 1.72, efficiency: 21, bifacial: false, bifacialFactor: 1,
  temperatureCoeff: -0.34, pricePerWatt: 0.3, voc: 41.6, isc: 13.5,
};

const layout = {
  id: 'lay-1', totalPanels: 52, systemSizeKw: 22.88, updatedAt: '2026-07-07T00:00:00Z',
  panels: [], systemType: 'roof',
} as unknown as Layout;

function projWith(panel: SolarPanel): Project {
  return {
    id: 'proj-1', address: '3 Melvin Dr, Granite City, IL', city: 'Granite City',
    stateCode: 'IL', lat: 38.7, lng: -90.04, selectedPanel: panel, batteryCount: 0,
  } as unknown as Project;
}

const version = (panel: SolarPanel) => buildDesignSnapshot(projWith(panel), layout).designVersionId;

describe('computeDesignVersionId — equipment awareness', () => {
  it('changes when the panel WATTAGE changes (440 → 600)', () => {
    const v440 = version(basePanel);
    const v600 = version({ ...basePanel, model: 'HiKu7 Bifacial 600W', wattage: 600 });
    expect(v600).not.toBe(v440);
  });

  it('changes when only the panel MODEL changes (same wattage)', () => {
    const a = version(basePanel);
    const b = version({ ...basePanel, model: 'Different 440W' });
    expect(b).not.toBe(a);
  });

  it('changes when only the panel DIMENSIONS change (drives layout recompute)', () => {
    const a = version(basePanel);
    const b = version({ ...basePanel, width: 1.30, height: 2.38 });
    expect(b).not.toBe(a);
  });

  it('is stable when the panel is unchanged', () => {
    expect(version(basePanel)).toBe(version({ ...basePanel }));
  });
});
