/**
 * tests/shadeIsObstruction.test.ts
 *
 * A SHADE FACTOR IS A RATIO OF IRRADIANCE. 1.0 MEANS NOTHING IS IN THE WAY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE NUMBER ACTUALLY WAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `shadeFactor()` returns `max(0, dot(panelNormal, sunVector))` — the cosine of
 * the angle of incidence. It says nothing about obstructions; the obstruction
 * test is a separate branch. The annual number divided the cosine-weighted sum
 * by the weights alone:
 *
 *     annualFactor = Σ(cos_i · w_i) / Σ(w_i)          ← the MEAN COSINE
 *
 * so a perfectly clear south-facing roof at 38.7°N came out at about 0.73 and
 * the product reported "26.6% annual shade loss" with NOTHING IN THE SCENE. A
 * flat deck reported 35%. `lib/pvwatts.ts` then stacked that on the 14% baseline
 * and on PVWatts' own tilt/azimuth factors — which already account for
 * orientation — so a clear roof's production was multiplied by ~0.73.
 *
 * 🚨 ORIENTATION HAS EXACTLY ONE OWNER AND IT IS NOT THIS FUNCTION. What this
 * function owns is obstruction, so the denominator is the irradiance the same
 * panel would receive under an unobstructed sky:
 *
 *     annualFactor = Σ(cos_i · w_i · visible_i) / Σ(cos_i · w_i)
 *
 * The cosine now weights each hour by what it was worth to THIS panel, which is
 * what a weight is for, instead of masquerading as a loss.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE OLD TESTS DID NOT CATCH IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * They asserted that adding an obstruction made the number go DOWN, and it did.
 * A relative check cannot see an absolute offset. The first assertion below is
 * the one that had to exist: an empty sky is 1.0.
 */

import { describe, it, expect } from 'vitest';
import { computeShadeAnalysis } from '@/lib/shadeAnalysis';

// 3 Melvin Dr — the site the gauntlet keeps returning to.
const LAT = 38.70615;
const LNG = -90.04625;

type Panel = {
  id: string; lat: number; lng: number; tilt: number; azimuth: number; row?: number;
};

const panel = (over: Partial<Panel> = {}): Panel => ({
  id: 'p1', lat: LAT, lng: LNG, tilt: 25, azimuth: 180, row: 0, ...over,
});

/**
 * A fixed reference year, so these assert physics rather than the date the suite
 * happens to run on. The signature is positional:
 * computeShadeAnalysis(panels, lat, lng, obstruction?, rowSpacingM?, panelHeightM?, year?)
 */
const YEAR = 2025;

/** Run one panel with the given obstruction profile and return its factor. */
function factorFor(p: Panel, profile: any = { nearbyObstruction: [] }): number {
  const res: any = computeShadeAnalysis(
    [p] as never, LAT, LNG, profile, 1.5, 1.134, YEAR,
  );
  return res.panelShadeFactors[p.id];
}

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 an empty sky is not shade', () => {
  it('a clear south-facing 25° roof reports 1.0, not 0.73', () => {
    // 🚨 THE ASSERTION THAT HAD TO EXIST. Under the old formula this was
    // 0.734398 — "26.6% annual shade loss" on a roof with nothing near it.
    expect(factorFor(panel())).toBeCloseTo(1.0, 6);
  });

  it('…and so does every other orientation, which is the whole point', () => {
    // The old number varied with tilt and azimuth because it WAS orientation.
    // A shade factor must not: an unshaded north-facing roof is unshaded. It
    // produces less, and PVWatts is the thing that says so.
    for (const tilt of [0, 5, 15, 25, 40, 60]) {
      for (const azimuth of [90, 135, 180, 225, 270, 0]) {
        const f = factorFor(panel({ tilt, azimuth }));
        expect(f, `tilt ${tilt} azimuth ${azimuth} reports shade on a clear sky`)
          .toBeCloseTo(1.0, 6);
      }
    }
  });

  it('a flat deck is 1.0 — it used to report 35% loss', () => {
    expect(factorFor(panel({ tilt: 0, azimuth: 180 }))).toBeCloseTo(1.0, 6);
  });

  it('an undefined profile is still a clear sky, not a penalty', () => {
    expect(factorFor(panel(), undefined)).toBeCloseTo(1.0, 6);
    expect(factorFor(panel(), {})).toBeCloseTo(1.0, 6);
  });
});

