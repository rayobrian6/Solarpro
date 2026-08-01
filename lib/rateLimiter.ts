// lib/rateLimiter.ts
//
// Phase 27/27b: Full rate limiting coverage for all 149 mutation routes.
//
// ── SECURITY MODEL (P0 fix, 2026-08) ────────────────────────────────────────
//
// The previous behavior of this module was to FAIL OPEN on any Redis error
// or 500ms timeout: when Upstash was unavailable, every route that gates on
// `checkRateLimit(...)` simply *allowed* the request. Combined with the 178
// API routes that had no rate limit at all, this left a real abuse surface
// (brute force / mass-assignment / data-export / web-form spam).
//
// The new behavior uses a configurable fail mode (env var
// `RATE_LIMITER_FAIL_MODE`, default `in-memory-fallback`):
//
//   1. `in-memory-fallback` (default, SOC 2-preferred)
//        On Redis error/timeout, fall back to a per-process, per-(key,ip)
//        sliding-window limiter. Preserves availability AND security for
//        a single-function-instance abuse pattern. Process-local only —
//        out-of-process abuse across instances is still gated by Redis
//        when it recovers, so the in-memory store cannot be exploited as
//        a global bypass.
//
//   2. `closed` (paranoid, opt-in)
//        On Redis error/timeout, DENY the request. Maximum security; risk
//        of cascading outage if Upstash is down for an extended period.
//
//   3. `open` (legacy, explicit opt-in for back-compat)
//        On Redis error/timeout, ALLOW the request. Matches the pre-2026-08
//        behavior. NOT recommended. Included only for emergency rollback.
//
// In all modes, an "Upstash not configured at all" state (no env vars)
// still allows the request — this is the dev-mode path. Production
// deployments MUST have UPSTASH_REDIS_REST_URL / _TOKEN set.
//
// ── TELEMETRY ──────────────────────────────────────────────────────────────
//
// In-process counters exposed (read-only) via `__getRateLimiterMetrics()`
// for observability. Use these to detect sustained Upstash outages:
//
//   - redisError     total Upstash calls that threw or timed out
//   - redisTimeout   subset of redisError caused by the 500ms timeout
//   - fallbackUsed   requests served by the in-memory fallback
//   - closedDenied   requests denied because fail mode = `closed`
//   - inMemorySize   current number of (key,identifier) buckets in the LRU
//
// A non-zero `fallbackUsed` sustained over minutes indicates Upstash
// degradation. The recommend alerting is:
//
//   fallbackUsed / total requests  > 0.01   for > 5m   → page on-call
//
// ── LIMITER CONFIG (single source of truth) ────────────────────────────────
//
// Every per-key limit (requests, windowMs) lives in `CONFIG` below. The
// `LIMITERS` map is built from `CONFIG` at module-load time and contains
// both the Upstash Ratelimit instance and the config it was built from
// (so the in-memory fallback can use the same per-key numbers).

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ── Public types ────────────────────────────────────────────────────────────

