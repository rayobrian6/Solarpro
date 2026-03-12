# v47.5 Fix Plan

## Root Causes Fixed

### Bug 1: handleUploadBill navigated to non-existent route ✅
- Was: `router.push('/projects/${id}/upload-bill')` → 404
- Fix: `setShowBillModal(true)` — opens inline `BillUploadFlow` modal

### Bug 2: BillUploadFlow.onComplete was never handled ✅
- Was: `onComplete` prop not passed, bill data discarded after parsing
- Fix: `handleBillComplete()` builds typed `BillAnalysis`, calls `PUT /api/projects/[id]`, 
       updates `setProject()`, auto-advances to System Size tab

### Bug 3: updateProject() didn't persist bill_data ✅
- Was: SQL only updated name/status/address/lat/lng/system_size_kw
- Fix: Two-branch SQL with/without `bill_data::jsonb` — preserves existing if not in update

### Bug 4: rowToProject() never hydrated billAnalysis ✅
- Was: `bill_data` raw field only, `billAnalysis` always undefined → workflow check failed
- Fix: Reads `bill_data._billAnalysis` (new format) + legacy flat format
       Also hydrates `utilityName`, `utilityRatePerKwh`, `stateCode`

### Bug 5: getProjectWithDetails() same hydration gap ✅
- Fix: Same `_billAnalysis` hydration in the detail query return object

### Bug 6: Version badge stale ✅
- Was: v46.5 (even older than summary said)
- Fix: v47.5 with full feature history preserved

## Tasks

- [x] 1. Fix `updateProject` in db-neon.ts to persist bill_data
- [x] 2. Fix `rowToProject`/`getProjectWithDetails` to hydrate `billAnalysis` from `bill_data`
- [x] 3. Fix `project/[id]/page.tsx` handleUploadBill to open inline modal + handle onComplete → persist
- [x] 4. Pipeline logging: BILL_PARSED, BILL_SAVING, BILL_SAVED, WORKFLOW_UPDATED, PROJECT_REFRESHED
- [x] 5. Update version badge to v47.5
- [x] 6. TypeScript check: 0 errors
- [x] 7. Commit + push to origin/master (14c71aa)