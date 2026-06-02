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
//   7. Photogrammetry    → MeshArtifact, SfMPointCloud
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

import {
  runSegmentationFromReconstructionInput,
  runSegmentationFullOutput,
  SEGMENTATION_WORKER_VERSION,
  type SegmentationWorkerOutput,
  type PhotoSegmentationResult,
} from './workers/segmentation/runSegmentationWorker';
import { runLineExtractionFromReconstructionInput } from './workers/lineExtraction/runLineExtractionWorker';
import { estimateVanishingPointsFromReconstructionInput } from './workers/perspective/estimateVanishingPoints';
import { runDepthFromReconstructionInput } from './workers/depth/runDepthWorker';
import { runPlaneExtractionFromReconstructionInput } from './workers/planeExtraction/runPlaneExtractionWorker';
import { runMultiViewFusionFromReconstructionInput } from './workers/multiViewFusion/runMultiViewFusion';
import { runPhotogrammetryFromReconstructionInput } from './workers/photogrammetry/runPhotogrammetryWorker';

// ──── Pipeline timeout safeguard ────────────────────────────────────────────

/**
 * Maximum pipeline duration in milliseconds before skipping remaining stages.
 * Set to 270000ms (4.5 minutes) — this is a soft limit that skips remaining
 * pipeline stages if exceeded. The hard limit is Vercel's maxDuration=300s.
 *
 * With points_per_side=12 on Render Pro, SAM2 inference takes ~19s per photo.
 * 10 photos ÷ 2 concurrency = 5 batches × ~50s ≈ 250s for segmentation.
 * Plus warm-up, depth estimation, downstream stages, and DB writes ≈ ~50s.
 * Total ≈ 300s, which matches Vercel's maxDuration=300s hard limit exactly.
 *
 * The PIPELINE_TIMEOUT_MS is set below the Vercel hard limit so we can
 * gracefully skip remaining stages rather than getting killed mid-write.
 * Updated from 480s (overkill) to 270s — provides buffer for downstream
 * stages while ensuring we return results before Vercel kills the function.
 */
const PIPELINE_TIMEOUT_MS = 270_000;

/**
 * Full Pipeline B must produce geometry, not just segmentation masks. The
 * segmentation worker's default budget is intentionally generous for
 * segmentation-only runs, but using that same 260s budget in a 270s full run
 * can starve line/depth/plane/fusion stages. These limits reserve roughly two
 * minutes for downstream geometry and DB writes under Vercel's 300s hard cap.
 */
const FULL_PIPELINE_SEGMENTATION_STAGE_TIMEOUT_MS = 150_000;
const FULL_PIPELINE_MAX_SAM2_PHOTOS = 8;
const FULL_PIPELINE_MIN_REMAINING_MS_FOR_SAM2_ATTEMPT = 35_000;
const FULL_PIPELINE_MIN_CONSENSUS_PHOTOS = 2;

function fullPipelineConfig(input: GeometryReconstructionInput): Record<string, unknown> {
  const inputConfig = input.config ?? {};
  const inputFusionConfig = (inputConfig.fusionConfig as Record<string, unknown> | undefined) ?? {};
  const requestedConsensusCount = Number(inputFusionConfig.minConsensusCount);
  const minConsensusCount = Number.isFinite(requestedConsensusCount)
    ? Math.max(FULL_PIPELINE_MIN_CONSENSUS_PHOTOS, Math.floor(requestedConsensusCount))
    : FULL_PIPELINE_MIN_CONSENSUS_PHOTOS;

  return {
    ...inputConfig,
    // Full Pipeline B should not turn a weak mask into a drawable plane unless
    // there is structural line support. Standalone worker tests/tools can still
    // opt out explicitly, but production full runs must be conservative.
    requireSupportingLines: true,
    fusionConfig: {
      ...inputFusionConfig,
      minConsensusCount,
    },
  };
}

function withFullPipelineGeometryConfig(
  input: GeometryReconstructionInput,
): GeometryReconstructionInput {
  return {
    ...input,
    config: fullPipelineConfig(input),
  };
}

// ──── Pipeline Stage Result ─────────────────────────────────────────────────

export interface PipelineStageResult {
  stage: string;
  artifactCount: number;
  durationMs: number;
}

