import { describe, it, expect } from 'vitest';
import { groundCAD } from '../../lib/cad/ground/groundCAD';

// Stowell (4d720c49) regression: groundCAD NEVER read the real designed panel
// positions. With layout.groundArrays absent it synthesized a ceil(sqrt(N))-
// wide grid at tilt 20 / azimuth 180 anchored at local (0,0) — the REAL 26-
// panel ground array (2 rows of 13, az ~175, at a specific GPS spot east of
// the house) was ignored, so detail sheets and the structural BOM ("30 rails,
// 12 piles") came from phantom 5-row geometry. groundCAD now mirrors roofCAD:
// project.panelPositions (GPS) is the source of truth when present.

const METERS_PER_DEG_LAT = 111320;

/** Build a Stowell-shaped ground array: `rows` rows of `perRow` panels,
 *  rows running E-W, ~4 m row spacing, ~1.7 m panel pitch along the row. */
function buildGpsPanels(opts: {
  rows: number;
  perRow: number;
  baseLat?: number;
  baseLng?: number;
  azimuth?: number;
  rowSpacingM?: number;
  pitchM?: number;
}) {
  const {
    rows, perRow,
    baseLat = 38.735, baseLng = -90.123,
    azimuth, rowSpacingM = 4, pitchM = 1.7,
  } = opts;
  const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(baseLat * Math.PI / 180);
  const panels: any[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow; c++) {
      panels.push({
        id:          `gp-r${r}-c${c}`,
        lat:         baseLat - (r * rowSpacingM) / METERS_PER_DEG_LAT, // rows march south
        lng:         baseLng + (c * pitchM) / mPerDegLng,
        orientation: 'landscape',
        systemType:  'ground',
        // Design studio emits one 'ground-row-<ts>' id per row (Stowell).
        arrayId:     `ground-row-${1700000000 + r}`,
        ...(azimuth != null ? { azimuth } : {}),
      });
    }
  }
  return panels;
}

function mkInput(panelPositions: any[] | undefined, totalPanels: number): any {
  return {
    project: { panelPositions },
    system:  { totalPanels, totalDcKw: totalPanels * 0.4, totalAcKw: totalPanels * 0.4 },
    layout:  { type: 'ground_mount' },
  };
}

describe('groundCAD GPS-first path (real designed panel positions)', () => {
  it('builds the REAL 2×13 Stowell-shaped array from GPS positions, not a phantom grid', () => {
    const panels = buildGpsPanels({ rows: 2, perRow: 13 });
    const cad: any = groundCAD(mkInput(panels, 26));

    // Real panel count everywhere — never rows×cols slots.
    expect(cad.totalPanels).toBe(26);
    expect(cad.ground.totalPanels).toBe(26);
    expect(cad.ground.arrays.length).toBe(1);
    const arr = cad.ground.arrays[0];
    expect(arr.panels.length).toBe(26);

    // Two REAL rows of 13 (grouped by the per-row arrayId).
    expect(arr.rows.length).toBe(2);
    for (const row of arr.rows) expect(row.panels.length).toBe(13);
    expect(arr.dimensions.rowCount).toBe(2);
    expect(arr.dimensions.panelsPerRow).toBe(13);

    // Origin = centroid of the designed panels (real GPS registration).
    const meanLat = panels.reduce((s, p) => s + p.lat, 0) / panels.length;
    const meanLng = panels.reduce((s, p) => s + p.lng, 0) / panels.length;
    expect(cad.originLat).toBeCloseTo(meanLat, 9);
    expect(cad.originLng).toBeCloseTo(meanLng, 9);

    // Extent reflects the REAL geometry: 13 panels @ 1.7 m pitch ≈ 22 m wide,
    // 2 rows @ 4 m spacing + panel depth ≈ 5 m deep.
    expect(arr.dimensions.arrayWidthM).toBeGreaterThan(20);
    expect(arr.dimensions.arrayDepthM).toBeGreaterThan(3);

    // Row spacing recovered from the real row centers (~4 m, not the 10 ft default).
    expect(arr.rowSpacingM).toBeGreaterThan(3.5);
    expect(arr.rowSpacingM).toBeLessThan(4.5);

    // Panels stored top-left (center − dims/2), landscape by default.
    for (const p of arr.panels) {
      expect(p.orientation).toBe('landscape');
      expect(p.widthM).toBeGreaterThan(p.heightM);
    }
  });

  it('derives array azimuth from the designed panels (az 175 → ≈175)', () => {
    const panels = buildGpsPanels({ rows: 2, perRow: 13, azimuth: 175 });
    const cad: any = groundCAD(mkInput(panels, 26));
    const az = cad.ground.arrays[0].azimuth;
    expect(Math.abs(az - 175)).toBeLessThanOrEqual(2);
  });

  it('falls back to row-axis-derived azimuth when panels carry none (E-W rows → 180)', () => {
    const panels = buildGpsPanels({ rows: 2, perRow: 13 });
    const cad: any = groundCAD(mkInput(panels, 26));
    const az = cad.ground.arrays[0].azimuth;
    expect(Math.abs(az - 180)).toBeLessThanOrEqual(2);
  });

  it('clusters rows geometrically when panels carry no arrayId/layoutId', () => {
    const panels = buildGpsPanels({ rows: 2, perRow: 13 }).map(p => {
      const { arrayId, ...rest } = p;
      return rest;
    });
    const cad: any = groundCAD(mkInput(panels, 26));
    const arr = cad.ground.arrays[0];
    expect(arr.panels.length).toBe(26);
    expect(arr.rows.length).toBe(2);
    for (const row of arr.rows) expect(row.panels.length).toBe(13);
  });

  it('no-GPS fallback still synthesizes EXACTLY totalPanels (26, never 30 slots)', () => {
    const cad: any = groundCAD(mkInput(undefined, 26));
    expect(cad.totalPanels).toBe(26);
    expect(cad.ground.arrays[0].panels.length).toBe(26);
    for (const row of cad.ground.arrays[0].rows) expect(row.panels.length).toBeGreaterThan(0);
  });

  it('ignores GPS panels stamped for ANOTHER system (roof-tagged → fallback path)', () => {
    const roofTagged = buildGpsPanels({ rows: 2, perRow: 13 })
      .map(p => ({ ...p, systemType: 'roof' }));
    const cad: any = groundCAD(mkInput(roofTagged, 26));
    // Roof-tagged panels are another solver's — synthesized path, still capped.
    expect(cad.ground.arrays[0].panels.length).toBe(26);
    expect(cad.ground.arrays[0].id).toBe('default');
  });
});
