// ═══════════════════════════════════════════════════════════════════════════
// R8 — WHERE `run-pending` ACTUALLY STOPS, AND WHAT A CRASH LEAVES BEHIND
//
// The standing note in this repo says migration 027 halts the batch runner and
// makes 028–123 unreachable. The CONCLUSION is right. The CAUSE was not: a static
// audit of the runner argued that two earlier files fail first, which — if true —
// means `run-pending` never reaches 027 at all and a fix aimed only at 027 would
// move the halt by exactly one file.
//
// That claim was INFERRED from SQL grammar, never executed. This file executes it,
// against real PostgreSQL in-process (PGlite — no credential, no network, nothing
// is run against any real database), and answers Ray's matrix directly:
//
//   • reproduce against a clean database
//   • is the failure deterministic?
//   • partial-migration behaviour — what is left behind by a file that fails
//   • the four database states: empty, before 027, after 027, interrupted
//
// 🚨 NOTHING HERE RUNS A MIGRATION AGAINST A REAL ENVIRONMENT. Every statement is
// executed against a throwaway in-memory Postgres created and destroyed by the test.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIG_DIR = join(ROOT, 'lib', 'migrations');

/** The manifest's own rule: /^\d{3,}_.*\.sql$/ in lib/migrations, numeric order. */
function scannedFilesInOrder(): string[] {
  return readdirSync(MIG_DIR)
    .filter(f => f.endsWith('.sql') && /^[0-9]{3,}_/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/^(\d+)/)![1]);
      const nb = Number(b.match(/^(\d+)/)![1]);
      return na === nb ? a.localeCompare(b) : na - nb;
    });
}

const FILES = scannedFilesInOrder();
const idOf = (f: string) => f.match(/^(\d+)/)![1];

interface Attempt { file: string; identifier: string; ok: boolean; error: string | null }

/**
 * Apply files the way the runner does: each file's statements inside ONE
 * transaction, and STOP AT THE FIRST FAILURE — `runPendingMigrations` does
 * `if (failed > 0) break;`.
 */
async function runPendingLike(pg: PGlite, files: string[]): Promise<Attempt[]> {
  const out: Attempt[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    try {
      await pg.exec(`BEGIN; ${sql} ; COMMIT;`);
      out.push({ file: f, identifier: idOf(f), ok: true, error: null });
    } catch (e) {
      try { await pg.exec('ROLLBACK;'); } catch { /* already aborted */ }
      out.push({ file: f, identifier: idOf(f), ok: false, error: String((e as Error)?.message ?? e) });
      break;   // the runner's halt
    }
  }
  return out;
}

async function tableExists(pg: PGlite, t: string): Promise<boolean> {
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [t]);
  return (r.rows[0]?.n ?? 0) > 0;
}

let firstRun: Attempt[];
let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  firstRun = await runPendingLike(db, FILES);
}, 300_000);

