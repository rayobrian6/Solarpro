/**
 * tests/proposalSignatureIsTheOnlyWayToSign.test.ts
 *
 * A PROPOSAL BECOMES SIGNED ONLY THROUGH THE E-SIGNATURE WORKFLOW.
 *
 * POST /api/proposals/[id]/sign is the one writer that verifies the share
 * token, records the signer, writes proposal_signatures and advances the
 * pipeline. Every other writer used to be able to produce the signed state
 * without any of that:
 *
 *   · anyone holding the share link:  PATCH ?token= { status: 'accepted' }
 *     → status 'accepted', no signer, no signature row — and the real /sign
 *     then answered 409 "already signed", so the homeowner could not sign.
 *   · anyone holding the share link:  PATCH ?token= { signature, signerName }
 *     → a second, unaudited signing path (no proposal_signatures row, no
 *     pipeline stage change, no expiry check).
 *   · the installer:  PATCH / PUT { status: 'accepted' | 'signed' } or
 *     { signature: {...} } → a contract "signed" by the seller.
 *   · the installer:  bulk { action: 'status', status: 'accepted' }.
 *   · /sign itself ignored share_expires_at and wrote without a
 *     `signed_at IS NULL` guard, so two concurrent signers both "won".
 *
 * Tenant boundary cases ride along: another installer's session never
 * reaches a proposal it does not own, by any of these paths.
 *
 * Same mocked-sql strategy as tests/proposalIssuedArtifactImmutability.test.ts
 * (proposals has no CREATE TABLE in the repo, so PGlite would only test a
 * hand-made fixture). Values are captured too, so a write is judged by what it
 * would store, not only by its SQL text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-neon', () => ({
  getDbReady:  vi.fn(),
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn((_tag: string, err: unknown) =>
    new Response(
      JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )),
  rowToProject: (r: Record<string, unknown>) => r,
}));

vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn(() => null) }));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/email', () => ({
  sendProposalViewedEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalSignedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/operations/stageChange', () => ({
  applyStageChange: vi.fn(async () => ({ ok: true })),
}));

import { NextRequest }        from 'next/server';
import { getDbReady }         from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { PATCH, PUT }         from '@/app/api/proposals/[id]/route';
import { POST as BULK }       from '@/app/api/proposals/bulk/route';
import { POST as SIGN }       from '@/app/api/proposals/[id]/sign/route';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROPOSAL_ID = '11111111-2222-4333-8444-555555555555';
const PROJECT_ID  = '99999999-8888-4777-8666-555555555555';
const TOKEN       = 'a1b2c3d4e5f60718';
const OWNER       = { id: 'user-owner-1', email: 'owner@a.test' };
const OTHER       = { id: 'user-other-2', email: 'other@b.test' };

interface Stmt { q: string; values: unknown[]; result: unknown[] }

function makeSql(handler: (q: string, values: unknown[]) => unknown) {
  const stmts: Stmt[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    try {
      const result = (handler(q, values) ?? []) as unknown[];
      stmts.push({ q, values, result });
      return Promise.resolve(result);
    } catch (e) {
      stmts.push({ q, values, result: [] });
      return Promise.reject(e);
    }
  };
  return Object.assign(tag, { stmts });
}

function unsignedRow(overrides: Record<string, unknown> = {}) {
  return {
    id:               PROPOSAL_ID,
    project_id:       PROJECT_ID,
    user_id:          OWNER.id,
    name:             'Solar Proposal',
    status:           'sent',
    signed_at:        null,
    share_token:      TOKEN,
    share_expires_at: null,
    data_json:        { clientName: 'Jane Homeowner' },
    ...overrides,
  };
}

/**
 * One proposal owned by OWNER. Ownership probes succeed only for OWNER's id.
 * UPDATEs report the row as affected unless `updateAffects` says otherwise
 * (a concurrent signer having got there first).
 */
