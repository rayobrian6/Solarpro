# Integration Staging Report — Exec Summary

**SolarPro ⇄ Site Survey App** · 2026-04-23

**SolarPro build:** `v47.434a` (on disk, pending git push)
**Partner build:** `kilby8/site_survey-app @ 2cc3537f` (phases 1–7 complete)

---

## Where we are (traffic light)

| | Status |
|---|---|
| Inbound webhook wire-format compatibility | 🟢 aligned |
| Inbound ingest pipeline (fetch + transform) | 🟡 SolarPro v47.435 in progress |
| Outbound handoff JWT minter | 🟡 SolarPro v47.435/9.2b planned |
| Shared secrets exchanged | 🔴 **blocker** |
| Staging environments networked | 🔴 **blocker** |

## The three things that must happen first

1. **Exchange `SURVEY_WEBHOOK_SECRET`** (partner signs, SolarPro verifies)
2. **Exchange `SOLARPRO_HANDOFF_SECRET`** (SolarPro signs, partner verifies)
3. **Wire staging deployments** so partner staging can reach SolarPro staging `/api/webhooks/survey-complete`

Everything else can proceed on parallel tracks.

## What SolarPro just shipped (v47.434a)

Three wire-format compatibility fixes so partner webhooks pass HMAC verification:

- Accept ISO-8601 timestamps in `X-Survey-Timestamp` (partner's format — `new Date().toISOString()`)
- Accept `sha256=<hex>` prefix on `X-Survey-Signature` (partner's format)
- Treat absent `schemaVersion` as implicit `'1.0'` (partner doesn't send it)

Verified with 2142/2142 tests pass, TC=0, clean build. Legacy signers still work — zero regressions.

## What's next on each side

### SolarPro

- **v47.435 (Stage 9.2):** full ingest pipeline — extract `project_id`/`project_name`/`inspector_name`/`site_name` from webhook envelope, fetch full survey via `GET /api/surveys/{id}`, transform to projects/Layout/project_files
- **v47.435/9.2b:** outbound handoff JWT minter + deep-link builder (mint HS256 with `jti` + `project_id`)
- **v47.436 (Stage 9.3):** photos/notes/checklist async ingest
- **v47.437 (Stage 9.4):** contract doc + admin replay action

### Partner (what we need from you)

1. Confirm bearer auth scheme on `GET /api/surveys/{id}` — JWT or long-lived service token?
2. Confirm photo URL scheme in full survey payload — signed URLs or bearer-required?
3. Confirm handoff launch URL shape — `/launch?token=...`, `/new-survey?token=...`, or other?
4. Decide: should partner enable the webhook in staging now (and tolerate 501 retries until SolarPro v47.435 ships), OR wait for v47.435 first?

## Important friction point — 501 retry churn

SolarPro v47.434a returns `501 INGEST_NOT_IMPLEMENTED` on successful HMAC + validation, because ingest ships in v47.435. Partner's queue will retry this up to 5 times (1min → 5min → 30min → 2h → 12h) before marking `permanent_failure`.

**Three options (Q1 in the full report):**
- A. Don't enable partner → SolarPro webhook in staging until SolarPro v47.435 ships (~1–2 weeks)
- B. SolarPro ships v47.434b returning `202` instead of `501` during the window (cosmetic change, stops retries)
- C. Partner adds a retry-backoff exemption for 501 responses

Decision needed from both teams within 1 week.

## Open questions (full list in main report §9)

10 questions total — ownership split:
- 3 blocking v47.435 design (partner's bearer scheme, null `project_id` handling, fat-payload authoritativeness)
- 2 blocking v47.435/9.2b (handoff URL shape, JWT TTL)
- 1 blocking v47.436 (photo URL scheme)
- 1 blocking production go-live (secret rotation protocol)
- 3 lower priority (OpenAPI doc, metric naming, v47.434b decision)

## Joint milestones

| | Target |
|---|---|
| M0 — Secrets exchanged | ASAP |
| M1 — Staging networked | +3 days after M0 |
| M2 — First webhook reaches SolarPro | +1 day after M1 |
| M3 — First ingest succeeds | mid-May |
| M4 — Handoff round-trip works | end-May |
| M5 — Production go-live | June |

---

*Companion document: `INTEGRATION_STAGING_REPORT_v1.md` — full 10-section staging report with contract details, test plans, and appendices.*