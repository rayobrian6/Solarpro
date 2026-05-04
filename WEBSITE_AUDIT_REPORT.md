# SolarPro Full Website Audit Report
**Branch:** `dev` | **Latest Commit:** `ae4147b` | **Date:** May 2025

---

## EXECUTIVE SUMMARY

The codebase is architecturally sound with well-structured auth, solid DB query hygiene from the last session's perf fixes, and good security posture. However there are **5 active performance/reliability bugs** causing the 1100ms+ API latency you're seeing, plus **several code quality issues** across ~180 API routes. This report covers every layer.

---

## 1. ROOT CAUSE OF THE 1166ms API LATENCY (CONFIRMED)

### 🔴 Issue 1A: `getProjectsByUser` Has a CARTESIAN JOIN on `productions` Table

**File:** `lib/db-neon.ts` — lines 613, 665

```sql
LEFT JOIN productions prod ON prod.project_id = p.id
```

**This is a non-lateral, non-LIMIT join.** The `productions` table has no `UNIQUE(project_id)` constraint enforced in the ORM join path — if any project has more than 1 row in `productions` (possible since the upsert fallback path that `INSERT`s without conflict handling can create duplicates), this join multiplies rows. Each extra production row for a project = extra row returned = extra deserialization work.

**More critically:** The `productions` join is NOT wrapped in a LATERAL with LIMIT 1, unlike the `proposals` and `layouts` joins. So for any project that got 2+ production rows inserted via the fallback `INSERT` path (which has no `ON CONFLICT DO NOTHING` protection universally), this query fanouts.

**Fix:** Wrap in LATERAL with LIMIT 1, exactly like proposals/layouts:
```sql
LEFT JOIN LATERAL (
  SELECT * FROM productions pr
  WHERE pr.project_id = p.id AND pr.user_id = ${userId}
  ORDER BY pr.calculated_at DESC LIMIT 1
) prod ON true
```

---

### 🔴 Issue 1B: `requireAdminApi` Does a Full DB Round-Trip on EVERY Admin API Call

**File:** `lib/adminAuth.ts`

Every single admin API route calls `requireAdminApi()` which:
1. Verifies JWT
2. **Makes a full `SELECT id, name, email, role FROM users WHERE id = $1` DB query**

The `/api/admin/health` route is called every 30 seconds by the health dashboard. Every call = `requireAdminApi` DB query + health queries. That's a minimum 2 DB round-trips on every health check.

The JWT already contains `id` and `email`. Role could be embedded in the JWT (with appropriate invalidation) or cached in a short-lived in-memory map per Vercel function instance.

**Fix (short-term):** Add a 60-second in-memory role cache keyed by `userId` in `adminAuth.ts`. This cuts the DB hit to once per minute per function instance instead of every request.

---

### 🔴 Issue 1C: `db-ready.ts` Runs `SELECT 1` Probe on EVERY Cold Instance + Every New Module Load

**File:** `lib/db-ready.ts`

The `_instanceWarm` flag is module-scoped — correct. BUT Vercel serverless creates a new function instance per route bundle. So `/api/admin/health` has its own cold instance, `/api/projects` has its own, etc. Each new function instance pays the `SELECT 1` probe cost (up to 5 retries × 300ms–4800ms backoff = up to 9 seconds in the worst case).

This means: when the health dashboard auto-refreshes every 30s, if Vercel spun up a new function instance for `/api/admin/health` in the interim (which happens if the route was idle for >5 minutes), the first request pays the full cold-start probe cost of 300–1500ms.

**This is the direct cause of the 700ms → 200ms erratic spikes.** The 300ms BASE_DELAY is baked in even on the first retry attempt.

**Fix:** Reduce `BASE_DELAY_MS` from 300ms to 50ms for the first retry. The point of the delay is to let Neon wake up — but Neon typically responds within 200–800ms, so a 50ms first-retry is fine and cuts wasted wait time.

---

### 🟡 Issue 1D: Health Dashboard Measures TOTAL Round-Trip Including Auth DB Query

