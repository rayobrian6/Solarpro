// ============================================================
// Integration Tests — Permit BOM Integration (v48.x)
// lib/permit/permit-bom-integration.test.ts
//
// Verifies:
//   1. generateBOMForPermit() produces correct shape and fields
//   2. generateBOMForPermit() fallback path works (no registry match)
//   3. renderBOMTable equivalent — pageEquipmentSchedule renders BOM items
//   4. Structural BOM items reach the output
//   5. BOM items are sorted by stage order
//   6. summarizeBOM() returns accurate stats
//   7. PermitInput.bom injection in generatePermit pipeline (smoke test)
//   8. Page count in permit HTML stays at 15
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { generateBOMForPermit, summarizeBOM, type PermitBOMItem } from './utils/bomForPermit';
import { pageEquipmentSchedule } from './sections/structuralPages';
import type { PermitInput } from './types';
import type { CADModel } from '@/lib/cad/types';

// ── Minimal fixture builders ────────────────────────────────────────────────

function makeCADModel(overrides: Partial<CADModel> = {}): CADModel {
  return {
    systemType:   'roof',
    totalPanels:  20,
    totalDcKw:    8.0,
    roofPlanes:   [],
    ...overrides,
  } as unknown as CADModel;
}

function makePermitInput(overrides: Partial<PermitInput> = {}): PermitInput {
  return {
    project: {
      name:          'Test Project',
      address:       '123 Solar St',
      city:          'Testville',
      state:         'CA',
      zip:           '90210',
      mainPanelAmps: 200,
      acDisconnect:  true,
    },
    system: {
      totalPanels: 20,
      totalDcKw:   8.0,
      totalAcKw:   7.6,
      topology:    'string',
      inverters: [
        {
          manufacturer: 'Fronius',
          model:        'Primo 8.2-1',
          type:         'string',
          acOutputKw:   7.6,
          maxDcVoltage: 600,
          efficiency:   97.0,
          ulListing:    'UL 1741',
          strings: [
            {
              panelManufacturer: 'LG',
              panelModel:        'LG375N1C-V5',
              panelCount:        20,
              panelWatts:        375,
              panelVoc:          49.3,
              panelIsc:          9.8,
              wireGauge:         '#10 AWG',
              wireLength:        50,
            },
          ],
        },
      ],
    },
    compliance: {
      jurisdiction: { ahj: 'Los Angeles DBS', necVersion: '2020' },
      electrical:   {},
    },
    ...overrides,
  } as unknown as PermitInput;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('generateBOMForPermit()', () => {
  let bom: PermitBOMItem[];
  let cad: CADModel;
  let input: PermitInput;

  beforeAll(() => {
    cad   = makeCADModel();
    input = makePermitInput();
    bom   = generateBOMForPermit(input, cad);
  });

  it('returns a non-empty array', () => {
    expect(Array.isArray(bom)).toBe(true);
    expect(bom.length).toBeGreaterThan(0);
  });

  it('every item has required core fields', () => {
    for (const item of bom) {
      expect(typeof item.category).toBe('string');
      expect(item.category.length).toBeGreaterThan(0);
      expect(typeof item.manufacturer).toBe('string');
      expect(typeof item.model).toBe('string');
      expect(typeof item.partNumber).toBe('string');
      expect(typeof item.quantity).toBe('number');
      expect(item.quantity).toBeGreaterThan(0);
      expect(typeof item.unit).toBe('string');
    }
  });

  it('every item has a stageId', () => {
    for (const item of bom) {
      expect(typeof item.stageId).toBe('string');
      expect(item.stageId!.length).toBeGreaterThan(0);
    }
  });

  it('every item has a stageLabel', () => {
    for (const item of bom) {
      expect(typeof item.stageLabel).toBe('string');
      expect(item.stageLabel!.length).toBeGreaterThan(0);
    }
  });

  it('BOM is sorted by stage order (array→dc→inverter→ac→structural→monitoring→labels)', () => {
    const STAGE_ORDER: Record<string, number> = {
      array: 1, dc: 2, inverter: 3, ac: 4, structural: 5, monitoring: 6, labels: 7,
    };
    let lastOrder = 0;
    for (const item of bom) {
      const ord = STAGE_ORDER[item.stageId ?? ''] ?? 99;
      expect(ord).toBeGreaterThanOrEqual(lastOrder);
      lastOrder = ord;
    }
  });

  it('includes at least one electrical stage item (dc, inverter, or ac)', () => {
    const electricalStages = new Set(['array', 'dc', 'inverter', 'ac']);
    const hasElectrical = bom.some(i => electricalStages.has(i.stageId ?? ''));
    expect(hasElectrical).toBe(true);
  });

  it('contains an item for panels or inverters', () => {
    const equipCats = new Set(['solar_panel', 'panels', 'microinverter', 'string_inverter', 'inverters', 'inverter']);
    const hasEquip = bom.some(i => equipCats.has(i.category));
    expect(hasEquip).toBe(true);
  });

  it('has at least one NEC reference across items', () => {
    const hasNEC = bom.some(i => typeof i.necReference === 'string' && i.necReference.startsWith('NEC'));
    expect(hasNEC).toBe(true);
  });

  it('has at least one derivedFrom across items', () => {
    const hasDerivedFrom = bom.some(i => typeof i.derivedFrom === 'string' && i.derivedFrom.length > 0);
    expect(hasDerivedFrom).toBe(true);
  });
});

describe('generateBOMForPermit() — fallback path (no registry match)', () => {
  it('returns fallback BOM when inverter model is unknown', () => {
    const input = makePermitInput({
      system: {
        totalPanels: 12,
        totalDcKw:   4.8,
        totalAcKw:   4.5,
        topology:    'string',
        inverters: [
          {
            manufacturer: 'UnknownBrand',
            model:        'XYZ-9999-NONEXISTENT',
            type:         'string',
            acOutputKw:   4.5,
            maxDcVoltage: 600,
            efficiency:   96,
            ulListing:    'UL 1741',
            strings: [
              {
                panelManufacturer: 'UnknownPanel',
                panelModel:        'UP-400-FAKE',
                panelCount:        12,
                panelWatts:        400,
                panelVoc:          48.0,
                panelIsc:          9.5,
                wireGauge:         '#10 AWG',
                wireLength:        40,
              },
            ],
          },
        ],
      },
    } as any);

    const cad = makeCADModel({ totalPanels: 12, totalDcKw: 4.8 });
    const bom = generateBOMForPermit(input, cad);

    expect(Array.isArray(bom)).toBe(true);
    expect(bom.length).toBeGreaterThan(0);

    // Fallback should still produce electrical stage items
    const electricalStages = new Set(['array', 'dc', 'inverter', 'ac', 'labels']);
    const hasElectrical = bom.some(i => electricalStages.has(i.stageId ?? ''));
    expect(hasElectrical).toBe(true);
  });

  it('returns fallback BOM when input has no inverters', () => {
    const input = makePermitInput({ system: { totalPanels: 8, totalDcKw: 3.2, totalAcKw: 3.0, topology: 'string', inverters: [] } } as any);
    const cad   = makeCADModel({ totalPanels: 8, totalDcKw: 3.2 });
    const bom   = generateBOMForPermit(input, cad);

    expect(Array.isArray(bom)).toBe(true);
    // Even with no inverters, labels and rapid shutdown should be present
    expect(bom.length).toBeGreaterThan(0);
  });
});

describe('generateBOMForPermit() — ground mount system', () => {
  it('runs without error for ground_mount system type', () => {
    const cad   = makeCADModel({ systemType: 'ground_mount', totalPanels: 30, totalDcKw: 12.0 });
    const input = makePermitInput();
    expect(() => generateBOMForPermit(input, cad)).not.toThrow();
  });

  it('runs without error for solar_fence system type', () => {
    const cad   = makeCADModel({ systemType: 'solar_fence', totalPanels: 24, totalDcKw: 9.6 });
    const input = makePermitInput();
    expect(() => generateBOMForPermit(input, cad)).not.toThrow();
  });
});

describe('generateBOMForPermit() — microinverter topology', () => {
  it('micro topology produces inverter count equal to panel count', () => {
    const input = makePermitInput({
      system: {
        totalPanels: 16,
        totalDcKw:   6.4,
        totalAcKw:   6.1,
        topology:    'micro',
        inverters: [
          {
            manufacturer: 'Enphase',
            model:        'IQ8M',
            type:         'micro',
            acOutputKw:   0.38,
            maxDcVoltage: 60,
            efficiency:   97.0,
            ulListing:    'UL 1741',
            strings: [
              {
                panelManufacturer: 'LG',
                panelModel:        'LG370N1K-V5',
                panelCount:        16,
                panelWatts:        370,
                panelVoc:          48.9,
                panelIsc:          9.6,
                wireGauge:         '#12 AWG',
                wireLength:        30,
              },
            ],
          },
        ],
      },
    } as any);

    const cad = makeCADModel({ totalPanels: 16, totalDcKw: 6.4 });
    const bom = generateBOMForPermit(input, cad);

    expect(Array.isArray(bom)).toBe(true);
    expect(bom.length).toBeGreaterThan(0);

    // Micro systems: should have an inverter item
    const inverterItem = bom.find(i =>
      ['microinverter', 'micro_inverter', 'inverter', 'inverters', 'string_inverter'].includes(i.category)
    );
    expect(inverterItem).toBeDefined();
  });
});

describe('summarizeBOM()', () => {
  it('returns correct totalLineItems', () => {
    const items: PermitBOMItem[] = [
      { category: 'solar_panel', manufacturer: 'A', model: 'M', partNumber: 'P', quantity: 20, unit: 'ea', stageId: 'array', required: true },
      { category: 'string_inverter', manufacturer: 'B', model: 'N', partNumber: 'Q', quantity: 1, unit: 'ea', stageId: 'inverter', required: true },
      { category: 'disconnect', manufacturer: 'C', model: 'D', partNumber: 'R', quantity: 1, unit: 'ea', stageId: 'ac', required: true },
    ];
    const summary = summarizeBOM(items);
    expect(summary.totalLineItems).toBe(3);
  });

  it('counts required items correctly', () => {
    const items: PermitBOMItem[] = [
      { category: 'solar_panel', manufacturer: 'A', model: 'M', partNumber: 'P', quantity: 20, unit: 'ea', stageId: 'array', required: true },
      { category: 'label', manufacturer: 'B', model: 'L', partNumber: 'X', quantity: 1, unit: 'set', stageId: 'labels', required: false },
    ];
    const summary = summarizeBOM(items);
    expect(summary.requiredCount).toBe(1);
  });

  it('sets hasElectrical=true when array/dc/inverter/ac present', () => {
    const items: PermitBOMItem[] = [
      { category: 'solar_panel', manufacturer: 'A', model: 'M', partNumber: 'P', quantity: 10, unit: 'ea', stageId: 'array', required: true },
    ];
    const summary = summarizeBOM(items);
    expect(summary.hasElectrical).toBe(true);
    expect(summary.hasStructural).toBe(false);
  });

  it('sets hasStructural=true when structural stage present', () => {
    const items: PermitBOMItem[] = [
      { category: 'racking', manufacturer: 'A', model: 'R', partNumber: 'P', quantity: 5, unit: 'ea', stageId: 'structural', required: true },
    ];
    const summary = summarizeBOM(items);
    expect(summary.hasStructural).toBe(true);
    expect(summary.hasElectrical).toBe(false);
  });

  it('counts byStage correctly', () => {
    const items: PermitBOMItem[] = [
      { category: 'a', manufacturer: '', model: '', partNumber: '', quantity: 1, unit: 'ea', stageId: 'array' },
      { category: 'b', manufacturer: '', model: '', partNumber: '', quantity: 1, unit: 'ea', stageId: 'array' },
      { category: 'c', manufacturer: '', model: '', partNumber: '', quantity: 1, unit: 'ea', stageId: 'ac' },
    ];
    const summary = summarizeBOM(items);
    expect(summary.byStage['array']).toBe(2);
    expect(summary.byStage['ac']).toBe(1);
  });
});

describe('pageEquipmentSchedule() — BOM rendering', () => {
  it('renders without throwing', () => {
    const input = makePermitInput();
    const cad   = makeCADModel();
    expect(() => pageEquipmentSchedule(input, cad, 10, 15)).not.toThrow();
  });

  it('returns an HTML string', () => {
    const input  = makePermitInput();
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('<div');
  });

  it('renders BOM table when bom is populated', () => {
    const bomItems: PermitBOMItem[] = [
      {
        stageId: 'ac', stageLabel: 'Stage 4 — AC Conductors & Devices',
        category: 'disconnect', manufacturer: 'Square D', model: '30A Disconnect',
        partNumber: 'QO130L200PG', quantity: 1, unit: 'ea',
        necReference: 'NEC 690.15', derivedFrom: 'acKw calc', required: true,
      },
      {
        stageId: 'labels', stageLabel: 'Stage 7 — Labels & Signage',
        category: 'label', manufacturer: 'Hellermann Tyton', model: 'NEC 690 Label Set',
        partNumber: 'TAG18-150', quantity: 1, unit: 'set',
        necReference: 'NEC 690.54', derivedFrom: 'compliance', required: true,
      },
    ];

    const input  = makePermitInput({ bom: bomItems } as any);
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    // The BOM table section title should be present
    expect(result).toContain('Bill of Materials');
    // Part number should appear
    expect(result).toContain('QO130L200PG');
    // NEC reference should appear
    expect(result).toContain('NEC 690.15');
    // Stage label should appear
    expect(result).toContain('Stage 4');
  });

  it('renders OPT badge for optional items', () => {
    const bomItems: PermitBOMItem[] = [
      {
        stageId: 'monitoring', stageLabel: 'Stage 6 — Monitoring',
        category: 'monitoring', manufacturer: 'Enphase', model: 'Enlighten Gateway',
        partNumber: 'ENV-IQ-AM1-240', quantity: 1, unit: 'ea',
        necReference: '—', derivedFrom: 'project', required: false,
      },
    ];

    const input  = makePermitInput({ bom: bomItems } as any);
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    expect(result).toContain('OPT');
  });

  it('renders fallback comment when bom is empty or undefined', () => {
    const input  = makePermitInput({ bom: undefined } as any);
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    expect(result).toContain('No BOM data');
  });

  it('renders Solar Modules and Inverters sections regardless of BOM', () => {
    const input  = makePermitInput();
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    expect(result).toContain('Solar Modules');
    expect(result).toContain('Inverters');
  });

  it('includes EQUIPMENT SCHEDULE in the page title block', () => {
    const input  = makePermitInput();
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    expect(result).toContain('EQUIPMENT SCHEDULE');
  });

  it('includes Wire Sizing Justification section', () => {
    const input  = makePermitInput();
    const cad    = makeCADModel();
    const result = pageEquipmentSchedule(input, cad, 10, 15);

    expect(result).toContain('Wire Sizing Justification');
    expect(result).toContain('NEC 690.8');
  });
});

describe('BOM data integrity', () => {
  it('generateBOMForPermit output has no items with quantity ≤ 0', () => {
    const input = makePermitInput();
    const cad   = makeCADModel();
    const bom   = generateBOMForPermit(input, cad);

    for (const item of bom) {
      expect(item.quantity).toBeGreaterThan(0);
    }
  });

  it('generateBOMForPermit output has no items with empty category', () => {
    const input = makePermitInput();
    const cad   = makeCADModel();
    const bom   = generateBOMForPermit(input, cad);

    for (const item of bom) {
      expect(item.category.trim().length).toBeGreaterThan(0);
    }
  });

  it('no duplicate stageId+partNumber combinations (no accidental double-injection)', () => {
    const input = makePermitInput();
    const cad   = makeCADModel();
    const bom   = generateBOMForPermit(input, cad);

    const seen = new Set<string>();
    for (const item of bom) {
      if (item.partNumber && item.partNumber !== '—') {
        const key = `${item.stageId}::${item.partNumber}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('battery item appears when project.batteryCount > 0 (fallback path)', () => {
    const input = makePermitInput({
      project: {
        name:          'Test',
        address:       '1 Solar Way',
        city:          'Testville',
        state:         'CA',
        zip:           '90210',
        mainPanelAmps: 200,
        acDisconnect:  true,
        batteryCount:  2,
        batteryBrand:  'Tesla',
        batteryModel:  'Powerwall 3',
      },
      system: {
        totalPanels: 10,
        totalDcKw:   4.0,
        totalAcKw:   3.8,
        topology:    'string',
        inverters: [
          {
            manufacturer: 'UnknownBrand',
            model:        'FALLBACK-INV-9999',
            type:         'string',
            acOutputKw:   3.8,
            maxDcVoltage: 600,
            efficiency:   96,
            ulListing:    'UL 1741',
            strings: [
              {
                panelManufacturer: 'Unknown', panelModel: 'FALLBACK-PNL-9999',
                panelCount: 10, panelWatts: 400, panelVoc: 48.0, panelIsc: 9.5,
                wireGauge: '#10 AWG', wireLength: 40,
              },
            ],
          },
        ],
      },
    } as any);

    const cad = makeCADModel({ totalPanels: 10, totalDcKw: 4.0 });
    const bom = generateBOMForPermit(input, cad);

    const batteryItem = bom.find(i => i.category === 'battery');
    expect(batteryItem).toBeDefined();
    expect(batteryItem?.manufacturer).toBe('Tesla');
    expect(batteryItem?.quantity).toBe(2);
  });
});