export interface FullPipelineResult {
  artifacts: GeometryReconstructionArtifact[];
  stages: PipelineStageResult[];
  totalDurationMs: number;
  /** Which segmentation backend was used: 'sam2' or 'canny'. */
  segmentationBackend: 'sam2' | 'canny';
  /** Number of photos processed with SAM 2 successfully. */
  sam2PhotoCount: number;
  /** Number of photos where SAM 2 was attempted but failed. */
  failedPhotoCount: number;
  /** Number of photos skipped (budget exhausted, timeout, warm-up failure, etc.). */
  skippedPhotoCount: number;
  /** Number of photos processed with Canny (only when SAM2 not configured). */
  cannyPhotoCount: number;
  /** Honest per-photo results — no silent fallbacks. */
  photoResults: PhotoSegmentationResult[];
  /** Why SAM2 budget was exhausted (null if not exhausted). */
  budgetExhaustedReason: string | null;
}

/**
 * Extract the segmentation reporting fields from a SegmentationWorkerOutput
 * into the shape expected by FullPipelineResult. This avoids repeating the
 * same field-mapping on every return path.
 */
function segReportFields(seg: SegmentationWorkerOutput): Pick<FullPipelineResult,
  'segmentationBackend' | 'sam2PhotoCount' | 'failedPhotoCount' |
  'skippedPhotoCount' | 'cannyPhotoCount' | 'photoResults' | 'budgetExhaustedReason'
> {
  return {
    segmentationBackend: seg.backend,
    sam2PhotoCount: seg.sam2PhotoCount,
    failedPhotoCount: seg.failedPhotoCount,
    skippedPhotoCount: seg.skippedPhotoCount,
    cannyPhotoCount: seg.cannyPhotoCount,
    photoResults: seg.photoResults,
    budgetExhaustedReason: seg.budgetExhaustedReason,
  };
}

// ──── Stage Runner Helper ───────────────────────────────────────────────────

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

/**
 * Check if the pipeline has exceeded its time budget.
 * Returns true if remaining stages should be skipped to avoid 504 timeout.
 */
function isPipelineTimedOut(pipelineStart: number): boolean {
  return (Date.now() - pipelineStart) >= PIPELINE_TIMEOUT_MS;
}

function withFullPipelineSegmentationBudget(
  input: GeometryReconstructionInput,
): GeometryReconstructionInput {
  return {
    ...input,
    config: {
      ...fullPipelineConfig(input),
      maxSam2Photos: FULL_PIPELINE_MAX_SAM2_PHOTOS,
      stageTimeoutMs: FULL_PIPELINE_SEGMENTATION_STAGE_TIMEOUT_MS,
      minRemainingMsForSam2Attempt: FULL_PIPELINE_MIN_REMAINING_MS_FOR_SAM2_ATTEMPT,
    },
  };
}

