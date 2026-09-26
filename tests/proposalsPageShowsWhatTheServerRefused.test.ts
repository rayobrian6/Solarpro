/**
 * tests/proposalsPageShowsWhatTheServerRefused.test.ts
 *
 * THE SERVER REFUSED. THE SCREEN SAID IT WORKED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — BOTH ENDS OF THE SAME WIRE, AND ONLY THE CLIENT END BROKE
 * ─────────────────────────────────────────────────────────────────────────────
 * 39f700cb made an executed contract immutable. The server is correct: a
 * `refresh_snapshot` on a signed proposal answers 409, and a bulk status change
 * answers `{ updated, skipped }` having left the signed rows alone. Both gaps
 * here are in app/proposals/page.tsx, and both have the same shape — a refusal
 * the user cannot see.
 *
 *   1. `refreshSnapshot` did `const data = await res.json(); if (data.success)`
 *      and nothing else. On a 409 `success` is false, so the branch was skipped,
 *      the spinner cleared in `finally`, and the button looked like it had
 *      worked. The installer presses Refresh on a stale-looking proposal, sees
 *      no reaction, presses it again, and concludes the product is broken —
 *      when in fact the product is protecting a signed contract and simply
 *      never said so.
 *
 *   2. `bulkSetStatus` did not read the response at all. It painted the new
 *      status onto EVERY selected row, including the ones the server had
 *      skipped. A signed proposal visibly became a draft and stayed that way
 *      until the next page load, at which point it silently changed back. An
 *      optimistic update that the server declined is not optimism, it is a
 *      false statement about stored data — and this one lasted long enough for
 *      someone to act on it.
 *
 *   3. `updateStatus` — the single-row path behind the row-level Archive
 *      action — had the identical hole: `await fetch(...)` with no status check,
 *      then an unconditional repaint. The same 409 the bulk path reports lands
 *      here too, from PATCH /api/proposals/[id].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS PROVEN WHERE, AND WHY
 * ─────────────────────────────────────────────────────────────────────────────
 * §1–2 run the REAL bulk route. The id lists the client needs in order to paint
 * only what actually changed are a server contract, and a contract is worth
 * nothing if it is only asserted against a mock of itself.
 *
 * §3 scans the source of app/proposals/page.tsx. That is deliberate, following
 * tests/layoutConcurrency.postgres.test.ts §4: this page is a 3,200-line client
 * component pulling in recharts, a subscription hook, the truth engine and a
 * dozen lib modules, and the two functions under test are closures inside it
 * with no seam to call. These are textual facts — a branch that is not there
 * cannot run, whatever else is true. Comments are stripped, so the docblocks
 * above cannot satisfy any of it.
 *
 * WHY MOCKED SQL AND NOT PGlite: unchanged from
 * tests/proposalIssuedArtifactImmutability.test.ts — no migration in this repo
 * creates the `proposals` table, so a fixture could only be a hand-built
 * stand-in, and a fixture missing a column accuses the product of the fixture's
 * own fault. What has to be proven here is which statements the handler issues
 * and what it reports, and the sql mock records exactly that.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments, stripCommentsAndStrings } from './support/stripSource';

// ── Module mocks (same set as proposalIssuedArtifactImmutability) ────────────

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

const OWNER_ID = 'user-owner-1';
const SIGNED   = '11111111-2222-4333-8444-555555555555';
const DRAFT_A  = '22222222-2222-4333-8444-555555555555';
const DRAFT_B  = '33333333-2222-4333-8444-555555555555';

/** Tagged-template sql mock that records every statement it runs. */
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
 * A small world of three proposals: one executed contract and two drafts.
 * Every statement the bulk handler can issue is routed against it, keyed on the
 * id the statement carries, so the per-id guard loop is exercised for real.
 */
