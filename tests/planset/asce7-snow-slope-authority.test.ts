// R7 - THE SNOW SLOPE FACTOR (2026-08-29)
//
// Both structural engines computed
//     const Cs = pitchDeg <= 5 ? 1.0 : Math.cos(pitchDeg * Math.PI / 180);
// under a comment citing "ASCE 7-22 Section 7.4". cos(theta) is not any curve in
// Figure 7.4-1.
//
// The real factor depends on the roof's thermal condition and on whether its
// surface is SLIPPERY. A warm roof that is NOT slippery - asphalt shingle is the
// textbook case - holds Cs = 1.0 all the way to 30 degrees. On the audited job
// (3.6:12 = 16.5 deg, shingle, heated dwelling) the engine applied cos(16.5) =
// 0.959 and published 15.6 psf where the code gives 16.30: a 4.3% understatement
// of a design load, in the UNCONSERVATIVE direction.
//
// And it was two implementations of one figure: structural-engine-v3 already had
// the correct non-slippery curve. The engine that ships had the wrong one.
import { describe, it, expect } from 'vitest';
import { calcRoofSnow, snowSlopeFactor, isSlipperyRoofSurface } from '@/lib/structural/asce7Snow';

describe('Figure 7.4-1, not cos(theta)', () => {
  it('a shingle roof at 16.5 degrees holds ALL of its snow', () => {
    const r = calcRoofSnow({ groundSnowPsf: 23.284, pitchDeg: 16.5, roofCovering: 'shingle' });
    expect(r.Cs).toBe(1.0);
    expect(r.flatRoofPsf).toBeCloseTo(16.30, 2);
    expect(r.roofSnowPsf).toBeCloseTo(16.30, 2);
    // the number the engine used to publish
    expect(r.roofSnowPsf).toBeGreaterThan(15.63);
  });

  it('a SLIPPERY roof sheds from 5 degrees, per the other curve', () => {
    const metal = snowSlopeFactor(16.5, 'standing seam metal');
    expect(metal.slippery).toBe(true);
    expect(metal.Cs).toBeCloseTo(1 - (16.5 - 5) / 65, 4);
    expect(metal.Cs).toBeLessThan(1);
  });

  it('the two curves meet at their endpoints', () => {
    for (const cov of ['shingle', 'metal']) {
      expect(snowSlopeFactor(0, cov).Cs).toBe(1.0);
      expect(snowSlopeFactor(75, cov).Cs).toBe(0);
    }
    // non-slippery is flat until 30
    expect(snowSlopeFactor(29.9, 'shingle').Cs).toBe(1.0);
    expect(snowSlopeFactor(45, 'shingle').Cs).toBeCloseTo(1 - 15 / 40, 4);
  });

  it('slipperiness is a property of the covering, and unknown fails CONSERVATIVE', () => {
    expect(isSlipperyRoofSurface('asphalt shingle')).toBe(false);
    expect(isSlipperyRoofSurface('wood shake')).toBe(false);
    expect(isSlipperyRoofSurface('clay tile')).toBe(false);
    expect(isSlipperyRoofSurface('standing seam metal')).toBe(true);
    expect(isSlipperyRoofSurface('slate')).toBe(true);
    // a "metal shingle" is an obstructed surface - the shingle wins
    expect(isSlipperyRoofSurface('metal shingle')).toBe(false);
    // unknown / absent => not slippery => MORE snow retained
    expect(isSlipperyRoofSurface(null)).toBe(false);
    expect(isSlipperyRoofSurface('unobtainium')).toBe(false);
  });

  it('the derivation states what a reviewer would redo', () => {
    const r = calcRoofSnow({ groundSnowPsf: 23.284, pitchDeg: 16.5, roofCovering: 'shingle' });
    expect(r.derivation).toMatch(/pf = 0\.7/);
    expect(r.derivation).toMatch(/Fig\. 7\.4-1/);
    expect(r.derivation).toMatch(/non-slippery/);
  });

  it('cos(pitch) is not reproduced by any branch', () => {
    // The retired formula, asserted absent across the whole practical range.
    for (let p = 6; p <= 29; p += 1) {
      expect(snowSlopeFactor(p, 'shingle').Cs).not.toBeCloseTo(Math.cos(p * Math.PI / 180), 3);
    }
  });
});
