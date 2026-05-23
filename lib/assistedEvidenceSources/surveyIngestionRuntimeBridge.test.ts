import { describe, expect, it } from 'vitest';
import {
  buildSurveyIngestionRuntimeSourceMetadataHash,
  generateSurveyIngestionMetadataRuntimeCandidates,
} from './surveyIngestionRuntimeBridge';
import type { SurveyIngestionRuntimeSourceRef } from './surveyIngestionRuntimeBridge';

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84, 8, 153, 99, 248, 207, 192, 0, 0,
  3, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

const source: SurveyIngestionRuntimeSourceRef = {
  surveyId: 'site-survey-runtime-1',
  projectId: 'project-runtime-1',
  siteSurveyFileId: 'site-survey-file-1',
  evidenceId: 'survey-evidence-1',
  fileUrl: 'https://blob.example/surveys/project-runtime-1/site-survey-runtime-1/roof_overview/photo.png',
  blobKey: 'surveys/project-runtime-1/site-survey-runtime-1/roof_overview/photo.png',
  filename: 'roof-overview-1.png',
  mimeType: 'image/png',
  submittedCategory: 'roof_overview',
  canonicalSourceOfTruth: 'site_surveys+site_survey_files',
  existingImageMetadata: {
    widthPx: null,
    heightPx: null,
    orientation: null,
  },
  existingQuality: {
    blurScore: null,
    duplicateScore: null,
    warnings: [],
  },
};

const bridgeInput = {
  source,
  imageBytes: onePixelPng,
  toolRunId: 'survey-runtime-bridge-run-1',
  toolConfigHash: 'survey-runtime-bridge-config-v1',
  createdAt: '2025-04-01T00:00:00.000Z',
  createdBy: 'survey-runtime-bridge-test',
};

describe('survey ingestion runtime bridge', () => {
  it('builds a deterministic source metadata hash from existing survey attachment identity', () => {
    const first = buildSurveyIngestionRuntimeSourceMetadataHash(source);
    const second = buildSurveyIngestionRuntimeSourceMetadataHash({
      ...source,
      existingQuality: { ...source.existingQuality, warnings: [...source.existingQuality.warnings].reverse() },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reuses existing survey ingestion identity and category without creating a parallel truth path', async () => {
    const result = await generateSurveyIngestionMetadataRuntimeCandidates(bridgeInput);

    expect(result.sourceContext.sourceFileId).toBe(source.siteSurveyFileId);
    expect(result.sourceContext.sourceUploadKey).toBe(source.blobKey);
    expect(result.sourceContext.sourceMetadataHash).toBe(buildSurveyIngestionRuntimeSourceMetadataHash(source));
    expect(result.reusedExistingSurveySignals).toEqual({
      sourceOfTruth: 'site_surveys+site_survey_files',
      reusedUploadIdentity: true,
      reusedCategory: true,
      reusedExistingImageMetadata: false,
      reusedExistingBlurScore: false,
      reusedExistingDuplicateScore: false,
      canonicalMutationAllowed: false,
    });
  });

  it('omits blur candidates when existing survey ingestion has no blur score to reuse', async () => {
    const result = await generateSurveyIngestionMetadataRuntimeCandidates(bridgeInput);

    expect(result.omittedRuntimeSignals).toContain('possible_blurry_photo:no-existing-blur-score-to-reuse');
    expect(result.candidates.map(candidate => candidate.candidatePayload.field)).not.toContain('possible_blurry_photo');
  });

  it('generates stable review-required runtime candidates with survey provenance annotations', async () => {
    const first = await generateSurveyIngestionMetadataRuntimeCandidates(bridgeInput);
    const second = await generateSurveyIngestionMetadataRuntimeCandidates(bridgeInput);

    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));

    for (const candidate of first.candidates) {
      expect(candidate.candidateStatus).toBe('review_required');
      expect(candidate.nonAuthoritative).toBe(true);
      expect(candidate.reviewRequired).toBe(true);
      expect(candidate.candidatePayload.runtimePilot).toBe(true);
      expect(candidate.candidatePayload.surveyRuntimeBridge).toBe(true);
      expect(candidate.candidatePayload.canonicalSourceOfTruth).toBe('site_surveys+site_survey_files');
      expect(candidate.candidatePayload.siteSurveyFileId).toBe(source.siteSurveyFileId);
      expect(candidate.candidatePayload.surveyEvidenceId).toBe(source.evidenceId);
      expect(candidate.candidatePayload.canonicalMutationAllowed).toBe(false);
      expect(candidate.candidateLimitations).toContain('survey-ingestion-aligned');
      expect(candidate.candidateLimitations).toContain('canonical-survey-truth-preserved');
      expect(candidate.candidateLimitations).toContain('does-not-update-site-surveys');
      expect(candidate.candidateLimitations).toContain('does-not-update-site-survey-files');
      expect(candidate.provenance.deterministicInputs).toContain('site_surveys+site_survey_files-source-ref');
      expect(candidate.provenance.notes.join(' ')).toContain('preserved site_surveys+site_survey_files as canonical attachment truth');
    }
  });

  it('keeps survey-aligned runtime candidates out of canonical, CAD, recommendation, and workflow authority', async () => {
    const result = await generateSurveyIngestionMetadataRuntimeCandidates(bridgeInput);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/buildSurveyEvidenceManifest|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration/);
    expect(result.candidates.every(candidate => candidate.candidatePayload.canonicalMutationAllowed === false)).toBe(true);
    expect(result.candidates.every(candidate => candidate.candidateStatus === 'review_required')).toBe(true);
  });
});
