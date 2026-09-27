/**
 * e2e/nearmap-is-the-flat-tracing-surface.spec.ts
 *
 * ═══ "I REALLY AM NOT WANTING NEARMAP TO BE BUILT INTO 3D" ═══
 *
 * The correction, after the first version of the toggle shipped and Ray used it:
 *
 *   "You actually built nearmap data into 3d. While that is cool. Not what I was expecting. Also
 *    it does not work well... The imagery looks like shit. When I switch to nearmap I want to
 *    treat it like my google fallback and be able to use the building button to draw my
 *    polygons."
 *
 * The first version draped the orthophoto over the Google Photorealistic mesh with
 * `ClassificationType.BOTH`, so crisp pixels were painted onto melted trees and lumpy roofs and
 * took their shape. What he wants is the mode this engine ALREADY HAS for addresses with no 3D
 * tiles: mesh gone, flat satellite imagery on the globe, and `plane3d` / `mark_plane` in FLAT
 * TRACE — corners collected as lat/lng, the face built from the footprint. "My bad but usable
 * google earth fallback."
 *
 * SO THIS SPEC IS ABOUT THE MODE, NOT THE PICTURE:
 *
 *   1. Choosing Nearmap HIDES the mesh and shows the globe. (The visual complaint.)
 *   2. The trace tool then enters FLAT TRACE rather than the mesh path. (The functional one — on
 *      the mesh path `pickPosition` returns nothing while the mesh is hidden, and a trace would
 *      silently collect no corners.)
 *   3. A polygon is actually traced, with real clicks and a real right-click, and a roof face
 *      exists afterwards.
 *   4. Switching back to Native 3D restores the mesh and the traced face survives.
 *
 * THE TILES ARE SEEDED, AND THAT IS THE ONLY SEAM. `__solarE2E.seedProviderTiles` makes the same
 * commit `DesignStudio.loadTiles` makes — `tileKey`, `_loaded`, `_source`, `evictTileCache` — from
 * a data URL, so no provider is contacted. It exists because this box has no NEARMAP_API_KEY: the
 * real fetch 403s, `tryEsri()` substitutes, and the composer correctly refuses ESRI pixels under a
 * Nearmap label — which would leave the whole flat-imagery path untestable in its shown branch.
 * Everything after the seed is the product: compose, georeference, drape, hide the mesh, trace.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;
const MPD = 111_320;
const SITE = { lat: 38.6657, lng: -90.2266 };
/** The site's ground elevation. The camera and every projection here work at it, because the
 *  trace resolves on the ground and not on the ellipsoid. */
const GROUND_M = 128.4;
const Z = 21;

type Imagery = {
  source: string; flatImagery: boolean; flatTrace: boolean;
  referenceShown: boolean; cachedNearmapTiles: number;
  meshVisible: boolean | null; globeVisible: boolean | null;
};
type E2EWin = Window & {
  __solarE2E?: {
    roofPlanes?: unknown[];
    panels?: unknown[];
    seedDesign?: (d: { panels?: unknown[] }) => void;
    seedProviderTiles?: (t: { provider: string; z: number; x0: number; y0: number; size: number; dataUrl: string }) => Promise<number>;
  };
  __solarViewerE2E?: unknown;
  __solarEngineE2E?: {
    imagery?: () => Imagery;
    simulateMeshLoaded?: () => boolean;
    simulateGroundElevation?: (m: number) => boolean;
    assemblies?: () => Array<{ modules: Array<{ id: string; lat: number; lng: number; height: number }> }>;
  };
};

/**
 * 🚨 GIVE THE SCENE A MESH TO HIDE.
 *
 * Every claim here is about what happens WHEN THERE IS a Photorealistic tileset. This box has no
 * Google key, so there never is one — and both of the assertions that matter passed with the code
 * under test DELETED, because `!tilesetRef.current` was already true. Measured, not assumed: the
 * trace test stayed green with the flat-imagery condition removed from the gate.
 *
 * `simulateMeshLoaded` installs a stand-in carrying the only two properties the code touches: it
 * is truthy, and it has `show`. It adds nothing to the scene and simulates no behaviour, and it
 * refuses to replace a real tileset — so in Ray's Dev, where the mesh loads for real, it does
 * nothing at all.
 */
async function withMesh(page: Page) {
  const installed = await page.evaluate(() =>
    (window as unknown as E2EWin).__solarEngineE2E?.simulateMeshLoaded?.() ?? false);
  expect(installed,
    'no mesh could be put in the scene, so "the mesh is hidden" and "the trace stops picking '
    + 'against it" would both pass vacuously').toBe(true);
  await page.waitForTimeout(300);
}

