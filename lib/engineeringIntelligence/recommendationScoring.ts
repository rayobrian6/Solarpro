import type { EngineeringRecommendationScoreBreakdown } from './recommendationTypes';

export interface DeterministicRecommendationScoreInput {
  staleImpactCount?: number;
  affectedOutputCount?: number;
  invalidationPropagationDepth?: number;
  blockedRequirementCount?: number;
  cadReadinessImpact?: number;
  conflictSeverity?: number;
  fallbackParticipation?: number;
  unresolvedDependencyCount?: number;
  dependencyTraversalCentrality?: number;
  contextAuthorityWeakness?: number;
  scenarioSimulationImpact?: number;
  expectedReadinessGain?: number;
  expectedConfidenceGain?: number;
  deterministicReason: string;
}

export function scoreEngineeringRecommendation(input: DeterministicRecommendationScoreInput): EngineeringRecommendationScoreBreakdown {
  const staleImpactCount = normalizedCount(input.staleImpactCount);
  const affectedOutputCount = normalizedCount(input.affectedOutputCount);
  const invalidationPropagationDepth = normalizedCount(input.invalidationPropagationDepth);
  const blockedRequirementCount = normalizedCount(input.blockedRequirementCount);
  const cadReadinessImpact = normalizedCount(input.cadReadinessImpact);
  const conflictSeverity = normalizedCount(input.conflictSeverity);
  const fallbackParticipation = normalizedCount(input.fallbackParticipation);
  const unresolvedDependencyCount = normalizedCount(input.unresolvedDependencyCount);
  const dependencyTraversalCentrality = normalizedCount(input.dependencyTraversalCentrality);
  const contextAuthorityWeakness = normalizedCount(input.contextAuthorityWeakness);
  const scenarioSimulationImpact = normalizedCount(input.scenarioSimulationImpact);
  const expectedReadinessGain = normalizedGain(input.expectedReadinessGain);
  const expectedConfidenceGain = normalizedGain(input.expectedConfidenceGain);
  const deterministicScore =
    staleImpactCount * 10 +
    affectedOutputCount * 8 +
    invalidationPropagationDepth * 5 +
    blockedRequirementCount * 9 +
    cadReadinessImpact * 7 +
    conflictSeverity * 10 +
    fallbackParticipation * 6 +
    unresolvedDependencyCount * 7 +
    dependencyTraversalCentrality * 4 +
    contextAuthorityWeakness * 6 +
    scenarioSimulationImpact * 8 +
    Math.round(expectedReadinessGain * 20) +
    Math.round(expectedConfidenceGain * 20);

  return {
    staleImpactCount,
    affectedOutputCount,
    invalidationPropagationDepth,
    blockedRequirementCount,
    cadReadinessImpact,
    conflictSeverity,
    fallbackParticipation,
    unresolvedDependencyCount,
    dependencyTraversalCentrality,
    contextAuthorityWeakness,
    scenarioSimulationImpact,
    expectedReadinessGain,
    expectedConfidenceGain,
    deterministicScore,
    deterministicReason: input.deterministicReason,
  };
}

function normalizedCount(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

function normalizedGain(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.min(1, Number(value ?? 0)));
}
