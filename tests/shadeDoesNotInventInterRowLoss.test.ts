// ═══════════════════════════════════════════════════════════════════════════
// 🚨 43% OF A YEAR, CHARGED TO A 2 cm SLIDER.
//
// Ray, live, looking at a ground mount standing alone in open grass: "Idk if that shade callout is
// accurate!! At high noon there is no shade on these panels." The product said:
//
//     Shade: 43.0% annual loss
//     17 of 34 modules see shade from the model — trees, chimneys and nearby structures included.
//
// Exactly half the modules — the entire back row — and nothing anywhere near them.
//
// THE ARITHMETIC THAT PRODUCED IT. `computeShadeAnalysis` decided inter-row self-shading with
//
//     threshold = atan(panelHeight · sin(tilt) / rowSpacingM)
//
// and both production callers passed the Design Studio's **Row Spacing** slider as `rowSpacingM`.
// That slider is the GAP between adjacent panel rows on a roof — modules lying on one plane with
// air between them — and on Ray's design it read **0.02 m**. Substituted:
//
//     atan(1.134 · sin20° / 0.02) = atan(0.388 / 0.02) = 87.0°
//
// The sun at 38.6°N never exceeds ~75°, so the back row was declared shaded for every daylight
// hour with the sun in the southern half of the sky. Half the modules losing ~86% of their year
// is 43% of the system.
//
// THE REAL DISCRIMINATOR IS HEIGHT, NOT SPACING. A two-row PLP table is ONE tilted plane with the
// rows stacked up the slope: the back row starts exactly where the front row ended, so there is no
// step and no shadow, ever. Two SEPARATE tables each start at their own ground level, so there is
// a step of `L·sinβ` and a real, modest loss. The two are identical in plan. Only the modules'
// heights tell them apart, and nothing was passing heights.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  computeShadeAnalysis, interRowShadeElevation, deriveInterRowThresholds,
  type PanelShadeInput,
} from '@/lib/shadeAnalysis';

const SITE = { lat: 38.6398, lng: -90.2222 };     // Ray's site
const MPD = 111_132;
const TILT = 20;
const L = 1.722;                                   // 72-cell portrait, along-slope
const DEG = Math.PI / 180;

/**
 * Ray's mount: two rows on ONE tilted plane, which is what a PLP table is. Row r's centre sits
 * `r·L·cosβ + L·cosβ/2` metres north of the front edge and `that · tanβ` metres above the base —
 * the same grid `placeGroundArrayRow` commits.
 */
function oneTable(rows: number, cols: number, baseZ = 140): PanelShadeInput[] {
  const t = TILT * DEG;
  const depth = L * Math.cos(t);
  const out: PanelShadeInput[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ns = r * depth + depth / 2;
      out.push({
        id: `t-${r}-${c}`, tilt: TILT, azimuth: 180, row: r, col: c,
        lat: SITE.lat + ns / MPD,
        lng: SITE.lng + (c * 1.134) / (111_320 * Math.cos(SITE.lat * DEG)),
        height: baseZ + ns * Math.tan(t),
        groupId: 'ga-1', slopeLengthM: L,
      });
    }
  }
  return out;
}

/** Two SEPARATE tables, `pitchM` apart, each starting at its own ground level. */
function separateTables(pitchM: number, cols = 4, baseZ = 140): PanelShadeInput[] {
  const t = TILT * DEG;
  const out: PanelShadeInput[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        id: `s-${r}-${c}`, tilt: TILT, azimuth: 180, row: r, col: c,
        lat: SITE.lat + (r * pitchM) / MPD,
        lng: SITE.lng + (c * 1.134) / (111_320 * Math.cos(SITE.lat * DEG)),
        // Each table stands on the ground: the same centre height, whatever the pitch.
        height: baseZ + (L / 2) * Math.sin(t),
        groupId: 'ga-2', slopeLengthM: L,
      });
    }
  }
  return out;
}

