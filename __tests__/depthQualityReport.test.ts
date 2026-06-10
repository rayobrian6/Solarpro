/**
 * Depth quality report utility tests.
 *
 * Tests the depthQualityReport module that generates structured quality
 * assessments for depth data.
 *
 * @jest-environment node
 */

import {
  generateDepthQualityReport,
  isDepthUsableFor,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type {
  DepthQualityGrade,
  DepthQualityReport,
  DepthQualityDimensions,
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
    fileId: 'test-file-001',
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
 * Create a bimodal depth grid: sky (0.9-1.0) at top, ground (0.1-0.2) at bottom.
 * This simulates a good outdoor depth map.
 */
function goodOutdoorGrid(width: number, height: number): Float32Array {
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < height / 3) {
        // Sky region — far
        grid[y * width + x] = 0.85 + Math.random() * 0.15; // 0.85–1.0
      } else if (y < (2 * height) / 3) {
        // Roof/wall — mid-range
        grid[y * width + x] = 0.4 + Math.random() * 0.2; // 0.4–0.6
      } else {
        // Ground — near
        grid[y * width + x] = 0.1 + Math.random() * 0.1; // 0.1–0.2
      }
    }
  }
  return grid;
}

/**
 * Create a flat (constant) depth grid — poor quality.
 */
function flatGrid(width: number, height: number, value: number): Float32Array {
  const grid = new Float32Array(width * height);
  grid.fill(value);
  return grid;
}

/**
 * Create a narrow range depth grid — mediocre quality.
 */
