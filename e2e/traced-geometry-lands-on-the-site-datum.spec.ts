/**
 * e2e/traced-geometry-lands-on-the-site-datum.spec.ts
 *
 * ═══ "THE RESULTING 3D GEOMETRY APPEARED ROUGHLY 200 FT IN THE AIR" ═══
 *
 * Ray, tracing a building against the Nearmap reference photo — and then, crucially: "After I
 * switched back to standard 3d in 3d it had the building at ground level. I think the issue is a
 * sea level issue." He was right about the category, and forbade the shortcut: "DO NOT FIX THIS
 * WITH A MAGIC -200 FT OFFSET... A constant offset that happens to fix this address is a failure."
 *
 * WHAT THE BROWSER MEASURED, before any fix. Nine corner picks, every one of them:
 *
 *     { method: "terrain", height: -0.001 m, groundElevM: null }
 *
 * `getWorldPosition` tries the Photorealistic mesh, then the globe, then the ellipsoid. Flat
 * imagery mode showed the globe — and the globe renders on the WGS84 ellipsoid with
 * `EllipsoidTerrainProvider`, so "terrain" means height ZERO. The last branch,
 * `ellipsoid@ground`, exists precisely to answer at the site's own elevation and was never
 * reached, because showing the globe let the branch above it answer first.
 *
 * The traced face's origin came out at h = 12.80 m — the ellipsoid plus its eave height — while
 * the site ground is at 128.40 m. **The error IS the site's ground elevation**: 128.40 m, 421 ft.
 * Not a constant. At sea level it would be invisible; in Denver it would be a mile.
 *
 * So this spec runs the same trace at THREE materially different elevations and asserts the
 * offset from the datum is identical at all three. A constant-offset fix cannot pass that.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;
const MPD = 111_132;
const SITE = { lat: 38.6657, lng: -90.2266 };
const Z = 21;

/** Sea level, a Mississippi-valley site, and Denver. */
const ELEVATIONS = [
  { name: 'sea level', m: 0 },
  { name: "Ray's site", m: 128.4 },
  { name: 'Denver', m: 1609.3 },
];

type Engine = {
  datum?: () => { groundElevM: number | null; groundResolved: boolean; globeShown: boolean | null;
                  meshVisible: boolean; referenceSurfaceHeightM: number | null;
                  picks: Array<{ method: string; height: number; groundElevM: number }> };
  imagery?: () => { flatImagery: boolean; flatTrace: boolean; referenceShown: boolean };
  simulateMeshLoaded?: () => boolean;
  simulateGroundElevation?: (m: number) => boolean;
};
type E2EWin = Window & {
  __solarE2E?: {
    roofPlanes?: Array<Record<string, unknown>>;
    seedProviderTiles?: (t: { provider: string; z: number; x0: number; y0: number; size: number; dataUrl: string }) => Promise<number>;
  };
  __solarViewerE2E?: unknown;
  __solarEngineE2E?: Engine;
};

const datum = (page: Page) => page.evaluate(() =>
  (window as unknown as E2EWin).__solarEngineE2E!.datum!());

/** Geodetic height of every traced plane's origin, computed by Cesium itself. */
const planeHeights = (page: Page) => page.evaluate(() => {
  const C = (window as any).Cesium;
  return ((window as unknown as E2EWin).__solarE2E?.roofPlanes ?? []).map((p: any) => {
    const o = p.origin3D;
    if (!o || !C) return null;
    const carto = C.Cartographic.fromCartesian(new C.Cartesian3(o.x, o.y, o.z));
    return carto ? {
      id: p.id as string,
      height: carto.height as number,
      lat: C.Math.toDegrees(carto.latitude) as number,
      lng: C.Math.toDegrees(carto.longitude) as number,
    } : null;
  }).filter(Boolean) as Array<{ id: string; height: number; lat: number; lng: number }>;
});

