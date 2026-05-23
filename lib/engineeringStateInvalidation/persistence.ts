import type {
  BuildEngineeringStateSnapshotInput,
  BuildEngineeringStateTransitionHistoryInput,
  BuildPersistentEngineeringStateGraphInput,
  EngineeringStateHashVector,
  EngineeringStateSnapshot,
  EngineeringStateSnapshotDiff,
  EngineeringStateSnapshotReference,
  EngineeringStateSnapshotStateRef,
  EngineeringStateTimeline,
  EngineeringStateTransitionEvent,
  EngineeringStateTransitionEventType,
  EngineeringStateTransitionHistory,
  PersistentEngineeringStateGraph,
  PersistentEngineeringStateGraphEdge,
  PersistentEngineeringStateGraphNode,
} from './types';
import { stableEngineeringStateHash } from './hash';

export function buildPersistentEngineeringStateGraph(input: BuildPersistentEngineeringStateGraphInput): PersistentEngineeringStateGraph {
  const generatedAt = input.generatedAt ?? input.registry.generatedAt;
  const dependencyGraph = input.dependencyGraph ?? null;
  const dependencyNodesById = new Map((dependencyGraph?.nodes ?? []).map(node => [node.id, node]));
  const nodes = new Map<string, PersistentEngineeringStateGraphNode>();
  const edges = new Map<string, PersistentEngineeringStateGraphEdge>();

  for (const record of input.registry.stateRecords) {
    const stateNodeId = `stateGraphNode:${record.stateId}`;
    nodes.set(stateNodeId, {
      nodeId: stateNodeId,
      nodeKind: 'state_record',
      stateId: record.stateId,
      stateType: record.stateType,
      staleStatus: record.staleStatus,
      requirementIds: sortUnique(record.requirementIds),
      decisionIds: sortUnique(record.decisionIds),
      canonicalEvidenceIds: sortUnique(record.canonicalEvidenceIds),
      dependencyNodeIds: sortUnique(record.dependencyNodeIds),
      generationHash: record.generationHash,
      provenanceHash: record.provenanceHash,
      dependencyHash: record.dependencyHash,
      truthSource: record.truthSource,
      deterministicNotes: [
        `Persistent graph node for state record ${record.stateId}.`,
        'Node persists lineage ids and stable hashes only; it does not persist generated engineering output bytes.',
      ],
    });

    for (const dependencyNodeId of sortUnique(record.dependencyNodeIds)) {
      const dependencyNode = dependencyNodesById.get(dependencyNodeId);
      const dependencyGraphNodeId = `dependencyGraphNode:${dependencyNodeId}`;
      if (!nodes.has(dependencyGraphNodeId)) {
        nodes.set(dependencyGraphNodeId, {
          nodeId: dependencyGraphNodeId,
          nodeKind: 'dependency_graph_node',
          dependencyNodeId,
          requirementIds: sortUnique(dependencyNode?.requirementIds ?? []),
          decisionIds: [],
          canonicalEvidenceIds: sortUnique(dependencyNode?.canonicalEvidenceIds ?? []),
          dependencyNodeIds: [dependencyNodeId],
          truthSource: dependencyNode?.truthSource ?? record.truthSource,
          deterministicNotes: [
            `Persistent graph node for dependency node ${dependencyNodeId}.`,
            'Dependency graph node was copied as auditable lineage metadata only.',
          ],
        });
      }
      putEdge(edges, {
        edgeId: `state-edge:${dependencyNodeId}->${record.stateId}`,
        fromNodeId: dependencyGraphNodeId,
        toNodeId: stateNodeId,
        edgeType: 'depends_on_dependency_node',
        deterministicReason: `State ${record.stateId} depends on dependency node ${dependencyNodeId}.`,
      });
    }
  }

  for (const event of input.invalidationResult?.invalidationEvents ?? []) {
    const stateNodeId = `stateGraphNode:${event.stateId}`;
    for (const dependencyNodeId of sortUnique(event.triggeringDependencyIds)) {
      putEdge(edges, {
        edgeId: `invalidation-edge:${event.eventId}:${dependencyNodeId}->${event.stateId}`,
        fromNodeId: `dependencyGraphNode:${dependencyNodeId}`,
        toNodeId: stateNodeId,
        edgeType: 'invalidates_state',
        deterministicReason: `Invalidation event ${event.eventId} marks ${event.stateId} stale from dependency ${dependencyNodeId}.`,
      });
    }
    if (event.triggeringDependencyIds.length === 0) {
      putEdge(edges, {
        edgeId: `invalidation-edge:${event.eventId}:lineage->${event.stateId}`,
        fromNodeId: stateNodeId,
        toNodeId: stateNodeId,
        edgeType: 'invalidates_state',
        deterministicReason: `Invalidation event ${event.eventId} marks ${event.stateId} stale from explicit non-dependency lineage.`,
      });
    }
  }

  const sortedNodes = Array.from(nodes.values()).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const sortedEdges = Array.from(edges.values()).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return {
    graphId: input.graphId,
    generatedAt,
    registryId: input.registry.registryId,
    dependencyGraphId: dependencyGraph?.graphId,
    nodes: sortedNodes,
    edges: sortedEdges,
    stateNodeIds: sortedNodes.filter(node => node.nodeKind === 'state_record').map(node => node.nodeId),
    dependencyNodeIds: sortedNodes.filter(node => node.nodeKind === 'dependency_graph_node').map(node => node.nodeId),
    deterministicHash: stableEngineeringStateHash('persistent-state-graph', [
      input.registry.registryId,
      dependencyGraph?.deterministicHash,
      ...sortedNodes.map(node => `${node.nodeId}|${node.generationHash ?? ''}|${node.provenanceHash ?? ''}|${node.dependencyHash ?? ''}|${node.staleStatus ?? ''}`),
      ...sortedEdges.map(edge => `${edge.edgeId}|${edge.fromNodeId}|${edge.toNodeId}|${edge.edgeType}`),
    ]),
    deterministicNotes: [
      'PersistentEngineeringStateGraph v1 stores deterministic state/dependency lineage and invalidation edges.',
      'Graph content is sorted by stable ids and hashed from ids/hashes only for deterministic persistence.',
      'No CV, OCR, CAD generation, image-byte inspection, or autonomous regeneration is performed.',
    ],
  };
}

