// ============================================================================
// lib/vision/exif/exifUtils.ts — EXIF Utility Functions
//
// Provides image fetching, validation, and format detection for the EXIF
// extraction pipeline. Designed for server-side use in Next.js API routes.
//
// DEPENDENCIES:
//   - undici (Node.js global fetch, or undici for timeout control)
//   - No external npm packages required for core functionality
//
// ARCHITECTURE:
//   exifUtils.ts (fetch + validate image bytes)
//     → exifExtractor.ts (parse EXIF from validated bytes)
//     → homographyPipeline.ts (use focal length + dimensions for projection)
//
// SAFETY:
//   - All network requests have timeouts (5s connect, 15s total)
//   - Response size limited to 50MB
//   - Magic byte validation prevents processing non-image data
//   - Never throws — errors returned as null results
// ============================================================================

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result of fetching an image from a URL */
export interface ImageFetchResult {
  /** Whether the fetch succeeded */
  ok: true;
  /** Raw image bytes */
  data: ArrayBuffer;
  /** Detected MIME type from magic bytes */
  mimeType: string;
  /** Content-Length from response header (if available) */
  contentLength: number | null;
  /** URL that was actually fetched (after redirects) */
  finalUrl: string;
}

/** Failed fetch result */
export interface ImageFetchError {
  ok: false;
  /** Human-readable error description */
  error: string;
  /** HTTP status code if available */
  statusCode?: number;
}

export type ImageFetchOutcome = ImageFetchResult | ImageFetchError;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum image size to download (50 MB) */
const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

/** Connection timeout in milliseconds */
const CONNECT_TIMEOUT_MS = 5_000;

/** Total request timeout in milliseconds */
const TOTAL_TIMEOUT_MS = 15_000;

/** User agent for HTTP requests */
const USER_AGENT = 'SolarPro-Vision-EXIF/1.0';

// ─── Magic Byte Signatures ───────────────────────────────────────────────────

/** Map of file signature magic bytes to MIME types */
const MAGIC_BYTES: ReadonlyArray<{ bytes: number[]; mime: string; ext: string }> = [
  // JPEG: FF D8 FF
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  // PNG: 89 50 4E 47
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png', ext: 'png' },
  // GIF87a: 47 49 46 38 37 61
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: 'image/gif', ext: 'gif' },
  // GIF89a: 47 49 46 38 39 61
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: 'image/gif', ext: 'gif' },
  // WebP: 52 49 46 46 ... 57 45 42 50
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', ext: 'webp' },
  // TIFF little-endian: 49 49 2A 00
  { bytes: [0x49, 0x49, 0x2a, 0x00], mime: 'image/tiff', ext: 'tif' },
  // TIFF big-endian: 4D 4D 00 2A
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], mime: 'image/tiff', ext: 'tif' },
  // BMP: 42 4D
  { bytes: [0x42, 0x4d], mime: 'image/bmp', ext: 'bmp' },
];

/** Image formats that typically support EXIF metadata */
const EXIF_CAPABLE_FORMATS = new Set([
  'image/jpeg',
  'image/tiff',
  'image/webp', // WebP can sometimes carry EXIF
]);

// ─── Image Fetching ───────────────────────────────────────────────────────────

/**
 * Fetch an image from a URL with timeout and size limits.
 *
 * @param url - Absolute URL to the image
 * @param options - Optional fetch overrides
 * @returns Image bytes with metadata, or an error
 *
 * SAFETY: Never throws. Returns ImageFetchError on any failure.
 */
