# Deterministic Photo Grouping V1 Report

Generated for the Engineering Intelligence Workspace deterministic grouping directive.

## Scope

This implementation adds a metadata-only grouping model that consumes canonical survey evidence manifest rows, survey/file timestamps, filename order, submitted categories, canonical categories, stable ids, and optional image metadata fields already present in the manifest. It does not inspect image bytes, run computer vision, infer scene semantics, or create CAD geometry.

## Outputs Added

The model exposes `surveyTraversalOrder`, `surveyTraversalSegments`, `evidenceClusters`, `clusterConfidence`, `clusterBoundaryReasons`, `clusterTransitionReasons`, `roofSideCandidateGroups`, `routingContinuityGroups`, `utilityEvidenceGroups`, `electricalEvidenceGroups`, `detachedStructureGroups`, `groundMountCandidateGroups`, `sequenceBreakpoints`, `photoContinuityChains`, and `metadataCompletenessScores`.

## Deterministic Ordering

Traversal order is sorted by capture timestamp, upload timestamp fallback, filename, canonical category, and stable evidence id. Duplicate timestamp ties are explicitly recorded as sequence breakpoints rather than hidden. Timestamp gaps greater than the deterministic threshold are also recorded as breakpoints.

## Truth Boundary

Grouped labels are engineering review context only. They do not promote missing MSP, attic, framing, trench, ESS, detached-structure, or geometry truth. Sparse exterior-only evidence remains partial or blocked where requirement evaluation and CAD readiness metadata are missing explicit evidence.

## Regression Coverage

Regression tests cover sparse exterior-only surveys, duplicate timestamps, interrupted traversal ordering, grouped roof continuity, grouped utility continuity, detached/trench grouping from explicit metadata, missing electrical evidence, mixed roof-side traversal, deterministic cluster stability, and stable ordering across reruns using canonical metadata ordering.
