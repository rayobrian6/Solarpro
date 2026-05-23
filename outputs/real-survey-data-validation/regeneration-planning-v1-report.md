# Regeneration Planning V1 Report

## Pre-implementation audit

This report documents the current selective regeneration planning model before implementing deterministic Regeneration Planning V1.

The current planner is `buildSelectiveRegenerationPlan(input)` in `lib/engineeringStateInvalidation/engine.ts`. It consumes an engineering state registry, an invalidation result, an optional snapshot reference, and deterministic metadata. It does not regenerate documents, CAD, BOM, SLDs, layouts, calculations, or render outputs. It returns a `SelectiveRegenerationPlan` containing affected document sections, affected engineering decisions, affected render contexts, affected BOM rows, affected SLD sections, affected layout primitives, blocked regeneration dependencies, regeneration order, unchanged preserved outputs, stale state ids, deterministic hash, deterministic notes, and optional snapshot reference.

The current plan derives stale records from the invalidation result and uses state record categories and document types to populate affected-output fields. It sorts results deterministically and computes a deterministic hash from trigger id, stale ids, affected sections, render contexts, BOM/SLD/layout ids, blocked dependencies, and preserved outputs. This satisfies the required truth boundary that no automatic regeneration is executed.

The current `RegenerationPlanningWorkspace` in `lib/engineeringIntelligence/workspace.ts` summarizes supplied plans into regeneration candidates, regeneration order, blocked dependencies, preserved outputs, and deterministic notes. The UI renders plan cards and list boxes safely after the prior render-safety update. However, the workspace does not yet present full upstream trigger, dependency chain, missing evidence, stale class, impacted snapshot, affected render context lineage, or review/blocking reason metadata.

The current planner does not distinguish enough planning classes. It has stale state ids and blocked dependencies, but it does not classify candidates into `VALID`, `PARTIAL`, `STALE`, `INVALIDATED`, `BLOCKED`, `NOT_LOADED`, or `REQUIRES_REVIEW`. It also does not separate document-section candidates from render-context candidates, decision invalidations, snapshot-delta candidates, and preserved unaffected outputs as first-class V1 plan groups.

The current planner depends on the existing invalidation result, which itself depends on direct trigger matching plus reachability. Because the current invalidation result does not expose propagation paths, the regeneration plan cannot explain every candidate with full upstream/downstream lineage. V1 must consume the new propagation graph/invalidation engine output so every plan item can state what would need regeneration, why, which upstream trigger caused it, which outputs are impacted, what evidence is missing, and which dependency chain justifies the plan.

The current planning order is deterministic but simplistic. It uses state ids and/or static grouping rather than dependency-topological ordering. V1 should keep deterministic ordering but base it on propagation depth, output class, dependency edges, and stable ids, while also providing cycle-safe fallback ordering when topological order is impossible. Cycles must be reported as cycle-protected rather than silently hidden.

Snapshot references are supported as optional metadata in the current `SelectiveRegenerationPlan`, and decision-aware BOM/SLD metadata can carry state ids, hashes, stale metadata, and snapshot refs. V1 must use these references to identify affected snapshots and snapshot divergence without treating a plan as regenerated output. Snapshot-aware planning should remain observational: it describes what would need review or regeneration; it does not perform the regeneration.

CAD readiness and grouped CAD readiness currently remain deterministic metadata and do not initiate regeneration. V1 may include CAD-readiness transitions as invalidation/planning triggers only as metadata transitions. It must not generate CAD, infer geometry, parse image content, or make autonomous engineering decisions. CAD readiness changes should produce review/planning candidates, not CAD output.

Fallback/default decision provenance is currently explicit in decision notes and missing-input behavior. V1 must treat fallback/default-chain changes as deterministic planning triggers when the underlying decision provenance, requirement state, missing evidence, or selected value changes. The plan must preserve fallback truth boundaries and require review when a fallback/default affects engineering outputs.

## Required V1 planning semantics

Regeneration Planning V1 must produce scoped metadata-only plans. Each plan item should include a stable item id, stale class, source trigger id, source trigger type, affected state id, affected output id when applicable, affected document section ids, affected render context ids, affected snapshot ids, invalidated decision ids, missing evidence ids, blocked dependency ids, propagation path ids, deterministic reason, and a no-autonomous-regeneration note.

The planner must preserve unaffected outputs explicitly, report blocked and not-loaded states explicitly, and remain deterministic across reruns. It must handle sparse surveys, missing evidence, duplicate dependency edges, invalid snapshots, null transitions, stale propagation, downstream output invalidation, traversal limits, propagation depth limits, and cyclic graphs.

## Implementation and Validation Result

Regeneration Planning V1 was implemented in `lib/engineeringIntelligence/regenerationPlanner.ts` as scoped metadata only. The planner converts invalidation propagation impacts into reviewable plan items, regeneration candidate identifiers, preserved output identifiers, blocked dependency identifiers, missing evidence identifiers, review-required identifiers, propagation path identifiers, and deterministic hashes. It never regenerates documents, CAD, BOM, SLD, render contexts, calculations, or engineering decisions.

The UI now exposes the Regeneration Planning V1 workspace through the Engineering Intelligence project page, with safe rendering for sparse/null states. Final validation passed with prohibited-boundary scan, topology check, type-check, full tests, build, and lint all returning exit code `0`.
