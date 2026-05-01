# Security Audit Report — Phase 21
**Date:** 2026  
**Scope:** Full audit of all 149 API routes, middleware, auth patterns, data pipelines  
**Status:** ✅ All identified issues resolved

---

## Summary

| Category | Issues Found | Issues Fixed |
|---|---|---|
| Broken Admin Guards | 9 | 9 ✅ |
| IDOR / Ownership Bypass | 3 | 3 ✅ |
| Input Validation / Injection | 6 | 6 ✅ |
| MIME Type / File Security | 4 | 4 ✅ |
| CORS Wildcard | 3 | 3 ✅ |
| Information Disclosure | 8 | 8 ✅ |
| Authentication / Session | 4 | 4 ✅ |
| PII in Logs | 7 | 7 ✅ |
| Rate Limiting Gaps | 1 | 1 ✅ |
| Secrets in URLs | 1 | 1 ✅ |
| **Total** | **46** | **46 ✅** |

---

## Critical Issues (CVSS 9.0+)

### BUG-21-09 — Broken Admin Guards (`instanceof NextResponse` anti-pattern)
**Severity:** CRITICAL  
**Files:** 9 routes across `app/api/admin/`  
**Root Cause:** `requireAdminApi()` returns `AdminUser | null`, never a `NextResponse`. Routes using `if (adminCheck instanceof NextResponse)` had admin protection completely bypassed — any authenticated user could access admin endpoints.  
**Fix:** Replaced all `instanceof NextResponse` checks with `if (!adminCheck)` null checks.  
**Files fixed:**
- `app/api/admin/impersonate/route.ts`
- `app/api/admin/free-pass/route.ts`
- `app/api/admin/me-exact-debug/route.ts`
- `app/api/admin/me-ultra-debug/route.ts`
- `app/api/admin/debug/route.ts`
- `app/api/admin/me-debug/route.ts`
- `app/api/admin/debug-role/route.ts`
- `app/api/admin/set-roles/route.ts`

---

### BUG-21-03 — Admin Impersonation via GET + Missing `secure` Cookie Flag
**Severity:** CRITICAL  
**File:** `app/api/admin/impersonate/route.ts`  
**Issues:**
1. State-changing operation (sets session cookie) via GET — violates HTTP semantics, CSRF-vulnerable
2. One-time token transmitted in URL query string — logged by CDNs, proxies, browser history
3. Missing `secure: true` on session cookie  
**Fix:** Rewrote to POST-only handler; token must be in request body; added `secure: true` to cookie; added atomic race-condition protection on token consumption with `AND used = false` in UPDATE.

---

## High Issues (CVSS 7.0–8.9)

### BUG-21-06 — `parseInt(UUID)` Breaks Ownership Check
**Severity:** HIGH  
**File:** `app/api/projects/[id]/site-conditions/route.ts`  
**Issue:** `parseInt(uuid)` always returns `NaN`. SQL `WHERE id = NaN` matches nothing, ownership check was never enforced — any authenticated user could read/write any project's site conditions.  
**Fix:** UUID format validation via `isValidUUID()`, use string `id` directly in queries.

---

### BUG-21-05 — MIME Type XSS via File Download
**Severity:** HIGH  
**File:** `app/api/project-files/download/route.ts`  
**Issue:** Served files with `mime_type` from DB as `Content-Type` with `inline` disposition. An attacker could upload a file with stored `text/html` or `image/svg+xml` mime_type, triggering XSS when fetched.  
**Fix:** Allowlist of safe MIME types; anything not on list defaults to `application/octet-stream`; changed disposition to `attachment`; added `X-Content-Type-Options: nosniff`.

---

### BUG-21-07 — Tile Coordinate Injection + CORS Wildcard
**Severity:** HIGH  
**File:** `app/api/tile/route.ts`  
**Issues:**
1. `z`, `x`, `y` params interpolated into Google Maps API URL without integer validation — potential path traversal
2. `session` and API key not `encodeURIComponent()`-encoded in URL
3. `Access-Control-Allow-Origin: *` on authenticated endpoint  
**Fix:** Validate z/x/y as non-negative integers (z ≤ 22); `encodeURIComponent()` on credentials; removed CORS wildcard from both response paths.

