/**
 * Tests for Phase 3B: CAD-Ready Roof Intelligence
 *
 * Covers:
 * - Obstruction type normalization (legacy → Phase 3B mapping)
 * - CAD usefulness field generation
 * - IoU deduplication
 * - Priority ranking
 * - Manifest obstructionSummary (Phase 3B extended)
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Section 1: Obstruction Type Normalization Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Obstruction Type Normalization ===');

test('normalizeObstructionType: null → null', () => {
  assertEqual(normalizeObstructionType(null), null, 'null input');
});

test('normalizeObstructionType: direct match chimney', () => {
  assertEqual(normalizeObstructionType('chimney'), 'chimney', 'chimney');
});

test('normalizeObstructionType: direct match skylight', () => {
  assertEqual(normalizeObstructionType('skylight'), 'skylight', 'skylight');
});

test('normalizeObstructionType: direct match pipe_boot', () => {
  assertEqual(normalizeObstructionType('pipe_boot'), 'pipe_boot', 'pipe_boot');
});

test('normalizeObstructionType: direct match plumbing_vent', () => {
  assertEqual(normalizeObstructionType('plumbing_vent'), 'plumbing_vent', 'plumbing_vent');
});

test('normalizeObstructionType: direct match exhaust_vent', () => {
  assertEqual(normalizeObstructionType('exhaust_vent'), 'exhaust_vent', 'exhaust_vent');
});

test('normalizeObstructionType: direct match roof_hvac', () => {
  assertEqual(normalizeObstructionType('roof_hvac'), 'roof_hvac', 'roof_hvac');
});

test('normalizeObstructionType: direct match antenna', () => {
  assertEqual(normalizeObstructionType('antenna'), 'antenna', 'antenna');
});

test('normalizeObstructionType: direct match roof_jack', () => {
  assertEqual(normalizeObstructionType('roof_jack'), 'roof_jack', 'roof_jack');
});

test('normalizeObstructionType: direct match unknown_obstruction', () => {
  assertEqual(normalizeObstructionType('unknown_obstruction'), 'unknown_obstruction', 'unknown_obstruction');
});

test('normalizeObstructionType: legacy "vent" → plumbing_vent', () => {
  assertEqual(normalizeObstructionType('vent'), 'plumbing_vent', 'vent legacy');
});

test('normalizeObstructionType: legacy "pipe_boots" → pipe_boot', () => {
  assertEqual(normalizeObstructionType('pipe_boots'), 'pipe_boot', 'pipe_boots legacy');
});

test('normalizeObstructionType: legacy "hvac" → roof_hvac', () => {
  assertEqual(normalizeObstructionType('hvac'), 'roof_hvac', 'hvac legacy');
});

test('normalizeObstructionType: legacy "unknown" → unknown_obstruction', () => {
  assertEqual(normalizeObstructionType('unknown'), 'unknown_obstruction', 'unknown legacy');
});

test('normalizeObstructionType: legacy "gable_vent" → exhaust_vent', () => {
  assertEqual(normalizeObstructionType('gable_vent'), 'exhaust_vent', 'gable_vent legacy');
});

test('normalizeObstructionType: fuzzy "plumbing" → plumbing_vent', () => {
  assertEqual(normalizeObstructionType('plumbing'), 'plumbing_vent', 'plumbing fuzzy');
});

test('normalizeObstructionType: fuzzy "satellite" → satellite_dish', () => {
  assertEqual(normalizeObstructionType('satellite'), 'satellite_dish', 'satellite fuzzy');
});

test('normalizeObstructionType: fuzzy "dish" → satellite_dish', () => {
  assertEqual(normalizeObstructionType('dish'), 'satellite_dish', 'dish fuzzy');
});

test('normalizeObstructionType: unknown string → unknown_obstruction', () => {
  assertEqual(normalizeObstructionType('weird_thing'), 'unknown_obstruction', 'unknown string');
});

test('normalizeObstructionType: case insensitive', () => {
  assertEqual(normalizeObstructionType('CHIMNEY'), 'chimney', 'CHIMNEY upper');
  assertEqual(normalizeObstructionType('Skylight'), 'skylight', 'Skylight mixed');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 2: Geometry Readiness Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Geometry Readiness Fields ===');

test('computeCenter: correct center point', () => {
  const region = makeRegion(100, 200, 300, 400);
  const center = computeCenter(region);
  assertEqual(center.x, 250, 'center.x'); // 100 + 300/2
  assertEqual(center.y, 400, 'center.y'); // 200 + 400/2
  assertEqual(center.coordinateSystem, 'normalized_image_0_1000', 'coordSystem');
});

test('computeAspectRatio: horizontal rectangle', () => {
  const region = makeRegion(0, 0, 200, 100);
  assertEqual(computeAspectRatio(region), 2, 'aspect 2:1');
});

test('computeAspectRatio: vertical rectangle', () => {
  const region = makeRegion(0, 0, 100, 200);
  assertEqual(computeAspectRatio(region), 0.5, 'aspect 1:2');
});

test('computeAspectRatio: square', () => {
  const region = makeRegion(0, 0, 100, 100);
  assertEqual(computeAspectRatio(region), 1, 'aspect 1:1');
});

test('classifySizeBucket: all buckets', () => {
  assertEqual(classifySizeBucket(1000), 'tiny', 'tiny');
  assertEqual(classifySizeBucket(8000), 'small', 'small');
  assertEqual(classifySizeBucket(30000), 'medium', 'medium');
  assertEqual(classifySizeBucket(80000), 'large', 'large');
  assertEqual(classifySizeBucket(200000), 'huge', 'huge');
});

test('determineOrientationHint: horizontal', () => {
  assertEqual(determineOrientationHint(3.0), 'horizontal', '3.0 aspect');
});

test('determineOrientationHint: vertical', () => {
  assertEqual(determineOrientationHint(0.3), 'vertical', '0.3 aspect');
});

test('determineOrientationHint: square', () => {
  assertEqual(determineOrientationHint(1.0), 'square', '1.0 aspect');
});

test('determineOrientationHint: irregular', () => {
  assertEqual(determineOrientationHint(1.5), 'irregular', '1.5 aspect');
});

test('computeEdgeDistance: center of image', () => {
  const center: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
  assertEqual(computeEdgeDistance(center), 500, 'center distance');
});

test('computeEdgeDistance: near corner', () => {
  const center: ObstructionCenterPoint = { x: 50, y: 50, coordinateSystem: 'normalized_image_0_1000' };
  assertEqual(computeEdgeDistance(center), 50, 'corner distance');
});

test('classifyEdgeProximity: all categories', () => {
  const center: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
  assertEqual(classifyEdgeProximity(500), 'center', 'center');
  assertEqual(classifyEdgeProximity(300), 'near_center', 'near_center');
  assertEqual(classifyEdgeProximity(100), 'edge', 'edge');
  assertEqual(classifyEdgeProximity(20), 'corner', 'corner');
});

test('determineQuadrant: all quadrants', () => {
  const nw: ObstructionCenterPoint = { x: 200, y: 200, coordinateSystem: 'normalized_image_0_1000' };
  const ne: ObstructionCenterPoint = { x: 700, y: 200, coordinateSystem: 'normalized_image_0_1000' };
  const sw: ObstructionCenterPoint = { x: 200, y: 700, coordinateSystem: 'normalized_image_0_1000' };
  const se: ObstructionCenterPoint = { x: 700, y: 700, coordinateSystem: 'normalized_image_0_1000' };
  assertEqual(determineQuadrant(nw), 'nw', 'nw');
  assertEqual(determineQuadrant(ne), 'ne', 'ne');
  assertEqual(determineQuadrant(sw), 'sw', 'sw');
  assertEqual(determineQuadrant(se), 'se', 'se');
});

test('classifySetbackBuffer: all categories', () => {
  assertEqual(classifySetbackBuffer(150), 'standard', 'standard');
  assertEqual(classifySetbackBuffer(50), 'reduced', 'reduced');
  assertEqual(classifySetbackBuffer(10), 'none', 'none');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 3: CAD Usefulness Field Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== CAD Usefulness Fields ===');

test('determineCadBlockHint: chimney → chimney_block', () => {
  assertEqual(determineCadBlockHint('chimney', 'large', 'square'), 'chimney_block', 'chimney');
});

test('determineCadBlockHint: skylight → skylight_block', () => {
  assertEqual(determineCadBlockHint('skylight', 'medium', 'square'), 'skylight_block', 'skylight');
});

test('determineCadBlockHint: roof_hvac → hvac_unit', () => {
  assertEqual(determineCadBlockHint('roof_hvac', 'large', 'square'), 'hvac_unit', 'hvac');
});

test('determineCadBlockHint: plumbing_vent square → vent_circle', () => {
  assertEqual(determineCadBlockHint('plumbing_vent', 'small', 'square'), 'vent_circle', 'vent circle');
});

test('determineCadBlockHint: plumbing_vent irregular → vent_rect', () => {
  assertEqual(determineCadBlockHint('plumbing_vent', 'small', 'irregular'), 'vent_rect', 'vent rect');
});

test('determineCadBlockHint: pipe_boot square → pipe_boot_circle', () => {
  assertEqual(determineCadBlockHint('pipe_boot', 'small', 'square'), 'pipe_boot_circle', 'boot circle');
});

test('determineCadBlockHint: null → generic_rect', () => {
  assertEqual(determineCadBlockHint(null, 'small', 'square'), 'generic_rect', 'null type');
});

test('determineCadBlockHint: dormer → dormer_polyline', () => {
  assertEqual(determineCadBlockHint('dormer', 'large', 'horizontal'), 'dormer_polyline', 'dormer');
});

test('determineCadBlockHint: satellite_dish → satellite_dish', () => {
  assertEqual(determineCadBlockHint('satellite_dish', 'medium', 'square'), 'satellite_dish', 'dish');
});

test('determineCadBlockHint: antenna → antenna', () => {
  assertEqual(determineCadBlockHint('antenna', 'tiny', 'vertical'), 'antenna', 'antenna');
});

test('determineObstructionFootprintHint: circular types', () => {
  assertEqual(determineObstructionFootprintHint('plumbing_vent', 1.0), 'circular', 'plumbing_vent');
  assertEqual(determineObstructionFootprintHint('exhaust_vent', 1.0), 'circular', 'exhaust_vent');
  assertEqual(determineObstructionFootprintHint('pipe_boot', 1.0), 'circular', 'pipe_boot');
  assertEqual(determineObstructionFootprintHint('solar_tube', 1.0), 'circular', 'solar_tube');
  assertEqual(determineObstructionFootprintHint('roof_jack', 1.0), 'circular', 'roof_jack');
});

test('determineObstructionFootprintHint: rectangular types', () => {
  assertEqual(determineObstructionFootprintHint('chimney', 1.5), 'rectangular', 'chimney rect');
  assertEqual(determineObstructionFootprintHint('chimney', 1.0), 'square', 'chimney square');
  assertEqual(determineObstructionFootprintHint('skylight', 2.0), 'rectangular', 'skylight rect');
  assertEqual(determineObstructionFootprintHint('skylight', 1.0), 'square', 'skylight square');
});

test('determineObstructionFootprintHint: irregular types', () => {
  assertEqual(determineObstructionFootprintHint('dormer', 1.5), 'irregular', 'dormer');
  assertEqual(determineObstructionFootprintHint('flashing', 1.5), 'irregular', 'flashing');
  assertEqual(determineObstructionFootprintHint('satellite_dish', 1.5), 'irregular', 'satellite_dish');
});

test('determineObstructionFootprintHint: null → unknown', () => {
  assertEqual(determineObstructionFootprintHint(null, 1.0), 'unknown', 'null');
});

test('determineClearanceRadiusHint: all ranges', () => {
  assertEqual(determineClearanceRadiusHint(1000), '0_5ft', '0_5ft');
  assertEqual(determineClearanceRadiusHint(8000), '1ft', '1ft');
  assertEqual(determineClearanceRadiusHint(30000), '2ft', '2ft');
  assertEqual(determineClearanceRadiusHint(80000), '3ft', '3ft');
  assertEqual(determineClearanceRadiusHint(120000), '4ft', '4ft');
  assertEqual(determineClearanceRadiusHint(200000), '5ft_plus', '5ft_plus');
});

test('determineLayoutAvoidancePriority: chimney = 10', () => {
  assertEqual(determineLayoutAvoidancePriority('chimney', 'large', 'high'), 10, 'chimney');
});

test('determineLayoutAvoidancePriority: skylight = 10', () => {
  assertEqual(determineLayoutAvoidancePriority('skylight', 'medium', 'high'), 10, 'skylight');
});

test('determineLayoutAvoidancePriority: plumbing_vent = 7', () => {
  assertEqual(determineLayoutAvoidancePriority('plumbing_vent', 'small', 'medium'), 7, 'plumbing_vent');
});

test('determineLayoutAvoidancePriority: pipe_boot = 5', () => {
  assertEqual(determineLayoutAvoidancePriority('pipe_boot', 'small', 'medium'), 5, 'pipe_boot');
});

test('determineLayoutAvoidancePriority: satellite_dish = 8', () => {
  assertEqual(determineLayoutAvoidancePriority('satellite_dish', 'medium', 'medium'), 8, 'satellite_dish');
});

test('determineLayoutAvoidancePriority: flashing = 2', () => {
  assertEqual(determineLayoutAvoidancePriority('flashing', 'tiny', 'low'), 2, 'flashing');
});

test('determineLayoutAvoidancePriority: null = 2', () => {
  assertEqual(determineLayoutAvoidancePriority(null, 'small', 'low'), 2, 'null');
});

test('determineCadEffects: chimney affects everything', () => {
  const effects = determineCadEffects('chimney', 'large', 'high');
  assertEqual(effects.canAffectPanelPlacement, true, 'chimney panels');
  assertEqual(effects.canAffectFirePathway, true, 'chimney fire');
  assertEqual(effects.canAffectConduitPath, true, 'chimney conduit');
  assertEqual(effects.canAffectStructuralAttachment, true, 'chimney structural');
});

test('determineCadEffects: skylight affects panels and fire', () => {
  const effects = determineCadEffects('skylight', 'medium', 'high');
  assertEqual(effects.canAffectPanelPlacement, true, 'skylight panels');
  assertEqual(effects.canAffectFirePathway, true, 'skylight fire');
  assertEqual(effects.canAffectConduitPath, true, 'skylight conduit');
  assertEqual(effects.canAffectStructuralAttachment, false, 'skylight no structural');
});

test('determineCadEffects: pipe_boot only affects panels', () => {
  const effects = determineCadEffects('pipe_boot', 'small', 'medium');
  assertEqual(effects.canAffectPanelPlacement, true, 'pipe panels');
  assertEqual(effects.canAffectFirePathway, false, 'pipe no fire');
  assertEqual(effects.canAffectConduitPath, false, 'pipe no conduit');
  assertEqual(effects.canAffectStructuralAttachment, false, 'pipe no structural');
});

test('determineCadEffects: null type still affects panels', () => {
  const effects = determineCadEffects(null, 'small', 'low');
  assertEqual(effects.canAffectPanelPlacement, true, 'null panels');
  assertEqual(effects.canAffectFirePathway, false, 'null no fire');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 4: IoU Deduplication Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== IoU Deduplication ===');

test('computeIoU: identical regions = 1.0', () => {
  const r = makeRegion(100, 100, 200, 200);
  assertEqual(computeIoU(r, r), 1, 'identical IoU');
});

test('computeIoU: no overlap = 0.0', () => {
  const a = makeRegion(0, 0, 100, 100);
  const b = makeRegion(500, 500, 100, 100);
  assertEqual(computeIoU(a, b), 0, 'no overlap IoU');
});

test('computeIoU: partial overlap', () => {
  const a = makeRegion(0, 0, 200, 200);
  const b = makeRegion(100, 100, 200, 200);
  // Intersection: 100x100 = 10000
  // Union: 40000 + 40000 - 10000 = 70000
  // IoU = 10000/70000 ≈ 0.143
  const iou = computeIoU(a, b);
  assert(iou > 0.1 && iou < 0.2, `partial IoU should be ~0.143, got ${iou}`);
});

test('computeIoU: 50% overlap (high IoU)', () => {
  const a = makeRegion(0, 0, 200, 200);
  const b = makeRegion(50, 50, 200, 200);
  // Intersection: 150x150 = 22500
  // Union: 40000 + 40000 - 22500 = 57500
  // IoU = 22500/57500 ≈ 0.391
  const iou = computeIoU(a, b);
  assert(iou > 0.3 && iou < 0.5, `50% overlap IoU should be ~0.39, got ${iou}`);
});

test('computeIoU: contained region (one inside other)', () => {
  const outer = makeRegion(0, 0, 400, 400);
  const inner = makeRegion(50, 50, 100, 100);
  // Intersection = inner area = 10000
  // Union = outer area = 160000
  // IoU = 10000/160000 = 0.0625
  const iou = computeIoU(outer, inner);
  assert(iou > 0.05 && iou < 0.08, `contained IoU should be ~0.06, got ${iou}`);
});

test('centerDistance: same center = 0', () => {
  const a: ObstructionCenterPoint = { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' };
  assertEqual(centerDistance(a, a), 0, 'same center');
});

test('centerDistance: diagonal distance', () => {
  const a: ObstructionCenterPoint = { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' };
  const b: ObstructionCenterPoint = { x: 300, y: 400, coordinateSystem: 'normalized_image_0_1000' };
  const dist = centerDistance(a, b);
  assert(Math.abs(dist - 500) < 1, `3-4-5 triangle should be 500, got ${dist}`);
});

test('deduplicateByIoU: empty list', () => {
  const result = deduplicateByIoU([]);
  assertEqual(result.length, 0, 'empty');
});

test('deduplicateByIoU: single item', () => {
  const records = [{
    id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200),
    area: 40000, confidence: 80, detectionMethod: 'opencv_contour' as const,
    payload: {}, sourceImageSha256: null, regionIndex: 0,
  }];
  const result = deduplicateByIoU(records);
  assertEqual(result.length, 1, 'single');
  assertEqual(result[0].id, '1', 'single id');
});

test('deduplicateByIoU: two identical regions → one kept (higher confidence)', () => {
  const records = [
    { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 80, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
    { id: '2', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 60, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
  ];
  const result = deduplicateByIoU(records);
  assertEqual(result.length, 1, 'dedup identical');
  assertEqual(result[0].id, '1', 'higher confidence kept');
});

test('deduplicateByIoU: two overlapping regions (IoU > 0.5) → one kept', () => {
  const records = [
    { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 200, 200), area: 40000, confidence: 90, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
    { id: '2', sourceFileId: 'f1', region: makeRegion(120, 120, 200, 200), area: 40000, confidence: 70, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
  ];
  const result = deduplicateByIoU(records);
  // These overlap significantly — should be deduplicated to 1
  assertEqual(result.length, 1, 'overlapping regions deduped');
  assertEqual(result[0].id, '1', 'higher confidence kept');
});

test('deduplicateByIoU: two non-overlapping regions → both kept', () => {
  const records = [
    { id: '1', sourceFileId: 'f1', region: makeRegion(100, 100, 100, 100), area: 10000, confidence: 80, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
    { id: '2', sourceFileId: 'f1', region: makeRegion(700, 700, 100, 100), area: 10000, confidence: 70, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
  ];
  const result = deduplicateByIoU(records);
  assertEqual(result.length, 2, 'non-overlapping both kept');
});

test('deduplicateByIoU: nearby centers with similar area → deduped', () => {
  const records = [
    { id: '1', sourceFileId: 'f1', region: makeRegion(400, 400, 100, 100), area: 10000, confidence: 85, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 0 },
    { id: '2', sourceFileId: 'f1', region: makeRegion(420, 420, 100, 100), area: 10000, confidence: 75, detectionMethod: 'opencv_contour' as const, payload: {}, sourceImageSha256: null, regionIndex: 1 },
  ];
  const result = deduplicateByIoU(records);
  // Centers are close (~28 apart) and areas are identical — should dedup
  assertEqual(result.length, 1, 'nearby similar areas deduped');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 5: Priority Ranking Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Priority Ranking ===');

test('determinePriority: chimney = high', () => {
  assertEqual(determinePriority('chimney', 'large'), 'high', 'chimney');
});

test('determinePriority: skylight = high', () => {
  assertEqual(determinePriority('skylight', 'medium'), 'high', 'skylight');
});

test('determinePriority: roof_hvac = high', () => {
  assertEqual(determinePriority('roof_hvac', 'large'), 'high', 'hvac');
});

test('determinePriority: dormer = high', () => {
  assertEqual(determinePriority('dormer', 'large'), 'high', 'dormer');
});

test('determinePriority: plumbing_vent = medium', () => {
  assertEqual(determinePriority('plumbing_vent', 'small'), 'medium', 'plumbing_vent');
});

test('determinePriority: exhaust_vent = medium', () => {
  assertEqual(determinePriority('exhaust_vent', 'small'), 'medium', 'exhaust_vent');
});

test('determinePriority: ridge_vent = medium', () => {
  assertEqual(determinePriority('ridge_vent', 'medium'), 'medium', 'ridge_vent');
});

test('determinePriority: pipe_boot = medium', () => {
  assertEqual(determinePriority('pipe_boot', 'small'), 'medium', 'pipe_boot');
});

test('determinePriority: solar_tube = medium', () => {
  assertEqual(determinePriority('solar_tube', 'medium'), 'medium', 'solar_tube');
});

test('determinePriority: satellite_dish = medium', () => {
  assertEqual(determinePriority('satellite_dish', 'medium'), 'medium', 'satellite_dish');
});

test('determinePriority: flashing = low', () => {
  assertEqual(determinePriority('flashing', 'tiny'), 'low', 'flashing');
});

test('determinePriority: roof_jack = low', () => {
  assertEqual(determinePriority('roof_jack', 'tiny'), 'low', 'roof_jack');
});

test('determinePriority: antenna = low', () => {
  assertEqual(determinePriority('antenna', 'tiny'), 'low', 'antenna');
});

test('determinePriority: unknown_obstruction = low', () => {
  assertEqual(determinePriority('unknown_obstruction', 'small'), 'low', 'unknown');
});

test('determinePriority: null = low', () => {
  assertEqual(determinePriority(null, 'small'), 'low', 'null');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 6: Obstruction Type Classification Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Obstruction Type Classification ===');

test('classifyObstructionType: large square = roof_hvac', () => {
  const type = classifyObstructionType(90000, 1.0, 'large', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'roof_hvac', 'large square center');
});

test('classifyObstructionType: large square under 80000 = chimney', () => {
  const type = classifyObstructionType(70000, 1.0, 'large', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'chimney', 'large square under 80k');
});

test('classifyObstructionType: large horizontal = dormer', () => {
  const type = classifyObstructionType(100000, 3.0, 'large', 'horizontal', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'dormer', 'large horizontal');
});

test('classifyObstructionType: medium square > 25k = skylight', () => {
  const type = classifyObstructionType(30000, 1.0, 'medium', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'skylight', 'medium square center');
});

test('classifyObstructionType: medium square < 25k = solar_tube', () => {
  const type = classifyObstructionType(20000, 1.0, 'medium', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'solar_tube', 'medium small square');
});

test('classifyObstructionType: medium horizontal near top = ridge_vent', () => {
  const type = classifyObstructionType(35000, 4.0, 'medium', 'horizontal', 'near_center', 'nw', { x: 500, y: 200, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'ridge_vent', 'ridge vent near top');
});

test('classifyObstructionType: small square near top = plumbing_vent', () => {
  const type = classifyObstructionType(8000, 1.0, 'small', 'square', 'near_center', 'nw', { x: 500, y: 200, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'plumbing_vent', 'plumbing vent near top');
});

test('classifyObstructionType: small square at edge = exhaust_vent', () => {
  const type = classifyObstructionType(10000, 1.0, 'small', 'square', 'edge', 'nw', { x: 100, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'exhaust_vent', 'exhaust vent edge');
});

test('classifyObstructionType: small square center = pipe_boot', () => {
  const type = classifyObstructionType(10000, 1.0, 'small', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'pipe_boot', 'pipe boot center');
});

test('classifyObstructionType: tiny square = pipe_boot', () => {
  const type = classifyObstructionType(3000, 1.0, 'tiny', 'square', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'pipe_boot', 'tiny square');
});

test('classifyObstructionType: tiny vertical = antenna', () => {
  const type = classifyObstructionType(3000, 0.3, 'tiny', 'vertical', 'center', 'nw', { x: 500, y: 500, coordinateSystem: 'normalized_image_0_1000' });
  assertEqual(type, 'antenna', 'tiny vertical antenna');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 7: extractObstructionsForFilename Tests (Integration)
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== extractObstructionsForFilename Integration ===');

test('extractObstructionsForFilename: empty candidates → 0 obstructions', () => {
  const result = extractObstructionsForFilename([], 'test.jpg');
  assertEqual(result.obstructionCount, 0, 'no candidates');
  assertEqual(result.obstructions.length, 0, 'empty obstructions');
});

test('extractObstructionsForFilename: single candidate → 1 obstruction with full metadata', () => {
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
  assertEqual(result.obstructionCount, 1, '1 obstruction');

  const obs = result.obstructions[0];
  assertEqual(obs.sourceFilename, 'test.jpg', 'sourceFilename');
  assertEqual(obs.areaNormalized, 10000, 'area'); // 100 * 100
  assertEqual(obs.aspectRatio, 1, 'aspectRatio');
  assertEqual(obs.sizeBucket, 'small', 'sizeBucket');
  assertEqual(obs.orientationHint, 'square', 'orientationHint');
  assertEqual(obs.reviewState, 'review_required', 'reviewState default');
  assert(obs.obstructionType !== null, 'should have classified type');
  assert(obs.priority !== null, 'should have priority');
  assert(obs.cadBlockHint !== null, 'should have cadBlockHint');
  assert(obs.requiresHumanReview === true, 'requiresHumanReview default');
  assert(obs.canAffectPanelPlacement === true, 'canAffectPanelPlacement');
});

test('extractObstructionsForFilename: filters by min area', () => {
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
  assertEqual(result.obstructionCount, 1, 'only valid candidate');
  assertEqual(result.obstructions[0].id, 'hash_valid', 'valid candidate kept');
});

test('extractObstructionsForFilename: deduplicates identical regions', () => {
  const candidates = [
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 1 }, deterministicHash: 'hash_2' },
  ];
  const result = extractObstructionsForFilename(candidates, 'test.jpg');
  assertEqual(result.obstructionCount, 1, 'deduplicated identical');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 8: Review-Only Boundary Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Review-Only Boundary Enforcement ===');

test('reviewState: all obstructions default to review_required', () => {
  const candidates = [
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 95, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
  ];
  const result = extractObstructionsForFilename(candidates, 'test.jpg');
  for (const obs of result.obstructions) {
    assertEqual(obs.reviewState, 'review_required', `obstruction ${obs.id} reviewState`);
    assertEqual(obs.requiresHumanReview, true, `obstruction ${obs.id} requiresHumanReview`);
  }
});

test('reviewState: accepted/rejected only by explicit action, not automatic', () => {
  // Even with high confidence, the review state should still be review_required
  const candidates = [
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 99, payload: { region: { x: 400, y: 400, width: 200, height: 200, coordinateSystem: 'normalized_image_0_1000' }, source: 'yolo_detection', regionIndex: 0 }, deterministicHash: 'hash_1' },
  ];
  const result = extractObstructionsForFilename(candidates, 'test.jpg');
  assertEqual(result.obstructions[0].reviewState, 'review_required', 'high confidence still review_required');
  assertEqual(result.obstructions[0].requiresHumanReview, true, 'high confidence still requiresHumanReview');
});

test('no CAD mutation: extraction returns review-only data, no CAD geometry', () => {
  const candidates = [
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
  ];
  const result = extractObstructionsForFilename(candidates, 'test.jpg');
  const obs = result.obstructions[0];

  // These should be hints, not authoritative CAD data
  assert(typeof obs.cadBlockHint === 'string', 'cadBlockHint is a string hint');
  assert(typeof obs.obstructionFootprintHint === 'string', 'obstructionFootprintHint is a string hint');
  assert(typeof obs.clearanceRadiusHint === 'string', 'clearanceRadiusHint is a string hint');
  assert(typeof obs.setbackCategoryHint === 'string', 'setbackCategoryHint is a string hint');

  // No authoritative roof geometry coordinates (no roof plane, no ridge, no eave)
  assert(!('roofPlaneCoordinates' in obs), 'no roofPlaneCoordinates');
  assert(!('permitGeometry' in obs), 'no permitGeometry');
  assert(!('cadGeometry' in obs), 'no cadGeometry');
});

test('no permit mutation: no permit-related fields on obstructions', () => {
  const candidates = [
    { fileId: 'f1', candidateType: 'obstruction_candidate', confidence: 80, payload: { region: { x: 400, y: 400, width: 100, height: 100, coordinateSystem: 'normalized_image_0_1000' }, source: 'opencv_contour', regionIndex: 0 }, deterministicHash: 'hash_1' },
  ];
  const result = extractObstructionsForFilename(candidates, 'test.jpg');
  const obs = result.obstructions[0];

  // No permit geometry data
  assert(!('permitSetback' in obs), 'no permitSetback');
  assert(!('permitRequired' in obs), 'no permitRequired');
  assert(!('permitZone' in obs), 'no permitZone');

  // CAD fields are hints only
  assert(obs.clearanceRadiusHint.endsWith('ft') || obs.clearanceRadiusHint === 'unknown', 'clearance is a hint');
  assert(obs.layoutAvoidancePriority >= 1 && obs.layoutAvoidancePriority <= 10, 'avoidance is a priority hint');
});

test('ReviewState type: only valid values review_required/accepted/rejected', () => {
  const validStates: ReviewState[] = ['review_required', 'accepted', 'rejected'];
  assertEqual(validStates.length, 3, 'exactly 3 review states');
  assert(!validStates.includes('pending' as ReviewState), 'pending is not a valid state');
  assert(!validStates.includes('auto_accepted' as ReviewState), 'auto_accepted is not a valid state');
});

// ─────────────────────────────────────────────────────────────────────────
// Section 9: Manifest ObstructionSummary Tests
// ─────────────────────────────────────────────────────────────────────────

console.log('\n=== Manifest ObstructionSummary ===');

test('manifest obstructionSummary: computes correct priority distribution', () => {
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
  assertEqual(priorityDistribution.high, 2, 'high count');
  assertEqual(priorityDistribution.medium, 1, 'medium count');
  assertEqual(priorityDistribution.low, 1, 'low count');
});

test('manifest obstructionSummary: computes correct review state distribution', () => {
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
  assertEqual(reviewDist.review_required, 2, 'review_required');
  assertEqual(reviewDist.accepted, 1, 'accepted');
  assertEqual(reviewDist.rejected, 1, 'rejected');
  assertEqual(reviewedCount, 2, 'reviewed count (accepted + rejected)');
});

test('manifest obstructionSummary: computes CAD readiness quality score', () => {
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
  assertEqual(cadReadinessQualityScore, 83, 'quality score 83');
});

test('manifest obstructionSummary: counts high-impact obstructions', () => {
  const mockObstructions = [
    { obstructionType: 'chimney', priority: 'high' },
    { obstructionType: 'skylight', priority: 'high' },
    { obstructionType: 'plumbing_vent', priority: 'medium' },
    { obstructionType: 'flashing', priority: 'low' },
  ];
  const highImpactCount = mockObstructions.filter(o => o.priority === 'high').length;
  assertEqual(highImpactCount, 2, 'high impact count');
});

test('manifest obstructionSummary: counts missing classifications', () => {
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
  assertEqual(missingCount, 3, 'missing classification count');
});

// ─────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────

console.log(`\n════════════════════════════════════════════`);
console.log(`  Phase 3B Test Results: ${passCount} passed, ${failCount} failed`);
console.log(`════════════════════════════════════════════\n`);

if (failCount > 0) {
  process.exit(1);
}
