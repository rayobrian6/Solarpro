# Geometry UI and Lineage Planning V1

## Purpose

This document plans how future geometry-adjacent candidates should appear in the Engineering Intelligence UI and lineage surfaces. It is planning only. It does not implement UI changes, geometry runtime behavior, object detection, segmentation, roof extraction, CAD mutation, route inference, topology mutation, NEC mutation, or engineering mutation.

The UI must preserve separation between canonical geometry, assisted geometry candidates, CAD authority, and engineering authority. Future geometry candidates may be visible for reviewer awareness, but the interface must never imply that they are canonical, CAD-ready, NEC-compliant, routing-approved, structurally valid, or plan-set authoritative.

## Existing UI Surfaces Audited

The audit found that `app/admin/engineering-intelligence/components.tsx` already contains major workspaces relevant to future geometry lineage. Existing surfaces include `WorkspaceShell`, `ProjectIntelligencePicker`, `CADReadinessWorkspace`, `PhotoGroupingWorkspace`, `FieldEvidenceOrchestrationWorkspace`, `CanonicalEvidenceWorkspace`, `RequirementWorkspace`, `DecisionWorkspace`, `StaleInvalidationWorkspace`, `SnapshotTimelineWorkspace`, `DependencyGraphViewer`, `RegenerationPlanningWorkspace`, `InvalidationPropagationWorkspace`, `DependencyTraversalWorkspace`, `RegenerationPlanningV1Workspace`, `SnapshotDeltaWorkspace`, `AffectedOutputsWorkspace`, `StaleStateTimelineWorkspace`, `StructuredEngineeringSignalsWorkspace`, `SignalProvenanceWorkspace`, `SignalDependencyGraphWorkspace`, `SignalRequirementMappingWorkspace`, `SignalConfidenceWorkspace`, `SignalBlockingWorkspace`, `SignalInvalidationWorkspace`, `SignalStaleImpactsWorkspace`, context provenance and dependency workspaces, and simulation workspaces.

The UI already contains safety language. `WorkspaceShell` states that no OCR, CV, CAD, or autonomous-regeneration runtime path is exposed. `ProjectIntelligencePicker` says selecting a project loads deterministic evidence, graph, snapshot, invalidation, regeneration-plan metadata, and CAD-readiness metadata and does not run OCR, CV, CAD generation, or autonomous regeneration. These statements are aligned with future containment and should be preserved or extended if future geometry candidates are displayed.

## Where Future Geometry Candidates Should Surface

Future geometry-adjacent candidates should first surface in a dedicated assisted-evidence section, not directly inside canonical geometry, CAD readiness, requirements, or decisions. The recommended UI location is a future `Geometry Candidate Review Workspace` placed adjacent to, but visually separate from, `Canonical Evidence Workspace`. This workspace should list candidates by source evidence, candidate label, runtime version, confidence, review status, limitation references, and replay hash. It should make clear that candidates are review-required and non-authoritative.

The `CanonicalEvidenceWorkspace` may display links to reviewed projections only as lineage context. It should not mix candidate rows into canonical evidence rows. If a canonical evidence item has related geometry candidates, they should appear under a label such as `Assisted geometry candidates linked for review only`. They must not be counted as canonical evidence completeness or requirement satisfaction.

The `RequirementWorkspace` should not treat candidates as satisfying requirements. It may show a warning or context indicator that review-required geometry candidates exist near a requirement, but the requirement status must remain driven by canonical evidence and deterministic rules only. Candidate labels should not appear in the evidence satisfaction column unless a separate reviewed canonical evidence item exists.

The `Engineering Decision Workspace` may display candidate lineage as excluded or contextual evidence. If a decision is affected by canonical geometry, the UI should show the canonical source and deterministic dependency path. If future candidates exist, they should be marked `not used for decision`. This prevents reviewers from confusing a possible roof edge, obstruction, ridge, route, or attachment region with engineering authority.

