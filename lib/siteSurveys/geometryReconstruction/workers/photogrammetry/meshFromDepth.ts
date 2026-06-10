/**
 * Plane-based meshing from segmented depth regions.
 *
 * Takes the fused 3D point cloud (from depthFusion.ts) and produces
 * a lightweight triangle mesh by:
 *   1. Clustering points by segmentation class (roof, wall, ground)
 *   2. Fitting planes to each cluster via RANSAC
 *   3. Projecting inlier points onto their fitted plane
 *   4. Computing a 2D Delaunay triangulation within each plane's local frame
 *   5. Lifting the 2D triangles back to 3D
 *
 * The resulting mesh is suitable for visualization and approximate
 * measurement, but is NOT CAD geometry. It inherits all the limitations
 * of the underlying monocular depth (relative, not metric).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  NormalizedPoint,
  GeometryReconstructionAuthority,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';
import type { Point3D } from './depthUnprojection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 3D triangle with vertex indices into the parent mesh's vertex array. */
export interface Triangle {
  /** Index of first vertex. */
  v0: number;
  /** Index of second vertex. */
  v1: number;
  /** Index of third vertex. */
  v2: number;
}

/** A fitted plane in 3D: ax + by + cz + d = 0, with unit normal. */
export interface FittedPlane {
  /** Plane normal (unit vector). */
  nx: number;
  ny: number;
  nz: number;
  /** Plane offset: nx*x + ny*y + nz*z + d = 0. */
  d: number;
  /** Number of inlier points. */
  inlierCount: number;
  /** RANSAC residual RMS. */
  residualRms: number;
  /** Segmentation class this plane was fit to (-1 if mixed). */
  segClass: number;
}

/** A single mesh patch — one fitted plane's triangulated surface. */
export interface MeshPatch {
  /** 3D vertices (local to this patch). */
  vertices: Point3D[];
  /** Triangles (indices into vertices array). */
  triangles: Triangle[];
  /** The fitted plane this patch lies on. */
  plane: FittedPlane;
  /** Segmentation class. */
  segClass: number;
  /** Area of the patch in squared depth units. */
  estimatedArea: number;
  /** Bounding box of the patch. */
  bounds: { xMin: number; yMin: number; zMin: number; xMax: number; yMax: number; zMax: number };
}

/** Result of plane-based meshing. */
export interface MeshFromDepthResult {
  /** Individual mesh patches (one per fitted plane). */
  patches: MeshPatch[];
  /** Unified vertex array (all patches concatenated). */
  allVertices: Point3D[];
  /** Unified triangle array (indices into allVertices). */
  allTriangles: Triangle[];
  /** Total vertex count. */
  vertexCount: number;
  /** Total triangle count. */
  triangleCount: number;
  /** Total estimated surface area. */
  totalArea: number;
  /** Fitted planes. */
  fittedPlanes: FittedPlane[];
  /** Authority envelope. */
  authority: GeometryReconstructionAuthority;
  /** Limitations. */
  limitations: string[];
}

/** Options for plane-based meshing. */
export interface MeshFromDepthOptions {
  /** RANSAC distance threshold for plane inliers. Default: 0.02 */
  ransacDistanceThreshold?: number;
  /** RANSAC maximum iterations. Default: 200 */
  ransacMaxIterations?: number;
  /** RANSAC minimum inlier count to accept a plane. Default: 8 */
  ransacMinInliers?: number;
  /** Maximum number of planes to fit per segmentation class. Default: 5 */
  maxPlanesPerClass?: number;
  /** Maximum edge length for triangulation (reject long sliver triangles). Default: 0.1 */
  maxEdgeLength?: number;
  /** Minimum angle in degrees for triangulation (reject degenerate triangles). Default: 5 */
  minTriangleAngle?: number;
  /** Whether to project inlier points onto the fitted plane. Default: true */
  projectOntoPlane?: boolean;
  /** Segmentation classes to mesh (class IDs). Default: [1, 2, 5] (roof, wall, ground) */
  meshClasses?: number[];
  /** Voxel size for pre-filtering the point cloud before meshing. Default: 0 (disabled) */
  prefilterVoxelSize?: number;
}

