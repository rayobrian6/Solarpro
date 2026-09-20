/**
 * tests/migrationExecution.postgres.test.ts
 *
 * MIGRATIONS 121 AND 122, EXECUTED AGAINST REAL POSTGRESQL.
 *
 * WHY THIS IS DIFFERENT FROM THE OTHER MIGRATION TESTS
 * ----------------------------------------------------
 * tests/migrationGovernance.test.ts and tests/targetedRegistryDeployment.test.ts
 * are STATIC: they read the .sql as text and check it against regexes. That
 * proves the shape is admissible. It does not prove the SQL parses, that the
 * columns land with the types intended, or that running it twice is genuinely a
 * no-op rather than merely looking like one.
 *
 * This runs the real DDL through real PostgreSQL (PGlite — Postgres compiled to
 * WASM, in-process, no daemon, no credentials, no network). So:
 *
 *   • FRESH DATABASE   — schema built from 001, then the migration applied
 *   • IDEMPOTENCY      — applied a SECOND time and asserted to change nothing
 *   • UPGRADE PATH     — applied to a database that already holds rows, with
 *                        those rows asserted intact afterwards
 *
 * 🚨 WHAT THIS DOES NOT PROVE. This is not Ray's Neon instance. It proves the
 * migration is correct and safe to run; it does not prove it HAS been run in
 * production. That still requires the Migration Operator Console, which needs
 * an authenticated super_admin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const sqlOf = (f: string) => readFileSync(join(process.cwd(), 'lib', 'migrations', f), 'utf8');
const SQL_121 = sqlOf('121_app_feature_flags.sql');
const SQL_122 = sqlOf('122_layout_obstructions_measurements.sql');

/** The subset of 001 that migration 122 depends on. Built explicitly rather
 *  than replaying all 122 migrations: this test is about 121/122, and a
 *  hand-built baseline keeps a failure here attributable to them. */
const BASELINE = `
  CREATE TABLE IF NOT EXISTS layouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    user_id         UUID NOT NULL,
    system_type     TEXT NOT NULL DEFAULT 'roof',
    panels          JSONB NOT NULL DEFAULT '[]',
    roof_planes     JSONB,
    map_zoom        INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

async function columnsOf(db: PGlite, table: string): Promise<Record<string, string>> {
  const r = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1`,
    [table],
  );
  return Object.fromEntries(r.rows.map(x => [x.column_name, `${x.data_type}/${x.is_nullable}`]));
}

