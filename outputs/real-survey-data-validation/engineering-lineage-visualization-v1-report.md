# Engineering Lineage Visualization v1 Report

## Scope
This report documents Engineering Lineage Visualization v1 for the Engineering Intelligence Workspace UI. The UI now renders row-level provenance and lineage instead of only group counts.

## Evidence provenance visualization
The Canonical Evidence Workspace now displays evidence row identity, category, canonical representative status, duplicate group size, confidence, evidence source, truth source, survey timestamps, canonical selection reason, origin surveys, provenance/state references, linked requirements, linked decisions, linked outputs, linked document sections, graph nodes and edges, stale impacts, regeneration candidates, metadata completeness, and deterministic field-quality signals.

## Graph linkage visualization
Evidence rows expose linked persistent graph node ids and edge ids. This lets operators trace real canonical evidence into requirements, decisions, render/document outputs, and stale-state dependency chains without fabricating geometry or engineering facts.

## CAD readiness visualization
Group-level CAD readiness flags show `roof-plane-ready`, `routing-ready`, `setback-ready`, `trench-route-ready`, and `detached-structure-ready` statuses with deterministic reasons. Row-level readiness links include only flags positively satisfied by that row’s category; missing/blocking readiness remains visible at group level.

## Snapshot and timeline expansion
The Snapshot Timeline Workspace now displays loaded snapshots, latest snapshot presence, generated timestamps, previous and superseded snapshot ids, snapshot hashes, state refs, valid outputs, stale outputs, transition lineage, deterministic notes, snapshot hash listings, transition events, diff entries, and timeline stale states.

## Minimal data behavior
For sparse survey projects, groups truthfully show partial or missing lineage. Field-quality signals include insufficient electrical evidence, no attic/framing evidence, incomplete routing evidence, no trench context, and low roof/completeness context where applicable.
