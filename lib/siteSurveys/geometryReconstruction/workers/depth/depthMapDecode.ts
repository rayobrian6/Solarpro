/**
 * Depth map decode utility — decodes DepthMap artifacts into usable data.
 *
 * Provides functions to:
 * 1. Decode base64 depth data → Float32Array
 * 2. Normalize depth values for visualization
 * 3. Generate a canvas-compatible RGBA heatmap image
 * 4. Compute depth statistics (min, max, mean, percentiles)
 *
 * Depth convention: higher values = farther from camera.
 * This matches both the heuristic and the inverted MiDaS output.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { DepthMap } from '../../types';

// ---------------------------------------------------------------------------
// Color maps for heatmap visualization
// ---------------------------------------------------------------------------

/**
 * Inferno-style colormap: dark (near) → hot (mid) → bright (far).
 * Maps depth values [0,1] to RGB colors where:
 *   - Near (0.0) → black/dark purple
 *   - Mid (0.5) → red/orange
 *   - Far (1.0) → yellow/white
 *
 * This makes sky regions (far, high values) appear bright/warm and
 * ground regions (near, low values) appear dark — which matches
 * natural intuition (sky is bright, ground is dark in depth).
 */
const INFERNO_COLORMAP: [number, number, number][] = [
  [0, 0, 4],       // 0.0 — near (dark)
  [22, 11, 57],    // 0.1
  [66, 10, 104],   // 0.2
  [106, 23, 110],  // 0.3
  [147, 38, 103],  // 0.4
  [188, 55, 84],   // 0.5
  [221, 81, 58],   // 0.6
  [243, 118, 27],  // 0.7
  [252, 165, 10],  // 0.8
  [246, 215, 70],  // 0.9
  [252, 255, 164], // 1.0 — far (bright)
];

/**
 * Viridis-style colormap: perceptually uniform, colorblind-safe.
 * Maps depth values [0,1] to RGB colors where:
 *   - Near (0.0) → deep purple
 *   - Mid (0.5) → teal/green
 *   - Far (1.0) → bright yellow
 */
const VIRIDIS_COLORMAP: [number, number, number][] = [
  [68, 1, 84],     // 0.0 — near
  [72, 36, 117],   // 0.1
  [65, 68, 135],   // 0.2
  [53, 95, 141],   // 0.3
  [42, 120, 142],  // 0.4
  [33, 145, 140],  // 0.5
  [34, 168, 132],  // 0.6
  [68, 191, 112],  // 0.7
  [122, 209, 81],  // 0.8
  [189, 223, 38],  // 0.9
  [253, 231, 37],  // 1.0 — far
];

export type ColormapName = 'inferno' | 'viridis';

const COLORMAPS: Record<ColormapName, [number, number, number][]> = {
  inferno: INFERNO_COLORMAP,
  viridis: VIRIDIS_COLORMAP,
};

// ---------------------------------------------------------------------------
// Core decode function
// ---------------------------------------------------------------------------

/**
 * Decode a DepthMap artifact's base64 depthData into a Float32Array.
 *
 * The depth data is stored as:
 *   Float32Array → Buffer → base64 string
 *
 * This reverses: base64 → Buffer → Float32Array
 */
export function decodeDepthMap(depthMap: DepthMap): Float32Array {
  const buffer = Buffer.from(depthMap.depthData, 'base64');
  const expectedLength = depthMap.width * depthMap.height;

  // Create a copy to avoid alignment issues with shared buffers
  const float32 = new Float32Array(expectedLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  for (let i = 0; i < expectedLength; i++) {
    float32[i] = view.getFloat32(i * 4, true); // little-endian
  }

  return float32;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface DepthStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  /** 25th percentile */
  p25: number;
  /** 75th percentile */
  p75: number;
  /** Fraction of values that are near-zero (< 0.05) — likely sky in MiDaS */
  nearZeroFraction: number;
  /** Fraction of values that are near-one (> 0.95) — likely sky in our convention */
  nearOneFraction: number;
  totalPixels: number;
}

/**
 * Compute statistics on a decoded depth grid.
 */
export function computeDepthStats(grid: Float32Array): DepthStatistics {
  const sorted = Array.from(grid).sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;

  let nearZeroCount = 0;
  let nearOneCount = 0;
  for (const v of sorted) {
    if (v < 0.05) nearZeroCount++;
    if (v > 0.95) nearOneCount++;
  }

  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: sorted[Math.floor(n / 2)],
    p25: sorted[Math.floor(n * 0.25)],
    p75: sorted[Math.floor(n * 0.75)],
    nearZeroFraction: nearZeroCount / n,
    nearOneFraction: nearOneCount / n,
    totalPixels: n,
  };
}

// ---------------------------------------------------------------------------
// Heatmap generation
// ---------------------------------------------------------------------------

export interface DepthHeatmapOptions {
  /** Colormap to use. Default: 'inferno' */
  colormap?: ColormapName;
  /** Alpha transparency for the overlay (0-255). Default: 180 */
  alpha?: number;
  /** Whether to normalize the depth values to [0,1] before coloring. Default: true */
  normalize?: boolean;
  /** Scale factor for the output image. Default: 1 (same as depth grid) */
  scale?: number;
}

