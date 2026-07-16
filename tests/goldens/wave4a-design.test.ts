// ============================================================================
// Wave 4A — design-side writers (docs/ARCHITECTURE-per-subsystem-equipment.md
// §1.3/§1.4/§1.6, Wave 4 Lane A)
//
// Pins:
//  • buildDesignElectricalBlock: hybrid panel stamps → per-sub subSystems[]
//    blocks + flat mirror = PRIMARY sub (roof > ground > fence); single-type
//    designs emit the flat block ONLY, value-identical to the legacy writer;
//  • §1.6 stability: single-type designs never grow a map (designVersionId
//    unchanged — degenerate rule re-asserted through buildDesignSnapshot);
//  • /api/projects/[id]/equipment: scoped hybrid pick → v2 per-sub entry
//    (+ schemaVersion 2); flat fields ride along ONLY for the primary key;
//    un-scoped/single-type picks stay byte-identical legacy flat writes;
//  • /api/projects/[id]/layout: the PROJECT-WIDE panelId promotion is retired
//    when the design carries a v2 split — per-sub map write + flat scoped to
//    the primary sub (cooperates with the page's `${key}:${panelId}` scoped
//    reconcile); legacy single-type promotion byte-identical;
//  • designToPermitInverters: per-sub PermitInverter sets w/ subSystemKey tags
//    (inverter + strings) from each sub's OWN equipment (I-3); flat fallback
//    byte-identical with NO subSystemKey property (I-1).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDesignElectricalBlock,
  designSubSystemBlocks,
  presentDesignSubSystemKeys,
  designToPermitInverters,
} from '../../lib/system/designToEngineering';
import { buildDesignSnapshot } from '../../lib/engineering/designSnapshot';
import { SOLAR_PANELS } from '../../lib/equipment-db';
import type { DesignElectrical, Project, Layout } from '../../types';

const NOW = '2026-07-12T00:00:00.000Z';

// ── Fixture: 6 stamped panels, 3 sub-systems, 3 strings ─────────────────────
// String 0 spans roof only; string 1 SPANS ground+fence (split must follow the
// stamps, not the string); string 2 fence only.
const HYBRID_PANELS = [
  { id: 'p-r1', systemType: 'roof' },
  { id: 'p-r2', systemType: 'roof' },
  { id: 'p-g1', systemType: 'ground' },
  { id: 'p-g2', systemType: 'ground_mount' },     // canonical spelling
  { id: 'p-f1', placementType: 'FENCE' },
  { id: 'p-f2', systemType: 'solar_fence' },
];
const HYBRID_ASSIGNMENT: Record<string, number> = {
  'p-r1': 0, 'p-r2': 0,
  'p-g1': 1, 'p-g2': 1, 'p-f1': 1,                // string 1 spans ground+fence
  'p-f2': 2,
};

const ROOF_ONLY_PANELS = [
  { id: 'p1', systemType: 'roof' }, { id: 'p2' }, { id: 'p3', systemType: 'roof' },
];
const ROOF_ONLY_ASSIGNMENT: Record<string, number> = { p1: 0, p2: 0, p3: 1 };

const baseInput = {
  topology: 'micro' as const,
  inverterBrand: 'Enphase',
  modulesPerString: 10,
  rackingId: 'ironridge-xr100',
  panelId: 'tesla-tsp-420',
  optimizerModelId: undefined,
  microModelId: 'enphase-iq8a',
  overrides: undefined,
  generatedAt: NOW,
};

// ── 1. Split writer ──────────────────────────────────────────────────────────

