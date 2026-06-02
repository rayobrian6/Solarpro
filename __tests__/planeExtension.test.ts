/**
 * Tests for plane extension / occlusion inference module.
 *
 * Verifies that structural planes (walls, roofs) are extended through
 * occluder regions (trees, bushes, cars) when the occluder overlaps
 * the edge of the structural polygon.
 */

import { describe, it, expect } from 'vitest';
import {
  extendPlanesThroughOccluders,
  type PlaneExtensionConfig,
} from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/planeExtension';
import type {
  NormalizedPoint,
  SegmentationClass,
  SemanticSegmentationMask,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CS = 'normalized_image_0_1000' as const;

function pt(x: number, y: number): NormalizedPoint {
  return { x, y, coordinateSystem: CS };
}

function makeMask(
  id: string,
  segmentationClass: SegmentationClass,
  polygon: NormalizedPoint[],
  isOccluder?: boolean,
): SemanticSegmentationMask {
  const xMin = Math.min(...polygon.map(p => p.x));
  const yMin = Math.min(...polygon.map(p => p.y));
  const xMax = Math.max(...polygon.map(p => p.x));
  const yMax = Math.max(...polygon.map(p => p.y));

  return {
    artifactType: 'semantic_segmentation_mask',
    id,
    fileId: 'test-photo',
    segmentationClass,
    polygon,
    confidence: 80,
    maskBounds: {
      x: xMin,
      y: yMin,
      width: xMax - xMin,
      height: yMax - yMin,
      coordinateSystem: CS,
    },
    workerVersion: 'test',
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...BASE_LIMITATIONS],
    isOccluder: isOccluder === true ? true : null,
  };
}

// A rectangular wall polygon (already architecturally reconstructed)
const wallRect: NormalizedPoint[] = [
  pt(200, 100), pt(600, 100), pt(600, 500), pt(200, 500),
];

// A trapezoidal roof polygon (already architecturally reconstructed)
const roofTrapezoid: NormalizedPoint[] = [
  pt(300, 100), pt(500, 100), pt(600, 300), pt(200, 300),
];

