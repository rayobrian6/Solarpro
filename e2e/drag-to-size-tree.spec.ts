/**
 * e2e/drag-to-size-tree.spec.ts
 *
 * DRAG THE TREE TO THE SIZE OF THE TREE — AND PUT IT WHERE IT WAS AIMED.
 *
 * Aurora's flow is one gesture: "click, hold and drag until the circle is
 * approximately the same size as the tree in the satellite imagery"
 * (30YIHPdAI0g @00:04). SolarPro made the installer type width, depth and
 * height first, then click: guess the number before looking at the thing.
 *
 * 🚨 THIS FILE FAILED ITS REAL ACCEPTANCE ONCE AND HAS BEEN REWRITTEN.
 *
 * The first version drove the gesture and asserted only that the resulting
 * object was BIGGER than the default. It passed. In the live product the map
 * panned under the gesture and the tree landed somewhere other than where the
 * installer pressed — because the drag never took the pointer from the custom
 * camera controller, and because the release re-intersected the SCREEN PIXEL
 * rather than committing at the point the press had already resolved. A pixel
 * names different ground once the camera has moved.
 *
 * Neither fact was observable through a size assertion, so the spec was
 * satisfied by a broken feature. What it now asserts is the contract the user
 * actually experiences:
 *
 *   1. the camera does not move while the tool owns the drag
 *      (with a CONTROL that proves the camera measurement can fail)
 *   2. the object is committed at the point that was pressed
 *   3. the object is the size the preview promised before release
 *   4. every way of abandoning the gesture gives the camera back
 *
 * (4) matters as much as (1): a camera left frozen is worse than the bug being
 * fixed, because the user's only recovery is a reload.
 */

import { test, expect, Page } from '@playwright/test';

type E2EWin = Window & {
  __solarE2E?: any;
  __solarViewerE2E?: any;
  __solarEngineE2E?: any;
};

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

const objects = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.placedObstructions ?? []) as any[]);

/** The live anchor of an in-flight size drag, or null. Read-only. */
const anchor = (p: Page) =>
  p.evaluate(() => (window as E2EWin).__solarEngineE2E?.sizeDragAnchor?.() ?? null);

/**
 * The REAL camera pose, read off the viewer the user is looking at.
 *
 * Deliberately not the engine's internal orbit state: the question is whether
 * the picture moved, and the camera is the thing that makes the picture.
 */
async function camera(p: Page) {
  return p.evaluate(() => {
    const v = (window as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    const c = v.camera.positionCartographic;
    return {
      lat: C.Math.toDegrees(c.latitude),
      lng: C.Math.toDegrees(c.longitude),
      h: c.height,
      heading: v.camera.heading,
      pitch: v.camera.pitch,
    };
  });
}

/** Ground distance in metres between two lat/lng points. */
function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * mPerDegLat, (b.lng - a.lng) * mPerDegLng);
}

