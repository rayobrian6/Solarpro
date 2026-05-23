import type { EngineeringContextDefinition, EngineeringContextType } from './contextTypes';

export const ENGINEERING_CONTEXT_REGISTRY: EngineeringContextDefinition[] = [
  roof('preferred_roof_context', ['roof_plane_context_present', 'roof_surface_context_present'], ['roof_layout_candidate_present', 'framing_context_present', 'structural_access_context_present'], ['roof-plane-ready'], ['roof_overview'], ['roof_overview'], ['permit_plan_set', 'cad_layout_readiness'], 'Arbitrates the most authoritative roof context from explicit roof and structural signals.'),
  roof('preferred_roof_plane_context', ['roof_plane_context_present'], ['roof_surface_context_present', 'roof_layout_candidate_present'], ['roof-plane-ready'], ['roof_overview'], ['roof_overview'], ['cad_roof_plane_context'], 'Selects preferred roof-plane context only from explicit roof-plane signal lineage.', { explicitPrimaryRequired: true }),
  roof('preferred_setback_context', ['roof_edge_context_present', 'ridge_context_present'], ['obstruction_context_present', 'roof_layout_candidate_present'], ['setback-ready'], ['roof_overview'], ['roof_overview'], ['permit_setback_notes'], 'Ranks setback context from explicit edge, ridge, obstruction, and layout signals.'),
  roof('preferred_obstruction_context', ['obstruction_context_present'], ['roof_layout_candidate_present', 'roof_surface_context_present'], ['setback-ready'], ['roof_overview'], ['roof_overview'], ['obstruction_review'], 'Selects obstruction context from explicit obstruction signal lineage.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),
  roof('preferred_layout_context', ['roof_layout_candidate_present'], ['roof_plane_context_present', 'roof_edge_context_present', 'ridge_context_present', 'obstruction_context_present'], ['roof-plane-ready', 'setback-ready'], ['roof_overview'], ['roof_overview'], ['cad_layout_readiness'], 'Ranks layout context from deterministic roof signal corroboration.', { fallbackAllowed: true }),

  routing('preferred_routing_context', ['routing_continuity_present'], ['conduit_route_candidate_present', 'utility_to_inverter_route_candidate', 'inverter_to_msp_route_candidate', 'exterior_wall_route_candidate', 'attic_route_candidate'], ['routing-ready'], ['main_service_panel', 'utility_meter'], ['main_service_panel', 'utility_meter'], ['routing_review', 'cad_routing_readiness'], 'Arbitrates the strongest routing context without generating route geometry.', { fallbackAllowed: true }),
  routing('preferred_conduit_context', ['conduit_route_candidate_present'], ['routing_continuity_present', 'exterior_wall_route_candidate', 'attic_route_candidate'], ['routing-ready'], ['main_service_panel', 'utility_meter'], ['main_service_panel', 'utility_meter'], ['conduit_notes'], 'Ranks conduit context from explicit route candidate and continuity signals.', { explicitPrimaryRequired: true }),
  routing('preferred_attic_route_context', ['attic_route_candidate'], ['framing_context_present', 'structural_access_context_present', 'routing_continuity_present'], ['routing-ready'], ['structural_access'], ['main_service_panel', 'utility_meter'], ['attic_route_review'], 'Ranks attic route context from explicit attic/access/framing signals.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),
  routing('preferred_exterior_route_context', ['exterior_wall_route_candidate'], ['conduit_route_candidate_present', 'routing_continuity_present'], ['routing-ready'], ['main_service_panel', 'utility_meter'], ['main_service_panel', 'utility_meter'], ['exterior_route_review'], 'Ranks exterior/wall route context from explicit wall/exterior route signal lineage.', { explicitPrimaryRequired: true }),
  routing('preferred_utility_to_inverter_context', ['utility_to_inverter_route_candidate'], ['utility_access_context_present', 'utility_meter_present', 'routing_continuity_present'], ['routing-ready'], ['utility_meter'], ['utility_interconnection_method'], ['utility_to_inverter_review'], 'Ranks utility-to-inverter context from utility and inverter/gateway route evidence.', { explicitPrimaryRequired: true }),
  routing('preferred_inverter_to_msp_context', ['inverter_to_msp_route_candidate'], ['main_service_panel_present', 'inverter_location_candidate_present', 'routing_continuity_present'], ['routing-ready'], ['main_service_panel'], ['main_service_panel', 'utility_meter'], ['inverter_to_msp_review'], 'Ranks inverter-to-MSP context from inverter/gateway and MSP signals.', { explicitPrimaryRequired: true }),

  electrical('preferred_msp_context', ['main_service_panel_present'], ['interconnection_zone_known', 'electrical_equipment_cluster_present'], ['routing-ready'], ['main_service_panel'], ['main_service_panel'], ['sld_service_panel_context', 'bom_service_equipment'], 'Selects the authoritative MSP context from explicit MSP signal lineage.', { explicitPrimaryRequired: true }),
  electrical('preferred_disconnect_context', ['main_disconnect_present'], ['interconnection_zone_known', 'electrical_equipment_cluster_present'], ['routing-ready'], ['main_disconnect'], ['main_disconnect_required'], ['sld_disconnect_context'], 'Ranks disconnect context from explicit disconnect signal lineage.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),
  electrical('preferred_interconnection_context', ['interconnection_zone_known'], ['main_service_panel_present', 'utility_meter_present', 'main_disconnect_present'], ['routing-ready'], ['main_service_panel', 'utility_meter'], ['utility_interconnection_method'], ['sld_interconnection_context'], 'Ranks interconnection context from explicit electrical/service signals and fields.', { fallbackAllowed: true }),
  electrical('preferred_equipment_cluster_context', ['electrical_equipment_cluster_present'], ['main_service_panel_present', 'utility_meter_present', 'main_disconnect_present', 'subpanel_present'], ['routing-ready'], ['main_service_panel', 'utility_meter'], ['main_service_panel'], ['equipment_cluster_review'], 'Ranks authoritative electrical equipment grouping from deterministic cluster signals.', { explicitPrimaryRequired: true }),

  ess('preferred_ess_context', ['energy_storage_context_present'], ['ess_location_candidate_present', 'battery_wall_candidate_present', 'garage_interior_wall_present'], ['ESS-location-ready'], ['battery_location'], ['ess_location_context'], ['ess_location_review'], 'Arbitrates preferred ESS context from explicit storage/gateway/wall signals.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),
  ess('preferred_battery_location_context', ['battery_wall_candidate_present', 'ess_location_candidate_present'], ['garage_interior_wall_present', 'energy_storage_context_present'], ['ESS-location-ready'], ['battery_location'], ['ess_location_context'], ['battery_location_review'], 'Ranks battery location context from explicit battery/wall location signals.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),

  utility('preferred_utility_meter_context', ['utility_meter_present'], ['utility_meter_side_known', 'utility_access_context_present'], ['routing-ready'], ['utility_meter'], ['utility_interconnection_method'], ['sld_utility_meter_context'], 'Selects preferred utility meter context from explicit meter signal lineage.', { explicitPrimaryRequired: true }),
  utility('preferred_utility_access_context', ['utility_access_context_present'], ['utility_meter_present', 'utility_meter_side_known'], ['routing-ready'], ['utility_meter'], ['utility_interconnection_method'], ['utility_access_review'], 'Ranks utility access context from explicit meter/access/connection signals.', { explicitPrimaryRequired: true }),

  ground('preferred_trench_context', ['trench_path_explicit'], ['trench_context_present', 'detached_structure_route_candidate'], ['trench-route-ready'], ['structural_access'], ['structural_access'], ['trench_route_review'], 'Ranks trench context only when explicit trench-path evidence exists.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),
  ground('preferred_detached_structure_context', ['detached_structure_present'], ['detached_structure_route_candidate', 'trench_path_explicit'], ['detached-structure-ready'], ['structural_access'], ['structural_access'], ['detached_structure_review'], 'Ranks detached-structure context only when explicit detached-structure evidence exists.', { explicitPrimaryRequired: true, optionalWhenPrimaryAbsent: true }),

  quality('preferred_traversal_context', ['survey_traversal_complete'], ['survey_sequence_continuity_good'], [], [], [], ['survey_quality_review'], 'Ranks traversal context from deterministic traversal and sequence metadata.'),
  quality('preferred_grouping_context', ['evidence_grouping_stable'], ['photo_cluster_confidence_high', 'survey_sequence_continuity_good'], [], [], [], ['survey_grouping_review'], 'Ranks grouping context from deterministic cluster stability metadata.'),
  quality('preferred_metadata_context', ['metadata_completeness_sufficient'], ['survey_traversal_complete', 'evidence_grouping_stable'], [], [], [], ['metadata_quality_review'], 'Ranks metadata context from explicit metadata completeness scoring.'),
];

export const ENGINEERING_CONTEXT_TYPES = ENGINEERING_CONTEXT_REGISTRY.map(definition => definition.contextType);

export function getEngineeringContextDefinition(contextType: EngineeringContextType) {
  return ENGINEERING_CONTEXT_REGISTRY.find(definition => definition.contextType === contextType) ?? null;
}

function roof(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'roof', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function routing(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'routing', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function electrical(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'electrical', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function ess(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'ess', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function utility(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'utility', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function ground(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'ground_detached', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function quality(contextType: EngineeringContextType, primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition> = {}): EngineeringContextDefinition {
  return definition(contextType, 'survey_quality', primarySignalTypes, supportingSignalTypes, cadImpacts, requirementImpacts, decisionImpacts, affectedOutputs, deterministicPurpose, extra);
}

function definition(contextType: EngineeringContextType, domain: EngineeringContextDefinition['domain'], primarySignalTypes: EngineeringContextDefinition['primarySignalTypes'], supportingSignalTypes: EngineeringContextDefinition['supportingSignalTypes'], cadImpacts: EngineeringContextDefinition['cadImpacts'], requirementImpacts: EngineeringContextDefinition['requirementImpacts'], decisionImpacts: string[], affectedOutputs: string[], deterministicPurpose: string, extra: Partial<EngineeringContextDefinition>): EngineeringContextDefinition {
  return {
    contextType,
    domain,
    label: contextType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    primarySignalTypes,
    supportingSignalTypes,
    conflictingSignalTypes: [...primarySignalTypes, ...supportingSignalTypes],
    cadImpacts,
    requirementImpacts,
    decisionImpacts,
    affectedOutputs,
    fallbackAllowed: false,
    explicitPrimaryRequired: false,
    optionalWhenPrimaryAbsent: false,
    deterministicPurpose,
    ...extra,
  };
}
