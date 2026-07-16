// ============================================================================
// Wave 1b — storage armor (docs/ARCHITECTURE-per-subsystem-equipment.md §1.3–1.6)
//
// Pins:
//  • per-key deep merge in upsertSelectedEquipment (I-4: a fence patch can
//    never drop/overwrite the roof entry);
//  • server-side re-normalization of stale-schema (schemaVersion < 2) writes
//    against a v2 stored engineering_config (§1.3 old-client protection);
//  • deterministic primary-mirror derivation (§1.4 roof > ground > fence;
//    single-entry maps are a no-op = zero live behavior change);
//  • I-5 save-time assertion + repair (drift is never persisted);
//  • §1.6 degenerate-map designVersionId rule (I-9: legacy vs degenerate-
//    tagged identical, multi-entry differs);
//  • batteryKwhPerUnit ⇄ legacy batteryKwh is 1:1 BOTH ways (legacy value is
//    already per-unit — page.tsx:9513 sets it from usableCapacityKwh).
//
// DB access is mocked at the sql-tag layer (same pattern as
// tests/getProjectWithDetails-canonical.test.ts / finalization-cas-claim):
// the mock emulates exactly the jsonb semantics the queries use
// (`||` shallow merge + jsonb_set on the subSystems path).
// Determinism: injectable clocks everywhere; no live Date assertions.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  derivePrimaryMirror,
  derivePrimaryKey,
  deriveConfigScalarsFromMirror,
  deriveSelectedEquipmentFlatFromMirror,
  subSystemEntryFromFlatEquipmentPatch,
  assertMirrorInvariant,
  canonicalIdTuple,
  isDegenerateSubSystemMap,
  finalizeConfigEnvelope,
  renormalizeStaleConfigWrite,
  normalizeSubSystemMap,
} from '../../lib/system/subSystemMirror';
import {
  synthesizeFromLegacyScalars,
  type SubSystemEquipment,
  type SubSystemEquipmentMap,
} from '../../lib/system/subSystemEquipment';
import { reconcileFromEngineeringConfig } from '../../lib/system/selectedEquipment';
import { buildDesignSnapshot } from '../../lib/engineering/designSnapshot';
import type { Project, Layout } from '../../types';

const NOW = '2026-07-12T00:00:00.000Z';
const nowFn = () => NOW;

const entry = (key: 'roof' | 'ground' | 'fence', over: Partial<SubSystemEquipment> = {}): SubSystemEquipment => ({
  key,
  panelId: `panel-${key}`,
  inverterId: `inv-${key}`,
  topology: key === 'fence' ? 'optimizer' : 'micro',
  mountingId: `mount-${key}`,
  source: 'engineering',
  updatedAt: NOW,
  ...over,
});

// ── §1.4 mirror determinism ──────────────────────────────────────────────────

describe('derivePrimaryMirror — deterministic roof > ground > fence (§1.4)', () => {
  it('picks roof over ground over fence regardless of key insertion order', () => {
    const map: SubSystemEquipmentMap = { fence: entry('fence'), roof: entry('roof'), ground: entry('ground') };
    expect(derivePrimaryMirror(map)?.key).toBe('roof');
    expect(derivePrimaryKey(map)).toBe('roof');
  });

  it('ground wins when roof absent; fence only when alone', () => {
    expect(derivePrimaryKey({ fence: entry('fence'), ground: entry('ground') })).toBe('ground');
    expect(derivePrimaryKey({ fence: entry('fence') })).toBe('fence');
  });

  it('single-entry map mirrors identically to the entry (no-op today)', () => {
    const fence = entry('fence');
    expect(derivePrimaryMirror({ fence })).toBe(fence);
  });

  it('absent / empty {} map = no mirror (Wave-1a absent rule)', () => {
    expect(derivePrimaryMirror(undefined)).toBeNull();
    expect(derivePrimaryMirror({})).toBeNull();
    expect(normalizeSubSystemMap({})).toBeNull();
  });

  it('is NEVER a panel-count vote: fence with more of everything still loses to roof', () => {
    const map: SubSystemEquipmentMap = {
      roof: entry('roof', { batteryCount: 0 }),
      fence: entry('fence', { batteryId: 'big-battery', batteryCount: 10, batteryKwhPerUnit: 100 }),
    };
    expect(derivePrimaryMirror(map)?.key).toBe('roof');
  });
});

