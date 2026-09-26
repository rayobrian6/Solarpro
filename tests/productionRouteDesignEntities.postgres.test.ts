/**
 * tests/productionRouteDesignEntities.postgres.test.ts
 *
 * DOES `/api/production` CARRY A HAND-PLACED OBSTRUCTION, OR SILENTLY DROP IT?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION, AND WHY REASONING CANNOT ANSWER IT
 * ─────────────────────────────────────────────────────────────────────────────
 * A defect was just fixed where `/api/production` moved the layouts row's
 * version and the studio did not adopt it, so the autosave carrying a chimney
 * was refused with LAYOUT_STALE_WRITE while the write that said nothing about
 * obstructions won. That was the VERSION half.
 *
 * The half left open: `buildLayoutFromDefinition` (app/api/production/route.ts)
 * carries no `obstructions`, `measurements` or `siteArchives` at all, and the
 * studio's CALCULATE button posts exactly that shape
 * (`{ projectId, systemDefinition, location }` — DesignStudio
 * `calculateProduction`). Two readings of that fact are individually plausible:
 *
 *   • harmless — `upsertLayout`'s documented rule is that `undefined` KEEPS
 *     what is stored (`COALESCE`, and the three separate conditional UPDATEs in
 *     `applyDesignEntities`), so an omitted field is silence; or
 *   • a data loss — if anything on the way turns that silence into `[]`, which
 *     the same file says repeatedly is a DECISION TO DELETE.
 *
 * Only the running code settles which. So this file drives the REAL route
 * handler against REAL PostgreSQL and asks the row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ROUTE HAS TWO WRITE PATHS AND THEY FORWARD FIELDS DIFFERENTLY
 * ─────────────────────────────────────────────────────────────────────────────
 * Both are exercised here, with both request shapes, because they are reached by
 * a condition that has nothing to do with obstructions:
 *
 *   project has NO client  → `upsertLayout({ ...rawLayout, projectId, userId })`
 *   project HAS a client   → `upsertLayout({ … })` field by field, ~line 478
 *
 * and `rawLayout` is either the client's `body.layout` verbatim (the Save
 * button) or `buildLayoutFromDefinition(body.systemDefinition …)` (the
 * Calculate button). Four cells. Testing one proves nothing about the others —
 * the field-by-field branch is exactly where `obstructions`, `measurements` and
 * `siteArchives` were each silently dropped once before, and real projects have
 * clients.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO INSTRUMENTS, BECAUSE "THE ROW STILL HAS IT" IS NOT THE WHOLE QUESTION
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. THE ROW, read straight out of PostgreSQL after the route ran. This answers
 *     "did the chimney survive".
 *  2. WHAT THE ROUTE ACTUALLY PASSED to `upsertLayout`, captured by wrapping the
 *     real function. This answers the dangerous question — `[]` and `undefined`
 *     produce the SAME row when the stored value is already empty, so a route
 *     that sends `[]` looks correct until the day something is stored. A test
 *     that only reads the row cannot tell those apart, and that is precisely the
 *     distinction the repo's own comments turn on.
 *
 *     🚨 The captured value is the VALUE THE EXPRESSION PRODUCED, not a token in
 *     a type annotation or an argument list. A field named in a parameter list is
 *     not the code consulting it.
 *
 * PGlite — PostgreSQL compiled to WASM, in-process, no daemon, no credential.
 * The migration-applying harness is the one established by
 * tests/layoutConcurrency.postgres.test.ts, which drives this same route.
 *
 * 🚨 THIS IS NOT RAY'S NEON INSTANCE. It proves the path is correct. It does not
 * prove production has run the migrations.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,$2,…)
 *  text. The only translation in the file — everything it feeds is production
 *  code. Identical to tests/layoutConcurrency.postgres.test.ts. */
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
 * PVWatts reaches the network and is not what this file is about — the write
 * under examination happens before it. Stubbed PARTIALLY via `importOriginal`,
 * for the reason the sibling suite records: replacing the whole module removes
 * `calculateProductionLocal`, which `lib/multiArrayEngine.ts` (imported by the
 * same route) needs, and the route then 500s for a reason that has nothing to do
 * with the code under test. A stub missing an export accuses the product of the
 * stub's own fault.
 */
