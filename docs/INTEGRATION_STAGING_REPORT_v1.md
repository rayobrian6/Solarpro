# SolarPro ⇄ Site Survey App — Integration Staging Report v1

**Report date:** 2026-04-23
**SolarPro build:** v47.434a (shipped on disk, pending git push)
**Partner build:** `kilby8/site_survey-app` @ `2cc3537f` ("Complete phases 1-7: UUID contract, handoff/webhooks, retention/GDPR, observability")
**Report owner:** SolarPro engineering
**Distribution:** both engineering teams, ops/secrets custodian on both sides

---

## 0. How to read this document

This is a **shared state of the union** between the two systems. It's meant to be the single source of truth that both teams look at before writing code, shipping a release, or updating secrets. Every section has a **SolarPro column** and a **Partner column** so either side can see the counterparty commitment.

Sections:
1. Executive summary + traffic light
2. Architecture snapshot (both sides)
3. Inbound webhook contract (partner → SolarPro)
4. Outbound handoff contract (SolarPro → partner)
5. Delivery semantics (retries, timeouts, idempotency, observability)
6. Secrets + environment variables
7. Release alignment roadmap
8. Shared test plan — unit / contract / staging / production smoke
9. Open questions (owner + due date)
10. Change log

---

## 1. Executive Summary

| Capability | SolarPro | Partner | Status |
|---|---|---|---|
| Webhook receiver endpoint | ✅ v47.434 shipped | ✅ Producer shipped | 🟢 |
| HMAC wire-format compatibility | ✅ v47.434a shipped | ✅ | 🟢 |
| Idempotency (by `event_id`) | ✅ | ✅ | 🟢 |
| Delivery log / observability | ✅ admin endpoint live | ✅ admin endpoint live | 🟢 |
| **Full ingest pipeline (fetch + transform)** | ⏳ v47.435 planned | ✅ `GET /api/surveys/{id}` live | 🟡 |
| **Handoff JWT minter (outbound)** | ⏳ v47.435 or v47.436 | ✅ `GET /api/handoff/:token` live | 🟡 |
| Photos / notes / checklist ingest | ⏳ v47.436 | ✅ stored in survey DB | 🟡 |
| Shared secret exchanged | ❌ pending | ❌ pending | 🔴 |
| Staging environments networked | ❌ pending | ❌ pending | 🔴 |
| End-to-end smoke passing | ❌ pending | ❌ pending | 🔴 |

**Legend:** 🟢 aligned — 🟡 one side ready, waiting on counterparty — 🔴 blocker

**Single most important next step:** exchange the two shared secrets (`SURVEY_WEBHOOK_SECRET` inbound, `SOLARPRO_HANDOFF_SECRET` outbound) and wire staging deployments together. Everything else can proceed in parallel on both sides.

---

## 2. Architecture Snapshot

### 2.1 Data flow at a glance

```
┌──────────────────┐       (1) User opens survey from       ┌──────────────────┐
│                  │  ────── project detail with JWT ─────► │                  │
│    SolarPro      │                                        │   Site Survey    │
│   (Next.js 15)   │◄──── (2) Partner redirects inspector ──│   App backend    │
│                  │         (survey launches on mobile)    │   (Express/Pg)   │
│                  │                                        │                  │
│                  │  ◄── (3) survey.completed webhook ─────│                  │
│                  │          (HMAC-signed thin-ish event)  │                  │
│                  │                                        │                  │
│                  │  ───── (4) GET /api/surveys/{id} ─────►│                  │
│                  │          (fetch full payload)          │                  │
│                  │                                        │                  │
│                  │  ◄─── full survey JSON + photo URLs ───│                  │
│                  │                                        │                  │
│                  │  ───── (5) GET each photo URL ────────►│                  │
│                  │                                        │                  │
└──────────────────┘                                        └──────────────────┘
```

**Steps 1–2 = outbound from SolarPro** (handoff JWT + deep-link). Ships v47.435+.
**Steps 3–5 = inbound to SolarPro** (webhook + full fetch + photos). Step 3 receiver shipped v47.434a; steps 4–5 ship v47.435+.

### 2.2 SolarPro side (us)

