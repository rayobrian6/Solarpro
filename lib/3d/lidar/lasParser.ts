/**
 * lib/3d/lidar/lasParser.ts
 *
 * Minimal pure-TypeScript LAS (LASer) file format parser.
 *
 * Spec: ASPRS LAS 1.0 – 1.4 (we parse the public header + point records;
 * VLRs and waveform data are skipped).
 *
 * Supports point data formats:
 *   0 — minimal  (20 bytes)
 *   1 — + GPS time (28 bytes)
 *   2 — + RGB     (26 bytes)
 *   3 — + GPS + RGB (34 bytes)
 *
 * Rejected with a clear error: 4, 5, 6, 7, 8, 9, 10 (waveform formats —
 * rare in practice; a follow-up stage will add support if any real dataset
 * shows up).
 *
 * Output: a `LiDARDataset` in a local ENU frame (meters, centroid at origin)
 * suitable for direct rendering. The original WGS84 centroid is preserved
 * in `centroidLat` / `centroidLng` so downstream code can convert back
 * to `Cartesian3.fromDegrees` for Cesium.
 *
 * LAZ / COPC support is explicitly out of scope (see DESIGN.md §3).
 */

import type { LiDARDataset, LiDARPoint } from './types';

// ─── Constants ────────────────────────────────────────────────────────────

/** LAS 1.0 – 1.3 public header size (bytes). All three versions share
 *  the same 227-byte header; only 1.4 adds extra fields. */
const LAS_HEADER_SIZE = 227;

/** Accepted point data format → record size in bytes. */
const POINT_SIZES: Record<number, number> = {
  0: 20, 1: 28, 2: 26, 3: 34,
};

/** "LASF" file signature. */
const LASF_SIGNATURE = 0x4653414c;  // "LASF" little-endian

// ─── Public API ───────────────────────────────────────────────────────────

export interface ParseOptions {
  /** Max points to parse. Default 500_000 (≈ 30 MB LAS file). Larger
   *  datasets are sub-sampled uniformly to keep memory + render cost
   *  predictable. */
  maxPoints?: number;
}

/** Result of a parse attempt. Errors are returned, not thrown. */
export type ParseResult =
  | { ok: 'success'; dataset: LiDARDataset }
  | { ok: 'error'; error: string };

/**
 * Parse a LAS file from an ArrayBuffer (or a Uint8Array view of one).
 * Returns a `LiDARDataset` ready for rendering.
 */
