/**
 * tests/adminStatsLayoutVelocityHasAWriter.postgres.test.ts
 *
 * THE ADMIN DASHBOARD'S DESIGN-VELOCITY CARD READ "0 IN LAST 30 DAYS", FOREVER.
 *
 * /api/admin/stats ran `SELECT COUNT(*) AS total FROM layouts` and emitted
 * `layouts: { total }` — no `last30`. app/admin/page.tsx renders that card's
 * sub-line as `${l.last30 ?? 0} in last 30 days`, exactly like the three cards
 * beside it whose `last30` IS real. So the field had no writer, the `?? 0`
 * supplied a confident zero, and the zero sat next to a non-zero all-time total
 * and three neighbouring real figures — which is precisely what makes it read as
 * measured rather than missing.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL, against PostgreSQL in-process (PGlite), with the
 * `layouts` DDL read out of the shipped migration rather than hand-copied. A regex
 * cannot tell you whether `layouts.created_at` exists, and the repair is only
 * admissible BECAUSE it does: lib/migrations/001_initial_schema.sql declares
 * `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. If it did not, the sub-line
 * would have to be removed rather than zero-filled — so the existence of that
 * column is itself an assertion below.
 *
 * SEMANTICS, stated because the number is only honest if they are: `layouts` is
 * upserted one row per (project_id, user_id), so this counts layout rows FIRST
 * CREATED in the window. It is not a count of engineering runs and not a count of
 * saves. The card is labelled "Saved Layouts" to match; `engineering_runs` is the
 * table that holds one row per run, and it is NOT what this endpoint reads.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/**
 * The ONE adaptation this fixture makes to the shipped SQL, stated so nobody
 * mistakes it for a hand-built schema: PGlite ships no `pgcrypto`, so the
 * `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` line is dropped. Nothing else is
 * touched — and nothing needs to be, because `gen_random_uuid()` has been core
 * PostgreSQL since 13, so every `DEFAULT gen_random_uuid()` in the migration
 * still resolves. Every column definition, default, constraint and trigger comes
 * from the file.
 */
const pgliteSql = (...p: string[]) =>
  read(...p).replace(/^\s*CREATE EXTENSION[^;]*;/gim, '');

let db: PGlite;

/** Neon's tagged-template shape over PGlite. Same translation as the other
 *  *.postgres.test.ts files in this directory; everything it feeds is
 *  production code. */
function neonShim(pg: PGlite) {
  const run = async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
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
  };
  return run as unknown as never;
}

vi.mock('@/lib/db-neon', () => ({
  getDbReady: async () => neonShim(db),
  handleRouteDbError: (_tag: string, e: unknown) =>
    new Response(JSON.stringify({ success: false, error: String(e) }), { status: 503 }),
}));

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: async () => ({ id: 'admin-1', role: 'super_admin' }),
}));

import { GET } from '@/app/api/admin/stats/route';

