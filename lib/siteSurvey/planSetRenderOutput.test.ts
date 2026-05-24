import { describe, expect, it } from 'vitest';

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildProfessionalSurveyReadinessReport } from './professionalSurveyReadinessReport';
import { buildProfessionalPlanSetRenderPackage } from './planSetRenderOutput';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'plan-render-001',
    clientId: 'client-001',
    projectId: 'project-plan-001',
    createdBy: 'user-001',
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T11:00:00Z',
    status: 'completed',
    source: 'standalone',
    addressSnapshot: '123 Plan Render Way, Las Vegas, NV',
    surveyData: {
      schemaVersion: '2.0',
      systemType: 'roof',
      location: { lat: 36.17, lng: -115.14, address: '123 Plan Render Way' },
      geometry: {
        roofPlanes: [
          {
            id: 'roof-a',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 36.1700, lng: -115.1400 },
              { lat: 36.1702, lng: -115.1400 },
              { lat: 36.1702, lng: -115.1404 },
              { lat: 36.1700, lng: -115.1404 },
            ],
          },
        ],
        obstructions: [],
        setbacks: [{ edges: ['eave', 'rake'], distanceIn: 36 }],
        usableAreaSqFt: 620,
      },
      structural: {
        rafterSpacingIn: 24,
        rafterSize: '2x6',
        deckingThicknessIn: 0.5,
        windExposure: 'C',
        roofCondition: 'good',
        roofAgeYears: 8,
        atticAccess: true,
        roofMaterial: 'composition_shingle',
        roofPitch: '5/12',
      },
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 200,
        breakerSpacesAvailable: '5+',
        serviceEntrance: 'overhead',
        meterType: 'standard',
        interconnectionPoint: 'main_panel',
        panelBrand: 'siemens',
        hasSubPanel: false,
      },
    },
    inspectorName: 'Plan Render Tech',
    notes: 'Professional plan-set render fixture.',
    externalSurveyId: 'external-plan-001',
    deliveryId: 'delivery-plan-001',
    ...overrides,
  };
}

function files(): SiteSurveyFile[] {
  return [
    { id: 'file-roof', surveyId: 'plan-render-001', fileUrl: 'https://cdn.example.test/roof_overview.jpg', fileType: 'photo', label: 'roof overview', filename: 'roof_overview.jpg', mimeType: 'image/jpeg', createdAt: '2026-05-01T10:05:00Z' },
    { id: 'file-panel', surveyId: 'plan-render-001', fileUrl: 'https://cdn.example.test/main_service_panel.jpg', fileType: 'photo', label: 'main panel', filename: 'main_service_panel.jpg', mimeType: 'image/jpeg', createdAt: '2026-05-01T10:06:00Z' },
    { id: 'file-meter', surveyId: 'plan-render-001', fileUrl: 'https://cdn.example.test/utility_meter.jpg', fileType: 'photo', label: 'utility meter', filename: 'utility_meter.jpg', mimeType: 'image/jpeg', createdAt: '2026-05-01T10:07:00Z' },
  ];
}