// ── batteryKwhPerUnit ⇄ batteryKwh 1:1 (both directions) ─────────────────────

describe('battery per-unit 1:1 mapping (legacy batteryKwh IS per-unit)', () => {
  it('legacy → map: synthesizeFromLegacyScalars copies batteryKwh 1:1 (never divides)', () => {
    const e = synthesizeFromLegacyScalars(
      { systemType: 'roof', batteryId: 'tesla-powerwall-3', batteryCount: 3, batteryKwh: 13.5 },
      'roof', NOW,
    );
    expect(e.batteryKwhPerUnit).toBe(13.5);
  });

  it('map → legacy: deriveConfigScalarsFromMirror reverses 1:1 (never multiplies)', () => {
    const scalars = deriveConfigScalarsFromMirror(
      entry('roof', { batteryId: 'tesla-powerwall-3', batteryCount: 3, batteryKwhPerUnit: 13.5 }),
    );
    expect(scalars.batteryKwh).toBe(13.5);
    expect(scalars.batteryCount).toBe(3);
    expect(scalars.batteryId).toBe('tesla-powerwall-3');
  });

  it('map → selected_equipment flat: same 1:1 rule', () => {
    const flat = deriveSelectedEquipmentFlatFromMirror(
      entry('roof', { batteryId: 'tesla-powerwall-3', batteryCount: 2, batteryKwhPerUnit: 27 }),
    );
    expect(flat.batteryKwh).toBe(27);
  });

  it('flat patch → map entry: batteryKwh becomes batteryKwhPerUnit 1:1', () => {
    const e = subSystemEntryFromFlatEquipmentPatch(
      { panelId: 'p1', batteryId: 'b1', batteryCount: 2, batteryKwh: 13.5, source: 'engineering' },
      'roof', NOW,
    );
    expect(e.batteryKwhPerUnit).toBe(13.5);
    expect(e.batteryId).toBe('b1');
  });

  it('mirror.batteryId === null (explicit clear) → legacy clear shape', () => {
    const scalars = deriveConfigScalarsFromMirror(entry('roof', { batteryId: null }));
    expect(scalars).toMatchObject({ batteryId: '', batteryCount: 0, batteryKwh: 0 });
  });
});

// ── I-5 assertion + repair ───────────────────────────────────────────────────

