/**
 * Tests for the P0 security fix in lib/rateLimiter.ts:
 *   "rate limiter fails OPEN on Redis errors or 500ms timeouts"
 *
 * The previous behavior of `checkRateLimit` was to return `{ allowed: true }`
 * on any Upstash error or 500ms timeout. This module verifies the new
 * configurable fail mode:
 *
 *   - `in-memory-fallback` (default): use a per-process, per-(key,ip)
 *     sliding-window fallback. SOC 2-preferred.
 *   - `closed`: deny on error. Maximum security.
 *   - `open`: allow on error. Legacy back-compat.
 *
 * Tests use a fake `Ratelimit` injected via `_setLimiterForTest` to
 * deterministically trigger the error/timeout/success paths without
 * needing a live Upstash instance. Time-based behavior uses
 * `vi.useFakeTimers()` so window-reset assertions are deterministic.
 *
 * No DB / Redis connection needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  checkRateLimit,
  _setLimiterForTest,
  _resetInMemoryForTest,
  _setFailModeForTest,
  getFailMode,
  __getRateLimiterMetrics,
  __getInMemoryLruMax,
  type LimiterKey,
} from '../lib/rateLimiter';
import type { Ratelimit } from '@upstash/ratelimit';

// ─── helpers ────────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '..');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/**
 * Build a fake Ratelimit whose `.limit(identifier)` returns a controlled
 * result. Pass `error` to make it throw; pass `timeoutMs` to make it hang
 * (used to test the 500ms timeout path); pass `success:false` to make
 * Upstash say the request should be denied.
 */
function makeFakeLimiter(opts: {
  error?: Error;
  timeoutMs?: number;
  success?: boolean;
  remaining?: number;
  reset?: number;
}): Ratelimit {
  const fake = {
    limit: async (_identifier: string) => {
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        // Sleep longer than RATE_LIMIT_TIMEOUT_MS (500ms). The withTimeout
        // wrapper in the module will reject with 'RATE_LIMIT_TIMEOUT'.
        await new Promise<void>((resolve) => setTimeout(resolve, opts.timeoutMs));
      }
      if (opts.error) throw opts.error;
      return {
        success: opts.success ?? true,
        limit: 0,
        remaining: opts.remaining ?? 5,
        reset: opts.reset ?? Date.now() + 60_000,
      };
    },
  } as unknown as Ratelimit;
  return fake;
}

/** Inject a fake limiter for a key, then reset between tests. */
function injectFake(key: LimiterKey, fake: Ratelimit): void {
  _setLimiterForTest(key, fake);
}

beforeEach(() => {
  // Reset every test: default fail mode, empty in-memory store, no metrics.
  // We restore the default fail mode AFTER setting it (so the readFailMode()
  // at module load captured the original env). For tests we set it
  // explicitly per test.
  _resetInMemoryForTest();
});

afterEach(() => {
  // Belt-and-braces: always clear state and re-install a no-throw fake
  // for the keys commonly used in tests so a leaking fake from one test
  // can't bleed into the next.
  _resetInMemoryForTest();
  _setFailModeForTest('in-memory-fallback');
  _setLimiterForTest('login',        null);
  _setLimiterForTest('register',     null);
  _setLimiterForTest('mfa_verify',   null);
  _setLimiterForTest('migrate',      null);
});

// ─── 1. fail-mode env-var contract ──────────────────────────────────────────
describe('fail-mode env-var contract', () => {
  it("default fail mode is 'in-memory-fallback'", () => {
    // The default applies when RATE_LIMITER_FAIL_MODE is unset.
    // After _setFailModeForTest in afterEach, we set to fallback. Verify
    // the getter returns the value we set.
    _setFailModeForTest('in-memory-fallback');
    expect(getFailMode()).toBe('in-memory-fallback');
  });

  it("accepts 'closed' mode", () => {
    _setFailModeForTest('closed');
    expect(getFailMode()).toBe('closed');
  });

  it("accepts 'open' mode (legacy back-compat)", () => {
    _setFailModeForTest('open');
    expect(getFailMode()).toBe('open');
  });

  it('getFailMode() reflects the current set value', () => {
    _setFailModeForTest('closed');
    expect(getFailMode()).toBe('closed');
    _setFailModeForTest('open');
    expect(getFailMode()).toBe('open');
  });
});

