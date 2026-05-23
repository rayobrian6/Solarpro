# Geometry Candidate Roadmap Review Lifecycle V1

## Scope

This report documents the first approved roadmap increment after the controlled geometry-adjacent evidence pilot. The implemented lifecycle hardening is limited to review-only assisted evidence candidates of type `possible_obstruction_candidate` emitted by the governed deterministic geometry-adjacency runtime. It does not add a new candidate category and does not expand the pilot beyond the previously selected V1 category.

## Implemented Runtime Boundary

The new helper `lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts` wraps the existing assisted evidence review workflow with geometry-specific assertions. It accepts only candidates that are `possible_obstruction_candidate`, remain in the `roof_context` assisted evidence category, were emitted by `deterministic-geometry-adjacency-runtime`, and are still in `review_required` status. The helper rejects non-geometry candidates before any review action can be taken through this geometry-specific lifecycle.

The acceptance path is intentionally projection-only. `acceptGeometryCandidateForReviewProjection()` calls the generic assisted evidence acceptance workflow with exactly one accepted field, `possible_obstruction_candidate`, then verifies that the resulting reviewed projection remains an assisted evidence review projection only. The projection payload is constrained to `{ possible_obstruction_candidate: 'source_image_review_context_only' }`. No roof plane, setback, coordinate, bounding box, polygon, CAD object, layout object, NEC fact, engineering fact, workflow item, recommendation, BOM input, route input, plan-set input, or canonical evidence mutation is produced.

The rejection path is similarly confined. `rejectGeometryCandidate()` records a reviewer rejection in assisted evidence review space and creates no projection. Rejected geometry candidates remain auditable but inactive, and the helper preserves the existing guard behavior that prevents candidates from satisfying requirements, influencing CAD readiness, influencing recommendations, or creating workflow items.

## Review-Only Safety Assertions

The lifecycle helper includes `assertReviewableGeometryCandidate()` and `assertGeometryProjectionIsReviewOnly()`. These assertions provide a local safety gate for future UI or review workspace integrations. They explicitly verify that geometry candidates are non-authoritative, review-required, unable to satisfy requirements, unable to influence CAD readiness, unable to influence recommendations, unable to create workflow items, and unable to automatically mutate canonical evidence through projections.

## Test Coverage

The targeted geometry runtime test file now includes roadmap lifecycle coverage. Tests verify that accepted geometry candidates become reviewed projections only, rejected geometry candidates create no projection or downstream authority, stale visibility is candidate-only, lineage nodes are visibility-only, and non-geometry candidates cannot use the geometry review lifecycle.

## Safety Conclusion

This roadmap increment hardens the human review lifecycle without increasing geometry authority. It preserves the original pilot constraints: review-only, non-authoritative, source-image-context-only, no CAD mutation, no roof-plane mutation, no setback mutation, no layout mutation, no NEC or engineering influence, no workflow or recommendation influence, and no canonical evidence mutation.
