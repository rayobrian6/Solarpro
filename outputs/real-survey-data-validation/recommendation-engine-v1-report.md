# Deterministic Engineering Recommendation Engine V1 Report

Generated at: 2025-01-01T00:00:00.000Z

This report was generated from the deterministic Engineering Recommendation System V1. Recommendations are guidance only; they do not mutate production evidence, requirements, decisions, outputs, invalidation history, snapshots, CAD assets, or regeneration plans.

## Runtime Boundary

- no OCR
- no OpenCV or cv2
- no TensorFlow, PyTorch, YOLO, or vision-model runtime
- no object detection
- no image-byte analysis
- no AI inference or LLM-generated recommendations
- no hallucinated geometry
- no autonomous engineering decisions
- no autonomous CAD generation
- no autonomous regeneration
- no automatic output mutation
- no hidden confidence boosting

## Deterministic Notes

- Engineering Recommendations V1 is deterministic guidance only and never mutates canonical evidence, requirements, decisions, outputs, invalidation history, snapshots, CAD files, or regeneration plans.
- Recommendations are ranked from explicit deterministic metadata: stale impacts, affected outputs, propagation depth, blocked requirements, CAD readiness, conflicts, fallbacks, unresolved dependencies, graph centrality, scenario deltas, and expected deterministic gains.
- Uncertainty, conflicts, fallback lineage, missing evidence, and unresolved dependencies remain visible in every recommendation instead of being silently collapsed.

## Top Recommendations

### simulate_msp_confirmation

- Recommendation id: `simulate_msp_confirmation:recommendation-v1-c970248b`
- Priority: critical
- Severity: review_required
- Confidence: medium
- Deterministic score: 11245
- Deterministic hash: `recommendation-v1-c970248b`
- Expected confidence gain: 1
- Expected readiness gain: 0.2
- Affected evidence: ev_uv641c
- Affected signals: signal:attic_access_confirmed, signal:attic_route_candidate, signal:battery_wall_candidate_present, signal:conduit_route_candidate_present, signal:detached_structure_present, signal:detached_structure_route_candidate, signal:electrical_equipment_cluster_present, signal:energy_storage_context_present, signal:ess_location_candidate_present, signal:evidence_grouping_stable, signal:exterior_wall_route_candidate, signal:framing_context_present, signal:garage_interior_wall_present, signal:interconnection_zone_known, signal:inverter_location_candidate_present, signal:inverter_to_msp_route_candidate, signal:main_disconnect_present, signal:main_service_panel_present, signal:metadata_completeness_sufficient, signal:obstruction_context_present, signal:photo_cluster_confidence_high, signal:ridge_context_present, signal:roof_edge_context_present, signal:roof_layout_candidate_present, signal:roof_plane_context_present, signal:roof_surface_context_present, signal:routing_continuity_present, signal:structural_access_context_present, signal:subpanel_present, signal:survey_sequence_continuity_good, signal:survey_traversal_complete, signal:trench_context_present, signal:trench_path_explicit, signal:utility_access_context_present, signal:utility_meter_present, signal:utility_meter_side_known, signal:utility_to_inverter_route_candidate
- Affected contexts: context:preferred_attic_route_context, context:preferred_battery_location_context, context:preferred_conduit_context, context:preferred_detached_structure_context, context:preferred_disconnect_context, context:preferred_equipment_cluster_context, context:preferred_ess_context, context:preferred_exterior_route_context, context:preferred_grouping_context, context:preferred_interconnection_context, context:preferred_inverter_to_msp_context, context:preferred_layout_context, context:preferred_metadata_context, context:preferred_msp_context, context:preferred_obstruction_context, context:preferred_roof_context, context:preferred_roof_plane_context, context:preferred_routing_context, context:preferred_setback_context, context:preferred_traversal_context, context:preferred_trench_context, context:preferred_utility_access_context, context:preferred_utility_meter_context, context:preferred_utility_to_inverter_context
- Affected requirements: attic_access, battery_location, main_disconnect, main_service_panel, roof_overview, structural_access, subpanel, utility_meter
- Affected decisions: conduit_route_context, decision:bom_derivation, decision:breaker_sizing, decision:conductor_sizing, decision:conduit_routing_assumption, decision:grounding_bonding_assumption, decision:inverter_selection, decision:layout_orientation_assumption, decision:mppt_assignment, decision:ocpd_selection, decision:placard_requirement, decision:rapid_shutdown_placement, decision:setback_assumption, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption, detached_structure_context, ess_location_context, inverter_mounting_context, main_disconnect_required, main_service_panel, roof_layout_context, roof_overview, roof_surface_context, service_panel_rating, setback_context, structural_access, structural_access_context, structural_framing_context, subpanel_interconnection_review, trench_route_context, utility_interconnection_method, utility_meter
- Affected outputs: attic_route_review, battery_location_review, bom_service_equipment, cad_layout_readiness, cad_roof_plane_context, cad_routing_readiness, conduit_notes, detached_structure_review, equipment_cluster_review, ess_location_review, exterior_route_review, inverter_to_msp_review, metadata_quality_review, obstruction_review, permit_plan_set, permit_setback_notes, renderContext:primary, routing_review, sld_disconnect_context, sld_interconnection_context, sld_service_panel_context, sld_utility_meter_context, state:decision:decision:breaker_sizing, state:decision:decision:conduit_routing_assumption, state:decision:decision:sld_metadata, state:decision:decision:utility_interconnection_assumption, state:dependencyNode:canonicalEvidence:ev_uv641c, state:dependencyNode:decision:breaker_sizing, state:dependencyNode:decision:conduit_routing_assumption, state:dependencyNode:decision:sld_metadata, state:dependencyNode:decision:utility_interconnection_assumption, state:dependencyNode:documentSection:E-1.disconnect, state:dependencyNode:documentSection:E-1.interconnection, state:dependencyNode:documentSection:E-1.optional-subpanel, state:dependencyNode:documentSection:E-1.utility-meter, state:dependencyNode:documentSection:ESS.location-context, state:dependencyNode:documentSection:PV-1.ess-location, state:dependencyNode:documentSection:PV-1.site-verification, state:dependencyNode:documentSection:PV-2.layout-context, state:dependencyNode:documentSection:PV-2.layout-verification, state:dependencyNode:documentSection:PV-3.structural-access, state:dependencyNode:documentSection:PV-3.structural-review, state:dependencyNode:documentSection:PV-5.labels, state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes, state:dependencyNode:documentSection:SLD.disconnect, state:dependencyNode:documentSection:SLD.rapid-shutdown, state:dependencyNode:documentSection:SLD.service-equipment, state:dependencyNode:documentSection:SLD.utility-meter, state:dependencyNode:documentSection:VAL-1.inactive-future, state:dependencyNode:documentSection:VAL-1.registry, state:dependencyNode:geometryInput:geometry:electrical-equipment-context, state:dependencyNode:renderContext:primary, state:dependencyNode:requirement:utility_meter, state:documentSection:E-1.disconnect, state:documentSection:E-1.interconnection, state:documentSection:E-1.optional-subpanel, state:documentSection:E-1.utility-meter, state:documentSection:ESS.location-context, state:documentSection:PV-1.ess-location, state:documentSection:PV-1.site-verification, state:documentSection:PV-2.layout-context, state:documentSection:PV-2.layout-verification, state:documentSection:PV-3.structural-access, state:documentSection:PV-3.structural-review, state:documentSection:PV-5.labels, state:documentSection:PV-5.rapid-shutdown-notes, state:documentSection:SLD.disconnect, state:documentSection:SLD.rapid-shutdown, state:documentSection:SLD.service-equipment, state:documentSection:SLD.utility-meter, state:documentSection:VAL-1.inactive-future, state:documentSection:VAL-1.registry, state:renderContext:renderContext:primary, state:sldSection:permit:project-recommendation-report-1:survey-recommendation-report-1.decision-provenance.sld, survey_grouping_review, survey_quality_review, trench_route_review, utility_access_review, utility_to_inverter_review
- CAD-readiness impact: detached-structure-ready, ESS-location-ready, trench-route-ready