| Layer | Status | Files |
|---|---|---|
| DB schema | ✅ `projects.survey_external_id`, `projects.origin`, `projects.survey_category`, `projects.survey_meta`, `project_files.external_id`, `project_files.status`, `webhook_deliveries` | `migrations/011_survey_ingest.sql` |
| HMAC verifier | ✅ dual-mode (ISO + Unix epoch), optional `sha256=` prefix | `lib/survey/verifyWebhookSignature.ts` |
| Envelope validator | ✅ v1.0 contract, `schemaVersion` optional | `lib/survey/envelopeValidator.ts` |
| Webhook receiver | ✅ verifies + logs + returns 501 (ingest TODO) | `app/api/webhooks/survey-complete/route.ts` |
| Admin delivery log | ✅ GET with filters | `app/api/admin/survey-webhook-log/route.ts` |
| Admin replay | ⏳ 501 stub | `app/api/admin/survey-webhook-log/[id]/replay/route.ts` |
| Ingest pipeline | ⏳ **v47.435** | `lib/survey/ingest/` (not yet created) |
| Handoff JWT minter | ⏳ **v47.435/v47.436** | `lib/survey/handoff/` (not yet created) |

### 2.3 Partner side (inferred from `kilby8/site_survey-app` @ `2cc3537f`)

| Layer | Status | File / endpoint |
|---|---|---|
| Survey completion trigger | ✅ `POST /api/surveys/:id/complete` | `backend/src/routes/surveys.ts:1135` |
| Outbound webhook signer | ✅ HMAC-SHA256, `sha256=<hex>` prefix, ISO timestamp | `backend/src/services/webhookService.ts:159` |
| Webhook queue + worker | ✅ exponential retry 1/5/30min · 2h · 12h, 30s poll, batch 25 | `backend/src/services/webhookService.ts` |
| Handoff JWT consumer | ✅ `GET /api/handoff/:token` with HS256 verify + `jti` replay defence | `backend/src/routes/handoff.ts` |
| Full survey GET | ✅ `GET /api/surveys/:id` (bearer JWT auth) | `backend/src/routes/surveys.ts` |
| Admin delivery log | ✅ `GET /api/surveys/admin/webhook-deliveries` | `backend/src/routes/surveys.ts:1233` |
| Metrics snapshot | ✅ `GET /api/metrics` (admin) | `backend/src/services/metrics.ts` |
| OpenAPI spec | ✅ `GET /api/openapi.json` | `backend/src/routes/openapi.ts` |

---

## 3. Inbound Webhook Contract (Partner → SolarPro)

### 3.1 Endpoint

| Field | Value |
|---|---|
| URL | `POST ${SOLARPRO_BASE_URL}/api/webhooks/survey-complete` |
| Content-Type | `application/json` |
| Auth | HMAC headers (see below), no bearer |
| Max body size | <1 MB (thin-ish event; fat fields bring it to ~600 bytes) |
| Response timeout (partner side) | ~30 s per attempt |

### 3.2 Required headers

| Header | Format | Example | Origin |
|---|---|---|---|
| `X-Survey-Signature` | `sha256=<64 lowercase hex>` | `sha256=a1b2c3...` | `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` |
| `X-Survey-Timestamp` | ISO-8601 from `new Date().toISOString()` | `2026-04-23T18:25:43.000Z` | partner clock |
| `X-Survey-Event-Id` | UUID v4 | `7c6f2e2e-9b4a-4d1f-8a1c-...` | idempotency key |

**SolarPro verifier tolerance:** 5 minutes (±300 s). Legacy Unix-epoch integer timestamps are also accepted to keep internal signing paths open, but **partner signs with ISO-8601**.

**SolarPro verifier prefix tolerance:** `sha256=` (case-insensitive) is stripped before comparison; raw hex is also accepted.

### 3.3 Body schema

```json
{
  "event": "survey.completed",
  "event_id": "7c6f2e2e-9b4a-4d1f-8a1c-0123456789ab",
  "occurred_at": "2026-04-23T18:25:43.000Z",
  "survey_id": "a1b2c3d4-5e6f-7890-abcd-ef0123456789",
  "status": "submitted",
  "project_id": "11111111-2222-3333-4444-555555555555",
  "project_name": "Smith Residence",
  "inspector_name": "Jane Doe",
  "site_name": "123 Solar Way, Austin TX",
  "completed_at": "2026-04-23T18:25:43.000Z"
}
```

