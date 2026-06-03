/**
 * Async Geometry Reconstruction Job Manager — PostgreSQL-backed.
 *
 * Architecture mirrors the photo_vision_jobs pattern:
 *   POST creates a job record in DB → returns jobId instantly.
 *   Worker processes pipeline stages, writing progress + heartbeat to DB.
 *   GET reads DB status (instant — no external service communication).
 *   Client polls GET every few seconds for progress.
 *
 * Heartbeat protocol:
 *   - Worker updates `last_heartbeat_at` and `current_stage` at each stage boundary.
 *   - Stale detector marks jobs as failed if heartbeat > HEARTBEAT_TIMEOUT_MS.
 *   - Client can observe `currentStage` for real-time progress indication.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  GeometryReconstructionInput,
  GeometryReconstructionJob,
  JobStatus,
  GeometryReconstructionAuthority,
} from './types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Heartbeat timeout — mark job as failed if no heartbeat for 10 minutes. */
export const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;

/** Stuck-job threshold — reset heartbeat if running > 30 minutes with no update. */
export const STUCK_JOB_THRESHOLD_MS = 30 * 60 * 1000;

/** Pipeline stages in order. */
export const PIPELINE_STAGES = [
  'queued',
  'segmentation',
  'mask_cleanup',
  'line_extraction',
  'vanishing_point_estimation',
  'plane_extraction',
  'depth_estimation',
  'multi_view_fusion',
  'completed',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ---------------------------------------------------------------------------
// Job record helpers (pure functions — testable without DB)
// ---------------------------------------------------------------------------

/** Heartbeat info extracted from a job record. */
export interface HeartbeatInfo {
  jobId: string;
  currentStage: string | null;
  lastHeartbeatAt: string | null;
  status: JobStatus;
}

/** Determine if a heartbeat indicates a stuck job. */
export function isHeartbeatStale(info: HeartbeatInfo, nowMs: number): boolean {
  if (info.status !== 'running') return false;
  if (!info.lastHeartbeatAt) return true; // running with no heartbeat = stuck
  const elapsed = nowMs - new Date(info.lastHeartbeatAt).getTime();
  return elapsed > HEARTBEAT_TIMEOUT_MS;
}

/** Determine if a job has been running too long (stuck threshold). */
export function isJobStuck(info: HeartbeatInfo, nowMs: number): boolean {
  if (info.status !== 'running') return false;
  if (!info.lastHeartbeatAt) return true;
  const elapsed = nowMs - new Date(info.lastHeartbeatAt).getTime();
  return elapsed > STUCK_JOB_THRESHOLD_MS;
}

/** Compute progress fraction (0-1) based on current stage. */
export function computeProgress(currentStage: string | null): number {
  if (!currentStage) return 0;
  const idx = PIPELINE_STAGES.indexOf(currentStage as PipelineStage);
  if (idx < 0) return 0;
  return idx / (PIPELINE_STAGES.length - 1);
}

/** Build a new job record (before persisting to DB). */
export function buildNewJob(
  jobId: string,
  input: GeometryReconstructionInput,
  workerVersion: string,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    id: jobId,
    surveyId: input.surveyId,
    status: 'queued',
    pipeline: input.pipeline,
    input,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    currentStage: 'queued',
    lastHeartbeatAt: now,
    workerVersion,
    stageDurations: null,
    failureStage: null,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...BASE_LIMITATIONS],
  };
}

/** Transition a job to 'running' status with an initial stage. */
export function transitionToRunning(
  job: GeometryReconstructionJob,
  initialStage: PipelineStage,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    ...job,
    status: 'running',
    currentStage: initialStage,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
}

/** Update the heartbeat for a running job (advances stage). */
export function advanceStage(
  job: GeometryReconstructionJob,
  nextStage: PipelineStage,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    ...job,
    currentStage: nextStage,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
}

/** Transition a job to 'completed' status. */
export function transitionToCompleted(
  job: GeometryReconstructionJob,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    ...job,
    status: 'completed',
    currentStage: 'completed',
    completedAt: now,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
}

/** Transition a job to 'failed' status. */
export function transitionToFailed(
  job: GeometryReconstructionJob,
  errorStage: string,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    ...job,
    status: 'failed',
    currentStage: errorStage,
    completedAt: now,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
}

