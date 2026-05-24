import type { CanonicalSurveyGeometryV1, ProfessionalSurveyAuthorityFlagsV1 } from './professionalSurveyParser';
import type { EnrichedSiteSurvey, SurveyPhotoRef } from './types';

export type SurveyPhotoEvidenceCategoryV1 =
  | 'roof_overview'
  | 'roof_detail'
  | 'obstruction'
  | 'meter'
  | 'msp_electrical_panel'
  | 'inverter_equipment'
  | 'attic_rafter'
  | 'ground_mount_area'
  | 'fence_vertical_solar_area'
  | 'unknown_review_needed';

export type SurveyPhotoRenderRelevanceV1 = 'high' | 'medium' | 'low' | 'not_render_relevant';
export type SurveyPhotoEvidenceConfidenceV1 = 'high' | 'medium' | 'low';
export type SurveyPhotoReviewStatusV1 = 'accepted_for_render_reference' | 'review_recommended' | 'review_required';

export interface SurveyPhotoEvidenceV1 {
  schemaVersion: 'survey_photo_evidence_v1';
  surveyId: string;
  source: {
    slotKey: string;
    url: string;
    normalizedFilename: string;
    originalCategory: SurveyPhotoRef['category'];
    capturedAt: string | null;
    notes: string | null;
  };
  classification: {
    category: SurveyPhotoEvidenceCategoryV1;
    renderRelevance: SurveyPhotoRenderRelevanceV1;
    confidence: SurveyPhotoEvidenceConfidenceV1;
    reviewStatus: SurveyPhotoReviewStatusV1;
  };
  renderUsefulnessScore: number;
  evidenceLimitations: string[];
  geometryAssociationCandidates: string[];
  deterministicSignals: string[];
  noAuthorityEnforcement: SurveyPhotoEvidenceNoAuthorityV1;
}

export interface SurveyPhotoEvidenceBundleV1 {
  schemaVersion: 'survey_photo_evidence_bundle_v1';
  mode: 'deterministic_photo_render_evidence_review_only';
  surveyId: string;
  bundleHash: string;
  photoCount: number;
  evidence: SurveyPhotoEvidenceV1[];
  coverage: SurveyPhotoEvidenceCoverageV1;
  missingPhotoCategoryWarnings: string[];
  reviewNeededPhotoSlotKeys: string[];
  renderSupportingPhotoSlotKeys: string[];
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  noAuthorityEnforcement: SurveyPhotoEvidenceNoAuthorityV1;
  deterministicNotes: string[];
}

export interface SurveyPhotoEvidenceCoverageV1 {
  categoryCounts: Record<SurveyPhotoEvidenceCategoryV1, number>;
  roofOrMountCoverage: boolean;
  obstructionCoverage: boolean;
  electricalCoverage: boolean;
  equipmentCoverage: boolean;
  structuralCoverage: boolean;
  unknownPhotoCount: number;
  renderRelevantPhotoCount: number;
  highConfidencePhotoCount: number;
  reviewNeededPhotoCount: number;
}

export interface SurveyPhotoEvidenceNoAuthorityV1 {
  readOnly: true;
  photoEvidenceOnly: true;
  visualClassificationAuthoritative: false;
  automaticGeometryExtractionAllowed: false;
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  cadSolverExecutionAllowed: false;
  persistenceAllowed: false;
  readinessPromotionAllowed: false;
  downstreamEngineeringAllowed: false;
}

const PHOTO_CATEGORIES: SurveyPhotoEvidenceCategoryV1[] = [
  'roof_overview',
  'roof_detail',
  'obstruction',
  'meter',
  'msp_electrical_panel',
  'inverter_equipment',
  'attic_rafter',
  'ground_mount_area',
  'fence_vertical_solar_area',
  'unknown_review_needed',
];

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

export function buildSurveyPhotoEvidenceBundle(
  survey: EnrichedSiteSurvey,
  canonicalGeometry?: CanonicalSurveyGeometryV1,
): SurveyPhotoEvidenceBundleV1 {
  const evidence = survey.photos
    .map(photo => classifySurveyPhotoEvidence(survey, photo, canonicalGeometry))
    .sort((a, b) => a.source.slotKey.localeCompare(b.source.slotKey));
  const coverage = buildCoverage(evidence);
  const missingPhotoCategoryWarnings = buildMissingPhotoCategoryWarnings(survey, evidence);
  const withoutHash = {
    schemaVersion: 'survey_photo_evidence_bundle_v1' as const,
    mode: 'deterministic_photo_render_evidence_review_only' as const,
    surveyId: survey.id,
    photoCount: evidence.length,
    evidence,
    coverage,
    missingPhotoCategoryWarnings,
    reviewNeededPhotoSlotKeys: evidence.filter(item => item.classification.reviewStatus !== 'accepted_for_render_reference').map(item => item.source.slotKey),
    renderSupportingPhotoSlotKeys: evidence.filter(item => item.classification.renderRelevance === 'high' || item.classification.renderRelevance === 'medium').map(item => item.source.slotKey),
    authorityFlags: NO_AUTHORITY_FLAGS,
    noAuthorityEnforcement: noAuthorityEnforcement(),
    deterministicNotes: [
      'SurveyPhotoEvidenceV1 classifies photo references with deterministic filename, metadata, category, notes, and survey-context heuristics only.',
      'Photo evidence supports render planning and operator review; it does not extract authoritative geometry or mutate CAD/canonical geometry.',
      'Unknown or low-confidence photos are surfaced for review rather than auto-corrected or promoted.',
    ],
  };
  return { ...withoutHash, bundleHash: deterministicHash(withoutHash) };
}