Use existing scenario simulation deltas to rank MSP confirmation value. Scenario scenario:recommendation:trench-resolution provides deterministic sandbox deltas only; use it to understand likely engineering-value improvements without treating hypothetical state as production truth.

#### Why it exists

Score is derived from scenario scenario:recommendation:trench-resolution: deltas, confidence deltas, affected outputs, conflicts, fallbacks, stale impacts, and dependency traversal paths.

#### Uncertainty preserved

- Unresolved state preserved: cad_readiness:ESS-location-ready:blocked
- Unresolved state preserved: context:context:preferred_attic_route_context:conflicting
- Unresolved state preserved: context:context:preferred_battery_location_context:conflicting
- Unresolved state preserved: context:context:preferred_conduit_context:conflicting
- Unresolved state preserved: context:context:preferred_detached_structure_context:conflicting
- Unresolved state preserved: context:context:preferred_disconnect_context:conflicting
- Unresolved state preserved: context:context:preferred_equipment_cluster_context:conflicting
- Unresolved state preserved: context:context:preferred_ess_context:conflicting
- Unresolved state preserved: context:context:preferred_exterior_route_context:conflicting
- Unresolved state preserved: context:context:preferred_grouping_context:conflicting
- Unresolved state preserved: context:context:preferred_interconnection_context:conflicting
- Unresolved state preserved: context:context:preferred_inverter_to_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_layout_context:conflicting
- Unresolved state preserved: context:context:preferred_metadata_context:conflicting
- Unresolved state preserved: context:context:preferred_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_obstruction_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_plane_context:conflicting
- Unresolved state preserved: context:context:preferred_routing_context:conflicting
- Unresolved state preserved: context:context:preferred_setback_context:conflicting
- Unresolved state preserved: context:context:preferred_traversal_context:conflicting
- Unresolved state preserved: context:context:preferred_trench_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_access_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_meter_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_to_inverter_context:conflicting
- Unresolved state preserved: signal:signal:attic_access_confirmed:missing
- Unresolved state preserved: signal:signal:attic_route_candidate:missing
- Unresolved state preserved: signal:signal:battery_wall_candidate_present:missing
- Unresolved state preserved: signal:signal:conduit_route_candidate_present:missing
- Unresolved state preserved: signal:signal:detached_structure_present:missing
- Unresolved state preserved: signal:signal:detached_structure_route_candidate:missing
- Unresolved state preserved: signal:signal:electrical_equipment_cluster_present:missing
- Unresolved state preserved: signal:signal:energy_storage_context_present:missing
- Unresolved state preserved: signal:signal:ess_location_candidate_present:missing
- Unresolved state preserved: signal:signal:evidence_grouping_stable:missing
- Unresolved state preserved: signal:signal:exterior_wall_route_candidate:missing
- Unresolved state preserved: signal:signal:framing_context_present:missing
- Unresolved state preserved: signal:signal:garage_interior_wall_present:missing
- Unresolved state preserved: signal:signal:interconnection_zone_known:missing
- Unresolved state preserved: signal:signal:inverter_location_candidate_present:missing
- Unresolved state preserved: signal:signal:inverter_to_msp_route_candidate:missing
- Unresolved state preserved: signal:signal:main_disconnect_present:missing
- Unresolved state preserved: signal:signal:main_service_panel_present:missing
- Unresolved state preserved: signal:signal:metadata_completeness_sufficient:missing
- Unresolved state preserved: signal:signal:obstruction_context_present:missing
- Unresolved state preserved: signal:signal:photo_cluster_confidence_high:missing
- Unresolved state preserved: signal:signal:ridge_context_present:missing
- Unresolved state preserved: signal:signal:roof_edge_context_present:missing
- Unresolved state preserved: signal:signal:roof_layout_candidate_present:missing
- Unresolved state preserved: signal:signal:roof_plane_context_present:missing
- Unresolved state preserved: signal:signal:roof_surface_context_present:missing
- Unresolved state preserved: signal:signal:routing_continuity_present:missing
- Unresolved state preserved: signal:signal:structural_access_context_present:missing
- Unresolved state preserved: signal:signal:subpanel_present:missing
- Unresolved state preserved: signal:signal:survey_sequence_continuity_good:missing
- Unresolved state preserved: signal:signal:survey_traversal_complete:missing
- Unresolved state preserved: signal:signal:trench_context_present:missing
- Unresolved state preserved: signal:signal:utility_access_context_present:missing
- Unresolved state preserved: signal:signal:utility_meter_present:missing
- Unresolved state preserved: signal:signal:utility_meter_side_known:missing
- Unresolved state preserved: signal:signal:utility_to_inverter_route_candidate:missing

### simulate_msp_confirmation

- Recommendation id: `simulate_msp_confirmation:recommendation-v1-a4cab61c`
- Priority: critical
- Severity: review_required
- Confidence: medium
- Deterministic score: 11232
- Deterministic hash: `recommendation-v1-a4cab61c`
- Expected confidence gain: 1
- Expected readiness gain: 0.2
- Affected evidence: ev_uv641c
- Affected signals: signal:attic_access_confirmed, signal:attic_route_candidate, signal:battery_wall_candidate_present, signal:conduit_route_candidate_present, signal:detached_structure_present, signal:detached_structure_route_candidate, signal:electrical_equipment_cluster_present, signal:energy_storage_context_present, signal:ess_location_candidate_present, signal:evidence_grouping_stable, signal:exterior_wall_route_candidate, signal:framing_context_present, signal:garage_interior_wall_present, signal:interconnection_zone_known, signal:inverter_location_candidate_present, signal:inverter_to_msp_route_candidate, signal:main_disconnect_present, signal:main_service_panel_present, signal:metadata_completeness_sufficient, signal:obstruction_context_present, signal:photo_cluster_confidence_high, signal:ridge_context_present, signal:roof_edge_context_present, signal:roof_layout_candidate_present, signal:roof_plane_context_present, signal:roof_surface_context_present, signal:routing_continuity_present, signal:structural_access_context_present, signal:subpanel_present, signal:survey_sequence_continuity_good, signal:survey_traversal_complete, signal:trench_context_present, signal:trench_path_explicit, signal:utility_access_context_present, signal:utility_meter_present, signal:utility_meter_side_known, signal:utility_to_inverter_route_candidate
- Affected contexts: context:preferred_attic_route_context, context:preferred_battery_location_context, context:preferred_conduit_context, context:preferred_detached_structure_context, context:preferred_disconnect_context, context:preferred_equipment_cluster_context, context:preferred_ess_context, context:preferred_exterior_route_context, context:preferred_grouping_context, context:preferred_interconnection_context, context:preferred_inverter_to_msp_context, context:preferred_layout_context, context:preferred_metadata_context, context:preferred_msp_context, context:preferred_obstruction_context, context:preferred_roof_context, context:preferred_roof_plane_context, context:preferred_routing_context, context:preferred_setback_context, context:preferred_traversal_context, context:preferred_trench_context, context:preferred_utility_access_context, context:preferred_utility_meter_context, context:preferred_utility_to_inverter_context
- Affected requirements: attic_access, battery_location, main_disconnect, main_service_panel, roof_overview, structural_access, subpanel, utility_meter
- Affected decisions: conduit_route_context, decision:bom_derivation, decision:breaker_sizing, decision:conductor_sizing, decision:conduit_routing_assumption, decision:grounding_bonding_assumption, decision:inverter_selection, decision:layout_orientation_assumption, decision:mppt_assignment, decision:ocpd_selection, decision:placard_requirement, decision:rapid_shutdown_placement, decision:setback_assumption, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption, detached_structure_context, ess_location_context, inverter_mounting_context, main_disconnect_required, main_service_panel, roof_layout_context, roof_overview, roof_surface_context, service_panel_rating, setback_context, structural_access, structural_access_context, structural_framing_context, subpanel_interconnection_review, trench_route_context, utility_interconnection_method, utility_meter
- Affected outputs: attic_route_review, battery_location_review, bom_service_equipment, cad_layout_readiness, cad_roof_plane_context, cad_routing_readiness, conduit_notes, detached_structure_review, equipment_cluster_review, ess_location_review, exterior_route_review, inverter_to_msp_review, metadata_quality_review, obstruction_review, permit_plan_set, permit_setback_notes, renderContext:primary, routing_review, sld_disconnect_context, sld_interconnection_context, sld_service_panel_context, sld_utility_meter_context, state:decision:decision:breaker_sizing, state:decision:decision:conduit_routing_assumption, state:decision:decision:sld_metadata, state:decision:decision:utility_interconnection_assumption, state:dependencyNode:canonicalEvidence:ev_uv641c, state:dependencyNode:decision:breaker_sizing, state:dependencyNode:decision:conduit_routing_assumption, state:dependencyNode:decision:sld_metadata, state:dependencyNode:decision:utility_interconnection_assumption, state:dependencyNode:documentSection:E-1.disconnect, state:dependencyNode:documentSection:E-1.interconnection, state:dependencyNode:documentSection:E-1.optional-subpanel, state:dependencyNode:documentSection:E-1.utility-meter, state:dependencyNode:documentSection:ESS.location-context, state:dependencyNode:documentSection:PV-1.ess-location, state:dependencyNode:documentSection:PV-1.site-verification, state:dependencyNode:documentSection:PV-2.layout-context, state:dependencyNode:documentSection:PV-2.layout-verification, state:dependencyNode:documentSection:PV-3.structural-access, state:dependencyNode:documentSection:PV-3.structural-review, state:dependencyNode:documentSection:PV-5.labels, state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes, state:dependencyNode:documentSection:SLD.disconnect, state:dependencyNode:documentSection:SLD.rapid-shutdown, state:dependencyNode:documentSection:SLD.service-equipment, state:dependencyNode:documentSection:SLD.utility-meter, state:dependencyNode:documentSection:VAL-1.inactive-future, state:dependencyNode:documentSection:VAL-1.registry, state:dependencyNode:geometryInput:geometry:electrical-equipment-context, state:dependencyNode:renderContext:primary, state:dependencyNode:requirement:utility_meter, state:documentSection:E-1.disconnect, state:documentSection:E-1.interconnection, state:documentSection:E-1.optional-subpanel, state:documentSection:E-1.utility-meter, state:documentSection:ESS.location-context, state:documentSection:PV-1.ess-location, state:documentSection:PV-1.site-verification, state:documentSection:PV-2.layout-context, state:documentSection:PV-2.layout-verification, state:documentSection:PV-3.structural-access, state:documentSection:PV-3.structural-review, state:documentSection:PV-5.labels, state:documentSection:PV-5.rapid-shutdown-notes, state:documentSection:SLD.disconnect, state:documentSection:SLD.rapid-shutdown, state:documentSection:SLD.service-equipment, state:documentSection:SLD.utility-meter, state:documentSection:VAL-1.inactive-future, state:documentSection:VAL-1.registry, state:renderContext:renderContext:primary, state:sldSection:permit:project-recommendation-report-1:survey-recommendation-report-1.decision-provenance.sld, survey_grouping_review, survey_quality_review, trench_route_review, utility_access_review, utility_to_inverter_review
- CAD-readiness impact: detached-structure-ready, ESS-location-ready, trench-route-ready

