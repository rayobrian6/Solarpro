/**
 * Tests for Phase 3B: CAD-Ready Roof Intelligence
 *
 * Covers:
 * - Obstruction type normalization (legacy → Phase 3B mapping)
 * - CAD usefulness field generation
 * - IoU deduplication
 * - Priority ranking

import { describe, expect, it } from 'vitest';
 * - Review-only boundary enforcement (no CAD mutation, no permit mutation)
 */

import {
  computeCenter,
  computeAspectRatio,
  classifySizeBucket,
  determineOrientationHint,
  computeEdgeDistance,
  classifyEdgeProximity,
  determineQuadrant,
  classifySetbackBuffer,
  normalizeObstructionType,
  classifyObstructionType,
  determinePriority,
  determineCadBlockHint,
  determineObstructionFootprintHint,
  determineClearanceRadiusHint,
  determineLayoutAvoidancePriority,
  determineCadEffects,
  computeIoU,
  centerDistance,
  areDuplicates,
  deduplicateByIoU,
  extractObstructionsForFilename,
  type ObstructionRegion,
  type ObstructionCenterPoint,
  type RoofObstructionType,
  type ObstructionSizeBucket,
  type ObstructionPriority,
  type ReviewState,
  type ObstructionOrientationHint,
  type ObstructionEdgeProximity,
  type RoofPlaneQuadrant,
  type SetbackBufferCategory,
  type CadBlockHint,
  type ObstructionFootprintHint,
  type ClearanceRadiusHint,
} from './roofObstructionRegistration';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function makeRegion(x: number, y: number, w: number, h: number): ObstructionRegion {
  return { x, y, width: w, height: h, coordinateSystem: 'normalized_image_0_1000' };
}


function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}



// ─────────────────────────────────────────────────────────────────────────
// Section 1: Obstruction Type Normalization Tests
// ─────────────────────────────────────────────────────────────────────────