describe('I-5 — mirror === derivePrimaryMirror(map) on the canonical id-tuple', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it('compatible tuples pass (null on either side is unrepresentable, not drift)', () => {
    const res = assertMirrorInvariant(
      { mountingId: 'mount-roof', batteryId: undefined }, // flat store can't show topology/panel
      { roof: entry('roof', { batteryId: 'b1' }) },
      'test-store',
    );
    expect(res.ok).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('strict drift logs console.error and reports the drifted fields', () => {
    const res = assertMirrorInvariant(
      { mountingId: 'WRONG-mount', batteryId: 'WRONG-battery' },
      { roof: entry('roof', { batteryId: 'b1' }), fence: entry('fence') },
      'test-store',
    );
    expect(res.ok).toBe(false);
    expect(res.driftFields).toEqual(['mountingId', 'batteryId']);
    expect(errSpy).toHaveBeenCalledOnce();
    expect(String(errSpy.mock.calls[0][0])).toContain('[I-5 VIOLATION]');
  });

  it('finalizeConfigEnvelope REPAIRS drifted flat scalars from the map (never persists drift)', () => {
    const cfg = {
      systemType: 'roof',
      mountingId: 'stale-mount',
      batteryId: 'stale-battery',
      batteryCount: 9,
      batteryKwh: 99,
      schemaVersion: 2,
      subSystems: {
        roof: entry('roof', { mountingId: 'mount-roof', batteryId: 'b-roof', batteryCount: 2, batteryKwhPerUnit: 13.5 }),
        fence: entry('fence'),
      },
    };
    const { config, changed, i5 } = finalizeConfigEnvelope(cfg);
    expect(changed).toBe(true);
    expect(i5?.ok).toBe(false);
    expect(config.mountingId).toBe('mount-roof');   // repaired from the map
    expect(config.batteryId).toBe('b-roof');
    expect(config.batteryCount).toBe(2);
    expect(config.batteryKwh).toBe(13.5);           // per-unit, 1:1
    expect(cfg.mountingId).toBe('stale-mount');     // pure — input untouched
  });

  it('legacy config (no map) passes through UNCHANGED BY REFERENCE (byte identity)', () => {
    const cfg = { systemType: 'roof', mountingId: 'm1', inverters: [] };
    const res = finalizeConfigEnvelope(cfg);
    expect(res.config).toBe(cfg);
    expect(res.changed).toBe(false);
    expect(res.i5).toBeNull();
  });

  it('single-entry map consistent with scalars: stamps schemaVersion 2, scalars untouched', () => {
    const cfg = {
      systemType: 'fence', mountingId: 'solfence-2', batteryId: '',
      subSystems: { fence: entry('fence', { mountingId: 'solfence-2' }) },
    };
    const { config, i5 } = finalizeConfigEnvelope(cfg);
    expect(config.schemaVersion).toBe(2);           // map present ⇒ v2-aware client
    expect(config.mountingId).toBe('solfence-2');
    expect(i5?.ok).toBe(true);
  });
});

// ── §1.3 re-normalization of stale-schema writes (pure helper) ───────────────

describe('renormalizeStaleConfigWrite — old-client whitelist protection (§1.3)', () => {
  const storedV2 = {
    systemType: 'roof' as const,
    schemaVersion: 2,
    mountingId: 'mount-roof',
    inverters: [
      { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro', subSystemKey: 'roof' as const,
        strings: [{ id: 's1', panelCount: 10, subSystemKey: 'roof' as const }] },
      { id: 'inv-2', inverterId: 'solfence-opt', type: 'optimizer', subSystemKey: 'fence' as const,
        strings: [{ id: 's2', panelCount: 8, subSystemKey: 'fence' as const }] },
    ],
    subSystems: {
      roof: entry('roof', { mountingId: 'mount-roof' }),
      fence: entry('fence', { mountingId: 'solfence-2' }),
    },
    defaultsAppliedBySubSystem: { roof: true, fence: true },
  };

  // What a pre-deploy tab sends: SAME inverters round-tripped through its
  // stale whitelist (tags stripped), no map, no schemaVersion — plus one
  // legitimate flat edit (new mountingId).
  const staleWrite = {
    systemType: 'roof',
    mountingId: 'mount-roof-NEW',
    inverters: [
      { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro',
        strings: [{ id: 's1', panelCount: 10 }] },
      { id: 'inv-2', inverterId: 'solfence-opt', type: 'optimizer',
        strings: [{ id: 's2', panelCount: 8 }] },
    ],
  };

  it('restores stripped tags from the stored config by inverter/string id', () => {
    const { config, retaggedInverters } = renormalizeStaleConfigWrite(staleWrite, {
      storedConfig: storedV2, panelStampKeys: ['roof', 'fence'], now: nowFn,
    });
    const invs = config.inverters as Array<{ id: string; subSystemKey?: string; strings: Array<{ id: string; subSystemKey?: string }> }>;
    expect(retaggedInverters).toBe(2);
    expect(invs.find(i => i.id === 'inv-1')?.subSystemKey).toBe('roof');
    expect(invs.find(i => i.id === 'inv-2')?.subSystemKey).toBe('fence'); // NOT collapsed to roof
    expect(invs.find(i => i.id === 'inv-2')?.strings[0].subSystemKey).toBe('fence');
  });

  it('preserves per-sub equipment the stale client could not see; primary absorbs the flat edit', () => {
    const { config, preservedKeys, primaryKey } = renormalizeStaleConfigWrite(staleWrite, {
      storedConfig: storedV2, panelStampKeys: ['roof', 'fence'], now: nowFn,
    });
    const map = config.subSystems as SubSystemEquipmentMap;
    expect(primaryKey).toBe('roof');
    expect(preservedKeys).toEqual(['fence']);
    expect(map.fence?.mountingId).toBe('solfence-2');       // untouched
    expect(map.roof?.mountingId).toBe('mount-roof-NEW');    // stale client's legit edit
    expect(map.roof?.source).toBe('migration');
  });

  it('never downgrades the envelope: schemaVersion >= stored; defaults sentinel preserved', () => {
    const { config } = renormalizeStaleConfigWrite(staleWrite, {
      storedConfig: { ...storedV2, schemaVersion: 3 }, panelStampKeys: ['roof', 'fence'], now: nowFn,
    });
    expect(config.schemaVersion).toBe(3);
    expect(config.defaultsAppliedBySubSystem).toEqual({ roof: true, fence: true });
  });

  it('explicit battery clear in the flat write clears the primary entry (no resurrection)', () => {
    const stored = {
      ...storedV2,
      subSystems: {
        roof: entry('roof', { batteryId: 'tesla-powerwall-3', batteryCount: 2, batteryKwhPerUnit: 13.5 }),
        fence: entry('fence'),
      },
    };
    const { config } = renormalizeStaleConfigWrite(
      { ...staleWrite, batteryId: '', batteryCount: 0 },
      { storedConfig: stored, panelStampKeys: ['roof', 'fence'], now: nowFn },
    );
    const roof = (config.subSystems as SubSystemEquipmentMap).roof!;
    expect(roof.batteryId).toBeNull();
    expect(roof.batteryCount).toBeUndefined();
    expect(roof.batteryKwhPerUnit).toBeUndefined();
  });

  it('fence-only stored project: untagged write inherits fence, never a bare roof default (I-8)', () => {
    const storedFence = {
      systemType: 'fence' as const, schemaVersion: 2,
      inverters: [],
      subSystems: { fence: entry('fence') },
    };
    const { config, primaryKey } = renormalizeStaleConfigWrite(
      { systemType: 'fence', inverters: [{ id: 'inv-9', inverterId: 'solfence-opt', type: 'optimizer', strings: [] }] },
      { storedConfig: storedFence, panelStampKeys: ['fence'], now: nowFn },
    );
    expect(primaryKey).toBe('fence');
    const invs = config.inverters as Array<{ subSystemKey?: string }>;
    expect(invs[0].subSystemKey).toBe('fence');
    expect(Object.keys(config.subSystems as object)).toEqual(['fence']);
  });
});

// ── upsertSelectedEquipment — per-key deep merge + schemaVersion guard ───────
// The sql-tag mock emulates the exact jsonb semantics the queries rely on:
//   ||        top-level shallow merge (patch keys overwrite)
//   jsonb_set COALESCE(stored,{}) || rest, then subSystems :=
//             COALESCE(stored.subSystems,{}) || subsPatch  (per-KEY merge)

const dbState: { row: { selected_equipment: Record<string, unknown> | null } | null; queries: Array<{ q: string; vals: unknown[] }> } = {
  row: null,
  queries: [],
};

function emulateSql(strings: TemplateStringsArray, ...vals: unknown[]): Promise<unknown[]> {
  const q = strings.join('$');
  dbState.queries.push({ q, vals });
  if (q.includes('ALTER TABLE')) return Promise.resolve([]);
  if (q.includes('SELECT selected_equipment')) {
    return Promise.resolve(dbState.row ? [{ selected_equipment: dbState.row.selected_equipment }] : []);
  }
  if (q.includes('UPDATE projects')) {
    if (!dbState.row) return Promise.resolve([]);
    const stored = (dbState.row.selected_equipment ?? {}) as Record<string, unknown>;
    if (q.includes('jsonb_set')) {
      const rest = JSON.parse(vals[0] as string) as Record<string, unknown>;
      const subs = JSON.parse(vals[1] as string) as Record<string, unknown>;
      const merged = { ...stored, ...rest };
      merged.subSystems = { ...((stored.subSystems as Record<string, unknown>) ?? {}), ...subs };
      dbState.row.selected_equipment = merged;
    } else {
      const patch = JSON.parse(vals[0] as string) as Record<string, unknown>;
      dbState.row.selected_equipment = { ...stored, ...patch };
    }
    return Promise.resolve([{ id: 'row-id' }]);
  }
  return Promise.resolve([]);
}

vi.mock('@/lib/db/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/core')>();
  return { ...actual, getDbReady: async () => emulateSql };
});

