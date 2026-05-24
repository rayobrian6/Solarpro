import {
  acceptCandidate,
  candidateCanCreateWorkflowItems,
  candidateCanInfluenceCADReadiness,
  candidateCanInfluenceRecommendations,
  candidateCanSatisfyRequirement,
  projectionAutomaticallyMutatesCanonicalEvidence,
  rejectCandidate,
} from '@/lib/assistedEvidence';
import type { AcceptedCandidateReviewResult, RejectedCandidateReviewResult } from '@/lib/assistedEvidence';
import type { AssistedEvidenceCandidate, CandidateReviewInput, ReviewedEvidenceProjection } from '@/lib/assistedEvidence';
import { GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION, GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME } from './geometryCandidateTypes';

export type GeometryCandidateReviewAction = 'accept_for_review_projection' | 'reject_candidate';
export type GeometryCandidateReviewActionPersistenceMode = 'deterministic_dto_only_v1';
export type GeometryCandidateStaleClass = 'candidate_source_stale' | 'candidate_runtime_stale' | 'candidate_policy_stale' | 'candidate_review_stale';
export type GeometryCandidateForbiddenStaleClass = 'canonical_geometry_stale' | 'cad_output_stale' | 'engineering_output_stale' | 'route_output_stale' | 'bom_output_stale' | 'plan_set_output_stale';

export interface GeometryCandidateReviewInput extends Required<Pick<CandidateReviewInput, 'reviewerId' | 'reviewedAt'>> {
  reviewNotes?: string[];
}

export interface GeometryCandidateReviewActionInput extends Required<Pick<CandidateReviewInput, 'reviewerId' | 'reviewedAt'>> {
  actionType: GeometryCandidateReviewAction;
  reviewerDisplayLabel?: string;
  reviewNote?: string;
  rejectionReason?: string;
}

export interface GeometryCandidateReviewActionAuthorityFlags {
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  roofPlaneMutationAllowed: false;
  setbackMutationAllowed: false;
  layoutMutationAllowed: false;
  engineeringInfluenceAllowed: false;
  necInfluenceAllowed: false;
  workflowInfluenceAllowed: false;
  recommendationInfluenceAllowed: false;
  downstreamAuthority: false;
}

export interface GeometryCandidateReviewActionAudit {
  actionType: GeometryCandidateReviewAction;
  persistenceMode: GeometryCandidateReviewActionPersistenceMode;
  candidateId: string;
  candidateType: AssistedEvidenceCandidate['candidateType'];
  candidateHash: string;
  runtimeName: string;
  runtimeVersion: string;
  runtimePayloadHash: string;
  sourceImageReference: string;
  sourceLineageRef: string;
  boundaryPolicyVersion: string;
  reviewerId: string;
  reviewerDisplayLabel: string | null;
  reviewTimestamp: string;
  reviewNote: string | null;
  priorReviewState: AssistedEvidenceCandidate['candidateStatus'];
  resultingReviewState: AssistedEvidenceCandidate['candidateStatus'];
  reviewedProjectionId: string | null;
  reviewedProjectionHash: string | null;
  rejectionReason: string | null;
  authorityFlags: GeometryCandidateReviewActionAuthorityFlags;
  deterministicNotes: string[];
}

export interface GeometryCandidateReviewActionResult {
  candidate: AssistedEvidenceCandidate;
  projection: ReviewedEvidenceProjection | null;
  audit: GeometryCandidateReviewActionAudit;
}

export interface GeometryCandidateReviewAnnotationInput extends Required<Pick<CandidateReviewInput, 'reviewerId' | 'reviewedAt'>> {
  reviewerDisplayLabel?: string;
  annotationNote?: string;
  reviewerConfidence?: number;
  tags?: string[];
}

