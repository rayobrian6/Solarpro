/**
 * Plane extension / occlusion inference module.
 *
 * When a structural plane (wall, roof, siding) is partially occluded by
 * trees, bushes, cars, or other objects, the segmentation only sees the
 * visible portion. This module predicts where the plane WOULD extend
 * behind the occluder and extends the structural polygon through the
 * occluded region.
 *
 * Architecture:
 * - This is a POST-PROCESSING step that runs AFTER all masks are collected.
 * - It requires cross-mask analysis: structural masks must know about
 *   occluder masks to determine where to extend.
 * - Extension is based on geometric extrapolation of the reconstructed
 *   architectural shape (which is already a rectangle/trapezoid from
 *   Stage 6 of maskCleanup).
 *
 * Design decisions:
 * - Only extend planes that are already architecturally reconstructed
 *   (walls→rectangles, roofs→trapezoids). Raw blobby masks are not
 *   good candidates for extension.
 * - Extension is limited: a plane can extend at most 2× its visible
 *   width or height, whichever axis is occluded. This prevents a tiny
 *   visible strip from becoming a huge wall.
 * - The extension direction is determined by the class: walls extend
 *   horizontally, roofs extend along the ridge direction.
 * - Only occluders that actually overlap the structural plane's
 *   bounding box are considered.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  NormalizedPoint,
  SegmentationClass,
  SemanticSegmentationMask,
} from '../../types';

// ---------------------------------------------------------------------------
// Occluder classification for plane extension
// ---------------------------------------------------------------------------

/**
 * Classes that visually occlude structural planes but are NOT structural.
 * These include both the "occluder" classes (car, truck) AND vegetation
 * classes that block the view of walls/roofs.
 *
 * Note: trees/bushes are SOLAR-RELEVANT (shade sources) but they also
 * occlude walls — for plane extension, we need to treat them as visual
 * occluders while still keeping them as separate mask artifacts.
 */
const VISUAL_OCCLUDER_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  // Explicit occluders (not structural at all)
  'car', 'truck', 'trailer', 'person', 'ladder', 'trash_can',
  'tools', 'temporary_materials',
  // Vegetation that occludes structure visibility
  'trees', 'bushes', 'hedge', 'overgrown_grass', 'overgrown_vegetation',
  'vegetation_touching_structure', 'stump',
] as const);

/**
 * Classes whose polygons represent structural planes that should be
 * extended through occluder regions. These are the "building envelope"
 * surfaces that have geometric continuity behind obstructions.
 */
const EXTENSIBLE_PLANE_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  // Wall/facade planes — the most commonly occluded
  'wall', 'siding', 'fascia', 'soffit',
  // Roof planes — sometimes occluded by overhanging trees
  'roof', 'dormer', 'awning',
  // Porch/deck surfaces — occluded by vegetation at ground level
  'porch', 'deck',
] as const);

/**
 * Classes where plane extension is NOT appropriate.
 * These are either too small (chimney), too irregular (ground),
 * or already fully visible (sky). Extension would produce false geometry.
 */
const NON_EXTENSIBLE_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'sky', 'ground', 'grass', 'driveway', 'sidewalk', 'gravel',
  'chimney', 'vent_pipe', 'flue', 'satellite_dish', 'antenna',
  'skylight', 'roof_hatch', 'solar_tube', 'flashing',
  'window', 'door', 'garage_door',
  'utility_meter', 'main_service_panel', 'disconnect', 'conduit',
  'inverter', 'battery', 'ac_unit', 'existing_solar_panel',
  'fence', 'retaining_wall', 'foundation',
  'moss', 'algae', 'damaged_siding', 'blocked_access', 'muddy_work_area',
  // Neighbor structures — we don't extend these, they're separate buildings
  'neighbor_house', 'neighbor_structure',
] as const);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounding box of a polygon.
 */
interface AABB {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function computeAABB(polygon: NormalizedPoint[]): AABB {
  let xMin = 1000, yMin = 1000, xMax = 0, yMax = 0;
  for (const pt of polygon) {
    if (pt.x < xMin) xMin = pt.x;
    if (pt.y < yMin) yMin = pt.y;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y > yMax) yMax = pt.y;
  }
  return { xMin, yMin, xMax, yMax };
}

/**
 * Check if two AABBs overlap (including edge contact).
 */
function aabbOverlaps(a: AABB, b: AABB): boolean {
  return a.xMin <= b.xMax && a.xMax >= b.xMin &&
         a.yMin <= b.yMax && a.yMax >= b.yMin;
}

