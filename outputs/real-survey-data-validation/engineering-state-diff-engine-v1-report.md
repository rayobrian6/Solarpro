# Engineering State Diff Engine v1 Report

## Scope

Engineering State Diff Engine v1 adds deterministic snapshot-to-snapshot comparison for persisted engineering state. It is a metadata diff engine only. It does not regenerate documents, recalculate engineering sizes, infer geometry, inspect image bytes, run OCR/CV/YOLO, invoke semantic extraction, or generate CAD.

## Diff Structures Added

The diff model was added to `lib/engineeringStateInvalidation/types.ts` and implemented in `lib/engineeringStateInvalidation/persistence.ts`.

The core diff types are:

- `EngineeringStateDiffType`
- `EngineeringStateDiffEntry`
- `EngineeringStateSnapshotDiff`

Supported diff entry types are:

- `added`
- `removed`
- `unchanged`
- `hash_changed`
- `stale_status_changed`
- `lineage_changed`

The final persisted diff intentionally excludes unchanged entries from the `entries` array while still preserving aggregate unchanged/preserved behavior through deterministic state id sets.

## Diff Builder

The primary diff builder is:

```ts
diffEngineeringStateSnapshots(previous, next)
```

It compares two `EngineeringStateSnapshot` instances and emits a deterministic `EngineeringStateSnapshotDiff` containing:

- previous and next snapshot ids
- previous and next snapshot hashes
- changed hash-vector dimensions
- deterministic diff entries
- added state ids
- removed state ids
- stale state ids
- preserved state ids
- deterministic diff hash
- deterministic notes

The diff builder treats each state reference as a deterministic state lineage record. It compares generation hashes, provenance hashes, dependency hashes, stale status, dependency node ids, requirement ids, decision ids, canonical evidence ids, and originating survey ids. It does not inspect underlying document content or external runtime artifacts.

## Ordering Guarantees

The diff engine uses stable sorting for all exposed collections:

- hash vector changes are emitted in the fixed hash-vector key order
- added state ids are sorted
- removed state ids are sorted
- stale state ids are sorted
- preserved state ids are sorted
- diff entries are sorted by deterministic `diffId`

This ordering is enforced by regression tests and by expanded audit guards that check deterministic ordering for snapshots and diffs.

## Hashing Guarantees

Diff hashes use the existing `stableEngineeringStateHash` utility. The diff hash is computed from deterministic diff payloads only. It is independent of wall-clock snapshot creation time and independent of object insertion order.

The snapshot builder similarly excludes `generatedAt` from snapshot hash material. This ensures that two snapshots created with identical graph/hash-vector/state-ref inputs produce the same snapshot hash even when their timestamps differ.

## Stale and Preserved Lineage

The diff engine explicitly persists stale and preserved state lineage:

- `staleStateIds` are read from the next snapshot and de-duplicated/sorted.
- `preservedStateIds` are derived from state ids present in both snapshots that did not become stale and did not have material hash, lineage, or status changes.
- changed states emit deterministic diff entries describing hash, status, or lineage changes.

This satisfies the dependency-change invalidation requirement by preserving unaffected outputs as explicit state rather than treating them as absent or regenerated.

## Transition History Integration

Diffs feed `buildEngineeringStateTransitionHistory(input)`, which persists transition events for:

- snapshot creation
- snapshot supersession
- state invalidation
- state regenerated/current status
- dependency change lineage
- decision change lineage
- stale-state preservation

Transition events are stable-id records and are sorted deterministically before persistence. They are queryable through `buildEngineeringStateTimeline(history, snapshots)` and helper functions such as `invalidationHistoryForState`, `regenerationHistoryForState`, `dependencyLineageForState`, `decisionEvolutionForState`, `requirementEvolutionForState`, and `snapshotAncestry`.

## Audit Guard Coverage

Diff-related guard coverage was added to `runEngineeringStateAuditGuards`:

- snapshot hashes are recomputed against supplied persistent graphs and hash vectors to detect drift
- snapshot arrays must be deterministically ordered
- diff entries must be deterministically ordered
- graph nodes and graph edges must be deterministically ordered
- invalidation lineage must include last-valid hashes and explicit trigger lineage
- regeneration plans referencing stale states must include dependency hashes
- persistent graph nodes and edges must not be orphaned

The audit guard regression test intentionally corrupts persisted lineage and snapshot hash data and verifies failure codes for orphaned lineage and snapshot drift.

## Regression Tests Added

Diff engine behavior is covered by the expanded `lib/engineeringStateInvalidation/engineeringStateInvalidation.test.ts` suite.

The relevant scenarios include:

- identical input determinism for snapshots and snapshot references
- dependency-change invalidation lineage and preserved output tracking
- deterministic diff entry ordering
- persisted stale-state transitions
- deterministic timeline helper behavior
- audit guard failure on orphaned lineage
- audit guard failure on snapshot hash drift

Focused result:

```text
npm test -- lib/engineeringStateInvalidation/engineeringStateInvalidation.test.ts
Test Files 1 passed (1)
Tests 11 passed (11)
```

Full validation result:

```text
npm test
Test Files 140 passed (140)
Tests 4833 passed (4833)
```

The full-system audit script also recorded a passing focused post-boundary suite:

```text
Test Files 4 passed (4)
Tests 35 passed (35)
Exit=0
```

## Validation Results

The diff engine was validated alongside the graph persistence implementation:

```text
npm run check:topology
Dependency topology guard passed.
Hard directional violations: 0.
Existing unprotected circular dependency remained: lib/utilityDetector.ts > lib/proposalTruthEngine.ts > lib/utilityDetector.ts.
```

```text
npm run type-check
Exit=0.
```

```text
npm run build
✓ Compiled successfully.
```

```text
npm run lint
Exit=0 with existing repository warnings.
```

```text
bash scripts/full-system-regression-audit-scans.sh
Audit logs generated under outputs/real-survey-data-validation/.
```

The audit prohibited-boundary log contained repository-wide pre-existing matches and the new persistence module's explicit negative guardrail note. No new prohibited runtime behavior was added.

## Deterministic Output Summary

Diff Engine v1 makes the following durable and queryable:

- added engineering states
- removed engineering states
- hash-changed engineering states
- stale-status changes
- lineage changes
- stale-state ids
- preserved-state ids
- hash-vector changes
- dependency-change transition events
- decision-change transition events
- stale-state preservation transition events

All exposed diff and transition outputs are deterministic, sorted, stable-hashed, and auditable.

## Prohibited Runtime Confirmation

The diff engine does not introduce OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, autonomous regeneration, engineering sizing changes, or any weakening of immutable survey history, canonical evidence truth, deterministic explainability, or topology guard architecture.
