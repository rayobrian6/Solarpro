/**
 * tests/stageChangeLeavesATrace.postgres.test.ts
 *
 * "WHO MOVED THIS TO PERMIT APPROVED, AND WHEN" WAS UNANSWERABLE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MEASURES
 * ─────────────────────────────────────────────────────────────────────────────
 * Five surfaces change a project's pipeline stage and all five call
 * `POST /api/projects/update-status`. That route wrote `projects.project_status`
 * and the legacy `projects.status` and stopped — no `project_activity` row. Two
 * of the five callers wrote a row of their own; three did not; and the one that
 * did for engineering moves invented its `from_stage` as the literal
 * `'contract_signed'` whatever stage the project was actually in.
 *
 * So for the MAJORITY of transitions in the product the admin project timeline
 * showed nothing at all, and where it showed something the "from" was fiction.
 *
 * This file also covers the two defects on the proposal side, from the receiving
 * end. `app/api/proposals/**` belongs to another agent right now, so nothing here
 * calls those routes: instead it (a) proves against the real schema that the SQL
 * they ship today CANNOT work, and (b) proves the helper they need to call
 * instead does work. The one-line change each route needs is reported as a
 * handoff, not made here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Is there a row?" and "does `projects.stage` exist?" are questions about
 * PostgreSQL, and the second one is the entire C5 defect: the proposal signature
 * route's `UPDATE projects SET stage = 'approved'` is swallowed by a bare catch,
 * so from inside the application it is indistinguishable from success. Only a
 * real database can say which it is. PGlite is PostgreSQL 16 in-process — no
 * daemon, no credentials, nothing migrated anywhere.
 *
 * SCHEMA PROVENANCE, stated because a hand-built fixture can accuse the product
 * of the fixture's own fault: `users` / `projects` come from the real
 * `lib/migrations` files; `homeowner_stage` and the micro-stage tables from the
 * real (unscanned) `migrations/` files; and `projects.project_status`,
 * `project_activity` and `project_tasks` are EXTRACTED FROM THE SHIPPED DDL in
 * `app/api/migrate/route.ts`, which is the only place in the repo that creates
 * them — and is locked behind MIGRATION-GOV-13, which is a separate open
 * campaign and not this file's subject. Nothing here is retyped by hand.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,…) text.
 *  The only translation in this file — everything it feeds is production code.
 *  Same shim as tests/stageSchemaReachability.postgres.test.ts. */
function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') {
      const r = await pg.query(strings, (values[0] as unknown[]) ?? []);
      return r.rows;
    }
    let text = '';
    const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    const r = await pg.query(text, params);
    return r.rows;
  }) as unknown as never;
}

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Test', email: 't@e.st', company: 'T' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

// ── The shipped DDL, extracted rather than retyped ───────────────────────────

const MIGRATE_ROUTE = read('app', 'api', 'migrate', 'route.ts');

/** The `CREATE TABLE IF NOT EXISTS <table> ( … )` shipped in the migrate route. */
function inlineTableDdl(table: string): string {
  const at = MIGRATE_ROUTE.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (at < 0) {
    throw new Error(
      `app/api/migrate/route.ts no longer creates ${table}. It was the ONLY place ` +
      `in the repo that did; find the new home before trusting this fixture.`);
  }
  let depth = 0;
  const open = MIGRATE_ROUTE.indexOf('(', at);
  for (let j = open; j < MIGRATE_ROUTE.length; j++) {
    if (MIGRATE_ROUTE[j] === '(') depth++;
    else if (MIGRATE_ROUTE[j] === ')') {
      depth--;
      if (depth === 0) return MIGRATE_ROUTE.slice(at, j + 1);
    }
  }
  throw new Error(`unbalanced DDL for ${table}`);
}

/** Every `ALTER TABLE projects ADD COLUMN IF NOT EXISTS …` the route ships. */
function inlineProjectColumns(): string[] {
  return [...MIGRATE_ROUTE.matchAll(
    /ALTER TABLE projects ADD COLUMN IF NOT EXISTS [^`]+?(?=`)/g)]
    .map(m => m[0].trim());
}

