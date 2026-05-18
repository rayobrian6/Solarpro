# Intelligence Producer Orchestration Foundation

## 1. Foundation Types
- [x] Add deterministic execution context helpers
- [x] Add scoped replay boundary helpers
- [x] Add producer registry metadata and lookup

## 2. Runner Infrastructure
- [x] Add lib/intelligence/runner.ts
- [x] Support dry-run execution with zero writes
- [x] Support single and multi-producer execution
- [x] Support entity scope and replay-window context
- [x] Add idempotent observation writer integration
- [x] Add structured execution summaries
- [x] Isolate producer failures

## 3. Tests
- [x] Dry-run performs zero writes
- [x] Replay produces stable idempotency
- [x] Duplicate observations are skipped
- [x] Producer failures do not halt unrelated producers
- [x] Deterministic execution context works
- [x] No canonical lifecycle mutation / duplicate event system
- [x] Observation writes remain append-only

## 4. QA + Commit
- [x] Run targeted orchestration tests
- [x] Run targeted TypeScript check
- [x] Run targeted ESLint check
- [x] Commit and push dev only
