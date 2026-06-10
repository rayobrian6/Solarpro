/**
 * Photogrammetry worker — produces MeshArtifact and SfMPointCloud artifacts
 * from depth maps, segmentation masks, and plane candidates.
 *
 * Pipeline Stage 7: Photogrammetry
 *   Input: DepthMap[], SemanticSegmentationMask[], RoofPlaneCandidate[], WallPlaneCandidate[]
 *   Output: MeshArtifact, SfMPointCloud
 *
 * Pipeline:
 *   1. Unproject each depth map into a 3D point cloud (depthUnprojection.ts)
 *   2. Fuse multiple views using scale-shift alignment (depthFusion.ts)
 *   3. Create plane-based mesh from fused cloud (meshFromDepth.ts)
 *   4. Emit MeshArtifact and SfMPointCloud artifacts
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  GeometryReconstructionInput,
  GeometryReconstructionArtifact,
  DepthMap,
  SemanticSegmentationMask,
  RoofPlaneCandidate,
  WallPlaneCandidate,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';

import { unprojectDepthMap, defaultPhoneIntrinsics } from './depthUnprojection';
import type { Point3D } from './depthUnprojection';

import { fuseDepthMaps } from './depthFusion';
import type { DepthFusionOptions } from './depthFusion';

import { meshFromDepth } from './meshFromDepth';
import type { MeshFromDepthOptions } from './meshFromDepth';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const PHOTOGRAMMETRY_WORKER_VERSION = '1.0.0-photogrammetry-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const PHOTOGRAMMETRY_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Photogrammetry uses monocular relative depth (MiDaS) — NOT metric geometry.',
  'Point cloud is unprojected from 2D depth — not from SfM/MVS feature matching.',
  'Scale-shift alignment is approximate — relies on plane correspondences, not camera poses.',
  'Mesh is plane-based (RANSAC + convex-hull triangulation) — may miss concavities.',
  'All measurements are in relative depth units, not meters.',
  'When SfM becomes available, this module will be upgraded to proper multi-view reconstruction.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the photogrammetry worker. */
export interface PhotogrammetryWorkerInput {
  /** Survey ID. */
  surveyId: string;
  /** Depth map artifacts (one per photo). */
  depthMaps: DepthMap[];
  /** Per-photo segmentation masks (keyed by fileId). */
  masks: Map<string, SemanticSegmentationMask[]>;
  /** Per-photo roof plane candidates (keyed by fileId). */
  roofPlanes: Map<string, RoofPlaneCandidate[]>;
  /** Per-photo wall plane candidates (keyed by fileId). */
  wallPlanes: Map<string, WallPlaneCandidate[]>;
  /** Source photo file IDs. */
  sourceFileIds: string[];
}