vi.mock('@/lib/pvwatts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  calculateProduction: async () => ({ annualProductionKwh: 10000, monthlyProduction: [], performanceRatio: 0.8, specificYield: 1400, co2OffsetKg: 1000 }),
  calculateProductionFromDefinition: async () => ({ annualProductionKwh: 10000, monthlyProduction: [], performanceRatio: 0.8, specificYield: 1400, co2OffsetKg: 1000 }),
}));

/**
 * 🚨 WHAT THE ROUTE PASSED, not what the row ended up as.
 *
 * The route imports `upsertLayout` from `@/lib/db-neon` (its sanctioned entry
 * point), so the wrapper goes there. It RECORDS and then DELEGATES to the real
 * implementation — a stub would make every row assertion below vacuous, which
 * is the failure mode this whole workstream keeps finding.
 */
const { routeWrites } = vi.hoisted(() => ({ routeWrites: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/db-neon', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const realUpsert = real.upsertLayout as (d: unknown) => Promise<unknown>;
  return {
    ...real,
    upsertLayout: async (d: Record<string, unknown>) => {
      routeWrites.push(d);
      return realUpsert(d);
    },
  };
});

// Seeding goes through lib/db/projects DIRECTLY, so the capture above only ever
// holds writes the ROUTE made.
const { upsertLayout, __resetSiteArchivesProbeForTests } = await import('@/lib/db/projects');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { POST: PRODUCTION_POST } = await import('@/app/api/production/route');

// ── The real migrations, in numeric order (see the sibling suite) ────────────
const MIGRATION_DIR = join(process.cwd(), 'lib', 'migrations');
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
    try { await pg.exec(sql); } catch { skipped.push(f); }
  }
  for (const [name, type] of COLUMNS_NO_MIGRATION_CREATES) {
    await pg.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${name} ${type};`);
  }
  return skipped;
}

// ── Melvin, the house this workstream is calibrated on ───────────────────────
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const CLIENT  = '22222222-2222-4222-8222-222222222222';
const MELVIN  = { lat: 38.70615257709013, lng: -90.04625419301613 };
const KEY_A   = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_B   = siteKeyFromCoords(38.70629, -90.04620, PROJECT);

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

const TWELVE     = Array.from({ length: 12 }, (_, i) => panel(`melvin-p${i}`));
const SIX_PLANES = Array.from({ length: 6 }, (_, i) => plane(`melvin-r${i}`));

/** The hand-placed chimney. One object, by id, so a count cannot satisfy this. */
const CHIMNEY = {
  id: 'chimney-hand-placed', type: 'chimney' as const,
  lat: MELVIN.lat + 0.00002, lng: MELVIN.lng + 0.00002,
  height: 5.4, radiusM: 0, widthM: 0.6, depthM: 0.6, heightM: 1.2,
  planeId: 'melvin-r0',
};
const TAPE = {
  id: 'measure-eave-to-ridge',
  a: { lat: MELVIN.lat, lng: MELVIN.lng, height: 5 },
  b: { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng, height: 7 },
  horizDistM: 11.1, slopeDistM: 11.3,
};
/** A property the user left — this is what `site_archives` is for. */
const ARCHIVES = {
  version: 1, activeSiteKey: KEY_A, nativeGeometry: {}, deletions: { sites: {} },
  sites: {
    [KEY_B]: {
      panels: [panel('nbr-p0')], roofPlanes: [plane('nbr-r0')],
      obstructions: [], measurements: [], designElectrical: null,
    },
  },
};

async function row(cols: string) {
  const r = await db.query<Record<string, unknown>>(
    `SELECT ${cols} FROM layouts WHERE project_id = $1`, [PROJECT],
  );
  return r.rows[0] ?? null;
}

async function seedProject(withClient: boolean) {
  await db.exec(`
    DELETE FROM layouts;
    DELETE FROM project_versions;
    DELETE FROM productions;
    DELETE FROM projects;
    DELETE FROM clients;
  `);
  if (withClient) {
    await db.query(
      `INSERT INTO clients (id, user_id, name, email, lat, lng, utility_rate)
       VALUES ($1,$2,'Braidon','b@e.st',$3,$4,0.13)`,
      [CLIENT, USER_ID, MELVIN.lat, MELVIN.lng],
    );
  }
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type, client_id)
     VALUES ($1,$2,$3,$4,$5,$6,'roof',$7)`,
    [PROJECT, USER_ID, 'BRAIDON M PILLA — Solar',
      '3 Melvin Drive, Granite City, IL 62040', MELVIN.lat, MELVIN.lng,
      withClient ? CLIENT : null],
  );
  __resetSiteArchivesProbeForTests();
  routeWrites.length = 0;
}