// ──── Full Pipeline Orchestration ───────────────────────────────────────────

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

  // ── Stage 1: Segmentation ──────────────────────────────────────────────
  const segmentationInput = withFullPipelineSegmentationBudget(input);
  const segFullOutput = await asyncStageTimer('segmentation', () =>
    runSegmentationFullOutput(segmentationInput),
  );
  const segResult = segFullOutput.result;
  const segFields = segReportFields(segResult);
  const segmentationArtifacts = segResult.artifacts;
  allArtifacts.push(...segmentationArtifacts);
  stages.push({ stage: 'segmentation', artifactCount: segmentationArtifacts.length, durationMs: segFullOutput.durationMs });
  console.info(
    `[Pipeline B] Stage 1 (segmentation): ${segmentationArtifacts.length} artifacts in ${segFullOutput.durationMs}ms [backend=${segFields.segmentationBackend}, sam2=${segFields.sam2PhotoCount} photos, failed=${segFields.failedPhotoCount}, skipped=${segFields.skippedPhotoCount}, canny=${segFields.cannyPhotoCount}]${segFields.budgetExhaustedReason ? ` budget_exhausted=${segFields.budgetExhaustedReason}` : ''}`,
  );

  // Extract typed masks for subsequent stages
  const masks = segmentationArtifacts.filter(
    (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );

  // Timeout check before Stage 2
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 1 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ── Stage 2: Line Extraction ────────────────────────────────────────────
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

  // Timeout check before Stage 3
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 2 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ── Stage 3: Vanishing Points ──────────────────────────────────────────
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

  // Timeout check before Stage 4
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 3 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ── Stage 4: Depth Estimation ──────────────────────────────────────────
  // Now async — MiDaS service call requires network I/O
  const depthResult = await asyncStageTimer('depth_estimation', () =>
    runDepthFromReconstructionInput(input, masks, vanishingPoints, segResult.imageBytesMap),
  );
  const depthArtifacts = depthResult.result;
  allArtifacts.push(...depthArtifacts);
  stages.push({ stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: depthResult.durationMs });
  console.info(
    `[Pipeline B] Stage 4 (depth_estimation): ${depthArtifacts.length} artifacts in ${depthResult.durationMs}ms`,
  );

  // Extract typed depth maps for Stage 5 (depth-augmented plane extraction)
  const depthMaps = depthArtifacts.filter(
    (a): a is DepthMap => a.artifactType === 'depth_map',
  );

  // Determine whether MiDaS was used (any depth map with confidence >= 60 implies MiDaS)
  const usedMidas = depthMaps.some(dm => dm.confidence >= 60);

  // Timeout check before Stage 5
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 4 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ── Stage 5: Plane Extraction ──────────────────────────────────────────
  // Now depth-augmented: passes DepthMap artifacts from Stage 4. Full Pipeline B
  // uses stricter geometry config so weak segmentation masks cannot become
  // trusted roof/wall overlays without structural support.
  const geometryInput = withFullPipelineGeometryConfig(input);
  const planeResult = stageTimer('plane_extraction', () =>
    runPlaneExtractionFromReconstructionInput(geometryInput, masks, lines, vanishingPoints, depthMaps, usedMidas),
  );
  const planeArtifacts = planeResult.result;
  allArtifacts.push(...planeArtifacts);
  stages.push({ stage: 'plane_extraction', artifactCount: planeArtifacts.length, durationMs: planeResult.durationMs });
  console.info(
    `[Pipeline B] Stage 5 (plane_extraction): ${planeArtifacts.length} artifacts in ${planeResult.durationMs}ms`,
  );

  // Timeout check before Stage 6
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 5 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ── Stage 6: Multi-View Fusion ─────────────────────────────────────────
  const fusionResult = stageTimer('multi_view_fusion', () =>
    runMultiViewFusionFromReconstructionInput(geometryInput, allArtifacts),
  );
  const fusionArtifacts = fusionResult.result.artifacts;
  allArtifacts.push(...fusionArtifacts);
  stages.push({ stage: 'multi_view_fusion', artifactCount: fusionArtifacts.length, durationMs: fusionResult.durationMs });
  console.info(
    `[Pipeline B] Stage 6 (multi_view_fusion): ${fusionArtifacts.length} artifacts in ${fusionResult.durationMs}ms`,
  );

  // Timeout check before Stage 7
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 6 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, ...segFields };
  }

  // ──── Stage 7: Photogrammetry ────────────────────────────────────────────
  const photoGramResult = stageTimer('photogrammetry', () =>
    runPhotogrammetryFromReconstructionInput(input, allArtifacts),
  );
  const photoGramArtifacts = photoGramResult.result.artifacts;
  allArtifacts.push(...photoGramArtifacts);
  stages.push({ stage: 'photogrammetry', artifactCount: photoGramArtifacts.length, durationMs: photoGramResult.durationMs });
  console.info(
    `[Pipeline B] Stage 7 (photogrammetry): ${photoGramArtifacts.length} artifacts in ${photoGramResult.durationMs}ms`,
  );

  const totalDurationMs = Date.now() - pipelineStart;
  console.info(
    `[Pipeline B] Completed for survey=${input.surveyId}: ${allArtifacts.length} total artifacts in ${totalDurationMs}ms`,
  );

  return {
    artifacts: allArtifacts,
    stages,
    totalDurationMs,
    ...segFields,
  };
}

// ──── Partial Pipeline Runners ──────────────────────────────────────────────

/**
 * Run only the segmentation stage of Pipeline B.
 */
export async function runSegmentationOnlyPipeline(
  input: GeometryReconstructionInput,
): Promise<FullPipelineResult> {
  const start = Date.now();
  const segOutput = await runSegmentationFullOutput(input);
  const segFields = segReportFields(segOutput);
  return {
    artifacts: segOutput.artifacts,
    stages: [{ stage: 'segmentation', artifactCount: segOutput.artifacts.length, durationMs: Date.now() - start }],
    totalDurationMs: Date.now() - start,
    ...segFields,
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
  const segOutput = await runSegmentationFullOutput(input);
  const segFields = segReportFields(segOutput);
  const segArtifacts = segOutput.artifacts;
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

  const depthArtifacts = await runDepthFromReconstructionInput(input, masks, vanishingPoints, {});
  const allArtifacts = [...segArtifacts, ...lineArtifacts, ...vpArtifacts, ...depthArtifacts];

  return {
    artifacts: allArtifacts,
    stages: [
      { stage: 'segmentation', artifactCount: segArtifacts.length, durationMs: 0 },
      { stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: Date.now() - start },
    ],
    totalDurationMs: Date.now() - start,
    ...segFields,
  };
}
