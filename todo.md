# Manual Admin-Safe Intelligence Runner Endpoint

## Build
- [x] Add POST /api/admin/network/intelligence/runner
- [x] Validate producer_names and bounded scope
- [x] Enforce replay window max 31 days
- [x] Default dry_run=true
- [x] Restrict write mode to super_admin
- [x] Use runIntelligenceProducers + NeonObservationWriter only
- [x] Return bounded summary + preview
- [x] Log non-dry-run admin action

## Tests + QA
- [x] Add route tests for validation/auth/summary behavior
- [x] Run targeted vitest
- [x] Run targeted TypeScript and ESLint
- [x] Commit and push dev only
