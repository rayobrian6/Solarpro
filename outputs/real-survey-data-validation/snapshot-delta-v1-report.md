# Snapshot Delta V1 Report

## Pre-implementation audit

This report documents the current snapshot and diff model before implementing deterministic Snapshot Delta V1.

Current snapshot generation is implemented in `lib/engineeringStateInvalidation/persistence.ts` by `buildEngineeringStateSnapshot(input)`. It converts state records into stable snapshot refs, computes hash vectors, stale state ids, valid state ids, invalidation event ids, regeneration plan ids, and a deterministic snapshot hash. The hash intentionally excludes wall-clock `generatedAt`, preserving deterministic reruns when the same state metadata is supplied. Snapshot metadata is observational and does not regenerate outputs.

Current persistent graph generation feeds snapshots by creating state graph nodes, dependency graph nodes, dependency-to-state edges, invalidation edges, preservation edges, and snapshot supersession metadata. This gives the UI a lineage graph and snapshot refs, but snapshot deltas currently operate mostly on state refs and hash vectors rather than full impact categories.

Current snapshot diffing is implemented by `diffEngineeringStateSnapshots(previous, next)`. It compares sorted previous and next refs, classifies entries as `added`, `removed`, `unchanged`, `hash_changed`, `stale_status_changed`, or `lineage_changed`, and computes deterministic notes and hash output. This is deterministic and safe, but it does not yet expose the requested V1 categories: added evidence, removed evidence, changed decisions, stale outputs introduced, regenerated candidates, invalidation causes, changed CAD readiness, or dependency graph delta.

Current snapshot timeline behavior is implemented through transition history and timeline helpers. The workspace renders snapshot counts, diffs, transition events, latest snapshot status, stale state ids, snapshot hashes, transition summaries, and diff entry summaries. This gives useful state history but not an explicit stale-state timeline with propagation path, traversal depth, invalidation source, affected output, and cycle protection metadata.

Current project hydration creates a baseline snapshot before invalidation and a latest snapshot after applying the invalidation result. The diff between these snapshots is therefore a deterministic visualization of the simulated/latest-evidence invalidation path. The audit flags this as important: V1 must distinguish actual supplied snapshot divergence from demonstration-style/latest evidence planning metadata. Snapshot deltas should describe divergence between explicit snapshot inputs and state metadata, not fabricate an engineering change.

Snapshot refs currently include state ids, state type/category, document type, render context, dependency/provenance/generation hashes, stale status, invalidation reason, and related ids. These are enough to detect deterministic state-level changes, but V1 must aggregate them into user-facing delta groups without interpreting content semantically. For example, a changed decision must be detected by decision ids, decision hashes, selected value metadata, or state refs; not by natural-language inference. Added/removed evidence must be detected by canonical evidence ids and manifest/reference metadata; not by image parsing. Changed CAD readiness must be detected from explicit readiness metadata; not from CAD inference.

The current snapshot diff has no graph delta. V1 must compare dependency graph node ids, edge ids, edge types, edge endpoints, and deterministic reasons when graph snapshots or persistent graph metadata are available. It should classify added nodes, removed nodes, changed edge endpoints/types/reasons, duplicate-suppressed edges, missing nodes, and cycle/traversal-limit impacts. This graph delta must remain structural metadata only.

Invalid snapshot and null transition handling must be explicit. Current functions are generally tolerant of supplied empty arrays and optional metadata, but V1 must report invalid/missing previous snapshot, invalid/missing next snapshot, missing hash vectors, null latest snapshot, null timeline, null transition history, and missing graph refs as `NOT_LOADED`, `BLOCKED`, or `REQUIRES_REVIEW` depending deterministic cause. It must not fabricate snapshot refs to make a delta complete.

## Required V1 snapshot delta semantics

Snapshot Delta V1 must produce deterministic metadata groups for added evidence, removed evidence, changed decisions, stale outputs introduced, regenerated candidates, invalidation causes, changed CAD readiness, dependency graph delta, affected snapshots, affected render contexts, affected document sections, and review blockers.

Each delta entry should include a stable id, delta type, previous id/hash/status when available, next id/hash/status when available, related evidence ids, requirement ids, decision ids, state ids, output ids, graph node ids, graph edge ids, stale class, deterministic reason, and source metadata. It must not perform semantic diffing, OCR, image analysis, geometry inference, CAD generation, or autonomous engineering evaluation.

## Implementation and Validation Result

Snapshot Delta V1 was implemented in `lib/engineeringIntelligence/snapshotDelta.ts`. The delta engine reports explicit metadata categories for added evidence, removed evidence, changed decisions, stale outputs introduced, regenerated candidates, invalidation causes, changed CAD readiness, dependency graph deltas, and not-loaded snapshots. It compares only explicit snapshot references, existing snapshot diff metadata, propagation metadata, CAD readiness flags, and persistent graph structural identifiers; it does not perform semantic interpretation or image analysis.

The Engineering Intelligence workspace now includes snapshot delta, affected outputs, dependency traversal, invalidation propagation, regeneration planning, and stale-state timeline sections. Final validation passed with prohibited-boundary scan, topology check, type-check, full tests, build, and lint all returning exit code `0`.
