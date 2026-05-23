import type {
  EngineeringRequirementDefinition,
  EngineeringRequirementId,
  EngineeringRequirementStatus,
} from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { CADReadinessFlag, CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { DeterministicPhotoGroupingModel } from '@/lib/engineeringIntelligence/photoGrouping';
import type { EngineeringInvalidationPropagationResult, EngineeringAffectedOutputImpact } from '@/lib/engineeringIntelligence/invalidationEngine';
import type { PropagationTraversalResult } from '@/lib/engineeringIntelligence/propagationGraph';
import type { EngineeringRegenerationPlanV1 } from '@/lib/engineeringIntelligence/regenerationPlanner';
import type { EngineeringSnapshotDeltaV1 } from '@/lib/engineeringIntelligence/snapshotDelta';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalSummary } from '@/lib/engineeringIntelligence/signalTypes';
import type { EngineeringContextResolutionSummary, EngineeringContextStatus, ResolvedEngineeringContext } from '@/lib/engineeringIntelligence/contextTypes';
import type {
  EngineeringDecisionDefinition,
  EngineeringDecisionType,
} from '@/lib/engineeringDecisionProvenance';
import type {
  EngineeringStateAuditGuardResult,
  EngineeringStateSnapshot,
  EngineeringStateSnapshotDiff,
  EngineeringStateTransitionHistory,
  EngineeringStateTimeline,
  EngineeringInvalidationResult,
  PersistentEngineeringStateGraph,
  SelectiveRegenerationPlan,
} from '@/lib/engineeringStateInvalidation';

export type EngineeringIntelligenceRouteId =
  | 'overview'
  | 'project'
  | 'snapshots'
  | 'graph';

export type EngineeringEvidenceWorkspaceGroupId =
  | 'utility'
  | 'electrical'
  | 'roof'
  | 'structural'
  | 'routing'
  | 'detached_structures'
  | 'ess'
  | 'trench_ground_mount';

export type EngineeringWorkspaceStatus =
  | 'satisfied'
  | 'partial'
  | 'blocked'
  | 'missing'
  | 'inactive'
  | 'current'
  | 'stale'
  | 'invalidated'
  | 'preserved'
  | 'unknown'
  | 'not_loaded';

export interface EngineeringIntelligenceRouteSummary {
  routeId: EngineeringIntelligenceRouteId;
  href: string;
  label: string;
  deterministicPurpose: string;
}

export interface EngineeringHealthDashboardModel {
  validOutputs: number;
  staleOutputs: number;
  invalidatedOutputs: number;
  blockedOutputs: number;
  regenerationCandidates: number;
  activeAuditGuardWarnings: number;
  snapshotVersions: number;
  dependencyGraphNodes: number;
  dependencyGraphEdges: number;
  evidenceCompleteness: 'canonical-manifest-required' | 'snapshot-linked' | 'not-loaded';
  requirementSatisfaction: 'registry-visible' | 'snapshot-linked' | 'not-loaded';
  deterministicNotes: string[];
}

export interface CanonicalEvidenceWorkspaceItemModel {
  canonicalEvidenceId: string;
  category: string;
  evidenceCategoryLabel: string;
  provenance: string[];
  originatingSurveyIds: string[];
  originatingSurveyCreatedAts: Array<string | null>;
  duplicateCollapseCount: number;
  canonicalRepresentativeStatus: 'canonical_representative' | 'snapshot_reference_only';
  canonicalSelectionReason: string;
  evidenceTruthSource: string;
  evidenceSource: string;
  evidenceConfidence: string;
  metadataCompleteness: Array<{ field: string; present: boolean }>;
  linkedRequirementIds: EngineeringRequirementId[];
  linkedDecisionIds: string[];
  linkedDocumentSectionIds: string[];
  linkedOutputIds: string[];
  linkedGraphNodeIds: string[];
  linkedGraphEdgeIds: string[];
  linkedCADReadinessFlags: CADReadinessFlag[];
  readinessImpact: 'ready' | 'partial' | 'blocked' | 'not_applicable' | 'not_loaded';
  fieldQualitySignals: string[];
  staleStateImpactStateIds: string[];
  staleImpactReasons: string[];
  regenerationCandidateIds: string[];
  status: EngineeringWorkspaceStatus;
}

export interface CanonicalEvidenceWorkspaceGroupModel {
  groupId: EngineeringEvidenceWorkspaceGroupId;
  label: string;
  description: string;
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceItems: CanonicalEvidenceWorkspaceItemModel[];
  missingRequirementIds: EngineeringRequirementId[];
  fieldQualitySignals: string[];
  readinessFlags: CADReadinessFlag[];
  deterministicNotes: string[];
}

