import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  buildOcrRuntimeSourceMetadataHash,
  generateSurveyIngestionOcrRuntimeCandidates,
  getRegisteredOpenSourceTool,
  ocrRuntimeAdapter,
  validateOpenSourceToolDefinition,
} from './index';
import {
  acceptCandidate,
  candidateCanCreateWorkflowItems,
  candidateCanInfluenceCADReadiness,
  candidateCanInfluenceRecommendations,
  candidateCanSatisfyRequirement,
  projectionAutomaticallyMutatesCanonicalEvidence,
} from '@/lib/assistedEvidence';
import type { OcrRuntimePayload, OcrRuntimeSourceRef, AssistedEvidenceSourceContext } from './index';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'ocr-runtime-file-1',
  sourceUploadKey: 'uploads/project-ocr/survey-ocr/equipment-label.jpg',
  projectId: 'project-ocr',
  surveyId: 'survey-ocr',
  toolRunId: 'ocr-runtime-run-1',
  toolConfigHash: 'ocr-runtime-config-hash-1',
  sourceMetadataHash: 'ocr-runtime-source-metadata-hash-1',
  createdAt: '2025-05-01T00:00:00.000Z',
  createdBy: 'ocr-runtime-test-suite',
};

const runtimePayload: OcrRuntimePayload = {
  runtimePayloadHash: 'ocr-runtime-payload-hash-1',
  inputByteLength: 1234,
  method: 'tesseract-js',
  confidence: 0.42,
  text: 'MAIN PANEL 200A\nMETER 12345',
  textLength: 26,
  textLineCount: 2,
  derivedSignals: [
    {
      signalId: 'ocr-runtime-text-region-1',
      field: 'possible_equipment_label_text',
      text: 'MAIN PANEL 200A\nMETER 12345',
      confidence: 0.42,
      limitationRefs: ['ocr-text-only', 'test-runtime-payload'],
    },
  ],
};

const source: OcrRuntimeSourceRef = {
  surveyId: 'site-survey-ocr-1',
  projectId: 'project-ocr-1',
  siteSurveyFileId: 'site-survey-file-ocr-1',
  evidenceId: 'survey-evidence-ocr-1',
  fileUrl: 'https://blob.example/surveys/project-ocr-1/site-survey-ocr-1/equipment/photo.jpg',
  blobKey: 'surveys/project-ocr-1/site-survey-ocr-1/equipment/photo.jpg',
  filename: 'equipment-label.jpg',
  mimeType: 'image/jpeg',
  submittedCategory: 'equipment_label',
  canonicalSourceOfTruth: 'site_surveys+site_survey_files',
};

