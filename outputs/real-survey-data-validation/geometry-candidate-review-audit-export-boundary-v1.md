# Geometry Candidate Review Audit Export Boundary V1

The export bundle implementation remains inside `lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts`, the previously approved geometry review lifecycle file. No new runtime file, route, API endpoint, database migration, persistence adapter, CAD adapter, engineering adapter, workflow adapter, recommendation adapter, rendering adapter, or canonical geometry adapter was introduced.

Boundary properties verified by implementation and tests:

- `buildGeometryCandidateReviewAuditExportBundle()` requires `assertReviewableGeometryCandidate()` and therefore accepts only existing `possible_obstruction_candidate` review-required geometry candidates.
- The bundle persistence mode is `deterministic_dto_only_v1`.
- The export schema is `geometry_candidate_review_audit_export_bundle_v1`.
- The bundle contains provenance and review visibility metadata only.
- The bundle includes all-false authority flags for canonical geometry mutation, CAD mutation, roof-plane mutation, setback mutation, layout mutation, engineering influence, NEC influence, workflow influence, recommendation influence, and downstream authority.
- Optional accept/reject previews are generated through the already-audited review-action helpers and remain DTO-only.
- Source-level boundary tests assert the lifecycle file does not import CAD, drafting, plan-set, engineering, Engineering Intelligence, routing, BOM, roof geometry, panel layout, placement, survey evidence DB, or survey DB modules.
- Source-level boundary tests assert the lifecycle file does not contain SQL mutation statements, ORM-style insert/upsert/update/delete calls, or downstream authority function calls including CAD generation, survey-to-CAD build, fire setback calculation, conduit routing, engineering requirement evaluation, CAD readiness, recommendation, or workflow orchestration builders.

The boundary therefore remains review/provenance/export-only. No downstream authority path was added.
