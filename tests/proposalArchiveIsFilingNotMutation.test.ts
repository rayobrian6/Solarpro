/**
 * tests/proposalArchiveIsFilingNotMutation.test.ts
 *
 * ARCHIVING A SIGNED CONTRACT ERASED THE FACT THAT IT WAS SIGNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOLE
 * ─────────────────────────────────────────────────────────────────────────────
 * 39f700cb closed five write paths into an executed contract, and
 * app/api/proposals/bulk/route.ts grew an `isIssued(row)` predicate to do it.
 * The `status` branch uses it. The `archive` branch — three statements further
 * up the same file — does not, and it writes the same field:
 *
 *     SET data_json = jsonb_set(data_json, '{status}', '"archived"')
 *
 * `rowToProposal` in app/api/proposals/route.ts reads the proposal's status from
 * `data_json.status` and nowhere else, so that one statement is what the whole
 * website displays. Archive a signed proposal and it reads "Archived" — the
 * execution of the contract is gone from every screen, and gone irrecoverably,
 * because the value it replaced was not written down anywhere. Un-archiving is
 * then a guess.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE JUDGEMENT, AND WHY
 * ─────────────────────────────────────────────────────────────────────────────
 * Refusing to archive an executed contract would be the wrong answer. Archiving
 * is FILING: it says "I am done looking at this", which is a statement about the
 * user's list, not about the agreement. Signed proposals are exactly the ones a
 * busy installer most wants out of the way, and a product that refuses is a
 * product whose list can never be cleaned.
 *
 * So the filing action stops travelling in the status field. `archivedAt` is
 * written on EVERY archive — that is the filing fact, recorded once, in one
 * place, for signed and unsigned alike. `status` is additionally set for rows
 * that are NOT executed contracts, which is exactly the behaviour those rows
 * have today, so nothing regresses for them. For an executed contract `status`
 * is left alone and the route SAYS SO, per id, so the page can be honest about
 * what happened.
 *
 * 🚨 WHAT THIS DOES NOT CLOSE, STATED PLAINLY. `rowToProposal` does not map
 * `archivedAt`, and `Proposal` in types/index.ts has no field for it, so an
 * archived executed contract stays visible in the active list after a reload —
 * it is genuinely still 'accepted', and the page filters on status. Both of
 * those files are outside this workstream's boundary and were NOT touched. The
 * alternative was to keep erasing the contract status to make the row disappear,
 * which is the defect. A visible contract is a smaller harm than a contract that
 * no longer says it was signed, and §4 pins the durable half so the remaining
 * half is a one-line follow-up rather than a rediscovery.
 *
 * WHY MOCKED SQL AND NOT PGlite: no migration in this repo creates the
 * `proposals` table (recorded in tests/proposalIssuedArtifactImmutability.test.ts),
 * so a fixture could only be a hand-built stand-in. What must be proven is which
 * statements the handler issues against which rows, and the sql mock records
 * exactly that.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/db-neon', () => ({
  getDbReady:  vi.fn(),
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn((_tag: string, err: unknown) =>
    new Response(
      JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )),
}));
vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn() }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

import { getDbReady }         from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { POST as BULK }       from '@/app/api/proposals/bulk/route';

// ── Helpers ─────────────────────────────────────────────────────────────────

const OWNER_ID  = 'user-owner-1';
const SIGNED    = '11111111-2222-4333-8444-555555555555';
const ACCEPTED  = '44444444-2222-4333-8444-555555555555';
const PRE_020   = '55555555-2222-4333-8444-555555555555';
const DRAFT_A   = '22222222-2222-4333-8444-555555555555';
const DRAFT_B   = '33333333-2222-4333-8444-555555555555';

function makeSql(handler: (q: string, v: unknown[]) => unknown) {
  const queries: Array<{ q: string; v: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    queries.push({ q, v: values });
    return Promise.resolve(handler(q, values) ?? []);
  };
  return Object.assign(tag, { queries });
}

/**
 * Five proposals covering both halves of `isIssued`:
 *   SIGNED    — signed_at present (the post-migration-020 shape)
 *   ACCEPTED  — status 'accepted', no signed_at
 *   PRE_020   — status 'signed', signed_at column absent entirely
 *   DRAFT_A/B — ordinary rows that must keep behaving exactly as before
 */
function world() {
  const rows: Record<string, Record<string, unknown>> = {
    [SIGNED]:   { id: SIGNED,   user_id: OWNER_ID, status: 'sent',     signed_at: '2026-09-01T12:00:00.000Z' },
    [ACCEPTED]: { id: ACCEPTED, user_id: OWNER_ID, status: 'accepted', signed_at: null },
    [PRE_020]:  { id: PRE_020,  user_id: OWNER_ID, status: 'signed' },
    [DRAFT_A]:  { id: DRAFT_A,  user_id: OWNER_ID, status: 'sent',     signed_at: null },
    [DRAFT_B]:  { id: DRAFT_B,  user_id: OWNER_ID, status: 'draft',    signed_at: null },
  };
  const sql = makeSql((q, v) => {
    const id = v.find(x => typeof x === 'string' && x in rows) as string | undefined;
    if (!id) return [];
    if (/^SELECT/i.test(q)) return [rows[id]];
    if (/^UPDATE/i.test(q)) return [{ id }];
    if (/^DELETE/i.test(q)) return [{ id }];
    return [];
  });
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

function bulk(body: unknown) {
  return BULK(new Request('http://localhost/api/proposals/bulk', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }) as never);
}