// A triangular gable-end roof polygon
const roofTriangle: NormalizedPoint[] = [
  pt(400, 80), pt(600, 300), pt(200, 300),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extendPlanesThroughOccluders', () => {
  describe('no-op cases', () => {
    it('returns all masks unchanged when no structural masks exist', () => {
      const treeMask = makeMask('tree-1', 'trees', [
        pt(100, 100), pt(300, 100), pt(300, 400), pt(100, 400),
      ]);
      const result = extendPlanesThroughOccluders([treeMask]);
      expect(result.extendedCount).toBe(0);
      expect(result.extendedMasks).toHaveLength(1);
      expect(result.extendedMasks[0].id).toBe('tree-1');
    });

    it('returns all masks unchanged when no occluder masks exist', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const result = extendPlanesThroughOccluders([wallMask]);
      expect(result.extendedCount).toBe(0);
      expect(result.extendedMasks).toHaveLength(1);
    });

    it('returns all masks unchanged when enabled=false', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(50, 100), pt(250, 100), pt(250, 400), pt(50, 400),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeMask], {
        enabled: false,
      });
      expect(result.extendedCount).toBe(0);
    });

    it('returns unchanged when occluder does not overlap structural plane', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      // Tree is far to the right, no overlap
      const treeMask = makeMask('tree-1', 'trees', [
        pt(700, 100), pt(900, 100), pt(900, 400), pt(700, 400),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeMask]);
      expect(result.extendedCount).toBe(0);
    });

    it('returns unchanged when occluder overlaps but does not extend past any edge', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      // Tree is fully inside the wall bounds
      const treeMask = makeMask('tree-1', 'trees', [
        pt(300, 150), pt(500, 150), pt(500, 450), pt(300, 450),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeMask]);
      // Tree doesn't extend past any wall edge, so no extension
      expect(result.extendedCount).toBe(0);
    });
  });

  describe('wall extension through tree occlusion', () => {
    it('extends wall left when tree occludes the left side', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      // Tree overlaps left edge of wall and extends past it
      const treeMask = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 420), pt(50, 420),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeMask]);
      expect(result.extendedCount).toBe(1);
      expect(result.extensionDetails).toHaveLength(1);
      expect(result.extensionDetails[0].segmentationClass).toBe('wall');
      expect(result.extensionDetails[0].extendedSides).toContain('left');

      // Wall should have been extended to the left
      const extendedMask = result.extendedMasks.find(m => m.id === 'wall-1')!;
      expect(extendedMask).toBeDefined();
      // Extended polygon should be wider than original
      const origWidth = 600 - 200;
      const extXMin = Math.min(...extendedMask.polygon.map(p => p.x));
      expect(extXMin).toBeLessThan(200);
    });

    it('extends wall right when bush occludes the right side', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const bushMask = makeMask('bush-1', 'bushes', [
        pt(550, 80), pt(800, 80), pt(800, 420), pt(550, 420),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, bushMask]);
      expect(result.extendedCount).toBe(1);
      expect(result.extensionDetails[0].extendedSides).toContain('right');

      const extendedMask = result.extendedMasks.find(m => m.id === 'wall-1')!;
      const extXMax = Math.max(...extendedMask.polygon.map(p => p.x));
      expect(extXMax).toBeGreaterThan(600);
    });

    it('extends wall both left and right when occluded on both sides', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const treeLeft = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 420), pt(50, 420),
      ]);
      const bushRight = makeMask('bush-1', 'bushes', [
        pt(550, 80), pt(800, 80), pt(800, 420), pt(550, 420),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeLeft, bushRight]);
      expect(result.extendedCount).toBe(1);
      expect(result.extensionDetails[0].extendedSides).toContain('left');
      expect(result.extensionDetails[0].extendedSides).toContain('right');
    });
  });

  describe('car occlusion', () => {
    it('extends wall when car occludes bottom of wall', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const carMask = makeMask('car-1', 'car', [
        pt(150, 400), pt(650, 400), pt(650, 600), pt(150, 600),
      ], true);
      const result = extendPlanesThroughOccluders([wallMask, carMask]);
      // Car extends past bottom of wall
      expect(result.extendedCount).toBe(1);
      expect(result.extensionDetails[0].extendedSides).toContain('bottom');
    });
  });

  describe('roof extension', () => {
    it('extends trapezoidal roof horizontally through tree', () => {
      const roofMask = makeMask('roof-1', 'roof', roofTrapezoid);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 320), pt(50, 320),
      ]);
      const result = extendPlanesThroughOccluders([roofMask, treeMask]);
      expect(result.extendedCount).toBe(1);
      expect(result.extensionDetails[0].segmentationClass).toBe('roof');
    });

    it('extends triangular roof through overgrown vegetation', () => {
      const roofMask = makeMask('roof-1', 'roof', roofTriangle);
      const vegMask = makeMask('veg-1', 'overgrown_vegetation', [
        pt(50, 60), pt(250, 60), pt(250, 320), pt(50, 320),
      ]);
      const result = extendPlanesThroughOccluders([roofMask, vegMask]);
      expect(result.extendedCount).toBe(1);
    });
  });

  describe('non-extensible classes', () => {
    it('does not extend chimney through occluder', () => {
      const chimneyMask = makeMask('chimney-1', 'chimney', [
        pt(400, 50), pt(450, 50), pt(450, 200), pt(400, 200),
      ]);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(350, 40), pt(480, 40), pt(480, 210), pt(350, 210),
      ]);
      const result = extendPlanesThroughOccluders([chimneyMask, treeMask]);
      expect(result.extendedCount).toBe(0);
    });

    it('does not extend window through occluder', () => {
      const windowMask = makeMask('window-1', 'window', [
        pt(300, 200), pt(400, 200), pt(400, 300), pt(300, 300),
      ]);
      const bushMask = makeMask('bush-1', 'bushes', [
        pt(250, 150), pt(450, 150), pt(450, 350), pt(250, 350),
      ]);
      const result = extendPlanesThroughOccluders([windowMask, bushMask]);
      expect(result.extendedCount).toBe(0);
    });
  });

  describe('multiple masks', () => {
    it('extends wall but preserves occluder and other masks unchanged', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 420), pt(50, 420),
      ]);
      const chimneyMask = makeMask('chimney-1', 'chimney', [
        pt(400, 50), pt(450, 50), pt(450, 200), pt(400, 200),
      ]);

      const result = extendPlanesThroughOccluders([wallMask, treeMask, chimneyMask]);

      // Only wall was extended
      expect(result.extendedCount).toBe(1);

      // All 3 masks should be present in output
      expect(result.extendedMasks).toHaveLength(3);

      // Tree mask should be unchanged
      const outputTree = result.extendedMasks.find(m => m.id === 'tree-1')!;
      expect(outputTree.polygon).toEqual(treeMask.polygon);

      // Chimney mask should be unchanged
      const outputChimney = result.extendedMasks.find(m => m.id === 'chimney-1')!;
      expect(outputChimney.polygon).toEqual(chimneyMask.polygon);
    });

    it('extends multiple walls when each has its own occluder', () => {
      const wall1 = makeMask('wall-1', 'wall', [
        pt(200, 100), pt(600, 100), pt(600, 500), pt(200, 500),
      ]);
      const wall2 = makeMask('wall-2', 'siding', [
        pt(200, 550), pt(600, 550), pt(600, 900), pt(200, 900),
      ]);
      const tree1 = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 520), pt(50, 520),
      ]);
      const tree2 = makeMask('tree-2', 'trees', [
        pt(550, 530), pt(800, 530), pt(800, 920), pt(550, 920),
      ]);

      const result = extendPlanesThroughOccluders([wall1, wall2, tree1, tree2]);
      expect(result.extendedCount).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty mask list', () => {
      const result = extendPlanesThroughOccluders([]);
      expect(result.extendedCount).toBe(0);
      expect(result.extendedMasks).toHaveLength(0);
    });

    it('clamps extended polygon to image bounds [0, 1000]', () => {
      // Wall already at left edge
      const wallMask = makeMask('wall-1', 'wall', [
        pt(10, 100), pt(400, 100), pt(400, 500), pt(10, 500),
      ]);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(0, 80), pt(60, 80), pt(60, 520), pt(0, 520),
      ]);
      const result = extendPlanesThroughOccluders([wallMask, treeMask]);

      if (result.extendedCount > 0) {
        const extendedMask = result.extendedMasks.find(m => m.id === 'wall-1')!;
        const xMin = Math.min(...extendedMask.polygon.map(p => p.x));
        expect(xMin).toBeGreaterThanOrEqual(0);
      }
    });

    it('does not extend non-rectangular wall polygon', () => {
      // Blobby organic wall polygon (not architecturally reconstructed)
      const blobbyWall = makeMask('wall-1', 'wall', [
        pt(200, 100), pt(350, 95), pt(500, 105), pt(600, 100),
        pt(610, 300), pt(590, 500), pt(400, 505), pt(200, 495),
      ]);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(50, 80), pt(250, 80), pt(250, 520), pt(50, 520),
      ]);
      const result = extendPlanesThroughOccluders([blobbyWall, treeMask]);
      // Blobby polygon is not rectangular, should not be extended
      expect(result.extendedCount).toBe(0);
    });

    it('respects minOccluderOverlap config', () => {
      const wallMask = makeMask('wall-1', 'wall', wallRect);
      // Tree barely overlaps wall (tiny overlap)
      const treeMask = makeMask('tree-1', 'trees', [
        pt(180, 95), pt(210, 95), pt(210, 115), pt(180, 115),
      ]);
      // With high min overlap, should not extend
      const result = extendPlanesThroughOccluders([wallMask, treeMask], {
        minOccluderOverlap: 0.5,
      });
      expect(result.extendedCount).toBe(0);
    });
  });

  describe('dormer extension', () => {
    it('extends dormer through vegetation', () => {
      const dormerMask = makeMask('dormer-1', 'dormer', [
        pt(350, 80), pt(500, 80), pt(520, 200), pt(330, 200),
      ]);
      const treeMask = makeMask('tree-1', 'trees', [
        pt(280, 60), pt(370, 60), pt(370, 220), pt(280, 220),
      ]);
      const result = extendPlanesThroughOccluders([dormerMask, treeMask]);
      expect(result.extendedCount).toBe(1);
    });
  });
});
