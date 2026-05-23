import type { AssistedEvidenceCandidate, ReviewedEvidenceProjection } from './types';

export function assertCandidateIsNonAuthoritative(candidate: AssistedEvidenceCandidate): true {
  if (candidate.nonAuthoritative !== true || candidate.reviewRequired !== true) {
    throw new Error('Assisted evidence candidates must remain non-authoritative and review-required.');
  }
  return true;
}

export function candidateCanSatisfyRequirement(_candidate: AssistedEvidenceCandidate): false {
  return false;
}

export function candidateCanInfluenceCADReadiness(_candidate: AssistedEvidenceCandidate): false {
  return false;
}

export function candidateCanInfluenceRecommendations(_candidate: AssistedEvidenceCandidate): false {
  return false;
}

export function candidateCanCreateWorkflowItems(_candidate: AssistedEvidenceCandidate): false {
  return false;
}

export function candidateCanProjectDownstream(candidate: AssistedEvidenceCandidate): boolean {
  return candidate.candidateStatus === 'review_required';
}

export function invalidatedCandidateCanProjectDownstream(candidate: AssistedEvidenceCandidate): false {
  if (candidate.candidateStatus !== 'invalidated') return false;
  return false;
}

export function rejectedCandidateIsAuditableButInactive(candidate: AssistedEvidenceCandidate): boolean {
  return candidate.candidateStatus === 'rejected_by_reviewer' && candidate.nonAuthoritative === true && candidate.reviewRequired === true;
}

export function projectionAutomaticallyMutatesCanonicalEvidence(_projection: ReviewedEvidenceProjection): false {
  return false;
}

export function projectionIsEligibleForFutureMappingOnly(projection: ReviewedEvidenceProjection): boolean {
  return projection.projectionStatus === 'active_reviewed_projection'
    && projection.canonicalParticipationStatus === 'eligible_for_mapping';
}
