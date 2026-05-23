import { describe, expect, it } from 'vitest';
import {
  acceptCandidate,
  candidateCanCreateWorkflowItems,
  candidateCanInfluenceCADReadiness,
  candidateCanInfluenceRecommendations,
  candidateCanSatisfyRequirement,
  createReviewedEvidenceProjection,
  projectionAutomaticallyMutatesCanonicalEvidence,
} from '@/lib/assistedEvidence';
import type { AssistedEvidenceSourceContext } from './candidateAdapterTypes';
import { createGeometryCandidateCandidates } from './geometryCandidateRuntimeBridge';
import { geometryCandidateRuntimeAdapter } from './geometryCandidateRuntimeAdapter';
import { GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION, GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME, GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION } from './geometryCandidateTypes';
import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import type { OpenSourceToolDefinition } from './openSourceToolTypes';
import { validateOpenSourceToolDefinition } from './openSourceToolValidation';

function sourceContext(overrides: Partial<AssistedEvidenceSourceContext> = {}): AssistedEvidenceSourceContext {
  return {
    sourceFileId: 'survey-file-geometry-001',
    sourceUploadKey: 'uploads/geometry/roof-obstruction-review-001.jpg',
    projectId: 'project-geometry-001',
    surveyId: 'survey-geometry-001',
    toolRunId: 'geometry-run-001',
    toolConfigHash: 'geometry-config-hash-001',
    sourceMetadataHash: 'geometry-source-metadata-hash-001',
    createdAt: '2025-05-01T00:00:00.000Z',
    createdBy: 'geometry-runtime-test',
    ...overrides,
  };
}

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 21, 34, 55, 89, 144, 233]);

describe('geometry candidate runtime registry governance', () => {
  it('registers the geometry runtime only as a server-side review-required possible obstruction candidate runtime', () => {
    const tool = getRegisteredOpenSourceTool(GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME, GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION);
    expect(tool.runtimeCategory).toBe('geometry_adjacency_candidate');
    expect(tool.allowedCandidateTypes).toEqual(['possible_obstruction_candidate']);
    expect(tool.allowedCandidateCategories).toEqual(['roof_context']);
    expect(tool.serverOnly).toBe(true);
    expect(tool.browserCompatible).toBe(false);
    expect(tool.reviewRequired).toBe(true);
    expect(tool.canonicalMutationAllowed).toBe(false);
    expect(tool.requiresModelWeights).toBe(false);
    expect(tool.requiresNativeBinaries).toBe(false);
    expect(tool.allowedRuntimeBoundary).toBe('server_adapter_contract');
    expect(tool.deterministicReplaySupport).toBe('runtime_payload_hash_required');
  });

  it('rejects unregistered, blocked, invalid, or overly broad geometry runtime registry definitions', () => {
    expect(() => getRegisteredOpenSourceTool('unregistered-geometry-runtime', '1.0.0')).toThrow(/Unregistered/);

    const validTool = getRegisteredOpenSourceTool(GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME, GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'browser-geometry-runtime', browserCompatible: true })).toThrow(/browser-executed/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'native-geometry-runtime', requiresNativeBinaries: true })).toThrow(/native binaries/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'model-geometry-runtime', requiresModelWeights: true })).toThrow(/model weights/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'mutating-geometry-runtime', canonicalMutationAllowed: true } as unknown as OpenSourceToolDefinition)).toThrow(/canonical mutation/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'blocked-geometry-runtime', allowedRuntimeBoundary: 'blocked_future_geometry' })).toThrow(/server adapter contract|blocked future geometry/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'roof-edge-geometry-runtime', allowedCandidateTypes: ['roof_edge_candidate'] })).toThrow(/possible_obstruction_candidate only/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'bad-category-geometry-runtime', allowedCandidateCategories: ['engineering_context' as never] })).toThrow(/roof_context/i);
  });
});

