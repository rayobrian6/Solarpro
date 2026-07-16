import { describe, it, expect } from 'vitest';
import { runStructuralCalcV4 } from '../../lib/structural-engine-v4';
import { resolveArrayStructuralLayout } from '../../lib/permit/utils/arrayLayout';
import { allowableUpliftLbs, asdUpliftDemandLbs, MIN_ATTACHMENT_SF, OMEGA_ULTIMATE_TO_ALLOWABLE, ASD_WIND_FACTOR } from '../../lib/structural/attachmentCapacity';

// Regression guard for the structural mount-tributary double-count bug.
// v4 lays out feet on 2 rails per row (mountCount = mountsPerRail × railCount,
// railCount = 2 × rowCount). Each rail carries HALF the row's across-slope
// tributary depth, so the per-mount tributary width must be panelShort / 2.
// A prior regression used the FULL panelShort → Σ(tributary) = 2× the real
// array area → every mount charged 2× uplift → SF≥2.0 loop floored spacing
// 48"→24" and doubled the feet (304 / 5.85 per panel for a 52-module array).
describe('mount tributary (2-rail) does not double-count array area', () => {
  const mk = (orientation: 'portrait' | 'landscape'): any => ({
    installationType: 'roof_mount',
    windSpeed: 110, windExposure: 'C', groundSnowLoad: 20, meanRoofHeight: 15, roofPitch: 26,
    framingType: 'rafter', rafterSize: '2x6', rafterSpanFt: 12, rafterSpacingIn: 24, woodSpecies: 'df_larch',
    panelCount: 52, panelLengthIn: 66.9, panelWidthIn: 40.9, panelWeightLbs: 46, orientation, panelOrientation: orientation,
    mountingSystemId: 'rooftech-mini',
  });

  it('roughly halves the feet vs the double-counted model, at ASD SF ≥ 1.0', () => {
    const r: any = runStructuralCalcV4(mk('landscape'));
    const m = r.mountLayout;
    // Was 304 (5.85/panel) under the double-count; now ~160 (3.08/panel).
    expect(m.mountCount).toBeLessThan(200);
    expect(m.mountCount / 52).toBeLessThan(3.5);
    // ASD check: demand and capacity both ASD, PASS at SF ≥ 1.0.
    expect(m.safetyFactor).toBeGreaterThanOrEqual(MIN_ATTACHMENT_SF);
    // Never exceeds the mount's rated max spacing.
    expect(m.mountSpacingIn).toBeLessThanOrEqual(m.maxAllowedSpacingIn);
  });

  it('normalizes across brands: an allowable-basis mount needs no fewer feet than a conservative ultimate one under the same load', () => {
    // IronRidge FlashFoot-class (published ALLOWABLE) vs RT-MINI (unverified →
    // conservative ULTIMATE ÷Ω). Both must pass SF ≥ 1.0; the allowable-basis
    // mount should not be penalized with MORE feet than the conservative one —
    // the old code did the opposite (triple-counted safety on allowable mounts).
    const iron: any = runStructuralCalcV4({ ...mk('portrait'), mountingSystemId: 'ironridge-xr100' }).mountLayout;
    const rt: any = runStructuralCalcV4(mk('portrait')).mountLayout;
    expect(iron.safetyFactor).toBeGreaterThanOrEqual(MIN_ATTACHMENT_SF);
    expect(rt.safetyFactor).toBeGreaterThanOrEqual(MIN_ATTACHMENT_SF);
    expect(iron.mountCount).toBeLessThanOrEqual(rt.mountCount);
  });

  it('Σ(tributary areas) equals the real array footprint (area-conservation)', () => {
    const r: any = runStructuralCalcV4(mk('landscape'));
    const m = r.mountLayout;
    const g = r.arrayGeometry;
    const totalTributary = m.tributaryAreaPerMountFt2 * m.mountCount;
    const footprintFt2 = (g.arrayWidthIn / 12) * (g.arrayHeightIn / 12);
    // Within ~50% (overhang + the +1 end mount per rail inflate the sum
    // slightly); the OLD bug produced ~2× the footprint, which this bounds out.
    expect(totalTributary).toBeLessThan(footprintFt2 * 1.5);
  });
});

