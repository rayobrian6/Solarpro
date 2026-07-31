/**
 * Tests for GET /api/proposals/[id]/signature
 *
 * Strategy:
 *  - Mock getDbReady to control DB behaviour
 *  - Verify status codes, JSON bodies
 *
 * Coverage:
 *  - DB connection failure → 503
 *  - Proposal not found → 404
 *  - Unsigned proposal → { signed: false }
 *  - Signed by signed_at → { signed: true, signerName, signedAt }
 *  - Signed by status=accepted (no signed_at) → { signed: true }
 *  - Privacy: IP and raw signature image never returned
 *  - DB query failure → 500
 *  - Response Content-Type is application/json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
}));

import { getDbReady } from '@/lib/db-neon';
import { GET }        from '@/app/api/proposals/[id]/signature/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

type SqlFn = Awaited<ReturnType<typeof getDbReady>>;

function makeSqlMock(impl?: () => unknown): SqlFn {
  const fn = vi.fn(impl ?? (() => Promise.resolve([])));
  const tag = Object.assign(
    function tagFn(..._args: unknown[]) { return fn(); },
    fn,
  );
  return tag as unknown as SqlFn;
}

function makeRequest(): Request {
  return new Request('http://localhost/api/proposals/prop-abc/signature', {
    method: 'GET',
  });
}

const routeParams = { params: Promise.resolve({ id: 'prop-abc' }) };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/proposals/[id]/signature', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Database unavailable ──────────────────────────────────────────────────

  describe('database unavailable', () => {
    it('returns 503 when DB connection fails', async () => {
      vi.mocked(getDbReady).mockRejectedValue(new Error('DB connection timeout'));

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.error).toMatch(/database unavailable/i);
    });
  });

  // ── Proposal not found ────────────────────────────────────────────────────

  describe('proposal not found', () => {
    it('returns 404 when proposal does not exist', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ── Unsigned proposal ─────────────────────────────────────────────────────

  describe('unsigned proposal', () => {
    it('returns { signed: false } when proposal has no signed_at', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{
          id:          'prop-abc',
          status:      'sent',
          signed_at:   null,
          signer_name: null,
        }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.signed).toBe(false);
      // No extra fields on unsigned response
      expect(body.signerName).toBeUndefined();
      expect(body.signedAt).toBeUndefined();
    });

    it('returns { signed: false } for "sent" status with no signed_at', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{ id: 'prop-abc', status: 'sent', signed_at: null, signer_name: null }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      const body = await res.json();
      expect(body.signed).toBe(false);
    });
  });

  // ── Signed proposal ───────────────────────────────────────────────────────

  describe('signed proposal', () => {
    it('returns signed: true with signerName and signedAt when signed_at is set', async () => {
      const signedAt = '2024-06-15T14:30:00.000Z';
      const sqlMock  = makeSqlMock(() =>
        Promise.resolve([{
          id:          'prop-abc',
          status:      'accepted',
          signed_at:   signedAt,
          signer_name: 'Jane Homeowner',
        }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.signed).toBe(true);
      expect(body.signerName).toBe('Jane Homeowner');
      expect(body.signedAt).toBe(signedAt);
    });

    it('returns signed: true when status is "accepted" even without signed_at', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{
          id:          'prop-abc',
          status:      'accepted',
          signed_at:   null,
          signer_name: 'Bob Builder',
        }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.signed).toBe(true);
    });

    it('returns signerName as null when signer_name column is null', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{
          id:          'prop-abc',
          status:      'accepted',
          signed_at:   '2024-06-01T00:00:00Z',
          signer_name: null,
        }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      const body = await res.json();
      expect(body.signed).toBe(true);
      expect(body.signerName).toBeNull();
    });
  });

  // ── Privacy ───────────────────────────────────────────────────────────────

  describe('privacy', () => {
    it('never returns ip_address or signature image data in the response', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{
          id:          'prop-abc',
          status:      'accepted',
          signed_at:   '2024-06-15T14:30:00Z',
          signer_name: 'Privacy Test',
          // These columns would only exist if route accidentally queried them
          signer_ip:   '192.168.1.1',
          data_json:   { signature: { imageData: 'data:image/png;base64,abc' } },
        }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res  = await GET(makeRequest() as never, routeParams);
      const body = await res.json();

      // The response should NOT contain these privacy-sensitive fields
      expect(body.signer_ip).toBeUndefined();
      expect(body.ip_address).toBeUndefined();
      expect(body.data_json).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('imageData');
    });
  });

  // ── Internal error ────────────────────────────────────────────────────────

  describe('internal error', () => {
    it('returns 500 when DB query throws', async () => {
      const sqlMock = makeSqlMock(() => Promise.reject(new Error('query failed')));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.status).toBe(500);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe('response shape', () => {
    it('Content-Type is application/json', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{ id: 'prop-abc', status: 'sent', signed_at: null, signer_name: null }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await GET(makeRequest() as never, routeParams);
      expect(res.headers.get('content-type')).toMatch(/application\/json/i);
    });

    it('calls getDbReady exactly once', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([{ id: 'prop-abc', status: 'sent', signed_at: null, signer_name: null }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      await GET(makeRequest() as never, routeParams);
      expect(getDbReady).toHaveBeenCalledTimes(1);
    });
  });
});
