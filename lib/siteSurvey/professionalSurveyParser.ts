import type { EnrichedSiteSurvey, NormalizedSiteSurvey, SurveyRoofPlane, SurveySystemType } from './types';
import { buildCADFromSurvey, type SurveyCADInputs } from '@/lib/cad/buildCADFromSurvey';

export type ProfessionalSurveyParserSchemaVersion = 'professional_site_survey_evidence_bundle_v1';
export type CanonicalSurveyGeometrySchemaVersion = 'canonical_survey_geometry_v1';
export type SurveyCADReadinessSchemaVersion = 'survey_cad_readiness_v1';
export type ProfessionalSurveyReviewStatus = 'cad_ready' | 'review_required' | 'blocked';

export interface ProfessionalSurveyAuthorityFlagsV1 {
  persistenceAllowed: false;
  solverExecutionAllowed: false;
  cadMutationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  engineeringAuthorityAllowed: false;
  necAuthorityAllowed: false;
  bomAuthorityAllowed: false;
  permitAuthorityAllowed: false;
  downstreamAuthority: false;
}

export interface ProfessionalSiteSurveyEvidenceBundleV1 {
  schemaVersion: ProfessionalSurveyParserSchemaVersion;
  persistenceMode: 'deterministic_read_only_dto_v1';
  surveyId: string;
  projectId: string;
  systemType: SurveySystemType;
  sourcePipelineVersion: number;
  sourceKind: 'normalized_site_survey' | 'enriched_site_survey';
  sourceHash: string;
  extractedFields: {
    hasLocation: boolean;
    roofPlaneCount: number;
    obstructionCount: number;
    setbackCount: number;
    photoCount: number;
    hasStructuralData: boolean;
    hasElectricalData: boolean;
    hasCADReadySurfaces: boolean;
  };
  roofGeometryCandidates: ProfessionalRoofGeometryCandidateV1[];
  electricalServiceCandidates: ProfessionalFieldCandidateV1[];
  structuralCandidates: ProfessionalFieldCandidateV1[];
  missingRequiredFields: string[];
  blockingIssues: string[];
  reviewRequired: boolean;
  readinessStatus: ProfessionalSurveyReviewStatus;
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  deterministicNotes: string[];
  bundleHash: string;
}

export interface ProfessionalRoofGeometryCandidateV1 {
  candidateId: string;
  planeId: string;
  vertexCount: number;
  pitchDeg: number;
  azimuthDeg: number;
  areaSqFt: number;
  hasClosedPolygon: boolean;
  hasSelfIntersection: boolean;
  confidence: 'high' | 'medium' | 'low';
  issues: string[];
}

export interface ProfessionalFieldCandidateV1 {
  field: string;
  value: string | number | boolean | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'normalized_survey' | 'enriched_survey' | 'defaulted_or_unknown';
}

export interface CanonicalSurveyGeometryV1 {
  schemaVersion: CanonicalSurveyGeometrySchemaVersion;
  sourceSurveyId: string;
  sourceBundleHash: string;
  systemType: SurveySystemType;
  coordinateSpace: 'survey_local_xy_meters';
  origin: { lat: number; lng: number } | null;
  roofPlanes: CanonicalSurveyRoofPlaneV1[];
  blockingIssues: string[];
  warnings: string[];
  readyForCADInput: boolean;
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  geometryHash: string;
}

export interface CanonicalSurveyRoofPlaneV1 {
  planeId: string;
  polygon: Array<{ x: number; y: number }>;
  pitchDeg: number;
  azimuthDeg: number;
  areaSqM: number;
  sourceAreaSqFt: number;
  valid: boolean;
  issues: string[];
}

export interface SurveyCADReadinessV1 {
  schemaVersion: SurveyCADReadinessSchemaVersion;
  sourceSurveyId: string;
  sourceBundleHash: string;
  sourceGeometryHash: string;
  readinessStatus: ProfessionalSurveyReviewStatus;
  canBuildCADInput: boolean;
  cadInputPreview: SurveyCADInputs | null;
  requiredReviewItems: string[];
  blockingIssues: string[];
  warnings: string[];
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  readinessHash: string;
}

const NO_AUTHORITY_FLAGS: ProfessionalSurveyAuthorityFlagsV1 = {
  persistenceAllowed: false,
  solverExecutionAllowed: false,
  cadMutationAllowed: false,
  canonicalGeometryMutationAllowed: false,
  engineeringAuthorityAllowed: false,
  necAuthorityAllowed: false,
  bomAuthorityAllowed: false,
  permitAuthorityAllowed: false,
  downstreamAuthority: false,
};