/**
 * The site's ground elevation, which the Google Elevation API supplies and cannot here.
 *
 * Tracing on the reference photo now REFUSES when the site datum is unresolved — a face authored
 * against an unknown datum is built at the ellipsoid, which is the whole of the site's elevation
 * away from every other object. See e2e/traced-geometry-lands-on-the-site-datum.spec.ts, where
 * that number is measured at three elevations.
 */
async function withGroundDatum(page: Page, metres = 128.4) {
  const ok = await page.evaluate(m =>
    (window as unknown as E2EWin).__solarEngineE2E?.simulateGroundElevation?.(m) ?? false, metres);
  expect(ok, 'the ground-datum seam is missing').toBe(true);
}

const imagery = (page: Page) => page.evaluate(() =>
  (window as unknown as E2EWin).__solarEngineE2E?.imagery?.() ?? null);

const roofPlaneCount = (page: Page) => page.evaluate(() =>
  ((window as unknown as E2EWin).__solarE2E?.roofPlanes ?? []).length);

/** One ground mount, so there is authored geometry the mode switch must not disturb. */
function seedPanels() {
  const t = 20 * Math.PI / 180;
  const rowDepth = 1.722 * Math.cos(t);
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const out: Record<string, unknown>[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const ns = r * rowDepth + rowDepth / 2, ew = c * 1.134 + 0.567;
      out.push({
        id: `flat-p${r}-${c}`,
        lat: SITE.lat + ns / MPD, lng: SITE.lng + ew / (MPD * cosLat),
        height: 140.6096 + ns * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65, tilt: 20, azimuth: 180,
        row: r, col: c, arrayRow: r, arrayId: 'ga-flat',
        systemType: 'ground', orientation: 'portrait', wattage: 440,
        heading: 0, pitch: -t, roll: 0,
      });
    }
  }
  return out;
}

/** Put a 5x5 block of "already fetched" Nearmap tiles around the site into the shared cache. */
async function seedNearmapTiles(page: Page): Promise<number> {
  return page.evaluate(async ({ lat, lng, z }) => {
    const n = 2 ** z;
    const x0 = Math.floor(((lng + 180) / 360) * n);
    const s = Math.sin(lat * Math.PI / 180);
    const y0 = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    // A recognisable tile: a data URL, so nothing is fetched and the canvas cannot be tainted.
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#6b8f3a'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d9d2c5'; ctx.fillRect(64, 64, 128, 128);
    const dataUrl = c.toDataURL('image/png');
    const seed = (window as unknown as E2EWin).__solarE2E?.seedProviderTiles;
    if (!seed) return -1;
    return seed({ provider: 'nearmap', z, x0: x0 - 2, y0: y0 - 2, size: 5, dataUrl });
  }, { lat: SITE.lat, lng: SITE.lng, z: Z });
}

async function chooseImagery(page: Page, which: 'Nearmap' | 'Native 3D') {
  const btn = page.getByTestId(which === 'Nearmap' ? 'imagery-nearmap' : 'imagery-native');
  await expect(btn, `the ${which} imagery control is not visible in the 3D studio`)
    .toBeVisible({ timeout: T });
  await btn.click();
  // 🚨 WAIT FOR THE ANSWER, NOT FOR A FIXED DELAY. Choosing Nearmap first asks the project's
  // aerial-reference route, and on a box with no DATABASE_URL that request takes seconds to fail
  // before the session-cache fallback is even reached. A 1.5 s sleep sampled the LOADING state
  // and reported "no imagery" — the product being slow, read as the product being broken.
  if (which === 'Nearmap') {
    await expect(async () => {
      const shown = await page.getByTestId('imagery-reference-shown').count();
      const unavailable = await page.getByTestId('imagery-reference-unavailable').count();
      expect(shown + unavailable, 'the imagery readout never settled').toBeGreaterThan(0);
    }).toPass({ timeout: T });
  }
  await page.waitForTimeout(1_200);
}

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
    undefined, { timeout: T });
  await page.evaluate(p => { (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p }); }, seedPanels());
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.imagery,
    undefined, { timeout: T * 2 });
  await page.waitForTimeout(1_500);
}

/**
 * Point the camera straight down at the ground plane the trace happens on.
 *
 * 🚨 AND IT LOOKS DOWN FROM ABOVE THE SITE'S GROUND, NOT FROM ABOVE THE ELLIPSOID.
 *
 * A trace now resolves on the ground datum. A camera placed at 120 m ellipsoidal is BELOW a
 * 128.4 m ground plane, and `pickEllipsoid` from inside the expanded ellipsoid returns the far
 * side of the planet — measured once as a traced face in the southern hemisphere. The camera move
 * is a test-side stand-in for the operator scrolling to their roof; nothing in the trace path is
 * bypassed by it.
 */
