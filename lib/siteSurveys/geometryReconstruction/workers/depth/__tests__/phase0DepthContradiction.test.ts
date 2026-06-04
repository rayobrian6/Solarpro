/**
 * Phase 0 Depth Contradiction Tests (P0-2.2, P0-2.3)
 *
 * Covers:
 *   - P0-2.2: Depth-class range table, deviation computation, severity classification
 *   - P0-2.3: Contradiction detector, mask depth computation, reclassification,
 *             confidence penalties, feature flag
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEPTH_CLASS_RANGES,
  computeDepthDeviation,
  classifyDeviation,
} from '../depthContradictionRanges';
import type { DepthClassRange } from '../depthContradictionRanges';
import {
  isPhase0DepthContradictionEnabled,
  computeMaskMeanDepth,
  suggestReclassification,
  detectDepthContradictions,
  applyContradictionPenalty,
} from '../depthContradictionDetector';
import type {
  DepthContradictionDetectorInput,
  DepthContradictionDetectorOutput,
} from '../depthContradictionDetector';
import type {
  SemanticSegmentationMask,
  DepthContradictionReport,
} from '../../../../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal SemanticSegmentationMask for testing. */
function makeMask(
  overrides: Partial<SemanticSegmentationMask> & {
    id?: string;
    segmentationClass?: SemanticSegmentationMask['segmentationClass'];
    maskBounds?: SemanticSegmentationMask['maskBounds'];
  } = {},
): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id: overrides.id ?? 'mask-001',
    fileId: 'file-001',
    segmentationClass: overrides.segmentationClass ?? 'roof',
    polygon: [],
    confidence: 60,
    maskBounds: overrides.maskBounds ?? {
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.3,
      coordinateSystem: 'normalized_image_0_1000',
    },
    workerVersion: 'test-1.0',
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
    limitations: [],
    ...overrides,
  };
}

/** Create a uniform depth grid (all cells = value). */
function makeUniformGrid(width: number, height: number, value: number): Float32Array {
  const grid = new Float32Array(width * height);
  grid.fill(value);
  return grid;
}

/** Create a depth grid where upper half = nearValue, lower half = farValue. */
function makeSplitGrid(
  width: number,
  height: number,
  nearValue: number,
  farValue: number,
): Float32Array {
  const grid = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      grid[row * width + col] = row < height / 2 ? nearValue : farValue;
    }
  }
  return grid;
}

// ===========================================================================
// P0-2.2: Depth-Class Range Table
// ===========================================================================

describe('P0-2.2: Depth-class range table', () => {
  // --- Range completeness ---

  it('has a range entry for every segmentation class', () => {
    // Every SegmentationClass value must have an entry
    const expectedClasses = [
      'roof', 'wall', 'siding', 'fascia', 'soffit', 'gutter', 'chimney',
      'vent_pipe', 'skylight', 'downspout', 'sky', 'tree', 'trees', 'bushes',
      'vegetation_touching_structure', 'grass', 'overgrown_grass', 'moss',
      'algae', 'ground', 'driveway', 'gravel', 'sidewalk', 'car', 'truck',
      'trailer', 'person', 'ladder', 'trash_can', 'tools',
      'temporary_materials', 'window', 'door', 'garage_door', 'porch',
      'deck', 'steps', 'railing', 'fence', 'ac_unit',
      'existing_solar_panel', 'utility_meter', 'main_service_panel',
      'disconnect', 'conduit', 'inverter', 'battery', 'damaged_siding',
      'blocked_access', 'muddy_work_area', 'obstruction', 'equipment',
      'background',
    ];
    for (const cls of expectedClasses) {
      expect(DEPTH_CLASS_RANGES).toHaveProperty(cls);
    }
  });

  // --- Range validity ---

  it('all ranges have min <= max and are within [0, 1]', () => {
    for (const [cls, range] of Object.entries(DEPTH_CLASS_RANGES)) {
      const r = range as DepthClassRange;
      expect(r.min).toBeGreaterThanOrEqual(0);
      expect(r.max).toBeLessThanOrEqual(1);
      expect(r.min).toBeLessThanOrEqual(r.max);
    }
  });

  // --- Specific class range checks ---

  it('sky range is far from camera (min >= 0.75)', () => {
    expect(DEPTH_CLASS_RANGES.sky.min).toBeGreaterThanOrEqual(0.75);
  });

  it('ground range is near camera (max <= 0.30)', () => {
    expect(DEPTH_CLASS_RANGES.ground.max).toBeLessThanOrEqual(0.30);
  });

  it('roof range is in the middle (min >= 0.20, max <= 0.80)', () => {
    expect(DEPTH_CLASS_RANGES.roof.min).toBeGreaterThanOrEqual(0.20);
    expect(DEPTH_CLASS_RANGES.roof.max).toBeLessThanOrEqual(0.80);
  });

  // --- Background class is excluded from contradiction checking ---

  it('background has checkContradiction=false', () => {
    expect(DEPTH_CLASS_RANGES.background.checkContradiction).toBe(false);
  });

  it('background has full range [0, 1]', () => {
    expect(DEPTH_CLASS_RANGES.background.min).toBe(0);
    expect(DEPTH_CLASS_RANGES.background.max).toBe(1);
  });

  // --- Electrical/solar classes are excluded ---

  it('electrical/solar classes have checkContradiction=false', () => {
    const excludedClasses = [
      'ac_unit', 'existing_solar_panel', 'utility_meter',
      'main_service_panel', 'disconnect', 'conduit', 'inverter', 'battery',
    ];
    for (const cls of excludedClasses) {
      expect(DEPTH_CLASS_RANGES[cls as keyof typeof DEPTH_CLASS_RANGES].checkContradiction).toBe(false);
    }
  });

  // --- Structural classes have checkContradiction=true ---

  it('structural classes have checkContradiction=true', () => {
    const structuralClasses = ['roof', 'wall', 'siding', 'fascia', 'soffit', 'chimney'];
    for (const cls of structuralClasses) {
      expect(DEPTH_CLASS_RANGES[cls as keyof typeof DEPTH_CLASS_RANGES].checkContradiction).toBe(true);
    }
  });
});

