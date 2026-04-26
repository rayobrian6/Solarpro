# Site Survey → SolarPro Webhook — Implementer's Guide (v1.0, updated v47.435)

**Audience:** engineer wiring the `survey.completed` outbound webhook in `site_survey-app/backend`.
**SolarPro version:** v47.435 (receiver is live; ingest pipeline is live; contract is frozen).
**Schema version:** `1.0` — frozen. Any change requires a parallel-run bump.

---

## 1. What you need to do

When a survey is marked complete in the survey app, POST a signed webhook to SolarPro. That's it.

**One endpoint. One event. One HMAC signature. Idempotent.**

SolarPro will:
1. Verify your signature.
2. Dedupe by `event_id`.
3. Fetch the full survey payload from your `GET /api/surveys/:id` endpoint.
4. Transform it into a SolarPro project.

As of v47.435, the ingest pipeline is **live**. A valid delivery returns **202 `ACCEPTED_PRE_INGEST`** — your delivery has been verified, logged, and the pipeline has run (or was accepted for replay if the pipeline encountered an error). Do **not** retry on 202.

---

## 2. The one endpoint

```
POST https://<solarpro-host>/api/webhooks/survey-complete
Content-Type: application/json
X-Survey-Signature: <hex-encoded HMAC-SHA256>
X-Survey-Timestamp: <unix epoch seconds as string>
X-Survey-Event-Id:  <your canonical idempotency UUID>
```

**Example (dev):** `https://solarpro.example.com/api/webhooks/survey-complete`
**Example (prod):** will be provided before go-live.

---

## 3. The one event — `survey.completed`

### Body (frozen v1.0)

```json
{
  "event": "survey.completed",
  "schemaVersion": "1.0",
  "event_id": "evt_01HXG6Z5N3PT3K9A1V4MQ2YBRW",
  "survey_id": "srv_01HXG6Y8D0QT2H5C7J8KZ1PABC",
  "completed_at": "2026-04-23T18:14:22.511Z",
  "survey_url": "https://survey.example.com/api/surveys/srv_01HXG6Y8D0QT2H5C7J8KZ1PABC"
}
```

### Field contract

| Field           | Type    | Required | Notes |
|---|---|---|---|
| `event`         | string  | ✅ yes   | Must equal `"survey.completed"` exactly. |
| `schemaVersion` | string  | ✅ yes   | Must equal `"1.0"` exactly. |
| `event_id`      | string  | ✅ yes   | **Your idempotency key.** Must be stable across retries of the same event. UUIDv4 / ULID both fine. SolarPro dedupes on `(source='survey', event_id)`. |
| `survey_id`     | string  | ✅ yes   | Your canonical survey UUID. Becomes `projects.survey_external_id` on our side. |
| `completed_at`  | string  | ✅ yes   | ISO-8601 timestamp when the surveyor marked complete. |
| `survey_url`    | string  | optional | Direct URL to `GET /api/surveys/:id`. If omitted, SolarPro constructs it from `SURVEY_BACKEND_URL` + `survey_id`. **Recommended: include it.** Lets you rotate hosts without us reconfiguring. |

### Why thin and not fat?

Thin envelope keeps retry bodies small and decouples delivery guarantee from payload size. SolarPro will GET the full payload from your `/api/surveys/:id` once it has verified the webhook.

If you strongly prefer a fat event (full payload inline), say so and we'll extend the type union. Thin is our default because your repo already has a full `GET /api/surveys/:id`.

---

## 4. The HMAC signature

### Signed string

```
${timestamp}.${rawBody}
```

Where:
- `timestamp` = the value of `X-Survey-Timestamp` (Unix epoch seconds as a string)
- `rawBody` = the **exact bytes** of the POST body you're sending (do not re-serialize; must match byte-for-byte)

### Algorithm

```
signature = HMAC-SHA256(signedString, secret)
           → hex-encoded lowercase
```

### TypeScript reference implementation

