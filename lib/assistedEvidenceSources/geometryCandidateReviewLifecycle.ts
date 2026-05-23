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

export type GeometryCandidateReviewAction = 'acknowledge_review_projection' | 'reject_candidate';
export type GeometryCandidateStaleClass = 'candidate_source_stale' | 'candidate_runtime_stale' | 'candidate_policy_stale' | 'candidate_review_stale';
export type GeometryCandidateForbiddenStaleClass = 'canonical_geometry_stale' | 'cad_output_stale' | 'engineering_output_stale' | 'route_output_stale' | 'bom_output_stale' | 'plan_set_output_stale';

export interface GeometryCandidateReviewInput extends Required<Pick<CandidateReviewInput, 'reviewerId' | 'reviewedAt'>> {
  reviewNotes?: string[];
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
