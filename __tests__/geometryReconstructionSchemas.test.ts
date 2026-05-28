/**
 * Tests for geometry reconstruction schemas / validators.
 *
 * Validates:
 * - Valid payloads pass
 * - Invalid payloads fail
 * - Authority enforcement (all mutation flags must be false)
 * - Unknown artifact rejection
 */

import {
  validateSegmentationMask,
  validateDepthMap,
  validateSfMPointCloud,
  validatePlaneCandidate,
  validateRoofPlaneCandidate,
  validateWallPlaneCandidate,
  validateLineCandidate,
  validateGeometryReconstructionArtifact,
  validateAuthority,
  REVIEW_ONLY_AUTHORITY,
} from '@/lib/siteSurveys/geometryReconstruction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validAuthority = { ...REVIEW_ONLY_AUTHORITY };
const validLimitations = ['REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'];

function makeSegmentationMask(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'segmentation_mask',
    fileId: 'file-001',
    width: 64,
    height: 64,
    maskData: 'AAAAAA==',
    classLabels: { 0: 'roof', 1: 'wall', 2: 'sky' },
    confidence: 75,
    authority: validAuthority,
    limitations: validLimitations,
    ...overrides,
  };
}

function makeDepthMap(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'depth_map',
    fileId: 'file-001',
    width: 64,
    height: 64,
    depthData: 'AAAAAA==',
    depthMetric: 'meters',
    confidence: 70,
    authority: validAuthority,
    limitations: validLimitations,
    ...overrides,
  };
}

function makeSfMPointCloud(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'sfm_point_cloud',
    pointCount: 500,
    pointsData: 'AAAAAA==',
    sourcePhotoCount: 5,
    sourceFileIds: ['file-001', 'file-002'],
    confidence: 60,
    authority: validAuthority,
    limitations: validLimitations,
    ...overrides,
  };
}

function makePlaneCandidate(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'plane_candidate',
    normal: [0, 0, 1] as [number, number, number],
    d: 2.5,
    inlierCount: 200,
    totalPoints: 300,
    confidence: 80,
    authority: validAuthority,
    limitations: validLimitations,
    ...overrides,
  };
}

function makeRoofPlaneCandidate(overrides: Record<string, unknown> = {}) {
  return {
    ...makePlaneCandidate(),
    artifactType: 'roof_plane_candidate',
    slopeDegrees: 30,
    aspectDegrees: 180,
    associatedLineIds: ['line-001'],
    ...overrides,
  };
}

function makeWallPlaneCandidate(overrides: Record<string, unknown> = {}) {
  return {
    ...makePlaneCandidate(),
    artifactType: 'wall_plane_candidate',
    estimatedHeightM: 3.2,
    facingDirection: 'south',
    associatedLineIds: ['line-002'],
    ...overrides,
  };
}

