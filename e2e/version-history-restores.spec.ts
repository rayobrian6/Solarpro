/**
 * e2e/version-history-restores.spec.ts
 *
 * THE WAY BACK, IN A REAL BROWSER.
 *
 * Every layout save has written a snapshot to `project_versions` for a long time.
 * The list route and the restore route both existed, and the restore route carries
 * two hard-won repairs — it reconstructs panel elevations from the snapshot's own
 * roof planes rather than writing height-less panels nothing can draw, and it
 * carries `siteArchives` with the roof, because omitting it made a restore delete
 * the roof outright.
 *
 * 🚨 AND NOTHING IN THE PRODUCT EVER CALLED EITHER ONE. A design-history panel now
 * does. It is the documented recovery path for a `LAYOUT_STALE_WRITE` refusal —
 * which discards the losing tab's edit — so it has to work, and it has to work for
 * the person who has just been told their work was not saved.
 *
 * WHAT THIS PROVES THAT THE UNIT TESTS CANNOT:
 *
 *   1. the list the operator sees comes from real rows, and shows the MODULE COUNTS
 *      that make it a recovery tool rather than a log of timestamps;
 *   2. a restore actually restores — the array comes back BY ID, through the real
 *      route, out of real PostgreSQL;
 *   3. 🚨 THE WEDGE. A restore moves the row's version. If the tab does not adopt
 *      the version the restore produced, its very next autosave is refused as
 *      somebody else's — so a SUCCESSFUL restore would leave the studio unable to
 *      save, behind a refusal badge that is permanent by design. Nothing short of
 *      a real save after a real restore tests that;
 *   4. 🚨 THE PRECONDITION. A restore launched from a panel left open while the row
 *      moved on must be REFUSED, with the server's own sentence on screen — not
 *      silently win. That is the case where the feature could quietly overwrite
 *      somebody, and it is the reason the restore sends a version at all.
 *
 * 🚨 NO CREDENTIAL. `lib/dev/pgliteNeonBridge.ts` runs PostgreSQL compiled to
 * WebAssembly inside the Next server. The route handlers, `upsertLayout` and
 * `saveProjectVersion` are untouched production code. Armed with
 * SOLARPRO_LOCAL_PG=1; these tests SKIP when it is absent rather than pretending to
 * pass. The bridge refuses to boot unless a real query through
 * `@neondatabase/serverless` comes back from the in-process database, so a 503 here
 * is a real failure and not the harness.
 */

import { expect, test, Page } from '@playwright/test';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

const ARMED = process.env.SOLARPRO_LOCAL_PG === '1';
const T = 60_000;

/** Melvin — the property this campaign is calibrated on. */
const MELVIN = {
  lat: 38.70615257709013,
  lng: -90.04625419301613,
  address: '3 Melvin Drive, Granite City, IL 62040',
};

const panelIds = (p: Page): Promise<string[]> =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.panels ?? [])
    .map((q: { id: string }) => String(q.id)).sort());

/**
 * Create a project through the REAL route, then pin its coordinates.
 *
 * 🚨 THE ADDRESS MATCHES THE COORDINATES, and that is not cosmetic. The studio
 * re-geocodes on mount (the documented v52.1 rule: a street-level geocode wins over
 * stored coords) and PUTs the result back over the pin. A fixture that pins one
 * place and names another ends up with its seeded roof kilometres from the active
 * site, and autosave then honestly writes nothing — which is how two tests in
 * `e2e/persistence-join.spec.ts` came to look like a product defect.
 */
async function createProject(page: Page, name: string): Promise<string> {
  const created = await page.request.post('/api/projects', {
    data: {
      name, address: MELVIN.address, lat: MELVIN.lat, lng: MELVIN.lng,
      systemType: 'roof', status: 'lead',
    },
  });
  expect([200, 201], 'creating a project through the real route should succeed')
    .toContain(created.status());
  const id = (await created.json())?.data?.id as string;
  expect(id, 'the created project should have an id').toBeTruthy();
  const pinned = await page.request.put(`/api/projects/${id}`,
    { data: { lat: MELVIN.lat, lng: MELVIN.lng, address: MELVIN.address } });
  expect(pinned.status()).toBe(200);
  return id;
}

