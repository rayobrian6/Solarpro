/**
 * Tests for the candidate suppression pipeline.
 *
 * Covers:
 * - NMS (Non-Maximum Suppression)
 * - Confidence gating per class
 * - Geometry score gating per class
 * - Top-K per class per file
 * - Global cap per file
 * - Full pipeline integration
 * - ground_noise always suppressed
 * - Unknown class defaults
 * - Multi-file isolation
 */

import {
  suppressCandidates,
  DEFAULT_SUPPRESSION_CONFIG,
  type SuppressibleCandidate,
  type SuppressionConfig,
  type SuppressionResult,
} from '@/lib/assistedEvidenceSources/candidateSuppression';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const REGION_A = { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_B = { x: 500, y: 500, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_OVERLAP_A = { x: 120, y: 120, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_FAR = { x: 800, y: 800, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const };

function makeCandidate(overrides: Partial<SuppressibleCandidate> & { id: string }): SuppressibleCandidate {
  return {
    fileId: 'file-1',
    geometryClass: 'probable_roof_plane',
    geometryScore: 0.5,
    confidence: 50,
    region: REGION_A,
    ...overrides,
  };
}

/* ── NMS ──────────────────────────────────────────────────────────────────── */

describe('NMS (Non-Maximum Suppression)', () => {
  it('suppresses lower-scored overlapping candidates of the same class', () => {
    const candidates = [
      makeCandidate({ id: 'high', geometryScore: 0.8, region: REGION_A }),
      makeCandidate({ id: 'low', geometryScore: 0.3, region: REGION_OVERLAP_A }),
    ];
    const result = suppressCandidates(candidates, { nmsIouThreshold: 0.3 });
    const trusted = result.trusted.map((c) => c.id);
    const suppressed = result.suppressed.map((c) => c.id);
    expect(trusted).toContain('high');
    expect(suppressed).toContain('low');
  });

  it('keeps non-overlapping candidates even if same class', () => {
    const candidates = [
      makeCandidate({ id: 'a', geometryScore: 0.8, region: REGION_A }),
      makeCandidate({ id: 'b', geometryScore: 0.3, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates, { nmsIouThreshold: 0.45 });
    expect(result.trustedCount).toBe(2);
  });

  it('does not apply NMS across different geometry classes', () => {
    const candidates = [
      makeCandidate({ id: 'roof', geometryClass: 'probable_roof_plane', geometryScore: 0.8, region: REGION_A }),
      makeCandidate({ id: 'obstruct', geometryClass: 'probable_obstruction', geometryScore: 0.3, region: REGION_OVERLAP_A }),
    ];
    const result = suppressCandidates(candidates, { nmsIouThreshold: 0.3 });
    expect(result.trustedCount).toBe(2);
  });

  it('does not apply NMS across different files', () => {
    const candidates = [
      makeCandidate({ id: 'a', fileId: 'file-1', geometryScore: 0.8, region: REGION_A }),
      makeCandidate({ id: 'b', fileId: 'file-2', geometryScore: 0.3, region: REGION_A }),
    ];
    const result = suppressCandidates(candidates, { nmsIouThreshold: 0.3 });
    expect(result.trustedCount).toBe(2);
  });
});

/* ── Confidence gating ────────────────────────────────────────────────────── */

describe('Confidence gating', () => {
  it('suppresses candidates below per-class confidence threshold', () => {
    const candidates = [
      makeCandidate({ id: 'good', geometryClass: 'probable_roof_plane', confidence: 50 }),
      makeCandidate({ id: 'bad', geometryClass: 'probable_roof_plane', confidence: 10, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates, {
      confidenceThresholds: { probable_roof_plane: 25 },
    });
    const trusted = result.trusted.map((c) => c.id);
    const suppressed = result.suppressed.map((c) => c.id);
    expect(trusted).toContain('good');
    expect(suppressed).toContain('bad');
  });

  it('uses default threshold for unknown classes', () => {
    const candidates = [
      makeCandidate({ id: 'ok', geometryClass: 'unknown', confidence: 50, region: REGION_A }),
      makeCandidate({ id: 'low', geometryClass: 'unknown', confidence: 10, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates);
    const suppressed = result.suppressed.map((c) => c.id);
    expect(suppressed).toContain('low');
  });

  it('suppresses ground_noise regardless of confidence (threshold=100)', () => {
    const candidates = [
      makeCandidate({ id: 'noise', geometryClass: 'probable_ground_noise', confidence: 99, region: REGION_A }),
    ];
    const result = suppressCandidates(candidates);
    expect(result.trustedCount).toBe(0);
    expect(result.suppressedCount).toBe(1);
  });
});

/* ── Geometry score gating ────────────────────────────────────────────────── */

describe('Geometry score gating', () => {
  it('suppresses candidates below per-class geometry score threshold', () => {
    const candidates = [
      makeCandidate({ id: 'good', geometryClass: 'probable_roof_plane', geometryScore: 0.5 }),
      makeCandidate({ id: 'bad', geometryClass: 'probable_roof_plane', geometryScore: 0.05, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates, {
      geometryScoreThresholds: { probable_roof_plane: 0.15 },
    });
    const trusted = result.trusted.map((c) => c.id);
    const suppressed = result.suppressed.map((c) => c.id);
    expect(trusted).toContain('good');
    expect(suppressed).toContain('bad');
  });

  it('suppresses ground_noise regardless of geometry score (threshold=1.0)', () => {
    const candidates = [
      makeCandidate({ id: 'noise', geometryClass: 'probable_ground_noise', geometryScore: 0.99, region: REGION_A }),
    ];
    const result = suppressCandidates(candidates);
    expect(result.suppressedCount).toBe(1);
  });
});

/* ── Top-K per class ──────────────────────────────────────────────────────── */

describe('Top-K per class', () => {
  it('keeps only top-K candidates per (fileId, geometryClass)', () => {
    const candidates: SuppressibleCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      candidates.push(
        makeCandidate({
          id: `roof-${i}`,
          geometryClass: 'probable_roof_plane',
          geometryScore: 0.9 - i * 0.05,
          region: { x: i * 80, y: 100, width: 60, height: 60, coordinateSystem: 'normalized_image_0_1000' },
        }),
      );
    }
    const result = suppressCandidates(candidates, {
      topKPerClass: { probable_roof_plane: 4 },
    });
    expect(result.trustedCount).toBe(4);
    expect(result.suppressedCount).toBe(6);
  });

  it('keeps all candidates when below the top-K limit', () => {
    const candidates = [
      makeCandidate({ id: 'a', geometryScore: 0.5 }),
      makeCandidate({ id: 'b', geometryScore: 0.4, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates, {
      topKPerClass: { probable_roof_plane: 4 },
    });
    expect(result.trustedCount).toBe(2);
  });

  it('applies top-K independently per geometry class', () => {
    const candidates = [
      makeCandidate({ id: 'roof-1', geometryClass: 'probable_roof_plane', geometryScore: 0.9, region: REGION_A }),
      makeCandidate({ id: 'roof-2', geometryClass: 'probable_roof_plane', geometryScore: 0.8, region: REGION_B }),
      makeCandidate({ id: 'obstruct-1', geometryClass: 'probable_obstruction', geometryScore: 0.7, region: REGION_FAR }),
      makeCandidate({ id: 'obstruct-2', geometryClass: 'probable_obstruction', geometryScore: 0.6, region: { x: 600, y: 600, width: 50, height: 50, coordinateSystem: 'normalized_image_0_1000' } }),
    ];
    const result = suppressCandidates(candidates, {
      topKPerClass: { probable_roof_plane: 1, probable_obstruction: 1 },
    });
    expect(result.trustedCount).toBe(2);
    expect(result.suppressedCount).toBe(2);
  });
});

/* ── Global cap ───────────────────────────────────────────────────────────── */

describe('Global cap', () => {
  it('enforces maximum total candidates per file', () => {
    // Create 20 obstruction candidates (topK=8), so after top-K we have 8 trusted.
    // With maxTotalPerFile=6, global cap should further reduce to 6.
    const candidates: SuppressibleCandidate[] = [];
    for (let i = 0; i < 20; i++) {
      candidates.push(
        makeCandidate({
          id: `c-${i}`,
          geometryClass: 'probable_obstruction',
          geometryScore: 0.9 - i * 0.02,
          region: { x: (i % 5) * 180, y: Math.floor(i / 5) * 200, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' },
        }),
      );
    }
    const result = suppressCandidates(candidates, { maxTotalPerFile: 6 });
    expect(result.trustedCount).toBe(6);
    expect(result.suppressedCount).toBe(14);
  });

  it('keeps highest geometry-scored candidates when applying global cap', () => {
    const candidates = [
      makeCandidate({ id: 'high', geometryScore: 0.9 }),
      makeCandidate({ id: 'mid', geometryScore: 0.5, region: REGION_B }),
      makeCandidate({ id: 'low', geometryScore: 0.1, region: REGION_FAR }),
    ];
    const result = suppressCandidates(candidates, { maxTotalPerFile: 2 });
    const trusted = result.trusted.map((c) => c.id);
    expect(trusted).toContain('high');
    expect(trusted).toContain('mid');
    expect(result.suppressed.map((c) => c.id)).toContain('low');
  });

  it('applies global cap independently per file', () => {
    const candidates = [
      makeCandidate({ id: 'f1-a', fileId: 'file-1', geometryScore: 0.9 }),
      makeCandidate({ id: 'f1-b', fileId: 'file-1', geometryScore: 0.8, region: REGION_B }),
      makeCandidate({ id: 'f2-a', fileId: 'file-2', geometryScore: 0.9 }),
      makeCandidate({ id: 'f2-b', fileId: 'file-2', geometryScore: 0.8, region: REGION_B }),
    ];
    const result = suppressCandidates(candidates, { maxTotalPerFile: 1 });
    expect(result.trustedCount).toBe(2); // 1 per file
    expect(result.perFileCounts['file-1'].trusted).toBe(1);
    expect(result.perFileCounts['file-2'].trusted).toBe(1);
  });
});

/* ── Full pipeline integration ────────────────────────────────────────────── */

describe('Full suppression pipeline integration', () => {
  it('processes a realistic mixed candidate set', () => {
    const candidates: SuppressibleCandidate[] = [
      // 4 roof planes
      makeCandidate({ id: 'roof-1', geometryClass: 'probable_roof_plane', geometryScore: 0.8, confidence: 55, region: { x: 0, y: 0, width: 400, height: 300, coordinateSystem: 'normalized_image_0_1000' } }),
      makeCandidate({ id: 'roof-2', geometryClass: 'probable_roof_plane', geometryScore: 0.7, confidence: 50, region: { x: 500, y: 0, width: 400, height: 300, coordinateSystem: 'normalized_image_0_1000' } }),
      makeCandidate({ id: 'roof-3', geometryClass: 'probable_roof_plane', geometryScore: 0.6, confidence: 45, region: { x: 0, y: 400, width: 400, height: 300, coordinateSystem: 'normalized_image_0_1000' } }),
      makeCandidate({ id: 'roof-4', geometryClass: 'probable_roof_plane', geometryScore: 0.5, confidence: 40, region: { x: 500, y: 400, width: 400, height: 300, coordinateSystem: 'normalized_image_0_1000' } }),
      // 10 obstructions (should be capped at 8)
      ...Array.from({ length: 10 }, (_, i) =>
        makeCandidate({
          id: `obstruct-${i}`,
          geometryClass: 'probable_obstruction',
          geometryScore: 0.6 - i * 0.04,
          confidence: 40 - i * 2,
          region: { x: 100 + i * 80, y: 100, width: 50, height: 50, coordinateSystem: 'normalized_image_0_1000' },
        })
      ),
      // 3 equipment
      makeCandidate({ id: 'equip-1', geometryClass: 'probable_equipment', geometryScore: 0.7, confidence: 45, region: { x: 200, y: 150, width: 120, height: 80, coordinateSystem: 'normalized_image_0_1000' } }),
      makeCandidate({ id: 'equip-2', geometryClass: 'probable_equipment', geometryScore: 0.5, confidence: 35, region: { x: 600, y: 200, width: 100, height: 80, coordinateSystem: 'normalized_image_0_1000' } }),
      makeCandidate({ id: 'equip-3', geometryClass: 'probable_equipment', geometryScore: 0.3, confidence: 25, region: { x: 400, y: 300, width: 80, height: 60, coordinateSystem: 'normalized_image_0_1000' } }),
      // 2 ground noise (should always be suppressed)
      makeCandidate({ id: 'noise-1', geometryClass: 'probable_ground_noise', geometryScore: 0.4, confidence: 30, region: REGION_FAR }),
      makeCandidate({ id: 'noise-2', geometryClass: 'probable_ground_noise', geometryScore: 0.2, confidence: 20, region: { x: 850, y: 850, width: 80, height: 80, coordinateSystem: 'normalized_image_0_1000' } }),
    ];

    const result = suppressCandidates(candidates);

    // Ground noise should always be suppressed
    expect(result.suppressed.some((c) => c.id === 'noise-1')).toBe(true);
    expect(result.suppressed.some((c) => c.id === 'noise-2')).toBe(true);

    // Obstructions should be capped at 8
    const trustedObstructions = result.trusted.filter((c) => c.geometryClass === 'probable_obstruction');
    expect(trustedObstructions.length).toBeLessThanOrEqual(8);

    // Roof should be capped at 4
    const trustedRoof = result.trusted.filter((c) => c.geometryClass === 'probable_roof_plane');
    expect(trustedRoof.length).toBeLessThanOrEqual(4);

    // Equipment should be capped at 4
    const trustedEquip = result.trusted.filter((c) => c.geometryClass === 'probable_equipment');
    expect(trustedEquip.length).toBeLessThanOrEqual(4);

    // Total trusted should be ≤ 16
    expect(result.trustedCount).toBeLessThanOrEqual(16);

    // hasSuppressedCandidates should be true
    expect(result.hasSuppressedCandidates).toBe(true);

    // inputCount should match
    expect(result.inputCount).toBe(candidates.length);
  });

  it('returns hasSuppressedCandidates=false when nothing is suppressed', () => {
    const candidates = [
      makeCandidate({ id: 'a', geometryScore: 0.8, confidence: 60 }),
    ];
    const result = suppressCandidates(candidates);
    expect(result.hasSuppressedCandidates).toBe(false);
    expect(result.trustedCount).toBe(1);
    expect(result.suppressedCount).toBe(0);
  });

  it('preserves input candidates (no mutation)', () => {
    const candidates = [
      makeCandidate({ id: 'a', geometryScore: 0.8, confidence: 60 }),
      makeCandidate({ id: 'b', geometryScore: 0.1, confidence: 5, region: REGION_B }),
    ];
    const originalA = { ...candidates[0] };
    const originalB = { ...candidates[1] };

    suppressCandidates(candidates);

    expect(candidates[0].id).toBe(originalA.id);
    expect(candidates[1].id).toBe(originalB.id);
    expect(candidates[0].confidence).toBe(originalA.confidence);
  });

  it('each suppressed entry has a human-readable reason', () => {
    const candidates = [
      makeCandidate({ id: 'low-conf', confidence: 5, geometryClass: 'probable_roof_plane' }),
    ];
    const result = suppressCandidates(candidates);
    expect(result.suppressedCount).toBeGreaterThan(0);
    for (const entry of result.entries) {
      if (entry.disposition === 'suppressed') {
        expect(entry.suppressionReason.length).toBeGreaterThan(0);
      }
    }
  });
});

/* ── Default config ───────────────────────────────────────────────────────── */

describe('DEFAULT_SUPPRESSION_CONFIG', () => {
  it('has ground_noise confidence threshold of 100 (always suppressed)', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.confidenceThresholds.probable_ground_noise).toBe(100);
  });

  it('has ground_noise geometry score threshold of 1.0 (always suppressed)', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.geometryScoreThresholds.probable_ground_noise).toBe(1.0);
  });

  it('has ground_noise topK of 0', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.topKPerClass.probable_ground_noise).toBe(0);
  });

  it('has maxTotalPerFile of 16', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.maxTotalPerFile).toBe(16);
  });

  it('has obstruction topK of 8', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.topKPerClass.probable_obstruction).toBe(8);
  });

  it('has roof topK of 4', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.topKPerClass.probable_roof_plane).toBe(4);
  });

  it('has equipment topK of 4', () => {
    expect(DEFAULT_SUPPRESSION_CONFIG.topKPerClass.probable_equipment).toBe(4);
  });
});
