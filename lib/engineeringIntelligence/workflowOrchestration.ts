import type { CADReadinessFlag, CADReadinessFlagId } from './cadReadiness';
import type { ResolvedEngineeringContext } from './contextTypes';
import type { EngineeringScenarioSimulationResult } from './scenarioSimulation';
import type { EngineeringRecommendationConfidence, EngineeringRecommendationSummary } from './recommendationTypes';
import { stableRecommendationHash, uniqueSorted } from './recommendationRanking';
import { workflowDefinition, workflowDefinitionsForRecommendationType } from './workflowRegistry';
import { buildWorkflowQueueSummaries, rankEngineeringWorkflows, workflowPriority, workflowStatus } from './workflowQueues';
import { scoreEngineeringWorkflow } from './workflowScoring';
import type {
  EngineeringWorkflowItem,
  EngineeringWorkflowOrchestrationInput,
  EngineeringWorkflowOrchestrationSummary,
  EngineeringWorkflowSeverity,
  EngineeringWorkflowSimulationOutcome,
  EngineeringWorkflowType,
  WorkflowSourceRecommendation,
} from './workflowTypes';

export function buildEngineeringWorkflowOrchestration(input: EngineeringWorkflowOrchestrationInput): EngineeringWorkflowOrchestrationSummary {
  const generatedAt = input.generatedAt ?? input.recommendations?.generatedAt ?? new Date(0).toISOString();
  const candidates: EngineeringWorkflowItem[] = [];
  const recommendations = input.recommendations?.recommendations ?? [];

  recommendations.forEach((recommendation, index) => {
    workflowDefinitionsForRecommendationType(recommendation.recommendationType).forEach(definition => {
      candidates.push(makeWorkflow({ input, generatedAt, workflowType: definition.workflowType, recommendations: [recommendation], recommendationIndex: index }));
    });
  });

  candidates.push(...runtimeContextWorkflows(input, generatedAt));
  candidates.push(...cadReadinessWorkflows(input, generatedAt));
  candidates.push(...regenerationWorkflow(input, generatedAt));
  candidates.push(...simulationWorkflows(input, generatedAt));

  const ranked = rankEngineeringWorkflows(dedupeWorkflows(candidates));
  const workflows = typeof input.maxWorkflows === 'number' ? ranked.slice(0, input.maxWorkflows) : ranked;
  const queueSummaries = buildWorkflowQueueSummaries(workflows);
  const unresolvedStatesPreserved = uniqueSorted(workflows.flatMap(workflow => workflow.unresolvedStatesPreserved));
  const deterministicHash = stableRecommendationHash({
    modelVersion: 'engineering_workflow_orchestration_v1',
    projectId: input.projectId ?? input.recommendations?.projectId ?? null,
    surveyId: input.surveyId ?? input.recommendations?.surveyId ?? null,
    workflowIds: workflows.map(workflow => workflow.workflowId),
    unresolvedStatesPreserved,
  }, 'workflow-orchestration-v1');

  return {
    modelVersion: 'engineering_workflow_orchestration_v1',
    projectId: input.projectId ?? input.recommendations?.projectId ?? null,
    surveyId: input.surveyId ?? input.recommendations?.surveyId ?? null,
    generatedAt,
    mode: 'deterministic_orchestration_review_only',
    workflows,
    highestPriorityWorkflows: workflows.slice(0, 12),
    surveyFollowUpQueue: queueSummaries.find(queue => queue.queueId === 'survey_follow_up_queue')?.workflows ?? [],
    engineeringReviewQueue: queueSummaries.find(queue => queue.queueId === 'engineering_review_queue')?.workflows ?? [],
    conflictResolutionQueue: queueSummaries.find(queue => queue.queueId === 'conflict_resolution_queue')?.workflows ?? [],
    fallbackRiskQueue: queueSummaries.find(queue => queue.queueId === 'fallback_risk_queue')?.workflows ?? [],
    cadReadinessEscalations: queueSummaries.find(queue => queue.queueId === 'cad_readiness_escalations')?.workflows ?? [],
    permitReadinessQueue: queueSummaries.find(queue => queue.queueId === 'permit_readiness_queue')?.workflows ?? [],
    installBlockerQueue: queueSummaries.find(queue => queue.queueId === 'install_blocker_queue')?.workflows ?? [],
    regenerationApprovalQueue: queueSummaries.find(queue => queue.queueId === 'regeneration_approval_queue')?.workflows ?? [],
    dependencyRiskEscalations: queueSummaries.find(queue => queue.queueId === 'dependency_risk_escalations')?.workflows ?? [],
    workflowSimulationImpacts: queueSummaries.find(queue => queue.queueId === 'workflow_simulation_impacts')?.workflows ?? [],
    queueSummaries,
    unresolvedStatesPreserved,
    deterministicHash,
    deterministicNotes: [
      'Workflow Orchestration V1 derives reviewable operations queues only from deterministic engineering state, recommendations, invalidation propagation, regeneration planning, dependency traversal, context resolution, signal extraction, CAD readiness metadata, and read-only scenario simulations.',
      'Workflow items are not tasks executed by this runtime; statuses are generated as review states and are never auto-resolved.',
      'Hypothetical remediation outcomes are read-only scenario summaries and do not mutate production state.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function makeWorkflow(args: {
  input: EngineeringWorkflowOrchestrationInput;
  generatedAt: string;
  workflowType: EngineeringWorkflowType;
  recommendations?: WorkflowSourceRecommendation[];
  recommendationIndex?: number;
  explicitContext?: ResolvedEngineeringContext;
  explicitCadFlag?: CADReadinessFlag;
  explicitScenario?: EngineeringScenarioSimulationResult;
}): EngineeringWorkflowItem {
  const definition = workflowDefinition(args.workflowType);
  const recommendations = args.recommendations ?? [];
  const scenarioMatches = scenarioMatchesForWorkflow(args.input.scenarioSimulations ?? [], recommendations, args.explicitScenario);
  const affectedEvidenceIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedEvidenceIds), ...(args.explicitScenario?.affectedEvidenceIds ?? []), ...(args.explicitContext?.sourceEvidenceIds ?? [])]);
  const affectedSignalIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedSignalIds), ...(args.explicitScenario?.affectedSignalIds ?? []), ...(args.explicitContext?.sourceSignalIds ?? []), ...(args.explicitCadFlag?.structuredSignalIds ?? [])]);
  const affectedContextIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedContextIds), ...(args.explicitScenario?.affectedContextIds ?? []), ...(args.explicitContext ? [args.explicitContext.id] : []), ...(args.explicitCadFlag ? [...args.explicitCadFlag.blockedContextIds, ...args.explicitCadFlag.unresolvedContextIds, ...args.explicitCadFlag.conflictingContextIds, ...args.explicitCadFlag.fallbackDependentContextIds] : [])]);
  const affectedRequirementIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedRequirementIds), ...(args.explicitScenario?.affectedRequirementIds ?? []), ...(args.explicitContext?.requirementImpacts ?? [])]);
  const affectedDecisionIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedDecisionIds), ...(args.explicitScenario?.affectedDecisionIds ?? []), ...(args.explicitContext?.decisionImpacts ?? [])]);
  const affectedOutputIds = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.affectedOutputIds), ...(args.explicitScenario?.affectedOutputIds ?? []), ...(args.explicitContext?.affectedOutputs ?? [])]);
  const conflictParticipation = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.conflictParticipation), ...(args.explicitContext?.conflictReasoning ?? []), ...(args.explicitCadFlag?.conflictingContextIds ?? []), ...(args.explicitScenario?.conflictDeltas.map(delta => delta.entityId) ?? [])]);
  const fallbackParticipation = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.fallbackParticipation), ...(args.explicitContext?.fallbackLineage ?? []), ...(args.explicitCadFlag?.defaultPolicyFallbacks ?? []), ...(args.explicitCadFlag?.fallbackDependentContextIds ?? []), ...(args.explicitScenario?.fallbackDeltas.map(delta => delta.entityId) ?? [])]);
  const invalidationParticipation = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.invalidationParticipation), ...(args.explicitContext?.invalidationLineage ?? []), ...(args.input.invalidationPropagation?.affectedStateIds ?? [])]);
  const regenerationParticipation = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.regenerationParticipation), ...(args.explicitContext?.regenerationParticipation ?? []), ...(args.input.regenerationPlan?.regenerationCandidateIds ?? []), ...(args.explicitScenario?.regenerationCandidateIds ?? [])]);
  const dependencyTraversal = [...recommendations.flatMap(recommendation => recommendation.dependencyTraversal), ...(args.explicitScenario?.dependencyTraversalPaths ?? []), ...(args.input.invalidationPropagation?.propagationPaths ?? [])];
  const cadReadinessImpact = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.cadReadinessImpact), ...(args.explicitContext?.cadReadinessImpacts ?? []), ...(args.explicitCadFlag ? [args.explicitCadFlag.flagId] : []), ...(args.explicitScenario?.hypothetical.cadReadiness.flags.filter(flag => flag.status !== 'ready').map(flag => flag.flagId) ?? [])]) as CADReadinessFlagId[];
  const unresolvedStatesPreserved = uniqueSorted([...recommendations.flatMap(recommendation => recommendation.unresolvedStatesPreserved), ...recommendations.flatMap(recommendation => recommendation.uncertaintyNotes), ...(args.explicitContext?.unresolvedDependencies ?? []), ...(args.explicitCadFlag?.unresolvedAssumptions ?? []), ...(args.explicitScenario?.unresolvedStateChanges.map(delta => delta.entityId) ?? [])]);
  const staleImpactParticipation = recommendations.flatMap(recommendation => recommendation.staleImpactParticipation);
  const simulationOutcome = simulationOutcomeForWorkflow(scenarioMatches, recommendations);
  const blockedRequirementCount = affectedRequirementIds.length + (args.explicitCadFlag?.missingCategories.length ?? 0) + (args.input.regenerationPlan?.blockedDependencyIds.length ?? 0);
  const permitImpact = definition.category === 'permit_ops' ? cadReadinessImpact.length + affectedRequirementIds.length + conflictParticipation.length : 0;
  const installImpact = definition.category === 'install_ops' ? cadReadinessImpact.length + unresolvedStatesPreserved.length + fallbackParticipation.length : 0;
  const severity = severityForWorkflow(definition.baseSeverity, recommendations, conflictParticipation.length, blockedRequirementCount, fallbackParticipation.length, staleImpactParticipation.length);
  const scoreBreakdown = scoreEngineeringWorkflow({
    staleImpactSeverity: staleImpactParticipation.length + (args.input.invalidationPropagation?.staleClassCounts.STALE ?? 0) + (args.input.invalidationPropagation?.staleClassCounts.INVALIDATED ?? 0),
    affectedOutputCount: affectedOutputIds.length,
    invalidationPropagationDepth: maxTraversalDepth(dependencyTraversal),
    blockedRequirementCount,
    cadReadinessImpact: cadReadinessImpact.length,
    conflictSeverity: conflictParticipation.length,
    fallbackParticipation: fallbackParticipation.length,
    unresolvedDependencyCount: unresolvedStatesPreserved.length,
    recommendationRanking: Math.max(0, recommendations.length ? 12 - (args.recommendationIndex ?? 0) : 0),
    simulationImpact: simulationOutcome.scenarioIds.length + simulationOutcome.hypotheticalStaleReduction + simulationOutcome.hypotheticalCADReadinessImprovement,
    dependencyTraversalCentrality: dependencyTraversal.length,
    confidenceDegradation: confidenceDegradation(recommendations, args.explicitContext),
    permitReadinessImpact: permitImpact,
    installReadinessImpact: installImpact,
    deterministicReason: `Score for ${args.workflowType} uses stale impact, affected outputs, propagation depth, blocked requirements, CAD-readiness impacts, conflicts, fallbacks, unresolved dependencies, recommendation rank, simulation deltas, dependency traversal, confidence degradation, permit impact, and install impact only.`,
  });
  const priority = workflowPriority(scoreBreakdown.deterministicScore, severity);
  const status = workflowStatus({ severity, conflictCount: conflictParticipation.length, blockedCount: blockedRequirementCount, simulationCount: simulationOutcome.scenarioIds.length, staleCount: staleImpactParticipation.length, unresolvedCount: unresolvedStatesPreserved.length });
  const blockingImpacts = uniqueSorted([
    ...affectedRequirementIds.map(id => `requirement:${id}`),
    ...cadReadinessImpact.map(id => `cad_readiness:${id}`),
    ...unresolvedStatesPreserved.map(id => `unresolved:${id}`),
    ...conflictParticipation.map(id => `conflict:${id}`),
    ...fallbackParticipation.map(id => `fallback:${id}`),
  ]);
  const payload = {
    workflowType: args.workflowType,
    category: definition.category,
    affectedEvidenceIds,
    affectedSignalIds,
    affectedContextIds,
    affectedRequirementIds,
    affectedDecisionIds,
    affectedOutputIds,
    cadReadinessImpact,
    sourceRecommendationIds: recommendations.map(recommendation => recommendation.recommendationId),
    scenarioIds: simulationOutcome.scenarioIds,
    scoreBreakdown,
  };
  const deterministicHash = stableRecommendationHash(payload, 'workflow-v1');

  return {
    workflowId: `${args.workflowType}:${deterministicHash}`,
    workflowType: args.workflowType,
    category: definition.category,
    priority,
    severity,
    status,
    deterministicScore: scoreBreakdown.deterministicScore,
    confidence: workflowConfidence(recommendations, args.explicitContext),
    explanation: `${definition.deterministicPurpose} ${recommendations[0]?.explanation ?? args.explicitContext?.rankingReason ?? args.explicitCadFlag?.deterministicReason ?? args.explicitScenario?.deterministicExplanation[0] ?? 'Runtime metadata created this workflow because deterministic state contains reviewable operational impact.'}`,
    affectedEvidenceIds,
    affectedSignalIds,
    affectedSignalTypes: uniqueSorted(recommendations.flatMap(recommendation => recommendation.affectedSignalTypes)) as EngineeringWorkflowItem['affectedSignalTypes'],
    affectedContextIds,
    affectedContextTypes: uniqueSorted(recommendations.flatMap(recommendation => recommendation.affectedContextTypes)) as EngineeringWorkflowItem['affectedContextTypes'],
    affectedRequirementIds,
    affectedDecisionIds,
    affectedOutputIds,
    staleImpactParticipation,
    invalidationParticipation,
    regenerationParticipation,
    fallbackParticipation,
    conflictParticipation,
    dependencyTraversal,
    cadReadinessImpact,
    blockingImpacts,
    escalationReason: escalationReason(args.workflowType, severity, status, blockingImpacts.length, simulationOutcome),
    recommendedReviewerRole: definition.recommendedReviewerRole,
    recommendedTechnicianAction: definition.recommendedTechnicianAction,
    sourceRecommendationIds: recommendations.map(recommendation => recommendation.recommendationId),
    sourceRecommendationTypes: recommendations.map(recommendation => recommendation.recommendationType),
    simulationOutcome,
    unresolvedStatesPreserved,
    safetyNotes: uniqueSorted([...recommendations.flatMap(recommendation => recommendation.safetyNotes), 'Workflow is review-only and must not auto-run, auto-close, auto-regenerate, auto-approve, auto-promote contexts, or auto-resolve conflicts.']),
    scoreBreakdown,
    deterministicHash,
  };
}

