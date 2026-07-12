import { describe, it, expect } from 'vitest';
import { drawRoofPlan } from '@/lib/drafting/templates/roof';
import type { DraftingInput } from '@/lib/drafting/types';

// ─────────────────────────────────────────────────────────────────────────────
// PV-1 fire-setback slope-space consistency (Stowell 4d720c49 phantom flags).
//
// Panel CENTERS are plan-true (projected lat/lng), but module dims are
// physical (on the roof surface) and IFC 1204 setbacks are walked ALONG THE
// SURFACE. drawRoofPlan must therefore:
//   1. foreshorten each module's FALL-LINE dimension by cos(pitch) in plan,
//   2. draw ridge/eave setback bands at requiredIn × cos(pitch) plan width
//      (cross-slope / rake-parallel offsets do NOT foreshorten),
//   3. run the encroachment check in that same consistent plan geometry,
//   4. resolve the ≤33% coverage test (18" vs 36" ridge band) on a consistent
//      plan basis: plan-projected array area ÷ plan roof area.
//
// REGRESSION GUARD: the pre-fix code measured raw physical module half-dims
// against un-foreshortened band widths in plan space. On Stowell (27.6° pitch):
// top-row center 62.2" plan from ridge → 70.2" along-slope → top-edge
// clearance 36.3" ≥ 36" = COMPLIANT, but raw math read 62.2 − 33.9 = 28.3"
// < 36" and flagged 16 modules that actually comply.
// ─────────────────────────────────────────────────────────────────────────────

const PITCH = 27.6;
const COS = Math.cos((PITCH * Math.PI) / 180); // ≈ 0.8862

// Stowell-class module: 1.722 m × 1.134 m physical.
const PANEL_LEN_IN = 67.8;  // portrait fall-line (long) dim
const PANEL_WID_IN = 44.65; // cross-slope (short) dim
const DRAW_SHRINK = 0.97;   // roof.ts renders modules at 97% footprint

type V = { lat: number; lng: number };
const P = (lat: number, lng: number): V => ({ lat, lng });

// Fake-degree CAD units: 1 unit = 1 ft. Lat offset 100 keeps every vertex past
// the |lat| > 0.001 validity gate in drawRoofPlan.
const RIDGE_LAT = 130;

/** Simple gable: south plane (az 180) + north plane (az 0) sharing the ridge. */
function gablePlanes(pitch: number) {
  return [
    { id: 'S', vertices: [P(100, 0), P(100, 40), P(RIDGE_LAT, 40), P(RIDGE_LAT, 0)], pitch, azimuth: 180 },
    { id: 'N', vertices: [P(RIDGE_LAT, 0), P(RIDGE_LAT, 40), P(160, 40), P(160, 0)], pitch, azimuth: 0 },
  ];
}

/** South plane (az 180) + east-facing plane (az 90) sharing a fall-line-parallel
 *  ("hip"-classified) edge at lng 40 — the band offset there runs CROSS-SLOPE. */
function hipPlanes(pitch: number) {
  return [
    { id: 'S', vertices: [P(100, 0), P(100, 40), P(RIDGE_LAT, 40), P(RIDGE_LAT, 0)], pitch, azimuth: 180 },
    { id: 'E', vertices: [P(100, 40), P(RIDGE_LAT, 40), P(RIDGE_LAT, 70), P(100, 70)], pitch, azimuth: 90 },
  ];
}

let _pid = 0;
const panel = (lat: number, lng: number) => ({
  id: `p${_pid++}`, lat, lng, azimuth: 180, orientation: 'portrait', row: 0, col: 0,
});

function makeInput(planes: any[], panels: any[], projectOverrides: Record<string, unknown> = {}): DraftingInput {
  return {
    project: {
      systemType: 'roof',
      roofPitch: PITCH,
      panelLengthIn: PANEL_LEN_IN,
      panelWidthIn: PANEL_WID_IN,
      roofPlanes: planes as any,
      panelPositions: panels as any,
      ...projectOverrides,
    },
    layout: {},
    engineering: { totalDcKw: 10, totalAcKw: 8, totalPanels: panels.length, panelWatts: 400 },
  };
}

// drawText XML-escapes ' and " — normalize so assertions can use plain text.
const norm = (svg: string) => svg.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Panel center lat whose module TOP edge sits `clearanceIn` along-slope below the ridge. */
const centerLatForClearance = (clearanceIn: number) =>
  RIDGE_LAT - ((clearanceIn + PANEL_LEN_IN / 2) * COS) / 12;