export interface RequirementWorkspaceItemModel {
  requirementId: EngineeringRequirementId;
  label: string;
  description: string;
  status: EngineeringRequirementStatus | 'not_loaded';
  active: boolean;
  linkedEvidenceIds: string[];
  linkedDecisionIds: string[];
  linkedDocumentSectionIds: string[];
  dependencyReferences: string[];
  staleImpactStateIds: string[];
  definition: EngineeringRequirementDefinition;
}

export interface DecisionWorkspaceItemModel {
  decisionType: EngineeringDecisionType;
  label: string;
  category: string;
  domain: string;
  governingRuleIds: string[];
  evidenceLineageIds: string[];
  dependencyLineageIds: string[];
  fallbackDefaultChain: string[];
  affectedOutputIds: string[];
  staleImpactStateIds: string[];
  definition: EngineeringDecisionDefinition;
}

export interface StaleInvalidationWorkspaceModel {
  staleOutputIds: string[];
  invalidationChains: Array<{
    eventId: string;
    stateId: string;
    reason: string;
    triggeringEvidenceIds: string[];
    triggeringDecisionIds: string[];
    triggeringRequirementIds: string[];
    downstreamStateIds: string[];
  }>;
  preservedOutputIds: string[];
  regenerationScopeIds: string[];
  deterministicNotes: string[];
}

export interface SnapshotTimelineWorkspaceModel {
  snapshots: EngineeringStateSnapshot[];
  latestSnapshotId: string | null;
  snapshotHashes: Array<{ snapshotId: string; snapshotHash: string }>;
  diffs: EngineeringStateSnapshotDiff[];
  timeline: EngineeringStateTimeline | null;
  transitionHistory: EngineeringStateTransitionHistory | null;
  deterministicNotes: string[];
}

export type EngineeringIntelligenceGraphNodeType =
  | 'evidence'
  | 'requirement'
  | 'decision'
  | 'render_context'
  | 'document_section'
  | 'stale_output'
  | 'regeneration_plan'
  | 'snapshot'
  | 'dependency';

export type EngineeringIntelligenceGraphEdgeType =
  | 'satisfies'
  | 'derived_from'
  | 'invalidates'
  | 'depends_on'
  | 'affects'
  | 'generated_by'
  | 'preserves';

export interface EngineeringIntelligenceGraphNodeModel {
  nodeId: string;
  label: string;
  nodeType: EngineeringIntelligenceGraphNodeType;
  status: EngineeringWorkspaceStatus;
  provenanceSummary: string;
}

export interface EngineeringIntelligenceGraphEdgeModel {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: EngineeringIntelligenceGraphEdgeType;
  deterministicReason: string;
}

export interface DependencyGraphViewerModel {
  nodes: EngineeringIntelligenceGraphNodeModel[];
  edges: EngineeringIntelligenceGraphEdgeModel[];
  sourceGraph: PersistentEngineeringStateGraph | null;
  deterministicNotes: string[];
}

export interface RegenerationPlanningWorkspaceModel {
  plans: SelectiveRegenerationPlan[];
  regenerationCandidates: string[];
  regenerationOrder: string[];
  blockedDependencies: string[];
  preservedOutputIds: string[];
  deterministicNotes: string[];
}

export interface InvalidationPropagationWorkspaceModel {
  propagation: EngineeringInvalidationPropagationResult | null;
  stalePropagationChains: string[];
  invalidationSources: string[];
  impactedOutputs: string[];
  impactedDocumentSections: string[];
  impactedRenderContexts: string[];
  impactedSnapshots: string[];
  dependencyTraversalPaths: string[];
  cycleProtectionIndicators: string[];
  deterministicNotes: string[];
}

export interface DependencyTraversalWorkspaceModel {
  traversal: PropagationTraversalResult | null;
  upstreamLineage: string[];
  downstreamLineage: string[];
  propagationDepths: string[];
  cycleProtectionIndicators: string[];
  missingNodeIds: string[];
  duplicateEdgeIdsSuppressed: string[];
  deterministicNotes: string[];
}

export interface RegenerationPlanningV1WorkspaceModel {
  plan: EngineeringRegenerationPlanV1 | null;
  wouldRegenerate: string[];
  whyRegenerate: string[];
  upstreamTriggers: string[];
  impactedOutputs: string[];
  missingEvidence: string[];
  dependencyChains: string[];
  deterministicNotes: string[];
}

export interface SnapshotDeltaWorkspaceModel {
  delta: EngineeringSnapshotDeltaV1 | null;
  addedEvidence: string[];
  removedEvidence: string[];
  changedDecisions: string[];
  staleOutputsIntroduced: string[];
  regeneratedCandidates: string[];
  invalidationCauses: string[];
  changedCADReadiness: string[];
  dependencyGraphDelta: string[];
  deterministicNotes: string[];
}

