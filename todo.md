# End-to-End Marketplace Pipeline Audit

## Capture failure and map pipeline
- [x] Verify branch/status and current code context.
- [x] Map simulator create/screen/score/release/match actions and expected DB state transitions.
- [x] Map Marketplace Workbench visibility gates and assignment actions.
- [x] Map contractor matcher eligibility requirements and schema fields.

## Audit schema contracts
- [x] Verify network_opportunities fields required by release/workbench/matcher.
- [x] Verify screening queue decision fields and release approval semantics.
- [x] Verify intelligence score/price fields used by workbench and matching.
- [x] Verify assignment/event dependencies and cleanup behavior.

## Patch verified pipeline breaks
- [x] Patch simulator release so released scored opportunities satisfy Marketplace Workbench gates.
- [x] Patch workbench/matcher compatibility issues found by audit.
- [x] Add regression tests for simulator release visibility into Marketplace Workbench and downstream matching/assignment gates.

## Verify and ship
- [x] Run targeted lint/tests for touched files.
- [x] Run relevant marketplace/simulator regression tests.
- [x] Run type-check/full regression as appropriate and document known unrelated failures.
- [ ] Commit and push to dev only.

## Report
- [ ] Provide exact causes, files changed, QA results, and how to test the whole pipeline.
