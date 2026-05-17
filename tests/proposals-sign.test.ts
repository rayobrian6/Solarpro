/**
 * Tests for POST /api/proposals/[id]/sign
 *
 * Strategy:
 *  - Mock getDbReady to control DB behaviour
 *  - Mock sendProposalSignedEmail to prevent real email calls
 *  - Verify status codes, JSON bodies, and SQL invocation order
 *  - The route is public (no auth required); access is gated by share_token
 *
 * Coverage:
 *  - Missing body → 400
 *  - Name too short → 400
 *  - Name too long → 400
 *  - agreedToTerms missing/false → 400
 *  - Invalid signature data URL → 400
 *  - Token mismatch → 403
 *  - Not found → 404
 *  - Already signed (signed_at) → 409
 *  - Already signed (status=accepted) → 409
 *  - DB connection failure → 503
 *  - DB write failure + fallback success → 200
 *  - DB write failure + fallback also fails → 500
 *  - Success path → 200 with signerName + signedAt
 *  - No share_token → no token check
 *  - Installer email errors are swallowed (non-blocking)
 *  - Signature insertion failure is swallowed (non-blocking)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendProposalSignedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getDbReady }               from '@/lib/db-neon';
import { sendProposalSignedEmail }  from '@/lib/email';
import { POST }                     from '@/app/api/proposals/[id]/sign/route';

// ── Helpers ─────────────────────────────────────────────────────────────────

type SqlFn = Awaited<ReturnType<typeof getDbReady>>;

/**
 * Build a tagged-template-literal compatible sql mock.
 * Each call to the tag fn is recorded on the underlying vi.fn() spy.
 * You can pass multiple `impl` functions to mock sequential calls.
 */
function makeSqlMock(...impls: Array<() => unknown>): SqlFn & ReturnType<typeof vi.fn> {
  let callIdx = 0;
  const fn = vi.fn(() => {
    const impl = impls[callIdx] ?? (() => Promise.resolve([]));
    callIdx++;
    return impl();
  });
  const tag = Object.assign(
    function tagFn(..._args: unknown[]) { return fn(); },
    fn,
  );
  return tag as unknown as SqlFn & ReturnType<typeof vi.fn>;
}

/** Minimal valid proposal row returned by the first SELECT */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id:          'prop-123',
    status:      'sent',
    project_id:  'proj-456',
    data_json:   { title: 'Test Solar Proposal', clientName: 'Jane Doe' },
    signed_at:   null,
    share_token: null,
    ...overrides,
  };
}

/** Build a NextRequest with optional body */
function makeRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/proposals/prop-123/sign', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Minimal valid sign body */
const validBody = {
  signerName:    'Alice Smith',
  agreedToTerms: true,
};

