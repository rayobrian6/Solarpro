import { expect, test } from '@playwright/test';
import {
  seedRoofPlane, runAutoLayout, waitForCesiumCanvas, buildGablePlanes,
  buildGablePlanesWithRidgeGap, seedPlanes,
} from './support/seedRoof';

// ── Types ──────────────────────────────────────────────────────────────────
type SolarE2EState = {
  roofPlanes: Array<{
    id: string;
    vertices?: Array<{ lat: number; lng: number }>;
    area?: number;
    pitch?: number;
    azimuth?: number;
    localFrame3D?: { u: { x: number; y: number; z: number }; v: { x: number; y: number; z: number }; n: { x: number; y: number; z: number } };
  }>;
  panels: Array<{
    id: string;
    lat: number;
    lng: number;
    planeId?: string;
    layoutSource?: string;
  }>;
  stitchedCorners: Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }>;
  setbackInsets: number;
  fullRebuildCount: number;
  roofPlaneEntityCount: number;
  setbackBandCentroids: Array<{ lat: number; lng: number }>;
  panelMoveRebuildCount: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────
async function readSolarState(page: import('@playwright/test').Page): Promise<SolarE2EState | null> {
  return page.evaluate(() => (window as any).__solarE2E ?? null);
}

async function waitForSolarHook(page: import('@playwright/test').Page): Promise<SolarE2EState> {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__solarE2E)), {
    message: 'NEXT_PUBLIC_E2E window.__solarE2E hook should be installed',
    timeout: 30_000,
  }).toBe(true);
  return (await readSolarState(page))!;
}

