# Geometry Candidate Review Action Path V1

## Implemented Scope

Geometry Candidate Review Action Path V1 adds a safe, audited, projection-only review action model for the existing `possible_obstruction_candidate` pilot. It does not add any new geometry candidate category and does not expand the runtime beyond `deterministic-geometry-adjacency-runtime@1.0.0` with boundary policy `geometry_candidate_boundary_v1`.

## Action Model

The formal action type is now `GeometryCandidateReviewAction = 'accept_for_review_projection' | 'reject_candidate'`. The prior acknowledgement-style lifecycle naming was replaced with the directive-approved accept action name while preserving the existing reject action. The action persistence mode is explicitly `deterministic_dto_only_v1`, documenting that no durable database write is performed in this phase.

## Safe Helper Boundary

The action boundary is implemented in `lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts` through `submitGeometryCandidateReviewAction()`, `acceptGeometryCandidateReviewAction()`, and `rejectGeometryCandidateReviewAction()`. These helpers validate action type, reviewer ID, review timestamp, rejection reason for rejects, candidate type, candidate category, runtime tool, `review_required` state, `nonAuthoritative`, `reviewRequired`, and existing assisted-evidence authority guards. Unsupported actions, non-geometry candidates, unsupported geometry candidates, and already-reviewed candidates are rejected before any result DTO is returned.

## Accept Behavior

`acceptGeometryCandidateReviewAction()` delegates to the existing `acceptGeometryCandidateForReviewProjection()` helper. Acceptance returns a candidate DTO with `accepted_by_reviewer`, a reviewed evidence projection, and a full audit DTO. The projection remains in `roof_context`, contains only the `possible_obstruction_candidate` payload key, and is checked by `assertGeometryProjectionIsReviewOnly()`. The action does not create canonical geometry and does not mutate CAD, engineering, workflows, or recommendations.

## Reject Behavior

`rejectGeometryCandidateReviewAction()` delegates to the existing `rejectGeometryCandidate()` helper. Rejection requires a non-empty rejection reason and returns a candidate DTO with `rejected_by_reviewer`, no projection, and a full audit DTO. Rejection is assisted-evidence review-only and does not create downstream invalidations, canonical changes, CAD changes, engineering changes, workflows, or recommendations.

## Audit Metadata

The action audit DTO includes action type, persistence mode, candidate ID, candidate type, candidate hash, runtime name/version, runtime payload hash, source image reference, source lineage reference, boundary policy version, reviewer ID, reviewer display label, review timestamp, review note, prior review state, resulting review state, reviewed projection ID/hash for accepted actions, rejection reason for rejected actions, explicit authority flags, and deterministic notes. Authority flags are all false for canonical geometry mutation, CAD mutation, roof-plane mutation, setback mutation, layout mutation, engineering influence, NEC influence, workflow influence, recommendation influence, and downstream authority.

## Persistence Decision

The audit found no approved durable persistence pattern for this geometry action path. V1 therefore remains deterministic DTO-only / fixture-backed. Durable audit persistence, if needed later, must be introduced in a future phase with a separate audit and without writing canonical geometry, CAD, engineering, workflow, or recommendation state.
