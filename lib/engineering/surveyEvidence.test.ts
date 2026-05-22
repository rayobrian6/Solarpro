import { describe, expect, it } from 'vitest';

import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import type { RawSurveyPayload } from '@/lib/siteSurvey/types';
import { collectEngineeringSurveyEvidence } from './surveyEvidence';

function rawSurvey(overrides: Partial<RawSurveyPayload> = {}): RawSurveyPayload {
  return {
    id: 'survey-evidence-001',
    projectId: 'project-evidence-001',
    location: {
      lat: 34.05,
      lng: -118.24,
      address: '123 Solar Evidence Way',
    },
    systemType: 'roof',
    geometry: {
      roofPlanes: [
        {
          id: 'roof-1',
          pitch: 22,
          azimuth: 180,
          area: 700,
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
      usableAreaSqFt: 500,
    },
    structural: {
      rafterSpacingIn: 24,
      rafterSize: '2x6',
      deckingThicknessIn: 0.5,
      roofMaterial: 'composition_shingle',
      roofPitch: 'standard',
      roofCondition: 'good',
      atticAccess: true,
    },
    electrical: {
      mainPanelRatingAmps: 200,
      busbarRatingAmps: 200,
      breakerSpacesAvailable: 4,
      meterType: 'standard',
      interconnectionPoint: 'main_panel',
      panelBrand: 'siemens',
      serviceEntrance: 'overhead',
    },
    photos: [
      { slotKey: 'main_panel_open', url: 'https://cdn.example.com/panel.jpg', category: 'panel' },
      { slotKey: 'utility_meter', url: 'https://cdn.example.com/meter.jpg', category: 'meter' },
      { slotKey: 'roof_overview', url: 'https://cdn.example.com/roof.jpg', category: 'roof' },
      { slotKey: 'site_exterior', url: 'https://cdn.example.com/site.jpg', category: 'site' },
    ],
    ...overrides,
  };
}

function evidenceFor(raw: RawSurveyPayload) {
  return collectEngineeringSurveyEvidence(enrichSurvey(normalizeSurvey(raw)), {
    normalizedAt: '2025-01-01T00:00:00.000Z',
  });
}

describe('collectEngineeringSurveyEvidence', () => {
  it('maps survey photos into permit/CAD evidence categories and marks sufficient evidence', () => {
    const evidence = evidenceFor(rawSurvey());

    expect(evidence.projectId).toBe('project-evidence-001');
    expect(evidence.surveyId).toBe('survey-evidence-001');
    expect(evidence.completeness).toBe('sufficient');
    expect(evidence.missingCategories).toEqual([]);
    expect(evidence.blockers).toEqual([]);
    expect(evidence.photos.map(photo => photo.category)).toEqual([
      'main_service_panel',
      'utility_meter',
      'roof_plane',
      'site_exterior',
    ]);
    expect(evidence.fieldEvidence.mainPanelRatingAmps).toBe(200);
    expect(evidence.fieldEvidence.rafterSpacingInches).toBe(24);
    expect(evidence.photos.find(photo => photo.category === 'roof_plane')?.extracted?.roofMaterial)
      .toBe('composition_shingle');
  });

  it('reports missing evidence without throwing or blocking plan-set generation', () => {
    const evidence = evidenceFor(rawSurvey({ photos: [] }));

    expect(evidence.completeness).toBe('missing');
    expect(evidence.photos).toEqual([]);
    expect(evidence.blockers).toContain('No site survey photos are attached to support permit plan-set assumptions.');
    expect(evidence.missingCategories).toEqual([
      'main_service_panel',
      'utility_meter',
      'roof_plane',
      'site_exterior',
    ]);
    expect(evidence.warnings.length).toBeGreaterThan(0);
  });

  it('marks partial evidence when core photos are incomplete', () => {
    const evidence = evidenceFor(rawSurvey({
      photos: [
        { slotKey: 'main_panel_open', url: 'https://cdn.example.com/panel.jpg', category: 'panel' },
        { slotKey: 'roof_overview', url: 'https://cdn.example.com/roof.jpg', category: 'roof' },
      ],
    }));

    expect(evidence.completeness).toBe('partial');
    expect(evidence.missingCategories).toEqual(['utility_meter', 'site_exterior']);
    expect(evidence.warnings.some(w => w.includes('utility meter'))).toBe(true);
  });
});
