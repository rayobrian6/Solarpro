# v47.9 — Definitive Deployment Startup Fix

## Root Cause Analysis

### The Core Problem (NOT what was fixed before)
The existing getDbWithRetry() (3 retries, 1s/2s/4s = 7s) IS correctly implemented.
The existing UserContext retry (10 retries, preserve-on-503) IS correctly implemented.
The existing handleRouteDbError IS correctly implemented.

### What IS actually wrong — 4 confirmed issues:

**ISSUE 1: getDbWithRetry() calls neon(url) THEN probes SELECT 1**
`neon(url)` creates a new HTTP client object on EVERY call to getDbReady().
This is fine for Neon HTTP driver. But the probe SELECT 1 uses the SAME executor for both
the probe and the real query — so if the probe SUCCEEDS the node is warm.
However: the probe SELECT 1 IS a round-trip — 500ms-3s on cold start.
With 3 retries: max wait = 1000 + 2000 + 4000 = 7s PLUS the actual query time.
On Vercel Hobby plan, default function timeout = 10s.
7s retries + 500ms per probe x 3 = ~9s minimum. This races with the 10s timeout.
AUTH ROUTES HAVE NO maxDuration SET — they default to 10s on Hobby, which is too tight.

**ISSUE 2: No module-level Neon client singleton**
Every request to getDbReady() calls getDatabaseUrl() → neon(url) → probes SELECT 1.
On Vercel, modules ARE cached between warm invocations of the same function instance.
A module-level singleton means neon(url) is called ONCE per function instance cold start,
not once per request. This reduces overhead on warm paths.
More critically: a module-level singleton with a cached "warm" flag avoids re-probing
on every /api/auth/me call (which fires on every page focus/visibility change).

**ISSUE 3: getDbWithRetry() MAX_RETRIES=3 with 1+2+4s delays**  
On a Vercel Hobby function (10s timeout), after 3 failed probes:
- attempt 0: probe fails → sleep 1s
- attempt 1: probe fails → sleep 2s  
- attempt 2: probe fails → sleep 4s
- attempt 3: probe runs → if fails, throws
Total: ~7s+ in retries. The throw happens at ~7s. Vercel kills at 10s.
The remaining ~3s is barely enough for the actual query.
WORSE: /api/auth/me calls getDbReady() which retries internally (7s), THEN runs the
user query. If the probe barely succeeds on attempt 3 (at 7s), the user query might
timeout Vercel's 10s limit, causing a 504 — NOT a 503 DB_STARTING.
UserContext doesn't retry on 504. The user gets logged out.

**ISSUE 4: Missing maxDuration on auth routes**
/api/auth/login has no maxDuration export.
/api/auth/me has no maxDuration export.
Default on Vercel Pro = 60s. On Vercel Hobby = 10s.
With 3-retry DB probe (up to 7s) + query time, Hobby plan users hit 504 timeouts
that UserContext treats as transient (retry), but the response body is empty (Vercel
504), so res.json() fails, catch block returns {status:'retry'}, which IS handled.
BUT the 504 may come BEFORE the retry delay, causing rapid retry loops.

### THE REAL ROOT CAUSE THAT CAUSES "Database not configured":
The `debug-login/route.ts` calls `import('@neondatabase/serverless')` directly with
process.env.DATABASE_URL. This is fine. But the REAL login route uses getDbReady()
which calls getDatabaseUrl() which checks DATABASE_URL.

ON VERCEL: DATABASE_URL is injected as an environment variable at deployment time.
It IS available at runtime (not missing). The issue is NOT a missing env var.

THE ACTUAL ISSUE: neon() creates a new HTTP client per request. The Neon HTTP driver
for @neondatabase/serverless 0.10.x uses fetch() under the hood. On Vercel Edge/Node
serverless cold starts, the first fetch() to Neon can fail with connection errors that
get mis-classified somewhere in the chain.

THE SMOKING GUN: In `lib/auth.ts` line 47:
```
console.log('DATABASE_URL loaded:', !!url);
```
This `getDb()` in auth.ts is the SYNCHRONOUS version that throws DbConfigError.
It's called from... where? Let me check.

Actually — the real issue requires tracing ALL imports. Let me check what imports getDb()
from auth.ts vs getDbReady().

## Tasks
- [x] Read all files — complete analysis done
- [ ] Add maxDuration=30 to auth routes (login, me, register)
- [ ] Implement module-level Neon singleton in db-ready.ts (cached per function instance)
- [ ] Add warm-cache flag to skip re-probe on warm paths
- [ ] Increase MAX_RETRIES from 3 to 5 for auth routes
- [ ] Add ENV_DATABASE_URL_STATUS, DB_CLIENT_INIT, SERVER_INSTANCE_STARTED logging
- [ ] Add AUTH_LOGIN_REQUEST, AUTH_SESSION_CHECK diagnostic logging
- [ ] Add DB_CONNECTION_ATTEMPT, DB_CONNECTION_SUCCESS, DB_CONNECTION_FAILED logging  
- [ ] Verify no module-level code calls getDb() at import time (would fail at build)
- [ ] Update version to v47.9
- [ ] TypeScript build check
- [ ] Commit + push