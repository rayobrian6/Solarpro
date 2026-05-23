# Deterministic Guarantees Audit V1 Report

## Ordering guarantees

The audited Engineering Intelligence stack consistently sorts IDs and rows using `localeCompare` through helper functions such as `sortText` and `sortBy`. Registry records, graph nodes, graph edges, context ranks, snapshots, diffs, stale outputs, affected outputs, missing evidence, review IDs, and workspace rows are emitted in stable order. Context arbitration ranks by confidence score with context ID tie-break.

## Hash guarantees

Context resolution hashes use SHA-256 over normalized JSON with sorted object keys. Engineering state snapshot hashes are stable over state references, graph hash, and lineage hashes and exclude wall-clock `generatedAt`. Regeneration plan hashes are derived from plan ID, trigger ID, plan item IDs, preserved outputs, blocked dependencies, missing evidence, review IDs, and propagation paths. Snapshot delta hashes derive from sorted delta constituents.

## Runtime non-determinism audit

No runtime randomization was found in the audited Engineering Intelligence stack. Where generated timestamps are optional, the architecture uses caller-supplied `generatedAt` or deterministic epoch fallback (`new Date(0).toISOString()`). Tests use fixed timestamps. Boundary scans and scripts prohibit OCR, OpenCV/cv2, TensorFlow, PyTorch, YOLO, image-byte analysis, hidden AI inference, autonomous CAD generation, and auto-regeneration.

## Stabilization applied

Context dependency graph edges are now inserted through a deterministic `Map` keyed by `edgeId`, then sorted lexicographically before return. This ensures that overlapping lineage cannot produce nondeterministic duplicate edge semantics.

## Non-blocking deterministic debt

The propagation graph duplicate-edge merge path remains deterministic but has O(E²) performance due to linear scans over existing edge values. Future optimization should use a deterministic signature map while preserving the current sorted output contract.
