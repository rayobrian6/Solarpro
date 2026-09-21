import { expect, test } from '@playwright/test';
import { seedRoofPlane, runAutoLayout, waitForCesiumCanvas, DEMO_SITE } from './support/seedRoof';

/**
 * e2e/persistence-join.spec.ts
 *
 * THE JOIN: A REAL BROWSER → REAL ROUTE HANDLERS → REAL POSTGRESQL.
 *
 * This was the last unverified path in Workstream 1, and the ledger recorded it
 * as owner-blocked on a database credential. It was not. Three of the four cells
 * were already covered:
 *
 *   client in jsdom  × mocked server        tests/designStudioSiteSwitch.component.test.tsx
 *   no client        × real route + real PG tests/siteDesignRoute.postgres.test.ts
 *   client in Chrome × real geometry engine e2e/panel-elevation.spec.ts
 *
 * The missing one needs all three at once, and what it proves is the JOIN: that
 * the shapes the client sends and expects are the shapes the route actually
 * reads and returns, against a real column set. A stub on either side cannot
 * prove that, because a stub is written to match whichever side you were looking
 * at when you wrote it.
 *
 * 🚨 NO CREDENTIAL. `lib/dev/pgliteNeonBridge.ts` runs PostgreSQL compiled to
 * WebAssembly inside the Next server and answers the driver's requests there.
 * `lib/db/projects.ts`, `upsertLayout`, `rowToLayout` and the route handlers are
 * untouched production code. Arm it with SOLARPRO_LOCAL_PG=1; these tests skip
 * when it is absent rather than pretending to pass.
 *
 * 🚨 EVERY TEST CREATES ITS OWN PROJECT, through the real POST /api/projects.
 * The first version shared one project row and passed — until the Melvin test
 * ran, picked a house 16 km away, and left the layout's ACTIVE SITE pointing
 * there. The next test's design was then archived rather than restored, and the
 * reload assertion failed with "Expected: 55, Received: 0" against a perfectly
 * working restore. Shared persistent state makes a suite order-dependent, which
 * is its own kind of test that proves nothing.
 */

const ARMED = process.env.SOLARPRO_LOCAL_PG === '1';
const SEEDED_PROJECT_ID = process.env.LOCAL_PG_PROJECT_ID ?? '4030b664-bebe-433b-a11c-cda05ead2f7d';

type LayoutBody = {
  success?: boolean;
  data?: { panels?: Array<{ id: string }>; roofPlanes?: Array<{ id: string }> } | null;
};

/**
 * Create a project through the REAL route, then pin its coordinates exactly.
 *
 * The create path geocodes the address, and `upsertLayout`'s coordinate-integrity
 * guard compares geometry against the project's stored position — so the fixture
 * states that position instead of inheriting whatever a geocoder with no API key
 * happened to return.
 */
async function createProject(
  page: import('@playwright/test').Page,
  name: string,
  at: { lat: number; lng: number },
  address: string,
): Promise<string> {
  const created = await page.request.post('/api/projects', {
    data: { name, address, lat: at.lat, lng: at.lng, systemType: 'roof', status: 'lead' },
  });
  expect([200, 201], 'creating a project through the real route should succeed')
    .toContain(created.status());
  const id = (await created.json())?.data?.id as string;
  expect(id, 'the created project should have an id').toBeTruthy();

  const pinned = await page.request.put(`/api/projects/${id}`, { data: { lat: at.lat, lng: at.lng, address } });
  expect(pinned.status()).toBe(200);
  return id;
}

/** Read the layout back through the REAL route — the handler the studio calls. */
async function layoutFromDb(page: import('@playwright/test').Page, id: string): Promise<LayoutBody> {
  const res = await page.request.get(`/api/projects/${id}/layout`);
  expect(res.status(), 'GET /layout should not be an auth or config failure').toBe(200);
  return res.json() as Promise<LayoutBody>;
}

