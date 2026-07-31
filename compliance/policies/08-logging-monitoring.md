# Logging & Monitoring Policy

| Field | Value |
|---|---|
| **Policy** | POL-OP-005 — Logging & Monitoring Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro production systems, all non-production environments that touch production data, and every action that touches a customer account, customer data, or an admin function. |

---

## 1. Purpose

This policy is the rule for what we log, where we log it, how long we keep it, and how we watch it. It's the **SOC 2 CC7.2 + ISO 27001 A.8.15 / A.8.16** evidence: that we record security-relevant events in a structured, queryable form, retain them long enough to investigate and audit, and review them often enough to catch drift before customers do.

This policy specifically closes the **2026-07-30 P0 finding** documented in `audit_code_quality` §2 #3 and §7.2: **207 empty `} catch {}` swallows** (160 of them in `components/3d/SolarEngine3D.tsx` alone) and **2,537 unstructured `console.*` calls across 521 files with no structured logger**. Silent failure is the single most dangerous pattern in the Solarpro application today — a 3D view can fail to redraw with zero operator signal, a vision API can return malformed data with no alert, and a migration governance gate can be bypassed with no log entry. The auditor will read that as "the control environment cannot demonstrate that components of internal control are present and functioning." This policy makes the silent path loud.

## 2. Scope

This policy applies to every component of the Solarpro stack:

- **Next.js application** on Vercel — every API route, every server action, every middleware, every auth event, every admin action, every rate-limit decision.
- **Python SAM2 service** on Render — every inference request, every model load, every cache hit/miss, every error.
- **Postgres on Neon** — every admin write, every auth event, every migration run, every cross-organization access.
- **Background workers and cron jobs** — `vercel.json` cron routes (`/api/cron/proposal-expiry`, `/api/cron/stale-job-cleanup`), the SAM2 worker, any future job.
- **Customer-facing errors** captured by Sentry — both server and client.
- **Vendor-side events** that we receive — Stripe webhooks, survey webhooks, Meta webhooks, Google webhooks, generic HMAC webhooks.

Out of scope: read-only data analysis, internal documentation, code-review comments. Those are not security-relevant events.

## 3. Required log fields

Every security-relevant log entry is structured. Structured means: a stable schema, machine-parseable, queryable, and consistent across services. The schema is below; every log entry must include at least these fields.

| Field | Type | Required | Description | Example |
|---|---|---|---|---|
| `timestamp` | ISO 8601 UTC | **Yes** | When the event occurred, in UTC, millisecond precision. | `2026-08-15T18:42:11.482Z` |
| `actor` | string or null | **Yes** | Who or what triggered the event. For user actions: the user ID. For system actions: the service name. For unauthenticated requests: `anonymous`. | `user_8a3f...`, `service:sam2-worker`, `anonymous` |
| `actor_ip` | string or null | **Yes** | The source IP of the request. For internal services: the platform-provided identifier. | `192.0.2.42`, `service:vercel-cron` |
| `action` | string | **Yes** | What was attempted. A verb-noun pair, dotted namespace. | `auth.login`, `project.create`, `migration.run`, `rate_limit.block`, `admin.role_change` |
| `target` | string or null | **Yes** | The resource affected. For org-scoped actions: the org ID. For project actions: the project ID. | `org_4b2c...`, `project_77e1...`, null |
| `result` | enum | **Yes** | `success`, `failure`, `denied`, `error`. The literal string. | `success` |
| `reason` | string or null | Conditional | A human-readable reason for `denied` or `error`. Stable string from a known set; not free-form user input. | `invalid_credentials`, `rate_limit_exceeded`, `mfa_required` |
| `request_id` | string | **Yes** | The request correlation ID, propagated through every service the request touches. | `req_01HXY...` |
| `session_id` | string or null | Conditional | The session ID for authenticated requests. Null for anonymous. | `sess_...`, null |
| `user_agent` | string or null | Conditional | The user agent, if a browser request. | `Mozilla/5.0 ...`, null |
| `duration_ms` | integer | Conditional | The duration of the operation in milliseconds. Required for any action that takes measurable time. | `142` |
| `metadata` | object | Optional | Additional structured fields specific to the action. The schema is action-specific; documented per action. | `{"migration": "0118_..."}` |

