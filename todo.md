# Full System Audit & Pipeline Fix

## PHASE 1 — Audit All Subsystems
- [x] Read database schema (migrations, tables)
- [x] Read project API routes (get, save, update)
- [x] Read layout API routes (save, load)
- [x] Read engineering API routes + engineering page
- [x] Read permit generator route
- [x] Read workflow tracker
- [x] Read client files / artifact registry
- [x] Read SLD, BOM, structural routes
- [x] Read syncPipeline orchestrator (existing v47.52)
- [x] Read debug page (existing v47.52)

## PHASE 2 — Trace Critical Fields
- [x] Trace panelCount from design → permit (layout → syncPipeline → projectLayout state → permit input)
- [x] Trace systemSize from design → permit (layout.systemSizeKw → panels.length × 0.4)
- [x] Trace moduleModel/inverterModel (config.inverters → permit input)
- [x] Trace projectAddress (config.address → permit input)
- [x] Document where each field breaks (SYSTEM_AUDIT_v47.54.md)

## PHASE 3 — Source of Truth Decision
- [x] Document canonical source of truth (projectLayout.panels[])
- [x] Identify duplicate/competing models (engineeringSeed vs layout vs engineering_reports)

## PHASE 4 — Fix Pipeline Integration
- [x] syncProjectPipeline covers layout → snapshot → engineering report (confirmed)
- [x] save-outputs triggered by runCalc() → handleGeneratePermitPackage (confirmed)
- [x] Inline permit tab PDF/HTML buttons: acceptable (user already ran calc before)
- [ ] Verify layout-save webhook triggers sync correctly

## PHASE 5 — Remove Silent Default Fallbacks
- [x] Fix permit generator to block on ENGINEERING_MODEL_STALE (route guard added)
- [x] Remove 9.6 kW / 24 panel defaults from buildSLD() (changed to ?? 0)
- [x] Handle ENGINEERING_MODEL_STALE in engineering page UI (both PDF + HTML fetch blocks)

## PHASE 6 — Client Files & Artifact Registry
- [x] Audit artifact registry: save-outputs saves 5 files after runCalc()
- [x] Sheet count: permit generates 13 pages (TOTAL=13), cover sheet index lists 13 — CORRECT, no mismatch

## PHASE 7 — Workflow Tracker
- [x] Fix design step: check layout.panels.length > 0 (not just truthy layout)
- [x] Fix engineering step: check layout.panels.length > 0 OR status in [proposal/approved/installed]

## PHASE 8 — Auth (already fixed in v47.53)
- [x] response.cookies.set() fix
- [x] removed vercel.json /api override
- [x] removed router.refresh() race

## PHASE 9 — Diagnostics
- [ ] Verify debug page shows panelCount vs engineeringPanels mismatch correctly
- [ ] Verify build badge

## PHASE 10 — Tests
- [ ] Document test results

## Final
- [ ] Commit all fixes as v47.54
- [ ] Push to GitHub