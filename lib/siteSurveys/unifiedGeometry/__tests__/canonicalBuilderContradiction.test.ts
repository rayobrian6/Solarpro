/**
 * Canonical Builder Contradiction Gate Integration Tests
 *
 * Tests that the CanonicalModelBuilder production path correctly calls
 * assertNoContradictionBlock() when adding artifacts, proving that the
 * contradiction promotion gate (P0-4.2) is wired into the production
 * canonical builder path — not just in unit tests for the function itself.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CanonicalModelBuilder,
  buildCanonicalModel,
  CanonicalBuilderError,
} from '../canonicalBuilder';
import type { UnifiedGeometryArtifact } from '../types';
import { PROMOTED_CANONICAL_AUTHORITY } from '../authority';
import type { DepthContradictionReport } from '../../geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a valid UnifiedGeometryArtifact at promoted_canonical. */
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
// CanonicalModelBuilder with Contradiction Gate (P0-4.2 wiring)
// ===========================================================================

describe('CanonicalModelBuilder: contradiction gate wired in production path', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // -----------------------------------------------------------------------
  // Test 1: Production canonical builder calls the contradiction gate
  // -----------------------------------------------------------------------

  it('calls the contradiction gate when adding an artifact', () => {
    // Enable the contradiction gate
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const blockingReport = makeContradictionReport({
      maskId: 'art-001', // matches artifact ID
      severity: 'major',
      deviation: 0.25,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [blockingReport],
    });

    const artifact = makeArtifact({ id: 'art-001' });

    // The builder should throw because the contradiction gate blocks it
    expect(() => builder.addArtifact(artifact)).toThrow(
      /CANONICAL_MODEL_VIOLATION.*depth-class contradiction/,
    );
  });

  // -----------------------------------------------------------------------
  // Test 2: Blocking contradiction prevents promotion when flag is ON
  // -----------------------------------------------------------------------

  it('blocking contradiction prevents artifact from being added when flag is ON', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const moderateReport = makeContradictionReport({
      maskId: 'art-blocked',
      severity: 'moderate',
      deviation: 0.15,
    });

    const majorReport = makeContradictionReport({
      maskId: 'art-blocked-2',
      severity: 'major',
      deviation: 0.30,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [moderateReport, majorReport],
    });

    // Moderate contradiction blocks
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-blocked' }))).toThrow();

    // Major contradiction blocks
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-blocked-2' }))).toThrow();
  });

  // -----------------------------------------------------------------------
  // Test 3: Same artifact promotes when flag is OFF
  // -----------------------------------------------------------------------

  it('same artifact is added successfully when contradiction gate flag is OFF', () => {
    // Do NOT enable the flag
    delete process.env.PHASE0_CONTRADICTION_PROMOTION_GATE;

    const blockingReport = makeContradictionReport({
      maskId: 'art-001',
      severity: 'major',
      deviation: 0.30,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [blockingReport],
    });

    const artifact = makeArtifact({ id: 'art-001' });

    // Should NOT throw — flag is OFF, so the gate is a no-op
    expect(() => builder.addArtifact(artifact)).not.toThrow();

    // Verify the artifact was actually added
    const model = builder.build();
    expect(model.roofPlanes).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Test 4: Non-blocking contradiction does not prevent promotion
  // -----------------------------------------------------------------------

  it('non-blocking contradiction (severity none/minor) does not prevent addition', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const noneReport = makeContradictionReport({
      maskId: 'art-none',
      severity: 'none',
      deviation: 0.03,
    });

    const minorReport = makeContradictionReport({
      maskId: 'art-minor',
      severity: 'minor',
      deviation: 0.07,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [noneReport, minorReport],
    });

    // Neither 'none' nor 'minor' should block
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-none' }))).not.toThrow();
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-minor' }))).not.toThrow();

    const model = builder.build();
    expect(model.roofPlanes).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Test 5: Existing geometry/confidence gates still work
  // -----------------------------------------------------------------------

  it('geometry gate still blocks artifacts without geometry when enabled', () => {
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = 'true';
    // Do NOT enable contradiction gate
    delete process.env.PHASE0_CONTRADICTION_PROMOTION_GATE;

    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });

    const noGeometryArtifact = makeArtifact({
      id: 'art-no-geo',
      polygon: null,
      bbox: null,
    });

    expect(() => builder.addArtifact(noGeometryArtifact)).toThrow(
      /CANONICAL_MODEL_VIOLATION.*no geometry/,
    );
  });

  it('confidence gate still blocks low-confidence artifacts when enabled', () => {
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE = 'true';
    delete process.env.PHASE0_CONTRADICTION_PROMOTION_GATE;

    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });

    const lowConfidenceArtifact = makeArtifact({
      id: 'art-low-conf',
      confidence: 30,
    });

    expect(() => builder.addArtifact(lowConfidenceArtifact)).toThrow(
      /CANONICAL_MODEL_VIOLATION.*minimum confidence threshold/,
    );
  });

  it('all three gates work together (geometry + confidence + contradiction)', () => {
    process.env.PHASE0_CANONICAL_GEOMETRY_GATE = 'true';
    process.env.PHASE0_CANONICAL_MIN_CONFIDENCE = 'true';
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const blockingReport = makeContradictionReport({
      maskId: 'art-contradicted',
      severity: 'major',
      deviation: 0.25,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [blockingReport],
    });

    // Good artifact: passes all gates
    const goodArtifact = makeArtifact({ id: 'art-good', confidence: 75 });
    expect(() => builder.addArtifact(goodArtifact)).not.toThrow();

    // Contradicted artifact: fails contradiction gate
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-contradicted' }))).toThrow(
      /depth-class contradiction/,
    );

    // Low confidence artifact: fails confidence gate
    expect(() => builder.addArtifact(makeArtifact({ id: 'art-low-conf', confidence: 30 }))).toThrow(
      /minimum confidence threshold/,
    );

    const model = builder.build();
    expect(model.roofPlanes).toHaveLength(1); // only the good one
  });

  // -----------------------------------------------------------------------
  // Test 6: Contradiction gate with no reports provided (backward compat)
  // -----------------------------------------------------------------------

  it('builder works without contradiction reports (backward compatible)', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    // No contradiction reports provided — should work like before
    const builder = new CanonicalModelBuilder({ surveyId: 'survey-001' });

    const artifact = makeArtifact({ id: 'art-001' });
    expect(() => builder.addArtifact(artifact)).not.toThrow();

    const model = builder.build();
    expect(model.roofPlanes).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Test 7: Contradiction gate matches via provenance derivedFromArtifactIds
  // -----------------------------------------------------------------------

  it('contradiction gate matches artifact via provenance derivedFromArtifactIds', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const blockingReport = makeContradictionReport({
      maskId: 'original-mask-id', // matches in derivedFromArtifactIds
      severity: 'moderate',
      deviation: 0.15,
    });

    const builder = new CanonicalModelBuilder({
      surveyId: 'survey-001',
      contradictionReports: [blockingReport],
    });

    const derivedArtifact = makeArtifact({
      id: 'promoted-artifact-id',
      provenance: {
        sourcePipeline: 'geometry_reconstruction',
        toolName: 'test-tool',
        toolVersion: '1.0.0',
        runHash: 'hash-001',
        sourceFileIds: ['file-001'],
        derivedFromArtifactIds: ['original-mask-id'], // linked to the mask
        createdAt: new Date().toISOString(),
        reviewedBy: null,
        reviewedAt: null,
        workerVersion: null,
      },
    });

    expect(() => builder.addArtifact(derivedArtifact)).toThrow(
      /CANONICAL_MODEL_VIOLATION.*depth-class contradiction/,
    );
  });
});

