import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { enrichSurvey } from './enrichSurvey';
import { normalizeSurvey } from './normalizeSurvey';
import {
  buildOperatorGeometryIntelligenceSummary,
  buildGeometryIntelligenceReport,
  type GeometryIntelligenceReportV1,
} from './geometryIntelligence';
import {
  buildCanonicalSurveyGeometry,
  buildSurveyCADReadiness,
  parseProfessionalSiteSurvey,
  type CanonicalSurveyGeometryV1,
  type ProfessionalSiteSurveyEvidenceBundleV1,
  type SurveyCADReadinessV1,
} from './professionalSurveyParser';
import type { EnrichedSiteSurvey, RawSurveyPayload, SurveyPhotoRef } from './types';

export type OperatorSurveyReadinessState = 'blocked' | 'review_required' | 'geometry_ready' | 'cad_preview_ready';

export interface ProfessionalSurveyReadinessReportV1 {
  schemaVersion: 'professional_survey_readiness_report_v1';
  persistenceMode: 'read_only_review_report_v1';
  source: {
    surveyId: string;
    projectId: string | null;
    clientId: string;
    status: SiteSurvey['status'];
    source: SiteSurvey['source'];
    externalSurveyId: string | null;
    fileCount: number;
    photoCount: number;
    hasSurveyData: boolean;
  };
  readinessState: OperatorSurveyReadinessState;
  labels: {
    surveyDerived: true;
    parserDerived: true;
    canonicalized: true;
    previewOnly: true;
    reviewRequired: boolean;
    nonAuthoritative: true;
  };
  evidence: ProfessionalSiteSurveyEvidenceBundleV1;
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  geometryIntelligence: GeometryIntelligenceReportV1;
  summaries: {
    systemType: EnrichedSiteSurvey['systemType'];
    roofPlaneCount: number;
    obstructionCount: number;
    setbackCount: number;
    canonicalRoofPlaneCount: number;
    invalidCanonicalRoofPlaneCount: number;
    cadPreviewEligible: boolean;
    cadPreviewBuilt: boolean;
    confidenceGaps: string[];
    missingRequiredFields: string[];
    blockingIssues: string[];
    warnings: string[];
    geometryIntelligence: ReturnType<typeof buildOperatorGeometryIntelligenceSummary>;
  };
  noAuthorityEnforcement: {
    dbWritesAllowed: false;
    cadSolverExecutionAllowed: false;
    productionCADMutationAllowed: false;
    downstreamEngineeringAllowed: false;
    downstreamPermitAllowed: false;
    downstreamBOMAllowed: false;
  };
  deterministicNotes: string[];
}

export function buildProfessionalSurveyReadinessReport(
  survey: SiteSurvey,
  files: SiteSurveyFile[] = [],
): ProfessionalSurveyReadinessReportV1 {
  const enriched = siteSurveyToEnrichedSurvey(survey, files);
  const evidence = parseProfessionalSiteSurvey(enriched);
  const canonicalGeometry = buildCanonicalSurveyGeometry(enriched, evidence);
  const cadReadiness = buildSurveyCADReadiness(enriched, evidence, canonicalGeometry);
  const geometryIntelligence = buildGeometryIntelligenceReport({ evidence, canonicalGeometry, cadReadiness });
  const operatorGeometryIntelligence = buildOperatorGeometryIntelligenceSummary(geometryIntelligence);
  const readinessState = resolveOperatorReadinessState(canonicalGeometry, cadReadiness);
  const blockingIssues = dedupe([...evidence.blockingIssues, ...canonicalGeometry.blockingIssues, ...cadReadiness.blockingIssues]);
  const warnings = dedupe([...canonicalGeometry.warnings, ...cadReadiness.warnings]);
  const missingRequiredFields = dedupe([...evidence.missingRequiredFields, ...cadReadiness.requiredReviewItems]);
  const confidenceGaps = collectConfidenceGaps(evidence);

  return {
    schemaVersion: 'professional_survey_readiness_report_v1',
    persistenceMode: 'read_only_review_report_v1',
    source: {
      surveyId: survey.id,
      projectId: survey.projectId,
      clientId: survey.clientId,
      status: survey.status,
      source: survey.source,
      externalSurveyId: survey.externalSurveyId,
      fileCount: files.length,
      photoCount: files.filter(file => file.fileType === 'photo').length,
      hasSurveyData: Boolean(survey.surveyData),
    },
    readinessState,
    labels: {
      surveyDerived: true,
      parserDerived: true,
      canonicalized: true,
      previewOnly: true,
      reviewRequired: readinessState !== 'cad_preview_ready',
      nonAuthoritative: true,
    },
    evidence,
    canonicalGeometry,
    cadReadiness,
    geometryIntelligence,
    summaries: {
      systemType: enriched.systemType,
      roofPlaneCount: enriched.geometry.roofPlanes.length,
      obstructionCount: enriched.geometry.obstructions.length,
      setbackCount: enriched.geometry.setbacks.length,
      canonicalRoofPlaneCount: canonicalGeometry.roofPlanes.length,
      invalidCanonicalRoofPlaneCount: canonicalGeometry.roofPlanes.filter(plane => !plane.valid).length,
      cadPreviewEligible: readinessState === 'cad_preview_ready',
      cadPreviewBuilt: cadReadiness.cadInputPreview !== null,
      confidenceGaps,
      missingRequiredFields,
      blockingIssues,
      warnings,
      geometryIntelligence: operatorGeometryIntelligence,
    },
    noAuthorityEnforcement: {
      dbWritesAllowed: false,
      cadSolverExecutionAllowed: false,
      productionCADMutationAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBOMAllowed: false,
    },
    deterministicNotes: [
      'Report is built from authorized survey data in memory and is not persisted as canonical geometry or production CAD truth.',
      'Report generation does not execute CAD solvers, mutate CAD state, or trigger engineering, permit, BOM, proposal, or downstream workflows.',
      'CAD readiness preview is generated only through the pure buildCADFromSurvey input-adapter boundary; it is not a solved CAD layout.',
      'Operator readiness states are review UI states only: blocked, review_required, geometry_ready, cad_preview_ready.',
    ],
  };
}

