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
import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import type { OpenSourceToolDefinition } from './openSourceToolTypes';
import { validateOpenSourceToolDefinition } from './openSourceToolValidation';
import { createVisualCategorizationCandidates } from './visualCategorizationRuntimeBridge';
import { visualCategorizationRuntimeAdapter } from './visualCategorizationRuntimeAdapter';
import { ALLOWED_VISUAL_CATEGORIZATION_LABELS, VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION } from './visualCategorizationRuntimeTypes';

function sourceContext(overrides: Partial<AssistedEvidenceSourceContext> = {}): AssistedEvidenceSourceContext {
  return {
    sourceFileId: 'survey-file-visual-001',
    sourceUploadKey: 'uploads/visual/roof-overview-001.jpg',
    projectId: 'project-visual-001',
    surveyId: 'survey-visual-001',
    toolRunId: 'visual-run-001',
    toolConfigHash: 'visual-config-hash-001',
    sourceMetadataHash: 'visual-source-metadata-hash-001',
    createdAt: '2025-05-01T00:00:00.000Z',
    createdBy: 'visual-runtime-test',
    ...overrides,
  };
}

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6]);

describe('visual categorization runtime registry governance', () => {
  it('registers the visual runtime only as a server-side review-required visual category candidate runtime', () => {
    const tool = getRegisteredOpenSourceTool(VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION);
    expect(tool.runtimeCategory).toBe('visual_categorization_candidate');
    expect(tool.allowedCandidateTypes).toEqual(['visual_category_candidate']);
    expect(tool.serverOnly).toBe(true);
    expect(tool.browserCompatible).toBe(false);
    expect(tool.reviewRequired).toBe(true);
    expect(tool.canonicalMutationAllowed).toBe(false);
    expect(tool.requiresModelWeights).toBe(false);
    expect(tool.requiresNativeBinaries).toBe(false);
    expect(tool.allowedRuntimeBoundary).toBe('server_adapter_contract');
  });

  it('rejects unregistered visual runtimes and blocked visual runtime registry definitions', () => {
    expect(() => getRegisteredOpenSourceTool('unregistered-visual-runtime', '1.0.0')).toThrow(/Unregistered/);

    const validTool = getRegisteredOpenSourceTool(VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'unsafe-visual-runtime', requiresModelWeights: true })).toThrow(/model weights/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'browser-visual-runtime', browserCompatible: true })).toThrow(/browser-executed/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'mutating-visual-runtime', canonicalMutationAllowed: true } as unknown as OpenSourceToolDefinition)).toThrow(/canonical mutation/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'geometry-visual-runtime', allowedRuntimeBoundary: 'blocked_future_geometry' })).toThrow(/server adapter contract|blocked future geometry/i);
    expect(() => validateOpenSourceToolDefinition({ ...validTool, toolName: 'object-runtime', allowedCandidateTypes: ['roof_edge_candidate'] })).toThrow(/visual_category_candidate only/i);
  });
});

describe('visual categorization runtime candidate behavior', () => {
  it('emits deterministic possible photo-category candidates with stable hashes for the same image and context', async () => {
    const first = await createVisualCategorizationCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'roof overview exterior photo',
    });
    const second = await createVisualCategorizationCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'roof overview exterior photo',
    });

    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.normalizedCandidates).toEqual(second.normalizedCandidates);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));
    expect(first.candidates.map(candidate => candidate.candidateId)).toEqual(second.candidates.map(candidate => candidate.candidateId));
  });

  it('keeps every visual category candidate non-authoritative, review-required, confidence bounded, and provenance-attached', async () => {
    const result = await createVisualCategorizationCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'main service panel and meter photo',
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.candidateType).toBe('visual_category_candidate');
      expect(candidate.candidateStatus).toBe('review_required');
      expect(candidate.reviewRequired).toBe(true);
      expect(candidate.nonAuthoritative).toBe(true);
      expect(candidate.candidateConfidence).toBeGreaterThanOrEqual(0);
      expect(candidate.candidateConfidence).toBeLessThanOrEqual(1);
      expect(candidate.provenance.toolName).toBe(VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME);
      expect(candidate.provenance.notes.join(' ')).toMatch(/possible photo-category candidates only/i);
      expect(candidate.candidatePayload.nonSpatial).toBe(true);
      expect(candidate.candidatePayload.nonGeometric).toBe(true);
      expect(candidate.candidatePayload.nonAuthoritative).toBe(true);
      expect(candidate.candidatePayload.reviewRequired).toBe(true);
      expect(candidate.candidatePayload.forbiddenUses).toEqual(expect.arrayContaining(['engineering_fact', 'geometry_truth', 'equipment_confirmation', 'cad_input', 'workflow_trigger', 'canonical_mutation']));
      expect(ALLOWED_VISUAL_CATEGORIZATION_LABELS).toContain(candidate.candidatePayload.label as never);
      expect(candidate.candidateClaims[0]?.field).toBe('possible_photo_category');
      expect(candidateCanSatisfyRequirement(candidate)).toBe(false);
      expect(candidateCanInfluenceCADReadiness(candidate)).toBe(false);
      expect(candidateCanInfluenceRecommendations(candidate)).toBe(false);
      expect(candidateCanCreateWorkflowItems(candidate)).toBe(false);
    }
  });

  it('does not create geometry, object detection, CAD, workflow, recommendation, or canonical mutation payload fields', async () => {
    const result = await createVisualCategorizationCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'obstruction roof vent overview',
    });

    for (const candidate of result.candidates) {
      const serialized = JSON.stringify(candidate);
      expect(serialized).not.toMatch(/boundingBox|bbox|polygon|coordinates|roofEdge|setback|conduitPath|obstructionMap/);
      expect(serialized).not.toMatch(/cadReadiness|engineeringRequirement|recommendation|workflowAction|canonicalMutation/);
    }
  });

  it('creates accepted projections as projection-only outputs without automatic canonical mapping', async () => {
    const result = await createVisualCategorizationCandidates({
      imageBytes,
      sourceContext: sourceContext(),
      sourceContextText: 'utility bill account invoice photo',
    });
    const candidate = result.candidates[0];
    const reviewInput = {
      reviewerId: 'reviewer-visual-001',
      reviewedAt: '2025-05-01T01:00:00.000Z',
      acceptedFields: ['possible_photo_category'],
      reviewNotes: ['Projection only; not canonical evidence.'],
    };
    const accepted = acceptCandidate(candidate, reviewInput);
    const projection = createReviewedEvidenceProjection(candidate, reviewInput);

    expect(accepted.candidate.candidateStatus).toBe('accepted_by_reviewer');
    expect(accepted.projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projection.projectionCategory).toBe(candidate.candidateCategory);
    expect(projection.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(projectionAutomaticallyMutatesCanonicalEvidence(projection)).toBe(false);
  });

  it('extracts the same runtime payload and hash for the same image and source-context text', async () => {
    const first = await visualCategorizationRuntimeAdapter.extractRuntimePayload({ imageBytes, sourceContextText: 'attic rafters' });
    const second = await visualCategorizationRuntimeAdapter.extractRuntimePayload({ imageBytes, sourceContextText: 'attic rafters' });

    expect(first).toEqual(second);
    expect(first.runtimePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.byteSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(first.confidence).toBeGreaterThanOrEqual(0);
    expect(first.confidence).toBeLessThanOrEqual(1);
  });
});
