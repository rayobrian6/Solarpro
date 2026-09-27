/**
 * e2e/ground-mount-structure-moves-with-it.spec.ts
 *
 * ═══ "MODULES MOVED TO THE NEW POSITION / RAILS STAYED BEHIND / PYLONS STAYED BEHIND" ═══
 *
 * Ray's second live report, with a screenshot: selecting and moving the array now works, and the
 * physical mount does not come with it. His standard for closing it:
 *
 *   "Use actual visible rendered entities, not only panel JSON. Record the visible locations of
 *    modules, rails, pylons. Then drag the mount. PASS only if all visible geometry moves
 *    together. Rotate it. PASS only if all visible geometry rotates together."
 *
 * So the racking positions here are read off the CESIUM ENTITIES the viewer is actually holding
 * (`__solarEngineE2E.racking()` walks `panelMapRef`, skips anything the viewer no longer
 * contains, and converts each entity's own `position` back to lat/lng). Panel JSON cannot
 * discriminate this defect at all: the modules were always right.
 *
 * THE INVARIANT EVERY STEP USES — ALIGNMENT. For each structural member, the distance to its
 * nearest module. A mount that moves as one object preserves that whole multiset; a mount whose
 * modules move while its structure stays behind does not, by exactly the drag distance. It needs
 * no knowledge of how many pylons a style produces or where a rail sits, and it holds for a
 * translation, a rotation, a tilt and a row-pitch change alike.
 *
 * Seeding and the camera move are the same accommodations `ground-mount-is-one-object.spec.ts`
 * documents (terrain picking needs a rasterised scene; the quick-launch camera does not frame the
 * seeded mount). Everything under test — the press, the drag, the release — is real mouse input
 * through the engine's real handlers.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;
const MPD = 111_320;

const SITE = { lat: 38.6657, lng: -90.2266 };
const TILT = 20;
const PANEL_W = 1.134, PANEL_H = 1.722;
const CLEARANCE = 0.6096;
const GROUND_Z = 140;

type Mod = { id: string; lat: number; lng: number; height: number; row: number; col: number; tilt: number; azimuth: number };
type Assembly = { arrayId: string; modules: Mod[] };
type Member = { key: string; name: string; arrayId: string | null; lat: number; lng: number; height: number };
type E2EWin = Window & {
  __solarE2E?: { panels?: unknown[]; seedDesign?: (d: { panels?: unknown[] }) => void };
  __solarViewerE2E?: unknown;
  __solarEngineE2E?: {
    selection?: () => { groundArrayId: string | null; panelIds: string[] };
    assemblies?: () => Assembly[];
    racking?: () => Member[];
  };
};

function mount(arrayId: string, rows: number, cols: number, eastM: number) {
  const t = TILT * Math.PI / 180;
  const rowDepth = PANEL_H * Math.cos(t);
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const out: Record<string, unknown>[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nsM = r * rowDepth + rowDepth / 2;
      const ewM = eastM + c * PANEL_W + PANEL_W / 2;
      out.push({
        id: `${arrayId}-p${r}-${c}`,
        lat: SITE.lat + nsM / MPD,
        lng: SITE.lng + ewM / (MPD * cosLat),
        height: GROUND_Z + CLEARANCE + nsM * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65,
        tilt: TILT, azimuth: 180,
        row: r, col: c, arrayRow: r,
        arrayId,
        systemType: 'ground',
        orientation: 'portrait',
        wattage: 440,
        heading: 0, pitch: -(TILT * Math.PI / 180), roll: 0,
      });
    }
  }
  return out;
}

const A = 'ga-alpha', B = 'ga-bravo';
const SEED = [...mount(A, 2, 4, 0), ...mount(B, 2, 3, 30)];

const engine = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as E2EWin).__solarEngineE2E;
  return {
    selection: e?.selection?.() ?? { groundArrayId: null, panelIds: [] },
    assemblies: e?.assemblies?.() ?? [],
    racking: e?.racking?.() ?? [],
  };
});

const horizM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * MPD, (a.lng - b.lng) * MPD * cosLat);
};
const byId = (as: Assembly[], arrayId: string) => as.find(a => a.arrayId === arrayId)!;
const rackOf = (all: Member[], arrayId: string) => all.filter(m => m.arrayId === arrayId);

/** Nearest-module distance for every member, sorted. The alignment fingerprint of one mount. */
function alignment(members: Member[], modules: Mod[]): number[] {
  return members
    .map(m => Math.min(...modules.map(p => horizM(m, p))))
    .sort((a, b) => a - b);
}

