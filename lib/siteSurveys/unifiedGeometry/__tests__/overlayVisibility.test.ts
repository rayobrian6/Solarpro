import { describe, it, expect } from 'vitest';
import {
  isCleanVisibleRoofLine,
  isCleanHiddenMask,
  isCleanVisiblePlane,
  polygonAreaRatio,
  CLEAN_ROOF_LINE_SUBTYPES,
} from '../overlayVisibility';

const square = (frac: number) => {
  const s = Math.sqrt(frac) * 1000;
  return [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
};

describe('overlayVisibility — polygonAreaRatio', () => {
  it('full-frame square ≈ 1.0', () => { expect(polygonAreaRatio(square(1))).toBeCloseTo(1, 2); });
  it('half-frame ≈ 0.5', () => { expect(polygonAreaRatio(square(0.5))).toBeCloseTo(0.5, 2); });
  it('degenerate/empty → 0', () => { expect(polygonAreaRatio([])).toBe(0); expect(polygonAreaRatio(null)).toBe(0); });
});

describe('overlayVisibility — Commit A: roof-line subtypes', () => {
  for (const sub of ['ridge', 'eave', 'rake', 'valley', 'hip']) {
    it(`shows trusted subtype ${sub} in clean`, () => {
      expect(isCleanVisibleRoofLine({ geometryClass: 'roof_line', lineSubtype: sub })).toBe(true);
    });
  }
  for (const sub of ['wall_bottom_edge', 'wall_vertical']) {
    it(`hides raw wall subtype ${sub} in clean`, () => {
      expect(isCleanVisibleRoofLine({ geometryClass: 'roof_line', lineSubtype: sub })).toBe(false);
    });
  }
  it('non-line artifacts unaffected', () => {
    expect(isCleanVisibleRoofLine({ geometryClass: 'roof_plane' })).toBe(true);
    expect(isCleanVisibleRoofLine({ geometryClass: 'segmentation_mask' })).toBe(true);
  });
  it('CLEAN_ROOF_LINE_SUBTYPES excludes wall lines', () => {
    expect(CLEAN_ROOF_LINE_SUBTYPES.has('wall_vertical')).toBe(false);
    expect(CLEAN_ROOF_LINE_SUBTYPES.has('wall_bottom_edge')).toBe(false);
  });
});

describe('overlayVisibility — Commit B: masks hidden in clean', () => {
  it('segmentation_mask is clean-hidden', () => {
    expect(isCleanHiddenMask({ geometryClass: 'segmentation_mask' })).toBe(true);
  });
  it('non-mask classes are not clean-hidden by this rule', () => {
    expect(isCleanHiddenMask({ geometryClass: 'roof_plane' })).toBe(false);
    expect(isCleanHiddenMask({ geometryClass: 'roof_line' })).toBe(false);
  });
});

describe('overlayVisibility — Commit C: plane guards', () => {
  const goodPoly = { vertices: square(0.2) }; // 20% of frame
  it('shows a real, reasonably-sized, confident plane', () => {
    expect(isCleanVisiblePlane({ geometryClass: 'wall_plane', polygon: goodPoly, confidence: 66 })).toBe(true);
  });
  it('hides a polygon-less plane', () => {
    expect(isCleanVisiblePlane({ geometryClass: 'wall_plane', polygon: null, confidence: 90 })).toBe(false);
    expect(isCleanVisiblePlane({ geometryClass: 'roof_plane', polygon: { vertices: [{ x: 0, y: 0 }] }, confidence: 90 })).toBe(false);
  });
  it('hides an oversized/full-frame plane (>85%)', () => {
    expect(isCleanVisiblePlane({ geometryClass: 'roof_plane', polygon: { vertices: square(0.9) }, confidence: 90 })).toBe(false);
  });
  it('hides a low-confidence plane (<60)', () => {
    expect(isCleanVisiblePlane({ geometryClass: 'wall_plane', polygon: goodPoly, confidence: 55 })).toBe(false);
  });
  it('non-plane artifacts unaffected', () => {
    expect(isCleanVisiblePlane({ geometryClass: 'roof_line', polygon: null })).toBe(true);
    expect(isCleanVisiblePlane({ geometryClass: 'segmentation_mask', polygon: null })).toBe(true);
  });
});