Use existing scenario simulation deltas to rank MSP confirmation value. Scenario scenario:recommendation:msp-confirmation provides deterministic sandbox deltas only; use it to understand likely engineering-value improvements without treating hypothetical state as production truth.

#### Why it exists

Score is derived from scenario scenario:recommendation:msp-confirmation: deltas, confidence deltas, affected outputs, conflicts, fallbacks, stale impacts, and dependency traversal paths.

#### Uncertainty preserved

- Unresolved state preserved: cad_readiness:ESS-location-ready:blocked
- Unresolved state preserved: context:context:preferred_attic_route_context:conflicting
- Unresolved state preserved: context:context:preferred_battery_location_context:conflicting
- Unresolved state preserved: context:context:preferred_conduit_context:conflicting
- Unresolved state preserved: context:context:preferred_detached_structure_context:conflicting
- Unresolved state preserved: context:context:preferred_disconnect_context:conflicting
- Unresolved state preserved: context:context:preferred_equipment_cluster_context:conflicting
- Unresolved state preserved: context:context:preferred_ess_context:conflicting
- Unresolved state preserved: context:context:preferred_exterior_route_context:conflicting
- Unresolved state preserved: context:context:preferred_grouping_context:conflicting
- Unresolved state preserved: context:context:preferred_interconnection_context:conflicting
- Unresolved state preserved: context:context:preferred_inverter_to_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_layout_context:conflicting
- Unresolved state preserved: context:context:preferred_metadata_context:conflicting
- Unresolved state preserved: context:context:preferred_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_obstruction_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_plane_context:conflicting
- Unresolved state preserved: context:context:preferred_routing_context:conflicting
- Unresolved state preserved: context:context:preferred_setback_context:conflicting
- Unresolved state preserved: context:context:preferred_traversal_context:conflicting
- Unresolved state preserved: context:context:preferred_trench_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_access_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_meter_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_to_inverter_context:conflicting
- Unresolved state preserved: signal:signal:attic_access_confirmed:missing
- Unresolved state preserved: signal:signal:attic_route_candidate:missing
- Unresolved state preserved: signal:signal:battery_wall_candidate_present:missing
- Unresolved state preserved: signal:signal:conduit_route_candidate_present:missing
- Unresolved state preserved: signal:signal:detached_structure_present:missing
- Unresolved state preserved: signal:signal:detached_structure_route_candidate:missing
- Unresolved state preserved: signal:signal:electrical_equipment_cluster_present:missing
- Unresolved state preserved: signal:signal:energy_storage_context_present:missing
- Unresolved state preserved: signal:signal:ess_location_candidate_present:missing
- Unresolved state preserved: signal:signal:evidence_grouping_stable:missing
- Unresolved state preserved: signal:signal:exterior_wall_route_candidate:missing
- Unresolved state preserved: signal:signal:framing_context_present:missing
- Unresolved state preserved: signal:signal:garage_interior_wall_present:missing
- Unresolved state preserved: signal:signal:interconnection_zone_known:missing
- Unresolved state preserved: signal:signal:inverter_location_candidate_present:missing
- Unresolved state preserved: signal:signal:inverter_to_msp_route_candidate:missing
- Unresolved state preserved: signal:signal:main_disconnect_present:missing
- Unresolved state preserved: signal:signal:main_service_panel_present:confirmed
- Unresolved state preserved: signal:signal:metadata_completeness_sufficient:missing
- Unresolved state preserved: signal:signal:obstruction_context_present:missing
- Unresolved state preserved: signal:signal:photo_cluster_confidence_high:missing
- Unresolved state preserved: signal:signal:ridge_context_present:missing
- Unresolved state preserved: signal:signal:roof_edge_context_present:missing
- Unresolved state preserved: signal:signal:roof_layout_candidate_present:missing
- Unresolved state preserved: signal:signal:roof_plane_context_present:missing
- Unresolved state preserved: signal:signal:roof_surface_context_present:missing
- Unresolved state preserved: signal:signal:routing_continuity_present:missing
- Unresolved state preserved: signal:signal:structural_access_context_present:missing
- Unresolved state preserved: signal:signal:subpanel_present:missing
- Unresolved state preserved: signal:signal:survey_sequence_continuity_good:missing
- Unresolved state preserved: signal:signal:survey_traversal_complete:missing
- Unresolved state preserved: signal:signal:trench_context_present:missing
- Unresolved state preserved: signal:signal:trench_path_explicit:missing
- Unresolved state preserved: signal:signal:utility_access_context_present:missing
- Unresolved state preserved: signal:signal:utility_meter_present:missing
- Unresolved state preserved: signal:signal:utility_meter_side_known:missing
- Unresolved state preserved: signal:signal:utility_to_inverter_route_candidate:missing

### simulate_msp_confirmation

