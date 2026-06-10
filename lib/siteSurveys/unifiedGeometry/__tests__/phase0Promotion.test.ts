/**
 * Phase 0 Canonical Promotion Quality Gate Tests (P0-4.1, P0-4.2, P0-4.3)
 *
 * Covers:
 *   - P0-4.1: Geometry presence check — block artifacts without polygon/bbox
 *   - P0-4.2: Contradiction-aware promotion validation — block moderate/major
 *   - P0-4.3: Minimum confidence threshold for canonical promotion
 *   - Feature flag helpers for all three gates
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertCanonicalEligible,
  assertNoContradictionBlock,
  isPhase0CanonicalGeometryGateEnabled,
  isPhase0ContradictionPromotionGateEnabled,
  isPhase0CanonicalMinConfidenceEnabled,
  getCanonicalMinConfidenceThreshold,
  PromotionError,
} from '../promotion';
import type { UnifiedGeometryArtifact } from '../types';
import {
  PROMOTED_CANONICAL_AUTHORITY,
  RAW_EVIDENCE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
  getAuthorityForState,
} from '../authority';
import type { DepthContradictionReport } from '../../geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a valid UnifiedGeometryArtifact at promoted_canonical.
 *  Uses 'in' checks for nullable geometry fields so that explicitly
 *  passing null (e.g., bbox: null) is respected instead of falling
 *  through to the default value via ?? operator.
 */
function makeArtifact(
  overrides: Partial<UnifiedGeometryArtifact> & { id?: string } = {},
): UnifiedGeometryArtifact {
  const defaultPolygon = [
    { x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 300, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 300, y: 250, coordinateSystem: 'normalized_image_0_1000' as const },
    { x: 100, y: 250, coordinateSystem: 'normalized_image_0_1000' as const },
  ];
  const defaultBbox = { x: 100, y: 100, width: 200, height: 150, coordinateSystem: 'normalized_image_0_1000' as const };
  return {
    id: overrides.id ?? 'art-001',
    surveyId: overrides.surveyId ?? 'survey-001',
    geometryClass: overrides.geometryClass ?? 'roof_plane',
    authority: overrides.authority ?? PROMOTED_CANONICAL_AUTHORITY,
    provenance: overrides.provenance ?? {
      sourcePipeline: 'geometry_reconstruction',
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
    // Use 'in' check: null is a valid override, ?? would replace it with default
    bbox: 'bbox' in overrides ? overrides.bbox! : defaultBbox,
    polygon: 'polygon' in overrides ? overrides.polygon! : defaultPolygon,
    lineSegment: 'lineSegment' in overrides ? overrides.lineSegment : null,
    center: 'center' in overrides ? overrides.center : null,
    planeType: overrides.planeType ?? null,
    pitchDegrees: overrides.pitchDegrees ?? null,
    azimuthDegrees: overrides.azimuthDegrees ?? null,
    normalVector: overrides.normalVector ?? null,
    areaSqM: overrides.areaSqM ?? null,
    inlierCount: overrides.inlierCount ?? null,
    totalPoints: overrides.totalPoints ?? null,
    lineSubtype: overrides.lineSubtype ?? null,
    estimatedLengthM: overrides.estimatedLengthM ?? null,
    obstructionSubtype: overrides.obstructionSubtype ?? null,
    radiusM: overrides.radiusM ?? null,
    setbackM: overrides.setbackM ?? null,
    heightFt: overrides.heightFt ?? null,
    roofPlaneId: overrides.roofPlaneId ?? null,
    cadImpact: overrides.cadImpact ?? null,
    electricalSubtype: overrides.electricalSubtype ?? null,
    story: overrides.story ?? null,
    isPrimaryInterconnect: overrides.isPrimaryInterconnect ?? null,
    depthResolution: overrides.depthResolution ?? null,
    depthMetric: overrides.depthMetric ?? null,
    consensusPhotoCount: overrides.consensusPhotoCount ?? null,
    segmentationClass: overrides.segmentationClass ?? null,
    reviewState: overrides.reviewState ?? 'accepted',
    reviewNotes: overrides.reviewNotes ?? null,
    priority: overrides.priority ?? 'medium',
    stageTimings: overrides.stageTimings ?? null,
    isSynthetic: overrides.isSynthetic ?? false,
  };
}

/** Create a DepthContradictionReport for testing. */
function makeContradictionReport(
  overrides: Partial<DepthContradictionReport> = {},
): DepthContradictionReport {
  return {
    segmentationClass: overrides.segmentationClass ?? 'roof',
    maskId: overrides.maskId ?? 'mask-001',
    expectedRange: overrides.expectedRange ?? [0.25, 0.75],
    actualDepth: overrides.actualDepth ?? 0.90,
    deviation: overrides.deviation ?? 0.15,
    severity: overrides.severity ?? 'moderate',
    confidencePenalty: overrides.confidencePenalty ?? 15,
    description: overrides.description ?? 'Test contradiction',
  };
}

// ===========================================================================
// P0-4.1: Feature flag — isPhase0CanonicalGeometryGateEnabled
// ===========================================================================

describe('P0-4.1: isPhase0CanonicalGeometryGateEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when PHASE0_CANONICAL_GEOMETRY_GATE is not set', () => {
    delete process.env.PHASE0_CANONICAL_GEOMETRY_GATE;
    expect(isPhase0CanonicalGeometryGateEnabled()).toBe(false);
  });

  it('returns true when PHASE0_CANONICAL_GEOMETRY_GATE is "true"', () => {
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = 'true';
    expect(isPhase0CanonicalGeometryGateEnabled()).toBe(true);
  });

  it('returns true when PHASE0_CANONICAL_GEOMETRY_GATE is "1"', () => {
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = '1';
    expect(isPhase0CanonicalGeometryGateEnabled()).toBe(true);
  });
});