function runtimeContextWorkflows(input: EngineeringWorkflowOrchestrationInput, generatedAt: string): EngineeringWorkflowItem[] {
  const contexts = input.contextResolution?.contexts ?? [];
  const workflows: EngineeringWorkflowItem[] = [];
  contexts.filter(context => context.status === 'conflicting').forEach(context => {
    workflows.push(makeWorkflow({ input, generatedAt, workflowType: 'investigate_conflicting_contexts', explicitContext: context }));
    workflows.push(makeWorkflow({ input, generatedAt, workflowType: 'resolve_context_conflicts', explicitContext: context }));
  });
  contexts.filter(context => context.status === 'blocked' || context.status === 'unresolved').forEach(context => {
    workflows.push(makeWorkflow({ input, generatedAt, workflowType: context.domain === 'ground_detached' ? 'validate_detached_structure' : context.contextType === 'preferred_trench_context' ? 'validate_trench_context' : 'review_invalidated_contexts', explicitContext: context }));
  });
  contexts.filter(context => context.confidence.score < 45 && context.status !== 'not_applicable').forEach(context => workflows.push(makeWorkflow({ input, generatedAt, workflowType: 'investigate_low_confidence_contexts', explicitContext: context })));
  contexts.filter(context => context.fallbackLineage.length > 0).forEach(context => workflows.push(makeWorkflow({ input, generatedAt, workflowType: 'review_fallback_heavy_design', explicitContext: context })));
  contexts.filter(context => context.dependencyLineage.length > 2 || context.unresolvedDependencies.length > 0).forEach(context => workflows.push(makeWorkflow({ input, generatedAt, workflowType: 'validate_dependency_risk', explicitContext: context })));
  return workflows;
}