| Field | Type | Required? | SolarPro v47.434a treatment |
|---|---|---|---|
| `event` | `"survey.completed"` | yes | validated against `SUPPORTED_SURVEY_EVENT_TYPES` |
| `event_id` | UUID string | yes | idempotency key; stored in `webhook_deliveries.event_id` |
| `occurred_at` | ISO-8601 | yes (partner) | silently dropped today; **v47.435 will store** |
| `survey_id` | UUID string | yes | stored as `projects.survey_external_id` in v47.435 |
| `status` | string | yes (partner) | silently dropped today; **v47.435 may use for completeness check** |
| `project_id` | UUID string \| null | yes (partner) | silently dropped today; **v47.435 will use for correlation if non-null** |
| `project_name` | string | yes (partner) | silently dropped today; **v47.435 will use for display metadata** |
| `inspector_name` | string | yes (partner) | silently dropped today; **v47.435 will store in `projects.survey_meta.inspector_name`** |
| `site_name` | string | yes (partner) | silently dropped today; **v47.435 may use for project name default** |
| `completed_at` | ISO-8601 | yes | stored for audit; surfaced in admin log |
| `schemaVersion` | `"1.0"` | optional | coerced to `"1.0"` when absent; explicit mismatch rejected |
| `survey_url` | URL string | optional | will be used by v47.435 if present, else derive from `${SURVEY_BACKEND_URL}/api/surveys/${survey_id}` |

### 3.4 Response contract (SolarPro → Partner)

| Scenario | HTTP | Body shape | Partner's retry behaviour |
|---|---|---|---|
| Duplicate `event_id` | `200` | `{ success: true, data: { duplicate: true, existingDeliveryId, existingStatus } }` | stops retrying ✅ |
| Verified + validated, ingest not yet implemented | `501` | `{ success: false, reason: "INGEST_NOT_IMPLEMENTED", deliveryId, event: {...} }` | ⚠️ **will retry up to 5 times** per their schedule — see §3.5 |
| Verified + validated, ingest succeeds (v47.435+) | `200` | `{ success: true, data: { deliveryId, projectId, status: "ingested" } }` | stops retrying ✅ |
| HMAC / timestamp failure | `401` | `{ success: false, error: "Signature verification failed", reason, deliveryId }` | retries per partner policy |
| Envelope validation failure | `400` | `{ success: false, error, deliveryId }` | retries per partner policy |
| DB unavailable | `503` | `{ success: false, error: "Database unavailable" }` | retries per partner policy |
| Receiver misconfigured (no `SURVEY_WEBHOOK_SECRET`) | `500` | `{ success: false, error: "Webhook receiver not configured" }` | retries per partner policy |

### 3.5 Known friction point — 501 during v47.434a

**Problem:** SolarPro v47.434a returns `501` on successful HMAC + envelope validation because ingest isn't implemented. Partner's queue treats this as a retryable failure → every webhook will consume all 5 retry slots over ~16h until it hits `permanent_failure`.

**Options:**

- **Option A (recommended, defer to v47.435):** We ship v47.435 ingest pipeline before any real webhooks start flowing. Until then, don't enable the partner → SolarPro webhook in staging. Zero friction.
- **Option B (quick patch, optional):** SolarPro ships **v47.434b** that returns `202 Accepted` on successful HMAC + validation (instead of `501`). Body carries `reason: "INGEST_NOT_IMPLEMENTED_BUT_LOGGED"`. Partner's worker stops retrying; we still get the delivery logged. **Risk:** gives a false positive impression the integration works end-to-end.
- **Option C:** Partner configures a retry backoff exemption for 501 status codes. Small config change on their side.

**Decision needed from both teams.** See §9 Open Questions.

---

## 4. Outbound Handoff Contract (SolarPro → Partner)

### 4.1 Purpose
When a SolarPro user clicks **"Start site survey"** on a project detail page, we mint a short-lived JWT and redirect the inspector's mobile/web browser to the partner's survey launcher with the token in the URL. The partner's `GET /api/handoff/:token` consumes it and pre-fills the new-survey form.

### 4.2 Token format

| Attribute | Value |
|---|---|
| Algorithm | HS256 (HMAC-SHA256) |
| Secret | `SOLARPRO_HANDOFF_SECRET` (same value on both sides) |
| TTL (recommended) | 10 minutes |
| Replay defence | `jti` claim; partner upserts into `used_handoff_tokens`; second presentation returns `409 HANDOFF_TOKEN_REPLAYED` |

