# Signal Readiness V1 Report

Signal Readiness V1 connects structured engineering signals to CAD-readiness metadata while preserving explicit truth boundaries. CAD readiness remains metadata only and never generates CAD. A readiness flag can be supported by explicit canonical categories, explicit survey fields, or confirmed/partial structured signals, and it records unresolved assumptions and default policy fallbacks whenever explicit truth remains incomplete.

## Readiness flags

The readiness model evaluates `roof-plane-ready`, `routing-ready`, `setback-ready`, `trench-route-ready`, `detached-structure-ready`, and `ESS-location-ready`. Each flag exposes satisfied categories, missing categories, explicit survey signals, structured signal ids, unresolved assumptions, default policy fallbacks, status, and deterministic reason.

## Structured signal participation

Roof readiness can be supported by `roof_plane_context_present`, `roof_surface_context_present`, `roof_layout_candidate_present`, and related structural signals. Routing readiness can be supported by `routing_continuity_present`, `utility_to_inverter_route_candidate`, `inverter_to_msp_route_candidate`, `electrical_equipment_cluster_present`, `main_service_panel_present`, and utility/electrical signals. ESS readiness can be supported only by explicit ESS, garage wall, battery, or gateway evidence signals and remains `not_applicable` when those optional contexts are absent.

## Default policy and unresolved assumptions

Blocked or incomplete flags record unresolved assumptions such as missing explicit categories or blocked structured signals. They also emit default policy fallback rows requiring manual review until explicit truth is supplied. This prevents the system from implying CAD certainty, roof geometry, route geometry, trench path certainty, detached-structure certainty, or ESS location certainty.

## Validation status

Focused signal regression tests pass. Engineering boundary and dependency topology guards pass. Full project validation results are recorded in the final delivery recap after the complete validation sequence.
