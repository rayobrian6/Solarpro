import { deterministicHash } from '@/lib/assistedEvidence';
import { generateOcrRuntimeCandidates } from './ocrRuntimeAdapter';
import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import type { AssistedEvidenceSourceContext } from './candidateAdapterTypes';

export interface OcrRuntimeSourceRef {
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
}

export interface OcrRuntimeBridgeInput {
  source: OcrRuntimeSourceRef;
  imageBytes: Uint8Array;
  toolRunId: string;
  toolConfigHash: string;
  createdAt: string;
  createdBy: string;
}

export interface OcrRuntimeBridgeResult {
  sourceContext: AssistedEvidenceSourceContext;
  sourceMetadataHash: string;
  candidates: AssistedEvidenceCandidate[];
  reusedExistingSurveySignals: {
    sourceOfTruth: 'site_surveys+site_survey_files';
    reusedUploadIdentity: boolean;
    reusedCategory: boolean;
    canonicalMutationAllowed: false;
  };
  omittedRuntimeSignals: string[];
}

export function buildOcrRuntimeSourceMetadataHash(source: OcrRuntimeSourceRef): string {
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
  });
}

function buildSourceContext(input: OcrRuntimeBridgeInput, sourceMetadataHash: string): AssistedEvidenceSourceContext {
  return {
    sourceFileId: input.source.siteSurveyFileId ?? input.source.evidenceId,
    sourceUploadKey: input.source.blobKey ?? input.source.fileUrl,
    projectId: input.source.projectId ?? 'unknown-project',
    surveyId: input.source.surveyId,
    toolRunId: input.toolRunId,
    toolConfigHash: input.toolConfigHash,
    sourceMetadataHash,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  };
}

function annotateOcrCandidate(candidate: AssistedEvidenceCandidate, source: OcrRuntimeSourceRef): AssistedEvidenceCandidate {
  return {
    ...candidate,
    candidatePayload: {
      ...candidate.candidatePayload,
      ocrRuntimeBridge: true,
      canonicalSourceOfTruth: source.canonicalSourceOfTruth,
      siteSurveyFileId: source.siteSurveyFileId,
      surveyEvidenceId: source.evidenceId,
      submittedCategory: source.submittedCategory,
      canonicalMutationAllowed: false,
      textOnlyEvidence: true,
    },
    candidateLimitations: [...new Set([
      ...candidate.candidateLimitations,
      'survey-ingestion-aligned',
      'canonical-survey-truth-preserved',
      'does-not-update-site-surveys',
      'does-not-update-site-survey-files',
      'does-not-update-project-physical-data',
      'does-not-infer-engineering-facts',
    ])].sort((a, b) => a.localeCompare(b)),
    provenance: {
      ...candidate.provenance,
      deterministicInputs: [...new Set([
        ...candidate.provenance.deterministicInputs,
        'site_surveys+site_survey_files-source-ref',
        'ocr-runtime-source-metadata-hash',
      ])].sort((a, b) => a.localeCompare(b)),
      notes: [...new Set([
        ...candidate.provenance.notes,
        'OCR runtime bridge preserved site_surveys+site_survey_files as canonical attachment truth.',
        'OCR text is non-authoritative and review-required; no engineering fact inference or canonical mutation is allowed.',
      ])].sort((a, b) => a.localeCompare(b)),
    },
  };
}

export async function generateSurveyIngestionOcrRuntimeCandidates(
  input: OcrRuntimeBridgeInput,
): Promise<OcrRuntimeBridgeResult> {
  const sourceMetadataHash = buildOcrRuntimeSourceMetadataHash(input.source);
  const sourceContext = buildSourceContext(input, sourceMetadataHash);
  const runtimeResult = await generateOcrRuntimeCandidates(sourceContext, input.imageBytes);
  const candidates = runtimeResult.candidates.map(candidate => annotateOcrCandidate(candidate, input.source));

  return {
    sourceContext,
    sourceMetadataHash,
    candidates,
    reusedExistingSurveySignals: {
      sourceOfTruth: input.source.canonicalSourceOfTruth,
      reusedUploadIdentity: Boolean(input.source.siteSurveyFileId || input.source.evidenceId),
      reusedCategory: input.source.submittedCategory !== null,
      canonicalMutationAllowed: false,
    },
    omittedRuntimeSignals: candidates.length === 0 ? ['ocr-runtime:no-text-extracted'] : [],
  };
}
