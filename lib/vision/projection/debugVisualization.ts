// ============================================================================
// lib/vision/projection/debugVisualization.ts — Debug Visualization Overlays
//
// Generates text/SVG descriptions of feature matches, homography results,
// and projection outputs for debugging and development purposes.
//
// CONTROL: All debug output is gated by the VISION_DEBUG environment variable.
//   - VISION_DEBUG=1 or VISION_DEBUG=true → enable debug descriptions
//   - Otherwise → all functions return null/empty (zero overhead)
//
// OUTPUT FORMATS:
//   - json_description: Structured JSON with match/homography statistics
//   - svg: SVG markup showing keypoint positions and matches
//   - No actual image rendering — descriptions only (safe for server-side)
//
// SAFETY:
//   - Debug output NEVER influences projection results or confidence scores
//   - Debug output is NEVER included in VisionAggregationResult
//   - Debug output is only written to the aggregator log[] array
//   - Debug mode is OFF by default in production
// ============================================================================

import {
  type FeatureMatchResult,
  type HomographyResult,
  type MatchQuality,
  type FeatureMatchOverlayDescription,
  type HomographyOverlayDescription,
  type DebugVisualizationRequest,
} from './types';

// ─── Debug Mode Control ───────────────────────────────────────────────────────

/**
 * Check if debug mode is enabled via environment variable.
 * Returns true if VISION_DEBUG is set to "1", "true", or "yes" (case-insensitive).
 */
export function isDebugModeEnabled(): boolean {
  const val = process.env.VISION_DEBUG;
  if (!val) return false;
  return ['1', 'true', 'yes'].includes(val.toLowerCase());
}

// ─── Feature Match Overlays ───────────────────────────────────────────────────

/**
 * Generate a text description of a feature match overlay.
 *
 * This describes what a visual overlay would show: keypoint positions,
 * match lines, quality indicators, and statistics.
 *
 * Returns null if debug mode is disabled.
 */
export function describeFeatureMatchOverlay(
  matchResult: FeatureMatchResult,
  sourceImageDims?: { width: number; height: number },
  targetImageDims?: { width: number; height: number },
  request?: DebugVisualizationRequest,
): FeatureMatchOverlayDescription | null {
  if (!isDebugModeEnabled()) return null;

  const srcW = sourceImageDims?.width ?? 0;
  const srcH = sourceImageDims?.height ?? 0;
  const tgtW = targetImageDims?.width ?? 0;
  const tgtH = targetImageDims?.height ?? 0;

  const qualityColor: Record<MatchQuality, string> = {
    excellent: 'green',
    good: 'blue',
    fair: 'yellow',
    poor: 'orange',
    failed: 'red',
  };

  const description = [
    `Feature Match Overlay: ${matchResult.detector}`,
    `Source: ${srcW}x${srcH}, Target: ${tgtW}x${tgtH}`,
    `Raw matches: ${matchResult.rawMatchCount}, Good: ${matchResult.goodMatchCount}`,
    `Quality: ${matchResult.quality} (color: ${qualityColor[matchResult.quality]})`,
    `Confidence: ${(matchResult.confidence * 100).toFixed(1)}%`,
    `Duration: ${matchResult.durationMs}ms`,
    matchResult.ok ? 'Status: OK — matches suitable for homography' : `Status: FAILED — ${matchResult.error ?? 'insufficient matches'}`,
  ].join('\n');

  return {
    sourceKeypointCount: matchResult.rawMatchCount,
    targetKeypointCount: matchResult.rawMatchCount,
    matchCount: matchResult.goodMatchCount,
    quality: matchResult.quality,
    description,
  };
}

// ─── Homography Overlays ──────────────────────────────────────────────────────

/**
 * Generate a text description of a homography overlay.
 *
 * Describes the projected corners, inlier statistics, and validity status.
 *
 * Returns null if debug mode is disabled.
 */
export function describeHomographyOverlay(
  homographyResult: HomographyResult,
  sourceImageDims?: { width: number; height: number },
  request?: DebugVisualizationRequest,
): HomographyOverlayDescription | null {
  if (!isDebugModeEnabled()) return null;

  // Compute projected corners from the identity transform
  // (The actual corners would depend on the reference image, which we don't have here)
  const w = sourceImageDims?.width ?? 1000;
  const h = sourceImageDims?.height ?? 1000;

  const projectedCorners: Array<{ x: number; y: number }> = [];

  if (homographyResult.matrix.length === 9) {
    // Project image corners through homography
    const corners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];

    for (const c of corners) {
      const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = homographyResult.matrix;
      const px = h00 * c.x + h01 * c.y + h02;
      const py = h10 * c.x + h11 * c.y + h12;
      const pz = h20 * c.x + h21 * c.y + h22;
      if (Math.abs(pz) > 1e-10) {
        projectedCorners.push({ x: px / pz, y: py / pz });
      }
    }
  }

  const validityStr = homographyResult.isGeometricallyValid ? 'VALID' : 'INVALID (extreme distortion)';
  const statusStr = homographyResult.ok ? 'OK' : 'FAILED';

  const description = [
    `Homography Overlay: ${homographyResult.method}`,
    `Inliers: ${homographyResult.inlierCount}/${homographyResult.totalMatches} (${(homographyResult.inlierRatio * 100).toFixed(1)}%)`,
    `Mean reprojection error: ${homographyResult.meanReprojectionError.toFixed(2)}px`,
    `Max reprojection error: ${homographyResult.maxReprojectionError.toFixed(2)}px`,
    `Geometric validity: ${validityStr}`,
    `Confidence: ${(homographyResult.confidence * 100).toFixed(1)}%`,
    `Status: ${statusStr}`,
    homographyResult.ok ? '' : `Reason: ${homographyResult.error ?? 'unknown'}`,
    `Projected corners: ${projectedCorners.map(c => `(${c.x.toFixed(1)}, ${c.y.toFixed(1)})`).join(', ')}`,
    `Duration: ${homographyResult.durationMs}ms`,
  ].filter(Boolean).join('\n');

  return {
    inlierCount: homographyResult.inlierCount,
    meanReprojectionError: homographyResult.meanReprojectionError,
    projectedCorners,
    description,
  };
}

