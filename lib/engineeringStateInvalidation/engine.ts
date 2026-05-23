import type { DocumentProvenanceBundle, DocumentProvenanceSection, EngineeringDependencyGraph, EngineeringDependencyNode } from '@/lib/documentProvenance';
import type { EngineeringDecisionEvaluationBundle, EngineeringDecisionProvenanceRecord } from '@/lib/engineeringDecisionProvenance';
import { runEngineeringStateAuditGuards } from './guards';
import type {
  BuildEngineeringStateRegistryInput,
  BuildSelectiveRegenerationPlanInput,
  EngineeringGenerationInputs,
  EngineeringInvalidationEvent,
  EngineeringInvalidationLineageMetadata,
  EngineeringInvalidationResult,
  EngineeringInvalidationTrigger,
  EngineeringStateCategory,
  EngineeringStateRecord,
  EngineeringStateRegistry,
  EngineeringStateType,
  EngineeringStaleStateMetadata,
  InvalidateEngineeringStateInput,
  SelectiveRegenerationPlan,
} from './types';

const EMPTY_INPUTS: EngineeringGenerationInputs = { inputKeys: [], canonicalInputKeys: [], cadPrimitiveIds: [], legacyFallbackKeys: [], deterministicSources: [] };

export function buildEngineeringStateRegistry(input: BuildEngineeringStateRegistryInput): EngineeringStateRegistry {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const documentProvenance = input.documentProvenance ?? null;
  const decisionProvenance = input.decisionProvenance ?? documentProvenance?.decisionProvenance ?? null;
  const graph = input.dependencyGraph ?? documentProvenance?.dependencyGraph ?? null;
  const records: EngineeringStateRecord[] = [
    ...stateFromSections(documentProvenance, decisionProvenance, generatedAt),
    ...stateFromGraphNodes(graph, generatedAt),
    ...stateFromDecisions(decisionProvenance, generatedAt),
    ...stateFromRenderContexts(input.renderContextIds?.length ? input.renderContextIds : ['renderContext:primary'], documentProvenance, decisionProvenance, graph, generatedAt),
    ...stateFromBOM(input.bomMetadata ?? [], decisionProvenance, documentProvenance, generatedAt),
    ...stateFromSLD(input.sldMetadata ?? null, decisionProvenance, documentProvenance, generatedAt),
  ].sort((a, b) => a.stateId.localeCompare(b.stateId));
  const registry: EngineeringStateRegistry = {
    registryId: input.registryId,
    generatedAt,
    stateRecords: records,
    stateIds: records.map(record => record.stateId),
    generationHash: stableHash('state-generation', records.map(record => `${record.stateId}|${record.generationHash}`)),
    provenanceHash: stableHash('state-provenance', records.map(record => `${record.stateId}|${record.provenanceHash}`)),
    dependencyHash: stableHash('state-dependency', records.map(record => `${record.stateId}|${record.dependencyHash}`)),
    deterministicHash: stableHash('state-registry', records.map(record => `${record.stateId}|${record.generationHash}|${record.provenanceHash}|${record.dependencyHash}|${record.staleStatus}`)),
    deterministicNotes: [
      'EngineeringStateRegistry v1 tracks generated engineering outputs as deterministic state records.',
      'State records are derived from canonical evidence, requirements, decision provenance, document provenance, and dependency graph ids only.',
      'Raw uploads are not generation truth and are intentionally excluded from state hashes.',
    ],
    auditGuards: [],
  };
  registry.auditGuards = runEngineeringStateAuditGuards({ records, renderOutputExpected: false });
  return registry;
}

