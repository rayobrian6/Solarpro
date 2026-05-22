// ============================================================================
// lib/engineering/surveyEvidence.ts
//
// Normalized survey evidence layer for permit/CAD plan-set generation.
//
// This module is intentionally pure and conservative:
//   - no DB/network/filesystem access
//   - no AI/OCR claims
//   - missing evidence becomes warnings/blockers, never a crash
//   - evidence is traceable to normalized site-survey photos and fields
// ============================================================================

import type { EnrichedSiteSurvey, SurveyPhotoRef } from '@/lib/siteSurvey/types';

export type SurveyPhotoEvidenceCategory =
  | 'main_service_panel'
  | 'subpanel'
  | 'utility_meter'
  | 'roof_plane'
  | 'attic_rafter'
  | 'roof_obstruction'
  | 'roof_access'
  | 'site_exterior'
  | 'equipment_label'
  | 'grounding_bonding'
  | 'unknown';

export interface SurveyPhotoEvidence {
  id: string;
  projectId: string;
  surveyId?: string;
  fileUrl?: string;
  fileId?: string;
  sourceCategory: SurveyPhotoRef['category'];
  category: SurveyPhotoEvidenceCategory;
  confidence: number;
  capturedAt?: string;
  notes?: string;
  extracted?: {
    panelRatingAmps?: number;
    meterType?: string;
    roofMaterial?: string;
    rafterSize?: string;
    rafterSpacingInches?: number;
    obstructionType?: string;
    azimuth?: number;
    pitch?: number;
  };
}

export interface EngineeringSurveyEvidence {
  projectId: string;
  surveyId?: string;
  photos: SurveyPhotoEvidence[];
  missingCategories: SurveyPhotoEvidenceCategory[];
  completeness: 'missing' | 'partial' | 'sufficient';
  blockers: string[];
  warnings: string[];
  manifestV1?: {
    itemCount: number;
    lifecycleState: 'uploaded' | 'classified' | 'quality_checked' | 'duplicate_checked' | 'ai_pending' | 'ai_processed' | 'engineering_reviewed' | 'permit_consumed' | 'archived';
    aiExtractionStatus: 'not_started';
    qualityStatus: 'not_processed';
    duplicateStatus: 'not_processed';
    engineeringBridge: {
      readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
      electricalEvidenceCount: number;
      structuralEvidenceCount: number;
      roofLayoutEvidenceCount: number;
      sitePlanEvidenceCount: number;
      cadAutomationStatus: 'not_started';
    };
  };
  fieldEvidence: {
    hasPhysicalData: boolean;
    hasRoofGeometry: boolean;
    hasElectricalData: boolean;
    hasStructuralData: boolean;
    roofPlaneCount: number;
    obstructionCount: number;
    usableAreaSqFt: number | null;
    mainPanelRatingAmps: number | null;
    busbarRatingAmps: number | null;
    interconnectionPoint: string;
    rafterSize: string | null;
    rafterSpacingInches: number | null;
    roofMaterial: string | null;
    roofPitchDegrees: number | null;
  };
  source: {
    pipelineVersion: number;
    normalizedAt: string;
  };
}

export const REQUIRED_PLANSET_EVIDENCE_CATEGORIES: SurveyPhotoEvidenceCategory[] = [
  'main_service_panel',
  'utility_meter',
  'roof_plane',
  'site_exterior',
];

/**
 * collectEngineeringSurveyEvidence converts an enriched site survey into the
 * compact evidence object consumed by permit/plan-set rendering.
 */