export interface GeometryCandidateReviewAnnotationAudit {
  annotationSchemaVersion: 'geometry_candidate_review_annotation_v1';
  persistenceMode: GeometryCandidateReviewActionPersistenceMode;
  candidateId: string;
  candidateType: AssistedEvidenceCandidate['candidateType'];
  candidateHash: string;
  runtimeName: string;
  runtimeVersion: string;
  runtimePayloadHash: string;
  sourceImageReference: string;
  sourceLineageRef: string;
  boundaryPolicyVersion: string;
  reviewerId: string;
  reviewerDisplayLabel: string | null;
  annotationTimestamp: string;
  annotationNote: string | null;
  reviewerConfidence: number | null;
  tags: string[];
  priorReviewState: AssistedEvidenceCandidate['candidateStatus'];
  resultingReviewState: AssistedEvidenceCandidate['candidateStatus'];
  projectionCreated: false;
  reviewedProjectionId: string | null;
  reviewedProjectionHash: string | null;
  authorityFlags: GeometryCandidateReviewActionAuthorityFlags;
  annotationHash: string;
  deterministicNotes: string[];
}

export interface GeometryCandidateReviewAnnotationResult {
  candidate: AssistedEvidenceCandidate;
  projection: null;
  audit: GeometryCandidateReviewAnnotationAudit;
}

export interface GeometryCandidateReviewAuditExportInput {
  exportedAt: string;
  exportedBy: string;
  exportReason?: string;
  staleVisibilityInput?: GeometryCandidateStaleVisibilityInput;
  acceptPreview?: Omit<GeometryCandidateReviewActionInput, 'actionType'>;
  rejectPreview?: Omit<GeometryCandidateReviewActionInput, 'actionType'>;
  annotationPreview?: GeometryCandidateReviewAnnotationInput;
}

export interface GeometryCandidateReviewAuditExportBundle {
  exportSchemaVersion: 'geometry_candidate_review_audit_export_bundle_v1';
  persistenceMode: GeometryCandidateReviewActionPersistenceMode;
  candidateId: string;
  candidateType: AssistedEvidenceCandidate['candidateType'];
  candidateHash: string;
  exportedAt: string;
  exportedBy: string;
  exportReason: string | null;
  sourceImageReference: string;
  sourceLineageRef: string;
  runtimeName: string;
  runtimeVersion: string;
  runtimePayloadHash: string;
  boundaryPolicyVersion: string;
  candidateSnapshot: Pick<AssistedEvidenceCandidate, 'candidateId' | 'candidateType' | 'candidateCategory' | 'candidateStatus' | 'reviewRequired' | 'nonAuthoritative' | 'sourceFileId' | 'sourceUploadKey' | 'projectId' | 'surveyId' | 'toolName' | 'toolVersion' | 'deterministicHash'>;
  staleVisibility: GeometryCandidateStaleVisibility;
  lineage: GeometryCandidateLineageNode;
  reviewActionPreviews: {
    accept: GeometryCandidateReviewActionAudit | null;
    reject: GeometryCandidateReviewActionAudit | null;
  };
  reviewerAnnotationPreview: GeometryCandidateReviewAnnotationAudit | null;
  authorityFlags: GeometryCandidateReviewActionAuthorityFlags;
  exportHash: string;
  deterministicNotes: string[];
}

export interface GeometryCandidateStaleVisibilityInput {
  sourceMetadataHash?: string;
  runtimePayloadHash?: string;
  boundaryPolicyVersion?: string;
  reviewStateHash?: string;
}

export interface GeometryCandidateStaleVisibility {
  candidateId: string;
  candidateOnly: true;
  staleClasses: GeometryCandidateStaleClass[];
  forbiddenStaleClasses: GeometryCandidateForbiddenStaleClass[];
  reviewVisibilityRequired: boolean;
  regenerationAllowed: false;
  cadInvalidationAllowed: false;
  engineeringInvalidationAllowed: false;
  workflowAllowed: false;
  recommendationAllowed: false;
  deterministicNotes: string[];
}

