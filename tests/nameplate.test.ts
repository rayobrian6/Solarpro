// Unit tests for lib/system/nameplate.ts — THE nameplate function (P0-7/P0-6).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeNameplateKw, NameplatePanelRecord } from '@/lib/system/nameplate';
import type { SubSystemEquipmentMap } from '@/lib/system/subSystemEquipment';

const CATALOG: Record<string, NameplatePanelRecord> = {
  'rec-alpha-pure-405': { id: 'rec-alpha-pure-405', watts: 405 },
  'longi-himo6-580':    { id: 'longi-himo6-580',    watts: 580 },
  'panel-fence-ps1':    { id: 'panel-fence-ps1',    watts: 440 },
  'panel-std440':       { id: 'panel-std440',       watts: 440 },
};
const getPanelById = (id: string) => CATALOG[id];

const stamp = (systemType: string, wattage?: number) => ({ systemType, wattage });
const repeat = <T,>(n: number, f: () => T): T[] => Array.from({ length: n }, f);

const STOWELL_MAP: SubSystemEquipmentMap = {
  roof:   { key: 'roof',   panelId: 'rec-alpha-pure-405', source: 'defaults',    updatedAt: 't' },
  ground: { key: 'ground', panelId: 'longi-himo6-580',    source: 'engineering', updatedAt: 't' },
  fence:  { key: 'fence',  panelId: 'panel-fence-ps1',    source: 'defaults',    updatedAt: 't' },
};

afterEach(() => vi.restoreAllMocks());

describe('computeNameplateKw', () => {
  it('Stowell hybrid: map wattage beats poisoned stamps → 39.07 kW (engineering_runs truth)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Live poisoned stamps: roof 54×405 (ok), ground 16×405 (truth 580), fence 18×430 (truth 440)
    const panels = [
      ...repeat(54, () => stamp('roof', 405)),
      ...repeat(16, () => stamp('ground', 405)),
      ...repeat(18, () => stamp('fence', 430)),
    ];
    const r = computeNameplateKw(panels, STOWELL_MAP, getPanelById);
    expect(r.totalPanels).toBe(88);
    expect(r.totalKw).toBe(39.07); // NOT the stamp Σ 36.09
    expect(r.subs).toEqual([
      { key: 'roof',   count: 54, watts: 405, kw: 21.87, wattsSource: 'map', panelId: 'rec-alpha-pure-405' },
      { key: 'ground', count: 16, watts: 580, kw: 9.28,  wattsSource: 'map', panelId: 'longi-himo6-580' },
      { key: 'fence',  count: 18, watts: 440, kw: 7.92,  wattsSource: 'map', panelId: 'panel-fence-ps1' },
    ]);
    // Ground + fence stamps contradict the map → audited
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sub 'ground'"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sub 'fence'"));
  });

  it('Braidon single-system: map 405 beats 440 stamps (register: 8.6% oversell dies)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map: SubSystemEquipmentMap = {
      roof: { key: 'roof', panelId: 'rec-alpha-pure-405', source: 'engineering', updatedAt: 't' },
    };
    const r = computeNameplateKw(repeat(31, () => stamp('roof', 440)), map, getPanelById);
    // 31×405 = 12555 W, not 13.64. (12.55 not 12.56: legacy parseFloat(toFixed(2))
    // parity — binary 12.555 sits just below the half-cent, JS rounds down.)
    expect(r.totalKw).toBe(12.55);
    expect(r.subs[0].wattsSource).toBe('map');
  });

  it('map-less project: byte-identical to legacy stamp sum incl. 400 default', () => {
    const panels = [...repeat(3, () => stamp('roof', 440)), { systemType: 'roof' }];
    const r = computeNameplateKw(panels, undefined, getPanelById);
    // legacy: avg((440*3+400)/4)*4/1000 = 1.72
    expect(r.totalKw).toBe(1.72);
    expect(r.subs[0]).toMatchObject({ key: 'roof', count: 4, watts: 440, wattsSource: 'stamps' });
  });

  it('map lacks one sub: that sub falls back to stamps WITH a warn; others stay map-authoritative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map: SubSystemEquipmentMap = {
      roof: { key: 'roof', panelId: 'rec-alpha-pure-405', source: 'design', updatedAt: 't' },
    };
    const panels = [...repeat(2, () => stamp('roof', 999)), ...repeat(3, () => stamp('fence', 430))];
    const r = computeNameplateKw(panels, map, getPanelById);
    expect(r.subs.find(s => s.key === 'roof')).toMatchObject({ watts: 405, wattsSource: 'map' });
    expect(r.subs.find(s => s.key === 'fence')).toMatchObject({ watts: 430, kw: 1.29, wattsSource: 'stamps' });
    expect(r.totalKw).toBe(2.1); // 2×405 + 3×430 = 2100 W
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("map lacks this sub"));
  });

  it('unresolvable map panelId: warns and falls back to stamps (never trusts a ghost id)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map: SubSystemEquipmentMap = {
      roof: { key: 'roof', panelId: 'ghost-panel-999', source: 'migration', updatedAt: 't' },
    };
    const r = computeNameplateKw(repeat(10, () => stamp('roof', 405)), map, getPanelById);
    expect(r.subs[0]).toMatchObject({ watts: 405, wattsSource: 'stamps' });
    expect(r.totalKw).toBe(4.05);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not resolve'));
  });

  it('membership honors placementType stamps and canonical spellings', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const panels = [
      { placementType: 'FENCE', wattage: 430 },
      { systemType: 'solar_fence', wattage: 430 },
      { systemType: 'ground_mount', wattage: 405 },
      { placementType: 'GROUND', wattage: 405 },
      { wattage: 405 }, // default roof
    ];
    const r = computeNameplateKw(panels, STOWELL_MAP, getPanelById);
    expect(r.subs.map(s => [s.key, s.count])).toEqual([['roof', 1], ['ground', 2], ['fence', 2]]);
    // roof 405 + ground 2×580 + fence 2×440 = 2445 W (2.44: toFixed float parity)
    expect(r.totalKw).toBe(2.44);
  });

  it('empty panels: zero result, no subs', () => {
    const r = computeNameplateKw([], STOWELL_MAP, getPanelById);
    expect(r).toEqual({ subs: [], totalPanels: 0, totalKw: 0 });
  });
});