The schema is enforced by a TypeScript type (`LogEvent` in `lib/logging/types.ts` once the structured logger lands) and a Zod validator. A log entry that fails validation is itself logged at the `error` level with the malformed payload, then dropped from the main stream.

### 3.1 What is "security-relevant"

The following are always security-relevant and must be logged:

- Every authentication event (login, logout, MFA challenge, MFA success, MFA failure, password change, session refresh, session expiration).
- Every authorization decision (`denied` is the most important; `success` for admin actions is required).
- Every admin or super-admin action.
- Every data access that returns Restricted data (PII, credentials, billing data).
- Every rate-limit decision (`blocked` is required; `allowed` sampled).
- Every webhook receipt (success and failure).
- Every cron job run (start, end, items processed, errors).
- Every error in a code path that handles the above.
- Every migration run (the `MIGRATION-GOV-13` audit log is exemplary; this policy extends that pattern).

What is **not** security-relevant and does not need to be logged at the security level: routine read queries against public data, render-only frontend events, build-time logs.

## 4. Log destinations

Logs flow to four destinations, each with a different purpose.

| Destination | What goes here | Retention | Owner |
|---|---|---|---|
| **Neon `audit_log` table** | Application audit events: auth, admin actions, authorization decisions, data access to Restricted data, rate-limit decisions, cron runs, migration runs. | 90 days hot, 1 year warm, 7 years cold (see §6). | Raymond (schema) + Cody (operations) |
| **Vercel logs** | All Vercel platform events: function invocations, build logs, edge requests, middleware decisions. | 30 days on Vercel's dashboard; mirrored to R2 for 7 years. | Cody (platform) |
| **Render logs** | SAM2 service logs: inference requests, model loads, cache hits, errors. | 30 days on Render's dashboard; mirrored to R2 for 7 years. | Cody (platform) |
| **Sentry** | Application errors and unhandled exceptions, both server and client. PII-redacted at the source (see §7). | 90 days on Sentry's plan; mirrored to R2 for 7 years. | Raymond (alerting) |

A log entry that is security-relevant **must** land in the Neon `audit_log` table, regardless of whether it also lands in Vercel / Render / Sentry. The audit log is the source of truth; the platform logs are debugging context.

### 4.1 The audit log table

The `audit_log` table is the canonical security event store. Schema:

- `id` — UUID.
- `timestamp` — TIMESTAMPTZ, indexed.
- `actor` — TEXT, indexed.
- `actor_ip` — INET.
- `action` — TEXT, indexed.
- `target` — TEXT, indexed.
- `result` — TEXT, indexed.
- `reason` — TEXT NULL.
- `request_id` — TEXT, indexed.
- `session_id` — TEXT NULL.
- `metadata` — JSONB.
- `redacted_fields` — TEXT[] — list of fields that were redacted before write (see §7).

The table is append-only. There is no `UPDATE` or `DELETE` path. Schema changes are migrations, governed by the Change Management Policy and the four-gate migration governance.

## 5. The "no silent catch" rule

**Silent catches are forbidden.** An empty `} catch {}` block, a `catch (e) {}` that discards the error, or any pattern that swallows an exception without recording it is a control deficiency.

### 5.1 What "loud" means

A catch block is "loud" if it does at least one of the following:

1. **Re-throws** the error to a higher-level handler that does log.
2. **Records the error** in the audit log (preferred) or in a structured logger with a `result: 'error'` entry and a stable `reason` string.
3. **Returns a typed failure** to the caller that is itself logged by the caller.

The exact log shape is up to the code; the requirement is that the failure is observable to the operator. A Sentry event satisfies this; a `console.error` does not (see §5.3).

### 5.2 The `safeViewerOp()` helper

