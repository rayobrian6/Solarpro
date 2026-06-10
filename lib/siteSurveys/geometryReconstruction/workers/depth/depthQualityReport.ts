/**
 * Depth quality report — structured health assessment for depth data.
 *
 * Provides a quality report that downstream consumers (plane extraction,
 * multi-view fusion, UI) can use to decide whether depth data is trustworthy
 * enough for their use case.
 *
 * The report includes:
 * - Overall quality grade (A/B/C/D/F)
 * - Depth range quality (is the range well-distributed?)
 * - Sky detection quality (is sky separation clear?)
 * - Noise indicators (streaking, flat regions, edge artifacts)
 * - Specific recommendations for the consumer
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { DepthMap } from '../../types';
import {
  decodeDepthMap,
  computeDepthStats,
} from './depthMapDecode';
import type { DepthStatistics } from './depthMapDecode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepthQualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DepthQualityReport {
  /** Overall quality grade A (best) to F (worst) */
  grade: DepthQualityGrade;
  /** Numeric score 0-100 mapping to grade (A≥80, B≥60, C≥40, D≥20, F<20) */
  score: number;
  /** Whether the depth data came from MiDaS (true) or heuristic (false) */
  usedMidas: boolean;
  /** Confidence value from the depth worker (0-100) */
  confidence: number;
  /** Computed statistics on the depth grid */
  statistics: DepthStatistics;
  /** Individual quality dimension scores (0-100 each) */
  dimensions: DepthQualityDimensions;
  /** Human-readable summary */
  summary: string;
  /** Specific recommendations for downstream consumers */
  recommendations: string[];
  /** Authority envelope — this report is review-only */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
  };
}

export interface DepthQualityDimensions {
  /** Is the depth range well-distributed (not all one value)? */
  rangeQuality: number;
  /** Is sky separation clear (bimodal distribution)? */
  skySeparationQuality: number;
  /** Are there flat/noisy regions that suggest poor estimation? */
  noiseQuality: number;
  /** Is the overall confidence high enough for use? */
  confidenceQuality: number;
  /** Are there enough non-trivial depth values for downstream use? */
  coverageQuality: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRADE_THRESHOLDS: [DepthQualityGrade, number][] = [
  ['A', 80],
  ['B', 60],
  ['C', 40],
  ['D', 20],
  ['F', 0],
];

/** Grade rank for comparison: lower rank = better grade */
const GRADE_RANK: Record<DepthQualityGrade, number> = {
  'A': 0,
  'B': 1,
  'C': 2,
  'D': 3,
  'F': 4,
};

const REVIEW_ONLY_AUTHORITY = {
  reviewOnly: true as const,
  nonAuthoritative: true as const,
  cadMutationAllowed: false as const,
  permitGenerationAllowed: false as const,
  bomMutationAllowed: false as const,
};

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): DepthQualityGrade {
  for (const [grade, threshold] of GRADE_THRESHOLDS) {
    if (score >= threshold) return grade;
  }
  return 'F';
}

/**
 * Score the depth range quality.
 *
 * A good depth map has values spread across a meaningful range.
 * If nearly all values are the same, the range quality drops.
 *
 * Scoring:
 * - range >= 0.5: 100 (excellent spread)
 * - range >= 0.3: 80
 * - range >= 0.15: 60
 * - range >= 0.05: 40
 * - range < 0.05: 10 (nearly flat — unreliable)
 */
function scoreRangeQuality(stats: DepthStatistics): number {
  const range = stats.max - stats.min;
  if (range >= 0.5) return 100;
  if (range >= 0.3) return 80;
  if (range >= 0.15) return 60;
  if (range >= 0.05) return 40;
  return 10;
}

/**
 * Score the sky separation quality.
 *
 * A good outdoor depth map has a clear bimodal distribution:
 * sky (far, high values) vs ground/objects (near, low values).
 * We check for nearOneFraction (sky in our convention) and
 * nearZeroFraction (ground/objects).
 *
 * Scoring:
 * - Both sky (>5%) and ground (>5%) detected: 100
 * - Sky detected (>5%) but ground minimal: 70
 * - Ground detected (>5%) but sky minimal: 60
 * - Neither detected (uniform): 20
 */
function scoreSkySeparation(stats: DepthStatistics): number {
  const hasSky = stats.nearOneFraction > 0.05;
  const hasGround = stats.nearZeroFraction > 0.05;

  if (hasSky && hasGround) return 100;
  if (hasSky) return 70;
  if (hasGround) return 60;
  return 20;
}

