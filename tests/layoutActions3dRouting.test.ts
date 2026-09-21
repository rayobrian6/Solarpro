/**
 * tests/layoutActions3dRouting.test.ts
 *
 * "It says 62 panels and 27.28 kW, and there are no panels in sight."
 *
 * The 2D layout engines (lib/roofGeometry.ts generatePanelGridCAD and the
 * optimized wrappers over it) emit panels with NO terrain height. In 2D that is
 * fine — the canvas draws in lat/lng. In 3D those panels render underground,
 * invisible, while the header count, the system size and the PVWatts production
 * all compute correctly off the panel array. The design looks done and the roof
 * looks empty.
 *
 * This is a source-level assertion rather than a render test, and that is a
 * deliberate trade-off: the defect lives in which CODE PATH runs, jsdom cannot
 * mount Cesium, and a unit test of the layout engines passes happily either way
 * — which is exactly why the bug survived.
 *
 * ── WHY THIS FILE WAS REWRITTEN ─────────────────────────────────────────────
 *
 * 🚨 Its first version asserted the literal text `if (show3D)` inside each of
 * THREE named callbacks. That pinned a SPELLING, and it pinned it in only three
 * of the five places the rule has to hold — so when the audit went looking for
 * why Ray's panels sank, it found:
 *
 *   - `relayoutPlane`            — no guard at all. Never covered here.
 *   - `relayoutWithOrientation`  — a guard that FAILED OPEN: it routed only
 *                                  `if (show3D && panels.some(p => (p.height ?? 0) > 0))`.
 *                                  Panels at height 0 ARE the symptom, so once the
 *                                  2D engine had sunk an array, the guard that
 *                                  would have prevented it could never fire again.
 *
 * A rule that must hold at five call sites belongs at one, so the guard is now a
 * chokepoint — `routeLayoutTo3D()` — and this file asserts the INVARIANT instead
 * of the spelling: every layout action consults the chokepoint before it can
 * reach a 2D engine, and returns. That is strictly stronger than what it replaced,
 * and it now covers all five.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'components', 'design', 'DesignStudio.tsx'),
  'utf8',
);

/**
 * Blank out comments, preserving every byte offset so positional assertions still
 * point at real source.
 *
 * 🚨 THIS IS LOAD-BEARING, not tidiness. These blocks are heavily commented, and the
 * comments NAME the very functions being searched for — the guard comment in
 * `fillRoof` mentions `generatePanelGridCAD`, which made a naive search report the
 * 2D engine appearing 500 bytes before the routing check that actually precedes it.
 * A source-level test that reads its own prose is worse than no test.
 */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

/**
 * The body of a top-level handler, whether it is a `useCallback` or a plain arrow
 * function, with comments blanked. Ends at the next 2-space-indented `const`, which
 * is where the following handler begins — nested declarations are more deeply
 * indented and so are kept.
 */
function actionBody(name: string): string {
  const start = SRC.search(new RegExp(`const ${name}\\s*=\\s*(useCallback\\(|\\()`));
  expect(start, `${name} should exist in DesignStudio.tsx`).toBeGreaterThan(-1);
  const nextDecl = SRC.indexOf('\n  const ', start + 10);
  return blankComments(SRC.slice(start, nextDecl === -1 ? SRC.length : nextDecl));
}

/**
 * A CALL to a 2D layout engine — the thing that must not be reached in 3D. The
 * trailing `(` matters: it is the difference between invoking the engine and
 * mentioning it.
 */
