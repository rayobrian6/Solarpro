import { expect, test } from '@playwright/test';

/**
 * e2e/site-switch.spec.ts
 *
 * THE MELVIN SEQUENCE, IN A REAL BROWSER.
 *
 * Ray opened 3 Melvin Drive with its 52-panel layout, picked the house next
 * door, picked Melvin again, and the panels never came back. Four test layers
 * now cover that:
 *
 *   tests/siteDesignModel.test.ts            the model
 *   tests/siteDesignIntegration.test.tsx     the hook, through React
 *   tests/designStudioSiteSwitch.component.test.tsx  DesignStudio, in jsdom
 *   tests/siteDesignRoute.postgres.test.ts   the route + real PostgreSQL
 *
 * This is the layer none of them reach: a real browser, real Cesium, real
 * React, the real /design page. It asserts the BEHAVIOUR the user sees —
 * panels leave the screen and come back — through `window.__solarE2E`, the
 * env-gated hook this harness already uses.
 *
 * 🚨 WHY IT DRIVES pickHouse() RATHER THAN CLICKING THE MAP.
 * Clicking a building in Pick House mode needs WebGL, Google Photorealistic
 * Tiles, and a building under the cursor at a known screen coordinate — none
 * of which is the behaviour under test, and all of which vary by machine. The
 * hook calls the SAME handler the engine calls, so everything downstream of
 * the click is real.
 *
 * 🚨 WHY THE DESIGN IS SEEDED.
 * The first version of this spec let Google Solar acquire the roof, and four of
 * its five tests SKIPPED on a machine with no GOOGLE_MAPS_API_KEY. A spec that
 * skips when the network is quiet proves nothing, and a vacuous skip is exactly
 * how the defect it guards ships. `seedDesign` puts a known design on the
 * active property through the studio's own setters; everything after that —
 * archiving, restoring, the banner — is the real code path.
 *
 * 🚨 WHY QUICK DESIGN AND NOT A SAVED PROJECT.
 * Persistence is proven against real PostgreSQL in the vitest layer above.
 * Driving it here would need a UUID project row in the only database this app
 * has, which is Ray's production Neon instance — so this layer proves the
 * client behaviour and deliberately writes nothing.
 */

type SiteState = {
  panels: Array<{ id: string }>;
  roofPlanes: Array<{ id: string }>;
  placedObstructions: Array<{ id: string }>;
  measurements: Array<{ id: string }>;
  activeSiteKey: string;
  archivedSiteCount: number;
  archivedEntityCount: number;
};

const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613, address: '3 Melvin Drive, Granite City, IL 62040' };
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620, address: '5 Melvin Drive, Granite City, IL 62040' };

async function hook(page: import('@playwright/test').Page): Promise<SiteState> {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__solarE2E?.pickHouse)), {
    message: 'NEXT_PUBLIC_E2E window.__solarE2E hook (with site ownership) should be installed',
    timeout: 30_000,
  }).toBe(true);
  return (await page.evaluate(() => {
    const s = (window as any).__solarE2E;
    return {
      panels: (s.panels ?? []).map((p: any) => ({ id: p.id })),
      roofPlanes: (s.roofPlanes ?? []).map((p: any) => ({ id: p.id })),
      placedObstructions: (s.placedObstructions ?? []).map((o: any) => ({ id: o.id })),
      measurements: (s.measurements ?? []).map((m: any) => ({ id: m.id })),
      activeSiteKey: s.activeSiteKey ?? '',
      archivedSiteCount: s.archivedSiteCount ?? 0,
      archivedEntityCount: s.archivedEntityCount ?? 0,
    };
  })) as SiteState;
}

/** A known design at the active property. Panel/plane ids are fixed so every
 *  assertion can compare IDENTITY — "3 panels came back" is satisfied by three
 *  of the neighbour's panels. */
const SEED = {
  panels: [
    { id: 'seed-p0', lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400, bifacialGain: 1, systemType: 'roof', tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5 },
    { id: 'seed-p1', lat: MELVIN.lat + 0.00002, lng: MELVIN.lng, wattage: 400, bifacialGain: 1, systemType: 'roof', tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5 },
    { id: 'seed-p2', lat: MELVIN.lat + 0.00004, lng: MELVIN.lng, wattage: 400, bifacialGain: 1, systemType: 'roof', tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5 },
  ],
  roofPlanes: [
    {
      id: 'seed-r0', pitch: 20, azimuth: 180, area: 40, usableArea: 34, source: 'manual', confirmed: true,
      vertices: [
        { lat: MELVIN.lat, lng: MELVIN.lng },
        { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng },
        { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng + 0.0001 },
        { lat: MELVIN.lat, lng: MELVIN.lng + 0.0001 },
      ],
    },
  ],
  obstructions: [{ id: 'seed-o0', lat: MELVIN.lat, lng: MELVIN.lng, height: 3, radiusM: 1, type: 'vent' }],
  measurements: [{ id: 'seed-m0', a: { lat: 1, lng: 1 }, b: { lat: 1, lng: 2 }, horizDistM: 5, slopeDistM: 5.2 }],
};

async function seed(page: import('@playwright/test').Page) {
  await page.evaluate(d => (window as any).__solarE2E.seedDesign(d), SEED);
  await page.waitForTimeout(300);
}

async function pick(page: import('@playwright/test').Page, at: typeof MELVIN) {
  await page.evaluate(
    ({ lat, lng, address }) => (window as any).__solarE2E.pickHouse(lat, lng, address),
    { lat: at.lat, lng: at.lng, address: at.address },
  );
  // The pick is async (it kicks off a Solar API fetch); the state change we
  // care about is synchronous, so one animation frame is enough.
  await page.waitForTimeout(400);
}