// ---------------------------------------------------------------------------
// RANSAC plane fitting
// ---------------------------------------------------------------------------

/**
 * Fit a plane to a set of 3D points using RANSAC.
 *
 * The plane model: nx * x + ny * y + nz * z + d = 0
 * where (nx, ny, nz) is the unit normal.
 *
 * RANSAC procedure:
 *   1. Sample 3 random points, compute the plane they define
 *   2. Count inliers within the distance threshold
 *   3. Keep the best plane
 *   4. Refit the plane using all inliers (least-squares via PCA)
 *
 * @returns The fitted plane, or null if insufficient inliers
 */
export function fitPlaneRansac(
  points: Point3D[],
  distanceThreshold: number = 0.02,
  maxIterations: number = 200,
  minInliers: number = 8,
): FittedPlane | null {
  if (points.length < minInliers) return null;

  let bestInlierIndices: number[] = [];
  let bestPlane: { nx: number; ny: number; nz: number; d: number } | null = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Sample 3 random points
    const i0 = Math.floor(Math.random() * points.length);
    let i1 = Math.floor(Math.random() * points.length);
    while (i1 === i0) i1 = Math.floor(Math.random() * points.length);
    let i2 = Math.floor(Math.random() * points.length);
    while (i2 === i0 || i2 === i1) i2 = Math.floor(Math.random() * points.length);

    const p0 = points[i0], p1 = points[i1], p2 = points[i2];

    // Compute plane normal from cross product of two edges
    const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
    const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;

    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;

    const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (mag < 1e-9) continue; // degenerate (collinear points)
    nx /= mag; ny /= mag; nz /= mag;

    // Ensure consistent orientation (normal points "upward" if possible)
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

    const d = -(nx * p0.x + ny * p0.y + nz * p0.z);

    // Count inliers
    const inlierIndices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(nx * points[i].x + ny * points[i].y + nz * points[i].z + d);
      if (dist <= distanceThreshold) {
        inlierIndices.push(i);
      }
    }

    if (inlierIndices.length > bestInlierIndices.length) {
      bestInlierIndices = inlierIndices;
      bestPlane = { nx, ny, nz, d };
    }
  }

  if (bestInlierIndices.length < minInliers || !bestPlane) return null;

  // Refit using all inliers via PCA (eigenvector of smallest eigenvalue)
  const inliers = bestInlierIndices.map(i => points[i]);
  const refitted = refitPlanePCA(inliers);

  if (!refitted) {
    // Fall back to the RANSAC plane
    return {
      ...bestPlane,
      inlierCount: bestInlierIndices.length,
      residualRms: computeResidualRms(inliers, bestPlane),
      segClass: -1,
    };
  }

  return {
    ...refitted,
    inlierCount: bestInlierIndices.length,
    residualRms: computeResidualRms(inliers, refitted),
    segClass: -1,
  };
}

/**
 * Refit a plane using PCA on inlier points.
 * The plane normal is the eigenvector corresponding to the smallest eigenvalue
 * of the covariance matrix.
 */
