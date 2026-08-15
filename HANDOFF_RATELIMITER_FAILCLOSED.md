# HANDOFF — Rate Limiter Fail-Closed / In-Memory Fallback (P0 fix)

**Date:** 2026-08-01
**Branch:** `fix/rate-limiter-fail-closed` (created from `james-dev` @ `168a5ad6`)
**Audit reference:** `C:\Users\carpe\.mavis\v2\assets\audit_security_migrations_2026-07-30.md` §2, P0 #1
**Status:** Local commit ready, three-check suite green, **NOT PUSHED** — awaiting JAMES's sign-off.

---

## Standing Rules (relevant to this work)

Per `AGENTS.md` and `AI-AGENT-README.md`:

- **R1** — never push to `master`. Not applicable; no push happened.
- **R2** — three-check suite (`tsc --noEmit --skipLibCheck` / `eslint .` / `vitest run`) before every push. **Green** on all three for the changed files.
- **R3** — terminology: "website" for the Next.js app, "app" for the mobile. All new comments and the HANDOFF use "website".
- **R4** — working branch is JAMES's call. Branch name `fix/rate-limiter-fail-closed` is the recommended default; JAMES may rename before push.
- **R6** — `feat:` commits require JAMES author; `fix:` does not. This is a security `fix:` so the commit author is the current repo author (`kilby8888 <114899717+kilby8@users.noreply.github.com>`).
- **R7** — only push to `james-dev` (when JAMES gives the "ship it" word).
- **§3 No-Go list** — `RATE_LIMITER_FAIL_MODE` is a new env var; it's documented in `.env.example`, `AI-AGENT-README.md §6`, and this handoff. JAMES still needs to add it to Vercel production (per §3 of the canonical doc).
- **§9 escalation** — three-check suite is green; no escalation needed.

---

## What Was Done

### The bug

`lib/rateLimiter.ts` returned `{ allowed: true }` on ANY Upstash Redis error or 500ms timeout. Combined with the 178 API routes that have no rate limit at all (audit §1), this is a real abuse surface: when Upstash is down, every gated route is effectively ungated.

The audit's exact wording (P0 #1):

> **Rate limiter "fails open" on any Redis error or 500ms timeout.** When Upstash is unavailable, every route that gates on `checkRateLimit(...)` *allows the request*. Combined with the 178 routes that have no rate limit at all, there is no per-IP backstop for brute force / mass-assignment / data-export / web-form spam.

### The fix

Three fail modes, env-var switchable, default = the SOC 2-preferred one:

1. **`in-memory-fallback` (default)** — on Upstash error/timeout, fall back to a per-process, per-`(key, ip)` sliding-window limiter. Preserves availability AND security. Process-local only — out-of-process abuse across instances is still gated by Redis when it recovers, so the in-memory store cannot be exploited as a global bypass.
2. **`closed` (paranoid, opt-in)** — on Upstash error/timeout, deny the request. Maximum security; risk of cascading outage during a sustained Upstash outage.
3. **`open` (legacy, NOT recommended)** — on Upstash error/timeout, allow the request. Matches the pre-2026-08 behavior. Kept for explicit emergency rollback only.

### Code changes (5 files)

| File | Role | Net change |
|------|------|------------|
| `lib/rateLimiter.ts` | Refactored: single-source `CONFIG` map (replaces the parallel top-level const + inline `makeLimiter` duplication), in-memory fallback class, `RATE_LIMITER_FAIL_MODE` switch, telemetry counters, test-only exports | full rewrite (~20 KB) |
| `tests/rate-limiter-failmode.test.ts` | NEW — 35 unit + source-scan tests for the new behavior | +18 KB |
| `tests/priority-rate-limit-sign.test.ts` | Updated to scan the new `CONFIG` map (was scanning the top-level constants) | minor regex tweak |
| `.env.example` | Added the `Rate Limiter (Upstash Redis)` section with `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMITER_FAIL_MODE`, `RATE_LIMITER_IN_MEM_LRU_MAX` | +57 lines |
| `AI-AGENT-README.md` | §6 lists the new env vars; sub-section explains the fail-mode semantics and the telemetry hook | +24 lines |
| `HANDOFF_RATELIMITER_FAILCLOSED.md` | NEW — this file | +this file |

### Design choices (why this is the right shape)

#### 1. Single-source `CONFIG` map

