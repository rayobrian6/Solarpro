/**
 * Depth-aware plane extraction — uses depth gradient analysis to identify
 * roof planes more accurately than the current heuristic-based approach.
 *
 * This module provides utilities that:
 * 1. Detect depth discontinuities (edges between planes)
 * 2. Segment the depth grid into planar regions
 * 3. Estimate plane orientation from depth gradients
 * 4. Score plane candidates by depth consistency
 *
 * Design decisions:
 * - Operates on decoded Float32Array depth grids (high=far convention)
 * - Uses flood-fill segmentation on depth similarity
 * - Computes depth gradient (partial derivatives) for orientation estimation
 * - Outputs are review-only operator aids, NOT CAD geometry
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { DepthMap, NormalizedPoint } from '../../types';
import {
  decodeDepthMap,
  computeDepthStats,
} from './depthMapDecode';
import type { DepthStatistics } from './depthMapDecode';
import {
  generateDepthQualityReport,
  isDepthUsableFor,
} from './depthQualityReport';
import type { DepthQualityReport } from './depthQualityReport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A candidate plane region detected in the depth grid */
export interface DepthPlaneCandidate {
  /** Unique ID for this candidate */
  id: string;
  /** Label for this region (e.g., 'roof_plane_1', 'ground', 'sky') */
  label: string;
  /** Pixel indices in the depth grid that belong to this plane */
  pixelIndices: number[];
  /** Fraction of total pixels occupied by this plane */
  areaFraction: number;
  /** Mean depth value of this plane */
  meanDepth: number;
  /** Depth standard deviation within this plane */
  depthStdDev: number;
  /** Depth gradient magnitude (steepness) at the plane surface */
  gradientMagnitude: number;
  /** Estimated orientation: 'horizontal' (ground), 'slanted' (roof), 'vertical' (wall), 'far' (sky) */
  orientation: 'horizontal' | 'slanted' | 'vertical' | 'far';
  /** Bounding box in normalized image coordinates [0,1] */
  bounds: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  /** Polygon boundary in normalized coordinates (simplified convex hull) */
  boundaryPolygon: NormalizedPoint[];
  /** Confidence score 0-100 for this being a valid plane */
  confidence: number;
  /** Whether depth quality is sufficient for reliable plane detection */
  depthQuality: DepthQualityReport;
}

/** Options for depth-aware plane extraction */
export interface DepthPlaneOptions {
  /** Depth similarity threshold for flood-fill segmentation (default: 0.12) */
  depthThreshold?: number;
  /** Minimum area fraction for a region to be considered a plane (default: 0.02 = 2%) */
  minAreaFraction?: number;
  /** Maximum number of planes to detect (default: 10) */
  maxPlanes?: number;
  /** Whether to merge small adjacent planes with similar depth (default: true) */
  mergeSimilar?: number; // depth threshold for merging
}

/** Result of depth-aware plane extraction */
export interface DepthPlaneExtractionResult {
  /** Detected plane candidates, sorted by area (largest first) */
  planes: DepthPlaneCandidate[];
  /** Number of distinct depth discontinuity edges detected */
  edgeCount: number;
  /** The depth quality report used for the extraction */
  qualityReport: DepthQualityReport;
  /** Depth statistics */
  stats: DepthStatistics;
  /** Authority envelope */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
  };
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
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the depth gradient (partial derivatives) using central differences.
 * Returns [dDepth/dx, dDepth/dy] arrays.
 */
function computeDepthGradient(
  grid: Float32Array,
  width: number,
  height: number,
): { dx: Float32Array; dy: Float32Array } {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Central difference in x
      if (x > 0 && x < width - 1) {
        dx[idx] = (grid[y * width + x + 1] - grid[y * width + x - 1]) / 2;
      } else if (x === 0) {
        dx[idx] = grid[y * width + x + 1] - grid[idx];
      } else {
        dx[idx] = grid[idx] - grid[y * width + x - 1];
      }

      // Central difference in y
      if (y > 0 && y < height - 1) {
        dy[idx] = (grid[(y + 1) * width + x] - grid[(y - 1) * width + x]) / 2;
      } else if (y === 0) {
        dy[idx] = grid[(y + 1) * width + x] - grid[idx];
      } else {
        dy[idx] = grid[idx] - grid[(y - 1) * width + x];
      }
    }
  }

  return { dx, dy };
}

