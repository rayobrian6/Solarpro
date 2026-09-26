// ═══════════════════════════════════════════════════════════════════════════
// THE PERMIT ROUTE READS THE RECORDED COMBINER ITSELF.
//
// `project.selectedCombinerId` outranks every other combiner source in the
// resolver and reaches the snapshot digest through buildIntegratedEquipment.
// It used to arrive ONLY in the client payload, and the engineering page's read
// of the stored selection fails OPEN (reset to null, `if (!r.ok) return;`,
// `catch {}`) on a rate-limited GET. One dropped read and the package shipped
// the catalogue pairing under a different digest, silently.
//
// This drives the ACTUAL exported POST handler. The permit engine itself is
// stubbed at `generatePermitHTML` so the assertion is exactly "which combiner
// did the route hand the build" — the propagation from that field to E-1,
// SCHED, the BOM and the digest is pinned separately
// (combinerSelectionPropagation / ctMeteringPropagation /
// permit-e1-metering-row).
//
// WHAT THIS PINS:
//   • the STORED selection wins over a different posted id
//   • a dropped client read (nothing posted) still ships the stored device
//   • stored "nothing selected" REMOVES a posted id
//   • a store read that throws refuses the package (503) before any metered
//     call, and the refusal is a sentence the page will show
//   • no database / no project row / no project id → the posted value stands
//     (the DB-less harness paths are unchanged)
//   • the PDF path and the html draft preview take the same answer
//   • the legacy session override (`project.combinerId`) is untouched
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { userFacingServerError } from '@/lib/http/userFacingError';

const h = vi.hoisted(() => ({
  store: {
    mode: 'row' as 'row' | 'absent' | 'throw' | 'no-db',
    selectedEquipment: null as Record<string, unknown> | null,
  },
  reads: [] as string[],
  seen: [] as Array<{ has: boolean; selectedCombinerId: unknown; combinerId: unknown }>,
  aerialCalls: 0,
}));

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/pdf/generatePdf', () => ({ generatePdfFromHtml: async () => null }));
// Every enrichment that reaches the network is stubbed: the question here does
// not depend on it, and leaving it live would make the test slow and flaky.
vi.mock('@/lib/aerial/parcelBoundary', () => ({ fetchParcelBoundary: async () => null }));
vi.mock('@/lib/aerial/nearmapCache', () => ({ getNearmapSurfacesCached: async () => null }));
vi.mock('@/lib/aerial/siteFeatures', () => ({ fetchSiteFeatures: async () => null }));
vi.mock('@/lib/permit/sections/sitePlan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/sections/sitePlan')>()),
  fetchAerialRoofData: async () => { h.aerialCalls++; return { error: 'offline (test)' }; },
}));
vi.mock('@/lib/permit/utils/aerialEdgeSnap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/utils/aerialEdgeSnap')>()),
  applyAerialEdgeSnapRegistration: async () => {},
}));
vi.mock('@/lib/permit/snapshot/authorityInputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/snapshot/authorityInputs')>()),
  resolveSnapshotAuthorityInputs: async () => ({}),
}));
// The build is where the answer is CONSUMED — capture what the route hands it.
vi.mock('@/lib/permit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit')>()),
  generatePermitHTML: (input: { project: Record<string, unknown> }) => {
    h.seen.push({
      has: Object.prototype.hasOwnProperty.call(input.project, 'selectedCombinerId'),
      selectedCombinerId: input.project.selectedCombinerId,
      combinerId: input.project.combinerId,
    });
    return '<!DOCTYPE html><html><body>stub planset</body></html>';
  },
}));
// THE STORE is `projects.selected_equipment`, read through the route's own DB
// handle. Every other read the route makes is fail-soft and finds nothing.
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getDbReady: async () => {
    // No database at all: EVERY read fails the way a DB-less harness does.
    if (h.store.mode === 'no-db') {
      const { DbConfigError } = await import('@/lib/db-ready');
      throw new DbConfigError('DATABASE_URL is not set.');
    }
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join(' ').replace(/\s+/g, ' ').trim();
      if (/SELECT selected_equipment FROM projects/i.test(q)) {
        h.reads.push(String(values[0]));
        if (h.store.mode === 'throw') return Promise.reject(new Error('Connection terminated unexpectedly'));
        if (h.store.mode === 'absent') return Promise.resolve([]);
        return Promise.resolve([{ selected_equipment: h.store.selectedEquipment }]);
      }
      return Promise.resolve([]);
    };
  },
}));

