# Geometry Candidate Roadmap Stale Visibility V1

## Scope

This report documents candidate-only stale visibility support for the controlled geometry-adjacent evidence pilot. The implementation is metadata-only and applies only to `possible_obstruction_candidate` assisted evidence candidates emitted by the governed geometry-adjacency runtime.

## Implemented Helper

`buildGeometryCandidateStaleVisibility()` compares current metadata inputs against the candidate's recorded provenance and payload metadata. It may identify only the following candidate-level stale classes: `candidate_source_stale`, `candidate_runtime_stale`, `candidate_policy_stale`, and `candidate_review_stale`.

The helper returns a deterministic visibility object with `candidateOnly: true`. It marks `reviewVisibilityRequired` when any candidate-level stale class is detected. This is intended to support review workspace presentation, not downstream invalidation.

## Explicitly Forbidden Stale Propagation

The helper carries explicit forbidden stale classes: `canonical_geometry_stale`, `cad_output_stale`, `engineering_output_stale`, `route_output_stale`, `bom_output_stale`, and `plan_set_output_stale`. It also returns `regenerationAllowed: false`, `cadInvalidationAllowed: false`, `engineeringInvalidationAllowed: false`, `workflowAllowed: false`, and `recommendationAllowed: false`.

These fields are intentionally defensive metadata. They do not call Engineering Intelligence invalidation modules, CAD regeneration modules, routing modules, BOM modules, plan-set modules, or workflow/recommendation modules.

## Safety Conclusion

The stale visibility increment adds review-facing transparency only. It does not invalidate canonical geometry, CAD output, engineering output, routes, BOMs, plan sets, workflows, recommendations, or any authoritative project state. Any stale signal remains confined to assisted evidence candidate review visibility.
