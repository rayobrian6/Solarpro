/**
 * tests/stageSchemaReachability.postgres.test.ts
 *
 * A WHOLE FEATURE'S SCHEMA LIVES IN A DIRECTORY NOTHING SCANS — AND THE FILE
 * THAT CLAIMS ITS TABLE NAME CANNOT EXECUTE AT ALL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE ESTABLISHES
 * ─────────────────────────────────────────────────────────────────────────────
 * The homeowner-stage / micro-stage feature reads and writes:
 *
 *     projects.homeowner_stage                  migrations/019   (NOT scanned)
 *     project_homeowner_stage_history           migrations/019   (NOT scanned)
 *     project_micro_stages (micro_stage,
 *       created_by, metadata)                   migrations/021   (NOT scanned)
 *     UNIQUE (project_id, micro_stage)          migrations/022   (NOT scanned)
 *
 * `lib/migrations/manifest.ts` scans ONE fixed directory — `lib/migrations/` —
 * and says so in its own header: "The legacy `migrations/` directory is NOT
 * scanned". `lib/migrations/runner.ts` binds that scan as its
 * `productionManifestProvider`, and both legacy executors
 * (`app/api/migrate/route.ts`, `app/api/admin/system-tools/route.ts`
 * run_migration) return 423 Locked before reaching a database. So the run set is
 * a listing of one directory, numerically sorted, and NOTHING in the product can
 * reach `migrations/`.
 *
 * `lib/migrations/027_project_micro_stages.sql` claims the same table NAME with
 * an incompatible shape — `(project_id, user_id, stage, substage, notes)`, no
 * `micro_stage` column — and both files use `CREATE TABLE IF NOT EXISTS`, so the
 * obvious reading is "whichever runs first wins". §2 shows that reading is wrong
 * in a way that matters: 027 declares its keys `TEXT` while `projects.id` and
 * `users.id` are `UUID`, so PostgreSQL refuses its foreign keys and the file
 * cannot be applied AT ALL — not to an empty database, and (§5) not to a correct
 * one either. It never wins a race; it loses every one, permanently.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Production may have either shape" is not answerable by reading. A missing
 * column is a PostgreSQL error, an incompatible foreign key is a PostgreSQL
 * error, and `CREATE TABLE IF NOT EXISTS` doing nothing is a PostgreSQL
 * behaviour. PGlite is PostgreSQL 16 compiled to WASM, in-process, no daemon and
 * no credentials, so all three are measured here rather than argued.
 *
 * 🚨 MIGRATIONS ARE APPLIED BY NAME, IN THE MANIFEST'S OWN ORDER — never by a
 * glob of this file's own. `discoverMigrationFiles()`, the real function the
 * runner's production provider calls, produces both the list and the order; this
 * file only reads the files it names. A hand-rolled glob that reached 027 before
 * 021 would measure a shape the runner cannot produce and this file would report
 * it with confidence.
 *
 * 🚨 THIS IS NOT RAY'S NEON INSTANCE. It proves what the migration DIRECTORY can
 * build. It does not prove what production contains — production may well carry
 * the correct shape from the inline runner in `app/api/migrate/route.ts`, which
 * still holds the correct DDL ("Migration 027", `micro_stage UUID`-keyed) as
 * unreachable dead code after the MIGRATION-GOV-13 lock.
 *
 * NOTHING HERE MIGRATES ANYTHING. Every database is in-memory and disposable,
 * and no migration file is written or modified.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { discoverMigrationFiles } from '@/lib/migrations/manifest';
import { MIGRATIONS_DIR_RELATIVE } from '@/lib/migrations/types';
import {
  isLegacyInlineEnabled,
  isLegacySystemToolsRunEnabled,
  TARGETED_RECOVERY_ALLOWLIST,
} from '@/lib/migrations/runner';
import { REGISTRY_SEQUENCE } from '@/lib/migrations/targetedRegistryDeployment';

const ROOT = join(__dirname, '..');

// ── The databases ───────────────────────────────────────────────────────────

/** Built from ONLY the scanned directory, in the manifest's order. */
let scanned: PGlite;
/** Built the way the application needs it: the scanned set without 027, plus
 *  the three files from the directory nothing scans. */
