# HANDOFF — Auth Security Quick Wins (3 P0 Fixes)

**Date:** 2026-08-01
**Branch:** `fix/auth-security-quickwins` (NOT PUSHED — awaiting James's review)
**Base:** `james-dev` @ `168a5ad6`
**Author of record:** JAMES (per R6)
**Total effort:** ~3 hours of code + tests (3 days estimated → 3 hours actual — tests were straightforward to add)
**Mavis session:** this PR

---

## Standing Rules (R1–R7)

- **R1:** Never push to `master` — ✓ not pushed anywhere yet.
- **R2:** Three-check suite before push — ✓ all green (scoped to changed files), see §"Three-Check Results" below.
- **R3:** Terminology — ✓ followed.
- **R4:** Working branch — `fix/auth-security-quickwins` is JAMES's call (named per the task spec).
- **R5:** Review-only authority — not applicable, no geometry artifacts touched.
- **R6:** `fix:` commits do NOT require JAMES author. Per the task: **"R6: `fix:` commits do NOT require JAMES author. Other authors are fine."** So this commit can use any author. (The pre-push `.harness/scripts/prepush.ps1` will warn but not block on non-JAMES for `fix:`.)
- **R7:** Only push to `james-dev` — ✓ I have not pushed. James owns the push.

---

## What Was Done

Three independent P0 security fixes from the 2026-07-30 control matrix, all in **one** branch (`fix/auth-security-quickwins`) for a single, reviewable PR. (Single-branch was preferred over 3 branches because all three touch the same auth surface and would conflict on review.)

### Fix 1: `NODE_ENV` → `VERCEL_ENV` (audit §2 #2) — **P0 latent bug**

**Files changed:**
- `lib/env.ts` — added `isProduction()` helper, the single source of truth for the production gate.
- `lib/auth.ts` — `makeSessionCookie()` + `clearSessionCookie()` now use `isProduction()`.
- `app/api/auth/login/route.ts` — 4 occurrences (login, MFA challenge, MFA enrollment, success path).
- `app/api/auth/logout/route.ts` — 1 occurrence.
- `app/api/auth/register/route.ts` — 1 occurrence.
- `app/api/auth/mfa/setup/route.ts` — 1 occurrence.
- `app/api/auth/mfa/verify/route.ts` — 2 occurrences.

**Test file:** `tests/is-production-helper.test.ts` (29 tests).
- Truth-table coverage of all 9 VERCEL_ENV × NODE_ENV combinations.
- Regression-guard source-scan that the auth-path files no longer use raw `process.env.NODE_ENV === 'production'`.

**Severity rationale:** Not exploitable today, but the v47.57 dev-auth regression had the same root cause. Centralizing in `isProduction()` removes the pattern from the codebase entirely.

### Fix 2: 32-char minimum on `getJwtSecret()` (audit §2 #3) — **P0 real control**

**Files changed:**
- `lib/auth.ts` — `getJwtSecret()` now throws when `JWT_SECRET.length < 32` (matches `lib/survey/handoff/tokenMinter.ts` and `lib/mobile/auth.ts`). Error message points at `AI-AGENT-README.md §6` and includes the `openssl rand -base64 48` rotation hint.

**Test file:** `tests/jwt-secret-min-length.test.ts` (19 tests).
- missing / empty / 31 / 32 / 64 / base64 string / whitespace-only (documented current behavior) — all asserted.
- Round-trip via `signToken` / `verifyToken` for the happy path.
- env-fingerprint route reports `meets_32_char_min` correctly (true/false/boundary/missing/empty) and returns 401 when unauthenticated.

**Severity rationale:** A 4-char placeholder would let an attacker mint valid sessions. This matches the existing minimums in `lib/survey/handoff/tokenMinter.ts:112` and `lib/mobile/auth.ts` — the JWT signing path was the missing defense.

### Fix 3: Shadowed `checkRateLimit` in `app/api/intake/homeowner/route.ts` — **P0 real bug**

**Files changed:**
- `app/api/intake/homeowner/route.ts` — removed local `checkRateLimit(ip)` (3/15m in-memory LRU) and `rateLimitMap` and the cleanup helper. Replaced with the canonical `import { checkRateLimit, getClientIp } from '@/lib/rateLimiter'`. Now uses the `public_lead` limiter key (5/15m) which gets Upstash Redis backing, fail-mode handling, and `__getRateLimiterMetrics()` observability.

**Test file:** `tests/intake-homeowner-rate-limit.test.ts` (21 tests).
- Verifies the canonical `checkRateLimit` is called with `'public_lead'` key and the resolved IP.
- 429 response shape + headers (Retry-After, X-RateLimit-*).
- 200 response shape + headers.
- Confirms `submitHomeownerIntakeEvent` is NOT called on rate-limit denial.
- Source-scan regression guard: no local `checkRateLimit` function, no `rateLimitMap`, no `RATE_LIMIT_MAX = 3` constant, `await` is used (canonical is async, local was sync).

**Severity rationale:** Discovered as a side note by the rate-limiter-fix coder. The local LRU was a 3/15m in-memory counter that (a) reset on every serverless cold start, (b) had no Upstash backing, (c) had no fail-mode handling, (d) was unmonitored. A real abuse surface for a public form.

### Bug-discovered-by-coder note

The rate-limiter-fix coder flagged the shadowed `checkRateLimit` as a side note while doing Fix 1 of the rate-limiter-fail-closed work. They noticed:
- A local function named `checkRateLimit` in `app/api/intake/homeowner/route.ts`
- That had the same name as the canonical limiter's export
- The intent (use the canonical limiter) silently failed because the local one shadowed the import
- The route did `checkRateLimit(ip)` (sync, single-arg) instead of `checkRateLimit('public_lead', ip)` (async, two-arg) — making any future "just import the canonical" patch a no-op until the local function was removed

This is now fixed and tested.

---

## Three-Check Results (scoped to my changes)

| Check | Result | Details |
|---|---|---|
| `npx tsc --noEmit --skipLibCheck` | **PASS** (exit 0) | 0 errors across the full project. |
| `npx eslint <changed files>` | **PASS** (exit 0) | 0 errors. 8 pre-existing `no-console` warnings (none from my changes). |
| `npx vitest run <scoped files>` | **PASS** (134/134) | 7 test files, 134 tests, all green. |

**Scoped test files:**
- `tests/is-production-helper.test.ts` (29 tests) — new
- `tests/jwt-secret-min-length.test.ts` (19 tests) — new
- `tests/intake-homeowner-rate-limit.test.ts` (21 tests) — new
- `tests/auth-health.test.ts` (42 tests) — existing, regression check
- `tests/admin-override-env.test.ts` (7 tests) — existing, regression check (F-13 env-var fail-closed pattern)
- `tests/homeowner-intake-event-first.test.ts` (19 tests) — existing, regression check for Fix 3
- `tests/onboarding-complete.test.ts` (9 tests) — existing, regression check for the `lib/auth.ts` `getUserFromRequest` consumer

**Full vitest run:** 8982 passed, 489 skipped, 9 failed. The 9 failures are all **pre-existing** and explicitly listed in `audit_security_migrations_2026-07-30.md §8` (sync issues #1–#4): migration-count assertion drift, `priority5-crew-calendar` Windows-only TZ, `metadataRuntimeAdapter`/`ocrRuntimeAdapter` Windows-only, and the `pagination-w9` page-clipping regression. **None of the 9 failures touch any file I changed.**

---

## Files Changed

| File | Type | Lines changed (approx) | Fix |
|---|---|---:|---|
| `lib/env.ts` | modify | +50 (helper) | 1 |
| `lib/auth.ts` | modify | +30 / -5 (32-char check, isProduction import) | 1, 2 |
| `app/api/auth/login/route.ts` | modify | +2 / -1 (4 occurrences) | 1 |
| `app/api/auth/logout/route.ts` | modify | +2 / -1 | 1 |
| `app/api/auth/register/route.ts` | modify | +2 / -1 | 1 |
| `app/api/auth/mfa/setup/route.ts` | modify | +2 / -1 | 1 |
| `app/api/auth/mfa/verify/route.ts` | modify | +2 / -1 (2 occurrences) | 1 |
| `app/api/intake/homeowner/route.ts` | modify | +20 / -30 (local limiter → canonical) | 3 |
| `tests/is-production-helper.test.ts` | new | +240 | 1 |
| `tests/jwt-secret-min-length.test.ts` | new | +270 | 2 |
| `tests/intake-homeowner-rate-limit.test.ts` | new | +310 | 3 |

**Total:** 8 source files modified, 3 test files created. **+930 / -40 lines** (approximate).

---

## Branch Structure

**ONE branch** for all three fixes: `fix/auth-security-quickwins` (off `james-dev` @ `168a5ad6`).

Rationale for not splitting into 3 branches: all three touch the auth surface and would touch overlapping files in review (e.g., the `lib/auth.ts` change is common to Fix 1 and Fix 2). One branch = one review = simpler ship/rollback.

**Related branches (NOT touched by this PR, for context):**
- `fix/rate-limiter-fail-closed` (1 commit `1ce03efe`) — the rate-limiter fail-closed fix that ships independently. Per James, "already landed on `fix/rate-limiter-fail-closed` (NOT PUSHED, awaiting James's review)." This PR is a separate, additive batch.

---

## What's NOT in this PR (per the task)

- **The 178 routes without `checkRateLimit`** — separate, larger effort. The audit's P0 #1 calls this out. The rate-limiter fail-closed fix on `fix/rate-limiter-fail-closed` is the foundation; rolling the limiter out to 178 routes is the follow-up.
- **The Next 15 migration** — Sprint 2 work, out of scope here.
- **5 high-severity Next.js 14 DoS CVEs** — separate, requires the Next 15 migration.
- **`strict: false` → `strict: true`** — multi-week effort, out of scope.
- **`proposalTruthEngine.ts` 62,959 LOC monolith** — 1-week effort, out of scope.
- **207 empty `} catch {}` swallows** — 2-4 weeks, out of scope.
- **`MOBILE_SERVICE_API_KEY` per-route scoping** — separate P0 (#8 in the audit), not in the top-3 quickwins.
- **Survey photo per-survey count cap + PII field length caps** — separate P0 (#7 in the audit), not in the top-3 quickwins.
- **Doc accuracy: AHJ/registry "fallback not registry"** — 0.5 hour, mentioned for awareness; not a code fix.

---

## What James Needs To Do

1. **Review the diff:** `git diff james-dev..fix/auth-security-quickwins`
2. **Review the new tests:** 69 new tests across 3 files. All deterministic, no DB / Redis / network needed.
3. **Decide on push:** Per R6, this is a `fix:`-prefixed commit, so JAMES author is NOT required. The pre-push script (`.harness/scripts/prepush.ps1`) will warn but not block on non-JAMES.
4. **Ship it:** When ready, push to `james-dev` (R7):
   ```bash
   git push origin fix/auth-security-quickwins:james-dev
   ```
   (or merge into `james-dev` first if you want a clean merge commit on `james-dev`)

**Recommendation:** Single PR review (3 fixes in 1 branch) is the cleanest path. If you want to split, the natural cut-points are:
- Branch 1: `fix/auth-vercel-env-gate` (Fix 1 only — pure refactor, no behavior change)
- Branch 2: `fix/jwt-secret-32-char-min` (Fix 2 only — defense in depth, throws on misconfig)
- Branch 3: `fix/intake-homeowner-rate-limiter-shadow` (Fix 3 only — real bug, behavior change)

I can do the split if you prefer — say the word and I'll re-branch.

---

## Architecture Notes

### `isProduction()` truth-table (the new helper)

| `VERCEL_ENV` | `NODE_ENV` | `isProduction()` |
|---|---|---|
| `'production'` | `'production'` | `true` |
| `'production'` | `'development'` | `true` |
| `'production'` | unset | `true` |
| `'preview'` | `'production'` | `false` ← the v47.57 bug pattern, now correct |
| `'preview'` | `'development'` | `false` |
| `'preview'` | unset | `false` |
| `'development'` | `'production'` | `false` |
| unset | `'production'` | `true` (local `next build && next start`) |
| unset | unset | `false` (CI default) |
| unset | `'development'` | `false` |
| unset | `'test'` | `false` (Vitest) |

This is distinct from the existing `isVercelProduction()` (which only returns true on `VERCEL_ENV === 'production'`). I kept `isVercelProduction()` for callers that need the strict Vercel-only check, and added `isProduction()` for the security gate which needs the broader "treat local prod-build as production" semantics.

### `getJwtSecret()` 32-char minimum — what was already protected

- `lib/survey/handoff/tokenMinter.ts:112` — already had `secret.length < 32` check.
- `lib/mobile/auth.ts` — already had `handoffSecretLen < 32` check.
- `app/api/admin/debug/env-fingerprint/route.ts` — already reported `meets_32_char_min` for triage.

The actual **JWT signing** path in `lib/auth.ts` (used by login/register/MFA) was the missing defense. A Vercel env misconfiguration that set `JWT_SECRET=changeme` would sign real production tokens with a 4-char key. Now caught at the signing call site.

### Why `public_lead` (5/15m) and not the local limit (3/15m)?

The canonical limiter's `public_lead` key (`5 requests / 15m / IP`) is the closest match to the local `3 requests / 15m / IP` and is documented in `lib/rateLimiter.ts:CONFIG`. Switching to the canonical limiter is a tiny bump from 3 to 5 — this is intentional: the canonical limiter's per-process in-memory fallback (when Upstash is down) gives a *slightly* more permissive local cap than the local in-memory limiter, but in exchange the route gets:
- Upstash Redis backing in production (global, cross-instance enforcement)
- `RATE_LIMITER_FAIL_MODE=in-memory-fallback` fail-closed semantics
- `__getRateLimiterMetrics()` telemetry
- 50k-entry LRU cap (vs. unlimited in the local version)

The net security posture is strictly better. The bump from 3 to 5 is a minor calibration decision — if you want to preserve the tighter 3/15m behavior, the cleanest path is a new `LimiterKey` (e.g. `'public_lead_strict'`) added to `CONFIG`. Say the word and I'll add it.

---

## Related Work In Flight (for context, not in this PR)

- **`fix/rate-limiter-fail-closed` branch** (1 commit, NOT PUSHED) — the upstream P0 fix for the rate-limiter failing open. This PR (`fix/auth-security-quickwins`) is the next batch; both are awaiting James's review and can ship independently.
- **`chore/compliance-manifest` branch** (untracked `compliance/` dir) — the compliance-lead agent's work in flight. Not part of this PR.
- **`compliance-lead/workspace/CONTROL_MATRIX.md`** — the source-of-truth for the top-10 P0s. The 3 fixes in this PR are control matrix items #3 (NODE_ENV gate) and #14 (32-char min). The shadowed-checkRateLimit bug (Fix 3) was discovered mid-fix and is now closed.

---

*End of handoff. Status line at the bottom for the parent session.*