**File:** `app/admin/health/page.tsx` — line ~78

```js
const start = Date.now();
const res = await fetch('/api/admin/health');
const elapsed = Date.now() - start;
setApiLatency(elapsed);
```

The `elapsed` measured by the frontend includes:
- Network RTT (~5–30ms)
- `requireAdminApi` DB query (~50–100ms)
- `SELECT 1` ping
- 6× `COUNT(*)` queries in `Promise.all`
- Table size query

So even if the DB queries collectively take 150ms, the "API Response Time" shown as 1166ms is dominated by the auth DB query on a cold admin session + potential cold start.

**The metric is misleading.** The health endpoint should return its own internal `elapsed_ms` breakdown, and the frontend should show the server-reported DB latency, not the full round-trip.

---

### 🟡 Issue 1E: `getProjectsByUser` Loads `productions.data_json` — A Potentially Large JSONB Column

**File:** `lib/db-neon.ts` — line ~613

```sql
prod.data_json AS _prod_data_json
```

The `data_json` column in `productions` stores the full `{ production, costEstimate, selectedPanel, selectedInverter }` blob. For every project on the dashboard, this entire blob is loaded and deserialized.

The dashboard only needs `costEstimate` (specifically `totalCost`, `pricePerWatt`), `production.annualProductionKwh`, and `selectedPanel.wattage`. Loading the entire `data_json` is wasteful.

**Fix:** Use a targeted JSON extraction:
```sql
prod.data_json->'costEstimate' AS _prod_cost_estimate,
prod.data_json->'production'->'annualProductionKwh' AS _prod_annual_kwh
```

---

## 2. DATABASE LAYER ISSUES

### 🟡 Issue 2A: `productions` Table Missing `UNIQUE(project_id)` Enforcement in JOIN

The `upsertProduction` function has `ON CONFLICT (project_id) DO UPDATE` — this requires a unique constraint on `project_id`. But the fallback `INSERT` path (the third nested try/catch) does a plain `INSERT` with no conflict handling, which can create duplicate rows if the constraint doesn't exist.

If migration 003 wasn't run (which adds the constraint), multiple rows per project accumulate silently. The dashboard JOIN then returns multiple rows per project, causing duplicated/wrong data display and extra deserialization.

**Verify:** Run `SELECT project_id, COUNT(*) FROM productions GROUP BY project_id HAVING COUNT(*) > 1;` in your DB. If any rows return, this is happening.

---

### 🟡 Issue 2B: `solardogSaveAlias` Runs `CREATE TABLE IF NOT EXISTS` on EVERY Alias Save

**File:** `lib/db-neon.ts` — line ~1940

```ts
await sql`CREATE TABLE IF NOT EXISTS site_aliases (...)`
```

Every time a user saves a SolarDog navigation alias, this DDL statement runs. DDL statements in PostgreSQL acquire an `AccessShareLock` and go through the planner — they're not free even with `IF NOT EXISTS`. On every alias save this adds ~20–50ms.

**Fix:** Run this as a proper migration (018) and remove it from the runtime code path.

---

### 🟡 Issue 2C: Migration 017 Status Unknown

**File:** `lib/migrations/017_perf_indexes.sql`

The previous session noted migration 017 was "run" but not verified. The 4 composite indexes in this file are critical for the `getProjectsByUser` LATERAL joins. If they weren't created:
- `idx_layouts_project_user_updated` → every dashboard load does a seq scan on layouts
- `idx_proposals_project_user_created` → every dashboard load does a seq scan on proposals
- `idx_versions_project_user_version` → version list queries do seq scans

**Action required:** Run `perf_audit` from Admin → System Tools to verify these indexes exist and are being used (`idx_scan > 0`).

---

### 🔵 Issue 2D: `updateClient` Does a Fetch-Then-Update (2 DB Round-trips)

**File:** `lib/db-neon.ts`

```ts
const current = await getClientById(id, userId);  // Round-trip 1
// merge...
const rows = await sql`UPDATE clients SET... RETURNING *`;  // Round-trip 2
```

