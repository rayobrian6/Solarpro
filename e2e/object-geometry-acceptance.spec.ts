/**
 * e2e/object-geometry-acceptance.spec.ts
 *
 * IS THERE ACTUALLY A TREE ON THE SCREEN?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, SEPARATELY FROM THE PLACEMENT GATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The placement gate proved the interaction path: a click makes a canonical
 * object, it persists, it reloads, it deletes. It proved nothing about the
 * object's SHAPE, and the two were quietly conflated.
 *
 * They were not the same thing. `drawObstructionEntity` built one extruded
 * rectangle for every type and said so in its own comment — "the same
 * primitive; only the colour says which of the two kinds of object it is". So a
 * tree was a green box, and every assertion about `placedObstructions` passed
 * anyway.
 *
 * 🚨 SO THIS FILE ASSERTS THE DRAWN GEOMETRY, read back out of Cesium itself,
 * not the record that was meant to produce it. A canonical record with
 * `{type: 'tree'}` is not a tree.
 *
 * It also writes PNGs — but read the next paragraph before trusting them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 THE SCREENSHOTS THIS FILE WRITES ARE BLANK, AND THAT IS NOT THE PRODUCT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This suite runs on `chromium-software-webgl`, which does not rasterise the
 * Cesium scene: the saved PNGs show the UI chrome over an empty blue canvas,
 * with no aerial imagery and no roof either. That is the RENDERER not running,
 * not the object being absent.
 *
 * So the visual half of acceptance cannot be automated here, and this file does
 * not pretend otherwise. What it CAN prove, and does, is the geometry — read
 * back out of the live Cesium entity collection: the part kinds, the altitudes,
 * the radii, and that they equal the canonical record. Verified separately in a
 * real GPU browser at the same commit: the tree renders as a green canopy on a
 * brown trunk standing on the ground, and at 35 ft / 20 ft it projects 429 px
 * tall in an 842 px canvas.
 *
 * If someone later adds a GPU-backed project to the Playwright config, the
 * screenshots become meaningful and this note should be deleted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO DO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It does not build a PlacedObstruction and hand it to the renderer. The tool
 * is armed by clicking the real palette control and the object is placed by a
 * real mouse event on the real canvas, because two of the defects this
 * campaign found were controls that could not be pressed at all — and a test
 * that reaches past the control cannot see that.
 *
 * Seeding the HOUSE is setup and is done through the E2E hook: without Google
 * tiles there is no other way to get a roof, and the roof is not what is under
 * test here.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForCesiumCanvas } from './support/seedRoof';
import { buildSectionRoofPlanes } from '../lib/3d/buildingSection';
import { multiSectionHouse } from '../tests/fixtures/multiSectionHouse';
import fs from 'node:fs';
import path from 'node:path';

const T = 20_000;
const SHOTS = path.join(process.cwd(), 'test-results', 'object-geometry');
const SITE = { lat: 38.70615, lng: -90.04625, address: '3 Melvin Dr, Granite City, IL' };
const FT = 0.3048;

type E2EWin = Window & {
  __solarE2E?: any;
  __solarViewerE2E?: any;
};

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[SHOT] ${file}`);
}

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect
    .poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 })
    .toBe(true);
  expect(await waitForCesiumCanvas(page), 'the Cesium canvas never appeared').toBe(true);
  await expect
    .poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 60_000 })
    .toBe(true);
}

/** Setup: give the design a property and a house. Not the thing under test. */
async function seedSite(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect
    .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''), { timeout: 45_000 })
    .not.toBe('');
  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }
  await page.evaluate(ps => (window as E2EWin).__solarE2E.seedDesign({ roofPlanes: ps }), planes as any);
  await expect
    .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.roofPlanes.length ?? 0), { timeout: 15_000 })
    .toBe(planes.length);
  // 🚨 AND WAIT FOR THE ENGINE TO ACTUALLY HAVE THEM. The design state having
  // the faces is not the same as Cesium having drawn them, and a test that
  // aims the camera before the entities exist reports "the roof never
  // projected" — which reads exactly like the roof being broken.
  await expect
    .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0),
          { message: 'the 3D engine never received the faces', timeout: 60_000 })
    .toBe(planes.length);
  return planes;
}

