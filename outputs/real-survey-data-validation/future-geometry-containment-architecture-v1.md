# Future Geometry Containment Architecture V1

## Purpose

This document defines a future-safe governance architecture for geometry-adjacent assistance. It does not implement geometry intelligence. It does not authorize object detection, segmentation, roof extraction, plane generation, setback generation, obstruction mapping, routing inference, CAD mutation, topology mutation, NEC mutation, or engineering mutation. Its purpose is to define containment rules before any future geometry runtime is allowed to exist.

The governing principle is that geometry-adjacent assistance may only produce review-required candidates. Candidates may help a reviewer notice possible geometric features, but they must not create canonical geometry, mutate CAD, satisfy engineering requirements, determine setbacks, infer routing, alter production estimates, alter structural assumptions, or generate plan-set outputs.

## Future Candidate Categories

Future geometry-adjacent assistance should use narrowly scoped candidate labels that describe possible review targets rather than facts. Candidate labels should be non-authoritative and prefixed with `possible_`. The recommended future candidate families are `possible_roof_edge_candidate`, `possible_ridge_candidate`, `possible_valley_candidate`, `possible_obstruction_candidate`, `possible_conduit_route_candidate`, and `possible_attachment_region_candidate`.

`possible_roof_edge_candidate` should indicate only that a future runtime observed a possible roof-edge feature for reviewer attention. It must not define a roof polygon, eave, rake, fire setback boundary, or CAD roof plane. It must not be used to compute usable roof area, panel placement, or code compliance.

`possible_ridge_candidate` should indicate only a possible ridge-like feature for reviewer attention. It must not define ridge geometry, ridge orientation, ridge setback, roof pitch, roof plane adjacency, or code-compliant access path geometry.

`possible_valley_candidate` should indicate only a possible valley-like feature for reviewer attention. It must not define valley geometry, valley setbacks, drainage assumptions, obstruction exclusions, or roof plane segmentation.

`possible_obstruction_candidate` should indicate only a possible obstruction-like feature for reviewer attention. It must not create CAD obstructions, radius values, exclusion zones, setback requirements, panel filtering, production losses, shade losses, or structural constraints.

`possible_conduit_route_candidate` should indicate only a possible route context for reviewer attention. It must not create `CADConduitRoute`, conductor lengths, bend counts, voltage-drop assumptions, trench routes, roof conduit paths, routing authority, BOM quantities, or plan-set route drawings.

`possible_attachment_region_candidate` should indicate only a possible region requiring reviewer attention around attachment feasibility. It must not infer rafters, trusses, attachment spacing, span tables, structural adequacy, load combinations, or mounting hardware decisions.

## Runtime Isolation Model

Future geometry-adjacent runtimes must be isolated under a dedicated registry-governed runtime category such as `geometry_adjacency_candidate`, not under CAD, layout, engineering, or topology modules. The runtime must be server-only unless explicitly approved otherwise, must have deterministic replay support, must produce stable hashes of inputs and outputs, and must declare all dependencies, model weights, native binaries, and external services. If a runtime uses image analysis, it must declare whether it uses object detection, segmentation, feature extraction, or geometric inference. The initial governance posture should prohibit those capabilities until separately audited.

A future runtime must not import from `lib/cad`, `lib/drafting`, `lib/plan-set`, `lib/engineering`, `lib/engineeringIntelligence`, `lib/system/conduitRouting`, `lib/bom`, `lib/topology-engine`, `lib/roofGeometry`, `lib/planeEngine`, `lib/panelLayout`, `lib/panelLayoutOptimized`, `lib/placementEngine`, or rendering components. Candidate normalization may import assisted-evidence lifecycle types and registry definitions only. Any bridge must resolve the registered runtime, assert allowed candidate types, and force creation through the review-required candidate lifecycle.

Future geometry-adjacent candidates must be created with `nonAuthoritative: true`, `reviewRequired: true`, `candidateStatus: 'review_required'`, and explicit forbidden uses. Forbidden uses must include `canonical_roof_plane`, `canonical_geometry`, `cad_input`, `drafting_input`, `engineering_fact`, `nec_authority`, `routing_authority`, `structural_authority`, `production_estimate`, `bom_input`, `workflow_trigger`, and `canonical_mutation`.

## Boundary Between Candidate and Authority

The future containment boundary must be a one-way boundary from runtime payload to review-required candidate. A geometry candidate may be displayed, filtered, grouped, reviewed, and projected as non-authoritative review metadata. It may not be read by deterministic CAD or engineering code. It may not be used as an input to `generateCADLayout`, `roofCAD`, `buildCADFromSurvey`, `mergeCADModels`, `adaptCADToDrafting`, `renderPlanSet`, `calcFireSetbacks`, `routeConduit`, structural calculations, BOM derivation, topology checks, production estimation, or CAD readiness gates.

Acceptance by a reviewer should not automatically convert a candidate into canonical geometry. Acceptance should produce a reviewed projection only. A separate future canonicalization workflow, if ever designed, must be deterministic, auditable, permissioned, reversible, and invalidation-aware. It must also require explicit reviewer intent and must record exactly which canonical field is being changed, the before/after values, source candidates, reviewer identity, and downstream stale impacts.

## Forbidden Future Behavior

