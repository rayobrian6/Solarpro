# Pricing Sync + All Other Fixes — COMPLETE

## Phase 1: Pricing Sync (Higher Prices = Source of Truth) ✅
- [x] Updated subscribe page to $79/$149/$249 (match landing page)
- [x] Fixed plan names: Starter / Professional / Contractor everywhere
- [x] Changed 14-day → 3-day trial on subscribe page
- [x] Updated subscribe page FAQ trial answer
- [x] Updated subscribe page features to match landing page features

## Phase 2: Landing Page Remaining Fixes ✅
- [x] Utility count updated: "19 utilities including 8 major utilities"
- [x] 3-day trial confirmed on landing page (3 locations)

## Phase 3: Database Migration ✅
- [x] Migration 006 created with users table + subscription/trial/white-label columns
- [x] Free-pass SQL for: raymond.obrian, james, cody, ang (LMD Solar), utsmarketing
- [x] Plan names updated to contractor (not business)

## Phase 4: White Label Settings Page ✅
- [x] Created app/settings/page.tsx with logo upload + branding + subscription tabs
- [x] Created app/api/settings/profile/route.ts
- [x] Created app/api/settings/branding/route.ts (GET + PUT)
- [x] Created app/api/settings/logo/route.ts (POST + DELETE)
- [x] Updated app/api/auth/me/route.ts to return branding/subscription fields
- [x] Wired company logo + colors into proposal preview header + footer
- [x] Added Settings link to AppShell nav

## Phase 5: Zip & Deliver ✅
- [x] Build: 0 errors, all routes verified
- [x] Created solar-calculator-v27.3.zip (7MB)