// Hoisted above this import, so the handler binds to the fakes.
import { POST } from '@/app/api/engineering/permit/route';

const PROJECT_ID = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const FIVE_C = 'enphase-iq-combiner-5c';
const SIX_C = 'enphase-iq-combiner-6c';
const FOUR_C = 'enphase-iq-combiner-4c';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A stored selection in the shape lib/combinerSelection writes. */
function storedSelection(deviceId: string | null): Record<string, unknown> {
  const record = (id: string) => ({
    schemaVersion: 1, combinerDeviceId: id, manufacturer: 'Enphase', model: id,
    modelNumber: null, inverterId: 'enphase-iq8a', selectedBy: 'installer',
    selectedByKind: 'user', selectedAtIso: '2026-09-25T12:00:00Z', basis: null,
    compatibility: { inverterId: 'enphase-iq8a', declaredCompatibleIds: null, declaredCompatible: false, source: 'test' },
    compatibilityOverride: null,
  });
  return {
    combinerSelection: deviceId
      ? { active: record(deviceId), superseded: [] }
      // cleared: the question is open again, and the history says so
      : { active: null, superseded: [{ ...record(SIX_C), supersededAtIso: '2026-09-25T13:00:00Z', supersededBy: 'installer', supersededReason: 'Selection cleared.' }] },
  };
}

