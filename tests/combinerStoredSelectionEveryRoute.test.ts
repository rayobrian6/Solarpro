// ============================================================================
// ONE READER OF THE INSTALLER'S COMBINER, FOR EVERY ARTEFACT (review, 2026-09-25)
//
// The engineering page reads the stored combiner pick once and posts its copy
// with every request — and that read fails OPEN. The permit route already read
// the store itself; the Diagram SLD, the SLD PDF and the BOM trusted the page's
// copy, so one dropped read left the permit naming the installer's combiner and
// every drawing and the priced BOM naming the catalogue pairing.
// lib/combinerSelection/storedRead is now the one reader all four routes use.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbConfigError } from '@/lib/db-ready';
import {
  readStoredCombinerSelection, effectiveCombinerId, isReadableProjectId,
} from '@/lib/combinerSelection/storedRead';

const PID = '11111111-2222-4333-8444-555555555555';
const FOUR_C = 'enphase-iq-combiner-4c';
const FIVE_C = 'enphase-iq-combiner-5c';

/** A selected_equipment column holding `id` as the active pick (null = cleared). */
const storedPick = (id: string | null) => ({
  combinerSelection: {
    active: id ? { combinerDeviceId: id, recordedAt: '2026-09-25T00:00:00.000Z' } : null,
    superseded: [],
  },
});

// ── A fake DB handle the routes' `getDbReady` returns ──────────────────────
const db = vi.hoisted(() => ({
  mode: 'row' as 'row' | 'no-row' | 'throw' | 'no-db',
  column: null as unknown,
  reads: [] as unknown[],
}));
vi.mock('@/lib/db-neon', async () => {
  const { DbConfigError: Cfg } = await import('@/lib/db-ready');
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.join('?').includes('FROM projects')) return [];
    db.reads.push(values[0]);
    if (db.mode === 'throw') throw new Error('connection reset');
    if (db.mode === 'no-row') return [];
    return [{ selected_equipment: db.column }];
  };
  return {
    getDbReady: vi.fn(async () => {
      if (db.mode === 'no-db') throw new Cfg('DATABASE_URL is not set');
      return sql;
    }),
    handleRouteDbError: (_tag: string, err: unknown) => { throw err instanceof Error ? err : new Error(String(err)); },
  };
});
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

beforeEach(() => { db.mode = 'row'; db.column = null; db.reads = []; });

describe('the reader', () => {
  const fakeSql = (rows: unknown[] | Error) => async () =>
    (async () => { if (rows instanceof Error) throw rows; return rows; }) as never;

  it('a stored pick, a cleared pick, no key and a NULL column', async () => {
    expect(await readStoredCombinerSelection(fakeSql([{ selected_equipment: storedPick(FOUR_C) }]), PID))
      .toEqual({ kind: 'stored', deviceId: FOUR_C });
    for (const col of [storedPick(null), { panelId: 'x' }, null]) {
      expect(await readStoredCombinerSelection(fakeSql([{ selected_equipment: col }]), PID))
        .toEqual({ kind: 'stored', deviceId: null });
    }
  });
  it('nothing to read: no project id, no DB handle, no database, no row', async () => {
    const never = vi.fn();
    expect(await readStoredCombinerSelection(never as never, 'not-a-uuid')).toEqual({ kind: 'not-read', reason: 'no-project' });
    expect(never).not.toHaveBeenCalled();
    expect(isReadableProjectId(undefined)).toBe(false);
    expect(await readStoredCombinerSelection(undefined, PID)).toEqual({ kind: 'not-read', reason: 'no-database' });
    expect(await readStoredCombinerSelection(async () => { throw new DbConfigError('no url'); }, PID))
      .toEqual({ kind: 'not-read', reason: 'no-database' });
    expect(await readStoredCombinerSelection(fakeSql([]), PID)).toEqual({ kind: 'not-read', reason: 'no-row' });
  });
  it('a real failure is UNREADABLE, never "nothing selected"', async () => {
    const r = await readStoredCombinerSelection(fakeSql(new Error('connection reset')), PID);
    expect(r.kind).toBe('unreadable');
  });
  it('the stored answer wins — including "none"; otherwise the posted value stands', () => {
    expect(effectiveCombinerId(FIVE_C, { kind: 'stored', deviceId: FOUR_C }, 't')).toBe(FOUR_C);
    expect(effectiveCombinerId(FIVE_C, { kind: 'stored', deviceId: null }, 't')).toBeNull();
    expect(effectiveCombinerId(` ${FIVE_C} `, { kind: 'not-read', reason: 'no-row' }, 't')).toBe(FIVE_C);
    expect(effectiveCombinerId(FIVE_C, { kind: 'unreadable', error: 'x' }, 't')).toBe(FIVE_C);
    expect(effectiveCombinerId(undefined, { kind: 'not-read', reason: 'no-project' }, 't')).toBeNull();
  });
});

