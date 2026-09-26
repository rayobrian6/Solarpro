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
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DEV_SESSION_USER } from '@/lib/dev-auth';

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

/**
 * The dev-bypass user and the project the browser harness opens. Both are real
 * rows in a real table; the layout route rejects anything that is not a UUID.
 *
 * 🚨 THE ID COMES FROM `lib/dev-auth`, NOT FROM A LITERAL HERE.
 *
 * This file used to seed '11111111-1111-4111-8111-111111111111' — a FIFTH copy
 * of the dev user's identity, and a different one from the four in the app.
 * Someone had already hit the UUID problem here (hence the comment above) and
 * worked around it by inventing a UUID for the harness instead of fixing
 * `DEV_SESSION_USER`, which was still the string 'dev-user-bypass-001'.
 *
 * So the harness seeded one user and the bypass authenticated as another: the
 * seeded project existed and was owned by somebody who never made a request,
 * and every ownership check against it failed. An end-to-end run found it the
 * moment `DEV_SESSION_USER.id` became a real UUID and the two ids could finally
 * be compared at all.
 *
 * One identity, one declaration. `DEV_AUTH_USER_ID` still overrides it, and now
 * it overrides BOTH sides at once, which is what an override is for.
 */
export const LOCAL_USER_ID    = DEV_SESSION_USER.id;
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
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INTERCEPTOR, AND WHY IT IS AN ACCESSOR RATHER THAN AN ASSIGNMENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 🚨 `next dev` PUTS `globalThis.fetch` BACK ON EVERY RECOMPILE. MEASURED, NOT
 *    GUESSED — `next/dist/server/lib/router-server.js`:
 *
 *      let originalFetch = globalThis.fetch;            // router-server start
 *      const resetFetch = () => {
 *        globalThis.fetch = originalFetch;
 *        globalThis[NEXT_PATCH_SYMBOL] = false;
 *      };
 *
 *    `resetFetch` is handed to the hot reloader, which calls it from the
 *    `done` hook whenever a server component, a CSS import or an invalidation
 *    changes (`dist/server/dev/hot-reloader-webpack.js`, and the Turbopack
 *    reloader does the same). It exists to drop Next's own fetch-cache patch.
 *
 *    `originalFetch` is captured when the ROUTER server starts, which is
 *    strictly before `instrumentation.register()` runs — so it is the pristine
 *    undici fetch, from before this bridge existed. The first recompile of a
 *    session therefore threw the bridge away, permanently, and every query
 *    after it went to the network and died on
 *
 *        getaddrinfo ENOTFOUND api.invalid
 *
 *    which reads exactly like a missing credential. That is why the harness
 *    could log five confident success lines and still not be armed by the time
 *    a test ran: `next dev` recompiles when ANY watched file changes, including
 *    Playwright writing `test-results/` into the tree.
 *
 * A plain `globalThis.fetch = wrapper` cannot survive that. An accessor can:
 * the getter always answers with the bridge, and the setter treats every
 * assignment as "here is the new downstream" instead of "you are fired".
 *
 * WHY THE SETTER RE-WRAPS instead of just remembering the value: Next's
 * `patchFetch` does `globalThis.fetch = patched(dedupe(globalThis.fetch))`. If
 * the getter kept returning a bridge that delegated to that value, a non-Neon
 * request would go bridge → patched → dedupe → bridge → patched → … forever.
 * Re-wrapping gives the new chain a fresh bridge on top, so each call walks the
 * chain exactly once. The chain cannot grow without bound either, because
 * `resetFetch` always assigns the SAME pristine function, which the setter
 * recognises and collapses back to the one-layer base bridge.
 *
 * Everything the original comment said about `neonConfig.fetchFunction` and
 * `serverExternalPackages` still holds, and neither is used:
 *
 *   • `neonConfig` is per-bundle. Next bundles `@neondatabase/serverless` into
 *     each server chunk separately, so the instance the instrumentation hook
 *     writes to is not the instance a route handler reads. Setting it looks
 *     like it works and changes nothing.
 *   • `serverExternalPackages` would change how a core dependency is bundled in
 *     PRODUCTION to make a local test work. That trade is the wrong way round.
 *
 * `globalThis` is the one object every bundle shares, and the driver identifies
 * itself with a `Neon-Connection-String` header that nothing else sends — the
 * header is passed in `init`, on a plain object, verified against the installed
 * driver (`@neondatabase/serverless` 0.10.4 calls `(fetchFunction ?? fetch)(url,
 * {method, body, headers})`), so the match is exact and every other fetch in the
 * process is untouched.
 */
