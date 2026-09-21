import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_SITE, buildGablePlanes, seedPlanes, waitForCesiumCanvas, runAutoLayout,
} from './support/seedRoof';

/**
 * e2e/roof-face-selection.spec.ts
 *
 * "I can see the individual marked roof planes in SolarPro 3D, but I cannot
 * select those individual marked planes."
 *
 * This spec drives the REAL canvas: it computes where a face is on screen and
 * dispatches an actual mouse click there, then asserts on the CANONICAL face id
 * the application reports. It never sets a selected id directly — a spec that
 * assigns the answer proves the assertion, not the feature.
 *
 * WHICH PROVIDER THIS IS
 * ----------------------
 * The faces are seeded through `buildRoofPlane3D`, the same constructor the 3D
 * roof-tracing tool calls, and they arrive `source: 'manual'`. This is the
 * CUSTOM / fallback geometry provider inside SolarPro 3D — the path used where
 * Google's 3D data is unavailable or unusable. No Google Solar call is made and
 * none is needed, which is the point: the fallback provider must be selectable
 * on its own.
 *
 * WHAT WAS ACTUALLY BROKEN — so that a later reader knows what these assertions
 * are worth:
 *   • a face marked but not panelled renders through the `outlineOnly` branch,
 *     which adds ONE polyline and returns — no polygon, nothing to hit;
 *   • `[PLANE3D-*]` entities carry the plane id only inside `entity.name`, and
 *     no pick path in the repo parsed those names;
 *   • `onRoofPlaneSelect` and `selectedRoofPlaneId` were declared, destructured
 *     and never called or passed.
 */

const SELECT_TIMEOUT = 15_000;

type E2EWin = Window & {
  __solarE2E?: { selected3DFaceId: string | null; roofPlanes: Array<{ id: string }> };
  __solarViewerE2E?: any;
};

/** Screen position, in CSS pixels relative to the canvas, of a face's centre —
 *  computed from the entities Cesium is ACTUALLY drawing, so a click lands on
 *  what the user can see rather than on where the test thinks it should be. */
async function faceScreenPoint(page: Page, planeId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((id: string) => {
    const w = window as unknown as E2EWin;
    const viewer = w.__solarViewerE2E;
    const C = (window as any).Cesium;
    if (!viewer || !C) return null;

    // Gather every vertex Cesium holds for this plane, from whichever entity
    // family drew it — outline-only faces have a polyline and no polygon.
    const pts: any[] = [];
    const now = C.JulianDate.now();
    for (const ent of viewer.entities.values) {
      const name: string = ent?.name ?? '';
      if (!name.startsWith('[PLANE3D-') || !name.endsWith(` ${id}`)) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }
    if (pts.length < 3) return null;

    const centre = pts.reduce(
      (acc: any, p: any) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length, z: acc.z + p.z / pts.length }),
      { x: 0, y: 0, z: 0 },
    );
    const win = C.SceneTransforms.worldToWindowCoordinates
      ? C.SceneTransforms.worldToWindowCoordinates(viewer.scene, new C.Cartesian3(centre.x, centre.y, centre.z))
      : C.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, new C.Cartesian3(centre.x, centre.y, centre.z));
    if (!win || !isFinite(win.x) || !isFinite(win.y)) return null;
    return { x: win.x, y: win.y };
  }, planeId);
}

/**
 * Point the camera at the roof and wait until it is actually on screen.
 *
 * 🚨 NOT COSMETIC SETUP. Measured before this existed: the seeded faces
 * projected to y = -173 px, i.e. ABOVE the canvas, because the boot camera aims
 * at the SITE datum and the fixture's roof sits at a fixed ellipsoidal height.
 * `page.mouse.click` then landed on the sidebar, the engine never saw a canvas
 * click at all, and the spec reported "clicking face B did not select face B" —
 * a harness artefact that reads exactly like the defect under test.
 *
 * A user gets the roof on screen by orbiting to it. This does the same thing
 * deterministically, and `clickCanvasAt` refuses to click outside the canvas so
 * the artefact cannot come back silently.
 */
