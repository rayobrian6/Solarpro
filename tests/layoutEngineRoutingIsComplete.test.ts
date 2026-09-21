/**
 * tests/layoutEngineRoutingIsComplete.test.ts
 *
 * EVERY ROOF-LAYOUT ENTRY POINT MUST REACH THE CHOKEPOINT.
 *
 * `generateRoofLayoutOptimized` is the 2D layout engine. It emits panels with
 * **no elevation** — it has no roof surface to put them on. In 3D those panels
 * used to be drawn on the WGS-84 ellipsoid, roughly a hundred metres under the
 * building, which is what *"the panels disappear into the roof"* looks like from
 * the camera; since `hasUsableElevation` they are refused by the renderer
 * instead, and are then counted in the system size while not being on the roof.
 * Both outcomes are wrong, so in 3D the call must not happen at all.
 *
 * `routeLayoutTo3D()` exists to decide that once. Its own docstring says:
 *
 *     "A rule that must hold at N call sites belongs at one."
 *
 * 🚨 AND THE CLAIM WAS NOT CHECKED AGAINST THE CALLERS. It was checked against
 * the four sites that already had the rule pasted in, so `confirmPendingPlane`
 * and `autoPlacePanels` — two live entry points, "confirm a traced plane" and
 * "auto-place on a drawn zone" — went on calling the 2D engine directly. That
 * is the same shape as `handleRouteDbError` ("a new route cannot forget it",
 * while two of five routes never reached it): **a rule at one place still has
 * to be REACHED**, and the only way to know is to discover the callers.
 *
 * So this test does not list them. It finds every `generateRoofLayoutOptimized`
 * call in the studio, works out which function encloses it, and requires the
 * guard to appear in that function ahead of the call.
 *
 * 🚨 WHAT IT DELIBERATELY DOES NOT CLAIM. A source scan cannot prove the guard's
 * branch is taken, only that it is there to be taken — the trap the first
 * version of `tests/layoutRefusalReachesEveryRoute.test.ts` fell into by
 * accepting a `catch` that was never the one that would see the throw. The
 * behavioural proof that a 3D fill puts panels on the roof is
 * `e2e/panel-above-deck.spec.ts`, which measures the drawn entities.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(process.cwd(), 'components', 'design', 'DesignStudio.tsx');
const SRC = readFileSync(STUDIO, 'utf8').split('\n');

/** `const foo = (...)`, `const foo = useCallback(`, `function foo(`, `async function foo(`
 *  at component-member indentation — the granularity a guard lives at. */
const DECL = /^ {2}(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)\s*[=(]/;

type Call = { line: number; fn: string; fnLine: number };

/** Every 2D ROOF-layout call, with the function that encloses it. */
function roofLayoutCalls(): Call[] {
  const out: Call[] = [];
  for (let i = 0; i < SRC.length; i++) {
    if (!/\bgenerateRoofLayoutOptimized\s*\(/.test(SRC[i])) continue;
    // Skip the import line and prose.
    if (/^\s*(?:import|\*|\/\/)/.test(SRC[i])) continue;
    let fn = '(top level)';
    let fnLine = -1;
    for (let j = i; j >= 0; j--) {
      const m = DECL.exec(SRC[j]);
      if (m) { fn = m[1]; fnLine = j; break; }
    }
    out.push({ line: i + 1, fn, fnLine });
  }
  return out;
}

/** Does the guard appear inside this function, before the call? */
function guardedBeforeCall(call: Call): boolean {
  if (call.fnLine < 0) return false;
  const body = SRC.slice(call.fnLine, call.line - 1).join('\n');
  return /\brouteLayoutTo3D\s*\(/.test(body);
}

describe('the 2D roof-layout engine is unreachable in 3D, at every entry point', () => {
  const calls = roofLayoutCalls();

  it('the discovery found the call sites — this test is not vacuous', () => {
    // If the scan breaks, every assertion below passes over an empty list, which
    // is the exact failure this whole file exists to prevent elsewhere.
    expect(calls.length, 'no generateRoofLayoutOptimized call was found in DesignStudio')
      .toBeGreaterThanOrEqual(5);
    const fns = calls.map(c => c.fn);
    // Two that the hand-written rule missed, named so a rename cannot quietly
    // shrink the scan back to the sites that were already correct.
    expect(fns, 'confirmPendingPlane lays out a freshly traced plane').toContain('confirmPendingPlane');
    expect(fns, 'autoPlacePanels lays out a drawn zone').toContain('autoPlacePanels');
    for (const c of calls) {
      expect(c.fnLine, `the call at line ${c.line} has no enclosing function — the scan is wrong`)
        .toBeGreaterThan(0);
    }
  });

  it('🚨 every roof-layout entry point consults routeLayoutTo3D first', () => {
    const unguarded = calls.filter(c => !guardedBeforeCall(c));
    expect(
      unguarded.map(c => `${c.fn} (line ${c.line})`),
      'these call the 2D layout engine without asking whether 3D should take over, so ' +
      'in 3D they produce panels with no elevation — counted in the system size and ' +
      'either buried under the building or not drawn at all',
    ).toEqual([]);
  });

  it('the guard is a real function in this file, not a name the scan invented', () => {
    // A scan that matches a string nothing defines would pass forever after a
    // rename. Pin the definition too.
    const src = SRC.join('\n');
    expect(src, 'routeLayoutTo3D must be defined in DesignStudio')
      .toMatch(/const\s+routeLayoutTo3D\s*=\s*useCallback\(/);
    // And it must still key on the 3D mode — a guard that always returns false
    // would satisfy every assertion above while routing nothing.
    const body = src.slice(src.indexOf('const routeLayoutTo3D'));
    expect(body.slice(0, 400), 'routeLayoutTo3D must still decide on show3D').toContain('if (!show3D) return false;');
  });

  it('ground and fence layouts are NOT required to route — they have no roof', () => {
    // Guard against over-fitting: if this test ever starts demanding the guard
    // around `generateGroundLayoutOptimized`, it has stopped describing the
    // defect. A ground array has no roof surface and no elevation problem.
    const src = SRC.join('\n');
    expect(src, 'the ground engine should still be called directly')
      .toMatch(/generateGroundLayoutOptimized\s*\(/);
  });
});