import { upsertSelectedEquipment } from '../../lib/db/projects';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_ID = '00000000-0000-0000-0000-0000000000a2';

// ── save-config route mocks (trigger semantics are ROUTE logic) ─────────────
const routeDb: {
  project: Record<string, unknown> | null;
  layout: Record<string, unknown> | null;
  persistedConfigs: string[];
} = { project: null, layout: null, persistedConfigs: [] };

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: USER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getProjectById: async () => routeDb.project,
  getLayoutByProject: async () => routeDb.layout,
  upsertSelectedEquipment: async () => true,
  getDbReady: async () => (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.join('$');
    if (q.includes('UPDATE projects')) {
      routeDb.persistedConfigs.push(vals[0] as string);
      return Promise.resolve([{ id: PROJECT_ID, engineering_updated_at: '2026-07-12T00:00:00Z' }]);
    }
    return Promise.resolve([]);
  },
}));

import { POST as saveConfigPOST } from '../../app/api/engineering/save-config/route';

function saveReq(config: Record<string, unknown>) {
  return new Request('http://localhost/api/engineering/save-config', {
    method: 'POST',
    body: JSON.stringify({ projectId: PROJECT_ID, config }),
  }) as never;
}

describe('upsertSelectedEquipment — deep merge + v2 guard (§1.3, I-4)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dbState.row = { selected_equipment: null };
    dbState.queries = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); errSpy.mockRestore(); });

  it('pure legacy write (no v2 anywhere) uses the exact legacy shallow-merge UPDATE', async () => {
    dbState.row.selected_equipment = { panelId: 'old-panel', batteryCount: 1 };
    const ok = await upsertSelectedEquipment(PROJECT_ID, USER_ID, { panelId: 'new-panel', source: 'design', updatedAt: NOW });
    expect(ok).toBe(true);
    const update = dbState.queries.find(x => x.q.includes('UPDATE projects'))!;
    expect(update.q).toContain("COALESCE(selected_equipment, '{}'::jsonb) ||");
    expect(update.q).not.toContain('jsonb_set');
    expect(dbState.row.selected_equipment).toMatchObject({ panelId: 'new-panel', batteryCount: 1 });
    expect((dbState.row.selected_equipment as Record<string, unknown>).subSystems).toBeUndefined();
    expect((dbState.row.selected_equipment as Record<string, unknown>).schemaVersion).toBeUndefined();
  });

  it('I-4: a fence-only v2 patch can NEVER drop or overwrite the roof entry (per-key deep merge)', async () => {
    dbState.row.selected_equipment = {
      panelId: 'panel-roof', schemaVersion: 2,
      subSystems: { roof: entry('roof') },
    };
    const fence = entry('fence', { source: 'engineering' });
    const ok = await upsertSelectedEquipment(PROJECT_ID, USER_ID, {
      schemaVersion: 2, subSystems: { fence }, source: 'engineering', updatedAt: NOW,
    });
    expect(ok).toBe(true);
    const env = dbState.row.selected_equipment as { subSystems: SubSystemEquipmentMap; panelId?: string; schemaVersion?: number };
    expect(env.subSystems.roof).toEqual(entry('roof'));   // preserved verbatim
    expect(env.subSystems.fence).toEqual(fence);          // added
    // §1.4: merged map now has 2 entries → flat mirror derived from ROOF (primary)
    expect(env.panelId).toBe('panel-roof');
    expect(env.schemaVersion).toBe(2);
    const update = dbState.queries.find(x => x.q.includes('UPDATE projects'))!;
    expect(update.q).toContain('jsonb_set');
  });

  it('§1.4 single writer: v2 patch carrying WRONG flat ids gets them re-derived from the map', async () => {
    dbState.row.selected_equipment = {
      schemaVersion: 2,
      subSystems: { roof: entry('roof') },
    };
    await upsertSelectedEquipment(PROJECT_ID, USER_ID, {
      schemaVersion: 2,
      panelId: 'panel-fence',              // parallel-computed flat id — must lose
      subSystems: { fence: entry('fence') },
      updatedAt: NOW,
    });
    const env = dbState.row.selected_equipment as Record<string, unknown>;
    expect(env.panelId).toBe('panel-roof'); // derived roof > ground > fence
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('[I-5 VIOLATION]'))).toBe(true);
  });

  it('legacy flat write against a v2 multi-entry envelope is RE-MIRRORED into the primary entry, fence preserved', async () => {
    dbState.row.selected_equipment = {
      panelId: 'panel-roof', schemaVersion: 2,
      subSystems: { roof: entry('roof'), fence: entry('fence') },
    };
    // Old-client patch: flat only, no schemaVersion, no map.
    await upsertSelectedEquipment(PROJECT_ID, USER_ID, {
      panelId: 'panel-roof-NEW', batteryId: 'tesla-powerwall-3', batteryCount: 2, batteryKwh: 13.5,
      source: 'engineering', updatedAt: NOW,
    });
    const env = dbState.row.selected_equipment as { subSystems: SubSystemEquipmentMap } & Record<string, unknown>;
    expect(env.subSystems.fence).toEqual(entry('fence'));            // untouched
    expect(env.subSystems.roof?.panelId).toBe('panel-roof-NEW');     // folded into primary
    expect(env.subSystems.roof?.batteryKwhPerUnit).toBe(13.5);       // 1:1 per-unit
    expect(env.panelId).toBe('panel-roof-NEW');                      // flat mirror = f(map)
    expect(env.schemaVersion).toBe(2);                               // never downgraded
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('RE-MIRRORED legacy-client write'))).toBe(true);
  });

  it('returns false when the project row is missing (ownership/dead id)', async () => {
    dbState.row = null;
    expect(await upsertSelectedEquipment(PROJECT_ID, USER_ID, { panelId: 'x' })).toBe(false);
  });
});