async function frameRoof(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = (window as unknown as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    const pts: any[] = [];
    const now = C.JulianDate.now();
    for (const ent of viewer.entities.values) {
      const name: string = ent?.name ?? '';
      if (!name.startsWith('[PLANE3D-')) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }
    if (pts.length < 3) return;
    const sphere = C.BoundingSphere.fromPoints(pts);
    // Straight down the local normal, far enough that the whole roof fits.
    viewer.camera.viewBoundingSphere(
      sphere,
      new C.HeadingPitchRange(0, C.Math.toRadians(-89), Math.max(60, sphere.radius * 7)),
    );
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.scene.requestRender();
  });
  // The projection must settle INSIDE the canvas before anything is clicked.
  await expect
    .poll(async () => {
      const r = await page.evaluate(() => {
        const viewer = (window as unknown as E2EWin).__solarViewerE2E;
        const C = (window as any).Cesium;
        const cv = viewer.scene.canvas;
        const pts: any[] = [];
        const now = C.JulianDate.now();
        for (const ent of viewer.entities.values) {
          const name: string = ent?.name ?? '';
          if (!name.startsWith('[PLANE3D-')) continue;
          const line = ent.polyline?.positions?.getValue?.(now);
          if (line?.length) pts.push(...line);
          const poly = ent.polygon?.hierarchy?.getValue?.(now);
          if (poly?.positions?.length) pts.push(...poly.positions);
        }
        if (!pts.length) return false;
        const f = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
        return pts.every((p: any) => {
          const w = f(viewer.scene, p);
          return !!w && w.x > 4 && w.y > 4 && w.x < cv.clientWidth - 4 && w.y < cv.clientHeight - 4;
        });
      });
      return r;
    }, { message: 'the roof never came fully on screen', timeout: 20_000 })
    .toBe(true);
}

/** A real click on the Cesium canvas at a canvas-relative position. */
async function clickCanvasAt(page: Page, pt: { x: number; y: number }): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box, 'the Cesium canvas has no bounding box').not.toBeNull();
  // A click outside the canvas reaches the sidebar, not the engine, and would
  // look identical to "the feature does not work".
  expect(pt.x, 'click x is off-canvas').toBeGreaterThanOrEqual(0);
  expect(pt.y, 'click y is off-canvas').toBeGreaterThanOrEqual(0);
  expect(pt.x, 'click x is off-canvas').toBeLessThanOrEqual(box!.width);
  expect(pt.y, 'click y is off-canvas').toBeLessThanOrEqual(box!.height);
  await page.mouse.click(box!.x + pt.x, box!.y + pt.y);
}

/**
 * A canvas point that is demonstrably NOT on any roof face.
 *
 * A fixed corner is not good enough: once the camera is framed on the roof the
 * corner can still be over it, and the "clicking empty space clears the
 * selection" test then fails for the wrong reason. This computes the screen
 * bounding box of everything drawn and returns a point clear of it, refusing if
 * no such point exists rather than clicking something and hoping.
 */
async function emptyScreenPoint(page: Page): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate(() => {
    const viewer = (window as unknown as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    const cv = viewer.scene.canvas;
    const f = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
    const now = C.JulianDate.now();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ent of viewer.entities.values) {
      const name: string = ent?.name ?? '';
      if (!name.startsWith('[PLANE3D-') && !name.startsWith('[PANEL')) continue;
      const pts: any[] = [];
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      const pos = ent.position?.getValue?.(now);
      if (pos) pts.push(pos);
      for (const p of pts) {
        const w = f(viewer.scene, p);
        if (!w || !isFinite(w.x) || !isFinite(w.y)) continue;
        minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
        minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
      }
    }
    if (!isFinite(minX)) return null;
    const MARGIN = 24;
    // Prefer above the roof, then below, then left, then right.
    if (minY - MARGIN > 8)                  return { x: (minX + maxX) / 2, y: Math.max(8, minY - MARGIN) };
    if (maxY + MARGIN < cv.clientHeight - 8) return { x: (minX + maxX) / 2, y: Math.min(cv.clientHeight - 8, maxY + MARGIN) };
    if (minX - MARGIN > 8)                  return { x: Math.max(8, minX - MARGIN), y: (minY + maxY) / 2 };
    if (maxX + MARGIN < cv.clientWidth - 8)  return { x: Math.min(cv.clientWidth - 8, maxX + MARGIN), y: (minY + maxY) / 2 };
    return null;
  });
  expect(pt, 'no empty canvas point exists — the roof fills the viewport, so this test cannot run').not.toBeNull();
  return pt!;
}

