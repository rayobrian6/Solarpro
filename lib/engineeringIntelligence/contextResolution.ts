import crypto from 'crypto';
import type { SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import type { CADReadinessFlagId, CADReadinessMetadataModel } from './cadReadiness';
import { ENGINEERING_CONTEXT_REGISTRY } from './contextRegistry';
import type {
  ContextSignalLookup,
  EngineeringContextConfidence,
  EngineeringContextDefinition,
  EngineeringContextResolutionSummary,
  EngineeringContextStatus,
  ResolvedEngineeringContext,
} from './contextTypes';
import type { EngineeringInvalidationPropagationResult } from './invalidationEngine';
import type { EngineeringInvalidationResult } from '@/lib/engineeringStateInvalidation';
import type { DeterministicPhotoGroupingModel } from './photoGrouping';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalSummary, StructuredEngineeringSignalType } from './signalTypes';

export interface BuildEngineeringContextResolutionInput {
  projectId?: string | null;
  surveyId?: string | null;
  canonicalManifest?: SurveyEvidenceManifest | null;
  structuredSignals?: StructuredEngineeringSignalSummary | null;
  photoGrouping?: DeterministicPhotoGroupingModel | null;
  cadReadiness?: CADReadinessMetadataModel | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  invalidationPropagation?: EngineeringInvalidationPropagationResult | null;
  generatedAt?: string;
}