- Recommendation id: `simulate_msp_confirmation:recommendation-v1-9098af5a`
- Priority: critical
- Severity: review_required
- Confidence: medium
- Deterministic score: 11195
- Deterministic hash: `recommendation-v1-9098af5a`
- Expected confidence gain: 1
- Expected readiness gain: 0.2
- Affected evidence: ev_uv641c
- Affected signals: signal:attic_access_confirmed, signal:attic_route_candidate, signal:battery_wall_candidate_present, signal:conduit_route_candidate_present, signal:detached_structure_present, signal:detached_structure_route_candidate, signal:electrical_equipment_cluster_present, signal:energy_storage_context_present, signal:ess_location_candidate_present, signal:evidence_grouping_stable, signal:exterior_wall_route_candidate, signal:framing_context_present, signal:garage_interior_wall_present, signal:interconnection_zone_known, signal:inverter_location_candidate_present, signal:inverter_to_msp_route_candidate, signal:main_disconnect_present, signal:main_service_panel_present, signal:metadata_completeness_sufficient, signal:obstruction_context_present, signal:photo_cluster_confidence_high, signal:ridge_context_present, signal:roof_edge_context_present, signal:roof_layout_candidate_present, signal:roof_plane_context_present, signal:roof_surface_context_present, signal:routing_continuity_present, signal:structural_access_context_present, signal:subpanel_present, signal:survey_sequence_continuity_good, signal:survey_traversal_complete, signal:trench_context_present, signal:trench_path_explicit, signal:utility_access_context_present, signal:utility_meter_present, signal:utility_meter_side_known, signal:utility_to_inverter_route_candidate
- Affected contexts: context:preferred_attic_route_context, context:preferred_battery_location_context, context:preferred_conduit_context, context:preferred_detached_structure_context, context:preferred_disconnect_context, context:preferred_equipment_cluster_context, context:preferred_ess_context, context:preferred_exterior_route_context, context:preferred_grouping_context, context:preferred_interconnection_context, context:preferred_inverter_to_msp_context, context:preferred_layout_context, context:preferred_metadata_context, context:preferred_msp_context, context:preferred_obstruction_context, context:preferred_roof_context, context:preferred_roof_plane_context, context:preferred_routing_context, context:preferred_setback_context, context:preferred_traversal_context, context:preferred_trench_context, context:preferred_utility_access_context, context:preferred_utility_meter_context, context:preferred_utility_to_inverter_context
- Affected requirements: attic_access, battery_location, main_disconnect, main_service_panel, roof_overview, structural_access, subpanel, utility_meter
- Affected decisions: conduit_route_context, decision:bom_derivation, decision:breaker_sizing, decision:conductor_sizing, decision:conduit_routing_assumption, decision:grounding_bonding_assumption, decision:inverter_selection, decision:layout_orientation_assumption, decision:mppt_assignment, decision:ocpd_selection, decision:placard_requirement, decision:rapid_shutdown_placement, decision:setback_assumption, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption, detached_structure_context, ess_location_context, inverter_mounting_context, main_disconnect_required, main_service_panel, roof_layout_context, roof_overview, roof_surface_context, service_panel_rating, setback_context, structural_access, structural_access_context, structural_framing_context, subpanel_interconnection_review, trench_route_context, utility_interconnection_method, utility_meter
- Affected outputs: attic_route_review, battery_location_review, bom_service_equipment, cad_layout_readiness, cad_roof_plane_context, cad_routing_readiness, conduit_notes, detached_structure_review, equipment_cluster_review, ess_location_review, exterior_route_review, inverter_to_msp_review, metadata_quality_review, obstruction_review, permit_plan_set, permit_setback_notes, renderContext:primary, routing_review, sld_disconnect_context, sld_interconnection_context, sld_service_panel_context, sld_utility_meter_context, state:decision:decision:breaker_sizing, state:decision:decision:conduit_routing_assumption, state:decision:decision:sld_metadata, state:decision:decision:utility_interconnection_assumption, state:dependencyNode:canonicalEvidence:ev_uv641c, state:dependencyNode:decision:breaker_sizing, state:dependencyNode:decision:conduit_routing_assumption, state:dependencyNode:decision:sld_metadata, state:dependencyNode:decision:utility_interconnection_assumption, state:dependencyNode:documentSection:E-1.disconnect, state:dependencyNode:documentSection:E-1.interconnection, state:dependencyNode:documentSection:E-1.optional-subpanel, state:dependencyNode:documentSection:E-1.utility-meter, state:dependencyNode:documentSection:ESS.location-context, state:dependencyNode:documentSection:PV-1.ess-location, state:dependencyNode:documentSection:PV-1.site-verification, state:dependencyNode:documentSection:PV-2.layout-context, state:dependencyNode:documentSection:PV-2.layout-verification, state:dependencyNode:documentSection:PV-3.structural-access, state:dependencyNode:documentSection:PV-3.structural-review, state:dependencyNode:documentSection:PV-5.labels, state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes, state:dependencyNode:documentSection:SLD.disconnect, state:dependencyNode:documentSection:SLD.rapid-shutdown, state:dependencyNode:documentSection:SLD.service-equipment, state:dependencyNode:documentSection:SLD.utility-meter, state:dependencyNode:documentSection:VAL-1.inactive-future, state:dependencyNode:documentSection:VAL-1.registry, state:dependencyNode:geometryInput:geometry:electrical-equipment-context, state:dependencyNode:renderContext:primary, state:dependencyNode:requirement:utility_meter, state:documentSection:E-1.disconnect, state:documentSection:E-1.interconnection, state:documentSection:E-1.optional-subpanel, state:documentSection:E-1.utility-meter, state:documentSection:ESS.location-context, state:documentSection:PV-1.ess-location, state:documentSection:PV-1.site-verification, state:documentSection:PV-2.layout-context, state:documentSection:PV-2.layout-verification, state:documentSection:PV-3.structural-access, state:documentSection:PV-3.structural-review, state:documentSection:PV-5.labels, state:documentSection:PV-5.rapid-shutdown-notes, state:documentSection:SLD.disconnect, state:documentSection:SLD.rapid-shutdown, state:documentSection:SLD.service-equipment, state:documentSection:SLD.utility-meter, state:documentSection:VAL-1.inactive-future, state:documentSection:VAL-1.registry, state:renderContext:renderContext:primary, state:sldSection:permit:project-recommendation-report-1:survey-recommendation-report-1.decision-provenance.sld, survey_grouping_review, survey_quality_review, trench_route_review, utility_access_review, utility_to_inverter_review
- CAD-readiness impact: detached-structure-ready, ESS-location-ready, trench-route-ready

Use existing scenario simulation deltas to rank MSP confirmation value. Scenario scenario:recommendation:routing-confirmation provides deterministic sandbox deltas only; use it to understand likely engineering-value improvements without treating hypothetical state as production truth.

#### Why it exists

Score is derived from scenario scenario:recommendation:routing-confirmation: deltas, confidence deltas, affected outputs, conflicts, fallbacks, stale impacts, and dependency traversal paths.

#### Uncertainty preserved