The following future paths must be forbidden: geometry candidate to canonical roof plane, geometry candidate to CAD mutation, geometry candidate to NEC authority, geometry candidate to routing authority, geometry candidate to structural authority, geometry candidate to production estimate mutation, geometry candidate to BOM mutation, geometry candidate to plan-set mutation, geometry candidate to topology mutation, geometry candidate to workflow creation, geometry candidate to recommendation generation, and geometry candidate to automatic requirement satisfaction.

Autonomous roof plane creation must remain forbidden. Autonomous CAD mutation must remain forbidden. Autonomous setback compliance must remain forbidden. Autonomous conduit routing authority must remain forbidden. Autonomous NEC geometry interpretation must remain forbidden. Geometry-driven engineering mutation must remain forbidden.

## Candidate Payload Shape

Future payloads should be narrow, descriptive, and provenance-heavy. A candidate payload may include a candidate label, source image/evidence reference, runtime payload hash, replay bundle hash, confidence, limitations, candidate coordinate frame metadata if applicable, and review instructions. If any coordinate-like data is ever permitted in a future phase, it must be explicitly labeled candidate-only, non-canonical, non-CAD, non-engineering, and not usable for measurement. However, the safest initial phase should avoid coordinates entirely or include only coarse, non-measurable visual context regions. Any point, polygon, bounding box, roof edge, route polyline, or obstruction footprint must remain forbidden until a separate geometry-specific audit approves a schema and boundary guard.

Future payloads must include limitation references such as `candidate_only`, `review_required`, `not_canonical_geometry`, `not_cad_input`, `not_engineering_authority`, `not_nec_authority`, `not_routing_authority`, `not_structural_authority`, `not_bom_input`, `not_plan_set_input`, and `no_automatic_mutation`.

## Confidence Governance Strategy

Confidence must be used only for reviewer triage. It must not satisfy requirements, change CAD readiness, sort engineering priority in a way that creates workflow obligations, or suppress required evidence. Confidence should be bounded, normalized, and accompanied by method limitations. High confidence must not imply geometry truth. Low confidence must not remove a candidate from audit logs if generated. Any thresholding must be deterministic and replayable. Candidate grouping can use confidence for display order, but not for authority.

A future confidence model should separate runtime confidence, evidence quality confidence, reviewer confidence, and canonical confidence. Runtime confidence is a candidate property only. Reviewer confidence is a review annotation. Canonical confidence, if such a concept is ever introduced, must be produced only by deterministic reviewed workflows and must not be inherited from a runtime.

## Replayability Requirements

Every future runtime invocation must produce a replay bundle including runtime name, version, dependency manifest, model identifier if applicable, model hash if applicable, source evidence IDs, input file hashes, normalized input metadata hash, runtime parameters, output payload hash, candidate normalization hash, and boundary-policy version. If external services are used, the request and response contract must be versioned and replay limitations must be declared. If nondeterministic model inference is used in a future phase, governance must require deterministic seed capture where possible and explicit nondeterminism flags where not possible.

Replay must demonstrate that the same source inputs and runtime version produce the same candidate payload or that any nondeterministic variation is bounded, recorded, and never authority-bearing. Replay results must not regenerate CAD or engineering outputs; they may only regenerate candidate payloads for audit comparison.

## Invalidation Propagation Model

Future geometry candidates need invalidation rules before they are used. Source evidence changes must invalidate candidates generated from that source. Runtime version changes must invalidate candidates generated by the older runtime. Boundary-policy changes must mark candidates for review. Reviewer rejection must block candidate propagation. Reviewer acceptance must produce projection-only lineage, not canonical mutation. If a separate canonicalization workflow ever maps reviewed geometry into canonical fields, it must invalidate dependent CAD readiness metadata, plan-set outputs, production estimates, BOM outputs, structural assumptions, routing assumptions, and any affected engineering decisions.

Candidate invalidation must not trigger regeneration automatically. It may create planned regeneration metadata only. Regeneration planning must remain read-only until a future governed workflow is approved.

## Boundary Guard Expansion Plan

Future boundary guards should block geometry-adjacent runtime files from importing or calling CAD, engineering, topology, routing, BOM, plan-set, or layout modules. Guards should scan for forbidden symbols including `generateCADLayout`, `roofCAD`, `groundCAD`, `fenceCAD`, `buildCADFromSurvey`, `mergeCADModels`, `adaptCADToDrafting`, `renderPlanSet`, `calcFireSetbacks`, `routeConduit`, `deriveRunLengths`, `buildCADReadinessMetadata`, `evaluateEngineeringRequirements`, `buildEngineeringRecommendations`, `buildEngineeringWorkflowOrchestration`, `topology`, `NEC`, `conductorSizing`, `structural`, `productionEstimate`, and database mutation calls.

Future guards should also block geometry output fields in candidate payloads until approved. Initially forbidden fields should include `boundingBox`, `bbox`, `polygon`, `coordinates`, `polyline`, `roofEdge`, `ridgeLine`, `valleyLine`, `plane`, `azimuth`, `tilt`, `pitch`, `setback`, `obstructionMap`, `conduitPath`, `routeLength`, `attachmentSpacing`, `rafter`, `truss`, and `cadModel`.

## Implementation Readiness Gate

No future geometry runtime should be implemented until the following are designed and tested: candidate type definitions, registry validation rules, bridge lifecycle rules, payload schema, replay schema, provenance schema, UI display semantics, invalidation propagation semantics, boundary guards, targeted tests proving no CAD/engineering/topology mutation, and full validation logs. This document intentionally stops at governance design and does not implement these controls.