export function invalidateEngineeringState(input: InvalidateEngineeringStateInput): EngineeringInvalidationResult {
  const generatedAt = input.generatedAt ?? input.trigger.triggeredAt ?? new Date(0).toISOString();
  const graph = input.dependencyGraph ?? null;
  const reachable = reachableDependencyIds(input.trigger, graph);
  const events: EngineeringInvalidationEvent[] = [];
  const affected = new Set<string>();
  const updated = input.registry.stateRecords.map(record => {
    const triggers = matchingTriggers(record, input.trigger, reachable);
    if (triggers.length === 0) return record;
    affected.add(record.stateId);
    const event: EngineeringInvalidationEvent = {
      eventId: `invalidation:${input.trigger.triggerId}:${record.stateId}`,
      stateId: record.stateId,
      staleStatus: blockedStatus(record),
      invalidationReason: `State ${record.stateId} depends on changed ${triggers.join(', ')}.`,
      triggeringDependencyIds: uniqueSorted([...reachable].filter(id => record.dependencyNodeIds.includes(id))),
      triggeringRequirementIds: uniqueSorted(input.trigger.changedRequirementIds.filter(id => record.requirementIds.includes(id))) as any,
      triggeringDecisionIds: uniqueSorted(input.trigger.changedDecisionIds.filter(id => record.decisionIds.includes(id))),
      triggeringCanonicalEvidenceIds: uniqueSorted(input.trigger.changedCanonicalEvidenceIds.filter(id => record.canonicalEvidenceIds.includes(id))),
      impactedDownstreamStateIds: [],
      lastValidGenerationHash: record.generationHash,
      lastValidProvenanceHash: record.provenanceHash,
      invalidatedAt: generatedAt,
      deterministicNotes: ['Invalidation is propagated from explicit trigger ids and dependency graph edges; no heuristic matching is used.'],
    };
    events.push(event);
    return { ...record, staleStatus: event.staleStatus, invalidationReason: event.invalidationReason, invalidatedAt: generatedAt } satisfies EngineeringStateRecord;
  });
  const affectedIds = uniqueSorted([...affected]);
  for (const event of events) event.impactedDownstreamStateIds = affectedIds.filter(id => id !== event.stateId);
  const result: EngineeringInvalidationResult = {
    resultId: input.resultId,
    generatedAt,
    trigger: input.trigger,
    affectedStateIds: affectedIds,
    unaffectedStateIds: input.registry.stateIds.filter(id => !affected.has(id)).sort((a, b) => a.localeCompare(b)),
    invalidationEvents: events.sort((a, b) => a.eventId.localeCompare(b.eventId)),
    updatedStateRecords: updated.sort((a, b) => a.stateId.localeCompare(b.stateId)),
    deterministicHash: stableHash('invalidation-result', [...affectedIds, ...events.map(event => `${event.eventId}|${event.invalidationReason}`)]),
    deterministicNotes: ['Invalidation result marks stale state only; it does not regenerate outputs.', 'Unrelated state records are preserved when no explicit dependency intersection or graph reachability exists.'],
    auditGuards: [],
  };
  result.auditGuards = runEngineeringStateAuditGuards({ records: result.updatedStateRecords, invalidationResult: result, renderOutputExpected: false });
  return result;
}

export function buildSelectiveRegenerationPlan(input: BuildSelectiveRegenerationPlanInput): SelectiveRegenerationPlan {
  const generatedAt = input.generatedAt ?? input.invalidationResult.generatedAt;
  const stale = input.invalidationResult.updatedStateRecords.filter(record => record.staleStatus !== 'current');
  const byType = (type: EngineeringStateType) => uniqueSorted(stale.filter(record => record.stateType === type).map(record => outputId(record)));
  const blocked = uniqueSorted(stale.filter(record => record.provenanceHash.length === 0 || record.dependencyHash.length === 0 || record.dependencyNodeIds.length === 0).map(record => record.stateId));
  const order = regenerationOrder(stale, input.dependencyGraph ?? null);
  const plan: SelectiveRegenerationPlan = {
    planId: input.planId,
    generatedAt,
    triggerId: input.invalidationResult.trigger.triggerId,
    affectedDocumentSections: uniqueSorted([...byType('document_section'), ...byType('render_output')]),
    affectedEngineeringDecisions: byType('decision_provenance'),
    affectedRenderContexts: byType('render_context'),
    affectedBOMRows: byType('bom_row'),
    affectedSLDSections: byType('sld_section'),
    affectedLayoutPrimitives: byType('layout_primitive'),
    blockedRegenerationDependencies: blocked,
    regenerationOrder: order,
    unchangedPreservedOutputs: input.invalidationResult.unaffectedStateIds,
    staleStateIds: input.invalidationResult.affectedStateIds,
    deterministicHash: stableHash('regeneration-plan', [...order, ...blocked, ...input.invalidationResult.unaffectedStateIds]),
    deterministicNotes: ['SelectiveRegenerationPlan v1 is a bounded plan only; it performs no autonomous regeneration.', 'Regeneration order is sorted by explicit state category precedence and stable state ids.'],
    snapshotReference: input.snapshotReference ?? undefined,
  };
  return plan;
}