/**
 * Generate an RGBA ImageData buffer from a decoded depth grid.
 *
 * This produces a heatmap image where:
 *   - Near regions (low depth values) → dark colors
 *   - Far regions (high depth values) → bright colors
 *
 * The output is a Uint8ClampedArray suitable for Canvas putImageData()
 * or for converting to a base64 PNG.
 */
export function depthGridToRGBA(
  grid: Float32Array,
  width: number,
  height: number,
  options: DepthHeatmapOptions = {},
): Uint8ClampedArray {
  const {
    colormap = 'inferno',
    alpha = 180,
    normalize = true,
    scale = 1,
  } = options;

  const outWidth = width * scale;
  const outHeight = height * scale;
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  const cmap = COLORMAPS[colormap];

  // Find min/max for normalization
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < minVal) minVal = grid[i];
    if (grid[i] > maxVal) maxVal = grid[i];
  }
  const range = maxVal - minVal || 1; // avoid division by zero

  for (let outY = 0; outY < outHeight; outY++) {
    for (let outX = 0; outX < outWidth; outX++) {
      // Map output pixel to input grid cell (nearest-neighbor upscale)
      const inX = Math.min(Math.floor(outX / scale), width - 1);
      const inY = Math.min(Math.floor(outY / scale), height - 1);
      const value = grid[inY * width + inX];

      // Normalize to [0, 1]
      const normalized = normalize ? (value - minVal) / range : Math.max(0, Math.min(1, value));

      // Interpolate colormap
      const [r, g, b] = interpolateColormap(cmap, normalized);

      const outIdx = (outY * outWidth + outX) * 4;
      rgba[outIdx] = r;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = b;
      rgba[outIdx + 3] = alpha;
    }
  }

  return rgba;
}

/**
 * Interpolate a colormap at a given position [0, 1].
 */
function interpolateColormap(
  cmap: [number, number, number][],
  t: number,
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaledPos = clamped * (cmap.length - 1);
  const lowerIdx = Math.floor(scaledPos);
  const upperIdx = Math.min(lowerIdx + 1, cmap.length - 1);
  const frac = scaledPos - lowerIdx;

  const lower = cmap[lowerIdx];
  const upper = cmap[upperIdx];

  return [
    Math.round(lower[0] + (upper[0] - lower[0]) * frac),
    Math.round(lower[1] + (upper[1] - lower[1]) * frac),
    Math.round(lower[2] + (upper[2] - lower[2]) * frac),
  ];
}

// ---------------------------------------------------------------------------
// Base64 PNG export (for server-side rendering or data URLs)
// ---------------------------------------------------------------------------

/**
 * Convert a Uint8ClampedArray (RGBA) to a base64-encoded PNG data URL.
 *
 * This uses a minimal PNG encoder that works in Node.js without canvas.
 * For browser environments, use Canvas.toDataURL() instead.
 */
export function rgbaToBase64PNG(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  // Minimal PNG encoder: signature + IHDR + IDAT (deflate) + IEND
  const { deflateSync } = require('zlib');

  // Build raw image data with filter byte (0 = None) per row
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter byte: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (width * 4 + 1) + 1 + x * 4;
      rawData[dstIdx] = rgba[srcIdx];       // R
      rawData[dstIdx + 1] = rgba[srcIdx + 1]; // G
      rawData[dstIdx + 2] = rgba[srcIdx + 2]; // B
      rawData[dstIdx + 3] = rgba[srcIdx + 3]; // A
    }
  }

  const compressed = deflateSync(rawData);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createPNGChunk('IHDR', ihdr);
  const idatChunk = createPNGChunk('IDAT', compressed);
  const iendChunk = createPNGChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Create a PNG chunk with CRC32.
 */
function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC32 for PNG chunks.
 */
function crc32(buf: Buffer): number {
  // CRC32 lookup table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Convenience: full pipeline from DepthMap artifact to data URL
// ---------------------------------------------------------------------------

/**
 * Decode a DepthMap artifact and produce a base64 PNG data URL heatmap.
 *
 * This is the one-stop function for rendering depth data:
 *   DepthMap → Float32Array → RGBA heatmap → base64 PNG data URL
 *
 * The resulting data URL can be used as an <img> src or CSS background.
 *
 * @param depthMap - The DepthMap artifact to visualize
 * @param options - Heatmap rendering options
 * @returns Base64 PNG data URL string
 */
export function depthMapToHeatmapDataURL(
  depthMap: DepthMap,
  options: DepthHeatmapOptions = {},
): string {
  const grid = decodeDepthMap(depthMap);
  const scale = options.scale ?? 4; // default 4x upscale for visibility (64→256px)
  const rgba = depthGridToRGBA(grid, depthMap.width, depthMap.height, { ...options, scale });
  const outWidth = depthMap.width * scale;
  const outHeight = depthMap.height * scale;
  return rgbaToBase64PNG(rgba, outWidth, outHeight);
}