export interface AffectedOutputsWorkspaceModel {
  outputs: EngineeringAffectedOutputImpact[];
  documentSections: string[];
  renderContexts: string[];
  snapshots: string[];
  decisions: string[];
  reviewRequired: string[];
  deterministicNotes: string[];
}

export interface StaleStateTimelineWorkspaceModel {
  events: Array<{
    eventId: string;
    stateIds: string[];
    staleClass: string;
    snapshotId: string;
    dependencyNodeIds: string[];
    requirementIds: string[];
    decisionIds: string[];
    canonicalEvidenceIds: string[];
    deterministicReason: string;
  }>;
  staleStateIds: string[];
  transitionEventIds: string[];
  deterministicNotes: string[];
}


export interface StructuredEngineeringSignalsWorkspaceModel {
  summary: StructuredEngineeringSignalSummary | null;
  signals: StructuredEngineeringSignal[];
  satisfied: string[];
  partial: string[];
  blocked: string[];
  missing: string[];
  notApplicable: string[];
  deterministicNotes: string[];
}

export interface SignalProvenanceWorkspaceModel {
  chains: Array<{
    signalId: string;
    sourceEvidenceIds: string[];
    sourceSurveyIds: string[];
    derivedFrom: string[];
    dependencyNodes: string[];
    deterministicHash: string;
  }>;
  deterministicNotes: string[];
}

export interface SignalDependencyGraphWorkspaceModel {
  nodes: StructuredEngineeringSignalSummary['dependencyGraph']['nodes'];
  edges: StructuredEngineeringSignalSummary['dependencyGraph']['edges'];
  deterministicNotes: string[];
}

export interface SignalRequirementMappingWorkspaceModel {
  mappings: NonNullable<StructuredEngineeringSignalSummary>['requirementMappings'];
  deterministicNotes: string[];
}

export interface SignalConfidenceWorkspaceModel {
  confidenceBreakdown: Array<{ signalId: string; status: string; score: number; band: string; factors: string[] }>;
  deterministicNotes: string[];
}

export interface SignalBlockingWorkspaceModel {
  blockingReasons: Array<{ signalId: string; status: string; blockingReasons: string[]; partialReasons: string[] }>;
  deterministicNotes: string[];
}

export interface SignalInvalidationWorkspaceModel {
  invalidations: Array<{ signalId: string; invalidatedBy: string[]; staleImpacts: string[] }>;
  deterministicNotes: string[];
}

export interface SignalStaleImpactsWorkspaceModel {
  staleImpacts: StructuredEngineeringSignalSummary['staleImpacts'];
  fallbackParticipation: StructuredEngineeringSignalSummary['fallbackParticipation'];
  deterministicNotes: string[];
}


export interface ResolvedEngineeringContextsWorkspaceModel {
  summary: EngineeringContextResolutionSummary | null;
  contexts: ResolvedEngineeringContext[];
  authoritative: string[];
  preferred: string[];
  partial: string[];
  conflicting: string[];
  blocked: string[];
  unresolved: string[];
  notApplicable: string[];
  deterministicNotes: string[];
}

export interface ContextArbitrationWorkspaceModel {
  rankings: Array<{ contextId: string; contextType: string; domain: string; status: EngineeringContextStatus; score: number; rank: number; rankingReason: string; sourceSignalIds: string[]; supportingSignalIds: string[] }>;
  deterministicNotes: string[];
}

export interface ContextConflictInspectorWorkspaceModel {
  conflicts: NonNullable<EngineeringContextResolutionSummary>['conflicts'];
  conflictingContextIds: string[];
  competingSignalIds: string[];
  deterministicNotes: string[];
}

export interface FallbackChainInspectorWorkspaceModel {
  fallbackParticipation: NonNullable<EngineeringContextResolutionSummary>['fallbackParticipation'];
  fallbackDependentContextIds: string[];
  fallbackConfidencePenalties: Array<{ contextId: string; penalties: string[] }>;
  deterministicNotes: string[];
}

export interface ContextProvenanceWorkspaceModel {
  chains: Array<{ contextId: string; sourceSignalIds: string[]; sourceEvidenceIds: string[]; sourceMetadataIds: string[]; dependencyLineage: string[]; invalidationLineage: string[]; deterministicHash: string }>;
  deterministicNotes: string[];
}

export interface ContextDependencyGraphWorkspaceModel {
  nodes: EngineeringContextResolutionSummary['dependencyGraph']['nodes'];
  edges: EngineeringContextResolutionSummary['dependencyGraph']['edges'];
  deterministicNotes: string[];
}

export interface ContextConfidenceBreakdownWorkspaceModel {
  confidenceBreakdown: Array<{ contextId: string; status: EngineeringContextStatus; score: number; band: string; rank: number; factors: string[]; penalties: string[] }>;
  deterministicNotes: string[];
}

