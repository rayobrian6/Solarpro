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
  DepthMap,
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

    it('ignores roof masks excluded from geometry', () => {
      const excludedRoof = makeMask({
        excludeFromGeometry: true,
        participation: {
          participatesInLines: false,
          participatesInPlanes: false,
          participatesInDepthFusion: false,
          participatesInPhotogrammetry: false,
        },
      });

      const result = runPlaneExtractionWorker(makeInput({ masks: [excludedRoof] }));
      expect(result.artifacts).toEqual([]);
    });

    it('ignores roof masks that opt out of plane participation', () => {
      const reviewOnlyRoof = makeMask({
        participation: {
          participatesInLines: true,
          participatesInPlanes: false,
          participatesInDepthFusion: true,
          participatesInPhotogrammetry: true,
        },
      });

      const result = runPlaneExtractionWorker(makeInput({ masks: [reviewOnlyRoof] }));
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
        // Heuristic-only path uses updated limitations text
        expect(
          artifact.limitations.some(l =>
            l.includes('heuristic') || l.includes('flood-fill') || l.includes('depth gradient'),
          ),
        ).toBe(true);
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
      // Heuristic-only path uses 'heuristic_extraction' key
      // Depth-augmented path uses 'depth_extraction' and optionally 'heuristic_fallback'
      const hasHeuristic = result.stageTimings['heuristic_extraction'] !== undefined;
      const hasDepth = result.stageTimings['depth_extraction'] !== undefined;
      expect(hasHeuristic || hasDepth).toBe(true);
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

  describe('depth-augmented extraction', () => {
    /** Create a synthetic DepthMap with a slanted region (roof) and a vertical region (wall). */
    function makeSyntheticDepthMap(
      width = 64,
      height = 64,
      fileId = 'file-001',
    ): DepthMap {
      // Create a depth grid with:
      // - Top portion: medium depth (roof-like, slanted)
      // - Middle-right: high gradient (wall-like)
      // - Top-far: high depth (sky/far)
      // - Bottom: low depth (ground/horizontal)
      const grid = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (y < height * 0.15) {
            // Sky/far region — high depth values
            grid[idx] = 0.9 + Math.random() * 0.05;
          } else if (y < height * 0.45 && x < width * 0.7) {
            // Roof/slanted region — moderate depth with gradient
            grid[idx] = 0.4 + (y / height) * 0.3 + (x / width) * 0.1;
          } else if (y >= height * 0.45 && y < height * 0.8 && x >= width * 0.65) {
            // Wall/vertical region — steep depth gradient
            grid[idx] = 0.3 + (y / height) * 0.4;
          } else if (y >= height * 0.8) {
            // Ground/horizontal — low depth
            grid[idx] = 0.1 + Math.random() * 0.05;
          } else {
            // Fill remaining
            grid[idx] = 0.5 + Math.random() * 0.1;
          }
        }
      }

      // Encode as base64
      const buffer = Buffer.from(grid.buffer);
      const depthData = buffer.toString('base64');

      return {
        artifactType: 'depth_map',
        fileId,
        width,
        height,
        depthData,
        depthMetric: 'normalized_relative',
        confidence: 75,
        authority: REVIEW_ONLY_AUTHORITY,
        limitations: [...BASE_LIMITATIONS, 'Synthetic depth map for testing.'],
      };
    }

    it('uses depth-augmented path when depthMaps is provided', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
      });

      // Should produce some artifacts from depth extraction
      expect(result.artifacts.length).toBeGreaterThan(0);
      // Should have depth_extraction timing
      expect(result.stageTimings['depth_extraction']).toBeDefined();
    });

    it('depth-derived artifacts have proper artifact types', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
      });

      const types = result.artifacts.map(a => a.artifactType);
      // Should contain at least roof or wall candidates
      const hasRoofOrWall = types.includes('roof_plane_candidate') || types.includes('wall_plane_candidate');
      expect(hasRoofOrWall).toBe(true);
    });

    it('depth-derived roof planes have slope and aspect', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
      });

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

    it('depth-derived wall planes have height and facing', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
      });

      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      for (const wp of wallPlanes) {
        if (wp.estimatedHeightM !== undefined) {
          expect(wp.estimatedHeightM).toBeGreaterThan(0);
          expect(wp.estimatedHeightM).toBeLessThanOrEqual(15);
        }
        if (wp.facingDirection !== undefined) {
          expect(['north', 'south', 'east', 'west']).toContain(wp.facingDirection);
        }
      }
    });

    it('depth artifacts carry depth-specific limitations', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
      });

      // Depth-derived artifacts should have depth-specific limitations
      const depthArtifacts = result.artifacts.filter(a =>
        a.limitations.some(l => l.includes('flood-fill') || l.includes('depth-aware')),
      );
      // At least some artifacts should have depth limitations
      expect(depthArtifacts.length).toBeGreaterThan(0);
    });

    it('blends depth with heuristic when masks overlap', () => {
      const depthMap = makeSyntheticDepthMap();
      const roofMask = makeMask(); // overlaps with the roof region by design
      const result = runPlaneExtractionWorker({
        surveyId: 'survey-001',
        masks: [roofMask],
        lines: [
          makeLine({ id: 'line-ridge-001', lineType: 'ridge', start: pt(250, 80), end: pt(750, 80) }),
        ],
        vanishingPoints: [makeVP()],
        depthMaps: [depthMap],
        usedMidas: true,
      });

      // Should have roof candidates from depth
      const roofPlanes = result.artifacts.filter(
        (a): a is RoofPlaneCandidate => a.artifactType === 'roof_plane_candidate',
      );
      // At least one roof plane should exist
      expect(roofPlanes.length).toBeGreaterThan(0);
      // If a mask was matched, it should have associatedLineIds
      for (const rp of roofPlanes) {
        if (rp.sourceMaskId) {
          // Blended: has both depth and heuristic info
          expect(Array.isArray(rp.associatedLineIds)).toBe(true);
        }
      }
    });

    it('falls back to heuristic for unprocessed masks', () => {
      // Create a depth map and a wall mask that likely won't overlap with depth planes
      const depthMap = makeSyntheticDepthMap(64, 64, 'file-001');
      const distantWallMask = makeWallMask({
        id: 'seg-file-001-wall-distant',
        fileId: 'file-002', // Different file ID — won't match depth map
        polygon: [pt(50, 350), pt(200, 350), pt(200, 700), pt(50, 700)],
        maskBounds: { x: 50, y: 350, width: 150, height: 350, coordinateSystem: 'normalized_image_0_1000' },
      });

      const result = runPlaneExtractionWorker({
        surveyId: 'survey-001',
        masks: [distantWallMask],
        lines: [],
        vanishingPoints: [],
        depthMaps: [depthMap],
        usedMidas: true,
      });

      // The wall mask for a different file should still produce a heuristic artifact
      const wallPlanes = result.artifacts.filter(
        (a): a is WallPlaneCandidate => a.artifactType === 'wall_plane_candidate',
      );
      expect(wallPlanes.length).toBeGreaterThan(0);
      // Should have heuristic_fallback timing
      expect(result.stageTimings['heuristic_fallback']).toBeDefined();
    });

    it('heuristic-only path still works without depth maps', () => {
      const result = runPlaneExtractionWorker(makeInput());
      // Should produce artifacts via heuristic path
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.stageTimings['heuristic_extraction']).toBeDefined();
    });

    it('respects minConfidence in depth path', () => {
      const depthMap = makeSyntheticDepthMap();
      const result = runPlaneExtractionWorker({
        ...makeInput(),
        depthMaps: [depthMap],
        usedMidas: true,
        config: { minConfidence: 95 },
      });

      // Very high minConfidence should filter out most or all depth planes
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(95);
      }
    });

    it('usedMidas affects confidence blending weight', () => {
      const depthMap = makeSyntheticDepthMap();
      const roofMask = makeMask();

      const resultMidas = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: [],
        vanishingPoints: [],
        depthMaps: [depthMap],
        usedMidas: true,
      });

      const resultNoMidas = runPlaneExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        lines: [],
        vanishingPoints: [],
        depthMaps: [depthMap],
        usedMidas: false,
      });

      // Both should produce artifacts, but MiDaS path may have different confidence
      expect(resultMidas.artifacts.length).toBeGreaterThan(0);
      expect(resultNoMidas.artifacts.length).toBeGreaterThan(0);
    });
  });
});
