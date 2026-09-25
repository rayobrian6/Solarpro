/**
 * Tests for GET /api/proposals/[id] — read authorization.
 *
 * A proposal row carries pricing, the client's name and the site address.
 * Before this suite the GET handler ran `SELECT * FROM proposals WHERE id = $1`
 * with no auth and no share-token check, so anyone holding a proposal UUID
 * could read the whole row. The only comparison lived in the client component
 * (app/proposals/view/[id]/page.tsx), which an attacker never executes.
 *
 * The rules under test:
 *   - authenticated installer who owns the proposal (via projects JOIN) -> 200
 *   - unauthenticated caller holding a live share token                 -> 200
 *   - everyone else                                                     -> 403
 *   - expiry (share_expires_at) is honoured; NULL means "never expires",
 *     matching `share_expires_at IS NULL OR share_expires_at > NOW()` as
 *     already used by app/api/portal/dashboard/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'db' }), { status: 503 })),
}));

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => null),
}));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/email', () => ({
  sendProposalViewedEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalSignedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getDbReady }         from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { GET }                from '@/app/api/proposals/[id]/route';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_ID = '11111111-2222-4333-8444-555555555555';
const GOOD_TOKEN  = 'a1b2c3d4e5f60718';
const OWNER_ID    = 'user-owner-1';

/**
 * Tagged-template sql mock that routes on the query text, so a test can assert
 * which statements ran (in particular: that a DENIED read issues no UPDATE).
 */
function makeSql(handler: (q: string, values: unknown[]) => unknown) {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    queries.push(q);
    return Promise.resolve(handler(q, values));
  };
  return Object.assign(tag, { queries });
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id:               PROPOSAL_ID,
    project_id:       'proj-1',
    name:             'Solar Proposal',
    share_token:      GOOD_TOKEN,
    share_expires_at: null,
    data_json:        { clientName: 'Jane Doe', viewCount: 3, totalCost: 28500 },
    created_at:       '2026-09-01T00:00:00Z',
    updated_at:       '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

/** Wire the sql mock: proposal row + ownership JOIN result. */
function wireDb(row: Record<string, unknown> | null, ownedBy: string | null = OWNER_ID) {
  const sql = makeSql((q) => {
    if (/^SELECT \* FROM proposals/i.test(q)) return row ? [row] : [];
    if (/JOIN projects/i.test(q) && /SELECT p\.id/i.test(q)) {
      return ownedBy ? [{ id: PROPOSAL_ID }] : [];
    }
    if (/^UPDATE proposals/i.test(q)) return [];
    if (/JOIN users/i.test(q)) return [];
    return [];
  });
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

function req(query = '') {
  return new Request(`http://localhost/api/proposals/${PROPOSAL_ID}${query}`) as never;
}
const ctx = { params: Promise.resolve({ id: PROPOSAL_ID }) };

async function call(query = '') {
  const res  = await GET(req(query), ctx);
  const body = await res.json();
  return { status: res.status, body };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/proposals/[id] — unauthenticated callers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserFromRequest).mockReturnValue(null);
  });

  it('refuses a bare proposal UUID with no token (the reported hole)', async () => {
    wireDb(makeRow());
    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('does not leak the row body when it refuses', async () => {
    wireDb(makeRow());
    const { body } = await call();
    expect(JSON.stringify(body)).not.toContain('Jane Doe');
    expect(JSON.stringify(body)).not.toContain('28500');
  });

  it('refuses a wrong token', async () => {
    wireDb(makeRow());
    const { status } = await call('?token=0000000000000000');
    expect(status).toBe(403);
  });

  it('refuses a token of a different length without throwing', async () => {
    wireDb(makeRow());
    const { status } = await call('?token=short');
    expect(status).toBe(403);
  });

  it('accepts the correct token', async () => {
    wireDb(makeRow());
    const { status, body } = await call(`?token=${GOOD_TOKEN}&track=1`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(PROPOSAL_ID);
  });

  it('refuses a correct token once share_expires_at has passed', async () => {
    wireDb(makeRow({ share_expires_at: '2026-01-01T00:00:00Z' }));
    const { status, body } = await call(`?token=${GOOD_TOKEN}`);
    expect(status).toBe(403);
    expect(String(body.error)).toMatch(/expired|invalid/i);
  });

  it('accepts a correct token when share_expires_at is in the future', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    wireDb(makeRow({ share_expires_at: future }));
    const { status } = await call(`?token=${GOOD_TOKEN}`);
    expect(status).toBe(200);
  });

  it('treats a NULL share_expires_at as "never expires"', async () => {
    wireDb(makeRow({ share_expires_at: null }));
    const { status } = await call(`?token=${GOOD_TOKEN}`);
    expect(status).toBe(200);
  });

  it('refuses a proposal that was never shared (share_token IS NULL)', async () => {
    wireDb(makeRow({ share_token: null }));
    const { status } = await call('?token=anything');
    expect(status).toBe(403);
  });

  it('issues no UPDATE (no view-count write) on a refused read', async () => {
    const sql = wireDb(makeRow());
    await call();
    expect(sql.queries.some(q => /^UPDATE/i.test(q))).toBe(false);
  });

  it('still returns 404 for a proposal that does not exist', async () => {
    wireDb(null);
    const { status } = await call(`?token=${GOOD_TOKEN}`);
    expect(status).toBe(404);
  });

  it('still returns 400 for a malformed id', async () => {
    wireDb(makeRow());
    const res = await GET(req() as never, { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/proposals/[id] — authenticated installers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets the owning installer read it with no token', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.com' } as never);
    wireDb(makeRow(), OWNER_ID);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.id).toBe(PROPOSAL_ID);
  });

  it('refuses a logged-in installer who does not own it and has no token', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: 'other-user', email: 'e@x.com' } as never);
    wireDb(makeRow(), null);
    const { status } = await call();
    expect(status).toBe(403);
  });

  it('lets a logged-in non-owner through when they hold a valid share token', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: 'other-user', email: 'e@x.com' } as never);
    wireDb(makeRow(), null);
    const { status } = await call(`?token=${GOOD_TOKEN}`);
    expect(status).toBe(200);
  });

  it('does not inflate the view count for the owning installer', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.com' } as never);
    const sql = wireDb(makeRow(), OWNER_ID);
    await call('?track=1');
    expect(sql.queries.some(q => /^UPDATE proposals/i.test(q))).toBe(false);
  });

  it('does increment the view count for a homeowner on the share link', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null);
    const sql = wireDb(makeRow(), null);
    await call(`?token=${GOOD_TOKEN}&track=1`);
    expect(sql.queries.some(q => /^UPDATE proposals/i.test(q))).toBe(true);
  });
});
