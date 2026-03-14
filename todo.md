# SolarPro — Pipeline Verification (v47.49)

## PHASE 1 — Verify Deployment Version
- [x] Confirmed /api/version returns v47.49 ✅
- [x] Added fixed version badge to app/layout.tsx (bottom-left, all pages)

## PHASE 2 — Verify Authentication
- [x] Verified middleware.ts cookie name matches lib/auth.ts ('solarpro_session')
- [x] Verified /api/auth/me: JWT → DB lookup chain is correct
- [x] AUTH_COOKIE_MISSING is expected for unauthenticated requests (not a bug)

## PHASE 3 — Verify Layout Persistence
- [x] DB schema verified in code: panels + roof_planes columns exist in upsertLayout
- [x] rowToLayout() correctly maps roof_planes → roofPlanes
- [x] getProjectWithDetails() includes layout via rowToLayout
- [x] CRITICAL BUG FIXED (v47.48): restorePanels() now calls setRoofPlanes()
- [x] All 5 pipeline stages instrumented with console.log

## PHASE 4 — Verify Design Round-Trip
- [x] Save path: DesignStudio → POST /api/projects/[id]/layout → upsertLayout → DB
- [x] Restore path: GET /api/projects/[id]/layout → setPanels + setRoofPlanes (fixed)
- [ ] USER MUST TEST: Open Design Studio, place panels, save, reload, verify panels reappear

## PHASE 5 — Verify Permit Generator Uses Real Data
- [x] Engineering page: projectLayout state wired to permit payload (lines 7368-7392)
- [x] Permit route: [PERMIT INPUT] logging added to verify panelPositions + roofPlanes
- [ ] USER MUST TEST: Generate permit, check Vercel logs for [PERMIT INPUT] hasPanelPositions/hasRoofPlanes

## PHASE 6 — Debug Page ✅ DEPLOYED
- [x] Created app/debug/project/page.tsx — live at /debug/project
- [x] Created app/api/debug/layout/route.ts — queries DB directly
- [ ] USER MUST USE: Go to /debug/project, paste a project ID, verify layout in DB

## PHASE 7 — Commit + Deploy ✅
- [x] tsc --noEmit: 0 errors
- [x] npm run build: passes
- [x] Committed + pushed as v47.49 (bf64a0b)
- [x] Production confirmed on v47.49