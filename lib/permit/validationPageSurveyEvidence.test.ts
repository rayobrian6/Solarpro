import { describe, expect, it } from 'vitest';

import type { CADModel } from '@/lib/cad/types';
import { buildEngineeringRequirementEvaluation } from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { CanonicalInput, PermitInput } from './types';
import { pageValidationSummary } from './sections/validationPage';

function mockPermitInput(surveyEvidence?: EngineeringSurveyEvidence): PermitInput {
  return {
    project: {
      projectName: 'Evidence Plan Set',
      clientName: 'Solar Customer',
      address: '123 Solar Evidence Way',
      designer: 'SolarPro',
      date: '2025-01-01',
      notes: '',
      systemType: 'roof',
      mainPanelAmps: 200,
      mainPanelBrand: 'Siemens',
      utilityMeter: 'standard',
      acDisconnect: true,
      dcDisconnect: true,
      productionMeter: false,
      rapidShutdown: true,
      conduitType: 'EMT',
      wireGauge: '10 AWG',
      wireLength: 75,
    },
    system: {
      totalDcKw: 8,
      totalAcKw: 7.6,
      totalPanels: 20,
      dcAcRatio: 1.05,
      topology: 'string_inverter',
      inverters: [],
    },
    compliance: {
      overallStatus: 'pass',
    },
    surveyEvidence,
  };
}


function mockTraceability(): EngineeringSurveyEvidence['traceability'] {
  const metadataCompleteness = {
    hasFileUrl: true,
    hasFilename: true,
    hasMimeType: true,
    hasCaptureTimestamp: true,
    hasSubmittedCategory: true,
    hasSiteSurveyFileId: true,
    hasSurveyTechnician: false,
  };
  const canonicalEvidence = [
    ['evidence-panel', 'survey-7', 'main_service_panel', 'Main Service Panel'],
    ['evidence-meter', 'survey-7', 'meter', 'Utility Meter'],
    ['evidence-roof', 'survey-7', 'roof_plane', 'Roof Plane'],
    ['evidence-overview', 'survey-7', 'overview', 'Site Overview'],
  ].map(([canonicalEvidenceId, originatingSurveyId, evidenceCategory, evidenceCategoryLabel]) => ({
    canonicalEvidenceId,
    originatingSurveyId,
    originatingSurveyCreatedAt: '2025-01-01T00:07:00.000Z',
    evidenceCategory: evidenceCategory as any,
    evidenceCategoryLabel,
    duplicateGroupSize: 7,
    selectionReason: 'duplicate collapse representative; newest timestamp wins after metadata score ties; deterministic tie-break order uses stable evidence id',
    evidenceTruthSource: 'canonical_manifest_v1' as const,
    requirementSatisfied: true,
    requirementConfidenceSource: 'canonical_evidence_confidence' as const,
    metadataCompleteness,
    evidenceSource: 'site_survey_files' as const,
    evidenceConfidence: 'high' as const,
    fileUrl: `https://cdn.example.com/${canonicalEvidenceId}.jpg`,
    filename: `${canonicalEvidenceId}.jpg`,
    sceneGroup: 'evidence_duplicate_group_1',
  }));
  const requirements = canonicalEvidence.map(record => ({
    requirementCategory: record.evidenceCategory,
    requirementLabel: record.evidenceCategoryLabel,
    requirementDomain: record.evidenceCategory === 'roof_plane' ? 'roof' as const : record.evidenceCategory === 'overview' ? 'general' as const : 'electrical' as const,
    engineeringBucket: record.evidenceCategory === 'roof_plane' ? 'roofLayoutEvidence' as const : record.evidenceCategory === 'overview' ? 'sitePlanEvidence' as const : 'electricalEvidence' as const,
    requirementSatisfied: true,
    canonicalEvidenceId: record.canonicalEvidenceId,
    originatingSurveyId: record.originatingSurveyId,
    originatingSurveyCreatedAt: record.originatingSurveyCreatedAt,
    evidenceCategory: record.evidenceCategory,
    duplicateGroupSize: record.duplicateGroupSize,
    selectionReason: record.selectionReason,
    evidenceTruthSource: 'canonical_manifest_v1' as const,
    requirementConfidenceSource: record.requirementConfidenceSource,
    metadataCompleteness,
    deterministicReasoningPath: ['canonicalManifest category match', 'duplicate hygiene representative selected'],
  }));
  return {
    evidenceTruthSource: 'canonical_manifest_v1',
    requirements,
    canonicalEvidence,
    surveyLineage: Array.from({ length: 7 }, (_, index) => ({
      surveyId: `survey-${index + 1}`,
      submittedAt: `2025-01-01T00:0${index + 1}:00.000Z`,
      technician: 'James',
      duplicateStatus: index === 6 ? 'canonical' : 'overlapping_duplicate',
      rawPhotoCount: 4,
      canonicalEvidenceCount: index === 6 ? 4 : 0,
      categoryCoverage: ['main_service_panel', 'meter', 'roof_plane', 'overview'],
      isCanonical: index === 6,
    })),
    missingRequirements: [],
  };
}


