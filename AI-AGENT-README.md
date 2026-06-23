# ⚠️ AI AGENT OPERATING MANUAL — READ THIS FIRST ⚠️

**Version:** 1.1.0 — 2026-05-18  
**Maintainer:** Ray (rayobrian6)  
**This file is the single source of truth for all AI agents working on this codebase.**  
**Every AI session MUST read this file before making any changes.**

---

## 0. MANDATORY TERMINOLOGY — NON-NEGOTIABLE

| Term | Meaning | WRONG (never use) |
|------|---------|-------------------|
| **website** | SolarPro — Next.js app on Vercel at `solarpro.solutions` | "SolarPro app", "web app", "frontend", "solar-pro" |
| **app** | Site Survey mobile app — React Native / Expo on Render | "partner app", "mobile", "partner", "survey tool" |
| **website database** | Neon PostgreSQL — owned by the website | `SOURCE_DATABASE_URL`, `WEBSITE_DATABASE_URL` |
| **app database** | Render PostgreSQL — owned by the app | `TARGET_DATABASE_URL`, `APP_DATABASE_URL` |
| **website backend** | Next.js API routes in `solarpro-git/app/api/` | |
| **app backend** | Express API in `site-survey-api/backend/` | |

**If you use the wrong terminology in code comments, commit messages, or logs — fix it.**

---

## 1. REPOS & LOCAL PATHS

| What | Local Path | GitHub Repo | Deploy |
|------|-----------|-------------|--------|
| **website** | `/workspace/solarpro-git/` | `rayobrian6/Solarpro` | Vercel → `solarpro.solutions` |
| **app** | `/workspace/site-survey-api/` | `rayobrian6/site_survey-app-1` | Render (backend) + Expo (mobile) |

### Git Push Pattern (ALWAYS use this exact pattern)
```bash
# Set token, push, remove token immediately
git remote set-url origin https://rayobrian6:ghp_REDACTED_SEE_PROJECT_CONTEXT@github.com/rayobrian6/<REPO>.git
git push origin master
git remote set-url origin https://github.com/rayobrian6/<REPO>.git
```

**Repos:**
- Website repo: `Solarpro`
- App repo: `site_survey-app-1`

---

## 2. ACCESS TOKENS — NEVER LOSE THESE

| Service | Token | Usage |
|---------|-------|-------|
| GitHub | `ghp_REDACTED_SEE_PROJECT_CONTEXT` | git push |
| Vercel | `vcp_REDACTED_SEE_PROJECT_CONTEXT` | `vercel --token <TOKEN>` |
| Render | `rnd_REDACTED_SEE_PROJECT_CONTEXT` | `Authorization: Bearer <TOKEN>` |

### Vercel API Pattern
```bash
curl -s "https://api.vercel.com/v9/projects/solarpro-v31/env" \
  -H "Authorization: Bearer vcp_REDACTED_SEE_PROJECT_CONTEXT"
```

### Render API Pattern
```bash
# Service ID for app backend: srv-d746gvshg0os739tqm70
curl -s "https://api.render.com/v1/services/srv-d746gvshg0os739tqm70/env-vars" \
  -H "Authorization: Bearer rnd_REDACTED_SEE_PROJECT_CONTEXT"
```

---

## 3. DEPLOYMENTS & URLS

| Service | URL | Platform | Service / Project ID |
|---------|-----|----------|---------------------|
| **website (PRODUCTION)** | `https://solarpro.solutions` | Vercel | project: `solarpro-v31` (prj_3z2bHLwC8PbzIivXWatE1GL2rp2n) |
| website (old alias) | `https://solar-pro.app` | Vercel | same project: `solarpro-v31` |
| **website (DEV)** | `https://solarpro-dev.vercel.app` | Vercel | project: `solarpro-dev` (prj_dOD6O0A02qEqR2xipZebIIBkL2WD) |
| app backend | `https://site-survey-api-bpyz.onrender.com` | Render | `srv-d746gvshg0os739tqm70` |
| app mobile | React Native / Expo | EAS Build | package: `com.sitesurvey.mobile` |

