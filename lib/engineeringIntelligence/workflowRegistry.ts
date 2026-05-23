import type { EngineeringRecommendationType } from './recommendationTypes';
import type { EngineeringWorkflowCategory, EngineeringWorkflowReviewerRole, EngineeringWorkflowSeverity, EngineeringWorkflowType } from './workflowTypes';

export interface EngineeringWorkflowDefinition {
  workflowType: EngineeringWorkflowType;
  category: EngineeringWorkflowCategory;
  label: string;
  baseSeverity: EngineeringWorkflowSeverity;
  recommendedReviewerRole: EngineeringWorkflowReviewerRole;
  recommendedTechnicianAction: string;
  deterministicPurpose: string;
  sourceRecommendationTypes: EngineeringRecommendationType[];
}

export const ENGINEERING_WORKFLOW_DEFINITIONS: EngineeringWorkflowDefinition[] = [
  survey('collect_missing_electrical_evidence', 'Collect Missing Electrical Evidence', 'field_technician', 'Capture explicit MSP, disconnect, utility, interconnection, and service-equipment evidence requested by deterministic gaps.', ['collect_msp_photo', 'collect_disconnect_photo', 'resolve_electrical_context']),
  survey('collect_missing_structural_evidence', 'Collect Missing Structural Evidence', 'field_technician', 'Capture explicit attic, rafter, structural access, and roof-supporting evidence requested by deterministic gaps.', ['collect_attic_photo', 'resolve_roof_context']),
  survey('collect_missing_routing_evidence', 'Collect Missing Routing Evidence', 'field_technician', 'Capture explicit conduit, routing, ESS wall, detached-structure, and route evidence requested by deterministic gaps.', ['collect_routing_context', 'collect_ess_wall_context']),
  survey('improve_traversal_continuity', 'Improve Traversal Continuity', 'survey_ops', 'Review survey traversal continuity metadata and request explicit follow-up only where deterministic breakpoints remain.', ['improve_traversal_continuity', 'improve_grouping_stability']),
  survey('validate_detached_structure', 'Validate Detached Structure Context', 'field_technician', 'Verify detached-structure applicability and capture explicit evidence if the deterministic context remains blocked or unresolved.', ['collect_detached_structure_context']),
  survey('validate_trench_context', 'Validate Trench Context', 'field_technician', 'Verify trench path applicability and capture explicit route evidence if deterministic trench context remains blocked or unresolved.', ['collect_trench_path', 'simulate_trench_resolution']),
  engineering('review_stale_outputs', 'Review Stale Outputs', 'project_engineer', 'Review affected stale outputs and decide whether explicit regeneration scope should be prepared for human approval.', ['reduce_stale_outputs']),
  engineering('review_invalidated_contexts', 'Review Invalidated Contexts', 'project_engineer', 'Review contexts participating in invalidation propagation without promoting or resolving them automatically.', ['resolve_roof_context', 'resolve_routing_ambiguity', 'resolve_electrical_context']),
  engineering('approve_regeneration_scope', 'Approve Regeneration Scope', 'project_engineer', 'Review deterministic regeneration candidates and approve or defer scope outside this orchestration layer.', ['reduce_stale_outputs']),
  engineering('review_fallback_heavy_design', 'Review Fallback-Heavy Design', 'project_engineer', 'Review fallback lineage and decide whether explicit evidence collection is needed before design progression.', ['reduce_fallback_dependency']),
  engineering('resolve_context_conflicts', 'Resolve Context Conflicts', 'project_engineer', 'Review conflicting deterministic contexts and preserve unresolved states until human resolution occurs.', ['resolve_conflicting_context', 'resolve_routing_ambiguity']),
  engineering('stabilize_dependency_chain', 'Stabilize Dependency Chain', 'project_engineer', 'Review dependency traversal centrality and unresolved dependency chains before downstream output work.', ['stabilize_dependency_chain']),
  qa('investigate_conflicting_contexts', 'Investigate Conflicting Contexts', 'qa_reviewer', 'Audit conflicting context lineage and verify no uncertainty has been collapsed.', ['resolve_conflicting_context']),
  qa('investigate_low_confidence_contexts', 'Investigate Low-Confidence Contexts', 'qa_reviewer', 'Audit low-confidence context or signal chains and request explicit evidence if needed.', ['improve_context_authority']),
  qa('validate_dependency_risk', 'Validate Dependency Risk', 'qa_reviewer', 'Validate high-centrality dependency paths and downstream affected output risk.', ['stabilize_dependency_chain']),
  qa('validate_context_authority', 'Validate Context Authority', 'qa_reviewer', 'Validate context authority, source evidence, and confidence penalties before downstream review.', ['improve_context_authority']),
  permit('resolve_permit_blockers', 'Resolve Permit Blockers', 'permit_coordinator', 'Review permit-blocking deterministic evidence gaps and AHJ-readiness blockers without approving permits.', ['resolve_blocked_requirement', 'improve_cad_readiness']),
  permit('validate_interconnection_context', 'Validate Interconnection Context', 'permit_coordinator', 'Validate explicit interconnection and utility context before permit package readiness review.', ['simulate_msp_confirmation', 'collect_msp_photo', 'resolve_electrical_context']),
  permit('validate_setback_context', 'Validate Setback Context', 'permit_coordinator', 'Validate setback-related context and unresolved roof constraints before AHJ readiness review.', ['collect_roof_edge_context', 'simulate_roof_context_improvement']),
  permit('validate_utility_requirements', 'Validate Utility Requirements', 'permit_coordinator', 'Validate utility requirement evidence gaps before permit package readiness review.', ['collect_msp_photo', 'collect_disconnect_photo', 'resolve_blocked_requirement']),
  install('verify_equipment_location', 'Verify Equipment Location', 'install_coordinator', 'Verify equipment placement and wall/location evidence before install execution planning.', ['collect_ess_wall_context', 'resolve_electrical_context']),
  install('verify_trench_route', 'Verify Trench Route', 'install_coordinator', 'Verify trench route evidence and unresolved trench context before install planning.', ['collect_trench_path', 'simulate_trench_resolution']),
  install('verify_conduit_path', 'Verify Conduit Path', 'install_coordinator', 'Verify conduit/routing path context before install planning.', ['collect_routing_context', 'resolve_routing_ambiguity']),
  install('verify_structural_access', 'Verify Structural Access', 'install_coordinator', 'Verify structural access and attic evidence before install planning.', ['collect_attic_photo', 'resolve_roof_context']),
];