```ts
import crypto from 'crypto';

function signWebhook(rawBody: string, secret: string): {
  signature: string;
  timestamp: string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedString = `${timestamp}.${rawBody}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedString, 'utf8')
    .digest('hex');
  return { signature, timestamp };
}
```

### Sending

```ts
const body = JSON.stringify({
  event: 'survey.completed',
  schemaVersion: '1.0',
  event_id: crypto.randomUUID(),
  survey_id: survey.id,
  completed_at: survey.completedAt.toISOString(),
  survey_url: `${process.env.PUBLIC_BACKEND_URL}/api/surveys/${survey.id}`,
});

const { signature, timestamp } = signWebhook(body, process.env.SOLARPRO_WEBHOOK_SECRET!);

await fetch(`${process.env.SOLARPRO_WEBHOOK_URL}/api/webhooks/survey-complete`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Survey-Signature': signature,
    'X-Survey-Timestamp': timestamp,
    'X-Survey-Event-Id':  body_event_id_here, // same as body.event_id
  },
  body, // ← exact bytes — do NOT let fetch re-serialize
});
```

**Critical:** sign the bytes of `body`, then pass `body` (the string) directly to `fetch`. Don't pass a parsed object — Node's `fetch` will re-stringify it, breaking byte-exactness.

### Headers we validate

| Header                | Required | Purpose |
|---|---|---|
| `X-Survey-Signature`  | ✅       | Hex HMAC-SHA256. |
| `X-Survey-Timestamp`  | ✅       | Unix epoch seconds, integer, as string. Rejected if ±5 minutes from our `now`. |
| `X-Survey-Event-Id`   | recommended | Idempotency key. Falls back to `body.event_id` if header absent. |
| `Content-Type`        | `application/json` | Standard. |

---

## 5. curl — end-to-end test (for your manual smoke)

```bash
SECRET="replace-with-shared-secret"
EVENT_ID="evt_$(uuidgen)"
SURVEY_ID="srv_test_001"
TS=$(date +%s)
BODY=$(cat <<EOF
{"event":"survey.completed","schemaVersion":"1.0","event_id":"$EVENT_ID","survey_id":"$SURVEY_ID","completed_at":"2026-04-23T18:14:22.511Z","survey_url":"https://survey.example.com/api/surveys/$SURVEY_ID"}
EOF
)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -i -X POST "https://solarpro.example.com/api/webhooks/survey-complete" \
  -H "Content-Type: application/json" \
  -H "X-Survey-Signature: $SIG" \
  -H "X-Survey-Timestamp: $TS" \
  -H "X-Survey-Event-Id: $EVENT_ID" \
  --data "$BODY"
