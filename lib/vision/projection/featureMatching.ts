// ============================================================================
// lib/vision/projection/featureMatching.ts — Feature Matching Orchestration
//
// Orchestrates feature detection and matching between photo pairs
// for homography estimation. Delegates actual computation to the Python
// OpenCV worker (running on Render at OPENCV_WORKER_URL).
//
// MATCHING STRATEGY:
//   1. Try AKAZE (default) — robust to illumination/rotation changes
//   2. Fall back to SIFT — scale-invariant, good for textured scenes
//   3. Fall back to ORB — fast but less distinctive, last resort
//
// MATCH QUALITY ASSESSMENT:
//   excellent:  goodMatchCount >= 50, confidence >= 0.85
//   good:       goodMatchCount >= 30, confidence >= 0.70
//   fair:       goodMatchCount >= 15, confidence >= 0.50
//   poor:       goodMatchCount >= 5,  confidence >= 0.25
//   failed:     goodMatchCount < 5 or confidence < 0.25
//
// ARCHITECTURE:
//   featureMatching.ts (this file, TypeScript orchestration)
//     → OPENCV_WORKER_URL (Python worker with cv2.AKAZE/SIFT/ORB)
//     → homographyPipeline.ts (consumes FeatureMatchResult)
//
// SAFETY:
//   - Never throws — returns failed FeatureMatchResult on errors
//   - All network requests have timeouts (10s)
//   - Graceful degradation through detector fallback chain
//   - Confidence is NEVER faked — always computed from actual match data
// ============================================================================

import {
  type FeatureDetectorType,
  type FeatureMatchResult,
  type MatchQuality,
  DEFAULT_FEATURE_MATCH_PARAMS,
} from './types';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Default OpenCV worker URL */
const DEFAULT_OPENCV_WORKER_URL = 'https://solarpro.onrender.com';

/** Request timeout for worker calls (10 seconds) */
const WORKER_TIMEOUT_MS = 10_000;

/** Minimum good matches for any projection attempt */
const MIN_MATCHES_FOR_PROJECTION = 8;

// ─── Worker Communication ─────────────────────────────────────────────────────

/** Request payload for the feature matching endpoint */
interface FeatureMatchRequest {
  /** URL of the source image */
  image1Url: string;
  /** URL of the target image */
  image2Url: string;
  /** Feature detector to use */
  detector: FeatureDetectorType;
  /** Ratio test threshold (Lowe's ratio) */
  ratioTestThreshold: number;
  /** Maximum match distance */
  maxMatchDistance: number;
}

/** Response from the Python OpenCV worker feature matching endpoint */
interface FeatureMatchWorkerResponse {
  success: boolean;
  /** Number of raw matches */
  rawMatchCount?: number;
  /** Number of good matches after ratio test */
  goodMatchCount?: number;
  /** Inlier count from RANSAC */
  inlierCount?: number;
  /** Feature detector used */
  detector?: FeatureDetectorType;
  /** Processing time on the worker (ms) */
  workerDurationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Matched keypoint pairs (normalized 0–1 coordinates) for homography */
  matchedPoints?: {
    source: Array<{ x: number; y: number }>;
    target: Array<{ x: number; y: number }>;
  };
}

/**
 * Call the Python OpenCV worker for feature matching.
 */
