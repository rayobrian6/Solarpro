// ============================================================================
// lib/vision/exif/exifExtractor.ts — EXIF Metadata Extraction Engine
//
// Extracts camera metadata from survey photos for homography-based projection:
//   - GPS coordinates (lat/lng)
//   - Focal length (35mm equivalent)
//   - Camera make/model
//   - Image dimensions (width x height)
//   - Orientation (rotation)
//   - Date/Time original
//
// EXTRACTION STRATEGY (priority chain):
//   1. sharp (primary) — fast, native, handles orientation
//   2. exif-reader (fallback) — pure JS, works without sharp
//   3. Manual JPEG EXIF parsing — last resort
//
// CONFIDENCE SCORING:
//   Each field gets a 0.0–1.0 confidence:
//     1.0 = directly from EXIF (high confidence)
//     0.7 = computed from related fields
//     0.5 = inferred from heuristics
//     0.3 = default/assumed value
//     0.0 = not available
//
// ARCHITECTURE:
//   exifExtractor.ts (this file)
//     ← exifUtils.ts (fetch + validate image bytes)
//     → projection/types.ts (ExifData used in HomographyParams)
//     → homographyPipeline.ts (uses focalLength + sensorSize for camera matrix)
//
// SAFETY:
//   - Never throws — all errors caught, returns partial results
//   - GPS coordinates validated (lat: -90..90, lng: -180..180)
//   - Focal length validated (1..3000mm range)
//   - All outputs are preview-only, never authoritative
// ============================================================================

import {
  fetchImageBytes,
  detectMimeType,
  isExifSupported,
  extractImageDimensionsFromBuffer,
  type ImageFetchOutcome,
} from './exifUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

/** GPS coordinates extracted from EXIF */
export interface ExifGpsCoordinates {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** 0.0–1.0 confidence in GPS accuracy */
  confidence: number;
}

/** Camera parameters relevant to projection */
export interface ExifCameraParams {
  /** Focal length in mm (actual, not 35mm equivalent) */
  focalLengthMm: number | null;
  /** 35mm-equivalent focal length in mm */
  focalLength35mmEquiv: number | null;
  /** Sensor width in mm (computed from focal data if available) */
  sensorWidthMm: number | null;
  /** Camera make (e.g. "Apple", "Samsung") */
  make: string | null;
  /** Camera model (e.g. "iPhone 15 Pro") */
  model: string | null;
  /** Combined confidence 0.0–1.0 */
  confidence: number;
}

/** Image dimensions and orientation */
export interface ExifImageMetadata {
  /** Image width in pixels */
  width: number | null;
  /** Image height in pixels */
  height: number | null;
  /** EXIF orientation value (1–8) */
  orientation: number;
  /** Date/Time original from EXIF */
  dateTimeOriginal: string | null;
  /** Combined confidence 0.0–1.0 */
  confidence: number;
}

/** Complete EXIF extraction result */
export interface ExifData {
  /** Source photo URL */
  sourceUrl: string;
  /** GPS coordinates (null if not available) */
  gps: ExifGpsCoordinates | null;
  /** Camera parameters (null if not available) */
  camera: ExifCameraParams | null;
  /** Image metadata */
  image: ExifImageMetadata;
  /** Overall extraction confidence 0.0–1.0 */
  overallConfidence: number;
  /** Which extraction method succeeded */
  extractionMethod: 'sharp' | 'exif-reader' | 'manual-parse' | 'none';
  /** Any warnings encountered */
  warnings: string[];
  /** Any errors encountered */
  errors: string[];
}

/** Cache entry for EXIF data */
interface ExifCacheEntry {
  data: ExifData;
  timestamp: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum cache entries */
const MAX_CACHE_ENTRIES = 500;

/** Default assumed focal length for smartphones (mm, 35mm equiv) */
const DEFAULT_SMARTPHONE_FOCAL_35MM = 28;

/** Default sensor width for smartphones (mm) — typical 1/2.55" sensor */
const DEFAULT_SMARTPHONE_SENSOR_WIDTH_MM = 7.6;

/** Common sensor widths by camera make/model patterns */
const KNOWN_SENSOR_WIDTHS: Record<string, number> = {
  // Apple iPhones (sensor width in mm)
  'iPhone 15 Pro': 9.8,
  'iPhone 15': 8.8,
  'iPhone 14 Pro': 9.8,
  'iPhone 14': 8.8,
  'iPhone 13 Pro': 8.8,
  'iPhone 13': 7.6,
  'iPhone 12 Pro': 7.6,
  'iPhone 12': 7.6,
  // Samsung Galaxy
  'SM-G998': 9.3,   // S21 Ultra
  'SM-S908': 10.0,   // S22 Ultra
  'SM-S918': 10.0,   // S23 Ultra
  // DJI drones
  'FC3411': 13.2,    // Mavic 3
  'FC3522': 9.6,     // Mavic 3 Classic
  // GoPro
  'Hero10': 7.6,
  'Hero11': 7.6,
  'Hero12': 7.6,
};

// ─── EXIF Data Cache ──────────────────────────────────────────────────────────

const exifCache = new Map<string, ExifCacheEntry>();

/**
 * Get cached EXIF data for a URL if available and not expired.
 */
function getCached(url: string): ExifData | null {
  const entry = exifCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    exifCache.delete(url);
    return null;
  }
  return entry.data;
}

