// ============================================================================
// lib/engineering/surveyEvidence.ts
//
// Normalized survey evidence layer for permit/CAD plan-set generation.
//
// This module is intentionally pure and conservative:
//   - no DB/network/filesystem access
//   - no automated visual extraction claims
//   - missing evidence becomes warnings/blockers, never a crash
//   - evidence is traceable to normalized site-survey photos and fields
// ============================================================================

import type { EnrichedSiteSurvey, SurveyPhotoRef } from '@/lib/siteSurvey/types';
import {
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  buildSurveyEvidenceManifest,
  inferSurveyEvidenceCategoryFromText,
} from '@/lib/survey/evidence/manifest';
import type { SurveyEvidenceCategory, SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import {
  buildSurveyEvidenceEngineeringBridge,
  summarizeSurveyEvidenceEngineeringBridge,
} from '@/lib/survey/evidence/engineeringBridge';
import {
  buildSurveyEvidenceTraceability,
  type SurveyEvidenceTraceabilityBundle,
} from '@/lib/survey/evidence/provenance';
import type { EvidenceDuplicateGroup, SurveySessionSummary } from '@/lib/survey/evidence/sessionTypes';
import type { EngineeringRequirementEvaluationSummary } from '@/lib/survey/evidence/engineeringRequirements';
import { buildDocumentProvenanceBundle } from '@/lib/documentProvenance/builders';
import type { DocumentProvenanceBundle } from '@/lib/documentProvenance/types';
import { buildEngineeringDecisionProvenanceBundle } from '@/lib/engineeringDecisionProvenance/evaluator';
import type { EngineeringDecisionEvaluationBundle } from '@/lib/engineeringDecisionProvenance/types';

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
  /**
   * Raw normalized photo count is preserved for audit/history only. It must not
   * drive completeness, readiness, confidence, bridge counts, or permit truth.
   */
  rawPhotoCount: number;
  canonicalEvidenceCount: number;
  evidenceTruthSource: 'canonical_manifest_v1' | 'legacy_raw_photos_fallback';
  traceability: SurveyEvidenceTraceabilityBundle;
  requirementEvaluation: EngineeringRequirementEvaluationSummary;
  documentProvenance?: DocumentProvenanceBundle;
  decisionProvenance?: EngineeringDecisionEvaluationBundle;
  missingCategories: SurveyPhotoEvidenceCategory[];
  completeness: 'missing' | 'partial' | 'sufficient';
  blockers: string[];
  warnings: string[];
  manifestV1?: {
    itemCount: number;
    lifecycleState: 'uploaded' | 'classified' | 'quality_checked' | 'duplicate_checked' | 'ai_pending' | 'ai_processed' | 'engineering_reviewed' | 'permit_consumed' | 'archived';
    aiExtractionStatus: 'not_started';
    qualityStatus: 'not_processed';
    duplicateStatus: 'not_processed' | 'duplicate_checked';
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
  options: {
    normalizedAt?: string;
    canonicalManifest?: SurveyEvidenceManifest | null;
    evidenceDuplicateGroups?: EvidenceDuplicateGroup[];
    sessions?: SurveySessionSummary[];
  } = {},
): EngineeringSurveyEvidence {
  const legacyRawPhotos = survey.photos.map((photo, index) => mapPhotoEvidence(photo, survey, index));
  const canonicalManifest = options.canonicalManifest ?? buildSurveyEvidenceManifest({
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
  const evidenceTruthSource: EngineeringSurveyEvidence['evidenceTruthSource'] = options.canonicalManifest
    ? 'canonical_manifest_v1'
    : 'legacy_raw_photos_fallback';
  const traceability = buildSurveyEvidenceTraceability({
    canonicalManifest,
    evidenceTruthSource,
    evidenceDuplicateGroups: options.evidenceDuplicateGroups,
    sessions: options.sessions,
  });
  const photos = canonicalManifest.items.map(item => mapCanonicalManifestEvidence(item, survey));

  const bridge = buildSurveyEvidenceEngineeringBridge(canonicalManifest, traceability);
  const bridgeCounts = summarizeSurveyEvidenceEngineeringBridge(bridge);
  const requirementEvaluation = bridge.requirementEvaluation;
  const missingCategories = requirementEvaluation.blockedRequirements
    .flatMap(requirement => requirement.requiredEvidenceCategories)
    .filter((category, index, categories) => categories.indexOf(category) === index);

  const blockers: string[] = [];
  const warnings: string[] = [...bridge.permitWarnings];

  if (canonicalManifest.summary.totalItems === 0) {
    blockers.push('No canonical survey photo evidence items are available to support permit plan-set assumptions.');
  }

  for (const requirement of requirementEvaluation.blockedRequirements) {
    blockers.push(`Engineering requirement blocked: ${requirement.humanLabel} (${requirement.status}).`);
  }
  for (const requirement of requirementEvaluation.partiallySatisfiedRequirements) {
    warnings.push(`Engineering requirement needs review: ${requirement.humanLabel} (${requirement.status}).`);
  }
  for (const requirement of requirementEvaluation.missingRequirements.filter(requirement => requirement.missingSeverity === 'warning')) {
    warnings.push(`Missing engineering review evidence: ${requirement.humanLabel}.`);
  }

  if (!survey.derived.hasGeometryData) {
    warnings.push('Survey physical data does not include roof geometry or usable roof area; layout solving will rely on design/layout defaults.');
  }
  if (!survey.derived.hasElectricalData) {
    warnings.push('Survey physical data does not include main electrical service details; electrical plan-set values may come from design defaults.');
  }
  if (!survey.derived.hasStructuralData) {
    warnings.push('Survey physical data does not include structural roof details; attachment design requires engineer review.');
  }

  const completeness: EngineeringSurveyEvidence['completeness'] = requirementEvaluation.completeness;
  const normalizedAt = options.normalizedAt ?? new Date().toISOString();
  const surveyEvidenceBaseForProvenance = {
    projectId: survey.projectId,
    surveyId: survey.id,
    photos,
    rawPhotoCount: legacyRawPhotos.length,
    canonicalEvidenceCount: canonicalManifest.summary.totalItems,
    evidenceTruthSource,
    traceability,
    requirementEvaluation,
    missingCategories,
    completeness,
    blockers,
    warnings,
    source: {
      pipelineVersion: survey.pipelineVersion,
      normalizedAt,
    },
  } as EngineeringSurveyEvidence;
  const decisionProvenance = buildEngineeringDecisionProvenanceBundle({
    bundleId: `permit:${survey.projectId}:${survey.id}.decision-provenance`,
    generatedAt: normalizedAt,
    surveyEvidence: surveyEvidenceBaseForProvenance,
    documentProvenance: null,
    permitInput: null,
    renderContextIds: ['renderContext:primary'],
  });
  const documentProvenance = buildDocumentProvenanceBundle({
    documentId: `permit:${survey.projectId}:${survey.id}`,
    documentType: 'permit_package',
    surveyEvidence: surveyEvidenceBaseForProvenance,
    generatedAt: normalizedAt,
    renderInputs: {
      inputKeys: ['EngineeringSurveyEvidence', 'PermitInput'],
      canonicalInputKeys: ['canonicalManifest', 'requirementEvaluation', 'traceability'],
      legacyFallbackKeys: evidenceTruthSource === 'legacy_raw_photos_fallback' ? ['legacy_raw_photos_fallback'] : [],
    },
    includeLegacyDesignInput: evidenceTruthSource === 'legacy_raw_photos_fallback',
    decisionProvenance,
  });

  return {
    projectId: survey.projectId,
    surveyId: survey.id,
    photos,
    rawPhotoCount: legacyRawPhotos.length,
    canonicalEvidenceCount: canonicalManifest.summary.totalItems,
    evidenceTruthSource,
    traceability,
    requirementEvaluation,
    documentProvenance,
    decisionProvenance,
    missingCategories,
    completeness,
    blockers,
    warnings,
    manifestV1: {
      itemCount: canonicalManifest.summary.totalItems,
      lifecycleState: canonicalManifest.summary.totalItems > 0 ? 'classified' : 'uploaded',
      aiExtractionStatus: 'not_started',
      qualityStatus: 'not_processed',
      duplicateStatus: 'not_processed',
      engineeringBridge: {
        readiness: bridge.readiness,
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
      normalizedAt,
    },
  };
}


function mapCanonicalManifestEvidence(
  item: SurveyEvidenceItem,
  survey: EnrichedSiteSurvey,
): SurveyPhotoEvidence {
  const extracted: SurveyPhotoEvidence['extracted'] = {};

  if (item.category === 'main_service_panel') {
    if (survey.electrical.mainPanelRatingAmps !== null) {
      extracted.panelRatingAmps = survey.electrical.mainPanelRatingAmps;
    }
  }

  if (item.category === 'meter' && survey.electrical.meterType !== 'unknown') {
    extracted.meterType = survey.electrical.meterType;
  }

  if (item.category === 'roof_plane') {
    if (survey.structural.roofMaterial) extracted.roofMaterial = survey.structural.roofMaterial;
    if (survey.structural.rafterSize) extracted.rafterSize = survey.structural.rafterSize;
    extracted.rafterSpacingInches = survey.structural.rafterSpacingIn;
    if (survey.derived.effectiveAzimuth !== null) extracted.azimuth = survey.derived.effectiveAzimuth;
    if (survey.structural.roofPitchDegrees !== null) extracted.pitch = survey.structural.roofPitchDegrees;
  }

  if (item.category === 'obstructions') {
    extracted.obstructionType = survey.geometry.obstructions[0]?.type;
  }

  return {
    id: item.evidenceId,
    projectId: item.projectId ?? survey.projectId,
    surveyId: item.surveyId,
    fileUrl: item.fileUrl,
    fileId: item.siteSurveyFileId ?? item.projectFileId ?? item.blobKey ?? undefined,
    sourceCategory: mapCanonicalCategoryToSurveyPhotoCategory(item.category),
    category: item.category,
    confidence: item.evidenceConfidence === 'high'
      ? 0.9
      : item.evidenceConfidence === 'medium'
        ? 0.75
        : item.evidenceConfidence === 'low'
          ? 0.4
          : 0.25,
    capturedAt: item.captureTimestamp ?? undefined,
    notes: item.submittedCategory ?? undefined,
    extracted: Object.keys(extracted).length > 0 ? extracted : undefined,
  };
}

function mapCanonicalCategoryToSurveyPhotoCategory(
  category: SurveyEvidenceCategory,
): SurveyPhotoRef['category'] {
  if (category === 'roof_plane' || category === 'rafters' || category === 'attic_access') return 'roof';
  if (category === 'main_service_panel' || category === 'subpanel') return 'panel';
  if (category === 'meter') return 'meter';
  if (category === 'obstructions') return 'obstruction';
  if (category === 'overview' || category === 'inverter_location' || category === 'battery_location' || category === 'gateway_location') return 'site';
  return 'other';
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