export const BRIDGE_TAG = Symbol.for('solarpro.localPg.fetchBridge');

/** Neon requests this process has actually answered from PGlite. */
let intercepted = 0;
/** How many times something replaced `fetch` and we climbed back on top. */
let rearms = 0;

type Fetch = typeof globalThis.fetch;

function isBridge(f: unknown): boolean {
  return typeof f === 'function' && (f as unknown as Record<symbol, unknown>)[BRIDGE_TAG] === true;
}

/** A fetch that answers Neon requests from PGlite and forwards everything else. */
function makeBridge(inner: Fetch): Fetch {
  const bridged = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? undefined);
    if (!headers.has('neon-connection-string')) {
      if (process.env.LOCAL_PG_TRACE === '1') {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
        console.log(`[LOCAL_PG_TRACE] forward ${url}`);
      }
      return inner(input as RequestInfo, init);
    }
    intercepted++;
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
  }) as Fetch;
  (bridged as unknown as Record<symbol, unknown>)[BRIDGE_TAG] = true;
  return bridged;
}

/**
 * Install (or re-install) the accessor that keeps the bridge on top of `fetch`.
 *
 * Exported for `tests/pgliteNeonBridgeFetchAccessor.test.ts`, which asserts the
 * one property the whole harness rests on — that a later `globalThis.fetch = …`
 * cannot unseat it. That test exists because the bug it locks down was invisible:
 * the bridge logged success and then stopped working several seconds later.
 */
export function installFetchAccessor(): void {
  const pristine = globalThis.fetch;
  const baseBridge = makeBridge(pristine);
  let current: Fetch = baseBridge;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    enumerable: true,
    get(): Fetch { return current; },
    set(next: Fetch) {
      if (typeof next !== 'function') return;
      if (isBridge(next)) { current = next; return; }
      rearms++;
      if (process.env.LOCAL_PG_TRACE === '1') {
        console.log(`[LOCAL_PG_TRACE] fetch was replaced (${next.name || 'anonymous'}) — bridge re-armed, total ${rearms}`);
      }
      // `resetFetch` always hands back the SAME pristine function, so collapse
      // to the one-layer bridge rather than stacking another wrapper on it.
      current = next === pristine ? baseBridge : makeBridge(next);
    },
  });
}

/**
 * 🚨 THE POSITIVE SELF-CHECK — "armed" IS A MEASUREMENT, NOT A LOG LINE.
 *
 * The failure this exists to catch is not a crash. It is a harness that prints
 * five success lines and then quietly serves a DNS error that a reader
 * diagnoses as a missing credential — the exact wrong conclusion the readiness
 * ledger already had to correct once.
 *
 * So the claim is tested rather than asserted: build a `neon()` client the same
 * way a route handler does, from the same package and the same `DATABASE_URL`,
 * send it a nonce, and require BOTH that the nonce comes back AND that this
 * module's own intercept counter moved. A nonce alone would be satisfied by any
 * Postgres that echoed it; the counter alone would be satisfied by a request
 * that never produced an answer. Together they can only be true if the query
 * was answered here.
 *
 * What it cannot prove: that some OTHER server chunk resolves `fetch` to
 * something other than `globalThis`. Nothing observed does — the trace shows
 * every route's driver arriving here — and the watchdog re-runs this check for
 * the life of the process, so a later divergence is reported rather than
 * inferred from a 503.
 */
