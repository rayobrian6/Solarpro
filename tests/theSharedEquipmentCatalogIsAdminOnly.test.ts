// ═══════════════════════════════════════════════════════════════════════════
// 🚨 P0 — ONE PROCESS-GLOBAL CATALOG, MUTABLE BY ANY LOGGED-IN USER
//
// `lib/db.ts:915` is `const db = new Database()` at module scope. Its `panels`,
// `inverters`, `batteries` and `mountings` Maps (lines 638-641) carry NO tenant
// key, and `GET /api/hardware` serves that one merged catalog to every
// organisation's Design Studio panel picker, panel dimensions and per-watt pricing.
//
// POST / PUT / DELETE on that route used to be gated on a SESSION only:
//
//     const user = getUserFromRequest(req);
//     if (!user) return ... 401
//
// So Company B's engineer could PUT `{type:'panel', id:'panel-std440',
// data:{width:9}}` and silently change the panel Company A designs and prices
// with — or DELETE it out of every organisation's picker. No admin role required.
//
// 🚨 WHY A NO-COOKIE TEST WOULD BE BLIND. With no session the OLD code also
// refused (401). The only case that discriminates is a caller who IS
// authenticated and is NOT an admin — which is exactly the attacker in the
// finding. That is what these cases exercise, and it is why `requireAdminApi`
// is mocked rather than the cookie being omitted.
//
// The gate is safe to impose because the only UI that mutates this route is
// `app/admin/hardware/page.tsx`. DesignSidebar, DesignStudio and DesignTab all
// only GET it, so no product path loses a capability.
//
// STILL OPEN and deliberately not hidden by this fix: the catalog is now
// admin-only but still NOT per-organisation, and savePanel/updatePanel/
// deletePanel never call `saveToFile`, so an admin's change reverts at the next
// cold start. Durable per-owner storage means the `user_equipment_*` tables from
// migration 005 — tracked separately, not smuggled in behind a security gate.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
// `requireAdminApi` is the verdict under test. Mocking it lets us put a
// genuinely-authenticated NON-ADMIN in front of the route, which is the case the
// old session-only gate let through.
const adminVerdict = { value: null as null | { id: string; role: string } };

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: vi.fn(async () => adminVerdict.value),
}));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

// 🚨 INERT FOR THE CURRENT ROUTE — it no longer imports this. It exists so that
// when the ORIGINAL session-only gate is restored byte-for-byte (via
// `git checkout HEAD -- app/api/hardware/route.ts`) to prove these cases
// discriminate, the restored code sees a genuinely AUTHENTICATED NON-ADMIN — the
// actual attacker in the finding. Without it the restored code would refuse with
// 401 on an invalid JWT, the cases would go red for the wrong reason, and the
// guard would look discriminating while proving nothing. Phase 4 lost an hour to
// exactly this: a mutation that reproduces a DIFFERENT defect than the one fixed.
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => ({ id: 'company-b-engineer', email: 'eng@company-b.test' })),
}));

vi.mock('@/lib/db-neon', () => ({
  handleRouteDbError: vi.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'db' }), { status: 503 })),
}));

// The real in-memory catalog — we observe it directly, so the assertion is about
// state, not about a status code the route happens to return.
import db from '@/lib/db';
import { POST, PUT, DELETE } from '@/app/api/hardware/route';

const ADMIN      = { id: 'admin-1', role: 'super_admin' };
const NON_ADMIN  = null; // requireAdminApi returns null for a non-admin session

function call(body: unknown) {
  return new Request('http://localhost/api/hardware', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'solarpro_session=whatever' },
    body: JSON.stringify(body),
  }) as never;
}

/** Seeds a panel through the library directly, bypassing the route under test. */
function seedPanel(wattage: number) {
  return db.savePanel({
    manufacturer: 'ACME',
    model: 'CatalogGuard-1',
    wattage,
    efficiency: 21,
    width: 1.1,
    height: 1.9,
  } as never);
}

describe('🚨 the shared equipment catalog cannot be rewritten by a non-admin', () => {
  beforeEach(() => { adminVerdict.value = NON_ADMIN; });

  it('an authenticated NON-ADMIN cannot change a panel every organisation designs with', async () => {
    const seeded = seedPanel(440);

    const res  = await PUT(call({ type: 'panel', id: seeded.id, data: { wattage: 9 } }));
    const body = await res.json();

    expect(res.status, 'a non-admin was allowed to mutate the global catalog').toBe(403);
    expect(body.success).toBe(false);

    // The state assertion is the one that matters: the panel is untouched.
    expect(db.getPanel(seeded.id)?.wattage,
      'the catalog was mutated even though the response refused').toBe(440);
  });

  it('an authenticated NON-ADMIN cannot delete a panel out of every picker', async () => {
    const seeded = seedPanel(410);

    const req = new Request('http://localhost/api/hardware', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie: 'solarpro_session=whatever' },
      body: JSON.stringify({ type: 'panel', id: seeded.id }),
    }) as never;

    const res = await DELETE(req);
    expect(res.status).toBe(403);
    expect(db.getPanel(seeded.id), 'the panel was deleted from the shared catalog').toBeTruthy();
  });

  it('an authenticated NON-ADMIN cannot inject a new panel into the shared catalog', async () => {
    const before = db.getPanels().length;

    const req = new Request('http://localhost/api/hardware', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'solarpro_session=whatever' },
      body: JSON.stringify({ type: 'panel', data: { manufacturer: 'EVIL', model: 'Injected', wattage: 1 } }),
    }) as never;

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(db.getPanels().length, 'a panel was injected into the shared catalog').toBe(before);
  });

  it('an ADMIN can still edit the catalog — the gate is a gate, not a wall', async () => {
    const seeded = seedPanel(455);
    adminVerdict.value = ADMIN;

    const res = await PUT(call({ type: 'panel', id: seeded.id, data: { wattage: 500 } }));
    expect(res.status, 'the admin catalog editor was broken by the gate').toBe(200);
    expect(db.getPanel(seeded.id)?.wattage).toBe(500);
  });
});