// ===========================================================================
// buildCanonicalModel convenience function with contradiction reports
// ===========================================================================

describe('buildCanonicalModel convenience function with contradiction reports', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('passes contradiction reports through to the builder', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const blockingReport = makeContradictionReport({
      maskId: 'art-blocked',
      severity: 'major',
      deviation: 0.25,
    });

    const goodArtifact = makeArtifact({ id: 'art-good' });
    const blockedArtifact = makeArtifact({ id: 'art-blocked' });

    // The convenience function should reject the blocked artifact
    expect(() => {
      buildCanonicalModel(
        'survey-001',
        [goodArtifact, blockedArtifact],
        [],
        { contradictionReports: [blockingReport] },
      );
    }).toThrow(/depth-class contradiction/);
  });

  it('builds successfully when no contradictions block', () => {
    process.env.PHASE0_CONTRADICTION_PROMOTION_GATE = 'true';

    const minorReport = makeContradictionReport({
      maskId: 'art-minor',
      severity: 'minor',
      deviation: 0.07,
    });

    const artifact1 = makeArtifact({ id: 'art-001' });
    const artifact2 = makeArtifact({ id: 'art-minor' });

    const model = buildCanonicalModel(
      'survey-001',
      [artifact1, artifact2],
      [],
      { contradictionReports: [minorReport] },
    );

    expect(model.roofPlanes).toHaveLength(2);
  });
});
