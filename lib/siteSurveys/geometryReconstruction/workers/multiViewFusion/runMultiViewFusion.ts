/**
 * Multi-photo fusion worker — produces ConsensusPlaneCandidate artifacts
 * by merging per-photo RoofPlaneCandidate and WallPlaneCandidate across
 * multiple source photos.
 *
 * Approach:
 * 1. Group plane candidates by type (roof vs wall)
 * 2. Compute pairwise similarity between planes from different photos
 *    using normal vector angle + polygon overlap (IoU proxy)
 * 3. Cluster similar planes using a greedy merging strategy
 * 4. For each cluster, produce a ConsensusPlaneCandidate with:
 *    - merged polygon (union via convex hull)
 *    - averaged normal vector
 *    - consensus count = number of photos that agreed
 *    - confidence proportional to consensus count and similarity
 *
 * When a real SfM / MVS pipeline is available, this worker will be
 * upgraded. The current heuristic approach ensures the pipeline never
 * breaks when models are unavailable.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  ConsensusPlaneCandidate,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  SemanticSegmentationMask,
  StructuralLineCandidate,
  VanishingPointArtifact,
  NormalizedPoint,
  GeometryReconstructionInput,
  GeometryReconstructionArtifact,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';
import { validateConsensusPlaneCandidate } from '../../schemas';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const MULTI_VIEW_FUSION_WORKER_VERSION = '1.0.0-multi-view-fusion-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const MULTI_VIEW_FUSION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Multi-view fusion is heuristic — not from SfM/MVS or learned feature matching.',
  'When a real multi-view stereo pipeline is available, this worker will be upgraded.',
  'Plane matching uses normal similarity + polygon IoU proxy, not geometric verification.',
  'Consensus confidence is heuristic and may over/under-estimate agreement.',
  'Cross-photo plane merging assumes roughly similar viewpoints (not extreme viewpoint changes).',
] as const;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MultiViewFusionConfig {
  /** Minimum cosine similarity between normals to consider planes matching. Default: 0.85 */
  normalSimilarityThreshold: number;
  /** Minimum IoU proxy (polygon overlap) to consider planes matching. Default: 0.15 */
  overlapThreshold: number;
  /** Minimum consensus photo count to produce a consensus plane. Default: 1 */
  minConsensusCount: number;
  /** Minimum confidence for output artifacts. Default: 10 */
  minConfidence: number;
}

const DEFAULT_FUSION_CONFIG: MultiViewFusionConfig = {
  normalSimilarityThreshold: 0.85,
  overlapThreshold: 0.15,
  minConsensusCount: 1,
  minConfidence: 10,
};

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface PerPhotoArtifacts {
  fileId: string;
  roofPlanes: RoofPlaneCandidate[];
  wallPlanes: WallPlaneCandidate[];
  masks: SemanticSegmentationMask[];
  lines: StructuralLineCandidate[];
  vanishingPoints: VanishingPointArtifact[];
}

export interface MultiViewFusionInput {
  perPhotoArtifacts: PerPhotoArtifacts[];
  surveyId: string;
  config?: Partial<MultiViewFusionConfig>;
}

