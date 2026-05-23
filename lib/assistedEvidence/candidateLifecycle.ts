import { deterministicHash, withCandidateHash } from './candidateRegistry';
import type { AssistedEvidenceCandidate, CreateAssistedEvidenceCandidateInput } from './types';

function withoutCandidateHash(candidate: AssistedEvidenceCandidate): Omit<AssistedEvidenceCandidate, 'deterministicHash'> {
  const { deterministicHash: _deterministicHash, ...rest } = candidate;
  return rest;
}

function assertConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Assisted evidence candidate confidence must be between 0 and 1.');
  }
}

export function createCandidate(input: CreateAssistedEvidenceCandidateInput): AssistedEvidenceCandidate {
  assertConfidence(input.candidateConfidence);
  const candidateId = input.candidateId ?? `aec_${deterministicHash({
    sourceFileId: input.sourceFileId,
    sourceUploadKey: input.sourceUploadKey,
    projectId: input.projectId,
    surveyId: input.surveyId,
    candidateType: input.candidateType,
    candidatePayload: input.candidatePayload,
    createdAt: input.createdAt,
  }).slice(0, 24)}`;

  return withCandidateHash({
    candidateId,
    sourceFileId: input.sourceFileId,
    sourceUploadKey: input.sourceUploadKey,
    projectId: input.projectId,
    surveyId: input.surveyId,
    candidateType: input.candidateType,
    candidateCategory: input.candidateCategory,
    candidateStatus: 'created',
    candidateConfidence: input.candidateConfidence,
    toolName: input.toolName,
    toolVersion: input.toolVersion,
    toolRunId: input.toolRunId,
    toolConfigHash: input.toolConfigHash,
    sourceMetadataHash: input.sourceMetadataHash,
    candidatePayload: input.candidatePayload,
    candidateSummary: input.candidateSummary,
    candidateClaims: [...input.candidateClaims].sort((a, b) => a.claimId.localeCompare(b.claimId)),
    candidateLimitations: [...input.candidateLimitations].sort((a, b) => a.localeCompare(b)),
    nonAuthoritative: true,
    reviewRequired: true,
    createdAt: input.createdAt,
    invalidatedAt: null,
    supersededBy: null,
    provenance: {
      source: input.provenance?.source ?? 'manual_fixture',
      sourceFileId: input.sourceFileId,
      sourceUploadKey: input.sourceUploadKey,
      projectId: input.projectId,
      surveyId: input.surveyId,
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      toolRunId: input.toolRunId,
      toolConfigHash: input.toolConfigHash,
      sourceMetadataHash: input.sourceMetadataHash,
      createdBy: input.provenance?.createdBy,
      deterministicInputs: [...(input.provenance?.deterministicInputs ?? [])].sort((a, b) => a.localeCompare(b)),
      notes: [...(input.provenance?.notes ?? ['Candidate was created from deterministic fixture metadata only.'])].sort((a, b) => a.localeCompare(b)),
    },
  });
}

export function markReviewRequired(candidate: AssistedEvidenceCandidate): AssistedEvidenceCandidate {
  if (candidate.candidateStatus === 'invalidated' || candidate.candidateStatus === 'superseded') return candidate;
  return withCandidateHash({ ...withoutCandidateHash(candidate), candidateStatus: 'review_required' });
}

export function invalidateCandidate(candidate: AssistedEvidenceCandidate, invalidatedAt: string): AssistedEvidenceCandidate {
  return withCandidateHash({ ...withoutCandidateHash(candidate), candidateStatus: 'invalidated', invalidatedAt });
}

export function supersedeCandidate(candidate: AssistedEvidenceCandidate, supersededBy: string): AssistedEvidenceCandidate {
  if (!supersededBy) throw new Error('supersededBy is required when superseding an assisted evidence candidate.');
  return withCandidateHash({ ...withoutCandidateHash(candidate), candidateStatus: 'superseded', supersededBy });
}