The `Dependency Graph Viewer` should render future geometry candidates in a separate node type, such as `assisted_geometry_candidate`, with a dashed or low-authority visual style. Edges from source evidence to candidate nodes are allowed. Edges from candidate nodes to review projection nodes are allowed. Direct edges from candidate nodes to CAD, NEC, structural, routing, BOM, production, plan-set, workflow, or recommendation nodes should be forbidden. If a future canonicalization workflow is approved, the graph should show an explicit reviewed canonicalization event between projection and canonical geometry.

The `Snapshot Timeline Workspace` should show candidate creation, candidate review, and candidate invalidation as candidate-lane events only. These events should not create engineering snapshot changes unless canonical evidence changes separately. Runtime replay mismatch should produce candidate stale state, not CAD or engineering stale state.

The `Regeneration Planning Workspace` and `Regeneration Planning V1 Workspace` should treat candidate invalidation as review planning only. Candidate invalidation may produce planned review tasks or metadata, but must not automatically plan CAD regeneration, engineering recalculation, plan-set regeneration, or route recalculation. If a future canonical geometry mutation is explicitly approved, regeneration planning may then show downstream impacted outputs, but only after canonical mutation.

## How Review-Required Geometry Candidates Should Appear

Future candidates should appear with a persistent banner: `Review-required assisted geometry candidate. Not canonical geometry. Not CAD input. Not engineering authority.` Candidate cards should display label, source evidence ID, source file hash, runtime name and version, boundary policy version, confidence, limitations, replay status, review status, and reviewer notes. If coordinates are ever approved in a future phase, the UI must label them as candidate-only and non-measurement data unless a separate schema grants review display capability.

Candidate labels should be human-readable. For example, `possible_roof_edge_candidate` should display as `Possible roof edge candidate`, with explanatory text saying it cannot define a roof plane or setback. `possible_ridge_candidate` should explain it cannot define ridge geometry or fire access compliance. `possible_obstruction_candidate` should explain it cannot create exclusion zones or remove panels. `possible_conduit_route_candidate` should explain it cannot define conductor routes, lengths, bend counts, voltage drop, or BOM quantities. `possible_attachment_region_candidate` should explain it cannot define rafters, attachment spacing, or structural adequacy.

The UI should prevent bulk acceptance from implying canonicalization. Candidate acceptance should be phrased as `Accept reviewed projection`, not `Apply geometry`. Rejection should be phrased as `Reject candidate`. Any future canonicalization action must be a separate workflow with clear before/after canonical fields and stale-impact preview.

## Provenance Visualization

Provenance should be displayed in a layered form. The source layer should show canonical survey evidence IDs, file names, hashes, and upload/source context. The runtime layer should show runtime identity, version, dependency/model hashes, parameter hash, replay bundle hash, and boundary policy. The candidate layer should show candidate ID, label, payload hash, confidence, limitations, and lifecycle status. The review layer should show reviewer, timestamp, disposition, notes, and reviewed projection ID. If a future canonicalization workflow exists, the canonicalization layer must show changed canonical fields and downstream invalidation.

The UI should use lineage boxes similar to existing `LineageBox` components but with authority labels. Candidate lineage should be visually distinct from canonical evidence lineage. Hashes should be visible but collapsible. Replay status should be visible as `not_run`, `match`, `mismatch`, `runtime_unavailable`, or `policy_changed`.

## Dependency Lineage Display

Future geometry candidate lineage should use a separate graph lane. Allowed edges are source evidence to candidate, candidate to review, review to projection, projection to human context, and candidate/projection to candidate stale state. Forbidden direct edges are candidate to canonical geometry, candidate to CAD readiness, candidate to CAD model, candidate to plan set, candidate to NEC requirement, candidate to routing decision, candidate to structural decision, candidate to production estimate, candidate to BOM, candidate to workflow, and candidate to recommendation.

If a future canonicalization workflow is later approved, it should add a distinct `reviewed_canonicalization_event` node. Downstream graph edges should originate from canonical evidence after the canonicalization event, not from the candidate. This preserves the separation between assisted candidate lineage and deterministic authority lineage.

## Stale Impact Propagation UI