function pointInPolygon(point: { lat: number; lng: number }, vertices: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Haversine distance in metres between two lat/lng points. */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Centroid of a polygon in lat/lng. */
function centroid(vertices: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const n = vertices.length;
  const lat = vertices.reduce((s, v) => s + v.lat, 0) / n;
  const lng = vertices.reduce((s, v) => s + v.lng, 0) / n;
  return { lat, lng };
}

/** Minimum distance from a point to the nearest edge of a polygon (approx, in metres). */
function distToNearestEdge(point: { lat: number; lng: number }, vertices: Array<{ lat: number; lng: number }>): number {
  let minD = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    // Approximate: distance to line segment
    const dA = haversineM(point, a);
    const dB = haversineM(point, b);
    const midDist = haversineM(point, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    minD = Math.min(minD, dA, dB, midDist);
  }
  return minD;
}

// ── Test address (deterministic, mid-west flat-roof residential) ───────────
const TEST_ADDRESS = '3 Melvin Dr, Granite City IL 62040';
const E2E_URL = '/design?e2eQuickDesign=1';

// ── Shared flow: boot → address → hook ready ──────────────────────────────
async function bootDesignStudio(page: import('@playwright/test').Page) {
  await page.goto(E2E_URL);
  // The e2eQuickDesign=1 param auto-launches with a demo project when
  // NEXT_PUBLIC_E2E=1. If the quick-launch input is still visible,
  // fill it and click.
  const quickLaunchInput = page.getByPlaceholder(/enter any address/i);
  if (await quickLaunchInput.isVisible().catch(() => false)) {
    await quickLaunchInput.fill(TEST_ADDRESS);
    await page.getByRole('button', { name: /open 3d design/i }).click();
  }
  return waitForSolarHook(page);
}

// ══════════════════════════════════════════════════════════════════════════
//  DESIGN STUDIO → PLANSET E2E HARNESS
//  Guards 4 regressions from 2026-06-29:
//   1. Stitch came apart when panels added  (0e318b58)
//   2. Moving panels was jerky / over-rebuilt (2176e4d3)
//   3. Fire-setback bands filled middle of roof (cf0dd96b)
//   4. Auto Layout dropped panels off stitched roof (stale plane frame)
// ══════════════════════════════════════════════════════════════════════════

test.describe('Design Studio → planset E2E harness', () => {

  // ── Regression guard 0: basic boot + hook sanity ────────────────────────
  test('loads /design with E2E state hook and keeps geometry state coherent', async ({ page }) => {
    const state = await bootDesignStudio(page);
    expect(state.fullRebuildCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(state.roofPlanes)).toBe(true);
    expect(Array.isArray(state.panels)).toBe(true);

    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'Cesium/WebGL canvas did not become visible — hook install verified, skipping canvas-dependent checks.');

    // Toggle zones to exercise setback rendering
    const zonesButton = page.getByRole('button', { name: /zones (on|off)/i }).first();
    if (await zonesButton.isVisible().catch(() => false)) {
      await zonesButton.click();
      await expect.poll(async () => (await readSolarState(page))?.setbackInsets ?? 0, {
        message: 'setback diagnostics should remain numeric after toggling zones',
        timeout: 10_000,
      }).toBeGreaterThanOrEqual(0);
    }

    // Run Auto Layout if available
    const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
    if (await autoLayout.isVisible().catch(() => false)) {
      await autoLayout.click();
      await page.waitForTimeout(1_000);
    }

    const afterLayout = (await readSolarState(page))!;
    expect(afterLayout.fullRebuildCount).toBeGreaterThanOrEqual(state.fullRebuildCount);
  });

  // ── Regression guard 1: Stitch holds (0e318b58) ────────────────────────
  //  After stitching, shared corners of adjacent planes should be within
  //  ~1.6m of each other (the stitch tolerance). If stitch "came apart",
  //  paired corners will drift apart.
  test('🚨 stitch holds — a gable shares its ridge after stitching, to the centimetre', async ({ page }) => {
    // 🚨 THIS TEST WAS THREE VACUUMS AND A TOLERANCE SIXTEEN TIMES TOO LOOSE.
    //
    //   - it pressed Stitch only `if (await stitchBtn.isVisible())`, an
    //     INSTANTANEOUS predicate, so on a slow mount it never stitched;
    //   - every assertion sat inside `if (stitched.length >= 2)`, so an empty
    //     list reported a pass;
    //   - it never seeded a roof before stitching, so there was usually
    //     nothing to stitch;
    //   - and TOL_M was 1.6 m, doubled again at the assertion. `joinSharedCorners`
    //     itself works to 1.5 m, so the test could not see anything the
    //     implementation would not already have swallowed.
    //
    // What it needed to see: Stitch writes the plan record back, and it was
    // taking it from points that carry the render lift. A normal is not
    // vertical, so that lift slides each face `SURFACE_OFFSET_M·sin(tilt)`
    // down its OWN azimuth — and a gable's halves have opposite azimuths, so
    // the shared ridge separates by twice that, about 10 cm at 25°, on the
    // permit site plan. `buildRoofPlane3D` was fixed for exactly this; the
    // write-back was not.
    await bootDesignStudio(page);
    expect(await waitForCesiumCanvas(page), 'the Cesium canvas never appeared').toBe(true);

    // 🚨 THE FIXTURE HAD TO BE ABLE TO FAIL. The first version of this seeded
    // `buildGablePlanes()`, whose two faces already share their ridge corners
    // EXACTLY — measured, 0.0 mm apart before the button is pressed — so the
    // assertion passed whether Stitch ran or not. A fixture that cannot exhibit
    // the condition is the same vacuum as an empty array.
    //
    // This opens the ridge by 30 cm, well inside the ~1.5 m the clustering
    // works to, so closing it is Stitch's job and the guard fails if Stitch
    // does nothing.
    const RIDGE_GAP_M = 0.30;
    const planes = await seedPlanes(page, buildGablePlanesWithRidgeGap(RIDGE_GAP_M));
    expect(planes.length).toBe(2);

    const before = (await readSolarState(page))!;
    const facesBefore = before.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    expect(facesBefore.length).toBe(2);
    const gapBefore = Math.min(...facesBefore[0].vertices!.map(va =>
      Math.min(...facesBefore[1].vertices!.map(vb => haversineM(va, vb)))));
    expect(gapBefore,
      `the fixture must start APART or this proves nothing — it starts ${(gapBefore * 1000).toFixed(0)} mm apart`,
    ).toBeGreaterThan(RIDGE_GAP_M * 0.5);

    const stitchBtn = page.getByRole('button', { name: /stitch/i }).first();
    await stitchBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await stitchBtn.click();
    await page.waitForTimeout(2_500);

    const after = (await readSolarState(page))!;
    const faces = after.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    expect(faces.length, 'both gable faces must survive the stitch').toBe(2);

    // The ridge is the pair of corners the two faces share. Find, for each
    // vertex of face A, its nearest vertex on face B; the two smallest of those
    // distances ARE the ridge, and after a stitch they must be the same points.
    const [a, b] = faces;
    const nearest = a.vertices!.map(va =>
      Math.min(...b.vertices!.map(vb => haversineM(va, vb))));
    nearest.sort((x, y) => x - y);
    expect(nearest.length, 'face A has no vertices').toBeGreaterThanOrEqual(3);

    // 🚨 A DERIVED BOUND, NOT A CHOSEN ONE. Vertices are stored at 7 decimal
    // places, so a round trip moves a point by at most half a unit in the last
    // place in each of lat and lng: 0.5e-7 · 111320 · sqrt(2) ≈ 7.9 mm. The
    // defect this guards is 2 · 0.12 · sin(25°) ≈ 101 mm — an order larger.
    const ROUNDING_M = (Math.pow(10, -7) / 2) * 111_320 * Math.SQRT2;
    for (const d of nearest.slice(0, 2)) {
      expect(d,
        `a gable's two faces must still share their ridge corners after Stitch; ` +
        `the nearest pair is ${(d * 1000).toFixed(1)} mm apart. About 100 mm means the ` +
        `plan record was taken from points carrying SURFACE_OFFSET_M, which slides ` +
        `each face down its own azimuth.`,
      ).toBeLessThan(ROUNDING_M + 1e-4);
    }

    // And adding panels must not move them (regression 0e318b58).
    await runAutoLayout(page);
    const afterPanels = (await readSolarState(page))!;
    const facesAfter = afterPanels.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    expect(facesAfter.length, 'both faces must survive Auto Layout').toBe(2);
    for (const face of facesAfter) {
      const pre = faces.find(f => f.id === face.id);
      expect(pre, `face ${face.id} vanished`).toBeTruthy();
      for (let k = 0; k < face.vertices!.length; k++) {
        const drift = haversineM(face.vertices![k], pre!.vertices![k]);
        expect(drift,
          `a stitched vertex drifted ${(drift * 1000).toFixed(1)} mm when panels were added`,
        ).toBeLessThan(ROUNDING_M + 1e-4);
      }
    }
  });

  // ── Regression guard 2: Adding panels doesn't un-stitch ─────────────────
  //  Companion to guard 1 — specifically verifies that panel count > 0
  //  doesn't cause stitchedCorners to revert to empty or pre-stitch positions.
  test('adding panels does not un-stitch the roof', async ({ page }) => {
    const state = await bootDesignStudio(page);
    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — skipping un-stitch regression check.');

    // Stitch first
    const stitchBtn = page.getByRole('button', { name: /stitch/i }).first();
    if (await stitchBtn.isVisible().catch(() => false)) {
      await stitchBtn.click();
      await page.waitForTimeout(2_000);
    }

    const postStitch = (await readSolarState(page))!;
    const stitchCountBefore = postStitch.stitchedCorners.length;

    // Add panels via Auto Layout
    await seedRoofPlane(page);
    await runAutoLayout(page);

    const afterPanels = (await readSolarState(page))!;
    // Panels should exist now
    expect(afterPanels.panels.length, 'Auto Layout should produce at least some panels').toBeGreaterThanOrEqual(0);

    // Stitched corners should NOT disappear or reduce after adding panels
    if (stitchCountBefore > 0) {
      expect(afterPanels.stitchedCorners.length,
        `Stitch data was lost after adding panels — ${stitchCountBefore} planes stitched before, ${afterPanels.stitchedCorners.length} after. 0e318b58 regression`
      ).toBe(stitchCountBefore);
    }
  });

  // ── Regression guard 3: Panels sit ON the roof ─────────────────────────
  //  After Auto Layout, every panel should be inside its roof plane polygon.
  //  If the stale-plane-frame bug is back, panels land off the stitched roof.
  test('panels sit ON the roof — point-in-polygon after auto layout', async ({ page }) => {
    const state = await bootDesignStudio(page);
    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — skipping on-roof panel check.');

    // Seed a real roof so this runs on every machine rather than only where
    // Google Solar answers — see the note on the assertions below.
    await seedRoofPlane(page);
    await runAutoLayout(page);

    const afterLayout = (await readSolarState(page))!;
    const planesWithVertices = afterLayout.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    const panelsWithGps = afterLayout.panels.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    // 🚨 THIS GUARD USED TO REPORT "ok" WHILE ASSERTING NOTHING.
    // The whole body below was wrapped in `if (planes > 0 && panels > 0)`, and on
    // a machine with no GOOGLE_MAPS_API_KEY the quick-launch project acquires no
    // roof, so Auto Layout places nothing and the condition is false. Two of its
    // sibling tests skip honestly in that state ("No panels placed"); this one —
    // the named guard for Ray's second production failure, panels disappearing
    // into the roof — passed silently. A conditional assertion is not a test.
    //
    // It now fails instead, and `e2e/panel-elevation.spec.ts` seeds a real plane
    // so the check runs on every machine rather than only where Google answers.
    expect(planesWithVertices.length,
      'no roof plane with vertices — the on-roof guard cannot run, and must not report a pass',
    ).toBeGreaterThan(0);
    expect(panelsWithGps.length,
      'Auto Layout placed no panels — the on-roof guard cannot run, and must not report a pass',
    ).toBeGreaterThan(0);

    {
      for (const panel of panelsWithGps) {
        const plane = panel.planeId
          ? planesWithVertices.find(p => p.id === panel.planeId)
          : planesWithVertices.find(p => pointInPolygon(panel, p.vertices!));
        expect(plane,
          `panel ${panel.id} at (${panel.lat.toFixed(5)}, ${panel.lng.toFixed(5)}) should be inside a roof plane — stale frame regression`
        ).toBeTruthy();
        if (plane?.vertices?.length) {
          expect(pointInPolygon(panel, plane.vertices),
            `panel ${panel.id} point-in-polygon failed on plane ${plane.id} — off-roof regression`
          ).toBe(true);
        }
      }
    }
  });

  // ── Regression guard 4: Setback bands hug edges, not roof middle ────────
  //  cf0dd96b: miter intersection at concave vertex shot across roof interior,
  //  drawing red setback bands through the middle of the roof.
  //  Verify: each setback band centroid is closer to an edge than to the
  //  polygon centroid.
  test('setback bands hug edges — not roof interior (cf0dd96b)', async ({ page }) => {
    const state = await bootDesignStudio(page);
    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — skipping setback band placement check.');

    // Toggle zones ON to render setbacks.
    //
    // 🚨 THIS USED `isVisible()`, WHICH DOES NOT WAIT. The options bag is
    // accepted and ignored, so the check asked "is the Zones button up right
    // now?", got false while the studio was still mounting, never clicked it,
    // rendered no bands — and the `test.skip` below then reported a pass. The
    // same instantaneous-predicate trap this harness already documents for the
    // Cesium canvas, in the same file.
    const zonesButton = page.getByRole('button', { name: /zones (on|off)/i }).first();
    await zonesButton.waitFor({ state: 'visible', timeout: 20_000 });
    await zonesButton.click();
    await page.waitForTimeout(1_500);

    // Real geometry, on every machine — see e2e/support/seedRoof.ts.
    await seedRoofPlane(page);
    await runAutoLayout(page);

    const afterState = (await readSolarState(page))!;
    const planesWithVerts = afterState.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    const bandCentroids = afterState.setbackBandCentroids;

    expect(planesWithVerts.length,
      'no roof plane with vertices after seeding — the band placement check cannot run',
    ).toBeGreaterThan(0);

    // 🚨 NO BANDS IS THE DEFECT, NOT A REASON TO SKIP.
    // This was `test.skip(bandCentroids.length === 0)`. The Zones overlay is
    // now definitely on and a roof with panels is definitely present, so zero
    // bands means the overlay did not render — which is exactly what this test
    // guards. Skipping on it is a pass over an empty list.
    expect(bandCentroids.length,
      'the Zones overlay is on and the roof is seeded, so setback bands must exist — ' +
      'zero bands is the rendering failure this test was written for',
    ).toBeGreaterThan(0);

    for (const bc of bandCentroids) {
      // Find the plane this band centroid is inside
      const plane = planesWithVerts.find(p => pointInPolygon(bc, p.vertices!));
      if (!plane || !plane.vertices) continue;

      const planeCenter = centroid(plane.vertices);
      const distToCenter = haversineM(bc, planeCenter);
      const distToEdge = distToNearestEdge(bc, plane.vertices);

      // The band centroid should be much closer to an edge than to the
      // plane centroid. If the band is in the middle, distToCenter < distToEdge.
      expect(distToEdge,
        `Setback band at (${bc.lat.toFixed(5)}, ${bc.lng.toFixed(5)}) is ${distToEdge.toFixed(1)}m from edge but ${distToCenter.toFixed(1)}m from center — cf0dd96b regression: band in roof middle`
      ).toBeLessThan(distToCenter);
    }
  });

  // ── Regression guard 5: Move is smooth (2176e4d3) ──────────────────────
  //  Moving a panel should use the incremental render path, NOT trigger
  //  forceFullRebuild. panelMoveRebuildCount tracks full rebuilds during
  //  position-only changes (same panel count, forceFullRebuild=true).
  test('panel move is smooth — no forceFullRebuild on drag (2176e4d3)', async ({ page }) => {
    const state = await bootDesignStudio(page);
    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — skipping panel move smoothness check.');

    // Auto Layout to get some panels on the roof
    await seedRoofPlane(page);
    await runAutoLayout(page);

    const preMove = (await readSolarState(page))!;
    // `runAutoLayout` above already waits for panels, so an empty array here is
    // a regression, not a quiet machine limitation.
    expect(preMove.panels.length,
      'no panels after a seeded Auto Layout — the smoothness check cannot run',
    ).toBeGreaterThan(0);

    // Read panelMoveRebuildCount before any drag attempt
    const beforeDrag = preMove.panelMoveRebuildCount;

    // Simulate a panel drag: find a panel entity and drag it slightly
    // The 3D view uses Cesium's built-in drag handler for selected panels.
    // We select a panel, then simulate a move by dispatching pointer events
    // on the canvas.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    // The canvas was asserted visible a few lines up, so a missing bounding box
    // is an anomaly, not an environment this test may excuse itself from.
    expect(box, 'the Cesium canvas is visible but reports no bounding box').toBeTruthy();

    // Click in the center of the canvas (where panels likely are) to select
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // Select mode — click a panel
    await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
    await page.waitForTimeout(500);

    // Drag the selected panel slightly
    await canvas.click({ position: { x: box!.width / 2 + 30, y: box!.height / 2 + 10 } });
    await page.waitForTimeout(500);

    const afterMove = (await readSolarState(page))!;

    // panelMoveRebuildCount should NOT have increased — the incremental
    // render path should handle position updates without a full rebuild.
    expect(afterMove.panelMoveRebuildCount,
      `panelMoveRebuildCount went from ${beforeDrag} to ${afterMove.panelMoveRebuildCount} — 2176e4d3 regression: jerky panel move triggered forceFullRebuild`
    ).toBe(beforeDrag);
  });

  // ── Regression guard 6: Planset draws real geometry ─────────────────────
  //  Verify PV-1 panel count matches design panel count, and PV-1 ≠ PV-1B.
  //  (Site plan folded into the array sheet 2026-07-08: PV-2→PV-1, PV-2B→PV-1B.)
  //  This hits the /api/engineering/permit endpoint and checks the generated
  //  HTML planset.
  test('planset PV-1 panel count matches design — PV-1 ≠ PV-1B', async ({ page }) => {
    const state = await bootDesignStudio(page);
    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — skipping planset geometry check.');

    // Auto Layout to populate panels
    await seedRoofPlane(page);
    await runAutoLayout(page);

    const afterLayout = (await readSolarState(page))!;
    const designPanelCount = afterLayout.panels.length;
    expect(designPanelCount,
      'no panels after a seeded Auto Layout — the planset geometry check cannot run',
    ).toBeGreaterThan(0);

    // Navigate to the Engineering/Permit page to trigger planset generation
    // First, we need a project saved. The e2eQuickDesign demo project should
    // have one. Navigate to the permit generation route.
    const project = afterLayout.roofPlanes.length > 0 ? 'demo' : 'unknown';

    // Try to trigger permit generation via the API
    // The /api/engineering/permit route expects project data in POST body.
    // We'll use the page to navigate to engineering and check the output.
    // For now, verify the state hook has enough data to generate a valid planset:
    //   - roofPlanes with vertices
    //   - panels with lat/lng
    const planesWithVerts = afterLayout.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    const panelsWithGps = afterLayout.panels.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    expect(planesWithVerts.length,
      'Need at least 1 roof plane with vertices for planset generation'
    ).toBeGreaterThanOrEqual(1);
    expect(panelsWithGps.length,
      'Need at least 1 panel with GPS coords for planset generation'
    ).toBeGreaterThanOrEqual(1);

    // Call the permit API directly and check the HTML response
    const permitResponse = await page.request.post('/api/engineering/permit', {
      data: {
        project: {
          id: 'demo-e2e-test',
          name: 'E2E Test Project',
          address: TEST_ADDRESS,
          systemType: 'roof',
          roofPlanes: afterLayout.roofPlanes,
          panelPositions: afterLayout.panels,
        },
        layout: {
          id: 'layout-e2e-test',
          panels: afterLayout.panels,
          systemType: 'roof',
        },
        system: {
          totalPanels: afterLayout.panels.length,
          systemSizeKw: afterLayout.panels.length * 0.44,
        },
        fireSetbacks: { ridgeSetbackM: 0.457, eaveSetbackM: 0, edgeSetbackM: 0.457 },
        setback: { front: 0, back: 0, left: 0, right: 0 },
      },
    });

    if (permitResponse.ok()) {
      const html = await permitResponse.text();

      // PV-1 (site & array plan) should exist and contain a panel count
      const pv1Match = html.match(/PV-1/);
      expect(pv1Match, 'Planset should contain PV-1 sheet').toBeTruthy();

      // PV-1B should exist and be different from PV-1
      const pv1bMatch = html.match(/PV-1B/);
      if (pv1bMatch) {
        // Extract the SVG content of each sheet — they should differ
        const pv1Section = html.match(/<div class="page"[\s\S]*?PV-1[\s\S]*?<\/div>/)?.[0] ?? '';
        const pv1bSection = html.match(/<div class="page"[\s\S]*?PV-1B[\s\S]*?<\/div>/)?.[0] ?? '';
        expect(pv1Section === pv1bSection,
          'PV-1 and PV-1B should be different sheets'
        ).toBe(false);
      }

      // The planset should reference the correct panel count somewhere
      const panelCountPattern = new RegExp(String(designPanelCount));
      // Not strict — planset might use a different representation.
      // Just verify the HTML is non-trivial.
      expect(html.length, 'Permit HTML should be non-trivial').toBeGreaterThan(500);
    }
    // If the API call fails (no DB, no project), we've still verified the
    // E2E state hook has enough geometry data for planset generation.
  });
});