export function buildInvalidationTrigger(input: Partial<EngineeringInvalidationTrigger> & Pick<EngineeringInvalidationTrigger, 'triggerId' | 'triggerType'>): EngineeringInvalidationTrigger {
  const triggeredAt = input.triggeredAt ?? new Date(0).toISOString();
  return {
    triggerId: input.triggerId,
    triggerType: input.triggerType,
    changedCanonicalEvidenceIds: uniqueSorted(input.changedCanonicalEvidenceIds ?? []),
    changedRequirementIds: uniqueSorted(input.changedRequirementIds ?? []) as any,
    changedDecisionIds: uniqueSorted(input.changedDecisionIds ?? []),
    changedDependencyNodeIds: uniqueSorted(input.changedDependencyNodeIds ?? []),
    previousHash: input.previousHash,
    nextHash: input.nextHash,
    triggeredAt,
    deterministicReason: input.deterministicReason ?? `Deterministic invalidation trigger ${input.triggerId}.`,
  };
}

export function staleMetadataForState(record: EngineeringStateRecord, events: EngineeringInvalidationEvent[] = []): EngineeringStaleStateMetadata {
  const matched = events.filter(event => event.stateId === record.stateId);
  return {
    staleStatus: record.staleStatus,
    staleReason: record.invalidationReason,
    triggeringDependencyIds: uniqueSorted(matched.flatMap(event => event.triggeringDependencyIds)),
    lastValidGenerationHash: matched[0]?.lastValidGenerationHash ?? record.generationHash,
    impactedDownstreamStateIds: uniqueSorted(matched.flatMap(event => event.impactedDownstreamStateIds)),
    invalidationEventIds: uniqueSorted(matched.map(event => event.eventId)),
  };
}

export function buildInvalidationLineageMetadata(input: { registry: EngineeringStateRegistry; invalidationResult?: EngineeringInvalidationResult | null; regenerationPlan?: SelectiveRegenerationPlan | null; snapshotReference?: import('./types').EngineeringStateSnapshotReference | null }): EngineeringInvalidationLineageMetadata {
  const staleStateIds = input.invalidationResult?.affectedStateIds ?? input.registry.stateRecords.filter(record => record.staleStatus !== 'current').map(record => record.stateId);
  return {
    stateRegistryId: input.registry.registryId,
    stateIds: input.registry.stateIds,
    generationHash: input.registry.generationHash,
    provenanceHash: input.registry.provenanceHash,
    dependencyHash: input.registry.dependencyHash,
    staleStateIds: uniqueSorted(staleStateIds),
    invalidationEventIds: uniqueSorted(input.invalidationResult?.invalidationEvents.map(event => event.eventId) ?? []),
    regenerationPlanId: input.regenerationPlan?.planId,
    snapshotReference: input.snapshotReference ?? input.regenerationPlan?.snapshotReference,
    deterministicNotes: ['Invalidation lineage metadata carries state hashes and stale ids through render/document contexts.'],
  };
}