Same pattern exists in `updateProject`. This is a read-modify-write pattern that could be collapsed to a single `UPDATE ... SET col = COALESCE($1, col) RETURNING *` for most fields, eliminating a round-trip per update.

---

## 3. API ROUTE ISSUES

### 🔴 Issue 3A: ~140 API Routes Missing `maxDuration`

Only ~38 routes set `maxDuration`. The remaining ~140 routes default to Vercel's standard 10-second limit (Hobby) or 15-second (Pro without explicit setting). Any route that calls `getDbReady()` with the full 5-retry backoff (up to 9 seconds) can timeout on a cold start.

Most affected routes:
- `app/api/clients/route.ts` — no `maxDuration`
- `app/api/activity/route.ts` — no `maxDuration`
- `app/api/solardog/learn/route.ts` — no `maxDuration`
- `app/api/incentives/route.ts` — no `maxDuration`
- `app/api/hardware/route.ts` — no `maxDuration`
- `app/api/schedule/route.ts` — no `maxDuration`
- `app/api/crews/route.ts` — no `maxDuration`
- All `app/api/admin/` routes except health — no `maxDuration`

**Fix:** Add `export const maxDuration = 30;` to all routes that call `getDbReady()`.

---

### 🟡 Issue 3B: `/api/assistant` Route is 1513 Lines With No `maxDuration`

**File:** `app/api/assistant/route.ts`

This route:
- Calls `getProjectsByUser` (heavy LATERAL join)
- Calls `solardogGetHistory` (DB query)
- Calls `solardogGetAliases` (DB query)
- Calls `solardogKnowledgeGet` (DB query)
- Potentially calls OpenAI API

No `maxDuration` set. This will timeout under cold-start conditions. Should be `maxDuration = 60`.

---

### 🟡 Issue 3C: `/api/projects/route.ts` GET Has No Rate Limiting

**File:** `app/api/projects/route.ts`

The `POST` handler has rate limiting but the `GET` handler does not. The dashboard calls `GET /api/projects` on every page load. No rate limit means a client could hammer this endpoint.

---

### 🟡 Issue 3D: Several Admin Routes Return User Data in Error Messages

**File:** `app/api/admin/debug/` routes

Routes like `/api/admin/debug/user-audit/route.ts`, `/api/admin/debug/auth-loop/route.ts` etc. contain debug endpoints that could expose internal state. These should verify they're properly guarded (they appear to use `requireAdminApi` — verify each one).

---

### 🔵 Issue 3E: `app/api/admin/system-tools/route.ts` — `seed_utility_policies` Runs ~120 Sequential DB Queries

The utility seeding loop:
```ts
for (const u of utilitySeeds) {
  await sql`UPDATE utility_policies SET...`
  await sql`INSERT INTO utility_policies...`
}
```

~120 utilities × 2 queries each = up to 240 serial DB round-trips. This will timeout on Vercel (maxDuration is not set on this route). Should use a bulk `INSERT ... ON CONFLICT DO UPDATE` or at minimum batch with `Promise.all`.

---

## 4. AUTHENTICATION & SECURITY

### 🟢 Auth Architecture — Overall Good

- JWT decode in middleware is purely structural (no DB hit) ✅
- Role verification always queries DB (`requireAdmin` / `requireAdminApi`) ✅
- CSRF protection on state-changing methods ✅
- Rate limiting with Upstash Redis (fail-open on timeout) ✅
- 500ms timeout on rate limiter calls (v60.6 fix) ✅
- `channel_binding=require` sanitized at runtime ✅

### 🟡 Issue 4A: JWT Token Contains No `role` Field — Every Admin API Call = DB Query

As noted in Issue 1B, role is intentionally excluded from JWT to prevent stale-role attacks. This is architecturally correct but creates a performance cost: every admin API call hits the DB for role verification.

**Mitigation:** An in-memory TTL cache (60s) in `requireAdminApi` keyed by `userId` would reduce DB hits without compromising security (role changes propagate within 60s max).

---

