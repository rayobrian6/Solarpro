/**
 * Depth estimation worker tests.
 *
 * Tests the runDepthWorker function that produces DepthMap artifacts
 * from segmentation masks and vanishing points, with MiDaS primary path
 * and heuristic fallback.
 *
 * MiDaS is disabled in these tests (no MIDAS_SERVICE_URL env var),
 * so the heuristic fallback path is exercised.
 *
 * @jest-environment node
 */

import {
  runDepthWorker,
  runDepthFromReconstructionInput,
  DEPTH_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type { DepthWorkerInput } from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type {
  SemanticSegmentationMask,
  VanishingPointArtifact,
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
    polygon: [pt(200, 100), pt(800, 100), pt(800, 400), pt(200, 400)],
    confidence: 72,
    maskBounds: { x: 200, y: 100, width: 600, height: 300, coordinateSystem: 'normalized_image_0_1000' },
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeVP(overrides?: Partial<VanishingPointArtifact>): VanishingPointArtifact {
  return {
    artifactType: 'vanishing_point',
    id: 'vp-x-s1',
    fileId: 'file-001',
    direction: 'x',
    point: pt(1500, 300),
    supportingLineCount: 4,
    supportingLineIds: ['line-ridge-001'],
    inlierRatio: 0.85,
    confidence: 75,
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<DepthWorkerInput>): DepthWorkerInput {
  return {
    surveyId: 'survey-001',
    fileId: 'file-001',
    masks: [makeMask()],
    vanishingPoints: [makeVP()],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'depth_estimation',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('depth estimation worker', () => {
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, workerVersion, and usedMidas', async () => {
      const result = await runDepthWorker(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
      expect(result).toHaveProperty('usedMidas');
    });

    it('returns the correct worker version', async () => {
      const result = await runDepthWorker(makeInput());
      expect(result.workerVersion).toBe(DEPTH_WORKER_VERSION);
    });

    it('produces DepthMap artifacts', async () => {
      const result = await runDepthWorker(makeInput());
      expect(result.artifacts.length).toBeGreaterThan(0);
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('depth_map');
      }
    });

    it('reports usedMidas=false when MiDaS is not available', async () => {
      // No MIDAS_SERVICE_URL set in test env → heuristic fallback
      const result = await runDepthWorker(makeInput());
      expect(result.usedMidas).toBe(false);
    });
  });

  describe('depth map properties', () => {
    it('has the configured grid resolution', async () => {
      const result = await runDepthWorker({ ...makeInput(), config: { gridResolution: 32 } });
      const dm = result.artifacts[0];
      expect(dm.width).toBe(32);
      expect(dm.height).toBe(32);
    });

    it('depth data is a valid base64-encoded string', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(typeof dm.depthData).toBe('string');
      expect(dm.depthData.length).toBeGreaterThan(0);
      // Should be valid base64
      const decoded = Buffer.from(dm.depthData, 'base64');
      expect(decoded.length).toBe(dm.width * dm.height * 4); // Float32 = 4 bytes
    });

    it('depth metric is normalized_relative', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.depthMetric).toBe('normalized_relative');
    });

    it('fileId matches the input', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.fileId).toBe('file-001');
    });
  });

  describe('depth values', () => {
    it('produces depth values in the 0-1 range', async () => {
      const result = await runDepthWorker({ ...makeInput(), config: { gridResolution: 8 } });
      const dm = result.artifacts[0];
      const decoded = Buffer.from(dm.depthData, 'base64');
      const float32 = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);

      for (let i = 0; i < float32.length; i++) {
        expect(float32[i]).toBeGreaterThanOrEqual(0);
        expect(float32[i]).toBeLessThanOrEqual(1);
      }
    });

    it('sky regions have higher depth values (farther)', async () => {
      const skyMask = makeMask({
        segmentationClass: 'sky',
        id: 'seg-file-001-sky-1.0.0',
        polygon: [pt(0, 0), pt(1000, 0), pt(1000, 200), pt(0, 200)],
      });
      const groundMask = makeMask({
        segmentationClass: 'ground',
        id: 'seg-file-001-ground-1.0.0',
        polygon: [pt(0, 800), pt(1000, 800), pt(1000, 1000), pt(0, 1000)],
      });

      const result = await runDepthWorker({
        ...makeInput(),
        masks: [skyMask, groundMask],
        config: { gridResolution: 16 },
      });
      const dm = result.artifacts[0];
      const decoded = Buffer.from(dm.depthData, 'base64');
      const float32 = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);

      // Top row (sky) should have higher depth than bottom row (ground)
      const topRow = Array.from(float32.slice(0, 16));
      const bottomRow = Array.from(float32.slice(16 * 15, 16 * 16));
      const avgTop = topRow.reduce((s, v) => s + v, 0) / topRow.length;
      const avgBottom = bottomRow.reduce((s, v) => s + v, 0) / bottomRow.length;
      expect(avgTop).toBeGreaterThan(avgBottom);
    });
  });

  describe('authority and limitations', () => {
    it('carries review-only authority', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.authority).toEqual(REVIEW_ONLY_AUTHORITY);
    });

    it('carries limitations', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.limitations.length).toBeGreaterThan(0);
      expect(dm.limitations).toContain('REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY');
    });

    it('heuristic fallback limitations include depth-specific disclaimers', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      // Heuristic path limitations (MiDaS disabled in tests)
      expect(dm.limitations).toContain(
        'Depth estimation is heuristic — not from a trained depth model (MiDaS/DPT).',
      );
      expect(dm.limitations).toContain(
        'Depth is a SUPPORT signal only — it must NOT override segmentation-driven geometry.',
      );
    });
  });

  describe('confidence scoring', () => {
    it('confidence is between 0 and 100', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.confidence).toBeGreaterThanOrEqual(0);
      expect(dm.confidence).toBeLessThanOrEqual(100);
    });

    it('higher confidence with masks and VPs', async () => {
      const withBoth = await runDepthWorker(makeInput());
      const withNone = await runDepthWorker({ ...makeInput(), masks: [], vanishingPoints: [] });

      const confWithBoth = withBoth.artifacts[0]?.confidence ?? 0;
      const confWithNone = withNone.artifacts[0]?.confidence ?? 0;
      expect(confWithBoth).toBeGreaterThanOrEqual(confWithNone);
    });

    it('respects minConfidence config', async () => {
      const result = await runDepthWorker({
        ...makeInput(),
        config: { minConfidence: 90 },
      });
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(90);
      }
    });
  });

  describe('stage timings', () => {
    it('records timing for each processing stage', async () => {
      const result = await runDepthWorker(makeInput());
      expect(result.stageTimings['initialization']).toBeDefined();
      expect(result.stageTimings['grid_generation']).toBeDefined();
      expect(result.stageTimings['artifact_creation']).toBeDefined();
    });

    it('all timings are non-negative numbers', async () => {
      const result = await runDepthWorker(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', async () => {
      const input = makeInput();
      const result1 = await runDepthWorker(input);
      const result2 = await runDepthWorker(input);
      expect(result1.artifacts).toEqual(result2.artifacts);
    });
  });

  describe('grid resolution config', () => {
    it('uses default 64×64 resolution', async () => {
      const result = await runDepthWorker(makeInput());
      const dm = result.artifacts[0];
      expect(dm.width).toBe(64);
      expect(dm.height).toBe(64);
    });

    it('respects custom grid resolution', async () => {
      const result = await runDepthWorker({ ...makeInput(), config: { gridResolution: 32 } });
      const dm = result.artifacts[0];
      expect(dm.width).toBe(32);
      expect(dm.height).toBe(32);
    });

    it('produces correct data size for the grid', async () => {
      const result = await runDepthWorker({ ...makeInput(), config: { gridResolution: 16 } });
      const dm = result.artifacts[0];
      const decoded = Buffer.from(dm.depthData, 'base64');
      const float32 = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);
      expect(float32.length).toBe(16 * 16);
    });
  });

  describe('runDepthFromReconstructionInput', () => {
    it('converts input and delegates to the worker', async () => {
      const input = makeReconstructionInput();
      const masks = [makeMask()];
      const vps = [makeVP()];
      const artifacts = await runDepthFromReconstructionInput(input, masks, vps);
      expect(artifacts.length).toBeGreaterThan(0);
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBe('depth_map');
      }
    });

    it('produces one depth map per source photo', async () => {
      const input: GeometryReconstructionInput = {
        surveyId: 'survey-001',
        sourcePhotos: [
          { fileId: 'file-001', fileUrl: 'https://example.com/p1.jpg', filename: 'p1.jpg' },
          { fileId: 'file-002', fileUrl: 'https://example.com/p2.jpg', filename: 'p2.jpg' },
        ],
        pipeline: 'depth_estimation',
      };
      const masks = [makeMask(), makeMask({ id: 'seg-file-002-roof-1.0.0', fileId: 'file-002' })];
      const vps = [makeVP()];
      const artifacts = await runDepthFromReconstructionInput(input, masks, vps);
      expect(artifacts.length).toBe(2);
    });

    it('returns empty array for no source photos', async () => {
      const input: GeometryReconstructionInput = {
        surveyId: 'survey-001',
        sourcePhotos: [],
        pipeline: 'depth_estimation',
      };
      const artifacts = await runDepthFromReconstructionInput(input, [], []);
      expect(artifacts).toEqual([]);
    });
  });

  describe('no masks / no VPs', () => {
    it('produces depth map even with no masks (uses gradient fallback)', async () => {
      const result = await runDepthWorker({ ...makeInput(), masks: [] });
      expect(result.artifacts.length).toBeGreaterThan(0);
    });

    it('produces depth map with no vanishing points', async () => {
      const result = await runDepthWorker({ ...makeInput(), vanishingPoints: [] });
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });
});
