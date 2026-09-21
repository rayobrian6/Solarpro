import { expect } from '@playwright/test';
import { buildRoofPlane3D, latLngToECEF } from '../../lib/roofPlane3D';
import { enrichRoofPlaneWith3DFrame } from '../../lib/surfaceGeometry3D';
import type { RoofPlane } from '../../types';

/**
 * e2e/support/seedRoof.ts
 *
 * A REAL ROOF, ON EVERY MACHINE.
 *
 * The quick-launch demo project carries no roof geometry, and acquiring one
 * needs Google Solar, which needs a key. Specs that depended on that key did not
 * fail without it — they went quiet: two skipped with "No panels placed", and
 * the one guarding Ray's "panels disappear into the roof" wrapped its whole body
 * in `if (planes > 0 && panels > 0)` and reported a pass over an empty array.
 *
 * So the roof is seeded, by the same `buildRoofPlane3D` the 3D trace tool calls.
 * Everything downstream — Auto Layout, the 3D routing chokepoint, the control
 * layer, the placement engine — is the real path.
 */

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/** app/design/page.tsx quick-launch project. */
export const DEMO_SITE = { lat: 38.6657, lng: -90.2266 };
/** DesignStudio's initial rackingId — the mount the seeded design will use. */
export const DEFAULT_RACKING = 'ironridge-xr100';

const TILT_DEG = 25;
const WIDTH_M = 14;   // along the eave
const DEPTH_M = 9;    // up the slope
const EAVE_H = 160;   // ellipsoidal

/** A real pitched roof face at the demo address — not a hand-written stand-in. */
export function buildSeedPlane(): RoofPlane {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO_SITE.lat * DEG);
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(TILT_DEG * DEG);
  return buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng - dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng - dLng, ridgeH),
  ]);
}

/**
 * Put that roof on the active property and wait until the 3D ENGINE has it.
 *
 * The engine count is not the same as the studio count, and pressing a placement
 * button in the gap between them places nothing at all — a harness artefact that
 * would read exactly like a defect.
 */
export async function seedRoofPlane(page: import('@playwright/test').Page): Promise<RoofPlane> {
  const plane = buildSeedPlane();
  await page.evaluate(p => (window as any).__solarE2E.seedDesign({ roofPlanes: [p] }), plane as any);

  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.roofPlanes.length ?? 0),
    { message: 'seedDesign did not put the roof plane on the active property', timeout: 10_000 },
  ).toBe(1);

  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.engineRoofPlaneCount ?? 0),
    { message: 'the 3D engine never received the seeded roof plane', timeout: 45_000 },
  ).toBeGreaterThan(0);

  return plane;
}

/** Press the real Auto Layout button and wait for panels to land. */
export async function runAutoLayout(page: import('@playwright/test').Page): Promise<void> {
  const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
  await expect(autoLayout, 'the Auto Layout button should exist on /design').toBeVisible();
  await autoLayout.click();
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.panels.length ?? 0),
    {
      message: 'Auto Layout placed no panels on a seeded roof plane — the guard ' +
               'cannot run, and must not report a pass',
      timeout: 30_000,
    },
  ).toBeGreaterThan(0);
}

/**
 * Wait for the Cesium canvas, and report honestly whether it arrived.
 *
 * 🚨 EVERY SPEC HERE USED `canvas.isVisible({ timeout: 45_000 })`, WHICH DOES
 * NOT WAIT. `Locator.isVisible()` is an INSTANTANEOUS predicate — the options
 * bag is accepted and ignored. So the check asked "is the canvas up right now?",
 * got `false` because Cesium had not mounted yet, and every canvas-gated test
 * skipped with a message that read like a machine limitation:
 *
 *     test.skip(!hasCanvas, 'No WebGL canvas — skipping on-roof panel check.')
 *
 * Five of the seven Design Studio guards skipped that way against a production
 * build, including the one guarding Ray's "panels disappear into the roof". It
 * looked like a careful degradation and was a timing bug — the same shape as a
 * guard wrapped in `if (panels.length > 0)`, and just as quiet.
 *
 * `waitFor` actually waits.
 */
export async function waitForCesiumCanvas(
  page: import('@playwright/test').Page,
  timeout = 45_000,
): Promise<boolean> {
  try {
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * A GABLE: two faces sharing a ridge, with opposite azimuths.
 *
 * 🚨 Every elevation test before this one used a SINGLE face, and Ray's report
 * is "the panels are not ALL rendering above the roof when I auto layout to
 * fill the roof". A single plane cannot show a per-plane defect, and "fill the
 * roof" means more than one face on any real house.
 */
export function buildGablePlanes(): [RoofPlane, RoofPlane] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO_SITE.lat * DEG);
  const dLng   = WIDTH_M / 2 / mPerDegLng;   // half-width along the ridge (east-west)
  const dLat   = DEPTH_M / 2 / M_PER_DEG_LAT; // half-depth up the slope (north-south)
  const ridgeH = EAVE_H + (DEPTH_M / 2) * Math.tan(TILT_DEG * DEG);

  // South face: eave to the south, ridge along the middle.
  const south = buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng - dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat,        DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat,        DEMO_SITE.lng - dLng, ridgeH),
  ]);
  // North face: shares the ridge, falls away to the north.
  const north = buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat,        DEMO_SITE.lng - dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat,        DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng - dLng, EAVE_H),
  ]);
  return [south, north];
}

