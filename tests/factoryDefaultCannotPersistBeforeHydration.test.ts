// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE FACTORY FLEET CANNOT CROSS THE PERSISTENCE BOUNDARY BEFORE THE PROJECT HYDRATES.
//
// Ray (System Config gauntlet, automatic-writer law): "Also prove factory initialization cannot
// cross a persistence boundary before project hydration."
//
// `DEFAULT_CONFIG.inverters` is `[newInverter('string')]` — a SolarEdge SE7600H present from the
// first render of every project. It is the one automatic inverter "writer" the Part IV table left
// alone on the reasoning that it is replaced at hydration. That reasoning only holds if NOTHING can
// persist the config before hydration completes, on any path — the debounced autosave, its
// localStorage mirror, and the unload beacon — and if hydration is not declared complete on a load
// that failed. This file pins exactly that, on the live lines (the component needs a browser and a
// project API to mount, so the ordering is asserted on the source, comments stripped).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const page = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));

/** The body of the first `useEffect(() => { … })` whose text contains `marker`. */
function effectContaining(marker: string): string {
  const at = page.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(0);
  const start = page.lastIndexOf('useEffect(() => {', at);
  return page.slice(start, at + 400);
}

describe('the factory default exists, and is never persisted before hydration', () => {
  it('the factory seed is what this guard is about (control: if it changes, re-read this file)', () => {
    expect(page).toMatch(/inverters:\s*\[newInverter\('string'\)\]/);
  });

  it('the autosave returns before its localStorage mirror and its network write until hydrated', () => {
    const body = effectContaining("fetch('/api/engineering/save-config'");
    const guard = body.indexOf('if (!isHydrated) return;');
    expect(guard, 'the autosave lost its hydration guard').toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf('localStorage.setItem'));
    expect(guard).toBeLessThan(body.indexOf("fetch('/api/engineering/save-config'"));
  });

  it('the unload beacon is gated on hydration too', () => {
    const body = effectContaining("navigator.sendBeacon('/api/engineering/save-config'");
    expect(body).toMatch(/if \(!currentProjectId \|\| !isHydrated\) return;/);
  });

  it('hydration is declared complete exactly once, only after a SUCCESSFUL project load', () => {
    const sets = page.match(/setIsHydrated\(true\)/g) ?? [];
    expect(sets).toHaveLength(1);
    const at = page.indexOf('setIsHydrated(true)');
    const fetchAt = page.lastIndexOf('fetch(`/api/projects/${projectId}`)', at);
    expect(fetchAt, 'hydration is no longer inside the project load').toBeGreaterThan(0);
    const between = page.slice(fetchAt, at);
    // A failed load returns before reaching it…
    expect(between).toMatch(/if \(!data\.success \|\| !data\.data\) \{[\s\S]*?return;\s*\}/);
    // …and it is not in the error handler.
    const catchAt = page.indexOf('.catch(err => console.warn(\'[engineering] auto-load failed:\'', fetchAt);
    expect(catchAt).toBeGreaterThan(at);
  });
});
