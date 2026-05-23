# Engineering State Graph Persistence v1 Report

## Scope

Engineering State Graph Persistence v1 converts engineering-state metadata from transient runtime-only bookkeeping into deterministic, durable, queryable system state. The implementation is intentionally metadata-only. It does not perform autonomous regeneration, engineering resizing, CAD generation, OCR, CV, YOLO, semantic inference, image-byte inspection, or image-content analysis.

The implementation was completed on branch `dev` without creating a new branch.

## Persistent Structures Added

The persistent state model was added under `lib/engineeringStateInvalidation/types.ts` and implemented in `lib/engineeringStateInvalidation/persistence.ts`.

The new persistent model includes:

- `EngineeringStateHashVector`, carrying deterministic hashes for dependency graph, provenance, generation, invalidation, render, decision, and requirement dimensions.
- `EngineeringStateSnapshotReference`, a compact stable reference used by provenance, render, invalidation, regeneration planning, and decision-aware metadata.
- `PersistentEngineeringStateGraph`, representing persisted engineering state records and dependency graph nodes.
- `PersistentEngineeringStateGraphNode`, representing either a persisted state record or copied dependency graph lineage node.
- `PersistentEngineeringStateGraphEdge`, representing deterministic edges for dependency lineage, invalidation, stale preservation, and snapshot supersession.
- `EngineeringStateSnapshot`, representing a durable deterministic snapshot of state refs, valid/stale state ids, transition ids, previous snapshot links, and hash vectors.
- `EngineeringStateTransitionHistory` and `EngineeringStateTransitionEvent`, representing durable transition events for snapshot creation, supersession, invalidation, regenerated/current state, dependency changes, decision changes, and stale-state preservation.
- `EngineeringStateTimeline`, representing queryable snapshot order, latest snapshot, stale outputs, invalidation events, regeneration events, dependency lineage, decision evolution, requirement evolution, and snapshot ancestry.

## Deterministic Builders Added

The persistence module exports the following deterministic builders:

- `buildPersistentEngineeringStateGraph(input)`
- `buildEngineeringStateSnapshot(input)`
- `engineeringStateSnapshotReference(snapshot)`
- `buildEngineeringStateTransitionHistory(input)`
- `buildEngineeringStateTimeline(history, snapshots)`

The graph builder persists state records as stable graph nodes and copies dependency graph nodes as lineage metadata. Dependency graph nodes are not used to infer new engineering state; they are persisted only as deterministic evidence of lineage. The builder emits deterministic dependency edges and invalidation/stale-preservation edges based on explicit registry and invalidation inputs.

The snapshot builder sorts state references, stale state ids, valid state ids, and transition event ids deterministically. Snapshot hashes intentionally exclude wall-clock `generatedAt` values so identical inputs produce identical snapshot hashes even if snapshots are created at different times.

The transition history builder records explicit state transition events without executing regeneration. Regeneration events in this context mean persisted status lineage for states that are current or already regenerated, not an autonomous runtime regeneration action.

## Timeline Query Helpers Added

The following query helpers were added for deterministic state inspection:

- `latestValidStateSnapshot(snapshots)`
- `listStaleEngineeringOutputs(snapshot)`
- `invalidationHistoryForState(history, stateId)`
- `dependencyLineageForState(snapshot, stateId)`
- `regenerationHistoryForState(history, stateId)`
- `decisionEvolutionForState(snapshots, stateId)`
- `requirementEvolutionForState(snapshots, stateId)`
- `snapshotAncestry(snapshot, snapshots)`

These helpers make engineering state evolution queryable without changing engineering calculations, sizing, layout, CAD, OCR, CV, or rendering behavior.

## Integrations Added

Snapshot references were integrated only into safe metadata surfaces:

- `SelectiveRegenerationPlan.snapshotReference`
- `EngineeringInvalidationLineageMetadata.snapshotReference`
- `DocumentProvenanceBundle.engineeringStateSnapshot`
- `BuildDocumentProvenanceInput.engineeringStateSnapshot`
- `RenderContext.engineeringStateSnapshot`
- decision-aware BOM metadata
- decision-aware SLD metadata
- decision-aware readiness summary metadata