export function collectEngineeringSurveyEvidence(
  survey: EnrichedSiteSurvey,
  options: { normalizedAt?: string } = {},
): EngineeringSurveyEvidence {
  const photos = survey.photos.map((photo, index) => mapPhotoEvidence(photo, survey, index));
  const present = new Set(photos.map(photo => photo.category));

  const missingCategories = REQUIRED_PLANSET_EVIDENCE_CATEGORIES.filter(
    category => !present.has(category),
  );

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (photos.length === 0) {
    blockers.push('No site survey photos are attached to support permit plan-set assumptions.');
  }

  if (!present.has('main_service_panel')) {
    warnings.push('Missing main service panel photo evidence; electrical interconnection assumptions require engineer verification.');
  }
  if (!present.has('utility_meter')) {
    warnings.push('Missing utility meter photo evidence; meter/service location should be verified before permit submittal.');
  }
  if (!present.has('roof_plane')) {
    warnings.push('Missing roof plane photo evidence; CAD roof layout remains schematic until field/eagleview geometry is confirmed.');
  }
  if (!present.has('site_exterior')) {
    warnings.push('Missing site exterior photo evidence; equipment locations and access notes require verification.');
  }

  if (!survey.derived.hasGeometryData) {
    warnings.push('Survey physical data does not include roof geometry or usable roof area; CAD generation will rely on design/layout defaults.');
  }
  if (!survey.derived.hasElectricalData) {
    warnings.push('Survey physical data does not include main electrical service details; electrical plan-set values may come from design defaults.');
  }
  if (!survey.derived.hasStructuralData) {
    warnings.push('Survey physical data does not include structural roof details; attachment design requires engineer review.');
  }

  const corePresentCount = REQUIRED_PLANSET_EVIDENCE_CATEGORIES.length - missingCategories.length;
  const completeness: EngineeringSurveyEvidence['completeness'] =
    photos.length === 0 || corePresentCount === 0
      ? 'missing'
      : missingCategories.length === 0 && survey.derived.hasElectricalData && survey.derived.hasStructuralData
        ? 'sufficient'
        : 'partial';

  const electricalEvidenceCount = photos.filter(photo =>
    photo.category === 'main_service_panel' ||
    photo.category === 'subpanel' ||
    photo.category === 'utility_meter' ||
    photo.category === 'equipment_label' ||
    photo.category === 'grounding_bonding',
  ).length;
  const structuralEvidenceCount = photos.filter(photo =>
    photo.category === 'attic_rafter' ||
    photo.category === 'roof_access',
  ).length;
  const roofLayoutEvidenceCount = photos.filter(photo =>
    photo.category === 'roof_plane' ||
    photo.category === 'roof_obstruction',
  ).length;
  const sitePlanEvidenceCount = photos.filter(photo =>
    photo.category === 'site_exterior',
  ).length;

  return {
    projectId: survey.projectId,
    surveyId: survey.id,
    photos,
    missingCategories,
    completeness,
    blockers,
    warnings,
    manifestV1: {
      itemCount: photos.length,
      lifecycleState: photos.length > 0 ? 'classified' : 'uploaded',
      aiExtractionStatus: 'not_started',
      qualityStatus: 'not_processed',
      duplicateStatus: 'not_processed',
      engineeringBridge: {
        readiness: completeness === 'sufficient' ? 'ready_for_engineering' : photos.length === 0 ? 'blocked' : 'needs_review',
        electricalEvidenceCount,
        structuralEvidenceCount,
        roofLayoutEvidenceCount,
        sitePlanEvidenceCount,
        cadAutomationStatus: 'not_started',
      },
    },
    fieldEvidence: {
      hasPhysicalData: survey.derived.hasGeometryData || survey.derived.hasElectricalData || survey.derived.hasStructuralData,
      hasRoofGeometry: survey.derived.hasGeometryData,
      hasElectricalData: survey.derived.hasElectricalData,
      hasStructuralData: survey.derived.hasStructuralData,
      roofPlaneCount: survey.geometry.roofPlanes.length,
      obstructionCount: survey.geometry.obstructions.length,
      usableAreaSqFt: survey.derived.effectiveUsableAreaSqFt,
      mainPanelRatingAmps: survey.electrical.mainPanelRatingAmps,
      busbarRatingAmps: survey.electrical.busbarRatingAmps,
      interconnectionPoint: survey.electrical.interconnectionPoint,
      rafterSize: survey.structural.rafterSize,
      rafterSpacingInches: survey.structural.rafterSpacingIn,
      roofMaterial: survey.structural.roofMaterial,
      roofPitchDegrees: survey.structural.roofPitchDegrees,
    },
    source: {
      pipelineVersion: survey.pipelineVersion,
      normalizedAt: options.normalizedAt ?? new Date().toISOString(),
    },
  };
}

function mapPhotoEvidence(
  photo: SurveyPhotoRef,
  survey: EnrichedSiteSurvey,
  index: number,
): SurveyPhotoEvidence {
  const category = mapEvidenceCategory(photo);
  const extracted: SurveyPhotoEvidence['extracted'] = {};

  if (category === 'main_service_panel') {
    if (survey.electrical.mainPanelRatingAmps !== null) {
      extracted.panelRatingAmps = survey.electrical.mainPanelRatingAmps;
    }
  }

  if (category === 'utility_meter' && survey.electrical.meterType !== 'unknown') {
    extracted.meterType = survey.electrical.meterType;
  }

  if (category === 'roof_plane') {
    if (survey.structural.roofMaterial) extracted.roofMaterial = survey.structural.roofMaterial;
    if (survey.structural.rafterSize) extracted.rafterSize = survey.structural.rafterSize;
    extracted.rafterSpacingInches = survey.structural.rafterSpacingIn;
    if (survey.derived.effectiveAzimuth !== null) extracted.azimuth = survey.derived.effectiveAzimuth;
    if (survey.structural.roofPitchDegrees !== null) extracted.pitch = survey.structural.roofPitchDegrees;
  }

  if (category === 'roof_obstruction') {
    extracted.obstructionType = survey.geometry.obstructions[0]?.type;
  }

  return {
    id: photo.slotKey || `photo-${index + 1}`,
    projectId: survey.projectId,
    surveyId: survey.id,
    fileUrl: photo.url,
    fileId: photo.slotKey,
    sourceCategory: photo.category,
    category,
    confidence: category === 'unknown' ? 0.25 : 0.75,
    capturedAt: photo.capturedAt,
    notes: photo.notes,
    extracted: Object.keys(extracted).length > 0 ? extracted : undefined,
  };
}

function mapEvidenceCategory(photo: SurveyPhotoRef): SurveyPhotoEvidenceCategory {
  const key = `${photo.slotKey} ${photo.category} ${photo.notes ?? ''}`.toLowerCase();

  if (key.includes('subpanel') || key.includes('sub_panel')) return 'subpanel';
  if (key.includes('meter')) return 'utility_meter';
  if (key.includes('attic') || key.includes('rafter')) return 'attic_rafter';
  if (key.includes('obstruction') || key.includes('chimney') || key.includes('skylight') || key.includes('vent')) return 'roof_obstruction';
  if (key.includes('access')) return 'roof_access';
  if (key.includes('label') || key.includes('nameplate')) return 'equipment_label';
  if (key.includes('ground') || key.includes('bond')) return 'grounding_bonding';
  if (key.includes('main_panel') || key.includes('main panel') || photo.category === 'panel') return 'main_service_panel';
  if (key.includes('roof') || photo.category === 'roof') return 'roof_plane';
  if (key.includes('site') || key.includes('exterior') || photo.category === 'site') return 'site_exterior';

  return 'unknown';
}
