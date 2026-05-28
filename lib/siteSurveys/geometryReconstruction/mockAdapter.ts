/**
 * Mock geometry reconstruction adapter.
 *
 * Produces deterministic output for testing and development.
 * All artifacts carry review-only authority with limitations disclaimers.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * Mock data — NOT from real geometry pipeline.
 */

import type {
  GeometryReconstructionService,
  GeometryReconstructionInput,
  GeometryReconstructionJob,
  GeometryReconstructionResult,
  GeometryReconstructionArtifact,
  SegmentationMask,
  DepthMap,
  SfMPointCloud,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  RidgeLineCandidate,
  EaveLineCandidate,
  RakeLineCandidate,
} from './types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from './types';

// ---------------------------------------------------------------------------
// Deterministic mock data generators
// ---------------------------------------------------------------------------

const MOCK_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE',
  'This output is generated deterministically for testing purposes only.',
];

function makeSegmentationMask(fileId: string): SegmentationMask {
  return {
    artifactType: 'segmentation_mask',
    fileId,
    width: 8,
    height: 8,
    maskData: 'AAAAAAAAAAAA', // 64 zero-bytes base64 ≈ mock mask
    classLabels: { 0: 'roof', 1: 'wall', 2: 'sky', 3: 'vegetation' },
    confidence: 72,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeDepthMap(fileId: string): DepthMap {
  return {
    artifactType: 'depth_map',
    fileId,
    width: 8,
    height: 8,
    depthData: 'AAAAAAAAAAAA', // mock depth values
    depthMetric: 'meters',
    confidence: 65,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeSfMPointCloud(sourceFileIds: string[]): SfMPointCloud {
  return {
    artifactType: 'sfm_point_cloud',
    pointCount: 42,
    pointsData: 'AAAAAAAAAAAA', // mock 3D points
    sourcePhotoCount: sourceFileIds.length,
    sourceFileIds: [...sourceFileIds],
    confidence: 55,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeRoofPlaneCandidate(index: number): RoofPlaneCandidate {
  // Deterministic normal based on index
  const normals: [number, number, number][] = [
    [0.15, 0.1, 0.98],
    [-0.2, 0.05, 0.96],
  ];
  return {
    artifactType: 'roof_plane_candidate',
    normal: normals[index % normals.length],
    d: 2.5 + index * 0.3,
    inlierCount: 180 + index * 20,
    totalPoints: 250,
    slopeDegrees: 25 + index * 8,
    aspectDegrees: 180 + index * 45,
    associatedLineIds: [`mock-ridge-${index}`, `mock-eave-${index}`],
    confidence: 78 - index * 5,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeWallPlaneCandidate(): WallPlaneCandidate {
  return {
    artifactType: 'wall_plane_candidate',
    normal: [0.0, -1.0, 0.0],
    d: 1.8,
    inlierCount: 120,
    totalPoints: 200,
    estimatedHeightM: 3.2,
    facingDirection: 'south',
    associatedLineIds: ['mock-rake-0'],
    confidence: 70,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeRidgeLine(): RidgeLineCandidate {
  return {
    artifactType: 'ridge_line_candidate',
    startPoint: [0.0, 3.2, 2.5],
    endPoint: [8.0, 3.2, 2.5],
    estimatedLengthM: 8.0,
    confidence: 62,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeEaveLine(): EaveLineCandidate {
  return {
    artifactType: 'eave_line_candidate',
    startPoint: [0.0, 0.0, 2.5],
    endPoint: [8.0, 0.0, 2.5],
    estimatedLengthM: 8.0,
    confidence: 58,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

function makeRakeLine(): RakeLineCandidate {
  return {
    artifactType: 'rake_line_candidate',
    startPoint: [0.0, 0.0, 2.5],
    endPoint: [0.0, 3.2, 2.5],
    estimatedLengthM: 3.2,
    confidence: 55,
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...MOCK_LIMITATIONS],
  };
}

// ---------------------------------------------------------------------------
// Deterministic artifact generation
// ---------------------------------------------------------------------------

/**
 * Generate deterministic mock artifacts for a given input.
 * Same input always produces same output.
 */
export function generateMockArtifacts(input: GeometryReconstructionInput): GeometryReconstructionArtifact[] {
  const artifacts: GeometryReconstructionArtifact[] = [];
  const fileIds = input.sourcePhotos.map(p => p.fileId);
  const primaryFileId = fileIds[0] ?? 'mock-file-001';

  // 1. Segmentation mask (1-2, one per source photo, capped at 2)
  const segPhotos = fileIds.slice(0, 2);
  for (const fileId of segPhotos) {
    artifacts.push(makeSegmentationMask(fileId));
  }

  // 2. Depth map (1, for primary photo)
  artifacts.push(makeDepthMap(primaryFileId));

  // 3. SfM point cloud (1, using all source photos)
  artifacts.push(makeSfMPointCloud(fileIds.length > 0 ? fileIds : ['mock-file-001']));

  // 4. Roof plane candidates (1-2)
  artifacts.push(makeRoofPlaneCandidate(0));
  if (fileIds.length > 1) {
    artifacts.push(makeRoofPlaneCandidate(1));
  }

  // 5. Wall plane candidate (1)
  artifacts.push(makeWallPlaneCandidate());

  // 6. Ridge line (1)
  artifacts.push(makeRidgeLine());

  // 7. Eave line (1)
  artifacts.push(makeEaveLine());

  // 8. Rake line (1)
  artifacts.push(makeRakeLine());

  return artifacts;
}

// ---------------------------------------------------------------------------
// Mock service implementation
// ---------------------------------------------------------------------------

/** Mock implementation of GeometryReconstructionService. */
export const mockGeometryReconstructionService: GeometryReconstructionService = {
  async startJob(input: GeometryReconstructionInput): Promise<GeometryReconstructionJob> {
    const artifacts = generateMockArtifacts(input);

    return {
      id: `mock-job-${input.surveyId}-${Date.now()}`,
      surveyId: input.surveyId,
      status: 'completed',
      pipeline: 'mock',
      input,
      artifacts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: 'completed',
      lastHeartbeatAt: new Date().toISOString(),
      workerVersion: 'mock-1.0.0',
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...MOCK_LIMITATIONS],
    };
  },

  async getJobStatus(jobId: string): Promise<GeometryReconstructionJob | null> {
    // Mock always returns null — real implementation would query DB
    void jobId;
    return null;
  },

  async getArtifactsForSurvey(surveyId: string, userId: string): Promise<GeometryReconstructionResult> {
    // Mock generates fresh artifacts for the survey
    void userId;
    const input: GeometryReconstructionInput = {
      surveyId,
      sourcePhotos: [{ fileId: 'mock-file-001', fileUrl: '', filename: 'mock.jpg' }],
      pipeline: 'mock',
    };
    const artifacts = generateMockArtifacts(input);
    const job: GeometryReconstructionJob = {
      id: `mock-job-${surveyId}`,
      surveyId,
      status: 'completed',
      pipeline: 'mock',
      input,
      artifacts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: 'completed',
      lastHeartbeatAt: new Date().toISOString(),
      workerVersion: 'mock-1.0.0',
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...MOCK_LIMITATIONS],
    };

    return {
      schemaVersion: 'geometry_reconstruction_result_v1',
      job,
      artifactCount: artifacts.length,
      artifacts,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...MOCK_LIMITATIONS],
    };
  },

  async cancelJob(jobId: string): Promise<void> {
    // Mock no-op
    void jobId;
  },
};
