import { describe, expect, it } from 'vitest';

import { enrichSurvey } from './enrichSurvey';
import { buildGeometryComparisonReport, comparePolygonPairs, comparePolygonTopology } from './geometryComparisonAdapter';
import { normalizeSurvey } from './normalizeSurvey';
import { buildCanonicalSurveyGeometry, buildSurveyCADReadiness, parseProfessionalSiteSurvey } from './professionalSurveyParser';
import type { RawSurveyPayload } from './types';

function rectangle(lat: number, lng: number, latDelta: number, lngDelta: number) {
  return [
    { lat, lng },
    { lat: lat + latDelta, lng },
    { lat: lat + latDelta, lng: lng - lngDelta },
    { lat, lng: lng - lngDelta },
  ];
}

function baseRaw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'geometry-adapter-base-001',
    projectId: 'geometry-adapter-project-001',
    location: { lat: 34.05, lng: -118.24, elevation: 300, address: '123 Adapter Test Way' },
    systemType: 'roof',
    geometry: {
      roofPlanes: [
        { id: 'roof-a', pitch: 22, azimuth: 180, area: 850, vertices: rectangle(34.05, -118.24, 0.00022, 0.00042) },
      ],
      obstructions: [],
      setbacks: [],
      usableAreaSqFt: 600,
    },
    structural: { roofMaterial: 'composition_shingle', roofPitch: '5/12' },
    electrical: { mainPanelRatingAmps: 200, interconnectionPoint: 'main_panel' },
    photos: [],
    installerNotes: 'Geometry adapter test fixture.',
    surveyedAt: '2026-05-20T10:00:00Z',
    ...overrides,
  };
}

function reportFor(raw: RawSurveyPayload) {
  const normalized = normalizeSurvey(raw);
  const enriched = enrichSurvey(normalized);
  const bundle = parseProfessionalSiteSurvey(enriched);
  const geometry = buildCanonicalSurveyGeometry(enriched, bundle);
  const readiness = buildSurveyCADReadiness(enriched, bundle, geometry);
  const report = buildGeometryComparisonReport(geometry);
  return { normalized, enriched, bundle, geometry, readiness, report };
}

