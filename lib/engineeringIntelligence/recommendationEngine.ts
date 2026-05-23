import type { CADReadinessFlag, CADReadinessFlagId } from './cadReadiness';
import type { ResolvedEngineeringContext } from './contextTypes';
import type { EngineeringAffectedOutputImpact } from './invalidationEngine';
import { getEngineeringRecommendationDefinition } from './recommendationRegistry';
import { rankEngineeringRecommendations, stableRecommendationHash, uniqueSorted } from './recommendationRanking';
import { scoreEngineeringRecommendation } from './recommendationScoring';
import type {
  EngineeringRecommendation,
  EngineeringRecommendationCategory,
  EngineeringRecommendationConfidence,
  EngineeringRecommendationEngineInput,
  EngineeringRecommendationPriority,
  EngineeringRecommendationSeverity,
  EngineeringRecommendationSummary,
  EngineeringRecommendationType,
} from './recommendationTypes';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalType } from './signalTypes';

const DEFAULT_GENERATED_AT = new Date(0).toISOString();

const signalRecommendationType: Partial<Record<StructuredEngineeringSignalType, EngineeringRecommendationType>> = {
  main_service_panel_present: 'collect_msp_photo',
  main_disconnect_present: 'collect_disconnect_photo',
  attic_access_confirmed: 'collect_attic_photo',
  structural_access_context_present: 'collect_attic_photo',
  roof_edge_context_present: 'collect_roof_edge_context',
  routing_continuity_present: 'collect_routing_context',
  conduit_route_candidate_present: 'collect_routing_context',
  trench_path_explicit: 'collect_trench_path',
  trench_context_present: 'collect_trench_path',
  detached_structure_present: 'collect_detached_structure_context',
  detached_structure_route_candidate: 'collect_detached_structure_context',
  ess_location_candidate_present: 'collect_ess_wall_context',
  battery_wall_candidate_present: 'collect_ess_wall_context',
  energy_storage_context_present: 'collect_ess_wall_context',
  survey_traversal_complete: 'improve_traversal_continuity',
  survey_sequence_continuity_good: 'improve_traversal_continuity',
  evidence_grouping_stable: 'improve_grouping_stability',
  photo_cluster_confidence_high: 'improve_grouping_stability',
};

const cadRecommendationType: Partial<Record<CADReadinessFlagId, EngineeringRecommendationType>> = {
  'roof-plane-ready': 'resolve_roof_context',
  'routing-ready': 'resolve_routing_ambiguity',
  'setback-ready': 'collect_roof_edge_context',
  'trench-route-ready': 'collect_trench_path',
  'detached-structure-ready': 'collect_detached_structure_context',
  'ESS-location-ready': 'collect_ess_wall_context',
};

const simulationRecommendationType: Array<{ match: RegExp; type: EngineeringRecommendationType }> = [
  { match: /msp|main_service_panel|main-panel/i, type: 'simulate_msp_confirmation' },
  { match: /roof|setback|attic|structural/i, type: 'simulate_roof_context_improvement' },
  { match: /routing|conduit|route/i, type: 'simulate_routing_confirmation' },
  { match: /trench/i, type: 'simulate_trench_resolution' },
];