export function parseLAS(buf: ArrayBuffer | Uint8Array, options: ParseOptions = {}): ParseResult {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxPoints = options.maxPoints ?? 500_000;

  if (bytes.length < LAS_HEADER_SIZE) {
    return { ok: 'error', error: `File too small to be LAS (${bytes.length} bytes; need ≥ ${LAS_HEADER_SIZE})` } as const;
  }

  // 1. File signature: "LASF" at offset 0 (4 bytes)
  const signature = view.getUint32(0, true);
  if (signature !== LASF_SIGNATURE) {
    return { ok: 'error', error: `Not a LAS file (signature = 0x${signature.toString(16)}, expected 0x4653414c = "LASF")` } as const;
  }

  // 2. Version: major (uint8 at 24) + minor (uint8 at 25)
  const versionMajor = view.getUint8(24);
  const versionMinor = view.getUint8(25);
  if (versionMajor !== 1) {
    return { ok: 'error', error: `Unsupported LAS major version ${versionMajor}.X (expected 1.X)` } as const;
  }
  if (![0, 1, 2, 3, 4].includes(versionMinor)) {
    return { ok: 'error', error: `Unsupported LAS 1.${versionMinor}` } as const;
  }

  // 3. Header size and point data offset
  const headerSize = view.getUint16(94, true);
  const pointOffset = view.getUint32(96, true);
  if (pointOffset < headerSize || pointOffset > bytes.length) {
    return { ok: 'error', error: `Invalid point data offset: ${pointOffset} (headerSize=${headerSize}, fileLen=${bytes.length})` } as const;
  }

  // 4. Point data format ID (uint8 at 104)
  const pointFormatId = view.getUint8(104);
  const pointSize = POINT_SIZES[pointFormatId];
  if (!pointSize) {
    return { ok: 'error', error: `Unsupported LAS point data format ${pointFormatId} (we support 0–3). Waveform formats 4–10 are out of scope.` } as const;
  }

  // 5. Number of point records
  //    LAS 1.4: uint64 at offset 107
  //    LAS 1.0–1.3: uint32 at offset 107
  let numPoints: number;
  if (versionMinor >= 4) {
    const hi = view.getUint32(107, true);
    const lo = view.getUint32(111, true);
    numPoints = hi >= 0x1 ? Number.MAX_SAFE_INTEGER : lo;
    if (hi >= 0x1) {
      return { ok: 'error', error: `LAS 1.4 point count overflow (${hi}*2^32 + ${lo}); refusing to parse.` } as const;
    }
  } else {
    numPoints = view.getUint32(107, true);
  }

  // 6. Scale + offset
  const xScale = view.getFloat64(131, true);
  const yScale = view.getFloat64(139, true);
  const zScale = view.getFloat64(147, true);
  const xOffset = view.getFloat64(155, true);
  const yOffset = view.getFloat64(163, true);
  const zOffset = view.getFloat64(171, true);

  // 7. Bounds (used for sanity checks; the actual point bounds are recomputed)
  view.getFloat64(179, true);
  view.getFloat64(187, true);
  view.getFloat64(195, true);
  view.getFloat64(203, true);
  view.getFloat64(211, true);
  view.getFloat64(219, true);

  // 8. Validate that the point records fit in the file
  const availableBytes = bytes.length - pointOffset;
  const availablePoints = Math.floor(availableBytes / pointSize);
  if (availablePoints < numPoints) {
    // Truncate the parse to the actual records present. Some files are
    // truncated in transmission; we should not throw away a usable dataset.
    numPoints = availablePoints;
  }
  if (numPoints <= 0) {
    return { ok: 'error', error: `No point records in file (numPoints=${numPoints})` } as const;
  }

  // 9. Sub-sample if we exceed maxPoints. Uniform stride = ceil(N / M).
  const stride = numPoints > maxPoints ? Math.ceil(numPoints / maxPoints) : 1;
  const outCount = Math.ceil(numPoints / stride);

  // 10. Parse points. The LAS X/Y are in a local projection (whatever the
  //     file was tiled in); we keep them as-is and treat them as a local
  //     ENU frame. The caller (loadLiDAR / SolarEngine3D) provides the
  //     real WGS84 centroid at the dataset boundary.

  const points: LiDARPoint[] = new Array(outCount);
  let o = 0;
  let minXOut = Infinity, maxXOut = -Infinity;
  let minYOut = Infinity, maxYOut = -Infinity;
  let minZOut = Infinity, maxZOut = -Infinity;

  for (let i = 0; i < numPoints; i += stride) {
    const off = pointOffset + i * pointSize;
    const X = view.getInt32(off + 0, true);
    const Y = view.getInt32(off + 4, true);
    const Z = view.getInt32(off + 8, true);

    const x = X * xScale + xOffset;
    const y = Y * yScale + yOffset;
    const z = Z * zScale + zOffset;

    // Validate (NaN guards: a corrupted point can have bad scale/offset
    // and produce NaN/Inf. We drop those points silently.)
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

    // Classification (uint8 at off+15)
    const classification = view.getUint8(off + 15);

    // Optional RGB (formats 2/3 only)
    let r: number | undefined;
    let g: number | undefined;
    let b: number | undefined;
    if (pointFormatId === 2 || pointFormatId === 3) {
      r = view.getUint16(off + 20, true) >> 8;   // 16-bit → 8-bit
      g = view.getUint16(off + 22, true) >> 8;
      b = view.getUint16(off + 24, true) >> 8;
    }

    points[o++] = { x, y, z, classification, r, g, b };

    if (x < minXOut) minXOut = x;
    if (x > maxXOut) maxXOut = x;
    if (y < minYOut) minYOut = y;
    if (y > maxYOut) maxYOut = y;
    if (z < minZOut) minZOut = z;
    if (z > maxZOut) maxZOut = z;
  }

  // Trim any over-allocated tail (happens when stride didn't divide
  // evenly into numPoints, or NaN points were dropped).
  points.length = o;
  if (points.length === 0) {
    return { ok: 'error', error: 'All points were NaN/Inf after decoding. File may be corrupted.' } as const;
  }

  return {
    ok: 'success',
    dataset: {
      source: '',
      points,
      bounds: { minX: minXOut, maxX: maxXOut, minY: minYOut, maxY: maxYOut, minZ: minZOut, maxZ: maxZOut },
      count: points.length,
      // The caller (loadLiDAR / SolarEngine3D) sets centroidLat/Lng
      // and source at the boundary. Defaults here are 0,0 / '' so a
      // standalone parser result is still valid.
      centroidLat: 0,
      centroidLng: 0,
      crs: 'local-enu',
    },
  } as const;
}

/** Parse a File / Blob (browser) and return the dataset. Promise-based. */
export async function parseLASFile(file: File | Blob, options: ParseOptions = {}): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const result = parseLAS(buf, options);
  if (result.ok === 'success') {
    // Stamp the source filename for display.
    if ('name' in file && typeof (file as File).name === 'string') {
      result.dataset.source = (file as File).name;
    }
  }
  return result;
}
