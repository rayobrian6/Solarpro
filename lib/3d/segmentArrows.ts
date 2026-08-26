/**
 * lib/3d/segmentArrows.ts
 *
 * Pure math for per-segment yellow normal-direction arrows on roof
 * edge polylines (Aurora Smart Roof parity — see
 * components/3d/segments/DESIGN.md).
 *
 * All functions are deterministic: same input → same output. No side
 * effects, no DOM, no Cesium. The caller converts the resulting
 * {lat, lng} / {east, north} values into Cesium Cartesian3 instances
 * when rendering.
 *
 * Coordinate convention (matches lib/3d/blockMath.ts):
 *   - Footprint points are lat/lng in WGS84
 *   - 1° lat ≈ 111_320 m, 1° lng ≈ 111_320 * cos(lat) m
 *   - All "east" / "north" values are in metres
 *
 * This file is intentionally small and pure. The integration with
 * Cesium (entity creation, billboard image, click handler) lives in
 * components/3d/segments/SegmentArrowOverlay.ts. The shared
 * SegmentDescriptor type is published here per SHARED.md.
 */

import { METERS_PER_DEG_LAT, metersPerDegLng } from './blockMath';

// ─── Shared type (see components/3d/segments/SHARED.md) ────────────────

/** A single edge of a polyline, in 2D footprint coords. */
export type SegmentDescriptor = {
  id: string;
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  /** +1 = default outward, -1 = flipped by user click. */
  normalDir: 1 | -1;
  /** Which face this segment belongs to (e.g. "face-block-1"). */
  faceId: string;
};

// ─── Coordinate helpers (2D, ENU in metres) ────────────────────────────

/** Convert a lat/lng point to local east-metres at the reference lat. */
function toEastMetres(p: { lat: number; lng: number }, refLat: number): number {
  return (p.lng) * metersPerDegLng(refLat);
}

/** Convert a lat/lng point to local north-metres (1° lat ≈ 111 320 m). */
function toNorthMetres(p: { lat: number }): number {
  return p.lat * METERS_PER_DEG_LAT;
}

/** Cosine of latitude → convert lng deltas to metres. Exported for callers. */
export function eastMetresPerDegLng(refLat: number): number {
  return metersPerDegLng(refLat);
}

// ─── Public math API ───────────────────────────────────────────────────

/** Midpoint of an edge in lat/lng. */
export function midpoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { lat: number; lng: number } {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}

/**
 * Unit normal vector (in ENU) for an edge, pointing AWAY from the
 * polygon centroid. Result is { east, north } in metres, length 1
 * within floating-point precision.
 *
 * - "Perpendicular to the edge" — the math is rotation-by-90°
 * - "In the building's up-plane" — the result is 2D ENU; we never go
 *   to 3D here (the 3D position is computed at render time)
 * - "Outward" — dot product with (centroid - midpoint) is negative
 *   (i.e. the normal points opposite the centroid)
 *
 * If `centroid` is null, the function falls back to a deterministic
 * perpendicular (perpA, the 90° CCW side in math convention) — used
 * for non-closed polylines.
 */
export function defaultOutwardNormal(
  from: { lat: number; lng: number },
  to:   { lat: number; lng: number },
  centroid: { lat: number; lng: number } | null,
  refLat: number,
): { east: number; north: number } {
  const fromE = toEastMetres(from, refLat);
  const fromN = toNorthMetres(from);
  const toE   = toEastMetres(to,   refLat);
  const toN   = toNorthMetres(to);
  const dxE   = toE - fromE;
  const dxN   = toN - fromN;
  // Two perpendiculars in the (east, north) plane. Naming is
  // perpA / perpB rather than "left/right" because the screen-space
  // meaning of those words is opposite to the geographic meaning at
  // most latitudes — the math is what matters.
  //   perpA = (-dxN, dxE)   90° CCW in math convention
  //   perpB = ( dxN, -dxE)  90° CW  in math convention
  const perpA = { east: -dxN, north: dxE };
  const perpB = { east:  dxN, north: -dxE };
  if (!centroid) {
    // No centroid: deterministic fallback to perpA (CCW side of edge).
    return normalise(perpA);
  }
  // Choose the side that faces AWAY from the centroid. c is the
  // vector from midpoint → centroid; we want the perp whose dot
  // product with c is NEGATIVE (pointing opposite to centroid).
  const midE = (fromE + toE) / 2;
  const midN = (fromN + toN) / 2;
  const cE   = toEastMetres(centroid, refLat) - midE;
  const cN   = toNorthMetres(centroid)         - midN;
  if (cE * perpA.east + cN * perpA.north <= 0) return normalise(perpA);
  return normalise(perpB);
}

/** Flip the normal direction sign. */
export function flipNormalDir(dir: 1 | -1): 1 | -1 {
  return dir === 1 ? -1 : 1;
}

/**
 * Bearing of a unit vector, radians, clockwise from north.
 * Range: [-π, π]. Cesium billboard rotation = -bearing.
 */
export function bearingOf(v: { east: number; north: number }): number {
  // atan2(east, north) gives clockwise-from-north by construction.
  const b = Math.atan2(v.east, v.north);
  // Normalize to [-π, π] (atan2 already returns in this range).
  return b;
}

/**
 * Build a list of SegmentDescriptor from a polyline. One entry per
 * consecutive pair of points. Does NOT auto-close; callers append
 * the first point to the end of the array first if they want a
 * closed polygon.
 */
export function buildSegmentsFromPoints(
  points: Array<{ lat: number; lng: number }>,
  flippedIds: Set<string>,
  faceId: string,
): SegmentDescriptor[] {
  const out: SegmentDescriptor[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const id = `seg-${i}`;
    out.push({
      id,
      from: { lat: points[i].lat, lng: points[i].lng },
      to:   { lat: points[i + 1].lat, lng: points[i + 1].lng },
      normalDir: flippedIds.has(id) ? -1 : 1,
      faceId,
    });
  }
  return out;
}

// ─── Internal ─────────────────────────────────────────────────────────

/** Length of a 2D vector. */
function length(v: { east: number; north: number }): number {
  return Math.hypot(v.east, v.north);
}

/** Return a unit-length copy of the vector. Zero-vector safe. */
function normalise(v: { east: number; north: number }): { east: number; north: number } {
  const L = length(v);
  if (L === 0) return { east: 0, north: 0 };
  return { east: v.east / L, north: v.north / L };
}
