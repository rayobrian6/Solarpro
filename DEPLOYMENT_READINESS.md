# SolarPro — Deployment Readiness Report
**Generated:** v47.36 post-commit `ce19850`  
**Branch:** `master` → `solarpro-v31.vercel.app`

---

## ✅ What Was Fixed (v47.29–v47.36)

### Code Fixes
| # | Issue | Fix | Version |
|---|-------|-----|---------|
| 1 | `POST /api/auth/request-password-reset` returned generic 500 when `password_reset_tokens` table missing | Added `ensureTable()` guard → returns 503 with clear message | v47.34 |
| 2 | Build succeeded silently with missing required env vars | `validateBuildEnv()` in `next.config.js` → `process.exit(1)` on missing `DATABASE_URL` / `JWT_SECRET` | v47.35 |
| 3 | `/api/health` returned minimal info | Rewritten to return `{ status, database, env_valid, missing_env, warned_env, env_details }` | v47.35 |
| 4 | 5 separate `getBaseUrl()`/`getAppUrl()` implementations across codebase | All consolidated to single `getBaseUrl()` in `lib/env.ts` | v47.36 |
| 5 | `lib/email.ts` had its own `getAppUrl()` (could drift from canonical) | Removed — now imports `getBaseUrl()` from `lib/env` | v47.36 |
| 6 | `lib/stripe.ts` used `process.env.NEXT_PUBLIC_BASE_URL \|\| 'http://localhost:3000'` directly | Now uses `getBaseUrl()` from `lib/env` | v47.36 |
| 7 | `lib/billOcrEngine.ts` had its own `getBaseUrl()` with `NEXTAUTH_URL` priority | Removed — now imports from `lib/env` | v47.36 |
| 8 | `app/api/proposals/[id]/share/route.ts` fell back to `'https://solarpro.app'` (DigitalOcean server) | Now uses `getBaseUrl()` — no more wrong-server fallback | v47.36 |
| 9 | Email sent from `noreply@underthesun.solutions` (GoDaddy-managed domain) | Changed to `noreply@mail.solarpro.app` *(DNS setup required — see below)* | v47.36 |
| 10 | No `/api/system/health` ops endpoint | Created with full checks: DB, env_required, env_optional, base_url, email config | v47.36 |
| 11 | `.env.example` missing `STRIPE_PRICE_*` and `MIGRATE_SECRET` | Added all referenced vars with documentation | v47.36 |

---

## 🔴 BLOCKING — Must Complete Before Email Works

### 1. Add Resend DNS Records to Gandi.net

The `from` address is now `noreply@mail.solarpro.app`. **Email will fail** until Resend's DNS records are added.