### 4.3 JWT claims

| Claim | Type | Required? | Purpose |
|---|---|---|---|
| `jti` | UUID v4 | **yes** | replay defence |
| `project_id` | UUID | **yes** | partner's `project_id` column — correlates back to SolarPro project |
| `project_name` | string | optional | display header in survey UI |
| `site_name` | string | optional | display subheader |
| `site_address` | string | optional | pre-filled address field |
| `inspector_name` | string | optional | pre-filled inspector field |
| `category_id` | UUID | optional | partner's category table reference |
| `category_name` | string | optional | display name |
| `notes` | string | optional | pre-filled notes field |
| `latitude` | number | optional | pre-filled GPS |
| `longitude` | number | optional | pre-filled GPS |
| `gps_accuracy` | number | optional | pre-filled GPS accuracy (meters) |
| `metadata` | object | optional | arbitrary extra context |
| `exp` | Unix seconds | **yes** (standard JWT) | enforce TTL |
| `iat` | Unix seconds | **yes** (standard JWT) | issued-at audit |

### 4.4 Launch URL shape

```
https://<partner-mobile-host>/launch?token=<JWT>
```

or (web fallback):

```
https://<partner-web-host>/new-survey?token=<JWT>
```

**Partner to confirm final URL shape.** See §9 Open Questions.

### 4.5 Example JWT payload

```json
{
  "jti": "8a1b2c3d-4e5f-6789-abcd-ef0123456789",
  "project_id": "11111111-2222-3333-4444-555555555555",
  "project_name": "Smith Residence",
  "site_name": "Smith Residence — Main House",
  "site_address": "123 Solar Way, Austin TX 78701",
  "inspector_name": "Jane Doe",
  "latitude": 30.2672,
  "longitude": -97.7431,
  "gps_accuracy": 5,
  "metadata": { "solarpro_user_id": "42", "solarpro_build": "v47.435" },
  "iat": 1745432700,
  "exp": 1745433300
}
```

---

## 5. Delivery Semantics

### 5.1 Retry policy

| System | Schedule | Total attempts | Max window |
|---|---|---|---|
| Partner webhook queue | 1 min, 5 min, 30 min, 2 h, 12 h | 5 | ~14.5 h |
| Partner worker cadence | 30 s poll, batch 25 | — | — |
| SolarPro response timeout | 30 s (`maxDuration`) | — | — |

### 5.2 Idempotency

| Layer | Key | Backing storage |
|---|---|---|
| SolarPro | `event_id` from envelope (or `X-Survey-Event-Id` header) | `webhook_deliveries (source='survey', event_id)` — partial unique index |
| Partner | `event_id` on enqueue | their `webhook_deliveries` table |
| Downstream ingest (v47.435+) | `(user_id, survey_external_id)` — project upsert | `projects` unique constraint |

### 5.3 Observability

