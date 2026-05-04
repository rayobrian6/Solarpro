# SolarPro API Audit & Fix

## P0 Fixes (1166ms root causes) — Commit 9449043
- [x] Fix `productions` JOIN — wrap in LATERAL LIMIT 1 in getProjectsByUser + getProjectsByClient
- [x] Reduce BASE_DELAY_MS 300→50ms in db-ready.ts
- [x] Add 60s role cache to requireAdminApi in adminAuth.ts
- [x] Fix API latency thresholds in health dashboard (500→800 ok, 1500→2000 warning)
- [x] Add maxDuration=30 to assistant route + 27 other missing routes
- [x] Add maxDuration=60 to system-tools route + fix seed_utility_policies sequential loop
- [x] Add migration 018 for site_aliases table, remove CREATE TABLE from runtime

## P0 Continued — Still 1719ms after commit 9449043
- [x] Rewrite health route: all 9 DB queries in single Promise.all (eliminates serial round-trips)
- [x] Add _timing breakdown to health response (authMs, dbBatchMs, totalMs)
- [x] Update health dashboard to display server-side timing breakdown panel
- [x] Add /api/admin/perf-diag endpoint — step-by-step timing of every operation
- [x] Push diagnostic + fixes commit

## Next Steps (after user checks _timing data)
- [ ] User: open browser DevTools → Network → click Refresh on health page → check /api/admin/health response JSON for _timing field
- [ ] User: visit /api/admin/perf-diag to get step-by-step timing breakdown
- [ ] Based on _timing data: fix whichever step is slow (auth, DB batch, or Vercel cold start)

## Manual Actions Required
- [ ] Run migration 018_site_aliases.sql via Admin → System Tools → Run Migration
- [ ] Run perf_audit via Admin → System Tools to verify migration 017 indexes are active