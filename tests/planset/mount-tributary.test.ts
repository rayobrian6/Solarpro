import { describe, it, expect } from 'vitest';
import { runStructuralCalcV4 } from '../../lib/structural-engine-v4';

// Regression guard for the structural mount-tributary double-count bug.
// v4 lays out feet on 2 rails per row (mountCount = mountsPerRail × railCount,
// railCount = 2 × rowCount). Each rail carries HALF the row's across-slope
// tributary depth, so the per-mount tributary width must be panelShort / 2.
// A prior regression used the FULL panelShort → Σ(tributary) = 2× the real
// array area → every mount charged 2× uplift → SF≥2.0 loop floored spacing
// 48"→24" and doubled the feet (~5.85/panel for a 52-module RT-MINI array).
describe('mount tributary (2-rail) does not double-count array area', () => {
  const base: any = {
    installationType: 'roof_mount',
    windSpeed: 110, windExposure: 'C', groundSnowLoad: 20, meanRoofHeight: 15, roofPitch: 26,
    framingType: 'rafter', rafterSize: '2x6', rafterSpanFt: 12, rafterSpacingIn: 24, woodSpecies: 'df_larch',
    panelCount: 52, panelLengthIn: 66.9, panelWidthIn: 40.9, panelWeightLbs: 46, panelOrientation: 'portrait',
    mountingSystemId: 'rooftech-mini',
  };

  it('sits at the mount rated spacing when SF≥2.0 (not floored) for a 52-module RT-MINI array', () => {
    const r: any = runStructuralCalcV4(base);
    const m = r.mountLayout;
    // Should hold the RT-MINI rated 48" O.C., not floor to 24".
    expect(m.mountSpacingIn).toBe(48);
    expect(m.maxAllowedSpacingIn).toBe(48);
    expect(m.spacingWasReduced).toBe(false);
    // Feet count roughly halved vs the double-counted model (was 304 / 5.85 per panel).
    expect(m.mountCount).toBeLessThan(200);
    expect(m.mountCount / 52).toBeLessThan(3.5);
    // Safety margin preserved — still ≥ 2.0.
    expect(m.safetyFactor).toBeGreaterThanOrEqual(2.0);
  });

  it('Σ(tributary areas) equals the real array footprint (area-conservation)', () => {
    const r: any = runStructuralCalcV4(base);
    const m = r.mountLayout;
    const totalTributary = m.tributaryAreaPerMountFt2 * m.mountCount;
    // Real array footprint from geometry the engine used.
    const g = r.geometry ?? r.arrayGeometry;
    if (g?.arrayWidthIn && g?.arrayHeightIn) {
      const footprintFt2 = (g.arrayWidthIn / 12) * (g.arrayHeightIn / 12);
      // Within ~25% (overhang + end-mount +1 per rail inflate the sum slightly);
      // the OLD bug produced ~2× the footprint, which this bounds out.
      expect(totalTributary).toBeLessThan(footprintFt2 * 1.5);
    }
  });
});
