# Geometry Candidate Roadmap Progress V1

## Completed Roadmap Items

This increment implements the safest high-value parts of the approved roadmap after the controlled geometry-adjacent evidence pilot. It does not introduce a second candidate category and does not broaden the pilot beyond `possible_obstruction_candidate`.

The completed work includes review lifecycle hardening, candidate-only stale visibility, lineage/dependency compatibility metadata, misuse-prevention tests, boundary checker hardening for lifecycle safety text, and validation artifacts.

## Review Lifecycle Hardening

`lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts` adds a geometry-specific review wrapper. It allows only governed `possible_obstruction_candidate` candidates in `review_required` status to enter the geometry review lifecycle. Accepted candidates are converted only into reviewed assisted evidence projections with the single accepted field `possible_obstruction_candidate`. Rejected candidates create no projection. Both paths preserve non-authoritative semantics.

## Candidate-Only Stale Visibility

The new stale visibility helper compares source metadata hash, runtime payload hash, boundary policy version, and review state hash to determine only candidate-level stale classes. It explicitly forbids stale propagation into canonical geometry, CAD output, engineering output, route output, BOM output, and plan-set output. It also marks regeneration, CAD invalidation, engineering invalidation, workflow, and recommendation actions as unavailable.

## Lineage Compatibility Without Authority

The new lineage helper emits deterministic visibility-only nodes with `downstreamAuthority: false`. The only allowed lineage edges are source-image-to-candidate and candidate-to-review-projection. Candidate-to-CAD, candidate-to-roof-plane, candidate-to-setback, candidate-to-layout, candidate-to-NEC, candidate-to-engineering, candidate-to-workflow, and candidate-to-recommendation edges are explicitly forbidden metadata.

## Boundary Checker Hardening

`scripts/check-assisted-evidence-boundaries.js` now recognizes `geometryCandidateReviewLifecycle.ts` as an approved geometry review lifecycle file for negative-policy and guard-only text. This is deliberately narrow: it permits review guard calls, forbidden edge metadata, forbidden stale metadata, and explanatory no-authority strings while continuing to prohibit active geometry measurement, CAD generation, engineering fact production, workflow influence, recommendation influence, image decoding, CV/ML inference, and canonical mutation.

## Tests and Validation

The targeted geometry runtime test file now has 13 passing tests. New tests cover projection-only acceptance, no-authority rejection, candidate-only stale visibility, lineage-only dependency compatibility, and rejection of non-geometry candidates attempting to use the geometry lifecycle. The roadmap validation directory records passing exit codes for assisted-evidence boundaries, engineering boundaries, topology, type-check, targeted tests, full tests, build, and lint.

## Safety Conclusion

The roadmap increment improves governance and review ergonomics without giving geometry candidates operational authority. No CAD, roof-plane, setback, layout, routing, NEC, conductor sizing, structural, BOM, plan-set, engineering, canonical evidence, readiness, workflow, or recommendation influence was added.
