/**
 * Depth map decode and visualization utility tests.
 *
 * Tests the depthMapDecode module that decodes DepthMap artifacts,
 * computes statistics, generates heatmap RGBA data, and produces
 * base64 PNG data URLs.
 *
 * @jest-environment node
 */

import {
  decodeDepthMap,
  computeDepthStats,
  depthGridToRGBA,
  rgbaToBase64PNG,
  depthMapToHeatmapDataURL,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type {
  DepthHeatmapOptions,
  DepthStatistics,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type { DepthMap } from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a Float32Array to base64, matching the pipeline's encoding.
 */
function encodeFloat32ToBase64(arr: Float32Array): string {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  return buf.toString('base64');
}

/**
 * Create a DepthMap artifact from a Float32Array grid.
 */
function makeDepthMap(
  width: number,
  height: number,
  grid: Float32Array,
  overrides?: Partial<DepthMap>,
): DepthMap {
  return {
    artifactType: 'depth_map',
    fileId: 'test-file-001',
    width,
    height,
    depthData: encodeFloat32ToBase64(grid),
    depthMetric: 'normalized_relative',
    confidence: 0.75,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

/**
 * Create a simple depth grid with a known pattern.
 * Gradient from 0.0 (top-left) to 1.0 (bottom-right).
 */
function gradientGrid(width: number, height: number): Float32Array {
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = (x + y) / (width + height - 2);
    }
  }
  return grid;
}

/**
 * Create a constant-valued depth grid.
 */
function constantGrid(width: number, height: number, value: number): Float32Array {
  const grid = new Float32Array(width * height);
  grid.fill(value);
  return grid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('depthMapDecode', () => {
  // -----------------------------------------------------------------------
  // decodeDepthMap
  // -----------------------------------------------------------------------
  describe('decodeDepthMap', () => {
    it('roundtrips a Float32Array through base64 encoding/decoding', () => {
      const original = gradientGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, original);
      const decoded = decodeDepthMap(depthMap);

      expect(decoded.length).toBe(64);
      for (let i = 0; i < original.length; i++) {
        expect(decoded[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('handles a constant-valued grid', () => {
      const original = constantGrid(4, 4, 0.5);
      const depthMap = makeDepthMap(4, 4, original);
      const decoded = decodeDepthMap(depthMap);

      expect(decoded.length).toBe(16);
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i]).toBeCloseTo(0.5, 5);
      }
    });

    it('handles extreme values (0.0 and 1.0)', () => {
      const original = new Float32Array([0.0, 1.0, 0.0, 1.0]);
      const depthMap = makeDepthMap(2, 2, original);
      const decoded = decodeDepthMap(depthMap);

      expect(decoded[0]).toBeCloseTo(0.0, 5);
      expect(decoded[1]).toBeCloseTo(1.0, 5);
      expect(decoded[2]).toBeCloseTo(0.0, 5);
      expect(decoded[3]).toBeCloseTo(1.0, 5);
    });

    it('preserves negative depth values (MiDaS pre-inversion)', () => {
      const original = new Float32Array([-0.5, 0.25, -1.0, 2.0]);
      const depthMap = makeDepthMap(2, 2, original);
      const decoded = decodeDepthMap(depthMap);

      expect(decoded[0]).toBeCloseTo(-0.5, 5);
      expect(decoded[2]).toBeCloseTo(-1.0, 5);
    });
  });

  // -----------------------------------------------------------------------
  // computeDepthStats
  // -----------------------------------------------------------------------
  describe('computeDepthStats', () => {
    it('computes correct min/max/mean for a uniform grid', () => {
      const grid = constantGrid(4, 4, 0.5);
      const stats = computeDepthStats(grid);

      expect(stats.min).toBeCloseTo(0.5, 5);
      expect(stats.max).toBeCloseTo(0.5, 5);
      expect(stats.mean).toBeCloseTo(0.5, 5);
      expect(stats.median).toBeCloseTo(0.5, 5);
      expect(stats.totalPixels).toBe(16);
    });

    it('computes correct min/max for a gradient grid', () => {
      const grid = gradientGrid(8, 8);
      const stats = computeDepthStats(grid);

      expect(stats.min).toBeCloseTo(0.0, 5);
      expect(stats.max).toBeCloseTo(1.0, 5);
      expect(stats.mean).toBeGreaterThan(0);
      expect(stats.mean).toBeLessThan(1);
    });

    it('computes percentiles correctly', () => {
      // Grid with values 0..99 in order
      const grid = new Float32Array(100);
      for (let i = 0; i < 100; i++) grid[i] = i / 99;

      const stats = computeDepthStats(grid);

      expect(stats.p25).toBeCloseTo(0.25, 1);
      expect(stats.p75).toBeCloseTo(0.75, 1);
    });

    it('counts near-zero and near-one fractions', () => {
      // 50% near-zero, 25% near-one, 25% mid-range
      const grid = new Float32Array(100);
      for (let i = 0; i < 50; i++) grid[i] = 0.01;       // near-zero
      for (let i = 50; i < 75; i++) grid[i] = 0.5;        // mid
      for (let i = 75; i < 100; i++) grid[i] = 0.99;      // near-one

      const stats = computeDepthStats(grid);

      expect(stats.nearZeroFraction).toBeCloseTo(0.5, 2);
      expect(stats.nearOneFraction).toBeCloseTo(0.25, 2);
    });

    it('reports totalPixels correctly', () => {
      const grid = new Float32Array(64);
      const stats = computeDepthStats(grid);
      expect(stats.totalPixels).toBe(64);
    });
  });

  // -----------------------------------------------------------------------
  // depthGridToRGBA
  // -----------------------------------------------------------------------
  describe('depthGridToRGBA', () => {
    it('produces an RGBA array of the correct size', () => {
      const grid = gradientGrid(8, 8);
      const rgba = depthGridToRGBA(grid, 8, 8);

      // 8*8 pixels * 4 channels = 256
      expect(rgba.length).toBe(8 * 8 * 4);
    });

    it('produces an RGBA array with scale factor', () => {
      const grid = gradientGrid(4, 4);
      const rgba = depthGridToRGBA(grid, 4, 4, { scale: 2 });

      // 4*2 = 8 pixels wide, 4*2 = 8 pixels tall, *4 channels
      expect(rgba.length).toBe(8 * 8 * 4);
    });

    it('sets alpha channel to the specified value', () => {
      const grid = constantGrid(4, 4, 0.5);
      const rgba = depthGridToRGBA(grid, 4, 4, { alpha: 200 });

      for (let i = 0; i < rgba.length; i += 4) {
        expect(rgba[i + 3]).toBe(200); // alpha channel
      }
    });

    it('uses default alpha=180 when not specified', () => {
      const grid = constantGrid(4, 4, 0.5);
      const rgba = depthGridToRGBA(grid, 4, 4);

      for (let i = 0; i < rgba.length; i += 4) {
        expect(rgba[i + 3]).toBe(180);
      }
    });

    it('produces dark colors for near (low depth) values with inferno', () => {
      const grid = constantGrid(2, 2, 0.0);
      const rgba = depthGridToRGBA(grid, 2, 2, { colormap: 'inferno', normalize: false });

      // Inferno at 0.0: [0, 0, 4] — very dark
      expect(rgba[0]).toBe(0);   // R
      expect(rgba[1]).toBe(0);   // G
      expect(rgba[2]).toBe(4);   // B
    });

    it('produces bright colors for far (high depth) values with inferno', () => {
      const grid = constantGrid(2, 2, 1.0);
      const rgba = depthGridToRGBA(grid, 2, 2, { colormap: 'inferno', normalize: false });

      // Inferno at 1.0: [252, 255, 164] — bright
      expect(rgba[0]).toBe(252);  // R
      expect(rgba[1]).toBe(255);  // G
      expect(rgba[2]).toBe(164);  // B
    });

    it('produces different colors for viridis vs inferno', () => {
      const grid = constantGrid(4, 4, 0.5);
      const infernoRGBA = depthGridToRGBA(grid, 4, 4, { colormap: 'inferno' });
      const viridisRGBA = depthGridToRGBA(grid, 4, 4, { colormap: 'viridis' });

      // At least one RGB channel should differ between colormaps
      let differs = false;
      for (let i = 0; i < 16; i++) {
        const idx = i * 4;
        if (infernoRGBA[idx] !== viridisRGBA[idx] ||
            infernoRGBA[idx + 1] !== viridisRGBA[idx + 1] ||
            infernoRGBA[idx + 2] !== viridisRGBA[idx + 2]) {
          differs = true;
          break;
        }
      }
      expect(differs).toBe(true);
    });

    it('normalizes depth values by default', () => {
      // Grid with all 0.5 — after normalization, becomes 0.5 mapped to colormap
      const grid = constantGrid(4, 4, 0.5);
      const rgba = depthGridToRGBA(grid, 4, 4, { normalize: true });

      // With all values the same, normalization maps to 0.0 (or could be 0.5 if range=0)
      // Actually when all values are equal, range=0 (our guard), so (0.5-0.5)/1 = 0
      // So all pixels map to colormap position 0.0
      expect(rgba[0]).toBe(0);   // R at inferno[0] = 0
      expect(rgba[1]).toBe(0);   // G
      expect(rgba[2]).toBe(4);   // B
    });

    it('clamps values outside [0,1] when normalize=false', () => {
      const grid = new Float32Array([2.0, -0.5, 0.5, 0.5]);
      const rgba = depthGridToRGBA(grid, 2, 2, { normalize: false });

      // 2.0 clamped to 1.0 → inferno[1.0] = [252, 255, 164]
      expect(rgba[0]).toBe(252);
      expect(rgba[1]).toBe(255);
      expect(rgba[2]).toBe(164);

      // -0.5 clamped to 0.0 → inferno[0.0] = [0, 0, 4]
      expect(rgba[4]).toBe(0);
      expect(rgba[5]).toBe(0);
      expect(rgba[6]).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // rgbaToBase64PNG
  // -----------------------------------------------------------------------
  describe('rgbaToBase64PNG', () => {
    it('produces a string starting with the PNG data URL prefix', () => {
      const rgba = new Uint8ClampedArray(4 * 4 * 4); // 4x4 image
      const result = rgbaToBase64PNG(rgba, 4, 4);

      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('produces a valid PNG signature in the decoded bytes', () => {
      const rgba = new Uint8ClampedArray(4 * 4 * 4);
      rgba.fill(128); // gray
      const result = rgbaToBase64PNG(rgba, 4, 4);

      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');

      // PNG signature: 137 80 78 71 13 10 26 10
      expect(pngBytes[0]).toBe(137);
      expect(pngBytes[1]).toBe(80);  // 'P'
      expect(pngBytes[2]).toBe(78);  // 'N'
      expect(pngBytes[3]).toBe(71);  // 'G'
      expect(pngBytes[4]).toBe(13);
      expect(pngBytes[5]).toBe(10);
      expect(pngBytes[6]).toBe(26);
      expect(pngBytes[7]).toBe(10);
    });

    it('produces a PNG of reasonable size for a small image', () => {
      const rgba = new Uint8ClampedArray(8 * 8 * 4);
      rgba.fill(100);
      const result = rgbaToBase64PNG(rgba, 8, 8);

      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');

      // Should be at least signature(8) + IHDR(25) + some IDAT + IEND(12)
      expect(pngBytes.length).toBeGreaterThan(50);
    });

    it('encodes IHDR with correct width and height', () => {
      const rgba = new Uint8ClampedArray(16 * 8 * 4);
      const result = rgbaToBase64PNG(rgba, 16, 8);

      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');

      // IHDR starts at byte 8 (after signature), length=4 bytes, type=4 bytes, data=13 bytes
      // Width is at offset 16 (8 sig + 4 len + 4 type), big-endian uint32
      const ihdrWidth = pngBytes.readUInt32BE(16);
      const ihdrHeight = pngBytes.readUInt32BE(20);

      expect(ihdrWidth).toBe(16);
      expect(ihdrHeight).toBe(8);
    });
  });

  // -----------------------------------------------------------------------
  // depthMapToHeatmapDataURL (end-to-end convenience)
  // -----------------------------------------------------------------------
  describe('depthMapToHeatmapDataURL', () => {
    it('produces a valid PNG data URL from a DepthMap artifact', () => {
      const grid = gradientGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const result = depthMapToHeatmapDataURL(depthMap);

      expect(result).toMatch(/^data:image\/png;base64,/);

      // Verify PNG signature
      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');
      expect(pngBytes[0]).toBe(137); // PNG signature byte 1
      expect(pngBytes[1]).toBe(80);  // 'P'
    });

    it('respects the default 4x scale factor', () => {
      const grid = gradientGrid(4, 4);
      const depthMap = makeDepthMap(4, 4, grid);
      const result = depthMapToHeatmapDataURL(depthMap);

      // Default scale=4, so output is 4*4=16 wide, 4*4=16 tall
      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');

      // Check IHDR dimensions
      const ihdrWidth = pngBytes.readUInt32BE(16);
      const ihdrHeight = pngBytes.readUInt32BE(20);

      expect(ihdrWidth).toBe(16);
      expect(ihdrHeight).toBe(16);
    });

    it('allows overriding the scale factor', () => {
      const grid = gradientGrid(4, 4);
      const depthMap = makeDepthMap(4, 4, grid);
      const result = depthMapToHeatmapDataURL(depthMap, { scale: 1 });

      const base64Part = result.replace('data:image/png;base64,', '');
      const pngBytes = Buffer.from(base64Part, 'base64');

      const ihdrWidth = pngBytes.readUInt32BE(16);
      const ihdrHeight = pngBytes.readUInt32BE(20);

      expect(ihdrWidth).toBe(4);
      expect(ihdrHeight).toBe(4);
    });

    it('allows specifying viridis colormap', () => {
      const grid = gradientGrid(4, 4);
      const depthMap = makeDepthMap(4, 4, grid);

      const infernoResult = depthMapToHeatmapDataURL(depthMap, { colormap: 'inferno' });
      const viridisResult = depthMapToHeatmapDataURL(depthMap, { colormap: 'viridis' });

      // Different colormaps should produce different base64 outputs
      expect(infernoResult).not.toBe(viridisResult);
    });
  });

  // -----------------------------------------------------------------------
  // Integration: runDepthWorker → decodeDepthMap → stats + heatmap
  // -----------------------------------------------------------------------
  describe('integration: worker output → decode → visualize', () => {
    it('can decode a DepthMap produced by the depth worker', async () => {
      // This test uses the actual depth worker to produce a DepthMap,
      // then decodes and visualizes it.
      const { runDepthWorker } = await import(
        '@/lib/siteSurveys/geometryReconstruction/workers/depth'
      );
      const typeModule = await import(
        '@/lib/siteSurveys/geometryReconstruction/types'
      );

      // Use the same mask format as depthWorker.test.ts
      const result = await runDepthWorker({
        masks: [{
          artifactType: 'semantic_segmentation_mask',
          id: 'seg-file-001-roof-1.0.0',
          fileId: 'file-001',
          segmentationClass: 'roof',
          polygon: [
            { x: 200, y: 100, coordinateSystem: 'normalized_image_0_1000' },
            { x: 800, y: 100, coordinateSystem: 'normalized_image_0_1000' },
            { x: 800, y: 400, coordinateSystem: 'normalized_image_0_1000' },
            { x: 200, y: 400, coordinateSystem: 'normalized_image_0_1000' },
          ],
          confidence: 72,
          maskBounds: { x: 200, y: 100, width: 600, height: 300, coordinateSystem: 'normalized_image_0_1000' },
          workerVersion: '1.0.0-test',
          authority: typeModule.REVIEW_ONLY_AUTHORITY,
          limitations: [...typeModule.BASE_LIMITATIONS],
        }],
        vanishingPoints: [],
        config: { gridResolution: 8 },
      });

      expect(result.artifacts.length).toBeGreaterThan(0);
      const depthMap = result.artifacts[0];
      expect(depthMap.artifactType).toBe('depth_map');

      // Decode the depth map
      const grid = decodeDepthMap(depthMap);
      expect(grid.length).toBe(depthMap.width * depthMap.height);

      // Compute stats
      const stats = computeDepthStats(grid);
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeLessThanOrEqual(1);
      expect(stats.totalPixels).toBe(depthMap.width * depthMap.height);

      // Generate heatmap data URL
      const dataURL = depthMapToHeatmapDataURL(depthMap, { scale: 2 });
      expect(dataURL).toMatch(/^data:image\/png;base64,/);
    });
  });
});
