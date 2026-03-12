# v47.8 Bill Workflow Pipeline Bug Fix — COMPLETE

## Root Causes Identified
1. `handleBillComplete` PUT body stored `_stateCode` in bill_data JSONB but never `_city` → Location field always showed "Not set"
2. `rowToProject()` hydrated stateCode/utilityName/utilityRatePerKwh from bill_data JSONB but had no `city` hydration path → city lost on every DB round-trip
3. `updatedProject` merge included stateCode override but completely omitted `city` → city lost immediately after modal closed
4. `getProjectWithDetails()` inline hydration block also lacked `city` hydration
5. Store cache returned stale project on navigation (loadActiveProject returns cached entry) → bill data appeared missing if store not updated after save

## Tasks
- [x] Read all relevant files (types, db-neon, route, store, page)
- [x] Fix 1: Add `_city` to bill_data JSONB in handleBillComplete PUT body (page.tsx)
- [x] Fix 2: Add `city` hydration to rowToProject() from bill_data._city (db-neon.ts)
- [x] Fix 3: Fix updatedProject merge to include `city` (page.tsx)
- [x] Fix 4: Force-refresh project from DB after bill save (syncProjectToStore added)
- [x] Fix 5: Add pipeline logging: BILL_PARSED, BILL_SAVED_TO_PROJECT, PROJECT_STATE_UPDATED, SYSTEM_SIZE_LOADED
- [x] Fix 6: Add structured logging to SystemSizeTab for SYSTEM_SIZE_LOADED
- [x] Fix 7: Added syncProjectToStore action to keep store cache warm after bill save
- [x] Update version to v47.8
- [x] TypeScript build check (0 errors)
- [x] Commit + push (4e559d2)