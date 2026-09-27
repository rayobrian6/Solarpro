/**
 * e2e/ground-mount-is-one-object.spec.ts
 *
 * 🚨 RAY'S LIVE ACCEPTANCE LIST, IN A REAL BROWSER, WITH REAL MOUSE INPUT.
 *
 * His report, after a data-layer repair had been offered as closing this: "A placed ground mount
 * is still treated as fragmented rows. I can select only one row at a time. I cannot select the
 * entire ground mount as one object. I cannot move the entire ground mount." And the standard:
 * "Do not close this with source tests." / "If you cannot perform those actions in the real
 * browser, the feature is not fixed." / "My live report outranks the green tests."
 *
 * So every step below is a genuine `page.mouse` event at the pixel where the module is drawn —
 * the screen position is computed through Cesium's own `cartesianToCanvasCoordinates`, and the
 * click then goes through the engine's real LEFT_DOWN / MOUSE_MOVE / LEFT_UP handlers, its real
 * pointer authority, and its real pick (whose analytic fallback exists precisely because a
 * software rasteriser returns zero GPU hits).
 *
 * WHAT IS SEEDED AND WHY. The mount itself is seeded through the studio's existing `seedDesign`
 * bridge, because placing one needs two clicks on TERRAIN and terrain picking needs a rasterised
 * scene. That is the same accommodation `pickHouse` documents — "the browser path to that click
 * needs WebGL … the BEHAVIOUR being tested is what happens after". The behaviour under test here
 * is SELECTION and MANIPULATION, and all of that is driven for real.
 *
 * TWO MOUNTS ARE ALWAYS PRESENT, so every assertion about one is also an assertion that the
 * other did not move or get selected — which is the second half of what Ray asked to be proved.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;
const MPD = 111_320;

const SITE = { lat: 38.6657, lng: -90.2266 };   // the quick-launch demo project
const TILT = 20;
const PANEL_W = 1.134, PANEL_H = 1.722;
const CLEARANCE = 0.6096;
const GROUND_Z = 140;

type Mod = { id: string; lat: number; lng: number; height: number; row: number; col: number; tilt: number; azimuth: number };
type Assembly = { arrayId: string; modules: Mod[] };
type E2EWin = Window & {
  __solarE2E?: { panels?: unknown[]; seedDesign?: (d: { panels?: unknown[] }) => void };
  __solarViewerE2E?: unknown;
  __solarEngineE2E?: {
    selection?: () => { groundArrayId: string | null; panelIds: string[] };
    assemblies?: () => Assembly[];
  };
};

/** A ground mount on the deterministic grid, offset `eastM` metres from the site. */
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
/** A is 2x4; B is 2x3, well clear to the east. */
const SEED = [...mount(A, 2, 4, 0), ...mount(B, 2, 3, 30)];

const engine = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as E2EWin).__solarEngineE2E;
  return {
    selection: e?.selection?.() ?? { groundArrayId: null, panelIds: [] },
    assemblies: e?.assemblies?.() ?? [],
  };
});

/** Where a module is drawn on screen, via Cesium's own projection. Null if off-screen. */
async function screenOf(page: Page, moduleId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((id) => {
    const w = window as unknown as E2EWin & { Cesium?: any };
    const v = w.__solarViewerE2E as any;
    const C = (window as any).Cesium;
    if (!v || !C) return null;
    const mods = (w.__solarEngineE2E?.assemblies?.() ?? []).flatMap(a => a.modules);
    const m = mods.find(x => x.id === id);
    if (!m) return null;
    const cart = C.Cartesian3.fromDegrees(m.lng, m.lat, m.height);
    const px = v.scene.cartesianToCanvasCoordinates(cart);
    if (!px) return null;
    const rect = v.canvas.getBoundingClientRect();
    return { x: Math.round(rect.left + px.x), y: Math.round(rect.top + px.y) };
  }, moduleId);
}

const metresBetween = (a: Mod, b: Mod) => {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * MPD, (a.lng - b.lng) * MPD * cosLat);
};
const byId = (as: Assembly[], arrayId: string) => as.find(a => a.arrayId === arrayId)!;
const mod = (as: Assembly[], arrayId: string, id: string) =>
  byId(as, arrayId).modules.find(m => m.id === id)!;