async function openProject(page: Page, id: string) {
  await page.goto(`/design?projectId=${id}`);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)),
    { message: 'the Design Studio should mount for a real saved project', timeout: 45_000 },
  ).toBe(true);
}

/** Write a layout through the REAL route, exactly as the studio's autosave does. */
async function saveLayout(page: Page, id: string, panels: unknown[], expectedUpdatedAt?: string) {
  const res = await page.request.post(`/api/projects/${id}/layout`, {
    data: {
      panels,
      roofPlanes: [{
        id: 'melvin-r0', pitch: 20, azimuth: 180,
        vertices: [
          { lat: MELVIN.lat, lng: MELVIN.lng },
          { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng },
          { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng + 0.0001 },
        ],
      }],
      obstructions: [], measurements: [],
      mapCenter: { lat: MELVIN.lat, lng: MELVIN.lng }, mapZoom: 19,
      systemType: 'roof',
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    },
  });
  return { status: res.status(), body: await res.json().catch(() => null) as any };
}

const modules = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `melvin-p${i}`, planeId: 'melvin-r0',
  lat: MELVIN.lat, lng: MELVIN.lng, height: 180,
  tilt: 20, azimuth: 180, wattage: 400, widthM: 1.13, heightM: 1.72, row: 0, col: i,
}));

async function versions(page: Page, id: string) {
  const res = await page.request.get(`/api/projects/${id}/versions`);
  expect(res.status(), 'GET /versions should not be an auth or config failure').toBe(200);
  return ((await res.json())?.data ?? []) as Array<{
    id: string; versionNumber: number; panelsCount: number; systemSizeKw: number;
  }>;
}

