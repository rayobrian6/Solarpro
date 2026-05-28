/**
 * Tests for the geometry refinement pipeline.
 *
 * Covers:
 * - IoU merge behavior
 * - Tiny/giant/no-geometry filtering
 * - Roof/wall/equipment/text classification
 * - Raw candidate count remains unchanged
 * - Refined preview never triggers CAD/permit/BOM mutation
 */

import {
  refineGeometry,
  computeIoU,
  normalizedArea,
  aspectRatio,
  computeInBoundsFraction,
  unionBoundingBox,
  DEFAULT_REFINEMENT_CONFIG,
  type RawRefinementInput,
  type RefinedGeometryClass,
  type RefinedCandidate,
} from '@/lib/assistedEvidenceSources/geometryRefinement';

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const REGION_100_200_300_400 = { x: 100, y: 200, width: 300, height: 400, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_0_0_1000_1000 = { x: 0, y: 0, width: 1000, height: 1000, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_50_50_20_20 = { x: 50, y: 50, width: 20, height: 20, coordinateSystem: 'normalized_image_0_1000' as const };
const REGION_100_100_200_200 = { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };

function makeRaw(overrides: Partial<RawRefinementInput> & { id: string }): RawRefinementInput {
  return {
    fileId: 'file-1',
    candidateType: 'rectangular_region_candidate',
    candidateCategory: 'field_context',
    payload: { region: REGION_100_200_300_400, source: 'dense_edge_component' },
    confidence: 50,
    ...overrides,
  };
}

/* ── computeIoU ────────────────────────────────────────────────────────── */

describe('computeIoU', () => {
  it('returns 0 for non-overlapping regions', () => {
    const a: typeof REGION_100_200_300_400 = { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' };
    const b: typeof REGION_100_200_300_400 = { x: 200, y: 200, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' };
    expect(computeIoU(a, b)).toBe(0);
  });

  it('returns 1 for identical regions', () => {
    expect(computeIoU(REGION_100_200_300_400, REGION_100_200_300_400)).toBe(1);
  });

  it('computes partial overlap correctly', () => {
    // A: (100,200) 300x400 → (100-400, 200-600)
    // B: (250,350) 300x400 → (250-550, 350-750)
    // Intersection: (250-400, 350-600) = 150x250 = 37500
    // Union: 120000 + 120000 - 37500 = 202500
    const b = { x: 250, y: 350, width: 300, height: 400, coordinateSystem: 'normalized_image_0_1000' as const };
    const iou = computeIoU(REGION_100_200_300_400, b);
    expect(iou).toBeCloseTo(37500 / 202500, 6);
  });

  it('returns 0 for touching edges (no area overlap)', () => {
    const a: typeof REGION_100_200_300_400 = { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' };
    const b: typeof REGION_100_200_300_400 = { x: 100, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' };
    expect(computeIoU(a, b)).toBe(0);
  });
});

/* ── normalizedArea ────────────────────────────────────────────────────── */

describe('normalizedArea', () => {
  it('computes area of a 300x400 region as 0.12', () => {
    expect(normalizedArea(REGION_100_200_300_400)).toBe(0.12);
  });

  it('full image is 1.0', () => {
    expect(normalizedArea(REGION_0_0_1000_1000)).toBe(1.0);
  });

  it('tiny 20x20 region is 0.0004', () => {
    expect(normalizedArea(REGION_50_50_20_20)).toBe(0.0004);
  });
});

/* ── aspectRatio ───────────────────────────────────────────────────────── */

describe('aspectRatio', () => {
  it('returns 1 for a square', () => {
    expect(aspectRatio(REGION_100_100_200_200)).toBe(1);
  });

  it('returns width/height for a wide rectangle', () => {
    const region = { x: 0, y: 0, width: 400, height: 100, coordinateSystem: 'normalized_image_0_1000' as const };
    expect(aspectRatio(region)).toBe(4);
  });

  it('returns height/width for a tall rectangle (always >= 1)', () => {
    const region = { x: 0, y: 0, width: 100, height: 400, coordinateSystem: 'normalized_image_0_1000' as const };
    expect(aspectRatio(region)).toBe(4);
  });
});

/* ── computeInBoundsFraction ───────────────────────────────────────────── */

describe('computeInBoundsFraction', () => {
  it('returns 1 for a fully in-bounds region', () => {
    expect(computeInBoundsFraction(REGION_100_200_300_400)).toBe(1);
  });

  it('returns 0 for a completely out-of-bounds region', () => {
    const region = { x: -200, y: -200, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const };
    expect(computeInBoundsFraction(region)).toBe(0);
  });

  it('computes partial out-of-bounds correctly', () => {
    // Half the region extends past x=1000
    const region = { x: 900, y: 0, width: 200, height: 100, coordinateSystem: 'normalized_image_0_1000' as const };
    // Visible: (900-1000, 0-100) = 100x100 = 10000
    // Total: 200x100 = 20000
    expect(computeInBoundsFraction(region)).toBe(0.5);
  });
});

/* ── unionBoundingBox ──────────────────────────────────────────────────── */

describe('unionBoundingBox', () => {
  it('returns the region for a single input', () => {
    const result = unionBoundingBox([REGION_100_200_300_400]);
    expect(result).toEqual(REGION_100_200_300_400);
  });

  it('computes the union of two regions', () => {
    const a = { x: 100, y: 100, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
    const b = { x: 200, y: 200, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
    const result = unionBoundingBox([a, b]);
    expect(result).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 300,
      coordinateSystem: 'normalized_image_0_1000',
    });
  });
});

/* ── IoU merge behavior ────────────────────────────────────────────────── */

describe('IoU merge behavior', () => {
  it('merges two overlapping candidates into one', () => {
    const a = makeRaw({ id: 'a', payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' } });
    const b = makeRaw({ id: 'b', payload: { region: { x: 150, y: 150, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge_component' } });
    const result = refineGeometry([a, b], { iouThreshold: 0.1 });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].sourceIds).toContain('a');
    expect(result.candidates[0].sourceIds).toContain('b');
    expect(result.candidates[0].refinementNotes).toContain('merged-2-candidates');
  });

  it('does not merge candidates with IoU below threshold', () => {
    const a = makeRaw({ id: 'a', payload: { region: { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const b = makeRaw({ id: 'b', payload: { region: { x: 500, y: 500, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const result = refineGeometry([a, b], { iouThreshold: 0.35 });
    expect(result.candidates.length).toBe(2);
  });

  it('when mergeOverlaps=false, keeps highest-confidence candidate', () => {
    const a = makeRaw({ id: 'a', confidence: 30, payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' } });
    const b = makeRaw({ id: 'b', confidence: 60, payload: { region: { x: 150, y: 150, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge_component' } });
    const result = refineGeometry([a, b], { iouThreshold: 0.1, mergeOverlaps: false });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].confidence).toBe(60);
    expect(result.candidates[0].sourceIds).toEqual(['b']);
  });

  it('merges across multiple overlapping candidates (chain)', () => {
    const a = makeRaw({ id: 'a', confidence: 50, payload: { region: { x: 0, y: 0, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const b = makeRaw({ id: 'b', confidence: 40, payload: { region: { x: 100, y: 0, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const c = makeRaw({ id: 'c', confidence: 30, payload: { region: { x: 200, y: 0, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    // a and b overlap, b and c overlap, but a and c may not overlap directly
    const result = refineGeometry([a, b, c], { iouThreshold: 0.1 });
    // a and b merge, then the merged box overlaps with c, so all merge
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].sourceIds).toContain('a');
    expect(result.candidates[0].sourceIds).toContain('b');
  });

  it('deduplicates only within the same fileId', () => {
    const region = REGION_100_100_200_200;
    const a = makeRaw({ id: 'a', fileId: 'file-1', payload: { region, source: 'dense_edge_component' } });
    const b = makeRaw({ id: 'b', fileId: 'file-2', payload: { region, source: 'dense_edge_component' } });
    const result = refineGeometry([a, b], { iouThreshold: 0.35 });
    expect(result.candidates.length).toBe(2);
  });

  it('merged region uses the union bounding box', () => {
    const a = makeRaw({ id: 'a', payload: { region: { x: 100, y: 100, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const b = makeRaw({ id: 'b', payload: { region: { x: 150, y: 150, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } });
    const result = refineGeometry([a, b], { iouThreshold: 0.1 });
    expect(result.candidates.length).toBe(1);
    const r = result.candidates[0].region;
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    expect(r.width).toBe(150);
    expect(r.height).toBe(150);
  });
});

/* ── Tiny/giant/no-geometry filtering ──────────────────────────────────── */

describe('Tiny/giant/no-geometry filtering', () => {
  it('filters out candidates with no drawable geometry', () => {
    const raw = makeRaw({ id: 'no-geo', payload: { edgePixelCount: 12345, source: 'dense_edge_component' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(0);
  });

  it('filters out tiny boxes below minArea threshold', () => {
    // 20x20 = 0.0004 which is below default minArea of 0.0005
    const raw = makeRaw({ id: 'tiny', payload: { region: REGION_50_50_20_20, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(0);
  });

  it('keeps tiny boxes above minArea threshold', () => {
    // 30x30 = 0.0009 which is above default minArea of 0.0005
    const region = { x: 50, y: 50, width: 30, height: 30, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'small-ok', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(1);
  });

  it('filters out giant boxes that cover excessive area', () => {
    // 950x950 = 0.9025 which is above default maxArea of 0.85
    const region = { x: 25, y: 25, width: 950, height: 950, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'giant', candidateType: 'obstruction_candidate', candidateCategory: 'field_context', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(0);
  });

  it('keeps giant boxes when classified as probable plane (roof_edge_candidate)', () => {
    const region = { x: 25, y: 25, width: 950, height: 950, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'giant-plane', candidateType: 'roof_edge_candidate', candidateCategory: 'roof_context', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].refinementNotes).toContain('large-area-plane-exception');
  });

  it('keeps giant boxes when classified as probable plane (rectangular_region_candidate with roof_context)', () => {
    const region = { x: 25, y: 25, width: 950, height: 950, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'giant-roof', candidateType: 'rectangular_region_candidate', candidateCategory: 'roof_context', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(1);
  });

  it('filters out boxes mostly outside visible image bounds', () => {
    // Box from x=-300 to x=100, y=0 to y=200 → only 100/400 = 25% visible, below default 30%
    const region = { x: -300, y: 0, width: 400, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'out-of-bounds', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(0);
  });

  it('keeps boxes with enough visible area within bounds', () => {
    // Box from x=-50 to x=200, y=0 to y=200 → 200/250 = 80% visible
    const region = { x: -50, y: 0, width: 250, height: 200, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'partially-visible', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates.length).toBe(1);
  });

  it('custom minArea threshold is respected', () => {
    // 30x30 = 0.0009, above default but below custom threshold of 0.002
    const region = { x: 50, y: 50, width: 30, height: 30, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({ id: 'custom-tiny', payload: { region, source: 'dense_edge' } });
    const result = refineGeometry([raw], { minArea: 0.002 });
    expect(result.candidates.length).toBe(0);
  });
});

/* ── Roof/wall/equipment/text classification ───────────────────────────── */

describe('Geometry classification', () => {
  it('classifies ocr_text as probable_text_label', () => {
    const raw = makeRaw({
      id: 'ocr-1',
      candidateType: 'ocr_text',
      candidateCategory: 'field_context',
      payload: { region: REGION_100_100_200_200, source: 'tesseract' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_text_label');
  });

  it('classifies roof_edge_candidate as probable_roof_plane', () => {
    const raw = makeRaw({
      id: 'roof-1',
      candidateType: 'roof_edge_candidate',
      candidateCategory: 'roof_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies wall_anchor_candidate as probable_wall_plane', () => {
    const raw = makeRaw({
      id: 'wall-1',
      candidateType: 'wall_anchor_candidate',
      candidateCategory: 'structure_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_wall_plane');
  });

  it('classifies equipment_anchor_candidate as probable_equipment', () => {
    const raw = makeRaw({
      id: 'equip-1',
      candidateType: 'equipment_anchor_candidate',
      candidateCategory: 'electrical_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_equipment');
  });

  it('classifies obstruction_candidate as probable_obstruction', () => {
    const raw = makeRaw({
      id: 'obstruct-1',
      candidateType: 'obstruction_candidate',
      candidateCategory: 'field_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_obstruction');
  });

  it('classifies object_detection with solar label as probable_equipment', () => {
    const raw = makeRaw({
      id: 'yolo-solar',
      candidateType: 'object_detection',
      candidateCategory: 'field_context',
      payload: { region: REGION_100_100_200_200, label: 'solar_panel', stage: 'yolo' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_equipment');
  });

  it('classifies object_detection with roof label as probable_roof_plane', () => {
    const raw = makeRaw({
      id: 'yolo-roof',
      candidateType: 'object_detection',
      candidateCategory: 'field_context',
      payload: { region: REGION_100_100_200_200, label: 'roof', stage: 'yolo' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies electrical_context as probable_equipment', () => {
    const raw = makeRaw({
      id: 'elec-1',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'electrical_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_equipment');
  });

  it('classifies structure_context as probable_wall_plane', () => {
    const raw = makeRaw({
      id: 'struct-1',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'structure_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_wall_plane');
  });

  it('classifies roof_context as probable_roof_plane', () => {
    const raw = makeRaw({
      id: 'roof-ctx-1',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'roof_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies by geometry heuristics for ambiguous rectangular_region_candidate', () => {
    // Large area in upper half → likely roof
    const region = { x: 0, y: 0, width: 500, height: 400, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-roof',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies small box in upper portion as probable_equipment', () => {
    // Small area in upper portion with moderate aspect ratio
    const region = { x: 200, y: 100, width: 100, height: 80, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-equip',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_equipment');
  });

  it('classifies tall narrow box as probable_wall_plane', () => {
    // Tall narrow box (aspect < 0.5 → height >> width)
    const region = { x: 300, y: 100, width: 60, height: 400, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-wall',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_wall_plane');
  });

  it('classifies wide short box in upper portion as probable_roof_plane', () => {
    const region = { x: 0, y: 50, width: 600, height: 100, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-roof-wide',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies small box anywhere as probable_obstruction', () => {
    // Area < 0.01
    const region = { x: 400, y: 300, width: 60, height: 60, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-obstruct',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_obstruction');
  });

  it('classifies very small area at bottom as probable_ground_noise', () => {
    const region = { x: 400, y: 800, width: 80, height: 60, coordinateSystem: 'normalized_image_0_1000' as const };
    const raw = makeRaw({
      id: 'geo-ground',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region, source: 'dense_edge_component' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_ground_noise');
  });

  it('uses filename hint for classification when available', () => {
    const raw = makeRaw({
      id: 'hint-roof',
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge_component', filenameLabelHintUsedForCategoryOnly: 'roof_north' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });

  it('classifies dominant_line_candidate as probable_roof_plane', () => {
    const raw = makeRaw({
      id: 'line-1',
      candidateType: 'dominant_line_candidate',
      candidateCategory: 'roof_context',
      payload: { region: REGION_100_100_200_200, source: 'dense_edge' },
    });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].geometryClass).toBe('probable_roof_plane');
  });
});

/* ── Raw candidate count remains unchanged ─────────────────────────────── */

describe('Raw candidates remain unchanged', () => {
  it('refinement does not mutate raw candidate array', () => {
    const raw = [
      makeRaw({ id: 'a', payload: { region: REGION_100_100_200_200, source: 'dense_edge_component' } }),
      makeRaw({ id: 'b', payload: { region: { x: 150, y: 150, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge_component' } }),
    ];
    const originalLength = raw.length;
    const originalA = { ...raw[0] };
    const originalB = { ...raw[1] };

    refineGeometry(raw);

    // Raw array unchanged
    expect(raw.length).toBe(originalLength);
    expect(raw[0].id).toBe(originalA.id);
    expect(raw[1].id).toBe(originalB.id);
    expect(raw[0].payload).toBe(originalA.payload);
    expect(raw[1].payload).toBe(originalB.payload);
  });

  it('bundle reports rawCandidateCount correctly', () => {
    const raw = [
      makeRaw({ id: 'a', payload: { region: REGION_100_100_200_200, source: 'dense_edge' } }),
      makeRaw({ id: 'b', payload: { region: { x: 500, y: 500, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } }),
      makeRaw({ id: 'no-geo', payload: { edgePixelCount: 12345 } }),
    ];
    const result = refineGeometry(raw);
    // 3 raw candidates fed in
    expect(result.rawCandidateCount).toBe(3);
    // Only 2 have drawable geometry and pass filtering
    expect(result.refinedCandidateCount).toBe(2);
  });
});

/* ── Refined preview never triggers CAD/permit/BOM mutation ────────────── */

describe('Refined preview never triggers CAD/permit/BOM mutation', () => {
  it('every refined candidate has review-only authority', () => {
    const raw = [
      makeRaw({ id: 'a', candidateType: 'roof_edge_candidate', candidateCategory: 'roof_context', payload: { region: REGION_100_100_200_200, source: 'dense_edge' } }),
      makeRaw({ id: 'b', candidateType: 'equipment_anchor_candidate', candidateCategory: 'electrical_context', payload: { region: { x: 500, y: 100, width: 100, height: 80, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } }),
      makeRaw({ id: 'c', candidateType: 'ocr_text', candidateCategory: 'field_context', payload: { region: { x: 200, y: 300, width: 150, height: 50, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'tesseract' } }),
    ];
    const result = refineGeometry(raw);

    for (const candidate of result.candidates) {
      expect(candidate.authority.reviewOnly).toBe(true);
      expect(candidate.authority.nonAuthoritative).toBe(true);
      expect(candidate.authority.cadMutationAllowed).toBe(false);
      expect(candidate.authority.permitGenerationAllowed).toBe(false);
      expect(candidate.authority.bomMutationAllowed).toBe(false);
    }
  });

  it('bundle authority blocks all mutations', () => {
    const result = refineGeometry([makeRaw({ id: 'a', payload: { region: REGION_100_100_200_200, source: 'dense_edge' } })]);
    expect(result.authority.reviewOnly).toBe(true);
    expect(result.authority.nonAuthoritative).toBe(true);
    expect(result.authority.canonicalMutationAllowed).toBe(false);
    expect(result.authority.cadMutationAllowed).toBe(false);
    expect(result.authority.permitGenerationAllowed).toBe(false);
    expect(result.authority.bomMutationAllowed).toBe(false);
    expect(result.authority.engineeringWorkflowMutationAllowed).toBe(false);
  });

  it('bundle limitations include REVIEW-ONLY disclaimer', () => {
    const result = refineGeometry([makeRaw({ id: 'a', payload: { region: REGION_100_100_200_200, source: 'dense_edge' } })]);
    expect(result.limitations[0]).toContain('REVIEW-ONLY');
    expect(result.limitations[0]).toContain('NON-AUTHORITATIVE');
    expect(result.limitations[0]).toContain('NOT CAD GEOMETRY');
    expect(result.limitations.some((l) => l.includes('CAD'))).toBe(true);
    expect(result.limitations.some((l) => l.includes('permits'))).toBe(true);
    expect(result.limitations.some((l) => l.includes('BOM'))).toBe(true);
  });

  it('refined candidate IDs are distinct from raw IDs (derived, not stored)', () => {
    const raw = makeRaw({ id: 'raw-123', payload: { region: REGION_100_100_200_200, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    expect(result.candidates[0].id).not.toBe('raw-123');
    expect(result.candidates[0].id).toContain('refined-');
    expect(result.candidates[0].sourceIds).toContain('raw-123');
  });

  it('refined geometry score is in valid range 0-1', () => {
    const raw = makeRaw({ id: 'scored', confidence: 80, payload: { region: REGION_100_100_200_200, source: 'dense_edge' } });
    const result = refineGeometry([raw]);
    const score = result.candidates[0].geometryScore;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

/* ── Integration: full pipeline ────────────────────────────────────────── */

describe('Full pipeline integration', () => {
  it('processes a realistic mixed candidate set', () => {
    const raw: RawRefinementInput[] = [
      // Roof plane
      makeRaw({ id: 'roof-1', candidateType: 'roof_edge_candidate', candidateCategory: 'roof_context', confidence: 55, payload: { region: { x: 0, y: 0, width: 600, height: 400, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } }),
      // Equipment
      makeRaw({ id: 'equip-1', candidateType: 'equipment_anchor_candidate', candidateCategory: 'electrical_context', confidence: 45, payload: { region: { x: 200, y: 150, width: 120, height: 80, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge_component' } }),
      // OCR text
      makeRaw({ id: 'ocr-1', candidateType: 'ocr_text', candidateCategory: 'field_context', confidence: 72, payload: { region: { x: 300, y: 200, width: 150, height: 40, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'tesseract' } }),
      // Edge map (no geometry)
      makeRaw({ id: 'edge-1', candidateType: 'edge_map_summary', candidateCategory: 'field_context', confidence: 30, payload: { edgePixelCount: 12345 } }),
      // Tiny box
      makeRaw({ id: 'tiny-1', candidateType: 'rectangular_region_candidate', candidateCategory: 'field_context', confidence: 20, payload: { region: { x: 50, y: 50, width: 10, height: 10, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } }),
      // Obstruction
      makeRaw({ id: 'obstruct-1', candidateType: 'obstruction_candidate', candidateCategory: 'field_context', confidence: 38, payload: { region: { x: 400, y: 200, width: 60, height: 60, coordinateSystem: 'normalized_image_0_1000' as const }, source: 'dense_edge' } }),
    ];

    const result = refineGeometry(raw);

    // Raw count preserved
    expect(result.rawCandidateCount).toBe(6);

    // 4 candidates survived (no-geometry and tiny filtered out)
    expect(result.refinedCandidateCount).toBe(4);

    // Classification
    const classes = result.candidates.map((c) => c.geometryClass);
    expect(classes).toContain('probable_roof_plane');
    expect(classes).toContain('probable_equipment');
    expect(classes).toContain('probable_text_label');
    expect(classes).toContain('probable_obstruction');

    // All have valid geometry scores
    for (const c of result.candidates) {
      expect(c.geometryScore).toBeGreaterThan(0);
      expect(c.authority.cadMutationAllowed).toBe(false);
    }
  });
});
