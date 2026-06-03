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
        -- Neon driver can't pass 2D arrays; each limitations element is a text[]
        -- literal string like '{"a","b"}' which we cast back to text[] here.
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
      )
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

  // First, reclaim any stale locks (locked_at > 10 min ago, still 'queued' or 'running')
  await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
    WHERE locked_by IS NOT NULL
      AND locked_at < NOW() - INTERVAL '10 minutes'
      AND status IN ('queued', 'running')
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