**Steps:**
1. Go to [Resend Dashboard](https://resend.com) → Domains → Add Domain → `mail.solarpro.app`
2. Resend will show you 3–5 DNS records to add. They look like:

| Type | Name | Value |
|------|------|-------|
| MX | `mail.solarpro.app` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
| TXT | `mail.solarpro.app` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey.mail.solarpro.app` | `p=MIGf...` (DKIM key from Resend) |
| CNAME | `resend._domainkey.mail.solarpro.app` | *(may vary — use what Resend shows)* |

3. Log in to **Gandi.net** → DNS for `solarpro.app` → Add the records above
4. Wait 5–30 min for DNS propagation
5. Click **Verify** in Resend dashboard
6. Once verified, add `RESEND_API_KEY` to Vercel env vars (if not already set)

> ⚠️ **Current SPF on `solarpro.app`:** `v=spf1 -all` — this blocks ALL outgoing email.  
> Gandi must update this to `v=spf1 include:amazonses.com ~all` for `mail.solarpro.app`.  
> The SPF record is on the root `solarpro.app` zone — update it there.

---

## 🟡 IMPORTANT — Required Vercel Environment Variables

Set these in **Vercel Dashboard → Project → Settings → Environment Variables → Production scope**:

| Variable | Value | Status |
|----------|-------|--------|
| `DATABASE_URL` | Your Neon connection string (pooled) | Must already be set |
| `JWT_SECRET` | Random 64-char string | Must already be set |
| `NEXT_PUBLIC_APP_URL` | `https://solarpro-v31.vercel.app` | **Set this if not already** |
| `RESEND_API_KEY` | From resend.com → API Keys | Set after Resend domain verified |
| `STRIPE_SECRET_KEY` | From Stripe dashboard | Set for billing |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhooks | Set for billing |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | From Stripe dashboard | Set for billing |
| `STRIPE_PRICE_STARTER` | `price_xxxxx` from Stripe products | Set for billing |
| `STRIPE_PRICE_PROFESSIONAL` | `price_xxxxx` from Stripe products | Set for billing |
| `STRIPE_PRICE_CONTRACTOR` | `price_xxxxx` from Stripe products | Set for billing |
| `MIGRATE_SECRET` | Random 32-char hex string | Set to protect `/api/db/migrate` |
| `OPENAI_API_KEY` | From platform.openai.com | Optional (bill OCR fallback) |
| `GOOGLE_MAPS_API_KEY` | From Google Cloud Console | Optional (geocoding) |

> **Critical:** `NEXT_PUBLIC_APP_URL` must be set to `https://solarpro-v31.vercel.app`  
> Without it, password reset links will use the ephemeral `VERCEL_URL` (a git-SHA URL)  
> that changes every deployment, making reset links immediately broken.

---

## 🟡 IMPORTANT — Connect Custom Domain to Vercel

Currently `solarpro.app` A record points to `188.166.38.144` (DigitalOcean — old deployment).  
The live app is only accessible at `solarpro-v31.vercel.app`.

**To connect `solarpro.app` to Vercel:**

1. **Vercel Dashboard** → Project → Settings → Domains → Add `solarpro.app`
2. Vercel will provide either:
   - An **A record** pointing to Vercel's IP (e.g. `76.76.21.21`), or
   - A **CNAME** pointing to `cname.vercel-dns.com`
3. Log in to **Gandi.net** → DNS for `solarpro.app` → Update the A record
4. Also update `NEXT_PUBLIC_APP_URL` in Vercel to `https://solarpro.app`
5. Wait for DNS propagation (up to 48h; usually <1h)

> ⚠️ Do NOT update the DNS until the custom domain is added in Vercel first,  
> otherwise there will be a period where `solarpro.app` resolves but Vercel  
> doesn't recognize the domain and returns 404.

---

## 🟢 Verify After Deployment

After pushing and Vercel deploys (auto-triggered by git push):

### Health Check
```
GET https://solarpro-v31.vercel.app/api/system/health
```
Expected response (all vars set):
```json
{
  "status": "healthy",
  "checks": {
    "database":     { "ok": true, "latency_ms": 45 },
    "env_required": { "ok": true, "missing": [] },
    "env_optional": { "ok": true, "missing": [] },
    "base_url":     { "ok": true, "value": "https://solarpro-v31.vercel.app", "source": "NEXT_PUBLIC_APP_URL" },
    "email":        { "ok": true, "configured": true }
  }
}
```

If `status` is `"degraded"`, check `checks.env_optional.missing` for which vars to add.  
If `status` is `"unhealthy"`, check `checks.env_required.missing` and `checks.database`.

### Password Reset Flow
1. `POST /api/auth/request-password-reset` with `{ "email": "your@email.com" }`
2. Check inbox — email should arrive from `noreply@mail.solarpro.app`
3. Reset link should contain `https://solarpro-v31.vercel.app/auth/reset-password?token=...`
4. `POST /api/auth/reset-password` with the token should succeed

### Legacy Health Check
```
GET https://solarpro-v31.vercel.app/api/health
```
(Original endpoint — still works, returns compatible format)

---

## 📁 Files Changed in v47.36

```
ce19850  v47.36 — Infrastructure stabilization: URL consolidation + email domain fix
├── .env.example                                  — Added STRIPE_PRICE_*, MIGRATE_SECRET; consolidated URL docs
├── lib/email.ts                                  — Removed getAppUrl(); uses getBaseUrl(); from=noreply@mail.solarpro.app
├── lib/stripe.ts                                 — Uses getBaseUrl() (was: process.env.NEXT_PUBLIC_BASE_URL||localhost)
├── lib/billOcrEngine.ts                          — Removed local getBaseUrl(); imports from lib/env
├── app/api/proposals/[id]/share/route.ts         — Uses getBaseUrl() (was: origin||APP_URL||solarpro.app)
└── app/api/system/health/route.ts                — NEW: GET /api/system/health ops endpoint
```

---

## 🔗 URL Architecture (Post v47.36)

```
All URL generation
       │
       ▼
lib/env.ts → getBaseUrl()
       │
       ├── NEXT_PUBLIC_APP_URL        ← Set this in Vercel (PREFERRED)
       ├── NEXT_PUBLIC_BASE_URL       ← Legacy fallback (kept for compatibility)
       ├── VERCEL_URL                 ← Auto-set by Vercel (ephemeral — warns if used)
       └── 'https://solarpro-v31.vercel.app'  ← Hard-coded last resort
```

**Consumers of getBaseUrl():**
- `lib/email.ts` → password reset link URLs
- `lib/stripe.ts` → Stripe checkout `success_url` / `cancel_url` + portal `return_url`
- `lib/billOcrEngine.ts` → internal server-to-server `/api/ocr` call
- `app/api/proposals/[id]/share/route.ts` → proposal share link generation
- `app/api/system/health/route.ts` → reports the resolved value + source