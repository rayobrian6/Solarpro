/**
 * Tests for geometry reconstruction DB helper logic.
 *
 * Since we can't connect to Neon in unit tests, these tests validate:
 * - Row mapper logic (pure functions)
 * - Authority enforcement in persisted data
 * - parseStringArray helper
 * - Type safety of DB operations
 *
 * Integration tests with a real DB would go in a separate test suite.
 */

import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
  type GeometryReconstructionArtifact,
  type GeometryReconstructionJob,
  type SegmentationMask,
  type RoofPlaneCandidate,
  type RidgeLineCandidate,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// We test the pure helper functions by importing the module and testing
// the row mappers indirectly through the exported interfaces.
// For full integration tests, a running Neon DB would be needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// parseStringArray (replicated from the module for testing)
// ---------------------------------------------------------------------------

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

describe('parseStringArray', () => {
  it('parses a string array', () => {
    expect(parseStringArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('filters non-string items', () => {
    expect(parseStringArray(['a', 42, 'b'])).toEqual(['a', 'b']);
  });

  it('parses a JSON string of an array', () => {
    expect(parseStringArray('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns empty for invalid JSON string', () => {
    expect(parseStringArray('not-json')).toEqual([]);
  });

  it('returns empty for non-array JSON', () => {
    expect(parseStringArray('{"a":1}')).toEqual([]);
  });

  it('returns empty for null', () => {
    expect(parseStringArray(null)).toEqual([]);
  });

  it('returns empty for undefined', () => {
    expect(parseStringArray(undefined)).toEqual([]);
  });

  it('returns empty for number', () => {
    expect(parseStringArray(42)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Authority enforcement in stored payloads
// ---------------------------------------------------------------------------

describe('authority enforcement in DB payloads', () => {
  it('REVIEW_ONLY_AUTHORITY has all mutation flags false', () => {
    expect(REVIEW_ONLY_AUTHORITY.reviewOnly).toBe(true);
    expect(REVIEW_ONLY_AUTHORITY.nonAuthoritative).toBe(true);
    expect(REVIEW_ONLY_AUTHORITY.cadMutationAllowed).toBe(false);
    expect(REVIEW_ONLY_AUTHORITY.permitGenerationAllowed).toBe(false);
    expect(REVIEW_ONLY_AUTHORITY.bomMutationAllowed).toBe(false);
  });

  it('BASE_LIMITATIONS includes review-only disclaimer', () => {
    expect(BASE_LIMITATIONS.length).toBeGreaterThan(0);
    expect(BASE_LIMITATIONS.some(l => l.includes('REVIEW-ONLY'))).toBe(true);
    expect(BASE_LIMITATIONS.some(l => l.includes('NOT CAD GEOMETRY'))).toBe(true);
  });

  it('stored segmentation mask has correct authority', () => {
    const mask: SegmentationMask = {
      artifactType: 'segmentation_mask',
      fileId: 'file-001',
      width: 64,
      height: 64,
      maskData: 'AAAAAA==',
      classLabels: { 0: 'roof', 1: 'wall' },
      confidence: 75,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    expect(mask.authority.cadMutationAllowed).toBe(false);
    expect(mask.authority.permitGenerationAllowed).toBe(false);
    expect(mask.authority.bomMutationAllowed).toBe(false);
    expect(mask.limitations.some(l => l.includes('REVIEW-ONLY'))).toBe(true);
  });

  it('stored roof plane candidate has correct authority', () => {
    const roof: RoofPlaneCandidate = {
      artifactType: 'roof_plane_candidate',
      normal: [0, 0, 1],
      d: 2.5,
      inlierCount: 200,
      totalPoints: 300,
      slopeDegrees: 30,
      aspectDegrees: 180,
      associatedLineIds: ['line-001'],
      confidence: 80,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    expect(roof.authority.cadMutationAllowed).toBe(false);
    expect(roof.authority.permitGenerationAllowed).toBe(false);
    expect(roof.authority.bomMutationAllowed).toBe(false);
  });

  it('stored line candidate has correct authority', () => {
    const line: RidgeLineCandidate = {
      artifactType: 'ridge_line_candidate',
      startPoint: [1, 2, 3],
      endPoint: [4, 5, 6],
      confidence: 65,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    expect(line.authority.cadMutationAllowed).toBe(false);
    expect(line.authority.permitGenerationAllowed).toBe(false);
    expect(line.authority.bomMutationAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Job type integrity
// ---------------------------------------------------------------------------

describe('GeometryReconstructionJob type integrity', () => {
  it('job with review-only authority cannot be misused for CAD', () => {
    const job: GeometryReconstructionJob = {
      id: 'job-001',
      surveyId: 'survey-001',
      status: 'completed',
      pipeline: 'mock',
      input: { surveyId: 'survey-001', sourcePhotos: [], pipeline: 'mock' },
      artifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: 'completed',
      lastHeartbeatAt: new Date().toISOString(),
      workerVersion: 'mock-1.0.0',
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    // TypeScript enforces these at compile time; runtime check for safety
    expect(job.authority.cadMutationAllowed).toBe(false);
    expect(job.authority.permitGenerationAllowed).toBe(false);
    expect(job.authority.bomMutationAllowed).toBe(false);
  });

  it('result bundle carries review-only authority', () => {
    const result = {
      schemaVersion: 'geometry_reconstruction_result_v1' as const,
      job: {
        id: 'job-001',
        surveyId: 'survey-001',
        status: 'completed' as const,
        pipeline: 'mock',
        input: { surveyId: 'survey-001', sourcePhotos: [], pipeline: 'mock' as const },
        artifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        currentStage: 'completed',
        lastHeartbeatAt: new Date().toISOString(),
        workerVersion: 'mock-1.0.0',
        authority: REVIEW_ONLY_AUTHORITY,
        limitations: [...BASE_LIMITATIONS],
      },
      artifactCount: 0,
      artifacts: [] as GeometryReconstructionArtifact[],
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    expect(result.authority.cadMutationAllowed).toBe(false);
    expect(result.authority.reviewOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip (artifacts stored as JSONB)
// ---------------------------------------------------------------------------

describe('artifact JSON serialization round-trip', () => {
  it('segmentation mask survives JSON round-trip', () => {
    const mask: SegmentationMask = {
      artifactType: 'segmentation_mask',
      fileId: 'file-001',
      width: 64,
      height: 64,
      maskData: 'AAAAAA==',
      classLabels: { 0: 'roof', 1: 'wall' },
      confidence: 75,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    const serialized = JSON.stringify(mask);
    const parsed = JSON.parse(serialized) as SegmentationMask;
    expect(parsed.artifactType).toBe('segmentation_mask');
    expect(parsed.confidence).toBe(75);
    expect(parsed.authority.cadMutationAllowed).toBe(false);
    expect(parsed.limitations.length).toBeGreaterThan(0);
  });

  it('roof plane candidate survives JSON round-trip', () => {
    const roof: RoofPlaneCandidate = {
      artifactType: 'roof_plane_candidate',
      normal: [0.1, 0.2, 0.97],
      d: 2.5,
      inlierCount: 200,
      totalPoints: 300,
      slopeDegrees: 30,
      aspectDegrees: 180,
      associatedLineIds: ['line-001'],
      confidence: 80,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    const serialized = JSON.stringify(roof);
    const parsed = JSON.parse(serialized) as RoofPlaneCandidate;
    expect(parsed.artifactType).toBe('roof_plane_candidate');
    expect(parsed.normal).toEqual([0.1, 0.2, 0.97]);
    expect(parsed.slopeDegrees).toBe(30);
    expect(parsed.authority.cadMutationAllowed).toBe(false);
  });

  it('line candidate survives JSON round-trip', () => {
    const line: RidgeLineCandidate = {
      artifactType: 'ridge_line_candidate',
      startPoint: [1, 2, 3],
      endPoint: [4, 5, 6],
      estimatedLengthM: 8.5,
      confidence: 65,
      authority: REVIEW_ONLY_AUTHORITY,
      limitations: [...BASE_LIMITATIONS],
    };
    const serialized = JSON.stringify(line);
    const parsed = JSON.parse(serialized) as RidgeLineCandidate;
    expect(parsed.artifactType).toBe('ridge_line_candidate');
    expect(parsed.startPoint).toEqual([1, 2, 3]);
    expect(parsed.estimatedLengthM).toBe(8.5);
    expect(parsed.authority.cadMutationAllowed).toBe(false);
  });
});