/** Every UPDATE the handler issued, paired with the id it carried. */
function updatesFor(sql: { queries: Array<{ q: string; v: unknown[] }> }, id: string) {
  return sql.queries.filter(x => /^UPDATE proposals/i.test(x.q) && x.v.includes(id));
}

/** Does this statement write the status field? */
function writesStatus(q: string): boolean {
  return /'\{status\}'/.test(q);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. 🚨 THE DEFECT — AN EXECUTED CONTRACT'S STATUS SURVIVES BEING FILED
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 archiving does not rewrite the status of an executed contract', () => {
  it('no statement in the archive path touches a signed proposal\'s status', async () => {
    const sql = world();
    await bulk({ action: 'archive', ids: [SIGNED] });
    const bad = updatesFor(sql, SIGNED).filter(x => writesStatus(x.q));
    expect(bad.map(x => x.q),
      'the archive path still overwrites data_json.status on an executed contract — ' +
      'the website reads its status from exactly that field')
      .toEqual([]);
  });

  it('nor an accepted one, where the signature predates the signed_at column', async () => {
    // `isIssued` deliberately checks BOTH halves. A guard that only looked at
    // signed_at would pass the case above and lose this one, and a database that
    // predates migration 020 is the one that has the most history in it.
    const sql = world();
    await bulk({ action: 'archive', ids: [ACCEPTED, PRE_020] });
    for (const id of [ACCEPTED, PRE_020]) {
      expect(updatesFor(sql, id).filter(x => writesStatus(x.q)).map(x => x.q),
        `status was rewritten on ${id}`).toEqual([]);
    }
  });

  it('and it is still ARCHIVED — filing an executed contract is allowed', async () => {
    // 🚨 THE JUDGEMENT, pinned. Refusing would have been the easy fix and the
    // wrong one: the signed proposals are the ones most worth filing away.
    const sql = world();
    const body = await (await bulk({ action: 'archive', ids: [SIGNED] })).json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(updatesFor(sql, SIGNED).length,
      'nothing was written at all — archiving an executed contract was refused, ' +
      'not redirected').toBeGreaterThan(0);
  });

  it('the filing fact is recorded where it cannot destroy anything', async () => {
    const sql = world();
    await bulk({ action: 'archive', ids: [SIGNED] });
    expect(updatesFor(sql, SIGNED).some(x => /archivedAt/.test(x.q)),
      'the archive left no durable record of itself on the row')
      .toBe(true);
  });

  it('the route says WHICH rows kept their status, so the page can explain itself', async () => {
    world();
    const body = await (await bulk({
      action: 'archive', ids: [SIGNED, DRAFT_A, DRAFT_B],
    })).json();
    expect(body.statusPreservedIds).toEqual([SIGNED]);
    expect(body.statusPreserved).toBe(1);
    expect(body.archivedIds).toEqual(expect.arrayContaining([SIGNED, DRAFT_A, DRAFT_B]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POSITIVE CONTROLS — NOTHING CHANGES FOR AN ORDINARY PROPOSAL
// ═══════════════════════════════════════════════════════════════════════════
//
// A fix that made archiving stop working for the 99% would be worse than the
// defect. These pass before the change and after it.

describe('an unsigned proposal is archived exactly as before', () => {
  it('its status still becomes archived', async () => {
    const sql = world();
    await bulk({ action: 'archive', ids: [DRAFT_A] });
    const statusWrites = updatesFor(sql, DRAFT_A).filter(x => writesStatus(x.q));
    expect(statusWrites.length, 'a draft is no longer being archived at all')
      .toBeGreaterThan(0);
    expect(statusWrites.some(x => /archived/.test(x.q))).toBe(true);
  });

  it('a mixed batch archives everything and reports it', async () => {
    world();
    const body = await (await bulk({
      action: 'archive', ids: [SIGNED, ACCEPTED, DRAFT_A, DRAFT_B],
    })).json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(4);
  });

  it('a batch of nothing but drafts reports no preserved statuses', async () => {
    world();
    const body = await (await bulk({
      action: 'archive', ids: [DRAFT_A, DRAFT_B],
    })).json();
    expect(body.statusPreserved).toBe(0);
    expect(body.statusPreservedIds).toEqual([]);
  });

  it('ownership is still the real guard — a row that is not yours is not archived', async () => {
    const sql = makeSql((q) => {
      if (/^SELECT/i.test(q)) return [];   // not found for this user
      if (/^UPDATE/i.test(q)) return [];
      return [];
    });
    vi.mocked(getDbReady).mockResolvedValue(sql as never);
    const body = await (await bulk({ action: 'archive', ids: [DRAFT_A] })).json();
    expect(body.updated).toBe(0);
  });

  it('the other actions are untouched by this change', async () => {
    // POSITIVE CONTROL for the file as a whole: delete and status still work.
    world();
    const del = await (await bulk({ action: 'delete', ids: [DRAFT_A] })).json();
    expect(del.deleted).toBe(1);
    const st = await (await bulk({ action: 'status', ids: [DRAFT_B], status: 'sent' })).json();
    expect(st.updated).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE GUARD IS THE ONE THE FILE ALREADY HAS
// ═══════════════════════════════════════════════════════════════════════════

describe('the archive branch uses the predicate that was already there', () => {
  const ROUTE = stripComments(readFileSync(
    join(__dirname, '..', 'app', 'api', 'proposals', 'bulk', 'route.ts'), 'utf8'));

  /** The archive branch, anchored on real syntax and closed on the `if` that
   *  follows it — never a character count. */
  function archiveBranch(): string {
    const start = ROUTE.indexOf("if (action === 'archive')");
    expect(start, 'the archive branch is gone').toBeGreaterThan(-1);
    const end = ROUTE.indexOf("if (action === 'status')", start);
    expect(end, 'the status branch no longer follows archive — re-anchor this scan')
      .toBeGreaterThan(start);
    return ROUTE.slice(start, end);
  }

  it('calls isIssued rather than reimplementing the rule', () => {
    // 🚨 THE REQUIREMENT, not a spelling: the decision must come FROM the shared
    // predicate. A second copy of `signed_at || status === 'accepted'` inside the
    // archive branch would satisfy every behavioural test above and then drift
    // the first time the rule changes — which is how the archive branch came to
    // be missing the rule in the first place.
    expect(archiveBranch(), 'the archive branch decides terminality by itself')
      .toMatch(/isIssued\(/);
  });

  it('and isIssued is still defined once, at the top of the file', () => {
    expect((ROUTE.match(/function isIssued\(/g) ?? [])).toHaveLength(1);
    expect(ROUTE).toMatch(/TERMINAL_STATUSES/);
  });

  it('the guard reads the row before writing it', () => {
    expect(archiveBranch()).toMatch(/SELECT[\s\S]*FROM proposals/i);
  });

  it('and tolerates a database without the signed_at column', () => {
    // The same `.catch()` fallback the status branch uses. Without it, every
    // archive on a pre-020 database throws and the whole batch 503s.
    expect(archiveBranch(), 'a database predating migration 020 would throw here')
      .toMatch(/\.catch\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE PAGE DOES NOT CLAIM MORE THAN HAPPENED
// ═══════════════════════════════════════════════════════════════════════════
//
// Source-scanned for the reason given in
// tests/proposalsPageShowsWhatTheServerRefused.test.ts §3 — the page is a
// 3,200-line client component and `bulkArchive` is a closure inside it.
//
// 🚨 WHAT A SOURCE SCAN CANNOT SEE: reachability. A `toast.info(...)` behind a
// condition that is never true still reads as present, so the "says so"
// assertion below is the weakest one in this file. It is kept because it fails
// when the call is deleted, which is the likely regression; the assertion that
// actually carries the weight is the first one — the repaint must not be driven
// by the requested ids — and it is the one a dead-branch mutation trips.

describe('bulkArchive tells the truth about an executed contract', () => {
  const RAW  = readFileSync(join(__dirname, '..', 'app', 'proposals', 'page.tsx'), 'utf8');
  const PAGE = stripComments(RAW);

  function bulkArchiveBody(): string {
    const start = PAGE.indexOf('const bulkArchive = async');
    expect(start, 'bulkArchive is gone from the page').toBeGreaterThan(-1);
    const end = PAGE.indexOf('const bulkSetStatus = async', start);
    expect(end, 'bulkSetStatus no longer follows bulkArchive — re-anchor this scan')
      .toBeGreaterThan(start);
    return PAGE.slice(start, end);
  }

  it('🚨 does not paint "archived" over a status the server kept', () => {
    expect(bulkArchiveBody(),
      'the page still repaints every selected row as archived, so a signed contract ' +
      'reads as archived on screen while the stored row says accepted')
      .not.toMatch(/ids\.includes\(p\.id\)\s*\?\s*\{\s*\.\.\.p,\s*status:\s*'archived'/);
  });

  it('drives the repaint from what the server reported', () => {
    expect(bulkArchiveBody()).toMatch(/statusPreservedIds|archivedIds/);
  });

  it('and says so when a contract was filed without restatusing it', () => {
    expect(bulkArchiveBody()).toMatch(/toast\.(info|warning|success)/);
  });

  it('still clears the selection', () => {
    // POSITIVE CONTROL.
    expect(bulkArchiveBody()).toMatch(/setSelectedIds/);
  });
});
