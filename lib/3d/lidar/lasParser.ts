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

/** LAS 1.4 public header size (bytes). 227 + waveform start (8) + first EVLR
 *  start (8) + number of EVLRs (4) + 64-bit point count (8) + 15 × 64-bit
 *  points-by-return (120) = 375. We need at least this many bytes in hand
 *  before we may read the 1.4 point count at offset 247. */
const LAS_14_HEADER_SIZE = 375;

/** Accepted point data format → MINIMUM record size in bytes. This is the
 *  size of the fields we decode; the real stride comes from the header's
 *  Point Data Record Length, which is ≥ this when the file carries per-point
 *  Extra Bytes. */
const POINT_SIZES: Record<number, number> = {
  0: 20, 1: 28, 2: 26, 3: 34,
};

/** Point data format → byte offset of the R/G/B triple within a record.
 *  Format 2 is core(20) + RGB. Format 3 is core(20) + GPS time (float64)
 *  + RGB, so its colour starts 8 bytes later. Formats 0/1 carry no colour. */
const RGB_OFFSETS: Record<number, number> = {
  2: 20, 3: 28,
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

  // 4. Point data format ID (uint8 at 104) + record stride (uint16 at 105).
  const pointFormatId = view.getUint8(104);
  const minPointSize = POINT_SIZES[pointFormatId];
  if (!minPointSize) {
    return { ok: 'error', error: `Unsupported LAS point data format ${pointFormatId} (we support 0–3). Waveform formats 4–10 are out of scope.` } as const;
  }

  // The stride is the header's Point Data Record Length, NOT the format's
  // standard size. Was: we assumed the standard size and stepped by it, so
  // any file carrying per-point Extra Bytes (an Extra Bytes VLR declares
  // them; this is very common in production tiles) had every record after
  // the first read from the middle of the previous one — the whole cloud
  // decoded to garbage coordinates. Now the header value is authoritative,
  // and we only require that it be large enough to hold the fields the
  // declared format defines. It is also the divisor below, so a zero or
  // short value must be rejected here rather than producing Infinity.
  const pointSize = view.getUint16(105, true);
  if (pointSize < minPointSize) {
    return { ok: 'error', error: `Invalid Point Data Record Length ${pointSize} for point data format ${pointFormatId} (needs ≥ ${minPointSize} bytes)` } as const;
  }

  // 5. Number of point records.
  //    Legacy uint32 at offset 107 — present in EVERY version, including 1.4.
  //    LAS 1.4 additionally carries the authoritative uint64 Number of Point
  //    Records at offset 247 of its 375-byte header.
  //    Was: for 1.4 we read offset 107 as the HIGH word and offset 111 (which
  //    is actually the legacy points-by-return array) as the LOW word, so a
  //    normal 1.4 file either reported a bogus "count overflow" (legacy field
  //    populated) or decoded zero points (legacy field 0, as writers emit
  //    when the 64-bit field is the real one). Every real LAS 1.4 file was
  //    rejected. Now: legacy field when it is populated, else the 64-bit one.
  let numPoints = view.getUint32(107, true);
  if (versionMinor >= 4) {
    if (headerSize < LAS_14_HEADER_SIZE || bytes.length < LAS_14_HEADER_SIZE) {
      return { ok: 'error', error: `Truncated LAS 1.4 header (headerSize=${headerSize}, fileLen=${bytes.length}); need ≥ ${LAS_14_HEADER_SIZE} bytes for the 64-bit point count` } as const;
    }
    if (numPoints === 0) {
      const wide = view.getBigUint64(247, true);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
        return { ok: 'error', error: `LAS 1.4 point count ${wide} exceeds the safe integer range; refusing to parse.` } as const;
      }
      numPoints = Number(wide);
    }
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

  // 8. Validate that the point records fit in the file.
  //    This clamp is the allocation guard for untrusted input: `numPoints`
  //    comes straight out of a header field, so a hostile or corrupt file can
  //    declare 2^53 records. Nothing below may size an array or index the
  //    buffer from the DECLARED count — only from what the bytes on hand can
  //    actually hold. `pointSize` is guaranteed ≥ 20 above, so the division
  //    is safe and `availablePoints` is finite.
  if (!Number.isFinite(numPoints) || numPoints < 0) {
    return { ok: 'error', error: `Invalid point record count in header (${numPoints})` } as const;
  }
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
    // Was: both formats read colour at +20/+22/+24. That is right for
    // format 2, but format 3 puts an 8-byte GPS time between the core and
    // the colour, so format-3 files decoded the mantissa of the GPS
    // timestamp as RGB — every point came out a near-random colour that
    // changed with the flight clock. RGB_OFFSETS carries the per-format
    // start; the stride check above guarantees the triple is in bounds.
    const rgbOffset = RGB_OFFSETS[pointFormatId];
    if (rgbOffset !== undefined) {
      r = view.getUint16(off + rgbOffset + 0, true) >> 8;   // 16-bit → 8-bit
      g = view.getUint16(off + rgbOffset + 2, true) >> 8;
      b = view.getUint16(off + rgbOffset + 4, true) >> 8;
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