async function selectedFaceId(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => (window as unknown as E2EWin).__solarE2E?.selected3DFaceId);
}

/** The width Cesium is drawing this face's outline at. Selected faces are drawn
 *  wider; this is how "only B received selected styling" is checked against the
 *  scene rather than against the state that caused it. */
async function outlineWidth(page: Page, planeId: string): Promise<number | null> {
  return page.evaluate((id: string) => {
    const viewer = (window as unknown as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    if (!viewer || !C) return null;
    const now = C.JulianDate.now();
    for (const ent of viewer.entities.values) {
      const name: string = ent?.name ?? '';
      if (name.startsWith('[PLANE3D-OUTLINE] ') && name.endsWith(` ${id}`)) {
        return ent.polyline?.width?.getValue?.(now) ?? null;
      }
    }
    return null;
  }, planeId);
}

/**
 * Click the face with this id, resolving WHERE it is at the moment of the click.
 *
 * 🚨 A PRE-COMPUTED SCREEN POINT GOES STALE. The engine owns its own orbit
 * (`orbitRef` / `applyOrbit`) and re-applies it on its own schedule, and Auto
 * Layout re-frames onto the new array, so a coordinate captured a few hundred
 * milliseconds earlier can be pointing at a different face by the time the mouse
 * gets there. That produced an intermittent failure where clicking B resolved to
 * A — which, because A was already selected, TOGGLED IT OFF and reported null:
 * a harness artefact that reads exactly like "selection is broken".
 *
 * Re-framing and re-projecting per click removes the race without weakening
 * anything: the assertion is still "click the face, get that face".
 */
async function clickFace(page: Page, faceId: string): Promise<void> {
  await frameRoof(page);
  const pt = await faceScreenPoint(page, faceId);
  expect(pt, `face ${faceId} is not on screen — the spec cannot click what is not drawn`).not.toBeNull();
  await clickCanvasAt(page, pt!);
}

async function openStudio(page: Page): Promise<void> {
  // `/design` on its own is the project picker. `e2eQuickDesign=1` is the same
  // quick-launch entry the other specs use, and lands in the studio itself.
  await page.goto('/design?e2eQuickDesign=1');
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
      { message: 'the NEXT_PUBLIC_E2E hook never installed', timeout: 30_000 })
    .toBe(true);
  const ok = await waitForCesiumCanvas(page);
  expect(ok, 'the Cesium canvas never became visible — this spec cannot run blind').toBe(true);
  // The viewer handle appears only at stage 'done'. Reading entities before then
  // finds an EMPTY collection, and an empty collection would let every
  // assertion below pass in silence.
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as E2EWin).__solarViewerE2E),
      { message: 'the 3D engine never reached stage "done"', timeout: 60_000 })
    .toBe(true);
}