/** Every pairwise distance inside one assembly — what a rigid transform must preserve. */
function shape(a: Assembly): number[] {
  const out: number[] = [];
  const ms = [...a.modules].sort((x, y) => x.id.localeCompare(y.id));
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) out.push(metresBetween(ms[i], ms[j]));
  }
  return out;
}
function expectRigid(before: Assembly, after: Assembly, what: string, tolM = 0.02) {
  const sb = shape(before), sa = shape(after);
  expect(sa.length, `${what}: module count changed`).toBe(sb.length);
  sb.forEach((d, i) => {
    expect(Math.abs(sa[i] - d),
      `${what}: internal distance ${i} changed by ${((sa[i] - d) * 1000).toFixed(1)} mm — the rows did not stay together`)
      .toBeLessThan(tolM);
  });
}
function expectUntouched(before: Assembly, after: Assembly, what: string) {
  for (const b of before.modules) {
    const a = after.modules.find(m => m.id === b.id);
    expect(a, `${what}: ${b.id} disappeared`).toBeTruthy();
    expect(metresBetween(b, a!), `${what}: ${b.id} moved`).toBeLessThan(0.001);
  }
}

/**
 * Point the camera at an assembly so its modules are actually on screen.
 *
 * 🚨 NEEDED, AND MEASURED: the quick-launch project boots its camera on the demo address's
 * own framing, and the seeded mount projected to screen y = -443 — above the canvas. A click at
 * that pixel lands on the page header, selects nothing, and reads exactly like "clicking a module
 * does not select the mount". The camera move is a TEST-SIDE action standing in for the operator
 * scrolling to their array; nothing about the product's selection path is bypassed by it.
 */
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

/**
 * The screen position of the assembly's LEFTMOST on-screen module, and the module's id.
 *
 * 🚨 NOT JUST ANY MODULE. The ground-mount inspector renders at `right: 12, top: 96,
 * width: 248`, so it covers the right-hand strip of the canvas — and a `page.mouse` press at a
 * pixel under it lands on the PANEL, not the scene. That is exactly how this spec failed
 * intermittently: it passed when the framing put the mount left of the inspector and failed with
 * "the drag moved the mount less than 10 cm" when it did not. Pressing on the leftmost module
 * keeps the gesture on the canvas, and the assertion below refuses a pixel that is still covered
 * rather than producing another mystery zero.
 */
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
      // On canvas, with a margin so the press cannot clip an edge.
      if (px.x < 20 || px.y < 20 || px.x > rect.width - 20 || px.y > rect.height - 20) continue;
      if (!best || px.x < best.x - rect.left) {
        best = { x: Math.round(rect.left + px.x), y: Math.round(rect.top + px.y), id: m.id };
      }
    }
    return best ? { ...best, canvas: { l: rect.left, t: rect.top, w: rect.width, h: rect.height } } : null;
  }, arrayId);
  if (!pick) return null;
  // The inspector's own rectangle, from its style: right 12, top 96, width 248, ~210 tall.
  const c = pick.canvas;
  const insLeft = c.l + c.w - 12 - 248;
  const covered = pick.x >= insLeft && pick.y >= c.t + 96 && pick.y <= c.t + 96 + 210;
  if (covered) return null;
  return { x: pick.x, y: pick.y, id: pick.id };
}

/**
 * The same, but CONVERGING. The first boot of a cold dev server can run `camera.setView` before
 * the scene is ready to project, and the modules then report no canvas position at all — which
 * failed this spec as "the camera is not framing it" on the first test only, while the later ones
 * passed on a warm server. So it re-frames and re-asks a few times, and only then gives up with a
 * message that says which of the two problems it hit.
 */
async function pressPointFor(page: Page, arrayId: string): Promise<{ x: number; y: number; id: string }> {
  let last: Awaited<ReturnType<typeof pressPointOnce>> = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    last = await pressPointOnce(page, arrayId);
    if (last) return last;
    await frameAssembly(page, arrayId);
    await page.waitForTimeout(700);
  }
  expect(last,
    `after 5 attempts no module of ${arrayId} could be pressed: it is either off-canvas (the `
    + 'camera never framed it) or every on-screen module is under the ground-mount inspector, '
    + 'where a mouse event would hit the panel rather than the scene').toBeTruthy();
  return last!;
}

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
    undefined, { timeout: T });
  await page.evaluate(p => { (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p }); }, SEED);
  await page.waitForFunction(n => ((window as unknown as E2EWin).__solarE2E?.panels?.length ?? 0) === n,
    SEED.length, { timeout: T });
  // 🚨 WAIT ON THE ENGINE HOOK, NOT ON THE STATUS TEXT. The status line is transient —
  // the boot message is overwritten by the next thing that happens (a render, a click), so a spec
  // that waits for it passes or fails on timing. The hook publishes at `stage === 'done'`, which
  // is exactly the condition that matters here: the scene can be projected and the selection can
  // be read. An earlier version waited on the text and three of four tests failed at boot.
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.assemblies,
    undefined, { timeout: T * 2 });
  await page.waitForFunction(n => ((window as unknown as E2EWin).__solarEngineE2E
    ?.assemblies?.() ?? []).reduce((s, a) => s + a.modules.length, 0) === n,
    SEED.length, { timeout: T });
  await page.waitForTimeout(1_500);
  // Put mount A in frame — the click below is a real pixel click and needs the modules drawn.
  await frameAssembly(page, A);
}

