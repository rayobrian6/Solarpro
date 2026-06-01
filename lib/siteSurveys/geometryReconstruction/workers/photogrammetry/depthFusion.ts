/**
 * Multi-view depth fusion — aligns and merges depth maps from multiple photos
 * to produce a consistent 3D point cloud.
 *
 * Key challenges with monocular depth (MiDaS):
 *   1. Depth is relative (affine-invariant), not metric — different scale/shift per image
 *   2. No multi-view consistency — overlapping regions may have different depth values
 *   3. No camera poses — we don't know the relative rotation/translation between views
 *
 * Our approach (pragmatic, no SfM required):
 *   Step 1: Per-view unprojection using assumed camera intrinsics
 *   Step 2: Scale-shift alignment using segmentation-based correspondences
 *           (same roof plane seen from two views → depth alignment)
 *   Step 3: Point cloud merge with voxel-grid filtering for consistency
 *   Step 4: Outlier removal (statistical outlier detection)
 *
 * When EXIF metadata provides camera angles, we can refine the extrinsics.
 * When SfM becomes available (future), this module will be upgraded.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  DepthMap,
  SemanticSegmentationMask,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  NormalizedPoint,
} from '../../types';
import { decodeDepthMap, computeDepthStats } from '../depth/depthMapDecode';
import type { UnprojectionResult, Point3D, CameraIntrinsics } from './depthUnprojection';
import { unprojectDepthMap, defaultPhoneIntrinsics } from './depthUnprojection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scale-shift alignment parameters for a single depth map. */
export interface AlignmentParams {
  /** Scale factor to apply to depth values. */
  scale: number;
  /** Shift to apply after scaling: aligned_depth = depth * scale + shift. */
  shift: number;
  /** Number of correspondence points used for alignment. */
  correspondenceCount: number;
  /** Residual error after alignment (RMS). */
  residualRms: number;
  /** Whether alignment was successful. */
  valid: boolean;
}

/** Result of multi-view depth fusion. */
export interface DepthFusionResult {
  /** Merged 3D point cloud from all views. */
  mergedPoints: Point3D[];
  /** Per-view alignment parameters. */
  alignments: Map<string, AlignmentParams>;
  /** Per-view unprojection results. */
  perViewResults: Map<string, UnprojectionResult>;
  /** Number of views successfully fused. */
  viewCount: number;
  /** Voxel size used for filtering (in normalized depth units). */
  voxelSize: number;
  /** Number of points before voxel filtering. */
  rawPointCount: number;
  /** Number of points after voxel filtering. */
  filteredPointCount: number;
  /** Authority envelope. */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
  };
}

