# DRAFT — Partner Outreach Message v1
# Review before sending. Do not distribute until approved.
# Intended recipient: engineering lead / integration owner at kilby8/site_survey-app

---

**Subject:** SolarPro × Survey Integration — v47.434c shipped, v47.435 unblocked by 4 items

---

Hey [name],

Quick integration update from our side + four items we need to unblock v47.435 (ingest layer).

---

## What we shipped (v47.434 series)

**v47.434a — Wire-format compatibility fix**

We aligned our receiver with your `webhookService.ts` (commit `2cc3537f`):

- Accept ISO-8601 timestamps (in addition to Unix epoch)
- Accept `sha256=<hex>` and raw hex signatures
- Accept missing `schemaVersion` (default → `'1.0'`)

**v47.434b — 202 response (stops your retry queue)**

Changed the terminal response on successful HMAC + envelope verification from `501 Not Implemented` to `202 Accepted` with reason `INGEST_NOT_IMPLEMENTED_BUT_LOGGED`. Your delivery worker was treating our 501 as a failure and scheduling retries. 202 stops that cleanly while ingest is still pending.

**v47.434c — Pull-based release signaling (shipped today)**

Added two public endpoints you can poll to stay current on our wire contract and release history without reading our source:

```
GET /api/system/capabilities
GET /api/system/release?limit=N
```

Full staging state-of-the-union is in the attached staging report: `INTEGRATION_STAGING_REPORT_v1.md`.

---

## What you can do right now (no changes on your side needed)

All endpoints are live in staging.

### 1. Capabilities endpoint

```
GET /api/system/capabilities
```

Returns our current wire contract as structured JSON: inbound endpoint, HMAC config (algorithm, signed-string format, header names, accepted timestamp and signature formats, tolerance window), response code contract (202 on success, 200 on duplicate, 401 on bad sig, 400 on bad envelope, 500 on misconfigured receiver), feature flag snapshots (`project_id` origin values, delivery status enum), and an advertising block for the outbound handoff JWT contract we haven't shipped yet (so you can plan your side).

Supports `If-None-Match` / `304 Not Modified` — cache the ETag and only reparse on changes. Sample:

```bash
# First call
curl -i https://<your-staging-url>/api/system/capabilities

# Subsequent calls — 304 if contract unchanged
curl -i -H 'If-None-Match: "v47.434c-a46a36f8ad9c1c01"' \
  https://<your-staging-url>/api/system/capabilities
```

Recommended: poll hourly with the ETag short-circuit. Contract is stable until we ship v47.435+.

### 2. Release history endpoint

```
GET /api/system/release?limit=N        # default limit=10, max=100
```

Returns structured release history from our version manifest: `{ latest, releases[], totalCount }`. Each entry has `version`, `stage`, `title`, `summary`. Newest first.

```bash
curl https://<your-staging-url>/api/system/release?limit=5
```

Recommended: poll daily. `latest.version` gives you our current deployed version without parsing anything.

### 3. `producerVersion` in every webhook response

Every response body from `POST /api/webhooks/survey-complete` now includes:

```json
{ "producerVersion": "v47.434c", ... }
```

Applies to all response paths — 202 success, 200 duplicate, 401 invalid sig, 400 bad envelope, 500 misconfigured. Log it per delivery for your audit trail.

---

## Blocking items for v47.435 (ingest pipeline)

We cannot safely implement ingest without locking these four items:

---

### Q2 — Auth on `GET /api/surveys/{id}`

We need to fetch the full survey payload after receiving your thin-event webhook. What auth scheme should we use?

