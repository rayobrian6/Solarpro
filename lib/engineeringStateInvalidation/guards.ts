import type {
  EngineeringInvalidationResult,
  EngineeringStateAuditGuardResult,
  EngineeringStateRecord,
  EngineeringStateSnapshot,
  EngineeringStateSnapshotDiff,
  PersistentEngineeringStateGraph,
  SelectiveRegenerationPlan,
} from './types';
import { stableEngineeringStateHash } from './hash';

export function runEngineeringStateAuditGuards(input: {
  records: EngineeringStateRecord[];
  invalidationResult?: EngineeringInvalidationResult | null;
  regenerationPlan?: SelectiveRegenerationPlan | null;
  renderOutputExpected?: boolean;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  snapshots?: EngineeringStateSnapshot[] | null;
  diffs?: EngineeringStateSnapshotDiff[] | null;
}): EngineeringStateAuditGuardResult[] {
  const records = input.records;
  const invalidationResult = input.invalidationResult ?? null;
  const regenerationPlan = input.regenerationPlan ?? null;
  const staleRenderRecords = records.filter(record =>
    record.stateType === 'render_output'
    && record.staleStatus !== 'current'
    && input.renderOutputExpected !== false,
  );
  const recordsWithoutLineage = records.filter(record =>
    (record.staleStatus !== 'current' || regenerationPlan?.staleStateIds.includes(record.stateId))
    && (record.provenanceHash.length === 0 || record.dependencyHash.length === 0 || record.dependencyNodeIds.length === 0),
  );
  const rawUploadSources = records.filter(record =>
    [...record.generationInputs.deterministicSources, ...record.generationInputs.canonicalInputKeys]
      .some(source => /raw(upload|photo|file)/i.test(source)),
  );
  const orphanedSections = records.filter(record =>
    ['document_section', 'sld_section', 'bom_row'].includes(record.stateType)
    && record.dependencyNodeIds.length === 0
    && record.requirementIds.length === 0
    && record.decisionIds.length === 0,
  );
  const decisionOutputsWithoutTracking = records.filter(record =>
    record.decisionIds.length > 0
    && (record.generationHash.length === 0 || record.dependencyHash.length === 0 || record.provenanceHash.length === 0),
  );
  const hiddenPropagationEvents = invalidationResult?.invalidationEvents.filter(event =>
    event.triggeringDependencyIds.length === 0
    && event.triggeringRequirementIds.length === 0
    && event.triggeringDecisionIds.length === 0
    && event.triggeringCanonicalEvidenceIds.length === 0,
  ) ?? [];
  const graph = input.persistentGraph ?? null;
  const snapshots = input.snapshots ?? [];
  const diffs = input.diffs ?? [];
  const persistedRecordsWithoutProvenance = graph?.nodes.filter(node =>
    node.nodeKind === 'state_record'
    && ((node.provenanceHash ?? '').length === 0 || (node.dependencyHash ?? '').length === 0 || (node.generationHash ?? '').length === 0),
  ) ?? [];
  const graphNodeIds = new Set(graph?.nodes.map(node => node.nodeId) ?? []);
  const orphanedPersistentGraphNodes = graph?.nodes.filter(node => {
    if (node.nodeKind === 'state_record') return !node.stateId || node.dependencyNodeIds.length === 0;
    return !node.dependencyNodeId || (node.requirementIds.length === 0 && node.canonicalEvidenceIds.length === 0 && node.dependencyNodeIds.length === 0);
  }) ?? [];
  const graphEdgesWithMissingEndpoints = graph?.edges.filter(edge => !graphNodeIds.has(edge.fromNodeId) || !graphNodeIds.has(edge.toNodeId)) ?? [];
  const nonDeterministicallyOrdered = [
    !isSorted(records.map(record => record.stateId)) ? 'stateRecords' : null,
    graph && !isSorted(graph.nodes.map(node => node.nodeId)) ? 'persistentGraph.nodes' : null,
    graph && !isSorted(graph.edges.map(edge => edge.edgeId)) ? 'persistentGraph.edges' : null,
    ...snapshots.flatMap(snapshot => [
      !isSorted(snapshot.stateRefs.map(ref => ref.stateId)) ? `${snapshot.snapshotId}.stateRefs` : null,
      !isSorted(snapshot.staleStateIds) ? `${snapshot.snapshotId}.staleStateIds` : null,
      !isSorted(snapshot.validStateIds) ? `${snapshot.snapshotId}.validStateIds` : null,
    ]),
    ...diffs.map(diff => !isSorted(diff.entries.map(entry => entry.diffId)) ? `${diff.diffId}.entries` : null),
  ].filter(Boolean) as string[];
  const snapshotDrift = snapshots.filter(snapshot => {
    const graphHash = graph?.graphId === snapshot.stateGraphId ? graph.deterministicHash : null;
    if (!graphHash) return false;
    const recomputed = stableEngineeringStateHash('engineering-state-snapshot', [
      snapshot.snapshotId,
      snapshot.registryId,
      graphHash,
      snapshot.previousSnapshotHash,
      ...Object.entries(snapshot.hashVector).map(([key, value]) => `${key}:${value}`),
      ...snapshot.stateRefs.map(ref => `${ref.stateId}|${ref.staleStatus}|${ref.generationHash}|${ref.provenanceHash}|${ref.dependencyHash}`),
    ]);
    return recomputed !== snapshot.snapshotHash;
  });
  const invalidationWithoutLineage = invalidationResult?.invalidationEvents.filter(event =>
    event.lastValidGenerationHash.length === 0
    || event.lastValidProvenanceHash.length === 0
    || (event.triggeringDependencyIds.length === 0
      && event.triggeringRequirementIds.length === 0
      && event.triggeringDecisionIds.length === 0
      && event.triggeringCanonicalEvidenceIds.length === 0),
  ) ?? [];
  const regenerationPlanWithoutDependencyHash = regenerationPlan?.staleStateIds.filter(stateId => {
    const record = records.find(candidate => candidate.stateId === stateId);
    return !record || record.dependencyHash.length === 0 || record.dependencyNodeIds.length === 0;
  }) ?? [];

  return [
    {
      guardCode: 'rendering_from_stale_dependencies_blocked',
      passed: staleRenderRecords.length === 0,
      severity: staleRenderRecords.length === 0 ? 'info' : 'error',
      message: staleRenderRecords.length === 0
        ? 'No render output state is marked stale for the current render path.'
        : `Render output state(s) cannot render from stale dependencies: ${staleRenderRecords.map(record => record.stateId).join(', ')}`,
      deterministicNotes: ['Render outputs marked stale must be blocked or regenerated by an explicit deterministic plan before use.'],
    },
    {
      guardCode: 'regeneration_requires_provenance_lineage',
      passed: recordsWithoutLineage.length === 0,
      severity: recordsWithoutLineage.length === 0 ? 'info' : 'error',
      message: recordsWithoutLineage.length === 0
        ? 'All stale/regeneration-tracked records retain provenance and dependency hashes.'
        : `Regeneration-tracked state lacks provenance/dependency lineage: ${recordsWithoutLineage.map(record => record.stateId).join(', ')}`,
      deterministicNotes: ['Selective regeneration plans may reference only state records with explicit provenance and dependency lineage.'],
    },
    {
      guardCode: 'regeneration_from_raw_uploads_blocked',
      passed: rawUploadSources.length === 0,
      severity: rawUploadSources.length === 0 ? 'info' : 'error',
      message: rawUploadSources.length === 0
        ? 'State generation inputs reference canonical evidence/provenance, not raw upload counts or raw files.'
        : `State records reference raw upload inputs: ${rawUploadSources.map(record => record.stateId).join(', ')}`,
      deterministicNotes: ['Immutable raw survey history remains audit metadata; invalidation is driven by canonical evidence, requirements, decisions, and dependency nodes.'],
    },
    {
      guardCode: 'document_sections_not_orphaned',
      passed: orphanedSections.length === 0,
      severity: orphanedSections.length === 0 ? 'info' : 'error',
      message: orphanedSections.length === 0
        ? 'Document, SLD, and BOM state records are linked to requirements, decisions, or dependency nodes.'
        : `Orphaned document output state(s): ${orphanedSections.map(record => record.stateId).join(', ')}`,
      deterministicNotes: ['Document output state must be connected to dependency lineage before invalidation can be explained.'],
    },
    {
      guardCode: 'decision_outputs_have_invalidation_tracking',
      passed: decisionOutputsWithoutTracking.length === 0,
      severity: decisionOutputsWithoutTracking.length === 0 ? 'info' : 'error',
      message: decisionOutputsWithoutTracking.length === 0
        ? 'Decision-linked outputs include generation, provenance, and dependency hashes.'
        : `Decision-linked output(s) missing invalidation tracking hashes: ${decisionOutputsWithoutTracking.map(record => record.stateId).join(', ')}`,
      deterministicNotes: ['Decision-aware outputs must be invalidation-aware so stale decision lineage cannot be hidden.'],
    },
    {
      guardCode: 'dependency_propagation_not_hidden',
      passed: hiddenPropagationEvents.length === 0,
      severity: hiddenPropagationEvents.length === 0 ? 'info' : 'error',
      message: hiddenPropagationEvents.length === 0
        ? 'Invalidation events expose triggering dependency, requirement, decision, or evidence ids.'
        : `Invalidation event(s) hide propagation triggers: ${hiddenPropagationEvents.map(event => event.eventId).join(', ')}`,
      deterministicNotes: ['Every invalidation event must expose deterministic trigger lineage; no UI-manufactured stale states are allowed.'],
    },
    {
      guardCode: 'persistence_requires_provenance',
      passed: persistedRecordsWithoutProvenance.length === 0,
      severity: persistedRecordsWithoutProvenance.length === 0 ? 'info' : 'error',
      message: persistedRecordsWithoutProvenance.length === 0
        ? 'Persistent state graph nodes retain provenance, generation, and dependency hashes.'
        : `Persistent graph state node(s) lack provenance/generation/dependency hashes: ${persistedRecordsWithoutProvenance.map(node => node.nodeId).join(', ')}`,
      deterministicNotes: ['Persistent Engineering State Graph nodes cannot be stored without auditable hash lineage.'],
    },
    {
      guardCode: 'invalidation_requires_lineage',
      passed: invalidationWithoutLineage.length === 0,
      severity: invalidationWithoutLineage.length === 0 ? 'info' : 'error',
      message: invalidationWithoutLineage.length === 0
        ? 'Invalidation events retain last-valid hashes and trigger lineage.'
        : `Invalidation event(s) missing lineage: ${invalidationWithoutLineage.map(event => event.eventId).join(', ')}`,
      deterministicNotes: ['Invalidation persistence requires last-valid generation/provenance hashes and explicit trigger ids.'],
    },
    {
      guardCode: 'regeneration_plan_requires_dependency_hash',
      passed: regenerationPlanWithoutDependencyHash.length === 0,
      severity: regenerationPlanWithoutDependencyHash.length === 0 ? 'info' : 'error',
      message: regenerationPlanWithoutDependencyHash.length === 0
        ? 'Regeneration plan stale states resolve to dependency hashes.'
        : `Regeneration plan references state without dependency hash: ${regenerationPlanWithoutDependencyHash.join(', ')}`,
      deterministicNotes: ['Selective regeneration planning must be keyed to dependency hashes; it remains planning metadata only.'],
    },
    {
      guardCode: 'snapshot_hash_not_drifted',
      passed: snapshotDrift.length === 0,
      severity: snapshotDrift.length === 0 ? 'info' : 'error',
      message: snapshotDrift.length === 0
        ? 'Snapshot hashes match persisted graph/state hash vectors when graph data is supplied.'
        : `Snapshot hash drift detected: ${snapshotDrift.map(snapshot => snapshot.snapshotId).join(', ')}`,
      deterministicNotes: ['Snapshot corruption/drift is detected by recomputing deterministic snapshot hashes from persisted references.'],
    },
    {
      guardCode: 'persistence_ordering_deterministic',
      passed: nonDeterministicallyOrdered.length === 0,
      severity: nonDeterministicallyOrdered.length === 0 ? 'info' : 'error',
      message: nonDeterministicallyOrdered.length === 0
        ? 'Persistent graph, snapshot, diff, and registry arrays are deterministically ordered.'
        : `Non-deterministic persistence ordering detected in: ${nonDeterministicallyOrdered.join(', ')}`,
      deterministicNotes: ['Persistent state arrays must be sorted by stable ids before hashing or storage.'],
    },
    {
      guardCode: 'persistent_graph_nodes_not_orphaned',
      passed: orphanedPersistentGraphNodes.length === 0 && graphEdgesWithMissingEndpoints.length === 0,
      severity: orphanedPersistentGraphNodes.length === 0 && graphEdgesWithMissingEndpoints.length === 0 ? 'info' : 'error',
      message: orphanedPersistentGraphNodes.length === 0 && graphEdgesWithMissingEndpoints.length === 0
        ? 'Persistent graph nodes and edges are connected to state/dependency lineage.'
        : `Persistent graph orphan(s): ${[...orphanedPersistentGraphNodes.map(node => node.nodeId), ...graphEdgesWithMissingEndpoints.map(edge => edge.edgeId)].join(', ')}`,
      deterministicNotes: ['Orphaned graph nodes or edges cannot be persisted because stale-state lineage would be unexplainable.'],
    },
  ];
}

function isSorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) <= 0);
}


export function assertEngineeringStateAuditGuards(input: {
  records: EngineeringStateRecord[];
  invalidationResult?: EngineeringInvalidationResult | null;
  regenerationPlan?: SelectiveRegenerationPlan | null;
  renderOutputExpected?: boolean;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  snapshots?: EngineeringStateSnapshot[] | null;
  diffs?: EngineeringStateSnapshotDiff[] | null;
}): EngineeringStateAuditGuardResult[] {
  const guards = runEngineeringStateAuditGuards(input);
  const failing = guards.filter(guard => guard.severity === 'error' && !guard.passed);
  if (failing.length > 0) {
    throw new Error(failing.map(guard => `${guard.guardCode}: ${guard.message}`).join('\n'));
  }
  return guards;
}
