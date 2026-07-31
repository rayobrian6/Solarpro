# Virtual Environment Security Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-026 — Virtual Environment Security Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new environment, new framework in scope, new cloud-vendor pattern, material change to a virtualized boundary) |
| **Scope** | Every virtualized environment that Solarpro runs code in or stores data in. Today: Vercel production deployment (solarpro.app), Vercel preview deployments (per-pull-request URLs), Vercel development deployment (the developer's Vercel project for local-to-cloud integration), the Render SAM2 service + worker (production + staging), and the Neon Postgres project (production branch, preview branches, development branch, scratch branches). The policy covers environment segregation, per-environment access, data segregation, resource limits, secrets per environment, network controls, and logging across all of the above. |

---

## 1. Purpose

This policy is the rule for **how Solarpro isolates the virtualized environments where the application runs**. It is the **ISO 27001 A.8.31 + ISO 27017 A.8.31** evidence — the cloud-specific control that requires the customer to document the segregation of virtual environments, the per-environment access control, the per-environment data segregation, and the per-environment resource limits.

Solarpro is a cloud-only deployment. There is no on-prem footprint, no bare-metal, no virtual machines managed by Solarpro. The "virtual environments" in scope are the environments the cloud providers expose to us: Vercel deployments (production, preview, development), Render services (production, staging), and Neon database branches (production, preview, development, scratch). Each of those environments is a separate runtime with its own configuration, its own data, its own access, and its own blast radius.

The 2026-07-30 control matrix row A.8.20 / A.8.22 (Network security + Segregation of networks) is "Not assessed." The row that maps to this policy most directly — the ISO 27017 A.8.31 cluster — was not enumerated in the 2026-07-30 control matrix at all. This policy fills that gap.

This policy is the **per-environment complement** to the Cloud Services Security Policy (#24) and the Shared Responsibility Matrix (#25). Policy #24 is the rule for the **cloud vendors**; this policy is the rule for the **virtualized environments inside the cloud vendors**. The two are read together. Where Policy #24 says "Vercel owns the hypervisor and the host OS; Solarpro owns the environment segregation and the per-environment data", this policy is the per-environment operational rule.

The policy also closes one of the 2026-07-30 control matrix's "Not assessed" findings. The audit was silent on the environment-to-environment boundary; this policy makes the boundary explicit and auditable.

## 2. The environment inventory

The environment inventory is the list of every virtualized environment Solarpro runs. The inventory is the source of truth; this section is the narrative view.

### 2.1 Vercel — application runtime

Vercel exposes three environment classes that Solarpro uses. The class is set automatically based on the deploy context; Solarpro configures the per-class rules.

- **Production** — the `solarpro.app` deployment. Branch: `master`. The Vercel project is `solarpro-web`; the production deployment is on the Vercel Pro plan. The production deployment is the customer-facing runtime. The branch protection rule (Policy #06 §4.2) requires Raymond's review before a merge to `master`. Every commit to `master` triggers a production deploy.
- **Preview** — the per-pull-request deployments. Branch: the PR head branch. Each PR opened against `master` gets a unique preview URL of the form `solarpro-web-<git-sha>-<team-slug>.vercel.app`. The preview is the QA environment; the PR author + the reviewer can interact with it. The preview auto-suspends after 7 days of inactivity (per Vercel's default; the §5.3 resource limit configures this).
- **Development** — the developer's local environment mapped to the Vercel project. The development environment is `localhost:3000`; the Vercel CLI proxies the API routes to the Vercel cloud for the runtime checks (env-var resolution, edge function execution, image optimization). The development environment is not deployed; it runs on the developer's machine.

The Vercel **Vercel Environment** variable is set automatically per the deploy context (`production`, `preview`, `development`). The application code reads this variable (via `process.env.VERCEL_ENV`) to make per-environment decisions. The `NODE_ENV` variable is **not** used as a security gate; it was identified as a P0 inconsistency in the 2026-07-30 control matrix and is closed by the §6 reference to `VERCEL_ENV`.

### 2.2 Render — SAM2 service + worker

Render exposes two service environments that Solarpro uses.

- **Production** — the `solarpro-sam2` service. The production service runs the SAM2 inference + the background worker on the Render Standard plan. The production service is deployed from the `master` branch. The service has a stable URL (`solarpro-sam2.onrender.com`); the URL is the API target for the Vercel application.
- **Staging** — the `solarpro-sam2-staging` service. The staging service runs on a smaller Render instance (Starter plan) and is used for pre-production testing. The staging service is deployed from the `dev` branch on every push. The staging service is suspended on inactivity (per Render's default 15-minute idle window).

The staging service uses a **different model cache** than production (the ONNX INT8 weights are the same, but the model cache directory is per-service). The staging service uses the **preview Neon branch** as the database (per §2.3).

### 2.3 Neon — Postgres branches

Neon's branching model treats every branch as a separate Postgres database with its own connection string. Solarpro uses four branch classes.

- **Production** — the `main` branch. The `main` branch is the production database. The connection string is in the Vercel production env vars (the `DATABASE_URL` env var). The PITR window is 7 days (Neon's default; the §5.3 resource limit configures this). The production branch is the only branch that holds customer PII.
- **Preview** — the per-pull-request branches. Each PR opened against `master` gets a Neon preview branch (created by the GitHub Actions workflow `compliance/workflows/db-preview.yml` on PR open; deleted on PR close). The preview branch is seeded with an anonymized production snapshot — the seed excludes PII (the §4.3 seeding rule).
- **Development** — the `dev` branch. The development branch is used by Cody for local development + by the Render staging service. The development branch is a long-lived copy of the production schema; the data is synthetic.
- **Scratch** — the per-engineer branches. Each engineer can create scratch branches for ad-hoc testing. The scratch branches are created on demand and deleted after 7 days (the §5.3 resource limit configures this).

The Neon **branch role** model means every branch has its own set of database users + roles. The role configuration per branch is the §4.4 IAM rule.

### 2.4 The full inventory

The virtualized environments.

| # | Provider | Environment class | Branch / identifier | Customer data? | Tier |
|---|---|---|---|---|---|
| 1 | **Vercel** | Production | `master` (solarpro.app) | Yes (PII) | Tier 1 |
| 2 | **Vercel** | Preview | per-PR URL | No (anonymized seed) | Tier 2 |
| 3 | **Vercel** | Development | localhost:3000 | No (synthetic) | Tier 3 |
| 4 | **Render** | Production | `solarpro-sam2` (master) | Yes (PII via inference) | Tier 1 |
| 5 | **Render** | Staging | `solarpro-sam2-staging` (dev) | No (synthetic) | Tier 2 |
| 6 | **Neon** | Production | `main` | Yes (PII) | Tier 1 |
| 7 | **Neon** | Preview | per-PR branch | No (anonymized seed) | Tier 2 |
| 8 | **Neon** | Development | `dev` | No (synthetic) | Tier 2 |
| 9 | **Neon** | Scratch | per-engineer branch | No (synthetic) | Tier 3 |

The "Tier" column follows Policy #24 §2.9 (Tier 1 = outage or compromise prevents serving customers; Tier 2 = degraded service; Tier 3 = dev tooling). The §3 segregation rule is the Tier-aware rule.

## 3. Environment segregation

The segregation rule is the **boundary** between environments. The boundary is enforced by the platform (Vercel, Render, Neon), by the application code (the per-environment guards), and by the data layer (the per-environment database).

### 3.1 The hard rule

**Customer PII may exist only in the production environments.** Specifically:

- **Vercel production** (`solarpro.app`) may read and write customer PII.
- **Render production** (`solarpro-sam2`) may receive customer PII (the aerial photos) via the Vercel application.
- **Neon production** (`main` branch) may store customer PII.
- **Vercel preview**, **Vercel development**, **Render staging**, **Neon preview**, **Neon development**, and **Neon scratch** must **not** contain customer PII.

The rule is enforced in three layers:

1. **The application code** (the per-environment guard in `lib/environment.ts`): the production data path is gated by a check that the `VERCEL_ENV === 'production'` AND the database connection string ends in the production Neon project ID. If either check fails, the production data path is not reachable.
2. **The database seeding** (§4.3): the preview / development / scratch databases are seeded with synthetic data or with an anonymized snapshot. The seed excludes PII by the §4.3 redaction rule.
3. **The platform isolation** (Vercel / Render / Neon): each environment has its own credentials, its own URL, its own IAM, and its own data store. There is no shared secret, no shared URL, no shared data.

The 2026-07-30 control matrix row CC6.7 (Restricts the transmission, movement, and removal of information) and A.5.34 (Privacy and protection of PII) are the controls this rule satisfies. The rule is the operational counter to the 2026-07-30 audit's "PII goes to third-party vision APIs without documented DPAs" finding (P0 #10).

### 3.2 The per-environment access rule

The per-environment access is the rule for **who can touch each environment**. The rule is least-privilege: a person gets access to the environment only if their work requires it.

| Environment | James (CEO) | Raymond (CISO) | Cody (Tech Lead) | Other |
|---|---|---|---|---|
| **Vercel production** (solarpro.app) | Read-only access (via Vercel audit log export) | **Full** (deploy, env-var, rollback) | **Full** (deploy, env-var, rollback via Vercel CLI; gated by `chore:` PR per Policy #06) | None |
| **Vercel preview** | Read-only access (via preview URL) | Read + comment | **Full** (deploy via PR; gated by PR review) | PR author + reviewer only |
| **Vercel development** | n/a | n/a | **Full** (local) | Personal dev only |
| **Render production** | Read-only access (via Render audit log) | **Full** (deploy, env-var, restart) | **Full** (deploy via `master` merge) | None |
| **Render staging** | n/a | Read | **Full** (deploy via `dev` push) | Personal dev only |
| **Neon production** | n/a | **Full** (via Neon console + SQL access) | **Full** (via SQL with role from DB) | None (read-only via migration scripts) |
| **Neon preview** | n/a | Read | **Full** (via SQL; auto-created per PR) | PR author + reviewer only |
| **Neon development** | n/a | n/a | **Full** (via SQL) | Personal dev only |
| **Neon scratch** | n/a | n/a | **Full** (own scratch) | Personal scratch only |

The rule is enforced by the platform IAM (Vercel / Render / Neon team membership) and by the application code (the per-environment guard). A person who has access to a non-production environment does **not** have access to production by default. The production access is granted explicitly by Raymond, with a written rationale (Linear issue), and is reviewed quarterly per the Access Control Policy (#03) UAR.

### 3.3 The per-environment guard (the application code)

The per-environment guard is a TypeScript module at `lib/environment.ts` that exposes the following functions:

- `isProduction()` → `boolean` — returns `true` only when `VERCEL_ENV === 'production'` AND the database connection string ends in the production Neon project ID AND the Vercel deployment URL is `solarpro.app` (or the Render URL is `solarpro-sam2.onrender.com`). All three checks must be `true`.
- `isPreview()` → `boolean` — returns `true` when `VERCEL_ENV === 'preview'`.
- `isDevelopment()` → `boolean` — returns `true` when `VERCEL_ENV === 'development'` OR `process.env.NODE_ENV === 'development'` AND the runtime is local (not a Vercel / Render deployment).
- `requireProductionEnvironment(actionName: string)` — throws a `NonProductionEnvironmentError` if `!isProduction()`. Used to gate any operation that must run in production only (e.g. the rate-limit reaper for the production quota, the cron job that emails James the daily customer count).

The guard is the application-level enforcement of the §3.1 hard rule. The `NODE_ENV === 'production'` check is **not** used — the 2026-07-30 control matrix P0 #2 finding was that `NODE_ENV` was the security gate in 8+ auth paths, and the 2026-07-30 security quickwins PR closed the gap by switching to `VERCEL_ENV`. The guard uses `VERCEL_ENV` exclusively.

## 4. Data segregation

The data segregation rule is the rule for **what data lives in each environment**. The rule is the §3.1 hard rule operationalized at the database level.

### 4.1 The production database

The production database is the Neon `main` branch. The `main` branch is the source of truth for customer data. Every table that contains customer PII (the `users`, `organizations`, `projects`, `proposals`, `site_surveys`, `survey_photos`, `audit_log` tables per Policy #04 §3.2) lives in `main`. The `main` branch is backed up per Policy #09 (Backup & Recovery) — 7-day PITR + daily export to R2. The `main` branch is the only branch that contains PII.

### 4.2 The preview database

The preview database is the per-PR Neon branch. The preview branch is created by the `db-preview.yml` workflow on PR open. The preview branch is initialized from the **schema-only** dump of `main` (no data) + a **synthetic seed** from `compliance/seed/seed.sql` (the synthetic seed is a fixed set of fake users, organizations, projects, proposals, and site surveys that exercise the application paths without real PII). The synthetic seed is committed to the repo; the seed is regenerated quarterly by Cody to exercise new application paths.

The preview branch is read-write for the PR author + the reviewer. The preview branch is read-only for everyone else. The preview branch is deleted on PR close by the `db-preview.yml` workflow.

### 4.3 The development database

The development database is the Neon `dev` branch. The `dev` branch is initialized from a **schema + anonymized data** dump of `main`. The anonymization is a one-way transformation applied by the `db-anonymize.yml` workflow:

- The `users.email` is replaced with a synthetic email of the form `user-<uuid>@solarpro-dev.invalid`.
- The `users.name`, `users.company`, `users.phone` are replaced with synthetic values of the same shape.
- The `site_surveys.inspector_email` and `inspector_name` are replaced with synthetic values.
- The `site_surveys.roof_conditions` and `obstructions` free-text fields are replaced with "REDACTED FOR DEV".
- The `survey_photos` URLs are replaced with placeholder URLs that return a generic image.
- The `audit_log` rows from the last 90 days are retained (for the application paths that read the audit log); older rows are deleted.

The `dev` branch is read-write for Cody + Raymond (for testing). The `dev` branch is read-only for James. The `dev` branch is the long-lived development environment; it is not auto-deleted.

### 4.4 The scratch database

The scratch database is the per-engineer Neon branch. The scratch branch is created on demand by the engineer via the Neon console or the `db-scratch.yml` workflow. The scratch branch is initialized from a **schema-only** dump of `main` + a minimal synthetic seed (10 users, 10 organizations, 10 projects). The scratch branch is auto-deleted after 7 days. The scratch branch is private to the engineer who created it.

### 4.5 The IAM for the database

The Neon role configuration is per-environment. The production database has a `solarpro_app` role (used by the Vercel + Render production runtime) with read-write access to the customer-data tables; a `solarpro_audit` role (used by the audit log collector) with read-only access; and a `solarpro_migration` role (used by the migration runner) with DDL + read-write. The preview / development / scratch databases have a single `solarpro_dev` role with full access; the production roles are not provisioned in non-production.

The production database is reachable only from the Vercel + Render production IP ranges (Neon IP allowlist configured per Neon console). The preview / development / scratch databases are reachable from any IP (the data is non-sensitive; the IP allowlist is a friction-reducer, not a security control, for non-production).

## 5. Resource limits

The resource limits are the rule for **how much each environment can consume**. The rule is the §5.1 baseline + the §5.2 per-environment overrides.

### 5.1 The baseline

- **Vercel** — Pro plan. Function execution: 100 GB-hours / month. Function duration: 60s (Hobby) / 300s (Pro) / 900s (Enterprise). Edge requests: 1M / month included. Bandwidth: 1 TB / month included.
- **Render** — Standard plan for production, Starter plan for staging. CPU: 0.5 CPU (Starter) / 2 CPU (Standard). RAM: 512 MB (Starter) / 4 GB (Standard). Auto-suspend: 15 min (Starter) / never (Standard).
- **Neon** — Launch plan (current; can scale to Scale on demand). Storage: 10 GB included. PITR: 7 days included. Compute: 0.25 CU included.

The baseline is the **maximum** Solarpro is willing to consume per month before a budget alert fires. The budget alert is wired to the `MAX_DAILY_COST_USD` and `MAX_MONTHLY_COST_USD` env vars (Policy #24 §7.5).

### 5.2 The per-environment overrides

- **Vercel preview** — function duration capped at 30s (the Vercel `functions.maxDuration` config in `vercel.json`). Bandwidth: no override. Function execution: no override (the cumulative preview usage is bounded by the §5.3 auto-suspend).
- **Vercel development** — no override (the local environment is the developer's machine; the Vercel CLI is a passthrough).
- **Render staging** — auto-suspend after 15 min of inactivity (the Render default; explicitly configured in the Render dashboard). CPU: 0.25 CPU (downgraded from the Starter default of 0.5 CPU to reduce cost). RAM: 256 MB.
- **Neon preview** — auto-delete on PR close (the §4.2 rule). PITR: off (preview branches are not backed up; the data is synthetic). Compute: 0.25 CU.
- **Neon development** — PITR: off (the data is synthetic; no recovery needed). Compute: 0.25 CU.
- **Neon scratch** — auto-delete after 7 days. PITR: off. Compute: 0.25 CU.

### 5.3 The lifecycle rules

- **Vercel preview** — auto-suspend after 7 days of inactivity (the Vercel default; the `vercel.json` `github.deploymentExpiration` field is configured to `7d`). The preview URL returns a 404 after 7 days; the PR comment is updated to reflect the suspension.
- **Render staging** — auto-suspend after 15 min of inactivity (the Render default; explicitly configured). The staging URL returns a 503 when suspended; the first request after suspension re-warms the service (~30s cold start).
- **Neon preview** — auto-delete on PR close (the `db-preview.yml` workflow).
- **Neon scratch** — auto-delete after 7 days (a daily cron checks the `created_at` column on the `neon.branches` table and deletes branches older than 7 days).

The lifecycle rules are the operational counter to the "abandoned preview environments accumulate cost" risk (Policy #24 §7.5).

## 6. Secrets per environment

The secrets rule is the rule for **which environment variables are set in which environment**. The rule is least-privilege: a secret is set in an environment only if the environment's runtime needs it.

### 6.1 The hard rule

**Production secrets must never be copied to preview or development environments.** The rule is enforced by the Vercel / Render environment variable configuration: the `production` env var scope is distinct from the `preview` and `development` scopes. A production secret (e.g. `STRIPE_LIVE_SECRET_KEY`) is set only in the `production` scope; a preview secret (e.g. `STRIPE_TEST_SECRET_KEY`) is set only in the `preview` and `development` scopes. There is no override that allows a preview / development environment to read a production secret.

The rule is the operational counter to the "production credentials leak to preview" risk (a real-world incident pattern in cloud deployments). The 2026-07-30 control matrix row CC6.1 (Logical access security) and A.5.17 (Authentication information) are the controls this rule satisfies.

### 6.2 The per-environment secret matrix

The matrix below lists the env vars that differ across environments. The env vars that are the **same** across environments (e.g. `NEXT_PUBLIC_SOLARPRO_APP_NAME`) are omitted from the matrix; they are set in all three Vercel scopes.

| Env var | Production | Preview | Development | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | Neon `main` connection string | Neon preview branch connection string | Neon `dev` branch connection string | Per §4 |
| `STRIPE_SECRET_KEY` | `sk_live_...` | `sk_test_...` | `sk_test_...` | Production uses live keys; preview / development use test keys |
| `STRIPE_WEBHOOK_SECRET` | Production webhook secret | Preview webhook secret | Local webhook proxy | Per §6.3 |
| `OPENAI_API_KEY` | Production key | Preview key (rate-limited) | Local key (rate-limited) | Per §6.4 |
| `ANTHROPIC_API_KEY` | Production key | Preview key (rate-limited) | Local key (rate-limited) | Per §6.4 |
| `GOOGLE_SOLAR_API_KEY` | Production key | Preview key (rate-limited) | Local key (rate-limited) | Per §6.4 |
| `GOOGLE_MAPS_API_KEY` | Production key | Preview key (HTTP-referer-restricted) | Local key (HTTP-referer-restricted) | Per §6.5 |
| `SENTRY_DSN` | Production DSN | Preview DSN | n/a (local) | Per §8 |
| `RESEND_API_KEY` | Production key | Preview key | Local key (logs to console) | Per §6.6 |
| `JWT_SECRET` | Production 32+ char secret | Preview 32+ char secret | Local dev secret (32+ char) | Per Policy #21 §3 |
| `MFA_ENCRYPTION_KEY` | Production 32+ char key | Preview 32+ char key | Local dev key (32+ char) | Per Policy #21 §3 |
| `CRON_SECRET` | Production secret | Preview secret | Local secret (any length) | Per §6.7 |
| `MAX_DAILY_COST_USD` | 500 (production cap) | 50 (preview cap) | n/a (no enforcement) | Per Policy #24 §7.5 |
| `VISION_DAILY_BUDGET_USD` | 200 (production cap) | 20 (preview cap) | n/a (no enforcement) | Per Policy #24 §7.5 |

The matrix is the source of truth for the per-environment configuration. The matrix is updated when a new env var is added (a PR review; the `compliance/workflows/env-fingerprint.yml` workflow verifies the matrix matches the actual Vercel env vars).

### 6.3 Stripe webhooks

The Stripe webhook secret is per-environment because the Stripe webhook URL is per-environment. The production webhook URL is `https://solarpro.app/api/webhooks/stripe`; the preview webhook URL is `https://<preview-url>.vercel.app/api/webhooks/stripe`. The Stripe CLI is used in development to forward webhooks from Stripe to `localhost:3000`. Each environment has its own webhook secret in Stripe; the env var matches.

### 6.4 Vision API keys

The vision API keys (OpenAI, Anthropic, Google Solar) are per-environment because the per-environment rate limits and cost caps differ. The production keys are the vendor's production tier; the preview / development keys are the vendor's free or development tier with lower rate limits. The rate limits are documented in the vendor's dashboard; the Solarpro-side enforcement is the `MAX_DAILY_COST_USD` + `VISION_DAILY_BUDGET_USD` env vars.

### 6.5 Google Maps API key restrictions

The Google Maps API key is restricted by HTTP referer in the Google Cloud Console. The production key is restricted to `https://solarpro.app/*`; the preview key is restricted to `https://*.vercel.app/*`; the local key is restricted to `http://localhost:3000/*`. A key used outside its referer is rejected by Google; the rejection surfaces as a 403 in the application.

### 6.6 Resend (email)

The Resend API key is per-environment. The production key sends from `noreply@solarpro.app`; the preview key sends from `noreply@preview.solarpro.app`; the development key logs the email to the console (no actual send). The `RESEND_API_KEY` is set to `console` in development to trigger the console-log path.

### 6.7 Cron secret

The cron secret is the HMAC secret used to authenticate the Vercel cron routes (`/api/cron/proposal-expiry`, `/api/cron/stale-job-cleanup`). The production secret is a 32+ char random string; the preview secret is a different 32+ char string; the development secret is any string (the local cron is unauthenticated). The cron routes verify the `Authorization: Bearer <CRON_SECRET>` header against the env var; the Vercel cron configuration sets the header automatically.

## 7. Network controls

The network controls are the per-environment firewall + CORS rules. The rule is the §7.1 baseline + the §7.2 per-environment overrides.

### 7.1 The baseline

- **CORS** — the API allows the production origin (`https://solarpro.app`) in production; allows the preview origins (`https://*.vercel.app`) + `http://localhost:3000` in preview / development. The CORS allowlist is configured in the Vercel `headers` config in `vercel.json`; the per-environment value is selected by the `VERCEL_ENV` check.
- **TLS** — TLS 1.2+ is enforced at the Vercel edge (per Policy #21 §5). HSTS is enabled with `max-age=63072000; includeSubDomains; preload` (per Policy #21 §5.1).
- **WAF** — Cloudflare WAF rules are enabled for the production origin; the rules are the Cloudflare managed rulesets + the §7.3 custom rules. The preview / development origins are not behind the Cloudflare WAF (the preview URL is a Vercel-managed subdomain).

### 7.2 The per-environment overrides

- **CORS** in preview — `https://*.vercel.app` + `http://localhost:3000` are allowed; the production origin is **not** allowed.
- **CORS** in development — `http://localhost:3000` is allowed; the production origin is **not** allowed.
- **Rate limits** in preview / development — the rate limits are 10x the production limits (per Vercel's per-environment rate limit config in `vercel.json`). The preview / development rate limits are not enforced by the `checkRateLimit()` helper (the helper is wired to the production rate limit env var); the limits are enforced by the Vercel platform.
- **Admin endpoints** (`/api/admin/*`) in preview / development — the admin endpoints are gated by `requireAdminApi()` (per Policy #03); the `requireAdminApi()` checks the `VERCEL_ENV` and rejects the request if the environment is not production AND the caller is not explicitly marked as a developer. The developer override is set via the `DEVELOPER_OVERRIDE_ENABLED` env var (which is `false` in production, `true` in preview / development).

### 7.3 The custom WAF rules

The custom WAF rules are the Solarpro-specific paths that the Cloudflare managed rulesets do not cover. The rules are:

- **Rule 1**: block requests to `/api/admin/*` from any IP that is not in the Solarpro office IP range (the office IP range is `192.0.2.0/24`; the rule is updated when the office IP range changes). The rule applies to the production origin only.
- **Rule 2**: block requests to `/api/cron/*` that do not include the `Authorization: Bearer <CRON_SECRET>` header. The rule applies to the production origin only.
- **Rule 3**: rate-limit the `/api/auth/login` route to 5 requests per IP per 15 minutes (the Cloudflare rate limit rule; complements the application-level rate limit). The rule applies to the production origin only.

The custom rules are documented in the Cloudflare dashboard; the WAF rule changes are PR-reviewed by Raymond.

## 8. Logging per environment

The logging rule is the rule for **what gets logged in each environment**. The rule is the §8.1 baseline + the §8.2 per-environment overrides.

### 8.1 The baseline

Every environment logs to the **same Sentry project** (`solarpro-web`). The Sentry event is tagged with the `environment` field (`production`, `preview`, `development`). The Sentry alerts route to Raymond + Cody (per Policy #08). The Sentry dashboard filters by environment.

The application audit log (`audit_log` table in Neon) is **production-only** by default. The audit log is not written in preview / development (the audit log would pollute the synthetic data with audit events that do not correspond to real user actions). The exception is the `audit_log` rows that the application reads for the audit log viewer (`/api/admin/audit-log`) — those reads are gated to production by the `requireAdminApi()` + `VERCEL_ENV` check.

### 8.2 The per-environment overrides

- **Sentry sample rate** — production: 100% of errors + 10% of transactions. Preview: 100% of errors + 100% of transactions (the lower traffic in preview means the full sample is acceptable). Development: 100% of errors, 0% of transactions (the console log captures the transactions).
- **Sentry PII** — production: PII fields are redacted by the `beforeSend` hook (per Policy #08 §3.2). Preview: PII fields are not redacted (the preview data is synthetic). Development: PII fields are not redacted (the development data is synthetic).
- **Console logs** — production: structured logger (Pino) + Sentry. Preview: structured logger + Sentry. Development: structured logger + console (the Sentry send is disabled in development to avoid noise).
- **Vendor logs** — the Vercel / Render / Neon audit logs are exported to the git evidence store (per `compliance/collectors/`) for all environments. The exports are tagged with the environment in the file path (`compliance/evidence/vercel/<env>/<date>/...`).

### 8.3 The "no production data in non-production" log assertion

The Sentry + the application audit log together enforce the §3.1 hard rule by **detection**: if a preview / development Sentry event contains a PII field (an email, a name, an address), the `beforeSend` hook flags the event as `production_pii_leak` and routes an alert to Raymond within 1 minute. The alert is a Sev1 incident (per Policy #05); the response is the §10 incident response.

## 9. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Approves new environment additions. Reviews the per-environment access quarterly (UAR). Triages environment-segregation violations. Approves WAF rule changes. Approves the per-environment secret matrix. |
| **Technical lead** | **Cody** | Implements the per-environment guard. Maintains the Vercel / Render / Neon environment configuration. Runs the daily + weekly environment checks. Co-runs the monthly environment access review. Investigates environment drift (e.g. a production secret that was accidentally set in a preview env). |
| **Management sign-off** | **James Carpenter** | Approves changes to the per-environment access matrix. Approves new Tier 1 environments. Approves cost-overrun exceptions. Signs off on the annual environment security review. |
| **All team members** | James, Raymond, Cody | Use the per-environment access rule (§3.2). Never copy production secrets to preview / development. Report environment drift to Raymond within 1 business day. Follow the §6 secret-handling rules. |

A violation (a production secret in a non-production env, a non-production PII leak, a non-production database connection string in a production env) is handled per the Information Security Policy (#01) §9.

## 10. Environment incident response

An environment incident is a violation of the §3 hard rule or the §6 secret-handling rule. The response is the Incident Response Plan (#05) §5 + this section.

### 10.1 The incident classes

- **PII leak to non-production** — a PII field is detected in a non-production Sentry event (the §8.3 alert). The response: (1) identify the source code path that leaked the PII; (2) identify the data subject(s) affected; (3) purge the PII from the non-production environment (the `db-anonymize.yml` workflow is re-run for development; the preview branch is deleted and recreated); (4) notify James + the data subject(s) per Policy #05 §5.5 + Policy #19 §3.
- **Production secret in non-production** — a production secret is detected in a non-production env (the §6 env-fingerprint check or a manual report). The response: (1) rotate the production secret immediately (per Policy #21 §8); (2) audit log review for the time the secret was in non-production; (3) purge the secret from the non-production env; (4) notify Raymond.
- **Non-production data in production** — a non-production database connection string is detected in a production env (the §3.3 `isProduction()` check fires). The response: (1) identify the source code path that made the call; (2) audit log review; (3) hot-patch the code; (4) postmortem per Policy #05 §7.

### 10.2 The detection cadence

- **Real-time** — the Sentry `beforeSend` hook (PII leak detection), the application `isProduction()` check (non-prod data in prod detection).
- **Daily** — the `env-fingerprint.yml` workflow compares the actual Vercel / Render env vars against the §6.2 matrix. Drift is reported to Raymond.
- **Weekly** — the `cloud-config-check.yml` workflow reviews the per-environment access (the §3.2 matrix vs. the actual Vercel / Render team membership). Drift is reported to Raymond.
- **Monthly** — Cody + Raymond review the §3.2 access matrix; the review is documented in `compliance/uar/`.
- **Quarterly** — the full UAR per Policy #03 §6.

## 11. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §2 inventory (new environments may have been added), a refresh of the §3 segregation rule (new vendor features may have changed the boundary), a refresh of the §4 data segregation rule (new data types may have been added), a refresh of the §5 resource limits (new vendor pricing may have changed the budget), a refresh of the §6 secret matrix (new env vars may have been added), a refresh of the §7 network controls (new WAF rules may have been added), and a refresh of the §8 logging rule (new Sentry features may have been added).
- **On material change** — within 30 days of any of: a new environment class (e.g. a new Vercel plan with a new environment class), a new framework in scope (e.g. ISO 27017 expansion), a new cloud-vendor pattern (e.g. multi-region deployment), a material change to a virtualized boundary (e.g. a Vercel → Render migration), or a material change to the per-environment secret matrix.
- **After every environment incident** — the postmortem identifies gaps in the §3 segregation rule, the §4 data segregation rule, the §6 secret matrix, the §7 network controls, or the §8 logging rule. The gaps are added to the §3, §4, §6, §7, or §8.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 12. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management, exceptions process.
- `compliance/policies/03-access-control.md` — the access control rule that the §3.2 per-environment access builds on.
- `compliance/policies/04-data-classification-handling.md` — the data classification that the §4 data segregation builds on (production = Confidential / Restricted; non-production = Public / Internal).
- `compliance/policies/05-incident-response.md` — the §10 environment incident response builds on Policy #05.
- `compliance/policies/06-change-management.md` — the change management rule for environment configuration changes.
- `compliance/policies/08-logging-monitoring.md` — the §8 logging rule builds on Policy #08 (the Sentry + audit log posture).
- `compliance/policies/15-password-authentication.md` — the secret strength rule that the §6 secret matrix references (32+ char minimum).
- `compliance/policies/21-encryption-key-management.md` — the secret management + rotation cadence that the §6 secret matrix references.
- `compliance/policies/23-patch-management.md` — the patch management rule for the per-environment dependencies.
- `compliance/policies/24-cloud-services-security.md` — the cloud vendors + shared responsibility rule. **Read together.**
- `compliance/policies/25-shared-responsibility-matrix.md` — the per-vendor table. The §3 segregation rule is the per-environment extension of the matrix.
- `compliance/CONTROL_MATRIX.md` — A.8.31, ISO 27017 A.8.31, CC6.1, CC6.6, CC6.7, A.5.15, A.5.17, A.5.34, A.8.20, A.8.22 evidence rows.
- `compliance/collectors/vercel.mjs` — the §8 vendor log exporter (the per-environment Vercel audit log).
- `compliance/collectors/render.mjs` — the §8 vendor log exporter (the per-environment Render audit log).
- `compliance/collectors/neon.mjs` — the §8 vendor log exporter (the per-environment Neon branch state).
- `lib/environment.ts` — the §3.3 per-environment guard (the `isProduction()` / `isPreview()` / `isDevelopment()` / `requireProductionEnvironment()` functions).
- `vercel.json` — the §5.2 per-environment override configuration (function duration, CORS, deployment expiration).
- `compliance/workflows/env-fingerprint.yml` — the §6.2 matrix verification workflow.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 9-environment inventory (Vercel production / preview / development; Render production / staging; Neon production / preview / development / scratch), the §3 segregation rule (PII in production only; per-environment access; per-environment guard in `lib/environment.ts`), the §4 data segregation rule (schema-only preview, anonymized dev, scratch per-engineer), the §5 resource limits (per-environment overrides + lifecycle), the §6 secret matrix (per-environment Stripe / OpenAI / Anthropic / Google / Resend / JWT / MFA / cron / cost-cap env vars; production secrets never copied to non-production), the §7 network controls (per-environment CORS, rate limits, admin endpoint gating, WAF rules), the §8 logging rule (Sentry per-environment tagging + PII redaction + the §8.3 "no production data in non-production" assertion), the §9 roles, the §10 environment incident response, and the §11 review cadence. Closes the 2026-07-30 control matrix "Not assessed" rows for A.8.20 / A.8.22 + the ISO 27017 A.8.31 cluster (not enumerated in the 2026-07-30 matrix). The paired Cloud Services Security Policy (#24) is the per-vendor rule; this policy is the per-environment extension. |
