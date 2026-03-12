# SolarPro v47.6 — Critical Production Stability Audit & Fix

## Audit Findings

### ✅ HARDENED (no action needed)
- [x] lib/db-ready.ts — retry logic, isTransientDbError, DbConfigError, MAX_RETRIES=3
- [x] app/api/auth/me/route.ts — getDbReady(), 401-only-logout, fallback query
- [x] app/api/auth/login/route.ts — getDbReady(), DB_STARTING 503, Retry-After header
- [x] app/api/auth/register/route.ts — getDbReady()
- [x] contexts/UserContext.tsx — ME_MAX_RETRIES=10, FetchStatus, preserve-on-503, 401-only-logout
- [x] lib/auth.ts — makeSessionCookie Secure+SameSite=Lax, lazy getJwtSecret(), 30d expiry
- [x] app/auth/login/page.tsx — DB_STARTING banner, auto-retry x5, countdown display
- [x] next.config.js — generateBuildId unique, no-cache headers
- [x] vercel.json — no-cache headers on all routes, immutable on static assets

### 🔴 CRITICAL BUGS FOUND

#### Bug 1: ALL non-auth API routes use getDb() — zero cold-start resilience
- lib/db-neon.ts: ALL exported functions (getProjectsByUser, getProjectById, updateProject,
  getClientsByUser, getLayoutByProject, upsertLayout, etc.) call getDb() synchronously
- This means ANY project/client/proposal/engineering API call during Neon cold-start
  throws DbConfigError("DATABASE_URL is not set") OR connection refused immediately
- No retry, no backoff, no DB_STARTING response — just a raw 500 error
- 50+ call sites across app/api/ all affected

#### Bug 2: getDb() in db-neon.ts creates a NEW neon() instance on EVERY call
- Each function call creates a brand new neon(url) HTTP connection
- No connection reuse, no warm-up benefit
- Should create neon() once at module level (singleton)

#### Fix plan:
- [x] Audit complete
- [ ] Fix db-neon.ts: replace all getDb() calls → use module-level singleton + getDbReady() for the main exported functions
- [ ] Add standardized handleDbError() to non-auth API routes OR fix at db-neon.ts level
- [ ] Update version to v47.6

## Implementation Plan
1. Fix lib/db-neon.ts to use getDbReady() as the singleton getter (lazy init with retry)
2. Add DB_STARTING aware error handling to the projects/clients routes
3. Update version