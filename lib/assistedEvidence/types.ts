export type AssistedEvidenceCandidateStatus =
  | 'created'
  | 'review_required'
  | 'accepted_by_reviewer'
  | 'rejected_by_reviewer'
  | 'superseded'
  | 'invalidated';

export type AssistedEvidenceCandidateType =
  | 'photo_quality_candidate'
  | 'orientation_candidate'
  | 'duplicate_similarity_candidate'
  | 'text_region_candidate'
  | 'visual_category_candidate'
  | 'utility_scene_candidate'
  | 'electrical_scene_candidate'
  | 'roof_edge_candidate'
  | 'routing_continuity_candidate'
  | 'trench_context_candidate'
  | 'ess_context_candidate'
  | 'detached_structure_candidate';

export type AssistedEvidenceCandidateCategory =
  | 'quality'
  | 'orientation'
  | 'duplicate_hygiene'
  | 'field_context'
  | 'electrical_context'
  | 'roof_context'
  | 'routing_context'
  | 'trench_context'
  | 'ess_context'
  | 'structure_context';

export type AssistedEvidenceReviewDecision = 'accepted' | 'rejected';

export type AssistedEvidenceProjectionStatus = 'active_reviewed_projection' | 'inactive_rejected' | 'inactive_invalidated' | 'inactive_superseded';

export type CanonicalParticipationStatus =
  | 'not_eligible'
  | 'eligible_for_mapping'
  | 'mapped_to_explicit_survey_metadata'
  | 'mapped_to_reviewed_evidence'
  | 'rejected_from_canonical';

export interface AssistedEvidenceProvenance {
  source: 'manual_fixture' | 'test_fixture' | 'future_assisted_tool_placeholder';
  sourceFileId: string;
  sourceUploadKey: string;
  projectId: string;
  surveyId: string;
  toolName: string;
  toolVersion: string;
  toolRunId: string;
  toolConfigHash: string;
  sourceMetadataHash: string;
  createdBy?: string;
  deterministicInputs: string[];
  notes: string[];
}

export interface AssistedEvidenceCandidateClaim {
  claimId: string;
  field: string;
  value: unknown;
  confidence: number;
  limitationRefs: string[];
}

export interface AssistedEvidenceCandidate {
  candidateId: string;
  sourceFileId: string;
  sourceUploadKey: string;
  projectId: string;
  surveyId: string;
  candidateType: AssistedEvidenceCandidateType;
  candidateCategory: AssistedEvidenceCandidateCategory;
  candidateStatus: AssistedEvidenceCandidateStatus;
  candidateConfidence: number;
  toolName: string;
  toolVersion: string;
  toolRunId: string;
  toolConfigHash: string;
  sourceMetadataHash: string;
  candidatePayload: Record<string, unknown>;
  candidateSummary: string;
  candidateClaims: AssistedEvidenceCandidateClaim[];
  candidateLimitations: string[];
  nonAuthoritative: true;
  reviewRequired: true;
  createdAt: string;
  invalidatedAt: string | null;
  supersededBy: string | null;
  provenance: AssistedEvidenceProvenance;
  deterministicHash: string;
}

export interface AssistedEvidenceReviewProvenance {
  reviewerId: string;
  reviewedAt: string;
  reviewDecision: AssistedEvidenceReviewDecision;
  acceptedFields: string[];
  rejectedFields: string[];
  reviewNotes: string[];
  sourceCandidateId: string;
  candidateHash: string;
  reviewProjectionHash: string;
}

export interface ReviewedEvidenceProjection {
  projectionId: string;
  sourceCandidateId: string;
  projectId: string;
  surveyId: string;
  reviewerId: string;
  acceptedFields: string[];
  projectionCategory: AssistedEvidenceCandidateCategory;
  projectionPayload: Record<string, unknown>;
  projectionConfidence: number;
  projectionLimitations: string[];
  projectionStatus: AssistedEvidenceProjectionStatus;
  createdAt: string;
  deterministicHash: string;
  canonicalParticipationStatus: CanonicalParticipationStatus;
  reviewProvenance: AssistedEvidenceReviewProvenance;
}

export interface CreateAssistedEvidenceCandidateInput {
  candidateId?: string;
  sourceFileId: string;
  sourceUploadKey: string;
  projectId: string;
  surveyId: string;
  candidateType: AssistedEvidenceCandidateType;
  candidateCategory: AssistedEvidenceCandidateCategory;
  candidateConfidence: number;
  toolName: string;
  toolVersion: string;
  toolRunId: string;
  toolConfigHash: string;
  sourceMetadataHash: string;
  candidatePayload: Record<string, unknown>;
  candidateSummary: string;
  candidateClaims: AssistedEvidenceCandidateClaim[];
  candidateLimitations: string[];
  createdAt: string;
  provenance?: Partial<AssistedEvidenceProvenance>;
}

export interface CandidateReviewInput {
  reviewerId: string;
  reviewedAt: string;
  acceptedFields?: string[];
  rejectedFields?: string[];
  reviewNotes?: string[];
}