export function buildEngineeringStateSnapshot(input: BuildEngineeringStateSnapshotInput): EngineeringStateSnapshot {
  const generatedAt = input.generatedAt ?? input.registry.generatedAt;
  const stateGraph = input.stateGraph ?? buildPersistentEngineeringStateGraph({
    graphId: `${input.snapshotId}.state-graph`,
    generatedAt,
    registry: input.registry,
    dependencyGraph: input.dependencyGraph ?? null,
    invalidationResult: input.invalidationResult ?? null,
  });
  const stateRefs = input.registry.stateRecords.map(record => ({
    stateId: record.stateId,
    stateType: record.stateType,
    staleStatus: record.staleStatus,
    generationHash: record.generationHash,
    provenanceHash: record.provenanceHash,
    dependencyHash: record.dependencyHash,
    requirementIds: sortUnique(record.requirementIds),
    decisionIds: sortUnique(record.decisionIds),
    canonicalEvidenceIds: sortUnique(record.canonicalEvidenceIds),
    dependencyNodeIds: sortUnique(record.dependencyNodeIds),
  } satisfies EngineeringStateSnapshotStateRef)).sort((a, b) => a.stateId.localeCompare(b.stateId));
  const hashVector: EngineeringStateHashVector = {
    dependencyGraphHash: input.dependencyGraph?.deterministicHash ?? input.registry.dependencyHash,
    provenanceHash: input.registry.provenanceHash,
    generationHash: input.registry.generationHash,
    invalidationHash: input.invalidationResult?.deterministicHash ?? stableEngineeringStateHash('invalidation-none', [input.registry.registryId]),
    renderHash: stableEngineeringStateHash('render-state', stateRefs.filter(ref => ref.stateType === 'render_context' || ref.stateType === 'render_output').map(ref => `${ref.stateId}|${ref.generationHash}|${ref.staleStatus}`)),
    decisionHash: input.decisionProvenance?.deterministicHash ?? stableEngineeringStateHash('decision-state', stateRefs.flatMap(ref => ref.decisionIds)),
    requirementHash: stableEngineeringStateHash('requirement-state', stateRefs.flatMap(ref => ref.requirementIds)),
  };
  const staleStateIds = sortUnique(stateRefs.filter(ref => ref.staleStatus !== 'current').map(ref => ref.stateId));
  const validStateIds = sortUnique(stateRefs.filter(ref => ref.staleStatus === 'current').map(ref => ref.stateId));
  const transitionEventIds = [
    `transition:${input.snapshotId}:snapshot_created`,
    ...(input.previousSnapshot ? [`transition:${input.snapshotId}:snapshot_superseded:${input.previousSnapshot.snapshotId}`] : []),
    ...(input.invalidationResult?.invalidationEvents.map(event => `transition:${input.snapshotId}:state_invalidated:${event.stateId}`) ?? []),
  ].sort((a, b) => a.localeCompare(b));
  const snapshotHash = stableEngineeringStateHash('engineering-state-snapshot', [
    input.snapshotId,
    input.registry.registryId,
    stateGraph.deterministicHash,
    input.previousSnapshot?.snapshotHash,
    ...Object.entries(hashVector).map(([key, value]) => `${key}:${value}`),
    ...stateRefs.map(ref => `${ref.stateId}|${ref.staleStatus}|${ref.generationHash}|${ref.provenanceHash}|${ref.dependencyHash}`),
  ]);
  return {
    snapshotId: input.snapshotId,
    generatedAt,
    registryId: input.registry.registryId,
    stateGraphId: stateGraph.graphId,
    previousSnapshotId: input.previousSnapshot?.snapshotId,
    previousSnapshotHash: input.previousSnapshot?.snapshotHash,
    hashVector,
    stateRefs,
    staleStateIds,
    validStateIds,
    transitionEventIds,
    snapshotHash,
    deterministicNotes: [
      'EngineeringStateSnapshot v1 is deterministic and hashable from state refs, graph hash, and explicit lineage hashes.',
      'Snapshot creation is persistence metadata only and does not trigger regeneration.',
      'Snapshot hash excludes wall-clock generatedAt so identical engineering inputs remain hash-stable.',
    ],
  };
}

