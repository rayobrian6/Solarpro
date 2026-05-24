# Geometry Candidate Review Action Audit Path V1 — Audit First

## Scope

This audit was completed before implementing any Geometry Candidate Review Action UI. The audited scope is limited to the existing `possible_obstruction_candidate` pilot. No second geometry category is introduced by this audit. The reviewed action path must remain review-only, audited, projection-only, non-authoritative, and disconnected from CAD, canonical geometry, roof-plane, setback, layout, NEC, engineering, workflow, and recommendation authority.

## Current Baseline

The repository is on `dev` at commit `c03d3fc` (`Add geometry candidate review workspace`) and aligned with `origin/dev`. The current Geometry Candidate Review Workspace V1 renders only candidates passing `isGeometryCandidate()`, which requires `candidateType === 'possible_obstruction_candidate'`, `candidateCategory === 'roof_context'`, and runtime tool name `deterministic-geometry-adjacency-runtime`. The workspace is currently read-only and explicitly states that no drawing, roof-plane editing, setback creation, CAD placement, requirement satisfaction, engineering regeneration, workflow creation, recommendations, canonical survey evidence mutation, or canonical geometry mutation is exposed.

## Lifecycle and Projection Findings

`lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts` already contains the safest boundary for geometry review behavior. It validates the existing geometry pilot candidate, requires `review_required` status, requires `nonAuthoritative === true`, requires `reviewRequired === true`, and checks that the candidate cannot satisfy requirements, influence CAD readiness, influence recommendations, or create workflow items. Existing lifecycle helpers `acceptGeometryCandidateForReviewProjection()` and `rejectGeometryCandidate()` delegate to assisted evidence review helpers, and acceptance calls `assertGeometryProjectionIsReviewOnly()` to ensure the reviewed projection stays in `roof_context`, does not automatically mutate canonical evidence, and contains only the `possible_obstruction_candidate` projection payload key.

The generic `acceptCandidate()` helper creates a `ReviewedEvidenceProjection` and changes only the returned candidate DTO status to `accepted_by_reviewer`. The generic `rejectCandidate()` helper changes only the returned candidate DTO status to `rejected_by_reviewer` and returns no projection. The projection helper creates deterministic projection IDs and review projection hashes from candidate/reviewer/review fields. No DB write was identified in this lifecycle path. No safe durable persistence pattern was identified for this geometry action path during the audit, so V1 must remain deterministic DTO-only / fixture-backed and document durable audit persistence as a future phase.

The current lifecycle action type is `acknowledge_review_projection | reject_candidate`. The V1 directive requires formal actions `accept_for_review_projection` and `reject_candidate`, so the action model must be updated/formalized without adding any new geometry candidate type.

## Runtime Metadata Findings

`geometryCandidateRuntimeAdapter.ts`, `geometryCandidateRuntimeBridge.ts`, and `geometryCandidateTypes.ts` provide the required candidate provenance fields for audited review actions. Candidate payloads include `runtimePayloadHash`, `boundaryPolicyVersion`, `sourceImageLineageRef`, `candidateOnly`, `projectionOnlyOnReview`, `reviewRequired`, `nonAuthoritative`, stale propagation metadata, and forbidden-use/limitation text. The approved runtime is `deterministic-geometry-adjacency-runtime@1.0.0`, and the boundary policy is `geometry_candidate_boundary_v1`. These values are sufficient to populate the required review action audit DTO fields without querying canonical survey tables or CAD/engineering systems.

## Workspace Findings

`GeometryCandidateReviewWorkspace` currently displays candidate ID/type/confidence/status, source image reference, source image lineage, runtime, boundary policy, runtime payload hash, deterministic candidate hash, projection status, stale metadata-only state, lineage visibility-only state, reviewer notes, projection ID, projection-only status, and limitations. It intentionally does not expose accept/reject controls yet. The only safe UI change for V1 is to render inert review-only action controls and read-only action audit results that are derived from a precomputed safe DTO. The UI must not submit to CAD/canonical/engineering endpoints, must not mutate local candidate objects, and must not introduce drawing, measurement, placement, readiness, regeneration, workflow, or recommendation controls.

