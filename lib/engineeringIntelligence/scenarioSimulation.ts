import type { SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import {
  buildEngineeringStateSnapshot,
  buildInvalidationTrigger,
  buildPersistentEngineeringStateGraph,
  diffEngineeringStateSnapshots,
  type EngineeringInvalidationResult,
  type EngineeringInvalidationTrigger,
  type EngineeringStateRegistry,
  type EngineeringStateSnapshot,
  type PersistentEngineeringStateGraph,
  type SelectiveRegenerationPlan,
} from '@/lib/engineeringStateInvalidation';
import type { EngineeringDependencyGraph } from '@/lib/documentProvenance';
import { buildCADReadinessMetadata, type CADReadinessFlagId, type CADReadinessMetadataModel, type CADReadinessStatus } from './cadReadiness';
import { buildEngineeringContextResolution } from './contextResolution';
import type { EngineeringContextResolutionSummary, EngineeringContextStatus, EngineeringContextType, ResolvedEngineeringContext } from './contextTypes';
import { computeEngineeringInvalidationPropagation, type EngineeringInvalidationPropagationResult } from './invalidationEngine';
import { buildDeterministicPhotoGrouping, type DeterministicPhotoGroupingModel } from './photoGrouping';
import { sortBy, sortText, tracePropagation, type EngineeringStaleClass, type PropagationTraversalResult } from './propagationGraph';
import { buildEngineeringRegenerationPlanV1, type EngineeringRegenerationPlanV1 } from './regenerationPlanner';
import { buildStructuredEngineeringSignals } from './signalExtraction';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalStatus, StructuredEngineeringSignalSummary, StructuredEngineeringSignalType } from './signalTypes';
import { buildEngineeringSnapshotDeltaV1, type EngineeringSnapshotDeltaV1 } from './snapshotDelta';

export type EngineeringScenarioType =
  | 'evidence_change'
  | 'signal_change'
  | 'context_change'
  | 'cad_readiness_change'
  | 'survey_quality_change';

export type EngineeringScenarioOperation =
  | { operationId: string; operationType: 'remove_evidence'; evidenceIds: string[]; deterministicReason: string }
  | { operationId: string; operationType: 'add_evidence'; evidenceItems: SurveyEvidenceItem[]; deterministicReason: string }
  | { operationId: string; operationType: 'strengthen_evidence'; evidenceIds: string[]; deterministicReason: string }
  | { operationId: string; operationType: 'invalidate_signal' | 'strengthen_signal'; signalTypes: StructuredEngineeringSignalType[]; deterministicReason: string }
  | { operationId: string; operationType: 'introduce_signal_conflict'; signalTypes: StructuredEngineeringSignalType[]; deterministicReason: string }
  | { operationId: string; operationType: 'promote_context' | 'invalidate_context'; contextTypes: EngineeringContextType[]; deterministicReason: string }
  | { operationId: string; operationType: 'remove_fallback'; contextTypes?: EngineeringContextType[]; signalTypes?: StructuredEngineeringSignalType[]; deterministicReason: string }
  | { operationId: string; operationType: 'set_cad_readiness'; flagIds: CADReadinessFlagId[]; status: CADReadinessStatus; deterministicReason: string }
  | { operationId: string; operationType: 'degrade_survey_quality' | 'improve_survey_quality'; deterministicReason: string };

export interface EngineeringScenarioSimulationInput {
  scenarioId: string;
  scenarioType: EngineeringScenarioType;
  projectId?: string | null;
  surveyId?: string | null;
  generatedAt?: string;
  operations: EngineeringScenarioOperation[];
  canonicalManifest?: SurveyEvidenceManifest | null;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  baselineCADReadiness?: CADReadinessMetadataModel | null;
  baselinePhotoGrouping?: DeterministicPhotoGroupingModel | null;
  baselineStructuredSignals?: StructuredEngineeringSignalSummary | null;
  baselineContextResolution?: EngineeringContextResolutionSummary | null;
  registry?: EngineeringStateRegistry | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  dependencyGraph?: EngineeringDependencyGraph | null;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  snapshots?: EngineeringStateSnapshot[] | null;
  existingRegenerationPlans?: SelectiveRegenerationPlan[] | null;
  maxDepth?: number;
  traversalLimit?: number;
}

export interface EngineeringScenarioDeltaRow {
  deltaId: string;
  entityType: 'evidence' | 'signal' | 'context' | 'cad_readiness' | 'output' | 'requirement' | 'decision' | 'fallback' | 'conflict' | 'snapshot';
  entityId: string;
  previousStatus: string | null;
  simulatedStatus: string | null;
  deltaType: 'added' | 'removed' | 'changed' | 'unchanged' | 'introduced' | 'resolved';
  staleClass: EngineeringStaleClass;
  deterministicReason: string;
}

