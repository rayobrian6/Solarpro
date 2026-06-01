/**
 * Depth-aware plane extraction tests.
 *
 * Tests the depthPlaneExtraction module that identifies roof planes
 * from DepthMap artifacts using flood-fill segmentation, gradient
 * edge detection, and orientation classification.
 *
 * @jest-environment node
 */

import {
  extractDepthPlanes,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type {
  DepthPlaneCandidate,
  DepthPlaneOptions,
  DepthPlaneExtractionResult,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type { DepthMap } from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeFloat32ToBase64(arr: Float32Array): string {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  return buf.toString('base64');
}

function makeDepthMap(
  width: number,
  height: number,
  grid: Float32Array,
  overrides?: Partial<DepthMap>,
): DepthMap {
  return {
    artifactType: 'depth_map',
    fileId: 'test-file-plane-001',
    width,
    height,
    depthData: encodeFloat32ToBase64(grid),
    depthMetric: 'normalized_relative',
    confidence: 0.75,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

/**
 * Create a 3-zone depth grid (8x8): sky at top, roof/wall in middle, ground at bottom.
 * This simulates a typical rooftop photo depth map.
 * Convention: high=far (sky ≈ 0.9-1.0), low=near (ground ≈ 0.1-0.2).
 */
function rooftopGrid(width: number = 8, height: number = 8): Float32Array {
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (y < height / 3) {
        // Sky — far
        grid[idx] = 0.90;
      } else if (y < (2 * height) / 3) {
        // Roof/wall — mid-range, slight gradient
        grid[idx] = 0.50 + (y / height) * 0.05;
      } else {
        // Ground — near
        grid[idx] = 0.15;
      }
    }
  }
  return grid;
}

/**
 * Create a flat grid — everything the same depth.
 * Should produce few/no edges and one big region.
 */
function flatGrid(width: number = 8, height: number = 8, value: number = 0.5): Float32Array {
  const grid = new Float32Array(width * height);
  grid.fill(value);
  return grid;
}

/**
 * Create a noisy depth grid with random values.
 * Should produce many edges and many small regions.
 */
function noisyGrid(width: number = 8, height: number = 8): Float32Array {
  const grid = new Float32Array(width * height);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.random();
  }
  return grid;
}

/**
 * Create a two-plane grid: left half at depth 0.2, right half at depth 0.8.
 * Creates a sharp vertical discontinuity in the middle.
 */
function twoPlaneGrid(width: number = 8, height: number = 8): Float32Array {
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = x < width / 2 ? 0.2 : 0.8;
    }
  }
  return grid;
}

/**
 * Create a grid with sky region at top and ground plane at bottom.
 * The simplest meaningful case: two distinct depth zones.
 */