export function parseProfessionalSiteSurvey(survey: NormalizedSiteSurvey | EnrichedSiteSurvey): ProfessionalSiteSurveyEvidenceBundleV1 {
  const enriched = isEnrichedSurvey(survey);
  const roofGeometryCandidates = survey.geometry.roofPlanes.map((plane, index) => buildRoofCandidate(plane, index));
  const missingRequiredFields = collectMissingRequiredFields(survey, enriched);
  const blockingIssues = collectBlockingIssues(survey, roofGeometryCandidates);
  const reviewRequired = missingRequiredFields.length > 0 || roofGeometryCandidates.some(candidate => candidate.issues.length > 0);
  const readinessStatus: ProfessionalSurveyReviewStatus = blockingIssues.length > 0 ? 'blocked' : reviewRequired ? 'review_required' : 'cad_ready';

  const withoutHash = {
    schemaVersion: 'professional_site_survey_evidence_bundle_v1' as const,
    persistenceMode: 'deterministic_read_only_dto_v1' as const,
    surveyId: survey.id,
    projectId: survey.projectId,
    systemType: survey.systemType,
    sourcePipelineVersion: survey.pipelineVersion,
    sourceKind: enriched ? 'enriched_site_survey' as const : 'normalized_site_survey' as const,
    sourceHash: deterministicHash(sanitizeSurveyForHash(survey)),
    extractedFields: {
      hasLocation: survey.location.lat !== null && survey.location.lng !== null,
      roofPlaneCount: survey.geometry.roofPlanes.length,
      obstructionCount: survey.geometry.obstructions.length,
      setbackCount: survey.geometry.setbacks.length,
      photoCount: survey.photos.length,
      hasStructuralData: enriched ? survey.derived.hasStructuralData : hasStructuralData(survey),
      hasElectricalData: enriched ? survey.derived.hasElectricalData : hasElectricalData(survey),
      hasCADReadySurfaces: enriched ? survey.derived.cadRoofSurfaces.length > 0 : false,
    },
    roofGeometryCandidates,
    electricalServiceCandidates: buildElectricalCandidates(survey),
    structuralCandidates: buildStructuralCandidates(survey),
    missingRequiredFields,
    blockingIssues,
    reviewRequired,
    readinessStatus,
    authorityFlags: NO_AUTHORITY_FLAGS,
    deterministicNotes: [
      'Professional site survey evidence bundle is a deterministic read-only DTO boundary.',
      'The parser does not execute CAD solving, mutate CAD, mutate canonical geometry, or write persistence.',
      'Survey-derived geometry remains candidate evidence until canonical geometry and CAD readiness gates pass.',
      'This bundle has no engineering, NEC, BOM, permit, recommendation, workflow, or downstream authority.',
    ],
  } satisfies Omit<ProfessionalSiteSurveyEvidenceBundleV1, 'bundleHash'>;

  return { ...withoutHash, bundleHash: deterministicHash(withoutHash) };
}

export function buildCanonicalSurveyGeometry(
  survey: NormalizedSiteSurvey | EnrichedSiteSurvey,
  bundle = parseProfessionalSiteSurvey(survey),
): CanonicalSurveyGeometryV1 {
  const origin = resolveOrigin(survey);
  const blockingIssues: string[] = [...bundle.blockingIssues];
  const warnings: string[] = [];

  if (!origin) {
    warnings.push('Survey has no usable GPS origin; local XY geometry cannot be projected from lat/lng.');
  }

  const roofPlanes = survey.systemType === 'roof'
    ? survey.geometry.roofPlanes.map(plane => canonicalizeRoofPlane(plane, origin))
    : [];

  for (const plane of roofPlanes) {
    if (!plane.valid) blockingIssues.push(...plane.issues.map(issue => `roofPlane.${plane.planeId}: ${issue}`));
  }

  const readyForCADInput = blockingIssues.length === 0 && (survey.systemType !== 'roof' || roofPlanes.length > 0);
  const withoutHash = {
    schemaVersion: 'canonical_survey_geometry_v1' as const,
    sourceSurveyId: survey.id,
    sourceBundleHash: bundle.bundleHash,
    systemType: survey.systemType,
    coordinateSpace: 'survey_local_xy_meters' as const,
    origin,
    roofPlanes,
    blockingIssues: dedupe(blockingIssues),
    warnings: dedupe(warnings),
    readyForCADInput,
    authorityFlags: NO_AUTHORITY_FLAGS,
  } satisfies Omit<CanonicalSurveyGeometryV1, 'geometryHash'>;

  return { ...withoutHash, geometryHash: deterministicHash(withoutHash) };
}

