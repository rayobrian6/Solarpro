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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 AND THE ADDRESS MUST AGREE WITH THE COORDINATES, OR THE FIXTURE MOVES THE
 * HOUSE OUT FROM UNDER ITS OWN DESIGN
 * ─────────────────────────────────────────────────────────────────────────────
 * Two of these tests used to pin `DEMO_SITE` (38.6657, -90.2266) and then state
 * the address "1010 Franklin Ave, St Louis, MO" — a different place. Measured
 * against this harness, `POST /api/projects` geocodes that address to
 * 38.6406229, -90.226206, which is 2.79 km from the pin.
 *
 * That is not a cosmetic disagreement, because `DesignStudio`'s documented v52.1
 * rule is that a STREET-LEVEL geocode always wins over stored coordinates: on
 * mount it re-geocodes any address beginning with a house number
 * (`isStreetLevelAddress` is `/^\d+\s/`), re-centres the map on the result, and
 * PUTs that position back over the project row — unconditionally. (Its sibling
 * `geocodeAddress` guards with `if (!project.lat || !project.lng)`; this path has
 * no guard at all. That asymmetry is REAL and is recorded for Ray's ruling — a
 * coordinate a human deliberately set being silently overwritten by a geocoder
 * is a placement-authority question. Nothing here patches it.)
 *
 * Downstream, that re-centre decides OWNERSHIP: the mount-time restore computes
 * `siteKeyFromCoords(mapCenterRef.current, project.id)` (DesignStudio ~1646) and
 * the site key rounds to 5 dp ≈ 1.1 m. So a geocode landing 2.79 km away — or,
 * as measured for "3 Melvin Drive, Granite City, IL 62040", 28 m away — makes
 * the seeded roof a DIFFERENT PROPERTY from the one the studio believes it is
 * looking at, and the honest consequence is an autosave that writes 0 panels and
 * 0 planes. The product is behaving as designed; the fixture was describing a
 * house 2.79 km from the one it placed panels on.
 *
 * THE FIX IS IN THE FIXTURE, AND IT REMOVES THE GEOCODER FROM THE LOOP:
 *
 *   • the project states the CITY it is actually in, not a street address
 *     somewhere else. A non-street-level address takes the studio's
 *     "use the stored coords" branch, so nothing re-geocodes and nothing PUTs a
 *     new position over the pin; and
 *   • the property is then stated EXPLICITLY through `pickHouse`, exactly as
 *     e2e/obstruction-survives-reload.spec.ts does (that spec passes), so the
 *     site the design belongs to is a fact this file asserts rather than
 *     whatever an external service answered.
 *
 * 🚨 THE SECOND POINT IS NOT DECORATION. Without a key, `/api/geocode` falls
 * through to live Census/Nominatim, so the old fixture's outcome depended on an
 * external service answering — which is very probably why these were once
 * recorded green. A persistence test whose verdict moves with somebody else's
 * uptime is not a persistence test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 AND THE SEED MUST NOT RACE THE RESTORE (the second, larger cause)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixing the address was not enough. `openProject` waited for the E2E bridge,
 * which an effect installs on the FIRST RENDER — while the mount-time restore is
 * an async fetch, and `reactStrictMode` (next.config.js) makes it run TWICE. So
 * geometry was being placed into state a hydrate was about to replace:
 *
 *     t=12.3s  [AUTO] total: 55 panels from 1 planes
 *     t=13.5s  [DesignStudio] site design hydrated {panels: 0, roofPlanes: 0}
 *     t=17.0s  [LAYOUT SAVE PAYLOAD] {panelCount: 0, roofPlaneCount: 0}
 *
 * — and the spec then reported "autosave never reached the database" against a
 * save path that was doing exactly what it was told. `openProject` now waits for
 * ownership to be decided AND for the studio to have stopped re-reading the row.
 * See the comments there; that is the precondition every test in this file needs
 * and none of them stated.
 */

const ARMED = process.env.SOLARPRO_LOCAL_PG === '1';
const SEEDED_PROJECT_ID = process.env.LOCAL_PG_PROJECT_ID ?? '4030b664-bebe-433b-a11c-cda05ead2f7d';