/** CONCURRENTLY cannot run inside PGlite's implicit transaction; an index changes
 *  speed, not answers. Same accommodation as lib/dev/pgliteNeonBridge.ts. */
const noConcurrently = (sql: string) => sql.replace(/CONCURRENTLY/gi, '');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });

  // Base schema, from the real migration files.
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(noConcurrently(read('lib', 'migrations', '006_users_subscriptions_whitelabel.sql')));
  // The customer-facing half, from the directory the runner does not scan.
  for (const f of ['019_homeowner_stage.sql', '021_micro_stages.sql', '022_micro_stages_unique.sql']) {
    await db.exec(noConcurrently(read('migrations', f)));
  }
  // The ops pipeline, from the locked inline DDL.
  for (const stmt of inlineProjectColumns()) await db.exec(stmt);
  await db.exec(inlineTableDdl('project_tasks'));
  await db.exec(inlineTableDdl('project_activity'));

  await db.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1, 'Test', 't@e.st', 'x'), ($2, 'Other', 'o@e.st', 'x')
     ON CONFLICT (id) DO NOTHING`, [USER_ID, OTHER_USER]);
}, 180_000);

afterAll(async () => { await db?.close(); });

/** Put the project back in a known state before each test. */
async function seedProject(stage = 'lead'): Promise<void> {
  await db.query(`DELETE FROM project_activity WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM project_tasks WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM project_micro_stages WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM project_homeowner_stage_history WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM projects WHERE id = $1`, [PROJECT]);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, system_type, status, project_status,
                           homeowner_stage, created_at, updated_at)
     VALUES ($1, $2, 'BRAIDON M PILLA — Solar', '3 Melvin Drive, Granite City, IL 62040',
             'roof', 'lead', $3, 'lead_submitted', NOW(), NOW())`,
    [PROJECT, USER_ID, stage]);
}

beforeEach(async () => { await seedProject(); });

interface ActivityRow {
  type: string;
  title: string;
  user_id: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: string;
}

async function activityRows(): Promise<Array<ActivityRow & { meta: Record<string, unknown> }>> {
  const r = await db.query<ActivityRow>(
    `SELECT type, title, user_id, metadata, created_at
       FROM project_activity WHERE project_id = $1 ORDER BY created_at ASC`, [PROJECT]);
  return r.rows.map(row => ({
    ...row,
    meta: (typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata ?? {})) as Record<string, unknown>,
  }));
}