function expectStillAligned(
  before: { rack: Member[]; mods: Mod[] }, after: { rack: Member[]; mods: Mod[] },
  what: string, tolM = 0.05,
) {
  expect(after.rack.length, `${what}: the structure lost members (${before.rack.length} → ${after.rack.length})`)
    .toBe(before.rack.length);
  const ab = alignment(before.rack, before.mods);
  const aa = alignment(after.rack, after.mods);
  const worstBefore = ab[ab.length - 1], worstAfter = aa[aa.length - 1];
  expect(worstAfter,
    `${what}: the structure is no longer under the modules — the furthest member sits `
    + `${worstAfter.toFixed(2)} m from the nearest module, was ${worstBefore.toFixed(2)} m. `
    + 'THIS IS THE REPORTED DEFECT: the modules moved and the rails and pylons stayed behind.')
    .toBeLessThan(worstBefore + tolM);
  ab.forEach((d, i) => {
    expect(Math.abs(aa[i] - d),
      `${what}: member/module distance ${i} changed by ${((aa[i] - d) * 1000).toFixed(0)} mm`)
      .toBeLessThan(tolM);
  });
}

async function frameAssembly(page: Page, arrayId: string) {
  await page.evaluate((id) => {
    const w = window as unknown as E2EWin;
    const v = w.__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return;
    const mods = (w.__solarEngineE2E?.assemblies?.() ?? []).find(a => a.arrayId === id)?.modules ?? [];
    if (!mods.length) return;
    const lat = mods.reduce((s, m) => s + m.lat, 0) / mods.length;
    const lng = mods.reduce((s, m) => s + m.lng, 0) / mods.length;
    const h = mods.reduce((s, m) => s + m.height, 0) / mods.length;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(lng, lat - 0.00035, h + 45),
      orientation: { heading: 0, pitch: -C.Math.toRadians(58), roll: 0 },
    });
    v.scene.requestRender();
  }, arrayId);
  await page.waitForTimeout(900);
}

/** The leftmost on-screen module of the mount, refusing a pixel the inspector covers. */
async function pressPointOnce(page: Page, arrayId: string) {
  const pick = await page.evaluate((id) => {
    const w = window as unknown as E2EWin;
    const v = w.__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return null;
    const mods = (w.__solarEngineE2E?.assemblies?.() ?? []).find(a => a.arrayId === id)?.modules ?? [];
    const rect = v.canvas.getBoundingClientRect();
    let best: { x: number; y: number; id: string } | null = null;
    for (const m of mods) {
      const px = v.scene.cartesianToCanvasCoordinates(C.Cartesian3.fromDegrees(m.lng, m.lat, m.height));
      if (!px) continue;
      if (px.x < 20 || px.y < 20 || px.x > rect.width - 20 || px.y > rect.height - 20) continue;
      if (!best || px.x < best.x - rect.left) {
        best = { x: Math.round(rect.left + px.x), y: Math.round(rect.top + px.y), id: m.id };
      }
    }
    return best ? { ...best, canvas: { l: rect.left, t: rect.top, w: rect.width, h: rect.height } } : null;
  }, arrayId);
  if (!pick) return null;
  const c = pick.canvas;
  const insLeft = c.l + c.w - 12 - 248;
  const covered = pick.x >= insLeft && pick.y >= c.t + 96 && pick.y <= c.t + 96 + 210;
  if (covered) return null;
  return { x: pick.x, y: pick.y, id: pick.id };
}