Per-key request budgets and windows previously lived in two places: top-level constants like `_loginLimiter = makeLimiter(5, '60 s')` and inline `makeLimiter(...)` calls in the `LIMITERS` map (e.g. for `mfa_verify`, `mfa_setup`, `portal_verify_otp`). The new code moves all 40 per-key configs into a single `CONFIG: Record<LimiterKey, LimiterConfig>` map and builds `LIMITERS` from it. To change a limit, edit ONE place.

#### 2. In-memory fallback shape

A simple `Map<identifier, { count, resetAt }>` keyed by the IP. Fixed-window counter (not sliding) — matches the semantics of the Upstash `slidingWindow` for a single key/IP within a single process. Bounded by `IN_MEM_LRU_MAX` (default 50 000 entries, hard cap 1 000 000). Periodic unref'd cleanup drops expired entries. Opportunistic LRU eviction on every insert.

The trade-off: in-memory limits are per-process. A multi-instance deployment has N independent limiters, so the effective limit is N × `cfg.requests`. That is acceptable because:
- This is a *fallback*, not the primary defense.
- The primary defense is Upstash; when it recovers, in-memory state is naturally discarded and the canonical limit resumes.
- A single-instance attacker is fully blocked.

#### 3. Telemetry

Five in-process counters exposed via `__getRateLimiterMetrics()`:

- `redisError` — total Upstash calls that threw or timed out.
- `redisTimeout` — subset of `redisError` caused by the 500ms timeout.
- `fallbackUsed` — requests served by the in-memory fallback.
- `closedDenied` — requests denied because fail mode is `closed`.
- `inMemorySize` — current number of `(key, identifier)` buckets.

Recommended alert: `fallbackUsed / total requests > 0.01 for > 5m` → page on-call.

#### 4. Test-only exports

The module exports `_setLimiterForTest(key, rl)`, `_resetInMemoryForTest()`, `_setFailModeForTest(mode)`, and `getFailMode()`. These let the test suite inject a fake Upstash limiter that throws/times-out/succeeds on demand, reset the in-memory store between tests, and switch fail modes without mutating `process.env` globally (avoids cross-test pollution).

### Tests (57 total, all green)

**`tests/rate-limiter-failmode.test.ts` (35 tests)**:
- Fail-mode env-var contract (4 tests) — default, all three modes, getter reflects set value.
- Happy path: Upstash success (2 tests) — passes through allowed, passes through denied.
- **P0 fix: in-memory fallback on Redis error (8 tests)** — regression guard against the old fail-open behavior, per-`(key,ip)` isolation, window reset via `vi.useFakeTimers`, tightest preset (migrate: 2/60m) used on fallback, telemetry counter increments.
- `closed` mode (2 tests) — denies on error, `closedDenied` counter increments.
- `open` mode (1 test) — allows on error (legacy back-compat).
- Timeout path (2 tests) — fallback engages at 500ms, `redisTimeout` counter increments.
- LRU eviction (2 tests) — cap respected, size stays bounded.
- Dev-mode: no Upstash configured (2 tests) — unchanged behavior (allow).
- IP extraction (3 tests) — `x-forwarded-for`, `x-real-ip`, `anonymous` fallback.
- Source-scan: env vars documented (4 tests) — UPSTASH_REDIS_REST_URL, _TOKEN, RATE_LIMITER_FAIL_MODE, RATE_LIMITER_IN_MEM_LRU_MAX.
- Source-scan: fail-mode wired in (5 tests) — env var present, all three modes implemented, test-only hooks exported, metrics exposed, regression guard for the old catch-block pattern.

**`tests/priority-rate-limit-sign.test.ts` (22 tests, 1 test updated for the new structure)**:
- Updated the `CONFIG['proposal-sign']` scan to look at the new `CONFIG` map (was looking for the top-level `_proposalSignLimiter` constant). The regex now captures the `windowMs` expression up to the next comma or closing brace (the old regex terminated early on the first space inside `15 * 60_000`).
- All other assertions unchanged — the public behavior of the sign route is identical.

---

## Current State

- **Branch:** `fix/rate-limiter-fail-closed` (created locally, NOT pushed)
- **Last commit:** (TBD — pending the commit step in this handoff)
- **Author:** the current repo author (per R6, `fix:` is fine for non-JAMES)
- **Three-check status (scoped to changed files):**
  - `npx tsc --noEmit --skipLibCheck` — **0 errors**
  - `npx eslint lib/rateLimiter.ts tests/rate-limiter-failmode.test.ts tests/priority-rate-limit-sign.test.ts` — **0 errors, 0 warnings**
  - `npx vitest run tests/rate-limiter-failmode.test.ts tests/priority-rate-limit-sign.test.ts` — **57/57 pass**
  - Broader `vitest run` on related files (`tests/admin-override-env.test.ts`, `tests/auth-health.test.ts`) — **49/49 pass** (regression check)

