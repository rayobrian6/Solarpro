# Site Survey SSO + Ingestion Contract (v60.5)

**Owner:** SolarPro Website (this repo)
**Consumers:** (B) Mobile Site Survey App (Expo) · (C) Survey API (Render)
**Effective:** v60.5 onward
**Status:** IMPLEMENTED — awaiting B/C integration

---

## 1. System-of-Record Rule

> **SolarPro is the one and only system that owns users, projects, and engineering data.**
>
> Neither B nor C may store user accounts, mint JWTs, or create projects on their own.
> All identity flows originate at SolarPro. All survey results end up in SolarPro.

---

## 2. Auth Flow — OAuth-style Authorize

### 2.1 Endpoint

```
GET https://solarpro.solutions/api/auth/authorize
    ?redirect_uri=sitesurvey://login
    &state=<csrf-random>
```

### 2.2 Behaviour

| User state on SolarPro | Response |
|---|---|
| Has a valid session cookie | `302` redirect to `<redirect_uri>?token=<jwt>&state=<state>` |
| No session | `302` redirect to `/auth/login?next=<encoded-authorize-url>` (returns here after login) |
| `redirect_uri` missing | `400` `{ error: "redirect_uri query parameter is required" }` |
| `redirect_uri` not in allowlist | `400` `{ error: "redirect_uri is not in the allowlist", allowedPrefixes: [...] }` |
| Server missing `SOLARPRO_HANDOFF_SECRET` | `500` `{ error: "SSO not configured on server" }` |
| Rate-limited | `429` |

### 2.3 Redirect-URI Allowlist

Controlled by env var `AUTHORIZE_ALLOWED_REDIRECTS` (comma-separated prefix list).
Default: `sitesurvey://`

Prefix match only — no substring match — to prevent open-redirect abuse.

### 2.4 JTI Replay Protection

Every minted JWT's `jti` is inserted into `mobile_sso_used_jtis` with a 10-minute TTL.
The mobile app MUST call `POST /api/users/solarpro-sso` on first use to complete the session bind (existing endpoint, unchanged).

---

## 3. JWT Structure (CANONICAL)

```json
{
  "sub":              "<user-uuid>",
  "solarpro_user_id": "<user-uuid>",
  "email":            "user@example.com",
  "name":             "Jane Doe",
  "iat":              1700000000,
  "exp":              1700000600,
  "jti":              "<uuid-v4>"
}
```

- Algorithm: **HS256**
- Secret: `SOLARPRO_HANDOFF_SECRET` (≥ 32 chars, shared with B and C)
- TTL: **600 seconds** (10 minutes) — single-use by design
- `sub` and `solarpro_user_id` are intentionally identical (back-compat + clarity)

### Trust Rules

| Party | Trusts | Does NOT trust |
|---|---|---|
| SolarPro (A) | Nothing outside — A mints the JWT | Any field from B or C about user identity |
| Mobile (B) | `sub` / `solarpro_user_id` / `email` / `name` for display only | Any value the user can edit in the app |
| Survey API (C) | The JWT signature + `solarpro_user_id` | The device-supplied user_id — MUST re-derive from JWT |

---

## 4. Survey Submission Flow

### 4.1 Case 1 — Survey from an existing SolarPro project

User is on a project page on SolarPro desktop/mobile web.

```
User clicks "Start Survey"
    │
    ▼
POST /api/projects/[id]/survey-handoff      (SolarPro)
    │  returns { deepLink: "sitesurvey://survey?token=<JWT-with-project_id>&..." }
    ▼
Mobile app opens, JWT has solarpro_project_id
    │
    ▼
User completes survey in the app
    │
    ▼
B POSTs to C:  POST https://survey-api.onrender.com/surveys
    Headers: Authorization: Bearer <JWT>
    Body:    { survey data, solarpro_user_id, solarpro_project_id }
    │
    ▼
C sends webhook to A:  POST /api/webhooks/survey-complete
    Headers:
      X-Signature: sha256=<HMAC of raw body with SURVEY_WEBHOOK_SECRET>
      X-Timestamp: <unix-seconds>
    Body: {
      survey_id, survey_url, completed_at,
      solarpro_user_id, solarpro_project_id
    }
    │
    ▼
A ingests, ATTACHES to existing project (projectLinkResolver → action='attach')
```

### 4.2 Case 2 — Survey from scratch (no project)

User installs the Expo app, opens it, logs in via SSO — no project context.

```
Mobile app opens
    │
    ▼
Browser: https://solarpro.solutions/api/auth/authorize?redirect_uri=sitesurvey://login&state=<r>
    │  User logs in (or already has a session)
    ▼
302 → sitesurvey://login?token=<JWT-WITHOUT-project_id>&state=<r>
    │
    ▼
User fills out a survey
    │
    ▼
B POSTs to C:  POST https://survey-api.onrender.com/surveys
    Headers: Authorization: Bearer <JWT>
    Body:    { survey data, solarpro_user_id }   ← NO project_id
    │
    ▼
C sends webhook to A:  POST /api/webhooks/survey-complete
    Body: {
      survey_id, survey_url, completed_at,
      solarpro_user_id              ← NO solarpro_project_id
    }
    │
    ▼
A ingests, CREATES new project under solarpro_user_id
    (projectLinkResolver → action='create', strategy='CREATE_ORPHAN')
```

---

## 5. Webhook Contract (C → A)

### 5.1 Endpoint

```
POST https://solarpro.solutions/api/webhooks/survey-complete
```