export interface GeometryCandidateLineageNode {
  nodeId: string;
  nodeType: 'review_required_geometry_candidate';
  candidateId: string;
  sourceFileId: string;
  sourceUploadKey: string;
  projectId: string;
  surveyId: string;
  runtimeToolName: string;
  runtimeToolVersion: string;
  runtimePayloadHash: string;
  sourceImageLineageRef: string;
  boundaryPolicyVersion: string;
  reviewState: AssistedEvidenceCandidate['candidateStatus'];
  dependencyRole: 'lineage_visibility_only';
  downstreamAuthority: false;
  allowedEdges: ['source_image_to_candidate', 'candidate_to_review_projection'];
  forbiddenEdges: ['candidate_to_cad', 'candidate_to_roof_plane', 'candidate_to_setback', 'candidate_to_layout', 'candidate_to_nec', 'candidate_to_engineering', 'candidate_to_workflow', 'candidate_to_recommendation'];
  deterministicHash: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function deterministicHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isGeometryCandidate(candidate: AssistedEvidenceCandidate): boolean {
  return candidate.candidateType === 'possible_obstruction_candidate'
    && candidate.candidateCategory === 'roof_context'
    && candidate.toolName === GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME;
}

export function assertReviewableGeometryCandidate(candidate: AssistedEvidenceCandidate): true {
  if (!isGeometryCandidate(candidate)) throw new Error('Only possible_obstruction_candidate geometry candidates can use the geometry review lifecycle.');
  if (candidate.candidateStatus !== 'review_required') throw new Error('Geometry candidate review lifecycle requires review_required status.');
  if (candidate.nonAuthoritative !== true || candidate.reviewRequired !== true) throw new Error('Geometry candidates must remain non-authoritative and review-required.');
  if (candidateCanSatisfyRequirement(candidate) || candidateCanInfluenceCADReadiness(candidate) || candidateCanInfluenceRecommendations(candidate) || candidateCanCreateWorkflowItems(candidate)) {
    throw new Error('Geometry candidates must not satisfy requirements or influence CAD, recommendations, or workflows.');
  }
  return true;
}

export function acceptGeometryCandidateForReviewProjection(candidate: AssistedEvidenceCandidate, review: GeometryCandidateReviewInput): AcceptedCandidateReviewResult {
  assertReviewableGeometryCandidate(candidate);
  const result = acceptCandidate(candidate, {
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt,
    acceptedFields: ['possible_obstruction_candidate'],
    rejectedFields: [],
    reviewNotes: [
      'Geometry candidate accepted as review projection only; not canonical geometry, not CAD input, not engineering authority.',
      ...(review.reviewNotes ?? []),
    ],
  });
  assertGeometryProjectionIsReviewOnly(result.projection);
  return result;
}

export function rejectGeometryCandidate(candidate: AssistedEvidenceCandidate, review: GeometryCandidateReviewInput): RejectedCandidateReviewResult {
  assertReviewableGeometryCandidate(candidate);
  return rejectCandidate(candidate, {
    reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt,
    acceptedFields: [],
    rejectedFields: ['possible_obstruction_candidate'],
    reviewNotes: [
      'Geometry candidate rejected in assisted evidence review only; no canonical, CAD, or engineering mutation permitted.',
      ...(review.reviewNotes ?? []),
    ],
  });
}

function payloadString(candidate: AssistedEvidenceCandidate, key: string): string {
  const value = candidate.candidatePayload[key];
  return typeof value === 'string' ? value : '';
}

function normalizedOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function reviewNotesFromAction(input: GeometryCandidateReviewActionInput): string[] {
  const reviewNote = normalizedOptionalText(input.reviewNote);
  const rejectionReason = normalizedOptionalText(input.rejectionReason);
  return [reviewNote, rejectionReason ? `Rejection reason: ${rejectionReason}` : null].filter((value): value is string => value !== null);
}

function normalizedAnnotationTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? [])
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function assertGeometryReviewAnnotationInput(input: GeometryCandidateReviewAnnotationInput): true {
  if (!input.reviewerId.trim()) throw new Error('Geometry candidate review annotation requires reviewerId.');
  if (!input.reviewedAt.trim()) throw new Error('Geometry candidate review annotation requires annotation timestamp.');
  if (input.reviewerConfidence !== undefined && (!Number.isFinite(input.reviewerConfidence) || input.reviewerConfidence < 0 || input.reviewerConfidence > 1)) {
    throw new Error('Geometry candidate review annotation confidence must be between 0 and 1.');
  }
  if (!normalizedOptionalText(input.annotationNote) && input.reviewerConfidence === undefined && normalizedAnnotationTags(input.tags).length === 0) {
    throw new Error('Geometry candidate review annotation requires a note, reviewer confidence, or at least one tag.');
  }
  return true;
}

