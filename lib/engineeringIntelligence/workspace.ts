import {
  ENGINEERING_REQUIREMENT_DEFINITIONS,
  type EngineeringRequirementDefinition,
  type EngineeringRequirementId,
} from '@/lib/survey/evidence/engineeringRequirements';
import {
  listEngineeringDecisionDefinitions,
  type EngineeringDecisionDefinition,
} from '@/lib/engineeringDecisionProvenance';
import {
  latestValidStateSnapshot,
  listStaleEngineeringOutputs,
  type EngineeringStateAuditGuardResult,
  type EngineeringStateSnapshot,
  type PersistentEngineeringStateGraphNode,
  type SelectiveRegenerationPlan,
} from '@/lib/engineeringStateInvalidation';
import type {
  AuditGuardWorkspaceModel,
  BuildEngineeringIntelligenceWorkspaceInput,
  CanonicalEvidenceWorkspaceGroupModel,
  DecisionWorkspaceItemModel,
  DependencyGraphViewerModel,
  EngineeringEvidenceWorkspaceGroupId,
  EngineeringHealthDashboardModel,
  EngineeringIntelligenceGraphEdgeModel,
  EngineeringIntelligenceGraphNodeModel,
  EngineeringIntelligenceRouteSummary,
  EngineeringIntelligenceWorkspaceModel,
  RegenerationPlanningWorkspaceModel,
  RequirementWorkspaceItemModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
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
}> = [
  {
    groupId: 'utility',
    label: 'Utility',
    description: 'Meter, utility bill, utility access, and interconnection evidence required by deterministic registry rules.',
    requirementIds: ['utility_meter', 'utility_bill'],
  },
  {
    groupId: 'electrical',
    label: 'Electrical',
    description: 'Main service equipment, disconnects, subpanels, grounding, rapid shutdown, placards, and service labeling.',
    requirementIds: ['main_service_panel', 'subpanel', 'main_disconnect', 'rapid_shutdown', 'placards', 'service_equipment_label'],
  },
  {
    groupId: 'roof',
    label: 'Roof',
    description: 'Roof plane, edge, ridge, surface, and obstruction evidence used for roof-layout traceability.',
    requirementIds: ['roof_overview'],
  },
  {
    groupId: 'structural',
    label: 'Structural',
    description: 'Attic, structural access, framing-context, and review-supporting canonical evidence.',
    requirementIds: ['attic_access', 'structural_access'],
  },
  {
    groupId: 'routing',
    label: 'Routing',
    description: 'Conduit, grounding, service access, and path context that affects routed engineering outputs.',
    requirementIds: ['main_service_panel', 'utility_meter', 'main_disconnect'],
  },
  {
    groupId: 'detached_structures',
    label: 'Detached Structures',
    description: 'Detached-structure evidence group reserved for explicit canonical evidence and future requirement expansion.',
    requirementIds: [],
  },
  {
    groupId: 'ess',
    label: 'ESS',
    description: 'Battery location and energy-storage assumptions, surfaced only through explicit deterministic requirements/decisions.',
    requirementIds: ['battery_location'],
  },
  {
    groupId: 'trench_ground_mount',
    label: 'Trench / Ground Mount',
    description: 'Trenching, ground-mount, and route-specific evidence group reserved for canonical evidence and dependency lineage.',
    requirementIds: [],
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

function buildEvidenceGroups(latestSnapshot: EngineeringStateSnapshot | null): CanonicalEvidenceWorkspaceGroupModel[] {
  const refs = stateRefs(latestSnapshot);
  return EVIDENCE_GROUPS.map(group => {
    const linkedStateRefs = refs.filter(ref => ref.requirementIds.some(requirementId => group.requirementIds.includes(requirementId)));
    const canonicalEvidenceIds = sortText(linkedStateRefs.flatMap(ref => ref.canonicalEvidenceIds));
    return {
      ...group,
      canonicalEvidenceItems: canonicalEvidenceIds.map(canonicalEvidenceId => {
        const evidenceStateRefs = linkedStateRefs.filter(ref => ref.canonicalEvidenceIds.includes(canonicalEvidenceId));
        return {
          canonicalEvidenceId,
          category: group.label,
          provenance: evidenceStateRefs.map(ref => ref.stateId),
          originatingSurveyIds: [],
          duplicateCollapseCount: 0,
          linkedRequirementIds: sortText(evidenceStateRefs.flatMap(ref => ref.requirementIds)),
          linkedDocumentSectionIds: [],
          staleStateImpactStateIds: sortText(evidenceStateRefs.filter(ref => ref.staleStatus !== 'current').map(ref => ref.stateId)),
          status: evidenceStateRefs.some(ref => ref.staleStatus !== 'current') ? 'stale' : 'current',
        };
      }),
      deterministicNotes: [
        canonicalEvidenceIds.length > 0
          ? 'Evidence rows are derived from snapshot state references and canonical evidence ids.'
          : 'No canonical evidence rows are loaded for this group in the current workspace context.',
        'Duplicate collapse counts require canonical manifest input; absent manifest values are shown as zero rather than inferred.',
      ],
    } satisfies CanonicalEvidenceWorkspaceGroupModel;
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

function includesAny(value: string, tokens: string[]) {
  return tokens.some(token => value.includes(token));
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
  const evidenceGroups = buildEvidenceGroups(latestSnapshot);
  const requirements = buildRequirements(latestSnapshot);
  const decisions = buildDecisions(latestSnapshot);
  const staleInvalidation = buildStaleInvalidation(input, latestSnapshot);
  const snapshotTimeline = buildSnapshots(input, latestSnapshot);
  const graph = buildGraph(input, latestSnapshot);
  const regenerationPlanning = buildRegenerationPlanning(input);
  const auditGuards = buildAuditGuards(input);

  return {
    projectId: input.projectId ?? null,
    generatedFrom: latestSnapshot ? 'project-snapshot' : 'system-registries',
    routes: ROUTES,
    health,
    evidenceGroups,
    requirements,
    decisions,
    staleInvalidation,
    snapshots: snapshotTimeline,
    graph,
    regenerationPlanning,
    auditGuards,
    deterministicNotes: [
      latestSnapshot
        ? `Workspace generated from snapshot ${latestSnapshot.snapshotId}.`
        : 'Workspace generated from deterministic registries without project-bound engineering state.',
      'No client-side backend logic duplication, OCR, CV, CAD generation, image-byte inspection, semantic inference, or autonomous regeneration is introduced.',
    ],
  };
}