> ⚠️ **CRITICAL:** `solarpro.solutions` and `solarpro-dev.vercel.app` are **TWO DIFFERENT Vercel projects**.
> The mobile app hardcodes `https://solarpro.solutions/api/auth/authorize` — it ALWAYS hits `solarpro-v31`.
> If you need to check/fix env vars for the production SSO flow, you must use project `solarpro-v31`,
> NOT `solarpro-dev`. This distinction caused the "invalid signature" SSO bug in May 2026.

---

## 4. DATABASES

### Website Database (Neon PostgreSQL)
- **Env var:** `DATABASE_URL` (set on Vercel, encrypted)
- **Host:** `ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech`
- **Also known as:** `WEBSITE_DATABASE_URL` or `SOURCE_DATABASE_URL`
- **Owns:** `users`, `projects`, `project_physical_data`, `project_files`, `webhook_deliveries`

### App Database (Render PostgreSQL)
- **Env var:** `DATABASE_URL` (set on Render for app backend)
- **Host:** `dpg-d746qe1aae7s73bbv9e0-a.oregon-postgres.render.com`
- **DB name:** `site_survey_app`
- **Also known as:** `APP_DATABASE_URL` or `TARGET_DATABASE_URL`
- **Owns:** `surveys`, `survey_photos`, `checklist_items`, `webhook_deliveries` (app side)

### Double Database Sync — Credential Authority Rule
**The website database is the SOURCE OF TRUTH for user credentials.**  
If the app database has a user credential that doesn't match the website database, **the app database corrects itself** to match the website.

```
WEBSITE_DATABASE_URL (SOURCE_DATABASE_URL)  ← authority / source of truth
         ↓  on mismatch: app corrects itself
APP_DATABASE_URL (TARGET_DATABASE_URL)      ← corrects to match website
```

- This sync is implemented in: `site-survey-api/backend/src/services/`
- Env vars to set when wiring this up: `WEBSITE_DATABASE_URL` on the app backend (Render), pointing to the Neon connection string

---

## 5. SHARED SECRETS — MUST MATCH ON BOTH SIDES

These values are **identical** on both Vercel (website) and Render (app). If they ever differ, the handoff/webhook flow breaks.

```
SOLARPRO_HANDOFF_SECRET = prod_handoff_secret_2026_rotate_me
SURVEY_WEBHOOK_SECRET   = prod_handoff_secret_2026_rotate_me
```

> ⚠️ **NOTE:** Both secrets currently use the same value. They should be rotated to distinct values in a
> future security hardening pass, but changing either without updating the other side simultaneously
> will break the integration.

`JWT_SECRET` is NOT shared — it is used independently by each service for its own JWTs.

### How to rotate these secrets safely
1. Generate a new random hex: `openssl rand -hex 32`
2. Update Vercel (`solarpro-v31`) AND Render (`srv-d746gvshg0os739tqm70`) at the same time
3. Use `encrypted` type on Vercel (NOT `sensitive` — sensitive creates empty placeholders that silently
   override encrypted/plain values for the production target). This was the root cause of the May 2026
   "invalid signature" SSO bug.
4. Trigger redeploys on both services
5. Verify with the health endpoint: `https://solarpro.solutions/api/system/health`

---

## 6. ALL ENVIRONMENT VARIABLES

### Website (Vercel — project `solarpro-v31`) — PRODUCTION

> ⚠️ **Vercel env var type pitfall:** If you create a `sensitive`-type var for `production` target with an
> empty/placeholder value, it will SILENTLY override any `encrypted` or `plain` var with the same name
> for production, causing the production deployment to receive an empty string. Always use `encrypted`
> for secrets and `plain` for non-secret config. Delete any leftover `sensitive` placeholders.

