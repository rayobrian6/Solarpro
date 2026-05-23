import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { EngineeringStateSnapshot, EngineeringStateSnapshotDiff, PersistentEngineeringStateGraph } from '@/lib/engineeringStateInvalidation';
import type { EngineeringInvalidationPropagationResult } from './invalidationEngine';
import type { EngineeringStaleClass } from './propagationGraph';
import { sortBy, sortText } from './propagationGraph';

export type EngineeringSnapshotDeltaTypeV1 =
  | 'added_evidence'
  | 'removed_evidence'
  | 'changed_decision'
  | 'stale_output_introduced'
  | 'regenerated_candidate'
  | 'invalidation_cause'
  | 'changed_cad_readiness'
  | 'dependency_graph_delta'
  | 'snapshot_not_loaded';

export interface EngineeringSnapshotDeltaEntryV1 {
  deltaId: string;
  deltaType: EngineeringSnapshotDeltaTypeV1;
  previousId: string | null;
  nextId: string | null;
  previousStatus: string | null;
  nextStatus: string | null;
  relatedEvidenceIds: string[];
  requirementIds: string[];
  decisionIds: string[];
  stateIds: string[];
  outputIds: string[];
  graphNodeIds: string[];
  graphEdgeIds: string[];
  staleClass: EngineeringStaleClass;
  deterministicReason: string;
}

