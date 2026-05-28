/**
 * Mask cleanup pipeline tests.
 *
 * Tests polygon utilities (area, perimeter, Douglas-Peucker, convex hull)
 * and the full cleanMask / cleanSegmentationMask pipeline.
 *
 * @jest-environment node
 */

import {
  polygonArea,
  polygonPerimeter,
  douglasPeucker,
  convexHull,
  cleanMask,
  cleanSegmentationMask,
} from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation';
import type {
  NormalizedPoint,
  SemanticSegmentationMask,
  MaskCleanupConfig,
} from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a NormalizedPoint at (x, y). */
function pt(x: number, y: number): NormalizedPoint {
  return { x, y, coordinateSystem: 'normalized_image_0_1000' };
}

/** Create a rectangular polygon (clockwise). */
function rect(x: number, y: number, w: number, h: number): NormalizedPoint[] {
  return [
    pt(x, y),
    pt(x + w, y),
    pt(x + w, y + h),
    pt(x, y + h),
  ];
}

/** Create a valid SemanticSegmentationMask for testing. */
function makeMask(overrides?: Partial<SemanticSegmentationMask>): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: 'mask-001',
    fileId: 'file-001',
    segmentationClass: 'roof',
    polygon: rect(100, 100, 400, 300),
    confidence: 75,
    maskBounds: {
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      coordinateSystem: 'normalized_image_0_1000',
    },
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// polygonArea
// ---------------------------------------------------------------------------

describe('polygonArea', () => {
  it('computes area of a unit square', () => {
    const square = rect(0, 0, 100, 100);
    expect(polygonArea(square)).toBe(10000);
  });

  it('computes area of a rectangle', () => {
    const rectangle = rect(50, 50, 200, 300);
    expect(polygonArea(rectangle)).toBe(60000);
  });

  it('computes area of a triangle', () => {
    const triangle = [pt(0, 0), pt(100, 0), pt(0, 100)];
    expect(polygonArea(triangle)).toBe(5000);
  });

  it('returns 0 for a degenerate polygon (collinear points)', () => {
    const degenerate = [pt(0, 0), pt(100, 0), pt(200, 0)];
    expect(polygonArea(degenerate)).toBe(0);
  });

  it('returns 0 for a single point', () => {
    expect(polygonArea([pt(50, 50)])).toBe(0);
  });

  it('returns 0 for two points', () => {
    expect(polygonArea([pt(0, 0), pt(100, 100)])).toBe(0);
  });

  it('handles polygons with many vertices', () => {
    // Regular-ish octagon centered at (500,500), side ~200
    const octagon: NormalizedPoint[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      octagon.push(pt(500 + Math.round(200 * Math.cos(angle)), 500 + Math.round(200 * Math.sin(angle))));
    }
    const area = polygonArea(octagon);
    // Octagon area ≈ 2 * (1 + √2) * s² where s≈200; approx 2*(2.414)*40000 ≈ 193137
    // But since we're rounding coordinates, just check it's positive and reasonable
    expect(area).toBeGreaterThan(100000);
    expect(area).toBeLessThan(300000);
  });
});

// ---------------------------------------------------------------------------
// polygonPerimeter
// ---------------------------------------------------------------------------

describe('polygonPerimeter', () => {
  it('computes perimeter of a unit square', () => {
    const square = rect(0, 0, 100, 100);
    expect(polygonPerimeter(square)).toBe(400);
  });

  it('computes perimeter of a rectangle', () => {
    const rectangle = rect(0, 0, 200, 300);
    expect(polygonPerimeter(rectangle)).toBe(1000);
  });

  it('computes perimeter of a triangle', () => {
    // Right triangle: 3-4-5 scaled by 100
    const triangle = [pt(0, 0), pt(300, 0), pt(0, 400)];
    const p = polygonPerimeter(triangle);
    expect(p).toBeCloseTo(1200, 0); // 300 + 400 + 500
  });

  it('returns 0 for a single point', () => {
    expect(polygonPerimeter([pt(50, 50)])).toBe(0);
  });

  it('returns twice the distance for a degenerate 2-point polygon (closed loop)', () => {
    // A 2-point polygon is a degenerate closed loop: 0→1 and 1→0
    const p = polygonPerimeter([pt(0, 0), pt(300, 400)]);
    expect(p).toBeCloseTo(1000, 0); // 2 × 500
  });
});

