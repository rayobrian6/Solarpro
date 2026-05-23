# Invalidation and Snapshot Audit V1 Report

## Invalidation architecture

Engineering invalidation is explicit and metadata-only. `lib/engineeringStateInvalidation/engine.ts` builds state registries, invalidation triggers, invalidation results, stale metadata, selective regeneration plans, and invalidation lineage metadata. The code marks stale state and preserves unrelated state records unless there is an explicit dependency intersection or graph reachability. It does not regenerate outputs.

`lib/engineeringIntelligence/invalidationEngine.ts` derives propagation from explicit triggers, registry state records, snapshots, and graph metadata. When no invalidation trigger is supplied, propagation remains explicit `not_loaded` metadata. Affected outputs are derived from existing engineering state records, snapshots, and graph metadata. Missing evidence, invalidated decisions, unresolved requirements, stale classes, traversal metadata, cycle metadata, and deterministic notes remain visible.

## Snapshot architecture

`lib/engineeringStateInvalidation/persistence.ts` builds persistent engineering state graphs, engineering state snapshots, snapshot references, snapshot diffs, transition histories, and timelines. Snapshot references are sorted. Snapshot hashes are computed from state refs, graph hash, and lineage hashes while excluding wall-clock `generatedAt`, preserving identical-input hash stability. Diffs compare sorted state IDs and hash vectors and emit sorted diff entries.

`lib/engineeringIntelligence/snapshotDelta.ts` compares previous and next snapshot references with propagation metadata, CAD readiness, and graph metadata. It produces metadata-only deltas for evidence IDs, decision IDs, stale outputs, regeneration candidates, invalidation causes, CAD readiness changes, dependency graph deltas, and conflict/unresolved review IDs. It explicitly rejects OCR, image-byte inspection, geometry inference, CAD generation, and autonomous engineering evaluation.

## Audit finding

Invalidation and snapshot flows satisfy the directive’s deterministic and truth-boundary requirements. No invalidation cycle defect was found. Cycle visibility and traversal truncation metadata are preserved by propagation traversal. No snapshot fallback/default chain was found that silently promotes missing truth.