describe('🚨 the arithmetic that produced 43%, named', () => {
  it('the Row Spacing slider read as a row pitch gives 87° — the whole sky', () => {
    // The OLD model, written out. It had no concept of height and no clear-run term:
    //     threshold = atan(panelHeightM · sin(tilt) / rowSpacingM)
    // with `panelHeightM` defaulting to 1.134 and `rowSpacingM` supplied by the caller — which on
    // Ray's design was the Row Spacing slider at 0.02 m. Reproduced here so the 43% in his
    // screenshot has a derivation on record and cannot be waved away as noise.
    const oldModel = (panelHeightM: number, rowSpacingM: number, tiltDeg: number) =>
      Math.atan2(panelHeightM * Math.sin(tiltDeg * DEG), rowSpacingM) * 180 / Math.PI;

    const asSlider = oldModel(1.134, 0.02, TILT);
    expect(asSlider).toBeGreaterThan(80);
    expect(asSlider).toBeLessThan(89);
    // The sun never gets there from 38.6°N: 90 − 38.64 + 23.44 = 74.8° at the June solstice, so
    // the back row was blocked in every slot with the sun in the southern half of the sky.
    expect(asSlider).toBeGreaterThan(74.8);

    // 🚨 AND THE SAME SLIDER VALUE CAN NO LONGER REACH THE MODEL AT ALL. It is measured from the
    // modules now, and 2 cm of pitch between real modules is not a valid arrangement — it is rows
    // overlapping in plan, which yields no threshold rather than an 87° one.
    expect(interRowShadeElevation({
      pitchM: 0.02, riseM: 0, slopeLengthM: 1.134, tiltDeg: TILT,
    })).toBe(0);
  });

  it('the SAME rows, measured with their heights, give 0° — they are one plane', () => {
    const t = TILT * DEG;
    expect(interRowShadeElevation({
      pitchM: L * Math.cos(t),       // rows stacked up the slope, touching
      riseM: L * Math.sin(t),        // and the back row already that much higher
      slopeLengthM: L,
      tiltDeg: TILT,
    })).toBe(0);
  });
});

describe('🚨 a ground mount alone in a field loses nothing to itself', () => {
  it("Ray's 2 x 17 table reports no self-shading under an empty sky", () => {
    const panels = oneTable(2, 17);
    expect(panels).toHaveLength(34);
    const res = computeShadeAnalysis(panels, SITE.lat, SITE.lng);
    expect(res.systemShadeDeratePct,
      `an open-field ground mount with nothing near it reports ${res.systemShadeDeratePct.toFixed(1)}% `
      + 'annual loss. Ray: "At high noon there is no shade on these panels."')
      .toBeLessThan(0.5);
    const shaded = Object.values(res.panelShadeFactors).filter(f => f < 0.97).length;
    expect(shaded,
      `${shaded} of 34 modules are reported shaded by nothing — the callout said 17`).toBe(0);
  });

  it('and the back row is not singled out', () => {
    const res = computeShadeAnalysis(oneTable(2, 17), SITE.lat, SITE.lng);
    const front = Object.entries(res.panelShadeFactors).filter(([id]) => id.startsWith('t-0-'));
    const back = Object.entries(res.panelShadeFactors).filter(([id]) => id.startsWith('t-1-'));
    expect(front).toHaveLength(17);
    expect(back).toHaveLength(17);
    const meanOf = (xs: [string, number][]) => xs.reduce((s, [, v]) => s + v, 0) / xs.length;
    expect(Math.abs(meanOf(back) - meanOf(front)),
      'the back row scores differently from the front row although they share one plane')
      .toBeLessThan(0.01);
  });

  it('a roof array with a 2 cm gap between rows is not charged for the air', () => {
    // The long-open defect: coplanar flush modules were scored 0.967 instead of 1.0. A gap makes
    // the step NEGATIVE — the row behind starts above the row in front's top edge.
    const t = TILT * DEG;
    const gap = 0.02;
    const panels: PanelShadeInput[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const ns = r * (L * Math.cos(t) + gap) + L * Math.cos(t) / 2;
        panels.push({
          id: `r-${r}-${c}`, tilt: TILT, azimuth: 180, row: r, col: c,
          lat: SITE.lat + ns / MPD, lng: SITE.lng + (c * 1.134) / (111_320 * Math.cos(SITE.lat * DEG)),
          height: 150 + ns * Math.tan(t), groupId: 'roof-a', slopeLengthM: L,
        });
      }
    }
    const res = computeShadeAnalysis(panels, SITE.lat, SITE.lng);
    expect(res.systemShadeDeratePct, 'a flush roof array is charged for shading itself')
      .toBeLessThan(0.5);
  });
});

