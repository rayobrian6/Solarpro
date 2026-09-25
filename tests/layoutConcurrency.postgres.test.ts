/**
 * tests/layoutConcurrency.postgres.test.ts
 *
 * TWO TABS, TWO DEVICES, ONE ROW — AND THE SECOND ONE USED TO WIN SILENTLY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 * A design lives in exactly ONE row, keyed `(project_id, user_id)`
 * (lib/migrations/001_initial_schema.sql — and note there is no UNIQUE
 * constraint on that pair, only two separate indexes; the *code* is what makes
 * it one row). `upsertLayout` finds it with a bare
 *
 *     SELECT id FROM layouts WHERE project_id = … AND user_id = … LIMIT 1
 *
 * and then writes it with a bare
 *
 *     UPDATE layouts SET … WHERE project_id = … AND user_id = …
 *
 * There was no version column, no `updated_at` precondition, no ETag — nothing
 * in the request said which state of the row the edit was computed against. So
 * two tabs open on the same design, a phone and a laptop, or one stale tab
 * waking from sleep, each wrote the whole row over the other's work and both
 * were told "Saved".
 *
 * `project_versions` snapshots were being written on every layout save
 * (app/api/projects/[id]/layout/route.ts), so the lost work was recoverable in
 * principle — but nothing in the website fetches `/api/projects/[id]/versions`,
 * so the recovery path could not be reached by a user.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE FIX IS
 * ─────────────────────────────────────────────────────────────────────────────
 * Optimistic concurrency, opt-in, carried on `UpsertLayoutData.expectedUpdatedAt`:
 * the caller sends the `updatedAt` it read, and `upsertLayout`
 *
 *   • refuses BEFORE any write when the stored row has moved on, with the named
 *     code `LAYOUT_STALE_WRITE` — which `handleRouteDbError` already turns into
 *     a 409 with a refusal badge for every route that calls `upsertLayout`; and
 *   • CLAIMS the row atomically (`UPDATE … WHERE updated_at = <expected>`)
 *     before the first write, so the check is not a read-then-write race.
 *
 * A caller that sends nothing behaves exactly as before. That is deliberate:
 * the admin tools, the version-restore route and `/api/engineering/preliminary`
 * have no client-held version to send, and forcing one on them would refuse
 * saves nobody could fix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE USES A REAL DATABASE, AND THE REAL MIGRATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * The whole mechanism is a property of one SQL statement's WHERE clause and of
 * a TRIGGER nobody writes in application code:
 *
 *     CREATE TRIGGER update_layouts_updated_at BEFORE UPDATE ON layouts …
 *
 * That trigger is why `updated_at` is usable as a version token at all, and it
 * is also the trap: ONE logical save issues up to six UPDATE statements against
 * the same row, so a precondition written naively conflicts with its own
 * earlier statement and refuses every save forever. A hand-built fixture table
 * — which is what the two sibling Postgres suites in this directory use — has
 * no trigger, `updated_at` never moves, and BOTH the defect and that trap
 * become invisible. So this file applies the REAL migration files, in numeric
 * order, and then asserts the trigger is actually there before testing anything.
 *
 * PGlite — PostgreSQL compiled to WASM, in-process, no daemon, no credentials.
 *
 * 🚨 THIS IS NOT RAY'S NEON INSTANCE. It proves the path is correct. It does
 * not prove production has run the migrations.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;

/** Neon's `sql` is a tagged template that returns rows; PGlite takes ($1,$2,…)
 *  text. The only translation in the file — everything it feeds is production
 *  code. Identical to tests/deletionLedgerPersistence.postgres.test.ts. */
/**
 * ANOTHER WRITER, COMMITTING AT A MOMENT OF THE TEST'S CHOOSING.
 *
 * 🚨 THE ONLY WAY TO TEST A RACE IN A ONE-CONNECTION DATABASE.
 *
 * PGlite is in-process and single-connection, so two requests cannot actually
 * interleave — which would leave the most important line in the fix (the
 * ATOMIC claim, as opposed to the read-then-write check in front of it)
 * permanently unprovable, and unprovable code in a data-loss path is how the
 * defect got here in the first place.
 *
 * So the shim is given a seam: when `afterStatementMatching` is armed, the
 * first statement whose text matches runs, and then the intruder's write runs
 * before the caller gets control back. In a real database that needs no help at
 * all — it is just another connection committing.
 */
let interleaveAfter: { match: RegExp; write: () => Promise<unknown> } | null = null;

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
    if (interleaveAfter && interleaveAfter.match.test(text)) {
      const { write } = interleaveAfter;
      interleaveAfter = null;   // once, like a real racing save
      await write();
    }
    return r.rows;
  };
  return run as unknown as ReturnType<typeof import('@neondatabase/serverless').neon>;
}

