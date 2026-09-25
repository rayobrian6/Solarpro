/**
 * e2e/obstruction-survives-reload.spec.ts
 *
 * STEP 3 OF RAY'S NINE: PLACE A CHIMNEY, THE PANELS CLEAR, THEN SAVE AND RELOAD
 * IN A BROWSER.
 *
 * 🚨 THIS IS THE ONE LEG THAT WAS OWED. Steps 1–2 were browser-proven
 * (`e2e/chimney-clears-the-array.spec.ts` — a real click on a real roof removes
 * the modules over the flue, and every survivor is genuinely clear). Steps 4–9
 * were proven through the real CAD chain up to the stamped plan set
 * (`tests/manualObstructionReachesPlanset.test.ts`,
 * `tests/manualObstructionThroughCAD.test.ts`). Step 3 — does the hand-placed
 * object, and the array it pruned, actually come back — existed only at unit
 * level. That is exactly the gap where a defect hides, because two different
 * restore paths have to agree and each one is individually plausible.
 *
 * WHY THE CHIMNEY SPEC COULD NOT DO THIS. It opens `/design?e2eQuickDesign=1`,
 * and a Quick Design has no database row at all: `app/design/page.tsx` mints a
 * `demo-<timestamp>` id and the layout route rejects any non-UUID id with a 400
 * before it reads the body. That POST has never succeeded for a Quick Design and
 * never can. So proving persistence needs a REAL project, which is what
 * `e2e/persistence-join.spec.ts` established the harness for.
 *
 * 🚨 NO CREDENTIAL. `lib/dev/pgliteNeonBridge.ts` runs PostgreSQL compiled to
 * WebAssembly inside the Next server. `upsertLayout`, `rowToLayout` and the
 * route handlers are untouched production code. Armed with SOLARPRO_LOCAL_PG=1;
 * these tests SKIP when it is absent rather than pretending to pass.
 *
 * WHAT COULD GO WRONG HERE, AND THEREFORE WHAT IS ASSERTED. Three distinct
 * failures, all invisible to a count:
 *
 *   1. the chimney does not persist at all — `obstructions` is undefined on the
 *      way out, or `?? existing` keeps a stale value;
 *   2. the chimney persists but its `planeId` binding does not, so on reload it
 *      is an unbound object floating over the roof and the CAD chain drops it;
 *   3. the chimney persists AND THE PRUNED PANELS COME BACK — the restore
 *      rehydrates a pre-cull panel set, and the design reopens with modules
 *      sitting over a flue that the operator already cleared. This is the
 *      dangerous one. It looks like a working save: the object is there, the
 *      count is plausible, and nobody notices until a permit drawing shows a
 *      module on a chimney.
 *
 * Asserted BY ID, never by count. A count is satisfied by any array of the
 * right size, and case 3 specifically produces a right-looking array.
 */

import { expect, test, Page } from '@playwright/test';
import { DEFAULT_CLEARANCE_M } from '../lib/3d/panelKeepOut';
import { buildSectionRoofPlanes } from '../lib/3d/buildingSection';
import { multiSectionHouse } from '../tests/fixtures/multiSectionHouse';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

const ARMED = process.env.SOLARPRO_LOCAL_PG === '1';
const T = 60_000;
const M_PER_DEG_LAT = 111_132;

/** Melvin — the property the whole campaign is calibrated on. */
const MELVIN = {
  lat: 38.70615257709013,
  lng: -90.04625419301613,
  address: '3 Melvin Drive, Granite City, IL 62040',
};

const objects = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.placedObstructions ?? []) as any[]);
const panels = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.panels ?? []) as any[]);
const panelIds = async (p: Page) => (await panels(p)).map(x => String(x.id)).sort();

/**
 * Create a project through the REAL route, then pin its coordinates exactly.
 *
 * The create path geocodes the address, and `upsertLayout`'s coordinate-integrity
 * guard compares geometry against the project's stored position — so the fixture
 * states that position rather than inheriting whatever a geocoder with no API key
 * returned.
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

/** Read the layout back through the REAL route — the handler the studio calls. */
async function layoutFromDb(page: Page, id: string) {
  const res = await page.request.get(`/api/projects/${id}/layout`);
  expect(res.status(), 'GET /layout should not be an auth or config failure').toBe(200);
  return (await res.json()) as {
    data?: {
      panels?: Array<{ id: string }>;
      obstructions?: Array<Record<string, unknown>>;
    } | null;
  };
}

async function openProject(page: Page, id: string) {
  await page.goto(`/design?projectId=${id}`);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)),
    { message: 'the Design Studio should mount for a real saved project', timeout: 45_000 },
  ).toBe(true);
  await expect.poll(
    () => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E),
    { message: 'the Cesium viewer should come up', timeout: 90_000 },
  ).toBe(true);
}