export const WORKFLOW_DEFINITION_BY_TYPE = new Map(ENGINEERING_WORKFLOW_DEFINITIONS.map(definition => [definition.workflowType, definition]));

export function workflowDefinitionsForRecommendationType(type: EngineeringRecommendationType): EngineeringWorkflowDefinition[] {
  return ENGINEERING_WORKFLOW_DEFINITIONS.filter(definition => definition.sourceRecommendationTypes.includes(type));
}

export function workflowDefinition(type: EngineeringWorkflowType): EngineeringWorkflowDefinition {
  const definition = WORKFLOW_DEFINITION_BY_TYPE.get(type);
  if (!definition) throw new Error(`Unknown engineering workflow definition: ${type}`);
  return definition;
}

function survey(workflowType: EngineeringWorkflowType, label: string, role: EngineeringWorkflowReviewerRole, action: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return base(workflowType, 'survey_ops', label, 'quality_gap', role, action, sourceRecommendationTypes);
}

function engineering(workflowType: EngineeringWorkflowType, label: string, role: EngineeringWorkflowReviewerRole, action: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return base(workflowType, 'engineering_ops', label, 'review_required', role, action, sourceRecommendationTypes);
}

function qa(workflowType: EngineeringWorkflowType, label: string, role: EngineeringWorkflowReviewerRole, action: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return base(workflowType, 'qa_ops', label, 'review_required', role, action, sourceRecommendationTypes);
}

function permit(workflowType: EngineeringWorkflowType, label: string, role: EngineeringWorkflowReviewerRole, action: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return base(workflowType, 'permit_ops', label, 'blocked', role, action, sourceRecommendationTypes);
}

function install(workflowType: EngineeringWorkflowType, label: string, role: EngineeringWorkflowReviewerRole, action: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return base(workflowType, 'install_ops', label, 'review_required', role, action, sourceRecommendationTypes);
}

function base(workflowType: EngineeringWorkflowType, category: EngineeringWorkflowCategory, label: string, baseSeverity: EngineeringWorkflowSeverity, recommendedReviewerRole: EngineeringWorkflowReviewerRole, recommendedTechnicianAction: string, sourceRecommendationTypes: EngineeringRecommendationType[]): EngineeringWorkflowDefinition {
  return {
    workflowType,
    category,
    label,
    baseSeverity,
    recommendedReviewerRole,
    recommendedTechnicianAction,
    sourceRecommendationTypes,
    deterministicPurpose: `${label} exists only as deterministic operations guidance derived from explicit engineering state, recommendation lineage, and runtime metadata.`,
  };
}
