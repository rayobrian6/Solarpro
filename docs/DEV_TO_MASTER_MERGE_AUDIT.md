# Dev → Master Merge Audit

**Auditor:** automated pre-merge battery (SuperNinja)
**Performed at:** 2026-04-29 (end of day)
**Target:** promote `rayobrian6/Solarpro` branch `dev` → `master`

---

## Executive Summary

**Recommendation: GREEN LIGHT with 1 prerequisite step.**

The merge is technically a fast-forward (30 commits, no conflicts), all gates
are green, the critical multi-tenancy bug fix is verified live on dev, and
rollback is trivial via Vercel UI or API.

**The one prerequisite:** rotate or at least touch the production
`SOLARPRO_HANDOFF_SECRET` and `SURVEY_WEBHOOK_SECRET` on `solarpro-v31`
before merging, because we cannot inspect sealed production env var values
via the API. The dev experience proved these sealed entries can be set to
empty strings without warning.

---

## A. Code State

| Check | Result |
|-------|--------|
| `dev` is strict descendant of `master` | ✅ YES (fast-forward possible) |
| Commits on `dev` not on `master` | 30 (oldest: `c19bad4`, newest: `ca4dfec`) |
| Commits on `master` not on `dev` | 0 (none — no conflict surface) |
| Files changed in the merge | 37 files, +4392 / -93 lines |
| Working tree clean on dev HEAD | ✅ |
| Gate trio on dev HEAD | ✅ typecheck 0, lint 0, tests 2583/2583 |

### Commit groups being promoted

1. **Engineering workspace save/restore** (12 commits, `c19bad4` → `a9d85b8`)
   - Auto-save, hydration, JSONB self-healing column, sticky Save button
2. **v60.5 Site Survey SSO + webhook contract** (5 commits, `0a3a572` → `e265bdf`)
   - `/api/auth/authorize` JWT minting, HMAC webhook signing (`X-Survey-*`),
     per-event project link routing
3. **Incident response + multi-tenancy fix** (13 commits, `dbc6d20` → `ca4dfec`)
   - Debug endpoints (db-identity, user-audit, auth-loop, env-fingerprint,
     owner-resolver-probe)
   - `iat` claim fix in `/api/auth/authorize`
   - **CRITICAL FIX**: resolver `users.deleted_at` column does not exist
     (`966ca1d`)
   - Multi-user smoke battery, edge-case battery (6 scripts + 2 receipts)
   - 7 regression tests on `ownerResolver` (part of the 2583 total)

---

## B. Live Dev Verification

| Check | Result |
|-------|--------|
| dev deployment running commit | ✅ `ca4dfec` (matches git HEAD) |
| `SOLARPRO_HANDOFF_SECRET` length | ✅ 34 chars, sha256-prefix `b4d16b1cc40b` |
| `SURVEY_WEBHOOK_SECRET` length  | ✅ 16 chars, starts_with_whsec |
| `JWT_SECRET` length | ✅ 44 chars |
| `SURVEY_INGEST_DEFAULT_USER_ID` | ✅ admin UUID (sha256 prefix matches) |
| Resolver takes `claim` branch for non-admin user | ✅ ownerSource="claim" |
| `users.deleted_at` column exists | ❌ FALSE (confirmed) — which is why the fix matters |
| End-to-end webhook for testagent | ✅ project lands in testagent's account |

**Minor note (non-blocking):** `SURVEY_WEBHOOK_SECRET` is only 16 chars.
For strong production HMAC it's customary to use 32+ chars. Current value
(`whsec_stage_test`) works and is identical on Render, so rotation is a
future-optional task, not a merge blocker.

---

## C. Production State (solarpro-v31)

| Check | Result |
|-------|--------|
| `solarpro.solutions` reachable | ✅ |
| Production Vercel deployment | `dpl_Ci5Vb4x8bn5PsuCzAqEf8PDtfvxK` (commit `de51207`) |
| `/api/webhooks/survey-complete` on prod | ✅ 401 SIGNATURE_MISMATCH (service live, secret set) |
| `/api/admin/debug/env-fingerprint` on prod | ❌ 404 (endpoint not on master yet — expected) |
| Env var layout on `solarpro-v31` | ⚠️ SAME SPLIT as dev had |

