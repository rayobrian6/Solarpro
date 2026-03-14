# v47.60 Full System Audit — Todo

## Phase 1 — Static Analysis ✅
- [x] tsc --noEmit = 0 errors
- [x] ESLint configured (.eslintrc.json) — 0 errors
- [x] Remove stray eslint-disable comments for missing TS-ESLint plugin

## Phase 2 — Dependency Audit ✅
- [x] npm audit baseline — found 9 vulns in next@14.2.3
- [x] Upgrade next → 14.2.35 (security patch)
- [x] jspdf: CRITICAL ReDoS — upgraded to 4.2.0 (API compatible, browser-only usage)
- [x] npm audit fix — fixed minimatch ReDoS in @typescript-eslint (devDep)
- [x] Remaining 4 HIGH: next (2x DoS, needs v16) + glob in eslint-config-next (devDep) — ACCEPTED RISK, documented
- [x] tsc --noEmit after upgrades = 0 errors
- [x] ESLint after upgrades = 0 errors

## Phase 3 — Auth Flow Audit 🔄
- [ ] Trace login → JWT sign → cookie set flow (api/auth/login)
- [ ] Trace /api/auth/me cookie verify flow
- [ ] Audit middleware.ts — which routes are protected, which are public
- [ ] Verify dev-auth bypass uses VERCEL_ENV guard (v47.59 fix)
- [ ] Confirm cookie attributes: httpOnly, secure, sameSite, path, maxAge

## Phase 4 — Database Audit
- [ ] Audit schema.sql — all tables, columns, constraints
- [ ] Verify all DB queries use correct column names (no stale field refs)
- [ ] Check upsert conflict targets match actual UNIQUE constraints
- [ ] Audit project_files table schema vs upsertFile() usage
- [ ] Verify connection pool / neon config

## Phase 5 — API Route Verification
- [ ] Audit every route under /api — method guards, auth checks, error handling
- [ ] Verify all routes return proper status codes
- [ ] Check all routes validate required inputs
- [ ] Confirm pipeline/run route BP-3 fix is wired correctly

## Phase 6 — Pipeline Logic Audit
- [ ] Trace full pipeline execution path (steps 1-10)
- [ ] Verify buildAllArtifacts() produces real content
- [ ] Confirm upsertFile() calls succeed and write to DB
- [ ] Check step ordering and dependencies

## Phase 7 — Logging Audit
- [ ] Confirm requestId/projectId present in all critical log paths
- [ ] Check for missing error context in catch blocks
- [ ] Verify pipeline step logs are consistent

## Phase 8 — System Testing
- [ ] Static verification: login flow
- [ ] Static verification: project creation
- [ ] Static verification: pipeline execution
- [ ] Static verification: artifact generation

## Final
- [ ] tsc --noEmit = 0 errors (final check)
- [ ] Bump version to v47.60 in lib/version.ts
- [ ] Commit and push