describe('geometryComparisonAdapter comparison-only spike', () => {
  it('emits deterministic non-authoritative report for clean native geometry without mutating parser outputs', () => {
    const { geometry, readiness, report } = reportFor(baseRaw());
    const geometryBefore = JSON.stringify(geometry);
    const readinessBefore = JSON.stringify(readiness);
    const repeated = buildGeometryComparisonReport(geometry);

    expect(report.schemaVersion).toBe('geometry_comparison_report_v1');
    expect(report.mode).toBe('comparison_only');
    expect(report.packageName).toBe('polygon-clipping');
    expect(report.sourceGeometryHash).toBe(geometry.geometryHash);
    expect(report.inputHash).toBe(repeated.inputHash);
    expect(report.resultHash).toBe(repeated.resultHash);
    expect(report.polygonCount).toBe(1);
    expect(report.ossComparisonResult.invalidPolygonCount).toBe(0);
    expect(report.ossComparisonResult.overlappingPairCount).toBe(0);
    expect(report.authorityFlags).toEqual({
      persistenceAllowed: false,
      solverExecutionAllowed: false,
      cadMutationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      engineeringAuthorityAllowed: false,
      necAuthorityAllowed: false,
      bomAuthorityAllowed: false,
      permitAuthorityAllowed: false,
      downstreamAuthority: false,
    });
    expect(JSON.stringify(geometry)).toBe(geometryBefore);
    expect(JSON.stringify(readiness)).toBe(readinessBefore);
    expect(readiness.readinessStatus).toBe('cad_ready');
  });

  it('detects overlapping roof planes as review-only clipping observations without readiness promotion or mutation', () => {
    const raw = baseRaw({
      id: 'geometry-adapter-overlap-001',
      geometry: {
        roofPlanes: [
          { id: 'roof-overlap-a', pitch: 22, azimuth: 180, area: 850, vertices: rectangle(34.05, -118.24, 0.00022, 0.00042) },
          { id: 'roof-overlap-b', pitch: 22, azimuth: 180, area: 850, vertices: rectangle(34.0501, -118.2401, 0.00022, 0.00042) },
        ],
        obstructions: [],
        setbacks: [],
        usableAreaSqFt: 600,
      },
    });
    const { readiness, report } = reportFor(raw);

    expect(readiness.readinessStatus).toBe('cad_ready');
    expect(report.ossComparisonResult.overlappingPairCount).toBe(1);
    expect(report.pairComparisons[0].ossIntersectionArea).toBeGreaterThan(0);
    expect(report.observations.some(observation => observation.category === 'clipping_disagreement')).toBe(true);
    expect(report.observations.every(observation => observation.readinessImpact !== 'none')).toBe(true);
    expect(readiness.readinessStatus).toBe('cad_ready');
  });

  it('preserves native self-intersection blocking while reporting adapter topology agreement', () => {
    const raw = baseRaw({
      id: 'geometry-adapter-bowtie-001',
      geometry: {
        roofPlanes: [
          {
            id: 'bowtie',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.0500, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2404 },
              { lat: 34.0502, lng: -118.2400 },
              { lat: 34.0500, lng: -118.2404 },
            ],
          },
        ],
        obstructions: [],
        setbacks: [],
        usableAreaSqFt: 600,
      },
    });
    const { readiness, report } = reportFor(raw);

    expect(readiness.readinessStatus).toBe('blocked');
    expect(report.ossComparisonResult.selfIntersectingPolygonCount).toBe(1);
    expect(report.comparisons[0]).toMatchObject({
      polygonId: 'bowtie',
      nativeSelfIntersecting: true,
      ossSelfIntersecting: true,
      ossValid: false,
    });
    expect(report.observations.some(observation => observation.category === 'self_intersection_disagreement')).toBe(false);
  });

  it('detects duplicate edge/path degradation even when native geometry remains primary', () => {
    const comparison = comparePolygonTopology({
      id: 'duplicate-edge-local',
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 2 },
      ],
      nativeValid: true,
      nativeSelfIntersecting: false,
    });

    expect(comparison.duplicateEdgeCount).toBeGreaterThan(0);
    expect(comparison.ossValid).toBe(false);
    expect(comparison.warnings.join('\n')).toContain('duplicate polygon edges');
  });

  it('separates bounding-box overlap false positives from polygon-clipping intersection results', () => {
    const comparisons = comparePolygonPairs([
      {
        id: 'l-shape-a',
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 3 },
          { x: 0, y: 3 },
        ],
      },
      {
        id: 'corner-gap-b',
        points: [
          { x: 1.2, y: 1.2 },
          { x: 2.8, y: 1.2 },
          { x: 2.8, y: 2.8 },
          { x: 1.2, y: 2.8 },
        ],
      },
    ]);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].nativeOverlapExpected).toBe(true);
    expect(comparisons[0].ossOverlaps).toBe(false);
    expect(comparisons[0].ossIntersectionArea).toBe(0);
  });

  it('surfaces zero-area projected geometry as adapter-only integrity degradation without changing native readiness', () => {
    const raw = baseRaw({
      id: 'geometry-adapter-corrupted-001',
      geometry: {
        roofPlanes: [
          {
            id: 'zero-area-line',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.0500, lng: -118.2400 },
              { lat: 34.0501, lng: -118.2401 },
              { lat: 34.0502, lng: -118.2402 },
            ],
          },
        ],
        obstructions: [
          {
            id: 'malformed-obstruction-note-only',
            type: 'other',
            position: { lat: 34.05, lng: -118.24 },
            dimensions: { widthFt: 0, lengthFt: 0, heightFt: 0 },
            notes: 'Malformed obstruction polygon was unavailable in source payload.',
          },
        ],
        setbacks: [],
        usableAreaSqFt: null,
      },
    });
    const { readiness, report } = reportFor(raw);

    expect(readiness.readinessStatus).toBe('cad_ready');
    expect(report.nativeGeometryResult.readyForCADInput).toBe(true);
    expect(report.ossComparisonResult.invalidPolygonCount).toBe(1);
    expect(report.comparisons[0].warnings.join('\n')).toContain('zero or nearly zero');
    expect(report.observations.some(observation => observation.category === 'polygon_validity_disagreement')).toBe(true);
  });
});
