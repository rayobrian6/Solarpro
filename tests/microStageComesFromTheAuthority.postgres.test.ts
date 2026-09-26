/**
 * tests/microStageComesFromTheAuthority.postgres.test.ts
 *
 * A MICRO-STAGE NAME THAT NOTHING COULD REJECT, WRITTEN RAW, AND PERMANENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 * PATCH /api/projects/[id]/homeowner-stage maps the homeowner stage the
 * installer picked onto a milestone micro-stage and INSERTs it directly, rather
 * than going through `writeMicroStage` (whose signature is typed). Its
 * `completed` entry held a name from the DEAL-ACTION vocabulary
 * (lib/deals/transitions.ts) instead of the micro-stage vocabulary
 * (lib/microStage.ts). Nothing anywhere could catch that:
 *
 *   - the map's value type was `string`, so tsc had nothing to compare against;
 *   - the INSERT is raw, so `writeMicroStage`'s typed parameter never applied;
 *   - `project_micro_stages.micro_stage` is TEXT with NO CHECK constraint, so
 *     PostgreSQL accepted it too — asserted below against a real database
 *     rather than assumed;
 *   - and `ON CONFLICT (project_id, micro_stage) DO UPDATE` means the junk row,
 *     once written, can never be replaced by the right one. It is permanent for
 *     that project, and the completion milestone it was meant to record never
 *     appears at all.
 *
 * The name itself was corrected in d7d1b55d, which also typed the map. That
 * closed the spelling. It did NOT close the hole: a compile-time type is not a
 * guard on the write, and the INSERT still interpolated whatever the map held.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE TESTS PIN
 * ─────────────────────────────────────────────────────────────────────────────
 * Not a spelling — the REQUIREMENT that the value written comes FROM the
 * canonical list. §3 proves it by REPLACING the authority: with `MICRO_STAGES`
 * mocked to a list that no longer contains the completion milestone, the route
 * must write NOTHING. A guard built on a literal, a local copy of the list, or
 * a hardcoded Set inside the route passes every other test in this file and
 * fails that one.
 *
 * 🚨 The incorrect name is quoted in exactly one assertion, in §1, and
 * deliberately NOT repeated in any comment: this file scans the route's source
 * for it, and prose naming it would satisfy the scan by itself. (The route's own
 * docblock does name it, as history — which is why the scan strips comments.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE, AND WHICH DDL
 * ─────────────────────────────────────────────────────────────────────────────
 * PGlite — PostgreSQL 16 compiled to WASM, in-process, no daemon, no
 * credentials. Two of the four facts above are properties of the SCHEMA, not of
 * any JavaScript: that the column has no CHECK, and that the UNIQUE constraint
 * plus ON CONFLICT make the first write final. A mocked `sql` cannot show
 * either.
 *
 * 🚨 THE TABLE HAS TWO CONFLICTING CREATE STATEMENTS IN THIS REPO, and only one
 * of them matches the code:
 *
 *   migrations/021_micro_stages.sql      (project_id, micro_stage, created_by,
 *   + 022_micro_stages_unique.sql         metadata) + UNIQUE(project_id,
 *                                         micro_stage)   ← what the code writes
 *   lib/migrations/027_project_micro_stages.sql  (project_id, user_id, stage,
 *                                         substage, notes) — no `micro_stage`
 *                                         column at all
 *
 * lib/migrations/manifest.ts states that only `lib/migrations/` is scanned and
 * that `migrations/` is legacy — so the DDL the runner would apply is the one
 * the product cannot use, and the DDL the product needs is in the directory the
 * runner ignores. The same is true of `projects.homeowner_stage` and
 * `project_homeowner_stage_history` (migrations/019). That is a real finding and
 * it is NOT this file's to fix; it is recorded here because it decides which
 * DDL the fixture must apply, and the fixture asserts the shape it got rather
 * than taking it on trust.
 *
 * 🚨 THIS IS NOT RAY'S NEON INSTANCE. It proves the write path is correct. It
 * does not prove production has run either migration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { stripComments } from './support/stripSource';
import { MICRO_STAGES } from '../lib/microStage';

const ROOT = join(__dirname, '..');

// ── The PGlite fixture ──────────────────────────────────────────────────────

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,$2,…)
 *  text. The only translation here — everything it feeds is production code.
 *  Same shim as tests/layoutConcurrency.postgres.test.ts. */
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

