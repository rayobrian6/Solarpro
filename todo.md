# Read-Only Professional Survey Parser Integration + OSS Audit Todo

## Scope and Safety
- [x] Confirm this phase remains preview/review only with no authority promotion
- [x] Inspect current app routes, survey ingestion paths, admin/operator UI, and test structure
- [x] Identify safest read-only integration boundary

## Read-Only Parser Integration
- [x] Add read-only parser/reporting endpoint or service path for uploaded/DB-backed survey data
- [x] Expose readiness states: blocked, review_required, geometry_ready, cad_preview_ready
- [x] Preserve deterministic hashes and no-authority flags
- [x] Add no CAD mutation / no downstream execution protections

## Operator Readiness Panel
- [x] Add review-first operator/admin UI for evidence, canonical geometry, and CAD readiness
- [x] Clearly label Survey Derived, Parser Derived, Canonicalized, Preview Only, Review Required outputs
- [x] Surface blocking issues, missing fields, warnings, confidence gaps, and preview eligibility

## OSS Infrastructure Audit
- [x] Research OSS candidates for geometry/CAD/OCR/CV/spatial/DXF/SVG/snapping support
- [x] Evaluate licensing, maintenance, Node/TypeScript fit, integration risk, and adapter boundaries
- [x] Produce OSS infrastructure audit report

## Validation and Reports
- [x] Add regression coverage for integration and no-authority enforcement
- [x] Run parser integration validation and readiness panel validation
- [x] Run type-check clean
- [x] Add readiness integration report and updated fixture validation results

## Delivery
- [x] Commit changes
- [x] Push according to active repository workflow
- [x] Summarize implementation, audit findings, validation, and next phase
