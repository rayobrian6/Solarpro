/**
 * Roof Obstruction Registration Module — Phase 3B: CAD-Ready Roof Intelligence
 *
 * Extracts obstruction candidate data from roof_plane photos and registers
 * them as structured obstruction records with enriched CAD-readiness metadata.
 *
 * Architecture:
 *   obstruction_candidate + rectangular_region_candidate (in DB)
 *       ↓ (IoU-based dedup + geometry + classification)
 *   RoofObstructionRecord (TypeScript type with CAD-readiness fields)
 *       ↓ (registered per roof_plane photo)
 *   site_survey_files.obstruction_data JSONB column
 *       ↓ (aggregated per survey)
 *   Evidence manifest obstructionSummary
 *
 * Phase 3B Enhancements:
 * 1. Expanded obstruction types (plumbing_vent, exhaust_vent, antenna, roof_jack, unknown_obstruction)
 * 2. Geometry readiness fields (center, aspect ratio, size bucket, orientation hint, edge proximity, roof-plane quadrant, setback buffer, detection method, limitations)
 * 3. CAD usefulness fields (cadBlockHint, obstructionFootprintHint, clearanceRadiusHint, setbackCategoryHint, layoutAvoidancePriority, canAffectPanelPlacement, canAffectFirePathway, canAffectConduitPath, canAffectStructuralAttachment)
 * 4. IoU-based deduplication with multi-factor matching
 * 5. Priority ranking (high/medium/low)
 * 6. Review state enforcement (review_required/accepted/rejected)
 *
 * Key design decisions:
 * 1. Each roof_plane photo has ~7 duplicate file_id rows. The obstruction
 *    candidates are duplicated across these rows. We deduplicate by taking
 *    ONE representative file_id per filename (the one with the most candidates).
 * 2. IoU-based dedup: obstructions with IoU > 0.5 are considered duplicates.
 *    Keep the one with higher confidence. Tie-break by larger area.
 * 3. Obstructions are classified by heuristic rules based on geometry:
 *    - Aspect ratio, area, position, orientation hints
 *    - Human review is required for definitive classification
 * 4. All regions use normalized_image_0_1000 coordinate system (0-1000 scale).
 * 5. Obstructions are registered as a JSON array on each roof_plane file's
 *    metadata, keyed by filename.
 * 6. Review-only mode: No CAD mutation, no permit geometry mutation.
 *    This is evidence refinement only.
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';

// ─────────────────────────────────────────────────────────────────────────
// Section 1: Types
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalized bounding box region from a vision candidate.
 * Coordinates are in the normalized_image_0_1000 system (0-1000 scale).
 */
export interface ObstructionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/**
 * Center point of an obstruction (normalized 0-1000 coordinates).
 */