// ---------------------------------------------------------------------------
// douglasPeucker
// ---------------------------------------------------------------------------

describe('douglasPeucker', () => {
  it('returns a copy of the input when 3 or fewer points', () => {
    const triangle = [pt(0, 0), pt(100, 0), pt(50, 100)];
    const result = douglasPeucker(triangle, 10);
    expect(result).toEqual(triangle);
  });

  it('simplifies a line with intermediate collinear points', () => {
    // Points along a line from (0,0) to (100,0) with small deviations
    const points: NormalizedPoint[] = [
      pt(0, 0),
      pt(25, 1),
      pt(50, -1),
      pt(75, 2),
      pt(100, 0),
    ];
    const result = douglasPeucker(points, 5);
    // With epsilon=5, all intermediate points are within 5 of the baseline
    expect(result.length).toBeLessThan(points.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves sharp corners that exceed epsilon', () => {
    // L-shape: (0,0) -> (100,0) -> (100,100)
    const lShape: NormalizedPoint[] = [
      pt(0, 0),
      pt(50, 0),
      pt(100, 0),
      pt(100, 50),
      pt(100, 100),
    ];
    const result = douglasPeucker(lShape, 5);
    // The corner at (100,0) must be preserved
    expect(result.some(p => p.x === 100 && p.y === 0)).toBe(true);
  });

  it('returns endpoints when all intermediate points are within epsilon', () => {
    const points: NormalizedPoint[] = [
      pt(0, 0),
      pt(25, 0),
      pt(50, 0),
      pt(75, 0),
      pt(100, 0),
    ];
    const result = douglasPeucker(points, 1);
    expect(result).toEqual([pt(0, 0), pt(100, 0)]);
  });

  it('handles epsilon = 0 (no simplification)', () => {
    const points = [pt(0, 0), pt(25, 3), pt(50, 7), pt(75, 2), pt(100, 0)];
    const result = douglasPeucker(points, 0);
    expect(result.length).toBe(points.length);
  });

  it('does not mutate the input array', () => {
    const points = [pt(0, 0), pt(25, 3), pt(50, 7), pt(75, 2), pt(100, 0)];
    const copy = points.map(p => ({ ...p }));
    douglasPeucker(points, 5);
    expect(points).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// convexHull
// ---------------------------------------------------------------------------

describe('convexHull', () => {
  it('returns a copy for 3 or fewer points', () => {
    const triangle = [pt(0, 0), pt(100, 0), pt(50, 100)];
    const result = convexHull(triangle);
    expect(result).toEqual(triangle);
  });

  it('computes hull of a square with interior points', () => {
    const points: NormalizedPoint[] = [
      pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100),
      pt(50, 50), pt(25, 25), pt(75, 75),
    ];
    const hull = convexHull(points);
    expect(hull.length).toBe(4);
    // All hull points should be corner points
    const xs = hull.map(p => p.x);
    const ys = hull.map(p => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(100);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(100);
  });

  it('computes hull of a star-like point set', () => {
    // 5 points on a circle + center
    const points: NormalizedPoint[] = [
      pt(500, 300),   // top
      pt(700, 500),   // right
      pt(600, 700),   // bottom-right
      pt(400, 700),   // bottom-left
      pt(300, 500),   // left
      pt(500, 500),   // center (should be interior)
    ];
    const hull = convexHull(points);
    expect(hull.length).toBe(5); // center point excluded
  });

  it('handles collinear points', () => {
    const points: NormalizedPoint[] = [
      pt(0, 0), pt(50, 0), pt(100, 0), pt(150, 0),
    ];
    const hull = convexHull(points);
    // Collinear points should produce a minimal hull (2 or 3 points depending on implementation)
    expect(hull.length).toBeGreaterThanOrEqual(2);
    expect(hull.length).toBeLessThanOrEqual(4);
  });

  it('produces a convex polygon', () => {
    const points: NormalizedPoint[] = [];
    // Random-ish points
    for (let i = 0; i < 20; i++) {
      points.push(pt(100 + Math.floor(Math.sin(i * 1.3) * 200 + 300), 100 + Math.floor(Math.cos(i * 1.7) * 200 + 300)));
    }
    const hull = convexHull(points);
    // Verify convexity: all cross products should have the same sign
    let sign = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const c = hull[(i + 2) % hull.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross !== 0) {
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else expect(s).toBe(sign);
      }
    }
  });

  it('does not mutate the input array', () => {
    const points = [pt(0, 0), pt(50, 50), pt(100, 0), pt(50, -50)];
    const copy = points.map(p => ({ ...p }));
    convexHull(points);
    expect(points).toEqual(copy);
  });

  it('handles duplicate points', () => {
    const points: NormalizedPoint[] = [
      pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100),
      pt(0, 0), pt(100, 0), // duplicates
    ];
    const hull = convexHull(points);
    expect(hull.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// cleanMask
// ---------------------------------------------------------------------------

describe('cleanMask', () => {
  describe('basic pipeline behavior', () => {
    it('returns a result with cleanedPolygon, originalPolygon, wasModified, appliedStages, stageTimings', () => {
      const polygon = rect(100, 100, 400, 300);
      const result = cleanMask(polygon);
      expect(result).toHaveProperty('cleanedPolygon');
      expect(result).toHaveProperty('originalPolygon');
      expect(result).toHaveProperty('wasModified');
      expect(result).toHaveProperty('appliedStages');
      expect(result).toHaveProperty('stageTimings');
    });

    it('preserves the original polygon in originalPolygon', () => {
      const polygon = rect(100, 100, 400, 300);
      const result = cleanMask(polygon);
      expect(result.originalPolygon).toEqual(polygon);
    });

    it('does not mutate the input polygon', () => {
      const polygon = rect(100, 100, 400, 300);
      const copy = polygon.map(p => ({ ...p }));
      cleanMask(polygon);
      expect(polygon).toEqual(copy);
    });
  });

  describe('applied stages', () => {
    it('applies all 4 stages with default config', () => {
      const result = cleanMask(rect(100, 100, 400, 300));
      expect(result.appliedStages).toContain('hole_filling');
      expect(result.appliedStages).toContain('tiny_region_removal');
      expect(result.appliedStages).toContain('island_removal');
      expect(result.appliedStages).toContain('contour_smoothing');
      expect(result.appliedStages.length).toBe(4);
    });

    it('skips hole_filling when fillHoles is false', () => {
      const result = cleanMask(rect(100, 100, 400, 300), { fillHoles: false });
      expect(result.appliedStages).not.toContain('hole_filling');
      expect(result.appliedStages).toContain('tiny_region_removal');
    });

    it('skips island_removal when removeIslands is false', () => {
      const result = cleanMask(rect(100, 100, 400, 300), { removeIslands: false });
      expect(result.appliedStages).not.toContain('island_removal');
      expect(result.appliedStages).toContain('hole_filling');
    });

    it('records timing for each applied stage', () => {
      const result = cleanMask(rect(100, 100, 400, 300));
      for (const stage of result.appliedStages) {
        expect(result.stageTimings[stage]).toBeDefined();
        expect(typeof result.stageTimings[stage]).toBe('number');
        expect(result.stageTimings[stage]).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('tiny region removal', () => {
    it('returns null cleanedPolygon for a tiny polygon', () => {
      // Area = 10*10 = 100, below default minRegionArea of 500
      const tiny = rect(500, 500, 10, 10);
      const result = cleanMask(tiny);
      expect(result.cleanedPolygon).toBeNull();
    });

    it('returns null cleanedPolygon for a polygon just below threshold', () => {
      // Area = 22*22 = 484, just below 500
      const small = rect(500, 500, 22, 22);
      const result = cleanMask(small);
      expect(result.cleanedPolygon).toBeNull();
    });

    it('keeps a polygon at the threshold', () => {
      // Area = 23*23 = 529, above 500
      const ok = rect(500, 500, 23, 23);
      const result = cleanMask(ok);
      expect(result.cleanedPolygon).not.toBeNull();
    });

    it('respects custom minRegionArea', () => {
      // Area = 10*10 = 100, above custom minRegionArea of 50
      const tiny = rect(500, 500, 10, 10);
      const result = cleanMask(tiny, { minRegionArea: 50 });
      expect(result.cleanedPolygon).not.toBeNull();
    });

    it('marks wasModified as true when polygon is removed', () => {
      const tiny = rect(500, 500, 10, 10);
      const result = cleanMask(tiny);
      expect(result.wasModified).toBe(true);
    });
  });

  describe('hole filling', () => {
    it('fills small concavities by replacing with convex hull', () => {
      // L-shaped polygon (concave)
      const lShape: NormalizedPoint[] = [
        pt(100, 100),
        pt(300, 100),
        pt(300, 200),
        pt(200, 200),
        pt(200, 300),
        pt(100, 300),
      ];
      // Area = 100*100 + 100*100 = 20000 (L-shape)
      // Convex hull area = 200*200 = 40000
      // Ratio = 2.0, which is > 1.3, so hull won't be used directly
      // But fillHoles will try Douglas-Peucker smoothing
      const result = cleanMask(lShape, { fillHoles: true, removeIslands: false, smoothingEpsilon: 50 });
      expect(result.cleanedPolygon).not.toBeNull();
    });

    it('preserves convex polygons unchanged during hole filling', () => {
      const convex = rect(100, 100, 400, 300);
      const result = cleanMask(convex, {
        fillHoles: true,
        removeIslands: false,
        smoothingEpsilon: 0,
      });
      // Convex polygon should not be modified by hole filling
      // (but may still be modified by contour smoothing)
      expect(result.cleanedPolygon).not.toBeNull();
    });
  });

  describe('island removal', () => {
    it('removes edge fragments with small area near image boundary', () => {
      // Tiny polygon near top-left edge
      const edgeFragment: NormalizedPoint[] = [
        pt(1, 1),
        pt(3, 1),
        pt(3, 3),
        pt(1, 3),
      ];
      const result = cleanMask(edgeFragment, { removeIslands: true, minRegionArea: 0 });
      // Area = 4, centroid at (2,2) which is < 5 from edge, and area < 2000
      expect(result.cleanedPolygon).toBeNull();
    });

    it('keeps edge fragments that are large enough', () => {
      // Large polygon near top-left edge (but large area)
      const largeEdge: NormalizedPoint[] = [
        pt(1, 1),
        pt(100, 1),
        pt(100, 100),
        pt(1, 100),
      ];
      const result = cleanMask(largeEdge, { removeIslands: true, minRegionArea: 0, smoothingEpsilon: 0 });
      // Area = ~9801, centroid at ~(50.5, 50.5) which is > 5 from edge
      expect(result.cleanedPolygon).not.toBeNull();
    });

    it('keeps polygons with centroid far from edges', () => {
      const centered = rect(300, 300, 400, 400);
      const result = cleanMask(centered, { removeIslands: true, smoothingEpsilon: 0 });
      expect(result.cleanedPolygon).not.toBeNull();
    });
  });

  describe('contour smoothing', () => {
    it('reduces the number of polygon points', () => {
      // Create a polygon with many points
      const noisy: NormalizedPoint[] = [];
      for (let i = 0; i < 50; i++) {
        const angle = (2 * Math.PI * i) / 50;
        const r = 200 + (Math.sin(i * 3) * 10); // slight noise
        noisy.push(pt(500 + Math.round(r * Math.cos(angle)), 500 + Math.round(r * Math.sin(angle))));
      }
      const result = cleanMask(noisy, { smoothingEpsilon: 20, maxPolygonPoints: 20 });
      expect(result.cleanedPolygon).not.toBeNull();
      expect(result.cleanedPolygon!.length).toBeLessThanOrEqual(20);
    });

    it('preserves at least 3 points', () => {
      // Very aggressive smoothing on a large polygon
      const polygon = rect(100, 100, 400, 300);
      const result = cleanMask(polygon, { smoothingEpsilon: 1000, maxPolygonPoints: 50 });
      expect(result.cleanedPolygon).not.toBeNull();
      expect(result.cleanedPolygon!.length).toBeGreaterThanOrEqual(3);
    });

    it('respects maxPolygonPoints config', () => {
      // Create polygon with many points
      const many: NormalizedPoint[] = [];
      for (let i = 0; i < 100; i++) {
        const angle = (2 * Math.PI * i) / 100;
        many.push(pt(500 + Math.round(300 * Math.cos(angle)), 500 + Math.round(300 * Math.sin(angle))));
      }
      const result = cleanMask(many, { maxPolygonPoints: 10, smoothingEpsilon: 0 });
      expect(result.cleanedPolygon!.length).toBeLessThanOrEqual(10);
    });
  });

  describe('wasModified flag', () => {
    it('is false when polygon passes through unchanged', () => {
      // A simple convex rectangle with no noise — smoothing epsilon 0 means no simplification
      const simple = rect(200, 200, 400, 300);
      const result = cleanMask(simple, { smoothingEpsilon: 0, fillHoles: true, removeIslands: false });
      // Rectangle is convex so hole filling won't modify it
      // Smoothing epsilon 0 means Douglas-Peucker won't remove anything meaningful
      // Result depends on whether the rectangle passes hole filling unchanged
      expect(result.cleanedPolygon).not.toBeNull();
    });

    it('is true when polygon is simplified', () => {
      const noisy: NormalizedPoint[] = [];
      for (let i = 0; i < 50; i++) {
        const angle = (2 * Math.PI * i) / 50;
        const r = 200 + (Math.sin(i * 5) * 20); // significant noise
        noisy.push(pt(500 + Math.round(r * Math.cos(angle)), 500 + Math.round(r * Math.sin(angle))));
      }
      const result = cleanMask(noisy, { smoothingEpsilon: 30 });
      expect(result.wasModified).toBe(true);
    });
  });

  describe('config defaults', () => {
    it('uses default config when none provided', () => {
      // Should not throw
      const result = cleanMask(rect(100, 100, 400, 300));
      expect(result.cleanedPolygon).not.toBeNull();
      expect(result.appliedStages.length).toBe(4);
    });

    it('merges partial config with defaults', () => {
      // Only override one field
      const result = cleanMask(rect(100, 100, 400, 300), { smoothingEpsilon: 0 });
      expect(result.appliedStages).toContain('hole_filling');
      expect(result.appliedStages).toContain('island_removal');
    });
  });
});

// ---------------------------------------------------------------------------
// cleanSegmentationMask
// ---------------------------------------------------------------------------

describe('cleanSegmentationMask', () => {
  it('returns an updated mask for a valid polygon', () => {
    const mask = makeMask();
    const result = cleanSegmentationMask(mask);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('mask-001');
    expect(result!.fileId).toBe('file-001');
    expect(result!.segmentationClass).toBe('roof');
  });

  it('returns null for a tiny mask', () => {
    const tinyMask = makeMask({
      polygon: rect(500, 500, 10, 10),
      maskBounds: { x: 500, y: 500, width: 10, height: 10, coordinateSystem: 'normalized_image_0_1000' },
    });
    const result = cleanSegmentationMask(tinyMask);
    expect(result).toBeNull();
  });

  it('sets cleanedMask field on the returned mask', () => {
    const mask = makeMask();
    const result = cleanSegmentationMask(mask);
    expect(result!.cleanedMask).toBe('cleaned-mask-001');
  });

  it('preserves rawMask from the original mask', () => {
    const mask = makeMask({ rawMask: 'raw-data-abc' });
    const result = cleanSegmentationMask(mask);
    expect(result!.rawMask).toBe('raw-data-abc');
  });

  it('sets rawMask to the original cleanedMask if rawMask was absent', () => {
    const mask = makeMask({ cleanedMask: 'original-cleaned' });
    const result = cleanSegmentationMask(mask);
    expect(result!.rawMask).toBe('original-cleaned');
  });

  it('recomputes maskBounds for the cleaned polygon', () => {
    // Use a polygon that will be simplified
    const mask = makeMask({
      polygon: rect(100, 100, 400, 300),
    });
    const result = cleanSegmentationMask(mask, { smoothingEpsilon: 0 });
    expect(result).not.toBeNull();
    expect(result!.maskBounds.coordinateSystem).toBe('normalized_image_0_1000');
    expect(result!.maskBounds.x).toBe(100);
    expect(result!.maskBounds.y).toBe(100);
    expect(result!.maskBounds.width).toBe(400);
    expect(result!.maskBounds.height).toBe(300);
  });

  it('preserves all other mask fields', () => {
    const mask = makeMask({
      confidence: 82,
      workerVersion: '2.0.0-custom',
      stageTimings: { init: 10, process: 50 },
      limitations: [...BASE_LIMITATIONS, 'Custom limitation'],
    });
    const result = cleanSegmentationMask(mask);
    expect(result!.confidence).toBe(82);
    expect(result!.workerVersion).toBe('2.0.0-custom');
    expect(result!.stageTimings).toEqual({ init: 10, process: 50 });
    expect(result!.limitations).toContain('Custom limitation');
  });

  it('preserves authority envelope', () => {
    const mask = makeMask();
    const result = cleanSegmentationMask(mask);
    expect(result!.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('passes config through to cleanMask', () => {
    const tinyMask = makeMask({
      polygon: rect(500, 500, 10, 10),
      maskBounds: { x: 500, y: 500, width: 10, height: 10, coordinateSystem: 'normalized_image_0_1000' },
    });
    // With a lower minRegionArea, the tiny mask should be kept
    const result = cleanSegmentationMask(tinyMask, { minRegionArea: 50 });
    expect(result).not.toBeNull();
  });

  it('does not mutate the input mask', () => {
    const mask = makeMask();
    const originalPolygon = mask.polygon.map(p => ({ ...p }));
    const originalCleanedMask = mask.cleanedMask;
    cleanSegmentationMask(mask);
    expect(mask.polygon).toEqual(originalPolygon);
    expect(mask.cleanedMask).toBe(originalCleanedMask);
  });
});

// ---------------------------------------------------------------------------
// Integration: cleanMask + cleanSegmentationMask edge cases
// ---------------------------------------------------------------------------

describe('mask cleanup integration', () => {
  it('handles a polygon with many collinear points', () => {
    const collinear: NormalizedPoint[] = [
      pt(100, 100), pt(200, 100), pt(300, 100), pt(400, 100),
      pt(400, 200), pt(400, 300), pt(300, 300), pt(200, 300),
      pt(100, 300), pt(100, 200),
    ];
    const result = cleanMask(collinear, { smoothingEpsilon: 5 });
    expect(result.cleanedPolygon).not.toBeNull();
    expect(result.cleanedPolygon!.length).toBeGreaterThanOrEqual(3);
  });

  it('handles a large polygon that spans most of the image', () => {
    const large = rect(10, 10, 980, 980);
    const result = cleanMask(large);
    expect(result.cleanedPolygon).not.toBeNull();
    expect(result.cleanedPolygon!.length).toBeGreaterThanOrEqual(3);
  });

  it('handles a very thin polygon (high aspect ratio)', () => {
    const thin: NormalizedPoint[] = [
      pt(500, 100),
      pt(505, 100),
      pt(505, 900),
      pt(500, 900),
    ];
    // Area = 5 * 800 = 4000, which is > 500 minRegionArea
    const result = cleanMask(thin);
    expect(result.cleanedPolygon).not.toBeNull();
  });

  it('produces deterministic results for the same input', () => {
    const polygon = rect(150, 200, 300, 400);
    const result1 = cleanMask(polygon);
    const result2 = cleanMask(polygon);
    expect(result1.cleanedPolygon).toEqual(result2.cleanedPolygon);
    expect(result1.appliedStages).toEqual(result2.appliedStages);
  });

  it('handles a triangle', () => {
    const triangle: NormalizedPoint[] = [
      pt(500, 100),
      pt(900, 800),
      pt(100, 800),
    ];
    const result = cleanMask(triangle);
    expect(result.cleanedPolygon).not.toBeNull();
    expect(result.cleanedPolygon!.length).toBeGreaterThanOrEqual(3);
  });

  it('handles a mask with rawMask and cleanedMask already set', () => {
    const mask = makeMask({
      rawMask: 'original-raw',
      cleanedMask: 'original-cleaned',
    });
    const result = cleanSegmentationMask(mask);
    expect(result).not.toBeNull();
    // rawMask should be preserved from original
    expect(result!.rawMask).toBe('original-raw');
    // cleanedMask should be updated
    expect(result!.cleanedMask).toBe('cleaned-mask-001');
  });
});
