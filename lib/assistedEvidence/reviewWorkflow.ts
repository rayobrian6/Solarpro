import { withCandidateHash } from './candidateRegistry';
import { invalidateCandidate, supersedeCandidate } from './candidateLifecycle';
import { createReviewedEvidenceProjection } from './reviewProjection';
import type { AssistedEvidenceCandidate, CandidateReviewInput, ReviewedEvidenceProjection } from './types';

function withoutCandidateHash(candidate: AssistedEvidenceCandidate): Omit<AssistedEvidenceCandidate, 'deterministicHash'> {
  const { deterministicHash: _deterministicHash, ...rest } = candidate;
  return rest;
}

export interface AcceptedCandidateReviewResult {
  candidate: AssistedEvidenceCandidate;
  projection: ReviewedEvidenceProjection;
}

export interface RejectedCandidateReviewResult {
  candidate: AssistedEvidenceCandidate;
  projection: null;
}

export function acceptCandidate(candidate: AssistedEvidenceCandidate, review: CandidateReviewInput): AcceptedCandidateReviewResult {
  if (candidate.candidateStatus !== 'review_required') {
    throw new Error('Only review-required assisted evidence candidates can be accepted.');
  }
  if (!review.reviewerId || !review.reviewedAt) throw new Error('Reviewer id and reviewedAt are required for acceptance.');
  const projection = createReviewedEvidenceProjection(candidate, {
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt,
    acceptedFields: review.acceptedFields ?? [],
    rejectedFields: review.rejectedFields ?? [],
    reviewNotes: review.reviewNotes ?? [],
  });
  const acceptedCandidate = withCandidateHash({ ...withoutCandidateHash(candidate), candidateStatus: 'accepted_by_reviewer' });
  return { candidate: acceptedCandidate, projection };
}

export function rejectCandidate(candidate: AssistedEvidenceCandidate, review: CandidateReviewInput): RejectedCandidateReviewResult {
  if (candidate.candidateStatus !== 'review_required') {
    throw new Error('Only review-required assisted evidence candidates can be rejected.');
  }
  if (!review.reviewerId || !review.reviewedAt) throw new Error('Reviewer id and reviewedAt are required for rejection.');
  return { candidate: withCandidateHash({ ...withoutCandidateHash(candidate), candidateStatus: 'rejected_by_reviewer' }), projection: null };
}

export { invalidateCandidate, supersedeCandidate };