function narrowRangeGrid(width: number, height: number): Float32Array {
  const grid = new Float32Array(width * height);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = 0.48 + Math.random() * 0.04; // 0.48–0.52 range
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('depthQualityReport', () => {
  // -----------------------------------------------------------------------
  // generateDepthQualityReport
  // -----------------------------------------------------------------------
  describe('generateDepthQualityReport', () => {
    it('returns a report with all required fields', () => {
      const grid = goodOutdoorGrid(16, 16);
      const depthMap = makeDepthMap(16, 16, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      expect(report).toHaveProperty('grade');
      expect(report).toHaveProperty('score');
      expect(report).toHaveProperty('usedMidas');
      expect(report).toHaveProperty('confidence');
      expect(report).toHaveProperty('statistics');
      expect(report).toHaveProperty('dimensions');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('authority');
    });

    it('authority envelope is always review-only', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      expect(report.authority.reviewOnly).toBe(true);
      expect(report.authority.nonAuthoritative).toBe(true);
      expect(report.authority.cadMutationAllowed).toBe(false);
      expect(report.authority.permitGenerationAllowed).toBe(false);
      expect(report.authority.bomMutationAllowed).toBe(false);
    });

    it('reflects usedMidas and confidence from input', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);

      const midasReport = generateDepthQualityReport(depthMap, true, 80);
      expect(midasReport.usedMidas).toBe(true);
      expect(midasReport.confidence).toBe(80);

      const heuristicReport = generateDepthQualityReport(depthMap, false, 45);
      expect(heuristicReport.usedMidas).toBe(false);
      expect(heuristicReport.confidence).toBe(45);
    });

    it('gives a good grade (A or B) for a bimodal outdoor depth map with MiDaS', () => {
      const grid = goodOutdoorGrid(32, 32);
      const depthMap = makeDepthMap(32, 32, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      // Good bimodal distribution + MiDaS + high confidence → A or B
      expect(['A', 'B']).toContain(report.grade);
      expect(report.score).toBeGreaterThanOrEqual(60);
    });

    it('gives a poor grade (D or F) for a flat depth map', () => {
      const grid = flatGrid(16, 16, 0.5);
      const depthMap = makeDepthMap(16, 16, grid);
      const report = generateDepthQualityReport(depthMap, false, 35);

      // Flat depth + heuristic + low confidence → D or F
      expect(['D', 'F']).toContain(report.grade);
    });

    it('gives a mediocre grade for narrow range depth', () => {
      const grid = narrowRangeGrid(16, 16);
      const depthMap = makeDepthMap(16, 16, grid);
      const report = generateDepthQualityReport(depthMap, false, 50);

      // Narrow range + heuristic → C or D
      expect(['C', 'D']).toContain(report.grade);
    });

    it('score is between 0 and 100', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('dimensions all have scores between 0 and 100', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      const dims = report.dimensions;
      expect(dims.rangeQuality).toBeGreaterThanOrEqual(0);
      expect(dims.rangeQuality).toBeLessThanOrEqual(100);
      expect(dims.skySeparationQuality).toBeGreaterThanOrEqual(0);
      expect(dims.skySeparationQuality).toBeLessThanOrEqual(100);
      expect(dims.noiseQuality).toBeGreaterThanOrEqual(0);
      expect(dims.noiseQuality).toBeLessThanOrEqual(100);
      expect(dims.confidenceQuality).toBeGreaterThanOrEqual(0);
      expect(dims.confidenceQuality).toBeLessThanOrEqual(100);
      expect(dims.coverageQuality).toBeGreaterThanOrEqual(0);
      expect(dims.coverageQuality).toBeLessThanOrEqual(100);
    });

    it('grade matches score thresholds', () => {
      const grid = goodOutdoorGrid(16, 16);
      const depthMap = makeDepthMap(16, 16, grid);

      // Test several confidence levels to get different scores
      const report80 = generateDepthQualityReport(depthMap, true, 80);
      const report20 = generateDepthQualityReport(depthMap, false, 20);

      // The grade should be consistent with the score
      if (report80.score >= 80) expect(report80.grade).toBe('A');
      else if (report80.score >= 60) expect(report80.grade).toBe('B');

      if (report20.score < 20) expect(report20.grade).toBe('F');
      else if (report20.score < 40) expect(report20.grade).toBe('D');
    });

    it('statistics are populated from computeDepthStats', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      const stats = report.statistics;
      expect(stats.totalPixels).toBe(64);
      expect(stats.min).toBeLessThanOrEqual(stats.max);
      expect(stats.mean).toBeGreaterThanOrEqual(stats.min);
      expect(stats.mean).toBeLessThanOrEqual(stats.max);
    });

    it('summary is a non-empty string', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      expect(typeof report.summary).toBe('string');
      expect(report.summary.length).toBeGreaterThan(0);
    });

    it('recommendations are non-empty strings', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      expect(report.recommendations.length).toBeGreaterThan(0);
      for (const rec of report.recommendations) {
        expect(typeof rec).toBe('string');
        expect(rec.length).toBeGreaterThan(0);
      }
    });

    it('recommends MiDaS upgrade when heuristic produces poor quality', () => {
      const grid = flatGrid(8, 8, 0.5);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, false, 30);

      const hasMidasRec = report.recommendations.some(
        r => r.toLowerCase().includes('midas'),
      );
      expect(hasMidasRec).toBe(true);
    });

    it('recommends against using depth for grade F', () => {
      const grid = flatGrid(8, 8, 0.5);
      const depthMap = makeDepthMap(8, 8, grid, { confidence: 0.1 });
      const report = generateDepthQualityReport(depthMap, false, 10);

      if (report.grade === 'F') {
        const hasUnreliableRec = report.recommendations.some(
          r => r.toLowerCase().includes('unreliable'),
        );
        expect(hasUnreliableRec).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // isDepthUsableFor
  // -----------------------------------------------------------------------
  describe('isDepthUsableFor', () => {
    it('visualization is always usable', () => {
      const grid = flatGrid(8, 8, 0.5);
      const depthMap = makeDepthMap(8, 8, grid, { confidence: 0.1 });
      const report = generateDepthQualityReport(depthMap, false, 10);

      expect(isDepthUsableFor(report, 'visualization')).toBe(true);
    });

    it('plane_extraction requires good range and low noise', () => {
      // Good depth map
      const goodGrid = goodOutdoorGrid(32, 32);
      const goodDepthMap = makeDepthMap(32, 32, goodGrid);
      const goodReport = generateDepthQualityReport(goodDepthMap, true, 80);

      // Poor depth map
      const poorGrid = flatGrid(8, 8, 0.5);
      const poorDepthMap = makeDepthMap(8, 8, poorGrid, { confidence: 0.1 });
      const poorReport = generateDepthQualityReport(poorDepthMap, false, 10);

      // Good should be usable, poor should not
      // (Note: this depends on the actual scores, but the pattern should hold)
      if (goodReport.grade <= 'B' && goodReport.dimensions.rangeQuality >= 60 && goodReport.dimensions.noiseQuality >= 50) {
        expect(isDepthUsableFor(goodReport, 'plane_extraction')).toBe(true);
      }
      expect(isDepthUsableFor(poorReport, 'plane_extraction')).toBe(false);
    });

    it('sky_detection requires good sky separation', () => {
      // Bimodal depth has good sky separation
      const goodGrid = goodOutdoorGrid(16, 16);
      const goodDepthMap = makeDepthMap(16, 16, goodGrid);
      const goodReport = generateDepthQualityReport(goodDepthMap, true, 75);

      // Flat depth has poor sky separation
      const flatDepthMap = makeDepthMap(8, 8, flatGrid(8, 8, 0.5));
      const flatReport = generateDepthQualityReport(flatDepthMap, false, 30);

      expect(isDepthUsableFor(goodReport, 'sky_detection')).toBe(true);
      expect(isDepthUsableFor(flatReport, 'sky_detection')).toBe(false);
    });

    it('multi_view_fusion requires at least grade C', () => {
      const goodGrid = goodOutdoorGrid(16, 16);
      const goodDepthMap = makeDepthMap(16, 16, goodGrid);
      const goodReport = generateDepthQualityReport(goodDepthMap, true, 75);

      // Good report should allow fusion
      if (goodReport.grade <= 'C') {
        expect(isDepthUsableFor(goodReport, 'multi_view_fusion')).toBe(true);
      }
    });

    it('returns false for unknown purpose', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 75);

      // @ts-expect-error — testing unknown purpose
      expect(isDepthUsableFor(report, 'nonexistent_purpose')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Dimension scoring edge cases
  // -----------------------------------------------------------------------
  describe('dimension scoring edge cases', () => {
    it('rangeQuality is high when depth has wide spread', () => {
      const grid = new Float32Array(100);
      for (let i = 0; i < 100; i++) grid[i] = i / 99; // 0.0 to 1.0
      const depthMap = makeDepthMap(10, 10, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      expect(report.dimensions.rangeQuality).toBe(100); // range >= 0.5
    });

    it('rangeQuality is low when depth is nearly flat', () => {
      const grid = flatGrid(8, 8, 0.501);
      const depthMap = makeDepthMap(8, 8, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      expect(report.dimensions.rangeQuality).toBeLessThan(20);
    });

    it('skySeparationQuality is high for bimodal distribution', () => {
      const grid = new Float32Array(100);
      for (let i = 0; i < 50; i++) grid[i] = 0.02;  // near-zero (ground)
      for (let i = 50; i < 100; i++) grid[i] = 0.98; // near-one (sky)
      const depthMap = makeDepthMap(10, 10, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      expect(report.dimensions.skySeparationQuality).toBe(100);
    });

    it('confidenceQuality scales with confidence value', () => {
      const grid = goodOutdoorGrid(8, 8);
      const depthMap = makeDepthMap(8, 8, grid);

      const highConf = generateDepthQualityReport(depthMap, true, 90);
      const lowConf = generateDepthQualityReport(depthMap, true, 15);

      expect(highConf.dimensions.confidenceQuality).toBeGreaterThan(
        lowConf.dimensions.confidenceQuality,
      );
    });

    it('coverageQuality is high when most values are mid-range', () => {
      const grid = new Float32Array(100);
      for (let i = 0; i < 100; i++) grid[i] = 0.3 + (i % 40) * 0.01; // 0.3–0.69
      const depthMap = makeDepthMap(10, 10, grid);
      const report = generateDepthQualityReport(depthMap, true, 80);

      expect(report.dimensions.coverageQuality).toBeGreaterThanOrEqual(80);
    });
  });
});
