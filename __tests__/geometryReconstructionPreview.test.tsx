/**
 * @jest-environment jsdom
 */

/**
 * GeometryReconstructionPreview — UI rendering tests.
 *
 * Tests the component renders correctly in various states:
 * - Empty state (no artifacts)
 * - With loaded result (roof, wall, line candidates)
 * - Review-only badges present
 * - Authority disclaimer visible
 * - Mock reconstruction button present
 * - Artifact counts displayed
 * - No CAD mutation confirmed in UI
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GeometryReconstructionPreview from '@/components/GeometryReconstructionPreview';
import type { GeometryReconstructionResult, GeometryReconstructionJob } from '@/lib/siteSurveys/geometryReconstruction';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '@/lib/siteSurveys/geometryReconstruction';

// ── Mock data factories ────────────────────────────────────────────────

function makeMockJob(overrides: Partial<GeometryReconstructionJob> = {}): GeometryReconstructionJob {
  return {
    id: 'job-001',
    surveyId: 'survey-001',
    status: 'completed',
    pipeline: 'mock',
    input: {
      surveyId: 'survey-001',
      sourcePhotos: [],
      pipeline: 'mock',
    },
    artifacts: [],
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:05Z',
    completedAt: '2025-01-15T10:00:05Z',
    currentStage: 'completed',
    lastHeartbeatAt: '2025-01-15T10:00:05Z',
    workerVersion: 'mock-1.0.0',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeMockResult(overrides: Partial<GeometryReconstructionResult> = {}): GeometryReconstructionResult {
  const job = makeMockJob();
  return {
    schemaVersion: 'geometry_reconstruction_result_v1',
    job,
    artifactCount: 0,
    artifacts: [],
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeRoofPlane() {
  return {
    artifactType: 'roof_plane_candidate' as const,
    normal: [0.0, 0.0, 1.0] as [number, number, number],
    d: 5.0,
    inlierCount: 800,
    totalPoints: 1000,
    slopeDegrees: 30.0,
    aspectDegrees: 180.0,
    associatedLineIds: ['line-1'],
    confidence: 85,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeWallPlane() {
  return {
    artifactType: 'wall_plane_candidate' as const,
    normal: [1.0, 0.0, 0.0] as [number, number, number],
    d: 3.0,
    inlierCount: 600,
    totalPoints: 800,
    estimatedHeightM: 4.5,
    facingDirection: 'south',
    associatedLineIds: [],
    confidence: 72,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeRidgeLine() {
  return {
    artifactType: 'ridge_line_candidate' as const,
    startPoint: [0, 0, 5] as [number, number, number],
    endPoint: [10, 0, 5] as [number, number, number],
    estimatedLengthM: 10.0,
    confidence: 90,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeEaveLine() {
  return {
    artifactType: 'eave_line_candidate' as const,
    startPoint: [0, 5, 3] as [number, number, number],
    endPoint: [10, 5, 3] as [number, number, number],
    estimatedLengthM: 11.0,
    confidence: 78,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeRakeLine() {
  return {
    artifactType: 'rake_line_candidate' as const,
    startPoint: [0, 0, 3] as [number, number, number],
    endPoint: [0, 5, 5] as [number, number, number],
    estimatedLengthM: 5.4,
    confidence: 65,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeDepthMap() {
  return {
    artifactType: 'depth_map' as const,
    fileId: 'file-001',
    width: 640,
    height: 480,
    depthData: '',
    depthMetric: 'meters',
    confidence: 60,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeSfMPointCloud() {
  return {
    artifactType: 'sfm_point_cloud' as const,
    pointCount: 5000,
    pointsData: '',
    sourcePhotoCount: 3,
    sourceFileIds: ['file-001'],
    confidence: 70,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

function makeSegmentationMask() {
  return {
    artifactType: 'segmentation_mask' as const,
    fileId: 'file-001',
    width: 640,
    height: 480,
    maskData: '',
    classLabels: { 0: 'background', 1: 'roof' },
    confidence: 55,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: ['MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE'],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('GeometryReconstructionPreview', () => {
  // ── Empty state ────────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders the component header', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText('Geometry Reconstruction Preview')).toBeInTheDocument();
    });

    it('shows the Run Mock Reconstruction button', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText('Run Mock Reconstruction')).toBeInTheDocument();
    });

    it('shows the Reload Artifacts button', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText('Reload Artifacts')).toBeInTheDocument();
    });

    it('shows empty state message when no result', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText(/No reconstruction artifacts yet/)).toBeInTheDocument();
    });

    it('shows Review-Only badge', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      const badges = screen.getAllByText('Review-Only');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Non-Authoritative badge', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText('Non-Authoritative')).toBeInTheDocument();
    });

    it('shows No CAD Mutation badge', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText('No CAD Mutation')).toBeInTheDocument();
    });

    it('shows authority disclaimer', () => {
      render(<GeometryReconstructionPreview surveyId="survey-001" />);
      expect(screen.getByText(/Review-Only \/ Non-Authoritative \/ Not CAD Geometry/)).toBeInTheDocument();
    });
  });

  // ── With loaded result ─────────────────────────────────────────────

  describe('with loaded result', () => {
    it('displays roof plane candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Roof Plane #1/)).toBeInTheDocument();
    });

    it('displays wall plane candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Wall Plane #1/)).toBeInTheDocument();
    });

    it('displays ridge line candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRidgeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Ridge Line #1/)).toBeInTheDocument();
    });

    it('displays eave line candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeEaveLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Eave Line #1/)).toBeInTheDocument();
    });

    it('displays rake line candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRakeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Rake Line #1/)).toBeInTheDocument();
    });

    it('displays artifact count tiles', () => {
      const result = makeMockResult({
        artifactCount: 4,
        artifacts: [makeRoofPlane(), makeWallPlane(), makeRidgeLine(), makeDepthMap()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      // V2: "Roof Planes" and "Wall Planes" now appear in both CountTile and ToggleFilters button
      expect(screen.getAllByText('Roof Planes').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Wall Planes').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Lines').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Depth Maps').length).toBeGreaterThanOrEqual(1);
    });

    it('shows correct count numbers in tiles', () => {
      const result = makeMockResult({
        artifactCount: 3,
        artifacts: [makeRoofPlane(), makeRoofPlane(), makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      // Count tiles show the number
      const roofTiles = screen.getAllByText('2');
      expect(roofTiles.length).toBeGreaterThanOrEqual(1);
    });

    it('shows job status when present', () => {
      const result = makeMockResult({
        job: makeMockJob({ status: 'completed', pipeline: 'mock' }),
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Job completed/)).toBeInTheDocument();
    });

    it('displays dedicated sections for depth maps and point clouds', () => {
      const result = makeMockResult({
        artifactCount: 3,
        artifacts: [makeDepthMap(), makeSfMPointCloud(), makeSegmentationMask()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      // V2: depth maps now get their own dedicated section with header
      expect(screen.getByText(/Depth Maps \(1\)/)).toBeInTheDocument();
      // V2: SfM point clouds still appear in "Other Artifacts" summary
      expect(screen.getByText(/SfM Point Clouds: 1/)).toBeInTheDocument();
      // V2: segmentation masks still appear in count tiles and potentially other areas
      expect(screen.getAllByText(/Seg.*Masks/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Authority / Review-only enforcement ─────────────────────────────

  describe('authority enforcement', () => {
    it('shows cadMutationAllowed=false in footer disclaimer', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/cadMutationAllowed=false/)).toBeInTheDocument();
    });

    it('shows permitGenerationAllowed=false in footer disclaimer', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/permitGenerationAllowed=false/)).toBeInTheDocument();
    });

    it('shows bomMutationAllowed=false in footer disclaimer', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/bomMutationAllowed=false/)).toBeInTheDocument();
    });

    it('displays limitation text on roof plane cards', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText('MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE')).toBeInTheDocument();
    });

    it('displays limitation text on wall plane cards', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText('MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE')).toBeInTheDocument();
    });

    it('displays limitation text on line cards', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRidgeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText('MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE')).toBeInTheDocument();
    });
  });

  // ── Roof plane details ─────────────────────────────────────────────

  describe('roof plane details', () => {
    it('shows slope and aspect for roof planes', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Slope: 30.0°/)).toBeInTheDocument();
      expect(screen.getByText(/Aspect: 180.0°/)).toBeInTheDocument();
    });

    it('shows inlier count for roof planes', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Inliers: 800\/1000/)).toBeInTheDocument();
    });

    it('shows confidence for roof planes', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/conf: 85%/)).toBeInTheDocument();
    });
  });

  // ── Wall plane details ─────────────────────────────────────────────

  describe('wall plane details', () => {
    it('shows height and facing for wall planes', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Height: 4.5m/)).toBeInTheDocument();
      expect(screen.getByText(/Facing: south/)).toBeInTheDocument();
    });

    it('shows confidence for wall planes', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/conf: 72%/)).toBeInTheDocument();
    });
  });

  // ── Line candidate details ─────────────────────────────────────────

  describe('line candidate details', () => {
    it('shows estimated length for line candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRidgeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Length: 10.00m/)).toBeInTheDocument();
    });

    it('shows start and end points for line candidates', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRidgeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Start: \[0.0, 0.0, 5.0\]/)).toBeInTheDocument();
      expect(screen.getByText(/End: \[10.0, 0.0, 5.0\]/)).toBeInTheDocument();
    });
  });

  // ── Expand/collapse ────────────────────────────────────────────────

  describe('expand/collapse', () => {
    it('collapses the panel when header is clicked', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);

      // The header text should always be visible
      expect(screen.getByText('Geometry Reconstruction Preview')).toBeInTheDocument();

      // The content should be visible initially
      expect(screen.getByText('Run Mock Reconstruction')).toBeInTheDocument();

      // Click the header to collapse
      const header = screen.getByText('Geometry Reconstruction Preview').closest('[role="button"]');
      if (header) {
        fireEvent.click(header);
      }

      // After collapse, the action button should be gone
      expect(screen.queryByText('Run Mock Reconstruction')).not.toBeInTheDocument();
    });

    it('can expand artifact details section', () => {
      const result = makeMockResult({
        artifactCount: 2,
        artifacts: [makeRoofPlane(), makeWallPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);

      // The artifact details section should be visible
      expect(screen.getByText(/Artifact Details/)).toBeInTheDocument();
    });
  });

  // ── Full mock result rendering ─────────────────────────────────────

  describe('full mock result', () => {
    it('renders all artifact types together', () => {
      const result = makeMockResult({
        artifactCount: 7,
        artifacts: [
          makeRoofPlane(),
          makeRoofPlane(),
          makeWallPlane(),
          makeRidgeLine(),
          makeEaveLine(),
          makeRakeLine(),
          makeDepthMap(),
        ],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);

      expect(screen.getByText(/Roof Plane Candidates \(2\)/)).toBeInTheDocument();
      expect(screen.getByText(/Wall Plane Candidates \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Line Candidates \(3\)/)).toBeInTheDocument();
    });

    it('shows grouped category headers', () => {
      const result = makeMockResult({
        artifactCount: 3,
        artifacts: [makeRoofPlane(), makeWallPlane(), makeRidgeLine()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      expect(screen.getByText(/Roof Plane Candidates/)).toBeInTheDocument();
      expect(screen.getByText(/Wall Plane Candidates/)).toBeInTheDocument();
      expect(screen.getByText(/Line Candidates/)).toBeInTheDocument();
    });
  });

  // ── No CAD mutation confirmation ───────────────────────────────────

  describe('no CAD mutation confirmation', () => {
    it('all three mutation flags are false in the disclaimer', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);

      const footer = screen.getByText(/cadMutationAllowed=false.*permitGenerationAllowed=false.*bomMutationAllowed=false/);
      expect(footer).toBeInTheDocument();
    });

    it('Review-Only badge appears at least twice (header + badges row)', () => {
      const result = makeMockResult({
        artifactCount: 1,
        artifacts: [makeRoofPlane()],
      });
      render(<GeometryReconstructionPreview surveyId="survey-001" initialResult={result} />);
      const badges = screen.getAllByText('Review-Only');
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
