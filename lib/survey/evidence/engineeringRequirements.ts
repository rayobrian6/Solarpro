import type { SurveyEvidenceCategory, SurveyEvidenceManifest } from './manifest';
import {
  getSurveyEvidenceCategoryDefinition,
  getSurveyEvidenceLabel,
} from './manifest';
import {
  buildSurveyEvidenceTraceability,
  type CanonicalEvidenceProvenanceRecord,
  type EvidenceMetadataCompleteness,
  type RequirementConfidenceSource,
  type RequirementEvidenceTraceabilityRecord,
  type SurveyEvidenceTraceabilityBundle,
} from './provenance';

export type EngineeringRequirementId =
  | 'main_service_panel'
  | 'utility_meter'
  | 'roof_overview'
  | 'attic_access'
  | 'subpanel'
  | 'main_disconnect'
  | 'structural_access'
  | 'utility_bill'
  | 'placards'
  | 'rapid_shutdown'
  | 'battery_location'
  | 'service_equipment_label';

export type EngineeringRequirementUsage =
  | 'electrical_design'
  | 'structural_review'
  | 'roof_layout'
  | 'site_plan'
  | 'permit_validation'
  | 'interconnection';

export type EngineeringRequirementReadinessImpact = 'blocking' | 'review_required' | 'informational';
export type EngineeringRequirementMissingSeverity = 'blocker' | 'warning' | 'info';
export type EngineeringRequirementStatus = 'satisfied' | 'partially_satisfied' | 'missing' | 'insufficient_metadata' | 'inactive';
export type EngineeringRequirementConfidencePolicy = 'canonical_evidence_required' | 'canonical_or_optional_evidence' | 'manual_review_only' | 'inactive_future';

export interface EngineeringRequirementFutureCapabilities {
  supportsOCR: boolean;
  supportsCVClassification: boolean;
  supportsCADInference: boolean;
  supportsSemanticExtraction: boolean;
}

export interface EngineeringRequirementMetadataCompletenessRules {
  requireFileUrl: boolean;
  requireFilename: boolean;
  requireMimeType: boolean;
  requireCaptureTimestamp: boolean;
  requireSubmittedCategory: boolean;
  requireSiteSurveyFileId: boolean;
  requireSurveyTechnician: boolean;
}

export interface EngineeringRequirementDefinition {
  requirementId: EngineeringRequirementId;
  humanLabel: string;
  description: string;
  requiredEvidenceCategories: SurveyEvidenceCategory[];
  optionalEvidenceCategories: SurveyEvidenceCategory[];
  minimumCanonicalEvidenceCount: number;
  metadataCompletenessRules: EngineeringRequirementMetadataCompletenessRules;
  engineeringUsage: EngineeringRequirementUsage[];
  permitUsage: string[];
  confidencePolicy: EngineeringRequirementConfidencePolicy;
  readinessImpact: EngineeringRequirementReadinessImpact;
  missingSeverity: EngineeringRequirementMissingSeverity;
  futureCapabilities: EngineeringRequirementFutureCapabilities;
  active: boolean;
}

export interface EngineeringRequirementEvaluation {
  requirementId: EngineeringRequirementId;
  humanLabel: string;
  description: string;
  status: EngineeringRequirementStatus;
  requirementSatisfied: boolean;
  partiallySatisfied: boolean;
  missing: boolean;
  insufficientMetadata: boolean;
  duplicateCollapsed: boolean;
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  originatingSurveyCreatedAts: Array<string | null>;
  evidenceCategoriesSatisfied: SurveyEvidenceCategory[];
  requiredEvidenceCategories: SurveyEvidenceCategory[];
  optionalEvidenceCategories: SurveyEvidenceCategory[];
  minimumCanonicalEvidenceCount: number;
  observedCanonicalEvidenceCount: number;
  metadataCompletenessRules: EngineeringRequirementMetadataCompletenessRules;
  failedMetadataRules: string[];
  engineeringUsage: EngineeringRequirementUsage[];
  permitUsage: string[];
  confidencePolicy: EngineeringRequirementConfidencePolicy;
  confidenceSource: RequirementConfidenceSource | 'registry_policy' | 'inactive_requirement';
  readinessImpact: EngineeringRequirementReadinessImpact;
  missingSeverity: EngineeringRequirementMissingSeverity;
  futureCapabilities: EngineeringRequirementFutureCapabilities;
  active: boolean;
  provenanceRecords: CanonicalEvidenceProvenanceRecord[];
  traceabilityRecords: RequirementEvidenceTraceabilityRecord[];
  reasoningPath: string[];
  deterministicEvaluationNotes: string[];
}

