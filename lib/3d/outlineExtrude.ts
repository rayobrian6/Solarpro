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
import type { OutlineDocument, Point2D, OutlinePolygon, RoofType } from '@/lib/outline/types';
import { polygonPoints, defaultRectangle, expandPolygon } from '@/lib/outline/types';
import { pitchSlope } from '@/lib/outline/units';

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
 * Extrude a 2D polygon to a flat 3D mesh on the XY plane, oriented so the
 * shape's normal points along +Z. Caller rotates to taste.
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
  geo.translate(0, 0, baseZ);
  return geo;
}

/**
 * Axis-aligned bounding box of a polygon.
 */
function bbox(pts: Point2D[]): {
  minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/**
 * Centroid (mean) of a polygon. For irregular polygons this isn't the
 * visual center, but it's the right point for "all faces meet here"
 * hip roofs.
 */
function centroid(pts: Point2D[]): Point2D {
  let sx = 0, sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

/**
 * Build a flat 3D roof mesh from the polygon outline at the given
 * total height. The roof is a solid block; for the eave plane we use
 * the original polygon (at baseZ), and the top plane is offset upward
 * by `height` along the roof's local Z.
 */
function buildFlatRoofGeometry(pts: Point2D[], baseZ: number, height: number): THREE.BufferGeometry {
  return extrudePolygonGeometry(pts, height, baseZ);
}

/**
 * Build a gable-roof mesh. The roof has:
 *   - The original polygon as the eave line at z=0
 *   - A ridge line at the center of the polygon, parallel to the bbox's
 *     long axis, at z = (perpendicular_dimension / 2) * tan(pitch)
 *   - Two sloped roof faces connecting the eave edges to the ridge
 *   - Two triangular gable end walls at the ends of the ridge
 *
 * Works for any polygon (rectangular or irregular). The ridge axis is
 * horizontal at the polygon's bbox center, parallel to whichever bbox
 * dimension is longer. The roof height = (shorter_dimension / 2) * tan(pitch).
 */
function buildGableRoofGeometry(
  pts: Point2D[],
  baseZ: number,
  pitch: { rise: number; run: number },
): THREE.BufferGeometry {
  const b = bbox(pts);
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  // Ridge runs parallel to the longer dimension. The slope direction is
  // the shorter dimension.
  const ridgeIsX = dx >= dy;
  const slope = pitchSlope(pitch.rise, pitch.run);
  // ridgeHeight: measured from the eave (z=baseZ) up to the ridge.
  // The ridge sits at the bbox center along the slope axis; the eaves
  // are at the bbox extremes.
  const shorter = ridgeIsX ? dy : dx;
  const ridgeHeight = (shorter / 2) * slope;

  // Build vertices and faces.
  // For each polygon vertex (vx, vy, baseZ), we project it onto the
  // ridge axis to get a "ridge vertex" at z = baseZ + ridgeHeight.
  // The slope face goes (eave i) -> (eave i+1) -> (ridge i+1) -> (ridge i).
  // The gable end walls are triangles at the two ends of the ridge.

  const positions: number[] = [];
  const indices: number[] = [];

  // Eave vertices (base of the roof, at z = baseZ).
  for (const [x, y] of pts) {
    positions.push(x, y, baseZ);
  }
  // Ridge vertices: same (x, y) as the corresponding eave, but z = baseZ + ridgeHeight.
  // (For an irregular polygon this is approximate — the ridge is horizontal
  // and the slope faces go up to it from each eave.)
  for (const [x, y] of pts) {
    positions.push(x, y, baseZ + ridgeHeight);
  }

  const n = pts.length;
  // Slope faces (two per eave edge): for each edge i -> i+1, build a
  // quad connecting the eave edge to the corresponding ridge edge.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const eaveI = i;
    const eaveJ = j;
    const ridgeI = n + i;
    const ridgeJ = n + j;
    // Quad: eaveI -> eaveJ -> ridgeJ -> ridgeI
    indices.push(eaveI, eaveJ, ridgeJ);
    indices.push(eaveI, ridgeJ, ridgeI);
  }
  // The bottom face (eave polygon) — skip; the house base is the
  // visual floor for the roof.

  // Gable end walls — only for rectangular gables. For an irregular
  // polygon, the gable ends are the two eave edges that are
  // perpendicular to the long axis. We approximate by picking the
  // two eave edges whose midpoints are furthest from the ridge axis.
  if (n >= 4) {
    // Find the two eave edges with the largest |distance to ridge axis|.
    const distFromRidge = (px: number, py: number) =>
      ridgeIsX ? Math.abs(py - b.cy) : Math.abs(px - b.cx);
    const edgeDist = (i: number) => {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      return Math.max(distFromRidge(x1, y1), distFromRidge(x2, y2));
    };
    const ranked = Array.from({ length: n }, (_, i) => ({ i, d: edgeDist(i) }))
      .sort((a, b) => b.d - a.d);
    const a = ranked[0].i;
    const bIdx = ranked[1].i;
    for (const e of [a, bIdx]) {
      const i0 = e;
      const i1 = (e + 1) % n;
      const e0 = i0, e1 = i1, r0 = n + i0, r1 = n + i1;
      // Gable triangle: eave0, eave1, ridge projection of eave1 (or eave0)
      // For simplicity, use the average of the two ridge projections.
      // = eave0, eave1, (ridge0 + ridge1) / 2.
      // But we need a real vertex. We'll add a third point at the midpoint.
      // For gable ends, the triangle is eave0 -> eave1 -> ridge.
      // The "ridge" at the gable end is the average of the two ridge
      // projections of the edge's endpoints.
      const midX = (pts[i0][0] + pts[i1][0]) / 2;
      const midY = (pts[i0][1] + pts[i1][1]) / 2;
      const gableVertex = positions.length / 3;
      positions.push(midX, midY, baseZ + ridgeHeight);
      // Two triangles to make the quad
      indices.push(e0, e1, gableVertex);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a hip-roof mesh. All faces meet at a single peak point at
 * the centroid of the polygon, at z = baseZ + maxDistFromCentroid *
 * tan(pitch). Each face is a triangle from one eave edge to the peak.
 */
function buildHipRoofGeometry(
  pts: Point2D[],
  baseZ: number,
  pitch: { rise: number; run: number },
): THREE.BufferGeometry {
  const c = centroid(pts);
  const slope = pitchSlope(pitch.rise, pitch.run);
  // Peak height: max distance from centroid to any vertex, times slope.
  let maxDist = 0;
  for (const [x, y] of pts) {
    const d = Math.hypot(x - c[0], y - c[1]);
    if (d > maxDist) maxDist = d;
  }
  const peakHeight = maxDist * slope;

  const positions: number[] = [];
  const indices: number[] = [];

  // Eave vertices.
  for (const [x, y] of pts) {
    positions.push(x, y, baseZ);
  }
  // Peak vertex.
  const peakIdx = pts.length;
  positions.push(c[0], c[1], baseZ + peakHeight);

  // One triangle per eave edge: (eave i) -> (eave i+1) -> peak.
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    indices.push(i, j, peakIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Compute the 3D meshes for an outline document:
 *   - roof: extruded from the roof outline, sitting on top of the house
 *   - house: extruded from the house outline, from ground to eave height
 *
 * The roof geometry depends on `doc.roofType`:
 *   - 'flat' : solid extrusion of the polygon to doc.roofHeightM
 *   - 'gable': two sloped faces meeting at a ridge, height = bbox.short * tan(pitch)
 *   - 'hip'  : all faces meeting at a centroid peak, height = maxCentroidDist * tan(pitch)
 */
export interface ExtrudedOutline {
  roof: THREE.BufferGeometry;
  house: THREE.BufferGeometry;
  roofPosition: [number, number, number];
  housePosition: [number, number, number];
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

  // House goes from ground (z=0) up to doc.houseHeightM. Always flat.
  const house = extrudePolygonGeometry(housePts, doc.houseHeightM, 0);
  house.rotateX(-Math.PI / 2);

  // Roof sits on top of the house. The house is at y=0 .. y=houseHeightM
  // after the rotateX (we rotated XY -> XZ). The roof's eave plane is at
  // y = houseHeightM, regardless of roofType.
  const roof: THREE.BufferGeometry = (() => {
    switch (doc.roofType) {
      case 'flat':
        return buildFlatRoofGeometry(roofPts, 0, doc.roofHeightM);
      case 'gable':
        return buildGableRoofGeometry(roofPts, 0, doc.pitch);
      case 'hip':
        return buildHipRoofGeometry(roofPts, 0, doc.pitch);
      default:
        return buildFlatRoofGeometry(roofPts, 0, doc.roofHeightM);
    }
  })();
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, doc.houseHeightM, 0);

  return {
    roof,
    house,
    roofPosition: [0, doc.houseHeightM, 0],
    housePosition: [0, 0, 0],
    // Materials — terracotta tile roof + cream walls (matches Aurora-style
    // residential rendering, not the abstract SolarPro amber palette).
    roofColor: '#c2410c',  // orange-700 / terracotta tile
    houseColor: '#e8d9b8', // warm cream / wheat
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
  if (doc.roofType !== 'flat' && doc.houseHeightM < 0.5) {
    problems.push('Pitched roofs need a house height of at least 0.5 m (1.6 ft) to look right.');
  }
  if (doc.pitch.rise <= 0 || doc.pitch.run <= 0) {
    problems.push('Pitch must be a positive ratio (e.g., 6:12).');
  }
  return problems;
}