export function classifySurveyPhotoEvidence(
  survey: EnrichedSiteSurvey,
  photo: SurveyPhotoRef,
  canonicalGeometry?: CanonicalSurveyGeometryV1,
): SurveyPhotoEvidenceV1 {
  const normalizedFilename = normalizeFilename(photo.url || photo.slotKey);
  const haystack = [photo.slotKey, normalizedFilename, photo.category, photo.notes ?? ''].join(' ').toLowerCase();
  const signals: string[] = [];
  const category = classifyCategory(photo, haystack, survey.systemType, signals);
  const confidence = classifyConfidence(photo, category, signals);
  const renderRelevance = classifyRenderRelevance(category, confidence);
  const evidenceLimitations = buildLimitations(photo, category, confidence);
  const geometryAssociationCandidates = buildGeometryAssociations(category, survey, canonicalGeometry);
  const renderUsefulnessScore = scoreRenderUsefulness(category, confidence, renderRelevance, evidenceLimitations.length);
  const reviewStatus = classifyReviewStatus(category, confidence, renderUsefulnessScore);

  return {
    schemaVersion: 'survey_photo_evidence_v1',
    surveyId: survey.id,
    source: {
      slotKey: photo.slotKey,
      url: photo.url,
      normalizedFilename,
      originalCategory: photo.category,
      capturedAt: photo.capturedAt ?? null,
      notes: photo.notes ?? null,
    },
    classification: {
      category,
      renderRelevance,
      confidence,
      reviewStatus,
    },
    renderUsefulnessScore,
    evidenceLimitations,
    geometryAssociationCandidates,
    deterministicSignals: signals.sort(),
    noAuthorityEnforcement: noAuthorityEnforcement(),
  };
}

export function buildOperatorPhotoEvidenceSummary(bundle: SurveyPhotoEvidenceBundleV1) {
  return {
    schemaVersion: 'operator_photo_evidence_summary_v1' as const,
    photoCount: bundle.photoCount,
    renderRelevantPhotoCount: bundle.coverage.renderRelevantPhotoCount,
    highConfidencePhotoCount: bundle.coverage.highConfidencePhotoCount,
    reviewNeededPhotoCount: bundle.coverage.reviewNeededPhotoCount,
    roofOrMountCoverage: bundle.coverage.roofOrMountCoverage,
    obstructionCoverage: bundle.coverage.obstructionCoverage,
    electricalCoverage: bundle.coverage.electricalCoverage,
    equipmentCoverage: bundle.coverage.equipmentCoverage,
    missingPhotoCategoryWarnings: bundle.missingPhotoCategoryWarnings.slice(0, 8),
    reviewNeededPhotoSlotKeys: bundle.reviewNeededPhotoSlotKeys.slice(0, 8),
    renderSupportingPhotoSlotKeys: bundle.renderSupportingPhotoSlotKeys.slice(0, 8),
    nonAuthoritative: true as const,
  };
}