test.describe('custom/fallback roof faces are individually selectable', () => {
  test('clicking a rendered face selects THAT face, by canonical id', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    // Nothing selected to begin with.
    expect(await selectedFaceId(page)).toBeNull();

    await clickFace(page, north.id);

    await expect
      .poll(() => selectedFaceId(page), {
        message: 'clicking face B did not select face B',
        timeout: SELECT_TIMEOUT,
      })
      .toBe(north.id);

    // ONLY B is styled selected.
    expect(await outlineWidth(page, north.id)).toBeGreaterThan(await outlineWidth(page, south.id) as number);
  });

  test('A -> B -> A, and neighbours are never disturbed', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    await clickFace(page, south.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(south.id);
    const aWidthWhenSelected = await outlineWidth(page, south.id);

    await clickFace(page, north.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(north.id);

    await clickFace(page, south.id);
    await expect
      .poll(() => selectedFaceId(page), {
        message: 'returning to face A did not reselect the SAME logical face',
        timeout: SELECT_TIMEOUT,
      })
      .toBe(south.id);
    expect(await outlineWidth(page, south.id)).toBe(aWidthWhenSelected);

    // Selecting faces must not have edited the geometry of either one.
    const ids = await page.evaluate(() =>
      ((window as unknown as E2EWin).__solarE2E?.roofPlanes ?? []).map(p => p.id).sort());
    expect(ids).toEqual([south.id, north.id].sort());
  });

  test('clicking empty space clears the selection and leaves nothing stale', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    await clickFace(page, north.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(north.id);

    await clickCanvasAt(page, await emptyScreenPoint(page));

    await expect
      .poll(() => selectedFaceId(page), {
        message: 'a click on empty space left a face selected',
        timeout: SELECT_TIMEOUT,
      })
      .toBeNull();
    // And the highlight is gone from the scene, not merely from the state.
    expect(await outlineWidth(page, north.id)).toBe(await outlineWidth(page, south.id));
  });

  test('a PANEL still wins the click — face selection did not steal panel picking', async ({ page }) => {
    // The protected behaviour. Panels are picked first; roof faces only answer
    // where no panel does. If this fails, the array became unselectable.
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);
    await runAutoLayout(page);
    // Auto Layout re-frames the camera onto the new array (measured: it drops to
    // ~42 m, below the seeded roof), which leaves every panel outside the
    // frustum and unprojectable. Put the roof back on screen before clicking.
    await frameRoof(page);

    // Panels reach the scene through a React effect, so studio state can lead the
    // entity collection. Waiting on the entities keeps "no panel on screen" an
    // honest failure rather than a race.
    await expect
      .poll(() => page.evaluate(() => {
        const viewer = (window as unknown as E2EWin).__solarViewerE2E;
        let n = 0;
        for (const e of viewer.entities.values) if ((e?.name ?? '').startsWith('[PANEL] ')) n++;
        return n;
      }), { message: 'Auto Layout placed panels but none were drawn', timeout: 30_000 })
      .toBeGreaterThan(0);

    const panelPoint = await page.evaluate(() => {
      const viewer = (window as unknown as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      if (!viewer || !C) return null;
      const now = C.JulianDate.now();
      for (const ent of viewer.entities.values) {
        if (!(ent?.name ?? '').startsWith('[PANEL] ')) continue;
        const pos = ent.position?.getValue?.(now);
        if (!pos) continue;
        const win = C.SceneTransforms.worldToWindowCoordinates
          ? C.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
          : C.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, pos);
        if (win && isFinite(win.x) && isFinite(win.y)) return { x: win.x, y: win.y };
      }
      return null;
    });
    expect(panelPoint, 'no panel was on screen after Auto Layout').not.toBeNull();

    await clickCanvasAt(page, panelPoint!);
    // A panel click must NOT produce a face selection.
    await page.waitForTimeout(500);
    expect(await selectedFaceId(page)).toBeNull();
  });

  test('the same logical face is selected again after a reload', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    await clickFace(page, north.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(north.id);

    // Reopen the studio and put the SAME planes back — the ids are the canonical
    // ones the design carries, so this is the reload path, not a fresh design.
    await openStudio(page);
    await seedPlanes(page, [south, north]);
    await frameRoof(page);
    expect(await selectedFaceId(page), 'a reopened design must not arrive pre-selected').toBeNull();

    await clickFace(page, north.id);

    await expect
      .poll(() => selectedFaceId(page), {
        message: 'after reload, clicking face B selected a different logical face',
        timeout: SELECT_TIMEOUT,
      })
      .toBe(north.id);
  });

  test('a ridge click resolves to one of the two adjoining faces, never to nothing', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    // The ridge is the shared edge: the midpoint between the two face centres,
    // computed on screen from what is actually drawn.
    await frameRoof(page);
    const a = await faceScreenPoint(page, south.id);
    const b = await faceScreenPoint(page, north.id);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const ridge = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };

    await clickCanvasAt(page, ridge);
    await expect
      .poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT })
      .not.toBeNull();
    const first = await selectedFaceId(page);
    expect([south.id, north.id]).toContain(first);

    // Deselect, click the identical point again: the same face, not a coin flip.
    await clickCanvasAt(page, await emptyScreenPoint(page));
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBeNull();
    await clickCanvasAt(page, ridge);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(first);
  });
});

test.describe('the site is the custom/fallback provider, and says so', () => {
  test('every seeded face is source:manual — no Google detection took place', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);
    const sources = await page.evaluate(() =>
      ((window as unknown as E2EWin).__solarE2E?.roofPlanes ?? []).map((p: any) => p.source));
    expect(sources).toEqual(['manual', 'manual']);
    expect(DEMO_SITE.lat).toBeGreaterThan(0);   // fixture sanity
  });
});
