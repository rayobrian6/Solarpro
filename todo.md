# Finalize Hang Investigation — Remaining Tasks

## Completed (Previous Session)
- [x] Instrument finalize route with per-stage logging markers: `[finalize:start]`, `[finalize:persist:start/end]`, `[finalize:labels:start/end]`, `[finalize:obstructions:start/end]`, `[finalize:classification:start/end]`, `[finalize:phase4a:start/end]`, `[finalize:store-result:start/end]`, `[finalize:complete]`, `[finalize:failed]`
- [x] Add stage timing with `Date.now()` and `durationMs` logging
- [x] Wrap every major stage with try/catch; fatal errors call `markFinalizationFailed()`
- [x] Add `withTimeout()` helper for Promise timeout wrapping
- [x] Add `FINALIZATION_OVERALL_TIMEOUT_MS = 55_000` hard limit
- [x] Add EXIF pre-warming budget cap (20% of aggregation budget, max 10s)
- [x] Add hard timeout at 2x AGGREGATION_BUDGET_MS in detection loop
- [x] Add MAX_VISION_CLASSIFICATION_PHOTOS=20 cap
- [x] Fix TypeScript compilation errors (duplicate identifiers, unused imports)
- [x] Commit locally: 253b724

## Push & Deploy
- [x] Fix GitHub authentication and push commit 253b724 to origin/dev
- [ ] Deploy to preview environment

## Validation
- [ ] Run finalize on existing completed job and verify:
  - All `[finalize:STAGE:start/end]` log markers appear in order
  - No stage hangs (each has timeout protection)
  - Finalization transitions `running → complete` or `running → failed`
  - Identify the exact stage that was previously hanging

## Reporting
- [ ] Report: last log reached, exact function hanging, stage duration, finalization transition result
