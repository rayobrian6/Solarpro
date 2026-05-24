# Geometry Candidate Stale UI V1

## Scope

Geometry Candidate Stale UI V1 adds visible stale-state indicators for review-only geometry candidates. The stale UI is restricted to the existing `possible_obstruction_candidate` pilot and remains candidate-only metadata.

## Displayed stale classes

The workspace displays the required stale visibility states: candidate source stale, runtime payload stale, boundary policy stale, review state stale, and review visibility required. The underlying helper returns candidate-only stale classes: `candidate_source_stale`, `candidate_runtime_stale`, `candidate_policy_stale`, and `candidate_review_stale`.

## Metadata-only behavior

The stale UI is informational only. It does not invalidate CAD output, engineering output, route output, BOM output, plan-set output, canonical geometry, canonical survey evidence, or any authoritative engineering state. The workspace explicitly displays CAD invalidation as false, engineering invalidation as false, and workflow/recommendation as false/false.

## Current-state input model

The UI computes stale visibility from candidate metadata and an optional `reviewWorkspaceCurrentState` payload. If no current-state payload is provided, the candidate’s own source metadata hash, runtime payload hash, boundary policy version, and deterministic review-state hash are used. This avoids forcing stale states in the default fixture while preserving a deterministic way for tests and future safe display models to surface stale conditions.

## Operator messaging

The workspace states that stale state is review visibility metadata only and that it does not invalidate CAD, does not invalidate engineering, does not trigger recommendations, and does not create workflows. It also renders deterministic notes stating that all stale indicators are metadata-only and candidate-only.

## Validation

The targeted UI test `tests/geometryCandidateReviewWorkspace.test.tsx` verifies that all four candidate stale classes are visible when a stale current-state payload is supplied and that CAD, engineering, workflow, and recommendation authority remain false. The clean validation summary at `outputs/real-survey-data-validation/geometry-candidate-review-workspace-v1-validation/validation-summary.md` records zero failures.