async function seedTiles(page: Page) {
  return page.evaluate(async ({ lat, lng, z }) => {
    const n = 2 ** z;
    const x0 = Math.floor(((lng + 180) / 360) * n);
    const s = Math.sin(lat * Math.PI / 180);
    const y0 = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#6b8f3a'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d9d2c5'; ctx.fillRect(64, 64, 128, 128);
    const dataUrl = c.toDataURL('image/png');
    return (window as unknown as E2EWin).__solarE2E?.seedProviderTiles?.(
      { provider: 'nearmap', z, x0: x0 - 2, y0: y0 - 2, size: 5, dataUrl }) ?? -1;
  }, { lat: SITE.lat, lng: SITE.lng, z: Z });
}

const setDatum = (page: Page, m: number) => page.evaluate(
  metres => (window as unknown as E2EWin).__solarEngineE2E?.simulateGroundElevation?.(metres) ?? false,
  m);

/** Look straight down from above the site's own ground, and project at that ground. */
async function frameGround(page: Page, groundM: number) {
  await page.evaluate(({ lat, lng, h }) => {
    const v = (window as unknown as E2EWin).__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(lng, lat, h + 120),
      orientation: { heading: 0, pitch: -C.Math.toRadians(89.9), roll: 0 },
    });
    v.scene.requestRender();
  }, { lat: SITE.lat, lng: SITE.lng, h: groundM });
  await page.waitForTimeout(800);
}

const screenAt = (page: Page, lat: number, lng: number, h: number) => page.evaluate(
  ({ lat, lng, h }) => {
    const v = (window as unknown as E2EWin).__solarViewerE2E as any;
    const C = (window as any).Cesium;
    const p = v?.scene?.cartesianToCanvasCoordinates(C.Cartesian3.fromDegrees(lng, lat, h));
    if (!p || !Number.isFinite(p.x)) return null;
    const r = v.canvas.getBoundingClientRect();
    if (p.x < 30 || p.y < 30 || p.x > r.width - 30 || p.y > r.height - 30) return null;
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }, { lat, lng, h });

/** Boot, put a mesh and Nearmap imagery in the scene, and trace one rectangle. */
async function traceAt(page: Page, groundM: number) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.datum,
    undefined, { timeout: T * 2 });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => (window as unknown as E2EWin).__solarEngineE2E?.simulateMeshLoaded?.());
  expect(await seedTiles(page), 'the tile seam did not populate the cache').toBe(25);
  expect(await setDatum(page, groundM), 'the ground-datum seam is missing').toBe(true);

  await page.getByTestId('imagery-nearmap').click();
  await expect(async () => {
    expect(await page.getByTestId('imagery-reference-shown').count()
      + await page.getByTestId('imagery-reference-unavailable').count(),
      'the imagery readout never settled').toBeGreaterThan(0);
  }).toPass({ timeout: T });
  await page.waitForTimeout(1_000);

  // The elevation lookup re-runs when the geocode moves the site and can reset the datum, so it
  // is re-asserted immediately before the trace. (That race is real and is why the reference
  // photo re-anchors on `groundDatumM` rather than being drawn once.)
  await setDatum(page, groundM);
  await page.waitForTimeout(600);

  await page.getByTestId('toolgroup-place').click();
  await page.waitForTimeout(400);
  await page.getByTestId('tool-mark_plane').click();
  await page.waitForTimeout(1_200);

  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const corners = [
    { dN: -6, dE: -8 }, { dN: -6, dE: 8 }, { dN: 6, dE: 8 }, { dN: 6, dE: -8 },
  ].map(o => ({ lat: SITE.lat + o.dN / MPD, lng: SITE.lng + o.dE / (MPD * cosLat) }));

  let clicked = 0;
  for (let attempt = 0; attempt < 5 && clicked < 4; attempt++) {
    await frameGround(page, groundM);
    clicked = 0;
    for (const c of corners) {
      const px = await screenAt(page, c.lat, c.lng, groundM);
      if (!px) continue;
      await page.mouse.click(px.x, px.y);
      await page.waitForTimeout(400);
      clicked++;
    }
  }
  expect(clicked, 'the corners never framed — harness failure, not a product one').toBe(4);

  const mid = await screenAt(page, SITE.lat, SITE.lng, groundM);
  expect(mid, 'the site centre is off screen').toBeTruthy();
  await page.mouse.click(mid!.x, mid!.y, { button: 'right' });
  await page.waitForTimeout(1_800);

  // 🚨 REPORT THE DATUM THE TRACE ACTUALLY HAPPENED AGAINST.
  //
  // The elevation lookup re-runs when the geocode moves the site, and it can land mid-trace and
  // reset the datum. Measured: one run of the cross-elevation comparison produced +12.80 m,
  // −105.21 m, +12.80 m — the middle site's corners had resolved against a different datum than
  // the one that was asked for. Comparing the face against the datum it was BUILT against, and
  // failing when that is not the datum requested, turns a flaky number into a stated fact.
  return (await datum(page)).groundElevM;
}