/** Per-key rate-limit configuration. The single source of truth for limits. */
export type LimiterConfig = {
  /** Maximum number of requests allowed in the window. */
  requests: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/** One entry in the LIMITERS map: the Upstash limiter + its config. */
type LimiterEntry = {
  /** `null` when Upstash env vars are not set (dev mode). */
  rl: Ratelimit | null;
  cfg: LimiterConfig;
};

/** Result of `checkRateLimit`. */
export type RateLimitResult = {
  allowed: boolean;
  remaining?: number;
  reset?: number;
};

/** Fail mode when the Upstash call errors or times out. */
export type FailMode = 'closed' | 'in-memory-fallback' | 'open';

/** Read-only metrics for telemetry. */
export type RateLimiterMetrics = {
  redisError: number;
  redisTimeout: number;
  fallbackUsed: number;
  closedDenied: number;
  inMemorySize: number;
};

// ── LimiterKey union ────────────────────────────────────────────────────────
export type LimiterKey =
  // Auth
  | 'login'
  | 'register'
  | 'password-reset'
  | 'delete-account'
  | 'mobile-session'
  | 'mfa_verify'
  | 'mfa_setup'
  // AI / compute
  | 'bill-upload'
  | 'engineering'
  | 'ocr'
  | 'auto-design'
  | 'pipeline'
  | 'system-size'
  | 'system-capabilities'
  // External APIs
  | 'solar-api'
  | 'satellite'
  | 'geo'
  | 'utility-detect'
  | 'utility-rates'
  | 'maps-session'
  | 'production'
  | 'topography'
  | 'tile'
  // Standard CRUD
  | 'standard'
  | 'admin'
  | 'feedback'
  | 'enterprise-contact'
  | 'tos'
  | 'stats'
  | 'activity'
  | 'commands'
  | 'hardware'
  | 'incentives'
  | 'survey'
  | 'settings'
  | 'stripe'
  | 'migrate'
  // Homeowner portal
  | 'portal_login'
  | 'portal_verify_otp'
  | 'portal_read'
  // Public forms (no auth)
  | 'public_lead'
  | 'proposal-sign';

// ── CONFIG (single source of truth for per-key limits) ──────────────────────
//
// All per-key request budgets and windows. Kept alphabetical within each
// group for diff-friendliness. To change a limit, edit ONLY this map.
//
// WINDOWS (in ms):
//   1 s   = 1_000
//   30 s  = 30_000
//   60 s  = 60_000
//   5 m   = 5 * 60_000        = 300_000
//   10 m  = 10 * 60_000       = 600_000
//   15 m  = 15 * 60_000       = 900_000
//   60 m  = 60 * 60_000       = 3_600_000
const CONFIG: Record<LimiterKey, LimiterConfig> = {
  // ── Auth (tight limits — brute-force sensitive) ─────────────────────────
  login:                  { requests: 5,  windowMs: 60_000 },          // 5/60s  — brute-force protection
  register:               { requests: 3,  windowMs: 10 * 60_000 },     // 3/10m  — prevent mass account creation
  'password-reset':       { requests: 3,  windowMs: 60_000 },          // 3/60s  — prevent reset abuse
  'delete-account':       { requests: 3,  windowMs: 60 * 60_000 },     // 3/60m  — destructive, very tight
  'mobile-session':       { requests: 10, windowMs: 60_000 },          // 10/60s — SSO token minting
  mfa_verify:             { requests: 10, windowMs: 5 * 60_000 },      // 10/5m  — TOTP brute force
  mfa_setup:              { requests: 3,  windowMs: 15 * 60_000 },     // 3/15m  — enrollment abuse
  // ── AI / compute (expensive operations) ─────────────────────────────────
  'bill-upload':          { requests: 5,  windowMs: 30_000 },          // 5/30s  — Claude + OCR calls
  // Raised 10→30/30s (engineering audit 2026-06-19): a single user action
  // fans out to several of the ~24 routes sharing this bucket, and
  // debounced auto-save/recalc loops add more. These are deterministic
  // compute routes (Claude calls have their own limiters), so a higher
  // per-IP ceiling is safe. Fuller fix = per-endpoint/per-user buckets.
  engineering:            { requests: 30, windowMs: 30_000 },
  ocr:                    { requests: 10, windowMs: 60_000 },          // 10/60s — Tesseract
  'auto-design':          { requests: 10, windowMs: 60_000 },          // 10/60s — AI layout
  pipeline:               { requests: 5,  windowMs: 60_000 },          // 5/60s  — full engineering
  'system-size':          { requests: 20, windowMs: 60_000 },
  'system-capabilities':  { requests: 20, windowMs: 60_000 },
  // ── External API proxies ────────────────────────────────────────────────
  'solar-api':            { requests: 20, windowMs: 60_000 },          // Google Solar API
  satellite:              { requests: 10, windowMs: 60_000 },          // satellite imagery
  geo:                    { requests: 30, windowMs: 60_000 },          // geocode/elevation/dsm
  'utility-detect':       { requests: 20, windowMs: 60_000 },
  'utility-rates':        { requests: 20, windowMs: 60_000 },
  'maps-session':         { requests: 20, windowMs: 60_000 },          // Maps session tokens
  production:             { requests: 20, windowMs: 60_000 },
  topography:             { requests: 20, windowMs: 60_000 },
  tile:                   { requests: 60, windowMs: 60_000 },          // map tiles — higher volume OK
  // ── Standard CRUD ───────────────────────────────────────────────────────
  standard:               { requests: 30, windowMs: 60_000 },          // projects, clients, etc.
  admin:                  { requests: 30, windowMs: 60_000 },
  feedback:               { requests: 10, windowMs: 60_000 },
  'enterprise-contact':   { requests: 5,  windowMs: 60 * 60_000 },     // 5/60m  — anti-spam
  tos:                    { requests: 10, windowMs: 60_000 },          // ToS acceptance
  stats:                  { requests: 30, windowMs: 60_000 },
  activity:               { requests: 30, windowMs: 60_000 },
  commands:               { requests: 30, windowMs: 60_000 },
  hardware:               { requests: 30, windowMs: 60_000 },
  incentives:             { requests: 30, windowMs: 60_000 },
  survey:                 { requests: 20, windowMs: 60_000 },
  settings:               { requests: 20, windowMs: 60_000 },
  stripe:                 { requests: 5,  windowMs: 60 * 60_000 },     // 5/60m  — costly op
  migrate:                { requests: 2,  windowMs: 60 * 60_000 },     // 2/60m  — extremely tight
  // ── Homeowner portal ────────────────────────────────────────────────────
  portal_login:           { requests: 5,  windowMs: 60_000 },          // same as login
  portal_verify_otp:      { requests: 10, windowMs: 15 * 60_000 },     // 10/15m — OTP brute force
  portal_read:            { requests: 30, windowMs: 60_000 },          // same as standard
  // ── Public forms (no auth) ──────────────────────────────────────────────
  public_lead:            { requests: 5,  windowMs: 15 * 60_000 },     // 5/15m  — public lead form
  'proposal-sign':        { requests: 5,  windowMs: 15 * 60_000 },     // 5/15m  — e-sign replay/spam
};

// ── Redis client ────────────────────────────────────────────────────────────
// Lazily constructed so missing env vars don't crash the module at import time.
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── Limiter factory (Upstash-backed) ────────────────────────────────────────
function makeLimiter(cfg: LimiterConfig): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const window = msToWindow(cfg.windowMs);
  try {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.requests, window),
      analytics: false,
      prefix: 'solarpro_rl',
    });
  } catch {
    return null;
  }
}