### 5.2 Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Timestamp` | Unix seconds at send time (within ±5 min of server clock) |
| `X-Signature` | `sha256=` + HMAC-SHA256 over **raw request body** using `SURVEY_WEBHOOK_SECRET` |

### 5.3 Body (envelope)

```json
{
  "survey_id":          "<C's external id for this survey>",
  "survey_url":         "https://survey-api.onrender.com/surveys/<id>",
  "completed_at":       "2025-11-16T12:34:56Z",
  "solarpro_user_id":   "<user-uuid from JWT — REQUIRED>",
  "solarpro_project_id":"<project-uuid OR omit/null>"
}
```

- `solarpro_user_id` is **required** and is what drives ownership.
- `solarpro_project_id` is **optional**:
  - Present → A ATTACHES the survey to that project (verifies it belongs to the user).
  - Absent/null → A auto-creates a new project owned by the user.

### 5.4 Responses

| Status | Meaning |
|---|---|
| `200` | Accepted (idempotent on `survey_id`) |
| `400` | Envelope validation failed |
| `401` | HMAC signature invalid or timestamp skew too large |
| `409` | Duplicate delivery (already ingested — safe to ignore) |
| `5xx` | A internal error — C SHOULD retry with exponential backoff |

---

## 6. SolarPro Ingestion Logic (A internal)

Pipeline file: `lib/survey/ingest/ingestPipeline.ts`

| Step | Description |
|---|---|
| A | Validate envelope (`envelopeValidator.ts`) |
| B | Resolve project link (`projectLinkResolver.ts` — per-event routing) |
| C | Fetch full payload from `survey_url` (`payloadFetcher.ts`) |
| D | Transform (v1.0 partner / v2.0 internal) (`transformLayer.ts`) |
| E | Write to `projects` + `project_physical_data` |
| F | Mark survey as ingested (idempotency guard) |
| G–J | Vision pipeline (roof photos, shade analysis) — optional |

Ownership enforcement:

- `ownerResolver.ts` resolves `solarpro_user_id` against the `users` table.
- If the JWT's user does not exist in the `users` table → reject.
- When ATTACHING to a `solarpro_project_id`, the pipeline verifies the project's `user_id` matches the resolved owner. **Mismatch = reject** (no cross-user writes).

---

## 7. Security Rules (ALL PARTIES)

1. **Never trust a device-supplied `user_id`.** Re-derive from the JWT.
2. **JWT signatures are mandatory** on every request from B and every webhook from C.
3. **Webhook HMAC is mandatory.** A rejects any webhook without a valid `X-Signature`.
4. **Redirect-URI allowlist is mandatory** on `/api/auth/authorize`.
5. **No secrets in logs.** Log only `user_id`, `jti`, and truncated tokens.
6. **Rate limit** the authorize endpoint (bucket: `mobile-session`).

---

## 8. Env Vars Reference

### SolarPro (A)

| Var | Purpose |
|---|---|
| `SOLARPRO_HANDOFF_SECRET` | HS256 signing key for SSO JWTs (≥32 chars) |
| `SURVEY_WEBHOOK_SECRET` | HMAC key for webhook signatures |
| `AUTHORIZE_ALLOWED_REDIRECTS` | Comma-sep allowlist (default `sitesurvey://`) |
| `SURVEY_PROJECT_LINK_STRATEGY` | Optional override (`CREATE_ORPHAN` / `ATTACH_TO_EXISTING` / `TRIAGE_QUEUE`). Default = per-event routing. |

### Mobile (B)

| Var | Purpose |
|---|---|
| `SOLARPRO_AUTHORIZE_URL` | `https://solarpro.solutions/api/auth/authorize` |
| `SURVEY_API_URL` | C's base URL |

### Survey API (C)

| Var | Purpose |
|---|---|
| `SOLARPRO_HANDOFF_SECRET` | Same value as A's — used to verify incoming JWTs |
| `SURVEY_WEBHOOK_SECRET` | Same value as A's — used to sign outgoing webhooks |
| `SOLARPRO_WEBHOOK_URL` | `https://solarpro.solutions/api/webhooks/survey-complete` |

---

## 9. Success Criteria

- [x] A issues JWT with required claims and redirects mobile app correctly
- [x] A validates HMAC webhook and ingests survey for the correct user
- [x] A creates project automatically when no `solarpro_project_id` provided
- [x] A attaches survey to existing project when `solarpro_project_id` provided
- [x] Cross-user project writes are rejected
- [ ] B integrates `/api/auth/authorize` in Expo app (B team)
- [ ] C verifies JWT on `/surveys` and signs webhook (C team)
- [ ] End-to-end smoke test passes in staging

---

## 10. Smoke Test

Run from a dev shell against the staging SolarPro:

```bash
./scripts/smoke-test-sso.sh https://solarpro-dev.vercel.app <test-user-email> <test-user-password>
```

The script:

1. Logs into SolarPro with email/password (gets session cookie).
2. Calls `/api/auth/authorize?redirect_uri=sitesurvey://test&state=abc`.
3. Asserts the redirect `Location` header matches `sitesurvey://test?token=<jwt>&state=abc`.
4. Decodes the JWT and asserts all required claims are present.
5. Verifies `mobile_sso_used_jtis` contains the minted `jti`.
6. Sends a signed webhook with NO `solarpro_project_id` → asserts a new project was created for the user.
7. Sends a signed webhook WITH `solarpro_project_id` → asserts the survey attached to that project.

See `scripts/smoke-test-sso.sh`.