describe('Controlled OCR runtime adapter pilot', () => {
  it('registers tesseract.js as a review-only text-region runtime', () => {
    const tool = getRegisteredOpenSourceTool('tesseract-js-ocr-runtime', '7.0.0');
    expect(tool.license).toBe('Apache-2.0');
    expect(tool.licensePosture).toBe('approved');
    expect(tool.runtimeCategory).toBe('ocr_text_candidate');
    expect(tool.allowedCandidateTypes).toEqual(['text_region_candidate']);
    expect(tool.allowedCandidateCategories).toEqual(['field_context', 'electrical_context']);
    expect(tool.allowedRuntimeBoundary).toBe('server_adapter_contract');
    expect(tool.enabledStatus).toBe('enabled_for_runtime_pilot');
    expect(tool.reviewRequired).toBe(true);
    expect(tool.canonicalMutationAllowed).toBe(false);
    expect(tool.requiresModelWeights).toBe(false);
    expect(tool.serverOnly).toBe(true);
  });

  it('rejects unsafe OCR registry definitions', () => {
    const tool = getRegisteredOpenSourceTool('tesseract-js-ocr-runtime', '7.0.0');
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'ocr-canonical', canonicalMutationAllowed: true as false })).toThrow(/canonical mutation/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'ocr-model', requiresModelWeights: true })).toThrow(/model weights/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'ocr-browser', browserCompatible: true })).toThrow(/browser/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'ocr-scene', allowedCandidateTypes: ['electrical_scene_candidate'] })).toThrow(/text_region_candidate only/i);
  });

  it('normalizes OCR payloads into text-only review-required candidates without confidence upgrades', () => {
    const tool = getRegisteredOpenSourceTool('tesseract-js-ocr-runtime', '7.0.0');
    const result = ocrRuntimeAdapter.generateCandidates({ tool, sourceContext, rawPayload: runtimePayload });

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.candidateType).toBe('text_region_candidate');
    expect(candidate.candidateCategory).toBe('electrical_context');
    expect(candidate.candidateStatus).toBe('review_required');
    expect(candidate.nonAuthoritative).toBe(true);
    expect(candidate.reviewRequired).toBe(true);
    expect(candidate.candidateConfidence).toBe(0.42);
    expect(candidate.candidatePayload.field).toBe('possible_equipment_label_text');
    expect(candidate.candidatePayload.possibleText).toBe('MAIN PANEL 200A\nMETER 12345');
    expect(candidate.candidatePayload.runtimeSource).toBe('tesseract-js-ocr-runtime');
    expect(candidate.candidatePayload.runtimePilot).toBe(true);
    expect(candidate.candidatePayload.canonicalMutationAllowed).toBe(false);
    expect(candidate.candidatePayload.textOnlyEvidence).toBe(true);
    expect(candidate.candidateLimitations).toContain('runtime-ocr-text-only');
    expect(candidate.candidateLimitations).toContain('no-engineering-authority');
    expect(candidate.candidateLimitations).toContain('does-not-confirm-panel-rating');
    expect(candidate.candidateLimitations).toContain('does-not-set-breaker-size');
    expect(candidate.candidateLimitations).toContain('does-not-satisfy-requirements');
    expect(candidate.provenance.notes.join(' ')).toContain('Controlled OCR runtime pilot output');
  });

  it('rejects empty OCR safely without generating candidates', async () => {
    const payload = await ocrRuntimeAdapter.extractRuntimePayload(new Uint8Array());
    const tool = getRegisteredOpenSourceTool('tesseract-js-ocr-runtime', '7.0.0');
    const result = ocrRuntimeAdapter.generateCandidates({ tool, sourceContext, rawPayload: payload });

    expect(payload.method).toBe('none');
    expect(payload.text).toBe('');
    expect(payload.derivedSignals).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  it('builds deterministic survey-source OCR hashes and preserves survey attachment identity', async () => {
    const firstHash = buildOcrRuntimeSourceMetadataHash(source);
    const secondHash = buildOcrRuntimeSourceMetadataHash({ ...source });
    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);

    const result = await generateSurveyIngestionOcrRuntimeCandidates({
      source,
      imageBytes: new Uint8Array(),
      toolRunId: 'ocr-runtime-bridge-run-1',
      toolConfigHash: 'ocr-runtime-bridge-config-v1',
      createdAt: '2025-05-02T00:00:00.000Z',
      createdBy: 'ocr-runtime-bridge-test',
    });

    expect(result.sourceContext.sourceFileId).toBe(source.siteSurveyFileId);
    expect(result.sourceContext.sourceUploadKey).toBe(source.blobKey);
    expect(result.reusedExistingSurveySignals).toEqual({
      sourceOfTruth: 'site_surveys+site_survey_files',
      reusedUploadIdentity: true,
      reusedCategory: true,
      canonicalMutationAllowed: false,
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.omittedRuntimeSignals).toEqual(['ocr-runtime:no-text-extracted']);
  });

  it('keeps OCR candidates and reviewed projections out of requirement, CAD, recommendation, workflow, and canonical authority', () => {
    const tool = getRegisteredOpenSourceTool('tesseract-js-ocr-runtime', '7.0.0');
    const candidate = ocrRuntimeAdapter.generateCandidates({ tool, sourceContext, rawPayload: runtimePayload }).candidates[0];

    expect(candidateCanSatisfyRequirement(candidate)).toBe(false);
    expect(candidateCanInfluenceCADReadiness(candidate)).toBe(false);
    expect(candidateCanInfluenceRecommendations(candidate)).toBe(false);
    expect(candidateCanCreateWorkflowItems(candidate)).toBe(false);

    const accepted = acceptCandidate(candidate, {
      reviewerId: 'ocr-reviewer-1',
      reviewedAt: '2025-05-03T00:00:00.000Z',
      acceptedFields: ['possible_equipment_label_text'],
      reviewNotes: ['Accepted text transcription for future mapping review only.'],
    });
    expect(accepted.projection.projectionPayload).toEqual({ possible_equipment_label_text: 'MAIN PANEL 200A\nMETER 12345' });
    expect(accepted.projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projectionAutomaticallyMutatesCanonicalEvidence(accepted.projection)).toBe(false);
  });

  it('passes the assisted evidence boundary guard with OCR runtime import containment', () => {
    const output = execFileSync('npm', ['run', 'check:assisted-evidence-boundaries'], { encoding: 'utf8' });
    expect(output).toContain('Assisted evidence boundary guard passed');
  });
});
