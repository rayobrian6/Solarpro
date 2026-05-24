# Isolated Geometry OSS Adapter Spike Todo

## Scope and Safety
- [x] Confirm adapter spike remains read-only, comparison-only, non-authoritative, and isolated
- [x] Inspect repository state, package surface, parser geometry logic, and existing fixtures/tests

## Adapter Implementation
- [x] Add isolated polygon-clipping dependency and geometry adapter boundary
- [x] Implement comparison-only geometry cross-check report service with discrepancy categories and no-authority flags
- [x] Ensure adapter output never mutates canonical geometry, CAD preview outputs, parser readiness, or persistence

## Geometry Stress Fixtures and Tests
- [x] Add expanded geometry torture fixtures for overlap, malformed obstruction, invalid orientation, duplicated edges, and corrupted payloads
- [x] Add adapter/report tests for overlap, intersection, self-intersection comparison, duplicate edges, clipping comparison, determinism, no mutation, and no authority promotion
- [x] Verify parser/readiness/expanded fixture tests remain stable

## Evaluation Reports
- [x] Produce adapter evaluation report with performance, bundle/package impact, TypeScript compatibility, determinism, maintainability, and isolation review
- [x] Produce native-vs-OSS comparison report with improvements, false positives, false negatives, and recommendation
- [x] Produce future adapter recommendation report

## Validation and Delivery
- [x] Run parser/readiness/fixture/adapter tests
- [x] Run type-check clean
- [x] Commit changes
- [x] Push according to active repository workflow
- [x] Summarize improvements, false positives, keep/expand recommendation, and native authority status