function mockRequirementEvaluation(): EngineeringSurveyEvidence['requirementEvaluation'] {
  return buildEngineeringRequirementEvaluation({
    canonicalManifest: {
      manifestVersion: 1,
      projectId: 'project-evidence-001',
      surveyId: 'survey-evidence-001',
      generatedAt: '2025-01-01T00:00:00.000Z',
      sourceOfTruth: 'site_surveys+site_survey_files',
      surveyTechnician: 'James',
      items: [],
      coverage: [],
      requiredMissing: [],
      warnings: [],
      summary: {
        totalItems: 4,
        classifiedItems: 4,
        qualityCheckedItems: 0,
        duplicateCheckedItems: 4,
        aiProcessedItems: 0,
        engineeringReviewedItems: 0,
        permitConsumedItems: 0,
        confidence: 'high',
        completeness: 'partial',
      },
      openSourceBoundaries: { webRuntime: [], pythonWorker: [], futureOnly: [] },
    },
    traceability: mockTraceability(),
  });
}

function mockSurveyEvidence(): EngineeringSurveyEvidence {
  return {
    projectId: 'project-evidence-001',
    surveyId: 'survey-evidence-001',
    rawPhotoCount: 28,
    canonicalEvidenceCount: 4,
    evidenceTruthSource: 'canonical_manifest_v1',
    traceability: mockTraceability(),
    requirementEvaluation: mockRequirementEvaluation(),
    photos: [
      {
        id: 'main_panel_open',
        projectId: 'project-evidence-001',
        surveyId: 'survey-evidence-001',
        fileUrl: 'https://cdn.example.com/panel.jpg',
        fileId: 'main_panel_open',
        sourceCategory: 'panel',
        category: 'main_service_panel',
        confidence: 0.75,
      },
      {
        id: 'meter',
        projectId: 'project-evidence-001',
        surveyId: 'survey-evidence-001',
        fileUrl: 'https://cdn.example.com/meter.jpg',
        fileId: 'meter',
        sourceCategory: 'meter',
        category: 'meter',
        confidence: 0.75,
      },
      {
        id: 'roof_overview',
        projectId: 'project-evidence-001',
        surveyId: 'survey-evidence-001',
        fileUrl: 'https://cdn.example.com/roof.jpg',
        fileId: 'roof_overview',
        sourceCategory: 'roof',
        category: 'roof_plane',
        confidence: 0.75,
      },
      {
        id: 'overview',
        projectId: 'project-evidence-001',
        surveyId: 'survey-evidence-001',
        fileUrl: 'https://cdn.example.com/site.jpg',
        fileId: 'overview',
        sourceCategory: 'site',
        category: 'overview',
        confidence: 0.75,
      },
    ],
    missingCategories: [],
    completeness: 'sufficient',
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
      busbarRatingAmps: 200,
      interconnectionPoint: 'main_panel',
      rafterSize: '2x6',
      rafterSpacingInches: 24,
      roofMaterial: 'composition_shingle',
      roofPitchDegrees: 22,
    },

    manifestV1: {
      itemCount: 4,
      lifecycleState: 'classified',
      aiExtractionStatus: 'not_started',
      qualityStatus: 'not_processed',
      duplicateStatus: 'duplicate_checked',
      engineeringBridge: {
        readiness: 'needs_review',
        electricalEvidenceCount: 2,
        structuralEvidenceCount: 0,
        roofLayoutEvidenceCount: 1,
        sitePlanEvidenceCount: 1,
        cadAutomationStatus: 'not_started',
      },
    },
    source: {
      pipelineVersion: 2,
      normalizedAt: '2025-01-01T00:00:00.000Z',
    },
  };
}

function mockCanonical(): CanonicalInput {
  return {
    systemType: 'roof',
    module: {
      manufacturer: 'REC',
      model: 'REC400AA',
      wattage: 400,
      voc: 49.1,
      isc: 10.2,
    },
    mountSystem: 'Roof attachment',
    site: {
      windSpeed: 110,
      exposureCategory: 'B',
      groundSnowLoad: 0,
      ahj: 'Sample AHJ',
      state: 'CA',
      seismicSDC: 'D',
    },
    structure: {
      rafterSize: '2x6',
      rafterSpacingIn: 24,
      attachSpacingIn: 48,
      pileDepthFt: 6,
      pileSpacingFt: 8,
      tiltDeg: 20,
      groundClearIn: 24,
      postEmbedFt: 3.5,
      postSpacingFt: 8,
      panelHeightFt: 6,
      soilResistance: 200,
    },
    electrical: {
      totalPanels: 20,
      totalDcKw: 8,
      strings: 2,
      inverterModel: 'SE7600H',
      inverterKw: 7.6,
    },
    layoutDimensions: {
      totalLengthFt: 34,
      totalHeightFt: 11,
      panelWidthIn: 41,
      panelHeightIn: 74,
      rowSpacingFt: 1,
      source: 'test CAD geometry',
    },
  } as unknown as CanonicalInput;
}

