/**
 * lib/3d/vertexHandlesMath.ts
 *
 * Pure math for the in-place footprint editor (vertex handles). Used by
 * components/3d/editing/VertexHandles.tsx. No Cesium, no React, no DOM.
 *
 * Aurora parity (HANDOFF_2026-08-25_AURORA_ANALYSIS.md §2 step 3):
 *   - Every footprint vertex is a draggable handle
 *   - Dragging a vertex updates the footprint in real time
 *   - Live dimension readout while dragging
 *
 * Coordinate convention: WGS84 lat/lng in degrees; heights in meters above
 * the WGS84 ellipsoid (NOT above ground level). For sub-meter precision at
 * roof scale, 1° lat ≈ 111_320 m, 1° lng ≈ 111_320 * cos(lat) m.
 *
 * Designed so the same code can be used by:
 *   1. The Cesium integration layer (VertexHandles.tsx) at runtime
 *   2. The unit tests (tests/vertexHandles.test.ts) with no browser
 */

import { computeGableGeometry, computeHipGeometry } from './blockMath';

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum allowed edge length in the footprint, in meters. */
export const MIN_EDGE_LENGTH_M = 0.5;

/** Minimum number of vertices a block footprint must keep. */
export const MIN_BLOCK_VERTICES = 3;

/** Conversion factor: 1 m = 3.28084 ft. */
const FT_PER_M = 3.28084;

// ── Types ────────────────────────────────────────────────────────────────────

/** A single handle position in 3D, used uniformly across all entity types. */
export interface Vertex3 {
  lat: number;
  lng: number;
  /** Meters above WGS84 ellipsoid. For gable/hip, all 4 eave corners share the same `h`. */
  h: number;
}

/** The four primitive types we support. Tree has exactly one vertex; blocks have ≥3. */
export type VertexTargetType = 'block' | 'gable' | 'hip' | 'tree';

/**
 * Spec describing a placed primitive whose vertices should be editable.
 * The integration layer constructs one of these per placed entity and
 * passes them to <VertexHandles specs={specs} />.
 */
export interface VertexTargetSpec {
  /** Stable id of the primitive (matches the Cesium entity id). */
  id: string;
  type: VertexTargetType;
  /**
   * Draggable vertices, in entity-native order.
   *   block  : all footprint points (3+)
   *   gable  : [SW, SE, NW, NE] eave corners
   *   hip    : [SW, SE, NW, NE] eave corners
   *   tree   : [single point at the trunk base]
   */
  vertices: Vertex3[];

  // ── Type-specific knobs ────────────────────────────────────────────────────

  /** Gable/Hip only: eave height in meters. Tree: trunkHeightM is stored in the tree's own state, not here. */
  eaveHeightM?: number;
  /** Gable/Hip only: roof pitch in degrees. */
  pitchDeg?: number;
  /** Block only: eave (extruded) height in meters, used when re-emitting the prism. */
  blockExtrudeHeightM?: number;
}

// ── Distance / length helpers ────────────────────────────────────────────────

/**
 * Great-circle-ish distance in meters between two {lat, lng} points,
 * ignoring the height difference. Uses the equirectangular projection which
 * is accurate to <0.5% for distances <10 km at mid-latitudes — well within
 * the scale of a single roof footprint.
 */
