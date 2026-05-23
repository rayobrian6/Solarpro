import { createHash } from 'node:crypto';
import type { AssistedEvidenceCandidate, ReviewedEvidenceProjection } from './types';

export const ASSISTED_EVIDENCE_MODEL_VERSION = 'assisted_evidence_sandbox_v1' as const;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

export function deterministicHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function candidateHashInput(candidate: Omit<AssistedEvidenceCandidate, 'deterministicHash'>): Record<string, unknown> {
  return {
    modelVersion: ASSISTED_EVIDENCE_MODEL_VERSION,
    candidateId: candidate.candidateId,
    sourceFileId: candidate.sourceFileId,
    sourceUploadKey: candidate.sourceUploadKey,
    projectId: candidate.projectId,
    surveyId: candidate.surveyId,
    candidateType: candidate.candidateType,
    candidateCategory: candidate.candidateCategory,
    candidateStatus: candidate.candidateStatus,
    candidateConfidence: candidate.candidateConfidence,
    toolName: candidate.toolName,
    toolVersion: candidate.toolVersion,
    toolRunId: candidate.toolRunId,
    toolConfigHash: candidate.toolConfigHash,
    sourceMetadataHash: candidate.sourceMetadataHash,
    candidatePayload: candidate.candidatePayload,
    candidateSummary: candidate.candidateSummary,
    candidateClaims: candidate.candidateClaims,
    candidateLimitations: candidate.candidateLimitations,
    nonAuthoritative: candidate.nonAuthoritative,
    reviewRequired: candidate.reviewRequired,
    createdAt: candidate.createdAt,
    invalidatedAt: candidate.invalidatedAt,
    supersededBy: candidate.supersededBy,
    provenance: candidate.provenance,
  };
}

export function withCandidateHash(candidate: Omit<AssistedEvidenceCandidate, 'deterministicHash'>): AssistedEvidenceCandidate {
  return { ...candidate, deterministicHash: deterministicHash(candidateHashInput(candidate)) };
}

export function projectionHashInput(projection: Omit<ReviewedEvidenceProjection, 'deterministicHash'>): Record<string, unknown> {
  return {
    modelVersion: ASSISTED_EVIDENCE_MODEL_VERSION,
    projectionId: projection.projectionId,
    sourceCandidateId: projection.sourceCandidateId,
    projectId: projection.projectId,
    surveyId: projection.surveyId,
    reviewerId: projection.reviewerId,
    acceptedFields: projection.acceptedFields,
    projectionCategory: projection.projectionCategory,
    projectionPayload: projection.projectionPayload,
    projectionConfidence: projection.projectionConfidence,
    projectionLimitations: projection.projectionLimitations,
    projectionStatus: projection.projectionStatus,
    createdAt: projection.createdAt,
    canonicalParticipationStatus: projection.canonicalParticipationStatus,
    reviewProvenance: projection.reviewProvenance,
  };
}

export function withProjectionHash(projection: Omit<ReviewedEvidenceProjection, 'deterministicHash'>): ReviewedEvidenceProjection {
  return { ...projection, deterministicHash: deterministicHash(projectionHashInput(projection)) };
}