export function buildEngineeringRecommendations(input: EngineeringRecommendationEngineInput): EngineeringRecommendationSummary {
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;
  const candidates: EngineeringRecommendation[] = [];
  const signals = input.structuredSignals?.signals ?? [];
  const contexts = input.contextResolution?.contexts ?? [];
  const propagation = input.invalidationPropagation ?? null;
  const regenerationPlan = input.regenerationPlan ?? null;
  const scenarios = input.scenarioSimulations ?? [];

  for (const signal of signals) {
    if (signal.status === 'missing' || signal.status === 'blocked' || signal.status === 'partial') {
      const type = signalRecommendationType[signal.signal_type] ?? signalTypeFallback(signal.signal_type);
      candidates.push(makeRecommendation({
        input,
        generatedAt,
        type,
        severity: signal.status === 'blocked' || signal.status === 'missing' ? 'blocked' : 'quality_gap',
        confidence: confidenceFromScore(signal.confidence.score),
        explanation: `${definitionText(type)} Current deterministic signal ${signal.id} is ${signal.status}; recommendation preserves uncertainty and requests only explicit evidence or metadata improvement.`,
        affectedEvidenceIds: signal.sourceEvidenceIds,
        affectedSignalIds: [signal.id],
        affectedSignalTypes: [signal.signal_type],
        affectedRequirementIds: signal.requirementImpacts,
        affectedDecisionIds: signal.decisionImpacts,
        cadReadinessImpact: signal.cadImpacts,
        staleImpactParticipation: signal.staleImpacts.length ? [{ entityId: signal.id, staleClasses: signal.staleImpacts, deterministicReason: 'Signal participates in stale-impact metadata.' }] : [],
        invalidationParticipation: signal.invalidatedBy,
        fallbackParticipation: fallbackForSignal(input, signal.id),
        unresolvedStatesPreserved: [...signal.blockingReasons, ...signal.partialReasons],
        scoreInput: {
          staleImpactCount: signal.staleImpacts.length,
          affectedOutputCount: contextOutputsForSignal(contexts, signal.id).length,
          blockedRequirementCount: signal.requirementImpacts.length && (signal.status === 'blocked' || signal.status === 'missing') ? signal.requirementImpacts.length : 0,
          cadReadinessImpact: signal.cadImpacts.length,
          fallbackParticipation: fallbackForSignal(input, signal.id).length,
          unresolvedDependencyCount: signal.blockingReasons.length + signal.partialReasons.length,
          contextAuthorityWeakness: 1 - signal.confidence.score,
          expectedConfidenceGain: expectedSignalGain(signal),
          expectedReadinessGain: signal.cadImpacts.length > 0 ? 0.2 : 0,
          deterministicReason: `Score is derived from signal ${signal.id} status=${signal.status}, linked requirements, CAD impacts, stale impacts, fallback metadata, and confidence band.`,
        },
      }));
    }
  }

  for (const context of contexts) {
    if (context.status === 'conflicting' || context.status === 'blocked' || context.status === 'unresolved' || context.status === 'partial' || context.fallbackLineage.length > 0) {
      const type = contextRecommendationType(context);
      candidates.push(makeRecommendation({
        input,
        generatedAt,
        type,
        severity: context.status === 'conflicting' ? 'review_required' : context.status === 'blocked' ? 'blocked' : context.fallbackLineage.length ? 'stale_risk' : 'quality_gap',
        confidence: confidenceFromScore(context.confidence.score),
        explanation: `${definitionText(type)} Context ${context.id} remains ${context.status}; unresolved, conflicting, and fallback lineage are exposed rather than collapsed.`,
        affectedEvidenceIds: context.sourceEvidenceIds,
        affectedSignalIds: uniqueSorted([...context.sourceSignalIds, ...context.supportingSignalIds, ...context.competingSignalIds]),
        affectedContextIds: [context.id],
        affectedContextTypes: [context.contextType],
        affectedRequirementIds: context.requirementImpacts,
        affectedDecisionIds: context.decisionImpacts,
        affectedOutputIds: context.affectedOutputs,
        cadReadinessImpact: context.cadReadinessImpacts,
        staleImpactParticipation: context.staleImpactPropagation.length ? [{ entityId: context.id, staleClasses: context.staleImpactPropagation, deterministicReason: 'Context participates in stale-impact propagation metadata.' }] : [],
        invalidationParticipation: context.invalidationLineage,
        regenerationParticipation: context.regenerationParticipation,
        fallbackParticipation: context.fallbackLineage,
        conflictParticipation: context.conflictReasoning,
        dependencyTraversal: pathsForNodes(input, context.dependencyLineage),
        unresolvedStatesPreserved: [...context.unresolvedDependencies, ...context.fallbackConfidencePenalties, ...context.conflictReasoning],
        scoreInput: {
          staleImpactCount: context.staleImpactPropagation.length,
          affectedOutputCount: context.affectedOutputs.length,
          invalidationPropagationDepth: maxDepth(pathsForNodes(input, context.dependencyLineage)),
          blockedRequirementCount: context.status === 'blocked' || context.status === 'unresolved' ? context.requirementImpacts.length : 0,
          cadReadinessImpact: context.cadReadinessImpacts.length,
          conflictSeverity: context.conflictReasoning.length + context.competingSignalIds.length + (context.status === 'conflicting' ? 2 : 0),
          fallbackParticipation: context.fallbackLineage.length,
          unresolvedDependencyCount: context.unresolvedDependencies.length,
          dependencyTraversalCentrality: context.dependencyLineage.length,
          contextAuthorityWeakness: context.status === 'authoritative' ? 0 : Math.max(0, 1 - context.confidence.score),
          expectedConfidenceGain: expectedContextGain(context),
          expectedReadinessGain: context.cadReadinessImpacts.length > 0 ? 0.25 : 0,
          deterministicReason: `Score is derived from context ${context.id} status=${context.status}, conflicts, fallback lineage, unresolved dependencies, output impacts, and CAD readiness impacts.`,
        },
      }));
    }
  }

  for (const flag of input.cadReadiness?.flags ?? []) {
    if (flag.status === 'blocked' || flag.status === 'partial') {
      candidates.push(recommendForCadFlag(input, generatedAt, flag));
    }
  }

  for (const output of propagation?.affectedOutputs ?? []) {
    candidates.push(recommendForAffectedOutput(input, generatedAt, output));
  }

  if (regenerationPlan && regenerationPlan.planItems.length > 0) {
    candidates.push(makeRecommendation({
      input,
      generatedAt,
      type: 'reduce_stale_outputs',
      severity: regenerationPlan.reviewRequiredIds.length ? 'review_required' : 'stale_risk',
      confidence: 'medium',
      explanation: 'Reduce stale outputs by reviewing metadata-only regeneration candidates. This does not imply automatic regeneration or output correctness.',
      affectedRequirementIds: regenerationPlan.planItems.flatMap(item => item.missingEvidenceIds.map(id => id.replace('missingEvidenceForRequirement:', ''))),
      affectedDecisionIds: regenerationPlan.planItems.flatMap(item => item.invalidatedDecisionIds),
      affectedOutputIds: regenerationPlan.regenerationCandidateIds,
      staleImpactParticipation: regenerationPlan.planItems.map(item => ({ entityId: item.affectedStateId, staleClasses: [item.staleClass], deterministicReason: item.deterministicReason })),
      invalidationParticipation: uniqueSorted(regenerationPlan.planItems.map(item => item.sourceTriggerId ?? undefined)),
      regenerationParticipation: regenerationPlan.regenerationCandidateIds,
      dependencyTraversal: pathsByIds(input, regenerationPlan.propagationPathIds),
      unresolvedStatesPreserved: uniqueSorted([...regenerationPlan.blockedDependencyIds, ...regenerationPlan.missingEvidenceIds, ...regenerationPlan.reviewRequiredIds]),
      scoreInput: {
        staleImpactCount: regenerationPlan.planItems.length,
        affectedOutputCount: regenerationPlan.regenerationCandidateIds.length,
        blockedRequirementCount: regenerationPlan.reviewRequiredIds.length,
        unresolvedDependencyCount: regenerationPlan.blockedDependencyIds.length + regenerationPlan.missingEvidenceIds.length,
        dependencyTraversalCentrality: regenerationPlan.propagationPathIds.length,
        expectedReadinessGain: 0.2,
        deterministicReason: 'Score is derived from regeneration planning metadata: candidate count, review-required ids, missing evidence, blocked dependencies, and path participation.',
      },
    }));
  }

  for (const scenario of scenarios) {
    candidates.push(recommendForScenario(input, generatedAt, scenario));
  }

  const allRanked = rankEngineeringRecommendations(dedupeRecommendations(candidates));
  const ranked = typeof input.maxRecommendations === 'number' ? allRanked.slice(0, input.maxRecommendations) : allRanked;
  const unresolvedStatesPreserved = uniqueSorted(ranked.flatMap(recommendation => recommendation.unresolvedStatesPreserved));
  const deterministicHash = stableRecommendationHash({
    projectId: input.projectId ?? input.structuredSignals?.projectId ?? input.contextResolution?.projectId ?? input.cadReadiness?.projectId ?? null,
    surveyId: input.surveyId ?? input.structuredSignals?.surveyId ?? input.contextResolution?.surveyId ?? input.cadReadiness?.surveyId ?? null,
    recommendations: ranked.map(recommendation => ({ id: recommendation.recommendationId, score: recommendation.deterministicScore, hash: recommendation.deterministicHash })),
  }, 'engineering-recommendations-v1');

  return {
    modelVersion: 'engineering_recommendations_v1',
    projectId: input.projectId ?? input.structuredSignals?.projectId ?? input.contextResolution?.projectId ?? input.cadReadiness?.projectId ?? null,
    surveyId: input.surveyId ?? input.structuredSignals?.surveyId ?? input.contextResolution?.surveyId ?? input.cadReadiness?.surveyId ?? null,
    generatedAt,
    mode: 'deterministic_guidance_only',
    recommendations: ranked,
    highestValueNextActions: ranked.slice(0, 10),
    surveyRecommendations: ranked.filter(recommendation => recommendation.category === 'survey'),
    conflictResolutionRecommendations: ranked.filter(recommendation => recommendation.conflictParticipation.length > 0 || recommendation.recommendationType === 'resolve_conflicting_context'),
    fallbackReductionRecommendations: ranked.filter(recommendation => recommendation.fallbackParticipation.length > 0 || recommendation.recommendationType === 'reduce_fallback_dependency'),
    cadReadinessRecommendations: ranked.filter(recommendation => recommendation.cadReadinessImpact.length > 0 || recommendation.recommendationType === 'improve_cad_readiness'),
    simulationBackedRecommendations: ranked.filter(recommendation => recommendation.category === 'simulation' || recommendation.scoreBreakdown.scenarioSimulationImpact > 0),
    dependencyRiskRecommendations: ranked.filter(recommendation => recommendation.dependencyTraversal.length > 0 || recommendation.scoreBreakdown.dependencyTraversalCentrality > 0),
    staleImpactRecommendations: ranked.filter(recommendation => recommendation.staleImpactParticipation.length > 0 || recommendation.scoreBreakdown.staleImpactCount > 0),
    confidenceBreakdown: ranked.map(recommendation => ({
      recommendationId: recommendation.recommendationId,
      confidence: recommendation.confidence,
      expectedConfidenceGain: recommendation.expectedConfidenceGain,
      expectedReadinessGain: recommendation.expectedReadinessGain,
      deterministicScore: recommendation.deterministicScore,
      uncertaintyNotes: recommendation.uncertaintyNotes,
    })),
    unresolvedStatesPreserved,
    deterministicHash,
    deterministicNotes: [
      'Engineering Recommendations V1 is deterministic guidance only and never mutates canonical evidence, requirements, decisions, outputs, invalidation history, snapshots, CAD files, or regeneration plans.',
      'Recommendations are ranked from explicit deterministic metadata: stale impacts, affected outputs, propagation depth, blocked requirements, CAD readiness, conflicts, fallbacks, unresolved dependencies, graph centrality, scenario deltas, and expected deterministic gains.',
      'Uncertainty, conflicts, fallback lineage, missing evidence, and unresolved dependencies remain visible in every recommendation instead of being silently collapsed.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

interface RecommendationBuildInput {
  input: EngineeringRecommendationEngineInput;
  generatedAt: string;
  type: EngineeringRecommendationType;
  severity: EngineeringRecommendationSeverity;
  confidence: EngineeringRecommendationConfidence;
  explanation: string;
  affectedEvidenceIds?: string[];
  affectedSignalIds?: string[];
  affectedSignalTypes?: StructuredEngineeringSignalType[];
  affectedContextIds?: string[];
  affectedContextTypes?: import('./contextTypes').EngineeringContextType[];
  affectedRequirementIds?: string[];
  affectedDecisionIds?: string[];
  affectedOutputIds?: string[];
  staleImpactParticipation?: EngineeringRecommendation['staleImpactParticipation'];
  invalidationParticipation?: string[];
  regenerationParticipation?: string[];
  fallbackParticipation?: string[];
  conflictParticipation?: string[];
  dependencyTraversal?: EngineeringRecommendation['dependencyTraversal'];
  cadReadinessImpact?: CADReadinessFlagId[];
  unresolvedStatesPreserved?: string[];
  scoreInput: Parameters<typeof scoreEngineeringRecommendation>[0];
}

function makeRecommendation(args: RecommendationBuildInput): EngineeringRecommendation {
  const definition = getEngineeringRecommendationDefinition(args.type);
  const scoreBreakdown = scoreEngineeringRecommendation(args.scoreInput);
  const priority = priorityForScore(scoreBreakdown.deterministicScore);
  const expectedConfidenceGain = scoreBreakdown.expectedConfidenceGain;
  const expectedReadinessGain = scoreBreakdown.expectedReadinessGain;
  const unresolvedStatesPreserved = uniqueSorted(args.unresolvedStatesPreserved ?? []);
  const payload = {
    type: args.type,
    category: definition.category,
    scoreBreakdown,
    affectedEvidenceIds: uniqueSorted(args.affectedEvidenceIds ?? []),
    affectedSignalIds: uniqueSorted(args.affectedSignalIds ?? []),
    affectedContextIds: uniqueSorted(args.affectedContextIds ?? []),
    affectedRequirementIds: uniqueSorted(args.affectedRequirementIds ?? []),
    affectedDecisionIds: uniqueSorted(args.affectedDecisionIds ?? []),
    affectedOutputIds: uniqueSorted(args.affectedOutputIds ?? []),
    unresolvedStatesPreserved,
  };
  const deterministicHash = stableRecommendationHash(payload);
  const recommendationId = `${args.type}:${deterministicHash}`;
  const safetyNotes = [
    'Deterministic guidance only; does not imply certainty, engineering correctness, permit approval, completed CAD readiness, or completed regeneration.',
    'No production state is mutated by this recommendation.',
  ];
  const uncertaintyNotes = unresolvedStatesPreserved.length
    ? unresolvedStatesPreserved.map(state => `Unresolved state preserved: ${state}`)
    : ['No unresolved state was removed or inferred away by this recommendation.'];

  return {
    recommendationId,
    recommendationType: args.type,
    category: definition.category as EngineeringRecommendationCategory,
    priority,
    severity: args.severity,
    confidence: args.confidence,
    explanation: args.explanation,
    affectedEvidenceIds: uniqueSorted(args.affectedEvidenceIds ?? []),
    affectedSignalIds: uniqueSorted(args.affectedSignalIds ?? []),
    affectedSignalTypes: uniqueSignalTypes(args.affectedSignalTypes ?? []),
    affectedContextIds: uniqueSorted(args.affectedContextIds ?? []),
    affectedContextTypes: uniqueContextTypes(args.affectedContextTypes ?? []),
    affectedRequirementIds: uniqueSorted(args.affectedRequirementIds ?? []),
    affectedDecisionIds: uniqueSorted(args.affectedDecisionIds ?? []),
    affectedOutputIds: uniqueSorted(args.affectedOutputIds ?? []),
    staleImpactParticipation: args.staleImpactParticipation ?? [],
    invalidationParticipation: uniqueSorted(args.invalidationParticipation ?? []),
    regenerationParticipation: uniqueSorted(args.regenerationParticipation ?? []),
    fallbackParticipation: uniqueSorted(args.fallbackParticipation ?? []),
    conflictParticipation: uniqueSorted(args.conflictParticipation ?? []),
    dependencyTraversal: args.dependencyTraversal ?? [],
    cadReadinessImpact: uniqueCadFlags(args.cadReadinessImpact ?? []),
    expectedConfidenceGain,
    expectedReadinessGain,
    unresolvedStatesPreserved,
    uncertaintyNotes,
    safetyNotes,
    scoreBreakdown,
    deterministicScore: scoreBreakdown.deterministicScore,
    deterministicHash,
  };
}

function recommendForCadFlag(input: EngineeringRecommendationEngineInput, generatedAt: string, flag: CADReadinessFlag): EngineeringRecommendation {
  const type = cadRecommendationType[flag.flagId] ?? 'improve_cad_readiness';
  return makeRecommendation({
    input,
    generatedAt,
    type: flag.status === 'blocked' || flag.status === 'partial' ? type : 'improve_cad_readiness',
    severity: flag.status === 'blocked' ? 'blocked' : 'quality_gap',
    confidence: flag.status === 'blocked' ? 'medium' : 'low',
    explanation: `${definitionText(type)} CAD readiness flag ${flag.flagId} is ${flag.status}; recommendation targets explicit missing categories, unresolved assumptions, and context-linked readiness metadata only.`,
    affectedSignalIds: flag.structuredSignalIds,
    affectedContextIds: uniqueSorted([...flag.blockedContextIds, ...flag.unresolvedContextIds, ...flag.conflictingContextIds, ...flag.partialContextIds, ...flag.fallbackDependentContextIds]),
    cadReadinessImpact: [flag.flagId],
    fallbackParticipation: flag.defaultPolicyFallbacks,
    conflictParticipation: flag.conflictingContextIds,
    unresolvedStatesPreserved: uniqueSorted([...flag.unresolvedAssumptions, ...flag.defaultPolicyFallbacks]),
    scoreInput: {
      cadReadinessImpact: 1,
      conflictSeverity: flag.conflictingContextIds.length,
      fallbackParticipation: flag.defaultPolicyFallbacks.length + flag.fallbackDependentContextIds.length,
      unresolvedDependencyCount: flag.unresolvedAssumptions.length,
      contextAuthorityWeakness: flag.status === 'blocked' ? 1 : 0.5,
      expectedReadinessGain: flag.status === 'blocked' ? 0.4 : 0.2,
      deterministicReason: `Score is derived from CAD-readiness flag ${flag.flagId}, status=${flag.status}, unresolved assumptions, fallbacks, and conflicting contexts.`,
    },
  });
}

function recommendForAffectedOutput(input: EngineeringRecommendationEngineInput, generatedAt: string, output: EngineeringAffectedOutputImpact): EngineeringRecommendation {
  return makeRecommendation({
    input,
    generatedAt,
    type: output.staleClass === 'BLOCKED' || output.missingEvidenceIds.length > 0 ? 'resolve_blocked_requirement' : 'reduce_stale_outputs',
    severity: output.staleClass === 'BLOCKED' ? 'blocked' : output.staleClass === 'REQUIRES_REVIEW' ? 'review_required' : 'stale_risk',
    confidence: 'medium',
    explanation: `Output ${output.outputId} participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.`,
    affectedRequirementIds: output.missingEvidenceIds.map(id => id.replace('missingEvidenceForRequirement:', '')),
    affectedDecisionIds: output.invalidatedDecisionIds,
    affectedOutputIds: [output.outputId],
    staleImpactParticipation: [{ entityId: output.stateId, staleClasses: [output.staleClass], deterministicReason: output.deterministicReason }],
    invalidationParticipation: output.propagationPathIds,
    regenerationParticipation: [output.outputId],
    dependencyTraversal: pathsByIds(input, output.propagationPathIds),
    unresolvedStatesPreserved: uniqueSorted([...output.missingEvidenceIds, ...output.dependencyNodeIds]),
    scoreInput: {
      staleImpactCount: 1,
      affectedOutputCount: 1,
      invalidationPropagationDepth: maxDepth(pathsByIds(input, output.propagationPathIds)),
      blockedRequirementCount: output.missingEvidenceIds.length,
      unresolvedDependencyCount: output.dependencyNodeIds.length,
      dependencyTraversalCentrality: output.propagationPathIds.length,
      expectedReadinessGain: output.missingEvidenceIds.length > 0 ? 0.25 : 0.1,
      deterministicReason: `Score is derived from affected output ${output.outputId}, stale class ${output.staleClass}, missing evidence, decisions, and propagation paths.`,
    },
  });
}

function recommendForScenario(input: EngineeringRecommendationEngineInput, generatedAt: string, scenario: import('./scenarioSimulation').EngineeringScenarioSimulationResult): EngineeringRecommendation {
  const scenarioText = [scenario.scenarioId, ...scenario.affectedSignalIds, ...scenario.affectedContextIds, ...scenario.affectedRequirementIds, ...scenario.affectedOutputIds, ...scenario.operations.map(operation => operation.operationId)].join(' ');
  const type = simulationRecommendationType.find(candidate => candidate.match.test(scenarioText))?.type ?? 'simulate_routing_confirmation';
  return makeRecommendation({
    input,
    generatedAt,
    type,
    severity: scenario.conflictDeltas.length || scenario.unresolvedStateChanges.length ? 'review_required' : 'guidance',
    confidence: scenario.confidenceDeltas.length ? 'medium' : 'low',
    explanation: `${definitionText(type)} Scenario ${scenario.scenarioId} provides deterministic sandbox deltas only; use it to understand likely engineering-value improvements without treating hypothetical state as production truth.`,
    affectedEvidenceIds: scenario.affectedEvidenceIds,
    affectedSignalIds: scenario.affectedSignalIds,
    affectedContextIds: scenario.affectedContextIds,
    affectedRequirementIds: scenario.affectedRequirementIds,
    affectedDecisionIds: scenario.affectedDecisionIds,
    affectedOutputIds: scenario.affectedOutputIds,
    staleImpactParticipation: scenario.staleImpacts,
    invalidationParticipation: scenario.hypothetical.invalidationPropagation.propagationPaths.map(path => path.pathId),
    regenerationParticipation: scenario.regenerationCandidateIds,
    fallbackParticipation: scenario.fallbackDeltas.map(delta => delta.entityId),
    conflictParticipation: scenario.conflictDeltas.map(delta => delta.entityId),
    dependencyTraversal: scenario.dependencyTraversalPaths,
    cadReadinessImpact: scenario.hypothetical.cadReadiness.flags.filter(flag => flag.status === 'blocked' || flag.status === 'partial').map(flag => flag.flagId),
    unresolvedStatesPreserved: scenario.unresolvedStateChanges.map(delta => `${delta.entityType}:${delta.entityId}:${delta.simulatedStatus ?? 'unknown'}`),
    scoreInput: {
      staleImpactCount: scenario.staleImpacts.length,
      affectedOutputCount: scenario.affectedOutputIds.length,
      invalidationPropagationDepth: maxDepth(scenario.dependencyTraversalPaths),
      blockedRequirementCount: scenario.affectedRequirementIds.length,
      cadReadinessImpact: scenario.hypothetical.cadReadiness.blockedFlags.length + scenario.hypothetical.cadReadiness.partialFlags.length,
      conflictSeverity: scenario.conflictDeltas.length,
      fallbackParticipation: scenario.fallbackDeltas.length,
      unresolvedDependencyCount: scenario.unresolvedStateChanges.length,
      dependencyTraversalCentrality: scenario.dependencyTraversalPaths.length,
      scenarioSimulationImpact: scenario.deltas.length + scenario.confidenceDeltas.length,
      expectedConfidenceGain: Math.max(0, ...scenario.confidenceDeltas.map(delta => Math.abs(delta.delta))),
      expectedReadinessGain: scenario.regenerationCandidateIds.length > 0 ? 0.2 : 0,
      deterministicReason: `Score is derived from scenario ${scenario.scenarioId}: deltas, confidence deltas, affected outputs, conflicts, fallbacks, stale impacts, and dependency traversal paths.`,
    },
  });
}

function contextRecommendationType(context: ResolvedEngineeringContext): EngineeringRecommendationType {
  if (context.status === 'conflicting' || context.conflictReasoning.length > 0 || context.competingSignalIds.length > 0) return 'resolve_conflicting_context';
  if (context.fallbackLineage.length > 0) return 'reduce_fallback_dependency';
  if (context.domain === 'routing') return 'resolve_routing_ambiguity';
  if (context.domain === 'roof') return 'resolve_roof_context';
  if (context.domain === 'electrical' || context.domain === 'utility') return 'resolve_electrical_context';
  if (context.domain === 'ground_detached') return context.contextType.includes('trench') ? 'collect_trench_path' : 'collect_detached_structure_context';
  if (context.domain === 'ess') return 'collect_ess_wall_context';
  return 'improve_context_authority';
}

function signalTypeFallback(signalType: StructuredEngineeringSignalType): EngineeringRecommendationType {
  if (signalType.includes('roof')) return 'resolve_roof_context';
  if (signalType.includes('routing') || signalType.includes('route') || signalType.includes('conduit')) return 'resolve_routing_ambiguity';
  if (signalType.includes('trench')) return 'collect_trench_path';
  if (signalType.includes('detached')) return 'collect_detached_structure_context';
  if (signalType.includes('ess') || signalType.includes('battery') || signalType.includes('storage')) return 'collect_ess_wall_context';
  if (signalType.includes('panel') || signalType.includes('disconnect') || signalType.includes('meter') || signalType.includes('interconnection')) return 'resolve_electrical_context';
  return 'improve_context_authority';
}

function confidenceFromScore(score: number): EngineeringRecommendationConfidence {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function priorityForScore(score: number): EngineeringRecommendationPriority {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score > 0) return 'low';
  return 'informational';
}

function expectedSignalGain(signal: StructuredEngineeringSignal): number {
  if (signal.status === 'missing' || signal.status === 'blocked') return Math.max(0, 0.8 - signal.confidence.score);
  if (signal.status === 'partial') return Math.max(0, 0.6 - signal.confidence.score);
  return 0;
}

function expectedContextGain(context: ResolvedEngineeringContext): number {
  if (context.status === 'conflicting' || context.status === 'blocked' || context.status === 'unresolved') return Math.max(0, 0.8 - context.confidence.score);
  if (context.status === 'partial' || context.fallbackLineage.length > 0) return Math.max(0, 0.65 - context.confidence.score);
  return 0;
}

function definitionText(type: EngineeringRecommendationType): string {
  return getEngineeringRecommendationDefinition(type).deterministicPurpose;
}

function fallbackForSignal(input: EngineeringRecommendationEngineInput, signalId: string): string[] {
  return uniqueSorted((input.structuredSignals?.fallbackParticipation ?? []).filter(row => row.signalId === signalId).map(row => `${row.fallback}:${row.deterministicReason}`));
}

function contextOutputsForSignal(contexts: ResolvedEngineeringContext[], signalId: string): string[] {
  return uniqueSorted(contexts.filter(context => [...context.sourceSignalIds, ...context.supportingSignalIds, ...context.competingSignalIds].includes(signalId)).flatMap(context => context.affectedOutputs));
}

function pathsForNodes(input: EngineeringRecommendationEngineInput, nodeIds: string[]) {
  const ids = new Set(nodeIds);
  return (input.invalidationPropagation?.propagationPaths ?? []).filter(path => path.nodeIds.some(nodeId => ids.has(nodeId)));
}

function pathsByIds(input: EngineeringRecommendationEngineInput, pathIds: string[]) {
  const ids = new Set(pathIds);
  return (input.invalidationPropagation?.propagationPaths ?? []).filter(path => ids.has(path.pathId));
}

function maxDepth(paths: Array<{ depth: number }>): number {
  return paths.reduce((max, path) => Math.max(max, path.depth), 0);
}

function uniqueCadFlags(values: CADReadinessFlagId[]): CADReadinessFlagId[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function uniqueSignalTypes(values: StructuredEngineeringSignalType[]): StructuredEngineeringSignalType[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function uniqueContextTypes(values: import('./contextTypes').EngineeringContextType[]): import('./contextTypes').EngineeringContextType[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function dedupeRecommendations(recommendations: EngineeringRecommendation[]): EngineeringRecommendation[] {
  const byId = new Map<string, EngineeringRecommendation>();
  for (const recommendation of recommendations) {
    const existing = byId.get(recommendation.recommendationId);
    if (!existing || recommendation.deterministicScore > existing.deterministicScore) byId.set(recommendation.recommendationId, recommendation);
  }
  return [...byId.values()];
}

function prohibitedRuntimeBehavior(): string[] {
  return [
    'no OCR',
    'no OpenCV or cv2',
    'no TensorFlow, PyTorch, YOLO, or vision-model runtime',
    'no object detection',
    'no image-byte analysis',
    'no AI inference or LLM-generated recommendations',
    'no hallucinated geometry',
    'no autonomous engineering decisions',
    'no autonomous CAD generation',
    'no autonomous regeneration',
    'no automatic output mutation',
    'no hidden confidence boosting',
  ];
}