function stateFromSections(doc: DocumentProvenanceBundle | null, decisions: EngineeringDecisionEvaluationBundle | null, generatedAt: string): EngineeringStateRecord[] {
  if (!doc) return [];
  return doc.sections.map(section => makeRecord({
    stateId: `state:documentSection:${section.sectionId}`,
    stateType: section.sectionId.startsWith('SLD.') ? 'sld_section' : 'document_section',
    stateCategory: categoryFromSection(section.sectionId),
    documentType: section.documentType,
    renderContextId: 'renderContext:primary',
    dependencyNodeIds: section.engineeringDependencyIds,
    requirementIds: section.requirementIds,
    decisionIds: decisionIdsForSection(decisions, section.sectionId),
    canonicalEvidenceIds: section.canonicalEvidenceIds,
    originatingSurveyIds: section.originatingSurveyIds,
    generationInputs: { ...section.renderInputs, deterministicSources: ['document_provenance_bundle_v1', 'engineering_requirement_registry_v1'] },
    truthSource: section.truthSource,
    generatedAt,
    notes: [`Document section ${section.sectionId} state is invalidated only by linked requirement/evidence/decision/dependency changes.`],
  }));
}

function stateFromGraphNodes(graph: EngineeringDependencyGraph | null, generatedAt: string): EngineeringStateRecord[] {
  if (!graph) return [];
  return graph.nodes.map(node => makeRecord({
    stateId: `state:dependencyNode:${node.id}`,
    stateType: typeFromNode(node),
    stateCategory: categoryFromNode(node),
    documentType: 'not_document_bound',
    dependencyNodeIds: [node.id],
    requirementIds: node.requirementIds,
    decisionIds: node.nodeType === 'engineering_decision' || node.nodeType === 'calculation' ? [node.id] : [],
    canonicalEvidenceIds: node.canonicalEvidenceIds,
    originatingSurveyIds: [],
    generationInputs: { ...EMPTY_INPUTS, deterministicSources: ['engineering_dependency_graph_v1'] },
    truthSource: node.truthSource,
    generatedAt,
    notes: [`Dependency graph node ${node.id} is first-class invalidation state.`],
  }));
}

function stateFromDecisions(bundle: EngineeringDecisionEvaluationBundle | null, generatedAt: string): EngineeringStateRecord[] {
  if (!bundle) return [];
  return bundle.decisionRecords.map(decision => makeRecord({
    stateId: `state:decision:${decision.decisionId}`,
    stateType: decision.decisionCategory === 'calculation' ? 'engineering_calculation' : 'decision_provenance',
    stateCategory: categoryFromDecision(decision),
    documentType: 'document_summary',
    renderContextId: decision.renderContextIds[0],
    dependencyNodeIds: decision.dependencyNodeIds,
    requirementIds: decision.requirementIds,
    decisionIds: [decision.decisionId],
    canonicalEvidenceIds: decision.canonicalEvidenceIds,
    originatingSurveyIds: decision.originatingSurveyIds,
    generationInputs: { ...EMPTY_INPUTS, inputKeys: decision.derivedFrom, canonicalInputKeys: decision.canonicalEvidenceIds, deterministicSources: ['engineering_decision_registry_v1'] },
    truthSource: decision.truthSource,
    generatedAt,
    notes: [`Decision ${decision.decisionType} state tracks selected value and deterministic lineage only.`],
  }));
}

