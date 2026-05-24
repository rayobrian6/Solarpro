import { describe, expect, it } from 'vitest';

import { enrichSurvey } from './enrichSurvey';
import { normalizeSurvey } from './normalizeSurvey';
import {
  buildCanonicalSurveyGeometry,
  buildSurveyCADReadiness,
  parseProfessionalSiteSurvey,
  type ProfessionalSurveyAuthorityFlagsV1,
} from './professionalSurveyParser';
import type { RawSurveyPayload } from './types';

function roofRaw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'professional-survey-roof-001',
    projectId: 'project-professional-001',
    location: {
      lat: 34.05,
      lng: -118.24,
      elevation: 300,
      address: '123 Solar Survey Way, Los Angeles, CA',
    },
    systemType: 'roof',
    geometry: {
      roofPlanes: [
        {
          id: 'roof-plane-a',
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
      setbacks: [
        { edges: ['eave', 'rake'], distanceIn: 36 },
        { edges: ['ridge'], distanceIn: 18 },
      ],
      usableAreaSqFt: 620,
    },
    structural: {
      rafterSpacingIn: 24,
      rafterSize: '2x6',
      deckingThicknessIn: 0.5,
      windExposure: 'C',
      snowLoadPsf: 0,
      roofCondition: 'good',
      roofAgeYears: 7,
      atticAccess: true,
      roofMaterial: 'composition_shingle',
      roofPitch: '5/12',
      stories: '1',
      structureType: 'single_family',
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
    photos: [
      { slotKey: 'roof_overview', url: 'https://cdn.example.test/roof.jpg', category: 'roof' },
      { slotKey: 'main_panel', url: 'https://cdn.example.test/panel.jpg', category: 'panel' },
    ],
    installerNotes: 'Professional parser test fixture: clean roof capture.',
    inspectorName: 'Survey Technician',
    surveyedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

function expectNoAuthority(flags: ProfessionalSurveyAuthorityFlagsV1): void {
  expect(flags).toEqual({
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
}

describe('professionalSurveyParser V1', () => {
  it('builds deterministic evidence, canonical geometry, and CAD-input preview for a clean enriched roof survey', () => {
    const normalized = normalizeSurvey(roofRaw());
    const enriched = enrichSurvey(normalized);

    const bundle = parseProfessionalSiteSurvey(enriched);
    const geometry = buildCanonicalSurveyGeometry(enriched, bundle);
    const readiness = buildSurveyCADReadiness(enriched, bundle, geometry);
    const repeatedReadiness = buildSurveyCADReadiness(enriched, bundle, geometry);

    expect(bundle.schemaVersion).toBe('professional_site_survey_evidence_bundle_v1');
    expect(bundle.sourceKind).toBe('enriched_site_survey');
    expect(bundle.readinessStatus).toBe('cad_ready');
    expect(bundle.roofGeometryCandidates).toHaveLength(1);
    expect(bundle.roofGeometryCandidates[0]).toMatchObject({
      planeId: 'roof-plane-a',
      confidence: 'high',
      issues: [],
      hasSelfIntersection: false,
    });
    expect(bundle.missingRequiredFields).toEqual([]);
    expect(bundle.blockingIssues).toEqual([]);
    expectNoAuthority(bundle.authorityFlags);

    expect(geometry.schemaVersion).toBe('canonical_survey_geometry_v1');
    expect(geometry.readyForCADInput).toBe(true);
    expect(geometry.roofPlanes).toHaveLength(1);
    expect(geometry.roofPlanes[0].valid).toBe(true);
    expect(geometry.roofPlanes[0].polygon).toHaveLength(4);
    expect(geometry.blockingIssues).toEqual([]);
    expectNoAuthority(geometry.authorityFlags);

    expect(readiness.schemaVersion).toBe('survey_cad_readiness_v1');
    expect(readiness.readinessStatus).toBe('cad_ready');
    expect(readiness.canBuildCADInput).toBe(true);
    expect(readiness.cadInputPreview).not.toBeNull();
    expect(readiness.cadInputPreview?.systemType).toBe('roof');
    expect(readiness.cadInputPreview?.roofPlaneInputs).toHaveLength(1);
    expect(readiness.cadInputPreview?.groundArrayInputs).toEqual([]);
    expect(readiness.blockingIssues).toEqual([]);
    expectNoAuthority(readiness.authorityFlags);
    expect(repeatedReadiness.readinessHash).toBe(readiness.readinessHash);
  });

  it('keeps normalized-only surveys review-required and does not build a CAD-input preview', () => {
    const normalized = normalizeSurvey(roofRaw());

    const bundle = parseProfessionalSiteSurvey(normalized);
    const geometry = buildCanonicalSurveyGeometry(normalized, bundle);
    const readiness = buildSurveyCADReadiness(normalized, bundle, geometry);

    expect(bundle.sourceKind).toBe('normalized_site_survey');
    expect(bundle.readinessStatus).toBe('review_required');
    expect(bundle.missingRequiredFields).toContain('derived.cadRoofSurfaces/enrichment');
    expect(geometry.readyForCADInput).toBe(true);
    expect(readiness.canBuildCADInput).toBe(false);
    expect(readiness.cadInputPreview).toBeNull();
    expect(readiness.requiredReviewItems).toContain('EnrichedSiteSurvey required before CAD input preview can be built.');
    expect(readiness.readinessStatus).toBe('review_required');
  });

  it('blocks ambiguous self-intersecting roof geometry before CAD input readiness', () => {
    const normalized = normalizeSurvey(roofRaw({
      id: 'professional-survey-bowtie-001',
      geometry: {
        roofPlanes: [
          {
            id: 'bowtie-plane',
            pitch: 20,
            azimuth: 170,
            area: 500,
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
        usableAreaSqFt: 400,
      },
    }));
    const enriched = enrichSurvey(normalized);

    const bundle = parseProfessionalSiteSurvey(enriched);
    const geometry = buildCanonicalSurveyGeometry(enriched, bundle);
    const readiness = buildSurveyCADReadiness(enriched, bundle, geometry);

    expect(bundle.readinessStatus).toBe('blocked');
    expect(bundle.roofGeometryCandidates[0].hasSelfIntersection).toBe(true);
    expect(bundle.blockingIssues).toContain('roofPlane.bowtie-plane: Roof plane polygon self-intersects.');
    expect(geometry.readyForCADInput).toBe(false);
    expect(geometry.blockingIssues).toContain('roofPlane.bowtie-plane: Projected polygon self-intersects.');
    expect(readiness.readinessStatus).toBe('blocked');
    expect(readiness.canBuildCADInput).toBe(false);
    expect(readiness.cadInputPreview).toBeNull();
  });

  it.each(['ground', 'fence'] as const)('does not require roof planes for %s survey evidence readiness', systemType => {
    const normalized = normalizeSurvey(roofRaw({
      id: `professional-survey-${systemType}-001`,
      systemType,
      geometry: {
        roofPlanes: [],
        obstructions: [],
        setbacks: [],
        usableAreaSqFt: 1200,
      },
    }));
    const enriched = enrichSurvey(normalized);

    const bundle = parseProfessionalSiteSurvey(enriched);
    const geometry = buildCanonicalSurveyGeometry(enriched, bundle);
    const readiness = buildSurveyCADReadiness(enriched, bundle, geometry);

    expect(bundle.systemType).toBe(systemType);
    expect(bundle.missingRequiredFields).not.toContain('geometry.roofPlanes');
    expect(bundle.blockingIssues).not.toContain('Roof surveys require at least one roof plane before CAD input readiness.');
    expect(geometry.roofPlanes).toEqual([]);
    expect(geometry.readyForCADInput).toBe(true);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.cadInputPreview?.systemType).toBe(systemType === 'ground' ? 'ground_mount' : 'solar_fence');
  });
});
