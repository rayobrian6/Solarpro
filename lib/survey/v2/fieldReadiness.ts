// ============================================================================
// Survey V2: field readiness — the "can I leave yet" instrument
//
// This module does NOT decide what engineering needs. That is decided, once,
// by the Engineering Requirement Registry in
// `lib/survey/evidence/engineeringRequirements.ts`, and it is evaluated by
// `buildEngineeringRequirementEvaluation` — the same function the office page
// at /projects/[id]/survey/[surveyId] renders. This module only makes that
// verdict reachable from the phone, BEFORE the truck leaves.
//
// Three authorities are reused, never duplicated:
//   1. `SURVEY_EVIDENCE_CATEGORY_REGISTRY` alias table (categoryRegistry.ts)
//      is the ONLY place a field PhotoCategory becomes a SurveyEvidenceCategory.
//      This file calls `normalizeSurveyEvidenceCategory` and REPORTS what that
//      table covers — it does not carry a second mapping of its own.
//   2. `ENGINEERING_REQUIREMENT_REGISTRY` decides what is blocking /
//      review_required / informational.
//   3. `fieldOrchestration.ts` supplies the movement zone and the technician
//      instruction for the zone the crew must walk back to.
//
// SAFETY RULE APPLIED HERE: a requirement whose satisfaction the field app
// cannot determine renders as `unknown`. It is never reported as satisfied and
// never allowed to make `readyToLeave` true. A silent all-clear on an
// incomplete survey is the failure mode this module exists to prevent.
//
// Pure ASCII, no Unicode.
// ============================================================================

import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';

import type { PhotoCategory, SurveyPhoto } from './types';
import { REQUIRED_PHOTO_CATEGORIES } from './types';

import type { SurveyEvidenceCategory } from '../evidence/manifest';
import {
  buildSurveyEvidenceManifest,
  normalizeSurveyEvidenceCategory,
} from '../evidence/manifest';
import type {
  EngineeringRequirementDefinition,
  EngineeringRequirementId,
  EngineeringRequirementReadinessImpact,
  EngineeringRequirementStatus,
} from '../evidence/engineeringRequirements';
import {
  ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS,
  buildEngineeringRequirementEvaluation,
} from '../evidence/engineeringRequirements';
import { fieldEvidenceStepForCategory } from '../evidence/fieldOrchestration';

export const FIELD_READINESS_ENGINE_SOURCE = 'engineering_requirement_registry_v1' as const;

// ---------------------------------------------------------------------------
// ALL_PHOTO_CATEGORIES
//
// `Record<PhotoCategory, true>` is a compile-time exhaustiveness guard: adding a
// PhotoCategory to types.ts without adding it here is a tsc error, so the
// mapping report below can never silently miss a slot.
// ---------------------------------------------------------------------------
const PHOTO_CATEGORY_PRESENCE: Record<PhotoCategory, true> = {
  main_panel_open: true,
  main_panel_closed: true,
  meter: true,
  roof_overview: true,
  roof_detail: true,
  service_entrance: true,
  attic_access: true,
  obstruction: true,
  additional: true,
};

export const ALL_PHOTO_CATEGORIES = Object.keys(PHOTO_CATEGORY_PRESENCE) as PhotoCategory[];

// ---------------------------------------------------------------------------
// PhotoCategory -> SurveyEvidenceCategory
// ---------------------------------------------------------------------------
export type FieldPhotoCategoryMappingStatus = 'mapped' | 'unmapped';

export interface FieldPhotoCategoryMapping {
  photoCategory: PhotoCategory;
  /** Whatever the alias table resolves to, including 'uncategorized'. */
  evidenceCategory: SurveyEvidenceCategory;
  /** 'unmapped' means the alias table lands on the uncategorized bucket, which
   *  satisfies no engineering requirement. It is reported, never hidden. */
  mappingStatus: FieldPhotoCategoryMappingStatus;
  mappingAuthority: 'survey_evidence_category_alias_table';
  note: string;
}