- **Option A:** Same bearer JWT your mobile app uses (short-lived — we'd need a service account flow to keep it fresh)
- **Option B:** Long-lived service bearer token (simpler — needs a rotation policy)
- **Option C:** Something else

We need the header name, token format, and how we obtain/refresh it.

---

### Q3 — Webhook payload: thin-event vs fat-payload final decision

Your `webhookService.ts` currently sends a thin event (`event_id`, `survey_id`, `completed_at`, `event`, `schemaVersion`) but actual deliveries also include the fat fields: `project_id`, `project_name`, `inspector_name`, `site_name`, `status`, `occurred_at`.

We need a final answer on the payload shape for v1:

- **Option A (thin-event, confirmed):** Webhook body stays minimal. We always follow up with `GET /api/surveys/{id}` for the full payload. Fat fields in current deliveries are an implementation detail that will be removed.
- **Option B (fat-payload, confirmed):** Webhook body always includes the full set. We can skip the follow-up GET and ingest directly from the webhook body. Fields present today are stable and we should depend on them.
- **Option C (thin + fat, both stable):** Both are guaranteed. We use fat fields when present and fall back to the GET otherwise.

We need a single definitive answer here — ingest implementation depends on it.

---

### Q4 — Handoff JWT: launch URL shape

We're building the handoff JWT minter for v47.435 (our side mints the HS256 token; you already have the `GET /api/handoff/:token` receiver). We need:

- The exact launch URL shape — `/launch?token=<jwt>`, `/new-survey?token=<jwt>`, or something else?
- Web URL and mobile deep-link scheme both (e.g. `yourapp://survey/launch?token=<jwt>`)
- Any required query params beyond `token=`

---

### Q8 — Surveys with `project_id = null`

Walk-in inspections (surveys started directly in your app, not via a SolarPro handoff JWT) will have `project_id = null`. What should we do when we receive a `survey.completed` event with `project_id = null`?

- **Option A:** Auto-create an orphan project in SolarPro (`origin=survey`, no existing project linked). User sees it in their dashboard and can merge/assign later.
- **Option B:** Accept the delivery (202), log it, skip ingest entirely. Walk-in surveys are out of scope for v1.
- **Option C:** Accept the delivery, log it, route it to a manual-triage queue. Admin UI for triage ships in v47.436.

We're leaning toward **Option C** as the most operationally safe — but we'll implement whatever you confirm.

---

## Additional request: sample webhook POST

Can you send a real `POST /api/webhooks/survey-complete` from your staging environment to our receiver?

**Staging receiver:**
```
https://<your-staging-url>/api/webhooks/survey-complete
```

We want to verify end-to-end HMAC under real conditions (your actual signing code, your actual timestamp, your actual payload shape) before writing the ingest transform layer.

Preferred: raw request (headers + body) copied from your delivery log after a real POST.

Confirm you have `SURVEY_WEBHOOK_SECRET` from the previous exchange, or flag if it needs to be regenerated.

---

## Outbound release push (optional — flag now, build later)

We've designed an outbound `system.release` push event — SolarPro HMAC-signs and POSTs a notification to a partner endpoint on every deploy. Tells your dashboard our new version + whether the contract changed, without polling.

Before we build it, we need:

1. Do you want push at all, or is polling `/api/system/capabilities` with ETag short-circuit sufficient for your ops needs?
2. If yes: what endpoint should we POST to?
3. If yes: we'll need to exchange a second shared secret (`PARTNER_RELEASE_WEBHOOK_SECRET`).

No action needed for v47.435 — just flagging now so we can batch it in the same secret-exchange round as `SOLARPRO_HANDOFF_SECRET` if you want it.

---

## Secrets status

| Secret | Direction | Status |
|---|---|---|
| `SURVEY_WEBHOOK_SECRET` | Your app → SolarPro (inbound) | Should be exchanged — confirm or request regen |
| `SOLARPRO_HANDOFF_SECRET` | SolarPro → your handoff receiver (outbound) | **Not yet exchanged — needed for v47.435** |
| `PARTNER_RELEASE_WEBHOOK_SECRET` | SolarPro → your release receiver (outbound) | Optional — only if you want push notifications |

We should exchange `SOLARPRO_HANDOFF_SECRET` in the same round as your Q4 answer. Suggest 1Password secure share or age-encrypted attachment — let us know your preference.

---

## Summary of what we need back

| # | Item | Blocks |
|---|---|---|
| Q2 | Auth scheme for `GET /api/surveys/{id}` | v47.435 ingest pipeline |
| Q3 | Thin vs fat payload — final decision | v47.435 transform layer |
| Q4 | Handoff launch URL shape + deep-link scheme | v47.435 JWT minter |
| Q8 | Null `project_id` handling (walk-in surveys) | v47.435 ingest branching |
| — | Sample webhook POST from your staging env | Pre-v47.435 end-to-end verification |
| — | Push vs pull decision for release signaling | v47.435 scoping (optional) |
| — | `SOLARPRO_HANDOFF_SECRET` exchange | v47.435 handoff JWT minter |

Once we have these answers, we'll move immediately into v47.435 implementation.

[your name]

---

*Staging report attached: `INTEGRATION_STAGING_REPORT_v1.md`*
*Capabilities endpoint live: `GET /api/system/capabilities`*
*Release history live: `GET /api/system/release`*