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
 * autoLayoutAll has guarded against this since v48.35 by routing to the 3D
 * engine when show3D is true. fillRoof and optimizeLayout never got the guard,
 * so two of the three buttons on the toolbar buried their output.
 *
 * This is a source-level assertion rather than a render test, and that is a
 * deliberate trade-off: the defect lives in which CODE PATH runs, jsdom cannot
 * mount Cesium, and a unit test of the layout engines passes happily either way
 * — which is exactly why the bug survived. Asserting the guard exists on every
 * layout action catches the next one added without it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'components', 'design', 'DesignStudio.tsx'),
  'utf8',
);

/** Extract a `const <name> = useCallback(...)` body up to its dependency array. */
function callbackBody(name: string): string {
  const start = SRC.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} should exist in DesignStudio.tsx`).toBeGreaterThan(-1);
  // The dep array closes the callback at the first line starting with "  }, [".
  const end = SRC.indexOf('\n  }, [', start);
  expect(end, `${name} should close with a dependency array`).toBeGreaterThan(start);
  const depEnd = SRC.indexOf(']);', end);
  return SRC.slice(start, depEnd + 3);
}

/** Every toolbar action that generates a panel layout. */
const LAYOUT_ACTIONS = ['autoLayoutAll', 'fillRoof', 'optimizeLayout'] as const;

describe('layout actions must not bury their panels in 3D mode', () => {
  it.each(LAYOUT_ACTIONS)('%s routes to the 3D engine when show3D is true', (name) => {
    const body = callbackBody(name);
    expect(body, `${name} must check show3D before running a 2D layout engine`)
      .toMatch(/if\s*\(\s*show3D\s*\)/);
    expect(body, `${name} must hand off to the 3D auto_roof engine`)
      .toMatch(/setPlacementMode3D\(\s*['"]auto_roof['"]\s*\)/);
  });

  it.each(LAYOUT_ACTIONS)('%s returns immediately after the handoff', (name) => {
    // Falling through would run BOTH engines and double-place panels.
    const body = callbackBody(name);
    const guard = body.slice(body.search(/if\s*\(\s*show3D\s*\)/));
    const handoff = guard.indexOf('setPlacementMode3D');
    const ret = guard.indexOf('return');
    expect(ret, `${name} must return after setPlacementMode3D`).toBeGreaterThan(handoff);
    // The return must come before the guard block closes.
    const close = guard.indexOf('\n    }');
    expect(ret).toBeLessThan(close === -1 ? guard.length : close);
  });

  it.each(LAYOUT_ACTIONS)('%s lists show3D in its dependency array', (name) => {
    // A stale show3D silently restores the bug after one 2D/3D toggle: the
    // closure keeps the value from when it was created.
    const body = callbackBody(name);
    const deps = body.slice(body.lastIndexOf('}, ['));
    expect(deps, `${name} deps must include show3D`).toContain('show3D');
    expect(deps, `${name} deps must include setPlacementMode3D`).toContain('setPlacementMode3D');
  });

  it('the 2D engine still emits no height — the reason the guard is required', () => {
    // If this ever stops being true, the guard can be revisited. Until then it
    // documents WHY three buttons have to detour through the 3D engine.
    const geom = readFileSync(join(process.cwd(), 'lib', 'roofGeometry.ts'), 'utf8');
    const start = geom.indexOf('function generatePanelGridCAD');
    expect(start).toBeGreaterThan(-1);
    const body = geom.slice(start, start + 12000);
    const pushLiteral = body.slice(body.indexOf('panels.push('), body.indexOf('panels.push(') + 1600);
    expect(pushLiteral).not.toMatch(/\bheight\s*:/);
    expect(pushLiteral).not.toMatch(/\bplaneId\s*:/);
  });
});