/** Transition a job to 'cancelled' status. */
export function transitionToCancelled(
  job: GeometryReconstructionJob,
): GeometryReconstructionJob {
  const now = new Date().toISOString();
  return {
    ...job,
    status: 'cancelled',
    completedAt: now,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// DB operations (require live DB connection — not unit-testable directly)
// ---------------------------------------------------------------------------

/**
 * Update job heartbeat in DB. Called at each stage boundary so that
 * stuck jobs are visible without relying on logs alone.
 *
 * Uses RETURNING for Neon serverless driver compatibility.
 */
export async function updateJobHeartbeat(
  sql: ReturnType<typeof Function>,
  jobId: string,
  currentStage: string,
): Promise<void> {
  await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET current_stage = ${currentStage},
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
    RETURNING id
  `;
}

/**
 * Mark a job as running with initial stage. CAS on status='queued'.
 * Returns true if the update was applied (i.e. this caller won the race).
 */
export async function markJobRunning(
  sql: ReturnType<typeof Function>,
  jobId: string,
  initialStage: string,
  workerVersion: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'running',
        current_stage = ${initialStage},
        last_heartbeat_at = NOW(),
        worker_version = ${workerVersion},
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'queued'
    RETURNING id
  `;
  return result.length > 0;
}

/**
 * Mark a job as completed. CAS on status='running'.
 * Returns true if the update was applied.
 */
export async function markJobCompleted(
  sql: ReturnType<typeof Function>,
  jobId: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'completed',
        current_stage = 'completed',
        completed_at = NOW(),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'running'
    RETURNING id
  `;
  return result.length > 0;
}

/**
 * Mark a job as failed with error stage. CAS on status='running'.
 * Returns true if the update was applied.
 */
export async function markJobFailed(
  sql: ReturnType<typeof Function>,
  jobId: string,
  errorStage: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'failed',
        current_stage = ${errorStage},
        completed_at = NOW(),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'running'
    RETURNING id
  `;
  return result.length > 0;
}

/**
 * Cancel a job (mark as cancelled). CAS on status IN ('queued', 'running').
 * Returns true if the update was applied.
 */
export async function cancelJobInDb(
  sql: ReturnType<typeof Function>,
  jobId: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'cancelled',
        completed_at = NOW(),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status IN ('queued', 'running')
    RETURNING id
  `;
  return result.length > 0;
}

/**
 * Mark stale running jobs as failed (heartbeat > HEARTBEAT_TIMEOUT_MS).
 * Returns the number of jobs marked as failed.
 */
export async function markStaleJobsFailed(
  sql: ReturnType<typeof Function>,
): Promise<number> {
  const result = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'failed',
        current_stage = 'heartbeat_timeout',
        completed_at = NOW(),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE status = 'running'
      AND last_heartbeat_at < NOW() - INTERVAL '10 minutes'
    RETURNING id
  `;
  return result.length;
}

/**
 * Store an artifact with stage_timings and worker_version.
 */
export async function insertArtifactWithProvenance(
  sql: ReturnType<typeof Function>,
  artifact: {
    jobId: string;
    surveyId: string;
    fileId: string | null;
    artifactType: string;
    pipeline: string;
    payload: Record<string, unknown>;
    confidence: number;
    limitations: string[];
    authority: GeometryReconstructionAuthority;
    stageTimings: Record<string, number> | null;
    workerVersion: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO site_survey_geometry_reconstruction_artifacts (
      job_id, survey_id, file_id, artifact_type, pipeline,
      payload, confidence, limitations, authority,
      stage_timings, worker_version
    ) VALUES (
      ${artifact.jobId}::uuid,
      ${artifact.surveyId}::uuid,
      ${artifact.fileId},
      ${artifact.artifactType},
      ${artifact.pipeline},
      ${JSON.stringify(artifact.payload)},
      ${artifact.confidence},
      ${artifact.limitations},
      ${JSON.stringify(artifact.authority)},
      ${artifact.stageTimings ? JSON.stringify(artifact.stageTimings) : null},
      ${artifact.workerVersion}
    )
  `;
}
