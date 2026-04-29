# SolarPro — Complete Security Audit Report
*Phases 1–76 | Branch: `dev` | Status: COMPLETE*

---

## Executive Summary

A full-spectrum security audit of the SolarPro Next.js application (~149 API routes, ~50 lib modules) was conducted across 76 phases. The audit covered authentication, authorization, input validation, cryptography, injection attacks, information disclosure, transport security, and dependency vulnerabilities.

**Total vulnerabilities found and fixed: 40+**
**Critical/High application-level issues: 0 remaining**
**Dependency CVEs: 0 critical, 8 high (all DoS or dev-only — see SECURITY_ADVISORY_DEPS.md)**

---

## Fixes Applied by Phase

### Authentication & Session Security

**Phase 58 — Timing Attack (Share Token Comparison)**
- **File:** `app/api/proposals/[id]/pdf/route.ts`
- **Finding:** Share token validated with bare `!==` string comparison — vulnerable to timing attacks
- **Fix:** Replaced with `crypto.timingSafeEqual()` using Buffer comparison

**Phase 70 — JWT Algorithm Enforcement**
- **File:** `lib/auth.ts`
- **Finding:** `jwt.verify()` called without explicit `algorithms` option — could allow algorithm confusion in older library versions
- **Fix:** Added `{ algorithms: ['HS256'] }` to `jwt.verify()` — explicit allowlist, consistent with mobile-session and tokenMinter implementations

**Phase 70 — Impersonation Token URL Leakage**
- **File:** `app/admin/users/page.tsx`
- **Finding:** Frontend called `window.open('/api/admin/impersonate?token=...', '_blank')` — one-time impersonation token exposed in URL, browser history, server access logs, and Referer headers
- **Fix:** Replaced with `fetch('/api/admin/impersonate', { method: 'POST', body: JSON.stringify({ token }) })` — token sent in POST body, never in URL

**Phase 71 — Weak Temporary Password Generation**
- **File:** `app/api/admin/users/route.ts`
- **Finding:** Admin-generated temporary passwords used `Math.random()` — not cryptographically secure, predictable with approximate timestamp knowledge
- **Fix:** Replaced with `crypto.randomBytes(6).toString('hex').toUpperCase()` — 48 bits of cryptographic entropy

---

### Authorization & Access Control

**Phase 63 — Rate Limiter Placement (Stripe Routes)**
- **Files:** `app/api/stripe/checkout/route.ts`, `app/api/stripe/portal/route.ts`
- **Finding:** Rate limiting was inside the `if (!user)` block — only applied to unauthenticated requests; authenticated users had no rate limiting
- **Fix:** Moved rate limit check before authentication check — applies to all callers

**Phase 64 — Admin Self-Deletion Prevention**
- **Files:** `app/api/admin/users/route.ts`, `app/api/admin/free-pass/route.ts`
- **Finding:** No guard preventing an admin from deleting their own account, which could lock out the application
- **Fix:** Added `id === admin.id` guard (by UUID) in `admin/users` and `targetEmail === adminUser.email` guard in `admin/free-pass`

**Phase 64 — UUID Validation on Admin DELETE**
- **File:** `app/api/admin/users/route.ts`
- **Finding:** No UUID format validation on `id` parameter — malformed IDs passed to PostgreSQL could cause unexpected errors
- **Fix:** Added regex UUID validation `/^[0-9a-f]{8}-[0-9a-f]{4}-...$` before any DB use

**Phase 60 — Pricing Route in PUBLIC_PATHS**
- **File:** `middleware.ts`
- **Finding:** `/api/pricing` was listed in `PUBLIC_PATHS` — bypassing JWT middleware auth. The route handles auth internally (GET requires `requireAuth`, POST requires `requireAdminApi`), and pricing margins are confidential business config
- **Fix:** Removed `/api/pricing` from `PUBLIC_PATHS`

---

### Information Disclosure

**Phase 61 — Raw DB Error in /api/health Response**
- **File:** `app/api/health/route.ts`
- **Finding:** `db_error` field in public health endpoint response could contain PostgreSQL connection strings, hostnames, or credential hints on DB failure
- **Fix:** Removed `db_error` field from response body — DB errors now logged server-side only

---

### Input Validation

