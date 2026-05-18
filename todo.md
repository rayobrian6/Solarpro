# Intelligence Orchestration Audit Fixes — Hardening Only

## 1. Runner Idempotency Enforcement
- [x] Require idempotency_key in runner validation path
- [x] Count missing idempotency as validation failure
- [x] Ensure missing idempotency is never written

## 2. Writer Collision Reporting
- [x] Update observation writer contract to report inserted/skipped_existing/failed
- [x] Update NeonObservationWriter behavior without mutating existing observations
- [x] Update runner summary counts for DB-level collisions

## 3. Registry Entity Enforcement
- [x] Validate producer observations against registry supported_entity_types
- [x] Reject mismatches as validation failures
- [x] Add summary detail for mismatch

## 4. Structured Missing Writer Failure
- [x] Return structured write failure when dry_run=false and writer missing
- [x] Do not throw uncontrolled error

## 5. Tests
- [x] Unknown producer safety
- [x] Invalid observation validation through runner
- [x] Missing idempotency rejection dry-run and non-dry-run
- [x] Writer failure isolation
- [x] Registry entity enforcement
- [x] Non-dry-run without writer structured failure
- [x] DB-level idempotent collision reporting
- [x] Dry-run still zero writes

## 6. QA + Commit
- [x] Run targeted vitest command
- [x] Run targeted TypeScript check
- [x] Run targeted ESLint check
- [x] Commit and push dev only