describe('Professional Plan-Set Render Output V1', () => {
  it('builds deterministic professional multi-sheet SVG preview package', () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const pkg = buildProfessionalPlanSetRenderPackage(report);
    const repeated = buildProfessionalPlanSetRenderPackage(report);

    expect(pkg.schemaVersion).toBe('professional_plan_set_render_package_v1');
    expect(pkg.mode).toBe('deterministic_svg_plan_set_preview_review_only');
    expect(pkg.packageHash).toBe(repeated.packageHash);
    expect(pkg.sheets.map(sheet => sheet.sheetNumber)).toEqual(['A-000', 'A-101', 'A-201']);
    expect(pkg.sheets.map(sheet => sheet.sheetType)).toEqual(['cover_summary', 'site_plan_render', 'evidence_review']);
    expect(pkg.summary.sheetCount).toBe(3);
    expect(pkg.htmlPreview).toContain('<!doctype html>');
    expect(pkg.htmlPreview).toContain('SolarPro Professional Plan-Set Preview');
  });

  it('renders professional visual hierarchy, title blocks, legends, annotations, and preview stamps', () => {
    const pkg = buildProfessionalPlanSetRenderPackage(buildProfessionalSurveyReadinessReport(survey(), files()));
    const sitePlan = pkg.sheets.find(sheet => sheet.sheetType === 'site_plan_render');

    expect(sitePlan?.svg).toContain('SolarPro Preview');
    expect(sitePlan?.svg).toContain('NON-AUTHORITATIVE PREVIEW');
    expect(sitePlan?.svg).toContain('Legend');
    expect(sitePlan?.svg).toContain('fire setback preview');
    expect(sitePlan?.svg).toContain('module preview');
    expect(sitePlan?.svg).toContain('MSP/Meter');
    expect(sitePlan?.svg).toContain('conduit candidate');
    expect(sitePlan?.layerOrder).toContain('roof-outlines');
    expect(sitePlan?.layerOrder).toContain('review-callouts');
    expect(sitePlan?.annotations.join('\n')).toContain('pitch/azimuth annotations');
  });

  it('includes evidence/review sheet photo tiles and confidence notes for contractor usability', () => {
    const pkg = buildProfessionalPlanSetRenderPackage(buildProfessionalSurveyReadinessReport(survey(), files()));
    const evidence = pkg.sheets.find(sheet => sheet.sheetType === 'evidence_review');

    expect(evidence?.svg).toContain('Photo Evidence / Review Callout Sheet');
    expect(evidence?.svg).toContain('Evidence Coverage');
    expect(evidence?.svg).toContain('roof_overview');
    expect(evidence?.svg).toContain('msp_electrical_panel');
    expect(evidence?.svg).toContain('meter');
    expect(evidence?.annotations).toContain('photo evidence tiles');
  });

  it('enforces render-only safety boundaries without mutating source report objects', () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const beforeReport = JSON.stringify(report);
    const beforeGeometry = JSON.stringify(report.canonicalGeometry);
    const beforeCad = JSON.stringify(report.cadReadiness);
    const pkg = buildProfessionalPlanSetRenderPackage(report);

    expect(pkg.noAuthorityEnforcement).toEqual({
      readOnly: true,
      renderOutputOnly: true,
      stampedEngineeringPackage: false,
      automaticCadGenerationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBomAllowed: false,
    });
    expect(pkg.sheets.every(sheet => sheet.noAuthorityEnforcement.cadSolverExecutionAllowed === false)).toBe(true);
    expect(JSON.stringify(report)).toBe(beforeReport);
    expect(JSON.stringify(report.canonicalGeometry)).toBe(beforeGeometry);
    expect(JSON.stringify(report.cadReadiness)).toBe(beforeCad);
  });

  it('renders blocked/review states visibly without promoting output to authority', () => {
    const blocked = buildProfessionalSurveyReadinessReport(survey({
      id: 'plan-render-blocked',
      surveyData: {
        schemaVersion: '2.0',
        systemType: 'roof',
        location: { lat: 36.17, lng: -115.14 },
        geometry: {
          roofPlanes: [
            {
              id: 'bowtie', pitch: 22, azimuth: 180, area: 850,
              vertices: [
                { lat: 36.1700, lng: -115.1400 },
                { lat: 36.1702, lng: -115.1404 },
                { lat: 36.1702, lng: -115.1400 },
                { lat: 36.1700, lng: -115.1404 },
              ],
            },
          ],
        },
        electrical: { mainPanelRatingAmps: 200, interconnectionPoint: 'main_panel' },
      },
    }), files());
    const pkg = buildProfessionalPlanSetRenderPackage(blocked);

    expect(pkg.summary.renderReadinessState).toBe('render_blocked');
    expect(pkg.sheets[0].svg).toContain('render_blocked');
    expect(pkg.sheets[1].svg).toContain('Geometry intelligence requires blocker review');
    expect(pkg.noAuthorityEnforcement.stampedEngineeringPackage).toBe(false);
  });
});
