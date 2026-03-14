# Pipeline Verification System

## PHASE 0 — Audit Current State
- [ ] Read current syncPipeline implementation
- [ ] Read current client files tab in engineering page
- [ ] Read current project files API
- [ ] Read existing debug/project page
- [ ] Read engineering sync-pipeline route
- [ ] Identify root cause of pipeline failures

## PHASE 1 — Backend: Upgrade syncProjectPipeline
- [ ] Expand syncProjectPipeline to cover all 11 steps with structured logs
- [ ] Return full diagnostic PipelineResult with counts for every subsystem
- [ ] Add PIPELINE_MISMATCH detection and error codes
- [ ] Add all 8 structured log codes

## PHASE 2 — Backend: Debug Endpoint
- [ ] Create/upgrade /api/debug/project route
- [ ] Return layout summary, engineering summary, artifact registry, workflow state
- [ ] Add permit inputs summary

## PHASE 3 — Frontend: Pipeline Verification Panel in Client Files
- [ ] Add RUN PROJECT PIPELINE button to client files tab
- [ ] Add Pipeline Status Panel (layout / engineering / artifacts / permit / client files)
- [ ] Add mismatch error banners
- [ ] Add expandable raw data sections

## PHASE 4 — Workflow Tracker
- [ ] Verify v47.54 fix still correct
- [ ] Confirm engineering model existence check works

## PHASE 5 — Client Files Sync
- [ ] Audit current project-files fetch
- [ ] Fix any mapping issues

## PHASE 6 — Final
- [ ] TypeScript compile check
- [ ] Commit as v47.56
- [ ] Push to GitHub