```

### Expected responses (v47.435+)

| Status | Body shape | Meaning | Retry? |
|---|---|---|---|
| **202** | `{ ok: true, code: "ACCEPTED_PRE_INGEST", event_id: "..." }` | **Success.** Signature verified, delivery logged, pipeline ran (or accepted for replay). | ❌ No |
| **200** | `{ ok: true, duplicate: true, event_id: "..." }` | You already sent this `event_id`. Idempotency is working. | ❌ No |
| **400** | `{ success: false, error: "..." }` | Envelope shape invalid (missing field, bad schemaVersion). Fix the body. | ❌ No — fix and resend with a **new** `event_id`. |
| **401** | `{ success: false, reason: "..." }` | Signature / timestamp verification failed. See reason codes below. | ❌ No — fix and resend. |
| **500** / network failure | — | Transient server error. | ✅ Yes, with **same** `event_id` — we dedupe. |

> **Note on `code` vs `reason`:** `code` (`ACCEPTED_PRE_INGEST`) is the partner-contract field — stable across pipeline outcomes. `reason` is an internal ops field (`INGEST_OK` or `INGEST_FAILED_BUT_LOGGED`) present in the extended body for your logging. Both will be in every 202 response body.

### 401 reason codes you might see

- `MISSING_SIGNATURE_HEADER` — you didn't send `X-Survey-Signature`.
- `MISSING_TIMESTAMP_HEADER` — you didn't send `X-Survey-Timestamp`.
- `MALFORMED_TIMESTAMP` — timestamp isn't an integer string of Unix epoch seconds.
- `TIMESTAMP_OUT_OF_TOLERANCE` — ±5-minute drift exceeded. Sync your server clock.
- `SIGNATURE_MISMATCH` — you signed with a different secret, over a different body, or at a different timestamp than the one in the header.

---

## 6. Retry policy (what we recommend on your side)

- **Retry network errors and 5xx.**
- **Do not retry 202** — that means we received, verified, and accepted the delivery. The ingest pipeline running or failing is transparent to you; a replay via ops (v47.437) is the recovery path.
- **Do not retry 4xx** (400, 401). Fix and resend with a new `event_id`.
- **Retry with the same `event_id`** — our idempotency will no-op duplicates.
- Exponential backoff: 30s, 2m, 10m, 1h, 6h, 24h. Give up after ~5 attempts and surface to ops.
- **Log the delivery on your side** — record `event_id`, HTTP status, response body. Ops on both sides need this.

---

## 7. Secret management

| Secret | Lives on your side as | Lives on our side as |
|---|---|---|
| Shared HMAC secret | `SOLARPRO_WEBHOOK_SECRET` | `SURVEY_WEBHOOK_SECRET` |
| Your public webhook URL | `SOLARPRO_WEBHOOK_URL` (ours) | — |
| Your backend base URL | — | `SURVEY_BACKEND_URL` (yours) |

We'll exchange the HMAC secret out of band (1Password / share vault / encrypted message). **Rotate quarterly or on suspected compromise.** Rotation protocol:

1. We generate new secret → send to you.
2. You start signing with new secret; SolarPro accepts both old + new for a 24-hour overlap.
3. After overlap, SolarPro removes old secret.

---

## 8. Full ingest — what SolarPro does after accepting your delivery

Once your webhook is accepted (202), SolarPro calls back to your backend with:

```
GET ${survey_url}
Authorization: <TBD — Bearer token or signed service JWT>
```

Your response should include the structured survey data (customer name + contact, site address + GPS, roof planes, obstructions, equipment notes, checklist answers) and photo URLs (presigned S3 or public `/uploads/...` paths). We'll re-verify a checksum over the response body. Full contract details are in the companion doc for v47.435.

**Action for you now:** decide whether the GET auth is a Bearer token (static, long-lived, rotated on schedule) or a service JWT (per-request, signed with the same HMAC secret). We recommend **Bearer token** for simplicity — `SURVEY_BACKEND_API_KEY` env var on our side, `SOLARPRO_INGEST_TOKEN` on yours. Let us know if you want JWT instead.

---

## 9. Deliver this sample on your first integration test

1. Point a dev deployment at our dev webhook URL (we'll share).
2. Mark a test survey complete.
3. Expect **202** back with `{ ok: true, code: "ACCEPTED_PRE_INGEST", event_id: "..." }` plus a `deliveryId` in the response body.
4. We pull that `deliveryId` from `webhook_deliveries` via our admin log (`GET /api/admin/survey-webhook-log`) and confirm `signature_valid = true`.
5. You paste the **raw bytes + signature + timestamp** of that successful POST into the PR that wires the code — that's our regression fixture.

That's the full loop.

---

## Questions / ambiguities — please flag in PR review

1. **Thin vs fat event.** Thin is our default. If you'd rather send the full payload inline, tell us and we'll extend the schema (backward compat guaranteed via `schemaVersion`).
2. **Photo delivery.** Does your GET return S3 presigned URLs, public `/uploads/...` paths, or base64? All three work — we just need to know which.
3. **GET auth.** Bearer token (simpler) or JWT (stronger)? Recommend Bearer.
4. **Multi-user mapping.** v1 is single-tenant on our side (one `SURVEY_INGEST_DEFAULT_USER_ID` owns all survey-origin projects). If you ever need multi-tenant, add a `user_id` (or `solarpro_user_id`) field to the envelope and we'll extend the schema.

---

**SolarPro contacts for this integration:**
- Engineering lead: (you)
- Receiver endpoint code: `app/api/webhooks/survey-complete/route.ts`
- Contract types: `lib/survey/types.ts`
- HMAC verifier: `lib/survey/verifyWebhookSignature.ts`
- Admin log: `GET /api/admin/survey-webhook-log`
- Last updated: v47.435 / 2026-04-23