// ===========================================================================
// P0-4.1: Geometry presence check — assertCanonicalEligible
// ===========================================================================

describe('P0-4.1: Geometry presence check in assertCanonicalEligible', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('passes for roof_plane with polygon', () => {
    const artifact = makeArtifact({ geometryClass: 'roof_plane', polygon: [{ x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' }], bbox: null });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('passes for roof_plane with bbox (no polygon)', () => {
    const artifact = makeArtifact({ geometryClass: 'roof_plane', polygon: null, bbox: { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' } });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('throws for roof_plane with neither polygon nor bbox', () => {
    const artifact = makeArtifact({ geometryClass: 'roof_plane', polygon: null, bbox: null });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*no geometry/);
  });

  it('throws for wall_plane with neither polygon nor bbox', () => {
    const artifact = makeArtifact({ geometryClass: 'wall_plane', polygon: null, bbox: null });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*no geometry/);
  });

  it('throws for consensus_plane with neither polygon nor bbox', () => {
    const artifact = makeArtifact({ geometryClass: 'consensus_plane', polygon: null, bbox: null });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*no geometry/);
  });

  it('throws for roof_line with no line segment', () => {
    const artifact = makeArtifact({ geometryClass: 'roof_line', lineSegment: null });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*no line segment/);
  });

  it('passes for roof_line with line segment', () => {
    const artifact = makeArtifact({
      geometryClass: 'roof_line',
      lineSegment: {
        start: { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' },
      },
    });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('throws for obstruction with no center and no bbox', () => {
    const artifact = makeArtifact({ geometryClass: 'obstruction', center: null, bbox: null });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*no center point or bbox/);
  });

  it('passes for obstruction with center (no bbox)', () => {
    const artifact = makeArtifact({ geometryClass: 'obstruction', center: { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' }, bbox: null });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('does NOT throw when gate flag is disabled', () => {
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = '';
    const artifact = makeArtifact({ geometryClass: 'roof_plane', polygon: null, bbox: null });
    // Without the flag, geometry absence is not checked
    // But mock/synthetic checks still apply — use a non-mock, non-synthetic artifact
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });
});

// ===========================================================================
// P0-4.2: Feature flag — isPhase0ContradictionPromotionGateEnabled
// ===========================================================================

describe('P0-4.2: isPhase0ContradictionPromotionGateEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when PHASE0_CONTRADICTION_PROMOTION_GATE is not set', () => {
    delete process.env.PHASE0_CONTRADICTION_PROMOTION_GATE;
    expect(isPhase0ContradictionPromotionGateEnabled()).toBe(false);
  });

  it('returns true when PHASE0_CONTRADICTION_PROMOTION_GATE is "true"', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';
    expect(isPhase0ContradictionPromotionGateEnabled()).toBe(true);
  });
});

// ===========================================================================
// P0-4.2: assertNoContradictionBlock
// ===========================================================================

describe('P0-4.2: assertNoContradictionBlock', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('passes when there are no contradiction reports', () => {
    const artifact = makeArtifact();
    expect(() => assertNoContradictionBlock(artifact, [])).not.toThrow();
  });

  it('passes when contradiction reports have severity "none"', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'art-mask-001', severity: 'none' })];
    expect(() => assertNoContradictionBlock(artifact, reports)).not.toThrow();
  });

  it('passes when contradiction reports have severity "minor"', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'art-mask-001', severity: 'minor' })];
    expect(() => assertNoContradictionBlock(artifact, reports)).not.toThrow();
  });

  it('throws when artifact ID matches a "moderate" contradiction report', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'art-mask-001', severity: 'moderate' })];
    expect(() => assertNoContradictionBlock(artifact, reports)).toThrow(/CANONICAL_MODEL_VIOLATION.*contradiction/);
  });

  it('throws when artifact ID matches a "major" contradiction report', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'art-mask-001', severity: 'major', deviation: 0.65 })];
    expect(() => assertNoContradictionBlock(artifact, reports)).toThrow(/CANONICAL_MODEL_VIOLATION.*contradiction/);
  });

  it('matches via provenance derivedFromArtifactIds', () => {
    const artifact = makeArtifact({
      id: 'art-derived-001',
      provenance: {
        sourcePipeline: 'geometry_reconstruction',
        toolName: 'test-tool',
        toolVersion: '1.0.0',
        runHash: 'hash-001',
        sourceFileIds: ['file-001'],
        derivedFromArtifactIds: ['mask-orig-001'],
        createdAt: new Date().toISOString(),
        reviewedBy: null,
        reviewedAt: null,
        workerVersion: null,
      },
    });
    const reports = [makeContradictionReport({ maskId: 'mask-orig-001', severity: 'major', deviation: 0.50 })];
    expect(() => assertNoContradictionBlock(artifact, reports)).toThrow(/CANONICAL_MODEL_VIOLATION/);
  });

  it('does NOT throw for non-matching mask IDs', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'mask-other-999', severity: 'major', deviation: 0.50 })];
    expect(() => assertNoContradictionBlock(artifact, reports)).not.toThrow();
  });

  it('does NOT throw when gate flag is disabled', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = '';
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [makeContradictionReport({ maskId: 'art-mask-001', severity: 'major', deviation: 0.50 })];
    expect(() => assertNoContradictionBlock(artifact, reports)).not.toThrow();
  });

  it('reports worst contradiction in error message', () => {
    const artifact = makeArtifact({ id: 'art-mask-001' });
    const reports = [
      makeContradictionReport({ maskId: 'art-mask-001', severity: 'moderate', deviation: 0.12, actualDepth: 0.88 }),
      makeContradictionReport({ maskId: 'art-mask-001', severity: 'major', deviation: 0.50, actualDepth: 0.10 }),
    ];
    try {
      assertNoContradictionBlock(artifact, reports);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('major');
    }
  });
});