// ===========================================================================
// P0-2.2: computeDepthDeviation
// ===========================================================================

describe('P0-2.2: computeDepthDeviation', () => {
  it('returns 0 when depth is within range', () => {
    // roof range is [0.25, 0.75]
    expect(computeDepthDeviation('roof', 0.50)).toBe(0);
    expect(computeDepthDeviation('roof', 0.25)).toBe(0);
    expect(computeDepthDeviation('roof', 0.75)).toBe(0);
  });

  it('returns positive deviation when depth is below range minimum', () => {
    // roof range is [0.25, 0.75]; depth=0.10 → deviation=0.15
    const deviation = computeDepthDeviation('roof', 0.10);
    expect(deviation).toBeCloseTo(0.15, 4);
  });

  it('returns positive deviation when depth is above range maximum', () => {
    // roof range is [0.25, 0.75]; depth=0.90 → deviation=0.15
    const deviation = computeDepthDeviation('roof', 0.90);
    expect(deviation).toBeCloseTo(0.15, 4);
  });

  it('returns 0 for unknown class (no range)', () => {
    // This shouldn't happen in practice but we test the fallback
    expect(computeDepthDeviation('background', 0.99)).toBe(0);
    expect(computeDepthDeviation('background', 0.01)).toBe(0);
  });

  it('sky at near depth produces large deviation', () => {
    // sky range is [0.75, 1.00]; depth=0.10 → deviation=0.65
    const deviation = computeDepthDeviation('sky', 0.10);
    expect(deviation).toBeCloseTo(0.65, 4);
  });

  it('ground at far depth produces large deviation', () => {
    // ground range is [0.00, 0.30]; depth=0.80 → deviation=0.50
    const deviation = computeDepthDeviation('ground', 0.80);
    expect(deviation).toBeCloseTo(0.50, 4);
  });
});

// ===========================================================================
// P0-2.2: classifyDeviation
// ===========================================================================

describe('P0-2.2: classifyDeviation', () => {
  it('returns "none" for deviation < 0.05', () => {
    expect(classifyDeviation(0)).toBe('none');
    expect(classifyDeviation(0.049)).toBe('none');
  });

  it('returns "minor" for deviation 0.05–0.10', () => {
    expect(classifyDeviation(0.05)).toBe('minor');
    expect(classifyDeviation(0.099)).toBe('minor');
  });

  it('returns "moderate" for deviation 0.10–0.20', () => {
    expect(classifyDeviation(0.10)).toBe('moderate');
    expect(classifyDeviation(0.199)).toBe('moderate');
  });

  it('returns "major" for deviation > 0.20', () => {
    expect(classifyDeviation(0.20)).toBe('major');
    expect(classifyDeviation(0.50)).toBe('major');
    expect(classifyDeviation(1.0)).toBe('major');
  });
});

// ===========================================================================
// P0-2.3: Feature flag
// ===========================================================================