// ── The routes ────────────────────────────────────────────────────────────
async function post(route: 'bom' | 'sld', body: Record<string, unknown>) {
  const { POST } = route === 'bom'
    ? await import('@/app/api/engineering/bom/route')
    : await import('@/app/api/engineering/sld/route');
  const res = await POST(new Request(`http://solarpro.test/api/engineering/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('svg') || ct.includes('xml') ? await res.text() : JSON.stringify(await res.json());
}

const bomBody = (over: Record<string, unknown> = {}) => ({
  inverterId: 'enphase-iq8plus', panelId: 'qcells-peak-duo-400', moduleCount: 12, deviceCount: 12,
  stringCount: 0, inverterCount: 12, systemKw: 5.16, topologyType: 'MICROINVERTER', systemType: 'roof', ...over,
});
// The route re-runs computeSystem from the body, as it does for the page.
const sldBody = (over: Record<string, unknown> = {}) => {
  return {
    format: 'svg', projectName: 'STORED', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275',
    topologyType: 'MICROINVERTER', selectedBrand: 'enphase', systemType: 'roof',
    totalModules: 12, deviceCount: 12, totalStrings: 0,
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus',
    inverterAcKwPerDevice: 0.29, inverterAcCurrentMax: 1.21, acOutputKw: 12 * 0.29,
    panelModel: 'TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
    mainPanelAmps: 200, panelBusRating: 200, interconnection: 'LOAD_SIDE',
    inverterModulesPerDevice: 1, inverterBranchLimit: 13,
    ...over,
  };
};

describe.each(['bom', 'sld'] as const)('/api/engineering/%s reads the store', (route) => {
  const body = route === 'bom' ? bomBody : sldBody;

  it('a DROPPED page read (nothing posted) still gets the stored device', async () => {
    db.column = storedPick(FOUR_C);
    const out = await post(route, body({ projectId: PID }));
    expect(db.reads).toEqual([PID]);
    expect(out.toUpperCase()).toContain('IQ COMBINER 4C');
  }, 60_000);

  it('the stored device beats a stale posted one', async () => {
    db.column = storedPick(FOUR_C);
    const out = await post(route, body({ projectId: PID, selectedCombinerId: FIVE_C }));
    expect(out.toUpperCase()).toContain('IQ COMBINER 4C');
  }, 60_000);

  it('no project id: the store is never touched and the posted value stands', async () => {
    db.column = storedPick(FOUR_C);
    const out = await post(route, body({ selectedCombinerId: FIVE_C }));
    expect(db.reads).toEqual([]);
    expect(out.toUpperCase()).toContain('IQ COMBINER 5C');
    expect(out.toUpperCase()).not.toContain('IQ COMBINER 4C');
  }, 60_000);

  it('an unreadable store keeps the posted value — a drawing is not refused', async () => {
    db.mode = 'throw';
    const out = await post(route, body({ projectId: PID, selectedCombinerId: FIVE_C }));
    expect(out.toUpperCase()).toContain('IQ COMBINER 5C');
  }, 60_000);
});