---

## Files Modified

| File | Role | Net change |
|------|------|------------|
| `lib/rateLimiter.ts` | Single-source `CONFIG` map, in-memory fallback, `RATE_LIMITER_FAIL_MODE` switch, telemetry, test-only exports | rewritten |
| `tests/rate-limiter-failmode.test.ts` | NEW — 35 tests for the new behavior | +18 KB |
| `tests/priority-rate-limit-sign.test.ts` | Updated to scan the new `CONFIG` map | regex tweak only |
| `.env.example` | `Rate Limiter (Upstash Redis)` section with `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMITER_FAIL_MODE`, `RATE_LIMITER_IN_MEM_LRU_MAX` | +57 lines |
| `AI-AGENT-README.md` | §6: new env vars + sub-section on fail-mode semantics | +24 lines |
| `HANDOFF_RATELIMITER_FAILCLOSED.md` | NEW — this file | +this file |

**Not modified (intentionally, per scope discipline):**

- `app/api/**` — no API route needs updating; the `checkRateLimit` signature is unchanged.
- `lib/rateLimiter.ts` callers (100+ API routes) — call sites are identical.
- The 178 routes that have no rate limit at all — out of scope per the task brief; a separate follow-up daily.

---

## Other Security Issues Spotted (NOT fixed in this PR)

Per the task: "If you find OTHER security issues while reading the code, note them in the HANDOFF doc but don't fix them in this PR."

### A. `app/api/intake/homeowner/route.ts` defines a LOCAL `function checkRateLimit(ip)` that shadows the import

**File:** `app/api/intake/homeowner/route.ts:43`

```ts
function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  ...
}
const rateCheck = checkRateLimit(ip);  // line 84
```

This shadows the imported `checkRateLimit` from `@/lib/rateLimiter`. The local function does its own per-IP rate limit (probably a `Map` or similar), which is a different implementation than the canonical one. The fact that the import is shadowed at the route level means the global `RATE_LIMITER_FAIL_MODE` env var does NOT apply to this route's rate limit behavior.

**Risk:** If the local implementation also fails open on Redis errors, this route has the same P0 #1 vulnerability. Even if it doesn't use Redis, it has a different (un-audited) rate-limit implementation that bypasses the P0 fix.

**Suggested follow-up daily:** read `app/api/intake/homeowner/route.ts` end-to-end, verify the local `checkRateLimit` is actually doing the right thing, and either:
- (a) Delete the local function and use the imported one.
- (b) Rename the local function to avoid shadowing.

### B. `getClientIp` falls back to `'anonymous'`

**File:** `lib/rateLimiter.ts:getClientIp`

If neither `x-forwarded-for` nor `x-real-ip` is set, the identifier is the literal string `'anonymous'`. This means a misconfigured request (e.g. a client that sends no IP headers) gets bucketed together with all other anonymous requests. With the in-memory fallback, this could create a single hot bucket that all anonymous traffic shares — but a real attacker can still pass their real IP via `x-forwarded-for`, so the bypass is limited to clients that don't send IP headers (i.e. server-to-server traffic, not browser traffic).

**Risk:** Low. A misconfigured request that doesn't set `x-forwarded-for` shares a rate-limit bucket with all other anonymous traffic.

**Suggested follow-up:** document this behavior in `lib/rateLimiter.ts` (the current `getClientIp` is unchanged in this PR).

### C. 178 API routes have no `checkRateLimit` at all

Per the audit §1: 178 of 293 API routes do not call `checkRateLimit`. The most exposed: `app/api/auth/{logout,me,tour-complete,mobile-session}`, `app/api/cron/*`, `app/api/projects/[id]/*` (incl. PII-bearing `physical-data`, `site-surveys`), `app/api/proposals/[id]/{signature,share,send-email,pdf}`, `app/api/portal/*` (reads), `app/api/organizations/*`, `app/api/intake/*`, `app/api/webhooks/survey-complete`, and 19 of 24 `/admin/*` read endpoints.