function cadReadinessWorkflows(input: EngineeringWorkflowOrchestrationInput, generatedAt: string): EngineeringWorkflowItem[] {
  return (input.cadReadiness?.flags ?? []).flatMap(flag => {
    if (flag.status === 'ready' || flag.status === 'not_applicable') return [];
    const workflows: EngineeringWorkflowType[] = ['resolve_permit_blockers'];
    if (flag.flagId === 'routing-ready') workflows.push('verify_conduit_path');
    if (flag.flagId === 'trench-route-ready') workflows.push('verify_trench_route', 'validate_trench_context');
    if (flag.flagId === 'setback-ready') workflows.push('validate_setback_context');
    if (flag.flagId === 'detached-structure-ready') workflows.push('validate_detached_structure');
    if (flag.flagId === 'ESS-location-ready') workflows.push('verify_equipment_location');
    if (flag.flagId === 'roof-plane-ready') workflows.push('verify_structural_access', 'validate_setback_context');
    if (flag.flagId === 'routing-ready') workflows.push('validate_interconnection_context', 'validate_utility_requirements');
    return workflows.map(workflowType => makeWorkflow({ input, generatedAt, workflowType, explicitCadFlag: flag }));
  });
}

function regenerationWorkflow(input: EngineeringWorkflowOrchestrationInput, generatedAt: string): EngineeringWorkflowItem[] {
  if (!input.regenerationPlan || input.regenerationPlan.planItems.length === 0) return [];
  return [
    makeWorkflow({ input, generatedAt, workflowType: 'approve_regeneration_scope' }),
    makeWorkflow({ input, generatedAt, workflowType: 'review_stale_outputs' }),
    makeWorkflow({ input, generatedAt, workflowType: 'stabilize_dependency_chain' }),
  ];
}