async function projectRow(): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT * FROM projects WHERE id = $1`, [PROJECT]);
  return (r.rows[0] ?? {}) as Record<string, unknown>;
}

/** Call the route every stage-change surface in the product calls. */
async function callUpdateStatus(status: string) {
  const { POST } = await import('@/app/api/projects/update-status/route');
  const res = await POST(new Request('http://localhost/api/projects/update-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT, status }),
  }) as never);
  return { status: res.status, body: await res.json() as Record<string, any> };
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════

describe('the fixture is the real schema', () => {
  it('projects has the ops pipeline columns and the audit tables exist', async () => {
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='projects'`);
    const set = new Set(cols.rows.map(r => r.column_name));
    for (const c of ['status', 'project_status', 'contract_signed_at', 'install_date', 'homeowner_stage']) {
      expect(set.has(c), `projects.${c} missing from the fixture`).toBe(true);
    }
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const t = new Set(tables.rows.map(r => r.table_name));
    for (const name of ['project_activity', 'project_tasks', 'project_micro_stages']) {
      expect(t.has(name), `${name} missing from the fixture`).toBe(true);
    }
  });

  it('🚨 and `projects.stage` does NOT exist — the column C5 writes to', async () => {
    // Not "is unused". Does not exist. Everything in §3 depends on this.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='projects' AND column_name='stage'`);
    expect(cols.rows.length,
      'projects.stage now exists — the C5 finding has changed, re-read it').toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. C1 — THE AUDIT ROW
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 C1: a stage change through the live route leaves a trace', () => {
  it('writes exactly one project_activity row', async () => {
    // BEFORE THE REPAIR: zero rows. The admin project timeline was blank for
    // every move made through the DealDecisionModal — documented at its own
    // line 3-7 and at app/dashboard/page.tsx as "the single decision surface
    // for all stage transitions" — and through the project page's Pipeline
    // Status dropdown.
    expect((await activityRows()).length).toBe(0);
    const { status, body } = await callUpdateStatus('permit_submitted');
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);

    const rows = await activityRows();
    expect(rows.length, 'the stage change left no trace').toBe(1);
    expect(rows[0].type).toBe('stage_change');
    expect(rows[0].title).toMatch(/Permit Submitted/);
    expect(rows[0].user_id, 'the row does not say WHO').toBe(USER_ID);
    expect(rows[0].created_at, 'the row does not say WHEN').toBeTruthy();
  });

  it('🚨 and `from_stage` is READ from the row, never asserted', async () => {
    // THE DANGEROUS HALF. components/commands/EngineeringReviewModal.tsx logs
    // `metadata: { from_stage: 'contract_signed', to_stage: 'engineering' }` — a
    // literal. A project moved into engineering from permit_submitted, or from
    // lead, or from anywhere, recorded a transition that never happened. A
    // fabricated provenance is worse than a missing one because it reads as
    // evidence.
    await db.query(`UPDATE projects SET project_status = 'engineering' WHERE id = $1`, [PROJECT]);
    await callUpdateStatus('permit_submitted');

    const [row] = await activityRows();
    expect(row.meta.from_stage,
      'from_stage does not match the stage the project was actually in')
      .toBe('engineering');
    expect(row.meta.to_stage).toBe('permit_submitted');
    expect(row.meta.source).toBe('update-status');
  });

  it('records a from_stage of `lead` for a project that has never moved', async () => {
    // The degenerate case a literal would also get wrong.
    await callUpdateStatus('site_assessment');
    const [row] = await activityRows();
    expect(row.meta.from_stage).toBe('lead');
  });

  it('a same-stage confirm is recorded as a confirm, not as a move', async () => {
    await db.query(`UPDATE projects SET project_status = 'engineering' WHERE id = $1`, [PROJECT]);
    await callUpdateStatus('engineering');
    const [row] = await activityRows();
    expect(row.meta.from_stage).toBe('engineering');
    expect(row.meta.to_stage).toBe('engineering');
    expect(row.title).toMatch(/confirmed/i);
  });

  it('the response says whether the row landed, so a caller need not assume', async () => {
    const { body } = await callUpdateStatus('engineering');
    expect(body.data.prevStage).toBe('lead');
    expect(body.data.newStage).toBe('engineering');
    expect(body.data.activityId, 'activityId is null — the audit row did not land').toBeTruthy();
  });

  it('and the stage itself still moves, on both columns', async () => {
    await callUpdateStatus('permit_approved');
    const p = await projectRow();
    expect(p.project_status).toBe('permit_approved');
    expect(p.status, 'the legacy column went stale').toBe('approved');
  });

  it('an unauthorised caller changes nothing and logs nothing', async () => {
    await db.query(`UPDATE projects SET user_id = $1 WHERE id = $2`, [OTHER_USER, PROJECT]);
    try {
      const { status } = await callUpdateStatus('permit_approved');
      expect(status).toBe(403);
      expect((await activityRows()).length).toBe(0);
      expect((await projectRow()).project_status).toBe('lead');
    } finally {
      await db.query(`UPDATE projects SET user_id = $1 WHERE id = $2`, [USER_ID, PROJECT]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. C4 — THE CLOCK, AGAINST A DATABASE THAT UNRELATED WRITERS TOUCH
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 C4: days-in-stage survives an unrelated write', () => {
  it('the recorded stage change is what the clock reads, and updated_at is not', async () => {
    const { LAST_STAGE_CHANGE_SQL, resolveStageAge } =
      await import('@/lib/operations/stageClock');

    // Move to permit_submitted, then backdate the audit row 30 days: the project
    // has been sitting with the AHJ for a month.
    await callUpdateStatus('permit_submitted');
    await db.query(
      `UPDATE project_activity SET created_at = NOW() - INTERVAL '30 days'
        WHERE project_id = $1`, [PROJECT]);

    // Now ANY unrelated writer touches the row. This is the whole defect: saving
    // a layout, editing a note, uploading a bill, or the backfill in
    // /api/operations/projects all do exactly this.
    await db.query(`UPDATE projects SET notes = 'called the homeowner', updated_at = NOW()
                     WHERE id = $1`, [PROJECT]);

    const r = await db.query<{ project_id: string; last_stage_change_at: string }>(
      LAST_STAGE_CHANGE_SQL, [[PROJECT]]);
    expect(r.rows.length, 'no stage-change record was found for a project that just moved').toBe(1);

    const p = await projectRow();
    const age = resolveStageAge({
      last_stage_change_at: r.rows[0].last_stage_change_at,
      updated_at: p.updated_at as string,
    });
    expect(age.basis).toBe('stage_change');
    expect(age.measuresStage).toBe(true);
    expect(age.days, 'the clock was reset by a note edit').toBeGreaterThanOrEqual(29);

    // And the number the product used to show, for contrast.
    const naive = resolveStageAge({ updated_at: p.updated_at as string });
    expect(naive.days, 'updated_at should have been reset — the fixture is wrong').toBe(0);
    expect(naive.measuresStage,
      'an updated_at number must never claim to measure the stage').toBe(false);
  });

  it('the reader matches a deal-decision row too, not only type = stage_change', async () => {
    // The transition route classifies some moves as 'follow_up' / 'schedule' /
    // 'note' via DEAL_TRANSITIONS.activityType while still recording
    // metadata.to_stage. A reader keyed only on the type would report those
    // projects as having never changed stage.
    const { LAST_STAGE_CHANGE_SQL } = await import('@/lib/operations/stageClock');
    await db.query(
      `INSERT INTO project_activity (project_id, user_id, type, title, metadata)
       VALUES ($1, $2, 'follow_up', 'Followed up', $3::jsonb)`,
      [PROJECT, USER_ID, JSON.stringify({ from_stage: 'proposal_sent', to_stage: 'proposal_sent' })]);
    const r = await db.query(LAST_STAGE_CHANGE_SQL, [[PROJECT]]);
    expect(r.rows.length).toBe(1);
  });

  it('a row that is not about a stage is ignored', async () => {
    const { LAST_STAGE_CHANGE_SQL } = await import('@/lib/operations/stageClock');
    await db.query(
      `INSERT INTO project_activity (project_id, user_id, type, title, metadata)
       VALUES ($1, $2, 'note', 'Uploaded a bill', $3::jsonb)`,
      [PROJECT, USER_ID, JSON.stringify({ file: 'bill.pdf' })]);
    const r = await db.query(LAST_STAGE_CHANGE_SQL, [[PROJECT]]);
    expect(r.rows.length, 'a plain note was counted as a stage change').toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. C5 — THE SIGNATURE THAT MOVED NOTHING
// ═══════════════════════════════════════════════════════════════════════════
//
// `app/api/proposals/[id]/sign/route.ts` is another agent's file. It is READ
// here and never called. What is tested is (a) that its SQL cannot work, against
// the real schema, and (b) that the helper it should call instead does.

describe('🚨 C5: the proposal signature writes a column that does not exist', () => {
  it('the shipped statement raises `column "stage" does not exist`', async () => {
    // Verbatim shape from app/api/proposals/[id]/sign/route.ts. Its caller wraps
    // it in a bare `catch {}` commented "Stage advancement is best-effort", so
    // from inside the application this is indistinguishable from success: the
    // installer sees a signed contract in the proposal view and a Lead on the
    // pipeline, with no error anywhere.
    const src = read('app', 'api', 'proposals', '[id]', 'sign', 'route.ts');
    expect(src, 'the sign route no longer writes projects.stage — re-read C5')
      .toMatch(/UPDATE projects\s*\n?\s*SET stage = 'approved'/);

    await expect(db.query(
      `UPDATE projects SET stage = 'approved', updated_at = NOW()
        WHERE id = $1 AND stage IN ('lead','design','proposal')`, [PROJECT]),
    ).rejects.toThrow(/column "stage" does not exist/i);

    // And the consequence, measured: nothing moved.
    const p = await projectRow();
    expect(p.project_status).toBe('lead');
    expect(p.contract_signed_at).toBeNull();
  });

  it('the helper the route should call performs the whole transition', async () => {
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const res = await applyStageChange({
      projectId: PROJECT,
      toStage: 'contract_signed',
      userId: USER_ID,
      source: 'proposal_signature',
    });

    const p = await projectRow();
    expect(p.project_status, 'the installer board still shows a Lead').toBe('contract_signed');
    expect(p.status).toBe('approved');
    expect(p.contract_signed_at, 'contract_signed_at was never stamped').not.toBeNull();

    // generateTasksForStage ran — the thing that never ran because the stage
    // never changed.
    expect(res.tasksGenerated).toBeGreaterThan(0);
    const tasks = await db.query(
      `SELECT id FROM project_tasks WHERE project_id = $1 AND stage = 'contract_signed'`,
      [PROJECT]);
    expect(tasks.rows.length).toBeGreaterThan(0);

    const [row] = await activityRows();
    expect(row.meta.from_stage).toBe('lead');
    expect(row.meta.to_stage).toBe('contract_signed');
    expect(row.meta.source).toBe('proposal_signature');
  });

  it('and THEN the two gated commands can be generated at all', async () => {
    // lib/commands/generateActions.ts rules 2 and 3 fire only for
    // `stage === 'contract_signed'`. While the signature moved nothing they
    // could never fire for a signed deal: no schedule_install, no
    // engineering_review, for any customer who signed.
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const { generateActionsForProject } = await import('@/lib/commands/generateActions');

    const before = generateActionsForProject({
      id: PROJECT, name: 'Braidon', project_status: 'lead', status: 'lead',
      updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    });
    expect(before.map(a => a.type)).not.toContain('schedule_install');
    expect(before.map(a => a.type)).not.toContain('engineering_review');

    await applyStageChange({
      projectId: PROJECT, toStage: 'contract_signed', userId: USER_ID,
      source: 'proposal_signature',
    });
    const p = await projectRow();

    const after = generateActionsForProject({
      id: PROJECT, name: 'Braidon',
      project_status: p.project_status as string, status: p.status as string,
      updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      last_stage_change_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    });
    expect(after.map(a => a.type)).toContain('schedule_install');
    expect(after.map(a => a.type)).toContain('engineering_review');
  });

  it('a second confirm does not re-date the signature', async () => {
    // A signature date is a legal fact. Re-entering the stage must not move it.
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    await applyStageChange({
      projectId: PROJECT, toStage: 'contract_signed', userId: USER_ID, source: 'proposal_signature',
    });
    const first = (await projectRow()).contract_signed_at;
    await db.query(
      `UPDATE projects SET contract_signed_at = NOW() - INTERVAL '10 days' WHERE id = $1`,
      [PROJECT]);
    const backdated = (await projectRow()).contract_signed_at;
    await applyStageChange({
      projectId: PROJECT, toStage: 'contract_signed', userId: USER_ID, source: 'update-status',
    });
    expect((await projectRow()).contract_signed_at).toEqual(backdated);
    expect(first).not.toEqual(backdated); // the fixture really did change it
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. C6 — TWO NUMBERS FOR ONE DEAL
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 C6: creating a proposal advances only the legacy column', () => {
  it('the shipped statement leaves project_status at lead', async () => {
    // Verbatim from app/api/proposals/route.ts. It succeeds — there is no error
    // to catch — and that is the problem: the deal renders in the 'Lead' kanban
    // column and in Pipeline Control's lead count while the legacy sales list
    // shows 'Proposal'. Two numbers for the same deal on one dashboard.
    const src = read('app', 'api', 'proposals', 'route.ts');
    expect(src, 'the create route no longer writes only `status` — re-read C6')
      .toMatch(/UPDATE projects SET status = 'proposal'/);

    await db.query(
      `UPDATE projects SET status = 'proposal', updated_at = NOW()
        WHERE id = $1 AND user_id = $2`, [PROJECT, USER_ID]);

    const p = await projectRow();
    expect(p.status).toBe('proposal');
    expect(p.project_status, 'project_status moved — the finding has changed').toBe('lead');
  });

  it('and the follow-up nag is therefore never generated', async () => {
    const { generateActionsForProject } = await import('@/lib/commands/generateActions');
    await db.query(
      `UPDATE projects SET status = 'proposal' WHERE id = $1`, [PROJECT]);
    const p = await projectRow();
    const stale = new Date(Date.now() - 9 * 86400000).toISOString();

    // Rule 1 keys on `project_status === 'proposal_sent'`. With project_status
    // still 'lead' it cannot fire; the legacy fallback block fires only when
    // `stage` is a legacy value, and `project_status` takes precedence.
    const actions = generateActionsForProject({
      id: PROJECT, name: 'Braidon',
      project_status: p.project_status as string, status: p.status as string,
      updated_at: stale, last_stage_change_at: stale,
    });
    expect(actions.some(a => a.title.startsWith('Follow up with')),
      'a real sent proposal produced a follow-up despite project_status = lead')
      .toBe(false);
  });

  it('the helper the route should call moves both columns, and the nag appears', async () => {
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const { generateActionsForProject } = await import('@/lib/commands/generateActions');

    await applyStageChange({
      projectId: PROJECT, toStage: 'proposal_sent', userId: USER_ID,
      source: 'proposal_created',
    });
    const p = await projectRow();
    expect(p.project_status).toBe('proposal_sent');
    expect(p.status, 'the legacy column must stay in sync, not be abandoned').toBe('proposal');

    const stale = new Date(Date.now() - 9 * 86400000).toISOString();
    const actions = generateActionsForProject({
      id: PROJECT, name: 'Braidon',
      project_status: p.project_status as string, status: p.status as string,
      updated_at: stale, last_stage_change_at: stale,
    });
    const followUp = actions.find(a => a.title.startsWith('Follow up with'));
    expect(followUp, 'no follow-up for a proposal sent 9 days ago').toBeDefined();
    expect(followUp!.priority).toBe('critical');
    // 🚨 And the label is an event claim only because the clock earned it.
    expect(followUp!.description).toMatch(/Proposal sent 9d ago with no response/);

    const [row] = await activityRows();
    expect(row.meta.to_stage).toBe('proposal_sent');
    expect(row.meta.source).toBe('proposal_created');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE CUSTOMER-FACING HALF IS UNCHANGED
// ═══════════════════════════════════════════════════════════════════════════
//
// The repair moved the column writes, the audit row and the task generation into
// a shared writer. It must not have moved — or double-fired — the homeowner
// sync, whose correctness is a per-stage judgement guarded elsewhere.

describe('the homeowner stage still advances exactly once', () => {
  it('one micro-stage row for one move, and the homeowner stage follows', async () => {
    await callUpdateStatus('contract_signed');
    const micro = await db.query<{ micro_stage: string }>(
      `SELECT micro_stage FROM project_micro_stages WHERE project_id = $1`, [PROJECT]);
    expect(micro.rows.map(r => r.micro_stage)).toEqual(['contract_signed']);
    const p = await projectRow();
    expect(p.homeowner_stage).not.toBe('lead_submitted');
  });

  it('🚨 and entering `inspection` still records NOTHING for the customer', async () => {
    // The single most important invariant in this lane: a stage ENTRY is not the
    // stage's OUTCOME. Guarded by tests/stageEntryIsNotAnOutcome.test.ts and
    // re-measured here end-to-end, because the repair touched this route.
    await db.query(`UPDATE projects SET project_status = 'installation' WHERE id = $1`, [PROJECT]);
    await callUpdateStatus('inspection');
    const micro = await db.query(
      `SELECT micro_stage FROM project_micro_stages WHERE project_id = $1`, [PROJECT]);
    expect(micro.rows.length,
      'entering inspection told the customer something — it must tell them nothing')
      .toBe(0);
    // But the INTERNAL trace exists, which is the point of C1.
    const rows = await activityRows();
    expect(rows.length).toBe(1);
    expect(rows[0].meta.to_stage).toBe('inspection');
    expect(rows[0].meta.from_stage).toBe('installation');
  });
});
