import { describe, expect, it } from 'vitest';

import type { CADModel } from '@/lib/cad/types';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildEngineeringRequirementEvaluation } from '@/lib/survey/evidence/engineeringRequirements';
import { buildProjectSurveyEvidenceHygiene } from '@/lib/survey/evidence/sessionGrouping';
import {
  assertDocumentProvenanceGuards,
  buildDocumentProvenanceBundle,
  buildEngineeringDependencyGraph,
  buildEvidenceBackedGeometryInputs,
  listRequirementDocumentBindings,
  runDocumentAuditGuards,
} from './index';
import { buildRenderContext } from '@/lib/drafting/renderContext';

const generatedAt = '2026-05-23T10:00:00.000Z';
const baseTime = Date.parse('2026-05-23T09:00:00.000Z');

function survey(index: number): SiteSurvey {
  const submittedAt = new Date(baseTime + index * 60_000).toISOString();
  return {
    id: `survey-docprov-${index}`,
    clientId: 'client-docprov-1',
    projectId: 'project-docprov-1',
    createdBy: 'tech-docprov-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Provenance Way',
    surveyData: {
      schemaVersion: '2.0',
      photos: [],
      siteOverview: { inspectorName: 'Provenance Tech' },
    },
    inspectorName: 'Provenance Tech',
    notes: null,
    externalSurveyId: `external-docprov-${index}`,
    deliveryId: `delivery-docprov-${index}`,
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
      fileUrl: `https://storage.example/${surveyId}/site-overview.jpg`,
      fileType: 'photo',
      label: 'Site Overview Photo',
      filename: 'site-overview.jpg',
      mimeType: 'image/jpeg',
      createdAt: generatedAt,
    },
  ];
}

function mockCad(): CADModel {
  return {
    systemType: 'roof',
    version: 'test-cad-v1',
    roof: {
      planes: [
        {
          id: 'roof-plane-1',
          polygon: [],
          usablePolygon: [],
          pitch: 20,
          azimuth: 180,
          areaSqM: 50,
          setbacks: { eaveM: 0.46, ridgeM: 0.46, rakeM: 0.46 },
          panels: [],
          dimensions: { widthM: 10, heightM: 5, panelCountX: 5, panelCountY: 2 },
        },
      ],
      totalPanels: 10,
      setbackIn: 18,
      ridgeSetbackIn: 18,
    },
    totalPanels: 10,
    totalDcKw: 4,
    panelWidthM: 1,
    panelHeightM: 1.7,
    originLat: 34,
    originLng: -118,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5, width: 10, height: 5, cx: 5, cy: 2.5 },
    dimensions: [{ id: 'overall-width', type: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0, valueFt: 32.8, label: 'Overall Width', level: 3 }],
    solveMs: 5,
    warnings: [],
  };
}

function evidenceFromDuplicateHygiene(): EngineeringSurveyEvidence {
  const surveys = Array.from({ length: 7 }, (_, index) => {
    const s = survey(index + 1);
    return { survey: s, files: repeatedFiles(s.id) };
  });
  const hygiene = buildProjectSurveyEvidenceHygiene({
    projectId: 'project-docprov-1',
    surveys,
    generatedAt,
  });
  const requirementEvaluation = buildEngineeringRequirementEvaluation({
    canonicalManifest: hygiene.canonicalManifest,
    traceability: hygiene.traceability,
  });
  return {
    projectId: 'project-docprov-1',
    surveyId: hygiene.canonicalSurveyId ?? 'survey-docprov-7',
    photos: hygiene.canonicalManifest.items.map(item => ({
      id: item.evidenceId,
      projectId: item.projectId ?? 'project-docprov-1',
      surveyId: item.surveyId,
      fileUrl: item.fileUrl,
      fileId: item.siteSurveyFileId ?? undefined,
      sourceCategory: 'other',
      category: item.category,
      confidence: 0.9,
    })),
    rawPhotoCount: hygiene.rawEvidenceCount,
    canonicalEvidenceCount: hygiene.canonicalEvidenceCount,
    evidenceTruthSource: 'canonical_manifest_v1',
    traceability: hygiene.traceability,
    requirementEvaluation,
    missingCategories: requirementEvaluation.blockedRequirements.flatMap(requirement => requirement.requiredEvidenceCategories),
    completeness: requirementEvaluation.completeness,
    blockers: [],
    warnings: [],
    fieldEvidence: {
      hasPhysicalData: true,
      hasRoofGeometry: true,
      hasElectricalData: true,
      hasStructuralData: true,
      roofPlaneCount: 1,
      obstructionCount: 0,
      usableAreaSqFt: 500,
      mainPanelRatingAmps: 200,
      busbarRatingAmps: 225,
      interconnectionPoint: 'main_panel',
      rafterSize: '2x6',
      rafterSpacingInches: 24,
      roofMaterial: 'composition_shingle',
      roofPitchDegrees: 20,
    },
    source: {
      pipelineVersion: 1,
      normalizedAt: generatedAt,
    },
  };
}

