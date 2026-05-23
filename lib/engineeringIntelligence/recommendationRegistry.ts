import type { EngineeringRecommendationCategory, EngineeringRecommendationType } from './recommendationTypes';

export interface EngineeringRecommendationDefinition {
  recommendationType: EngineeringRecommendationType;
  category: EngineeringRecommendationCategory;
  label: string;
  deterministicPurpose: string;
}

export const ENGINEERING_RECOMMENDATION_DEFINITIONS: EngineeringRecommendationDefinition[] = [
  { recommendationType: 'collect_msp_photo', category: 'survey', label: 'Collect MSP photo', deterministicPurpose: 'Improve explicit main service panel evidence for electrical context, requirements, and routing readiness.' },
  { recommendationType: 'collect_disconnect_photo', category: 'survey', label: 'Collect disconnect photo', deterministicPurpose: 'Improve explicit disconnect evidence where electrical routing or interconnection context is partial or blocked.' },
  { recommendationType: 'collect_attic_photo', category: 'survey', label: 'Collect attic photo', deterministicPurpose: 'Improve structural and attic-route context where roof/attic signals are missing, partial, or stale.' },
  { recommendationType: 'collect_roof_edge_context', category: 'survey', label: 'Collect roof edge context', deterministicPurpose: 'Improve setback and roof-edge readiness using explicit canonical roof-edge evidence.' },
  { recommendationType: 'collect_routing_context', category: 'survey', label: 'Collect routing context', deterministicPurpose: 'Improve route-continuity metadata and reduce unresolved conduit/routing dependencies.' },
  { recommendationType: 'collect_trench_path', category: 'survey', label: 'Collect trench path', deterministicPurpose: 'Resolve trench-route readiness only through explicit trench-path evidence.' },
  { recommendationType: 'collect_detached_structure_context', category: 'survey', label: 'Collect detached structure context', deterministicPurpose: 'Resolve detached-structure ambiguity through explicit detached-structure evidence.' },
  { recommendationType: 'collect_ess_wall_context', category: 'survey', label: 'Collect ESS wall context', deterministicPurpose: 'Improve ESS/battery wall readiness through explicit storage-location evidence.' },
  { recommendationType: 'resolve_conflicting_context', category: 'quality', label: 'Resolve conflicting context', deterministicPurpose: 'Surface the strongest unresolved context conflict without collapsing uncertainty.' },
  { recommendationType: 'resolve_routing_ambiguity', category: 'quality', label: 'Resolve routing ambiguity', deterministicPurpose: 'Reduce routing-context ambiguity where route signals, fallbacks, or CAD flags remain weak.' },
  { recommendationType: 'resolve_roof_context', category: 'quality', label: 'Resolve roof context', deterministicPurpose: 'Reduce roof/setback/structural uncertainty from deterministic context metadata.' },
  { recommendationType: 'resolve_electrical_context', category: 'quality', label: 'Resolve electrical context', deterministicPurpose: 'Reduce unresolved MSP, meter, disconnect, or interconnection ambiguity.' },
  { recommendationType: 'improve_traversal_continuity', category: 'quality', label: 'Improve traversal continuity', deterministicPurpose: 'Improve deterministic survey traversal and sequence continuity metadata.' },
  { recommendationType: 'improve_grouping_stability', category: 'quality', label: 'Improve grouping stability', deterministicPurpose: 'Improve deterministic grouping stability when photo grouping or cluster confidence is weak.' },
  { recommendationType: 'reduce_fallback_dependency', category: 'engineering', label: 'Reduce fallback dependency', deterministicPurpose: 'Prioritize contexts and signals currently relying on fallback lineage.' },
  { recommendationType: 'resolve_blocked_requirement', category: 'engineering', label: 'Resolve blocked requirement', deterministicPurpose: 'Prioritize missing or blocked requirement metadata with downstream impact.' },
  { recommendationType: 'reduce_stale_outputs', category: 'engineering', label: 'Reduce stale outputs', deterministicPurpose: 'Prioritize stale output risk from invalidation propagation and regeneration metadata.' },
  { recommendationType: 'improve_context_authority', category: 'engineering', label: 'Improve context authority', deterministicPurpose: 'Increase deterministic context authority where preferred/authoritative context is weak.' },
  { recommendationType: 'improve_cad_readiness', category: 'engineering', label: 'Improve CAD readiness', deterministicPurpose: 'Improve explicit CAD-readiness metadata while never generating CAD automatically.' },
  { recommendationType: 'stabilize_dependency_chain', category: 'engineering', label: 'Stabilize dependency chain', deterministicPurpose: 'Reduce central stale or missing dependency-chain risk.' },
  { recommendationType: 'simulate_msp_confirmation', category: 'simulation', label: 'Simulate MSP confirmation', deterministicPurpose: 'Use existing scenario simulation deltas to rank MSP confirmation value.' },
  { recommendationType: 'simulate_roof_context_improvement', category: 'simulation', label: 'Simulate roof context improvement', deterministicPurpose: 'Use existing scenario simulation deltas to rank roof-context improvement value.' },
  { recommendationType: 'simulate_routing_confirmation', category: 'simulation', label: 'Simulate routing confirmation', deterministicPurpose: 'Use existing scenario simulation deltas to rank routing confirmation value.' },
  { recommendationType: 'simulate_trench_resolution', category: 'simulation', label: 'Simulate trench resolution', deterministicPurpose: 'Use existing scenario simulation deltas to rank trench-resolution value.' },
];

export function getEngineeringRecommendationDefinition(recommendationType: EngineeringRecommendationType): EngineeringRecommendationDefinition {
  return ENGINEERING_RECOMMENDATION_DEFINITIONS.find(definition => definition.recommendationType === recommendationType) ?? {
    recommendationType,
    category: 'engineering',
    label: recommendationType,
    deterministicPurpose: 'Deterministic engineering recommendation metadata.',
  };
}
