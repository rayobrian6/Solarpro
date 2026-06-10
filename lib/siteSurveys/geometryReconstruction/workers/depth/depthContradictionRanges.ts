/**
 * Depth-Class Contradiction Range Table (P0-2.2)
 *
 * Defines the expected normalized depth ranges for each segmentation class.
 * When the estimated depth for a mask falls outside its class's expected range,
 * a contradiction is detected and reported.
 *
 * Normalized depth: 0 = far from camera, 1 = near camera.
 * This convention matches MiDaS inverted depth (after inversion).
 *
 * Range design principles:
 * - Ranges are WIDE (±20% around measured means) to avoid false positives.
 *   Calibration tightening is a staging activity, not a production activity.
 * - Sky is always far (depth > 0.75). Ground is always near (depth < 0.30).
 * - Structural surfaces (roof, wall) occupy the middle range.
 * - Vegetation overlaps with structure ranges (trees can be at any depth).
 * - 'background' has NO expected range — it is excluded from contradiction
 *   detection because the class represents unclassifiable regions.
 *
 * Phase 0 (WP-2): These ranges are consumed by the contradiction detector
 * (P0-2.3) and the depth worker (P0-2.4).
 */

import type { SegmentationClass } from '../../types';

/** Expected depth range for a segmentation class [min, max] in normalized depth. */
export interface DepthClassRange {
  /** Minimum expected normalized depth (inclusive). */
  min: number;
  /** Maximum expected normalized depth (inclusive). */
  max: number;
  /** Whether this class should be checked for contradictions.
   *  Classes like 'background' and 'sky' (which has trivially narrow range)
   *  may be excluded from certain checks. */
  checkContradiction: boolean;
}

/**
 * Per-class expected depth ranges in normalized depth (0=far, 1=near).
 *
 * Derived from P0.3 audit measurements on ~10 surveys with LiDAR ground truth,
 * with ±20% margin to reduce false positive contradictions.
 *
 * Calibration note: these are initial conservative ranges. The contradiction
 * detection rate should be measured in staging and ranges adjusted if:
 * - Rate < 10%: ranges may be too wide (under-sensitive)
 * - Rate > 80%: ranges may be too narrow (over-sensitive)
 */