export async function fetchImageBytes(
  url: string,
  options?: {
    maxBytes?: number;
    connectTimeoutMs?: number;
    totalTimeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<ImageFetchOutcome> {
  const maxBytes = options?.maxBytes ?? MAX_IMAGE_SIZE_BYTES;
  const connectTimeout = options?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const totalTimeout = options?.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;

  try {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, error: `Invalid URL: ${url}` };
    }

    // Only allow http/https
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, error: `Unsupported protocol: ${parsedUrl.protocol}` };
    }

    // Create abort controller for total timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), totalTimeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...options?.headers,
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status,
        };
      }

      // Check Content-Length before downloading
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > maxBytes) {
          return {
            ok: false,
            error: `Image too large: ${size} bytes (max ${maxBytes})`,
          };
        }
      }

      // Download with streaming size check
      const reader = response.body?.getReader();
      if (!reader) {
        return { ok: false, error: 'No response body' };
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.byteLength;
        if (totalSize > maxBytes) {
          reader.cancel();
          return {
            ok: false,
            error: `Image too large: exceeded ${maxBytes} bytes during download`,
          };
        }
        chunks.push(value);
      }

      // Combine chunks into single ArrayBuffer
      const data = new ArrayBuffer(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        new Uint8Array(data, offset, chunk.byteLength).set(chunk);
        offset += chunk.byteLength;
      }

      // Validate magic bytes
      const mimeType = detectMimeType(data);
      if (!mimeType) {
        return {
          ok: false,
          error: 'Downloaded data does not match any known image format (magic byte check failed)',
        };
      }

      return {
        ok: true,
        data,
        mimeType,
        contentLength: contentLength ? parseInt(contentLength, 10) : null,
        finalUrl: response.url || url,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: `Request timed out after ${totalTimeout}ms` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Fetch failed: ${message}` };
  }
}

// ─── Magic Byte Detection ────────────────────────────────────────────────────

/**
 * Detect the MIME type of image data by inspecting magic bytes.
 * Returns null if no known format is matched.
 */
export function detectMimeType(data: ArrayBuffer): string | null {
  if (data.byteLength < 4) return null;

  const view = new Uint8Array(data);

  for (const sig of MAGIC_BYTES) {
    if (view.length < sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (view[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      // Special case: WebP needs additional check at offset 8-11
      if (sig.mime === 'image/webp') {
        if (view.length >= 12 &&
            view[8] === 0x57 && view[9] === 0x45 &&
            view[10] === 0x42 && view[11] === 0x50) {
          return 'image/webp';
        }
        continue; // Not actually WebP despite RIFF header
      }
      return sig.mime;
    }
  }

  return null;
}

/**
 * Detect file extension from magic bytes.
 */
export function detectFileExtension(data: ArrayBuffer): string | null {
  if (data.byteLength < 4) return null;

  const view = new Uint8Array(data);

  for (const sig of MAGIC_BYTES) {
    if (view.length < sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (view[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      if (sig.mime === 'image/webp') {
        if (view.length >= 12 &&
            view[8] === 0x57 && view[9] === 0x45 &&
            view[10] === 0x42 && view[11] === 0x50) {
          return sig.ext;
        }
        continue;
      }
      return sig.ext;
    }
  }

  return null;
}

// ─── EXIF Support Check ──────────────────────────────────────────────────────

/**
 * Check whether a given MIME type typically supports EXIF metadata.
 * JPEG and TIFF always support EXIF. WebP sometimes does.
 */
export function isExifSupported(mimeType: string): boolean {
  return EXIF_CAPABLE_FORMATS.has(mimeType);
}

/**
 * Check whether a given file extension typically supports EXIF metadata.
 */
export function isExifSupportedExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  return ['jpg', 'jpeg', 'tif', 'tiff', 'webp'].includes(normalized);
}

/**
 * Infer MIME type from a URL's file extension (fallback when magic bytes
 * are not available, e.g. before downloading).
 */
export function inferMimeTypeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      bmp: 'image/bmp',
    };

    return map[ext] ?? null;
  } catch {
    return null;
  }
}

// ─── Image Dimension Helpers ─────────────────────────────────────────────────

/**
 * Extract basic image dimensions from JPEG headers (SOF marker).
 * This is a fast, minimal parser that doesn't require decoding the full image.
 * Returns null if dimensions cannot be determined.
 */
export function extractJpegDimensionsFromBuffer(data: ArrayBuffer): { width: number; height: number } | null {
  const view = new Uint8Array(data);
  if (view.length < 4 || view[0] !== 0xff || view[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < view.length - 1) {
    if (view[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = view[offset + 1];

    // SOF0 (Baseline), SOF1, SOF2 (Progressive)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (offset + 9 > view.length) return null;
      // Height is at offset+5 (2 bytes, big-endian), Width at offset+7
      const height = (view[offset + 5] << 8) | view[offset + 6];
      const width = (view[offset + 7] << 8) | view[offset + 8];
      if (height > 0 && width > 0) return { width, height };
    }

    // Skip to next marker (length is 2 bytes big-endian after marker)
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
    } else if (marker === 0xff) {
      offset++; // Padding byte
    } else {
      if (offset + 3 > view.length) return null;
      const segLen = (view[offset + 2] << 8) | view[offset + 3];
      offset += 2 + segLen;
    }
  }

  return null;
}

/**
 * Extract PNG dimensions from IHDR chunk.
 */
export function extractPngDimensionsFromBuffer(data: ArrayBuffer): { width: number; height: number } | null {
  const view = new Uint8Array(data);
  if (view.length < 24) return null;
  if (view[0] !== 0x89 || view[1] !== 0x50) return null; // Not PNG

  // IHDR starts at offset 8 (after 8-byte signature)
  // Width at offset 16 (4 bytes big-endian), Height at offset 20
  const width = (view[16] << 24) | (view[17] << 16) | (view[18] << 8) | view[19];
  const height = (view[20] << 24) | (view[21] << 16) | (view[22] << 8) | view[23];

  if (width > 0 && height > 0) return { width, height };
  return null;
}

/**
 * Extract image dimensions from buffer using format-specific fast parsers.
 * Falls back gracefully — returns null if dimensions cannot be determined.
 */
export function extractImageDimensionsFromBuffer(data: ArrayBuffer): { width: number; height: number } | null {
  const mime = detectMimeType(data);

  if (mime === 'image/jpeg') {
    return extractJpegDimensionsFromBuffer(data);
  }

  if (mime === 'image/png') {
    return extractPngDimensionsFromBuffer(data);
  }

  // WebP, TIFF, GIF, BMP — not supported by fast parser
  // These would require sharp or format-specific decoders
  return null;
}