let correct: PGlite;
/** Which database the mocked `getDbReady` hands to production code. */
let active: () => PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,$2,…)
 *  text. The only translation here — everything it feeds is production code.
 *  Same shim as tests/microStageComesFromTheAuthority.postgres.test.ts. */
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

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(active()),
}));
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Test', email: 't@e.st', company: 'T' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

// ── The run set, from the real discovery ─────────────────────────────────────

/** The REAL discovery the runner's production-locked provider calls. */
const MANIFEST = discoverMigrationFiles();

const FILE_027 = '027_project_micro_stages.sql';

/** The three files in the UNSCANNED directory that create what the feature uses. */
const LEGACY: ReadonlyArray<string> = [
  '019_homeowner_stage.sql',
  '021_micro_stages.sql',
  '022_micro_stages_unique.sql',
];

interface Outcome {
  /** Files that applied without error, in order. */
  ok: string[];
  /** Files that raised, with the first line of the reason. */
  failed: Map<string, string>;
}

/**
 * Apply a NAMED, ORDERED list of `[dir, filename]` pairs to a database.
 *
 * Per-file all-or-nothing, which is what the canonical runner does: one file in
 * one transaction (`executeMigrationInTransaction`, REQUIRED mode — the mode
 * every file here is detected as). A file that raises leaves nothing behind and
 * its reason is recorded.
 *
 * `CONCURRENTLY` is stripped: PGlite's `exec()` wraps in a transaction and
 * CREATE INDEX CONCURRENTLY cannot run inside one. An index changes speed, not
 * answers. (Same accommodation as lib/dev/pgliteNeonBridge.ts.)
 */
async function apply(
  pg: PGlite,
  files: ReadonlyArray<readonly [string, string]>,
): Promise<Outcome> {
  const out: Outcome = { ok: [], failed: new Map() };
  for (const [dir, filename] of files) {
    const raw = readFileSync(join(ROOT, dir, filename), 'utf8');
    const sql = /CONCURRENTLY/i.test(raw) ? raw.replace(/CONCURRENTLY/gi, '') : raw;
    try {
      await pg.exec(sql);
      out.ok.push(filename);
    } catch (e) {
      out.failed.set(filename, String((e as Error)?.message ?? e).split('\n')[0]);
    }
  }
  return out;
}

/** The scanned set, in the manifest's order. */
const SCANNED_SET: ReadonlyArray<readonly [string, string]> =
  MANIFEST.files.map(f => [MIGRATIONS_DIR_RELATIVE, f.filename] as const);

/** The same set with 027 removed, then the three files from `migrations/`. */
const CORRECTED_SET: ReadonlyArray<readonly [string, string]> = [
  ...SCANNED_SET.filter(([, f]) => f !== FILE_027),
  ...LEGACY.map(f => ['migrations', f] as const),
];

let scannedOutcome: Outcome;
let correctOutcome: Outcome;

// ── Source reading (comments blanked where prose could satisfy a scan) ────────