export function siteSurveyToEnrichedSurvey(survey: SiteSurvey, files: SiteSurveyFile[] = []): EnrichedSiteSurvey {
  const data = record(survey.surveyData);
  const raw: RawSurveyPayload = {
    id: survey.id,
    projectId: survey.projectId ?? 'unknown',
    location: rawLocation(data, survey),
    systemType: stringValue(data.systemType) || stringValue(data.mountType) || 'roof',
    geometry: rawGeometry(data),
    structural: rawStructural(data),
    electrical: rawElectrical(data),
    photos: files.filter(file => file.fileType === 'photo').map(fileToSurveyPhoto),
    installerNotes: survey.notes ?? stringValue(data.installerNotes) ?? null,
    inspectorName: survey.inspectorName ?? stringValue(data.inspectorName) ?? null,
    surveyedAt: survey.updatedAt ?? survey.createdAt ?? null,
  };
  return enrichSurvey(normalizeSurvey(raw));
}

function resolveOperatorReadinessState(
  geometry: CanonicalSurveyGeometryV1,
  cadReadiness: SurveyCADReadinessV1,
): OperatorSurveyReadinessState {
  if (cadReadiness.readinessStatus === 'blocked' || geometry.blockingIssues.length > 0) return 'blocked';
  if (cadReadiness.readinessStatus === 'cad_ready' && cadReadiness.canBuildCADInput && cadReadiness.cadInputPreview !== null) return 'cad_preview_ready';
  if (cadReadiness.readinessStatus === 'review_required') return 'review_required';
  if (geometry.readyForCADInput) return 'geometry_ready';
  return 'review_required';
}

function collectConfidenceGaps(evidence: ProfessionalSiteSurveyEvidenceBundleV1): string[] {
  const gaps: string[] = [];
  for (const candidate of evidence.roofGeometryCandidates) {
    if (candidate.confidence !== 'high') gaps.push(`roofPlane.${candidate.planeId}: ${candidate.confidence} confidence`);
  }
  for (const candidate of [...evidence.electricalServiceCandidates, ...evidence.structuralCandidates]) {
    if (candidate.confidence === 'low') gaps.push(`${candidate.field}: low confidence`);
  }
  return dedupe(gaps);
}

function rawLocation(data: Record<string, unknown>, survey: SiteSurvey): RawSurveyPayload['location'] {
  const location = record(data.location);
  const siteOverview = record(data.siteOverview);
  return {
    lat: numberOrNull(location.lat),
    lng: numberOrNull(location.lng),
    elevation: numberOrNull(location.elevation),
    azimuthReference: numberOrNull(location.azimuthReference),
    address: survey.addressSnapshot ?? stringValue(location.address) ?? stringValue(siteOverview.siteAddress) ?? null,
  };
}