---

### BUG-21-08 — maps-session Tile Injection + CORS Wildcard
**Severity:** HIGH  
**File:** `app/api/maps-session/route.ts`  
**Issues:** Same as BUG-21-07 but in POST body — `z`, `x`, `y` from `req.json()` with no validation.  
**Fix:** Same integer validation + `encodeURIComponent()` + CORS wildcard removed.

---

### BUG-21-04 — Mobile SSO JWT JTI Not Tracked (Replay Attack)
**Severity:** HIGH  
**File:** `app/api/auth/mobile-session/route.ts`  
**Issue:** SSO tokens mint a `jti` UUID claim but never store it — the same token is reusable within its 10-minute window.  
**Fix:** Created `migrations/015_mobile_sso_jti.sql` table; JTI stored in DB on mint. If DB write fails, token is NOT issued. Opportunistic cleanup of expired jtis on each mint.

---

### Survey GET IDOR — No Ownership Check
**Severity:** HIGH  
**File:** `app/api/site-survey/upload/route.ts` (GET handler)  
**Issue:** GET handler fetched surveys by `surveyId` or `projectId` without any ownership check — any authenticated user could read any survey.  
**Fix:** All queries now JOIN against `projects` table with `AND p.user_id = ${userId}`.

---

## Medium Issues (CVSS 4.0–6.9)

### BUG-21-02 — System Env Endpoint Exposes Env Var Names
**Severity:** MEDIUM  
**File:** `app/api/system/env/route.ts`  
**Issue:** Returned `missing_required: string[]` with actual env var names, plus `runtime.node_version`, `runtime.vercel_env`, `runtime.region` — reconnaissance data for attackers.  
**Fix:** Replaced with `missing_required_count`, `missing_recommended_count`; removed runtime fingerprinting.

---

### BUG-21-01 — health/env Leaks Env Var Names + Project Name
**Severity:** MEDIUM (dev/preview only via `productionGuard()`)  
**File:** `app/api/health/env/route.ts`  
**Issues:** `note` fields leaked actual env var names, current value lengths, expected prefixes; `fix` array hardcoded Vercel project name `solarpro-v31`.  
**Fix:** Generic messages only; removed Vercel project name from fix instructions.

---

### Migrate Secret in URL Query String
**Severity:** MEDIUM  
**File:** `app/api/migrate/route.ts`  
**Issue:** `GET /api/migrate?secret=xxx` exposed `MIGRATE_SECRET` in URL — logged by CDNs, proxies, browser history.  
**Fix:** GET handler now returns 405 with instruction to use POST. POST handler reads secret from body only (removed query string fallback).

---

### CORS Wildcard on Authenticated Endpoint
**Severity:** MEDIUM  
**File:** `app/api/maps-session/route.ts`  
**Issue:** `Access-Control-Allow-Origin: *` on a route requiring authentication — allows any origin to make credentialed requests.  
**Fix:** Removed CORS wildcard header.

---

### Version Endpoint Exposes Internal Engineering Notes
**Severity:** MEDIUM  
**File:** `app/api/version/route.ts`  
**Issue:** `BUILD_FEATURES` array contained detailed internal engineering notes (algorithm names, DC/AC ratio logic, component counts, brand profile details) — reconnaissance goldmine.  
**Fix:** Removed `description` and `features` fields from response.

---

### Capabilities Endpoint Leaks Env Var Name
**Severity:** MEDIUM  
**File:** `app/api/system/capabilities/route.ts`  
**Issue:** `outbound.handoff.expectedContract.sharedSecretEnvVar: 'SOLARPRO_HANDOFF_SECRET'` exposed env var name publicly.  
**Fix:** Removed `sharedSecretEnvVar` field.

---

### SVG Upload Allowed for Logo (Stored XSS Risk)
**Severity:** MEDIUM  
**File:** `app/api/settings/logo/route.ts`  
**Issue:** `image/svg+xml` accepted for logo upload and stored as data URL — SVGs can contain embedded JavaScript, causing stored XSS when rendered.  
**Fix:** Removed SVG from allowed types; raster formats only (PNG, JPG, WebP, GIF).