For the 160 silent catches in `components/3d/SolarEngine3D.tsx`, the policy mandates the `safeViewerOp()` helper pattern. The helper:

- Wraps a Cesium call in a try/catch.
- Logs the error with a stable `action` (e.g. `cesium.scene.render`) and the result `error`.
- Returns a typed result to the caller so the caller can decide whether to retry, fall back, or surface the error to the user.
- Emits a Sentry event for any unhandled inner exception.

The helper is added in Sprint 2 alongside the structured logger. Until then, every silent catch in a viewer path is a documented exception (see §5.4) or a P0 finding.

### 5.3 Why `console.error` is not enough

`console.error` writes to the platform's stdout. It is not queryable, not alerted, and not retained beyond the platform's log window. The 2,537 unstructured `console.*` calls in the Solarpro application today are debugging context, not security evidence. The migration to a structured logger (Pino, in Sprint 2) is the tactical fix; this policy is the rule that says "no new `console.*` calls except at the entry point of a structured logger, and every existing call is converted as it is touched."

The ESLint rule `no-console` is promoted from `warn` to `error` in the relevant paths. The existing 1,470 `log`/`info`/`debug` calls that are warnings today remain warnings for the conversion sweep; new code uses the structured logger.

### 5.4 Exception process for legacy silent catches

The 207 existing silent catches cannot be fixed in a single PR. The exception process:

1. **Inventory**: the 207 locations are listed in `compliance/monitoring/silent-catches-inventory.md`, organized by file and severity.
2. **Wave plan**: 50 per Sprint, starting Sprint 2. Each wave converts a batch to `safeViewerOp()` or to an explicit logged error.
3. **Per-PR evidence**: each wave PR includes the before/after count, the Sentry signal (the new error rate is at least as high as the silent rate, confirming the catches are actually firing), and a test that the converted code path is now observable.
4. **Acceptable exceptions**: a silent catch that is genuinely fine (a try around a feature-detection probe, for example) is documented in the inventory with a `reviewed: ok` annotation and a reviewer signature. The exception is per-call-site, not per-file.

The target: zero unaccounted silent catches by end of Sprint 4. The auditor will check.

## 6. Retention

| Tier | Duration | Storage | Queryable? |
|---|---|---|---|
| **Hot** | 90 days | Neon `audit_log` table; Sentry; platform dashboards | Yes, full-text and structured. |
| **Warm** | 1 year (90 days → 1 year) | R2 evidence bucket, JSON-line format, partitioned by month. Indexed in R2 metadata. | Yes, via the audit-log query tool (`scripts/audit-query.mjs`). |
| **Cold** | 7 years (1 year → 7 years) | R2 with the `cold` storage class; same partition scheme. | On-request only; budget per audit cycle. |
| **Beyond 7 years** | — | Not retained. The audit log is the operator's record, not the customer's. | — |

The 7-year cold retention matches the SOC 2 and ISO 27001 audit-record retention expectations. It is also the most conservative practical number — the auditor will accept 7 years without question; they may push back on less.

### 6.1 The PII redaction check at retention boundary

When a log entry is moved from hot to warm, the `redacted_fields` column is checked. Any field that was redacted at write time is verified to still be redacted in the warm copy. This is a defensive check against a regression in the redaction layer.

## 7. PII redaction

A specific list of fields must **never** appear in a log entry, in any tier, in any destination. The list is enforced by the structured logger's redaction layer (configured at logger init) and verified by the weekly monitoring digest.

### 7.1 The redaction list

