import { describe, expect, it } from 'vitest';

import type { CADModel } from '@/lib/cad/types';
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

function mockSurveyEvidence(): EngineeringSurveyEvidence {
  return {
    projectId: 'project-evidence-001',
    surveyId: 'survey-evidence-001',
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
    expect(html).toContain('completeness: SUFFICIENT');
    expect(html).toContain('main_service_panel: 1');
    expect(html).toContain('meter: 1');
    expect(html).toContain('survey evidence fallbacks, when used, are explicitly labeled and visible');
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
});
