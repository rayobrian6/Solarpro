import { describe, expect, it } from 'vitest';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildProjectSurveyEvidenceHygiene } from './sessionGrouping';
import { summarizeSurveyEvidenceEngineeringBridge } from './engineeringBridge';

const projectId = 'project-repeated-7';
const baseTime = Date.parse('2026-05-22T12:00:00.000Z');

function survey(index: number, photoCount = 4): SiteSurvey {
  const submittedAt = new Date(baseTime + index * 60_000).toISOString();
  return {
    id: `survey-${index}`,
    clientId: 'client-1',
    projectId,
    createdBy: 'tech-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Solar Way',
    surveyData: {
      schemaVersion: '2.0',
      photos: [],
      siteOverview: { inspectorName: 'James' },
    },
    inspectorName: 'James',
    notes: null,
    externalSurveyId: `external-${index}`,
    deliveryId: `delivery-${index}`,
    fileCount: photoCount,
  };
}

function file(surveyId: string, id: string, label: string, filename: string, offset = 0): SiteSurveyFile {
  return {
    id: `${surveyId}-${id}`,
    surveyId,
    fileUrl: `https://storage.example/${surveyId}/${filename}`,
    fileType: 'photo',
    label,
    filename,
    mimeType: 'image/jpeg',
    createdAt: new Date(baseTime + offset).toISOString(),
  };
}

function repeatedFiles(surveyId: string): SiteSurveyFile[] {
  return [
    file(surveyId, 'main-panel', 'Main Panel Photo', 'main-panel.jpg'),
    file(surveyId, 'meter', 'Meter Photo', 'meter.jpg'),
    file(surveyId, 'roof', 'roof_overview', 'roof-plane.jpg'),
    file(surveyId, 'overview', 'Site Access Photo', 'site-access.jpg'),
  ];
}

describe('Project survey evidence duplicate hygiene v1', () => {
  it('preserves seven overlapping survey sessions while using canonical evidence representatives', () => {
    const surveys = Array.from({ length: 7 }, (_, index) => {
      const s = survey(index + 1);
      return { survey: s, files: repeatedFiles(s.id) };
    });

    const hygiene = buildProjectSurveyEvidenceHygiene({
      projectId,
      surveys,
      generatedAt: '2026-05-22T13:00:00.000Z',
    });

    expect(hygiene.surveySubmissionCount).toBe(7);
    expect(hygiene.rawEvidenceCount).toBe(28);
    expect(hygiene.canonicalEvidenceCount).toBe(4);
    expect(hygiene.collapsedDuplicateEvidenceCount).toBe(24);
    expect(hygiene.banner).toBe('7 survey submissions detected with overlapping evidence.');
    expect(hygiene.sessionGroups).toHaveLength(1);
    expect(hygiene.sessionGroups[0].surveyIds).toHaveLength(7);
    expect(hygiene.sessionGroups[0].duplicateCount).toBe(6);
    expect(hygiene.canonicalSurveyId).toBe('survey-7');

    expect(hygiene.sessions).toHaveLength(7);
    expect(hygiene.sessions.filter(session => session.surveySessionDuplicateStatus === 'canonical')).toHaveLength(1);
    expect(hygiene.sessions.filter(session => session.surveySessionDuplicateStatus === 'overlapping_duplicate')).toHaveLength(6);
    expect(hygiene.sessions.every(session => session.rawPhotoCount === 4)).toBe(true);

    expect(hygiene.evidenceDuplicateGroups).toHaveLength(4);
    expect(hygiene.evidenceDuplicateGroups.every(group => group.rawUploadCount === 7)).toBe(true);
    expect(hygiene.evidenceDuplicateGroups.every(group => group.duplicateCount === 6)).toBe(true);
    expect(hygiene.evidenceDuplicateGroups.map(group => group.category).sort()).toEqual([
      'main_service_panel',
      'meter',
      'overview',
      'roof_plane',
    ]);
    expect(hygiene.traceability.requirements.every(requirement => requirement.requirementSatisfied)).toBe(true);
    expect(hygiene.traceability.requirements.every(requirement => requirement.canonicalEvidenceId !== null)).toBe(true);
    expect(hygiene.traceability.canonicalEvidence.every(record => record.duplicateGroupSize === 7)).toBe(true);
    expect(hygiene.traceability.canonicalEvidence.every(record => record.selectionReason.includes('duplicate collapse representative'))).toBe(true);
    expect(hygiene.traceability.surveyLineage).toHaveLength(7);
    expect(hygiene.traceability.surveyLineage.filter(record => record.isCanonical)).toHaveLength(1);

    expect(hygiene.canonicalManifest?.summary.totalItems).toBe(4);
    expect(hygiene.canonicalManifest?.coverage.find(group => group.category === 'meter')?.count).toBe(1);
    expect(hygiene.canonicalManifest?.coverage.find(group => group.category === 'overview')?.count).toBe(1);
    expect(hygiene.canonicalManifest?.coverage.find(group => group.category === 'main_service_panel')?.count).toBe(1);
    expect(hygiene.canonicalManifest?.coverage.find(group => group.category === 'roof_plane')?.count).toBe(1);
    expect(hygiene.canonicalManifest?.requiredMissing).toEqual([]);

    const bridge = hygiene.engineeringBridge;
    expect(bridge).not.toBeNull();
    expect(bridge?.readiness).toBe('ready_for_engineering');
    expect(summarizeSurveyEvidenceEngineeringBridge(bridge!)).toEqual({
      electricalEvidenceCount: 2,
      structuralEvidenceCount: 0,
      roofLayoutEvidenceCount: 1,
      sitePlanEvidenceCount: 1,
    });
  });

  it('does not group surveys from different projects even when filenames match', () => {
    const first = survey(1);
    const second = { ...survey(2), id: 'other-survey', projectId: 'other-project' };

    const hygiene = buildProjectSurveyEvidenceHygiene({
      projectId,
      surveys: [
        { survey: first, files: repeatedFiles(first.id) },
        { survey: second, files: repeatedFiles(second.id) },
      ],
      generatedAt: '2026-05-22T13:00:00.000Z',
    });

    expect(hygiene.surveySubmissionCount).toBe(2);
    expect(hygiene.rawEvidenceCount).toBe(8);
    expect(hygiene.canonicalEvidenceCount).toBe(8);
    expect(hygiene.banner).toBeNull();
    expect(hygiene.sessionGroups).toHaveLength(2);
    expect(hygiene.sessions.every(session => session.surveySessionDuplicateStatus === 'unique')).toBe(true);
  });
});