async function openProject(page: import('@playwright/test').Page, id: string) {
  await page.goto(`/design?projectId=${id}`);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'the Design Studio should mount for a real saved project', timeout: 45_000 },
  ).toBe(true);
}

const panelIds = (page: import('@playwright/test').Page): Promise<string[]> =>
  page.evaluate(() => (window as any).__solarE2E?.panels.map((p: { id: string }) => p.id) ?? []);

test.describe('persistence join — browser, route and PostgreSQL together', () => {
  test.skip(!ARMED, 'SOLARPRO_LOCAL_PG is not set — no database is attached to this server.');

  test('the database is reachable and the seeded project is real', async ({ page }) => {
    // Guard the guard. Everything below is vacuous against a 503.
    const health = await page.request.get('/api/health');
    expect(JSON.stringify(await health.json())).not.toContain('not_configured');

    const project = await page.request.get(`/api/projects/${SEEDED_PROJECT_ID}`);
    expect(project.status(), 'the harness project row should exist and be owned by the dev user').toBe(200);
  });

  test('🚨 a design survives a reload — saved through the real route, read back from real PostgreSQL', async ({ page }) => {
    const id = await createProject(page, 'Join — reload', DEMO_SITE, '1010 Franklin Ave, St Louis, MO');
    await openProject(page, id);
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the placement path cannot run at all.');

    await seedRoofPlane(page);
    await runAutoLayout(page);

    const placed = await panelIds(page);
    expect(placed.length, 'Auto Layout should have placed panels').toBeGreaterThan(0);

    // The studio autosaves. Wait for the ROW to contain them — read through the
    // real GET handler, not through component state.
    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.panels?.length ?? 0,
      // 🚨 A SLOW CADENCE, DELIBERATELY. `expect.poll` defaults to a tight
      // retry loop, and these predicates issue a real HTTP request each time —
      // the production rate limiter is live here (the vitest route tests mock
      // it), and hammering the layout endpoint produced `read ECONNRESET`
      // mid-suite, which reads exactly like a server crash.
      { message: 'autosave never reached the database — the layout row stayed empty',
        timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(placed.length);

    // 🚨 THE RELOAD. This is the step nothing before this file exercised.
    await page.reload();
    await expect.poll(
      () => page.evaluate(() => Boolean((window as any).__solarE2E)),
      { message: 'the studio should mount again after a reload', timeout: 45_000 },
    ).toBe(true);

    await expect.poll(
      async () => (await panelIds(page)).length,
      {
        message: 'the design did not come back after a reload — this is Ray\'s "the panels never came back"',
        timeout: 45_000,
      },
    ).toBe(placed.length);

    // BY ID, not by count. A count is satisfied by any array of the right size.
    expect((await panelIds(page)).sort()).toEqual([...placed].sort());

    const planes = await page.evaluate(
      () => (window as any).__solarE2E.roofPlanes.map((p: { id: string }) => p.id));
    expect(planes.length, 'the roof must come back too, not only the panels').toBeGreaterThan(0);
  });

  test('🚨 the restored badge agrees with the array it describes', async ({ page }) => {
    // WS1-005: the top bar said 52, the System Summary said 52, and the badge
    // said "Layout loaded from DB · 0 panels" — three readouts, three sources.
    // The badge is now derived from `panels.length`; this asserts that against a
    // real restore rather than a seeded array.
    const id = await createProject(page, 'Join — badge', DEMO_SITE, '1010 Franklin Ave, St Louis, MO');
    await openProject(page, id);
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the placement path cannot run at all.');

    await seedRoofPlane(page);
    await runAutoLayout(page);
    const n = (await panelIds(page)).length;
    expect(n).toBeGreaterThan(0);

    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.panels?.length ?? 0,
      { message: 'autosave never reached the database', timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(n);

    await page.reload();
    await expect.poll(
      async () => (await panelIds(page)).length,
      { message: 'the design did not come back after a reload', timeout: 45_000 },
    ).toBe(n);

    const badge = page.getByText(/Layout loaded from DB/i).first();
    await expect(badge, 'the restored-from-DB badge should be shown after a reload').toBeVisible();
    await expect(badge,
      `the badge must report the same count as the array it describes (${n})`,
    ).toContainText(`${n} panels`);
  });
});

test.describe('the Melvin sequence, through the database', () => {
  test.skip(!ARMED, 'SOLARPRO_LOCAL_PG is not set — no database is attached to this server.');

  const MELVIN    = { lat: 38.70615257709013, lng: -90.04625419301613, address: '3 Melvin Drive, Granite City, IL 62040' };
  const NEIGHBOUR = { lat: 38.70629, lng: -90.04620, address: '5 Melvin Drive, Granite City, IL 62040' };

  const seedAt = (at: { lat: number; lng: number }, tag: string) => ({
    panels: Array.from({ length: 3 }, (_, i) => ({
      id: `${tag}-p${i}`, lat: at.lat + i * 0.00002, lng: at.lng, wattage: 400,
      bifacialGain: 1, systemType: 'roof', tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5,
    })),
    roofPlanes: [{
      id: `${tag}-r0`, pitch: 20, azimuth: 180, area: 40, usableArea: 34, source: 'manual', confirmed: true,
      vertices: [
        { lat: at.lat, lng: at.lng },
        { lat: at.lat + 0.0001, lng: at.lng },
        { lat: at.lat + 0.0001, lng: at.lng + 0.0001 },
        { lat: at.lat, lng: at.lng + 0.0001 },
      ],
    }],
  });

  test('🚨 A → B → A returns A\'s design, with the archive round-tripped through real PostgreSQL', async ({ page }) => {
    // Ray's production failure, end to end: open a property with a design, pick
    // the house next door, work there, pick the first one again. Every layer
    // that could drop the design is real — the studio's site bundle, the route,
    // the subsystem-wipe guard, and `layouts.site_archives` from migration 123.
    const id = await createProject(page, 'Join — Melvin', MELVIN, MELVIN.address);
    await openProject(page, id);

    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), MELVIN);
    await page.waitForTimeout(800);
    await page.evaluate(d => (window as any).__solarE2E.seedDesign(d), seedAt(MELVIN, 'melvin') as any);

    // 🚨 BY ID, NOT BY COUNT — a count assertion passes on whatever happened to
    // be in the row already.
    await expect.poll(
      async () => {
        const ids = (await layoutFromDb(page, id)).data?.panels?.map(p => p.id) ?? [];
        return ids.includes('melvin-p0') && ids.includes('melvin-p2');
      },
      { message: "Melvin's design never reached the database", timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(true);

    // Property B, with its own work.
    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), NEIGHBOUR);
    await page.waitForTimeout(1_000);
    await page.evaluate(d => (window as any).__solarE2E.seedDesign(d), seedAt(NEIGHBOUR, 'nbr') as any);
    await expect.poll(
      () => page.evaluate(() => (window as any).__solarE2E.archivedSiteCount),
      { message: 'picking the neighbour should ARCHIVE Melvin, not delete it', timeout: 30_000 },
    ).toBeGreaterThan(0);

    // 🚨 The archive must be in the ROW, not only in memory. Without migration
    // 123 this is exactly where the 52 panels used to be lost at HTTP 200.
    await expect.poll(
      async () => {
        const res = await page.request.get(`/api/projects/${id}/layout`);
        return JSON.stringify(await res.json()).includes('melvin-p0');
      },
      { message: "Melvin's archived design is not in the persisted layout row", timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(true);

    // Back to Melvin.
    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), MELVIN);
    await expect.poll(
      async () => (await panelIds(page)).sort().join(','),
      { message: "picking Melvin again did not bring Melvin's design back", timeout: 30_000 },
    ).toBe('melvin-p0,melvin-p1,melvin-p2');

    // And the neighbour's work is held, not discarded.
    expect(await page.evaluate(() => (window as any).__solarE2E.archivedSiteCount)).toBeGreaterThan(0);
  });
});
