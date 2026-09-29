/**
 * tests/permitAndDrawingsAreTenantScoped.test.ts
 *
 * ANOTHER TENANT'S PROJECT IS NOT REACHABLE THROUGH ENGINEERING ROUTES.
 *
 * GET /api/engineering/permit and the permit preview enforced "owner, or a
 * platform admin". POST /api/engineering/permit never asked: any signed-in
 * user holding another tenant's project UUID could generate that project's
 * permit package — the route read the victim's name, engineering_config,
 * design_electrical, stored combiner and canonical roof geometry into the
 * returned HTML and wrote project_files rows against the victim's project.
 * The SLD, SLD PDF and BOM routes read the victim's stored combiner the same
 * way.
 *
 * lib/projectAccess.ts is now the one rule for all of them. This drives the
 * real exported handlers; the permit engine is stubbed at generatePermitHTML
 * (the question is whether the route reaches it, not what it draws), and every
 * statement a route issues is recorded so "read nothing of the victim's" is
 * checked, not assumed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const ROLES: Record<string, string> = { [OWNER]: 'user', [OTHER]: 'user', [ADMIN]: 'admin' };

const h = vi.hoisted(() => ({
  userId: '' as string,
  noDb: false,
  stmts: [] as Array<{ q: string; values: unknown[] }>,
  built: 0,
}));

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: () => (h.userId ? { id: h.userId, email: `${h.userId}@t.test` } : null),
}));
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => (h.userId
    ? { user: { id: h.userId }, response: null }
    : { user: null, response: new Response('{}', { status: 401 }) })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/pdf/generatePdf', () => ({ generatePdfFromHtml: async () => null }));
vi.mock('@/lib/aerial/parcelBoundary', () => ({ fetchParcelBoundary: async () => null }));
vi.mock('@/lib/aerial/nearmapCache', () => ({ getNearmapSurfacesCached: async () => null }));
vi.mock('@/lib/aerial/siteFeatures', () => ({ fetchSiteFeatures: async () => null }));
vi.mock('@/lib/permit/sections/sitePlan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/sections/sitePlan')>()),
  fetchAerialRoofData: async () => ({ error: 'offline (test)' }),
}));
vi.mock('@/lib/permit/utils/aerialEdgeSnap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/utils/aerialEdgeSnap')>()),
  applyAerialEdgeSnapRegistration: async () => {},
}));
vi.mock('@/lib/permit/snapshot/authorityInputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit/snapshot/authorityInputs')>()),
  resolveSnapshotAuthorityInputs: async () => ({}),
}));
vi.mock('@/lib/permit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permit')>()),
  generatePermitHTML: () => { h.built++; return '<!DOCTYPE html><html><body>stub</body></html>'; },
}));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getDbReady: async () => {
    if (h.noDb) {
      const { DbConfigError } = await import('@/lib/db-ready');
      throw new DbConfigError('DATABASE_URL is not set.');
    }
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
      h.stmts.push({ q, values });
      if (/^SELECT id, user_id FROM projects WHERE id = \?/i.test(q)) {
        return Promise.resolve(values[0] === PROJECT ? [{ id: PROJECT, user_id: OWNER }] : []);
      }
      if (/^SELECT role FROM users WHERE id = \?/i.test(q)) {
        return Promise.resolve(ROLES[String(values[0])] ? [{ role: ROLES[String(values[0])] }] : []);
      }
      if (/SELECT selected_equipment FROM projects/i.test(q)) {
        return Promise.resolve([{ selected_equipment: null }]);
      }
      return Promise.resolve([]);
    };
  },
}));

import { POST as PERMIT } from '@/app/api/engineering/permit/route';
import { braidonOriginalAuditFixture } from './fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function permitReq(body: unknown) {
  const url = new URL('http://localhost/api/engineering/permit?format=html');
  return {
    nextUrl: url, url: url.toString(),
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as never;
}
function permitBody(): Record<string, unknown> & { project: Record<string, unknown>; projectId: string } {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown> & { project: Record<string, unknown> };
  input.project.projectId = PROJECT;
  return { ...input, projectId: PROJECT };
}

/** Statements that touched the project other than the access check itself. */
function victimTouches() {
  return h.stmts.filter(({ q, values }) =>
    values.includes(PROJECT) &&
    !/^SELECT id, user_id FROM projects WHERE id = \?/i.test(q));
}
function writes() {
  return h.stmts.filter(({ q }) => /^(INSERT|UPDATE|DELETE)/i.test(q));
}

