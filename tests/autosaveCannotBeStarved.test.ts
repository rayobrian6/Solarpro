/**
 * tests/autosaveCannotBeStarved.test.ts
 *
 * THE AUTOSAVE HAD NO UPPER BOUND ON HOW LONG IT WOULD HOLD YOUR WORK.
 *
 * The studio autosaves on a 3-second trailing debounce: every dependency change
 * clears the pending timer and starts a new one. That is the right shape for
 * coalescing a burst of edits. It is the wrong shape with no ceiling, because a
 * dependency that keeps changing faster than the delay means the save NEVER
 * happens — and nothing anywhere says how long a design may sit unwritten.
 *
 * 🚨 AND ONE OF THE DEPENDENCIES IS NOT A DESIGN CHANGE AT ALL. The effect depends
 * on `saveLayoutToDB`, which is a `useCallback` over NINE values — including
 * `stringAssignment`, `stringOverrides`, `selectedPanel`, `selectedInverter` and
 * `panels`. So the timer is reset by the CALLBACK'S IDENTITY churning, not only by
 * the design changing. Anything that re-creates that callback restarts the clock,
 * and the user's work stays in memory.
 *
 * This was observed once in a browser run and recorded as not reproducible on
 * demand: geometry reached the 3D engine at t=109.9 s, the save three seconds later
 * carried 0 panels, and no further POST followed in the next 45 seconds. A
 * starvation that only sometimes bites is the worst kind to chase, which is why the
 * fix is a GUARANTEE rather than an attempt to find the churn source:
 *
 *   1. the save function is called through a REF, so its identity is no longer a
 *      reason to restart the clock — only real design change is. The file already
 *      uses refs for precisely this reason in three other places, each with a
 *      comment about a frozen or churning closure;
 *   2. a MAX WAIT: however many times the debounce is deferred, the design is
 *      written no later than a fixed deadline measured from the FIRST pending
 *      change. The debounce still coalesces a burst; it can no longer swallow one.
 *
 * Source-scanning, because what is being asserted is the shape of a `useEffect`
 * inside a 7,700-line component — and the behaviour it guards (a timer that never
 * fires) is precisely what a test that mounts the component cannot wait for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const STUDIO = stripComments(
  readFileSync(join(ROOT, 'components', 'design', 'DesignStudio.tsx'), 'utf8'));

/** The autosave effect: from its `useEffect(` to the end of its dependency array. */
function autosaveEffect(): { body: string; deps: string } {
  // Anchored on the timer the effect owns, which is unique to it, then walked out
  // to the enclosing `useEffect(` and in to the closing dep array. Not a
  // fixed-length window: this effect carries the longest comment block in the file
  // and it has grown four times.
  const timer = STUDIO.indexOf('autoSaveTimerRef.current = setTimeout(');
  expect(timer, 'the autosave timer moved — this guard is blind').toBeGreaterThan(-1);
  const start = STUDIO.lastIndexOf('useEffect(', timer);
  expect(start).toBeGreaterThan(-1);
  const depsOpen = STUDIO.indexOf('}, [', timer);
  expect(depsOpen, 'the autosave effect has no dependency array').toBeGreaterThan(timer);
  const depsClose = STUDIO.indexOf(']', depsOpen);
  return {
    body: STUDIO.slice(start, depsOpen),
    deps: STUDIO.slice(depsOpen, depsClose + 1),
  };
}

