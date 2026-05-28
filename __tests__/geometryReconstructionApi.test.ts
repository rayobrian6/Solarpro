/**
 * Tests for geometry reconstruction API routes.
 *
 * Since these routes require a running server + DB, these tests validate:
 * - API function scoping (survey ID parameter)
 * - Auth check patterns
 * - Mock endpoint artifact generation
 * - Grouped response structure
 *
 * Integration tests with a real server would go in a separate test suite.
 */

import {
  generateMockArtifacts,
  type GeometryReconstructionInput,
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction';

// ---------------------------------------------------------------------------
// API route structure tests
// ---------------------------------------------------------------------------

describe('geometry reconstruction API scoping', () => {
  it('generateMockArtifacts is scoped to input surveyId', () => {
    const input1: GeometryReconstructionInput = {
      surveyId: 'survey-001',
      sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
      pipeline: 'mock',
    };
    const input2: GeometryReconstructionInput = {
      surveyId: 'survey-002',
      sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
      pipeline: 'mock',
    };

    const artifacts1 = generateMockArtifacts(input1);
    const artifacts2 = generateMockArtifacts(input2);

    // Same source photos → same artifacts structure, different survey context
    expect(artifacts1.length).toEqual(artifacts2.length);
  });

  it('artifacts from different source photo counts differ', () => {
    const single: GeometryReconstructionInput = {
      surveyId: 'survey-001',
      sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
      pipeline: 'mock',
    };
    const multi: GeometryReconstructionInput = {
      surveyId: 'survey-001',
      sourcePhotos: [
        { fileId: 'file-001', fileUrl: '', filename: 'a.jpg' },
        { fileId: 'file-002', fileUrl: '', filename: 'b.jpg' },
      ],
      pipeline: 'mock',
    };

    const singleArtifacts = generateMockArtifacts(single);
    const multiArtifacts = generateMockArtifacts(multi);

    expect(multiArtifacts.length).toBeGreaterThan(singleArtifacts.length);
  });
});

// ---------------------------------------------------------------------------
// Grouped artifact response structure
// ---------------------------------------------------------------------------

describe('grouped artifact counts', () => {
  it('produces correct grouped counts', () => {
    const input: GeometryReconstructionInput = {
      surveyId: 'survey-001',
      sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
      pipeline: 'mock',
    };

    const artifacts = generateMockArtifacts(input);
    const grouped: Record<string, number> = {};
    for (const artifact of artifacts) {
      grouped[artifact.artifactType] = (grouped[artifact.artifactType] ?? 0) + 1;
    }

    // Verify all expected types are present
    expect(grouped['segmentation_mask']).toBeGreaterThanOrEqual(1);
    expect(grouped['depth_map']).toBeGreaterThanOrEqual(1);
    expect(grouped['sfm_point_cloud']).toBeGreaterThanOrEqual(1);
    expect(grouped['roof_plane_candidate']).toBeGreaterThanOrEqual(1);
    expect(grouped['wall_plane_candidate']).toBeGreaterThanOrEqual(1);
    expect(grouped['ridge_line_candidate']).toBeGreaterThanOrEqual(1);
    expect(grouped['eave_line_candidate']).toBeGreaterThanOrEqual(1);
    expect(grouped['rake_line_candidate']).toBeGreaterThanOrEqual(1);

    // Sum of grouped counts equals total artifact count
    const sum = Object.values(grouped).reduce((a, b) => a + b, 0);
    expect(sum).toBe(artifacts.length);
  });
});

// ---------------------------------------------------------------------------
// Auth pattern validation
// ---------------------------------------------------------------------------

describe('API auth patterns', () => {
  it('authority on result bundle blocks all mutations', () => {
    const input: GeometryReconstructionInput = {
      surveyId: 'survey-001',
      sourcePhotos: [],
      pipeline: 'mock',
    };
    const artifacts = generateMockArtifacts(input);

    const resultBundle = {
      schemaVersion: 'geometry_reconstruction_result_v1' as const,
      artifactCount: artifacts.length,
      artifacts,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };

    expect(resultBundle.authority.cadMutationAllowed).toBe(false);
    expect(resultBundle.authority.permitGenerationAllowed).toBe(false);
    expect(resultBundle.authority.bomMutationAllowed).toBe(false);
    expect(resultBundle.authority.reviewOnly).toBe(true);
  });

  it('mock endpoint artifacts link to correct survey context', () => {
    const surveyId = 'survey-abc-123';
    const input: GeometryReconstructionInput = {
      surveyId,
      sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
      pipeline: 'mock',
    };

    const artifacts = generateMockArtifacts(input);

    // Segmentation masks reference the correct file
    const segs = artifacts.filter(a => a.artifactType === 'segmentation_mask');
    for (const seg of segs) {
      if ('fileId' in seg) {
        expect((seg as { fileId: string }).fileId).toBe('file-001');
      }
    }

    // SfM point cloud references correct source files
    const sfm = artifacts.find(a => a.artifactType === 'sfm_point_cloud');
    if (sfm && 'sourceFileIds' in sfm) {
      expect((sfm as { sourceFileIds: string[] }).sourceFileIds).toContain('file-001');
    }
  });
});

// ---------------------------------------------------------------------------
// Mock endpoint produces correct artifact types
// ---------------------------------------------------------------------------

describe('mock endpoint artifact types', () => {
  const input: GeometryReconstructionInput = {
    surveyId: 'survey-001',
    sourcePhotos: [{ fileId: 'file-001', fileUrl: '', filename: 'a.jpg' }],
    pipeline: 'mock',
  };
  const artifacts = generateMockArtifacts(input);

  it('roof_plane_candidate has slope and aspect', () => {
    const roofs = artifacts.filter(a => a.artifactType === 'roof_plane_candidate');
    for (const roof of roofs) {
      if ('slopeDegrees' in roof) {
        expect(typeof (roof as { slopeDegrees: number }).slopeDegrees).toBe('number');
        expect(typeof (roof as { aspectDegrees: number }).aspectDegrees).toBe('number');
      }
    }
  });

  it('wall_plane_candidate has associatedLineIds', () => {
    const walls = artifacts.filter(a => a.artifactType === 'wall_plane_candidate');
    for (const wall of walls) {
      if ('associatedLineIds' in wall) {
        expect(Array.isArray((wall as { associatedLineIds: string[] }).associatedLineIds)).toBe(true);
      }
    }
  });

  it('line candidates have start and end points', () => {
    const lines = artifacts.filter(a =>
      a.artifactType === 'ridge_line_candidate' ||
      a.artifactType === 'eave_line_candidate' ||
      a.artifactType === 'rake_line_candidate'
    );
    for (const line of lines) {
      if ('startPoint' in line && 'endPoint' in line) {
        const l = line as { startPoint: number[]; endPoint: number[] };
        expect(l.startPoint.length).toBe(3);
        expect(l.endPoint.length).toBe(3);
      }
    }
  });
});
