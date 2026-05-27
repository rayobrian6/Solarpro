import { describe, expect, it } from 'vitest';

import { enrichSurvey } from './enrichSurvey';
import { buildGeometryIntelligenceReport } from './geometryIntelligence';
import { normalizeSurvey } from './normalizeSurvey';
import { buildCanonicalSurveyGeometry, buildSurveyCADReadiness, parseProfessionalSiteSurvey } from './professionalSurveyParser';
import { buildSurveyPhotoEvidenceBundle, classifySurveyPhotoEvidence } from './surveyPhotoEvidence';
import { buildProfessionalRenderRecommendationReport, buildRenderReadiness } from './surveyRenderIntelligence';
import type { RawSurveyPayload, SurveyPhotoRef } from './types';

function raw(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'render-intel-001',
    projectId: 'render-project-001',
    location: { lat: 34.05, lng: -118.24, address: '123 Render Trust Way' },
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
    photos: [
      { slotKey: 'roof-overview', url: 'https://cdn.example.test/roof_overview_front.jpg', category: 'roof', notes: 'Front roof overview for render context.' },
      { slotKey: 'main-panel', url: 'https://cdn.example.test/main_service_panel_msp.jpg', category: 'panel', notes: 'Main service panel label.' },
      { slotKey: 'meter', url: 'https://cdn.example.test/utility_meter_socket.jpg', category: 'meter' },
      { slotKey: 'inverter', url: 'https://cdn.example.test/inverter_disconnect_equipment.jpg', category: 'other' },
    ],
    installerNotes: 'Render intelligence fixture.',
    inspectorName: 'Render Intelligence Tech',
    surveyedAt: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

function pipeline(input: RawSurveyPayload) {
  const normalized = normalizeSurvey(input);
  const enriched = enrichSurvey(normalized);
  const evidence = parseProfessionalSiteSurvey(enriched);
  const canonicalGeometry = buildCanonicalSurveyGeometry(enriched, evidence);
  const cadReadiness = buildSurveyCADReadiness(enriched, evidence, canonicalGeometry);
  const geometryIntelligence = buildGeometryIntelligenceReport({ evidence, canonicalGeometry, cadReadiness });
  const photoEvidence = buildSurveyPhotoEvidenceBundle(enriched, canonicalGeometry);
  const renderReadiness = buildRenderReadiness({ canonicalGeometry, cadReadiness, geometryIntelligence, photoEvidence });
  const recommendationReport = buildProfessionalRenderRecommendationReport({ canonicalGeometry, cadReadiness, geometryIntelligence, photoEvidence, renderReadiness });
  return { normalized, enriched, evidence, canonicalGeometry, cadReadiness, geometryIntelligence, photoEvidence, renderReadiness, recommendationReport };
}

describe('Survey Photo Render Intelligence V1', () => {
  it('classifies photo evidence deterministically from filename, slot, category, and notes without authority promotion', () => {
    const result = pipeline(raw());
    const repeated = pipeline(raw());

    expect(result.photoEvidence.schemaVersion).toBe('survey_photo_evidence_bundle_v1');
    expect(result.photoEvidence.bundleHash).toBe(repeated.photoEvidence.bundleHash);
    expect(result.photoEvidence.coverage.roofOrMountCoverage).toBe(true);
    expect(result.photoEvidence.coverage.electricalCoverage).toBe(true);
    expect(result.photoEvidence.coverage.highConfidencePhotoCount).toBeGreaterThanOrEqual(3);
    expect(result.photoEvidence.evidence.map(item => item.classification.category).sort()).toEqual([
      'inverter_equipment',
      'meter',
      'msp_electrical_panel',
      'roof_overview',
    ]);
    expect(result.photoEvidence.noAuthorityEnforcement).toMatchObject({
      readOnly: true,
      photoEvidenceOnly: true,
      visualClassificationAuthoritative: false,
      automaticGeometryExtractionAllowed: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      readinessPromotionAllowed: false,
      downstreamEngineeringAllowed: false,
    });
  });

  it('marks unknown or weak photos for review while keeping render use non-authoritative', () => {
    const input = pipeline(raw({ photos: [{ slotKey: 'misc', url: 'https://cdn.example.test/image_001.jpg', category: 'other', notes: 'unclear upload' }] }));
    const photo = input.photoEvidence.evidence[0];

    expect(photo.classification.category).toBe('unknown_review_needed');
    expect(photo.classification.reviewStatus).toBe('review_required');
    expect(input.photoEvidence.reviewNeededPhotoSlotKeys).toEqual(['misc']);
    expect(input.renderReadiness.state).toBe('render_blocked');
    expect(input.renderReadiness.blockers.join('\n')).toContain('Missing roof/ground/fence visual coverage');
  });

  it('builds render readiness and commercial layer recommendations from trusted geometry plus photo coverage', () => {
    const result = pipeline(raw());

    expect(['render_preview_ready', 'render_demo_ready']).toContain(result.renderReadiness.state);
    expect(result.renderReadiness.renderConfidenceScore).toBeGreaterThanOrEqual(70);
    expect(result.renderReadiness.coverage).toMatchObject({
      hasRenderableGeometry: true,
      hasTrustedGeometry: true,
      hasRoofOrMountPhotos: true,
      hasElectricalPhotos: true,
      unresolvedBlockerReview: false,
    });
    expect(result.recommendationReport.summary.previewEnabledLayerCount).toBeGreaterThanOrEqual(5);
    expect(result.recommendationReport.summary.topCommercialRenderLayers).toContain('roof_outlines');
    expect(result.recommendationReport.summary.topCommercialRenderLayers).toContain('msp_meter_markers');
    expect(result.recommendationReport.recommendations.find(item => item.type === 'module_layout_previews')).toMatchObject({
      priority: 'recommended',
      enabledForPreview: true,
    });
  });

  it('blocks commercial render readiness when geometry has blocker review risk', () => {
    const result = pipeline(raw({
      id: 'render-bowtie-001',
      geometry: {
        ...raw().geometry,
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
    }));

    expect(result.renderReadiness.state).toBe('render_blocked');
    expect(result.renderReadiness.blockers.join('\n')).toContain('Geometry intelligence requires blocker review');
    expect(result.recommendationReport.recommendations.find(item => item.type === 'roof_outlines')?.enabledForPreview).toBe(false);
    expect(result.recommendationReport.noAuthorityEnforcement).toMatchObject({
      readOnly: true,
      renderAssistOnly: true,
      automaticCadGenerationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBomAllowed: false,
      engineeringAuthorityAllowed: false,
    });
  });

  it('does not mutate raw survey input, canonical geometry, or CAD readiness while building render intelligence', () => {
    const input = raw();
    const inputBefore = JSON.stringify(input);
    const result = pipeline(input);
    const geometryBefore = JSON.stringify(result.canonicalGeometry);
    const readinessBefore = JSON.stringify(result.cadReadiness);

    buildSurveyPhotoEvidenceBundle(result.enriched, result.canonicalGeometry);
    buildRenderReadiness({
      canonicalGeometry: result.canonicalGeometry,
      cadReadiness: result.cadReadiness,
      geometryIntelligence: result.geometryIntelligence,
      photoEvidence: result.photoEvidence,
    });

    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(result.canonicalGeometry)).toBe(geometryBefore);
    expect(JSON.stringify(result.cadReadiness)).toBe(readinessBefore);
  });

  it('classifies individual photo references without relying on image pixels or CV execution', () => {
    const enriched = pipeline(raw()).enriched;
    const atticPhoto: SurveyPhotoRef = {
      slotKey: 'attic-rafter-detail',
      url: 'https://cdn.example.test/attic_rafter_truss_detail.jpg',
      category: 'other',
      notes: 'Rafter bay and decking detail.',
    };

    const evidence = classifySurveyPhotoEvidence(enriched, atticPhoto);

    expect(evidence.classification.category).toBe('attic_rafter');
    expect(evidence.deterministicSignals.join('\n')).toContain('matched attic/rafter keyword');
    expect(evidence.evidenceLimitations.join('\n')).toContain('No pixel-level scan was available for this photo; measurement extraction or authoritative geometry inference was not performed.');
  });
});
