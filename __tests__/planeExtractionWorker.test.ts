/**
 * Plane extraction worker tests.
 *
 * Tests the runPlaneExtractionWorker function that produces
 * RoofPlaneCandidate and WallPlaneCandidate artifacts from
 * segmentation masks, structural lines, and vanishing points.
 *
 * @jest-environment node
 */

import {
  runPlaneExtractionWorker,
  runPlaneExtractionFromReconstructionInput,
  PLANE_EXTRACTION_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/planeExtraction';
import type { PlaneExtractionWorkerInput } from '@/lib/siteSurveys/geometryReconstruction/workers/planeExtraction';
import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  VanishingPointArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  GeometryReconstructionInput,
  NormalizedPoint,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number): NormalizedPoint {
  return { x, y, coordinateSystem: 'normalized_image_0_1000' };
}

function makeMask(overrides?: Partial<SemanticSegmentationMask>): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: 'seg-file-001-roof-1.0.0',
    fileId: 'file-001',
    segmentationClass: 'roof',
    polygon: [
      pt(200, 100), pt(500, 60), pt(800, 100), pt(750, 350), pt(250, 350),
    ],
    confidence: 72,
    maskBounds: { x: 200, y: 60, width: 600, height: 290, coordinateSystem: 'normalized_image_0_1000' },
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeWallMask(overrides?: Partial<SemanticSegmentationMask>): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: 'seg-file-001-wall-1.0.0',
    fileId: 'file-001',
    segmentationClass: 'wall',
    polygon: [pt(250, 350), pt(750, 350), pt(750, 700), pt(250, 700)],
    confidence: 68,
    maskBounds: { x: 250, y: 350, width: 500, height: 350, coordinateSystem: 'normalized_image_0_1000' },
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeLine(overrides: Partial<StructuralLineCandidate> & { lineType: StructuralLineCandidate['lineType'] }): StructuralLineCandidate {
  return {
    artifactType: 'structural_line_candidate',
    id: `line-${overrides.lineType}-001`,
    fileId: 'file-001',
    confidence: 65,
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeVP(overrides?: Partial<VanishingPointArtifact>): VanishingPointArtifact {
  return {
    artifactType: 'vanishing_point',
    id: 'vp-x-survey-001',
    fileId: 'file-001',
    direction: 'x',
    point: pt(1500, 300),
    supportingLineCount: 4,
    supportingLineIds: ['line-ridge-001', 'line-ridge-002'],
    inlierRatio: 0.85,
    confidence: 75,
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<PlaneExtractionWorkerInput>): PlaneExtractionWorkerInput {
  const roofMask = makeMask();
  const wallMask = makeWallMask();

  const ridgeLine = makeLine({
    id: 'line-ridge-001',
    lineType: 'ridge',
    start: pt(250, 80),
    end: pt(750, 80),
  });

  const eaveLine = makeLine({
    id: 'line-eave-001',
    lineType: 'eave',
    start: pt(250, 340),
    end: pt(750, 340),
  });

  const wallVertLine = makeLine({
    id: 'line-wall_vertical-001',
    lineType: 'wall_vertical',
    start: pt(260, 350),
    end: pt(260, 690),
  });

  const rakeLine = makeLine({
    id: 'line-rake-001',
    lineType: 'rake',
    start: pt(220, 110),
    end: pt(260, 340),
  });

  const xVp = makeVP({ id: 'vp-x-s1', direction: 'x' });
  const yVp = makeVP({ id: 'vp-y-s1', direction: 'y', point: pt(-200, 400) });

  return {
    surveyId: 'survey-001',
    masks: [roofMask, wallMask],
    lines: [ridgeLine, eaveLine, wallVertLine, rakeLine],
    vanishingPoints: [xVp, yVp],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'plane_extraction',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plane extraction worker', () => {
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', () => {
      const result = runPlaneExtractionWorker(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
    });

    it('returns the correct worker version', () => {
      const result = runPlaneExtractionWorker(makeInput());
      expect(result.workerVersion).toBe(PLANE_EXTRACTION_WORKER_VERSION);
    });

    it('produces roof_plane_candidate and wall_plane_candidate artifacts', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const types = result.artifacts.map(a => a.artifactType);
      expect(types).toContain('roof_plane_candidate');
      expect(types).toContain('wall_plane_candidate');
    });
  });

  describe('empty input handling', () => {
    it('returns empty artifacts for no masks', () => {
      const result = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [],
        lines: [],
        vanishingPoints: [],
      });
      expect(result.artifacts).toEqual([]);
    });

    it('returns empty artifacts for non-structural masks only', () => {
      const skyMask = makeMask({ segmentationClass: 'sky', id: 'seg-file-001-sky-1.0.0' });
      const result = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [skyMask],
        lines: [],
        vanishingPoints: [],
      });
      expect(result.artifacts).toEqual([]);
    });
  });

  describe('roof plane extraction', () => {
    it('produces roof planes from roof masks', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      expect(roofPlanes.length).toBeGreaterThan(0);
    });

    it('roof planes have normal vectors', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      for (const rp of roofPlanes) {
        expect(rp.normal).toHaveLength(3);
        expect(rp.normal[0]).toBeDefined();
        expect(rp.normal[1]).toBeDefined();
        expect(rp.normal[2]).toBeDefined();
      }
    });

    it('roof planes have slope and aspect', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      for (const rp of roofPlanes) {
        expect(rp.slopeDegrees).toBeGreaterThan(0);
        expect(rp.slopeDegrees).toBeLessThanOrEqual(90);
        expect(rp.aspectDegrees).toBeGreaterThanOrEqual(0);
        expect(rp.aspectDegrees).toBeLessThan(360);
      }
    });

    it('roof planes have associated line IDs', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      for (const rp of roofPlanes) {
        expect(Array.isArray(rp.associatedLineIds)).toBe(true);
      }
    });

    it('roof planes have bounding regions', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      for (const rp of roofPlanes) {
        expect(rp.region).toBeDefined();
        expect(rp.region!.coordinateSystem).toBe('normalized_image_0_1000');
      }
    });
  });

  describe('wall plane extraction', () => {
    it('produces wall planes from wall masks', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      expect(wallPlanes.length).toBeGreaterThan(0);
    });

    it('wall planes have normal vectors', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      for (const wp of wallPlanes) {
        expect(wp.normal).toHaveLength(3);
      }
    });

    it('wall planes have estimated height', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      for (const wp of wallPlanes) {
        expect(wp.estimatedHeightM).toBeGreaterThan(0);
        expect(wp.estimatedHeightM).toBeLessThanOrEqual(15);
      }
    });

    it('wall planes have facing direction', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      const validDirections = ['north', 'south', 'east', 'west'];
      for (const wp of wallPlanes) {
        expect(validDirections).toContain(wp.facingDirection);
      }
    });

    it('wall planes have associated line IDs', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      for (const wp of wallPlanes) {
        expect(Array.isArray(wp.associatedLineIds)).toBe(true);
      }
    });
  });

  describe('authority and limitations', () => {
    it('all artifacts carry review-only authority', () => {
      const result = runPlaneExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.authority).toEqual(REVIEW_ONLY_AUTHORITY);
      }
    });

    it('all artifacts carry limitations', () => {
      const result = runPlaneExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations.length).toBeGreaterThan(0);
        expect(artifact.limitations).toContain('REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY');
      }
    });

    it('limitations include plane-extraction-specific disclaimers', () => {
      const result = runPlaneExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations).toContain(
          'Plane extraction is heuristic — not from RANSAC on depth data or model inference.',
        );
      }
    });
  });

  describe('confidence scoring', () => {
    it('confidence is between 0 and 100', () => {
      const result = runPlaneExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('respects minConfidence config', () => {
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        config: { minConfidence: 80 },
      });
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(80);
      }
    });

    it('masks with more supporting lines have higher confidence', () => {
      const roofMask = makeMask();
      const manyLines = [
        makeLine({ id: 'line-ridge-001', lineType: 'ridge', start: pt(250, 80), end: pt(750, 80) }),
        makeLine({ id: 'line-eave-001', lineType: 'eave', start: pt(250, 340), end: pt(750, 340) }),
        makeLine({ id: 'line-rake-001', lineType: 'rake', start: pt(220, 110), end: pt(260, 340) }),
        makeLine({ id: 'line-rake-002', lineType: 'rake', start: pt(740, 110), end: pt(750, 340) }),
      ];
      const fewLines = [
        makeLine({ id: 'line-ridge-001', lineType: 'ridge', start: pt(250, 80), end: pt(750, 80) }),
      ];

      const resultMany = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: manyLines,
        vanishingPoints: [],
      });
      const resultFew = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: fewLines,
        vanishingPoints: [],
      });

      const manyConf = resultMany.artifacts.find(a => a.artifactType === 'roof_plane_candidate')?.confidence ?? 0;
      const fewConf = resultFew.artifacts.find(a => a.artifactType === 'roof_plane_candidate')?.confidence ?? 0;
      expect(manyConf).toBeGreaterThanOrEqual(fewConf);
    });
  });

  describe('requireSupportingLines config', () => {
    it('skips masks with no supporting lines when requireSupportingLines is true', () => {
      const roofMask = makeMask();
      // Lines that don't overlap with the roof mask
      const distantLines = [
        makeLine({ id: 'line-ridge-far', lineType: 'ridge', start: pt(100, 800), end: pt(900, 800) }),
      ];

      const result = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: distantLines,
        vanishingPoints: [],
        config: { requireSupportingLines: true },
      });
      expect(result.artifacts.length).toBe(0);
    });

    it('includes masks with no supporting lines when requireSupportingLines is false', () => {
      const roofMask = makeMask();
      const result = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: [],
        vanishingPoints: [],
        config: { requireSupportingLines: false },
      });
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('stage timings', () => {
    it('records timing for each processing stage', () => {
      const result = runPlaneExtractionWorker(makeInput());
      expect(result.stageTimings['initialization']).toBeDefined();
      expect(result.stageTimings['line_association']).toBeDefined();
      expect(result.stageTimings['roof_extraction']).toBeDefined();
      expect(result.stageTimings['wall_extraction']).toBeDefined();
    });

    it('all timings are non-negative numbers', () => {
      const result = runPlaneExtractionWorker(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const input = makeInput();
      const result1 = runPlaneExtractionWorker(input);
      const result2 = runPlaneExtractionWorker(input);
      expect(result1.artifacts).toEqual(result2.artifacts);
    });
  });

  describe('runPlaneExtractionFromReconstructionInput', () => {
    it('converts input and delegates to the worker', () => {
      const input = makeReconstructionInput();
      const masks = [makeMask(), makeWallMask()];
      const lines = [
        makeLine({ id: 'line-ridge-001', lineType: 'ridge', start: pt(250, 80), end: pt(750, 80) }),
      ];
      const vps = [makeVP()];

      const artifacts = runPlaneExtractionFromReconstructionInput(input, masks, lines, vps);
      expect(artifacts.length).toBeGreaterThan(0);
      const types = artifacts.map(a => a.artifactType);
      expect(types).toContain('roof_plane_candidate');
    });

    it('returns empty array for no masks', () => {
      const input = makeReconstructionInput();
      const artifacts = runPlaneExtractionFromReconstructionInput(input, [], [], []);
      expect(artifacts).toEqual([]);
    });
  });

  describe('normal vector properties', () => {
    it('roof plane normals are unit-ish vectors', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      for (const rp of roofPlanes) {
        const len = Math.sqrt(rp.normal[0] ** 2 + rp.normal[1] ** 2 + rp.normal[2] ** 2);
        // Allow some numerical imprecision
        expect(len).toBeCloseTo(1, 1);
      }
    });

    it('wall plane normals are unit-ish vectors', () => {
      const result = runPlaneExtractionWorker(makeInput());
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      for (const wp of wallPlanes) {
        const len = Math.sqrt(wp.normal[0] ** 2 + wp.normal[1] ** 2 + wp.normal[2] ** 2);
        expect(len).toBeCloseTo(1, 1);
      }
    });
  });
});