/**
 * An address that is TRUE of `DEMO_SITE` and is not street-level.
 *
 * 38.6657, -90.2266 is inside the city of St Louis, Missouri. Naming the city
 * and no house number is the honest statement at the precision the fixture
 * actually knows — and it is the one form of address the studio does not
 * re-geocode, so the pinned coordinate stays the authority. A made-up street
 * number would be a confident wrong answer, which is the shape of defect this
 * whole workstream keeps finding.
 */
const DEMO_ADDRESS = 'St Louis, MO';

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
 *
 * 🚨 PINNING IS NECESSARY AND NOT SUFFICIENT. This PUT is undone on mount by
 * `geocodeAddressForFlyTo` for any STREET-LEVEL address (see the header), so the
 * callers pass an address the studio will not re-geocode. Pinning alone was the
 * original mistake: it made the row right for the instant between this PUT and
 * the first render.
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
  // 🚨 COUNT THE STUDIO'S OWN READS OF THE STORED LAYOUT, FROM BEFORE IT NAVIGATES.
  //
  // MEASURED, and it is the whole of the remaining race: `reactStrictMode` is ON
  // (next.config.js), so in development React mounts the studio's effects TWICE
  // and the restore runs TWICE — two independent fetches of
  // GET /api/projects/<id>/layout. In one run they resolved at t=10.5 s and
  // t=13.5 s, THREE SECONDS APART, and the spec had seeded a roof and let Auto
  // Layout place 55 panels in between. The second `hydrateFromStored` then logged
  //
  //     [DesignStudio] site design hydrated {panels: 0, roofPlanes: 0}
  //
  // and the 55 panels were gone — so the autosave honestly wrote 0 and the spec
  // blamed persistence. Waiting for a resolved `activeSiteKey` is not enough: the
  // FIRST hydrate sets it, and the second one is still to come.
  //
  // So the gate is "the studio has stopped reading the row": at least one read
  // has happened and none is in flight, held for three consecutive samples. That
  // is honest whether the restore runs once (production, or StrictMode off) or
  // twice, which counting to 2 would not be.
  //
  // `page.request` (which `layoutFromDb` uses) does NOT emit page events, so
  // these counters only ever see the studio's own fetches.
  const reads = { started: 0, settled: 0 };
  const isRestoreRead = (r: { url(): string; method(): string }) =>
    r.method() === 'GET' && r.url().includes(`/api/projects/${id}/layout`);
  page.on('request',        r => { if (isRestoreRead(r)) reads.started++; });
  page.on('requestfinished', r => { if (isRestoreRead(r)) reads.settled++; });
  page.on('requestfailed',   r => { if (isRestoreRead(r)) reads.settled++; });

  await page.goto(`/design?projectId=${id}`);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'the Design Studio should mount for a real saved project', timeout: 45_000 },
  ).toBe(true);

  // 🚨 AND THE STORED DESIGN MUST HAVE BEEN RESOLVED BEFORE ANYTHING IS PLACED.
  //
  // MEASURED, and it is the whole of one failure: the E2E bridge is installed by
  // an effect that runs on the first render, while the mount-time restore is an
  // async fetch that lands later. Waiting only for the bridge therefore starts
  // placing geometry INTO STATE THE RESTORE IS ABOUT TO REPLACE. In one run the
  // seeded roof was traced and Auto Layout placed 55 panels at t=18.9 s; the
  // restore resolved at t=19.9 s and `hydrateFromStored` logged
  // `site design hydrated {panels: 0, roofPlanes: 0}`; the autosave three seconds
  // later honestly wrote 0 panels, and the spec reported "autosave never reached
  // the database" — an accusation against a persistence path that was working.
  //
  // `activeSiteKey` is the signal, because ownership is DECIDED by the hydrate:
  // it is UNRESOLVED until the restore runs (`useSiteDesign` starts it at
  // `UNRESOLVED_SITE_KEY`, and only `hydrateFromStored` and `switchToSite` ever
  // set it). Waiting for it here, BEFORE any pick, means the only thing that can
  // have set it is the restore.
  //
  // 🚨 This is the same order the passing e2e/obstruction-survives-reload.spec.ts
  // uses — it waits for the Cesium viewer and then for a resolved
  // `activeSiteKey` before it seeds anything.
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.activeSiteKey ?? ''),
    { message: 'the studio never resolved which property this design belongs to — '
             + 'the stored layout had not been read back yet, so anything placed now is '
             + 'racing the restore', timeout: 45_000 },
  ).not.toBe('');

  // …and every restore pass has finished (see the counters above).
  let quiet = 0;
  await expect.poll(
    () => {
      if (reads.started > 0 && reads.started === reads.settled) quiet += 1;
      else quiet = 0;
      return quiet;
    },
    { message: 'the studio is still re-reading the stored layout — a hydrate landing after '
             + 'this point REPLACES whatever has been placed, and the save that follows is '
             + 'then honestly empty', timeout: 45_000, intervals: [1000] },
  ).toBeGreaterThanOrEqual(3);
}

