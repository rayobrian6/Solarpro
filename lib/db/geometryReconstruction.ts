/**
 * Geometry reconstruction persistence helpers.
 *
 * Follows the same patterns as openSourcePhotoVision.ts:
 * - getDbReady() for Neon cold-start resilience
 * - Auth checks via site_surveys JOIN clients
 * - RETURNING on all UPDATE queries (Neon driver quirk)
 * - Survey ownership boundaries enforced
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These artifacts are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import { getDbReady } from './core';
import type {
  GeometryReconstructionArtifact,
  GeometryReconstructionAuthority,
  GeometryReconstructionInput,
  GeometryReconstructionJob,
  GeometryReconstructionResult,
  JobStatus,
  DepthContradictionReport,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a JS string array as a PostgreSQL array literal string.
 *
 * The Neon serverless driver (@neondatabase/serverless) cannot serialize
 * 2D JS arrays (string[][]) as PostgreSQL text[][]. This helper formats
 * each inner array as a self-contained PG text[] literal like '{"a","b"}',
 * which can be passed as a 1D text[] parameter and then cast back to text[]
 * in the SELECT clause of an UNNEST insert.
 *
 * Escaping rules: backslash → \\, double-quote → \", per PG array literal spec.
 */
function pgArrayLiteral(arr: string[]): string {
  if (arr.length === 0) return '{}';
  const escaped = arr.map((s) =>
    '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  );
  return '{' + escaped.join(',') + '}';
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** DB row shape for site_survey_geometry_reconstruction_jobs. */
interface JobRow {
  id: string;
  survey_id: string;
  status: string;
  pipeline: string;
  input: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_stage: string | null;
  last_heartbeat_at: string | null;
  worker_version: string | null;
  stage_durations: Record<string, number> | null;
  failure_stage: string | null;
  locked_by: string | null;
  locked_at: string | null;
}

/** DB row shape for site_survey_geometry_reconstruction_artifacts. */
interface ArtifactRow {
  id: string;
  job_id: string;
  survey_id: string;
  file_id: string | null;
  artifact_type: string;
  pipeline: string;
  payload: unknown;
  confidence: number;
  limitations: unknown;
  authority: unknown;
  stage_timings: Record<string, number> | null;
  worker_version: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

/**
 * Verify that the user owns the survey. Throws if not authorized.
 * Follows the same pattern as openSourcePhotoVision.ts.
 */
async function verifySurveyOwnership(surveyId: string, userId: string): Promise<void> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT ss.id
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    WHERE ss.id = ${surveyId}
    LIMIT 1
  `;
  if (!rows.length) {
    throw new Error('Survey not found or not authorized for geometry reconstruction.');
  }
}

/**
 * Look up the owner's user_id for a survey.
 * Used by internal worker routes (e.g., /execute) that don't have a user session
 * but need a valid UUID userId for verifySurveyOwnership during artifact insertion.
 * Returns null if the survey doesn't exist.
 */
export async function getSurveyOwnerId(surveyId: string): Promise<string | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT c.user_id
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id
    WHERE ss.id = ${surveyId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return (rows[0] as { user_id: string }).user_id;
}

// ---------------------------------------------------------------------------
// Job operations
// ---------------------------------------------------------------------------

/** Insert a new reconstruction job. */
export async function insertReconstructionJob(
  surveyId: string,
  userId: string,
  pipeline: string,
  input: GeometryReconstructionInput,
): Promise<GeometryReconstructionJob> {
  await verifySurveyOwnership(surveyId, userId);
  const sql = await getDbReady();

  const rows = await sql`
    INSERT INTO site_survey_geometry_reconstruction_jobs (
      survey_id, status, pipeline, input
    ) VALUES (
      ${surveyId}, 'queued', ${pipeline}, ${JSON.stringify(input)}
    )
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
              current_stage, last_heartbeat_at, worker_version, stage_durations, failure_stage,
              locked_by, locked_at
  `;

  const row = rows[0] as unknown as JobRow;
  return rowToJob(row, []);
}

/** Get a reconstruction job by ID. */
export async function getReconstructionJobById(jobId: string): Promise<GeometryReconstructionJob | null> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
           current_stage, last_heartbeat_at, worker_version, stage_durations, failure_stage,
           locked_by, locked_at
    FROM site_survey_geometry_reconstruction_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;

  if (!rows.length) return null;

  const jobRow = rows[0] as unknown as JobRow;

  // Fetch artifacts for this job
  const artifactRows = await sql`
    SELECT id, job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority, created_at
    FROM site_survey_geometry_reconstruction_artifacts
    WHERE job_id = ${jobId}
    ORDER BY created_at ASC
  `;

  const artifacts = (artifactRows as unknown as ArtifactRow[]).map(rowToArtifact);
  return rowToJob(jobRow, artifacts);
}

/** Update job heartbeat (current_stage + last_heartbeat_at) without changing status. Uses RETURNING (Neon driver quirk). */
export async function updateJobHeartbeatInDb(
  jobId: string,
  currentStage: string,
): Promise<void> {
  try {
    const sql = await getDbReady();
    await sql`
      UPDATE site_survey_geometry_reconstruction_jobs
      SET current_stage = ${currentStage},
          last_heartbeat_at = NOW(),
          updated_at = NOW()
      WHERE id = ${jobId}::uuid
      RETURNING id
    `;
  } catch (err) {
    // Best-effort: heartbeat failure should not crash the pipeline
    console.warn(
      '[geometryReconstruction] Heartbeat update failed for job=' + jobId + ':',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Update job status. Uses RETURNING (Neon driver quirk). */
export async function updateReconstructionJobStatus(
  jobId: string,
  status: JobStatus,
  completedAt?: string | null,
): Promise<GeometryReconstructionJob | null> {
  const sql = await getDbReady();

  const completedValue = completedAt !== undefined ? completedAt : (status === 'completed' || status === 'failed' || status === 'cancelled' ? new Date().toISOString() : null);

  const rows = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = ${status},
        updated_at = now(),
        completed_at = ${completedValue}
    WHERE id = ${jobId}
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
              current_stage, last_heartbeat_at, worker_version, stage_durations, failure_stage,
              locked_by, locked_at
  `;

  if (!rows.length) return null;

  const jobRow = rows[0] as unknown as JobRow;

  // Fetch artifacts for this job
  const artifactRows = await sql`
    SELECT id, job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority, created_at
    FROM site_survey_geometry_reconstruction_artifacts
    WHERE job_id = ${jobId}
    ORDER BY created_at ASC
  `;

  const artifacts = (artifactRows as unknown as ArtifactRow[]).map(rowToArtifact);
  return rowToJob(jobRow, artifacts);
}

// ---------------------------------------------------------------------------
// Artifact operations
// ---------------------------------------------------------------------------

/** Insert a single reconstruction artifact. */
export async function insertReconstructionArtifact(
  jobId: string,
  surveyId: string,
  userId: string,
  artifact: GeometryReconstructionArtifact,
  pipeline: string,
): Promise<void> {
  await verifySurveyOwnership(surveyId, userId);
  const sql = await getDbReady();

  const fileId = 'fileId' in artifact ? (artifact as { fileId?: string }).fileId : null;

  // limitations is TEXT[] — format as PG array literal and cast explicitly.
  // The Neon driver may inconsistently handle JS array → PG text[] binding,
  // so we use the same literal + cast approach as the batch insert for reliability.
  const limitationsArray: string[] = Array.isArray(artifact.limitations)
    ? artifact.limitations.filter((l: unknown) => typeof l === 'string')
    : [];

  await sql`
    INSERT INTO site_survey_geometry_reconstruction_artifacts (
      job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority
    ) VALUES (
      ${jobId},
      ${surveyId},
      ${fileId ?? null},
      ${artifact.artifactType},
      ${pipeline},
      ${JSON.stringify(artifact)},
      ${artifact.confidence},
      ${pgArrayLiteral(limitationsArray)}::text[],
      ${JSON.stringify(artifact.authority)}
    )
  `;
}

/**
 * Batch-insert reconstruction artifacts for a survey.
 *
 * Unlike the single-insert function, this:
 * 1. Performs auth check ONCE (not per artifact)
 * 2. Inserts all artifacts in a single SQL transaction using UNNEST
 * 3. Returns { inserted, failed } counts
 *
 * This is dramatically faster than calling insertReconstructionArtifact
 * in a loop: 2 queries total vs 2×N queries (auth + insert per artifact).
 * With 164 artifacts, that's ~2 queries vs ~328 queries to Neon Postgres.
 */
export async function insertReconstructionArtifactsBatch(
  jobId: string,
  surveyId: string,
  userId: string,
  artifacts: GeometryReconstructionArtifact[],
  pipeline: string,
  stageTimings: Record<string, number> | null = null,
  workerVersion: string | null = null,
): Promise<{ inserted: number; failed: number }> {
  if (artifacts.length === 0) return { inserted: 0, failed: 0 };

  // Single auth check for the whole batch
  await verifySurveyOwnership(surveyId, userId);
  const sql = await getDbReady();

  // Build parallel arrays for UNNEST insertion
  const jobIds: string[] = [];
  const surveyIds: string[] = [];
  const fileIds: (string | null)[] = [];
  const artifactTypes: string[] = [];
  const pipelines: string[] = [];
  const payloads: string[] = [];
  const confidences: number[] = [];
  const limitationsLiterals: string[] = [];  // PG array literal strings for text[] column
  const authorities: string[] = [];
  const stageTimingsArr: (string | null)[] = [];
  const workerVersions: (string | null)[] = [];

  for (const artifact of artifacts) {
    const fileId = 'fileId' in artifact ? (artifact as { fileId?: string }).fileId : null;
    const limitationsArray: string[] = Array.isArray(artifact.limitations)
      ? artifact.limitations.filter((l: unknown) => typeof l === 'string')
      : [];

    jobIds.push(jobId);
    surveyIds.push(surveyId);
    fileIds.push(fileId ?? null);
    artifactTypes.push(artifact.artifactType);
    pipelines.push(pipeline);
    payloads.push(JSON.stringify(artifact));
    confidences.push(artifact.confidence);
    // Format limitations as PG array literal: '{"item1","item2"}'
    // The Neon serverless driver cannot serialize 2D JS arrays (string[][])
    // as PostgreSQL text[][]. Instead, we format each inner array as a PG
    // array literal string and pass as a 1D text[] parameter. Each element
    // is then cast back to text[] in the SELECT clause.
    limitationsLiterals.push(pgArrayLiteral(limitationsArray));
    authorities.push(JSON.stringify(artifact.authority));
    stageTimingsArr.push(stageTimings ? JSON.stringify(stageTimings) : null);
    workerVersions.push(workerVersion);
  }

  try {
    const result = await sql`
      INSERT INTO site_survey_geometry_reconstruction_artifacts (
        job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority,
        stage_timings, worker_version
      )
      SELECT
        job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence,
        limitations::text[],
        authority, stage_timings, worker_version
      FROM unnest(
        ${jobIds}::uuid[],
        ${surveyIds}::uuid[],
        ${fileIds}::text[],
        ${artifactTypes}::text[],
        ${pipelines}::text[],
        ${payloads}::jsonb[],
        ${confidences}::numeric[],
        ${limitationsLiterals}::text[],  -- each element is a PG text[] literal like '{"a","b"}'
        ${authorities}::jsonb[],
        ${stageTimingsArr}::jsonb[],
        ${workerVersions}::text[]
      ) AS t(job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence,
             limitations, authority, stage_timings, worker_version)
      RETURNING id
    `;

    return { inserted: result.length, failed: artifacts.length - result.length };
  } catch (err) {
    console.error(
      '[geometryReconstruction] Batch insert failed:',
      err instanceof Error ? err.message : String(err),
    );
    // Fallback: try single inserts for resilience
    let inserted = 0;
    let failed = 0;
    for (const artifact of artifacts) {
      try {
        await insertReconstructionArtifact(jobId, surveyId, userId, artifact, pipeline);
        inserted++;
      } catch {
        failed++;
      }
    }
    return { inserted, failed };
  }
}

/** Delete all reconstruction artifacts for a survey (no auth check — internal use). */
export async function deleteArtifactsBySurvey(
  surveyId: string,
): Promise<number> {
  try {
    const sql = await getDbReady();

    const result = await sql`
      DELETE FROM site_survey_geometry_reconstruction_artifacts
      WHERE survey_id = ${surveyId}
      RETURNING id
    `;

    return result.length;
  } catch (err) {
    console.warn(
      '[geometryReconstruction] Failed to delete artifacts by survey:',
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

/** Delete reconstruction artifacts for a specific job only (not the whole survey).
 *  This preserves artifacts from other jobs (e.g., partial checkpoint artifacts
 *  from a previous run that may still be useful).
 */
export async function deleteArtifactsByJob(
  jobId: string,
): Promise<number> {
  try {
    const sql = await getDbReady();

    const result = await sql`
      DELETE FROM site_survey_geometry_reconstruction_artifacts
      WHERE job_id = ${jobId}::uuid
      RETURNING id
    `;

    return result.length;
  } catch (err) {
    console.warn(
      '[geometryReconstruction] Failed to delete artifacts by job:',
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

/** Update the stage_durations JSONB on a job record. Best-effort — does not throw on failure. */
export async function updateJobStageDurations(
  jobId: string,
  stageDurations: Record<string, number>,
): Promise<void> {
  try {
    const sql = await getDbReady();
    await sql`
      UPDATE site_survey_geometry_reconstruction_jobs
      SET stage_durations = ${JSON.stringify(stageDurations)}::jsonb,
          updated_at = NOW()
      WHERE id = ${jobId}::uuid
      RETURNING id
    `;
  } catch (err) {
    console.warn(
      '[geometryReconstruction] Failed to update stage_durations for job=' + jobId + ':',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Update the failure_stage on a job record. Best-effort — does not throw on failure. */
export async function updateJobFailureStage(
  jobId: string,
  failureStage: string,
): Promise<void> {
  try {
    const sql = await getDbReady();
    await sql`
      UPDATE site_survey_geometry_reconstruction_jobs
      SET failure_stage = ${failureStage},
          updated_at = NOW()
      WHERE id = ${jobId}::uuid
      RETURNING id
    `;
  } catch (err) {
    console.warn(
      '[geometryReconstruction] Failed to update failure_stage for job=' + jobId + ':',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Get all reconstruction artifacts for a survey (with auth check). */
export async function getArtifactsBySurvey(
  surveyId: string,
  userId: string,
): Promise<GeometryReconstructionResult> {
  await verifySurveyOwnership(surveyId, userId);
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority, created_at
    FROM site_survey_geometry_reconstruction_artifacts
    WHERE survey_id = ${surveyId}
    ORDER BY created_at ASC
  `;

  const artifacts = (rows as unknown as ArtifactRow[]).map(rowToArtifact);

  // Get the latest job for this survey to include in the result
  const jobRows = await sql`
    SELECT id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
           current_stage, last_heartbeat_at, worker_version,
           stage_durations, failure_stage,
           locked_by, locked_at
    FROM site_survey_geometry_reconstruction_jobs
    WHERE survey_id = ${surveyId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let job: GeometryReconstructionJob;
  if (jobRows.length) {
    job = rowToJob(jobRows[0] as unknown as JobRow, artifacts);
  } else {
    // No job exists yet — create a synthetic placeholder
    job = {
      id: 'none',
      surveyId,
      status: 'queued',
      pipeline: 'none',
      input: { surveyId, sourcePhotos: [], pipeline: 'mock' },
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      currentStage: null,
      lastHeartbeatAt: null,
      workerVersion: null,
      stageDurations: null,
      failureStage: null,
      lockedBy: null,
      lockedAt: null,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
  }

  return {
    schemaVersion: 'geometry_reconstruction_result_v1',
    job,
    artifactCount: artifacts.length,
    artifacts,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
  };
}

// ---------------------------------------------------------------------------
// Worker claim / lock operations
// ---------------------------------------------------------------------------

/** Lock timeout — if a lock is older than this, consider it stale and reclaimable. */
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Heartbeat-staleness window (minutes) before a 'running' job is considered
 * orphaned. The owning worker beats every 30s, so 5 min = 10 missed beats —
 * a healthy long-running job is never reclaimed, only one whose worker is gone
 * (crash / SIGKILL that skipped graceful requeue). Priority 3 — Issue 2.
 */
const RECLAIM_STALE_MINUTES = 5;

/**
 * Claim the next available queued job for a worker. Atomic CAS on locked_by IS NULL.
 * Returns the claimed job (with status set to 'running') or null if no job available.
 *
 * This is the core of the P1 worker architecture: only one worker can claim a given job.
 * The CAS pattern (WHERE locked_by IS NULL) prevents duplicate execution.
 */
export async function claimNextQueuedJob(
  workerId: string,
): Promise<GeometryReconstructionJob | null> {
  const sql = await getDbReady();

  // Priority 3 — Issue 2: reclaim ORPHANED running jobs. A 'running' job whose
  // heartbeat has gone stale means the owning worker is gone (crash/SIGKILL that
  // skipped graceful requeue). Mark it FAILED(worker_lost) — terminal, no auto
  // retry (deploy interruptions are retried via requeueJobForRetry instead).
  // Keyed on HEARTBEAT staleness (not lock age), so a healthy long-running job —
  // which beats every 30s — is never reclaimed. This also fixes the prior
  // double-execution risk (reclaiming by lock age could free a live job's lock).
  const reclaimed = await sql`
    WITH stale AS (
      SELECT id, status FROM site_survey_geometry_reconstruction_jobs
      WHERE status IN ('running', 'running_heartbeat')
        AND last_heartbeat_at IS NOT NULL
        AND last_heartbeat_at < NOW() - INTERVAL '1 minute' * ${RECLAIM_STALE_MINUTES}
    )
    UPDATE site_survey_geometry_reconstruction_jobs j
    SET status = 'failed',
        failure_stage = 'worker_lost',
        completed_at = NOW(),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
    FROM stale
    WHERE j.id = stale.id
    RETURNING j.id, stale.status AS previous_status
  `;
  for (const r of reclaimed as { id: string; previous_status: string }[]) {
    console.info(
      `[Lifecycle] ${JSON.stringify({
        reclaimPath: 'worker_lost',
        jobId: r.id,
        previousStatus: r.previous_status,
        newStatus: 'failed',
        reason: `heartbeat stale > ${RECLAIM_STALE_MINUTES}m`,
        worker: workerId,
        ts: new Date().toISOString(),
      })}`,
    );
  }

  // Defensive (no-regression): clear stale locks left on 'queued' jobs so they
  // remain claimable. No normal path leaves a queued job locked, but the prior
  // reclaim cleared these and we preserve that behavior.
  await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET locked_by = NULL, locked_at = NULL, updated_at = NOW()
    WHERE status = 'queued' AND locked_by IS NOT NULL
      AND locked_at < NOW() - INTERVAL '10 minutes'
  `;

  // Claim the next available queued job atomically
  const rows = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = NOW(),
        current_stage = 'segmentation',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM site_survey_geometry_reconstruction_jobs
      WHERE status = 'queued' AND locked_by IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
              current_stage, last_heartbeat_at, worker_version, stage_durations, failure_stage,
              locked_by, locked_at
  `;

  if (!rows.length) return null;

  const jobRow = rows[0] as unknown as JobRow;

  // Fetch artifacts for this job (likely empty for a queued job, but consistent)
  const artifactRows = await sql`
    SELECT id, job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority, created_at
    FROM site_survey_geometry_reconstruction_artifacts
    WHERE job_id = ${jobRow.id}
    ORDER BY created_at ASC
  `;

  const artifacts = (artifactRows as unknown as ArtifactRow[]).map(rowToArtifact);
  return rowToJob(jobRow, artifacts);
}

/**
 * Release the lock on a job (after completion or failure).
 * Sets locked_by = NULL, locked_at = NULL.
 * Best-effort — does not throw on failure.
 */
export async function releaseJobLock(
  jobId: string,
): Promise<void> {
  try {
    const sql = await getDbReady();
    await sql`
      UPDATE site_survey_geometry_reconstruction_jobs
      SET locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = ${jobId}
      RETURNING id
    `;
  } catch (err) {
    console.warn(
      '[geometryReconstruction] Failed to release lock for job=' + jobId + ':',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Requeue an interrupted job for retry (Priority 3 — Issue 1: deploy_retry).
 *
 * Used by the worker's graceful-shutdown path: when a deploy (SIGTERM) interrupts
 * an active job, requeue it instead of orphaning it. Resets status to 'queued',
 * clears the lock, heartbeat, current/failure stage, and DELETES the job's
 * partial recon artifacts so the retry starts clean (re-run cleanup happens at
 * completion otherwise, which a never-completing interrupted run would skip).
 *
 * Only acts on 'running'/'running_heartbeat' jobs. Returns the previous status
 * (for lifecycle observability) or null if no matching row was updated.
 */
export async function requeueJobForRetry(jobId: string): Promise<string | null> {
  const sql = await getDbReady();
  // Clear partial artifacts before retry (Issue 1 requirement).
  await deleteArtifactsByJob(jobId);
  const rows = await sql`
    WITH prev AS (
      SELECT id, status FROM site_survey_geometry_reconstruction_jobs WHERE id = ${jobId}::uuid
    )
    UPDATE site_survey_geometry_reconstruction_jobs j
    SET status = 'queued',
        locked_by = NULL,
        locked_at = NULL,
        last_heartbeat_at = NULL,
        current_stage = NULL,
        failure_stage = NULL,
        updated_at = NOW()
    FROM prev
    WHERE j.id = prev.id AND j.status IN ('running', 'running_heartbeat')
    RETURNING prev.status AS previous_status
  `;
  return rows.length ? (rows[0] as { previous_status: string }).previous_status : null;
}

/**
 * Find a specific queued job by ID and claim it for a worker.
 * Used when /start creates a job and wants a specific worker to pick it up.
 * Atomic CAS on locked_by IS NULL + status = 'queued'.
 */
export async function claimJobById(
  jobId: string,
  workerId: string,
): Promise<GeometryReconstructionJob | null> {
  const sql = await getDbReady();

  const rows = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = NOW(),
        current_stage = 'segmentation',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = ${jobId}
      AND status = 'queued'
      AND locked_by IS NULL
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at,
              current_stage, last_heartbeat_at, worker_version, stage_durations, failure_stage,
              locked_by, locked_at
  `;

  if (!rows.length) return null;

  const jobRow = rows[0] as unknown as JobRow;

  const artifactRows = await sql`
    SELECT id, job_id, survey_id, file_id, artifact_type, pipeline, payload, confidence, limitations, authority, created_at
    FROM site_survey_geometry_reconstruction_artifacts
    WHERE job_id = ${jobRow.id}
    ORDER BY created_at ASC
  `;

  const artifacts = (artifactRows as unknown as ArtifactRow[]).map(rowToArtifact);
  return rowToJob(jobRow, artifacts);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToJob(row: JobRow, artifacts: GeometryReconstructionArtifact[]): GeometryReconstructionJob {
  let parsedInput: GeometryReconstructionInput;
  try {
    parsedInput = typeof row.input === 'string' ? JSON.parse(row.input) : (row.input as GeometryReconstructionInput);
  } catch {
    parsedInput = { surveyId: row.survey_id, sourcePhotos: [], pipeline: 'mock' };
  }

  return {
    id: row.id,
    surveyId: row.survey_id,
    status: row.status as JobStatus,
    pipeline: row.pipeline,
    input: parsedInput,
    artifacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    currentStage: row.current_stage ?? null,
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    workerVersion: row.worker_version ?? null,
    stageDurations: row.stage_durations
      ? (typeof row.stage_durations === 'string'
          ? JSON.parse(row.stage_durations)
          : row.stage_durations) as Record<string, number>
      : null,
    failureStage: row.failure_stage ?? null,
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ?? null,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
  };
}

function rowToArtifact(row: ArtifactRow): GeometryReconstructionArtifact {
  let parsed: GeometryReconstructionArtifact;
  try {
    parsed = typeof row.payload === 'string'
      ? JSON.parse(row.payload)
      : (row.payload as GeometryReconstructionArtifact);
  } catch {
    // Fallback — should never happen but protects against corrupt data
    parsed = {
      artifactType: row.artifact_type as GeometryReconstructionArtifact['artifactType'],
      confidence: row.confidence,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: parseStringArray(row.limitations),
    } as unknown as GeometryReconstructionArtifact;
  }

  // Ensure authority is always review-only even if DB was somehow corrupted
  if (parsed && typeof parsed === 'object') {
    parsed.authority = REVIEW_ONLY_AUTHORITY;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Depth contradiction report persistence (P0-2.3)
// ---------------------------------------------------------------------------

/**
 * Check if Phase 0 depth contradiction DB persistence is enabled.
 * Controlled by PHASE0_DEPTH_CONTRADICTION_ENABLED environment variable.
 * When 'true' or '1', contradiction reports are persisted to the
 * site_survey_depth_contradiction_reports table.
 */
export function isPhase0DepthContradictionPersistenceEnabled(): boolean {
  const val = process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED ?? '';
  return val === 'true' || val === '1';
}

/** Row shape returned from the site_survey_depth_contradiction_reports table. */
export interface ContradictionReportRow {
  id: string;
  jobId: string;
  surveyId: string;
  segmentationClass: string;
  maskId: string;
  expectedRangeMin: number;
  expectedRangeMax: number;
  actualDepth: number;
  deviation: number;
  severity: string;
  confidencePenalty: number;
  description: string;
  createdAt: string;
}

/**
 * Batch-insert depth contradiction reports for a survey.
 *
 * Uses UNNEST for efficiency (same pattern as insertReconstructionArtifactsBatch).
 * Feature-flag controlled: if PHASE0_DEPTH_CONTRADICTION_ENABLED is not active,
 * returns immediately with { inserted: 0, failed: 0 }.
 *
 * Safe failure mode: writes are best-effort. If the insert fails, the error is
 * logged but NOT thrown — contradiction reports are diagnostic, and pipeline
 * results must never be lost due to a report persistence failure.
 *
 * Idempotency: before inserting, deletes any existing reports for the same
 * job_id + survey_id, so re-running the pipeline does not accumulate duplicates.
 */
export async function insertContradictionReports(
  jobId: string,
  surveyId: string,
  reports: DepthContradictionReport[],
): Promise<{ inserted: number; failed: number }> {
  if (!isPhase0DepthContradictionPersistenceEnabled()) {
    return { inserted: 0, failed: 0 };
  }
  if (reports.length === 0) {
    return { inserted: 0, failed: 0 };
  }

  const sql = await getDbReady();

  // Idempotency: delete existing reports for this job+survey before inserting
  try {
    await sql`
      DELETE FROM site_survey_depth_contradiction_reports
      WHERE job_id = ${jobId}::uuid AND survey_id = ${surveyId}::uuid
    `;
  } catch (delErr) {
    console.error(
      '[geometryReconstruction] Failed to delete existing contradiction reports before insert:',
      delErr instanceof Error ? delErr.message : String(delErr),
    );
    // Continue — the insert may still succeed if the delete failed due to a transient error
  }

  // Build parallel arrays for UNNEST insertion
  const jobIds: string[] = [];
  const surveyIds: string[] = [];
  const segmentationClasses: string[] = [];
  const maskIds: string[] = [];
  const expectedRangeMins: number[] = [];
  const expectedRangeMaxs: number[] = [];
  const actualDepths: number[] = [];
  const deviations: number[] = [];
  const severities: string[] = [];
  const confidencePenalties: number[] = [];
  const descriptions: string[] = [];

  for (const report of reports) {
    jobIds.push(jobId);
    surveyIds.push(surveyId);
    segmentationClasses.push(report.segmentationClass);
    maskIds.push(report.maskId);
    expectedRangeMins.push(report.expectedRange[0]);
    expectedRangeMaxs.push(report.expectedRange[1]);
    actualDepths.push(report.actualDepth);
    deviations.push(report.deviation);
    severities.push(report.severity);
    confidencePenalties.push(report.confidencePenalty);
    descriptions.push(report.description);
  }

  try {
    const result = await sql`
      INSERT INTO site_survey_depth_contradiction_reports (
        job_id, survey_id, segmentation_class, mask_id,
        expected_range_min, expected_range_max, actual_depth, deviation,
        severity, confidence_penalty, description
      )
      SELECT
        job_id, survey_id, segmentation_class, mask_id,
        expected_range_min, expected_range_max, actual_depth, deviation,
        severity, confidence_penalty, description
      FROM unnest(
        ${jobIds}::uuid[],
        ${surveyIds}::uuid[],
        ${segmentationClasses}::text[],
        ${maskIds}::text[],
        ${expectedRangeMins}::float8[],
        ${expectedRangeMaxs}::float8[],
        ${actualDepths}::float8[],
        ${deviations}::float8[],
        ${severities}::text[],
        ${confidencePenalties}::float8[],
        ${descriptions}::text[]
      ) AS t(job_id, survey_id, segmentation_class, mask_id,
             expected_range_min, expected_range_max, actual_depth, deviation,
             severity, confidence_penalty, description)
      RETURNING id
    `;

    return { inserted: result.length, failed: reports.length - result.length };
  } catch (err) {
    console.error(
      '[geometryReconstruction] Contradiction report batch insert failed:',
      err instanceof Error ? err.message : String(err),
    );
    // Safe failure: do NOT throw — reports are diagnostic, pipeline must continue
    return { inserted: 0, failed: reports.length };
  }
}

/**
 * Query depth contradiction reports by survey ID.
 * Returns reports ordered by severity DESC (major → moderate → minor → none),
 * then by deviation DESC (largest deviation first within same severity).
 */
export async function getContradictionReportsBySurvey(
  surveyId: string,
): Promise<ContradictionReportRow[]> {
  const sql = await getDbReady();

  try {
    const rows = await sql`
      SELECT
        id,
        job_id,
        survey_id,
        segmentation_class,
        mask_id,
        expected_range_min,
        expected_range_max,
        actual_depth,
        deviation,
        severity,
        confidence_penalty,
        description,
        created_at
      FROM site_survey_depth_contradiction_reports
      WHERE survey_id = ${surveyId}::uuid
      ORDER BY
        CASE severity
          WHEN 'major' THEN 0
          WHEN 'moderate' THEN 1
          WHEN 'minor' THEN 2
          WHEN 'none' THEN 3
          ELSE 4
        END ASC,
        deviation DESC
    `;

    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      surveyId: String(row.survey_id),
      segmentationClass: String(row.segmentation_class),
      maskId: String(row.mask_id),
      expectedRangeMin: Number(row.expected_range_min),
      expectedRangeMax: Number(row.expected_range_max),
      actualDepth: Number(row.actual_depth),
      deviation: Number(row.deviation),
      severity: String(row.severity),
      confidencePenalty: Number(row.confidence_penalty),
      description: String(row.description),
      createdAt: String(row.created_at),
    }));
  } catch (err) {
    console.error(
      '[geometryReconstruction] Failed to query contradiction reports for survey:',
      err instanceof Error ? err.message : String(err),
    );
    // Safe failure: return empty — caller should treat absence as "no reports"
    return [];
  }
}
