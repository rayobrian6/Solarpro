import { describe, expect, it } from 'vitest';
import { hydrateProjectEngineeringIntelligence } from './projectHydration';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';

const generatedAt = '2025-01-01T00:00:00.000Z';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-live-1',
    clientId: 'client-1',
    projectId: 'project-live-1',
    createdBy: 'user-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Deterministic Way',
    surveyData: {
      systemType: 'roof',
      location: {
        lat: 34.05,
        lng: -118.25,
        azimuthReference: 180,
      },
      geometry: {
        usableAreaSqFt: 510,
        roofPlanes: [
          {
            id: 'plane-a',
            azimuth: 180,
            pitch: 27,
            area: 510,
          },
        ],
        obstructions: [
          {
            id: 'vent-a',
            type: 'vent',
          },
        ],
      },
      structural: {
        rafterSpacingIn: 24,
        rafterSize: '2x6',
        roofMaterial: 'composition shingle',
        roofPitch: '27',
        atticAccess: true,
      },
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 225,
        breakerSpacesAvailable: 4,
        interconnectionPoint: 'load-side breaker',
        panelBrand: 'Square D',
      },
    },
    inspectorName: 'Field Tech',
    notes: 'Canonical live survey fixture.',
    externalSurveyId: null,
    deliveryId: null,
    ...overrides,
  };
}

function file(id: string, label: string, createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return {
    id,
    surveyId: 'survey-live-1',
    fileUrl: `https://example.test/${id}.jpg`,
    fileType: 'photo',
    label,
    filename: `${label}.jpg`,
    mimeType: 'image/jpeg',
    createdAt,
  };
}

describe('project engineering intelligence hydration', () => {
  it('hydrates workspace state from supplied project survey records and files', () => {
    const hydrated = hydrateProjectEngineeringIntelligence({
      projectId: 'project-live-1',
      generatedAt,
      sources: [
        {
          survey: survey(),
          files: [
            file('file-site-overview', 'site_overview'),
            file('file-meter', 'utility_meter'),
            file('file-main-panel', 'main_panel'),
            file('file-roof-overview', 'roof_overview'),
            file('file-obstruction', 'roof_obstruction'),
            file('file-attic', 'attic_rafters'),
          ],
        },
      ],
    });

    expect(hydrated.source).toBe('project_surveys');
    expect(hydrated.projectId).toBe('project-live-1');
    expect(hydrated.surveyCount).toBe(1);
    expect(hydrated.canonicalSurveyId).toBe('survey-live-1');
    expect(hydrated.surveyEvidence?.photos.length).toBeGreaterThanOrEqual(6);
    expect(hydrated.surveyEvidence?.requirementEvaluation.allRequirements.length).toBeGreaterThan(0);
    expect(hydrated.workspace.projectId).toBe('project-live-1');
    expect(hydrated.stateGraph?.graphId).toBe('engineering-intelligence:project-live-1:graph:latest');
    expect(hydrated.snapshots.map(snapshot => snapshot.snapshotId)).toEqual([
      'engineering-intelligence:project-live-1:snapshot:baseline',
      'engineering-intelligence:project-live-1:snapshot:latest',
    ]);
    expect(hydrated.workspace.snapshots.snapshots.length).toBe(2);
    expect(hydrated.workspace.snapshots.diffs.length).toBe(1);
    expect(hydrated.workspace.graph.nodes.length).toBeGreaterThan(0);
    expect(hydrated.invalidationResult?.trigger.triggerType).toBe('canonical_evidence_changed');
    expect(hydrated.regenerationPlans.length).toBe(1);
    expect(hydrated.workspace.regenerationPlanning.plans.length).toBe(1);
    expect(hydrated.cadReadiness.flags.length).toBeGreaterThan(0);
    expect(hydrated.deterministicNotes.join(' ')).toContain('metadata visualizations only');
  });

  it('keeps an explicit empty state when no surveys are supplied', () => {
    const hydrated = hydrateProjectEngineeringIntelligence({
      projectId: 'project-empty-1',
      generatedAt,
      sources: [],
    });

    expect(hydrated.source).toBe('not_loaded');
    expect(hydrated.surveyCount).toBe(0);
    expect(hydrated.canonicalSurveyId).toBeNull();
    expect(hydrated.surveyEvidence).toBeNull();
    expect(hydrated.stateGraph).toBeNull();
    expect(hydrated.snapshots).toEqual([]);
    expect(hydrated.invalidationResult).toBeNull();
    expect(hydrated.regenerationPlans).toEqual([]);
    expect(hydrated.workspace.projectId).toBe('project-empty-1');
    expect(hydrated.deterministicNotes.join(' ')).toContain('does not synthesize evidence, geometry, or stale state');
  });
});