describe('the guard can see the effect at all', () => {
  it('it finds the autosave effect and its dependency array', () => {
    // POSITIVE CONTROL. Every assertion below is about the contents of these two
    // strings, so "not found" and "found and clean" must be distinguishable.
    const { body, deps } = autosaveEffect();
    expect(body).toMatch(/setTimeout\(/);
    expect(deps).toMatch(/^\}, \[/);
    expect(deps.length, 'the dependency array came back suspiciously short')
      .toBeGreaterThan(20);
  });
});

describe('🚨 the debounce is not restarted by things that are not design changes', () => {
  it('🚨 the save function is NOT in the dependency array', () => {
    // 🚨 THE CHURN SOURCE. `saveLayoutToDB` is a useCallback over nine values —
    // `stringAssignment`, `panels`, `topology`, `modulesPerString`, `rackingId`,
    // `selectedPanel`, `selectedInverter`, `stringOverrides`, `designMicro`. Any of
    // them re-creating it restarts the clock, which has nothing to do with whether
    // the design changed.
    expect(autosaveEffect().deps,
      'the autosave restarts its timer whenever the save callback is re-created — the ' +
      'design can then sit unwritten indefinitely, which is what was observed')
      .not.toMatch(/saveLayoutToDB/);
  });

  it('and it is reached through a ref that is actually KEPT UP TO DATE', () => {
    // The replacement has to be wired at both ends, and a first version asserted
    // only the CALL — so deleting the effect that re-points the ref sailed through,
    // leaving the autosave invoking a frozen closure for ever. That is the other
    // defect this file's neighbours are full of comments about, and it would have
    // been introduced by the fix for the first one.
    expect(autosaveEffect().body,
      'the dependency was dropped without a ref — nothing calls the save')
      .toMatch(/saveLayoutToDBRef\.current\?\.\(/);
    expect(STUDIO,
      'the ref is called but never re-pointed — the autosave holds the first save ' +
      'function it ever saw, with a stale closure over nine values')
      .toMatch(/saveLayoutToDBRef\.current = saveLayoutToDB/);
  });

  it('the real design dependencies are all still there', () => {
    // Removing churn must not remove the triggers. Each of these was added after a
    // separate data-loss incident, and three of them are documented in this file as
    // having been missed once already.
    const deps = autosaveEffect().deps;
    for (const d of [
      'panels', 'roofPlanes', 'placedObstructions', 'measurements',
      'fenceLine', 'fenceHeight', 'tilt', 'azimuth', 'rowSpacing', 'groundHeight',
      'bifacialOptimized', 'site.deletionLedger', 'site.nativeDisposition',
    ]) {
      expect(deps, `${d} can no longer schedule a save — that is a data-loss regression`)
        .toContain(d);
    }
  });
});

describe('🚨 and there is an upper bound on how long work is held', () => {
  it('🚨 a maximum wait exists, as a named constant', () => {
    expect(STUDIO,
      'nothing bounds how long the autosave may defer — a design can be held in memory ' +
      'for ever while state churns')
      .toMatch(/AUTOSAVE_MAX_DEFER_MS/);
  });

  it('it is longer than the debounce and short enough to matter', () => {
    const m = STUDIO.match(/AUTOSAVE_MAX_DEFER_MS\s*=\s*([0-9_]+)/);
    expect(m, 'the max-wait constant has no value').toBeTruthy();
    const ms = Number(String(m![1]).replace(/_/g, ''));
    // Longer than the 3 s debounce, or it would defeat the coalescing it exists to
    // preserve; and no longer than half a minute, or the guarantee is not one.
    expect(ms).toBeGreaterThan(3_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it('🚨 the DELAY is derived from the deadline, not a constant beside it', () => {
    // 🚨 A first version asserted only that `autosaveDeadlineRef` appeared in the
    // effect. Replacing the computed delay with a flat `const delay = 3000` left the
    // deadline block sitting there unused, and the guard passed — a deadline nothing
    // consults is decoration.
    const body = autosaveEffect().body;
    expect(body, 'the scheduled delay does not consult the deadline at all')
      .toMatch(/autosaveDeadlineRef\.current\s*-\s*Date\.now\(\)/);
    expect(body, 'the delay is not clamped by the remaining time')
      .toMatch(/Math\.min\(\s*3000\s*,\s*remaining\s*\)/);
    // And never negative: an overdue deadline must fire now, not in the past.
    expect(body).toMatch(/Math\.max\(\s*0\s*,/);
  });

  it('🚨 and the deadline is set ONLY when none is pending', () => {
    // 🚨 A deadline reset alongside the debounce is not a deadline — it is the
    // debounce again, wearing a longer number. A first version asserted only that
    // the ref was assigned somewhere, so a mutation dropping the `=== null` guard
    // and re-stamping it on every change passed. The first change in a burst starts
    // the clock and must survive every later one.
    expect(STUDIO,
      'the deadline is re-stamped on every change, so it can be deferred for ever')
      .toMatch(/if \(autosaveDeadlineRef\.current === null\) \{\s*autosaveDeadlineRef\.current = Date\.now\(\) \+ AUTOSAVE_MAX_DEFER_MS;/);
  });

  it('and the deadline is cleared once the work is written', () => {
    // Otherwise the first save's deadline stays in the past for ever, and every
    // later change saves immediately — the debounce gone, a POST per keystroke.
    expect(STUDIO, 'the deadline is never cleared, so the debounce is destroyed after the first save')
      .toMatch(/autosaveDeadlineRef\.current = null/);
  });
});