async function verifyInterception(): Promise<string | null> {
  const before = intercepted;
  const nonce = randomUUID();
  try {
    const sql = neon(process.env.DATABASE_URL as string);
    const rows = (await sql`SELECT ${nonce}::text AS nonce`) as Array<{ nonce?: string }>;
    if (rows?.[0]?.nonce !== nonce) return 'the nonce did not come back from the query';
    if (intercepted === before) return 'the query was answered by something other than the in-process database';
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

function shout(lines: string[]): void {
  const bar = '━'.repeat(74);
  console.error(`\n${bar}`);
  for (const l of lines) console.error(l);
  console.error(`${bar}\n`);
}

/** Re-check periodically, say so unmistakably if it ever stops being true. */
function startWatchdog(): void {
  const everyMs = Number(process.env.LOCAL_PG_WATCHDOG_MS ?? 15_000);
  if (!Number.isFinite(everyMs) || everyMs <= 0) return;
  let shouting = false;
  const timer = setInterval(() => {
    void (async () => {
      let why = await verifyInterception();
      if (!why) { shouting = false; return; }
      // Something took `fetch` away by a route this accessor does not cover.
      // Climb back on and re-measure before saying anything.
      if (!isBridge(globalThis.fetch)) { installFetchAccessor(); why = await verifyInterception(); }
      if (!why) { shouting = false; return; }
      if (shouting) return;            // say it once per outage, not every tick
      shouting = true;
      shout([
        '[LOCAL_PG] 🚨 THE HARNESS IS NOT INTERCEPTING. IT IS NOT A DATABASE',
        '[LOCAL_PG]    CREDENTIAL PROBLEM AND RETRYING WILL NOT HELP.',
        `[LOCAL_PG]    reason: ${why}`,
        `[LOCAL_PG]    queries served here so far: ${intercepted}; times fetch was replaced: ${rearms}`,
        '[LOCAL_PG]    Every query is now going to the real network, where the',
        '[LOCAL_PG]    harness host cannot resolve — expect ENOTFOUND, not auth',
        '[LOCAL_PG]    failures. Any test result produced from here is void.',
        '[LOCAL_PG]    Restart the server; if it recurs, the interception seam',
        '[LOCAL_PG]    in lib/dev/pgliteNeonBridge.ts no longer matches Next.',
      ]);
    })();
  }, everyMs);
  (timer as unknown as { unref?: () => void }).unref?.();
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

  // 🚨 ONE DATABASE PER PROCESS, NOT ONE PER MODULE INSTANCE.
  //
  // `next dev` re-instantiates server modules on recompile, which resets every
  // module-level variable in this file. Without a process-wide slot a second
  // recompile would boot a SECOND, EMPTY PGlite and re-point the driver at it,
  // and every row written before that moment would appear to have vanished —
  // a data-loss symptom with a build-system cause.
  const slot = globalThis as typeof globalThis & { __SOLARPRO_LOCAL_PG__?: Promise<PGlite> };
  if (booting) { await booting; return; }
  booting = slot.__SOLARPRO_LOCAL_PG__ ?? (slot.__SOLARPRO_LOCAL_PG__ = boot());
  db = await booting;

  installFetchAccessor();

  const why = await verifyInterception();
  if (why) {
    shout([
      '[LOCAL_PG] 🚨 THE BRIDGE DID NOT ARM. REFUSING TO PRETEND OTHERWISE.',
      `[LOCAL_PG]    reason: ${why}`,
      '[LOCAL_PG]    A trivial query was sent through the same driver a route',
      '[LOCAL_PG]    handler uses and it was NOT answered by the in-process',
      '[LOCAL_PG]    database. Nothing run against this server tests anything.',
    ]);
    throw new Error(`[LOCAL_PG] interception self-check failed: ${why}`);
  }

  startWatchdog();
  console.log(
    `[LOCAL_PG] VERIFIED — a query issued through @neondatabase/serverless was answered ` +
    `by the in-process database (pid ${process.pid}); re-checked every ` +
    `${process.env.LOCAL_PG_WATCHDOG_MS ?? 15_000}ms`,
  );
}
