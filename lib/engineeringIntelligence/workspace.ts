import {
  ENGINEERING_REQUIREMENT_DEFINITIONS,
  type EngineeringRequirementDefinition,
  type EngineeringRequirementEvaluation,
  type EngineeringRequirementId,
} from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import type { CanonicalEvidenceProvenanceRecord } from '@/lib/survey/evidence/provenance';
import type { CADReadinessFlag } from './cadReadiness';
import { buildDeterministicPhotoGrouping } from './photoGrouping';
import {
  listEngineeringDecisionDefinitions,
  type EngineeringDecisionDefinition,
} from '@/lib/engineeringDecisionProvenance';
import {
  latestValidStateSnapshot,
  listStaleEngineeringOutputs,
  type EngineeringInvalidationEvent,
  type EngineeringStateAuditGuardResult,
  type EngineeringStateSnapshot,
  type EngineeringStateSnapshotStateRef,
  type PersistentEngineeringStateGraphNode,
  type SelectiveRegenerationPlan,
} from '@/lib/engineeringStateInvalidation';
import type {
  AuditGuardWorkspaceModel,
  BuildEngineeringIntelligenceWorkspaceInput,
  CanonicalEvidenceWorkspaceGroupModel,
  CanonicalEvidenceWorkspaceItemModel,
  DecisionWorkspaceItemModel,
  AffectedOutputsWorkspaceModel,
  DependencyGraphViewerModel,
  DependencyTraversalWorkspaceModel,
  EngineeringEvidenceWorkspaceGroupId,
  EngineeringHealthDashboardModel,
  EngineeringIntelligenceGraphEdgeModel,
  EngineeringIntelligenceGraphNodeModel,
  EngineeringIntelligenceRouteSummary,
  EngineeringIntelligenceWorkspaceModel,
  InvalidationPropagationWorkspaceModel,
  RegenerationPlanningV1WorkspaceModel,
  RegenerationPlanningWorkspaceModel,
  RequirementWorkspaceItemModel,
  SnapshotDeltaWorkspaceModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
  StaleStateTimelineWorkspaceModel,
  StructuredEngineeringSignalsWorkspaceModel,
  SignalProvenanceWorkspaceModel,
  SignalDependencyGraphWorkspaceModel,
  SignalRequirementMappingWorkspaceModel,
  SignalConfidenceWorkspaceModel,
  SignalBlockingWorkspaceModel,
  SignalInvalidationWorkspaceModel,
  SignalStaleImpactsWorkspaceModel,
  ResolvedEngineeringContextsWorkspaceModel,
  ContextArbitrationWorkspaceModel,
  ContextConflictInspectorWorkspaceModel,
  FallbackChainInspectorWorkspaceModel,
  ContextProvenanceWorkspaceModel,
  ContextDependencyGraphWorkspaceModel,
  ContextConfidenceBreakdownWorkspaceModel,
  ContextInvalidationsWorkspaceModel,
  ContextStaleImpactsWorkspaceModel,
  ContextResolutionTimelineWorkspaceModel,
} from './types';

