import { describe, it, expect } from 'vitest';
import { assignStrings } from '@/lib/stringAssignment';
import { designElectricalToEngineering } from '@/lib/system/designToEngineering';
import type { DesignElectrical } from '@/types';

// Build N panels on one plane in a simple row/col grid (7 cols).
function grid(n: number, planeId = 'plane-A') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${planeId}-p${i}`,   // unique per plane (real panels are uuids)
    planeId,
    gridRow: Math.floor(i / 7),
    gridCol: i % 7,
  })) as any;
}

describe('assignStrings', () => {
  it('chunks panels into strings of modulesPerString and tags optimizers', () => {
    const r = assignStrings(grid(22), { modulesPerString: 10, topology: 'optimizer' });
    expect(r.strings.map(s => s.panelCount)).toEqual([10, 10, 2]);
    expect(r.deviceType).toBe('optimizer');
    expect(r.deviceCount).toBe(22); // one optimizer per module
    expect(Object.keys(r.byPanelId)).toHaveLength(22);
  });

  it('plain string topology assigns no per-module device', () => {
    const r = assignStrings(grid(10), { modulesPerString: 12, topology: 'string' });
    expect(r.strings).toHaveLength(1);
    expect(r.deviceType).toBe('none');
    expect(r.deviceCount).toBe(0);
  });

  it('manual overrides repaint a panel into a new string and update the legend', () => {
    const base = assignStrings(grid(10), { modulesPerString: 10, topology: 'string' });
    expect(base.strings).toHaveLength(1); // one auto string
    const painted = assignStrings(grid(10), {
      modulesPerString: 10,
      topology: 'string',
      overrides: { 'plane-A-p0': 1 }, // paint first panel into string index 1 (new)
    });
    expect(painted.strings).toHaveLength(2);
    expect(painted.byPanelId['plane-A-p0'].stringIndex).toBe(1);
    const s1 = painted.strings.find(s => s.stringIndex === 1)!;
    expect(s1.panelCount).toBe(1);
  });

  it('keeps strings within a plane (never crosses planes)', () => {
    const panels = [...grid(6, 'plane-A'), ...grid(6, 'plane-B')];
    const r = assignStrings(panels as any, { modulesPerString: 10, topology: 'string' });
    // 6 + 6 panels, 10/string, but a string never spans planes → 2 strings
    expect(r.strings).toHaveLength(2);
    expect(r.strings.every(s => s.panelCount === 6)).toBe(true);
  });
});

describe('designElectricalToEngineering', () => {
  const baseDE: DesignElectrical = {
    topology: 'micro',
    modulesPerString: 10,
    rackingId: 'ironridge-xr100',
    panelId: 'rec-alpha-400w',
    byPanelId: {},
    strings: [
      { stringIndex: 0, panelCount: 10, panelIds: [] },
      { stringIndex: 1, panelCount: 6, panelIds: [] },
    ],
    deviceCount: 16,
    generatedAt: '2026-06-28T00:00:00.000Z',
  };

  it('maps topology + per-string panel counts to engineering StringConfig[]', () => {
    const h = designElectricalToEngineering(baseDE);
    expect(h.inverterType).toBe('micro');
    expect(h.inverterBrand).toBe('Enphase');
    expect(h.strings.map(s => s.panelCount)).toEqual([10, 6]);
    expect(h.strings[0].panelId).toBe('rec-alpha-400w');
    expect(h.strings[0].mountingSystem).toBe('ironridge-xr100');
  });

  it('carries the optimizer peripheral for optimizer topology', () => {
    const h = designElectricalToEngineering({
      ...baseDE, topology: 'optimizer', optimizerModelId: 'se-p401',
    });
    expect(h.inverterType).toBe('optimizer');
    expect(h.inverterBrand).toBe('SolarEdge');
    expect(h.optimizerPeripheralId).toBe('se-p401');
  });

  it('honors a project-pinned inverter id over the topology default', () => {
    const h = designElectricalToEngineering(baseDE, { selectedInverterId: 'enphase-iq8h' });
    expect(h.inverterId).toBe('enphase-iq8h');
  });
});