describe('geometry candidate runtime behavior', () => {
  it('emits deterministic possible obstruction candidates with stable hashes for the same image and source context', async () => {
    const first = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'roof overview with possible vent obstruction',
    });
    const second = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'roof overview with possible vent obstruction',
    });

    expect(first.candidates).toHaveLength(1);
    expect(first.normalizedCandidates).toEqual(second.normalizedCandidates);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));
    expect(first.candidates.map(candidate => candidate.candidateId)).toEqual(second.candidates.map(candidate => candidate.candidateId));
  });

  it('returns no candidate when bounded source context does not indicate obstruction review context', async () => {
    const result = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'front elevation photo no relevant roof context',
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.normalizedCandidates).toHaveLength(0);
  });

  it('keeps every geometry candidate non-authoritative, review-required, confidence bounded, and provenance-attached', async () => {
    const result = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'chimney skylight vent obstruction review image',
    });

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.candidateType).toBe('possible_obstruction_candidate');
    expect(candidate.candidateCategory).toBe('roof_context');
    expect(candidate.candidateStatus).toBe('review_required');
    expect(candidate.reviewRequired).toBe(true);
    expect(candidate.nonAuthoritative).toBe(true);
    expect(candidate.candidateConfidence).toBeGreaterThanOrEqual(0);
    expect(candidate.candidateConfidence).toBeLessThanOrEqual(1);
    expect(candidate.provenance.toolName).toBe(GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME);
    expect(candidate.provenance.notes.join(' ')).toMatch(/possible obstruction candidates only/i);
    expect(candidate.candidatePayload.label).toBe('possible_obstruction_candidate');
    expect(candidate.candidatePayload.boundaryPolicyVersion).toBe(GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION);
    expect(candidate.candidatePayload.sourceImageLineageRef).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.candidatePayload.runtimePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.candidatePayload.nonAuthoritative).toBe(true);
    expect(candidate.candidatePayload.reviewRequired).toBe(true);
    expect(candidate.candidatePayload.candidateOnly).toBe(true);
    expect(candidate.candidatePayload.projectionOnlyOnReview).toBe(true);
    expect(candidate.candidateClaims[0]?.field).toBe('possible_obstruction_candidate');
  });

  it('does not create CAD, roof plane, layout, NEC, routing, conductor, structural, BOM, readiness, workflow, recommendation, or canonical mutation authority', async () => {
    const result = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'satellite dish and pipe obstruction review context',
    });
    const candidate = result.candidates[0];
    const payloadKeys = Object.keys(candidate.candidatePayload);
    const forbiddenActivePayloadKeys = [
      'boundingBox',
      'bbox',
      'polygon',
      'coordinates',
      'polyline',
      'roofEdge',
      'ridgeLine',
      'valleyLine',
      'plane',
      'azimuth',
      'tilt',
      'pitch',
      'setback',
      'obstructionMap',
      'conduitPath',
      'routeLength',
      'attachmentSpacing',
      'rafter',
      'truss',
      'cadModel',
      'cadReadiness',
      'engineeringRequirement',
      'requirementSatisfied',
      'recommendationAction',
      'workflowAction',
      'canonicalMutation',
    ];

    expect(payloadKeys).not.toEqual(expect.arrayContaining(forbiddenActivePayloadKeys));
    expect(candidate.candidatePayload.forbiddenUses).toEqual(expect.arrayContaining([
      'canonical_geometry',
      'canonical_roof_plane',
      'cad_input',
      'cad_obstruction',
      'layout_input',
      'panel_filter',
      'setback_authority',
      'engineering_fact',
      'nec_authority',
      'routing_authority',
      'conductor_sizing',
      'structural_authority',
      'bom_input',
      'plan_set_input',
      'readiness_state',
      'workflow_trigger',
      'recommendation_trigger',
      'canonical_mutation',
    ]));
    expect(candidateCanSatisfyRequirement(candidate)).toBe(false);
    expect(candidateCanInfluenceCADReadiness(candidate)).toBe(false);
    expect(candidateCanInfluenceRecommendations(candidate)).toBe(false);
    expect(candidateCanCreateWorkflowItems(candidate)).toBe(false);
  });

  it('keeps invalidation and stale propagation candidate-only', async () => {
    const result = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'roof jack obstruction context',
    });
    const candidate = result.candidates[0];
    const stalePropagation = candidate.candidatePayload.stalePropagation as { candidateOnly: boolean; allowedStaleClasses: string[]; forbiddenStaleClasses: string[] };

    expect(stalePropagation.candidateOnly).toBe(true);
    expect(stalePropagation.allowedStaleClasses).toEqual(['candidate_source_stale', 'candidate_runtime_stale', 'candidate_policy_stale', 'candidate_review_stale']);
    expect(stalePropagation.forbiddenStaleClasses).toEqual(['canonical_geometry_stale', 'cad_output_stale', 'engineering_output_stale', 'route_output_stale', 'bom_output_stale', 'plan_set_output_stale']);
  });

  it('creates accepted geometry projections as projection-only outputs without automatic canonical mapping', async () => {
    const result = await createGeometryCandidateCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'possible chimney obstruction source image',
    });
    const candidate = result.candidates[0];
    const reviewInput = {
      reviewerId: 'reviewer-geometry-001',
      reviewedAt: '2025-05-01T01:00:00.000Z',
      acceptedFields: ['possible_obstruction_candidate'],
      reviewNotes: ['Projection only; not canonical geometry, not CAD input, and not engineering authority.'],
    };
    const accepted = acceptCandidate(candidate, reviewInput);
    const projection = createReviewedEvidenceProjection(candidate, reviewInput);

    expect(accepted.candidate.candidateStatus).toBe('accepted_by_reviewer');
    expect(accepted.projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projection.projectionCategory).toBe('roof_context');
    expect(projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projectionAutomaticallyMutatesCanonicalEvidence(projection)).toBe(false);
    expect(Object.keys(projection.projectionPayload)).toEqual(['possible_obstruction_candidate']);
    expect(projection.projectionPayload).not.toHaveProperty('CADModel');
    expect(projection.projectionPayload).not.toHaveProperty('roofPlane');
    expect(projection.projectionPayload).not.toHaveProperty('setback');
    expect(projection.projectionPayload).not.toHaveProperty('NEC');
    expect(projection.projectionPayload).not.toHaveProperty('workflowAction');
    expect(projection.projectionPayload).not.toHaveProperty('recommendationAction');
  });

  it('extracts the same runtime payload and hash for the same image and source-context text', async () => {
    const first = await geometryCandidateRuntimeAdapter.extractRuntimePayload({ imageBytes, sourceContextText: 'vent obstruction context' });
    const second = await geometryCandidateRuntimeAdapter.extractRuntimePayload({ imageBytes, sourceContextText: 'vent obstruction context' });

    expect(first).toEqual(second);
    expect(first.runtimePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceImageByteHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.confidence).toBeGreaterThanOrEqual(0);
    expect(first.confidence).toBeLessThanOrEqual(1);
    expect(first.derivedSignals).toHaveLength(1);
  });
});