```
DATABASE_URL                  = <Neon connection string — encrypted>
JWT_SECRET                    = <JWT secret — encrypted>
SOLARPRO_HANDOFF_SECRET       = prod_handoff_secret_2026_rotate_me   (encrypted, all envs)
SURVEY_WEBHOOK_SECRET         = prod_handoff_secret_2026_rotate_me   (encrypted, all envs)
PARTNER_BASE_URL              = https://site-survey-api-bpyz.onrender.com  (plain, all envs)
PARTNER_API_BEARER_TOKEN      = <long-lived JWT signed with app JWT_SECRET — see below>
HANDOFF_TOKEN_TTL_SECONDS     = 600                                  (plain, production)
SURVEY_INGEST_DEFAULT_USER_ID = 011526da-28fc-4c01-85a0-d52c0f578fdf
NEXT_PUBLIC_BASE_URL          = https://solarpro.solutions
NEXT_PUBLIC_APP_URL           = https://solarpro.solutions
MIGRATE_SECRET                = solarpro-migrate-2024
CRON_SECRET                   = 38747a11def95fd6b497f254fb4425d9a7874744f7d5772869ffff162a804c10  (encrypted, all envs)
ADMIN_OVERRIDE_EMAIL          = <team-member email — F-13, plain, all envs>
```

**Changes made 2026-05-18 (this fixes the SSO "invalid signature" bug):**
- `SOLARPRO_HANDOFF_SECRET`: deleted empty `sensitive` production placeholder (id: `rIrBhbVItL9mlV52`),
  created `encrypted` var (id: `KhL5oAzw173FFnrk`) with `prod_handoff_secret_2026_rotate_me`
- `SURVEY_WEBHOOK_SECRET`: deleted empty `sensitive` placeholder (id: `NGCrpwTkolXPIS1p`),
  created `encrypted` var (id: `FK00Povxk0pYdQeK`) with `prod_handoff_secret_2026_rotate_me`
- `HANDOFF_TOKEN_TTL_SECONDS`: deleted empty `sensitive` placeholder (id: `eOd4hAkwCIcVWl8H`),
  created `plain` production var (id: `2Ejn30DINRwRxV3N`) with value `600`
- `PARTNER_BASE_URL`: was only set for `preview,development` — created production var pointing to Render
- `CRON_SECRET`: was missing — created `encrypted` all-env var (id: `gS4aZEFQJA5nwOSl`)

### App Backend (Render — `srv-d746gvshg0os739tqm70`)

```
DATABASE_URL              = <Render Postgres — set in dashboard>
JWT_SECRET                = <app-side JWT secret — set in dashboard>
SOLARPRO_HANDOFF_SECRET   = prod_handoff_secret_2026_rotate_me
SURVEY_WEBHOOK_SECRET     = prod_handoff_secret_2026_rotate_me
SOLARPRO_API_URL          = https://solarpro.solutions           (was pointing to dev — FIXED 2026-05-18)
SOLARPRO_WEBHOOK_URL      = https://solarpro.solutions/api/webhooks/survey-complete  (FIXED 2026-05-18)
ALLOWED_ORIGINS           = https://solarpro.solutions,https://solar-pro.app,https://solarpro-dev.vercel.app
WEBSITE_DATABASE_URL      = <Neon connection string — for credential sync>
```

**Changes made 2026-05-18:**
- `SOLARPRO_API_URL`: was `https://solarpro-dev.vercel.app` → updated to `https://solarpro.solutions`
- `SOLARPRO_WEBHOOK_URL`: was pointing to dev → updated to `https://solarpro.solutions/api/webhooks/survey-complete`
- `ALLOWED_ORIGINS`: was missing `solarpro.solutions` → added it

