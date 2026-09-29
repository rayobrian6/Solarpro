// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THREE FIXES THAT WERE REPORTED AS SHIPPED AND WERE NOT.
//
// Phase 5's CRM lane built the receiving end — `lib/operations/stageChange.ts`
// `applyStageChange` — and handed off the two one-line caller changes. Nobody
// applied them. And the marketplace lane's brief named the Campaign Intel column
// but the file was never in its file set, so that stayed broken too. All three were
// counted as shipped in my own ledger. They are fixed here and the count corrected.
//
// 1. SIGNING A PROPOSAL DID NOT MOVE THE INSTALLER'S BOARD.
//    `app/api/proposals/[id]/sign/route.ts` ran
//        UPDATE projects SET stage = 'approved' WHERE ... AND stage IN (...)
//    and `projects.stage` DOES NOT EXIST — not in any migration, not in the inline
//    DDL. The statement raised `column "stage" does not exist`, a bare `catch {}`
//    swallowed it, and nothing happened. So a homeowner signs, and:
//      · project_status stays at its default 'lead' while the proposal view shows a
//        signed contract — a Lead on the pipeline and an executed contract in the
//        same product;
//      · contract_signed_at is never stamped;
//      · generateTasksForStage never runs;
//      · the two commands gated on `contract_signed` (schedule_install,
//        engineering_review) never appear.
//    With no error surfaced anywhere.
//
// 2. CREATING A PROPOSAL advanced only the legacy `status` column, so the project
//    rendered in the 'Lead' kanban column and in Pipeline Control's lead count while
//    the legacy sales list said 'Proposal' — two numbers for one deal on one
//    dashboard — and the "Follow up with <client>" command, which fires only on
//    `project_status === 'proposal_sent'`, was never generated for a real sent proposal.
//
// 3. CAMPAIGN INTEL was stuck on "Loading analytics…" forever, for every admin, on
//    every load. The geography block selected `network_opportunities.state`, a column
//    the canonical schema does not have, and the handler's SINGLE try/catch turned
//    one 42703 into a 500 for all six sections. Five working SQL blocks were invisible
//    because the sixth named a column that has never existed.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');

// ── The stage writer is the thing both callers must reach ────────────────────
const applied: Array<Record<string, unknown>> = [];
vi.mock('@/lib/operations/stageChange', () => ({
  applyStageChange: vi.fn(async (input: Record<string, unknown>) => {
    applied.push(input);
    return { prevStage: 'lead', newStage: input.toStage, activityId: 'act-1', tasksGenerated: 2 };
  }),
}));

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
  sendProposalToClientEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getDbReady } from '@/lib/db-neon';
import { applyStageChange } from '@/lib/operations/stageChange';

const PID = '11111111-2222-4333-8444-555555555555';
const PROJECT = '22222222-3333-4444-8555-666666666666';

/** Records every statement, and REFUSES any write to the non-existent column. */
function recordingSql(rowsFor: (text: string) => unknown[]) {
  const statements: string[] = [];
  const sql = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.join('?');
    statements.push(text);
    // What real PostgreSQL does with the old statement, so a regression cannot pass
    // by writing to a column the database does not have.
    if (/\bSET\s+stage\s*=/.test(text)) {
      return Promise.reject(Object.assign(new Error('column "stage" does not exist'), { code: '42703' }));
    }
    return Promise.resolve(rowsFor(text));
  };
  return { sql, statements };
}

