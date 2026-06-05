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
// P0 — Execution Stability:
//   - checkpointCallback is called after each stage with accumulated artifacts
//     and stage timing data, enabling incremental DB persistence
//   - stageDurations map is built progressively and included in the result
//   - Timeout returns preserve all artifacts accumulated so far
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
  DepthContradictionReport,
} from './types';

import {
  runSegmentationFromReconstructionInput,
  runSegmentationFullOutput,
  SEGMENTATION_WORKER_VERSION,
  type SegmentationWorkerOutput,
  type PhotoSegmentationResult,
  type SegmentationBatchCallback,
} from './workers/segmentation/runSegmentationWorker';
import { runLineExtractionFromReconstructionInput } from './workers/lineExtraction/runLineExtractionWorker';
import { estimateVanishingPointsFromReconstructionInput } from './workers/perspective/estimateVanishingPoints';
import { runDepthFromReconstructionInput } from './workers/depth/runDepthWorker';
import { runPlaneExtractionFromReconstructionInput } from './workers/planeExtraction/runPlaneExtractionWorker';
import { runMultiViewFusionFromReconstructionInput } from './workers/multiViewFusion/runMultiViewFusion';
import { runPhotogrammetryFromReconstructionInput } from './workers/photogrammetry/runPhotogrammetryWorker';

// ──── Pipeline timeout safeguard ────────────────────────────────────────────

// Inline execution still has a Vercel ceiling; the Render background worker
// gets a longer timeout through getGeometryPipelineTimeoutMs().
type EnvRecord = Record<string, string | undefined>;

const DEFAULT_INLINE_PIPELINE_TIMEOUT_MS = 270_000;
const DEFAULT_BACKGROUND_PIPELINE_TIMEOUT_MS = 900_000;

function parsePositiveDurationMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isGeometryBackgroundWorkerRuntime(env: EnvRecord = process.env): boolean {
  const workerFlag = env.GEOMETRY_RECONSTRUCTION_WORKER?.toLowerCase();
  const serviceName = env.RENDER_SERVICE_NAME?.toLowerCase() ?? '';
  const workerId = env.WORKER_ID?.toLowerCase() ?? '';

  return (
    workerFlag === 'true' ||
    workerFlag === '1' ||
    serviceName === 'geometry-reconstruction-worker' ||
    workerId.startsWith('render-worker-')
  );
}

/**
 * Maximum pipeline duration before skipping remaining stages.
 *
 * Inline execution keeps the 270s soft limit so the Vercel fallback endpoint
 * can return before maxDuration=300 kills the process. The Render background
 * worker has no Vercel ceiling, so it gets a longer default and can be
 * overridden with GEOMETRY_PIPELINE_TIMEOUT_MS.
 */
export function getGeometryPipelineTimeoutMs(env: EnvRecord = process.env): number {
  return (
    parsePositiveDurationMs(env.GEOMETRY_PIPELINE_TIMEOUT_MS) ??
    (isGeometryBackgroundWorkerRuntime(env)
      ? DEFAULT_BACKGROUND_PIPELINE_TIMEOUT_MS
      : DEFAULT_INLINE_PIPELINE_TIMEOUT_MS)
  );
}

// ──── Pipeline Stage Result ──────────────────────────────────────────────────

export interface PipelineStageResult {
  stage: string;
  artifactCount: number;
  durationMs: number;
}

export interface FullPipelineResult {
  artifacts: GeometryReconstructionArtifact[];
  stages: PipelineStageResult[];
  totalDurationMs: number;
  /** Per-stage duration map: { "segmentation": 12345, "line_extraction": 678, ... } */
  stageDurations: Record<string, number>;
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
  /** Depth-class contradiction reports (Phase 0, P0-2.5).
   *  Populated when PHASE0_DEPTH_CONTRADICTION is active and MiDaS was used.
   *  Available to downstream plane extraction and WP-4 promotion quality gate.
   *  Empty array when flag is off or heuristic path was used. */
  contradictionReports: DepthContradictionReport[];
}

