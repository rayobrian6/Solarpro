# v47.5 Fix Plan

## Root Causes Found

### Bug 1: handleUploadBill navigates to non-existent route
- `handleUploadBill` does `router.push('/projects/${id}/upload-bill')` → 404
- Should open a modal inline (or use BillUploadFlow embedded in BillTab)

### Bug 2: BillUploadFlow.onComplete does nothing with projectId
- `BillUploadFlow` fires `onComplete(result)` but project page doesn't handle it
- The project page never calls `updateProject` / `PUT /api/projects/[id]`
- No `billAnalysis` is ever set on the project record

### Bug 3: updateProject in db-neon doesn't update bill_data / billAnalysis columns
- `updateProject` SQL only updates: name, client_id, status, system_type, notes, address, lat, lng, system_size_kw
- Does NOT persist `bill_data`, `utility_name`, `utility_rate_per_kwh`, `state_code`

### Bug 4: getProjectWithDetails doesn't populate billAnalysis
- rowToProject only maps `bill_data` raw, never constructs `BillAnalysis` object
- `Project.billAnalysis` is never set → workflow check `!!p.billAnalysis` always false

### Bug 5: Version badge stale at v47.2

## Tasks

- [ ] 1. Fix `updateProject` in db-neon.ts to persist bill_data, system_size_kw, utility fields
- [ ] 2. Fix `rowToProject`/`getProjectWithDetails` to hydrate `billAnalysis` from `bill_data`
- [ ] 3. Fix `project/[id]/page.tsx` handleUploadBill to open inline modal + handle onComplete → persist
- [ ] 4. Add new API route `/api/projects/[id]/bill` for atomic bill save + project update
- [ ] 5. Update version badge to v47.5
- [ ] 6. TypeScript check + commit