describe('🚨 signing a proposal moves the installer\'s pipeline', () => {
  beforeEach(() => { applied.length = 0; vi.clearAllMocks(); });

  it('calls the ONE stage writer with contract_signed', async () => {
    const { sql, statements } = recordingSql((t) =>
      /FROM proposals/i.test(t)
        ? [{ id: PID, project_id: PROJECT, status: 'sent', data_json: {}, share_token: 'tok' }]
        // The signing write is conditional on the row still being unsigned and
        // answers RETURNING id; an unsigned row is affected.
        : /^\s*UPDATE proposals/i.test(t) ? [{ id: PID }]
        : []);
    (getDbReady as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sql);

    const { POST } = await import('@/app/api/proposals/[id]/sign/route');
    await POST(
      new Request(`http://localhost/api/proposals/${PID}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signerName: 'A Homeowner', token: 'tok', agreedToTerms: true }),
      }) as never,
      { params: Promise.resolve({ id: PID }) } as never,
    );

    expect(applied.length, 'the signature never reached the stage writer').toBeGreaterThan(0);
    expect(applied[0].toStage).toBe('contract_signed');
    expect(applied[0].projectId).toBe(PROJECT);
    expect(applied[0].source).toBe('proposal_signature');

    // And the doomed statement is gone entirely.
    expect(statements.some((s) => /\bSET\s+stage\s*=/.test(s)),
      'the route still writes projects.stage, a column that does not exist').toBe(false);
  });

  it('a stage-write failure does NOT lose the signature', async () => {
    const { sql } = recordingSql((t) =>
      /FROM proposals/i.test(t)
        ? [{ id: PID, project_id: PROJECT, status: 'sent', data_json: {}, share_token: 'tok' }]
        : []);
    (getDbReady as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sql);
    (applyStageChange as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('pipeline exploded'));

    const { POST } = await import('@/app/api/proposals/[id]/sign/route');
    const res = await POST(
      new Request(`http://localhost/api/proposals/${PID}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signerName: 'A Homeowner', token: 'tok', agreedToTerms: true }),
      }) as never,
      { params: Promise.resolve({ id: PID }) } as never,
    );
    // A signature is the highest-stakes write in the product. It must survive a
    // pipeline failure — but the failure must be logged, not swallowed silently.
    expect(res.status, 'a stage-write failure destroyed the signature').toBeLessThan(500);
  });
});

describe('🚨 creating a proposal advances the pipeline, not just the legacy column', () => {
  beforeEach(() => { applied.length = 0; vi.clearAllMocks(); });

  it('the legacy-only UPDATE is gone from the source', () => {
    // SOURCE SCAN, stated plainly: POST /api/proposals needs a full project snapshot,
    // a layout, a production record and a pricing config to reach its stage write, and
    // building all of that would test the fixture rather than the statement. The
    // behavioural half of this pair is the sign route above, which shares the writer.
    // Comment-stripped, because the repair's own comment quotes the statement it removed.
    const src = stripComments(readFileSync(join(ROOT, 'app', 'api', 'proposals', 'route.ts'), 'utf8'));
    expect(src, 'proposal creation still writes only the legacy status column')
      .not.toMatch(/UPDATE\s+projects\s+SET\s+status\s*=\s*'proposal'/);
    expect(src, 'proposal creation does not reach the one stage writer')
      .toMatch(/applyStageChange\(/);
    expect(src).toMatch(/toStage:\s*'proposal_sent'/);
  });
});

describe('🚨 Campaign Intel is not stuck on a column that has never existed', () => {
  it('the geography block asks for the canonical column', () => {
    const src = stripComments(readFileSync(
      join(ROOT, 'app', 'api', 'admin', 'network', 'analytics', 'route.ts'), 'utf8'));
    // SOURCE SCAN: the discriminating behavioural version needs the governed migration
    // chain in PGlite, which tests/marketplaceReleaseGateIsUnreachable.test.ts already
    // builds and exercises for the sibling routes. This asserts the column name and the
    // isolation; the phantom-column class itself is proven behaviourally there.
    expect(src, 'the analytics geography block still selects the phantom no.state')
      .not.toMatch(/\bno\.state\b/);
    expect(src).toMatch(/no\.location_state\s+AS\s+state/);
  });

  it('🚨 one failing section can no longer black out the other five', () => {
    const src = stripComments(readFileSync(
      join(ROOT, 'app', 'api', 'admin', 'network', 'analytics', 'route.ts'), 'utf8'));
    // The structural half. A single try/catch around all six sections is what turned
    // one 42703 into a permanent spinner over five working panels.
    expect(src, 'there is no per-section isolation').toMatch(/runSection\s*=/);
    for (const name of ['funnel', 'sources', 'campaigns', 'geography', 'quality', 'trend']) {
      expect(src, `section '${name}' is not isolated`).toMatch(
        new RegExp(`runSection\\('${name}'`));
    }
    // And a failure must be REPORTED, not silently rendered as "no data" — an outage
    // shown as an all-clear is the defect class this whole audit kept finding.
    expect(src, 'a failed section is not reported to the page').toMatch(/sectionErrors/);
  });
});