test.describe('a polygon traced on the reference photo lands on the site datum', () => {
  test.setTimeout(T * 6);

  for (const site of ELEVATIONS) {
    test(`🚨 at ${site.name} (${site.m} m) it is built on the ground, not on the ellipsoid`, async ({ page }) => {
      await traceAt(page, site.m);

      const d = await datum(page);
      expect(d.groundResolved, 'the site datum is not resolved, so this proves nothing').toBe(true);
      expect(d.groundElevM).toBeCloseTo(site.m, 3);

      // 🚨 THE PICKS RESOLVED AGAINST THE SITE'S OWN ELEVATION.
      // Before the fix every one of these read `method: "terrain", height: -0.001`.
      const corner = d.picks.filter(p => p.method !== 'null');
      expect(corner.length, 'no picks were recorded, so the trace never happened').toBeGreaterThan(3);
      for (const p of corner) {
        // The physical claim: the corner resolved ON THE GROUND, whatever the ground is.
        expect(Math.abs(p.height - site.m),
          `a corner resolved at ${p.height.toFixed(2)} m against a ground datum of ${site.m} m — `
          + `answered by "${p.method}"`)
          .toBeLessThan(0.05);
        // And never from the globe, which is the ellipsoid and always means zero.
        expect(p.method,
          `a corner pick answered from "terrain" at h=${p.height.toFixed(2)} m — that is the globe `
          + 'on the WGS84 ellipsoid, and it is the defect')
          .not.toBe('terrain');
        // Above sea level the two ellipsoid branches are different planes, and only the expanded
        // one is right. At a 0 m datum they coincide, so the label is not evidence there.
        if (site.m > 0.01) {
          expect(p.method,
            'the pick did not use the ellipsoid expanded to the site elevation').toBe('ellipsoid@ground');
        }
      }

      // 🚨 AND THE PHOTO IS ON THE SAME PLANE THE PICKS LAND ON.
      // Drawn at the ellipsoid it would sit the whole of the site's elevation below the geometry,
      // which is what "roughly 200 ft in the air" looked like.
      // Read from the created geometry's own bounding sphere, so this cannot pass on intent — its
      // centre carries a small sagitta over the rectangle, hence metres rather than millimetres.
      expect(Math.abs((d.referenceSurfaceHeightM ?? -1e9) - site.m),
        `the reference photo is drawn at ${d.referenceSurfaceHeightM} m while clicks resolve at `
        + `${site.m} m — what the operator sees and what they click are different planes`)
        .toBeLessThan(1);

      const planes = await planeHeights(page);
      expect(planes.length, 'tracing four corners produced no roof face').toBe(1);
      const built = planes[0];

      // The face sits ABOVE the ground by its eave height and nothing else. The eave figure is
      // not hard-coded here — it is whatever the product uses — but it must be a building-sized
      // number, and the SAME one at every elevation, which the cross-check below asserts.
      const aboveGround = built.height - site.m;
      expect(aboveGround,
        `the traced face sits ${aboveGround.toFixed(2)} m above a ground datum of ${site.m} m. `
        + 'Before the fix this was `0 − groundElev` — the face on the ellipsoid and the site '
        + 'above it, measured at 128.40 m (421 ft) at this address.')
        .toBeGreaterThan(-0.5);
      expect(aboveGround, `the traced face floats ${aboveGround.toFixed(2)} m above the ground`)
        .toBeLessThan(25);

      // XY was never the problem, and must not become one.
      expect(built.lat).toBeCloseTo(SITE.lat, 3);
      expect(built.lng).toBeCloseTo(SITE.lng, 3);

      // Record for the cross-elevation comparison below.
      test.info().annotations.push({ type: 'aboveGround', description: `${site.m}:${aboveGround}` });
    });
  }

  test('🚨 the offset from the ground is the SAME at every elevation — no constant fix', async ({ page }) => {
    // The assertion Ray asked for by name: "Repeat coordinate proof against fixtures/sites with
    // materially different elevations. No address-specific offset." A `z -= 200ft` fix gives three
    // different offsets here; a datum-derived one gives the same offset three times.
    const offsets: Array<{ m: number; above: number }> = [];
    for (const site of ELEVATIONS) {
      // One retry, and only for a datum that drifted mid-trace — never for a wrong height.
      let usedDatum: number | null = null;
      let planes: Awaited<ReturnType<typeof planeHeights>> = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        usedDatum = await traceAt(page, site.m);
        planes = await planeHeights(page);
        if (usedDatum !== null && Math.abs(usedDatum - site.m) < 0.01 && planes.length === 1) break;
      }
      expect(planes.length, `no face was built at ${site.name}`).toBe(1);
      expect(usedDatum,
        `the site datum drifted to ${usedDatum} m during the trace at ${site.name} (${site.m} m), `
        + 'so the offset below would be measured against the wrong ground')
        .toBeCloseTo(site.m, 2);
      offsets.push({ m: site.m, above: planes[0].height - site.m });
    }
    const spread = Math.max(...offsets.map(o => o.above)) - Math.min(...offsets.map(o => o.above));
    expect(spread,
      'the height above ground differs between sites: '
      + offsets.map(o => `${o.m} m → +${o.above.toFixed(2)} m`).join(', ')
      + '. A correction that depends on the address is exactly the failure that was forbidden.')
      .toBeLessThan(0.1);
  });

  test('🚨 switching back to Native 3D leaves the traced face exactly where it was', async ({ page }) => {
    await traceAt(page, 128.4);
    const before = await planeHeights(page);
    expect(before.length).toBe(1);

    // Put the tool away, then switch imagery.
    await page.getByTestId('tool-select').click();
    await page.waitForTimeout(600);
    await page.getByTestId('imagery-native').click();
    await page.waitForTimeout(1_500);

    const d = await datum(page);
    expect(d.meshVisible, 'the mesh did not come back').toBe(true);
    expect(d.referenceSurfaceHeightM, 'the reference photo was left in the scene').toBeNull();

    const after = await planeHeights(page);
    expect(after.length, 'the traced face disappeared when the imagery changed').toBe(1);
    expect(Math.abs(after[0].height - before[0].height),
      `the face moved ${(after[0].height - before[0].height).toFixed(3)} m vertically when the `
      + 'imagery source changed. Imagery is a reference layer and can never own geometry height.')
      .toBeLessThan(0.001);
    expect(Math.abs(after[0].lat - before[0].lat)).toBeLessThan(1e-9);
    expect(Math.abs(after[0].lng - before[0].lng)).toBeLessThan(1e-9);
  });
});