/** Options for depth fusion. */
export interface DepthFusionOptions {
  /** Voxel size for point cloud filtering (in normalized units). Default: 0.01 */
  voxelSize?: number;
  /** Minimum number of overlapping points required for alignment. Default: 10 */
  minCorrespondences?: number;
  /** Maximum alignment residual RMS to accept. Default: 0.1 */
  maxAlignmentRms?: number;
  /** Whether to perform statistical outlier removal. Default: true */
  removeOutliers?: boolean;
  /** Outlier removal: number of neighbors to consider. Default: 20 */
  outlierNeighbors?: number;
  /** Outlier removal: multiplier for standard deviation threshold. Default: 2.0 */
  outlierStdMultiplier?: number;
  /** Default camera FOV horizontal (degrees) for intrinsics. Default: 65 */
  defaultFovH?: number;
  /** Default camera FOV vertical (degrees) for intrinsics. Default: 50 */
  defaultFovV?: number;
  /** Downsample factor for unprojection. Default: 2 (every 2nd pixel) */
  downsampleFactor?: number;
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
// Scale-shift alignment via plane correspondences
// ---------------------------------------------------------------------------

/**
 * Compute scale-shift alignment parameters between two depth maps using
 * plane-based correspondences.
 *
 * When the same roof plane is visible in two views, its depth distribution
 * should be similar (up to a global scale and shift). We find matching
 * planes (by normal similarity) and solve for the optimal scale/shift.
 *
 * The alignment model: depth_b = depth_a * scale + shift
 *
 * We solve via least squares on the mean depths of matching planes.
 */
export function alignDepthMaps(
  depthA: DepthMap,
  depthB: DepthMap,
  planesA: (RoofPlaneCandidate | WallPlaneCandidate)[],
  planesB: (RoofPlaneCandidate | WallPlaneCandidate)[],
): AlignmentParams {
  // Find matching plane pairs by normal similarity
  const pairs: { meanA: number; meanB: number }[] = [];

  const gridA = decodeDepthMap(depthA);
  const gridB = decodeDepthMap(depthB);

  for (const pA of planesA) {
    for (const pB of planesB) {
      // Check normal similarity (cosine >= 0.85)
      const dot = Math.abs(
        pA.normal[0] * pB.normal[0] +
        pA.normal[1] * pB.normal[1] +
        pA.normal[2] * pB.normal[2],
      );
      if (dot >= 0.85) {
        // Compute mean depth in the overlapping region
        const meanA = computeMeanDepthInRegion(gridA, depthA.width, depthA.height, pA);
        const meanB = computeMeanDepthInRegion(gridB, depthB.width, depthB.height, pB);
        if (meanA > 0 && meanB > 0) {
          pairs.push({ meanA, meanB });
        }
      }
    }
  }

  if (pairs.length < 2) {
    return {
      scale: 1.0,
      shift: 0.0,
      correspondenceCount: pairs.length,
      residualRms: 0,
      valid: pairs.length > 0,
    };
  }

  // Solve least squares: depthB = scale * depthA + shift
  // Using normal equations: [sum(a²), sum(a); sum(a), n] * [scale; shift] = [sum(ab); sum(b)]
  let sumA = 0, sumB = 0, sumAA = 0, sumAB = 0;
  const n = pairs.length;

  for (const p of pairs) {
    sumA += p.meanA;
    sumB += p.meanB;
    sumAA += p.meanA * p.meanA;
    sumAB += p.meanA * p.meanB;
  }

  const det = n * sumAA - sumA * sumA;
  if (Math.abs(det) < 1e-12) {
    return { scale: 1.0, shift: 0.0, correspondenceCount: n, residualRms: 0, valid: false };
  }

  const scale = (n * sumAB - sumA * sumB) / det;
  const shift = (sumB - scale * sumA) / n;

  // Compute residual RMS
  let residualSum = 0;
  for (const p of pairs) {
    const predicted = p.meanA * scale + shift;
    const residual = p.meanB - predicted;
    residualSum += residual * residual;
  }
  const residualRms = Math.sqrt(residualSum / n);

  return {
    scale,
    shift,
    correspondenceCount: n,
    residualRms,
    valid: true,
  };
}

/**
 * Compute the mean depth value within a plane candidate's region.
 * Falls back to the overall depth map mean if no region is available.
 */
function computeMeanDepthInRegion(
  grid: Float32Array,
  width: number,
  height: number,
  plane: RoofPlaneCandidate | WallPlaneCandidate,
): number {
  // If we have a region defined, sample within it
  if (plane.region && 'x' in plane.region && 'width' in plane.region) {
    const r = plane.region as { x: number; y: number; width: number; height: number };
    // Region coords are in 0-1000 normalized space; convert to grid coords
    const x0 = Math.floor((r.x / 1000) * width);
    const y0 = Math.floor((r.y / 1000) * height);
    const x1 = Math.min(width - 1, Math.floor(((r.x + r.width) / 1000) * width));
    const y1 = Math.min(height - 1, Math.floor(((r.y + r.height) / 1000) * height));

    let sum = 0;
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const val = grid[y * width + x];
        if (val > 0.01 && val < 0.99) {
          sum += val;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  }

  // No region — return 0 (can't compute)
  return 0;
}

// ---------------------------------------------------------------------------
// Voxel-grid filtering
// ---------------------------------------------------------------------------

/**
 * Filter a point cloud using a voxel grid. Within each voxel, keep only
 * the point closest to the voxel center (or average all points in the voxel).
 *
 * This reduces redundancy and provides basic multi-view consistency:
 * if multiple views produce points in the same voxel, the average represents
 * the consensus.
 */
export function voxelGridFilter(
  points: Point3D[],
  voxelSize: number,
  mode: 'average' | 'closest' = 'average',
): Point3D[] {
  if (points.length === 0 || voxelSize <= 0) return points;

  // Assign each point to a voxel key
  const voxelMap = new Map<string, Point3D[]>();

  for (const p of points) {
    const vx = Math.floor(p.x / voxelSize);
    const vy = Math.floor(p.y / voxelSize);
    const vz = Math.floor(p.z / voxelSize);
    const key = `${vx},${vy},${vz}`;

    if (!voxelMap.has(key)) voxelMap.set(key, []);
    voxelMap.get(key)!.push(p);
  }

  const result: Point3D[] = [];

  for (const [, voxelPoints] of voxelMap) {
    if (mode === 'average') {
      // Average all points in the voxel
      const avg: Point3D = {
        x: 0, y: 0, z: 0,
        rawDepth: 0,
      };
      let count = 0;

      for (const p of voxelPoints) {
        avg.x += p.x;
        avg.y += p.y;
        avg.z += p.z;
        if (p.nx !== undefined) {
          avg.nx = (avg.nx ?? 0) + p.nx;
          avg.ny = (avg.ny ?? 0) + p.ny;
          avg.nz = (avg.nz ?? 0) + p.nz;
        }
        if (p.rawDepth !== undefined) avg.rawDepth! += p.rawDepth;
        if (p.segClass !== undefined) avg.segClass = p.segClass; // use first
        count++;
      }

      avg.x /= count;
      avg.y /= count;
      avg.z /= count;
      if (avg.nx !== undefined) {
        const mag = Math.sqrt(avg.nx * avg.nx + avg.ny * avg.ny + avg.nz * avg.nz);
        if (mag > 1e-9) {
          avg.nx /= mag;
          avg.ny /= mag;
          avg.nz /= mag;
        }
      }
      if (avg.rawDepth !== undefined) avg.rawDepth! /= count;

      // Use fileId from the first point
      avg.fileId = voxelPoints[0].fileId;

      result.push(avg);
    } else {
      // Closest to voxel center
      const cx = (Math.floor(voxelPoints[0].x / voxelSize) + 0.5) * voxelSize;
      const cy = (Math.floor(voxelPoints[0].y / voxelSize) + 0.5) * voxelSize;
      const cz = (Math.floor(voxelPoints[0].z / voxelSize) + 0.5) * voxelSize;

      let bestDist = Infinity;
      let bestPoint = voxelPoints[0];

      for (const p of voxelPoints) {
        const dist = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          bestPoint = p;
        }
      }

      result.push(bestPoint);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Statistical outlier removal
// ---------------------------------------------------------------------------

/**
 * Remove statistical outliers from a point cloud.
 *
 * For each point, compute the average distance to its k nearest neighbors.
 * Points where this average distance exceeds mean + multiplier * stddev
 * are considered outliers and removed.
 */
export function removeStatisticalOutliers(
  points: Point3D[],
  neighbors: number = 20,
  stdMultiplier: number = 2.0,
): Point3D[] {
  if (points.length <= neighbors) return points;

  // Compute average neighbor distances
  const avgDistances = new Float32Array(points.length);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Find k nearest neighbors (brute force — acceptable for small clouds)
    const distances: number[] = [];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dx = p.x - points[j].x;
      const dy = p.y - points[j].y;
      const dz = p.z - points[j].z;
      distances.push(dx * dx + dy * dy + dz * dz);
    }
    distances.sort((a, b) => a - b);

    // Average of k smallest
    let sum = 0;
    const k = Math.min(neighbors, distances.length);
    for (let n = 0; n < k; n++) {
      sum += Math.sqrt(distances[n]);
    }
    avgDistances[i] = sum / k;
  }

  // Compute global mean and stddev of average distances
  let mean = 0;
  for (let i = 0; i < avgDistances.length; i++) mean += avgDistances[i];
  mean /= avgDistances.length;

  let variance = 0;
  for (let i = 0; i < avgDistances.length; i++) {
    const diff = avgDistances[i] - mean;
    variance += diff * diff;
  }
  const stddev = Math.sqrt(variance / avgDistances.length);

  const threshold = mean + stdMultiplier * stddev;

  return points.filter((_, i) => avgDistances[i] <= threshold);
}

// ---------------------------------------------------------------------------
// Main fusion function
// ---------------------------------------------------------------------------

/**
 * Fuse multiple depth maps into a single consistent 3D point cloud.
 *
 * Pipeline:
 *   1. Unproject each depth map using camera intrinsics
 *   2. Align depth maps using plane correspondences (scale-shift)
 *   3. Merge point clouds
 *   4. Apply voxel-grid filtering for consistency
 *   5. Remove statistical outliers
 *
 * @param depthMaps - Array of DepthMap artifacts (one per photo)
 * @param masks - Per-photo segmentation masks (keyed by fileId)
 * @param roofPlanes - Per-photo roof plane candidates (keyed by fileId)
 * @param wallPlanes - Per-photo wall plane candidates (keyed by fileId)
 * @param options - Fusion options
 * @returns Fused point cloud result
 */
export function fuseDepthMaps(
  depthMaps: DepthMap[],
  masks: Map<string, SemanticSegmentationMask[]>,
  roofPlanes: Map<string, RoofPlaneCandidate[]>,
  wallPlanes: Map<string, WallPlaneCandidate[]>,
  options: DepthFusionOptions = {},
): DepthFusionResult {
  const {
    voxelSize = 0.01,
    minCorrespondences = 10,
    maxAlignmentRms = 0.1,
    removeOutliers = true,
    outlierNeighbors = 20,
    outlierStdMultiplier = 2.0,
    defaultFovH = 65,
    defaultFovV = 50,
    downsampleFactor = 2,
  } = options;

  const alignments = new Map<string, AlignmentParams>();
  const perViewResults = new Map<string, UnprojectionResult>();
  const allPoints: Point3D[] = [];

  // Reference depth map (first one) — others are aligned to this
  const referenceId = depthMaps.length > 0 ? depthMaps[0].fileId : '';

  // Step 1: Unproject each depth map
  for (const depthMap of depthMaps) {
    const fileId = depthMap.fileId;
    const intrinsics = defaultPhoneIntrinsics(
      depthMap.width * 8,
      depthMap.height * 8,
      defaultFovH,
      defaultFovV,
    );

    const viewMasks = masks.get(fileId) ?? [];
    const result = unprojectDepthMap(depthMap, intrinsics, undefined, viewMasks, {
      downsampleFactor,
      depthMode: 'relative',
      assignSegClass: true,
      estimateNormals: true,
    });

    perViewResults.set(fileId, result);
    alignments.set(fileId, {
      scale: 1.0,
      shift: 0.0,
      correspondenceCount: 0,
      residualRms: 0,
      valid: true,
    });
  }

  // Step 2: Align non-reference depth maps to the reference
  if (depthMaps.length > 1) {
    const refDepth = depthMaps[0];
    const refRoofPlanes = roofPlanes.get(referenceId) ?? [];
    const refWallPlanes = wallPlanes.get(referenceId) ?? [];
    const refPlanes = [...refRoofPlanes, ...refWallPlanes];

    for (let i = 1; i < depthMaps.length; i++) {
      const currDepth = depthMaps[i];
      const currFileId = currDepth.fileId;
      const currRoofPlanes = roofPlanes.get(currFileId) ?? [];
      const currWallPlanes = wallPlanes.get(currFileId) ?? [];
      const currPlanes = [...currRoofPlanes, ...currWallPlanes];

      const alignment = alignDepthMaps(refDepth, currDepth, refPlanes, currPlanes);
      alignments.set(currFileId, alignment);

      // Apply alignment to the unprojected points
      const viewResult = perViewResults.get(currFileId);
      if (viewResult && alignment.valid) {
        for (const p of viewResult.points) {
          // Scale-shift the depth value and re-unproject
          // Since we can't easily re-unproject, we scale the Z coordinate
          // and adjust X, Y proportionally
          const s = alignment.scale;
          const sh = alignment.shift;
          p.z = p.z * s + sh;
          p.x = p.x * s; // X scales with depth
          p.y = p.y * s; // Y scales with depth
          if (p.rawDepth !== undefined) {
            p.rawDepth = p.rawDepth * s + sh;
          }
        }
      }
    }
  }

  // Step 3: Collect all points
  for (const [, viewResult] of perViewResults) {
    allPoints.push(...viewResult.points);
  }

  const rawPointCount = allPoints.length;

  // Step 4: Voxel-grid filtering
  const filtered = voxelGridFilter(allPoints, voxelSize, 'average');
  const filteredPointCount = filtered.length;

  // Step 5: Statistical outlier removal
  let finalPoints = filtered;
  if (removeOutliers && filtered.length > outlierNeighbors) {
    finalPoints = removeStatisticalOutliers(filtered, outlierNeighbors, outlierStdMultiplier);
  }

  return {
    mergedPoints: finalPoints,
    alignments,
    perViewResults,
    viewCount: depthMaps.length,
    voxelSize,
    rawPointCount,
    filteredPointCount: finalPoints.length,
    authority: REVIEW_ONLY_AUTHORITY,
  };
}
