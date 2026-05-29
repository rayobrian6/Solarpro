/**
 * Segmentation worker tests.
 *
 * Tests the runSegmentationWorker function that produces
 * SemanticSegmentationMask artifacts from survey photos
 * using real 512×512 Canny contour extraction.
 *
 * @vitest-environment node
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
import { vi, describe, expect, it, afterEach } from 'vitest';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a test image with a large rectangular shape (simulating a roof). */
async function createTestImageBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 384,
      channels: 3,
      background: { r: 220, g: 220, b: 230 }, // light gray/sky
    },
  })
    .composite([
      {
        // Large dark rectangle in upper half — simulates a roof plane
        input: Buffer.from(
          `<svg width="512" height="384" xmlns="http://www.w3.org/2000/svg">
            <rect x="50" y="30" width="400" height="180" fill="none" stroke="black" stroke-width="4"/>
            <line x1="50" y1="30" x2="450" y2="30" stroke="black" stroke-width="3"/>
            <line x1="250" y1="30" x2="250" y2="210" stroke="black" stroke-width="2"/>
          </svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

function makeInput(overrides?: Partial<SegmentationWorkerInput>): SegmentationWorkerInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://cdn.example.test/photo1.jpg', filename: 'photo1.jpg' },
    ],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://cdn.example.test/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'segmentation',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('segmentation worker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
      expect(result.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
    });

    it('produces SemanticSegmentationMask artifacts from real contour extraction', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      // The test image has strong edges — should produce at least some masks
      expect(result.artifacts.length).toBeGreaterThan(0);

      // Every artifact must be a SemanticSegmentationMask
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });

    it('produces masks for the source photo', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      const fileIds = new Set(result.artifacts.map((a) => a.fileId));
      expect(fileIds.has('file-001')).toBe(true);
    });
  });

  describe('empty input handling', () => {
    it('returns empty artifacts array when no source photos', async () => {
      const result = await runSegmentationWorker(makeInput({ sourcePhotos: [] }));
      expect(result.artifacts).toEqual([]);
    });

    it('still returns stageTimings and workerVersion for empty input', async () => {
      const result = await runSegmentationWorker(makeInput({ sourcePhotos: [] }));
      expect(result.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
      expect(result.stageTimings).toHaveProperty('initialization');
    });
  });

  describe('artifact validation', () => {
    it('all produced artifacts pass schema validation', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        const validation = validateSemanticSegmentationMask(artifact);
        expect(validation.valid).toBe(true);
      }
    });

    it('all artifacts have correct artifactType discriminator', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });

    it('all artifacts have unique IDs', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      const ids = result.artifacts.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('authority and limitations', () => {
    it('all artifacts carry review-only authority', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.authority).toEqual(REVIEW_ONLY_AUTHORITY);
      }
    });

    it('all artifacts have limitations array with base limitations', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(Array.isArray(artifact.limitations)).toBe(true);
        expect(artifact.limitations.length).toBeGreaterThan(0);
        expect(artifact.limitations[0]).toContain('REVIEW-ONLY');
      }
    });

    it('all artifacts include segmentation-specific limitations', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        const hasCannyDisclaimer = artifact.limitations.some(
          (l) => l.includes('Canny') || l.includes('contour') || l.includes('heuristic'),
        );
        expect(hasCannyDisclaimer).toBe(true);
      }
    });
  });

  describe('confidence', () => {
    it('all artifacts have confidence between 0 and 100', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('respects minConfidence config', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput({
        config: { minConfidence: 50 },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(50);
      }
    });
  });

  describe('polygon structure', () => {
    it('all polygons have at least 3 points', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.polygon.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('all polygon points use normalized_image_0_1000 coordinate system', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
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

    it('respects maxPolygonPoints config', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput({
        config: { maxPolygonPoints: 4 },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.polygon.length).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('mask bounds', () => {
    it('all artifacts have valid maskBounds', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.maskBounds).toBeDefined();
        expect(artifact.maskBounds.coordinateSystem).toBe('normalized_image_0_1000');
        expect(artifact.maskBounds.x).toBeGreaterThanOrEqual(0);
        expect(artifact.maskBounds.y).toBeGreaterThanOrEqual(0);
        expect(artifact.maskBounds.width).toBeGreaterThan(0);
        expect(artifact.maskBounds.height).toBeGreaterThan(0);
      }
    });
  });

  describe('raw mask data', () => {
    it('includes rawMask when includeRawMask is true (default)', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.rawMask).toBeDefined();
        expect(typeof artifact.rawMask).toBe('string');
      }
    });

    it('omits rawMask when includeRawMask is false', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput({
        config: { includeRawMask: false },
      }));
      for (const artifact of result.artifacts) {
        expect(artifact.rawMask).toBeUndefined();
      }
    });
  });

  describe('worker version', () => {
    it('all artifacts carry the correct workerVersion', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.workerVersion).toBe(SEGMENTATION_WORKER_VERSION);
      }
    });
  });

  describe('stage timings', () => {
    it('produces stage timings for initialization, mask_generation, and validation', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      expect(result.stageTimings).toHaveProperty('initialization');
      expect(result.stageTimings).toHaveProperty('mask_generation');
      expect(result.stageTimings).toHaveProperty('validation');
    });

    it('all stage timings are non-negative numbers', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const result = await runSegmentationWorker(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('error handling', () => {
    it('gracefully handles fetch failures without crashing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('Network error');
        }),
      );

      const result = await runSegmentationWorker(makeInput());
      // Should return empty artifacts, not throw
      expect(result.artifacts).toEqual([]);
    });

    it('gracefully handles HTTP errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Not found', { status: 404 })),
      );

      const result = await runSegmentationWorker(makeInput());
      expect(result.artifacts).toEqual([]);
    });
  });

  describe('runSegmentationFromReconstructionInput', () => {
    it('converts GeometryReconstructionInput and produces artifacts', async () => {
      const bytes = await createTestImageBytes();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
          }),
        ),
      );

      const input = makeReconstructionInput();
      const artifacts = await runSegmentationFromReconstructionInput(input);
      expect(artifacts.length).toBeGreaterThan(0);
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBe('semantic_segmentation_mask');
      }
    });
  });
});