// ===========================================================================
// P0-4.3: Feature flags — isPhase0CanonicalMinConfidenceEnabled, getCanonicalMinConfidenceThreshold
// ===========================================================================

describe('P0-4.3: Min confidence feature flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('isPhase0CanonicalMinConfidenceEnabled returns false when not set', () => {
    delete process.env.PHASE0_CANONICAL_MIN_CONFIDENCE;
    expect(isPhase0CanonicalMinConfidenceEnabled()).toBe(false);
  });

  it('isPhase0CanonicalMinConfidenceEnabled returns true when "true"', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE = 'true';
    expect(isPhase0CanonicalMinConfidenceEnabled()).toBe(true);
  });

  it('getCanonicalMinConfidenceThreshold defaults to 50 when not set', () => {
    delete process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD;
    expect(getCanonicalMinConfidenceThreshold()).toBe(50);
  });

  it('getCanonicalMinConfidenceThreshold reads from env var', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = '65';
    expect(getCanonicalMinConfidenceThreshold()).toBe(65);
  });

  it('getCanonicalMinConfidenceThreshold clamps negative to default 50', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = '-10';
    expect(getCanonicalMinConfidenceThreshold()).toBe(50);
  });

  it('getCanonicalMinConfidenceThreshold clamps >100 to default 50', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = '150';
    expect(getCanonicalMinConfidenceThreshold()).toBe(50);
  });

  it('getCanonicalMinConfidenceThreshold handles non-numeric as default 50', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = 'abc';
    expect(getCanonicalMinConfidenceThreshold()).toBe(50);
  });
});

// ===========================================================================
// P0-4.3: Minimum confidence threshold in assertCanonicalEligible
// ===========================================================================

describe('P0-4.3: Min confidence check in assertCanonicalEligible', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE = 'true';
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = '50';
    // Disable geometry gate to isolate confidence check
    delete process.env.PHASE0_CANONICAL_GEOMETRY_GATE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('passes for artifact with confidence above threshold', () => {
    const artifact = makeArtifact({ confidence: 75 });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('passes for artifact with confidence equal to threshold', () => {
    const artifact = makeArtifact({ confidence: 50 });
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('throws for artifact with confidence below threshold', () => {
    const artifact = makeArtifact({ confidence: 35 });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/CANONICAL_MODEL_VIOLATION.*minimum confidence/);
  });

  it('error message includes actual confidence and threshold', () => {
    const artifact = makeArtifact({ confidence: 35 });
    try {
      assertCanonicalEligible(artifact);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toContain('35');
      expect(msg).toContain('50');
    }
  });

  it('does NOT throw when min confidence flag is disabled', () => {
    delete process.env.PHASE0_CANONICAL_MIN_CONFIDENCE;
    const artifact = makeArtifact({ confidence: 35 });
    // With flag off, low confidence is allowed
    expect(() => assertCanonicalEligible(artifact)).not.toThrow();
  });

  it('uses custom threshold from env var', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD = '65';
    // Confidence 60 < 65 → should throw
    const artifact = makeArtifact({ confidence: 60 });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/minimum confidence/);
  });

  it('catches Canny fallback confidence (35) with default threshold (50)', () => {
    // This is the key contamination case: Canny fallback produces roof_plane
    // at confidence 35, which is below the 50 threshold
    const artifact = makeArtifact({ confidence: 35, geometryClass: 'roof_plane' });
    expect(() => assertCanonicalEligible(artifact)).toThrow(/minimum confidence/);
  });
});