| Field | Reason | Notes |
|---|---|---|
| **Passwords** (plain or hashed) | Authentication secret. | bcrypt hashes are not reversible, but logging them aids offline attack. |
| **API keys** (any kind) | Authentication secret. | Stripe, OpenAI, Anthropic, Nearmap, Eagleview, ATTOM, Resend, Google Solar, Neon, Render, Vercel, GitHub, Sentry, Cloudflare, `JWT_SECRET`, `MIGRATE_SECRET`, `MFA_ENCRYPTION_KEY`, `SURVEY_WEBHOOK_SECRET`, `SOLARPRO_HANDOFF_SECRET`, `ADMIN_OVERRIDE_EMAIL`, `MOBILE_SERVICE_API_KEY`, `SOLARPRO_API_KEY`. |
| **OAuth tokens / refresh tokens** | Authentication secret. | Including `next-auth.session-token` and equivalents. |
| **TOTP seeds** | Authentication secret. | The raw seed, not the 6-digit code. |
| **MFA backup codes** | Authentication secret. | — |
| **JWT tokens (full)** | Session secret. | The signature is enough to impersonate. Log a truncated fingerprint (`first 8 chars...`) for correlation, not the full token. |
| **Session cookies (full)** | Session secret. | Same as JWT. |
| **Credit card numbers** | PCI DSS scope. | Solarpro does not store PAN; the rule prevents accidental storage. |
| **CVV / CVC** | PCI DSS scope. | Never stored, never logged. |
| **Bank account numbers** | Financial PII. | — |
| **Full SSN** | Government identifier. | Last 4 only, with explicit redaction annotation. |
| **Full driver's license number** | Government identifier. | Same. |
| **Full passport number** | Government identifier. | Same. |
| **Full date of birth** | PII. | Year of birth only, with redaction annotation. |
| **GPS coordinates (full precision)** | Location PII. | Coarse location (city or ZIP) only. The exact coordinates from a survey photo's EXIF are stripped at upload, not at log time. |
| **Aerial photos (full content)** | Visual PII of customer home. | The path or filename of the photo may be logged; the photo binary is never logged. |
| **Email address (full)** | PII. | The local part may be truncated (`j***@example.com`) if the email is the target of an action; for `actor` it is logged in full to support correlation. |
| **Phone number (full)** | PII. | Area code only, with redaction annotation. |
| **Home address (full)** | PII. | City + state only. |
| **IP address (full)** | PII-adjacent. | The `/24` for IPv4 (or `/48` for IPv6) is logged; the full address is logged only for security events (failed login, denied request) and is purged at the warm-tier transition. |
| **Free-form user input from surveys** | PII + free text. | The survey's PII fields (`site_overview`, `roof_conditions`, `electrical_service`, `obstructions`) are not logged; the field names are logged as `metadata.survey_field_redacted: true`. |
| **Health, biometric, or genetic data** | Special-category PII (GDPR Art. 9). | Not collected by Solarpro. The rule is preventive. |

A field not on the list but matching a known redaction pattern (anything matching a credit-card Luhn check, anything matching a JWT shape `xxx.yyy.zzz`, anything matching an AWS key pattern) is redacted by the logger's pattern detector and flagged in the weekly digest.

### 7.2 The redaction test

Every PR that touches the structured logger runs a redaction test: a fixture log entry containing each item on the list is fed through the logger, and the output is asserted to not contain the item. The fixture is at `tests/logging/redaction.test.ts` (Sprint 2).

## 8. Log review cadence

The audit log is reviewed on three cadences, layered.

### 8.1 Weekly diff

**Owner**: Raymond (or Cody as backup).

**What it covers**: a week-over-week diff of the audit log. Total event count, top actions, top actors, top denied reasons, top error reasons. Any new action in the top-20 list is investigated. Any denied reason that spiked >50% week-over-week is investigated.

**Output**: a one-page weekly digest at `compliance/monitoring/YYYY-WW-digest.md`. Filed in R2 by the GitHub collector.

### 8.2 Monthly summary

**Owner**: Raymond.

**What it covers**: the weekly digests aggregated. Trend lines, the open exception list, the redaction-layer verification result, the cold-tier transition count. Any new P0 finding from the log is escalated.

**Output**: a one-page monthly summary at `compliance/monitoring/YYYY-MM-summary.md`.

### 8.3 Quarterly review (UAR-style)

**Owner**: Raymond, with James reviewing the management summary.

