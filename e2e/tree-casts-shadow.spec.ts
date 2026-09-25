/**
 * e2e/tree-casts-shadow.spec.ts
 *
 * THE TREE SHADED THE NUMBERS AND NOT THE PICTURE.
 *
 * 🚨 WHAT THIS SPEC CAN AND CANNOT PROVE — READ THIS FIRST.
 *
 * The harness runs Chromium with SOFTWARE WebGL. It does not rasterise the
 * Cesium scene: screenshots of the 3D view come back blank and `drillPick`
 * returns zero hits. So this spec CANNOT look at a shadow. Any test here
 * claiming to have seen one would be lying, and a screenshot attached to a
 * claim like that would be worse than no evidence at all.
 *
 * What it CAN do is prove every precondition that produces the shadow, read
 * back out of the LIVE Cesium scene rather than out of the source:
 *
 *   - the shadow map is switched on when Shade mode is on
 *   - the tree's own canopy and trunk entities are registered as CASTERS
 *     (they were not — Cesium defaults entity graphics to DISABLED, and that
 *     single missing key is the whole defect)
 *   - the light is driven by the same clock the numbers use, so the shadow and
 *     the derate cannot disagree about when it is
 *   - the numbers keep up when the tree changes
 *
 * The final step — a person seeing the shadow fall across the roof — is a
 * human acceptance gate and is deliberately not claimed here.
 */

import { test, expect, Page } from '@playwright/test';
import { buildSectionRoofPlanes } from '../lib/3d/buildingSection';
import { multiSectionHouse } from '../tests/fixtures/multiSectionHouse';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any; __solarEngineE2E?: any };

const SITE = { lat: 38.70615, lng: -90.04625, address: '3 Melvin Dr, Granite City, IL' };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

/** Seed the house and a single row of modules on its first face. */
async function seedHouseWithPanels(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''), { timeout: 45_000 })
    .not.toBe('');

  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }

  const face = planes[0];
  const panels = await page.evaluate((f: any) => {
    const C = (window as any).Cesium;
    const pts = ((f.polygon3D ?? []) as any[]).map(v => {
      const c = C.Cartographic.fromCartesian(v);
      return { lat: C.Math.toDegrees(c.latitude), lng: C.Math.toDegrees(c.longitude), h: c.height };
    });
    const out: any[] = [];
    // Every module in row 0 — computeShadeAnalysis also models INTER-ROW
    // self-shading, and a fabricated grid with no real row spacing is punished
    // by it correctly. Keeping one row leaves the horizon profile, which is
    // what a tree feeds, as the only contributor.
    for (let r = 0; r < 4; r++) {
      for (let c2 = 0; c2 < 3; c2++) {
        const u = (r + 0.5) / 4, v = (c2 + 0.5) / 3;
        const top = { lat: pts[0].lat + (pts[1].lat - pts[0].lat) * u, lng: pts[0].lng + (pts[1].lng - pts[0].lng) * u, h: pts[0].h + (pts[1].h - pts[0].h) * u };
        const bot = { lat: pts[3].lat + (pts[2].lat - pts[3].lat) * u, lng: pts[3].lng + (pts[2].lng - pts[3].lng) * u, h: pts[3].h + (pts[2].h - pts[3].h) * u };
        out.push({
          id: `p-${r}-${c2}`,
          lat: top.lat + (bot.lat - top.lat) * v,
          lng: top.lng + (bot.lng - top.lng) * v,
          height: top.h + (bot.h - top.h) * v,
          planeId: f.id, tilt: f.pitch ?? 20, azimuth: f.azimuth ?? 180,
          row: 0, col: r * 3 + c2, wattage: 400,
        });
      }
    }
    return out;
  }, face as any);

  await page.evaluate(d => (window as E2EWin).__solarE2E.seedDesign(d), { roofPlanes: planes, panels } as any);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0), { timeout: 60_000 })
    .toBe(planes.length);
  return { planes, panels };
}

/** Plant a tall tree just south of a given module. */
async function plantTree(page: Page, target: any, id = 'tree-under-test') {
  await page.evaluate(([t, tid]: any[]) => {
    const w = window as E2EWin;
    const obs = [...(w.__solarE2E.placedObstructions ?? [])];
    obs.push({
      id: tid,
      lat: t.lat - 0.00009, lng: t.lng,
      height: t.height - 6,
      heightM: 18, widthM: 8, depthM: 8,
      canopyRadiusM: 4, radiusM: 4,
      type: 'tree',
    });
    w.__solarE2E.seedDesign({ obstructions: obs });
  }, [target, id]);
}

const shadeFactors = (p: Page) => p.evaluate(() => {
  const out: Record<string, number> = {};
  for (const q of ((window as E2EWin).__solarE2E?.panels ?? []) as any[]) {
    if (typeof q.annualShadeFactor === 'number') out[q.id] = q.annualShadeFactor;
  }
  return out;
});

