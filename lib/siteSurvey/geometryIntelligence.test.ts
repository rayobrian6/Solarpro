import { describe, expect, it } from 'vitest';

import { enrichSurvey } from './enrichSurvey';
import { buildGeometryComparisonReport, comparePolygonPairs, comparePolygonTopology } from './geometryComparisonAdapter';
import { buildGeometryIntelligenceReport } from './geometryIntelligence';
import { normalizeSurvey } from './normalizeSurvey';
import { professionalExpandedSurveyFixtures } from './professionalSurveyExpandedFixtures';
import { buildCanonicalSurveyGeometry, buildSurveyCADReadiness, parseProfessionalSiteSurvey } from './professionalSurveyParser';
import type { RawSurveyPayload } from './types';

function raw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'geometry-intel-001',
    projectId: 'geometry-intel-project',
    location: { lat: 34.05, lng: -118.24, address: '123 Intelligence Way' },
    systemType: 'roof',
    geometry: {
      roofPlanes: [
        {
          id: 'roof-a',
          pitch: 22,
          azimuth: 180,
          area: 850,
          vertices: [
            { lat: 34.05, lng: -118.24 },
            { lat: 34.0502, lng: -118.24 },
            { lat: 34.0502, lng: -118.2404 },
            { lat: 34.05, lng: -118.2404 },
          ],
        },
      ],
      obstructions: [],
      setbacks: [{ edges: ['eave'], distanceIn: 36 }],
      usableAreaSqFt: 620,
    },
    structural: {
      rafterSpacingIn: 24,
      rafterSize: '2x6',
      deckingThicknessIn: 0.5,
      windExposure: 'C',
      roofCondition: 'good',
      roofAgeYears: 8,
      atticAccess: true,
      roofMaterial: 'composition_shingle',
      roofPitch: '5/12',
    },
    electrical: {
      mainPanelRatingAmps: 200,
      busbarRatingAmps: 200,
      breakerSpacesAvailable: '5+',
      serviceEntrance: 'overhead',
      meterType: 'standard',
      interconnectionPoint: 'main_panel',
      panelBrand: 'siemens',
      hasSubPanel: false,
    },
    photos: [{ slotKey: 'roof', url: 'https://cdn.example.test/roof.jpg', category: 'roof' }],
    installerNotes: 'Geometry intelligence test fixture.',
    inspectorName: 'Geometry Intelligence Tech',
    surveyedAt: '2026-05-30T10:00:00Z',
    ...overrides,
  };
}

function intelligenceFor(input: RawSurveyPayload) {
  const normalized = normalizeSurvey(input);
  const enriched = enrichSurvey(normalized);
  const evidence = parseProfessionalSiteSurvey(enriched);
  const canonicalGeometry = buildCanonicalSurveyGeometry(enriched, evidence);
  const cadReadiness = buildSurveyCADReadiness(enriched, evidence, canonicalGeometry);
  const comparisonReport = buildGeometryComparisonReport(canonicalGeometry);
  const intelligence = buildGeometryIntelligenceReport({ evidence, canonicalGeometry, cadReadiness, comparisonReport });
  return { normalized, enriched, evidence, canonicalGeometry, cadReadiness, comparisonReport, intelligence };
}