function stateFromRenderContexts(ids: string[], doc: DocumentProvenanceBundle | null, decisions: EngineeringDecisionEvaluationBundle | null, graph: EngineeringDependencyGraph | null, generatedAt: string): EngineeringStateRecord[] {
  return uniqueSorted(ids).map(id => makeRecord({
    stateId: `state:renderContext:${id}`,
    stateType: 'render_context',
    stateCategory: 'rendering',
    documentType: 'render_context',
    renderContextId: id,
    dependencyNodeIds: uniqueSorted([id, ...(graph?.nodes.map(node => node.id) ?? []), ...(decisions?.dependencyNodeIds ?? [])]),
    requirementIds: uniqueSorted([...(doc?.requirementIds ?? []), ...(decisions?.requirementIds ?? [])]) as any,
    decisionIds: decisions?.decisionIds ?? [],
    canonicalEvidenceIds: uniqueSorted([...(doc?.canonicalEvidenceIds ?? []), ...(decisions?.canonicalEvidenceIds ?? [])]),
    originatingSurveyIds: uniqueSorted([...(doc?.originatingSurveyIds ?? []), ...(decisions?.originatingSurveyIds ?? [])]),
    generationInputs: { ...(doc?.renderInputs ?? EMPTY_INPUTS), deterministicSources: ['render_context_v1', 'document_provenance_bundle_v1', 'engineering_decision_registry_v1'] },
    truthSource: doc?.truthSource ?? 'legacy_design_input',
    generatedAt,
    notes: ['RenderContext state carries hashes and stale metadata; templates must not manufacture stale state.'],
  }));
}

function stateFromBOM(bom: NonNullable<BuildEngineeringStateRegistryInput['bomMetadata']>, decisions: EngineeringDecisionEvaluationBundle | null, doc: DocumentProvenanceBundle | null, generatedAt: string): EngineeringStateRecord[] {
  return bom.map(row => makeRecord({
    stateId: `state:bomRow:${row.bomRowId}`,
    stateType: 'bom_row',
    stateCategory: 'bom',
    documentType: 'bom',
    renderContextId: 'renderContext:primary',
    dependencyNodeIds: row.dependencyNodeIds,
    requirementIds: uniqueSorted(decisions?.decisionRecords.filter(record => row.decisionIds.includes(record.decisionId)).flatMap(record => record.requirementIds) ?? []) as any,
    decisionIds: row.decisionIds,
    canonicalEvidenceIds: uniqueSorted(decisions?.decisionRecords.filter(record => row.decisionIds.includes(record.decisionId)).flatMap(record => record.canonicalEvidenceIds) ?? []),
    originatingSurveyIds: [],
    generationInputs: { ...EMPTY_INPUTS, inputKeys: row.derivedFrom, deterministicSources: ['decision_aware_bom_metadata_v1'] },
    truthSource: doc?.truthSource ?? 'legacy_design_input',
    generatedAt,
    notes: [`BOM row ${row.bomRowId} is invalidated only by linked BOM decisions and dependencies.`],
  }));
}

function stateFromSLD(sld: BuildEngineeringStateRegistryInput['sldMetadata'], decisions: EngineeringDecisionEvaluationBundle | null, doc: DocumentProvenanceBundle | null, generatedAt: string): EngineeringStateRecord[] {
  if (!sld) return [];
  return [makeRecord({
    stateId: `state:sldSection:${sld.sldMetadataId}`,
    stateType: 'sld_section',
    stateCategory: 'sld',
    documentType: 'single_line_diagram',
    renderContextId: 'renderContext:primary',
    dependencyNodeIds: sld.dependencyNodeIds,
    requirementIds: uniqueSorted(decisions?.decisionRecords.filter(record => sld.decisionIds.includes(record.decisionId)).flatMap(record => record.requirementIds) ?? []) as any,
    decisionIds: sld.decisionIds,
    canonicalEvidenceIds: uniqueSorted(decisions?.decisionRecords.filter(record => sld.decisionIds.includes(record.decisionId)).flatMap(record => record.canonicalEvidenceIds) ?? []),
    originatingSurveyIds: [],
    generationInputs: { ...EMPTY_INPUTS, deterministicSources: ['decision_aware_sld_metadata_v1'] },
    truthSource: doc?.truthSource ?? 'legacy_design_input',
    generatedAt,
    notes: ['SLD metadata state tracks topology/interconnection decision dependencies without regenerating SLD content.'],
  })];
}