export function engineeringStateSnapshotReference(snapshot: EngineeringStateSnapshot): EngineeringStateSnapshotReference {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    stateGraphId: snapshot.stateGraphId,
    dependencyGraphHash: snapshot.hashVector.dependencyGraphHash,
    provenanceHash: snapshot.hashVector.provenanceHash,
    generationHash: snapshot.hashVector.generationHash,
    invalidationHash: snapshot.hashVector.invalidationHash,
    deterministicNotes: ['Stable reference to an EngineeringStateSnapshot for provenance/render metadata persistence.'],
  };
}

export function diffEngineeringStateSnapshots(previous: EngineeringStateSnapshot, next: EngineeringStateSnapshot): EngineeringStateSnapshotDiff {
  const previousById = new Map(previous.stateRefs.map(ref => [ref.stateId, ref]));
  const nextById = new Map(next.stateRefs.map(ref => [ref.stateId, ref]));
  const stateIds = sortUnique([...previousById.keys(), ...nextById.keys()]);
  const entries = stateIds.map(stateId => {
    const before = previousById.get(stateId);
    const after = nextById.get(stateId);
    const changedHashFields: EngineeringStateSnapshotDiff['entries'][number]['changedHashFields'] = [];
    const lineageChangedFields: EngineeringStateSnapshotDiff['entries'][number]['lineageChangedFields'] = [];
    let diffType: EngineeringStateSnapshotDiff['entries'][number]['diffType'] = 'unchanged';
    if (!before && after) diffType = 'added';
    else if (before && !after) diffType = 'removed';
    else if (before && after) {
      if (before.generationHash !== after.generationHash) changedHashFields.push('generationHash');
      if (before.provenanceHash !== after.provenanceHash) changedHashFields.push('provenanceHash');
      if (before.dependencyHash !== after.dependencyHash) changedHashFields.push('dependencyHash');
      if (!sameList(before.requirementIds, after.requirementIds)) lineageChangedFields.push('requirementIds');
      if (!sameList(before.decisionIds, after.decisionIds)) lineageChangedFields.push('decisionIds');
      if (!sameList(before.canonicalEvidenceIds, after.canonicalEvidenceIds)) lineageChangedFields.push('canonicalEvidenceIds');
      if (!sameList(before.dependencyNodeIds, after.dependencyNodeIds)) lineageChangedFields.push('dependencyNodeIds');
      if (before.staleStatus !== after.staleStatus) diffType = 'stale_status_changed';
      else if (changedHashFields.length > 0) diffType = 'hash_changed';
      else if (lineageChangedFields.length > 0) diffType = 'lineage_changed';
    }
    return {
      diffId: `state-diff:${previous.snapshotId}->${next.snapshotId}:${stateId}`,
      stateId,
      diffType,
      previousStatus: before?.staleStatus,
      nextStatus: after?.staleStatus,
      changedHashFields,
      lineageChangedFields,
      deterministicReason: reasonForDiff(stateId, diffType, changedHashFields, lineageChangedFields),
    };
  }).filter(entry => entry.diffType !== 'unchanged').sort((a, b) => a.diffId.localeCompare(b.diffId));
  const hashVectorChanges = (Object.keys(next.hashVector) as Array<keyof EngineeringStateHashVector>)
    .filter(key => previous.hashVector[key] !== next.hashVector[key])
    .sort((a, b) => a.localeCompare(b));
  return {
    diffId: `snapshot-diff:${previous.snapshotId}->${next.snapshotId}`,
    previousSnapshotId: previous.snapshotId,
    nextSnapshotId: next.snapshotId,
    previousSnapshotHash: previous.snapshotHash,
    nextSnapshotHash: next.snapshotHash,
    hashVectorChanges,
    entries,
    addedStateIds: entries.filter(entry => entry.diffType === 'added').map(entry => entry.stateId),
    removedStateIds: entries.filter(entry => entry.diffType === 'removed').map(entry => entry.stateId),
    staleStateIds: sortUnique(next.staleStateIds),
    preservedStateIds: next.validStateIds.filter(stateId => previous.validStateIds.includes(stateId)).sort((a, b) => a.localeCompare(b)),
    deterministicHash: stableEngineeringStateHash('engineering-state-diff', [previous.snapshotHash, next.snapshotHash, ...hashVectorChanges, ...entries.map(entry => `${entry.diffId}|${entry.diffType}|${entry.changedHashFields.join(',')}|${entry.lineageChangedFields.join(',')}`)]),
    deterministicNotes: [
      'EngineeringStateSnapshotDiff v1 compares sorted state refs and hash vectors deterministically.',
      'Diff ordering is lexicographic by stable diff id.',
      'Diffing is observational metadata only and does not regenerate stale outputs.',
    ],
  };
}

