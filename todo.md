# v47.26 — ToS/NDA Integration

## Phase 1 — Database Migration
- [ ] Add tos_accepted_at (TIMESTAMPTZ) and tos_version (TEXT) columns to users table
- [ ] Create migration file in migrations/
- [ ] Run migration against production DB via migration script

## Phase 2 — API Endpoint
- [ ] Create /api/tos-accept/route.ts — POST: record acceptance, GET: check status
- [ ] Add runtime='nodejs', dynamic='force-dynamic', maxDuration=30
- [ ] JWT auth required, update users SET tos_accepted_at=NOW(), tos_version='v1.0'

## Phase 3 — /terms Page Route
- [ ] Create app/terms/page.tsx — serves the ToS content inline
- [ ] Add accept button at bottom that calls /api/tos-accept then redirects to /dashboard
- [ ] Handle already-accepted state (show accepted badge, no button)

## Phase 4 — Signup Page Integration
- [ ] Find the register/signup page component
- [ ] Add ToS checkbox: "I have read and agree to the Terms of Service and Confidentiality Agreement"
- [ ] Block form submission if checkbox not checked
- [ ] On signup, set tos_accepted_at=NOW() and tos_version='v1.0' in the users INSERT

## Phase 5 — Login Gate (redirect unaccepted users)
- [ ] After successful login, check tos_accepted_at IS NULL
- [ ] If NULL, redirect to /terms?required=1 with banner
- [ ] middleware.ts: protect /dashboard and /projects — redirect to /terms if not accepted

## Phase 6 — Version bump + commit
- [ ] Bump lib/version.ts to v47.26
- [ ] TypeScript check (tsc --noEmit)
- [ ] Run tests (vitest)
- [ ] git add -A && git commit && git push