test.describe('site ownership — a property change is navigation, not deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design?e2eQuickDesign=1');
    await hook(page);
  });

  test('the E2E hook reports site ownership at all', async ({ page }) => {
    const s = await hook(page);
    expect(typeof s.archivedSiteCount).toBe('number');
    expect(typeof s.archivedEntityCount).toBe('number');
  });

  test('🚨 A → B → A restores the exact design, by ID', async ({ page }) => {
    await pick(page, MELVIN);
    await seed(page);
    const atMelvin = await hook(page);
    const melvinKey = atMelvin.activeSiteKey;
    expect(melvinKey, 'the first property must be identifiable').not.toBe('');
    expect(atMelvin.panels.map(p => p.id)).toEqual(['seed-p0', 'seed-p1', 'seed-p2']);
    expect(atMelvin.roofPlanes.map(p => p.id)).toEqual(['seed-r0']);
    expect(atMelvin.placedObstructions.map(o => o.id)).toEqual(['seed-o0']);
    expect(atMelvin.measurements.map(m => m.id)).toEqual(['seed-m0']);

    // 2. Pick the house next door.
    await pick(page, NEIGHBOUR);
    const atNeighbour = await hook(page);
    expect(atNeighbour.activeSiteKey).not.toBe(melvinKey);
    // 3. The design leaves the screen — all four entities, not just the roof.
    expect(atNeighbour.panels).toHaveLength(0);
    expect(atNeighbour.roofPlanes).toHaveLength(0);
    expect(atNeighbour.placedObstructions).toHaveLength(0);
    expect(atNeighbour.measurements).toHaveLength(0);
    // … and the UI can honestly say it was KEPT, not lost.
    expect(atNeighbour.archivedSiteCount).toBe(1);
    expect(atNeighbour.archivedEntityCount).toBe(3 + 1 + 1 + 1);

    // 4. Pick the original house again.
    await pick(page, MELVIN);
    const back = await hook(page);
    expect(back.activeSiteKey).toBe(melvinKey);
    // 5. IT ALL COMES BACK — the assertion Ray's first acceptance test failed.
    expect(back.panels.map(p => p.id)).toEqual(['seed-p0', 'seed-p1', 'seed-p2']);
    expect(back.roofPlanes.map(p => p.id)).toEqual(['seed-r0']);
    expect(back.placedObstructions.map(o => o.id)).toEqual(['seed-o0']);
    expect(back.measurements.map(m => m.id)).toEqual(['seed-m0']);
    expect(back.archivedEntityCount).toBe(0);
  });

  test('A → B → C → A, and the neighbour keeps its own work', async ({ page }) => {
    const THIRD = { lat: 38.70640, lng: -90.04610, address: '7 Melvin Drive, Granite City, IL 62040' };
    await pick(page, MELVIN);
    await seed(page);
    const melvinKey = (await hook(page)).activeSiteKey;

    await pick(page, NEIGHBOUR);
    await page.evaluate(() => (window as any).__solarE2E.seedDesign({
      panels: [{ id: 'nb-p0', lat: 38.70629, lng: -90.04620, wattage: 400, bifacialGain: 1, systemType: 'roof', tilt: 20, azimuth: 180, widthFeet: 3.3, heightFeet: 5.5 }],
    }));
    await page.waitForTimeout(300);

    await pick(page, THIRD);
    expect((await hook(page)).panels).toHaveLength(0);
    expect((await hook(page)).archivedSiteCount).toBe(2);

    await pick(page, MELVIN);
    const back = await hook(page);
    expect(back.activeSiteKey).toBe(melvinKey);
    expect(back.panels.map(p => p.id)).toEqual(['seed-p0', 'seed-p1', 'seed-p2']);

    await pick(page, NEIGHBOUR);
    expect((await hook(page)).panels.map(p => p.id)).toEqual(['nb-p0']);
  });

  test('the archived-design banner appears only when another property is held', async ({ page }) => {
    await pick(page, MELVIN);
    await seed(page);
    await expect(page.getByText('Saved for another address')).toHaveCount(0);
    await pick(page, NEIGHBOUR);
    await expect(page.getByText('Saved for another address')).toBeVisible({ timeout: 10_000 });
  });

  test('🚨 panning the map does not archive anything', async ({ page }) => {
    // The archive used to run from a useEffect on [mapCenter.lat, mapCenter.lng],
    // which the 2D pan and wheel-zoom handlers write on every pointer move. The
    // site key resolves to ~1.1 m, so one drag archived the whole design.
    await pick(page, MELVIN);
    await seed(page);
    const before = await hook(page);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    test.skip(!box, 'no canvas to drag');
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(box!.x + box!.width / 2 + i * 25, box!.y + box!.height / 2 + i * 15);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    const after = await hook(page);
    expect(after.archivedSiteCount).toBe(0);
    expect(after.roofPlanes.map(p => p.id).sort()).toEqual(before.roofPlanes.map(p => p.id).sort());
    expect(after.panels.map(p => p.id).sort()).toEqual(before.panels.map(p => p.id).sort());
  });

  test('picking the SAME house is a no-op', async ({ page }) => {
    await pick(page, MELVIN);
    await seed(page);
    const before = await hook(page);
    await pick(page, MELVIN);
    const after = await hook(page);
    expect(after.archivedSiteCount).toBe(0);
    expect(after.roofPlanes.map(p => p.id).sort()).toEqual(before.roofPlanes.map(p => p.id).sort());
  });
});
