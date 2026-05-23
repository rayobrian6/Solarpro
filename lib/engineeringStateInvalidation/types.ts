import type { DocumentTruthSource, DocumentType, EngineeringDependencyGraph, EngineeringDependencyNodeType } from '@/lib/documentProvenance';
import type { EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringDecisionType } from '@/lib/engineeringDecisionProvenance';

export type EngineeringStateType =
  | 'render_output'
  | 'engineering_calculation'
  | 'document_section'
  | 'dependency_graph_node'
  | 'decision_provenance'
  | 'requirement_evaluation'
  | 'bom_row'
  | 'sld_section'
  | 'layout_primitive'
  | 'render_context';

export type EngineeringStateCategory =
  | 'electrical'
  | 'structural'
  | 'roof_layout'
  | 'interconnection'
  | 'utility'
  | 'bom'
  | 'sld'
  | 'document_control'
  | 'rendering';

export type EngineeringStaleStatus = 'current' | 'stale' | 'blocked' | 'unknown';

export type EngineeringInvalidationTriggerType =
  | 'canonical_evidence_changed'
  | 'requirement_changed'
  | 'decision_changed'
  | 'dependency_node_changed'
  | 'provenance_hash_changed'
  | 'generation_hash_changed';

export interface EngineeringGenerationInputs {
  inputKeys: string[];
  canonicalInputKeys: string[];
  cadPrimitiveIds: string[];
  legacyFallbackKeys: string[];
  deterministicSources: string[];
}

export interface EngineeringStateRecord {
  stateId: string;
  stateType: EngineeringStateType;
  stateCategory: EngineeringStateCategory;
  documentType: DocumentType | 'not_document_bound';
  renderContextId?: string;
  dependencyNodeIds: string[];
  requirementIds: EngineeringRequirementId[];
  decisionIds: string[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  generationInputs: EngineeringGenerationInputs;
  generationHash: string;
  provenanceHash: string;
  dependencyHash: string;
  staleStatus: EngineeringStaleStatus;
  invalidationReason?: string;
  invalidatedAt?: string;
  regeneratedAt?: string;
  truthSource: DocumentTruthSource;
  deterministicNotes: string[];
}

export interface EngineeringStateRegistry {
  registryId: string;
  generatedAt: string;
  stateRecords: EngineeringStateRecord[];
  stateIds: string[];
  generationHash: string;
  provenanceHash: string;
  dependencyHash: string;
  deterministicHash: string;
  deterministicNotes: string[];
  auditGuards: EngineeringStateAuditGuardResult[];
}

export interface EngineeringInvalidationTrigger {
  triggerId: string;
  triggerType: EngineeringInvalidationTriggerType;
  changedCanonicalEvidenceIds: string[];
  changedRequirementIds: EngineeringRequirementId[];
  changedDecisionIds: string[];
  changedDependencyNodeIds: string[];
  previousHash?: string;
  nextHash?: string;
  triggeredAt: string;
  deterministicReason: string;
}

export interface EngineeringInvalidationEvent {
  eventId: string;
  stateId: string;
  staleStatus: Exclude<EngineeringStaleStatus, 'current'>;
  invalidationReason: string;
  triggeringDependencyIds: string[];
  triggeringRequirementIds: EngineeringRequirementId[];
  triggeringDecisionIds: string[];
  triggeringCanonicalEvidenceIds: string[];
  impactedDownstreamStateIds: string[];
  lastValidGenerationHash: string;
  lastValidProvenanceHash: string;
  invalidatedAt: string;
  deterministicNotes: string[];
}

export interface EngineeringInvalidationResult {
  resultId: string;
  generatedAt: string;
  trigger: EngineeringInvalidationTrigger;
  affectedStateIds: string[];
  unaffectedStateIds: string[];
  invalidationEvents: EngineeringInvalidationEvent[];
  updatedStateRecords: EngineeringStateRecord[];
  deterministicHash: string;
  deterministicNotes: string[];
  auditGuards: EngineeringStateAuditGuardResult[];
}

export interface SelectiveRegenerationPlan {
  planId: string;
  generatedAt: string;
  triggerId: string;
  affectedDocumentSections: string[];
  affectedEngineeringDecisions: string[];
  affectedRenderContexts: string[];
  affectedBOMRows: string[];
  affectedSLDSections: string[];
  affectedLayoutPrimitives: string[];
  blockedRegenerationDependencies: string[];
  regenerationOrder: string[];
  unchangedPreservedOutputs: string[];
  staleStateIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface EngineeringStaleStateMetadata {
  staleStatus: EngineeringStaleStatus;
  staleReason?: string;
  triggeringDependencyIds: string[];
  lastValidGenerationHash?: string;
  impactedDownstreamStateIds: string[];
  invalidationEventIds: string[];
}

export interface EngineeringInvalidationLineageMetadata {
  stateRegistryId: string;
  stateIds: string[];
  generationHash: string;
  provenanceHash: string;
  dependencyHash: string;
  staleStateIds: string[];
  invalidationEventIds: string[];
  regenerationPlanId?: string;
  deterministicNotes: string[];
}

export type EngineeringStateAuditGuardCode =
  | 'rendering_from_stale_dependencies_blocked'
  | 'regeneration_requires_provenance_lineage'
  | 'regeneration_from_raw_uploads_blocked'
  | 'document_sections_not_orphaned'
  | 'decision_outputs_have_invalidation_tracking'
  | 'dependency_propagation_not_hidden';

export interface EngineeringStateAuditGuardResult {
  guardCode: EngineeringStateAuditGuardCode;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  deterministicNotes: string[];
}

export interface BuildEngineeringStateRegistryInput {
  registryId: string;
  generatedAt?: string;
  documentProvenance?: import('@/lib/documentProvenance').DocumentProvenanceBundle | null;
  decisionProvenance?: import('@/lib/engineeringDecisionProvenance').EngineeringDecisionEvaluationBundle | null;
  dependencyGraph?: EngineeringDependencyGraph | null;
  renderContextIds?: string[];
  bomMetadata?: import('@/lib/engineeringDecisionProvenance').DecisionAwareBOMMetadata[] | null;
  sldMetadata?: import('@/lib/engineeringDecisionProvenance').DecisionAwareSLDMetadata | null;
}

export interface InvalidateEngineeringStateInput {
  resultId: string;
  generatedAt?: string;
  registry: EngineeringStateRegistry;
  trigger: EngineeringInvalidationTrigger;
  dependencyGraph?: EngineeringDependencyGraph | null;
}

export interface BuildSelectiveRegenerationPlanInput {
  planId: string;
  generatedAt?: string;
  invalidationResult: EngineeringInvalidationResult;
  dependencyGraph?: EngineeringDependencyGraph | null;
}

export type StateAwareDependencyNodeMetadata = {
  stateIds: string[];
  staleStatus: EngineeringStaleStatus;
  generationHash: string;
  dependencyHash: string;
  invalidationReason?: string;
};

export type StateRegistryNodeType = EngineeringDependencyNodeType | 'engineering_state';
