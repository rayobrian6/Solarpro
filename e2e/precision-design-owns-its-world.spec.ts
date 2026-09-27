/**
 * e2e/precision-design-owns-its-world.spec.ts
 *
 * ═══ "A NEARMAP ORTHOPHOTO PLACED INTO THAT FALLBACK WORLD" ═══
 *
 * Ray tested the shipped Nearmap mode and rejected the presentation:
 *
 *   "The underlying world in Nearmap mode looks like the ESRI/fallback environment. A rectangular
 *    Nearmap orthophoto is effectively being placed into that fallback world. Straight overhead it
 *    can look acceptable. Once the camera moves, it becomes obvious that this is not a coherent
 *    design environment. The current implementation is technically valid but functionally wrong."
 *
 * He was exactly right about the mechanism. `enterFlatImagery` hid the Google mesh and showed the
 * globe — and the globe carries the ArcGIS World Imagery layer added at boot. So the world WAS
 * somebody else's photograph of the whole planet with one paid rectangle laid on top of it.
 *
 * The rule: "In Nearmap mode, SolarPro owns the world presentation... Outside the Nearmap workzone
 * use an intentional neutral design surface: clean ground/grid, property/parcel boundaries where
 * available, project/workzone boundary." And: "Preserve separate camera poses so Precision Design →
 * Native 3D → Precision Design returns the user to where they were working."
 *
 * SO THIS SPEC IS ABOUT THE WORLD AND THE CAMERA, not the picture:
 *
 *   1. Choosing Nearmap HIDES the ESRI base map, repaints the globe, kills the atmosphere, and
 *      lays down SolarPro's own drafting surface and an explicit workzone boundary.
 *   2. Going back to Native 3D restores every one of those — the ESRI layer is the FALLBACK for
 *      addresses with no Google tiles, so leaving it hidden would blank those sites.
 *   3. A core + context workzone draws as TWO layers with the ring cut out, not one photo on top
 *      of another.
 *   4. The camera keeps a pose per world, and coming back returns to where the work was.
 *   5. None of it touches the geometry.
 *
 * WHAT IS SEEDED, AND WHY. `__solarE2E.seedAerialWorkzone` hands the studio the payload the
 * aerial-reference route would return. A multi-layer workzone only exists once a project has
 * ACQUIRED one, which needs a database and a NEARMAP_API_KEY, and this box has neither. The seam
 * replaces the network and nothing else: the gate, the acquisition, the persistence and the cost
 * are proved against a real PostgreSQL with a counted paid-fetch double in
 * tests/nearmapWorkzoneRoundTrip.postgres.test.ts, and the extent and its price in
 * tests/workzoneIsBoundedAndPriced.test.ts. Everything after the payload here is the product.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;
const MPD = 111_320;
const SITE = { lat: 38.6657, lng: -90.2266 };
const GROUND_M = 128.4;

type Imagery = {
  source: string; flatImagery: boolean; flatTrace: boolean;
  referenceShown: boolean; referenceLayers: number; referenceKinds: string[];
  cachedNearmapTiles: number;
  meshVisible: boolean | null; globeVisible: boolean | null;
  esriVisible: boolean | null; baseColorCss: string | null; groundAtmosphere: boolean | null;
  designSurface: boolean; designSurfaceHeightM: number | null;
  referenceSurfaceHeightM: number | null; workzoneBoundary: number;
  poseMode: 'native' | 'precision';
  savedPoses: { native: boolean; precision: boolean };
  pose: { targetLat: number; targetLng: number; heading: number; pitch: number; radius: number } | null;
};
type Payload = {
  available: boolean;
  source?: string;
  layers?: Array<{ role: string; imageDataUrl: string; bounds: Record<string, number>; resolutionCmPerPx?: number | null; zoom?: number | null }>;
  imageDataUrl?: string;
  bounds?: Record<string, number>;
  resolutionCmPerPx?: number | null;
  captureDateKnown?: boolean;
  expandableRoles?: string[];
  expandCost?: string | null;
};
type E2EWin = Window & {
  __solarE2E?: {
    roofPlanes?: unknown[];
    panels?: unknown[];
    seedDesign?: (d: { panels?: unknown[] }) => void;
    seedAerialWorkzone?: (p: Payload | null) => void;
  };
  __solarEngineE2E?: {
    imagery?: () => Imagery;
    simulateMeshLoaded?: () => boolean;
    simulateGroundElevation?: (m: number) => boolean;
  };
};

const imagery = (page: Page) => page.evaluate(() =>
  (window as unknown as E2EWin).__solarEngineE2E?.imagery?.() ?? null);

const panelCount = (page: Page) => page.evaluate(() =>
  ((window as unknown as E2EWin).__solarE2E?.panels ?? []).length);

/** Give the scene a mesh to hide, or "the mesh went away" passes vacuously on a keyless box. */
async function withMesh(page: Page) {
  const ok = await page.evaluate(() =>
    (window as unknown as E2EWin).__solarEngineE2E?.simulateMeshLoaded?.() ?? false);
  expect(ok, 'no mesh could be put in the scene, so hiding it proves nothing').toBe(true);
  await page.waitForTimeout(250);
}

