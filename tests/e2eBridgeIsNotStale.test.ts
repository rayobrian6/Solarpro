/**
 * tests/e2eBridgeIsNotStale.test.ts
 *
 * AN INSTRUMENT THAT LIES IS WORSE THAN NO INSTRUMENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `window.__solarE2E` is rebuilt inside a `useEffect`. Three of the values it
 * exposes — `placementMode3D`, `site.deletionLedger` and `site.geometryLifecycle`
 * — were read into the object and then left OUT of the dependency array, so the
 * bridge kept whatever they happened to be when some other dependency last
 * changed.
 *
 * Measured in a live browser: the palette correctly showed the Measure tool
 * armed, the engine's own props said `placementMode: 'tree'`, and the bridge
 * reported `select` — permanently, for the life of the page.
 *
 * 🚨 THREE BROWSER SPECS WERE CHASING A TOOL THAT WAS ALREADY ARMED. The failure
 * was indistinguishable from the product being broken, and it cost a full
 * debugging session to tell the two apart. A harness that reports stale state
 * does not merely fail to catch bugs — it manufactures them.
 *
 * So: every field the bridge exposes from React state must be a dependency of
 * the effect that publishes it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const STUDIO = fs.readFileSync(
  path.join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8',
);

/** The effect body that assigns `window.__solarE2E`, and its dependency list. */
function bridgeEffect(): { body: string; deps: string } {
  const at = STUDIO.indexOf('window.__solarE2E = {');
  expect(at, 'the E2E bridge is gone').toBeGreaterThan(-1);
  const depsAt = STUDIO.indexOf('  }, [roofPlanes, panels, placedObstructions', at);
  expect(depsAt, 'the bridge effect dependency array moved').toBeGreaterThan(at);
  const depsEnd = STUDIO.indexOf(']);', depsAt);
  expect(depsEnd).toBeGreaterThan(depsAt);
  const body = STUDIO.slice(at, depsAt);
  expect(body.length, 'the bridge window collapsed').toBeGreaterThan(800);
  return { body, deps: STUDIO.slice(depsAt, depsEnd) };
}

describe('🚨 the E2E bridge cannot report stale state', () => {
  it('every reactive value it publishes is a dependency of the effect', () => {
    const { body, deps } = bridgeEffect();

    // The three that were missing, named explicitly — this is a regression
    // guard, not a general rule the parser has to infer.
    for (const [field, dep] of [
      ['placementMode: placementMode3D', 'placementMode3D'],
      ['deletionLedger: site.deletionLedger', 'site.deletionLedger'],
      ['geometryLifecycle: site.geometryLifecycle', 'site.geometryLifecycle'],
    ] as const) {
      expect(body, `the bridge stopped publishing ${dep}`).toContain(field);
      expect(deps, `${dep} is published but not a dependency — the bridge will go stale`)
        .toContain(dep);
    }
  });

  it('🚨 and so is every other `site.` value it reads', () => {
    // Mechanical, so a field added later cannot quietly repeat the mistake.
    const { body, deps } = bridgeEffect();
    const published = new Set(
      [...body.matchAll(/:\s*(site\.[A-Za-z0-9_]+)\s*,/g)].map(m => m[1]),
    );
    expect(published.size, 'no site.* values found — the matcher is broken')
      .toBeGreaterThan(3);
    const missing = [...published].filter(p => !deps.includes(p));
    expect(missing, `published but not a dependency: ${missing.join(', ')}`).toEqual([]);
  });

  it('the state values it reads are dependencies too', () => {
    const { deps } = bridgeEffect();
    for (const d of ['roofPlanes', 'panels', 'placedObstructions', 'measurements',
                     'selected3DFaceId', 'placementMode3D']) {
      expect(deps, `${d} is not a dependency`).toContain(d);
    }
  });
});