/**
 * Seed the house and a DENSE grid across the first face.
 *
 * Dense on purpose: a chimney at the centroid must have real neighbours inside
 * its clearance, or "some panels went" is satisfied by a sparse array where
 * nothing was ever at risk.
 */
async function seedHouseAndArray(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), MELVIN);
  await expect.poll(
    () => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''),
    { timeout: 45_000 },
  ).not.toBe('');

  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }
  const face = planes[0];

  const grid = await page.evaluate((f: any) => {
    const C = (window as any).Cesium;
    const pts = ((f.polygon3D ?? []) as any[]).map(v => {
      const c = C.Cartographic.fromCartesian(v);
      return { lat: C.Math.toDegrees(c.latitude), lng: C.Math.toDegrees(c.longitude), h: c.height };
    });
    const out: any[] = [];
    for (let r = 0; r < 6; r++) {
      for (let c2 = 0; c2 < 5; c2++) {
        const u = (r + 0.5) / 6, v = (c2 + 0.5) / 5;
        const top = {
          lat: pts[0].lat + (pts[1].lat - pts[0].lat) * u,
          lng: pts[0].lng + (pts[1].lng - pts[0].lng) * u,
          h: pts[0].h + (pts[1].h - pts[0].h) * u,
        };
        const bot = {
          lat: pts[3].lat + (pts[2].lat - pts[3].lat) * u,
          lng: pts[3].lng + (pts[2].lng - pts[3].lng) * u,
          h: pts[3].h + (pts[2].h - pts[3].h) * u,
        };
        out.push({
          id: `p-${r}-${c2}`,
          lat: top.lat + (bot.lat - top.lat) * v,
          lng: top.lng + (bot.lng - top.lng) * v,
          height: top.h + (bot.h - top.h) * v,
          planeId: f.id, tilt: f.pitch ?? 20, azimuth: f.azimuth ?? 180,
          row: 0, col: r * 5 + c2, wattage: 400,
          widthM: 1.13, heightM: 1.72,
        });
      }
    }
    return out;
  }, face as any);

  await page.evaluate(d => (window as E2EWin).__solarE2E.seedDesign(d),
    { roofPlanes: planes, panels: grid } as any);
  await expect.poll(
    () => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0),
    { timeout: T },
  ).toBe(planes.length);
  return { planes, face, grid };
}

/**
 * Aim the camera at the roof and WAIT UNTIL IT ARRIVED.
 *
 * 🚨 AIMING IS NOT ARRIVING. Cesium keeps re-aiming as tiles load, so a face can
 * still project outside the canvas after the flight is requested, and every
 * click then lands on the sidebar — which reads exactly like the tool being
 * unwired. The chimney spec learned this; the same wait is required here.
 */
async function frame(page: Page) {
  const collect = `
    const viewer = window.__solarViewerE2E;
    const C = window.Cesium;
    const now = C.JulianDate.now();
    const pts = [];
    for (const ent of viewer.entities.values) {
      if (!String(ent?.name ?? '').startsWith('[PLANE3D-')) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }`;

  for (let i = 0; i < 8; i++) {
    const ok = await page.evaluate(new Function(`${collect}
      if (pts.length < 3) return false;
      const sphere = C.BoundingSphere.fromPoints(pts);
      try { viewer.camera.cancelFlight(); } catch {}
      viewer.camera.viewBoundingSphere(
        sphere, new C.HeadingPitchRange(0, C.Math.toRadians(-89), Math.max(70, sphere.radius * 7)));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      viewer.scene.requestRender();
      return true;`) as any);

    if (ok) {
      await page.waitForTimeout(900);
      const inside = await page.evaluate(new Function(`${collect}
        if (!pts.length) return false;
        const sphere = C.BoundingSphere.fromPoints(pts);
        const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
        const w = fn(viewer.scene, sphere.center);
        const cv = viewer.scene.canvas;
        return !!(w && isFinite(w.x) && isFinite(w.y)
          && w.x > 8 && w.y > 8 && w.x < cv.clientWidth - 8 && w.y < cv.clientHeight - 8);`) as any);
      if (inside) return;
    }
    await page.waitForTimeout(400);
  }
}

/** Project a roof face's centroid to canvas coordinates. */
async function faceCentreOnScreen(page: Page, faceId: string) {
  return page.evaluate((id: string) => {
    const viewer = (window as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    const now = C.JulianDate.now();
    const pts: any[] = [];
    for (const ent of viewer.entities.values) {
      const nm = String(ent?.name ?? '');
      if (!nm.startsWith('[PLANE3D-') || !nm.endsWith(` ${id}`)) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      // The face is drawn as an OUTLINE, i.e. a polyline — reading only
      // `polygon` finds nothing and reports "the roof never projected".
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }
    if (pts.length < 3) return null;
    const c = pts.reduce((a: any, p: any) => ({
      x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length,
    }), { x: 0, y: 0, z: 0 });
    const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
    const w = fn(viewer.scene, new C.Cartesian3(c.x, c.y, c.z));
    return w && isFinite(w.x) ? { x: w.x, y: w.y } : null;
  }, faceId);
}

function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  return {
    dx: Math.abs((b.lng - a.lng) * M_PER_DEG_LAT * cosLat),
    dy: Math.abs((b.lat - a.lat) * M_PER_DEG_LAT),
  };
}