async function frameGround(page: Page) {
  await page.evaluate(({ lat, lng, h }) => {
    const v = (window as unknown as E2EWin).__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(lng, lat, h + 120),
      orientation: { heading: 0, pitch: -C.Math.toRadians(89.9), roll: 0 },
    });
    v.scene.requestRender();
  }, { lat: SITE.lat, lng: SITE.lng, h: GROUND_M });
  await page.waitForTimeout(800);
}

/** Canvas-relative pixel for a lat/lng, via Cesium's own projection. */
async function screenFor(page: Page, lat: number, lng: number, height: number) {
  return page.evaluate(({ lat, lng, height }) => {
    const v = (window as unknown as E2EWin).__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return null;
    const px = v.scene.cartesianToCanvasCoordinates(C.Cartesian3.fromDegrees(lng, lat, height));
    if (!px || !Number.isFinite(px.x)) return null;
    const rect = v.canvas.getBoundingClientRect();
    if (px.x < 30 || px.y < 30 || px.x > rect.width - 30 || px.y > rect.height - 30) return null;
    return { x: Math.round(rect.left + px.x), y: Math.round(rect.top + px.y) };
  }, { lat, lng, height });
}

test.describe('Nearmap is the FLAT tracing surface, not a skin on the 3D mesh', () => {
  test.setTimeout(T * 5);

  test('🚨 choosing Nearmap hides the 3D mesh and shows the flat photo', async ({ page }) => {
    await boot(page);

    await withMesh(page);
    const before = await imagery(page);
    expect(before, 'the imagery diagnostic is not published').toBeTruthy();
    expect(before!.source).toBe('google');
    expect(before!.flatImagery, 'flat imagery mode is on before anything was chosen').toBe(false);
    expect(before!.meshVisible, 'there is no mesh in the scene, so hiding it proves nothing')
      .toBe(true);

    const seeded = await seedNearmapTiles(page);
    expect(seeded, 'the tile seam is missing — NEXT_PUBLIC_E2E is not set').toBeGreaterThan(0);
    expect(seeded, 'not every seeded tile decoded').toBe(25);

    await chooseImagery(page, 'Nearmap');

    const after = await imagery(page);
    expect(after!.cachedNearmapTiles,
      'the 3D engine cannot see the tiles the 2D canvas cached — the two views are holding '
      + 'SEPARATE copies of lib/map/tileCache, which is the one thing that module exists to prevent')
      .toBe(25);
    // The readout is quoted into the failure, because "no imagery" and "imagery for this reason"
    // are different bugs and the product already knows which.
    const said = await page.getByTestId('imagery-reference-status').innerText().catch(() => '(no readout)');
    expect(after!.referenceShown,
      'choosing Nearmap drew no reference imagery even though this session has Nearmap tiles. '
      + `The product says: ${said.replace(/\s+/g, ' ')}`)
      .toBe(true);
    // 🚨 THE CORRECTION: the mesh is not wearing the photo. It is off, and the flat globe is the
    // surface — the same scene an address with no 3D tiles gets.
    expect(after!.meshVisible,
      'the Google Photorealistic mesh is still showing — the photo is being draped over it, '
      + 'which is exactly what was rejected: "I really am not wanting nearmap to be built into 3d"')
      .toBe(false);
    expect(after!.globeVisible, 'the flat globe is not showing, so there is no flat surface').toBe(true);
    expect(after!.flatImagery).toBe(true);
    await expect(page.getByTestId('imagery-flat-mode'),
      'the readout does not say the mesh is hidden and the trace tools are available')
      .toBeVisible();

    // ── AND BACK ────────────────────────────────────────────────────────────
    await chooseImagery(page, 'Native 3D');
    const restored = await imagery(page);
    expect(restored!.flatImagery, 'flat imagery mode did not end').toBe(false);
    expect(restored!.referenceShown, 'the Nearmap photo was left in the scene').toBe(false);
    expect(restored!.meshVisible, 'switching back to Native 3D did not bring the mesh back').toBe(true);
    expect(restored!.globeVisible, 'the flat globe was left on top of the mesh').toBe(false);
  });

  test('🚨 a polygon can be traced on the Nearmap surface, with real clicks', async ({ page }) => {
    await boot(page);
    await withMesh(page);
    expect(await seedNearmapTiles(page)).toBe(25);
    await chooseImagery(page, 'Nearmap');
    const mode = await imagery(page);
    expect(mode!.cachedNearmapTiles, 'the engine cannot see the seeded tiles').toBe(25);
    expect(mode!.flatImagery,
      'flat imagery mode did not engage, so this proves nothing about tracing on it').toBe(true);

    const planesBefore = await roofPlaneCount(page);

    // The site datum, re-asserted here because the elevation lookup re-runs when the geocode
    // moves the site. Without it the trace correctly refuses.
    await withGroundDatum(page);
    // Arm Mark Plane — "ONE roof face, no panels... Click 3+ corners, right-click to finish".
    // Through the real tool spine: open the Place group, then click the tool, exactly as an
    // operator does. (The spine collapses its groups, so the tool button does not exist until
    // the group is opened — a spec that reached straight for it timed out.)
    await page.getByTestId('toolgroup-place').click();
    await page.waitForTimeout(400);
    await page.getByTestId('tool-mark_plane').click();
    await page.waitForTimeout(1_200);

    // 🚨 THE WIRE UNDER TEST. Entering the trace tool with the mesh hidden must take the FLAT
    // TRACE path. On the mesh path every corner click calls `pickPosition` against a hidden
    // tileset, gets nothing, and the trace collects no corners at all — the tool would look armed
    // and do nothing, which is the failure mode this whole slice exists to prevent.
    expect((await imagery(page))!.flatTrace,
      'Mark Plane did not enter flat trace with the mesh hidden — a corner click would pick '
      + 'against a tileset that is not being rendered, and the trace would collect nothing')
      .toBe(true);

    // Flat trace snaps the camera to nadir itself; this puts the ground plane it traces on into
    // frame. `camera.setView` can run before the scene will project, so it converges rather than
    // assuming one shot.
    await page.waitForTimeout(1_200);
    const cosLat = Math.cos(SITE.lat * Math.PI / 180);
    const corners = [
      { dN: -6, dE: -8 }, { dN: -6, dE: 8 }, { dN: 6, dE: 8 }, { dN: 6, dE: -8 },
    ].map(o => ({ lat: SITE.lat + o.dN / MPD, lng: SITE.lng + o.dE / (MPD * cosLat) }));

    let clicked = 0;
    for (let attempt = 0; attempt < 5 && clicked === 0; attempt++) {
      await frameGround(page);
      clicked = 0;
      for (const c of corners) {
        const px = await screenFor(page, c.lat, c.lng, GROUND_M);
        if (!px) continue;
        await page.mouse.click(px.x, px.y);
        await page.waitForTimeout(450);
        clicked++;
      }
    }
    expect(clicked,
      `only ${clicked} of 4 corners were on screen — the camera never framed the trace area, so `
      + 'this is a harness failure rather than a product one').toBe(4);

    // Right-click finalises the face.
    const mid = await screenFor(page, SITE.lat, SITE.lng, GROUND_M);
    expect(mid, 'the site centre is off screen').toBeTruthy();
    await page.mouse.click(mid!.x, mid!.y, { button: 'right' });
    await page.waitForTimeout(2_000);

    const planesAfter = await roofPlaneCount(page);
    expect(planesAfter,
      `tracing four corners on the Nearmap surface and right-clicking produced no roof face `
      + `(${planesBefore} → ${planesAfter}). This is the whole request: "be able to use the `
      + 'building button to draw my polygons".')
      .toBeGreaterThan(planesBefore);

    // ── AND IT SURVIVES THE SWITCH BACK ─────────────────────────────────────
    // Put the tool away first, as an operator would: while a trace tool is armed the flat-trace
    // badge sits over the top bar and intercepts the click on the imagery control. That is a
    // harness fact, not a product one — the badge is meant to be there during a trace.
    await page.getByTestId('tool-select').click();
    await page.waitForTimeout(600);
    await chooseImagery(page, 'Native 3D');
    await page.waitForTimeout(1_500);
    const back = await imagery(page);
    expect(back!.flatImagery, 'flat imagery mode did not end').toBe(false);
    expect(back!.referenceShown, 'the Nearmap photo stayed on the ground').toBe(false);
    expect(back!.meshVisible, 'the mesh did not come back').toBe(true);
    expect(await roofPlaneCount(page),
      'the face traced on the Nearmap surface disappeared when the imagery source changed back')
      .toBe(planesAfter);
  });

  test('the imagery choice is offered ONCE, not twice', async ({ page }) => {
    await boot(page);
    // Ray's screenshot of the toolbar read "… IMAGERY  Native 3D | 🛰 Nearmap | 🛰 Nearmap ▾" —
    // the segmented control plus the old provider dropdown, the same choice twice, one of them
    // behind a menu that also offered two providers this viewer cannot render at all.
    const nearmapControls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,[role="menuitemradio"]'))
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && /nearmap/i.test(e.textContent ?? '');
        })
        .map(e => (e.textContent ?? '').trim()));
    expect(nearmapControls.length,
      `the toolbar offers Nearmap ${nearmapControls.length} times: ${nearmapControls.join(' | ')}`)
      .toBe(1);
    await expect(page.getByRole('button', { name: /Source:/i }),
      'the redundant provider dropdown is still mounted').toHaveCount(0);
  });
});