## Stale Visibility and Lineage Findings

`buildGeometryCandidateStaleVisibility()` is candidate-only and metadata-only. It can surface `candidate_source_stale`, `candidate_runtime_stale`, `candidate_policy_stale`, and `candidate_review_stale`, and it explicitly blocks canonical geometry, CAD output, engineering output, route output, BOM output, and plan-set output stale classes. `buildGeometryCandidateLineageNode()` creates lineage-only nodes with dependency role `lineage_visibility_only`, `downstreamAuthority: false`, allowed edges `source_image_to_candidate` and `candidate_to_review_projection`, and forbidden edges to CAD, roof plane, setback, layout, NEC, engineering, workflow, and recommendation. The review action audit should reuse this posture and must not add new dependency edges.

## Boundary Guard Findings

`scripts/check-assisted-evidence-boundaries.js` already scans `lib/assistedEvidence`, `lib/assistedEvidenceSources`, and selected canonical/Engineering Intelligence files. It has an explicit approved geometry review lifecycle file set containing `lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts`. Keeping the action model and helper boundary in that file minimizes surface area and avoids adding a new allowlisted file. The boundary guard should be strengthened or confirmed with action-path specific checks/tests so that the action helper file does not import CAD, drafting, plan-set, engineering, engineering-intelligence, routing, BOM, roof-geometry, panel-layout, placement, 3D, survey DB, or canonical evidence mutation modules.

## Required Audit Metadata for V1

The safe action result DTO must include candidate ID, candidate type, candidate hash, runtime name, runtime version, runtime payload hash, source image reference, source lineage reference, boundary policy version, reviewer ID, reviewer display label when available, review timestamp, review note, action type, prior review state, resulting review state, reviewed projection ID/hash for accepted actions, rejection reason for rejected actions, and explicit authority flags showing no canonical mutation, no CAD mutation, no engineering influence, no workflow influence, no recommendation influence, and no downstream authority.

## Approved Implementation Plan

The safest V1 implementation is to extend `geometryCandidateReviewLifecycle.ts` with a formal action model and DTO-only helper boundary named `submitGeometryCandidateReviewAction()`, plus explicit wrappers `acceptGeometryCandidateReviewAction()` and `rejectGeometryCandidateReviewAction()`. These helpers should validate the action type, validate reviewer ID and timestamp, validate rejection reason when rejecting, call the existing lifecycle helpers, derive the audit DTO from the original candidate and returned DTO/projection, and return only the audit DTO plus returned candidate/projection DTOs. They must not write to the database, mutate source/canonical evidence, mutate CAD, create roof planes, create setbacks, change layout, evaluate NEC or engineering requirements, create workflow items, or create recommendations.

The UI may be updated only after this audit report exists and only to display review-only controls backed by deterministic fixture action results. Because no durable persistence pattern is approved, UI controls should remain non-submitting/inert in V1 and should include clear text that durable persistence is a future phase. Read-only audit result display is approved if it renders the DTO fields produced by the safe lifecycle helper.

## Unsafe Paths That Must Remain Blocked

The V1 action path must not add database migrations or writes to `project_physical_data`, `site_surveys`, or `site_survey_files`; must not create or mutate canonical geometry; must not call CAD, roof-plane, setback, layout, routing, NEC, engineering, BOM, plan-set, workflow, or recommendation helpers; must not create a second geometry category; must not convert the candidate into object detection, segmentation, coordinates, bounding boxes, polygons, obstruction maps, roof extraction, or plane generation; must not influence readiness or workflow state; and must not treat accepted projection data as engineering truth.

## Audit Conclusion

Implementation may proceed only through the existing assisted-evidence geometry lifecycle boundary, with deterministic DTO-only review action results and read-only UI audit display. Durable persistence remains out of scope for V1. The action UI must not become an authority surface; it can only demonstrate the audited accept/reject result path for existing `possible_obstruction_candidate` candidates.