function assertGeometryReviewActionInput(input: GeometryCandidateReviewActionInput): true {
  if (input.actionType !== 'accept_for_review_projection' && input.actionType !== 'reject_candidate') throw new Error('Unsupported geometry candidate review action.');
  if (!input.reviewerId.trim()) throw new Error('Geometry candidate review action requires reviewerId.');
  if (!input.reviewedAt.trim()) throw new Error('Geometry candidate review action requires review timestamp.');
  if (input.actionType === 'reject_candidate' && !normalizedOptionalText(input.rejectionReason)) throw new Error('Rejecting a geometry candidate requires a rejection reason.');
  return true;
}

const GEOMETRY_CANDIDATE_REVIEW_ACTION_AUTHORITY_FLAGS: GeometryCandidateReviewActionAuthorityFlags = {
  canonicalGeometryMutationAllowed: false,
  cadMutationAllowed: false,
  roofPlaneMutationAllowed: false,
  setbackMutationAllowed: false,
  layoutMutationAllowed: false,
  engineeringInfluenceAllowed: false,
  necInfluenceAllowed: false,
  workflowInfluenceAllowed: false,
  recommendationInfluenceAllowed: false,
  downstreamAuthority: false,
};

function buildGeometryCandidateReviewActionAudit(
  sourceCandidate: AssistedEvidenceCandidate,
  resultingCandidate: AssistedEvidenceCandidate,
  projection: ReviewedEvidenceProjection | null,
  input: GeometryCandidateReviewActionInput,
): GeometryCandidateReviewActionAudit {
  return {
    actionType: input.actionType,
    persistenceMode: 'deterministic_dto_only_v1',
    candidateId: sourceCandidate.candidateId,
    candidateType: sourceCandidate.candidateType,
    candidateHash: sourceCandidate.deterministicHash,
    runtimeName: sourceCandidate.toolName,
    runtimeVersion: sourceCandidate.toolVersion,
    runtimePayloadHash: payloadString(sourceCandidate, 'runtimePayloadHash'),
    sourceImageReference: sourceCandidate.sourceUploadKey,
    sourceLineageRef: payloadString(sourceCandidate, 'sourceImageLineageRef'),
    boundaryPolicyVersion: payloadString(sourceCandidate, 'boundaryPolicyVersion') || GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION,
    reviewerId: input.reviewerId,
    reviewerDisplayLabel: normalizedOptionalText(input.reviewerDisplayLabel),
    reviewTimestamp: input.reviewedAt,
    reviewNote: normalizedOptionalText(input.reviewNote),
    priorReviewState: sourceCandidate.candidateStatus,
    resultingReviewState: resultingCandidate.candidateStatus,
    reviewedProjectionId: projection?.projectionId ?? null,
    reviewedProjectionHash: projection?.deterministicHash ?? null,
    rejectionReason: input.actionType === 'reject_candidate' ? normalizedOptionalText(input.rejectionReason) : null,
    authorityFlags: GEOMETRY_CANDIDATE_REVIEW_ACTION_AUTHORITY_FLAGS,
    deterministicNotes: [
      'Geometry candidate review action is deterministic DTO-only in V1; durable persistence is a future phase.',
      'Accepted geometry candidates create reviewed evidence projections only and do not create canonical geometry.',
      'Rejected geometry candidates do not create projections and do not mutate CAD, engineering, workflows, or recommendations.',
    ],
  };
}

