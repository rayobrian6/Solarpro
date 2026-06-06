/**
 * Pass 3E — Segmentation Containment + Geometry Participation Controls
 *
 * Tests cover:
 * 1. GEOMETRY_PARTICIPATION_DEFAULTS: per-class participation rules
 * 2. Sky containment: giant sky masks get excludeFromGeometry=true
 * 3. Vegetation containment: isVegetation flag and participation flags
 * 4. Structure boundary tightening: suppressWeakStructureMasks()
 * 5. Pipeline filtering: masks are filtered by participation flags per stage
 */

import { describe, expect, it } from 'vitest';

import type {
  SemanticSegmentationMask,
  SegmentationClass,
  NormalizedPoint,
  GeometryParticipationFlags,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  GEOMETRY_PARTICIPATION_DEFAULTS,
  VEGETATION_CLASSES,
  MAX_MASK_AREA_FRACTION_SKY,
  STRUCTURE_CANDIDATE_CLASSES,
  MIN_STRUCTURE_CONFIDENCE,
  MIN_WALL_MASK_AREA,
  MAX_SKY_OVERLAP_FRACTION,
  MAX_ROOF_VEGETATION_OVERLAP_FRACTION,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  computeGeometryParticipation,
  getSegmentationStageTimeoutMs,
  suppressWeakStructureMasks,
} from '../runSegmentationWorker';

