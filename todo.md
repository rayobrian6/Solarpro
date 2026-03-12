# Utility Detection & Bill Persistence Fix

## AUDIT FINDINGS
- bill-upload route: parseBill extracts utilityProvider (e.g. "CENTRAL MAINE POWER CO.") but NEVER matches against DB utilities table
- No `bills` table exists — bill data stored only in projects.bill_data JSONB, lost on reload
- utility_policies table exists but has no `default_residential_rate` column — need to add it
- detectUtility() only does geo lookup, ignores parsed utility name from OCR
- system sizing uses getProductionFactor() from utility-rules.ts (state-based), not DB rate

## PART 1 — Utility Detection
- [x] Read all relevant files (bill-upload route, utilityDetector, utility-rules, db-neon, migrate, admin/utilities)
- [ ] Add `default_residential_rate` column to utility_policies migration
- [ ] Create `lib/utilityMatcher.ts` — normalizes name + fuzzy matches against DB + state fallback
- [ ] Update bill-upload route to call utilityMatcher after parseBill, use DB rate

## PART 2 — Bill Persistence  
- [ ] Add `bills` table migration to migrate route
- [ ] Add `saveBill()` and `getBillsByProject()` functions to db-neon.ts
- [ ] Update bill-upload route to save bill to DB when projectId provided
- [ ] Add GET /api/bills?projectId=... route
- [ ] Update BillUploadModal to pass projectId on save + fetch bills on project page

## PART 3 — System Sizing
- [ ] Verify system_size_kw uses annual_kwh from bill and utility rate from DB (already uses getProductionFactor — enhance to use DB rate)

## FINALIZE
- [ ] TypeScript compile check (zero errors)
- [ ] Bump version.ts
- [ ] Git commit + push