export interface EngineeringScenarioSimulationResult {
  modelVersion: 'engineering_scenario_simulation_v1';
  scenarioId: string;
  scenarioType: EngineeringScenarioType;
  generatedAt: string;
  projectId: string | null;
  surveyId: string | null;
  mode: 'read_only_sandbox';
  operations: EngineeringScenarioOperation[];
  baseline: {
    evidenceIds: string[];
    signalHashes: string[];
    contextHashes: string[];
    cadReadinessStatuses: Array<{ flagId: CADReadinessFlagId; status: CADReadinessStatus }>;
    snapshotIds: string[];
  };
  hypothetical: {
    canonicalManifest: SurveyEvidenceManifest | null;
    cadReadiness: CADReadinessMetadataModel;
    photoGrouping: DeterministicPhotoGroupingModel;
    structuredSignals: StructuredEngineeringSignalSummary;
    contextResolution: EngineeringContextResolutionSummary;
    invalidationPropagation: EngineeringInvalidationPropagationResult;
    regenerationPlan: EngineeringRegenerationPlanV1;
    snapshotDelta: EngineeringSnapshotDeltaV1;
    dependencyTraversal: PropagationTraversalResult;
  };
  deltas: EngineeringScenarioDeltaRow[];
  affectedEvidenceIds: string[];
  affectedSignalIds: string[];
  affectedContextIds: string[];
  affectedRequirementIds: string[];
  affectedDecisionIds: string[];
  affectedOutputIds: string[];
  staleImpacts: Array<{ entityId: string; staleClasses: EngineeringStaleClass[]; deterministicReason: string }>;
  regenerationCandidateIds: string[];
  fallbackDeltas: EngineeringScenarioDeltaRow[];
  conflictDeltas: EngineeringScenarioDeltaRow[];
  confidenceDeltas: Array<{ entityId: string; entityType: 'signal' | 'context'; previousScore: number | null; simulatedScore: number | null; delta: number; deterministicReason: string }>;
  unresolvedStateChanges: EngineeringScenarioDeltaRow[];
  dependencyTraversalPaths: PropagationTraversalResult['paths'];
  productionImmutability: {
    preserved: true;
    baselineHashBefore: string;
    baselineHashAfter: string;
    deterministicReason: string;
  };
  deterministicHash: string;
  deterministicExplanation: string[];
  prohibitedRuntimeBehavior: string[];
}

const DEFAULT_GENERATED_AT = new Date(0).toISOString();