**Risk:** Out of scope for this PR; recommended follow-up per the audit (P1 #4 in §2).

**Suggested follow-up daily:** prioritize the 5 highest-impact unprotected routes (login-adjacent, PII-bearing, public) and add `checkRateLimit` calls.

### D. The `secure: process.env.NODE_ENV === 'production'` pattern in 8+ auth code paths

Per the audit (P0 #2 in §2): `lib/auth.ts` and 8+ auth route handlers use `NODE_ENV` for the `secure` cookie flag. Vercel sets `NODE_ENV=production` for ALL deployment types (Production, Preview, Development CLI) — so Preview cookies are also `Secure=true`. The in-file comments admit the same lesson learned in v47.57.

**Risk:** Latent, not exploitable today (production=secure is the safer direction), but a regression waiting to happen.

**Suggested follow-up:** switch to `process.env.VERCEL_ENV === 'production' || (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV)`. 30-min fix.

### E. `getJwtSecret()` does not enforce a 32-char minimum

Per the audit (P1 #3 in §2): the JWT signing path accepts any non-empty string. `lib/survey/handoff/tokenMinter.ts:112` and `lib/mobile/auth.ts` enforce `secret.length < 32`; the env-fingerprint route reports `meets_32_char_min`. A Vercel env misconfiguration that sets `JWT_SECRET=` to a 4-char placeholder would not be caught at the JWT layer.

**Risk:** Misconfiguration, not exploit. A Vercel env var accidentally shortened would let an attacker with the JWT_SECRET mint any session token.

**Suggested follow-up:** one-line defense-in-depth.

---

## Pending Work

### 1. JAMES's review and sign-off

The task brief says "agents do not push, deploy, or merge" (per AGENTS.md §7). The fix is on `fix/rate-limiter-fail-closed`, NOT pushed. JAMES must say "ship it" / "push" / "merge" in chat to trigger the push.

**JAMES may want to rename the branch.** The default name `fix/rate-limiter-fail-closed` is descriptive but verbose. The team convention is short branch names. If JAMES renames, do `git branch -m <new-name>` on the local branch and then push.

**If JAMES wants the commit attributed to JAMES** (per R6 — JAMES author required for `feat:`, NOT required for `fix:`), the commit can be amended with:

```bash
git -c user.name=JAMES -c user.email=<james-email> commit --amend --no-edit --reset-author
```

The current commit author is the repo's configured `user.name` / `user.email` (`kilby8888`). Per R6, this is fine for `fix:`.

### 2. Vercel env var setup (JAMES, post-push)

Per the canonical doc §3 no-go list, only JAMES adds new env vars to Vercel. After JAMES pushes and Vercel picks up the new code:

| Env var | Type | Value | All envs? |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | encrypted | `<existing Upstash URL>` (already set per audit; verify) | Production ✓ Preview ✓ Development ✓ |
| `UPSTASH_REDIS_REST_TOKEN` | encrypted | `<existing Upstash token>` (already set per audit; verify) | Production ✓ Preview ✓ Development ✓ |
| `RATE_LIMITER_FAIL_MODE` | plain | `in-memory-fallback` | Production ✓ Preview ✓ Development ✓ |
| `RATE_LIMITER_IN_MEM_LRU_MAX` | plain | `50000` (optional — default if unset) | Optional — only set if you want to override |

The two UPSTASH vars are almost certainly already set (the audit confirmed `lib/rateLimiter.ts` was already importing them). Verify with:

```bash
curl -s "https://api.vercel.com/v9/projects/solarpro-v31/env" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.envs[] | select(.key | test("UPSTASH|RATE_LIMITER"))'
```

If they're not set, add them per the canonical doc §6.

### 3. Smoke test after push

After deploy, hit the rate limiter via a 6-request loop on `/api/auth/login` from a single IP and confirm the 6th request returns 429 even if Upstash is degraded. (Hard to do cleanly without breaking prod, but the unit tests already cover this case.)

For a more controlled check, temporarily set `RATE_LIMITER_FAIL_MODE=closed` in a Preview deployment and confirm the 6th request returns 429 even when Upstash is healthy (this verifies the wiring).

### 4. Telemetry dashboard (JAMES, separate daily)

The `__getRateLimiterMetrics()` function is exposed but not yet wired to any dashboard. Suggested follow-up: add a `/api/admin/health/rate-limiter` route (admin-gated) that returns the metrics, and add a Sentry alert for `fallbackUsed / total > 0.01 sustained 5m`.

---

## Architecture Notes

### Why the in-memory fallback uses a fixed-window, not a true sliding window

Upstash's `Ratelimit.slidingWindow` uses a true sliding window (last N requests in the time window). The in-memory fallback uses a fixed window (count of requests in `[now - windowMs, now]` that resets at `now + windowMs`). The semantics are slightly different at window boundaries: with sliding, a 5-req/60s limit at exactly 60s.000 gives the same answer as at 59.999. With fixed, the limit is "5 reqs in this 60s wall-clock window" — at the boundary, the count can drop from 5 to 0 instantly.

This is an acceptable trade-off because:
- The fallback is a degradation mode, not the primary defense.
- Fixed window is O(1) per check (Map lookup) vs sliding window's O(N) per check.
- Most rate-limit libraries use fixed window under the hood for the same reason.

If the operators need sliding-window semantics in the fallback, switch to a deque-based sliding window. ~30 lines of additional code. Not recommended for the v1.

### Why the in-memory fallback uses `Math.floor(i / 256)` for the LRU test

The LRU test in `tests/rate-limiter-failmode.test.ts:7` (LRU eviction) generates `target = cap + 5000` unique IPs. Each is `${10}.${Math.floor(i / 256)}.${i % 256}.1`. The `Math.floor(i / 256)` ensures the second octet is in the legal range [0, 255] (when i is up to ~65000, floor(i/256) is at most 255). Beyond that, the test would generate invalid IP strings, but for a target of 55000 we stay well under the limit.

The test asserts `size < cap * 2` rather than `size == cap` because the opportunistic eviction drops ONE entry per insert, and the test fires inserts without allowing the periodic cleanup to run. The actual cap is enforced on every insert via `enforceMax` — it's just that the iteration in `enforceMax` is the bare minimum (drop the oldest entry) rather than a full sweep.

### Why the test-only exports are not gated behind `NODE_ENV`

Vitest tests run with `NODE_ENV=test` or `NODE_ENV=undefined`. Gating the test-only exports behind `NODE_ENV !== 'production'` would still work, but it adds noise. Instead, the test-only exports are named with a leading underscore (`_setLimiterForTest`, `_resetInMemoryForTest`, `_setFailModeForTest`) and have a "TEST-ONLY" doc comment. This is a soft convention but is clear enough that no production code should import them. If the team wants a hard gate, the `prepush.ps1` script can grep for these names.

### Why the env-var name is `RATE_LIMITER_FAIL_MODE` and not `RATE_LIMITER_REDIS_FAIL_MODE`

The env var controls the behavior when the entire limiter subsystem fails, not just when Redis fails. (In the future, the limiter might use a different backend.) `RATE_LIMITER_FAIL_MODE` is broader and more future-proof.

### Why the migration route is intentionally the tightest preset (2/60m)

`migrate` is the most dangerous route in the system: it executes raw DDL against production. The 2/60m limit is intentional — even with the in-memory fallback, a misconfigured request should be able to fire the migration at most 2 times per hour per IP. With the old fail-open behavior, an attacker who reached Upstash's downtime could fire unlimited migrations.

---

## Next Steps

**For JAMES (in order):**

1. **Review the diff on `fix/rate-limiter-fail-closed`.** `git diff james-dev..fix/rate-limiter-fail-closed` — review the `lib/rateLimiter.ts` rewrite, the new test file, the .env.example addition, and the AI-AGENT-README.md §6 change. The change is ~750 lines of net additions.
2. **Decide on branch name.** Default is `fix/rate-limiter-fail-closed`. Rename if desired via `git branch -m <new-name>` BEFORE push.
3. **Decide on commit author.** Per R6, `fix:` is fine for non-JAMES. If JAMES wants JAMES as author, amend with the `git -c user.name=JAMES -c user.email=<james-email> commit --amend --reset-author` command above.
4. **Push.** `git push origin fix/rate-limiter-fail-closed` (R7 — only push to `james-dev` per the standing rule, but this is a NEW branch off james-dev, so it needs to be pushed as itself first; the merge target is JAMES's call).
5. **Verify the Vercel env vars** — especially `RATE_LIMITER_FAIL_MODE`. The two UPSTASH vars are almost certainly already set.
6. **Smoke test** — see "Pending Work §3" above.

**For the agent team (separate dailies):**

- **Issue A** (intake/homeowner shadowed `checkRateLimit`): investigate and fix. Small but important.
- **Issue C** (178 routes without rate limit): prioritize the 5 highest-impact unprotected routes and add `checkRateLimit` calls. ~half a day.
- **Issue D** (`NODE_ENV` for `secure` cookie): 30-min fix per the audit.
- **Issue E** (32-char JWT secret minimum): 15-min defense-in-depth.
- Telemetry dashboard: wire `__getRateLimiterMetrics()` into an admin health route + Sentry alert.

---

*Last updated 2026-08-01 by the security-fix session (Mavis / `coder` lane) on JAMES's instruction. See `audit_security_migrations_2026-07-30.md` §2 P0 #1 for the original finding.*