const bomBody = { projectId: PROJECT, inverterId: 'enphase-iq8plus', panelId: 'qcells-peak-duo-400',
  moduleCount: 12, deviceCount: 12, stringCount: 0, inverterCount: 12, systemKw: 5.16,
  topologyType: 'MICROINVERTER', systemType: 'roof' };
const sldBody = { projectId: PROJECT, format: 'svg', projectName: 'X', clientName: 'Y',
  address: '1 Test St, Pocahontas IL 62275', topologyType: 'MICROINVERTER', selectedBrand: 'enphase',
  systemType: 'roof', totalModules: 12, deviceCount: 12, totalStrings: 0,
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus',
  inverterAcKwPerDevice: 0.29, inverterAcCurrentMax: 1.21, acOutputKw: 3.48,
  panelModel: 'TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  mainPanelAmps: 200, panelBusRating: 200, interconnection: 'LOAD_SIDE',
  inverterModulesPerDevice: 1, inverterBranchLimit: 13 };

async function drawing(route: 'bom' | 'sld' | 'sld/pdf', body: Record<string, unknown>) {
  const mod = route === 'bom' ? await import('@/app/api/engineering/bom/route')
    : route === 'sld' ? await import('@/app/api/engineering/sld/route')
    : await import('@/app/api/engineering/sld/pdf/route');
  return mod.POST(new Request(`http://solarpro.test/api/engineering/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never);
}

beforeEach(() => {
  h.userId = ''; h.noDb = false; h.stmts = []; h.built = 0;
});

describe('🚨 POST /api/engineering/permit — another tenant is refused before anything is read', () => {
  it('another installer gets 403, the build never runs, nothing of the victim is read or written', async () => {
    h.userId = OTHER;
    const res = await PERMIT(permitReq(permitBody()));
    expect(res.status).toBe(403);
    expect(h.built).toBe(0);
    expect(victimTouches()).toEqual([]);
    expect(writes()).toEqual([]);
  }, 60_000);

  it('a project id that does not exist is a 404, not a package', async () => {
    h.userId = OWNER;
    const body = permitBody();
    body.projectId = '99999999-9999-4999-8999-999999999999';
    body.project.projectId = body.projectId;
    const res = await PERMIT(permitReq(body));
    expect(res.status).toBe(404);
    expect(h.built).toBe(0);
  }, 60_000);

  it('the owner still generates', async () => {
    h.userId = OWNER;
    const res = await PERMIT(permitReq(permitBody()));
    expect(res.status).toBe(200);
    expect(h.built).toBe(1);
  }, 60_000);

  it('a platform admin still generates (same rule as the permit GET)', async () => {
    h.userId = ADMIN;
    const res = await PERMIT(permitReq(permitBody()));
    expect(res.status).toBe(200);
    expect(h.built).toBe(1);
  }, 60_000);

  it('the DB-less harness path is unchanged (no database, nothing to protect)', async () => {
    h.userId = OTHER; h.noDb = true;
    const res = await PERMIT(permitReq(permitBody()));
    expect(res.status).toBe(200);
    expect(h.built).toBe(1);
  }, 60_000);
});

describe.each(['bom', 'sld', 'sld/pdf'] as const)('🚨 /api/engineering/%s — another tenant cannot read the stored selection', (route) => {
  const body = route === 'bom' ? bomBody : sldBody;

  it('another installer gets 403 and the victim\'s selected_equipment is never read', async () => {
    h.userId = OTHER;
    const res = await drawing(route, route === 'sld/pdf' ? { buildInput: body } : body);
    expect(res.status).toBe(403);
    expect(victimTouches()).toEqual([]);
  }, 60_000);

  it('the owner\'s request still reads the stored selection', async () => {
    h.userId = OWNER;
    await drawing(route, route === 'sld/pdf' ? { buildInput: body } : body);
    expect(victimTouches().some(s => /selected_equipment/.test(s.q))).toBe(true);
  }, 60_000);
});
