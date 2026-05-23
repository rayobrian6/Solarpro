import { describe, expect, it } from 'vitest';
import {
  acceptCandidate,
  assertCandidateIsNonAuthoritative,
  candidateCanCreateWorkflowItems,
  candidateCanInfluenceCADReadiness,
  candidateCanInfluenceRecommendations,
  candidateCanSatisfyRequirement,
  createCandidate,
  invalidatedCandidateCanProjectDownstream,
  invalidateCandidate,
  markReviewRequired,
  projectionAutomaticallyMutatesCanonicalEvidence,
  projectionIsEligibleForFutureMappingOnly,
  rejectedCandidateIsAuditableButInactive,
  rejectCandidate,
  stableStringify,
  supersedeCandidate,
} from './index';
import type { CreateAssistedEvidenceCandidateInput } from './types';

const baseInput: CreateAssistedEvidenceCandidateInput = {
  sourceFileId: 'file-assisted-1',
  sourceUploadKey: 'uploads/project-1/survey-1/file-assisted-1.jpg',
  projectId: 'project-assisted-1',
  surveyId: 'survey-assisted-1',
  candidateType: 'roof_edge_candidate',
  candidateCategory: 'roof_context',
  candidateConfidence: 0.74,
  toolName: 'manual-fixture-assisted-evidence',
  toolVersion: '1.0.0',
  toolRunId: 'manual-run-1',
  toolConfigHash: 'config-hash-fixture-1',
  sourceMetadataHash: 'source-metadata-hash-1',
  candidatePayload: { suggestedCategory: 'roof_edge', qualityNote: 'fixture metadata only' },
  candidateSummary: 'Fixture candidate suggesting roof edge context; not authoritative.',
  candidateClaims: [
    { claimId: 'claim-2', field: 'qualityNote', value: 'fixture metadata only', confidence: 0.61, limitationRefs: ['manual-fixture'] },
    { claimId: 'claim-1', field: 'suggestedCategory', value: 'roof_edge', confidence: 0.74, limitationRefs: ['manual-fixture'] },
  ],
  candidateLimitations: ['manual-fixture', 'no-image-processing', 'review-required'],
  createdAt: '2025-01-01T00:00:00.000Z',
  provenance: {
    source: 'test_fixture',
    createdBy: 'test-suite',
    deterministicInputs: ['sourceFileId', 'candidatePayload'],
    notes: ['No image bytes inspected.', 'Fixture metadata only.'],
  },
};

function reviewRequiredCandidate() {
  return markReviewRequired(createCandidate(baseInput));
}

describe('Assisted Evidence Sandbox Architecture V1', () => {
  it('creates deterministic non-authoritative candidates from fixture metadata only', () => {
    const candidate = createCandidate(baseInput);
    const replay = createCandidate({ ...baseInput, candidateClaims: [...baseInput.candidateClaims].reverse() });

    expect(candidate.candidateStatus).toBe('created');
    expect(candidate.nonAuthoritative).toBe(true);
    expect(candidate.reviewRequired).toBe(true);
    expect(candidate.candidateId).toBe(replay.candidateId);
    expect(candidate.deterministicHash).toBe(replay.deterministicHash);
    expect(candidate.provenance.source).toBe('test_fixture');
    expect(candidate.provenance.notes).toContain('No image bytes inspected.');
  });

  it('moves candidates into review-required quarantine', () => {
    const candidate = reviewRequiredCandidate();
    expect(candidate.candidateStatus).toBe('review_required');
    expect(assertCandidateIsNonAuthoritative(candidate)).toBe(true);
  });

  it('proves unreviewed candidates cannot satisfy requirements, CAD readiness, recommendations, or workflows', () => {
    const candidate = reviewRequiredCandidate();
    expect(candidateCanSatisfyRequirement(candidate)).toBe(false);
    expect(candidateCanInfluenceCADReadiness(candidate)).toBe(false);
    expect(candidateCanInfluenceRecommendations(candidate)).toBe(false);
    expect(candidateCanCreateWorkflowItems(candidate)).toBe(false);
  });

  it('rejects candidates while preserving auditable inactive candidate history', () => {
    const result = rejectCandidate(reviewRequiredCandidate(), {
      reviewerId: 'reviewer-1',
      reviewedAt: '2025-01-02T00:00:00.000Z',
      rejectedFields: ['suggestedCategory'],
      reviewNotes: ['Rejected fixture candidate.'],
    });

    expect(result.projection).toBeNull();
    expect(result.candidate.candidateStatus).toBe('rejected_by_reviewer');
    expect(rejectedCandidateIsAuditableButInactive(result.candidate)).toBe(true);
  });

  it('invalidates candidates and blocks downstream projection', () => {
    const invalidated = invalidateCandidate(reviewRequiredCandidate(), '2025-01-03T00:00:00.000Z');
    expect(invalidated.candidateStatus).toBe('invalidated');
    expect(invalidated.invalidatedAt).toBe('2025-01-03T00:00:00.000Z');
    expect(invalidatedCandidateCanProjectDownstream(invalidated)).toBe(false);
    expect(() => acceptCandidate(invalidated, { reviewerId: 'reviewer-1', reviewedAt: '2025-01-03T01:00:00.000Z', acceptedFields: ['suggestedCategory'] })).toThrow();
  });

  it('supersedes candidates while keeping source candidate auditable', () => {
    const superseded = supersedeCandidate(reviewRequiredCandidate(), 'aec_replacement_candidate');
    expect(superseded.candidateStatus).toBe('superseded');
    expect(superseded.supersededBy).toBe('aec_replacement_candidate');
    expect(candidateCanSatisfyRequirement(superseded)).toBe(false);
  });

  it('accepts review-required candidates into reviewed projections only', () => {
    const result = acceptCandidate(reviewRequiredCandidate(), {
      reviewerId: 'reviewer-1',
      reviewedAt: '2025-01-04T00:00:00.000Z',
      acceptedFields: ['suggestedCategory'],
      rejectedFields: ['qualityNote'],
      reviewNotes: ['Accepted category for future mapping eligibility only.'],
    });

    expect(result.candidate.candidateStatus).toBe('accepted_by_reviewer');
    expect(result.projection.sourceCandidateId).toBe(result.candidate.candidateId);
    expect(result.projection.projectionPayload).toEqual({ suggestedCategory: 'roof_edge' });
    expect(result.projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projectionIsEligibleForFutureMappingOnly(result.projection)).toBe(true);
    expect(projectionAutomaticallyMutatesCanonicalEvidence(result.projection)).toBe(false);
  });

  it('does not allow accepted projection creation without explicit accepted fields', () => {
    expect(() => acceptCandidate(reviewRequiredCandidate(), {
      reviewerId: 'reviewer-1',
      reviewedAt: '2025-01-04T00:00:00.000Z',
      acceptedFields: [],
    })).toThrow();
  });

  it('keeps deterministic hash stability and stable stringify replay behavior', () => {
    const a = createCandidate(baseInput);
    const b = createCandidate({
      ...baseInput,
      candidatePayload: { qualityNote: 'fixture metadata only', suggestedCategory: 'roof_edge' },
      candidateLimitations: [...baseInput.candidateLimitations].reverse(),
    });
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(a.deterministicHash).toBe(b.deterministicHash);
  });
});