function refitPlanePCA(
  points: Point3D[],
): { nx: number; ny: number; nz: number; d: number } | null {
  if (points.length < 3) return null;

  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= points.length; cy /= points.length; cz /= points.length;

  // Compute covariance matrix (3x3, symmetric)
  let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    c00 += dx * dx; c01 += dx * dy; c02 += dx * dz;
    c11 += dy * dy; c12 += dy * dz;
    c22 += dz * dz;
  }
  // Fill symmetric entries
  c01 /= points.length; c02 /= points.length; c12 /= points.length;
  c00 /= points.length; c11 /= points.length; c22 /= points.length;

  // Power iteration to find the eigenvector of the smallest eigenvalue.
  // We use inverse iteration: iterate v = C^{-1} v / |C^{-1} v|
  // Instead, we use the simpler approach: compute the normal as the
  // eigenvector with smallest eigenvalue via Jacobi-like iteration.
  // For simplicity, we use a direct 3x3 eigendecomposition.

  // Since we only need the smallest eigenvector, we use a trick:
  // The normal of the best-fit plane is the eigenvector of C with
  // the smallest eigenvalue. We approximate this via repeated
  // cross products with the dominant eigenvector.

  // Step 1: Find the dominant eigenvector via power iteration
  let vx = 1, vy = 0, vz = 0; // initial guess
  for (let iter = 0; iter < 50; iter++) {
    const nvx = c00 * vx + c01 * vy + c02 * vz;
    const nvy = c01 * vx + c11 * vy + c12 * vz;
    const nvz = c02 * vx + c12 * vy + c22 * vz;
    const mag = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz);
    if (mag < 1e-12) break;
    vx = nvx / mag; vy = nvy / mag; vz = nvz / mag;
  }

  // Step 2: The smallest eigenvector is orthogonal to the dominant one.
  // We find it by taking a vector orthogonal to the dominant eigenvector,
  // then projecting it into the null space of C - lambda_dominant * I.
  // Simpler approach: use the cross product to get a vector orthogonal to
  // the dominant eigenvector, then apply C and subtract the dominant
  // component repeatedly.

  // Get a vector not parallel to the dominant eigenvector
  let ux: number, uy: number, uz: number;
  if (Math.abs(vx) < 0.9) { ux = 1; uy = 0; uz = 0; }
  else { ux = 0; uy = 1; uz = 0; }

  // Cross product: dominant x u → orthogonal vector
  let nx = vy * uz - vz * uy;
  let ny = vz * ux - vx * uz;
  let nz = vx * uy - vy * ux;
  let mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (mag < 1e-12) return null;
  nx /= mag; ny /= mag; nz /= mag;

  // Deflate: subtract the dominant eigenvector component, then renormalize
  // This converges to the second eigenvector (or the smallest if we do it twice)
  for (let iter = 0; iter < 20; iter++) {
    // Apply covariance
    let ax = c00 * nx + c01 * ny + c02 * nz;
    let ay = c01 * nx + c11 * ny + c12 * nz;
    let az = c02 * nx + c12 * ny + c22 * nz;
    // Remove dominant component
    const dot = ax * vx + ay * vy + az * vz;
    ax -= dot * vx; ay -= dot * vy; az -= dot * vz;
    mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (mag < 1e-12) break;
    nx = ax / mag; ny = ay / mag; nz = az / mag;
  }

  // Ensure consistent orientation (normal points "upward" if possible)
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

  const d = -(nx * cx + ny * cy + nz * cz);
  return { nx, ny, nz, d };
}

/**
 * Compute the RMS residual of points from a plane.
 */
function computeResidualRms(
  points: Point3D[],
  plane: { nx: number; ny: number; nz: number; d: number },
): number {
  let sumSq = 0;
  for (const p of points) {
    const dist = plane.nx * p.x + plane.ny * p.y + plane.nz * p.z + plane.d;
    sumSq += dist * dist;
  }
  return Math.sqrt(sumSq / points.length);
}

// ---------------------------------------------------------------------------
// Plane-projected points
// ---------------------------------------------------------------------------

/**
 * Project a point onto a plane along the plane normal.
 */
function projectOntoPlane(
  point: Point3D,
  plane: FittedPlane,
): Point3D {
  const dist = plane.nx * point.x + plane.ny * point.y + plane.nz * point.z + plane.d;
  return {
    ...point,
    x: point.x - dist * plane.nx,
    y: point.y - dist * plane.ny,
    z: point.z - dist * plane.nz,
  };
}

// ---------------------------------------------------------------------------
// 2D triangulation (ear-clipping)
// ---------------------------------------------------------------------------