/** Place a chimney at the centre of `face` through the real tool and real click. */
async function placeChimneyOn(page: Page, faceId: string) {
  await page.getByTestId('toolgroup-tools').waitFor({ timeout: 120_000 });
  await page.locator('body').press('o');
  await expect
    .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.placementMode ?? ''), { timeout: T })
    .toBe('obstruction');

  const chip = page.locator('[data-testid="obstruction-preset-chimney"]');
  await expect(chip).toBeVisible({ timeout: T });
  await chip.click();
  await page.waitForTimeout(400);

  const pt = await faceCentreOnScreen(page, faceId);
  expect(pt, 'the roof face never projected into the canvas').toBeTruthy();
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + pt!.x, box.y + pt!.y);

  await expect.poll(() => objects(page).then(o => o.length), {
    message: 'clicking the roof with Chimney armed placed nothing', timeout: T,
  }).toBe(1);
  return (await objects(page))[0];
}

test.describe('a hand-placed chimney survives a save and reload', () => {
  test.skip(!ARMED, 'SOLARPRO_LOCAL_PG is not set — no database is attached to this server.');

  test('the database is reachable', async ({ page }) => {
    // Guard the guard. Everything below is vacuous against a 503.
    const health = await page.request.get('/api/health');
    expect(JSON.stringify(await health.json())).not.toContain('not_configured');
  });

  test('🚨 the chimney AND the array it pruned both come back', async ({ page }) => {
    const id = await createProject(page, 'Obstruction — reload');
    await openProject(page, id);

    const { face, grid } = await seedHouseAndArray(page);
    await expect.poll(() => panels(page).then(p => p.length), { timeout: T }).toBe(grid.length);

    await frame(page);
    const chimney = await placeChimneyOn(page, face.id);
    expect(chimney.type).toBe('chimney');
    expect(chimney.planeId, 'the chimney did not bind to the face it was dropped on')
      .toBe(face.id);

    // ── The precondition: modules over the flue are gone, here, in a browser ──
    const survivors = await panelIds(page);
    const removed = grid.length - survivors.length;
    expect(removed, `the chimney removed ${removed} of ${grid.length} modules`).toBeGreaterThan(0);
    expect(survivors.length, 'the keep-out swallowed the whole array').toBeGreaterThan(0);

    // ── Wait for the ROW, not for component state ────────────────────────────
    // 🚨 A SLOW CADENCE, DELIBERATELY. Each poll is a real HTTP request and the
    // production rate limiter is live here; hammering the layout endpoint
    // produces `read ECONNRESET` mid-suite, which reads exactly like a crash.
    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.obstructions?.length ?? 0,
      { message: 'autosave never carried the hand-placed chimney to the database',
        timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(1);

    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.panels?.length ?? -1,
      { message: 'the saved panel count never settled on the PRUNED array',
        timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(survivors.length);

    // ── THE RELOAD ──────────────────────────────────────────────────────────
    await page.reload();
    await expect.poll(
      () => page.evaluate(() => Boolean((window as E2EWin).__solarE2E)),
      { message: 'the studio should mount again after a reload', timeout: 45_000 },
    ).toBe(true);

    await expect.poll(
      async () => (await objects(page)).length,
      { message: 'the hand-placed chimney did not come back after a reload', timeout: 45_000 },
    ).toBe(1);

    const [back] = await objects(page);

    // 1. It is the same OBJECT, not merely an object.
    expect(back.type, 'the restored object is no longer a chimney').toBe('chimney');
    expect(back.planeId,
      'the chimney came back UNBOUND — a roof object with no planeId is dropped by the CAD chain, ' +
      'so the permit drawing would lose it while the 3D view still showed it')
      .toBe(face.id);

    // 2. It came back WHERE IT WAS PUT. Within 5 cm: the round trip is
    //    lat/lng through JSON, so exact equality is not the right claim, but
    //    anything above a few centimetres means the position was recomputed
    //    rather than restored.
    const drift = metresApart(chimney, back);
    expect(Math.hypot(drift.dx, drift.dy),
      `the chimney moved ${Math.hypot(drift.dx, drift.dy).toFixed(3)} m across the reload`)
      .toBeLessThan(0.05);

    // 3. Its DIMENSIONS came back. A shadow-only or renderer-only size is
    //    exactly the split-brain the output-consistency rule forbids: the
    //    keep-out, the shadow and the plan set must all read one object.
    expect(Number(back.widthM), 'the restored chimney lost its width').toBeCloseTo(Number(chimney.widthM), 3);
    expect(Number(back.depthM), 'the restored chimney lost its depth').toBeCloseTo(Number(chimney.depthM), 3);

    // ── 🚨 AND THE PRUNED PANELS STAYED PRUNED ──────────────────────────────
    // The dangerous case. A restore that rehydrates a pre-cull panel set gives
    // back an array of plausible size with modules sitting over the flue, and
    // nothing downstream complains until a drawing shows it.
    await expect.poll(
      async () => (await panelIds(page)).length,
      { message: 'the array did not come back at all after a reload', timeout: 45_000 },
    ).toBe(survivors.length);

    // BY ID. A count is satisfied by any array of the right size — including
    // one where the culled modules returned and an equal number of others went.
    expect(await panelIds(page),
      'the restored array is not the array that was saved')
      .toEqual(survivors);

    // And the physical claim, re-measured after the reload rather than trusted
    // from before it: no survivor sits inside the chimney's clearance.
    const clearance = DEFAULT_CLEARANCE_M.chimney;
    const halfX = Number(back.widthM) / 2 + clearance + 1.13 / 2;
    const halfY = Number(back.depthM) / 2 + clearance + 1.72 / 2;
    const after = await panels(page);
    const offenders = after.filter((p: any) => {
      const d = metresApart(back as any, p);
      return d.dx < halfX - 0.01 && d.dy < halfY - 0.01;
    });
    expect(offenders.length,
      `${offenders.length} module(s) are inside the chimney's ${clearance} m clearance AFTER a reload: ` +
      offenders.map((o: any) => o.id).join(', '))
      .toBe(0);

    console.log('[OBSTRUCTION RELOAD]', JSON.stringify({
      projectId: id, placed: grid.length, removed, survivors: survivors.length,
      driftM: +Math.hypot(drift.dx, drift.dy).toFixed(4),
    }));
  });

  test('deleting the chimney persists too — and the modules do NOT come back', async ({ page }) => {
    // 🚨 THE INVERSE, and it is not symmetric. Deletion authority is its own
    // subsystem in this repo precisely because a destructive save that reports
    // success without persisting the tombstone brings the object back on reload.
    // But the modules the chimney removed must NOT return: they were culled, the
    // operator has since seen the array without them, and silently repopulating
    // a roof is how a module ends up over a flue that no longer appears to be
    // there. Removing the obstruction reopens the space; it does not re-place
    // anybody's panels.
    const id = await createProject(page, 'Obstruction — delete');
    await openProject(page, id);

    const { face, grid } = await seedHouseAndArray(page);
    await expect.poll(() => panels(page).then(p => p.length), { timeout: T }).toBe(grid.length);

    await frame(page);
    await placeChimneyOn(page, face.id);
    const afterPlace = await panelIds(page);
    expect(afterPlace.length).toBeLessThan(grid.length);

    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.obstructions?.length ?? 0,
      { message: 'the chimney never reached the database', timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(1);

    // Delete it through the PRODUCT'S OWN deletion path. `requestDelete` is the
    // bridge to `requestDeletion`, which goes through `site.planDelete` — the
    // same authority that mints the one-shot destructive token the save needs.
    // Reaching past it and splicing the array would prove nothing about whether
    // a deletion persists, which is the entire question here.
    const deleted = await page.evaluate(() => {
      const e2e = (window as any).__solarE2E;
      if (typeof e2e?.requestDelete !== 'function') return false;
      const first = (e2e.placedObstructions ?? [])[0];
      if (!first) return false;
      e2e.requestDelete('obstruction', first.id);
      return true;
    });
    test.skip(!deleted, 'the delete gesture is not reachable from the harness here');

    await expect.poll(() => objects(page).then(o => o.length), { timeout: T }).toBe(0);

    await expect.poll(
      async () => (await layoutFromDb(page, id)).data?.obstructions?.length ?? -1,
      { message: 'the deletion never reached the database — the chimney will be back on reload',
        timeout: 45_000, intervals: [500, 1000, 2000] },
    ).toBe(0);

    await page.reload();
    await expect.poll(
      () => page.evaluate(() => Boolean((window as E2EWin).__solarE2E)),
      { timeout: 45_000 },
    ).toBe(true);

    await expect.poll(
      async () => (await objects(page)).length,
      { message: 'the deleted chimney came back after a reload', timeout: 45_000 },
    ).toBe(0);

    expect(await panelIds(page),
      'the modules the chimney had removed were silently re-placed by the reload')
      .toEqual(afterPlace);
  });
});