/** Output of the photogrammetry worker. */
export interface PhotogrammetryWorkerOutput {
  /** Produced artifacts. */
  artifacts: GeometryReconstructionArtifact[];
  /** Number of depth maps processed. */
  depthMapCount: number;
  /** Number of points in the fused cloud. */
  fusedPointCount: number;
  /** Number of mesh vertices. */
  meshVertexCount: number;
  /** Number of mesh triangles. */
  meshTriangleCount: number;
  /** Number of fitted planes. */
  fittedPlaneCount: number;
  /** Worker version. */
  workerVersion: string;
  /** Duration in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helper: encode Float32Array to base64
// ---------------------------------------------------------------------------

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function uint32ToBase64(arr: Uint32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the photogrammetry pipeline: depth unprojection → fusion → meshing.
 *
 * @param input - Worker input with depth maps, masks, and planes
 * @returns Worker output with MeshArtifact and SfMPointCloud
 */
export function runPhotogrammetryWorker(
  input: PhotogrammetryWorkerInput,
): PhotogrammetryWorkerOutput {
  const start = Date.now();

  console.info(
    `[Photogrammetry] Starting for survey=${input.surveyId} depthMaps=${input.depthMaps.length} sourceFiles=${input.sourceFileIds.length}`,
  );

  const artifacts: GeometryReconstructionArtifact[] = [];

  // Skip if no depth maps
  if (input.depthMaps.length === 0) {
    console.info('[Photogrammetry] No depth maps — skipping photogrammetry stage.');
    return {
      artifacts: [],
      depthMapCount: 0,
      fusedPointCount: 0,
      meshVertexCount: 0,
      meshTriangleCount: 0,
      fittedPlaneCount: 0,
      workerVersion: PHOTOGRAMMETRY_WORKER_VERSION,
      durationMs: Date.now() - start,
    };
  }

  // Step 1 & 2: Fuse depth maps
  const fusionOptions: DepthFusionOptions = {
    voxelSize: 0.01,
    removeOutliers: true,
    downsampleFactor: 2,
  };

  const fusionResult = fuseDepthMaps(
    input.depthMaps,
    input.masks,
    input.roofPlanes,
    input.wallPlanes,
    fusionOptions,
  );

  console.info(
    `[Photogrammetry] Depth fusion: ${fusionResult.mergedPoints.length} points from ${fusionResult.viewCount} views`,
  );

  // Step 3: Create mesh from fused point cloud
  const meshOptions: MeshFromDepthOptions = {
    ransacDistanceThreshold: 0.02,
    ransacMaxIterations: 200,
    ransacMinInliers: 8,
    maxPlanesPerClass: 5,
    maxEdgeLength: 0.1,
    minTriangleAngle: 5,
    projectOntoPlane: true,
    meshClasses: [1, 2, 5], // roof, wall, ground
  };

  const meshResult = meshFromDepth(fusionResult.mergedPoints, meshOptions);

  console.info(
    `[Photogrammetry] Meshing: ${meshResult.vertexCount} vertices, ${meshResult.triangleCount} triangles, ${meshResult.fittedPlanes.length} planes`,
  );

  // Step 4a: Emit SfMPointCloud artifact
  const pointCount = fusionResult.mergedPoints.length;
  if (pointCount > 0) {
    const pointsFlat = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i++) {
      const p = fusionResult.mergedPoints[i];
      pointsFlat[i * 3] = p.x;
      pointsFlat[i * 3 + 1] = p.y;
      pointsFlat[i * 3 + 2] = p.z;
    }

    const sfmArtifact: GeometryReconstructionArtifact = {
      artifactType: 'sfm_point_cloud',
      pointCount,
      pointsData: float32ToBase64(pointsFlat),
      sourcePhotoCount: fusionResult.viewCount,
      sourceFileIds: input.sourceFileIds,
      confidence: Math.min(100, Math.round(
        30 + // base confidence
        Math.min(40, fusionResult.viewCount * 10) + // more views = higher confidence
        Math.min(30, pointCount / 100) // more points = higher confidence
      )),
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...PHOTOGRAMMETRY_LIMITATIONS],
    };
    artifacts.push(sfmArtifact);
  }

  // Step 4b: Emit MeshArtifact
  if (meshResult.vertexCount > 0 && meshResult.triangleCount > 0) {
    const verticesFlat = new Float32Array(meshResult.allVertices.length * 3);
    for (let i = 0; i < meshResult.allVertices.length; i++) {
      const v = meshResult.allVertices[i];
      verticesFlat[i * 3] = v.x;
      verticesFlat[i * 3 + 1] = v.y;
      verticesFlat[i * 3 + 2] = v.z;
    }

    const trianglesFlat = new Uint32Array(meshResult.allTriangles.length * 3);
    for (let i = 0; i < meshResult.allTriangles.length; i++) {
      const t = meshResult.allTriangles[i];
      trianglesFlat[i * 3] = t.v0;
      trianglesFlat[i * 3 + 1] = t.v1;
      trianglesFlat[i * 3 + 2] = t.v2;
    }

    const meshArtifact: GeometryReconstructionArtifact = {
      artifactType: 'mesh',
      id: `mesh_${input.surveyId}_${Date.now()}`,
      verticesData: float32ToBase64(verticesFlat),
      trianglesData: uint32ToBase64(trianglesFlat),
      vertexCount: meshResult.vertexCount,
      triangleCount: meshResult.triangleCount,
      estimatedArea: meshResult.totalArea,
      planeCount: meshResult.fittedPlanes.length,
      sourceFileIds: input.sourceFileIds,
      confidence: Math.min(100, Math.round(
        20 + // base confidence
        Math.min(40, meshResult.fittedPlanes.length * 10) + // more planes = more structure
        Math.min(30, meshResult.vertexCount / 50) + // more vertices = better coverage
        Math.min(10, fusionResult.viewCount * 5) // multi-view bonus
      )),
      workerVersion: PHOTOGRAMMETRY_WORKER_VERSION,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...PHOTOGRAMMETRY_LIMITATIONS],
    };
    artifacts.push(meshArtifact);
  }

  const durationMs = Date.now() - start;
  console.info(
    `[Photogrammetry] Completed: ${artifacts.length} artifacts in ${durationMs}ms`,
  );

  return {
    artifacts,
    depthMapCount: input.depthMaps.length,
    fusedPointCount: fusionResult.mergedPoints.length,
    meshVertexCount: meshResult.vertexCount,
    meshTriangleCount: meshResult.triangleCount,
    fittedPlaneCount: meshResult.fittedPlanes.length,
    workerVersion: PHOTOGRAMMETRY_WORKER_VERSION,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from pipeline input + existing artifacts
// ---------------------------------------------------------------------------

/**
 * Run the photogrammetry worker from the standard pipeline input
 * and previously produced artifacts.
 *
 * This is the function called by runFullPipeline.ts.
 */
export function runPhotogrammetryFromReconstructionInput(
  input: GeometryReconstructionInput,
  allArtifacts: GeometryReconstructionArtifact[],
): PhotogrammetryWorkerOutput {
  // Extract depth maps
  const depthMaps = allArtifacts.filter(
    (a): a is DepthMap => a.artifactType === 'depth_map',
  );

  // Extract segmentation masks keyed by fileId
  const masks = new Map<string, SemanticSegmentationMask[]>();
  const segMasks = allArtifacts.filter(
    (a): a is SemanticSegmentationMask =>
      a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );
  for (const mask of segMasks) {
    const fileId = mask.fileId;
    if (!masks.has(fileId)) masks.set(fileId, []);
    masks.get(fileId)!.push(mask);
  }

  // Extract roof and wall plane candidates keyed by fileId
  const roofPlanes = new Map<string, RoofPlaneCandidate[]>();
  const wallPlanes = new Map<string, WallPlaneCandidate[]>();

  const roofArtifacts = allArtifacts.filter(
    (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
  );
  for (const rp of roofArtifacts) {
    const fileId = rp.fileId ?? '';
    if (!roofPlanes.has(fileId)) roofPlanes.set(fileId, []);
    roofPlanes.get(fileId)!.push(rp);
  }

  const wallArtifacts = allArtifacts.filter(
    (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
  );
  for (const wp of wallArtifacts) {
    const fileId = wp.fileId ?? '';
    if (!wallPlanes.has(fileId)) wallPlanes.set(fileId, []);
    wallPlanes.get(fileId)!.push(wp);
  }

  // Get source file IDs
  const sourceFileIds = input.sourcePhotos.map(p => p.fileId);

  return runPhotogrammetryWorker({
    surveyId: input.surveyId,
    depthMaps,
    masks,
    roofPlanes,
    wallPlanes,
    sourceFileIds,
  });
}