const sortText = <T extends string>(values: T[]): T[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const sortBy = <T>(values: T[], selector: (value: T) => string): T[] => [...values].sort((a, b) => selector(a).localeCompare(selector(b)));

const ROUTES: EngineeringIntelligenceRouteSummary[] = [
  {
    routeId: 'overview',
    href: '/admin/engineering-intelligence',
    label: 'Engineering Intelligence',
    deterministicPurpose: 'System-level engineering-state dashboard and deterministic workspace entry point.',
  },
  {
    routeId: 'project',
    href: '/admin/engineering-intelligence/project/[id]',
    label: 'Project Intelligence',
    deterministicPurpose: 'Project-bound evidence, requirement, decision, invalidation, and regeneration-planning view.',
  },
  {
    routeId: 'snapshots',
    href: '/admin/engineering-intelligence/snapshots',
    label: 'Snapshot Timeline',
    deterministicPurpose: 'Persistent engineering state snapshots, hashes, diffs, and transition timeline.',
  },
  {
    routeId: 'graph',
    href: '/admin/engineering-intelligence/graph',
    label: 'Dependency Graph',
    deterministicPurpose: 'Queryable deterministic graph nodes and edges across evidence, requirements, decisions, outputs, and plans.',
  },
];

const EVIDENCE_GROUPS: Array<{
  groupId: EngineeringEvidenceWorkspaceGroupId;
  label: string;
  description: string;
  requirementIds: EngineeringRequirementId[];
  categories: SurveyEvidenceCategory[];
  readinessFlagIds: string[];
}> = [
  {
    groupId: 'utility',
    label: 'Utility',
    description: 'Meter, utility bill, utility access, and interconnection evidence required by deterministic registry rules.',
    requirementIds: ['utility_meter', 'utility_bill'],
    categories: ['meter', 'utility_access', 'utility_connection'],
    readinessFlagIds: ['routing-ready'],
  },
  {
    groupId: 'electrical',
    label: 'Electrical',
    description: 'Main service equipment, disconnects, subpanels, grounding, rapid shutdown, placards, and service labeling.',
    requirementIds: ['main_service_panel', 'subpanel', 'main_disconnect', 'rapid_shutdown', 'placards', 'service_equipment_label'],
    categories: ['main_service_panel', 'subpanel', 'disconnect', 'grounding', 'utility_connection', 'inverter_location', 'gateway_location', 'garage_interior_wall'],
    readinessFlagIds: ['routing-ready'],
  },
  {
    groupId: 'roof',
    label: 'Roof',
    description: 'Roof plane, edge, ridge, surface, and obstruction evidence used for roof-layout traceability.',
    requirementIds: ['roof_overview'],
    categories: ['roof_plane', 'roof_edge', 'ridge', 'roof_surface', 'obstructions', 'overview'],
    readinessFlagIds: ['roof-plane-ready', 'setback-ready'],
  },
  {
    groupId: 'structural',
    label: 'Structural',
    description: 'Attic, structural access, framing-context, and review-supporting canonical evidence.',
    requirementIds: ['attic_access', 'structural_access'],
    categories: ['attic', 'attic_access', 'rafters'],
    readinessFlagIds: ['roof-plane-ready'],
  },
  {
    groupId: 'routing',
    label: 'Routing',
    description: 'Conduit, grounding, service access, and path context that affects routed engineering outputs.',
    requirementIds: ['main_service_panel', 'utility_meter', 'main_disconnect'],
    categories: ['utility_connection', 'utility_access', 'disconnect', 'grounding', 'inverter_location', 'garage_interior_wall'],
    readinessFlagIds: ['routing-ready'],
  },
  {
    groupId: 'detached_structures',
    label: 'Detached Structures',
    description: 'Detached-structure evidence group reserved for explicit canonical evidence and future requirement expansion.',
    requirementIds: [],
    categories: ['detached_structures'],
    readinessFlagIds: ['detached-structure-ready'],
  },
  {
    groupId: 'ess',
    label: 'ESS',
    description: 'Battery location and energy-storage assumptions, surfaced only through explicit deterministic requirements/decisions.',
    requirementIds: ['battery_location'],
    categories: ['battery_location', 'gateway_location'],
    readinessFlagIds: ['routing-ready'],
  },
  {
    groupId: 'trench_ground_mount',
    label: 'Trench / Ground Mount',
    description: 'Trenching, ground-mount, and route-specific evidence group reserved for canonical evidence and dependency lineage.',
    requirementIds: [],
    categories: ['trench_path'],
    readinessFlagIds: ['trench-route-ready'],
  },
];

function stateRefs(snapshot: EngineeringStateSnapshot | null) {
  return snapshot?.stateRefs ?? [];
}

function buildHealth(input: BuildEngineeringIntelligenceWorkspaceInput, latestSnapshot: EngineeringStateSnapshot | null): EngineeringHealthDashboardModel {
  const refs = stateRefs(latestSnapshot);
  const staleOutputs = latestSnapshot ? listStaleEngineeringOutputs(latestSnapshot).length : 0;
  const blockedOutputs = refs.filter(ref => ref.staleStatus === 'blocked').length;
  const validOutputs = latestSnapshot?.validStateIds.length ?? 0;
  const invalidatedOutputs = input.transitionHistory?.transitionEvents.filter(event => event.eventType === 'state_invalidated').length ?? 0;
  const regenerationCandidates = (input.regenerationPlans ?? []).reduce((count, plan) => count + plan.staleStateIds.length, 0);
  const warningGuards = (input.auditGuards ?? []).filter(guard => !guard.passed || guard.severity === 'warning').length;

  return {
    validOutputs,
    staleOutputs,
    invalidatedOutputs,
    blockedOutputs,
    regenerationCandidates,
    activeAuditGuardWarnings: warningGuards,
    snapshotVersions: input.snapshots?.length ?? 0,
    dependencyGraphNodes: input.persistentGraph?.nodes.length ?? 0,
    dependencyGraphEdges: input.persistentGraph?.edges.length ?? 0,
    evidenceCompleteness: latestSnapshot ? 'snapshot-linked' : 'canonical-manifest-required',
    requirementSatisfaction: latestSnapshot ? 'snapshot-linked' : 'registry-visible',
    deterministicNotes: [
      latestSnapshot
        ? `Health counts derived from latest engineering state snapshot ${latestSnapshot.snapshotId}.`
        : 'No project snapshot was supplied; health dashboard shows registry/empty-state counts only.',
      'Raw uploads, raw survey arrays, and photo counts are not used as engineering truth.',
    ],
  };
}

function buildEvidenceGroups(input: BuildEngineeringIntelligenceWorkspaceInput, latestSnapshot: EngineeringStateSnapshot | null): CanonicalEvidenceWorkspaceGroupModel[] {
  const refs = stateRefs(latestSnapshot);
  const surveyEvidence = input.surveyEvidence ?? null;
  const canonicalRecords = surveyEvidence?.traceability.canonicalEvidence ?? [];
  const requirementEvaluations = surveyEvidence?.requirementEvaluation.allRequirements ?? [];
  const graph = input.persistentGraph ?? null;
  const invalidationEvents = input.invalidationResult?.invalidationEvents ?? [];
  const plans = input.regenerationPlans ?? [];
  const readinessFlags = input.cadReadiness?.flags ?? [];

  return EVIDENCE_GROUPS.map(group => {
    const groupRequirements = requirementEvaluations.filter(requirement => group.requirementIds.includes(requirement.requirementId));
    const missingRequirementIds = sortText(groupRequirements.filter(requirement => requirement.missing || requirement.insufficientMetadata).map(requirement => requirement.requirementId));
    const recordsForGroup = canonicalRecords.filter(record => group.categories.includes(record.evidenceCategory));
    const linkedStateRefs = refs.filter(ref =>
      ref.canonicalEvidenceIds.some(evidenceId => recordsForGroup.some(record => record.canonicalEvidenceId === evidenceId)),
    );
    const snapshotOnlyIds = canonicalRecords.length === 0
      ? sortText(refs
        .filter(ref => ref.requirementIds.some(requirementId => group.requirementIds.includes(requirementId)))
        .flatMap(ref => ref.canonicalEvidenceIds))
      : [];
    const canonicalEvidenceItems = [
      ...recordsForGroup.map(record => buildCanonicalEvidenceRow({
        record,
        status: 'canonical_representative',
        refs,
        graph,
        requirementEvaluations,
        invalidationEvents,
        plans,
        readinessFlags,
      })),
      ...snapshotOnlyIds.map(canonicalEvidenceId => buildSnapshotOnlyEvidenceRow({
        canonicalEvidenceId,
        groupLabel: group.label,
        refs,
        graph,
        invalidationEvents,
        plans,
        readinessFlags: readinessFlags.filter(flag => group.readinessFlagIds.includes(flag.flagId)),
      })),
    ].sort((a, b) => a.canonicalEvidenceId.localeCompare(b.canonicalEvidenceId));
    const groupReadinessFlags = readinessFlags.filter(flag => group.readinessFlagIds.includes(flag.flagId));
    const fieldQualitySignals = buildGroupFieldQualitySignals(group.groupId, groupRequirements, groupReadinessFlags, canonicalEvidenceItems.length, surveyEvidence);

    return {
      ...group,
      canonicalEvidenceItems,
      missingRequirementIds,
      fieldQualitySignals,
      readinessFlags: groupReadinessFlags,
      deterministicNotes: [
        canonicalEvidenceItems.length > 0
          ? 'Evidence rows are hydrated from canonical evidence provenance records and linked snapshot/graph state references.'
          : 'No canonical evidence rows are loaded for this group; missing or partial state is shown explicitly rather than fabricated.',
        recordsForGroup.length > 0
          ? 'Survey origin, duplicate collapse, and canonical selection reason are sourced from the canonical evidence traceability bundle.'
          : 'No canonical traceability records matched this group category set.',
        'CAD readiness, stale impact, and graph linkage are metadata visualizations only and do not trigger CAD or regeneration.',
      ],
    } satisfies CanonicalEvidenceWorkspaceGroupModel;
  });
}

function buildCanonicalEvidenceRow(input: {
  record: CanonicalEvidenceProvenanceRecord;
  status: 'canonical_representative';
  refs: EngineeringStateSnapshotStateRef[];
  graph: BuildEngineeringIntelligenceWorkspaceInput['persistentGraph'];
  requirementEvaluations: EngineeringRequirementEvaluation[];
  invalidationEvents: EngineeringInvalidationEvent[];
  plans: SelectiveRegenerationPlan[];
  readinessFlags: CADReadinessFlag[];
}): CanonicalEvidenceWorkspaceItemModel {
  const linkedRefs = input.refs.filter(ref => ref.canonicalEvidenceIds.includes(input.record.canonicalEvidenceId));
  const linkedRequirements = input.requirementEvaluations.filter(requirement => requirement.canonicalEvidenceIds.includes(input.record.canonicalEvidenceId));
  const graphNodes = input.graph?.nodes.filter(node => node.canonicalEvidenceIds.includes(input.record.canonicalEvidenceId)) ?? [];
  const graphNodeIds = graphNodes.map(node => node.nodeId);
  const graphEdges = input.graph?.edges.filter(edge => graphNodeIds.includes(edge.fromNodeId) || graphNodeIds.includes(edge.toNodeId)) ?? [];
  const invalidationEvents = input.invalidationEvents.filter(event => event.triggeringCanonicalEvidenceIds.includes(input.record.canonicalEvidenceId));
  const staleStateImpactStateIds = sortText([...linkedRefs.filter(ref => ref.staleStatus !== 'current').map(ref => ref.stateId), ...invalidationEvents.map(event => event.stateId)]);
  const readinessFlags = input.readinessFlags.filter(flag => flag.satisfiedCategories.includes(input.record.evidenceCategory));
  const linkedOutputIds = sortText([...linkedRefs.map(ref => ref.stateId), ...graphNodes.flatMap(node => node.stateId ? [node.stateId] : [])]);
  const linkedDecisionIds = sortText([...linkedRefs.flatMap(ref => ref.decisionIds), ...graphNodes.flatMap(node => node.decisionIds)]);

  return {
    canonicalEvidenceId: input.record.canonicalEvidenceId,
    category: input.record.evidenceCategory,
    evidenceCategoryLabel: input.record.evidenceCategoryLabel,
    provenance: sortText([...linkedRefs.map(ref => ref.stateId), input.record.evidenceTruthSource]),
    originatingSurveyIds: [input.record.originatingSurveyId],
    originatingSurveyCreatedAts: [input.record.originatingSurveyCreatedAt],
    duplicateCollapseCount: input.record.duplicateGroupSize,
    canonicalRepresentativeStatus: input.status,
    canonicalSelectionReason: input.record.selectionReason,
    evidenceTruthSource: input.record.evidenceTruthSource,
    evidenceSource: input.record.evidenceSource,
    evidenceConfidence: input.record.evidenceConfidence,
    metadataCompleteness: metadataCompletenessEntries(input.record.metadataCompleteness),
    linkedRequirementIds: sortText([...linkedRequirements.map(requirement => requirement.requirementId), ...linkedRefs.flatMap(ref => ref.requirementIds)]),
    linkedDecisionIds,
    linkedDocumentSectionIds: sortText(linkedRequirements.flatMap(requirement => requirement.permitUsage)),
    linkedOutputIds,
    linkedGraphNodeIds: sortText(graphNodeIds),
    linkedGraphEdgeIds: sortText(graphEdges.map(edge => edge.edgeId)),
    linkedCADReadinessFlags: readinessFlags,
    readinessImpact: summarizeReadinessImpact(readinessFlags),
    fieldQualitySignals: buildEvidenceFieldQualitySignals(input.record, linkedRequirements, readinessFlags),
    staleStateImpactStateIds,
    staleImpactReasons: sortText(invalidationEvents.map(event => event.invalidationReason)),
    regenerationCandidateIds: sortText(input.plans.filter(plan => plan.staleStateIds.some(stateId => staleStateImpactStateIds.includes(stateId))).map(plan => plan.planId)),
    status: staleStateImpactStateIds.length ? 'stale' : linkedRefs.length || graphNodeIds.length ? 'current' : 'partial',
  };
}

function buildSnapshotOnlyEvidenceRow(input: {
  canonicalEvidenceId: string;
  groupLabel: string;
  refs: EngineeringStateSnapshotStateRef[];
  graph: BuildEngineeringIntelligenceWorkspaceInput['persistentGraph'];
  invalidationEvents: EngineeringInvalidationEvent[];
  plans: SelectiveRegenerationPlan[];
  readinessFlags: CADReadinessFlag[];
}): CanonicalEvidenceWorkspaceItemModel {
  const linkedRefs = input.refs.filter(ref => ref.canonicalEvidenceIds.includes(input.canonicalEvidenceId));
  const graphNodes = input.graph?.nodes.filter(node => node.canonicalEvidenceIds.includes(input.canonicalEvidenceId)) ?? [];
  const graphNodeIds = graphNodes.map(node => node.nodeId);
  const graphEdges = input.graph?.edges.filter(edge => graphNodeIds.includes(edge.fromNodeId) || graphNodeIds.includes(edge.toNodeId)) ?? [];
  const invalidationEvents = input.invalidationEvents.filter(event => event.triggeringCanonicalEvidenceIds.includes(input.canonicalEvidenceId));
  const staleStateImpactStateIds = sortText([...linkedRefs.filter(ref => ref.staleStatus !== 'current').map(ref => ref.stateId), ...invalidationEvents.map(event => event.stateId)]);
  return {
    canonicalEvidenceId: input.canonicalEvidenceId,
    category: input.groupLabel,
    evidenceCategoryLabel: input.groupLabel,
    provenance: sortText(linkedRefs.map(ref => ref.stateId)),
    originatingSurveyIds: [],
    originatingSurveyCreatedAts: [],
    duplicateCollapseCount: 0,
    canonicalRepresentativeStatus: 'snapshot_reference_only',
    canonicalSelectionReason: 'Snapshot referenced this canonical evidence id, but no canonical traceability record was supplied to this workspace context.',
    evidenceTruthSource: 'snapshot_state_reference',
    evidenceSource: 'derived',
    evidenceConfidence: 'unknown',
    metadataCompleteness: [],
    linkedRequirementIds: sortText(linkedRefs.flatMap(ref => ref.requirementIds)),
    linkedDecisionIds: sortText([...linkedRefs.flatMap(ref => ref.decisionIds), ...graphNodes.flatMap(node => node.decisionIds)]),
    linkedDocumentSectionIds: [],
    linkedOutputIds: sortText([...linkedRefs.map(ref => ref.stateId), ...graphNodes.flatMap(node => node.stateId ? [node.stateId] : [])]),
    linkedGraphNodeIds: sortText(graphNodeIds),
    linkedGraphEdgeIds: sortText(graphEdges.map(edge => edge.edgeId)),
    linkedCADReadinessFlags: input.readinessFlags,
    readinessImpact: summarizeReadinessImpact(input.readinessFlags),
    fieldQualitySignals: ['canonical traceability record unavailable for this snapshot-referenced evidence id'],
    staleStateImpactStateIds,
    staleImpactReasons: sortText(invalidationEvents.map(event => event.invalidationReason)),
    regenerationCandidateIds: sortText(input.plans.filter(plan => plan.staleStateIds.some(stateId => staleStateImpactStateIds.includes(stateId))).map(plan => plan.planId)),
    status: staleStateImpactStateIds.length ? 'stale' : 'current',
  };
}

function metadataCompletenessEntries(completeness: CanonicalEvidenceProvenanceRecord['metadataCompleteness']) {
  return Object.entries(completeness).map(([field, present]) => ({ field, present })).sort((a, b) => a.field.localeCompare(b.field));
}

function summarizeReadinessImpact(flags: CADReadinessFlag[]): CanonicalEvidenceWorkspaceItemModel['readinessImpact'] {
  if (!flags.length) return 'not_loaded';
  if (flags.some(flag => flag.status === 'ready')) return 'ready';
  if (flags.some(flag => flag.status === 'partial')) return 'partial';
  if (flags.some(flag => flag.status === 'blocked')) return 'blocked';
  return 'not_applicable';
}

function buildEvidenceFieldQualitySignals(
  record: CanonicalEvidenceProvenanceRecord,
  requirements: EngineeringRequirementEvaluation[],
  readinessFlags: CADReadinessFlag[],
): string[] {
  const signals: string[] = [];
  if (!record.metadataCompleteness.hasCaptureTimestamp) signals.push('missing capture timestamp');
  if (!record.metadataCompleteness.hasSiteSurveyFileId) signals.push('missing site_survey_files linkage');
  if (!record.metadataCompleteness.hasSubmittedCategory) signals.push('missing submitted field category');
  if (record.duplicateGroupSize > 1) signals.push(`duplicate collapse group size ${record.duplicateGroupSize}`);
  for (const requirement of requirements) {
    if (requirement.insufficientMetadata) signals.push(`${requirement.requirementId} has insufficient metadata`);
    if (requirement.partiallySatisfied) signals.push(`${requirement.requirementId} is partially satisfied`);
  }
  for (const flag of readinessFlags) {
    if (flag.status !== 'ready') signals.push(`${flag.flagId} readiness ${flag.status}`);
  }
  return sortText(signals);
}

function buildGroupFieldQualitySignals(
  groupId: EngineeringEvidenceWorkspaceGroupId,
  requirements: EngineeringRequirementEvaluation[],
  readinessFlags: CADReadinessFlag[],
  evidenceCount: number,
  surveyEvidence: EngineeringSurveyEvidence | null,
): string[] {
  const signals: string[] = [];
  if (evidenceCount === 0) signals.push('no canonical evidence rows loaded for this group');
  for (const requirement of requirements) {
    if (requirement.missing) signals.push(`missing ${requirement.requirementId}`);
    if (requirement.insufficientMetadata) signals.push(`insufficient metadata for ${requirement.requirementId}`);
  }
  for (const flag of readinessFlags) {
    if (flag.status !== 'ready') signals.push(`${flag.flagId} readiness ${flag.status}: missing ${flag.missingCategories.join(', ') || 'none'}`);
  }
  if (groupId === 'electrical' && !surveyEvidence?.fieldEvidence.hasElectricalData) signals.push('insufficient electrical evidence');
  if (groupId === 'structural' && (!surveyEvidence?.fieldEvidence.hasStructuralData || evidenceCount === 0)) signals.push('no attic/framing evidence');
  if (groupId === 'routing' && (!surveyEvidence?.fieldEvidence.interconnectionPoint || evidenceCount === 0)) signals.push('incomplete routing evidence');
  if (groupId === 'trench_ground_mount') signals.push('no trench context unless explicit trench_path evidence is present');
  if (groupId === 'roof' && surveyEvidence?.completeness !== 'sufficient') signals.push('low roof/completeness context for full CAD readiness');
  return sortText(signals);
}

function buildPhotoGrouping(input: BuildEngineeringIntelligenceWorkspaceInput) {
  return input.photoGrouping ?? buildDeterministicPhotoGrouping({
    projectId: input.projectId,
    survey: null,
    canonicalManifest: null,
    readinessFlags: input.cadReadiness?.flags ?? [],
  });
}

function buildRequirements(latestSnapshot: EngineeringStateSnapshot | null): RequirementWorkspaceItemModel[] {
  const refs = stateRefs(latestSnapshot);
  return sortBy(ENGINEERING_REQUIREMENT_DEFINITIONS, req => req.requirementId).map((definition: EngineeringRequirementDefinition) => {
    const linkedRefs = refs.filter(ref => ref.requirementIds.includes(definition.requirementId));
    const staleRefs = linkedRefs.filter(ref => ref.staleStatus !== 'current');
    return {
      requirementId: definition.requirementId,
      label: definition.humanLabel,
      description: definition.description,
      status: latestSnapshot ? (linkedRefs.length > 0 ? 'satisfied' : definition.active ? 'missing' : 'inactive') : 'not_loaded',
      active: definition.active,
      linkedEvidenceIds: sortText(linkedRefs.flatMap(ref => ref.canonicalEvidenceIds)),
      linkedDecisionIds: sortText(linkedRefs.flatMap(ref => ref.decisionIds)),
      linkedDocumentSectionIds: [],
      dependencyReferences: sortText(linkedRefs.flatMap(ref => ref.dependencyNodeIds)),
      staleImpactStateIds: sortText(staleRefs.map(ref => ref.stateId)),
      definition,
    };
  });
}

function buildDecisions(latestSnapshot: EngineeringStateSnapshot | null): DecisionWorkspaceItemModel[] {
  const refs = stateRefs(latestSnapshot);
  return sortBy(listEngineeringDecisionDefinitions(), decision => decision.decisionType).map((definition: EngineeringDecisionDefinition) => {
    const linkedRefs = refs.filter(ref => ref.decisionIds.some(decisionId => decisionId.includes(definition.decisionType)));
    const fallbackDefaultChain = definition.missingInputBehavior === 'emit_explicit_default_decision'
      ? [`${definition.decisionType}:explicit_default_policy_v1`]
      : [];
    return {
      decisionType: definition.decisionType,
      label: definition.label,
      category: definition.decisionCategory,
      domain: definition.engineeringDomain,
      governingRuleIds: sortText(definition.governingRules.map(rule => rule.ruleId)),
      evidenceLineageIds: sortText(linkedRefs.flatMap(ref => ref.canonicalEvidenceIds)),
      dependencyLineageIds: sortText([...definition.engineeringDependencies, ...linkedRefs.flatMap(ref => ref.dependencyNodeIds)]),
      fallbackDefaultChain,
      affectedOutputIds: sortText([...definition.affectedDocumentSectionIds, ...linkedRefs.map(ref => ref.stateId)]),
      staleImpactStateIds: sortText(linkedRefs.filter(ref => ref.staleStatus !== 'current').map(ref => ref.stateId)),
      definition,
    };
  });
}

function buildStaleInvalidation(input: BuildEngineeringIntelligenceWorkspaceInput, latestSnapshot: EngineeringStateSnapshot | null): StaleInvalidationWorkspaceModel {
  const events = input.transitionHistory?.transitionEvents ?? [];
  const plans = input.regenerationPlans ?? [];
  return {
    staleOutputIds: latestSnapshot ? listStaleEngineeringOutputs(latestSnapshot) : [],
    invalidationChains: events
      .filter(event => event.eventType === 'state_invalidated')
      .map(event => ({
        eventId: event.transitionEventId,
        stateId: event.stateIds[0] ?? 'state-set',
        reason: event.deterministicReason,
        triggeringEvidenceIds: event.canonicalEvidenceIds,
        triggeringDecisionIds: event.decisionIds,
        triggeringRequirementIds: event.requirementIds,
        downstreamStateIds: event.stateIds,
      }))
      .sort((a, b) => a.eventId.localeCompare(b.eventId)),
    preservedOutputIds: sortText(plans.flatMap(plan => plan.unchangedPreservedOutputs)),
    regenerationScopeIds: sortText(plans.flatMap(plan => plan.staleStateIds)),
    deterministicNotes: [
      'Invalidation chains are shown only when transition history is supplied.',
      'Regeneration planning remains a deterministic plan visualization; no autonomous regeneration is triggered.',
    ],
  };
}

function buildSnapshots(input: BuildEngineeringIntelligenceWorkspaceInput, latestSnapshot: EngineeringStateSnapshot | null): SnapshotTimelineWorkspaceModel {
  const snapshots = sortBy(input.snapshots ?? [], snapshot => snapshot.snapshotId);
  return {
    snapshots,
    latestSnapshotId: latestSnapshot?.snapshotId ?? null,
    snapshotHashes: snapshots.map(snapshot => ({ snapshotId: snapshot.snapshotId, snapshotHash: snapshot.snapshotHash })),
    diffs: sortBy(input.snapshotDiffs ?? [], diff => diff.diffId),
    timeline: input.timeline ?? null,
    transitionHistory: input.transitionHistory ?? null,
    deterministicNotes: [
      snapshots.length > 0
        ? 'Snapshot timeline is derived from persistent engineering state snapshots and deterministic snapshot hashes.'
        : 'No persisted snapshots were supplied to this workspace context.',
      'Snapshot hashes are displayed as existing durable metadata and are not recomputed client-side.',
    ],
  };
}

function graphNodeStatus(node: PersistentEngineeringStateGraphNode): EngineeringIntelligenceGraphNodeModel['status'] {
  if (node.nodeKind === 'state_record') return node.staleStatus === 'current' ? 'current' : node.staleStatus;
  return 'current';
}

function buildGraph(input: BuildEngineeringIntelligenceWorkspaceInput, latestSnapshot: EngineeringStateSnapshot | null): DependencyGraphViewerModel {
  const graph = input.persistentGraph ?? null;
  const registryNodes: EngineeringIntelligenceGraphNodeModel[] = [
    ...ENGINEERING_REQUIREMENT_DEFINITIONS.map(requirement => ({
      nodeId: `requirement:${requirement.requirementId}`,
      label: requirement.humanLabel,
      nodeType: 'requirement' as const,
      status: requirement.active ? 'not_loaded' as const : 'inactive' as const,
      provenanceSummary: 'Engineering Requirement Registry v1 definition.',
    })),
    ...listEngineeringDecisionDefinitions().map(decision => ({
      nodeId: `decision:${decision.decisionType}`,
      label: decision.label,
      nodeType: 'decision' as const,
      status: 'not_loaded' as const,
      provenanceSummary: 'Engineering Decision Registry deterministic definition.',
    })),
  ];

  const graphNodes: EngineeringIntelligenceGraphNodeModel[] = graph
    ? graph.nodes.map(node => ({
        nodeId: node.nodeId,
        label: node.stateId ?? node.dependencyNodeId ?? node.nodeId,
        nodeType: node.nodeKind === 'state_record' ? (node.staleStatus === 'current' ? 'document_section' : 'stale_output') : 'dependency',
        status: graphNodeStatus(node),
        provenanceSummary: node.deterministicNotes.join(' '),
      }))
    : [];

  const graphEdges: EngineeringIntelligenceGraphEdgeModel[] = graph
    ? graph.edges.map(edge => ({
        edgeId: edge.edgeId,
        sourceNodeId: edge.fromNodeId,
        targetNodeId: edge.toNodeId,
        edgeType:
          edge.edgeType === 'invalidates_state'
            ? 'invalidates'
            : edge.edgeType === 'preserves_stale_state'
              ? 'preserves'
              : edge.edgeType === 'supersedes_snapshot'
                ? 'generated_by'
                : 'depends_on',
        deterministicReason: edge.deterministicReason,
      }))
    : [];

  return {
    nodes: sortBy([...registryNodes, ...graphNodes], node => node.nodeId),
    edges: sortBy(graphEdges, edge => edge.edgeId),
    sourceGraph: graph,
    deterministicNotes: [
      graph
        ? `Graph viewer includes persistent graph ${graph.graphId}.`
        : 'Graph viewer is displaying registry nodes only because no persistent graph was supplied.',
      'Graph rendering is deterministic HTML/SVG layout; no semantic inference or image-byte inspection is performed.',
    ],
  };
}

function buildRegenerationPlanning(input: BuildEngineeringIntelligenceWorkspaceInput): RegenerationPlanningWorkspaceModel {
  const plans: SelectiveRegenerationPlan[] = sortBy(input.regenerationPlans ?? [], plan => plan.planId);
  return {
    plans,
    regenerationCandidates: sortText(plans.flatMap(plan => plan.staleStateIds)),
    regenerationOrder: sortText(plans.flatMap(plan => plan.regenerationOrder)),
    blockedDependencies: sortText(plans.flatMap(plan => plan.blockedRegenerationDependencies)),
    preservedOutputIds: sortText(plans.flatMap(plan => plan.unchangedPreservedOutputs)),
    deterministicNotes: [
      plans.length > 0
        ? 'Regeneration planning rows are derived from persisted selective regeneration plans.'
        : 'No regeneration plans were supplied; this workspace does not initiate generation.',
      'The UI visualizes candidates, order, blockers, and preserved outputs only.',
    ],
  };
}

function buildInvalidationPropagationWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): InvalidationPropagationWorkspaceModel {
  const propagation = input.invalidationPropagation ?? null;
  return {
    propagation,
    stalePropagationChains: sortText(propagation?.propagationPaths.map(path => `${path.pathId}:depth=${path.depth}`) ?? []),
    invalidationSources: propagation?.sourceNodeIds ?? [],
    impactedOutputs: sortText(propagation?.affectedOutputs.map(output => output.outputId) ?? []),
    impactedDocumentSections: propagation?.affectedDocumentSectionIds ?? [],
    impactedRenderContexts: propagation?.affectedRenderContextIds ?? [],
    impactedSnapshots: propagation?.affectedSnapshotIds ?? [],
    dependencyTraversalPaths: sortText(propagation?.propagationPaths.map(path => path.nodeIds.join(' -> ')) ?? []),
    cycleProtectionIndicators: propagation ? [
      `cycleDetected:${propagation.cycleProtection.cycleDetected}`,
      `truncated:${propagation.cycleProtection.truncated}`,
      `maxDepth:${propagation.cycleProtection.maxDepth}`,
      `traversalLimit:${propagation.cycleProtection.traversalLimit}`,
    ] : ['not_loaded'],
    deterministicNotes: propagation?.deterministicNotes ?? ['No V1 invalidation propagation metadata was supplied.'],
  };
}

function buildDependencyTraversalWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): DependencyTraversalWorkspaceModel {
  const traversal = input.invalidationPropagation?.traversal ?? null;
  return {
    traversal,
    upstreamLineage: [],
    downstreamLineage: sortText(traversal?.paths.map(path => path.nodeIds.join(' -> ')) ?? []),
    propagationDepths: sortText(traversal?.paths.map(path => `${path.targetNodeId}:depth=${path.depth}`) ?? []),
    cycleProtectionIndicators: traversal ? [
      `cycleDetected:${traversal.cycleDetected}`,
      `truncated:${traversal.truncated}`,
      `maxDepth:${traversal.maxDepth}`,
      `traversalLimit:${traversal.traversalLimit}`,
    ] : ['not_loaded'],
    missingNodeIds: traversal?.missingNodeIds ?? [],
    duplicateEdgeIdsSuppressed: traversal?.duplicateEdgeIdsSuppressed ?? [],
    deterministicNotes: traversal?.deterministicNotes ?? ['No traversal result was supplied; dependency traversal remains explicit not_loaded metadata.'],
  };
}

function buildRegenerationPlanningV1Workspace(input: BuildEngineeringIntelligenceWorkspaceInput): RegenerationPlanningV1WorkspaceModel {
  const plan = input.regenerationPlanV1 ?? null;
  return {
    plan,
    wouldRegenerate: plan?.regenerationCandidateIds ?? [],
    whyRegenerate: sortText(plan?.planItems.map(item => `${item.affectedStateId}:${item.deterministicReason}`) ?? []),
    upstreamTriggers: plan?.triggerId ? [plan.triggerId] : [],
    impactedOutputs: sortText(plan?.planItems.map(item => item.affectedOutputId) ?? []),
    missingEvidence: plan?.missingEvidenceIds ?? [],
    dependencyChains: plan?.propagationPathIds ?? [],
    deterministicNotes: plan?.deterministicNotes ?? ['No Regeneration Planning V1 metadata was supplied; no regeneration is initiated.'],
  };
}

function buildSnapshotDeltaWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SnapshotDeltaWorkspaceModel {
  const delta = input.snapshotDelta ?? null;
  return {
    delta,
    addedEvidence: delta?.addedEvidenceIds ?? [],
    removedEvidence: delta?.removedEvidenceIds ?? [],
    changedDecisions: delta?.changedDecisionIds ?? [],
    staleOutputsIntroduced: delta?.staleOutputsIntroduced ?? [],
    regeneratedCandidates: delta?.regeneratedCandidateIds ?? [],
    invalidationCauses: delta?.invalidationCauseIds ?? [],
    changedCADReadiness: delta?.changedCADReadinessIds ?? [],
    dependencyGraphDelta: delta?.dependencyGraphDeltaIds ?? [],
    deterministicNotes: delta?.deterministicNotes ?? ['No Snapshot Delta V1 metadata was supplied.'],
  };
}

function buildAffectedOutputsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): AffectedOutputsWorkspaceModel {
  const outputs = input.invalidationPropagation?.affectedOutputs ?? [];
  return {
    outputs,
    documentSections: sortText(outputs.flatMap(output => output.affectedDocumentSectionIds)),
    renderContexts: sortText(outputs.flatMap(output => output.affectedRenderContextIds)),
    snapshots: sortText(outputs.flatMap(output => output.affectedSnapshotIds)),
    decisions: sortText(outputs.flatMap(output => output.invalidatedDecisionIds)),
    reviewRequired: sortText(outputs.filter(output => output.staleClass === 'BLOCKED' || output.staleClass === 'REQUIRES_REVIEW' || output.missingEvidenceIds.length > 0).map(output => output.stateId)),
    deterministicNotes: input.invalidationPropagation ? ['Affected outputs are derived from V1 propagation output only.'] : ['No affected-output propagation metadata was supplied.'],
  };
}

function buildStaleStateTimelineWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): StaleStateTimelineWorkspaceModel {
  const events = sortBy(input.transitionHistory?.transitionEvents ?? [], event => event.transitionEventId).map(event => ({
    eventId: event.transitionEventId,
    stateIds: event.stateIds,
    staleClass: event.eventType === 'state_invalidated' ? 'INVALIDATED' : event.eventType === 'stale_state_preserved' ? 'STALE' : 'VALID',
    snapshotId: event.snapshotId,
    dependencyNodeIds: event.dependencyNodeIds,
    requirementIds: event.requirementIds,
    decisionIds: event.decisionIds,
    canonicalEvidenceIds: event.canonicalEvidenceIds,
    deterministicReason: event.deterministicReason,
  }));
  return {
    events,
    staleStateIds: input.timeline?.staleStateIds ?? [],
    transitionEventIds: input.timeline?.transitionEventIds ?? [],
    deterministicNotes: [
      events.length ? 'Stale-state timeline is derived from transition history events.' : 'No transition history was supplied for stale-state timeline metadata.',
      'Timeline rendering is observational and does not regenerate stale outputs.',
    ],
  };
}

function includesAny(value: string, tokens: string[]) {
  return tokens.some(token => value.includes(token));
}


function buildStructuredSignalsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): StructuredEngineeringSignalsWorkspaceModel {
  const summary = input.structuredSignals ?? null;
  const signals = summary?.signals ?? [];
  return {
    summary,
    signals,
    satisfied: signals.filter(signal => signal.status === 'confirmed').map(signal => signal.id),
    partial: signals.filter(signal => signal.status === 'partial').map(signal => signal.id),
    blocked: signals.filter(signal => signal.status === 'blocked').map(signal => signal.id),
    missing: signals.filter(signal => signal.status === 'missing').map(signal => signal.id),
    notApplicable: signals.filter(signal => signal.status === 'not_applicable').map(signal => signal.id),
    deterministicNotes: summary?.deterministicNotes ?? ['No Structured Engineering Signals V1 model was supplied.'],
  };
}

function buildSignalProvenanceWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalProvenanceWorkspaceModel {
  const signals = input.structuredSignals?.signals ?? [];
  return {
    chains: signals.map(signal => ({
      signalId: signal.id,
      sourceEvidenceIds: signal.sourceEvidenceIds,
      sourceSurveyIds: signal.sourceSurveyIds,
      derivedFrom: signal.derivedFrom,
      dependencyNodes: signal.dependencyNodes,
      deterministicHash: signal.deterministicHash,
    })),
    deterministicNotes: signals.length ? ['Signal provenance chains are derived from signal source fields and deterministic hashes.'] : ['No signal provenance is available without a signal model.'],
  };
}

function buildSignalDependencyGraphWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalDependencyGraphWorkspaceModel {
  return {
    nodes: input.structuredSignals?.dependencyGraph.nodes ?? [],
    edges: input.structuredSignals?.dependencyGraph.edges ?? [],
    deterministicNotes: input.structuredSignals ? ['Signal dependency graph is generated from signal source/impact mappings.'] : ['No signal dependency graph was supplied.'],
  };
}

function buildSignalRequirementMappingWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalRequirementMappingWorkspaceModel {
  return {
    mappings: input.structuredSignals?.requirementMappings ?? [],
    deterministicNotes: input.structuredSignals ? ['Signal-to-requirement mappings are registry-defined and deterministic.'] : ['No signal-to-requirement mapping was supplied.'],
  };
}

function buildSignalConfidenceWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalConfidenceWorkspaceModel {
  const signals = input.structuredSignals?.signals ?? [];
  return {
    confidenceBreakdown: signals.map(signal => ({ signalId: signal.id, status: signal.status, score: signal.confidence.score, band: signal.confidence.band, factors: signal.confidence.factors })),
    deterministicNotes: signals.length ? ['Confidence is deterministic metadata scoring, not AI confidence.'] : ['No signal confidence breakdown was supplied.'],
  };
}

function buildSignalBlockingWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalBlockingWorkspaceModel {
  const signals = input.structuredSignals?.signals ?? [];
  return {
    blockingReasons: signals.filter(signal => signal.blockingReasons.length > 0 || signal.partialReasons.length > 0 || signal.status === 'missing').map(signal => ({ signalId: signal.id, status: signal.status, blockingReasons: signal.blockingReasons, partialReasons: signal.partialReasons })),
    deterministicNotes: signals.length ? ['Blocking and partial reasons remain explicit; missing engineering truth is not hidden.'] : ['No signal blocking metadata was supplied.'],
  };
}

function buildSignalInvalidationWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalInvalidationWorkspaceModel {
  const signals = input.structuredSignals?.signals ?? [];
  return {
    invalidations: signals.filter(signal => signal.invalidatedBy.length > 0 || signal.staleImpacts.length > 0).map(signal => ({ signalId: signal.id, invalidatedBy: signal.invalidatedBy, staleImpacts: signal.staleImpacts })),
    deterministicNotes: signals.length ? ['Signal invalidation metadata is linked to evidence/state invalidation events when present.'] : ['No signal invalidation metadata was supplied.'],
  };
}

function buildSignalStaleImpactsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): SignalStaleImpactsWorkspaceModel {
  return {
    staleImpacts: input.structuredSignals?.staleImpacts ?? [],
    fallbackParticipation: input.structuredSignals?.fallbackParticipation ?? [],
    deterministicNotes: input.structuredSignals ? ['Signal stale impacts and fallback participation are surfaced explicitly for review.'] : ['No signal stale-impact metadata was supplied.'],
  };
}


function buildResolvedEngineeringContextsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ResolvedEngineeringContextsWorkspaceModel {
  const summary = input.contextResolution ?? null;
  const contexts = summary?.contexts ?? [];
  return {
    summary,
    contexts,
    authoritative: contexts.filter(context => context.status === 'authoritative').map(context => context.id),
    preferred: contexts.filter(context => context.status === 'preferred').map(context => context.id),
    partial: contexts.filter(context => context.status === 'partial').map(context => context.id),
    conflicting: contexts.filter(context => context.status === 'conflicting').map(context => context.id),
    blocked: contexts.filter(context => context.status === 'blocked').map(context => context.id),
    unresolved: contexts.filter(context => context.status === 'unresolved').map(context => context.id),
    notApplicable: contexts.filter(context => context.status === 'not_applicable').map(context => context.id),
    deterministicNotes: summary?.deterministicNotes ?? ['No Engineering Context Resolution V1 model was supplied.'],
  };
}

function buildContextArbitrationWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextArbitrationWorkspaceModel {
  const contexts = input.contextResolution?.contexts ?? [];
  return {
    rankings: contexts
      .map(context => ({
        contextId: context.id,
        contextType: context.contextType,
        domain: context.domain,
        status: context.status,
        score: context.confidence.score,
        rank: context.confidence.rank,
        rankingReason: context.rankingReason,
        sourceSignalIds: context.sourceSignalIds,
        supportingSignalIds: context.supportingSignalIds,
      }))
      .sort((a, b) => a.rank - b.rank || a.contextId.localeCompare(b.contextId)),
    deterministicNotes: input.contextResolution ? ['Context arbitration rank is deterministic by score descending with stable context-id tie-breaks.'] : ['No context arbitration metadata was supplied.'],
  };
}

function buildContextConflictInspectorWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextConflictInspectorWorkspaceModel {
  const conflicts = input.contextResolution?.conflicts ?? [];
  return {
    conflicts,
    conflictingContextIds: sortText(conflicts.map(conflict => conflict.contextId)),
    competingSignalIds: sortText(conflicts.flatMap(conflict => conflict.competingSignalIds)),
    deterministicNotes: input.contextResolution ? ['Context conflicts preserve competing signals and do not silently promote a winner.'] : ['No context conflict metadata was supplied.'],
  };
}

function buildFallbackChainInspectorWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): FallbackChainInspectorWorkspaceModel {
  const contexts = input.contextResolution?.contexts ?? [];
  return {
    fallbackParticipation: input.contextResolution?.fallbackParticipation ?? [],
    fallbackDependentContextIds: sortText(contexts.filter(context => context.fallbackLineage.length > 0).map(context => context.id)),
    fallbackConfidencePenalties: contexts
      .filter(context => context.fallbackConfidencePenalties.length > 0)
      .map(context => ({ contextId: context.id, penalties: context.fallbackConfidencePenalties }))
      .sort((a, b) => a.contextId.localeCompare(b.contextId)),
    deterministicNotes: input.contextResolution ? ['Fallback lineage remains visible and reduces deterministic confidence; it is not promoted into truth.'] : ['No fallback-chain context metadata was supplied.'],
  };
}

function buildContextProvenanceWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextProvenanceWorkspaceModel {
  const contexts = input.contextResolution?.contexts ?? [];
  return {
    chains: contexts.map(context => ({
      contextId: context.id,
      sourceSignalIds: context.sourceSignalIds,
      sourceEvidenceIds: context.sourceEvidenceIds,
      sourceMetadataIds: context.sourceMetadataIds,
      dependencyLineage: context.dependencyLineage,
      invalidationLineage: context.invalidationLineage,
      deterministicHash: context.deterministicHash,
    })),
    deterministicNotes: contexts.length ? ['Context provenance chains are derived from structured signal source fields, grouping metadata, and invalidation lineage.'] : ['No context provenance is available without a context resolution model.'],
  };
}

function buildContextDependencyGraphWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextDependencyGraphWorkspaceModel {
  return {
    nodes: input.contextResolution?.dependencyGraph.nodes ?? [],
    edges: input.contextResolution?.dependencyGraph.edges ?? [],
    deterministicNotes: input.contextResolution ? ['Context dependency graph links contexts to signals, evidence, metadata, readiness, requirements, decisions, and invalidations.'] : ['No context dependency graph was supplied.'],
  };
}

function buildContextConfidenceBreakdownWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextConfidenceBreakdownWorkspaceModel {
  const contexts = input.contextResolution?.contexts ?? [];
  return {
    confidenceBreakdown: contexts.map(context => ({
      contextId: context.id,
      status: context.status,
      score: context.confidence.score,
      band: context.confidence.band,
      rank: context.confidence.rank,
      factors: context.confidence.factors,
      penalties: context.confidence.penalties,
    })),
    deterministicNotes: contexts.length ? ['Context confidence is deterministic metadata scoring, not AI confidence or image interpretation.'] : ['No context confidence breakdown was supplied.'],
  };
}

function buildContextInvalidationsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextInvalidationsWorkspaceModel {
  const contexts = input.contextResolution?.contexts ?? [];
  return {
    invalidations: contexts
      .filter(context => context.invalidationLineage.length > 0 || context.staleImpactPropagation.length > 0 || context.regenerationParticipation.length > 0)
      .map(context => ({ contextId: context.id, invalidationLineage: context.invalidationLineage, staleImpactPropagation: context.staleImpactPropagation, regenerationParticipation: context.regenerationParticipation }))
      .sort((a, b) => a.contextId.localeCompare(b.contextId)),
    deterministicNotes: contexts.length ? ['Context invalidation participation is surfaced from upstream signal and state invalidation lineage.'] : ['No context invalidation metadata was supplied.'],
  };
}

function buildContextStaleImpactsWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextStaleImpactsWorkspaceModel {
  return {
    staleImpacts: input.contextResolution?.staleImpacts ?? [],
    cadReadinessMappings: input.contextResolution?.cadReadinessMappings ?? [],
    deterministicNotes: input.contextResolution ? ['Context stale impacts and CAD-readiness mappings are displayed as metadata only.'] : ['No context stale-impact metadata was supplied.'],
  };
}

function buildContextResolutionTimelineWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput): ContextResolutionTimelineWorkspaceModel {
  return {
    events: input.contextResolution?.timeline ?? [],
    deterministicNotes: input.contextResolution ? ['Context resolution timeline is deterministic status metadata for each resolved context.'] : ['No context resolution timeline was supplied.'],
  };
}

function buildAuditGuards(input: BuildEngineeringIntelligenceWorkspaceInput): AuditGuardWorkspaceModel {
  const guards: EngineeringStateAuditGuardResult[] = sortBy(input.auditGuards ?? [], guard => guard.guardCode);
  const failures = guards.filter(guard => !guard.passed);
  return {
    guards,
    topologyViolations: failures.filter(guard => includesAny(guard.guardCode, ['ordering', 'topology'])),
    provenanceFailures: failures.filter(guard => includesAny(guard.guardCode, ['provenance', 'lineage'])),
    orphanedNodeFailures: failures.filter(guard => includesAny(guard.guardCode, ['orphaned'])),
    staleLineageFailures: failures.filter(guard => includesAny(guard.guardCode, ['stale', 'invalidation'])),
    invalidRenderContextFailures: failures.filter(guard => includesAny(guard.guardCode, ['render'])),
    deterministicNotes: [
      guards.length > 0
        ? 'Audit guard rows are supplied by deterministic engineering state guard results.'
        : 'No active audit guard result set was supplied to this workspace context.',
      'Warnings and failures are displayed; they are not downgraded or hidden by the UI.',
    ],
  };
}

export function engineeringIntelligenceRoutes(): EngineeringIntelligenceRouteSummary[] {
  return ROUTES;
}

export function buildEngineeringIntelligenceWorkspace(input: BuildEngineeringIntelligenceWorkspaceInput = {}): EngineeringIntelligenceWorkspaceModel {
  const snapshots = input.snapshots ?? [];
  const latestSnapshot = latestValidStateSnapshot(snapshots) ?? snapshots[snapshots.length - 1] ?? null;
  const health = buildHealth(input, latestSnapshot);
  const evidenceGroups = buildEvidenceGroups(input, latestSnapshot);
  const photoGrouping = buildPhotoGrouping(input);
  const requirements = buildRequirements(latestSnapshot);
  const decisions = buildDecisions(latestSnapshot);
  const staleInvalidation = buildStaleInvalidation(input, latestSnapshot);
  const snapshotTimeline = buildSnapshots(input, latestSnapshot);
  const graph = buildGraph(input, latestSnapshot);
  const regenerationPlanning = buildRegenerationPlanning(input);
  const invalidationPropagation = buildInvalidationPropagationWorkspace(input);
  const dependencyTraversal = buildDependencyTraversalWorkspace(input);
  const regenerationPlanningV1 = buildRegenerationPlanningV1Workspace(input);
  const snapshotDelta = buildSnapshotDeltaWorkspace(input);
  const affectedOutputs = buildAffectedOutputsWorkspace(input);
  const staleStateTimeline = buildStaleStateTimelineWorkspace(input);
  const structuredSignals = buildStructuredSignalsWorkspace(input);
  const signalProvenance = buildSignalProvenanceWorkspace(input);
  const signalDependencyGraph = buildSignalDependencyGraphWorkspace(input);
  const signalRequirementMapping = buildSignalRequirementMappingWorkspace(input);
  const signalConfidence = buildSignalConfidenceWorkspace(input);
  const signalBlocking = buildSignalBlockingWorkspace(input);
  const signalInvalidations = buildSignalInvalidationWorkspace(input);
  const signalStaleImpacts = buildSignalStaleImpactsWorkspace(input);
  const resolvedContexts = buildResolvedEngineeringContextsWorkspace(input);
  const contextArbitration = buildContextArbitrationWorkspace(input);
  const contextConflictInspector = buildContextConflictInspectorWorkspace(input);
  const fallbackChainInspector = buildFallbackChainInspectorWorkspace(input);
  const contextProvenance = buildContextProvenanceWorkspace(input);
  const contextDependencyGraph = buildContextDependencyGraphWorkspace(input);
  const contextConfidenceBreakdown = buildContextConfidenceBreakdownWorkspace(input);
  const contextInvalidations = buildContextInvalidationsWorkspace(input);
  const contextStaleImpacts = buildContextStaleImpactsWorkspace(input);
  const contextResolutionTimeline = buildContextResolutionTimelineWorkspace(input);
  const auditGuards = buildAuditGuards(input);

  return {
    projectId: input.projectId ?? null,
    generatedFrom: latestSnapshot ? 'project-snapshot' : 'system-registries',
    routes: ROUTES,
    health,
    evidenceGroups,
    photoGrouping,
    requirements,
    decisions,
    staleInvalidation,
    snapshots: snapshotTimeline,
    graph,
    regenerationPlanning,
    invalidationPropagation,
    dependencyTraversal,
    regenerationPlanningV1,
    snapshotDelta,
    affectedOutputs,
    staleStateTimeline,
    structuredSignals,
    signalProvenance,
    signalDependencyGraph,
    signalRequirementMapping,
    signalConfidence,
    signalBlocking,
    signalInvalidations,
    signalStaleImpacts,
    resolvedContexts,
    contextArbitration,
    contextConflictInspector,
    fallbackChainInspector,
    contextProvenance,
    contextDependencyGraph,
    contextConfidenceBreakdown,
    contextInvalidations,
    contextStaleImpacts,
    contextResolutionTimeline,
    auditGuards,
    deterministicNotes: [
      latestSnapshot
        ? `Workspace generated from snapshot ${latestSnapshot.snapshotId}.`
        : 'Workspace generated from deterministic registries without project-bound engineering state.',
      'No client-side backend logic duplication, OCR, CV, CAD generation, image-byte inspection, semantic inference, or autonomous regeneration is introduced.',
    ],
  };
}