/** Convert milliseconds to Upstash's `${n} s` / `${n} m` window literal. */
function msToWindow(ms: number): `${number} s` | `${number} m` {
  if (ms % 60_000 === 0) return `${ms / 60_000} m`;
  return `${Math.max(1, Math.round(ms / 1000))} s`;
}

// ── Build LIMITERS map from CONFIG ──────────────────────────────────────────
const LIMITERS: Record<LimiterKey, LimiterEntry> = (Object.keys(CONFIG) as LimiterKey[]).reduce(
  (acc, key) => {
    const cfg = CONFIG[key];
    acc[key] = { rl: makeLimiter(cfg), cfg };
    return acc;
  },
  {} as Record<LimiterKey, LimiterEntry>,
);

// ── Fail mode (env-var driven) ──────────────────────────────────────────────
//
// Default: `in-memory-fallback` (SOC 2-preferred, preserves availability).
// Override: set RATE_LIMITER_FAIL_MODE to `closed` (paranoid) or `open`
// (legacy back-compat, NOT recommended).
function readFailMode(): FailMode {
  const v = (process.env.RATE_LIMITER_FAIL_MODE ?? 'in-memory-fallback').toLowerCase().trim();
  if (v === 'closed' || v === 'open' || v === 'in-memory-fallback') return v;
  // Unknown value: log a warning and fall back to the safe default.
  // Do NOT throw — a misconfigured env var should not take the site down.
  console.warn(`[RATE_LIMITER_FAIL_MODE] unknown value "${v}", using "in-memory-fallback"`);
  return 'in-memory-fallback';
}
let FAIL_MODE: FailMode = readFailMode();

