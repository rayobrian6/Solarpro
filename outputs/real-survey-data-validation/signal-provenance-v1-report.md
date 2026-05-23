# Signal Provenance V1 Report

Structured Engineering Signals V1 exposes provenance for every generated signal through source evidence ids, source photo ids, source survey ids, derived-from metadata, dependency nodes, requirement impacts, decision impacts, CAD impacts, stale impacts, invalidation participation, and a deterministic hash. The implementation is registry-driven and replayable: the same canonical evidence and deterministic metadata produce the same signal ids, statuses, dependency edges, confidence values, and hashes.

## Provenance sources

Allowed sources are explicitly typed as canonical evidence, canonical manifest summary, canonical evidence metadata, survey field evidence, deterministic grouping metadata, requirement evaluation, CAD-readiness metadata, invalidation propagation metadata, and project metadata. The extraction engine intentionally treats deterministic grouping as metadata context only, not as engineering truth or geometry.

## Dependency graph

The signal summary builds a signal dependency graph with signal, evidence, grouping, requirement, CAD-readiness, and invalidation nodes. Edges are limited to `derived_from`, `depends_on`, `impacts_requirement`, `impacts_cad_readiness`, and `invalidated_by`. This graph is rendered in the Signal Dependency Graph workspace and is also available to downstream runtime inspection surfaces.

## Invalidation and stale participation

Signals record invalidation events when source canonical evidence participates in deterministic invalidation metadata. Invalidated signals cap confidence and expose `INVALIDATED` stale impacts. Blocked, partial, missing, and valid states map to deterministic stale classes used by the Signal Invalidations and Signal Stale Impacts workspaces. Missing or blocked CAD-impacting signals also produce fallback participation rows so downstream readiness surfaces do not silently promote assumptions.

## Hash and replay stability

The extraction engine computes a stable FNV-style hash over a sorted signal core. Regression coverage verifies deterministic reruns, hash stability, dependency edge stability, and confidence score stability for identical inputs.
