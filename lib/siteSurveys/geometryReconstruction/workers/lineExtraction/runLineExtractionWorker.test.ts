/**
 * Pass 3C regression and unit tests — Segmentation Stability / Artifact Validity Patch
 * Pass 3D unit tests — Rogue Lines Fix
 *
 * Tests cover:
 * Pass 3C:
 * 1. Inferred wall bottom edge has all required LineSegment fields
 * 2. Windows/doors/garage_doors are NOT in WALL_FOUNDATION_OCCLUDER_CLASSES
 *
 * Pass 3D:
 * 3. Line on tree mask does NOT pass lineOverlapsMask for roof mask (proximity fallback rejection)
 * 4. Line with < 3 polygon hits is NOT classified (minimum overlap threshold)
 * 5. Rejected classes (bushes, fence, etc.) do NOT produce structural lines
 * 6. Near-parallel duplicate lines are merged into one
 * 7. REJECTED_CLASSES includes all Pass 3D additions
 */

import { describe, expect, it } from 'vitest';

import type {
  SemanticSegmentationMask,
  SegmentationClass,
  NormalizedPoint,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';

import {
  WALL_FOUNDATION_OCCLUDER_CLASSES,
  inferWallBottomEdge,
  REJECTED_CLASSES,
  STRUCTURE_QUALIFIED_CLASSES,
  lineOverlapsMask,
  classifyLine,
  deduplicateNearParallelLines,
  isLineEligibleMask,
  mergeCollinearLines,
  type LineSegment,
} from './runLineExtractionWorker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMask(
  segmentationClass: SegmentationClass,
  polygon: NormalizedPoint[],
  maskBounds: { x: number; y: number; width: number; height: number },
): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: `test-${segmentationClass}-${Math.random().toString(36).slice(2, 6)}`,
    fileId: 'test-file',
    segmentationClass,
    confidence: 90,
    polygon,
    maskBounds: {
      ...maskBounds,
      coordinateSystem: 'normalized_image_0_1000' as const,
    },
    workerVersion: 'test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
  };
}

function makeWallMask(): SemanticSegmentationMask {
  return makeMask(
    'wall',
    [
      { x: 200, y: 300, coordinateSystem: 'normalized_image_0_1000' },
      { x: 800, y: 300, coordinateSystem: 'normalized_image_0_1000' },
      { x: 800, y: 600, coordinateSystem: 'normalized_image_0_1000' },
      { x: 200, y: 600, coordinateSystem: 'normalized_image_0_1000' },
    ],
    { x: 200, y: 300, width: 600, height: 300 },
  );
}

function makeOccluderMask(
  segmentationClass: SegmentationClass,
): SemanticSegmentationMask {
  return makeMask(
    segmentationClass,
    [
      { x: 250, y: 550, coordinateSystem: 'normalized_image_0_1000' },
      { x: 400, y: 550, coordinateSystem: 'normalized_image_0_1000' },
      { x: 400, y: 620, coordinateSystem: 'normalized_image_0_1000' },
      { x: 250, y: 620, coordinateSystem: 'normalized_image_0_1000' },
    ],
    { x: 250, y: 550, width: 150, height: 70 },
  );
}

function makeLine(
  startX: number, startY: number,
  endX: number, endY: number,
): LineSegment {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  return {
    start: { x: startX, y: startY, coordinateSystem: 'normalized_image_0_1000' },
    end: { x: endX, y: endY, coordinateSystem: 'normalized_image_0_1000' },
    length,
    angleDeg,
  };
}

function makeRoofMask(
  x = 100, y = 50, w = 400, h = 300,
): SemanticSegmentationMask {
  return makeMask(
    'roof',
    [
      { x, y, coordinateSystem: 'normalized_image_0_1000' },
      { x: x + w, y, coordinateSystem: 'normalized_image_0_1000' },
      { x: x + w, y: y + h, coordinateSystem: 'normalized_image_0_1000' },
      { x, y: y + h, coordinateSystem: 'normalized_image_0_1000' },
    ],
    { x, y, width: w, height: h },
  );
}

// ---------------------------------------------------------------------------
// 1. INFERRED WALL BOTTOM EDGE FIELD VALIDATION (Pass 3C)
// ---------------------------------------------------------------------------

