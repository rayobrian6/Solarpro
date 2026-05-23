import type { SelectiveRegenerationPlan } from '@/lib/engineeringStateInvalidation';
import type { EngineeringStaleClass } from './propagationGraph';
import type { EngineeringInvalidationPropagationResult } from './invalidationEngine';
import { sortBy, sortText } from './propagationGraph';

export interface EngineeringRegenerationPlanV1Input {
  planId: string;
  propagation: EngineeringInvalidationPropagationResult;
  existingPlans?: SelectiveRegenerationPlan[] | null;
}

export interface EngineeringRegenerationPlanItemV1 {
  itemId: string;
  staleClass: EngineeringStaleClass;
  sourceTriggerId: string | null;
  sourceTriggerType: string | null;
  affectedStateId: string;
  affectedOutputId: string;
  affectedOutputType: string;
  affectedDocumentSectionIds: string[];
  affectedRenderContextIds: string[];
  affectedSnapshotIds: string[];
  invalidatedDecisionIds: string[];
  missingEvidenceIds: string[];
  blockedDependencyIds: string[];
  propagationPathIds: string[];
  deterministicReason: string;
}

export interface EngineeringRegenerationPlanV1 {
  planId: string;
  triggerId: string | null;
  planItems: EngineeringRegenerationPlanItemV1[];
  regenerationCandidateIds: string[];
  preservedOutputIds: string[];
  blockedDependencyIds: string[];
  missingEvidenceIds: string[];
  reviewRequiredIds: string[];
  propagationPathIds: string[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export function buildEngineeringRegenerationPlanV1(input: EngineeringRegenerationPlanV1Input): EngineeringRegenerationPlanV1 {
  const existingPlans = input.existingPlans ?? [];
  const existingBlocked = sortText(existingPlans.flatMap(plan => plan.blockedRegenerationDependencies));
  const planItems = sortBy(input.propagation.affectedOutputs.map(output => ({
    itemId: `${input.planId}:item:${output.stateId}`,
    staleClass: output.staleClass,
    sourceTriggerId: input.propagation.triggerId,
    sourceTriggerType: input.propagation.triggerType,
    affectedStateId: output.stateId,
    affectedOutputId: output.outputId,
    affectedOutputType: output.outputType,
    affectedDocumentSectionIds: output.affectedDocumentSectionIds,
    affectedRenderContextIds: output.affectedRenderContextIds,
    affectedSnapshotIds: output.affectedSnapshotIds,
    invalidatedDecisionIds: output.invalidatedDecisionIds,
    missingEvidenceIds: output.missingEvidenceIds,
    blockedDependencyIds: sortText([...existingBlocked, ...output.dependencyNodeIds.filter(id => input.propagation.cycleProtection.missingNodeIds.includes(id))]),
    propagationPathIds: output.propagationPathIds,
    deterministicReason: `Metadata-only regeneration planning candidate for ${output.stateId}; no output is regenerated automatically.`,
  } satisfies EngineeringRegenerationPlanItemV1)), item => item.itemId);
  const reviewRequiredIds = sortText(planItems
    .filter(item => item.staleClass === 'BLOCKED' || item.staleClass === 'REQUIRES_REVIEW' || item.missingEvidenceIds.length > 0 || input.propagation.cycleProtection.cycleDetected)
    .map(item => item.affectedStateId));
  const preservedOutputIds = sortText([
    ...input.propagation.preservedStateIds,
    ...existingPlans.flatMap(plan => plan.unchangedPreservedOutputs),
  ]);
  const blockedDependencyIds = sortText([...existingBlocked, ...planItems.flatMap(item => item.blockedDependencyIds)]);
  const missingEvidenceIds = sortText([...input.propagation.missingEvidenceIds, ...planItems.flatMap(item => item.missingEvidenceIds)]);
  const propagationPathIds = sortText(planItems.flatMap(item => item.propagationPathIds));
  const deterministicHash = stableHash([
    input.planId,
    input.propagation.triggerId,
    ...planItems.map(item => item.itemId),
    ...preservedOutputIds,
    ...blockedDependencyIds,
    ...missingEvidenceIds,
    ...reviewRequiredIds,
    ...propagationPathIds,
  ]);

  return {
    planId: input.planId,
    triggerId: input.propagation.triggerId,
    planItems,
    regenerationCandidateIds: sortText(planItems.map(item => item.affectedStateId)),
    preservedOutputIds,
    blockedDependencyIds,
    missingEvidenceIds,
    reviewRequiredIds,
    propagationPathIds,
    deterministicHash,
    deterministicNotes: [
      'Regeneration Planning V1 is scoped metadata only and never regenerates documents, CAD, BOM, SLD, render contexts, or calculations.',
      'Every candidate is derived from V1 propagation output and existing selective-regeneration plan metadata when supplied.',
      'Review-required candidates remain explicit; the planner does not silently downgrade or upgrade stale classes.',
    ],
  };
}

function stableHash(values: Array<string | number | boolean | null | undefined>): string {
  const payload = sortText(Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).length > 0).map(String)))).join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `regeneration-plan-v1-${hash.toString(16).padStart(8, '0')}`;
}
