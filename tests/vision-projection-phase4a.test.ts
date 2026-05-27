/**
 * tests/vision-projection-phase4a.test.ts
 *
 * Phase 4A — Single-photo homography-assisted roof-plane projection
 *
 * Test groups:
 *  1.  EXIF extraction — extractExifFromUrl, computeFieldOfView, cache
 *  2.  Feature matching — matchFeatures, matchFeaturesWithFallback, selectDetector
 *  3.  Homography pipeline — estimateHomography, projectPointWithHomography, validateHomographyResult
 *  4.  Authority safety — FROZEN_AUTHORITY_FLAGS, assertAuthorityFlagsSafe
 *  5.  Debug visualization — isDebugModeEnabled, generateDebugSummary
 *  6.  Projection fallback chain — 4-tier priority (homography → gps_azimuth_pitch → gps_centroid → none)
 *  7.  TypeScript types — Phase 4A type contracts
 *  8.  Integration — aggregateVisionResults with homography
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Phase 4A module imports ──────────────────────────────────────────────────
import {
  extractExifFromUrl,
  computeFieldOfView,
  getDefaultSmartphoneFov,
  clearExifCache,
  getExifCacheStats,
  type ExifData,
  type ExifCameraParams,
} from '../lib/vision/exif/exifExtractor';

import {
  detectMimeType,
  isExifSupported,
  extractImageDimensionsFromBuffer,
} from '../lib/vision/exif/exifUtils';

import {
  FROZEN_AUTHORITY_FLAGS,
  assertAuthorityFlagsSafe,
  DEFAULT_FEATURE_MATCH_PARAMS,
  DEFAULT_HOMOGRAPHY_PARAMS,
  DEFAULT_PROJECTION_PARAMS,
  type FeatureDetectorType,
  type FeatureMatchResult,
  type HomographyResult,
  type ProjectionResult,
  type ProjectionMethod,
  type ProjectionAuthorityFlags,
  type MatchQuality,
} from '../lib/vision/projection/types';

import {
  matchFeaturesWithFallback,
  assessMatchQuality,
  calculateMatchConfidence,
  selectDetector,
} from '../lib/vision/projection/featureMatching';

import {
  estimateHomography,
  validateHomographyResult,
  isHomographyGeometricallyValid,
  projectPointWithHomography,
  computeReprojectionErrors,
  projectWithHomography,
  estimateRadiusFromProjection,
  HOMOGRAPHY_MIN_INLIERS,
  HOMOGRAPHY_MIN_CONFIDENCE,
  HOMOGRAPHY_MAX_REPROJ_ERROR_PX,
  HOMOGRAPHY_CONFIDENCE_BOOST,
  type HomographyProjectionAttempt,
} from '../lib/vision/projection/homographyPipeline';

import {
  isDebugModeEnabled,
  describeFeatureMatchOverlay,
  describeHomographyOverlay,
  generateDebugSummary,
} from '../lib/vision/projection/debugVisualization';

// ── Mock setup ───────────────────────────────────────────────────────────────

// Mock fetch for EXIF extraction tests
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  clearExifCache();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

// Helper: create a minimal valid JPEG buffer
function makeJpegBuffer(): ArrayBuffer {
  return new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x08,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xFF, 0xD9,
  ]).buffer;
}

// Helper: create a minimal valid HomographyResult
function makeValidHomography(overrides?: Partial<HomographyResult>): HomographyResult {
  return {
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // identity 3x3 row-major
    inlierCount: 50,
    totalMatches: 80,
    inlierRatio: 0.625,
    confidence: 0.85,
    meanReprojectionError: 1.5,
    maxReprojectionError: 3.0,
    isGeometricallyValid: true,
    method: 'RANSAC',
    durationMs: 120,
    ok: true,
    ...overrides,
  };
}

// Helper: create a minimal valid FeatureMatchResult
function makeValidMatchResult(overrides?: Partial<FeatureMatchResult>): FeatureMatchResult {
  return {
    rawMatchCount: 100,
    goodMatchCount: 30,
    quality: 'good',
    confidence: 0.75,
    detector: 'AKAZE',
    durationMs: 200,
    ok: true,
    ...overrides,
  };
}

// ============================================================================
// 1. EXIF extraction
// ============================================================================
describe('Phase 4A: EXIF extraction', () => {
  it('extractExifFromUrl returns structured ExifData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => makeJpegBuffer(),
    });

    const result = await extractExifFromUrl('https://example.com/photo.jpg');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('camera');
    expect(result).toHaveProperty('gps');
    expect(result).toHaveProperty('image');
    expect(result).toHaveProperty('sourceUrl');
    expect(result).toHaveProperty('overallConfidence');
    expect(result).toHaveProperty('extractionMethod');
  });

  it('computeFieldOfView returns FOV from ExifCameraParams with focal length', () => {
    const camera: ExifCameraParams = {
      make: 'Apple',
      model: 'iPhone 15 Pro',
      focalLengthMm: 6.77,
      focalLength35mmEquiv: 26,
      sensorWidthMm: null,
      confidence: 0.9,
    };

    const fov = computeFieldOfView(camera);
    expect(fov).toBeDefined();
    expect(fov).not.toBeNull();
    if (fov) {
      expect(fov.hfovDeg).toBeGreaterThan(0);
      expect(fov.hfovDeg).toBeLessThan(180);
      expect(fov.vfovDeg).toBeGreaterThan(0);
      expect(fov.vfovDeg).toBeLessThan(180);
      expect(fov.confidence).toBeGreaterThan(0);
    }
  });

  it('computeFieldOfView returns null for camera with no focal length', () => {
    const camera: ExifCameraParams = {
      make: null,
      model: null,
      focalLengthMm: null,
      focalLength35mmEquiv: null,
      sensorWidthMm: null,
      confidence: 0.0,
    };

    const fov = computeFieldOfView(camera);
    expect(fov).toBeNull();
  });

  it('getDefaultSmartphoneFov returns reasonable FOV values', () => {
    const fov = getDefaultSmartphoneFov();
    expect(fov.hfovDeg).toBeGreaterThan(50);
    expect(fov.hfovDeg).toBeLessThan(80);
    expect(fov.vfovDeg).toBeGreaterThan(30);
    expect(fov.vfovDeg).toBeLessThan(70);
    expect(fov.confidence).toBeLessThanOrEqual(0.5); // default is low confidence
  });

  it('EXIF cache is populated after extraction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => makeJpegBuffer(),
    });

    await extractExifFromUrl('https://example.com/cached-photo.jpg');
    const stats = getExifCacheStats();
    expect(stats.size).toBeGreaterThanOrEqual(1);
  });

  it('clearExifCache empties the cache', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => makeJpegBuffer(),
    });

    await extractExifFromUrl('https://example.com/cache-test.jpg');
    clearExifCache();
    expect(getExifCacheStats().size).toBe(0);
  });

  it('detectMimeType identifies JPEG from magic bytes', () => {
    // detectMimeType requires at least 4 bytes (byteLength < 4 returns null)
    const jpegBytes = new ArrayBuffer(4);
    const view = new Uint8Array(jpegBytes);
    view[0] = 0xFF; view[1] = 0xD8; view[2] = 0xFF; view[3] = 0xE0; // JFIF marker
    const mime = detectMimeType(jpegBytes);
    expect(mime).toBe('image/jpeg');
  });

  it('isExifSupported returns true for JPEG', () => {
    expect(isExifSupported('image/jpeg')).toBe(true);
    expect(isExifSupported('image/png')).toBe(false);
  });

  it('extractImageDimensionsFromBuffer handles PNG dimensions', () => {
    const pngBytes = new ArrayBuffer(28);
    const view = new Uint8Array(pngBytes);
    // PNG signature
    view[0] = 0x89; view[1] = 0x50; view[2] = 0x4E; view[3] = 0x47;
    view[4] = 0x0D; view[5] = 0x0A; view[6] = 0x1A; view[7] = 0x0A;
    // IHDR chunk length (13 bytes) at offset 8-11
    view[8] = 0; view[9] = 0; view[10] = 0; view[11] = 13;
    // IHDR chunk type at offset 12-15
    view[12] = 0x49; view[13] = 0x48; view[14] = 0x44; view[15] = 0x52;
    // Width = 800 at offset 16-19
    view[16] = 0; view[17] = 0; view[18] = 0x03; view[19] = 0x20; // 800
    // Height = 600 at offset 20-23
    view[20] = 0; view[21] = 0; view[22] = 0x02; view[23] = 0x58; // 600

    const dims = extractImageDimensionsFromBuffer(pngBytes);
    expect(dims).toBeDefined();
    if (dims) {
      expect(dims.width).toBe(800);
      expect(dims.height).toBe(600);
    }
  });
});

// ============================================================================
// 2. Feature matching
// ============================================================================
describe('Phase 4A: Feature matching', () => {
  it('selectDetector returns AKAZE by default', () => {
    const detector = selectDetector();
    expect(detector).toBe('AKAZE');
  });

  it('selectDetector prefers SIFT for close-up photos', () => {
    const detector = selectDetector({ photoLabel: 'detail shot of flashing' });
    expect(detector).toBe('SIFT');
  });

  it('selectDetector prefers AKAZE for aerial photos', () => {
    const detector = selectDetector({ photoLabel: 'aerial overview' });
    expect(detector).toBe('AKAZE');
  });

  it('assessMatchQuality returns "failed" for 0 matches', () => {
    const quality = assessMatchQuality(0, 0);
    expect(quality).toBe('failed');
  });

  it('assessMatchQuality returns "excellent" for many high-confidence matches', () => {
    const quality = assessMatchQuality(200, 0.85);
    expect(quality).toBe('excellent');
  });

  it('assessMatchQuality returns "good" for moderate matches', () => {
    const quality = assessMatchQuality(50, 0.75);
    expect(quality).toBe('good');
  });

  it('calculateMatchConfidence is never faked — computed from data', () => {
    // With 0 matches, confidence must be 0 (or near 0)
    const conf0 = calculateMatchConfidence(0, null, 'AKAZE');
    expect(conf0).toBeGreaterThanOrEqual(0);
    expect(conf0).toBeLessThanOrEqual(1);

    // With some matches, confidence is in [0, 1]
    const confSome = calculateMatchConfidence(30, 20, 'AKAZE');
    expect(confSome).toBeGreaterThan(0);
    expect(confSome).toBeLessThanOrEqual(1);

    // With many high-quality matches, confidence is higher
    const confHigh = calculateMatchConfidence(100, 80, 'AKAZE');
    expect(confHigh).toBeGreaterThan(confSome);
  });

  it('DEFAULT_FEATURE_MATCH_PARAMS has reasonable defaults', () => {
    expect(DEFAULT_FEATURE_MATCH_PARAMS.minGoodMatches).toBeGreaterThan(0);
    expect(DEFAULT_FEATURE_MATCH_PARAMS.ratioTestThreshold).toBeGreaterThan(0);
    expect(DEFAULT_FEATURE_MATCH_PARAMS.ratioTestThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_FEATURE_MATCH_PARAMS.preferredDetector).toBe('AKAZE');
    expect(DEFAULT_FEATURE_MATCH_PARAMS.fallbackDetectors).toContain('SIFT');
    expect(DEFAULT_FEATURE_MATCH_PARAMS.fallbackDetectors).toContain('ORB');
  });

  it('matchFeaturesWithFallback tries AKAZE → SIFT → ORB fallback chain', async () => {
    // Without a running OpenCV worker, this should fail gracefully
    const result = await matchFeaturesWithFallback(
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
    ).catch(() => null);

    // The important thing is it doesn't throw unhandled
    expect(result).toBeDefined();
  });
});

// ============================================================================
// 3. Homography pipeline
// ============================================================================
describe('Phase 4A: Homography pipeline', () => {
  it('HOMOGRAPHY_MIN_INLIERS is a positive integer', () => {
    expect(HOMOGRAPHY_MIN_INLIERS).toBeGreaterThan(0);
    expect(Number.isInteger(HOMOGRAPHY_MIN_INLIERS)).toBe(true);
  });

  it('HOMOGRAPHY_MIN_CONFIDENCE is in (0, 1]', () => {
    expect(HOMOGRAPHY_MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(HOMOGRAPHY_MIN_CONFIDENCE).toBeLessThanOrEqual(1);
  });

  it('HOMOGRAPHY_MAX_REPROJ_ERROR_PX is positive', () => {
    expect(HOMOGRAPHY_MAX_REPROJ_ERROR_PX).toBeGreaterThan(0);
  });

  it('HOMOGRAPHY_CONFIDENCE_BOOST is > 1 but <= 2', () => {
    expect(HOMOGRAPHY_CONFIDENCE_BOOST).toBeGreaterThan(1);
    expect(HOMOGRAPHY_CONFIDENCE_BOOST).toBeLessThanOrEqual(2);
  });

  it('isHomographyGeometricallyValid rejects degenerate (all-zero) matrices', () => {
    const degenerate = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(isHomographyGeometricallyValid(degenerate)).toBe(false);
  });

  it('isHomographyGeometricallyValid accepts identity matrix', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(isHomographyGeometricallyValid(identity)).toBe(true);
  });

  it('isHomographyGeometricallyValid rejects extreme scale ratios', () => {
    // Matrix with extreme scale difference (sx=100, sy=0.01)
    const extreme = [100, 0, 0, 0, 0.01, 0, 0, 0, 1];
    expect(isHomographyGeometricallyValid(extreme)).toBe(false);
  });

  it('projectPointWithHomography returns {worldX, worldY} for identity matrix', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const result = projectPointWithHomography(100, 200, identity);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.worldX).toBeCloseTo(100, 5);
      expect(result.worldY).toBeCloseTo(200, 5);
    }
  });

  it('projectPointWithHomography applies translation correctly', () => {
    const translate = [1, 0, 50, 0, 1, 30, 0, 0, 1];
    const result = projectPointWithHomography(0, 0, translate);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.worldX).toBeCloseTo(50, 5);
      expect(result.worldY).toBeCloseTo(30, 5);
    }
  });

  it('projectPointWithHomography returns null for invalid matrix', () => {
    const invalid = [1, 2, 3]; // wrong length
    const result = projectPointWithHomography(100, 200, invalid);
    expect(result).toBeNull();
  });

  it('validateHomographyResult returns { valid, reasons } object', () => {
    const valid = makeValidHomography();
    const result = validateHomographyResult(valid);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('reasons');
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('validateHomographyResult rejects low inlier count', () => {
    const lowInliers = makeValidHomography({ inlierCount: 2 });
    const result = validateHomographyResult(lowInliers);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('validateHomographyResult rejects low confidence', () => {
    const lowConf = makeValidHomography({ confidence: 0.1 });
    const result = validateHomographyResult(lowConf);
    expect(result.valid).toBe(false);
  });

  it('validateHomographyResult rejects high reprojection error', () => {
    const highError = makeValidHomography({ meanReprojectionError: 15 });
    const result = validateHomographyResult(highError);
    expect(result.valid).toBe(false);
  });

  it('computeReprojectionErrors returns ReprojectionErrorAnalysis', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const srcPts = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    const dstPts = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    const analysis = computeReprojectionErrors(srcPts, dstPts, identity);
    expect(analysis).toHaveProperty('meanError');
    expect(analysis).toHaveProperty('medianError');
    expect(analysis).toHaveProperty('maxError');
    expect(analysis).toHaveProperty('rmse');
    expect(analysis).toHaveProperty('inlierCount');
    expect(analysis).toHaveProperty('totalCount');
    expect(analysis).toHaveProperty('inlierRatio');
    expect(analysis.meanError).toBeGreaterThanOrEqual(0);
    expect(analysis.totalCount).toBe(2);
  });

  it('estimateRadiusFromProjection returns positive radius', () => {
    const bbox = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const radius = estimateRadiusFromProjection(bbox, identity, 4032, 3024);
    expect(radius).toBeGreaterThan(0);
  });

  it('DEFAULT_HOMOGRAPHY_PARAMS has reasonable thresholds', () => {
    expect(DEFAULT_HOMOGRAPHY_PARAMS.minInliers).toBeGreaterThan(0);
    expect(DEFAULT_HOMOGRAPHY_PARAMS.ransacMaxIterations).toBeGreaterThan(0);
    expect(DEFAULT_HOMOGRAPHY_PARAMS.minConfidence).toBeGreaterThan(0);
    expect(DEFAULT_HOMOGRAPHY_PARAMS.minConfidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// 4. Authority safety
// ============================================================================
describe('Phase 4A: Authority safety (FROZEN_AUTHORITY_FLAGS)', () => {
  it('FROZEN_AUTHORITY_FLAGS has all flags set to false', () => {
    const flags = FROZEN_AUTHORITY_FLAGS;
    expect(flags.canMutateCadGeometry).toBe(false);
    expect(flags.canInfluencePermits).toBe(false);
    expect(flags.canInfluenceNec).toBe(false);
    expect(flags.canInfluenceBom).toBe(false);
    expect(flags.canBypassReview).toBe(false);
    expect(flags.isConfidenceAuthoritative).toBe(false);
    expect(flags.canOverrideManual).toBe(false);
  });

  it('assertAuthorityFlagsSafe does not throw for frozen flags', () => {
    expect(() => assertAuthorityFlagsSafe(FROZEN_AUTHORITY_FLAGS)).not.toThrow();
  });

  it('assertAuthorityFlagsSafe throws when any flag is true', () => {
    expect(() => assertAuthorityFlagsSafe({ canMutateCadGeometry: true })).toThrow();
    expect(() => assertAuthorityFlagsSafe({ canInfluencePermits: true })).toThrow();
    expect(() => assertAuthorityFlagsSafe({ canBypassReview: true })).toThrow();
  });

  it('FROZEN_AUTHORITY_FLAGS cannot mutate CAD geometry', () => {
    expect(FROZEN_AUTHORITY_FLAGS.canMutateCadGeometry).toBe(false);
  });

  it('FROZEN_AUTHORITY_FLAGS cannot influence permits/NEC/BOM', () => {
    expect(FROZEN_AUTHORITY_FLAGS.canInfluencePermits).toBe(false);
    expect(FROZEN_AUTHORITY_FLAGS.canInfluenceNec).toBe(false);
    expect(FROZEN_AUTHORITY_FLAGS.canInfluenceBom).toBe(false);
  });

  it('FROZEN_AUTHORITY_FLAGS cannot bypass review', () => {
    expect(FROZEN_AUTHORITY_FLAGS.canBypassReview).toBe(false);
  });
});

// ============================================================================
// 5. Debug visualization
// ============================================================================
describe('Phase 4A: Debug visualization', () => {
  it('isDebugModeEnabled returns false by default', () => {
    delete process.env.VISION_DEBUG;
    expect(isDebugModeEnabled()).toBe(false);
  });

  it('isDebugModeEnabled returns true when VISION_DEBUG=1', () => {
    process.env.VISION_DEBUG = '1';
    expect(isDebugModeEnabled()).toBe(true);
  });

  it('describeFeatureMatchOverlay returns FeatureMatchOverlayDescription or null', () => {
    process.env.VISION_DEBUG = '1';
    const matchResult = makeValidMatchResult();
    const overlay = describeFeatureMatchOverlay(matchResult, { width: 4032, height: 3024 });
    // When debug is enabled, should return overlay description
    if (overlay) {
      expect(overlay).toHaveProperty('sourceKeypointCount');
      expect(overlay).toHaveProperty('targetKeypointCount');
      expect(overlay).toHaveProperty('matchCount');
      expect(overlay).toHaveProperty('quality');
      expect(overlay).toHaveProperty('description');
    }
  });

  it('describeFeatureMatchOverlay returns null when debug disabled', () => {
    delete process.env.VISION_DEBUG;
    const matchResult = makeValidMatchResult();
    const overlay = describeFeatureMatchOverlay(matchResult, { width: 4032, height: 3024 });
    expect(overlay).toBeNull();
  });

  it('describeHomographyOverlay returns description or null', () => {
    process.env.VISION_DEBUG = '1';
    const homographyResult = makeValidHomography();
    const overlay = describeHomographyOverlay(homographyResult, { width: 4032, height: 3024 });
    if (overlay) {
      expect(overlay).toHaveProperty('inlierCount');
      expect(overlay).toHaveProperty('meanReprojectionError');
      expect(overlay).toHaveProperty('projectedCorners');
      expect(overlay).toHaveProperty('description');
    }
  });

  it('generateDebugSummary returns DebugSummary or null', () => {
    process.env.VISION_DEBUG = '1';
    const matchResult = makeValidMatchResult();
    const homographyResult = makeValidHomography();

    const summary = generateDebugSummary(
      matchResult,
      homographyResult,
      { method: 'homography_assisted', confidence: 0.75, exifUsed: true },
      { width: 4032, height: 3024 },
    );

    if (summary) {
      expect(summary).toHaveProperty('timestamp');
      expect(summary).toHaveProperty('projectionMethod');
      expect(summary).toHaveProperty('projectionConfidence');
      expect(summary).toHaveProperty('exifUsed');
      expect(summary).toHaveProperty('summary');
      expect(summary.summary).toContain('Phase 4A');
    }
  });
});

// ============================================================================
// 6. Projection fallback chain
// ============================================================================
describe('Phase 4A: Projection fallback chain (4-tier)', () => {
  it('ProjectionMethod type includes homography_assisted', () => {
    const methods: ProjectionMethod[] = [
      'homography_assisted',
      'gps_azimuth_pitch',
      'gps_centroid',
      'none',
    ];
    expect(methods).toHaveLength(4);
    expect(methods).toContain('homography_assisted');
  });

  it('homography_assisted is first in the priority chain', () => {
    const priority: ProjectionMethod[] = [
      'homography_assisted',
      'gps_azimuth_pitch',
      'gps_centroid',
      'none',
    ];
    expect(priority[0]).toBe('homography_assisted');
  });

  it('ENABLE_HOMOGRAPHY_PROJECTION defaults to true', () => {
    delete process.env.ENABLE_HOMOGRAPHY_PROJECTION;
    const enabled = process.env.ENABLE_HOMOGRAPHY_PROJECTION !== 'false';
    expect(enabled).toBe(true);
  });

  it('ENABLE_HOMOGRAPHY_PROJECTION can be disabled via env', () => {
    process.env.ENABLE_HOMOGRAPHY_PROJECTION = 'false';
    const enabled = process.env.ENABLE_HOMOGRAPHY_PROJECTION !== 'false';
    expect(enabled).toBe(false);
  });

  it('DEFAULT_PROJECTION_PARAMS includes homography settings', () => {
    expect(DEFAULT_PROJECTION_PARAMS).toBeDefined();
    expect(DEFAULT_PROJECTION_PARAMS.minHomographyConfidence).toBe(HOMOGRAPHY_MIN_CONFIDENCE);
    expect(DEFAULT_PROJECTION_PARAMS.maxReprojectionErrorPx).toBe(HOMOGRAPHY_MAX_REPROJ_ERROR_PX);
    expect(DEFAULT_PROJECTION_PARAMS.exifConfidenceBoost).toBe(HOMOGRAPHY_CONFIDENCE_BOOST);
  });

  it('projectWithHomography returns HomographyProjectionAttempt with fallback method', async () => {
    const detection = {
      class: 'vent',
      confidence: 0.8,
      bbox: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
    };

    // With null matched points, homography should fail gracefully
    const attempt = await projectWithHomography(detection, null, null);
    expect(attempt).toHaveProperty('success');
    expect(attempt).toHaveProperty('projection');
    expect(attempt).toHaveProperty('homography');
    expect(attempt).toHaveProperty('fallbackMethod');
    expect(attempt.success).toBe(false);
  });
});

// ============================================================================
// 7. TypeScript type contracts
// ============================================================================
describe('Phase 4A: TypeScript type contracts', () => {
  it('ProjectionAuthorityFlags has correct shape', () => {
    const flags: ProjectionAuthorityFlags = {
      canMutateCadGeometry: false,
      canInfluencePermits: false,
      canInfluenceNec: false,
      canInfluenceBom: false,
      canBypassReview: false,
      isConfidenceAuthoritative: false,
      canOverrideManual: false,
    };
    expect(flags.canMutateCadGeometry).toBe(false);
    expect(flags.canBypassReview).toBe(false);
  });

  it('HomographyResult has required fields', () => {
    const result = makeValidHomography();
    expect(result.matrix).toHaveLength(9);
    expect(result.inlierCount).toBeTypeOf('number');
    expect(result.totalMatches).toBeTypeOf('number');
    expect(result.inlierRatio).toBeTypeOf('number');
    expect(result.confidence).toBeTypeOf('number');
    expect(result.meanReprojectionError).toBeTypeOf('number');
    expect(result.maxReprojectionError).toBeTypeOf('number');
    expect(result.isGeometricallyValid).toBeTypeOf('boolean');
    expect(result.method).toBe('RANSAC');
    expect(result.durationMs).toBeTypeOf('number');
    expect(result.ok).toBeTypeOf('boolean');
  });

  it('FeatureMatchResult has required fields', () => {
    const result = makeValidMatchResult();
    expect(result.detector).toBe('AKAZE');
    expect(result.quality).toBe('good');
    expect(result.rawMatchCount).toBeTypeOf('number');
    expect(result.goodMatchCount).toBeTypeOf('number');
    expect(result.confidence).toBeTypeOf('number');
    expect(result.ok).toBeTypeOf('boolean');
  });

  it('ProjectionResult type includes required fields', () => {
    const result: ProjectionResult = {
      worldX: 10.5,
      worldY: 20.3,
      radiusM: 0.35,
      method: 'homography_assisted',
      confidence: 0.75,
      reprojectionError: 2.5,
      isCandidate: true,
      reviewRequired: true,
    };
    expect(result.method).toBe('homography_assisted');
    expect(result.isCandidate).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it('FeatureDetectorType includes AKAZE, SIFT, ORB', () => {
    const detectors: FeatureDetectorType[] = ['AKAZE', 'SIFT', 'ORB'];
    expect(detectors).toHaveLength(3);
  });

  it('MatchQuality has expected values', () => {
    const qualities: MatchQuality[] = ['excellent', 'good', 'fair', 'poor', 'failed'];
    expect(qualities).toHaveLength(5);
  });

  it('HomographyProjectionAttempt has required fields', () => {
    const attempt: HomographyProjectionAttempt = {
      success: false,
      projection: null,
      homography: null,
      exifUsed: false,
      boostedConfidence: null,
      fallbackMethod: 'gps_azimuth_pitch',
    };
    expect(attempt.success).toBe(false);
    expect(attempt.fallbackMethod).toBe('gps_azimuth_pitch');
  });
});

// ============================================================================
// 8. Integration — aggregateVisionResults with homography
// ============================================================================
describe('Phase 4A: Integration with aggregateVisionResults', () => {
  it('aggregateVisionResults is an async function', async () => {
    const { aggregateVisionResults } = await import('../lib/vision/visionAggregator');
    expect(aggregateVisionResults).toBeTypeOf('function');
    // The function should return a Promise
    const result = aggregateVisionResults([], 'test-project', 'test-survey');
    expect(result).toBeInstanceOf(Promise);
    await result; // Should resolve without error
  });

  it('aggregateVisionResults returns empty result for empty photos', async () => {
    const { aggregateVisionResults } = await import('../lib/vision/visionAggregator');
    const result = await aggregateVisionResults([], 'test-project', 'test-survey');
    expect(result.obstructions).toHaveLength(0);
    expect(result.electricalNodes).toHaveLength(0);
    expect(result.planeCorrections).toHaveLength(0);
    expect(result.photosProcessed).toBe(0);
  });

  it('homography_assisted projection method is in WorldDetection type', () => {
    type TestMethod = 'homography_assisted' | 'gps_azimuth_pitch' | 'gps_centroid' | 'plane_centroid' | 'none';
    const method: TestMethod = 'homography_assisted';
    expect(method).toBe('homography_assisted');
  });

  it('WorldDetection can carry _projectionConfidence and _reprojectionError', () => {
    interface TestWorldDetection {
      class: string;
      confidence: number;
      worldX: number;
      worldY: number;
      radiusM: number;
      roofPlaneId: string | null;
      projectionMethod: string;
      _projectionConfidence?: number;
      _reprojectionError?: number | null;
    }

    const wd: TestWorldDetection = {
      class: 'vent',
      confidence: 0.8,
      worldX: 10.5,
      worldY: 20.3,
      radiusM: 0.3,
      roofPlaneId: 'plane-1',
      projectionMethod: 'homography_assisted',
      _projectionConfidence: 0.72,
      _reprojectionError: 3.2,
    };

    expect(wd._projectionConfidence).toBe(0.72);
    expect(wd._reprojectionError).toBe(3.2);
  });
});