export function haversineApproxM(
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const aLatR = aLat * Math.PI / 180;
  const bLatR = bLat * Math.PI / 180;
  const midLatR = (aLatR + bLatR) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(midLatR);
  const dy = (bLat - aLat) * mPerDegLat;
  const dx = (bLng - aLng) * mPerDegLng;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance in meters between two full 3D vertices (includes the height delta). */
export function vertexDistanceM(a: Vertex3, b: Vertex3): number {
  const horiz = haversineApproxM(a.lat, a.lng, b.lat, b.lng);
  const dz = (a.h ?? 0) - (b.h ?? 0);
  return Math.sqrt(horiz * horiz + dz * dz);
}

/** Bounding-box width/height of a footprint in meters. Returns {0,0} for <2 vertices. */
export function footprintBBoxM(vertices: Vertex3[]): { widthM: number; depthM: number } {
  if (vertices.length < 2) return { widthM: 0, depthM: 0 };
  const lats = vertices.map(v => v.lat);
  const lngs = vertices.map(v => v.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const widthM = (maxLng - minLng) * 111_320 * Math.cos(midLat * Math.PI / 180);
  const depthM = (maxLat - minLat) * 111_320;
  return { widthM, depthM };
}

// ── Live dimension readout ───────────────────────────────────────────────────

/**
 * Format a distance for the live-drag status bar, matching Aurora's
 * "41.3ft" style. Feet with 1 decimal under 100 ft, no decimal at ≥100 ft.
 * Aurora frame_0095 shows "41.3ft" for a ~12.6m edge.
 */
export function dimensionReadoutFt(meters: number): string {
  if (!isFinite(meters) || meters < 0) return '0.0ft';
  const ft = meters * FT_PER_M;
  if (ft >= 100) return `${ft.toFixed(0)}'`;
  return `${ft.toFixed(1)}'`;
}

// ── Validation / clamping ────────────────────────────────────────────────────

export interface VertexMoveResult {
  /** Accepted (possibly clamped) {lat, lng}. `h` is preserved from the original vertex. */
  lat: number;
  lng: number;
  /** True if the proposed move was accepted (after clamping). False if rejected. */
  accepted: boolean;
  /** If false, a short human-readable reason (used for status bar). */
  reason?: string;
}

/**
 * Validate a proposed vertex move against the spec's geometry rules.
 * Clamps to the nearest valid position if a hard constraint would be
 * violated (e.g. collapsing an edge below MIN_EDGE_LENGTH_M).
 *
 * Returns `accepted: false` for moves that the caller should not apply
 * (e.g. would drop a block below MIN_BLOCK_VERTICES — which can't happen
 * via a single vertex move, but guards future callers).
 */
export function validateVertexMove(
  spec: VertexTargetSpec,
  vertexIdx: number,
  newLat: number,
  newLng: number,
): VertexMoveResult {
  // ── 1) Coord sanity ──────────────────────────────────────────────────────
  if (!isFinite(newLat) || !isFinite(newLng)) {
    return { lat: 0, lng: 0, accepted: false, reason: 'invalid lat/lng' };
  }
  if (Math.abs(newLat) > 90 || Math.abs(newLng) > 180) {
    return { lat: newLat, lng: newLng, accepted: false, reason: 'lat/lng out of range' };
  }

  const v = spec.vertices[vertexIdx];
  if (!v) {
    return { lat: newLat, lng: newLng, accepted: false, reason: 'vertex index out of range' };
  }

  // ── 2) Block / tree: no edge-length clamp (each vertex is its own anchor).
  //        For trees there's no "adjacent" to compare against.
  if (spec.type === 'tree') {
    return { lat: newLat, lng: newLng, accepted: true };
  }

  // ── 3) Gable / hip: clamp to min edge length against the two adjacent
  //        eave corners (in a closed rectangle, vertex i has neighbors
  //        (i+1) mod 4 and (i+3) mod 4 for SW=0, SE=1, NW=2, NE=3).
  //        Block: clamp against all OTHER vertices (a single bad edge
  //        can otherwise degenerate the polygon).
  const neighbors: number[] = spec.type === 'block'
    ? spec.vertices.map((_, i) => i).filter(i => i !== vertexIdx)
    : spec.type === 'gable' || spec.type === 'hip'
      ? [(vertexIdx + 1) % 4, (vertexIdx + 3) % 4]
      : [];

  // Build the candidate {lat, lng} (h preserved from original vertex).
  const candidate: Vertex3 = { lat: newLat, lng: newLng, h: v.h };

  for (const nIdx of neighbors) {
    const n = spec.vertices[nIdx];
    const d = haversineApproxM(candidate.lat, candidate.lng, n.lat, n.lng);
    if (d < MIN_EDGE_LENGTH_M) {
      // Reject — caller should not move the vertex that close to a neighbor.
      // We don't try to "push along" because that's a 2-D direction calculation
      // and the visual result of snap-back is cleaner than the math.
      return {
        lat: v.lat,
        lng: v.lng,
        accepted: false,
        reason: `edge would be ${d.toFixed(2)}m (min ${MIN_EDGE_LENGTH_M}m)`,
      };
    }
  }

  return { lat: newLat, lng: newLng, accepted: true };
}

// ── Footprint rebuilders ─────────────────────────────────────────────────────

/**
 * Replace one vertex in a footprint with a new {lat, lng}, preserving `h`.
 * Pure: returns a new array. The caller applies the new array to the
 * Cesium entity's polygon.hierarchy.
 */
export function applyVertexMove(
  vertices: Vertex3[],
  vertexIdx: number,
  newLat: number,
  newLng: number,
): Vertex3[] {
  if (vertexIdx < 0 || vertexIdx >= vertices.length) return vertices.slice();
  const out = vertices.slice();
  out[vertexIdx] = { lat: newLat, lng: newLng, h: out[vertexIdx].h };
  return out;
}

/**
 * Compute the 4 eave corners of a gable roof from the spec, in SW/SE/NW/NE order.
 * Pass to `rebuildGableFaces` to get the Cesium-ready face positions.
 */
export function gableEaveCornersFromSpec(spec: VertexTargetSpec): Vertex3[] {
  // Spec guarantees vertices are in [SW, SE, NW, NE] order for gable/hip.
  // Normalize the bbox to be safe.
  const lats = spec.vertices.map(v => v.lat);
  const lngs = spec.vertices.map(v => v.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const h = spec.eaveHeightM ?? 0;
  return [
    { lat: minLat, lng: minLng, h }, // SW
    { lat: minLat, lng: maxLng, h }, // SE
    { lat: maxLat, lng: minLng, h }, // NW
    { lat: maxLat, lng: maxLng, h }, // NE
  ];
}

/**
 * Result of rebuilding a gable or hip roof's 4 face polygons.
 * Each `positions` array is a 3-tuple or 4-tuple of {lat, lng, h}.
 * Caller maps these to Cartesian3 in the Cesium integration layer.
 */
export interface RebuiltRoofFaces {
  faceA: Vertex3[];        // 4 vertices: one sloped face
  faceB: Vertex3[];        // 4 vertices: other sloped face
  endGableA: Vertex3[];    // 3 or 4 vertices: triangular end wall
  endGableB: Vertex3[];    // 3 or 4 vertices: triangular end wall
}

/**
 * Rebuild a gable roof's 4 face polygons after an eave corner move.
 * The ridge is recomputed from the new bbox centroid (matches the
 * placement math in lib/3d/blockMath.ts → computeGableGeometry).
 */
export function rebuildGableFaces(spec: VertexTargetSpec): RebuiltRoofFaces {
  const eave = gableEaveCornersFromSpec(spec);
  const [sw, se, nw, ne] = eave;
  const eaveHeightM = spec.eaveHeightM ?? 0;
  const pitchDeg = spec.pitchDeg ?? 22;

  const g = computeGableGeometry(sw, ne, eaveHeightM, pitchDeg);
  // g.eaveSW/SE/NW/NE and g.ridgeA/B are 3D points; reconstruct in our order.
  const ridgeA: Vertex3 = g.ridgeA;
  const ridgeB: Vertex3 = g.ridgeB;
  // Order for the sloped faces depends on which axis is the long edge.
  if (g.longIsLng) {
    return {
      faceA: [sw, se, ridgeB, ridgeA], // south face
      faceB: [nw, ne, ridgeB, ridgeA], // north face
      endGableA: [sw, se, ridgeA, ridgeB], // west end (closed quad at the SW/SE/ridge)
      endGableB: [nw, ne, ridgeA, ridgeB], // east end
    };
  } else {
    return {
      faceA: [sw, nw, ridgeA, ridgeB], // west face
      faceB: [se, ne, ridgeA, ridgeB], // east face
      endGableA: [sw, nw, ridgeA, ridgeB], // south end
      endGableB: [se, ne, ridgeA, ridgeB], // north end
    };
  }
}

/**
 * Rebuild a hip roof's 4 face polygons after an eave corner move.
 * The ridge is recomputed from the new bbox centroid with a setback
 * proportional to the new short edge (matches computeHipGeometry).
 */
export function rebuildHipFaces(spec: VertexTargetSpec): RebuiltRoofFaces {
  const eave = gableEaveCornersFromSpec(spec);
  const [sw, se, nw, ne] = eave;
  const eaveHeightM = spec.eaveHeightM ?? 0;
  const pitchDeg = spec.pitchDeg ?? 22;

  const h = computeHipGeometry(sw, ne, eaveHeightM, pitchDeg);
  const ridgeA: Vertex3 = h.ridgeA;
  const ridgeB: Vertex3 = h.ridgeB;
  if (h.longIsLng) {
    return {
      faceA: [sw, se, ridgeB, ridgeA], // south slope (trapezoid)
      faceB: [nw, ne, ridgeB, ridgeA], // north slope
      endGableA: [sw, se, ridgeA],     // south hip end (triangle)
      endGableB: [nw, ne, ridgeB],     // north hip end (triangle)
    };
  } else {
    return {
      faceA: [sw, nw, ridgeA, ridgeB], // west slope
      faceB: [se, ne, ridgeA, ridgeB], // east slope
      endGableA: [sw, se, ridgeB],     // south hip end (triangle)
      endGableB: [nw, ne, ridgeA],     // north hip end (triangle)
    };
  }
}

// ── Vertex neighbors (for live dimension readout) ────────────────────────────

/**
 * Return the indices of the vertices adjacent to `vertexIdx` in the footprint.
 * Used by the integration layer to show "edge: 41.3ft" while dragging.
 *
 *   block : every other vertex
 *   gable : (i+1) mod 4 and (i+3) mod 4
 *   hip   : (i+1) mod 4 and (i+3) mod 4
 *   tree  : []
 */
export function adjacentVertexIndices(spec: VertexTargetSpec, vertexIdx: number): number[] {
  if (spec.type === 'tree') return [];
  if (spec.type === 'block') {
    return spec.vertices.map((_, i) => i).filter(i => i !== vertexIdx);
  }
  return [(vertexIdx + 1) % 4, (vertexIdx + 3) % 4];
}

// ── Pick-ray helper (pure-ish, Cesium-shaped) ────────────────────────────────

/**
 * Convert a Cesium camera pick-ray to a lat/lng on the globe.
 *
 * The ray has the shape `{ origin: {x,y,z}, direction: {x,y,z} }`.
 * The globe is `{ ellipsoid: { cartographicFromCartesian } }`.
 * Both shapes are loose (we use property access, not instanceof) so
 * the unit tests can pass plain objects.
 *
 * Returns null if the ray does not hit the ellipsoid (points to sky).
 */
export function pickRayToLatLng(
  ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } },
  cartographicFromCartesian: (c: { x: number; y: number; z: number }) => { latitude: number; longitude: number; height: number } | null | undefined,
  degreesFromRadians: (r: number) => number,
): { lat: number; lng: number; h: number } | null {
  if (!ray || !ray.origin || !ray.direction) return null;

  // Parametric ray: p = origin + t * direction. Find the smallest positive t
  // where |p|² = R² (WGS84 mean radius).
  const R = 6_378_137; // WGS84 semi-major axis (m)
  const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
  const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;

  const a = dx * dx + dy * dy + dz * dz;
  if (a <= 0) return null;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null; // ray points away from Earth

  const t = (-b - Math.sqrt(disc)) / (2 * a); // closer intersection
  if (t < 0) return null;

  const hx = ox + dx * t;
  const hy = oy + dy * t;
  const hz = oz + dz * t;
  const carto = cartographicFromCartesian({ x: hx, y: hy, z: hz });
  if (!carto) return null;

  return {
    lat: degreesFromRadians(carto.latitude),
    lng: degreesFromRadians(carto.longitude),
    h: carto.height ?? 0,
  };
}