/**
 * Detect depth discontinuity edges using gradient magnitude.
 * Returns a boolean mask where true = edge pixel.
 */
function detectEdges(
  dx: Float32Array,
  dy: Float32Array,
  threshold: number,
): boolean[] {
  const edges = new Array<boolean>(dx.length);
  for (let i = 0; i < dx.length; i++) {
    const mag = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
    edges[i] = mag > threshold;
  }
  return edges;
}

/**
 * Flood-fill segmentation on depth similarity.
 * Groups adjacent pixels with similar depth values into regions.
 */
function floodFillSegment(
  grid: Float32Array,
  width: number,
  height: number,
  depthThreshold: number,
  edges: boolean[],
): { labels: Int32Array; numRegions: number } {
  const labels = new Int32Array(width * height).fill(-1);
  let currentLabel = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] !== -1 || edges[idx]) continue;

      // BFS flood fill
      const seedDepth = grid[idx];
      const queue: number[] = [idx];
      labels[idx] = currentLabel;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const cx = curr % width;
        const cy = Math.floor(curr / width);

        // 4-connected neighbors
        const neighbors: number[] = [];
        if (cx > 0) neighbors.push(cy * width + cx - 1);
        if (cx < width - 1) neighbors.push(cy * width + cx + 1);
        if (cy > 0) neighbors.push((cy - 1) * width + cx);
        if (cy < height - 1) neighbors.push((cy + 1) * width + cx);

        for (const nIdx of neighbors) {
          if (labels[nIdx] !== -1 || edges[nIdx]) continue;
          if (Math.abs(grid[nIdx] - seedDepth) <= depthThreshold) {
            labels[nIdx] = currentLabel;
            queue.push(nIdx);
          }
        }
      }

      currentLabel++;
    }
  }

  return { labels, numRegions: currentLabel };
}

/**
 * Classify the orientation of a plane region based on depth statistics.
 */
function classifyOrientation(
  meanDepth: number,
  gradientMag: number,
  yMin: number,
  yMax: number,
  gridHeight: number,
): 'horizontal' | 'slanted' | 'vertical' | 'far' {
  // Far/sky: high depth values (far from camera)
  if (meanDepth > 0.85) return 'far';

  // Vertical: large gradient, mid-depth range (walls)
  // Slanted: moderate gradient (roof planes)
  // Horizontal: small gradient, low depth (ground)

  const verticalThreshold = 0.15;
  const slantedThreshold = 0.04;

  if (gradientMag > verticalThreshold) return 'vertical';
  if (gradientMag > slantedThreshold) return 'slanted';
  return 'horizontal';
}

/**
 * Compute statistics for a plane region.
 */
function computeRegionStats(
  grid: Float32Array,
  pixelIndices: number[],
): { mean: number; stdDev: number; gradientMag: number } {
  let sum = 0;
  for (const idx of pixelIndices) sum += grid[idx];
  const mean = sum / pixelIndices.length;

  let variance = 0;
  for (const idx of pixelIndices) {
    const diff = grid[idx] - mean;
    variance += diff * diff;
  }
  const stdDev = Math.sqrt(variance / pixelIndices.length);

  // Approximate gradient magnitude as the standard deviation of spatial gradients
  // (since we don't store the gradient per-pixel, we use depth variation as proxy)
  const gradientMag = stdDev * Math.sqrt(pixelIndices.length); // scale with region size

  return { mean, stdDev, gradientMag: stdDev }; // use stdDev as gradient proxy
}

/**
 * Compute bounding box from pixel indices.
 */
function computeBounds(
  pixelIndices: number[],
  width: number,
  height: number,
): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = width, yMin = height, xMax = 0, yMax = 0;

  for (const idx of pixelIndices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  // Normalize to [0, 1]
  return {
    xMin: xMin / width,
    yMin: yMin / height,
    xMax: xMax / width,
    yMax: yMax / height,
  };
}