async function callWorkerFeatureMatch(
  request: FeatureMatchRequest,
  workerUrl: string,
): Promise<FeatureMatchWorkerResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  try {
    const response = await fetch(`${workerUrl}/vision/match-features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Worker returned HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return data as FeatureMatchWorkerResponse;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: `Worker request timed out after ${WORKER_TIMEOUT_MS}ms` };
    }
    return { success: false, error: `Worker request failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Match Quality Assessment ─────────────────────────────────────────────────

/**
 * Assess the quality of a feature matching result.
 *
 * Quality tiers are based on both match count and confidence,
 * ensuring that a small number of high-quality matches can still
 * be assessed as "fair" or better.
 */
export function assessMatchQuality(goodMatchCount: number, confidence: number): MatchQuality {
  if (goodMatchCount >= 50 && confidence >= 0.85) return 'excellent';
  if (goodMatchCount >= 30 && confidence >= 0.70) return 'good';
  if (goodMatchCount >= 15 && confidence >= 0.50) return 'fair';
  if (goodMatchCount >= 5 && confidence >= 0.25) return 'poor';
  return 'failed';
}

/**
 * Calculate confidence from match statistics.
 *
 * Confidence is derived from:
 *   - Good match count (more matches = higher confidence, diminishing returns)
 *   - Inlier ratio (higher ratio = more geometrically consistent)
 *   - Detector quality (AKAZE > SIFT > ORB for this use case)
 *
 * CONFIDENCE IS NEVER FAKED — always computed from actual data.
 */
export function calculateMatchConfidence(
  goodMatchCount: number,
  inlierCount: number | null,
  detector: FeatureDetectorType,
): number {
  // Base confidence from match count (logarithmic scaling, diminishing returns)
  const countConf = Math.min(1.0, Math.log2(goodMatchCount + 1) / Math.log2(51));

  // Inlier ratio confidence
  let inlierConf = 0.5; // default if no inlier data
  if (inlierCount !== null && goodMatchCount > 0) {
    const ratio = inlierCount / goodMatchCount;
    inlierConf = Math.pow(ratio, 0.5); // square root to reduce harshness
  }

  // Detector quality factor
  const detectorFactor: Record<FeatureDetectorType, number> = {
    AKAZE: 1.0,
    SIFT: 0.95,
    ORB: 0.85,
  };

  // Weighted combination
  const confidence = countConf * 0.4 + inlierConf * 0.4 + (detectorFactor[detector] ?? 0.85) * 0.2;

  return Math.min(1.0, Math.max(0.0, confidence));
}

/**
 * Select the best feature detector based on context.
 *
 * For roof photos with texture (shingles, panels), AKAZE is preferred.
 * For low-contrast or overexposed photos, SIFT may perform better.
 * ORB is the fast fallback.
 */
export function selectDetector(context?: {
  photoLabel?: string | null;
  imageWidth?: number;
  imageHeight?: number;
}): FeatureDetectorType {
  // If photo is a close-up or detail shot, prefer SIFT for better scale handling
  if (context?.photoLabel) {
    const label = context.photoLabel.toLowerCase();
    if (label.includes('detail') || label.includes('close')) return 'SIFT';
    if (label.includes('overview') || label.includes('aerial')) return 'AKAZE';
  }

  // For very large images, ORB might be faster (but less reliable)
  if (context?.imageWidth && context.imageWidth > 4000) return 'AKAZE';

  return DEFAULT_FEATURE_MATCH_PARAMS.preferredDetector;
}

// ─── Main Feature Matching API ────────────────────────────────────────────────

/**
 * Match features between two images using the specified detector.
 *
 * @param image1Url - URL of the first image
 * @param image2Url - URL of the second image
 * @param options - Matching options
 * @returns Feature match result with quality assessment
 *
 * SAFETY: Never throws. Returns failed FeatureMatchResult on any error.
 */
export async function matchFeatures(
  image1Url: string,
  image2Url: string,
  options?: {
    detector?: FeatureDetectorType;
    ratioTestThreshold?: number;
    maxMatchDistance?: number;
    workerUrl?: string;
  },
): Promise<FeatureMatchResult> {
  const startMs = Date.now();
  const detector = options?.detector ?? DEFAULT_FEATURE_MATCH_PARAMS.preferredDetector;
  const ratioThreshold = options?.ratioTestThreshold ?? DEFAULT_FEATURE_MATCH_PARAMS.ratioTestThreshold;
  const maxDistance = options?.maxMatchDistance ?? DEFAULT_FEATURE_MATCH_PARAMS.maxMatchDistance;
  const workerUrl = options?.workerUrl ?? getWorkerUrl();

  try {
    const request: FeatureMatchRequest = {
      image1Url,
      image2Url,
      detector,
      ratioTestThreshold: ratioThreshold,
      maxMatchDistance: maxDistance,
    };

    const response = await callWorkerFeatureMatch(request, workerUrl);

    if (!response.success || response.goodMatchCount === undefined) {
      return {
        rawMatchCount: 0,
        goodMatchCount: 0,
        quality: 'failed',
        confidence: 0.0,
        detector,
        durationMs: Date.now() - startMs,
        ok: false,
        error: response.error ?? 'Worker returned unsuccessful response',
      };
    }

    const goodMatchCount = response.goodMatchCount;
    const rawMatchCount = response.rawMatchCount ?? goodMatchCount;
    const inlierCount = response.inlierCount ?? null;

    const confidence = calculateMatchConfidence(goodMatchCount, inlierCount, detector);
    const quality = assessMatchQuality(goodMatchCount, confidence);

    return {
      rawMatchCount,
      goodMatchCount,
      quality,
      confidence,
      detector,
      durationMs: Date.now() - startMs,
      ok: quality !== 'failed',
    };
  } catch (err) {
    return {
      rawMatchCount: 0,
      goodMatchCount: 0,
      quality: 'failed',
      confidence: 0.0,
      detector,
      durationMs: Date.now() - startMs,
      ok: false,
      error: `Feature matching failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Match features with automatic fallback through the detector chain.
 *
 * Tries AKAZE → SIFT → ORB in sequence, returning the first
 * result that meets minimum quality thresholds.
 *
 * This is the recommended entry point for homography pipeline consumers.
 */
export async function matchFeaturesWithFallback(
  image1Url: string,
  image2Url: string,
  options?: {
    minGoodMatches?: number;
    minConfidence?: number;
    workerUrl?: string;
    ratioTestThreshold?: number;
  },
): Promise<FeatureMatchResult> {
  const minGoodMatches = options?.minGoodMatches ?? MIN_MATCHES_FOR_PROJECTION;
  const minConfidence = options?.minConfidence ?? 0.25;
  const workerUrl = options?.workerUrl ?? getWorkerUrl();

  const detectors: FeatureDetectorType[] = [
    DEFAULT_FEATURE_MATCH_PARAMS.preferredDetector,
    ...DEFAULT_FEATURE_MATCH_PARAMS.fallbackDetectors,
  ];

  let bestResult: FeatureMatchResult | null = null;

  for (const detector of detectors) {
    const result = await matchFeatures(image1Url, image2Url, {
      detector,
      workerUrl,
      ratioTestThreshold: options?.ratioTestThreshold,
    });

    // Track best result (even if below threshold)
    if (!bestResult || result.confidence > bestResult.confidence) {
      bestResult = result;
    }

    // If we meet minimum requirements, return immediately
    if (result.goodMatchCount >= minGoodMatches && result.confidence >= minConfidence) {
      return result;
    }
  }

  // Return best result even if it didn't meet thresholds
  return bestResult ?? {
    rawMatchCount: 0,
    goodMatchCount: 0,
    quality: 'failed',
    confidence: 0.0,
    detector: 'AKAZE',
    durationMs: 0,
    ok: false,
    error: 'All feature detectors failed to produce matches',
  };
}

// ─── Worker URL Resolution ────────────────────────────────────────────────────

/**
 * Get the OpenCV worker URL from environment or default.
 */
function getWorkerUrl(): string {
  return process.env.OPENCV_WORKER_URL ?? process.env.VISION_SERVICE_URL ?? DEFAULT_OPENCV_WORKER_URL;
}

// ─── Batch Matching ────────────────────────────────────────────────────────────

/** Result of matching a photo against multiple reference images */
export interface BatchMatchResult {
  /** Source photo URL */
  sourceUrl: string;
  /** Match results for each target, keyed by target URL */
  matches: Map<string, FeatureMatchResult>;
  /** Best matching target URL */
  bestMatchUrl: string | null;
  /** Best match result */
  bestMatch: FeatureMatchResult | null;
}

/**
 * Match a source image against multiple target images.
 * Returns results for all targets plus the best match.
 */
export async function matchAgainstMultiple(
  sourceUrl: string,
  targetUrls: string[],
  options?: {
    minGoodMatches?: number;
    minConfidence?: number;
    workerUrl?: string;
    concurrency?: number;
  },
): Promise<BatchMatchResult> {
  const concurrency = options?.concurrency ?? 3;
  const matches = new Map<string, FeatureMatchResult>();

  // Process targets in batches
  for (let i = 0; i < targetUrls.length; i += concurrency) {
    const batch = targetUrls.slice(i, i + concurrency);
    const promises = batch.map(async (targetUrl) => {
      const result = await matchFeaturesWithFallback(sourceUrl, targetUrl, options);
      return { targetUrl, result };
    });

    const batchResults = await Promise.allSettled(promises);
    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        matches.set(settled.value.targetUrl, settled.value.result);
      }
    }
  }

  // Find best match
  let bestMatchUrl: string | null = null;
  let bestMatch: FeatureMatchResult | null = null;

  for (const [url, result] of matches) {
    if (!bestMatch || result.confidence > bestMatch.confidence) {
      bestMatchUrl = url;
      bestMatch = result;
    }
  }

  return { sourceUrl, matches, bestMatchUrl, bestMatch };
}
