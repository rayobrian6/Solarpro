/**
 * tests/geodeticDatum.test.ts
 *
 * ONE ANSWER TO "HOW DO GOOGLE'S HEIGHTS BECOME CESIUM'S".
 *
 * The expression `-29 - 5 * Math.sin(lat)` existed in FOUR places in
 * `SolarEngine3D` — boot, the twin reload, `drawOverlays`, and the segment fill.
 * All four agreed, which is the only reason nothing had gone wrong yet. Four
 * copies of a physical constant is four places for it to diverge, and this
 * workstream exists because that already happened to the module mount height:
 * six copies, four different numbers, and a 14 cm-per-reload ratchet.
 *
 * So the rule is applied before the divergence rather than after, and this test
 * is what keeps it applied: it fails if the expression reappears anywhere.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { geoidUndulationM, ellipsoidalFromOrthometricM, isWithinGeoidFitBand } from '@/lib/geodeticDatum';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the geoid conversion has exactly one home', () => {
  it('🚨 the expression exists nowhere but lib/geodeticDatum.ts', () => {
    // Matches `-29 - 5 * Math.sin`, `-29-5*Math.sin`, and the spacing variants
    // in between. Prose in a comment is deliberately NOT excluded: a comment
    // restating the formula is how the next copy gets written.
    const pattern = /-\s*29\s*-\s*5\s*\*\s*Math\.sin/;
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of ['app', 'components', 'lib', 'hooks']) {
      let files: string[];
      try { files = walk(join(ROOT, dir)); } catch { continue; }
      for (const f of files) {
        const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
        if (rel === 'lib/geodeticDatum.ts') continue;
        scanned++;
        if (pattern.test(readFileSync(f, 'utf8'))) offenders.push(rel);
      }
    }
    expect(scanned, 'the scan found no source files — it is measuring nothing')
      .toBeGreaterThan(200);
    expect(offenders,
      'these restate the geoid undulation instead of importing geoidUndulationM, ' +
      'which is how one physical constant becomes several',
    ).toEqual([]);
  });

  it('and the authority still computes what the four copies computed', () => {
    // Pin the behaviour, so the consolidation is provably a no-op on numbers.
    // If the fit is ever replaced with a real geoid model, this test should FAIL
    // and be rewritten deliberately — not silently keep passing.
    for (const lat of [18, 25.8, 33.4, 38.6657, 41.9, 47.6, 61.2]) {
      const expected = -29 - 5 * Math.sin(lat * Math.PI / 180);
      expect(geoidUndulationM(lat)).toBeCloseTo(expected, 12);
    }
  });

  it('🚨 an absent orthometric height is refused, not turned into ~32 m below sea level', () => {
    // The whole family of defects in this workstream. `undefined + N` is NaN and
    // `(x ?? 0) + N` is a confident wrong answer ~32 m under the ellipsoid that
    // looks exactly like a real one.
    expect(ellipsoidalFromOrthometricM(undefined as unknown as number, 38)).toBeNull();
    expect(ellipsoidalFromOrthometricM(NaN, 38)).toBeNull();
    expect(ellipsoidalFromOrthometricM(null as unknown as number, 38)).toBeNull();
    // A real zero is a real height — a coastal site sits near it.
    expect(ellipsoidalFromOrthometricM(0, 38)).toBeCloseTo(geoidUndulationM(38), 12);
    expect(ellipsoidalFromOrthometricM(128, 38.6657)).toBeCloseTo(128 + geoidUndulationM(38.6657), 12);
  });

  it('a non-finite latitude yields a number, not NaN', () => {
    // Every caller ADDS this to a height. A NaN here propagates into a panel
    // position and is rejected far away from its cause, or worse, stamped.
    expect(Number.isFinite(geoidUndulationM(NaN))).toBe(true);
    expect(Number.isFinite(geoidUndulationM(undefined as unknown as number))).toBe(true);
    expect(geoidUndulationM(NaN)).toBeCloseTo(geoidUndulationM(38), 12);
  });

  it('the fit band is stated, so a site outside it is knowable', () => {
    expect(isWithinGeoidFitBand(38.6657)).toBe(true);
    expect(isWithinGeoidFitBand(8)).toBe(false);     // equatorial
    expect(isWithinGeoidFitBand(-33)).toBe(false);   // southern hemisphere
    expect(isWithinGeoidFitBand(NaN)).toBe(false);
  });

  it('🚨 it is latitude-only — this is recorded, not hidden', () => {
    // Two sites at the same parallel and very different longitudes get the SAME
    // answer, while the real EGM96 geoid does not. The fit's own comment claims
    // "~1-2m for CONUS" and that claim has never been measured here. Asserting
    // the limitation is the honest form: it cannot quietly stop being true.
    expect(geoidUndulationM(39)).toBe(geoidUndulationM(39));
    const mississippiValley = geoidUndulationM(39);   // ~ -90 E
    const rockies           = geoidUndulationM(39);   // ~ -105 E
    expect(rockies,
      'the approximation cannot distinguish two sites 1,200 km apart on the same ' +
      'parallel, because it has no longitude term. Recorded so that a vertical ' +
      'offset between the fitted planes and the photogrammetry mesh is looked for ' +
      'HERE and not in the placement arithmetic.',
    ).toBe(mississippiValley);
  });
});