The render context now resolves the snapshot reference from explicit options, document provenance, or invalidation lineage. This makes render outputs snapshot-aware while preserving existing rendering behavior.

## Audit Guards Expanded

`runEngineeringStateAuditGuards` was expanded to accept optional persistent graphs, snapshots, and diffs. New persistence-oriented guard codes include:

- `persistence_requires_provenance`
- `invalidation_requires_lineage`
- `regeneration_plan_requires_dependency_hash`
- `snapshot_hash_not_drifted`
- `persistence_ordering_deterministic`
- `persistent_graph_nodes_not_orphaned`

The guards check that persisted graph state nodes carry required provenance/generation/dependency hashes, graph edges reference existing endpoints, snapshot ordering is deterministic, diff ordering is deterministic, snapshot hashes do not drift from their deterministic graph/hash-vector payloads, invalidation events carry lineage, and regeneration plans do not reference stale states without dependency hashes.

## Regression Tests Added

The engineering state invalidation test suite was expanded with persistence coverage:

- stable engineering state snapshot hashes with identical-input determinism
- dependency-change invalidation lineage with preserved outputs
- deterministic diff ordering and persisted stale-state transitions
- timeline helper behavior for latest snapshots, stale outputs, invalidation history, and regeneration history
- snapshot reference propagation through provenance, render context, invalidation lineage, BOM metadata, and SLD metadata
- audit guard failures on orphaned persistent lineage and snapshot hash drift

Focused persistence test result:

```text
npm test -- lib/engineeringStateInvalidation/engineeringStateInvalidation.test.ts
Test Files 1 passed (1)
Tests 11 passed (11)
```

Full suite result recovered from the completed validation run:

```text
npm test
Test Files 140 passed (140)
Tests 4833 passed (4833)
```

The later full-system audit script also recorded:

```text
full-system-regression-audit-npm-test.log
Test Files 140 passed (140)
Tests 4828 passed (4828)
```

The difference in total count reflects the audit script's baseline at the time it ran; both full-suite executions passed.

## Validation Results

Validation completed with the following results:

```text
npm run check:topology
Dependency topology guard scanned 714 source files.
Circular dependencies: 1
1) [unprotected] lib/utilityDetector.ts > lib/proposalTruthEngine.ts > lib/utilityDetector.ts
Directional architecture warnings: 3
Hard directional violations: 0
Dependency topology guard passed.
```

```text
npm run type-check
> tsc --noEmit
Exit=0
```

```text
npm test
Test Files 140 passed (140)
Tests 4833 passed (4833)
```

```text
npm run build
✓ Compiled successfully
Route summary emitted successfully.
```

The local build emitted expected sandbox warnings for missing runtime environment variables (`DATABASE_URL`, `JWT_SECRET`, and recommended service keys). The build script explicitly continued and completed successfully.

```text
npm run lint
Exit=0 with existing repository warnings.
```

Lint warnings were pre-existing repository warnings such as `no-console`, React hook dependency warnings, image alt warnings, and `<img>` usage warnings.

```text
bash scripts/full-system-regression-audit-scans.sh
Generated audit logs under outputs/real-survey-data-validation/.
Focused post-boundary tests: Test Files 4 passed (4), Tests 35 passed (35), Exit=0.
```

The prohibited-boundary grep log contains repository-wide pre-existing references and intentional negative guardrail notes. The new persistence implementation only adds the explicit note: `No CV, OCR, CAD generation, image-byte inspection, or autonomous regeneration is performed.`

## Snapshot-Aware Outputs

The following engineering outputs/metadata surfaces are now snapshot-aware:

- render contexts
- document provenance bundles
- invalidation lineage metadata
- selective regeneration plans
- decision-aware BOM metadata
- decision-aware SLD metadata
- decision-aware readiness summaries

This is snapshot awareness only. No output generation behavior was changed.

## Prohibited Runtime Confirmation

This implementation did not introduce OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, autonomous regeneration, engineering sizing changes, or any weakening of immutable survey history, canonical evidence truth, deterministic explainability, or topology guard architecture.
