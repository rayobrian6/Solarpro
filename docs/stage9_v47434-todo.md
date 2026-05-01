# v47.434 — Survey Integration Schema + Auth Skeleton

## Approved scope (shipping this release)
- [ ] Migration: new columns + new webhook_deliveries table
- [ ] lib/survey/verifyWebhookSignature.ts (HMAC-SHA256 verifier)
- [ ] lib/auth-service.ts (bearer fallback path — unused in v434 but type-safe surface)
- [ ] lib/survey/types.ts (TS types for webhook envelope, frozen v1.0 schema)
- [ ] POST /api/webhooks/survey-complete — HMAC-verify + log delivery, returns 501 (ingest deferred)
- [ ] GET /api/admin/survey-webhook-log — list webhook deliveries (admin-only)
- [ ] POST /api/admin/survey-webhook-log/:id/replay — stub (returns 501; full impl in v437)
- [ ] Drift-guard test: locks origin enum + schemaVersion + event taxonomy + webhook_deliveries shape
- [ ] Unit tests: HMAC verify (good + bad sig, replay via event_id, timestamp tolerance window)
- [ ] Route tests: /api/webhooks/survey-complete (valid sig → 501, bad sig → 401, duplicate event_id → 200 no-op)
- [ ] Route tests: /api/admin/survey-webhook-log (admin → 200, non-admin → 403)
- [ ] Version bump + roadmap + roadmapRE26
- [ ] Full suite green, build clean
- [ ] Commit + push

## Blocked (waiting on survey team)
- Actual survey payload fetch + transform (v47.435) — needs thin-event confirmation + sample POST
- Photo + notes + checklist ingest (v47.436)
- Drift-guard + contract doc + replay admin action (v47.437)

## Design rules locked by user approval
- Contract is thin-event by default (survey-team confirmation pending)
- HMAC-SHA256 over `${timestamp}.${rawBody}` per partner doc
- Timestamp tolerance: 5 minutes (rejects stale / replay-by-capture)
- X-Survey-Event-Id is the idempotency key
- projects.origin enum = { manual, bill_upload, survey, api } — CLOSED
- schemaVersion literal '1.0' — FROZEN for v1
- Single-tenant: SURVEY_INGEST_DEFAULT_USER_ID env var owns survey-origin rows
- Admin-only endpoints use existing admin auth pattern (no new pattern)