function classifyCategory(
  photo: SurveyPhotoRef,
  haystack: string,
  systemType: EnrichedSiteSurvey['systemType'],
  signals: string[],
): SurveyPhotoEvidenceCategoryV1 {
  if (matches(haystack, ['msp', 'main panel', 'main_panel', 'panel open', 'breaker', 'busbar', 'electrical panel']) || photo.category === 'panel') {
    signals.push('matched electrical panel category/keyword');
    return 'msp_electrical_panel';
  }
  if (matches(haystack, ['meter', 'utility meter', 'service meter']) || photo.category === 'meter') {
    signals.push('matched meter category/keyword');
    return 'meter';
  }
  if (matches(haystack, ['inverter', 'combiner', 'disconnect', 'equipment', 'battery', 'ess'])) {
    signals.push('matched inverter/equipment keyword');
    return 'inverter_equipment';
  }
  if (matches(haystack, ['attic', 'rafter', 'truss', 'decking', 'structural'])) {
    signals.push('matched attic/rafter keyword');
    return 'attic_rafter';
  }
  if (matches(haystack, ['obstruction', 'chimney', 'vent', 'skylight', 'hvac', 'dormer']) || photo.category === 'obstruction') {
    signals.push('matched obstruction category/keyword');
    return 'obstruction';
  }
  if (matches(haystack, ['ground', 'groundmount', 'ground_mount', 'field', 'trench']) || systemType === 'ground') {
    signals.push('matched ground mount survey context/keyword');
    return 'ground_mount_area';
  }
  if (matches(haystack, ['fence', 'vertical', 'wall', 'solar fence']) || systemType === 'fence') {
    signals.push('matched fence/vertical survey context/keyword');
    return 'fence_vertical_solar_area';
  }
  if (matches(haystack, ['detail', 'roof_detail', 'ridge', 'valley', 'eave', 'rake', 'setback'])) {
    signals.push('matched roof detail keyword');
    return 'roof_detail';
  }
  if (matches(haystack, ['roof', 'overview', 'aerial']) || photo.category === 'roof' || photo.category === 'site') {
    signals.push('matched roof/site overview category/keyword');
    return 'roof_overview';
  }
  signals.push('no deterministic category match');
  return 'unknown_review_needed';
}

function classifyConfidence(photo: SurveyPhotoRef, category: SurveyPhotoEvidenceCategoryV1, signals: string[]): SurveyPhotoEvidenceConfidenceV1 {
  if (category === 'unknown_review_needed') return 'low';
  const hasSpecificSlot = !photo.slotKey.startsWith('slot_') && photo.slotKey.length > 3;
  const hasNotes = Boolean(photo.notes && photo.notes.trim().length > 0);
  const categoryAligned = categoryMatchesOriginal(category, photo.category);
  if (categoryAligned && (hasSpecificSlot || hasNotes)) {
    signals.push('category aligned with source metadata');
    return 'high';
  }
  if (categoryAligned || hasSpecificSlot || hasNotes) return 'medium';
  return 'low';
}

function classifyRenderRelevance(category: SurveyPhotoEvidenceCategoryV1, confidence: SurveyPhotoEvidenceConfidenceV1): SurveyPhotoRenderRelevanceV1 {
  if (category === 'unknown_review_needed') return 'low';
  if (category === 'roof_overview' || category === 'ground_mount_area' || category === 'fence_vertical_solar_area' || category === 'msp_electrical_panel' || category === 'meter') return confidence === 'low' ? 'medium' : 'high';
  if (category === 'obstruction' || category === 'roof_detail' || category === 'inverter_equipment') return confidence === 'low' ? 'low' : 'medium';
  if (category === 'attic_rafter') return 'low';
  return 'not_render_relevant';
}

function classifyReviewStatus(category: SurveyPhotoEvidenceCategoryV1, confidence: SurveyPhotoEvidenceConfidenceV1, score: number): SurveyPhotoReviewStatusV1 {
  if (category === 'unknown_review_needed' || confidence === 'low') return 'review_required';
  if (score < 70 || confidence === 'medium') return 'review_recommended';
  return 'accepted_for_render_reference';
}

function buildCoverage(evidence: SurveyPhotoEvidenceV1[]): SurveyPhotoEvidenceCoverageV1 {
  const categoryCounts = Object.fromEntries(PHOTO_CATEGORIES.map(category => [category, 0])) as Record<SurveyPhotoEvidenceCategoryV1, number>;
  for (const item of evidence) categoryCounts[item.classification.category] += 1;
  return {
    categoryCounts,
    roofOrMountCoverage: categoryCounts.roof_overview > 0 || categoryCounts.ground_mount_area > 0 || categoryCounts.fence_vertical_solar_area > 0,
    obstructionCoverage: categoryCounts.obstruction > 0,
    electricalCoverage: categoryCounts.meter > 0 || categoryCounts.msp_electrical_panel > 0,
    equipmentCoverage: categoryCounts.inverter_equipment > 0,
    structuralCoverage: categoryCounts.attic_rafter > 0,
    unknownPhotoCount: categoryCounts.unknown_review_needed,
    renderRelevantPhotoCount: evidence.filter(item => item.classification.renderRelevance === 'high' || item.classification.renderRelevance === 'medium').length,
    highConfidencePhotoCount: evidence.filter(item => item.classification.confidence === 'high').length,
    reviewNeededPhotoCount: evidence.filter(item => item.classification.reviewStatus !== 'accepted_for_render_reference').length,
  };
}