/** Checkpoint data emitted after each pipeline stage completes. */
export interface PipelineCheckpoint {
  /** The stage that just completed. */
  stage: string;
  /** Artifacts produced by THIS stage only. */
  stageArtifacts: GeometryReconstructionArtifact[];
  /** All artifacts accumulated so far (from all completed stages). */
  allArtifacts: GeometryReconstructionArtifact[];
  /** Per-stage timing data for all completed stages so far. */
  stageDurations: Record<string, number>;
  /** Elapsed time since pipeline start in milliseconds. */
  elapsedMs: number;
  /** Which stage the pipeline will attempt next (null if pipeline is complete). */
  nextStage: string | null;
  /** Depth-class contradiction reports (Phase 0, P0-2.5).
   *  Available after depth_estimation stage. Empty before/after. */
  contradictionReports: DepthContradictionReport[];
}

/**
 * Callback invoked after each pipeline stage completes.
 * Used for checkpoint persistence — the caller can persist intermediate
 * artifacts to DB immediately, ensuring no work is lost on timeout.
 *
 * The callback is best-effort: if it throws, the pipeline logs the error
 * but continues running. Checkpoint failures must NOT abort the pipeline.
 */
export type CheckpointCallback = (checkpoint: PipelineCheckpoint) => Promise<void>;

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

// ──── Stage Runner Helper ─────────────────────────────────────────────────────

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
  return (Date.now() - pipelineStart) >= getGeometryPipelineTimeoutMs();
}

/**
 * Invoke the checkpoint callback, logging but not throwing on error.
 * Checkpoint failures must never abort the pipeline.
 */
