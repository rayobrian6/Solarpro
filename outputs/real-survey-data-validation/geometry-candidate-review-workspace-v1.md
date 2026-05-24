# Geometry Candidate Review Workspace V1

## Scope

Geometry Candidate Review Workspace V1 adds a dedicated, clearly separated review-only workspace for the existing `possible_obstruction_candidate` pilot in the Engineering Intelligence admin surface. The workspace is intentionally limited to operator inspection of candidate metadata, source image references, runtime provenance, deterministic hashes, stale visibility, lineage visibility, projection review status, reviewer notes, and explicit limitations.

This phase does not add any geometry category beyond `possible_obstruction_candidate`. It does not create CAD geometry, edit roof planes, mutate setbacks, alter layouts, satisfy engineering requirements, influence NEC/engineering truth, create workflow items, trigger recommendations, or mutate canonical survey evidence or canonical geometry.

## UI placement

The workspace is rendered in `app/admin/engineering-intelligence/page.tsx` immediately after the existing Assisted Evidence Sandbox, using the same sandbox candidate/projection model but filtering to geometry candidates only. This keeps the geometry review surface separated from broader assisted evidence while still making the existing pilot visible to operators.

## Required labels

The workspace renders the required operator labels: `GEOMETRY CANDIDATE`, `REVIEW REQUIRED`, `NON-AUTHORITATIVE`, `NOT CAD INPUT`, `NOT ENGINEERING TRUTH`, and `NOT CANONICAL GEOMETRY`. The header also identifies the workspace as read-only.

## Required fields

For each filtered `possible_obstruction_candidate`, the workspace displays candidate ID, candidate type, source image reference, source image lineage, runtime name and version, runtime payload hash, deterministic candidate hash, boundary policy version, confidence, review status, reviewed projection status, reviewer notes when projection data is loaded, and explicit limitations from the candidate payload.

## Review action posture

The workspace is read-only. It does not expose accept or reject controls. Existing server-side review helpers exist, but no dedicated audited admin server-action path is wired in this UI phase. The UI therefore documents that missing safe action path rather than presenting controls that could imply mutation authority.

## Authority boundaries

The workspace uses lineage and stale visibility helpers only for display. It does not create downstream authority. It renders lineage as `lineage_visibility_only` with `downstreamAuthority` false, shows allowed visibility edges, and lists forbidden edges to CAD, roof planes, setbacks, layout, NEC, engineering, workflow, and recommendation systems.

## Validation

The clean validation capture is recorded in `outputs/real-survey-data-validation/geometry-candidate-review-workspace-v1-validation/validation-summary.md`. The clean run completed with zero failures across assisted-evidence boundary checks, engineering boundary checks, topology checks, type-check, targeted UI tests, full test suite, build, and lint.
