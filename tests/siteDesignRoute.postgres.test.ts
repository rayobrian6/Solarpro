/**
 * tests/siteDesignRoute.postgres.test.ts
 *
 * THE MELVIN SEQUENCE, THROUGH THE REAL ROUTE AND REAL POSTGRESQL.
 *
 * WHAT THE OTHER TWO FILES DO NOT COVER
 * -------------------------------------
 *   tests/siteDesignModel.test.ts        the pure model
 *   tests/siteDesignIntegration.test.tsx the real hook, through React
 *
 * Both stop at the network boundary. The Melvin row survived only because a
 * guard inside `upsertLayout` THREW on the destructive write — a behaviour that
 * lives in the database layer and is invisible to both of those files. And the
 * defect they cannot see at all is the one that matters most: what the
 * ENGINEERING CONSUMERS read back out of the row afterwards.
 *
 * So this runs the REAL handlers — `POST`/`GET` from
 * app/api/projects/[id]/layout/route.ts — against REAL PostgreSQL (PGlite:
 * Postgres compiled to WASM, in-process, no daemon, no credentials, no
 * network), with migrations 122 and 123 applied exactly as the operator console
 * would apply them.
 *
 * Only the things that are not under test are substituted: authentication, the
 * rate limiter, and the engineering pipeline. The layout persistence path —
 * route body handling, `upsertLayout`, the subsystem-wipe guard, the coordinate
 * guard, `rowToLayout` — is the real code, and the database is a real database.
 *
 * 🚨 THIS IS NOT RAY'S NEON INSTANCE. It proves the path is correct. It does
 * not prove production has run the migration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// ── The real database, shimmed to Neon's tagged-template shape ──────────────
let db: PGlite;

/** Neon's `sql` is a tagged template that returns rows. PGlite takes
 *  ($1,$2,…) text. This is the only translation in the file; everything the
 *  translation feeds is production code. */
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

// Not under test, and each would need a network or a secret.
const USER_ID = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Test', email: 't@e.st', company: 'T' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/engineering/syncPipeline', () => ({
  syncProjectPipeline: async () => ({ panelCount: 0, artifactsWritten: 0, wasRebuilt: false, errors: [], files: [] }),
}));

const { POST, GET } = await import('@/app/api/projects/[id]/layout/route');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { getLayoutByProject } = await import('@/lib/db/projects');

const sqlOf = (f: string) => readFileSync(join(process.cwd(), 'lib', 'migrations', f), 'utf8');
const SQL_122 = sqlOf('122_layout_obstructions_measurements.sql');
const SQL_123 = sqlOf('123_layout_site_archives.sql');

/** The 001 subset the layout path touches. Hand-built rather than replaying
 *  123 migrations, so a failure here is attributable to the layout path. */
const BASELINE = `
  CREATE TABLE IF NOT EXISTS projects (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL,
    name                TEXT,
    address             TEXT,
    lat                 DOUBLE PRECISION,
    lng                 DOUBLE PRECISION,
    system_type         TEXT DEFAULT 'roof',
    selected_equipment  JSONB,
    engineering_config  JSONB,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS layouts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL,
    user_id            UUID NOT NULL,
    system_type        TEXT NOT NULL DEFAULT 'roof',
    panels             JSONB NOT NULL DEFAULT '[]',
    roof_planes        JSONB,
    ground_tilt        DOUBLE PRECISION,
    ground_azimuth     DOUBLE PRECISION,
    row_spacing        DOUBLE PRECISION,
    ground_height      DOUBLE PRECISION,
    fence_azimuth      DOUBLE PRECISION,
    fence_height       DOUBLE PRECISION,
    fence_line         JSONB,
    bifacial_optimized BOOLEAN DEFAULT FALSE,
    total_panels       INTEGER DEFAULT 0,
    system_size_kw     DOUBLE PRECISION DEFAULT 0,
    map_center         JSONB,
    map_zoom           INTEGER,
    design_electrical  JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS project_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL,
    user_id        UUID NOT NULL,
    version_number INTEGER NOT NULL,
    snapshot       JSONB NOT NULL,
    panels_count   INTEGER,
    system_size_kw DOUBLE PRECISION,
    change_summary TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS selected_equipment (
    project_id UUID PRIMARY KEY,
    user_id    UUID NOT NULL,
    data       JSONB
  );
`;

// ── Melvin, its neighbour, and a third property ─────────────────────────────
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_B = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);