// ── save-config ROUTE — re-normalization trigger + legacy byte identity ──────

describe('POST /api/engineering/save-config — Wave 1b guard (§1.3)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    routeDb.project = null;
    routeDb.layout = null;
    routeDb.persistedConfigs = [];
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('LEGACY write + LEGACY stored config persists BYTE-IDENTICAL JSON (Wave-0 bar)', async () => {
    const legacyBody = {
      systemType: 'roof', mountingId: 'ironridge-xr100', batteryId: '', batteryCount: 0,
      inverters: [{ id: 'i1', inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ id: 's1', panelId: 'tesla-tsp-420', panelCount: 20 }] }],
    };
    routeDb.project = { id: PROJECT_ID, engineeringConfig: { systemType: 'roof', mountingId: 'old' }, selectedBatteries: [], batteryCount: 0 };
    const res = await saveConfigPOST(saveReq(legacyBody));
    expect((await (res as Response).json()).success).toBe(true);
    expect(routeDb.persistedConfigs).toHaveLength(1);
    expect(routeDb.persistedConfigs[0]).toBe(JSON.stringify(legacyBody)); // byte-identical
  });

  it('TRIGGER: incoming schemaVersion<2/absent + stored schemaVersion>=2 → server re-normalizes before persisting', async () => {
    routeDb.project = {
      id: PROJECT_ID,
      selectedBatteries: [], batteryCount: 0,
      engineeringConfig: {
        systemType: 'roof', schemaVersion: 2,
        inverters: [
          { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro', subSystemKey: 'roof', strings: [{ id: 's1', panelCount: 10, subSystemKey: 'roof' }] },
          { id: 'inv-2', inverterId: 'solfence-opt', type: 'optimizer', subSystemKey: 'fence', strings: [{ id: 's2', panelCount: 8, subSystemKey: 'fence' }] },
        ],
        subSystems: { roof: entry('roof'), fence: entry('fence', { mountingId: 'solfence-2' }) },
      },
    };
    routeDb.layout = { systemType: 'roof', panels: [{ systemType: 'roof' }, { systemType: 'fence' }] };
    // Stale client: same fleet, tags STRIPPED by its old whitelist; no map/version.
    const staleBody = {
      systemType: 'roof', mountingId: 'mount-roof-NEW',
      inverters: [
        { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ id: 's1', panelCount: 10 }] },
        { id: 'inv-2', inverterId: 'solfence-opt', type: 'optimizer', strings: [{ id: 's2', panelCount: 8 }] },
      ],
    };
    const res = await saveConfigPOST(saveReq(staleBody));
    expect((await (res as Response).json()).success).toBe(true);

    const persisted = JSON.parse(routeDb.persistedConfigs[0]) as Record<string, unknown>;
    expect(persisted.schemaVersion).toBe(2);                                   // envelope not downgraded
    const invs = persisted.inverters as Array<{ id: string; subSystemKey?: string }>;
    expect(invs.find(i => i.id === 'inv-2')?.subSystemKey).toBe('fence');      // tag restored, not collapsed
    const map = persisted.subSystems as SubSystemEquipmentMap;
    expect(map.fence?.mountingId).toBe('solfence-2');                          // unseen sub preserved
    expect(map.roof?.mountingId).toBe('mount-roof-NEW');                       // stale edit lands on primary
    expect(persisted.mountingId).toBe('mount-roof-NEW');                       // §1.4 flat = f(map)
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('RE-NORMALIZED stale-schema client write'))).toBe(true);
  });

  it('NO trigger: v2-aware payload (map, no stamp) passes untouched except schemaVersion:2 stamp', async () => {
    routeDb.project = {
      id: PROJECT_ID, selectedBatteries: [], batteryCount: 0,
      engineeringConfig: { systemType: 'fence', schemaVersion: 2, subSystems: { fence: entry('fence') } },
    };
    const v2Body = {
      systemType: 'fence', mountingId: 'mount-fence',
      inverters: [],
      subSystems: { fence: entry('fence') },
    };
    const res = await saveConfigPOST(saveReq(v2Body));
    expect((await (res as Response).json()).success).toBe(true);
    const persisted = JSON.parse(routeDb.persistedConfigs[0]) as Record<string, unknown>;
    expect(persisted.schemaVersion).toBe(2);
    expect(Object.keys(persisted.subSystems as object)).toEqual(['fence']);    // NOT re-normalized/merged
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('RE-NORMALIZED'))).toBe(false);
  });
});

