/**
 * Tests for SAM 2 Segmentation Client.
 *
 * Tests the HTTP client that calls the SAM 2 Python service,
 * with graceful fallback when the service is unavailable.
 *
 * Uses mocked fetch to simulate SAM 2 service responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  segmentWithSAM2,
  mapSAM2ClassHint,
  checkSAM2Health,
  isSAM2Enabled,
} from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A realistic SAM 2 /segment response for a 512x512 image. */
const MOCK_SAM2_RESPONSE = {
  success: true,
  masks: [
    {
      mask_index: 0,
      polygon: [
        { x: 100, y: 50 },
        { x: 400, y: 50 },
        { x: 400, y: 200 },
        { x: 100, y: 200 },
      ],
      area: 45000,
      bbox: [100, 50, 300, 150],
      confidence: 82,
      stability_score: 0.95,
      class_hint: 'roof',
      point_count: 4,
    },
    {
      mask_index: 1,
      polygon: [
        { x: 0, y: 0 },
        { x: 512, y: 0 },
        { x: 512, y: 180 },
        { x: 0, y: 180 },
      ],
      area: 92160,
      bbox: [0, 0, 512, 180],
      confidence: 88,
      stability_score: 0.97,
      class_hint: 'sky',
      point_count: 4,
    },
    {
      mask_index: 2,
      polygon: [
        { x: 50, y: 300 },
        { x: 460, y: 300 },
        { x: 460, y: 512 },
        { x: 50, y: 512 },
      ],
      area: 85500,
      bbox: [50, 300, 410, 212],
      confidence: 71,
      stability_score: 0.89,
      class_hint: 'wall',
      point_count: 4,
    },
  ],
  mask_count: 3,
  image_width: 512,
  image_height: 512,
  processing_time_ms: 1250,
  model_info: {
    model_id: 'facebook/sam2.1-hiera-tiny',
    device: 'cpu',
    cuda_available: false,
    model_type: 'sam2.1_automatic_mask_generation',
    inference_resolution: '512x384',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sam2Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Reset env for each test
    vi.stubEnv('SAM2_SERVICE_URL', 'http://localhost:8000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── mapSAM2ClassHint ──────────────────────────────────────────────

  describe('mapSAM2ClassHint', () => {
    it('maps known class hints to segmentation classes', () => {
      expect(mapSAM2ClassHint('roof')).toBe('roof');
      expect(mapSAM2ClassHint('wall')).toBe('wall');
      expect(mapSAM2ClassHint('sky')).toBe('sky');
      expect(mapSAM2ClassHint('ground')).toBe('ground');
      expect(mapSAM2ClassHint('obstruction')).toBe('obstruction');
      expect(mapSAM2ClassHint('equipment')).toBe('equipment');
      expect(mapSAM2ClassHint('tree')).toBe('tree');
    });

    it('returns null for unknown class hints', () => {
      expect(mapSAM2ClassHint('unknown')).toBe(null);
      expect(mapSAM2ClassHint('random_thing')).toBe(null);
      expect(mapSAM2ClassHint('')).toBe(null);
    });
  });

  // ── segmentWithSAM2 — success path ────────────────────────────────

  describe('segmentWithSAM2 (success)', () => {
    it('calls SAM 2 service and returns normalized masks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SAM2_RESPONSE,
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      expect(result!.usedSAM2).toBe(true);
      expect(result!.masks).toHaveLength(3);
      expect(result!.imageWidth).toBe(512);
      expect(result!.imageHeight).toBe(512);
      expect(result!.modelInfo).toEqual({
        modelId: 'facebook/sam2.1-hiera-tiny',
        device: 'cpu',
        cudaAvailable: false,
        inferenceResolution: '512x384',
      });
      expect(result!.error).toBeNull();
    });

    it('normalizes polygon coordinates to 0-1000 range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SAM2_RESPONSE,
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      // First mask polygon: x=100/512*1000 ≈ 195, y=50/512*1000 ≈ 98
      const firstMask = result!.masks[0];
      expect(firstMask.polygon[0].coordinateSystem).toBe('normalized_image_0_1000');
      expect(firstMask.polygon[0].x).toBe(Math.round((100 / 512) * 1000));
      expect(firstMask.polygon[0].y).toBe(Math.round((50 / 512) * 1000));
    });

    it('normalizes bounding box to 0-1000 range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SAM2_RESPONSE,
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      const firstMask = result!.masks[0];
      // bbox [100, 50, 300, 150] → normalized
      expect(firstMask.maskBounds.x).toBe(Math.round((100 / 512) * 1000));
      expect(firstMask.maskBounds.y).toBe(Math.round((50 / 512) * 1000));
      expect(firstMask.maskBounds.width).toBe(Math.round((300 / 512) * 1000));
      expect(firstMask.maskBounds.height).toBe(Math.round((150 / 512) * 1000));
    });

    it('preserves confidence, stability score, and class hint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_SAM2_RESPONSE,
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      const roofMask = result!.masks[0];
      expect(roofMask.confidence).toBe(82);
      expect(roofMask.stabilityScore).toBe(0.95);
      expect(roofMask.classHint).toBe('roof');
    });
  });

  // ── segmentWithSAM2 — failure paths ───────────────────────────────

  describe('segmentWithSAM2 (failure)', () => {
    it('returns null when SAM 2 service returns non-OK status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);
      expect(result).toBeNull();
    });

    it('returns null when SAM 2 service returns success=false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: 'Model not loaded',
          masks: [],
          mask_count: 0,
        }),
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);
      expect(result).toBeNull();
    });

    it('returns null when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);
      expect(result).toBeNull();
    });

    it('returns null when fetch times out', async () => {
      // Simulate an AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);
      expect(result).toBeNull();
    });
  });

  // ── segmentWithSAM2 — when not configured ──────────────────────────

  describe('segmentWithSAM2 (not configured)', () => {
    it('returns null immediately when SAM2_SERVICE_URL is not set', async () => {
      vi.stubEnv('SAM2_SERVICE_URL', '');

      // isSAM2Enabled() reads env at call time, so stubEnv works correctly
      // The function itself checks isSAM2Enabled() internally
      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── checkSAM2Health ───────────────────────────────────────────────

  describe('checkSAM2Health', () => {
    it('returns health response when service is healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ready',
          model_loaded: true,
          device: 'cpu',
          model_id: 'facebook/sam2.1-hiera-tiny',
          cuda_available: false,
          uptime_seconds: 3600,
        }),
      });

      const health = await checkSAM2Health();
      expect(health).not.toBeNull();
      expect(health!.status).toBe('ready');
      expect(health!.model_loaded).toBe(true);
      expect(health!.device).toBe('cpu');
    });

    it('returns null when service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const health = await checkSAM2Health();
      expect(health).toBeNull();
    });

    it('returns null when service returns non-OK status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      const health = await checkSAM2Health();
      expect(health).toBeNull();
    });
  });

  // ── Polygon normalization edge cases ───────────────────────────────

  describe('polygon normalization edge cases', () => {
    it('handles images with non-square dimensions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...MOCK_SAM2_RESPONSE,
          image_width: 1920,
          image_height: 1080,
          masks: [
            {
              mask_index: 0,
              polygon: [
                { x: 960, y: 540 },
                { x: 1920, y: 540 },
                { x: 1920, y: 1080 },
                { x: 960, y: 1080 },
              ],
              area: 518400,
              bbox: [960, 540, 960, 540],
              confidence: 75,
              stability_score: 0.91,
              class_hint: 'roof',
              point_count: 4,
            },
          ],
          mask_count: 1,
        }),
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      // x=960/1920*1000 = 500, y=540/1080*1000 = 500
      expect(result!.masks[0].polygon[0].x).toBe(500);
      expect(result!.masks[0].polygon[0].y).toBe(500);
    });

    it('handles masks at image origin (0,0)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...MOCK_SAM2_RESPONSE,
          masks: [
            {
              mask_index: 0,
              polygon: [
                { x: 0, y: 0 },
                { x: 512, y: 0 },
                { x: 512, y: 180 },
                { x: 0, y: 180 },
              ],
              area: 92160,
              bbox: [0, 0, 512, 180],
              confidence: 88,
              stability_score: 0.97,
              class_hint: 'sky',
              point_count: 4,
            },
          ],
          mask_count: 1,
        }),
      });

      const imageBuffer = Buffer.from('fake-image-bytes');
      const result = await segmentWithSAM2(imageBuffer);

      expect(result).not.toBeNull();
      expect(result!.masks[0].polygon[0].x).toBe(0);
      expect(result!.masks[0].polygon[0].y).toBe(0);
      expect(result!.masks[0].maskBounds.x).toBe(0);
      expect(result!.masks[0].maskBounds.y).toBe(0);
    });
  });
});
