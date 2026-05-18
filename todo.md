# Intelligence Producer Audit Fixes — Hardening Only

## 1. Stable Idempotency
- [x] Add stable replay boundary / snapshot hash helpers
- [x] Remove wall-clock observedAt as primary lifecycle idempotency component
- [x] Add tests proving repeated runs produce identical keys

## 2. Centralized Confidence
- [x] Add shared confidence helper utilities
- [x] Apply confidence helpers across producers
- [x] Add confidence bounds tests for all producers

## 3. Classifier Secondary Matches
- [x] Replace single-match classifier internals with primary + secondary match metadata
- [x] Preserve primary observation types
- [x] Add secondary_matches / matched_patterns / classification_notes to payload/derivation
- [x] Add ambiguous multi-signal tests

## 4. Test Hardening
- [x] Repeated-run idempotency stability
- [x] Lifecycle replay with omitted observed_at
- [x] Invalid client/homeowner attachment input
- [x] Producer module has no DB writer/import side effects
- [x] No homeowner entity type leakage
- [x] Producers remain observation-only / no lifecycle mutation

## 5. Documentation Alignment
- [x] Update docs to state repeated-pattern aggregation is future work

## 6. QA + Commit
- [x] Run targeted vitest command
- [x] Run targeted TypeScript check
- [x] Run targeted ESLint check
- [x] Commit and push dev only
