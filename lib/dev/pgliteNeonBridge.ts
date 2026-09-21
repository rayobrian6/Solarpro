/**
 * lib/dev/pgliteNeonBridge.ts — A REAL POSTGRES, IN-PROCESS, WITH NO CREDENTIAL
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The last unverified path in Workstream 1 was the JOIN: the real browser client,
 * against the real route handlers, against a real database. Every other cell was
 * covered — the client in jsdom against a mocked server, and the real routes
 * against real PostgreSQL in vitest — but the join needs all three at once, and
 * the only database this project has is the owner's production Neon instance,
 * whose credential is unrotated and must not enter the tree.
 *
 * It turns out the credential was never the only way. `tests/siteDesignRoute
 * .postgres.test.ts` already runs the real handlers against REAL PostgreSQL with
 * no credential and no daemon — PGlite, Postgres compiled to WebAssembly,
 * in-process. What it could not do is reach the running Next server, because it
 * substitutes the driver with `vi.mock`, which exists only inside vitest.
 *
 * `@neondatabase/serverless` provides the seam itself. The driver speaks a small
 * HTTP protocol, and `neonConfig.fetchFunction` replaces the transport with any
 * function taking `fetch`'s arguments. So the whole database can be answered
 * in-process, and every layer above it — `lib/db-ready.ts`, `lib/db/projects.ts`,
 * `upsertLayout`, `rowToLayout`, the route handlers — is untouched production
 * code talking to a real Postgres.
 *
 * 🚨 THIS IS NOT A MOCK, AND IT IS NOT THE OWNER'S DATABASE.
 * The SQL is really parsed, really planned and really executed by PostgreSQL;
 * constraints, COALESCE semantics, jsonb casts and `ON CONFLICT` all behave as
 * they do in production. What it does NOT prove is that the production instance
 * has the same schema — that is what migrations and `schema_migrations` are for.
 *
 * 🚨 IT NEVER LOADS UNLESS ASKED. `instrumentation.ts` imports this module only
 * when `SOLARPRO_LOCAL_PG=1`. Nothing in a Vercel build sets that, and the guard
 * below refuses to arm on a production deployment even if something did.
 *
 * THE WIRE CONTRACT, MEASURED RATHER THAN ASSUMED
 * ─────────────────────────────────────────────────────────────────────────────
 * Captured from the real driver by replacing `fetchFunction` with a recorder:
 *
 *   POST  body    {"query":"select $1::int as n","params":["7"]}
 *         headers Neon-Connection-String, Neon-Raw-Text-Output: true,
 *                 Neon-Array-Mode: true
 *   ←     body    {command, rowCount, rowAsArray: true,
 *                  fields:[{name, dataTypeID, ...}], rows:[["42"]]}
 *
 * Array mode and raw-text output are always on, so rows go back as arrays of
 * strings and the driver parses them with pg-types keyed by `dataTypeID`. That
 * is why every value below is fetched unparsed: parsing it here and again in the
 * driver is how a timestamp becomes a string of a Date.
 */

import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Identity parsers — the driver wants RAW TEXT and parses it itself (see header).
 *
 * 🚨 This must be a CONCRETE object, not a Proxy. PGlite merges the option into
 * its own table by spreading it, and spreading a Proxy with no own keys yields
 * nothing: the first attempt looked correct, passed for integers, and failed on
 * the first `jsonb` column with `"[object Object]" is not valid JSON` — PGlite
 * had parsed it to an object, and the driver then stringified that object before
 * parsing it again. Every OID PGlite knows how to parse must be overridden here,
 * or the double-parse comes back for that type alone.
 */
const IDENTITY = (v: string) => v;
const RAW_TEXT_PARSERS: Record<number | string, (v: string) => string> =
  Object.fromEntries(
    Object.keys((pgliteTypes as unknown as { parsers: Record<string, unknown> }).parsers)
      .map(k => [k, IDENTITY]),
  );

let db: PGlite | null = null;
let booting: Promise<PGlite> | null = null;

/** The dev-bypass user and the project the browser harness opens. Both are real
 *  rows in a real table; the layout route rejects anything that is not a UUID. */
