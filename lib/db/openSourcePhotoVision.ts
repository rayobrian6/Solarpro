/**
 * Review-only open-source photo vision candidate persistence.
 *
 * These helpers store operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, project_physical_data, permit input,
 * BOM input, or engineering workflow state.
 */

import { getDbReady } from './core';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionRunResult,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import {
  OPEN_SOURCE_PHOTO_VISION_TOOL_NAME,
  OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

export type OpenSourcePhotoVisionReviewStatus = 'review_required' | 'accepted_review_reference' | 'rejected';

export interface StoredOpenSourcePhotoVisionCandidate {
  id: string;
  surveyId: string;
  fileId: string;
  toolName: string;
  toolVersion: string;
  runHash: string;
  candidateType: string;
  candidateCategory: string;
  payload: Record<string, unknown>;
  confidence: number;
  limitations: string[];
  reviewStatus: OpenSourcePhotoVisionReviewStatus;
  deterministicHash: string;
  thumbnailDataUrl: string | null;
  createdAt: string;
}

export interface OpenSourcePhotoVisionStoredBundle {
  schemaVersion: 'open_source_photo_vision_stored_bundle_v1';
  surveyId: string;
  toolName: string;
  toolVersion: string;
  candidateCount: number;
  latestRunHash: string | null;
  candidates: StoredOpenSourcePhotoVisionCandidate[];
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    canonicalMutationAllowed: false;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
    engineeringWorkflowMutationAllowed: false;
  };
  limitations: string[];
}

export async function replaceOpenSourcePhotoVisionCandidatesForSurveyRun(
  surveyId: string,
  userId: string,
  run: OpenSourcePhotoVisionRunResult,
): Promise<OpenSourcePhotoVisionStoredBundle> {
  const sql = await getDbReady();

  const authRows = await sql`
    SELECT ss.id
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    WHERE ss.id = ${surveyId}
    LIMIT 1
  `;
  if (!authRows.length) throw new Error('Survey not found or not authorized for OSS photo vision persistence.');

  await sql`
    DELETE FROM open_source_photo_vision_candidates
    WHERE survey_id = ${surveyId}
      AND run_hash = ${run.runHash}
      AND tool_name = ${run.toolName}
      AND tool_version = ${run.toolVersion}
  `;

  const thumbnailByFileId = new Map<string, string | null>(run.files.map(file => [file.fileId, file.thumbnailDataUrl]));

  for (const candidate of run.candidates) {
    await sql`
      INSERT INTO open_source_photo_vision_candidates (
        id,
        survey_id,
        file_id,
        tool_name,
        tool_version,
        run_hash,
        candidate_type,
        candidate_category,
        payload,
        confidence,
        limitations,
        review_status,
        deterministic_hash,
        thumbnail_data_url,
        created_at
      ) VALUES (
        ${candidate.candidateId},
        ${surveyId},
        ${candidate.fileId},
        ${candidate.toolName},
        ${candidate.toolVersion},
        ${candidate.runHash},
        ${candidate.candidateType},
        ${candidate.candidateCategory},
        ${JSON.stringify(withCandidateGeometry(candidate))},
        ${candidate.confidence},
        ${JSON.stringify(candidate.limitations)},
        ${candidate.reviewStatus},
        ${candidate.deterministicHash},
        ${thumbnailByFileId.get(candidate.fileId) ?? null},
        ${candidate.createdAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        payload = EXCLUDED.payload,
        confidence = EXCLUDED.confidence,
        limitations = EXCLUDED.limitations,
        review_status = EXCLUDED.review_status,
        thumbnail_data_url = EXCLUDED.thumbnail_data_url,
        created_at = EXCLUDED.created_at
    `;
  }

  return getOpenSourcePhotoVisionCandidatesBySurvey(surveyId, userId);
}