/**
 * Cache EXIF data for a URL.
 */
function setCache(url: string, data: ExifData): void {
  // Evict oldest entries if cache is full
  if (exifCache.size >= MAX_CACHE_ENTRIES) {
    const entries = Array.from(exifCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, Math.floor(MAX_CACHE_ENTRIES / 4));
    for (const [key] of toDelete) {
      exifCache.delete(key);
    }
  }
  exifCache.set(url, { data, timestamp: Date.now() });
}

/**
 * Clear the EXIF data cache.
 */
export function clearExifCache(): void {
  exifCache.clear();
}

/**
 * Get cache statistics for monitoring.
 */
export function getExifCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: exifCache.size, maxEntries: MAX_CACHE_ENTRIES, ttlMs: CACHE_TTL_MS };
}

// ─── GPS Coordinate Conversion ────────────────────────────────────────────────

/**
 * Convert EXIF GPS coordinates from degrees/minutes/seconds format to decimal.
 * EXIF stores GPS as three rational numbers for latitude and three for longitude,
 * plus reference direction (N/S, E/W).
 */
function convertDmsToDecimal(
  dms: [number, number, number] | null,
  ref: string | null,
): number | null {
  if (!dms || dms.length !== 3) return null;
  const [degrees, minutes, seconds] = dms;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return decimal;
}

/**
 * Validate GPS coordinates are within valid ranges.
 */
