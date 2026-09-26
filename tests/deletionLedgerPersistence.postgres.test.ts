/**
 * tests/deletionLedgerPersistence.postgres.test.ts
 *
 * A DESTRUCTIVE SAVE MAY NOT REPORT SUCCESS UNLESS THE DELETION AUTHORITY
 * ACTUALLY PERSISTED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 * The tombstone ledger has no column of its own. It rides inside
 * `layouts.site_archives`, and that column is written by a SEPARATE statement
 * from the one that removes the geometry — inside a `try` whose only handler is
 * a `console.warn` (lib/db/projects.ts, `applyDesignEntities`).
 *
 * So the two halves of one decision could come apart:
 *
 *     UPDATE layouts SET panels = …, roof_planes = …   ← committed
 *     UPDATE layouts SET site_archives = …             ← threw, swallowed
 *     upsertLayout returns normally → route answers 200 → studio shows "Saved"
 *
 * The pre-check built to stop exactly this (`LAYOUT_ARCHIVE_UNSTORABLE`)
 * inspected only `sites[*].{panels,roofPlanes,obstructions,measurements}`. Its
 * own comment — "an archive with no entities round-trips identically whether it
 * is stored or not" — is TRUE of entity bundles and FALSE of the ledger: a
 * ledger is a decision, not an entity, and an archive can be empty of entities
 * while carrying every tombstone in the project.
 *
 * The consequence is not a lost preference. `lifecycleFor` reads a property
 * with no geometry and no tombstones as `untouched`, which is the ONE state
 * that permits automatic re-acquisition — so on the next load Lane A re-injects
 * the roof the installer deliberately deleted, having been told it was saved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE USES A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * The defect lives in the gap between two SQL statements. A stubbed `sql` can
 * be made to fail on command, but it cannot prove what the row looks like
 * afterwards, and "the row still holds the face the refused save tried to
 * remove" is the assertion that separates a real fix from a louder log line.
 *
 * PGlite — PostgreSQL compiled to WASM, in-process, no daemon, no credentials —
 * with the REAL migration files applied in numeric order. The ledger write is
 * failed two ways, both of them real database behaviour rather than a mock:
 *
 *   1. migration 123 never run, so the column genuinely does not exist
 *      (production's actual failure mode — see memory: migration-four-gates);
 *   2. the column present but the write refused by a trigger, which is what a
 *      constraint violation, a permissions change or a transient fault looks
 *      like from inside `applyDesignEntities`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// ── The real database, shimmed to Neon's tagged-template shape ──────────────
// Identical translation to tests/siteDesignRoute.postgres.test.ts; everything
// it feeds is production code.
let db: PGlite;

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
vi.mock('@/lib/engineering/syncPipeline', () => ({
  syncProjectPipeline: async () => ({ panelCount: 0, artifactsWritten: 0, wasRebuilt: false, errors: [], files: [] }),
}));

const { POST } = await import('@/app/api/projects/[id]/layout/route');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { __resetSiteArchivesProbeForTests } = await import('@/lib/db/projects');
const { parseDeletionLedger, lifecycleFor, resolveLedgerKey, authorizesSubsystemRemoval, makeAuthorization } =
  await import('@/lib/design/deletionAuthority');
const { sitesAreSameProperty } = await import('@/lib/design/siteDesignModel');
const { shouldRunLaneA } = await import('@/lib/3d/laneA');

const sqlOf = (f: string) => readFileSync(join(process.cwd(), 'lib', 'migrations', f), 'utf8');
const SQL_122 = sqlOf('122_layout_obstructions_measurements.sql');
const SQL_123 = sqlOf('123_layout_site_archives.sql');

/** The 001 subset the layout path touches — same baseline as the sibling
 *  Postgres suite, so a failure here is attributable to the layout path and
 *  never to a fixture that is missing a column the product relies on. */
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

// ── Melvin, its drifted twin, and the neighbour ─────────────────────────────
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
/** The SAME house, 3.3 m north — the live key drift this repo has measured. */
const MELVIN_AGAIN = { lat: 38.70618257709013, lng: -90.04625419301613 };
/** A DIFFERENT house, 15.6 m north — outside SITE_MATCH_RADIUS_M. */
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_A_DRIFT = siteKeyFromCoords(MELVIN_AGAIN.lat, MELVIN_AGAIN.lng, PROJECT);
const KEY_B = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);

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

const DESIGN_PANELS = Array.from({ length: 12 }, (_, i) => panel(`melvin-p${i}`));
const DESIGN_PLANES = Array.from({ length: 6 }, (_, i) => plane(`melvin-r${i}`));

