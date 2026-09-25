/**
 * tests/proposalIssuedArtifactImmutability.test.ts
 *
 * A SIGNED PROPOSAL IS AN ISSUED ARTIFACT. NOTHING MAY REWRITE IT.
 *
 * This repo already ruled on this once, for permit packages: a GET request
 * self-healed and re-dated packages that had already been issued, and the
 * ruling was that an issued artifact is immutable. The same hole existed on
 * the proposal — on the signature itself, and on the figures behind it.
 *
 * Five live write paths reached an executed contract:
 *
 *   1. PATCH /api/proposals/[id] with a `signature` body — the endpoint the
 *      homeowner's signing modal actually called. It had no idempotency check
 *      at all, replaced the whole `signature` key, and re-stamped `signed_at`
 *      to NOW(). A guarded endpoint (POST .../sign) existed and returned 409,
 *      but its only component had zero callers: the safe path was dead code
 *      and the unguarded one was live.
 *   2. PATCH .../[id] { action: 'refresh_snapshot' } — re-pulled the live
 *      project over the frozen snapshot with only an ownership check.
 *   3. POST .../[id]/share — the same hole on the *re-send* action, and worse:
 *      it rewrites `pricingSnapshot`, the frozen financial vintage.
 *   4. PATCH .../[id] { status: 'viewed' } — fired unconditionally on every
 *      page load, so a returning signer downgraded `accepted` back to `viewed`.
 *   5. POST /api/proposals/bulk { action: 'status' } — any status onto any
 *      proposal, signed or not.
 *
 * The in-repo idiom being applied is the one already used by
 * app/api/cron/proposal-expiry/route.ts, which filters `signed_at IS NULL`.
 *
 * WHY MOCKED SQL AND NOT PGlite: the `proposals` table has no CREATE statement
 * anywhere in this repo — no migration creates it — so a PGlite fixture could
 * only be a hand-built stand-in, and a fixture missing columns accuses the
 * product of the fixture's own fault. These guards are decided in handler
 * JavaScript, not in a WHERE clause, so what has to be proven is which
 * statements the handler issues. The sql mock records exactly that, following
 * tests/proposal-read-authorization.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/db-neon', () => ({
  getDbReady:  vi.fn(),
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn((_tag: string, err: unknown) => {
    // Surface the real message so a thrown bug is not disguised as a DB outage.
    return new Response(
      JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }),
  rowToProject:          (r: Record<string, unknown>) => r,
  getProjectWithDetails: vi.fn(async () => ({ id: 'proj-1', layout: { totalPanels: 24 } })),
  getPricingConfig:      vi.fn(async () => ({ pricePerWatt: 3.21 })),
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

vi.mock('@/lib/proposal/buildCanonicalProposal', () => ({
  fetchProposalUtilityRate: vi.fn(async () => 0.17),
}));

vi.mock('@/lib/env', () => ({
  getBaseUrl: () => 'https://example.test',
}));

import { NextRequest }        from 'next/server';
import { getDbReady }         from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { PATCH }              from '@/app/api/proposals/[id]/route';
import { POST as SHARE }      from '@/app/api/proposals/[id]/share/route';
import { POST as BULK }       from '@/app/api/proposals/bulk/route';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_ID = '11111111-2222-4333-8444-555555555555';
const PROJECT_ID  = '99999999-8888-4777-8666-555555555555';
const GOOD_TOKEN  = 'a1b2c3d4e5f60718';
const OWNER_ID    = 'user-owner-1';

/** Tagged-template sql mock that records every statement it is asked to run. */
function makeSql(handler: (q: string) => unknown) {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    queries.push(q);
    return Promise.resolve(handler(q) ?? []);
  };
  // `.catch()` is called on some tagged results; a Promise already has it.
  return Object.assign(tag, { queries, values: [] as unknown[] });
}

