/**
 * tests/proposalStatusHasOneHome.test.ts
 *
 * 🚨 A HOMEOWNER SIGNED THE CONTRACT AND THE INSTALLER'S LIST STILL SAID "Draft".
 *
 * Proposal status had TWO homes and the readers and writers did not agree on
 * which one was authoritative:
 *
 *   • The `proposals.status` COLUMN is written by the homeowner-side paths:
 *     the signature branch of PATCH /api/proposals/[id] sets it to 'accepted'
 *     and stamps signed_at, and the plain status branch sets 'viewed' on the
 *     first share-link open.
 *   • `data_json.status` is written by the installer-side paths: the generic
 *     PATCH merge and the bulk `jsonb_set(data_json, '{status}', …)`.
 *   • `rowToProposal` in app/api/proposals/route.ts read `data_json.status`
 *     AND NOTHING ELSE.
 *
 * So: the homeowner signs, the column says 'accepted', signed_at is set, the
 * installer gets the "proposal signed" email — and the Proposals list, the status
 * filter and the pill counts all say 'draft', because they read the json the
 * signing path never touches. Filtering by Signed returned an EMPTY LIST while
 * contracts had been executed. The installer would then try to fix the status by
 * hand and get a 409 saying it is frozen. A homeowner merely OPENING the link had
 * the same effect for 'viewed'.
 *
 * THE RULE UNDER TEST: the COLUMN is the authority. `data_json.status` survives
 * only as a fallback for rows that predate the column, and every installer-side
 * writer now writes the column too — otherwise making the column authoritative
 * would break archiving and bulk restatus instead of fixing signing.
 *
 * `archivedAt` deliberately stays in data_json: filing is a fact about the
 * installer's list, not about the agreement.
 *
 * These run the REAL route handlers against a tagged-template sql mock that
 * records the statements issued — the established idiom in
 * tests/proposal-read-authorization.test.ts — because what the writers SEND is
 * half the defect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'db' }), { status: 503 })),
  getProjectWithDetails: vi.fn(async () => undefined),
  getPricingConfig: vi.fn(async () => null),
  rowToProject: vi.fn((r: unknown) => r),
}));

vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn(() => ({ id: 'user-1', name: 'Rep' })) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/email', () => ({
  sendProposalViewedEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalSignedEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/proposal/buildCanonicalProposal', () => ({
  fetchProposalUtilityRate: vi.fn(async () => null),
}));

import { getDbReady } from '@/lib/db-neon';
import { GET as LIST_GET } from '@/app/api/proposals/route';
import { PATCH } from '@/app/api/proposals/[id]/route';
import { POST as BULK } from '@/app/api/proposals/bulk/route';

const PID = '11111111-2222-4333-8444-555555555555';

interface Stmt { q: string; values: unknown[] }

/**
 * Tagged-template sql mock. `handler` answers by query text; every statement is
 * recorded so a test can assert WHICH columns a writer touched.
 */
function makeSql(handler: (q: string, values: unknown[]) => unknown) {
  const stmts: Stmt[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    stmts.push({ q, values });
    return Promise.resolve(handler(q, values));
  };
  return Object.assign(tag, { stmts });
}

