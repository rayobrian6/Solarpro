# Geometry Candidate Reviewer Experience Preview Pack V1

## Scope

Geometry Candidate Reviewer Experience Preview Pack V1 bundles a small set of read-only reviewer-experience improvements for the conservative geometry-candidate roadmap. The increment remains limited to existing review-required `possible_obstruction_candidate` candidates and continues to use deterministic DTO-only lifecycle helpers. The pack adds optional annotation preview visibility to the audit export bundle, a display-only reviewer triage summary in the Engineering Intelligence geometry candidate review workspace, and stronger unavailable-state messaging for preview paths that are invalid outside `review_required` candidate state.

## Export Visibility

The audit export bundle now supports an optional `reviewerAnnotationPreview` field. When supplied, this field is built through `buildGeometryCandidateReviewAnnotation()` and carries the existing `geometry_candidate_review_annotation_v1` audit DTO. It records reviewer provenance, annotation note, reviewer confidence, normalized tags, unchanged prior/resulting review state, `projectionCreated: false`, null reviewed projection references, all-false authority flags, and deterministic annotation hash. If annotation preview input is omitted, the field is `null` and the bundle remains DTO-only.

## Workspace Triage Display

The review workspace now renders a compact `Reviewer triage summary · display-only` section derived from annotation preview metadata. The summary shows the preview mode, confidence label, unchanged state transition, projection-created status, downstream-authority status, and tag summary. This is intentionally presentation-only: it is not a live filter, not sorting authority, not persistence, not approval, not rejection, not projection creation, and not downstream engineering input.

## Unavailable-State Messaging

Annotation and review-action preview unavailable messages now explicitly state that unsupported candidate states do not expose retry controls, submit handlers, repair actions, promotion paths, persistence, CAD mutation, engineering influence, workflow creation, recommendation influence, or canonical mutation. This keeps non-reviewable candidate messaging aligned with the lifecycle helpers that reject already-reviewed, invalidated, superseded, or unsupported candidates.

## Safety Boundary

This pack does not add durable annotation persistence, reviewer-submitted forms, editable inputs, submit handlers, API calls, database calls, candidate status mutation, reviewed projection creation from annotations, canonical geometry mutation, CAD mutation, roof-plane mutation, setback mutation, layout mutation, NEC authority, engineering authority, workflow authority, recommendation authority, BOM authority, route authority, plan-set authority, or permit authority.

## Validation Coverage

Targeted tests cover the audit export bundle with annotation preview metadata, deterministic replay, null annotation preview behavior when omitted, invalid annotation confidence rejection through the export path, and workspace rendering of the display-only triage summary. Existing workspace tests continue to assert that only the disabled audited accept/reject buttons are present and that no unsafe CAD, engineering, workflow, recommendation, or canonical mutation controls are exposed.

## Files

- `lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts`
- `app/admin/engineering-intelligence/components.tsx`
- `tests/geometryCandidateReviewAuditExportBundle.test.ts`
- `tests/geometryCandidateReviewWorkspace.test.tsx`
- `outputs/real-survey-data-validation/geometry-candidate-reviewer-experience-preview-pack-v1.md`
