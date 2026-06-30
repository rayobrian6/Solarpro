# HANDOFF — F-13 admin override email to env var

**Date:** 2026-06-19
**Branch:** `chore/agent-rules`
**Commit:** `3db909ea`
**Status:** Local commit ready, three-check suite blocked by pre-existing failures (not from F-13)

---

## Standing Rules (relevant to F-13)

Per `AGENTS.md` and `AI-AGENT-README.md`:

- **R1** — never push to `master` (no push happened; this is a local commit)
- **R2** — three-check suite (`tsc` / `next lint` / `vitest`) before every push
- **R3** — terminology: "website" for the Next.js app, "app" for the mobile
- **R6** — `feat:` commits require JAMES author; `refactor:` does not (dispatch override applied)
- **§9 escalation** — three-check suite red AND not immediately fixable → stop, summarize, wait. **F-13 is stopped here for JAMES's call on the pre-existing blockers.**

---

## What Was Done

F-13 from `AI-AGENT-README.md` §11 closed:

1. **`carpenterjames88@gmail.com` removed from source.** Replaced with `ADMIN_OVERRIDE_EMAIL` env var in `app/api/migrate/route.ts:208`.
2. **New helper `getAdminOverrideEmail()` in `lib/auth.ts`.** Matches the existing `getJwtSecret()` env-var getter pattern. Throws on missing/empty/whitespace env; returns trimmed value otherwise.
3. **Fail-closed behavior.** The migration route reads the env var at request time and returns 500 with a self-documenting error if missing. No hardcoded fallback — a regression here would re-leak the email.
4. **7 new tests in `tests/admin-override-env.test.ts`.** Cover: env var read, whitespace trim, fail-closed for missing/empty/whitespace, error message points at `AI-AGENT-README.md §6`, regression guard against future hardcoded fallback.
5. **`.env.example` updated.** New section for `ADMIN_OVERRIDE_EMAIL` with comment block explaining fail-closed and the Vercel dashboard setup.
6. **`AI-AGENT-README.md` updated.**
   - §6 lists the new env var in the website env vars block.
   - §11 marks F-13 **CLOSED** with resolution note.
7. **HANDOFF doc** — this file.

---

## Current State