/** A NextRequest-shaped stub. The handler reads `req.nextUrl.searchParams`. */
function req(body: unknown, query = 'format=html') {
  const url = new URL(`http://localhost/api/engineering/permit?${query}`);
  return {
    nextUrl: url,
    url: url.toString(),
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as never;
}

async function generate(opts: { posted?: string; combinerId?: string; projectId?: string | null; query?: string } = {}) {
  const body = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  // The fixture's own id is not a UUID, so `null` here means "no readable project".
  if (opts.projectId !== null) body.projectId = opts.projectId ?? PROJECT_ID;
  const project = body.project as Record<string, unknown>;
  delete project.selectedCombinerId;
  if (opts.posted !== undefined) project.selectedCombinerId = opts.posted;
  if (opts.combinerId !== undefined) project.combinerId = opts.combinerId;
  const res = await POST(req(body, opts.query));
  return { res, text: await res.text() };
}

/**
 * One POST that must reach the build, and the ONE record it produced.
 * `h.seen` is cleared only per test, so reading its tail after a second call
 * in the same test would hand back the FIRST call's record if the second
 * returned early (a 4xx/5xx before generatePermitHTML) — and that record
 * carries the same expected value, so the assertion would pass untested.
 */
async function generated(opts: Parameters<typeof generate>[0] = {}) {
  const before = h.seen.length;
  const { res, text } = await generate(opts);
  expect(res.status, text.slice(0, 300)).toBe(200);
  expect(h.seen.length - before, 'this call must reach generatePermitHTML exactly once').toBe(1);
  return h.seen[h.seen.length - 1];
}

describe('permit POST · the recorded combiner is read by the route, not trusted from the body', () => {
  beforeEach(() => {
    h.store.mode = 'row';
    h.store.selectedEquipment = null;
    h.reads.length = 0;
    h.seen.length = 0;
    h.aerialCalls = 0;
    // The Census geocode is a live fetch; the route treats a failure as non-fatal.
    vi.stubGlobal('fetch', async () => { throw new Error('offline (test)'); });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the STORED selection replaces a different posted id', async () => {
    h.store.selectedEquipment = storedSelection(FIVE_C);
    const seen = await generated({ posted: SIX_C });
    expect(h.reads).toEqual([PROJECT_ID]);
    expect(seen.selectedCombinerId).toBe(FIVE_C);
  }, 60_000);

  it('a DROPPED client read (nothing posted) still ships the stored device — the finding', async () => {
    h.store.selectedEquipment = storedSelection(SIX_C);
    const seen = await generated({});
    expect(seen.selectedCombinerId).toBe(SIX_C);
  }, 60_000);

  it('stored "nothing selected" REMOVES a posted id rather than letting it stand', async () => {
    h.store.selectedEquipment = storedSelection(null);
    expect((await generated({ posted: SIX_C })).has).toBe(false);

    // …and a store that never recorded a combiner at all reads the same way…
    h.store.selectedEquipment = { panelId: 'some-panel' };
    expect((await generated({ posted: SIX_C })).has).toBe(false);

    // …as does a project row whose selected_equipment is NULL.
    h.store.selectedEquipment = null;
    expect((await generated({ posted: SIX_C })).has).toBe(false);

    // Three calls, three reads of the store — none answered from an earlier one.
    expect(h.reads).toEqual([PROJECT_ID, PROJECT_ID, PROJECT_ID]);
  }, 60_000);

  it('a store read that THROWS refuses the package: 503, nothing generated, no metered call', async () => {
    h.store.mode = 'throw';
    const { res, text } = await generate({ posted: SIX_C });
    expect(res.status).toBe(503);
    const json = JSON.parse(text) as { success: boolean; code: string; error: string };
    expect(json.success).toBe(false);
    expect(json.code).toBe('COMBINER_SELECTION_UNREADABLE');
    expect(h.seen).toEqual([]);
    expect(h.aerialCalls).toBe(0);
    // The page shows a server sentence only when it does not look internal;
    // this refusal is written for the installer, so it must get through.
    const ui = userFacingServerError(503, text, 'Permit generation');
    expect(ui.fromServer).toBe(true);
    expect(ui.message).not.toMatch(/Connection terminated/);
  }, 60_000);

  it('NO DATABASE CONFIGURED — the posted value stands (the DB-less harness path)', async () => {
    h.store.mode = 'no-db';
    const seen = await generated({ posted: SIX_C });
    expect(seen.selectedCombinerId).toBe(SIX_C);
  }, 60_000);

  it('NO PROJECT ROW for the id — the posted value stands', async () => {
    h.store.mode = 'absent';
    const seen = await generated({ posted: SIX_C });
    expect(seen.selectedCombinerId).toBe(SIX_C);
  }, 60_000);

  it('NO readable project id — the store is not consulted and the posted value stands', async () => {
    h.store.selectedEquipment = storedSelection(FIVE_C);
    const seen = await generated({ posted: SIX_C, projectId: null });
    expect(h.reads).toEqual([]);
    expect(seen.selectedCombinerId).toBe(SIX_C);
  }, 60_000);

  it('the PDF path and the html DRAFT preview take the same stored answer', async () => {
    h.store.selectedEquipment = storedSelection(FIVE_C);
    // format=pdf: the PDF renderer is stubbed to null, so this is the route's
    // html-fallback leg — still a 200, still after generatePermitHTML.
    expect((await generated({ posted: SIX_C, query: 'format=pdf' })).selectedCombinerId).toBe(FIVE_C);
    expect((await generated({ posted: SIX_C, query: 'format=html&draft=true' })).selectedCombinerId).toBe(FIVE_C);
    expect(h.reads).toEqual([PROJECT_ID, PROJECT_ID]);
  }, 60_000);

  it('the legacy session override (project.combinerId) is passed through untouched', async () => {
    h.store.selectedEquipment = storedSelection(FIVE_C);
    const seen = await generated({ posted: SIX_C, combinerId: FOUR_C });
    expect(seen.combinerId).toBe(FOUR_C);
    expect(seen.selectedCombinerId).toBe(FIVE_C);
  }, 60_000);
});