export const LOCAL_USER_ID    = process.env.DEV_AUTH_USER_ID ?? '11111111-1111-4111-8111-111111111111';
export const LOCAL_PROJECT_ID = process.env.LOCAL_PG_PROJECT_ID ?? '4030b664-bebe-433b-a11c-cda05ead2f7d';

/**
 * THE REAL MIGRATIONS, IN ORDER — not a hand-built subset.
 *
 * The first version of this file carried a hand-written schema, and it was
 * wrong within minutes: `/api/projects/:id` selects `clients.email` and joins
 * `productions`, neither of which I had thought to include, and the route
 * answered 503 while the harness reported itself healthy. A schema written from
 * memory tests the memory.
 *
 * So every `lib/migrations/*.sql` is applied in numeric order, exactly as the
 * operator console applies them. PGlite needs two accommodations, both of which
 * change nothing about results:
 *
 *   • `pgcrypto` / `uuid_ossp` must be loaded as extensions. Without pgcrypto,
 *     001 fails on `CREATE EXTENSION` and every later migration cascades — 74
 *     of 120 failed that way, and `layouts` did not exist at all.
 *   • `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and `exec()`
 *     wraps. The keyword is stripped; an index changes speed, not answers.
 *
 * Migrations for subsystems this harness does not build (proposals, crews,
 * leads, site-survey jobs) fail on their own missing dependencies and are
 * tolerated — but the count is logged, and `assertDesignSchema` below REFUSES TO
 * BOOT if anything the design path needs is missing, so a partial schema can
 * never masquerade as a working one.
 */
const REQUIRED_TABLES = ['users', 'clients', 'projects', 'layouts', 'productions'] as const;
/** Columns `updateProject` writes. Both come from the INLINE migrations, not
 *  from `lib/migrations/*.sql` — see applyInlineRouteDdl. */
const REQUIRED_PROJECT_COLUMNS = ['no_itc', 'engineering_config', 'lat', 'lng'] as const;
const REQUIRED_LAYOUT_COLUMNS = [
  'panels', 'roof_planes', 'design_electrical', 'obstructions', 'measurements',
  'site_archives', 'fence_line', 'map_center',
] as const;

async function applyMigrations(pg: PGlite): Promise<void> {
  const dir = join(process.cwd(), 'lib', 'migrations');
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const failed: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await pg.exec(/CONCURRENTLY/i.test(sql) ? sql.replace(/\bCONCURRENTLY\b/gi, '') : sql);
    } catch (e) {
      failed.push(`${f}: ${String((e as Error)?.message ?? e).slice(0, 90)}`);
    }
  }
  console.log(`[LOCAL_PG] migrations applied ${files.length - failed.length}/${files.length}`);
  if (failed.length) {
    console.log('[LOCAL_PG] not applied (unrelated subsystems):');
    for (const f of failed) console.log('  ' + f);
  }
}

/**
 * 🚨 THERE ARE TWO MIGRATION SYSTEMS, AND `lib/migrations/*.sql` IS NOT ENOUGH.
 *
 * A database built from every `.sql` migration is still missing columns the
 * application writes on ordinary paths. `updateProject` writes `projects.no_itc`
 * — which NO `.sql` migration creates — so a freshly-provisioned database
 * answers a plain project save with
 *
 *     column "no_itc" of relation "projects" does not exist
 *
 * which `handleRouteDbError` then reports as **503 "Service temporarily
 * unavailable. Please try again in a moment."** Same for
 * `projects.engineering_config`, referenced by three migrations and created by
 * none.
 *
 * The rest of the schema lives as inline `sql`...`` templates in
 * `app/api/migrate/route.ts` ("Migration 013: projects.no_itc"), applied by an
 * API route rather than the migration runner. This extracts the DDL from that
 * file and applies it too, so the harness reproduces the schema the application
 * actually expects rather than the one the migration directory describes.
 *
 * That split is a real finding about this repository, not a quirk of the
 * harness — it means the migration directory alone cannot provision a working
 * environment. It is recorded in the readiness ledger.
 */