describe('Document Provenance + Requirement Binding Foundation v1', () => {
  it('does not inflate document provenance when duplicate uploads collapse to canonical representatives', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const bundle = buildDocumentProvenanceBundle({
      documentId: 'permit:duplicate-collapse',
      documentType: 'permit_package',
      surveyEvidence,
      cad: mockCad(),
      generatedAt,
    });

    expect(surveyEvidence.rawPhotoCount).toBe(28);
    expect(surveyEvidence.canonicalEvidenceCount).toBe(4);
    expect(bundle.canonicalEvidenceIds).toHaveLength(4);
    expect(bundle.canonicalEvidenceIds).toEqual([...new Set(bundle.canonicalEvidenceIds)].sort());
    expect(bundle.sections.find(section => section.requirementIds.includes('main_service_panel'))?.canonicalEvidenceIds).toHaveLength(1);
    expect(bundle.deterministicNotes.join(' ')).toContain('duplicate uploads cannot inflate document provenance');
  });

  it('retains canonical evidence linkage on bound document sections', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const bundle = buildDocumentProvenanceBundle({
      documentId: 'permit:section-linkage',
      documentType: 'permit_package',
      surveyEvidence,
      cad: mockCad(),
      generatedAt,
    });
    const bindings = listRequirementDocumentBindings();

    expect(bindings.find(binding => binding.requirementId === 'main_service_panel')?.boundDocumentSections.map(section => section.sectionId))
      .toContain('E-1.interconnection');
    const validationSection = bundle.sections.find(section => section.sectionId === 'VAL-1.registry' && section.requirementIds.includes('main_service_panel'));
    expect(validationSection?.canonicalEvidenceIds).toHaveLength(1);
    expect(validationSection?.originatingSurveyIds).toEqual(['survey-docprov-7']);
    expect(validationSection?.truthSource).toBe('canonical_manifest_v1');
  });

  it('preserves document provenance through RenderContext', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const bundle = buildDocumentProvenanceBundle({
      documentId: 'permit:render-context',
      documentType: 'render_context',
      surveyEvidence,
      cad: mockCad(),
      generatedAt,
    });
    const ctx = buildRenderContext(mockCad(), { documentProvenance: bundle });

    expect(ctx.documentProvenance?.documentId).toBe('permit:render-context');
    expect(ctx.documentProvenance?.sections.length).toBeGreaterThan(0);
    expect(ctx.documentProvenance?.engineeringDependencyIds).toContain('renderContext:primary');
    expect(ctx.documentProvenance?.auditGuards.find(guard => guard.guardCode === 'render_context_provenance_required')?.passed).toBe(true);
  });

  it('fails audit guards when registry evaluation is bypassed', () => {
    const bundle = buildDocumentProvenanceBundle({
      documentId: 'permit:bypass-attempt',
      documentType: 'permit_package',
      surveyEvidence: null,
      cad: mockCad(),
      generatedAt,
      includeLegacyDesignInput: true,
    });

    expect(bundle.auditGuards.find(guard => guard.guardCode === 'registry_evaluation_required')?.passed).toBe(false);
    expect(() => assertDocumentProvenanceGuards(bundle)).toThrow(/requires Engineering Requirement Registry evaluation/);
  });

  it('prevents raw uploads from silently becoming render truth', () => {
    const surveyEvidence = {
      ...evidenceFromDuplicateHygiene(),
      rawPhotoCount: 28,
      canonicalEvidenceCount: 0,
      photos: [],
    } satisfies EngineeringSurveyEvidence;
    const bundle = buildDocumentProvenanceBundle({
      documentId: 'permit:raw-count-only',
      documentType: 'permit_package',
      surveyEvidence,
      cad: mockCad(),
      generatedAt,
    });
    const rawGuard = bundle.auditGuards.find(guard => guard.guardCode === 'raw_upload_count_not_render_truth');

    expect(rawGuard?.passed).toBe(false);
    expect(rawGuard?.message).toContain('raw uploads cannot become render truth');
  });

  it('builds deterministic engineering dependency graphs and evidence-backed geometry wrappers', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const cad = mockCad();
    const first = buildDocumentProvenanceBundle({
      documentId: 'permit:deterministic-graph',
      documentType: 'permit_package',
      surveyEvidence,
      cad,
      generatedAt,
    });
    const secondGraph = buildEngineeringDependencyGraph({
      graphId: 'permit:deterministic-graph.dependency-graph',
      generatedAt,
      surveyEvidence,
      sections: first.sections,
      cad,
    });
    const geometryInputs = buildEvidenceBackedGeometryInputs({ surveyEvidence, cad });

    expect(first.dependencyGraph?.deterministicHash).toBe(secondGraph.deterministicHash);
    expect(first.dependencyGraph?.nodes.map(node => node.id)).toEqual(first.dependencyGraph?.nodes.map(node => node.id).sort());
    expect(geometryInputs.map(input => input.geometryInputId)).toContain('geometry:roof-layout-context');
    expect(geometryInputs.find(input => input.geometryInputId === 'geometry:roof-layout-context')?.canonicalEvidenceIds).toHaveLength(1);
    expect(geometryInputs.flatMap(input => input.deterministicNotes).join(' ')).toContain('does not extract geometry');
    expect(runDocumentAuditGuards(first, { surveyEvidence }).every(guard => guard.severity !== 'error' || guard.passed)).toBe(true);
  });
});