describe('Geometry Intelligence V1', () => {
  it('produces deterministic high-trust review intelligence for clean geometry without authority promotion', () => {
    const result = intelligenceFor(raw());
    const repeated = intelligenceFor(raw());
    const geometryBefore = JSON.stringify(result.canonicalGeometry);
    const readinessBefore = JSON.stringify(result.cadReadiness);
    const after = buildGeometryIntelligenceReport({
      evidence: result.evidence,
      canonicalGeometry: result.canonicalGeometry,
      cadReadiness: result.cadReadiness,
      comparisonReport: result.comparisonReport,
    });

    expect(result.intelligence.schemaVersion).toBe('geometry_intelligence_v1');
    expect(result.intelligence.intelligenceHash).toBe(repeated.intelligence.intelligenceHash);
    expect(after.intelligenceHash).toBe(result.intelligence.intelligenceHash);
    expect(result.intelligence.classification.geometryRisk).toBe('low');
    expect(result.intelligence.classification.reviewUrgency).toBe('none');
    expect(result.intelligence.scores.geometryConfidenceScore).toBeGreaterThanOrEqual(90);
    expect(result.intelligence.scores.topologyIntegrityScore).toBeGreaterThanOrEqual(90);
    expect(result.intelligence.noAuthorityEnforcement).toEqual({
      readOnly: true,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      readinessPromotionAllowed: false,
      engineeringAuthorityAllowed: false,
    });
    expect(result.intelligence.authorityFlags.downstreamAuthority).toBe(false);
    expect(JSON.stringify(result.canonicalGeometry)).toBe(geometryBefore);
    expect(JSON.stringify(result.cadReadiness)).toBe(readinessBefore);
  });

  it('scores overlapping geometry as discrepancy intelligence without changing native readiness', () => {
    const fixture = raw({
      id: 'geometry-intel-overlap-001',
      geometry: {
        ...raw().geometry,
        roofPlanes: [
          raw().geometry.roofPlanes[0],
          {
            id: 'roof-b-overlap',
            pitch: 22,
            azimuth: 180,
            area: 700,
            vertices: [
              { lat: 34.0501, lng: -118.2402 },
              { lat: 34.0503, lng: -118.2402 },
              { lat: 34.0503, lng: -118.2405 },
              { lat: 34.0501, lng: -118.2405 },
            ],
          },
        ],
      },
    });
    const { cadReadiness, comparisonReport, intelligence } = intelligenceFor(fixture);

    expect(cadReadiness.readinessStatus).toBe('cad_ready');
    expect(comparisonReport.ossComparisonResult.overlappingPairCount).toBe(1);
    expect(intelligence.classification.geometryRisk).not.toBe('low');
    expect(intelligence.classification.reviewUrgency).toBe('routine_review');
    expect(intelligence.risks.some(risk => risk.category === 'overlapping_geometry')).toBe(true);
    expect(intelligence.discrepancyClusters.length).toBeGreaterThan(0);
  });

  it('classifies self-intersecting and unsupported polygon structures as blocker review', () => {
    const { cadReadiness, intelligence } = intelligenceFor(raw({
      id: 'geometry-intel-bowtie-001',
      geometry: {
        ...raw().geometry,
        roofPlanes: [
          {
            id: 'bowtie',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.05, lng: -118.24 },
              { lat: 34.0502, lng: -118.2404 },
              { lat: 34.0502, lng: -118.24 },
              { lat: 34.05, lng: -118.2404 },
            ],
          },
        ],
      },
    }));

    expect(cadReadiness.readinessStatus).toBe('blocked');
    expect(intelligence.classification.geometryRisk).toBe('critical');
    expect(intelligence.classification.reviewUrgency).toBe('blocker_review');
    expect(intelligence.risks.some(risk => risk.category === 'unsupported_polygon_structures')).toBe(true);
    expect(intelligence.scores.readinessTrustScore).toBeLessThan(60);
  });

  it('captures duplicate edge and near-zero projection risks as explainable topology degradation', () => {
    const duplicate = comparePolygonTopology({
      id: 'duplicate-edge-direct',
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
      nativeValid: true,
      nativeSelfIntersecting: false,
    });
    expect(duplicate.duplicateEdgeCount).toBeGreaterThan(0);

    const nearZero = intelligenceFor(raw({
      id: 'geometry-intel-near-zero-001',
      geometry: {
        ...raw().geometry,
        roofPlanes: [
          {
            id: 'near-zero',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.05, lng: -118.24 },
              { lat: 34.0500000001, lng: -118.2400000001 },
              { lat: 34.0500000002, lng: -118.2400000002 },
            ],
          },
        ],
      },
    })).intelligence;

    expect(nearZero.risks.some(risk => risk.category === 'near_zero_geometry_projections')).toBe(true);
    expect(nearZero.classification.geometryRisk).not.toBe('low');
  });

  it('tracks likely native false positives and missing evidence downgrade patterns', () => {
    const pairComparisons = comparePolygonPairs([
      {
        id: 'l-shape',
        nativeValid: true,
        nativeSelfIntersecting: false,
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
        id: 'corner-gap',
        nativeValid: true,
        nativeSelfIntersecting: false,
        points: [
          { x: 1.4, y: 1.4 },
          { x: 2.6, y: 1.4 },
          { x: 2.6, y: 2.6 },
          { x: 1.4, y: 2.6 },
        ],
      },
    ]);
    expect(pairComparisons[0].nativeOverlapExpected).toBe(true);
    expect(pairComparisons[0].ossOverlaps).toBe(false);

    const missingEvidence = intelligenceFor(raw({
      id: 'geometry-intel-missing-evidence-001',
      electrical: {},
      structural: {},
    })).intelligence;

    expect(missingEvidence.risks.some(risk => risk.category === 'conflicting_survey_evidence')).toBe(true);
    expect(missingEvidence.classification.reviewUrgency).not.toBe('none');
  });

  it('runs against expanded fixtures with stable confidence distribution behavior', () => {
    const reports = professionalExpandedSurveyFixtures.map(fixture => intelligenceFor(fixture.raw).intelligence);
    const clean = reports.find(report => report.sourceSurveyId === 'expanded-clean-roof-001');
    const criticalCount = reports.filter(report => report.classification.geometryRisk === 'critical').length;
    const reviewCount = reports.filter(report => report.classification.reviewUrgency !== 'none').length;

    expect(clean?.classification.geometryRisk).toBe('low');
    expect(reports.length).toBe(professionalExpandedSurveyFixtures.length);
    expect(criticalCount).toBeGreaterThan(0);
    expect(reviewCount).toBeGreaterThan(criticalCount);
    expect(new Set(reports.map(report => report.intelligenceHash)).size).toBe(reports.length);
  });
});