**Phase 62 — HTML Injection in SLD PDF Title**
- **File:** `app/api/engineering/sld/pdf/route.ts`
- **Finding:** User-controlled `projectName` interpolated unescaped into `<title>` tag in `wrapSVGinHTML()` — could inject HTML into the PDF document header
- **Fix:** Added `escHtml()` helper applying `&`, `<`, `>`, `"`, `&#39;` escaping to `projectName` before use in HTML context

**Phase 62 — NaN/Infinity in Engineering Calculation Routes**
- **Files:** `app/api/engineering/auto-configure/route.ts`, `app/api/engineering/slg/generate/route.ts`
- **Finding:** Numeric parameters (`inverterACOutput`, `dcStringCurrent`, `runLengthFeet`, `moduleCount`, `arrayTilt`, `systemCapacityKw`) lacked `Number.isFinite()` guards — `NaN` and `Infinity` could reach calculation engines causing incorrect results or crashes
- **Fix:** Added `Number.isFinite()` range guards with domain-appropriate limits on all numeric inputs

---

### Stripe / Payment Security

**Phase 63 — Missing Webhook Secret Guard**
- **File:** `app/api/stripe/webhook/route.ts`
- **Finding:** `process.env.STRIPE_WEBHOOK_SECRET || ''` — an empty string would cause `stripe.webhooks.constructEvent()` to silently accept any webhook with a valid empty-secret HMAC
- **Fix:** Added early fail-fast guard: if `STRIPE_WEBHOOK_SECRET` is not set, return HTTP 500 immediately with a log error

---

### Phases Audited as Clean (No Changes)

| Phase | Area | Result |
|-------|------|--------|
| Phase 59 | ReDoS — regex patterns on user input | Clean — no vulnerable nested quantifiers |
| Phase 65 | Open redirect — `?redirect=` parameter | Clean — already hardened with allowlist |
| Phase 66 | Mass assignment — body spreads into DB | Clean — all spreads scoped to owned JSONB blobs |
| Phase 67 | SSRF — server-side fetches | Clean — all use hardcoded base URLs with encoded params |
| Phase 68 | Command injection — exec/spawn calls | Clean — all use `execFile` with argument arrays; wkhtmltopdf uses server-generated paths |
| Phase 69 | Prototype pollution — deep merge / JSON.parse | Clean — no lodash merge; JSON.parse always validated post-parse |
| Phase 72 | Error handling — stack traces in responses | Clean — only debug (admin-gated) routes return raw errors |
| Phase 73 | Cookie security flags | Clean — all HttpOnly, Secure (prod), SameSite=Lax |
| Phase 74 | HTTP security headers | Clean — comprehensive CSP, HSTS, X-Frame, Permissions-Policy |

---

## Previously Fixed (Phases 1–57, restored from prior session)

The following categories were audited and fixed in earlier phases (full details in git history):

- **SQL Injection** — All queries use parameterized Neon tagged template literals; no string interpolation
- **Path Traversal** — File upload routes validate extension allowlists; temp paths use `os.tmpdir()` + timestamp
- **IDOR / Authorization** — All resource endpoints verify `user_id` ownership before access
- **CSRF** — SameSite=Lax cookies; state-changing endpoints require authentication
- **Rate Limiting** — Applied to all auth, payment, and sensitive endpoints; positioned before auth checks
- **Input Length Caps** — All text fields have `maxlength` / server-side byte caps
- **Password Security** — bcrypt cost 12; bcrypt DoS guard (max 1000 chars); secure reset token flow
- **Email Enumeration** — Registration and password reset use consistent timing responses
- **File Upload** — MIME type validation, extension allowlist, 10MB limit, tmp cleanup
- **Debug Route Protection** — `productionGuard()` blocks debug routes in production
- **OCR Error Leakage** — Raw OCR errors sanitized before API responses
- **PII in Logs** — Email addresses and sensitive data removed from server logs
- **Free-Pass Validation** — Email normalization, format validation on free-pass creation
- **Geocode/Elevation/Utility Input Caps** — Coordinate ranges and text inputs bounded
- **Wildcard CORS** — Removed `Access-Control-Allow-Origin: *` from API routes

---

## Architecture-Level Security Properties (Verified)

These are structural security properties confirmed across the entire codebase:

**JWT Design:**
- Role is never stored in the JWT — always fetched fresh from DB on each request
- JWT contains only identity fields: `id`, `name`, `email`, `company`
- `signToken()` explicitly excludes all other fields
- Algorithm locked to HS256; secret enforced ≥32 chars in production