| Metric / log | SolarPro | Partner |
|---|---|---|
| Delivery attempt log row | ✅ `webhook_deliveries` every call (valid + invalid) | ✅ their `webhook_deliveries` |
| Admin UI / endpoint | ✅ `GET /api/admin/survey-webhook-log?status=...&limit=...` | ✅ `GET /api/surveys/admin/webhook-deliveries` |
| Structured console log on success | ✅ | ✅ `{ type: "survey_completed", ... }` JSON line |
| Counters | ⏳ (v47.437 backlog) | ✅ `webhook_enqueued_total`, `webhook_delivered_total`, `webhook_failed_total`, `handoff_replay_total` |
| Replay action | ⏳ 501 stub (v47.437) | n/a (partner doesn't replay, just retries queue) |

---

## 6. Secrets + Environment Variables

### 6.1 Shared secrets (must match on both sides)

| Secret | Used by partner for | Used by SolarPro for | Exchanged? | Rotation policy |
|---|---|---|---|---|
| `SURVEY_WEBHOOK_SECRET` | signing outbound webhooks | verifying inbound webhooks | ❌ **pending** | 90 days, coordinated; double-signed window during rotation (both old and new secret accepted for 5 min) |
| `SOLARPRO_HANDOFF_SECRET` | verifying our JWT on their side | signing JWTs on our side | ❌ **pending** | 90 days, coordinated; same double-signed window |

### 6.2 SolarPro env vars (our side)

| Variable | Scope | Required in production | Notes |
|---|---|---|---|
| `SURVEY_WEBHOOK_SECRET` | HMAC verification | ✅ | must match partner's |
| `SOLARPRO_HANDOFF_SECRET` | JWT signing (v47.435+) | ✅ (when v47.435 ships) | must match partner's |
| `SURVEY_BACKEND_URL` | base URL for full-survey GET fallback | ✅ (when v47.435 ships) | e.g. `https://survey.solarpro.partner.com` |
| `SURVEY_BACKEND_BEARER` | bearer token for full-survey GET | ✅ (when v47.435 ships) | **OPEN QUESTION §9** — JWT vs long-lived token |
| `SURVEY_INGEST_DEFAULT_USER_ID` | owns survey-origin project rows in single-tenant v1 | ✅ (when v47.435 ships) | a real SolarPro user UUID |

### 6.3 Partner env vars (their side, reference only)

| Variable | Purpose |
|---|---|
| `SURVEY_WEBHOOK_SECRET` | HMAC signing |
| `SOLARPRO_WEBHOOK_URL` | where to POST webhooks (our `/api/webhooks/survey-complete`) |
| `SOLARPRO_HANDOFF_SECRET` | HS256 verify for handoff JWT |

---

## 7. Release Alignment Roadmap

### 7.1 SolarPro release timeline

| Version | Scope | Status | Partner dependency |
|---|---|---|---|
| v47.434 | Schema + HMAC verifier + admin log + 501 stub | ✅ on disk | — |
| v47.434a | Wire-format compat (ISO ts, `sha256=` prefix, optional schemaVersion) | ✅ on disk | — |
| **v47.435 (Stage 9.2)** | **Ingest pipeline: extract fat-payload fields + GET full survey + transform to projects/Layout/project_files** | ⏳ planned | **partner's `GET /api/surveys/:id` must be stable + bearer auth scheme confirmed** |
| v47.435 or v47.436 (Stage 9.2b) | Handoff JWT minter + deep-link builder | ⏳ planned | partner's `SOLARPRO_HANDOFF_SECRET` provisioned |
| v47.436 (Stage 9.3) | Photos + notes + checklist full ingest | ⏳ planned | partner's photo URL scheme finalised (public-signed URLs? bearer-required?) |
| v47.437 (Stage 9.4) | Contract doc, admin replay impl, end-to-end drift-guard test | ⏳ planned | — |

### 7.2 Partner release checkpoints (as observed)

| Commit | Scope | Status | Blocker for us? |
|---|---|---|---|
| `2cc3537f` | Phases 1–7: UUID contract, handoff, webhooks, retention/GDPR, observability | ✅ shipped | no |
| `279f2126` | Webhook implementer guide v1 | ✅ shipped | no |
| `380f7780` | Inline checklist item photo capture | ✅ shipped | no (enhances payload richness) |
| — | Photo public URL scheme finalised | ⏳ unknown | **yes for v47.436** |
| — | Bearer token rotation policy documented | ⏳ unknown | **yes for v47.435** |

### 7.3 Joint milestones

| Milestone | SolarPro exit criteria | Partner exit criteria | Target |
|---|---|---|---|
| **M0 — Secrets exchanged** | Both secrets in our prod secret store | Both secrets in their prod secret store | **ASAP** |
| **M1 — Staging networked** | Staging deployment reachable from partner staging | Staging deployment reachable from our staging | +3 days after M0 |
| **M2 — First webhook reaches 501** | Partner POST lands, HMAC passes, row in `webhook_deliveries` with `status='failed'` + `error_message='HMAC...'` absent (i.e. validation passed, just 501 on ingest) | Partner worker logs a 501 response | +1 day after M1 |
| **M3 — First ingest succeeds (v47.435)** | Row in `projects` with `origin='survey'` + `survey_external_id` matching | Partner sees `webhook_deliveries.status='delivered'` | mid-May |
| **M4 — Handoff round-trip works (v47.435/9.2b)** | SolarPro mints JWT → partner consumes → new survey in partner DB with correct `project_id` | Partner's `GET /api/handoff/:token` returns `200` with decoded claims | end-May |
| **M5 — Production go-live** | All above + runbook + on-call setup | All above + runbook + on-call setup | June |

---

## 8. Shared Test Plan

### 8.1 SolarPro-owned tests (already passing)

| Test file | Count | What it locks |
|---|---|---|
| `lib/survey/verifyWebhookSignature.test.ts` | 18 | Legacy Unix-epoch + raw-hex signers continue to work |
| `lib/survey/verifyWebhookSignature.partnerContract.test.ts` | 28 | Partner's exact wire format: ISO ts + `sha256=` prefix + tolerance behaviour |
| `lib/survey/envelopeValidator.test.ts` | 13 | schemaVersion dual-mode, partner fat-payload tolerance, required-field rejections |
| `lib/survey/contractDriftGuard.test.ts` | 8 | `CURRENT_SCHEMA_VERSION`, `SUPPORTED_SURVEY_EVENT_TYPES`, `PROJECT_ORIGIN_VALUES`, `WebhookDeliveryStatus` values are frozen |

### 8.2 Partner-owned tests (reference from `backend/src/__tests__/api.test.ts`)

- HMAC signing is deterministic
- Queue retry ordering respects `next_attempt_at`
- JWT issuance includes `jti`
- Replay rejection returns 409 (already passing per their OpenAPI)

### 8.3 Contract tests to be added (v47.435+)

| Test | Owner | Status |
|---|---|---|
| Sample webhook envelope in `docs/fixtures/survey-webhook-sample.json` loaded into our validator → passes | SolarPro | **to add with v47.435** |
| Sample full survey payload in `docs/fixtures/survey-full-sample.json` loaded into our transformer → emits expected project shape | SolarPro | **to add with v47.435** |
| Round-trip JWT test: mint on our side, decode on partner side (in CI via test fixture) | both | **to add with v47.435/9.2b** |

### 8.4 Staging smoke (manual, two-person)

Run after **M1 — Staging networked**. Checklist for a video call walkthrough:

1. ☐ Partner runs `POST /api/surveys/{test_survey_id}/complete`
2. ☐ Partner logs show `type: "survey_completed"` with `event_id`
3. ☐ Partner's `webhook_deliveries` row appears with `status='pending'`
4. ☐ Within 60 s, partner worker POSTs to SolarPro staging
5. ☐ SolarPro log shows `[webhook:survey-complete]` and a row in `webhook_deliveries` with `signature_valid=true`
6. ☐ Response to partner is `501 INGEST_NOT_IMPLEMENTED` (until v47.435 ships)
7. ☐ Partner's delivery row moves to `status='failed'` with `error_message='HTTP 501...'`
8. ☐ Second identical POST from partner produces duplicate detection: SolarPro returns `200 { duplicate: true }`, partner stops retrying ✅
9. ☐ Tamper test: SolarPro ops rewrites `SURVEY_WEBHOOK_SECRET` to a wrong value, partner POST returns `401 SIGNATURE_MISMATCH`, partner log captures the error
10. ☐ Reset secret, smoke passes again

### 8.5 Post-v47.435 staging smoke

Same as 8.4 but step 6 becomes:

6. ☐ SolarPro response is `200 { success: true, data: { deliveryId, projectId, status: 'ingested' } }`
7. ☐ `projects` row appears in SolarPro DB with `origin='survey'`, `survey_external_id=<survey_id>`, `survey_meta.inspector_name='Jane Doe'`
8. ☐ `project_files` rows appear with `status='pending'` (v47.436 moves to `ready` after async photo fetch)

---

## 9. Open Questions

| # | Question | Owner | Blocks | Due |
|---|---|---|---|---|
| Q1 | Should SolarPro ship **v47.434b** returning `202` instead of `501` on successful validation, to avoid partner's 5-retry churn during the window before v47.435? Or keep 501 and just not enable the webhook in partner staging until v47.435 ships? | Both | partner's staging webhook config | within 1 week |
| Q2 | What auth scheme should SolarPro use on `GET /api/surveys/{id}`? JWT (same as mobile app's bearer) or a long-lived service bearer token? | Partner | **v47.435 ingest pipeline** | before v47.435 starts |
| Q3 | What is the public URL scheme for photos returned inside the full survey payload? Signed URLs (time-limited, no auth needed)? Or bearer-required on the photo endpoint too? | Partner | **v47.436 photo ingest** | before v47.436 starts |
| Q4 | Confirm the **launch URL shape** for handoff: `/launch?token=...`, `/new-survey?token=...`, or something else? Mobile deep-link scheme + web fallback URL both needed. | Partner | **v47.435/9.2b handoff minter** | before v47.435/9.2b starts |
| Q5 | JWT TTL for handoff tokens — proposed 10 min. Agree? | Both | minor, defaults to 10 min if no response | before v47.435/9.2b starts |
| Q6 | Secret rotation protocol — 90 days with 5-min double-signed window on both sides. Agree? | Both | production go-live | before M5 |
| Q7 | Should partner's fat payload (`project_name`, `site_name`, `inspector_name`) be considered authoritative for SolarPro project display, or should SolarPro always re-query via `GET /api/surveys/{id}` for canonical values? | Both | v47.435 design | before v47.435 starts |
| Q8 | For surveys with `project_id = null` (surveys not launched via handoff — e.g. walk-in inspection), what's the expected SolarPro behaviour? Auto-create orphan project? Skip ingest? Route to a queue for manual triage? | Both | v47.435 design | before v47.435 starts |
| Q9 | OpenAPI spec delta — partner's `backend/src/routes/openapi.ts` describes 17 endpoints. Do we want a SolarPro-side OpenAPI doc too, or is this staging report enough? | SolarPro | observability/onboarding | M5 |
| Q10 | Observability alignment — should we emit the same counter names partner uses (`webhook_enqueued_total` etc.) or SolarPro-native names? Affects joint dashboards. | Both | Stage 9.4 (v47.437) | before v47.437 |

---

## 10. Change Log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-04-23 | v1.0 | Initial staging report. Captures v47.434a shipped state + partner `2cc3537f` state. | SolarPro |
| _pending_ | v1.1 | Partner review + answers to Q1–Q10 | Partner |
| _pending_ | v1.2 | Post-M1 update after staging networked | Both |
| _pending_ | v2.0 | Post-v47.435 update: ingest pipeline live | SolarPro |

---

## Appendix A — Canonical code references

### A.1 Partner signing primitive
`/tmp/kilby-site-survey-app/backend/src/services/webhookService.ts` lines 159–163 + 175–185:

```ts
function buildSignature(payloadText: string, timestamp: string, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payloadText}`)
    .digest("hex");
  return `sha256=${digest}`;
}