- **Branch:** `chore/agent-rules` (JAMES's current working branch per R4)
- **Last commit:** `3db909ea` on `chore/agent-rules`
- **Author:** JAMES `<carpenterjames88@gmail.com>` (per dispatch override; if wrong, JAMES can amend before push per AGENTS.md §3 no-go list)
- **Co-authored-by:** Cody `<cody@underthesun.solutions>` (per AGENTS.md R6 convention for non-JAMES contributors)
- **Three-check status:**
  - `tsc --noEmit --skipLibCheck` — **0 errors**
  - `eslint` on F-13 files (`lib/auth.ts`, `tests/admin-override-env.test.ts`, `app/api/migrate/route.ts`) — **0 errors** (3 pre-existing `no-console` warnings in route.ts, lines 299/1802/1854, not from F-13)
  - `vitest run tests/admin-override-env.test.ts` — **7/7 pass**
  - Full `next lint` — **BLOCKED** by 1 pre-existing error in `lib/siteSurveys/unifiedGeometry/__tests__/phase0WP8.test.ts:158:5` (`@next/next/no-assign-module-variable`). Not from F-13.
  - Full `vitest run` — **51 pre-existing test failures** across 11 files (mostly vision/geometry workers + a few route tests). Not from F-13.

---

## Files Modified

| File | Role | Net change |
|------|------|------------|
| `lib/auth.ts` | Added `getAdminOverrideEmail()` export — fail-closed env-var getter | +27 lines |
| `app/api/migrate/route.ts` | Import helper, read env at start of POST handler (500 on missing), use env-driven email for James's free-pass entry | +13 / -2 |
| `tests/admin-override-env.test.ts` | NEW — 7 vitest tests covering the env-var contract | +99 lines |
| `.env.example` | New "Admin Override Email (F-13)" section with comment block | +18 lines |
| `AI-AGENT-README.md` | §6 lists new env var; §11 marks F-13 CLOSED with resolution | +2 / -1 |

**Not modified** (intentionally):

- `lib/migrations/006_users_subscriptions_whitelabel.sql` — immutable historical migration already applied to production; the active code path (migrate route) is now env-driven.
- `partner_db_audit.md`, `AUDIT_*.md`, `scripts/smoke-test-edge-receipt.md` — historical docs; the email is documented in DB state, not source. These are correct as-is.
- `__mocks__/`, vision worker tests, etc. — not related.

---

## Pending Work

### F-13 itself — DONE (local commit, awaiting JAMES sign-off + push)

### Out of scope for F-13 (separate dailies)

1. **The other 5 hardcoded emails in `freePassUsers` array** (lines 207, 209, 210, 211, 212 of `app/api/migrate/route.ts`):
   - `raymond.obrian@yahoo.com` (super_admin, owner)
   - `cody@underthesun.solutions` (admin, team)
   - `angelique@lmdsolarllc.com` (user, partner)
   - `utsmarketing25@gmail.com` (user, partner)
   - `sarah@solfence.solar` (user, partner)

   These are partners, not a single rotating admin like James's. The F-13 pattern (env-driven, fail-closed) doesn't fit cleanly — they're a list, not a single value. **Suggested approach for follow-up daily:** move the full array to a JSON config file or `PARTNER_FREE_PASS_EMAILS` env var (JSON array), with schema validation. Route this to `solarpro-implementer` after JAMES prioritizes.

2. **Pre-existing test failures (51 across 11 files)** — environment issues (likely missing `DATABASE_URL` / `JWT_SECRET` in test runner; see `next build` warning at start of `next lint` run). Not introduced by F-13. Investigate separately.

3. **Pre-existing lint error** in `lib/siteSurveys/unifiedGeometry/__tests__/phase0WP8.test.ts:158:5` — `@next/next/no-assign-module-variable`. Not introduced by F-13. One-line fix (refactor to use a different module-loading pattern). Investigate separately.

---

## Architecture Notes

### Why `getAdminOverrideEmail()` is in `lib/auth.ts`

- Matches the existing `getJwtSecret()` env-var getter pattern (also in `lib/auth.ts`)
- Existing test files import from `'../lib/auth'` (see `tests/auth-health.test.ts:21`)
- Avoids creating a new `lib/auth/` dir alongside the existing `lib/auth.ts` file
- Future admin env-var helpers (e.g., `PARTNER_FREE_PASS_EMAILS` for the pending follow-up) belong here

### Why the SQL migration is untouched

- `lib/migrations/006_users_subscriptions_whitelabel.sql:99` is immutable historical data — it was applied to production and the row for `carpenterjames88@gmail.com` exists in the live database
- Editing the SQL would change the migration's checksum and risk breaking the migration runner on re-apply
- The active code path that CREATES this user is the migrate route, which is now env-driven
- The DB row itself is a one-time seed — if James's email ever rotates, the admin updates the existing row via a separate operation, not by re-running the migration

### Why fail-closed is the right choice

- A default value (e.g., `process.env.ADMIN_OVERRIDE_EMAIL ?? 'carpenterjames88@gmail.com'`) would re-leak the email — defeating the entire purpose of F-13
- A missing env var is a configuration error — fail fast, fail loud, with an error message that points the operator at the doc
- The test "does NOT fall back to a hardcoded email (regression guard)" enforces this contract

### Terminology check (per R3)

- All new comments and commit messages use "website" (not "app" or "frontend")
- No `SOURCE_DATABASE_URL` or `TARGET_DATABASE_URL` in new code
- The term "admin override" is used consistently — not "override email" or "fallback email" (latter would imply a default value, contradicting the fail-closed contract)

---

## Next Steps

**For JAMES (in order):**

1. **Verify the commit on `chore/agent-rules`.** `git show 3db909ea` — review the diff, the commit message, and the author (JAMES / `carpenterjames88@gmail.com`). If author email is wrong, amend locally before push (per AGENTS.md §3: "Never amend a pushed commit" — local amend is fine).

2. **Decide on the pre-existing three-check blockers.** Two options:
   - **(a) Fix them first.** Investigate the 51 test failures (likely env-var related) and the 1 lint error in `phase0WP8.test.ts:158`. Land as a separate commit (or commits) on `chore/agent-rules`. Then F-13 can push through clean prepush.
   - **(b) Push F-13 with the prepush script bypassed.** Per AGENTS.md R6 + the no-go list, JAMES can override the prepush check on push. The pre-existing failures exist independent of F-13 and don't impact F-13's correctness.

3. **Add `ADMIN_OVERRIDE_EMAIL` to Vercel.** Per `AI-AGENT-README.md` §6, set it on project `solarpro-v31` for all environments (Production ✓ Preview ✓ Development ✓). Same value across all envs.

4. **Run `/api/migrate` once to confirm.** The 500-with-clear-error behavior should appear if env var is not set in Vercel (this is the desired fail-closed — proves the contract works). After setting the env var, the migration runs as before and the James entry uses the env-supplied email.

5. **Verify in production.** After Vercel env var is set, run `POST /api/migrate` against `solarpro.solutions` (gated by `MIGRATE_SECRET`). The response should include `✅ users.<name> — added (or already existed)` for the James entry, with the env-driven email.

**For the agent team (separate dailies):**

- Follow-up on the 5 partner emails in `freePassUsers` — see "Pending Work" #1 above.
- Investigate the pre-existing 51 test failures + 1 lint error.

**For Cody (this session, after F-13 sign-off):**

- Resume `factory-ui` Day 7.5.3 live re-key work when Jason pings (currently parked at the 7.5 final + Day 4-7 report gate).

---

*Last updated 2026-06-19 by Cody (solarpro-implementer lane). Maintained per AGENTS.md §11.*
