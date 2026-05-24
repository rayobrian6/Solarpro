import polygonClipping from 'polygon-clipping';

import type { CanonicalSurveyGeometryV1, ProfessionalSurveyAuthorityFlagsV1 } from './professionalSurveyParser';

export type GeometryComparisonSeverity = 'info' | 'warning' | 'error';
export type GeometryComparisonReadinessImpact = 'none' | 'review_recommended' | 'would_block_native_if_authoritative';
export type GeometryDiscrepancyCategory =
  | 'overlap_mismatch'
  | 'self_intersection_disagreement'
  | 'clipping_disagreement'
  | 'polygon_validity_disagreement'
  | 'duplicate_edge_disagreement'
  | 'topology_confidence_degradation';

export interface GeometryComparisonPolygonInput {
  id: string;
  points: Array<{ x: number; y: number }>;
  nativeSelfIntersecting?: boolean;
  nativeValid?: boolean;
}

export interface GeometryAdapterObservationV1 {
  category: GeometryDiscrepancyCategory;
  affectedGeometryEntities: string[];
  comparisonSummary: string;
  severity: GeometryComparisonSeverity;
  readinessImpact: GeometryComparisonReadinessImpact;
  recommendedReviewAction: string;
}

export interface PolygonTopologyComparisonV1 {
  polygonId: string;
  vertexCount: number;
  signedArea: number;
  absoluteArea: number;
  nativeValid: boolean | null;
  ossValid: boolean;
  nativeSelfIntersecting: boolean | null;
  ossSelfIntersecting: boolean;
  duplicateEdgeCount: number;
  duplicateVertexCount: number;
  ringClosedForOss: boolean;
  warnings: string[];
}

export interface PolygonPairComparisonV1 {
  pairId: string;
  polygonIds: [string, string];
  nativeOverlapExpected: boolean;
  ossIntersectionArea: number;
  ossOverlaps: boolean;
  clippingProducedGeometry: boolean;
  warnings: string[];
}

export interface GeometryComparisonReportV1 {
  schemaVersion: 'geometry_comparison_report_v1';
  adapterName: 'polygon_clipping_geometry_comparison_adapter';
  adapterVersion: '0.1.0-comparison-only';
  packageName: 'polygon-clipping';
  packageVersion: '0.15.7';
  mode: 'comparison_only';
  sourceGeometryHash: string;
  inputHash: string;
  resultHash: string;
  executionMs: number;
  polygonCount: number;
  comparisons: PolygonTopologyComparisonV1[];
  pairComparisons: PolygonPairComparisonV1[];
  observations: GeometryAdapterObservationV1[];
  nativeGeometryResult: {
    readyForCADInput: boolean;
    blockingIssues: string[];
    warnings: string[];
  };
  ossComparisonResult: {
    invalidPolygonCount: number;
    selfIntersectingPolygonCount: number;
    duplicateEdgePolygonCount: number;
    overlappingPairCount: number;
    clippingFailureCount: number;
  };
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  deterministicNotes: string[];
}

const NO_AUTHORITY_FLAGS: ProfessionalSurveyAuthorityFlagsV1 = {
  persistenceAllowed: false,
  solverExecutionAllowed: false,
  cadMutationAllowed: false,
  canonicalGeometryMutationAllowed: false,
  engineeringAuthorityAllowed: false,
  necAuthorityAllowed: false,
  bomAuthorityAllowed: false,
  permitAuthorityAllowed: false,
  downstreamAuthority: false,
};

const EPSILON = 1e-9;
const MIN_MEANINGFUL_AREA_M2 = 1e-6;

type Ring = Array<[number, number]>;
type Polygon = Ring[];
type MultiPolygon = Polygon[];