describe('🚨 and a real inter-row shadow is still charged', () => {
  it('two separate tables 3 m apart lose something, and it is not 43%', () => {
    const res = computeShadeAnalysis(separateTables(3), SITE.lat, SITE.lng);
    expect(res.systemShadeDeratePct,
      'two separate tables three metres apart report NO self-shading — the model has stopped '
      + 'seeing a real shadow, which is the opposite mistake')
      .toBeGreaterThan(0.5);
    expect(res.systemShadeDeratePct,
      `two tables three metres apart report ${res.systemShadeDeratePct.toFixed(1)}% — that is the `
      + 'runaway figure again, not a shadow')
      .toBeLessThan(20);
  });

  it('moving them further apart loses less — the model responds to the geometry', () => {
    const near = computeShadeAnalysis(separateTables(2.5), SITE.lat, SITE.lng).systemShadeDeratePct;
    const far = computeShadeAnalysis(separateTables(8), SITE.lat, SITE.lng).systemShadeDeratePct;
    expect(far).toBeLessThan(near);
    expect(far, 'eight metres of pitch still costs more than a percent').toBeLessThan(1);
  });

  it('the threshold for a real table pitch is a plausible profile angle', () => {
    const t = TILT * DEG;
    const deg = interRowShadeElevation({
      pitchM: 5, riseM: 0, slopeLengthM: L, tiltDeg: TILT,
    });
    // atan(L·sin20° / (5 − L·cos20°)) = atan(0.589 / 3.382) = 9.9°
    expect(deg).toBeCloseTo(Math.atan2(L * Math.sin(t), 5 - L * Math.cos(t)) * 180 / Math.PI, 6);
    expect(deg).toBeGreaterThan(5);
    expect(deg).toBeLessThan(20);
  });
});

describe('🚨 what it refuses to guess', () => {
  it('a group with no heights is charged nothing, because its arrangement is unknown', () => {
    // One continuous plane and two separate tables are identical in plan. With no height there is
    // no way to tell them apart, and the old model guessed — from a slider that meant something
    // else entirely.
    const noHeights = oneTable(2, 4).map(p => ({ ...p, height: undefined }));
    expect(deriveInterRowThresholds(noHeights).size).toBe(0);
    const res = computeShadeAnalysis(noHeights, SITE.lat, SITE.lng);
    expect(res.systemShadeDeratePct).toBeLessThan(0.5);
  });

  it('two mounts on opposite sides of a site are not rows of each other', () => {
    const a = oneTable(2, 3);
    const b = separateTables(3).map(p => ({ ...p, lat: p.lat + 60 / MPD }));
    const thresholds = deriveInterRowThresholds([...a, ...b]);
    // One entry, for the separate tables only — the one-plane mount contributes none.
    expect([...thresholds.keys()].every(k => k.startsWith('ga-2'))).toBe(true);
  });

  it('rows that overlap in plan produce no threshold rather than a 90° one', () => {
    expect(interRowShadeElevation({
      pitchM: 0.5, riseM: 0, slopeLengthM: L, tiltDeg: TILT,
    })).toBe(0);
  });

  it('a flat array has no inter-row geometry at all', () => {
    expect(interRowShadeElevation({ pitchM: 5, riseM: 0, slopeLengthM: L, tiltDeg: 0 })).toBe(0);
  });
});