export interface ObstructionCenterPoint {
  x: number;
  y: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/**
 * Size bucket for categorizing obstructions by area.
 */
export type ObstructionSizeBucket = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

/**
 * Orientation hint based on aspect ratio and geometry.
 */
export type ObstructionOrientationHint = 'horizontal' | 'vertical' | 'square' | 'diagonal' | 'irregular';

/**
 * Edge proximity categories (how close to image edges).
 */
export type ObstructionEdgeProximity = 'center' | 'near_center' | 'edge' | 'corner';

/**
 * Roof-plane quadrant (NW, NE, SW, SE).
 */
export type RoofPlaneQuadrant = 'nw' | 'ne' | 'sw' | 'se' | 'unknown';

/**
 * Setback buffer category (distance from roof edges).
 */
export type SetbackBufferCategory = 'standard' | 'reduced' | 'none';

/**
 * Detection method used.
 */
export type DetectionMethod = 'opencv_contour' | 'yolo_detection' | 'hybrid' | 'manual' | 'unknown';

/**
 * Review state for obstructions.
 * - review_required: Default state, needs human review
 * - accepted: Accepted by explicit human review
 * - rejected: Rejected by explicit human review
 */
export type ReviewState = 'review_required' | 'accepted' | 'rejected';

/**
 * Priority level for obstructions (affects CAD layout considerations).
 */
export type ObstructionPriority = 'high' | 'medium' | 'low';

/**
 * CAD block hint for obstruction representation in CAD.
 */
export type CadBlockHint = 'chimney_block' | 'skylight_block' | 'hvac_unit' | 'vent_circle' | 'vent_rect' | 'pipe_boot_circle' | 'pipe_boot_rect' | 'satellite_dish' | 'solar_tube_circle' | 'flashing_polyline' | 'dormer_polyline' | 'antenna' | 'generic_rect' | 'unknown';

/**
 * Obstruction footprint hint for CAD (shape approximation).
 */
export type ObstructionFootprintHint = 'rectangular' | 'circular' | 'square' | 'l_shaped' | 'irregular' | 'unknown';

/**
 * Clearance radius hint (in feet, estimated from normalized area).
 */
export type ClearanceRadiusHint = '0_5ft' | '1ft' | '2ft' | '3ft' | '4ft' | '5ft_plus' | 'unknown';

/**
 * Expanded obstruction types for CAD-ready roof intelligence.
 */
export type RoofObstructionType =
  | 'plumbing_vent'    // Plumbing vent pipe
  | 'exhaust_vent'     // Bathroom/kitchen exhaust vent
  | 'ridge_vent'       // Ridge vent along roof peak
  | 'chimney'          // Chimney or chimney flashing
  | 'skylight'         // Skylight or roof window
  | 'pipe_boot'        // Pipe boot / plumbing stack
  | 'satellite_dish'   // Satellite dish or antenna
  | 'roof_hvac'        // HVAC unit or condenser on roof
  | 'solar_tube'       // Solar tube / tubular skylight
  | 'flashing'         // Flashing around penetration
  | 'dormer'           // Dormer window or structure
  | 'antenna'          // TV or radio antenna
  | 'roof_jack'        // Roof jack (small vent/pipe)
  | 'unknown_obstruction'; // Unidentified obstruction

/**
 * A single deduplicated obstruction record with CAD-readiness metadata.
 */
export interface RoofObstructionRecord {
  /** Unique identifier for this obstruction (based on deterministic_hash from vision candidate) */
  id: string;
  /** The filename of the roof_plane photo this obstruction was found on */
  sourceFilename: string;
  /** The file_id of the representative file used for extraction */
  sourceFileId: string;
  /** Bounding box region in normalized coordinates */
  region: ObstructionRegion;
  /** Center point in normalized coordinates */
  center: ObstructionCenterPoint;
  /** Area in normalized units (0-1,000,000 scale) */
  areaNormalized: number;
  /** Aspect ratio (width / height) */
  aspectRatio: number;
  /** Size bucket category */
  sizeBucket: ObstructionSizeBucket;
  /** Orientation hint based on geometry */
  orientationHint: ObstructionOrientationHint;
  /** Distance from nearest image edge (0-1000 scale) */
  edgeDistance: number;
  /** Edge proximity category */
  edgeProximity: ObstructionEdgeProximity;
  /** Roof-plane quadrant */
  quadrant: RoofPlaneQuadrant;
  /** Setback buffer category */
  setbackBuffer: SetbackBufferCategory;
  /** Confidence score from the vision worker (0-100 scale) */
  confidence: number;
  /** Source detection method */
  detectionMethod: DetectionMethod;
  /** Any limitations or caveats about this detection */
  limitations: string[];
  /** Source photo URL for traceability */
  sourcePhotoUrl: string | null;
  /** Source image SHA256 for cache invalidation */
  sourceImageSha256: string | null;
  /** Region index from the vision worker */
  regionIndex: number;
  /** Review state (default: review_required) */
  reviewState: ReviewState;
  /** Classification of the obstruction */
  obstructionType: RoofObstructionType | null;
  /** Priority level for CAD considerations */
  priority: ObstructionPriority;
  /** CAD block hint for representation */
  cadBlockHint: CadBlockHint;
  /** Obstruction footprint shape hint */
  obstructionFootprintHint: ObstructionFootprintHint;
  /** Clearance radius hint */
  clearanceRadiusHint: ClearanceRadiusHint;
  /** Setback category hint */
  setbackCategoryHint: SetbackBufferCategory;
  /** Layout avoidance priority (1-10, higher = more important to avoid) */
  layoutAvoidancePriority: number;
  /** Whether this obstruction requires human review */
  requiresHumanReview: boolean;
  /** Whether this obstruction can affect panel placement */
  canAffectPanelPlacement: boolean;
  /** Whether this obstruction can affect fire pathway */
  canAffectFirePathway: boolean;
  /** Whether this obstruction can affect conduit path */
  canAffectConduitPath: boolean;
  /** Whether this obstruction can affect structural attachment */
  canAffectStructuralAttachment: boolean;
}

/**
 * Summary of obstructions registered for a single roof plane photo.
 */
export interface RoofPlaneObstructionSummary {
  /** Filename of the roof_plane photo */
  filename: string;
  /** Total number of deduplicated obstructions found */
  obstructionCount: number;
  /** Obstruction records */
  obstructions: RoofObstructionRecord[];
  /** Distribution of region sizes */
  sizeDistribution: {
    tiny: number;
    small: number;
    medium: number;
    large: number;
    huge: number;
  };
  /** Average confidence across all obstructions */
  avgConfidence: number;
  /** Whether these obstructions have been human-reviewed (deprecated, use reviewState) */
  reviewed: boolean;
}

/**
 * Full obstruction registration result for a survey.
 */
export interface ObstructionRegistrationResult {
  /** Survey ID */
  surveyId: string;
  /** Total roof_plane photos processed */
  roofPhotosProcessed: number;
  /** Total deduplicated obstructions registered */
  totalObstructions: number;
  /** Per-photo summaries */
  photoSummaries: RoofPlaneObstructionSummary[];
  /** Method breakdown */
  method: string;
}
// ─────────────────────────────────────────────────────────────────────────
// Section 2: Configuration
// ─────────────────────────────────────────────────────────────────────────

/**
 * Minimum area (in normalized units) for an obstruction to be registered.
 * Areas below this threshold are likely noise from contour detection.
 *
 * Based on analysis of 496 distinct regions across 13 roof photos.
 */
export const OBSTRUCTION_MIN_AREA = Number(
  process.env.OBSTRUCTION_MIN_AREA || 5000,
);

/**
 * Maximum area (in normalized units) for an obstruction to be registered.
 * Regions covering more than this are likely not obstructions but rather
 * the roof plane itself or a building structure.
 */
export const OBSTRUCTION_MAX_AREA = Number(
  process.env.OBSTRUCTION_MAX_AREA || 150000,
);

/**
 * IoU threshold for considering two obstructions as duplicates.
 * Higher values mean stricter matching (fewer duplicates).
 */
export const IOU_DUPLICATE_THRESHOLD = Number(
  process.env.IOU_DUPLICATE_THRESHOLD || 0.5,
);

/**
 * Distance threshold (in normalized units) for considering two center points "nearby".
 */
export const CENTER_DISTANCE_THRESHOLD = Number(
  process.env.CENTER_DISTANCE_THRESHOLD || 100,
);

// ─────────────────────────────────────────────────────────────────────────
// Section 3: Internal Types for Candidate Processing
// ─────────────────────────────────────────────────────────────────────────

/**
 * Raw candidate from the database, with only the fields we need.
 */
interface RawObstructionCandidate {
  fileId: string;
  candidateType: string;
  confidence: number;
  payload: Record<string, unknown>;
  deterministicHash: string;
}

/**
 * Temporary obstruction record during deduplication.
 */
interface TemporaryObstructionRecord {
  id: string;
  sourceFileId: string;
  region: ObstructionRegion;
  area: number;
  confidence: number;
  detectionMethod: DetectionMethod;
  payload: Record<string, unknown>;
  sourceImageSha256: string | null;
  regionIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Section 4: Geometry Computation Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the center point of a region.
 */
export function computeCenter(region: ObstructionRegion): ObstructionCenterPoint {
  return {
    x: Math.round(region.x + region.width / 2),
    y: Math.round(region.y + region.height / 2),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Compute aspect ratio (width / height).
 */
export function computeAspectRatio(region: ObstructionRegion): number {
  if (region.height === 0) return 0;
  return Math.round((region.width / region.height) * 100) / 100;
}

/**
 * Classify size bucket based on normalized area.
 */
export function classifySizeBucket(area: number): ObstructionSizeBucket {
  if (area < 5000) return 'tiny';
  if (area < 15000) return 'small';
  if (area < 50000) return 'medium';
  if (area < 150000) return 'large';
  return 'huge';
}

/**
 * Determine orientation hint from aspect ratio and geometry.
 */
export function determineOrientationHint(aspectRatio: number): ObstructionOrientationHint {
  if (aspectRatio >= 2.5) return 'horizontal';
  if (aspectRatio <= 0.4) return 'vertical';
  if (aspectRatio >= 0.8 && aspectRatio <= 1.2) return 'square';
  // In between = irregular
  return 'irregular';
}

/**
 * Compute distance from the center of a region to the nearest image edge.
 * Image is 0-1000 in both dimensions.
 */
export function computeEdgeDistance(center: ObstructionCenterPoint): number {
  const distLeft = center.x;
  const distRight = 1000 - center.x;
  const distTop = center.y;
  const distBottom = 1000 - center.y;
  return Math.min(distLeft, distRight, distTop, distBottom);
}

/**
 * Classify edge proximity based on distance to nearest edge.
 */
export function classifyEdgeProximity(edgeDistance: number): ObstructionEdgeProximity {
  if (edgeDistance > 400) return 'center';
  if (edgeDistance > 200) return 'near_center';
  if (edgeDistance > 50) return 'edge';
  return 'corner';
}

/**
 * Determine roof-plane quadrant based on center position.
 * Origin (0,0) is top-left in image coordinates.
 */
export function determineQuadrant(center: ObstructionCenterPoint): RoofPlaneQuadrant {
  const isLeft = center.x < 500;
  const isTop = center.y < 500;
  if (isLeft && isTop) return 'nw';
  if (!isLeft && isTop) return 'ne';
  if (isLeft && !isTop) return 'sw';
  return 'se';
}

/**
 * Classify setback buffer category.
 * "standard" = at least 3ft equivalent from edge
 * "reduced" = 1-3ft equivalent
 * "none" = <1ft equivalent
 * In normalized coordinates: 1ft ≈ 30 units (rough approximation)
 */
export function classifySetbackBuffer(edgeDistance: number): SetbackBufferCategory {
  if (edgeDistance > 90) return 'standard';
  if (edgeDistance > 30) return 'reduced';
  return 'none';
}

/**
 * Detect method from candidate payload and type.
 */
export function detectMethod(candidate: RawObstructionCandidate): DetectionMethod {
  const source = (candidate.payload.source as string) || '';
  if (source.includes('yolo') || source.includes('YOLO')) return 'yolo_detection';
  if (source.includes('contour') || source.includes('opencv')) return 'opencv_contour';
  if (candidate.candidateType === 'object_detection') return 'yolo_detection';
  return 'opencv_contour'; // Default for obstruction_candidate from OpenCV worker
}

// ─────────────────────────────────────────────────────────────────────────
// Section 5: IoU Deduplication
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute Intersection over Union (IoU) between two regions.
 * Returns a value between 0 and 1.
 */
export function computeIoU(a: ObstructionRegion, b: ObstructionRegion): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersection = intersectionWidth * intersectionHeight;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Compute Euclidean distance between two center points.
 */
export function centerDistance(a: ObstructionCenterPoint, b: ObstructionCenterPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if two temporary obstruction records are similar enough to be duplicates.
 * Uses IoU overlap, similar center, similar bbox, and same type hints.
 */
export function areDuplicates(
  a: TemporaryObstructionRecord,
  b: TemporaryObstructionRecord,
): boolean {
  // Primary check: IoU overlap
  const iou = computeIoU(a.region, b.region);
  if (iou >= IOU_DUPLICATE_THRESHOLD) return true;

  // Secondary check: similar center + similar bbox
  const centerA = computeCenter(a.region);
  const centerB = computeCenter(b.region);
  const dist = centerDistance(centerA, centerB);

  if (dist < CENTER_DISTANCE_THRESHOLD) {
    // Centers are close — check if bboxes are similar in size
    const areaDiff = Math.abs(a.area - b.area) / Math.max(a.area, b.area);
    if (areaDiff < 0.3) {
      // Similar size + nearby center = likely duplicate
      return true;
    }
  }

  return false;
}

/**
 * Deduplicate a list of temporary obstruction records using IoU.
 * When duplicates are found, keep the one with higher confidence.
 * Tie-break by larger area.
 */
export function deduplicateByIoU(
  records: TemporaryObstructionRecord[],
): TemporaryObstructionRecord[] {
  if (records.length <= 1) return records;

  // Sort by confidence descending (higher confidence first)
  const sorted = [...records].sort((a, b) => b.confidence - a.confidence || b.area - a.area);

  const kept: TemporaryObstructionRecord[] = [];

  for (const record of sorted) {
    let isDuplicate = false;
    for (const existing of kept) {
      if (areDuplicates(record, existing)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(record);
    }
  }

  return kept;
}

// ─────────────────────────────────────────────────────────────────────────
// Section 6: Obstruction Type Classification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classify an obstruction type based on geometric heuristics.
 *
 * This is a best-effort automated classification. The result is always
 * subject to human review (review_state = 'review_required').
 *
 * Heuristic rules based on analysis of typical roof obstructions:
 * - Tiny + square + near center = pipe_boot or roof_jack
 * - Small + square + near top = plumbing_vent
 * - Small + square + edge = exhaust_vent
 * - Medium + square = skylight or solar_tube
 * - Medium + horizontal + near top = ridge_vent
 * - Large + any orientation = chimney or dormer or roof_hvac
 * - Large + horizontal = dormer
 * - Large + square = chimney or roof_hvac
 * - Very wide horizontal = ridge_vent (if near top edge)
 * - Small + circular-ish = pipe_boot
 */
export function classifyObstructionType(
  area: number,
  aspectRatio: number,
  sizeBucket: ObstructionSizeBucket,
  orientationHint: ObstructionOrientationHint,
  edgeProximity: ObstructionEdgeProximity,
  quadrant: RoofPlaneQuadrant,
  center: ObstructionCenterPoint,
): RoofObstructionType {
  // Large obstructions — chimney, dormer, HVAC
  if (sizeBucket === 'large' || sizeBucket === 'huge') {
    if (orientationHint === 'horizontal' || aspectRatio > 2.0) {
      return 'dormer';
    }
    if (orientationHint === 'square') {
      // Distinguish chimney from HVAC: HVAC tends to be more square, chimney more variable
      // This is a heuristic — human review required for certainty
      if (area > 80000) return 'roof_hvac';
      return 'chimney';
    }
    // Large but vertical or irregular
    if (aspectRatio <= 0.6) return 'dormer';
    return 'chimney';
  }

  // Medium obstructions — skylight, solar_tube, ridge_vent
  if (sizeBucket === 'medium') {
    // Ridge vent: very wide horizontal + near top edge
    if (aspectRatio > 3.0 && center.y < 300) return 'ridge_vent';
    if (orientationHint === 'horizontal' && center.y < 400) return 'ridge_vent';

    // Skylight: medium + square
    if (orientationHint === 'square') {
      if (area < 25000) return 'solar_tube';
      return 'skylight';
    }

    // Could still be skylight with slight rectangle
    if (aspectRatio >= 0.6 && aspectRatio <= 1.8) return 'skylight';

    return 'unknown_obstruction';
  }

  // Small obstructions — plumbing_vent, exhaust_vent, pipe_boot, roof_jack
  if (sizeBucket === 'small') {
    if (orientationHint === 'square' || (aspectRatio >= 0.7 && aspectRatio <= 1.4)) {
      // Near top = plumbing vent, near edge = exhaust vent, center = pipe boot
      if (center.y < 300) return 'plumbing_vent';
      if (edgeProximity === 'edge' || edgeProximity === 'corner') return 'exhaust_vent';
      return 'pipe_boot';
    }
    if (orientationHint === 'vertical') return 'plumbing_vent';
    if (orientationHint === 'horizontal' && center.y < 300) return 'ridge_vent';
    return 'roof_jack';
  }

  // Tiny obstructions — pipe_boot, roof_jack, antenna
  if (sizeBucket === 'tiny') {
    if (orientationHint === 'square') return 'pipe_boot';
    if (orientationHint === 'vertical') return 'antenna';
    return 'roof_jack';
  }

  return 'unknown_obstruction';
}

/**
 * Normalize legacy obstruction type strings to the new enum.
 * Handles backward compatibility with Phase 3 data.
 */
export function normalizeObstructionType(raw: string | null): RoofObstructionType | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  // Direct matches
  const validTypes: RoofObstructionType[] = [
    'plumbing_vent', 'exhaust_vent', 'ridge_vent', 'chimney', 'skylight',
    'pipe_boot', 'satellite_dish', 'roof_hvac', 'solar_tube', 'flashing',
    'dormer', 'antenna', 'roof_jack', 'unknown_obstruction',
  ];
  if (validTypes.includes(lower as RoofObstructionType)) {
    return lower as RoofObstructionType;
  }

  // Legacy type mapping (Phase 3 compatibility)
  const legacyMap: Record<string, RoofObstructionType> = {
    'vent': 'plumbing_vent',
    'pipe_boots': 'pipe_boot',
    'hvac': 'roof_hvac',
    'unknown': 'unknown_obstruction',
    'gable_vent': 'exhaust_vent',
  };
  if (legacyMap[lower]) return legacyMap[lower];

  // Fuzzy match
  if (lower.includes('plumb')) return 'plumbing_vent';
  if (lower.includes('exhaust')) return 'exhaust_vent';
  if (lower.includes('ridge')) return 'ridge_vent';
  if (lower.includes('chimney')) return 'chimney';
  if (lower.includes('skylight')) return 'skylight';
  if (lower.includes('pipe') || lower.includes('boot')) return 'pipe_boot';
  if (lower.includes('satellite') || lower.includes('dish')) return 'satellite_dish';
  if (lower.includes('hvac') || lower.includes('condenser')) return 'roof_hvac';
  if (lower.includes('solar') || lower.includes('tube')) return 'solar_tube';
  if (lower.includes('flash')) return 'flashing';
  if (lower.includes('dormer')) return 'dormer';
  if (lower.includes('antenna')) return 'antenna';
  if (lower.includes('jack')) return 'roof_jack';

  return 'unknown_obstruction';
}

// ─────────────────────────────────────────────────────────────────────────
// Section 7: Priority Ranking
// ─────────────────────────────────────────────────────────────────────────

/**
 * Determine priority level based on obstruction type and size.
 *
 * High priority: chimney, skylight, roof_hvac, dormer — large, fixed obstructions
 * Medium priority: vents, pipe boots, solar tubes — smaller but still significant
 * Low priority: flashing, roof_jack, unknown_obstruction — minor or uncertain
 */
export function determinePriority(
  obstructionType: RoofObstructionType | null,
  sizeBucket: ObstructionSizeBucket,
): ObstructionPriority {
  if (!obstructionType) return 'low'; // Unknown type = low priority

  const type = obstructionType.toLowerCase();

  // High priority obstructions
  if (['chimney', 'skylight', 'roof_hvac', 'dormer'].includes(type)) {
    return 'high';
  }

  // Medium priority obstructions
  if (['plumbing_vent', 'exhaust_vent', 'ridge_vent', 'pipe_boot', 'solar_tube', 'satellite_dish'].includes(type)) {
    return 'medium';
  }

  // Low priority obstructions
  if (['flashing', 'roof_jack', 'antenna', 'unknown_obstruction'].includes(type)) {
    return 'low';
  }

  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────
// Section 8: CAD Usefulness Fields
// ─────────────────────────────────────────────────────────────────────────

/**
 * Determine CAD block hint for obstruction representation in CAD.
 */
export function determineCadBlockHint(
  obstructionType: RoofObstructionType | null,
  sizeBucket: ObstructionSizeBucket,
  orientationHint: ObstructionOrientationHint,
): CadBlockHint {
  if (!obstructionType) return 'generic_rect';

  const type = obstructionType.toLowerCase();

  if (type === 'chimney') return 'chimney_block';
  if (type === 'skylight') return 'skylight_block';
  if (type === 'roof_hvac') return 'hvac_unit';
  if (type === 'satellite_dish') return 'satellite_dish';
  if (type === 'antenna') return 'antenna';
  if (type === 'dormer') return 'dormer_polyline';
  if (type === 'flashing') return 'flashing_polyline';
  if (type === 'solar_tube') return 'solar_tube_circle';
  if (type === 'ridge_vent') return 'vent_rect';

  // Vents and pipes depend on orientation and size
  if (['plumbing_vent', 'exhaust_vent'].includes(type)) {
    return orientationHint === 'square' ? 'vent_circle' : 'vent_rect';
  }
  if (type === 'pipe_boot' || type === 'roof_jack') {
    return orientationHint === 'square' ? 'pipe_boot_circle' : 'pipe_boot_rect';
  }

  return 'generic_rect';
}

/**
 * Determine obstruction footprint shape hint.
 */
export function determineObstructionFootprintHint(
  obstructionType: RoofObstructionType | null,
  aspectRatio: number,
): ObstructionFootprintHint {
  if (!obstructionType) return 'unknown';

  const type = obstructionType.toLowerCase();

  // Circular types
  if (['plumbing_vent', 'exhaust_vent', 'pipe_boot', 'solar_tube', 'roof_jack'].includes(type)) {
    return 'circular';
  }

  // Square/rectangular types
  if (['chimney', 'skylight', 'roof_hvac', 'ridge_vent'].includes(type)) {
    if (aspectRatio >= 0.8 && aspectRatio <= 1.2) return 'square';
    return 'rectangular';
  }

  // Complex shapes
  if (['dormer', 'flashing', 'satellite_dish', 'antenna'].includes(type)) {
    return 'irregular';
  }

  return 'unknown';
}

/**
 * Determine clearance radius hint based on area.
 * Estimates clearance required around the obstruction for panel placement.
 */
export function determineClearanceRadiusHint(area: number): ClearanceRadiusHint {
  if (area < 5000) return '0_5ft';
  if (area < 15000) return '1ft';
  if (area < 50000) return '2ft';
  if (area < 100000) return '3ft';
  if (area < 150000) return '4ft';
  return '5ft_plus';
}

/**
 * Determine layout avoidance priority (1-10).
 * Higher values mean more important to avoid during panel layout.
 */
export function determineLayoutAvoidancePriority(
  obstructionType: RoofObstructionType | null,
  sizeBucket: ObstructionSizeBucket,
  priority: ObstructionPriority,
): number {
  if (!obstructionType) return 2; // Unknown type = low avoidance

  const type = obstructionType.toLowerCase();

  // High priority obstructions = high avoidance priority
  if (['chimney', 'skylight', 'roof_hvac', 'dormer'].includes(type)) {
    return 10; // Must avoid
  }

  // Medium priority = medium-high avoidance
  if (['plumbing_vent', 'exhaust_vent', 'ridge_vent'].includes(type)) {
    return 7;
  }

  // Pipes and tubes = medium avoidance
  if (['pipe_boot', 'solar_tube'].includes(type)) {
    return 5;
  }

  // Satellite dish = medium-high (can shade)
  if (type === 'satellite_dish') return 8;

  // Antenna = medium (can shade, but smaller)
  if (type === 'antenna') return 4;

  // Flashing and roof jack = low avoidance
  if (['flashing', 'roof_jack', 'unknown_obstruction'].includes(type)) {
    return 2;
  }

  return 2;
}

/**
 * Determine which CAD/structural aspects this obstruction can affect.
 */
export function determineCadEffects(
  obstructionType: RoofObstructionType | null,
  sizeBucket: ObstructionSizeBucket,
  priority: ObstructionPriority,
): {
  canAffectPanelPlacement: boolean;
  canAffectFirePathway: boolean;
  canAffectConduitPath: boolean;
  canAffectStructuralAttachment: boolean;
} {
  if (!obstructionType) {
    return {
      canAffectPanelPlacement: true, // Assume it affects placement until reviewed
      canAffectFirePathway: false,
      canAffectConduitPath: false,
      canAffectStructuralAttachment: false,
    };
  }

  const type = obstructionType.toLowerCase();
  const isHighOrMedium = priority === 'high' || priority === 'medium';
  const isLarge = sizeBucket === 'large' || sizeBucket === 'huge';

  return {
    canAffectPanelPlacement: true, // All obstructions can affect panel placement
    canAffectFirePathway: isHighOrMedium && ['chimney', 'skylight', 'dormer'].includes(type),
    canAffectConduitPath: isHighOrMedium && ['chimney', 'skylight', 'roof_hvac'].includes(type),
    canAffectStructuralAttachment: isHighOrMedium && isLarge && ['chimney', 'roof_hvac'].includes(type),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section 9: Extraction and Deduplication
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract a region object from a candidate payload.
 */
function extractRegionFromPayload(
  payload: Record<string, unknown>,
): ObstructionRegion | null {
  if (!payload || typeof payload !== 'object') return null;

  const region = payload.region as Record<string, unknown> | undefined;
  if (!region) return null;

  const x = typeof region.x === 'number' ? region.x : null;
  const y = typeof region.y === 'number' ? region.y : null;
  const width = typeof region.width === 'number' ? region.width : null;
  const height = typeof region.height === 'number' ? region.height : null;
  const coordSystem = region.coordinateSystem as string | undefined;

  if (x === null || y === null || width === null || height === null) return null;

  return {
    x,
    y,
    width,
    height,
    coordinateSystem: (coordSystem === 'normalized_image_0_1000')
      ? 'normalized_image_0_1000'
      : 'normalized_image_0_1000', // Default to this system
  };
}

/**
 * Extract limitations from candidate payload.
 */
function extractLimitations(
  candidate: RawObstructionCandidate | TemporaryObstructionRecord,
  area: number,
  confidence: number,
): string[] {
  const limitations: string[] = [];

  if (area < 8000) {
    limitations.push('very_small_region_may_be_noise');
  }
  if (confidence < 30) {
    limitations.push('low_confidence_detection');
  }
  if (area > OBSTRUCTION_MAX_AREA * 0.9) {
    limitations.push('near_max_area_threshold_may_be_roof_plane');
  }
  if (area < OBSTRUCTION_MIN_AREA * 1.5) {
    limitations.push('near_min_area_threshold_may_be_noise');
  }

  return limitations;
}

/**
 * Build a full RoofObstructionRecord from a temporary record with all CAD-readiness fields.
 */
function buildFullRecord(
  temp: TemporaryObstructionRecord,
  filename: string,
  confidence: number,
  sourcePhotoUrl: string | null,
): RoofObstructionRecord {
  const center = computeCenter(temp.region);
  const aspectRatio = computeAspectRatio(temp.region);
  const sizeBucket = classifySizeBucket(temp.area);
  const orientationHint = determineOrientationHint(aspectRatio);
  const edgeDist = computeEdgeDistance(center);
  const edgeProximity = classifyEdgeProximity(edgeDist);
  const quadrant = determineQuadrant(center);
  const setbackBuffer = classifySetbackBuffer(edgeDist);
  const detectionMethod = temp.detectionMethod;

  // Classify obstruction type (heuristic)
  const obstructionType = classifyObstructionType(
    temp.area, aspectRatio, sizeBucket, orientationHint,
    edgeProximity, quadrant, center,
  );

  // Priority ranking
  const priority = determinePriority(obstructionType, sizeBucket);

  // CAD usefulness fields
  const cadBlockHint = determineCadBlockHint(obstructionType, sizeBucket, orientationHint);
  const obstructionFootprintHint = determineObstructionFootprintHint(obstructionType, aspectRatio);
  const clearanceRadiusHint = determineClearanceRadiusHint(temp.area);
  const setbackCategoryHint = setbackBuffer;
  const layoutAvoidancePriority = determineLayoutAvoidancePriority(obstructionType, sizeBucket, priority);
  const cadEffects = determineCadEffects(obstructionType, sizeBucket, priority);
  const limitations = extractLimitations(temp, temp.area, confidence);

  return {
    id: temp.id,
    sourceFilename: filename,
    sourceFileId: temp.sourceFileId,
    region: temp.region,
    center,
    areaNormalized: temp.area,
    aspectRatio,
    sizeBucket,
    orientationHint,
    edgeDistance: edgeDist,
    edgeProximity,
    quadrant,
    setbackBuffer,
    confidence,
    detectionMethod,
    limitations,
    sourcePhotoUrl,
    sourceImageSha256: temp.sourceImageSha256,
    regionIndex: temp.regionIndex,
    reviewState: 'review_required' as ReviewState, // Always default to review_required
    obstructionType,
    priority,
    cadBlockHint,
    obstructionFootprintHint,
    clearanceRadiusHint,
    setbackCategoryHint,
    layoutAvoidancePriority,
    requiresHumanReview: true, // Always true until explicit human review
    canAffectPanelPlacement: cadEffects.canAffectPanelPlacement,
    canAffectFirePathway: cadEffects.canAffectFirePathway,
    canAffectConduitPath: cadEffects.canAffectConduitPath,
    canAffectStructuralAttachment: cadEffects.canAffectStructuralAttachment,
  };
}

/**
 * Extract and deduplicate obstruction candidates for a single filename.
 * Uses IoU-based deduplication (Phase 3B) instead of coordinate-tuple dedup.
 *
 * @param candidates - All obstruction_candidate entries for this filename
 * @param filename - The filename being processed
 * @returns Deduplicated RoofPlaneObstructionSummary with CAD-readiness fields
 */
export function extractObstructionsForFilename(
  candidates: RawObstructionCandidate[],
  filename: string,
): RoofPlaneObstructionSummary {
  // Group candidates by file_id
  const byFileId = new Map<string, RawObstructionCandidate[]>();
  for (const c of candidates) {
    if (c.candidateType !== 'obstruction_candidate') continue;
    const existing = byFileId.get(c.fileId) || [];
    existing.push(c);
    byFileId.set(c.fileId, existing);
  }

  // Pick ONE representative file_id (the one with the most candidates)
  let representativeFileId: string | null = null;
  let maxCount = 0;
  for (const [fileId, fileCandidates] of byFileId.entries()) {
    if (fileCandidates.length > maxCount) {
      maxCount = fileCandidates.length;
      representativeFileId = fileId;
    }
  }

  if (!representativeFileId) {
    return {
      filename,
      obstructionCount: 0,
      obstructions: [],
      sizeDistribution: { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 },
      avgConfidence: 0,
      reviewed: false,
    };
  }

  // Step 1: Extract temporary records from representative file_id
  // (deduplicate by coordinate tuple first — same as Phase 3, to remove
  //  exact duplicates from contour processing iterations)
  const rawCandidates = byFileId.get(representativeFileId) || [];
  const seenCoords = new Set<string>();
  const tempRecords: TemporaryObstructionRecord[] = [];

  for (const candidate of rawCandidates) {
    const region = extractRegionFromPayload(candidate.payload);
    if (!region) continue;

    // Phase 3 dedup: exact coordinate match (same pixel-level region)
    const coordKey = `${region.x},${region.y},${region.width},${region.height}`;
    if (seenCoords.has(coordKey)) continue;
    seenCoords.add(coordKey);

    const area = region.width * region.height;
    if (area < OBSTRUCTION_MIN_AREA || area > OBSTRUCTION_MAX_AREA) continue;

    tempRecords.push({
      id: candidate.deterministicHash,
      sourceFileId: representativeFileId,
      region,
      area,
      confidence: candidate.confidence,
      detectionMethod: detectMethod(candidate),
      payload: candidate.payload,
      sourceImageSha256: (candidate.payload.sourceImageSha256 as string) || null,
      regionIndex: (candidate.payload.regionIndex as number) || 0,
    });
  }

  // Step 2: IoU-based deduplication (Phase 3B)
  // Remove near-duplicate regions that have significant overlap
  const deduped = deduplicateByIoU(tempRecords);

  // Step 3: Build full records with CAD-readiness fields
  const obstructions = deduped.map((temp) =>
    buildFullRecord(temp, filename, temp.confidence, null),
  );

  // Sort by region index for consistent ordering
  obstructions.sort((a, b) => a.regionIndex - b.regionIndex);

  // Compute size distribution
  const sizeDistribution = { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 };
  for (const obs of obstructions) {
    switch (obs.sizeBucket) {
      case 'tiny': sizeDistribution.tiny++; break;
      case 'small': sizeDistribution.small++; break;
      case 'medium': sizeDistribution.medium++; break;
      case 'large': sizeDistribution.large++; break;
      case 'huge': sizeDistribution.huge++; break;
    }
  }

  const avgConfidence = obstructions.length > 0
    ? obstructions.reduce((sum, o) => sum + o.confidence, 0) / obstructions.length
    : 0;

  return {
    filename,
    obstructionCount: obstructions.length,
    obstructions,
    sizeDistribution,
    avgConfidence,
    reviewed: false, // Deprecated: use reviewState on individual obstructions
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Section 10: Registration (DB persistence)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register obstructions for all roof_plane photos in a survey.
 *
 * This function:
 * 1. Queries all obstruction_candidate entries for roof_plane files
 * 2. Deduplicates by IoU (Phase 3B) + coordinate tuple (Phase 3)
 * 3. Filters by area thresholds
 * 4. Classifies obstruction types by heuristic rules
 * 5. Adds CAD-readiness metadata (geometry, priority, review state, CAD usefulness)
 * 6. Stores the obstruction data as JSON on the site_survey_files rows
 *
 * The obstruction data is stored in the JSONB column `obstruction_data`
 * on the site_survey_files table. Each roof_plane file row gets the SAME
 * obstruction data (since all rows for a filename refer to the same photo).
 *
 * REVIEW-ONLY MODE: No CAD mutation, no permit geometry mutation.
 * This is evidence refinement only.
 */
export async function registerObstructionsForSurvey(
  surveyId: string,
  run: {
    candidates: Array<{
      fileId: string;
      candidateType: string;
      confidence: number;
      payload: Record<string, unknown>;
      deterministicHash?: string;
    }>;
  },
  fileIdToFilename: Map<string, string>,
): Promise<ObstructionRegistrationResult> {
  const { getDbReady } = await import('@/lib/db/core');
  const sql = await getDbReady();

  // Step 1: Collect obstruction candidates grouped by filename
  const obstructionsByFilename = new Map<string, RawObstructionCandidate[]>();

  for (const candidate of run.candidates) {
    if (candidate.candidateType !== 'obstruction_candidate') continue;

    const filename = fileIdToFilename.get(candidate.fileId);
    if (!filename) continue;

    const existing = obstructionsByFilename.get(filename) || [];
    existing.push({
      fileId: candidate.fileId,
      candidateType: candidate.candidateType,
      confidence: candidate.confidence,
      payload: candidate.payload,
      deterministicHash: candidate.deterministicHash || `${candidate.fileId}_${candidate.candidateType}_${Math.random()}`,
    });
    obstructionsByFilename.set(filename, existing);
  }

  console.log(`[registerObstructions] Found ${obstructionsByFilename.size} filenames with obstruction candidates`);

  // Step 2: Get the set of roof_plane filenames from site_survey_files
  const roofPlaneFileIds = new Set<string>();
  for (const [, candidates] of obstructionsByFilename.entries()) {
    for (const c of candidates) {
      roofPlaneFileIds.add(c.fileId);
    }
  }

  // Query which of these files are labeled as roof_plane
  const roofPlaneFilenames = new Set<string>();
  if (roofPlaneFileIds.size > 0) {
    const fileIdArray = Array.from(roofPlaneFileIds);
    const BATCH_SIZE = 100;
    for (let i = 0; i < fileIdArray.length; i += BATCH_SIZE) {
      const batch = fileIdArray.slice(i, i + BATCH_SIZE);
      const rows = await sql`
        SELECT DISTINCT filename
        FROM site_survey_files
        WHERE survey_id = ${surveyId}
          AND id = ANY(${batch}::uuid[])
          AND label = 'roof_plane'
      `;
      for (const row of rows as Record<string, unknown>[]) {
        if (row.filename) roofPlaneFilenames.add(row.filename as string);
      }
    }
  }

  console.log(`[registerObstructions] ${roofPlaneFilenames.size} filenames are labeled as roof_plane`);

  // Step 3: Extract and deduplicate obstructions for each roof_plane filename
  // (Phase 3B: includes IoU dedup, geometry readiness, CAD usefulness fields)
  const photoSummaries: RoofPlaneObstructionSummary[] = [];
  let totalObstructions = 0;

  for (const filename of roofPlaneFilenames) {
    const candidates = obstructionsByFilename.get(filename) || [];
    const summary = extractObstructionsForFilename(candidates, filename);
    photoSummaries.push(summary);
    totalObstructions += summary.obstructionCount;

    console.log(`[registerObstructions] ${filename}: ${summary.obstructionCount} obstructions (IoU dedup v2, area range: ${OBSTRUCTION_MIN_AREA}-${OBSTRUCTION_MAX_AREA})`);
  }

  // Step 4: Store obstruction data on site_survey_files rows
  // Version bumped to 2.0 for Phase 3B schema changes
  let filesUpdated = 0;

  for (const summary of photoSummaries) {
    if (summary.obstructionCount === 0) continue;

    const obstructionJson = JSON.stringify({
      filename: summary.filename,
      obstructionCount: summary.obstructionCount,
      obstructions: summary.obstructions,
      sizeDistribution: summary.sizeDistribution,
      avgConfidence: summary.avgConfidence,
      extractedAt: new Date().toISOString(),
      version: '2.0', // Phase 3B version
      schemaVersion: 'roof_obstruction_data_v2',
    });

    // Update ALL file rows for this filename (they all get the same data)
    try {
      await sql`
        UPDATE site_survey_files
        SET obstruction_data = ${obstructionJson}::jsonb
        WHERE survey_id = ${surveyId}
          AND filename = ${summary.filename}
          AND label = 'roof_plane'
      `;
      filesUpdated++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('obstruction_data') && errorMsg.includes('does not exist')) {
        console.log(`[registerObstructions] Creating obstruction_data column...`);
        try {
          await sql`ALTER TABLE site_survey_files ADD COLUMN IF NOT EXISTS obstruction_data jsonb`;
          await sql`
            UPDATE site_survey_files
            SET obstruction_data = ${obstructionJson}::jsonb
            WHERE survey_id = ${surveyId}
              AND filename = ${summary.filename}
              AND label = 'roof_plane'
          `;
          filesUpdated++;
        } catch (retryErr) {
          console.error(`[registerObstructions] Failed to create column and update:`, retryErr);
        }
      } else {
        console.error(`[registerObstructions] Failed to update ${summary.filename}:`, err);
      }
    }
  }

  console.log(`[registerObstructions] Updated ${filesUpdated} filenames with obstruction data (${totalObstructions} total obstructions, Phase 3B schema v2)`);

  return {
    surveyId,
    roofPhotosProcessed: roofPlaneFilenames.size,
    totalObstructions,
    photoSummaries,
    method: 'obstruction_candidate_iou_dedup_v2_phase3b',
  };
}