vi.mock('@neondatabase/serverless', () => ({ neon: () => neonShim(db) }));
vi.mock('@/lib/db-ready', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbWithRetry: async () => neonShim(db),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Test', email: 't@e.st', company: 'T' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
/**
 * PVWatts reaches the network and is not what this file is about. The refusal
 * under test happens in `upsertLayout`, which the production route calls BEFORE
 * any of this — so on the refusal path none of it runs at all; it is stubbed so
 * the POSITIVE controls (a current token being accepted) do not need a key.
 *
 * 🚨 PARTIAL, via `importOriginal`. Replacing the whole module removed
 * `calculateProductionLocal` — which `lib/multiArrayEngine.ts`, imported by the
 * same route, depends on — and the route then 500'd for a reason that had
 * nothing to do with the code under test. A stub that is missing an export
 * accuses the product of the stub's own fault.
 */
vi.mock('@/lib/pvwatts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  calculateProduction: async () => ({ annualProductionKwh: 10000, monthlyProduction: [], performanceRatio: 0.8, specificYield: 1400, co2OffsetKg: 1000 }),
  calculateProductionFromDefinition: async () => ({ annualProductionKwh: 10000, monthlyProduction: [], performanceRatio: 0.8, specificYield: 1400, co2OffsetKg: 1000 }),
}));

const { upsertLayout, getLayoutByProject, __resetSiteArchivesProbeForTests } =
  await import('@/lib/db/projects');
const { LAYOUT_REFUSAL_CODES, layoutRefusalCode, handleRouteDbError } =
  await import('@/lib/db/core');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { parseDeletionLedger } = await import('@/lib/design/deletionAuthority');
const { POST: PRODUCTION_POST } = await import('@/app/api/production/route');

// ── THE REAL MIGRATIONS, IN NUMERIC ORDER ───────────────────────────────────
//
// Every .sql in lib/migrations, sorted, applied in sequence. Some fail on
// tables this repo's migration set never creates (proposals, site_surveys,
// organizations …) — none of them touch `layouts` or `projects`, and the
// fixture assertions below prove the layout path got everything it needs
// rather than taking that on trust.
//
// TWO honest adaptations, both asserted:
//   • `CREATE EXTENSION pgcrypto` — PGlite does not ship the extension. Its
//     only use here is `gen_random_uuid()`, which has been core Postgres since
//     13 (PGlite is 16), so removing the line changes nothing observable.
//   • FIVE `projects` columns that the application reads and writes and that NO
//     migration in lib/migrations creates: `city`, `engineering_seed`,
//     `engineering_config`, `engineering_updated_at`, `no_itc`. They are added
//     here explicitly, and named, rather than left missing — a column the write
//     path uses but the fixture lacks is precisely how a fixture invents a
//     defect the product does not have. (Their absence from the migration set
//     is a real finding, and the reason migrations 109/110/111 cannot run
//     against a database built from lib/migrations alone. It is NOT this
//     workstream's to fix, and nothing here depends on it.)
const MIGRATION_DIR = join(process.cwd(), 'lib', 'migrations');

/** Columns the product uses that no migration file creates. Kept as data so
 *  the list is readable, and asserted below so it cannot rot silently. */
const COLUMNS_NO_MIGRATION_CREATES: ReadonlyArray<[string, string]> = [
  ['city', 'TEXT'],
  ['engineering_seed', 'JSONB'],
  ['engineering_config', 'JSONB'],
  ['engineering_updated_at', 'TIMESTAMPTZ'],
  ['no_itc', 'BOOLEAN DEFAULT FALSE'],
];

async function applyRealMigrations(pg: PGlite): Promise<string[]> {
  const files = readdirSync(MIGRATION_DIR).filter(f => f.endsWith('.sql')).sort();
  const skipped: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATION_DIR, f), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g,
        '-- pgcrypto omitted: gen_random_uuid() is core Postgres from 13 onwards');
    try {
      await pg.exec(sql);
    } catch {
      skipped.push(f);
    }
  }
  for (const [name, type] of COLUMNS_NO_MIGRATION_CREATES) {
    await pg.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${name} ${type};`);
  }
  return skipped;
}

// ── Melvin, the house this whole workstream is about ────────────────────────
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);

const panel = (id: string) => ({
  id, planeId: 'melvin-r0', lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400, systemType: 'roof',
});
const plane = (id: string) => ({
  id, siteKey: KEY_A, pitch: 20, azimuth: 180,
  vertices: [
    { lat: MELVIN.lat, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng + 0.0001 },
  ],
});

const TWELVE = Array.from({ length: 12 }, (_, i) => panel(`melvin-p${i}`));
const SIX_PLANES = Array.from({ length: 6 }, (_, i) => plane(`melvin-r${i}`));

function archives(deletions: unknown = { sites: {} }) {
  return { version: 1, activeSiteKey: KEY_A, sites: {}, nativeGeometry: {}, deletions };
}

/** A save as `upsertLayout` receives it from any of its eight call sites. */
function save(panels: unknown[], extra: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT,
    userId: USER_ID,
    systemType: 'roof' as const,
    panels: panels as never,
    roofPlanes: SIX_PLANES as never,
    obstructions: [] as never,
    measurements: [] as never,
    siteArchives: archives() as never,
    mapCenter: MELVIN,
    mapZoom: 19,
    totalPanels: panels.length,
    systemSizeKw: panels.length * 0.4,
    ...extra,
  };
}

async function row(cols: string) {
  const r = await db.query<Record<string, unknown>>(
    `SELECT ${cols} FROM layouts WHERE project_id = $1`, [PROJECT],
  );
  return r.rows[0] ?? null;
}

async function seedProject() {
  // Children first, then projects, then clients — `projects.client_id`
  // references `clients`, and a leftover client row is what let one test's
  // fixture leak into the next and fail it for the wrong reason.
  await db.exec(`
    DELETE FROM layouts;
    DELETE FROM project_versions;
    DELETE FROM productions;
    DELETE FROM projects;
    DELETE FROM clients;
  `);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type)
     VALUES ($1,$2,$3,$4,$5,$6,'roof')`,
    [PROJECT, USER_ID, 'BRAIDON M PILLA — Solar',
      '3 Melvin Drive, Granite City, IL 62040', MELVIN.lat, MELVIN.lng],
  );
  __resetSiteArchivesProbeForTests();
}

