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
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at
  `;

  const row = rows[0] as unknown as JobRow;
  return rowToJob(row, []);
}

/** Get a reconstruction job by ID. */
export async function getReconstructionJobById(jobId: string): Promise<GeometryReconstructionJob | null> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, survey_id, status, pipeline, input, created_at, updated_at, completed_at
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
    RETURNING id, survey_id, status, pipeline, input, created_at, updated_at, completed_at
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
      ${JSON.stringify(artifact.limitations)},
      ${JSON.stringify(artifact.authority)}
    )
  `;
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
           current_stage, last_heartbeat_at, worker_version
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
