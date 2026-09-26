/**
 * tests/stageClockCannotBeBackfilled.postgres.test.ts
 *
 * IS `project_activity` A COMPLETE-ENOUGH RECORD TO DERIVE A FIRST VALUE FOR
 * `projects.stage_changed_at`? NO — AND THE GAP IS THE MOST IMPORTANT STAGE
 * IN THE PIPELINE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * NEEDS-RAY R12 records that the stall clock has no column and is derived from
 * `project_activity` in the meantime — "correct for every stage change from here
 * on and silent about history" — and that it must NOT be backfilled from
 * `updated_at`. That much is settled. The open question is the one this file
 * answers: for the rows that ARE in `project_activity`, could a migration derive
 * a real first value?
 *
 * It cannot, and there are three independent reasons. §1 and §2 are the two the
 * repo already implies. §3 is the one that was not known:
 *
 * 🚨 `project_activity.user_id` IS `UUID NOT NULL`, AND THE HOMEOWNER-SIGNATURE
 * STAGE CHANGE PASSES `userId: null`.
 *
 * `app/api/proposals/[id]/sign/route.ts` calls `applyStageChange` with
 * `userId: null` (a homeowner is not a user of this product). The INSERT violates
 * NOT NULL, `applyStageChange` catches it and returns `activityId: null`, and the
 * caller's own try/catch is never even reached. So `contract_signed` — the one
 * transition with legal weight, the one that gates `schedule_install` and
 * `engineering_review` — records NO activity row when the homeowner signs.
 *
 * A backfill from `project_activity` would therefore hand a confident
 * `stage_changed_at` to every project EXCEPT the signed ones, and leave the
 * signed ones reading as though they had never moved. That is worse than a
 * uniform "unknown", because it is silently non-uniform.
 *
 * 🚨 WHY THE EXISTING SUITE DOES NOT SEE THIS.
 * `tests/stageChangeLeavesATrace.postgres.test.ts` builds the same table from the
 * same shipped DDL, but every one of its `applyStageChange` calls passes
 * `userId: USER_ID`. The system-initiated path — the only one the sign route
 * uses — is never exercised, so the suite is green and blind. §4 shows the same
 * call with a real user id succeeding against the same database, which is what
 * makes §3 a finding about the NULL rather than about the fixture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Does the INSERT fail, and is the failure swallowed?" is a PostgreSQL question
 * plus a control-flow question. A mocked `sql` cannot refuse a NULL. PGlite is
 * PostgreSQL 16 in-process — no daemon, no credential, nothing run against any
 * real database, and no migration written or modified.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { discoverMigrationFiles } from '@/lib/migrations/manifest';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

let db: PGlite;

/** Same Neon-shaped shim as tests/stageChangeLeavesATrace.postgres.test.ts. */
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

// ── The shipped DDL, extracted rather than retyped ───────────────────────────

const MIGRATE_ROUTE = read('app', 'api', 'migrate', 'route.ts');

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

function inlineProjectColumns(): string[] {
  return [...MIGRATE_ROUTE.matchAll(
    /ALTER TABLE projects ADD COLUMN IF NOT EXISTS [^`]+?(?=`)/g)]
    .map(m => m[0].trim());
}

const noConcurrently = (sql: string) => sql.replace(/CONCURRENTLY/gi, '');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(noConcurrently(read('lib', 'migrations', '006_users_subscriptions_whitelabel.sql')));
  for (const stmt of inlineProjectColumns()) await db.exec(stmt);
  await db.exec(inlineTableDdl('project_tasks'));
  await db.exec(inlineTableDdl('project_activity'));
  await db.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1,'Test','t@e.st','x') ON CONFLICT (id) DO NOTHING`, [USER_ID]);
}, 300_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.query(`DELETE FROM project_activity WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM project_tasks    WHERE project_id = $1`, [PROJECT]);
  await db.query(`DELETE FROM projects         WHERE id = $1`, [PROJECT]);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, system_type, status, project_status,
                           created_at, updated_at)
     VALUES ($1,$2,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL 62040',
             'roof','lead','lead', NOW(), NOW())`, [PROJECT, USER_ID]);
});

const activityRows = async () => (await db.query<{ type: string; user_id: string | null }>(
  `SELECT type, user_id FROM project_activity WHERE project_id = $1`, [PROJECT])).rows;

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE TABLE IS CREATED BY NO MIGRATION THE RUNNER CAN REACH
// ═══════════════════════════════════════════════════════════════════════════
//
// The first reason a backfill cannot live in a migration: the relation it would
// read is not in the scanned schema at all, so the file would raise
// `relation "project_activity" does not exist` — and the batch runner HALTS on
// the first failure, taking every later migration with it.

