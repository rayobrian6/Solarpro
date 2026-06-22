import { describe, it, expect } from 'vitest';
import { runStructuralCalcV4, type StructuralInputV4 } from '../lib/structural-engine-v4';

// SolFence vertical bifacial solar fence (analyzeFence). The governing load is
// WIND on the full face (ASCE 7-22 §29.3 freestanding wall) carried to each post.
// Pass/fail DEFERS to the SolFence 115-mph rating and stays engineered:false
// (ESTIMATE) until a PE validates against SolFence's stamped load tables.
function fenceInput(overrides: Partial<StructuralInputV4> = {}): StructuralInputV4 {
  return {
    installationType: 'fence',
    windSpeed: 115,
    windExposure: 'C',
    groundSnowLoad: 30,
    meanRoofHeight: 6,
    roofPitch: 0,
    framingType: 'unknown',
    rafterSize: 'N/A',
    rafterSpacingIn: 0,
    rafterSpanFt: 0,
    panelCount: 24,            // 12 sections × 2 panels
    panelLengthIn: 79,
    panelWidthIn: 44,
    panelWeightLbs: 49,
    panelOrientation: 'landscape',
    mountingSystemId: 'ironridge-xr100',
    fenceHeightFt: 6,
    postSpacingFt: 8,
    fenceLengthFt: 96,         // 12 sections × 8 ft → B/s = 16
    groundClearanceFt: 0.17,
    ...overrides,
  };
}

describe('analyzeFence (SolFence freestanding wall)', () => {
  it('routes fence to its own engine — no roof rafter/mount stamp, ESTIMATE only', () => {
    const r = runStructuralCalcV4(fenceInput());
    expect(r.installationType).toBe('fence');
    expect(r.engineered).toBe(false);          // never engineered until PE sign-off
    expect(r.status).toBe('WARNING');          // always ESTIMATE
    expect(r.fenceMountAnalysis).toBeDefined();
    expect(r.rafterAnalysis.size).toBe('N/A'); // a fence has no rafters
    expect(r.rafterAnalysis.notes.join(' ')).toMatch(/no rafters/i);
  });

  it('uses the ASCE 7-22 Fig 29.3-1 overall Cf (~1.3 for a long wall on grade), not the old flat 1.8', () => {
    const r = runStructuralCalcV4(fenceInput());
    const f = r.fenceMountAnalysis!;
    // B/s = 96/6 = 16 → long wall → overall Case A/B Cf = 1.30 (web-verified).
    expect(f.forceCoefficientCf).toBeCloseTo(1.30, 2);
  });

  it('Cf increases for short runs (lower B/s) per the figure table', () => {
    const long = runStructuralCalcV4(fenceInput({ fenceLengthFt: 96 }));   // B/s 16 → 1.30
    const short = runStructuralCalcV4(fenceInput({ fenceLengthFt: 12 }));  // B/s 2  → 1.40
    expect(short.fenceMountAnalysis!.forceCoefficientCf).toBeGreaterThan(
      long.fenceMountAnalysis!.forceCoefficientCf,
    );
    expect(short.fenceMountAnalysis!.forceCoefficientCf).toBeCloseTo(1.40, 2);
  });

  it('passes at the SolFence rated wind and flags overages above 115 mph', () => {
    const ok = runStructuralCalcV4(fenceInput({ windSpeed: 115 }));
    expect(ok.fenceMountAnalysis!.exceedsRatedWind).toBe(false);
    expect(ok.fenceMountAnalysis!.passes).toBe(true);

    const over = runStructuralCalcV4(fenceInput({ windSpeed: 150 }));
    expect(over.fenceMountAnalysis!.exceedsRatedWind).toBe(true);
    expect(over.fenceMountAnalysis!.passes).toBe(false);
    expect(over.warnings.some((w) => w.code === 'FENCE_WIND_EXCEEDS_RATING')).toBe(true);
  });

  it('foundation is driven steel, embedment clears frost, end post called out as governing', () => {
    const r = runStructuralCalcV4(fenceInput({ frostDepthIn: 48 })); // 4 ft frost
    const f = r.fenceMountAnalysis!;
    expect(f.footingType).toBe('driven_steel');
    // max(4 ft driven, frost 4 ft + 0.5) = 4.5 ft, frost-governed
    expect(f.requiredEmbedmentFt).toBeCloseTo(4.5, 2);
    expect(f.embedmentGovernedBy).toBe('frost');
    expect(r.recommendations.join(' ')).toMatch(/WINDWARD-END post/i);
    expect(r.recommendations.join(' ')).toMatch(/ESTIMATE — not engineered/i);
  });
});