describe('PV-1 setback slope-space consistency (fall-line foreshortening)', () => {

  it('module top edge exactly 36.3" along-slope from the ridge → ZERO flags (Stowell case)', () => {
    // AHJ-forced 36" ridge setback (>18" override wins regardless of coverage —
    // precedence unchanged). Along-slope clearance 36.3" ≥ 36" = compliant.
    const svg = norm(drawRoofPlan(makeInput(
      gablePlanes(PITCH),
      [panel(centerLatForClearance(36.3), 20)],
      { ahjRidgeSetbackIn: 36 },
    )));

    expect(svg).toContain('3\'-0" RIDGE');          // 36" band drawn + labeled
    expect(svg).not.toContain('ENCROACH');           // no phantom flag
    expect(svg).not.toContain('SETBACK ENCROACHMENT'); // no legend entry either

    // REGRESSION GUARD (arithmetic of the old mixed-space bug — if someone
    // reverts the foreshortening, the drawing math returns to the left side):
    const planCenterIn = (36.3 + PANEL_LEN_IN / 2) * COS;           // 62.2" plan from ridge
    const rawHalfIn = (PANEL_LEN_IN / 2) * DRAW_SHRINK;             // raw drawn half-module
    const planHalfIn = rawHalfIn * COS;                             // foreshortened half-module
    // OLD: raw half-module vs raw 36" band → 29.3" < 36" → phantom flag.
    expect(planCenterIn - rawHalfIn).toBeLessThan(36);
    // NEW: plan-projected half-module vs plan-projected band → clear.
    expect(planCenterIn - planHalfIn).toBeGreaterThan(36 * COS);
  });

  it('a genuinely encroaching module (20" along-slope clearance) still flags', () => {
    const svg = norm(drawRoofPlan(makeInput(
      gablePlanes(PITCH),
      [panel(centerLatForClearance(20), 20)],
      { ahjRidgeSetbackIn: 36 },
    )));
    expect(svg).toMatch(/1 MODULE\(S\) ENCROACH/);
    expect(svg).toContain('SETBACK ENCROACHMENT');
  });

  it('foreshortens the drawn fall-line dimension by cos(pitch); pitch 0° is identity', () => {
    const moduleRect = (svg: string): { w: number; h: number } => {
      const m = svg.match(/<rect [^>]*width="([\d.]+)" height="([\d.]+)" fill="#fdfdfd" stroke="#2c4a75"/);
      expect(m, 'module rect present').toBeTruthy();
      return { w: parseFloat(m![1]), h: parseFloat(m![2]) };
    };
    const at = (pitch: number) =>
      moduleRect(drawRoofPlan(makeInput(gablePlanes(pitch), [panel(115, 20)])));

    const flat = at(0);
    const pitched = at(PITCH);

    // pitch 0 → identity: plan footprint keeps the physical aspect ratio
    expect(flat.h / flat.w).toBeCloseTo(PANEL_LEN_IN / PANEL_WID_IN, 1);
    // cross-slope width never foreshortens
    expect(pitched.w).toBeCloseTo(flat.w, 1);
    // fall-line height foreshortens by exactly cos(pitch)
    expect(pitched.h / flat.h).toBeCloseTo(COS, 2);
  });

  it('coverage test uses a consistent plan basis → 18" ridge exception applies (Stowell-like)', () => {
    // 42 modules on a 2×1200 ft² plan roof:
    //   mixed basis (real array ÷ plan roof)  = 42×21.02/2400 ≈ 36.8% > 33% → 36"
    //   consistent  (plan array ÷ plan roof)  = ×cos(27.6°)   ≈ 32.6% ≤ 33% → 18"
    const grid: any[] = [];
    for (const lat of [103, 107, 111, 115, 119, 123]) {
      for (const lng of [4, 9, 14, 19, 24, 29, 34]) grid.push(panel(lat, lng));
    }
    const realFt2 = (PANEL_LEN_IN * PANEL_WID_IN) / 144;
    expect((grid.length * realFt2) / 2400).toBeGreaterThan(0.33);          // mixed basis denies
    expect((grid.length * realFt2 * COS) / 2400).toBeLessThanOrEqual(0.33); // consistent basis grants

    // No AHJ override → the coverage test picks the band.
    const svg = norm(drawRoofPlan(makeInput(gablePlanes(PITCH), grid)));
    expect(svg).toContain('1\'-6" RIDGE');
    expect(svg).not.toContain('3\'-0" RIDGE');

    // Same layout dead flat: cos = 1, both bases agree at 36.8% > 33% → 36".
    const flat = norm(drawRoofPlan(makeInput(gablePlanes(0), grid)));
    expect(flat).toContain('3\'-0" RIDGE');
    expect(flat).not.toContain('1\'-6" RIDGE');

    // Stowell's real numbers, for the record (881 ft² array, 2569 ft² plan roof):
    expect(881 / 2569).toBeGreaterThan(0.33);           // mixed basis → 36" (wrong)
    expect((881 * COS) / 2569).toBeLessThanOrEqual(0.33); // consistent ≈ 30.4% → 18"
  });

  it('cross-slope (rake-parallel) band offsets do NOT foreshorten', () => {
    // The shared fall-line-parallel edge at lng 40 classifies as hip → 18" band
    // whose inward offset runs CROSS-SLOPE (k = 1, no cos). A module edge at
    // 16.5" from that edge must flag (16.5 < 18). If the band were wrongly
    // foreshortened to 18×cos ≈ 15.9", it would NOT flag.
    const halfCrossIn = (PANEL_WID_IN / 2) * DRAW_SHRINK; // cross-slope half-dim (never foreshortened)
    const atEdgeDist = (distIn: number) =>
      norm(drawRoofPlan(makeInput(
        hipPlanes(PITCH),
        [panel(115, 40 - (distIn + halfCrossIn) / 12)],
      )));

    expect(atEdgeDist(16.5)).toMatch(/1 MODULE\(S\) ENCROACH/); // inside true 18" band
    expect(atEdgeDist(19.5)).not.toContain('ENCROACH');         // clear of it
  });
});