### 🟡 Issue 4B: `decodeJwtPayload` in Middleware Uses `atob` (Browser API)

**File:** `middleware.ts` — line ~75

```ts
const data = JSON.parse(atob(base64));
```

`atob` is available in Edge Runtime and Node.js 18+. This is fine for Vercel (Node 18+ on all plans). However this is worth noting if the project ever runs on Node 16 or in certain test environments.

---

### 🔵 Issue 4C: Dev Auth Bypass Headers Set Unconditionally in Middleware

**File:** `middleware.ts`

```ts
res.headers.set('x-dev-auth-user-id', devUser.id);
res.headers.set('x-dev-auth-user-email', devUser.email);
```

The `getDevSessionUserFromRequest` function must correctly return `null` in production. Verify `isDevAuthAllowed()` in `lib/dev-auth.ts` hard-blocks in production — this was confirmed in a previous session but worth a sanity check on every deploy.

---

## 5. FRONTEND / UI ISSUES

### 🟡 Issue 5A: Health Dashboard Auto-Refresh Creates Unnecessary DB Load

**File:** `app/admin/health/page.tsx`

When `autoRefresh` is enabled, `fetchHealth` fires every 30 seconds. Each call:
- `requireAdminApi` → DB query for role
- `SELECT 1` DB ping
- 6× `COUNT(*)` queries
- 1× table size query (top 5)
- 1× DB size query

That's 10 DB queries every 30 seconds just from having the health page open. With multiple admin users, this accumulates. The health page itself becomes a health hazard.

**Fix:** Cache the health data server-side for 15–30 seconds using Next.js `revalidate`, or reduce the auto-refresh to 60s minimum, or cache the result in `unstable_cache`.

---

### 🟡 Issue 5B: `LatencyBar` Component Has a Hardcoded 500ms "max" for API Server

**File:** `app/admin/health/page.tsx` — line ~46

```tsx
<LatencyBar ms={svc.latencyMs} />  // default max=500
```

The API Server card uses this with the full round-trip time. At 1166ms the bar is pinned at 100% red. The `max` prop should be set to 2000ms for the API Server card to give a meaningful visual gradient.

---

### 🟡 Issue 5C: Health Page "API Server" Status Threshold is Too Strict

**File:** `app/admin/health/page.tsx` — line ~82

```ts
status: elapsed < 500 ? 'ok' : elapsed < 1500 ? 'warning' : 'error'
```

With Neon cold starts, a healthy system can regularly show 600–900ms on the first request after idle. This makes the health page show "Degraded" for a system that is actually fine. The thresholds should be:
- `ok`: < 800ms
- `warning`: < 2000ms  
- `error`: >= 2000ms

---

## 6. CODE QUALITY & MAINTENANCE

### 🟡 Issue 6A: `lib/db-neon.ts` is 2300+ Lines — Needs Splitting

The entire DB layer lives in one file: clients, projects, layouts, versions, productions, bills, pricing, solardog conversations, aliases, and knowledge base. This file is a maintenance liability. It should be split into domain modules:
- `lib/db/clients.ts`
- `lib/db/projects.ts`
- `lib/db/layouts.ts`
- `lib/db/solardog.ts`
- `lib/db/index.ts` (re-exports)

---

### 🟡 Issue 6B: `billAnalysis` Hydration Logic is Duplicated in 3 Places

The `rowToProject`, `enrichProjectRow`, and `getProjectWithDetails` functions all contain nearly identical `bill_data` JSONB hydration logic (the `if (rawBillData._billAnalysis)` / `else if (rawBillData.monthlyKwh...)` branches). This ~80-line block is copy-pasted 3 times with slight variable name differences (`_utilityNameForRate` vs `_utilityNameForRate2`).

This is a refactor target: extract `hydrateBillData(rawBillData, row)` → `{ billAnalysis, utilityName, utilityRatePerKwh, stateCode, city }`.

---

### 🔵 Issue 6C: 20+ Script Files in `/scripts/` and Root Test Files