export function buildGeometryComparisonReport(geometry: CanonicalSurveyGeometryV1): GeometryComparisonReportV1 {
  const start = performance.now();
  const polygons: GeometryComparisonPolygonInput[] = geometry.roofPlanes.map(plane => ({
    id: plane.planeId,
    points: plane.polygon.map(point => ({ ...point })),
    nativeSelfIntersecting: plane.issues.some(issue => issue.toLowerCase().includes('self-intersects')),
    nativeValid: plane.valid,
  }));

  const comparisons = polygons.map(comparePolygonTopology);
  const pairComparisons = comparePolygonPairs(polygons);
  const observations = buildObservations(comparisons, pairComparisons);
  const withoutHashesAndTiming = {
    schemaVersion: 'geometry_comparison_report_v1' as const,
    adapterName: 'polygon_clipping_geometry_comparison_adapter' as const,
    adapterVersion: '0.1.0-comparison-only' as const,
    packageName: 'polygon-clipping' as const,
    packageVersion: '0.15.7' as const,
    mode: 'comparison_only' as const,
    sourceGeometryHash: geometry.geometryHash,
    polygonCount: polygons.length,
    comparisons,
    pairComparisons,
    observations,
    nativeGeometryResult: {
      readyForCADInput: geometry.readyForCADInput,
      blockingIssues: [...geometry.blockingIssues],
      warnings: [...geometry.warnings],
    },
    ossComparisonResult: {
      invalidPolygonCount: comparisons.filter(comparison => !comparison.ossValid).length,
      selfIntersectingPolygonCount: comparisons.filter(comparison => comparison.ossSelfIntersecting).length,
      duplicateEdgePolygonCount: comparisons.filter(comparison => comparison.duplicateEdgeCount > 0).length,
      overlappingPairCount: pairComparisons.filter(comparison => comparison.ossOverlaps).length,
      clippingFailureCount: pairComparisons.filter(comparison => comparison.warnings.some(warning => warning.includes('failed'))).length,
    },
    authorityFlags: NO_AUTHORITY_FLAGS,
    deterministicNotes: [
      'Geometry comparison report is read-only and non-authoritative.',
      'SolarPro native geometry, readiness, engineering, permit, BOM, and CAD authority remain primary.',
      'polygon-clipping output is used only for topology comparison, discrepancy reporting, and review warnings.',
      'The adapter does not mutate canonical geometry, CAD preview inputs, parser DTOs, persistence, or readiness states.',
    ],
  };
  const inputHash = deterministicHash({ sourceGeometryHash: geometry.geometryHash, polygons });
  const resultHash = deterministicHash({ ...withoutHashesAndTiming, inputHash });

  return {
    ...withoutHashesAndTiming,
    inputHash,
    resultHash,
    executionMs: Number((performance.now() - start).toFixed(3)),
  };
}

export function comparePolygonTopology(polygon: GeometryComparisonPolygonInput): PolygonTopologyComparisonV1 {
  const points = polygon.points.map(point => ({ ...point }));
  const signedArea = polygonArea(points);
  const absoluteArea = Math.abs(signedArea);
  const nativeSelfIntersecting = polygon.nativeSelfIntersecting ?? null;
  const nativeValid = polygon.nativeValid ?? null;
  const ossSelfIntersecting = hasPolygonSelfIntersection(points);
  const duplicateEdgeCount = countDuplicateEdges(points);
  const duplicateVertexCount = countDuplicateVertices(points);
  const ring = toClosedRing(points);
  const warnings: string[] = [];

  if (points.length < 3) warnings.push('Polygon has fewer than three vertices.');
  if (absoluteArea <= MIN_MEANINGFUL_AREA_M2) warnings.push('Polygon area is zero or nearly zero.');
  if (ossSelfIntersecting) warnings.push('Adapter detected polygon self-intersection.');
  if (duplicateEdgeCount > 0) warnings.push('Adapter detected duplicate polygon edges.');
  if (duplicateVertexCount > 0) warnings.push('Adapter detected duplicate polygon vertices.');

  const ossValid = points.length >= 3 && absoluteArea > MIN_MEANINGFUL_AREA_M2 && !ossSelfIntersecting && duplicateEdgeCount === 0;

  return {
    polygonId: polygon.id,
    vertexCount: points.length,
    signedArea,
    absoluteArea,
    nativeValid,
    ossValid,
    nativeSelfIntersecting,
    ossSelfIntersecting,
    duplicateEdgeCount,
    duplicateVertexCount,
    ringClosedForOss: ring.length > 0 && sameCoordinate(ring[0], ring[ring.length - 1]),
    warnings: dedupe(warnings),
  };
}