const sortText = <T extends string>(values: T[]): T[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const sortBy = <T>(values: T[], selector: (value: T) => string): T[] => [...values].sort((a, b) => selector(a).localeCompare(selector(b)));

export function buildEngineeringContextResolution(input: BuildEngineeringContextResolutionInput = {}): EngineeringContextResolutionSummary {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const signals = input.structuredSignals?.signals ?? [];
  const lookup = buildSignalLookup(signals);
  const contexts = ENGINEERING_CONTEXT_REGISTRY.map(definition => evaluateContext(definition, { ...input, generatedAt, signals, lookup }));
  const rankedContextIds = [...contexts]
    .sort((a, b) => b.confidence.score - a.confidence.score || a.id.localeCompare(b.id))
    .map(context => context.id);
  const contextsWithRanks = contexts.map(context => {
    const rank = rankedContextIds.indexOf(context.id) + 1;
    const withRank = { ...context, confidence: { ...context.confidence, rank } };
    return { ...withRank, deterministicHash: stableHash({ ...withRank, deterministicHash: undefined }) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const conflicts = buildConflicts(contextsWithRanks);
  const fallbackParticipation = contextsWithRanks.flatMap(context => context.fallbackLineage.map(fallback => ({ contextId: context.id, fallback, deterministicReason: 'Resolved context depends on deterministic fallback metadata and remains review-visible.' })));
  const cadReadinessMappings = buildCADMappings(contextsWithRanks);
  const dependencyGraph = buildDependencyGraph(contextsWithRanks);
  const timeline = contextsWithRanks.map(context => ({ eventId: `context-resolution:${context.contextType}:${context.status}`, contextId: context.id, status: context.status, deterministicReason: context.rankingReason }));
  const staleImpacts = contextsWithRanks.map(context => ({ contextId: context.id, staleClasses: context.staleImpactPropagation, invalidatedBy: context.invalidationLineage }));

  return {
    modelVersion: 'engineering_context_resolution_v1',
    generatedAt,
    projectId: input.projectId ?? input.structuredSignals?.projectId ?? input.canonicalManifest?.projectId ?? null,
    surveyId: input.surveyId ?? input.structuredSignals?.surveyId ?? input.canonicalManifest?.surveyId ?? null,
    source: input.structuredSignals && signals.length > 0 ? 'structured_engineering_signals' : 'not_loaded',
    contexts: contextsWithRanks,
    authoritativeContexts: contextsWithRanks.filter(context => context.status === 'authoritative'),
    preferredContexts: contextsWithRanks.filter(context => context.status === 'preferred'),
    partialContexts: contextsWithRanks.filter(context => context.status === 'partial'),
    conflictingContexts: contextsWithRanks.filter(context => context.status === 'conflicting'),
    blockedContexts: contextsWithRanks.filter(context => context.status === 'blocked'),
    unresolvedContexts: contextsWithRanks.filter(context => context.status === 'unresolved'),
    notApplicableContexts: contextsWithRanks.filter(context => context.status === 'not_applicable'),
    conflicts,
    fallbackParticipation,
    cadReadinessMappings,
    dependencyGraph,
    timeline,
    staleImpacts,
    deterministicNotes: [
      `Engineering Context Resolution V1 evaluated ${contextsWithRanks.length} deterministic context definition(s).`,
      'Contexts are arbitration metadata over structured engineering signals, canonical evidence ids, deterministic grouping metadata, invalidation metadata, and stale-impact lineage only.',
      'Conflicting, unresolved, fallback-dependent, blocked, partial, and not_applicable contexts remain visible and are not silently promoted.',
      'Context ranking is deterministic and replayable; it does not use model weights, randomness, text/vision extraction runtimes, pixel inspection, geometry inference, plan-output creation, or operator-free engineering decisions.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function evaluateContext(definition: EngineeringContextDefinition, input: BuildEngineeringContextResolutionInput & { generatedAt: string; signals: StructuredEngineeringSignal[]; lookup: ContextSignalLookup }): ResolvedEngineeringContext {
  const primarySignals = signalsFor(input.lookup, definition.primarySignalTypes);
  const supportingSignals = signalsFor(input.lookup, definition.supportingSignalTypes);
  const candidateSignals = sortBy([...primarySignals, ...supportingSignals], signal => signal.id);
  const confirmedPrimary = primarySignals.filter(signal => signal.status === 'confirmed');
  const partialPrimary = primarySignals.filter(signal => signal.status === 'partial');
  const confirmedSupporting = supportingSignals.filter(signal => signal.status === 'confirmed');
  const partialSupporting = supportingSignals.filter(signal => signal.status === 'partial');
  const blockedSignals = candidateSignals.filter(signal => signal.status === 'blocked' || signal.status === 'missing');
  const notApplicableSignals = candidateSignals.filter(signal => signal.status === 'not_applicable');
  const activeSignals = candidateSignals.filter(signal => signal.status === 'confirmed' || signal.status === 'partial');
  const competingSignals = competingSignalsFor(candidateSignals);
  const explicitPrimaryPresent = confirmedPrimary.length > 0 || partialPrimary.length > 0;
  const allCandidateSignalsNotApplicable = candidateSignals.length > 0 && candidateSignals.length === notApplicableSignals.length;
  const unresolvedDependencies = sortText([
    ...blockedSignals.map(signal => `blocked structured signal:${signal.id}`),
    ...(primarySignals.length === 0 ? definition.primarySignalTypes.map(type => `missing primary signal type:${type}`) : []),
    ...(definition.explicitPrimaryRequired && !explicitPrimaryPresent && !definition.optionalWhenPrimaryAbsent ? ['explicit primary context required'] : []),
  ]);
  const conflictReasoning = conflictReasoningFor(definition, competingSignals, candidateSignals);
  const fallbackLineage = fallbackLineageFor(definition, input.cadReadiness ?? null, candidateSignals, explicitPrimaryPresent, input.structuredSignals?.fallbackParticipation ?? []);
  const status = statusFor({ definition, confirmedPrimaryCount: confirmedPrimary.length, partialPrimaryCount: partialPrimary.length, confirmedSupportingCount: confirmedSupporting.length, partialSupportingCount: partialSupporting.length, blockedCount: blockedSignals.length, activeSignalCount: activeSignals.length, competingSignalCount: competingSignals.length, explicitPrimaryPresent, allCandidateSignalsNotApplicable, unresolvedDependencyCount: unresolvedDependencies.length });
  const confidence = rankingFor({ definition, status, primarySignals, supportingSignals, activeSignals, competingSignals, blockedSignals, fallbackLineage, invalidationPropagation: input.invalidationPropagation ?? null, photoGrouping: input.photoGrouping ?? null, canonicalManifest: input.canonicalManifest ?? null });
  const sourceEvidenceIds = sortText(candidateSignals.flatMap(signal => signal.sourceEvidenceIds));
  const sourceMetadataIds = sortText([
    ...candidateSignals.flatMap(signal => signal.dependencyNodes.filter(node => node.startsWith('photoGrouping:') || node.startsWith('groupedReadiness:'))),
    ...(input.photoGrouping?.sequenceBreakpoints ?? []).map((breakpoint, index) => `sequenceBreakpoint:${index}:${breakpoint.reason}`),
    ...(input.photoGrouping?.metadataCompletenessScores ?? []).filter(score => score.score < 0.7).map(score => `metadataCompleteness:${score.evidenceId}:${score.score}`),
  ]);
  const dependencyLineage = sortText(candidateSignals.flatMap(signal => signal.dependencyNodes));
  const invalidationLineage = sortText([
    ...candidateSignals.flatMap(signal => signal.invalidatedBy),
    ...(input.invalidationPropagation?.sourceNodeIds ?? []).filter(nodeId => sourceEvidenceIds.some(evidenceId => nodeId.includes(evidenceId))),
  ]);
  const staleImpactPropagation = sortText(candidateSignals.flatMap(signal => signal.staleImpacts));
  const regenerationParticipation = sortText([
    ...(input.invalidationPropagation?.affectedStateIds ?? []).filter(stateId => dependencyLineage.some(node => node.includes(stateId))),
    ...invalidationLineage.map(id => `regeneration-review:${id}`),
  ]);
  const id = `context:${definition.contextType}`;
  const rankingReason = rankingReasonFor(definition, status, confidence.factors, confidence.penalties, competingSignals);
  const contextCore = {
    id,
    contextType: definition.contextType,
    domain: definition.domain,
    status,
    sourceSignalIds: sortText(primarySignals.map(signal => signal.id)),
    supportingSignalIds: sortText(supportingSignals.map(signal => signal.id)),
    competingSignalIds: sortText(competingSignals.map(signal => signal.id)),
    sourceEvidenceIds,
    sourceMetadataIds,
    dependencyLineage,
    invalidationLineage,
    staleImpactPropagation,
    regenerationParticipation,
    affectedOutputs: sortText(definition.affectedOutputs),
    cadReadinessImpacts: sortText(definition.cadImpacts) as CADReadinessFlagId[],
    requirementImpacts: sortText(definition.requirementImpacts),
    decisionImpacts: sortText(definition.decisionImpacts),
    confidence,
    rankingReason,
    conflictReasoning,
    fallbackLineage,
    unresolvedDependencies,
    fallbackConfidencePenalties: fallbackLineage.map(fallback => `fallback penalty applied:${fallback}`),
  };
  return { ...contextCore, deterministicHash: stableHash(contextCore) };
}

function buildSignalLookup(signals: StructuredEngineeringSignal[]): ContextSignalLookup {
  const lookup: ContextSignalLookup = new Map();
  for (const signal of signals) {
    const list = lookup.get(signal.signal_type) ?? [];
    list.push(signal);
    lookup.set(signal.signal_type, sortBy(list, item => item.id));
  }
  return lookup;
}

function signalsFor(lookup: ContextSignalLookup, signalTypes: StructuredEngineeringSignalType[]): StructuredEngineeringSignal[] {
  return sortBy(signalTypes.flatMap(type => lookup.get(type) ?? []), signal => signal.id);
}

function competingSignalsFor(signals: StructuredEngineeringSignal[]): StructuredEngineeringSignal[] {
  const evidenceOwners = new Map<string, string[]>();
  for (const signal of signals) {
    for (const evidenceId of signal.sourceEvidenceIds) {
      const owners = evidenceOwners.get(evidenceId) ?? [];
      evidenceOwners.set(evidenceId, [...owners, signal.id]);
    }
  }
  const duplicatedEvidenceSignalIds = new Set([...evidenceOwners.values()].filter(ids => ids.length > 1).flat());
  return signals.filter(signal => signal.status === 'partial' || signal.status === 'blocked' || signal.status === 'missing' || signal.invalidatedBy.length > 0 || duplicatedEvidenceSignalIds.has(signal.id));
}

function statusFor(input: { definition: EngineeringContextDefinition; confirmedPrimaryCount: number; partialPrimaryCount: number; confirmedSupportingCount: number; partialSupportingCount: number; blockedCount: number; activeSignalCount: number; competingSignalCount: number; explicitPrimaryPresent: boolean; allCandidateSignalsNotApplicable: boolean; unresolvedDependencyCount: number }): EngineeringContextStatus {
  if (input.allCandidateSignalsNotApplicable) return 'not_applicable';
  if (input.competingSignalCount > 1) return 'conflicting';
  if (input.definition.explicitPrimaryRequired && !input.explicitPrimaryPresent && input.confirmedSupportingCount + input.partialSupportingCount > 0) return 'blocked';
  if (input.blockedCount > 0) return 'blocked';
  if (input.definition.explicitPrimaryRequired && !input.explicitPrimaryPresent && input.definition.optionalWhenPrimaryAbsent) return 'not_applicable';
  if (input.definition.explicitPrimaryRequired && !input.explicitPrimaryPresent) return 'unresolved';
  if (input.confirmedPrimaryCount > 0 && input.confirmedSupportingCount > 0) return 'authoritative';
  if (input.confirmedPrimaryCount > 0) return 'preferred';
  if (input.partialPrimaryCount > 0 || input.confirmedSupportingCount > 0 || input.partialSupportingCount > 0) return 'partial';
  if (input.activeSignalCount === 0 && input.unresolvedDependencyCount > 0) return 'unresolved';
  return 'unresolved';
}

function rankingFor(input: { definition: EngineeringContextDefinition; status: EngineeringContextStatus; primarySignals: StructuredEngineeringSignal[]; supportingSignals: StructuredEngineeringSignal[]; activeSignals: StructuredEngineeringSignal[]; competingSignals: StructuredEngineeringSignal[]; blockedSignals: StructuredEngineeringSignal[]; fallbackLineage: string[]; invalidationPropagation: EngineeringInvalidationPropagationResult | null; photoGrouping: DeterministicPhotoGroupingModel | null; canonicalManifest: SurveyEvidenceManifest | null }): EngineeringContextConfidence {
  let score = 0;
  const factors: string[] = [];
  const penalties: string[] = [];
  const confirmedPrimaryCount = input.primarySignals.filter(signal => signal.status === 'confirmed').length;
  const partialPrimaryCount = input.primarySignals.filter(signal => signal.status === 'partial').length;
  const confirmedSupportingCount = input.supportingSignals.filter(signal => signal.status === 'confirmed').length;
  const partialSupportingCount = input.supportingSignals.filter(signal => signal.status === 'partial').length;
  if (confirmedPrimaryCount > 0) { score += confirmedPrimaryCount * 32; factors.push(`${confirmedPrimaryCount} confirmed primary signal(s)`); }
  if (partialPrimaryCount > 0) { score += partialPrimaryCount * 16; factors.push(`${partialPrimaryCount} partial primary signal(s)`); }
  if (confirmedSupportingCount > 0) { score += Math.min(24, confirmedSupportingCount * 12); factors.push(`${confirmedSupportingCount} confirmed supporting signal(s)`); }
  if (partialSupportingCount > 0) { score += Math.min(12, partialSupportingCount * 6); factors.push(`${partialSupportingCount} partial supporting signal(s)`); }
  const averageSignalConfidence = input.activeSignals.length > 0 ? input.activeSignals.reduce((sum, signal) => sum + signal.confidence.score, 0) / input.activeSignals.length : 0;
  if (averageSignalConfidence > 0) { score += Math.round(averageSignalConfidence * 18); factors.push(`average structured-signal confidence ${averageSignalConfidence.toFixed(2)}`); }
  if ((input.photoGrouping?.surveyTraversalOrder.length ?? 0) > 0) { score += 3; factors.push('deterministic traversal metadata present'); }
  if ((input.canonicalManifest?.items.length ?? 0) > 0) { score += 3; factors.push('canonical evidence manifest present'); }
  if (input.invalidationPropagation) { score += 2; factors.push('invalidation propagation metadata linked'); }
  if (input.competingSignals.length > 0) { score -= Math.min(18, input.competingSignals.length * 5); penalties.push(`${input.competingSignals.length} competing/unstable signal(s)`); }
  if (input.blockedSignals.length > 0) { score -= Math.min(24, input.blockedSignals.length * 8); penalties.push(`${input.blockedSignals.length} blocked/missing signal(s)`); }
  if (input.fallbackLineage.length > 0) { score -= Math.min(20, input.fallbackLineage.length * 5); penalties.push(`${input.fallbackLineage.length} fallback lineage item(s)`); }
  if (input.status === 'authoritative') score += 8;
  if (input.status === 'conflicting') score = Math.min(score, 62);
  if (input.status === 'partial') score = Math.min(score, 58);
  if (input.status === 'blocked' || input.status === 'unresolved' || input.status === 'not_applicable') score = Math.min(score, 20);
  score = Math.max(0, Math.min(100, score));
  const band = score >= 76 ? 'high' : score >= 45 ? 'medium' : score > 0 ? 'low' : 'none';
  return { score, band, rank: 0, factors: sortText(factors), penalties: sortText(penalties) };
}

function conflictReasoningFor(definition: EngineeringContextDefinition, competingSignals: StructuredEngineeringSignal[], candidateSignals: StructuredEngineeringSignal[]): string[] {
  const reasons: string[] = [];
  const activePrimary = candidateSignals.filter(signal => definition.primarySignalTypes.includes(signal.signal_type) && (signal.status === 'confirmed' || signal.status === 'partial'));
  if (activePrimary.length > 1) reasons.push(`Multiple active primary signal candidates remain visible: ${activePrimary.map(signal => signal.id).sort().join(', ')}.`);
  const partial = competingSignals.filter(signal => signal.status === 'partial');
  if (partial.length > 0) reasons.push(`Partial competing signal support remains visible: ${partial.map(signal => signal.id).sort().join(', ')}.`);
  const blocked = competingSignals.filter(signal => signal.status === 'blocked' || signal.status === 'missing');
  if (blocked.length > 0) reasons.push(`Blocked or missing signal support remains visible: ${blocked.map(signal => signal.id).sort().join(', ')}.`);
  const invalidated = competingSignals.filter(signal => signal.invalidatedBy.length > 0);
  if (invalidated.length > 0) reasons.push(`Invalidated signal lineage remains visible: ${invalidated.map(signal => signal.id).sort().join(', ')}.`);
  return sortText(reasons);
}

function fallbackLineageFor(
  definition: EngineeringContextDefinition,
  cadReadiness: CADReadinessMetadataModel | null,
  candidateSignals: StructuredEngineeringSignal[],
  explicitPrimaryPresent: boolean,
  signalFallbackParticipation: StructuredEngineeringSignalSummary['fallbackParticipation'],
): string[] {
  const linkedFlags = cadReadiness?.flags.filter(flag => definition.cadImpacts.includes(flag.flagId)) ?? [];
  const candidateSignalIds = new Set(candidateSignals.map(signal => signal.id));
  const linkedSignalFallbacks = signalFallbackParticipation
    .filter(row => candidateSignalIds.has(row.signalId))
    .map(row => `structured-signal-fallback:${row.signalId}:${row.fallback}`);

  return sortText([
    ...(definition.fallbackAllowed ? [`context-definition:${definition.contextType}:fallback_allowed`] : []),
    ...(definition.explicitPrimaryRequired && !explicitPrimaryPresent ? [`context-definition:${definition.contextType}:explicit_primary_absent`] : []),
    ...linkedFlags.flatMap(flag => flag.defaultPolicyFallbacks.map(fallback => `cad-readiness:${flag.flagId}:${fallback}`)),
    ...candidateSignals.flatMap(signal => signal.blockingReasons.map(reason => `signal:${signal.id}:${reason}`)),
    ...linkedSignalFallbacks,
  ]);
}

function buildConflicts(contexts: ResolvedEngineeringContext[]): EngineeringContextResolutionSummary['conflicts'] {
  return contexts.filter(context => context.status === 'conflicting' || context.competingSignalIds.length > 0 || context.conflictReasoning.length > 0).map(context => ({ conflictId: `conflict:${context.contextType}`, contextId: context.id, contextType: context.contextType, domain: context.domain, competingContextIds: [context.id], competingSignalIds: context.competingSignalIds, conflictReasoning: context.conflictReasoning, deterministicResolutionPolicy: 'Do not collapse competing signals. Preserve conflict metadata for operator review and downstream invalidation awareness.' })).sort((a, b) => a.conflictId.localeCompare(b.conflictId));
}

function buildCADMappings(contexts: ResolvedEngineeringContext[]): EngineeringContextResolutionSummary['cadReadinessMappings'] {
  const flagIds = sortText(contexts.flatMap(context => context.cadReadinessImpacts));
  return flagIds.map(flagId => {
    const linked = contexts.filter(context => context.cadReadinessImpacts.includes(flagId));
    return {
      flagId,
      contextIds: linked.map(context => context.id).sort(),
      authoritativeContextIds: linked.filter(context => context.status === 'authoritative').map(context => context.id).sort(),
      preferredContextIds: linked.filter(context => context.status === 'preferred').map(context => context.id).sort(),
      partialContextIds: linked.filter(context => context.status === 'partial').map(context => context.id).sort(),
      conflictingContextIds: linked.filter(context => context.status === 'conflicting').map(context => context.id).sort(),
      blockedContextIds: linked.filter(context => context.status === 'blocked').map(context => context.id).sort(),
      unresolvedContextIds: linked.filter(context => context.status === 'unresolved').map(context => context.id).sort(),
    };
  });
}

function buildDependencyGraph(contexts: ResolvedEngineeringContext[]): EngineeringContextResolutionSummary['dependencyGraph'] {
  const nodes = new Map<string, EngineeringContextResolutionSummary['dependencyGraph']['nodes'][number]>();
  const edges = new Map<string, EngineeringContextResolutionSummary['dependencyGraph']['edges'][number]>();
  const putEdge = (edge: EngineeringContextResolutionSummary['dependencyGraph']['edges'][number]) => {
    if (!edges.has(edge.edgeId)) edges.set(edge.edgeId, edge);
  };

  for (const context of contexts) {
    nodes.set(context.id, { nodeId: context.id, label: context.contextType, nodeType: 'context', status: context.status });
    for (const signalId of [...context.sourceSignalIds, ...context.supportingSignalIds]) {
      nodes.set(signalId, { nodeId: signalId, label: signalId, nodeType: 'signal', status: 'source' });
      putEdge({ edgeId: `edge:${signalId}->${context.id}`, sourceNodeId: signalId, targetNodeId: context.id, edgeType: 'supports', deterministicReason: 'Structured signal participates in resolved context arbitration.' });
    }
    for (const evidenceId of context.sourceEvidenceIds) {
      const nodeId = `evidence:${evidenceId}`;
      nodes.set(nodeId, { nodeId, label: evidenceId, nodeType: 'evidence', status: 'source' });
      putEdge({ edgeId: `edge:${nodeId}->${context.id}`, sourceNodeId: nodeId, targetNodeId: context.id, edgeType: 'derived_from', deterministicReason: 'Canonical evidence id is carried through structured signal lineage.' });
    }
    for (const metadataId of context.sourceMetadataIds) nodes.set(metadataId, { nodeId: metadataId, label: metadataId, nodeType: 'metadata', status: 'deterministic_metadata' });
    for (const flagId of context.cadReadinessImpacts) {
      const nodeId = `cad:${flagId}`;
      nodes.set(nodeId, { nodeId, label: flagId, nodeType: 'cad_readiness', status: 'mapped' });
      putEdge({ edgeId: `edge:${context.id}->${nodeId}`, sourceNodeId: context.id, targetNodeId: nodeId, edgeType: 'impacts_cad_readiness', deterministicReason: 'Context status participates in CAD-readiness runtime inspection metadata.' });
    }
    for (const requirementId of context.requirementImpacts) {
      const nodeId = `requirement:${requirementId}`;
      nodes.set(nodeId, { nodeId, label: requirementId, nodeType: 'requirement', status: 'mapped' });
      putEdge({ edgeId: `edge:${context.id}->${nodeId}`, sourceNodeId: context.id, targetNodeId: nodeId, edgeType: 'impacts_requirement', deterministicReason: 'Context definition declares requirement impact without creating a new requirement truth source.' });
    }
    for (const decisionId of context.decisionImpacts) {
      nodes.set(decisionId, { nodeId: decisionId, label: decisionId, nodeType: 'decision', status: 'mapped' });
      putEdge({ edgeId: `edge:${context.id}->${decisionId}`, sourceNodeId: context.id, targetNodeId: decisionId, edgeType: 'impacts_decision', deterministicReason: 'Context definition declares downstream decision participation metadata.' });
    }
    for (const invalidationId of context.invalidationLineage) {
      const nodeId = `invalidation:${invalidationId}`;
      nodes.set(nodeId, { nodeId, label: invalidationId, nodeType: 'invalidation', status: 'invalidates' });
      putEdge({ edgeId: `edge:${nodeId}->${context.id}`, sourceNodeId: nodeId, targetNodeId: context.id, edgeType: 'invalidated_by', deterministicReason: 'Invalidation lineage is preserved in resolved context metadata.' });
    }
    for (const competingSignalId of context.competingSignalIds) {
      putEdge({ edgeId: `edge:${competingSignalId}<->${context.id}:competes`, sourceNodeId: competingSignalId, targetNodeId: context.id, edgeType: 'competes_with', deterministicReason: 'Competing or unstable signal remains visible in context arbitration metadata.' });
    }
  }
  return { nodes: [...nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)), edges: [...edges.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId)) };
}

function rankingReasonFor(definition: EngineeringContextDefinition, status: EngineeringContextStatus, factors: string[], penalties: string[], competingSignals: StructuredEngineeringSignal[]): string {
  return `${definition.deterministicPurpose} Status ${status}. Ranking factors: ${factors.join('; ') || 'none'}. Penalties: ${penalties.join('; ') || 'none'}. Competing signals: ${competingSignals.map(signal => signal.id).sort().join(', ') || 'none'}.`;
}

function stableHash(value: unknown): string {
  return `ecr_${crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex').slice(0, 24)}`;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

function prohibitedRuntimeBehavior() {
  return [
    'no text extraction runtime over survey imagery',
    'no computer-vision runtime dependency',
    'no vision model runtime dependency',
    'no pixel inspection or image-byte inspection',
    'no semantic visual interpretation',
    'no detected-object promotion',
    'no language-model reasoning over context gaps',
    'no geometry fabrication',
    'no operator-free plan-output creation',
    'no operator-free engineering decisioning',
    'no hidden fallback promotion',
    'no silent conflict resolution',
    'no autonomous regeneration',
  ];
}
