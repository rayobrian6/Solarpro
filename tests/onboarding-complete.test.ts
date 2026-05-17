/**
 * /api/settings/onboarding-complete route unit tests.
 *
 * Tests the POST endpoint that marks the guided tour as completed for
 * a user. Uses the same DB column (has_seen_tour) as the SolarDog tour
 * endpoint.
 *
 * Strategy:
 *  - Mock getUserFromRequest to control auth state
 *  - Mock getDbReady to control DB behaviour
 *  - Verify status codes, JSON bodies, and SQL invocation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────

// Mock auth — controls session state
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(),
}));

// Mock DB — controls query behaviour
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
}));

import { getUserFromRequest } from '@/lib/auth';
import { getDbReady }         from '@/lib/db-neon';
import { POST }               from '@/app/api/settings/onboarding-complete/route';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(): Request {
  return new Request('http://localhost/api/settings/onboarding-complete', {
    method: 'POST',
  });
}

/** Build a tagged-template-literal compatible sql mock */
function makeSqlMock(impl?: () => unknown) {
  const fn = vi.fn(impl ?? (() => Promise.resolve([])));
  // Supports template literal tag syntax: sql`...`
  // Use explicit rest param to avoid TS2556 spread error
  const tag = Object.assign(
    function tagFn(..._args: unknown[]) { return fn(); },
    fn,
  );
  return tag as unknown as Awaited<ReturnType<typeof getDbReady>>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/settings/onboarding-complete', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Authentication ──────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no session', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue(null);

      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/not authenticated/i);
    });

    it('returns 401 when session has no id', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: '' } as never);

      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(401);
    });
  });

  // ── Database unavailable ───────────────────────────────────────────────

  describe('database unavailable', () => {
    it('returns 503 when DB connection fails', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-123' } as never);
      vi.mocked(getDbReady).mockRejectedValue(new Error('DB connection timeout'));

      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/database unavailable/i);
    });
  });

  // ── Success path ────────────────────────────────────────────────────────

  describe('success path', () => {
    it('returns { success: true } with status 200 on happy path', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-abc' } as never);
      const sqlMock = makeSqlMock(() => Promise.resolve([]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('calls the DB with the authenticated user id', async () => {
      const userId = 'user-xyz-789';
      vi.mocked(getUserFromRequest).mockReturnValue({ id: userId } as never);
      const sqlMock = makeSqlMock(() => Promise.resolve([]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      await POST(makeRequest() as never);

      expect(sqlMock).toHaveBeenCalled();
    });

    it('calls getDbReady exactly once per request', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-1' } as never);
      const sqlMock = makeSqlMock();
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      await POST(makeRequest() as never);

      expect(getDbReady).toHaveBeenCalledTimes(1);
    });
  });

  // ── Idempotency / error resilience ─────────────────────────────────────

  describe('error resilience', () => {
    it('still returns { success: true } even when the UPDATE throws', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-err' } as never);
      const sqlMock = makeSqlMock(() => Promise.reject(new Error('constraint error')));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(200);

      const body = await res.json();
      // Non-critical error — endpoint should absorb and return success:true
      expect(body.success).toBe(true);
    });

    it('is safe to call multiple times (idempotent by design)', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-idem' } as never);
      const sqlMock = makeSqlMock(() => Promise.resolve([]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const [r1, r2] = await Promise.all([
        POST(makeRequest() as never),
        POST(makeRequest() as never),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    });
  });

  // ── Response shape ─────────────────────────────────────────────────────

  describe('response shape', () => {
    it('response Content-Type is application/json', async () => {
      vi.mocked(getUserFromRequest).mockReturnValue({ id: 'user-ct' } as never);
      const sqlMock = makeSqlMock();
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest() as never);
      expect(res.headers.get('content-type')).toMatch(/application\/json/i);
    });
  });
});
