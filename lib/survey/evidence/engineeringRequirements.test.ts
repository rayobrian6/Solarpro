import { describe, expect, it } from 'vitest';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildSurveyEvidenceManifest } from './manifest';
import { buildProjectSurveyEvidenceHygiene } from './sessionGrouping';
import { buildEngineeringRequirementEvaluation } from './engineeringRequirements';

const generatedAt = '2026-05-22T13:00:00.000Z';
const baseTime = Date.parse('2026-05-22T12:00:00.000Z');

const baseSurvey: Pick<SiteSurvey, 'id' | 'projectId' | 'surveyData' | 'inspectorName'> = {
  id: 'survey-registry-1',
  projectId: 'project-registry-1',
  inspectorName: 'Registry Tech',
  surveyData: { schemaVersion: '2.0', photos: [] },
};

function file(id: string, label: string, fileUrl: string): SiteSurveyFile {
  return {
    id,
    surveyId: baseSurvey.id,
    fileUrl,
    fileType: 'photo',
    label,
    filename: `${id}.jpg`,
    mimeType: 'image/jpeg',
    createdAt: generatedAt,
  };
}

function survey(index: number): SiteSurvey {
  const submittedAt = new Date(baseTime + index * 60_000).toISOString();
  return {
    id: `survey-${index}`,
    clientId: 'client-1',
    projectId: 'project-registry-1',
    createdBy: 'tech-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Registry Way',
    surveyData: {
      schemaVersion: '2.0',
      photos: [],
      siteOverview: { inspectorName: 'Registry Tech' },
    },
    inspectorName: 'Registry Tech',
    notes: null,
    externalSurveyId: `external-${index}`,
    deliveryId: `delivery-${index}`,
    fileCount: 4,
  };
}

function repeatedFiles(surveyId: string): SiteSurveyFile[] {
  return [
    {
      id: `${surveyId}-main-panel`,
      surveyId,
      fileUrl: `https://storage.example/${surveyId}/main-panel.jpg`,
      fileType: 'photo',
      label: 'Main Panel Photo',
      filename: 'main-panel.jpg',
      mimeType: 'image/jpeg',
      createdAt: generatedAt,
    },
    {
      id: `${surveyId}-meter`,
      surveyId,
      fileUrl: `https://storage.example/${surveyId}/meter.jpg`,
      fileType: 'photo',
      label: 'Meter Photo',
      filename: 'meter.jpg',
      mimeType: 'image/jpeg',
      createdAt: generatedAt,
    },
    {
      id: `${surveyId}-roof`,
      surveyId,
      fileUrl: `https://storage.example/${surveyId}/roof-plane.jpg`,
      fileType: 'photo',
      label: 'roof_overview',
      filename: 'roof-plane.jpg',
      mimeType: 'image/jpeg',
      createdAt: generatedAt,
    },
    {
      id: `${surveyId}-overview`,
      surveyId,
      fileUrl: `https://storage.example/${surveyId}/site-access.jpg`,
      fileType: 'photo',
      label: 'Site Access Photo',
      filename: 'site-access.jpg',
      mimeType: 'image/jpeg',
      createdAt: generatedAt,
    },
  ];
}

describe('Engineering Requirement Registry v1', () => {
  it('evaluates missing blocking requirements deterministically from canonical manifest only', () => {
    const manifest = buildSurveyEvidenceManifest({
      survey: baseSurvey,
      files: [file('panel', 'main_panel_open', 'https://cdn.example.com/panel.jpg')],
      generatedAt,
    });

    const evaluation = buildEngineeringRequirementEvaluation({ canonicalManifest: manifest });

    expect(evaluation.confidenceSource).toBe('engineering_requirement_registry_v1');
    expect(evaluation.readiness).toBe('blocked');
    expect(evaluation.completeness).toBe('partial');
    expect(evaluation.blockedRequirements.map(requirement => requirement.requirementId).sort()).toEqual([
      'roof_overview',
      'utility_meter',
    ]);
    expect(evaluation.missingRequirements.find(requirement => requirement.requirementId === 'utility_meter')?.reasoningPath.join(' '))
      .toContain('No canonical evidence');
    expect(evaluation.deterministicSummary.join(' ')).toContain('Raw upload history is not consumed');
  });

  it('does not inflate requirement satisfaction when duplicate uploads collapse to canonical representatives', () => {
    const surveys = Array.from({ length: 7 }, (_, index) => {
      const s = survey(index + 1);
      return { survey: s, files: repeatedFiles(s.id) };
    });
    const hygiene = buildProjectSurveyEvidenceHygiene({
      projectId: 'project-registry-1',
      surveys,
      generatedAt,
    });

    const evaluation = buildEngineeringRequirementEvaluation({
      canonicalManifest: hygiene.canonicalManifest,
      traceability: hygiene.traceability,
    });

    const panel = evaluation.allRequirements.find(requirement => requirement.requirementId === 'main_service_panel');
    const meter = evaluation.allRequirements.find(requirement => requirement.requirementId === 'utility_meter');
    const roof = evaluation.allRequirements.find(requirement => requirement.requirementId === 'roof_overview');

    expect(hygiene.rawEvidenceCount).toBe(28);
    expect(hygiene.canonicalEvidenceCount).toBe(4);
    expect(panel?.observedCanonicalEvidenceCount).toBe(1);
    expect(meter?.observedCanonicalEvidenceCount).toBe(1);
    expect(roof?.observedCanonicalEvidenceCount).toBe(1);
    expect(panel?.duplicateCollapsed).toBe(true);
    expect(meter?.duplicateCollapsed).toBe(true);
    expect(roof?.duplicateCollapsed).toBe(true);
    expect(panel?.provenanceRecords[0].duplicateGroupSize).toBe(7);
    expect(panel?.originatingSurveyIds).toEqual(['survey-7']);
    expect(evaluation.deterministicSummary.join(' ')).toContain('duplicate collapse is represented through provenance group sizes only');
  });

  it('preserves provenance linkage and keeps inactive future flags informational only', () => {
    const manifest = buildSurveyEvidenceManifest({
      survey: baseSurvey,
      files: [
        file('panel', 'main_panel_open', 'https://cdn.example.com/panel.jpg'),
        file('meter', 'meter', 'https://cdn.example.com/meter.jpg'),
        file('roof', 'roof_overview', 'https://cdn.example.com/roof.jpg'),
        file('site', 'site', 'https://cdn.example.com/site.jpg'),
      ],
      generatedAt,
    });

    const evaluation = buildEngineeringRequirementEvaluation({ canonicalManifest: manifest });
    const panel = evaluation.satisfiedRequirements.find(requirement => requirement.requirementId === 'main_service_panel');

    expect(panel?.canonicalEvidenceIds).toHaveLength(1);
    expect(panel?.originatingSurveyIds).toEqual([baseSurvey.id]);
    expect(panel?.confidenceSource).toBe('canonical_evidence_confidence');
    expect(evaluation.inactiveRequirements.map(requirement => requirement.requirementId).sort()).toEqual([
      'placards',
      'rapid_shutdown',
      'service_equipment_label',
      'utility_bill',
    ]);
    expect(evaluation.inactiveRequirements.every(requirement => requirement.status === 'inactive')).toBe(true);
    expect(evaluation.inactiveRequirements.every(requirement => requirement.reasoningPath.join(' ').includes('do not trigger runtime intelligence'))).toBe(true);
    expect(evaluation.deterministicSummary.join(' ')).toContain('do not activate OCR, CV, semantic extraction, CAD inference, or image-byte inspection');
  });
});
