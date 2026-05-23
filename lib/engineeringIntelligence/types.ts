import type {
  EngineeringRequirementDefinition,
  EngineeringRequirementId,
  EngineeringRequirementStatus,
} from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { CADReadinessFlag, CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { DeterministicPhotoGroupingModel } from '@/lib/engineeringIntelligence/photoGrouping';
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
  auditGuards?: EngineeringStateAuditGuardResult[] | null;
}
