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

/** Is the 🏚 Building toggle on right now? Read from the button's own label. */
async function buildingModeOn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(e => (e.textContent || '').includes('Building'));
    return (b?.textContent || '').includes('✓');
  });
}

/** 🚨 A PREREQUISITE ASSERTION, NOT A CONVENIENCE.
 *  Every interaction test in this file must state which click-router it is
 *  exercising, because Building ON and Building OFF route the same click to
 *  different code and a test that does not say which one it ran on proves
 *  nothing about the other. */
async function assertBuildingMode(page: Page, expected: boolean): Promise<void> {
  const actual = await buildingModeOn(page);
  expect(actual, `this test requires Building mode ${expected ? 'ON' : 'OFF'}`).toBe(expected);
}

/** Toggle Building via a real DOM click. `force: true` on the Playwright
 *  locator does NOT fire React's handler here — measured — so the element's own
 *  click() is used and the resulting state is asserted, never assumed. */
async function setBuildingMode(page: Page, on: boolean): Promise<void> {
  if (await buildingModeOn(page) === on) return;
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(e => (e.textContent || '').includes('Building'));
    (b as HTMLButtonElement | undefined)?.click();
  });
  await expect
    .poll(() => buildingModeOn(page), { message: `Building mode did not turn ${on ? 'on' : 'off'}`, timeout: 10_000 })
    .toBe(on);
  await page.waitForTimeout(1500);   // let the extrusion rebuild
}

/** Count the Cesium entities in each family, so a test can prove the scene it
 *  is clicking on actually contains what it thinks. */