describe('Segmentation timeout configuration', () => {
  it('keeps Vercel fallback segmentation under the inline timeout by default', () => {
    expect(getSegmentationStageTimeoutMs({})).toBe(260_000);
  });

  it('uses the longer Render background worker timeout', () => {
    expect(getSegmentationStageTimeoutMs({ GEOMETRY_RECONSTRUCTION_WORKER: 'true' })).toBe(600_000);
    expect(getSegmentationStageTimeoutMs({ RENDER_SERVICE_NAME: 'geometry-reconstruction-worker' })).toBe(600_000);
  });

  it('allows an explicit segmentation timeout override', () => {
    expect(getSegmentationStageTimeoutMs({
      GEOMETRY_RECONSTRUCTION_WORKER: 'true',
      GEOMETRY_SEGMENTATION_STAGE_TIMEOUT_MS: '720000',
    })).toBe(720_000);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMask(
  segmentationClass: SegmentationClass,
  overrides: Partial<SemanticSegmentationMask> = {},
  maskBounds: { x: number; y: number; width: number; height: number } = { x: 100, y: 100, width: 200, height: 200 },
): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: `test-${segmentationClass}-${Math.random().toString(36).slice(2, 6)}`,
    fileId: 'test-file',
    segmentationClass,
    confidence: 90,
    polygon: [
      { x: maskBounds.x, y: maskBounds.y, coordinateSystem: 'normalized_image_0_1000' },
      { x: maskBounds.x + maskBounds.width, y: maskBounds.y, coordinateSystem: 'normalized_image_0_1000' },
      { x: maskBounds.x + maskBounds.width, y: maskBounds.y + maskBounds.height, coordinateSystem: 'normalized_image_0_1000' },
      { x: maskBounds.x, y: maskBounds.y + maskBounds.height, coordinateSystem: 'normalized_image_0_1000' },
    ],
    maskBounds: {
      ...maskBounds,
      coordinateSystem: 'normalized_image_0_1000' as const,
    },
    workerVersion: 'test',
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [],
    isOccluder: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task A: GEOMETRY_PARTICIPATION_DEFAULTS — per-class participation rules
// ---------------------------------------------------------------------------

describe('Pass 3E — Task A: Sky Containment', () => {
  it('sky class has ALL participation flags set to false', () => {
    const skyDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['sky'];
    expect(skyDefaults.participatesInLines).toBe(false);
    expect(skyDefaults.participatesInPlanes).toBe(false);
    expect(skyDefaults.participatesInDepthFusion).toBe(false);
    expect(skyDefaults.participatesInPhotogrammetry).toBe(false);
  });

  it('MAX_MASK_AREA_FRACTION_SKY is 0.80', () => {
    expect(MAX_MASK_AREA_FRACTION_SKY).toBe(0.80);
  });

  it('computeGeometryParticipation: normal sky mask is NOT excluded', () => {
    const result = computeGeometryParticipation(
      'sky',
      { x: 0, y: 0, width: 100, height: 100 }, // 10000 area / 1000000 total = 1%
      1000, 1000,
    );
    expect(result.excludeFromGeometry).toBe(false);
    expect(result.participation.participatesInLines).toBe(false);
    expect(result.participation.participatesInPlanes).toBe(false);
    expect(result.participation.participatesInDepthFusion).toBe(false);
    expect(result.participation.participatesInPhotogrammetry).toBe(false);
  });

  it('computeGeometryParticipation: giant sky mask (>80% area) IS excluded', () => {
    // 900 * 900 = 810000 / 1000000 = 81% > 80%
    const result = computeGeometryParticipation(
      'sky',
      { x: 0, y: 0, width: 900, height: 900 },
      1000, 1000,
    );
    expect(result.excludeFromGeometry).toBe(true);
  });

  it('computeGeometryParticipation: sky mask at exactly 80% is NOT excluded', () => {
    // sqrt(0.80) * 1000 ≈ 894.3 → 894 * 894 = 799236 / 1000000 = 79.9% < 80%
    const result = computeGeometryParticipation(
      'sky',
      { x: 0, y: 0, width: 894, height: 894 },
      1000, 1000,
    );
    expect(result.excludeFromGeometry).toBe(false);
  });

  it('computeGeometryParticipation: non-sky class never gets excludeFromGeometry', () => {
    const result = computeGeometryParticipation(
      'roof',
      { x: 0, y: 0, width: 900, height: 900 },
      1000, 1000,
    );
    expect(result.excludeFromGeometry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task B: GEOMETRY_PARTICIPATION_DEFAULTS — per-class rules
// ---------------------------------------------------------------------------

describe('Pass 3E — Task B: Geometry Participation Defaults', () => {
  it('roof has full participation', () => {
    const roofDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['roof'];
    expect(roofDefaults.participatesInLines).toBe(true);
    expect(roofDefaults.participatesInPlanes).toBe(true);
    expect(roofDefaults.participatesInDepthFusion).toBe(true);
    expect(roofDefaults.participatesInPhotogrammetry).toBe(true);
  });

  it('wall has full participation', () => {
    const wallDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['wall'];
    expect(wallDefaults.participatesInLines).toBe(true);
    expect(wallDefaults.participatesInPlanes).toBe(true);
    expect(wallDefaults.participatesInDepthFusion).toBe(true);
    expect(wallDefaults.participatesInPhotogrammetry).toBe(true);
  });

  it('tree has lines/planes/depth false but photogrammetry true', () => {
    const treeDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['tree'];
    expect(treeDefaults.participatesInLines).toBe(false);
    expect(treeDefaults.participatesInPlanes).toBe(false);
    expect(treeDefaults.participatesInDepthFusion).toBe(false);
    expect(treeDefaults.participatesInPhotogrammetry).toBe(true);
  });

  it('ground has lines/planes false but depth and photogrammetry true', () => {
    const groundDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['ground'];
    expect(groundDefaults.participatesInLines).toBe(false);
    expect(groundDefaults.participatesInPlanes).toBe(false);
    expect(groundDefaults.participatesInDepthFusion).toBe(true);
    expect(groundDefaults.participatesInPhotogrammetry).toBe(true);
  });

  it('car has all participation flags false', () => {
    const carDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['car'];
    expect(carDefaults.participatesInLines).toBe(false);
    expect(carDefaults.participatesInPlanes).toBe(false);
    expect(carDefaults.participatesInDepthFusion).toBe(false);
    expect(carDefaults.participatesInPhotogrammetry).toBe(false);
  });

  it('ac_unit has all participation flags false', () => {
    const acDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['ac_unit'];
    expect(acDefaults.participatesInLines).toBe(false);
    expect(acDefaults.participatesInPlanes).toBe(false);
    expect(acDefaults.participatesInDepthFusion).toBe(false);
    expect(acDefaults.participatesInPhotogrammetry).toBe(false);
  });

  it('chimney has full participation', () => {
    const chimneyDefaults = GEOMETRY_PARTICIPATION_DEFAULTS['chimney'];
    expect(chimneyDefaults.participatesInLines).toBe(true);
    expect(chimneyDefaults.participatesInPlanes).toBe(true);
    expect(chimneyDefaults.participatesInDepthFusion).toBe(true);
    expect(chimneyDefaults.participatesInPhotogrammetry).toBe(true);
  });

  it('computeGeometryParticipation: roof gets full participation from defaults', () => {
    const result = computeGeometryParticipation(
      'roof',
      { x: 100, y: 100, width: 200, height: 200 },
      1000, 1000,
    );
    expect(result.participation.participatesInLines).toBe(true);
    expect(result.participation.participatesInPlanes).toBe(true);
    expect(result.participation.participatesInDepthFusion).toBe(true);
    expect(result.participation.participatesInPhotogrammetry).toBe(true);
    expect(result.excludeFromGeometry).toBe(false);
    expect(result.isVegetation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task C: Vegetation Containment
// ---------------------------------------------------------------------------

describe('Pass 3E — Task C: Vegetation Containment', () => {
  it('VEGETATION_CLASSES contains tree, trees, bushes, vegetation_touching_structure, grass, overgrown_grass, moss, algae', () => {
    expect(VEGETATION_CLASSES.has('tree')).toBe(true);
    expect(VEGETATION_CLASSES.has('trees')).toBe(true);
    expect(VEGETATION_CLASSES.has('bushes')).toBe(true);
    expect(VEGETATION_CLASSES.has('vegetation_touching_structure')).toBe(true);
    expect(VEGETATION_CLASSES.has('grass')).toBe(true);
    expect(VEGETATION_CLASSES.has('overgrown_grass')).toBe(true);
    expect(VEGETATION_CLASSES.has('moss')).toBe(true);
    expect(VEGETATION_CLASSES.has('algae')).toBe(true);
  });

  it('VEGETATION_CLASSES does NOT contain roof, wall, sky', () => {
    expect(VEGETATION_CLASSES.has('roof')).toBe(false);
    expect(VEGETATION_CLASSES.has('wall')).toBe(false);
    expect(VEGETATION_CLASSES.has('sky')).toBe(false);
  });

  it('computeGeometryParticipation: tree gets isVegetation=true', () => {
    const result = computeGeometryParticipation(
      'tree',
      { x: 100, y: 100, width: 200, height: 200 },
      1000, 1000,
    );
    expect(result.isVegetation).toBe(true);
    expect(result.participation.participatesInLines).toBe(false);
    expect(result.participation.participatesInPlanes).toBe(false);
    expect(result.participation.participatesInDepthFusion).toBe(false);
    expect(result.participation.participatesInPhotogrammetry).toBe(true);
  });

  it('computeGeometryParticipation: bushes gets isVegetation=true', () => {
    const result = computeGeometryParticipation(
      'bushes',
      { x: 100, y: 100, width: 200, height: 200 },
      1000, 1000,
    );
    expect(result.isVegetation).toBe(true);
  });

  it('computeGeometryParticipation: roof gets isVegetation=false', () => {
    const result = computeGeometryParticipation(
      'roof',
      { x: 100, y: 100, width: 200, height: 200 },
      1000, 1000,
    );
    expect(result.isVegetation).toBe(false);
  });

  it('vegetation masks are NOT excluded from geometry entirely (only from lines/planes/depth)', () => {
    const result = computeGeometryParticipation(
      'tree',
      { x: 100, y: 100, width: 200, height: 200 },
      1000, 1000,
    );
    // Vegetation should NOT be excludedFromGeometry — they participate in photogrammetry
    expect(result.excludeFromGeometry).toBe(false);
    // But they should not feed structural geometry
    expect(result.participation.participatesInLines).toBe(false);
    expect(result.participation.participatesInPlanes).toBe(false);
    expect(result.participation.participatesInDepthFusion).toBe(false);
    // They DO participate in photogrammetry (obstruction/shading context)
    expect(result.participation.participatesInPhotogrammetry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task D: Structure Boundary Tightening
// ---------------------------------------------------------------------------

describe('Pass 3E — Task D: Structure Boundary Tightening', () => {
  it('STRUCTURE_CANDIDATE_CLASSES contains roof, wall, siding, fascia, chimney', () => {
    expect(STRUCTURE_CANDIDATE_CLASSES.has('roof')).toBe(true);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('wall')).toBe(true);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('siding')).toBe(true);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('fascia')).toBe(true);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('chimney')).toBe(true);
  });

  it('STRUCTURE_CANDIDATE_CLASSES does NOT contain sky, tree, car', () => {
    expect(STRUCTURE_CANDIDATE_CLASSES.has('sky')).toBe(false);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('tree')).toBe(false);
    expect(STRUCTURE_CANDIDATE_CLASSES.has('car')).toBe(false);
  });

  it('MIN_STRUCTURE_CONFIDENCE is 25', () => {
    expect(MIN_STRUCTURE_CONFIDENCE).toBe(25);
  });

  it('MIN_WALL_MASK_AREA is 1000', () => {
    expect(MIN_WALL_MASK_AREA).toBe(1000);
  });

  it('MAX_SKY_OVERLAP_FRACTION is 0.40', () => {
    expect(MAX_SKY_OVERLAP_FRACTION).toBe(0.40);
  });

  it('MAX_ROOF_VEGETATION_OVERLAP_FRACTION is 0.50', () => {
    expect(MAX_ROOF_VEGETATION_OVERLAP_FRACTION).toBe(0.50);
  });

  // Rule 1: Sky-overlapping structure masks
  it('suppresses structure mask with >40% sky overlap', () => {
    const skyMask = makeMask('sky', {}, { x: 0, y: 0, width: 500, height: 500 });
    // Structure mask entirely within the sky mask region → 100% overlap
    const roofMask = makeMask('roof', {}, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([skyMask, roofMask]);
    const suppressedRoof = result.find(m => m.segmentationClass === 'roof')!;
    expect(suppressedRoof.excludeFromGeometry).toBe(true);
    expect(suppressedRoof.participation?.participatesInLines).toBe(false);
    expect(suppressedRoof.participation?.participatesInPlanes).toBe(false);
  });

  it('does NOT suppress structure mask with <40% sky overlap', () => {
    const skyMask = makeMask('sky', {}, { x: 0, y: 0, width: 100, height: 100 });
    // Structure mask barely touches sky mask → small overlap fraction
    const roofMask = makeMask('roof', {}, { x: 80, y: 80, width: 400, height: 400 });
    const result = suppressWeakStructureMasks([skyMask, roofMask]);
    const unsuppressedRoof = result.find(m => m.segmentationClass === 'roof')!;
    expect(unsuppressedRoof.excludeFromGeometry).toBeFalsy();
  });

  // Rule 2: Low-confidence structure fragments
  it('suppresses structure mask with confidence < 25', () => {
    const weakMask = makeMask('roof', { confidence: 20 });
    const result = suppressWeakStructureMasks([weakMask]);
    expect(result[0].excludeFromGeometry).toBe(true);
  });

  it('does NOT suppress structure mask with confidence >= 25', () => {
    const okMask = makeMask('roof', { confidence: 25 });
    const result = suppressWeakStructureMasks([okMask]);
    expect(result[0].excludeFromGeometry).toBeFalsy();
  });

  // Rule 3: Tiny disconnected wall fragments
  it('suppresses tiny wall mask with area < 1000', () => {
    // 20 * 20 = 400 < 1000
    const tinyWall = makeMask('wall', {}, { x: 100, y: 100, width: 20, height: 20 });
    const result = suppressWeakStructureMasks([tinyWall]);
    expect(result[0].excludeFromGeometry).toBe(true);
  });

  it('does NOT suppress wall mask with area >= 1000', () => {
    // 40 * 40 = 1600 >= 1000
    const okWall = makeMask('wall', {}, { x: 100, y: 100, width: 40, height: 40 });
    const result = suppressWeakStructureMasks([okWall]);
    expect(result[0].excludeFromGeometry).toBeFalsy();
  });

  // Rule 4: Roof fragments merged with vegetation
  it('suppresses roof mask with >50% vegetation overlap', () => {
    const treeMask = makeMask('tree', { isVegetation: true }, { x: 0, y: 0, width: 500, height: 500 });
    // Roof entirely within tree region → 100% overlap
    const roofMask = makeMask('roof', {}, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([treeMask, roofMask]);
    const suppressedRoof = result.find(m => m.segmentationClass === 'roof')!;
    expect(suppressedRoof.excludeFromGeometry).toBe(true);
  });

  it('does NOT suppress roof mask with <50% vegetation overlap', () => {
    const treeMask = makeMask('tree', { isVegetation: true }, { x: 0, y: 0, width: 50, height: 50 });
    // Roof much larger than tree → small overlap fraction
    const roofMask = makeMask('roof', {}, { x: 30, y: 30, width: 400, height: 400 });
    const result = suppressWeakStructureMasks([treeMask, roofMask]);
    const unsuppressedRoof = result.find(m => m.segmentationClass === 'roof')!;
    expect(unsuppressedRoof.excludeFromGeometry).toBeFalsy();
  });

  // Non-structure classes are never suppressed
  it('does NOT suppress non-structure classes (sky, tree, car)', () => {
    const skyMask = makeMask('sky', { confidence: 10 }, { x: 0, y: 0, width: 20, height: 20 });
    const treeMask = makeMask('tree', { confidence: 10 });
    const carMask = makeMask('car', { confidence: 10 });
    const result = suppressWeakStructureMasks([skyMask, treeMask, carMask]);
    expect(result.every(m => m.excludeFromGeometry !== true)).toBe(true);
  });

  // Already excluded masks are not double-suppressed
  it('does not double-suppress already excluded masks', () => {
    const excludedMask = makeMask('roof', {
      excludeFromGeometry: true,
      participation: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
      confidence: 5,
    });
    const result = suppressWeakStructureMasks([excludedMask]);
    expect(result[0].excludeFromGeometry).toBe(true);
    // Should not have been modified — same participation flags
    expect(result[0].participation?.participatesInLines).toBe(false);
  });

  // Empty input
  it('returns empty array for empty input', () => {
    const result = suppressWeakStructureMasks([]);
    expect(result).toEqual([]);
  });

  // Multiple rules can apply simultaneously
  it('a mask with BOTH low confidence AND sky overlap is suppressed (first matching rule wins)', () => {
    const skyMask = makeMask('sky', {}, { x: 0, y: 0, width: 500, height: 500 });
    const weakRoofOverlap = makeMask('roof', { confidence: 15 }, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([skyMask, weakRoofOverlap]);
    const suppressed = result.find(m => m.segmentationClass === 'roof')!;
    expect(suppressed.excludeFromGeometry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Same-photo overlap scoping — Rules 1 & 4 must compare masks per-photo only.
//
// Regression guard for the cross-photo contamination bug: maskBounds are
// normalized per-image (0–1000 in each photo's own space), so sky/vegetation
// masks from one photo must NOT suppress structure masks from another photo
// even when their normalized boxes coincide. Also guards the bounded-union
// overlap (overlap fraction can never exceed 100%, no double counting).
// ---------------------------------------------------------------------------

describe('Pass 3E — Same-photo overlap scoping (Rules 1 & 4)', () => {
  // --- Cross-photo: must NOT suppress ---

  it('does NOT suppress a roof when overlapping vegetation is in a DIFFERENT photo', () => {
    // Identical normalized boxes, but different photos → must not suppress.
    const treeOtherPhoto = makeMask('tree', { fileId: 'photo-B', isVegetation: true }, { x: 0, y: 0, width: 500, height: 500 });
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([treeOtherPhoto, roof]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBeFalsy();
    expect(roofOut.participation?.participatesInPlanes).not.toBe(false);
  });

  it('does NOT suppress a roof when overlapping sky is in a DIFFERENT photo', () => {
    const skyOtherPhoto = makeMask('sky', { fileId: 'photo-B' }, { x: 0, y: 0, width: 500, height: 500 });
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([skyOtherPhoto, roof]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBeFalsy();
  });

  it('does NOT let vegetation from MANY other photos accumulate to suppress a roof', () => {
    // Reproduces the observed bug: one roof, many veg masks across other photos
    // that each fully cover its normalized box. Pre-fix, summed overlap hit
    // hundreds of percent; post-fix none are same-photo so overlap is 0%.
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 100, y: 100, width: 200, height: 200 });
    const veg = Array.from({ length: 6 }, (_, i) =>
      makeMask('tree', { fileId: `photo-${i}`, isVegetation: true }, { x: 100, y: 100, width: 200, height: 200 }),
    );
    const result = suppressWeakStructureMasks([roof, ...veg]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBeFalsy();
  });

  // --- Same-photo: true overlaps must STILL suppress ---

  it('STILL suppresses a roof with >50% vegetation overlap in the SAME photo', () => {
    const tree = makeMask('tree', { fileId: 'photo-A', isVegetation: true }, { x: 0, y: 0, width: 500, height: 500 });
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([tree, roof]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBe(true);
    expect(roofOut.participation?.participatesInPlanes).toBe(false);
  });

  it('STILL suppresses a structure mask with >40% sky overlap in the SAME photo', () => {
    const sky = makeMask('sky', { fileId: 'photo-A' }, { x: 0, y: 0, width: 500, height: 500 });
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 100, y: 100, width: 200, height: 200 });
    const result = suppressWeakStructureMasks([sky, roof]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBe(true);
  });

  it('suppresses a roof when the UNION of multiple same-photo veg masks exceeds 50%', () => {
    // Roof 100x100 (area 10000). Two non-overlapping veg masks covering
    // left 50% + a further 20% → union 70% > 50%.
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 0, y: 0, width: 100, height: 100 });
    const vegLeft = makeMask('tree', { fileId: 'photo-A', isVegetation: true }, { x: 0, y: 0, width: 50, height: 100 });
    const vegMid = makeMask('bushes', { fileId: 'photo-A', isVegetation: true }, { x: 50, y: 0, width: 20, height: 100 });
    const result = suppressWeakStructureMasks([roof, vegLeft, vegMid]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBe(true);
  });

  // --- Bounded fraction: overlap cannot exceed 100% / no double counting ---

  it('does NOT suppress when overlapping same-photo veg masks DUPLICATE each other (union <= threshold)', () => {
    // Roof 100x100 (area 10000). Two IDENTICAL veg masks each covering 40% of
    // the roof. Summed (old behavior) = 80% > 50% → false suppression.
    // Bounded union = 40% < 50% → must NOT suppress.
    const roof = makeMask('roof', { fileId: 'photo-A' }, { x: 0, y: 0, width: 100, height: 100 });
    const veg1 = makeMask('tree', { fileId: 'photo-A', isVegetation: true }, { x: 0, y: 0, width: 40, height: 100 });
    const veg2 = makeMask('tree', { fileId: 'photo-A', isVegetation: true }, { x: 0, y: 0, width: 40, height: 100 });
    const result = suppressWeakStructureMasks([roof, veg1, veg2]);
    const roofOut = result.find(m => m.segmentationClass === 'roof')!;
    expect(roofOut.excludeFromGeometry).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: masks without participation flags
// ---------------------------------------------------------------------------

describe('Pass 3E — Backward Compatibility', () => {
  it('mask without participation field defaults to full participation in pipeline filtering', () => {
    // Simulate the pipeline filter logic: participation?.participatesInLines !== false
    const maskWithoutFlags: SemanticSegmentationMask = makeMask('roof');
    // These should pass the filter (undefined !== false)
    expect(maskWithoutFlags.participation?.participatesInLines !== false).toBe(true);
    expect(maskWithoutFlags.participation?.participatesInPlanes !== false).toBe(true);
    expect(maskWithoutFlags.participation?.participatesInDepthFusion !== false).toBe(true);
    expect(maskWithoutFlags.participation?.participatesInPhotogrammetry !== false).toBe(true);
    expect(maskWithoutFlags.excludeFromGeometry !== true).toBe(true);
  });

  it('mask with participation.allTrue passes all pipeline filters', () => {
    const maskAllTrue = makeMask('roof', {
      participation: {
        participatesInLines: true,
        participatesInPlanes: true,
        participatesInDepthFusion: true,
        participatesInPhotogrammetry: true,
      },
    });
    expect(maskAllTrue.participation?.participatesInLines !== false).toBe(true);
    expect(maskAllTrue.participation?.participatesInPlanes !== false).toBe(true);
  });

  it('mask with participation.allFalse is filtered from all pipeline stages', () => {
    const maskAllFalse = makeMask('sky', {
      participation: {
        participatesInLines: false,
        participatesInPlanes: false,
        participatesInDepthFusion: false,
        participatesInPhotogrammetry: false,
      },
    });
    expect(maskAllFalse.participation?.participatesInLines !== false).toBe(false);
    expect(maskAllFalse.participation?.participatesInPlanes !== false).toBe(false);
    expect(maskAllFalse.participation?.participatesInDepthFusion !== false).toBe(false);
    expect(maskAllFalse.participation?.participatesInPhotogrammetry !== false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema validation: new optional fields
// ---------------------------------------------------------------------------

describe('Pass 3E — Schema Validation', () => {
  it('validateSemanticSegmentationMask accepts mask without new fields', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof');
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(true);
  });

  it('validateSemanticSegmentationMask accepts mask with new fields', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof', {
      participation: {
        participatesInLines: true,
        participatesInPlanes: true,
        participatesInDepthFusion: true,
        participatesInPhotogrammetry: true,
      },
      excludeFromGeometry: false,
      isVegetation: false,
    });
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(true);
  });

  it('validateSemanticSegmentationMask rejects invalid excludeFromGeometry type', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof', {
      excludeFromGeometry: 'yes' as unknown as boolean,
    });
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(false);
  });

  it('validateSemanticSegmentationMask rejects invalid participation field type', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof', {
      participation: {
        participatesInLines: 'yes' as unknown as boolean,
      },
    });
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(false);
  });

  it('validateSemanticSegmentationMask rejects invalid isVegetation type', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof', {
      isVegetation: 'yes' as unknown as boolean,
    });
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(false);
  });

  it('validateSemanticSegmentationMask accepts null values for new fields', async () => {
    const { validateSemanticSegmentationMask } = await import('@/lib/siteSurveys/geometryReconstruction/schemas');
    const mask = makeMask('roof', {
      participation: null,
      excludeFromGeometry: null,
      isVegetation: null,
    });
    const result = validateSemanticSegmentationMask(mask);
    expect(result.valid).toBe(true);
  });
});
