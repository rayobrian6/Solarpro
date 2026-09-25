/**
 * tests/overlayVisibilityBudget.test.ts
 *
 * HOW MANY PANELS ARE ALLOWED TO BE ON MY SCREEN.
 *
 * `OVERLAY_Z` gave overlay ORDER an authority after eighteen controls turned
 * out to be unclickable. Overlay EXISTENCE had none: every panel carried its
 * own inline ternary in the engine's JSX, and six repeated the identical
 * `stage === 'done' ?` — which is not a condition, it is "always, once the map
 * has loaded". Nothing anywhere stated how many panels are meant to be on
 * screen at rest, so the count could only ever grow, one reasonable-looking
 * addition at a time. It grew to twenty.
 *
 * Measured from real competitor usage recordings, for scale: Aurora's entire
 * roof-modelling chrome is a FOUR-item tool card plus ONE inspector region that
 * is empty until you select something. Solargraf's drawing tool has six
 * controls in total.
 *
 * This guard does two things a comment cannot:
 *   1. A new panel must DECLARE when it is on screen, or the build fails.
 *   2. The always-on count cannot rise by accident.
 *
 * Raising ALWAYS_ON_BUDGET is allowed — deliberately, in a commit that says
 * which installer is better off for the extra permanent panel. That is the only
 * way it should ever have happened.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OVERLAY_VISIBILITY, OVERLAY_Z, ALWAYS_ON_BUDGET } from '@/lib/3d/overlayLayers';

const ENGINE = readFileSync(
  join(process.cwd(), 'components/3d/SolarEngine3D.tsx'),
  'utf8',
);

/** Every `<DraggablePanel id="...">` the engine actually renders. */
function declaredPanelIds(): string[] {
  const ids = [...ENGINE.matchAll(/<DraggablePanel\s+id="([a-z0-9-]+)"/g)].map(m => m[1]);
  expect(ids.length, 'no panels found — the matcher is broken, not the code')
    .toBeGreaterThan(15);
  return ids;
}

describe('every overlay declares when it is on screen', () => {
  it('no panel exists without a declared lifetime', () => {
    const undeclared = declaredPanelIds().filter(id => !(id in OVERLAY_VISIBILITY));
    expect(
      undeclared,
      'these panels are rendered but never say when they are meant to be on ' +
      'screen. Add them to OVERLAY_VISIBILITY in lib/3d/overlayLayers.ts — and ' +
      'if the answer is "always", it costs the installer permanent screen ' +
      'area and has to fit the budget: ' + undeclared.join(', '),
    ).toEqual([]);
  });

  it('no declaration outlives the panel it describes', () => {
    const rendered = new Set(declaredPanelIds());
    const stale = Object.keys(OVERLAY_VISIBILITY).filter(id => !rendered.has(id));
    expect(
      stale,
      'these are declared but no longer rendered — a stale claim about a ' +
      'surface that does not exist makes the budget below a lie: ' + stale.join(', '),
    ).toEqual([]);
  });

  it('every lifetime is one of the three real answers', () => {
    for (const [id, life] of Object.entries(OVERLAY_VISIBILITY)) {
      expect(['always', 'contextual', 'transient'], `${id} has lifetime "${life}"`)
        .toContain(life);
    }
  });
});

describe('🚨 the always-on budget', () => {
  it('the number of permanently visible panels is within budget', () => {
    const always = Object.entries(OVERLAY_VISIBILITY)
      .filter(([, life]) => life === 'always')
      .map(([id]) => id);

    expect(
      always.length,
      `${always.length} panels are on screen at rest, budget is ${ALWAYS_ON_BUDGET}. ` +
      'Aurora ships four tools and one inspector. Make the new one contextual, ' +
      'or retire one of these: ' + always.join(', '),
    ).toBeLessThanOrEqual(ALWAYS_ON_BUDGET);
  });

  it('the budget is meant to come down, so it is pinned', () => {
    // If someone raises this, the diff says so and the commit has to justify
    // it. That is the whole mechanism.
    expect(ALWAYS_ON_BUDGET).toBe(10);
  });

  it('the contextual panels really are conditional in the JSX', () => {
    // A panel declared 'contextual' whose guard is the bare stage check is
    // lying: `stage === 'done'` means "always, once loaded".
    const contextual = Object.entries(OVERLAY_VISIBILITY)
      .filter(([, life]) => life === 'contextual')
      .map(([id]) => id);

    const liars: string[] = [];
    for (const id of contextual) {
      const at = ENGINE.indexOf(`<DraggablePanel id="${id}"`);
      expect(at, `${id} is declared but not rendered`).toBeGreaterThan(-1);
      // The guard sits immediately above the panel it controls.
      const guard = ENGINE.slice(Math.max(0, at - 260), at);
      const last = guard.lastIndexOf('{stage === ');
      if (last === -1) continue;               // guarded some other way — fine
      const tail = guard.slice(last);
      // `{stage === 'done' ? (` with nothing else is the always-on shape.
      if (/^\{stage === 'done' \? \($/.test(tail.trim())) liars.push(id);
    }
    expect(
      liars,
      'these claim to be contextual but their only guard is "the map has ' +
      'loaded", which is not a context: ' + liars.join(', '),
    ).toEqual([]);
  });
});

describe('the two authorities stay in step', () => {
  it('every panel takes a named layer AND declares a lifetime', () => {
    // Order and existence are different questions about the same panel; a
    // panel answering only one of them is half-declared.
    const withZ = [...ENGINE.matchAll(/<DraggablePanel\s+id="([a-z0-9-]+)"\s+zIndex=\{([^}]+)\}/g)]
      .map(m => m[1]);
    const allIds = declaredPanelIds();
    expect(withZ.sort(), 'a panel without a zIndex cannot be ordered')
      .toEqual(allIds.sort());
    for (const id of allIds) expect(OVERLAY_VISIBILITY[id], `${id} lifetime`).toBeTruthy();
  });

  it('OVERLAY_Z is untouched by this — it still owns order only', () => {
    // Positive control: the two exports are independent, and the layer scale
    // has not quietly acquired visibility semantics.
    expect(Object.keys(OVERLAY_Z)).toContain('INSPECTOR');
    expect(Object.keys(OVERLAY_Z)).not.toContain('always');
  });
});