export function buildEngineeringStateTransitionHistory(input: BuildEngineeringStateTransitionHistoryInput): EngineeringStateTransitionHistory {
  const generatedAt = input.generatedAt ?? input.snapshots[input.snapshots.length - 1]?.generatedAt ?? new Date(0).toISOString();
  const invalidationBySnapshot = new Map((input.invalidationResults ?? []).map(result => [result.generatedAt, result]));
  const events: EngineeringStateTransitionEvent[] = [];
  for (const snapshot of input.snapshots.slice().sort((a, b) => a.snapshotId.localeCompare(b.snapshotId))) {
    events.push(makeTransition('snapshot_created', snapshot, [], `Snapshot ${snapshot.snapshotId} was persisted.`));
    if (snapshot.previousSnapshotId) {
      events.push(makeTransition('snapshot_superseded', snapshot, [], `Snapshot ${snapshot.previousSnapshotId} was superseded by ${snapshot.snapshotId}.`, snapshot.previousSnapshotId));
    }
    const invalidation = invalidationBySnapshot.get(snapshot.generatedAt);
    for (const staleStateId of snapshot.staleStateIds) {
      const invalidationEvent = invalidation?.invalidationEvents.find(event => event.stateId === staleStateId);
      events.push(makeTransition('state_invalidated', snapshot, [staleStateId], invalidationEvent?.invalidationReason ?? `State ${staleStateId} is persisted as stale.`, snapshot.previousSnapshotId, invalidationEvent ? [invalidationEvent.eventId] : []));
    }
  }
  for (const diff of input.diffs ?? []) {
    for (const entry of diff.entries) {
      if (entry.diffType === 'stale_status_changed' && entry.nextStatus === 'current') {
        const snapshot = input.snapshots.find(candidate => candidate.snapshotId === diff.nextSnapshotId);
        if (snapshot) events.push(makeTransition('state_regenerated', snapshot, [entry.stateId], `State ${entry.stateId} returned to current status in snapshot ${snapshot.snapshotId}.`, diff.previousSnapshotId));
      }
      if (entry.diffType === 'hash_changed' && entry.changedHashFields.includes('dependencyHash')) {
        const snapshot = input.snapshots.find(candidate => candidate.snapshotId === diff.nextSnapshotId);
        if (snapshot) events.push(makeTransition('dependency_changed', snapshot, [entry.stateId], `State ${entry.stateId} dependency hash changed.`, diff.previousSnapshotId));
      }
      if (entry.diffType === 'lineage_changed' && entry.lineageChangedFields.includes('decisionIds')) {
        const snapshot = input.snapshots.find(candidate => candidate.snapshotId === diff.nextSnapshotId);
        if (snapshot) events.push(makeTransition('decision_changed', snapshot, [entry.stateId], `State ${entry.stateId} decision lineage changed.`, diff.previousSnapshotId));
      }
    }
    for (const staleStateId of diff.staleStateIds) {
      if (diff.preservedStateIds.includes(staleStateId)) continue;
      const snapshot = input.snapshots.find(candidate => candidate.snapshotId === diff.nextSnapshotId);
      if (snapshot) events.push(makeTransition('stale_state_preserved', snapshot, [staleStateId], `Stale state ${staleStateId} remains persisted for auditability.`, diff.previousSnapshotId));
    }
  }
  const sortedEvents = dedupeById(events).sort((a, b) => a.transitionEventId.localeCompare(b.transitionEventId));
  return {
    historyId: input.historyId,
    generatedAt,
    snapshotIds: input.snapshots.map(snapshot => snapshot.snapshotId).sort((a, b) => a.localeCompare(b)),
    transitionEvents: sortedEvents,
    deterministicHash: stableEngineeringStateHash('engineering-state-transition-history', sortedEvents.map(event => `${event.transitionEventId}|${event.deterministicHash}`)),
    deterministicNotes: [
      'EngineeringStateTransitionHistory v1 persists snapshot, invalidation, regeneration-status, and stale-preservation events.',
      'Transition events are sorted and hashed deterministically for audit timelines.',
      'Transition history is queryable metadata and does not autonomously regenerate outputs.',
    ],
  };
}

