/**
 * lib/3d/lidar/pointCloudRenderer.ts
 *
 * Render a LiDAR point cloud as a Cesium `PointPrimitiveCollection`.
 *
 * Each point becomes a `PointPrimitive` with:
 *   - position derived from (centroid + local ENU offset)
 *   - color from the rainbow elevation ramp
 *   - pixel size 1–2 (configurable)
 *
 * Coupled to Cesium (window.Cesium). Loaded only on the client side.
 */

import type { LiDARDataset, LiDAROffset } from './types';
import { applyOffset } from './offsetTransform';
import { elevationColor, normalizeElevation } from './colorRamp';
import { METERS_PER_DEG_LAT } from '@/lib/3d/blockMath';

/** Render a point cloud. Returns a cleanup function. */
export function renderPointCloud(
  viewer: any,
  dataset: LiDARDataset,
  offset: LiDAROffset,
  pixelSize = 2,
): () => void {
  const C = (window as any).Cesium;
  if (!C) throw new Error('Cesium not loaded — renderPointCloud must run client-side');
  if (!viewer?.scene?.primitives) throw new Error('Cesium viewer not ready');

  const ds = applyOffset(dataset, offset);
  const { minZ, maxZ } = ds.bounds;
  const centroidLat = ds.centroidLat;
  const centroidLng = ds.centroidLng;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((centroidLat * Math.PI) / 180);

  const collection = new C.PointPrimitiveCollection();
  for (let i = 0; i < ds.points.length; i++) {
    const p = ds.points[i];
    const lat = centroidLat + p.y / METERS_PER_DEG_LAT;
    const lng = centroidLng + p.x / metersPerDegLng;
    const t = normalizeElevation(p.z, minZ, maxZ);
    const c = elevationColor(t);
    collection.add({
      position: C.Cartesian3.fromDegrees(lng, lat, p.z),
      color: new C.Color(c.r, c.g, c.b, 1.0),
      pixelSize,
    });
  }
  viewer.scene.primitives.add(collection);

  return () => {
    try { viewer.scene.primitives.remove(collection); } catch { /* ignore */ }
  };
}