export interface MultiViewFusionResult {
  artifacts: ConsensusPlaneCandidate[];
  stageTimings: Record<string, number>;
  workerVersion: string;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Utility: unique ID
// ---------------------------------------------------------------------------

function uniqueId(): string {
  return `consensus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Utility: vector math
// ---------------------------------------------------------------------------

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude3(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const m = magnitude3(v);
  if (m < 1e-9) return [0, 0, 1];
  return [v[0] / m, v[1] / m, v[2] / m];
}

function cosineSimilarity(a: [number, number, number], b: [number, number, number]): number {
  const na = normalize3(a);
  const nb = normalize3(b);
  return Math.abs(dot3(na, nb)); // absolute — normals may point in opposite directions
}

function averageNormals(normals: [number, number, number][]): { x: number; y: number; z: number } {
  if (normals.length === 0) return { x: 0, y: 0, z: 1 };
  const sum = normals.reduce(
    (acc, n) => [acc[0] + n[0], acc[1] + n[1], acc[2] + n[2]] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  const n = normalize3(sum);
  return { x: n[0], y: n[1], z: n[2] };
}

// ---------------------------------------------------------------------------
// Utility: polygon IoU proxy
// ---------------------------------------------------------------------------

/** Bounding box of a polygon (in normalized 0-1000 coords). */
interface BBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function polygonBBox(polygon: NormalizedPoint[]): BBox {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of polygon) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, yMin, xMax, yMax };
}

function bboxArea(b: BBox): number {
  return Math.max(0, b.xMax - b.xMin) * Math.max(0, b.yMax - b.yMin);
}

function bboxIntersection(a: BBox, b: BBox): BBox {
  return {
    xMin: Math.max(a.xMin, b.xMin),
    yMin: Math.max(a.yMin, b.yMin),
    xMax: Math.min(a.xMax, b.xMax),
    yMax: Math.min(a.yMax, b.yMax),
  };
}

/** IoU proxy using bounding-box overlap of polygons. */
function polygonIoUProxy(a: NormalizedPoint[], b: NormalizedPoint[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const bbA = polygonBBox(a);
  const bbB = polygonBBox(b);
  const areaA = bboxArea(bbA);
  const areaB = bboxArea(bbB);
  if (areaA === 0 || areaB === 0) return 0;
  const inter = bboxIntersection(bbA, bbB);
  const interArea = bboxArea(inter);
  const unionArea = areaA + areaB - interArea;
  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

// ---------------------------------------------------------------------------
// Utility: extract polygon from a plane candidate's region
// ---------------------------------------------------------------------------

/** Extract a polygon from a plane candidate's region field. Falls back to a unit square. */
function extractPolygonFromPlane(
  plane: RoofPlaneCandidate | WallPlaneCandidate,
): NormalizedPoint[] {
  if (plane.region) {
    const r = plane.region;
    // NormalizedRegion is { x, y, width, height, coordinateSystem: 'normalized_image_0_1000' }
    if ('width' in r && 'height' in r && 'x' in r && 'y' in r) {
      const rAny = r as { x: number; y: number; width: number; height: number };
      return [
        { x: rAny.x, y: rAny.y, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: rAny.x + rAny.width, y: rAny.y, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: rAny.x + rAny.width, y: rAny.y + rAny.height, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: rAny.x, y: rAny.y + rAny.height, coordinateSystem: 'normalized_image_0_1000' as const },
      ];
    }
  }
  // Fallback: unit square centered at 500,500
  return [
    { x: 400, y: 400, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 600, y: 400, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 600, y: 600, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 400, y: 600, coordinateSystem: 'normalized_image_0_1000' as const },
  ];
}

// ---------------------------------------------------------------------------
// Plane wrapper for clustering
// ---------------------------------------------------------------------------

interface PlaneWrapper {
  fileId: string;
  planeType: 'roof' | 'wall';
  normal: [number, number, number];
  polygon: NormalizedPoint[];
  confidence: number;
  slopeDegrees?: number;
  aspectDegrees?: number;
  estimatedHeightM?: number;
  facingDirection?: string;
  associatedLineIds: string[];
  sourceMaskIds: string[];
}

function wrapRoofPlane(plane: RoofPlaneCandidate, fileId: string): PlaneWrapper {
  return {
    fileId,
    planeType: 'roof',
    normal: plane.normal,
    polygon: extractPolygonFromPlane(plane),
    confidence: plane.confidence,
    slopeDegrees: plane.slopeDegrees,
    aspectDegrees: plane.aspectDegrees,
    associatedLineIds: plane.associatedLineIds,
    sourceMaskIds: [],
  };
}

function wrapWallPlane(plane: WallPlaneCandidate, fileId: string): PlaneWrapper {
  return {
    fileId,
    planeType: 'wall',
    normal: plane.normal,
    polygon: extractPolygonFromPlane(plane),
    confidence: plane.confidence,
    estimatedHeightM: plane.estimatedHeightM,
    facingDirection: plane.facingDirection,
    associatedLineIds: plane.associatedLineIds,
    sourceMaskIds: [],
  };
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

interface PlaneCluster {
  planes: PlaneWrapper[];
  planeType: 'roof' | 'wall';
}

/**
 * Greedy clustering: iterate planes, assign to first matching cluster,
 * or create a new cluster. Two planes match if they come from different
 * photos AND their normal similarity >= threshold AND their polygon
 * IoU proxy >= overlapThreshold.
 */
function clusterPlanes(
  planes: PlaneWrapper[],
  config: MultiViewFusionConfig,
): PlaneCluster[] {
  const clusters: PlaneCluster[] = [];

  for (const plane of planes) {
    let matched = false;
    for (const cluster of clusters) {
      // Check if any existing cluster member matches
      for (const member of cluster.planes) {
        // Must be from different photos
        if (member.fileId === plane.fileId) continue;
        const sim = cosineSimilarity(member.normal, plane.normal);
        const overlap = polygonIoUProxy(member.polygon, plane.polygon);
        if (sim >= config.normalSimilarityThreshold && overlap >= config.overlapThreshold) {
          cluster.planes.push(plane);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) {
      clusters.push({ planes: [plane], planeType: plane.planeType });
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Utility: convex hull of merged polygons (Graham scan)
// ---------------------------------------------------------------------------

function cross2D(o: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: NormalizedPoint[]): NormalizedPoint[] {
  if (points.length < 3) return points.slice();

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: NormalizedPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: NormalizedPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------------------
// Build ConsensusPlaneCandidate from a cluster
// ---------------------------------------------------------------------------

function buildConsensusPlane(
  cluster: PlaneCluster,
  config: MultiViewFusionConfig,
): ConsensusPlaneCandidate | null {
  const { planes } = cluster;
  if (planes.length < config.minConsensusCount) return null;

  // Collect unique source file IDs
  const sourceFileIds = [...new Set(planes.map((p) => p.fileId))];
  const consensusPhotoCount = sourceFileIds.length;

  // Merge polygons via convex hull
  const allPoints: NormalizedPoint[] = planes.flatMap((p) => p.polygon);
  const mergedPolygon = convexHull(allPoints);

  // Average normal
  const normals = planes.map((p) => p.normal);
  const avgNormal = averageNormals(normals);

  // Average confidence, boosted by consensus
  const avgConfidence = planes.reduce((s, p) => s + p.confidence, 0) / planes.length;
  const consensusBoost = Math.min(20, consensusPhotoCount * 8);
  const rawConfidence = Math.min(100, avgConfidence + consensusBoost);
  const confidence = Math.max(config.minConfidence, Math.round(rawConfidence));

  // Estimate pitch and azimuth from the cluster members
  let estimatedPitch: number | undefined;
  let estimatedAzimuth: number | undefined;

  if (cluster.planeType === 'roof') {
    const slopes = planes
      .filter((p) => p.slopeDegrees !== undefined)
      .map((p) => p.slopeDegrees!);
    const aspects = planes
      .filter((p) => p.aspectDegrees !== undefined)
      .map((p) => p.aspectDegrees!);
    if (slopes.length > 0) estimatedPitch = Math.round(slopes.reduce((a, b) => a + b, 0) / slopes.length);
    if (aspects.length > 0) estimatedAzimuth = Math.round(aspects.reduce((a, b) => a + b, 0) / aspects.length);
  } else {
    // Walls: azimuth from facing direction or normal
    const facings = planes
      .filter((p) => p.facingDirection !== undefined)
      .map((p) => p.facingDirection!);
    if (facings.length > 0) {
      // Use most common facing
      const counts = new Map<string, number>();
      for (const f of facings) counts.set(f, (counts.get(f) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const facingToAzimuth: Record<string, number> = {
        north: 0,
        northeast: 45,
        east: 90,
        southeast: 135,
        south: 180,
        southwest: 225,
        west: 270,
        northwest: 315,
      };
      estimatedAzimuth = facingToAzimuth[best.toLowerCase()] ?? undefined;
    }
  }

  const candidate: ConsensusPlaneCandidate = {
    artifactType: 'consensus_plane_candidate',
    id: uniqueId(),
    planeType: cluster.planeType,
    polygon: mergedPolygon,
    normalVector: avgNormal,
    estimatedPitch,
    estimatedAzimuth,
    confidence,
    sourceMaskIds: planes.flatMap((p) => p.sourceMaskIds),
    sourceFileIds,
    consensusPhotoCount,
    workerVersion: MULTI_VIEW_FUSION_WORKER_VERSION,
    stageTimings: {},
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MULTI_VIEW_FUSION_LIMITATIONS],
  };

  // Validate
  const validation = validateConsensusPlaneCandidate(candidate);
  if (!validation.valid) {
    // Fall back to minimum valid artifact
    return {
      artifactType: 'consensus_plane_candidate',
      id: uniqueId(),
      planeType: cluster.planeType,
      polygon: mergedPolygon.length >= 3 ? mergedPolygon : [
        { x: 400, y: 400, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: 600, y: 400, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: 600, y: 600, coordinateSystem: 'normalized_image_0_1000' as const },
        { x: 400, y: 600, coordinateSystem: 'normalized_image_0_1000' as const },
      ],
      normalVector: avgNormal,
      confidence: Math.max(config.minConfidence, 10),
      sourceMaskIds: [],
      sourceFileIds,
      consensusPhotoCount,
      workerVersion: MULTI_VIEW_FUSION_WORKER_VERSION,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...MULTI_VIEW_FUSION_LIMITATIONS],
    };
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------------

export function runMultiViewFusion(input: MultiViewFusionInput): MultiViewFusionResult {
  const t0 = performance.now();
  const config: MultiViewFusionConfig = { ...DEFAULT_FUSION_CONFIG, ...input.config };

  const stageTimings: Record<string, number> = {};

  // Stage 1: Collect all plane wrappers from per-photo artifacts
  const t1 = performance.now();
  const allPlaneWrappers: PlaneWrapper[] = [];

  for (const photo of input.perPhotoArtifacts) {
    for (const rp of photo.roofPlanes) {
      allPlaneWrappers.push(wrapRoofPlane(rp, photo.fileId));
    }
    for (const wp of photo.wallPlanes) {
      allPlaneWrappers.push(wrapWallPlane(wp, photo.fileId));
    }
  }
  stageTimings.collectPlanes = performance.now() - t1;

  // Stage 2: Cluster planes across photos
  const t2 = performance.now();
  const clusters = clusterPlanes(allPlaneWrappers, config);
  stageTimings.clusterPlanes = performance.now() - t2;

  // Stage 3: Build consensus candidates from clusters
  const t3 = performance.now();
  const consensusCandidates: ConsensusPlaneCandidate[] = [];
  for (const cluster of clusters) {
    const candidate = buildConsensusPlane(cluster, config);
    if (candidate) consensusCandidates.push(candidate);
  }
  stageTimings.buildConsensus = performance.now() - t3;

  // Stage 4: Filter by confidence
  const t4 = performance.now();
  const filtered = consensusCandidates.filter((c) => c.confidence >= config.minConfidence);
  stageTimings.filterByConfidence = performance.now() - t4;

  stageTimings.total = performance.now() - t0;

  return {
    artifacts: filtered,
    stageTimings,
    workerVersion: MULTI_VIEW_FUSION_WORKER_VERSION,
    limitations: [...MULTI_VIEW_FUSION_LIMITATIONS],
  };
}

// ---------------------------------------------------------------------------
// Convenience wrapper: run from GeometryReconstructionInput
// ---------------------------------------------------------------------------

export function runMultiViewFusionFromReconstructionInput(
  reconInput: GeometryReconstructionInput,
  existingArtifacts: GeometryReconstructionArtifact[],
): MultiViewFusionResult {
  // Group existing artifacts by fileId
  const byFileId = new Map<string, GeometryReconstructionArtifact[]>();
  for (const art of existingArtifacts) {
    const fid = 'fileId' in art ? (art as { fileId: string }).fileId : undefined;
    if (fid) {
      if (!byFileId.has(fid)) byFileId.set(fid, []);
      byFileId.get(fid)!.push(art);
    }
  }

  // Build PerPhotoArtifacts for each source photo
  const perPhotoArtifacts: PerPhotoArtifacts[] = reconInput.sourcePhotos.map((sp) => {
    const arts = byFileId.get(sp.fileId) ?? [];
    return {
      fileId: sp.fileId,
      roofPlanes: arts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      ),
      wallPlanes: arts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      ),
      masks: arts.filter(
        (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask',
      ),
      lines: arts.filter(
        (a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate',
      ),
      vanishingPoints: arts.filter(
        (a): a is VanishingPointArtifact => a.artifactType === 'vanishing_point',
      ),
    };
  });

  const fusionConfig: Partial<MultiViewFusionConfig> =
    typeof reconInput.config === 'object' && reconInput.config !== null
      ? (reconInput.config as Record<string, unknown>).fusionConfig as Partial<MultiViewFusionConfig> ?? {}
      : {};

  return runMultiViewFusion({
    perPhotoArtifacts,
    surveyId: reconInput.surveyId,
    config: fusionConfig,
  });
}