// ── reconcileFromEngineeringConfig — mirror-derived patch at N>1 ─────────────

describe('reconcileFromEngineeringConfig — §1.4 wiring', () => {
  const projectView = {
    selectedPanel: { id: 'sp-maxeon7-440' },
    selectedInverter: null,
    selectedMounting: null,
    selectedBatteries: [],
    batteryCount: 0,
  } as unknown as Parameters<typeof reconcileFromEngineeringConfig>[1];

  it('multi-entry map: panel comes from the PRIMARY mirror, not the dominant-string vote', () => {
    const cfg = {
      systemType: 'roof',
      batteryId: '', batteryCount: 0,
      // Dominant vote would pick the fence panel (18 > 10) — mirror must win.
      inverters: [
        { id: 'i1', inverterId: 'enphase-iq8plus', type: 'micro',
          strings: [{ id: 's1', panelId: 'tesla-tsp-420', panelCount: 10 }] },
        { id: 'i2', inverterId: 'solfence-opt', type: 'optimizer',
          strings: [{ id: 's2', panelId: 'sp-maxeon7-440', panelCount: 18 }] },
      ],
      subSystems: {
        roof: entry('roof', { panelId: 'tesla-tsp-420' }),
        fence: entry('fence', { panelId: 'sp-maxeon7-440' }),
      },
    };
    const patch = reconcileFromEngineeringConfig(cfg, projectView, NOW);
    expect(patch).not.toBeNull();
    expect(patch!.panelId).toBe('tesla-tsp-420');       // roof mirror, not the 18-panel fence
    expect(patch!.subSystems).toEqual(cfg.subSystems);  // map propagates to selected_equipment
    expect(patch!.schemaVersion).toBe(2);
  });

  it('multi-entry map battery: primary mirror trio, batteryKwhPerUnit → batteryKwh 1:1', () => {
    const cfg = {
      systemType: 'roof',
      batteryId: 'WRONG-parallel-flat', batteryCount: 9, batteryKwh: 99,
      inverters: [],
      subSystems: {
        roof: entry('roof', { panelId: 'sp-maxeon7-440', batteryId: 'tesla-powerwall-3', batteryCount: 2, batteryKwhPerUnit: 13.5 }),
        ground: entry('ground'),
      },
    };
    const patch = reconcileFromEngineeringConfig(cfg, projectView, NOW);
    expect(patch!.batteryId).toBe('tesla-powerwall-3');
    expect(patch!.batteryCount).toBe(2);
    expect(patch!.batteryKwh).toBe(13.5);
  });

  it('legacy config (no map): patch shape unchanged — no subSystems/schemaVersion keys', () => {
    const cfg = {
      systemType: 'roof', batteryId: '', batteryCount: 0,
      inverters: [{ id: 'i1', inverterId: 'x', type: 'micro', strings: [{ id: 's1', panelId: 'tesla-tsp-420', panelCount: 20 }] }],
    };
    const patch = reconcileFromEngineeringConfig(cfg, projectView, NOW);
    expect(patch).not.toBeNull();
    expect(patch!.panelId).toBe('tesla-tsp-420');
    expect('subSystems' in patch!).toBe(false);
    expect('schemaVersion' in patch!).toBe(false);
  });
});

