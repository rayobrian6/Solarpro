import { describe, expect, it } from 'vitest';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import type { RawSurveyPayload } from '@/lib/siteSurvey/types';
import { buildProjectSurveyEvidenceHygiene } from '@/lib/survey/evidence/sessionGrouping';
import { collectEngineeringSurveyEvidence } from './surveyEvidence';

const generatedAt = '2025-01-01T00:00:00.000Z';

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
      { slotKey: 'meter', url: 'https://cdn.example.com/meter.jpg', category: 'meter' },
      { slotKey: 'roof_overview', url: 'https://cdn.example.com/roof.jpg', category: 'roof' },
      { slotKey: 'overview', url: 'https://cdn.example.com/site.jpg', category: 'site' },
    ],
    ...overrides,
  };
}

function evidenceFor(raw: RawSurveyPayload) {
  return collectEngineeringSurveyEvidence(enrichSurvey(normalizeSurvey(raw)), {
    normalizedAt: generatedAt,
  });
}

function siteSurvey(index: number): SiteSurvey {
  const submittedAt = new Date(Date.parse(generatedAt) + index * 60_000).toISOString();
  return {
    id: `survey-${index}`,
    clientId: 'client-1',
    projectId: 'project-evidence-001',
    createdBy: 'tech-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Solar Evidence Way',
    surveyData: {
      schemaVersion: '2.0',
      photos: [],
      siteOverview: { inspectorName: 'James' },
    },
    inspectorName: 'James',
    notes: null,
    externalSurveyId: `external-${index}`,
    deliveryId: `delivery-${index}`,
    fileCount: 4,
  };
}

function siteSurveyFile(surveyId: string, id: string, label: string, filename: string): SiteSurveyFile {
  return {
    id: `${surveyId}-${id}`,
    surveyId,
    fileUrl: `https://storage.example/${surveyId}/${filename}`,
    fileType: 'photo',
    label,
    filename,
    mimeType: 'image/jpeg',
    createdAt: generatedAt,
  };
}

function repeatedFiles(surveyId: string): SiteSurveyFile[] {
  return [
    siteSurveyFile(surveyId, 'main-panel', 'Main Panel Photo', 'main-panel.jpg'),
    siteSurveyFile(surveyId, 'meter', 'Meter Photo', 'meter.jpg'),
    siteSurveyFile(surveyId, 'roof', 'roof_overview', 'roof-plane.jpg'),
    siteSurveyFile(surveyId, 'overview', 'Site Access Photo', 'site-access.jpg'),
  ];
}

