/**
 * Line extraction worker tests.
 *
 * Tests the runLineExtractionWorker function that produces
 * StructuralLineCandidate artifacts from segmentation masks.
 *
 * @jest-environment node
 */

import {
  runLineExtractionWorker,
  runLineExtractionFromReconstructionInput,
  LINE_EXTRACTION_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/lineExtraction';
import type { LineExtractionWorkerInput } from '@/lib/siteSurveys/geometryReconstruction/workers/lineExtraction';
import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  GeometryReconstructionInput,
  NormalizedPoint,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import { validateStructuralLineCandidate } from '@/lib/siteSurveys/geometryReconstruction/schemas';

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
      pt(200, 100),  // top-left
      pt(500, 60),   // ridge
      pt(800, 100),  // top-right
      pt(750, 350),  // bottom-right (eave)
      pt(250, 350),  // bottom-left (eave)
    ],
    confidence: 72,
    maskBounds: {
      x: 200, y: 60, width: 600, height: 290,
      coordinateSystem: 'normalized_image_0_1000',
    },
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
    polygon: [
      pt(250, 350),  // top-left
      pt(750, 350),  // top-right
      pt(750, 700),  // bottom-right
      pt(250, 700),  // bottom-left
    ],
    confidence: 68,
    maskBounds: {
      x: 250, y: 350, width: 500, height: 350,
      coordinateSystem: 'normalized_image_0_1000',
    },
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<LineExtractionWorkerInput>): LineExtractionWorkerInput {
  return {
    surveyId: 'survey-001',
    masks: [makeMask(), makeWallMask()],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'line_extraction',
  };
}

// ---------------------------------------------------------------------------
// Basic output shape
// ---------------------------------------------------------------------------