/**
 * STATE WHICH PROPERTY THIS DESIGN IS FOR, and wait until the studio agrees.
 *
 * 🚨 The idiom is taken from e2e/obstruction-survives-reload.spec.ts, which
 * passes. `pickHouse` is the real `handleLocationPick` — the same callback the
 * Pick House gesture fires — so the site is activated by the product's own path,
 * not by reaching into its state. Waiting for a resolved `activeSiteKey` matters:
 * an UNRESOLVED key means the studio cannot prove ownership, and geometry seeded
 * in that window is adopted by whichever property the map is centred on when the
 * restore finally resolves.
 */
async function pickSite(
  page: import('@playwright/test').Page,
  at: { lat: number; lng: number },
  address: string,
) {
  await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address),
    { ...at, address });
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.activeSiteKey ?? ''),
    { message: 'picking the property did not give the studio a resolvable site key',
      timeout: 45_000 },
  ).not.toBe('');
}

/**
 * Reload, and wait for the studio to come back.
 *
 * 🚨 `domcontentloaded`, NOT the default `load`. MEASURED: `page.reload()` took
 * longer than the 45 s navigation budget on this page. With no
 * GOOGLE_MAPS_API_KEY the map session, the tile requests and /api/dsm all fail —
 * slowly, and repeatedly — and `load` waits for that whole subresource graph.
 *
 * Nothing is asserted more weakly. What this spec is about is what the studio
 * HOLDS after it comes back, and that is polled on its own below, by id; this
 * only stops waiting on the browser's loading bookkeeping for tiles that are
 * never going to arrive.
 */