async function pressPointFor(page: Page, arrayId: string): Promise<{ x: number; y: number; id: string }> {
  let last: Awaited<ReturnType<typeof pressPointOnce>> = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    last = await pressPointOnce(page, arrayId);
    if (last) return last;
    await frameAssembly(page, arrayId);
    await page.waitForTimeout(700);
  }
  expect(last, `after 5 attempts no module of ${arrayId} could be pressed`).toBeTruthy();
  return last!;
}

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
    undefined, { timeout: T });
  await page.evaluate(p => { (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p }); }, SEED);
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.racking,
    undefined, { timeout: T * 2 });
  await page.waitForFunction(n => ((window as unknown as E2EWin).__solarEngineE2E
    ?.assemblies?.() ?? []).reduce((s, a) => s + a.modules.length, 0) === n,
    SEED.length, { timeout: T });
  // 🚨 AND WAIT FOR THE STRUCTURE TO EXIST BEFORE MEASURING IT.
  // Asserting "the rails moved with the modules" against zero rails would pass trivially, which
  // is the blind-assertion trap. Both mounts must have real members before anything is dragged.
  await page.waitForFunction(() => {
    const r = (window as unknown as E2EWin).__solarEngineE2E?.racking?.() ?? [];
    return r.filter(m => m.arrayId === 'ga-alpha').length >= 4
        && r.filter(m => m.arrayId === 'ga-bravo').length >= 4;
  }, undefined, { timeout: T });
  await page.waitForTimeout(1_200);
  await frameAssembly(page, A);
}

