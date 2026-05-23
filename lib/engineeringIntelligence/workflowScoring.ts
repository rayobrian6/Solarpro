import type { EngineeringWorkflowScoreBreakdown } from './workflowTypes';

export interface DeterministicWorkflowScoreInput {
  staleImpactSeverity?: number;
  affectedOutputCount?: number;
  invalidationPropagationDepth?: number;
  blockedRequirementCount?: number;
  cadReadinessImpact?: number;
  conflictSeverity?: number;
  fallbackParticipation?: number;
  unresolvedDependencyCount?: number;
  recommendationRanking?: number;
  simulationImpact?: number;
  dependencyTraversalCentrality?: number;
  confidenceDegradation?: number;
  permitReadinessImpact?: number;
  installReadinessImpact?: number;
  deterministicReason: string;
}

export function scoreEngineeringWorkflow(input: DeterministicWorkflowScoreInput): EngineeringWorkflowScoreBreakdown {
  const staleImpactSeverity = normalizedCount(input.staleImpactSeverity);
  const affectedOutputCount = normalizedCount(input.affectedOutputCount);
  const invalidationPropagationDepth = normalizedCount(input.invalidationPropagationDepth);
  const blockedRequirementCount = normalizedCount(input.blockedRequirementCount);
  const cadReadinessImpact = normalizedCount(input.cadReadinessImpact);
  const conflictSeverity = normalizedCount(input.conflictSeverity);
  const fallbackParticipation = normalizedCount(input.fallbackParticipation);
  const unresolvedDependencyCount = normalizedCount(input.unresolvedDependencyCount);
  const recommendationRanking = normalizedCount(input.recommendationRanking);
  const simulationImpact = normalizedCount(input.simulationImpact);
  const dependencyTraversalCentrality = normalizedCount(input.dependencyTraversalCentrality);
  const confidenceDegradation = normalizedGain(input.confidenceDegradation);
  const permitReadinessImpact = normalizedCount(input.permitReadinessImpact);
  const installReadinessImpact = normalizedCount(input.installReadinessImpact);

  const deterministicScore =
    staleImpactSeverity * 11 +
    affectedOutputCount * 8 +
    invalidationPropagationDepth * 5 +
    blockedRequirementCount * 10 +
    cadReadinessImpact * 8 +
    conflictSeverity * 10 +
    fallbackParticipation * 6 +
    unresolvedDependencyCount * 7 +
    recommendationRanking * 4 +
    simulationImpact * 8 +
    dependencyTraversalCentrality * 4 +
    Math.round(confidenceDegradation * 20) +
    permitReadinessImpact * 9 +
    installReadinessImpact * 7;

  return {
    staleImpactSeverity,
    affectedOutputCount,
    invalidationPropagationDepth,
    blockedRequirementCount,
    cadReadinessImpact,
    conflictSeverity,
    fallbackParticipation,
    unresolvedDependencyCount,
    recommendationRanking,
    simulationImpact,
    dependencyTraversalCentrality,
    confidenceDegradation,
    permitReadinessImpact,
    installReadinessImpact,
    deterministicScore,
    deterministicReason: input.deterministicReason,
  };
}

function normalizedCount(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.round(Number(value ?? 0) * 1000) / 1000);
}

function normalizedGain(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.min(1, Math.round(Number(value ?? 0) * 1000) / 1000));
}