/**
 * Compute the intersection area of two AABBs as a fraction of box A.
 * Returns 0 if no overlap, 1 if A is fully inside B.
 */
function aabbOverlapFraction(a: AABB, b: AABB): number {
  if (!aabbOverlaps(a, b)) return 0;
  const overlapX = Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin));
  const overlapY = Math.max(0, Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin));
  const overlapArea = overlapX * overlapY;
  const aArea = (a.xMax - a.xMin) * (a.yMax - a.yMin);
  if (aArea <= 0) return 0;
  return overlapArea / aArea;
}

/**
 * Check if a polygon is roughly rectangular (4 vertices, orthogonal edges).
 * Architecturally reconstructed masks from Stage 6 should be rectangular.
 */
function isRectangular(polygon: NormalizedPoint[]): boolean {
  if (polygon.length < 4 || polygon.length > 6) return false;

  // Check that we have roughly 4 distinct corners
  // Allow 5-6 vertices for slight chamfers from cleanup
  const corners = polygon.length <= 5 ? polygon : simplifyTo4Corners(polygon);
  if (corners.length < 4) return false;

  // Check that edges are roughly horizontal or vertical
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    const dx = Math.abs(corners[j].x - corners[i].x);
    const dy = Math.abs(corners[j].y - corners[i].y);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue; // degenerate edge
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Allow edges within 15° of horizontal or vertical
    const isHorizontal = angle < 15 || angle > 165;
    const isVertical = Math.abs(angle - 90) < 15;
    if (!isHorizontal && !isVertical) return false;
  }
  return true;
}

/**
 * Simplify a polygon to 4 corners by finding the 4 most extreme points.
 */
