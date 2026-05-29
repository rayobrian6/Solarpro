// ============================================================================
// lib/siteSurveys/geometryReconstruction/runFullPipeline.ts
//
// Full Pipeline B orchestration: chains all workers in sequence.
//
// Pipeline stages:
//   1. Segmentation     → SemanticSegmentationMask[]
//   2. Line Extraction   → StructuralLineCandidate[]
//   3. Vanishing Points  → VanishingPointArtifact[]
//   4. Depth Estimation  → DepthMap[]
//   5. Plane Extraction  → RoofPlaneCandidate[], WallPlaneCandidate[]
//   6. Multi-View Fusion → ConsensusPlaneCandidate[]
//
// Each stage feeds its outputs into subsequent stages. All artifacts are
// collected and returned as a flat array of GeometryReconstructionArtifact[].
//
// REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
// ============================================================================

import type {
  GeometryReconstructionInput,
  GeometryReconstructionArtifact,
  SemanticSegmentationMask,
  StructuralLineCandidate,
  VanishingPointArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  DepthMap,
} from './types';

import { runSegmentationFromReconstructionInput } from './workers/segmentation/runSegmentationWorker';
import { runLineExtractionFromReconstructionInput } from './workers/lineExtraction/runLineExtractionWorker';
import { estimateVanishingPointsFromReconstructionInput } from './workers/perspective/estimateVanishingPoints';
import { runDepthFromReconstructionInput } from './workers/depth/runDepthWorker';
import { runPlaneExtractionFromReconstructionInput } from './workers/planeExtraction/runPlaneExtractionWorker';
import { runMultiViewFusionFromReconstructionInput } from './workers/multiViewFusion/runMultiViewFusion';

// ─── Pipeline Stage Result ──────────────────────────────────────────────

export interface PipelineStageResult {
  stage: string;
  artifactCount: number;
  durationMs: number;
}

export interface FullPipelineResult {
  artifacts: GeometryReconstructionArtifact[];
  stages: PipelineStageResult[];
  totalDurationMs: number;
}

// ─── Stage Runner Helper ────────────────────────────────────────────────

function stageTimer<T>(stageName: string, fn: () => T): { result: T; durationMs: number } {
  const start = Date.now();
  const result = fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}

async function asyncStageTimer<T>(stageName: string, fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}

// ─── Full Pipeline Orchestration ────────────────────────────────────────

/**
 * Run the full Pipeline B (Geometry Reconstruction) orchestration.
 *
 * Chains all six stages in order, passing outputs from each stage into
 * subsequent stages as needed. Returns ALL artifacts from ALL stages
 * as a flat array, plus per-stage timing information.
 *
 * This is the function that should be called when `pipeline === 'full'`
 * (or any non-mock pipeline) is requested via the start route.
 */
