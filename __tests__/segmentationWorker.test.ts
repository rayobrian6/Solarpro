/**
 * Segmentation worker tests.
 *
 * Tests the runSegmentationWorker function that produces
 * SemanticSegmentationMask artifacts from survey photos.
 *
 * @jest-environment node
 */

import {
  runSegmentationWorker,
  runSegmentationFromReconstructionInput,
  SEGMENTATION_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation';
import type { SegmentationWorkerInput } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation';
import type {
  SemanticSegmentationMask,
  GeometryReconstructionInput,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  SEGMENTATION_CLASSES,
  REVIEW_ONLY_AUTHORITY,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import { validateSemanticSegmentationMask } from '@/lib/siteSurveys/geometryReconstruction/schemas';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<SegmentationWorkerInput>): SegmentationWorkerInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
      { fileId: 'file-002', fileUrl: 'https://example.com/photo2.jpg', filename: 'photo2.jpg' },
    ],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'segmentation',
  };
}

// ---------------------------------------------------------------------------
// Basic output shape tests
// ---------------------------------------------------------------------------

describe('segmentation worker', () => {
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', () => {
      const result = runSegmentationWorker(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
      expect(result.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
    });

    it('produces artifacts for each segmentation class per photo', () => {
      const result = runSegmentationWorker(makeInput());
      // 2 photos × 7 classes = 14 masks (all above default minConfidence=30)
      expect(result.artifacts.length).toBeGreaterThan(0);

      // Every artifact must be a SemanticSegmentationMask
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });

    it('produces masks for all 7 segmentation classes per photo', () => {
      const result = runSegmentationWorker(makeInput());
      const file1Masks = result.artifacts.filter((a) => a.fileId === 'file-001');
      const file1Classes = new Set(file1Masks.map((a) => a.segmentationClass));

      // All classes should be represented (heuristic confidence for all is >= 30)
      for (const cls of SEGMENTATION_CLASSES) {
        expect(file1Classes.has(cls)).toBe(true);
      }
    });

    it('produces masks for each source photo', () => {
      const result = runSegmentationWorker(makeInput());
      const fileIds = new Set(result.artifacts.map((a) => a.fileId));
      expect(fileIds.has('file-001')).toBe(true);
      expect(fileIds.has('file-002')).toBe(true);
    });
  });

  describe('empty input handling', () => {
    it('returns empty artifacts array when no source photos', () => {
      const result = runSegmentationWorker(makeInput({ sourcePhotos: [] }));
      expect(result.artifacts).toEqual([]);
    });

    it('still returns stageTimings and workerVersion for empty input', () => {
      const result = runSegmentationWorker(makeInput({ sourcePhotos: [] }));
      expect(result.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
      expect(result.stageTimings).toHaveProperty('initialization');
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const input = makeInput();
      const result1 = runSegmentationWorker(input);
      const result2 = runSegmentationWorker(input);
      expect(result1.artifacts).toEqual(result2.artifacts);
    });

    it('produces different masks for different fileIds', () => {
      const result = runSegmentationWorker(makeInput());
      const file1Roof = result.artifacts.find(
        (a) => a.fileId === 'file-001' && a.segmentationClass === 'roof',
      );
      const file2Roof = result.artifacts.find(
        (a) => a.fileId === 'file-002' && a.segmentationClass === 'roof',
      );
      // Different fileIds produce different polygon shapes (heuristic variation)
      expect(file1Roof).toBeDefined();
      expect(file2Roof).toBeDefined();
      // The polygons should differ due to hash-based variation
      if (file1Roof && file2Roof) {
        expect(file1Roof.polygon).not.toEqual(file2Roof.polygon);
      }
    });
  });

  describe('artifact validation', () => {
    it('all produced artifacts pass schema validation', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        const validation = validateSemanticSegmentationMask(artifact);
        expect(validation.valid).toBe(true);
      }
    });

    it('all artifacts have correct artifactType discriminator', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });

    it('all artifacts have unique IDs', () => {
      const result = runSegmentationWorker(makeInput());
      const ids = result.artifacts.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('artifact IDs contain fileId, class, and version', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.id).toContain(artifact.fileId);
        expect(artifact.id).toContain(artifact.segmentationClass);
        expect(artifact.id).toContain(SEGMENTATION_WORKER_VERSION);
      }
    });
  });

  describe('authority and limitations', () => {
    it('all artifacts carry review-only authority', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.authority).toEqual(REVIEW_ONLY_AUTHORITY);
      }
    });

    it('all artifacts have limitations array with base limitations', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(Array.isArray(artifact.limitations)).toBe(true);
        expect(artifact.limitations.length).toBeGreaterThan(0);
        expect(artifact.limitations[0]).toContain('REVIEW-ONLY');
      }
    });

    it('all artifacts include segmentation-specific limitations', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        const hasHeuristicDisclaimer = artifact.limitations.some(
          (l) => l.includes('heuristic') || l.includes('Heuristic'),
        );
        expect(hasHeuristicDisclaimer).toBe(true);
      }
    });
  });

  describe('confidence', () => {
    it('all artifacts have confidence between 0 and 100', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('respects minConfidence config', () => {
      const result = runSegmentationWorker(makeInput({
        config: { minConfidence: 70 },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(70);
      }
    });

    it('high minConfidence filters out low-confidence classes', () => {
      const result = runSegmentationWorker(makeInput({
        config: { minConfidence: 90 },
      }));
      // Only sky (base 85) might pass at 90 threshold, but with variation
      // it might not either — so just verify all pass the threshold
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(90);
      }
    });
  });

  describe('polygon structure', () => {
    it('all polygons have at least 3 points', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.polygon.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('all polygon points use normalized_image_0_1000 coordinate system', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        for (const pt of artifact.polygon) {
          expect(pt.coordinateSystem).toBe('normalized_image_0_1000');
          expect(pt.x).toBeGreaterThanOrEqual(0);
          expect(pt.x).toBeLessThanOrEqual(1000);
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(1000);
        }
      }
    });

    it('respects maxPolygonPoints config', () => {
      const result = runSegmentationWorker(makeInput({
        config: { maxPolygonPoints: 4 },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.polygon.length).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('mask bounds', () => {
    it('all artifacts have valid maskBounds', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.maskBounds).toBeDefined();
        expect(artifact.maskBounds.coordinateSystem).toBe('normalized_image_0_1000');
        expect(artifact.maskBounds.x).toBeGreaterThanOrEqual(0);
        expect(artifact.maskBounds.y).toBeGreaterThanOrEqual(0);
        expect(artifact.maskBounds.width).toBeGreaterThan(0);
        expect(artifact.maskBounds.height).toBeGreaterThan(0);
      }
    });

    it('maskBounds contains the polygon', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        const bounds = artifact.maskBounds;
        for (const pt of artifact.polygon) {
          expect(pt.x).toBeGreaterThanOrEqual(bounds.x - 1);
          expect(pt.y).toBeGreaterThanOrEqual(bounds.y - 1);
          expect(pt.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
          expect(pt.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
        }
      }
    });
  });

  describe('raw mask data', () => {
    it('includes rawMask when includeRawMask is true (default)', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.rawMask).toBeDefined();
        expect(typeof artifact.rawMask).toBe('string');
      }
    });

    it('omits rawMask when includeRawMask is false', () => {
      const result = runSegmentationWorker(makeInput({
        config: { includeRawMask: false },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.rawMask).toBeUndefined();
      }
    });

    it('includes maskWidth and maskHeight when rawMask is present', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        if (artifact.rawMask) {
          expect(artifact.maskWidth).toBeDefined();
          expect(artifact.maskHeight).toBeDefined();
        }
      }
    });
  });

  describe('worker version', () => {
    it('all artifacts carry the correct workerVersion', () => {
      const result = runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
      }
    });
  });

  describe('stage timings', () => {
    it('produces stage timings for initialization, mask_generation, and validation', () => {
      const result = runSegmentationWorker(makeInput());
      expect(result.stageTimings).toHaveProperty('initialization');
      expect(result.stageTimings).toHaveProperty('mask_generation');
      expect(result.stageTimings).toHaveProperty('validation');
    });

    it('all stage timings are non-negative numbers', () => {
      const result = runSegmentationWorker(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('segmentation class coverage', () => {
    it('produces masks for each specific class', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'single-file', fileUrl: '', filename: 'test.jpg' }],
      }));

      const producedClasses = new Set(result.artifacts.map((a) => a.segmentationClass));

      // With default minConfidence=30, all classes should be produced
      for (const cls of SEGMENTATION_CLASSES) {
        expect(producedClasses.has(cls)).toBe(true);
      }
    });

    it('produces roof masks with appropriate structure', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'roof-test', fileUrl: '', filename: 'test.jpg' }],
      }));
      const roofMask = result.artifacts.find((a) => a.segmentationClass === 'roof');
      expect(roofMask).toBeDefined();
      expect(roofMask!.polygon.length).toBeGreaterThanOrEqual(4);
      expect(roofMask!.confidence).toBeGreaterThan(0);
    });

    it('produces wall masks with appropriate structure', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'wall-test', fileUrl: '', filename: 'test.jpg' }],
      }));
      const wallMask = result.artifacts.find((a) => a.segmentationClass === 'wall');
      expect(wallMask).toBeDefined();
      expect(wallMask!.polygon.length).toBeGreaterThanOrEqual(4);
    });

    it('produces sky masks', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'sky-test', fileUrl: '', filename: 'test.jpg' }],
      }));
      const skyMask = result.artifacts.find((a) => a.segmentationClass === 'sky');
      expect(skyMask).toBeDefined();
    });

    it('produces tree masks', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'tree-test', fileUrl: '', filename: 'test.jpg' }],
      }));
      const treeMask = result.artifacts.find((a) => a.segmentationClass === 'tree');
      expect(treeMask).toBeDefined();
    });

    it('produces obstruction masks', () => {
      const result = runSegmentationWorker(makeInput({
        sourcePhotos: [{ fileId: 'obs-test', fileUrl: '', filename: 'test.jpg' }],
      }));
      const obsMask = result.artifacts.find((a) => a.segmentationClass === 'obstruction');
      expect(obsMask).toBeDefined();
    });
  });

  describe('runSegmentationFromReconstructionInput', () => {
    it('converts GeometryReconstructionInput and produces artifacts', () => {
      const input = makeReconstructionInput();
      const artifacts = runSegmentationFromReconstructionInput(input);
      expect(artifacts.length).toBeGreaterThan(0);
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });

    it('returns GeometryReconstructionArtifact[] (compatible with union type)', () => {
      const input = makeReconstructionInput();
      const artifacts = runSegmentationFromReconstructionInput(input);
      // Each artifact should be assignable to GeometryReconstructionArtifact
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBeDefined();
        expect(typeof artifact.confidence).toBe('number');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// New artifact type schema validation tests
// ---------------------------------------------------------------------------

describe('new artifact type schema validation', () => {
  describe('SemanticSegmentationMask validation', () => {
    it('accepts a valid SemanticSegmentationMask', () => {
      const mask: SemanticSegmentationMask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
          { x: 500, y: 100, coordinateSystem: 'normalized_image_0_1000' },
          { x: 800, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100,
          y: 100,
          width: 700,
          height: 100,
          coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(true);
    });

    it('rejects missing id', () => {
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid segmentationClass', () => {
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'invalid_class',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });

    it('rejects wrong artifactType', () => {
      const mask = {
        artifactType: 'segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });

    it('rejects empty polygon', () => {
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });

    it('rejects polygon with wrong coordinateSystem', () => {
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'pixel' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid authority', () => {
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { reviewOnly: true, nonAuthoritative: true, cadMutationAllowed: true, permitGenerationAllowed: false, bomMutationAllowed: false },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateSemanticSegmentationMask(mask);
      expect(result.valid).toBe(false);
    });
  });

  describe('StructuralLineCandidate validation', () => {
    it('accepts a valid StructuralLineCandidate', () => {
      const { validateStructuralLineCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const line = {
        artifactType: 'structural_line_candidate',
        id: 'line-001',
        fileId: 'file-001',
        lineType: 'ridge',
        start: { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 800, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        confidence: 65,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateStructuralLineCandidate(line);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid lineType', () => {
      const { validateStructuralLineCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const line = {
        artifactType: 'structural_line_candidate',
        id: 'line-001',
        fileId: 'file-001',
        lineType: 'invalid_type',
        start: { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 800, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        confidence: 65,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateStructuralLineCandidate(line);
      expect(result.valid).toBe(false);
    });

    it('accepts wall_vertical lineType', () => {
      const { validateStructuralLineCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const line = {
        artifactType: 'structural_line_candidate',
        id: 'line-001',
        fileId: 'file-001',
        lineType: 'wall_vertical',
        start: { x: 500, y: 300, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 500, y: 700, coordinateSystem: 'normalized_image_0_1000' },
        confidence: 55,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateStructuralLineCandidate(line);
      expect(result.valid).toBe(true);
    });
  });

  describe('VanishingPointArtifact validation', () => {
    it('accepts a valid VanishingPointArtifact', () => {
      const { validateVanishingPointArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const vp = {
        artifactType: 'vanishing_point',
        id: 'vp-001',
        fileId: 'file-001',
        direction: 'x',
        point: { x: 950, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        supportingLineCount: 12,
        supportingLineIds: ['line-1', 'line-2', 'line-3'],
        inlierRatio: 0.85,
        confidence: 78,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateVanishingPointArtifact(vp);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid direction', () => {
      const { validateVanishingPointArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const vp = {
        artifactType: 'vanishing_point',
        id: 'vp-001',
        fileId: 'file-001',
        direction: 'diagonal',
        point: { x: 950, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        supportingLineCount: 12,
        supportingLineIds: ['line-1'],
        inlierRatio: 0.85,
        confidence: 78,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateVanishingPointArtifact(vp);
      expect(result.valid).toBe(false);
    });

    it('rejects inlierRatio outside 0-1', () => {
      const { validateVanishingPointArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const vp = {
        artifactType: 'vanishing_point',
        id: 'vp-001',
        fileId: 'file-001',
        direction: 'x',
        point: { x: 950, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        supportingLineCount: 12,
        supportingLineIds: ['line-1'],
        inlierRatio: 1.5,
        confidence: 78,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateVanishingPointArtifact(vp);
      expect(result.valid).toBe(false);
    });
  });

  describe('ConsensusPlaneCandidate validation', () => {
    it('accepts a valid ConsensusPlaneCandidate', () => {
      const { validateConsensusPlaneCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const plane = {
        artifactType: 'consensus_plane_candidate',
        id: 'cp-001',
        planeType: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
          { x: 500, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        ],
        normalVector: { x: 0.15, y: 0.1, z: 0.98 },
        estimatedPitch: 25,
        estimatedAzimuth: 180,
        confidence: 80,
        sourceMaskIds: ['mask-1', 'mask-2'],
        sourceFileIds: ['file-1', 'file-2'],
        consensusPhotoCount: 3,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateConsensusPlaneCandidate(plane);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid planeType', () => {
      const { validateConsensusPlaneCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const plane = {
        artifactType: 'consensus_plane_candidate',
        id: 'cp-001',
        planeType: 'ceiling',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        normalVector: { x: 0, y: 0, z: 1 },
        confidence: 80,
        sourceMaskIds: ['mask-1'],
        sourceFileIds: ['file-1'],
        consensusPhotoCount: 1,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateConsensusPlaneCandidate(plane);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid normalVector', () => {
      const { validateConsensusPlaneCandidate } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const plane = {
        artifactType: 'consensus_plane_candidate',
        id: 'cp-001',
        planeType: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        normalVector: 'not-an-object',
        confidence: 80,
        sourceMaskIds: ['mask-1'],
        sourceFileIds: ['file-1'],
        consensusPhotoCount: 1,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateConsensusPlaneCandidate(plane);
      expect(result.valid).toBe(false);
    });
  });

  describe('union validator routes new artifact types', () => {
    it('routes semantic_segmentation_mask to correct validator', () => {
      const { validateGeometryReconstructionArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const mask = {
        artifactType: 'semantic_segmentation_mask',
        id: 'seg-test-001',
        fileId: 'file-001',
        segmentationClass: 'roof',
        polygon: [
          { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        ],
        confidence: 72,
        maskBounds: {
          x: 100, y: 100, width: 700, height: 100, coordinateSystem: 'normalized_image_0_1000',
        },
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateGeometryReconstructionArtifact(mask);
      expect(result.valid).toBe(true);
    });

    it('routes structural_line_candidate to correct validator', () => {
      const { validateGeometryReconstructionArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const line = {
        artifactType: 'structural_line_candidate',
        id: 'line-001',
        fileId: 'file-001',
        lineType: 'eave',
        start: { x: 100, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 800, y: 200, coordinateSystem: 'normalized_image_0_1000' },
        confidence: 65,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateGeometryReconstructionArtifact(line);
      expect(result.valid).toBe(true);
    });

    it('routes vanishing_point to correct validator', () => {
      const { validateGeometryReconstructionArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const vp = {
        artifactType: 'vanishing_point',
        id: 'vp-001',
        fileId: 'file-001',
        direction: 'y',
        point: { x: 50, y: 500, coordinateSystem: 'normalized_image_0_1000' },
        supportingLineCount: 8,
        supportingLineIds: ['line-1'],
        inlierRatio: 0.72,
        confidence: 70,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateGeometryReconstructionArtifact(vp);
      expect(result.valid).toBe(true);
    });

    it('routes consensus_plane_candidate to correct validator', () => {
      const { validateGeometryReconstructionArtifact } = require('@/lib/siteSurveys/geometryReconstruction/schemas');
      const plane = {
        artifactType: 'consensus_plane_candidate',
        id: 'cp-001',
        planeType: 'wall',
        polygon: [
          { x: 100, y: 300, coordinateSystem: 'normalized_image_0_1000' },
          { x: 100, y: 700, coordinateSystem: 'normalized_image_0_1000' },
        ],
        normalVector: { x: 0, y: -1, z: 0 },
        confidence: 75,
        sourceMaskIds: ['mask-1'],
        sourceFileIds: ['file-1'],
        consensusPhotoCount: 2,
        workerVersion: '1.0.0',
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: ['REVIEW-ONLY'],
      };
      const result = validateGeometryReconstructionArtifact(plane);
      expect(result.valid).toBe(true);
    });
  });
});