function isValidGps(lat: number, lng: number): boolean {
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// ─── Manual EXIF Parsing (Last Resort) ────────────────────────────────────────

/**
 * Parse EXIF data from a JPEG ArrayBuffer manually.
 * This is a minimal parser that extracts the most important tags
 * for projection: GPS, focal length, dimensions, orientation.
 *
 * Only used when both sharp and exif-reader are unavailable.
 */
function parseExifFromJpegBuffer(data: ArrayBuffer): {
  gps: ExifGpsCoordinates | null;
  camera: ExifCameraParams | null;
  image: ExifImageMetadata;
  warnings: string[];
} {
  const warnings: string[] = [];
  const view = new Uint8Array(data);

  // Find EXIF header in JPEG
  let exifOffset = -1;
  let offset = 2; // Skip SOI marker

  while (offset < view.length - 4) {
    if (view[offset] !== 0xff) { offset++; continue; }

    const marker = view[offset + 1];

    // APP1 marker (0xE1) contains EXIF
    if (marker === 0xe1) {
      exifOffset = offset + 4; // Skip marker + length
      break;
    }

    // Skip segment
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
    } else if (marker === 0xff) {
      offset++;
    } else {
      const segLen = (view[offset + 2] << 8) | view[offset + 3];
      offset += 2 + segLen;
    }
  }

  if (exifOffset < 0) {
    return {
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      warnings: ['No APP1/EXIF segment found in JPEG'],
    };
  }

  // Check "Exif\x00\x00" header
  if (view.length < exifOffset + 6) {
    return {
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      warnings: ['EXIF segment too short'],
    };
  }

  // Verify Exif header signature
  const exifSig = String.fromCharCode(...view.slice(exifOffset, exifOffset + 4));
  if (exifSig !== 'Exif') {
    warnings.push('APP1 segment does not contain Exif header');
    // Still try to parse TIFF header
  }

  const tiffOffset = exifOffset + 6;
  if (view.length < tiffOffset + 8) {
    return {
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      warnings,
    };
  }

  // Determine byte order
  let littleEndian = true;
  if (view[tiffOffset] === 0x4d && view[tiffOffset + 1] === 0x4d) {
    littleEndian = false; // Big-endian (Motorola)
  } else if (view[tiffOffset] === 0x49 && view[tiffOffset + 1] === 0x49) {
    littleEndian = true; // Little-endian (Intel)
  } else {
    warnings.push('Invalid TIFF byte order marker');
    return {
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      warnings,
    };
  }

  const dataView = new DataView(data, tiffOffset);

  // Helper to read 16-bit value
  const read16 = (off: number) => dataView.getUint16(off, littleEndian);
  // Helper to read 32-bit value
  const read32 = (off: number) => dataView.getUint32(off, littleEndian);
  // Helper to read rational (two 32-bit values: numerator/denominator)
  const readRational = (off: number): number | null => {
    try {
      const num = read32(off);
      const den = read32(off + 4);
      return den !== 0 ? num / den : null;
    } catch { return null; }
  };

  // Read IFD0 (first IFD at offset 8 from TIFF header)
  const ifd0Offset = read32(4);
  if (ifd0Offset === 0 || ifd0Offset + 2 > dataView.byteLength) {
    return {
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      warnings: ['Invalid IFD0 offset'],
    };
  }

  const ifd0Count = read16(ifd0Offset);

  // Parse IFD0 tags
  let orientation = 1;
  let make: string | null = null;
  let model: string | null = null;
  let gpsInfoOffset: number | null = null;

  for (let i = 0; i < ifd0Count && i < 200; i++) {
    const tagOffset = ifd0Offset + 2 + i * 12;
    if (tagOffset + 12 > dataView.byteLength) break;

    const tag = read16(tagOffset);
    const type = read16(tagOffset + 2);
    const count = read32(tagOffset + 4);
    const valueOffset = tagOffset + 8;

    try {
      switch (tag) {
        case 0x010f: // Make
          make = readString(valueOffset, count, dataView, littleEndian, tiffOffset);
          break;
        case 0x0110: // Model
          model = readString(valueOffset, count, dataView, littleEndian, tiffOffset);
          break;
        case 0x0112: // Orientation
          orientation = read16(valueOffset);
          break;
        case 0x8825: // GPSInfoIFDPointer
          gpsInfoOffset = read32(valueOffset);
          break;
      }
    } catch { /* skip tag parse errors */ }
  }

  // Parse Exif IFD (tag 0x8769 in IFD0)
  let exifIfdOffset: number | null = null;
  for (let i = 0; i < ifd0Count && i < 200; i++) {
    const tagOffset = ifd0Offset + 2 + i * 12;
    if (tagOffset + 12 > dataView.byteLength) break;
    const tag = read16(tagOffset);
    if (tag === 0x8769) {
      exifIfdOffset = read32(tagOffset + 8);
      break;
    }
  }

  // Parse Exif IFD tags (focal length, etc.)
  let focalLengthMm: number | null = null;
  let focalLength35: number | null = null;
  let dateTimeOriginal: string | null = null;

  if (exifIfdOffset && exifIfdOffset + 2 <= dataView.byteLength) {
    const exifCount = read16(exifIfdOffset);

    for (let i = 0; i < exifCount && i < 200; i++) {
      const tagOffset = exifIfdOffset + 2 + i * 12;
      if (tagOffset + 12 > dataView.byteLength) break;

      const tag = read16(tagOffset);
      const valueOffset = tagOffset + 8;

      try {
        switch (tag) {
          case 0x9003: // DateTimeOriginal
            dateTimeOriginal = readString(valueOffset, 20, dataView, littleEndian, tiffOffset);
            break;
          case 0x920a: // FocalLength
            focalLengthMm = readRational(valueOffset);
            break;
          case 0xa405: // FocalLengthIn35mmFilm
            focalLength35 = read16(valueOffset);
            break;
        }
      } catch { /* skip tag parse errors */ }
    }
  }

  // Parse GPS IFD
  let gps: ExifGpsCoordinates | null = null;
  if (gpsInfoOffset && gpsInfoOffset + 2 <= dataView.byteLength) {
    gps = parseGpsIfd(gpsInfoOffset, dataView, read16, read32, readRational, littleEndian);
  }

  // Build camera params
  let camera: ExifCameraParams | null = null;
  if (focalLengthMm || focalLength35 || make || model) {
    const sensorWidth = inferSensorWidth(make, model);
    const conf = computeCameraConfidence(focalLengthMm, focalLength35, make, model);
    camera = {
      focalLengthMm,
      focalLength35mmEquiv: focalLength35,
      sensorWidthMm: sensorWidth,
      make,
      model,
      confidence: conf,
    };
  }

  // Get image dimensions
  const dims = extractImageDimensionsFromBuffer(data);
  const imageConf = computeImageConfidence(dims?.width ?? null, dims?.height ?? null, orientation);

  return {
    gps,
    camera,
    image: {
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      orientation,
      dateTimeOriginal,
      confidence: imageConf,
    },
    warnings,
  };
}