/** Route param object */
const routeParams = { params: { id: 'prop-123' } };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/proposals/[id]/sign', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Request body validation ──────────────────────────────────────────────

  describe('request body validation', () => {
    it('returns 400 when body is missing / not JSON', async () => {
      const req = new Request('http://localhost/api/proposals/prop-123/sign', {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    'not json',
      });
      const res = await POST(req as never, routeParams);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns 400 when signerName is empty', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ signerName: '', agreedToTerms: true }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/full name is required/i);
    });

    it('returns 400 when signerName is a single character (< 2 chars)', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ signerName: 'A', agreedToTerms: true }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when signerName exceeds 200 characters', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const longName = 'A'.repeat(201);
      const res = await POST(
        makeRequest({ signerName: longName, agreedToTerms: true }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/name too long/i);
    });

    it('returns 400 when agreedToTerms is false', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ signerName: 'Alice Smith', agreedToTerms: false }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/must agree to the terms/i);
    });

    it('returns 400 when agreedToTerms is missing', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ signerName: 'Alice Smith' }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when signature is not a data URL', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ ...validBody, signature: 'not-a-data-url' }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid signature data/i);
    });

    it('returns 400 when signature data URL exceeds 512 KB', async () => {
      const sqlMock = makeSqlMock(() => Promise.resolve([makeProposal()]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      // 512KB + 1 byte beyond limit
      const oversized = 'data:image/png;base64,' + 'A'.repeat(512 * 1024 + 1);
      const res = await POST(
        makeRequest({ ...validBody, signature: oversized }) as never,
        routeParams,
      );
      expect(res.status).toBe(400);
    });
  });

  // ── Database unavailable ─────────────────────────────────────────────────

  describe('database unavailable', () => {
    it('returns 503 when DB connection fails', async () => {
      vi.mocked(getDbReady).mockRejectedValue(new Error('Connection timeout'));

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/database unavailable/i);
    });
  });

  // ── Proposal not found ───────────────────────────────────────────────────

  describe('proposal not found', () => {
    it('returns 404 when proposal does not exist', async () => {
      // First SELECT returns empty array
      const sqlMock = makeSqlMock(() => Promise.resolve([]));
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ── Token validation ─────────────────────────────────────────────────────

  describe('token validation', () => {
    it('returns 403 when proposal has a share_token and token is missing', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([makeProposal({ share_token: 'secret-token-abc' })]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error).toMatch(/invalid access token/i);
    });

    it('returns 403 when provided token does not match share_token', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([makeProposal({ share_token: 'correct-token' })]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ ...validBody, token: 'wrong-token' }) as never,
        routeParams,
      );
      expect(res.status).toBe(403);
    });

    it('succeeds when token matches share_token', async () => {
      // SELECT → [proposal], UPDATE proposals, INSERT signatures, UPDATE homeowner_stage,
      // UPDATE stage, SELECT installer → resolve each call
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal({ share_token: 'correct-token' })]),
        () => Promise.resolve([]),  // UPDATE proposals
        () => Promise.resolve([]),  // INSERT signatures
        () => Promise.resolve([]),  // UPDATE homeowner_stage
        () => Promise.resolve([]),  // UPDATE stage
        () => Promise.resolve([]),  // SELECT installer
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(
        makeRequest({ ...validBody, token: 'correct-token' }) as never,
        routeParams,
      );
      expect(res.status).toBe(200);
    });

    it('skips token check when proposal has no share_token', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal({ share_token: null })]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      // No token provided, proposal has no share_token → should succeed
      expect(res.status).toBe(200);
    });
  });

  // ── Already signed (idempotency / 409) ──────────────────────────────────

  describe('already signed', () => {
    it('returns 409 when proposal already has signed_at', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([makeProposal({ signed_at: '2024-01-01T10:00:00Z' })]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(409);

      const body = await res.json();
      expect(body.error).toMatch(/already been signed/i);
    });

    it('returns 409 when proposal.status is already "accepted"', async () => {
      const sqlMock = makeSqlMock(() =>
        Promise.resolve([makeProposal({ status: 'accepted', signed_at: null })]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(409);
    });
  });

  // ── Success path ─────────────────────────────────────────────────────────

  describe('success path', () => {
    it('returns 200 with signerName and signedAt on happy path', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),  // SELECT proposal
        () => Promise.resolve([]),                 // UPDATE proposals
        () => Promise.resolve([]),                 // INSERT signatures
        () => Promise.resolve([]),                 // UPDATE homeowner_stage
        () => Promise.resolve([]),                 // UPDATE stage
        () => Promise.resolve([]),                 // SELECT installer
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.signerName).toBe('Alice Smith');
      expect(typeof body.signedAt).toBe('string');
      // signedAt should be a valid ISO date
      expect(() => new Date(body.signedAt)).not.toThrow();
    });

    it('calls getDbReady exactly once per request', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      await POST(makeRequest(validBody) as never, routeParams);
      expect(getDbReady).toHaveBeenCalledTimes(1);
    });

    it('response Content-Type is application/json', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.headers.get('content-type')).toMatch(/application\/json/i);
    });

    it('accepts a valid draw signature data URL', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const smallDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const res = await POST(
        makeRequest({ ...validBody, signature: smallDataUrl }) as never,
        routeParams,
      );
      expect(res.status).toBe(200);
    });
  });

  // ── DB write failure & fallback ──────────────────────────────────────────

  describe('db write failure', () => {
    it('falls back to minimal UPDATE when signer_* columns are missing', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),          // SELECT proposal
        () => Promise.reject(new Error('column "signer_name" does not exist')), // first UPDATE fails
        () => Promise.resolve([]),                         // fallback UPDATE succeeds
        () => Promise.reject(new Error('table not found')), // INSERT signatures fails (swallowed)
        () => Promise.resolve([]),                         // UPDATE homeowner_stage
        () => Promise.resolve([]),                         // UPDATE stage
        () => Promise.resolve([]),                         // SELECT installer
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      // Fallback succeeded → still 200
      expect(res.status).toBe(200);
    });

    it('returns 500 when both primary and fallback UPDATE fail', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.reject(new Error('primary update failed')),
        () => Promise.reject(new Error('fallback update failed')),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/failed to record signature/i);
    });
  });

  // ── Non-blocking side effects ────────────────────────────────────────────

  describe('non-blocking side effects', () => {
    it('swallows proposal_signatures INSERT failure (table may not exist yet)', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),                           // UPDATE proposals
        () => Promise.reject(new Error('relation "proposal_signatures" does not exist')), // swallowed
        () => Promise.resolve([]),                           // UPDATE homeowner_stage
        () => Promise.resolve([]),                           // UPDATE stage
        () => Promise.resolve([]),                           // SELECT installer
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      // Still succeeds despite signatures table not existing
      expect(res.status).toBe(200);
    });

    it('swallows stage advancement failure (best-effort)', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),                      // UPDATE proposals
        () => Promise.resolve([]),                      // INSERT signatures
        () => Promise.reject(new Error('stage update failed')), // swallowed
        () => Promise.resolve([]),                      // SELECT installer (after stage error)
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);

      const res = await POST(makeRequest(validBody) as never, routeParams);
      expect(res.status).toBe(200);
    });

    it('swallows installer email errors (fire-and-forget)', async () => {
      const sqlMock = makeSqlMock(
        () => Promise.resolve([makeProposal()]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        () => Promise.resolve([]),
        // Installer row exists but email throws
        () => Promise.resolve([{ email: 'installer@example.com', installer_name: 'Bob' }]),
      );
      vi.mocked(getDbReady).mockResolvedValue(sqlMock);
      vi.mocked(sendProposalSignedEmail).mockRejectedValue(new Error('SMTP error'));

      const res = await POST(makeRequest(validBody) as never, routeParams);
      // Must still succeed despite email error
      expect(res.status).toBe(200);
    });
  });
});