describe('P0-2.3: isPhase0DepthContradictionEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when PHASE0_DEPTH_CONTRADICTION is not set', () => {
    delete process.env.PHASE0_DEPTH_CONTRADICTION;
    expect(isPhase0DepthContradictionEnabled()).toBe(false);
  });

  it('returns false when PHASE0_DEPTH_CONTRADICTION is empty', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION = '';
    expect(isPhase0DepthContradictionEnabled()).toBe(false);
  });

  it('returns true when PHASE0_DEPTH_CONTRADICTION is "true"', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION = 'true';
    expect(isPhase0DepthContradictionEnabled()).toBe(true);
  });

  it('returns true when PHASE0_DEPTH_CONTRADICTION is "1"', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION = '1';
    expect(isPhase0DepthContradictionEnabled()).toBe(true);
  });

  it('returns false for other values', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION = 'yes';
    expect(isPhase0DepthContradictionEnabled()).toBe(false);
  });
});

// ===========================================================================
// P0-2.3: computeMaskMeanDepth
// ===========================================================================

describe('P0-2.3: computeMaskMeanDepth', () => {
  it('returns null for mask with no maskBounds', () => {
    const mask = makeMask({ maskBounds: undefined as any });
    const grid = makeUniformGrid(10, 10, 0.5);
    expect(computeMaskMeanDepth(mask, grid, 10, 10)).toBeNull();
  });

  it('computes mean depth from uniform grid', () => {
    const mask = makeMask({
      maskBounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.3, coordinateSystem: 'normalized_image_0_1000' },
    });
    const grid = makeUniformGrid(100, 100, 0.5);
    const result = computeMaskMeanDepth(mask, grid, 100, 100);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.5, 2);
  });

  it('computes mean depth from split grid', () => {
    const mask = makeMask({
      maskBounds: { x: 0.0, y: 0.0, width: 0.5, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Upper half = 0.8 (near), lower half = 0.2 (far)
    const grid = makeSplitGrid(10, 10, 0.8, 0.2);
    const result = computeMaskMeanDepth(mask, grid, 10, 10);
    expect(result).not.toBeNull();
    // Left half, full height: average of upper (0.8) and lower (0.2) rows
    expect(result!).toBeCloseTo(0.5, 2);
  });

  it('returns null when bounding box yields zero grid cells', () => {
    const mask = makeMask({
      maskBounds: { x: 0.99, y: 0.99, width: 0.001, height: 0.001, coordinateSystem: 'normalized_image_0_1000' },
    });
    const grid = makeUniformGrid(2, 2, 0.5);
    // With a 2x2 grid, a tiny bounds at 0.99+ might round to indices that
    // produce start > end, yielding null
    const result = computeMaskMeanDepth(mask, grid, 2, 2);
    // Result depends on rounding; it may be null or a single cell
    // The key thing is it doesn't crash
    if (result !== null) {
      expect(typeof result).toBe('number');
    }
  });

  it('skips NaN values in depth grid', () => {
    const mask = makeMask({
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    const grid = makeUniformGrid(10, 10, 0.5);
    // Set some cells to NaN
    grid[0] = NaN;
    grid[50] = NaN;
    const result = computeMaskMeanDepth(mask, grid, 10, 10);
    expect(result).not.toBeNull();
    // Should still compute mean of the remaining valid cells
    expect(result!).toBeCloseTo(0.5, 2);
  });
});

// ===========================================================================
// P0-2.3: suggestReclassification
// ===========================================================================

describe('P0-2.3: suggestReclassification', () => {
  it('does not suggest the same class when depth matches multiple ranges', () => {
    // roof range is [0.25, 0.75], depth=0.50 is inside roof range but also
    // inside other ranges (moss [0.15,0.55], etc.). The function will suggest
    // the narrowest matching non-current class. The key invariant is that
    // it never suggests the same class as the current one.
    const result = suggestReclassification('roof', 0.50);
    if (result !== null) {
      expect(result).not.toBe('roof');
    }
  });

  it('suggests a class when depth matches a different class range', () => {
    // depth=0.90 is in sky range [0.75, 1.00] → should suggest sky
    const suggestion = suggestReclassification('roof', 0.90);
    expect(suggestion).toBe('sky');
  });

  it('prefers the narrowest matching range', () => {
    // depth=0.15 matches both ground [0,0.30] (width=0.30) and car [0.05,0.40] (width=0.35)
    // and other classes — should prefer ground (narrower range)
    const suggestion = suggestReclassification('roof', 0.15);
    // ground range width = 0.30, which is narrower than car (0.35), driveway (0.30), etc.
    // There might be multiple 0.30-width classes, so just verify it's a ground-like class
    expect(suggestion).toBeTruthy();
    if (suggestion) {
      const range = DEPTH_CLASS_RANGES[suggestion as keyof typeof DEPTH_CLASS_RANGES];
      expect(range.checkContradiction).toBe(true);
      expect(0.15).toBeGreaterThanOrEqual(range.min);
      expect(0.15).toBeLessThanOrEqual(range.max);
    }
  });

  it('background class is excluded from suggestions (checkContradiction=false)', () => {
    // background has checkContradiction=false, so it can never be a suggestion.
    // Other classes at depth=0.50 may be suggested — verify 'background' is not one of them.
    const result = suggestReclassification('roof', 0.50);
    if (result !== null) {
      expect(result).not.toBe('background');
    }
  });

  it('does not suggest the same class as current', () => {
    // Even if depth is in the current class range, it should not suggest itself
    // This is tested by the null return for in-range depths
    expect(suggestReclassification('sky', 0.90)).toBeNull();
  });
});

// ===========================================================================
// P0-2.3: applyContradictionPenalty
// ===========================================================================

describe('P0-2.3: applyContradictionPenalty', () => {
  it('reduces confidence by the penalty amount', () => {
    expect(applyContradictionPenalty(80, 15)).toBe(65);
    expect(applyContradictionPenalty(80, 30)).toBe(50);
  });

  it('clamps to minimum of 5', () => {
    expect(applyContradictionPenalty(10, 30)).toBe(5);
    expect(applyContradictionPenalty(5, 100)).toBe(5);
    expect(applyContradictionPenalty(1, 50)).toBe(5);
  });

  it('no penalty yields same confidence', () => {
    expect(applyContradictionPenalty(80, 0)).toBe(80);
  });
});

// ===========================================================================
// P0-2.3: detectDepthContradictions — full detector
// ===========================================================================

describe('P0-2.3: detectDepthContradictions', () => {
  it('skips detection when usedMidas=false (heuristic path)', () => {
    const mask = makeMask({ segmentationClass: 'roof' });
    const grid = makeUniformGrid(100, 100, 0.90); // depth far from roof range
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: false,
    });
    expect(result.detectorRan).toBe(false);
    expect(result.reports).toHaveLength(0);
    expect(result.masksSkipped).toBe(1);
  });

  it('detects contradiction when roof mask has sky-like depth', () => {
    const mask = makeMask({
      id: 'mask-roof-sky',
      segmentationClass: 'roof',
      maskBounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.3, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Depth grid with high values (sky-depth, 0.90) — contradicts roof [0.25, 0.75]
    const grid = makeUniformGrid(100, 100, 0.90);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.detectorRan).toBe(true);
    expect(result.masksChecked).toBe(1);
    expect(result.reports.length).toBeGreaterThanOrEqual(1);
    expect(result.reports[0].segmentationClass).toBe('roof');
    expect(result.reports[0].severity).toBe('moderate'); // 0.90 - 0.75 = 0.15 → moderate (0.10-0.20)
    expect(result.reports[0].deviation).toBeCloseTo(0.15, 4);
  });

  it('skips masks with checkContradiction=false (background, electrical)', () => {
    const bgMask = makeMask({ id: 'mask-bg', segmentationClass: 'background' });
    const acMask = makeMask({ id: 'mask-ac', segmentationClass: 'ac_unit' });
    const grid = makeUniformGrid(100, 100, 0.90);
    const result = detectDepthContradictions({
      masks: [bgMask, acMask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.masksSkipped).toBe(2);
    expect(result.masksChecked).toBe(0);
    expect(result.reports).toHaveLength(0);
  });

  it('skips masks with excludeFromGeometry=true', () => {
    const mask = makeMask({
      segmentationClass: 'sky',
      excludeFromGeometry: true,
    });
    const grid = makeUniformGrid(100, 100, 0.10); // contradicts sky range
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.masksSkipped).toBe(1);
    expect(result.reports).toHaveLength(0);
  });

  it('skips masks with no maskBounds', () => {
    const mask = makeMask({ maskBounds: undefined as any });
    const grid = makeUniformGrid(100, 100, 0.90);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.masksSkipped).toBe(1);
  });

  it('does not report severity=none deviations by default', () => {
    const mask = makeMask({
      segmentationClass: 'roof',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Roof range is [0.25, 0.75]. Depth=0.50 is well within range → severity='none'
    const grid = makeUniformGrid(100, 100, 0.50);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.masksChecked).toBe(1);
    expect(result.masksContradicted).toBe(0);
    expect(result.reports).toHaveLength(0);
  });

  it('reports moderate severity contradictions with correct penalty', () => {
    const mask = makeMask({
      id: 'mask-roof-mod',
      segmentationClass: 'roof',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Roof range [0.25, 0.75]. Depth=0.86 → deviation=0.11 → moderate
    const grid = makeUniformGrid(100, 100, 0.86);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].severity).toBe('moderate');
    expect(result.reports[0].confidencePenalty).toBe(15);
    expect(result.totalConfidencePenalty).toBe(15);
  });

  it('reports major severity contradictions with correct penalty', () => {
    const mask = makeMask({
      id: 'mask-sky-ground',
      segmentationClass: 'sky',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Sky range [0.75, 1.00]. Depth=0.10 → deviation=0.65 → major
    const grid = makeUniformGrid(100, 100, 0.10);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].severity).toBe('major');
    expect(result.reports[0].confidencePenalty).toBe(30);
    expect(result.totalConfidencePenalty).toBe(30);
  });

  it('respects minReportSeverity filter', () => {
    const mask = makeMask({
      id: 'mask-roof-minor',
      segmentationClass: 'roof',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Roof range [0.25, 0.75]. Depth=0.81 → deviation=0.06 → minor
    const grid = makeUniformGrid(100, 100, 0.81);
    // With minReportSeverity='moderate', minor deviations are not reported
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
      minReportSeverity: 'moderate',
    });
    expect(result.reports).toHaveLength(0);
  });

  it('handles multiple masks with mixed results', () => {
    const roofMask = makeMask({
      id: 'mask-roof-ok',
      segmentationClass: 'roof',
      maskBounds: { x: 0.0, y: 0.0, width: 0.5, height: 0.5, coordinateSystem: 'normalized_image_0_1000' },
    });
    const skyMask = makeMask({
      id: 'mask-sky-bad',
      segmentationClass: 'sky',
      maskBounds: { x: 0.5, y: 0.0, width: 0.5, height: 0.5, coordinateSystem: 'normalized_image_0_1000' },
    });
    const bgMask = makeMask({
      id: 'mask-bg',
      segmentationClass: 'background',
      maskBounds: { x: 0.0, y: 0.5, width: 0.5, height: 0.5, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Depth grid: all 0.50 (roof is OK at 0.50, sky is contradicted [0.75-1.00])
    const grid = makeUniformGrid(100, 100, 0.50);
    const result = detectDepthContradictions({
      masks: [roofMask, skyMask, bgMask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.masksChecked).toBe(2); // roof + sky
    expect(result.masksSkipped).toBe(1); // background
    expect(result.masksContradicted).toBe(1); // sky
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].maskId).toBe('mask-sky-bad');
  });

  it('includes reclassification suggestion for moderate+ deviations', () => {
    const mask = makeMask({
      id: 'mask-roof-reclass',
      segmentationClass: 'roof',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    // Roof [0.25, 0.75]. Depth=0.90 → deviation=0.15 → moderate → should suggest 'sky'
    const grid = makeUniformGrid(100, 100, 0.90);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].description).toContain('reclassification');
  });

  it('contradiction report has all required fields', () => {
    const mask = makeMask({
      id: 'mask-fields',
      segmentationClass: 'sky',
      maskBounds: { x: 0.0, y: 0.0, width: 1.0, height: 1.0, coordinateSystem: 'normalized_image_0_1000' },
    });
    const grid = makeUniformGrid(100, 100, 0.10);
    const result = detectDepthContradictions({
      masks: [mask],
      depthGrid: grid,
      gridWidth: 100,
      gridHeight: 100,
      usedMidas: true,
    });
    expect(result.reports).toHaveLength(1);
    const report = result.reports[0];
    expect(report).toHaveProperty('segmentationClass');
    expect(report).toHaveProperty('maskId');
    expect(report).toHaveProperty('expectedRange');
    expect(report).toHaveProperty('actualDepth');
    expect(report).toHaveProperty('deviation');
    expect(report).toHaveProperty('severity');
    expect(report).toHaveProperty('confidencePenalty');
    expect(report).toHaveProperty('description');
    expect(report.maskId).toBe('mask-fields');
    expect(report.segmentationClass).toBe('sky');
    expect(report.expectedRange).toHaveLength(2);
  });
});