export function buildGeometryCandidateReviewAnnotation(candidate: AssistedEvidenceCandidate, input: GeometryCandidateReviewAnnotationInput): GeometryCandidateReviewAnnotationResult {
  assertGeometryReviewAnnotationInput(input);
  assertReviewableGeometryCandidate(candidate);

  const tags = normalizedAnnotationTags(input.tags);
  const annotationWithoutHash = {
    annotationSchemaVersion: 'geometry_candidate_review_annotation_v1' as const,
    persistenceMode: 'deterministic_dto_only_v1' as const,
    candidateId: candidate.candidateId,
    candidateType: candidate.candidateType,
    candidateHash: candidate.deterministicHash,
    runtimeName: candidate.toolName,
    runtimeVersion: candidate.toolVersion,
    runtimePayloadHash: payloadString(candidate, 'runtimePayloadHash'),
    sourceImageReference: candidate.sourceUploadKey,
    sourceLineageRef: payloadString(candidate, 'sourceImageLineageRef'),
    boundaryPolicyVersion: payloadString(candidate, 'boundaryPolicyVersion') || GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION,
    reviewerId: input.reviewerId,
    reviewerDisplayLabel: normalizedOptionalText(input.reviewerDisplayLabel),
    annotationTimestamp: input.reviewedAt,
    annotationNote: normalizedOptionalText(input.annotationNote),
    reviewerConfidence: input.reviewerConfidence ?? null,
    tags,
    priorReviewState: candidate.candidateStatus,
    resultingReviewState: candidate.candidateStatus,
    projectionCreated: false as const,
    reviewedProjectionId: null,
    reviewedProjectionHash: null,
    authorityFlags: GEOMETRY_CANDIDATE_REVIEW_ACTION_AUTHORITY_FLAGS,
    deterministicNotes: [
      'Geometry candidate review annotation is deterministic DTO-only in V1 and does not persist records.',
      'Annotation output keeps the review state unchanged and does not create reviewed evidence projections.',
      'Reviewer confidence and tags are triage metadata only with no downstream authority.',
    ],
  };

  return {
    candidate,
    projection: null,
    audit: {
      ...annotationWithoutHash,
      annotationHash: deterministicHash(annotationWithoutHash),
    },
  };
}

export function acceptGeometryCandidateReviewAction(candidate: AssistedEvidenceCandidate, input: Omit<GeometryCandidateReviewActionInput, 'actionType'>): GeometryCandidateReviewActionResult {
  return submitGeometryCandidateReviewAction(candidate, { ...input, actionType: 'accept_for_review_projection' });
}

export function rejectGeometryCandidateReviewAction(candidate: AssistedEvidenceCandidate, input: Omit<GeometryCandidateReviewActionInput, 'actionType'>): GeometryCandidateReviewActionResult {
  return submitGeometryCandidateReviewAction(candidate, { ...input, actionType: 'reject_candidate' });
}

export function submitGeometryCandidateReviewAction(candidate: AssistedEvidenceCandidate, input: GeometryCandidateReviewActionInput): GeometryCandidateReviewActionResult {
  assertGeometryReviewActionInput(input);
  assertReviewableGeometryCandidate(candidate);
  if (input.actionType === 'accept_for_review_projection') {
    const accepted = acceptGeometryCandidateForReviewProjection(candidate, {
      reviewerId: input.reviewerId,
      reviewedAt: input.reviewedAt,
      reviewNotes: reviewNotesFromAction(input),
    });
    return {
      candidate: accepted.candidate,
      projection: accepted.projection,
      audit: buildGeometryCandidateReviewActionAudit(candidate, accepted.candidate, accepted.projection, input),
    };
  }
  const rejected = rejectGeometryCandidate(candidate, {
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    reviewNotes: reviewNotesFromAction(input),
  });
  return {
    candidate: rejected.candidate,
    projection: rejected.projection,
    audit: buildGeometryCandidateReviewActionAudit(candidate, rejected.candidate, rejected.projection, input),
  };
}