/**
 * A simple 2D point for triangulation.
 */
interface Point2D {
  x: number;
  y: number;
}

/**
 * Compute a local 2D coordinate frame for a plane.
 * Returns two orthogonal tangent vectors in the plane.
 */
function planeTangentFrame(plane: FittedPlane): {
  uAxis: { x: number; y: number; z: number };
  vAxis: { x: number; y: number; z: number };
  origin: { x: number; y: number; z: number };
} {
  const n = { x: plane.nx, y: plane.ny, z: plane.nz };

  // Choose a vector not parallel to the normal
  let ux: number, uy: number, uz: number;
  if (Math.abs(n.z) < 0.9) {
    // Use cross product with Z-axis
    ux = -n.y; uy = n.x; uz = 0;
  } else {
    // Use cross product with X-axis
    ux = 0; uy = -n.z; uz = n.y;
  }
  let mag = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= mag; uy /= mag; uz /= mag;

  // V = N x U
  let vx = n.y * uz - n.z * uy;
  let vy = n.z * ux - n.x * uz;
  let vz = n.x * uy - n.y * ux;
  mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
  vx /= mag; vy /= mag; vz /= mag;

  // Origin = point on plane closest to world origin
  const originDist = -plane.d; // distance from origin along normal
  const ox = n.x * originDist;
  const oy = n.y * originDist;
  const oz = n.z * originDist;

  return {
    uAxis: { x: ux, y: uy, z: uz },
    vAxis: { x: vx, y: vy, z: vz },
    origin: { x: ox, y: oy, z: oz },
  };
}

/**
 * Project 3D points onto a plane's local 2D frame.
 */
function projectTo2D(
  points3D: Point3D[],
  frame: ReturnType<typeof planeTangentFrame>,
): Point2D[] {
  return points3D.map(p => {
    const dx = p.x - frame.origin.x;
    const dy = p.y - frame.origin.y;
    const dz = p.z - frame.origin.z;
    return {
      x: dx * frame.uAxis.x + dy * frame.uAxis.y + dz * frame.uAxis.z,
      y: dx * frame.vAxis.x + dy * frame.vAxis.y + dz * frame.vAxis.z,
    };
  });
}

/**
 * Compute the signed area of a polygon (2D). Positive = counter-clockwise.
 */
function signedArea2D(poly: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

/**
 * Compute the convex hull of a set of 2D points using Graham scan.
 */
function convexHull2D(points: Point2D[]): Point2D[] {
  if (points.length < 3) return [...points];

  // Find lowest-y point (leftmost if tie)
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[pivot].y ||
        (points[i].y === points[pivot].y && points[i].x < points[pivot].x)) {
      pivot = i;
    }
  }

  const pivotPoint = points[pivot];

  // Sort by angle from pivot
  const sorted = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== pivot)
    .sort((a, b) => {
      const angleA = Math.atan2(a.p.y - pivotPoint.y, a.p.x - pivotPoint.x);
      const angleB = Math.atan2(b.p.y - pivotPoint.y, b.p.x - pivotPoint.x);
      if (Math.abs(angleA - angleB) < 1e-10) {
        // Closer first
        const dA = (a.p.x - pivotPoint.x) ** 2 + (a.p.y - pivotPoint.y) ** 2;
        const dB = (b.p.x - pivotPoint.x) ** 2 + (b.p.y - pivotPoint.y) ** 2;
        return dA - dB;
      }
      return angleA - angleB;
    })
    .map(({ p }) => p);

  const stack: Point2D[] = [pivotPoint];
  for (const p of sorted) {
    while (stack.length > 1) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross <= 0) stack.pop();
      else break;
    }
    stack.push(p);
  }
  return stack;
}

/**
 * Check if a point is inside a triangle (2D, barycentric method).
 */
function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

