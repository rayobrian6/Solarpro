/**
 * tests/placementAuthorityWiring.test.ts
 *
 * EVERY PLACEMENT CLICK GOES THROUGH THE ONE AUTHORITY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY IT IS A SOURCE GUARD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Tree -> click ground -> NO TREE APPEARS."
 *   "It appears that Chimney may also not be wired end-to-end. Treat this as
 *    evidence that the problem may be broader than Tree."
 *
 * It was broader than Tree by a factor of five. `handleObstructionClick`,
 * `handleAddRowClick`, `handleExtendRowClick`, `handleSnapPanelClick` and
 * `handleSurfaceSelectClick` each opened with a bare
 * `viewer.scene.pickPosition(screenPos)` — a DEPTH-BUFFER read that answers only
 * where something is already drawn, and only where the depth texture exists. At
 * a property with no Google mesh (the case the custom pipeline exists for) it
 * returns undefined. Two of the five then returned with no message at all.
 *
 * 🚨 THE OWNER'S INSTRUCTION WAS "Create one shared object-placement authority
 * where appropriate. Do not maintain one ad hoc click path per object." A guard
 * that only checked Tree would be exactly the Tree-only patch that was refused.
 * So this asserts the property across ALL of them, and asserts it about the
 * source, because mounting the engine needs Cesium and a WebGL context.
 *
 * The behaviour of the maths itself is proven without any of that in
 * tests/placementIntersection.test.ts.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));

/**
 * The body of a named function, from its signature to the start of the next
 * top-level `function` at the same indentation.
 *
 * 🚨 THE WINDOW IS VERIFIED BEFORE IT IS TRUSTED. A previous source guard in
 * this repo sliced to the first `}` after a status message — and that message
 * contained a `\u{...}` escape, whose own syntax includes a closing brace. The
 * window was a few characters long and the mutation proof PASSED with the defect
 * restored. Every caller below asserts the window is substantial and contains a
 * landmark, so a guard can never again be unable to see the code it guards.
 */
function bodyOf(name: string): string {
  const sig = `function ${name}(viewer: any, C: any, screenPos: any) {`;
  const at = ENGINE.indexOf(sig);
  expect(at, `${name} is gone or its signature changed`).toBeGreaterThan(-1);
  const next = ENGINE.indexOf('\n  function ', at + sig.length);
  const end = next > at ? next : ENGINE.length;
  const body = ENGINE.slice(at, end);
  // The shortest of these is ~40 lines. Anything under 400 chars means the
  // window collapsed and every assertion below would be vacuous.
  expect(body.length, `the ${name} window collapsed to ${body.length} chars`).toBeGreaterThan(400);
  return body;
}

