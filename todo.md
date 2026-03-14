# v47.62 — Security Fixes + Pipeline Verification

## Status: IN PROGRESS

### Phase 1 — Verify Git State
- [ ] Check branch + latest commit
- [ ] Confirm 88ffdf4 exists locally
- [ ] Check if remote is ahead/behind
- [ ] Push if needed, confirm remote hash matches

### Phase 2 — Security Fixes
- [ ] Fix 1: Remove hardcoded Google Maps API key from app/api/debug/aerial/route.ts
- [ ] Fix 2: Add auth + ownership check to PUT /api/proposals/[id]
- [ ] Fix 3: Add session auth to POST /api/equipment/save, remove body userId
- [ ] Fix 4: Remove/restrict app/api/admin/reset-raymond/route.ts

### Phase 3 — Build Health
- [ ] tsc --noEmit → 0 errors
- [ ] npm run lint → 0 errors
- [ ] npm run build → success

### Phase 4 — Pipeline Flow Verification
- [ ] Read syncProjectPipeline in full
- [ ] Trace: layout load → engineering rebuild → buildAllArtifacts → project_files write → UI
- [ ] Identify any gaps in the pipeline flow

### Phase 5 — Pipeline Execution Logging
- [ ] Add PIPELINE_STAGE_START / PIPELINE_STAGE_COMPLETE / PIPELINE_STAGE_ERROR logs
- [ ] Include projectId in every log entry
- [ ] Cover all major stages in syncPipeline.ts and pipeline/run/route.ts

### Phase 6 — Final Report + Commit
- [ ] Update lib/version.ts to v47.62
- [ ] Commit all changes
- [ ] Push to origin/master
- [ ] Confirm remote hash matches local