describe('buildDesignElectricalBlock — §1.3 per-sub split writer', () => {
  it('single-type design: flat block only, value-identical to the legacy writer', () => {
    const de = buildDesignElectricalBlock({
      panels: ROOF_ONLY_PANELS, assignmentByPanelId: ROOF_ONLY_ASSIGNMENT,
      ...baseInput, deviceCount: 3,
    });
    // Exact legacy shape (field order pinned via JSON serialization).
    expect(JSON.stringify(de)).toBe(JSON.stringify({
      topology: 'micro',
      inverterBrand: 'Enphase',
      modulesPerString: 10,
      rackingId: 'ironridge-xr100',
      panelId: 'tesla-tsp-420',
      microModelId: 'enphase-iq8a',
      byPanelId: { p1: 0, p2: 0, p3: 1 },
      strings: [
        { stringIndex: 0, panelCount: 2, panelIds: ['p1', 'p2'] },
        { stringIndex: 1, panelCount: 1, panelIds: ['p3'] },
      ],
      deviceCount: 3,
      generatedAt: NOW,
    }));
    expect(de.subSystems).toBeUndefined();
  });

  it('hybrid stamps → 3 sub blocks in fixed roof > ground > fence order', () => {
    const de = buildDesignElectricalBlock({
      panels: HYBRID_PANELS, assignmentByPanelId: HYBRID_ASSIGNMENT,
      ...baseInput, deviceCount: 6,
    });
    expect(de.subSystems?.map(s => s.key)).toEqual(['roof', 'ground', 'fence']);
    const [roof, ground, fence] = de.subSystems!;
    expect(roof.byPanelId).toEqual({ 'p-r1': 0, 'p-r2': 0 });
    expect(ground.byPanelId).toEqual({ 'p-g1': 1, 'p-g2': 1 });
    expect(fence.byPanelId).toEqual({ 'p-f1': 1, 'p-f2': 2 });
    // String 1 spans ground+fence: each block carries ITS panels only.
    expect(ground.strings).toEqual([{ stringIndex: 1, panelCount: 2, panelIds: ['p-g1', 'p-g2'] }]);
    expect(fence.strings).toEqual([
      { stringIndex: 1, panelCount: 1, panelIds: ['p-f1'] },
      { stringIndex: 2, panelCount: 1, panelIds: ['p-f2'] },
    ]);
    // Each block records the (single-selection) equipment ids.
    expect(roof.topology).toBe('micro');
    expect(roof.microModelId).toBe('enphase-iq8a');
    expect(roof.rackingId).toBe('ironridge-xr100');
  });

  it('hybrid flat block = PRIMARY (roof) mirror — never the whole-design mix (§1.4)', () => {
    const de = buildDesignElectricalBlock({
      panels: HYBRID_PANELS, assignmentByPanelId: HYBRID_ASSIGNMENT,
      ...baseInput, deviceCount: 6,
    });
    expect(de.byPanelId).toEqual({ 'p-r1': 0, 'p-r2': 0 });
    expect(de.strings).toEqual([{ stringIndex: 0, panelCount: 2, panelIds: ['p-r1', 'p-r2'] }]);
    expect(de.deviceCount).toBe(2); // micro devices = the ROOF sub's panels
  });

  it('ground+fence hybrid (no roof): primary mirror = ground', () => {
    const de = buildDesignElectricalBlock({
      panels: HYBRID_PANELS.filter(p => !String(p.systemType ?? '').startsWith('roof')),
      assignmentByPanelId: { 'p-g1': 1, 'p-g2': 1, 'p-f1': 1, 'p-f2': 2 },
      ...baseInput, topology: 'string', microModelId: undefined, deviceCount: 0,
    });
    expect(de.subSystems?.map(s => s.key)).toEqual(['ground', 'fence']);
    expect(de.byPanelId).toEqual({ 'p-g1': 1, 'p-g2': 1 });
    expect(de.deviceCount).toBe(0); // string topology: no devices
  });

  it('presentDesignSubSystemKeys partitions in fixed order', () => {
    expect(presentDesignSubSystemKeys(HYBRID_PANELS)).toEqual(['roof', 'ground', 'fence']);
    expect(presentDesignSubSystemKeys(ROOF_ONLY_PANELS)).toEqual(['roof']);
    expect(presentDesignSubSystemKeys([])).toEqual([]);
  });
});

// ── 2. designSubSystemBlocks reader + §1.6 hash stability ────────────────────