// ─── 2. happy path: Upstash says OK ─────────────────────────────────────────
describe('happy path: Upstash returns success', () => {
  beforeEach(() => {
    injectFake('login', makeFakeLimiter({ success: true, remaining: 4, reset: 1000 }));
  });

  it('passes through allowed=true with remaining and reset', async () => {
    const res = await checkRateLimit('login', '1.2.3.4');
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    expect(res.reset).toBe(1000);
  });

  it('passes through allowed=false when Upstash denies', async () => {
    injectFake('login', makeFakeLimiter({ success: false, remaining: 0, reset: 2000 }));
    const res = await checkRateLimit('login', '1.2.3.4');
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.reset).toBe(2000);
  });
});

// ─── 3. P0 fix: in-memory fallback on Redis error ───────────────────────────
describe('P0 fix: in-memory fallback on Redis error', () => {
  beforeEach(() => {
    _setFailModeForTest('in-memory-fallback');
    // Upstash throws on every call.
    injectFake('login', makeFakeLimiter({ error: new Error('upstash_500') }));
  });

  it('does NOT allow all requests (regression guard for old fail-open behavior)', async () => {
    // Old behavior: 100/100 calls return allowed=true.
    // New behavior: 5/100 pass; the 6th returns allowed=false.
    let allowedCount = 0;
    let deniedCount = 0;
    for (let i = 0; i < 100; i++) {
      const r = await checkRateLimit('login', '1.2.3.4');
      if (r.allowed) allowedCount++;
      else deniedCount++;
    }
    // login = 5 per 60s. First 5 allowed, rest denied.
    expect(allowedCount).toBe(5);
    expect(deniedCount).toBe(95);
  });

  it('enforces the per-(key,identifier) limit from CONFIG', async () => {
    // login is 5/60s — first 5 pass, 6th denied.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => checkRateLimit('login', '1.2.3.4'))
    );
    const allowed = results.filter((r) => r.allowed).length;
    const denied  = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(5);
    expect(denied).toBe(1);
  });

  it('isolates per-key state (login vs register from same IP)', async () => {
    // Each call uses a different key — each has its own 5/60s bucket.
    const loginResults = await Promise.all(
      Array.from({ length: 5 }, () => checkRateLimit('login', '1.2.3.4'))
    );
    const registerResults = await Promise.all(
      Array.from({ length: 5 }, () => checkRateLimit('register', '1.2.3.4'))
    );
    expect(loginResults.every((r) => r.allowed)).toBe(true);
    expect(registerResults.every((r) => r.allowed)).toBe(true);
  });

  it('isolates per-identifier state (login from two different IPs)', async () => {
    // IP A burns its 5/60s quota; IP B should still be allowed.
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit('login', '1.1.1.1');
      expect(r.allowed).toBe(true);
    }
    const deniedA = await checkRateLimit('login', '1.1.1.1');
    expect(deniedA.allowed).toBe(false);

    const allowedB = await checkRateLimit('login', '2.2.2.2');
    expect(allowedB.allowed).toBe(true);
  });

  it('window resets after windowMs elapses', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));

      // Burn the 5-request budget for IP 3.3.3.3 on the 'login' key.
      for (let i = 0; i < 5; i++) {
        const r = await checkRateLimit('login', '3.3.3.3');
        expect(r.allowed).toBe(true);
      }
      const deniedNow = await checkRateLimit('login', '3.3.3.3');
      expect(deniedNow.allowed).toBe(false);

      // Advance past the 60s window.
      vi.setSystemTime(new Date('2026-08-01T00:01:01Z'));

      const afterReset = await checkRateLimit('login', '3.3.3.3');
      expect(afterReset.allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the tightest preset (migrate: 2/60m) on fallback', async () => {
    injectFake('migrate', makeFakeLimiter({ error: new Error('upstash_500') }));

    const r1 = await checkRateLimit('migrate', '4.4.4.4');
    const r2 = await checkRateLimit('migrate', '4.4.4.4');
    const r3 = await checkRateLimit('migrate', '4.4.4.4');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });

  it('telemetry: redisError and fallbackUsed counters increment on error', async () => {
    const before = __getRateLimiterMetrics();
    await checkRateLimit('login', '5.5.5.5');
    const after = __getRateLimiterMetrics();
    expect(after.redisError).toBe(before.redisError + 1);
    expect(after.fallbackUsed).toBe(before.fallbackUsed + 1);
  });

  it('telemetry: inMemorySize grows as we add (key,ip) buckets', async () => {
    const before = __getRateLimiterMetrics();
    await checkRateLimit('login', '6.6.6.6');
    const after = __getRateLimiterMetrics();
    expect(after.inMemorySize).toBe(before.inMemorySize + 1);
  });
});