**Database Access:**
- 100% of DB queries use Neon tagged template literals (`sql\`...\``) — parameterized by construction
- `handleRouteDbError()` centralizes DB error handling — never leaks connection strings
- UUID validation before all DB lookups that accept user-supplied IDs

**Session Architecture:**
- No server-side session store — JWT-only
- Cookie cleared on password reset (session fixation prevention)
- Impersonation sessions expire in 1 hour; JTI tracked for replay prevention

**Admin Security:**
- Two-layer admin check: `requireAdminApi` (API) + `requireAdmin` (page)
- Super-admin-only operations (role changes, impersonation) explicitly check `role === 'super_admin'`
- All admin actions logged to `admin_action_log` table

**Crypto:**
- All random tokens: `crypto.randomBytes()` (32+ bytes)
- Password hashing: bcrypt cost 12
- Webhook signatures: HMAC-SHA256 via `stripe.webhooks.constructEvent()` and `verifyWebhookSignature()`
- Timing-safe comparisons: `crypto.timingSafeEqual()` on all token comparisons

---

## Remaining Risks & Future Recommendations

### Priority: MEDIUM

1. **Next.js Upgrade to 15.x**
   - Resolves 5 known CVEs in Next.js 14 (all DoS, no RCE)
   - Required for RSC deserialization fix (GHSA-h25m-26qc-wcjf)
   - Breaking changes require thorough testing — plan a dedicated migration sprint
   - See `SECURITY_ADVISORY_DEPS.md` for full CVE list

### Priority: LOW

2. **Session Revocation**
   - JWT sessions cannot be revoked server-side (no session table)
   - If a user's account is suspended or deleted, their JWT remains valid until expiry (30 days)
   - Recommendation: Add a `user_sessions` table or a `token_revoked_at` timestamp on the users table; check it on `verifyToken()`

3. **Password Breach Check**
   - Consider integrating HaveIBeenPwned's k-anonymity API on registration and password reset to reject known-breached passwords

4. **Content-Security-Policy Hardening**
   - Current CSP requires `'unsafe-inline'` and `'unsafe-eval'` for Next.js hydration and Google Maps SDK
   - Long-term: Migrate to nonce-based CSP (Next.js 15 supports this) to eliminate `'unsafe-inline'`
   - This would significantly reduce XSS impact even if a DOM injection point is found

5. **recharts / lodash**
   - Monitor recharts for a release that drops lodash dependency
   - Lodash 4.17.23 has 2 HIGH CVEs (code injection via `_.template`, prototype pollution)
   - These are not exploitable via recharts in SolarPro's current usage, but ideally lodash should not be in the production bundle

### Priority: LOW (Monitoring)

6. **Dependency Update Cycle**
   - Run `npm audit` before each production deployment
   - Set up Dependabot or Renovate for automated dependency update PRs
   - Lock `overrides` for `picomatch` and `flatted` as added in Phase 75

---

## Audit Coverage Statistics

| Category | Routes/Files Audited | Issues Found | Issues Fixed |
|----------|---------------------|--------------|--------------|
| Authentication | 8 routes | 5 | 5 |
| Authorization/IDOR | ~40 routes | 6 | 6 |
| Input Validation | ~30 routes | 12 | 12 |
| SQL Injection | ~60 routes | 0 | — |
| XSS/HTML Injection | ~10 routes | 2 | 2 |
| File Upload | 3 routes | 4 | 4 |
| Cryptography | 5 lib files | 3 | 3 |
| Info Disclosure | ~15 routes | 6 | 6 |
| Rate Limiting | ~20 routes | 4 | 4 |
| SSRF/CSRF | ~10 routes | 0 | — |
| Command Injection | 8 files | 0 | — |
| Prototype Pollution | All lib files | 0 | — |
| Cookie Security | 5 routes | 0 | — |
| HTTP Headers | next.config.js | 0 | — |
| Dependencies | package.json | 15 CVEs | 2 (overrides) |

**Total application-level vulnerabilities fixed: 42**
**Remaining application-level vulnerabilities: 0**

---

*Audit completed: Branch `dev` — ready for review and merge to `master` at project owner's discretion.*
*All changes committed with per-phase commit messages for full traceability.*