/** Blank `--` line comments so a column scan cannot be satisfied by a comment. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}
/** Blank `//` and block comments in TypeScript, same reason. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const DDL_027 = stripSqlComments(
  readFileSync(join(ROOT, 'lib', 'migrations', FILE_027), 'utf8'));
const DDL_021 = stripSqlComments(
  readFileSync(join(ROOT, 'migrations', '021_micro_stages.sql'), 'utf8'));
const DDL_019 = stripSqlComments(
  readFileSync(join(ROOT, 'migrations', '019_homeowner_stage.sql'), 'utf8'));

// ── Helpers that ask the database, not the file ──────────────────────────────

async function columnsOf(pg: PGlite, table: string): Promise<Set<string>> {
  const r = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return new Set(r.rows.map(x => x.column_name));
}

async function tableExists(pg: PGlite, table: string): Promise<boolean> {
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return (r.rows[0]?.n ?? 0) > 0;
}

async function seed(pg: PGlite): Promise<void> {
  await pg.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1, 'Test', 't@e.st', 'x') ON CONFLICT (id) DO NOTHING`, [USER_ID]);
  await pg.query(
    `INSERT INTO projects (id, user_id, name, address, system_type)
     VALUES ($1, $2, 'BRAIDON M PILLA — Solar',
             '3 Melvin Drive, Granite City, IL 62040', 'roof')
     ON CONFLICT (id) DO NOTHING`, [PROJECT, USER_ID]);
}

beforeAll(async () => {
  scanned = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  scannedOutcome = await apply(scanned, SCANNED_SET);
  correct = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  correctOutcome = await apply(correct, CORRECTED_SET);
  await seed(scanned);
  await seed(correct);
}, 300_000);

afterAll(async () => {
  await scanned?.close();
  await correct?.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// 0. HOW THE RUN SET IS DETERMINED
// ═══════════════════════════════════════════════════════════════════════════
//
// A glob, a manifest list, or a numeric sort? It is a readdir of ONE fixed
// directory, filtered to /^\d{3,}_.*\.sql$/, then sorted by numeric prefix with
// duplicate prefixes disambiguated by alphabetical filename. No file outside
// that directory can enter the run set by any route.

describe('the run set is one directory listing, and it is lib/migrations', () => {
  it('the canonical directory constant is lib/migrations', () => {
    expect(MIGRATIONS_DIR_RELATIVE).toBe('lib/migrations');
  });

  it('every file the real discovery returns lives in lib/migrations, and it returns all of them', () => {
    const onDisk = readdirSync(join(ROOT, 'lib', 'migrations'))
      .filter(f => f.endsWith('.sql') && /^[0-9]{3,}_/.test(f));
    expect(onDisk.length).toBeGreaterThan(0);
    expect(MANIFEST.count).toBe(onDisk.length);
    for (const f of MANIFEST.files) {
      expect(f.fullPath.includes(join('lib', 'migrations'))).toBe(true);
    }
  });

  it('the order is the numeric prefix, ascending — not the lexical filename', () => {
    const prefixes = MANIFEST.files.map(f => parseInt(f.prefix, 10));
    for (let i = 1; i < prefixes.length; i++) {
      expect(prefixes[i]).toBeGreaterThanOrEqual(prefixes[i - 1]);
    }
  });

  it('🚨 the three files that create the feature exist — in the OTHER directory — and are absent from the manifest', () => {
    const names = new Set(MANIFEST.files.map(f => f.filename));
    for (const f of LEGACY) {
      expect(existsSync(join(ROOT, 'migrations', f)),
        `migrations/${f} is gone — this investigation is about a file that exists`).toBe(true);
      expect(names.has(f),
        `migrations/${f} IS in the manifest — the scan has changed and this file must be re-read`)
        .toBe(false);
    }
  });

  it('and both legacy executors are permanently shut, so no other path can apply them', () => {
    // Asked of the runner at runtime, not of a comment.
    expect(isLegacyInlineEnabled()).toBe(false);
    expect(isLegacySystemToolsRunEnabled()).toBe(false);
  });

  it('the runner binds the no-argument discovery as its production provider', () => {
    const runner = stripTsComments(
      readFileSync(join(ROOT, 'lib', 'migrations', 'runner.ts'), 'utf8'));
    expect(runner).toMatch(/productionManifestProvider[^=]*=\s*\(\)\s*=>\s*discoverMigrationFiles\(\)/);
  });

  it('🚨 and a batch run HALTS on the first failure, so one unrunnable file blocks every later one', () => {
    const runner = stripTsComments(
      readFileSync(join(ROOT, 'lib', 'migrations', 'runner.ts'), 'utf8'));
    expect(runner).toMatch(/for \(const identifier of toRun\)[\s\S]{0,160}if \(failed > 0\) break;/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. TWO CREATE STATEMENTS, ONE TABLE NAME
// ═══════════════════════════════════════════════════════════════════════════

describe('project_micro_stages is defined twice, incompatibly', () => {
  it('both are CREATE TABLE IF NOT EXISTS — so the obvious reading is a race', () => {
    expect(DDL_027).toMatch(/CREATE TABLE IF NOT EXISTS project_micro_stages/i);
    expect(DDL_021).toMatch(/CREATE TABLE IF NOT EXISTS project_micro_stages/i);
  });

  it('🚨 the scanned one (lib/migrations/027) declares NO micro_stage column', () => {
    // Anchored on a COLUMN DECLARATION, not the substring: the table name and the
    // index name both contain "micro_stage", so a bare search always matches and
    // would report the column as present in both files.
    expect(DDL_027).not.toMatch(/^\s*micro_stage\s+[A-Za-z]/m);
    // What it declares instead — the shape no consumer in the product names.
    for (const col of ['user_id', 'stage', 'substage', 'notes']) {
      expect(DDL_027).toMatch(new RegExp(`^\\s*${col}\\s+[A-Za-z]`, 'm'));
    }
  });

  it('and the unscanned one (migrations/021) declares the three columns the code writes', () => {
    expect(DDL_021).toMatch(/^\s*micro_stage\s+TEXT/m);
    expect(DDL_021).toMatch(/^\s*created_by\s+UUID/m);
    expect(DDL_021).toMatch(/^\s*metadata\s+JSONB/m);
  });

  it('🚨 and they disagree on the KEY TYPE — 027 says TEXT where the base schema is UUID', () => {
    expect(DDL_027).toMatch(/^\s*project_id\s+TEXT/m);
    expect(DDL_027).toMatch(/^\s*user_id\s+TEXT/m);
    expect(DDL_021).toMatch(/^\s*project_id\s+UUID/m);
    const initial = readFileSync(join(ROOT, 'lib', 'migrations', '001_initial_schema.sql'), 'utf8');
    expect(initial).toMatch(/CREATE TABLE IF NOT EXISTS projects[\s\S]{0,80}id\s+UUID PRIMARY KEY/);
    const usersDdl = readFileSync(
      join(ROOT, 'lib', 'migrations', '006_users_subscriptions_whitelabel.sql'), 'utf8');
    expect(usersDdl).toMatch(/CREATE TABLE IF NOT EXISTS users[\s\S]{0,60}id\s+UUID PRIMARY KEY/);
  });

  it('projects.homeowner_stage and its history table are created ONLY in the unscanned directory', () => {
    expect(DDL_019).toMatch(/ADD COLUMN IF NOT EXISTS homeowner_stage TEXT/);
    expect(DDL_019).toMatch(/CREATE TABLE IF NOT EXISTS project_homeowner_stage_history/);
    // Not one scanned migration mentions the column, in DDL or in a comment.
    const offenders = MANIFEST.files
      .map(f => [f.filename, readFileSync(f.fullPath, 'utf8')] as const)
      .filter(([, sql]) => /homeowner_stage/.test(sql))
      .map(([name]) => name);
    expect(offenders,
      'a scanned migration does mention homeowner_stage — the finding has changed').toEqual([]);
  });

  it('and 027 is on no targeted path, so only run-pending / run-single could ever attempt it', () => {
    expect(TARGETED_RECOVERY_ALLOWLIST.has('027')).toBe(false);
    expect((REGISTRY_SEQUENCE as readonly string[]).includes('027')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE SCANNED SET, APPLIED TO A REAL POSTGRESQL
// ═══════════════════════════════════════════════════════════════════════════

describe('what the scanned set actually builds', () => {
  it('the fixture is honest: the base schema applied', async () => {
    expect(scannedOutcome.failed.has('001_initial_schema.sql'),
      `001 failed: ${scannedOutcome.failed.get('001_initial_schema.sql')}`).toBe(false);
    expect(scannedOutcome.failed.has('006_users_subscriptions_whitelabel.sql'),
      `006 failed: ${scannedOutcome.failed.get('006_users_subscriptions_whitelabel.sql')}`).toBe(false);
    expect(await tableExists(scanned, 'projects')).toBe(true);
    expect(await tableExists(scanned, 'users')).toBe(true);
    // Most of the directory applies; the rest belong to subsystems this fixture
    // does not build. The count is asserted only as a floor, so this file cannot
    // silently become a test of a nearly-empty database.
    expect(scannedOutcome.ok.length).toBeGreaterThan(MANIFEST.count / 2);
  });

  it('🚨 027 CANNOT BE APPLIED — PostgreSQL refuses its foreign key, TEXT against UUID', () => {
    const reason = scannedOutcome.failed.get(FILE_027);
    expect(reason,
      '027 applied cleanly — the TEXT/UUID mismatch is gone and this file must be re-read')
      .toBeDefined();
    // The reason is INTRINSIC to 027, not a cascade from a missing dependency:
    // it names 027's own foreign key on a table that exists in this database.
    expect(reason).toMatch(/foreign key constraint/i);
    expect(reason).toMatch(/project_micro_stages/);
  });

  it('🚨 so project_micro_stages does not exist at all', async () => {
    expect(await tableExists(scanned, 'project_micro_stages'),
      'the table exists — establish WHICH file created it before trusting anything below')
      .toBe(false);
    const cols = await columnsOf(scanned, 'project_micro_stages');
    expect(cols.has('micro_stage')).toBe(false);
  });

  it('🚨 projects has NO homeowner_stage column', async () => {
    const cols = await columnsOf(scanned, 'projects');
    expect(cols.size, 'the projects table itself is missing — the fixture is broken')
      .toBeGreaterThan(5);
    expect(cols.has('homeowner_stage')).toBe(false);
  });

  it('🚨 and project_homeowner_stage_history does not exist', async () => {
    expect(await tableExists(scanned, 'project_homeowner_stage_history')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SHIPPED QUERIES, AGAINST THAT DATABASE
// ═══════════════════════════════════════════════════════════════════════════
//
// Not paraphrases: the production functions and the production route handler,
// with `getDbReady` pointed at the database the scanned set built.

describe('🚨 the queries the feature ships, run against the scanned set', () => {
  beforeAll(() => { active = () => scanned; });

  it('resolveHomeownerStage raises a real PostgreSQL error naming the relation', async () => {
    const { resolveHomeownerStage } = await import('@/lib/microStage');
    await expect(resolveHomeownerStage(PROJECT)).rejects.toThrow(/project_micro_stages/);
  });

  it('🚨 writeMicroStage does not raise — it SWALLOWS the error and records nothing', async () => {
    // The engine's public API is `Promise<void>` and catches everything, so a
    // schema that cannot hold a micro-stage produces no exception, no 500, and
    // no row: the internal truth layer simply stops recording.
    const { writeMicroStage } = await import('@/lib/microStage');
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
    try {
      await expect(writeMicroStage(PROJECT, 'install_completed')).resolves.toBeUndefined();
    } finally { spy.mockRestore(); }
    expect(errors.join('\n')).toMatch(/\[writeMicroStage\] ERROR: Failed after 2 attempts/);
    expect(await tableExists(scanned, 'project_micro_stages')).toBe(false);
  });

  it('syncHomeownerStage also swallows it, so a pipeline transition logs no history', async () => {
    const { syncHomeownerStage } = await import('@/lib/homeownerStageSync');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(syncHomeownerStage(PROJECT, 'complete')).resolves.toBeUndefined();
    } finally { spy.mockRestore(); }
    expect(await tableExists(scanned, 'project_homeowner_stage_history')).toBe(false);
  });

  it('🚨 the admin project-list SELECT cannot be issued at all', async () => {
    // app/api/admin/projects/route.ts:32 selects p.homeowner_stage in the main
    // list query. Its only handler is the route's outer catch →
    // handleRouteDbError (line 114), so the WHOLE list fails rather than
    // degrading — unlike the micro-stage read in [id]/route.ts:103, which has
    // its own inner failsafe returning [].
    const listSource = stripTsComments(
      readFileSync(join(ROOT, 'app', 'api', 'admin', 'projects', 'route.ts'), 'utf8'));
    expect(listSource, 'the admin list no longer selects the column — re-read this file')
      .toMatch(/p\.homeowner_stage/);
    await expect(
      scanned.query(`SELECT p.id, p.homeowner_stage FROM projects p LIMIT 1`),
    ).rejects.toThrow(/homeowner_stage/);
  });

  it('🚨 and PATCH /api/projects/[id]/homeowner-stage answers 503 DB_STARTING — a permanent defect reported as transient', async () => {
    const { PATCH } = await import('@/app/api/projects/[id]/homeowner-stage/route');
    const res = await PATCH(
      new Request(`http://localhost/api/projects/${PROJECT}/homeowner-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'installation' }),
      }) as never,
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(res.status).toBe(503);
    const body = await res.json() as { code?: string; error?: string };
    // The installer is told to try again in a moment. No amount of trying will
    // add the column.
    expect(body.code).toBe('DB_STARTING');
    expect(body.error).toMatch(/try again/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. POSITIVE CONTROL — the same code against the shape the app needs
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 Without this section every failure above is equally explained by "the
// queries are wrong" or "the shim is broken". Here the same production functions
// run green against the DDL from the directory nothing scans.

describe('the same code against the unscanned directory’s shape', () => {
  beforeAll(() => { active = () => correct; });

  it('the corrected fixture really is the other shape, and all three legacy files applied', async () => {
    for (const f of LEGACY) {
      expect(correctOutcome.failed.has(f),
        `migrations/${f} failed: ${correctOutcome.failed.get(f)}`).toBe(false);
    }
    const cols = await columnsOf(correct, 'project_micro_stages');
    for (const c of ['project_id', 'micro_stage', 'created_at', 'created_by', 'metadata']) {
      expect(cols.has(c), `project_micro_stages.${c} is missing`).toBe(true);
    }
    expect((await columnsOf(correct, 'projects')).has('homeowner_stage')).toBe(true);
    expect(await tableExists(correct, 'project_homeowner_stage_history')).toBe(true);
    // 022's constraint, which the route's ON CONFLICT (project_id, micro_stage)
    // needs to exist at all.
    const uq = await correct.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        WHERE c.conrelid = 'project_micro_stages'::regclass AND c.contype = 'u'`);
    expect(uq.rows.map(r => r.def).join(' ')).toMatch(/UNIQUE \(project_id, micro_stage\)/);
  });

  it('writeMicroStage records the event and advances the homeowner stage', async () => {
    const { writeMicroStage, resolveHomeownerStage } = await import('@/lib/microStage');
    await writeMicroStage(PROJECT, 'install_completed');
    const r = await correct.query<{ micro_stage: string }>(
      `SELECT micro_stage FROM project_micro_stages WHERE project_id = $1`, [PROJECT]);
    expect(r.rows.map(x => x.micro_stage)).toEqual(['install_completed']);
    expect(await resolveHomeownerStage(PROJECT)).toBe('installation');
    const h = await correct.query<{ stage: string }>(
      `SELECT stage FROM project_homeowner_stage_history WHERE project_id = $1`, [PROJECT]);
    expect(h.rows.map(x => x.stage)).toEqual(['installation']);
  });

  it('and the admin project-list SELECT is issuable', async () => {
    const r = await correct.query(`SELECT p.id, p.homeowner_stage FROM projects p LIMIT 1`);
    expect(r.rows.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. 🚨 027 AGAINST A CORRECT DATABASE — AND THE NO-OP MECHANISM, MEASURED
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 lib/migrations/027 cannot be applied to a correct database either', () => {
  it('its CREATE TABLE silently does nothing and its index then fails on a column that is not there', async () => {
    const out = await apply(correct, [['lib/migrations', FILE_027]]);
    const reason = out.failed.get(FILE_027);
    expect(reason, '027 applied cleanly onto the correct shape — re-read this file').toBeDefined();
    // 🚨 THE IDENTITY OF THE ERROR IS THE POINT. It is not the CREATE TABLE
    // raising "already exists" — IF NOT EXISTS made that a silent no-op, so
    // execution reached the NEXT statement, the unique index on (project_id,
    // stage, substage). `stage` is 027's column and it is not in this table.
    expect(reason).toMatch(/column "stage" does not exist/i);
    // And the correct shape survived, because nothing was replaced.
    expect((await columnsOf(correct, 'project_micro_stages')).has('micro_stage')).toBe(true);
  });

  it('the no-op is CREATE TABLE IF NOT EXISTS behaviour, shown with the real 021 file', async () => {
    // Re-applying 021 to a database that already has the table succeeds and
    // changes nothing — the mechanism the brief describes, in the only direction
    // that is reachable here (027 can never be the one that ran first).
    const before = await columnsOf(correct, 'project_micro_stages');
    const out = await apply(correct, [['migrations', '021_micro_stages.sql']]);
    expect(out.failed.get('021_micro_stages.sql')).toBeUndefined();
    expect([...(await columnsOf(correct, 'project_micro_stages'))].sort())
      .toEqual([...before].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. 🚨 THE GUARD
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 EXPECTED FAILURE, DELIBERATELY, BY NAME.
//
// Everything above documents the defect. This is the REQUIREMENT: a database
// provisioned from the only directory the runner scans must be able to hold the
// homeowner-stage / micro-stage feature. It cannot today, so the assertion is
// wrapped in `it.fails` — it PASSES while the defect exists and goes RED the
// moment the schema becomes reachable, which forces whoever fixes it to come
// here and promote it to a plain `it`. A defect recorded as an expectation is a
// defect nobody can forget.
//
// It reads the SAME database the sections above measured, so it cannot be
// satisfied by a fixture of its own.

describe('🚨 THE INVARIANT: the feature’s schema is reachable from the scanned set', () => {
  it.fails(
    'EXPECTED FAILURE — stageSchemaReachability: every table and column the ' +
    'homeowner-stage / micro-stage code touches is created by a migration the ' +
    'runner scans',
    async () => {
      // projects.homeowner_stage — migrations/019, unscanned.
      expect((await columnsOf(scanned, 'projects')).has('homeowner_stage')).toBe(true);
      // project_homeowner_stage_history — migrations/019, unscanned.
      expect(await tableExists(scanned, 'project_homeowner_stage_history')).toBe(true);
      // project_micro_stages with the columns lib/microStage.ts writes —
      // migrations/021, unscanned. lib/migrations/027 claims the name and cannot
      // be applied.
      const micro = await columnsOf(scanned, 'project_micro_stages');
      for (const c of ['project_id', 'micro_stage', 'created_at', 'created_by', 'metadata']) {
        expect(micro.has(c)).toBe(true);
      }
      // UNIQUE (project_id, micro_stage) — migrations/022, unscanned. The
      // homeowner-stage route's ON CONFLICT names exactly this pair.
      const uq = await scanned.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
          WHERE c.conrelid = 'project_micro_stages'::regclass AND c.contype = 'u'`);
      expect(uq.rows.map(r => r.def).join(' ')).toMatch(/UNIQUE \(project_id, micro_stage\)/);
    },
  );
});