test.describe("a ground mount is one object the operator can use", () => {
  test.setTimeout(T * 5);

  test('click selects the WHOLE mount, drag moves it rigidly, and the other mount is untouched', async ({ page }) => {
    await boot(page);

    const start = await engine(page);
    expect(start.assemblies.map(a => a.arrayId).sort(), 'the two seeded mounts are not both present')
      .toEqual([A, B].sort());
    expect(byId(start.assemblies, A).modules).toHaveLength(8);
    expect(byId(start.assemblies, B).modules).toHaveLength(6);

    // ── STEP 2-3: click one module of mount A ────────────────────────────────
    // A real click, at the pixel where that module is drawn.
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(600);

    const afterClick = await engine(page);
    expect(afterClick.selection.groundArrayId,
      'clicking a module did not select the ground mount as an assembly').toBe(A);
    expect(afterClick.selection.panelIds.length,
      `only ${afterClick.selection.panelIds.length} module(s) selected — a 2x4 mount is 8, and one ROW would be 4`)
      .toBe(8);
    // 🚨 THE ORIGINAL SYMPTOM: one row at a time. Both rows must be in the selection.
    const selRows = new Set(byId(afterClick.assemblies, A).modules
      .filter(m => afterClick.selection.panelIds.includes(m.id)).map(m => m.row));
    expect([...selRows].sort(), 'the selection does not span both rows').toEqual([0, 1]);
    // And nothing of mount B is selected.
    for (const m of byId(afterClick.assemblies, B).modules) {
      expect(afterClick.selection.panelIds.includes(m.id),
        `selecting mount A also selected ${m.id} of mount B`).toBe(false);
    }

    // The contextual panel must NAME it — Ray: "the contextual panel should identify it as a
    // ground mount and expose the applicable controls".
    await expect(page.getByTestId('ground-mount-inspector')).toBeVisible({ timeout: T });
    await expect(page.getByTestId('ground-mount-title')).toContainText('Ground Mount');
    await expect(page.getByTestId('ground-mount-summary')).toContainText('2 rows');
    await expect(page.getByTestId('ground-mount-summary')).toContainText('8 modules');
    for (const control of ['ground-mount-azimuth', 'ground-mount-tilt', 'ground-mount-row-pitch',
      'ground-mount-duplicate', 'ground-mount-delete']) {
      await expect(page.getByTestId(control), `${control} is missing from the inspector`).toBeVisible();
    }

    // ── STEP 4-5: drag it, and BOTH ROWS must move together rigidly ──────────
    const beforeDrag = await engine(page);
    // Re-resolved AFTER the click, because the inspector has appeared since and may now cover
    // the pixel that was pressed a moment ago.
    const from = await pressPointFor(page, A);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Several steps, because the gesture arms on movement and the camera must stay frozen.
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(from.x + i * 9, from.y + i * 5);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(800);

    const afterDrag = await engine(page);
    const aBefore = byId(beforeDrag.assemblies, A), aAfter = byId(afterDrag.assemblies, A);
    const moved = metresBetween(aBefore.modules[0], aAfter.modules.find(m => m.id === aBefore.modules[0].id)!);
    expect(moved, 'the drag moved the mount less than 10 cm — it did not take').toBeGreaterThan(0.1);
    // Every module moved by the SAME amount: that is what rigid means.
    for (const b of aBefore.modules) {
      const a = aAfter.modules.find(m => m.id === b.id)!;
      const d = metresBetween(b, a);
      expect(Math.abs(d - moved),
        `${b.id} moved ${d.toFixed(3)} m while ${aBefore.modules[0].id} moved ${moved.toFixed(3)} m — not rigid`)
        .toBeLessThan(0.05);
    }
    expectRigid(aBefore, aAfter, 'drag-move');
    // 🚨 And mount B did not budge.
    expectUntouched(byId(beforeDrag.assemblies, B), byId(afterDrag.assemblies, B), 'drag-move of A');
  });

  test('rotate turns both rows about ONE origin, and the other mount is untouched', async ({ page }) => {
    await boot(page);
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await expect(page.getByTestId('ground-mount-inspector')).toBeVisible({ timeout: T });

    const before = await engine(page);
    // Driven through the inspector's azimuth field: deterministic, and the same pure rotation the
    // ⟳ knob applies (both call rotateAssembly about the assembly anchor).
    const az = page.getByTestId('ground-mount-azimuth');
    await az.fill('210');
    await az.blur();
    await page.waitForTimeout(900);

    const after = await engine(page);
    const aB = byId(before.assemblies, A), aA = byId(after.assemblies, A);
    // Every module now faces the new azimuth — the modules turn with the structure.
    for (const m of aA.modules) expect(m.azimuth, `${m.id} did not turn with the assembly`).toBe(210);
    // 🚨 ONE origin: the shape is preserved and the anchor did not move.
    expectRigid(aB, aA, 'rotate');
    const anchorBefore = mod(before.assemblies, A, `${A}-p0-0`);
    const anchorAfter = mod(after.assemblies, A, `${A}-p0-0`);
    expect(metresBetween(anchorBefore, anchorAfter),
      'the pivot moved — the rows were not rotated about a shared parent origin').toBeLessThan(0.05);
    // ...and something actually turned.
    const far = `${A}-p1-3`;
    expect(metresBetween(mod(before.assemblies, A, far), mod(after.assemblies, A, far)),
      'the far corner did not move, so nothing rotated').toBeGreaterThan(0.3);
    expectUntouched(byId(before.assemblies, B), byId(after.assemblies, B), 'rotate of A');
  });

  test('after 3D → 2D → 3D it is still ONE selectable, movable mount', async ({ page }) => {
    await boot(page);
    const before = await engine(page);

    const view = page.getByRole('button', { name: /3D View|2D Map/ });
    await view.click();
    await expect(page.getByRole('button', { name: /2D Map/ })).toBeVisible({ timeout: T });
    await page.waitForTimeout(1_500);          // let the 3D component actually unmount
    await view.click();
    await expect(page.getByRole('button', { name: /3D View/ })).toBeVisible({ timeout: T });
    await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.assemblies,
      undefined, { timeout: T * 2 });
    await page.waitForTimeout(2_500);

    // Geometry survived (this is the property the earlier persistence fix bought)...
    const after = await engine(page);
    expectUntouched(byId(before.assemblies, A), byId(after.assemblies, A), 'view switch, mount A');
    expectUntouched(byId(before.assemblies, B), byId(after.assemblies, B), 'view switch, mount B');

    // ...and it is STILL ONE OBJECT, which is the part that failed live.
    await frameAssembly(page, A);
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(600);
    const sel = await engine(page);
    expect(sel.selection.groundArrayId, 'after a view switch the mount is no longer one assembly').toBe(A);
    expect(sel.selection.panelIds.length, 'after a view switch only part of the mount selects').toBe(8);
    await expect(page.getByTestId('ground-mount-title')).toContainText('Ground Mount');
  });

  test('duplicate makes a second independent mount; delete removes only the selected one', async ({ page }) => {
    await boot(page);
    const hit = await pressPointFor(page, A);
    await page.mouse.click(hit.x, hit.y);
    await expect(page.getByTestId('ground-mount-inspector')).toBeVisible({ timeout: T });

    await page.getByTestId('ground-mount-duplicate').click();
    await page.waitForTimeout(900);

    const dup = await engine(page);
    expect(dup.assemblies).toHaveLength(3);
    const newId = dup.assemblies.map(a => a.arrayId).find(id => id !== A && id !== B)!;
    expect(newId, 'the duplicate did not get its own assembly id').toBeTruthy();
    expect(byId(dup.assemblies, newId).modules).toHaveLength(8);
    // The copy is selected, so "duplicate then drag it" works.
    expect(dup.selection.groundArrayId, 'the duplicate is not the selected assembly').toBe(newId);
    // The original is unchanged and still its own object.
    expect(byId(dup.assemblies, A).modules).toHaveLength(8);

    // Delete the copy — and only the copy.
    await page.getByTestId('ground-mount-delete').click();
    await page.waitForTimeout(900);
    const gone = await engine(page);
    expect(gone.assemblies.map(a => a.arrayId).sort(),
      'delete removed the wrong assembly, or more than one').toEqual([A, B].sort());
    expect(byId(gone.assemblies, A).modules).toHaveLength(8);
    expect(byId(gone.assemblies, B).modules).toHaveLength(6);
  });
});