export function buildEngineeringStateTimeline(history: EngineeringStateTransitionHistory, snapshots: EngineeringStateSnapshot[]): EngineeringStateTimeline {
  const sortedSnapshots = snapshots.slice().sort((a, b) => a.snapshotId.localeCompare(b.snapshotId));
  const latest = sortedSnapshots[sortedSnapshots.length - 1];
  const latestValid = sortedSnapshots.slice().reverse().find(snapshot => snapshot.staleStateIds.length === 0);
  return {
    timelineId: `${history.historyId}.timeline`,
    latestSnapshotId: latest?.snapshotId,
    latestValidSnapshotId: latestValid?.snapshotId,
    staleStateIds: sortUnique(sortedSnapshots.flatMap(snapshot => snapshot.staleStateIds)),
    transitionEventIds: history.transitionEvents.map(event => event.transitionEventId),
    deterministicHash: stableEngineeringStateHash('engineering-state-timeline', [history.deterministicHash, latest?.snapshotHash, latestValid?.snapshotHash]),
    deterministicNotes: ['EngineeringStateTimeline exposes deterministic query metadata for latest valid state, stale outputs, and transition ids.'],
  };
}

export const latestValidStateSnapshot = (snapshots: EngineeringStateSnapshot[]): EngineeringStateSnapshot | null =>
  snapshots.slice().sort((a, b) => b.snapshotId.localeCompare(a.snapshotId)).find(snapshot => snapshot.staleStateIds.length === 0) ?? null;
export const listStaleEngineeringOutputs = (snapshot: EngineeringStateSnapshot): string[] => sortUnique(snapshot.staleStateIds);
export const invalidationHistoryForState = (history: EngineeringStateTransitionHistory, stateId: string): EngineeringStateTransitionEvent[] =>
  history.transitionEvents.filter(event => event.eventType === 'state_invalidated' && event.stateIds.includes(stateId));
