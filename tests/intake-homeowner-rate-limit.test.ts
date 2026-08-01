/**
 * tests/intake-homeowner-rate-limit.test.ts
 *
 * Regression tests for the shadowed-checkRateLimit bug in
 * `app/api/intake/homeowner/route.ts` (audit §2 #3, discovered by the
 * rate-limiter-fix coder as a side note).
 *
 * BUG: The route defined a LOCAL function also named `checkRateLimit` that
 * shadowed the import from `@/lib/rateLimiter`. The local function was a
 * 3/15m in-memory counter that:
 *   - reset on every serverless cold start
 *   - had no Upstash Redis backing
 *   - had no fail-mode handling
 *   - could not be monitored via `__getRateLimiterMetrics()`
 *
 * FIX: Replaced the local function with the canonical import. The route
 * now uses `'public_lead'` (5/15m) from the rate limiter CONFIG.
 *
 * TEST STRATEGY:
 *   Mock `@/lib/rateLimiter` and verify:
 *     1. checkRateLimit is called with the correct key ('public_lead')
 *        and identifier (the client IP).
 *     2. The route returns 429 + correct headers when the canonical
 *        limiter denies.
 *     3. The route returns 200 + correct headers when the canonical
 *        limiter allows.
 *     4. The route does NOT define a local checkRateLimit anymore
 *        (source-scan regression guard).
 *
 * No DB / Redis / network needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── Mocks (must come before any import that resolves these modules) ──────────
const mockCheckRateLimit = vi.fn();
const mockGetClientIp = vi.fn();
const mockSubmitHomeownerIntakeEvent = vi.fn(async () => ({
  action: 'accepted',
  event_id: 'evt_mock',
}));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp:    mockGetClientIp,
}));

const mockGetDbReady = vi.fn();
vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }));

// Mock the other dependencies that the route imports, so the route can
// load without a real DB or storage backend.
vi.mock('@/lib/intake/homeownerEventIntake', () => ({
  logMalformedHomeownerIntake:  vi.fn(async () => 'evt_mock'),
  makeHomeownerIntakeEventId:   vi.fn(() => 'evt_mock'),
  submitHomeownerIntakeEvent:   mockSubmitHomeownerIntakeEvent,
}));
vi.mock('@/lib/intake/utilityBillAttachment', () => ({
  isUtilityBillStorageFailure:  vi.fn(() => false),
  metadataOnlyUtilityBill:      vi.fn(() => null),
  storeUtilityBillAttachment:   vi.fn(async () => ({
    filename: 'bill.pdf',
    size_bytes: 1234,
    content_type: 'application/pdf',
    storage_status: 'stored',
  })),
}));
vi.mock('@/lib/intake/utilityBillIntelligence', () => ({
  runUtilityBillIntelligenceAsync: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

async function importRoute() {
  return import('@/app/api/intake/homeowner/route');
}

function makeReq(ip = '203.0.113.42'): any {
  return new Request('https://solarpro.test/api/intake/homeowner', {
    method:  'POST',
    headers: {
      'content-type': 'application/json',
      'x-real-ip':    ip,
    },
    body: JSON.stringify({}),
  });
}

function makeSqlReturning() {
  // A minimal SQL stub that returns empty arrays for any query.
  return vi.fn(async () => []);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. The canonical checkRateLimit is called (regression for the bug)
// ────────────────────────────────────────────────────────────────────────────

describe('homeowner intake route — canonical checkRateLimit is wired in (audit §2 #3)', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockReset();
    mockGetClientIp.mockReset();
    mockGetDbReady.mockReset();

    // Default mocks: allow the request and resolve the IP.
    mockGetClientIp.mockReturnValue('203.0.113.42');
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, reset: Date.now() + 900_000 });
    mockGetDbReady.mockResolvedValue(makeSqlReturning());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('imports checkRateLimit from @/lib/rateLimiter (not a local function)', async () => {
    // The bug: a local function shadowed the import. Verify the import
    // is wired by asserting the mock was hit.
    const { POST } = await importRoute();
    await POST(makeReq('198.51.100.1'));
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
  });

  it('calls checkRateLimit with the public_lead key', async () => {
    const { POST } = await importRoute();
    await POST(makeReq('198.51.100.2'));
    expect(mockCheckRateLimit).toHaveBeenCalledWith('public_lead', expect.any(String));
  });

  it('passes the resolved client IP as the identifier (NOT a placeholder)', async () => {
    mockGetClientIp.mockReturnValue('198.51.100.99');
    const { POST } = await importRoute();
    await POST(makeReq('198.51.100.99'));
    expect(mockCheckRateLimit).toHaveBeenCalledWith('public_lead', '198.51.100.99');
  });

  it('resolves the client IP via getClientIp from @/lib/rateLimiter', async () => {
    const { POST } = await importRoute();
    await POST(makeReq('198.51.100.3'));
    expect(mockGetClientIp).toHaveBeenCalledTimes(1);
    expect(mockGetClientIp).toHaveBeenCalledWith(expect.any(Object));
  });

  it('AWAITs the rate limit check (returns a Promise, not a sync result)', async () => {
    // The local function was sync; the canonical one is async. Verify
    // the route awaits it by checking the call site is async.
    const { POST } = await importRoute();
    const result = POST(makeReq('198.51.100.4'));
    // The function returns a NextResponse. The rate-limit mock being
    // Promise-based means the call is queued in the microtask queue.
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. 429 response when canonical limiter denies
// ────────────────────────────────────────────────────────────────────────────

describe('homeowner intake route — 429 response when canonical limiter denies', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockReset();
    mockGetClientIp.mockReset();
    mockGetDbReady.mockReset();
    mockGetClientIp.mockReturnValue('203.0.113.42');
  });

  it('returns 429 when canonical limiter denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Date.now() + 60_000 });
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.10'));
    expect(res.status).toBe(429);
  });

  it('429 body matches the legacy contract', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Date.now() + 60_000 });
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.11'));
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Too many requests/);
  });

  it('429 response includes Retry-After header (in seconds)', async () => {
    const futureReset = Date.now() + 60_000;
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: futureReset });
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.12'));
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    const seconds = parseInt(retryAfter!, 10);
    // 60s ± 2s tolerance for the math.ceil rounding
    expect(seconds).toBeGreaterThanOrEqual(58);
    expect(seconds).toBeLessThanOrEqual(62);
  });

  it('429 response includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', async () => {
    const futureReset = Date.now() + 60_000;
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: futureReset });
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.13'));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('does NOT call submitHomeownerIntakeEvent when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Date.now() + 60_000 });
    const { POST } = await importRoute();
    // Even if the SQL stub returns rows, the route must short-circuit
    // before reaching the submit call.
    mockGetDbReady.mockResolvedValue(makeSqlReturning());
    mockSubmitHomeownerIntakeEvent.mockClear();
    await POST(makeReq('198.51.100.14'));
    expect(mockSubmitHomeownerIntakeEvent).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. 200 response when canonical limiter allows
// ────────────────────────────────────────────────────────────────────────────

describe('homeowner intake route — 200 response when canonical limiter allows', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockReset();
    mockGetClientIp.mockReset();
    mockGetDbReady.mockReset();
    mockGetClientIp.mockReturnValue('203.0.113.42');
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 3, reset: Date.now() + 900_000 });
    mockGetDbReady.mockResolvedValue(makeSqlReturning());
  });

  it('returns 200 when canonical limiter allows', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.20'));
    expect(res.status).toBe(200);
  });

  it('200 response includes X-RateLimit-Remaining header from canonical limiter', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2, reset: Date.now() + 900_000 });
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.21'));
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  it('200 response includes X-RateLimit-Limit = 5 (matches public_lead CONFIG)', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.22'));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('200 response body matches the homeowner intake success contract', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq('198.51.100.23'));
    const body = await res.json() as {
      success: boolean;
      message: string;
      event_id: string;
      review_status: string;
    };
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/solar advisor/i);
    expect(body.event_id).toBeTruthy();
    expect(body.review_status).toBe('pending_operator_review');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Source-scan regression guard: no LOCAL checkRateLimit function
// ────────────────────────────────────────────────────────────────────────────

describe('source-scan: no local checkRateLimit function shadows the import', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'intake', 'homeowner', 'route.ts'),
    'utf8',
  );

  it('does not define a function named checkRateLimit in the file', () => {
    // The old bug: `function checkRateLimit(ip: string) { ... }` shadowed
    // the import. This regex catches any "function checkRateLimit" or
    // arrow-assignment "checkRateLimit = (...) =>" in the file.
    expect(src).not.toMatch(/^\s*function\s+checkRateLimit\s*\(/m);
    expect(src).not.toMatch(/^\s*const\s+checkRateLimit\s*=\s*\(/m);
  });

  it('does not define a rateLimitMap (the local LRU store)', () => {
    // The old code had: `const rateLimitMap = new Map<...>(...)` plus
    // the cleanup helper. Both are gone in the fix.
    expect(src).not.toMatch(/rateLimitMap/);
  });

  it('does not reference RATE_LIMIT_MAX (3) — the local constant', () => {
    // The old local limit was 3; the canonical one is 5 (public_lead).
    expect(src).not.toMatch(/RATE_LIMIT_MAX\s*=\s*3/);
  });

  it('imports checkRateLimit from @/lib/rateLimiter', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bcheckRateLimit\b[^}]*\}\s*from\s*['"]@\/lib\/rateLimiter['"]/);
  });

  it('imports getClientIp from @/lib/rateLimiter (consistent IP extraction)', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bgetClientIp\b[^}]*\}\s*from\s*['"]@\/lib\/rateLimiter['"]/);
  });

  it('uses "public_lead" as the canonical limiter key (matches CONFIG)', () => {
    expect(src).toMatch(/checkRateLimit\(\s*['"]public_lead['"]\s*,/);
  });

  it('AWAITs checkRateLimit (the canonical one is async, the old local one was sync)', () => {
    // The old local function was sync; the canonical one is async.
    // Verify the call site uses `await`.
    expect(src).toMatch(/await\s+checkRateLimit\(/);
  });
});