/** Parse GPS IFD from TIFF data */
function parseGpsIfd(
  gpsOffset: number,
  dataView: DataView,
  read16: (off: number) => number,
  read32: (off: number) => number,
  readRational: (off: number) => number | null,
  littleEndian: boolean,
): ExifGpsCoordinates | null {
  try {
    const gpsCount = read16(gpsOffset);

    let latDms: [number, number, number] | null = null;
    let latRef: string | null = null;
    let lngDms: [number, number, number] | null = null;
    let lngRef: string | null = null;
    let alt: number | null = null;

    for (let i = 0; i < gpsCount && i < 50; i++) {
      const tagOffset = gpsOffset + 2 + i * 12;
      if (tagOffset + 12 > dataView.byteLength) break;

      const tag = read16(tagOffset);
      const count = read32(tagOffset + 4);
      const valueOffset = tagOffset + 8;

      try {
        switch (tag) {
          case 0x0001: // GPSLatitudeRef
            latRef = String.fromCharCode(dataView.getUint8(valueOffset));
            break;
          case 0x0002: // GPSLatitude
            if (count === 3) {
              const ptr = read32(valueOffset);
              latDms = [
                readRational(ptr) ?? 0,
                readRational(ptr + 8) ?? 0,
                readRational(ptr + 16) ?? 0,
              ];
            }
            break;
          case 0x0003: // GPSLongitudeRef
            lngRef = String.fromCharCode(dataView.getUint8(valueOffset));
            break;
          case 0x0004: // GPSLongitude
            if (count === 3) {
              const ptr = read32(valueOffset);
              lngDms = [
                readRational(ptr) ?? 0,
                readRational(ptr + 8) ?? 0,
                readRational(ptr + 16) ?? 0,
              ];
            }
            break;
          case 0x0006: // GPSAltitude
            alt = readRational(valueOffset);
            break;
        }
      } catch { /* skip tag parse errors */ }
    }

    const lat = convertDmsToDecimal(latDms, latRef);
    const lng = convertDmsToDecimal(lngDms, lngRef);

    if (lat !== null && lng !== null && isValidGps(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        altitude: alt,
        confidence: 0.85, // EXIF GPS is generally reliable but not survey-grade
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Read a string value from IFD entry */
function readString(
  valueOffset: number,
  count: number,
  dataView: DataView,
  littleEndian: boolean,
  tiffOffset: number,
): string | null {
  try {
    // If count <= 4, string is inline in the value field
    if (count <= 4) {
      const bytes: number[] = [];
      for (let i = 0; i < count; i++) {
        bytes.push(dataView.getUint8(valueOffset + i));
      }
      return String.fromCharCode(...bytes).replace(/\0/g, '').trim() || null;
    }
    // Otherwise, valueOffset contains a pointer
    const ptr = dataView.getUint32(valueOffset - tiffOffset, littleEndian);
    const bytes: number[] = [];
    for (let i = 0; i < count && ptr + i < dataView.byteLength; i++) {
      bytes.push(dataView.getUint8(ptr + i));
    }
    return String.fromCharCode(...bytes).replace(/\0/g, '').trim() || null;
  } catch {
    return null;
  }
}

// ─── Confidence Computation ────────────────────────────────────────────────────

function computeCameraConfidence(
  focalLengthMm: number | null,
  focalLength35: number | null,
  make: string | null,
  model: string | null,
): number {
  let conf = 0.0;
  if (focalLengthMm !== null) conf += 0.4;
  if (focalLength35 !== null) conf += 0.3;
  if (make !== null) conf += 0.1;
  if (model !== null) conf += 0.2;
  return Math.min(1.0, conf);
}

function computeImageConfidence(
  width: number | null,
  height: number | null,
  orientation: number,
): number {
  let conf = 0.0;
  if (width !== null && height !== null) conf += 0.6;
  if (orientation > 0 && orientation <= 8) conf += 0.2;
  return Math.min(1.0, conf);
}

function inferSensorWidth(make: string | null, model: string | null): number | null {
  // Try exact model match first
  if (model) {
    for (const [key, width] of Object.entries(KNOWN_SENSOR_WIDTHS)) {
      if (model.includes(key)) return width;
    }
  }
  // Try make-based defaults
  if (make) {
    const makeLower = make.toLowerCase();
    if (makeLower.includes('apple')) return 8.8; // iPhone average
    if (makeLower.includes('samsung')) return 8.5;
    if (makeLower.includes('dji')) return 10.0;
    if (makeLower.includes('gopro')) return 7.6;
    if (makeLower.includes('sony')) return 23.5; // APS-C
    if (makeLower.includes('canon')) return 22.3; // APS-C
    if (makeLower.includes('nikon')) return 23.5; // APS-C
  }
  return DEFAULT_SMARTPHONE_SENSOR_WIDTH_MM; // default smartphone assumption
}

// ─── Main Extraction API ──────────────────────────────────────────────────────

/**
 * Extract EXIF metadata from a photo URL.
 *
 * This is the primary entry point for the EXIF extraction pipeline.
 * It fetches the image, validates it, and extracts camera/GPS metadata.
 *
 * @param url - Absolute URL to the survey photo
 * @param options - Extraction options
 * @returns Complete EXIF data with confidence scores
 *
 * SAFETY: Never throws. Returns partial results with low confidence on errors.
 */
export async function extractExifFromUrl(
  url: string,
  options?: {
    skipCache?: boolean;
    maxImageBytes?: number;
    preferMethod?: 'sharp' | 'exif-reader' | 'manual-parse';
  },
): Promise<ExifData> {
  // Check cache first
  if (!options?.skipCache) {
    const cached = getCached(url);
    if (cached) return cached;
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  // Fetch image bytes
  const fetchResult = await fetchImageBytes(url, {
    maxBytes: options?.maxImageBytes,
  });

  if (!fetchResult.ok) {
    const fetchError = fetchResult as import('./exifUtils').ImageFetchError;
    const result: ExifData = {
      sourceUrl: url,
      gps: null,
      camera: null,
      image: { width: null, height: null, orientation: 1, dateTimeOriginal: null, confidence: 0.0 },
      overallConfidence: 0.0,
      extractionMethod: 'none',
      warnings,
      errors: [fetchError.error],
    };
    setCache(url, result);
    return result;
  }

  // Check if format supports EXIF
  if (!isExifSupported(fetchResult.mimeType)) {
    warnings.push(`Format ${fetchResult.mimeType} typically does not support EXIF`);

    // Still try to get dimensions
    const dims = extractImageDimensionsFromBuffer(fetchResult.data);
    const result: ExifData = {
      sourceUrl: url,
      gps: null,
      camera: null,
      image: {
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        orientation: 1,
        dateTimeOriginal: null,
        confidence: dims ? 0.3 : 0.0,
      },
      overallConfidence: dims ? 0.1 : 0.0,
      extractionMethod: 'none',
      warnings,
      errors,
    };
    setCache(url, result);
    return result;
  }

  // Try extraction methods in priority order
  // Method 1: sharp (if available)
  if (options?.preferMethod !== 'exif-reader' && options?.preferMethod !== 'manual-parse') {
    try {
      const sharpResult = await extractWithSharp(fetchResult.data);
      if (sharpResult) {
        const result = buildExifData(url, sharpResult, 'sharp', warnings, errors);
        setCache(url, result);
        return result;
      }
      warnings.push('sharp extraction returned no data, trying fallback');
    } catch (err) {
      warnings.push(`sharp extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Method 2: exif-reader (if available)
  if (options?.preferMethod !== 'manual-parse') {
    try {
      const exifReaderResult = await extractWithExifReader(fetchResult.data);
      if (exifReaderResult) {
        const result = buildExifData(url, exifReaderResult, 'exif-reader', warnings, errors);
        setCache(url, result);
        return result;
      }
      warnings.push('exif-reader extraction returned no data, trying manual parse');
    } catch (err) {
      warnings.push(`exif-reader failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Method 3: Manual JPEG EXIF parsing
  try {
    const manualResult = parseExifFromJpegBuffer(fetchResult.data);
    const result = buildExifData(url, manualResult, 'manual-parse', warnings, errors);
    setCache(url, result);
    return result;
  } catch (err) {
    errors.push(`Manual EXIF parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Complete failure — return minimal result with dimensions if possible
  const dims = extractImageDimensionsFromBuffer(fetchResult.data);
  const result: ExifData = {
    sourceUrl: url,
    gps: null,
    camera: null,
    image: {
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      orientation: 1,
      dateTimeOriginal: null,
      confidence: dims ? 0.3 : 0.0,
    },
    overallConfidence: dims ? 0.05 : 0.0,
    extractionMethod: 'none',
    warnings,
    errors,
  };
  setCache(url, result);
  return result;
}

/**
 * Extract EXIF from an already-fetched ArrayBuffer.
 * Use this when the image bytes are already available (e.g., from upload).
 */
export async function extractExifFromBuffer(
  data: ArrayBuffer,
  sourceUrl?: string,
): Promise<ExifData> {
  const url = sourceUrl ?? 'buffer://unknown';
  const warnings: string[] = [];
  const errors: string[] = [];

  const mimeType = detectMimeType(data);
  if (!mimeType || !isExifSupported(mimeType)) {
    warnings.push(mimeType ? `Format ${mimeType} may not support EXIF` : 'Unknown image format');

    const dims = extractImageDimensionsFromBuffer(data);
    const result: ExifData = {
      sourceUrl: url,
      gps: null,
      camera: null,
      image: {
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        orientation: 1,
        dateTimeOriginal: null,
        confidence: dims ? 0.3 : 0.0,
      },
      overallConfidence: dims ? 0.1 : 0.0,
      extractionMethod: 'none',
      warnings,
      errors,
    };
    return result;
  }

  // Try sharp first
  try {
    const sharpResult = await extractWithSharp(data);
    if (sharpResult) {
      return buildExifData(url, sharpResult, 'sharp', warnings, errors);
    }
  } catch (err) {
    warnings.push(`sharp extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Try exif-reader
  try {
    const exifReaderResult = await extractWithExifReader(data);
    if (exifReaderResult) {
      return buildExifData(url, exifReaderResult, 'exif-reader', warnings, errors);
    }
  } catch (err) {
    warnings.push(`exif-reader failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Manual parse
  try {
    const manualResult = parseExifFromJpegBuffer(data);
    return buildExifData(url, manualResult, 'manual-parse', warnings, errors);
  } catch (err) {
    errors.push(`Manual EXIF parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const dims = extractImageDimensionsFromBuffer(data);
  return {
    sourceUrl: url,
    gps: null,
    camera: null,
    image: {
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      orientation: 1,
      dateTimeOriginal: null,
      confidence: dims ? 0.3 : 0.0,
    },
    overallConfidence: dims ? 0.05 : 0.0,
    extractionMethod: 'none',
    warnings,
    errors,
  };
}

// ─── Sharp Extraction (Primary) ───────────────────────────────────────────────

interface RawExifFields {
  gps: ExifGpsCoordinates | null;
  camera: ExifCameraParams | null;
  image: ExifImageMetadata;
}

/**
 * Try to extract EXIF using the sharp library.
 * Sharp is a native Node.js image processing library that reads EXIF
 * metadata during image decoding. It's fast and reliable.
 */
async function extractWithSharp(data: ArrayBuffer): Promise<RawExifFields | null> {
  try {
    // Dynamic import — sharp may not be installed in all environments
    const sharp = await import('sharp');
    const metadata = await sharp.default(Buffer.from(data)).metadata();

    if (!metadata) return null;

    // Extract GPS from EXIF
    let gps: ExifGpsCoordinates | null = null;
    if (metadata.exif) {
      gps = parseSharpExifGps(metadata.exif);
    }

    // Extract camera params
    let camera: ExifCameraParams | null = null;
    const focalLength = metadata.exif?.['FocalLength'] ??
                        (metadata as any).focalLength ?? null;
    const focalLength35 = metadata.exif?.['FocalLength35efl'] ??
                          (metadata as any).focalLength35 ?? null;
    const make = metadata.exif?.['Make'] ?? (metadata as any).make ?? null;
    const model = metadata.exif?.['Model'] ?? (metadata as any).model ?? null;

    if (focalLength || focalLength35 || make || model) {
      const sensorWidth = inferSensorWidth(
        typeof make === 'string' ? make : null,
        typeof model === 'string' ? model : null,
      );

      camera = {
        focalLengthMm: typeof focalLength === 'number' ? focalLength : null,
        focalLength35mmEquiv: typeof focalLength35 === 'number' ? focalLength35 : null,
        sensorWidthMm: sensorWidth,
        make: typeof make === 'string' ? make : null,
        model: typeof model === 'string' ? model : null,
        confidence: computeCameraConfidence(
          typeof focalLength === 'number' ? focalLength : null,
          typeof focalLength35 === 'number' ? focalLength35 : null,
          typeof make === 'string' ? make : null,
          typeof model === 'string' ? model : null,
        ),
      };
    }

    // Image dimensions and orientation
    const orientation = metadata.orientation ?? 1;
    const dateTimeOriginal = metadata.exif?.['DateTimeOriginal'] ?? null;

    return {
      gps,
      camera,
      image: {
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        orientation,
        dateTimeOriginal: typeof dateTimeOriginal === 'string' ? dateTimeOriginal : null,
        confidence: computeImageConfidence(metadata.width ?? null, metadata.height ?? null, orientation),
      },
    };
  } catch {
    // sharp not available or failed
    return null;
  }
}

/**
 * Parse GPS data from sharp's EXIF output.
 * Sharp returns EXIF as a nested object with various tag names.
 */
function parseSharpExifGps(exif: Record<string, any>): ExifGpsCoordinates | null {
  try {
    // Try GPS IFD tags
    const gpsLat = exif['GPSLatitude'];
    const gpsLatRef = exif['GPSLatitudeRef'];
    const gpsLng = exif['GPSLongitude'];
    const gpsLngRef = exif['GPSLongitudeRef'];
    const gpsAlt = exif['GPSAltitude'];

    if (gpsLat !== undefined && gpsLng !== undefined) {
      let lat: number;
      let lng: number;

      if (Array.isArray(gpsLat) && gpsLat.length === 3) {
        lat = convertDmsToDecimal(gpsLat as [number, number, number], gpsLatRef ?? null) ?? 0;
      } else if (typeof gpsLat === 'number') {
        lat = gpsLat;
        if (gpsLatRef === 'S') lat = -lat;
      } else {
        return null;
      }

      if (Array.isArray(gpsLng) && gpsLng.length === 3) {
        lng = convertDmsToDecimal(gpsLng as [number, number, number], gpsLngRef ?? null) ?? 0;
      } else if (typeof gpsLng === 'number') {
        lng = gpsLng;
        if (gpsLngRef === 'W') lng = -lng;
      } else {
        return null;
      }

      if (isValidGps(lat, lng)) {
        return {
          latitude: lat,
          longitude: lng,
          altitude: typeof gpsAlt === 'number' ? gpsAlt : null,
          confidence: 0.85,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Exif-Reader Extraction (Fallback) ─────────────────────────────────────────

/**
 * Try to extract EXIF using the exif-reader package.
 * This is a pure JavaScript EXIF parser that works without native dependencies.
 */
async function extractWithExifReader(data: ArrayBuffer): Promise<RawExifFields | null> {
  try {
    const exifReader = await import('exif-reader');
    const parse = (exifReader as Record<string, unknown>).default
      ? (exifReader as Record<string, unknown>).default as (buf: Buffer) => Record<string, unknown>
      : exifReader as unknown as (buf: Buffer) => Record<string, unknown>;
    const tags = parse(Buffer.from(data));

    if (!tags || !tags.exif) return null;

    // Narrow sub-objects from Record<string, unknown>
    const gpsTags = tags.gps as Record<string, unknown> | undefined;
    const exifTags = tags.exif as Record<string, unknown>;
    const imageTags = tags.image as Record<string, unknown> | undefined;

    // GPS
    let gps: ExifGpsCoordinates | null = null;
    if (gpsTags) {
      const latDms = gpsTags.GPSLatitude;
      const latRef = gpsTags.GPSLatitudeRef;
      const lngDms = gpsTags.GPSLongitude;
      const lngRef = gpsTags.GPSLongitudeRef;

      const lat = convertDmsToDecimal(
        Array.isArray(latDms) ? latDms as [number, number, number] : null,
        typeof latRef === 'string' ? latRef : null,
      );
      const lng = convertDmsToDecimal(
        Array.isArray(lngDms) ? lngDms as [number, number, number] : null,
        typeof lngRef === 'string' ? lngRef : null,
      );

      if (lat !== null && lng !== null && isValidGps(lat, lng)) {
        gps = {
          latitude: lat,
          longitude: lng,
          altitude: typeof gpsTags.GPSAltitude === 'number' ? gpsTags.GPSAltitude : null,
          confidence: 0.85,
        };
      }
    }

    // Camera
    const focalLength = exifTags.FocalLength ?? null;
    const focalLength35 = exifTags.FocalLengthIn35mmFilm ?? null;
    const make = imageTags?.Make ?? null;
    const model = imageTags?.Model ?? null;

    let camera: ExifCameraParams | null = null;
    if (focalLength || focalLength35 || make || model) {
      camera = {
        focalLengthMm: typeof focalLength === 'number' ? focalLength : null,
        focalLength35mmEquiv: typeof focalLength35 === 'number' ? focalLength35 : null,
        sensorWidthMm: inferSensorWidth(
          typeof make === 'string' ? make : null,
          typeof model === 'string' ? model : null,
        ),
        make: typeof make === 'string' ? make : null,
        model: typeof model === 'string' ? model : null,
        confidence: computeCameraConfidence(
          typeof focalLength === 'number' ? focalLength : null,
          typeof focalLength35 === 'number' ? focalLength35 : null,
          typeof make === 'string' ? make : null,
          typeof model === 'string' ? model : null,
        ),
      };
    }

    // Image
    const orientation = imageTags?.Orientation ?? 1;
    const dateTimeOriginal = exifTags.DateTimeOriginal ?? null;
    const dims = extractImageDimensionsFromBuffer(data);

    return {
      gps,
      camera,
      image: {
        width: dims?.width ?? (typeof imageTags?.ImageWidth === 'number' ? imageTags.ImageWidth : null) ?? (typeof exifTags?.ExifImageWidth === 'number' ? exifTags.ExifImageWidth : null) ?? null,
        height: dims?.height ?? (typeof imageTags?.ImageLength === 'number' ? imageTags.ImageLength : null) ?? (typeof exifTags?.ExifImageHeight === 'number' ? exifTags.ExifImageHeight : null) ?? null,
        orientation: typeof orientation === 'number' ? orientation : 1,
        dateTimeOriginal: typeof dateTimeOriginal === 'string' ? dateTimeOriginal : null,
        confidence: computeImageConfidence(
          dims?.width ?? null,
          dims?.height ?? null,
          typeof orientation === 'number' ? orientation : 1,
        ),
      },
    };
  } catch {
    return null;
  }
}

// ─── Result Assembly ──────────────────────────────────────────────────────────

function buildExifData(
  url: string,
  raw: RawExifFields,
  method: ExifData['extractionMethod'],
  warnings: string[],
  errors: string[],
): ExifData {
  // Compute overall confidence as weighted average
  const gpsWeight = 0.4;
  const cameraWeight = 0.4;
  const imageWeight = 0.2;

  const gpsConf = raw.gps?.confidence ?? 0;
  const cameraConf = raw.camera?.confidence ?? 0;
  const imageConf = raw.image.confidence;

  const overallConfidence = Math.min(
    gpsConf * gpsWeight + cameraConf * cameraWeight + imageConf * imageWeight,
    1.0,
  );

  return {
    sourceUrl: url,
    gps: raw.gps,
    camera: raw.camera,
    image: raw.image,
    overallConfidence,
    extractionMethod: method,
    warnings,
    errors,
  };
}

// ─── Convenience: Compute FOV from EXIF ───────────────────────────────────────

/**
 * Compute horizontal and vertical field of view from EXIF camera data.
 *
 * FOV = 2 * atan(sensorDimension / (2 * focalLength))
 *
 * If exact sensor size is not available, uses smartphone defaults.
 * Returns null if focal length is not available at all.
 */
export function computeFieldOfView(camera: ExifCameraParams): {
  hfovDeg: number;
  vfovDeg: number;
  confidence: number;
} | null {
  const focalLength = camera.focalLengthMm;
  if (!focalLength || focalLength <= 0) {
    // Try using 35mm equivalent with standard 36mm sensor
    if (camera.focalLength35mmEquiv && camera.focalLength35mmEquiv > 0) {
      const hfovDeg = 2 * Math.atan(36 / (2 * camera.focalLength35mmEquiv)) * (180 / Math.PI);
      const sensorW = camera.sensorWidthMm ?? DEFAULT_SMARTPHONE_SENSOR_WIDTH_MM;
      const aspectRatio = 4 / 3; // typical smartphone aspect
      const sensorH = sensorW / aspectRatio;
      const equivFocal = (camera.focalLength35mmEquiv / 36) * sensorW;
      const vfovDeg = 2 * Math.atan(sensorH / (2 * equivFocal)) * (180 / Math.PI);
      return { hfovDeg, vfovDeg, confidence: 0.6 };
    }
    return null;
  }

  const sensorWidth = camera.sensorWidthMm ?? DEFAULT_SMARTPHONE_SENSOR_WIDTH_MM;
  const aspectRatio = 4 / 3;
  const sensorHeight = sensorWidth / aspectRatio;

  const hfovDeg = 2 * Math.atan(sensorWidth / (2 * focalLength)) * (180 / Math.PI);
  const vfovDeg = 2 * Math.atan(sensorHeight / (2 * focalLength)) * (180 / Math.PI);

  const confidence = camera.sensorWidthMm !== null ? 0.8 : 0.5;

  return { hfovDeg, vfovDeg, confidence };
}

/**
 * Get default smartphone FOV as a fallback when no EXIF is available.
 */
export function getDefaultSmartphoneFov(): { hfovDeg: number; vfovDeg: number; confidence: number } {
  return {
    hfovDeg: 65,  // typical smartphone wide-angle camera
    vfovDeg: 50,
    confidence: 0.3,
  };
}

/**
 * Batch extract EXIF from multiple photo URLs.
 * Processes in parallel with a concurrency limit.
 */
export async function batchExtractExif(
  urls: string[],
  options?: {
    concurrency?: number;
    skipCache?: boolean;
    maxImageBytes?: number;
  },
): Promise<Map<string, ExifData>> {
  const concurrency = options?.concurrency ?? 5;
  const results = new Map<string, ExifData>();

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const promises = batch.map(async (url) => {
      const data = await extractExifFromUrl(url, {
        skipCache: options?.skipCache,
        maxImageBytes: options?.maxImageBytes,
      });
      return { url, data };
    });

    const batchResults = await Promise.allSettled(promises);
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.url, result.value.data);
      }
    }
  }

  return results;
}