export interface ContextInvalidationsWorkspaceModel {
  invalidations: Array<{ contextId: string; invalidationLineage: string[]; staleImpactPropagation: string[]; regenerationParticipation: string[] }>;
  deterministicNotes: string[];
}

export interface ContextStaleImpactsWorkspaceModel {
  staleImpacts: EngineeringContextResolutionSummary['staleImpacts'];
  cadReadinessMappings: EngineeringContextResolutionSummary['cadReadinessMappings'];
  deterministicNotes: string[];
}

export interface ContextResolutionTimelineWorkspaceModel {
  events: EngineeringContextResolutionSummary['timeline'];
  deterministicNotes: string[];
}

export interface AuditGuardWorkspaceModel {
  guards: EngineeringStateAuditGuardResult[];
  topologyViolations: EngineeringStateAuditGuardResult[];
  provenanceFailures: EngineeringStateAuditGuardResult[];
  orphanedNodeFailures: EngineeringStateAuditGuardResult[];
  staleLineageFailures: EngineeringStateAuditGuardResult[];
  invalidRenderContextFailures: EngineeringStateAuditGuardResult[];
  deterministicNotes: string[];
}

export interface EngineeringIntelligenceWorkspaceModel {
  projectId: string | null;
  generatedFrom: 'system-registries' | 'project-snapshot';
  routes: EngineeringIntelligenceRouteSummary[];
  health: EngineeringHealthDashboardModel;
  evidenceGroups: CanonicalEvidenceWorkspaceGroupModel[];
  photoGrouping: DeterministicPhotoGroupingModel;
  requirements: RequirementWorkspaceItemModel[];
  decisions: DecisionWorkspaceItemModel[];
  staleInvalidation: StaleInvalidationWorkspaceModel;
  snapshots: SnapshotTimelineWorkspaceModel;
  graph: DependencyGraphViewerModel;
  regenerationPlanning: RegenerationPlanningWorkspaceModel;
  invalidationPropagation: InvalidationPropagationWorkspaceModel;
  dependencyTraversal: DependencyTraversalWorkspaceModel;
  regenerationPlanningV1: RegenerationPlanningV1WorkspaceModel;
  snapshotDelta: SnapshotDeltaWorkspaceModel;
  affectedOutputs: AffectedOutputsWorkspaceModel;
  staleStateTimeline: StaleStateTimelineWorkspaceModel;
  structuredSignals: StructuredEngineeringSignalsWorkspaceModel;
  signalProvenance: SignalProvenanceWorkspaceModel;
  signalDependencyGraph: SignalDependencyGraphWorkspaceModel;
  signalRequirementMapping: SignalRequirementMappingWorkspaceModel;
  signalConfidence: SignalConfidenceWorkspaceModel;
  signalBlocking: SignalBlockingWorkspaceModel;
  signalInvalidations: SignalInvalidationWorkspaceModel;
  signalStaleImpacts: SignalStaleImpactsWorkspaceModel;
  resolvedContexts: ResolvedEngineeringContextsWorkspaceModel;
  contextArbitration: ContextArbitrationWorkspaceModel;
  contextConflictInspector: ContextConflictInspectorWorkspaceModel;
  fallbackChainInspector: FallbackChainInspectorWorkspaceModel;
  contextProvenance: ContextProvenanceWorkspaceModel;
  contextDependencyGraph: ContextDependencyGraphWorkspaceModel;
  contextConfidenceBreakdown: ContextConfidenceBreakdownWorkspaceModel;
  contextInvalidations: ContextInvalidationsWorkspaceModel;
  contextStaleImpacts: ContextStaleImpactsWorkspaceModel;
  contextResolutionTimeline: ContextResolutionTimelineWorkspaceModel;
  auditGuards: AuditGuardWorkspaceModel;
  deterministicNotes: string[];
}

export interface BuildEngineeringIntelligenceWorkspaceInput {
  projectId?: string | null;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  cadReadiness?: CADReadinessMetadataModel | null;
  photoGrouping?: DeterministicPhotoGroupingModel | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  snapshots?: EngineeringStateSnapshot[] | null;
  snapshotDiffs?: EngineeringStateSnapshotDiff[] | null;
  transitionHistory?: EngineeringStateTransitionHistory | null;
  timeline?: EngineeringStateTimeline | null;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  regenerationPlans?: SelectiveRegenerationPlan[] | null;
  invalidationPropagation?: EngineeringInvalidationPropagationResult | null;
  regenerationPlanV1?: EngineeringRegenerationPlanV1 | null;
  snapshotDelta?: EngineeringSnapshotDeltaV1 | null;
  structuredSignals?: StructuredEngineeringSignalSummary | null;
  contextResolution?: EngineeringContextResolutionSummary | null;
  auditGuards?: EngineeringStateAuditGuardResult[] | null;
}
