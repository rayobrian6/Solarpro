# Geometry Candidate Review Annotation V1

## Scope

Geometry Candidate Review Annotation V1 adds a deterministic DTO-only reviewer annotation path for existing review-required `possible_obstruction_candidate` candidates. The increment is limited to review provenance metadata for the current geometry-candidate lifecycle boundary. It does not approve candidates, reject candidates, create reviewed evidence projections, persist annotation records, or grant authority to downstream operational systems.

## DTO contract

The annotation helper records the candidate identifier, candidate type, deterministic candidate hash, source image reference, source lineage reference, runtime name, runtime version, runtime payload hash, and boundary policy version. Reviewer metadata includes reviewer ID, optional reviewer display label, annotation timestamp, optional annotation note, optional reviewer confidence, and normalized tags. The schema marker is `geometry_candidate_review_annotation_v1`, and the persistence mode remains `deterministic_dto_only_v1`.

The annotation hash is derived deterministically from the DTO payload before the hash field is added. Replaying the same candidate and annotation input yields the same annotation DTO and hash.

## Review-state behavior

The helper requires a reviewable geometry candidate and therefore accepts only the approved geometry-candidate shape: `possible_obstruction_candidate`, `roof_context`, `review_required`, non-authoritative, and review-required. The annotation result returns the original candidate object, reports `projection: null`, records `projectionCreated: false`, and keeps both prior and resulting review states unchanged as `review_required`.

## Reviewer confidence and tags

Reviewer confidence is optional triage metadata and must be a finite number from 0 through 1 when provided. Tags are trimmed, empty tags are removed, duplicate tags are collapsed, and the final tag list is sorted for deterministic replay. The annotation requires at least one meaningful content field: annotation note, reviewer confidence, or tag.

## Safety boundary

Annotation V1 uses the existing all-false geometry review authority flags. It does not call the accept path, reject path, review-action submitter, or projection builder. It performs no database writes and adds no imports from CAD, drafting, plan-set, engineering, routing, BOM, roof-geometry, panel-layout, placement, survey evidence, or survey database modules.

## Validation coverage

Targeted tests cover deterministic replay, provenance fields, unchanged candidate state, null projection behavior, all-false authority flags, normalized optional values, confidence-only and tag-only annotations, missing reviewer metadata, missing annotation content, invalid confidence, non-geometry candidates, and already-reviewed candidates. The boundary source-scan test now also asserts the annotation helper/schema exist and that the annotation helper block does not submit review actions or create projections.