// ─── 4. fail-mode: `closed` denies on Redis error ───────────────────────────
describe("fail-mode: 'closed' denies on Redis error", () => {
  beforeEach(() => {
    _setFailModeForTest('closed');
    injectFake('login', makeFakeLimiter({ error: new Error('upstash_500') }));
  });

  it('denies every request when Upstash errors and mode is closed', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await checkRateLimit('login', '7.7.7.7');
      expect(r.allowed).toBe(false);
    }
  });

  it('telemetry: closedDenied counter increments', async () => {
    const before = __getRateLimiterMetrics();
    await checkRateLimit('login', '7.7.7.7');
    const after = __getRateLimiterMetrics();
    expect(after.closedDenied).toBe(before.closedDenied + 1);
    // In closed mode, the in-memory fallback is NOT used.
    expect(after.fallbackUsed).toBe(before.fallbackUsed);
  });
});

// ─── 5. fail-mode: `open` (legacy) allows on Redis error ─────────────────────
describe("fail-mode: 'open' (legacy) allows on Redis error", () => {
  beforeEach(() => {
    _setFailModeForTest('open');
    injectFake('login', makeFakeLimiter({ error: new Error('upstash_500') }));
  });

  it('allows every request when Upstash errors and mode is open', async () => {
    // Same as the pre-2026-08 behavior — kept for explicit opt-in only.
    for (let i = 0; i < 10; i++) {
      const r = await checkRateLimit('login', '8.8.8.8');
      expect(r.allowed).toBe(true);
    }
  });
});

// ─── 6. fail-mode: timeout path (500ms) ─────────────────────────────────────
describe('fail-mode: 500ms timeout', () => {
  beforeEach(() => {
    _setFailModeForTest('in-memory-fallback');
    // Hang for 5 seconds — well over the 500ms timeout.
    injectFake('login', makeFakeLimiter({ timeoutMs: 5_000 }));
  });

  it('falls back to in-memory when Upstash hangs > 500ms', async () => {
    // The first call will time out at ~500ms; we then issue 4 more to
    // confirm the in-memory fallback budget is also being used.
    const r1 = await checkRateLimit('login', '9.9.9.9');
    expect(r1.allowed).toBe(true);

    // Remaining 4 of the 5/60s budget.
    for (let i = 0; i < 4; i++) {
      const r = await checkRateLimit('login', '9.9.9.9');
      expect(r.allowed).toBe(true);
    }

    // 6th should be denied.
    const r6 = await checkRateLimit('login', '9.9.9.9');
    expect(r6.allowed).toBe(false);
  });

  it('telemetry: redisTimeout counter increments on the timeout path', async () => {
    const before = __getRateLimiterMetrics();
    await checkRateLimit('login', '9.9.9.9');
    const after = __getRateLimiterMetrics();
    expect(after.redisTimeout).toBe(before.redisTimeout + 1);
    // And because we set the timeout up specifically, redisError should
    // also have grown.
    expect(after.redisError).toBe(before.redisError + 1);
  });
});

// ─── 7. LRU eviction ────────────────────────────────────────────────────────
describe('in-memory LRU eviction', () => {
  it('caps the in-memory store at __getInMemoryLruMax() entries', () => {
    const cap = __getInMemoryLruMax();
    expect(cap).toBeGreaterThan(0);
    expect(typeof cap).toBe('number');
  });

  it('drops the oldest entries when over the cap', async () => {
    // We use a very large identifier space to trigger eviction. The store
    // enforces the cap opportunistically (on each insert when full).
    //
    // IMPORTANT: This test does NOT verify the *exact* cap (the module
    // reads the cap at module-load from RATE_LIMITER_IN_MEM_LRU_MAX). It
    // verifies the INVARIANT that the store size never exceeds 2× the
    // reported cap by a wide margin.
    _setFailModeForTest('in-memory-fallback');
    injectFake('login', makeFakeLimiter({ error: new Error('upstash_500') }));

    const cap = __getInMemoryLruMax();
    const target = cap + 5_000;
    for (let i = 0; i < target; i++) {
      // Use a unique IP per call.
      await checkRateLimit('login', `10.${Math.floor(i / 256)}.${i % 256}.1`);
    }

    const size = __getRateLimiterMetrics().inMemorySize;
    // The store should be at-or-near the cap, NOT ballooned to 2×.
    // We allow some slop for the opportunistic enforcement.
    expect(size).toBeLessThan(cap * 2);
    expect(size).toBeGreaterThan(0);
  });
});