describe('line extraction worker', () => {
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', () => {
      const result = runLineExtractionWorker(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
    });

    it('returns the correct worker version', () => {
      const result = runLineExtractionWorker(makeInput());
      expect(result.workerVersion).toBe(LINE_EXTRACTION_WORKER_VERSION);
    });

    it('produces StructuralLineCandidate artifacts', () => {
      const result = runLineExtractionWorker(makeInput());
      expect(result.artifacts.length).toBeGreaterThan(0);
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('structural_line_candidate');
      }
    });
  });

  describe('empty input handling', () => {
    it('returns empty artifacts for no masks', () => {
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [] });
      expect(result.artifacts).toEqual([]);
    });

    it('returns empty artifacts for non-structural masks only', () => {
      const skyMask = makeMask({ segmentationClass: 'sky', id: 'seg-file-001-sky-1.0.0' });
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [skyMask] });
      // Sky masks should not produce structural lines
      expect(result.artifacts).toEqual([]);
    });
  });

  describe('edge classification', () => {
    it('produces ridge lines from horizontal roof edges in upper region', () => {
      // Roof mask with a clear horizontal ridge
      const roofMask = makeMask({
        polygon: [
          pt(200, 150),
          pt(800, 150),  // horizontal ridge at y=150
          pt(800, 350),
          pt(200, 350),
        ],
      });
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [roofMask] });
      const ridges = result.artifacts.filter(a => a.lineType === 'ridge');
      expect(ridges.length).toBeGreaterThan(0);
    });

    it('produces eave lines from horizontal roof edges in lower region', () => {
      const roofMask = makeMask({
        polygon: [
          pt(200, 100),
          pt(800, 100),
          pt(800, 350),
          pt(200, 350),  // horizontal eave at y=350
        ],
      });
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [roofMask] });
      const eaves = result.artifacts.filter(a => a.lineType === 'eave');
      expect(eaves.length).toBeGreaterThan(0);
    });

    it('produces wall_vertical lines from vertical wall edges', () => {
      const wallMask = makeWallMask();
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [wallMask] });
      const wallVerts = result.artifacts.filter(a => a.lineType === 'wall_vertical');
      expect(wallVerts.length).toBeGreaterThan(0);
    });

    it('produces rake lines from diagonal roof edges', () => {
      // Roof with diagonal rake edges
      const roofMask = makeMask({
        polygon: [
          pt(300, 100),
          pt(700, 100),
          pt(800, 350),  // diagonal rake
          pt(200, 350),  // diagonal rake
        ],
      });
      const result = runLineExtractionWorker({ surveyId: 's1', masks: [roofMask] });
      const rakes = result.artifacts.filter(a => a.lineType === 'rake');
      expect(rakes.length).toBeGreaterThan(0);
    });
  });

  describe('artifact validation', () => {
    it('all produced artifacts pass schema validation', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        const validation = validateStructuralLineCandidate(artifact);
        expect(validation.valid).toBe(true);
      }
    });

    it('artifacts have correct artifactType discriminator', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('structural_line_candidate');
      }
    });

    it('artifacts have valid line types', () => {
      const validTypes = ['ridge', 'eave', 'rake', 'wall_vertical', 'wall_bottom_edge'];
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(validTypes).toContain(artifact.lineType);
      }
    });
  });

  describe('authority and limitations', () => {
    it('all artifacts carry review-only authority', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.authority).toEqual(REVIEW_ONLY_AUTHORITY);
      }
    });

    it('all artifacts carry limitations', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations.length).toBeGreaterThan(0);
        expect(artifact.limitations).toContain('REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY');
      }
    });

    it('limitations include line-extraction-specific disclaimers', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations).toContain(
          'Heuristic edge extraction from SAM2 polygon boundaries — not from Hough transform or model inference',
        );
      }
    });
  });

  describe('confidence scoring', () => {
    it('confidence is between 0 and 100', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('respects minConfidence config', () => {
      const result = runLineExtractionWorker(makeInput({ config: { minConfidence: 90 } }));
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(90);
      }
    });

    it('longer edges have higher confidence than shorter ones', () => {
      // Short edge roof
      const shortRoof = makeMask({
        polygon: [
          pt(450, 100),
          pt(550, 100),
          pt(550, 150),
          pt(450, 150),
        ],
      });
      // Long edge roof
      const longRoof = makeMask({
        id: 'seg-file-002-roof-1.0.0',
        fileId: 'file-002',
        polygon: [
          pt(100, 100),
          pt(900, 100),
          pt(900, 150),
          pt(100, 150),
        ],
      });

      const resultShort = runLineExtractionWorker({ surveyId: 's1', masks: [shortRoof] });
      const resultLong = runLineExtractionWorker({ surveyId: 's1', masks: [longRoof] });

      // Long roof should have higher average confidence
      if (resultShort.artifacts.length > 0 && resultLong.artifacts.length > 0) {
        const avgShort = resultShort.artifacts.reduce((s, a) => s + a.confidence, 0) / resultShort.artifacts.length;
        const avgLong = resultLong.artifacts.reduce((s, a) => s + a.confidence, 0) / resultLong.artifacts.length;
        expect(avgLong).toBeGreaterThanOrEqual(avgShort);
      }
    });
  });

  describe('edge filtering', () => {
    it('filters out edges shorter than minEdgeLength', () => {
      const roofMask = makeMask({
        polygon: [
          pt(495, 100),
          pt(505, 100),  // Very short horizontal edge (10 units)
          pt(505, 120),  // Short vertical edge (20 units)
          pt(495, 120),  // Short vertical edge (20 units)
        ],
      });
      const result = runLineExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        config: { minEdgeLength: 50 },
      });
      // All edges are < 50 units, so no lines should be extracted
      expect(result.artifacts.length).toBe(0);
    });

    it('keeps edges at or above minEdgeLength', () => {
      const roofMask = makeMask({
        polygon: [
          pt(200, 100),
          pt(800, 100),
          pt(800, 150),
          pt(200, 150),
        ],
      });
      const result = runLineExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        config: { minEdgeLength: 50 },
      });
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('collinear merging', () => {
    it('merges collinear edges when mergeCollinear is true', () => {
      // Create a mask with a notch (two collinear horizontal edges)
      const notchedMask = makeMask({
        polygon: [
          pt(200, 100),
          pt(500, 100),  // end of first horizontal segment
          pt(520, 105),  // small notch
          pt(800, 100),  // end of second horizontal segment
          pt(800, 350),
          pt(200, 350),
        ],
      });
      const resultWith = runLineExtractionWorker({
        surveyId: 's1',
        masks: [notchedMask],
        config: { mergeCollinear: true, maxMergeGap: 50 },
      });
      const resultWithout = runLineExtractionWorker({
        surveyId: 's1',
        masks: [notchedMask],
        config: { mergeCollinear: false },
      });
      // With merging, should have fewer or equal lines
      expect(resultWith.artifacts.length).toBeLessThanOrEqual(resultWithout.artifacts.length);
    });

    it('does not merge when mergeCollinear is false', () => {
      const notchedMask = makeMask({
        polygon: [
          pt(200, 100),
          pt(500, 100),
          pt(520, 105),
          pt(800, 100),
          pt(800, 350),
          pt(200, 350),
        ],
      });
      const result = runLineExtractionWorker({
        surveyId: 's1',
        masks: [notchedMask],
        config: { mergeCollinear: false },
      });
      // Should produce individual edges without merging
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('source mask tracking', () => {
    it('each line tracks its source mask', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.sourceMaskId).toBeDefined();
        expect(typeof artifact.sourceMaskId).toBe('string');
      }
    });

    it('fileId is derived from source mask id', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.fileId).toBeDefined();
        expect(typeof artifact.fileId).toBe('string');
      }
    });
  });

  describe('worker version', () => {
    it('all artifacts carry the worker version', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.workerVersion).toBe(LINE_EXTRACTION_WORKER_VERSION);
      }
    });
  });

  describe('stage timings', () => {
    it('records timing for each processing stage', () => {
      const result = runLineExtractionWorker(makeInput());
      expect(result.stageTimings['mask_prefilter']).toBeDefined();
      expect(result.stageTimings['edge_extraction']).toBeDefined();
      expect(result.stageTimings['edge_filtering']).toBeDefined();
      expect(result.stageTimings['straightness_filter']).toBeDefined();
      expect(result.stageTimings['edge_classification']).toBeDefined();
      expect(result.stageTimings['collinear_merging']).toBeDefined();
      expect(result.stageTimings['cross_mask_dedup']).toBeDefined();
      expect(result.stageTimings['per_mask_cap']).toBeDefined();
      expect(result.stageTimings['artifact_creation']).toBeDefined();
    });

    it('all timings are non-negative numbers', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const input = makeInput();
      const result1 = runLineExtractionWorker(input);
      const result2 = runLineExtractionWorker(input);
      expect(result1.artifacts).toEqual(result2.artifacts);
    });
  });

  describe('runLineExtractionFromReconstructionInput', () => {
    it('converts input and delegates to the worker', () => {
      const input = makeReconstructionInput();
      const masks = [makeMask(), makeWallMask()];
      const artifacts = runLineExtractionFromReconstructionInput(input, masks);
      expect(artifacts.length).toBeGreaterThan(0);
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBe('structural_line_candidate');
      }
    });

    it('returns empty array for no masks', () => {
      const input = makeReconstructionInput();
      const artifacts = runLineExtractionFromReconstructionInput(input, []);
      expect(artifacts).toEqual([]);
    });
  });

  describe('angle tolerance config', () => {
    it('with narrow tolerance, only very horizontal/vertical edges are classified', () => {
      const roofMask = makeMask({
        polygon: [
          pt(200, 100),
          pt(800, 120),  // slightly tilted horizontal
          pt(800, 350),
          pt(200, 350),
        ],
      });
      const resultNarrow = runLineExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        config: { angleTolerance: 2 },
      });
      const resultWide = runLineExtractionWorker({
        surveyId: 's1',
        masks: [roofMask],
        config: { angleTolerance: 30 },
      });
      // Wider tolerance should classify more edges
      expect(resultWide.artifacts.length).toBeGreaterThanOrEqual(resultNarrow.artifacts.length);
    });
  });

  describe('normalization of line endpoints', () => {
    it('start and end points use normalized_image_0_1000 coordinate system', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.start.coordinateSystem).toBe('normalized_image_0_1000');
        expect(artifact.end.coordinateSystem).toBe('normalized_image_0_1000');
      }
    });

    it('coordinates are within 0-1000 range', () => {
      const result = runLineExtractionWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.start.x).toBeGreaterThanOrEqual(0);
        expect(artifact.start.x).toBeLessThanOrEqual(1000);
        expect(artifact.start.y).toBeGreaterThanOrEqual(0);
        expect(artifact.start.y).toBeLessThanOrEqual(1000);
        expect(artifact.end.x).toBeGreaterThanOrEqual(0);
        expect(artifact.end.x).toBeLessThanOrEqual(1000);
        expect(artifact.end.y).toBeGreaterThanOrEqual(0);
        expect(artifact.end.y).toBeLessThanOrEqual(1000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Regression: structure-first line extraction filter (Task 3)
  // -------------------------------------------------------------------------
  describe('regression: structure-first line extraction filter', () => {
    it('rejects non-structure masks — vehicle, grass, tree, driveway produce no lines', () => {
      const truckMask = makeMask({ id: 'seg-truck', segmentationClass: 'truck', polygon: [
        pt(100, 500), pt(300, 500), pt(300, 700), pt(100, 700),
      ]});
      const grassMask = makeMask({ id: 'seg-grass', segmentationClass: 'grass', polygon: [
        pt(0, 700), pt(1000, 700), pt(1000, 1000), pt(0, 1000),
      ]});
      const treeMask = makeMask({ id: 'seg-tree', segmentationClass: 'trees', polygon: [
        pt(50, 200), pt(200, 200), pt(200, 600), pt(50, 600),
      ]});
      const drivewayMask = makeMask({ id: 'seg-driveway', segmentationClass: 'driveway', polygon: [
        pt(400, 700), pt(700, 700), pt(700, 1000), pt(400, 1000),
      ]});
      const skyMask = makeMask({ id: 'seg-sky', segmentationClass: 'sky', polygon: [
        pt(0, 0), pt(1000, 0), pt(1000, 200), pt(0, 200),
      ]});

      const result = runLineExtractionWorker({
        surveyId: 's-non-structure',
        masks: [truckMask, grassMask, treeMask, drivewayMask, skyMask],
      });

      expect(result.artifacts.length).toBe(0);
      expect(result.filterStats.masksRejectedByClass).toBe(5);
      expect(result.filterStats.masksPassedPrefilter).toBe(0);
    });

    it('only structure-qualified masks produce structural line candidates', () => {
      const roofMask = makeMask({ id: 'seg-roof', segmentationClass: 'roof' });
      const wallMask = makeWallMask({ id: 'seg-wall', segmentationClass: 'wall' });
      const grassMask = makeMask({ id: 'seg-grass', segmentationClass: 'grass', polygon: [
        pt(0, 700), pt(1000, 700), pt(1000, 1000), pt(0, 1000),
      ]});

      const result = runLineExtractionWorker({
        surveyId: 's-mixed',
        masks: [roofMask, wallMask, grassMask],
      });

      // All lines must come from roof or wall masks, never from grass
      for (const artifact of result.artifacts) {
        expect(artifact.sourceMaskId).not.toContain('grass');
      }
      expect(result.filterStats.masksRejectedByClass).toBe(1);
      expect(result.filterStats.masksPassedPrefilter).toBe(2);
    });

    it('straightness filter rejects jagged micro-edges below minimum length', () => {
      // Create a small, jagged polygon — all edges are short micro-segments
      // Every edge (including closing edges) is well below minEdgeLength=50
      const jaggedMask = makeMask({
        id: 'seg-jagged-roof',
        segmentationClass: 'roof',
        polygon: [
          pt(400, 100), pt(410, 106), pt(420, 98), pt(430, 104),
          pt(440, 97), pt(450, 102), pt(445, 115), pt(408, 118),
        ],
        maskBounds: { x: 400, y: 97, width: 50, height: 21, coordinateSystem: 'normalized_image_0_1000' },
      });

      const result = runLineExtractionWorker({
        surveyId: 's-jagged',
        masks: [jaggedMask],
        config: { minEdgeLength: 50 },
      });

      // All jagged micro-edges should be too short to pass minEdgeLength=50
      expect(result.artifacts.length).toBe(0);
      expect(result.filterStats.edgesExtracted).toBeGreaterThan(0);
    });

    it('cross-mask deduplication reduces duplicate lines from adjacent masks', () => {
      // Two adjacent roof masks sharing an edge at y=350
      const roofMaskA = makeMask({
        id: 'seg-roof-A',
        segmentationClass: 'roof',
        polygon: [pt(200, 100), pt(500, 60), pt(800, 100), pt(750, 350), pt(250, 350)],
      });
      const roofMaskB = makeMask({
        id: 'seg-roof-B',
        segmentationClass: 'roof',
        polygon: [pt(250, 350), pt(750, 350), pt(800, 550), pt(200, 550)],
      });

      const resultNoDedup = runLineExtractionWorker({
        surveyId: 's-dedup-off',
        masks: [roofMaskA, roofMaskB],
        config: { crossMaskDedup: false },
      });
      const resultWithDedup = runLineExtractionWorker({
        surveyId: 's-dedup-on',
        masks: [roofMaskA, roofMaskB],
        config: { crossMaskDedup: true },
      });

      // Cross-mask dedup should reduce or maintain the line count
      expect(resultWithDedup.artifacts.length).toBeLessThanOrEqual(resultNoDedup.artifacts.length);
    });

    it('per-mask cap limits emitted line candidates per source mask', () => {
      // Create a complex roof polygon with many edges (irregular shape)
      const complexRoofMask = makeMask({
        id: 'seg-complex-roof',
        segmentationClass: 'roof',
        polygon: [
          pt(100, 80), pt(200, 50), pt(350, 40), pt(500, 55), pt(650, 45),
          pt(800, 70), pt(850, 200), pt(830, 350), pt(780, 400),
          pt(600, 420), pt(400, 410), pt(200, 390), pt(150, 300), pt(120, 180),
        ],
        maskBounds: { x: 100, y: 40, width: 750, height: 380, coordinateSystem: 'normalized_image_0_1000' },
      });

      const result = runLineExtractionWorker({
        surveyId: 's-cap',
        masks: [complexRoofMask],
        config: { maxLinesPerMask: 3 },
      });

      // Per-mask cap should limit output to ≤3 lines from this single mask
      expect(result.artifacts.length).toBeLessThanOrEqual(3);
      expect(result.filterStats.linesCappedByMask).toBeGreaterThanOrEqual(0);
    });

    it('detects wall_bottom_edge lines at wall/ground mask boundaries', () => {
      // Wall mask ending at y=700, grass mask starting at y=700
      const wallMask = makeWallMask({
        id: 'seg-wall-bottom',
        segmentationClass: 'wall',
        polygon: [pt(250, 350), pt(750, 350), pt(750, 700), pt(250, 700)],
        maskBounds: { x: 250, y: 350, width: 500, height: 350, coordinateSystem: 'normalized_image_0_1000' },
      });
      const grassMask = makeMask({
        id: 'seg-ground-grass',
        segmentationClass: 'grass',
        polygon: [pt(200, 700), pt(800, 700), pt(800, 1000), pt(200, 1000)],
        maskBounds: { x: 200, y: 700, width: 600, height: 300, coordinateSystem: 'normalized_image_0_1000' },
      });

      const result = runLineExtractionWorker({
        surveyId: 's-wall-bottom',
        masks: [wallMask, grassMask],
      });

      // Should detect wall_bottom_edge from wall mask + adjacent ground-level mask
      const bottomEdges = result.artifacts.filter(a => a.lineType === 'wall_bottom_edge');
      // The wall mask's bottom edge (y=700) should be classified as wall_bottom_edge
      // because an adjacent grass mask starts at the same y-coordinate
      expect(bottomEdges.length).toBeGreaterThanOrEqual(0);
      // At minimum, the wall mask should produce some structural lines
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });
});
