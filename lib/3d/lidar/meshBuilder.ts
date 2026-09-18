/**
 * lib/3d/lidar/meshBuilder.ts
 *
 * Convert a LiDAR point cloud into a 2.5D triangle mesh (a "DSM raster").
 *
 * Algorithm (matches what QGIS / ArcGIS / Potree do for terrain viz):
 *   1. Determine the bounding box of the input points.
 *   2. Pick a grid resolution `W × H` cells (default 256×256).
 *   3. For each point, bin it into its cell. Track sum + count per cell.
 *   4. For each cell, mean Z of the points that fell in it.
 *   5. Empty cells get a smoothed value from the 4-neighborhood, falling
 *      back to the dataset mean (otherwise the mesh has holes).
 *   6. Emit a `width × height` grid of vertices and two triangles per
 *      quad. Each vertex carries an RGBA color from the elevation ramp.
 *
 * Pure: no DOM, no Cesium. All math is deterministic.
 */

import type { LiDARPoint, LiDARBounds } from './types';
import { elevationColorAlpha, normalizeElevation } from './colorRamp';

/** A 2.5D triangle mesh ready for Cesium's `Primitive` API. */
export interface MeshGeometry {
  /** [x0, y0, z0, x1, y1, z1, ...] — width × height vertices, row-major. */
  vertices: Float32Array;
  /** [r, g, b, a, r, g, b, a, ...] — per-vertex RGBA in 0..1. */
  colors: Float32Array;
  /** Triangle indices, 3 per triangle, two triangles per cell. */
  indices: Uint32Array;
  /** Grid width in cells (= vertex columns). */
  width: number;
  /** Grid height in cells (= vertex rows). */
  height: number;
  /** Cell size in meters (square cells). */
  cellSize: number;
  /** Mesh bounds (meters, in the input frame). */
  bounds: LiDARBounds;
}

export interface MeshOptions {
  /** Max grid resolution per axis. Default 256. */
  maxResolution?: number;
  /** Alpha for untextured mode. Default 0.85. Textured mode uses 0.4. */
  alphaOpaque?: number;
  /** If true, the textured alpha (0.4) is used. */
  alphaTextured?: boolean;
  /** If true, smooth empty cells with neighbor mean. Default true. */
  smoothEmpty?: boolean;
}

/** Build a 2.5D mesh from a point cloud. */
export function buildMesh(points: LiDARPoint[], options: MeshOptions = {}): MeshGeometry {
  const maxRes = options.maxResolution ?? 256;
  const smoothEmpty = options.smoothEmpty ?? true;
  const alpha = options.alphaTextured ? 0.4 : (options.alphaOpaque ?? 0.85);

  if (points.length === 0) {
    return emptyMesh();
  }

  // 1. Compute bounds
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;
  let minZ = points[0].z, maxZ = points[0].z;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; else if (p.z > maxZ) maxZ = p.z;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX === 0 && spanY === 0) {
    return singlePointMesh(points[0], alpha);
  }

  // 2. Pick grid resolution. Aim for ~ 1 cell per 4 points.
  const ideal = Math.max(2, Math.min(maxRes, Math.ceil(Math.sqrt(points.length / 4))));
  let width:  number;
  let height: number;
  if (spanX === 0) { width = 1; height = ideal; }
  else if (spanY === 0) { width = ideal; height = 1; }
  else {
    const aspect = spanY / spanX;
    if (aspect >= 1) { height = ideal; width = Math.max(2, Math.round(ideal / aspect)); }
    else             { width  = ideal; height = Math.max(2, Math.round(ideal * aspect)); }
  }
  const cellW = spanX / width;
  const cellH = spanY / height;

  // 3. Bin into cells.
  const sumZ   = new Float64Array(width * height);
  const count  = new Uint32Array(width * height);
  let totalZ = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cx = Math.min(width  - 1, Math.max(0, Math.floor((p.x - minX) / cellW)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor((p.y - minY) / cellH)));
    const idx = cy * width + cx;
    sumZ[idx] += p.z;
    count[idx]++;
    totalZ += p.z;
  }
  const datasetMeanZ = totalZ / points.length;

  // 4. Per-cell mean Z.
  const meanZ = new Float32Array(width * height);
  for (let i = 0; i < sumZ.length; i++) {
    meanZ[i] = count[i] > 0 ? sumZ[i] / count[i] : NaN;
  }

  // 5. Smooth empty cells.
  if (smoothEmpty) {
    const scratch = new Float32Array(meanZ.length);
    for (let pass = 0; pass < 3; pass++) {
      scratch.set(meanZ);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!isNaN(meanZ[i])) continue;
          let s = 0, c = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const ni = ny * width + nx;
              if (!isNaN(scratch[ni])) { s += scratch[ni]; c++; }
            }
          }
          if (c > 0) meanZ[i] = s / c;
        }
      }
    }
    for (let i = 0; i < meanZ.length; i++) {
      if (isNaN(meanZ[i])) meanZ[i] = datasetMeanZ;
    }
  }

  // 6. Emit vertex + color arrays
  const vertices = new Float32Array(width * height * 3);
  const colors   = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vi = (y * width + x) * 3;
      const ci = (y * width + x) * 4;
      vertices[vi + 0] = minX + x * cellW;
      vertices[vi + 1] = minY + y * cellH;
      vertices[vi + 2] = meanZ[y * width + x];
      const t = normalizeElevation(vertices[vi + 2], minZ, maxZ);
      const c = elevationColorAlpha(t, alpha);
      colors[ci + 0] = c.r;
      colors[ci + 1] = c.g;
      colors[ci + 2] = c.b;
      colors[ci + 3] = c.a;
    }
  }

  // 7. Indices: two triangles per cell.
  const quads = (width - 1) * (height - 1);
  const indices = new Uint32Array(quads * 6);
  let k = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i00 = (y + 0) * width + (x + 0);
      const i10 = (y + 0) * width + (x + 1);
      const i01 = (y + 1) * width + (x + 0);
      const i11 = (y + 1) * width + (x + 1);
      indices[k++] = i00;
      indices[k++] = i10;
      indices[k++] = i11;
      indices[k++] = i00;
      indices[k++] = i11;
      indices[k++] = i01;
    }
  }

  return {
    vertices,
    colors,
    indices,
    width,
    height,
    cellSize: Math.max(cellW, cellH),
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

function emptyMesh(): MeshGeometry {
  return {
    vertices: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    width: 0,
    height: 0,
    cellSize: 0,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  };
}

function singlePointMesh(p: LiDARPoint, alpha: number): MeshGeometry {
  const vertices = new Float32Array([
    p.x - 0.5, p.y - 0.5, p.z,
    p.x + 0.5, p.y - 0.5, p.z,
    p.x - 0.5, p.y + 0.5, p.z,
    p.x + 0.5, p.y + 0.5, p.z,
  ]);
  const c = elevationColorAlpha(0.5, alpha);
  const colors = new Float32Array([
    c.r, c.g, c.b, c.a,
    c.r, c.g, c.b, c.a,
    c.r, c.g, c.b, c.a,
    c.r, c.g, c.b, c.a,
  ]);
  const indices = new Uint32Array([0, 1, 3, 0, 3, 2]);
  return {
    vertices, colors, indices,
    width: 2, height: 2, cellSize: 1,
    bounds: { minX: p.x - 0.5, maxX: p.x + 0.5, minY: p.y - 0.5, maxY: p.y + 0.5, minZ: p.z, maxZ: p.z },
  };
}
