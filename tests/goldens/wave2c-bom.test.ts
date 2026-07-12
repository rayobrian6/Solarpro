// ============================================================================
// Wave 2c — per-sub-system BOM generation (contract §1.7 / §3 Wave 2c).
// docs/ARCHITECTURE-per-subsystem-equipment.md
//
// Proves:
//  • Legacy inputs (no map / single-entry map / N>1 map without counts) take
//    the EXACT old code path — line-for-line identical, no subSystem stamps
//    (Invariant I-1; byte identity itself is pinned by wave0-bom-legacy).
//  • Hybrid Enphase-roof(48) + Solis-ground(26) + EcoFlow-fence(17):
//    3 module lines at subset counts/watts, Q-cable drops 48 (not 91),
//    Solis string DC wire present, per-brand combiner with the REAL branch
//    count, ONE Stage-4 AC set, truck stock per present brand group, every
//    sub-scoped line stamped subSystem (Invariants I-3, I-6).
//  • RSD keys on the ROOF sub's own inverter: IQ8 (integrated) → 0 add-on
//    devices; roof string inverter without integrated RSD → 48 TS4-A-F
//    (Invariant I-7). Optimizer fence emits its own per-module MLPE.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { generateBOMV4, type BOMGenerationInputV4 } from '../../lib/bom-engine-v4';
import type { SubSystemEquipment, SubSystemKey } from '../../lib/system/subSystemEquipment';
import { bomMicroInput } from './wave0-fixtures';

type Result = ReturnType<typeof generateBOMV4>;

const lineProjection = (bom: Result): string[] =>
  bom.items.map(i =>
    `${i.stageId}|${i.category}|${i.manufacturer}|${i.model}|${i.partNumber}|${i.quantity}|${i.unit}`,
  );

const NOW = '2026-07-12T00:00:00.000Z';

const sub = (key: SubSystemKey, over: Partial<SubSystemEquipment>): SubSystemEquipment => ({
  key,
  source: 'engineering',
  updatedAt: NOW,
  ...over,
});

// ── The Stowell-class hybrid: Enphase micro roof + Solis string ground +
//    EcoFlow hybrid fence — three ecosystems, three panels, one POI. ─────────
const roofEq = () => sub('roof', {
  panelId: 'rec-alpha-pure-r-405',
  inverterId: 'enphase-iq8plus',
  topology: 'micro',
  ecosystemBrand: 'enphase',
  mountingId: 'ironridge-xr100',
  roofType: 'shingle',
  env: { rooftopTempAdderC: 30 },
});
const groundEq = () => sub('ground', {
  panelId: 'qcells-q-peak-duo-400',
  inverterId: 'solis-s6-eh1p-7p6k-us',
  topology: 'string',
  ecosystemBrand: 'solis',
  trenchRunLengthFt: 80,
  env: { rooftopTempAdderC: 0, wireLengthFt: 120 },
});
const fenceEq = () => sub('fence', {
  panelId: 'panel-fence-ps1',
  inverterId: 'ecoflow-power-ocean-10kw',
  topology: 'string',
  ecosystemBrand: 'ecoflow',
  trenchRunLengthFt: 40,
  env: { rooftopTempAdderC: 0, wireLengthFt: 60 },
});

function hybridInput(over: Partial<BOMGenerationInputV4> = {}): BOMGenerationInputV4 {
  return {
    // Legacy mirror fields (primary sub) — the map is the authority.
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 91, deviceCount: 48, stringCount: 4, inverterCount: 50,
    systemKw: 36.9, acOutputKw: 31.8,
    dcWireGauge: '#10 AWG', acWireGauge: '#6 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 96, railSections: 24,
    mainPanelAmps: 200, backfeedAmps: 0, acOCPD: 60, dcOCPD: 30,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    includeTruckStock: true, includeSuggestedTools: false,
    subSystemCounts: { roof: 48, ground: 26, fence: 17 },
    roofStringCount: 5,
    subSystemEquipment: { roof: roofEq(), ground: groundEq(), fence: fenceEq() },
    ...over,
  } as BOMGenerationInputV4;
}