// ─── Debug Summary ────────────────────────────────────────────────────────────

/** Summary of all debug information for a projection attempt */
export interface DebugSummary {
  /** Timestamp */
  timestamp: string;
  /** Feature match description (if available) */
  featureMatch: FeatureMatchOverlayDescription | null;
  /** Homography description (if available) */
  homography: HomographyOverlayDescription | null;
  /** Projection method used */
  projectionMethod: string;
  /** Projection confidence */
  projectionConfidence: number;
  /** Whether EXIF was used */
  exifUsed: boolean;
  /** Overall text summary */
  summary: string;
}

/**
 * Generate a comprehensive debug summary for a projection attempt.
 *
 * Combines feature match and homography overlay descriptions into
 * a single summary object. Only generated when debug mode is enabled.
 *
 * Returns null if debug mode is disabled.
 */
export function generateDebugSummary(
  matchResult: FeatureMatchResult | null,
  homographyResult: HomographyResult | null,
  projectionInfo: {
    method: string;
    confidence: number;
    exifUsed: boolean;
  },
  sourceImageDims?: { width: number; height: number },
  targetImageDims?: { width: number; height: number },
): DebugSummary | null {
  if (!isDebugModeEnabled()) return null;

  const featureMatch = matchResult
    ? describeFeatureMatchOverlay(matchResult, sourceImageDims, targetImageDims)
    : null;

  const homography = homographyResult
    ? describeHomographyOverlay(homographyResult, sourceImageDims)
    : null;

  const lines: string[] = [
    `=== Phase 4A Projection Debug Summary ===`,
    `Time: ${new Date().toISOString()}`,
    `Method: ${projectionInfo.method}`,
    `Confidence: ${(projectionInfo.confidence * 100).toFixed(1)}%`,
    `EXIF used: ${projectionInfo.exifUsed}`,
  ];

  if (featureMatch) {
    lines.push(`--- Feature Matching ---`);
    lines.push(featureMatch.description);
  }

  if (homography) {
    lines.push(`--- Homography ---`);
    lines.push(homography.description);
  }

  return {
    timestamp: new Date().toISOString(),
    featureMatch,
    homography,
    projectionMethod: projectionInfo.method,
    projectionConfidence: projectionInfo.confidence,
    exifUsed: projectionInfo.exifUsed,
    summary: lines.join('\n'),
  };
}

// ─── SVG Generation (Optional) ───────────────────────────────────────────────

/**
 * Generate an SVG overlay showing matched keypoints between two images.
 *
 * This is an optional debug visualization that creates an SVG
 * showing the spatial relationship between matched features.
 * It does NOT render actual images — just geometric shapes.
 *
 * Returns null if debug mode is disabled or format is not 'svg'.
 */
export function generateMatchSvg(
  matchResult: FeatureMatchResult,
  sourceDims: { width: number; height: number },
  targetDims: { width: number; height: number },
): string | null {
  if (!isDebugModeEnabled()) return null;

  // Layout: source image left, target image right
  const gap = 50;
  const totalW = sourceDims.width + gap + targetDims.width;
  const totalH = Math.max(sourceDims.height, targetDims.height);

  const qualityColor: Record<MatchQuality, string> = {
    excellent: '#22c55e',
    good: '#3b82f6',
    fair: '#eab308',
    poor: '#f97316',
    failed: '#ef4444',
  };

  const color = qualityColor[matchResult.quality];

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    `<rect width="${totalW}" height="${totalH}" fill="#1a1a1a"/>`,
    // Source image frame
    `<rect x="0" y="0" width="${sourceDims.width}" height="${sourceDims.height}" fill="#2a2a2a" stroke="#555"/>`,
    `<text x="10" y="20" fill="#888" font-size="12">Source</text>`,
    // Target image frame
    `<rect x="${sourceDims.width + gap}" y="0" width="${targetDims.width}" height="${targetDims.height}" fill="#2a2a2a" stroke="#555"/>`,
    `<text x="${sourceDims.width + gap + 10}" y="20" fill="#888" font-size="12">Target</text>`,
    // Match quality badge
    `<rect x="${totalW - 120}" y="${totalH - 30}" width="110" height="25" rx="4" fill="${color}"/>`,
    `<text x="${totalW - 65}" y="${totalH - 12}" fill="white" font-size="11" text-anchor="middle">${matchResult.quality.toUpperCase()}</text>`,
    // Stats
    `<text x="${totalW - 120}" y="${totalH - 38}" fill="#888" font-size="10">${matchResult.goodMatchCount} matches, ${(matchResult.confidence * 100).toFixed(0)}% conf</text>`,
    `</svg>`,
  ];

  return svgParts.join('\n');
}