/**
 * THE STATE THE QUESTION IS ABOUT: a design that already holds a hand-placed
 * chimney, a tape measure and an archived property, stored by the same
 * `upsertLayout` the studio's autosave uses.
 */
async function seedDesignWithChimney() {
  await upsertLayout({
    projectId: PROJECT, userId: USER_ID, systemType: 'roof',
    panels: TWELVE as never, roofPlanes: SIX_PLANES as never,
    obstructions: [CHIMNEY] as never,
    measurements: [TAPE] as never,
    siteArchives: ARCHIVES as never,
    mapCenter: MELVIN, mapZoom: 19,
    totalPanels: TWELVE.length, systemSizeKw: TWELVE.length * 0.4,
    bifacialOptimized: true,
  });
  routeWrites.length = 0;   // the seed is not a route write
}

/** POST the REAL handler. */
async function postProduction(body: Record<string, unknown>) {
  const res = await PRODUCTION_POST(new Request('http://localhost/api/production', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT, ...body }),
  }) as unknown as import('next/server').NextRequest);
  return { status: res.status, json: await res.json() as Record<string, any> };
}

/** The studio's CALCULATE button body — `buildSystemDefinition()` + location.
 *  It says NOTHING about obstructions, measurements or archives. */
const CALCULATE = {
  systemDefinition: {
    panels: TWELVE, systemType: 'roof', tilt: 20, azimuth: 180,
    groundTilt: 20, groundAzimuth: 180, fenceAzimuth: 180,
    totalPanels: TWELVE.length, systemSizeKw: TWELVE.length * 0.4,
    roofPlanes: SIX_PLANES,
  },
  location: { lat: MELVIN.lat, lng: MELVIN.lng, annualKwh: 12000, utilityRate: 0.13 },
};

/** A legacy `layout` body that also says nothing about them — an older client,
 *  and the shape `/api/engineering/*` style callers send. */
const SILENT_LAYOUT = {
  layout: {
    systemType: 'roof', panels: TWELVE, roofPlanes: SIX_PLANES,
    mapCenter: MELVIN, mapZoom: 19, systemSizeKw: TWELVE.length * 0.4,
  },
};

/**
 * The value the route's OWN write carried for `field`.
 *
 * 🚨 Reads the property off the object that was actually handed to
 * `upsertLayout`. `'field' in data` and `data.field === undefined` are the same
 * fact to `upsertLayout` (it tests `=== undefined`), so this returns the value
 * and the assertions speak about the value.
 */
function sentByRoute(field: string): unknown {
  expect(routeWrites.length, 'the route made no write at all — the assertion below would be vacuous')
    .toBeGreaterThan(0);
  return (routeWrites[routeWrites.length - 1] as Record<string, unknown>)[field];
}

let SKIPPED: string[] = [];

