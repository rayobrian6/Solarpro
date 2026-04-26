# Stage 9.1a — v47.434a Execution Checklist

**Release:** v47.434a — Partner Wire-Format Compatibility Patch
**Shipped:** 2026-04-23
**Scope:** Non-breaking wire-format compatibility for partner's real webhook producer.

## Pre-flight

- [x] Clone partner's active dev fork (`github.com/kilby8/site_survey-app` @ `2cc3537f`)
- [x] Read `backend/src/services/webhookService.ts` — signing primitive + delivery worker
- [x] Read `backend/src/routes/surveys.ts` — `POST /api/surveys/:id/complete` trigger path
- [x] Read `backend/src/routes/handoff.ts` — discovered outbound JWT contract (v9.2b scope)
- [x] Read `backend/src/routes/openapi.ts` — confirmed full route surface
- [x] Read `backend/.env.example` — confirmed env variable names on partner side
- [x] Read `backend/src/services/metrics.ts` — operational telemetry hooks
- [x] Write `docs/stage9_v47434a-contract-delta-map.md` — 6-delta analysis

## Implementation

### Runtime code

- [x] `lib/survey/verifyWebhookSignature.ts`
  - [x] New export: `parseTimestampHeaderToSeconds(raw)` — accepts integer string + ISO-8601
  - [x] New export: `normaliseSignatureHeader(raw)` — strips optional `sha256=` prefix (case-insensitive)
  - [x] Dual-mode timestamp parsing in verifier body
  - [x] Signature prefix stripping before length/timing compare
  - [x] HMAC still computed over `${rawHeaderString}.${rawBody}` (byte-equality with sender)

- [x] `lib/survey/envelopeValidator.ts` (NEW FILE)
  - [x] Extract `validateEnvelope` + `EnvelopeResult` types from `app/api/webhooks/survey-complete/route.ts`
  - [x] `schemaVersion` absent → coerce to `CURRENT_SCHEMA_VERSION`
  - [x] `schemaVersion` present-but-mismatched → reject with descriptive error
  - [x] Extra fields (partner's fat payload) silently dropped

- [x] `app/api/webhooks/survey-complete/route.ts`
  - [x] Remove inline `validateEnvelope` (Next.js route export restriction)
  - [x] Import from `@/lib/survey/envelopeValidator`
  - [x] Zero behavioural change to callers

- [x] `lib/survey/types.ts` — docstring update on `SchemaVersion`

### Tests

- [x] `lib/survey/verifyWebhookSignature.partnerContract.test.ts` (NEW, +28 tests)
  - [x] Happy paths: partner-signed ISO + `sha256=` at exact now / ±4min
  - [x] Rejections: stale timestamp, tampered body, wrong secret, replay-with-different-ts
  - [x] Cross-format interop: raw hex + Unix epoch still works (legacy); hybrid modes work; case-insensitive prefix
  - [x] Malformed-input: prefix-only signature → MISSING; alphabetic garbage ts → MALFORMED
  - [x] `parseTimestampHeaderToSeconds` coverage: 9 cases (integer, ISO-with-ms, ISO-without-ms, explicit-offset, negative, float-reject, empty, garbage, whitespace)
  - [x] `normaliseSignatureHeader` coverage: 6 cases (lowercase/uppercase/mixed-case prefix, raw hex passthrough, whitespace, null/empty)

- [x] `lib/survey/envelopeValidator.test.ts` (NEW, +13 tests)
  - [x] schemaVersion with / without / wrong-value / non-string
  - [x] Partner fat-payload (extra fields silently dropped, typed fields passed through)
  - [x] Required-field rejections (non-object, unknown event, missing/empty event_id/survey_id/completed_at)
  - [x] `survey_url` optional handling (present / absent / non-string)

### Version + docs

- [x] Bump `BUILD_VERSION` → `v47.434a`
- [x] Update `BUILD_DATE` → `2026-04-23`
- [x] Prepend v47.434a description to `BUILD_DESCRIPTION`
- [x] Add v47.434a entry to `BUILD_FEATURES`
- [x] Update roadmap tracker line in `docs/UPGRADE_ROADMAP_v47.399.md`
- [x] Add Stage 9.1a detail section to roadmap
- [x] Add v47.434a entry to `lib/roadmapRE26.ts`

## Verification

- [x] `npx tsc --noEmit` → TC=0
- [x] `npx vitest run` → 2142/2142 pass across 51 files
  - [x] +41 net from v47.434 (2101 → 2142)
  - [x] Zero regressions in legacy suite (18 verifyWebhookSignature + 8 contractDriftGuard unchanged)
- [x] `npm run build` → Compiled successfully, all 3 survey routes registered
- [x] Runtime spot-check: `BUILD_VERSION === 'v47.434a'`, description apostrophes render cleanly

## Deferred to v47.435+

- [ ] Envelope fat-field extraction (`project_id`, `project_name`, `inspector_name`, `site_name`, `status`, `occurred_at`) via separate metadata extractor
- [ ] Full ingest pipeline: GET full payload from survey backend, transform to `projects` + `Layout` + `project_files`, upsert with idempotency on `(user_id, survey_external_id)`
- [ ] Handoff JWT minter (HS256 with `jti` + `project_id` claims, shared `SOLARPRO_HANDOFF_SECRET`) — v47.435 or v47.436
- [ ] Deep-link builder for survey launch from project detail page
- [ ] Partner integration drift-guard doc `docs/SURVEY_INTEGRATION_CONTRACT_v1.md`
- [ ] Replay admin action full implementation (v47.437)

## Known issues / future work

- **Git state:** `/workspace/Solarpro-git-v5` has no `.git` directory in this sandbox. User must commit + push from local environment.
- **Secret coordination:** before go-live, exchange `SURVEY_WEBHOOK_SECRET` (inbound HMAC) and `SOLARPRO_HANDOFF_SECRET` (outbound JWT) with partner ops.
- **Handoff replay table:** when v9.2b ships the minter, we also need to decide if we track minted `jti`s on our side (for observability) or rely on partner's `used_handoff_tokens`. Recommend the latter to avoid double-bookkeeping.