export function buildFieldPhotoCategoryMappings(): FieldPhotoCategoryMapping[] {
  return ALL_PHOTO_CATEGORIES.map(photoCategory => {
    const evidenceCategory = normalizeSurveyEvidenceCategory(photoCategory);
    const mapped = evidenceCategory !== 'uncategorized';
    return {
      photoCategory,
      evidenceCategory,
      mappingStatus: mapped ? 'mapped' : 'unmapped',
      mappingAuthority: 'survey_evidence_category_alias_table',
      note: mapped
        ? `Field slot "${photoCategory}" resolves to canonical evidence category "${evidenceCategory}" through the evidence category alias table.`
        : `Field slot "${photoCategory}" resolves only to the uncategorized bucket and satisfies no engineering requirement.`,
    } satisfies FieldPhotoCategoryMapping;
  });
}

/** The canonical evidence categories the field app is actually able to produce. */
export function fieldReachableEvidenceCategories(): Set<SurveyEvidenceCategory> {
  return new Set(
    buildFieldPhotoCategoryMappings()
      .filter(mapping => mapping.mappingStatus === 'mapped')
      .map(mapping => mapping.evidenceCategory),
  );
}

/**
 * A requirement is capturable in the field only when every one of its REQUIRED
 * evidence categories can be produced by a field photo slot. Optional evidence
 * can only ever reach `partially_satisfied` in the registry evaluator
 * (`hasRequiredEvidence` demands every required category), so optional-only
 * reachability is not reachability.
 */
export function requirementIsCapturableInField(
  definition: EngineeringRequirementDefinition,
  reachable: Set<SurveyEvidenceCategory> = fieldReachableEvidenceCategories(),
): boolean {
  if (definition.requiredEvidenceCategories.length === 0) return false;
  return definition.requiredEvidenceCategories.every(category => reachable.has(category));
}

// ---------------------------------------------------------------------------
// Readiness view model
// ---------------------------------------------------------------------------
/** `unknown` is added to the registry's own statuses: it is the honest state for
 *  a requirement the field app has no slot for. It is NEVER "satisfied". */
export type FieldReadinessStatus = EngineeringRequirementStatus | 'unknown';

export interface FieldReadinessItem {
  requirementId: EngineeringRequirementId;
  humanLabel: string;
  description: string;
  band: EngineeringRequirementReadinessImpact;
  status: FieldReadinessStatus;
  /** false => status is 'unknown' and the crew cannot resolve it in this app. */
  capturableInField: boolean;
  /** Which field photo slots would satisfy this requirement, if any. */
  fieldPhotoCategories: PhotoCategory[];
  requiredEvidenceCategories: SurveyEvidenceCategory[];
  /** Movement zone from the field orchestration model — where to walk back to. */
  movementZone: string | null;
  movementZoneLabel: string | null;
  technicianInstruction: string | null;
  detail: string;
}

export interface FieldReadinessCoverage {
  /** PhotoCategory values that satisfy no engineering requirement. */
  unmappedPhotoCategories: PhotoCategory[];
  /** Active requirements with no field photo slot at all. Rendered UNKNOWN. */
  uncapturableRequirementIds: EngineeringRequirementId[];
  /** Plain-language statement of what this readiness verdict does NOT cover. */
  limitations: string[];
}

export interface FieldSurveyReadiness {
  engineSource: typeof FIELD_READINESS_ENGINE_SOURCE;
  /** Verbatim from the registry evaluator — same value the office page shows. */
  readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
  completeness: 'missing' | 'partial' | 'sufficient';
  /** The one number a crew acts on. True only when nothing gating is open. */
  readyToLeave: boolean;
  requiredPhotosComplete: boolean;
  missingRequiredPhotoCategories: PhotoCategory[];
  outstandingCounts: {
    blocking: number;
    review_required: number;
    informational: number;
  };
  items: FieldReadinessItem[];
  coverage: FieldReadinessCoverage;
  evaluatedAt: string;
}

export interface BuildFieldSurveyReadinessInput {
  surveyId: string;
  projectId?: string | null;
  inspectorName?: string | null;
  photos: SurveyPhoto[];
  /** Injectable for deterministic tests. */
  evaluatedAt?: string;
}