export async function getOpenSourcePhotoVisionCandidatesBySurvey(
  surveyId: string,
  userId: string,
): Promise<OpenSourcePhotoVisionStoredBundle> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT ospv.*
    FROM open_source_photo_vision_candidates ospv
    JOIN site_surveys ss ON ss.id = ospv.survey_id
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    WHERE ospv.survey_id = ${surveyId}
    ORDER BY ospv.created_at DESC, ospv.id ASC
  `;

  const candidates = (rows as Record<string, unknown>[]).map(rowToStoredCandidate);
  return buildStoredBundle(surveyId, candidates);
}

export function buildTransientOpenSourcePhotoVisionBundle(run: OpenSourcePhotoVisionRunResult): OpenSourcePhotoVisionStoredBundle {
  const thumbnailByFileId = new Map<string, string | null>(run.files.map(file => [file.fileId, file.thumbnailDataUrl]));
  const candidates = run.candidates.map(candidate => ({
    id: candidate.candidateId,
    surveyId: candidate.surveyId,
    fileId: candidate.fileId,
    toolName: candidate.toolName,
    toolVersion: candidate.toolVersion,
    runHash: candidate.runHash,
    candidateType: candidate.candidateType,
    candidateCategory: candidate.candidateCategory,
    payload: withCandidateGeometry(candidate),
    confidence: candidate.confidence,
    limitations: candidate.limitations,
    reviewStatus: candidate.reviewStatus,
    deterministicHash: candidate.deterministicHash,
    thumbnailDataUrl: thumbnailByFileId.get(candidate.fileId) ?? null,
    createdAt: candidate.createdAt,
  } satisfies StoredOpenSourcePhotoVisionCandidate));
  return buildStoredBundle(run.surveyId, candidates);
}

export function summarizeOpenSourcePhotoVisionRun(run: OpenSourcePhotoVisionRunResult) {
  const candidateTypeCounts: Record<string, number> = {};
  for (const candidate of run.candidates) {
    candidateTypeCounts[candidate.candidateType] = (candidateTypeCounts[candidate.candidateType] ?? 0) + 1;
  }
  return {
    schemaVersion: run.schemaVersion,
    surveyId: run.surveyId,
    toolName: run.toolName,
    toolVersion: run.toolVersion,
    runHash: run.runHash,
    processedCount: run.processedCount,
    failedCount: run.failedCount,
    candidateCount: run.candidateCount,
    candidateTypeCounts,
    availability: run.availability,
    authority: run.authority,
    limitations: run.limitations,
  };
}

function buildStoredBundle(surveyId: string, candidates: StoredOpenSourcePhotoVisionCandidate[]): OpenSourcePhotoVisionStoredBundle {
  return {
    schemaVersion: 'open_source_photo_vision_stored_bundle_v1',
    surveyId,
    toolName: candidates[0]?.toolName ?? OPEN_SOURCE_PHOTO_VISION_TOOL_NAME,
    toolVersion: candidates[0]?.toolVersion ?? OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION,
    candidateCount: candidates.length,
    latestRunHash: candidates[0]?.runHash ?? null,
    candidates,
    authority: noAuthority(),
    limitations: baseLimitations(),
  };
}

function rowToStoredCandidate(row: Record<string, unknown>): StoredOpenSourcePhotoVisionCandidate {
  return {
    id: row.id as string,
    surveyId: row.survey_id as string,
    fileId: row.file_id as string,
    toolName: row.tool_name as string,
    toolVersion: row.tool_version as string,
    runHash: row.run_hash as string,
    candidateType: row.candidate_type as string,
    candidateCategory: row.candidate_category as string,
    payload: parseJsonRecord(row.payload),
    confidence: Number(row.confidence),
    limitations: parseStringArray(row.limitations),
    reviewStatus: row.review_status as OpenSourcePhotoVisionReviewStatus,
    deterministicHash: row.deterministic_hash as string,
    thumbnailDataUrl: (row.thumbnail_data_url as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function withCandidateGeometry(candidate: OpenSourcePhotoVisionCandidate): Record<string, unknown> {
  return {
    ...candidate.payload,
    summary: candidate.summary,
    region: candidate.region ?? null,
    line: candidate.line ?? null,
    reviewOnlyLabel: 'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    sourceFileUrl: candidate.fileUrl,
    sourceFilename: candidate.filename,
    sourceToolName: candidate.toolName,
    sourceToolVersion: candidate.toolVersion,
    sourceRunHash: candidate.runHash,
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

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

function baseLimitations(): string[] {
  return [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'Stored candidates are operator review aids only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
  ];
}

function noAuthority() {
  return {
    reviewOnly: true as const,
    nonAuthoritative: true as const,
    canonicalMutationAllowed: false as const,
    cadMutationAllowed: false as const,
    permitGenerationAllowed: false as const,
    bomMutationAllowed: false as const,
    engineeringWorkflowMutationAllowed: false as const,
  };
}

export type { OpenSourcePhotoVisionFileResult };