**What it covers**: the monthly summaries aggregated. The full audit log sampled at 1% to confirm the redaction layer is working. The list of admin actions reviewed for appropriateness. The list of access events reviewed for the same. The exception list reviewed.

**Output**: a quarterly review at `compliance/uar/YYYY-Qq-log-review.md`. Filed in R2.

## 9. Alerting

The audit log drives alerts. An alert is a notification to Raymond (and James for Sev1-class signals). The thresholds below are the defaults; they are tuned in the first 90 days of operation and locked.

| Signal | Threshold | Severity | Channel |
|---|---|---|---|
| **Failed login spike** | >10 failures per minute from a single IP, or >50 failures per minute globally. | Sev2 | Sentry + Slack `#security` |
| **Rate-limit hits** | >100 blocks per minute from a single IP, or >1000 blocks per minute globally. | Sev2 | Sentry + Slack `#security` |
| **5xx error rate** | >1% of requests in a 5-minute window. | Sev2 | Sentry + Slack `#security` |
| **Admin action outside business hours** | Any `actor: super_admin` action between 22:00 and 06:00 CT, or on a US federal holiday. | Sev3 | Sentry + Slack `#security` |
| **Auth bypass attempt** | Any request that matches a known bypass pattern (missing CSRF, invalid HMAC, expired token replay). | Sev2 | Sentry + Slack `#security` |
| **PII field written to log** | Any redaction-layer trip on a PII field (the logger caught an attempt to log a forbidden field). | **Sev1** | Sentry + page James + page Raymond |
| **Migration governance breach** | Any migration run that does not satisfy the four gates (per the Change Management Policy). | Sev2 | Sentry + Slack `#security` |
| **Vision API fail-silent** | The `MAX_DAILY_COST_USD` cap fires, or the vision-availability banner is shown to a customer. | Sev2 | Sentry + Slack `#security` |
| **Audit log write failure** | Any failed insert into `audit_log`. | **Sev1** | Sentry + page James + page Raymond (a failure to log security events is itself a security event) |

The alert thresholds are reviewed quarterly as part of the §8.3 review. A threshold that is too noisy is tuned; a threshold that is too quiet is tightened. The trend is the audit evidence.

## 10. Monitoring of the monitoring

The audit log is critical infrastructure. The fact that it is logging is itself monitored.

- **Audit log write volume** is monitored. A drop to zero (other than a planned maintenance window) is a Sev1.
- **Audit log latency** is monitored. A p99 insert >500ms is a Sev2.
- **Audit log disk usage** is monitored. The 90-day hot window is sized for the current event rate; the weekly digest tracks the trend.
- **The structured logger's health** is monitored. A Sentry event that says "logger initialization failed" is a Sev1.

A monitoring system that is itself unmonitored is a control deficiency. The auditor will check.

## 11. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management.
- `compliance/policies/03-access-control.md` — the access events that are logged.
- `compliance/policies/05-incident-response.md` — when an alert becomes an incident.
- `compliance/policies/06-change-management.md` — when a change to the logger ships.
- `compliance/CONTROL_MATRIX.md` — CC7.2, A.8.15, A.8.16 current state and evidence.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection, R2 bucket, weekly monitoring.
- `compliance/monitoring/` — weekly digests, monthly summaries, quarterly reviews.
- `lib/auditLog.ts` — the existing audit log module; this policy extends its schema.
- `lib/migrations/runner.ts:380-432` — the migration governance that this policy's audit-log pattern is modeled on.
- `audit_code_quality_2026-07-30.md` §2 #3, §7.2 — the 207 silent catches and 2,537 console calls that this policy closes.
- `audit_security_migrations_2026-07-30.md` §3.2 — `MIGRATION-GOV-13` audit log pattern.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 12-field structured log schema, the four-destination log pipeline, the "no silent catch" rule with the `safeViewerOp()` pattern, the four-tier retention (90d hot / 1y warm / 7y cold), the redaction list, the three-cadence review (weekly / monthly / quarterly), and the nine alerting thresholds. Closes the P0 finding from `audit_code_quality` §2 #3. |