function simulationWorkflows(input: EngineeringWorkflowOrchestrationInput, generatedAt: string): EngineeringWorkflowItem[] {
  return (input.scenarioSimulations ?? []).flatMap(simulation => {
    const workflows: EngineeringWorkflowType[] = [];
    if (simulation.regenerationCandidateIds.length > 0 || simulation.affectedOutputIds.length > 0) workflows.push('approve_regeneration_scope');
    if (simulation.conflictDeltas.length > 0) workflows.push('resolve_context_conflicts');
    if (simulation.fallbackDeltas.length > 0) workflows.push('review_fallback_heavy_design');
    if (simulation.dependencyTraversalPaths.length > 0) workflows.push('stabilize_dependency_chain');
    return workflows.map(workflowType => makeWorkflow({ input, generatedAt, workflowType, explicitScenario: simulation }));
  });
}

function scenarioMatchesForWorkflow(scenarios: EngineeringScenarioSimulationResult[], recommendations: WorkflowSourceRecommendation[], explicitScenario?: EngineeringScenarioSimulationResult): EngineeringScenarioSimulationResult[] {
  const ids = new Set(recommendations.flatMap(recommendation => [...recommendation.affectedSignalIds, ...recommendation.affectedContextIds, ...recommendation.affectedOutputIds, ...recommendation.cadReadinessImpact]));
  const matches = scenarios.filter(scenario => [...scenario.affectedSignalIds, ...scenario.affectedContextIds, ...scenario.affectedOutputIds, ...scenario.hypothetical.cadReadiness.flags.map(flag => flag.flagId)].some(id => ids.has(id)));
  return explicitScenario ? dedupeScenarios([...matches, explicitScenario]) : dedupeScenarios(matches);
}

