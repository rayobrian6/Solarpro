/**
 * Depth map unprojection — converts a 2D depth grid into a 3D point cloud
 * using the pinhole camera model.
 *
 * Given:
 *   - A depth map (Float32Array, high=far convention)
 *   - Camera intrinsic parameters (focal length, principal point, or FOV)
 *   - Optional camera extrinsic parameters (rotation + translation)
 *
 * Produces:
 *   - A 3D point cloud (Float32Array of [x,y,z,...] triplets)
 *   - Per-point normal estimates (from depth gradient)
 *   - Per-point segmentation class (from mask overlay)
 *
 * The pinhole unprojection formula:
 *   x = (u - cx) * depth / fx
 *   y = (v - cy) * depth / fy
 *   z = depth
 *
 * Where (u,v) are pixel coordinates, (cx,cy) is the principal point,
 * and (fx,fy) are focal lengths in pixels.
 *
 * For MiDaS depth (relative, not metric), we apply a scale-shift alignment
 * when multi-view correspondences are available (see depthFusion.ts).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { DepthMap, NormalizedPoint, SemanticSegmentationMask } from '../../types';
import { decodeDepthMap, computeDepthStats } from '../depth/depthMapDecode';
import type { DepthStatistics } from '../depth/depthMapDecode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Camera intrinsic parameters for unprojection. */
export interface CameraIntrinsics {
  /** Horizontal focal length in pixels. If unknown, derived from fovH. */
  fx: number;
  /** Vertical focal length in pixels. If unknown, derived from fovV. */
  fy: number;
  /** Principal point x (usually image_width / 2). */
  cx: number;
  /** Principal point y (usually image_height / 2). */
  cy: number;
  /** Source image width in pixels (used for normalization). */
  imageWidth: number;
  /** Source image height in pixels (used for normalization). */
  imageHeight: number;
}

/** Camera extrinsic parameters (world-from-camera transform). */
export interface CameraExtrinsics {
  /** 3x3 rotation matrix (row-major). If not provided, identity is used. */
  rotation: number[];
  /** 3-element translation vector [tx, ty, tz]. If not provided, zero is used. */
  translation: [number, number, number];
}

/** A single 3D point with optional attributes. */
export interface Point3D {
  x: number;
  y: number;
  z: number;
  /** Estimated surface normal (unit vector). */
  nx?: number;
  ny?: number;
  nz?: number;
  /** Segmentation class at this pixel (-1 if unknown). */
  segClass?: number;
  /** Depth value at this pixel (before unprojection). */
  rawDepth?: number;
  /** Pixel column in the depth grid. */
  pixelU?: number;
  /** Pixel row in the depth grid. */
  pixelV?: number;
  /** Source file ID this point came from. */
  fileId?: string;
}

/** Result of depth map unprojection. */
export interface UnprojectionResult {
  /** 3D points in camera (or world) coordinates. */
  points: Point3D[];
  /** Number of valid points (non-zero depth, within bounds). */
  validCount: number;
  /** Depth statistics for the input. */
  stats: DepthStatistics;
  /** Axis-aligned bounding box of the point cloud { xMin, yMin, zMin, xMax, yMax, zMax }. */
  bounds: { xMin: number; yMin: number; zMin: number; xMax: number; yMax: number; zMax: number };
  /** Whether the depth was treated as metric or relative. */
  depthMode: 'metric' | 'relative';
  /** Authority envelope. */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
  };
}

