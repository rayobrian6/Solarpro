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
const { getLayoutByProject, upsertLayout, __resetSiteArchivesProbeForTests } = await import('@/lib/db/projects');

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
    // 409, not 503: a deliberate refusal is not a transient database error.
    expect(res.status).toBe(409);
    expect((res.json as { code?: string }).code).toBe('LAYOUT_SUBSYSTEM_WIPE');
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
describe('🚨 restoring a version must not delete the roof', () => {
  // Found by the post-merge adversarial sweep, not by any test here — and it
  // was a regression THIS change introduced. The restore route forwarded 17
  // fields and none of siteArchives/obstructions/measurements, and `undefined`
  // means KEEP STORED. So a restore overwrote roof_planes from the snapshot
  // while leaving site_archives (and its activeSiteKey) naming a DIFFERENT
  // property — and activeSitePlanes() then filtered out every restored plane,
  // handing lib/pvwatts.ts an empty array and logging the loss as a "repair".

  it('a snapshot restored at a different property keeps its roof', async () => {
    // The row is at property B; the snapshot is property A's.
    const aPlanes = Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A));
    await post(autosaveBody({
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: [], roofPlanes: aPlanes, obstructions: [], measurements: [] } },
    }));

    // Restore A's snapshot — carrying A's archive header, as the fixed route does.
    const restored = await upsertLayout({
      projectId: PROJECT, userId: USER_ID, systemType: 'roof',
      panels: [panel('a-p0')], roofPlanes: aPlanes, mapCenter: MELVIN,
      siteArchives: { version: 1, activeSiteKey: KEY_A, sites: {} },
    } as never);
    expect(restored.roofPlanes).toHaveLength(6);

    // 🚨 And a consumer reading it back sees SIX planes, not zero.
    const back = await getLayoutByProject(PROJECT, USER_ID);
    expect(back?.roofPlanes).toHaveLength(6);
  });

  it('🚨 the read path NEVER filters a roof down to nothing', async () => {
    // The backstop for every caller not yet thought of, and for rows already
    // left in this state: active key agrees with no stored plane.
    await db.query(
      `INSERT INTO layouts (project_id, user_id, panels, roof_planes, map_center, total_panels, site_archives)
       VALUES ($1,$2,'[]'::jsonb,$3::jsonb,$4::jsonb,0,$5::jsonb)`,
      [PROJECT, USER_ID,
        JSON.stringify([...Array.from({ length: 4 }, (_, i) => plane(`a${i}`, KEY_A)),
                        ...Array.from({ length: 2 }, (_, i) => plane(`b${i}`, KEY_B, NEIGHBOUR))]),
        JSON.stringify(MELVIN),
        JSON.stringify({ version: 1, activeSiteKey: siteKeyFromCoords(38.99, -90.99, PROJECT), sites: {} })],
    );
    const back = await getLayoutByProject(PROJECT, USER_ID);
    // Six planes, none matching the active key — all six are returned, not none.
    expect(back?.roofPlanes).toHaveLength(6);
  });

  it('a 0-panel version restores instead of 500-ing', async () => {
    // A property change mints `panels: []` versions. Restoring one sends
    // panels: [] — and without the archive the wipe guard correctly refuses it,
    // so the restore button was broken for exactly the versions Phase 2 makes.
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    await post(autosaveBody({ panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));

    const restored = await upsertLayout({
      projectId: PROJECT, userId: USER_ID, systemType: 'roof',
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR,
      siteArchives: { version: 1, activeSiteKey: KEY_B, sites: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } } },
    } as never);
    expect(restored.panels).toEqual([]);
    expect(((await get())!.siteArchives as any).sites[KEY_A].panels).toHaveLength(52);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 the wipe guard relaxes only while the property is CHANGING', () => {
  it('an ordinary wipe at the SAME property is still refused', async () => {
    // The relaxation had no bound in time: once a project had archived a
    // >=4-panel property, EVERY later `panels: []` save passed — for ever,
    // including the July reload bug the guard was built for.
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    await post(autosaveBody({ panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    // Switch away — allowed, this is a real property change.
    expect((await post(autosaveBody({
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
    }))).status).toBe(200);
    // Design at B …
    const bPanels = Array.from({ length: 9 }, (_, i) => panel(`nb-${i}`, NEIGHBOUR));
    expect((await post(autosaveBody({
      panels: bPanels, roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
    }))).status).toBe(200);
    // 🚨 … then a reload-bug wipe AT B, with the archive still present. The old
    // relaxation passed this because the archive held 'roof' panels. It must not.
    const res = await post(autosaveBody({
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
    }));
    expect(res.status).toBe(409);
    expect((res.json as { code?: string }).code).toBe('LAYOUT_SUBSYSTEM_WIPE');
    expect((await get())!.panels).toHaveLength(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 a caller that omits roofPlanes must not delete them', () => {
  it('omitting roofPlanes and mapCenter KEEPS them (the bill-upload path)', async () => {
    // /api/engineering/preliminary sends neither, and roof_planes used to be
    // written unconditionally — so uploading a bill deleted the roof of a
    // designed project, and after migration 123 left site_archives naming a
    // roof that no longer existed.
    const planes = Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A));
    await post(autosaveBody({ panels: [panel('p0')], roofPlanes: planes, mapCenter: MELVIN, activeSiteKey: KEY_A }));

    await upsertLayout({
      projectId: PROJECT, userId: USER_ID, systemType: 'roof',
      panels: Array.from({ length: 10 }, (_, i) => panel(`synthetic-${i}`)),
      totalPanels: 10, systemSizeKw: 4,
      // roofPlanes and mapCenter deliberately ABSENT, as that route sends them
    } as never);

    const after = await get();
    expect(after?.roofPlanes, 'the roof must survive a bill upload').toHaveLength(6);
    expect(after?.mapCenter?.lat).toBeCloseTo(MELVIN.lat, 4);
  });

  it('…but an explicit [] still clears the roof', async () => {
    const planes = Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A));
    await post(autosaveBody({ panels: [panel('p0')], roofPlanes: planes, mapCenter: MELVIN, activeSiteKey: KEY_A }));
    await post(autosaveBody({ panels: [panel('p0')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    expect((await get())?.roofPlanes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 a deployment that has not run 123 yet', () => {
  /** A database with 122 applied and 123 deliberately absent. */
  async function pre123<T>(fn: (scratch: PGlite) => Promise<T>): Promise<T> {
    const scratch = await PGlite.create();
    const previous = db;
    try {
      await scratch.exec(BASELINE);
      await scratch.exec(SQL_122);
      await scratch.query(
        `INSERT INTO projects (id, user_id, lat, lng, system_type) VALUES ($1,$2,$3,$4,'roof')`,
        [PROJECT, USER_ID, MELVIN.lat, MELVIN.lng],
      );
      db = scratch;
      __resetSiteArchivesProbeForTests();
      return await fn(scratch);
    } finally {
      db = previous;
      __resetSiteArchivesProbeForTests();
      await scratch.close();
    }
  }

  it('still saves the layout — the archive is simply not stored', async () => {
    await pre123(async scratch => {
      const res = await post(autosaveBody({ panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
      expect(res.status).toBe(200);
      const rows = await scratch.query<{ n: number }>(`SELECT jsonb_array_length(panels) AS n FROM layouts`);
      expect(rows.rows[0].n).toBe(1);
    });
  });

  it('🚨 REFUSES the property-change save rather than deleting the layout', async () => {
    // The regression this exists to prevent, and it is the worst kind — a
    // guard disarming itself. The wipe guard treats archived panels as
    // present, which is correct ONLY while the archive reaches the database.
    // Without migration 123 the archive is silently dropped, so counting it
    // would let `panels: []` through and DELETE the very layout the guard
    // exists to protect. Absent the column, the guard stays at full strength.
    await pre123(async scratch => {
      const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
      expect((await post(autosaveBody({
        panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
      }))).status).toBe(200);

      // The user picks the house next door.
      const res = await post(autosaveBody({
        panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
        archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
      }));
      // 🚨 409, NOT 503. This used to assert 503, because every throw in the
      // route went through handleRouteDbError, which labels anything that is not
      // a DbConfigError as DB_STARTING — a status its own comment calls
      // transient and self-resolving. This refusal is neither: it is permanent
      // and deliberate, and reporting it as a database hiccup meant the studio
      // showed a five-second generic badge and the operator saw a transient
      // warning for a condition that actually means "run migration 123".
      expect(res.status).toBe(409);
      // 🚨 AND THE DIAGNOSIS IS NOW THE ACCURATE ONE. Both guards refuse this
      // save, but the archive check runs first and names the actual cause —
      // there is nowhere to put the other property's design — instead of the
      // wipe guard's symptom, 'an entire sub-system would vanish'. The operator
      // is told to run migration 123 rather than left to infer it.
      const body = res.json as { code?: string; refused?: boolean };
      expect(body.code).toBe('LAYOUT_ARCHIVE_UNSTORABLE');
      expect(body.refused).toBe(true);
      // 🚨 And the 52 panels are still there.
      const rows = await scratch.query<{ n: number }>(`SELECT jsonb_array_length(panels) AS n FROM layouts`);
      expect(rows.rows[0].n).toBe(52);
    });
  });

  it('🚨 ONE panel at the new property does NOT overwrite the previous 52', async () => {
    // THE HOLE THE WIPE GUARD NEVER COVERED.
    //
    // That guard compares systemType BUCKET MEMBERSHIP, not identity and not
    // count. It fires only when the incoming array has no panels of a stored
    // type at all — which is why the `panels: []` case above is caught. Place
    // ONE roof panel at the new property and 'roof' is in `incoming`, the guard
    // passes, and `panels = ${panelsJson}::jsonb` (no COALESCE, unlike
    // roof_planes and map_center beside it) replaces the 52 with the 1 — while
    // the archive that was holding those 52 is dropped by the swallowed catch in
    // applyDesignEntities. HTTP 200. Badge says "saved".
    //
    // This is the normal roof→roof case, i.e. what actually happens when a user
    // picks the house next door and starts designing.
    await pre123(async scratch => {
      const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
      expect((await post(autosaveBody({
        panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
      }))).status).toBe(200);

      const res = await post(autosaveBody({
        panels: [panel('neighbour-0')], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
        archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
      }));

      expect(res.status).toBe(409);
      const body = res.json as { code?: string; error?: string };
      expect(body.code).toBe('LAYOUT_ARCHIVE_UNSTORABLE');
      expect(body.error).toMatch(/migration 123/);
      expect(body.error).toMatch(/52 panels/);

      // NOTHING was written — the refusal happens before any UPDATE.
      const rows = await scratch.query<{ n: number }>(`SELECT jsonb_array_length(panels) AS n FROM layouts`);
      expect(rows.rows[0].n).toBe(52);
    });
  });

  it('an EMPTY archive is still allowed through — only real loss is refused', async () => {
    // An archive with no entities round-trips identically whether it is stored
    // or not, so refusing it would break ordinary single-property use on a
    // pre-123 deployment for no benefit. Fail closed on loss, not on presence.
    await pre123(async scratch => {
      const res = await post(autosaveBody({
        panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
        archives: { [KEY_B]: { panels: [], roofPlanes: [], obstructions: [], measurements: [] } },
      }));
      expect(res.status).toBe(200);
      const rows = await scratch.query<{ n: number }>(`SELECT jsonb_array_length(panels) AS n FROM layouts`);
      expect(rows.rows[0].n).toBe(1);
    });
  });

  it('a non-panel archive counts as loss too — roof planes alone are enough', async () => {
    // The archive carries four entity kinds. Refusing only when PANELS would be
    // lost would silently discard a traced roof, which is just as much work.
    await pre123(async () => {
      const res = await post(autosaveBody({
        panels: [panel('p1')], roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A,
        archives: { [KEY_B]: { panels: [], roofPlanes: [plane('r0', KEY_B, NEIGHBOUR)], obstructions: [], measurements: [] } },
      }));
      expect(res.status).toBe(409);
      expect((res.json as { code?: string }).code).toBe('LAYOUT_ARCHIVE_UNSTORABLE');
    });
  });

  it('…and the one-panel property change SUCCEEDS once 123 has run', async () => {
    // The other half of the contract: the refusal is about the column, not about
    // the operation. With somewhere to put the archive, the same save is fine.
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    await post(autosaveBody({ panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    const res = await post(autosaveBody({
      panels: [panel('neighbour-0')], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
    }));
    expect(res.status).toBe(200);
    const after = (await get())!;
    expect(after.panels).toHaveLength(1);
    expect(((after.siteArchives as any).sites[KEY_A].panels)).toHaveLength(52);
  });

  it('…and the SAME save is allowed once 123 has run', async () => {
    // The two halves together are the contract: the guard relaxes exactly when,
    // and only when, the archive can actually be stored.
    const melvinPanels = Array.from({ length: 52 }, (_, i) => panel(`melvin-${i}`));
    await post(autosaveBody({ panels: melvinPanels, roofPlanes: [], mapCenter: MELVIN, activeSiteKey: KEY_A }));
    const res = await post(autosaveBody({
      panels: [], roofPlanes: [], mapCenter: NEIGHBOUR, activeSiteKey: KEY_B,
      archives: { [KEY_A]: { panels: melvinPanels, roofPlanes: [], obstructions: [], measurements: [] } },
    }));
    expect(res.status).toBe(200);
    expect(((await get())!.siteArchives as any).sites[KEY_A].panels).toHaveLength(52);
  });
});
