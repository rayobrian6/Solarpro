/**
 * tests/dragToSizeSiteObject.test.ts
 *
 * TRACE THE TREE OFF THE PHOTOGRAPH INSTEAD OF REMEMBERING ITS WIDTH.
 *
 * Aurora's tree flow is ONE gesture: "place your cursor on the center of the
 * tree, then click, hold and drag until the circle is approximately the same
 * size as the tree in the satellite imagery" (30YIHPdAI0g @00:04). The
 * installer never types a dimension — they match what they can see, and the
 * size is right by construction because it was traced off the evidence.
 *
 * SolarPro made them type width, depth and height into a panel FIRST and then
 * click: guess the number before looking at the thing.
 *
 * Four things this guards:
 *
 * 1. 🚨 NO SECOND PLACEMENT PATH. The drag sets the armed size and then calls
 *    `handleObstructionClick` — the same function the click path calls. A
 *    drag that built its own record would be a second creation path, and this
 *    file has that failure recorded against it more than once.
 *
 * 2. 🚨 NO SECOND INPUT REGISTRATION. `setInputAction` is a plain assignment
 *    into a keyed map, so a second LEFT_DOWN/MOUSE_MOVE/LEFT_UP trio would
 *    SILENTLY DELETE the panel-array grab and the block-height drag. The
 *    branches must live INSIDE the existing handlers.
 *    (See tests/screenSpaceHandlerRegistration.test.ts, which exists because
 *    that already happened once.)
 *
 * 3. A short press must still be an ordinary click at the armed size. Cesium
 *    only synthesises LEFT_CLICK when the pointer moved within its 5 px
 *    tolerance, so the two gestures cannot both fire — but a drag produces NO
 *    click, so it must be committed on mouse-up or it silently does nothing.
 *
 * 4. The preview is PINNED at the anchor while dragging. A circle that both
 *    follows the pointer and grows is not a radius.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'));
const CURSOR = stripComments(readFileSync(join(ROOT, 'components', '3d', 'tree', 'TreeCursor.tsx'), 'utf8'));

/** The body of setupClickHandler, where all three gesture branches live. */
function clickHandler(): string {
  const i = ENGINE.indexOf('function setupClickHandler(');
  expect(i, 'setupClickHandler was not found').toBeGreaterThan(-1);
  const end = ENGINE.indexOf('function setupHoverHandler(', i);
  expect(end).toBeGreaterThan(i);
  return ENGINE.slice(i, end);
}