function buildMissingPhotoCategoryWarnings(survey: EnrichedSiteSurvey, evidence: SurveyPhotoEvidenceV1[]): string[] {
  const coverage = buildCoverage(evidence);
  const warnings: string[] = [];
  if (!coverage.roofOrMountCoverage) warnings.push(`Missing ${survey.systemType === 'roof' ? 'roof overview' : survey.systemType === 'ground' ? 'ground mount area' : 'fence/vertical solar area'} photo evidence for professional render context.`);
  if (survey.systemType === 'roof' && survey.geometry.obstructions.length > 0 && !coverage.obstructionCoverage) warnings.push('Survey includes obstructions but lacks obstruction photo evidence for render callouts.');
  if (!coverage.electricalCoverage) warnings.push('Missing meter/MSP photo evidence for plan-set equipment marker confidence.');
  if (coverage.unknownPhotoCount > 0) warnings.push(`${coverage.unknownPhotoCount} photo(s) need human category review before render use.`);
  return warnings.sort();
}

function buildLimitations(photo: SurveyPhotoRef, category: SurveyPhotoEvidenceCategoryV1, confidence: SurveyPhotoEvidenceConfidenceV1): string[] {
  const limitations: string[] = ['No pixel-level computer vision, measurement extraction, or authoritative geometry inference was performed.'];
  if (category === 'unknown_review_needed') limitations.push('Photo category could not be determined from deterministic metadata heuristics.');
  if (confidence === 'low') limitations.push('Photo classification confidence is low; operator review is required before render use.');
  if (!photo.notes) limitations.push('No field notes were attached to this photo.');
  if (!photo.capturedAt) limitations.push('No capture timestamp was provided.');
  return limitations.sort();
}

function buildGeometryAssociations(
  category: SurveyPhotoEvidenceCategoryV1,
  survey: EnrichedSiteSurvey,
  canonicalGeometry?: CanonicalSurveyGeometryV1,
): string[] {
  if (category === 'roof_overview' || category === 'roof_detail') {
    return canonicalGeometry?.roofPlanes.map(plane => `roofPlane.${plane.planeId}`).sort() ?? survey.geometry.roofPlanes.map(plane => `roofPlane.${plane.id}`).sort();
  }
  if (category === 'obstruction') return survey.geometry.obstructions.map(obstruction => `obstruction.${obstruction.id}`).sort();
  if (category === 'meter') return ['electrical.meter'];
  if (category === 'msp_electrical_panel') return ['electrical.mainServicePanel'];
  if (category === 'inverter_equipment') return ['electrical.inverterEquipment'];
  if (category === 'attic_rafter') return ['structural.rafters', 'structural.decking'];
  if (category === 'ground_mount_area') return ['mountingSurface.ground'];
  if (category === 'fence_vertical_solar_area') return ['mountingSurface.fence'];
  return [];
}

function scoreRenderUsefulness(
  category: SurveyPhotoEvidenceCategoryV1,
  confidence: SurveyPhotoEvidenceConfidenceV1,
  relevance: SurveyPhotoRenderRelevanceV1,
  limitationCount: number,
): number {
  const categoryBase = category === 'unknown_review_needed' ? 20 : category === 'attic_rafter' ? 45 : category === 'roof_detail' || category === 'obstruction' || category === 'inverter_equipment' ? 68 : 84;
  const confidenceBonus = confidence === 'high' ? 12 : confidence === 'medium' ? 4 : -12;
  const relevanceBonus = relevance === 'high' ? 8 : relevance === 'medium' ? 2 : relevance === 'low' ? -4 : -12;
  return clamp(categoryBase + confidenceBonus + relevanceBonus - limitationCount * 3, 0, 100);
}

function categoryMatchesOriginal(category: SurveyPhotoEvidenceCategoryV1, original: SurveyPhotoRef['category']): boolean {
  if (category === 'roof_overview' || category === 'roof_detail') return original === 'roof' || original === 'site';
  if (category === 'msp_electrical_panel') return original === 'panel';
  if (category === 'meter') return original === 'meter';
  if (category === 'obstruction') return original === 'obstruction';
  return original === 'other';
}

function normalizeFilename(value: string): string {
  const last = value.split(/[/?#]/).filter(Boolean).pop() ?? value;
  return last.toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
}

function matches(value: string, terms: string[]): boolean {
  return terms.some(term => value.includes(term));
}

function noAuthorityEnforcement(): SurveyPhotoEvidenceNoAuthorityV1 {
  return {
    readOnly: true,
    photoEvidenceOnly: true,
    visualClassificationAuthoritative: false,
    automaticGeometryExtractionAllowed: false,
    canonicalGeometryMutationAllowed: false,
    cadMutationAllowed: false,
    cadSolverExecutionAllowed: false,
    persistenceAllowed: false,
    readinessPromotionAllowed: false,
    downstreamEngineeringAllowed: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicHash(value: unknown): string {
  const json = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