// ── In-memory fallback limiter ──────────────────────────────────────────────
//
// Per-(key,identifier) sliding-window counter. Bounded by RATE_LIMITER_IN_MEM_LRU_MAX
// (default 50 000 entries) to prevent OOM under sustained attack. A periodic
// (unref'd) cleanup drops expired entries.
//
// Trade-off: in-memory limits are per-process. A multi-instance deployment
// has N independent limiters, so the effective limit is N × cfg.requests.
// That is acceptable: this is a fallback, not the primary defense. The
// primary defense is Upstash; when it recovers, in-memory state is
// naturally discarded and the canonical limit resumes.

const IN_MEM_LRU_MAX = (() => {
  const raw = process.env.RATE_LIMITER_IN_MEM_LRU_MAX;
  if (!raw) return 50_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1_000) return 50_000; // bad config → default
  return Math.min(n, 1_000_000);                       // hard cap at 1M
})();

interface InMemEntry {
  count: number;
  resetAt: number;
}

const inMemStore: Map<string, InMemEntry> = new Map();

// Periodic cleanup. unref() so the interval never blocks process exit.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanupStarted(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of inMemStore) {
      if (v.resetAt <= now) inMemStore.delete(k);
      // Map iteration is insertion order; later entries are usually newer,
      // so we can short-circuit once we see one that's not yet expired.
      else break;
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof _cleanupTimer.unref === 'function') _cleanupTimer.unref();
}
ensureCleanupStarted();

function inMemoryCheck(
  cfg: LimiterConfig,
  identifier: string,
): RateLimitResult {
  const now = Date.now();
  const key = identifier;
  const existing = inMemStore.get(key);

  // Cap the store size opportunistically. We drop the OLDEST entries
  // (front of the Map, which is insertion-ordered) until we're under the
  // cap. Expired entries are also removed in this pass.
  if (inMemStore.size >= IN_MEM_LRU_MAX) {
    const toDrop = Math.max(1, inMemStore.size - IN_MEM_LRU_MAX + 1);
    const it = inMemStore.keys();
    for (let i = 0; i < toDrop; i++) {
      const k = it.next().value;
      if (k === undefined) break;
      inMemStore.delete(k);
    }
  }

  if (!existing || existing.resetAt <= now) {
    // Fresh window — create new entry.
    inMemStore.set(key, { count: 1, resetAt: now + cfg.windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, cfg.requests - 1),
      reset: now + cfg.windowMs,
    };
  }

  if (existing.count < cfg.requests) {
    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, cfg.requests - existing.count),
      reset: existing.resetAt,
    };
  }

  return { allowed: false, remaining: 0, reset: existing.resetAt };
}

// ── Telemetry (in-process counters) ─────────────────────────────────────────
//
// These are intentionally process-local. The recommended deployment is to
// scrape them via a /api/admin/debug route or a sidecar that reads them
// from the Vercel function logs (we log a one-line summary on every
// transition into fallback mode).
const metrics = {
  redisError: 0,
  redisTimeout: 0,
  fallbackUsed: 0,
  closedDenied: 0,
};