type RecordInput = Omit<EngineeringStateRecord, 'generationHash' | 'provenanceHash' | 'dependencyHash' | 'staleStatus' | 'deterministicNotes'> & { generatedAt: string; notes: string[] };
function makeRecord(input: RecordInput): EngineeringStateRecord {
  const base = {
    ...input,
    dependencyNodeIds: uniqueSorted(input.dependencyNodeIds),
    requirementIds: uniqueSorted(input.requirementIds) as any,
    decisionIds: uniqueSorted(input.decisionIds),
    canonicalEvidenceIds: uniqueSorted(input.canonicalEvidenceIds),
    originatingSurveyIds: uniqueSorted(input.originatingSurveyIds),
  };
  return {
    stateId: base.stateId,
    stateType: base.stateType,
    stateCategory: base.stateCategory,
    documentType: base.documentType,
    renderContextId: base.renderContextId,
    dependencyNodeIds: base.dependencyNodeIds,
    requirementIds: base.requirementIds,
    decisionIds: base.decisionIds,
    canonicalEvidenceIds: base.canonicalEvidenceIds,
    originatingSurveyIds: base.originatingSurveyIds,
    generationInputs: normalizeGenerationInputs(base.generationInputs),
    generationHash: stableHash('generation', [base.stateId, base.stateType, ...base.generationInputs.inputKeys, ...base.generationInputs.canonicalInputKeys]),
    provenanceHash: stableHash('provenance', [base.stateId, ...base.requirementIds, ...base.decisionIds, ...base.canonicalEvidenceIds, ...base.originatingSurveyIds]),
    dependencyHash: stableHash('dependency', [base.stateId, ...base.dependencyNodeIds]),
    staleStatus: 'current',
    invalidatedAt: undefined,
    regeneratedAt: base.generatedAt,
    truthSource: base.truthSource,
    deterministicNotes: base.notes,
  };
}

function reachableDependencyIds(trigger: EngineeringInvalidationTrigger, graph: EngineeringDependencyGraph | null): Set<string> {
  const seeds = new Set<string>([
    ...trigger.changedDependencyNodeIds,
    ...trigger.changedCanonicalEvidenceIds.map(id => `canonicalEvidence:${id}`),
    ...trigger.changedRequirementIds.map(id => `requirement:${id}`),
    ...trigger.changedDecisionIds,
  ]);
  const reachable = new Set(seeds);
  if (!graph) return reachable;
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  }
  return reachable;
}

function matchingTriggers(record: EngineeringStateRecord, trigger: EngineeringInvalidationTrigger, reachable: Set<string>): string[] {
  const direct = [
    ...trigger.changedCanonicalEvidenceIds.filter(id => record.canonicalEvidenceIds.includes(id)).map(id => `canonicalEvidence:${id}`),
    ...trigger.changedRequirementIds.filter(id => record.requirementIds.includes(id)).map(id => `requirement:${id}`),
    ...trigger.changedDecisionIds.filter(id => record.decisionIds.includes(id)),
    ...trigger.changedDependencyNodeIds.filter(id => record.dependencyNodeIds.includes(id)),
  ];
  if (['decision_provenance', 'engineering_calculation', 'requirement_evaluation'].includes(record.stateType)) {
    return uniqueSorted(direct);
  }
  const propagated = record.dependencyNodeIds.filter(id => reachable.has(id) && !id.startsWith('renderContext:'));
  return uniqueSorted([...direct, ...propagated]);
}

