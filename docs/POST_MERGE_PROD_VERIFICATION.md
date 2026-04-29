# Post-Merge Production Verification Receipt

**Date:** 2026-04-29 (UTC)
**Branch merged:** `dev` → `master`
**Merge type:** Fast-forward (strict descendant)
**Master HEAD:** `1ce74c0` (was `de51207`)
**Vercel deployment:** `dpl_CNLMMBJSYuP1k1RtkTDDXZj6s3Xk`
**Production domains verified:** `solarpro.solutions`

---

## 1. Deploy Confirmation

`GET /api/admin/debug/env-fingerprint` (admin-gated) returned:

```json
{
  "ok": true,
  "runtime": {
    "node_env": "production",
    "vercel_env": "production",
    "vercel_region": "iad1",
    "commit_sha": "1ce74c0"
  },
  "env": {
    "SOLARPRO_HANDOFF_SECRET": { "present": true, "length": 64, "sha256_prefix": "1e7cf8790e36", "meets_32_char_min": true },
    "SURVEY_WEBHOOK_SECRET":   { "present": true, "length": 64, "sha256_prefix": "b1a4b1acb529", "meets_32_char_min": true },
    "JWT_SECRET":              { "present": true, "length": 44, "sha256_prefix": "03a50d69ca6f", "meets_32_char_min": true },
    "HANDOFF_TOKEN_TTL_SECONDS": { "present": true, "length": 3 },
    "SURVEY_INGEST_DEFAULT_USER_ID": { "present": true, "length": 36 }
  }
}
```

✅ Correct commit deployed.
✅ All required env vars present with production-grade length/entropy.
✅ `sha256_prefix` of `SURVEY_WEBHOOK_SECRET` (`b1a4b1acb529`) matches Render's backend secret
   (hash of the 64-char hex secret that signs real mobile-app webhooks).

---

## 2. Resolver Probe (all 3 Google Play testers)

`GET /api/admin/debug/owner-resolver-probe?user_id=<uuid>`:

| Tester | user_id | ownerSource | Verdict |
|---|---|---|---|
| testagent.solarpro.2025@gmail.com | `195c3524-540b-43bc-8da1-43e3aa5f1eac` | **claim** | ✅ claim honored |
| austinhancock47@gmail.com         | `45e7b558-9a5a-4335-909b-eb1f663c71fe` | **claim** | ✅ claim honored |
| jeff@solfence.solar                | `069416f6-87a6-4d8b-bf3f-ecf98b79c69b` | **claim** | ✅ claim honored |

Diagnostic payload for testagent confirmed the critical detail:

```json
"users_schema": { "has_deleted_at_column": false },
"resolver_sql_direct_attempt": {
  "ran_ok": false,
  "error": "column \"deleted_at\" does not exist",
  "note": "resolver SQL threw — resolver will fall back to default via catch block"
},
"resolver_result": { "ownerId": "<tester-id>", "ownerSource": "claim" }
```

The diagnostic probe still emits the old SQL (expected — it is a dedicated probe),
but the **live resolver** (patched in commit `966ca1d`) no longer references
`deleted_at`, so it returns `ownerSource: "claim"` and routes to the correct user.

---

## 3. Live End-to-End Smoke (production)

Webhook signed with the **real production** `SURVEY_WEBHOOK_SECRET` (as used by the Render backend):

### 3a. Tester path
- Claimed `solarpro_user_id`: `195c3524-540b-43bc-8da1-43e3aa5f1eac` (testagent)
- event_id: `prod-smoke-41cc52cb-98f0-48b8-8d99-1cb4572dc707`
- Response: `HTTP 202`, `code=ACCEPTED_PRE_INGEST`, `reason=INGEST_OK`, `created=true`
- projectId: `8f35ba43-6092-40a4-a221-1d4d580db3be`
- **Verified owner via `/api/admin/projects`:** `owner_email = testagent.solarpro.2025@gmail.com` ✅

### 3b. Admin regression path
- Claimed `solarpro_user_id`: `011526da-28fc-4c01-85a0-d52c0f578fdf` (admin)
- Response: `HTTP 202`, `INGEST_OK`, `created=true`
- projectId: `aa1370cf-23b2-455a-90a2-0a27e43ba646`
- **Verified owner:** `owner_email = raymond.obrian@yahoo.com` ✅

Both paths route correctly. The multi-tenancy fix is live on production.

---

## 4. Mobile-App / Google Play Readiness

| Check | Status |
|---|---|
| All 3 Google Play testers exist in PROD `users` table | ✅ verified |
| Mobile backend (Render) points at `https://solarpro.solutions/api/webhooks/survey-complete` | ✅ confirmed in Render `.env` |
| Render's `SURVEY_WEBHOOK_SECRET` matches PROD (sha256 prefix `b1a4b1acb529`) | ✅ verified via env-fingerprint |
| Render's `SOLARPRO_HANDOFF_SECRET` matches PROD (sha256 prefix `1e7cf8790e36`) | ✅ verified |
| `/api/auth/authorize` mints JWT with `sub`, `solarpro_user_id`, `email`, `iat`, `exp`, `jti` | ✅ verified in Wave 3 battery |
| Webhook path is in middleware `PUBLIC_PATHS` (HMAC-gated only) | ✅ verified |

---

## 5. What Changed in This Merge (30 commits)

Three clusters:

1. **Engineering workspace save/restore** — internal tooling, no behavior change
2. **v60.5 Site Survey SSO + webhook** — new feature: mobile app → web auth handoff + webhook intake
3. **Incident response + multi-tenancy fix + test batteries**
   - `966ca1d` **THE FIX**: removed `AND deleted_at IS NULL` from resolver SQL (column doesn't exist on users table; every claim was failing into default fallback → every survey landed in the admin account)
   - `0268812` multi-user smoke battery
   - `ca4dfec` edge-case test battery (security, ownership, SSO/JWT, ownership audit, regression)
   - `1ce74c0` pre-merge audit document

---

## 6. Rollback Plan (if needed)

- Previous production commit: `de51207`
- Previous deployment: `dpl_Ci5Vb4x8bn5PsuCzAqEf8PDtfvxK`
- Rollback action: Vercel UI → `solarpro-v31` → Deployments → select `dpl_Ci5Vb4x8bn5PsuCzAqEf8PDtfvxK` → "Promote to Production"
- Expected rollback time: ~30 seconds
- **Note:** rollback reintroduces the multi-tenancy bug. Do NOT roll back unless a regression more serious than the bug is observed.

---

## 7. Summary

| Gate | Status |
|---|---|
| Correct commit deployed (`1ce74c0`) | ✅ |
| All prod env vars healthy | ✅ |
| All 3 testers resolve to `claim` source | ✅ |
| Live tester webhook lands in tester's account | ✅ |
| Admin regression webhook lands in admin's account | ✅ |
| Render (mobile backend) wired to prod URL + prod secret | ✅ |

**Production is ready for Google Play Closed Testing.**