# Stage 9 — v47.434a Contract Delta Map: Partner Actual vs SolarPro Expected

**Source of truth for partner's implementation:** `github.com/kilby8/site_survey-app` @ commit `2cc3537f`
**Files inspected:** `backend/src/services/webhookService.ts`, `backend/src/routes/surveys.ts` (`POST /api/surveys/:id/complete`), `backend/src/routes/handoff.ts`, `backend/src/routes/openapi.ts`, `backend/src/services/metrics.ts`, `backend/.env.example`

---

## 1. Executive Summary

The partner has shipped a working webhook producer with queue-based delivery, exponential retry, and a background worker. **However, three of their wire-format choices are incompatible with the v47.434 receiver we shipped on disk.** Every real webhook they send WILL fail HMAC verification at our end until we patch.

Additionally, the partner sends a *fatter* event than the "thin event" spec implied — the payload includes `project_id`, `project_name`, `inspector_name`, `site_name`, `status`. This is good news for v47.435 (more context without a second GET).

There is ALSO a symmetric outbound contract we hadn't thought about: the partner expects SolarPro to **mint HS256 JWT handoff tokens** with specific claims (`jti` + `project_id` required) when opening a survey from a project. This is a NEW v47.435 (or 9.2) scope item.

---

## 2. Webhook Contract Deltas (Inbound to SolarPro)

### 2.1 Breaking — MUST fix before first real webhook

| # | Field / Mechanism | Partner sends | SolarPro expects | Effect if unfixed |
|---|---|---|---|---|
| 1 | `X-Survey-Timestamp` header | ISO-8601 (`"2026-04-23T18:25:43.000Z"`) via `new Date().toISOString()` | Unix epoch seconds integer string (`"1745432743"`) | `Number(timestampHeader)` → `NaN` → `MALFORMED_TIMESTAMP` → 401 on every call |
| 2 | `X-Survey-Signature` header | `sha256=<64 hex>` (prefixed, 71 chars total) | Raw `<64 hex>` (64 chars) | Length-mismatch short-circuit → `SIGNATURE_MISMATCH` → 401 on every call |
| 3 | `schemaVersion` field | Not sent (field absent) | Required, must equal `'1.0'` | `Unsupported schemaVersion: undefined` → 400 on every call |

### 2.2 Compatible — no action required

| # | Field | Partner sends | Our validator |
|---|---|---|---|
| 4 | `event` | `"survey.completed"` | ✓ matches `SUPPORTED_SURVEY_EVENT_TYPES` |
| 5 | `event_id` | `randomUUID()` string | ✓ accepts any non-empty string |
| 6 | `survey_id` | UUID string | ✓ accepts any non-empty string |
| 7 | `completed_at` | ISO-8601 string | ✓ accepts any non-empty string |
| 8 | Signed string format | `${timestamp}.${payloadText}` | ✓ matches (ours uses same, just with different timestamp encoding) |
| 9 | HMAC algorithm | HMAC-SHA256 (hex digest) | ✓ matches |
| 10 | Idempotency key | `X-Survey-Event-Id` header | ✓ we already read this header |

### 2.3 Extra fields — ignored today, useful in v47.435

The partner's `SurveyCompletePayload` includes fields beyond the thin-event spec:

```ts
interface SurveyCompletePayload {
  event: "survey.completed";
  event_id: string;
  occurred_at: string;       // NEW — distinct from completed_at
  survey_id: string;
  status: string;            // NEW — e.g. "submitted"
  project_id: string | null; // NEW — null means survey had no handoff context
  project_name: string;      // NEW
  inspector_name: string;    // NEW
  site_name: string;         // NEW
  completed_at: string;
}
```

**v47.434 behaviour today:** `validateEnvelope()` checks required fields by name but does NOT reject unknown fields. All extra fields are silently dropped on parse. **Safe.**

**v47.435 opportunity:** these fields let us correlate to an existing project (`project_id`) and short-circuit the full GET for display metadata (`project_name`, `inspector_name`, `site_name`). The full payload fetch is still needed for photos + measurements.

---

## 3. Partner's Actual Signed String (reproduced from `webhookService.ts:159–163`)

```ts
function buildSignature(payloadText: string, timestamp: string, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payloadText}`)
    .digest("hex");
  return `sha256=${digest}`;
}

