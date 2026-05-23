import type { CADSystemType } from '@/lib/cad/types';
import type { EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import type { DocumentTruthSource } from '@/lib/documentProvenance/types';
import type { EngineeringStateSnapshotReference, EngineeringStaleStateMetadata } from '@/lib/engineeringStateInvalidation/types';

export type EngineeringDecisionType =
  | 'conductor_sizing'
  | 'breaker_sizing'
  | 'ocpd_selection'
  | 'string_topology_selection'
  | 'mppt_assignment'
  | 'inverter_selection'
  | 'ess_placement'
  | 'rapid_shutdown_placement'
  | 'utility_interconnection_assumption'
  | 'setback_assumption'
  | 'conduit_routing_assumption'
  | 'grounding_bonding_assumption'
  | 'placard_requirement'
  | 'layout_orientation_assumption'
  | 'bom_derivation'
  | 'sld_metadata';

export type EngineeringDecisionCategory =
  | 'calculation'
  | 'equipment_selection'
  | 'layout_assumption'
  | 'code_compliance'
  | 'document_metadata'
  | 'fallback_default';

export type EngineeringDomain =
  | 'electrical'
  | 'structural'
  | 'roof_layout'
  | 'interconnection'
  | 'energy_storage'
  | 'document_control'
  | 'bom'
  | 'sld';

export type DecisionConfidenceSource =
  | 'engineering_requirement_registry_v1'
  | 'canonical_manifest_v1'
  | 'permit_input_canonical'
  | 'document_provenance_bundle_v1'
  | 'engineering_decision_registry_v1'
  | 'explicit_default_policy_v1'
  | 'legacy_design_input';

export type DecisionMissingInputBehavior =
  | 'emit_explicit_default_decision'
  | 'emit_review_required_decision'
  | 'emit_informational_decision'
  | 'block_downstream_section'
  | 'not_applicable';

export type DecisionConfidencePolicy =
  | 'canonical_evidence_preferred'
  | 'registry_requirement_required'
  | 'permit_input_allowed_with_explicit_default'
  | 'document_metadata_only'
  | 'inactive_until_input_present';

export interface EngineeringDecisionInputRef {
  inputKey: string;
  inputValue: string | number | boolean | null;
  source: DecisionConfidenceSource;
  deterministicRole: 'selected_value' | 'alternative' | 'constraint' | 'evidence' | 'requirement' | 'fallback_default' | 'metadata';
}

export interface EngineeringRuleReference {
  ruleId: string;
  label: string;
  reference: string;
  ruleType: 'NEC' | 'IBC' | 'ASCE' | 'UL' | 'UTILITY' | 'AHJ' | 'PROJECT_POLICY' | 'DOCUMENT_POLICY';
}

export interface EngineeringDecisionDefinition {
  decisionType: EngineeringDecisionType;
  label: string;
  decisionCategory: EngineeringDecisionCategory;
  engineeringDomain: EngineeringDomain;
  governingRules: EngineeringRuleReference[];
  engineeringDependencies: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  affectedDocumentSectionIds: string[];
  downstreamImpacts: string[];
  missingInputBehavior: DecisionMissingInputBehavior;
  confidencePolicy: DecisionConfidencePolicy;
  deterministicEvaluationNotes: string[];
}

export interface EngineeringDecisionProvenanceRecord {
  decisionId: string;
  decisionType: EngineeringDecisionType;
  decisionCategory: EngineeringDecisionCategory;
  engineeringDomain: EngineeringDomain;
  selectedValue: string | number | boolean | null;
  alternativeValuesConsidered: Array<{
    value: string | number | boolean | null;
    rejectedReason: string;
  }>;
  decisionReason: string;
  decisionInputs: EngineeringDecisionInputRef[];
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  dependencyNodeIds: string[];
  documentSectionIds: string[];
  renderContextIds: string[];
  governingRules: EngineeringRuleReference[];
  equipmentConstraints: string[];
  utilityConstraints: string[];
  geometryAssumptions: string[];
  confidenceSource: DecisionConfidenceSource;
  truthSource: DocumentTruthSource;
  derivedFrom: string[];
  deterministicNotes: string[];
  generatedAt: string;
}

export interface EngineeringDecisionEvaluationBundle {
  bundleId: string;
  generatedAt: string;
  decisionRecords: EngineeringDecisionProvenanceRecord[];
  decisionIds: string[];
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  dependencyNodeIds: string[];
  documentSectionIds: string[];
  renderContextIds: string[];
  governingRuleIds: string[];
  fallbackDecisionIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
  auditGuards: EngineeringDecisionAuditGuardResult[];
}

export type EngineeringDecisionAuditGuardCode =
  | 'decision_lineage_required'
  | 'document_sections_require_governing_rules'
  | 'fallback_assumptions_documented'
  | 'calculations_require_dependency_lineage'
  | 'render_outputs_require_decision_provenance';

export interface EngineeringDecisionAuditGuardResult {
  guardCode: EngineeringDecisionAuditGuardCode;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  deterministicNotes: string[];
}

export interface BuildEngineeringDecisionProvenanceInput {
  bundleId: string;
  generatedAt?: string;
  surveyEvidence?: import('@/lib/engineering/surveyEvidence').EngineeringSurveyEvidence | null;
  documentProvenance?: import('@/lib/documentProvenance').DocumentProvenanceBundle | null;
  cad?: import('@/lib/cad/types').CADModel | null;
  permitInput?: import('@/lib/permit/types').PermitInput | null;
  renderContextIds?: string[];
  includeDocumentMetadataDecisions?: boolean;
}

export interface DecisionAwareBOMMetadata {
  bomRowId: string;
  decisionIds: string[];
  governingRuleIds: string[];
  dependencyNodeIds: string[];
  derivedFrom: string[];
  engineeringStateIds?: string[];
  stateGenerationHash?: string;
  stateDependencyHash?: string;
  staleStateMetadata?: EngineeringStaleStateMetadata;
  engineeringStateSnapshot?: EngineeringStateSnapshotReference;
}

export interface DecisionAwareSLDMetadata {
  sldMetadataId: string;
  decisionIds: string[];
  governingRuleIds: string[];
  dependencyNodeIds: string[];
  fallbackDecisionIds: string[];
  deterministicHash: string;
  topologyDecisionId?: string;
  interconnectionDecisionId?: string;
  engineeringStateIds?: string[];
  stateGenerationHash?: string;
  stateDependencyHash?: string;
  staleStateMetadata?: EngineeringStaleStateMetadata;
  engineeringStateSnapshot?: EngineeringStateSnapshotReference;
}

export interface DecisionAwareReadinessSummary {
  readinessSummaryId: string;
  readinessStatus: 'decision_provenance_available' | 'decision_provenance_missing';
  decisionCount: number;
  fallbackDecisionCount: number;
  confidenceSource: DecisionConfidenceSource;
  decisionIds: string[];
  fallbackDecisionIds: string[];
  governingRuleIds: string[];
  canonicalEvidenceIds: string[];
  deterministicNotes: string[];
  engineeringStateIds?: string[];
  stateGenerationHash?: string;
  stateDependencyHash?: string;
  staleStateMetadata?: EngineeringStaleStateMetadata;
  engineeringStateSnapshot?: EngineeringStateSnapshotReference;
}

export type DecisionGraphSystemType = CADSystemType | 'unknown';
