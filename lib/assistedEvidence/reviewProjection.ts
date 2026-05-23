import { deterministicHash, withProjectionHash } from './candidateRegistry';
import type { AssistedEvidenceCandidate, CandidateReviewInput, ReviewedEvidenceProjection } from './types';

export function buildProjectionPayload(candidate: AssistedEvidenceCandidate, acceptedFields: string[]): Record<string, unknown> {
  const accepted = new Set(acceptedFields);
  const payload: Record<string, unknown> = {};
  for (const claim of candidate.candidateClaims) {
    if (accepted.has(claim.field)) payload[claim.field] = claim.value;
  }
  return payload;
}

export function createReviewedEvidenceProjection(
  candidate: AssistedEvidenceCandidate,
  review: Required<Pick<CandidateReviewInput, 'reviewerId' | 'reviewedAt'>> & CandidateReviewInput,
): ReviewedEvidenceProjection {
  if (candidate.candidateStatus !== 'review_required') {
    throw new Error('Only review-required assisted evidence candidates can create reviewed projections.');
  }
  const acceptedFields = [...(review.acceptedFields ?? [])].sort((a, b) => a.localeCompare(b));
  if (acceptedFields.length === 0) throw new Error('Accepted assisted evidence projections require at least one accepted field.');
  const rejectedFields = [...(review.rejectedFields ?? [])].sort((a, b) => a.localeCompare(b));
  const reviewNotes = [...(review.reviewNotes ?? [])].sort((a, b) => a.localeCompare(b));
  const projectionPayload = buildProjectionPayload(candidate, acceptedFields);
  const projectionSeed = {
    sourceCandidateId: candidate.candidateId,
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt,
    acceptedFields,
    projectionPayload,
  };
  const projectionId = `aep_${deterministicHash(projectionSeed).slice(0, 24)}`;
  const projectionWithoutReviewHash = {
    projectionId,
    sourceCandidateId: candidate.candidateId,
    projectId: candidate.projectId,
    surveyId: candidate.surveyId,
    reviewerId: review.reviewerId,
    acceptedFields,
    projectionCategory: candidate.candidateCategory,
    projectionPayload,
    projectionConfidence: candidate.candidateConfidence,
    projectionLimitations: candidate.candidateLimitations,
    projectionStatus: 'active_reviewed_projection' as const,
    createdAt: review.reviewedAt,
    canonicalParticipationStatus: 'eligible_for_mapping' as const,
    reviewProvenance: {
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt,
      reviewDecision: 'accepted' as const,
      acceptedFields,
      rejectedFields,
      reviewNotes,
      sourceCandidateId: candidate.candidateId,
      candidateHash: candidate.deterministicHash,
      reviewProjectionHash: '',
    },
  };
  const reviewProjectionHash = deterministicHash({ ...projectionWithoutReviewHash, reviewProvenance: { ...projectionWithoutReviewHash.reviewProvenance, reviewProjectionHash: 'pending' } });
  return withProjectionHash({
    ...projectionWithoutReviewHash,
    reviewProvenance: { ...projectionWithoutReviewHash.reviewProvenance, reviewProjectionHash },
  });
}