/**
 * The real migration files, named rather than globbed.
 *
 * A glob over either directory would either drag in migrations about unrelated
 * tables (and then this fixture's failures would be about those) or — worse —
 * apply lib/migrations/027 and create `project_micro_stages` with the wrong
 * shape, after which migrations/021's `CREATE TABLE IF NOT EXISTS` is a silent
 * no-op and every test below fails on a missing column. These four files are
 * the ones that create what the route touches.
 */
const MIGRATIONS: ReadonlyArray<[dir: string, file: string]> = [
  ['lib/migrations', '001_initial_schema.sql'],   // clients, projects, users
  ['migrations',     '019_homeowner_stage.sql'],  // projects.homeowner_stage + history
  ['migrations',     '021_micro_stages.sql'],     // project_micro_stages
  ['migrations',     '022_micro_stages_unique.sql'],
];

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const [dir, file] of MIGRATIONS) {
    const sql = readFileSync(join(ROOT, dir, file), 'utf8')
      // PGlite does not ship pgcrypto. Its only use in 001 is gen_random_uuid(),
      // core PostgreSQL since 13 (PGlite is 16), so dropping the line changes
      // nothing observable.
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g,
        '-- pgcrypto omitted: gen_random_uuid() is core PostgreSQL from 13');
    await pg.exec(sql);
  }
}

// ── Module mocks ────────────────────────────────────────────────────────────

const USER_ID  = '11111111-1111-4111-8111-111111111111';
const PROJECT  = '4030b664-bebe-433b-a11c-cda05ead2f7d';

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

const { PATCH } = await import('@/app/api/projects/[id]/homeowner-stage/route');

// ── Helpers ─────────────────────────────────────────────────────────────────

const ROUTE_PATH = join(ROOT, 'app', 'api', 'projects', '[id]', 'homeowner-stage', 'route.ts');
/** Comments stripped: the route's docblock names the wrong value as history, and
 *  prose must not be able to satisfy — or defeat — a scan for it. */
const ROUTE = stripComments(readFileSync(ROUTE_PATH, 'utf8'));

