import { describe, expect, it } from 'vitest';

import type { CADModel } from '@/lib/cad/types';
import { buildDocumentProvenanceBundle } from '@/lib/documentProvenance';
import { buildRenderContext } from '@/lib/drafting/renderContext';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { PermitInput } from '@/lib/permit/types';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildEngineeringRequirementEvaluation } from '@/lib/survey/evidence/engineeringRequirements';
import { buildProjectSurveyEvidenceHygiene } from '@/lib/survey/evidence/sessionGrouping';
import {
  assertEngineeringDecisionProvenanceGuards,
  buildDecisionAwareBOMMetadata,
  buildDecisionAwareReadinessSummary,
  buildDecisionAwareSLDMetadata,
  buildEngineeringDecisionProvenanceBundle,
  runEngineeringDecisionAuditGuards,
  type EngineeringDecisionProvenanceRecord,
} from './index';

const generatedAt = '2026-05-23T10:00:00.000Z';
const baseTime = Date.parse('2026-05-23T09:00:00.000Z');

function survey(index: number): SiteSurvey {
  const submittedAt = new Date(baseTime + index * 60_000).toISOString();
  return {
    id: `survey-decision-${index}`,
    clientId: 'client-decision-1',
    projectId: 'project-decision-1',
    createdBy: 'tech-decision-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '456 Decision Trace Ave',
    surveyData: {
      schemaVersion: '2.0',
      photos: [],
      siteOverview: { inspectorName: 'Decision Tech' },
    },
    inspectorName: 'Decision Tech',
    notes: null,
    externalSurveyId: `external-decision-${index}`,
    deliveryId: `delivery-decision-${index}`,
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

function evidenceFromDuplicateHygiene(count = 7): EngineeringSurveyEvidence {
  const surveys = Array.from({ length: count }, (_, index) => {
    const s = survey(index + 1);
    return { survey: s, files: repeatedFiles(s.id) };
  });
  const hygiene = buildProjectSurveyEvidenceHygiene({
    projectId: 'project-decision-1',
    surveys,
    generatedAt,
  });
  const requirementEvaluation = buildEngineeringRequirementEvaluation({
    canonicalManifest: hygiene.canonicalManifest,
    traceability: hygiene.traceability,
  });
  return {
    projectId: 'project-decision-1',
    surveyId: hygiene.canonicalSurveyId ?? `survey-decision-${count}`,
    photos: hygiene.canonicalManifest.items.map(item => ({
      id: item.evidenceId,
      projectId: item.projectId ?? 'project-decision-1',
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

function permitInput(): PermitInput {
  return {
    project: {
      projectName: 'Decision Provenance Project',
      clientName: 'Decision Client',
      address: '456 Decision Trace Ave',
      designer: 'SolarPro Test',
      date: '2026-05-23',
      notes: '',
      systemType: 'roof',
      mainPanelAmps: 200,
      mainPanelBrand: 'Square D',
      utilityMeter: 'utility-meter-1',
      utilityName: 'Test Utility',
      acDisconnect: true,
      dcDisconnect: true,
      productionMeter: false,
      rapidShutdown: true,
      conduitType: 'EMT',
      wireGauge: '#10 AWG',
      wireLength: 65,
      interconnectionMethod: 'LOAD_SIDE',
      panelBusRating: 225,
      ahjRoofSetbackIn: 18,
      ahjRidgeSetbackIn: 18,
      panelPositions: [{ id: 'panel-1', lat: 34, lng: -118, orientation: 'portrait' }],
      roofPlanes: [{ id: 'roof-1', vertices: [], azimuth: 180, area: 500 }],
    },
    system: {
      totalDcKw: 4,
      totalAcKw: 3.8,
      totalPanels: 10,
      dcAcRatio: 1.05,
      topology: 'string',
      inverters: [
        {
          manufacturer: 'Enphase',
          model: 'IQ8',
          type: 'string',
          acOutputKw: 3.8,
          maxDcVoltage: 600,
          efficiency: 0.97,
          ulListing: 'UL 1741',
          strings: [
            {
              label: 'PV-1',
              panelCount: 10,
              panelManufacturer: 'REC',
              panelModel: 'Alpha',
              panelWatts: 400,
              panelVoc: 48,
              panelIsc: 10.5,
              wireGauge: '#10 AWG',
              wireLength: 65,
              isc: 10.5,
              ampacity: 30,
              ocpd: 20,
            },
          ],
        },
      ],
    },
    compliance: {
      overallStatus: 'PASS',
      jurisdiction: { state: 'CA', necVersion: '2023', ahj: 'Test AHJ' },
    },
    bom: [
      {
        id: 'bom-inverter-1',
        category: 'Electrical',
        manufacturer: 'Enphase',
        model: 'IQ8',
        partNumber: 'IQ8-TEST',
        quantity: 1,
        unit: 'ea',
        necReference: 'NEC 110.3(B)',
        derivedFrom: 'system.inverters[0]',
      },
    ],
  };
}

describe('Engineering Decision Provenance v1', () => {
  it('retains decision provenance lineage with evidence, requirements, rules, dependencies, and explicit output metadata', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const cad = mockCad();
    const permit = permitInput();
    const bundle = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:decision-lineage.decision-provenance',
      generatedAt,
      surveyEvidence,
      cad,
      permitInput: permit,
      renderContextIds: ['renderContext:primary'],
      includeDocumentMetadataDecisions: true,
    });
    const conductor = bundle.decisionRecords.find(record => record.decisionType === 'conductor_sizing');
    const readiness = buildDecisionAwareReadinessSummary(bundle);
    const bomMetadata = buildDecisionAwareBOMMetadata({ bomItems: permit.bom, decisionBundle: bundle });
    const sldMetadata = buildDecisionAwareSLDMetadata({ decisionBundle: bundle });

    expect(conductor?.decisionId).toBe('decision:conductor_sizing');
    expect(conductor?.requirementIds).toContain('main_service_panel');
    expect(conductor?.canonicalEvidenceIds.length).toBeGreaterThan(0);
    expect(conductor?.dependencyNodeIds).toContain('requirement:main_service_panel');
    expect(conductor?.governingRules.map(rule => rule.ruleId)).toContain('NEC-690.8');
    expect(bundle.auditGuards.every(guard => guard.severity !== 'error' || guard.passed)).toBe(true);
    expect(readiness.readinessStatus).toBe('decision_provenance_available');
    expect(bomMetadata[0]?.decisionIds).toContain('decision:bom_derivation');
    expect(sldMetadata.decisionIds).toContain('decision:sld_metadata');
  });

  it('adds engineering decision nodes to the dependency graph deterministically', () => {
    const surveyEvidence = evidenceFromDuplicateHygiene();
    const cad = mockCad();
    const permit = permitInput();
    const decisionBundle = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:decision-graph.decision-provenance',
      generatedAt,
      surveyEvidence,
      cad,
      permitInput: permit,
    });
    const first = buildDocumentProvenanceBundle({
      documentId: 'permit:decision-graph',
      documentType: 'permit_package',
      surveyEvidence,
      cad,
      permitInput: permit,
      decisionProvenance: decisionBundle,
      generatedAt,
    });
    const second = buildDocumentProvenanceBundle({
      documentId: 'permit:decision-graph',
      documentType: 'permit_package',
      surveyEvidence,
      cad,
      permitInput: permit,
      decisionProvenance: decisionBundle,
      generatedAt,
    });

    expect(first.dependencyGraph?.deterministicHash).toBe(second.dependencyGraph?.deterministicHash);
    expect(first.dependencyGraph?.nodes.map(node => node.id)).toContain('decision:conductor_sizing');
    expect(first.dependencyGraph?.nodes.map(node => node.id)).toContain('documentSection:BOM.equipment-schedule');
    expect(first.dependencyGraph?.edges.some(edge => edge.edgeType === 'decision_uses_requirement')).toBe(true);
    expect(first.dependencyGraph?.edges.some(edge => edge.edgeType === 'decision_feeds_render_output')).toBe(true);
  });

  it('surfaces fallback/default assumptions as explicit decision events', () => {
    const permit = permitInput();
    delete (permit.project as any).interconnectionMethod;
    delete (permit.project as any).wireLength;
    delete (permit.project as any).wireGauge;
    delete (permit.system.inverters[0] as any).strings[0].wireGauge;
    const bundle = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:fallbacks.decision-provenance',
      generatedAt,
      surveyEvidence: evidenceFromDuplicateHygiene(),
      cad: mockCad(),
      permitInput: permit,
    });

    expect(bundle.fallbackDecisionIds).toContain('decision:conductor_sizing');
    expect(bundle.fallbackDecisionIds).toContain('decision:utility_interconnection_assumption');
    expect(bundle.decisionRecords.find(record => record.decisionId === 'decision:conductor_sizing')?.decisionInputs.some(input => input.deterministicRole === 'fallback_default')).toBe(true);
    expect(bundle.auditGuards.find(guard => guard.guardCode === 'fallback_assumptions_documented')?.passed).toBe(true);
  });

  it('keeps decision provenance stable when duplicate uploads collapse to the same canonical evidence', () => {
    const withDuplicates = evidenceFromDuplicateHygiene(7);
    const sameCanonicalWithDifferentRawAuditCount = {
      ...withDuplicates,
      rawPhotoCount: withDuplicates.rawPhotoCount + 100,
    } satisfies EngineeringSurveyEvidence;
    const permit = permitInput();
    const first = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:duplicate-stability.decision-provenance',
      generatedAt,
      surveyEvidence: withDuplicates,
      cad: mockCad(),
      permitInput: permit,
    });
    const second = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:duplicate-stability.decision-provenance',
      generatedAt,
      surveyEvidence: sameCanonicalWithDifferentRawAuditCount,
      cad: mockCad(),
      permitInput: permit,
    });

    expect(withDuplicates.rawPhotoCount).toBeGreaterThan(withDuplicates.canonicalEvidenceCount);
    expect(first.canonicalEvidenceIds).toEqual(second.canonicalEvidenceIds);
    expect(first.deterministicHash).toBe(second.deterministicHash);
  });

  it('preserves decision provenance through render contexts', () => {
    const bundle = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:render-survival.decision-provenance',
      generatedAt,
      surveyEvidence: evidenceFromDuplicateHygiene(),
      cad: mockCad(),
      permitInput: permitInput(),
    });
    const ctx = buildRenderContext(mockCad(), { decisionProvenance: bundle });

    expect(ctx.decisionProvenance?.bundleId).toBe('permit:render-survival.decision-provenance');
    expect(ctx.decisionProvenance?.decisionIds).toContain('decision:sld_metadata');
    expect(ctx.decisionProvenance?.auditGuards.find(guard => guard.guardCode === 'render_outputs_require_decision_provenance')?.passed).toBe(true);
  });

  it('fails audit guards when decision lineage is missing', () => {
    const base = buildEngineeringDecisionProvenanceBundle({
      bundleId: 'permit:missing-lineage.decision-provenance',
      generatedAt,
      surveyEvidence: evidenceFromDuplicateHygiene(),
      cad: mockCad(),
      permitInput: permitInput(),
    }).decisionRecords[0];
    const broken: EngineeringDecisionProvenanceRecord = {
      ...base,
      dependencyNodeIds: [],
      derivedFrom: [],
      requirementIds: [],
      documentSectionIds: [],
      governingRules: [],
    };
    const guards = runEngineeringDecisionAuditGuards([broken], { renderOutputExpected: true });

    expect(guards.find(guard => guard.guardCode === 'decision_lineage_required')?.passed).toBe(false);
    expect(guards.find(guard => guard.guardCode === 'document_sections_require_governing_rules')?.passed).toBe(true);
    expect(() => assertEngineeringDecisionProvenanceGuards({
      bundleId: 'broken',
      generatedAt,
      decisionRecords: [broken],
      decisionIds: [broken.decisionId],
      requirementIds: [],
      canonicalEvidenceIds: [],
      originatingSurveyIds: [],
      dependencyNodeIds: [],
      documentSectionIds: [],
      renderContextIds: [],
      governingRuleIds: [],
      fallbackDecisionIds: [],
      deterministicHash: 'broken',
      deterministicNotes: [],
      auditGuards: guards,
    })).toThrow(/requires dependency/);
  });
});