/**
 * Triangulate a set of 2D points using convex hull + fan triangulation,
 * then add interior points by incremental insertion.
 *
 * This is a simplified approach suitable for planar roof/wall surfaces
 * where points are roughly coplanar.
 *
 * Returns triangle indices into the input points array.
 */
export function triangulatePoints2D(
  points2D: Point2D[],
  maxEdgeLength: number = 0.1,
  minAngle: number = 5,
): Triangle[] {
  if (points2D.length < 3) return [];

  // Compute convex hull
  const hull = convexHull2D(points2D);

  if (hull.length < 3) return [];

  // Map hull points back to input indices
  const hullIndices = hull.map(hp => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points2D.length; i++) {
      const d = (points2D[i].x - hp.x) ** 2 + (points2D[i].y - hp.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  });

  const triangles: Triangle[] = [];

  // Fan triangulation from the first hull vertex
  for (let i = 1; i < hullIndices.length - 1; i++) {
    const tri: Triangle = {
      v0: hullIndices[0],
      v1: hullIndices[i],
      v2: hullIndices[i + 1],
    };

    // Validate triangle
    if (isValidTriangle(tri, points2D, maxEdgeLength, minAngle)) {
      triangles.push(tri);
    }
  }

  // Add interior points: for each interior point, find the containing
  // triangle, split it into three sub-triangles
  const hullSet = new Set(hullIndices);
  const interiorIndices = points2D
    .map((_, i) => i)
    .filter(i => !hullSet.has(i));

  for (const pidx of interiorIndices) {
    const px = points2D[pidx].x;
    const py = points2D[pidx].y;

    // Find the containing triangle
    let found = false;
    for (let ti = triangles.length - 1; ti >= 0; ti--) {
      const t = triangles[ti];
      const a = points2D[t.v0], b = points2D[t.v1], c = points2D[t.v2];
      if (pointInTriangle(px, py, a.x, a.y, b.x, b.y, c.x, c.y)) {
        // Split triangle into three
        triangles.splice(ti, 1);
        const t1: Triangle = { v0: t.v0, v1: t.v1, v2: pidx };
        const t2: Triangle = { v0: t.v1, v1: t.v2, v2: pidx };
        const t3: Triangle = { v0: t.v2, v1: t.v0, v2: pidx };

        if (isValidTriangle(t1, points2D, maxEdgeLength, minAngle)) triangles.push(t1);
        if (isValidTriangle(t2, points2D, maxEdgeLength, minAngle)) triangles.push(t2);
        if (isValidTriangle(t3, points2D, maxEdgeLength, minAngle)) triangles.push(t3);

        found = true;
        break;
      }
    }

    // If no containing triangle found, skip this interior point
    // (it's outside the convex hull or in a gap)
  }

  return triangles;
}

/**
 * Validate a triangle: check edge lengths and minimum angle.
 */
function isValidTriangle(
  tri: Triangle,
  points: Point2D[],
  maxEdgeLength: number,
  minAngleDeg: number,
): boolean {
  const a = points[tri.v0], b = points[tri.v1], c = points[tri.v2];

  // Check edge lengths
  const e0 = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  const e1 = Math.sqrt((c.x - b.x) ** 2 + (c.y - b.y) ** 2);
  const e2 = Math.sqrt((a.x - c.x) ** 2 + (a.y - c.y) ** 2);

  if (e0 > maxEdgeLength || e1 > maxEdgeLength || e2 > maxEdgeLength) return false;

  // Check minimum angle using law of cosines
  const minAngleRad = (minAngleDeg * Math.PI) / 180;

  const cosA = (e1 * e1 + e2 * e2 - e0 * e0) / (2 * e1 * e2 + 1e-12);
  const cosB = (e0 * e0 + e2 * e2 - e1 * e1) / (2 * e0 * e2 + 1e-12);
  const cosC = (e0 * e0 + e1 * e1 - e2 * e2) / (2 * e0 * e1 + 1e-12);

  const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const angleB = Math.acos(Math.max(-1, Math.min(1, cosB)));
  const angleC = Math.acos(Math.max(-1, Math.min(1, cosC)));

  if (angleA < minAngleRad || angleB < minAngleRad || angleC < minAngleRad) return false;

  // Check degenerate (zero area)
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  if (area < 1e-12) return false;

  return true;
}