function signedRow(overrides: Record<string, unknown> = {}) {
  return {
    id:           PROPOSAL_ID,
    project_id:   PROJECT_ID,
    user_id:      OWNER_ID,
    name:         'Solar Proposal',
    title:        'Solar Proposal',
    status:       'accepted',
    signed_at:    '2026-09-01T12:00:00.000Z',
    signer_name:  'Jane Homeowner',
    signer_email: 'jane@example.test',
    share_token:  GOOD_TOKEN,
    data_json:    {
      clientName:      'Jane Homeowner',
      pricingSnapshot: { pricePerWatt: 2.85 },
      snapshotAt:      '2026-08-01T00:00:00.000Z',
      signature:       {
        signedAt:   '2026-09-01T12:00:00.000Z',
        signerName: 'Jane Homeowner',
        signerIp:   '10.0.0.9',
        imageData:  'data:image/png;base64,ORIGINAL',
      },
    },
    ...overrides,
  };
}

function unsignedRow(overrides: Record<string, unknown> = {}) {
  return signedRow({
    status:     'sent',
    signed_at:  null,
    data_json:  { clientName: 'Jane Homeowner', pricingSnapshot: { pricePerWatt: 2.85 } },
    ...overrides,
  });
}

/** Route every statement a proposal handler can issue against one row. */
function wire(row: Record<string, unknown> | null, opts: { owned?: boolean } = {}) {
  const owned = opts.owned !== false;
  const sql = makeSql((q) => {
    if (/^UPDATE/i.test(q))      return row ? [row] : [];
    if (/^DELETE/i.test(q))      return [];
    if (/^INSERT/i.test(q))      return [];
    // Ownership probes select only the id.
    if (/^SELECT id FROM proposals/i.test(q) || /^SELECT p\.id FROM proposals/i.test(q)) {
      return owned && row ? [{ id: PROPOSAL_ID }] : [];
    }
    if (/FROM proposals/i.test(q)) {
      if (!row) return [];
      if (/JOIN projects/i.test(q) && /u\.email/i.test(q)) return [];
      if (/JOIN projects/i.test(q) && !owned)              return [];
      return [row];
    }
    if (/FROM projects/i.test(q)) return [{ id: PROJECT_ID, homeowner_stage: 'proposal' }];
    return [];
  });
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

const ctx = { params: Promise.resolve({ id: PROPOSAL_ID }) };

/**
 * The PATCH handler reads `req.nextUrl.searchParams`, which a plain `Request`
 * does not carry — it must be a NextRequest or every call throws before the
 * handler is reached and a passing guard test would prove nothing.
 */
function patchReq(body: unknown, query = '') {
  return new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}${query}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }) as never;
}

/** Statements that would mutate the stored proposal row. */
function proposalWrites(sql: { queries: string[] }) {
  return sql.queries.filter(q => /^UPDATE proposals/i.test(q));
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserFromRequest).mockReturnValue(null as never);
});

// ── 1. Double-signing ───────────────────────────────────────────────────────

describe('a signature cannot be overwritten', () => {
  const secondSignature = {
    signature:   'data:image/png;base64,MALLORY',
    signerName:  'Mallory Attacker',
    signerEmail: 'mallory@example.test',
  };

  it('refuses a second signature on an executed proposal with 409', async () => {
    wire(signedRow());
    const res = await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    expect(res.status).toBe(409);
  });

  it('says the proposal has already been signed', async () => {
    wire(signedRow());
    const res  = await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/already been signed/i);
  });

  it('issues no write at all — the first signer is not discarded', async () => {
    const sql = wire(signedRow());
    await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('refuses on signed_at alone, even if status was moved off accepted', async () => {
    const sql = wire(signedRow({ status: 'viewed' }));
    const res = await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('refuses on status=accepted alone, before migration 020 columns exist', async () => {
    const sql = wire(signedRow({ signed_at: undefined }));
    const res = await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('still lets a first-time signer through', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(patchReq(secondSignature, `?token=${GOOD_TOKEN}`), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql).length).toBeGreaterThan(0);
  });
});

// ── 2. refresh_snapshot ─────────────────────────────────────────────────────

describe('refresh_snapshot cannot rewrite an executed proposal', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
  });

  it('refuses with 409 on a signed proposal', async () => {
    wire(signedRow());
    const res = await PATCH(patchReq({ action: 'refresh_snapshot' }), ctx);
    expect(res.status).toBe(409);
  });

  it('issues no write — the figures behind the signature stand', async () => {
    const sql = wire(signedRow());
    await PATCH(patchReq({ action: 'refresh_snapshot' }), ctx);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('still refreshes an unsigned proposal', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(patchReq({ action: 'refresh_snapshot' }), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql).length).toBeGreaterThan(0);
  });
});