/** Every handler that resolves a user click into a physical placement point. */
const PLACEMENT_HANDLERS = [
  'handleObstructionClick',
  'handleAddRowClick',
  'handleExtendRowClick',
  'handleSnapPanelClick',
  'handleSurfaceSelectClick',
];

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 no placement handler reads the depth buffer directly', () => {
  it.each(PLACEMENT_HANDLERS)('%s does not call scene.pickPosition', name => {
    const body = bodyOf(name);
    // 🚨 THE EXACT LINE THAT MADE FIVE TOOLS DEAD ON A CUSTOM-BUILT PROPERTY.
    expect(body, `${name} is back on the raw depth pick`)
      .not.toMatch(/scene\.pickPosition\s*\(/);
  });

  it.each(PLACEMENT_HANDLERS)('%s resolves through resolvePlacementPoint', name => {
    const body = bodyOf(name);
    expect(body, `${name} does not use the placement authority`)
      .toMatch(/resolvePlacementPoint\(viewer, C, screenPos,/);
  });

  it('🚨 …and none of them fails silently', () => {
    // Add Row and Extend Row used to be a bare `return;`. A click that did
    // nothing looked exactly like a click that worked.
    //
    // 🚨 THIS ASSERTS THE FAILURE BRANCH ITSELF, NOT A WINDOW NEAR IT. A first
    // version took 600 characters after the resolve and looked for any
    // setStatusMsg in them — so restoring `if (!spot) return;` left the guard
    // GREEN, because a success message further down the function was inside the
    // window. The mutation proof caught it. The branch is now isolated exactly:
    // from the guard to its own `return`.
    for (const name of PLACEMENT_HANDLERS) {
      const body = bodyOf(name);
      const at = body.indexOf('if (!spot)');
      expect(at, `${name}: no guard on the resolve result`).toBeGreaterThan(-1);
      const ret = body.indexOf('return;', at);
      expect(ret, `${name}: the guard never returns`).toBeGreaterThan(at);
      const branch = body.slice(at, ret + 'return;'.length);
      // `if (!spot) return;` is 18 chars. Anything that tells the user something
      // is necessarily longer, so this also pins the window against collapsing.
      expect(branch.length, `${name}: the branch window collapsed`).toBeGreaterThan(30);
      expect(branch, `${name} returns without telling the user anything`)
        .toMatch(/setStatusMsg/);
    }
  });

  it('the authority itself exists and needs nothing rendered', () => {
    const at = ENGINE.indexOf('function resolvePlacementPoint(');
    expect(at, 'the placement authority is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 40));
    expect(body.length).toBeGreaterThan(1500);

    // It asks the design's own geometry first…
    expect(body).toMatch(/nearestFaceAlongRay\(/);
    expect(body).toMatch(/collectRoofRenderables\(/);
    // …falls back to the depth chain, which is itself fully guarded…
    expect(body).toMatch(/getWorldPosition\(viewer, C, screenPos\)/);
    // …and finally to the ground as a known elevation.
    expect(body).toMatch(/intersectRayWithGeocentricSphere\(/);
    // 🚨 NOT A MEAN EARTH RADIUS. See the test of the same name in
    // placementIntersection.test.ts: a mean-radius sphere sits ~1.4 km above the
    // ground at this latitude, so every call would have the camera inside it.
    expect(body, 'the ground radius is back to a mean earth radius')
      .not.toMatch(/radii\.x \+ .*radii\.y \+ .*radii\.z\) \/ 3/);
    expect(body).toMatch(/C\.Cartesian3\.fromRadians\(camCarto\.longitude, camCarto\.latitude, groundElevM\)/);
  });
});

describe('🚨 an object binds to the face it was dropped on', () => {
  it('the obstruction record takes its planeId from the CLICK, not the selection', () => {
    const body = bodyOf('handleObstructionClick');
    // The defect: `selectedFaceIdRef.current` bound a chimney marked on the
    // garage to the main roof whenever the main roof happened to be selected,
    // and bound it to nothing at all when no face was selected.
    expect(body, 'planeId is back to the selected face')
      .not.toMatch(/planeId:.*selectedFaceIdRef/);
    expect(body).toMatch(/planeId: preset\.space === 'roof' \? \(spot\.planeId \?\? undefined\) : undefined/);
  });

  it('a roof object refuses to be placed off every roof face', () => {
    const body = bodyOf('handleObstructionClick');
    expect(body).toMatch(/if \(preset\.space === 'roof' && !spot\.planeId\)/);
  });

  it('the armed type is read BEFORE the click is located', () => {
    // A tree resolves against the ground and a chimney against a roof face, so
    // the type has to be known before the question can be asked.
    const body = bodyOf('handleObstructionClick');
    const presetAt = body.indexOf('const preset = presetFor(obstructionPresetRef.current)');
    const resolveAt = body.indexOf('resolvePlacementPoint');
    expect(presetAt, 'the armed preset is no longer read').toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(-1);
    expect(presetAt, 'the click is located before the type is known').toBeLessThan(resolveAt);
    expect(body).toMatch(/preset\.space === 'site' \? 'site' : 'roof'/);
  });

  it('🚨 placement and reload draw the SAME object', () => {
    const body = bodyOf('handleObstructionClick');
    // Placement used to hand-roll a white polygon while drawObstructionEntity —
    // the path a reload and an undo use — drew a tree green. So a freshly placed
    // tree looked like a vent until the page was reloaded.
    expect(body, 'placement hand-rolls its own entity again')
      .not.toMatch(/viewer\.entities\.add\(\{/);
    expect(body).toMatch(/drawObstructionEntity\(viewer, C, newObs\)/);
  });
});