Candidate staleness should be shown in candidate workspaces, snapshot timeline candidate lanes, and invalidation workspaces as candidate-only stale impact. Source evidence changes, runtime changes, replay mismatches, and boundary policy changes can make candidates stale. Candidate stale states should not mark CAD, engineering, plan-set, route, structural, BOM, or production outputs stale.

If future reviewed canonicalization is approved and canonical geometry changes, the UI should show a downstream stale-impact preview before the change is confirmed. The preview should list CAD readiness metadata, CAD models, plan-set outputs, production estimates, BOM outputs, structural assumptions, routing assumptions, topology snapshots, engineering decisions, recommendation artifacts, and workflow plans that would become stale. The UI should require explicit confirmation and should record the resulting invalidation chain.

## Invalidation and Regeneration Planning

Future candidate invalidation should produce review tasks or planning metadata only. The `InvalidationPropagationWorkspace` can display candidate invalidation sources and candidate dependency traversal paths. The `RegenerationPlanningWorkspace` can display candidate review order and blocked candidate dependencies. It must not display candidate invalidation as an instruction to regenerate CAD or engineering outputs.

If a future canonicalization workflow is approved, regeneration planning should distinguish `candidate_review_regeneration` from `canonical_output_regeneration`. Candidate review regeneration means regenerating or replaying candidate payloads only. Canonical output regeneration means recalculating deterministic outputs after canonical evidence changes. These must be visually separated.

## Preservation of Separation

The UI must preserve four distinct concepts. Canonical geometry is deterministic truth used by CAD and engineering only after approved workflows. Assisted geometry candidates are review-required hints with no authority. CAD authority is the solved deterministic `CADModel` and downstream drafting/rendering flow. Engineering authority is deterministic requirement, NEC, structural, routing, production, BOM, and decision logic. The UI must never collapse these concepts into one status.

Practical labels should include `canonical`, `candidate`, `reviewed projection`, `deterministic CAD`, and `deterministic engineering`. Candidate cards should use phrases such as `not used for CAD`, `not used for engineering`, `not canonical`, and `review required`. CAD readiness panels should show `candidate influence: none` unless a future reviewed canonicalization event has changed canonical inputs. Requirement panels should show `candidate satisfaction: disabled` or avoid candidate satisfaction concepts entirely.

## Workspace-by-Workspace Plan

In the `Canonical Evidence Workspace`, future geometry candidates should appear only as linked assisted context, never as canonical evidence rows. The workspace should show whether canonical geometry has related candidates, but should not alter completeness or requirement links based on candidate presence.

In the `Requirement Workspace`, future geometry candidates should be excluded from requirement satisfaction. If displayed, they should appear as `review context available` and should not change status.

In the `Engineering Decision Workspace`, future geometry candidates should appear only under excluded or contextual lineage. Decisions must cite canonical evidence and deterministic calculations, not candidates.

In the `Dependency Graph Viewer`, candidate nodes should be dashed, non-authoritative, and disconnected from authority nodes except through reviewed projection and future canonicalization event nodes if separately approved.

In the `Snapshot Timeline Workspace`, candidate events should appear on a candidate lane. Engineering snapshot hashes should not change because a candidate was generated or replayed.

In the `Regeneration Planning Workspace`, candidate replay or review planning should be separate from output regeneration. Candidate invalidation must not enqueue CAD regeneration.

In `Signal Provenance`, `Signal Dependency Graph`, `Signal Requirement Mapping`, `Signal Confidence`, `Signal Blocking`, `Signal Invalidation`, and context workspaces, future geometry candidates should not be promoted into engineering signals unless a separate deterministic reviewed canonical signal workflow is approved. If candidate context is displayed, it should be marked `candidate-only`.

## UI Planning Conclusion

The current Engineering Intelligence UI already has the right concepts for lineage, dependency graphs, snapshots, invalidation, regeneration planning, provenance, and CAD readiness metadata. Future geometry candidates can be surfaced safely only if they are visually and semantically isolated from canonical geometry, CAD authority, and engineering authority. The UI should make candidate status explicit, display provenance and replayability, prevent candidate-driven requirement satisfaction, and separate candidate invalidation from deterministic output invalidation. No UI implementation was performed in this phase.