// ── 3. share ────────────────────────────────────────────────────────────────

describe('re-sharing cannot rewrite the frozen pricing vintage', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
  });

  function shareReq() {
    return new Request(`http://localhost/api/proposals/${PROPOSAL_ID}/share`, { method: 'POST' }) as never;
  }
  const shareCtx = { params: Promise.resolve({ id: PROPOSAL_ID }) };

  it('writes no snapshot into a signed proposal', async () => {
    const sql = wire(signedRow());
    await SHARE(shareReq(), shareCtx);
    expect(proposalWrites(sql).some(q => /data_json/i.test(q))).toBe(false);
  });

  it('reports that it did not refresh the snapshot', async () => {
    wire(signedRow());
    const res  = await SHARE(shareReq(), shareCtx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.snapshotRefreshed).toBe(false);
  });

  it('still hands back a usable share link for the executed contract', async () => {
    wire(signedRow());
    const body = await (await SHARE(shareReq(), shareCtx)).json();
    expect(String(body.shareUrl)).toContain(PROPOSAL_ID);
  });

  it('still refreshes the snapshot for an unsigned proposal', async () => {
    const sql = wire(unsignedRow());
    const res  = await SHARE(shareReq(), shareCtx);
    const body = await res.json();
    expect(body.snapshotRefreshed).toBe(true);
    expect(proposalWrites(sql).some(q => /data_json/i.test(q))).toBe(true);
  });
});

// ── 4. the unconditional `viewed` downgrade ─────────────────────────────────

describe('a page load cannot downgrade an accepted proposal', () => {
  it('issues no status write when the proposal is already signed', async () => {
    const sql = wire(signedRow());
    await PATCH(patchReq({ status: 'viewed' }, `?token=${GOOD_TOKEN}`), ctx);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('answers 200 so a returning signer sees no error, and says nothing changed', async () => {
    wire(signedRow());
    const res  = await PATCH(patchReq({ status: 'viewed' }, `?token=${GOOD_TOKEN}`), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.statusChanged).toBe(false);
  });

  it('still records the first view of an unsigned proposal', async () => {
    const sql = wire(unsignedRow());
    const res = await PATCH(patchReq({ status: 'viewed' }, `?token=${GOOD_TOKEN}`), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql).length).toBeGreaterThan(0);
  });
});

// ── 5. bulk status ──────────────────────────────────────────────────────────

describe('a bulk status change skips executed proposals', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
  });

  function bulkReq(body: unknown) {
    return new Request('http://localhost/api/proposals/bulk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }) as never;
  }

  it('does not set a signed proposal back to draft', async () => {
    const sql = wire(signedRow());
    await BULK(bulkReq({ action: 'status', ids: [PROPOSAL_ID], status: 'draft' }));
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('reports the skip rather than claiming an update', async () => {
    wire(signedRow());
    const res  = await BULK(bulkReq({ action: 'status', ids: [PROPOSAL_ID], status: 'draft' }));
    const body = await res.json();
    expect(body.updated).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('still updates an unsigned proposal', async () => {
    const sql = wire(unsignedRow());
    const res  = await BULK(bulkReq({ action: 'status', ids: [PROPOSAL_ID], status: 'sent' }));
    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(proposalWrites(sql).length).toBeGreaterThan(0);
  });
});

// ── The authenticated owner is not an exception ─────────────────────────────

describe('the owning installer cannot edit the signature or status either', () => {
  beforeEach(() => {
    vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
  });

  it('refuses an authenticated PATCH that rewrites data_json.signature', async () => {
    const sql = wire(signedRow());
    const res = await PATCH(patchReq({ signature: { signerName: 'Someone Else' } }), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('refuses an authenticated PATCH that rewrites the status', async () => {
    const sql = wire(signedRow());
    const res = await PATCH(patchReq({ status: 'draft' }), ctx);
    expect(res.status).toBe(409);
    expect(proposalWrites(sql)).toHaveLength(0);
  });

  it('still lets the installer rename a signed proposal', async () => {
    const sql = wire(signedRow());
    const res = await PATCH(patchReq({ title: 'Renamed for filing' }), ctx);
    expect(res.status).toBe(200);
    expect(proposalWrites(sql).length).toBeGreaterThan(0);
  });
});