function simplifyTo4Corners(polygon: NormalizedPoint[]): NormalizedPoint[] {
  if (polygon.length <= 4) return polygon;

  // Find top-left, top-right, bottom-right, bottom-left
  let tl = { x: 1000, y: 1000, coordinateSystem: 'normalized_image_0_1000' as const };
  let tr = { x: 0, y: 1000, coordinateSystem: 'normalized_image_0_1000' as const };
  let br = { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' as const };
  let bl = { x: 1000, y: 0, coordinateSystem: 'normalized_image_0_1000' as const };

  for (const pt of polygon) {
    if (pt.x + pt.y < tl.x + tl.y) tl = { ...pt };
    if (-pt.x + pt.y < -tr.x + tr.y) tr = { ...pt };
    if (-pt.x - pt.y < -br.x - br.y) br = { ...pt };
    if (pt.x - pt.y < bl.x - bl.y) bl = { ...pt };
  }

  return [tl, tr, br, bl];
}

/**
 * Determine which edges of a structural polygon are adjacent to an occluder.
 * Returns the occluded sides: 'left', 'right', 'top', 'bottom', or combinations.
 */
function detectOccludedSides(
  structAABB: AABB,
  occluderAABBs: AABB[],
): Set<string> {
  const sides = new Set<string>();

  for (const occAABB of occluderAABBs) {
    if (!aabbOverlaps(structAABB, occAABB)) continue;

    // Check which side of the structure the occluder extends past
    const structWidth = structAABB.xMax - structAABB.xMin;
    const structHeight = structAABB.yMax - structAABB.yMin;

    if (structWidth <= 0 || structHeight <= 0) continue;

    // Occluder extends past the LEFT edge
    if (occAABB.xMin < structAABB.xMin &&
        occAABB.xMax > structAABB.xMin &&
        aabbOverlapFraction(occAABB, structAABB) > 0.05) {
      sides.add('left');
    }

    // Occluder extends past the RIGHT edge
    if (occAABB.xMax > structAABB.xMax &&
        occAABB.xMin < structAABB.xMax &&
        aabbOverlapFraction(occAABB, structAABB) > 0.05) {
      sides.add('right');
    }

    // Occluder extends past the TOP edge
    if (occAABB.yMin < structAABB.yMin &&
        occAABB.yMax > structAABB.yMin &&
        aabbOverlapFraction(occAABB, structAABB) > 0.05) {
      sides.add('top');
    }

    // Occluder extends past the BOTTOM edge
    if (occAABB.yMax > structAABB.yMax &&
        occAABB.yMin < structAABB.yMax &&
        aabbOverlapFraction(occAABB, structAABB) > 0.05) {
      sides.add('bottom');
    }
  }

  return sides;
}

/**
 * Extend a rectangular polygon along the specified sides.
 *
 * Strategy:
 * - For walls/siding: extend HORIZONTALLY (left/right) — walls are
 *   continuous horizontal surfaces. Only extend vertically if the
 *   occluder clearly covers the top or bottom and the wall would
 *   naturally continue there.
 * - For roofs: extend along the ridge direction (horizontal for gable,
 *   could be diagonal for hip).
 * - For porch/deck: extend horizontally.
 *
 * Extension amount: up to MAX_EXTENSION_FRACTION of the visible
 * dimension, capped at MAX_EXTENSION_PIXELS (in 0-1000 coords).
 */
const MAX_EXTENSION_FRACTION = 1.0; // Extend up to 100% of visible width/height
const MAX_EXTENSION_PIXELS = 200;   // Max 200 units in 0-1000 coordinate space
const MIN_OCCLUDER_OVERLAP = 0.10;  // Occluder must overlap at least 10% of plane

function extendRectangularPolygon(
  polygon: NormalizedPoint[],
  occludedSides: Set<string>,
  segmentationClass: SegmentationClass,
): NormalizedPoint[] {
  if (occludedSides.size === 0) return polygon;

  const aabb = computeAABB(polygon);
  const corners = simplifyTo4Corners(polygon);
  if (corners.length < 4) return polygon;

  // Order corners: TL, TR, BR, BL
  const [tl, tr, br, bl] = corners;

  const structWidth = aabb.xMax - aabb.xMin;
  const structHeight = aabb.yMax - aabb.yMin;

  // Determine extension preference by class
  const isWall = (segmentationClass === 'wall' || segmentationClass === 'siding' ||
                  segmentationClass === 'fascia' || segmentationClass === 'soffit');
  const isRoof = (segmentationClass === 'roof' || segmentationClass === 'dormer' ||
                  segmentationClass === 'awning');

  // Compute extension amounts
  let leftExt = 0, rightExt = 0, topExt = 0, bottomExt = 0;

  if (occludedSides.has('left')) {
    const maxExt = Math.min(structWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS);
    // How far does the occluder extend past the left edge?
    // Use the structural height as a heuristic: extend proportionally
    leftExt = maxExt;
  }

  if (occludedSides.has('right')) {
    const maxExt = Math.min(structWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS);
    rightExt = maxExt;
  }

  if (occludedSides.has('top')) {
    const maxExt = Math.min(structHeight * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS);
    // Walls: only extend vertically if the occluder clearly covers the top
    // Roofs: don't extend upward (ridge is the top)
    if (isWall) {
      topExt = maxExt * 0.5; // Conservative vertical extension for walls
    }
    // Roofs: top = ridge, don't extend past ridge
  }

  if (occludedSides.has('bottom')) {
    const maxExt = Math.min(structHeight * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS);
    if (isWall) {
      bottomExt = maxExt * 0.3; // Very conservative downward extension for walls
    }
    if (isRoof) {
      bottomExt = maxExt * 0.5; // Moderate downward extension for roofs (eave line)
    }
    if (segmentationClass === 'porch' || segmentationClass === 'deck') {
      bottomExt = 0; // Don't extend decks downward
    }
  }

  if (leftExt === 0 && rightExt === 0 && topExt === 0 && bottomExt === 0) {
    return polygon;
  }

  // Build extended rectangle corners
  const newTL: NormalizedPoint = {
    x: tl.x - leftExt,
    y: tl.y - topExt,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newTR: NormalizedPoint = {
    x: tr.x + rightExt,
    y: tr.y - topExt,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newBR: NormalizedPoint = {
    x: br.x + rightExt,
    y: br.y + bottomExt,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newBL: NormalizedPoint = {
    x: bl.x - leftExt,
    y: bl.y + bottomExt,
    coordinateSystem: 'normalized_image_0_1000',
  };

  // Clamp to image bounds [0, 1000]
  const clamped: NormalizedPoint[] = [newTL, newTR, newBR, newBL].map(pt => ({
    x: Math.max(0, Math.min(1000, pt.x)),
    y: Math.max(0, Math.min(1000, pt.y)),
    coordinateSystem: 'normalized_image_0_1000' as const,
  }));

  return clamped;
}

/**
 * Extend a trapezoidal/roof polygon along occluded sides.
 *
 * Roofs are trapezoids or triangles. The extension strategy:
 * - Extend the ridge (top edge) and eave (bottom edge) horizontally
 *   to match the occluder extent, keeping the same pitch.
 * - Don't extend the rake edges (diagonal sides) — those are
 *   structural boundaries.
 */
function extendTrapezoidPolygon(
  polygon: NormalizedPoint[],
  occludedSides: Set<string>,
  segmentationClass: SegmentationClass,
): NormalizedPoint[] {
  if (occludedSides.size === 0) return polygon;
  if (polygon.length < 3) return polygon;

  const aabb = computeAABB(polygon);

  // Find top and bottom edges
  // For a trapezoid: vertices are typically ordered as
  // top-left, top-right, bottom-right, bottom-left
  // For a triangle: top-vertex, bottom-right, bottom-left
  const isTriangle = polygon.length === 3;

  if (isTriangle) {
    // Triangle (gable end): find the apex and base
    // Apex = topmost vertex (smallest Y in image coordinates)
    let apexIdx = 0;
    for (let i = 1; i < 3; i++) {
      if (polygon[i].y < polygon[apexIdx].y) apexIdx = i;
    }
    const apex = polygon[apexIdx];
    const other1 = polygon[(apexIdx + 1) % 3];
    const other2 = polygon[(apexIdx + 2) % 3];
    // Sort base vertices by X so baseLeft.x < baseRight.x
    const baseLeft = other1.x <= other2.x ? other1 : other2;
    const baseRight = other1.x <= other2.x ? other2 : other1;

    // Compute extension amounts
    const baseWidth = baseRight.x - baseLeft.x; // Positive since sorted
    if (baseWidth <= 0) return polygon;

    const leftExt = occludedSides.has('left')
      ? Math.min(baseWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS)
      : 0;
    const rightExt = occludedSides.has('right')
      ? Math.min(baseWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS)
      : 0;

    if (leftExt === 0 && rightExt === 0) return polygon;

    // Maintain apex's relative position along the base width
    const apexRelativeX = (apex.x - baseLeft.x) / baseWidth;

    // Extend base vertices outward
    const newBaseLeft: NormalizedPoint = {
      x: Math.max(0, baseLeft.x - leftExt),
      y: baseLeft.y,
      coordinateSystem: 'normalized_image_0_1000',
    };
    const newBaseRight: NormalizedPoint = {
      x: Math.min(1000, baseRight.x + rightExt),
      y: baseRight.y,
      coordinateSystem: 'normalized_image_0_1000',
    };

    const newBaseWidth = newBaseRight.x - newBaseLeft.x;
    if (newBaseWidth <= 0) return polygon;

    // Place apex at the same relative position along the new base
    const newApex: NormalizedPoint = {
      x: Math.max(0, Math.min(1000, newBaseLeft.x + apexRelativeX * newBaseWidth)),
      y: apex.y,
      coordinateSystem: 'normalized_image_0_1000',
    };

    return [newApex, newBaseLeft, newBaseRight];
  }

  // Trapezoid (4+ vertices): extend like rectangle but maintain roof pitch
  const structWidth = aabb.xMax - aabb.xMin;
  const leftExt = occludedSides.has('left')
    ? Math.min(structWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS)
    : 0;
  const rightExt = occludedSides.has('right')
    ? Math.min(structWidth * MAX_EXTENSION_FRACTION, MAX_EXTENSION_PIXELS)
    : 0;

  if (leftExt === 0 && rightExt === 0) return polygon;

  // Find top edge (ridge) and bottom edge (eave)
  // Sort vertices by Y to find top and bottom
  const sorted = [...polygon].sort((a, b) => a.y - b.y);
  const topY = sorted[0].y;
  const bottomY = sorted[sorted.length - 1].y;

  // Find leftmost and rightmost points at top and bottom
  const topVertices = polygon.filter(pt => Math.abs(pt.y - topY) < 5);
  const bottomVertices = polygon.filter(pt => Math.abs(pt.y - bottomY) < 5);

  if (topVertices.length < 1 || bottomVertices.length < 1) {
    // Can't determine roof geometry, fall back to rectangular extension
    return extendRectangularPolygon(polygon, occludedSides, segmentationClass);
  }

  const topLeft = topVertices.reduce((min, pt) => pt.x < min.x ? pt : min);
  const topRight = topVertices.reduce((max, pt) => pt.x > max.x ? pt : max);
  const bottomLeft = bottomVertices.reduce((min, pt) => pt.x < min.x ? pt : min);
  const bottomRight = bottomVertices.reduce((max, pt) => pt.x > max.x ? pt : max);

  // Extend: shift left/right edges outward, keeping the same pitch
  const newTopLeft: NormalizedPoint = {
    x: Math.max(0, topLeft.x - leftExt),
    y: topLeft.y,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newTopRight: NormalizedPoint = {
    x: Math.min(1000, topRight.x + rightExt),
    y: topRight.y,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newBottomLeft: NormalizedPoint = {
    x: Math.max(0, bottomLeft.x - leftExt),
    y: bottomLeft.y,
    coordinateSystem: 'normalized_image_0_1000',
  };
  const newBottomRight: NormalizedPoint = {
    x: Math.min(1000, bottomRight.x + rightExt),
    y: bottomRight.y,
    coordinateSystem: 'normalized_image_0_1000',
  };

  return [newTopLeft, newTopRight, newBottomRight, newBottomLeft];
}

// ---------------------------------------------------------------------------
// Main entry point: cross-mask plane extension
// ---------------------------------------------------------------------------

export interface PlaneExtensionConfig {
  /** Whether plane extension is enabled. Default: true */
  enabled?: boolean;
  /** Minimum overlap fraction between occluder and structural plane
   *  to trigger extension. Default: 0.10 (10%) */
  minOccluderOverlap?: number;
  /** Maximum extension as fraction of visible dimension. Default: 1.0 (100%) */
  maxExtensionFraction?: number;
  /** Maximum extension in 0-1000 coordinate units. Default: 200 */
  maxExtensionPixels?: number;
}

export interface PlaneExtensionResult {
  /** The extended masks (structural masks may have larger polygons). */
  extendedMasks: SemanticSegmentationMask[];
  /** Number of masks that were extended. */
  extendedCount: number;
  /** Details about each extension for logging/debugging. */
  extensionDetails: Array<{
    maskId: string;
    segmentationClass: SegmentationClass;
    extendedSides: string[];
    originalVertexCount: number;
    newVertexCount: number;
  }>;
}

/**
 * Run plane extension on a collection of semantic segmentation masks.
 *
 * This is a cross-mask post-processing step that:
 * 1. Identifies structural plane masks (wall, roof, siding, etc.)
 * 2. Identifies occluder masks (trees, bushes, cars, etc.)
 * 3. For each structural plane, checks if occluders overlap its edges
 * 4. Extends the structural polygon through the occluded region
 *
 * IMPORTANT: This must be called AFTER cleanSegmentationMask() has
 * already run on each mask individually, so that architectural shape
 * reconstruction (Stage 6) has already produced rectangular/trapezoidal
 * polygons that can be meaningfully extended.
 *
 * @param masks - All masks from the segmentation worker (already cleaned)
 * @param config - Configuration for extension behavior
 * @returns Extended masks and extension statistics
 */
export function extendPlanesThroughOccluders(
  masks: SemanticSegmentationMask[],
  config?: PlaneExtensionConfig,
): PlaneExtensionResult {
  const resolvedConfig: Required<PlaneExtensionConfig> = {
    enabled: config?.enabled ?? true,
    minOccluderOverlap: config?.minOccluderOverlap ?? MIN_OCCLUDER_OVERLAP,
    maxExtensionFraction: config?.maxExtensionFraction ?? MAX_EXTENSION_FRACTION,
    maxExtensionPixels: config?.maxExtensionPixels ?? MAX_EXTENSION_PIXELS,
  };

  if (!resolvedConfig.enabled) {
    return {
      extendedMasks: masks,
      extendedCount: 0,
      extensionDetails: [],
    };
  }

  // Separate masks into structural planes, occluders, and other
  const structuralMasks: SemanticSegmentationMask[] = [];
  const occluderMasks: SemanticSegmentationMask[] = [];
  const otherMasks: SemanticSegmentationMask[] = [];

  for (const mask of masks) {
    if (EXTENSIBLE_PLANE_CLASSES.has(mask.segmentationClass)) {
      structuralMasks.push(mask);
    } else if (VISUAL_OCCLUDER_CLASSES.has(mask.segmentationClass) || mask.isOccluder === true) {
      occluderMasks.push(mask);
    } else {
      otherMasks.push(mask);
    }
  }

  // No occluders → nothing to extend through
  if (occluderMasks.length === 0 || structuralMasks.length === 0) {
    return {
      extendedMasks: masks,
      extendedCount: 0,
      extensionDetails: [],
    };
  }

  // Precompute occluder AABBs
  const occluderAABBs = occluderMasks.map(m => ({
    mask: m,
    aabb: computeAABB(m.polygon),
  }));

  const extensionDetails: PlaneExtensionResult['extensionDetails'] = [];
  const extendedStructuralMasks: SemanticSegmentationMask[] = [];

  for (const structMask of structuralMasks) {
    const structAABB = computeAABB(structMask.polygon);

    // Find occluders that overlap this structural plane
    const overlappingOccluders = occluderAABBs.filter(occ =>
      aabbOverlaps(structAABB, occ.aabb) &&
      aabbOverlapFraction(occ.aabb, structAABB) >= resolvedConfig.minOccluderOverlap
    );

    if (overlappingOccluders.length === 0) {
      // No occluders overlap this plane → keep as-is
      extendedStructuralMasks.push(structMask);
      continue;
    }

    // Check if the polygon is architecturally reconstructed
    // (rectangular or trapezoidal). Only extend reconstructed shapes.
    const isRect = isRectangular(structMask.polygon);
    const isRoof = structMask.segmentationClass === 'roof' ||
                   structMask.segmentationClass === 'dormer' ||
                   structMask.segmentationClass === 'awning';

    if (!isRect && !isRoof) {
      // Not a clean geometric shape — don't extend
      extendedStructuralMasks.push(structMask);
      continue;
    }

    // Detect which sides are occluded
    const occluderAABBsForSides = overlappingOccluders.map(o => o.aabb);
    const occludedSides = detectOccludedSides(structAABB, occluderAABBsForSides);

    if (occludedSides.size === 0) {
      // Occluder overlaps but doesn't extend past any edge → keep as-is
      extendedStructuralMasks.push(structMask);
      continue;
    }

    // Extend the polygon based on class and shape
    let extendedPolygon: NormalizedPoint[];

    if (isRoof && !isRect) {
      // Trapezoidal roof polygon
      extendedPolygon = extendTrapezoidPolygon(
        structMask.polygon, occludedSides, structMask.segmentationClass,
      );
    } else {
      // Rectangular wall/facade polygon
      extendedPolygon = extendRectangularPolygon(
        structMask.polygon, occludedSides, structMask.segmentationClass,
      );
    }

    // Check if extension actually changed the polygon
    let wasExtended = false;
    if (extendedPolygon.length !== structMask.polygon.length) {
      wasExtended = true;
    } else {
      for (let i = 0; i < extendedPolygon.length; i++) {
        if (Math.abs(extendedPolygon[i].x - structMask.polygon[i].x) > 1 ||
            Math.abs(extendedPolygon[i].y - structMask.polygon[i].y) > 1) {
          wasExtended = true;
          break;
        }
      }
    }

    if (wasExtended) {
      // Recompute mask bounds for extended polygon
      const bounds = computeMaskBounds(extendedPolygon);

      const extendedMask: SemanticSegmentationMask = {
        ...structMask,
        polygon: extendedPolygon,
        maskBounds: bounds,
        // Mark that this mask was extended through occlusion
        rawMask: structMask.rawMask ?? structMask.cleanedMask,
        cleanedMask: `extended-${structMask.id}`,
      };

      extendedStructuralMasks.push(extendedMask);

      extensionDetails.push({
        maskId: structMask.id,
        segmentationClass: structMask.segmentationClass,
        extendedSides: [...occludedSides],
        originalVertexCount: structMask.polygon.length,
        newVertexCount: extendedPolygon.length,
      });

      console.info(
        `[PlaneExtension] Extended ${structMask.segmentationClass} mask ${structMask.id} ` +
        `through occluder on sides: ${[...occludedSides].join(', ')} ` +
        `(${structMask.polygon.length}→${extendedPolygon.length} vertices)`
      );
    } else {
      extendedStructuralMasks.push(structMask);
    }
  }

  // Reassemble: extended structural + occluders (unchanged) + other (unchanged)
  const resultMasks = [...extendedStructuralMasks, ...occluderMasks, ...otherMasks];

  return {
    extendedMasks: resultMasks,
    extendedCount: extensionDetails.length,
    extensionDetails,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMaskBounds(polygon: NormalizedPoint[]): import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion {
  let xMin = 1000, yMin = 1000, xMax = 0, yMax = 0;
  for (const pt of polygon) {
    if (pt.x < xMin) xMin = pt.x;
    if (pt.y < yMin) yMin = pt.y;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y > yMax) yMax = pt.y;
  }
  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
    coordinateSystem: 'normalized_image_0_1000',
  };
}
