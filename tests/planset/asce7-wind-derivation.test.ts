// R8 - THE WIND DERIVATION IS WRITTEN DOWN (2026-08-29)
//
// The package published a velocity pressure and a net uplift and NOTHING else.
// Across all twenty sheets there was not one occurrence of Kz, Kzt, Kd, Ke, the
// mean roof height, the enclosure classification or the effective wind area. The
// engineer being asked to seal it could not check the number they were sealing.
//
// Behind it, `getGCp()` returned a hardcoded {interior -1.5, edge -2.0, corner
// -2.5} under the comment "ASCE 7-22 Figure 29.4-7" - with no dependence on
// effective wind area, panel tilt or the array-edge factor the figure requires,
// and Fig. 29.4-7 governs roofs with slopes LESS THAN 7 degrees. The audited roof
// is 3.6:12 = 16.5 degrees, so the cited figure never applied to it.
//
// This does not invent a steep-roof coefficient set. It makes the derivation
// auditable and CHECKS the applicability limit, so a reviewer accepts or replaces
// the assumption knowingly instead of inheriting it invisibly.
import { describe, it, expect } from 'vitest';
import {
  velocityPressure, rooftopSolarPressureCoefficient, velocityPressureCoefficient,
  ROOFTOP_SOLAR_MAX_SLOPE_DEG,
} from '@/lib/structural/asce7Wind';

describe('every factor in Eq. 26.10-1 carries its own basis', () => {
  const r = velocityPressure({ windSpeedMph: 108, exposure: 'C', meanRoofHeightFt: 15 });

  it('qz reproduces from the stated factors', () => {
    const kz = velocityPressureCoefficient(15, 'C');
    expect(r.qzPsf).toBeCloseTo(0.00256 * kz * 1.0 * 0.85 * 1.0 * 108 * 108, 6);
  });

  it('and every symbol names the table it came from', () => {
    const syms = r.factors.map(f => f.symbol);
    expect(syms).toEqual(['Kz', 'Kzt', 'Kd', 'Ke']);
    for (const f of r.factors) expect(f.basis, f.symbol).toMatch(/ASCE 7-22/);
    expect(r.factors.find(f => f.symbol === 'Kd')!.basis).toMatch(/Table 26\.6-1/);
    expect(r.factors.find(f => f.symbol === 'Kz')!.basis).toMatch(/Table 26\.10-1/);
  });

  it('the derivation is the arithmetic a reviewer would redo', () => {
    expect(r.derivation).toMatch(/qz = 0\.00256/);
    expect(r.derivation).toMatch(/Eq\. 26\.10-1/);
  });
});

describe('the cited figure is CHECKED against the roof it is cited for', () => {
  it('a 16.5 degree roof exceeds Fig. 29.4-7 and says so', () => {
    const g = rooftopSolarPressureCoefficient('corner', 16.5);
    expect(g.applicabilityExceeded).toBe(true);
    expect(g.applicabilityNote).toMatch(/LESS THAN 7/);
    expect(g.applicabilityNote).toMatch(/ENGINEERING ASSUMPTION|engineer of record/i);
    // it does NOT claim the figure as its source when the figure does not govern
    expect(g.basis).not.toMatch(/Fig\. 29\.4-7/);
    expect(g.basis).toMatch(/ENGINEERING ASSUMPTION/);
  });

  it('a low-slope roof cites the figure, because there it applies', () => {
    const g = rooftopSolarPressureCoefficient('corner', 3);
    expect(g.applicabilityExceeded).toBe(false);
    expect(g.applicabilityNote).toBeNull();
    expect(g.basis).toMatch(/Fig\. 29\.4-7/);
  });

  it('the limit is the code limit, not a number chosen here', () => {
    expect(ROOFTOP_SOLAR_MAX_SLOPE_DEG).toBe(7);
    expect(rooftopSolarPressureCoefficient('corner', 6.9).applicabilityExceeded).toBe(false);
    expect(rooftopSolarPressureCoefficient('corner', 7.1).applicabilityExceeded).toBe(true);
  });

  it('the coefficient VALUES are unchanged - this repair is about disclosure', () => {
    expect(rooftopSolarPressureCoefficient('interior', 3).uplift).toBe(-1.5);
    expect(rooftopSolarPressureCoefficient('edge', 3).uplift).toBe(-2.0);
    expect(rooftopSolarPressureCoefficient('corner', 3).uplift).toBe(-2.5);
  });
});