const MOVEMENT_ZONE_LABELS: Record<string, string> = {
  exterior_arrival: 'Exterior / arrival',
  utility_service_area: 'Utility service area',
  main_service_equipment: 'Main service equipment',
  routing_path: 'Conduit routing path',
  attic_structural_area: 'Attic / structural access',
  roof_area: 'Roof',
  detached_structure_area: 'Detached structure',
  ess_mounting_area: 'Battery / ESS mounting area',
  ground_mount_trench_area: 'Ground mount / trench',
};

// ---------------------------------------------------------------------------
// buildFieldSurveyReadiness
// ---------------------------------------------------------------------------
export function buildFieldSurveyReadiness(
  input: BuildFieldSurveyReadinessInput,
): FieldSurveyReadiness {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const photos = input.photos ?? [];

  // ---- Build the canonical manifest from the in-flight draft --------------
  // Same builder the office path uses, so the phone and the office cannot
  // disagree about what a photo means.
  const survey: Pick<SiteSurvey, 'id' | 'projectId' | 'surveyData' | 'inspectorName'> = {
    id: input.surveyId,
    projectId: input.projectId ?? null,
    surveyData: { photos: photos.map(toPayloadPhoto) },
    inspectorName: input.inspectorName ?? null,
  };

  const files: SiteSurveyFile[] = photos
    .filter(photo => typeof photo?.url === 'string' && photo.url.trim().length > 0)
    .map(photo => ({
      id: photo.id,
      surveyId: input.surveyId,
      fileUrl: photo.url,
      fileType: 'photo' as const,
      label: photo.category,
      filename: null,
      mimeType: null,
      createdAt: photo.capturedAt,
      gpsLat: photo.gps?.lat ?? null,
      gpsLng: photo.gps?.lng ?? null,
      gpsAccuracyM: photo.gps?.accuracyM ?? null,
    }));

  const manifest = buildSurveyEvidenceManifest({ survey, files, generatedAt: evaluatedAt });
  const evaluation = buildEngineeringRequirementEvaluation({ canonicalManifest: manifest });

  // ---- Field-slot reachability -------------------------------------------
  const mappings = buildFieldPhotoCategoryMappings();
  const reachable = fieldReachableEvidenceCategories();
  const slotsByEvidenceCategory = new Map<SurveyEvidenceCategory, PhotoCategory[]>();
  for (const mapping of mappings) {
    if (mapping.mappingStatus !== 'mapped') continue;
    const existing = slotsByEvidenceCategory.get(mapping.evidenceCategory) ?? [];
    existing.push(mapping.photoCategory);
    slotsByEvidenceCategory.set(mapping.evidenceCategory, existing);
  }

  const evaluationById = new Map(
    evaluation.allRequirements.map(requirement => [requirement.requirementId, requirement]),
  );

  const items: FieldReadinessItem[] = ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS.map(definition => {
    const evaluated = evaluationById.get(definition.requirementId) ?? null;
    const capturableInField = requirementIsCapturableInField(definition, reachable);
    const status: FieldReadinessStatus = capturableInField
      ? (evaluated?.status ?? 'unknown')
      : 'unknown';

    const fieldPhotoCategories = definition.requiredEvidenceCategories
      .flatMap(category => slotsByEvidenceCategory.get(category) ?? []);

    const orchestrationStep = definition.requiredEvidenceCategories
      .map(category => fieldEvidenceStepForCategory(category))
      .find(step => step !== null) ?? null;

    return {
      requirementId: definition.requirementId,
      humanLabel: definition.humanLabel,
      description: definition.description,
      band: definition.readinessImpact,
      status,
      capturableInField,
      fieldPhotoCategories: Array.from(new Set(fieldPhotoCategories)),
      requiredEvidenceCategories: definition.requiredEvidenceCategories,
      movementZone: orchestrationStep?.movementZone ?? null,
      movementZoneLabel: orchestrationStep
        ? MOVEMENT_ZONE_LABELS[orchestrationStep.movementZone] ?? orchestrationStep.label
        : null,
      technicianInstruction: orchestrationStep?.technicianInstruction ?? null,
      detail: detailFor(definition, status, capturableInField, Array.from(new Set(fieldPhotoCategories))),
    } satisfies FieldReadinessItem;
  });

  // ---- The counts a crew acts on -----------------------------------------
  const outstandingCounts = {
    blocking: countOutstanding(items, 'blocking'),
    review_required: countOutstanding(items, 'review_required'),
    informational: countOutstanding(items, 'informational'),
  };

  const missingRequiredPhotoCategories = REQUIRED_PHOTO_CATEGORIES.filter(
    category => !photos.some(photo => photo.category === category),
  );
  const requiredPhotosComplete = missingRequiredPhotoCategories.length === 0;

  const readyToLeave =
    requiredPhotosComplete &&
    outstandingCounts.blocking === 0 &&
    outstandingCounts.review_required === 0;

  const uncapturableRequirementIds = items
    .filter(item => !item.capturableInField)
    .map(item => item.requirementId);

  return {
    engineSource: FIELD_READINESS_ENGINE_SOURCE,
    readiness: evaluation.readiness,
    completeness: evaluation.completeness,
    readyToLeave,
    requiredPhotosComplete,
    missingRequiredPhotoCategories,
    outstandingCounts,
    items,
    coverage: {
      unmappedPhotoCategories: mappings
        .filter(mapping => mapping.mappingStatus === 'unmapped')
        .map(mapping => mapping.photoCategory),
      uncapturableRequirementIds,
      limitations: buildLimitations(mappings, uncapturableRequirementIds),
    },
    evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countOutstanding(
  items: FieldReadinessItem[],
  band: EngineeringRequirementReadinessImpact,
): number {
  // UNKNOWN counts as outstanding, never as clear. `satisfied` is the only
  // status that removes an item from the count.
  return items.filter(item => item.band === band && item.status !== 'satisfied').length;
}

function toPayloadPhoto(photo: SurveyPhoto): Record<string, unknown> {
  return {
    url: photo.url,
    uploadKey: photo.uploadKey,
    category: photo.category,
    capturedAt: photo.capturedAt,
  };
}

function detailFor(
  definition: EngineeringRequirementDefinition,
  status: FieldReadinessStatus,
  capturableInField: boolean,
  fieldPhotoCategories: PhotoCategory[],
): string {
  if (!capturableInField) {
    return `This survey app has no capture slot for ${definition.humanLabel}. Status cannot be determined here and is reported as UNKNOWN, not as satisfied.`;
  }
  const slots = fieldPhotoCategories.map(category => category.replace(/_/g, ' ')).join(', ');
  switch (status) {
    case 'satisfied':
      return `Engineering has what it needs for ${definition.humanLabel}.`;
    case 'partially_satisfied':
      return `Partial evidence only. Capture ${slots || definition.requiredEvidenceCategories.join(', ')} before leaving.`;
    case 'insufficient_metadata':
      return `Evidence is present but incomplete for ${definition.humanLabel}. Re-capture ${slots || definition.requiredEvidenceCategories.join(', ')}.`;
    case 'missing':
      return `No evidence captured. Take the ${slots || definition.requiredEvidenceCategories.join(', ')} photo before leaving.`;
    default:
      return `Status for ${definition.humanLabel} could not be determined and is reported as UNKNOWN.`;
  }
}

function buildLimitations(
  mappings: FieldPhotoCategoryMapping[],
  uncapturableRequirementIds: EngineeringRequirementId[],
): string[] {
  const limitations: string[] = [];
  const unmapped = mappings.filter(mapping => mapping.mappingStatus === 'unmapped');
  if (unmapped.length > 0) {
    limitations.push(
      `Field photo slot(s) ${unmapped.map(mapping => mapping.photoCategory).join(', ')} satisfy no engineering requirement and are not counted towards readiness.`,
    );
  }
  if (uncapturableRequirementIds.length > 0) {
    limitations.push(
      `This app has no capture slot for ${uncapturableRequirementIds.join(', ')}. Those requirements are reported UNKNOWN and must be resolved by engineering, not by this screen.`,
    );
  }
  limitations.push(
    'Readiness is evaluated from photo evidence categories only. Answers typed into earlier steps are not evidence.',
  );
  return limitations;
}