async function invokeCheckpoint(
  callback: CheckpointCallback | undefined,
  checkpoint: PipelineCheckpoint,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(checkpoint);
  } catch (err) {
    console.error(
      `[Pipeline B] Checkpoint callback failed after stage=${checkpoint.stage}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Stage order for determining nextStage in checkpoint
const STAGE_ORDER = [
  'segmentation',
  'line_extraction',
  'vanishing_points',
  'depth_estimation',
  'plane_extraction',
  'multi_view_fusion',
  'photogrammetry',
] as const;

function nextStageAfter(currentStage: string): string | null {
  const idx = STAGE_ORDER.indexOf(currentStage as typeof STAGE_ORDER[number]);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

/**
 * Adapt a CheckpointCallback into a SegmentationBatchCallback for sub-stage
 * checkpointing during the long-running segmentation stage.
 *
 * Problem: P0 checkpoints fire only AFTER a complete stage, but SAM2
 * segmentation takes 200–440s (multiple batches × ~55s each). If the
 * process dies mid-segmentation, zero artifacts survive.
 *
 * Solution: This adapter fires the pipeline's CheckpointCallback after each
 * SAM2 batch completes, treating each batch as a partial "segmentation"
 * checkpoint. The callback receives the accumulated artifacts so far,
 * enabling incremental DB persistence every ~20–40s instead of ~440s.
 *
 * The stage name is always 'segmentation' and nextStage is always
 * 'line_extraction' (the stage after segmentation), because the pipeline
 * hasn't moved past segmentation yet. This is intentional — the caller
 * can use the batchIndex to distinguish sub-stage from final-stage
 * checkpoints if needed.
 */
function adaptBatchCallback(
  checkpointCallback: CheckpointCallback | undefined,
  pipelineStart: number,
  stageDurationsRef: { value: Record<string, number> },
): SegmentationBatchCallback | undefined {
  if (!checkpointCallback) return undefined;

  return async (batchCheckpoint) => {
    // Build a PipelineCheckpoint from the batch checkpoint.
    // The segmentation stage is still in progress, so we report
    // the partial duration accumulated so far.
    const partialDurationMs = batchCheckpoint.elapsedMs;
    const stageDurations = { ...stageDurationsRef.value };
    // Don't overwrite a previous segmentation duration — accumulate
    if (!stageDurations['segmentation']) {
      stageDurations['segmentation'] = partialDurationMs;
    }

    await checkpointCallback({
      stage: 'segmentation',
      stageArtifacts: batchCheckpoint.allArtifacts,
      allArtifacts: batchCheckpoint.allArtifacts,
      stageDurations,
      elapsedMs: Date.now() - pipelineStart,
      nextStage: 'line_extraction',
      contradictionReports: [],
    });
  };
}

// ──── Full Pipeline Orchestration ─────────────────────────────────────────────

/**
 * Run the full Pipeline B (Geometry Reconstruction) orchestration.
 *
 * Chains all six stages in order, passing outputs from each stage into
 * subsequent stages as needed. Returns ALL artifacts from ALL stages
 * as a flat array, plus per-stage timing information.
 *
 * P0 — Execution Stability:
 *   - `checkpointCallback` is invoked after each stage with accumulated
 *     artifacts and stageDurations, enabling the route handler to persist
 *     intermediate results to DB incrementally. If the pipeline times out
 *     or the Vercel function is killed, the already-checkpointed artifacts
 *     survive in the database.
 *   - stageDurations is built progressively and included in the return value.
 *
 * This is the function that should be called when `pipeline === 'full'`
 * (or any non-mock pipeline) is requested via the start route.
 */
export async function runFullGeometryReconstructionPipeline(
  input: GeometryReconstructionInput,
  checkpointCallback?: CheckpointCallback,
): Promise<FullPipelineResult> {
  const pipelineStart = Date.now();
  const stages: PipelineStageResult[] = [];
  const allArtifacts: GeometryReconstructionArtifact[] = [];
  const stageDurations: Record<string, number> = {};

  console.info(
    `[Pipeline B] Starting full pipeline for survey=${input.surveyId} photos=${input.sourcePhotos.length} pipeline=${input.pipeline}`,
  );

  // ──── Stage 1: Segmentation ────────────────────────────────────────────
  // P1 — Adapt the pipeline checkpoint callback into a sub-stage batch
  // callback so that each SAM2 batch (~20-40s) persists artifacts instead
  // of waiting for the full segmentation stage (~200-440s) to complete.
  const stageDurationsRef = { value: stageDurations };
  const segBatchCallback = adaptBatchCallback(
    checkpointCallback,
    pipelineStart,
    stageDurationsRef,
  );
  const segFullOutput = await asyncStageTimer('segmentation', () =>
    runSegmentationFullOutput(input, segBatchCallback),
  );
  const segResult = segFullOutput.result;
  const segFields = segReportFields(segResult);
  const segmentationArtifacts = segResult.artifacts;
  allArtifacts.push(...segmentationArtifacts);
  stageDurations['segmentation'] = segFullOutput.durationMs;
  stages.push({ stage: 'segmentation', artifactCount: segmentationArtifacts.length, durationMs: segFullOutput.durationMs });
  console.info(
    `[Pipeline B] Stage 1 (segmentation): ${segmentationArtifacts.length} artifacts in ${segFullOutput.durationMs}ms [backend=${segFields.segmentationBackend}, sam2=${segFields.sam2PhotoCount} photos, failed=${segFields.failedPhotoCount}, skipped=${segFields.skippedPhotoCount}, canny=${segFields.cannyPhotoCount}]${segFields.budgetExhaustedReason ? ` budget_exhausted=${segFields.budgetExhaustedReason}` : ''}`,
  );

  // Checkpoint: persist segmentation artifacts immediately
  await invokeCheckpoint(checkpointCallback, {
    stage: 'segmentation',
    stageArtifacts: segmentationArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('segmentation'),
    contradictionReports: [],
  });

  // Extract typed masks for subsequent stages
  const masks = segmentationArtifacts.filter(
    (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );

  // ──── Pass 3E: Geometry participation flag filtering ────
  // Masks with excludeFromGeometry=true are viewable overlays but do not feed any geometry stage.
  // Each downstream stage receives only masks whose participation flag allows it.
  // Masks without participation flags default to full participation (backward compatible).
  const masksForLines = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInLines !== false,
  );
  const masksForPlanes = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInPlanes !== false,
  );
  const masksForDepth = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInDepthFusion !== false,
  );
  // Photogrammetry is more permissive: vegetation participates but vehicles/sky do not
  const masksForPhotogrammetry = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInPhotogrammetry !== false,
  );

  console.info(
    `[Pass3E] Mask distribution: total=${masks.length}, ` +
    `lines=${masksForLines.length}, planes=${masksForPlanes.length}, ` +
    `depth=${masksForDepth.length}, photogrammetry=${masksForPhotogrammetry.length}` +
    (masks.some(m => m.excludeFromGeometry === true) ? `, excludedFromGeometry=${masks.filter(m => m.excludeFromGeometry === true).length}` : ''),
  );

  // Timeout check before Stage 2
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 1 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 2: Line Extraction ────────────────────────────────────────────
  // Pass 3E: only masks with participatesInLines=true (and not excluded) feed line extraction
  const lineResult = await asyncStageTimer('line_extraction', () =>
    runLineExtractionFromReconstructionInput(input, masksForLines, segResult.imageBytesMap),
  );
  const lineArtifacts = lineResult.result;
  allArtifacts.push(...lineArtifacts);
  stageDurations['line_extraction'] = lineResult.durationMs;
  stages.push({ stage: 'line_extraction', artifactCount: lineArtifacts.length, durationMs: lineResult.durationMs });
  console.info(
    `[Pipeline B] Stage 2 (line_extraction): ${lineArtifacts.length} artifacts in ${lineResult.durationMs}ms`,
  );

  // Checkpoint: persist line extraction artifacts
  await invokeCheckpoint(checkpointCallback, {
    stage: 'line_extraction',
    stageArtifacts: lineArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('line_extraction'),
    contradictionReports: [],
  });

  // Extract typed structural lines for subsequent stages
  const lines = lineArtifacts.filter(
    (a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate',
  );

  // Timeout check before Stage 3
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 2 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 3: Vanishing Points ──────────────────────────────────────────
  const vpResult = stageTimer('vanishing_points', () =>
    estimateVanishingPointsFromReconstructionInput(input, lines),
  );
  const vpArtifacts = vpResult.result;
  allArtifacts.push(...vpArtifacts);
  stageDurations['vanishing_points'] = vpResult.durationMs;
  stages.push({ stage: 'vanishing_points', artifactCount: vpArtifacts.length, durationMs: vpResult.durationMs });
  console.info(
    `[Pipeline B] Stage 3 (vanishing_points): ${vpArtifacts.length} artifacts in ${vpResult.durationMs}ms`,
  );

  // Checkpoint: persist vanishing point artifacts
  await invokeCheckpoint(checkpointCallback, {
    stage: 'vanishing_points',
    stageArtifacts: vpArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('vanishing_points'),
    contradictionReports: [],
  });

  // Extract typed vanishing points for subsequent stages
  const vanishingPoints = vpArtifacts.filter(
    (a): a is VanishingPointArtifact => a.artifactType === 'vanishing_point',
  );

  // Timeout check before Stage 4
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 3 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 4: Depth Estimation ──────────────────────────────────────────
  // Now async — MiDaS service call requires network I/O
  const depthResult = await asyncStageTimer('depth_estimation', () =>
    runDepthFromReconstructionInput(input, masksForDepth, vanishingPoints, segResult.imageBytesMap),
  );
  const depthOutput = depthResult.result;
  const depthArtifacts = depthOutput.artifacts;
  const depthContradictionReports = depthOutput.contradictionReports;
  allArtifacts.push(...depthArtifacts);
  stageDurations['depth_estimation'] = depthResult.durationMs;
  stages.push({ stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: depthResult.durationMs });
  console.info(
    `[Pipeline B] Stage 4 (depth_estimation): ${depthArtifacts.length} artifacts in ${depthResult.durationMs}ms` +
    (depthContradictionReports.length > 0 ? `, ${depthContradictionReports.length} contradiction reports` : ''),
  );

  // Checkpoint: persist depth artifacts + contradiction reports
  await invokeCheckpoint(checkpointCallback, {
    stage: 'depth_estimation',
    stageArtifacts: depthArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('depth_estimation'),
    contradictionReports: depthContradictionReports,
  });

  // Extract typed depth maps for Stage 5 (depth-augmented plane extraction)
  const depthMaps = depthArtifacts.filter(
    (a): a is DepthMap => a.artifactType === 'depth_map',
  );

  // Determine whether MiDaS was used (any depth map with confidence >= 60 implies MiDaS)
  const usedMidas = depthMaps.some(dm => dm.confidence >= 60);

  // Timeout check before Stage 5
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 4 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 5: Plane Extraction ──────────────────────────────────────────
  // Now depth-augmented: passes DepthMap artifacts from Stage 4
  const planeResult = stageTimer('plane_extraction', () =>
    runPlaneExtractionFromReconstructionInput(input, masksForPlanes, lines, vanishingPoints, depthMaps, usedMidas),
  );
  const planeArtifacts = planeResult.result;
  allArtifacts.push(...planeArtifacts);
  stageDurations['plane_extraction'] = planeResult.durationMs;
  stages.push({ stage: 'plane_extraction', artifactCount: planeArtifacts.length, durationMs: planeResult.durationMs });
  console.info(
    `[Pipeline B] Stage 5 (plane_extraction): ${planeArtifacts.length} artifacts in ${planeResult.durationMs}ms`,
  );

  // Checkpoint: persist plane artifacts
  await invokeCheckpoint(checkpointCallback, {
    stage: 'plane_extraction',
    stageArtifacts: planeArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('plane_extraction'),
    contradictionReports: [],
  });

  // Timeout check before Stage 6
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 5 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 6: Multi-View Fusion ──────────────────────────────────────────
  const fusionResult = stageTimer('multi_view_fusion', () =>
    runMultiViewFusionFromReconstructionInput(input, allArtifacts),
  );
  const fusionArtifacts = fusionResult.result.artifacts;
  allArtifacts.push(...fusionArtifacts);
  stageDurations['multi_view_fusion'] = fusionResult.durationMs;
  stages.push({ stage: 'multi_view_fusion', artifactCount: fusionArtifacts.length, durationMs: fusionResult.durationMs });
  console.info(
    `[Pipeline B] Stage 6 (multi_view_fusion): ${fusionArtifacts.length} artifacts in ${fusionResult.durationMs}ms`,
  );

  // Checkpoint: persist fusion artifacts
  await invokeCheckpoint(checkpointCallback, {
    stage: 'multi_view_fusion',
    stageArtifacts: fusionArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: nextStageAfter('multi_view_fusion'),
    contradictionReports: [],
  });

  // Timeout check before Stage 7
  if (isPipelineTimedOut(pipelineStart)) {
    console.warn(`[Pipeline B] Timeout after Stage 6 — skipping remaining stages (${Date.now() - pipelineStart}ms elapsed)`);
    return { artifacts: allArtifacts, stages, totalDurationMs: Date.now() - pipelineStart, stageDurations, contradictionReports: [] as DepthContradictionReport[], ...segFields };
  }

  // ──── Stage 7: Photogrammetry ────────────────────────────────────────────
  const photoGramResult = stageTimer('photogrammetry', () =>
    runPhotogrammetryFromReconstructionInput(input, allArtifacts),
  );
  const photoGramArtifacts = photoGramResult.result.artifacts;
  allArtifacts.push(...photoGramArtifacts);
  stageDurations['photogrammetry'] = photoGramResult.durationMs;
  stages.push({ stage: 'photogrammetry', artifactCount: photoGramArtifacts.length, durationMs: photoGramResult.durationMs });
  console.info(
    `[Pipeline B] Stage 7 (photogrammetry): ${photoGramArtifacts.length} artifacts in ${photoGramResult.durationMs}ms`,
  );

  // Final checkpoint: pipeline complete
  await invokeCheckpoint(checkpointCallback, {
    stage: 'photogrammetry',
    stageArtifacts: photoGramArtifacts,
    allArtifacts: [...allArtifacts],
    stageDurations: { ...stageDurations },
    elapsedMs: Date.now() - pipelineStart,
    nextStage: null, // pipeline is complete
    contradictionReports: depthContradictionReports,
  });

  const totalDurationMs = Date.now() - pipelineStart;
  console.info(
    `[Pipeline B] Completed for survey=${input.surveyId}: ${allArtifacts.length} total artifacts in ${totalDurationMs}ms`,
  );

  return {
    artifacts: allArtifacts,
    stages,
    totalDurationMs,
    stageDurations,
    contradictionReports: depthContradictionReports,
    ...segFields,
  };
}

// ──── Partial Pipeline Runners ────────────────────────────────────────────────

/**
 * Run only the segmentation stage of Pipeline B.
 */
export async function runSegmentationOnlyPipeline(
  input: GeometryReconstructionInput,
  checkpointCallback?: CheckpointCallback,
): Promise<FullPipelineResult> {
  const start = Date.now();
  const stageDurationsRef = { value: {} as Record<string, number> };
  const segBatchCallback = adaptBatchCallback(checkpointCallback, start, stageDurationsRef);
  const segOutput = await runSegmentationFullOutput(input, segBatchCallback);
  const segFields = segReportFields(segOutput);
  const durationMs = Date.now() - start;
  const stageDurations: Record<string, number> = { segmentation: durationMs };

  // Checkpoint: persist segmentation artifacts
  if (checkpointCallback) {
    await invokeCheckpoint(checkpointCallback, {
      stage: 'segmentation',
      stageArtifacts: segOutput.artifacts,
      allArtifacts: [...segOutput.artifacts],
      stageDurations,
      elapsedMs: durationMs,
      nextStage: null,
      contradictionReports: [],
    });
  }

  return {
    artifacts: segOutput.artifacts,
    stages: [{ stage: 'segmentation', artifactCount: segOutput.artifacts.length, durationMs }],
    totalDurationMs: durationMs,
    stageDurations,
    contradictionReports: [],
    ...segFields,
  };
}

/**
 * Run only the depth estimation stage of Pipeline B.
 * Requires pre-existing segmentation masks.
 */
export async function runDepthOnlyPipeline(
  input: GeometryReconstructionInput,
  checkpointCallback?: CheckpointCallback,
): Promise<FullPipelineResult> {
  const start = Date.now();
  const stageDurations: Record<string, number> = {};

  // Run segmentation first to get masks (with sub-stage batch checkpointing)
  const stageDurationsRef = { value: stageDurations };
  const segBatchCallback = adaptBatchCallback(checkpointCallback, start, stageDurationsRef);
  const segOutput = await runSegmentationFullOutput(input, segBatchCallback);
  const segFields = segReportFields(segOutput);
  const segArtifacts = segOutput.artifacts;
  const segDurationMs = Date.now() - start;
  stageDurations['segmentation'] = segDurationMs;
  const masks = segArtifacts.filter(
    (a): a is SemanticSegmentationMask => a.artifactType === 'semantic_segmentation_mask' || a.artifactType === 'segmentation_mask',
  );
  // Pass 3E: apply participation flag filtering for depth-only pipeline
  const masksForLines = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInLines !== false,
  );
  const masksForDepth = masks.filter(m =>
    m.excludeFromGeometry !== true
    && m.participation?.participatesInDepthFusion !== false,
  );
  if (checkpointCallback) {
    await invokeCheckpoint(checkpointCallback, {
      stage: 'segmentation',
      stageArtifacts: segArtifacts,
      allArtifacts: [...segArtifacts],
      stageDurations: { ...stageDurations },
      elapsedMs: Date.now() - start,
      nextStage: 'depth_estimation',
      contradictionReports: [],
    });
  }

  // Run vanishing points (needed for depth)
  const lineArtifacts = await runLineExtractionFromReconstructionInput(input, masksForLines, segOutput.imageBytesMap);
  const lines = lineArtifacts.filter(
    (a): a is StructuralLineCandidate => a.artifactType === 'structural_line_candidate',
  );
  const vpArtifacts = estimateVanishingPointsFromReconstructionInput(input, lines);
  const vanishingPoints = vpArtifacts.filter(
    (a): a is VanishingPointArtifact => a.artifactType === 'vanishing_point',
  );

  const depthOutput = await runDepthFromReconstructionInput(input, masksForDepth, vanishingPoints, {});
  const depthArtifacts = depthOutput.artifacts;
  const depthContradictionReports = depthOutput.contradictionReports;
  const allArtifacts = [...segArtifacts, ...lineArtifacts, ...vpArtifacts, ...depthArtifacts];
  const depthDurationMs = Date.now() - start - segDurationMs;
  stageDurations['depth_estimation'] = depthDurationMs;

  // Checkpoint after depth
  if (checkpointCallback) {
    await invokeCheckpoint(checkpointCallback, {
      stage: 'depth_estimation',
      stageArtifacts: depthArtifacts,
      allArtifacts: [...allArtifacts],
      stageDurations: { ...stageDurations },
      elapsedMs: Date.now() - start,
      nextStage: null,
      contradictionReports: depthContradictionReports,
    });
  }

  return {
    artifacts: allArtifacts,
    stages: [
      { stage: 'segmentation', artifactCount: segArtifacts.length, durationMs: segDurationMs },
      { stage: 'depth_estimation', artifactCount: depthArtifacts.length, durationMs: depthDurationMs },
    ],
    totalDurationMs: Date.now() - start,
    stageDurations,
    contradictionReports: depthContradictionReports,
    ...segFields,
  };
}
