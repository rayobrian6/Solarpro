import { deterministicHash } from '@/lib/assistedEvidence';
import { generateMetadataRuntimeCandidates } from './metadataRuntimeAdapter';
import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import type { AssistedEvidenceSourceContext } from './candidateAdapterTypes';

export interface SurveyIngestionRuntimeSourceRef {
  surveyId: string;
  projectId: string | null;
  siteSurveyFileId: string | null;
  evidenceId: string;
  fileUrl: string;
  blobKey: string | null;
  filename: string | null;
  mimeType: string | null;
  submittedCategory: string | null;
  canonicalSourceOfTruth: 'site_surveys+site_survey_files';
  existingImageMetadata: {
    widthPx: number | null;
    heightPx: number | null;
    orientation: string | null;
  };
  existingQuality: {
    blurScore: number | null;
    duplicateScore: number | null;
    warnings: readonly string[];
  };
}

export interface SurveyIngestionRuntimeBridgeInput {
  source: SurveyIngestionRuntimeSourceRef;
  imageBytes: Uint8Array;
  toolRunId: string;
  toolConfigHash: string;
  createdAt: string;
  createdBy: string;
}

export interface SurveyIngestionRuntimeBridgeResult {
  sourceContext: AssistedEvidenceSourceContext;
  sourceMetadataHash: string;
  candidates: AssistedEvidenceCandidate[];
  reusedExistingSurveySignals: {
    sourceOfTruth: 'site_surveys+site_survey_files';
    reusedUploadIdentity: boolean;
    reusedCategory: boolean;
    reusedExistingImageMetadata: boolean;
    reusedExistingBlurScore: boolean;
    reusedExistingDuplicateScore: boolean;
    canonicalMutationAllowed: false;
  };
  omittedRuntimeSignals: string[];
}

function sortedWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)].sort((a, b) => a.localeCompare(b));
}

export function buildSurveyIngestionRuntimeSourceMetadataHash(source: SurveyIngestionRuntimeSourceRef): string {
  return deterministicHash({
    surveyId: source.surveyId,
    projectId: source.projectId,
    siteSurveyFileId: source.siteSurveyFileId,
    evidenceId: source.evidenceId,
    fileUrl: source.fileUrl,
    blobKey: source.blobKey,
    filename: source.filename,
    mimeType: source.mimeType,
    submittedCategory: source.submittedCategory,
    canonicalSourceOfTruth: source.canonicalSourceOfTruth,
    existingImageMetadata: source.existingImageMetadata,
    existingQuality: {
      ...source.existingQuality,
      warnings: sortedWarnings(source.existingQuality.warnings),
    },
  });
}

function buildSourceContext(input: SurveyIngestionRuntimeBridgeInput, sourceMetadataHash: string): AssistedEvidenceSourceContext {
  return {
    sourceFileId: input.source.siteSurveyFileId ?? input.source.evidenceId,
    sourceUploadKey: input.source.blobKey ?? input.source.fileUrl,
    projectId: input.source.projectId ?? 'unlinked-survey-project',
    surveyId: input.source.surveyId,
    toolRunId: input.toolRunId,
    toolConfigHash: input.toolConfigHash,
    sourceMetadataHash,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  };
}

function annotateSurveyIngestionCandidate(candidate: AssistedEvidenceCandidate, source: SurveyIngestionRuntimeSourceRef): AssistedEvidenceCandidate {
  return {
    ...candidate,
    candidatePayload: {
      ...candidate.candidatePayload,
      surveyRuntimeBridge: true,
      canonicalSourceOfTruth: source.canonicalSourceOfTruth,
      surveyEvidenceId: source.evidenceId,
      siteSurveyFileId: source.siteSurveyFileId,
      submittedCategory: source.submittedCategory,
      existingImageMetadata: source.existingImageMetadata,
      existingQuality: {
        ...source.existingQuality,
        warnings: sortedWarnings(source.existingQuality.warnings),
      },
      canonicalMutationAllowed: false,
    },
    candidateLimitations: [...new Set([
      ...candidate.candidateLimitations,
      'survey-ingestion-aligned',
      'canonical-survey-truth-preserved',
      'does-not-update-site-surveys',
      'does-not-update-site-survey-files',
    ])].sort((a, b) => a.localeCompare(b)),
    provenance: {
      ...candidate.provenance,
      deterministicInputs: [...new Set([
        ...candidate.provenance.deterministicInputs,
        'site_surveys+site_survey_files-source-ref',
        source.evidenceId,
      ])].sort((a, b) => a.localeCompare(b)),
      notes: [...new Set([
        ...candidate.provenance.notes,
        'Survey ingestion alignment bridge preserved site_surveys+site_survey_files as canonical attachment truth.',
        'Runtime candidates are review-only and leave survey evidence image and quality fields unchanged.',
      ])].sort((a, b) => a.localeCompare(b)),
    },
  };
}

export async function generateSurveyIngestionMetadataRuntimeCandidates(
  input: SurveyIngestionRuntimeBridgeInput,
): Promise<SurveyIngestionRuntimeBridgeResult> {
  const sourceMetadataHash = buildSurveyIngestionRuntimeSourceMetadataHash(input.source);
  const sourceContext = buildSourceContext(input, sourceMetadataHash);
  const runtimeResult = await generateMetadataRuntimeCandidates(sourceContext, input.imageBytes);
  const candidates = runtimeResult.candidates.map(candidate => annotateSurveyIngestionCandidate(candidate, input.source));

  return {
    sourceContext,
    sourceMetadataHash,
    candidates,
    reusedExistingSurveySignals: {
      sourceOfTruth: input.source.canonicalSourceOfTruth,
      reusedUploadIdentity: Boolean(input.source.siteSurveyFileId || input.source.evidenceId),
      reusedCategory: input.source.submittedCategory !== null,
      reusedExistingImageMetadata: input.source.existingImageMetadata.widthPx !== null
        || input.source.existingImageMetadata.heightPx !== null
        || input.source.existingImageMetadata.orientation !== null,
      reusedExistingBlurScore: input.source.existingQuality.blurScore !== null,
      reusedExistingDuplicateScore: input.source.existingQuality.duplicateScore !== null,
      canonicalMutationAllowed: false,
    },
    omittedRuntimeSignals: [
      ...(input.source.existingQuality.blurScore === null ? ['possible_blurry_photo:no-existing-blur-score-to-reuse'] : []),
    ],
  };
}