function rawGeometry(data: Record<string, unknown>): RawSurveyPayload['geometry'] {
  const geometry = record(data.geometry);
  const obstructions = record(data.obstructions);
  return {
    roofPlanes: arrayValue(geometry.roofPlanes),
    obstructions: arrayValue(geometry.obstructions) ?? arrayValue(obstructions.obstructions),
    setbacks: arrayValue(geometry.setbacks),
    usableAreaSqFt: numberOrNull(geometry.usableAreaSqFt),
  };
}

function rawStructural(data: Record<string, unknown>): RawSurveyPayload['structural'] {
  const structural = record(data.structural);
  const roofConditions = record(data.roofConditions);
  return {
    rafterSpacingIn: scalarValue(structural.rafterSpacingIn ?? roofConditions.rafterSpacing),
    rafterSize: stringValue(structural.rafterSize ?? roofConditions.rafterSize),
    deckingThicknessIn: scalarValue(structural.deckingThicknessIn ?? roofConditions.deckingThicknessIn),
    windExposure: stringValue(structural.windExposure),
    snowLoadPsf: numberOrNull(structural.snowLoadPsf),
    roofCondition: stringValue(structural.roofCondition ?? roofConditions.roofCondition),
    roofAgeYears: numberOrNull(structural.roofAgeYears ?? roofConditions.roofAgeYears),
    atticAccess: booleanOrNull(structural.atticAccess ?? roofConditions.atticAccess),
    roofMaterial: stringValue(structural.roofMaterial) ?? stringValue(roofConditions.roofMaterial),
    roofPitch: stringValue(structural.roofPitch ?? roofConditions.roofPitch),
    stories: stringValue(structural.stories) ?? stringValue(roofConditions.stories),
    structureType: stringValue(structural.structureType) ?? stringValue(roofConditions.structureType),
  };
}

function rawElectrical(data: Record<string, unknown>): RawSurveyPayload['electrical'] {
  const electrical = record(data.electrical);
  const electricalService = record(data.electricalService);
  return {
    mainPanelRatingAmps: scalarValue(electrical.mainPanelRatingAmps ?? electricalService.mainPanelRatingAmps ?? electricalService.panelRating),
    busbarRatingAmps: scalarValue(electrical.busbarRatingAmps ?? electricalService.busbarRatingAmps),
    breakerSpacesAvailable: scalarValue(electrical.breakerSpacesAvailable ?? electricalService.breakerSpacesAvailable),
    serviceEntrance: stringValue(electrical.serviceEntrance ?? electricalService.serviceEntrance),
    meterType: stringValue(electrical.meterType ?? electricalService.meterSocketType),
    interconnectionPoint: stringValue(electrical.interconnectionPoint ?? electricalService.interconnectionPoint),
    panelBrand: stringValue(electrical.panelBrand ?? electricalService.panelBrand),
    hasSubPanel: booleanOrNull(electrical.hasSubPanel ?? electricalService.hasSubPanel),
    subPanelRatingAmps: scalarValue(electrical.subPanelRatingAmps ?? electricalService.subPanelRating),
    availableBreakerSlots: stringValue(electrical.availableBreakerSlots) ?? stringValue(electricalService.availableBreakerSlots),
  };
}

function fileToSurveyPhoto(file: SiteSurveyFile): Partial<SurveyPhotoRef> {
  return {
    url: file.fileUrl,
    category: surveyPhotoCategory(file.label ?? file.filename),
    slotKey: file.label ?? file.id,
    capturedAt: file.createdAt,
    notes: file.filename ?? undefined,
  };
}

function surveyPhotoCategory(label: string | null): SurveyPhotoRef['category'] {
  const normalized = (label ?? '').toLowerCase();
  if (normalized.includes('roof') || normalized.includes('rafter') || normalized.includes('attic')) return 'roof';
  if (normalized.includes('panel') || normalized.includes('msp') || normalized.includes('disconnect') || normalized.includes('subpanel')) return 'panel';
  if (normalized.includes('meter') || normalized.includes('utility')) return 'meter';
  if (normalized.includes('obstruction') || normalized.includes('vent') || normalized.includes('chimney') || normalized.includes('skylight')) return 'obstruction';
  if (normalized.includes('overview') || normalized.includes('site') || normalized.includes('exterior')) return 'site';
  return 'other';
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function scalarValue(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