/** How far the camera moved, in metres over the ground plus its height change. */
function cameraMoved(a: any, b: any) {
  return metresApart(a, b) + Math.abs(b.h - a.h);
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

test.describe('sizing a site object by dragging it out', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
    await page.locator('body').press('t');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');
  });

  test('🚨 THE REPORTED FAILURE: the camera does not move during the drag', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    const before = await camera(page);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (const f of [0.25, 0.5, 0.75, 1]) {
      await page.mouse.move(cx + 140 * f, cy + 140 * f, { steps: 4 });
    }
    const during = await camera(page);
    await page.mouse.up();
    const after = await camera(page);

    // A 140 px drag at this zoom pans the map many metres if the camera is
    // still listening. This is exactly what was reported from live use.
    expect(cameraMoved(before, during),
      'the map moved while the tree was being sized — the camera and the tool are both driving the drag')
      .toBeLessThan(0.5);
    expect(cameraMoved(before, after),
      'the camera moved by the end of the gesture').toBeLessThan(0.5);
  });

  test('CONTROL: an ordinary drag in select mode DOES move the camera', async ({ page }) => {
    // 🚨 WITHOUT THIS, THE TEST ABOVE IS UNFALSIFIABLE. If the camera could
    // never move under a Playwright drag — wrong event type, pointer capture
    // not working in this harness, anything — then "the camera did not move"
    // would pass on a completely broken build. This proves the measurement is
    // live before the other test is allowed to mean anything.
    await page.locator('body').press('Escape');
    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0);

    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.6, cy = b.y + b.height * 0.45;
    const before = await camera(page);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (const f of [0.25, 0.5, 0.75, 1]) {
      await page.mouse.move(cx - 140 * f, cy - 140 * f, { steps: 4 });
    }
    await page.mouse.up();

    const after = await camera(page);
    expect(cameraMoved(before, after),
      'a plain left-drag on empty canvas did not pan the camera — the control is dead, so the camera assertions above prove nothing')
      .toBeGreaterThan(1);
  });

  test('🚨 the tree is committed where the press landed, not where the pixel points', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 60, { steps: 4 });

    // The anchor the press resolved — the point the ghost is pinned to and the
    // point the object must end up at.
    const a = await anchor(page);
    expect(a, 'no anchor was captured on press').not.toBeNull();
    expect(a.dragged, 'the drag never armed').toBe(true);

    await page.mouse.move(cx + 130, cy + 130, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);

    const drift = metresApart(a, o);
    expect(drift,
      `the committed tree is ${drift.toFixed(2)} m from the point that was pressed — the release re-resolved the position instead of using the anchor`)
      .toBeLessThan(0.5);
  });

  test('🚨 the committed size is the size the preview promised', async ({ page }) => {
    // The ghost is a contract: what is on screen before release is what gets
    // made. The preview diameter is read from the status line the user is
    // actually looking at, not from engine internals.
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 150, { steps: 10 });

    const status = await page.getByTestId('engine-status').innerText().catch(() => '');
    const shown = /([\d.]+)\s*m across/.exec(status);
    await page.mouse.up();

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);

    if (shown) {
      const promised = parseFloat(shown[1]);
      expect(Math.abs(o.widthM - promised),
        `the preview said ${promised} m across and the tree came out ${o.widthM} m`)
        .toBeLessThan(0.15);
    } else {
      // The readout is how the promise is made visible. If it is gone, the
      // contract is unobservable to the user and that is itself the defect.
      throw new Error(`no size readout during the drag — status was: ${JSON.stringify(status)}`);
    }

    // Round object: both footprint axes and the shading canopy agree.
    expect(o.depthM).toBeCloseTo(o.widthM, 3);
    expect(o.canopyRadiusM).toBeCloseTo(o.widthM / 2, 2);
  });

  test('a short press still places at the armed size', async ({ page }) => {
    const b = await canvasBox(page);
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.55);

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);
    expect(o.type).toBe('tree');
    expect(o.widthM).toBeCloseTo(6, 1);
  });

  test('a very long drag clamps to the preset range, not to an invented limit', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.25, cy = b.y + b.height * 0.3;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (const f of [0.3, 0.6, 1]) {
      await page.mouse.move(cx + b.width * 0.6 * f, cy + b.height * 0.6 * f, { steps: 8 });
    }
    await page.mouse.up();

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);
    expect(o.widthM).toBeLessThanOrEqual(30);
    expect(o.widthM).toBeGreaterThanOrEqual(1);
  });

  test('one gesture makes exactly one object', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.45, cy = b.y + b.height * 0.5;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 90, cy + 90, { steps: 8 });
    await page.mouse.up();

    // 🚨 THE TRAILING CLICK. If the suppression is wrong, mouse-up commits and
    // then a synthesised LEFT_CLICK commits AGAIN, and the installer gets two
    // trees for one gesture — which looks like a double-click habit, not a bug.
    await page.waitForTimeout(1200);
    expect((await objects(page)).length, 'the gesture produced more than one object').toBe(1);
  });
});