export async function runFullGeometryReconstructionPipeline(
  input: GeometryReconstructionInput,
): Promise<FullPipelineResult> {
  const pipelineStart = Date.now();
  const stages: PipelineStageResult[] = [];
  const allArtifacts: GeometryReconstructionArtifact[] = [];

  console.info(
    `[Pipeline B] Starting full pipeline for survey=${input.surveyId} photos=${input.sourcePhotos.length} pipeline=${input.pipeline}`,
  );

  // ── Stage 1: Segmentation ───────────────────────────────────────────
  const segResult = await asyncStageTimer('segmentation', () =>
    runSegmentationFromReconstructionInput(input),
  );
  const segmentationArtifacts = segResult.result;
  allArtifacts.push(...segmentationArtifacts);
  stages.push({ stage: 'segmentation', artifactCount: segmentationArtifacts.length, durationMs: segResult.durationMs });
  console.info(
    `[Pipeline B] Stage 1 (segmentation): ${segmentationArtifacts.length} artifacts in ${segResult.durationMs}ms`,
  );

  // Extract typed masks for subsequent stages
  const masks = segmentationArtifacts.filter(
    (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );

  // ── Stage 2: Line Extraction ────────────────────────────────────────
  const lineResult = stageTimer('line_extraction', () =>
    runLineExtractionFromReconstructionInput(input, masks),
  );
  const lineArtifacts = lineResult.result;
  allArtifacts.push(...lineArtifacts);
  stages.push({ stage: 'line_extraction', artifactCount: lineArtifacts.length, durationMs: lineResult.durationMs });
  console.info(
    `[Pipeline B] Stage 2 (line_extraction): ${lineArtifacts.length} artifacts in ${lineResult.durationMs}ms`,
  );

  // Extract typed structural lines for subsequent stages
  const lines = lineArtifacts.filter(
    (a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate',
  );

  // ── Stage 3: Vanishing Points ───────────────────────────────────────
  const vpResult = stageTimer('vanishing_points', () =>
    estimateVanishingPointsFromReconstructionInput(input, lines),
  );
  const vpArtifacts = vpResult.result;
  allArtifacts.push(...vpArtifacts);
  stages.push({ stage: 'vanishing_points', artifactCount: vpArtifacts.length, durationMs: vpResult.durationMs });
  console.info(
    `[Pipeline B] Stage 3 (vanishing_points): ${vpArtifacts.length} artifacts in ${vpResult.durationMs}ms`,
  );

  // Extract typed vanishing points for subsequent stages
  const vanishingPoints = vpArtifacts.filter(
    (a): a is VanishingPointArtifact => a.artifactType === 'vanishing_point',
  );

  // ── Stage 4: Depth Estimation ───────────────────────────────────────
  const depthResult = stageTimer('depth_estimation', () =>
    runDepthFromReconstructionInput(input, masks, vanishingPoints),
  );
  const depthArtifacts = depthResult.result;
  allArtifacts.push(...depthArtifacts);
  stages.push({ stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: depthResult.durationMs });
  console.info(
    `[Pipeline B] Stage 4 (depth_estimation): ${depthArtifacts.length} artifacts in ${depthResult.durationMs}ms`,
  );

  // ── Stage 5: Plane Extraction ───────────────────────────────────────
  const planeResult = stageTimer('plane_extraction', () =>
    runPlaneExtractionFromReconstructionInput(input, masks, lines, vanishingPoints),
  );
  const planeArtifacts = planeResult.result;
  allArtifacts.push(...planeArtifacts);
  stages.push({ stage: 'plane_extraction', artifactCount: planeArtifacts.length, durationMs: planeResult.durationMs });
  console.info(
    `[Pipeline B] Stage 5 (plane_extraction): ${planeArtifacts.length} artifacts in ${planeResult.durationMs}ms`,
  );

  // ── Stage 6: Multi-View Fusion ──────────────────────────────────────
  const fusionResult = stageTimer('multi_view_fusion', () =>
    runMultiViewFusionFromReconstructionInput(input, allArtifacts),
  );
  const fusionArtifacts = fusionResult.result.artifacts;
  allArtifacts.push(...fusionArtifacts);
  stages.push({ stage: 'multi_view_fusion', artifactCount: fusionArtifacts.length, durationMs: fusionResult.durationMs });
  console.info(
    `[Pipeline B] Stage 6 (multi_view_fusion): ${fusionArtifacts.length} artifacts in ${fusionResult.durationMs}ms`,
  );

  const totalDurationMs = Date.now() - pipelineStart;
  console.info(
    `[Pipeline B] Completed for survey=${input.surveyId}: ${allArtifacts.length} total artifacts in ${totalDurationMs}ms`,
  );

  return {
    artifacts: allArtifacts,
    stages,
    totalDurationMs,
  };
}

// ─── Partial Pipeline Runners ───────────────────────────────────────────

/**
 * Run only the segmentation stage of Pipeline B.
 */
export async function runSegmentationOnlyPipeline(
  input: GeometryReconstructionInput,
): Promise<FullPipelineResult> {
  const start = Date.now();
  const artifacts = await runSegmentationFromReconstructionInput(input);
  return {
    artifacts,
    stages: [{ stage: 'segmentation', artifactCount: artifacts.length, durationMs: Date.now() - start }],
    totalDurationMs: Date.now() - start,
  };
}

/**
 * Run only the depth estimation stage of Pipeline B.
 * Requires pre-existing segmentation masks.
 */
export async function runDepthOnlyPipeline(
  input: GeometryReconstructionInput,
): Promise<FullPipelineResult> {
  const start = Date.now();

  // Run segmentation first to get masks
  const segArtifacts = await runSegmentationFromReconstructionInput(input);
  const masks = segArtifacts.filter(
    (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );

  // Run vanishing points (needed for depth)
  const lineArtifacts = runLineExtractionFromReconstructionInput(input, masks);
  const lines = lineArtifacts.filter(
    (a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate',
  );
  const vpArtifacts = estimateVanishingPointsFromReconstructionInput(input, lines);
  const vanishingPoints = vpArtifacts.filter(
    (a): a is VanishingPointArtifact => a.artifactType === 'vanishing_point',
  );

  const depthArtifacts = runDepthFromReconstructionInput(input, masks, vanishingPoints);
  const allArtifacts = [...segArtifacts, ...lineArtifacts, ...vpArtifacts, ...depthArtifacts];

  return {
    artifacts: allArtifacts,
    stages: [
      { stage: 'segmentation', artifactCount: segArtifacts.length, durationMs: 0 },
      { stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: Date.now() - start },
    ],
    totalDurationMs: Date.now() - start,
  };
}
