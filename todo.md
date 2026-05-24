# Geometry Trust Operations Infrastructure Todo

## Completed Baseline Merge
- [x] Merge geometry-intelligence-v1 into dev before beginning replay/review work
- [x] Preserve Geometry Intelligence V1 deterministic read-only scoring and operator summary behavior

## Geometry Corpus Replay Framework
- [x] Add deterministic replay framework for parser, canonical geometry, readiness, OSS comparison, geometry intelligence, and review recommendation execution
- [x] Add replay-safe item and corpus report DTOs
- [x] Normalize replay timing noise so replay hashes remain stable
- [x] Add confidence distributions, discrepancy distributions, topology degradation summaries, recurring risk summaries, readiness downgrade frequency, and integrity trend analysis

## Human Review Workflow Foundation
- [x] Add review lifecycle primitives: review_not_recommended, review_recommended, review_required, blocker_review
- [x] Add deterministic review priority and queue classification utilities
- [x] Add explainable review reasons, recommended actions, topology investigation recommendations, and queue summaries
- [x] Preserve no automatic approval, no auto-correction, no persistence, no CAD mutation, and no readiness promotion boundaries

## Trust Calibration and Operational Insight Reporting
- [x] Add trust calibration report focused on explainability and consistency rather than automation
- [x] Add compact operational insight report for confidence distributions, recurring risk categories, review queues, topology instability, discrepancy hot spots, and urgency patterns
- [x] Generate replay intelligence, review workflow, trust calibration, operational insight, and replay summary artifacts from fixture replay

## Validation and Delivery
- [x] Run type-check clean
- [x] Run parser/readiness/fixture/adapter/intelligence/replay tests
- [x] Verify deterministic outputs and no-authority boundaries in tests
- [x] Commit changes directly on dev
- [ ] Push dev using token-authenticated remote syntax
- [ ] Provide final summary with replay findings, instability findings, trust calibration observations, review workflow maturity, CAD-authority outlook, leverage gained, and complexity avoided
