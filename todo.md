# Homeowner Intake Evidence + Qualification Persistence Audit

## Audit
- [x] Trace homeowner intake fields from UI state to API payload to intake_events payload to Admin Feed render keys.
- [x] Audit monthly bill vs utility bill file metadata handling and identify corruption source.
- [x] Audit utility bill file upload truth: stored file vs metadata-only.
- [x] Audit qualification form payload, API normalization, persisted event payload, admin projection, and summary generation.
- [x] Audit event id/review labels and review-readiness fields in Admin Intake Feed.

## Fix
- [x] Fix field key mismatches in homeowner intake persistence/projection without changing architecture.
- [x] Ensure monthly bill cannot be overwritten/confused with uploaded file size.
- [x] Make utility bill attachment status explicit and non-misleading if metadata-only.
- [x] Ensure qualification answers persist/render as submitted and fallbacks only represent skipped/missing data.
- [x] Clarify Admin Intake Feed event/review relationship and add derived review readiness status using existing payload/projection.
- [x] Add safe temporary structured logs without exposing secrets/full PII.

## Tests / QA
- [x] Add/update tests for monthly bill persistence, file metadata separation, qualification persistence/projection, admin rendering, and event labels.
- [x] Run targeted homeowner intake and qualification Vitest suites.
- [x] Run TypeScript check.
- [x] Run lint.
- [x] Run build if practical.
- [ ] Perform/manual-simulate required validation and confirm no auto-created network_opportunities.

## Finalize
- [x] Review diff and files changed.
- [ ] Commit and push to dev if validation passes.
- [ ] Report root causes, storage truth, event relationship, changed files, tests, and QA results.
