# Geometry Candidate UI Misuse Prevention V1

## Scope

Geometry Candidate UI Misuse Prevention V1 documents and validates that the review workspace cannot be used as a CAD, engineering, workflow, recommendation, or canonical mutation surface. The implementation remains limited to the existing `possible_obstruction_candidate` category and renders only inspectable review context.

## Forbidden UI actions

The workspace does not expose buttons or links for drawing geometry, editing roof planes, creating CAD geometry, creating setbacks, placing obstructions on CAD, marking CAD ready, satisfying requirements, triggering engineering regeneration, creating workflows, triggering recommendations, mutating canonical survey evidence, or mutating canonical geometry.

The workspace includes explicit negative-policy text stating these forbidden actions are absent. This text is informational and does not wire any control path.

## Review controls

Accept and reject controls are not exposed in V1. The workspace documents that safe accept/reject helpers exist server-side but that the admin UI will remain read-only until a dedicated audited server action path is designed, wired, and tested. This prevents review controls from being mistaken for canonical or engineering mutation authority.

## Projection-only semantics

Reviewed projection status is rendered only as review projection metadata. Projection-loaded and projection-only fields are displayed, and reviewer notes are shown when loaded. Projection display does not map data into canonical geometry, does not satisfy engineering requirements, and does not affect CAD readiness, workflows, or recommendations.

## Filtering behavior

The workspace filters the sandbox candidate list to `possible_obstruction_candidate` geometry candidates using the existing geometry candidate type guard. Non-geometry assisted evidence candidates are not rendered in this dedicated workspace.

## Tests

`tests/geometryCandidateReviewWorkspace.test.tsx` verifies that the workspace renders required non-authoritative labels and provenance fields, surfaces stale state as metadata-only, exposes no unsafe buttons or links, documents the missing audited review action path, preserves projection-only review display, and filters out non-geometry candidates.

## Validation

The clean validation run recorded in `outputs/real-survey-data-validation/geometry-candidate-review-workspace-v1-validation/validation-summary.md` completed with zero failures across boundary checks, topology, type-check, targeted UI tests, full tests, build, and lint.