export function buildSurveyCADReadiness(
  survey: NormalizedSiteSurvey | EnrichedSiteSurvey,
  bundle = parseProfessionalSiteSurvey(survey),
  geometry = buildCanonicalSurveyGeometry(survey, bundle),
): SurveyCADReadinessV1 {
  const blockingIssues = dedupe([...bundle.blockingIssues, ...geometry.blockingIssues]);
  const warnings = [...geometry.warnings];
  const requiredReviewItems = dedupe([...bundle.missingRequiredFields, ...warnings]);
  const enriched = isEnrichedSurvey(survey);
  let cadInputPreview: SurveyCADInputs | null = null;

  if (enriched && geometry.readyForCADInput) {
    cadInputPreview = buildCADFromSurvey(survey);
    warnings.push(...cadInputPreview.warnings);
  } else if (!enriched) {
    requiredReviewItems.push('EnrichedSiteSurvey required before CAD input preview can be built.');
  }

  const canBuildCADInput = cadInputPreview !== null && blockingIssues.length === 0;
  const readinessStatus: ProfessionalSurveyReviewStatus = blockingIssues.length > 0 ? 'blocked' : canBuildCADInput && requiredReviewItems.length === 0 ? 'cad_ready' : 'review_required';

  const withoutHash = {
    schemaVersion: 'survey_cad_readiness_v1' as const,
    sourceSurveyId: survey.id,
    sourceBundleHash: bundle.bundleHash,
    sourceGeometryHash: geometry.geometryHash,
    readinessStatus,
    canBuildCADInput,
    cadInputPreview,
    requiredReviewItems: dedupe(requiredReviewItems),
    blockingIssues,
    warnings: dedupe(warnings),
    authorityFlags: NO_AUTHORITY_FLAGS,
  } satisfies Omit<SurveyCADReadinessV1, 'readinessHash'>;

  return { ...withoutHash, readinessHash: deterministicHash(withoutHash) };
}

function isEnrichedSurvey(survey: NormalizedSiteSurvey | EnrichedSiteSurvey): survey is EnrichedSiteSurvey {
  return Boolean((survey as EnrichedSiteSurvey).derived && Array.isArray((survey as EnrichedSiteSurvey).enrichmentLog));
}

function buildRoofCandidate(plane: SurveyRoofPlane, index: number): ProfessionalRoofGeometryCandidateV1 {
  const issues: string[] = [];
  if (plane.vertices.length < 3) issues.push('Roof plane requires at least 3 vertices.');
  if (!isFinitePositive(plane.area)) issues.push('Roof plane area must be positive and finite.');
  if (!isFiniteNumber(plane.pitch) || plane.pitch < 0 || plane.pitch > 75) issues.push('Roof plane pitch is outside supported range 0-75 degrees.');
  if (!isFiniteNumber(plane.azimuth) || plane.azimuth < 0 || plane.azimuth >= 360) issues.push('Roof plane azimuth must be in [0, 360).');
  const hasSelfIntersection = hasPolygonSelfIntersection(plane.vertices.map(p => ({ x: p.lng, y: p.lat })));
  if (hasSelfIntersection) issues.push('Roof plane polygon self-intersects.');
  return {
    candidateId: `roof_geometry_candidate_${index + 1}`,
    planeId: plane.id,
    vertexCount: plane.vertices.length,
    pitchDeg: plane.pitch,
    azimuthDeg: plane.azimuth,
    areaSqFt: plane.area,
    hasClosedPolygon: plane.vertices.length >= 3,
    hasSelfIntersection,
    confidence: issues.length === 0 ? 'high' : plane.vertices.length >= 3 ? 'medium' : 'low',
    issues,
  };
}

function buildElectricalCandidates(survey: NormalizedSiteSurvey): ProfessionalFieldCandidateV1[] {
  return [
    fieldCandidate('mainPanelRatingAmps', survey.electrical.mainPanelRatingAmps, survey.electrical.mainPanelRatingAmps ? 'high' : 'low'),
    fieldCandidate('busbarRatingAmps', survey.electrical.busbarRatingAmps, survey.electrical.busbarRatingAmps ? 'high' : 'low'),
    fieldCandidate('interconnectionPoint', survey.electrical.interconnectionPoint, survey.electrical.interconnectionPoint !== 'unknown' ? 'high' : 'low'),
    fieldCandidate('panelBrand', survey.electrical.panelBrand, survey.electrical.panelBrand !== 'unknown' ? 'medium' : 'low'),
  ];
}

function buildStructuralCandidates(survey: NormalizedSiteSurvey): ProfessionalFieldCandidateV1[] {
  return [
    fieldCandidate('rafterSpacingIn', survey.structural.rafterSpacingIn, 'medium'),
    fieldCandidate('rafterSize', survey.structural.rafterSize, survey.structural.rafterSize !== 'other' ? 'medium' : 'low'),
    fieldCandidate('roofMaterial', survey.structural.roofMaterial, survey.structural.roofMaterial ? 'medium' : 'low'),
    fieldCandidate('roofPitchDegrees', survey.structural.roofPitchDegrees, survey.structural.roofPitchDegrees !== null ? 'medium' : 'low'),
  ];
}

