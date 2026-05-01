# Edge-Case Battery — Receipt

**Run at:** 2026-04-29 (post-commit `966ca1d`)
**Target:** https://solarpro-dev.vercel.app
**Admin:** raymond.obrian@yahoo.com (`011526da-28fc-4c01-85a0-d52c0f578fdf`)
**Purpose:** Exercise edge cases beyond the core multi-tenant battery, so we
are prepared to promote `dev → master` with confidence.

---

## Wave 1 — Security Boundary (`smoke-test-security-boundary.sh`)

Target: `/api/webhooks/survey-complete` (public, HMAC-signed).

| # | Test | Expected | Result |
|---|------|----------|--------|
| 6 | Wrong signature (bad HMAC) | 401 | ✅ 401 |
| 7 | Expired timestamp (15 min old) | 401 | ✅ 401 |
| 8a | Missing `event_id` | 400 | ✅ 400 |
| 8b | Missing `survey_id` | 400 | ✅ 400 |
| 8c | Missing `completed_at` | 400 | ✅ 400 |
| 9 | Unsupported event type (`survey.started`) | 400 | ✅ 400 |

**Wave 1 verdict: 6/6 PASS.** Security boundary holds on signature, replay, and envelope shape.

---

## Wave 2 — Ownership Routing (`smoke-test-ownership-edge.sh`)

Target: `/api/webhooks/survey-complete` with varied `solarpro_user_id` claims.
Verification: admin login + `/api/admin/projects?limit=500` to read `owner_email`.

| # | Test | Expected | Result |
|---|------|----------|--------|
| T2 | Missing `solarpro_user_id` claim | owner = admin (default) | ✅ |
| T1a | Malformed `solarpro_user_id` (non-UUID) | owner = admin (default) | ✅ |
| T1b | Well-formed but nonexistent UUID | owner = admin (default) | ✅ |
| T1c | Empty-string `solarpro_user_id` | owner = admin (default) | ✅ |
| T5 | Idempotency (same `event_id` twice) | 2nd call returns `duplicate:true` | ✅ (HTTP 200 with `duplicate:true, existingDeliveryId`) |
| T4 | 3 concurrent webhooks, same user, distinct ids | 3 distinct projects | ✅ (HTTP 202/202/202) |

**Wave 2 verdict: 6/6 PASS.** Resolver returns `default` for every malformed/missing
claim path (not `null`, not an error); concurrency doesn't collapse into a single
project; idempotency correctly identifies same `event_id`.

---

## Wave 2b — Cross-Tenant Hijack (`smoke-test-hijack.sh`)

Scenario: User A sends a webhook with their own `solarpro_user_id` but targets
User B's `solarpro_project_id` (hijack attempt).

**Expected safe behaviors (any one is acceptable):**
1. Reject the attach because the project doesn't belong to the claimant
2. Create a new orphan project under User A and ignore the bogus project_id

**Actual behavior observed:**
```
HTTP 202 (delivery accepted + logged)
reason: INGEST_FAILED_BUT_LOGGED
ingestError: "Project upsert failed: ATTACH_TO_EXISTING:
              project b1970b8d-... not found for owner 195c3524-...
              or has been deleted"
ingestErrorCode: DB_WRITE_FAILED
```

**Wave 2b verdict: SAFE.** The ingest pipeline's `_upsertProject()` scopes the
attach lookup by owner (`WHERE id = ? AND user_id = ?`). When User A tries to
attach to User B's project, zero rows match, the attach fails cleanly, and the
delivery is logged with a precise error code. **Victim project owner unchanged.**
**Attacker's webhook creates no project at all** (no silent fallback orphan).

---

## Wave 3 — SSO / JWT Boundary (`smoke-test-authorize.sh`)

**Scope adjustment:** the original plan targeted `/api/survey/submit` with bad
JWTs, but that endpoint is middleware-gated (requires session cookie) and is
**not used by the mobile app flow**. The mobile app uses the public
`/api/webhooks/survey-complete` instead. The real JWT-minting boundary on the
SolarPro side is `/api/auth/authorize`.

| # | Test | Expected | Result |
|---|------|----------|--------|
| T14a | `/api/auth/authorize` without session | 401 (or redirect to login) | ✅ 401 |
| T14b | `/api/auth/authorize` with valid session + `sitesurvey://` redirect | 302 with token in Location | ✅ 302 with 405-char JWT |
| T14c | `/api/auth/authorize` with attacker `redirect_uri=https://evil.example/` | rejected (open-redirect defense) | ✅ 400 |
| T14d | Minted JWT contains required claims | `sub, email, iat, exp, jti` all present | ✅ (and `solarpro_user_id`, `name`) |
| T14e | Minted JWT verifies with `SOLARPRO_HANDOFF_SECRET` | HS256 verify passes | ✅ |

**Wave 3 verdict: 5/5 PASS.** `iat` fix from commit `614d332` is live and working.
Open-redirect defense is in place. JWT is cryptographically sound.