- Unresolved state preserved: cad_readiness:ESS-location-ready:blocked
- Unresolved state preserved: context:context:preferred_attic_route_context:conflicting
- Unresolved state preserved: context:context:preferred_battery_location_context:conflicting
- Unresolved state preserved: context:context:preferred_conduit_context:conflicting
- Unresolved state preserved: context:context:preferred_detached_structure_context:conflicting
- Unresolved state preserved: context:context:preferred_disconnect_context:conflicting
- Unresolved state preserved: context:context:preferred_equipment_cluster_context:conflicting
- Unresolved state preserved: context:context:preferred_ess_context:conflicting
- Unresolved state preserved: context:context:preferred_exterior_route_context:conflicting
- Unresolved state preserved: context:context:preferred_grouping_context:conflicting
- Unresolved state preserved: context:context:preferred_interconnection_context:conflicting
- Unresolved state preserved: context:context:preferred_inverter_to_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_layout_context:conflicting
- Unresolved state preserved: context:context:preferred_metadata_context:conflicting
- Unresolved state preserved: context:context:preferred_msp_context:conflicting
- Unresolved state preserved: context:context:preferred_obstruction_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_context:conflicting
- Unresolved state preserved: context:context:preferred_roof_plane_context:conflicting
- Unresolved state preserved: context:context:preferred_routing_context:conflicting
- Unresolved state preserved: context:context:preferred_setback_context:conflicting
- Unresolved state preserved: context:context:preferred_traversal_context:conflicting
- Unresolved state preserved: context:context:preferred_trench_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_access_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_meter_context:conflicting
- Unresolved state preserved: context:context:preferred_utility_to_inverter_context:conflicting
- Unresolved state preserved: signal:signal:attic_access_confirmed:missing
- Unresolved state preserved: signal:signal:attic_route_candidate:missing
- Unresolved state preserved: signal:signal:battery_wall_candidate_present:missing
- Unresolved state preserved: signal:signal:conduit_route_candidate_present:missing
- Unresolved state preserved: signal:signal:detached_structure_present:missing
- Unresolved state preserved: signal:signal:detached_structure_route_candidate:missing
- Unresolved state preserved: signal:signal:electrical_equipment_cluster_present:missing
- Unresolved state preserved: signal:signal:energy_storage_context_present:missing
- Unresolved state preserved: signal:signal:ess_location_candidate_present:missing
- Unresolved state preserved: signal:signal:evidence_grouping_stable:missing
- Unresolved state preserved: signal:signal:exterior_wall_route_candidate:missing
- Unresolved state preserved: signal:signal:framing_context_present:missing
- Unresolved state preserved: signal:signal:garage_interior_wall_present:missing
- Unresolved state preserved: signal:signal:interconnection_zone_known:missing
- Unresolved state preserved: signal:signal:inverter_location_candidate_present:missing
- Unresolved state preserved: signal:signal:inverter_to_msp_route_candidate:missing
- Unresolved state preserved: signal:signal:main_disconnect_present:missing
- Unresolved state preserved: signal:signal:main_service_panel_present:missing
- Unresolved state preserved: signal:signal:metadata_completeness_sufficient:missing
- Unresolved state preserved: signal:signal:obstruction_context_present:missing
- Unresolved state preserved: signal:signal:photo_cluster_confidence_high:missing
- Unresolved state preserved: signal:signal:ridge_context_present:missing
- Unresolved state preserved: signal:signal:roof_edge_context_present:missing
- Unresolved state preserved: signal:signal:roof_layout_candidate_present:missing
- Unresolved state preserved: signal:signal:roof_plane_context_present:missing
- Unresolved state preserved: signal:signal:roof_surface_context_present:missing
- Unresolved state preserved: signal:signal:structural_access_context_present:missing
- Unresolved state preserved: signal:signal:subpanel_present:missing
- Unresolved state preserved: signal:signal:survey_sequence_continuity_good:missing
- Unresolved state preserved: signal:signal:survey_traversal_complete:missing
- Unresolved state preserved: signal:signal:trench_context_present:missing
- Unresolved state preserved: signal:signal:trench_path_explicit:missing
- Unresolved state preserved: signal:signal:utility_access_context_present:missing
- Unresolved state preserved: signal:signal:utility_meter_present:missing
- Unresolved state preserved: signal:signal:utility_meter_side_known:missing
- Unresolved state preserved: signal:signal:utility_to_inverter_route_candidate:missing

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-ac79d32f`
- Priority: critical
- Severity: review_required
- Confidence: medium
- Deterministic score: 5515
- Deterministic hash: `recommendation-v1-ac79d32f`
- Expected confidence gain: 0
- Expected readiness gain: 0.2
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: attic_access, main_disconnect, main_service_panel, placards, rapid_shutdown, service_equipment_label, structural_access, subpanel, utility_bill
- Affected decisions: decision:bom_derivation, decision:breaker_sizing, decision:conductor_sizing, decision:conduit_routing_assumption, decision:grounding_bonding_assumption, decision:inverter_selection, decision:layout_orientation_assumption, decision:mppt_assignment, decision:ocpd_selection, decision:placard_requirement, decision:rapid_shutdown_placement, decision:setback_assumption, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption
- Affected outputs: state:decision:decision:breaker_sizing, state:decision:decision:conduit_routing_assumption, state:decision:decision:sld_metadata, state:decision:decision:utility_interconnection_assumption, state:dependencyNode:canonicalEvidence:ev_uv641c, state:dependencyNode:decision:breaker_sizing, state:dependencyNode:decision:conduit_routing_assumption, state:dependencyNode:decision:sld_metadata, state:dependencyNode:decision:utility_interconnection_assumption, state:dependencyNode:documentSection:E-1.disconnect, state:dependencyNode:documentSection:E-1.interconnection, state:dependencyNode:documentSection:E-1.optional-subpanel, state:dependencyNode:documentSection:E-1.utility-meter, state:dependencyNode:documentSection:ESS.location-context, state:dependencyNode:documentSection:PV-1.ess-location, state:dependencyNode:documentSection:PV-1.site-verification, state:dependencyNode:documentSection:PV-2.layout-context, state:dependencyNode:documentSection:PV-2.layout-verification, state:dependencyNode:documentSection:PV-3.structural-access, state:dependencyNode:documentSection:PV-3.structural-review, state:dependencyNode:documentSection:PV-5.labels, state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes, state:dependencyNode:documentSection:SLD.disconnect, state:dependencyNode:documentSection:SLD.rapid-shutdown, state:dependencyNode:documentSection:SLD.service-equipment, state:dependencyNode:documentSection:SLD.utility-meter, state:dependencyNode:documentSection:VAL-1.inactive-future, state:dependencyNode:documentSection:VAL-1.registry, state:dependencyNode:geometryInput:geometry:electrical-equipment-context, state:dependencyNode:renderContext:primary, state:dependencyNode:requirement:utility_meter, state:documentSection:E-1.disconnect, state:documentSection:E-1.interconnection, state:documentSection:E-1.optional-subpanel, state:documentSection:E-1.utility-meter, state:documentSection:ESS.location-context, state:documentSection:PV-1.ess-location, state:documentSection:PV-1.site-verification, state:documentSection:PV-2.layout-context, state:documentSection:PV-2.layout-verification, state:documentSection:PV-3.structural-access, state:documentSection:PV-3.structural-review, state:documentSection:PV-5.labels, state:documentSection:PV-5.rapid-shutdown-notes, state:documentSection:SLD.disconnect, state:documentSection:SLD.rapid-shutdown, state:documentSection:SLD.service-equipment, state:documentSection:SLD.utility-meter, state:documentSection:VAL-1.inactive-future, state:documentSection:VAL-1.registry, state:renderContext:renderContext:primary, state:sldSection:permit:project-recommendation-report-1:survey-recommendation-report-1.decision-provenance.sld
- CAD-readiness impact: none

Reduce stale outputs by reviewing metadata-only regeneration candidates. This does not imply automatic regeneration or output correctness.

#### Why it exists

Score is derived from regeneration planning metadata: candidate count, review-required ids, missing evidence, blocked dependencies, and path participation.

#### Uncertainty preserved

- Unresolved state preserved: missingEvidenceForRequirement:attic_access
- Unresolved state preserved: missingEvidenceForRequirement:main_disconnect
- Unresolved state preserved: missingEvidenceForRequirement:main_service_panel
- Unresolved state preserved: missingEvidenceForRequirement:placards
- Unresolved state preserved: missingEvidenceForRequirement:rapid_shutdown
- Unresolved state preserved: missingEvidenceForRequirement:service_equipment_label
- Unresolved state preserved: missingEvidenceForRequirement:structural_access
- Unresolved state preserved: missingEvidenceForRequirement:subpanel
- Unresolved state preserved: missingEvidenceForRequirement:utility_bill
- Unresolved state preserved: state:dependencyNode:documentSection:E-1.disconnect
- Unresolved state preserved: state:dependencyNode:documentSection:E-1.optional-subpanel
- Unresolved state preserved: state:dependencyNode:documentSection:PV-3.structural-access
- Unresolved state preserved: state:dependencyNode:documentSection:PV-3.structural-review
- Unresolved state preserved: state:dependencyNode:documentSection:PV-5.labels
- Unresolved state preserved: state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes
- Unresolved state preserved: state:dependencyNode:documentSection:SLD.disconnect
- Unresolved state preserved: state:dependencyNode:documentSection:VAL-1.inactive-future
- Unresolved state preserved: state:documentSection:E-1.disconnect
- Unresolved state preserved: state:documentSection:E-1.interconnection
- Unresolved state preserved: state:documentSection:E-1.optional-subpanel
- Unresolved state preserved: state:documentSection:PV-3.structural-access
- Unresolved state preserved: state:documentSection:PV-3.structural-review
- Unresolved state preserved: state:documentSection:PV-5.labels
- Unresolved state preserved: state:documentSection:PV-5.rapid-shutdown-notes
- Unresolved state preserved: state:documentSection:SLD.disconnect
- Unresolved state preserved: state:documentSection:SLD.rapid-shutdown
- Unresolved state preserved: state:documentSection:SLD.service-equipment
- Unresolved state preserved: state:documentSection:VAL-1.inactive-future
- Unresolved state preserved: state:documentSection:VAL-1.registry

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-028491b3`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 1047
- Deterministic hash: `recommendation-v1-028491b3`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:bom_derivation, decision:breaker_sizing, decision:conductor_sizing, decision:conduit_routing_assumption, decision:grounding_bonding_assumption, decision:inverter_selection, decision:layout_orientation_assumption, decision:mppt_assignment, decision:ocpd_selection, decision:placard_requirement, decision:rapid_shutdown_placement, decision:setback_assumption, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_7w4fiy
- Unresolved state preserved: canonicalEvidence:ev_efq7qz
- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: decision:bom_derivation
- Unresolved state preserved: decision:breaker_sizing
- Unresolved state preserved: decision:conductor_sizing
- Unresolved state preserved: decision:conduit_routing_assumption
- Unresolved state preserved: decision:grounding_bonding_assumption
- Unresolved state preserved: decision:inverter_selection
- Unresolved state preserved: decision:layout_orientation_assumption
- Unresolved state preserved: decision:mppt_assignment
- Unresolved state preserved: decision:ocpd_selection
- Unresolved state preserved: decision:placard_requirement
- Unresolved state preserved: decision:rapid_shutdown_placement
- Unresolved state preserved: decision:setback_assumption
- Unresolved state preserved: decision:sld_metadata
- Unresolved state preserved: decision:string_topology_selection
- Unresolved state preserved: decision:utility_interconnection_assumption
- Unresolved state preserved: documentSection:BOM.equipment-schedule
- Unresolved state preserved: documentSection:E-1.disconnect
- Unresolved state preserved: documentSection:E-1.interconnection
- Unresolved state preserved: documentSection:E-1.optional-subpanel
- Unresolved state preserved: documentSection:E-1.utility-meter
- Unresolved state preserved: documentSection:E-2.placards
- Unresolved state preserved: documentSection:ESS.location-context
- Unresolved state preserved: documentSection:PV-1.ess-location
- Unresolved state preserved: documentSection:PV-1.site-verification
- Unresolved state preserved: documentSection:PV-2.layout-context
- Unresolved state preserved: documentSection:PV-2.layout-verification
- Unresolved state preserved: documentSection:PV-3.structural-access
- Unresolved state preserved: documentSection:PV-3.structural-review
- Unresolved state preserved: documentSection:PV-5.labels
- Unresolved state preserved: documentSection:PV-5.rapid-shutdown-notes
- Unresolved state preserved: documentSection:SLD.disconnect
- Unresolved state preserved: documentSection:SLD.rapid-shutdown
- Unresolved state preserved: documentSection:SLD.service-equipment
- Unresolved state preserved: documentSection:SLD.utility-meter
- Unresolved state preserved: documentSection:VAL-1.inactive-future
- Unresolved state preserved: documentSection:VAL-1.registry
- Unresolved state preserved: geometry:roof-layout-context
- Unresolved state preserved: geometryInput:geometry:electrical-equipment-context
- Unresolved state preserved: geometryInput:geometry:roof-layout-context
- Unresolved state preserved: geometryInput:geometry:structural-access-context
- Unresolved state preserved: renderContext:primary
- Unresolved state preserved: requirement:attic_access
- Unresolved state preserved: requirement:battery_location
- Unresolved state preserved: requirement:main_disconnect
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:placards
- Unresolved state preserved: requirement:rapid_shutdown
- Unresolved state preserved: requirement:roof_overview
- Unresolved state preserved: requirement:service_equipment_label
- Unresolved state preserved: requirement:structural_access
- Unresolved state preserved: requirement:subpanel
- Unresolved state preserved: requirement:utility_bill
- Unresolved state preserved: requirement:utility_meter

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-ef3454e0`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 582
- Deterministic hash: `recommendation-v1-ef3454e0`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:breaker_sizing, decision:conductor_sizing, decision:inverter_selection, decision:mppt_assignment, decision:ocpd_selection, decision:rapid_shutdown_placement, decision:sld_metadata, decision:string_topology_selection, decision:utility_interconnection_assumption
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_7w4fiy
- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: decision:breaker_sizing
- Unresolved state preserved: decision:string_topology_selection
- Unresolved state preserved: decision:utility_interconnection_assumption
- Unresolved state preserved: documentSection:E-1.interconnection
- Unresolved state preserved: documentSection:E-1.utility-meter
- Unresolved state preserved: documentSection:E-2.placards
- Unresolved state preserved: documentSection:PV-2.layout-verification
- Unresolved state preserved: documentSection:SLD.rapid-shutdown
- Unresolved state preserved: documentSection:SLD.service-equipment
- Unresolved state preserved: documentSection:SLD.utility-meter
- Unresolved state preserved: documentSection:VAL-1.registry
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:rapid_shutdown
- Unresolved state preserved: requirement:roof_overview
- Unresolved state preserved: requirement:utility_meter

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-c6982486`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 489
- Deterministic hash: `recommendation-v1-c6982486`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:sld_metadata
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: decision:breaker_sizing
- Unresolved state preserved: decision:string_topology_selection
- Unresolved state preserved: decision:utility_interconnection_assumption
- Unresolved state preserved: documentSection:SLD.rapid-shutdown
- Unresolved state preserved: documentSection:SLD.service-equipment
- Unresolved state preserved: documentSection:SLD.utility-meter
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:rapid_shutdown
- Unresolved state preserved: requirement:utility_meter

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-9d9dc539`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 345
- Deterministic hash: `recommendation-v1-9d9dc539`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:utility_interconnection_assumption
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: documentSection:E-1.interconnection
- Unresolved state preserved: documentSection:E-1.utility-meter
- Unresolved state preserved: documentSection:SLD.utility-meter
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:utility_meter

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-55227f5d`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 341
- Deterministic hash: `recommendation-v1-55227f5d`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:breaker_sizing
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: documentSection:E-1.interconnection
- Unresolved state preserved: documentSection:SLD.service-equipment
- Unresolved state preserved: documentSection:VAL-1.registry
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:utility_meter