### PARTNER_API_BEARER_TOKEN — How to Regenerate
This is a long-lived JWT (10yr) signed with the **app's** `JWT_SECRET`, role=admin.
```bash
python3 -c "
import jwt, time
print(jwt.encode({
  'userId': 'solarpro-ingest-service',
  'email': 'ingest@solarpro.internal',
  'username': 'solarpro-ingest',
  'role': 'admin',
  'iat': int(time.time()),
  'exp': int(time.time()) + (10 * 365 * 24 * 3600)
}, '<APP_JWT_SECRET>', algorithm='HS256'))
"
```
This token is set as `PARTNER_API_BEARER_TOKEN` on Vercel (used by the website to call the app backend).

---

## 7. DATA FLOW — SURVEY INGEST PIPELINE

```
[app — mobile]                           [app — backend (Render)]
User submits survey
  → POST /api/surveys
  → POST /:id/complete
  → enqueueSurveyCompleteWebhook()
  → HMAC-SHA256 signed POST ──────────── → webhook_deliveries (queued)
                                          processWebhookQueue()
                                               ↓
                               POST https://solarpro.solutions/api/webhooks/survey-complete
                                               ↓
[website — Next.js (Vercel)]
  verifyWebhookSignature()    ← SURVEY_WEBHOOK_SECRET
  idempotency check
  runIngestPipeline():
    A. validate owner (SURVEY_INGEST_DEFAULT_USER_ID)
    B. resolve project link (CREATE_ORPHAN / ATTACH / TRIAGE)
    C. fetchFullPayload()     ← GET app-backend/api/surveys/:id
                                 Authorization: Bearer PARTNER_API_BEARER_TOKEN
                              ⚠️  Step C is STUBBED (rawPayload=null) pending app team
                                 confirming GET /api/surveys/{id} bearer auth scheme
    D. transform (v1.0 transformer)
       site_name              → projectName
       site_address           → address
       latitude/longitude     → lat/lng
       metadata.rafter_spacing ('24in') → rafter_spacing_in: 24
       metadata.roof_age_years          → roof_age_years
       metadata.rafter_size + azimuth   → mounting_notes
       photos[].file_path               → full URL (PARTNER_BASE_URL + path)
    E. write to website DB:
       → projects (upsert)
       → project_physical_data (upsert)
       → project_files (insert, idempotent)
    F. mark webhook_deliveries.status = 'ingested'
```

### Handoff Flow (survey launched FROM website project)
```
website: POST /api/projects/:id/survey-handoff
  → mints HS256 JWT (SOLARPRO_HANDOFF_SECRET, TTL=HANDOFF_TOKEN_TTL_SECONDS seconds)
  → deep link: sitesurvey://new-survey?token=<jwt>

app: GET /api/handoff/:token
  → verifies JWT
  → returns project/user claims
  → NewSurveyScreen shows "Linked to SolarPro" banner
  → survey submitted with solarpro_project_id set
  → webhook routes to correct project (no orphan)
```

### SSO Login Flow (app login with website credentials)
```
app: LoginScreen opens browser → https://solarpro.solutions/api/auth/authorize
  → website mints HS256 JWT (SOLARPRO_HANDOFF_SECRET, ~10min TTL)
  → redirects to sitesurvey://auth/callback?token=<jwt>&state=<state>

app: ExpoLinking callback
  → POST /api/users/solarpro-sso with token (to site-survey-api backend)
  → backend verifies JWT with SOLARPRO_HANDOFF_SECRET
  → returns app JWT
  → user is logged in

⚠️  The authorize URL is HARDCODED to https://solarpro.solutions in LoginScreen.tsx.
    It ALWAYS hits the production Vercel project (solarpro-v31), never dev.
```

---

## 8. KEY FILE MAP