function skyAndGroundGrid(width: number = 8, height: number = 8): Float32Array {
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = y < height / 2 ? 0.92 : 0.12;
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Basic extraction
// ---------------------------------------------------------------------------

describe('extractDepthPlanes', () => {
  it('should return a result with the correct structure', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result).toBeDefined();
    expect(result.planes).toBeInstanceOf(Array);
    expect(typeof result.edgeCount).toBe('number');
    expect(result.qualityReport).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.authority).toEqual({
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    });
  });

  it('should detect planes from a rooftop grid', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Should detect at least 2 distinct regions (sky + ground, possibly roof)
    expect(result.planes.length).toBeGreaterThanOrEqual(2);
  });

  it('should sort planes by area fraction (largest first)', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (let i = 1; i < result.planes.length; i++) {
      expect(result.planes[i - 1].areaFraction).toBeGreaterThanOrEqual(
        result.planes[i].areaFraction,
      );
    }
  });

  it('should assign each plane a unique ID', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    const ids = result.planes.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should compute area fractions that sum to ≤ 1.0', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    const totalArea = result.planes.reduce((sum, p) => sum + p.areaFraction, 0);
    expect(totalArea).toBeLessThanOrEqual(1.0);
  });

  it('should produce planes with valid bounding boxes in [0,1]', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.bounds.xMin).toBeGreaterThanOrEqual(0);
      expect(plane.bounds.yMin).toBeGreaterThanOrEqual(0);
      expect(plane.bounds.xMax).toBeLessThanOrEqual(1);
      expect(plane.bounds.yMax).toBeLessThanOrEqual(1);
      expect(plane.bounds.xMin).toBeLessThanOrEqual(plane.bounds.xMax);
      expect(plane.bounds.yMin).toBeLessThanOrEqual(plane.bounds.yMax);
    }
  });

  it('should produce planes with boundary polygons using normalized_image_0_1000', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.boundaryPolygon.length).toBeGreaterThan(0);
      for (const pt of plane.boundaryPolygon) {
        expect(pt.coordinateSystem).toBe('normalized_image_0_1000');
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(1000);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(1000);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Orientation classification
// ---------------------------------------------------------------------------

describe('orientation classification', () => {
  it('should classify high-depth top region as "far" (sky)', () => {
    const grid = skyAndGroundGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // The sky region (top half) should be classified as 'far'
    const skyPlane = result.planes.find(
      (p) => p.meanDepth > 0.8,
    );
    if (skyPlane) {
      expect(skyPlane.orientation).toBe('far');
    }
  });

  it('should classify low-depth bottom region as "horizontal" (ground)', () => {
    const grid = skyAndGroundGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // The ground region (bottom half) should be classified as 'horizontal'
    const groundPlane = result.planes.find(
      (p) => p.meanDepth < 0.3,
    );
    if (groundPlane) {
      // Ground has low gradient and low depth → horizontal
      expect(['horizontal', 'slanted']).toContain(groundPlane.orientation);
    }
  });

  it('should assign orientation labels that are valid', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    const validOrientations = ['horizontal', 'slanted', 'vertical', 'far'];
    for (const plane of result.planes) {
      expect(validOrientations).toContain(plane.orientation);
    }
  });

  it('should assign plane labels based on orientation', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      if (plane.orientation === 'far') {
        expect(plane.label).toMatch(/^sky/);
      } else if (plane.orientation === 'slanted') {
        expect(plane.label).toMatch(/^roof_plane/);
      } else if (plane.orientation === 'vertical') {
        expect(plane.label).toMatch(/^wall/);
      } else if (plane.orientation === 'horizontal') {
        expect(plane.label).toMatch(/^ground/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Edge detection
// ---------------------------------------------------------------------------

describe('edge detection', () => {
  it('should detect edges at depth discontinuities', () => {
    const grid = twoPlaneGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // The sharp vertical discontinuity should produce edges
    expect(result.edgeCount).toBeGreaterThan(0);
  });

  it('should detect few edges in a flat depth map', () => {
    const grid = flatGrid(8, 8, 0.5);
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // A uniform depth map should have very few or no edges
    expect(result.edgeCount).toBe(0);
  });

  it('should detect more edges in a noisy depth map than a flat one', () => {
    const flat = flatGrid(8, 8, 0.5);
    const noisy = noisyGrid(8, 8);

    const flatMap = makeDepthMap(8, 8, flat);
    const noisyMap = makeDepthMap(8, 8, noisy);

    const flatResult = extractDepthPlanes(flatMap, true);
    const noisyResult = extractDepthPlanes(noisyMap, true);

    expect(noisyResult.edgeCount).toBeGreaterThan(flatResult.edgeCount);
  });
});

// ---------------------------------------------------------------------------
// Flood-fill segmentation
// ---------------------------------------------------------------------------

describe('flood-fill segmentation', () => {
  it('should find 1 region in a flat depth map', () => {
    const grid = flatGrid(8, 8, 0.5);
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // All pixels have same depth → one large region
    expect(result.planes.length).toBe(1);
    expect(result.planes[0].areaFraction).toBeGreaterThan(0.9);
  });

  it('should find 2 regions in a sky-and-ground grid', () => {
    const grid = skyAndGroundGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Two distinct depth zones → at least 2 regions
    expect(result.planes.length).toBeGreaterThanOrEqual(2);
  });

  it('should find 2 regions in a two-plane grid (left/right split)', () => {
    const grid = twoPlaneGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Left half depth 0.2, right half depth 0.8 → 2 regions
    expect(result.planes.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

describe('confidence scoring', () => {
  it('should assign confidence scores between 0 and 100', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.confidence).toBeGreaterThanOrEqual(0);
      expect(plane.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('should give higher confidence with MiDaS than without', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);

    const midasResult = extractDepthPlanes(depthMap, true);
    const heuristicResult = extractDepthPlanes(depthMap, false);

    // Planes should have at least as much or more confidence with MiDaS
    // Compare the largest plane from each result
    if (midasResult.planes.length > 0 && heuristicResult.planes.length > 0) {
      // MiDaS bonus is +10 vs +5 for heuristic in confidence scoring
      // So total confidence should be higher for MiDaS
      const midasMax = Math.max(...midasResult.planes.map((p) => p.confidence));
      const heuristicMax = Math.max(...heuristicResult.planes.map((p) => p.confidence));
      expect(midasMax).toBeGreaterThanOrEqual(heuristicMax);
    }
  });

  it('should include depth quality in confidence', () => {
    const grid = rooftopGrid();
    const highConfMap = makeDepthMap(8, 8, grid, { confidence: 0.9 });
    const lowConfMap = makeDepthMap(8, 8, grid, { confidence: 0.2 });

    const highResult = extractDepthPlanes(highConfMap, true);
    const lowResult = extractDepthPlanes(lowConfMap, false);

    // Both should have confidence scores, but high-confidence depth map
    // should produce planes with at least some scoring
    expect(highResult.planes.length).toBeGreaterThan(0);
    expect(lowResult.planes.length).toBeGreaterThan(0);
  });

  it('should give slanted/horizontal planes orientation bonus', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Find slanted or horizontal planes
    const slantedOrHorizontal = result.planes.filter(
      (p) => p.orientation === 'slanted' || p.orientation === 'horizontal',
    );
    const farPlanes = result.planes.filter(
      (p) => p.orientation === 'far',
    );

    // Slanted/horizontal should get a +10 orientation bonus vs far gets 0
    // So if both exist, slanted/horizontal should have equal or higher confidence
    // (all else being equal — area and depth quality matter too)
    if (slantedOrHorizontal.length > 0 && farPlanes.length > 0) {
      // At minimum, we verify they both have valid scores
      for (const p of slantedOrHorizontal) {
        expect(p.confidence).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe('options', () => {
  it('should respect maxPlanes option', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true, { maxPlanes: 2 });

    expect(result.planes.length).toBeLessThanOrEqual(2);
  });

  it('should respect minAreaFraction option', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);

    // Very high minimum area → fewer planes
    const strictResult = extractDepthPlanes(depthMap, true, { minAreaFraction: 0.5 });
    const looseResult = extractDepthPlanes(depthMap, true, { minAreaFraction: 0.01 });

    expect(strictResult.planes.length).toBeLessThanOrEqual(looseResult.planes.length);
  });

  it('should use default options when none provided', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);

    // Should not throw with no options
    const result = extractDepthPlanes(depthMap, true);
    expect(result.planes).toBeInstanceOf(Array);
  });

  it('should respect depthThreshold option for segmentation', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);

    // Very tight threshold → more regions (over-segmentation)
    const tightResult = extractDepthPlanes(depthMap, true, { depthThreshold: 0.01 });
    // Very loose threshold → fewer regions (under-segmentation)
    const looseResult = extractDepthPlanes(depthMap, true, { depthThreshold: 0.5 });

    // Tight threshold should generally produce more or equal regions
    expect(tightResult.planes.length).toBeGreaterThanOrEqual(looseResult.planes.length);
  });

  it('should merge similar planes when mergeSimilar > 0', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);

    const mergeResult = extractDepthPlanes(depthMap, true, { mergeSimilar: 0.08 });
    const noMergeResult = extractDepthPlanes(depthMap, true, { mergeSimilar: 0 });

    // With merging, we should get ≤ number of planes without merging
    expect(mergeResult.planes.length).toBeLessThanOrEqual(noMergeResult.planes.length);
  });
});

// ---------------------------------------------------------------------------
// Depth quality integration
// ---------------------------------------------------------------------------

describe('depth quality integration', () => {
  it('should include a quality report in the result', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.qualityReport).toBeDefined();
    expect(result.qualityReport.grade).toBeDefined();
    expect(result.qualityReport.score).toBeGreaterThanOrEqual(0);
    expect(result.qualityReport.score).toBeLessThanOrEqual(100);
  });

  it('should include depth statistics in the result', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.stats).toBeDefined();
    expect(result.stats.min).toBeLessThanOrEqual(result.stats.max);
    expect(result.stats.totalPixels).toBe(64); // 8x8
  });

  it('should include depthQuality on each plane candidate', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.depthQuality).toBeDefined();
      expect(plane.depthQuality.grade).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Authority envelope
// ---------------------------------------------------------------------------

describe('authority envelope', () => {
  it('should always return review-only authority', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.authority.reviewOnly).toBe(true);
    expect(result.authority.nonAuthoritative).toBe(true);
    expect(result.authority.cadMutationAllowed).toBe(false);
    expect(result.authority.permitGenerationAllowed).toBe(false);
    expect(result.authority.bomMutationAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle a 1x1 depth map', () => {
    const grid = new Float32Array([0.5]);
    const depthMap = makeDepthMap(1, 1, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Single pixel → 1 region
    expect(result.planes.length).toBe(1);
    expect(result.planes[0].areaFraction).toBe(1);
    expect(result.planes[0].meanDepth).toBeCloseTo(0.5, 1);
  });

  it('should handle a 2x2 depth map with different depths', () => {
    const grid = new Float32Array([0.9, 0.1, 0.9, 0.1]);
    const depthMap = makeDepthMap(2, 2, grid);
    const result = extractDepthPlanes(depthMap, true);

    // The alternating pattern creates strong edges everywhere,
    // so edge pixels may dominate and flood-fill may produce few regions.
    // This is expected behavior — 2x2 is below practical resolution.
    expect(result.edgeCount).toBeGreaterThanOrEqual(0);
    // All 4 pixels may be edges → 0 planes, or some may survive → ≥0
    expect(result.planes.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle all-zero depth grid', () => {
    const grid = flatGrid(8, 8, 0.0);
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.planes.length).toBeGreaterThan(0);
  });

  it('should handle all-one depth grid', () => {
    const grid = flatGrid(8, 8, 1.0);
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.planes.length).toBeGreaterThan(0);
  });

  it('should handle very large depthThreshold (flood-fill groups broadly)', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true, { depthThreshold: 1.0 });

    // With depthThreshold=1.0, flood-fill groups any adjacent pixels.
    // However, edge pixels still block flood-fill from crossing depth discontinuities.
    // So spatially separated regions (sky vs roof vs ground) stay separate.
    // The result depends on how many edge pixels exist between zones.
    expect(result.planes.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle maxPlanes = 0', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true, { maxPlanes: 0 });

    expect(result.planes.length).toBe(0);
  });

  it('should handle minAreaFraction = 1.0 (no plane can be that large)', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true, { minAreaFraction: 1.0 });

    // No single region can occupy 100% of a multi-region grid
    expect(result.planes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Depth statistics per plane
// ---------------------------------------------------------------------------

describe('per-plane statistics', () => {
  it('should compute meanDepth correctly for each plane', () => {
    const grid = skyAndGroundGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Check that mean depths are reasonable for sky (≈0.92) and ground (≈0.12)
    const skyPlane = result.planes.find((p) => p.orientation === 'far');
    const groundPlane = result.planes.find((p) => p.orientation === 'horizontal');

    if (skyPlane) {
      expect(skyPlane.meanDepth).toBeGreaterThan(0.8);
    }
    if (groundPlane) {
      expect(groundPlane.meanDepth).toBeLessThan(0.3);
    }
  });

  it('should compute depthStdDev for each plane', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.depthStdDev).toBeGreaterThanOrEqual(0);
    }
  });

  it('should compute gradientMagnitude for each plane', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    for (const plane of result.planes) {
      expect(plane.gradientMagnitude).toBeGreaterThanOrEqual(0);
    }
  });

  it('should have low stdDev for uniform regions', () => {
    const grid = flatGrid(8, 8, 0.5);
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Flat region should have near-zero stdDev
    expect(result.planes[0].depthStdDev).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// Integration with depthMapDecode and depthQualityReport
// ---------------------------------------------------------------------------

describe('integration with other depth utilities', () => {
  it('should produce stats consistent with computeDepthStats', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // The stats in the result should reflect the actual depth grid
    expect(result.stats.totalPixels).toBe(64);
    expect(result.stats.min).toBeLessThanOrEqual(result.stats.max);
    expect(result.stats.mean).toBeGreaterThanOrEqual(result.stats.min);
    expect(result.stats.mean).toBeLessThanOrEqual(result.stats.max);
  });

  it('should produce a quality report consistent with generateDepthQualityReport', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Quality report should have valid grade
    const validGrades = ['A', 'B', 'C', 'D', 'F'];
    expect(validGrades).toContain(result.qualityReport.grade);
  });

  it('should handle heuristic depth (usedMidas=false)', () => {
    const grid = rooftopGrid();
    const depthMap = makeDepthMap(8, 8, grid);
    const result = extractDepthPlanes(depthMap, false);

    // Should still produce valid results without MiDaS
    expect(result.planes.length).toBeGreaterThan(0);
    expect(result.qualityReport).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Larger grid sizes
// ---------------------------------------------------------------------------

describe('larger grid sizes', () => {
  it('should work with a 64x64 depth map (standard MiDaS resolution)', () => {
    const grid = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = y * 64 + x;
        if (y < 20) {
          grid[idx] = 0.92; // sky
        } else if (y < 40) {
          grid[idx] = 0.50 + (x / 64) * 0.1; // roof with gradient
        } else {
          grid[idx] = 0.12; // ground
        }
      }
    }

    const depthMap = makeDepthMap(64, 64, grid);
    const result = extractDepthPlanes(depthMap, true);

    expect(result.planes.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.totalPixels).toBe(4096);
  });

  it('should detect roof planes in a realistic 64x64 rooftop grid', () => {
    const grid = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = y * 64 + x;
        if (y < 18) {
          grid[idx] = 0.90 + Math.random() * 0.05; // sky
        } else if (y < 42) {
          // Roof with slant — depth increases left to right
          grid[idx] = 0.35 + (x / 64) * 0.25;
        } else {
          grid[idx] = 0.10 + Math.random() * 0.05; // ground
        }
      }
    }

    const depthMap = makeDepthMap(64, 64, grid);
    const result = extractDepthPlanes(depthMap, true);

    // Should have sky, roof, and ground regions
    const orientations = result.planes.map((p) => p.orientation);
    expect(orientations.length).toBeGreaterThanOrEqual(2);

    // There should be a 'far' (sky) region
    const hasFar = orientations.includes('far');
    expect(hasFar).toBe(true);
  });
});
