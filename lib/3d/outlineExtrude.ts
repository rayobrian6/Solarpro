// lib/3d/outlineExtrude.ts
// Lifts a 2D outline document into 3D meshes (Three.js BufferGeometry).
//
// Used by:
//   - components/design/Outline3DPreview.tsx  (top-down + perspective preview)
//   - the future 3D engine integration (controlLayer.setRoofFromOutline)
//
// All units are meters. Y axis is the world up after extrude (we rotate the
// Shape from the XY plane so its normal points along +Y).

import * as THREE from 'three';
import type { OutlineDocument, Point2D, OutlinePolygon } from '@/lib/outline/types';
import { polygonPoints, defaultRectangle, expandPolygon } from '@/lib/outline/types';

/**
 * Convert a 2D polygon to a Three.js Shape on the XY plane.
 * Polygons are assumed to be in CCW order for correct face normals; if the
 * input is CW we reverse it (Three.js Shape expects CCW for outer ring).
 */
function polygonToShape(pts: Point2D[]): THREE.Shape {
  if (pts.length < 3) {
    throw new Error(`polygonToShape: need at least 3 vertices, got ${pts.length}`);
  }
  // Compute signed area; positive = CCW, negative = CW.
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area2 += (x2 - x1) * (y2 + y1);
  }
  const ccw = area2 < 0;
  const ordered = ccw ? pts : [...pts].reverse();

  const shape = new THREE.Shape();
  shape.moveTo(ordered[0][0], ordered[0][1]);
  for (let i = 1; i < ordered.length; i++) {
    shape.lineTo(ordered[i][0], ordered[i][1]);
  }
  shape.closePath();
  return shape;
}

/**
 * Extrude a 2D polygon to a 3D mesh on the XY plane, oriented so the shape's
 * normal points along +Z (top-down view) by default. Caller can rotate to
 * taste (the design studio uses -Y as up so we rotate the geometry by -PI/2
 * around X to lay it flat).
 *
 *   baseZ  — minimum Z value of the resulting mesh
 *   height — extrusion depth
 */
export function extrudePolygonGeometry(
  pts: Point2D[],
  height: number,
  baseZ: number = 0,
  bevel: boolean = true,
): THREE.BufferGeometry {
  const shape = polygonToShape(pts);
  const settings: THREE.ExtrudeGeometryOptions = {
    depth: height,
    bevelEnabled: bevel,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
    curveSegments: 4,
  };
  const geo = new THREE.ExtrudeGeometry(shape, settings);
  // ExtrudeGeometry extrudes along +Z starting at z=0. Translate so the base
  // sits at baseZ.
  geo.translate(0, 0, baseZ);
  return geo;
}

/**
 * Compute the 3D meshes for an outline document:
 *   - roof: extruded from the roof outline, sitting on top of the house
 *   - house: extruded from the house outline, from ground to eave height
 *
 * If the house outline is empty, a default rectangle is auto-generated from
 * the roof bbox + houseOffsetM.
 *
 * Returns the geometries and a `materials` hint for color separation in the
 * renderer (roof = warm, house = neutral).
 */
export interface ExtrudedOutline {
  roof: THREE.BufferGeometry;
  house: THREE.BufferGeometry;
  /** Pre-translated to world (Z-up after rotation). */
  roofPosition: [number, number, number];
  housePosition: [number, number, number];
  /** Suggested materials. Caller provides the actual THREE.Material. */
  roofColor: string;
  houseColor: string;
}

export function extrudeOutlineDocument(doc: OutlineDocument): ExtrudedOutline | null {
  const roofPts = polygonPoints(doc.roof);
  if (!roofPts) return null;

  // Auto-generate house footprint if not drawn.
  let housePts = polygonPoints(doc.house);
  if (!housePts) {
    housePts = expandPolygon(roofPts, doc.houseOffsetM);
  }

  // House goes from ground (z=0) up to doc.houseHeightM.
  const house = extrudePolygonGeometry(housePts, doc.houseHeightM, 0);
  // Roof sits on top of the house. We orient both meshes with Y as up by
  // rotating -90deg around X (so XY plane becomes XZ).
  house.rotateX(-Math.PI / 2);

  // Roof sits on top of house at eave height, with its own thickness.
  const roof = extrudePolygonGeometry(roofPts, doc.roofHeightM, 0);
  roof.rotateX(-Math.PI / 2);
  // Lift the roof so its base sits on the house's top.
  roof.translate(0, doc.houseHeightM, 0);

  return {
    roof,
    house,
    roofPosition: [0, doc.houseHeightM, 0],
    housePosition: [0, 0, 0],
    roofColor: '#b45309', // warm brown — matches SolarPro amber palette
    houseColor: '#94a3b8', // slate-400 — neutral building
  };
}

/**
 * Sanity-check an outline document before extrusion. Returns the list of
 * problems found, empty if OK. Used by the UI to block "Generate 3D" until
 * the user has drawn a valid roof.
 */
export function validateOutlineForExtrude(doc: OutlineDocument): string[] {
  const problems: string[] = [];
  if (!doc.roof.closed) problems.push('Roof outline is not closed.');
  if (doc.roof.vertices.length < 3) problems.push('Roof outline needs at least 3 vertices.');
  if (doc.roofHeightM <= 0) problems.push('Roof height must be > 0.');
  if (doc.houseHeightM <= 0) problems.push('House height must be > 0.');
  if (doc.houseHeightM < doc.roofHeightM) {
    problems.push('House height should be at least the roof thickness.');
  }
  return problems;
}