### Website (`/workspace/solarpro-git/`)
| File | Purpose |
|------|---------|
| `app/api/webhooks/survey-complete/route.ts` | Receives survey webhook, runs ingest |
| `app/api/projects/[id]/survey-handoff/route.ts` | Mints handoff JWT, returns deep link |
| `app/api/auth/authorize/route.ts` | Mints SSO JWT (HS256, SOLARPRO_HANDOFF_SECRET) |
| `lib/survey/ingest/ingestPipeline.ts` | Pipeline orchestrator (Steps A–F) |
| `lib/survey/ingest/transformLayer.ts` | v1.0 + v2.0 transformers, field mapping |
| `lib/survey/ingest/payloadFetcher.ts` | Fetches full survey from app backend |
| `lib/survey/ingest/projectLinkResolver.ts` | CREATE_ORPHAN / ATTACH / TRIAGE logic |
| `lib/survey/ingest/ownerResolver.ts` | Resolves SolarPro user from webhook claims |
| `lib/survey/envelopeValidator.ts` | Validates inbound webhook envelope shape |
| `lib/survey/verifyWebhookSignature.ts` | HMAC-SHA256 signature verification |
| `lib/siteSurvey/fromPhysicalData.ts` | DB → RawSurveyPayload bridge (read-only) |
| `app/api/system/health/route.ts` | Health check — use to verify prod after deploy |
| `app/api/cron/proposal-expiry/route.ts` | Daily cron (requires `CRON_SECRET` header) |
| `vercel.json` | Cron config: proposal-expiry at 0 8 * * * |
| `lib/db/` | Domain DB modules (split from db-neon.ts in v1.1.0) |
| `lib/bill/hydrateBillData.ts` | Bill hydration (extracted in v1.1.0) |

### App Backend (`/workspace/site-survey-api/backend/src/`)
| File | Purpose |
|------|---------|
| `routes/surveys.ts` | All survey CRUD, GET /api/surveys/:id |
| `routes/users.ts` | Auth, registration, SSO verify (POST /api/users/solarpro-sso) |
| `routes/handoff.ts` | GET /api/handoff/:token — consumes JWT |
| `services/webhookService.ts` | enqueueSurveyCompleteWebhook, processWebhookQueue |
| `middleware/auth.ts` | Bearer token auth middleware |
| `utils/authToken.ts` | JWT sign/verify with JWT_SECRET |

### App Mobile (`/workspace/site-survey-api/mobile/src/`)
| File | Purpose |
|------|---------|
| `screens/LoginScreen.tsx` | Login UI — SSO button opens browser to `https://solarpro.solutions/api/auth/authorize` (hardcoded) |
| `api/client.ts` | `exchangeSolarProSso(token)` → POST /api/users/solarpro-sso |
| `context/AuthContext.tsx` | Auth state, signInWithSolarPro() |

---

## 9. COMMIT & DEPLOYMENT RULES

### Before Every Commit
1. **TypeScript must compile clean:** `node_modules/.bin/tsc --noEmit`
2. **No hardcoded secrets** in source code — use env vars
3. **Test the affected endpoint** before pushing
4. **Update this README** if architecture changes

### Commit Message Format
```
type(scope): short description

- bullet: what changed and why
- bullet: what was broken before
- bullet: what test confirmed it works
```
Types: `fix`, `feat`, `refactor`, `chore`, `docs`
Scopes: `ingest`, `handoff`, `sso`, `auth`, `webhook`, `db`, `mobile`, `website`

### Deployment
- **Website:** Push to `master` on `rayobrian6/Solarpro` → Vercel auto-deploys to `solarpro-v31`
- **App backend:** Push to `main` on `rayobrian6/site_survey-app-1` → Render auto-deploys
- **App mobile:** Run `eas build --platform android --profile production` (must be logged in as `kilby`)

### Branch Strategy
- `master` branch → deploys to production (`solarpro.solutions` / `solarpro-v31`)
- `dev` branch → deploys to dev preview (`solarpro-dev.vercel.app` / `solarpro-dev`)
- Always work on `dev`, then merge to `master` when stable