/** Seed several planes at once and wait for the ENGINE to hold them all. */
export async function seedPlanes(
  page: import('@playwright/test').Page,
  planes: RoofPlane[],
): Promise<RoofPlane[]> {
  await page.evaluate(ps => (window as any).__solarE2E.seedDesign({ roofPlanes: ps }), planes as any);
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.roofPlanes.length ?? 0),
    { message: 'seedDesign did not put every roof plane on the active property', timeout: 10_000 },
  ).toBe(planes.length);
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.engineRoofPlaneCount ?? 0),
    { message: 'the 3D engine never received every seeded roof plane', timeout: 45_000 },
  ).toBe(planes.length);
  return planes;
}

/**
 * A face produced by "Tag This Roof Plane" — the 2D path, NOT the 3D tracer.
 *
 * 🚨 EVERY OTHER FIXTURE IN THIS FILE COMES FROM `buildRoofPlane3D`, so every
 * one of them carries `polygon3D`, `origin3D`, `ecefFrame3D` and
 * `createdFrom3D`. That is one shape out of three, and it is the shape that was
 * already correct. `confirmPendingPlane` in DesignStudio builds a face with
 * `vertices`, `pitch`, `azimuth` and `localFrame3D` and nothing else — and both
 * the placement engine and the renderer used to resolve THAT face differently,
 * putting the drawn panel 17 mm above its drawn deck, which with a 40 mm panel
 * box means the underside is 3 mm inside the roof. A fixture that cannot be a
 * 2D face cannot show it.
 *
 * Built by the same `enrichRoofPlaneWith3DFrame` the studio calls, so this is
 * the studio's own output shape rather than a hand-written approximation.
 */
export function buildTaggedPlane(): RoofPlane {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO_SITE.lat * DEG);
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const vertices = [
    { lat: DEMO_SITE.lat - dLat, lng: DEMO_SITE.lng - dLng },
    { lat: DEMO_SITE.lat - dLat, lng: DEMO_SITE.lng + dLng },
    { lat: DEMO_SITE.lat + dLat, lng: DEMO_SITE.lng + dLng },
    { lat: DEMO_SITE.lat + dLat, lng: DEMO_SITE.lng - dLng },
  ];
  const base: RoofPlane = {
    id: 'tagged-2d-face',
    vertices,
    pitch: TILT_DEG,
    azimuth: 180,
    area: WIDTH_M * DEPTH_M,
    usableArea: WIDTH_M * DEPTH_M * 0.75,
    centroidLat: DEMO_SITE.lat,
    centroidLng: DEMO_SITE.lng,
    source: 'manual',
    confirmed: true,
    // A real 2D face knows how high it is above the ground, and NOTHING else
    // about where it is in space.
    planeHeightAtCenterMeters: 5.2,
  } as unknown as RoofPlane;
  return enrichRoofPlaneWith3DFrame(base);
}

/**
 * A gable whose two faces do NOT already meet at the ridge.
 *
 * 🚨 `buildGablePlanes` produces faces that share their ridge corners EXACTLY,
 * which makes it useless for testing Stitch: the guard passes whether Stitch
 * runs or not. Measured — before pressing the button, the ridge vertices are
 * 0.0 mm apart. A fixture that cannot exhibit the condition is the vacuum this
 * harness keeps finding.
 *
 * This opens the ridge by `gapM` so there is something to join, and Stitch's
 * clustering (which works to ~1.5 m) has to close it.
 */
export function buildGablePlanesWithRidgeGap(gapM: number): [RoofPlane, RoofPlane] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO_SITE.lat * DEG);
  const dLng   = WIDTH_M / 2 / mPerDegLng;
  const dLat   = DEPTH_M / 2 / M_PER_DEG_LAT;
  const gapLat = gapM / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + (DEPTH_M / 2) * Math.tan(TILT_DEG * DEG);

  // South face: ridge pulled gapM SOUTH of the shared line.
  const south = buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat - dLat,      DEMO_SITE.lng - dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat - dLat,      DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat - gapLat,    DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat - gapLat,    DEMO_SITE.lng - dLng, ridgeH),
  ]);
  // North face: ridge pulled gapM NORTH of it.
  const north = buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat + gapLat,    DEMO_SITE.lng - dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat + gapLat,    DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat + dLat,      DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat + dLat,      DEMO_SITE.lng - dLng, EAVE_H),
  ]);
  return [south, north];
}