const ENGINE_2D = /(generateRoofLayoutOptimized|generateGroundLayoutOptimized|generatePanelGridCAD)\s*\(/;

/**
 * Every action that can generate a panel layout.
 *
 * 🚨 ADD TO THIS LIST when you add a layout action. The two that were missing are
 * exactly the two that shipped broken.
 */
const LAYOUT_ACTIONS = [
  'autoLayoutAll',
  'fillRoof',
  'optimizeLayout',
  'relayoutWithOrientation',
  'relayoutPlane',
] as const;

/** The subset declared with useCallback, which therefore carry a dependency array. */
const MEMOISED_ACTIONS = [
  'autoLayoutAll',
  'fillRoof',
  'optimizeLayout',
  'relayoutWithOrientation',
] as const;

describe('layout actions must not bury their panels in 3D mode', () => {
  it.each(LAYOUT_ACTIONS)('%s consults the 3D chokepoint before any 2D engine', (name) => {
    const body = actionBody(name);
    const route = body.indexOf('routeLayoutTo3D(');
    expect(route, `${name} must call routeLayoutTo3D before running a 2D layout engine`)
      .toBeGreaterThan(-1);

    const engine = body.search(ENGINE_2D);
    if (engine > -1) {
      expect(route, `${name} calls a 2D engine at ${engine} before consulting routeLayoutTo3D at ${route}`)
        .toBeLessThan(engine);
    }
  });

  it.each(LAYOUT_ACTIONS)('%s returns immediately after the handoff', (name) => {
    // Falling through would run BOTH engines and double-place panels.
    const body = actionBody(name);
    const route = body.indexOf('routeLayoutTo3D(');
    const ret = body.indexOf('return', route);
    expect(ret, `${name} must return once routeLayoutTo3D has taken over`).toBeGreaterThan(route);

    const engine = body.search(ENGINE_2D);
    if (engine > -1) {
      expect(ret, `${name} must return BEFORE it can reach a 2D engine`).toBeLessThan(engine);
    }
  });

  it.each(MEMOISED_ACTIONS)('%s lists routeLayoutTo3D in its dependency array', (name) => {
    // routeLayoutTo3D closes over show3D. A stale copy silently restores the bug
    // after one 2D/3D toggle, exactly as a stale show3D used to.
    const body = actionBody(name);
    const deps = body.slice(body.lastIndexOf('}, ['));
    expect(deps, `${name} deps must include routeLayoutTo3D`).toContain('routeLayoutTo3D');
  });

  it('the chokepoint itself tests the mode and hands off to the 3D auto_roof engine', () => {
    const body = actionBody('routeLayoutTo3D');
    expect(body, 'routeLayoutTo3D must test show3D').toMatch(/if\s*\(\s*!\s*show3D\s*\)/);
    expect(body, 'routeLayoutTo3D must hand off to the 3D auto_roof engine')
      .toMatch(/setPlacementMode3D\(\s*['"]auto_roof['"]\s*\)/);
    expect(body, 'routeLayoutTo3D deps must include show3D').toContain('show3D');
  });

  it('🚨 the chokepoint decides on the MODE ALONE — never on panel state', () => {
    // The original fail-open guard read `show3D && panels.some(p => (p.height ?? 0) > 0)`.
    // Gating on the panels' own elevation is self-defeating: an array already at
    // height 0 is the defect, and requiring one above 0 means the guard switches
    // itself off precisely when it is needed. Nothing about the panels may enter
    // this decision.
    const body = actionBody('routeLayoutTo3D');
    expect(body).not.toMatch(/\.height/);
    expect(body).not.toMatch(/panels\s*\./);
  });

  it('the 2D engine still emits no height — the reason the guard is required', () => {
    // If this ever stops being true, the guard can be revisited. Until then it
    // documents WHY these buttons have to detour through the 3D engine.
    const geom = readFileSync(join(process.cwd(), 'lib', 'roofGeometry.ts'), 'utf8');
    const start = geom.indexOf('function generatePanelGridCAD');
    expect(start).toBeGreaterThan(-1);
    const body = geom.slice(start, start + 12000);
    const pushLiteral = body.slice(body.indexOf('panels.push('), body.indexOf('panels.push(') + 1600);
    expect(pushLiteral).not.toMatch(/\bheight\s*:/);
    expect(pushLiteral).not.toMatch(/\bplaneId\s*:/);
  });
});
