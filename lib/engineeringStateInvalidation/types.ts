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
  snapshotReference?: EngineeringStateSnapshotReference;
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
  snapshotReference?: EngineeringStateSnapshotReference;
  deterministicNotes: string[];
}

export type EngineeringStateAuditGuardCode =
  | 'rendering_from_stale_dependencies_blocked'
  | 'regeneration_requires_provenance_lineage'
  | 'regeneration_from_raw_uploads_blocked'
  | 'document_sections_not_orphaned'
  | 'decision_outputs_have_invalidation_tracking'
  | 'dependency_propagation_not_hidden'
  | 'persistence_requires_provenance'
  | 'invalidation_requires_lineage'
  | 'regeneration_plan_requires_dependency_hash'
  | 'snapshot_hash_not_drifted'
  | 'persistence_ordering_deterministic'
  | 'persistent_graph_nodes_not_orphaned';

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
  snapshotReference?: EngineeringStateSnapshotReference | null;
}

export type StateAwareDependencyNodeMetadata = {
  stateIds: string[];
  staleStatus: EngineeringStaleStatus;
  generationHash: string;
  dependencyHash: string;
  invalidationReason?: string;
};

export type StateRegistryNodeType = EngineeringDependencyNodeType | 'engineering_state';

export interface EngineeringStateHashVector {
  dependencyGraphHash: string;
  provenanceHash: string;
  generationHash: string;
  invalidationHash: string;
  renderHash: string;
  decisionHash: string;
  requirementHash: string;
}

export interface EngineeringStateSnapshotReference {
  snapshotId: string;
  snapshotHash: string;
  stateGraphId: string;
  dependencyGraphHash: string;
  provenanceHash: string;
  generationHash: string;
  invalidationHash: string;
  deterministicNotes: string[];
}

export type PersistentEngineeringStateNodeKind = 'state_record' | 'dependency_graph_node';
export type PersistentEngineeringStateEdgeType = 'depends_on_dependency_node' | 'invalidates_state' | 'preserves_stale_state' | 'supersedes_snapshot';

export interface PersistentEngineeringStateGraphNode {
  nodeId: string;
  nodeKind: PersistentEngineeringStateNodeKind;
  stateId?: string;
  dependencyNodeId?: string;
  stateType?: EngineeringStateType;
  staleStatus?: EngineeringStaleStatus;
  requirementIds: EngineeringRequirementId[];
  decisionIds: string[];
  canonicalEvidenceIds: string[];
  dependencyNodeIds: string[];
  generationHash?: string;
  provenanceHash?: string;
  dependencyHash?: string;
  truthSource: DocumentTruthSource;
  deterministicNotes: string[];
}

export interface PersistentEngineeringStateGraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: PersistentEngineeringStateEdgeType;
  deterministicReason: string;
}

export interface PersistentEngineeringStateGraph {
  graphId: string;
  generatedAt: string;
  registryId: string;
  dependencyGraphId?: string;
  nodes: PersistentEngineeringStateGraphNode[];
  edges: PersistentEngineeringStateGraphEdge[];
  stateNodeIds: string[];
  dependencyNodeIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface EngineeringStateSnapshotStateRef {
  stateId: string;
  stateType: EngineeringStateType;
  staleStatus: EngineeringStaleStatus;
  generationHash: string;
  provenanceHash: string;
  dependencyHash: string;
  requirementIds: EngineeringRequirementId[];
  decisionIds: string[];
  canonicalEvidenceIds: string[];
  dependencyNodeIds: string[];
}

export interface EngineeringStateSnapshot {
  snapshotId: string;
  generatedAt: string;
  registryId: string;
  stateGraphId: string;
  previousSnapshotId?: string;
  previousSnapshotHash?: string;
  supersededBySnapshotId?: string;
  hashVector: EngineeringStateHashVector;
  stateRefs: EngineeringStateSnapshotStateRef[];
  staleStateIds: string[];
  validStateIds: string[];
  transitionEventIds: string[];
  snapshotHash: string;
  deterministicNotes: string[];
}

export type EngineeringStateDiffType = 'added' | 'removed' | 'unchanged' | 'hash_changed' | 'stale_status_changed' | 'lineage_changed';

export interface EngineeringStateDiffEntry {
  diffId: string;
  stateId: string;
  diffType: EngineeringStateDiffType;
  previousStatus?: EngineeringStaleStatus;
  nextStatus?: EngineeringStaleStatus;
  changedHashFields: Array<keyof Pick<EngineeringStateSnapshotStateRef, 'generationHash' | 'provenanceHash' | 'dependencyHash'>>;
  lineageChangedFields: Array<'requirementIds' | 'decisionIds' | 'canonicalEvidenceIds' | 'dependencyNodeIds'>;
  deterministicReason: string;
}

export interface EngineeringStateSnapshotDiff {
  diffId: string;
  previousSnapshotId: string;
  nextSnapshotId: string;
  previousSnapshotHash: string;
  nextSnapshotHash: string;
  hashVectorChanges: Array<keyof EngineeringStateHashVector>;
  entries: EngineeringStateDiffEntry[];
  addedStateIds: string[];
  removedStateIds: string[];
  staleStateIds: string[];
  preservedStateIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export type EngineeringStateTransitionEventType =
  | 'snapshot_created'
  | 'snapshot_superseded'
  | 'state_invalidated'
  | 'state_regenerated'
  | 'dependency_changed'
  | 'requirement_changed'
  | 'decision_changed'
  | 'render_context_changed'
  | 'stale_state_preserved';

export interface EngineeringStateTransitionEvent {
  transitionEventId: string;
  eventType: EngineeringStateTransitionEventType;
  occurredAt: string;
  snapshotId: string;
  previousSnapshotId?: string;
  stateIds: string[];
  dependencyNodeIds: string[];
  requirementIds: EngineeringRequirementId[];
  decisionIds: string[];
  canonicalEvidenceIds: string[];
  invalidationEventIds: string[];
  regenerationPlanId?: string;
  deterministicReason: string;
  deterministicHash: string;
}

export interface EngineeringStateTransitionHistory {
  historyId: string;
  generatedAt: string;
  snapshotIds: string[];
  transitionEvents: EngineeringStateTransitionEvent[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface EngineeringStateTimeline {
  timelineId: string;
  latestSnapshotId?: string;
  latestValidSnapshotId?: string;
  staleStateIds: string[];
  transitionEventIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface BuildPersistentEngineeringStateGraphInput {
  graphId: string;
  generatedAt?: string;
  registry: EngineeringStateRegistry;
  dependencyGraph?: EngineeringDependencyGraph | null;
  invalidationResult?: EngineeringInvalidationResult | null;
}

export interface BuildEngineeringStateSnapshotInput {
  snapshotId: string;
  generatedAt?: string;
  registry: EngineeringStateRegistry;
  stateGraph?: PersistentEngineeringStateGraph | null;
  dependencyGraph?: EngineeringDependencyGraph | null;
  decisionProvenance?: import('@/lib/engineeringDecisionProvenance').EngineeringDecisionEvaluationBundle | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  previousSnapshot?: EngineeringStateSnapshot | null;
}

export interface BuildEngineeringStateTransitionHistoryInput {
  historyId: string;
  generatedAt?: string;
  snapshots: EngineeringStateSnapshot[];
  diffs?: EngineeringStateSnapshotDiff[];
  invalidationResults?: EngineeringInvalidationResult[];
  regenerationPlans?: SelectiveRegenerationPlan[];
}
