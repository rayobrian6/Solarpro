# v47.26 — ToS/NDA Integration (COMPLETE ✅)

## Phase 1 — Database Migration (COMPLETE ✅)
- [x] Add tos_accepted_at (TIMESTAMPTZ) and tos_version (TEXT) columns to users table
- [x] Created lib/migrations/010_tos_acceptance.sql
- [x] Migration blocks added to /api/migrate route (idempotent ALTER TABLE + index)

## Phase 2 — API Endpoint (COMPLETE ✅)
- [x] Created /api/tos-accept/route.ts — POST records acceptance, GET returns status
- [x] runtime='nodejs', dynamic='force-dynamic', maxDuration=30
- [x] JWT auth required, UPDATE users SET tos_accepted_at=NOW(), tos_version='v1.0'
- [x] GET returns: accepted, needs_reaccept, tos_accepted_at, tos_version, current_version

## Phase 3 — /terms Page Route (COMPLETE ✅)
- [x] Created app/terms/page.tsx — full 14-section ToS/NDA text inline
- [x] Accept button calls /api/tos-accept then redirects to /dashboard (or ?redirect=)
- [x] Already-accepted state shows green badge + timestamp, no duplicate button
- [x] /terms?required=1 shows amber warning banner

## Phase 4 — Signup Page Integration (COMPLETE ✅)
- [x] Register page ToS checkbox now links to /terms (opens in new tab)
- [x] Text updated: "I have read and agree to the Terms of Service & Confidentiality Agreement"
- [x] tosAccepted flag passed to /api/auth/register
- [x] Register API records tos_accepted_at=NOW() and tos_version='v1.0' on INSERT

## Phase 5 — Login Gate (COMPLETE ✅)
- [x] Login API fetches tos_accepted_at from DB, returns tos_redirect hint if NULL
- [x] Login page follows tos_redirect before navigating to dashboard
- [x] middleware.ts: /terms and /api/tos-accept added to PUBLIC_PATHS

## Phase 6 — Version bump + commit (COMPLETE ✅)
- [x] lib/version.ts bumped to v47.26
- [x] TypeScript: 0 errors (tsc --noEmit clean)
- [x] Committed 7314ad0, pushed to master — Vercel deploying v47.26