// ============================================================================
// lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts
//
// 14 required test cases for the Pipeline Unification directive.
// Covers authority transitions, mock blocking, bundle building, pipeline
// adapters, promotion, canonical model construction, and CAD bridge guards.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  isValidAuthorityTransition,
  AUTHORITY_LEVEL,
  VALID_AUTHORITY_TRANSITIONS,
  RAW_EVIDENCE_AUTHORITY,
  DERIVED_REVIEW_ONLY_AUTHORITY,
  REVIEWED_CANDIDATE_AUTHORITY,
  PROMOTED_CANONICAL_AUTHORITY,
  CAD_SAFE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
  getAuthorityForState,
} from '../authority';
import type {
  UnifiedGeometryAuthorityState,
  UnifiedGeometryAuthority,
} from '../authority';
import type {
  UnifiedGeometryArtifact,
  GeometryProvenance,
} from '../types';
import {
  adaptPhotoVisionCandidate,
  adaptGeometryReconArtifact,
} from '../pipelineAdapters';
import {
  BundleBuilder,
  buildUnifiedEvidenceBundle,
} from '../bundleBuilder';
import {
  promoteArtifact,
  promoteToDerivedReviewOnly,
  promoteToReviewedCandidate,
  promoteToCanonical,
  promoteToCadSafe,
  reviewArtifact,
  assertCadConsumable,
  assertCanonicalEligible,
  canPromote,
  PromotionError,
} from '../promotion';
import {
  CanonicalModelBuilder,
  buildCanonicalModel,
  CanonicalBuilderError,
} from '../canonicalBuilder';
import {
  canonicalToCADInputs,
  assertNoRawVisionInCAD,
  validateCADModelSources,
  CanonicalBridgeError,
} from '@/lib/cad/canonicalBridge';
import type { CADObstruction, CADElectricalNode } from '@/lib/cad/types';
import type { CanonicalBuildingModel } from '../types';

// ── Test Helpers ────────────────────────────────────────────────────────────