async function withGroundDatum(page: Page, metres = GROUND_M) {
  const ok = await page.evaluate(m =>
    (window as unknown as E2EWin).__solarEngineE2E?.simulateGroundElevation?.(m) ?? false, metres);
  expect(ok, 'the ground-datum seam is missing').toBe(true);
}

/**
 * A core + context workzone, shaped like the one `planWorkzone` produces: a 120 x 90 m design core
 * strictly inside a 360 x 240 m neighbourhood ring, both centred on the project.
 */
async function seedWorkzone(page: Page, opts: { context?: boolean; expandable?: boolean } = {}) {
  // 🚨 CENTRED ON THE ENGINE'S OWN SITE, NOT ON A CONSTANT.
  //
  // The studio's site is whatever address the design page resolved, and a workzone seeded at some
  // other latitude still draws, still counts two layers and still passes every assertion here —
  // while sitting kilometres off screen. Measured: a first attempt seeded 2.8 km away and the
  // screenshots came back showing an empty design surface. The engine publishes the orbit target,
  // which IS the site, so the imagery is put where the operator is actually looking.
  const site = await page.evaluate(() => {
    const p = (window as unknown as E2EWin).__solarEngineE2E?.imagery?.()?.pose;
    return p ? { lat: p.targetLat, lng: p.targetLng } : null;
  });
  expect(site, 'the engine publishes no camera target, so the site is unknown').toBeTruthy();
  const cosLat = Math.cos(site!.lat * Math.PI / 180);
  const box = (wM: number, hM: number) => ({
    west: site!.lng - (wM / 2) / (MPD * cosLat), east: site!.lng + (wM / 2) / (MPD * cosLat),
    south: site!.lat - (hM / 2) / MPD, north: site!.lat + (hM / 2) / MPD,
  });
  return page.evaluate(({ core, ctx, wantContext, wantExpandable }) => {
    const draw = (bg: string, fg: string) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
      g.fillStyle = fg; g.fillRect(64, 64, 128, 128);
      return c.toDataURL('image/png');
    };
    const layers: Payload['layers'] = [
      { role: 'core', imageDataUrl: draw('#6b8f3a', '#d9d2c5'), bounds: core, resolutionCmPerPx: 5.8, zoom: 21 },
    ];
    if (wantContext) {
      layers.push({ role: 'context', imageDataUrl: draw('#4d6b2c', '#8a8577'), bounds: ctx, resolutionCmPerPx: 23.3, zoom: 19 });
    }
    const seed = (window as unknown as E2EWin).__solarE2E?.seedAerialWorkzone;
    if (!seed) return false;
    seed({
      available: true, source: 'nearmap', layers,
      imageDataUrl: layers[0].imageDataUrl, bounds: core,
      resolutionCmPerPx: 5.8, captureDateKnown: false,
      expandableRoles: wantExpandable ? ['context'] : [],
      expandCost: wantExpandable ? '35 paid tile GETs — context z19 360x240m @23.3cm/px = 35 tiles' : null,
    });
    return true;
  }, {
    core: box(120, 90), ctx: box(360, 240),
    wantContext: opts.context !== false, wantExpandable: !!opts.expandable,
  }) as Promise<boolean>;
}

