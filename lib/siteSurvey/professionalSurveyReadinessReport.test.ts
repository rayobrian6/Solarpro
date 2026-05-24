import { describe, expect, it } from 'vitest';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildProfessionalSurveyReadinessReport } from './professionalSurveyReadinessReport';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-readiness-001',
    clientId: 'client-001',
    projectId: 'project-001',
    createdBy: 'user-001',
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T11:00:00Z',
    status: 'completed',
    source: 'standalone',
    addressSnapshot: '123 Read Only Way, Los Angeles, CA',
    surveyData: {
      schemaVersion: '2.0',
      systemType: 'roof',
      location: { lat: 34.05, lng: -118.24, address: '123 Read Only Way' },
      geometry: {
        roofPlanes: [
          {
            id: 'roof-a',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.0500, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2404 },
              { lat: 34.0500, lng: -118.2404 },
            ],
          },
        ],
        obstructions: [],
        setbacks: [{ edges: ['eave', 'rake'], distanceIn: 36 }],
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
    },
    inspectorName: 'Read Only Tech',
    notes: 'Operator readiness fixture.',
    externalSurveyId: 'external-001',
    deliveryId: 'delivery-001',
    ...overrides,
  };
}

function files(): SiteSurveyFile[] {
  return [
    {
      id: 'file-roof-001',
      surveyId: 'survey-readiness-001',
      fileUrl: 'https://cdn.example.test/roof.jpg',
      fileType: 'photo',
      label: 'roof overview',
      filename: 'roof.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-05-01T10:05:00Z',
    },
    {
      id: 'file-panel-001',
      surveyId: 'survey-readiness-001',
      fileUrl: 'https://cdn.example.test/panel.jpg',
      fileType: 'photo',
      label: 'main panel',
      filename: 'panel.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-05-01T10:06:00Z',
    },
  ];
}

describe('professional survey readiness report', () => {
  it('builds a deterministic read-only cad_preview_ready report for clean survey data', () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const repeated = buildProfessionalSurveyReadinessReport(survey(), files());

    expect(report.schemaVersion).toBe('professional_survey_readiness_report_v1');
    expect(report.persistenceMode).toBe('read_only_review_report_v1');
    expect(report.readinessState).toBe('cad_preview_ready');
    expect(report.labels).toEqual({
      surveyDerived: true,
      parserDerived: true,
      canonicalized: true,
      previewOnly: true,
      reviewRequired: false,
      nonAuthoritative: true,
    });
    expect(report.source).toMatchObject({
      surveyId: 'survey-readiness-001',
      projectId: 'project-001',
      fileCount: 2,
      photoCount: 2,
      hasSurveyData: true,
    });
    expect(report.summaries).toMatchObject({
      systemType: 'roof',
      roofPlaneCount: 1,
      canonicalRoofPlaneCount: 1,
      invalidCanonicalRoofPlaneCount: 0,
      cadPreviewEligible: true,
      cadPreviewBuilt: true,
    });
    expect(report.evidence.bundleHash).toBe(repeated.evidence.bundleHash);
    expect(report.canonicalGeometry.geometryHash).toBe(repeated.canonicalGeometry.geometryHash);
    expect(report.cadReadiness.readinessHash).toBe(repeated.cadReadiness.readinessHash);
    expect(report.photoEvidence.bundleHash).toBe(repeated.photoEvidence.bundleHash);
    expect(report.renderReadiness.renderReadinessHash).toBe(repeated.renderReadiness.renderReadinessHash);
    expect(report.renderRecommendationReport.recommendationHash).toBe(repeated.renderRecommendationReport.recommendationHash);
    expect(report.summaries.photoEvidence.roofOrMountCoverage).toBe(true);
    expect(report.summaries.renderIntelligence.renderConfidenceScore).toBeGreaterThan(0);
  });

  it('enforces no-authority and no downstream execution flags', () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());

    expect(report.noAuthorityEnforcement).toEqual({
      dbWritesAllowed: false,
      cadSolverExecutionAllowed: false,
      productionCADMutationAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBOMAllowed: false,
    });
    expect(report.evidence.authorityFlags.persistenceAllowed).toBe(false);
    expect(report.evidence.authorityFlags.solverExecutionAllowed).toBe(false);
    expect(report.evidence.authorityFlags.cadMutationAllowed).toBe(false);
    expect(report.canonicalGeometry.authorityFlags.canonicalGeometryMutationAllowed).toBe(false);
    expect(report.cadReadiness.authorityFlags.downstreamAuthority).toBe(false);
  });

  it('reports blocked for invalid self-intersecting roof geometry', () => {
    const report = buildProfessionalSurveyReadinessReport(survey({
      id: 'survey-bowtie-001',
      surveyData: {
        schemaVersion: '2.0',
        systemType: 'roof',
        location: { lat: 34.05, lng: -118.24 },
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
        },
        electrical: { mainPanelRatingAmps: 200, interconnectionPoint: 'main_panel' },
      },
    }), []);

    expect(report.readinessState).toBe('blocked');
    expect(report.summaries.cadPreviewEligible).toBe(false);
    expect(report.summaries.cadPreviewBuilt).toBe(false);
    expect(report.summaries.blockingIssues.join('\n')).toContain('self-intersects');
  });

  it('reports review_required when required survey evidence is missing', () => {
    const report = buildProfessionalSurveyReadinessReport(survey({
      id: 'survey-missing-fields-001',
      surveyData: {
        schemaVersion: '2.0',
        systemType: 'roof',
        geometry: {
          roofPlanes: [
            {
              id: 'roof-a',
              pitch: 22,
              azimuth: 180,
              area: 850,
              vertices: [
                { lat: 34.0500, lng: -118.2400 },
                { lat: 34.0502, lng: -118.2400 },
                { lat: 34.0502, lng: -118.2404 },
                { lat: 34.0500, lng: -118.2404 },
              ],
            },
          ],
        },
        electrical: {},
      },
    }), []);

    expect(report.readinessState).toBe('review_required');
    expect(report.labels.reviewRequired).toBe(true);
    expect(report.summaries.missingRequiredFields).toContain('electrical.mainPanelRatingAmps');
    expect(report.summaries.missingRequiredFields).toContain('electrical.interconnectionPoint');
    expect(report.summaries.confidenceGaps.length).toBeGreaterThan(0);
  });
});