// The basis-normalized ASD attachment check (single source of truth).
describe('attachmentCapacity normalizes capacity basis + ASD demand', () => {
  it('reduces an ULTIMATE rating by Ω=3.0 but leaves an ALLOWABLE rating as-is', () => {
    expect(OMEGA_ULTIMATE_TO_ALLOWABLE).toBe(3.0);
    expect(allowableUpliftLbs(900, 'ultimate')).toBeCloseTo(300, 5);
    expect(allowableUpliftLbs(1067, 'allowable')).toBe(1067);
    // Unset basis is treated CONSERVATIVELY as ultimate (applies the reduction).
    expect(allowableUpliftLbs(900, undefined)).toBeCloseTo(300, 5);
  });

  it('applies the 0.6 ASD wind factor to the strength-level uplift demand', () => {
    expect(ASD_WIND_FACTOR).toBe(0.6);
    // 50 psf strength uplift × 10 ft² tributary = 500 lb strength → 300 lb ASD.
    expect(asdUpliftDemandLbs(50, 10)).toBeCloseTo(300, 5);
  });
});

// The single-source layout selector: derive orientation + row/col grid from the
// design's real placed modules (project.panelPositions), not autoLayout's guess.
describe('resolveArrayStructuralLayout single-sources the design layout', () => {
  const cad = { panelWidthM: 40.9 / 39.3701, panelHeightM: 66.9 / 39.3701, totalPanels: 6 };

  const mkInput = (positions: any[]): any => ({
    project: { panelPositions: positions, panelWeightLbs: 46 },
    system: { totalPanels: positions.length },
  });

  it('reads orientation + distinct courses from panelPositions', () => {
    // 6 modules, 2 courses (rows 0,1) × 3 cols, all portrait.
    const positions = [0, 1].flatMap(row =>
      [0, 1, 2].map(col => ({ row, col, orientation: 'portrait', arrayId: 'A' })));
    const out = resolveArrayStructuralLayout(mkInput(positions), cad as any);
    expect(out.isFallback).toBe(false);
    expect(out.panelCount).toBe(6);
    expect(out.rowCount).toBe(2);
    expect(out.colCount).toBe(3);
    expect(out.orientation).toBe('portrait');
    expect(out.panelLengthIn).toBeGreaterThan(out.panelWidthIn); // long ≥ short
  });

  it('counts courses per sub-array (multi-plane) and majority-votes orientation', () => {
    const positions = [
      { row: 0, col: 0, orientation: 'landscape', arrayId: 'A' },
      { row: 0, col: 1, orientation: 'landscape', arrayId: 'A' },
      { row: 0, col: 0, orientation: 'landscape', arrayId: 'B' }, // different plane, same row idx
      { row: 1, col: 0, orientation: 'portrait',  arrayId: 'B' },
    ];
    const out = resolveArrayStructuralLayout(mkInput(positions), cad as any);
    // Distinct (arrayId,row): A:0, B:0, B:1 = 3 courses.
    expect(out.rowCount).toBe(3);
    expect(out.orientation).toBe('landscape'); // 3 landscape vs 1 portrait
    // Two sub-arrays (A, B) — drives one trunk-cable bridge splice.
    expect(out.subArrayCount).toBe(2);
  });

  it('sub-arrays fall back to planeId when arrayId is absent, else 1', () => {
    const byPlane = resolveArrayStructuralLayout(mkInput([
      { row: 0, col: 0, orientation: 'portrait', planeId: 'p1' },
      { row: 0, col: 1, orientation: 'portrait', planeId: 'p2' },
    ]), cad as any);
    expect(byPlane.subArrayCount).toBe(2);
    const single = resolveArrayStructuralLayout(mkInput([
      { row: 0, col: 0, orientation: 'portrait' },
      { row: 0, col: 1, orientation: 'portrait' },
    ]), cad as any);
    expect(single.subArrayCount).toBe(1);
  });

  it('falls back honestly (flagged) when the design has no placed panels', () => {
    const out = resolveArrayStructuralLayout({ project: {}, system: { totalPanels: 24 } } as any, cad as any);
    expect(out.isFallback).toBe(true);
    expect(out.source).toMatch(/FALLBACK/);
    expect(out.panelCount).toBe(24);
  });
});