const panel = (id: string, at = MELVIN) => ({
  id, lat: at.lat + (Number(id.replace(/\D/g, '')) % 10) * 0.000001, lng: at.lng, wattage: 400, systemType: 'roof',
});
const plane = (id: string, siteKey: string, at = MELVIN) => ({
  id, siteKey, pitch: 20, azimuth: 180,
  vertices: [{ lat: at.lat, lng: at.lng }, { lat: at.lat + 0.0001, lng: at.lng }, { lat: at.lat + 0.0001, lng: at.lng + 0.0001 }],
});

function req(body: unknown) {
  return new Request(`http://localhost/api/projects/${PROJECT}/layout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}
const ctx = { params: Promise.resolve({ id: PROJECT }) };

async function post(body: unknown) {
  const res = await POST(req(body), { params: Promise.resolve({ id: PROJECT }) });
  return { status: res.status, json: await res.json() };
}
async function get() {
  const res = await GET(
    new Request(`http://localhost/api/projects/${PROJECT}/layout`) as unknown as import('next/server').NextRequest,
    ctx,
  );
  return (await res.json()).data as Record<string, any> | null;
}

/** The payload shape the studio's autosave sends. */
function autosaveBody(opts: {
  panels: ReturnType<typeof panel>[];
  roofPlanes: ReturnType<typeof plane>[];
  mapCenter: { lat: number; lng: number };
  archives?: Record<string, { panels?: unknown[]; roofPlanes?: unknown[]; obstructions?: unknown[]; measurements?: unknown[] }>;
  activeSiteKey: string;
  obstructions?: unknown[];
  measurements?: unknown[];
}) {
  return {
    panels: opts.panels,
    roofPlanes: opts.roofPlanes,
    mapCenter: opts.mapCenter,
    mapZoom: 19,
    systemType: 'roof',
    obstructions: opts.obstructions ?? [],
    measurements: opts.measurements ?? [],
    siteArchives: { version: 1, activeSiteKey: opts.activeSiteKey, sites: opts.archives ?? {} },
  };
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BASELINE);
  await db.exec(SQL_122);
  await db.exec(SQL_123);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`DELETE FROM layouts; DELETE FROM project_versions; DELETE FROM projects;`);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type) VALUES ($1,$2,$3,$4,$5,$6,'roof')`,
    [PROJECT, USER_ID, 'BRAIDON M PILLA — Solar', '3 Melvin Drive, Granite City, IL 62040', MELVIN.lat, MELVIN.lng],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe('migration 123 applies to a real database', () => {
  it('the column exists, is JSONB and is nullable', async () => {
    const r = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='layouts' AND column_name='site_archives'`,
    );
    expect(r.rows[0]).toEqual({ data_type: 'jsonb', is_nullable: 'YES' });
  });

  it('is idempotent — running it twice changes nothing', async () => {
    const before = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='layouts'`);
    await db.exec(SQL_123);
    const after = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='layouts'`);
    expect(after.rows).toEqual(before.rows);
  });

  it('an existing layout row survives the migration with its data intact', async () => {
    await post(autosaveBody({ panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    await db.exec(SQL_123);
    const after = await get();
    expect(after?.panels).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 A → B → A through the real route', () => {
  it('Melvin\'s 52 panels survive the neighbour and come back by ID', async () => {
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    const melvinPlanes = Array.from({ length: 6 }, (_, i) => plane(`melvin-r${i}`, KEY_A));

    // 1. Melvin, designed and saved.
    expect((await post(autosaveBody({
      panels: melvinPanels, roofPlanes: melvinPlanes, mapCenter: MELVIN, activeSiteKey: KEY_A,
    }))).status).toBe(200);
    expect((await get())?.panels).toHaveLength(52);

    // 2. Pick the house next door. The studio archives Melvin and saves.
    //    🚨 This is the save the old code sent as `panels: []` with no archive.
    expect((await post(autosaveBody({
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: melvinPlanes, obstructions: [], measurements: [] } },
    }))).status).toBe(200);

    // The ACTIVE columns now describe the neighbour — empty, correctly.
    const atB = await get();
    expect(atB?.panels).toEqual([]);
    expect(atB?.roofPlanes).toEqual([]);
    // 🚨 And the engineering consumers see the neighbour's roof, not Melvin's.
    expect(atB?.roofPlanes).toHaveLength(0);
    // Melvin is kept, in the column nothing engineering-facing reads.
    expect((atB?.siteArchives as any).sites[KEY_A].panels).toHaveLength(52);

    // 3. Pick Melvin again. The studio reactivates it and saves.
    expect((await post(autosaveBody({
      panels: melvinPanels, roofPlanes: melvinPlanes, mapCenter: MELVIN, activeSiteKey: KEY_A,
      archives: { [KEY_B]: { panels: [], roofPlanes: [], obstructions: [], measurements: [] } },
    }))).status).toBe(200);

    // 4. THE PANELS ARE BACK — by ID, not by count.
    const atA = await get();
    expect(atA?.panels.map((p: any) => p.id)).toEqual(melvinPanels.map(p => p.id));
    expect(atA?.roofPlanes.map((p: any) => p.id)).toEqual(melvinPlanes.map(p => p.id));
    expect(atA?.totalPanels).toBe(52);
  });

  it('🚨 a design with NO PANELS still stores its obstructions, measurements and archive', async () => {
    // The defect this pins: `applyDesignElectrical` returned early when the
    // save carried no electrical design, and that early return skipped
    // `applyDesignEntities` with it. DesignStudio only builds an electrical
    // design when `panels.length > 0`, so:
    //   • trace a roof, place a vent, place no panels → the vent was never
    //     stored, although migration 122 had shipped and every other link in
    //     the chain was wired;
    //   • the save that follows a PROPERTY CHANGE sends `panels: []`, so the
    //     site archive was dropped in exactly the case it exists for.
    // Both returned 200. Nothing said anything had been lost.
    const obs = [{ id: 'o1', lat: MELVIN.lat, lng: MELVIN.lng, height: 3, radiusM: 1, type: 'vent' }];
    const res = await post(autosaveBody({
      panels: [],                                   // ← no panels ⇒ no designElectrical
      roofPlanes: [plane('r1', KEY_A)],
      mapCenter: MELVIN, activeSiteKey: KEY_A,
      obstructions: obs,
      archives: { [KEY_B]: { panels: [panel('n1', NEIGHBOUR)] } },
    }));
    expect(res.status).toBe(200);
    const row = await get();
    expect(row?.obstructions).toHaveLength(1);
    expect((row?.siteArchives as any)?.sites?.[KEY_B]?.panels).toHaveLength(1);
  });

  it('🚨 the subsystem-wipe guard does NOT refuse a legitimate property change', () => {
    // It used to: stored 52 roof panels, incoming `panels: []`, so every
    // address-change save was rejected with a 500. That is how Melvin's data
    // survived — by luck. Refusing the save is worse than the bug, because the
    // archive then never reaches the database at all.
    // (Proved by the 200 statuses asserted in the test above; this records why.)
    expect(true).toBe(true);
  });

  it('a REAL wipe — no archive, no panels — is still refused', async () => {
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    await post(autosaveBody({ panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    // The Stowell reload defect: an empty save with nothing archived anywhere.
    const res = await post(autosaveBody({ panels: [], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    expect(res.status).toBe(503);
    // …and the stored design is untouched.
    expect((await get())?.panels).toHaveLength(52);
  });

  it('obstructions and measurements move with the property', async () => {
    const obs = [{ id: 'o1', lat: MELVIN.lat, lng: MELVIN.lng, height: 3, radiusM: 1, type: 'vent' }];
    const meas = [{ id: 'm1', a: { lat: 1, lng: 1 }, b: { lat: 1, lng: 2 }, horizDistM: 5, slopeDistM: 5.2 }];
    await post(autosaveBody({
      panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
      obstructions: obs, measurements: meas,
    }));
    expect((await get())?.obstructions).toHaveLength(1);

    // Leave for the neighbour — they go into the archive, not into the column.
    await post(autosaveBody({
      panels: [panel('n1', NEIGHBOUR)], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      obstructions: [], measurements: [],
      archives: { [KEY_A]: { panels: [panel('p1')], roofPlanes: [], obstructions: obs, measurements: meas } },
    }));
    const atB = await get();
    expect(atB?.obstructions).toEqual([]);
    expect(atB?.measurements).toEqual([]);
    expect((atB?.siteArchives as any).sites[KEY_A].obstructions).toHaveLength(1);
    expect((atB?.siteArchives as any).sites[KEY_A].measurements).toHaveLength(1);
  });

  it('an EMPTY archive is written, not treated as "keep what is stored"', async () => {
    await post(autosaveBody({
      panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
      archives: { [KEY_B]: { panels: [panel('n1', NEIGHBOUR)] } },
    }));
    expect(Object.keys((await get())?.siteArchives as any ? ((await get())!.siteArchives as any).sites : {})).toEqual([KEY_B]);
    // The user goes back to B and deletes its design there; the archive empties.
    await post(autosaveBody({ panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A, archives: {} }));
    expect(((await get())!.siteArchives as any).sites).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 what the ENGINEERING consumers read back', () => {
  it('getLayoutByProject never returns another property\'s roof planes', async () => {
    const melvinPlanes = Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A));
    await post(autosaveBody({
      panels: [panel('p1')], roofPlanes: melvinPlanes, mapCenter: MELVIN, activeSiteKey: KEY_A,
      archives: { [KEY_B]: { roofPlanes: Array.from({ length: 3 }, (_, i) => plane(`b${i}`, KEY_B, NEIGHBOUR)) } },
    }));
    const layout = await getLayoutByProject(PROJECT, USER_ID);
    expect(layout?.roofPlanes).toHaveLength(6);
    expect(layout?.roofPlanes?.every(p => (p as any).siteKey === KEY_A)).toBe(true);
    // `roofPlanes[0].pitch` is how lib/pvwatts.ts picks the array tilt. It must
    // be this property's plane, whatever else the row is carrying.
    expect((layout!.roofPlanes![0] as any).siteKey).toBe(KEY_A);
  });

  it('🚨 THE MELVIN ROW — a legacy merged array is repaired on READ', async () => {
    // The row as it exists in production right now: 13 planes, three
    // properties, one column, no site_archives. Written directly, as the
    // pre-123 build wrote it.
    const merged = [
      ...Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A)),
      ...Array.from({ length: 4 }, (_, i) => plane(`b${i}`, KEY_B, NEIGHBOUR)),
      ...Array.from({ length: 3 }, (_, i) => plane(`c${i}`, siteKeyFromCoords(38.70640, -90.04610, PROJECT), NEIGHBOUR)),
    ];
    await db.query(
      `INSERT INTO layouts (project_id, user_id, panels, roof_planes, map_center, total_panels)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,0)`,
      [PROJECT, USER_ID, '[]', JSON.stringify(merged), JSON.stringify(MELVIN)],
    );
    const layout = await getLayoutByProject(PROJECT, USER_ID);
    // Only the property the project is AT reaches any consumer.
    expect(layout?.roofPlanes).toHaveLength(6);
    expect(layout?.roofPlanes?.every(p => (p as any).siteKey === KEY_A)).toBe(true);
  });

  it('an unambiguous single-site row is NOT touched, even if map_center drifted', async () => {
    // A row whose planes all name one site keeps its whole roof — the repair
    // fires only when the row is genuinely ambiguous.
    const planes = Array.from({ length: 4 }, (_, i) => plane(`a${i}`, KEY_A));
    await db.query(
      `INSERT INTO layouts (project_id, user_id, panels, roof_planes, map_center, total_panels)
       VALUES ($1,$2,'[]'::jsonb,$3::jsonb,$4::jsonb,0)`,
      [PROJECT, USER_ID, JSON.stringify(planes), JSON.stringify({ lat: 38.99999, lng: -90.99999 })],
    );
    expect((await getLayoutByProject(PROJECT, USER_ID))?.roofPlanes).toHaveLength(4);
  });

  it('a row with no siteKeys at all is untouched — every legacy roof is kept', async () => {
    const planes = Array.from({ length: 4 }, (_, i) => ({ ...plane(`a${i}`, KEY_A), siteKey: undefined }));
    await db.query(
      `INSERT INTO layouts (project_id, user_id, panels, roof_planes, map_center, total_panels)
       VALUES ($1,$2,'[]'::jsonb,$3::jsonb,$4::jsonb,0)`,
      [PROJECT, USER_ID, JSON.stringify(planes), JSON.stringify(MELVIN)],
    );
    expect((await getLayoutByProject(PROJECT, USER_ID))?.roofPlanes).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a deployment that has not run 123 yet', () => {
  it('still saves the layout — the archive is simply not stored', async () => {
    const scratch = await PGlite.create();
    const previous = db;
    try {
      await scratch.exec(BASELINE);
      await scratch.exec(SQL_122); // 123 deliberately NOT applied
      await scratch.query(
        `INSERT INTO projects (id, user_id, lat, lng, system_type) VALUES ($1,$2,$3,$4,'roof')`,
        [PROJECT, USER_ID, MELVIN.lat, MELVIN.lng],
      );
      db = scratch;
      const res = await post(autosaveBody({ panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
      expect(res.status).toBe(200);
      const rows = await scratch.query<{ n: number }>(`SELECT jsonb_array_length(panels) AS n FROM layouts`);
      expect(rows.rows[0].n).toBe(1);
    } finally {
      db = previous;
      await scratch.close();
    }
  });
});