afterAll(async () => { await db?.close(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. WHERE IT ACTUALLY STOPS
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a clean database, the scanned set, the runner\'s own halt rule', () => {
  it('stops, and reports exactly which file stopped it', () => {
    const failed = firstRun.filter(a => !a.ok);
    expect(failed.length, 'a batch run completed cleanly — the premise of R8 no longer holds')
      .toBe(1);
    const stop = failed[0];
    // Printed so the identifier is in the record whatever it turns out to be.
    expect({ stoppedAt: stop.identifier, file: stop.file, error: stop.error?.slice(0, 200) })
      .toMatchObject({ stoppedAt: expect.any(String) });
  });

  it('🚨 the halt is EARLIER than 027 — so a fix aimed only at 027 moves the halt by one file', () => {
    const stop = firstRun.find(a => !a.ok)!;
    expect(Number(stop.identifier),
      `the batch stopped at ${stop.identifier}; the standing note says 027 is the blocker`)
      .toBeLessThan(27);
  });

  it('🚨 MEASURED: exactly TWO files apply, and the third one stops it', () => {
    // The number that rewrites the standing note. `run-pending` is not "blocked at
    // 027 with 026 files of headroom" — it is dead after 002. Everything from the
    // third file onward, 027 included, has only ever been reachable through the
    // per-identifier targeted path, which is why 107 and 113–123 each needed one.
    const applied = firstRun.filter(a => a.ok);
    expect(applied.length,
      'the number of files a clean batch run can apply has changed — re-read the halt analysis')
      .toBe(2);
    expect(applied.map(a => a.identifier)).toEqual(['001', '002']);
    expect(firstRun.find(a => !a.ok)!.identifier).toBe('003');
  });

  it('and the file that stops it is refused for its SQL, not for a data condition', () => {
    // 003 declares `ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS …`, a form PostgreSQL
    // has in no version — `IF NOT EXISTS` exists for ADD COLUMN, `IF EXISTS` for
    // DROP CONSTRAINT. The file's own header comment asserts the opposite:
    // "ADD CONSTRAINT IF NOT EXISTS and ADD COLUMN IF NOT EXISTS (Postgres 9.1+)".
    // A wrong comment is why this survived, exactly as a wrong changelog hid the
    // hardcoded 15 ft building height.
    const stop = firstRun.find(a => !a.ok)!;
    expect(stop.error, `003 failed with: ${stop.error}`).toBeTruthy();
    expect(stop.error!.toLowerCase()).toMatch(/syntax|near "not"|constraint/);
  });

  it('027 is never even attempted', () => {
    expect(firstRun.some(a => a.identifier === '027'),
      '027 was attempted, so it really is the first blocker after all').toBe(false);
  });

  it('every file BEFORE the halt applied', () => {
    const upToHalt = firstRun.slice(0, -1);
    expect(upToHalt.every(a => a.ok)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. IS IT DETERMINISTIC?
// ═══════════════════════════════════════════════════════════════════════════
describe('the failure is deterministic', () => {
  it('a second clean database stops at the same file with the same error', async () => {
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      const second = await runPendingLike(pg, FILES);
      const a = firstRun.find(x => !x.ok)!;
      const b = second.find(x => !x.ok)!;
      expect(b.file).toBe(a.file);
      // Same failure, not merely the same position.
      expect(b.error).toBe(a.error);
      expect(second.length).toBe(firstRun.length);
    } finally { await pg.close(); }
  }, 300_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PARTIAL-MIGRATION BEHAVIOUR
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a file that fails leaves NOTHING behind', () => {
  it('the failing file created no object, even though earlier statements in it succeeded', async () => {
    // The property that makes retry safe. A file whose first statements succeed
    // and whose last one fails must roll back in full, or a retry meets
    // half-applied schema and fails differently the second time.
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await pg.exec(`
        BEGIN;
        CREATE TABLE r8_probe_a (id int);
        CREATE TABLE r8_probe_b (id int);
        SELECT this_function_does_not_exist();
        COMMIT;
      `).catch(() => {});
      try { await pg.exec('ROLLBACK;'); } catch { /* already aborted */ }
      expect(await tableExists(pg, 'r8_probe_a'),
        'a statement that succeeded before the failure survived — the file is NOT atomic')
        .toBe(false);
      expect(await tableExists(pg, 'r8_probe_b')).toBe(false);
    } finally { await pg.close(); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE FOUR DATABASE STATES FOR 027 ITSELF
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 migration 027, in each database state it can meet', () => {
  const SQL_027 = readFileSync(join(MIG_DIR, '027_project_micro_stages.sql'), 'utf8');

  /** Build only the prerequisite base schema 027 needs (projects + users, UUID keys). */
  async function baseSchema(pg: PGlite) {
    await pg.exec(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT, email TEXT, password_hash TEXT
      );
      CREATE TABLE projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        name TEXT
      );
    `);
  }

  async function apply027(pg: PGlite): Promise<string | null> {
    try {
      await pg.exec(`BEGIN; ${SQL_027} ; COMMIT;`);
      return null;
    } catch (e) {
      try { await pg.exec('ROLLBACK;'); } catch { /* aborted */ }
      return String((e as Error)?.message ?? e);
    }
  }

  it('STATE A — prerequisites absent: it fails and creates nothing', async () => {
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      const err = await apply027(pg);
      expect(err).toBeTruthy();
      expect(await tableExists(pg, 'project_micro_stages')).toBe(false);
    } finally { await pg.close(); }
  }, 120_000);

  it('🚨 STATE B — UUID keys, no existing table: the FOREIGN KEY is refused and the table is not created', async () => {
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await baseSchema(pg);
      const err = await apply027(pg);
      expect(err, '027 applied against the canonical schema — the type mismatch is gone').toBeTruthy();
      expect(err!.toLowerCase()).toMatch(/foreign key|type|cannot be implemented/);
      expect(await tableExists(pg, 'project_micro_stages'),
        'the table exists in SOME shape — 027 partially applied').toBe(false);
    } finally { await pg.close(); }
  }, 120_000);

  it('🚨 STATE C — the CORRECT table already exists: 027 fails and leaves it untouched', async () => {
    // This is the state production is believed to be in. The property that matters
    // is not that 027 fails — it is that the good table SURVIVES, so 027 can never
    // corrupt an already-migrated environment.
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await baseSchema(pg);
      await pg.exec(`
        CREATE TABLE project_micro_stages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          micro_stage TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by UUID,
          metadata JSONB,
          CONSTRAINT uq_project_micro_stage UNIQUE (project_id, micro_stage)
        );
      `);
      const err = await apply027(pg);
      expect(err, '027 succeeded against the correct table — it may have altered it').toBeTruthy();
      // The whole point: the shape every shipped query uses is still there.
      const cols = await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='project_micro_stages'`);
      const names = new Set(cols.rows.map(r => r.column_name));
      expect(names.has('micro_stage'), 'the correct column was lost').toBe(true);
      expect(names.has('stage'), '027 managed to add its own column shape').toBe(false);
    } finally { await pg.close(); }
  }, 120_000);

  it('STATE D — TEXT keys: 027 would apply, and would create a table no shipped query can use', async () => {
    // Completes the matrix, and makes the real point: "make 027 runnable" is not a
    // fix. Every consumer writes `micro_stage`; 027 creates `stage`/`substage`.
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      await pg.exec(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE projects (id TEXT PRIMARY KEY);
      `);
      const err = await apply027(pg);
      expect(err, '027 failed even against TEXT keys').toBeNull();
      const cols = await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='project_micro_stages'`);
      const names = new Set(cols.rows.map(r => r.column_name));
      expect(names.has('stage'), '027 did not create its own shape').toBe(true);
      expect(names.has('micro_stage'),
        '027 creates the column the product actually reads — then it is not a dead fork after all')
        .toBe(false);
    } finally { await pg.close(); }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE INTERRUPTED MIGRATION — Ray's fourth database state
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a run interrupted between starting a migration and recording its outcome', () => {
  it('refuses the whole batch and names the stuck identifier', async () => {
    const { refusalForInterruptedMigrations } = await import('@/lib/migrations/runner');
    const refusal = refusalForInterruptedMigrations(['027']);
    expect(refusal, 'a crashed migration no longer stops the batch').toBeTruthy();
    expect(refusal!).toContain('027');
    expect(refusal!).toMatch(/RUNNING/);
    // A refusal a human cannot act on is a dead end. It must say what to do.
    expect(refusal!).toMatch(/Reconcile|record its real outcome/i);
  });

  it('names EVERY stuck identifier, not just the first', async () => {
    const { refusalForInterruptedMigrations } = await import('@/lib/migrations/runner');
    const refusal = refusalForInterruptedMigrations(['027', '113'])!;
    expect(refusal).toContain('027');
    expect(refusal).toContain('113');
  });

  it('🚨 and does NOT refuse when nothing is stuck — the batch still runs', async () => {
    // A guard that always refuses would pass every case above while making the
    // runner useless. This is the case that stops that.
    const { refusalForInterruptedMigrations } = await import('@/lib/migrations/runner');
    expect(refusalForInterruptedMigrations([])).toBeNull();
    expect(refusalForInterruptedMigrations([] as string[])).toBeNull();
  });

  it('the batch loop consults it BEFORE applying anything, and ACTS on it', async () => {
    // 🚨 THIS IS A SOURCE GUARD, SAID PLAINLY. The batch reads the ledger through a
    // dependency that is not injectable — only the manifest provider is — so the
    // wiring cannot be driven behaviourally without a live database. The DECISION
    // above is pure and is tested behaviourally; this case covers only the wiring.
    //
    // It asserts the refusal is USED, not merely computed. An earlier version
    // checked only that the call appeared before the loop, and a mutation to
    // `if (false && _runningRefusal)` passed it — the call was there, the batch ran
    // anyway. Presence is not consumption.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(ROOT, 'lib', 'migrations', 'runner.ts'), 'utf8');
    const call = src.indexOf('refusalForInterruptedMigrations(state.running)');
    const loop = src.indexOf('// Stop on first failure');
    expect(call, 'the batch no longer consults the interrupted-migration refusal').toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    expect(call, 'the refusal is consulted AFTER the loop has already applied migrations')
      .toBeLessThan(loop);

    // Between the call and the loop there must be a branch on the refusal that
    // RETURNS, carrying it out as a fatal error.
    const between = src.slice(call, loop);
    expect(between, 'the refusal is computed and then not branched on')
      .toMatch(/if\s*\(\s*_runningRefusal\s*\)/);
    expect(between, 'the refusal branch does not return — the batch would carry on')
      .toMatch(/return\s*\{/);
    expect(between, 'the refusal never reaches the caller as a fatal error')
      .toMatch(/fatalErrors:\s*\[\s*_runningRefusal\s*\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE DRY-RUN THAT COULD NOT FAIL
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a forced dry-run must be able to refuse', () => {
  // `app/api/admin/migrations/route.ts` runs a dry-run before every targeted
  // execution, under the comment "forced dry-run first (proof, not execution)".
  // The dry-run branch returned `{ success: true }` from BOTH of its arms, never
  // contacted the database, and never applied the static refusals the real path
  // applies — so it "passed" for exactly the files a real run would refuse. And
  // the route collected its verdict into an audit-event detail and branched on it
  // nowhere, so the real run proceeded regardless. Two layers of nothing.
  const srcRunner = () => readFileSync(join(ROOT, 'lib', 'migrations', 'runner.ts'), 'utf8');
  const srcRoute = () => readFileSync(join(ROOT, 'app', 'api', 'admin', 'migrations', 'route.ts'), 'utf8');

  it('the dry-run applies the same transaction-mode refusals the real run applies', () => {
    // SOURCE GUARD, said plainly: the dry-run branch takes no injectable
    // dependency and reads the file from disk, so it cannot be driven with a
    // synthetic FORBIDDEN file without a manifest fixture.
    const src = srcRunner();
    const at = src.indexOf('if (dryRun) {');
    expect(at, 'the dry-run branch is gone').toBeGreaterThan(-1);
    const branch = src.slice(at, src.indexOf('const sql = getRawSql();', at));
    expect(branch, 'the dry-run still cannot refuse a MANUAL_REVIEW file')
      .toMatch(/MANUAL_REVIEW/);
    expect(branch, 'the dry-run still cannot refuse a FORBIDDEN file')
      .toMatch(/FORBIDDEN/);
    expect(branch, 'the dry-run never returns a failure')
      .toMatch(/success:\s*false/);
  });

  it('🚨 and the route BRANCHES on the dry-run verdict before executing', () => {
    const src = srcRoute();
    const dry = src.indexOf('const dryRunResult = await runSinglePendingMigration');
    const real = src.indexOf('const execution = await runSinglePendingMigration', dry);
    expect(dry).toBeGreaterThan(-1);
    expect(real).toBeGreaterThan(dry);
    const between = src.slice(dry, real);
    expect(between, 'the dry-run verdict is collected and never branched on — the real run proceeds regardless')
      .toMatch(/if\s*\(\s*dryRunResult\.status\s*===\s*'failed'\s*\)/);
    expect(between, 'the refusal branch does not return, so execution continues anyway')
      .toMatch(/return NextResponse\.json/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. HOW MANY BLOCKERS ARE THERE, REALLY?
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 THE DECISION-RELEVANT NUMBER. Knowing the batch stops at 003 invites the
// obvious fix — repair 003 — and that would move the halt by exactly one file if
// 003 is not the only one. So this run does NOT stop at the first failure: it
// applies every file in manifest order, skipping past each failure, and reports
// EVERY file that cannot apply to a clean database.
//
// That is not how the runner behaves and must never be — applying out of order is
// the thing it refuses. This is a DIAGNOSTIC, and its only job is to tell an
// operator the full size of the problem before they start.
describe('🚨 the COMPLETE blocker list for a clean database', () => {
  it('reports every file that cannot apply, in order', async () => {
    const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    const blockers: Array<{ id: string; file: string; error: string }> = [];
    let applied = 0;
    try {
      for (const f of FILES) {
        const sql = readFileSync(join(MIG_DIR, f), 'utf8');
        try {
          await pg.exec(`BEGIN; ${sql} ; COMMIT;`);
          applied++;
        } catch (e) {
          try { await pg.exec('ROLLBACK;'); } catch { /* aborted */ }
          blockers.push({
            id: idOf(f), file: f,
            error: String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160),
          });
        }
      }
    } finally { await pg.close(); }

    // Printed through the assertion message so the list is in the record whatever
    // it turns out to be — this is a report, not a pin.
    const summary = blockers.map(b => `${b.id}: ${b.error}`).join('\n  ');
    expect(blockers.length, `MIGRATION BLOCKERS (${blockers.length} of ${FILES.length} files):\n  ${summary}\n`)
      .toBeGreaterThan(0);

    // 🚨 THE POINT: more than one. If this ever drops to 1, repairing that one
    // file genuinely unblocks `run-pending`, and this case should be revisited.
    expect(blockers.length,
      `only ${blockers.length} blocker — repairing it may now unblock the batch, which changes R8's answer`)
      .toBeGreaterThan(1);

    // And the first is the one the batch actually stops at.
    expect(blockers[0].id).toBe('003');
    expect(applied).toBeGreaterThan(2);   // skipping failures gets much further
  }, 600_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. 🚨 CORE TABLES NO SCANNED MIGRATION CREATES
// ═══════════════════════════════════════════════════════════════════════════
//
// The known finding was that the homeowner-stage / micro-stage schema lives in
// the directory the manifest does not scan. Applying every file to a clean
// database and recording EVERY failure (not stopping at the first) shows that is
// the small end of it: 33 of 120 files cannot apply, and most fail with
// `relation "X" does not exist` for a table nothing creates.
//
// Ray's brief: "A deployment cannot depend on 'probably already migrated.'" This
// is the measurement of how far from that the repository is. These assertions
// state TODAY'S answer; when someone adds the missing CREATE TABLEs the relevant
// case goes RED and must be updated downward. That is the point — a silent
// improvement is as invisible as a silent regression.
describe('🚨 which core tables can a fresh deployment actually build?', () => {
  const scanned = () => FILES.map(f => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n');
  /**
   * 🚨 NO BACKSLASHES IN THIS PATTERN, AND THAT IS NOT STYLE.
   *
   * The first version of this function was written with `\\s` and `\\b` inside a
   * template literal — and the shell heredoc that wrote the file collapsed them to
   * `\s` and `\b`. In a template literal `\s` is a literal 's' and `\b` is U+0008
   * BACKSPACE, so the pattern became unmatchable and EVERY table looked missing.
   *
   * The control case below is the only reason that was caught: `projects` came
   * back "not created by any scanned migration", which is absurd on its face and
   * is exactly what a blanket-true detector produces. Without that case, the
   * finding above would have read as far worse than it is, and been believed.
   *
   * Sixth occurrence of this bug in this repository, and the first I authored
   * myself. Explicit character classes cannot be collapsed by an editor, a
   * heredoc, or the next person.
   */
  const creates = (sql: string, table: string) => {
    const WS = '[ \t\r\n]+';
    const NOT_WORD = '[^A-Za-z0-9_]';
    return new RegExp(
      `create${WS}table${WS}(?:if${WS}not${WS}exists${WS})?(?:public[.])?${table}(?:${NOT_WORD}|$)`,
      'i',
    ).test(sql);
  };

  it('records the tables the scanned set CANNOT create', () => {
    const src = scanned();
    const missing = [
      'proposals', 'leads', 'crews', 'site_surveys',
      'site_survey_files', 'project_physical_data', 'utility_policies',
    ].filter(t => !creates(src, t));

    // 🚨 `proposals` is the one to look at first. Six scanned migrations
    // REFERENCE it (020, 031, 033, 037, 040, 090) and `getProjectsByUser` selects
    // from it — and NOTHING in this repository creates it: not the scanned set,
    // not the unscanned `migrations/` directory, not even the now-423-Locked
    // inline runner in app/api/migrate/route.ts. Whatever production has came
    // from outside the migration history entirely.
    expect(missing, 'the set of uncreatable core tables CHANGED — update this list and the R8 record')
      .toEqual([
        'proposals', 'leads', 'crews', 'site_surveys',
        'site_survey_files', 'project_physical_data', 'utility_policies',
      ]);
  });

  it('and the tables it CAN create are still creatable — this is not a blanket claim', () => {
    // The control. If `creates()` were broken, every table would look missing and
    // the case above would pass for the wrong reason.
    const src = scanned();
    for (const t of ['projects', 'users', 'crew_members']) {
      expect(creates(src, t), `${t} should be created by a scanned migration`).toBe(true);
    }
  });
});
