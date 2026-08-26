/**
 * lib/3d/roofActions.ts
 *
 * Pure math for the v66+ Lift Roofs / Flatten Roofs quick actions exposed in
 * the 3D Primitives right panel when LiDAR elevation data is loaded.
 *
 * Aurora parity: HANDOFF_2026-08-25 §4 ("Right panel (LiDAR active): Lift
 * Roofs, Flatten Roofs") and Aurora frames 130, 135 — where the buttons sit
 * in the right panel, next to the LiDAR Properties floating widget.
 *
 * Both functions are deterministic, pure, and Cesium-free. They take a
 * snapshot of the current drawn roof segments plus a LiDAR data interface,
 * and return updated primitive heights. The caller (SolarEngine3D) is
 * responsible for writing the new heights back to the Cesium entities.
 *
 * This file deliberately mirrors the `lib/3d/blockMath.ts` pattern: math
 * out, rendering in. Both v64 primitives (block / gable / hip) and the
 * v66 roof actions are tested in isolation against the math, not the
 * scene.
 *
 * Algorithm + call-site details: see `./ROOF_ACTIONS.md`.
 */

import { METERS_PER_DEG_LAT, metersPerDegLng } from './blockMath';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Which v64 primitive produced this segment. */
export type RoofPrimitiveKind = 'block' | 'gable' | 'hip';

/**
 * A snapshot of one drawn roof segment. The caller builds this list from
 * the existing Cesium entity refs (blockEntitiesRef, gableEntitiesRef,
 * hipEntitiesRef) by reading the current eave height and computing the
 * centroid from the footprint points.
 *
 * `heightM` is the eave height in meters above the WGS84 ellipsoid — the
 * absolute elevation, not a delta above the click point. The block / gable
 * / hip renderers each interpret this in their own way (block writes
 * per-vertex polygon heights, gable/hip write the four eave corner
 * heights), but they all share this single "absolute eave" representation.
 */
export interface RoofPrimitive {
  /** Cesium entity id — caller uses this to write the new height back. */
  id: string;
  /** Which primitive kind produced this segment. */
  kind: RoofPrimitiveKind;
  /** Centroid latitude (WGS84 degrees). */
  centroidLat: number;
  /** Centroid longitude (WGS84 degrees). */
  centroidLng: number;
  /** Current eave height in meters above the WGS84 ellipsoid. */
  heightM: number;
}

/**
 * Minimal interface for LiDAR elevation lookup. The `lidar-integration`
 * agent owns how the data is loaded, stored, and queried; this file
 * depends only on the `getElevationAt` method.
 *
 * Contract:
 *   - Return the elevation in meters above the WGS84 ellipsoid.
 *   - Return `null` (or any non-finite value) if the point has no LiDAR
 *     coverage (out of mesh bounds, off-tile, occluded, etc.).
 *   - Must be deterministic: same lat/lng → same elevation.
 */
export interface LidarData {
  getElevationAt(latDeg: number, lngDeg: number): number | null;
}

/** Simple lat/lng point used for the centroid helper. */
export interface LatLngPoint {
  lat: number;
  lng: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Average the lat/lng of a list of footprint points to get the centroid.
 *
 * For a `block` (N user-clicked footprint points), pass the N points. For
 * a `gable` or `hip` (2 eave corners, SW + NE), pass those 2 points.
 *
 * Matches the arithmetic-mean centroid already used by SolarEngine3D when
 * it places the resize handle (block finalize).
 *
 * Throws on empty input — calling primitiveCentroid([]) is a programming
 * error (the caller should filter out empty footprint lists before
 * building the snapshot). The error is loud, not silent, because a
 * silent zero centroid would silently move a segment to (0, 0).
 */
export function primitiveCentroid(points: ReadonlyArray<LatLngPoint>): {
  centroidLat: number;
  centroidLng: number;
} {
  if (points.length === 0) {
    throw new Error('primitiveCentroid requires at least 1 point (got 0)');
  }
  let sumLat = 0;
  let sumLng = 0;
  for (let i = 0; i < points.length; i++) {
    sumLat += points[i].lat;
    sumLng += points[i].lng;
  }
  return {
    centroidLat: sumLat / points.length,
    centroidLng: sumLng / points.length,
  };
}

/**
 * True iff an elevation value is a usable, finite number (not null,
 * undefined, NaN, or Infinity). `lidar.getElevationAt` is documented to
 * return `null` for missing data, but we also accept other non-finite
 * sentinels defensively — the LiDAR contract is loose enough that we
 * should not crash on weird returns.
 */
function isFiniteElevation(h: number | null | undefined): h is number {
  return typeof h === 'number' && Number.isFinite(h);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Lift Roofs: for each drawn roof segment, snap its eave height to the
 * LiDAR elevation at the segment's centroid.
 *
 * No-op when `lidar === null` — returns a shallow copy of `primitives`
 * with all heights unchanged.
 *
 * No-op when `primitives` is empty — returns `[]`.
 *
 * For each primitive whose centroid has no LiDAR coverage (lidar returns
 * null/NaN), that primitive is left at its current height. Other
 * primitives in the same call may still be lifted.
 *
 * Does NOT mutate the input array. Returns a new array of new objects.
 */
export function liftRoofs(
  primitives: ReadonlyArray<RoofPrimitive>,
  lidar: LidarData | null,
): RoofPrimitive[] {
  if (lidar === null) {
    return primitives.map(p => ({ ...p }));
  }
  if (primitives.length === 0) {
    return [];
  }
  const out: RoofPrimitive[] = new Array(primitives.length);
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives[i];
    const h = lidar.getElevationAt(p.centroidLat, p.centroidLng);
    if (isFiniteElevation(h)) {
      out[i] = { ...p, heightM: h };
    } else {
      out[i] = { ...p };
    }
  }
  return out;
}

/**
 * Flatten Roofs: set every drawn roof segment to the same eave height —
 * the average LiDAR elevation across all segment centroids.
 *
 * No-op when `lidar === null` — returns a shallow copy of `primitives`
 * with all heights unchanged.
 *
 * No-op when `primitives` is empty — returns `[]`.
 *
 * No-op when no centroid has LiDAR coverage — returns primitives with
 * heights unchanged.
 *
 * The average is computed over centroids that DO have coverage. Primitive
 * centroids without coverage are still updated to the average so the
 * result is a consistent flat plane; the average just doesn't include
 * their (missing) elevation.
 *
 * Does NOT mutate the input array. Returns a new array of new objects.
 */
export function flattenRoofs(
  primitives: ReadonlyArray<RoofPrimitive>,
  lidar: LidarData | null,
): RoofPrimitive[] {
  if (lidar === null) {
    return primitives.map(p => ({ ...p }));
  }
  if (primitives.length === 0) {
    return [];
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives[i];
    const h = lidar.getElevationAt(p.centroidLat, p.centroidLng);
    if (isFiniteElevation(h)) {
      sum += h;
      count += 1;
    }
  }
  if (count === 0) {
    return primitives.map(p => ({ ...p }));
  }
  const avg = sum / count;
  const out: RoofPrimitive[] = new Array(primitives.length);
  for (let i = 0; i < primitives.length; i++) {
    out[i] = { ...primitives[i], heightM: avg };
  }
  return out;
}

// Re-export the lat/lng conversion helpers from blockMath so callers that
// import this file can also derive the footprint dimensions for a block
// without needing a second import.
export { METERS_PER_DEG_LAT, metersPerDegLng };