### After Deploying Website
Wait for Vercel to show `READY`:
```bash
curl -s "https://api.vercel.com/v6/deployments?projectId=solarpro-v31&limit=2" \
  -H "Authorization: Bearer vcp_REDACTED_SEE_PROJECT_CONTEXT" \
  | python3 -c "import sys,json; [print(d['state'], d['url']) for d in json.load(sys.stdin)['deployments']]"
```

Then verify production health:
```bash
curl -s https://solarpro.solutions/api/system/health | python3 -m json.tool
```

---

## 10. REGRESSION RULES — NEVER BREAK THESE

### 🔴 CRITICAL — Breaking these takes the whole system down

1. **`SURVEY_WEBHOOK_SECRET` must be identical on both sides.** If the website and app have different values, all webhooks fail with 401 and no surveys ever ingest.

2. **`SOLARPRO_HANDOFF_SECRET` must be identical on both sides.** If different, all handoff JWTs fail to verify and surveyors cannot launch linked surveys. Also breaks SSO login.

3. **`PARTNER_API_BEARER_TOKEN` must be a valid JWT signed with the app's `JWT_SECRET`.** It is NOT a static hex string. If you change `JWT_SECRET` on the app backend, regenerate this token and update it on Vercel.

4. **The `sitesurvey://` deep link scheme must remain registered in `app.json`.** Removing it breaks SSO login and handoff launch from the website.

5. **`ON CONFLICT (user_id, survey_external_id)` in `_upsertProject`.** This unique constraint makes ingest idempotent. Do not remove it.

6. **`ON CONFLICT (project_id, external_id)` in `_insertFiles`.** Same — makes file inserts replay-safe.

7. **Never use `sensitive`-type on Vercel for production secrets.** The `sensitive` type creates an empty placeholder that silently overrides `encrypted`/`plain` vars of the same name for the production target. Always use `encrypted` for secrets. (Root cause of May 2026 SSO bug.)

### 🟡 HIGH — Breaking these causes data loss or silent failures

8. **v1.0 transformer field names are confirmed against live partner payload.** The partner sends `latitude`/`longitude` (not `lat`/`lng`) and `photos[].file_path` (not `url`). Do not rename these back.

9. **`requireAuth` middleware on `GET /api/surveys/:id`** must stay in place. The ingest service authenticates with `PARTNER_API_BEARER_TOKEN` as a JWT — not a static key.

10. **`webhook_deliveries` idempotency check** uses `event_id`. Never remove the duplicate check or you'll double-ingest surveys.

11. **`resolveIngestOwner` fallback to `SURVEY_INGEST_DEFAULT_USER_ID`** must stay. Without it, surveys submitted without a handoff token (standalone app use) have no owner and ingest fails entirely.

### 🟢 MEDIUM — Breaking these causes degraded experience

12. **`fromPhysicalData.ts` is read-only** — it only SELECTs. Never add writes to it.

13. **`physicalData: null` in degraded mode** is intentional — the pipeline continues without physical data rather than failing. Don't change this to a hard failure.

14. **`buildPhotoUrl()` in `payloadFetcher.ts`** prepends `PARTNER_BASE_URL` to `/uploads/...` paths. The v1.0 transformer also does this for `file_path`. Don't duplicate or conflict these.

---

## 11. KNOWN OPEN ISSUES

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| F-13 | MEDIUM | **CLOSED** (2026-06-19) | `carpenterjames88@gmail.com` hardcoded as admin override in `app/api/migrate/route.ts` — moved to `ADMIN_OVERRIDE_EMAIL` env var with fail-closed behavior in `lib/auth.ts getAdminOverrideEmail()`. Tests in `tests/admin-override-env.test.ts`. |
| G-04 | MEDIUM | OPEN | `fallbackSurvey.ts` HandoffClaims missing F-06 ownership fields |
| F-07 | MEDIUM | OPEN | JWT in URL query string on fallback GET route |
| F-18 | MEDIUM | OPEN | SQLite (auth) + PostgreSQL (surveys) dual storage identity split in app |
| GAP-3 | LOW | OPEN | Survey ingest Step C stubbed (rawPayload=null) — pending app team confirming GET /api/surveys/{id} bearer auth contract |
| GAP-4 | LOW | OPEN | Sentry not configured (`SENTRY_DSN` not set) — monitoring is console-only |
| GAP-K | LOW | OPEN | 6 tutorial video IDs in TUTORIAL_CONFIG are placeholders (`PLACEHOLDER_BILL`, `PLACEHOLDER_SYSTEM`, etc.) in `app/projects/[id]/page.tsx` — user must supply YouTube video IDs |