/**
 * 🚨 EVERY WAY OF ABANDONING THE GESTURE MUST HAND THE CAMERA BACK.
 *
 * A drag normally ends with a mouse-up. It can also end with Escape, with a
 * tool change, or with a press that resolved no ground at all. None of those
 * produce a LEFT_UP, and each one used to leave the drag armed. With the camera
 * freeze added, an unreleased drag means a map that cannot be moved again —
 * strictly worse than the defect being repaired, so each path gets its own test.
 */
test.describe('the camera always comes back', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
  });

  /**
   * Drag on BARE canvas in select mode and report how far the camera went.
   *
   * 🚨 IT ASSERTS THE POINT IS BARE FIRST. A first version dragged at 70%/30%
   * of the canvas and measured exactly 0 m every time — not because the camera
   * was frozen but because a floating panel sits over that corner and swallowed
   * the press. "The map is frozen" and "the press never reached the map" are
   * indistinguishable from the camera's point of view, and this codebase has
   * already lost a session to a panel silently covering canvas controls. So the
   * helper checks what is actually under the cursor and says so.
   */
  async function cameraStillWorks(page: Page) {
    const b = await canvasBox(page);
    const x = b.x + b.width * 0.6, y = b.y + b.height * 0.45;

    const onTop = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px as number, py as number);
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''}` : 'none';
    }, [x, y]);
    expect(onTop, `something is covering the canvas at the drag point: ${onTop}`).toBe('canvas');

    const before = await camera(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 140, y - 140, { steps: 6 });
    await page.mouse.up();
    return cameraMoved(before, await camera(page));
  }

  test('Escape mid-drag cancels the object and unfreezes the map', async ({ page }) => {
    await page.locator('body').press('t');
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 120, { steps: 6 });
    await page.locator('body').press('Escape');
    await page.mouse.up();

    expect(await anchor(page), 'the drag survived Escape').toBeNull();
    expect(await cameraStillWorks(page), 'the map is frozen after Escape during a drag')
      .toBeGreaterThan(1);
  });

  test('switching tool mid-drag unfreezes the map', async ({ page }) => {
    await page.locator('body').press('t');
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 120, { steps: 6 });
    await page.locator('body').press('m');            // straight to Measure
    await page.mouse.up();
    await page.locator('body').press('Escape');

    expect(await anchor(page), 'the drag survived the tool change').toBeNull();
    expect(await cameraStillWorks(page), 'the map is frozen after changing tool during a drag')
      .toBeGreaterThan(1);
  });

  test('the map still works normally right after a placement', async ({ page }) => {
    await page.locator('body').press('t');
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 120, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);

    await page.locator('body').press('Escape');
    expect(await cameraStillWorks(page), 'the map is frozen after a completed placement')
      .toBeGreaterThan(1);
  });

  test('repeated placements each leave the map usable', async ({ page }) => {
    const b = await canvasBox(page);
    for (let i = 0; i < 3; i++) {
      await page.locator('body').press('t');
      const cx = b.x + b.width * (0.3 + i * 0.12), cy = b.y + b.height * 0.5;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 70, cy + 70, { steps: 5 });
      await page.mouse.up();
      await page.locator('body').press('Escape');
    }
    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(3);
    expect(await cameraStillWorks(page), 'the map is frozen after three placements')
      .toBeGreaterThan(1);
  });

  test('dragging does not disturb the panel-array grab registration', async ({ page }) => {
    // The size drag lives inside the SAME LEFT_DOWN/MOUSE_MOVE/LEFT_UP trio as
    // the array grab. Proving the array tools still respond after a size drag
    // is the live counterpart of the source guard on registration counts.
    await page.locator('body').press('t');
    const b = await canvasBox(page);
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4 + 100, b.y + b.height * 0.55 + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);

    await page.locator('body').press('Escape');
    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0);
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.55);
    // The object inspector appearing proves LEFT_CLICK selection still works.
    await expect(page.getByTestId('obstruction-duplicate')).toBeVisible({ timeout: 15_000 });
  });
});
