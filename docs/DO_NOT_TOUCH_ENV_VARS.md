# DO NOT TOUCH — Locked Environment Variables

**STATUS: HARD LOCK**
**OWNER: Raymond O'Brian**
**LAST UPDATED: 2026-04-29**

This file lists environment variables that are **set on multiple systems** and
**MUST NOT be modified** by any engineer, agent, or automated process without
explicit approval from the owner (Raymond).

Editing any of these values **silently breaks inter-system contracts** because
the counterparty systems will be left holding the old value. There is no
automated way to detect the break until real traffic fails.

---

## 🔒 LOCKED VARIABLES

### `SURVEY_WEBHOOK_SECRET`

- **Value:** `whsec_stage_test` (verified in owner message 2026-04-29)
- **Used on:**
  - SolarPro Website (A) — `lib/survey/verifyWebhookSignature.ts`
  - Render Survey API (C) — `backend/` in `rayobrian6/site_survey-app-1`
- **Purpose:** HMAC-SHA256 signing secret for the `/api/webhooks/survey-complete`
  contract. Signed string format: `${X-Survey-Timestamp}.${rawBody}`.
- **Why locked:** Both ends must share the exact same secret. Rotating it on
  one side without the other causes every survey webhook to fail signature
  verification and be rejected with HTTP 401.
- **To rotate:** requires coordinated deploy of both SolarPro and Render API
  AND owner approval.

### `SOLARPRO_HANDOFF_SECRET`

- **Used on:**
  - SolarPro Website (A) — `app/api/auth/authorize/route.ts` (signer),
    `app/api/users/solarpro-sso/route.ts` (... actually the mobile app's
    Render backend verifies this, but SolarPro mints it)
  - Render Survey API (C) — will verify `Authorization: Bearer <jwt>` on
    `/surveys` POST once kilby8 ships his middleware
- **Purpose:** HS256 JWT signing key for the mobile SSO flow. 10-min TTL
  tokens issued by `/api/auth/authorize`.
- **Why locked:** Same as webhook secret — rotation breaks the mobile SSO
  contract until both sides are redeployed.

### `JWT_SECRET`

- **Used on:** SolarPro Website (A) only — `lib/auth.ts` `signToken` +
  `verifyToken` for user session cookies.
- **Why locked:** Rotation immediately invalidates **every logged-in user's
  session cookie**. Every user gets bounced back to `/login` on their next
  request. This is the suspected root cause of the April 28 2026 auth
  incident ("users keep having to reset their passwords").
- **To rotate:** users must be notified in advance, or the rotation should
  happen during scheduled maintenance. Consider issuing a
  `clearSessionCookie()` grace period during transition.

### `DATABASE_URL`

- **Used on:** SolarPro Website (A) everywhere.
- **Why locked:** Swapping the Neon connection string to a different database
  or branch effectively disconnects every existing user account. Password
  resets done on the old DB will not work against the new DB and vice versa.

---

## Policy

- **No autonomous env edits.** Any change to these vars must be explicitly
  requested by the owner.
- **No bulk .env imports** to Vercel for these vars. The April 28 incident
  was caused by a bulk update that simultaneously rotated
  `JWT_SECRET`, `DATABASE_URL`, `SURVEY_WEBHOOK_SECRET`, and
  `SOLARPRO_HANDOFF_SECRET` — invalidating every session cookie and
  potentially repointing the database.
- **If you need to add a new secret:** consult the owner first. Do not add,
  remove, or reorder env vars without written approval.

---

## Emergency contact

Owner: Raymond O'Brian (`raymond.obrian@yahoo.com`,
Vercel account `underthesunsolar24@gmail.com`)