// Caller context (webhookService.ts:175–184):
const timestamp = new Date().toISOString();       // ISO-8601 UTC, ms precision
const payloadText = row.payload;                  // exact JSON string stored at enqueue time
// ...
headers: {
  "X-Survey-Signature":  buildSignature(payloadText, timestamp, secret),
  "X-Survey-Timestamp":  timestamp,
  "X-Survey-Event-Id":   row.event_id,
}
```

Implication: our verifier MUST:
1. Accept ISO-8601 timestamps in `X-Survey-Timestamp`, parse to ms, convert to seconds for tolerance math
2. Strip `sha256=` prefix from `X-Survey-Signature` before compare (but keep rejection for non-prefixed if strict mode desired later)
3. Make `schemaVersion` OPTIONAL in the validator (default to `'1.0'` when absent — the contract is still v1.0, partner just doesn't echo it)

---

## 4. Partner's Retry + Delivery Semantics (operational context)

- **Queue table:** `webhook_deliveries` on THEIR side (not to be confused with ours)
- **Retry schedule:** 1 min, 5 min, 30 min, 2 h, 12 h (5 attempts, then permanent failure)
- **Worker interval:** 30 s poll, batch of 25
- **Success criteria:** HTTP 2xx response body
- **Timeout:** ~30 s per request

**Implication for us:** we must respond within ~30 s. `maxDuration = 30` is already set. We must return 2xx for genuine duplicates (already doing this) and 2xx for successful ingest. The current 501 return on a valid/verified delivery will trigger THEIR retry logic forever — but since we haven't gone live yet, this only bites when v47.435 ships. For the v47.434a patch we keep the 501.

---

## 5. Handoff Token Contract (Outbound from SolarPro — NEW v9.2 scope)

Partner's `GET /api/handoff/:token` expects:
- **Token format:** JWT signed with HS256
- **Secret env:** `SOLARPRO_HANDOFF_SECRET` on THEIR side — matching secret on OUR side
- **Required claims:** `jti` (replay defence), `project_id`
- **Optional claims:** `project_name`, `site_name`, `site_address`, `inspector_name`, `category_id`, `category_name`, `notes`, `latitude`, `longitude`, `gps_accuracy`, `metadata` (object)
- **Replay protection:** `jti` is inserted into `used_handoff_tokens` table on first consumption; `23505` unique-violation → 409 `HANDOFF_TOKEN_REPLAYED`

**v47.434 implication:** none (outbound work). **v47.435 or v47.436 scope:** ship handoff token minter + deep-link builder. NOT a blocker for inbound webhook pipeline.

---

## 6. Partner's Env Contract (both sides need to coordinate)

From `backend/.env.example`:

| Variable | Role | Our env equivalent |
|---|---|---|
| `SURVEY_WEBHOOK_SECRET` | HMAC key for signing outbound webhooks | `SURVEY_WEBHOOK_SECRET` (same name — ✓) |
| `SOLARPRO_WEBHOOK_URL` | Where partner POSTs webhooks | n/a (partner-side config) |
| `SOLARPRO_HANDOFF_SECRET` | HS256 key to verify our handoff JWT | `SOLARPRO_HANDOFF_SECRET` (we'll mint with same secret) |

**Secret coordination required:** before go-live we must exchange two shared secrets with partner ops, one per direction.

---

## 7. v47.434a Patch Plan (minimal — just unblock the wire)

Six surgical edits. All in existing files, no new modules.

### 7.1 `lib/survey/verifyWebhookSignature.ts`
1. **Accept ISO-8601 timestamps.** New helper `parseTimestampHeader(h)` → `{ epochSeconds, originalFormat }` that tries integer parse first, falls back to `Date.parse()`. Returns `null` only when BOTH fail.
2. **Accept `sha256=` prefix on signature.** Strip leading `sha256=` (case-insensitive) before length/timing compare. Also accept raw hex (no prefix) so internal-origin signers stay working.

### 7.2 `app/api/webhooks/survey-complete/route.ts` (validator only)
3. **Make `schemaVersion` optional.** When absent, treat as `'1.0'`. When present, require exact match.
4. **Relax unknown-field check (already relaxed — document it).**

### 7.3 `lib/survey/types.ts`
5. **Type doc update only** — clarify `schemaVersion` is logically v1.0 even when the wire omits it.

### 7.4 Tests
6. **New test file: `lib/survey/verifyWebhookSignature.partnerContract.test.ts`** (reproduces the partner's exact signed-string format with ISO timestamp + `sha256=` prefix, verifies valid + all 5 failure reasons against the real wire shape). ~8 new tests.
7. **Extend validator tests:** 3 new cases in an existing file for the "schemaVersion absent → valid" path.

**Total: +11 tests, ~150 LOC changed, zero breaking changes for our existing test suite (legacy Unix-epoch + raw-hex signers continue to work).**

### 7.5 Out of scope for v47.434a (defer to v47.435)
- Extracting `project_id` / `project_name` / `inspector_name` / `site_name` from the envelope into the transform layer
- Ingest pipeline (fetch full survey payload, upsert project/layout/files)
- Handoff JWT minter
- Admin-UI visibility for the new fields

---

## 8. Post-patch verification plan

1. `npx vitest run` → expect 2101 + 11 = 2112 pass, zero regressions
2. `npx tsc --noEmit` → TC=0
3. `npm run build` → 46/46 pages clean
4. **Integration sanity (manual):** from `/tmp/kilby-site-survey-app`, configure `SOLARPRO_WEBHOOK_URL=http://localhost:3000/api/webhooks/survey-complete` + matching `SURVEY_WEBHOOK_SECRET`, start their backend, `POST /api/surveys/:id/complete`, confirm our endpoint returns `501 INGEST_NOT_IMPLEMENTED` (not 401/400).

---

*Delta map frozen at v47.434a scoping — 2026-04-23.*
*Next doc: `stage9_v47434a-todo.md` once implementation starts.*