beforeAll(async () => {
  db = await PGlite.create();
  SKIPPED = await applyRealMigrations(db);
});
afterAll(async () => { await db?.close(); });

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 A fixture quietly missing a column does not produce a weaker test — it
// produces a CONFIDENT WRONG ANSWER. If `obstructions` did not exist,
// `applyDesignEntities` would swallow the "column does not exist" error and
// every survival assertion below would pass against a row that never held a
// chimney at all.

describe('the fixture is the real schema, and it really holds the chimney', () => {
  beforeEach(() => seedProject(false));

  it('the migrations that create the design-entity columns applied', () => {
    const MUST_APPLY = [
      '001_initial_schema.sql',
      '122_layout_obstructions_measurements.sql',
      '123_layout_site_archives.sql',
    ];
    const missing = MUST_APPLY.filter(f => SKIPPED.includes(f));
    expect(missing, `these did not apply: ${missing.join(', ')}`).toEqual([]);
  });

  it('a seeded chimney, tape and archive are genuinely on the row', async () => {
    await seedDesignWithChimney();
    const r = await row('obstructions, measurements, site_archives');
    expect((r?.obstructions as Array<{ id: string }>).map(o => o.id)).toEqual([CHIMNEY.id]);
    expect((r?.measurements as Array<{ id: string }>).map(m => m.id)).toEqual([TAPE.id]);
    expect(Object.keys((r?.site_archives as { sites: Record<string, unknown> }).sites)).toEqual([KEY_B]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. QUESTION 1 — DOES THE CHIMNEY SURVIVE A WRITE THAT SAYS NOTHING?
// ═══════════════════════════════════════════════════════════════════════════
//
// Ray's sequence: place a chimney (the autosave stores it), then press Calculate
// or Save. The row must still describe the object the operator put on the roof,
// and the array it pruned.

for (const withClient of [false, true]) {
  const branch = withClient
    ? 'the FIELD-BY-FIELD path (project has a client)'
    : 'the SPREAD path (project has no client)';

  describe(`${branch} — a write that says nothing about design entities`, () => {
    beforeEach(async () => { await seedProject(withClient); await seedDesignWithChimney(); });

    it('takes the branch this block is about (guard the guard)', async () => {
      // 🚨 WITHOUT THIS, HALF THE FILE COULD BE TESTING THE SAME PATH TWICE.
      // Which path runs is decided by `project.clientId` and a `getClientById`
      // lookup, neither of which is visible in the result. The two paths differ
      // observably in exactly one field they pass: the spread path forwards
      // whatever `rawLayout` held, so `fenceLine` is absent from a body that has
      // none, while the field-by-field path names it explicitly.
      const res = await postProduction(CALCULATE);
      expect(res.status).toBe(200);
      const wrote = routeWrites[routeWrites.length - 1];
      expect(Object.prototype.hasOwnProperty.call(wrote, 'fenceLine'),
        `this is not the ${withClient ? 'field-by-field' : 'spread'} path`)
        .toBe(withClient);
    });

    it('🚨 CALCULATE does not delete the hand-placed chimney', async () => {
      const res = await postProduction(CALCULATE);
      expect(res.status, JSON.stringify(res.json)).toBe(200);

      const r = await row('obstructions, measurements, site_archives, panels');
      // BY ID. A count is satisfied by any array of the right size.
      expect((r?.obstructions as Array<{ id: string }> | null)?.map(o => o.id),
        'the chimney the operator placed by hand is gone from the row after a read-only calculation')
        .toEqual([CHIMNEY.id]);
      // And it is the same OBJECT, not merely an object with that id.
      const back = (r?.obstructions as Array<Record<string, unknown>>)[0];
      expect(back.type).toBe('chimney');
      expect(back.planeId, 'the chimney came back UNBOUND — the CAD chain drops an object with no planeId')
        .toBe(CHIMNEY.planeId);
      expect(Number(back.widthM)).toBeCloseTo(CHIMNEY.widthM, 6);
    });

    it('🚨 CALCULATE does not delete the measurements or the archived property', async () => {
      await postProduction(CALCULATE);
      const r = await row('measurements, site_archives');
      expect((r?.measurements as Array<{ id: string }> | null)?.map(m => m.id)).toEqual([TAPE.id]);
      const sites = (r?.site_archives as { sites?: Record<string, unknown> } | null)?.sites ?? {};
      expect(Object.keys(sites),
        "the property the user left is no longer archived — its design is neither active nor archived")
        .toEqual([KEY_B]);
      expect((sites[KEY_B] as { panels?: unknown[] })?.panels).toHaveLength(1);
    });

    it('🚨 a legacy `layout` body that omits them does not delete them either', async () => {
      const res = await postProduction(SILENT_LAYOUT);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const r = await row('obstructions, measurements, site_archives');
      expect((r?.obstructions as Array<{ id: string }> | null)?.map(o => o.id)).toEqual([CHIMNEY.id]);
      expect((r?.measurements as Array<{ id: string }> | null)?.map(m => m.id)).toEqual([TAPE.id]);
      expect(Object.keys((r?.site_archives as { sites?: Record<string, unknown> } | null)?.sites ?? {}))
        .toEqual([KEY_B]);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. QUESTION 2 — SILENCE, OR AN EMPTY ARRAY?
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 🚨 THE DANGEROUS CASE, AND THE ROW CANNOT SHOW IT. `[]` and `undefined`
    // leave an ALREADY-EMPTY column identical, so a route that sends `[]` passes
    // every test above on a project that happens to have no obstructions and
    // deletes the chimney on the one that does. `[]` is a decision to delete;
    // `undefined` is silence. This asserts which one the route said.

    it('🚨 says NOTHING about obstructions rather than sending an empty array', async () => {
      await postProduction(CALCULATE);
      expect(sentByRoute('obstructions'),
        'the route sent a value for `obstructions` on a request that never mentioned them — ' +
        'an empty array is a decision to DELETE, and `undefined` is the only honest answer ' +
        'for a caller that does not know')
        .toBeUndefined();
    });

    it('🚨 says nothing about measurements either', async () => {
      await postProduction(CALCULATE);
      expect(sentByRoute('measurements')).toBeUndefined();
    });

    it('🚨 and nothing about siteArchives — which is checked BEFORE any write', async () => {
      // Not interchangeable with the two above: `upsertLayout` refuses a save
      // outright (LAYOUT_ARCHIVE_UNSTORABLE / the pre-123 loss guard) when
      // `siteArchives !== undefined`, so a fabricated value here can turn a
      // production calculation into a REFUSED request on a deployment that has
      // not run migration 123 — a different failure from losing the data.
      await postProduction(CALCULATE);
      expect(sentByRoute('siteArchives')).toBeUndefined();
    });

    it('the same is true for a legacy `layout` body that omits them', async () => {
      await postProduction(SILENT_LAYOUT);
      expect(sentByRoute('obstructions')).toBeUndefined();
      expect(sentByRoute('measurements')).toBeUndefined();
      expect(sentByRoute('siteArchives')).toBeUndefined();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. POSITIVE CONTROLS — THE WIRING IS ALIVE IN BOTH DIRECTIONS
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 🚨 Without these, every assertion above is satisfied by a route that
    // cannot write design entities AT ALL — "the stored value never changes" is
    // the same observation as "the field is ignored", and one of those is the
    // defect this route already had.

    it('a body that STATES an obstruction replaces the stored one', async () => {
      const replacement = { ...CHIMNEY, id: 'skylight-1', type: 'skylight' as const };
      const res = await postProduction({
        layout: { ...SILENT_LAYOUT.layout, obstructions: [replacement] },
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(sentByRoute('obstructions')).toEqual([replacement]);
      expect(((await row('obstructions'))?.obstructions as Array<{ id: string }>).map(o => o.id))
        .toEqual(['skylight-1']);
    });

    it('a body that STATES an empty array deletes the stored one — a delete must stay expressible', async () => {
      const res = await postProduction({
        layout: { ...SILENT_LAYOUT.layout, obstructions: [], measurements: [] },
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(sentByRoute('obstructions')).toEqual([]);
      expect((await row('obstructions'))?.obstructions).toEqual([]);
      expect((await row('measurements'))?.measurements).toEqual([]);
    });

    it('a body that STATES measurements and archives writes them', async () => {
      const tape2 = { ...TAPE, id: 'measure-second' };
      const res = await postProduction({
        layout: {
          ...SILENT_LAYOUT.layout,
          measurements: [TAPE, tape2],
          siteArchives: { ...ARCHIVES, sites: {} },
        },
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(((await row('measurements'))?.measurements as Array<{ id: string }>).map(m => m.id))
        .toEqual([TAPE.id, tape2.id]);
      expect(Object.keys(((await row('site_archives'))?.site_archives as { sites: Record<string, unknown> }).sites))
        .toEqual([]);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. THE RESPONSE MUST NOT TEACH THE CLIENT AN EMPTY LIST
    // ═══════════════════════════════════════════════════════════════════════

    it('🚨 the layout it RETURNS still carries the stored chimney', async () => {
      // The studio reads `data.data.layout` back (`site.noteSavedVersion`,
      // `onSave?.(data.data.layout)`). A response that reported no obstructions
      // while the row holds one would hand the client an empty list to write
      // back on its next save — the same loss, one hop later.
      const res = await postProduction(CALCULATE);
      const layout = res.json.data?.layout as { obstructions?: Array<{ id: string }>; measurements?: Array<{ id: string }> };
      expect(layout?.obstructions?.map(o => o.id),
        'the response says this design has no obstructions while the row says it has one')
        .toEqual([CHIMNEY.id]);
      expect(layout?.measurements?.map(m => m.id)).toEqual([TAPE.id]);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. THE SAME QUESTION, THE FIELD NOBODY HAD ASKED ABOUT
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 🚨 FOUND WHILE ANSWERING THE THREE ABOVE, AND IT IS THE SAME RULE: a
    // caller that does not know must say NOTHING. `[]` is the array spelling of
    // a fabricated answer; `false` is the boolean one, and it was being sent on
    // BOTH write paths (`bifacialOptimized ?? false`) for requests that never
    // mentioned bifaciality.
    //
    // It matters because `bifacial_optimized` is COALESCE'd in `upsertLayout`
    // exactly like `row_spacing` and `ground_height` — which this same function
    // already stopped fabricating, with the note "these are now `undefined`,
    // which upsertLayout's COALESCE reads as keep what is stored". Absence would
    // have been kept; `false` overwrote a stored `true`. MEASURED before the
    // repair: the route sent `false` and the row went from true to false.
    //
    // The requirement is pinned, not the spelling: the STORED FLAG MUST SURVIVE
    // a write that says nothing about it. The second assertion names the
    // mechanism, and would still hold if the route ever learned to read the row.
    it('🚨 a write that says nothing about bifaciality leaves the stored flag alone', async () => {
      expect((await row('bifacial_optimized'))?.bifacial_optimized,
        'the fixture did not store a true flag — everything below would be vacuous')
        .toBe(true);

      await postProduction(CALCULATE);

      const sent   = sentByRoute('bifacialOptimized');
      const stored = (await row('bifacial_optimized'))?.bifacial_optimized;
      // The measurement, printed: this file is a report, and a report needs values.
      console.log('[PRODUCTION BIFACIAL]',
        JSON.stringify({ withClient, sentByRoute: sent, storedAfter: stored }));

      expect(stored,
        'a read-only production calculation that never mentioned bifaciality replaced the ' +
        'design\'s stored bifacial flag — the same absence-becomes-a-value defect this ' +
        'function already fixed for rowSpacing and groundHeight')
        .toBe(true);
      expect(sent,
        'the route stated a value for a field the request never mentioned')
        .toBeUndefined();
    });
  });
}