/** Point the camera at the house and wait for it to settle inside the canvas. */
async function frame(page: Page) {
  for (let i = 0; i < 8; i++) {
    const ok = await page.evaluate(() => {
      const viewer = (window as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const pts: any[] = [];
      const now = C.JulianDate.now();
      for (const ent of viewer.entities.values) {
        if (!String(ent?.name ?? '').startsWith('[PLANE3D-')) continue;
        const poly = ent.polygon?.hierarchy?.getValue?.(now);
        if (poly?.positions?.length) pts.push(...poly.positions);
        const line = ent.polyline?.positions?.getValue?.(now);
        if (line?.length) pts.push(...line);
      }
      if (pts.length < 3) return false;
      const sphere = C.BoundingSphere.fromPoints(pts);
      try { viewer.camera.cancelFlight(); } catch {}
      viewer.camera.viewBoundingSphere(
        sphere, new C.HeadingPitchRange(0, C.Math.toRadians(-89), Math.max(70, sphere.radius * 7)));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      viewer.scene.requestRender();
      return true;
    });
    if (ok) {
      await page.waitForTimeout(900);
      // 🚨 AIMING IS NOT ARRIVING. Cesium keeps re-aiming as tiles arrive, and a
      // face that projects ABOVE the canvas makes every click land on the
      // sidebar — which reads exactly like the tool being broken.
      const inside = await page.evaluate(() => {
        const viewer = (window as any).__solarViewerE2E;
        const C = (window as any).Cesium;
        const now = C.JulianDate.now();
        const pts: any[] = [];
        for (const ent of viewer.entities.values) {
          if (!String(ent?.name ?? '').startsWith('[PLANE3D-')) continue;
          const poly = ent.polygon?.hierarchy?.getValue?.(now);
          if (poly?.positions?.length) pts.push(...poly.positions);
          const line = ent.polyline?.positions?.getValue?.(now);
          if (line?.length) pts.push(...line);
        }
        if (!pts.length) return false;
        const sphere = C.BoundingSphere.fromPoints(pts);
        const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
        const w = fn(viewer.scene, sphere.center);
        const cv = viewer.scene.canvas;
        return !!(w && isFinite(w.x) && isFinite(w.y)
          && w.x > 8 && w.y > 8 && w.x < cv.clientWidth - 8 && w.y < cv.clientHeight - 8);
      });
      if (inside) return;
    }
    await page.waitForTimeout(400);
  }
}

/** Arm a tool through the real palette, and prove the control was reachable. */
async function armTool(page: Page, mode: string) {
  await page.locator('[data-testid="toolgroup-tools"]').click();
  const tool = page.locator(`[data-testid="tool-${mode}"]`);
  await expect(tool).toBeVisible({ timeout: T });
  // 🚨 NOT `force`. A forced click still lands on whatever is painted on top,
  // so it would hide the exact defect that made Chimney look unwired.
  await tool.click();
  await expect
    .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.placementMode ?? ''), { timeout: T })
    .toBe(mode);
}

async function clickCanvas(page: Page, pt: { x: number; y: number }) {
  const box = await page.locator('canvas').first().boundingBox();
  expect(box, 'no canvas').not.toBeNull();
  // Cesium screen points are canvas-relative; page.mouse is page-relative.
  await page.mouse.click(box!.x + pt.x, box!.y + pt.y);
}

/**
 * What Cesium is ACTUALLY holding for this object, part by part.
 *
 * Reads the live entity collection — not `placedObstructions`. If the renderer
 * drew nothing, this returns nothing, which is the whole point.
 */
async function drawnParts(page: Page, objectId: string) {
  return page.evaluate((id: string) => {
    const viewer = (window as any).__solarViewerE2E;
    const C = (window as any).Cesium;
    const now = C.JulianDate.now();
    const out: any[] = [];
    for (const e of viewer.entities.values) {
      if (String(e?.name ?? '') !== `[OBS] ${id}`) continue;
      const row: any = { entityId: e.id, kinds: [] as string[] };
      if (e.polygon) {
        row.kinds.push('polygon');
        const h = e.polygon.hierarchy?.getValue?.(now);
        const ex = e.polygon.extrudedHeight?.getValue?.(now);
        let baseAlt = null;
        if (h?.positions?.length) {
          const c = C.Cartographic.fromCartesian(h.positions[0]);
          baseAlt = c ? c.height : null;
        }
        row.polygon = { baseAltitudeM: baseAlt, extrudedHeightM: ex };
      }
      if (e.cylinder) {
        row.kinds.push('cylinder');
        const p = e.position?.getValue?.(now);
        const c = p ? C.Cartographic.fromCartesian(p) : null;
        row.cylinder = {
          lengthM: e.cylinder.length?.getValue?.(now),
          bottomRadiusM: e.cylinder.bottomRadius?.getValue?.(now),
          centreAltitudeM: c ? c.height : null,
        };
      }
      if (e.ellipsoid) {
        row.kinds.push('ellipsoid');
        const p = e.position?.getValue?.(now);
        const c = p ? C.Cartographic.fromCartesian(p) : null;
        const r = e.ellipsoid.radii?.getValue?.(now);
        row.ellipsoid = {
          radiusXM: r?.x, radiusYM: r?.y, radiusZM: r?.z,
          centreAltitudeM: c ? c.height : null,
        };
      }
      out.push(row);
    }
    return out;
  }, objectId);
}

