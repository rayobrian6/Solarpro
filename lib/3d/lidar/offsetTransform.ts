/**
 * lib/3d/lidar/offsetTransform.ts
 *
 * Apply X/Y/Z offset to a LiDAR dataset.
 *
 * Aurora UI uses FEET for the offset (frames 130, 135). LiDAR data is in
 * METERS (USGS 3DEP convention). Convert: 1 ft = 0.3048 m.
 *
 * X offset → +east, Y offset → +north, Z offset → +up. All in the local
 * ENU frame the dataset already lives in.
 *
 * Pure: returns a new dataset, never mutates the input.
 */

import type { LiDARDataset, LiDAROffset, LiDARPoint } from './types';
import { METERS_PER_FOOT } from './types';

/** Apply an offset to a single point. Pure. */
export function offsetPoint(p: LiDARPoint, offset: LiDAROffset): LiDARPoint {
  return {
    ...p,
    x: p.x + offset.x * METERS_PER_FOOT,
    y: p.y + offset.y * METERS_PER_FOOT,
    z: p.z + offset.z * METERS_PER_FOOT,
  };
}

/**
 * Apply an offset to every point in a dataset. Returns a new dataset with
 * the same `source`, `centroidLat/Lng`, and `crs` (the centroid is
 * unaffected by a body-frame translation; downstream Cesium code does the
 * `fromDegrees` from the centroid).
 *
 * Bounds are recomputed.
 */
export function applyOffset(ds: LiDARDataset, offset: LiDAROffset): LiDARDataset {
  if (offset.x === 0 && offset.y === 0 && offset.z === 0) return ds;

  const newPoints = new Array<LiDARPoint>(ds.points.length);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < ds.points.length; i++) {
    const p = ds.points[i];
    const nx = p.x + offset.x * METERS_PER_FOOT;
    const ny = p.y + offset.y * METERS_PER_FOOT;
    const nz = p.z + offset.z * METERS_PER_FOOT;
    newPoints[i] = { ...p, x: nx, y: ny, z: nz };
    if (nx < minX) minX = nx;
    if (nx > maxX) maxX = nx;
    if (ny < minY) minY = ny;
    if (ny > maxY) maxY = ny;
    if (nz < minZ) minZ = nz;
    if (nz > maxZ) maxZ = nz;
  }

  return {
    ...ds,
    points: newPoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

/**
 * Clamp an offset to a sane range. Aurora's UI doesn't clamp (the slider
 * is unbounded), but our lift/flatten actions assume the offset is small
 * enough that the registered points are under the roofPlanes. 100 ft in
 * any axis is already absurd for LiDAR registration nudges.
 */
export function clampOffset(o: LiDAROffset, maxAbsFeet = 100): LiDAROffset {
  const clamp = (v: number) => Math.min(maxAbsFeet, Math.max(-maxAbsFeet, v));
  return { x: clamp(o.x), y: clamp(o.y), z: clamp(o.z) };
}
