import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { EngineeringDependencyGraph } from '@/lib/documentProvenance';
import type {
  EngineeringInvalidationResult,
  EngineeringInvalidationTrigger,
  EngineeringStateRecord,
  EngineeringStateRegistry,
  EngineeringStateSnapshot,
  PersistentEngineeringStateGraph,
} from '@/lib/engineeringStateInvalidation';
import { sortBy, sortText, tracePropagation, type EngineeringStaleClass, type PropagationTraversalPath, type PropagationTraversalResult } from './propagationGraph';

export interface EngineeringInvalidationPropagationInput {
  propagationId: string;
  registry?: EngineeringStateRegistry | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  trigger?: EngineeringInvalidationTrigger | null;
  dependencyGraph?: EngineeringDependencyGraph | null;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  snapshots?: EngineeringStateSnapshot[] | null;
  cadReadiness?: CADReadinessMetadataModel | null;
  maxDepth?: number;
  traversalLimit?: number;
}

export interface EngineeringAffectedOutputImpact {
  impactId: string;
  stateId: string;
  outputId: string;
  outputType: string;
  staleClass: EngineeringStaleClass;
  affectedDocumentSectionIds: string[];
  affectedRenderContextIds: string[];
  affectedSnapshotIds: string[];
  invalidatedDecisionIds: string[];
  missingEvidenceIds: string[];
  dependencyNodeIds: string[];
  propagationPathIds: string[];
  deterministicReason: string;
}

export interface EngineeringInvalidatedDecisionImpact {
  decisionId: string;
  staleClass: EngineeringStaleClass;
  affectedStateIds: string[];
  affectedOutputIds: string[];
  propagationPathIds: string[];
  deterministicReason: string;
}

