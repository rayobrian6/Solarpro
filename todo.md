# Deterministic Photo Grouping + Survey Sequence Interpretation V1

## Audit
- [x] Verify dev branch guardrails and current workspace model surfaces
- [x] Inspect survey evidence/file metadata shapes for allowed deterministic inputs
- [x] Inspect CAD readiness, requirement, provenance, graph, and UI integration points

## Implementation
- [x] Add deterministic survey traversal and photo grouping metadata model
- [x] Derive traversal order, segments, clusters, continuity chains, breakpoints, and completeness scores from allowed metadata only
- [x] Add grouped CAD readiness context without CAD generation or inferred engineering truth
- [x] Hydrate grouping metadata into project Engineering Intelligence workspace
- [x] Render survey movement reconstruction, photo clusters, and grouped readiness context in the workspace UI
- [x] Preserve sparse/missing/blocked states and truth-boundary guardrails

## Tests and reports
- [x] Add regression tests for sparse exterior-only surveys
- [x] Add regression tests for interrupted ordering, duplicate timestamps, mixed roof traversal, and stable reruns
- [x] Add regression tests for grouped roof/utility/detached continuity and missing electrical evidence
- [x] Create deterministic photo grouping v1 report
- [x] Create survey sequence interpretation v1 report
- [x] Create grouped CAD readiness v1 report

## Validation
- [x] Run topology check
- [x] Run type-check
- [x] Run tests
- [x] Run build
- [x] Run lint
- [x] Run prohibited-boundary scan

## Commit and dev-only push
- [x] Review diff/status
- [ ] Commit changes on dev
- [ ] Push dev only
- [ ] Final recap with exact validation results