describe('inferWallBottomEdge — required field validation (Pass 3C Fix 1)', () => {
  it('returns line segments with all required LineSegment fields', () => {
    const masks = [makeWallMask()];
    const results = inferWallBottomEdge(masks, 1000, 1000);

    expect(results.length).toBeGreaterThan(0);

    for (const line of results) {
      // start must be a NormalizedPoint with coordinateSystem
      expect(line.start).toHaveProperty('x');
      expect(line.start).toHaveProperty('y');
      expect(line.start.coordinateSystem).toBe('normalized_image_0_1000');

      // end must be a NormalizedPoint with coordinateSystem
      expect(line.end).toHaveProperty('x');
      expect(line.end).toHaveProperty('y');
      expect(line.end.coordinateSystem).toBe('normalized_image_0_1000');

      // length must be a positive number
      expect(typeof line.length).toBe('number');
      expect(line.length).toBeGreaterThan(0);

      // angleDeg must be present (Pass 3C fix — was missing)
      expect(line).toHaveProperty('angleDeg');
      expect(typeof line.angleDeg).toBe('number');

      // wall_bottom_edge lines are horizontal, so angleDeg should be 0
      expect(line.angleDeg).toBe(0);

      // lineType must be wall_bottom_edge
      expect(line.lineType).toBe('wall_bottom_edge');

      // maskSupport must be a number
      expect(typeof line.maskSupport).toBe('number');
    }
  });

  it('returns empty array when no wall masks are present', () => {
    const masks = [makeOccluderMask('car')];
    const results = inferWallBottomEdge(masks, 1000, 1000);
    expect(results).toEqual([]);
  });

  it('computes maskSupport correctly with occluders present', () => {
    const masks = [
      makeWallMask(),
      makeOccluderMask('car'),
    ];
    const results = inferWallBottomEdge(masks, 1000, 1000);

    expect(results.length).toBeGreaterThan(0);
    // maskSupport should be > 0 (wall + occluder bonus)
    const line = results[0];
    expect(line.maskSupport).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. WINDOW / DOOR OCCLUDER REGRESSION (Pass 3C)
// ---------------------------------------------------------------------------

describe('WALL_FOUNDATION_OCCLUDER_CLASSES — window/door exclusion (Pass 3C Fix 5)', () => {
  it('does NOT include "window" in occluder classes', () => {
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('window')).toBe(false);
  });

  it('does NOT include "door" in occluder classes', () => {
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('door')).toBe(false);
  });

  it('does NOT include "garage_door" in occluder classes', () => {
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('garage_door')).toBe(false);
  });

  it('still includes legitimate ground-level occluders', () => {
    // These should still be present
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('car')).toBe(true);
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('bushes')).toBe(true);
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('fence')).toBe(true);
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('tree')).toBe(true);
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('ac_unit')).toBe(true);
    expect(WALL_FOUNDATION_OCCLUDER_CLASSES.has('trash_can')).toBe(true);
  });

  it('infers wall bottom edge correctly when window masks are present', () => {
    // Windows should NOT be treated as occluders blocking the foundation line
    const masks = [
      makeWallMask(),
      makeMask(
        'window',
        [
          { x: 300, y: 350, coordinateSystem: 'normalized_image_0_1000' },
          { x: 400, y: 350, coordinateSystem: 'normalized_image_0_1000' },
          { x: 400, y: 430, coordinateSystem: 'normalized_image_0_1000' },
          { x: 300, y: 430, coordinateSystem: 'normalized_image_0_1000' },
        ],
        { x: 300, y: 350, width: 100, height: 80 },
      ),
    ];
    const results = inferWallBottomEdge(masks, 1000, 1000);

    expect(results.length).toBeGreaterThan(0);
    // Window should NOT count as occluder — no occluder bonus
    const line = results[0];
    expect(line.maskSupport).toBeLessThan(20); // No occluder bonus for windows
  });
});

// ---------------------------------------------------------------------------
// 3. PASS 3D: LINE ON TREE MASK DOES NOT PASS lineOverlapsMask FOR ROOF MASK
//    (Proximity fallback rejection — Fix A)
// ---------------------------------------------------------------------------

