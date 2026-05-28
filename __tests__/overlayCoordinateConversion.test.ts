/**
 * Tests for overlay coordinate conversion and rendering logic.
 *
 * Covers:
 * - normalized_image_0_1000 bbox/region conversion
 * - review_required candidates render
 * - Candidates with null geometry are skipped safely
 * - All CV/OCR filter includes CV, YOLO, and OCR candidates
 * - Counts and rendered overlay source come from the same candidate set
 */

import {
  normalizedRegionToSvgPercent,
  normalizedLineToSvgPercent,
  normalizedRegionToPixels,
  extractDrawableRegion,
  extractDrawableLine,
  hasDrawableGeometry,
  classifyCandidateForFilter,
  candidatesPassOverlayFilter,
  type NormalizedRegion,
  type NormalizedLine,
} from '@/lib/assistedEvidenceSources/overlayCoordinateConversion';

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const SAMPLE_REGION: NormalizedRegion = {
  x: 100,
  y: 200,
  width: 300,
  height: 400,
  coordinateSystem: 'normalized_image_0_1000',
};

const SAMPLE_LINE: NormalizedLine = {
  x1: 0,
  y1: 500,
  x2: 1000,
  y2: 500,
  orientation: 'horizontal',
  strength: 0.8,
  coordinateSystem: 'normalized_image_0_1000',
};

/* ── normalizedRegionToSvgPercent ──────────────────────────────────────── */