function wire(row: Record<string, unknown>, opts: { updateAffects?: boolean } = {}) {
  const updateAffects = opts.updateAffects !== false;
  const sql = makeSql((q, values) => {
    if (/^UPDATE proposals/i.test(q)) {
      // A write scoped to a user_id only reaches this row for its owner — the
      // same thing Postgres would do with `WHERE ... AND user_id = $n`.
      if (/user_id = \?/i.test(q) && !values.includes(OWNER.id)) return [];
      return updateAffects ? [{ id: PROPOSAL_ID }] : [];
    }
    if (/^UPDATE|^INSERT|^DELETE/i.test(q)) return [];
    const ownerProbe =
      /^SELECT id FROM proposals WHERE id = \? AND user_id = \?/i.test(q) ||
      /^SELECT p\.id FROM proposals p JOIN projects/i.test(q) ||
      (/FROM proposals/i.test(q) && /user_id = \?/i.test(q));
    if (ownerProbe) {
      return values.includes(OWNER.id) ? [row] : [];
    }
    if (/FROM proposals/i.test(q)) {
      if (/u\.email/i.test(q)) return [];
      return [row];
    }
    if (/FROM projects/i.test(q)) return [];
    return [];
  });
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

const ctx = { params: Promise.resolve({ id: PROPOSAL_ID }) };

function req(method: 'PATCH' | 'PUT', body: unknown, query = '') {
  return new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }) as never;
}

function bulkReq(body: unknown) {
  return new NextRequest('http://localhost/api/proposals/bulk', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }) as never;
}