export interface EngineeringRequirementEvaluationSummary {
  readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
  completeness: 'missing' | 'partial' | 'sufficient';
  confidenceSource: 'engineering_requirement_registry_v1';
  satisfiedRequirements: EngineeringRequirementEvaluation[];
  missingRequirements: EngineeringRequirementEvaluation[];
  partiallySatisfiedRequirements: EngineeringRequirementEvaluation[];
  blockedRequirements: EngineeringRequirementEvaluation[];
  informationalRequirements: EngineeringRequirementEvaluation[];
  inactiveRequirements: EngineeringRequirementEvaluation[];
  allRequirements: EngineeringRequirementEvaluation[];
  deterministicSummary: string[];
}

export interface BuildEngineeringRequirementEvaluationInput {
  canonicalManifest: SurveyEvidenceManifest | null | undefined;
  traceability?: SurveyEvidenceTraceabilityBundle | null;
  engineeringBridge?: {
    readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
    requirementTraceability?: RequirementEvidenceTraceabilityRecord[];
    missingRequirementTraceability?: RequirementEvidenceTraceabilityRecord[];
  } | null;
}

const STRICT_METADATA_RULES: EngineeringRequirementMetadataCompletenessRules = {
  requireFileUrl: true,
  requireFilename: false,
  requireMimeType: false,
  requireCaptureTimestamp: false,
  requireSubmittedCategory: false,
  requireSiteSurveyFileId: false,
  requireSurveyTechnician: false,
};

const OPTIONAL_METADATA_RULES: EngineeringRequirementMetadataCompletenessRules = {
  requireFileUrl: true,
  requireFilename: false,
  requireMimeType: false,
  requireCaptureTimestamp: false,
  requireSubmittedCategory: false,
  requireSiteSurveyFileId: false,
  requireSurveyTechnician: false,
};

const INACTIVE_METADATA_RULES: EngineeringRequirementMetadataCompletenessRules = {
  requireFileUrl: false,
  requireFilename: false,
  requireMimeType: false,
  requireCaptureTimestamp: false,
  requireSubmittedCategory: false,
  requireSiteSurveyFileId: false,
  requireSurveyTechnician: false,
};

const FUTURE_FLAGS_OFF: EngineeringRequirementFutureCapabilities = {
  supportsOCR: false,
  supportsCVClassification: false,
  supportsCADInference: false,
  supportsSemanticExtraction: false,
};

const FUTURE_FLAGS_DOCUMENTED: EngineeringRequirementFutureCapabilities = {
  supportsOCR: true,
  supportsCVClassification: true,
  supportsCADInference: false,
  supportsSemanticExtraction: true,
};