export function assertGeometryProjectionIsReviewOnly(projection: ReviewedEvidenceProjection): true {
  if (projection.projectionCategory !== 'roof_context') throw new Error('Geometry review projection must stay in roof_context assisted evidence category.');
  if (projectionAutomaticallyMutatesCanonicalEvidence(projection)) throw new Error('Geometry review projection must not automatically mutate canonical evidence.');
  const allowedKeys = ['possible_obstruction_candidate'];
  const projectionKeys = Object.keys(projection.projectionPayload).sort((a, b) => a.localeCompare(b));
  if (projectionKeys.join('|') !== allowedKeys.join('|')) throw new Error('Geometry review projection may contain possible_obstruction_candidate only.');
  return true;
}

export function buildGeometryCandidateStaleVisibility(candidate: AssistedEvidenceCandidate, current: GeometryCandidateStaleVisibilityInput): GeometryCandidateStaleVisibility {
  const staleClasses: GeometryCandidateStaleClass[] = [];
  const runtimePayloadHash = typeof candidate.candidatePayload.runtimePayloadHash === 'string' ? candidate.candidatePayload.runtimePayloadHash : '';
  const boundaryPolicyVersion = typeof candidate.candidatePayload.boundaryPolicyVersion === 'string' ? candidate.candidatePayload.boundaryPolicyVersion : '';
  if (current.sourceMetadataHash && current.sourceMetadataHash !== candidate.sourceMetadataHash) staleClasses.push('candidate_source_stale');
  if (current.runtimePayloadHash && current.runtimePayloadHash !== runtimePayloadHash) staleClasses.push('candidate_runtime_stale');
  if (current.boundaryPolicyVersion && current.boundaryPolicyVersion !== boundaryPolicyVersion) staleClasses.push('candidate_policy_stale');
  if (current.reviewStateHash && current.reviewStateHash !== candidate.deterministicHash) staleClasses.push('candidate_review_stale');
  return {
    candidateId: candidate.candidateId,
    candidateOnly: true,
    staleClasses: [...new Set(staleClasses)].sort((a, b) => a.localeCompare(b)),
    forbiddenStaleClasses: ['canonical_geometry_stale', 'cad_output_stale', 'engineering_output_stale', 'route_output_stale', 'bom_output_stale', 'plan_set_output_stale'],
    reviewVisibilityRequired: staleClasses.length > 0,
    regenerationAllowed: false,
    cadInvalidationAllowed: false,
    engineeringInvalidationAllowed: false,
    workflowAllowed: false,
    recommendationAllowed: false,
    deterministicNotes: [
      'Geometry candidate stale visibility is metadata-only and candidate-only.',
      'No CAD, roof-plane, setback, layout, NEC, engineering, workflow, recommendation, BOM, route, or plan-set invalidation is permitted.',
    ],
  };
}

export function buildGeometryCandidateLineageNode(candidate: AssistedEvidenceCandidate): GeometryCandidateLineageNode {
  const runtimePayloadHash = typeof candidate.candidatePayload.runtimePayloadHash === 'string' ? candidate.candidatePayload.runtimePayloadHash : '';
  const sourceImageLineageRef = typeof candidate.candidatePayload.sourceImageLineageRef === 'string' ? candidate.candidatePayload.sourceImageLineageRef : '';
  const boundaryPolicyVersion = typeof candidate.candidatePayload.boundaryPolicyVersion === 'string' ? candidate.candidatePayload.boundaryPolicyVersion : GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION;
  const seed = {
    candidateId: candidate.candidateId,
    deterministicHash: candidate.deterministicHash,
    runtimePayloadHash,
    sourceImageLineageRef,
    boundaryPolicyVersion,
    reviewState: candidate.candidateStatus,
  };
  return {
    nodeId: `geometryCandidate:${candidate.candidateId}`,
    nodeType: 'review_required_geometry_candidate',
    candidateId: candidate.candidateId,
    sourceFileId: candidate.sourceFileId,
    sourceUploadKey: candidate.sourceUploadKey,
    projectId: candidate.projectId,
    surveyId: candidate.surveyId,
    runtimeToolName: candidate.toolName,
    runtimeToolVersion: candidate.toolVersion,
    runtimePayloadHash,
    sourceImageLineageRef,
    boundaryPolicyVersion,
    reviewState: candidate.candidateStatus,
    dependencyRole: 'lineage_visibility_only',
    downstreamAuthority: false,
    allowedEdges: ['source_image_to_candidate', 'candidate_to_review_projection'],
    forbiddenEdges: ['candidate_to_cad', 'candidate_to_roof_plane', 'candidate_to_setback', 'candidate_to_layout', 'candidate_to_nec', 'candidate_to_engineering', 'candidate_to_workflow', 'candidate_to_recommendation'],
    deterministicHash: deterministicHash(seed),
  };
}

