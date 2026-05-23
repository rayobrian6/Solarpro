// Neutral survey evidence session/duplicate DTO types shared by hygiene grouping
// and provenance. This module must remain leaf-level: it prevents provenance ↔
// sessionGrouping builder cycles while preserving immutable survey-history and
// canonical-evidence truth boundaries.

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import type { SurveyEvidenceCategory } from './manifest';

export type SurveySessionDuplicateStatus = 'canonical' | 'overlapping_duplicate' | 'unique' | 'unknown';
export type EvidenceDuplicateStatus = 'canonical' | 'duplicate' | 'unique';

export interface SurveyFilesBySurveyId {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
}

export interface SurveySessionDuplicateGroup {
  surveySessionGroupId: string;
  canonicalSurveyId: string;
  surveyIds: string[];
  duplicateCount: number;
  duplicateReason: string;
  statusBySurveyId: Record<string, SurveySessionDuplicateStatus>;
  rawPhotoCount: number;
  canonicalEvidenceCount: number;
  similarCategoryCoverage: SurveyEvidenceCategory[];
}

export interface SurveySessionSummary {
  surveyId: string;
  surveySessionGroupId: string;
  surveySessionDuplicateStatus: SurveySessionDuplicateStatus;
  isCanonical: boolean;
  submittedAt: string | null;
  technician: string | null;
  source: SiteSurvey['source'];
  rawPhotoCount: number;
  canonicalEvidenceCount: number;
  categoryCoverage: SurveyEvidenceCategory[];
  duplicateReason: string | null;
}

export interface EvidenceDuplicateGroup {
  evidenceDuplicateGroupId: string;
  canonicalEvidenceId: string;
  canonicalSurveyId: string;
  evidenceIds: string[];
  surveyIds: string[];
  duplicateCount: number;
  duplicateReason: string;
  category: SurveyEvidenceCategory;
  rawUploadCount: number;
}