const USER = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  db = new PGlite();

  // 🚨 THE REAL `layouts` DDL, APPLIED FROM THE SHIPPED MIGRATION FILE.
  // 001 creates clients -> projects -> layouts in dependency order; 006 creates
  // `users` (with the `plan` column the plan-breakdown query groups by).
  await db.exec(pgliteSql('lib', 'migrations', '001_initial_schema.sql'));
  await db.exec(pgliteSql('lib', 'migrations', '006_users_subscriptions_whitelabel.sql'));

  // `proposals` and `project_files` have no CREATE TABLE anywhere in the
  // migration set (they are bootstrapped elsewhere). They are stand-ins HERE and
  // are deliberately not asserted on — only the columns the two untested queries
  // in this handler's Promise.all need, so the batch completes and the layouts
  // result can be read. A missing column in a stand-in would fail the whole
  // handler and look exactly like the defect, which is the trap this comment
  // exists to keep the next reader out of.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS project_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_size BIGINT NOT NULL DEFAULT 0
    );
  `);

  await db.exec(`INSERT INTO users (id, email, password_hash, name, plan)
                 VALUES ('${USER}', 'a@b.c', 'x', 'Admin', 'professional');`);

  // Four projects, so each layout can have its own row.
  for (let i = 1; i <= 4; i++) {
    await db.exec(`INSERT INTO projects (id, user_id, name)
                   VALUES ('2222222${i}-2222-4222-8222-222222222222', '${USER}', 'P${i}');`);
  }

  // Three layouts inside the window, two outside it. The window boundary is
  // exercised on purpose: a layout at exactly 29 days is IN, one at 31 is OUT.
  const ages = [0, 5, 29, 31, 400];
  for (let i = 0; i < ages.length; i++) {
    await db.exec(`
      INSERT INTO layouts (project_id, user_id, created_at)
      VALUES ('2222222${(i % 4) + 1}-2222-4222-8222-222222222222', '${USER}',
              NOW() - INTERVAL '${ages[i]} days');
    `);
  }
});

afterAll(async () => { await db?.close(); });

describe('layouts.created_at is real, which is what makes the repair admissible', () => {
  it('the shipped migration declares created_at NOT NULL DEFAULT NOW()', async () => {
    const rows = await db.query<{ column_name: string; is_nullable: string; column_default: string }>(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'layouts' AND column_name = 'created_at'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].is_nullable).toBe('NO');
    expect(rows.rows[0].column_default).toMatch(/now\(\)/i);
  });
});

describe('the 30-day layout count is computed by Postgres, not defaulted to 0', () => {
  it('last30 counts only the rows inside the window', async () => {
    const res = await GET(new Request('http://localhost/api/admin/stats') as never);
    const json = await res.json();
    expect(json.success, JSON.stringify(json)).toBe(true);

    // 5 layouts exist; 3 of them were created within 30 days (0, 5 and 29 days
    // ago). The 31-day and 400-day rows are excluded.
    expect(json.stats.layouts.total).toBe(5);
    expect(json.stats.layouts.last30).toBe(3);

    // 🚨 The defect's signature: the field was ABSENT, and the dashboard's
    // `?? 0` turned that absence into a measured-looking zero.
    expect(json.stats.layouts).toHaveProperty('last30');
    expect(json.stats.layouts.last30).not.toBeUndefined();
  });

  it('the layouts figure uses the same window expression as its neighbours', async () => {
    const res = await GET(new Request('http://localhost/api/admin/stats') as never);
    const json = await res.json();
    // Every row this fixture created is inside the window bar the two aged
    // layouts, so the neighbours' window counts equal their row counts. Read back
    // from the database rather than hard-coded, because migration 006 seeds users
    // of its own and a literal here would be a fixture assumption, not a fact.
    const users = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
    expect(json.stats.users.last30).toBe(users.rows[0].n);
    expect(json.stats.projects.last30).toBe(4);
    for (const key of ['users', 'projects', 'proposals', 'layouts']) {
      expect(typeof json.stats[key].last30, `${key}.last30 is not a number`).toBe('number');
    }
  });

  it('a database with no recent layouts reports 0 — and that 0 is measured', async () => {
    // The honest zero, for contrast: it comes back from the same SUM(CASE...)
    // expression, so it means "none in the window" rather than "no writer".
    const empty = new PGlite();
    await empty.exec(pgliteSql('lib', 'migrations', '001_initial_schema.sql'));
    await empty.exec(pgliteSql('lib', 'migrations', '006_users_subscriptions_whitelabel.sql'));
    await empty.exec(`
      CREATE TABLE IF NOT EXISTS proposals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS project_files (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), file_size BIGINT NOT NULL DEFAULT 0);
      INSERT INTO users (id, email, password_hash, name, plan) VALUES ('${USER}', 'a@b.c', 'x', 'A', 'starter');
      INSERT INTO projects (id, user_id, name) VALUES ('33333333-3333-4333-8333-333333333333', '${USER}', 'Old');
      INSERT INTO layouts (project_id, user_id, created_at)
      VALUES ('33333333-3333-4333-8333-333333333333', '${USER}', NOW() - INTERVAL '90 days');
    `);
    const prev = db;
    db = empty;
    try {
      const json = await (await GET(new Request('http://localhost/api/admin/stats') as never)).json();
      expect(json.stats.layouts.total).toBe(1);
      expect(json.stats.layouts.last30).toBe(0);
    } finally {
      db = prev;
      await empty.close();
    }
  });
});