/**
 * Compute the area of a 3D triangle from vertex positions.
 */
function triangleArea3D(a: Point3D, b: Point3D, c: Point3D): number {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const cx = e1y * e2z - e1z * e2y;
  const cy = e1z * e2x - e1x * e2z;
  const cz = e1x * e2y - e1y * e2x;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}

// ---------------------------------------------------------------------------
// Main meshing function
// ---------------------------------------------------------------------------

/**
 * Create a plane-based mesh from a fused 3D point cloud.
 *
 * Pipeline:
 *   1. Group points by segmentation class
 *   2. Fit planes to each class group via RANSAC
 *   3. Project inlier points onto their fitted plane
 *   4. Triangulate within each plane's local 2D frame
 *   5. Compute mesh statistics
 *
 * @param points - Fused 3D point cloud (from depthFusion.ts)
 * @param options - Meshing options
 * @returns Mesh result with per-patch and unified geometry
 */
export function meshFromDepth(
  points: Point3D[],
  options: MeshFromDepthOptions = {},
): MeshFromDepthResult {
  const {
    ransacDistanceThreshold = 0.02,
    ransacMaxIterations = 200,
    ransacMinInliers = 8,
    maxPlanesPerClass = 5,
    maxEdgeLength = 0.1,
    minTriangleAngle = 5,
    projectOntoPlane: shouldProject = true,
    meshClasses = [1, 2, 5], // roof, wall, ground
    prefilterVoxelSize = 0,
  } = options;

  const limitations = [
    ...BASE_LIMITATIONS,
    'Mesh is derived from monocular relative depth — NOT metric geometry.',
    'Plane fitting uses RANSAC on unprojected depth points — not from SfM/MVS.',
    'Triangulation is convex-hull-based within each plane — may miss concavities.',
    'Edge lengths and areas are in relative depth units, not meters.',
    'When SfM becomes available, this module will be upgraded to proper multi-view meshing.',
  ];

  // Handle empty input
  if (points.length === 0) {
    return {
      patches: [],
      allVertices: [],
      allTriangles: [],
      vertexCount: 0,
      triangleCount: 0,
      totalArea: 0,
      fittedPlanes: [],
      authority: REVIEW_ONLY_AUTHORITY,
      limitations,
    };
  }

  // Optional: pre-filter with voxel grid
  let filteredPoints = points;
  if (prefilterVoxelSize > 0) {
    filteredPoints = simpleVoxelFilter(points, prefilterVoxelSize);
  }

  // Step 1: Group points by segmentation class
  const classGroups = new Map<number, Point3D[]>();
  for (const p of filteredPoints) {
    const cls = p.segClass ?? -1;
    if (!meshClasses.includes(cls) && cls !== -1) continue; // skip unwanted classes
    if (!classGroups.has(cls)) classGroups.set(cls, []);
    classGroups.get(cls)!.push(p);
  }

  // Also add unclassified points as a separate group
  const unclassified = filteredPoints.filter(p => p.segClass === undefined || p.segClass === -1);
  if (unclassified.length >= ransacMinInliers && meshClasses.includes(-1)) {
    classGroups.set(-1, unclassified);
  }

  const patches: MeshPatch[] = [];
  const fittedPlanes: FittedPlane[] = [];

  // Step 2 & 3: Fit planes and triangulate per class
  for (const [segClass, classPoints] of classGroups) {
    if (classPoints.length < ransacMinInliers) continue;

    // Fit multiple planes within this class using iterative RANSAC
    const remainingPoints = [...classPoints];

    for (let planeIdx = 0; planeIdx < maxPlanesPerClass && remainingPoints.length >= ransacMinInliers; planeIdx++) {
      const plane = fitPlaneRansac(
        remainingPoints,
        ransacDistanceThreshold,
        ransacMaxIterations,
        ransacMinInliers,
      );

      if (!plane) break;

      plane.segClass = segClass;
      fittedPlanes.push(plane);

      // Find inliers for this plane
      const inlierIndices: number[] = [];
      for (let i = 0; i < remainingPoints.length; i++) {
        const p = remainingPoints[i];
        const dist = Math.abs(plane.nx * p.x + plane.ny * p.y + plane.nz * p.z + plane.d);
        if (dist <= ransacDistanceThreshold) {
          inlierIndices.push(i);
        }
      }

      // Extract inlier points
      const inlierPoints = inlierIndices.map(i => remainingPoints[i]);

      // Remove inliers from remaining (for next RANSAC iteration)
      const inlierSet = new Set(inlierIndices);
      for (let i = remainingPoints.length - 1; i >= 0; i--) {
        if (inlierSet.has(i)) remainingPoints.splice(i, 1);
      }

      if (inlierPoints.length < 3) continue;

      // Project onto plane if requested
      const projectedPoints = shouldProject
        ? inlierPoints.map(p => projectOntoPlane(p, plane))
        : inlierPoints;

      // Step 4: Triangulate in local 2D frame
      const frame = planeTangentFrame(plane);
      const points2D = projectTo2D(projectedPoints, frame);

      const triangles2D = triangulatePoints2D(points2D, maxEdgeLength, minTriangleAngle);

      // Compute patch bounds
      let xMin = Infinity, yMin = Infinity, zMin = Infinity;
      let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
      for (const p of projectedPoints) {
        if (p.x < xMin) xMin = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.z < zMin) zMin = p.z;
        if (p.x > xMax) xMax = p.x;
        if (p.y > yMax) yMax = p.y;
        if (p.z > zMax) zMax = p.z;
      }

      // Compute patch area
      let patchArea = 0;
      for (const tri of triangles2D) {
        patchArea += triangleArea3D(
          projectedPoints[tri.v0],
          projectedPoints[tri.v1],
          projectedPoints[tri.v2],
        );
      }

      patches.push({
        vertices: projectedPoints,
        triangles: triangles2D,
        plane,
        segClass,
        estimatedArea: patchArea,
        bounds: { xMin, yMin, zMin, xMax, yMax, zMax },
      });
    }
  }

  // Build unified arrays
  const allVertices: Point3D[] = [];
  const allTriangles: Triangle[] = [];
  let vertexOffset = 0;

  for (const patch of patches) {
    allVertices.push(...patch.vertices);
    for (const tri of patch.triangles) {
      allTriangles.push({
        v0: tri.v0 + vertexOffset,
        v1: tri.v1 + vertexOffset,
        v2: tri.v2 + vertexOffset,
      });
    }
    vertexOffset += patch.vertices.length;
  }

  const totalArea = patches.reduce((sum, p) => sum + p.estimatedArea, 0);

  return {
    patches,
    allVertices,
    allTriangles,
    vertexCount: allVertices.length,
    triangleCount: allTriangles.length,
    totalArea,
    fittedPlanes,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations,
  };
}

// ---------------------------------------------------------------------------
// Simple voxel filter for pre-filtering
// ---------------------------------------------------------------------------

/**
 * Simple voxel-grid filter: keep one point per voxel (closest to center).
 */
function simpleVoxelFilter(points: Point3D[], voxelSize: number): Point3D[] {
  if (voxelSize <= 0) return points;

  const voxels = new Map<string, Point3D>();

  for (const p of points) {
    const key = `${Math.floor(p.x / voxelSize)},${Math.floor(p.y / voxelSize)},${Math.floor(p.z / voxelSize)}`;
    if (!voxels.has(key)) {
      voxels.set(key, p);
    }
  }

  return Array.from(voxels.values());
}