describe('migration 121 — app_feature_flags, on real PostgreSQL', () => {
  let db: PGlite;
  beforeAll(async () => { db = await PGlite.create(); });
  afterAll(async () => { await db?.close(); });

  it('applies cleanly to a FRESH database', async () => {
    await db.exec(SQL_121);
    const cols = await columnsOf(db, 'app_feature_flags');
    expect(Object.keys(cols).sort()).toEqual([
      'created_at', 'description', 'enabled', 'flag_key', 'id', 'updated_at', 'updated_by_user_id',
    ]);
  });

  it('creates the hot-path index the layout reads on every render', async () => {
    const r = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'app_feature_flags'`,
    );
    expect(r.rows.map(x => x.indexname)).toContain('idx_app_feature_flags_key');
  });

  it('seeds NO rows — a flag nobody set must not arrive switched on', async () => {
    const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM app_feature_flags`);
    expect(r.rows[0].n).toBe(0);
  });

  it('defaults a new flag to DISABLED', async () => {
    await db.exec(`INSERT INTO app_feature_flags (id, flag_key) VALUES ('solardog_enabled', 'solardog_enabled')`);
    const r = await db.query<{ enabled: boolean }>(`SELECT enabled FROM app_feature_flags WHERE id = 'solardog_enabled'`);
    expect(r.rows[0].enabled).toBe(false);
  });

  it('🚨 is IDEMPOTENT — a second run changes nothing and keeps the row', async () => {
    const before = await columnsOf(db, 'app_feature_flags');
    await db.exec(SQL_121);                    // run it again
    expect(await columnsOf(db, 'app_feature_flags')).toEqual(before);
    const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM app_feature_flags`);
    expect(r.rows[0].n).toBe(1);               // the row survived
  });

  it('enforces the unique flag_key', async () => {
    await expect(
      db.exec(`INSERT INTO app_feature_flags (id, flag_key) VALUES ('other', 'solardog_enabled')`),
    ).rejects.toThrow();
  });
});

describe('migration 122 — layout design entities, on real PostgreSQL', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(BASELINE);
  });
  afterAll(async () => { await db?.close(); });

  it('the baseline layouts table has NEITHER column before the migration', async () => {
    const cols = await columnsOf(db, 'layouts');
    expect(cols.obstructions).toBeUndefined();
    expect(cols.measurements).toBeUndefined();
  });

  it('🚨 UPGRADE PATH — applies to a database that already holds rows', async () => {
    // The case that matters: production has layouts in it.
    await db.exec(`
      INSERT INTO layouts (project_id, user_id, system_type, panels, roof_planes)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              'roof', '[{"id":"p1"}]'::jsonb, '[{"id":"r1"}]'::jsonb)
    `);
    await db.exec(SQL_122);

    const cols = await columnsOf(db, 'layouts');
    expect(cols.obstructions).toBe('jsonb/YES');   // nullable, as declared
    expect(cols.measurements).toBe('jsonb/YES');
  });

  it('the pre-existing row is INTACT and its new columns are NULL', async () => {
    // No backfill, no default, nothing rewritten.
    const r = await db.query<{ panels: unknown; roof_planes: unknown; obstructions: unknown; measurements: unknown }>(
      `SELECT panels, roof_planes, obstructions, measurements FROM layouts`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].panels).toEqual([{ id: 'p1' }]);
    expect(r.rows[0].roof_planes).toEqual([{ id: 'r1' }]);
    expect(r.rows[0].obstructions).toBeNull();
    expect(r.rows[0].measurements).toBeNull();
  });

  it('stores a keep-out zone with every field removeObstructedPanels needs', async () => {
    // radiusM / widthM / depthM / heightM decide which panels come back.
    const obstruction = [{
      id: 'o1', lat: 38.89, lng: -89.57, height: 142, radiusM: 0.6,
      widthM: 0.5, depthM: 0.5, heightM: 0.9, type: 'vent', label: 'Kitchen vent',
    }];
    await db.query(`UPDATE layouts SET obstructions = $1::jsonb`, [JSON.stringify(obstruction)]);
    const r = await db.query<{ obstructions: unknown }>(`SELECT obstructions FROM layouts`);
    expect(r.rows[0].obstructions).toEqual(obstruction);
  });

  it('an EMPTY array is distinguishable from NULL — deleting the last one is expressible', async () => {
    // The `?? existing` merge treats undefined as KEEP STORED, so [] has to
    // survive as [] rather than collapsing to NULL.
    await db.query(`UPDATE layouts SET obstructions = $1::jsonb`, ['[]']);
    const r = await db.query<{ obstructions: unknown }>(`SELECT obstructions FROM layouts`);
    expect(r.rows[0].obstructions).toEqual([]);
    expect(r.rows[0].obstructions).not.toBeNull();
  });

  it('🚨 is IDEMPOTENT — a second run changes nothing and keeps the data', async () => {
    const before = await columnsOf(db, 'layouts');
    await db.exec(SQL_122);
    expect(await columnsOf(db, 'layouts')).toEqual(before);
    const r = await db.query<{ n: number; obstructions: unknown }>(
      `SELECT COUNT(*) OVER ()::int AS n, obstructions FROM layouts`,
    );
    expect(r.rows[0].n).toBe(1);
    expect(r.rows[0].obstructions).toEqual([]);   // the data survived
  });

  it('stores measurements alongside, independently', async () => {
    const m = [{ id: 'm1', a: { lat: 1, lng: 2, height: 3 }, b: { lat: 4, lng: 5, height: 6 }, horizDistM: 11.1, slopeDistM: 11.4 }];
    await db.query(`UPDATE layouts SET measurements = $1::jsonb`, [JSON.stringify(m)]);
    const r = await db.query<{ obstructions: unknown; measurements: unknown }>(
      `SELECT obstructions, measurements FROM layouts`,
    );
    expect(r.rows[0].measurements).toEqual(m);
    expect(r.rows[0].obstructions).toEqual([]);   // untouched by the other write
  });
});

describe('both migrations together, in sequence, on one fresh database', () => {
  it('121 then 122 apply cleanly and independently', async () => {
    const db = await PGlite.create();
    try {
      await db.exec(BASELINE);
      await db.exec(SQL_121);
      await db.exec(SQL_122);
      expect(Object.keys(await columnsOf(db, 'app_feature_flags'))).toContain('flag_key');
      expect(Object.keys(await columnsOf(db, 'layouts'))).toContain('obstructions');
      // ...and in the other order, since 122 does not depend on 121.
    } finally { await db.close(); }
  });

  it('122 then 121 also works — they are independent', async () => {
    const db = await PGlite.create();
    try {
      await db.exec(BASELINE);
      await db.exec(SQL_122);
      await db.exec(SQL_121);
      expect(Object.keys(await columnsOf(db, 'layouts'))).toContain('measurements');
      expect(Object.keys(await columnsOf(db, 'app_feature_flags'))).toContain('enabled');
    } finally { await db.close(); }
  });
});
