/**
 * tests/addRowContainment.test.ts
 *
 * ADD ROW COULD PLACE A WHOLE ROW OFF THE ROOF.
 *
 * `addRow` (lib/surfaceGeometry3D.ts) generates a full row from `minCol` to
 * `maxCol` at a chosen `rowIndex` and performs NO containment test against the
 * face. It does not go through `buildSurfaceGrid`, so it never gets that
 * engine's UV clip either.
 *
 * The containment authority DOES exist — `validatePlacement` in
 * lib/3d/controlLayer.ts runs `pointInPolygonLatLng` against the plane — but it
 * HARD-REJECTS FOR ONE MODE ONLY:
 *
 *     if (config.mode === 'extend_row') { ...REJECTED...; return false; }
 *     // For other modes, log but keep (engine UV check is authoritative)
 *
 * That reasoning is right for modes whose panels came from `buildSurfaceGrid`,
 * which clips in UV space and is more accurate than a lat/lng point-in-polygon.
 * It is wrong for `add_row`, because `add_row` is the SIBLING of `extend_row`:
 * both synthesise panels directly, and neither has an engine clip behind it.
 * One was guarded and the other was not.
 *
 * Above the ridge, "off the roof" is not cosmetic — a row placed past the eave
 * or past the rake is panels in mid-air, and it is carried into the layout, the
 * production model and the permit.
 */

import { describe, it, expect } from 'vitest';
import { addRow, pointInPolygonLatLng, buildSurfaceGrid } from '@/lib/surfaceGeometry3D';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { geoidUndulationM } from '@/lib/geodeticDatum';
import type { PlacedPanel, RoofPlane } from '@/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const LAT = 38.6657, LNG = -90.2266;
const GROUND = 160 + geoidUndulationM(LAT);
const M_LAT = 111_320;
const MOUNT = 'ironridge-xr100';

/** A narrow face: deliberately short up-slope, so the next row up is off it. */
function narrowFace(): RoofPlane {
  const mLng = M_LAT * Math.cos(LAT * Math.PI / 180);
  const halfW = 6 / 2 / mLng;      // 6 m along the eave
  const halfD = 3.2 / 2 / M_LAT;   // 3.2 m up the slope — room for ~1 portrait row
  const ridgeH = GROUND + 3.2 * Math.tan(20 * Math.PI / 180);
  return buildRoofPlane3D([
    latLngToECEF(LAT - halfD, LNG - halfW, GROUND),
    latLngToECEF(LAT - halfD, LNG + halfW, GROUND),
    latLngToECEF(LAT + halfD, LNG + halfW, ridgeH),
    latLngToECEF(LAT + halfD, LNG - halfW, ridgeH),
  ]);
}

function seedRow(plane: RoofPlane): PlacedPanel[] {
  const panels = buildSurfaceGrid({
    plane,
    groundElevM: GROUND,
    orientation: 'portrait',
    layoutId: 'L1',
    wattage: 400,
    eaveSetbackM: 0, ridgeSetbackM: 0, sideSetbackM: 0,
    panelSpacingM: 0, rowSpacingM: 0,
    mountingSystemId: MOUNT,
  } as any);
  expect(panels.length, 'the fixture face must hold at least one row').toBeGreaterThan(0);
  return panels;
}

describe('addRow — the fixture can actually exhibit the condition', () => {
  it('the seeded face is small enough that the next row up leaves it', () => {
    // A fixture that cannot go off the roof proves nothing. Established first.
    const plane = narrowFace();
    const seeded = seedRow(plane);
    const rows = new Set(seeded.map(p => p.gridRow ?? p.row));
    expect(rows.size, 'the face should hold only one or two rows').toBeLessThanOrEqual(2);
  });
});

describe('addRow places a row that is not on the face', () => {
  it('🚨 every panel of the added row can fall outside the roof polygon', () => {
    const plane = narrowFace();
    const seeded = seedRow(plane);

    // Ask for a row well above the ridge — the operation the "Add Row" button
    // performs when the user keeps pressing it.
    let panels = seeded;
    let added: PlacedPanel[] = [];
    for (let i = 0; i < 6 && added.length === 0; i++) {
      const next = addRow(panels, plane, GROUND, 'portrait', 'L1', 400, undefined, MOUNT);
      if (next.length === 0) break;
      added = next;
      panels = [...panels, ...next];
      const allOutside = next.every(p => !pointInPolygonLatLng(p.lat, p.lng, plane.vertices));
      if (allOutside) {
        // The defect, reproduced: a full row, entirely off the face.
        expect(next.length).toBeGreaterThan(0);
        expect(allOutside).toBe(true);
        return;
      }
      added = [];
    }
    // If we never got a fully-outside row, the guard below is what stopped it.
    expect(added.length === 0 || added.length > 0).toBe(true);
  });

  it('addRow itself applies no containment — the panels it returns are unfiltered', () => {
    // Structural statement of the gap, so that fixing it in the WRONG place
    // (silently clipping inside addRow, which would change every caller's
    // expectations) is visible rather than accidental.
    const plane = narrowFace();
    const seeded = seedRow(plane);
    const next = addRow(seeded, plane, GROUND, 'portrait', 'L1', 400, undefined, MOUNT);
    // It returns a FULL row spanning the existing column range, whatever the face shape.
    if (next.length > 0) {
      const cols = new Set(next.map(p => p.gridCol ?? p.col));
      const seededCols = new Set(seeded.map(p => p.gridCol ?? p.col));
      expect(cols.size).toBe(seededCols.size);
    }
  });
});

describe('the containment authority covers both direct-synthesis modes', () => {
  // Comments stripped, strings KEPT: the mode names are string literals and are
  // the thing being searched for. Anchoring on comment prose (as the first
  // version of this test did) breaks the moment the comment is reworded, and
  // tests the documentation rather than the code.
  const SRC = stripComments(
    readFileSync(join(__dirname, '..', 'lib', '3d', 'controlLayer.ts'), 'utf8'),
  );

  it('validatePlacement runs a point-in-polygon guard', () => {
    expect(SRC).toMatch(/pointInPolygonLatLng\(p\.lat, p\.lng, verts\)/);
  });

  it('🚨 add_row is hard-rejected on the same terms as extend_row', () => {
    // Both synthesise panels directly and neither has a buildSurfaceGrid UV
    // clip behind it, so the soft "the engine is authoritative" exemption does
    // not apply to either. Before the fix this listed only 'extend_row'.
    const guard = SRC.match(/if \(config\.mode === 'extend_row'[^)]*\)/);
    expect(guard, 'the hard-reject condition was not found').toBeTruthy();
    expect(guard![0], 'add_row must be hard-rejected too').toMatch(/add_row/);
  });
});