/**
 * Create a simplified boundary polygon from pixel indices.
 * Uses the outermost pixels in each row to create a rough boundary.
 */
function createBoundaryPolygon(
  pixelIndices: number[],
  width: number,
  height: number,
): NormalizedPoint[] {
  // Group pixels by row, find leftmost and rightmost
  const rowBounds = new Map<number, { left: number; right: number }>();

  for (const idx of pixelIndices) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const existing = rowBounds.get(y);
    if (!existing) {
      rowBounds.set(y, { left: x, right: x });
    } else {
      if (x < existing.left) existing.left = x;
      if (x > existing.right) existing.right = x;
    }
  }

  const points: NormalizedPoint[] = [];

  // Top boundary (left to right)
  const sortedRows = Array.from(rowBounds.keys()).sort((a, b) => a - b);

  // Left edge (top to bottom)
  for (const y of sortedRows) {
    const bounds = rowBounds.get(y)!;
    points.push({
      x: (bounds.left / width) * 1000,
      y: (y / height) * 1000,
      coordinateSystem: 'normalized_image_0_1000',
    });
  }

  // Right edge (bottom to top)
  for (const y of sortedRows.reverse()) {
    const bounds = rowBounds.get(y)!;
    points.push({
      x: (bounds.right / width) * 1000,
      y: (y / height) * 1000,
      coordinateSystem: 'normalized_image_0_1000',
    });
  }

  return points;
}

/**
 * Score a plane candidate's confidence.
 */
