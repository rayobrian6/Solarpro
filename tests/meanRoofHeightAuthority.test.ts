/**
 * tests/meanRoofHeightAuthority.test.ts
 *
 * THE PERMIT'S WIND ANALYSIS RAN ON A HARDCODED 15 FT.
 *
 * These cases pin the resolver that replaces that literal, and — the part that
 * matters — pin the DIRECTION of every fallback. A resolver that silently produced
 * a plausible number for an unmeasured building would be the same defect with more
 * code: the whole point is that a height which is an assumption reports itself as
 * one, so PV-4C can say so on a sheet somebody seals.
 */

import { describe, it, expect } from 'vitest';
import {
  MEAN_ROOF_HEIGHT_MAX_FT,
  NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT,
  projectMeanRoofHeight,
} from '@/lib/structural/meanRoofHeightAuthority';

const M = (ft: number) => ft / 3.28084;

describe('mean roof height — what the operator said', () => {
  it('🚨 the operator\'s Structural-tab entry WINS over a modelled estimate', () => {
    const a = projectMeanRoofHeight({
      operatorStatedFt: 26,
      wallPlanes: [{ estimatedHeightM: M(10) }, { estimatedHeightM: M(10) }],
      stories: 1, roofSlopeDeg: 22, roofSpanFt: 30,
    });
    // A person choosing "2-storey" or typing 26 is STATING something about the
    // building; `estimatedHeightM` calls itself an estimate. Preferring the estimate
    // would be the placement rule inverted.
    expect(a.source).toBe('operator');
    expect(a.heightFt).toBe(26);
    expect(a.established).toBe(true);
  });

  it('and the sheet says the height was entered, not derived', () => {
    const a = projectMeanRoofHeight({ operatorStatedFt: 26 });
    expect(a.sheetBasis).toMatch(/as entered/i);
    expect(a.basis).toMatch(/Structural tab/i);
  });

  it('🚨 an out-of-range entry is REJECTED with its reason, not clamped', () => {
    const a = projectMeanRoofHeight({ operatorStatedFt: 250, stories: 2 });
    expect(a.source).not.toBe('operator');
    expect(a.heightFt).toBe(25);                 // fell through to the storey count
    expect(a.basis).toMatch(/250 ft is outside/);
    expect(a.basis).toMatch(/NOT used/);
  });

  it('falls through cleanly when the operator set nothing', () => {
    for (const v of [undefined, null, 0, NaN] as const) {
      const a = projectMeanRoofHeight({ operatorStatedFt: v as number, stories: 2 });
      expect(a.source, `operatorStatedFt=${String(v)}`).toBe('storey_count');
    }
  });
});

describe('mean roof height — modelled geometry', () => {
  it('averages the eave and the ridge, per ASCE 7-22 §26.3', () => {
    // 20 ft eave, 30 ft span at 22° → rise = 15·tan22° = 6.06 ft → h = 20 + 3.03
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: M(20) }, { estimatedHeightM: M(20) }],
      roofSlopeDeg: 22, roofSpanFt: 30,
    });
    expect(a.source).toBe('wall_geometry');
    expect(a.established).toBe(true);
    expect(a.heightFt).toBeCloseTo(23, 0);
    expect(a.sheetBasis).toMatch(/ridge rise/);
  });

  it('🚨 takes the LOWEST wall, because a gable end runs to the ridge', () => {
    // A gable-end plane is taller than the eave walls. Taking the max would report
    // the ridge as the eave and then add half a ridge rise on top of it.
    const a = projectMeanRoofHeight({
      wallPlanes: [
        { estimatedHeightM: M(10) },  // eave walls
        { estimatedHeightM: M(10) },
        { estimatedHeightM: M(17) },  // gable end, up to the ridge
      ],
      roofSlopeDeg: 25, roofSpanFt: 28,
    });
    // eave 10 + half of (14·tan25° = 6.53) = 13.3 — NOT 17-and-up
    expect(a.heightFt).toBeCloseTo(13.3, 1);
    expect(a.heightFt).toBeLessThan(17);
  });

  it('uses the eave alone at 10° or less, per §26.3', () => {
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: M(18) }], roofSlopeDeg: 8, roofSpanFt: 40,
    });
    expect(a.heightFt).toBeCloseTo(18, 1);
    expect(a.sheetBasis).toMatch(/26\.3/);
    expect(a.established).toBe(true);
  });

  it('says so when there is no span to raise a ridge over', () => {
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: M(12) }], roofSlopeDeg: 30, roofSpanFt: 0,
    });
    expect(a.heightFt).toBeCloseTo(12, 1);
    expect(a.basis).toMatch(/no roof span on file/);
  });

  it('🚨 REJECTS an out-of-range estimate instead of clamping it', () => {
    // A clamped number would carry `established: true` and a geometry basis — a
    // fabrication wearing a measurement's provenance.
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: M(400) }], roofSlopeDeg: 20, roofSpanFt: 30,
      stories: 2,
    });
    expect(a.source).not.toBe('wall_geometry');
    expect(a.established).toBe(false);
    expect(a.heightFt).toBeLessThanOrEqual(MEAN_ROOF_HEIGHT_MAX_FT);
    expect(a.basis, 'the rejection and its reason must travel').toMatch(/NOT used/);
  });

  it('ignores null and non-positive wall heights rather than treating them as zero', () => {
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: null }, { estimatedHeightM: 0 }, { estimatedHeightM: M(22) }],
      roofSlopeDeg: 5,
    });
    expect(a.heightFt).toBeCloseTo(22, 1);
    expect(a.established).toBe(true);
  });
});