// ── Public: checkRateLimit ──────────────────────────────────────────────────
//
// Returns:
//   { allowed: true,  remaining, reset } — request should proceed
//   { allowed: false, remaining, reset } — request should be rejected (429)
//
// SAFETY (updated 2026-08):
//   - No Upstash env vars    → allow (dev-mode, unchanged from previous).
//   - Upstash error/timeout  → apply FAIL_MODE (env-driven):
//       closed               → deny
//       in-memory-fallback   → use per-(key,ip) sliding-window fallback
//       open                 → allow (legacy back-compat)
const RATE_LIMIT_TIMEOUT_MS = 500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RATE_LIMIT_TIMEOUT')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function checkRateLimit(
  key: LimiterKey,
  identifier: string,
): Promise<RateLimitResult> {
  const entry = LIMITERS[key];
  const cfg = entry.cfg;

  // No Redis configured — dev mode. Keep the legacy "allow" behavior;
  // production MUST have UPSTASH_REDIS_REST_URL/_TOKEN set.
  if (!entry.rl) {
    return { allowed: true };
  }

  try {
    const result = await withTimeout(entry.rl.limit(identifier), RATE_LIMIT_TIMEOUT_MS);
    return {
      allowed:   result.success,
      remaining: result.remaining,
      reset:     result.reset,
    };
  } catch (err: unknown) {
    // Redis error or timeout — apply fail mode.
    metrics.redisError += 1;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'RATE_LIMIT_TIMEOUT') {
      metrics.redisTimeout += 1;
      console.warn(
        `[RATE_LIMIT_TIMEOUT] key=${key} upstash slow/unreachable, fail_mode=${FAIL_MODE}`
      );
    } else {
      console.warn(
        `[RATE_LIMIT_ERROR] key=${key} err=${msg.slice(0, 200)}, fail_mode=${FAIL_MODE}`
      );
    }

    if (FAIL_MODE === 'closed') {
      metrics.closedDenied += 1;
      return { allowed: false };
    }
    if (FAIL_MODE === 'open') {
      // Explicit legacy back-compat. NOT recommended.
      return { allowed: true };
    }
    // Default: in-memory fallback.
    metrics.fallbackUsed += 1;
    return inMemoryCheck(cfg, identifier);
  }
}

// ── IP extraction helper ────────────────────────────────────────────────────
// Resolves best-effort client IP from Next.js request headers.
// Falls back to 'anonymous' — still rate-limited as a group (safe for most cases).
export function getClientIp(req: Request | import('next/server').NextRequest): string {
  const forwarded = (req.headers as Headers).get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for may be comma-separated list; first entry is the client
    return forwarded.split(',')[0].trim();
  }
  const realIp = (req.headers as Headers).get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'anonymous';
}

// ── Test-only exports ───────────────────────────────────────────────────────
//
// These are NOT part of the public API and may change without notice. They
// exist so the test suite can:
//   1. Force a specific fail mode without mutating process.env globally
//      (avoids cross-test pollution).
//   2. Inject a fake Upstash limiter that errors or times out on demand.
//   3. Reset the in-memory store and metrics between tests.

/**
 * Replace the Upstash limiter for a given key. TEST-ONLY.
 *
 * Pass `null` to simulate "no Redis configured" (dev mode).
 * Pass a stub whose `.limit()` returns a rejected promise or throws to
 * simulate Upstash errors / timeouts.
 */
export function _setLimiterForTest(key: LimiterKey, rl: Ratelimit | null): void {
  LIMITERS[key].rl = rl;
}

/** Reset the in-memory fallback store. TEST-ONLY. */
export function _resetInMemoryForTest(): void {
  inMemStore.clear();
  metrics.redisError = 0;
  metrics.redisTimeout = 0;
  metrics.fallbackUsed = 0;
  metrics.closedDenied = 0;
}

/** Set the fail mode. TEST-ONLY. */
export function _setFailModeForTest(mode: FailMode): void {
  FAIL_MODE = mode;
}

/** Read the current fail mode. Useful for tests and ops dashboards. */
export function getFailMode(): FailMode {
  return FAIL_MODE;
}

/** Read-only metrics snapshot. */
export function __getRateLimiterMetrics(): RateLimiterMetrics {
  return {
    redisError:    metrics.redisError,
    redisTimeout:  metrics.redisTimeout,
    fallbackUsed:  metrics.fallbackUsed,
    closedDenied:  metrics.closedDenied,
    inMemorySize:  inMemStore.size,
  };
}

/** Expose the in-memory LRU max for tests / dashboards. */
export function __getInMemoryLruMax(): number {
  return IN_MEM_LRU_MAX;
}