function scorePlaneConfidence(
  plane: DepthPlaneCandidate,
  usedMidas: boolean,
  qualityReport: DepthQualityReport,
): number {
  let score = 0;

  // Base: depth quality matters
  score += qualityReport.score * 0.3; // 0-30

  // Area: larger regions are more confident
  if (plane.areaFraction > 0.15) score += 25;
  else if (plane.areaFraction > 0.08) score += 20;
  else if (plane.areaFraction > 0.04) score += 15;
  else if (plane.areaFraction > 0.02) score += 10;
  else score += 5;

  // Depth consistency: low stdDev = more planar
  if (plane.depthStdDev < 0.03) score += 25;
  else if (plane.depthStdDev < 0.06) score += 20;
  else if (plane.depthStdDev < 0.10) score += 15;
  else if (plane.depthStdDev < 0.15) score += 10;
  else score += 5;

  // MiDaS bonus
  if (usedMidas) score += 10;
  else score += 5;

  // Orientation: slanted (roof) and horizontal (ground) are more confident
  if (plane.orientation === 'slanted' || plane.orientation === 'horizontal') score += 10;
  else if (plane.orientation === 'vertical') score += 5;
  // 'far' (sky) gets 0 bonus

  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Extract candidate roof planes from a DepthMap artifact using depth gradient
 * analysis and flood-fill segmentation.
 *
 * This is a depth-aware alternative to the current heuristic-based plane
 * extraction. It uses:
 * 1. Depth discontinuity detection (gradient edges)
 * 2. Flood-fill segmentation (group similar-depth pixels)
 * 3. Orientation classification (slanted = roof, horizontal = ground, etc.)
 * 4. Confidence scoring (depth quality + area + consistency)
 *
 * @param depthMap - The DepthMap artifact to analyze
 * @param usedMidas - Whether MiDaS was used (from DepthWorkerOutput)
 * @param options - Extraction options
 * @returns Plane extraction result with candidates and metadata
 */
export function extractDepthPlanes(
  depthMap: DepthMap,
  usedMidas: boolean,
  options: DepthPlaneOptions = {},
): DepthPlaneExtractionResult {
  const {
    depthThreshold = 0.12,
    minAreaFraction = 0.02,
    maxPlanes = 10,
    mergeSimilar = 0.08,
  } = options;

  const grid = decodeDepthMap(depthMap);
  const width = depthMap.width;
  const height = depthMap.height;
  const totalPixels = width * height;

  // Step 1: Quality check
  const qualityReport = generateDepthQualityReport(depthMap, usedMidas, depthMap.confidence * 100);
  const stats = computeDepthStats(grid);

  // Step 2: Compute depth gradient
  const { dx, dy } = computeDepthGradient(grid, width, height);

  // Step 3: Detect edges (depth discontinuities)
  const edgeThreshold = 0.08;
  const edges = detectEdges(dx, dy, edgeThreshold);
  const edgeCount = edges.filter(e => e).length;

  // Step 4: Flood-fill segmentation
  const { labels, numRegions } = floodFillSegment(grid, width, height, depthThreshold, edges);

  // Step 5: Collect regions and compute statistics
  const regions = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label === -1) continue;
    if (!regions.has(label)) regions.set(label, []);
    regions.get(label)!.push(i);
  }

  // Step 6: Filter by minimum area and create plane candidates
  const candidates: DepthPlaneCandidate[] = [];
  let planeId = 0;

  for (const [label, pixels] of regions) {
    const areaFraction = pixels.length / totalPixels;
    if (areaFraction < minAreaFraction) continue;

    const regionStats = computeRegionStats(grid, pixels);
    const bounds = computeBounds(pixels, width, height);
    const orientation = classifyOrientation(
      regionStats.mean,
      regionStats.gradientMag,
      bounds.yMin * height,
      bounds.yMax * height,
      height,
    );

    // Assign label based on orientation
    const labelPrefix = orientation === 'far' ? 'sky' :
      orientation === 'slanted' ? 'roof_plane' :
      orientation === 'vertical' ? 'wall' :
      'ground';

    const candidate: DepthPlaneCandidate = {
      id: `depth-plane-${planeId++}`,
      label: `${labelPrefix}_${planeId}`,
      pixelIndices: pixels,
      areaFraction,
      meanDepth: regionStats.mean,
      depthStdDev: regionStats.stdDev,
      gradientMagnitude: regionStats.gradientMag,
      orientation,
      bounds,
      boundaryPolygon: createBoundaryPolygon(pixels, width, height),
      confidence: 0, // scored below
      depthQuality: qualityReport,
    };

    candidate.confidence = scorePlaneConfidence(candidate, usedMidas, qualityReport);
    candidates.push(candidate);
  }

  // Step 7: Merge similar adjacent planes if requested
  if (mergeSimilar > 0) {
    mergeSimilarPlanes(candidates, mergeSimilar, totalPixels);
  }

  // Step 8: Sort by area (largest first) and limit to maxPlanes
  candidates.sort((a, b) => b.areaFraction - a.areaFraction);
  const planes = candidates.slice(0, maxPlanes);

  return {
    planes,
    edgeCount,
    qualityReport,
    stats,
    authority: REVIEW_ONLY_AUTHORITY,
  };
}

/**
 * Merge planes with similar mean depth that are adjacent.
 * This reduces over-segmentation from the flood-fill.
 */
function mergeSimilarPlanes(
  planes: DepthPlaneCandidate[],
  depthThreshold: number,
  totalPixels: number,
): void {
  const toRemove = new Set<number>();

  for (let i = 0; i < planes.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = i + 1; j < planes.length; j++) {
      if (toRemove.has(j)) continue;

      // Check if similar depth and same orientation
      if (
        Math.abs(planes[i].meanDepth - planes[j].meanDepth) < depthThreshold &&
        planes[i].orientation === planes[j].orientation
      ) {
        // Merge j into i
        planes[i].pixelIndices.push(...planes[j].pixelIndices);
        planes[i].areaFraction = planes[i].pixelIndices.length / totalPixels;
        // Update mean depth (weighted)
        const wi = planes[i].pixelIndices.length - planes[j].pixelIndices.length;
        const wj = planes[j].pixelIndices.length;
        planes[i].meanDepth = (planes[i].meanDepth * wi + planes[j].meanDepth * wj) / (wi + wj);
        planes[i].depthStdDev = Math.max(planes[i].depthStdDev, planes[j].depthStdDev);
        toRemove.add(j);
      }
    }
  }

  // Remove merged planes (in reverse order to maintain indices)
  for (const idx of Array.from(toRemove).sort((a, b) => b - a)) {
    planes.splice(idx, 1);
  }
}