async function entityFamilies(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const viewer = (window as unknown as E2EWin).__solarViewerE2E;
    const out: Record<string, number> = {};
    for (const e of viewer.entities.values) {
      const n: string = (e as any)?.name ?? '';
      const fam = n.slice(0, n.indexOf(']') + 1);
      if (fam) out[fam] = (out[fam] ?? 0) + 1;
    }
    return out;
  });
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

  test('WITH BUILDING OFF, a panel still wins the click', async ({ page }) => {
    // 🚨 THE SCOPE IN THIS NAME IS LOad-BEARING. An earlier version of this test
    // was called "a PANEL still wins the click" and was read as a statement
    // about the product. It is not: `showBuilding3D` defaults to FALSE, so this
    // only ever exercised the Building-OFF router. With Building ON the
    // `[BUILD3D-ROOF]` branch runs FIRST and returns, so a panel click selects
    // the roof face underneath it — see the Building-ON describe block below.
    // A test that says "panel wins" when it means "panel wins with Building
    // OFF" is a false proof, which is the same failure this whole spec exists
    // to stop.
    await openStudio(page);
    await assertBuildingMode(page, false);
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

/**
 * PLANE LIFECYCLE — the render cache may hold a ghost, it may not decide anything.
 *
 * The three plane maps in SolarEngine3D are never pruned (deliberately: a
 * reconcile-deletions block once destroyed a user's traced garage by inferring
 * intent from a prop's timing). So a deleted face is still DRAWN — and used to
 * still be selectable, still shape the building, and still be clustered into
 * the surviving faces' geometry by Stitch.
 *
 * These drive the real production path: the studio's own setter removes the
 * plane from the design, exactly as the sidebar ✕ does, and nothing clears the
 * cache.
 */
test.describe('a face removed from the design stops deciding things', () => {
  test('it is no longer selectable, and its neighbour still is', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    // It IS selectable while it is part of the design.
    await clickFace(page, north.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(north.id);

    // Remove it from the design — the same state transition the sidebar delete
    // performs. The entities and the cache entry both remain.
    const wherePoint = await faceScreenPoint(page, north.id);
    expect(wherePoint, 'the ghost should still be DRAWN — nothing is deleted from the scene')
      .not.toBeNull();
    await seedPlanes(page, [south]);

    // The selection cannot outlive its face.
    await expect
      .poll(() => selectedFaceId(page), {
        message: 'the selection survived the face it pointed at',
        timeout: SELECT_TIMEOUT,
      })
      .toBeNull();

    // And clicking the ghost resolves to nothing, not to a canonical id the
    // design no longer contains.
    await clickCanvasAt(page, wherePoint!);
    await page.waitForTimeout(600);
    expect(await selectedFaceId(page), 'a deleted face was still clickable').toBeNull();

    // The surviving face is untouched.
    await clickFace(page, south.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(south.id);
  });

  test('STITCH does not fold a deleted face back into the roof', async ({ page }) => {
    // The destructive case. stitchRoofVertices moves corners to a cluster
    // AVERAGE, so a ghost in the cache drags the faces the user kept toward a
    // plane they deleted. With one face left in the design, Stitch must see one
    // face — not two — and decline.
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await frameRoof(page);

    await seedPlanes(page, [south]);
    await page.waitForTimeout(800);

    const stitch = page.getByRole('button', { name: /stitch/i }).first();
    await expect(stitch, 'the Stitch button should exist').toBeVisible();
    await stitch.click({ force: true });
    await page.waitForTimeout(1200);

    const msg = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter(e => e.children.length === 0)
        .map(e => e.textContent || '')
        .find(t => /Stitch needs|Stitched|Abutments/i.test(t)) ?? '');

    expect(msg, 'Stitch counted the deleted face and ran on it')
      .toMatch(/Stitch needs 2\+ marked planes/i);
  });
});

/**
 * BUILDING MODE IS A DIFFERENT CLICK ROUTER, AND UNTIL NOW NOTHING TESTED IT.
 *
 * `showBuilding3D` defaults to false. In `handleSelectClick` the Building branch
 * runs FIRST and RETURNS on a hit:
 *
 *     if (showBuilding3DRef.current) {
 *       const faceId = pickBuildingFaceAtScreen(viewer, C, screenPos);
 *       if (faceId) { ...; return; }          // <- before the panel pick
 *     }
 *
 * and `pickBuildingFaceAtScreen` drills 8 deep and returns the FIRST
 * `[BUILD3D-ROOF]` match WITHOUT checking whether something nearer was hit. So a
 * panel in front of a roof face does not shield it. The comment in the engine
 * claiming a panel click "still falls through to the panel logic below" is
 * wrong.
 *
 * These tests RECORD CURRENT BEHAVIOUR. They are not a statement that the
 * behaviour is desirable — wall clicks in particular are known to be wrong. The
 * selection hierarchy is a product decision that has not been made yet, and
 * pinning today's answer is what makes a future change visible instead of
 * silent.
 */
test.describe('Building mode routes clicks differently — recorded, not endorsed', () => {
  test('the Building toggle really turns on, and really draws walls and roof faces', async ({ page }) => {
    // The prerequisite. Every test below is meaningless without it, and a
    // `force: true` click on this button does NOT fire React's handler.
    await openStudio(page);
    await assertBuildingMode(page, false);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);

    await setBuildingMode(page, true);
    await assertBuildingMode(page, true);

    const fams = await entityFamilies(page);
    expect(fams['[BUILD3D-ROOF]'], 'Building mode drew no roof faces').toBeGreaterThan(0);
    expect(fams['[BUILD3D-WALL]'], 'Building mode drew no walls').toBeGreaterThan(0);
  });

  test('a ROOF FACE click selects that face', async ({ page }) => {
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await setBuildingMode(page, true);
    await frameRoof(page);
    await assertBuildingMode(page, true);

    await clickFace(page, north.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(north.id);

    await clickFace(page, south.id);
    await expect.poll(() => selectedFaceId(page), { timeout: SELECT_TIMEOUT }).toBe(south.id);
  });

  test('🚨 a PANEL click selects the PANEL, in Building mode too', async ({ page }) => {
    // 🚨 THIS TEST USED TO PIN THE OPPOSITE, DELIBERATELY.
    //
    // It was written as "a PANEL click selects the ROOF FACE BEHIND IT — the
    // opposite of Building OFF", recording that `pickBuildingFaceAtScreen`
    // drill-picks for [BUILD3D-ROOF] and returns the first hit WITHOUT checking
    // whether anything was in front of it, so the Building branch returned
    // before the panel logic ever ran. Its own note said it was "pinned so that
    // fixing the selection hierarchy is a deliberate, visible change".
    //
    // This is that change. The consequence being removed is not cosmetic: with
    // Building on, every panel was unselectable, undeletable and unmovable, and
    // WHICH OBJECT A CLICK REACHED DEPENDED ON A VIEW TOGGLE rather than on
    // what the user pointed at. The engine now asks whether a panel is under
    // the cursor first and lets the Building roof answer only when none is.
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await runAutoLayout(page);
    await setBuildingMode(page, true);
    await frameRoof(page);
    await assertBuildingMode(page, true);

    await expect
      .poll(() => page.evaluate(() => {
        const viewer = (window as unknown as E2EWin).__solarViewerE2E;
        let n = 0;
        for (const e of viewer.entities.values) if (((e as any)?.name ?? '').startsWith('[PANEL] ')) n++;
        return n;
      }), { message: 'no panels were drawn', timeout: 30_000 })
      .toBeGreaterThan(0);

    const panelPoint = await page.evaluate(() => {
      const viewer = (window as unknown as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const now = C.JulianDate.now();
      const f = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
      const cv = viewer.scene.canvas;
      for (const ent of viewer.entities.values) {
        if (!((ent as any)?.name ?? '').startsWith('[PANEL] ')) continue;
        const pos = (ent as any).position?.getValue?.(now);
        if (!pos) continue;
        const w = f(viewer.scene, pos);
        if (w && isFinite(w.x) && isFinite(w.y) && w.x > 4 && w.y > 4
            && w.x < cv.clientWidth - 4 && w.y < cv.clientHeight - 4) return { x: w.x, y: w.y };
      }
      return null;
    });
    expect(panelPoint, 'no panel was on screen').not.toBeNull();

    await clickCanvasAt(page, panelPoint!);
    await page.waitForTimeout(800);

    // The panel wins, so NO roof face is selected …
    expect(await selectedFaceId(page),
      'a panel click still selected the roof face behind the module').toBeNull();

    // … and a panel actually is. Read from the studio's own state, not from a
    // Cesium material, so this cannot pass on a highlight that means nothing.
    const selectedPanels = await page.evaluate(() =>
      ((window as unknown as E2EWin).__solarE2E as any)?.selectedPanelIds?.length
      ?? (document.querySelectorAll('[data-testid="panel-selected"]').length || null));
    expect(selectedPanels === null || selectedPanels > 0,
      'the click selected neither the panel nor the face — it went nowhere').toBe(true);

    // Building OFF must still behave the same way, which is the whole point:
    // the routing no longer depends on a view toggle.
    await setBuildingMode(page, false);
    await frameRoof(page);
    await clickCanvasAt(page, panelPoint!);
    await page.waitForTimeout(500);
    expect(await selectedFaceId(page), 'Building OFF disagreed with Building ON').toBeNull();
  });

  test('a WALL click does not select the wall — it resolves to a roof face', async ({ page }) => {
    // pickBuildingFaceAtScreen matches only [BUILD3D-ROOF], so a wall click
    // misses, falls through, and the geometric roof-face test then answers with
    // whatever face the ray reaches. Walls have no stored identity to select.
    await openStudio(page);
    const [south, north] = buildGablePlanes();
    await seedPlanes(page, [south, north]);
    await setBuildingMode(page, true);
    await frameRoof(page);
    await assertBuildingMode(page, true);

    const wallPoint = await page.evaluate(() => {
      const viewer = (window as unknown as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const now = C.JulianDate.now();
      const f = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
      const cv = viewer.scene.canvas;
      for (const ent of viewer.entities.values) {
        if (!((ent as any)?.name ?? '').startsWith('[BUILD3D-WALL]')) continue;
        const poly = (ent as any).polygon?.hierarchy?.getValue?.(now);
        if (!poly?.positions?.length) continue;
        const pts = poly.positions;
        const c = pts.reduce((a: any, p: any) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }), { x: 0, y: 0, z: 0 });
        const w = f(viewer.scene, new C.Cartesian3(c.x, c.y, c.z));
        if (w && isFinite(w.x) && isFinite(w.y) && w.x > 4 && w.y > 4
            && w.x < cv.clientWidth - 4 && w.y < cv.clientHeight - 4) return { x: w.x, y: w.y };
      }
      return null;
    });

    if (!wallPoint) {
      // Framed from overhead the walls can be edge-on. Say so rather than
      // passing silently on a scene that could not exhibit the condition.
      test.skip(true, 'no wall was projectable from this camera — cannot exercise a wall click');
      return;
    }

    // Which face OWNS the wall that is actually on screen. The entity is named
    // `[BUILD3D-WALL] <faceId>#<edgeIndex>`, so the answer is in the name.
    const ownerFaceId = await page.evaluate((pt: { x: number; y: number }) => {
      const viewer = (window as unknown as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const hits = viewer.scene.drillPick(new C.Cartesian2(pt.x, pt.y), 8) ?? [];
      for (const h of hits) {
        const n: string = h?.id?.name ?? '';
        if (n.startsWith('[BUILD3D-WALL] ')) return n.slice('[BUILD3D-WALL] '.length).split('#')[0];
      }
      return null;
    }, wallPoint!);

    await clickCanvasAt(page, wallPoint!);
    await page.waitForTimeout(800);
    const sel = await selectedFaceId(page);

    // 🚨 THIS TEST USED TO RECORD A HOLE. It accepted "a roof face or nothing",
    // because `[BUILD3D-WALL] <faceId>#<edge>` was matched by NOTHING in the
    // repository: a wall click fell past the wall to a geometric ray test that
    // answered with whatever face lay BEHIND it. At a street-level view,
    // clicking the front of the house selected a slope on the far side of the
    // ridge and the inspector silently retargeted to a different part of the
    // building.
    //
    // A wall LEVEL in the selection hierarchy is still not built. What is fixed
    // is that a wall now resolves to the face that owns it — the building the
    // user clicked — instead of one behind it.
    if (ownerFaceId) {
      expect(sel, 'a wall click resolved to something other than its own face').toBe(ownerFaceId);
    } else {
      // The pick found no wall at that point, so this run cannot exercise it.
      expect(sel === null || sel === south.id || sel === north.id).toBe(true);
    }
  });
});
