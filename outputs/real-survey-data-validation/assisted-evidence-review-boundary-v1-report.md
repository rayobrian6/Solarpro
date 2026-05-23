# Assisted Evidence Review Boundary V1 Report

## Review Workflow

The review workflow is explicit and deterministic. `acceptCandidate()` accepts only `review_required` candidates and requires reviewer id, review timestamp, and at least one accepted field. Acceptance creates a `ReviewedEvidenceProjection` and marks the source candidate `accepted_by_reviewer`. `rejectCandidate()` accepts only `review_required` candidates, preserves the source candidate as `rejected_by_reviewer`, and creates no projection.

## Review Provenance

Reviewed projections include reviewer id, reviewed timestamp, review decision, accepted fields, rejected fields, review notes, source candidate id, source candidate hash, and review projection hash. This preserves a deterministic link from source upload metadata through candidate review to reviewed projection.

## Projection Model

`ReviewedEvidenceProjection` records include projection id, source candidate id, project id, survey id, reviewer id, accepted fields, projection category, projection payload, projection confidence, limitations, projection status, created timestamp, deterministic hash, review provenance, and canonical participation status.

## Canonical Participation Status

Projection canonical participation is explicit and separate from canonical mutation. Supported statuses are `not_eligible`, `eligible_for_mapping`, `mapped_to_explicit_survey_metadata`, `mapped_to_reviewed_evidence`, and `rejected_from_canonical`. This phase creates accepted projections as `eligible_for_mapping` only. It does not implement mapping to canonical evidence or survey metadata.

## Review Boundary Guarantee

Unreviewed candidates never project downstream. Invalidated candidates cannot be accepted. Rejected candidates remain auditable but inactive. Accepted candidates create reviewed projections only; reviewed projections do not automatically mutate canonical evidence, requirements, CAD readiness, recommendations, or workflow orchestration.