describe('pageValidationSummary survey evidence rendering', () => {
  it('renders survey evidence traceability when evidence is attached', () => {
    const html = pageValidationSummary(
      mockPermitInput(mockSurveyEvidence()),
      mockCanonical(),
      {} as CADModel,
      15,
      15,
    );

    expect(html).toContain('Survey Evidence Audit');
    expect(html).toContain('Photo & Field Traceability');
    expect(html).toContain('items: 4 | source: canonical bridge summary');
    expect(html).toContain('raw uploads 4 audit-only');
    expect(html).toContain('canonical evidence 4');
    expect(html).toContain('completeness: SUFFICIENT');
    expect(html).toContain('main_service_panel: 1');
    expect(html).toContain('meter: 1');
    expect(html).toContain('survey evidence fallbacks, when used, are explicitly labeled and visible');
    expect(html).toContain('needs_review');
    expect(html).toContain('Engineering Requirement Registry');
    expect(html).toContain('Missing Requirement Analysis');
    expect(html).toContain('Requirement Provenance');
    expect(html).toContain('engineering_requirement_registry_v1');
    expect(html).toContain('Utility Bill: inactive');
    expect(html).toContain('Electrical</td>');
    expect(html).toContain('evidence items: 2');
    expect(html).toContain('Requirement Evidence Traceability');
    expect(html).toContain('Canonical Evidence Provenance');
    expect(html).toContain('Survey Lineage');
    expect(html).toContain('SATISFIED by evidence-panel');
    expect(html).toContain('origin survey survey-7');
    expect(html).toContain('raw uploads 4 audit-only');
  });

  it('renders a no-evidence warning without failing canonical validation rendering', () => {
    const html = pageValidationSummary(
      mockPermitInput(),
      mockCanonical(),
      {} as CADModel,
      15,
      15,
    );

    expect(html).toContain('No survey evidence attached to this permit run');
    expect(html).toContain('plan-set assumptions are based on design/canonical inputs only');
    expect(html).toContain('ALL CHECKS PASSED');
  });

  it('does not manufacture bridge counts from raw duplicated photo arrays when manifest counts are canonical', () => {
    const duplicated = mockSurveyEvidence();
    duplicated.photos = Array.from({ length: 7 }).flatMap(() => mockSurveyEvidence().photos);
    duplicated.rawPhotoCount = 28;
    duplicated.canonicalEvidenceCount = 4;
    duplicated.manifestV1 = {
      itemCount: 4,
      lifecycleState: 'classified',
      aiExtractionStatus: 'not_started',
      qualityStatus: 'not_processed',
      duplicateStatus: 'duplicate_checked',
      engineeringBridge: {
        readiness: 'needs_review',
        electricalEvidenceCount: 2,
        structuralEvidenceCount: 0,
        roofLayoutEvidenceCount: 1,
        sitePlanEvidenceCount: 1,
        cadAutomationStatus: 'not_started',
      },
    };

    const html = pageValidationSummary(
      mockPermitInput(duplicated),
      mockCanonical(),
      {} as CADModel,
      15,
      15,
    );

    expect(html).toContain('items: 4 | source: canonical bridge summary');
    expect(html).toContain('raw uploads 4 audit-only');
    expect(html).toContain('canonical evidence 4');
    expect(html).toContain('evidence items: 2');
    expect(html).toContain('main_service_panel: 7 | meter: 7 | roof_plane: 7 | overview: 7');
    expect(html).not.toContain('28 canonical evidence item(s)');
    expect(html).not.toContain('<td style="font-family:"SolarPro Mono","SolarPro Symbols";font-size:7px;color:#000;">28</td>');
  });

  it('renders missing field evidence as missing instead of crashing', () => {
    const partialEvidence = {
      ...mockSurveyEvidence(),
      fieldEvidence: undefined,
    } satisfies EngineeringSurveyEvidence;

    const html = pageValidationSummary(
      mockPermitInput(partialEvidence),
      mockCanonical(),
      {} as CADModel,
      15,
      15,
    );

    expect(html).toContain('Evidence Manifest v1');
    expect(html).toContain('Physical Data</td>');
    expect(html).toContain('missing');
    expect(html).toContain('planes: 0');
    expect(html).toContain('MSP: —A');
  });

});