---

## 12. TESTING A WEBHOOK END-TO-END

Use this script to fire a real webhook and verify the full pipeline:

```python
import hmac, hashlib, time, json, urllib.request, uuid

SURVEY_WEBHOOK_SECRET = "prod_handoff_secret_2026_rotate_me"
SOLARPRO_WEBHOOK_URL = "https://solarpro.solutions/api/webhooks/survey-complete"

survey_id = "<SURVEY_UUID_FROM_APP_DB>"
event_id = str(uuid.uuid4())
timestamp = str(int(time.time()))

payload = {
    "event": "survey.completed",
    "event_id": event_id,
    "occurred_at": "2026-05-18T00:00:00.000Z",
    "survey_id": survey_id,
    "status": "submitted",
    "project_name": "Test Survey",
    "project_id": None,
    "inspector_name": "Test",
    "site_name": "Test Site",
    "completed_at": "2026-05-18T00:00:00.000Z",
    "solarpro_user_id": None,
    "solarpro_project_id": None,
    "solarpro_email": None,
}

body = json.dumps(payload)
sig = hmac.new(SURVEY_WEBHOOK_SECRET.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()

req = urllib.request.Request(SOLARPRO_WEBHOOK_URL, data=body.encode(), headers={
    "Content-Type": "application/json",
    "X-Survey-Signature": f"sha256={sig}",
    "X-Survey-Timestamp": timestamp,
    "X-Survey-Event-Id": event_id,
}, method="POST")

with urllib.request.urlopen(req, timeout=30) as resp:
    print(json.dumps(json.loads(resp.read().decode()), indent=2))
```

**Expected success response:**
```json
{
  "reason": "INGEST_OK",
  "transformSummary": {
    "fileCount": 7,
    "hasPhysicalData": true,
    "rafterSpacingIn": 24
  }
}
```

---

## 13. DATABASE SYNC — CREDENTIAL AUTHORITY

The website database (Neon) is always correct for user credentials.
If a user exists in both databases with mismatched credentials, the app database self-corrects to match the website database.

### Env Vars Required
```
# Set on app backend (Render):
WEBSITE_DATABASE_URL=<Neon connection string>   # source of truth
# or
SOURCE_DATABASE_URL=<Neon connection string>

# The app's own database is its existing DATABASE_URL (TARGET)
```

### Sync Logic Location
- Service file: `site-survey-api/backend/src/services/`
- Triggered on: user login, registration, credential mismatch detection
- Direction: **website → app only** (never app → website)

### IdentityLink contract — surveys (F-18, 2026-06-23)

Beyond credential authority, the app's `surveys` rows reference users
via a **point-in-time link**, not a live foreign key. The contract:

- **`solarpro_user_id`** (TEXT on both `mobile.surveys` and
  `app_db.surveys`) is the **only authoritative identity reference**
  between the website Neon `users.id` and the app side. Stable for
  the lifetime of the user. Set at submission time from the SSO
  handoff JWT claim.
  - `mobile.surveys.solarpro_user_id` — see
    `mobile/src/database/schema.ts:28` (mobile SQLite).
  - `app_db.surveys.solarpro_user_id` — see `database/schema.sql:69`
    + `database/migrations/001_add_solarpro_ownership.sql:5`.