export function simulateEngineeringScenario(input: EngineeringScenarioSimulationInput): EngineeringScenarioSimulationResult {
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;
  const baselineHashBefore = stableObjectHash(baselineHashPayload(input));
  const baselineManifest = input.canonicalManifest ?? null;
  const manifest = applyManifestOperations(cloneOrNull(baselineManifest), input.operations, generatedAt);
  const projectId = input.projectId ?? manifest?.projectId ?? input.baselineStructuredSignals?.projectId ?? input.baselineContextResolution?.projectId ?? null;
  const surveyId = input.surveyId ?? manifest?.surveyId ?? input.baselineStructuredSignals?.surveyId ?? input.baselineContextResolution?.surveyId ?? null;
  const baseCAD = cloneOrNull(input.baselineCADReadiness) ?? buildCADReadinessMetadata({ projectId, surveyId, canonicalManifest: manifest, surveyEvidence: input.surveyEvidence ?? undefined });
  const photoGrouping = buildDeterministicPhotoGrouping({ projectId: projectId ?? undefined, canonicalManifest: manifest ?? undefined, readinessFlags: baseCAD.flags, generatedAt });
  const preliminarySignals = buildStructuredEngineeringSignals({ projectId, surveyId, canonicalManifest: manifest, surveyEvidence: input.surveyEvidence ?? undefined, photoGrouping, cadReadiness: baseCAD, invalidationResult: input.invalidationResult ?? undefined, generatedAt });
  const signalAwareCAD = buildCADReadinessMetadata({ projectId, surveyId, canonicalManifest: manifest, surveyEvidence: input.surveyEvidence ?? undefined, structuredSignals: preliminarySignals });
  const cadReadiness = applyCADOperations(signalAwareCAD, input.operations);
  const trigger = scenarioTrigger(input, manifest, generatedAt);
  const propagation = computeEngineeringInvalidationPropagation({
    propagationId: `${input.scenarioId}:hypothetical-propagation:v1`,
    registry: input.registry ?? undefined,
    invalidationResult: input.invalidationResult ?? undefined,
    trigger,
    dependencyGraph: input.dependencyGraph ?? undefined,
    persistentGraph: input.persistentGraph ?? undefined,
    snapshots: input.snapshots ?? undefined,
    cadReadiness,
    maxDepth: input.maxDepth,
    traversalLimit: input.traversalLimit,
  });
  const structuredSignals = applySignalOperations(buildStructuredEngineeringSignals({ projectId, surveyId, canonicalManifest: manifest, surveyEvidence: input.surveyEvidence ?? undefined, photoGrouping, cadReadiness, invalidationResult: input.invalidationResult ?? undefined, invalidationPropagation: propagation, generatedAt }), input.operations);
  const contextResolution = applyContextOperations(buildEngineeringContextResolution({ projectId, surveyId, canonicalManifest: manifest, structuredSignals, photoGrouping, cadReadiness, invalidationResult: input.invalidationResult ?? undefined, invalidationPropagation: propagation, generatedAt }), input.operations);
  const contextAwareCAD = applyCADOperations(buildCADReadinessMetadata({ projectId, surveyId, canonicalManifest: manifest, surveyEvidence: input.surveyEvidence ?? undefined, structuredSignals, contextResolution }), input.operations);
  const regenerationPlan = buildEngineeringRegenerationPlanV1({ planId: `${input.scenarioId}:hypothetical-regeneration-plan:v1`, propagation, existingPlans: input.existingRegenerationPlans ?? undefined });
  const snapshots = input.snapshots ?? [];
  const previousSnapshot = snapshots[0] ?? null;
  const nextSnapshot = buildHypotheticalSnapshot(input, generatedAt, previousSnapshot);
  const snapshotDiffs = previousSnapshot && nextSnapshot ? [diffEngineeringStateSnapshots(previousSnapshot, nextSnapshot)] : [];
  const nextGraph = input.registry ? buildPersistentEngineeringStateGraph({ graphId: `${input.scenarioId}:hypothetical-state-graph`, generatedAt, registry: input.registry, dependencyGraph: input.dependencyGraph ?? undefined, invalidationResult: input.invalidationResult ?? undefined }) : input.persistentGraph ?? null;
  const snapshotDelta = buildEngineeringSnapshotDeltaV1({ deltaId: `${input.scenarioId}:hypothetical-snapshot-delta:v1`, previousSnapshot, nextSnapshot, snapshotDiffs, previousGraph: input.persistentGraph ?? null, nextGraph, propagation, cadReadiness: contextAwareCAD });
  const dependencyTraversal = tracePropagation({ traversalId: `${input.scenarioId}:hypothetical-dependency-traversal`, seedNodeIds: sortText([...propagation.sourceNodeIds, ...propagation.affectedStateIds, ...contextResolution.contexts.flatMap(context => context.sourceEvidenceIds.map(id => `canonicalEvidence:${id}`))]), direction: 'downstream', dependencyGraph: input.dependencyGraph ?? undefined, persistentGraph: input.persistentGraph ?? undefined, maxDepth: input.maxDepth, traversalLimit: input.traversalLimit });
  const deltas = buildScenarioDeltas(input, manifest, structuredSignals, contextResolution, contextAwareCAD, snapshotDelta, propagation);
  const fallbackDeltas = deltas.filter(delta => delta.entityType === 'fallback');
  const conflictDeltas = deltas.filter(delta => delta.entityType === 'conflict');
  const confidenceDeltas = buildConfidenceDeltas(input.baselineStructuredSignals ?? null, structuredSignals, input.baselineContextResolution ?? null, contextResolution);
  const unresolvedStateChanges = deltas.filter(delta => ['blocked', 'missing', 'unresolved', 'conflicting'].includes(delta.simulatedStatus ?? '') || ['blocked', 'missing', 'unresolved', 'conflicting'].includes(delta.previousStatus ?? ''));
  const baselineHashAfter = stableObjectHash(baselineHashPayload(input));
  const deterministicHash = stableObjectHash({ scenarioId: input.scenarioId, scenarioType: input.scenarioType, operations: input.operations, deltas: deltas.map(delta => delta.deltaId), propagationHash: propagation.deterministicHash, regenerationHash: regenerationPlan.deterministicHash, snapshotHash: snapshotDelta.deterministicHash });

  return {
    modelVersion: 'engineering_scenario_simulation_v1',
    scenarioId: input.scenarioId,
    scenarioType: input.scenarioType,
    generatedAt,
    projectId,
    surveyId,
    mode: 'read_only_sandbox',
    operations: sortBy(input.operations, operation => operation.operationId),
    baseline: baselineSummary(input),
    hypothetical: { canonicalManifest: manifest, cadReadiness: contextAwareCAD, photoGrouping, structuredSignals, contextResolution, invalidationPropagation: propagation, regenerationPlan, snapshotDelta, dependencyTraversal },
    deltas,
    affectedEvidenceIds: sortText([...manifestDeltaEvidenceIds(input.canonicalManifest ?? null, manifest), ...propagation.sourceNodeIds.filter(id => id.startsWith('canonicalEvidence:')).map(id => id.replace('canonicalEvidence:', ''))]),
    affectedSignalIds: sortText(deltas.filter(delta => delta.entityType === 'signal').map(delta => delta.entityId)),
    affectedContextIds: sortText(deltas.filter(delta => delta.entityType === 'context').map(delta => delta.entityId)),
    affectedRequirementIds: sortText([...structuredSignals.signals.flatMap(signal => signal.requirementImpacts), ...contextResolution.contexts.flatMap(context => context.requirementImpacts), ...snapshotDelta.entries.flatMap(entry => entry.requirementIds)]),
    affectedDecisionIds: sortText([...structuredSignals.signals.flatMap(signal => signal.decisionImpacts), ...contextResolution.contexts.flatMap(context => context.decisionImpacts), ...propagation.invalidatedDecisions.map(decision => decision.decisionId)]),
    affectedOutputIds: sortText([...contextResolution.contexts.flatMap(context => context.affectedOutputs), ...propagation.affectedOutputs.map(output => output.outputId), ...regenerationPlan.regenerationCandidateIds]),
    staleImpacts: buildStaleImpacts(structuredSignals, contextResolution, propagation),
    regenerationCandidateIds: regenerationPlan.regenerationCandidateIds,
    fallbackDeltas,
    conflictDeltas,
    confidenceDeltas,
    unresolvedStateChanges,
    dependencyTraversalPaths: dependencyTraversal.paths,
    productionImmutability: { preserved: true, baselineHashBefore, baselineHashAfter, deterministicReason: 'Scenario simulation reads cloned metadata inputs and returns a sandbox artifact; no production canonical evidence, snapshots, decisions, outputs, or invalidation history are written.' },
    deterministicHash,
    deterministicExplanation: [
      `Scenario ${input.scenarioId} applies ${input.operations.length} explicit hypothetical operation(s) in read-only sandbox mode.`,
      'Simulation reuses deterministic Engineering Intelligence builders for signal extraction, context resolution, CAD readiness, propagation, regeneration forecast, and snapshot delta metadata.',
      'Outputs are hypothetical impact metadata only and never represent committed production truth or completed regeneration.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function applyManifestOperations(manifest: SurveyEvidenceManifest | null, operations: EngineeringScenarioOperation[], generatedAt: string): SurveyEvidenceManifest | null {
  if (!manifest) return null;
  let next = clone(manifest);
  for (const operation of sortBy(operations, item => item.operationId)) {
    if (operation.operationType === 'remove_evidence') {
      const removeIds = new Set(operation.evidenceIds);
      next = { ...next, items: next.items.filter(item => !removeIds.has(item.evidenceId)) };
    }
    if (operation.operationType === 'add_evidence') {
      const existing = new Set(next.items.map(item => item.evidenceId));
      next = { ...next, items: sortBy([...next.items, ...operation.evidenceItems.filter(item => !existing.has(item.evidenceId)).map(item => clone(item))], item => item.evidenceId) };
    }
    if (operation.operationType === 'strengthen_evidence') {
      const ids = new Set(operation.evidenceIds);
      next = { ...next, items: next.items.map(item => ids.has(item.evidenceId) ? { ...item, evidenceConfidence: 'high', processingStatus: 'engineering_reviewed', quality: { ...item.quality, warnings: [] } } : item) };
    }
    if (operation.operationType === 'degrade_survey_quality') {
      next = { ...next, items: next.items.map(item => ({ ...item, evidenceConfidence: item.evidenceConfidence === 'high' ? 'medium' : 'low', quality: { ...item.quality, warnings: sortText([...item.quality.warnings, 'hypothetical survey quality degradation']) } })) };
    }
    if (operation.operationType === 'improve_survey_quality') {
      next = { ...next, items: next.items.map(item => ({ ...item, evidenceConfidence: item.evidenceConfidence === 'unknown' ? 'medium' : 'high', quality: { ...item.quality, warnings: [] } })) };
    }
  }
  const totalItems = next.items.length;
  const classifiedItems = next.items.filter(item => item.processingStatus !== 'uploaded').length;
  const engineeringReviewedItems = next.items.filter(item => item.processingStatus === 'engineering_reviewed').length;
  const confidence = next.items.some(item => item.evidenceConfidence === 'high') ? 'high' : next.items.some(item => item.evidenceConfidence === 'medium') ? 'medium' : next.items.length ? 'low' : 'unknown';
  return {
    ...next,
    generatedAt,
    items: sortBy(next.items, item => item.evidenceId),
    requiredMissing: sortText(next.requiredMissing.filter(category => !next.items.some(item => item.category === category))),
    warnings: sortText([...next.warnings, 'hypothetical scenario manifest clone; production manifest not mutated']),
    summary: {
      ...next.summary,
      totalItems,
      classifiedItems,
      qualityCheckedItems: next.items.filter(item => item.processingStatus === 'quality_checked' || item.processingStatus === 'duplicate_checked' || item.processingStatus === 'engineering_reviewed').length,
      duplicateCheckedItems: next.items.filter(item => item.processingStatus === 'duplicate_checked' || item.processingStatus === 'engineering_reviewed').length,
      aiProcessedItems: next.items.filter(item => item.aiExtractionStatus === 'processed').length,
      engineeringReviewedItems,
      permitConsumedItems: next.items.filter(item => item.processingStatus === 'permit_consumed').length,
      confidence,
      completeness: totalItems === 0 ? 'missing' : next.requiredMissing.length === 0 ? 'sufficient' : 'partial',
    },
  };
}

function applySignalOperations(summary: StructuredEngineeringSignalSummary, operations: EngineeringScenarioOperation[]): StructuredEngineeringSignalSummary {
  let signals = summary.signals.map(signal => clone(signal));
  for (const operation of sortBy(operations, item => item.operationId)) {
    if (operation.operationType === 'invalidate_signal' || operation.operationType === 'strengthen_signal' || operation.operationType === 'introduce_signal_conflict' || operation.operationType === 'remove_fallback') {
      const targetTypes = new Set('signalTypes' in operation && operation.signalTypes ? operation.signalTypes : []);
      signals = signals.map(signal => {
        if (!targetTypes.has(signal.signal_type)) return signal;
        if (operation.operationType === 'invalidate_signal') return withSignalStatus(signal, 'blocked', operation.deterministicReason);
        if (operation.operationType === 'strengthen_signal') return withSignalStatus(signal, 'confirmed', operation.deterministicReason);
        if (operation.operationType === 'introduce_signal_conflict') return withSignalStatus(signal, 'partial', operation.deterministicReason, [`hypothetical-conflict:${operation.operationId}`]);
        if (operation.operationType === 'remove_fallback') return { ...signal, blockingReasons: [], partialReasons: signal.partialReasons.filter(reason => !reason.toLowerCase().includes('fallback')), deterministicHash: stableObjectHash({ ...signal, scenarioOperation: operation.operationId }) };
        return signal;
      });
    }
  }
  return rebuildSignalSummary(summary, signals);
}

function applyContextOperations(summary: EngineeringContextResolutionSummary, operations: EngineeringScenarioOperation[]): EngineeringContextResolutionSummary {
  let contexts = summary.contexts.map(context => clone(context));
  for (const operation of sortBy(operations, item => item.operationId)) {
    if (operation.operationType === 'promote_context' || operation.operationType === 'invalidate_context' || operation.operationType === 'remove_fallback') {
      const targetTypes = new Set('contextTypes' in operation && operation.contextTypes ? operation.contextTypes : []);
      contexts = contexts.map(context => {
        if (targetTypes.size > 0 && !targetTypes.has(context.contextType)) return context;
        if (operation.operationType === 'promote_context') return withContextStatus(context, 'authoritative', operation.deterministicReason);
        if (operation.operationType === 'invalidate_context') return withContextStatus(context, 'blocked', operation.deterministicReason);
        if (operation.operationType === 'remove_fallback') return { ...context, fallbackLineage: [], fallbackConfidencePenalties: [], confidence: { ...context.confidence, penalties: context.confidence.penalties.filter(penalty => !penalty.toLowerCase().includes('fallback')) }, deterministicHash: stableObjectHash({ ...context, scenarioOperation: operation.operationId }) };
        return context;
      });
    }
  }
  return rebuildContextSummary(summary, contexts);
}

function applyCADOperations(readiness: CADReadinessMetadataModel, operations: EngineeringScenarioOperation[]): CADReadinessMetadataModel {
  let next = clone(readiness);
  for (const operation of sortBy(operations, item => item.operationId)) {
    if (operation.operationType !== 'set_cad_readiness') continue;
    const ids = new Set(operation.flagIds);
    next = {
      ...next,
      flags: next.flags.map(flag => ids.has(flag.flagId) ? { ...flag, status: operation.status, deterministicReason: `Hypothetical CAD readiness scenario ${operation.operationId}: ${operation.deterministicReason}` } : flag),
    };
  }
  return {
    ...next,
    readyFlags: next.flags.filter(flag => flag.status === 'ready').map(flag => flag.flagId),
    partialFlags: next.flags.filter(flag => flag.status === 'partial').map(flag => flag.flagId),
    blockedFlags: next.flags.filter(flag => flag.status === 'blocked').map(flag => flag.flagId),
    deterministicNotes: sortText([...next.deterministicNotes, 'CAD readiness statuses may include hypothetical overrides; production readiness is not mutated.']),
  };
}

function withSignalStatus(signal: StructuredEngineeringSignal, status: StructuredEngineeringSignalStatus, reason: string, extraInvalidatedBy: string[] = []): StructuredEngineeringSignal {
  const staleImpacts: EngineeringStaleClass[] = status === 'confirmed' ? ['VALID'] : status === 'partial' ? ['PARTIAL'] : status === 'missing' ? ['NOT_LOADED'] : status === 'blocked' ? ['BLOCKED'] : ['VALID'];
  const next = {
    ...signal,
    status,
    staleImpacts,
    invalidatedBy: sortText([...signal.invalidatedBy, ...extraInvalidatedBy]),
    confidence: { ...signal.confidence, score: status === 'confirmed' ? Math.max(signal.confidence.score, 0.9) : status === 'partial' ? Math.min(signal.confidence.score || 0.45, 0.58) : 0, band: status === 'confirmed' ? 'high' as const : status === 'partial' ? 'medium' as const : 'none' as const, factors: sortText([...signal.confidence.factors, `hypothetical scenario override: ${reason}`]) },
    explanation: `${signal.explanation} Hypothetical scenario override: ${reason}`,
  };
  return { ...next, deterministicHash: stableObjectHash(next) };
}

function withContextStatus(context: ResolvedEngineeringContext, status: EngineeringContextStatus, reason: string): ResolvedEngineeringContext {
  const score = status === 'authoritative' ? Math.max(context.confidence.score, 88) : status === 'blocked' || status === 'unresolved' ? Math.min(context.confidence.score, 20) : context.confidence.score;
  const next = {
    ...context,
    status,
    staleImpactPropagation: status === 'blocked' ? sortText([...context.staleImpactPropagation, 'BLOCKED']) as EngineeringStaleClass[] : context.staleImpactPropagation,
    confidence: { ...context.confidence, score, band: score >= 76 ? 'high' as const : score >= 45 ? 'medium' as const : score > 0 ? 'low' as const : 'none' as const, factors: sortText([...context.confidence.factors, `hypothetical scenario override: ${reason}`]) },
    rankingReason: `${context.rankingReason} Hypothetical scenario override: ${reason}`,
  };
  return { ...next, deterministicHash: stableObjectHash(next) };
}

function rebuildSignalSummary(base: StructuredEngineeringSignalSummary, signals: StructuredEngineeringSignal[]): StructuredEngineeringSignalSummary {
  const sorted = sortBy(signals, signal => signal.id);
  return {
    ...base,
    signals: sorted,
    satisfiedSignals: sorted.filter(signal => signal.status === 'confirmed'),
    partialSignals: sorted.filter(signal => signal.status === 'partial'),
    blockedSignals: sorted.filter(signal => signal.status === 'blocked'),
    missingSignals: sorted.filter(signal => signal.status === 'missing'),
    notApplicableSignals: sorted.filter(signal => signal.status === 'not_applicable'),
    fallbackParticipation: base.fallbackParticipation.filter(row => sorted.some(signal => signal.id === row.signalId && (signal.status === 'missing' || signal.status === 'blocked'))),
    deterministicNotes: sortText([...base.deterministicNotes, 'Signal rows may include explicit hypothetical overrides; production signal summary is not mutated.']),
  };
}

function rebuildContextSummary(base: EngineeringContextResolutionSummary, contexts: ResolvedEngineeringContext[]): EngineeringContextResolutionSummary {
  const sorted = sortBy(contexts, context => context.id);
  return {
    ...base,
    contexts: sorted,
    authoritativeContexts: sorted.filter(context => context.status === 'authoritative'),
    preferredContexts: sorted.filter(context => context.status === 'preferred'),
    partialContexts: sorted.filter(context => context.status === 'partial'),
    conflictingContexts: sorted.filter(context => context.status === 'conflicting'),
    blockedContexts: sorted.filter(context => context.status === 'blocked'),
    unresolvedContexts: sorted.filter(context => context.status === 'unresolved'),
    notApplicableContexts: sorted.filter(context => context.status === 'not_applicable'),
    conflicts: base.conflicts.filter(conflict => sorted.some(context => context.id === conflict.contextId && (context.status === 'conflicting' || context.competingSignalIds.length > 0))),
    fallbackParticipation: base.fallbackParticipation.filter(row => sorted.some(context => context.id === row.contextId && context.fallbackLineage.length > 0)),
    staleImpacts: sorted.map(context => ({ contextId: context.id, staleClasses: context.staleImpactPropagation, invalidatedBy: context.invalidationLineage })),
    timeline: sorted.map(context => ({ eventId: `scenario-context-resolution:${context.contextType}:${context.status}`, contextId: context.id, status: context.status, deterministicReason: context.rankingReason })),
    deterministicNotes: sortText([...base.deterministicNotes, 'Context rows may include explicit hypothetical overrides; production context resolution is not mutated.']),
  };
}

function scenarioTrigger(input: EngineeringScenarioSimulationInput, manifest: SurveyEvidenceManifest | null, generatedAt: string): EngineeringInvalidationTrigger | null {
  const changedEvidenceIds = sortText([
    ...input.operations.flatMap(operation => operation.operationType === 'remove_evidence' || operation.operationType === 'strengthen_evidence' ? operation.evidenceIds : []),
    ...input.operations.flatMap(operation => operation.operationType === 'add_evidence' ? operation.evidenceItems.map(item => item.evidenceId) : []),
  ]);
  const changedRequirementIds = sortText(input.operations.flatMap(operation => {
    if (operation.operationType !== 'invalidate_signal' && operation.operationType !== 'strengthen_signal' && operation.operationType !== 'introduce_signal_conflict') return [];
    const targetTypes = new Set(operation.signalTypes);
    return (input.baselineStructuredSignals?.signals ?? []).filter(signal => targetTypes.has(signal.signal_type)).flatMap(signal => signal.requirementImpacts);
  }));
  const changedDecisionIds = sortText(input.operations.flatMap(operation => {
    if (operation.operationType !== 'promote_context' && operation.operationType !== 'invalidate_context') return [];
    const targetTypes = new Set(operation.contextTypes);
    return (input.baselineContextResolution?.contexts ?? []).filter(context => targetTypes.has(context.contextType)).flatMap(context => context.decisionImpacts);
  }));
  if (!changedEvidenceIds.length && !changedRequirementIds.length && !changedDecisionIds.length) return null;
  return buildInvalidationTrigger({
    triggerId: `${input.scenarioId}:hypothetical-trigger`,
    triggerType: 'canonical_evidence_changed',
    changedCanonicalEvidenceIds: changedEvidenceIds.length ? changedEvidenceIds : manifest?.items.slice(0, 1).map(item => item.evidenceId) ?? [],
    changedRequirementIds,
    changedDecisionIds,
    triggeredAt: generatedAt,
    deterministicReason: 'Explicit hypothetical scenario operation seeds sandbox invalidation propagation only.',
  });
}

function buildHypotheticalSnapshot(input: EngineeringScenarioSimulationInput, generatedAt: string, previousSnapshot: EngineeringStateSnapshot | null): EngineeringStateSnapshot | null {
  if (!input.registry) return input.snapshots?.[1] ?? previousSnapshot;
  const graph = buildPersistentEngineeringStateGraph({ graphId: `${input.scenarioId}:hypothetical-snapshot-graph`, generatedAt, registry: input.registry, dependencyGraph: input.dependencyGraph ?? undefined, invalidationResult: input.invalidationResult ?? undefined });
  return buildEngineeringStateSnapshot({ snapshotId: `${input.scenarioId}:hypothetical-snapshot`, generatedAt, registry: input.registry, stateGraph: graph, dependencyGraph: input.dependencyGraph ?? undefined, previousSnapshot: previousSnapshot ?? undefined, invalidationResult: input.invalidationResult ?? undefined });
}

function buildScenarioDeltas(input: EngineeringScenarioSimulationInput, manifest: SurveyEvidenceManifest | null, signals: StructuredEngineeringSignalSummary, contexts: EngineeringContextResolutionSummary, cad: CADReadinessMetadataModel, snapshotDelta: EngineeringSnapshotDeltaV1, propagation: EngineeringInvalidationPropagationResult): EngineeringScenarioDeltaRow[] {
  const rows: EngineeringScenarioDeltaRow[] = [];
  const baselineEvidence = new Set((input.canonicalManifest?.items ?? []).map(item => item.evidenceId));
  const nextEvidence = new Set((manifest?.items ?? []).map(item => item.evidenceId));
  for (const id of sortText([...new Set([...baselineEvidence, ...nextEvidence])])) {
    if (!baselineEvidence.has(id) || !nextEvidence.has(id)) rows.push(delta('evidence', id, baselineEvidence.has(id) ? 'present' : null, nextEvidence.has(id) ? 'present' : null, baselineEvidence.has(id) ? 'removed' : 'added', baselineEvidence.has(id) ? 'REQUIRES_REVIEW' : 'PARTIAL', 'Hypothetical canonical evidence membership changed.'));
  }
  const baselineSignals = new Map((input.baselineStructuredSignals?.signals ?? []).map(signal => [signal.id, signal]));
  for (const signal of signals.signals) {
    const previous = baselineSignals.get(signal.id);
    if (!previous || previous.status !== signal.status || previous.deterministicHash !== signal.deterministicHash) rows.push(delta('signal', signal.id, previous?.status ?? null, signal.status, previous ? 'changed' : 'added', signal.staleImpacts[0] ?? 'PARTIAL', 'Hypothetical structured signal state differs from baseline.'));
  }
  const baselineContexts = new Map((input.baselineContextResolution?.contexts ?? []).map(context => [context.id, context]));
  for (const context of contexts.contexts) {
    const previous = baselineContexts.get(context.id);
    if (!previous || previous.status !== context.status || previous.deterministicHash !== context.deterministicHash) rows.push(delta('context', context.id, previous?.status ?? null, context.status, previous ? 'changed' : 'added', context.staleImpactPropagation[0] ?? 'PARTIAL', 'Hypothetical context arbitration differs from baseline.'));
  }
  const baselineFlags = new Map((input.baselineCADReadiness?.flags ?? []).map(flag => [flag.flagId, flag.status]));
  for (const flag of cad.flags) {
    const previous = baselineFlags.get(flag.flagId) ?? null;
    if (previous !== flag.status) rows.push(delta('cad_readiness', flag.flagId, previous, flag.status, previous ? 'changed' : 'added', flag.status === 'blocked' ? 'BLOCKED' : flag.status === 'partial' ? 'PARTIAL' : 'VALID', 'Hypothetical CAD-readiness metadata differs from baseline.'));
  }
  for (const fallback of contexts.fallbackParticipation) rows.push(delta('fallback', `${fallback.contextId}:${fallback.fallback}`, null, 'present', 'introduced', 'REQUIRES_REVIEW', fallback.deterministicReason));
  for (const conflict of contexts.conflicts) rows.push(delta('conflict', conflict.conflictId, null, 'present', 'introduced', 'REQUIRES_REVIEW', conflict.deterministicResolutionPolicy));
  for (const output of propagation.affectedOutputs) rows.push(delta('output', output.outputId, null, output.staleClass, 'introduced', output.staleClass, output.deterministicReason));
  for (const entry of snapshotDelta.entries) rows.push(delta('snapshot', entry.deltaId, entry.previousStatus, entry.nextStatus, entry.deltaType === 'removed_evidence' ? 'removed' : entry.deltaType === 'added_evidence' ? 'added' : 'changed', entry.staleClass, entry.deterministicReason));
  return sortBy(rows, row => row.deltaId);
}

function delta(entityType: EngineeringScenarioDeltaRow['entityType'], entityId: string, previousStatus: string | null, simulatedStatus: string | null, deltaType: EngineeringScenarioDeltaRow['deltaType'], staleClass: EngineeringStaleClass, deterministicReason: string): EngineeringScenarioDeltaRow {
  return { deltaId: `scenario-delta:${entityType}:${sanitize(entityId)}:${deltaType}`, entityType, entityId, previousStatus, simulatedStatus, deltaType, staleClass, deterministicReason };
}

function buildConfidenceDeltas(baselineSignals: StructuredEngineeringSignalSummary | null, signals: StructuredEngineeringSignalSummary, baselineContexts: EngineeringContextResolutionSummary | null, contexts: EngineeringContextResolutionSummary) {
  const rows: EngineeringScenarioSimulationResult['confidenceDeltas'] = [];
  const signalScores = new Map((baselineSignals?.signals ?? []).map(signal => [signal.id, signal.confidence.score]));
  for (const signal of signals.signals) {
    const previous = signalScores.get(signal.id) ?? null;
    if (previous !== signal.confidence.score) rows.push({ entityId: signal.id, entityType: 'signal', previousScore: previous, simulatedScore: signal.confidence.score, delta: signal.confidence.score - (previous ?? 0), deterministicReason: 'Structured signal confidence changed under hypothetical scenario inputs.' });
  }
  const contextScores = new Map((baselineContexts?.contexts ?? []).map(context => [context.id, context.confidence.score]));
  for (const context of contexts.contexts) {
    const previous = contextScores.get(context.id) ?? null;
    if (previous !== context.confidence.score) rows.push({ entityId: context.id, entityType: 'context', previousScore: previous, simulatedScore: context.confidence.score, delta: context.confidence.score - (previous ?? 0), deterministicReason: 'Context confidence changed under hypothetical scenario inputs.' });
  }
  return sortBy(rows, row => `${row.entityType}:${row.entityId}`);
}

function buildStaleImpacts(signals: StructuredEngineeringSignalSummary, contexts: EngineeringContextResolutionSummary, propagation: EngineeringInvalidationPropagationResult) {
  return sortBy([
    ...signals.staleImpacts.map(row => ({ entityId: row.signalId, staleClasses: row.staleClasses, deterministicReason: `Signal invalidated by ${row.invalidatedBy.join(', ') || 'no invalidation lineage'}.` })),
    ...contexts.staleImpacts.map(row => ({ entityId: row.contextId, staleClasses: row.staleClasses, deterministicReason: `Context invalidated by ${row.invalidatedBy.join(', ') || 'no invalidation lineage'}.` })),
    ...propagation.affectedOutputs.map(row => ({ entityId: row.outputId, staleClasses: [row.staleClass], deterministicReason: row.deterministicReason })),
  ], row => row.entityId);
}

function baselineSummary(input: EngineeringScenarioSimulationInput): EngineeringScenarioSimulationResult['baseline'] {
  return {
    evidenceIds: sortText((input.canonicalManifest?.items ?? []).map(item => item.evidenceId)),
    signalHashes: sortText((input.baselineStructuredSignals?.signals ?? []).map(signal => signal.deterministicHash)),
    contextHashes: sortText((input.baselineContextResolution?.contexts ?? []).map(context => context.deterministicHash)),
    cadReadinessStatuses: sortBy((input.baselineCADReadiness?.flags ?? []).map(flag => ({ flagId: flag.flagId, status: flag.status })), row => row.flagId),
    snapshotIds: sortText((input.snapshots ?? []).map(snapshot => snapshot.snapshotId)),
  };
}

function manifestDeltaEvidenceIds(previous: SurveyEvidenceManifest | null, next: SurveyEvidenceManifest | null): string[] {
  const previousIds = new Set((previous?.items ?? []).map(item => item.evidenceId));
  const nextIds = new Set((next?.items ?? []).map(item => item.evidenceId));
  return sortText([...new Set([...previousIds, ...nextIds])].filter(id => !previousIds.has(id) || !nextIds.has(id)));
}

function baselineHashPayload(input: EngineeringScenarioSimulationInput) {
  return { manifest: input.canonicalManifest, signals: input.baselineStructuredSignals, contexts: input.baselineContextResolution, cad: input.baselineCADReadiness, snapshots: input.snapshots, graph: input.persistentGraph };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOrNull<T>(value: T | null | undefined): T | null {
  return value ? clone(value) : null;
}

function stableObjectHash(value: unknown): string {
  const payload = stableStringify(value);
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `scenario-v1-${hash.toString(16).padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 96);
}

function prohibitedRuntimeBehavior(): string[] {
  return [
    'no OCR',
    'no OpenCV/cv2',
    'no TensorFlow/PyTorch/YOLO image inference',
    'no image-byte inspection',
    'no visual-scene inference',
    'no hallucinated geometry',
    'no autonomous CAD generation',
    'no automatic regeneration',
    'no production engineering state mutation',
  ];
}
