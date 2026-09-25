/**
 * tests/pointerGestureAuthority.test.ts
 *
 * WHO OWNS THE DRAG — AND WHO GIVES IT BACK.
 *
 * 🚨 THIS FILE EXISTS BECAUSE THE SAME DEFECT SHIPPED THREE TIMES.
 *
 * SolarPro does not use Cesium's camera controller. It is switched off in full
 * at boot and replaced with a custom turntable driven by raw DOM pointer
 * events, where LEFT-DRAG PANS THE MAP. So any tool that also wants left-drag
 * is in direct competition with the camera, and the only thing that arbitrates
 * is one boolean the camera's move handler reads before it does anything.
 *
 * Three gestures have needed that boolean:
 *
 *   1. the panel-array grab — the camera panned WHILE the array moved. Fixed in
 *      v62; the symptom was called "the shear".
 *   2. the block-height drag — the freeze was written, but the drag was
 *      unreachable dead code, so nobody could tell whether it worked.
 *   3. the site-object size drag — shipped with NO freeze at all. The map slid
 *      under the gesture. Because a screen pixel names different ground once
 *      the camera has moved, the tree was then committed somewhere other than
 *      where it was aimed, and came out the wrong size too. Found by a person
 *      using the product. Every unit test and every browser test passed.
 *
 * The third one is the reason this is a test and not a comment. Two correct
 * examples in the same file did not stop the third gesture from omitting it,
 * because nothing checked. So ownership may now be taken and returned ONLY
 * through `claimPointer` / `releasePointer`, and this file fails the build if a
 * future gesture assigns the flag directly — which is the only way to make the
 * convention survive the next person who adds a drag.
 *
 * What it deliberately does NOT do: assert anything about
 * `screenSpaceCameraController`. Those flags are all set false once at boot and
 * never read again. A repair that toggled them would be a no-op that looked
 * exactly like a fix.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(
  readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);

/**
 * Body of a named function declaration, to its closing brace at column 2.
 *
 * 🚨 NOT A FIXED-LENGTH SLICE. `stripComments` blanks comments to WHITESPACE
 * rather than deleting them, so a fixed `slice(i, i + N)` shrinks in real code
 * every time someone adds a comment above the thing being asserted — which has
 * silently broken two guards in this suite already. Anchor on real syntax.
 */
function bodyOf(name: string): string {
  const i = ENGINE.indexOf(`function ${name}(`);
  expect(i, `function ${name} is gone — renamed or deleted`).toBeGreaterThan(-1);
  const end = ENGINE.indexOf('\n  }', i);
  expect(end, `could not find the end of ${name}`).toBeGreaterThan(i);
  return ENGINE.slice(i, end);
}

const count = (re: RegExp) => (ENGINE.match(re) || []).length;

describe('🚨 the camera flag has exactly one writer each way', () => {
  it('is set true in one place only', () => {
    // If this fails, a new gesture froze the camera by hand. Route it through
    // `claimPointer` instead: the point is that every claim is in the list.
    expect(count(/arrayManipRef\.current\s*=\s*true/g)).toBe(1);
  });

  it('is set false in one place only', () => {
    // If this fails, some path hands the camera back by hand — and the paths
    // that DON'T are the bug. `releasePointer` is idempotent so there is never
    // a reason to inline it.
    expect(count(/arrayManipRef\.current\s*=\s*false/g)).toBe(1);
  });

  it('and those two places are claimPointer and releasePointer', () => {
    expect(bodyOf('claimPointer')).toMatch(/arrayManipRef\.current\s*=\s*true/);
    expect(bodyOf('releasePointer')).toMatch(/arrayManipRef\.current\s*=\s*false/);
  });

  it('claimPointer also records WHO, so the owner is answerable', () => {
    // The boolean says "not the camera". The owner says which tool — without it
    // a stuck freeze cannot be attributed to the gesture that caused it.
    expect(bodyOf('claimPointer')).toMatch(/pointerOwnerRef\.current\s*=\s*who/);
    expect(bodyOf('releasePointer')).toMatch(/pointerOwnerRef\.current\s*=\s*null/);
  });

  it('the camera handler is still the only reader', () => {
    const reads = count(/if \(arrayManipRef\.current\) return;/g);
    expect(reads, 'the camera gate moved or was duplicated').toBe(1);
  });
});

describe('every drag gesture claims the pointer', () => {
  it('the panel array claims it to move and to rotate', () => {
    expect(ENGINE).toMatch(/claimPointer\('array-rotate'\)/);
    expect(ENGINE).toMatch(/claimPointer\('array-move'\)/);
  });

  it('the block-height drag claims it', () => {
    expect(ENGINE).toMatch(/claimPointer\('block-height'\)/);
  });

  it('🚨 the site-object size drag claims it — this is the one that shipped without', () => {
    expect(ENGINE).toMatch(/claimPointer\('object-size'\)/);
  });

  it('the size drag claims ONLY when a ground point actually resolved', () => {
    // A press that resolved nothing starts no drag. Freezing the camera there
    // would strand it: there is no gesture for LEFT_UP to end, and the user's
    // only recovery would be a reload.
    const i = ENGINE.indexOf("const at = resolvePlacementPoint(viewer, C, event.position, 'site');");
    expect(i).toBeGreaterThan(-1);
    const region = ENGINE.slice(i, i + 900);
    const guard = region.indexOf('if (at) {');
    const claim = region.indexOf("claimPointer('object-size')");
    expect(guard, 'the resolved-point guard is gone').toBeGreaterThan(-1);
    expect(claim, 'the size drag no longer claims the pointer').toBeGreaterThan(-1);
    expect(claim, 'the claim escaped the `if (at)` guard — an unresolved press would freeze the map')
      .toBeGreaterThan(guard);
  });
});