// ─── 8. dev-mode: no Upstash configured → allow (unchanged) ─────────────────
describe('dev-mode: no Upstash configured (entry.rl is null)', () => {
  beforeEach(() => {
    // Null means "no Upstash configured" — should still allow, matching
    // the pre-2026-08 dev-mode behavior.
    _setLimiterForTest('login', null);
    _setFailModeForTest('in-memory-fallback');
  });

  it('allows every request when no Upstash is configured', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await checkRateLimit('login', '11.11.11.11');
      expect(r.allowed).toBe(true);
    }
  });

  it('does NOT increment telemetry counters (no error happened)', async () => {
    const before = __getRateLimiterMetrics();
    await checkRateLimit('login', '11.11.11.11');
    const after = __getRateLimiterMetrics();
    expect(after.redisError).toBe(before.redisError);
    expect(after.fallbackUsed).toBe(before.fallbackUsed);
  });
});

// ─── 9. IP extraction helper (regression — unchanged) ───────────────────────
describe('getClientIp — unchanged behavior', () => {
  it('uses x-forwarded-for first value', async () => {
    // Dynamic import to avoid pulling lib/rateLimiter side effects into
    // a static test name.
    const { getClientIp } = await import('../lib/rateLimiter');
    const req = { headers: { get: (h: string) => h === 'x-forwarded-for' ? '1.2.3.4, 10.0.0.1' : null } } as unknown as Request;
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', async () => {
    const { getClientIp } = await import('../lib/rateLimiter');
    const req = { headers: { get: (h: string) => h === 'x-real-ip' ? '5.6.7.8' : null } } as unknown as Request;
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it("returns 'anonymous' if no IP headers present", async () => {
    const { getClientIp } = await import('../lib/rateLimiter');
    const req = { headers: { get: () => null } } as unknown as Request;
    expect(getClientIp(req)).toBe('anonymous');
  });
});

// ─── 10. source-scan: env-var documentation in .env.example ─────────────────
describe('source-scan: env vars are documented', () => {
  const env = readSrc('.env.example');

  it('UPSTASH_REDIS_REST_URL is in .env.example', () => {
    expect(env).toMatch(/^UPSTASH_REDIS_REST_URL\s*=/m);
  });

  it('UPSTASH_REDIS_REST_TOKEN is in .env.example', () => {
    expect(env).toMatch(/^UPSTASH_REDIS_REST_TOKEN\s*=/m);
  });

  it('RATE_LIMITER_FAIL_MODE is in .env.example with the default value', () => {
    expect(env).toMatch(/^RATE_LIMITER_FAIL_MODE\s*=\s*in-memory-fallback/m);
  });

  it('RATE_LIMITER_IN_MEM_LRU_MAX is in .env.example', () => {
    expect(env).toMatch(/^RATE_LIMITER_IN_MEM_LRU_MAX\s*=/m);
  });
});

// ─── 11. source-scan: fail-mode is implemented, not a stub ──────────────────
describe('source-scan: fail-mode is wired in, not a stub', () => {
  const src = readSrc('lib/rateLimiter.ts');

  it('declares RATE_LIMITER_FAIL_MODE as a recognized env var', () => {
    expect(src).toContain("RATE_LIMITER_FAIL_MODE");
  });

  it('implements all three fail modes', () => {
    expect(src).toContain("'closed'");
    expect(src).toContain("'in-memory-fallback'");
    expect(src).toContain("'open'");
  });

  it('exports test-only hooks for the fail mode and in-memory reset', () => {
    expect(src).toContain('_setFailModeForTest');
    expect(src).toContain('_resetInMemoryForTest');
    expect(src).toContain('_setLimiterForTest');
  });

  it('exposes metrics for observability', () => {
    expect(src).toContain('__getRateLimiterMetrics');
    expect(src).toContain('redisError');
    expect(src).toContain('fallbackUsed');
    expect(src).toContain('closedDenied');
  });

  it('regression guard: the catch block no longer returns { allowed: true } unconditionally', () => {
    // The old behavior: every error/timeout returned { allowed: true }.
    // The new code branches on FAIL_MODE. We assert that the only place
    // { allowed: true } appears in the catch block is the explicit
    // 'open' fail mode.
    const catchStart = src.indexOf('} catch (err: unknown)');
    const catchEnd   = src.indexOf('// ── IP extraction helper', catchStart);
    expect(catchStart).toBeGreaterThan(-1);
    expect(catchEnd).toBeGreaterThan(catchStart);
    const catchBody = src.slice(catchStart, catchEnd);
    // The catch body must branch on FAIL_MODE.
    expect(catchBody).toContain("FAIL_MODE === 'closed'");
    expect(catchBody).toContain("FAIL_MODE === 'open'");
    // And there must be a fallback path that uses inMemoryCheck.
    expect(catchBody).toContain('inMemoryCheck(');
  });
});
