# Deployment Startup Root Cause Analysis — v47.9

## Summary
The "Database not configured" error after every Vercel deployment has FIVE compounding root causes.
Previous patches addressed some symptoms but not all causes. This document captures the definitive analysis.

## Root Cause 1: channel_binding=require in DATABASE_URL (CRITICAL)
The DATABASE_URL contains `channel_binding=require`. This forces the Neon HTTP driver to use
SCRAM-SHA-256-PLUS channel binding during SSL handshake. Not all Neon proxy endpoints support this.
During a cold start, when the Neon compute node is waking up, the proxy may not yet have a stable
SSL context, causing the channel binding handshake to fail with errors that look like:
  "SSL connection error" / "SCRAM authentication failed" / "channel binding required"
These errors are NOT caught as transient by isTransientDbError() and may propagate as non-retryable,
producing "Database not configured" even though DATABASE_URL is correct.

FIX: Change channel_binding=require to channel_binding=disable in DATABASE_URL.

## Root Cause 2: Retry delays too aggressive for Vercel Hobby (10s default timeout)
getDbWithRetry() retries 3x with delays: 1000ms + 2000ms + 4000ms = 7000ms of sleeping.
Each probe attempt takes 200ms (warm) to 3000ms (cold) for the SELECT 1 round-trip.
On cold start: 3 probes x 3000ms = 9000ms + 7000ms delays = 16 seconds total.
Vercel Hobby default timeout = 10 seconds → guaranteed 504 before retries complete.
Even on Pro (60s timeout), the 7s delay means auth routes are slow on cold start.
UserContext gets 504 (not 503) → caught as 'retry' but with no Retry-After header.

FIX: Reduce auth route delays to 300ms/600ms/1200ms and add maxDuration=30 to auth routes.

## Root Cause 3: No module-level Neon client singleton
neon(url) is called on EVERY getDbReady() invocation (every /api/auth/me request).
/api/auth/me is called on: mount, focus, tab-visibility, every 5 minutes.
Each call creates a new HTTP client object, reads process.env.DATABASE_URL again,
and runs a SELECT 1 probe. On warm paths, this SELECT 1 probe is redundant overhead.

FIX: Cache neon(url) at module level (singleton per function instance).
     Cache "warm" flag so SELECT 1 probe is skipped on subsequent calls to same instance.

## Root Cause 4: Missing maxDuration on auth routes
/api/auth/login and /api/auth/me have no maxDuration export.
On Vercel Hobby: 10s timeout — too short for 3-retry DB probe (7s+).
On Vercel Pro: 60s timeout — fine, but wasteful.
Without maxDuration, Vercel can kill the function while retries are in progress,
producing a 504 GATEWAY_TIMEOUT with empty body that UserContext parses incorrectly.

FIX: Add maxDuration=30 to login and me routes.

## Root Cause 5: engineering-automation.ts uses synchronous getDb() from auth.ts
lib/engineering-automation.ts imports getDb from './auth' (synchronous, no retry).
This was missed in the v47.6 audit. Engineering routes (auto-configure, override, assist, slg)
use the non-retryable DB getter. While these aren't auth routes, a cold-start DB failure
here returns 500 (not 503), which the frontend may interpret incorrectly.

FIX: Update engineering-automation.ts to use getDbReady() from db-neon.ts.

## Timeline of failure during deployment cold start (BEFORE fix)
t=0ms   Vercel deploys, new function instance starts
t=50ms  /api/auth/me arrives (UserContext mount)
t=100ms getDbReady() called → neon(url) created → SELECT 1 probe sent to Neon
t=100ms channel_binding=require SSL handshake → Neon proxy still starting → SSL error
        isTransientDbError('SCRAM authentication failed') → may return FALSE (fatal!)
        → throws non-retryable error → handleDbError → DB_CONFIG_ERROR → 503
        UserContext sees DB_CONFIG_ERROR → status='preserve' (no retry!)
        UI shows "Database not configured. Please contact your administrator."
t=180s  Neon fully warm, next request succeeds

## Timeline AFTER fix
t=0ms   Vercel deploys, new function instance starts
t=50ms  /api/auth/me arrives (UserContext mount)
t=100ms getDbReady() called → cached neon(url) singleton → SELECT 1 probe
t=200ms channel_binding=disable → clean SSL → Neon proxy starting → ECONNRESET
        isTransientDbError('ECONNRESET') → true → DB_STARTING 503 returned immediately
        UserContext sees DB_STARTING → status='retry' → waits 1s → retries
t=1200ms /api/auth/me retry #1 → Neon node warming up → SELECT 1 probe → transient error
        → DB_STARTING 503 → UserContext retry #2
t=2400ms /api/auth/me retry #2 → Neon fully warm → SELECT 1 succeeds → user query → 200 OK
        UserContext sets user → logged in → seamless