describe('🚨 the gesture did not add a second input registration', () => {
  const H = clickHandler();

  it('there is still exactly one LEFT_DOWN, one LEFT_UP and one MOUSE_MOVE here', () => {
    // A second registration for the same event is a plain overwrite in Cesium,
    // so this count IS the guard against silently deleting the array grab.
    for (const ev of ['LEFT_DOWN', 'LEFT_UP', 'MOUSE_MOVE']) {
      const n = (H.match(new RegExp(`ScreenSpaceEventType\\.${ev}\\b`, 'g')) || []).length;
      expect(n, `${ev} is registered ${n} times on one handler — a second one deletes the first`)
        .toBe(1);
    }
  });

  it('and only one ScreenSpaceEventHandler is constructed in it', () => {
    const n = (H.match(/new C\.ScreenSpaceEventHandler\(/g) || []).length;
    expect(n).toBe(1);
  });
});

describe('the drag arms, grows and commits', () => {
  const H = clickHandler();

  /**
   * The LEFT_DOWN registration only.
   *
   * 🚨 SCOPED, BECAUSE `if (modeRef.current !== 'select') return;` APPEARS
   * IN SEVERAL HANDLERS. A whole-file indexOf finds the FIRST one, which lives
   * in a different registration entirely, and the ordering assertion then
   * compares two unrelated positions — it fails on correct code and would pass
   * on broken code just as easily.
   */
  function leftDown(): string {
    const end = H.indexOf('C.ScreenSpaceEventType.LEFT_DOWN');
    expect(end, 'the LEFT_DOWN registration was not found').toBeGreaterThan(-1);
    const start = H.lastIndexOf('handler.setInputAction((event: any) => {', end);
    expect(start).toBeGreaterThan(-1);
    return H.slice(start, end);
  }

  it('🚨 LEFT_DOWN takes the camera, or the map slides under the gesture', () => {
    // The omission that made this feature fail live acceptance. The full
    // ownership contract — one writer, released in a finally, cleared on
    // Escape/tool-change/reset — is guarded in
    // tests/pointerGestureAuthority.test.ts; this is the local reminder that
    // THIS gesture is one of the claimants.
    expect(leftDown()).toMatch(/claimPointer\('object-size'\)/);
  });

  it('LEFT_DOWN arms only for a GROUND object, and only in a placing mode', () => {
    const D = leftDown();
    expect(D).toMatch(/modeRef\.current === 'tree' \|\| modeRef\.current === 'obstruction'/);
    expect(D, "a roof object is sized against a face — a different gesture")
      .toMatch(/if \(pre\.space === 'site'\)/);
    // Armed BEFORE the select-only guard, or it could never fire.
    const arm = D.indexOf("modeRef.current === 'tree' || modeRef.current === 'obstruction'");
    const selectGuard = D.indexOf("if (modeRef.current !== 'select') return;");
    expect(arm).toBeGreaterThan(-1);
    expect(selectGuard, 'the select-only guard is not in this handler any more')
      .toBeGreaterThan(-1);
    expect(arm, 'the site-object branch must precede the select-only guard')
      .toBeLessThan(selectGuard);
  });

  it('it does not steal the press from the block-height drag', () => {
    const D = leftDown();
    const arm = D.indexOf("modeRef.current === 'tree' || modeRef.current === 'obstruction'");
    const block = D.indexOf('if (blockResizeRef.current) return;');
    expect(block).toBeGreaterThan(-1);
    expect(block, 'blockResize must get first refusal, as it does in every mode')
      .toBeLessThan(arm);
  });

  it('MOUSE_MOVE writes the ARMED size, which is what the preview reads', () => {
    expect(H).toMatch(/setNewObstructionWidthM\(wM\)/);
    expect(H).toMatch(/setNewObstructionDepthM\(wM\)/);
    // Radius is ground distance from the anchor, in metres, at this latitude.
    expect(H).toMatch(/111_320 \* Math\.cos\(\(sz\.lat \* Math\.PI\) \/ 180\)/);
    expect(H, 'the drawn circle is a radius, so the object is twice it')
      .toMatch(/radiusM \* 2/);
  });

  it('it clamps to the PRESET range rather than inventing limits', () => {
    expect(H).toMatch(/pre\.maxFootprintM \?\? 30/);
    expect(H).toMatch(/pre\.minFootprintM \?\? 0\.5/);
  });

  it('a movement under the threshold stays a click', () => {
    // Same 6 px the array drag uses, so the two gestures agree on what a
    // click is.
    expect(H).toMatch(/if \(!sz\.dragged && Math\.hypot\(dx, dy\) < 6\) return;/);
  });

  it('🚨 LEFT_UP commits through the ONE placement path, at the anchor', () => {
    // 🚨 THIS ASSERTION USED TO PIN THE DEFECT.
    //
    // It required the commit to be `handleObstructionClick(viewer, C, {x, y})`
    // — a re-intersection of the SCREEN PIXEL that was pressed. A pixel names
    // different ground the moment the camera moves, and the camera DID move,
    // because this gesture shipped without freezing it. So the tree was
    // committed away from the point the installer aimed at, and this test
    // called that correct and would have failed the repair.
    //
    // The press now captures the resolved world point and hands it to the same
    // one placement path, so nothing is intersected twice. The guard's real
    // subject — "the drag must not build its own record" — is unchanged and is
    // what the `sz.spot` argument preserves.
    // See tests/pointerGestureAuthority.test.ts for the ownership half.
    expect(H, 'the drag must not build its own record')
      .toMatch(/handleObstructionClick\(viewer, C, \{ x: sz\.screenX, y: sz\.screenY \}, sz\.spot\)/);
    // Only when it really was a drag; otherwise the real click does the work.
    expect(H).toMatch(/if \(sz\.dragged\) \{/);
    expect(H, 'a trailing click would place a second object')
      .toMatch(/suppressClickRef\.current = true;/);
  });

  it('the drag state is always cleared on mouse-up, drag or not', () => {
    const i = H.indexOf('const sz = objectSizeDragRef.current;', H.indexOf('LEFT_UP') - 4000);
    const up = H.slice(H.lastIndexOf('const sz = objectSizeDragRef.current;'));
    expect(up).toMatch(/objectSizeDragRef\.current = null;/);
    expect(up, 'a stuck anchor pins the preview for ever')
      .toMatch(/setObjectDragAnchor\(null\);/);
    void i;
  });
});

describe('the preview is pinned while the radius grows', () => {
  it('the engine hands the anchor to the cursor', () => {
    expect(ENGINE).toMatch(/anchorLngLat=\{objectDragAnchor\}/);
  });

  it('TreeCursor honours it through a ref, not a stale closure', () => {
    expect(CURSOR).toMatch(/anchorLngLat\?: \{ lng: number; lat: number \} \| null;/);
    expect(CURSOR).toMatch(/anchorRef\.current = anchorLngLat;/);
    // The MOUSE_MOVE handler inside TreeCursor is created once, so it must read
    // the ref rather than the prop it captured.
    expect(CURSOR).toMatch(/const a = anchorRef\.current;/);
    expect(CURSOR).toMatch(/\? C\.Cartesian3\.fromDegrees\(a\.lng, a\.lat, 0\)/);
  });

  it('with no anchor it still follows the cursor', () => {
    expect(CURSOR).toMatch(/: C\.Cartesian3\.fromDegrees\(lng, lat, 0\);/);
  });
});