export function comparePolygonPairs(polygons: GeometryComparisonPolygonInput[]): PolygonPairComparisonV1[] {
  const comparisons: PolygonPairComparisonV1[] = [];
  for (let firstIndex = 0; firstIndex < polygons.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < polygons.length; secondIndex += 1) {
      const first = polygons[firstIndex];
      const second = polygons[secondIndex];
      const warnings: string[] = [];
      let intersectionArea = 0;
      let producedGeometry = false;
      try {
        const intersection = polygonClipping.intersection(toMultiPolygon(first.points), toMultiPolygon(second.points));
        producedGeometry = multiPolygonRingCount(intersection as MultiPolygon) > 0;
        intersectionArea = multiPolygonArea(intersection as MultiPolygon);
      } catch (error) {
        warnings.push(`polygon-clipping intersection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const nativeOverlapExpected = boundingBoxesOverlap(first.points, second.points) && !hasPolygonSelfIntersection(first.points) && !hasPolygonSelfIntersection(second.points);
      comparisons.push({
        pairId: `${first.id}__${second.id}`,
        polygonIds: [first.id, second.id],
        nativeOverlapExpected,
        ossIntersectionArea: intersectionArea,
        ossOverlaps: intersectionArea > EPSILON,
        clippingProducedGeometry: producedGeometry,
        warnings: dedupe(warnings),
      });
    }
  }
  return comparisons;
}

function buildObservations(comparisons: PolygonTopologyComparisonV1[], pairComparisons: PolygonPairComparisonV1[]): GeometryAdapterObservationV1[] {
  const observations: GeometryAdapterObservationV1[] = [];
  for (const comparison of comparisons) {
    if (comparison.nativeSelfIntersecting !== null && comparison.nativeSelfIntersecting !== comparison.ossSelfIntersecting) {
      observations.push({
        category: 'self_intersection_disagreement',
        affectedGeometryEntities: [comparison.polygonId],
        comparisonSummary: `Native self-intersection=${comparison.nativeSelfIntersecting}; adapter self-intersection=${comparison.ossSelfIntersecting}.`,
        severity: 'warning',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Review polygon vertex ordering and segment intersections before using CAD preview.',
      });
    }
    if (comparison.nativeValid !== null && comparison.nativeValid !== comparison.ossValid) {
      observations.push({
        category: 'polygon_validity_disagreement',
        affectedGeometryEntities: [comparison.polygonId],
        comparisonSummary: `Native valid=${comparison.nativeValid}; adapter valid=${comparison.ossValid}.`,
        severity: comparison.ossValid ? 'warning' : 'error',
        readinessImpact: comparison.ossValid ? 'review_recommended' : 'would_block_native_if_authoritative',
        recommendedReviewAction: 'Compare native canonical issues against adapter topology warnings; do not auto-correct geometry.',
      });
    }
    if (comparison.duplicateEdgeCount > 0) {
      observations.push({
        category: 'duplicate_edge_disagreement',
        affectedGeometryEntities: [comparison.polygonId],
        comparisonSummary: `Adapter detected ${comparison.duplicateEdgeCount} duplicate edge(s); native parser has no duplicate-edge authority check today.`,
        severity: 'warning',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Ask reviewer to inspect duplicated roof-plane path segments and field capture trace.',
      });
    }
    if (comparison.warnings.length > 0 && comparison.nativeValid === true) {
      observations.push({
        category: 'topology_confidence_degradation',
        affectedGeometryEntities: [comparison.polygonId],
        comparisonSummary: `Adapter emitted topology warnings while native geometry is valid: ${comparison.warnings.join(' ')}`,
        severity: 'warning',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Treat CAD preview as review-only and verify geometry trace before downstream use.',
      });
    }
  }

  for (const pair of pairComparisons) {
    if (pair.nativeOverlapExpected !== pair.ossOverlaps) {
      observations.push({
        category: 'overlap_mismatch',
        affectedGeometryEntities: pair.polygonIds,
        comparisonSummary: `Native bounding-box overlap heuristic=${pair.nativeOverlapExpected}; adapter polygon intersection=${pair.ossOverlaps} with area ${pair.ossIntersectionArea.toFixed(6)} m².`,
        severity: 'info',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Use adapter output as a review hint only; native geometry remains authoritative.',
      });
    }
    if (pair.warnings.length > 0) {
      observations.push({
        category: 'clipping_disagreement',
        affectedGeometryEntities: pair.polygonIds,
        comparisonSummary: pair.warnings.join(' '),
        severity: 'warning',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Review polygon clipping failure and avoid automated topology normalization.',
      });
    }
    if (pair.ossOverlaps) {
      observations.push({
        category: 'clipping_disagreement',
        affectedGeometryEntities: pair.polygonIds,
        comparisonSummary: `Adapter found polygon intersection area ${pair.ossIntersectionArea.toFixed(6)} m² between roof planes.`,
        severity: 'warning',
        readinessImpact: 'review_recommended',
        recommendedReviewAction: 'Inspect roof-plane duplication/overlap before trusting preview layout assumptions.',
      });
    }
  }

  return dedupeObservations(observations);
}

function toMultiPolygon(points: Array<{ x: number; y: number }>): MultiPolygon {
  return [[toClosedRing(points)]];
}

function toClosedRing(points: Array<{ x: number; y: number }>): Ring {
  if (points.length === 0) return [];
  const ring: Ring = points.map(point => [roundCoordinate(point.x), roundCoordinate(point.y)]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!sameCoordinate(first, last)) ring.push([first[0], first[1]]);
  return ring;
}

function multiPolygonArea(multiPolygon: MultiPolygon): number {
  let area = 0;
  for (const polygon of multiPolygon) {
    for (const [ringIndex, ring] of polygon.entries()) {
      const ringArea = Math.abs(ringAreaSigned(ring));
      area += ringIndex === 0 ? ringArea : -ringArea;
    }
  }
  return Math.max(0, area);
}

function multiPolygonRingCount(multiPolygon: MultiPolygon): number {
  return multiPolygon.reduce((count, polygon) => count + polygon.length, 0);
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  return ringAreaSigned(points.map(point => [point.x, point.y]));
}

function ringAreaSigned(ring: Ring): number {
  if (ring.length < 3) return 0;
  let area = 0;
  const length = sameCoordinate(ring[0], ring[ring.length - 1]) ? ring.length - 1 : ring.length;
  for (let index = 0; index < length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function hasPolygonSelfIntersection(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-12) return false;
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  return lambda > 0 && lambda < 1 && gamma > 0 && gamma < 1;
}

function countDuplicateEdges(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const forward = `${pointKey(current)}>${pointKey(next)}`;
    const reverse = `${pointKey(next)}>${pointKey(current)}`;
    if (seen.has(forward) || seen.has(reverse)) duplicates += 1;
    seen.add(forward);
  }
  return duplicates;
}

function countDuplicateVertices(points: Array<{ x: number; y: number }>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function boundingBoxesOverlap(first: Array<{ x: number; y: number }>, second: Array<{ x: number; y: number }>): boolean {
  const a = bounds(first);
  const b = bounds(second);
  if (!a || !b) return false;
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function bounds(points: Array<{ x: number; y: number }>): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (points.length === 0) return null;
  return points.reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    maxX: Math.max(acc.maxX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxY: Math.max(acc.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function sameCoordinate(first: [number, number], second: [number, number]): boolean {
  return Math.abs(first[0] - second[0]) <= EPSILON && Math.abs(first[1] - second[1]) <= EPSILON;
}

function pointKey(point: { x: number; y: number }): string {
  return `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(9));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeObservations(observations: GeometryAdapterObservationV1[]): GeometryAdapterObservationV1[] {
  const seen = new Set<string>();
  return observations.filter(observation => {
    const key = `${observation.category}|${observation.affectedGeometryEntities.join(',')}|${observation.comparisonSummary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function deterministicHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
