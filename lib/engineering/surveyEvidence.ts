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
import {
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  buildSurveyEvidenceManifest,
  inferSurveyEvidenceCategoryFromText,
} from '@/lib/survey/evidence/manifest';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';
import {
  buildSurveyEvidenceEngineeringBridge,
  summarizeSurveyEvidenceEngineeringBridge,
} from '@/lib/survey/evidence/engineeringBridge';

export type SurveyPhotoEvidenceCategory = SurveyEvidenceCategory;

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
  ...REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
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
  if (!present.has('meter')) {
    warnings.push('Missing utility meter photo evidence; meter/service location should be verified before permit submittal.');
  }
  if (!present.has('roof_plane')) {
    warnings.push('Missing roof plane photo evidence; CAD roof layout remains schematic until field/eagleview geometry is confirmed.');
  }
  if (!present.has('overview')) {
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

  const canonicalManifest = buildSurveyEvidenceManifest({
    survey: {
      id: survey.id,
      projectId: survey.projectId,
      inspectorName: null,
      surveyData: {
        photos: survey.photos.map(photo => ({
          url: photo.url,
          uploadKey: photo.slotKey,
          category: photo.slotKey || photo.category,
          capturedAt: photo.capturedAt,
          notes: photo.notes,
        })),
      },
    },
    files: survey.photos.map((photo, index) => ({
      id: photo.slotKey || `photo-${index + 1}`,
      surveyId: survey.id,
      fileUrl: photo.url,
      fileType: 'photo' as const,
      label: photo.slotKey || photo.category,
      filename: photo.slotKey ? `${photo.slotKey}.jpg` : null,
      mimeType: null,
      createdAt: photo.capturedAt ?? options.normalizedAt ?? new Date().toISOString(),
    })),
    generatedAt: options.normalizedAt,
  });
  const bridge = buildSurveyEvidenceEngineeringBridge(canonicalManifest);
  const bridgeCounts = summarizeSurveyEvidenceEngineeringBridge(bridge);

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
        electricalEvidenceCount: bridgeCounts.electricalEvidenceCount,
        structuralEvidenceCount: bridgeCounts.structuralEvidenceCount,
        roofLayoutEvidenceCount: bridgeCounts.roofLayoutEvidenceCount,
        sitePlanEvidenceCount: bridgeCounts.sitePlanEvidenceCount,
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

  if (category === 'meter' && survey.electrical.meterType !== 'unknown') {
    extracted.meterType = survey.electrical.meterType;
  }

  if (category === 'roof_plane') {
    if (survey.structural.roofMaterial) extracted.roofMaterial = survey.structural.roofMaterial;
    if (survey.structural.rafterSize) extracted.rafterSize = survey.structural.rafterSize;
    extracted.rafterSpacingInches = survey.structural.rafterSpacingIn;
    if (survey.derived.effectiveAzimuth !== null) extracted.azimuth = survey.derived.effectiveAzimuth;
    if (survey.structural.roofPitchDegrees !== null) extracted.pitch = survey.structural.roofPitchDegrees;
  }

  if (category === 'obstructions') {
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
    confidence: category === 'uncategorized' ? 0.25 : 0.75,
    capturedAt: photo.capturedAt,
    notes: photo.notes,
    extracted: Object.keys(extracted).length > 0 ? extracted : undefined,
  };
}

function mapEvidenceCategory(photo: SurveyPhotoRef): SurveyPhotoEvidenceCategory {
  return inferSurveyEvidenceCategoryFromText(`${photo.slotKey} ${photo.category} ${photo.notes ?? ''}`);
}