function patch(stage: string) {
  return PATCH(
    new Request(`http://localhost/api/projects/${PROJECT}/homeowner-stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    }) as never,
    { params: Promise.resolve({ id: PROJECT }) },
  );
}

async function microStages(): Promise<string[]> {
  const r = await db.query<{ micro_stage: string }>(
    `SELECT micro_stage FROM project_micro_stages WHERE project_id = $1 ORDER BY micro_stage`,
    [PROJECT],
  );
  return r.rows.map(x => x.micro_stage);
}

async function seed() {
  await db.exec(`
    DELETE FROM project_micro_stages;
    DELETE FROM project_homeowner_stage_history;
    DELETE FROM projects;
  `);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, system_type, homeowner_stage)
     VALUES ($1,$2,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL 62040','roof','installation')`,
    [PROJECT, USER_ID],
  );
}

beforeAll(async () => {
  db = await PGlite.create();
  await applyMigrations(db);
});
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 A fixture quietly missing a column or a constraint does not produce a
// weaker test — it produces a CONFIDENT WRONG ANSWER. Everything below depends
// on these.

describe('the fixture is the schema the code actually writes to', () => {
  it('project_micro_stages has the columns the route names', async () => {
    const r = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'project_micro_stages'`,
    );
    const cols = new Set(r.rows.map(x => x.column_name));
    for (const c of ['project_id', 'micro_stage', 'created_at', 'created_by', 'metadata']) {
      expect(cols.has(c), `project_micro_stages.${c} is missing — lib/migrations/027's ` +
        `shape was applied instead of migrations/021`).toBe(true);
    }
  });

  it('🚨 and micro_stage is TEXT with NO CHECK — the database will accept anything', async () => {
    // The first of the four reasons nothing caught the wrong name. Proven, not
    // assumed: this is the whole justification for a runtime guard in the route.
    // 🚨 Asked of pg_catalog, not information_schema.check_constraints — the
    // latter reports every NOT NULL as a CHECK, so the obvious query returns a
    // row for `micro_stage IS NOT NULL` and this control passes for the wrong
    // reason while proving nothing about the vocabulary.
    const checks = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'project_micro_stages'::regclass
          AND c.contype  = 'c'`,
    );
    const onTheName = checks.rows.map(r => r.def).filter(d => /micro_stage/.test(d));
    expect(onTheName, `a CHECK does constrain the name: ${onTheName.join('; ')}`).toEqual([]);

    // For contrast, the sibling column that IS constrained — so this test is
    // known to be capable of finding one at all.
    const homeowner = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'projects'::regclass AND c.contype = 'c'`,
    );
    expect(homeowner.rows.some(r => /homeowner_stage/.test(r.def)),
      'the probe cannot see a CHECK even where migrations/019 writes one').toBe(true);

    // And it really does take a value from outside the vocabulary.
    await db.query(
      `INSERT INTO project_micro_stages (project_id, micro_stage) VALUES ($1, $2)`,
      [PROJECT, 'not-a-micro-stage-at-all'],
    );
    expect(await microStages()).toContain('not-a-micro-stage-at-all');
  });

  it('🚨 and the UNIQUE constraint + ON CONFLICT make the FIRST write final', async () => {
    // The fourth reason, and the one that makes a single bad write permanent:
    // the statement the route issues cannot replace the name, only re-date it.
    await db.query(
      `INSERT INTO project_micro_stages (project_id, micro_stage) VALUES ($1, 'junk_name')`,
      [PROJECT],
    );
    await db.query(
      `INSERT INTO project_micro_stages (project_id, micro_stage) VALUES ($1, $2)
       ON CONFLICT (project_id, micro_stage) DO UPDATE SET created_at = NOW()`,
      [PROJECT, 'install_completed'],
    );
    // Both rows now exist — the junk one was never replaced, it was joined.
    expect(await microStages()).toEqual(['install_completed', 'junk_name']);
  });

  it('projects.homeowner_stage exists, so the route can get as far as the micro-stage', async () => {
    const r = await db.query<{ homeowner_stage: string }>(
      `SELECT homeowner_stage FROM projects WHERE id = $1`, [PROJECT]);
    expect(r.rows[0].homeowner_stage).toBe('installation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE VOCABULARY, AND THE ONE VALUE THAT WAS NOT IN IT
// ═══════════════════════════════════════════════════════════════════════════

describe('the canonical micro-stage vocabulary', () => {
  it('lib/microStage.ts is the authority and the completion milestone is in it', () => {
    expect(MICRO_STAGES as readonly string[]).toContain('install_completed');
  });

  it('🚨 the value the route used to write is NOT a micro-stage at all', () => {
    // The only place in this file that spells it. It belongs to
    // DealDecisionAction in lib/deals/transitions.ts.
    expect(MICRO_STAGES as readonly string[]).not.toContain('installation_complete');
  });

  it('and the route no longer contains it (comments stripped — the docblock cites it)', () => {
    expect(ROUTE).not.toContain('installation_complete');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EVERY NAME THE ROUTE CAN WRITE IS CANONICAL
// ═══════════════════════════════════════════════════════════════════════════

describe('the route writes only canonical names', () => {
  /** The map body, anchored on real syntax — never a fixed character count,
   *  which `stripComments` (blanking comments to whitespace) would make
   *  meaningless anyway. */
  function mapBody(): string {
    const i = ROUTE.indexOf('const STAGE_MICRO_MAP');
    expect(i, 'the stage-to-micro map is gone — this guard is scanning nothing')
      .toBeGreaterThan(-1);
    const end = ROUTE.indexOf('};', i);
    expect(end).toBeGreaterThan(i);
    return ROUTE.slice(i, end);
  }

  it('every single-quoted value in the map is a member of MICRO_STAGES', () => {
    const body = mapBody();
    // Right-hand sides only: `key: 'value',`.
    const values = [...body.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
    expect(values.length, 'no mapped values found — the scan is vacuous')
      .toBeGreaterThan(0);
    const bad = values.filter(v => !(MICRO_STAGES as readonly string[]).includes(v));
    expect(bad, `these are not micro-stages: ${bad.join(', ')}`).toEqual([]);
  });

  it('completed maps to the completion milestone', () => {
    expect(mapBody()).toMatch(/completed:\s*'install_completed'/);
  });

  it('through a real database, setting the stage to completed records that milestone', async () => {
    const res = await patch('completed');
    expect(res.status).toBe(200);
    expect(await microStages()).toEqual(['install_completed']);
  });

  it('and every mapped stage writes a name the vocabulary recognises', async () => {
    // Walks the whole map through the real route and the real database, so this
    // does not depend on the source scan above being right about the syntax.
    for (const stage of ['proposal', 'installation', 'completed']) {
      await seed();
      const res = await patch(stage);
      expect(res.status).toBe(200);
      for (const written of await microStages()) {
        expect(MICRO_STAGES as readonly string[], `stage ${stage} wrote ${written}`)
          .toContain(written);
      }
    }
  });

  it('a stage with no milestone writes no micro-stage at all', async () => {
    const res = await patch('site_survey');
    expect(res.status).toBe(200);
    expect(await microStages()).toEqual([]);
  });

  it('and an invalid homeowner stage is refused before anything is written', async () => {
    const res = await patch('installation_complete');
    expect(res.status).toBe(400);
    expect(await microStages()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 🚨 THE REQUIREMENT: THE NAME COMES *FROM* THE AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything above is satisfied by a route with a correct literal and no guard
// at all — which is exactly the state d7d1b55d left. This section is the one
// that distinguishes them, and it is deliberately not a scan for a spelling.
//
// The authority itself is replaced: `MICRO_STAGES` is mocked to a list with the
// completion milestone REMOVED. A route that validates against the real list at
// runtime writes nothing. A route that trusts its own literal, its own copy of
// the list, or a hardcoded Set writes the row anyway — and that is precisely the
// route that would have written the deal-action name.

describe('🚨 a name the authority does not contain cannot be written', () => {
  it('with the completion milestone removed from MICRO_STAGES, the route writes no row', async () => {
    vi.resetModules();
    vi.doMock('@/lib/microStage', async (orig) => {
      const actual = await orig<typeof import('@/lib/microStage')>();
      return {
        ...actual,
        MICRO_STAGES: actual.MICRO_STAGES.filter(s => s !== 'install_completed'),
      };
    });
    try {
      const { PATCH: GUARDED } =
        await import('@/app/api/projects/[id]/homeowner-stage/route');
      const res = await GUARDED(
        new Request(`http://localhost/api/projects/${PROJECT}/homeowner-stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'completed' }),
        }) as never,
        { params: Promise.resolve({ id: PROJECT }) },
      );

      // The stage change itself is the installer's instruction and still lands —
      // refusing it would leave the installer unable to move a project forward
      // because of a bug in a milestone they never asked about.
      expect(res.status).toBe(200);
      const p = await db.query<{ homeowner_stage: string }>(
        `SELECT homeowner_stage FROM projects WHERE id = $1`, [PROJECT]);
      expect(p.rows[0].homeowner_stage).toBe('completed');

      // 🚨 But nothing went into the micro-stage table. This is the assertion
      // that a literal-only fix fails.
      expect(await microStages(),
        'the route wrote a micro-stage the authority does not contain — the value ' +
        'is not being checked against MICRO_STAGES at runtime')
        .toEqual([]);
    } finally {
      vi.doUnmock('@/lib/microStage');
      vi.resetModules();
    }
  });

  it('and with the authority intact the same request does write it — the guard is not a block', async () => {
    // POSITIVE CONTROL for the case above: without it, a route that never writes
    // any micro-stage would pass §3 perfectly.
    await seed();
    const res = await patch('completed');
    expect(res.status).toBe(200);
    expect(await microStages()).toEqual(['install_completed']);
  });

  it('the route imports MICRO_STAGES as a VALUE, not only as a type', () => {
    // A type-only import cannot be checked at runtime, and a type-only import is
    // what the route had. Asserted on source because an import is a textual fact
    // and `import type` erases to nothing observable at runtime.
    expect(ROUTE).toMatch(/import\s*\{[^}]*\bMICRO_STAGES\b[^}]*\}\s*from\s*'@\/lib\/microStage'/);
    expect(ROUTE, 'MICRO_STAGES is imported under `import type` and so does not exist at runtime')
      .not.toMatch(/import\s+type\s*\{[^}]*\bMICRO_STAGES\b/);
  });
});