// delivery:
const timestamp = new Date().toISOString();
const payloadText = row.payload;
headers: {
  "X-Survey-Signature":  buildSignature(payloadText, timestamp, secret),
  "X-Survey-Timestamp":  timestamp,
  "X-Survey-Event-Id":   row.event_id,
}
```

### A.2 SolarPro verifier primitive
`lib/survey/verifyWebhookSignature.ts` (v47.434a):

```ts
const timestampSeconds = parseTimestampHeaderToSeconds(timestampHeader);
// ... tolerance check ...

const rawHexSignature = normaliseSignatureHeader(signatureHeader);
// ... presence check ...

const signedString = `${timestampHeader}.${rawBody}`;  // uses raw header, not parsed seconds
const expectedHex  = crypto.createHmac('sha256', secret)
                           .update(signedString, 'utf8')
                           .digest('hex');
// ... length + timingSafeEqual compare ...
```

### A.3 Partner handoff consumer
`/tmp/kilby-site-survey-app/backend/src/routes/handoff.ts` — verifies HS256, inserts `jti` into `used_handoff_tokens` with `ON CONFLICT → 409`.

### A.4 Partner's OpenAPI surface
17 endpoints. Full spec fetchable at `${SURVEY_BACKEND_URL}/api/openapi.json` — see `/tmp/kilby-site-survey-app/backend/src/routes/openapi.ts`.

---

## Appendix B — How to regenerate this report

```bash
# Partner side — refresh source of truth
cd /tmp/kilby-site-survey-app && git fetch && git checkout main
git log --oneline -20  # confirm HEAD matches §0 metadata

# SolarPro side
cd /workspace/Solarpro-git-v5
grep "^export const BUILD_VERSION" lib/version.ts

# Inspect partner's signed-string format
grep -n "buildSignature\|X-Survey-\|createHmac" \
  /tmp/kilby-site-survey-app/backend/src/services/webhookService.ts

# Sync this report
# Update §0 metadata, §1 traffic light, §9 open questions
```

---

*End of report. Next review: after partner response to Q1–Q10, OR after M1 staging-networked milestone, whichever is sooner.*