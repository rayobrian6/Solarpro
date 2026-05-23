# Dependency and Topology Audit V1 Report

## Dependency flow

The audited dependency flow is centered on `projectHydration.ts`. Database or supplied survey sources become canonical survey evidence through `buildSurveyEvidenceManifest` and `buildProjectSurveyEvidenceHygiene`. That evidence feeds deterministic photo grouping, structured signal extraction, context resolution, CAD readiness, decision provenance, document provenance, state registry construction, persistent graph creation, snapshots, invalidation propagation, regeneration planning metadata, snapshot deltas, and workspace assembly. The flow remains one-directional from explicit evidence and registries toward derived metadata and UI models.

The import map in `audit-symbol-map.txt` confirms the intended layering. Engineering Intelligence consumes survey evidence, decision provenance, document provenance, and state invalidation modules. The admin route consumes Engineering Intelligence hydration/workspace models. Boundary scripts cover prohibited dependency directions and forbidden runtime technologies.

## Topology verification

`npm run check:topology` passed during the audit. It reported known pre-existing warnings but no blocking topology failure. `npm run check:engineering-boundaries` also passed. Additional dependency scans were written to `audit-additional-scans-v1.txt`, including audited imports, prohibited runtime term occurrences, sort/hash markers, and traversal/cycle guard markers.

## Graph semantics

The persistent engineering state graph and context dependency graph both expose explicit node and edge metadata. Propagation graph traversal supports downstream/upstream directions, bounded depth, traversal limits, cycle detection, visited-node tracking, and deterministic sorted outputs. Context dependency graph construction was hardened in this audit to de-duplicate `edgeId` values deterministically before sorting output edges. The direct regression in `contextResolution.test.ts` verifies unique and lexicographically sorted edge IDs.

## Architectural risk

The graph merge helper in `propagationGraph.ts` remains deterministic but uses an O(E²) duplicate detection pattern. This is acceptable for the current bounded graph sizes but should be optimized in a later architecture phase with a signature index that preserves stable output ordering.