function fieldCandidate(field: string, value: string | number | boolean | null, confidence: 'high' | 'medium' | 'low'): ProfessionalFieldCandidateV1 {
  return { field, value, confidence, source: value === null || value === 'unknown' ? 'defaulted_or_unknown' : 'normalized_survey' };
}

function collectMissingRequiredFields(survey: NormalizedSiteSurvey, enriched: boolean): string[] {
  const missing: string[] = [];
  if (survey.location.lat === null || survey.location.lng === null) missing.push('location.lat/lng');
  if (survey.systemType === 'roof' && survey.geometry.roofPlanes.length === 0) missing.push('geometry.roofPlanes');
  if (survey.electrical.mainPanelRatingAmps === null) missing.push('electrical.mainPanelRatingAmps');
  if (survey.electrical.interconnectionPoint === 'unknown') missing.push('electrical.interconnectionPoint');
  if (!enriched) missing.push('derived.cadRoofSurfaces/enrichment');
  return missing;
}

function collectBlockingIssues(survey: NormalizedSiteSurvey, roofCandidates: ProfessionalRoofGeometryCandidateV1[]): string[] {
  const issues: string[] = [];
  if (survey.systemType === 'roof') {
    if (survey.geometry.roofPlanes.length === 0) issues.push('Roof surveys require at least one roof plane before CAD input readiness.');
    for (const candidate of roofCandidates) {
      for (const issue of candidate.issues) issues.push(`roofPlane.${candidate.planeId}: ${issue}`);
    }
  }
  return dedupe(issues);
}

function canonicalizeRoofPlane(plane: SurveyRoofPlane, origin: { lat: number; lng: number } | null): CanonicalSurveyRoofPlaneV1 {
  const issues: string[] = [];
  if (!origin) issues.push('Missing projection origin.');
  if (plane.vertices.length < 3) issues.push('Roof plane requires at least 3 vertices.');
  const polygon = origin ? geoPolygonToLocal(plane.vertices, origin) : [];
  const localAreaSqM = polygon.length >= 3 ? Math.abs(polygonArea(polygon)) : 0;
  if (localAreaSqM <= 0) issues.push('Projected polygon area is zero.');
  if (hasPolygonSelfIntersection(polygon)) issues.push('Projected polygon self-intersects.');
  return {
    planeId: plane.id,
    polygon,
    pitchDeg: plane.pitch,
    azimuthDeg: plane.azimuth,
    areaSqM: plane.area * 0.09290304,
    sourceAreaSqFt: plane.area,
    valid: issues.length === 0,
    issues,
  };
}

function resolveOrigin(survey: NormalizedSiteSurvey): { lat: number; lng: number } | null {
  if (survey.location.lat !== null && survey.location.lng !== null) return { lat: survey.location.lat, lng: survey.location.lng };
  const first = survey.geometry.roofPlanes[0]?.vertices[0];
  return first ? { lat: first.lat, lng: first.lng } : null;
}

function hasStructuralData(survey: NormalizedSiteSurvey): boolean {
  return Boolean(survey.structural.roofMaterial || survey.structural.roofPitchDegrees !== null || survey.structural.roofAgeYears !== null);
}

function hasElectricalData(survey: NormalizedSiteSurvey): boolean {
  return survey.electrical.mainPanelRatingAmps !== null || survey.electrical.busbarRatingAmps !== null || survey.electrical.interconnectionPoint !== 'unknown';
}

function geoPolygonToLocal(points: Array<{ lat: number; lng: number }>, origin: { lat: number; lng: number }): Array<{ x: number; y: number }> {
  const earthRadiusM = 6371000;
  const lat0 = origin.lat * Math.PI / 180;
  return points.map(point => ({
    x: (point.lng - origin.lng) * Math.PI / 180 * earthRadiusM * Math.cos(lat0),
    y: (point.lat - origin.lat) * Math.PI / 180 * earthRadiusM,
  }));
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function hasPolygonSelfIntersection(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-12) return false;
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  return lambda > 0 && lambda < 1 && gamma > 0 && gamma < 1;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sanitizeSurveyForHash(survey: NormalizedSiteSurvey | EnrichedSiteSurvey): unknown {
  return {
    id: survey.id,
    projectId: survey.projectId,
    pipelineVersion: survey.pipelineVersion,
    location: survey.location,
    systemType: survey.systemType,
    geometry: survey.geometry,
    structural: survey.structural,
    electrical: survey.electrical,
    photoCount: survey.photos.length,
    enriched: isEnrichedSurvey(survey) ? survey.derived : null,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function deterministicHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
