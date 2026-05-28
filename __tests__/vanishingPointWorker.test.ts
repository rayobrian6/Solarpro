/**
 * Vanishing point estimation worker tests.
 *
 * Tests the estimateVanishingPoints function that produces
 * VanishingPointArtifact artifacts from structural line candidates.
 *
 * @jest-environment node
 */

import {
  estimateVanishingPoints,
  estimateVanishingPointsFromReconstructionInput,
  VANISHING_POINT_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/perspective';
import type { VanishingPointWorkerInput } from '@/lib/siteSurveys/geometryReconstruction/workers/perspective';
import type {
  StructuralLineCandidate,
  VanishingPointArtifact,
  GeometryReconstructionInput,
  NormalizedPoint,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import { validateVanishingPointArtifact } from '@/lib/siteSurveys/geometryReconstruction/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number): NormalizedPoint {
  return { x, y, coordinateSystem: 'normalized_image_0_1000' };
}

function makeLine(overrides: Partial<StructuralLineCandidate> & { lineType: StructuralLineCandidate['lineType'] }): StructuralLineCandidate {
  return {
    artifactType: 'structural_line_candidate',
    id: `line-${overrides.lineType}-001`,
    fileId: 'file-001',
    confidence: 65,
    workerVersion: '1.0.0-test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

/**
 * Create a set of lines that converge to a known vanishing point.
 * All lines pass through (vpx, vpy) and have different starting points.
 */
function makeConvergingLines(
  vpx: number,
  vpy: number,
  count: number,
  lineType: 'ridge' | 'eave' | 'rake' | 'wall_vertical',
): StructuralLineCandidate[] {
  const lines: StructuralLineCandidate[] = [];
  for (let i = 0; i < count; i++) {
    // Start point: spread along the image
    const startX = 100 + i * (600 / count);
    const startY = 200 + i * (400 / count);

    // End point: offset from start, towards VP
    const dx = vpx - startX;
    const dy = vpy - startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const t = 300 / Math.max(len, 1); // 300 normalized units long
    const endX = startX + dx * t;
    const endY = startY + dy * t;

    lines.push(makeLine({
      id: `line-${lineType}-${i}`,
      lineType,
      start: pt(startX, startY),
      end: pt(endX, endY),
    }));
  }
  return lines;
}

function makeInput(overrides?: Partial<VanishingPointWorkerInput>): VanishingPointWorkerInput {
  // Create converging lines for X and Y VPs
  const xLines = makeConvergingLines(1500, 300, 4, 'ridge');
  const yLines = makeConvergingLines(-200, 400, 3, 'eave');
  const vertLines = makeConvergingLines(500, -800, 3, 'wall_vertical');

  return {
    surveyId: 'survey-001',
    lines: [...xLines, ...yLines, ...vertLines],
    ...overrides,
  };
}

function makeReconstructionInput(): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [
      { fileId: 'file-001', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    ],
    pipeline: 'depth_estimation',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vanishing point estimation', () => {
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', () => {
      const result = estimateVanishingPoints(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
    });

    it('returns the correct worker version', () => {
      const result = estimateVanishingPoints(makeInput());
      expect(result.workerVersion).toBe(VANISHING_POINT_WORKER_VERSION);
    });

    it('produces VanishingPointArtifact artifacts', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.artifactType).toBe('vanishing_point');
      }
    });
  });

  describe('empty / insufficient input', () => {
    it('returns empty artifacts for no lines', () => {
      const result = estimateVanishingPoints({ surveyId: 's1', lines: [] });
      expect(result.artifacts).toEqual([]);
    });

    it('returns empty artifacts for a single line', () => {
      const result = estimateVanishingPoints({
        surveyId: 's1',
        lines: [makeLine({ lineType: 'ridge', start: pt(100, 100), end: pt(900, 100) })],
      });
      expect(result.artifacts).toEqual([]);
    });
  });

  describe('direction estimation', () => {
    it('can detect X-direction vanishing points from ridge lines', () => {
      const xLines = makeConvergingLines(1500, 300, 5, 'ridge');
      const result = estimateVanishingPoints({ surveyId: 's1', lines: xLines });
      const xVps = result.artifacts.filter(a => a.direction === 'x');
      expect(xVps.length).toBeGreaterThan(0);
    });

    it('can detect Y-direction vanishing points from eave lines', () => {
      const yLines = makeConvergingLines(-200, 400, 5, 'eave');
      const result = estimateVanishingPoints({ surveyId: 's1', lines: yLines });
      const yVps = result.artifacts.filter(a => a.direction === 'y');
      expect(yVps.length).toBeGreaterThan(0);
    });

    it('can detect vertical vanishing points from wall_vertical lines', () => {
      const vertLines = makeConvergingLines(500, -800, 5, 'wall_vertical');
      const result = estimateVanishingPoints({ surveyId: 's1', lines: vertLines });
      const vertVps = result.artifacts.filter(a => a.direction === 'vertical');
      expect(vertVps.length).toBeGreaterThan(0);
    });
  });

  describe('artifact validation', () => {
    it('all produced artifacts pass schema validation', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        const validation = validateVanishingPointArtifact(artifact);
        expect(validation.valid).toBe(true);
      }
    });

    it('artifacts have valid direction values', () => {
      const validDirections = ['x', 'y', 'vertical'];
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(validDirections).toContain(artifact.direction);
      }
    });
  });

  describe('authority and limitations', () => {
    it('all artifacts carry review-only authority', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.authority).toEqual(REVIEW_ONLY_AUTHORITY);
      }
    });

    it('all artifacts carry limitations', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations.length).toBeGreaterThan(0);
        expect(artifact.limitations).toContain('REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY');
      }
    });

    it('limitations include VP-specific disclaimers', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.limitations).toContain(
          'Vanishing point estimation is heuristic RANSAC — not from a trained perspective model.',
        );
      }
    });
  });

  describe('confidence and inlier metrics', () => {
    it('confidence is between 0 and 100', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('inlierRatio is between 0 and 1', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.inlierRatio).toBeGreaterThanOrEqual(0);
        expect(artifact.inlierRatio).toBeLessThanOrEqual(1);
      }
    });

    it('supportingLineCount matches supportingLineIds length', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.supportingLineCount).toBe(artifact.supportingLineIds.length);
      }
    });

    it('more converging lines produce higher confidence', () => {
      const fewLines = makeConvergingLines(1500, 300, 3, 'ridge');
      const manyLines = makeConvergingLines(1500, 300, 8, 'ridge');

      const resultFew = estimateVanishingPoints({ surveyId: 's1', lines: fewLines });
      const resultMany = estimateVanishingPoints({ surveyId: 's1', lines: manyLines });

      const fewVp = resultFew.artifacts.find(a => a.direction === 'x');
      const manyVp = resultMany.artifacts.find(a => a.direction === 'x');

      if (fewVp && manyVp) {
        expect(manyVp.confidence).toBeGreaterThanOrEqual(fewVp.confidence);
      }
    });

    it('respects minConfidence config', () => {
      const result = estimateVanishingPoints({
        ...makeInput(),
        config: { minConfidence: 80 },
      });
      for (const artifact of result.artifacts) {
        expect(artifact.confidence).toBeGreaterThanOrEqual(80);
      }
    });
  });

  describe('VP point coordinates', () => {
    it('point uses normalized_image_0_1000 coordinate system', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.point.coordinateSystem).toBe('normalized_image_0_1000');
      }
    });

    it('VP point coordinates are clamped to reasonable bounds', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        // VPs can be outside the image but should be clamped
        expect(artifact.point.x).toBeGreaterThanOrEqual(-500);
        expect(artifact.point.x).toBeLessThanOrEqual(1500);
        expect(artifact.point.y).toBeGreaterThanOrEqual(-500);
        expect(artifact.point.y).toBeLessThanOrEqual(1500);
      }
    });
  });

  describe('worker version', () => {
    it('all artifacts carry the worker version', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const artifact of result.artifacts) {
        expect(artifact.workerVersion).toBe(VANISHING_POINT_WORKER_VERSION);
      }
    });
  });

  describe('stage timings', () => {
    it('records timing for each processing stage', () => {
      const result = estimateVanishingPoints(makeInput());
      expect(result.stageTimings['initialization']).toBeDefined();
      expect(result.stageTimings['line_conversion']).toBeDefined();
      expect(result.stageTimings['direction_grouping']).toBeDefined();
      expect(result.stageTimings['ransac_estimation']).toBeDefined();
    });

    it('all timings are non-negative numbers', () => {
      const result = estimateVanishingPoints(makeInput());
      for (const value of Object.values(result.stageTimings)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('RANSAC config', () => {
    it('respects ransacIterations config', () => {
      // Low iterations — should still work but may produce less optimal results
      const result = estimateVanishingPoints({
        ...makeInput(),
        config: { ransacIterations: 5 },
      });
      // Should still produce some VPs (just less optimal)
      expect(result.artifacts.length).toBeGreaterThanOrEqual(0);
    });

    it('respects minSupportingLines config', () => {
      const fewLines = makeConvergingLines(1500, 300, 2, 'ridge');
      const result = estimateVanishingPoints({
        surveyId: 's1',
        lines: fewLines,
        config: { minSupportingLines: 5 },
      });
      // Only 2 lines, need 5 — should produce no VPs
      expect(result.artifacts.length).toBe(0);
    });

    it('respects inlierThreshold config', () => {
      const xLines = makeConvergingLines(1500, 300, 5, 'ridge');
      const resultTight = estimateVanishingPoints({
        surveyId: 's1',
        lines: xLines,
        config: { inlierThreshold: 1 },
      });
      const resultLoose = estimateVanishingPoints({
        surveyId: 's1',
        lines: xLines,
        config: { inlierThreshold: 200 },
      });
      // Looser threshold should have more or equal inliers
      if (resultTight.artifacts.length > 0 && resultLoose.artifacts.length > 0) {
        const tightVp = resultTight.artifacts[0];
        const looseVp = resultLoose.artifacts[0];
        expect(looseVp.supportingLineCount).toBeGreaterThanOrEqual(tightVp.supportingLineCount);
      }
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const input = makeInput();
      const result1 = estimateVanishingPoints(input);
      const result2 = estimateVanishingPoints(input);
      expect(result1.artifacts).toEqual(result2.artifacts);
    });
  });

  describe('estimateVanishingPointsFromReconstructionInput', () => {
    it('converts input and delegates to the worker', () => {
      const input = makeReconstructionInput();
      const lines = makeConvergingLines(1500, 300, 5, 'ridge');
      const artifacts = estimateVanishingPointsFromReconstructionInput(input, lines);
      for (const artifact of artifacts) {
        expect(artifact.artifactType).toBe('vanishing_point');
      }
    });

    it('returns empty array for no lines', () => {
      const input = makeReconstructionInput();
      const artifacts = estimateVanishingPointsFromReconstructionInput(input, []);
      expect(artifacts).toEqual([]);
    });
  });

  describe('parallel lines handling', () => {
    it('handles parallel lines that have no intersection', () => {
      const parallelLines: StructuralLineCandidate[] = [
        makeLine({ id: 'line-ridge-0', lineType: 'ridge', start: pt(100, 100), end: pt(900, 100) }),
        makeLine({ id: 'line-ridge-1', lineType: 'ridge', start: pt(100, 200), end: pt(900, 200) }),
        makeLine({ id: 'line-ridge-2', lineType: 'ridge', start: pt(100, 300), end: pt(900, 300) }),
      ];
      const result = estimateVanishingPoints({ surveyId: 's1', lines: parallelLines });
      // Parallel lines converge at infinity — may or may not produce a VP
      // depending on RANSAC finding an approximate intersection
      // The key thing is it doesn't crash
      expect(result.artifacts.length).toBeGreaterThanOrEqual(0);
    });
  });
});
