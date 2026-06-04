/**
 * Pass 3C regression and unit tests — Segmentation Stability / Artifact Validity Patch
 *
 * Tests cover:
 * 1. Inferred wall bottom edge has all required LineSegment fields
 * 2. Windows/doors/garage_doors are NOT in WALL_FOUNDATION_OCCLUDER_CLASSES
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

// ---------------------------------------------------------------------------
// 1. INFERRED WALL BOTTOM EDGE FIELD VALIDATION
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
// 2. WINDOW / DOOR OCCLUDER REGRESSION
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