describe('lineOverlapsMask — proximity fallback rejection (Pass 3D Fix A)', () => {
  it('line far from roof mask does NOT pass via proximity fallback', () => {
    // A roof mask in the upper portion of the image
    const roofMask = makeRoofMask(100, 50, 400, 300);

    // A line on vegetation far below the roof (100+ px away)
    // This line should NOT pass the proximity check with 10% tolerance
    const treeLine = makeLine(50, 700, 500, 720);

    expect(lineOverlapsMask(treeLine, roofMask)).toBe(false);
  });

  it('line barely grazing roof mask with < 3 polygon hits does NOT pass via proximity fallback', () => {
    // Use a smaller mask so that the 10% proximity tolerance is only 10 units
    // (not 40, which happens with a 400-wide mask). This makes it possible
    // for a grazing line to have < 5 proximity zone hits.
    //
    // Mask: makeRoofMask(300, 200, 100, 100)
    //   polygon: (300,200), (400,200), (400,300), (300,300)
    //   maskBounds: {x:300, y:200, width:100, height:100}
    //   tolerance = max(100,100)*0.1 = 10
    //   proximity zone: x=[290,410], y=[190,310]
    //
    // Line from (280,180) to (292,192): approaches from upper-left, ending
    // just inside the proximity zone corner. Only the last 4 sample points
    // (t=0.85–1.0) fall in the proximity zone, and NONE are inside the polygon.
    // Result: 0 polygon hits, 4 proximity hits → both thresholds fail → false.
    const roofMask = makeRoofMask(300, 200, 100, 100);
    const grazingLine = makeLine(280, 180, 292, 192);

    expect(lineOverlapsMask(grazingLine, roofMask)).toBe(false);
  });

  it('line clearly inside roof mask passes with 3+ hits', () => {
    const roofMask = makeRoofMask(300, 200, 100, 100);

    // A line clearly inside the roof mask
    const insideLine = makeLine(320, 250, 380, 250);

    expect(lineOverlapsMask(insideLine, roofMask)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. PASS 3D: LINE WITH < 3 INTERIOR HITS IS NOT CLASSIFIED
//    (Minimum overlap threshold — Fix B)
// ---------------------------------------------------------------------------

describe('classifyLine — minimum overlap threshold (Pass 3D Fix B)', () => {
  it('line with minimal mask overlap is NOT classified as structural', () => {
    const roofMask = makeRoofMask(100, 100, 400, 300);

    // A line that barely enters the roof mask from just below the top edge,
    // producing only ~2 sample points inside the polygon — below the
    // MIN_INTERIOR_HITS=3 threshold in classifyLine
    const barelyOverlappingLine = makeLine(150, 99, 155, 100.053);

    const result = classifyLine(barelyOverlappingLine, [roofMask]);
    expect(result).toBeNull();
  });

  it('line well inside roof mask IS classified', () => {
    const roofMask = makeRoofMask(100, 100, 400, 300);

    // A line clearly inside the roof mask
    const insideLine = makeLine(150, 200, 450, 200);

    const result = classifyLine(insideLine, [roofMask]);
    expect(result).not.toBeNull();
    // Should be classified as a roof line type
    expect(['ridge', 'eave', 'rake', 'valley', 'hip']).toContain(result);
  });

  it('no catch-all fallback for lines on non-structure classes', () => {
    // A line that overlaps a chimney mask (structure-qualified but not
    // roof/wall/fascia) should NOT be classified via catch-all fallback
    const chimneyMask = makeMask(
      'chimney',
      [
        { x: 400, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        { x: 450, y: 100, coordinateSystem: 'normalized_image_0_1000' },
        { x: 450, y: 250, coordinateSystem: 'normalized_image_0_1000' },
        { x: 400, y: 250, coordinateSystem: 'normalized_image_0_1000' },
      ],
      { x: 400, y: 100, width: 50, height: 150 },
    );

    // A vertical line through the chimney
    const chimneyLine = makeLine(425, 80, 425, 270);

    const result = classifyLine(chimneyLine, [chimneyMask]);
    // With catch-all removed, a line overlapping only a chimney (not roof/wall/fascia)
    // should NOT be classified
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. PASS 3F: ROOF REGION CONTAINMENT
//    Roof lines whose endpoints fall outside the roof masks' bounding box
//    (full-frame diagonals merged across gaps) must be rejected, while lines
//    contained within the roof region are still classified.
// ---------------------------------------------------------------------------

describe('classifyLine — roof region containment (Pass 3F)', () => {
  it('rejects a roof-overlapping diagonal whose endpoint extends far outside the roof', () => {
    // Roof mask spans (100,100)-(500,400). A diagonal starts inside the roof
    // but runs down to (900,900) — deep in the ground/foreground, well beyond
    // the roof bbox + margin. This is the full-frame "crisscross" pattern.
    const roofMask = makeRoofMask(100, 100, 400, 300);
    const runawayDiagonal = makeLine(200, 200, 900, 900);

    const result = classifyLine(runawayDiagonal, [roofMask]);
    expect(result).toBeNull();
  });

  it('still classifies a diagonal roof line contained within the roof region', () => {
    // Same roof; a diagonal that stays inside the roof bbox → legitimate rake.
    const roofMask = makeRoofMask(100, 100, 400, 300);
    const containedDiagonal = makeLine(200, 200, 450, 350);

    const result = classifyLine(containedDiagonal, [roofMask]);
    expect(result).not.toBeNull();
    expect(['ridge', 'eave', 'rake', 'valley', 'hip']).toContain(result);
  });

  it('still classifies a valley running along the seam between two adjacent roofs', () => {
    // Two roof masks side by side, combined bbox (100,100)-(500,400).
    // A diagonal near the seam, fully contained, crossing both → valley/hip.
    const roofA = makeRoofMask(100, 100, 200, 300); // (100,100)-(300,400)
    const roofB = makeRoofMask(300, 100, 200, 300); // (300,100)-(500,400)
    const seamLine = makeLine(250, 150, 350, 380);

    const result = classifyLine(seamLine, [roofA, roofB], [roofA, roofB]);
    expect(result).not.toBeNull();
    expect(['valley', 'hip']).toContain(result);
  });

  it('rejects a frame-spanning diagonal across two roofs whose ends land off-roof', () => {
    // Two roofs in the upper band; a long diagonal grazes them but its endpoints
    // sit in the sky (top-left) and ground (bottom-right) — must NOT become a valley.
    const roofA = makeRoofMask(100, 120, 250, 180); // (100,120)-(350,300)
    const roofB = makeRoofMask(380, 120, 250, 180); // (380,120)-(630,300)
    const fullFrameDiagonal = makeLine(120, 130, 950, 880);

    const result = classifyLine(fullFrameDiagonal, [roofA, roofB], [roofA, roofB]);
    expect(result).toBeNull();
  });

  it('does NOT classify a horizontal line on a WALL-only mask as eave', () => {
    // The wall->eave flood: every horizontal siding/trim/shadow line on a wall
    // used to become an "eave". A wall-only horizontal must NOT be an eave now.
    const wallMask = makeWallMask(); // (200,300)-(800,600)
    const wallHorizontal = makeLine(250, 450, 750, 450);
    const result = classifyLine(wallHorizontal, [wallMask]);
    expect(result).not.toBe('eave');
    expect(result).toBeNull();
  });

  it('still classifies a vertical line on a wall as wall_vertical', () => {
    const wallMask = makeWallMask();
    const wallVertical = makeLine(250, 320, 250, 580);
    expect(classifyLine(wallVertical, [wallMask])).toBe('wall_vertical');
  });

  it('still classifies a true eave at the wall-roof boundary (overlaps roof)', () => {
    // A horizontal line overlapping a roof mask is a real eave — caught by the
    // roof branch, unaffected by the wall-eave change.
    const roofMask = makeRoofMask(100, 100, 400, 300); // (100,100)-(500,400)
    const eave = makeLine(140, 380, 460, 380); // low in the roof region
    const result = classifyLine(eave, [roofMask]);
    expect(['eave', 'ridge', 'rake']).toContain(result);
  });

  it('keeps a low eave that hugs the roof bottom boundary (within margin)', () => {
    // Horizontal eave near the very bottom of the roof — should survive the
    // containment guard thanks to the tolerance margin.
    const roofMask = makeRoofMask(100, 100, 400, 300); // (100,100)-(500,400)
    const lowEave = makeLine(140, 390, 460, 390);

    const result = classifyLine(lowEave, [roofMask]);
    expect(result).not.toBeNull();
    expect(['eave', 'ridge', 'rake']).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// 6. PASS 3F: EXCLUDED MASKS DO NOT FEED LINE EXTRACTION
//    Masks with excludeFromGeometry=true or participatesInLines=false must be
//    filtered out before line detection/classification (mirrors plane extraction),
//    so they neither produce lines nor inflate the roof-region bbox.
// ---------------------------------------------------------------------------

describe('isLineEligibleMask — exclusion filter (Pass 3F)', () => {
  it('rejects masks flagged excludeFromGeometry=true', () => {
    const mask = makeRoofMask(0, 0, 980, 540);
    mask.excludeFromGeometry = true;
    expect(isLineEligibleMask(mask)).toBe(false);
  });

  it('rejects masks with participation.participatesInLines=false', () => {
    const mask = makeRoofMask(0, 0, 980, 540);
    mask.participation = {
      participatesInLines: false,
      participatesInPlanes: false,
      participatesInDepthFusion: false,
      participatesInPhotogrammetry: false,
    };
    expect(isLineEligibleMask(mask)).toBe(false);
  });

  it('accepts a normal roof mask with no exclusion flags', () => {
    const mask = makeRoofMask(100, 100, 400, 300);
    expect(isLineEligibleMask(mask)).toBe(true);
  });

  it('accepts a mask whose participation is undefined (defaults to eligible)', () => {
    const mask = makeRoofMask(100, 100, 400, 300);
    expect(mask.participation).toBeUndefined();
    expect(isLineEligibleMask(mask)).toBe(true);
  });

  it('accepts a mask that participates in lines even if it does not participate in planes', () => {
    const mask = makeRoofMask(100, 100, 400, 300);
    mask.participation = {
      participatesInLines: true,
      participatesInPlanes: false,
      participatesInDepthFusion: true,
      participatesInPhotogrammetry: true,
    };
    expect(isLineEligibleMask(mask)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. PASS 3F: COLLINEAR MERGE GAP CAP
//    Two collinear fragments far apart must NOT be merged into one
//    frame-spanning line; close fragments still merge across small breaks.
// ---------------------------------------------------------------------------

describe('mergeCollinearLines — gap cap (Pass 3F)', () => {
  it('does NOT merge two collinear fragments separated by a large gap', () => {
    // Two short collinear 45° fragments at opposite corners (gap ~700).
    // Pre-fix these fused into one frame-spanning diagonal "valley".
    const fragA = makeLine(100, 100, 180, 180);
    const fragC = makeLine(700, 700, 820, 820);
    const merged = mergeCollinearLines([fragA, fragC]);
    expect(merged.length).toBe(2); // stayed separate
    for (const m of merged) {
      expect(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y)).toBeLessThan(300);
    }
  });

  it('still merges two collinear fragments separated by a small break', () => {
    // A real edge broken by a shadow/chimney: collinear, gap ~40 → should merge.
    const fragA = makeLine(100, 100, 300, 100);
    const fragB = makeLine(340, 100, 540, 100);
    const merged = mergeCollinearLines([fragA, fragB]);
    expect(merged.length).toBe(1);
    expect(Math.hypot(merged[0].end.x - merged[0].start.x, merged[0].end.y - merged[0].start.y))
      .toBeGreaterThan(400);
  });
});

// ---------------------------------------------------------------------------
// 5. PASS 3D: REJECTED CLASSES EXPANDED
//    (Fix C — bushes, fence, vegetation_touching_structure, etc.)
// ---------------------------------------------------------------------------

describe('REJECTED_CLASSES — Pass 3D expansion (Fix C)', () => {
  it('includes all new Pass 3D non-structural classes', () => {
    // All classes added in Pass 3D
    expect(REJECTED_CLASSES.has('bushes')).toBe(true);
    expect(REJECTED_CLASSES.has('fence')).toBe(true);
    expect(REJECTED_CLASSES.has('vegetation_touching_structure')).toBe(true);
    expect(REJECTED_CLASSES.has('porch')).toBe(true);
    expect(REJECTED_CLASSES.has('deck')).toBe(true);
    expect(REJECTED_CLASSES.has('steps')).toBe(true);
    expect(REJECTED_CLASSES.has('railing')).toBe(true);
    expect(REJECTED_CLASSES.has('trash_can')).toBe(true);
    expect(REJECTED_CLASSES.has('person')).toBe(true);
    expect(REJECTED_CLASSES.has('ladder')).toBe(true);
    expect(REJECTED_CLASSES.has('tools')).toBe(true);
    expect(REJECTED_CLASSES.has('temporary_materials')).toBe(true);
    expect(REJECTED_CLASSES.has('ac_unit')).toBe(true);
    expect(REJECTED_CLASSES.has('existing_solar_panel')).toBe(true);
    expect(REJECTED_CLASSES.has('moss')).toBe(true);
    expect(REJECTED_CLASSES.has('algae')).toBe(true);
    expect(REJECTED_CLASSES.has('trailer')).toBe(true);
  });

  it('still includes original Pass 3C rejected classes', () => {
    expect(REJECTED_CLASSES.has('sky')).toBe(true);
    expect(REJECTED_CLASSES.has('tree')).toBe(true);
    expect(REJECTED_CLASSES.has('trees')).toBe(true);
    expect(REJECTED_CLASSES.has('grass')).toBe(true);
    expect(REJECTED_CLASSES.has('ground')).toBe(true);
    expect(REJECTED_CLASSES.has('driveway')).toBe(true);
    expect(REJECTED_CLASSES.has('gravel')).toBe(true);
    expect(REJECTED_CLASSES.has('sidewalk')).toBe(true);
    expect(REJECTED_CLASSES.has('car')).toBe(true);
    expect(REJECTED_CLASSES.has('truck')).toBe(true);
    expect(REJECTED_CLASSES.has('equipment')).toBe(true);
    expect(REJECTED_CLASSES.has('unknown')).toBe(true);
  });

  it('does NOT include structure-qualified classes', () => {
    // These should NOT be rejected — they produce structural lines
    expect(REJECTED_CLASSES.has('roof')).toBe(false);
    expect(REJECTED_CLASSES.has('wall')).toBe(false);
    expect(REJECTED_CLASSES.has('siding')).toBe(false);
    expect(REJECTED_CLASSES.has('fascia')).toBe(false);
    expect(REJECTED_CLASSES.has('soffit')).toBe(false);
    expect(REJECTED_CLASSES.has('gutter')).toBe(false);
    expect(REJECTED_CLASSES.has('chimney')).toBe(false);
    expect(REJECTED_CLASSES.has('vent_pipe')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. PASS 3D: NEAR-PARALLEL LINE DEDUPLICATION
//    (Fix G — merge duplicate lines along the same edge)
// ---------------------------------------------------------------------------

describe('deduplicateNearParallelLines — Pass 3D Fix G', () => {
  it('merges near-parallel duplicate lines of the same type', () => {
    // Two eave lines that are nearly identical (same angle, close position)
    const line1 = {
      ...makeLine(100, 400, 500, 400),
      lineType: 'eave' as const,
      maskSupport: 2,
    };
    const line2 = {
      ...makeLine(105, 403, 503, 403),
      lineType: 'eave' as const,
      maskSupport: 1,
    };

    const result = deduplicateNearParallelLines([line1, line2]);
    // Should keep only one (the first encountered, which is higher confidence)
    expect(result.length).toBe(1);
  });

  it('keeps lines of different types even if parallel', () => {
    // An eave and a wall_bottom_edge at similar positions should both be kept
    const eave = {
      ...makeLine(100, 400, 500, 400),
      lineType: 'eave' as const,
      maskSupport: 2,
    };
    const wallBottom = {
      ...makeLine(105, 403, 503, 403),
      lineType: 'wall_bottom_edge' as const,
      maskSupport: 1,
    };

    const result = deduplicateNearParallelLines([eave, wallBottom]);
    expect(result.length).toBe(2);
  });

  it('keeps lines that are far apart even if same type and angle', () => {
    // Two eave lines on opposite sides of the image
    const line1 = {
      ...makeLine(100, 400, 500, 400),
      lineType: 'eave' as const,
      maskSupport: 2,
    };
    const line2 = {
      ...makeLine(100, 800, 500, 800),
      lineType: 'eave' as const,
      maskSupport: 1,
    };

    const result = deduplicateNearParallelLines([line1, line2]);
    expect(result.length).toBe(2);
  });

  it('returns empty array for empty input', () => {
    const result = deduplicateNearParallelLines([]);
    expect(result).toEqual([]);
  });

  it('returns single line unchanged', () => {
    const line = {
      ...makeLine(100, 400, 500, 400),
      lineType: 'eave' as const,
      maskSupport: 2,
    };

    const result = deduplicateNearParallelLines([line]);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(line);
  });
});