### reduce_stale_outputs

- Recommendation id: `reduce_stale_outputs:recommendation-v1-8347677a`
- Priority: critical
- Severity: stale_risk
- Confidence: medium
- Deterministic score: 318
- Deterministic hash: `recommendation-v1-8347677a`
- Expected confidence gain: 0
- Expected readiness gain: 0.1
- Affected evidence: none
- Affected signals: none
- Affected contexts: none
- Affected requirements: none
- Affected decisions: decision:conduit_routing_assumption
- Affected outputs: renderContext:primary
- CAD-readiness impact: none

Output renderContext:primary participates in deterministic invalidation propagation; review stale dependencies and missing evidence before any regeneration is considered.

#### Why it exists

Score is derived from affected output renderContext:primary, stale class STALE, missing evidence, decisions, and propagation paths.

#### Uncertainty preserved

- Unresolved state preserved: canonicalEvidence:ev_uv641c
- Unresolved state preserved: documentSection:E-1.interconnection
- Unresolved state preserved: documentSection:PV-2.layout-context
- Unresolved state preserved: requirement:main_service_panel
- Unresolved state preserved: requirement:utility_meter


## Unresolved States Preserved

- Blocked or missing signal support remains visible: signal:conduit_route_candidate_present, signal:inverter_to_msp_route_candidate, signal:utility_to_inverter_route_candidate.
- Blocked or missing signal support remains visible: signal:conduit_route_candidate_present.
- Blocked or missing signal support remains visible: signal:electrical_equipment_cluster_present, signal:main_service_panel_present.
- Blocked or missing signal support remains visible: signal:electrical_equipment_cluster_present.
- Blocked or missing signal support remains visible: signal:inverter_location_candidate_present, signal:inverter_to_msp_route_candidate, signal:main_service_panel_present.
- Blocked or missing signal support remains visible: signal:main_service_panel_present.
- Blocked or missing signal support remains visible: signal:ridge_context_present, signal:roof_edge_context_present.
- Blocked or missing signal support remains visible: signal:structural_access_context_present.
- Blocked or missing signal support remains visible: signal:survey_sequence_continuity_good.
- Blocked or missing signal support remains visible: signal:utility_to_inverter_route_candidate.
- blocked resolved context:context:preferred_detached_structure_context
- blocked structured signal:signal:conduit_route_candidate_present
- blocked structured signal:signal:electrical_equipment_cluster_present
- blocked structured signal:signal:inverter_location_candidate_present
- blocked structured signal:signal:inverter_to_msp_route_candidate
- blocked structured signal:signal:main_service_panel_present
- blocked structured signal:signal:ridge_context_present
- blocked structured signal:signal:roof_edge_context_present
- blocked structured signal:signal:structural_access_context_present
- blocked structured signal:signal:survey_sequence_continuity_good
- blocked structured signal:signal:utility_to_inverter_route_candidate
- cad_readiness:ESS-location-ready:blocked
- canonicalEvidence:ev_7w4fiy
- canonicalEvidence:ev_efq7qz
- canonicalEvidence:ev_uv641c
- conflicting resolved context:context:preferred_trench_context
- context:context:preferred_attic_route_context:conflicting
- context:context:preferred_battery_location_context:conflicting
- context:context:preferred_conduit_context:conflicting
- context:context:preferred_detached_structure_context:conflicting
- context:context:preferred_disconnect_context:conflicting
- context:context:preferred_equipment_cluster_context:conflicting
- context:context:preferred_ess_context:conflicting
- context:context:preferred_exterior_route_context:conflicting
- context:context:preferred_grouping_context:conflicting
- context:context:preferred_interconnection_context:conflicting
- context:context:preferred_inverter_to_msp_context:conflicting
- context:context:preferred_layout_context:conflicting
- context:context:preferred_metadata_context:conflicting
- context:context:preferred_msp_context:conflicting
- context:context:preferred_obstruction_context:conflicting
- context:context:preferred_roof_context:conflicting
- context:context:preferred_roof_plane_context:conflicting
- context:context:preferred_routing_context:conflicting
- context:context:preferred_setback_context:conflicting
- context:context:preferred_traversal_context:conflicting
- context:context:preferred_trench_context:conflicting
- context:context:preferred_utility_access_context:conflicting
- context:context:preferred_utility_meter_context:conflicting
- context:context:preferred_utility_to_inverter_context:conflicting
- decision:bom_derivation
- decision:breaker_sizing
- decision:conductor_sizing
- decision:conduit_routing_assumption
- decision:grounding_bonding_assumption
- decision:inverter_selection
- decision:layout_orientation_assumption
- decision:mppt_assignment
- decision:ocpd_selection
- decision:placard_requirement
- decision:rapid_shutdown_placement
- decision:setback_assumption
- decision:sld_metadata
- decision:string_topology_selection
- decision:utility_interconnection_assumption
- detached-structure-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied
- detached-structure-ready:resolved_context_fallback_dependency:context:preferred_detached_structure_context
- documentSection:BOM.equipment-schedule
- documentSection:E-1.disconnect
- documentSection:E-1.interconnection
- documentSection:E-1.optional-subpanel
- documentSection:E-1.utility-meter
- documentSection:E-2.placards
- documentSection:ESS.location-context
- documentSection:PV-1.ess-location
- documentSection:PV-1.site-verification
- documentSection:PV-2.layout-context
- documentSection:PV-2.layout-verification
- documentSection:PV-3.structural-access
- documentSection:PV-3.structural-review
- documentSection:PV-5.labels
- documentSection:PV-5.rapid-shutdown-notes
- documentSection:SLD.disconnect
- documentSection:SLD.rapid-shutdown
- documentSection:SLD.service-equipment
- documentSection:SLD.utility-meter
- documentSection:VAL-1.inactive-future
- documentSection:VAL-1.registry
- Electrical equipment cluster is blocked without MSP/meter evidence.
- Explicit evidence rows: ev_uv641c.
- Explicit field signals: fieldEvidence.rafterSize, fieldEvidence.rafterSpacingInches.
- Explicit field signals: fieldEvidence.roofMaterial.
- explicit primary context required
- fallback penalty applied:cad-readiness:detached-structure-ready:detached-structure-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied
- fallback penalty applied:cad-readiness:ESS-location-ready:ESS-location-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied
- fallback penalty applied:cad-readiness:trench-route-ready:trench-route-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied
- fallback penalty applied:context-definition:preferred_attic_route_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_battery_location_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_conduit_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_detached_structure_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_disconnect_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_equipment_cluster_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_ess_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_interconnection_context:fallback_allowed
- fallback penalty applied:context-definition:preferred_inverter_to_msp_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_layout_context:fallback_allowed
- fallback penalty applied:context-definition:preferred_msp_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_routing_context:fallback_allowed
- fallback penalty applied:context-definition:preferred_trench_context:explicit_primary_absent
- fallback penalty applied:context-definition:preferred_utility_to_inverter_context:explicit_primary_absent
- fallback penalty applied:signal:signal:conduit_route_candidate_present:Missing 1 required explicit evidence row(s) from categories: inverter_location, gateway_location, utility_connection, garage_interior_wall.
- fallback penalty applied:signal:signal:conduit_route_candidate_present:No explicit route candidate evidence row is present.
- fallback penalty applied:signal:signal:electrical_equipment_cluster_present:Electrical equipment cluster is blocked without MSP/meter evidence.
- fallback penalty applied:signal:signal:electrical_equipment_cluster_present:Missing 1 required explicit evidence row(s) from categories: main_service_panel, meter.
- fallback penalty applied:signal:signal:inverter_location_candidate_present:Missing 1 required explicit evidence row(s) from categories: inverter_location, gateway_location.
- fallback penalty applied:signal:signal:inverter_location_candidate_present:No inverter or gateway location evidence row is present.
- fallback penalty applied:signal:signal:inverter_to_msp_route_candidate:Inverter-to-MSP route candidate is blocked without inverter/gateway and MSP/wall evidence.
- fallback penalty applied:signal:signal:inverter_to_msp_route_candidate:Missing 2 required explicit evidence row(s) from categories: inverter_location, gateway_location, main_service_panel, garage_interior_wall.
- fallback penalty applied:signal:signal:main_service_panel_present:Missing 1 required explicit evidence row(s) from categories: main_service_panel.
- fallback penalty applied:signal:signal:main_service_panel_present:No canonical main_service_panel evidence row is present.
- fallback penalty applied:signal:signal:ridge_context_present:Missing 1 required explicit evidence row(s) from categories: ridge.
- fallback penalty applied:signal:signal:ridge_context_present:No ridge evidence row is present.
- fallback penalty applied:signal:signal:roof_edge_context_present:Missing 1 required explicit evidence row(s) from categories: roof_edge.
- fallback penalty applied:signal:signal:roof_edge_context_present:No roof_edge evidence row is present.
- fallback penalty applied:signal:signal:structural_access_context_present:Missing 1 required explicit evidence row(s) from categories: attic_access, attic, rafters, roof_surface.
- fallback penalty applied:signal:signal:structural_access_context_present:No structural access evidence row is present.
- fallback penalty applied:signal:signal:survey_sequence_continuity_good:Survey sequence continuity is blocked by missing traversal rows or excessive deterministic breakpoints.
- fallback penalty applied:signal:signal:utility_to_inverter_route_candidate:Missing 1 required explicit evidence row(s) from categories: meter, utility_access, utility_connection, inverter_location, gateway_location.
- fallback penalty applied:signal:signal:utility_to_inverter_route_candidate:Utility-to-inverter route candidate is blocked without utility and inverter/gateway evidence.
- fallback penalty applied:structured-signal-fallback:signal:conduit_route_candidate_present:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:electrical_equipment_cluster_present:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:inverter_location_candidate_present:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:inverter_to_msp_route_candidate:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:main_service_panel_present:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:ridge_context_present:cad_readiness:setback-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:roof_edge_context_present:cad_readiness:setback-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:structural_access_context_present:cad_readiness:roof-plane-ready:unresolved_assumption_or_default_policy
- fallback penalty applied:structured-signal-fallback:signal:utility_to_inverter_route_candidate:cad_readiness:routing-ready:unresolved_assumption_or_default_policy
- geometry:roof-layout-context
- geometryInput:geometry:electrical-equipment-context
- geometryInput:geometry:roof-layout-context
- geometryInput:geometry:structural-access-context
- Grouping clusters: cluster:utility_evidence:4-4.
- Invalidated signal lineage remains visible: signal:electrical_equipment_cluster_present, signal:interconnection_zone_known.
- Invalidated signal lineage remains visible: signal:electrical_equipment_cluster_present, signal:utility_meter_present.
- Invalidated signal lineage remains visible: signal:interconnection_zone_known, signal:utility_meter_present.
- Invalidated signal lineage remains visible: signal:routing_continuity_present, signal:utility_access_context_present, signal:utility_meter_present, signal:utility_to_inverter_route_candidate.
- Invalidated signal lineage remains visible: signal:routing_continuity_present, signal:utility_to_inverter_route_candidate.
- Invalidated signal lineage remains visible: signal:routing_continuity_present.
- Invalidated signal lineage remains visible: signal:utility_access_context_present, signal:utility_meter_present, signal:utility_meter_side_known.
- Inverter-to-MSP route candidate is blocked without inverter/gateway and MSP/wall evidence.
- Missing 1 required explicit evidence row(s) from categories: attic_access, attic, rafters, roof_surface.
- Missing 1 required explicit evidence row(s) from categories: inverter_location, gateway_location, utility_connection, garage_interior_wall.
- Missing 1 required explicit evidence row(s) from categories: inverter_location, gateway_location.
- Missing 1 required explicit evidence row(s) from categories: main_service_panel, meter.
- Missing 1 required explicit evidence row(s) from categories: main_service_panel.
- Missing 1 required explicit evidence row(s) from categories: meter, utility_access, utility_connection, inverter_location, gateway_location.
- Missing 1 required explicit evidence row(s) from categories: ridge.
- Missing 1 required explicit evidence row(s) from categories: roof_edge.
- Missing 2 required explicit evidence row(s) from categories: inverter_location, gateway_location, main_service_panel, garage_interior_wall.
- missing explicit category:detached_structures
- missing explicit category:trench_path
- missingEvidenceForRequirement:attic_access
- missingEvidenceForRequirement:main_disconnect
- missingEvidenceForRequirement:main_service_panel
- missingEvidenceForRequirement:placards
- missingEvidenceForRequirement:rapid_shutdown
- missingEvidenceForRequirement:service_equipment_label
- missingEvidenceForRequirement:structural_access
- missingEvidenceForRequirement:subpanel
- missingEvidenceForRequirement:utility_bill
- Multiple active primary signal candidates remain visible: signal:roof_plane_context_present, signal:roof_surface_context_present.
- No canonical main_service_panel evidence row is present.
- No explicit route candidate evidence row is present.
- No inverter or gateway location evidence row is present.
- No ridge evidence row is present.
- No roof_edge evidence row is present.
- No structural access evidence row is present.
- One or more grouped readiness contexts remains partial/blocked.
- Partial competing signal support remains visible: signal:evidence_grouping_stable, signal:photo_cluster_confidence_high.
- Partial competing signal support remains visible: signal:framing_context_present, signal:roof_surface_context_present.
- Partial competing signal support remains visible: signal:framing_context_present, signal:routing_continuity_present.
- Partial competing signal support remains visible: signal:roof_surface_context_present.
- Partial competing signal support remains visible: signal:routing_continuity_present.
- renderContext:primary
- requirement:attic_access
- requirement:battery_location
- requirement:main_disconnect
- requirement:main_service_panel
- requirement:placards
- requirement:rapid_shutdown
- requirement:roof_overview
- requirement:service_equipment_label
- requirement:structural_access
- requirement:subpanel
- requirement:utility_bill
- requirement:utility_meter
- Signal has some explicit support but does not meet all deterministic confirmation criteria.
- signal:signal:attic_access_confirmed:missing
- signal:signal:attic_route_candidate:missing
- signal:signal:battery_wall_candidate_present:missing
- signal:signal:conduit_route_candidate_present:missing
- signal:signal:detached_structure_present:missing
- signal:signal:detached_structure_route_candidate:missing
- signal:signal:electrical_equipment_cluster_present:missing
- signal:signal:energy_storage_context_present:missing
- signal:signal:ess_location_candidate_present:missing
- signal:signal:evidence_grouping_stable:missing
- signal:signal:exterior_wall_route_candidate:missing
- signal:signal:framing_context_present:missing
- signal:signal:garage_interior_wall_present:missing
- signal:signal:interconnection_zone_known:missing
- signal:signal:inverter_location_candidate_present:missing
- signal:signal:inverter_to_msp_route_candidate:missing
- signal:signal:main_disconnect_present:missing
- signal:signal:main_service_panel_present:confirmed
- signal:signal:main_service_panel_present:missing
- signal:signal:metadata_completeness_sufficient:missing
- signal:signal:obstruction_context_present:missing
- signal:signal:photo_cluster_confidence_high:missing
- signal:signal:ridge_context_present:missing
- signal:signal:roof_edge_context_present:missing
- signal:signal:roof_layout_candidate_present:missing
- signal:signal:roof_plane_context_present:missing
- signal:signal:roof_surface_context_present:missing
- signal:signal:routing_continuity_present:missing
- signal:signal:structural_access_context_present:missing
- signal:signal:subpanel_present:missing
- signal:signal:survey_sequence_continuity_good:missing
- signal:signal:survey_traversal_complete:missing
- signal:signal:trench_context_present:missing
- signal:signal:trench_path_explicit:missing
- signal:signal:utility_access_context_present:missing
- signal:signal:utility_meter_present:missing
- signal:signal:utility_meter_side_known:missing
- signal:signal:utility_to_inverter_route_candidate:missing
- state:dependencyNode:documentSection:E-1.disconnect
- state:dependencyNode:documentSection:E-1.optional-subpanel
- state:dependencyNode:documentSection:PV-3.structural-access
- state:dependencyNode:documentSection:PV-3.structural-review
- state:dependencyNode:documentSection:PV-5.labels
- state:dependencyNode:documentSection:PV-5.rapid-shutdown-notes
- state:dependencyNode:documentSection:SLD.disconnect
- state:dependencyNode:documentSection:VAL-1.inactive-future
- state:documentSection:E-1.disconnect
- state:documentSection:E-1.interconnection
- state:documentSection:E-1.optional-subpanel
- state:documentSection:PV-3.structural-access
- state:documentSection:PV-3.structural-review
- state:documentSection:PV-5.labels
- state:documentSection:PV-5.rapid-shutdown-notes
- state:documentSection:SLD.disconnect
- state:documentSection:SLD.rapid-shutdown
- state:documentSection:SLD.service-equipment
- state:documentSection:VAL-1.inactive-future
- state:documentSection:VAL-1.registry
- Survey sequence continuity is blocked by missing traversal rows or excessive deterministic breakpoints.
- trench-route-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied
- trench-route-ready:resolved_context_fallback_dependency:context:preferred_trench_context
- Utility-to-inverter route candidate is blocked without utility and inverter/gateway evidence.