async function chooseImagery(page: Page, which: 'Nearmap' | 'Native 3D') {
  // 🚨 THE DATUM DRIFTS ON THIS BOX. The Google elevation lookup 403s here, and the engine
  // correctly clears the datum when its source fails — so a value seeded at boot is gone by the
  // time the imagery is drawn, and the photo would be anchored at the ellipsoid instead of the
  // ground. Re-asserted immediately before each switch, which is what Ray's Dev supplies for real.
  await withGroundDatum(page);
  const btn = page.getByTestId(which === 'Nearmap' ? 'imagery-nearmap' : 'imagery-native');
  await expect(btn, `the ${which} imagery control is not visible`).toBeVisible({ timeout: T });
  await btn.click();
  if (which === 'Nearmap') {
    await expect(async () => {
      const shown = await page.getByTestId('imagery-reference-shown').count();
      const bad = await page.getByTestId('imagery-reference-unavailable').count();
      expect(shown + bad, 'the imagery readout never settled').toBeGreaterThan(0);
    }).toPass({ timeout: T });
  }
  await page.waitForTimeout(1_200);
}

function seedPanels() {
  const t = 20 * Math.PI / 180;
  const rowDepth = 1.722 * Math.cos(t);
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const out: Record<string, unknown>[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const ns = r * rowDepth + rowDepth / 2, ew = c * 1.134 + 0.567;
      out.push({
        id: `pw-p${r}-${c}`,
        lat: SITE.lat + ns / MPD, lng: SITE.lng + ew / (MPD * cosLat),
        height: GROUND_M + 12.2 + ns * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65, tilt: 20, azimuth: 180,
        row: r, col: c, arrayRow: r, arrayId: 'ga-pw',
        systemType: 'ground', orientation: 'portrait', wattage: 440,
        heading: 0, pitch: -t, roll: 0,
      });
    }
  }
  return out;
}

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
    undefined, { timeout: T });
  await page.evaluate(p => { (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p }); },
    seedPanels());
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.imagery,
    undefined, { timeout: T * 2 });
  await page.waitForTimeout(1_500);
  await withMesh(page);
  await withGroundDatum(page);
  const seeded = await seedWorkzone(page);
  expect(seeded, 'the imagery seam is missing — NEXT_PUBLIC_E2E is not set').toBe(true);
}