function world() {
  const rows: Record<string, Record<string, unknown>> = {
    [SIGNED]:  { id: SIGNED,  user_id: OWNER_ID, status: 'accepted', signed_at: '2026-09-01T12:00:00.000Z' },
    [DRAFT_A]: { id: DRAFT_A, user_id: OWNER_ID, status: 'sent',     signed_at: null },
    [DRAFT_B]: { id: DRAFT_B, user_id: OWNER_ID, status: 'draft',    signed_at: null },
  };
  const sql = makeSql((q, v) => {
    const id = v.find(x => typeof x === 'string' && x in rows) as string | undefined;
    if (!id) return [];
    if (/^SELECT/i.test(q)) return [rows[id]];
    if (/^UPDATE/i.test(q)) return [{ id }];
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserFromRequest).mockReturnValue({ id: OWNER_ID, email: 'o@x.test' } as never);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE SERVER SAYS *WHICH* ROWS IT CHANGED
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 A COUNT IS NOT ENOUGH, AND THIS IS THE ROOT OF DEFECT 2.
//
// `{ updated: 2, skipped: 1 }` tells the client that one row in its selection
// did not move, but not WHICH — so the only honest thing a client holding a
// count can do is repaint nothing and refetch everything. The ids are already
// in the handler's hand, one per loop iteration. Returning them is what lets
// the page paint exactly the rows that changed.

describe('a bulk status change reports which proposals moved', () => {
  it('names the ids it updated', async () => {
    world();
    const body = await (await bulk({
      action: 'status', ids: [SIGNED, DRAFT_A, DRAFT_B], status: 'sent',
    })).json();
    expect(body.updatedIds).toEqual(expect.arrayContaining([DRAFT_A, DRAFT_B]));
    expect(body.updatedIds).toHaveLength(2);
  });

  it('names the ids it skipped', async () => {
    world();
    const body = await (await bulk({
      action: 'status', ids: [SIGNED, DRAFT_A, DRAFT_B], status: 'draft',
    })).json();
    expect(body.skippedIds).toEqual([SIGNED]);
  });

  it('and the lists agree with the counts that were already there', async () => {
    // The counts are an existing contract — tests/proposalIssuedArtifactImmutability
    // asserts them. The lists must not contradict them.
    world();
    const body = await (await bulk({
      action: 'status', ids: [SIGNED, DRAFT_A, DRAFT_B], status: 'viewed',
    })).json();
    expect(body.updated).toBe(body.updatedIds.length);
    expect(body.skipped).toBe(body.skippedIds.length);
    expect(body.updated + body.skipped).toBe(3);
  });

  it('an all-clear batch reports an empty skip list, not a missing one', async () => {
    // POSITIVE CONTROL. A client that reads `skippedIds.length` must not crash
    // on the ordinary case, and `undefined` is how that happens.
    world();
    const body = await (await bulk({
      action: 'status', ids: [DRAFT_A, DRAFT_B], status: 'sent',
    })).json();
    expect(body.skippedIds).toEqual([]);
    expect(body.updatedIds).toHaveLength(2);
  });

  it('the executed contract is still not written — the report did not loosen the guard', async () => {
    const sql = world();
    await bulk({ action: 'status', ids: [SIGNED], status: 'draft' });
    const writes = sql.queries.filter(x => /^UPDATE proposals/i.test(x.q));
    expect(writes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. AND SAYS ENOUGH FOR THE PAGE TO EXPLAIN ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('the refusal carries a reason, not just a number', () => {
  it('a batch with any skip says why those rows were left alone', async () => {
    world();
    const body = await (await bulk({
      action: 'status', ids: [SIGNED, DRAFT_A], status: 'draft',
    })).json();
    // Whatever wording it carries, it has to name the thing the user is looking
    // at. A page cannot write "1 skipped" and expect that to mean anything.
    expect(String(body.skippedReason ?? ''), 'no reason for the skip — the page has ' +
      'nothing to put in front of the user except a bare count')
      .toMatch(/sign|execut|contract/i);
  });

  it('and says nothing about skips when there were none', async () => {
    world();
    const body = await (await bulk({
      action: 'status', ids: [DRAFT_A], status: 'sent',
    })).json();
    expect(body.skipped).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE PAGE PUTS IT IN FRONT OF SOMEONE
// ═══════════════════════════════════════════════════════════════════════════

describe('app/proposals/page.tsx surfaces what the server declined', () => {
  const PAGE_PATH = join(__dirname, '..', 'app', 'proposals', 'page.tsx');
  const RAW       = readFileSync(PAGE_PATH, 'utf8');
  /** Literal values are being scanned for, so strings are KEPT and only comments
   *  removed — per tests/support/stripSource.ts, the identifier stripper would
   *  blank the very literals under test and every assertion would pass vacuously. */
  const PAGE      = stripComments(RAW);
  /** Brace counting must not trip over a `{` inside a string or a comment. Both
   *  strippers preserve byte offsets, so balancing on this and slicing from
   *  PAGE describes the same span. */
  const BARE      = stripCommentsAndStrings(RAW);

  /**
   * The body of `const <name> = async (…) => { … }`, ending at its own matching
   * brace.
   *
   * 🚨 Anchored on real syntax and balanced, never `slice(i, i + <n>)`: a fixed
   * window either clips the branch it is looking for or runs into the next
   * function, and `stripComments` turns comments into whitespace so a character
   * count does not even describe a stable amount of code.
   */
  function body(name: string): string {
    const start = PAGE.indexOf(`const ${name} = async`);
    expect(start, `${name} is gone from the page — this guard is scanning nothing`)
      .toBeGreaterThan(-1);
    const open = BARE.indexOf('{', BARE.indexOf('=>', start));
    expect(open).toBeGreaterThan(start);
    let depth = 0;
    for (let i = open; i < BARE.length; i++) {
      if (BARE[i] === '{') depth++;
      else if (BARE[i] === '}') {
        depth--;
        if (depth === 0) return PAGE.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces scanning ${name}`);
  }

  // ── refreshSnapshot ──────────────────────────────────────────────────────

  describe('refreshSnapshot', () => {
    const fn = () => body('refreshSnapshot');

    it('🚨 a refusal reaches the user instead of clearing the spinner in silence', () => {
      expect(fn(), 'the refresh button still fails silently — the installer sees no ' +
        'reaction at all when the server refuses').toMatch(/toast\.(error|warning)/);
    });

    it('and the 409 is handled as its own case, not lumped in with a network fault', () => {
      // A conflict is not a failure the user should retry; it is a decision they
      // need explained. `res.ok` alone cannot tell them apart.
      expect(fn()).toMatch(/\b409\b/);
    });

    it("it speaks the server's own sentence rather than inventing a generic one", () => {
      // The route says what it refused and why. A page that replaces that with
      // "Something went wrong" throws away the only useful part.
      expect(fn()).toMatch(/data\.error|\berror\b/);
    });

    it('the success path is unchanged — a refresh that works still reloads the list', () => {
      // POSITIVE CONTROL: adding a refusal branch must not cost the happy path.
      expect(fn()).toMatch(/data\.success/);
      expect(fn()).toMatch(/setProposals/);
    });
  });

  // ── bulkSetStatus ────────────────────────────────────────────────────────

  describe('bulkSetStatus', () => {
    const fn = () => body('bulkSetStatus');

    it('🚨 reads the response instead of discarding it', () => {
      expect(fn(), 'the response is still thrown away, so every selected row is ' +
        'painted whether the server moved it or not').toMatch(/await\s+res\.json\(\)/);
    });

    it('🚨 paints only the ids the server said it updated', () => {
      // THE REQUIREMENT, not one spelling of it: the set of rows repainted must
      // come FROM the server's answer. Any client-side re-derivation — guessing
      // from `p.status`, filtering out signed rows locally — is a second copy of
      // a rule that lives on the server and will drift from it.
      expect(fn(), 'the repaint is not driven by the ids the server reported')
        .toMatch(/updatedIds/);
    });

    it('and does not paint the whole selection unconditionally', () => {
      // The exact shape of the defect: `ids.includes(p.id) ? { ...p, status }`.
      // Pinned because it is the one thing that must not survive, and it would
      // survive perfectly well alongside a new toast.
      expect(fn(), 'the blanket repaint over every selected id is still there')
        .not.toMatch(/ids\.includes\(p\.id\)\s*\?\s*\{\s*\.\.\.p,\s*status\s*\}/);
    });

    it('🚨 tells the user when the server refused some of the selection', () => {
      expect(fn(), 'a skipped row is still invisible — the user believes the change landed')
        .toMatch(/toast\.(warning|error|info)/);
    });

    it('still clears the selection and closes the menu on the ordinary path', () => {
      // POSITIVE CONTROL.
      expect(fn()).toMatch(/setSelectedIds/);
      expect(fn()).toMatch(/setBulkStatusOpen/);
    });
  });

  // ── updateStatus — the same hole on the single-row path ──────────────────
  //
  // 🚨 THIS HELPER NOW HAS NO CALLERS, AND IT IS GUARDED ANYWAY.
  //
  // `archiveProposal` was its only caller, and it has been repointed at the bulk
  // endpoint's `archive` action — the filing path, which does not try to rewrite
  // an executed contract's status and therefore does not collect a 409 for
  // archiving one. The helper is left in place, corrected.
  //
  // The precedent for guarding an unreferenced path is
  // tests/stageEntryIsNotAnOutcome.test.ts: /api/projects/transition also has
  // zero callers, and the defect it carried would have shipped as a side effect
  // of the unrelated change that finally wired it up. A silent status write is
  // the same kind of landmine, and the next caller should inherit the checked
  // version rather than rediscover the other one.

  describe('updateStatus', () => {
    const fn = () => body('updateStatus');

    it('🚨 checks the response before repainting the row', () => {
      // PATCH /api/proposals/[id] answers 409 on an executed contract, and this
      // repainted the row whatever came back.
      expect(fn(), 'the single-row status write still repaints unconditionally')
        .toMatch(/res\.ok|res\.status|\.json\(\)/);
    });

    it('and says something when it is refused', () => {
      expect(fn()).toMatch(/toast\.(error|warning)/);
    });

    it('still repaints on success', () => {
      // POSITIVE CONTROL.
      expect(fn()).toMatch(/setProposals/);
    });

    it('and the row-level Archive no longer goes through it', () => {
      // Archiving is filing. Sending it down a status-mutation path is what made
      // the row action and the bulk action disagree about a signed proposal —
      // one refused it, the other filed it.
      const archive = body('archiveProposal');
      expect(archive, 'the row Archive still writes a status, so it is refused on ' +
        'an executed contract while the bulk Archive files it')
        .not.toMatch(/updateStatus\(/);
    });
  });

  // ── the idiom is the page's own ──────────────────────────────────────────

  it('no new notification mechanism was introduced', () => {
    // The page already has `useToast`. A second channel (window.alert, a bespoke
    // banner, console-only) would be a third way for the product to talk to the
    // user, and the other two would rot.
    expect(PAGE).toMatch(/useToast\(\)/);
    expect(PAGE, 'a browser alert was added — the page has a toast system').not.toMatch(/\balert\(/);
  });
});