/** What a tab holds after it loads the design: the token it must send back. */
async function whatTheTabRead(): Promise<string> {
  const l = await getLayoutByProject(PROJECT, USER_ID);
  return new Date(l!.updatedAt as unknown as string).toISOString();
}

let SKIPPED: string[] = [];

beforeAll(async () => {
  db = await PGlite.create();
  SKIPPED = await applyRealMigrations(db);
});
afterAll(async () => { await db?.close(); });
beforeEach(seedProject);

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 A fixture that quietly lacks a column, an index or a TRIGGER does not
// produce a weaker test — it produces a CONFIDENT WRONG ANSWER about the
// product. Everything below depends on facts asserted here.

describe('the fixture is the real schema', () => {
  it('every migration that shapes the layout row applied', () => {
    // Named, not pattern-matched: a regex over filenames would either miss one
    // or drag in migrations about unrelated tables, and both answers are
    // useless. These are the files that create or alter `layouts` and the
    // `projects` columns the layout write path reads.
    const MUST_APPLY = [
      '001_initial_schema.sql',                      // layouts + the updated_at trigger
      '096_layout_design_electrical.sql',
      '098_repair_cross_project_layout_coords.sql',
      '101_projects_selected_equipment.sql',
      '122_layout_obstructions_measurements.sql',
      '123_layout_site_archives.sql',
    ];
    const missing = MUST_APPLY.filter(f => SKIPPED.includes(f));
    expect(missing, `these did not apply: ${missing.join(', ')}`).toEqual([]);
  });

  it('layouts has every column the write path writes', async () => {
    const r = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'layouts'`,
    );
    const cols = new Set(r.rows.map(x => x.column_name));
    for (const c of [
      'project_id', 'user_id', 'system_type', 'panels', 'roof_planes',
      'ground_tilt', 'ground_azimuth', 'row_spacing', 'ground_height',
      'fence_azimuth', 'fence_height', 'fence_line', 'bifacial_optimized',
      'total_panels', 'system_size_kw', 'map_center', 'map_zoom',
      'design_electrical', 'obstructions', 'measurements', 'site_archives',
      'created_at', 'updated_at',
    ]) expect(cols.has(c), `layouts.${c} is missing from the fixture`).toBe(true);
  });

  it('🚨 the updated_at TRIGGER is present — without it there is no version at all', async () => {
    const r = await db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'layouts'::regclass AND NOT tgisinternal`,
    );
    expect(r.rows.map(x => x.tgname)).toContain('update_layouts_updated_at');
  });

  it('and it really does move updated_at on every UPDATE', async () => {
    await upsertLayout(save(TWELVE));
    const before = await whatTheTabRead();
    await db.query(`UPDATE layouts SET total_panels = 99 WHERE project_id = $1`, [PROJECT]);
    const after = await whatTheTabRead();
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('the design really is ONE row keyed (project_id, user_id)', async () => {
    await upsertLayout(save(TWELVE));
    await upsertLayout(save(TWELVE.slice(0, 5)));
    const r = await db.query(
      `SELECT id FROM layouts WHERE project_id = $1 AND user_id = $2`, [PROJECT, USER_ID]);
    expect(r.rows).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE DEFECT
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a stale writer must not silently win', () => {
  it('LAYOUT_STALE_WRITE is a named refusal, not a generic failure', () => {
    expect(LAYOUT_REFUSAL_CODES as readonly string[]).toContain('LAYOUT_STALE_WRITE');
  });

  it('two writers, the second one stale — the stale one is REFUSED', async () => {
    // Both tabs load the design. Both hold the same token.
    await upsertLayout(save(TWELVE));
    const tokenBothTabsHold = await whatTheTabRead();

    // Tab A does an hour of work and saves. It holds the current token.
    await upsertLayout(save(TWELVE.concat([panel('melvin-p12'), panel('melvin-p13')]), {
      expectedUpdatedAt: tokenBothTabsHold,
    }));
    expect((await row('panels'))?.panels).toHaveLength(14);

    // Tab B — asleep since before A saved — wakes up and autosaves its own
    // 12-panel view of the world, still holding the OLD token.
    await expect(
      upsertLayout(save(TWELVE, { expectedUpdatedAt: tokenBothTabsHold })),
    ).rejects.toThrow(/^LAYOUT_STALE_WRITE/);

    // 🚨 THE INVARIANT. Tab A's two extra panels are still on disk.
    expect((await row('panels'))?.panels).toHaveLength(14);
  });

  it('and NOTHING of the losing save reached the row', async () => {
    await upsertLayout(save(TWELVE, { mapZoom: 19 }));
    const stale = await whatTheTabRead();
    await upsertLayout(save(TWELVE, { expectedUpdatedAt: stale, mapZoom: 20 }));

    const winner = await row('panels, roof_planes, map_zoom, site_archives, total_panels');

    await expect(upsertLayout(save([panel('x')], {
      expectedUpdatedAt: stale, mapZoom: 3, roofPlanes: [],
      siteArchives: archives({ sites: { [KEY_A]: { faceIds: ['melvin-r0'], sectionIds: [], obstructionIds: [], clearedAt: 1 } } }),
    }))).rejects.toThrow(/^LAYOUT_STALE_WRITE/);

    const after = await row('panels, roof_planes, map_zoom, site_archives, total_panels');
    expect(after).toEqual(winner);
  });

  it('🚨 a stale save carrying a DELETION LEDGER does not stamp it on the winner', async () => {
    // The ledger is written FIRST and proven with RETURNING (the hardening in
    // lib/db/projects.ts for the destructive-save defect). That write must not
    // happen at all when the save is going to be refused for staleness — a
    // refusal that still mutates the winner's site_archives is a different way
    // of losing work.
    await upsertLayout(save(TWELVE));
    const stale = await whatTheTabRead();
    await upsertLayout(save(TWELVE, { expectedUpdatedAt: stale }));   // someone else saves

    await expect(upsertLayout(save([], {
      expectedUpdatedAt: stale,
      roofPlanes: [],
      siteArchives: archives({
        sites: { [KEY_A]: { faceIds: SIX_PLANES.map(p => p.id), sectionIds: [], obstructionIds: [], clearedAt: 1_700_000_000_000 } },
      }),
      destructive: {
        op: 'design', siteKey: KEY_A, faceIds: SIX_PLANES.map(p => p.id),
        sectionIds: [], obstructionIds: [], panelIds: TWELVE.map(p => p.id),
        panelSystemTypes: ['roof'], at: 1_700_000_000_000,
      },
    }))).rejects.toThrow(/^LAYOUT_STALE_WRITE/);

    const r = await row('panels, roof_planes, site_archives');
    expect(r?.panels).toHaveLength(12);
    expect(r?.roof_planes).toHaveLength(6);
    const led = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    expect(Object.keys(led.sites), 'the refused deletion was recorded anyway').toEqual([]);
  });

  it('🚨 a writer that lands between the CHECK and the CLAIM is caught by the claim', async () => {
    // The cheap read at the top of `upsertLayout` passes here — at the instant
    // it ran, the token WAS current. Then someone else saves. A read-then-write
    // check is exactly this wide, and this is the window the whole defect lives
    // in, so the claim has to be one atomic statement rather than a comparison
    // followed by a write.
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();

    interleaveAfter = {
      match: /SELECT id, updated_at\s+FROM layouts/,
      write: () => db.query(
        // A different writer, committing at its own instant — in one process
        // NOW() is the transaction timestamp and would not move, so the
        // intruder is given the later clock two real transactions would have.
        `UPDATE layouts SET panels = '[]'::jsonb, updated_at = NOW() + interval '1 second'
         WHERE project_id = $1`, [PROJECT],
      ),
    };
    try {
      await expect(upsertLayout(save(TWELVE.slice(0, 6), { expectedUpdatedAt: token })))
        .rejects.toThrow(/^LAYOUT_STALE_WRITE/);
    } finally {
      interleaveAfter = null;
    }

    // The intruder's save is what is on disk — untouched by the refused one.
    expect((await row('panels'))?.panels).toHaveLength(0);
  });

  it('🚨 a writer that lands AFTER the claim is still caught before the ledger goes down', async () => {
    // The read-only check at the top of `upsertLayout` cannot see this: the row
    // moves after that SELECT. This is the window the atomic CLAIM and the
    // ledger pre-write's own precondition exist for, and the only way to open
    // it in an in-process database is to make the database itself do the
    // interleaving — the same instrument the deletion-ledger suite uses to
    // simulate a storage failure.
    //
    // The trigger fires on the CLAIM (the one statement that changes nothing
    // but the timestamp) and writes the row again from inside it, which is
    // precisely "someone else saved between your claim and your first write".
    //
    // 🚨 The intruder must land at a DIFFERENT instant, and in one process it
    // does not get one for free: `NOW()` is the TRANSACTION timestamp, so an
    // inner statement reuses the outer one's and `updated_at` never actually
    // moves. Two real writers are two transactions with two commit times, so
    // the second trigger supplies that — it runs at trigger depth > 1 only, and
    // is named to sort after `update_layouts_updated_at` so it wins the
    // BEFORE-trigger order.
    await db.exec(`
      CREATE OR REPLACE FUNCTION intrude_after_claim() RETURNS trigger AS $$
      BEGIN
        IF pg_trigger_depth() = 1
           AND OLD.panels IS NOT DISTINCT FROM NEW.panels
           AND OLD.site_archives IS NOT DISTINCT FROM NEW.site_archives THEN
          UPDATE layouts SET map_zoom = 21 WHERE id = NEW.id;
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION zz_intruder_commits_later() RETURNS trigger AS $$
      BEGIN
        IF pg_trigger_depth() > 1 THEN
          NEW.updated_at := NOW() + interval '1 second';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    await db.exec(`
      CREATE TRIGGER intrude_after_claim AFTER UPDATE ON layouts
      FOR EACH ROW EXECUTE FUNCTION intrude_after_claim();
      CREATE TRIGGER zz_intruder_commits_later BEFORE UPDATE ON layouts
      FOR EACH ROW EXECUTE FUNCTION zz_intruder_commits_later();
    `);
    try {
      await expect(upsertLayout(save([], {
        expectedUpdatedAt: token,
        roofPlanes: [],
        siteArchives: archives({
          sites: { [KEY_A]: { faceIds: SIX_PLANES.map(p => p.id), sectionIds: [], obstructionIds: [], clearedAt: 1 } },
        }),
        destructive: {
          op: 'design', siteKey: KEY_A, faceIds: SIX_PLANES.map(p => p.id),
          sectionIds: [], obstructionIds: [], panelIds: TWELVE.map(p => p.id),
          panelSystemTypes: ['roof'], at: 1,
        },
      }))).rejects.toThrow(/^LAYOUT_STALE_WRITE/);
    } finally {
      await db.exec(`
        DROP TRIGGER IF EXISTS intrude_after_claim ON layouts;
        DROP TRIGGER IF EXISTS zz_intruder_commits_later ON layouts;
      `);
    }

    // 🚨 AND NO TOMBSTONE FOR A FACE THAT IS STILL THERE. A refused save that
    // had already written its ledger would make those six planes disappear from
    // the screen on the next load — `admitAfterHydrate` filters the active
    // bundle against exactly this record.
    const r = await row('panels, roof_planes, site_archives');
    expect(r?.panels).toHaveLength(12);
    expect(r?.roof_planes).toHaveLength(6);
    const led = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    expect(Object.keys(led.sites)).toEqual([]);
  });

  it('the refusal says what happened, in terms the user can act on', async () => {
    await upsertLayout(save(TWELVE));
    const stale = await whatTheTabRead();
    await upsertLayout(save(TWELVE.slice(0, 4), { expectedUpdatedAt: stale }));

    let message = '';
    try { await upsertLayout(save(TWELVE, { expectedUpdatedAt: stale })); }
    catch (e) { message = (e as Error).message; }

    expect(message).toMatch(/^LAYOUT_STALE_WRITE/);
    // WHAT is on the server now, so the user can judge which copy they want.
    expect(message).toMatch(/\b4\b/);
    // WHAT they were trying to write.
    expect(message).toMatch(/\b12\b/);
    // That their own work is not gone — a refusal that reads like a data loss
    // is what makes people close the tab.
    expect(message).toMatch(/nothing has been written/i);
    // And the way out.
    expect(message).toMatch(/reload|refresh|re-?open/i);
  });

  it('the route layer turns it into a 409 with a refusal badge, not a 503', () => {
    const err = new Error('LAYOUT_STALE_WRITE: someone else saved this design.');
    expect(layoutRefusalCode(err)).toBe('LAYOUT_STALE_WRITE');
    const res = handleRouteDbError('[test]', err);
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE MECHANISM MUST NOT WEDGE THE STUDIO
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 ONE LOGICAL SAVE ISSUES UP TO SIX UPDATE STATEMENTS against this row —
// the ledger pre-write, the main write, design_electrical, site_archives,
// obstructions and measurements — and the trigger bumps `updated_at` on EVERY
// one of them. A precondition applied without thinking about that conflicts
// with the save's OWN earlier statement, and then every save in the product is
// refused for ever, by a guard whose tests all pass. These are the tests that
// catch that.

describe('the winner keeps working', () => {
  it('a save with the CURRENT token succeeds', async () => {
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    const saved = await upsertLayout(save(TWELVE.slice(0, 9), { expectedUpdatedAt: token }));
    expect(saved.panels).toHaveLength(9);
  });

  it('and so does the one after it, and the one after that', async () => {
    await upsertLayout(save(TWELVE));
    for (let n = 11; n >= 8; n--) {
      const token = await whatTheTabRead();
      await upsertLayout(save(TWELVE.slice(0, n), { expectedUpdatedAt: token }));
      expect((await row('panels'))?.panels).toHaveLength(n);
    }
  });

  it('a save carrying design entities AND a ledger still round-trips under the precondition', async () => {
    // This is the six-statement save. If the precondition fights itself, it
    // fights itself here.
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    await upsertLayout(save([], {
      expectedUpdatedAt: token,
      roofPlanes: [],
      obstructions: [{ id: 'vent-1', type: 'vent', lat: MELVIN.lat, lng: MELVIN.lng }],
      measurements: [{ id: 'm-1', kind: 'distance', meters: 3 }],
      designElectrical: { panelId: 'test-panel', subSystems: [] },
      siteArchives: archives({
        sites: { [KEY_A]: { faceIds: SIX_PLANES.map(p => p.id), sectionIds: [], obstructionIds: [], clearedAt: 1_700_000_000_000 } },
      }),
      destructive: {
        op: 'design', siteKey: KEY_A, faceIds: SIX_PLANES.map(p => p.id),
        sectionIds: [], obstructionIds: [], panelIds: TWELVE.map(p => p.id),
        panelSystemTypes: ['roof'], at: 1_700_000_000_000,
      },
    }));

    const r = await row('panels, roof_planes, obstructions, measurements, site_archives');
    expect(r?.panels).toHaveLength(0);
    expect(r?.roof_planes).toHaveLength(0);
    expect(r?.obstructions).toHaveLength(1);
    expect(r?.measurements).toHaveLength(1);
    const led = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    expect(led.sites[KEY_A]?.faceIds).toHaveLength(6);
  });

  it('the refused tab recovers by reloading — no permanent lockout', async () => {
    await upsertLayout(save(TWELVE));
    const stale = await whatTheTabRead();
    await upsertLayout(save(TWELVE.slice(0, 4), { expectedUpdatedAt: stale }));
    await expect(upsertLayout(save(TWELVE, { expectedUpdatedAt: stale })))
      .rejects.toThrow(/^LAYOUT_STALE_WRITE/);

    // The studio refetches and tries again with what it now holds.
    const fresh = await whatTheTabRead();
    const ok = await upsertLayout(save(TWELVE, { expectedUpdatedAt: fresh }));
    expect(ok.panels).toHaveLength(12);
  });

  it('🚨 the version a save RETURNS is the one the row actually ends up with', async () => {
    // The trap that would wedge the studio on its second autosave.
    //
    // `upsertLayout` builds its return value from the main UPDATE's RETURNING —
    // and then `applyDesignElectrical` and `applyDesignEntities` write the row
    // up to four more times, each bumping `updated_at` through the trigger. The
    // returned `updatedAt` was therefore a MID-SAVE value that never matches
    // the row. A client that trusted it (the obvious thing to do: take the
    // version out of the save response rather than re-fetching) would have its
    // very next save refused as stale — by its own previous save.
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    const saved = await upsertLayout(save(TWELVE.slice(0, 10), {
      expectedUpdatedAt: token,
      // The fields that trigger the extra writes. This is an ordinary studio
      // save, not a contrived one.
      obstructions: [{ id: 'vent-1', type: 'vent', lat: MELVIN.lat, lng: MELVIN.lng }],
      measurements: [{ id: 'm-1', kind: 'distance', meters: 3 }],
      designElectrical: { panelId: 'test-panel', subSystems: [] },
    }));

    const onDisk = await whatTheTabRead();
    expect(new Date(saved.updatedAt as unknown as string).toISOString()).toBe(onDisk);

    // And the proof that matters: the next save, using only what the previous
    // one handed back, is accepted.
    const next = await upsertLayout(save(TWELVE.slice(0, 8), { expectedUpdatedAt: saved.updatedAt }));
    expect(next.panels).toHaveLength(8);
  });

  it('the FIRST save a project ever makes is not refused for having no token', async () => {
    expect(await row('panels')).toBeNull();
    const saved = await upsertLayout(save(TWELVE, { expectedUpdatedAt: null }));
    expect(saved.panels).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. OPT-IN, AND THE EDGES
// ═══════════════════════════════════════════════════════════════════════════

describe('callers that send no token are unchanged', () => {
  it('🚨 last-write-wins still applies when nobody states a version', async () => {
    // Asserted deliberately, and it is not an endorsement. The admin repair
    // tools, /api/engineering/preliminary and the version-restore route have no
    // client-held version to send; making the precondition mandatory would
    // refuse saves no operator could fix. This test exists so that turning the
    // mechanism on globally is a DECISION someone makes on purpose, not an
    // accident that breaks four routes.
    await upsertLayout(save(TWELVE));
    await upsertLayout(save(TWELVE.slice(0, 3)));
    expect((await row('panels'))?.panels).toHaveLength(3);
  });

  it('a token for a row that no longer exists is refused, not resurrected', async () => {
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    await db.query(`DELETE FROM layouts WHERE project_id = $1`, [PROJECT]);

    await expect(upsertLayout(save(TWELVE, { expectedUpdatedAt: token })))
      .rejects.toThrow(/^LAYOUT_STALE_WRITE/);
    expect(await row('panels')).toBeNull();
  });

  it('a token that is not a date is refused rather than quietly ignored', async () => {
    // 🚨 The failure mode this closes is a guard that can never match. If an
    // unreadable token were dropped on the floor, a client bug would silently
    // return the whole product to last-write-wins while every dashboard said
    // concurrency control was on.
    await upsertLayout(save(TWELVE));
    await expect(upsertLayout(save(TWELVE.slice(0, 2), { expectedUpdatedAt: 'not-a-timestamp' })))
      .rejects.toThrow(/^LAYOUT_STALE_WRITE/);
    expect((await row('panels'))?.panels).toHaveLength(12);
  });

  it('a Date instance and an ISO string are the same token', async () => {
    await upsertLayout(save(TWELVE));
    const iso = await whatTheTabRead();
    const saved = await upsertLayout(save(TWELVE.slice(0, 7), { expectedUpdatedAt: new Date(iso) }));
    expect(saved.panels).toHaveLength(7);
  });

  it('the older refusals still fire, and still win over this one', async () => {
    // A stale save is refused as stale; a CURRENT save that would wipe a
    // sub-system is still refused as a wipe. Neither guard may shadow the other.
    await upsertLayout(save(TWELVE));
    const token = await whatTheTabRead();
    await expect(upsertLayout(save([], { expectedUpdatedAt: token, roofPlanes: [] })))
      .rejects.toThrow(/^LAYOUT_SUBSYSTEM_WIPE/);
    expect((await row('panels'))?.panels).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE REFUSAL REACHES A HUMAN, AND THEIR WORK SURVIVES IT
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 Asserted against the SOURCE, deliberately, following the precedent in
// tests/deletionLedgerPersistence.postgres.test.ts §5: the studio cannot be
// rendered in this suite (Cesium, maps, a live project), and these are textual
// facts anyway — a branch that is not there cannot run, whatever else is true.
//
// A 409 nobody sees is the same as no refusal at all: the autosave would keep
// firing, keep being refused, and the user would carry on designing into a
// layout that is not being saved. That is the failure the badge and the toast
// were built for, and this confirms the new code lands inside them rather than
// beside them.

describe('the studio already knows what to do with this 409', () => {
  const STUDIO = readFileSync(
    join(process.cwd(), 'components', 'design', 'DesignStudio.tsx'), 'utf8',
  );

  it('a 409 is treated as PERMANENT and its reason is put in front of the user', () => {
    const at = STUDIO.indexOf('if (res.status === 409)');
    expect(at, 'the studio has no 409 branch — a stale-write refusal would blink away')
      .toBeGreaterThan(-1);
    const branch = STUDIO.slice(at, at + 1200);
    // The server's own sentence, not a generic "conflict".
    expect(branch).toMatch(/JSON\.parse\(body\)/);
    expect(branch).toMatch(/toast\.error/);
    // Spoken once per distinct reason, because the autosave retries and a
    // repeated warning becomes wallpaper.
    expect(branch).toMatch(/lastRefusalRef/);
  });

  it('🚨 and the losing edit is already on disk locally BEFORE the request leaves', () => {
    // This is what makes a refusal honest rather than a data loss: the message
    // says the user's edits are still there, and they are — the studio writes
    // the whole payload to localStorage before it POSTs, so a refused save can
    // be re-applied after a reload.
    const local = STUDIO.indexOf('localSaveLayout(project.id, payload)');
    const post  = STUDIO.indexOf('/layout`, {', local);
    expect(local).toBeGreaterThan(-1);
    expect(post, 'the local save must come BEFORE the POST it protects').toBeGreaterThan(local);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THROUGH A REAL ROUTE
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/production carries the precondition end to end', () => {
  async function postProduction(layout: Record<string, unknown>) {
    const res = await PRODUCTION_POST(new Request('http://localhost/api/production', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT, layout }),
    }) as unknown as import('next/server').NextRequest);
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  }

  const layoutBody = (panels: unknown[], expectedUpdatedAt?: unknown) => ({
    systemType: 'roof', panels, roofPlanes: SIX_PLANES,
    mapCenter: MELVIN, mapZoom: 19,
    obstructions: [], measurements: [], siteArchives: archives(),
    systemSizeKw: panels.length * 0.4,
    ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
  });

  it('a stale Save button gets a 409 with the named code — not a 500', async () => {
    await upsertLayout(save(TWELVE));
    const stale = await whatTheTabRead();
    await upsertLayout(save(TWELVE.slice(0, 5), { expectedUpdatedAt: stale }));

    const res = await postProduction(layoutBody(TWELVE, stale));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('LAYOUT_STALE_WRITE');
    expect(res.json.refused).toBe(true);
    expect((await row('panels'))?.panels).toHaveLength(5);
  });

  it('and the same request with the current token is accepted', async () => {
    await upsertLayout(save(TWELVE));
    const res = await postProduction(layoutBody(TWELVE.slice(0, 5), await whatTheTabRead()));
    expect(res.status).toBe(200);
    expect((await row('panels'))?.panels).toHaveLength(5);
  });

  // 🚨 THE ROUTE HAS TWO WRITE PATHS AND THEY FORWARD FIELDS DIFFERENTLY.
  //
  // A project with no client spreads the client's layout wholesale
  // (`{...rawLayout, projectId, userId}`), so a new field arrives for free. A
  // project WITH a client is forwarded field by field — the branch where
  // `obstructions`, `measurements`, `siteArchives` and the delete authorization
  // were each silently dropped before someone noticed. Testing only the spread
  // path proves nothing about the branch that actually needs the wiring, and
  // real projects have clients.
  describe('with a client on the project — the field-by-field branch', () => {
    const CLIENT = '22222222-2222-4222-8222-222222222222';
    beforeEach(async () => {
      await db.query(
        `INSERT INTO clients (id, user_id, name, email, lat, lng, utility_rate)
         VALUES ($1,$2,'Braidon','b@e.st',$3,$4,0.13)`,
        [CLIENT, USER_ID, MELVIN.lat, MELVIN.lng],
      );
      await db.query(`UPDATE projects SET client_id = $1 WHERE id = $2`, [CLIENT, PROJECT]);
    });

    it('a stale Save is refused here too', async () => {
      await upsertLayout(save(TWELVE));
      const stale = await whatTheTabRead();
      await upsertLayout(save(TWELVE.slice(0, 5), { expectedUpdatedAt: stale }));

      const res = await postProduction(layoutBody(TWELVE, stale));
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('LAYOUT_STALE_WRITE');
      expect((await row('panels'))?.panels).toHaveLength(5);
    });

    it('and a current one goes through', async () => {
      await upsertLayout(save(TWELVE));
      const res = await postProduction(layoutBody(TWELVE.slice(0, 5), await whatTheTabRead()));
      expect(res.status).toBe(200);
      expect((await row('panels'))?.panels).toHaveLength(5);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ONE THING THIS FIXTURE CANNOT SEE BY ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the millisecond truncation is load-bearing, and PGlite hides that', () => {
  /**
   * 🚨 THIS BLOCK EXISTS BECAUSE EVERY OTHER TEST IN THIS FILE PASSES WITHOUT
   * THE TRUNCATION.
   *
   * The claim compares `date_trunc('milliseconds', updated_at)` against
   * `date_trunc('milliseconds', $token)`. Replace that with a plain
   * `updated_at = $token` and this whole suite stays green — while production
   * refuses every single versioned save, for ever. That is the precise shape of
   * a guard that can never match, and it would have read as concurrency control
   * working perfectly right up until nobody could save.
   *
   * The reason the fixture cannot see it: PGlite's `now()` resolves to
   * MILLISECONDS, so the trigger only ever writes values that already have a
   * zero sub-millisecond component and truncating them changes nothing. Real
   * PostgreSQL — including Neon — stores `timestamptz` to the MICROSECOND, and
   * `now()` returns one. The token makes a round trip through a JavaScript
   * `Date` on the way to the client and back (`whatTheTabRead`, and
   * `Layout.updatedAt` in the browser), and a JS `Date` holds milliseconds.
   * Those trailing microseconds are gone by the time the token comes home.
   *
   * Measured in this very fixture, on a value with a real microsecond
   * component: exact comparison matches 0 rows, truncated comparison matches 1.
   *
   * So these cases write the microseconds themselves rather than waiting for a
   * clock that will never produce them. The trigger is suspended for exactly
   * that one statement — it forces `NEW.updated_at = NOW()` on every UPDATE and
   * would otherwise stamp the coarse value straight back over the fixture.
   */

  /** Give the stored row a timestamp real Postgres would produce, and PGlite won't. */
  async function stampWithMicroseconds(literal: string) {
    await db.exec(`ALTER TABLE layouts DISABLE TRIGGER update_layouts_updated_at;`);
    try {
      await db.query(`UPDATE layouts SET updated_at = $1::timestamptz WHERE project_id = $2`,
        [literal, PROJECT]);
    } finally {
      await db.exec(`ALTER TABLE layouts ENABLE TRIGGER update_layouts_updated_at;`);
    }
  }

  it('the fixture really did get sub-millisecond precision', async () => {
    // A positive control for the control. If PGlite ever starts truncating
    // these on the way in, the two cases below would pass for the wrong reason
    // and this file would be back to proving nothing.
    await upsertLayout(save(TWELVE));
    await stampWithMicroseconds('2026-01-01 00:00:00.123456+00');

    const r = await db.query<{ as_text: string }>(
      `SELECT updated_at::text AS as_text FROM layouts WHERE project_id = $1`, [PROJECT]);
    expect(r.rows[0].as_text, 'PGlite dropped the microseconds — the cases below are now vacuous')
      .toMatch(/\.123456/);

    // ...and that the client's token genuinely loses them.
    expect(await whatTheTabRead()).toBe('2026-01-01T00:00:00.123Z');
  });

  it('🚨 a save whose token lost its microseconds is ACCEPTED, not refused', async () => {
    await upsertLayout(save(TWELVE));
    await stampWithMicroseconds('2026-01-01 00:00:00.123456+00');

    // Exactly what a browser tab holds and sends back.
    const token = await whatTheTabRead();
    expect(token.endsWith('.123Z')).toBe(true);

    await upsertLayout(save(TWELVE.slice(0, 5), { expectedUpdatedAt: token }));

    expect((await row('panels'))?.panels,
      'the rightful owner of the row was refused its own save — the version comparison ' +
      'is stricter than the precision the token can carry')
      .toHaveLength(5);
  });

  it('and a genuinely stale token is still refused at that precision', async () => {
    // The complement: loosening to milliseconds must not loosen so far that a
    // real conflict slips through. Two saves a full second apart differ well
    // above the truncation, so the refusal must stand.
    await upsertLayout(save(TWELVE));
    await stampWithMicroseconds('2026-01-01 00:00:00.123456+00');
    const stale = await whatTheTabRead();

    await stampWithMicroseconds('2026-01-01 00:00:01.999999+00');

    await expect(upsertLayout(save(TWELVE.slice(0, 5), { expectedUpdatedAt: stale })))
      .rejects.toThrow(/LAYOUT_STALE_WRITE/);
    expect((await row('panels'))?.panels, 'the losing save wrote anyway').toHaveLength(12);
  });

  it('a token differing only BELOW the millisecond is the same version', async () => {
    // The truncation is a deliberate widening, so say what it admits: two
    // timestamps inside the same millisecond are one version. Without this the
    // rule could be narrowed back to microseconds and only the two cases above
    // would complain, both of which could be read as fixture quirks.
    await upsertLayout(save(TWELVE));
    await stampWithMicroseconds('2026-01-01 00:00:00.123999+00');

    await upsertLayout(save(TWELVE.slice(0, 5), { expectedUpdatedAt: '2026-01-01T00:00:00.123Z' }));
    expect((await row('panels'))?.panels).toHaveLength(5);
  });
});