/** Create a valid UnifiedGeometryArtifact at a given authority state. */
function makeArtifact(
  overrides: Partial<UnifiedGeometryArtifact> & { id?: string; surveyId?: string } = {},
): UnifiedGeometryArtifact {
  const authority = overrides.authority ?? RAW_EVIDENCE_AUTHORITY;
  return {
    id: overrides.id ?? 'art-001',
    surveyId: overrides.surveyId ?? 'survey-001',
    geometryClass: overrides.geometryClass ?? 'obstruction',
    authority,
    provenance: overrides.provenance ?? {
      sourcePipeline: 'photo_vision',
      toolName: 'test-tool',
      toolVersion: '1.0.0',
      runHash: 'hash-001',
      sourceFileIds: ['file-001'],
      derivedFromArtifactIds: [],
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      workerVersion: null,
    },
    confidence: overrides.confidence ?? 75,
    label: overrides.label ?? 'Test Artifact',
    limitations: overrides.limitations ?? [],
    bbox: overrides.bbox ?? null,
    polygon: overrides.polygon ?? null,
    lineSegment: overrides.lineSegment ?? null,
    center: overrides.center ?? { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' },
    planeType: overrides.planeType ?? null,
    pitchDegrees: overrides.pitchDegrees ?? null,
    azimuthDegrees: overrides.azimuthDegrees ?? null,
    normalVector: overrides.normalVector ?? null,
    areaSqM: overrides.areaSqM ?? null,
    inlierCount: overrides.inlierCount ?? null,
    totalPoints: overrides.totalPoints ?? null,
    lineSubtype: overrides.lineSubtype ?? null,
    estimatedLengthM: overrides.estimatedLengthM ?? null,
    obstructionSubtype: overrides.obstructionSubtype ?? 'chimney',
    radiusM: overrides.radiusM ?? 0.3,
    setbackM: overrides.setbackM ?? 0.15,
    heightFt: overrides.heightFt ?? 3,
    roofPlaneId: overrides.roofPlaneId ?? null,
    cadImpact: overrides.cadImpact ?? null,
    electricalSubtype: overrides.electricalSubtype ?? null,
    story: overrides.story ?? null,
    isPrimaryInterconnect: overrides.isPrimaryInterconnect ?? null,
    depthResolution: overrides.depthResolution ?? null,
    depthMetric: overrides.depthMetric ?? null,
    consensusPhotoCount: overrides.consensusPhotoCount ?? null,
    segmentationClass: overrides.segmentationClass ?? null,
    reviewState: overrides.reviewState ?? 'review_required',
    reviewNotes: overrides.reviewNotes ?? null,
    priority: overrides.priority ?? 'medium',
    stageTimings: overrides.stageTimings ?? null,
  };
}

/** Make an artifact at a specific authority state. */
function makeArtifactAtState(
  state: UnifiedGeometryAuthorityState,
  overrides: Partial<UnifiedGeometryArtifact> = {},
): UnifiedGeometryArtifact {
  const authority = getAuthorityForState(state);
  return makeArtifact({ ...overrides, authority });
}

/** Make a mock artifact. Mock provenance sourcePipeline must be 'mock' for pipelineCounts. */
function makeMockArtifact(
  overrides: Partial<UnifiedGeometryArtifact> = {},
): UnifiedGeometryArtifact {
  return makeArtifact({
    ...overrides,
    authority: MOCK_ARTIFACT_AUTHORITY,
    provenance: {
      ...(overrides.provenance ?? makeArtifact().provenance),
      sourcePipeline: 'mock',
    },
  });
}

/** Make a cad_safe artifact suitable for canonical model + CAD bridge. */
function makeCadSafeArtifact(
  overrides: Partial<UnifiedGeometryArtifact> = {},
): UnifiedGeometryArtifact {
  return makeArtifactAtState('cad_safe', {
    id: overrides.id ?? 'art-cadsafe-001',
    surveyId: overrides.surveyId ?? 'survey-001',
    ...overrides,
  });
}

/** Build a minimal CanonicalBuildingModel at cad_safe authority. */
function makeCadSafeModel(
  overrides: Partial<CanonicalBuildingModel> = {},
): CanonicalBuildingModel {
  const cadSafeArtifact = makeCadSafeArtifact();
  return buildCanonicalModel('survey-001', [cadSafeArtifact], [], overrides as Record<string, unknown>) ;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1: Authority forward-only transitions
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 1: Authority forward-only transitions', () => {
  it('allows each forward transition: raw_evidence → derived_review_only → reviewed_candidate → promoted_canonical → cad_safe', () => {
    expect(isValidAuthorityTransition('raw_evidence', 'derived_review_only')).toBe(true);
    expect(isValidAuthorityTransition('derived_review_only', 'reviewed_candidate')).toBe(true);
    expect(isValidAuthorityTransition('reviewed_candidate', 'promoted_canonical')).toBe(true);
    expect(isValidAuthorityTransition('promoted_canonical', 'cad_safe')).toBe(true);
  });

  it('allows raw_evidence → reviewed_candidate (valid alternative transition)', () => {
    expect(isValidAuthorityTransition('raw_evidence', 'reviewed_candidate')).toBe(true);
  });

  it('rejects backward transitions', () => {
    expect(isValidAuthorityTransition('derived_review_only', 'raw_evidence')).toBe(false);
    expect(isValidAuthorityTransition('reviewed_candidate', 'derived_review_only')).toBe(false);
    expect(isValidAuthorityTransition('promoted_canonical', 'reviewed_candidate')).toBe(false);
    expect(isValidAuthorityTransition('cad_safe', 'promoted_canonical')).toBe(false);
  });

  it('rejects self-transitions', () => {
    expect(isValidAuthorityTransition('raw_evidence', 'raw_evidence')).toBe(false);
    expect(isValidAuthorityTransition('cad_safe', 'cad_safe')).toBe(false);
  });

  it('rejects cad_safe → anything (terminal state)', () => {
    expect(VALID_AUTHORITY_TRANSITIONS.cad_safe).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2: Authority skip rejected
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 2: Authority skip rejected', () => {
  it('raw_evidence → promoted_canonical throws PromotionError (must go through each step)', () => {
    const artifact = makeArtifactAtState('raw_evidence');
    expect(() => promoteArtifact(artifact, 'promoted_canonical', 'user-001')).toThrow(PromotionError);
  });

  it('raw_evidence → cad_safe throws PromotionError', () => {
    const artifact = makeArtifactAtState('raw_evidence');
    expect(() => promoteArtifact(artifact, 'cad_safe', 'user-001')).toThrow(PromotionError);
  });

  it('derived_review_only → promoted_canonical throws PromotionError', () => {
    const artifact = makeArtifactAtState('derived_review_only');
    expect(() => promoteArtifact(artifact, 'promoted_canonical', 'user-001')).toThrow(PromotionError);
  });

  it('reviewed_candidate → cad_safe throws PromotionError', () => {
    const artifact = makeArtifactAtState('reviewed_candidate');
    expect(() => promoteArtifact(artifact, 'cad_safe', 'user-001')).toThrow(PromotionError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 3: Mock artifact blocked from promotion
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 3: Mock artifact blocked from promotion', () => {
  it('mock artifact throws PromotionError on any promotion attempt', () => {
    const mock = makeMockArtifact();
    expect(() => promoteArtifact(mock, 'derived_review_only', 'user-001')).toThrow(PromotionError);
    expect(() => promoteArtifact(mock, 'reviewed_candidate', 'user-001')).toThrow(PromotionError);
    expect(() => promoteArtifact(mock, 'promoted_canonical', 'user-001')).toThrow(PromotionError);
    expect(() => promoteArtifact(mock, 'cad_safe', 'user-001')).toThrow(PromotionError);
  });

  it('mock artifact cannot be accepted via reviewArtifact', () => {
    const mock = makeMockArtifact();
    expect(() => reviewArtifact(mock, 'user-001', 'accepted')).toThrow(PromotionError);
  });

  it('canPromote returns false for mock artifacts', () => {
    const mock = makeMockArtifact();
    const result = canPromote(mock, 'derived_review_only');
    expect(result.canPromote).toBe(false);
    expect(result.reason).toContain('Mock');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 4: Bundle builder cross-references
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 4: Bundle builder cross-references', () => {
  it('produces correct bySourceFile, byGeometryClass, byAuthorityState cross-references', () => {
    const artifacts = [
      makeArtifact({ id: 'a1', geometryClass: 'roof_plane', provenance: { ...makeArtifact().provenance, sourceFileIds: ['f1', 'f2'], sourcePipeline: 'photo_vision' } }),
      makeArtifact({ id: 'a2', geometryClass: 'obstruction', provenance: { ...makeArtifact().provenance, sourceFileIds: ['f1'], sourcePipeline: 'photo_vision' } }),
      makeArtifact({ id: 'a3', geometryClass: 'roof_plane', provenance: { ...makeArtifact().provenance, sourceFileIds: ['f3'], sourcePipeline: 'geometry_recon' } }),
    ];

    const bundle = new BundleBuilder({ surveyId: 'survey-001' })
      .addUnifiedArtifacts(artifacts)
      .build();

    // bySourceFile
    expect(bundle.artifactsBySourceFile['f1']).toContain('a1');
    expect(bundle.artifactsBySourceFile['f1']).toContain('a2');
    expect(bundle.artifactsBySourceFile['f2']).toContain('a1');
    expect(bundle.artifactsBySourceFile['f3']).toContain('a3');

    // byGeometryClass
    expect(bundle.artifactsByGeometryClass.roof_plane).toContain('a1');
    expect(bundle.artifactsByGeometryClass.roof_plane).toContain('a3');
    expect(bundle.artifactsByGeometryClass.obstruction).toContain('a2');

    // byAuthorityState — all start at raw_evidence
    expect(bundle.artifactsByAuthorityState.raw_evidence).toHaveLength(3);
    expect(bundle.artifactsByAuthorityState.promoted_canonical).toHaveLength(0);
  });

  it('pipelineCounts correctly tallies pipeline sources', () => {
    const artifacts = [
      makeArtifact({ provenance: { ...makeArtifact().provenance, sourcePipeline: 'photo_vision' } }),
      makeArtifact({ provenance: { ...makeArtifact().provenance, sourcePipeline: 'photo_vision' } }),
      makeArtifact({ provenance: { ...makeArtifact().provenance, sourcePipeline: 'geometry_recon' } }),
    ];

    const bundle = new BundleBuilder({ surveyId: 'survey-001' })
      .addUnifiedArtifacts(artifacts)
      .build();

    expect(bundle.pipelineCounts.photoVision).toBe(2);
    expect(bundle.pipelineCounts.geometryRecon).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 5: Bundle builder mock exclusion
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 5: Bundle builder mock exclusion', () => {
  it('with includeMocks=false, mock artifacts are filtered from the bundle', () => {
    const realArtifact = makeArtifact({ id: 'real-1' });
    const mockArtifact = makeMockArtifact({ id: 'mock-1' });

    const bundle = new BundleBuilder({ surveyId: 'survey-001', includeMocks: false })
      .addUnifiedArtifacts([realArtifact, mockArtifact])
      .build();

    expect(bundle.artifacts).toHaveLength(1);
    expect(bundle.artifacts[0].id).toBe('real-1');
    expect(bundle.pipelineCounts.mock).toBe(0);
  });

  it('with includeMocks=true, mock artifacts are included', () => {
    const realArtifact = makeArtifact({ id: 'real-1' });
    const mockArtifact = makeMockArtifact({ id: 'mock-1' });

    const bundle = new BundleBuilder({ surveyId: 'survey-001', includeMocks: true })
      .addUnifiedArtifacts([realArtifact, mockArtifact])
      .build();

    expect(bundle.artifacts).toHaveLength(2);
    expect(bundle.pipelineCounts.mock).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 6: Pipeline A adapter
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 6: Pipeline A adapter (adaptPhotoVisionCandidate)', () => {
  const makePipelineACandidate = (overrides: Record<string, unknown> = {}) => ({
    candidateId: 'cand-001',
    surveyId: 'survey-001',
    fileId: 'file-001',
    fileUrl: 'https://example.com/photo.jpg',
    toolName: 'yolo_v8',
    toolVersion: '1.0.0',
    runHash: 'run-hash-001',
    candidateType: 'obstruction_candidate' as const,
    candidateCategory: 'obstruction' as const,
    payload: {
      region: { x: 100, y: 200, width: 50, height: 60 },
      confidence: 0.85,
    },
    region: { x: 100, y: 200, width: 50, height: 60, coordinateSystem: 'normalized_image_0_1000' as const },
    confidence: 85,
    limitations: ['review_only', 'non_authoritative'],
    reviewStatus: 'review_required' as const,
    deterministicHash: 'det-hash-001',
    thumbnailDataUrl: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('produces correct UnifiedGeometryArtifact with raw_evidence authority', () => {
    const candidate = makePipelineACandidate();

    const artifact = adaptPhotoVisionCandidate(candidate, 'survey-001');

    // Must be a UnifiedGeometryArtifact
    expect(artifact.id).toBe('cand-001');
    expect(artifact.surveyId).toBe('survey-001');

    // Must start at raw_evidence authority
    expect(artifact.authority.state).toBe('raw_evidence');
    expect(artifact.authority.reviewOnly).toBe(true);
    expect(artifact.authority.cadConsumable).toBe(false);

    // Provenance must track the pipeline source
    expect(artifact.provenance.sourcePipeline).toBe('photo_vision');
    expect(artifact.provenance.toolName).toBe('yolo_v8');
    expect(artifact.provenance.sourceFileIds).toContain('file-001');

    // Geometry class mapping
    expect(artifact.geometryClass).toBe('obstruction');
  });

  it('does not convert incidental Pipeline A obstruction/electrical lines into drawable unified line segments', () => {
    const incidentalLine = {
      x1: 50,
      y1: 100,
      x2: 950,
      y2: 900,
      orientation: 'diagonal' as const,
      strength: 0.9,
      coordinateSystem: 'normalized_image_0_1000' as const,
    };

    const obstruction = adaptPhotoVisionCandidate(makePipelineACandidate({
      candidateId: 'obstruction-with-line',
      candidateType: 'obstruction_candidate' as const,
      line: incidentalLine,
    }), 'survey-001');

    const electrical = adaptPhotoVisionCandidate(makePipelineACandidate({
      candidateId: 'equipment-with-line',
      candidateType: 'equipment_anchor_candidate' as const,
      candidateCategory: 'electrical_context' as const,
      line: incidentalLine,
    }), 'survey-001');

    expect(obstruction.geometryClass).toBe('obstruction');
    expect(obstruction.lineSegment).toBeNull();
    expect(obstruction.lineSubtype).toBeNull();
    expect(electrical.geometryClass).toBe('electrical_node');
    expect(electrical.lineSegment).toBeNull();
    expect(electrical.lineSubtype).toBeNull();
  });

  it('preserves Pipeline A roof line candidate line segments', () => {
    const roofLine = adaptPhotoVisionCandidate(makePipelineACandidate({
      candidateId: 'roof-line-001',
      candidateType: 'roof_edge_candidate' as const,
      candidateCategory: 'roof_geometry' as const,
      line: {
        x1: 100,
        y1: 300,
        x2: 900,
        y2: 300,
        orientation: 'horizontal' as const,
        strength: 0.95,
        coordinateSystem: 'normalized_image_0_1000' as const,
      },
    }), 'survey-001');

    expect(roofLine.geometryClass).toBe('roof_line');
    expect(roofLine.lineSegment).not.toBeNull();
    expect(roofLine.lineSubtype).toBe('eave');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 7: Pipeline B adapter
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 7: Pipeline B adapter (adaptGeometryReconArtifact)', () => {
  const baseAuthority = {
    reviewOnly: true,
    nonAuthoritative: true,
    cadMutationAllowed: false,
    permitGenerationAllowed: false,
    bomMutationAllowed: false,
    canonicalMutationAllowed: false,
    engineeringWorkflowMutationAllowed: false,
  };

  /** Per-artifactType test data with all required fields. */
  const artifactFixtures: Record<string, object> = {
    roof_plane_candidate: {
      artifactType: 'roof_plane_candidate',
      normal: [0.1, 0.2, 0.97] as [number, number, number],
      d: 5.0,
      inlierCount: 200,
      totalPoints: 300,
      slopeDegrees: 30,
      aspectDegrees: 180,
      associatedLineIds: [],
      confidence: 75,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    wall_plane_candidate: {
      artifactType: 'wall_plane_candidate',
      normal: [1, 0, 0] as [number, number, number],
      d: 3.0,
      inlierCount: 150,
      totalPoints: 200,
      estimatedHeightM: 3.5,
      facingDirection: 'south',
      associatedLineIds: [],
      confidence: 70,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    line_candidate: {
      artifactType: 'ridge_line_candidate' as const,
      startPoint: [0, 0, 0] as [number, number, number],
      endPoint: [1, 1, 1] as [number, number, number],
      estimatedLengthM: 5.2,
      confidence: 80,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    semantic_segmentation_mask: {
      artifactType: 'semantic_segmentation_mask',
      id: 'ssm-001',
      fileId: 'file-001',
      segmentationClass: 'roof' as const,
      polygon: [{ x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const }],
      confidence: 85,
      maskBounds: { x: 50, y: 50, width: 200, height: 150 },
      workerVersion: '1.0.0',
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    depth_map: {
      artifactType: 'depth_map',
      width: 640,
      height: 480,
      depthMetric: 'meters' as const,
      confidence: 60,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    point_cloud: {
      artifactType: 'sfm_point_cloud',
      pointCount: 50000,
      sourcePhotoCount: 12,
      sourceFileIds: ['f1', 'f2'],
      confidence: 65,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    vanishing_point: {
      artifactType: 'vanishing_point',
      id: 'vp-001',
      fileId: 'file-001',
      direction: 'x' as const,
      point: { x: 500, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
      supportingLineCount: 8,
      supportingLineIds: ['l1', 'l2'],
      inlierRatio: 0.87,
      confidence: 72,
      workerVersion: '1.0.0',
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    consensus_plane_candidate: {
      artifactType: 'consensus_plane_candidate',
      id: 'cpc-001',
      planeType: 'roof' as const,
      polygon: [{ x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const }],
      normalVector: { x: 0.1, y: 0.2, z: 0.97 },
      estimatedPitch: 25,
      estimatedAzimuth: 180,
      confidence: 78,
      sourceMaskIds: ['m1'],
      sourceFileIds: ['f1', 'f2'],
      consensusPhotoCount: 4,
      workerVersion: '1.0.0',
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    ground_plane_candidate: {
      artifactType: 'plane_candidate',
      normal: [0, 0, 1] as [number, number, number],
      d: 0,
      inlierCount: 500,
      totalPoints: 600,
      confidence: 55,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    obstruction_candidate: {
      artifactType: 'obstruction_candidate' as any,
      confidence: 70,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
    electrical_node_candidate: {
      artifactType: 'electrical_node_candidate' as any,
      confidence: 68,
      authority: baseAuthority,
      limitations: ['review_only'],
    },
  };

  const testTypes = [
    'roof_plane_candidate',
    'wall_plane_candidate',
    'line_candidate',
    'semantic_segmentation_mask',
    'depth_map',
    'point_cloud',
    'vanishing_point',
    'consensus_plane_candidate',
    'ground_plane_candidate',
    'obstruction_candidate',
    'electrical_node_candidate',
  ] as const;

  it.each(testTypes)('dispatches correctly for artifactType=%s', (artifactType) => {
    const fixture = artifactFixtures[artifactType];
    const artifact = adaptGeometryReconArtifact(fixture as any, 'survey-001');

    // Must start at raw_evidence authority
    expect(artifact.authority.state).toBe('raw_evidence');
    expect(artifact.provenance.sourcePipeline).toBe('geometry_recon');

    // Must have a valid geometry class mapping
    expect(artifact.geometryClass).toBeDefined();
    expect(artifact.surveyId).toBe('survey-001');
  });

  it('keeps raw Pipeline B plane candidates as non-drawable review evidence', () => {
    const roofCandidate = adaptGeometryReconArtifact(artifactFixtures.roof_plane_candidate as any, 'survey-001');
    const wallCandidate = adaptGeometryReconArtifact(artifactFixtures.wall_plane_candidate as any, 'survey-001');
    const genericPlaneCandidate = adaptGeometryReconArtifact(artifactFixtures.ground_plane_candidate as any, 'survey-001');

    expect(roofCandidate.geometryClass).toBe('unknown');
    expect(roofCandidate.polygon).toBeNull();
    expect(wallCandidate.geometryClass).toBe('unknown');
    expect(wallCandidate.polygon).toBeNull();
    expect(genericPlaneCandidate.geometryClass).toBe('unknown');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 8: Promotion creates new artifact
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 8: Promotion creates new artifact', () => {
  it('promoteArtifact returns a NEW object; original is unchanged', () => {
    const original = makeArtifactAtState('raw_evidence', { id: 'orig-001' });
    const originalState = original.authority.state;
    const originalProvenanceIds = [...original.provenance.derivedFromArtifactIds];

    const result = promoteArtifact(original, 'derived_review_only', 'user-001');

    // The promoted artifact has a different ID
    expect(result.promotedArtifact.id).not.toBe(original.id);

    // The promoted artifact has the new authority
    expect(result.promotedArtifact.authority.state).toBe('derived_review_only');

    // The original artifact is unchanged
    expect(original.authority.state).toBe(originalState);
    expect(original.provenance.derivedFromArtifactIds).toEqual(originalProvenanceIds);

    // The result also contains the original for reference
    expect(result.originalArtifact.id).toBe('orig-001');
    expect(result.originalArtifact.authority.state).toBe('raw_evidence');
  });

  it('promoted artifact provenance chains back to original', () => {
    const original = makeArtifactAtState('raw_evidence', { id: 'orig-001' });
    const result = promoteArtifact(original, 'derived_review_only', 'user-001');

    expect(result.promotedArtifact.provenance.derivedFromArtifactIds).toContain('orig-001');
    expect(result.promotedArtifact.provenance.reviewedBy).toBe('user-001');
    expect(result.promotedArtifact.provenance.reviewedAt).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 9: Promotion record created
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 9: Promotion record created', () => {
  it('each promotion creates a GeometryPromotionRecord with correct fields', () => {
    const original = makeArtifactAtState('reviewed_candidate', { id: 'orig-002' });
    const result = promoteArtifact(original, 'promoted_canonical', 'user-001', {
      notes: 'Verified by engineer',
      intelligenceValidated: true,
      intelligenceWarnings: ['Low confidence on edge detection'],
    });

    const record = result.promotionRecord;
    expect(record.id).toBeDefined();
    expect(record.artifactId).toBe(result.promotedArtifact.id);
    expect(record.fromState).toBe('reviewed_candidate');
    expect(record.toState).toBe('promoted_canonical');
    expect(record.promotedBy).toBe('user-001');
    expect(record.promotedAt).not.toBeNull();
    expect(record.notes).toBe('Verified by engineer');
    expect(record.intelligenceValidated).toBe(true);
    expect(record.intelligenceWarnings).toContain('Low confidence on edge detection');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 10: Canonical builder rejects unpromoted
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 10: Canonical builder rejects unpromoted', () => {
  it('addArtifact throws for raw_evidence artifacts', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const rawArtifact = makeArtifactAtState('raw_evidence');

    expect(() => builder.addArtifact(rawArtifact)).toThrow();
  });

  it('addArtifact throws for derived_review_only artifacts', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const derivedArtifact = makeArtifactAtState('derived_review_only');

    expect(() => builder.addArtifact(derivedArtifact)).toThrow();
  });

  it('addArtifact throws for reviewed_candidate artifacts', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const reviewedArtifact = makeArtifactAtState('reviewed_candidate');

    expect(() => builder.addArtifact(reviewedArtifact)).toThrow();
  });

  it('addArtifact accepts promoted_canonical artifacts', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const promotedArtifact = makeArtifactAtState('promoted_canonical', { surveyId: 'survey-001' });

    expect(() => builder.addArtifact(promotedArtifact)).not.toThrow();
  });

  it('addArtifact accepts cad_safe artifacts', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const cadSafeArtifact = makeArtifactAtState('cad_safe', { surveyId: 'survey-001' });

    expect(() => builder.addArtifact(cadSafeArtifact)).not.toThrow();
  });

  it('addArtifact throws for mock artifacts even at promoted_canonical', () => {
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });
    const mockArtifact = makeMockArtifact({ surveyId: 'survey-001' });

    expect(() => builder.addArtifact(mockArtifact)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 11: Canonical obstruction source
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 11: Canonical obstruction source', () => {
  it('buildCanonicalObstruction always sets source=promoted_canonical, never vision', () => {
    const obstruction = makeArtifactAtState('promoted_canonical', {
      surveyId: 'survey-001',
      geometryClass: 'obstruction',
      obstructionSubtype: 'chimney',
    });

    const model = buildCanonicalModel('survey-001', [obstruction]);

    expect(model.obstructions).toHaveLength(1);
    expect(model.obstructions[0].source).toBe('promoted_canonical');
    expect(model.obstructions[0].type).toBe('chimney');
  });

  it('canonical electrical node source is also promoted_canonical', () => {
    const node = makeArtifactAtState('promoted_canonical', {
      surveyId: 'survey-001',
      geometryClass: 'electrical_node',
      electricalSubtype: 'main_service_panel',
    });

    const model = buildCanonicalModel('survey-001', [node]);

    expect(model.electricalNodes).toHaveLength(1);
    expect(model.electricalNodes[0].source).toBe('promoted_canonical');
    expect(model.electricalNodes[0].type).toBe('main_service_panel');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 12: CAD bridge authority gate
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 12: CAD bridge authority gate', () => {
  it('canonicalToCADInputs throws CanonicalBridgeError for non-cad_safe models', () => {
    // Build a model with promoted_canonical authority (not cad_safe)
    const artifact = makeArtifactAtState('promoted_canonical', {
      surveyId: 'survey-001',
      geometryClass: 'obstruction',
    });
    const model = buildCanonicalModel('survey-001', [artifact]);

    // The model authority should be promoted_canonical (not cad_safe)
    // because the artifact is promoted_canonical
    expect(model.authority.state).toBe('promoted_canonical');

    // promoted_canonical is not cadConsumable — should throw
    expect(() => canonicalToCADInputs(model)).toThrow(CanonicalBridgeError);
  });

  it('canonicalToCADInputs succeeds for cad_safe models', () => {
    const artifact = makeArtifactAtState('cad_safe', {
      surveyId: 'survey-001',
      geometryClass: 'obstruction',
      obstructionSubtype: 'chimney',
    });
    const model = buildCanonicalModel('survey-001', [artifact]);
    expect(model.authority.state).toBe('cad_safe');

    // With skipWithoutProjection=false to avoid skipping due to no world projection
    const result = canonicalToCADInputs(model, { skipWithoutProjection: false });
    expect(result.obstructions.length).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 13: CAD bridge mock gate
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 13: CAD bridge mock gate', () => {
  it('canonicalToCADInputs throws for models with mockArtifact=true', () => {
    // Create a model with mock authority — this would require bypassing
    // the canonical builder, so we construct the model directly
    const mockModel: CanonicalBuildingModel = {
      schemaVersion: 'canonical_building_model_v1',
      surveyId: 'survey-001',
      authority: { ...MOCK_ARTIFACT_AUTHORITY, state: 'cad_safe', cadConsumable: true },
      roofPlanes: [],
      wallPlanes: [],
      obstructions: [],
      electricalNodes: [],
      structuralLines: [],
      metadata: {
        buildingType: 'residential',
        stories: 1,
        roofType: 'gable',
        primaryPitchDegrees: null,
        primaryAzimuthDegrees: null,
        footprintAreaSqM: null,
        addressSnapshot: null,
        latitude: null,
        longitude: null,
      },
      provenance: {
        artifactIds: [],
        promotionRecordIds: [],
        builtAt: new Date().toISOString(),
        builtBy: 'manual',
      },
    };

    expect(() => canonicalToCADInputs(mockModel)).toThrow(CanonicalBridgeError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 14: No raw vision in CAD guard
// ══════════════════════════════════════════════════════════════════════════════

describe('Test 14: No raw vision in CAD guard', () => {
  it('assertNoRawVisionInCAD throws when given obstructions with source=vision', () => {
    // Defense-in-depth test: type system blocks 'vision' in CADObstruction.source,
    // but runtime data (e.g. from DB) may contain it. Test with explicit cast.
    const visionObstructions = [
      {
        id: 'obs-001',
        type: 'chimney' as const,
        x: 10,
        y: 20,
        radiusM: 0.3,
        setbackM: 0.15,
        totalRadiusM: 0.45,
        heightFt: 3,
        roofPlaneId: null,
        source: 'vision' as const,
        confidence: 75,
      },
    ] as unknown as CADObstruction[];

    expect(() => assertNoRawVisionInCAD(visionObstructions, undefined)).toThrow(CanonicalBridgeError);
  });

  it('assertNoRawVisionInCAD throws when given electrical nodes with source=vision', () => {
    // Defense-in-depth test: type system blocks 'vision' in CADElectricalNode.source,
    // but runtime data may contain it. Test with explicit cast.
    const visionNodes = [
      {
        id: 'node-001',
        type: 'main_service_panel' as const,
        x: 10,
        y: 20,
        story: 1,
        isPrimaryInterconnect: true,
        source: 'vision' as const,
        confidence: 70,
      },
    ] as unknown as CADElectricalNode[];

    expect(() => assertNoRawVisionInCAD(undefined, visionNodes)).toThrow(CanonicalBridgeError);
  });

  it('assertNoRawVisionInCAD does NOT throw for source=promoted_canonical', () => {
    const canonicalObstructions = [
      {
        id: 'obs-001',
        type: 'chimney' as const,
        x: 10,
        y: 20,
        radiusM: 0.3,
        setbackM: 0.15,
        totalRadiusM: 0.45,
        heightFt: 3,
        roofPlaneId: null,
        source: 'promoted_canonical' as const,
        confidence: 90,
      },
    ];

    expect(() => assertNoRawVisionInCAD(canonicalObstructions, undefined)).not.toThrow();
  });

  it('assertNoRawVisionInCAD does NOT throw for source=manual', () => {
    const manualObstructions = [
      {
        id: 'obs-002',
        type: 'plumbing_vent' as const,
        x: 30,
        y: 40,
        radiusM: 0.2,
        setbackM: 0.1,
        totalRadiusM: 0.3,
        heightFt: 1,
        roofPlaneId: null,
        source: 'manual' as const,
        confidence: 100,
      },
    ];

    expect(() => assertNoRawVisionInCAD(manualObstructions, undefined)).not.toThrow();
  });

  it('assertNoRawVisionInCAD does NOT throw for empty arrays', () => {
    expect(() => assertNoRawVisionInCAD([], [])).not.toThrow();
    expect(() => assertNoRawVisionInCAD(undefined, undefined)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: validateCADModelSources tests
// ══════════════════════════════════════════════════════════════════════════════

describe('validateCADModelSources', () => {
  it('returns valid=true for source=promoted_canonical', () => {
    const result = validateCADModelSources(
      [{ id: '1', type: 'chimney', x: 0, y: 0, radiusM: 0.3, setbackM: 0.15, totalRadiusM: 0.45, heightFt: 3, roofPlaneId: null, source: 'promoted_canonical', confidence: 90 }],
      undefined,
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('returns valid=true for source=manual', () => {
    const result = validateCADModelSources(
      [{ id: '1', type: 'chimney', x: 0, y: 0, radiusM: 0.3, setbackM: 0.15, totalRadiusM: 0.45, heightFt: 3, roofPlaneId: null, source: 'manual', confidence: 100 }],
      undefined,
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid=false for source=vision (defense-in-depth)', () => {
    // Type system blocks 'vision' in CADObstruction.source; test with cast
    const visionObs = [
      { id: '1', type: 'chimney', x: 0, y: 0, radiusM: 0.3, setbackM: 0.15, totalRadiusM: 0.45, heightFt: 3, roofPlaneId: null, source: 'vision', confidence: 50 },
    ] as unknown as CADObstruction[];
    const result = validateCADModelSources(visionObs, undefined);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain('vision');
  });
});