describe('collectEngineeringSurveyEvidence', () => {
  it('maps survey photos into permit/CAD evidence categories and marks sufficient evidence', () => {
    const evidence = evidenceFor(rawSurvey());

    expect(evidence.projectId).toBe('project-evidence-001');
    expect(evidence.surveyId).toBe('survey-evidence-001');
    expect(evidence.rawPhotoCount).toBe(4);
    expect(evidence.canonicalEvidenceCount).toBe(4);
    expect(evidence.evidenceTruthSource).toBe('legacy_raw_photos_fallback');
    expect(evidence.completeness).toBe('sufficient');
    expect(evidence.missingCategories).toEqual([]);
    expect(evidence.blockers).toEqual([]);
    expect(evidence.photos.map(photo => photo.category)).toEqual([
      'main_service_panel',
      'meter',
      'roof_plane',
      'overview',
    ]);
    expect(evidence.fieldEvidence.mainPanelRatingAmps).toBe(200);
    expect(evidence.fieldEvidence.rafterSpacingInches).toBe(24);
    expect(evidence.photos.find(photo => photo.category === 'roof_plane')?.extracted?.roofMaterial)
      .toBe('composition_shingle');
  });

  it('reports missing canonical evidence without throwing or blocking plan-set generation', () => {
    const evidence = evidenceFor(rawSurvey({ photos: [] }));

    expect(evidence.rawPhotoCount).toBe(0);
    expect(evidence.canonicalEvidenceCount).toBe(0);
    expect(evidence.completeness).toBe('missing');
    expect(evidence.photos).toEqual([]);
    expect(evidence.blockers).toContain('No canonical survey photo evidence items are available to support permit plan-set assumptions.');
    expect(evidence.missingCategories).toEqual([
      'main_service_panel',
      'meter',
      'roof_plane',
      'overview',
    ]);
    expect(evidence.traceability.missingRequirements.map(requirement => requirement.requirementCategory)).toEqual([
      'main_service_panel',
      'meter',
      'roof_plane',
      'overview',
    ]);
    expect(evidence.traceability.missingRequirements.every(requirement => requirement.canonicalEvidenceId === null)).toBe(true);
    expect(evidence.warnings.length).toBeGreaterThan(0);
  });

  it('marks partial evidence when core photos are incomplete', () => {
    const evidence = evidenceFor(rawSurvey({
      photos: [
        { slotKey: 'main_panel_open', url: 'https://cdn.example.com/panel.jpg', category: 'panel' },
        { slotKey: 'roof_overview', url: 'https://cdn.example.com/roof.jpg', category: 'roof' },
      ],
    }));

    expect(evidence.rawPhotoCount).toBe(2);
    expect(evidence.canonicalEvidenceCount).toBe(2);
    expect(evidence.completeness).toBe('partial');
    expect(evidence.missingCategories).toEqual(['meter', 'overview']);
    expect(evidence.warnings.some(w => w.includes('utility meter'))).toBe(true);
  });

  it('uses canonical hygiene manifest so repeated duplicate uploads do not inflate engineering truth', () => {
    const surveys = Array.from({ length: 7 }, (_, index) => {
      const survey = siteSurvey(index + 1);
      return { survey, files: repeatedFiles(survey.id) };
    });
    const hygiene = buildProjectSurveyEvidenceHygiene({
      projectId: 'project-evidence-001',
      surveys,
      generatedAt,
    });

    const duplicateRawSurvey = rawSurvey({
      photos: Array.from({ length: 7 }).flatMap(() => rawSurvey().photos),
    });
    const evidence = collectEngineeringSurveyEvidence(
      enrichSurvey(normalizeSurvey(duplicateRawSurvey)),
      {
        normalizedAt: generatedAt,
        canonicalManifest: hygiene.canonicalManifest,
        evidenceDuplicateGroups: hygiene.evidenceDuplicateGroups,
        sessions: hygiene.sessions,
      },
    );

    expect(hygiene.rawEvidenceCount).toBe(28);
    expect(hygiene.canonicalEvidenceCount).toBe(4);
    expect(evidence.evidenceTruthSource).toBe('canonical_manifest_v1');
    expect(evidence.rawPhotoCount).toBe(28);
    expect(evidence.canonicalEvidenceCount).toBe(4);
    expect(evidence.photos).toHaveLength(4);
    expect(evidence.completeness).toBe('sufficient');
    expect(evidence.manifestV1.itemCount).toBe(4);
    expect(evidence.manifestV1.engineeringBridge.readiness).toBe('ready_for_engineering');
    expect(evidence.manifestV1.engineeringBridge.electricalEvidenceCount).toBe(2);
    expect(evidence.manifestV1.engineeringBridge.roofLayoutEvidenceCount).toBe(1);
    expect(evidence.manifestV1.engineeringBridge.sitePlanEvidenceCount).toBe(1);
    expect(evidence.traceability.requirements.every(requirement => requirement.requirementSatisfied)).toBe(true);
    expect(evidence.traceability.requirements.map(requirement => requirement.canonicalEvidenceId).sort()).toEqual(
      hygiene.evidenceDuplicateGroups.map(group => group.canonicalEvidenceId).sort(),
    );
    expect(evidence.traceability.canonicalEvidence.every(record => record.duplicateGroupSize === 7)).toBe(true);
    expect(evidence.traceability.surveyLineage).toHaveLength(7);
    expect(evidence.traceability.surveyLineage.find(record => record.isCanonical)?.surveyId).toBe('survey-7');
  });
});