function simulationOutcomeForWorkflow(scenarios: EngineeringScenarioSimulationResult[], recommendations: WorkflowSourceRecommendation[]): EngineeringWorkflowSimulationOutcome {
  const scenarioIds = uniqueSorted(scenarios.map(scenario => scenario.scenarioId));
  const hypotheticalConfidenceImprovement = roundGain(scenarios.reduce((sum, scenario) => sum + scenario.confidenceDeltas.reduce((deltaSum, delta) => deltaSum + Math.max(0, delta.delta), 0), 0) / 100 + recommendations.reduce((sum, recommendation) => sum + recommendation.expectedConfidenceGain, 0));
  const hypotheticalCADReadinessImprovement = roundGain(recommendations.reduce((sum, recommendation) => sum + recommendation.expectedReadinessGain, 0) + scenarios.reduce((sum, scenario) => sum + scenario.deltas.filter(delta => delta.entityType === 'cad_readiness' && delta.deltaType === 'changed').length * 0.1, 0));
  const hypotheticalStaleReduction = scenarios.reduce((sum, scenario) => sum + scenario.deltas.filter(delta => delta.deltaType === 'resolved' || delta.staleClass === 'VALID').length, 0);
  return {
    scenarioIds,
    hypotheticalRemediationOutcomes: uniqueSorted(scenarios.flatMap(scenario => scenario.deltas.filter(delta => delta.deltaType !== 'unchanged').slice(0, 8).map(delta => `${delta.entityType}:${delta.entityId}:${delta.previousStatus ?? 'none'}->${delta.simulatedStatus ?? 'none'}`))),
    hypotheticalConfidenceImprovement,
    hypotheticalCADReadinessImprovement,
    hypotheticalStaleReduction,
    deterministicReason: scenarioIds.length > 0 ? 'Simulation outcomes are summarized from read-only hypothetical scenario deltas and recommendation expected gains only.' : 'No read-only scenario simulation is linked to this workflow.',
  };
}