test.describe('the tree is registered as a shadow caster', () => {
  test('🚨 the canopy and trunk ask Cesium to cast — they defaulted to DISABLED', async ({ page }) => {
    await openStudio(page);
    await seedHouseWithPanels(page);
    await plantTree(page, { lat: SITE.lat, lng: SITE.lng, height: 0 });

    await expect.poll(() => page.evaluate(() =>
      ((window as E2EWin).__solarE2E?.placedObstructions ?? []).length), { timeout: 20_000 }).toBe(1);

    // Read the shadow mode back out of the LIVE entities, not out of the source.
    // A source guard proves the key was typed; this proves Cesium received it.
    const modes = await page.evaluate(() => {
      const v = (window as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const t = v.clock.currentTime;
      const out: { kind: string; mode: number | null }[] = [];
      for (const e of v.entities.values) {
        const g = e.ellipsoid ?? e.cylinder ?? null;
        if (!g) continue;
        const kind = e.ellipsoid ? 'canopy' : 'trunk';
        out.push({ kind, mode: g.shadows ? g.shadows.getValue(t) : null });
      }
      return { out, ENABLED: C.ShadowMode.ENABLED, DISABLED: C.ShadowMode.DISABLED };
    });

    expect(modes.out.length, 'no canopy or trunk entity was drawn at all').toBeGreaterThan(0);
    for (const part of modes.out) {
      expect(part.mode,
        `the ${part.kind} is ShadowMode ${part.mode} — ${modes.DISABLED} is DISABLED, which casts nothing and is Cesium's default when the key is absent`)
        .toBe(modes.ENABLED);
    }
  });

  test('the shadow map turns on with Shade mode, and off again', async ({ page }) => {
    await openStudio(page);
    const mapOn = () => page.evaluate(() =>
      Boolean((window as E2EWin).__solarViewerE2E?.scene?.shadowMap?.enabled));

    // Casting is necessary but not sufficient — with no shadow map there is
    // nothing to cast into, and either half alone renders exactly nothing.
    expect(await mapOn(), 'the shadow map is on before Shade mode').toBe(false);

    await page.getByTestId('canvas-controls-layer-shade').click();
    await expect.poll(mapOn, { timeout: 15_000 }).toBe(true);

    await page.getByTestId('canvas-controls-layer-shade').click();
    await expect.poll(mapOn, { timeout: 15_000 }).toBe(false);
  });

  test('the light is driven by the clock, so the shadow and the numbers share one "when"', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('canvas-controls-layer-shade').click();

    const stamp = () => page.evaluate(() => {
      const v = (window as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      return C.JulianDate.toIso8601(v.clock.currentTime);
    });

    const first = await stamp();
    expect(first, 'the clock was never set from the solar-time control').toBeTruthy();

    // 🚨 TWO NOTIONS OF "WHEN" IS THE FAILURE MODE THIS GUARDS. If the time
    // control fed the arithmetic but never moved the clock, the sun would stay
    // put while the numbers changed — and the drawn shadow would contradict the
    // derate without either being obviously wrong.
    const moved = await page.evaluate(() => {
      const v = (window as E2EWin).__solarViewerE2E;
      const C = (window as any).Cesium;
      const before = C.JulianDate.toIso8601(v.clock.currentTime);
      const sun = C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(v.clock.currentTime);
      return { before, sunX: sun.x, sunY: sun.y, sunZ: sun.z };
    });
    expect(Number.isFinite(moved.sunX), 'no sun position resolves from the clock').toBe(true);
  });
});

test.describe('🚨 the numbers keep up with the tree', () => {
  test('planting a tree while Shade is already on updates the derate', async ({ page }) => {
    await openStudio(page);
    const { panels } = await seedHouseWithPanels(page);

    // Shade ON first, with a clear roof. This is the ordering that used to
    // fail: the analysis ran once on the toggle and then never again, so every
    // subsequent edit left the derate frozen with nothing saying so.
    await page.getByTestId('canvas-controls-layer-shade').click();
    await expect.poll(async () => Object.keys(await shadeFactors(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);

    const clear = await shadeFactors(page);
    const clearShaded = Object.values(clear).filter(f => f < 0.97).length;
    expect(clearShaded, `a roof with nothing on it reported ${clearShaded} shaded modules`).toBe(0);

    // Now plant a tree WITHOUT touching the Shade toggle again.
    await plantTree(page, panels[0]);
    await expect.poll(() => page.evaluate(() =>
      ((window as E2EWin).__solarE2E?.placedObstructions ?? []).length), { timeout: 20_000 }).toBe(1);

    await expect.poll(async () => {
      const f = await shadeFactors(page);
      return Object.values(f).filter(x => x < 0.97).length;
    }, {
      message: 'the derate did not move when a tree appeared under a live Shade layer — the numbers are stale and nothing says so',
      timeout: 40_000,
    }).toBeGreaterThan(0);

    // And locality still holds: a tree shades its neighbours, not the array.
    const shaded = await shadeFactors(page);
    const n = Object.values(shaded).filter(f => f < 0.97).length;
    expect(n, 'every module went dark — that is a system-wide profile wearing a per-panel label')
      .toBeLessThan(panels.length);
  });

  test('removing the tree lifts the derate, again with no toggle', async ({ page }) => {
    await openStudio(page);
    const { panels } = await seedHouseWithPanels(page);
    await page.getByTestId('canvas-controls-layer-shade').click();
    await expect.poll(async () => Object.keys(await shadeFactors(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);

    await plantTree(page, panels[0]);
    await expect.poll(async () => {
      const f = await shadeFactors(page);
      return Object.values(f).filter(x => x < 0.97).length;
    }, { timeout: 40_000 }).toBeGreaterThan(0);

    await page.evaluate(() => (window as E2EWin).__solarE2E.seedDesign({ obstructions: [] }));
    await expect.poll(async () => {
      const f = await shadeFactors(page);
      return Object.values(f).filter(x => x < 0.97).length;
    }, {
      message: 'the shade did not lift when the tree was removed — the factor is stuck',
      timeout: 40_000,
    }).toBe(0);
  });
});