function signReq(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}/sign`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }) as never;
}

/** Every proposal write whose stored values would read as signed. */
function signingWrites(sql: { stmts: Stmt[] }) {
  return sql.stmts.filter(({ q, values }) => {
    if (!/^UPDATE proposals/i.test(q)) return false;
    if (/status\s*=\s*'(accepted|signed)'/i.test(q)) return true;
    if (/signed_at\s*=\s*NOW\(\)/i.test(q)) return true;
    return values.some(v =>
      v === 'accepted' || v === 'signed' ||
      (typeof v === 'string' && /"signature"\s*:/.test(v)),
    );
  });
}

function proposalWrites(sql: { stmts: Stmt[] }) {
  return sql.stmts.filter(({ q }) => /^UPDATE proposals/i.test(q));
}

/** Writes that actually changed the stored row (affected ≥ 1 row). */
function effectiveWrites(sql: { stmts: Stmt[] }) {
  return proposalWrites(sql).filter(s => s.result.length > 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserFromRequest).mockReturnValue(null as never);
});

// ── 1. The share link is not a signature ────────────────────────────────────

describe('🚨 a share-link holder cannot mark a proposal accepted', () => {
  it('PATCH ?token= { status: "accepted" } writes nothing that reads as signed', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { status: 'accepted' }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(signingWrites(sql)).toHaveLength(0);
  });

  it('PATCH ?token= { status: "signed" } is refused the same way', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { status: 'signed' }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(signingWrites(sql)).toHaveLength(0);
  });

  it('PATCH ?token= { signature, signerName } no longer signs — /sign is the only path', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', {
      signature: 'data:image/png;base64,AAAA', signerName: 'Jane Homeowner',
    }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBe(410);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('the homeowner "viewed" ping still works on a live link', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { status: 'viewed' }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql)).toHaveLength(1);
    expect(proposalWrites(sql)[0].values).toContain('viewed');
  });

  it('an EXPIRED link cannot move the status at all', async () => {
    const sql = wire(unsignedRow({ share_expires_at: '2020-01-01T00:00:00.000Z' }));
    const res = await PATCH(req('PATCH', { status: 'viewed' }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });
});

// ── 2. The installer is not the signer ──────────────────────────────────────

describe('🚨 the installer cannot sign their own proposal', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue(OWNER as never);
  });

  for (const status of ['accepted', 'signed', 'Accepted']) {
    it(`PATCH { status: "${status}" } is refused and writes nothing signed`, async () => {
      const sql = wire(unsignedRow());
      const res = await PATCH(req('PATCH', { status }), ctx);
      expect(res.status).toBe(409);
      expect(signingWrites(sql)).toHaveLength(0);
    });

    it(`PUT { status: "${status}" } is refused and writes nothing signed`, async () => {
      const sql = wire(unsignedRow());
      const res = await PUT(req('PUT', { status }), ctx);
      expect(res.status).toBe(409);
      expect(signingWrites(sql)).toHaveLength(0);
    });
  }

  it('PATCH { signature: {...} } cannot plant a signature in data_json', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { signature: { signerName: 'Forged' } }), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('PUT { signature: {...} } cannot plant a signature in data_json', async () => {
    const sql = wire(unsignedRow());
    const res = await PUT(req('PUT', { signature: { signerName: 'Forged' } }), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('PUT on an already-signed proposal cannot walk its status back', async () => {
    const sql = wire(unsignedRow({ status: 'accepted', signed_at: '2026-09-01T00:00:00Z' }));
    const res = await PUT(req('PUT', { status: 'draft' }), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  for (const status of ['accepted', 'signed']) {
    it(`bulk { action: "status", status: "${status}" } is refused`, async () => {
      const sql = wire(unsignedRow());
      const res = await BULK(bulkReq({ action: 'status', ids: [PROPOSAL_ID], status }));
      expect(res.status).toBe(400);
      expect(signingWrites(sql)).toHaveLength(0);
    });
  }

  it('ordinary installer statuses still work (sent / rejected)', async () => {
    for (const status of ['sent', 'rejected']) {
      const sql = wire(unsignedRow());
      const res = await PATCH(req('PATCH', { status }), ctx);
      expect(res.status).toBe(200);
      expect(proposalWrites(sql)).toHaveLength(1);
    }
  });

  it('renaming still works', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { title: 'Renamed' }), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql)).toHaveLength(1);
  });
});

// ── 3. Tenant boundary ──────────────────────────────────────────────────────

describe('🚨 another installer never reaches this proposal', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue(OTHER as never);
  });

  it('PATCH from another tenant is refused with no write', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { title: 'hijack' }), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('PUT from another tenant is refused with no write', async () => {
    const sql = wire(unsignedRow());
    const res = await PUT(req('PUT', { title: 'hijack' }), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('bulk status from another tenant touches nothing', async () => {
    const sql = wire(unsignedRow());
    const res  = await BULK(bulkReq({ action: 'status', ids: [PROPOSAL_ID], status: 'rejected' }));
    const body = await res.json();
    expect(effectiveWrites(sql)).toHaveLength(0);
    expect(body.updated).toBe(0);
  });

  it('a logged-in other tenant holding the share token still cannot accept', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(req('PATCH', { status: 'accepted' }, `?token=${TOKEN}`), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(signingWrites(sql)).toHaveLength(0);
  });
});

// ── 4. The canonical workflow itself ────────────────────────────────────────

describe('🚨 /sign is the canonical signer — and it checks the link is live', () => {
  const body = { signerName: 'Jane Homeowner', agreedToTerms: true, token: TOKEN };

  it('signs a live, unsigned proposal', async () => {
    const sql = wire(unsignedRow());
    const res = await SIGN(signReq(body), ctx);
    expect(res.status).toBe(200);
    expect(signingWrites(sql).length).toBeGreaterThan(0);
  });

  it('refuses an EXPIRED share link with 403 and writes nothing', async () => {
    const sql = wire(unsignedRow({ share_expires_at: '2020-01-01T00:00:00.000Z' }));
    const res = await SIGN(signReq(body), ctx);
    expect(res.status).toBe(403);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('the signing write is conditional on the row still being unsigned', async () => {
    const sql = wire(unsignedRow());
    await SIGN(signReq(body), ctx);
    const write = signingWrites(sql)[0];
    expect(write.q).toMatch(/signed_at IS NULL/i);
  });

  it('a concurrent signer who loses the race gets 409, not a second success', async () => {
    wire(unsignedRow(), { updateAffects: false });
    const res = await SIGN(signReq(body), ctx);
    expect(res.status).toBe(409);
  });

  it("a proposal already at status 'signed' is refused like 'accepted'", async () => {
    const sql = wire(unsignedRow({ status: 'signed' }));
    const res = await SIGN(signReq(body), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });
});