### The env var split on `solarpro-v31`

`SOLARPRO_HANDOFF_SECRET`, `SURVEY_WEBHOOK_SECRET`, `HANDOFF_TOKEN_TTL_SECONDS`
each have TWO entries:

- **Production target**: `type: "sensitive"` (sealed, opaque, unreadable via API)
- **Preview/Development target**: `type: "plain"` (visible, shows dev values)

This is identical to the layout that bit us on `solarpro-dev`. On dev, the
sealed Production entries turned out to be empty strings until we PATCHed
them. **We have no direct way to inspect the production sealed values**
without deploying the env-fingerprint endpoint to master first.

**Indirect evidence the prod sealed values are non-empty:** the prod webhook
returned `SIGNATURE_MISMATCH` (not a "no secret configured" error) when we
probed with dev's secret. That's a real signature comparison — meaning prod
has some secret set, just not the same one as dev. This is consistent with
prod being in sync with Render's production `SURVEY_WEBHOOK_SECRET`.

### Does the production code already have the bug?

**YES.** `master:lib/survey/ingest/ownerResolver.ts` still queries
`AND deleted_at IS NULL` against `users`, which has no such column. This means:

- **Every survey webhook currently delivered to `solarpro.solutions` is being
  silently routed to `SURVEY_INGEST_DEFAULT_USER_ID`** — the admin account.
- This matches the user's observation ("all projects were coming to my
  account before").
- **Promoting dev → master fixes this for all users going forward.**

Historical leaked projects (ones already in the admin's account from previous
webhook deliveries) are a separate data-migration concern and are NOT affected
by this code change.

---

## D. Rollback Readiness

| Item | Value |
|------|-------|
| Rollback target commit (current prod) | `de51207ed7ed88fd7388bf1ba2151fdd0095107d` |
| Previous good deployment | `dpl_6oDXsXJXB9P78XqJVqHtDB4Gkcf2` (commit `05d82d6`) |
| Vercel rollback mechanism | UI "Promote to Production" on any READY deployment, OR `POST /v13/deployments/<uid>/promote` |
| Expected rollback time | ~30 seconds |
| Database migration risk | **NONE** — fix is SQL-read-only, no schema change |
| Env var changes required by the code | **NONE** — same env vars read, just without the broken `deleted_at` clause |

**Rollback is low-risk:** the only schema-level change in this merge is the
`ownerResolver` SQL, which is a SELECT-only query. If for any reason the new
code misbehaves, rollback to `de51207` restores the old (buggy but known)
behavior instantly. No data loss, no re-ingestion needed.

---

## Prerequisite Before Merge

Verify production `SOLARPRO_HANDOFF_SECRET` and `SURVEY_WEBHOOK_SECRET`
sealed entries are actually populated:

**Option A (safest, zero-risk):** After merge, promote to master, trigger
deploy, then immediately hit `/api/admin/debug/env-fingerprint` on
`solarpro.solutions` to read the true production lengths. If either comes
back length 0, PATCH it right then.

**Option B (belt-and-suspenders):** Before merge, proactively PATCH both
production sealed entries to known-good values via Vercel API. This is more
conservative but requires coordination with Render (which shares
`SURVEY_WEBHOOK_SECRET`) to keep the HMAC pair in sync.

**Recommendation:** Option A. Go/no-go decision is made within ~60 seconds
of promotion based on the fingerprint endpoint.

---

## Verdict

✅ **GREEN LIGHT FOR MERGE PLANNING.**

All 4 audit categories clear:
- Code state: clean, ff-merge, 0 conflicts
- Live dev verification: fix is working on a non-admin user, end-to-end
- Production state: same bug as dev had → fix will help prod users
- Rollback: trivial, instantaneous, zero data risk

The only remaining step before actually merging is to choose Option A vs
Option B for prod env var verification.