// ════════════════════════════════════════════════════════════════════════════
describe('Wave 2c — legacy inputs keep the exact old code path (I-1)', () => {
  it('no map: identical lines, zero subSystem stamps', () => {
    const bom = generateBOMV4(bomMicroInput());
    expect(bom.items.every(i => i.subSystem === undefined)).toBe(true);
  });

  it('single-entry map (N=1): line-for-line identical to no map at all', () => {
    const plain = generateBOMV4(bomMicroInput());
    const mapped = generateBOMV4({
      ...bomMicroInput(),
      subSystemEquipment: { roof: roofEq() },
    } as BOMGenerationInputV4);
    expect(lineProjection(mapped)).toEqual(lineProjection(plain));
    expect(mapped.items.every(i => i.subSystem === undefined)).toBe(true);
  });

  it('N>1 map WITHOUT subSystemCounts: falls back to the legacy path', () => {
    const plain = generateBOMV4(bomMicroInput());
    const mapped = generateBOMV4({
      ...bomMicroInput(),
      subSystemCounts: undefined,
      subSystemEquipment: { roof: roofEq(), fence: fenceEq() },
    } as BOMGenerationInputV4);
    expect(lineProjection(mapped)).toEqual(lineProjection(plain));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Wave 2c — hybrid Enphase roof(48) + Solis ground(26) + EcoFlow fence(17)', () => {
  const bom = generateBOMV4(hybridInput());
  const byCat = (cat: string) => bom.items.filter(i => i.category === cat);

  it('Stage 1: THREE module lines at subset counts and watts (kills the 94×620W class)', () => {
    const panels = byCat('solar_panel');
    expect(panels).toHaveLength(3);
    const proj = panels.map(p => `${p.manufacturer}|${p.quantity}|${p.subSystem}`);
    expect(proj).toEqual([
      'REC Group|48|roof',
      'Q CELLS|26|ground',
      'Philadelphia Solar|17|fence',
    ]);
    expect(panels[0].description).toContain('405W');
    expect(panels[1].description).toContain('400W');
    expect(panels[2].description).toContain('440W');
  });

  it('Stage 2: Q-cable drops = 48 roof devices, NOT 91 project modules', () => {
    const trunk = byCat('trunk_cable');
    expect(trunk).toHaveLength(1);
    expect(trunk[0].partNumber).toBe('Q-12-10-240');
    expect(trunk[0].quantity).toBe(48);
    expect(trunk[0].subSystem).toBe('roof');
    // IQ8 = 13/branch → ceil(48/13) = 4 branches → 4 terminators.
    const term = bom.items.find(i => i.partNumber === 'Q-TERM-10');
    expect(term?.quantity).toBe(4);
    expect(term?.subSystem).toBe('roof');
  });

  it('Stage 2: Solis ground gets its own string DC wiring + trench conduit; EcoFlow fence too', () => {
    const dcWires = bom.items.filter(i => i.stageId === 'dc' && i.category === 'wire');
    const ground = dcWires.find(i => i.subSystem === 'ground');
    const fence = dcWires.find(i => i.subSystem === 'fence');
    expect(ground?.quantity).toBe(Math.ceil(120 * 2 * 1.15)); // 276
    expect(fence?.quantity).toBe(Math.ceil(60 * 2 * 1.15));   // 138
    // Buried trench = underground PVC, SEPARATE raceway per sub (Addendum B).
    const pvc = bom.items.filter(i => i.model.includes('PVC Sch 40'));
    expect(pvc.map(p => `${p.subSystem}|${p.quantity}`)).toEqual(['ground|92', 'fence|46']);
    // Two per-sub DC disconnects (one per string sub).
    const dcDiscos = bom.items.filter(i => i.stageId === 'dc' && i.category === 'disconnect');
    expect(dcDiscos.map(d => d.subSystem)).toEqual(['ground', 'fence']);
    expect(bom.complianceNotes.join(' ')).toContain('share ONE combined trench');
  });

  it('Stage 3: inverter lines per sub ecosystem; combiner resolved per BRAND GROUP with REAL branch count', () => {
    const inverters = byCat('string_inverter');
    expect(inverters.map(i => `${i.manufacturer}|${i.subSystem}`)).toEqual([
      'Solis|ground',
      'EcoFlow|fence',
    ]);
    // Enphase group: ONE IQ Combiner 6C, roof-scoped, sized from 4 real branches.
    const combiners = byCat('combiner');
    expect(combiners).toHaveLength(1);
    expect(combiners[0].partNumber).toBe('X-IQ-AM1-240-6C');
    expect(combiners[0].subSystem).toBe('roof');
    expect(combiners[0].formula).toBe('branches=4');
    // 6C integrates the gateway — no standalone Enphase gateway line.
    expect(byCat('gateway').filter(g => g.manufacturer === 'Enphase')).toHaveLength(0);
    // EcoFlow monitoring gateway rides its own sub.
    const efMon = byCat('monitoring').find(m => m.manufacturer === 'EcoFlow');
    expect(efMon?.subSystem).toBe('fence');
  });

  it('RSD: IQ8 roof (integrated) → ZERO add-on devices; ground/fence exempt off-building', () => {
    expect(byCat('rapid_shutdown')).toHaveLength(0);
    const notes = bom.complianceNotes.join('\n');
    expect(notes).toContain('Rapid shutdown integrated');
    expect(notes).toContain('ground sub-system (26 modules) exempt');
    expect(notes).toContain('fence sub-system (17 modules) exempt');
  });

  it('Stage 4: ONE service-side AC set from aggregate values (I-6)', () => {
    const acDiscos = bom.items.filter(i => i.stageId === 'ac' && i.category === 'disconnect');
    expect(acDiscos).toHaveLength(1);
    expect(acDiscos[0].subSystem).toBeUndefined();
    // Supply-side tap: one Polaris set (L1/L2/N), no backfeed breaker.
    const taps = bom.items.filter(i => i.category === 'connector' && i.partNumber === 'IPLD350-3' && i.stageId === 'ac');
    expect(taps).toHaveLength(1);
    expect(taps[0].quantity).toBe(3);
    expect(bom.items.filter(i => i.category === 'breaker' && i.stageId === 'ac')).toHaveLength(0);
    // One conduit-fitting set, one grounding electrode system.
    expect(bom.items.filter(i => i.category === 'conduit_fitting' && i.stageId === 'ac')).toHaveLength(4);
    expect(bom.items.filter(i => i.partNumber === 'GR-5/8-8')).toHaveLength(1);
    // Shared service lines carry NO subSystem stamp.
    for (const i of bom.items.filter(x => x.stageId === 'ac' && x.category !== 'junction_box')) {
      expect(i.subSystem, `${i.category} ${i.model}`).toBeUndefined();
    }
  });

  it('Stage 5: roof racking scaled to the roof subset and stamped roof', () => {
    const racking = bom.items.filter(i => i.stageId === 'structural' && i.category === 'racking');
    expect(racking).toHaveLength(1);
    expect(racking[0].subSystem).toBe('roof');
    // Per-module accessory formulas use 48 (roof subset), never 91.
    const structuralRoof = bom.items.filter(i => i.stageId === 'structural' && i.subSystem === 'roof');
    expect(structuralRoof.length).toBeGreaterThan(1);
    for (const i of structuralRoof) {
      expect(i.quantity).toBeLessThanOrEqual(2 * 48); // no project-wide 91-module scaling
    }
    // Shared grounding electrode lines stay unstamped.
    const rod = bom.items.find(i => i.partNumber === 'GR-5/8-8');
    expect(rod?.subSystem).toBeUndefined();
  });

  it('truck stock: micro trunk spares emitted for the PRESENT brand group only', () => {
    const spares = bom.items.filter(i => i.stageId === 'truck_stock');
    const enphaseSpares = spares.filter(s => s.manufacturer === 'Enphase');
    expect(enphaseSpares.map(s => s.partNumber).sort()).toEqual(
      ['Q-CONN-10F', 'Q-CONN-10M', 'Q-SEAL-10', 'Q-TERM-10'],
    );
    for (const s of enphaseSpares) expect(s.subSystem).toBe('roof');
    // No foreign-brand trunk spares.
    expect(spares.some(s => s.manufacturer === 'APsystems')).toBe(false);
    // Roof-attachment extras stamped roof; shared consumables unstamped.
    expect(spares.find(s => s.partNumber === 'LAG-X')?.subSystem).toBe('roof');
    expect(spares.find(s => s.partNumber === 'WIRENUT-ASST')?.subSystem).toBeUndefined();
  });

  it('every sub-scoped line is stamped; stages 1-3 fully attributed', () => {
    // Stage 1 (array) lines are all sub-scoped by construction.
    for (const i of bom.items.filter(x => x.stageId === 'array')) {
      expect(i.subSystem, `${i.category} ${i.model}`).toBeDefined();
    }
    // Stage 2 (dc) lines are all sub-scoped in this fixture (no shared DC).
    for (const i of bom.items.filter(x => x.stageId === 'dc')) {
      expect(i.subSystem, `${i.category} ${i.model}`).toBeDefined();
    }
    // Stage 3 inverter-stage lines (inverters, combiner) all attributed.
    for (const i of bom.items.filter(x => x.stageId === 'inverter')) {
      expect(i.subSystem, `${i.category} ${i.model}`).toBeDefined();
    }
    // nextId stays one-per-line sequential (I-1 mechanics hold on the new path).
    const nums = bom.items.map(i => Number(/^bom-v4-(\d{4,})$/.exec(i.id)![1]));
    for (let k = 1; k < nums.length; k++) expect(nums[k]).toBe(nums[k - 1] + 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Wave 2c — RSD keys on the ROOF sub\'s own inverter (I-7)', () => {
  it('roof string inverter WITHOUT integrated RSD → 48 per-module add-on devices', () => {
    const bom = generateBOMV4(hybridInput({
      subSystemEquipment: {
        roof: sub('roof', {
          panelId: 'rec-alpha-pure-r-405',
          inverterId: 'fronius-primo-8.2', // no integrated RSD
          topology: 'string',
          mountingId: 'ironridge-xr100',
          roofType: 'shingle',
          env: { rooftopTempAdderC: 30 },
        }),
        ground: groundEq(),
        fence: fenceEq(),
      },
    }));
    const rsd = bom.items.filter(i => i.category === 'rapid_shutdown');
    expect(rsd).toHaveLength(1);
    expect(rsd[0].partNumber).toBe('TS4-A-F');
    expect(rsd[0].quantity).toBe(48);       // roof subset, never 91
    expect(rsd[0].subSystem).toBe('roof');
    // The roof sub is string now — it gets its own DC wire + disconnect too.
    const roofDc = bom.items.filter(i => i.stageId === 'dc' && i.subSystem === 'roof');
    expect(roofDc.some(i => i.category === 'wire')).toBe(true);
    expect(roofDc.some(i => i.category === 'disconnect')).toBe(true);
  });

  it('optimizer fence (Tigo TS4-A-O) emits per-module MLPE for ITS 17 modules, no fence RSD', () => {
    const bom = generateBOMV4(hybridInput({
      subSystemEquipment: {
        roof: roofEq(),
        ground: groundEq(),
        fence: sub('fence', {
          panelId: 'panel-fence-ps1',
          inverterId: 'solis-s6-eh1p-5k-us',
          optimizerId: 'tigo-ts4-a-o',
          topology: 'optimizer',
          trenchRunLengthFt: 40,
          env: { rooftopTempAdderC: 0, wireLengthFt: 60 },
        }),
      },
    }));
    const opt = bom.items.filter(i => i.category === 'optimizer');
    expect(opt).toHaveLength(1);
    expect(opt[0].partNumber).toBe('TAP-TS4-A-O');
    expect(opt[0].quantity).toBe(17);
    expect(opt[0].subSystem).toBe('fence');
    // IQ8 roof stays integrated → still zero add-on RSD devices anywhere.
    expect(bom.items.filter(i => i.category === 'rapid_shutdown')).toHaveLength(0);
    // Tigo optimizer's own gateway accessory rides the fence sub.
    const tigoGw = bom.items.find(i => i.category === 'gateway' && i.manufacturer === 'Tigo');
    if (tigoGw) expect(tigoGw.subSystem).toBe('fence');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Wave 2c — truck-stock spares per PRESENT brand group (two micro brands)', () => {
  it('Enphase roof + APsystems fence micro → one spare set PER brand, each with its own SKUs', () => {
    const bom = generateBOMV4(hybridInput({
      subSystemEquipment: {
        roof: roofEq(),
        ground: groundEq(),
        fence: sub('fence', {
          panelId: 'panel-fence-ps1',
          inverterId: 'apsystems-ds3',
          topology: 'micro',
          ecosystemBrand: 'apsystems',
          env: { rooftopTempAdderC: 0 },
        }),
      },
    }));
    const spares = bom.items.filter(i => i.stageId === 'truck_stock' && ['connector', 'sealing_cap', 'terminator'].includes(i.category));
    const enphase = spares.filter(s => s.manufacturer === 'Enphase');
    const aps = spares.filter(s => s.manufacturer === 'APsystems');
    expect(enphase.length).toBeGreaterThanOrEqual(3);
    expect(aps.length).toBeGreaterThanOrEqual(3);
    expect(aps.map(s => s.partNumber)).toContain('2300931202'); // AC Bus male splice
    expect(enphase.map(s => s.partNumber)).toContain('Q-CONN-10M');
    for (const s of enphase) expect(s.subSystem).toBe('roof');
    for (const s of aps) expect(s.subSystem).toBe('fence');
    // Each brand also gets its own trunk drops in Stage 2.
    const trunks = bom.items.filter(i => i.category === 'trunk_cable');
    expect(trunks.map(t => `${t.manufacturer}|${t.subSystem}`).sort()).toEqual([
      'APsystems|fence', 'Enphase|roof',
    ]);
  });
});