describe('🚨 and every gesture gives it back', () => {
  it('LEFT_UP releases in a finally, so no early return can keep it', () => {
    const up = ENGINE.indexOf('C.ScreenSpaceEventType.LEFT_UP');
    expect(up).toBeGreaterThan(-1);
    // Walk back to the start of this registration and take the whole body.
    const start = ENGINE.lastIndexOf('handler.setInputAction(() => {', up);
    expect(start).toBeGreaterThan(-1);
    const body = ENGINE.slice(start, up);
    expect(body, 'LEFT_UP no longer releases the pointer in a finally — one early return now freezes the map')
      .toMatch(/\}\s*finally\s*\{\s*releasePointer\(\);\s*\}/);
  });

  it('the block-height drag still releases in its own finally', () => {
    // It was the only gesture that got this right originally; it is the model
    // the rest of the handler was changed to match.
    const i = ENGINE.indexOf('blockResizeUp');
    expect(i).toBeGreaterThan(-1);
    const region = ENGINE.slice(i, i + 4_000);
    expect(region).toMatch(/finally\s*\{[^}]*releasePointer\(\)/);
  });

  it('Escape cancels a live size drag AND unfreezes the camera', () => {
    const esc = ENGINE.indexOf("if (e.key === 'Escape') {");
    expect(esc).toBeGreaterThan(-1);
    // Anchor on the real end of the Escape branch's preamble rather than a
    // fixed length: several branches below it return early.
    const region = ENGINE.slice(esc, ENGINE.indexOf('clearPanelSelection();', esc));
    expect(region, 'Escape leaves the drag armed').toMatch(/cancelObjectSizeDrag\(\);/);
    expect(region, 'Escape leaves the camera frozen').toMatch(/releasePointer\(\);/);
  });

  it('a tool change clears it — a gesture can end without a LEFT_UP', () => {
    const i = ENGINE.indexOf('if (blockResizeRef.current) blockResizeRef.current = null;');
    expect(i).toBeGreaterThan(-1);
    const region = ENGINE.slice(i, i + 600);
    expect(region).toMatch(/cancelObjectSizeDrag\(\);/);
    expect(region).toMatch(/releasePointer\(\);/);
  });

  it('a full reset clears it too', () => {
    const i = ENGINE.indexOf('blockResizeRef.current = null;\n    cancelObjectSizeDrag();');
    expect(i, 'the reset list no longer names the size drag').toBeGreaterThan(-1);
    expect(ENGINE.slice(i, i + 200)).toMatch(/releasePointer\(\);/);
  });

  it('cancelObjectSizeDrag drops the pinned ghost as well as the state', () => {
    const b = bodyOf('cancelObjectSizeDrag');
    expect(b).toMatch(/objectSizeDragRef\.current = null;/);
    expect(b, 'a stale anchor pins the preview for ever').toMatch(/setObjectDragAnchor\(null\);/);
  });
});

describe('🚨 the release commits where the press landed', () => {
  it('the press captures the whole resolved point, not just a pixel', () => {
    const i = ENGINE.indexOf('objectSizeDragRef.current = {');
    expect(i).toBeGreaterThan(-1);
    expect(ENGINE.slice(i, i + 300), 'the press no longer records the world point it resolved')
      .toMatch(/spot: at,/);
  });

  it('LEFT_UP hands that point to the placement path instead of re-picking', () => {
    // 🚨 THE PREVIOUS VERSION OF THIS GUARD ASSERTED THE BUG AS CORRECT. It
    // pinned `handleObstructionClick(viewer, C, { x: sz.screenX, y: sz.screenY })`
    // — a re-intersection of a SCREEN PIXEL on release. That is precisely how
    // the tree ended up somewhere other than where it was aimed, and the test
    // would have failed the fix. A guard can encode a defect; this is what it
    // looks like.
    expect(ENGINE).toMatch(
      /handleObstructionClick\(viewer, C, \{ x: sz\.screenX, y: sz\.screenY \}, sz\.spot\)/,
    );
  });

  it('the placement authority prefers the handed-in point when there is one', () => {
    expect(ENGINE).toMatch(/const spot = atOverride \?\? resolvePlacementPoint\(/);
  });

  it('and there is still only ONE placement path', () => {
    // The drag decides where and how big. It must never build a record itself:
    // the type, the clamping, the footprint and the keep-out all live in
    // handleObstructionClick and are shared with the plain click.
    const commits = count(/handleObstructionClick\(/g);
    expect(commits, `handleObstructionClick is called ${commits} times — if a new caller appeared, check it is not a second placement path`)
      .toBeLessThanOrEqual(4);
    expect(ENGINE).toMatch(/function handleObstructionClick\(/);
  });
});