export interface EngineeringInvalidationPropagationResult {
  propagationId: string;
  triggerId: string | null;
  triggerType: string | null;
  staleClassCounts: Record<EngineeringStaleClass, number>;
  sourceNodeIds: string[];
  affectedStateIds: string[];
  preservedStateIds: string[];
  affectedOutputs: EngineeringAffectedOutputImpact[];
  invalidatedDecisions: EngineeringInvalidatedDecisionImpact[];
  affectedDocumentSectionIds: string[];
  affectedRenderContextIds: string[];
  affectedSnapshotIds: string[];
  affectedSnapshotStateIds: string[];
  traversal: PropagationTraversalResult;
  propagationPaths: PropagationTraversalPath[];
  cycleProtection: {
    cycleDetected: boolean;
    truncated: boolean;
    maxDepth: number;
    traversalLimit: number;
    duplicateEdgeIdsSuppressed: string[];
    missingNodeIds: string[];
  };
  missingEvidenceIds: string[];
  cadReadinessTransitionIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export function computeEngineeringInvalidationPropagation(input: EngineeringInvalidationPropagationInput): EngineeringInvalidationPropagationResult {
  const trigger = input.invalidationResult?.trigger ?? input.trigger ?? null;
  const registryRecords = input.registry?.stateRecords ?? input.invalidationResult?.updatedStateRecords ?? [];
  const sourceNodeIds = trigger ? seedNodeIdsFromTrigger(trigger) : [];
  const traversal = tracePropagation({
    traversalId: `${input.propagationId}:traversal`,
    seedNodeIds: sourceNodeIds,
    direction: 'downstream',
    dependencyGraph: input.dependencyGraph,
    persistentGraph: input.persistentGraph,
    maxDepth: input.maxDepth,
    traversalLimit: input.traversalLimit,
  });
  const affectedStateIds = sortText(input.invalidationResult?.affectedStateIds ?? registryRecords.filter(record => record.staleStatus !== 'current').map(record => record.stateId));
  const affectedRecords = sortBy(registryRecords.filter(record => affectedStateIds.includes(record.stateId) || record.staleStatus !== 'current'), record => record.stateId);
  const preservedStateIds = sortText(input.invalidationResult?.unaffectedStateIds ?? registryRecords.filter(record => record.staleStatus === 'current').map(record => record.stateId));
  const snapshots = input.snapshots ?? [];
  const pathIdsByNode = pathIdLookup(traversal.paths);

  const affectedOutputs = affectedRecords.map(record => outputImpactForRecord(record, snapshots, pathIdsByNode));
  const affectedDocumentSectionIds = sortText(affectedOutputs.flatMap(output => output.affectedDocumentSectionIds));
  const affectedRenderContextIds = sortText(affectedOutputs.flatMap(output => output.affectedRenderContextIds));
  const affectedSnapshotIds = sortText(affectedOutputs.flatMap(output => output.affectedSnapshotIds));
  const affectedSnapshotStateIds = sortText(snapshots.flatMap(snapshot => snapshot.stateRefs.filter(ref => affectedStateIds.includes(ref.stateId)).map(ref => `${snapshot.snapshotId}:${ref.stateId}`)));
  const missingEvidenceIds = sortText(affectedOutputs.flatMap(output => output.missingEvidenceIds));
  const invalidatedDecisions = invalidatedDecisionImpacts(affectedRecords, affectedOutputs, pathIdsByNode);
  const cadReadinessTransitionIds = sortText((input.cadReadiness?.flags ?? [])
    .filter(flag => flag.status === 'partial' || flag.status === 'blocked')
    .map(flag => flag.flagId));
  const staleClassCounts = countStaleClasses(registryRecords, affectedRecords.length > 0 || !!trigger);
  const deterministicHash = stableHash([
    input.propagationId,
    trigger?.triggerId,
    ...affectedStateIds,
    ...preservedStateIds,
    ...affectedDocumentSectionIds,
    ...affectedRenderContextIds,
    ...affectedSnapshotIds,
    ...traversal.paths.map(path => path.pathId),
    String(traversal.cycleDetected),
    String(traversal.truncated),
  ]);

  return {
    propagationId: input.propagationId,
    triggerId: trigger?.triggerId ?? null,
    triggerType: trigger?.triggerType ?? null,
    staleClassCounts,
    sourceNodeIds,
    affectedStateIds,
    preservedStateIds,
    affectedOutputs,
    invalidatedDecisions,
    affectedDocumentSectionIds,
    affectedRenderContextIds,
    affectedSnapshotIds,
    affectedSnapshotStateIds,
    traversal,
    propagationPaths: traversal.paths,
    cycleProtection: {
      cycleDetected: traversal.cycleDetected,
      truncated: traversal.truncated,
      maxDepth: traversal.maxDepth,
      traversalLimit: traversal.traversalLimit,
      duplicateEdgeIdsSuppressed: traversal.duplicateEdgeIdsSuppressed,
      missingNodeIds: traversal.missingNodeIds,
    },
    missingEvidenceIds,
    cadReadinessTransitionIds,
    deterministicHash,
    deterministicNotes: [
      trigger
        ? `Propagation is derived from explicit trigger ${trigger.triggerId}; no autonomous evidence change detection is performed.`
        : 'No invalidation trigger was supplied; propagation remains explicit not_loaded metadata.',
      'Affected outputs are derived from existing engineering state records, snapshots, and graph metadata only.',
      'No OCR, CV, image-byte parsing, geometry inference, CAD generation, engineering decision generation, or autonomous regeneration is performed.',
    ],
  };
}

export function staleClassForRecord(record: EngineeringStateRecord | null | undefined, affected = false): EngineeringStaleClass {
  if (!record) return 'NOT_LOADED';
  if (record.staleStatus === 'blocked') return 'BLOCKED';
  if (record.staleStatus === 'stale') return 'STALE';
  if (record.staleStatus === 'unknown') return 'REQUIRES_REVIEW';
  if (affected) return 'INVALIDATED';
  if (record.dependencyNodeIds.length === 0 && record.canonicalEvidenceIds.length === 0 && record.requirementIds.length === 0) return 'PARTIAL';
  return 'VALID';
}

function seedNodeIdsFromTrigger(trigger: EngineeringInvalidationTrigger): string[] {
  return sortText([
    ...trigger.changedDependencyNodeIds,
    ...trigger.changedCanonicalEvidenceIds.map(id => `canonicalEvidence:${id}`),
    ...trigger.changedRequirementIds.map(id => `requirement:${id}`),
    ...trigger.changedDecisionIds,
  ]);
}

function outputImpactForRecord(record: EngineeringStateRecord, snapshots: EngineeringStateSnapshot[], pathIdsByNode: Map<string, string[]>): EngineeringAffectedOutputImpact {
  const outputId = record.renderContextId ?? record.stateId;
  const affectedSnapshotIds = sortText(snapshots.filter(snapshot => snapshot.stateRefs.some(ref => ref.stateId === record.stateId)).map(snapshot => snapshot.snapshotId));
  const pathIds = sortText([
    ...(pathIdsByNode.get(record.stateId) ?? []),
    ...(pathIdsByNode.get(`stateGraphNode:${record.stateId}`) ?? []),
    ...record.dependencyNodeIds.flatMap(id => pathIdsByNode.get(id) ?? []),
  ]);
  const affectedDocumentSectionIds = record.stateType === 'document_section' ? [record.stateId] : [];
  const affectedRenderContextIds = record.renderContextId ? [record.renderContextId] : record.stateType === 'render_context' ? [record.stateId] : [];
  return {
    impactId: `impact:${record.stateId}`,
    stateId: record.stateId,
    outputId,
    outputType: record.stateType,
    staleClass: staleClassForRecord(record, true),
    affectedDocumentSectionIds,
    affectedRenderContextIds,
    affectedSnapshotIds,
    invalidatedDecisionIds: sortText(record.decisionIds),
    missingEvidenceIds: record.canonicalEvidenceIds.length ? [] : sortText(record.requirementIds.map(id => `missingEvidenceForRequirement:${id}`)),
    dependencyNodeIds: sortText(record.dependencyNodeIds),
    propagationPathIds: pathIds,
    deterministicReason: `State ${record.stateId} is included because existing invalidation/state metadata marks it affected or non-current.`,
  };
}

function invalidatedDecisionImpacts(records: EngineeringStateRecord[], outputs: EngineeringAffectedOutputImpact[], pathIdsByNode: Map<string, string[]>): EngineeringInvalidatedDecisionImpact[] {
  const decisionIds = sortText(records.flatMap(record => record.decisionIds));
  return decisionIds.map(decisionId => {
    const linkedRecords = records.filter(record => record.decisionIds.includes(decisionId));
    const linkedOutputs = outputs.filter(output => linkedRecords.some(record => record.stateId === output.stateId));
    return {
      decisionId,
      staleClass: 'REQUIRES_REVIEW',
      affectedStateIds: sortText(linkedRecords.map(record => record.stateId)),
      affectedOutputIds: sortText(linkedOutputs.map(output => output.outputId)),
      propagationPathIds: sortText([...(pathIdsByNode.get(decisionId) ?? []), ...linkedOutputs.flatMap(output => output.propagationPathIds)]),
      deterministicReason: `Decision ${decisionId} is linked to affected state records and requires deterministic review before any regeneration.`,
    };
  });
}

function pathIdLookup(paths: PropagationTraversalPath[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const path of paths) {
    for (const nodeId of path.nodeIds) lookup.set(nodeId, sortText([...(lookup.get(nodeId) ?? []), path.pathId]));
  }
  return lookup;
}

function countStaleClasses(allRecords: EngineeringStateRecord[], hasTrigger: boolean): Record<EngineeringStaleClass, number> {
  const counts: Record<EngineeringStaleClass, number> = {
    VALID: 0,
    PARTIAL: 0,
    STALE: 0,
    INVALIDATED: 0,
    BLOCKED: 0,
    NOT_LOADED: allRecords.length ? 0 : 1,
    REQUIRES_REVIEW: hasTrigger ? 0 : 1,
  };
  for (const record of allRecords) counts[staleClassForRecord(record)] += 1;
  return counts;
}

function stableHash(values: Array<string | number | boolean | null | undefined>): string {
  const payload = sortText(Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).length > 0).map(String)))).join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `invalidation-propagation-v1-${hash.toString(16).padStart(8, '0')}`;
}