describe('mean roof height — storey count', () => {
  it('reproduces the app\'s own convention: 1→15, 2→25, 3→35', () => {
    for (const [stories, ft] of [[1, 15], [2, 25], [3, 35]] as const) {
      const a = projectMeanRoofHeight({ stories });
      expect(a.heightFt, `${stories} storeys`).toBe(ft);
      expect(a.source).toBe('storey_count');
    }
  });

  it('🚨 is NEVER reported as established — it is a classification, not a measurement', () => {
    const a = projectMeanRoofHeight({ stories: 3 });
    expect(a.established).toBe(false);
    expect(a.sheetBasis, 'the sheet must be able to say this is not measured')
      .toMatch(/NOT a measured height/);
    expect(a.sheetBasis, 'and must spell out the convention it used').toMatch(/per storey/);
  });

  it('a modelled wall height WINS over the storey count', () => {
    const a = projectMeanRoofHeight({
      wallPlanes: [{ estimatedHeightM: M(9) }], stories: 3, roofSlopeDeg: 5,
    });
    expect(a.source).toBe('wall_geometry');
    expect(a.heightFt).toBeCloseTo(9, 1);
  });
});

describe('mean roof height — the nominal', () => {
  it('🚨 still 15 ft, so an unmeasured building\'s numbers do not move', () => {
    // Deliberate: this change is about what the sheet SAYS, not about silently
    // re-pricing every design that has no building height on file.
    const a = projectMeanRoofHeight({});
    expect(a.heightFt).toBe(NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT);
    expect(a.heightFt).toBe(15);
  });

  it('🚨 but it declares itself, which the bare literal never did', () => {
    const a = projectMeanRoofHeight({ wallPlanes: [], stories: null });
    expect(a.established).toBe(false);
    expect(a.source).toBe('nominal');
    expect(a.sheetBasis).toMatch(/NOMINAL/);
    expect(a.sheetBasis).toMatch(/no building height on file/);
  });

  it('rejects a storey count below one rather than inventing a basement', () => {
    const a = projectMeanRoofHeight({ stories: 0 });
    expect(a.source).toBe('nominal');
  });

  it('always returns a finite, positive, analysable height', () => {
    for (const args of [
      {}, { stories: NaN }, { stories: -4 }, { wallPlanes: null },
      { wallPlanes: [{ estimatedHeightM: NaN }] },
      { roofSlopeDeg: NaN, roofSpanFt: NaN },
    ]) {
      const a = projectMeanRoofHeight(args as Parameters<typeof projectMeanRoofHeight>[0]);
      expect(Number.isFinite(a.heightFt)).toBe(true);
      expect(a.heightFt).toBeGreaterThan(0);
      expect(a.heightFt).toBeLessThanOrEqual(MEAN_ROOF_HEIGHT_MAX_FT);
    }
  });
});

describe('🚨 the height actually changes the wind pressure — the reason this matters', () => {
  it('a 3-storey building analyses at a materially higher Kz than 15 ft', async () => {
    // Not a unit of this module: the POINT of the module. If Kz were flat in height
    // the hardcoded 15 would have been harmless, and this whole repair pointless.
    const { velocityPressure } = await import('@/lib/structural/asce7Wind');
    const at = (h: number) => velocityPressure({
      windSpeedMph: 115, exposure: 'C', meanRoofHeightFt: h,
    }).qzPsf;

    const oneStorey = at(projectMeanRoofHeight({ stories: 1 }).heightFt);
    const threeStorey = at(projectMeanRoofHeight({ stories: 3 }).heightFt);

    expect(threeStorey).toBeGreaterThan(oneStorey);
    // ~22 % on Exposure C (Kz 0.85 → 1.04). Asserted as a ratio band rather than a
    // number, so a legitimate Kz-table correction does not fail this case.
    expect(threeStorey / oneStorey).toBeGreaterThan(1.1);
  });
});