async function reloadStudio(page: import('@playwright/test').Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E)),
    { message: 'the studio should mount again after a reload', timeout: 45_000 },
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
    // 🚨 DECLARED SLOW, because it BOOTS THE STUDIO TWICE. Measured on this
    // machine: one mount is ~10 s of page compile plus ~15 s of Cesium, the
    // restore runs twice under `reactStrictMode`, and the reload does all of it
    // again — against a dev server that recompiles whenever anything in the app
    // graph is touched. The suite-wide 90 s budget is for a single-page test;
    // this one legitimately needs more, and none of its own poll windows change,
    // so a genuine failure still fails inside the same 45 s predicates.
    test.slow();
    const id = await createProject(page, 'Join — reload', DEMO_SITE, DEMO_ADDRESS);
    await openProject(page, id);
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the placement path cannot run at all.');

    await pickSite(page, DEMO_SITE, DEMO_ADDRESS);
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
    await reloadStudio(page);

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
    test.slow();   // two studio boots, same as above
    // WS1-005: the top bar said 52, the System Summary said 52, and the badge
    // said "Layout loaded from DB · 0 panels" — three readouts, three sources.
    // The badge is now derived from `panels.length`; this asserts that against a
    // real restore rather than a seeded array.
    const id = await createProject(page, 'Join — badge', DEMO_SITE, DEMO_ADDRESS);
    await openProject(page, id);
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the placement path cannot run at all.');

    await pickSite(page, DEMO_SITE, DEMO_ADDRESS);
    await seedRoofPlane(page);
    await runAutoLayout(page);
    const n = (await panelIds(page)).length;
    expect(n).toBeGreaterThan(0);

    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.panels?.length ?? 0,
      { message: 'autosave never reached the database', timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(n);

    await reloadStudio(page);
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

  /**
   * 🚨 THE PROJECT ROW STATES THE CITY; THE PROPERTY IS PICKED BY COORDINATE.
   *
   * Melvin's address DOES agree with Melvin's coordinates, so this block was not
   * making the mistake the header describes — and it was still geocoder-bound.
   * Measured here: `3 Melvin Drive, Granite City, IL 62040` geocodes to
   * 38.705962638172, -90.046047183919, which is ~28 m from the pin. The site key
   * rounds to ~1.1 m and `resolveKeyFor` only snaps within a few metres, so a
   * 28 m re-centre is a different property as far as ownership is concerned, and
   * it arrives asynchronously — mid-test, at whatever moment an external service
   * answers. That is the whole A → B → A question decided by a coin toss.
   *
   * Granite City, Illinois is where 38.70615, -90.04625 is. Stating the city
   * keeps the studio on the pinned coordinate (no house number ⇒ no re-geocode),
   * and `pickHouse` below then names the street address the way a real pick does.
   */
  const CITY = 'Granite City, IL';

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
    // Three property switches, each waiting for a real save to land. Same reason
    // as the two above: the budget, not the assertions.
    test.slow();
    // Ray's production failure, end to end: open a property with a design, pick
    // the house next door, work there, pick the first one again. Every layer
    // that could drop the design is real — the studio's site bundle, the route,
    // the subsystem-wipe guard, and `layouts.site_archives` from migration 123.
    const id = await createProject(page, 'Join — Melvin', MELVIN, CITY);
    await openProject(page, id);

    await pickSite(page, MELVIN, MELVIN.address);
    await page.evaluate(d => (window as any).__solarE2E.seedDesign(d), seedAt(MELVIN, 'melvin') as any);

    // 🚨 THE STUDIO MUST HOLD THE SEED BEFORE THE DATABASE IS ASKED ABOUT IT.
    //
    // Measured: the seed reached the 3D engine and the autosave three seconds
    // later still wrote 0 panels — the bridge is torn down and reinstalled on
    // every dependency change (DesignStudio's E2E mirror effect), so a seed can
    // land on state the next render replaces. Reading the DATABASE first turns
    // that into "the design never reached the database", which accuses the
    // persistence path of a fault in the harness. The same wait that
    // e2e/obstruction-survives-reload.spec.ts does after seeding.
    await expect.poll(
      async () => (await panelIds(page)).sort().join(','),
      { message: 'the studio never took the seeded design — nothing downstream of this can be trusted',
        timeout: 30_000 },
    ).toBe('melvin-p0,melvin-p1,melvin-p2');

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
    //
    // 🚨 WAIT FOR THE SITE TO ACTUALLY CHANGE, rather than for a second. The
    // neighbour is 16 m away and `changeSite` resolves the pick against the
    // properties this project already knows, so "the pick was accepted as a NEW
    // property" is the precondition for everything after it — and seeding into
    // the gap files the neighbour's panels under Melvin, which then reads as the
    // archive failing.
    const melvinKey = await page.evaluate(() => (window as any).__solarE2E.activeSiteKey as string);
    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), NEIGHBOUR);
    await expect.poll(
      () => page.evaluate(() => (window as any).__solarE2E?.activeSiteKey ?? ''),
      { message: 'picking the house next door did not activate a different property', timeout: 30_000 },
    ).not.toBe(melvinKey);
    await page.evaluate(d => (window as any).__solarE2E.seedDesign(d), seedAt(NEIGHBOUR, 'nbr') as any);
    await expect.poll(
      async () => (await panelIds(page)).sort().join(','),
      { message: "the studio never took the neighbour's design", timeout: 30_000 },
    ).toBe('nbr-p0,nbr-p1,nbr-p2');
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