describe('🚨 an obstruction still costs what it should', () => {
  /**
   * A tree `distM` from the panel on the given bearing, standing `heightM`
   * ABOVE THE PANEL -- which is what the profile means by heightM, not the
   * tree's own height. `arcDeg` is its angular width.
   */
  const tree = (distM: number, heightM: number, azimuthDeg = 180, arcDeg = 40) => ({
    nearbyObstruction: [{ azimuthDeg, distanceM: distM, heightM, arcDeg }],
  });

  it('a tall tree due south takes a large bite', () => {
    const clear = factorFor(panel());
    const shaded = factorFor(panel(), tree(6, 10));
    expect(clear).toBeCloseTo(1.0, 6);
    expect(shaded, 'a 10 m tree 6 m south did nothing').toBeLessThan(0.9);
    expect(shaded, 'shade cannot be negative').toBeGreaterThanOrEqual(0);
  });

  it('the same tree further away costs less', () => {
    const near = factorFor(panel(), tree(5, 10));
    const far = factorFor(panel(), tree(40, 10));
    expect(near).toBeLessThan(far);
  });

  it('a taller tree at the same distance costs more', () => {
    const short = factorFor(panel(), tree(8, 4));
    const tall = factorFor(panel(), tree(8, 14));
    expect(tall).toBeLessThan(short);
  });

  it('🚨 a tree 100 m away is not a tree at all', () => {
    // The check that proves the scene is being read rather than a constant
    // returned: move the occluder out of the sky and the answer must come back
    // to exactly clear.
    expect(factorFor(panel(), tree(100, 10))).toBeCloseTo(factorFor(panel()), 4);
  });

  it('an obstruction due NORTH of a south-facing roof barely matters', () => {
    // At 38.7°N the sun is never in the northern sky at a useful elevation, so
    // this is a physical check that the azimuth is being honoured.
    const north = factorFor(panel(), tree(6, 10, 0));
    const south = factorFor(panel(), tree(6, 10));
    expect(north).toBeGreaterThan(south);
    expect(north).toBeGreaterThan(0.95);
  });

  it('a wall all the way round blocks nearly everything', () => {
    const profile = {
      nearbyObstruction: Array.from({ length: 12 }, (_, i) => ({
        azimuthDeg: i * 30, distanceM: 3, heightM: 30, arcDeg: 40,
      })),
    };
    expect(factorFor(panel(), profile)).toBeLessThan(0.25);
  });

  it('the factor stays inside [0, 1] for every case above', () => {
    const cases = [
      factorFor(panel()),
      factorFor(panel(), tree(5, 10)),
      factorFor(panel(), tree(1, 50)),
      factorFor(panel({ tilt: 0 }), tree(2, 30)),
    ];
    for (const f of cases) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('🚨 the system derate follows the panels', () => {
  it('a clear array reports no system shade loss', () => {
    const res: any = computeShadeAnalysis(
      [panel({ id: 'a' }), panel({ id: 'b', lng: LNG + 0.00002 })] as never,
      LAT, LNG, { nearbyObstruction: [] }, 1.5, 1.134, YEAR,
    );
    // This is the number that reached pvwatts and became a 26.6% derate.
    expect(res.systemShadeDeratePct).toBeCloseTo(0, 4);
  });

  it('…and a shaded one reports a real loss', () => {
    const res: any = computeShadeAnalysis(
      [panel({ id: 'a' })] as never, LAT, LNG,
      { nearbyObstruction: [{ azimuthDeg: 180, distanceM: 4, heightM: 12, arcDeg: 60 }] },
      1.5, 1.134, YEAR,
    );
    expect(res.systemShadeDeratePct).toBeGreaterThan(5);
    expect(res.systemShadeDeratePct).toBeLessThanOrEqual(100);
  });
});
