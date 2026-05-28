/**
 * @jest-environment jsdom
 */

/**
 * Tests for GeometryReconstructionPreview V2 — toggle filters, provenance,
 * and new artifact card types.
 *
 * Run with: npx jest __tests__/geometryReconstructionPreviewV2.test.tsx --no-cache
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GeometryReconstructionPreview from '@/components/GeometryReconstructionPreview';
import type {
  GeometryReconstructionResult,
  GeometryReconstructionJob,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  SemanticSegmentationMask,
  StructuralLineCandidate,
  DepthMap,
  ConsensusPlaneCandidate,
} from '@/lib/siteSurveys/geometryReconstruction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<GeometryReconstructionJob> = {}): GeometryReconstructionJob {
  return {
    id: 'job-1',
    surveyId: 'survey-1',
    status: 'completed',
    pipeline: 'full',
    input: {
      surveyId: 'survey-1',
      sourcePhotos: [],
      pipeline: 'full',
    },
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRoofPlane(overrides: Partial<RoofPlaneCandidate> = {}): RoofPlaneCandidate {
  return {
    artifactType: 'roof_plane_candidate',
    normal: [0, 0, 1],
    d: 0,
    inlierCount: 50,
    totalPoints: 100,
    slopeDegrees: 30,
    aspectDegrees: 180,
    associatedLineIds: [],
    confidence: 60,
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeWallPlane(overrides: Partial<WallPlaneCandidate> = {}): WallPlaneCandidate {
  return {
    artifactType: 'wall_plane_candidate',
    normal: [1, 0, 0],
    d: 0,
    inlierCount: 40,
    totalPoints: 100,
    facingDirection: 'north',
    associatedLineIds: [],
    confidence: 55,
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeSemanticMask(overrides: Partial<SemanticSegmentationMask> = {}): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: 'mask-1',
    fileId: 'photo1',
    segmentationClass: 'roof',
    polygon: [
      { x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 100, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
    ],
    confidence: 80,
    maskBounds: { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const },
    workerVersion: '1.0.0-test',
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeStructuralLine(overrides: Partial<StructuralLineCandidate> = {}): StructuralLineCandidate {
  return {
    artifactType: 'structural_line_candidate',
    id: 'line-1',
    fileId: 'photo1',
    lineType: 'ridge',
    start: { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' as const },
    end: { x: 500, y: 200, coordinateSystem: 'normalized_image_0_1000' as const },
    confidence: 70,
    workerVersion: '1.0.0-line-extraction-worker',
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeDepthMap(overrides: Partial<DepthMap> = {}): DepthMap {
  return {
    artifactType: 'depth_map',
    fileId: 'photo1',
    width: 64,
    height: 64,
    depthData: 'AAAAAA==',
    depthMetric: 'normalized_relative',
    confidence: 50,
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeConsensusPlane(overrides: Partial<ConsensusPlaneCandidate> = {}): ConsensusPlaneCandidate {
  return {
    artifactType: 'consensus_plane_candidate',
    id: 'consensus-1',
    planeType: 'roof',
    polygon: [
      { x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 100, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
    ],
    normalVector: { x: 0, y: 0, z: 1 },
    estimatedPitch: 30,
    estimatedAzimuth: 180,
    confidence: 75,
    sourceMaskIds: [],
    sourceFileIds: ['photo1', 'photo2'],
    consensusPhotoCount: 2,
    workerVersion: '1.0.0-multi-view-fusion-worker',
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: ['Heuristic only'],
    ...overrides,
  };
}

function makeResult(artifacts: unknown[] = []): GeometryReconstructionResult {
  return {
    schemaVersion: 'geometry_reconstruction_result_v1',
    job: makeJob(),
    artifactCount: artifacts.length,
    artifacts: artifacts as GeometryReconstructionResult['artifacts'],
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeometryReconstructionPreview V2', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------
  describe('basic rendering', () => {
    it('renders the component header', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      expect(screen.getByText(/Geometry Reconstruction Preview/i)).toBeInTheDocument();
    });

    it('renders the review-only badge in the header', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      // Review-Only appears in the header badge and the badges row; use getAllByText
      const reviewOnlyElements = screen.getAllByText(/Review-Only/i);
      expect(reviewOnlyElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the authority disclaimer', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      // The disclaimer text is "Review-Only / Non-Authoritative / Not CAD Geometry"
      expect(screen.getByText(/Review-Only \/ Non-Authoritative \/ Not CAD Geometry/i)).toBeInTheDocument();
    });

    it('shows empty state when no artifacts', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      expect(screen.getByText(/No reconstruction artifacts yet/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Artifact display
  // -----------------------------------------------------------------------
  describe('artifact display', () => {
    it('renders roof plane candidates', () => {
      const result = makeResult([makeRoofPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Roof Plane Candidates/i)).toBeInTheDocument();
      expect(screen.getByText(/Roof Plane #1/i)).toBeInTheDocument();
    });

    it('renders wall plane candidates', () => {
      const result = makeResult([makeWallPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Wall Plane Candidates/i)).toBeInTheDocument();
      expect(screen.getByText(/Wall Plane #1/i)).toBeInTheDocument();
    });

    it('renders segmentation masks', () => {
      const result = makeResult([makeSemanticMask()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Segmentation Masks/i)).toBeInTheDocument();
      expect(screen.getByText(/roof Mask #1/i)).toBeInTheDocument();
    });

    it('renders structural lines', () => {
      const result = makeResult([makeStructuralLine()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Structural Lines/i)).toBeInTheDocument();
      expect(screen.getByText(/Ridge #1/i)).toBeInTheDocument();
    });

    it('renders depth maps', () => {
      const result = makeResult([makeDepthMap()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      // "Depth Maps" appears in count tile AND section header — use getAllByText
      const depthElements = screen.getAllByText(/Depth Maps/i);
      expect(depthElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Depth Map #1/i)).toBeInTheDocument();
    });

    it('renders consensus planes', () => {
      const result = makeResult([makeConsensusPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Consensus Planes/i)).toBeInTheDocument();
      expect(screen.getByText(/Consensus Roof #1/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Provenance display
  // -----------------------------------------------------------------------
  describe('provenance display', () => {
    it('shows worker version on segmentation masks', () => {
      const result = makeResult([makeSemanticMask({ workerVersion: '1.0.0-seg-worker' })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/v1\.0\.0-seg-worker/i)).toBeInTheDocument();
    });

    it('shows worker version on structural lines', () => {
      const result = makeResult([makeStructuralLine({ workerVersion: '1.0.0-line-worker' })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/v1\.0\.0-line-worker/i)).toBeInTheDocument();
    });

    it('shows worker version on consensus planes', () => {
      const result = makeResult([makeConsensusPlane({ workerVersion: '1.0.0-fusion-worker' })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/v1\.0\.0-fusion-worker/i)).toBeInTheDocument();
    });

    it('shows consensus photo count on consensus planes', () => {
      const result = makeResult([makeConsensusPlane({ consensusPhotoCount: 3 })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Photos: 3/i)).toBeInTheDocument();
    });

    it('shows estimated pitch on consensus roof planes', () => {
      const result = makeResult([makeConsensusPlane({ estimatedPitch: 35 })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Pitch: 35/i)).toBeInTheDocument();
    });

    it('shows estimated azimuth on consensus planes', () => {
      const result = makeResult([makeConsensusPlane({ estimatedAzimuth: 90 })]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Azimuth: 90/i)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Toggle filters
  // -----------------------------------------------------------------------
  describe('toggle filters', () => {
    it('renders filter buttons when artifacts exist', () => {
      const result = makeResult([makeRoofPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Filter:/i)).toBeInTheDocument();
    });

    it('shows artifact type filter buttons', () => {
      const result = makeResult([
        makeRoofPlane(),
        makeSemanticMask(),
        makeStructuralLine(),
        makeDepthMap(),
        makeConsensusPlane(),
      ]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      // Use getAllByRole for Lines since both "Lines" and "Legacy Lines" buttons exist
      expect(screen.getByRole('button', { name: /Masks/i })).toBeInTheDocument();
      const linesButtons = screen.getAllByRole('button', { name: /Lines/i });
      expect(linesButtons.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: /Roof Planes/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Depth/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Consensus/i })).toBeInTheDocument();
    });

    it('hides roof planes when toggle is clicked', () => {
      const result = makeResult([makeRoofPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      // Roof plane should be visible initially
      expect(screen.getByText(/Roof Plane #1/i)).toBeInTheDocument();
      // Click the Roof Planes toggle to hide
      const toggle = screen.getByRole('button', { name: /Roof Planes/i });
      fireEvent.click(toggle);
      // Roof plane card should now be hidden
      expect(screen.queryByText(/Roof Plane #1/i)).not.toBeInTheDocument();
    });

    it('shows roof planes again when toggle is clicked twice', () => {
      const result = makeResult([makeRoofPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      const toggle = screen.getByRole('button', { name: /Roof Planes/i });
      fireEvent.click(toggle);
      expect(screen.queryByText(/Roof Plane #1/i)).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getByText(/Roof Plane #1/i)).toBeInTheDocument();
    });

    it('hides segmentation masks when toggle is clicked', () => {
      const result = makeResult([makeSemanticMask()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/roof Mask #1/i)).toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: /Masks/i });
      fireEvent.click(toggle);
      expect(screen.queryByText(/roof Mask #1/i)).not.toBeInTheDocument();
    });

    it('hides consensus planes when toggle is clicked', () => {
      const result = makeResult([makeConsensusPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      expect(screen.getByText(/Consensus Roof #1/i)).toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: /Consensus/i });
      fireEvent.click(toggle);
      expect(screen.queryByText(/Consensus Roof #1/i)).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Count tiles
  // -----------------------------------------------------------------------
  describe('count tiles', () => {
    it('shows correct count for roof planes', () => {
      const result = makeResult([makeRoofPlane(), makeRoofPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      // Should show count of 2
      const tiles = screen.getAllByText('2');
      expect(tiles.length).toBeGreaterThanOrEqual(1);
    });

    it('shows consensus count tile when consensus planes exist', () => {
      const result = makeResult([makeConsensusPlane()]);
      render(<GeometryReconstructionPreview surveyId="survey-1" initialResult={result} />);
      // "Consensus" appears in count tile, filter button, section header, and card — use getAllByText
      const consensusElements = screen.getAllByText(/Consensus/i);
      expect(consensusElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Authority badges
  // -----------------------------------------------------------------------
  describe('authority badges', () => {
    it('shows Non-Authoritative badge', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      // "Non-Authoritative" appears in the disclaimer text and in the badge span
      const elements = screen.getAllByText(/Non-Authoritative/i);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it('shows No CAD Mutation badge', () => {
      render(<GeometryReconstructionPreview surveyId="survey-1" />);
      expect(screen.getByText(/No CAD Mutation/i)).toBeInTheDocument();
    });
  });
});