export const DEPTH_CLASS_RANGES: Readonly<Record<SegmentationClass, DepthClassRange>> = {
  // ── Structure surfaces: middle depth range ──
  roof:                        { min: 0.25, max: 0.75, checkContradiction: true },
  wall:                        { min: 0.20, max: 0.65, checkContradiction: true },
  siding:                      { min: 0.20, max: 0.65, checkContradiction: true },
  fascia:                      { min: 0.25, max: 0.70, checkContradiction: true },
  soffit:                      { min: 0.25, max: 0.70, checkContradiction: true },
  gutter:                      { min: 0.25, max: 0.70, checkContradiction: true },
  chimney:                     { min: 0.25, max: 0.75, checkContradiction: true },
  vent_pipe:                   { min: 0.25, max: 0.75, checkContradiction: true },
  skylight:                    { min: 0.25, max: 0.75, checkContradiction: true },
  downspout:                   { min: 0.20, max: 0.70, checkContradiction: true },

  // ── Sky: always far from camera ──
  sky:                         { min: 0.75, max: 1.00, checkContradiction: true },

  // ── Vegetation: wide range (trees can be at various depths) ──
  tree:                        { min: 0.15, max: 0.80, checkContradiction: true },
  trees:                       { min: 0.15, max: 0.80, checkContradiction: true },
  bushes:                      { min: 0.10, max: 0.65, checkContradiction: true },
  vegetation_touching_structure: { min: 0.15, max: 0.75, checkContradiction: true },
  grass:                       { min: 0.05, max: 0.30, checkContradiction: true },
  overgrown_grass:             { min: 0.05, max: 0.35, checkContradiction: true },
  moss:                        { min: 0.15, max: 0.55, checkContradiction: true },
  algae:                       { min: 0.15, max: 0.55, checkContradiction: true },

  // ── Ground / hardscape: near camera ──
  ground:                      { min: 0.00, max: 0.30, checkContradiction: true },
  driveway:                    { min: 0.00, max: 0.30, checkContradiction: true },
  gravel:                      { min: 0.00, max: 0.30, checkContradiction: true },
  sidewalk:                    { min: 0.00, max: 0.30, checkContradiction: true },

  // ── Vehicles: near camera, moderate range ──
  car:                         { min: 0.05, max: 0.40, checkContradiction: true },
  truck:                       { min: 0.05, max: 0.45, checkContradiction: true },
  trailer:                     { min: 0.05, max: 0.45, checkContradiction: true },

  // ── Occluder / temporary: moderate range ──
  person:                      { min: 0.15, max: 0.55, checkContradiction: true },
  ladder:                      { min: 0.15, max: 0.65, checkContradiction: true },
  trash_can:                   { min: 0.05, max: 0.45, checkContradiction: true },
  tools:                       { min: 0.10, max: 0.55, checkContradiction: true },
  temporary_materials:         { min: 0.05, max: 0.55, checkContradiction: true },

  // ── Facade openings: middle depth ──
  window:                      { min: 0.20, max: 0.65, checkContradiction: true },
  door:                        { min: 0.10, max: 0.55, checkContradiction: true },
  garage_door:                 { min: 0.05, max: 0.45, checkContradiction: true },

  // ── Facade non-structure: middle-near depth ──
  porch:                       { min: 0.05, max: 0.45, checkContradiction: true },
  deck:                        { min: 0.05, max: 0.40, checkContradiction: true },
  steps:                       { min: 0.05, max: 0.40, checkContradiction: true },
  railing:                     { min: 0.15, max: 0.60, checkContradiction: true },
  fence:                       { min: 0.05, max: 0.50, checkContradiction: true },

  // ── Electrical / solar: no contradiction check (small equipment, depth is noisy) ──
  ac_unit:                     { min: 0.20, max: 0.70, checkContradiction: false },
  existing_solar_panel:        { min: 0.25, max: 0.70, checkContradiction: false },
  utility_meter:               { min: 0.15, max: 0.60, checkContradiction: false },
  main_service_panel:          { min: 0.15, max: 0.60, checkContradiction: false },
  disconnect:                  { min: 0.15, max: 0.60, checkContradiction: false },
  conduit:                     { min: 0.15, max: 0.65, checkContradiction: false },
  inverter:                    { min: 0.15, max: 0.60, checkContradiction: false },
  battery:                     { min: 0.15, max: 0.60, checkContradiction: false },

  // ── Condition flags: no contradiction check (quality indicators) ──
  damaged_siding:              { min: 0.20, max: 0.65, checkContradiction: false },
  blocked_access:              { min: 0.00, max: 0.50, checkContradiction: false },
  muddy_work_area:             { min: 0.00, max: 0.30, checkContradiction: false },

  // ── Legacy catch-alls ──
  obstruction:                 { min: 0.10, max: 0.65, checkContradiction: true },
  equipment:                   { min: 0.15, max: 0.60, checkContradiction: false },

  // ── Background: NO contradiction check (unclassifiable region) ──
  background:                  { min: 0.00, max: 1.00, checkContradiction: false },
};

/**
 * Compute the deviation of an actual depth from the expected range.
 * Returns 0 if depth is within range, or the absolute distance to the
 * nearest range boundary if outside.
 */
export function computeDepthDeviation(
  segmentationClass: SegmentationClass,
  actualDepth: number,
): number {
  const range = DEPTH_CLASS_RANGES[segmentationClass];
  if (!range) return 0;
  if (actualDepth >= range.min && actualDepth <= range.max) return 0;
  if (actualDepth < range.min) return range.min - actualDepth;
  return actualDepth - range.max;
}

/**
 * Determine contradiction severity from deviation magnitude.
 *
 * Thresholds are calibrated for normalized depth (0-1 scale):
 * - deviation < 0.05: within noise margin → 'none'
 * - deviation 0.05-0.10: marginal → 'minor' (no confidence penalty)
 * - deviation 0.10-0.20: significant → 'moderate' (blocks canonical promotion)
 * - deviation > 0.20: severe → 'major' (blocks canonical promotion, high penalty)
 */
export function classifyDeviation(deviation: number): import('../../types').ContradictionSeverity {
  if (deviation < 0.05) return 'none';
  if (deviation < 0.10) return 'minor';
  if (deviation < 0.20) return 'moderate';
  return 'major';
}
