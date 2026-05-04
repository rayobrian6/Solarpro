# SolarPro API Audit & Fix

## P0 Fixes (1166ms root causes)
- [ ] Fix `productions` JOIN — wrap in LATERAL LIMIT 1 in getProjectsByUser + getProjectsByClient
- [ ] Reduce BASE_DELAY_MS 300→50ms in db-ready.ts
- [ ] Add 60s role cache to requireAdminApi in adminAuth.ts
- [ ] Fix API latency thresholds in health dashboard (500→800 ok, 1500→2000 warning)
- [ ] Add maxDuration=30 to assistant route + other missing routes
- [ ] Add maxDuration to system-tools route + fix seed_utility_policies sequential loop
- [ ] Add migration 018 for site_aliases table, remove CREATE TABLE from runtime

## P1 Fixes
- [ ] Verify migration 017 and commit all changes to dev

## Completion
- [ ] Push all changes to origin/dev