test.describe('the ground mount moves as one PHYSICAL object', () => {
  test.setTimeout(T * 5);

  test('🚨 dragging it takes the rails and pylons with it, and leaves the other mount alone', async ({ page }) => {
    await boot(page);

    const start = await engine(page);
    const rackA0 = rackOf(start.racking, A);
    const rackB0 = rackOf(start.racking, B);
    // The measurement is worthless without something to measure.
    expect(rackA0.length, 'mount A has no rendered structure at all, so this proves nothing')
      .toBeGreaterThan(3);
    expect(rackB0.length, 'mount B has no rendered structure at all').toBeGreaterThan(3);
    // Every member belongs to a named assembly — a member with no namespace is a member two
    // mounts can collide on.
    expect(start.racking.filter(m => !m.arrayId).length,
      'some structural members carry no assembly id').toBe(0);
    // Pylons and rails, by the engine's own member names — not just "some boxes".
    expect(rackA0.some(m => /PYLON|PILE|POST/i.test(m.name)),
      `mount A has no posts among ${rackA0.length} members: ${rackA0.map(m => m.name).join(', ')}`)
      .toBe(true);
    expect(rackA0.some(m => /RAIL|STRONGBACK|\bSB\b|CROSS/i.test(m.name)),
      `mount A has no rails among ${rackA0.length} members: ${rackA0.map(m => m.name).join(', ')}`)
      .toBe(true);

    const modsA0 = byId(start.assemblies, A).modules;
    const modsB0 = byId(start.assemblies, B).modules;

    // ── select and drag, with the real mouse ────────────────────────────────
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(600);
    const sel = await engine(page);
    expect(sel.selection.groundArrayId, 'the click did not select the mount').toBe(A);

    const from = await pressPointFor(page, A);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(from.x + i * 9, from.y + i * 5);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(900);

    const after = await engine(page);
    const modsA1 = byId(after.assemblies, A).modules;
    const rackA1 = rackOf(after.racking, A);

    const movedModule = horizM(modsA0[0], modsA1.find(m => m.id === modsA0[0].id)!);
    expect(movedModule, 'the drag moved the mount less than 10 cm — it did not take')
      .toBeGreaterThan(0.1);

    // 🚨 THE DEFECT, STATED DIRECTLY: did the structure move by the same amount?
    const rackCentroid = (ms: Member[]) => ({
      lat: ms.reduce((s, m) => s + m.lat, 0) / ms.length,
      lng: ms.reduce((s, m) => s + m.lng, 0) / ms.length,
    });
    const movedStructure = horizM(rackCentroid(rackA0), rackCentroid(rackA1));
    expect(Math.abs(movedStructure - movedModule),
      `the modules moved ${movedModule.toFixed(2)} m and the structure moved `
      + `${movedStructure.toFixed(2)} m. Ray's screenshot: "modules moved to the new position, `
      + 'rails stayed behind, pylons/posts stayed behind".')
      .toBeLessThan(0.05);

    // ...and it is still physically under them, member by member.
    expectStillAligned({ rack: rackA0, mods: modsA0 }, { rack: rackA1, mods: modsA1 }, 'drag-move');

    // 🚨 AND NOTHING OF MOUNT B MOVED — not its modules and not its structure.
    const modsB1 = byId(after.assemblies, B).modules;
    for (const b of modsB0) {
      const a = modsB1.find(m => m.id === b.id)!;
      expect(horizM(b, a), `mount B's ${b.id} moved when mount A was dragged`).toBeLessThan(0.01);
    }
    const rackB1 = rackOf(after.racking, B);
    expect(rackB1.length, "mount B's structure changed count when mount A was dragged")
      .toBe(rackB0.length);
    expect(horizM(rackCentroid(rackB0), rackCentroid(rackB1)),
      "mount B's structure moved when mount A was dragged").toBeLessThan(0.01);
  });

  test('🚨 turning it turns the structure too — the rails do not stay pointing the old way', async ({ page }) => {
    await boot(page);
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await expect(page.getByTestId('ground-mount-inspector')).toBeVisible({ timeout: T });

    const before = await engine(page);
    const rackA0 = rackOf(before.racking, A);
    const modsA0 = byId(before.assemblies, A).modules;
    expect(rackA0.length, 'mount A has no rendered structure to rotate').toBeGreaterThan(3);

    const az = page.getByTestId('ground-mount-azimuth');
    await az.fill('210');
    await az.blur();
    await page.waitForTimeout(1_200);

    const after = await engine(page);
    const rackA1 = rackOf(after.racking, A);
    const modsA1 = byId(after.assemblies, A).modules;

    for (const m of modsA1) expect(m.azimuth, `${m.id} did not turn with the assembly`).toBe(210);
    // Something actually turned on the structure as well — otherwise "still aligned" could be
    // satisfied by nothing having happened at all.
    const anchor = modsA1.find(m => m.id === `${A}-p0-0`)!;
    const furthest = (ms: Member[]) => ms.reduce((best, m) =>
      horizM(m, anchor) > horizM(best, anchor) ? m : best, ms[0]);
    const f0 = furthest(rackA0), f1 = furthest(rackA1);
    expect(Math.max(horizM(f0, f1), 0), 'no structural member moved, so nothing rotated')
      .toBeGreaterThan(0.2);
    // ...and the structure is under the modules in the NEW orientation.
    expectStillAligned({ rack: rackA0, mods: modsA0 }, { rack: rackA1, mods: modsA1 }, 'rotate', 0.25);

    const rackB0 = rackOf(before.racking, B), rackB1 = rackOf(after.racking, B);
    expect(rackB1.length, "mount B's structure changed when mount A was turned").toBe(rackB0.length);
  });

  test('after 3D → 2D → 3D every component is still there and still aligned', async ({ page }) => {
    await boot(page);
    const before = await engine(page);
    const rackA0 = rackOf(before.racking, A), modsA0 = byId(before.assemblies, A).modules;
    const rackB0 = rackOf(before.racking, B), modsB0 = byId(before.assemblies, B).modules;
    expect(rackA0.length).toBeGreaterThan(3);

    const view = page.getByRole('button', { name: /3D View|2D Map/ });
    await view.click();
    await expect(page.getByRole('button', { name: /2D Map/ })).toBeVisible({ timeout: T });
    await page.waitForTimeout(1_500);
    await view.click();
    await expect(page.getByRole('button', { name: /3D View/ })).toBeVisible({ timeout: T });
    await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.racking,
      undefined, { timeout: T * 2 });
    await page.waitForFunction(() => {
      const r = (window as unknown as E2EWin).__solarEngineE2E?.racking?.() ?? [];
      return r.filter(m => m.arrayId === 'ga-alpha').length >= 4;
    }, undefined, { timeout: T });
    await page.waitForTimeout(2_000);

    const after = await engine(page);
    expectStillAligned({ rack: rackA0, mods: modsA0 },
      { rack: rackOf(after.racking, A), mods: byId(after.assemblies, A).modules }, 'view switch, A');
    expectStillAligned({ rack: rackB0, mods: modsB0 },
      { rack: rackOf(after.racking, B), mods: byId(after.assemblies, B).modules }, 'view switch, B');
    // 🚨 TWO MOUNTS, TWO SEPARATE STRUCTURES. Before the key namespace was passed to the rebuild
    // both mounts re-solved into the SAME keys and the second deleted the first's pylons.
    expect(rackOf(after.racking, A).length, 'mount A lost structure across the view switch')
      .toBe(rackA0.length);
    expect(rackOf(after.racking, B).length, 'mount B lost structure across the view switch')
      .toBe(rackB0.length);
  });

  test('duplicate gives the copy its OWN structure; delete takes the whole mount away', async ({ page }) => {
    await boot(page);
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await expect(page.getByTestId('ground-mount-inspector')).toBeVisible({ timeout: T });

    const before = await engine(page);
    const rackA0 = rackOf(before.racking, A);

    await page.getByTestId('ground-mount-duplicate').click();
    await page.waitForTimeout(1_500);

    const dup = await engine(page);
    const newIds = dup.assemblies.map(a => a.arrayId).filter(id => id !== A && id !== B);
    expect(newIds.length, 'duplicate did not create a third assembly').toBe(1);
    const C = newIds[0];
    const rackC = rackOf(dup.racking, C);
    // 🚨 "no shared mutable child identity with the original."
    expect(rackC.length, `the duplicated mount has no structure of its own (${rackC.length} members)`)
      .toBeGreaterThan(3);
    const sharedKeys = rackC.filter(m => rackA0.some(o => o.key === m.key));
    expect(sharedKeys.length,
      `the copy shares ${sharedKeys.length} structural entity keys with the original: `
      + sharedKeys.map(m => m.key).join(', '))
      .toBe(0);
    expect(rackOf(dup.racking, A).length, 'duplicating stole the original mount\'s structure')
      .toBe(rackA0.length);
    // The copy is geometrically identical to the original, so its structure must sit under its
    // own modules exactly as the original's does. Compared against the ORIGINAL's fingerprint,
    // not against itself — a self-comparison would pass for any arrangement whatsoever.
    expectStillAligned(
      { rack: rackA0, mods: byId(before.assemblies, A).modules },
      { rack: rackC, mods: byId(dup.assemblies, C).modules }, 'the duplicated mount');

    // ── DELETE the copy (it is the selected one) ────────────────────────────
    await page.getByTestId('ground-mount-delete').click();
    await page.waitForTimeout(1_500);

    const gone = await engine(page);
    expect(gone.assemblies.map(a => a.arrayId)).not.toContain(C);
    // 🚨 "No orphan rails/posts."
    expect(rackOf(gone.racking, C).length,
      `${rackOf(gone.racking, C).length} structural members of the deleted mount are still `
      + 'standing in the scene').toBe(0);
    // ...and the mounts that were not deleted kept theirs.
    expect(rackOf(gone.racking, A).length, 'deleting the copy removed the original\'s structure')
      .toBe(rackA0.length);
  });
});