// ── §1.6 designVersionId degenerate-map hash rule (I-9) ──────────────────────

describe('computeDesignVersionId — §1.6 degenerate-map rule (via buildDesignSnapshot)', () => {
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

  it('degenerate single-entry map (id-tuple matches flat mirror) hashes the LEGACY shape — no false staleness', () => {
    const legacy = vid(baseProject);
    const tagged = vid({
      ...baseProject,
      selectedEquipmentSubSystems: {
        roof: { key: 'roof', panelId: 'panel-roof', source: 'migration', updatedAt: NOW },
      },
    } as Project);
    expect(tagged).toBe(legacy);
  });

  it('rename/provenance immune: batteryKwhPerUnit + source/updatedAt never affect the hash', () => {
    const a = vid({
      ...baseProject,
      selectedEquipmentSubSystems: { roof: { key: 'roof', panelId: 'panel-roof', source: 'migration', updatedAt: NOW } },
    } as Project);
    const b = vid({
      ...baseProject,
      selectedEquipmentSubSystems: { roof: { key: 'roof', panelId: 'panel-roof', batteryKwhPerUnit: 13.5, batteryCount: 0, source: 'engineering', updatedAt: '2030-01-01T00:00:00Z' } },
    } as Project);
    expect(b).toBe(a);
  });

  it('multi-entry map DIFFERS from legacy (genuine hybridization flips the hash)', () => {
    const legacy = vid(baseProject);
    const hybrid = vid({
      ...baseProject,
      selectedEquipmentSubSystems: {
        roof: { key: 'roof', panelId: 'panel-roof', source: 'engineering', updatedAt: NOW },
        fence: { key: 'fence', panelId: 'panel-fence', topology: 'optimizer', source: 'engineering', updatedAt: NOW },
      },
    } as Project);
    expect(hybrid).not.toBe(legacy);
  });

  it('single-entry map with DRIFTED id-tuple flips the hash (map/mirror drift is visible — I-9)', () => {
    const legacy = vid(baseProject);
    const drifted = vid({
      ...baseProject,
      selectedEquipmentSubSystems: {
        roof: { key: 'roof', panelId: 'panel-DIFFERENT', source: 'engineering', updatedAt: NOW },
      },
    } as Project);
    expect(drifted).not.toBe(legacy);
  });

  it('multi-entry hash is deterministic across map key insertion order', () => {
    const roof = { key: 'roof' as const, panelId: 'panel-roof', source: 'engineering' as const, updatedAt: NOW };
    const fence = { key: 'fence' as const, panelId: 'panel-fence', source: 'engineering' as const, updatedAt: NOW };
    const a = vid({ ...baseProject, selectedEquipmentSubSystems: { roof, fence } } as Project);
    const b = vid({ ...baseProject, selectedEquipmentSubSystems: { fence, roof } } as Project);
    expect(b).toBe(a);
  });

  it('isDegenerateSubSystemMap: absent map is degenerate; two entries never are', () => {
    const flat = canonicalIdTuple({ panelId: 'panel-roof' });
    expect(isDegenerateSubSystemMap(undefined, flat)).toBe(true);
    expect(isDegenerateSubSystemMap({ roof: entry('roof', { panelId: 'panel-roof', inverterId: undefined, topology: undefined, mountingId: undefined }) }, flat)).toBe(true);
    expect(isDegenerateSubSystemMap({ roof: entry('roof'), fence: entry('fence') }, flat)).toBe(false);
  });
});
