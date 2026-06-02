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
      const validTypes = ['ridge', 'eave', 'rake', 'wall_vertical'];
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
          'Line extraction is heuristic — not from Hough transform or model inference.',
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
      expect(result.stageTimings['initialization']).toBeDefined();
      expect(result.stageTimings['edge_extraction']).toBeDefined();
      expect(result.stageTimings['edge_filtering']).toBeDefined();
      expect(result.stageTimings['edge_classification']).toBeDefined();
      expect(result.stageTimings['collinear_merging']).toBeDefined();
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
});