- **`solarpro_email`, `solarpro_project_id`, `solarpro_org_id`** are
  **SNAPSHOTS captured at submission time**. They are NOT refreshed
  from Neon. If a Neon user's email changes, every previously
  submitted survey keeps the old email — by design (historical record).
  These columns are **deprecated as of F-18 Step 4** (migration
  `003_drop_inspector_name_and_snapshot_columns.sql`).
- **`inspector_name`** is a free-text field that is being replaced by
  a derivation: `inspector_name = users_cache.full_name ?? "Unknown"`.
  The mobile `users_cache` table is added in F-18 Step 2; the
  derivation is wired in Step 3; the columns are dropped in Steps 4
  (app) and 6 (website).
- **Ingest owner resolution**: the website's `lib/survey/ingest/*`
  pipeline resolves the survey owner by **looking up Neon directly
  by `solarpro_user_id`** at ingest time (F-18 Step 5). On Neon
  failure, fall back to `SURVEY_INGEST_DEFAULT_USER_ID` per A10 R11.
  Do NOT rely on the snapshot columns for current display data.

**Orphan reference failure mode:** the contract accepts that if a
Neon user is hard-deleted, app-side `surveys.solarpro_user_id`
references become orphans (no FK across separate databases). Future
agents must surface orphan references before any hard Neon delete.

**Full contract doc** (including scope exceptions and future-agent
checklist): see `C:\Users\carpe\source\repos\site_survey-app\docs\IDENTITY_LINK.md`
(additive, F-18 Step 1 deliverable).

---

## 14. HOW AI AGENTS SHOULD PICK UP COMMIT CONTEXT

When starting a session on this codebase:

1. **Read this file first** (`AI-AGENT-README.md`)
2. **Check git log** for recent commits: `git log --oneline -10`
3. **Check Vercel deployment state** before making website changes
4. **Never assume env vars** — verify via Vercel/Render API before trusting
5. **Check which branch you're on** (`git branch`) — work on `dev`, not `master`

### Detecting Conflicting Commits
```bash
# Before pushing, always pull first
git pull origin dev

# Check if your changes conflict with remote
git diff HEAD origin/dev -- <file>

# If conflict on ingest/transform files — READ THE PIPELINE DOCS IN SECTION 7
# before resolving. Field name changes have cascading effects.
```

### Dev → Master Merge Pattern
```bash
# When dev is stable and ready for production:
git checkout master
git merge dev
git push origin master
git checkout dev
```

### If Two Bots Are Working Simultaneously
- Bot A owns: website (`solarpro-git/`) changes
- Bot B owns: app (`site-survey-api/`) changes
- **Neither bot touches the other's repo without explicit user instruction**
- Both bots must read this file at session start to avoid contradicting each other

---

## 15. PRODUCTION READINESS STATUS (as of 2026-05-18)

**Overall: ~90% production-stable**

| Area | Status | Notes |
|------|--------|-------|
| SSO login | ✅ FIXED | Secrets corrected on both sides (May 2026) |
| Survey webhook ingest | ✅ Working (Steps A,B,D,E,F) | Step C stubbed pending app team |
| Stripe webhooks | ✅ Fully implemented | checkout, subscription, invoice events |
| Email notifications | ✅ Implemented | password reset, proposal, portal, expiry |
| Cron (proposal expiry) | ✅ CRON_SECRET set | Daily at 08:00 UTC |
| Database migrations | ✅ 042+043 applied | PL/pgSQL fix also applied |
| Sentry monitoring | ⚠️ Not configured | Console-only; SENTRY_DSN not set |
| Tutorial videos | ⚠️ Placeholders | 6 YouTube IDs needed from Ray |
| CAD permit planset | ⏳ Pending | Waiting for SS app data flow |

---

*Last updated: 2026-05-18 | Updated by: AI agent session (SSO bug fix + env var audit)*  
*To update this file: edit `/workspace/solarpro-git/AI-AGENT-README.md` and commit to master*