/** Options for depth map unprojection. */
export interface UnprojectionOptions {
  /** Depth value threshold — pixels with depth below this are skipped (likely sky). Default: 0.02 */
  minDepth?: number;
  /** Depth value threshold — pixels with depth above this are skipped. Default: 0.98 */
  maxDepth?: number;
  /** Whether to estimate per-point normals from depth gradient. Default: true */
  estimateNormals?: boolean;
  /** Normal estimation kernel size (pixels). Default: 3 */
  normalKernelSize?: number;
  /** Whether to assign segmentation class from overlapping masks. Default: true */
  assignSegClass?: boolean;
  /** Downsample factor — only unproject every Nth pixel. Default: 1 (all pixels) */
  downsampleFactor?: number;
  /** Whether depth is metric (meters) or relative (MiDaS normalized). Default: 'relative' */
  depthMode?: 'metric' | 'relative';
  /** Scale factor for relative depth (applied before unprojection). Default: 1.0 */
  relativeScale?: number;
  /** Shift factor for relative depth (applied before unprojection). Default: 0.0 */
  relativeShift?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVIEW_ONLY_AUTHORITY = {
  reviewOnly: true as const,
  nonAuthoritative: true as const,
  cadMutationAllowed: false as const,
  permitGenerationAllowed: false as const,
  bomMutationAllowed: false as const,
};

// ---------------------------------------------------------------------------
// Camera intrinsics helpers
// ---------------------------------------------------------------------------

/**
 * Derive camera intrinsics from field-of-view angles and image dimensions.
 * Uses the pinhole model: fx = (imageWidth / 2) / tan(fovH / 2)
 */
export function intrinsicsFromFOV(
  fovH: number,
  fovV: number,
  imageWidth: number,
  imageHeight: number,
): CameraIntrinsics {
  const fx = (imageWidth / 2) / Math.tan((fovH * Math.PI) / 360);
  const fy = (imageHeight / 2) / Math.tan((fovV * Math.PI) / 360);
  return {
    fx,
    fy,
    cx: imageWidth / 2,
    cy: imageHeight / 2,
    imageWidth,
    imageHeight,
  };
}

/**
 * Derive camera intrinsics assuming a typical smartphone camera FOV.
 * Default: 65° horizontal, 50° vertical (common for phone rear camera).
 */
export function defaultPhoneIntrinsics(
  imageWidth: number,
  imageHeight: number,
  fovH = 65,
  fovV = 50,
): CameraIntrinsics {
  return intrinsicsFromFOV(fovH, fovV, imageWidth, imageHeight);
}

// ---------------------------------------------------------------------------
// Depth gradient → normal estimation
// ---------------------------------------------------------------------------

/**
 * Estimate surface normal at a pixel using central differences on the depth grid.
 * The normal is computed from the cross product of the surface tangent vectors.
 *
 * In the pinhole camera model, the tangent vectors at pixel (u,v) with depth d are:
 *   du = [1/fx, 0, dd/du * (1/fx)] (approximate)
 *   dv = [0, 1/fy, dd/dv * (1/fy)] (approximate)
 * Normal = du × dv, then normalize.
 */
function estimateNormalAtPixel(
  grid: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  fx: number,
  fy: number,
  kernelSize: number,
): { nx: number; ny: number; nz: number } {
  const halfK = Math.floor(kernelSize / 2);

  // Central differences in depth
  const uMin = Math.max(0, u - halfK);
  const uMax = Math.min(width - 1, u + halfK);
  const vMin = Math.max(0, v - halfK);
  const vMax = Math.min(height - 1, v + halfK);

  const idx = v * width + u;
  const d = grid[idx];

  if (d < 1e-6) return { nx: 0, ny: 0, nz: 1 };

  // Depth gradient in pixel space
  const ddDu = uMax > uMin ? (grid[v * width + uMax] - grid[v * width + uMin]) / (uMax - uMin) : 0;
  const ddDv = vMax > vMin ? (grid[vMax * width + u] - grid[vMin * width + u]) / (vMax - vMin) : 0;

  // Surface tangent vectors in camera space
  // Tangent along u: direction = (1/fx, 0, dd/du / fx) * d
  // Tangent along v: direction = (0, 1/fy, dd/dv / fy) * d
  const tx0 = 1 / fx;
  const tz0 = ddDu / fx;
  const ty1 = 1 / fy;
  const tz1 = ddDv / fy;

  // Cross product: tangent_u × tangent_v
  let nx = -tz0 * ty1; // 0* tz1 - tz0 * ty1
  let ny = -tx0 * tz1; // tz0 * 0 - tx0 * tz1  → actually (tx0*tz1 - tz0*0) wait...
  let nz = tx0 * ty1; // tx0*ty1 - 0*0

  // Let me redo this properly:
  // tangent_u = [tx0, 0, tz0]
  // tangent_v = [0, ty1, tz1]
  // cross = [0*tz1 - tz0*ty1, tz0*0 - tx0*tz1, tx0*ty1 - 0*0]
  nx = -tz0 * ty1;
  ny = tz0 * 0 - tx0 * tz1; // = -tx0 * tz1
  nz = tx0 * ty1;

  // Normalize
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (mag < 1e-9) return { nx: 0, ny: 0, nz: 1 };

  return { nx: nx / mag, ny: ny / mag, nz: nz / mag };
}

// ---------------------------------------------------------------------------
// Mask class assignment
// ---------------------------------------------------------------------------

/**
 * Determine which segmentation class a pixel belongs to by checking
 * which mask polygon contains it. Returns the class ID or -1.
 */
function classifyPixel(
  u: number,
  v: number,
  depthWidth: number,
  depthHeight: number,
  masks: SemanticSegmentationMask[],
): number {
  // Convert pixel coords to normalized 0-1000 coords
  const normX = (u / depthWidth) * 1000;
  const normY = (v / depthHeight) * 1000;

  for (let mi = 0; mi < masks.length; mi++) {
    const mask = masks[mi];
    if (pointInPolygon(normX, normY, mask.polygon)) {
      // Map class string to numeric ID
      const classMap: Record<string, number> = {
        roof: 1,
        wall: 2,
        sky: 3,
        tree: 4,
        ground: 5,
        obstruction: 6,
        equipment: 7,
      };
      return classMap[mask.segmentationClass] ?? -1;
    }
  }
  return -1;
}

/**
 * Point-in-polygon test using ray casting algorithm.
 */
function pointInPolygon(x: number, y: number, polygon: NormalizedPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Main unprojection function
// ---------------------------------------------------------------------------

/**
 * Unproject a depth map into a 3D point cloud using the pinhole camera model.
 *
 * For each pixel (u, v) in the depth grid with depth value d:
 *   X_cam = (u - cx) * d / fx
 *   Y_cam = (v - cy) * d / fy
 *   Z_cam = d
 *
 * If extrinsics are provided, the points are transformed to world coordinates:
 *   P_world = R * P_cam + T
 *
 * @param depthMap - The DepthMap artifact to unproject
 * @param intrinsics - Camera intrinsic parameters
 * @param extrinsics - Optional camera extrinsic parameters
 * @param masks - Optional segmentation masks for per-point class assignment
 * @param options - Unprojection options
 * @returns Unprojection result with 3D point cloud and metadata
 */
export function unprojectDepthMap(
  depthMap: DepthMap,
  intrinsics: CameraIntrinsics,
  extrinsics?: CameraExtrinsics,
  masks?: SemanticSegmentationMask[],
  options: UnprojectionOptions = {},
): UnprojectionResult {
  const {
    minDepth = 0.02,
    maxDepth = 0.98,
    estimateNormals = true,
    normalKernelSize = 3,
    assignSegClass = true,
    downsampleFactor = 1,
    depthMode = 'relative',
    relativeScale = 1.0,
    relativeShift = 0.0,
  } = options;

  const grid = decodeDepthMap(depthMap);
  const width = depthMap.width;
  const height = depthMap.height;
  const stats = computeDepthStats(grid);

  const { fx, fy, cx, cy } = intrinsics;

  // Scale the depth grid dimensions to the original image dimensions
  // The depth grid is at reduced resolution (e.g., 64x64), but intrinsics
  // are in original image pixel space. We need to scale pixel coords.
  const scaleX = intrinsics.imageWidth / width;
  const scaleY = intrinsics.imageHeight / height;

  // Adjust principal point and focal length to depth grid coordinates
  const fxScaled = fx / scaleX;
  const fyScaled = fy / scaleY;
  const cxScaled = cx / scaleX;
  const cyScaled = cy / scaleY;

  // Extrinsics: rotation and translation
  const R = extrinsics?.rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const T = extrinsics?.translation ?? [0, 0, 0];

  const points: Point3D[] = [];
  let validCount = 0;

  // Compute bounds
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;

  for (let v = 0; v < height; v += downsampleFactor) {
    for (let u = 0; u < width; u += downsampleFactor) {
      const idx = v * width + u;
      let d = grid[idx];

      // Apply scale-shift for relative depth
      if (depthMode === 'relative') {
        d = d * relativeScale + relativeShift;
      }

      // Skip invalid depth
      if (d < minDepth || d > maxDepth || !isFinite(d)) continue;

      // Unproject: pixel (u, v) with depth d → camera-space 3D point
      const xCam = (u - cxScaled) * d / fxScaled;
      const yCam = (v - cyScaled) * d / fyScaled;
      const zCam = d;

      // Transform to world coordinates: P_world = R * P_cam + T
      const xWorld = R[0] * xCam + R[1] * yCam + R[2] * zCam + T[0];
      const yWorld = R[3] * xCam + R[4] * yCam + R[5] * zCam + T[1];
      const zWorld = R[6] * xCam + R[7] * yCam + R[8] * zCam + T[2];

      const point: Point3D = {
        x: xWorld,
        y: yWorld,
        z: zWorld,
        rawDepth: d,
        pixelU: u,
        pixelV: v,
        fileId: depthMap.fileId,
      };

      // Estimate normal
      if (estimateNormals) {
        const normal = estimateNormalAtPixel(
          grid, width, height, u, v,
          fxScaled, fyScaled, normalKernelSize,
        );
        point.nx = normal.nx;
        point.ny = normal.ny;
        point.nz = normal.nz;
      }

      // Assign segmentation class
      if (assignSegClass && masks && masks.length > 0) {
        point.segClass = classifyPixel(u, v, width, height, masks);
      }

      points.push(point);
      validCount++;

      // Update bounds
      if (xWorld < xMin) xMin = xWorld;
      if (yWorld < yMin) yMin = yWorld;
      if (zWorld < zMin) zMin = zWorld;
      if (xWorld > xMax) xMax = xWorld;
      if (yWorld > yMax) yMax = yWorld;
      if (zWorld > zMax) zMax = zWorld;
    }
  }

  // Handle empty point cloud
  if (validCount === 0) {
    return {
      points: [],
      validCount: 0,
      stats,
      bounds: { xMin: 0, yMin: 0, zMin: 0, xMax: 0, yMax: 0, zMax: 0 },
      depthMode,
      authority: REVIEW_ONLY_AUTHORITY,
    };
  }

  return {
    points,
    validCount,
    stats,
    bounds: { xMin, yMin, zMin, xMax, yMax, zMax },
    depthMode,
    authority: REVIEW_ONLY_AUTHORITY,
  };
}

// ---------------------------------------------------------------------------
// Convenience: unproject with default phone intrinsics
// ---------------------------------------------------------------------------

/**
 * Unproject a depth map using default smartphone camera intrinsics.
 * This is the common case for Solarpro survey photos taken with phones.
 */
export function unprojectDepthMapDefault(
  depthMap: DepthMap,
  masks?: SemanticSegmentationMask[],
  options: UnprojectionOptions = {},
): UnprojectionResult {
  const intrinsics = defaultPhoneIntrinsics(
    depthMap.width * 8, // approximate original image width (depth grid is 64x64, original ~512)
    depthMap.height * 8,
    65, // typical phone FOV horizontal
    50, // typical phone FOV vertical
  );
  return unprojectDepthMap(depthMap, intrinsics, undefined, masks, options);
}