export const ENGINEERING_REQUIREMENT_REGISTRY: Record<EngineeringRequirementId, EngineeringRequirementDefinition> = {
  main_service_panel: {
    requirementId: 'main_service_panel',
    humanLabel: 'Main Service Panel',
    description: 'Canonical evidence of the main service panel for electrical interconnection review.',
    requiredEvidenceCategories: ['main_service_panel'],
    optionalEvidenceCategories: ['subpanel', 'disconnect', 'grounding'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: STRICT_METADATA_RULES,
    engineeringUsage: ['electrical_design', 'permit_validation'],
    permitUsage: ['Electrical sheets', 'Validation summary', 'Interconnection notes'],
    confidencePolicy: 'canonical_evidence_required',
    readinessImpact: 'blocking',
    missingSeverity: 'blocker',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  utility_meter: {
    requirementId: 'utility_meter',
    humanLabel: 'Utility Meter',
    description: 'Canonical evidence of the utility meter or meter socket for service location traceability.',
    requiredEvidenceCategories: ['meter'],
    optionalEvidenceCategories: ['utility_connection', 'utility_access'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: STRICT_METADATA_RULES,
    engineeringUsage: ['electrical_design', 'interconnection', 'permit_validation'],
    permitUsage: ['Electrical one-line context', 'Interconnection checklist'],
    confidencePolicy: 'canonical_evidence_required',
    readinessImpact: 'blocking',
    missingSeverity: 'blocker',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  roof_overview: {
    requirementId: 'roof_overview',
    humanLabel: 'Roof Overview',
    description: 'Canonical roof-plane evidence for roof layout and plan-set traceability.',
    requiredEvidenceCategories: ['roof_plane'],
    optionalEvidenceCategories: ['roof_edge', 'ridge', 'roof_surface', 'obstructions'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: STRICT_METADATA_RULES,
    engineeringUsage: ['roof_layout', 'permit_validation'],
    permitUsage: ['Roof layout notes', 'Validation summary'],
    confidencePolicy: 'canonical_evidence_required',
    readinessImpact: 'blocking',
    missingSeverity: 'blocker',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  attic_access: {
    requirementId: 'attic_access',
    humanLabel: 'Attic Access',
    description: 'Optional evidence of attic access for structural review workflow context.',
    requiredEvidenceCategories: ['attic_access'],
    optionalEvidenceCategories: ['attic', 'rafters'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: OPTIONAL_METADATA_RULES,
    engineeringUsage: ['structural_review'],
    permitUsage: ['Structural review notes'],
    confidencePolicy: 'canonical_or_optional_evidence',
    readinessImpact: 'review_required',
    missingSeverity: 'warning',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  subpanel: {
    requirementId: 'subpanel',
    humanLabel: 'Subpanel',
    description: 'Optional canonical subpanel evidence when downstream distribution equipment is present.',
    requiredEvidenceCategories: ['subpanel'],
    optionalEvidenceCategories: ['main_service_panel'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: OPTIONAL_METADATA_RULES,
    engineeringUsage: ['electrical_design'],
    permitUsage: ['Electrical notes when applicable'],
    confidencePolicy: 'canonical_or_optional_evidence',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  main_disconnect: {
    requirementId: 'main_disconnect',
    humanLabel: 'Main Disconnect',
    description: 'Optional canonical disconnect evidence for electrical equipment review.',
    requiredEvidenceCategories: ['disconnect'],
    optionalEvidenceCategories: ['main_service_panel', 'utility_connection'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: OPTIONAL_METADATA_RULES,
    engineeringUsage: ['electrical_design', 'interconnection'],
    permitUsage: ['Electrical notes when applicable'],
    confidencePolicy: 'canonical_or_optional_evidence',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  structural_access: {
    requirementId: 'structural_access',
    humanLabel: 'Structural Access',
    description: 'Canonical attic, rafter, or access evidence for structural review context.',
    requiredEvidenceCategories: ['attic_access'],
    optionalEvidenceCategories: ['attic', 'rafters', 'roof_surface'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: OPTIONAL_METADATA_RULES,
    engineeringUsage: ['structural_review'],
    permitUsage: ['Structural notes'],
    confidencePolicy: 'canonical_or_optional_evidence',
    readinessImpact: 'review_required',
    missingSeverity: 'warning',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  utility_bill: {
    requirementId: 'utility_bill',
    humanLabel: 'Utility Bill',
    description: 'Future utility-bill document evidence requirement; inactive in registry v1.',
    requiredEvidenceCategories: [],
    optionalEvidenceCategories: [],
    minimumCanonicalEvidenceCount: 0,
    metadataCompletenessRules: INACTIVE_METADATA_RULES,
    engineeringUsage: ['interconnection'],
    permitUsage: ['Future interconnection packet support'],
    confidencePolicy: 'inactive_future',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: { ...FUTURE_FLAGS_DOCUMENTED, supportsCADInference: false },
    active: false,
  },
  placards: {
    requirementId: 'placards',
    humanLabel: 'Placards / Labels',
    description: 'Future placard/label evidence requirement; inactive in registry v1.',
    requiredEvidenceCategories: [],
    optionalEvidenceCategories: [],
    minimumCanonicalEvidenceCount: 0,
    metadataCompletenessRules: INACTIVE_METADATA_RULES,
    engineeringUsage: ['permit_validation'],
    permitUsage: ['Future placard verification support'],
    confidencePolicy: 'inactive_future',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: false,
  },
  rapid_shutdown: {
    requirementId: 'rapid_shutdown',
    humanLabel: 'Rapid Shutdown Equipment',
    description: 'Future rapid-shutdown equipment evidence requirement; inactive in registry v1.',
    requiredEvidenceCategories: [],
    optionalEvidenceCategories: [],
    minimumCanonicalEvidenceCount: 0,
    metadataCompletenessRules: INACTIVE_METADATA_RULES,
    engineeringUsage: ['electrical_design', 'permit_validation'],
    permitUsage: ['Future rapid shutdown notes'],
    confidencePolicy: 'inactive_future',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: false,
  },
  battery_location: {
    requirementId: 'battery_location',
    humanLabel: 'Battery Location',
    description: 'Optional canonical battery-location evidence when storage is in scope.',
    requiredEvidenceCategories: ['battery_location'],
    optionalEvidenceCategories: ['garage_interior_wall', 'overview'],
    minimumCanonicalEvidenceCount: 1,
    metadataCompletenessRules: OPTIONAL_METADATA_RULES,
    engineeringUsage: ['site_plan', 'electrical_design'],
    permitUsage: ['Storage layout notes when applicable'],
    confidencePolicy: 'canonical_or_optional_evidence',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: true,
  },
  service_equipment_label: {
    requirementId: 'service_equipment_label',
    humanLabel: 'Service Equipment Label',
    description: 'Future service-equipment label evidence requirement; inactive in registry v1.',
    requiredEvidenceCategories: [],
    optionalEvidenceCategories: [],
    minimumCanonicalEvidenceCount: 0,
    metadataCompletenessRules: INACTIVE_METADATA_RULES,
    engineeringUsage: ['electrical_design', 'permit_validation'],
    permitUsage: ['Future service equipment label verification'],
    confidencePolicy: 'inactive_future',
    readinessImpact: 'informational',
    missingSeverity: 'info',
    futureCapabilities: FUTURE_FLAGS_DOCUMENTED,
    active: false,
  },
};

export const ENGINEERING_REQUIREMENT_DEFINITIONS = Object.values(ENGINEERING_REQUIREMENT_REGISTRY);
export const ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS = ENGINEERING_REQUIREMENT_DEFINITIONS.filter(requirement => requirement.active);

export function buildEngineeringRequirementEvaluation(
  input: BuildEngineeringRequirementEvaluationInput,
): EngineeringRequirementEvaluationSummary {
  const manifest = input.canonicalManifest ?? null;
  const traceability = input.traceability ?? buildSurveyEvidenceTraceability({
    canonicalManifest: manifest,
    evidenceTruthSource: 'canonical_manifest_v1',
  });

  const evaluations = ENGINEERING_REQUIREMENT_DEFINITIONS.map(definition => evaluateRequirement(definition, manifest, traceability));
  const activeEvaluations = evaluations.filter(evaluation => evaluation.active);
  const satisfiedRequirements = activeEvaluations.filter(evaluation => evaluation.status === 'satisfied');
  const partiallySatisfiedRequirements = activeEvaluations.filter(evaluation => evaluation.status === 'partially_satisfied' || evaluation.status === 'insufficient_metadata');
  const missingRequirements = activeEvaluations.filter(evaluation => evaluation.status === 'missing');
  const blockedRequirements = activeEvaluations.filter(evaluation =>
    evaluation.readinessImpact === 'blocking' && evaluation.status !== 'satisfied',
  );
  const informationalRequirements = activeEvaluations.filter(evaluation => evaluation.readinessImpact === 'informational');
  const inactiveRequirements = evaluations.filter(evaluation => !evaluation.active);

  const readiness: EngineeringRequirementEvaluationSummary['readiness'] = blockedRequirements.length > 0
    ? 'blocked'
    : partiallySatisfiedRequirements.some(requirement => requirement.readinessImpact === 'review_required') || missingRequirements.some(requirement => requirement.readinessImpact === 'review_required')
      ? 'needs_review'
      : 'ready_for_engineering';

  const completeness: EngineeringRequirementEvaluationSummary['completeness'] = activeEvaluations.length === 0 || manifest?.summary.totalItems === 0
    ? 'missing'
    : blockedRequirements.length === 0 && missingRequirements.filter(requirement => requirement.readinessImpact !== 'informational').length === 0 && partiallySatisfiedRequirements.length === 0
      ? 'sufficient'
      : 'partial';

  return {
    readiness,
    completeness,
    confidenceSource: 'engineering_requirement_registry_v1',
    satisfiedRequirements,
    missingRequirements,
    partiallySatisfiedRequirements,
    blockedRequirements,
    informationalRequirements,
    inactiveRequirements,
    allRequirements: evaluations,
    deterministicSummary: [
      'Engineering Requirement Registry v1 evaluated canonicalManifest and provenance traceability only.',
      `Registry evaluated ${activeEvaluations.length} active requirement(s) and ${inactiveRequirements.length} inactive future requirement(s).`,
      `Readiness resolved to ${readiness}; completeness resolved to ${completeness}.`,
      'Raw upload history is not consumed for satisfaction; duplicate collapse is represented through provenance group sizes only.',
      'Future capability flags are informational and do not activate OCR, CV, semantic extraction, CAD inference, or image-byte inspection.',
    ],
  };
}

function evaluateRequirement(
  definition: EngineeringRequirementDefinition,
  manifest: SurveyEvidenceManifest | null,
  traceability: SurveyEvidenceTraceabilityBundle,
): EngineeringRequirementEvaluation {
  if (!definition.active) {
    return inactiveEvaluation(definition);
  }

  const provenanceRecords = traceability.canonicalEvidence.filter(record =>
    definition.requiredEvidenceCategories.includes(record.evidenceCategory)
    || definition.optionalEvidenceCategories.includes(record.evidenceCategory),
  );
  const requiredRecords = provenanceRecords.filter(record => definition.requiredEvidenceCategories.includes(record.evidenceCategory));
  const optionalRecords = provenanceRecords.filter(record => definition.optionalEvidenceCategories.includes(record.evidenceCategory));
  const satisfyingRecords = definition.confidencePolicy === 'canonical_or_optional_evidence'
    ? [...requiredRecords, ...optionalRecords]
    : requiredRecords;
  const uniqueRecords = uniqueByEvidenceId(satisfyingRecords);
  const traceabilityRecords = traceability.requirements.filter(record =>
    definition.requiredEvidenceCategories.includes(record.requirementCategory)
    || definition.optionalEvidenceCategories.includes(record.requirementCategory),
  );
  const failedMetadataRules = uniqueRecords.flatMap(record => failedMetadataRulesFor(record.metadataCompleteness, definition.metadataCompletenessRules, record.canonicalEvidenceId));
  const observedCanonicalEvidenceCount = uniqueRecords.length;
  const hasMinimumEvidence = observedCanonicalEvidenceCount >= definition.minimumCanonicalEvidenceCount;
  const hasRequiredEvidence = definition.requiredEvidenceCategories.length === 0
    || definition.requiredEvidenceCategories.every(category => requiredRecords.some(record => record.evidenceCategory === category));
  const hasOptionalEvidence = optionalRecords.length > 0;
  const insufficientMetadata = hasMinimumEvidence && failedMetadataRules.length > 0;
  const requirementSatisfied = hasMinimumEvidence && hasRequiredEvidence && !insufficientMetadata;
  const partiallySatisfied = !requirementSatisfied && observedCanonicalEvidenceCount > 0;
  const missing = observedCanonicalEvidenceCount === 0;
  const status: EngineeringRequirementStatus = requirementSatisfied
    ? 'satisfied'
    : insufficientMetadata
      ? 'insufficient_metadata'
      : partiallySatisfied || (definition.confidencePolicy === 'canonical_or_optional_evidence' && hasOptionalEvidence)
        ? 'partially_satisfied'
        : 'missing';
  const confidenceSource = confidenceSourceFor(uniqueRecords, status);

  return {
    requirementId: definition.requirementId,
    humanLabel: definition.humanLabel,
    description: definition.description,
    status,
    requirementSatisfied,
    partiallySatisfied: status === 'partially_satisfied',
    missing,
    insufficientMetadata,
    duplicateCollapsed: uniqueRecords.some(record => record.duplicateGroupSize > 1),
    canonicalEvidenceIds: uniqueRecords.map(record => record.canonicalEvidenceId),
    originatingSurveyIds: Array.from(new Set(uniqueRecords.map(record => record.originatingSurveyId))),
    originatingSurveyCreatedAts: uniqueRecords.map(record => record.originatingSurveyCreatedAt),
    evidenceCategoriesSatisfied: Array.from(new Set(uniqueRecords.map(record => record.evidenceCategory))),
    requiredEvidenceCategories: definition.requiredEvidenceCategories,
    optionalEvidenceCategories: definition.optionalEvidenceCategories,
    minimumCanonicalEvidenceCount: definition.minimumCanonicalEvidenceCount,
    observedCanonicalEvidenceCount,
    metadataCompletenessRules: definition.metadataCompletenessRules,
    failedMetadataRules,
    engineeringUsage: definition.engineeringUsage,
    permitUsage: definition.permitUsage,
    confidencePolicy: definition.confidencePolicy,
    confidenceSource,
    readinessImpact: definition.readinessImpact,
    missingSeverity: definition.missingSeverity,
    futureCapabilities: definition.futureCapabilities,
    active: definition.active,
    provenanceRecords: uniqueRecords,
    traceabilityRecords,
    reasoningPath: reasoningPathFor(definition, status, uniqueRecords, failedMetadataRules, manifest),
    deterministicEvaluationNotes: [
      `Requirement ${definition.requirementId} evaluated against required categories: ${definition.requiredEvidenceCategories.join(', ') || 'none'}.`,
      `Observed ${observedCanonicalEvidenceCount} canonical evidence item(s); minimum required: ${definition.minimumCanonicalEvidenceCount}.`,
      uniqueRecords.some(record => record.duplicateGroupSize > 1)
        ? 'Duplicate-collapsed status: at least one satisfying canonical representative includes duplicate group provenance.'
        : 'Duplicate-collapsed status: no duplicate group inflation applied to this requirement.',
      `Confidence source: ${confidenceSource}.`,
      'Evaluation is deterministic registry logic over canonical manifest/provenance only.',
    ],
  };
}

function inactiveEvaluation(definition: EngineeringRequirementDefinition): EngineeringRequirementEvaluation {
  return {
    requirementId: definition.requirementId,
    humanLabel: definition.humanLabel,
    description: definition.description,
    status: 'inactive',
    requirementSatisfied: false,
    partiallySatisfied: false,
    missing: false,
    insufficientMetadata: false,
    duplicateCollapsed: false,
    canonicalEvidenceIds: [],
    originatingSurveyIds: [],
    originatingSurveyCreatedAts: [],
    evidenceCategoriesSatisfied: [],
    requiredEvidenceCategories: definition.requiredEvidenceCategories,
    optionalEvidenceCategories: definition.optionalEvidenceCategories,
    minimumCanonicalEvidenceCount: definition.minimumCanonicalEvidenceCount,
    observedCanonicalEvidenceCount: 0,
    metadataCompletenessRules: definition.metadataCompletenessRules,
    failedMetadataRules: [],
    engineeringUsage: definition.engineeringUsage,
    permitUsage: definition.permitUsage,
    confidencePolicy: definition.confidencePolicy,
    confidenceSource: 'inactive_requirement',
    readinessImpact: definition.readinessImpact,
    missingSeverity: definition.missingSeverity,
    futureCapabilities: definition.futureCapabilities,
    active: false,
    provenanceRecords: [],
    traceabilityRecords: [],
    reasoningPath: [
      `Requirement ${definition.requirementId} is inactive in Engineering Requirement Registry v1.`,
      'Inactive future capability flags are informational only and do not trigger runtime intelligence.',
    ],
    deterministicEvaluationNotes: [
      'Inactive requirement was listed for future normalization but excluded from readiness/completeness.',
      'No OCR, CV, semantic extraction, CAD inference, or image-byte processing is activated by this flag set.',
    ],
  };
}

function failedMetadataRulesFor(
  metadata: EvidenceMetadataCompleteness,
  rules: EngineeringRequirementMetadataCompletenessRules,
  evidenceId: string,
): string[] {
  const failures: string[] = [];
  if (rules.requireFileUrl && !metadata.hasFileUrl) failures.push(`${evidenceId}: fileUrl missing`);
  if (rules.requireFilename && !metadata.hasFilename) failures.push(`${evidenceId}: filename missing`);
  if (rules.requireMimeType && !metadata.hasMimeType) failures.push(`${evidenceId}: mimeType missing`);
  if (rules.requireCaptureTimestamp && !metadata.hasCaptureTimestamp) failures.push(`${evidenceId}: captureTimestamp missing`);
  if (rules.requireSubmittedCategory && !metadata.hasSubmittedCategory) failures.push(`${evidenceId}: submittedCategory missing`);
  if (rules.requireSiteSurveyFileId && !metadata.hasSiteSurveyFileId) failures.push(`${evidenceId}: siteSurveyFileId missing`);
  if (rules.requireSurveyTechnician && !metadata.hasSurveyTechnician) failures.push(`${evidenceId}: surveyTechnician missing`);
  return failures;
}

function confidenceSourceFor(
  records: CanonicalEvidenceProvenanceRecord[],
  status: EngineeringRequirementStatus,
): EngineeringRequirementEvaluation['confidenceSource'] {
  if (status === 'missing') return 'missing_requirement';
  if (records.some(record => record.requirementConfidenceSource === 'canonical_evidence_confidence')) return 'canonical_evidence_confidence';
  if (records.some(record => record.requirementConfidenceSource === 'canonical_manifest_summary')) return 'canonical_manifest_summary';
  return 'registry_policy';
}

function reasoningPathFor(
  definition: EngineeringRequirementDefinition,
  status: EngineeringRequirementStatus,
  records: CanonicalEvidenceProvenanceRecord[],
  failedMetadataRules: string[],
  manifest: SurveyEvidenceManifest | null,
): string[] {
  const requiredLabels = definition.requiredEvidenceCategories.map(category => getSurveyEvidenceLabel(category)).join(', ') || 'none';
  const optionalLabels = definition.optionalEvidenceCategories.map(category => getSurveyEvidenceLabel(category)).join(', ') || 'none';
  return [
    `Registry requirement ${definition.requirementId} (${definition.humanLabel}) is active=${definition.active}.`,
    `Required canonical categories: ${requiredLabels}; optional canonical categories: ${optionalLabels}.`,
    `canonicalManifest totalItems=${manifest?.summary.totalItems ?? 0}; requiredMissing=${manifest?.requiredMissing.join(', ') || 'none'}.`,
    records.length
      ? `Canonical evidence ids used: ${records.map(record => record.canonicalEvidenceId).join(', ')}.`
      : 'No canonical evidence ids satisfy this registry requirement.',
    failedMetadataRules.length
      ? `Metadata rule failures: ${failedMetadataRules.join('; ')}.`
      : 'Metadata completeness rules passed or no strict metadata rules were required beyond canonical file URL.',
    `Final deterministic status: ${status}.`,
  ];
}

function uniqueByEvidenceId(records: CanonicalEvidenceProvenanceRecord[]): CanonicalEvidenceProvenanceRecord[] {
  const seen = new Set<string>();
  const unique: CanonicalEvidenceProvenanceRecord[] = [];
  for (const record of records.sort((a, b) => a.canonicalEvidenceId.localeCompare(b.canonicalEvidenceId))) {
    if (seen.has(record.canonicalEvidenceId)) continue;
    seen.add(record.canonicalEvidenceId);
    unique.push(record);
  }
  return unique;
}

export function requirementDefinitionForCategory(category: SurveyEvidenceCategory): EngineeringRequirementDefinition | null {
  return ACTIVE_ENGINEERING_REQUIREMENT_DEFINITIONS.find(requirement =>
    requirement.requiredEvidenceCategories.includes(category) || requirement.optionalEvidenceCategories.includes(category),
  ) ?? null;
}

export function requirementLabelForCategory(category: SurveyEvidenceCategory): string {
  return requirementDefinitionForCategory(category)?.humanLabel ?? getSurveyEvidenceCategoryDefinition(category).label;
}