function ledgerWith(key: string, faceIds: string[], clearedAt = 0) {
  return { sites: { [key]: { faceIds, sectionIds: [], obstructionIds: [], clearedAt } } };
}

function body(opts: {
  panels: unknown[];
  roofPlanes: unknown[];
  activeSiteKey: string;
  deletions?: unknown;
  destructive?: unknown;
}) {
  return {
    panels: opts.panels,
    roofPlanes: opts.roofPlanes,
    mapCenter: MELVIN,
    mapZoom: 19,
    systemType: 'roof',
    obstructions: [],
    measurements: [],
    siteArchives: {
      version: 1,
      activeSiteKey: opts.activeSiteKey,
      sites: {},
      nativeGeometry: {},
      deletions: opts.deletions ?? { sites: {} },
    },
    ...(opts.destructive ? { destructive: opts.destructive } : {}),
  };
}

async function post(payload: unknown) {
  const res = await POST(
    new Request(`http://localhost/api/projects/${PROJECT}/layout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }) as unknown as import('next/server').NextRequest,
    { params: Promise.resolve({ id: PROJECT }) },
  );
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

/** Read the row directly. Never through the route — the point of several of
 *  these assertions is what is ON DISK after a refusal. */
async function row(cols: string) {
  const r = await db.query<Record<string, unknown>>(
    `SELECT ${cols} FROM layouts WHERE project_id = $1`, [PROJECT],
  );
  return r.rows[0] ?? null;
}

async function seedProject() {
  await db.exec(`DELETE FROM layouts; DELETE FROM project_versions; DELETE FROM projects;`);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type) VALUES ($1,$2,$3,$4,$5,$6,'roof')`,
    [PROJECT, USER_ID, 'BRAIDON M PILLA — Solar', '3 Melvin Drive, Granite City, IL 62040', MELVIN.lat, MELVIN.lng],
  );
  __resetSiteArchivesProbeForTests();
}

/** The save the studio sends after "Start Over" at Melvin: the geometry gone,
 *  the tombstones recorded, and the one-shot authorization that explains it. */
const DELETE_EVERYTHING = {
  panels: [],
  roofPlanes: [],
  activeSiteKey: KEY_A,
  deletions: ledgerWith(KEY_A, DESIGN_PLANES.map(p => p.id), 1_700_000_000_000),
  destructive: {
    op: 'design', siteKey: KEY_A,
    faceIds: DESIGN_PLANES.map(p => p.id), sectionIds: [], obstructionIds: [],
    panelIds: DESIGN_PANELS.map(p => p.id), panelSystemTypes: ['roof'],
    at: 1_700_000_000_000,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE COLUMN DOES NOT EXIST (migration 123 not run) — production's case
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a deletion that cannot be recorded is not a save', () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(BASELINE);
    await db.exec(SQL_122);           // 122 only. 123 is deliberately NOT run.
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(seedProject);

  it('the row really has no site_archives column — the fixture is honest', async () => {
    const r = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='layouts' AND column_name='site_archives'`,
    );
    expect(r.rows).toHaveLength(0);
  });

  it('refuses the destructive save instead of answering 200', async () => {
    expect((await post(body({
      panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
    }))).status).toBe(200);

    const res = await post(body(DELETE_EVERYTHING));

    // 🚨 THE INVARIANT. Never "Saved" followed by resurrection.
    expect(res.status).not.toBe(200);
    expect(res.json.success).toBe(false);
    expect(res.json.code).toBe('LAYOUT_ARCHIVE_UNSTORABLE');
    expect(String(res.json.error)).toMatch(/deletion/i);
    // and it says what to do about it, because a refusal nobody can act on is
    // a dead end.
    expect(String(res.json.error)).toMatch(/migration 123/i);
  });

  it('and NOTHING is written — the geometry the refusal protects is still there', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    await post(body(DELETE_EVERYTHING));

    const r = await row('panels, roof_planes');
    expect((r?.panels as unknown[])).toHaveLength(12);
    expect((r?.roof_planes as unknown[])).toHaveLength(6);
  });

  it('an ordinary save with no deletions still works exactly as before', async () => {
    // A guard that says no to everything is not a guard. A single-property
    // project on a pre-123 deployment must keep working.
    expect((await post(body({
      panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
    }))).status).toBe(200);
    expect((await post(body({
      panels: DESIGN_PANELS.slice(0, 11), roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
      deletions: { sites: {} },
    }))).status).toBe(200);
    expect((await row('panels'))?.panels).toHaveLength(11);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE COLUMN EXISTS AND THE WRITE FAILS — every other cause
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a ledger write that fails takes the whole save down with it', () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(BASELINE);
    await db.exec(SQL_122);
    await db.exec(SQL_123);
    // A real refusal from the database, not a stubbed rejection: any UPDATE
    // that changes site_archives raises. This is what a constraint violation,
    // a revoked grant or a transient fault looks like from inside
    // `applyDesignEntities` — the code path whose only handler was a warn.
    await db.exec(`
      CREATE OR REPLACE FUNCTION refuse_archive_write() RETURNS trigger AS $$
      BEGIN
        IF NEW.site_archives IS DISTINCT FROM OLD.site_archives THEN
          RAISE EXCEPTION 'simulated site_archives storage failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    // 🚨 AND THE QUIETER HALF. This one raises NOTHING: it accepts the UPDATE
    // and keeps the old value. No exception, no missing row, no warning — the
    // statement "succeeds" and the decision is not on disk. A guard built only
    // around try/catch cannot see this, which is why the write is verified by
    // what it RETURNS rather than by whether it threw. (A column default, a
    // rule, a replica lag or a mis-scoped WHERE all look like this.)
    await db.exec(`
      CREATE OR REPLACE FUNCTION swallow_archive_write() RETURNS trigger AS $$
      BEGIN
        NEW.site_archives := OLD.site_archives;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec(`
      DROP TRIGGER IF EXISTS refuse_archive ON layouts;
      DROP TRIGGER IF EXISTS swallow_archive ON layouts;
    `);
    await seedProject();
  });

  const armFailure = () => db.exec(`
    CREATE TRIGGER refuse_archive BEFORE UPDATE ON layouts
    FOR EACH ROW EXECUTE FUNCTION refuse_archive_write();
  `);
  const armSilentDrop = () => db.exec(`
    CREATE TRIGGER swallow_archive BEFORE UPDATE ON layouts
    FOR EACH ROW EXECUTE FUNCTION swallow_archive_write();
  `);

  it('does not report success', async () => {
    expect((await post(body({
      panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
    }))).status).toBe(200);

    await armFailure();
    const res = await post(body(DELETE_EVERYTHING));

    expect(res.status).not.toBe(200);
    expect(res.json.success).toBe(false);
  });

  it('leaves the geometry and the ledger in step — no half-applied deletion', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    await armFailure();
    await post(body(DELETE_EVERYTHING));

    // 🚨 THE WHOLE POINT. The old code committed the geometry removal and then
    // lost the tombstones, which is the one combination that resurrects: a
    // property with no faces and no record of why.
    const r = await row('panels, roof_planes, site_archives');
    const stored = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    const faces = (r?.roof_planes as unknown[] | null) ?? [];

    const ledgerKept = Object.keys(stored.sites).length > 0;
    const geometryRemoved = faces.length === 0;
    expect(
      geometryRemoved && !ledgerKept,
      'the row has no geometry and no tombstones — Lane A will re-acquire',
    ).toBe(false);
  });

  it('and the resurrection that state causes is demonstrated, not assumed', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    await armFailure();
    await post(body(DELETE_EVERYTHING));

    const r = await row('roof_planes, site_archives');
    const stored = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    const planeCount = ((r?.roof_planes as unknown[] | null) ?? []).length;
    const life = lifecycleFor(stored, resolveLedgerKey(stored, KEY_A, sitesAreSameProperty), planeCount);

    // `untouched` is the ONE lifecycle that lets a machine re-inject geometry.
    // Reaching it after a deletion is the resurrection.
    expect(shouldRunLaneA({
      stage: 'done', groundElevResolved: true, restoreResolved: true,
      segmentCount: 6, existingPlaneCount: planeCount, lifecycle: life,
      siteKey: KEY_A, lastRanSiteKey: null, nativeDisposition: 'undecided',
    })).toBe(false);
  });

  it('a write that raises nothing and stores nothing is caught too', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    await armSilentDrop();

    const res = await post(body(DELETE_EVERYTHING));
    expect(res.status).not.toBe(200);
    expect(res.json.success).toBe(false);
    // The geometry is untouched, because the ledger is written first and its
    // RETURNING value is what decides whether the save may go on.
    expect((await row('roof_planes'))?.roof_planes).toHaveLength(6);
  });

  it('the FIRST save a project ever makes is held to the same rule', async () => {
    // No layout row yet, so `upsertLayout` takes the INSERT branch and the
    // ledger cannot be written before the geometry — there is nothing to write
    // it to. The only thing standing between this and a silent 200 is
    // `applyDesignEntities` refusing to swallow its own failure.
    expect(await row('panels')).toBeNull();
    await armFailure();

    const res = await post(body({
      panels: [], roofPlanes: [], activeSiteKey: KEY_A,
      deletions: ledgerWith(KEY_A, ['traced-then-deleted'], 1_700_000_000_000),
      destructive: {
        op: 'design', siteKey: KEY_A, faceIds: ['traced-then-deleted'], sectionIds: [],
        obstructionIds: [], panelIds: [], panelSystemTypes: ['roof'], at: 1,
      },
    }));
    expect(res.status).not.toBe(200);
    expect(res.json.success).toBe(false);
  });

  it('the very next save succeeds once the failure clears — no permanent lockout', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    await armFailure();
    expect((await post(body(DELETE_EVERYTHING))).status).not.toBe(200);

    await db.exec(`DROP TRIGGER IF EXISTS refuse_archive ON layouts;`);
    const retry = await post(body(DELETE_EVERYTHING));
    expect(retry.status).toBe(200);

    const r = await row('roof_planes, site_archives');
    const stored = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    expect(stored.sites[KEY_A]?.faceIds).toHaveLength(6);
    expect(stored.sites[KEY_A]?.clearedAt).toBeGreaterThan(0);
    expect((r?.roof_planes as unknown[])).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POSITIVE CONTROL — the happy path still reaches the disk and is read back
// ═══════════════════════════════════════════════════════════════════════════

describe('a recorded deletion survives the round trip', () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(BASELINE);
    await db.exec(SQL_122);
    await db.exec(SQL_123);
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(seedProject);

  it('Start Over saves, stores the ledger, and reads back as `cleared`', async () => {
    expect((await post(body({
      panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
    }))).status).toBe(200);
    expect((await post(body(DELETE_EVERYTHING))).status).toBe(200);

    const r = await row('roof_planes, site_archives');
    const stored = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    const planeCount = ((r?.roof_planes as unknown[] | null) ?? []).length;
    expect(planeCount).toBe(0);
    expect(lifecycleFor(stored, KEY_A, planeCount)).toBe('cleared');

    // And the gate that used to re-inject now refuses.
    expect(shouldRunLaneA({
      stage: 'done', groundElevResolved: true, restoreResolved: true,
      segmentCount: 6, existingPlaneCount: 0, lifecycle: 'cleared',
      siteKey: KEY_A, lastRanSiteKey: null, nativeDisposition: 'undecided',
    })).toBe(false);
  });

  it('an unexplained wipe is STILL refused — the guard did not go soft', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    // No authorization, no tombstones: the July reload bug's signature.
    const res = await post(body({ panels: [], roofPlanes: [], activeSiteKey: KEY_A }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('LAYOUT_SUBSYSTEM_WIPE');
    expect((await row('panels'))?.panels).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE KEY THE AUTHORIZATION NAMES vs THE KEY THE PAYLOAD SENDS
// ═══════════════════════════════════════════════════════════════════════════
//
// `applyDelete` mints the authorization under `ledgerKeyOf()` — the key the
// LEDGER is filed under, resolved by PROPERTY (components/design/useSiteDesign.ts).
// `toPersistencePayload` sends `state.activeSiteKey` — the RAW key, which
// `switchSite` sets to whatever `toKey` it was handed. After A → B → A the two
// are different spellings of one house, metres apart, and the server compared
// them with `!==`.

describe('🚨 one house, two spellings of its key', () => {
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(BASELINE);
    await db.exec(SQL_122);
    await db.exec(SQL_123);
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(seedProject);

  it('the two keys really are the same property, and the neighbour is not', () => {
    expect(KEY_A_DRIFT).not.toBe(KEY_A);
    expect(sitesAreSameProperty(KEY_A, KEY_A_DRIFT)).toBe(true);
    expect(sitesAreSameProperty(KEY_A, KEY_B)).toBe(false);
  });

  it('the authorization is honoured under the drifted spelling', () => {
    const auth = makeAuthorization('design', KEY_A, { panelSystemTypes: ['roof'] }, 1);
    expect(authorizesSubsystemRemoval(auth, KEY_A_DRIFT, 'roof', sitesAreSameProperty)).toBe(true);
  });

  it('and NOT at the house next door', () => {
    const auth = makeAuthorization('design', KEY_A, { panelSystemTypes: ['roof'] }, 1);
    expect(authorizesSubsystemRemoval(auth, KEY_B, 'roof', sitesAreSameProperty)).toBe(false);
    // Nor for a sub-system it never mentioned.
    expect(authorizesSubsystemRemoval(auth, KEY_A_DRIFT, 'ground', sitesAreSameProperty)).toBe(false);
  });

  it('Start Over is not deadlocked by the drift, end to end', async () => {
    expect((await post(body({
      panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A,
    }))).status).toBe(200);

    // The studio has been away and come back: the payload names the drifted
    // key, the ledger — and therefore the authorization — still names KEY_A.
    const res = await post(body({
      panels: [], roofPlanes: [], activeSiteKey: KEY_A_DRIFT,
      deletions: ledgerWith(KEY_A, DESIGN_PLANES.map(p => p.id), 1_700_000_000_000),
      destructive: { ...DELETE_EVERYTHING.destructive },
    }));
    expect(res.status).toBe(200);

    const r = await row('roof_planes, site_archives');
    const stored = parseDeletionLedger((r?.site_archives as { deletions?: unknown } | null)?.deletions);
    expect(stored.sites[KEY_A]?.faceIds).toHaveLength(6);
  });

  it('a deletion at the neighbour is not a deletion here', () => {
    // The relaxation above is bounded by the SAME radius every other
    // site-identity question in this codebase uses. 15.6 m is not this house.
    expect(resolveLedgerKey(
      { sites: { [KEY_B]: { faceIds: ['their-face'], sectionIds: [], obstructionIds: [], clearedAt: 0 } } },
      KEY_A, sitesAreSameProperty,
    )).toBe(KEY_A);
  });

  it('an authorization from the house next door does NOT license this wipe', async () => {
    await post(body({ panels: DESIGN_PANELS, roofPlanes: DESIGN_PLANES, activeSiteKey: KEY_A }));
    const res = await post(body({
      panels: [], roofPlanes: [], activeSiteKey: KEY_A,
      deletions: ledgerWith(KEY_B, ['someone-elses-face']),
      destructive: {
        op: 'design', siteKey: KEY_B, faceIds: ['someone-elses-face'], sectionIds: [],
        obstructionIds: [], panelIds: [], panelSystemTypes: ['roof'], at: 1,
      },
    }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('LAYOUT_SUBSYSTEM_WIPE');
    expect((await row('panels'))?.panels).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. A LEDGER CHANGE THAT NOTHING SCHEDULES NEVER REACHES ANY OF THIS
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 Asserted against the SOURCE, deliberately. The trigger under test is a
// React dependency array inside DesignStudio, which cannot be rendered in this
// suite (Cesium, maps, a live project) — and the fact is textual anyway: a
// value that is not in the array cannot start the timer, whatever else is true.
// tests/deletionNoResurrection.test.ts sets the precedent for this instrument.

describe('🚨 undoing a deletion schedules a save of its own', () => {
  const STUDIO = readFileSync(
    join(process.cwd(), 'components', 'design', 'DesignStudio.tsx'), 'utf8',
  );

  it('the autosave timer depends on the deletion ledger', () => {
    const at = STUDIO.indexOf('if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)');
    expect(at).toBeGreaterThan(-1);
    // The effect's own dependency array and nothing beyond it. A window wide enough
    // to reach the E2E bridge would find `site.deletionLedger` there and pass while
    // this effect ignored it.
    //
    // 🚨 LOCATED BY THE ARRAY'S OWN BRACKET, NOT BY ITS LAST MEMBER. This anchored on
    // the literal `saveLayoutToDB]);` — and that member was correctly REMOVED from the
    // array, because it is a `useCallback` over nine values, so while it was a
    // dependency the autosave debounce restarted on its identity churning rather than
    // on the design changing, which could starve the save indefinitely. See
    // tests/autosaveCannotBeStarved.test.ts.
    //
    // That makes THREE guards in this suite that anchored on a member name and broke
    // when a correct change moved it. An array ends where the array ends.
    const open = STUDIO.indexOf('}, [', at);
    expect(open, 'the autosave effect has no dependency array').toBeGreaterThan(at);
    const end = STUDIO.indexOf(']', open);
    expect(end, 'the dependency array is unterminated').toBeGreaterThan(open);
    const deps = STUDIO.slice(open, end + 1);
    // `forgetDeletions` ("Use Google 3D here") changes ONLY the ledger. Without
    // this the decision was held in memory, the row kept the tombstones, and
    // the faces the user asked back were refused again on the next reload.
    expect(deps).toMatch(/site\.deletionLedger/);
  });

  it('and the ledger is still SIGNED, so an unchanged one does not re-POST', () => {
    const model = readFileSync(
      join(process.cwd(), 'lib', 'design', 'siteDesignModel.ts'), 'utf8',
    );
    expect(model).toMatch(/const tombstones = Object\.keys\(a\.deletions\?\.sites \?\? \{\}\)/);
  });
});