export const dependencyLineageForState = (snapshot: EngineeringStateSnapshot, stateId: string): string[] =>
  sortUnique(snapshot.stateRefs.find(ref => ref.stateId === stateId)?.dependencyNodeIds ?? []);
export const regenerationHistoryForState = (history: EngineeringStateTransitionHistory, stateId: string): EngineeringStateTransitionEvent[] =>
  history.transitionEvents.filter(event => event.eventType === 'state_regenerated' && event.stateIds.includes(stateId));
export const decisionEvolutionForState = (snapshots: EngineeringStateSnapshot[], stateId: string): string[][] =>
  snapshots.slice().sort((a, b) => a.snapshotId.localeCompare(b.snapshotId)).map(snapshot => sortUnique(snapshot.stateRefs.find(ref => ref.stateId === stateId)?.decisionIds ?? []));
export const requirementEvolutionForState = (snapshots: EngineeringStateSnapshot[], stateId: string): string[][] =>
  snapshots.slice().sort((a, b) => a.snapshotId.localeCompare(b.snapshotId)).map(snapshot => sortUnique(snapshot.stateRefs.find(ref => ref.stateId === stateId)?.requirementIds ?? []));
export const snapshotAncestry = (snapshot: EngineeringStateSnapshot, snapshots: EngineeringStateSnapshot[]): string[] => {
  const byId = new Map(snapshots.map(candidate => [candidate.snapshotId, candidate]));
  const ancestry: string[] = [];
  let current: EngineeringStateSnapshot | undefined = snapshot;
  while (current?.previousSnapshotId) {
    ancestry.push(current.previousSnapshotId);
    current = byId.get(current.previousSnapshotId);
  }
  return ancestry;
};

function makeTransition(eventType: EngineeringStateTransitionEventType, snapshot: EngineeringStateSnapshot, stateIds: string[], reason: string, previousSnapshotId?: string, invalidationEventIds: string[] = []): EngineeringStateTransitionEvent {
  const refs = snapshot.stateRefs.filter(ref => stateIds.length === 0 || stateIds.includes(ref.stateId));
  const transitionEventId = `transition:${snapshot.snapshotId}:${eventType}:${stateIds.join('+') || 'snapshot'}`;
  return {
    transitionEventId,
    eventType,
    occurredAt: snapshot.generatedAt,
    snapshotId: snapshot.snapshotId,
    previousSnapshotId,
    stateIds: sortUnique(stateIds),
    dependencyNodeIds: sortUnique(refs.flatMap(ref => ref.dependencyNodeIds)),
    requirementIds: sortUnique(refs.flatMap(ref => ref.requirementIds)) as any,
    decisionIds: sortUnique(refs.flatMap(ref => ref.decisionIds)),
    canonicalEvidenceIds: sortUnique(refs.flatMap(ref => ref.canonicalEvidenceIds)),
    invalidationEventIds: sortUnique(invalidationEventIds),
    deterministicReason: reason,
    deterministicHash: stableEngineeringStateHash('engineering-state-transition', [transitionEventId, eventType, snapshot.snapshotHash, previousSnapshotId, ...stateIds, reason]),
  };
}

function putEdge(edges: Map<string, PersistentEngineeringStateGraphEdge>, edge: PersistentEngineeringStateGraphEdge): void {
  edges.set(edge.edgeId, edge);
}
function sortUnique<T extends string>(values: T[]): T[] { return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b)); }
function sameList(a: string[], b: string[]): boolean { return sortUnique(a).join('\n') === sortUnique(b).join('\n'); }
function dedupeById<T extends { transitionEventId: string }>(events: T[]): T[] { return Array.from(new Map(events.map(event => [event.transitionEventId, event])).values()); }
function reasonForDiff(stateId: string, diffType: string, hashFields: string[], lineageFields: string[]): string {
  if (diffType === 'added') return `State ${stateId} was added in the next snapshot.`;
  if (diffType === 'removed') return `State ${stateId} was removed from the next snapshot.`;
  if (diffType === 'stale_status_changed') return `State ${stateId} stale status changed.`;
  if (diffType === 'hash_changed') return `State ${stateId} hash fields changed: ${hashFields.join(', ')}.`;
  if (diffType === 'lineage_changed') return `State ${stateId} lineage fields changed: ${lineageFields.join(', ')}.`;
  return `State ${stateId} is unchanged.`;
}