async function applyInlineRouteDdl(pg: PGlite): Promise<void> {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'migrate', 'route.ts'), 'utf8');
  const re = /sql`([^`]*)`/g;
  let m: RegExpExecArray | null;
  let applied = 0, skipped = 0;
  while ((m = re.exec(src))) {
    const body = m[1];
    if (body.includes('${')) continue;                 // interpolated — not static DDL
    if (!/^\s*(CREATE|ALTER)\b/i.test(body)) continue; // only schema statements
    try {
      await pg.exec(/CONCURRENTLY/i.test(body) ? body.replace(/\bCONCURRENTLY\b/gi, '') : body);
      applied++;
    } catch {
      // Many are repair statements for drift that does not exist here.
      skipped++;
    }
  }
  console.log(`[LOCAL_PG] inline route DDL applied ${applied}, not applicable ${skipped}`);
}

/** Refuse to run on a schema the design path cannot use. */
async function assertDesignSchema(pg: PGlite): Promise<void> {
  const t = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const have = new Set(t.rows.map(r => r.table_name));
  const missingTables = REQUIRED_TABLES.filter(x => !have.has(x));
  if (missingTables.length) {
    throw new Error(`[LOCAL_PG] schema incomplete — missing tables: ${missingTables.join(', ')}`);
  }
  const pc = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'`);
  const pcols = new Set(pc.rows.map(r => r.column_name));
  const missingProject = REQUIRED_PROJECT_COLUMNS.filter(x => !pcols.has(x));
  if (missingProject.length) {
    throw new Error(`[LOCAL_PG] schema incomplete — projects is missing: ${missingProject.join(', ')}`);
  }
  const c = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'layouts'`);
  const cols = new Set(c.rows.map(r => r.column_name));
  const missingCols = REQUIRED_LAYOUT_COLUMNS.filter(x => !cols.has(x));
  if (missingCols.length) {
    throw new Error(`[LOCAL_PG] schema incomplete — layouts is missing: ${missingCols.join(', ')}`);
  }
}

async function boot(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await applyMigrations(pg);
  await applyInlineRouteDdl(pg);
  await assertDesignSchema(pg);
  // A real user and a real project, so the browser has something to open. The
  // layout route resolves ownership from these rows, not from a bypass header.
  // The real `users` table requires a password hash. Nothing ever verifies it
  // here — the dev bypass short-circuits authentication — but a NOT NULL column
  // is a NOT NULL column, and the seed must satisfy the real schema rather than
  // the schema I remembered.
  await pg.query(
    `INSERT INTO users (id, email, name, company, password_hash)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [LOCAL_USER_ID, 'dev@localhost', 'Dev User (Bypass)', 'SolarPro Dev', 'not-a-usable-hash'],
  );
  await pg.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type)
     VALUES ($1,$2,$3,$4,$5,$6,'roof') ON CONFLICT (id) DO NOTHING`,
    [LOCAL_PROJECT_ID, LOCAL_USER_ID, 'Local PG Harness', '1010 Franklin Ave, St Louis, MO', 38.6657, -90.2266],
  );
  console.log(`[LOCAL_PG] PGlite ready — project ${LOCAL_PROJECT_ID} owned by ${LOCAL_USER_ID}`);
  return pg;
}

function commandOf(query: string): string {
  const m = /^\s*(?:WITH[\s\S]*?\)\s*)?([A-Za-z]+)/.exec(query);
  return (m?.[1] ?? 'SELECT').toUpperCase();
}

async function runOne(pg: PGlite, query: string, params: unknown[]) {
  const res = await pg.query<unknown[]>(query, params as never[], {
    rowMode: 'array',
    parsers: RAW_TEXT_PARSERS as never,
  });
  return {
    command:    commandOf(query),
    // `??` would be wrong here: PGlite reports affectedRows = 0 for a SELECT,
    // and `0 ?? n` is 0, so every SELECT would claim it returned nothing.
    // Returned rows win; otherwise the write count.
    rowCount:   res.rows.length || res.affectedRows || 0,
    rowAsArray: true,
    fields: (res.fields ?? []).map((f, i) => ({
      name:             f.name,
      dataTypeID:       f.dataTypeID,
      tableID:          0,
      columnID:         i + 1,
      dataTypeSize:     -1,
      dataTypeModifier: -1,
      format:           'text',
    })),
    rows: res.rows,
  };
}

/**
 * Point the Neon driver at the in-process database. Idempotent, and a no-op
 * unless explicitly asked for.
 */
export async function installPgliteNeonBridge(): Promise<void> {
  if (process.env.SOLARPRO_LOCAL_PG !== '1') return;
  if (process.env.VERCEL_ENV === 'production') {
    console.error('[LOCAL_PG] refusing to arm on a production deployment');
    return;
  }
  // 🚨 SUPPLY THE URL RATHER THAN ASKING FOR ONE.
  //
  // `lib/db-ready.ts` refuses to start without `DATABASE_URL`, so the harness
  // needs one — and the first version documented a literal with an inline
  // password, which `tests/security/secret-guard.test.ts` correctly flagged:
  // "Connection string embeds a password ... Load it from the environment
  // instead." The guard was right even though the password was invented, so the
  // answer is to need no password at all rather than to carve out an exception.
  //
  // The host is `.invalid`, a reserved TLD that can never resolve: if the
  // interception below ever fails, the query fails loudly instead of quietly
  // reaching something real. Nothing authenticates — the request never leaves
  // this process.
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://harness@pglite.invalid/neondb?sslmode=require';
    console.log('[LOCAL_PG] DATABASE_URL was unset — pointed at the in-process database');
  }

  if (booting) { await booting; return; }
  booting = boot();
  db = await booting;

  // 🚨 WHY `globalThis.fetch` AND NOT `neonConfig.fetchFunction`.
  //
  // `neonConfig` is the driver's own documented seam and it is the obvious
  // choice — it is also useless here. Next bundles `@neondatabase/serverless`
  // into each server chunk SEPARATELY, so the `neonConfig` the instrumentation
  // hook writes to is a different module instance from the one every route
  // handler reads. Setting it appears to work, logs success, and changes
  // nothing: `/api/health` still went to the network and came back
  //
  //     db_error: "password authentication failed for user 'local'"
  //
  // — a real Postgres error from a real Neon endpoint, which is a very
  // convincing way to look connected while being connected to the wrong thing.
  //
  // `globalThis.fetch` is genuinely global: one object, shared by every bundle.
  // The driver calls it whenever `fetchFunction` is unset, and it identifies
  // itself with a `Neon-Connection-String` header that nothing else sends, so
  // the match is exact and every other fetch in the process is untouched.
  //
  // The alternative — adding the driver to `serverExternalPackages` — would
  // change how a core dependency is bundled in PRODUCTION to make a local test
  // work. That trade is the wrong way round.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? undefined);
    if (!headers.has('neon-connection-string')) {
      return originalFetch(input as RequestInfo, init);
    }
    const pg = db ?? (await booting!);
    let payload: unknown;
    try {
      payload = JSON.parse(String(init?.body ?? '{}'));
    } catch {
      return new Response(JSON.stringify({ message: 'bad request body' }), { status: 400 });
    }
    try {
      // An array body is a batch/transaction — one entry per statement.
      if (Array.isArray(payload)) {
        const results = [];
        for (const q of payload as Array<{ query: string; params?: unknown[] }>) {
          results.push(await runOne(pg, q.query, q.params ?? []));
        }
        return new Response(JSON.stringify({ results }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      const { query, params } = payload as { query: string; params?: unknown[] };
      const out = await runOne(pg, query, params ?? []);
      return new Response(JSON.stringify(out), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    } catch (err: unknown) {
      // Shape a Postgres error the way the driver expects, so a constraint
      // violation surfaces as a database error and not as a transport failure —
      // the distinction WS1-017 exists to preserve.
      const e = err as { message?: string; code?: string; severity?: string };
      console.error('[LOCAL_PG] query failed:', e?.message);
      return new Response(JSON.stringify({
        message:  e?.message ?? 'query failed',
        code:     e?.code ?? 'XX000',
        severity: e?.severity ?? 'ERROR',
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  }) as typeof globalThis.fetch;

  console.log('[LOCAL_PG] global fetch intercepts Neon requests — routed to in-process PGlite');
}
