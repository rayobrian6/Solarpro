import type { StructuredEngineeringSignalDefinition, StructuredEngineeringSignalType } from './signalTypes';

export const STRUCTURED_ENGINEERING_SIGNAL_REGISTRY: StructuredEngineeringSignalDefinition[] = [
  electrical('utility_meter_present', ['meter'], ['utility_meter'], ['utility_interconnection_method'], ['routing-ready'], 'Utility meter evidence exists as an explicit canonical meter row.', 'No canonical meter evidence row is present.'),
  electrical('utility_meter_side_known', ['meter', 'utility_access'], ['utility_meter'], ['utility_interconnection_method'], ['routing-ready'], 'Utility side context exists from explicit meter/utility access evidence and utility metadata grouping.', 'Utility-side context is unavailable without meter or utility access evidence.', { clusterTypes: ['utility_evidence'], minimumEvidenceCount: 1 }),
  electrical('main_service_panel_present', ['main_service_panel'], ['main_service_panel'], ['service_panel_rating'], ['routing-ready'], 'Main service panel evidence exists as an explicit canonical row.', 'No canonical main_service_panel evidence row is present.'),
  electrical('main_disconnect_present', ['disconnect'], ['main_disconnect'], ['main_disconnect_required'], ['routing-ready'], 'Disconnect evidence exists as an explicit canonical row.', 'No canonical disconnect evidence row is present.', { notApplicableWhenAbsent: true }),
  electrical('subpanel_present', ['subpanel'], ['subpanel'], ['subpanel_interconnection_review'], ['routing-ready'], 'Subpanel evidence exists as an explicit canonical row.', 'No canonical subpanel evidence row is present.', { notApplicableWhenAbsent: true }),
  electrical('interconnection_zone_known', ['main_service_panel', 'meter', 'disconnect', 'utility_connection'], ['main_service_panel', 'utility_meter'], ['utility_interconnection_method'], ['routing-ready'], 'Interconnection zone context is supported by explicit electrical/utility evidence or survey electrical fields.', 'Interconnection zone cannot be known without electrical equipment evidence or explicit interconnection field data.', { fieldSignals: ['fieldEvidence.interconnectionPoint'] }),
  electrical('electrical_equipment_cluster_present', ['main_service_panel', 'meter'], ['main_service_panel', 'utility_meter'], ['service_panel_rating', 'utility_interconnection_method'], ['routing-ready'], 'Electrical equipment cluster exists from explicit electrical evidence categories and grouping metadata.', 'Electrical equipment cluster is blocked without MSP/meter evidence.', { clusterTypes: ['electrical_evidence', 'utility_evidence'], minimumEvidenceCount: 2 }),
  electrical('inverter_location_candidate_present', ['inverter_location', 'gateway_location'], ['battery_location'], ['inverter_mounting_context'], ['routing-ready'], 'Inverter/gateway candidate location exists from explicit canonical site evidence.', 'No inverter or gateway location evidence row is present.'),
  electrical('garage_interior_wall_present', ['garage_interior_wall'], ['battery_location'], ['inverter_mounting_context'], ['ESS-location-ready'], 'Garage interior wall evidence exists as explicit mounting context.', 'No garage interior wall evidence row is present.', { notApplicableWhenAbsent: true }),
  electrical('utility_access_context_present', ['utility_access', 'utility_connection', 'meter'], ['utility_meter'], ['utility_interconnection_method'], ['routing-ready'], 'Utility access context exists from explicit utility access/connection/meter evidence.', 'No utility access context evidence row is present.'),

  roof('roof_plane_context_present', ['roof_plane'], ['roof_overview'], ['roof_layout_context'], ['roof-plane-ready'], 'Roof plane context exists from explicit canonical roof_plane evidence.', 'No canonical roof_plane evidence row is present.'),
  roof('roof_edge_context_present', ['roof_edge'], ['roof_overview'], ['setback_context'], ['setback-ready'], 'Roof edge context exists from explicit roof_edge evidence.', 'No roof_edge evidence row is present.'),
  roof('ridge_context_present', ['ridge'], ['roof_overview'], ['setback_context'], ['setback-ready'], 'Ridge context exists from explicit ridge evidence.', 'No ridge evidence row is present.'),
  roof('obstruction_context_present', ['obstructions'], ['roof_overview'], ['setback_context'], ['setback-ready'], 'Obstruction context exists from explicit obstruction evidence.', 'No obstruction evidence row is present.', { clusterTypes: ['obstruction_continuity'] }),
  roof('roof_surface_context_present', ['roof_surface'], ['roof_overview', 'structural_access'], ['roof_surface_context'], ['roof-plane-ready'], 'Roof surface context exists from explicit roof_surface evidence or roof material field data.', 'No roof surface evidence or roof material field data is present.', { fieldSignals: ['fieldEvidence.roofMaterial'] }),
  roof('attic_access_confirmed', ['attic_access'], ['attic_access', 'structural_access'], ['structural_access_context'], ['roof-plane-ready'], 'Attic access is confirmed by explicit attic_access evidence.', 'No attic_access evidence row is present.', { notApplicableWhenAbsent: true }),
  roof('framing_context_present', ['rafters', 'attic'], ['structural_access'], ['structural_framing_context'], ['roof-plane-ready'], 'Framing context exists from explicit attic/rafter evidence or structural field data.', 'No attic/rafter evidence or structural field data is present.', { fieldSignals: ['fieldEvidence.rafterSize', 'fieldEvidence.rafterSpacingInches'] }),
  roof('structural_access_context_present', ['attic_access', 'attic', 'rafters', 'roof_surface'], ['structural_access'], ['structural_access_context'], ['roof-plane-ready'], 'Structural access context exists from explicit structural/roof surface evidence.', 'No structural access evidence row is present.'),
  roof('roof_layout_candidate_present', ['roof_plane', 'roof_edge', 'ridge', 'roof_surface', 'obstructions'], ['roof_overview'], ['roof_layout_context'], ['roof-plane-ready', 'setback-ready'], 'Roof layout candidate context exists from explicit roof evidence categories and roof-side grouping metadata.', 'Roof layout candidate is blocked without roof evidence.', { clusterTypes: ['roof_side_candidate'], minimumEvidenceCount: 1 }),

  routing('conduit_route_candidate_present', ['inverter_location', 'gateway_location', 'utility_connection', 'garage_interior_wall'], ['main_service_panel', 'utility_meter'], ['conduit_route_context'], ['routing-ready'], 'Conduit route candidate context exists from explicit inverter/gateway/utility/wall evidence.', 'No explicit route candidate evidence row is present.', { clusterTypes: ['routing_continuity'] }),
  routing('routing_continuity_present', ['inverter_location', 'gateway_location', 'utility_connection', 'main_service_panel', 'meter'], ['main_service_panel', 'utility_meter'], ['conduit_route_context'], ['routing-ready'], 'Routing continuity exists as deterministic grouping metadata plus explicit route/electrical categories; no route geometry is generated.', 'Routing continuity is blocked without route/electrical evidence grouping.', { clusterTypes: ['routing_continuity', 'electrical_evidence', 'utility_evidence'], groupedReadinessContextIds: ['grouped-readiness:route-continuity'], minimumClusterCount: 1 }),
  routing('exterior_wall_route_candidate', ['garage_interior_wall', 'inverter_location', 'utility_connection', 'overview'], ['main_service_panel'], ['conduit_route_context'], ['routing-ready'], 'Exterior/wall route candidate context exists from explicit wall, inverter, utility, or overview evidence.', 'No explicit exterior/wall route candidate evidence row is present.'),
  routing('attic_route_candidate', ['attic_access', 'attic', 'rafters'], ['attic_access', 'structural_access'], ['conduit_route_context'], ['routing-ready'], 'Attic route candidate context exists from explicit attic/access/framing evidence.', 'No attic/access/framing evidence row is present.', { notApplicableWhenAbsent: true }),
  routing('utility_to_inverter_route_candidate', ['meter', 'utility_access', 'utility_connection', 'inverter_location', 'gateway_location'], ['utility_meter'], ['conduit_route_context'], ['routing-ready'], 'Utility-to-inverter route candidate context exists from explicit utility and inverter/gateway evidence.', 'Utility-to-inverter route candidate is blocked without utility and inverter/gateway evidence.', { clusterTypes: ['utility_evidence', 'routing_continuity'], minimumEvidenceCount: 2 }),
  routing('inverter_to_msp_route_candidate', ['inverter_location', 'gateway_location', 'main_service_panel', 'garage_interior_wall'], ['main_service_panel'], ['conduit_route_context'], ['routing-ready'], 'Inverter-to-MSP route candidate context exists from explicit inverter/gateway and MSP/wall evidence.', 'Inverter-to-MSP route candidate is blocked without inverter/gateway and MSP/wall evidence.', { clusterTypes: ['electrical_evidence', 'routing_continuity'], minimumEvidenceCount: 2 }),

  ess('ess_location_candidate_present', ['battery_location', 'garage_interior_wall', 'gateway_location'], ['battery_location'], ['ess_location_context'], ['ESS-location-ready'], 'ESS location candidate context exists from explicit battery, garage wall, or gateway evidence.', 'No ESS location candidate evidence row is present.', { notApplicableWhenAbsent: true }),
  ess('battery_wall_candidate_present', ['battery_location', 'garage_interior_wall'], ['battery_location'], ['ess_location_context'], ['ESS-location-ready'], 'Battery wall candidate exists from explicit battery/garage wall evidence.', 'No battery wall candidate evidence row is present.', { notApplicableWhenAbsent: true }),
  ess('energy_storage_context_present', ['battery_location', 'gateway_location', 'garage_interior_wall'], ['battery_location'], ['ess_location_context'], ['ESS-location-ready'], 'Energy storage context exists from explicit storage/gateway/wall evidence.', 'No energy storage evidence row is present.', { notApplicableWhenAbsent: true }),

  trench('trench_path_explicit', ['trench_path'], [], ['trench_route_context'], ['trench-route-ready'], 'Trench path is explicit because a canonical trench_path evidence row exists.', 'No trench_path evidence row is present.', { notApplicableWhenAbsent: true }),
  trench('trench_context_present', ['trench_path', 'overview', 'utility_access', 'utility_connection'], [], ['trench_route_context'], ['trench-route-ready'], 'Trench context exists from explicit trench, overview, utility access, or utility connection evidence.', 'No trench context evidence row is present.', { clusterTypes: ['ground_mount_candidate'], notApplicableWhenAbsent: true }),
  trench('detached_structure_present', ['detached_structures'], [], ['detached_structure_context'], ['detached-structure-ready'], 'Detached structure context exists from explicit detached_structures evidence.', 'No detached_structures evidence row is present.', { notApplicableWhenAbsent: true }),
  trench('detached_structure_route_candidate', ['detached_structures', 'trench_path', 'overview'], [], ['detached_structure_context', 'trench_route_context'], ['detached-structure-ready', 'trench-route-ready'], 'Detached structure route candidate context exists from explicit detached/trench/overview evidence.', 'No detached route candidate evidence row is present.', { clusterTypes: ['detached_structure_candidate', 'ground_mount_candidate'], notApplicableWhenAbsent: true }),

  quality('survey_traversal_complete', [], [], [], [], 'Survey traversal metadata exists for all canonical manifest rows.', 'Traversal cannot be complete without canonical manifest rows.'),
  quality('survey_sequence_continuity_good', [], [], [], [], 'Survey sequence continuity has no breakpoint or only metadata-explained breakpoints.', 'Survey sequence continuity is blocked by missing traversal rows or excessive deterministic breakpoints.'),
  quality('metadata_completeness_sufficient', [], [], [], [], 'Metadata completeness is sufficient across canonical evidence rows.', 'Metadata completeness is insufficient or no metadata rows are present.'),
  quality('evidence_grouping_stable', [], [], [], [], 'Evidence grouping is stable from deterministic clusters and duplicate-safe ordering.', 'Evidence grouping is blocked without stable deterministic clusters.'),
  quality('photo_cluster_confidence_high', [], [], [], [], 'At least one deterministic metadata-only cluster has high confidence.', 'No deterministic metadata-only high-confidence cluster exists.'),
];