const objects = (page: Page) =>
  page.evaluate(() => (window as E2EWin).__solarE2E?.placedObstructions ?? []);

test.describe('🚨 the object is a physical thing, not a record', () => {
  test('a tree is a trunk and a canopy at the size the inspector says', async ({ page }) => {
    await openStudio(page);
    await seedSite(page);
    await frame(page);

    await armTool(page, 'tree');
    await shot(page, '1-tree-armed');

    // Open ground, to the lower-left of the house.
    const box = await page.locator('canvas').first().boundingBox();
    await clickCanvas(page, { x: Math.round(box!.width * 0.22), y: Math.round(box!.height * 0.72) });

    await expect
      .poll(async () => (await objects(page)).length,
            { message: 'clicking the ground with Tree armed placed nothing', timeout: T })
      .toBe(1);
    const [rec] = await objects(page);
    expect(rec.type).toBe('tree');

    // ── THE ASSERTION THE RECORD CANNOT MAKE ────────────────────────────────
    const parts = await drawnParts(page, rec.id);
    const kinds = parts.flatMap((p: any) => p.kinds).sort();
    expect(kinds,
      `the tree was drawn as ${JSON.stringify(kinds)} — a tree needs a trunk and a canopy, ` +
      'and a single polygon means it is still a green box')
      .toEqual(['cylinder', 'ellipsoid']);

    const trunk = parts.find((p: any) => p.cylinder)!.cylinder;
    const canopy = parts.find((p: any) => p.ellipsoid)!.ellipsoid;

    // It stands ON the ground: the trunk's base is the record's own base.
    expect(trunk.centreAltitudeM - trunk.lengthM / 2).toBeCloseTo(rec.height, 3);
    // Its top is exactly the canonical height above that base.
    expect(canopy.centreAltitudeM + canopy.radiusZM).toBeCloseTo(rec.height + rec.heightM, 3);
    // Its canopy is exactly the canonical width across.
    expect(canopy.radiusXM * 2).toBeCloseTo(rec.widthM, 3);
    // And shade's radius is that same canopy, not a second opinion.
    expect(rec.canopyRadiusM).toBeCloseTo(canopy.radiusXM, 6);

    await shot(page, '2-tree-placed');

    // ── SELECT IT BY CLICKING IT, THEN EDIT IT IN THE INSPECTOR ─────────────
    //
    // 🚨 THROUGH THE REAL CONTROLS. Selecting by clicking the canopy also
    // proves the hit target corresponds to the VISIBLE object — a tree drawn as
    // a trunk and a canopy is two Cesium entities, and if they did not both
    // carry the object's name, clicking the thing you can see would select
    // nothing.
    // Select is a standalone spine control, not inside a group flyout.
    await page.locator('[data-testid="tool-select"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.placementMode ?? ''), { timeout: T })
      .toBe('select');
    const treePt = await page.evaluate((o: { lat: number; lng: number; h: number }) => {
      const viewer = (window as any).__solarViewerE2E;
      const C = (window as any).Cesium;
      const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
      // Aim at the middle of the canopy, which is what a person would click.
      const w = fn(viewer.scene, C.Cartesian3.fromDegrees(o.lng, o.lat, o.h));
      return w && isFinite(w.x) ? { x: w.x, y: w.y } : null;
    }, { lat: rec.lat, lng: rec.lng, h: rec.height + rec.heightM * 0.75 });
    expect(treePt, 'the tree never projected into the canvas').toBeTruthy();
    await clickCanvas(page, treePt!);
    await page.waitForTimeout(600);

    const inspector = page.locator('[data-testid="obstruction-height"]');
    const selected = await inspector.count();
    expect(selected,
      'clicking the visible canopy did not select the tree — the drawn parts do ' +
      'not share the object identity').toBeGreaterThan(0);

    const H35 = 35 * FT, W20 = 20 * FT;
    const beforeCanopyW = canopy.radiusXM * 2;

    await inspector.fill(String(H35.toFixed(3)));
    await page.waitForTimeout(500);
    await page.locator('[data-testid="obstruction-canopy"]').fill(String(W20.toFixed(3)));
    await page.waitForTimeout(1000);

    const parts2 = await drawnParts(page, rec.id);
    const canopy2 = parts2.find((p: any) => p.ellipsoid)!.ellipsoid;
    const trunk2 = parts2.find((p: any) => p.cylinder)!.cylinder;
    const drawnHeight = (canopy2.centreAltitudeM + canopy2.radiusZM)
      - (trunk2.centreAltitudeM - trunk2.lengthM / 2);

    expect(canopy2.radiusXM * 2, 'the canopy did not resize when the inspector did')
      .toBeCloseTo(W20, 2);
    expect(drawnHeight, 'the tree is not 35 ft tall after the edit')
      .toBeCloseTo(H35, 2);
    expect(canopy2.radiusXM * 2, 'the geometry did not change at all')
      .not.toBeCloseTo(beforeCanopyW, 3);

    // And shade still reads the same canopy the renderer drew.
    const rec2 = (await objects(page))[0];
    expect(rec2.canopyRadiusM, 'shade and the renderer now disagree about the canopy')
      .toBeCloseTo(canopy2.radiusXM, 6);

    console.log('[MEASURED] tree drawn height ' + (drawnHeight / 0.3048).toFixed(1)
      + ' ft, canopy ' + ((canopy2.radiusXM * 2) / 0.3048).toFixed(1) + ' ft');

    // 🚨 AND POINT THE CAMERA AT IT, because the owner's acceptance test is
    // "can I look at the screen and see a tree" — a screenshot of the roof with
    // the tree off-frame proves the assertions ran, not that anything is
    // visible. Deselect first so the inspector stops covering the canvas.
    await page.locator('[data-testid="obstruction-delete"]').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate((o: { lat: number; lng: number; h: number }) => {
      const viewer = (window as any).__solarViewerE2E;
      const C = (window as any).Cesium;
      try { viewer.camera.cancelFlight(); } catch {}
      // The same idiom `frame()` uses, which is the one proven to land the
      // camera somewhere with something to draw. `lookAt` + an immediate
      // `lookAtTransform(IDENTITY)` left the scene empty.
      const sphere = new C.BoundingSphere(C.Cartesian3.fromDegrees(o.lng, o.lat, o.h), 9);
      viewer.camera.viewBoundingSphere(
        sphere, new C.HeadingPitchRange(C.Math.toRadians(25), C.Math.toRadians(-20), 40));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      viewer.scene.requestRender();
    }, { lat: rec.lat, lng: rec.lng, h: rec.height + (35 * 0.3048) / 2 });
    await page.waitForTimeout(1500);
    await shot(page, '3-tree-35ft-20ft');
  });

  test('a chimney is a body standing on the roof face that was clicked', async ({ page }) => {
    await openStudio(page);
    const planes = await seedSite(page);
    await frame(page);

    await armTool(page, 'obstruction');
    const chip = page.locator('[data-testid="obstruction-preset-chimney"]');
    await expect(chip).toBeVisible({ timeout: T });
    await chip.click();          // again: not forced
    await page.waitForTimeout(400);

    const pt = await page.evaluate((id: string) => {
      const viewer = (window as any).__solarViewerE2E;
      const C = (window as any).Cesium;
      const now = C.JulianDate.now();
      const pts: any[] = [];
      for (const ent of viewer.entities.values) {
        const nm = String(ent?.name ?? '');
        if (!nm.startsWith('[PLANE3D-') || !nm.endsWith(` ${id}`)) continue;
        const poly = ent.polygon?.hierarchy?.getValue?.(now);
        if (poly?.positions?.length) pts.push(...poly.positions);
        // 🚨 THE FACE IS DRAWN AS AN OUTLINE, i.e. a POLYLINE. Reading only
        // `polygon` found nothing and reported "the roof never projected",
        // which is indistinguishable from the roof not being there.
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
    }, planes[0].id);
    expect(pt, 'the roof face never projected into the canvas').toBeTruthy();

    await clickCanvas(page, pt!);
    await expect
      .poll(async () => (await objects(page)).length,
            { message: 'clicking the roof with Chimney armed placed nothing', timeout: T })
      .toBe(1);

    const [rec] = await objects(page);
    expect(rec.type).toBe('chimney');
    expect(rec.planeId, 'the chimney did not bind to the face it was dropped on')
      .toBe(planes[0].id);

    const parts = await drawnParts(page, rec.id);
    expect(parts.length, 'the chimney was not drawn at all').toBe(1);
    expect(parts[0].kinds).toEqual(['polygon']);

    // 🚨 THE DATUM. `extrudedHeight` is an ALTITUDE. The old code passed the
    // object's own height here, which at a property with a real elevation drew
    // a spike from near the ellipsoid up to the roof.
    const poly = parts[0].polygon;
    expect(poly.baseAltitudeM, 'the chimney does not start at the roof')
      .toBeCloseTo(rec.height, 3);
    expect(poly.extrudedHeightM - poly.baseAltitudeM,
      'the chimney is not its own height tall — the extrusion datum is wrong')
      .toBeCloseTo(rec.heightM, 3);

    await shot(page, '4-chimney-on-roof');
  });
});
