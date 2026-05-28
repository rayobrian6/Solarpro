/**
 * Tests for the mock geometry reconstruction adapter.
 *
 * Validates:
 * - Deterministic output (same input → same output)
 * - All artifact types present
 * - All artifacts pass schema validation
 * - Correct artifactType discriminators
 * - Authority fields are correct
 * - Confidence values in [0, 100]
 * - Limitations include disclaimers
 */

import {
  generateMockArtifacts,
  mockGeometryReconstructionService,
  validateGeometryReconstructionArtifact,
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
  type GeometryReconstructionInput,
} from '@/lib/siteSurveys/geometryReconstruction';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SINGLE_PHOTO_INPUT: GeometryReconstructionInput = {
  surveyId: 'survey-001',
  sourcePhotos: [
    { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
  ],
  pipeline: 'mock',
};

const MULTI_PHOTO_INPUT: GeometryReconstructionInput = {
  surveyId: 'survey-002',
  sourcePhotos: [
    { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    { fileId: 'file-002', fileUrl: 'https://example.com/photo2.jpg', filename: 'photo2.jpg' },
    { fileId: 'file-003', fileUrl: 'https://example.com/photo3.jpg', filename: 'photo3.jpg' },
  ],
  pipeline: 'mock',
};

const EMPTY_PHOTO_INPUT: GeometryReconstructionInput = {
  surveyId: 'survey-003',
  sourcePhotos: [],
  pipeline: 'mock',
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('mock adapter determinism', () => {
  it('produces same output for same input', () => {
    const run1 = generateMockArtifacts(SINGLE_PHOTO_INPUT);
    const run2 = generateMockArtifacts(SINGLE_PHOTO_INPUT);
    expect(run1).toEqual(run2);
  });

  it('produces different output for different input', () => {
    const run1 = generateMockArtifacts(SINGLE_PHOTO_INPUT);
    const run2 = generateMockArtifacts(MULTI_PHOTO_INPUT);
    // Different number of segmentation masks (1 vs 2)
    const seg1 = run1.filter(a => a.artifactType === 'segmentation_mask');
    const seg2 = run2.filter(a => a.artifactType === 'segmentation_mask');
    expect(seg2.length).toBeGreaterThan(seg1.length);
  });
});

// ---------------------------------------------------------------------------
// Required artifact types
// ---------------------------------------------------------------------------

describe('mock adapter produces required artifact types', () => {
  const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);

  it('includes at least one segmentation_mask', () => {
    expect(artifacts.filter(a => a.artifactType === 'segmentation_mask').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one depth_map', () => {
    expect(artifacts.filter(a => a.artifactType === 'depth_map').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one sfm_point_cloud', () => {
    expect(artifacts.filter(a => a.artifactType === 'sfm_point_cloud').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one roof_plane_candidate', () => {
    expect(artifacts.filter(a => a.artifactType === 'roof_plane_candidate').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one wall_plane_candidate', () => {
    expect(artifacts.filter(a => a.artifactType === 'wall_plane_candidate').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one ridge_line_candidate', () => {
    expect(artifacts.filter(a => a.artifactType === 'ridge_line_candidate').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one eave_line_candidate', () => {
    expect(artifacts.filter(a => a.artifactType === 'eave_line_candidate').length).toBeGreaterThanOrEqual(1);
  });

  it('includes at least one rake_line_candidate', () => {
    expect(artifacts.filter(a => a.artifactType === 'rake_line_candidate').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-photo produces more artifacts
// ---------------------------------------------------------------------------

describe('mock adapter scales with source photos', () => {
  it('produces 2 segmentation masks for 2+ photos', () => {
    const artifacts = generateMockArtifacts(MULTI_PHOTO_INPUT);
    const segs = artifacts.filter(a => a.artifactType === 'segmentation_mask');
    expect(segs.length).toBe(2);
  });

  it('produces 2 roof plane candidates for 2+ photos', () => {
    const artifacts = generateMockArtifacts(MULTI_PHOTO_INPUT);
    const roofs = artifacts.filter(a => a.artifactType === 'roof_plane_candidate');
    expect(roofs.length).toBe(2);
  });

  it('produces at least 8 artifacts total for single photo', () => {
    const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);
    expect(artifacts.length).toBeGreaterThanOrEqual(8);
  });

  it('handles empty source photos gracefully', () => {
    const artifacts = generateMockArtifacts(EMPTY_PHOTO_INPUT);
    expect(artifacts.length).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('mock adapter artifacts pass schema validation', () => {
  const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);

  for (const artifact of artifacts) {
    it(`validates ${artifact.artifactType}`, () => {
      const result = validateGeometryReconstructionArtifact(artifact);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error(`Validation errors for ${artifact.artifactType}:`, result.errors);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

describe('mock adapter authority enforcement', () => {
  const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);

  it('all artifacts have reviewOnly: true', () => {
    for (const artifact of artifacts) {
      expect(artifact.authority.reviewOnly).toBe(true);
    }
  });

  it('all artifacts have cadMutationAllowed: false', () => {
    for (const artifact of artifacts) {
      expect(artifact.authority.cadMutationAllowed).toBe(false);
    }
  });

  it('all artifacts have permitGenerationAllowed: false', () => {
    for (const artifact of artifacts) {
      expect(artifact.authority.permitGenerationAllowed).toBe(false);
    }
  });

  it('all artifacts have bomMutationAllowed: false', () => {
    for (const artifact of artifacts) {
      expect(artifact.authority.bomMutationAllowed).toBe(false);
    }
  });

  it('all artifacts have nonAuthoritative: true', () => {
    for (const artifact of artifacts) {
      expect(artifact.authority.nonAuthoritative).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe('mock adapter confidence values', () => {
  const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);

  it('all confidence values are between 0 and 100', () => {
    for (const artifact of artifacts) {
      expect(artifact.confidence).toBeGreaterThanOrEqual(0);
      expect(artifact.confidence).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

describe('mock adapter limitations', () => {
  const artifacts = generateMockArtifacts(SINGLE_PHOTO_INPUT);

  it('all artifacts have limitations array', () => {
    for (const artifact of artifacts) {
      expect(Array.isArray(artifact.limitations)).toBe(true);
      expect(artifact.limitations.length).toBeGreaterThan(0);
    }
  });

  it('all artifacts include REVIEW-ONLY disclaimer', () => {
    for (const artifact of artifacts) {
      expect(artifact.limitations.some(l => l.includes('REVIEW-ONLY'))).toBe(true);
    }
  });

  it('all artifacts include MOCK DATA disclaimer', () => {
    for (const artifact of artifacts) {
      expect(artifact.limitations.some(l => l.includes('MOCK DATA'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

describe('mockGeometryReconstructionService', () => {
  it('startJob returns completed job with artifacts', async () => {
    const job = await mockGeometryReconstructionService.startJob(SINGLE_PHOTO_INPUT);
    expect(job.status).toBe('completed');
    expect(job.pipeline).toBe('mock');
    expect(job.artifacts.length).toBeGreaterThanOrEqual(8);
    expect(job.authority.cadMutationAllowed).toBe(false);
    expect(job.completedAt).not.toBeNull();
  });

  it('getJobStatus returns null (mock)', async () => {
    const result = await mockGeometryReconstructionService.getJobStatus('any-id');
    expect(result).toBeNull();
  });

  it('getArtifactsForSurvey returns result bundle', async () => {
    const result = await mockGeometryReconstructionService.getArtifactsForSurvey('survey-001', 'user-001');
    expect(result.schemaVersion).toBe('geometry_reconstruction_result_v1');
    expect(result.artifactCount).toBeGreaterThanOrEqual(7);
    expect(result.authority.cadMutationAllowed).toBe(false);
  });

  it('cancelJob does not throw', async () => {
    await expect(mockGeometryReconstructionService.cancelJob('any-id')).resolves.toBeUndefined();
  });
});
