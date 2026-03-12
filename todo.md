# v47.13 — Bill Upload Pipeline & Utility Rate Fixes

## Audit Phase
- [x] Audit utility rate logic (bill-upload route, utilityMatcher, utility-rules, utilityDetector)
- [x] Audit bill persistence pipeline (onboarding flow, BillUploadModal, project creation)
- [x] Audit downstream screen data loading (system-size, design, proposal pages)
- [x] Audit workflow badge logic

## Task 1 — Fix Utility Rate Logic
- [x] T1a: Audit utility-rules.ts — CMP retail_rate = $0.265 CORRECT
- [x] T1b: Audit utilityMatcher.ts — effectiveRate reads retail_rate CORRECT
- [x] T1c: Audit bill-upload/route.ts — rate selection logic CONFIRMED
- [x] T1d: Raise MIN_VALID_RETAIL_RATE from $0.06 to $0.10; add override when extracted < $0.10 and DB rate exists
- [x] T1e: Add structured logs: BILL_PARSE_COMPLETE, UTILITY_RATE_SELECTED, UTILITY_RATE_SOURCE

## Task 2 — Fix Bill Persistence Pipeline
- [x] T2a: Audit BillUploadModal — confirmed raw BillData sent (not _billAnalysis wrapper)
- [x] T2b: Audit POST /api/projects — accepts billData, passes to createProject CORRECT
- [x] T2c: Audit createProject/rowToProject — _billAnalysis wrapper format required for hydration
- [x] T2d: Fix BillUploadModal.handleCreateAll: wrap in _billAnalysis format; add _utilityRatePerKwh, _utilityName, _stateCode, _city
- [x] T2e: Add BILL_SAVED_TO_PROJECT / PROJECT_CREATED_FROM_BILL / PROJECT_RELOADED logs

## Task 3 — Fix Downstream Screen Data Source
- [x] T3a: Audit app/projects/[id]/page.tsx — reloads from DB on mount (loadActiveProject), T2d fix ensures correct hydration
- [x] T3b: Audit SystemSizeTab — reads project.billAnalysis and project.utilityRatePerKwh (correct, fixed by T2d)
- [x] T3c: No other screens found that ignore persisted bill data

## Task 4 — Workflow Badge Consistency
- [x] T4a: WORKFLOW_STEPS use p.billAnalysis as single source of truth — correct after T2d fix
- [x] T4b: billUploaded = !!p.billAnalysis, systemSized = !!(p.systemSizeKw || p.billAnalysis?.recommendedSystemKw) — correct

## Task 5 — Version + Build
- [ ] Update version to v47.13
- [ ] TypeScript build check (tsc --noEmit)
- [ ] Commit and push