export function buildGeometryCandidateReviewAuditExportBundle(candidate: AssistedEvidenceCandidate, input: GeometryCandidateReviewAuditExportInput): GeometryCandidateReviewAuditExportBundle {
  assertReviewableGeometryCandidate(candidate);
  if (!input.exportedAt.trim()) throw new Error('Geometry candidate review audit export requires exportedAt.');
  if (!input.exportedBy.trim()) throw new Error('Geometry candidate review audit export requires exportedBy.');

  const runtimePayloadHash = payloadString(candidate, 'runtimePayloadHash');
  const sourceLineageRef = payloadString(candidate, 'sourceImageLineageRef');
  const boundaryPolicyVersion = payloadString(candidate, 'boundaryPolicyVersion') || GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION;
  const staleVisibility = buildGeometryCandidateStaleVisibility(candidate, input.staleVisibilityInput ?? {});
  const lineage = buildGeometryCandidateLineageNode(candidate);
  const acceptPreview = input.acceptPreview ? acceptGeometryCandidateReviewAction(candidate, input.acceptPreview).audit : null;
  const rejectPreview = input.rejectPreview ? rejectGeometryCandidateReviewAction(candidate, input.rejectPreview).audit : null;
  const annotationPreview = input.annotationPreview ? buildGeometryCandidateReviewAnnotation(candidate, input.annotationPreview).audit : null;
  const bundleWithoutHash = {
    exportSchemaVersion: 'geometry_candidate_review_audit_export_bundle_v1' as const,
    persistenceMode: 'deterministic_dto_only_v1' as const,
    candidateId: candidate.candidateId,
    candidateType: candidate.candidateType,
    candidateHash: candidate.deterministicHash,
    exportedAt: input.exportedAt,
    exportedBy: input.exportedBy,
    exportReason: normalizedOptionalText(input.exportReason),
    sourceImageReference: candidate.sourceUploadKey,
    sourceLineageRef,
    runtimeName: candidate.toolName,
    runtimeVersion: candidate.toolVersion,
    runtimePayloadHash,
    boundaryPolicyVersion,
    candidateSnapshot: {
      candidateId: candidate.candidateId,
      candidateType: candidate.candidateType,
      candidateCategory: candidate.candidateCategory,
      candidateStatus: candidate.candidateStatus,
      reviewRequired: candidate.reviewRequired,
      nonAuthoritative: candidate.nonAuthoritative,
      sourceFileId: candidate.sourceFileId,
      sourceUploadKey: candidate.sourceUploadKey,
      projectId: candidate.projectId,
      surveyId: candidate.surveyId,
      toolName: candidate.toolName,
      toolVersion: candidate.toolVersion,
      deterministicHash: candidate.deterministicHash,
    },
    staleVisibility,
    lineage,
    reviewActionPreviews: {
      accept: acceptPreview,
      reject: rejectPreview,
    },
    reviewerAnnotationPreview: annotationPreview,
    authorityFlags: GEOMETRY_CANDIDATE_REVIEW_ACTION_AUTHORITY_FLAGS,
    deterministicNotes: [
      'Geometry candidate review audit export bundle is deterministic DTO-only and does not persist records.',
      'The bundle contains candidate provenance, candidate-only stale visibility, lineage-only dependency metadata, optional review-action preview audit DTOs, and an optional reviewer annotation preview audit DTO.',
      'The bundle is no-authority export metadata only and cannot change downstream operational systems or generated outputs.',
    ],
  };
  return {
    ...bundleWithoutHash,
    exportHash: deterministicHash(bundleWithoutHash),
  };
}