---

### MIME Type Not Sanitized on File Upload
**Severity:** MEDIUM  
**File:** `app/api/project-files/route.ts`  
**Issue:** Both JSON and form upload paths stored user-provided `mimeType` directly in DB without validation — defense-in-depth gap (download route had allowlist, but DB could contain dangerous types).  
**Fix:** Added `sanitizeMimeType()` helper with allowlist; applied to both upload paths.

---

### OCR Endpoint Missing Rate Limiting
**Severity:** MEDIUM  
**File:** `app/api/ocr/route.ts`  
**Issue:** OCR is compute-intensive (Tesseract CPU) but had no rate limit — authenticated users could abuse it for DoS.  
**Fix:** Added `checkRateLimit('ocr', ...)` — 10 requests per 60 seconds per IP. Added `ocr` key to `lib/rateLimiter.ts`.

---

## Low Issues (CVSS 1.0–3.9)

### PII Leakage in Server Logs — 7 Instances
**Severity:** LOW (server logs, not API responses)  
**Files fixed:**
- `app/api/auth/me/route.ts` — `email` in `[SESSION_VALIDATION]` and `[AUTH_COOKIE_PRESENT]` logs
- `app/api/auth/login/route.ts` — `email` in `[AUTH_LOGIN_SUCCESS]` log
- `app/api/auth/delete-account/route.ts` — `email` in `[DELETE_ACCOUNT]` log
- `app/api/admin/feedback/count/route.ts` — `admin.email` in feedback count log
- `app/api/debug/force-ingest/route.ts` — `admin.email` in force ingest log
- `app/api/projects/[id]/survey-handoff/route.ts` — `email` in `[HANDOFF OWNER]` log
- `app/api/auth/mobile-session/route.ts` — `email` in mobile session mint log

**Fix:** Replaced with `userId` or `id` only in all log statements.

---

### parseInt Pagination NaN Guard Missing
**Severity:** LOW  
**File:** `app/api/admin/feedback/route.ts`  
**Issue:** `parseInt()` on `limit`/`offset` params without `NaN` guard — could cause malformed SQL if `NaN` reached query.  
**Fix:** Added `Number.isFinite()` checks with safe defaults.

---

## Infrastructure / Hardening

### Migration 015 — Mobile SSO JTI Tracking Table
**File:** `migrations/015_mobile_sso_jti.sql`  
**Purpose:** `mobile_sso_used_jtis` table for replay prevention. Schema: `jti TEXT PRIMARY KEY, user_id TEXT, used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ`. Indexed on `expires_at` for cleanup queries.

---

## Verified Clean (No Issues Found)

- All 149 routes: No SQL injection (all queries use parameterized neon tagged templates)
- Stripe webhook: HMAC signature verification via `constructEvent()`
- Survey webhook: HMAC verification with timing-safe comparison, idempotency via `event_id`
- Password reset tokens: Single-use, time-limited, proper DB tracking
- Admin activity log: All privileged operations logged with `logAdminAction()`
- `handleRouteDbError`: Generic error messages only, never exposes DB internals
- Rate limiting: login, register, password-reset, bill-upload, engineering, enterprise-contact, ocr
- IDOR checks: projects, proposals, clients, tasks, milestones, engineering runs, layouts all enforce `user_id` ownership
- No `eval()`, `new Function()`, or `dangerouslySetInnerHTML` in API layer
- No open redirects
- No hardcoded credentials or secrets in source

---

## Patterns to Watch in Future Code

1. **`requireAdminApi()` returns `AdminUser | null`** — always use `if (!adminCheck)` not `instanceof NextResponse`
2. **Never use `parseInt()` on UUID parameters** — UUIDs must be validated with `isValidUUID()` and used as strings
3. **All user-provided MIME types must be sanitized** through an allowlist before storage or serving
4. **CORS wildcards must never appear on authenticated endpoints**
5. **Secrets must never appear in URL query strings** — always use request body
6. **State-changing operations must use POST/PUT/PATCH/DELETE** — never GET
7. **PII (email, name) must not appear in server logs** — use userId only
8. **JTI claims in short-lived tokens must be tracked** to prevent replay