test.describe('design history — list, restore, and the two ways it could bite', () => {
  test.skip(!ARMED, 'SOLARPRO_LOCAL_PG is not set — no database is attached to this server.');

  test('the database is reachable', async ({ page }) => {
    // Guard the guard: everything below is vacuous against a 503.
    const health = await page.request.get('/api/health');
    expect(JSON.stringify(await health.json())).not.toContain('not_configured');
  });

  test('🚨 a version records each distinct save, and NOT the ones that change nothing', async ({ page }) => {
    const id = await createProject(page, 'History — list');

    const first = await saveLayout(page, id, modules(12));
    expect(first.status).toBe(200);

    // The same payload again. A snapshot that records no change is noise in the one
    // list a person consults to recover, so it must not create a version.
    const again = await saveLayout(page, id, modules(12));
    expect(again.status).toBe(200);

    const changed = await saveLayout(page, id, modules(7));
    expect(changed.status).toBe(200);

    const list = await versions(page, id);
    expect(list.map(v => v.panelsCount),
      'the history should read [12, 7] — a redundant save wrote a snapshot, or a real change did not')
      .toEqual([7, 12]);   // the list route orders version_number DESC
  });

  test('🚨 the panel lists the module counts, and restoring brings the array back', async ({ page }) => {
    const id = await createProject(page, 'History — restore');
    await saveLayout(page, id, modules(12));
    await saveLayout(page, id, modules(4));

    await openProject(page, id);
    await expect.poll(async () => (await panelIds(page)).length,
      { message: 'the studio should load the 4-panel design', timeout: 45_000 }).toBe(4);

    // Open the panel through the control the operator uses.
    await page.getByRole('button', { name: /History/i }).first().click();
    const rows = page.locator('[data-testid="version-history-row"]');
    await expect(rows.first()).toBeVisible({ timeout: T });
    await expect.poll(async () => rows.count(), { timeout: T }).toBe(2);

    // 🚨 THE NUMBERS, not a column of dates. This is what makes the list a
    // recovery tool: "which one do I want" is answerable from the module count.
    await expect(rows.nth(0)).toContainText(/4 modules/);
    await expect(rows.nth(1)).toContainText(/12 modules/);

    // Restore the 12-panel version. It must CONFIRM first — one click may not
    // replace the whole design.
    await rows.nth(1).getByTestId('version-history-restore').click();
    const confirm = rows.nth(1).getByTestId('version-history-confirm-ok');
    await expect(confirm, 'restoring did not ask first').toBeVisible({ timeout: T });
    expect(await panelIds(page), 'the design changed before the confirmation')
      .toHaveLength(4);

    await confirm.click();

    // The panel reloads the studio after a successful restore.
    await expect.poll(
      () => page.evaluate(() => Boolean((window as E2EWin).__solarE2E)),
      { message: 'the studio should come back after the restore', timeout: 60_000 },
    ).toBe(true);
    await expect.poll(async () => (await panelIds(page)).length,
      { message: 'the restored design never arrived', timeout: 45_000 }).toBe(12);

    // BY ID. A count is satisfied by any array of the right size.
    expect(await panelIds(page)).toEqual(modules(12).map(m => m.id).sort());
  });

  test('🚨 THE WEDGE — the studio can still SAVE after a restore', async ({ page }) => {
    // 🚨 A restore moves the row's version. A tab that keeps its old token is
    // refused on its very next autosave, so a SUCCESSFUL restore would leave the
    // studio unable to save — behind a refusal badge that is permanent by design,
    // which reads as the restore having broken the design.
    const id = await createProject(page, 'History — wedge');
    await saveLayout(page, id, modules(12));
    await saveLayout(page, id, modules(4));

    const list = await versions(page, id);
    const twelve = list.find(v => v.panelsCount === 12)!;
    expect(twelve, 'the 12-panel version is not in the history').toBeTruthy();

    const restored = await page.request.post(`/api/projects/${id}/versions/${twelve.id}`, { data: {} });
    expect(restored.status(), 'the restore itself failed').toBe(200);
    const after = (await restored.json())?.data;
    expect(after?.updatedAt,
      'the restore did not return the row\'s new version — a client cannot adopt what it is not told')
      .toBeTruthy();

    // The version the restore produced must be the one that now works...
    const good = await saveLayout(page, id, modules(9), String(after.updatedAt));
    expect(good.status, 'a save stating the version the restore returned was refused')
      .toBe(200);

    // ...and the version from BEFORE the restore must not.
    const stale = await saveLayout(page, id, modules(3), String(twelve.versionNumber));
    expect([400, 409], 'a save stating a version the row never had was accepted')
      .toContain(stale.status);
  });

  test('🚨 THE PRECONDITION — a restore from a stale panel is refused, and says so', async ({ page }) => {
    // The case where this feature could quietly overwrite somebody: the panel is
    // open, the row moves on, and the operator restores believing they are undoing
    // their OWN change.
    const id = await createProject(page, 'History — stale restore');
    await saveLayout(page, id, modules(12));
    await saveLayout(page, id, modules(4));

    const list = await versions(page, id);
    const twelve = list.find(v => v.panelsCount === 12)!;

    // What a panel opened now would hold.
    const layout = await page.request.get(`/api/projects/${id}/layout`);
    const staleToken = String((await layout.json())?.data?.updatedAt ?? '');
    expect(staleToken, 'the layout route did not return a version to be stale about')
      .toBeTruthy();

    // Somebody else saves.
    const moved = await saveLayout(page, id, modules(6));
    expect(moved.status).toBe(200);

    // Now restore with the token from before that save.
    const refused = await page.request.post(`/api/projects/${id}/versions/${twelve.id}`,
      { data: { expectedUpdatedAt: staleToken } });
    expect(refused.status(),
      'a restore built on a version the row has moved past was ACCEPTED — it just ' +
      'overwrote somebody, while the operator believed they were undoing their own change')
      .toBe(409);

    const body = await refused.json().catch(() => null) as any;
    expect(String(body?.error ?? ''),
      'the refusal does not say nothing was written, so the operator cannot tell what state they are in')
      .toMatch(/nothing has been written|saved somewhere else/i);

    // And it really wrote nothing: the 6-panel design stands.
    const still = await page.request.get(`/api/projects/${id}/layout`);
    expect(((await still.json())?.data?.panels ?? []).length,
      'the refused restore wrote anyway').toBe(6);
  });
});
