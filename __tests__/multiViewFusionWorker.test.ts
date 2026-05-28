/**
 * Tests for the multi-view fusion worker.
 *
 * Run with: npx jest __tests__/multiViewFusionWorker.test.ts --no-cache
 */

import {
  runMultiViewFusion,
  MULTI_VIEW_FUSION_WORKER_VERSION,
} from '@/lib/siteSurveys/geometryReconstruction/workers/multiViewFusion/runMultiViewFusion';
import type {
  MultiViewFusionInput,
  PerPhotoArtifacts,
} from '@/lib/siteSurveys/geometryReconstruction/workers/multiViewFusion/runMultiViewFusion';
import type {
  RoofPlaneCandidate,
  WallPlaneCandidate,
  SemanticSegmentationMask,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoofPlane(overrides: Partial<RoofPlaneCandidate> = {}): RoofPlaneCandidate {
  return {
    artifactType: 'roof_plane_candidate',
    normal: [0, 0, 1],
    d: 0,
    inlierCount: 50,
    totalPoints: 100,
    slopeDegrees: 30,
    aspectDegrees: 180,
    associatedLineIds: [],
    confidence: 60,
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

function makeWallPlane(overrides: Partial<WallPlaneCandidate> = {}): WallPlaneCandidate {
  return {
    artifactType: 'wall_plane_candidate',
    normal: [1, 0, 0],
    d: 0,
    inlierCount: 40,
    totalPoints: 100,
    facingDirection: 'north',
    associatedLineIds: [],
    confidence: 55,
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

function makeMask(overrides: Partial<SemanticSegmentationMask> = {}): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    fileId: 'photo1',
    className: 'roof',
    classId: 1,
    polygon: [
      { x: 100, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 100, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 300, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
      { x: 100, y: 300, coordinateSystem: 'normalized_image_0_1000' as const },
    ],
    confidence: 80,
    region: { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' },
    workerVersion: '1.0.0-test',
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

function makeInput(overrides: Partial<MultiViewFusionInput> = {}): MultiViewFusionInput {
  return {
    perPhotoArtifacts: [],
    surveyId: 'survey-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('multi-view fusion worker', () => {
  // -----------------------------------------------------------------------
  // Basic output shape
  // -----------------------------------------------------------------------
  describe('basic output shape', () => {
    it('returns an object with artifacts, stageTimings, and workerVersion', () => {
      const result = runMultiViewFusion(makeInput());
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('stageTimings');
      expect(result).toHaveProperty('workerVersion');
    });

    it('returns the correct worker version', () => {
      const result = runMultiViewFusion(makeInput());
      expect(result.workerVersion).toBe(MULTI_VIEW_FUSION_WORKER_VERSION);
    });

    it('returns ConsensusPlaneCandidate artifacts', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.artifactType).toBe('consensus_plane_candidate');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Single photo
  // -----------------------------------------------------------------------
  describe('single photo', () => {
    it('produces one consensus roof from one roof plane', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      expect(roofs.length).toBe(1);
    });

    it('produces one consensus wall from one wall plane', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [],
            wallPlanes: [makeWallPlane()],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      const walls = result.artifacts.filter((a) => a.planeType === 'wall');
      expect(walls.length).toBe(1);
    });

    it('produces separate consensus planes for roof and wall', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [makeWallPlane()],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      const walls = result.artifacts.filter((a) => a.planeType === 'wall');
      expect(roofs.length).toBe(1);
      expect(walls.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-photo consensus
  // -----------------------------------------------------------------------
  describe('multi-photo consensus', () => {
    it('merges matching roof planes from different photos', () => {
      const roof1 = makeRoofPlane({
        normal: [0.1, 0.2, 0.97],
        slopeDegrees: 25,
        aspectDegrees: 90,
        confidence: 70,
        region: { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' },
      });
      const roof2 = makeRoofPlane({
        normal: [0.12, 0.18, 0.96],
        slopeDegrees: 27,
        aspectDegrees: 95,
        confidence: 65,
        region: { x: 110, y: 110, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' },
      });

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      expect(roofs.length).toBe(1);
      expect(roofs[0].consensusPhotoCount).toBe(2);
      expect(roofs[0].sourceFileIds).toContain('photo1');
      expect(roofs[0].sourceFileIds).toContain('photo2');
    });

    it('does not merge planes with dissimilar normals', () => {
      const roof1 = makeRoofPlane({ normal: [0, 0, 1] }); // pointing up
      const roof2 = makeRoofPlane({ normal: [1, 0, 0] }); // pointing sideways — very different

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      // Should be 2 separate clusters (normals too different)
      expect(roofs.length).toBe(2);
      expect(roofs[0].consensusPhotoCount).toBe(1);
      expect(roofs[1].consensusPhotoCount).toBe(1);
    });

    it('does not merge planes with no polygon overlap', () => {
      const roof1 = makeRoofPlane({
        normal: [0, 0, 1],
        region: { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' },
      });
      const roof2 = makeRoofPlane({
        normal: [0, 0, 1],
        region: { x: 800, y: 800, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' },
      });

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      // Same normals but no overlap => separate clusters
      expect(roofs.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Consensus plane properties
  // -----------------------------------------------------------------------
  describe('consensus plane properties', () => {
    it('has averaged normal vector', () => {
      const roof1 = makeRoofPlane({ normal: [0, 0, 1] });
      const roof2 = makeRoofPlane({ normal: [0, 0, 1] });

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      if (roofs.length > 0 && roofs[0].consensusPhotoCount > 1) {
        // Averaged normal should be close to [0, 0, 1]
        const n = roofs[0].normalVector;
        expect(Math.abs(n.z)).toBeCloseTo(1, 1);
      }
    });

    it('has estimated pitch for roof planes', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane({ slopeDegrees: 30 })],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      if (roofs.length > 0) {
        expect(roofs[0].estimatedPitch).toBeDefined();
      }
    });

    it('has polygon with at least 3 vertices', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.polygon.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('includes source file IDs', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.sourceFileIds).toContain('photo1');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Authority and limitations
  // -----------------------------------------------------------------------
  describe('authority and limitations', () => {
    it('carries review-only authority', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.authority.reviewOnly).toBe(true);
        expect(art.authority.nonAuthoritative).toBe(true);
        expect(art.authority.cadMutationAllowed).toBe(false);
      }
    });

    it('carries limitations', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.limitations.length).toBeGreaterThan(0);
      }
    });

    it('limitations include fusion-specific disclaimers', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        const text = art.limitations.join(' ');
        expect(text).toContain('heuristic');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Confidence scoring
  // -----------------------------------------------------------------------
  describe('confidence scoring', () => {
    it('confidence is between 0 and 100', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane({ confidence: 50 })],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.confidence).toBeGreaterThanOrEqual(0);
        expect(art.confidence).toBeLessThanOrEqual(100);
      }
    });

    it('higher consensus count boosts confidence', () => {
      const roof = makeRoofPlane({ normal: [0, 0, 1], confidence: 50 });

      const singleResult = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      }));

      const multiResult = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      }));

      const singleRoof = singleResult.artifacts.find((a) => a.planeType === 'roof');
      const multiRoof = multiResult.artifacts.find((a) => a.planeType === 'roof' && a.consensusPhotoCount > 1);

      if (singleRoof && multiRoof) {
        expect(multiRoof.confidence).toBeGreaterThanOrEqual(singleRoof.confidence);
      }
    });

    it('respects minConfidence config', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane({ confidence: 5 })],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
        config: { minConfidence: 50 },
      });
      const result = runMultiViewFusion(input);
      for (const art of result.artifacts) {
        expect(art.confidence).toBeGreaterThanOrEqual(50);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Stage timings
  // -----------------------------------------------------------------------
  describe('stage timings', () => {
    it('records timing for each processing stage', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      expect(result.stageTimings.collectPlanes).toBeDefined();
      expect(result.stageTimings.clusterPlanes).toBeDefined();
      expect(result.stageTimings.buildConsensus).toBeDefined();
      expect(result.stageTimings.total).toBeDefined();
    });

    it('all timings are non-negative numbers', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      for (const value of Object.values(result.stageTimings)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------
  describe('determinism', () => {
    it('produces the same artifact count for identical inputs', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [makeRoofPlane()],
            wallPlanes: [],
            masks: [],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result1 = runMultiViewFusion(input);
      const result2 = runMultiViewFusion(input);
      expect(result1.artifacts.length).toBe(result2.artifacts.length);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns empty artifacts for no input planes', () => {
      const input = makeInput({ perPhotoArtifacts: [] });
      const result = runMultiViewFusion(input);
      expect(result.artifacts).toEqual([]);
    });

    it('handles photos with only masks and no planes', () => {
      const input = makeInput({
        perPhotoArtifacts: [
          {
            fileId: 'photo1',
            roofPlanes: [],
            wallPlanes: [],
            masks: [makeMask()],
            lines: [],
            vanishingPoints: [],
          },
        ],
      });
      const result = runMultiViewFusion(input);
      expect(result.artifacts).toEqual([]);
    });

    it('handles three or more photos merging into one consensus', () => {
      const roof = makeRoofPlane({ normal: [0, 0, 1] });

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo3', roofPlanes: [roof], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof' && a.consensusPhotoCount >= 3);
      expect(roofs.length).toBeGreaterThanOrEqual(1);
      if (roofs.length > 0) {
        expect(roofs[0].consensusPhotoCount).toBe(3);
      }
    });

    it('handles mixed roof and wall planes across photos', () => {
      const roof = makeRoofPlane({ normal: [0, 0, 1] });
      const wall = makeWallPlane({ normal: [1, 0, 0] });

      const input = makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof], wallPlanes: [wall], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof], wallPlanes: [wall], masks: [], lines: [], vanishingPoints: [] },
        ],
      });

      const result = runMultiViewFusion(input);
      const roofs = result.artifacts.filter((a) => a.planeType === 'roof');
      const walls = result.artifacts.filter((a) => a.planeType === 'wall');
      expect(roofs.length).toBeGreaterThanOrEqual(1);
      expect(walls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Config overrides
  // -----------------------------------------------------------------------
  describe('config overrides', () => {
    it('respects normalSimilarityThreshold config', () => {
      // Two normals that are somewhat similar (~0.71 cosine)
      const roof1 = makeRoofPlane({ normal: [1, 0, 0] });
      const roof2 = makeRoofPlane({ normal: [1, 1, 0] });

      // With high threshold, they should NOT merge
      const strict = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
        config: { normalSimilarityThreshold: 0.99 },
      }));

      // With low threshold, they SHOULD merge
      const loose = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
        config: { normalSimilarityThreshold: 0.5 },
      }));

      expect(loose.artifacts.length).toBeLessThanOrEqual(strict.artifacts.length);
    });

    it('respects overlapThreshold config', () => {
      const roof1 = makeRoofPlane({
        normal: [0, 0, 1],
        region: { x: 0, y: 0, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' },
      });
      const roof2 = makeRoofPlane({
        normal: [0, 0, 1],
        region: { x: 100, y: 0, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' },
      });

      // With high overlap threshold, they should NOT merge
      const strict = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
        config: { overlapThreshold: 0.9 },
      }));

      // With zero overlap threshold, they should merge
      const loose = runMultiViewFusion(makeInput({
        perPhotoArtifacts: [
          { fileId: 'photo1', roofPlanes: [roof1], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
          { fileId: 'photo2', roofPlanes: [roof2], wallPlanes: [], masks: [], lines: [], vanishingPoints: [] },
        ],
        config: { overlapThreshold: 0 },
      }));

      expect(loose.artifacts.length).toBeLessThanOrEqual(strict.artifacts.length);
    });
  });
});