describe('project_activity is not in any migration', () => {
  it('🚨 NO scanned migration creates it — only the locked inline DDL does', () => {
    const offenders = discoverMigrationFiles().files
      .filter(f => /CREATE TABLE[^;]*project_activity/i.test(readFileSync(f.fullPath, 'utf8')))
      .map(f => f.filename);
    expect(offenders,
      'a scanned migration now creates project_activity — a backfill may be ' +
      'reconsiderable and this file must be re-read').toEqual([]);
    // And the one place that does create it is the route locked behind
    // MIGRATION-GOV-13.
    expect(MIGRATE_ROUTE).toContain('CREATE TABLE IF NOT EXISTS project_activity (');
  });

  it('nor is `project_status`, so the stage itself is outside the scanned schema too', () => {
    const scanned = discoverMigrationFiles().files
      .filter(f => /ADD COLUMN IF NOT EXISTS project_status/i.test(readFileSync(f.fullPath, 'utf8')));
    expect(scanned.map(f => f.filename)).toEqual([]);
    expect(MIGRATE_ROUTE).toMatch(/ADD COLUMN IF NOT EXISTS project_status/);
  });

  it('so a migration reading it raises a real PostgreSQL error naming the relation', async () => {
    // Exactly the statement a backfill would issue, against a database built
    // from the scanned set — here, one that HAS the table, minus it.
    const bare = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await bare.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
      await expect(bare.query(
        `UPDATE projects SET updated_at = a.t FROM (
           SELECT project_id, MAX(created_at) AS t FROM project_activity GROUP BY project_id
         ) a WHERE projects.id = a.project_id`),
      ).rejects.toThrow(/project_activity/);
    } finally { await bare.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE AUDIT ROW IS NON-FATAL BY DESIGN, SO ABSENCE IS NOT EVIDENCE
// ═══════════════════════════════════════════════════════════════════════════

describe('the activity write is non-fatal', () => {
  it('a stage change still SUCCEEDS when the activity table is missing entirely', async () => {
    const bare = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    const outer = db;
    try {
      await bare.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
      await bare.exec(noConcurrently(read('lib', 'migrations', '006_users_subscriptions_whitelabel.sql')));
      for (const stmt of inlineProjectColumns()) await bare.exec(stmt);
      await bare.query(
        `INSERT INTO users (id, name, email, password_hash) VALUES ($1,'T','t@e.st','x')`, [USER_ID]);
      await bare.query(
        `INSERT INTO projects (id, user_id, name, address, system_type, status, project_status)
         VALUES ($1,$2,'P','A','roof','lead','lead')`, [PROJECT, USER_ID]);

      db = bare; // the mocked getDbReady reads this binding
      const { applyStageChange } = await import('@/lib/operations/stageChange');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let res;
      try {
        res = await applyStageChange({
          projectId: PROJECT, toStage: 'permit_submitted', userId: USER_ID, source: 'update-status',
        });
      } finally { spy.mockRestore(); }

      // The columns moved; the audit row did not exist to be written.
      expect(res.toStage).toBe('permit_submitted');
      expect(res.activityId).toBeNull();
    } finally { db = outer; await bare.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 🚨 THE HOMEOWNER SIGNATURE — user_id IS NOT NULL AND THE CALLER PASSES NULL
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the contract_signed transition records nothing when the homeowner signs', () => {
  it('the shipped DDL declares user_id NOT NULL', async () => {
    const r = await db.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_name = 'project_activity' AND column_name = 'user_id'`);
    expect(r.rows[0]?.data_type).toBe('uuid');
    expect(r.rows[0]?.is_nullable,
      'user_id is now nullable — the signature path can record a row and this ' +
      'file must be re-read').toBe('NO');
  });

  it('and the sign route passes userId: null — read from the shipped source', () => {
    const src = read('app', 'api', 'proposals', '[id]', 'sign', 'route.ts');
    // The call, with its null actor, in one match so a reordering cannot fake it.
    expect(src).toMatch(
      /applyStageChange\(\{[\s\S]{0,200}?toStage:\s*'contract_signed'[\s\S]{0,200}?userId:\s*null/);
  });

  it('🚨 so the stage moves, the signature is stamped — and NO activity row exists', async () => {
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
    let res;
    try {
      // Exactly the arguments app/api/proposals/[id]/sign/route.ts passes.
      res = await applyStageChange({
        projectId: PROJECT,
        toStage: 'contract_signed',
        userId: null,
        source: 'proposal_signature',
        activityTitle: 'Proposal signed by homeowner',
      });
    } finally { spy.mockRestore(); }

    // The COLUMN writes succeeded — this is not a failed transition.
    const p = (await db.query<Record<string, unknown>>(
      `SELECT project_status, contract_signed_at FROM projects WHERE id = $1`, [PROJECT])).rows[0];
    expect(p.project_status).toBe('contract_signed');
    expect(p.contract_signed_at).not.toBeNull();

    // 🚨 And the audit row is simply absent, with the failure logged, not raised.
    expect(res.activityId).toBeNull();
    expect(await activityRows()).toEqual([]);
    expect(errors.join('\n')).toMatch(/\[applyStageChange\] ACTIVITY ROW NOT WRITTEN/);
    expect(errors.join('\n')).toMatch(/null value in column "user_id"|violates not-null/i);
  });

  it('🚨 so LAST_STAGE_CHANGE_SQL reports the signed project as having NEVER changed stage', async () => {
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await applyStageChange({
        projectId: PROJECT, toStage: 'contract_signed', userId: null,
        source: 'proposal_signature',
      });
    } finally { spy.mockRestore(); }

    const { LAST_STAGE_CHANGE_SQL, resolveStageAge } = await import('@/lib/operations/stageClock');
    const derived = await db.query<{ last_stage_change_at: string }>(
      LAST_STAGE_CHANGE_SQL.replace('$1::uuid[]', `ARRAY['${PROJECT}']::uuid[]`));
    expect(derived.rows, 'the derivation found a row — §3 no longer holds').toEqual([]);

    // Which is precisely the case the clock must call `last_activity`, not a
    // stage age. A backfill from this query would write NOTHING for this project
    // while writing a confident value for its neighbours.
    const age = resolveStageAge({
      last_stage_change_at: derived.rows[0]?.last_stage_change_at ?? null,
      updated_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    });
    expect(age.basis).toBe('last_activity');
    expect(age.measuresStage).toBe(false);
    expect(age.days).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. POSITIVE CONTROL — THE SAME CALL WITH A REAL ACTOR
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 Without this, every absence in §3 is equally explained by "the fixture
// cannot write activity rows at all".

describe('the same transition with a real user id', () => {
  it('writes the row, so §3 is about the NULL and not about the fixture', async () => {
    const { applyStageChange } = await import('@/lib/operations/stageChange');
    const res = await applyStageChange({
      projectId: PROJECT, toStage: 'contract_signed', userId: USER_ID,
      source: 'proposal_signature',
    });
    expect(res.activityId).not.toBeNull();
    const rows = await activityRows();
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('stage_change');
    expect(rows[0].user_id).toBe(USER_ID);
  });

  it('🚨 and the existing suite only ever exercises THIS path — which is why it is green', () => {
    const suite = read('tests', 'stageChangeLeavesATrace.postgres.test.ts');
    const calls = [...suite.matchAll(/applyStageChange\(\{[\s\S]{0,320}?\}\)/g)].map(m => m[0]);
    expect(calls.length).toBeGreaterThan(3);
    for (const c of calls) {
      expect(c,
        'stageChangeLeavesATrace now exercises userId: null — it covers the ' +
        'signature path and this file should be folded into it').not.toMatch(/userId:\s*null/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE DDL, AND WHY IT CARRIES NO DEFAULT
// ═══════════════════════════════════════════════════════════════════════════

describe('STAGE_CHANGED_AT_DDL', () => {
  it('is nullable with NO default, and applies cleanly to the scanned schema', async () => {
    const { STAGE_CHANGED_AT_DDL } = await import('@/lib/operations/stageClock');
    expect(STAGE_CHANGED_AT_DDL).toMatch(/ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;/);
    // 🚨 No DEFAULT NOW(). That would stamp every existing row with the
    // migration's own timestamp — "every project entered its stage the moment we
    // migrated" — which is the same fabrication as a backfill from updated_at,
    // only uniform enough to look plausible.
    expect(STAGE_CHANGED_AT_DDL).not.toMatch(/DEFAULT/i);
    expect(STAGE_CHANGED_AT_DDL).not.toMatch(/NOT NULL/i);

    const bare = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await bare.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
      await bare.exec(STAGE_CHANGED_AT_DDL.replace(/CONCURRENTLY/gi, ''));
      const r = await bare.query<{ is_nullable: string; column_default: string | null }>(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'projects' AND column_name = 'stage_changed_at'`);
      expect(r.rows[0]?.is_nullable).toBe('YES');
      expect(r.rows[0]?.column_default).toBeNull();
    } finally { await bare.close(); }
  });

  it('and a NULL column reads as last_activity, never as a stage age', async () => {
    const { resolveStageAge, classifyStageAge, describeStageAge } =
      await import('@/lib/operations/stageClock');
    const age = resolveStageAge({
      stage_changed_at: null,
      updated_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    });
    expect(age.basis).toBe('last_activity');
    expect(age.measuresStage).toBe(false);
    // 40 days over a 5-day threshold, and it is still NOT a stall.
    expect(classifyStageAge(age, 5)).toEqual({ stalled: false, quiet: true });
    expect(describeStageAge(age, 'Proposal sent')).not.toMatch(/Proposal sent/);
  });
});