function blockedStatus(record: EngineeringStateRecord): 'stale' | 'blocked' {
  return record.dependencyNodeIds.length === 0 || record.provenanceHash.length === 0 ? 'blocked' : 'stale';
}
function outputId(record: EngineeringStateRecord): string { return record.stateId.replace(/^state:(documentSection|bomRow|sldSection|renderContext|decision|dependencyNode):/, ''); }
function regenerationOrder(records: EngineeringStateRecord[], graph: EngineeringDependencyGraph | null): string[] {
  const rank: Record<EngineeringStateType, number> = { requirement_evaluation: 1, dependency_graph_node: 2, decision_provenance: 3, engineering_calculation: 3, layout_primitive: 4, bom_row: 5, sld_section: 6, document_section: 7, render_context: 8, render_output: 9 };
  return records.slice().sort((a, b) => (rank[a.stateType] - rank[b.stateType]) || a.stateId.localeCompare(b.stateId)).map(record => record.stateId);
}
function normalizeGenerationInputs(input: EngineeringGenerationInputs): EngineeringGenerationInputs { return { inputKeys: uniqueSorted(input.inputKeys), canonicalInputKeys: uniqueSorted(input.canonicalInputKeys), cadPrimitiveIds: uniqueSorted(input.cadPrimitiveIds), legacyFallbackKeys: uniqueSorted(input.legacyFallbackKeys), deterministicSources: uniqueSorted(input.deterministicSources) }; }
function decisionIdsForSection(bundle: EngineeringDecisionEvaluationBundle | null, sectionId: string): string[] { return uniqueSorted(bundle?.decisionRecords.filter(record => record.documentSectionIds.includes(sectionId)).map(record => record.decisionId) ?? []); }
function typeFromNode(node: EngineeringDependencyNode): EngineeringStateType { if (node.nodeType === 'calculation') return 'engineering_calculation'; if (node.nodeType === 'engineering_decision') return 'decision_provenance'; if (node.nodeType === 'cad_layout_primitive') return 'layout_primitive'; if (node.nodeType === 'sld_section') return 'sld_section'; if (node.nodeType === 'bom_row') return 'bom_row'; if (node.nodeType === 'render_context') return 'render_context'; if (node.nodeType === 'render_output') return 'render_output'; if (node.nodeType === 'engineering_requirement') return 'requirement_evaluation'; return 'dependency_graph_node'; }
function categoryFromNode(node: EngineeringDependencyNode): EngineeringStateCategory { if (node.nodeType === 'sld_section') return 'sld'; if (node.nodeType === 'bom_row') return 'bom'; if (node.nodeType === 'cad_layout_primitive') return 'roof_layout'; if (node.nodeType === 'render_context' || node.nodeType === 'render_output') return 'rendering'; return categoryFromSection(node.id); }
function categoryFromDecision(record: EngineeringDecisionProvenanceRecord): EngineeringStateCategory { if (record.engineeringDomain === 'sld') return 'sld'; if (record.engineeringDomain === 'bom') return 'bom'; if (record.engineeringDomain === 'roof_layout') return 'roof_layout'; if (record.engineeringDomain === 'interconnection') return 'interconnection'; if (record.engineeringDomain === 'structural') return 'structural'; if (record.engineeringDomain === 'document_control') return 'document_control'; return 'electrical'; }
function categoryFromSection(sectionId: string): EngineeringStateCategory { if (/BOM|SCHED/i.test(sectionId)) return 'bom'; if (/SLD|E-1|single/i.test(sectionId)) return 'sld'; if (/utility|meter|interconnection/i.test(sectionId)) return 'interconnection'; if (/roof|array|layout|site/i.test(sectionId)) return 'roof_layout'; if (/structural/i.test(sectionId)) return 'structural'; if (/render/i.test(sectionId)) return 'rendering'; return 'electrical'; }
function stableHash(prefix: string, values: string[]): string { const payload = uniqueSorted(values).join('\n'); let hash = 5381; for (let i = 0; i < payload.length; i += 1) { hash = ((hash << 5) + hash) ^ payload.charCodeAt(i); hash >>>= 0; } return `${prefix}-${hash.toString(16).padStart(8, '0')}`; }
function uniqueSorted<T extends string>(values: Array<T | null | undefined>): T[] { return Array.from(new Set(values.filter((value): value is T => typeof value === 'string' && value.length > 0))).sort((a, b) => a.localeCompare(b)); }