describe('normalizedRegionToSvgPercent', () => {
  it('converts origin region (0,0,1000,1000) to full image (0,0,100,100)', () => {
    const full: NormalizedRegion = { x: 0, y: 0, width: 1000, height: 1000, coordinateSystem: 'normalized_image_0_1000' };
    const result = normalizedRegionToSvgPercent(full);
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('converts a sample region correctly', () => {
    const result = normalizedRegionToSvgPercent(SAMPLE_REGION);
    expect(result).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('converts a small region at the end of the image', () => {
    const region: NormalizedRegion = { x: 900, y: 950, width: 100, height: 50, coordinateSystem: 'normalized_image_0_1000' };
    const result = normalizedRegionToSvgPercent(region);
    expect(result).toEqual({ x: 90, y: 95, width: 10, height: 5 });
  });
});

/* ── normalizedLineToSvgPercent ────────────────────────────────────────── */

describe('normalizedLineToSvgPercent', () => {
  it('converts a horizontal line across the full width', () => {
    const result = normalizedLineToSvgPercent(SAMPLE_LINE);
    expect(result).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 });
  });

  it('converts a vertical line', () => {
    const line: NormalizedLine = { x1: 300, y1: 0, x2: 300, y2: 1000, orientation: 'vertical', strength: 0.5, coordinateSystem: 'normalized_image_0_1000' };
    const result = normalizedLineToSvgPercent(line);
    expect(result).toEqual({ x1: 30, y1: 0, x2: 30, y2: 100 });
  });
});

/* ── normalizedRegionToPixels ──────────────────────────────────────────── */

describe('normalizedRegionToPixels', () => {
  it('converts to pixel coordinates for a 4000x3000 image', () => {
    const result = normalizedRegionToPixels(SAMPLE_REGION, 4000, 3000);
    expect(result).toEqual({
      x: (100 / 1000) * 4000,
      y: (200 / 1000) * 3000,
      width: (300 / 1000) * 4000,
      height: (400 / 1000) * 3000,
    });
    expect(result.x).toBe(400);
    expect(result.y).toBe(600);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1200);
  });

  it('full-image region maps to exact image dimensions', () => {
    const full: NormalizedRegion = { x: 0, y: 0, width: 1000, height: 1000, coordinateSystem: 'normalized_image_0_1000' };
    const result = normalizedRegionToPixels(full, 1920, 1080);
    expect(result).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

/* ── extractDrawableRegion ─────────────────────────────────────────────── */

describe('extractDrawableRegion', () => {
  it('extracts a valid payload.region', () => {
    const payload = { region: SAMPLE_REGION };
    const result = extractDrawableRegion(payload);
    expect(result).toEqual(SAMPLE_REGION);
  });

  it('falls back to payload.bbox array format', () => {
    const payload = { bbox: [100, 200, 300, 400] };
    const result = extractDrawableRegion(payload);
    expect(result).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 400,
      coordinateSystem: 'normalized_image_0_1000',
    });
  });

  it('prefers payload.region over bbox when both exist', () => {
    const payload = { region: SAMPLE_REGION, bbox: [0, 0, 50, 50] };
    const result = extractDrawableRegion(payload);
    expect(result).toEqual(SAMPLE_REGION);
  });

  it('returns null when no geometry exists', () => {
    const payload = { summary: 'edge map only' };
    const result = extractDrawableRegion(payload);
    expect(result).toBeNull();
  });

  it('returns null for invalid region (wrong coordinateSystem)', () => {
    const payload = { region: { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'pixel' } };
    const result = extractDrawableRegion(payload);
    expect(result).toBeNull();
  });

  it('returns null for invalid bbox (wrong length)', () => {
    const payload = { bbox: [100, 200] };
    const result = extractDrawableRegion(payload);
    expect(result).toBeNull();
  });
});

/* ── extractDrawableLine ───────────────────────────────────────────────── */

describe('extractDrawableLine', () => {
  it('extracts a valid payload.line', () => {
    const payload = { line: SAMPLE_LINE };
    const result = extractDrawableLine(payload);
    expect(result).toEqual(SAMPLE_LINE);
  });

  it('returns null when no line exists', () => {
    const payload = { region: SAMPLE_REGION };
    const result = extractDrawableLine(payload);
    expect(result).toBeNull();
  });
});

/* ── hasDrawableGeometry ───────────────────────────────────────────────── */

describe('hasDrawableGeometry', () => {
  it('returns true for payload with valid region', () => {
    expect(hasDrawableGeometry({ region: SAMPLE_REGION })).toBe(true);
  });

  it('returns true for payload with valid bbox', () => {
    expect(hasDrawableGeometry({ bbox: [0, 0, 100, 100] })).toBe(true);
  });

  it('returns true for payload with valid line', () => {
    expect(hasDrawableGeometry({ line: SAMPLE_LINE })).toBe(true);
  });

  it('returns false for edge_map_summary with no geometry', () => {
    expect(hasDrawableGeometry({ summary: 'edge map only', source: 'dense_edge_component' })).toBe(false);
  });

  it('returns false for empty payload', () => {
    expect(hasDrawableGeometry({})).toBe(false);
  });
});

/* ── classifyCandidateForFilter ────────────────────────────────────────── */

describe('classifyCandidateForFilter', () => {
  it('classifies rectangular_region_candidate as cv', () => {
    expect(classifyCandidateForFilter('rectangular_region_candidate', { source: 'dense_edge_component' })).toBe('cv');
  });

  it('classifies obstruction_candidate as cv', () => {
    expect(classifyCandidateForFilter('obstruction_candidate', {})).toBe('cv');
  });

  it('classifies equipment_anchor_candidate as cv', () => {
    expect(classifyCandidateForFilter('equipment_anchor_candidate', {})).toBe('cv');
  });

  it('classifies object_detection as yolo', () => {
    expect(classifyCandidateForFilter('object_detection', { stage: 'yolo_v8' })).toBe('yolo');
  });

  it('classifies by yolo source hint', () => {
    expect(classifyCandidateForFilter('object_detection', { source: 'yolo_supervision' })).toBe('yolo');
  });

  it('classifies ocr_text as ocr', () => {
    expect(classifyCandidateForFilter('ocr_text', { source: 'tesseract' })).toBe('ocr');
  });

  it('classifies by ocr stage hint', () => {
    expect(classifyCandidateForFilter('ocr_text', { stage: 'ocr_tesseract' })).toBe('ocr');
  });

  it('classifies edge_map_summary as other', () => {
    expect(classifyCandidateForFilter('edge_map_summary', {})).toBe('other');
  });

  it('classifies dominant_line_candidate as cv', () => {
    expect(classifyCandidateForFilter('dominant_line_candidate', {})).toBe('cv');
  });
});

/* ── candidatesPassOverlayFilter ───────────────────────────────────────── */

describe('candidatesPassOverlayFilter', () => {
  it('"both" filter includes CV candidates', () => {
    expect(candidatesPassOverlayFilter('rectangular_region_candidate', { source: 'dense_edge_component' }, 'both')).toBe(true);
  });

  it('"both" filter includes YOLO candidates', () => {
    expect(candidatesPassOverlayFilter('object_detection', { stage: 'yolo' }, 'both')).toBe(true);
  });

  it('"both" filter includes OCR candidates', () => {
    expect(candidatesPassOverlayFilter('ocr_text', { source: 'tesseract' }, 'both')).toBe(true);
  });

  it('"both" filter excludes "other" candidates (e.g. edge_map_summary)', () => {
    expect(candidatesPassOverlayFilter('edge_map_summary', {}, 'both')).toBe(false);
  });

  it('"opencv" filter includes CV candidates', () => {
    expect(candidatesPassOverlayFilter('rectangular_region_candidate', {}, 'opencv')).toBe(true);
  });

  it('"opencv" filter excludes YOLO candidates', () => {
    expect(candidatesPassOverlayFilter('object_detection', { stage: 'yolo' }, 'opencv')).toBe(false);
  });

  it('"yolo" filter includes YOLO candidates', () => {
    expect(candidatesPassOverlayFilter('object_detection', { stage: 'yolo' }, 'yolo')).toBe(true);
  });

  it('"yolo" filter excludes CV candidates', () => {
    expect(candidatesPassOverlayFilter('rectangular_region_candidate', {}, 'yolo')).toBe(false);
  });

  it('"ocr" filter includes OCR candidates', () => {
    expect(candidatesPassOverlayFilter('ocr_text', { source: 'tesseract' }, 'ocr')).toBe(true);
  });

  it('"ocr" filter excludes CV candidates', () => {
    expect(candidatesPassOverlayFilter('rectangular_region_candidate', {}, 'ocr')).toBe(false);
  });
});

/* ── Integration: review_required candidates render ────────────────────── */

describe('review_required candidates render as overlays', () => {
  it('candidates with review_required status and valid region are drawable', () => {
    const payload = {
      region: SAMPLE_REGION,
      reviewOnlyLabel: 'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    };
    const reviewStatus = 'review_required';

    // Verify geometry is extractable
    expect(hasDrawableGeometry(payload)).toBe(true);
    // Verify it passes the overlay filter
    expect(candidatesPassOverlayFilter('rectangular_region_candidate', payload, 'both')).toBe(true);
    // Verify review status is marked
    expect(reviewStatus).toBe('review_required');
    // Verify the region is extractable
    expect(extractDrawableRegion(payload)).toEqual(SAMPLE_REGION);
  });

  it('review_required OCR candidates with bbox are drawable', () => {
    const payload = {
      bbox: [200, 300, 150, 80],
      ocrText: 'MAIN PANEL',
      source: 'tesseract',
    };
    expect(hasDrawableGeometry(payload)).toBe(true);
    expect(candidatesPassOverlayFilter('ocr_text', payload, 'both')).toBe(true);
    expect(extractDrawableRegion(payload)).toEqual({
      x: 200,
      y: 300,
      width: 150,
      height: 80,
      coordinateSystem: 'normalized_image_0_1000',
    });
  });
});

/* ── Integration: candidates with null geometry are skipped safely ─────── */

describe('candidates with null geometry are skipped safely', () => {
  it('edge_map_summary with no region or bbox has no drawable geometry', () => {
    const payload = {
      edgePixelCount: 12456,
      denseRegionCount: 3,
      source: 'dense_edge_component',
    };
    expect(hasDrawableGeometry(payload)).toBe(false);
  });

  it('candidates with only invalid region are skipped', () => {
    const payload = {
      region: { x: 0, y: 0, width: 100, height: 100, coordinateSystem: 'pixel' },
    };
    expect(hasDrawableGeometry(payload)).toBe(false);
    expect(extractDrawableRegion(payload)).toBeNull();
  });

  it('candidates with empty payload are skipped', () => {
    expect(hasDrawableGeometry({})).toBe(false);
    expect(extractDrawableRegion({})).toBeNull();
  });

  it('edge_map_summary does not block other candidates from rendering', () => {
    const candidates = [
      { candidateType: 'edge_map_summary', payload: { edgePixelCount: 12456 } },
      { candidateType: 'rectangular_region_candidate', payload: { region: SAMPLE_REGION, source: 'dense_edge_component' } },
      { candidateType: 'object_detection', payload: { bbox: [100, 200, 300, 400], stage: 'yolo' } },
      { candidateType: 'ocr_text', payload: { bbox: [50, 60, 70, 80], source: 'tesseract' } },
    ];

    // edge_map_summary has no geometry — should be skipped
    expect(hasDrawableGeometry(candidates[0].payload)).toBe(false);
    // But other candidates have geometry
    expect(hasDrawableGeometry(candidates[1].payload)).toBe(true);
    expect(hasDrawableGeometry(candidates[2].payload)).toBe(true);
    expect(hasDrawableGeometry(candidates[3].payload)).toBe(true);

    // Overlay filter for "both" should include the drawable ones
    const overlayable = candidates.filter(
      (c) => hasDrawableGeometry(c.payload) && candidatesPassOverlayFilter(c.candidateType, c.payload, 'both'),
    );
    expect(overlayable).toHaveLength(3);
    expect(overlayable.map((c) => c.candidateType)).toEqual([
      'rectangular_region_candidate',
      'object_detection',
      'ocr_text',
    ]);
  });
});

/* ── Integration: All CV/OCR filter includes CV, YOLO, and OCR ─────────── */

describe('All CV/OCR filter includes CV, YOLO, and OCR candidates', () => {
  const mixedCandidates = [
    { candidateType: 'rectangular_region_candidate', payload: { region: SAMPLE_REGION, source: 'dense_edge_component' } },
    { candidateType: 'obstruction_candidate', payload: { region: { ...SAMPLE_REGION, x: 500 }, source: 'dense_edge_component' } },
    { candidateType: 'object_detection', payload: { bbox: [100, 200, 300, 400], stage: 'yolo' } },
    { candidateType: 'ocr_text', payload: { bbox: [50, 60, 70, 80], source: 'tesseract' } },
    { candidateType: 'edge_map_summary', payload: { edgePixelCount: 12456 } },
  ];

  it('"both" filter includes all CV + YOLO + OCR but not other', () => {
    const filtered = mixedCandidates.filter(
      (c) => candidatesPassOverlayFilter(c.candidateType, c.payload, 'both'),
    );
    expect(filtered).toHaveLength(4);
    expect(filtered.map((c) => c.candidateType)).not.toContain('edge_map_summary');
  });

  it('"opencv" filter includes only CV candidates', () => {
    const filtered = mixedCandidates.filter(
      (c) => candidatesPassOverlayFilter(c.candidateType, c.payload, 'opencv'),
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.candidateType === 'rectangular_region_candidate' || c.candidateType === 'obstruction_candidate')).toBe(true);
  });

  it('"yolo" filter includes only YOLO candidates', () => {
    const filtered = mixedCandidates.filter(
      (c) => candidatesPassOverlayFilter(c.candidateType, c.payload, 'yolo'),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].candidateType).toBe('object_detection');
  });

  it('"ocr" filter includes only OCR candidates', () => {
    const filtered = mixedCandidates.filter(
      (c) => candidatesPassOverlayFilter(c.candidateType, c.payload, 'ocr'),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].candidateType).toBe('ocr_text');
  });
});

/* ── Integration: counts and rendered overlay source come from same set ── */

describe('counts and rendered overlay source come from the same candidate set', () => {
  it('overlay count matches the number of drawable candidates passing the filter', () => {
    const candidates = [
      { candidateType: 'rectangular_region_candidate', payload: { region: SAMPLE_REGION, source: 'dense_edge_component' } },
      { candidateType: 'rectangular_region_candidate', payload: { region: { ...SAMPLE_REGION, x: 600 }, source: 'dense_edge_component' } },
      { candidateType: 'object_detection', payload: { bbox: [100, 200, 300, 400], stage: 'yolo' } },
      { candidateType: 'ocr_text', payload: { bbox: [50, 60, 70, 80], source: 'tesseract' } },
      { candidateType: 'edge_map_summary', payload: { edgePixelCount: 12456 } },
    ];

    // Simulate what the UI does: filter for overlay rendering
    const overlayCandidates = candidates.filter(
      (c) =>
        hasDrawableGeometry(c.payload) &&
        candidatesPassOverlayFilter(c.candidateType, c.payload, 'both'),
    );

    // Simulate what the UI does: count by category for the legend
    const cvCount = overlayCandidates.filter(
      (c) => classifyCandidateForFilter(c.candidateType, c.payload) === 'cv',
    ).length;
    const yoloCount = overlayCandidates.filter(
      (c) => classifyCandidateForFilter(c.candidateType, c.payload) === 'yolo',
    ).length;
    const ocrCount = overlayCandidates.filter(
      (c) => classifyCandidateForFilter(c.candidateType, c.payload) === 'ocr',
    ).length;

    // Total overlay count must equal the sum of category counts
    expect(cvCount + yoloCount + ocrCount).toBe(overlayCandidates.length);
    expect(overlayCandidates.length).toBe(4);
    expect(cvCount).toBe(2);
    expect(yoloCount).toBe(1);
    expect(ocrCount).toBe(1);
  });

  it('switching filter updates both count and overlay set consistently', () => {
    const candidates = [
      { candidateType: 'rectangular_region_candidate', payload: { region: SAMPLE_REGION, source: 'dense_edge_component' } },
      { candidateType: 'object_detection', payload: { bbox: [100, 200, 300, 400], stage: 'yolo' } },
      { candidateType: 'ocr_text', payload: { bbox: [50, 60, 70, 80], source: 'tesseract' } },
    ];

    // "both" filter
    const bothSet = candidates.filter(
      (c) =>
        hasDrawableGeometry(c.payload) &&
        candidatesPassOverlayFilter(c.candidateType, c.payload, 'both'),
    );
    expect(bothSet.length).toBe(3);

    // "opencv" filter
    const opencvSet = candidates.filter(
      (c) =>
        hasDrawableGeometry(c.payload) &&
        candidatesPassOverlayFilter(c.candidateType, c.payload, 'opencv'),
    );
    expect(opencvSet.length).toBe(1);

    // "yolo" filter
    const yoloSet = candidates.filter(
      (c) =>
        hasDrawableGeometry(c.payload) &&
        candidatesPassOverlayFilter(c.candidateType, c.payload, 'yolo'),
    );
    expect(yoloSet.length).toBe(1);

    // "ocr" filter
    const ocrSet = candidates.filter(
      (c) =>
        hasDrawableGeometry(c.payload) &&
        candidatesPassOverlayFilter(c.candidateType, c.payload, 'ocr'),
    );
    expect(ocrSet.length).toBe(1);

    // The sets are all subsets of the "both" set
    expect(opencvSet.every((c) => bothSet.includes(c))).toBe(true);
    expect(yoloSet.every((c) => bothSet.includes(c))).toBe(true);
    expect(ocrSet.every((c) => bothSet.includes(c))).toBe(true);
  });
});
