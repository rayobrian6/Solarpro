// ============================================================================
// lib/survey/getProjectSurveyContext.ts
//
// Single server-side data function that assembles everything the survey UI
// needs for a project. This is the ONLY data source Phase 3 UI reads from.
//
// Returns:
//   - surveys:  SiteSurvey[]            — all surveys for the project (newest first)
//   - latest:   SiteSurvey | null       — most recent survey
//   - files:    SiteSurveyFile[]        — files for the latest survey
//   - payload:  SurveyV2Payload | null  — typed payload from latest.surveyData
//
// No schema changes. No ingest changes. Pure read path.
// ============================================================================

import {
  getSiteSurveysByProject,
  getSiteSurveyById,
  getSiteSurveyFiles,
  type SiteSurvey,
  type SiteSurveyFile,
} from '@/lib/db-neon';
import type { SurveyV2Payload } from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface ProjectSurveyContext {
  /** All surveys for this project, newest first */
  surveys: SiteSurvey[];
  /** Most recent survey, or null if none */
  latest: SiteSurvey | null;
  /** Files (photos) for the latest survey */
  files: SiteSurveyFile[];
  /**
   * Typed SurveyV2Payload from latest.surveyData, if schemaVersion === '2.0'.
   * Null for v1.0 / partner payloads or if no survey exists.
   */
  payload: SurveyV2Payload | null;
}

// ---------------------------------------------------------------------------
// Detail context for a specific survey (used by survey detail page)
// ---------------------------------------------------------------------------

export interface SurveyDetailContext {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
  payload: SurveyV2Payload | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractV2Payload(survey: SiteSurvey): SurveyV2Payload | null {
  const data = survey.surveyData;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== '2.0') return null;
  return d as unknown as SurveyV2Payload;
}

// ---------------------------------------------------------------------------
// getProjectSurveyContext — all surveys + latest detail
// ---------------------------------------------------------------------------

export async function getProjectSurveyContext(
  projectId: string,
  userId: string,
): Promise<ProjectSurveyContext> {
  const surveys = await getSiteSurveysByProject(projectId, userId);

  if (surveys.length === 0) {
    return { surveys: [], latest: null, files: [], payload: null };
  }

  const latest = surveys[0]; // getSiteSurveysByProject returns newest first
  const files   = await getSiteSurveyFiles(latest.id);
  const payload = extractV2Payload(latest);

  return { surveys, latest, files, payload };
}

// ---------------------------------------------------------------------------
// getSurveyDetailContext — single survey + files (used by detail page)
// ---------------------------------------------------------------------------

export async function getSurveyDetailContext(
  surveyId: string,
  userId: string,
): Promise<SurveyDetailContext | null> {
  const [survey, files] = await Promise.all([
    getSiteSurveyById(surveyId, userId),
    getSiteSurveyFiles(surveyId),
  ]);

  if (!survey) return null;

  const payload = extractV2Payload(survey);
  return { survey, files, payload };
}