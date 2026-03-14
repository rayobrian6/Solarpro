# SolarPro — Pipeline Verification (NO FEATURE WORK)

## PHASE 1 — Verify Deployment Version
- [ ] Confirm /api/version returns v47.48
- [ ] Add visible version indicator to UI footer

## PHASE 2 — Verify Authentication
- [ ] Check auth middleware for AUTH_COOKIE_MISSING errors
- [ ] Verify /api/auth/me route exists and returns user session
- [ ] Fix session cookie handling if broken

## PHASE 3 — Verify Layout Persistence
- [ ] Confirm DB schema has layout columns (panels, roof_planes)
- [ ] Write direct DB query test to verify layout is stored after save
- [ ] Confirm getProjectWithDetails returns layout with panels + roofPlanes

## PHASE 4 — Verify Design Round-Trip
- [ ] Check DesignStudio save + restore pipeline end-to-end in code

## PHASE 5 — Verify Permit Generator Uses Real Data
- [ ] Trace permit input — confirm panelPositions flows from projectLayout

## PHASE 6 — Add /debug/project page
- [ ] Create app/debug/project/page.tsx showing full project JSON
- [ ] Show: project.layout panels count, roofPlanes count, system data

## PHASE 7 — Commit + Deploy
- [ ] tsc --noEmit: 0 errors
- [ ] npm run build: passes
- [ ] Commit + push