---

## Wave 4 — Ownership Audit (`smoke-test-ownership-audit.sh`)

Read-only sweep across the entire dev DB (148 projects, 12 owners).

**Ownership distribution:**
```
106 raymond.obrian@yahoo.com   (admin + legit admin projects + pre-fix leakage)
 11 sarah@solfence.solar
 10 utsmarketing25@gmail.com
  9 carpenterjames88@gmail.com
  2 testagent.solarpro.2025@gmail.com
  2 test.fallback.sync@example.com
  2 michaelorrmusic@gmail.com
  2 jeff@solfence.solar
  1 rayobrian6@gmail.com
  1 cody@underthesun.solutions
  1 austinhancock47@gmail.com
  1 angelique@lmdsolarllc.com
```

**Sanity checks:**
- ✅ No projects with null/empty `owner_email`
- ✅ All `owner_email` values are valid email format
- ✅ Project total (148) matches sum of ownership buckets (148) — no hidden rows

**Post-fix test users all own their own projects (not the admin's):**
- testagent: 2 projects
- austinhancock47: 1 project
- jeff: 2 projects
- test.fallback.sync: 2 projects

**Wave 4 verdict: CLEAN.**

*Note on admin's high count (106):* this is the pre-existing historical leakage
from before commit `966ca1d` plus Wave 2 tests that deliberately used
`ADMIN_ID`. The post-fix behavior is correct — new survey webhooks for
non-admin users route correctly to those users' accounts.

---

## Wave 5 — Regression (`smoke-test-battery.sh`)

Re-ran the original multi-user battery (3 users × CASE-2 CREATE + CASE-1 ATTACH).

```
| testagent.solarpro.2025@gmail.com | CASE-2 CREATE | ✅ | ...new id...      | testagent.solarpro.2025@gmail.com |
| austinhancock47@gmail.com        | CASE-2 CREATE | ✅ | ...new id...      | austinhancock47@gmail.com        |
| jeff@solfence.solar              | CASE-2 CREATE | ✅ | e6083333-...      | jeff@solfence.solar              |
| testagent.solarpro.2025@gmail.com | CASE-1 ATTACH | ✅ | cf8716d9-...      | attached (created=false)         |

Admin's project count BEFORE test: 29
Admin's project count AFTER test:  29
Delta: 0
```

**Wave 5 verdict: ALL BATTERY TESTS PASSED.** No regression from the edge-case
work; multi-tenant isolation still holds.

---

## Gate Trio at Time of Final Commit

- **typecheck:** 0 errors
- **lint:** 0 errors (3 pre-existing warnings, unrelated)
- **tests:** 2583 passed / 2583 total

---

## Findings Worth Noting (Not Bugs — For Your Awareness)

1. **`/api/survey/submit` is middleware-gated** (requires session cookie). Its
   own route handler checks Bearer JWTs, but middleware rejects before the
   handler runs. This is fine because the mobile app doesn't actually use this
   endpoint — it uses the public, HMAC-signed `/api/webhooks/survey-complete`
   instead. But if anyone tries to document `/api/survey/submit` as a mobile
   endpoint, they'll hit a wall.

2. **`/api/site-survey/upload` has the same middleware gate** — same observation
   as above. Likely legacy.

3. **Nonexistent endpoints return 401 "Authentication required"** (not 404).
   E.g., `/api/webhooks/site-survey` (wrong path) returns 401. This is Next.js
   middleware behavior — the middleware runs before the 404 is generated for
   unknown paths. Cosmetic, not a vulnerability.

4. **`project_name` in the webhook envelope is ignored** — project names are
   derived from `rawPayload.site_name` / `rawPayload.project_name` or default
   to `"Survey <survey_id>"`. This is by design (see `transformLayer.ts`).
   My test scripts' top-level `project_name: "SMOKE-EDGECASE-..."` was
   discarded, which is why projects show up as `"Survey <uuid>"` in the admin
   list. Cosmetic for tests, not a bug.

5. **Admin `/api/admin/projects` response drops `user_id` and `owner_id`**
   from the output, only showing `owner_email` and `owner_name`. This is the
   known `rowToProject()` audit gap — doesn't affect functionality but makes
   programmatic ownership checks rely on email matching. Flagged for future
   cleanup.

---

## Are We Ready for `dev → master` Promotion?

**Strongly yes, based on:**

- Wave 1: security boundary verified (signature, replay, envelope)
- Wave 2: ownership routing correct on 6 edge-case paths + concurrency + idempotency
- Wave 2b: cross-tenant hijack blocked by ingest pipeline
- Wave 3: JWT minting produces valid, signed, claim-complete tokens; open-redirect defense active
- Wave 4: dev DB audit clean — no null owners, no shape corruption
- Wave 5: original regression battery still passes
- Gate trio: 0 typecheck errors, 0 lint errors, 2583/2583 tests