describe('designSubSystemBlocks — degenerate/absent maps rule flat (§1.6)', () => {
  it('null for absent, empty, single-entry, and panel-less maps', () => {
    expect(designSubSystemBlocks(undefined)).toBeNull();
    expect(designSubSystemBlocks({ subSystems: undefined })).toBeNull();
    expect(designSubSystemBlocks({ subSystems: [] })).toBeNull();
    expect(designSubSystemBlocks({
      subSystems: [{ key: 'fence', topology: 'optimizer', strings: [{ stringIndex: 0, panelCount: 4, panelIds: [] }], byPanelId: {} }],
    })).toBeNull(); // one entry = degenerate → flat block rules
    expect(designSubSystemBlocks({
      subSystems: [
        { key: 'roof', topology: 'micro', strings: [], byPanelId: {} },
        { key: 'fence', topology: 'optimizer', strings: [{ stringIndex: 0, panelCount: 4, panelIds: [] }], byPanelId: {} },
      ],
    })).toBeNull(); // roof has no panels → collapses to one real sub
  });

  it('orders + filters valid hybrid blocks (blocks[0] = primary)', () => {
    const blocks = designSubSystemBlocks({
      subSystems: [
        { key: 'fence', topology: 'optimizer', strings: [{ stringIndex: 1, panelCount: 4, panelIds: [] }], byPanelId: {} },
        { key: 'roof', topology: 'micro', strings: [{ stringIndex: 0, panelCount: 8, panelIds: [] }], byPanelId: {} },
      ],
    })!;
    expect(blocks.map(b => b.key)).toEqual(['roof', 'fence']);
  });
});

describe('designVersionId stays stable for single-type designs (§1.6/I-9)', () => {
  const layout = {
    id: 'lay-1', totalPanels: 20, systemSizeKw: 8.8, updatedAt: '2026-07-07T00:00:00Z',
    panels: [], systemType: 'roof',
  } as unknown as Layout;
  const baseProject = {
    id: 'proj-1', address: '1 Test Ln, Springfield, IL', stateCode: 'IL', lat: 39.8, lng: -89.6,
    selectedPanel: { id: 'panel-roof', manufacturer: 'M', model: 'X', wattage: 440, width: 1.1, height: 1.7, voc: 41, isc: 13 },
    batteryCount: 0,
  } as unknown as Project;
  const vid = (p: Project) => buildDesignSnapshot(p, layout).designVersionId;

  it('a design-written DEGENERATE selected_equipment entry hashes the legacy shape', () => {
    // What the Wave-4A layout route would write for a single-type design: NOTHING
    // (no map). And even if a degenerate single-entry map appears (id-tuple ===
    // flat mirror), the hash must not move.
    const legacy = vid(baseProject);
    const degenerate = vid({
      ...baseProject,
      selectedEquipmentSubSystems: {
        roof: { key: 'roof', panelId: 'panel-roof', source: 'design', updatedAt: NOW },
      },
    } as Project);
    expect(degenerate).toBe(legacy);
  });
});

// ── 3. Route tests — shared mocks ────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-0000000000b1';
const USER_ID = '00000000-0000-0000-0000-0000000000b2';

const captured: { upserts: Array<Record<string, unknown>> } = { upserts: [] };
const routeDb: { project: Record<string, unknown> | null } = { project: null };

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: USER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/engineering/syncPipeline', () => ({
  syncProjectPipeline: async () => ({
    panelCount: 0, artifactsWritten: 0, wasRebuilt: false, errors: [], files: [],
  }),
}));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
  handleRouteDbError: (tag: string, err: unknown) =>
    new Response(JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }), { status: 500 }),
  getProjectById: async () => routeDb.project,
  getLayoutByProject: async () => null,
  upsertLayout: async (input: Record<string, unknown>) => ({ ...input, id: 'lay-1' }),
  saveProjectVersion: async () => undefined,
  getDbReady: async () => (() => Promise.resolve([])),
  upsertSelectedEquipment: async (_pid: string, _uid: string, patch: Record<string, unknown>) => {
    captured.upserts.push(patch);
    return true;
  },
}));

import { POST as equipmentPOST } from '../../app/api/projects/[id]/equipment/route';
import { POST as layoutPOST } from '../../app/api/projects/[id]/layout/route';

const ctx = { params: Promise.resolve({ id: PROJECT_ID }) };
const jsonReq = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body) }) as never;

