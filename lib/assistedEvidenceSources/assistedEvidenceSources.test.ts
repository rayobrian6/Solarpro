import { describe, expect, it } from 'vitest';
import {
  classifyLicensePosture,
  generateMetadataFixtureCandidates,
  generateOcrFixtureCandidates,
  getRegisteredOpenSourceTool,
  normalizeCandidateConfidence,
  validateOpenSourceToolDefinition,
} from './index';
import type { AssistedEvidenceSourceContext, MetadataFixturePayload, OcrFixturePayload } from './index';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'fixture-source-file-1',
  sourceUploadKey: 'uploads/project-fixture/survey-fixture/source-file-1.jpg',
  projectId: 'project-fixture',
  surveyId: 'survey-fixture',
  toolRunId: 'fixture-run-1',
  toolConfigHash: 'fixture-config-hash-1',
  sourceMetadataHash: 'fixture-source-metadata-hash-1',
  createdAt: '2025-02-01T00:00:00.000Z',
  createdBy: 'fixture-test-suite',
};

const metadataPayload: MetadataFixturePayload = {
  fixtureId: 'metadata-fixture-1',
  imageWidth: 800,
  imageHeight: 600,
  orientationHint: 'landscape',
  duplicateGroupHint: 'possible-duplicate-group-a',
  signals: [
    { signalId: 'metadata-signal-2', field: 'possible_duplicate_photo', value: true, confidence: 0.42, limitationRefs: ['filename-similarity-only'] },
    { signalId: 'metadata-signal-1', field: 'possible_low_resolution_photo', value: '800x600', confidence: 0.37, limitationRefs: ['fixture-dimensions-only'] },
  ],
};

const ocrPayload: OcrFixturePayload = {
  fixtureId: 'ocr-fixture-1',
  textRegionCount: 2,
  signals: [
    { signalId: 'ocr-signal-2', field: 'possible_equipment_label_text', text: 'INV-1 FIXTURE', confidence: 0.51, limitationRefs: ['fixture-text-only'] },
    { signalId: 'ocr-signal-1', field: 'possible_meter_label_text', text: 'METER FIXTURE 123', confidence: 0.46, limitationRefs: ['fixture-text-only'] },
  ],
};

describe('Open-source assisted evidence registry and fixture adapters', () => {
  it('classifies approved, caution, and blocked license posture', () => {
    expect(classifyLicensePosture('MIT')).toBe('approved');
    expect(classifyLicensePosture('MPL-2.0')).toBe('caution');
    expect(classifyLicensePosture('AGPL-3.0')).toBe('blocked');
    expect(classifyLicensePosture('unknown license')).toBe('blocked');
  });

  it('rejects invalid tool definitions and canonical mutation permissions', () => {
    const valid = getRegisteredOpenSourceTool('fixture-image-metadata-adapter', '1.0.0');
    expect(valid.canonicalMutationAllowed).toBe(false);
    expect(valid.reviewRequired).toBe(true);
    expect(() => validateOpenSourceToolDefinition({ ...valid, canonicalMutationAllowed: true as false })).toThrow(/canonical mutation/i);
    expect(() => validateOpenSourceToolDefinition({ ...valid, license: 'GPL-3.0' })).toThrow(/blocked/i);
    expect(() => validateOpenSourceToolDefinition({ ...valid, toolName: '' })).toThrow(/toolName/i);
  });

  it('rejects unregistered tool execution', () => {
    expect(() => getRegisteredOpenSourceTool('not-registered', '0.0.1')).toThrow(/Unregistered/);
  });

  it('normalizes confidence without implicit upgrades', () => {
    expect(normalizeCandidateConfidence(-1)).toBe(0);
    expect(normalizeCandidateConfidence(1.25)).toBe(1);
    expect(normalizeCandidateConfidence(0.37456)).toBe(0.3746);
  });

  it('metadata fixture adapter generates deterministic review-required non-canonical candidates', () => {
    const first = generateMetadataFixtureCandidates(sourceContext, metadataPayload);
    const second = generateMetadataFixtureCandidates(sourceContext, { ...metadataPayload, signals: [...metadataPayload.signals].reverse() });

    expect(first.candidates).toHaveLength(2);
    expect(first.candidates.map(candidate => candidate.candidateStatus)).toEqual(['review_required', 'review_required']);
    expect(first.candidates.map(candidate => candidate.nonAuthoritative)).toEqual([true, true]);
    expect(first.candidates.map(candidate => candidate.reviewRequired)).toEqual([true, true]);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));
    expect(first.candidates[0].candidatePayload.fixtureOnly).toBe(true);
    expect(first.candidates[0].candidateLimitations).toContain('no-image-bytes-inspected');
    expect(first.candidates[0].provenance.notes.join(' ')).toContain('no runtime OCR/CV/image processing executed');
  });

  it('OCR fixture adapter generates deterministic text candidates without OCR runtime authority', () => {
    const first = generateOcrFixtureCandidates(sourceContext, ocrPayload);
    const second = generateOcrFixtureCandidates(sourceContext, { ...ocrPayload, signals: [...ocrPayload.signals].reverse() });

    expect(first.candidates).toHaveLength(2);
    expect(first.candidates.map(candidate => candidate.candidateType)).toEqual(['text_region_candidate', 'text_region_candidate']);
    expect(first.candidates.map(candidate => candidate.candidateStatus)).toEqual(['review_required', 'review_required']);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));
    expect(first.candidates[0].candidateLimitations).toContain('no-ocr-runtime');
    expect(first.candidates[0].candidatePayload.fixtureOnly).toBe(true);
  });

  it('preserves low confidence fixture signals instead of upgrading them', () => {
    const result = generateMetadataFixtureCandidates(sourceContext, metadataPayload);
    const lowResolution = result.candidates.find(candidate => candidate.candidateClaims.some(claim => claim.field === 'possible_low_resolution_photo'));
    expect(lowResolution?.candidateConfidence).toBe(0.37);
  });
});