export interface EngineeringSnapshotDeltaV1 {
  deltaId: string;
  previousSnapshotId: string | null;
  nextSnapshotId: string | null;
  entries: EngineeringSnapshotDeltaEntryV1[];
  addedEvidenceIds: string[];
  removedEvidenceIds: string[];
  changedDecisionIds: string[];
  staleOutputsIntroduced: string[];
  regeneratedCandidateIds: string[];
  invalidationCauseIds: string[];
  changedCADReadinessIds: string[];
  dependencyGraphDeltaIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface BuildEngineeringSnapshotDeltaV1Input {
  deltaId: string;
  previousSnapshot?: EngineeringStateSnapshot | null;
  nextSnapshot?: EngineeringStateSnapshot | null;
  snapshotDiffs?: EngineeringStateSnapshotDiff[] | null;
  previousGraph?: PersistentEngineeringStateGraph | null;
  nextGraph?: PersistentEngineeringStateGraph | null;
  propagation?: EngineeringInvalidationPropagationResult | null;
  cadReadiness?: CADReadinessMetadataModel | null;
}

export function buildEngineeringSnapshotDeltaV1(input: BuildEngineeringSnapshotDeltaV1Input): EngineeringSnapshotDeltaV1 {
  const previous = input.previousSnapshot ?? null;
  const next = input.nextSnapshot ?? null;
  if (!previous || !next) return notLoadedDelta(input.deltaId, previous, next);

  const previousEvidence = new Set(previous.stateRefs.flatMap(ref => ref.canonicalEvidenceIds));
  const nextEvidence = new Set(next.stateRefs.flatMap(ref => ref.canonicalEvidenceIds));
  const addedEvidenceIds = sortText([...nextEvidence].filter(id => !previousEvidence.has(id)));
  const removedEvidenceIds = sortText([...previousEvidence].filter(id => !nextEvidence.has(id)));
  const previousDecisions = new Set(previous.stateRefs.flatMap(ref => ref.decisionIds));
  const nextDecisions = new Set(next.stateRefs.flatMap(ref => ref.decisionIds));
  const changedDecisionIds = sortText([...new Set([...previousDecisions, ...nextDecisions])].filter(id => !previousDecisions.has(id) || !nextDecisions.has(id)));
  const staleOutputsIntroduced = sortText(next.staleStateIds.filter(id => !previous.staleStateIds.includes(id)));
  const regeneratedCandidateIds = sortText(input.propagation?.affectedStateIds ?? []);
  const invalidationCauseIds = sortText(input.propagation?.sourceNodeIds ?? []);
  const changedCADReadinessIds = sortText((input.cadReadiness?.flags ?? []).filter(flag => flag.status === 'partial' || flag.status === 'blocked').map(flag => flag.flagId));
  const dependencyGraphDeltaIds = computeDependencyGraphDeltaIds(input.previousGraph ?? null, input.nextGraph ?? null);
  const entries = sortBy([
    ...addedEvidenceIds.map(id => entry(input.deltaId, 'added_evidence', null, id, [id], [], [], [], [], [], [], 'PARTIAL', `Canonical evidence ${id} appears in the next snapshot only.`)),
    ...removedEvidenceIds.map(id => entry(input.deltaId, 'removed_evidence', id, null, [id], [], [], [], [], [], [], 'REQUIRES_REVIEW', `Canonical evidence ${id} appears in the previous snapshot only.`)),
    ...changedDecisionIds.map(id => entry(input.deltaId, 'changed_decision', id, id, [], [], [id], [], [], [], [], 'REQUIRES_REVIEW', `Decision ${id} membership changed between snapshots.`)),
    ...staleOutputsIntroduced.map(id => entry(input.deltaId, 'stale_output_introduced', id, id, [], [], [], [id], [id], [], [], 'STALE', `State ${id} is stale in the next snapshot and was not stale in the previous snapshot.`)),
    ...regeneratedCandidateIds.map(id => entry(input.deltaId, 'regenerated_candidate', id, id, [], [], [], [id], [id], [], [], 'INVALIDATED', `State ${id} is a metadata-only regeneration candidate from propagation output.`)),
    ...invalidationCauseIds.map(id => entry(input.deltaId, 'invalidation_cause', id, id, id.startsWith('canonicalEvidence:') ? [id.replace('canonicalEvidence:', '')] : [], id.startsWith('requirement:') ? [id.replace('requirement:', '')] : [], [], [], [], [id], [], 'REQUIRES_REVIEW', `Graph node ${id} is an explicit invalidation source.`)),
    ...changedCADReadinessIds.map(id => entry(input.deltaId, 'changed_cad_readiness', id, id, [], [], [], [], [], [id], [], 'PARTIAL', `CAD readiness flag ${id} is partial or blocked metadata and may affect review scope.`)),
    ...dependencyGraphDeltaIds.map(id => entry(input.deltaId, 'dependency_graph_delta', id, id, [], [], [], [], [], [id], [id], 'REQUIRES_REVIEW', `Dependency graph structural id ${id} differs between compared graph metadata.`)),
  ], item => item.deltaId);
  const deterministicHash = stableHash([
    input.deltaId,
    previous.snapshotId,
    next.snapshotId,
    ...entries.map(item => item.deltaId),
  ]);

  return {
    deltaId: input.deltaId,
    previousSnapshotId: previous.snapshotId,
    nextSnapshotId: next.snapshotId,
    entries,
    addedEvidenceIds,
    removedEvidenceIds,
    changedDecisionIds,
    staleOutputsIntroduced,
    regeneratedCandidateIds,
    invalidationCauseIds,
    changedCADReadinessIds,
    dependencyGraphDeltaIds,
    deterministicHash,
    deterministicNotes: [
      'Snapshot Delta V1 compares explicit snapshot refs, graph ids, propagation metadata, and CAD-readiness metadata only.',
      'No semantic diffing, OCR, image-byte inspection, geometry inference, CAD generation, or autonomous engineering evaluation is performed.',
      'Missing previous/next snapshots are reported as not-loaded metadata rather than synthesized.',
    ],
  };
}

function notLoadedDelta(deltaId: string, previous: EngineeringStateSnapshot | null, next: EngineeringStateSnapshot | null): EngineeringSnapshotDeltaV1 {
  const entries = [entry(deltaId, 'snapshot_not_loaded', previous?.snapshotId ?? null, next?.snapshotId ?? null, [], [], [], [], [], [], [], 'NOT_LOADED', 'Previous or next snapshot was not supplied; delta remains explicit not_loaded metadata.')];
  return {
    deltaId,
    previousSnapshotId: previous?.snapshotId ?? null,
    nextSnapshotId: next?.snapshotId ?? null,
    entries,
    addedEvidenceIds: [],
    removedEvidenceIds: [],
    changedDecisionIds: [],
    staleOutputsIntroduced: [],
    regeneratedCandidateIds: [],
    invalidationCauseIds: [],
    changedCADReadinessIds: [],
    dependencyGraphDeltaIds: [],
    deterministicHash: stableHash([deltaId, 'snapshot_not_loaded', previous?.snapshotId, next?.snapshotId]),
    deterministicNotes: ['Snapshot Delta V1 could not compare because one or both snapshots were not loaded.'],
  };
}

function computeDependencyGraphDeltaIds(previous: PersistentEngineeringStateGraph | null, next: PersistentEngineeringStateGraph | null): string[] {
  if (!previous || !next) return [];
  const previousIds = new Set([...previous.nodes.map(node => node.nodeId), ...previous.edges.map(edge => edge.edgeId)]);
  const nextIds = new Set([...next.nodes.map(node => node.nodeId), ...next.edges.map(edge => edge.edgeId)]);
  return sortText([...new Set([...previousIds, ...nextIds])].filter(id => !previousIds.has(id) || !nextIds.has(id)));
}

function entry(
  baseId: string,
  deltaType: EngineeringSnapshotDeltaTypeV1,
  previousId: string | null,
  nextId: string | null,
  relatedEvidenceIds: string[],
  requirementIds: string[],
  decisionIds: string[],
  stateIds: string[],
  outputIds: string[],
  graphNodeIds: string[],
  graphEdgeIds: string[],
  staleClass: EngineeringStaleClass,
  deterministicReason: string,
): EngineeringSnapshotDeltaEntryV1 {
  const idKey = nextId ?? previousId ?? 'not_loaded';
  return {
    deltaId: `${baseId}:${deltaType}:${sanitize(idKey)}`,
    deltaType,
    previousId,
    nextId,
    previousStatus: previousId ? 'loaded' : null,
    nextStatus: nextId ? 'loaded' : null,
    relatedEvidenceIds: sortText(relatedEvidenceIds),
    requirementIds: sortText(requirementIds),
    decisionIds: sortText(decisionIds),
    stateIds: sortText(stateIds),
    outputIds: sortText(outputIds),
    graphNodeIds: sortText(graphNodeIds),
    graphEdgeIds: sortText(graphEdgeIds),
    staleClass,
    deterministicReason,
  };
}

function stableHash(values: Array<string | number | boolean | null | undefined>): string {
  const payload = sortText(Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).length > 0).map(String)))).join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `snapshot-delta-v1-${hash.toString(16).padStart(8, '0')}`;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 96);
}
