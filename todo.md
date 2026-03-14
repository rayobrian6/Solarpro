# SolarPro v47.47 — Deployment Fix + Roof Plan Improvement

## Phase 1 — Fix Version + Verify Deployment
- [x] Confirm GitHub has v47.46 commits (b863325)
- [x] Confirm Vercel is auto-deploying from master branch (vercel.json confirmed)
- [x] Root cause found: lib/version.ts stuck at v47.44 (never bumped in v47.45/v47.46)
- [ ] Update lib/version.ts to v47.46 with correct feature list

## Phase 2 — Pipeline Audit (Step 5)
- [ ] Audit layout data flow: DesignStudio → DB → engineering page → permit API
- [ ] Verify layout.panels, layout.roofPlanes propagate to permit payload
- [ ] Check engineering page.tsx permit payload construction

## Phase 3 — Improve Roof Plan (Steps 6-7)
- [ ] Audit current pageRoofPlan() implementation
- [ ] Implement panel overlay using exact lat/lng from design engine
- [ ] Project panel coordinates to image pixel coordinates
- [ ] Label each roof face with tilt, azimuth, module count
- [ ] Derive roof face labels from layout.roofPlanes + layout.panels

## Phase 4 — Test + Deploy
- [ ] tsc --noEmit (0 errors)
- [ ] npm run build (all routes compile)
- [ ] Live permit test (verify roof plan renders with panels)
- [ ] Commit as v47.47
- [ ] Push to master → Vercel auto-deploy
- [ ] Verify production /api/version shows v47.47