/**
 * Score the noise quality (inverted — less noise = higher score).
 *
 * Indicators of noise or poor quality:
 * - Very high nearZeroFraction in MiDaS raw (>30%): suggests inversion
 *   artifacts or model failure
 * - Very small range (<0.05): nearly flat depth, no useful information
 * - Extreme outliers: values outside [0,1] after normalization
 *
 * Scoring:
 * - Range >= 0.15 and no extreme outliers: 100
 * - Range >= 0.05: 70
 * - Range < 0.05: 30
 * - Values outside [0,1] in final grid: -20 penalty
 */
function scoreNoiseQuality(stats: DepthStatistics, grid: Float32Array): number {
  let score = 100;
  const range = stats.max - stats.min;

  if (range < 0.05) score = 30;
  else if (range < 0.15) score = 70;

  // Check for out-of-range values in the final grid
  let outOfRange = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < -0.1 || grid[i] > 1.1) outOfRange++;
  }
  if (outOfRange > 0) {
    const fraction = outOfRange / grid.length;
    score -= Math.min(50, Math.round(fraction * 500)); // up to 50 point penalty
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score the confidence quality based on the depth worker's confidence.
 *
 * Scoring:
 * - confidence >= 75: 100
 * - confidence >= 60: 80
 * - confidence >= 40: 60
 * - confidence >= 20: 40
 * - confidence < 20: 20
 */
function scoreConfidenceQuality(confidence: number): number {
  if (confidence >= 75) return 100;
  if (confidence >= 60) return 80;
  if (confidence >= 40) return 60;
  if (confidence >= 20) return 40;
  return 20;
}

/**
 * Score the coverage quality — are there enough non-trivial depth values?
 *
 * A good depth map has most pixels with meaningful (non-zero, non-one) values.
 * If most pixels are at the extremes, coverage is poor.
 *
 * Scoring:
 * - mid-range fraction (>70% of pixels in [0.05, 0.95]): 100
 * - mid-range fraction (>50%): 80
 * - mid-range fraction (>30%): 60
 * - mid-range fraction (>10%): 40
 * - mid-range fraction (<10%): 15
 */
function scoreCoverageQuality(stats: DepthStatistics): number {
  const midFraction = 1 - stats.nearZeroFraction - stats.nearOneFraction;
  if (midFraction > 0.70) return 100;
  if (midFraction > 0.50) return 80;
  if (midFraction > 0.30) return 60;
  if (midFraction > 0.10) return 40;
  return 15;
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

function generateRecommendations(
  grade: DepthQualityGrade,
  dimensions: DepthQualityDimensions,
  usedMidas: boolean,
): string[] {
  const recs: string[] = [];

  if (GRADE_RANK[grade] >= GRADE_RANK['F']) {
    recs.push('Depth data is unreliable — do not use for geometry estimation.');
    recs.push('Consider re-running with a different source photo or enabling MiDaS if not active.');
  }

  if (GRADE_RANK[grade] >= GRADE_RANK['D'] && GRADE_RANK[grade] < GRADE_RANK['F']) {
    recs.push('Depth data has significant quality issues — use with extreme caution.');
  }

  if (dimensions.rangeQuality < 50) {
    recs.push('Depth range is very narrow — depth ordering may be unreliable for plane separation.');
  }

  if (dimensions.skySeparationQuality < 50) {
    recs.push('Sky/ground separation is unclear — roof boundary detection may be inaccurate.');
  }

  if (dimensions.noiseQuality < 50) {
    recs.push('Depth data shows noise or artifacts — consider smoothing before use.');
  }

  if (dimensions.coverageQuality < 50) {
    recs.push('Depth coverage is sparse — large regions lack meaningful depth variation.');
  }

  if (!usedMidas && GRADE_RANK[grade] > GRADE_RANK['A']) {
    recs.push('Heuristic depth estimation was used — upgrading to MiDaS would likely improve quality.');
  }

  if (usedMidas && GRADE_RANK[grade] > GRADE_RANK['A']) {
    recs.push('MiDaS depth estimation produced low-quality results — the source image may be unsuitable (too dark, blurry, or occluded).');
  }

  if (recs.length === 0) {
    recs.push('Depth data quality is acceptable for downstream consumption.');
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

function generateSummary(
  grade: DepthQualityGrade,
  score: number,
  usedMidas: boolean,
  stats: DepthStatistics,
  dimensions: DepthQualityDimensions,
): string {
  const source = usedMidas ? 'MiDaS/DPT model' : 'heuristic estimation';
  const rangeDesc = dimensions.rangeQuality >= 80 ? 'good range' :
    dimensions.rangeQuality >= 50 ? 'moderate range' : 'narrow range';
  const skyDesc = dimensions.skySeparationQuality >= 80 ? 'clear sky separation' :
    dimensions.skySeparationQuality >= 50 ? 'partial sky separation' : 'unclear sky separation';

  return `Depth quality grade ${grade} (score ${score}/100) from ${source}. ` +
    `Depth ${rangeDesc} (${stats.min.toFixed(3)}–${stats.max.toFixed(3)}), ` +
    `${skyDesc}. ` +
    `${stats.totalPixels} pixels assessed.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Generate a depth quality report for a DepthMap artifact.
 *
 * This assesses the quality of depth data across five dimensions:
 * 1. Range quality — is the depth well-distributed?
 * 2. Sky separation — is there clear sky/ground bimodality?
 * 3. Noise quality — are there artifacts or flat regions?
 * 4. Confidence quality — is the worker confidence high?
 * 5. Coverage quality — are most pixels meaningful?
 *
 * The overall score is a weighted average, and the grade maps from score.
 *
 * @param depthMap - The DepthMap artifact to assess
 * @param usedMidas - Whether MiDaS was used (from DepthWorkerOutput.usedMidas)
 * @param confidence - The depth worker's confidence value (0-100)
 * @returns A structured quality report
 */
export function generateDepthQualityReport(
  depthMap: DepthMap,
  usedMidas: boolean,
  confidence: number,
): DepthQualityReport {
  const grid = decodeDepthMap(depthMap);
  const stats = computeDepthStats(grid);

  const dimensions: DepthQualityDimensions = {
    rangeQuality: scoreRangeQuality(stats),
    skySeparationQuality: scoreSkySeparation(stats),
    noiseQuality: scoreNoiseQuality(stats, grid),
    confidenceQuality: scoreConfidenceQuality(confidence),
    coverageQuality: scoreCoverageQuality(stats),
  };

  // Weighted average: confidence 25%, range 25%, sky 20%, noise 15%, coverage 15%
  const score = Math.round(
    dimensions.confidenceQuality * 0.25 +
    dimensions.rangeQuality * 0.25 +
    dimensions.skySeparationQuality * 0.20 +
    dimensions.noiseQuality * 0.15 +
    dimensions.coverageQuality * 0.15,
  );

  const grade = scoreToGrade(score);
  const recommendations = generateRecommendations(grade, dimensions, usedMidas);
  const summary = generateSummary(grade, score, usedMidas, stats, dimensions);

  return {
    grade,
    score,
    usedMidas,
    confidence,
    statistics: stats,
    dimensions,
    summary,
    recommendations,
    authority: REVIEW_ONLY_AUTHORITY,
  };
}

// ---------------------------------------------------------------------------
// Lightweight check — is depth data usable for a specific purpose?
// ---------------------------------------------------------------------------

export type DepthPurpose = 'plane_extraction' | 'sky_detection' | 'multi_view_fusion' | 'visualization';

/**
 * Quick check: is the depth data quality sufficient for a specific purpose?
 *
 * Different consumers have different quality thresholds:
 * - plane_extraction: needs good range and low noise (grade B+)
 * - sky_detection: needs good sky separation (sky dimension ≥ 60)
 * - multi_view_fusion: needs moderate overall quality (grade C+)
 * - visualization: always usable (even poor depth can be visualized)
 */
export function isDepthUsableFor(
  report: DepthQualityReport,
  purpose: DepthPurpose,
): boolean {
  switch (purpose) {
    case 'plane_extraction':
      return GRADE_RANK[report.grade] <= GRADE_RANK['B'] && report.dimensions.rangeQuality >= 60 && report.dimensions.noiseQuality >= 50;
    case 'sky_detection':
      return report.dimensions.skySeparationQuality >= 60;
    case 'multi_view_fusion':
      return GRADE_RANK[report.grade] <= GRADE_RANK['C'];
    case 'visualization':
      return true; // always usable — even poor data can be visualized
    default:
      return false;
  }
}
