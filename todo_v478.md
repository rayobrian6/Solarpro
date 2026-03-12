# v47.8 Bill Workflow Pipeline Bug Fix

## Root Causes Identified
1. `handleBillComplete` PUT body missing `city` from locationData
2. `updateProject()` does NOT persist `stateCode`, `city`, `utilityName`, `utilityRatePerKwh` as DB columns — only `bill_data` JSONB and `lat`/`lng`
3. `rowToProject()` reads `stateCode` from `bill_data._stateCode` ✓ — but `city` is NEVER stored anywhere (not in bill_data, not in columns)
4. `loadActiveProject()` uses store cache if project already in store — stale project won't have bill data after navigation
5. After `handleBillComplete` saves successfully, `updatedProject` merge is missing `city` entirely
6. The PUT API passes body directly to `updateProject(data)` — but `updateProject` only uses known fields. The JSONB bill_data must contain `_city` for rowToProject to read it back
7. `_city` is never stored in bill_data JSONB — `rowToProject` has no `city` hydration from bill_data

## Tasks
- [x] Read all relevant files (types, db-neon, route, store, page)
- [ ] Fix 1: Add `_city` to bill_data JSONB in handleBillComplete PUT body (page.tsx)
- [ ] Fix 2: Add `city` hydration to rowToProject() from bill_data._city (db-neon.ts)
- [ ] Fix 3: Fix updatedProject merge to include `city` (page.tsx)
- [ ] Fix 4: Force-refresh project from DB after bill save (bypass stale store cache)
- [ ] Fix 5: Add pipeline logging: BILL_PARSED, BILL_SAVED_TO_PROJECT, PROJECT_STATE_UPDATED, SYSTEM_SIZE_LOADED
- [ ] Fix 6: Add structured logging to SystemSizeTab for SYSTEM_SIZE_LOADED
- [ ] Fix 7: Ensure loadActiveProject always fetches fresh after bill save
- [ ] Update version to v47.8
- [ ] TypeScript build check
- [ ] Commit + push