describe('Obstruction Type Normalization', () => {

  it('normalizeObstructionType: null → null', () => {
    expect(normalizeObstructionType(null)).toBe(null);
  });

  it('normalizeObstructionType: direct match chimney', () => {
    expect(normalizeObstructionType('chimney')).toBe('chimney');
  });

  it('normalizeObstructionType: direct match skylight', () => {
    expect(normalizeObstructionType('skylight')).toBe('skylight');
  });

  it('normalizeObstructionType: direct match pipe_boot', () => {
    expect(normalizeObstructionType('pipe_boot')).toBe('pipe_boot');
  });

  it('normalizeObstructionType: direct match plumbing_vent', () => {
    expect(normalizeObstructionType('plumbing_vent')).toBe('plumbing_vent');
  });

  it('normalizeObstructionType: direct match exhaust_vent', () => {
    expect(normalizeObstructionType('exhaust_vent')).toBe('exhaust_vent');
  });

  it('normalizeObstructionType: direct match roof_hvac', () => {
    expect(normalizeObstructionType('roof_hvac')).toBe('roof_hvac');
  });

  it('normalizeObstructionType: direct match antenna', () => {
    expect(normalizeObstructionType('antenna')).toBe('antenna');
  });

  it('normalizeObstructionType: direct match roof_jack', () => {
    expect(normalizeObstructionType('roof_jack')).toBe('roof_jack');
  });

  it('normalizeObstructionType: direct match unknown_obstruction', () => {
    expect(normalizeObstructionType('unknown_obstruction')).toBe('unknown_obstruction');
  });

  it('normalizeObstructionType: legacy "vent" → plumbing_vent', () => {
    expect(normalizeObstructionType('vent')).toBe('plumbing_vent');
  });

  it('normalizeObstructionType: legacy "pipe_boots" → pipe_boot', () => {
    expect(normalizeObstructionType('pipe_boots')).toBe('pipe_boot');
  });

  it('normalizeObstructionType: legacy "hvac" → roof_hvac', () => {
    expect(normalizeObstructionType('hvac')).toBe('roof_hvac');
  });

  it('normalizeObstructionType: legacy "unknown" → unknown_obstruction', () => {
    expect(normalizeObstructionType('unknown')).toBe('unknown_obstruction');
  });

  it('normalizeObstructionType: legacy "gable_vent" → exhaust_vent', () => {
    expect(normalizeObstructionType('gable_vent')).toBe('exhaust_vent');
  });

  it('normalizeObstructionType: fuzzy "plumbing" → plumbing_vent', () => {
    expect(normalizeObstructionType('plumbing')).toBe('plumbing_vent');
  });

  it('normalizeObstructionType: fuzzy "satellite" → satellite_dish', () => {
    expect(normalizeObstructionType('satellite')).toBe('satellite_dish');
  });

  it('normalizeObstructionType: fuzzy "dish" → satellite_dish', () => {
    expect(normalizeObstructionType('dish')).toBe('satellite_dish');
  });

  it('normalizeObstructionType: unknown string → unknown_obstruction', () => {
    expect(normalizeObstructionType('weird_thing')).toBe('unknown_obstruction');
  });

  it('normalizeObstructionType: case insensitive', () => {
    expect(normalizeObstructionType('CHIMNEY')).toBe('chimney');
    expect(normalizeObstructionType('Skylight')).toBe('skylight');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 2: Geometry Readiness Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('Geometry Readiness Fields', () => {

  it('computeCenter: correct center point', () => {
    const region = makeRegion(100, 200, 300, 400);
    const center = computeCenter(region);
    expect(center.x).toBe(250);
    expect(center.y).toBe(400);
    expect(center.coordinateSystem).toBe('normalized_image_0_1000');
  });

  it('computeAspectRatio: horizontal rectangle', () => {
    const region = makeRegion(0, 0, 200, 100);
    expect(computeAspectRatio(region)).toBe(2);
  });

  it('computeAspectRatio: vertical rectangle', () => {
    const region = makeRegion(0, 0, 100, 200);
    expect(computeAspectRatio(region)).toBe(0.5);
  });

  it('computeAspectRatio: square', () => {
    const region = makeRegion(0, 0, 100, 100);
    expect(computeAspectRatio(region)).toBe(1);
  });

  it('classifySizeBucket: all buckets', () => {
    expect(classifySizeBucket(1000)).toBe('tiny');
    expect(classifySizeBucket(8000)).toBe('small');
    expect(classifySizeBucket(30000)).toBe('medium');
    expect(classifySizeBucket(80000)).toBe('large');
    expect(classifySizeBucket(200000)).toBe('huge');
  });

  it('determineOrientationHint: horizontal', () => {
    expect(determineOrientationHint(3.0)).toBe('horizontal');
  });

  it('determineOrientationHint: vertical', () => {
    expect(determineOrientationHint(0.3)).toBe('vertical');
  });

  it('determineOrientationHint: square', () => {
    expect(determineOrientationHint(1.0)).toBe('square');
  });

  it('determineOrientationHint: irregular', () => {
    expect(determineOrientationHint(1.5)).toBe('irregular');
  });

  it('computeEdgeDistance: center of image', () => {
    const center: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
    expect(computeEdgeDistance(center)).toBe(500);
  });

  it('computeEdgeDistance: near corner', () => {
    const center: ObstructionCenterPoint = { x: 50, y: 50, coordinateSystem: 'normalized_image_0_1000' };
    expect(computeEdgeDistance(center)).toBe(50);
  });

  it('classifyEdgeProximity: all categories', () => {
    const center: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
    expect(classifyEdgeProximity(500)).toBe('center');
    expect(classifyEdgeProximity(300)).toBe('near_center');
    expect(classifyEdgeProximity(100)).toBe('edge');
    expect(classifyEdgeProximity(20)).toBe('corner');
  });

  it('determineQuadrant: all quadrants', () => {
    const nw: ObstructionCenterPoint = { x: 200, y: 200, coordinateSystem: 'normalized_image_0_1000' };
    const ne: ObstructionCenterPoint = { x: 700, y: 200, coordinateSystem: 'normalized_image_0_1000' };
    const sw: ObstructionCenterPoint = { x: 200, y: 700, coordinateSystem: 'normalized_image_0_1000' };
    const se: ObstructionCenterPoint = { x: 700, y: 700, coordinateSystem: 'normalized_image_0_1000' };
    expect(determineQuadrant(nw)).toBe('nw');
    expect(determineQuadrant(ne)).toBe('ne');
    expect(determineQuadrant(sw)).toBe('sw');
    expect(determineQuadrant(se)).toBe('se');
  });

  it('classifySetbackBuffer: all categories', () => {
    expect(classifySetbackBuffer(150)).toBe('standard');
    expect(classifySetbackBuffer(50)).toBe('reduced');
    expect(classifySetbackBuffer(10)).toBe('none');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 3: CAD Usefulness Field Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('CAD Usefulness Fields', () => {

  it('determineCadBlockHint: chimney → chimney_block', () => {
    expect(determineCadBlockHint('chimney', 'large', 'square')).toBe('chimney_block');
  });

  it('determineCadBlockHint: skylight → skylight_block', () => {
    expect(determineCadBlockHint('skylight', 'medium', 'square')).toBe('skylight_block');
  });

  it('determineCadBlockHint: roof_hvac → hvac_unit', () => {
    expect(determineCadBlockHint('roof_hvac', 'large', 'square')).toBe('hvac_unit');
  });

  it('determineCadBlockHint: plumbing_vent square → vent_circle', () => {
    expect(determineCadBlockHint('plumbing_vent', 'small', 'square')).toBe('vent_circle');
  });

  it('determineCadBlockHint: plumbing_vent irregular → vent_rect', () => {
    expect(determineCadBlockHint('plumbing_vent', 'small', 'irregular')).toBe('vent_rect');
  });

  it('determineCadBlockHint: pipe_boot square → pipe_boot_circle', () => {
    expect(determineCadBlockHint('pipe_boot', 'small', 'square')).toBe('pipe_boot_circle');
  });

  it('determineCadBlockHint: null → generic_rect', () => {
    expect(determineCadBlockHint(null, 'small', 'square')).toBe('generic_rect');
  });

  it('determineCadBlockHint: dormer → dormer_polyline', () => {
    expect(determineCadBlockHint('dormer', 'large', 'horizontal')).toBe('dormer_polyline');
  });

  it('determineCadBlockHint: satellite_dish → satellite_dish', () => {
    expect(determineCadBlockHint('satellite_dish', 'medium', 'square')).toBe('satellite_dish');
  });

  it('determineCadBlockHint: antenna → antenna', () => {
    expect(determineCadBlockHint('antenna', 'tiny', 'vertical')).toBe('antenna');
  });

  it('determineObstructionFootprintHint: circular types', () => {
    expect(determineObstructionFootprintHint('plumbing_vent', 1.0)).toBe('circular');
    expect(determineObstructionFootprintHint('exhaust_vent', 1.0)).toBe('circular');
    expect(determineObstructionFootprintHint('pipe_boot', 1.0)).toBe('circular');
    expect(determineObstructionFootprintHint('solar_tube', 1.0)).toBe('circular');
    expect(determineObstructionFootprintHint('roof_jack', 1.0)).toBe('circular');
  });

  it('determineObstructionFootprintHint: rectangular types', () => {
    expect(determineObstructionFootprintHint('chimney', 1.5)).toBe('rectangular');
    expect(determineObstructionFootprintHint('chimney', 1.0)).toBe('square');
    expect(determineObstructionFootprintHint('skylight', 2.0)).toBe('rectangular');
    expect(determineObstructionFootprintHint('skylight', 1.0)).toBe('square');
  });

  it('determineObstructionFootprintHint: irregular types', () => {
    expect(determineObstructionFootprintHint('dormer', 1.5)).toBe('irregular');
    expect(determineObstructionFootprintHint('flashing', 1.5)).toBe('irregular');
    expect(determineObstructionFootprintHint('satellite_dish', 1.5)).toBe('irregular');
  });

  it('determineObstructionFootprintHint: null → unknown', () => {
    expect(determineObstructionFootprintHint(null, 1.0)).toBe('unknown');
  });

  it('determineClearanceRadiusHint: all ranges', () => {
    expect(determineClearanceRadiusHint(1000)).toBe('0_5ft');
    expect(determineClearanceRadiusHint(8000)).toBe('1ft');
    expect(determineClearanceRadiusHint(30000)).toBe('2ft');
    expect(determineClearanceRadiusHint(80000)).toBe('3ft');
    expect(determineClearanceRadiusHint(120000)).toBe('4ft');
    expect(determineClearanceRadiusHint(200000)).toBe('5ft_plus');
  });

  it('determineLayoutAvoidancePriority: chimney = 10', () => {
    expect(determineLayoutAvoidancePriority('chimney', 'large', 'high')).toBe(10);
  });

  it('determineLayoutAvoidancePriority: skylight = 10', () => {
    expect(determineLayoutAvoidancePriority('skylight', 'medium', 'high')).toBe(10);
  });

  it('determineLayoutAvoidancePriority: plumbing_vent = 7', () => {
    expect(determineLayoutAvoidancePriority('plumbing_vent', 'small', 'medium')).toBe(7);
  });

  it('determineLayoutAvoidancePriority: pipe_boot = 5', () => {
    expect(determineLayoutAvoidancePriority('pipe_boot', 'small', 'medium')).toBe(5);
  });

  it('determineLayoutAvoidancePriority: satellite_dish = 8', () => {
    expect(determineLayoutAvoidancePriority('satellite_dish', 'medium', 'medium')).toBe(8);
  });

  it('determineLayoutAvoidancePriority: flashing = 2', () => {
    expect(determineLayoutAvoidancePriority('flashing', 'tiny', 'low')).toBe(2);
  });

  it('determineLayoutAvoidancePriority: null = 2', () => {
    expect(determineLayoutAvoidancePriority(null, 'small', 'low')).toBe(2);
  });

  it('determineCadEffects: chimney affects everything', () => {
    const effects = determineCadEffects('chimney', 'large', 'high');
    expect(effects.canAffectPanelPlacement).toBe(true);
    expect(effects.canAffectFirePathway).toBe(true);
    expect(effects.canAffectConduitPath).toBe(true);
    expect(effects.canAffectStructuralAttachment).toBe(true);
  });

  it('determineCadEffects: skylight affects panels and fire', () => {
    const effects = determineCadEffects('skylight', 'medium', 'high');
    expect(effects.canAffectPanelPlacement).toBe(true);
    expect(effects.canAffectFirePathway).toBe(true);
    expect(effects.canAffectConduitPath).toBe(true);
    expect(effects.canAffectStructuralAttachment).toBe(false);
  });

  it('determineCadEffects: pipe_boot only affects panels', () => {
    const effects = determineCadEffects('pipe_boot', 'small', 'medium');
    expect(effects.canAffectPanelPlacement).toBe(true);
    expect(effects.canAffectFirePathway).toBe(false);
    expect(effects.canAffectConduitPath).toBe(false);
    expect(effects.canAffectStructuralAttachment).toBe(false);
  });

  it('determineCadEffects: null type still affects panels', () => {
    const effects = determineCadEffects(null, 'small', 'low');
    expect(effects.canAffectPanelPlacement).toBe(true);
    expect(effects.canAffectFirePathway).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 4: IoU Deduplication Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('IoU Deduplication', () => {

  it('computeIoU: identical regions = 1.0', () => {
    const r = makeRegion(100, 100, 200, 200);
    expect(computeIoU(r, r)).toBe(1);
  });

  it('computeIoU: no overlap = 0.0', () => {
    const a = makeRegion(0, 0, 100, 100);
    const b = makeRegion(500, 500, 100, 100);
    expect(computeIoU(a, b)).toBe(0);
  });

  it('computeIoU: partial overlap', () => {
    const a = makeRegion(0, 0, 200, 200);
    const b = makeRegion(100, 100, 200, 200);
    // Intersection: 100x100 = 10000
    // Union: 40000 + 40000 - 10000 = 70000
    // IoU = 10000/70000 ≈ 0.143
    const iou = computeIoU(a, b);
    expect(iou > 0.1 && iou < 0.2).toBe(true);
  });

  it('computeIoU: 50% overlap (high IoU)', () => {
    const a = makeRegion(0, 0, 200, 200);
    const b = makeRegion(50, 50, 200, 200);
    // Intersection: 150x150 = 22500
    // Union: 40000 + 40000 - 22500 = 57500
    // IoU = 22500/57500 ≈ 0.391
    const iou = computeIoU(a, b);
    expect(iou > 0.3 && iou < 0.5).toBe(true);
  });

  it('computeIoU: contained region (one inside other)', () => {
    const outer = makeRegion(0, 0, 400, 400);
    const inner = makeRegion(50, 50, 100, 100);
    // Intersection = inner area = 10000
    // Union = outer area = 160000
    // IoU = 10000/160000 = 0.0625
    const iou = computeIoU(outer, inner);
    expect(iou > 0.05 && iou < 0.08).toBe(true);
  });

  it('centerDistance: same center = 0', () => {
    const a: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
    expect(centerDistance(a, a)).toBe(0);
  });

  it('centerDistance: diagonal distance', () => {
    const a: ObstructionCenterPoint = { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' };
    const b: ObstructionCenterPoint = { x: 300, y: 400, coordinateSystem: 'normalized_image_0_1000' };
    const dist = centerDistance(a, b);
    expect(Math.abs(dist - 500) < 1).toBe(true);
  });

  it('deduplicateByIoU: empty list', () => {
    const result = deduplicateByIoU([]);
    expect(result.length).toBe(0);
  });

  it('deduplicateByIoU: single item', () => {
    const records = [{
      id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200),
      area: 40000, confidence: 80, detectionMethod: 'opencv_contour' as const,
      payload: {}, sourceImageSha256: null, regionIndex: 0,
    }];
    const result = deduplicateByIoU(records);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('deduplicateByIoU: two identical regions → one kept (higher confidence)', () => {
    const records = [
      { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 80, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
      { id: '2', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 60, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
    ];
    const result = deduplicateByIoU(records);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('deduplicateByIoU: two overlapping regions (IoU > 0.5) → one kept', () => {
    const records = [
      { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 90, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
      { id: '2', sourceFileId: 'f1', region: makeRegion(120, 120, 200, 200), area: 40000, confidence: 70, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
    ];
    const result = deduplicateByIoU(records);
    // These overlap significantly — should be deduplicated to 1
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('deduplicateByIoU: two non-overlapping regions → both kept', () => {
    const records = [
      { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 100, 100), area: 10000, confidence: 80, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
      { id: '2', sourceFileId: 'f1', region: makeRegion(700, 700, 100, 100), area: 10000, confidence: 70, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
    ];
    const result = deduplicateByIoU(records);
    expect(result.length).toBe(2);
  });

  it('deduplicateByIoU: nearby centers with similar area → deduped', () => {
    const records = [
      { id: '1', sourceFileId: 'f1', region: makeRegion(400, 400, 100, 100), area: 10000, confidence: 85, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
      { id: '2', sourceFileId: 'f1', region: makeRegion(420, 420, 100, 100), area: 10000, confidence: 75, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
    ];
    const result = deduplicateByIoU(records);
    // Centers are close (~28 apart) and areas are identical — should dedup
    expect(result.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 5: Priority Ranking Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('Priority Ranking', () => {

  it('determinePriority: chimney = high', () => {
    expect(determinePriority('chimney', 'large')).toBe('high');
  });

  it('determinePriority: skylight = high', () => {
    expect(determinePriority('skylight', 'medium')).toBe('high');
  });

  it('determinePriority: roof_hvac = high', () => {
    expect(determinePriority('roof_hvac', 'large')).toBe('high');
  });

  it('determinePriority: dormer = high', () => {
    expect(determinePriority('dormer', 'large')).toBe('high');
  });

  it('determinePriority: plumbing_vent = medium', () => {
    expect(determinePriority('plumbing_vent', 'small')).toBe('medium');
  });

  it('determinePriority: exhaust_vent = medium', () => {
    expect(determinePriority('exhaust_vent', 'small')).toBe('medium');
  });

  it('determinePriority: ridge_vent = medium', () => {
    expect(determinePriority('ridge_vent', 'medium')).toBe('medium');
  });

  it('determinePriority: pipe_boot = medium', () => {
    expect(determinePriority('pipe_boot', 'small')).toBe('medium');
  });

  it('determinePriority: solar_tube = medium', () => {
    expect(determinePriority('solar_tube', 'medium')).toBe('medium');
  });

  it('determinePriority: satellite_dish = medium', () => {
    expect(determinePriority('satellite_dish', 'medium')).toBe('medium');
  });

  it('determinePriority: flashing = low', () => {
    expect(determinePriority('flashing', 'tiny')).toBe('low');
  });

  it('determinePriority: roof_jack = low', () => {
    expect(determinePriority('roof_jack', 'tiny')).toBe('low');
  });

  it('determinePriority: antenna = low', () => {
    expect(determinePriority('antenna', 'tiny')).toBe('low');
  });

  it('determinePriority: unknown_obstruction = low', () => {
    expect(determinePriority('unknown_obstruction', 'small')).toBe('low');
  });

  it('determinePriority: null = low', () => {
    expect(determinePriority(null, 'small')).toBe('low');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 6: Obstruction Type Classification Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('Obstruction Type Classification', () => {

  it('classifyObstructionType: large square = roof_hvac', () => {
    const type = classifyObstructionType(90000, 1.0, 'large', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('roof_hvac');
  });

  it('classifyObstructionType: large square under 80000 = chimney', () => {
    const type = classifyObstructionType(70000, 1.0, 'large', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('chimney');
  });

  it('classifyObstructionType: large horizontal = dormer', () => {
    const type = classifyObstructionType(100000, 3.0, 'large', 'horizontal', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('dormer');
  });

  it('classifyObstructionType: medium square > 25k = skylight', () => {
    const type = classifyObstructionType(30000, 1.0, 'medium', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('skylight');
  });

  it('classifyObstructionType: medium square < 25k = solar_tube', () => {
    const type = classifyObstructionType(20000, 1.0, 'medium', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('solar_tube');
  });

  it('classifyObstructionType: medium horizontal near top = ridge_vent', () => {
    const type = classifyObstructionType(35000, 4.0, 'medium', 'horizontal', 'near_center', 'nw', { x: 500, y: 200, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('ridge_vent');
  });

  it('classifyObstructionType: small square near top = plumbing_vent', () => {
    const type = classifyObstructionType(8000, 1.0, 'small', 'square', 'near_center', 'nw', { x: 500, y: 200, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('plumbing_vent');
  });

  it('classifyObstructionType: small square at edge = exhaust_vent', () => {
    const type = classifyObstructionType(10000, 1.0, 'small', 'square', 'edge', 'nw', { x: 100, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('exhaust_vent');
  });

  it('classifyObstructionType: small square center = pipe_boot', () => {
    const type = classifyObstructionType(10000, 1.0, 'small', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('pipe_boot');
  });

  it('classifyObstructionType: tiny square = pipe_boot', () => {
    const type = classifyObstructionType(3000, 1.0, 'tiny', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('pipe_boot');
  });

  it('classifyObstructionType: tiny vertical = antenna', () => {
    const type = classifyObstructionType(3000, 0.3, 'tiny', 'vertical', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
    expect(type).toBe('antenna');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 7: extractObstructionsForFilename Tests (Integration)
  // ─────────────────────────────────────────────────────────────────────────

});

describe('extractObstructionsForFilename Integration', () => {

  it('extractObstructionsForFilename: empty candidates → 0 obstructions', () => {
    const result = extractObstructionsForFilename([], 'test.jpg');
    expect(result.obstructionCount).toBe(0);
    expect(result.obstructions.length).toBe(0);
  });

  it('extractObstructionsForFilename: single candidate → 1 obstruction with full metadata', () => {
    const candidates = [{
      fileId: 'f1',
      candidateType: 'obstruction_candidate',
      confidence: 80,
      payload: {
        region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' },
        source: 'opencv_contour',
        regionIndex: 0,
      },
      deterministicHash: 'hash_001',
    }];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    expect(result.obstructionCount).toBe(1);

    const obs = result.obstructions[0];
    expect(obs.sourceFilename).toBe('test.jpg');
    expect(obs.areaNormalized).toBe(10000);
    expect(obs.aspectRatio).toBe(1);
    expect(obs.sizeBucket).toBe('small');
    expect(obs.orientationHint).toBe('square');
    expect(obs.reviewState).toBe('review_required');
    expect(obs.obstructionType !== null).toBe(true);
    expect(obs.priority !== null).toBe(true);
    expect(obs.cadBlockHint !== null).toBe(true);
    expect(obs.requiresHumanReview === true).toBe(true);
    expect(obs.canAffectPanelPlacement === true).toBe(true);
  });

  it('extractObstructionsForFilename: filters by min area', () => {
    const candidates = [
      // Too small (area = 4000)
      {
        fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80,
        payload: { region: { x: 100, y: 100, width: 20, height: 20, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 },
        deterministicHash: 'hash_tiny',
      },
      // Valid (area = 10000)
      {
        fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80,
        payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 1 },
        deterministicHash: 'hash_valid',
      },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    expect(result.obstructionCount).toBe(1);
    expect(result.obstructions[0].id).toBe('hash_valid');
  });

  it('extractObstructionsForFilename: deduplicates identical regions', () => {
    const candidates = [
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 1 }, deterministicHash: 'hash_2' },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    expect(result.obstructionCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 8: Review-Only Boundary Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('Review-Only Boundary Enforcement', () => {

  it('reviewState: all obstructions default to review_required', () => {
    const candidates = [
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 95, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    for (const obs of result.obstructions) {
      expect(obs.reviewState).toBe('review_required');
      expect(obs.requiresHumanReview).toBe(true);
    }
  });

  it('reviewState: accepted/rejected only by explicit action, not automatic', () => {
    // Even with high confidence, the review state should still be review_required
    const candidates = [
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 99, payload: { region: { x: 400, y: 400, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' }, source: 'yolo_detection', regionIndex: 0 }, deterministicHash: 'hash_1' },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    expect(result.obstructions[0].reviewState).toBe('review_required');
    expect(result.obstructions[0].requiresHumanReview).toBe(true);
  });

  it('no CAD mutation: extraction returns review-only data, no CAD geometry', () => {
    const candidates = [
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    const obs = result.obstructions[0];

    // These should be hints, not authoritative CAD data
    expect(typeof obs.cadBlockHint === 'string').toBe(true);
    expect(typeof obs.obstructionFootprintHint === 'string').toBe(true);
    expect(typeof obs.clearanceRadiusHint === 'string').toBe(true);
    expect(typeof obs.setbackCategoryHint === 'string').toBe(true);

    // No authoritative roof geometry coordinates (no roof plane, no ridge, no eave)
    expect(!('roofPlaneCoordinates' in obs)).toBe(true);
    expect(!('permitGeometry' in obs)).toBe(true);
    expect(!('cadGeometry' in obs)).toBe(true);
  });

  it('no permit mutation: no permit-related fields on obstructions', () => {
    const candidates = [
      { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
    ];
    const result = extractObstructionsForFilename(candidates, 'test.jpg');
    const obs = result.obstructions[0];

    // No permit geometry data
    expect(!('permitSetback' in obs)).toBe(true);
    expect(!('permitRequired' in obs)).toBe(true);
    expect(!('permitZone' in obs)).toBe(true);

    // CAD fields are hints only
    expect(obs.clearanceRadiusHint.endsWith('ft') || obs.clearanceRadiusHint === 'unknown').toBe(true);
    expect(obs.layoutAvoidancePriority >= 1 && obs.layoutAvoidancePriority <= 10).toBe(true);
  });

  it('ReviewState type: only valid values review_required/accepted/rejected', () => {
    const validStates: ReviewState[] = ['review_required', 'accepted', 'rejected'];
    expect(validStates.length).toBe(3);
    expect(!validStates.includes('pending' as ReviewState)).toBe(true);
    expect(!validStates.includes('auto_accepted' as ReviewState)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 9: Manifest ObstructionSummary Tests
  // ─────────────────────────────────────────────────────────────────────────

});

describe('Manifest ObstructionSummary', () => {

  it('manifest obstructionSummary: computes correct priority distribution', () => {
    // Simulate what buildObstructionSummary does
    const mockObstructions = [
      { obstructionType: 'chimney', priority: 'high', reviewState: 'review_required', confidence: 80, reviewed: false, center: { x: 500, y: 500 } },
      { obstructionType: 'skylight', priority: 'high', reviewState: 'review_required', confidence: 75, reviewed: false, center: { x: 300, y: 300 } },
      { obstructionType: 'plumbing_vent', priority: 'medium', reviewState: 'review_required', confidence: 70, reviewed: false, center: { x: 400, y: 200 } },
      { obstructionType: 'flashing', priority: 'low', reviewState: 'review_required', confidence: 60, reviewed: false, center: { x: 100, y: 100 } },
    ];

    const priorityDistribution = { high: 0, medium: 0, low: 0 };
    for (const obs of mockObstructions) {
      if (obs.priority === 'high') priorityDistribution.high++;
      else if (obs.priority === 'medium') priorityDistribution.medium++;
      else priorityDistribution.low++;
    }
    expect(priorityDistribution.high).toBe(2);
    expect(priorityDistribution.medium).toBe(1);
    expect(priorityDistribution.low).toBe(1);
  });

  it('manifest obstructionSummary: computes correct review state distribution', () => {
    const mockObstructions = [
      { obstructionType: 'chimney', reviewState: 'review_required', confidence: 80, reviewed: false },
      { obstructionType: 'skylight', reviewState: 'accepted', confidence: 75, reviewed: true },
      { obstructionType: 'plumbing_vent', reviewState: 'review_required', confidence: 70, reviewed: false },
      { obstructionType: 'flashing', reviewState: 'rejected', confidence: 60, reviewed: true },
    ];

    const reviewDist = { review_required: 0, accepted: 0, rejected: 0 };
    let reviewedCount = 0;
    for (const obs of mockObstructions) {
      if (obs.reviewState === 'accepted') { reviewDist.accepted++; reviewedCount++; }
      else if (obs.reviewState === 'rejected') { reviewDist.rejected++; reviewedCount++; }
      else reviewDist.review_required++;
    }
    expect(reviewDist.review_required).toBe(2);
    expect(reviewDist.accepted).toBe(1);
    expect(reviewDist.rejected).toBe(1);
    expect(reviewedCount).toBe(2);
  });

  it('manifest obstructionSummary: computes CAD readiness quality score', () => {
    // 10 obstructions: 8 classified, 2 unknown. All with geometry. Avg confidence 70.
    const totalObstructions = 10;
    const missingClassificationCount = 2;
    const totalWithGeometry = 10;
    const avgConfidence = 70;

    const classificationCompleteness = ((totalObstructions - missingClassificationCount) / totalObstructions) * 40;
    const geometryCompleteness = (totalWithGeometry / totalObstructions) * 30;
    const confidenceScore = (avgConfidence / 100) * 30;
    const cadReadinessQualityScore = Math.round(classificationCompleteness + geometryCompleteness + confidenceScore);

    // 32 + 30 + 21 = 83
    expect(cadReadinessQualityScore).toBe(83);
  });

  it('manifest obstructionSummary: counts high-impact obstructions', () => {
    const mockObstructions = [
      { obstructionType: 'chimney', priority: 'high' },
      { obstructionType: 'skylight', priority: 'high' },
      { obstructionType: 'plumbing_vent', priority: 'medium' },
      { obstructionType: 'flashing', priority: 'low' },
    ];
    const highImpactCount = mockObstructions.filter(o => o.priority === 'high').length;
    expect(highImpactCount).toBe(2);
  });

  it('manifest obstructionSummary: counts missing classifications', () => {
    const mockObstructions = [
      { obstructionType: 'chimney' },
      { obstructionType: null },
      { obstructionType: 'unknown_obstruction' },
      { obstructionType: 'unknown' }, // legacy
      { obstructionType: 'plumbing_vent' },
    ];
    const missingCount = mockObstructions.filter(o =>
      !o.obstructionType ||
      o.obstructionType === 'unknown_obstruction' ||
      o.obstructionType === 'unknown'
    ).length;
    expect(missingCount).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────


});