function makeLineCandidate(type: 'ridge_line_candidate' | 'eave_line_candidate' | 'rake_line_candidate' = 'ridge_line_candidate', overrides: Record<string, unknown> = {}) {
  return {
    artifactType: type,
    startPoint: [1, 2, 3] as [number, number, number],
    endPoint: [4, 5, 6] as [number, number, number],
    estimatedLengthM: 8.5,
    confidence: 65,
    authority: validAuthority,
    limitations: validLimitations,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Authority validation
// ---------------------------------------------------------------------------

describe('validateAuthority', () => {
  it('accepts valid review-only authority', () => {
    const result = validateAuthority(validAuthority);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.reviewOnly).toBe(true);
      expect(result.data.nonAuthoritative).toBe(true);
      expect(result.data.cadMutationAllowed).toBe(false);
      expect(result.data.permitGenerationAllowed).toBe(false);
      expect(result.data.bomMutationAllowed).toBe(false);
    }
  });

  it('rejects authority with cadMutationAllowed: true', () => {
    const result = validateAuthority({ ...validAuthority, cadMutationAllowed: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('cadMutationAllowed'))).toBe(true);
    }
  });

  it('rejects authority with permitGenerationAllowed: true', () => {
    const result = validateAuthority({ ...validAuthority, permitGenerationAllowed: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('permitGenerationAllowed'))).toBe(true);
    }
  });

  it('rejects authority with bomMutationAllowed: true', () => {
    const result = validateAuthority({ ...validAuthority, bomMutationAllowed: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('bomMutationAllowed'))).toBe(true);
    }
  });

  it('rejects authority with reviewOnly: false', () => {
    const result = validateAuthority({ ...validAuthority, reviewOnly: false });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('reviewOnly'))).toBe(true);
    }
  });

  it('rejects authority with nonAuthoritative: false', () => {
    const result = validateAuthority({ ...validAuthority, nonAuthoritative: false });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('nonAuthoritative'))).toBe(true);
    }
  });

  it('rejects null authority', () => {
    const result = validateAuthority(null);
    expect(result.valid).toBe(false);
  });

  it('rejects non-object authority', () => {
    const result = validateAuthority('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('rejects authority with multiple violations', () => {
    const result = validateAuthority({
      reviewOnly: false,
      nonAuthoritative: false,
      cadMutationAllowed: true,
      permitGenerationAllowed: true,
      bomMutationAllowed: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

// ---------------------------------------------------------------------------
// SegmentationMask validation
// ---------------------------------------------------------------------------

describe('validateSegmentationMask', () => {
  it('accepts a valid segmentation mask', () => {
    const result = validateSegmentationMask(makeSegmentationMask());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('segmentation_mask');
      expect(result.data.confidence).toBe(75);
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateSegmentationMask(makeSegmentationMask({ artifactType: 'depth_map' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('artifactType'))).toBe(true);
    }
  });

  it('rejects missing fileId', () => {
    const { fileId: _, ...withoutFileId } = makeSegmentationMask();
    const result = validateSegmentationMask(withoutFileId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('fileId'))).toBe(true);
    }
  });

  it('rejects non-number width', () => {
    const result = validateSegmentationMask(makeSegmentationMask({ width: 'not-a-number' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('width'))).toBe(true);
    }
  });

  it('rejects missing classLabels', () => {
    const { classLabels: _, ...withoutClassLabels } = makeSegmentationMask();
    const result = validateSegmentationMask(withoutClassLabels);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('classLabels'))).toBe(true);
    }
  });

  it('rejects invalid authority', () => {
    const result = validateSegmentationMask(makeSegmentationMask({ authority: { ...validAuthority, cadMutationAllowed: true } }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('cadMutationAllowed'))).toBe(true);
    }
  });

  it('rejects missing limitations', () => {
    const { limitations: _, ...withoutLimitations } = makeSegmentationMask();
    const result = validateSegmentationMask(withoutLimitations);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('limitations'))).toBe(true);
    }
  });

  it('rejects non-object payload', () => {
    const result = validateSegmentationMask('not-an-object');
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DepthMap validation
// ---------------------------------------------------------------------------

describe('validateDepthMap', () => {
  it('accepts a valid depth map', () => {
    const result = validateDepthMap(makeDepthMap());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('depth_map');
      expect(result.data.depthMetric).toBe('meters');
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateDepthMap(makeDepthMap({ artifactType: 'segmentation_mask' }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing depthMetric', () => {
    const { depthMetric: _, ...withoutMetric } = makeDepthMap();
    const result = validateDepthMap(withoutMetric);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('depthMetric'))).toBe(true);
    }
  });

  it('rejects invalid authority', () => {
    const result = validateDepthMap(makeDepthMap({ authority: { ...validAuthority, permitGenerationAllowed: true } }));
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SfMPointCloud validation
// ---------------------------------------------------------------------------

describe('validateSfMPointCloud', () => {
  it('accepts a valid point cloud', () => {
    const result = validateSfMPointCloud(makeSfMPointCloud());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('sfm_point_cloud');
      expect(result.data.pointCount).toBe(500);
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateSfMPointCloud(makeSfMPointCloud({ artifactType: 'depth_map' }));
    expect(result.valid).toBe(false);
  });

  it('rejects non-string-array sourceFileIds', () => {
    const result = validateSfMPointCloud(makeSfMPointCloud({ sourceFileIds: 'not-an-array' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('sourceFileIds'))).toBe(true);
    }
  });

  it('rejects missing pointCount', () => {
    const { pointCount: _, ...without } = makeSfMPointCloud();
    const result = validateSfMPointCloud(without);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('pointCount'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PlaneCandidate validation
// ---------------------------------------------------------------------------

describe('validatePlaneCandidate', () => {
  it('accepts a valid plane candidate', () => {
    const result = validatePlaneCandidate(makePlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('plane_candidate');
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validatePlaneCandidate(makePlaneCandidate({ artifactType: 'roof_plane_candidate' }));
    expect(result.valid).toBe(false);
  });

  it('rejects non-tuple normal', () => {
    const result = validatePlaneCandidate(makePlaneCandidate({ normal: 'not-a-tuple' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('normal'))).toBe(true);
    }
  });

  it('rejects wrong-length normal', () => {
    const result = validatePlaneCandidate(makePlaneCandidate({ normal: [0, 1] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('normal'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// RoofPlaneCandidate validation
// ---------------------------------------------------------------------------

describe('validateRoofPlaneCandidate', () => {
  it('accepts a valid roof plane candidate', () => {
    const result = validateRoofPlaneCandidate(makeRoofPlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('roof_plane_candidate');
      expect(result.data.slopeDegrees).toBe(30);
      expect(result.data.aspectDegrees).toBe(180);
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateRoofPlaneCandidate(makeRoofPlaneCandidate({ artifactType: 'plane_candidate' }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing slopeDegrees', () => {
    const { slopeDegrees: _, ...without } = makeRoofPlaneCandidate();
    const result = validateRoofPlaneCandidate(without);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('slopeDegrees'))).toBe(true);
    }
  });

  it('rejects missing associatedLineIds', () => {
    const { associatedLineIds: _, ...without } = makeRoofPlaneCandidate();
    const result = validateRoofPlaneCandidate(without);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('associatedLineIds'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// WallPlaneCandidate validation
// ---------------------------------------------------------------------------

describe('validateWallPlaneCandidate', () => {
  it('accepts a valid wall plane candidate', () => {
    const result = validateWallPlaneCandidate(makeWallPlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('wall_plane_candidate');
      expect(result.data.estimatedHeightM).toBe(3.2);
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateWallPlaneCandidate(makeWallPlaneCandidate({ artifactType: 'roof_plane_candidate' }));
    expect(result.valid).toBe(false);
  });

  it('rejects non-number estimatedHeightM', () => {
    const result = validateWallPlaneCandidate(makeWallPlaneCandidate({ estimatedHeightM: 'not-a-number' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('estimatedHeightM'))).toBe(true);
    }
  });

  it('allows missing optional fields', () => {
    const { estimatedHeightM: _, facingDirection: __, ...minimal } = makeWallPlaneCandidate();
    const result = validateWallPlaneCandidate(minimal);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LineCandidate validation
// ---------------------------------------------------------------------------

describe('validateLineCandidate', () => {
  it('accepts a valid ridge line candidate', () => {
    const result = validateLineCandidate(makeLineCandidate('ridge_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('ridge_line_candidate');
    }
  });

  it('accepts a valid eave line candidate', () => {
    const result = validateLineCandidate(makeLineCandidate('eave_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('eave_line_candidate');
    }
  });

  it('accepts a valid rake line candidate', () => {
    const result = validateLineCandidate(makeLineCandidate('rake_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('rake_line_candidate');
    }
  });

  it('rejects wrong artifactType', () => {
    const result = validateLineCandidate(makeLineCandidate('ridge_line_candidate', { artifactType: 'plane_candidate' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('artifactType'))).toBe(true);
    }
  });

  it('rejects non-tuple startPoint', () => {
    const result = validateLineCandidate(makeLineCandidate('ridge_line_candidate', { startPoint: 'bad' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('startPoint'))).toBe(true);
    }
  });

  it('rejects missing endPoint', () => {
    const { endPoint: _, ...without } = makeLineCandidate('ridge_line_candidate');
    const result = validateLineCandidate(without);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('endPoint'))).toBe(true);
    }
  });

  it('allows missing optional estimatedLengthM', () => {
    const { estimatedLengthM: _, ...without } = makeLineCandidate('ridge_line_candidate');
    const result = validateLineCandidate(without);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Union validator (validateGeometryReconstructionArtifact)
// ---------------------------------------------------------------------------

describe('validateGeometryReconstructionArtifact', () => {
  it('routes segmentation_mask to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeSegmentationMask());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('segmentation_mask');
    }
  });

  it('routes depth_map to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeDepthMap());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('depth_map');
    }
  });

  it('routes sfm_point_cloud to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeSfMPointCloud());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('sfm_point_cloud');
    }
  });

  it('routes plane_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makePlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('plane_candidate');
    }
  });

  it('routes roof_plane_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeRoofPlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('roof_plane_candidate');
    }
  });

  it('routes wall_plane_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeWallPlaneCandidate());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('wall_plane_candidate');
    }
  });

  it('routes ridge_line_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeLineCandidate('ridge_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('ridge_line_candidate');
    }
  });

  it('routes eave_line_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeLineCandidate('eave_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('eave_line_candidate');
    }
  });

  it('routes rake_line_candidate to the correct validator', () => {
    const result = validateGeometryReconstructionArtifact(makeLineCandidate('rake_line_candidate'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.artifactType).toBe('rake_line_candidate');
    }
  });

  it('rejects unknown artifactType', () => {
    const result = validateGeometryReconstructionArtifact({ artifactType: 'unknown_type' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('Unknown artifactType'))).toBe(true);
    }
  });

  it('rejects missing artifactType', () => {
    const result = validateGeometryReconstructionArtifact({ fileId: 'test' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('artifactType'))).toBe(true);
    }
  });

  it('rejects non-string artifactType', () => {
    const result = validateGeometryReconstructionArtifact({ artifactType: 42 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('artifactType'))).toBe(true);
    }
  });

  it('rejects non-object payload', () => {
    const result = validateGeometryReconstructionArtifact(42);
    expect(result.valid).toBe(false);
  });

  it('rejects null payload', () => {
    const result = validateGeometryReconstructionArtifact(null);
    expect(result.valid).toBe(false);
  });

  it('propagates authority validation errors through union validator', () => {
    const badPayload = makeSegmentationMask({ authority: { ...validAuthority, cadMutationAllowed: true } });
    const result = validateGeometryReconstructionArtifact(badPayload);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('cadMutationAllowed'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Confidence range validation
// ---------------------------------------------------------------------------

describe('confidence range validation', () => {
  it('rejects confidence below 0', () => {
    const result = validateSegmentationMask(makeSegmentationMask({ confidence: -1 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
    }
  });

  it('rejects confidence above 100', () => {
    const result = validateDepthMap(makeDepthMap({ confidence: 101 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
    }
  });

  it('accepts confidence at boundary 0', () => {
    const result = validateSegmentationMask(makeSegmentationMask({ confidence: 0 }));
    expect(result.valid).toBe(true);
  });

  it('accepts confidence at boundary 100', () => {
    const result = validateDepthMap(makeDepthMap({ confidence: 100 }));
    expect(result.valid).toBe(true);
  });
});