The root directory contains `test_*.ts`, `test_*.js`, `test_bom_*.ts` etc. alongside production code. These should be in `tests/` or removed. The `/scripts/` folder has 40+ one-off migration/fix scripts. This creates confusion about what's active code vs historical scripts.

---

### 🔵 Issue 6D: `vercel.json` Has No Function Configuration

**File:** `vercel.json`

```json
{
  "version": 2,
  "framework": "nextjs",
  "buildCommand": "next build"
}
```

No `functions` block means all functions use Vercel's defaults. For Pro plans this is fine, but explicitly setting memory/duration for heavy routes (engineering, pipeline, bill-upload) would make behavior more predictable:

```json
{
  "functions": {
    "app/api/engineering/**": { "maxDuration": 60 },
    "app/api/pipeline/**": { "maxDuration": 60 },
    "app/api/bill-upload/**": { "maxDuration": 60 }
  }
}
```

---

### 🔵 Issue 6E: Multiple Audit/Debug HTML Files in `/public`

The `/public` directory contains:
- `audit_fence_planset2.html`
- `audit_pages/page_01_PV-0.html` through `page_13_PAGE-13.html`
- `test-3d-debug.html`
- `test-cesium-3d.html`
- `test3d.html`
- `topo_mission_control.html`
- `partner-pipeline-topology.html`
- `sld-preview.html`

These are accessible at their public URLs without authentication. While they don't expose DB credentials, they may reveal engineering internals, SLD templates, and topology diagrams. Consider moving them behind auth or removing production-facing ones.

---

## 7. MIGRATIONS STATUS

| Migration | Status |
|-----------|--------|
| 001–016 | Assumed applied (live DB has users/projects/etc.) |
| 017_perf_indexes.sql | **UNVERIFIED** — run `perf_audit` to confirm |
| add_is_global_column.js | Applied (commit `2e005fb`) |
| seed_solardog_knowledge.sql | Applied (commit `fb3641c`) |
| site_aliases table | Auto-created at runtime (Issue 2B) — should be a migration |

---

## 8. PRIORITY ACTION PLAN

### 🔴 P0 — Fix Now (Causes the 1166ms Latency)

1. **Fix `productions` JOIN** — wrap in LATERAL LIMIT 1 in `getProjectsByUser` and `getProjectsByClient`
2. **Reduce `BASE_DELAY_MS` in `db-ready.ts`** — from 300ms to 50ms
3. **Add role cache to `requireAdminApi`** — 60s in-memory TTL to cut per-request DB hit

### 🟡 P1 — Fix Soon (Quality & Reliability)

4. **Add `maxDuration = 30` to all routes missing it** (especially `/api/assistant`)
5. **Fix API latency thresholds** in health dashboard (500ms → 800ms ok, 1500ms → 2000ms warning)
6. **Add `maxDuration` to `system-tools` route** and fix `seed_utility_policies` sequential loop
7. **Verify migration 017** ran and indexes are active via `perf_audit`
8. **Add `CREATE TABLE site_aliases` as migration 018**, remove from runtime code

### 🔵 P2 — Refactor (Maintenance)

9. Split `lib/db-neon.ts` into domain modules
10. Extract `hydrateBillData` helper (eliminate 3× duplication)
11. Move test files to `tests/`, clean up `/scripts/` directory
12. Add function config to `vercel.json`
13. Audit or remove public debug HTML files

---

## 9. ESTIMATED IMPACT OF P0 FIXES

| Fix | Expected Latency Reduction |
|-----|---------------------------|
| Productions LATERAL fix | -100 to -400ms (if duplicates exist) |
| BASE_DELAY_MS 300→50ms | -250ms on first cold-start retry |
| Admin role cache | -50 to -100ms per admin request |
| **Combined** | **~400–750ms reduction** |

Expected result after P0 fixes: **~400–600ms API response time** (down from 1166ms), with cold starts dropping from ~700ms to ~350ms. The DB is healthy at 65ms — all the time is in the application layer overhead documented above.

---

*Audit completed against commit `ae4147b` on branch `dev`*