function install(handler: (q: string, values: unknown[]) => unknown) {
  const sql = makeSql(handler);
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

/**
 * A Request with `nextUrl`. The PATCH handler reads
 * `req.nextUrl.searchParams.get('token')` to decide between the public
 * token path and the authenticated path, and a bare `Request` has no
 * `nextUrl` — the resulting TypeError is swallowed by the route's single
 * try/catch and answers 503, which looks exactly like a database failure.
 */
function patchReq(body: unknown, query = '') {
  const url = `http://localhost/api/proposals/${PID}${query}`;
  const r = new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  Object.defineProperty(r, 'nextUrl', { value: new URL(url), configurable: true });
  return r as never;
}

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// The READER
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the installer list reads the status COLUMN', () => {
  /** The exact row state after a homeowner signs: column moved, json did not. */
  const SIGNED_ROW = {
    id: PID,
    project_id: 'proj-1',
    name: 'Solar Proposal',
    status: 'accepted',
    signed_at: '2026-09-20T10:00:00Z',
    signer_name: 'Jane Doe',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
    data_json: { status: 'draft', title: 'Solar Proposal', viewCount: 2 },
  };

  async function list(rows: Record<string, unknown>[]) {
    install((q) => (/^SELECT \* FROM proposals/i.test(q) ? rows : []));
    const res = await LIST_GET(new Request('http://localhost/api/proposals') as never);
    return (await res.json()).data as Array<{ status: string }>;
  }

  it('🚨 an executed contract does not read back as "draft"', async () => {
    const [p] = await list([SIGNED_ROW]);
    expect(p.status,
      'the signed contract still reads "draft" — filtering by Signed returns nothing')
      .toBe('accepted');
  });

  it('a homeowner who merely opened the link reads back as "viewed"', async () => {
    const [p] = await list([{ ...SIGNED_ROW, status: 'viewed', signed_at: null, signer_name: null }]);
    expect(p.status).toBe('viewed');
  });

  it('a row that predates the column still falls back to data_json.status', async () => {
    // The fallback is load-bearing: older rows have a NULL column and their only
    // status is in the json. Dropping the fallback would report them all 'draft'.
    const [p] = await list([{ ...SIGNED_ROW, status: null, data_json: { status: 'sent' } }]);
    expect(p.status).toBe('sent');
  });

  it('a row with neither is "draft", not undefined', async () => {
    const [p] = await list([{ ...SIGNED_ROW, status: null, data_json: {} }]);
    expect(p.status).toBe('draft');
  });

  it('archivedAt still comes out of data_json — filing is not the agreement', async () => {
    const rows = await list([{ ...SIGNED_ROW, data_json: { status: 'draft', archivedAt: '2026-09-21T00:00:00Z' } }]);
    expect((rows[0] as any).archivedAt).toBe('2026-09-21T00:00:00Z');
    expect(rows[0].status, 'archiving must not have erased the contract status').toBe('accepted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The WRITERS
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 every installer-side status writer writes the COLUMN', () => {
  it('the authenticated PATCH merge sets the status column, not only data_json', async () => {
    const sql = install((q) => {
      if (/^SELECT id FROM proposals/i.test(q)) return [{ id: PID }];
      if (/^SELECT \* FROM proposals/i.test(q)) return [{ id: PID, status: 'draft', data_json: { status: 'draft' } }];
      if (/^UPDATE proposals/i.test(q)) return [{ id: PID }];
      return [];
    });
    const res = await PATCH(patchReq({ status: 'sent' }), { params: Promise.resolve({ id: PID }) } as never);
    expect(res.status).toBe(200);

    const update = sql.stmts.find(s => /^UPDATE proposals/i.test(s.q));
    expect(update, 'the PATCH issued no UPDATE at all').toBeTruthy();
    expect(update!.q, 'the PATCH merge still writes only data_json.status')
      .toMatch(/status\s*=\s*COALESCE/);
    expect(update!.values, 'the new status never reached the column').toContain('sent');
  });

  it('a PATCH that does not mention status leaves the column alone', async () => {
    // COALESCE, not an unconditional write: a rename must not blank the status.
    const sql = install((q) => {
      if (/^SELECT id FROM proposals/i.test(q)) return [{ id: PID }];
      if (/^SELECT \* FROM proposals/i.test(q)) return [{ id: PID, status: 'accepted', signed_at: null, data_json: {} }];
      if (/^UPDATE proposals/i.test(q)) return [{ id: PID }];
      return [];
    });
    await PATCH(patchReq({ title: 'Renamed' }), { params: Promise.resolve({ id: PID }) } as never);
    const update = sql.stmts.find(s => /^UPDATE proposals/i.test(s.q))!;
    // The status parameter is null, so COALESCE keeps the existing column value.
    expect(update.q).toMatch(/status\s*=\s*COALESCE/);
    expect(update.values).toContain(null);
  });

  it('bulk restatus writes the column as well as the json', async () => {
    const sql = install((q) => {
      if (/^SELECT id, status, signed_at FROM proposals/i.test(q)) return [{ id: PID, status: 'draft', signed_at: null }];
      if (/^UPDATE proposals/i.test(q)) return [{ id: PID }];
      return [];
    });
    const res = await BULK(new Request('http://localhost/api/proposals/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', ids: [PID], status: 'sent' }),
    }) as never);
    const body = await res.json();
    expect(body.updated).toBe(1);

    const update = sql.stmts.find(s => /^UPDATE proposals SET status/i.test(s.q));
    expect(update, 'bulk restatus still writes only data_json.status').toBeTruthy();
    expect(update!.values).toContain('sent');
    // Both are written until the legacy json field can be retired.
    expect(update!.q).toMatch(/jsonb_set\(data_json, '\{status\}'/);
  });

  it('bulk archive moves the column for a draft', async () => {
    const sql = install((q) => {
      if (/^SELECT id, status, signed_at FROM proposals/i.test(q)) return [{ id: PID, status: 'draft', signed_at: null }];
      if (/^UPDATE proposals/i.test(q)) return [{ id: PID }];
      return [];
    });
    await BULK(new Request('http://localhost/api/proposals/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', ids: [PID] }),
    }) as never);
    const update = sql.stmts.find(s => /^UPDATE proposals/i.test(s.q))!;
    expect(update.q, 'archiving a draft no longer moves the authoritative column')
      .toMatch(/status\s*=\s*'archived'/);
  });

  it("🚨 bulk archive still does NOT touch an executed contract's status", () => {
    // The opposite error, and this repo has already fixed it once: "I am done
    // looking at this" is a statement about the installer's list, not about the
    // agreement. Adding a column write must not have re-opened it.
    return (async () => {
      const sql = install((q) => {
        if (/^SELECT id, status, signed_at FROM proposals/i.test(q)) {
          return [{ id: PID, status: 'accepted', signed_at: '2026-09-20T10:00:00Z' }];
        }
        if (/^UPDATE proposals/i.test(q)) return [{ id: PID }];
        return [];
      });
      const res = await BULK(new Request('http://localhost/api/proposals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', ids: [PID] }),
      }) as never);
      const body = await res.json();
      expect(body.statusPreserved).toBe(1);

      const update = sql.stmts.find(s => /^UPDATE proposals/i.test(s.q))!;
      expect(update.q, "an executed contract's status was overwritten by archiving")
        .not.toMatch(/status\s*=\s*'archived'/);
      expect(update.q).toMatch(/archivedAt/);
    })();
  });

  it('a new proposal is born with the column set to draft', async () => {
    const { POST } = await import('@/app/api/proposals/route');
    const db = await import('@/lib/db-neon');
    vi.mocked(db.getProjectWithDetails).mockResolvedValue({
      id: 'proj-1', name: 'P', layout: null, production: null, costEstimate: null,
    } as never);
    const sql = install((q) => {
      if (/^INSERT INTO proposals/i.test(q)) {
        return [{ id: PID, project_id: 'proj-1', status: 'draft', data_json: { status: 'draft' }, created_at: 'x', updated_at: 'x' }];
      }
      return [];
    });
    const res = await POST(new Request('http://localhost/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: '99999999-2222-4333-8444-555555555555' }),
    }) as never);
    expect(res.status).toBe(201);
    const insert = sql.stmts.find(s => /^INSERT INTO proposals/i.test(s.q))!;
    expect(insert.q, 'a new row relies on whatever default the column happens to carry')
      .toMatch(/INSERT INTO proposals \([^)]*status[^)]*\)/);
  });
});
