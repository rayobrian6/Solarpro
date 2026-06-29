import { describe, it, expect } from 'vitest';
import { assignStrings } from '@/lib/stringAssignment';
import {
  designElectricalToEngineering,
  normalizeToPermitInverters,
  designToPermitInverters,
} from '@/lib/system/designToEngineering';
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

// Guards the server-side planset backfill — the thing that broke generation before.
describe('normalizeToPermitInverters — guaranteed-complete shape', () => {
  it('returns null for empty / non-array input (caller keeps original payload)', () => {
    expect(normalizeToPermitInverters(null)).toBeNull();
    expect(normalizeToPermitInverters([])).toBeNull();
    expect(normalizeToPermitInverters('nope')).toBeNull();
  });

  it('fills every field the planset reads from a partial 11/11/4 config', () => {
    const raw = [{
      type: 'string',
      inverterId: 'se-7600h',
      strings: [{ panelCount: 11 }, { panelCount: 11 }, { panelCount: 4 }], // missing wireGauge/panelId/etc.
    }];
    const out = normalizeToPermitInverters(raw)!;
    expect(out).toHaveLength(1);
    expect(out[0].strings.map(s => s.panelCount)).toEqual([11, 11, 4]);
    expect(out[0].stringsPerInverter).toBe(3);
    // every field the renderers read is present + typed
    for (const s of out[0].strings) {
      expect(typeof s.wireGauge).toBe('string');
      expect(typeof s.panelId).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(s.panelCount).toBeGreaterThan(0);
    }
    expect(typeof out[0].model).toBe('string');
    expect(['string', 'micro', 'optimizer']).toContain(out[0].type);
  });

  it('drops zero-panel strings and returns null if nothing usable remains', () => {
    expect(normalizeToPermitInverters([{ type: 'string', strings: [{ panelCount: 0 }] }])).toBeNull();
  });

  it('coerces an unknown topology to string', () => {
    const out = normalizeToPermitInverters([{ type: 'weird', strings: [{ panelCount: 10 }] }])!;
    expect(out[0].type).toBe('string');
  });
});

describe('designToPermitInverters', () => {
  it('builds one valid permit inverter from a design (per-string counts preserved)', () => {
    const de: DesignElectrical = {
      topology: 'optimizer', modulesPerString: 11, rackingId: 'ironridge-xr100',
      panelId: 'rec-alpha-400w', optimizerModelId: 'se-p401',
      byPanelId: {}, strings: [
        { stringIndex: 0, panelCount: 11, panelIds: [] },
        { stringIndex: 1, panelCount: 11, panelIds: [] },
        { stringIndex: 2, panelCount: 4, panelIds: [] },
      ], deviceCount: 26, generatedAt: '2026-06-28T00:00:00.000Z',
    };
    const out = designToPermitInverters(de)!;
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('optimizer');
    expect(out[0].strings.map(s => s.panelCount)).toEqual([11, 11, 4]);
    expect(out[0].optimizerPeripheralId).toBe('se-p401');
  });

  it('returns null for an empty design', () => {
    expect(designToPermitInverters({ topology: 'string', modulesPerString: 10, byPanelId: {}, strings: [], deviceCount: 0, generatedAt: '' } as DesignElectrical)).toBeNull();
  });
});