function severityForWorkflow(base: EngineeringWorkflowSeverity, recommendations: WorkflowSourceRecommendation[], conflictCount: number, blockedCount: number, fallbackCount: number, staleCount: number): EngineeringWorkflowSeverity {
  if (blockedCount > 0 || recommendations.some(recommendation => recommendation.severity === 'blocked')) return 'blocked';
  if (conflictCount > 0) return 'escalation';
  if (staleCount > 0 || recommendations.some(recommendation => recommendation.severity === 'stale_risk')) return 'stale_risk';
  if (fallbackCount > 0) return 'review_required';
  return base;
}

function workflowConfidence(recommendations: WorkflowSourceRecommendation[], context?: ResolvedEngineeringContext): EngineeringRecommendationConfidence {
  if (recommendations.some(recommendation => recommendation.confidence === 'high')) return 'high';
  if (recommendations.some(recommendation => recommendation.confidence === 'medium')) return 'medium';
  if (context && context.confidence.band !== 'none') return context.confidence.band;
  if (recommendations.some(recommendation => recommendation.confidence === 'low')) return 'low';
  return 'none';
}

function confidenceDegradation(recommendations: WorkflowSourceRecommendation[], context?: ResolvedEngineeringContext): number {
  const recommendationPenalty = recommendations.reduce((sum, recommendation) => sum + (recommendation.confidence === 'none' ? 1 : recommendation.confidence === 'low' ? 0.7 : recommendation.confidence === 'medium' ? 0.35 : 0), 0);
  const contextPenalty = context ? Math.max(0, 1 - context.confidence.score / 100) : 0;
  return roundGain(recommendationPenalty + contextPenalty);
}

function escalationReason(type: EngineeringWorkflowType, severity: EngineeringWorkflowSeverity, status: string, blockingCount: number, simulation: EngineeringWorkflowSimulationOutcome): string {
  return `Workflow ${type} is ${status} with severity ${severity}; escalation is based on ${blockingCount} deterministic blocking impact(s) and ${simulation.scenarioIds.length} linked read-only simulation(s).`;
}

function maxTraversalDepth(paths: Array<{ depth: number }>): number {
  return paths.reduce((max, path) => Math.max(max, path.depth ?? 0), 0);
}

function roundGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function dedupeWorkflows(workflows: EngineeringWorkflowItem[]): EngineeringWorkflowItem[] {
  const byKey = new Map<string, EngineeringWorkflowItem>();
  rankEngineeringWorkflows(workflows).forEach(workflow => {
    const key = [workflow.workflowType, workflow.sourceRecommendationIds.join('|'), workflow.affectedContextIds.join('|'), workflow.cadReadinessImpact.join('|'), workflow.simulationOutcome.scenarioIds.join('|')].join('::');
    if (!byKey.has(key)) byKey.set(key, workflow);
  });
  return [...byKey.values()];
}

function dedupeScenarios(scenarios: EngineeringScenarioSimulationResult[]): EngineeringScenarioSimulationResult[] {
  const byId = new Map<string, EngineeringScenarioSimulationResult>();
  scenarios.forEach(scenario => byId.set(scenario.scenarioId, scenario));
  return [...byId.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

function prohibitedRuntimeBehavior(): string[] {
  return [
    'no OCR',
    'no OpenCV or cv2',
    'no TensorFlow, PyTorch, YOLO, or vision-model runtime',
    'no object detection',
    'no image-byte analysis',
    'no AI inference or LLM workflow reasoning',
    'no autonomous engineering decisions',
    'no autonomous CAD generation',
    'no autonomous regeneration',
    'no automatic permit approval',
    'no automatic engineering approval',
    'no automatic workflow execution',
    'no automatic workflow state mutation',
    'no hidden remediation execution',
    'no automatic context promotion',
    'no automatic conflict resolution',
  ];
}