beforeEach(() => {
  captured.upserts = [];
  routeDb.project = { id: PROJECT_ID, name: 'T', systemType: 'roof', selectedPanel: null };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ── 3a. /api/projects/[id]/equipment ─────────────────────────────────────────

describe('POST /api/projects/[id]/equipment — per-sub scoped write (§1.3)', () => {
  const panel = { id: 'tesla-tsp-420', manufacturer: 'Tesla', model: 'TSP 420' };

  it('hybrid NON-primary pick (fence active): v2 map entry only — NO flat panel fields', async () => {
    const res = await equipmentPOST(jsonReq(`/api/projects/${PROJECT_ID}/equipment`, {
      selectedPanel: panel, subSystem: 'fence', presentKeys: ['roof', 'fence'],
    }), ctx);
    expect((await (res as Response).json()).success).toBe(true);
    expect(captured.upserts).toHaveLength(1);
    const w = captured.upserts[0];
    expect(w.schemaVersion).toBe(2);
    const subs = w.subSystems as Record<string, Record<string, unknown>>;
    expect(Object.keys(subs)).toEqual(['fence']);
    expect(subs.fence).toMatchObject({ key: 'fence', panelId: 'tesla-tsp-420', source: 'design' });
    expect('panelId' in w).toBe(false);   // flat mirror is roof-primary — untouched
    expect('panel' in w).toBe(false);
  });

  it('hybrid PRIMARY pick (roof active): v2 map entry + flat fields ride along', async () => {
    const res = await equipmentPOST(jsonReq(`/api/projects/${PROJECT_ID}/equipment`, {
      selectedPanel: panel, subSystem: 'roof', presentKeys: ['roof', 'fence'],
    }), ctx);
    expect((await (res as Response).json()).success).toBe(true);
    const w = captured.upserts[0];
    expect(w.schemaVersion).toBe(2);
    expect((w.subSystems as Record<string, unknown>).roof).toMatchObject({ key: 'roof', panelId: 'tesla-tsp-420' });
    expect(w.panelId).toBe('tesla-tsp-420');
    expect(w.panel).toEqual(panel);
  });

  it('single-type / un-scoped pick: LEGACY flat write, byte-identical key set', async () => {
    const res = await equipmentPOST(jsonReq(`/api/projects/${PROJECT_ID}/equipment`, {
      selectedPanel: panel,
    }), ctx);
    expect((await (res as Response).json()).success).toBe(true);
    const w = captured.upserts[0];
    expect(Object.keys(w).sort()).toEqual(['panel', 'panelId', 'source', 'updatedAt']);
    expect('schemaVersion' in w).toBe(false);
    expect('subSystems' in w).toBe(false);
  });

  it('scope with single-key stamps (not hybrid) degrades to the legacy flat write', async () => {
    await equipmentPOST(jsonReq(`/api/projects/${PROJECT_ID}/equipment`, {
      selectedPanel: panel, subSystem: 'roof', presentKeys: ['roof'],
    }), ctx);
    const w = captured.upserts[0];
    expect('subSystems' in w).toBe(false);
    expect('schemaVersion' in w).toBe(false);
  });

  it('inverter pick carries topology onto the scoped entry', async () => {
    await equipmentPOST(jsonReq(`/api/projects/${PROJECT_ID}/equipment`, {
      selectedInverter: { id: 'solaredge-se7600h', type: 'optimizer' },
      subSystem: 'ground', presentKeys: ['roof', 'ground'],
    }), ctx);
    const subs = captured.upserts[0].subSystems as Record<string, Record<string, unknown>>;
    expect(subs.ground).toMatchObject({ inverterId: 'solaredge-se7600h', topology: 'optimizer' });
  });
});

// ── 3b. /api/projects/[id]/layout — promotion scoping ────────────────────────

describe('POST /api/projects/[id]/layout — project-wide panelId promotion retired at v2 (§1.4/I-4)', () => {
  const REAL_PANEL = SOLAR_PANELS[0];
  const REAL_PANEL_2 = SOLAR_PANELS.find(p => p.id !== REAL_PANEL.id)!;

  const hybridDesignElectrical = (roofPanelId: string, fencePanelId: string): DesignElectrical => ({
    topology: 'micro',
    modulesPerString: 10,
    panelId: roofPanelId,             // flat = primary mirror
    byPanelId: { 'p-r1': 0 },
    strings: [{ stringIndex: 0, panelCount: 1, panelIds: ['p-r1'] }],
    deviceCount: 1,
    generatedAt: NOW,
    subSystems: [
      { key: 'roof', topology: 'micro', panelId: roofPanelId, rackingId: 'ironridge-xr100',
        strings: [{ stringIndex: 0, panelCount: 1, panelIds: ['p-r1'] }], byPanelId: { 'p-r1': 0 } },
      { key: 'fence', topology: 'optimizer', panelId: fencePanelId, rackingId: 'solfence-nexus',
        strings: [{ stringIndex: 1, panelCount: 2, panelIds: ['p-f1', 'p-f2'] }], byPanelId: { 'p-f1': 1, 'p-f2': 1 } },
    ],
  });

  const layoutBody = (designElectrical: DesignElectrical | undefined) => ({
    panels: [{ id: 'p-r1', systemType: 'roof' }],
    systemType: 'roof',
    designElectrical,
  });

  it('v2 split: per-sub map entries written; flat panel present only because the PRIMARY panel changed', async () => {
    routeDb.project = { id: PROJECT_ID, name: 'T', systemType: 'roof', selectedPanel: { id: REAL_PANEL_2.id } };
    const res = await layoutPOST(jsonReq(`/api/projects/${PROJECT_ID}/layout`,
      layoutBody(hybridDesignElectrical(REAL_PANEL.id, REAL_PANEL_2.id))), ctx);
    expect((await (res as Response).json()).success).toBe(true);
    expect(captured.upserts).toHaveLength(1);
    const w = captured.upserts[0];
    expect(w.schemaVersion).toBe(2);
    const subs = w.subSystems as Record<string, Record<string, unknown>>;
    expect(Object.keys(subs).sort()).toEqual(['fence', 'roof']);
    expect(subs.roof).toMatchObject({ key: 'roof', panelId: REAL_PANEL.id, topology: 'micro', mountingId: 'ironridge-xr100' });
    expect(subs.fence).toMatchObject({ key: 'fence', panelId: REAL_PANEL_2.id, topology: 'optimizer', mountingId: 'solfence-nexus' });
    expect(w.panelId).toBe(REAL_PANEL.id); // primary (roof) changed vs canonical
  });

  it('v2 split with PRIMARY panel unchanged: map write only — NO flat promotion', async () => {
    routeDb.project = { id: PROJECT_ID, name: 'T', systemType: 'roof', selectedPanel: { id: REAL_PANEL.id } };
    await layoutPOST(jsonReq(`/api/projects/${PROJECT_ID}/layout`,
      layoutBody(hybridDesignElectrical(REAL_PANEL.id, REAL_PANEL_2.id))), ctx);
    expect(captured.upserts).toHaveLength(1);
    const w = captured.upserts[0];
    expect(w.schemaVersion).toBe(2);
    expect('panelId' in w).toBe(false);   // fence's differing panel can NOT move the flat mirror
    expect('panel' in w).toBe(false);
  });

  it('legacy single-type design: flat promotion byte-identical (panelId/panel/source/updatedAt)', async () => {
    routeDb.project = { id: PROJECT_ID, name: 'T', systemType: 'roof', selectedPanel: null };
    const de: DesignElectrical = {
      topology: 'micro', modulesPerString: 10, panelId: REAL_PANEL.id,
      byPanelId: { 'p-r1': 0 }, strings: [{ stringIndex: 0, panelCount: 1, panelIds: ['p-r1'] }],
      deviceCount: 1, generatedAt: NOW,
    };
    await layoutPOST(jsonReq(`/api/projects/${PROJECT_ID}/layout`, layoutBody(de)), ctx);
    expect(captured.upserts).toHaveLength(1);
    const w = captured.upserts[0];
    expect(Object.keys(w).sort()).toEqual(['panel', 'panelId', 'source', 'updatedAt']);
    expect(w.panelId).toBe(REAL_PANEL.id);
  });

  it('no designElectrical: no canonical write at all', async () => {
    await layoutPOST(jsonReq(`/api/projects/${PROJECT_ID}/layout`, layoutBody(undefined)), ctx);
    expect(captured.upserts).toHaveLength(0);
  });
});

// ── 4. Reader — per-sub PermitInverter sets ──────────────────────────────────

describe('designToPermitInverters — per-sub sets w/ tags (§1.3/I-3), flat fallback (I-1)', () => {
  const flatDe: DesignElectrical = {
    topology: 'micro',
    inverterBrand: 'Enphase',
    modulesPerString: 12,
    rackingId: 'ironridge-xr100',
    panelId: 'tesla-tsp-420',
    microModelId: 'enphase-iq8a',
    byPanelId: { a: 0, b: 0, c: 1 },
    strings: [
      { stringIndex: 0, panelCount: 2, panelIds: ['a', 'b'] },
      { stringIndex: 1, panelCount: 1, panelIds: ['c'] },
    ],
    deviceCount: 3,
    generatedAt: NOW,
  };

  it('flat block only: exact legacy single-inverter shape, NO subSystemKey property', () => {
    const out = designToPermitInverters(flatDe)!;
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('inv-design-0');
    expect(out[0].inverterId).toBe('enphase-iq8a'); // design-recorded micro wins
    expect(out[0].type).toBe('micro');
    expect(out[0].strings).toHaveLength(2);
    expect('subSystemKey' in out[0]).toBe(false);
    expect(out[0].strings.every(s => !('subSystemKey' in s))).toBe(true);
  });

  it('subSystems present: one tagged inverter PER SUB from that sub\'s OWN equipment', () => {
    const de: DesignElectrical = {
      ...flatDe,
      subSystems: [
        { key: 'roof', topology: 'micro', panelId: 'tesla-tsp-420', rackingId: 'ironridge-xr100',
          microModelId: 'enphase-iq8a',
          strings: [{ stringIndex: 0, panelCount: 2, panelIds: ['a', 'b'] }], byPanelId: { a: 0, b: 0 } },
        { key: 'ground', topology: 'string', panelId: 'canadian-cs6r-410', rackingId: 'ground-rack',
          strings: [{ stringIndex: 1, panelCount: 8, panelIds: [] }], byPanelId: {} },
        { key: 'fence', topology: 'optimizer', panelId: 'philadelphia-430', rackingId: 'solfence-nexus',
          optimizerModelId: 'solfence-opt-800',
          strings: [{ stringIndex: 2, panelCount: 4, panelIds: [] }], byPanelId: {} },
      ],
    };
    const out = designToPermitInverters(de)!;
    expect(out).toHaveLength(3);
    expect(out.map(i => i.subSystemKey)).toEqual(['roof', 'ground', 'fence']);
    expect(out.map(i => i.id)).toEqual(['inv-design-0', 'inv-design-1', 'inv-design-2']);
    // Topology from EACH sub's own equipment — never a project-wide winner (I-3).
    expect(out.map(i => i.type)).toEqual(['micro', 'string', 'optimizer']);
    expect(out[0].inverterId).toBe('enphase-iq8a');           // roof: its own micro
    expect(out[2].optimizerPeripheralId).toBe('solfence-opt-800');
    // Strings inherit the parent tag + carry the sub's own panel/mounting.
    expect(out[0].strings.every(s => s.subSystemKey === 'roof')).toBe(true);
    expect(out[1].strings[0]).toMatchObject({ subSystemKey: 'ground', panelId: 'canadian-cs6r-410', mountingSystem: 'ground-rack' });
    expect(out[2].strings[0]).toMatchObject({ subSystemKey: 'fence', panelId: 'philadelphia-430' });
  });

  it('project-pinned inverter id applies to the PRIMARY sub only (I-4)', () => {
    const de: DesignElectrical = {
      ...flatDe,
      subSystems: [
        { key: 'roof', topology: 'micro', panelId: 'tesla-tsp-420', microModelId: 'enphase-iq8a',
          strings: [{ stringIndex: 0, panelCount: 2, panelIds: [] }], byPanelId: {} },
        { key: 'fence', topology: 'optimizer', panelId: 'philadelphia-430',
          strings: [{ stringIndex: 1, panelCount: 4, panelIds: [] }], byPanelId: {} },
      ],
    };
    const out = designToPermitInverters(de, { selectedInverterId: 'pinned-roof-inverter' })!;
    expect(out[0].inverterId).toBe('pinned-roof-inverter');   // primary honors the pin
    expect(out[1].inverterId).not.toBe('pinned-roof-inverter'); // fence derives its own
  });

  it('degenerate single-entry map falls back to the flat path (no tags)', () => {
    const de: DesignElectrical = {
      ...flatDe,
      subSystems: [
        { key: 'roof', topology: 'micro', panelId: 'tesla-tsp-420',
          strings: [{ stringIndex: 0, panelCount: 2, panelIds: [] }], byPanelId: {} },
      ],
    };
    const out = designToPermitInverters(de)!;
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('inv-design-0');
    expect('subSystemKey' in out[0]).toBe(false);
  });
});