export const STRUCTURED_ENGINEERING_SIGNAL_TYPES = STRUCTURED_ENGINEERING_SIGNAL_REGISTRY.map(definition => definition.signalType);

export function getStructuredEngineeringSignalDefinition(signalType: StructuredEngineeringSignalType) {
  return STRUCTURED_ENGINEERING_SIGNAL_REGISTRY.find(definition => definition.signalType === signalType) ?? null;
}

function electrical(
  signalType: StructuredEngineeringSignalType,
  evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'],
  requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'],
  decisionImpacts: string[],
  cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'],
  explanation: string,
  missingReason: string,
  extra: Partial<StructuredEngineeringSignalDefinition> = {},
): StructuredEngineeringSignalDefinition {
  return definition(signalType, 'utility_electrical', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function roof(signalType: StructuredEngineeringSignalType, evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'], requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'], decisionImpacts: string[], cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'], explanation: string, missingReason: string, extra: Partial<StructuredEngineeringSignalDefinition> = {}) {
  return definition(signalType, 'roof_structural', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function routing(signalType: StructuredEngineeringSignalType, evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'], requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'], decisionImpacts: string[], cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'], explanation: string, missingReason: string, extra: Partial<StructuredEngineeringSignalDefinition> = {}) {
  return definition(signalType, 'routing', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function ess(signalType: StructuredEngineeringSignalType, evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'], requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'], decisionImpacts: string[], cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'], explanation: string, missingReason: string, extra: Partial<StructuredEngineeringSignalDefinition> = {}) {
  return definition(signalType, 'ess', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function trench(signalType: StructuredEngineeringSignalType, evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'], requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'], decisionImpacts: string[], cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'], explanation: string, missingReason: string, extra: Partial<StructuredEngineeringSignalDefinition> = {}) {
  return definition(signalType, 'ground_trench', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function quality(signalType: StructuredEngineeringSignalType, evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'], requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'], decisionImpacts: string[], cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'], explanation: string, missingReason: string, extra: Partial<StructuredEngineeringSignalDefinition> = {}) {
  return definition(signalType, 'survey_quality', evidenceCategories, requirementImpacts, decisionImpacts, cadImpacts, explanation, missingReason, extra);
}

function definition(
  signalType: StructuredEngineeringSignalType,
  category: StructuredEngineeringSignalDefinition['category'],
  evidenceCategories: StructuredEngineeringSignalDefinition['evidenceCategories'],
  requirementImpacts: StructuredEngineeringSignalDefinition['requirementImpacts'],
  decisionImpacts: string[],
  cadImpacts: StructuredEngineeringSignalDefinition['cadImpacts'],
  explanation: string,
  missingReason: string,
  extra: Partial<StructuredEngineeringSignalDefinition>,
): StructuredEngineeringSignalDefinition {
  return {
    signalType,
    category,
    label: signalType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    evidenceCategories,
    requirementImpacts,
    decisionImpacts,
    cadImpacts,
    sourceHints: ['canonical_evidence', 'canonical_evidence_metadata'],
    minimumEvidenceCount: 1,
    minimumClusterCount: 0,
    highConfidenceCluster: 'metadata_only_high',
    explanation,
    missingReason,
    ...extra,
  };
}