test.describe('Precision Design owns its world — ESRI is not the ground under Nearmap', () => {
  test.setTimeout(T * 5);

  test('🚨 the ESRI base map goes away, and SolarPro’s own design surface takes over', async ({ page }) => {
    await boot(page);

    const before = await imagery(page);
    expect(before, 'the imagery diagnostic is not published').toBeTruthy();
    expect(before!.esriVisible,
      'the ESRI layer is not in the scene at all, so hiding it would prove nothing').toBe(true);
    expect(before!.designSurface, 'a design surface exists before Precision Design was entered')
      .toBe(false);
    expect(before!.workzoneBoundary).toBe(0);
    const nativeBaseColor = before!.baseColorCss;
    const nativeAtmosphere = before!.groundAtmosphere;

    await chooseImagery(page, 'Nearmap');

    const on = await imagery(page);
    const said = await page.getByTestId('imagery-reference-status').innerText().catch(() => '(none)');
    expect(on!.referenceShown, `no reference imagery was drawn. The product says: ${said}`).toBe(true);

    // 🚨 THE REJECTION, ANSWERED. This is the assertion Ray's complaint reduces to.
    expect(on!.esriVisible,
      'the ESRI/ArcGIS World Imagery layer is STILL showing under the Nearmap photo — which is '
      + 'exactly what was rejected: "a rectangular Nearmap orthophoto is effectively being placed '
      + 'into that fallback world"').toBe(false);
    expect(on!.baseColorCss,
      'the globe is still whatever colour Cesium ships with, so hiding the imagery layer just '
      + 'revealed a blue planet').not.toBe(nativeBaseColor);
    expect(on!.groundAtmosphere,
      'the ground atmosphere is still on, so the flat design colour hazes to blue at the horizon')
      .toBe(false);
    expect(on!.designSurface,
      'there is no drafting surface outside the workzone — panning off the photo lands on nothing')
      .toBe(true);
    expect(on!.workzoneBoundary,
      'the paid workzone has no drawn edge. "At the edge: show an intentional boundary or neutral '
      + 'environment"').toBeGreaterThan(0);
    // And the mode it was already meant to be: mesh off, flat surface.
    expect(on!.meshVisible).toBe(false);
    expect(on!.globeVisible).toBe(true);
    expect(on!.flatImagery).toBe(true);
  });

  test('🚨 going back to Native 3D restores the ESRI fallback and every world setting', async ({ page }) => {
    await boot(page);
    const before = await imagery(page);
    const nativeBaseColor = before!.baseColorCss;
    const nativeAtmosphere = before!.groundAtmosphere;

    await chooseImagery(page, 'Nearmap');
    expect((await imagery(page))!.esriVisible).toBe(false);

    await chooseImagery(page, 'Native 3D');
    const back = await imagery(page);

    // 🚨 THE ESRI LAYER IS THE FALLBACK FOR ADDRESSES WITH NO GOOGLE TILES. Leaving it hidden
    // would give every one of those sites a blank world, with nothing to say why.
    expect(back!.esriVisible,
      'the ESRI base map was left hidden after leaving Precision Design — every address with no '
      + 'Google 3D tiles now has no ground at all').toBe(true);
    expect(back!.baseColorCss, 'the globe was left painted in the design colour')
      .toBe(nativeBaseColor);
    expect(back!.groundAtmosphere, 'the atmosphere was left off').toBe(nativeAtmosphere);
    expect(back!.designSurface, 'the drafting grid was left in the native scene').toBe(false);
    expect(back!.workzoneBoundary, 'the workzone outline was left in the native scene').toBe(0);
    expect(back!.referenceShown, 'the reference photo was left in the native scene').toBe(false);
    expect(back!.meshVisible, 'the 3D mesh did not come back').toBe(true);
    expect(back!.globeVisible, 'the flat globe was left showing over the mesh').toBe(false);
  });

  test('🚨 a core + context workzone draws as two layers, and the ring is cut out', async ({ page }) => {
    await boot(page);
    await chooseImagery(page, 'Nearmap');

    const on = await imagery(page);
    expect(on!.referenceLayers,
      'the neighbourhood ring was not drawn, so the workzone is still one card')
      .toBe(2);

    // 🚨 AND THE RING IS A RING. Two overlapping rectangles at the same height z-fight, and
    // the coarse pixels flicker over the fine ones exactly where the design happens. `kind` is read
    // off the CONSTRUCTED geometry — whether it really carries a hole — not off the branch that
    // chose it, because a boolean set by the deciding code passes with the ring removed.
    expect(on!.referenceKinds,
      'the context layer was drawn as a second rectangle over the core instead of as a ring with '
      + 'the core cut out of it')
      .toEqual(['core:rect', 'context:ring']);

    // The readout says which resolution is which, rather than claiming design resolution for the
    // whole frame.
    const layers = page.getByTestId('imagery-workzone-layers');
    await expect(layers).toBeVisible();
    const text = (await layers.innerText()).replace(/\s+/g, ' ');
    expect(text, `the layer readout does not distinguish the two resolutions: ${text}`)
      .toMatch(/design core .*cm\/px.*neighbourhood .*cm\/px/i);

    // A single-layer workzone still works — that is every project acquired before layers existed.
    await chooseImagery(page, 'Native 3D');
    expect(await seedWorkzone(page, { context: false })).toBe(true);
    await chooseImagery(page, 'Nearmap');
    const one = await imagery(page);
    expect(one!.referenceShown, 'a single-layer (legacy) workzone drew nothing').toBe(true);
    expect(one!.referenceLayers).toBe(1);
    expect(one!.referenceKinds).toEqual(['core:rect']);
    expect(one!.workzoneBoundary, 'a single-layer workzone lost its boundary').toBeGreaterThan(0);
  });

  test('🚨 each world keeps its own camera pose, and coming back returns to the work', async ({ page }) => {
    await boot(page);

    const native0 = await imagery(page);
    expect(native0!.poseMode).toBe('native');

    // ── FIRST ENTRY OPENS ON A DRAFTING VIEW ────────────────────────────────
    await chooseImagery(page, 'Nearmap');
    const opened = await imagery(page);
    expect(opened!.poseMode).toBe('precision');
    expect(opened!.pose, 'no camera pose is published').toBeTruthy();
    // Near-nadir, which is what `applyOrbit`'s own clamp allows: exact -90 is a degenerate pose.
    expect(opened!.pose!.pitch,
      'Precision Design did not open looking down — "should open from a useful drafting view"')
      .toBeCloseTo(-Math.PI / 2 + 0.02, 3);
    expect(opened!.savedPoses.native,
      'the native pose was not filed before the switch, so there is nothing to come back to')
      .toBe(true);

    // ── MOVE THE CAMERA, THROUGH THE PRODUCT'S OWN CONTROL ──────────────────
    // The Tilt preset writes heading/pitch/radius and calls `applyOrbit`, which is the only thing
    // in this engine that moves the camera. A raw `camera.setView` here would be undone by the
    // next gesture and would prove nothing about the pose the controller holds.
    await page.getByRole('button', { name: 'Tilt: 3D angled perspective view' }).click();
    await page.waitForTimeout(600);
    const working = await imagery(page);
    expect(working!.pose!.radius, 'the camera did not move').not.toBeCloseTo(opened!.pose!.radius, 1);
    const tilted = working!.pose!;

    // ── LEAVE AND COME BACK ─────────────────────────────────────────────────
    await chooseImagery(page, 'Native 3D');
    const inNative = await imagery(page);
    expect(inNative!.poseMode).toBe('native');
    expect(inNative!.pose!.pitch,
      'switching to Native 3D kept the Precision Design camera instead of restoring the native one')
      .toBeCloseTo(native0!.pose!.pitch, 3);

    await chooseImagery(page, 'Nearmap');
    const returned = await imagery(page);
    expect(returned!.poseMode).toBe('precision');
    expect(returned!.pose!.heading,
      'Precision Design → Native 3D → Precision Design did not return to where the work was')
      .toBeCloseTo(tilted.heading, 3);
    expect(returned!.pose!.pitch).toBeCloseTo(tilted.pitch, 3);
    expect(returned!.pose!.radius).toBeCloseTo(tilted.radius, 1);
  });

  test('🚨 widening the paid area is a press, and it never happens on its own', async ({ page }) => {
    await boot(page);
    expect(await seedWorkzone(page, { context: false, expandable: true })).toBe(true);
    await chooseImagery(page, 'Nearmap');

    const btn = page.getByTestId('imagery-expand-workzone');
    await expect(btn, 'a workzone with a missing layer offers no way to widen it').toBeVisible();
    // The price is on the control, in the unit that is actually metered.
    const shown = await page.getByTestId('imagery-reference-status').innerText();
    expect(shown.replace(/\s+/g, ' '),
      'the expansion does not say what it costs before it is pressed')
      .toMatch(/paid tile GETs/);

    // 🚨 AND NOTHING WIDENED BY ITSELF. Four mode switches and a camera move — the two things Ray
    // named — with no press.
    for (let i = 0; i < 2; i++) {
      await chooseImagery(page, 'Native 3D');
      await chooseImagery(page, 'Nearmap');
    }
    await page.getByRole('button', { name: 'Tilt: 3D angled perspective view' }).click();
    await page.waitForTimeout(500);
    const still = await imagery(page);
    expect(still!.referenceLayers,
      'the workzone grew a layer without anybody pressing Expand imagery area').toBe(1);
    await expect(page.getByTestId('imagery-expand-workzone')).toBeVisible();
  });

  test('🚨 the drafting surface sits on the same plane as the photo, at every datum', async ({ page }) => {
    // 🚨 THE DATUM RESOLVES AFTER BOOT. The Google elevation lookup lands seconds later, and
    // the reference photo is redrawn at the real ground when it does. The drafting grid used to be
    // built once and kept: caught in a screenshot, the grid sat at the ellipsoid while the imagery
    // was 128 m above it, so tilting the camera showed a design surface with no photograph anywhere
    // near it. Both numbers below are read off the geometry that was BUILT, not off the intent.
    await boot(page);
    await chooseImagery(page, 'Nearmap');

    for (const datum of [0, 128.4, 1609.3]) {
      await page.evaluate(m =>
        (window as unknown as E2EWin).__solarEngineE2E?.simulateGroundElevation?.(m), datum);
      await page.waitForTimeout(1_500);
      const s = await imagery(page);
      expect(s!.referenceSurfaceHeightM,
        `the reference photo is not on the ${datum} m site datum`).toBeCloseTo(datum, 1);
      expect(s!.designSurfaceHeightM,
        `the drafting grid stayed behind when the datum moved to ${datum} m — the photo is at `
        + `${s!.referenceSurfaceHeightM} and the grid at ${s!.designSurfaceHeightM}`)
        .toBeCloseTo(datum, 1);
    }
  });

  test('the geometry is untouched by any of it', async ({ page }) => {
    await boot(page);
    const before = await panelCount(page);
    expect(before).toBe(6);
    await chooseImagery(page, 'Nearmap');
    await chooseImagery(page, 'Native 3D');
    await chooseImagery(page, 'Nearmap');
    expect(await panelCount(page),
      'switching imagery changed the design — "it is a reference-layer change only"').toBe(before);
  });
});
