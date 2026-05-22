import { describe, expect, it } from 'vitest';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import {
  buildSurveyEvidenceManifest,
  normalizeSurveyEvidenceCategory,
} from './manifest';
import { buildSurveyEvidenceEngineeringBridge } from './engineeringBridge';

const baseSurvey: Pick<SiteSurvey, 'id' | 'projectId' | 'surveyData' | 'inspectorName'> = {
  id: 'survey-1',
  projectId: 'project-1',
  inspectorName: 'Field Tech',
  surveyData: {
    schemaVersion: '2.0',
    photos: [
      { url: 'https://blob.example/surveys/project/main.jpg', uploadKey: 'surveys/project/main.jpg', category: 'main_panel_open', capturedAt: '2025-01-01T00:00:00.000Z' },
      { url: 'https://blob.example/surveys/project/meter.jpg', uploadKey: 'surveys/project/meter.jpg', category: 'meter', capturedAt: '2025-01-01T00:01:00.000Z' },
      { url: 'https://blob.example/surveys/project/roof.jpg', uploadKey: 'surveys/project/roof.jpg', category: 'roof_overview', capturedAt: '2025-01-01T00:02:00.000Z' },
      { url: 'https://blob.example/surveys/project/site.jpg', uploadKey: 'surveys/project/site.jpg', category: 'site', capturedAt: '2025-01-01T00:03:00.000Z' },
    ],
  },
};

function file(id: string, label: string, fileUrl: string): SiteSurveyFile {
  return {
    id,
    surveyId: 'survey-1',
    fileUrl,
    fileType: 'photo',
    label,
    filename: `${id}.jpg`,
    mimeType: 'image/jpeg',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('Survey Evidence Manifest v1', () => {
  it('normalizes survey photo categories into engineering evidence categories', () => {
    expect(normalizeSurveyEvidenceCategory('main_panel_open')).toBe('main_service_panel');
    expect(normalizeSurveyEvidenceCategory('meter')).toBe('meter');
    expect(normalizeSurveyEvidenceCategory('roof_overview')).toBe('roof_plane');
    expect(normalizeSurveyEvidenceCategory('attic_access')).toBe('attic_access');
    expect(normalizeSurveyEvidenceCategory('unknown-new-label')).toBe('uncategorized');
  });

  it('builds classified evidence items from site_survey_files without quality or AI overclaims', () => {
    const manifest = buildSurveyEvidenceManifest({
      survey: baseSurvey,
      files: [
        file('f1', 'main_panel_open', 'https://blob.example/surveys/project/main.jpg'),
        file('f2', 'meter', 'https://blob.example/surveys/project/meter.jpg'),
        file('f3', 'roof_overview', 'https://blob.example/surveys/project/roof.jpg'),
        file('f4', 'site', 'https://blob.example/surveys/project/site.jpg'),
      ],
      generatedAt: '2025-01-02T00:00:00.000Z',
    });

    expect(manifest.summary.totalItems).toBe(4);
    expect(manifest.summary.classifiedItems).toBe(4);
    expect(manifest.summary.qualityCheckedItems).toBe(0);
    expect(manifest.summary.duplicateCheckedItems).toBe(0);
    expect(manifest.summary.aiProcessedItems).toBe(0);
    expect(manifest.summary.completeness).toBe('sufficient');
    expect(manifest.requiredMissing).toEqual([]);
    expect(manifest.items.every(item => item.aiExtractionStatus === 'not_started')).toBe(true);
    expect(manifest.items.every(item => item.quality.blurScore === null)).toBe(true);
    expect(manifest.openSourceBoundaries.pythonWorker).toContain('OpenCV blur/orientation/duplicate scoring');
  });

  it('reports missing required evidence without blocking manifest construction', () => {
    const onePhotoSurvey = {
      ...baseSurvey,
      surveyData: {
        schemaVersion: '2.0',
        photos: [
          { url: 'https://blob.example/surveys/project/main.jpg', uploadKey: 'surveys/project/main.jpg', category: 'main_panel_open' },
        ],
      },
    };
    const manifest = buildSurveyEvidenceManifest({
      survey: onePhotoSurvey,
      files: [file('f1', 'main_panel_open', 'https://blob.example/surveys/project/main.jpg')],
      generatedAt: '2025-01-02T00:00:00.000Z',
    });

    expect(manifest.summary.completeness).toBe('partial');
    expect(manifest.requiredMissing).toContain('meter');
    expect(manifest.requiredMissing).toContain('roof_plane');
    expect(manifest.requiredMissing).toContain('overview');
    expect(manifest.warnings.join('\n')).toContain('Missing required survey evidence category: meter');
  });

  it('surfaces payload-only photos as evidence gaps when file rows are missing', () => {
    const manifest = buildSurveyEvidenceManifest({
      survey: baseSurvey,
      files: [],
      generatedAt: '2025-01-02T00:00:00.000Z',
    });

    expect(manifest.summary.totalItems).toBe(4);
    expect(manifest.items.every(item => item.evidenceSource === 'survey_payload')).toBe(true);
    expect(manifest.items.some(item => item.quality.warnings.some(w => w.includes('not found in site_survey_files')))).toBe(true);
  });

  it('creates an engineering bridge summary without starting CAD automation', () => {
    const manifest = buildSurveyEvidenceManifest({
      survey: baseSurvey,
      files: [
        file('f1', 'main_panel_open', 'https://blob.example/surveys/project/main.jpg'),
        file('f2', 'meter', 'https://blob.example/surveys/project/meter.jpg'),
        file('f3', 'roof_overview', 'https://blob.example/surveys/project/roof.jpg'),
        file('f4', 'site', 'https://blob.example/surveys/project/site.jpg'),
      ],
      generatedAt: '2025-01-02T00:00:00.000Z',
    });
    const bridge = buildSurveyEvidenceEngineeringBridge(manifest);

    expect(bridge.readiness).toBe('ready_for_engineering');
    expect(bridge.electricalEvidence.length).toBeGreaterThan(0);
    expect(bridge.roofLayoutEvidence.length).toBeGreaterThan(0);
    expect(bridge.sitePlanEvidence.length).toBeGreaterThan(0);
    expect(bridge.cadAutomationStatus).toBe('not_started');
  });
});
