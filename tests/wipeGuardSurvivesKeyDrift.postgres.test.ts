/**
 * tests/wipeGuardSurvivesKeyDrift.postgres.test.ts
 *
 * THE SUB-SYSTEM WIPE GUARD DISARMED ITSELF WHEN A SITE KEY DRIFTED.
 *
 * `LAYOUT_SUBSYSTEM_WIPE` is the only thing standing between a property change
 * and a destroyed layout. Changing property moves the previous property's panels
 * out of `panels` and into `site_archives` in ONE save, which looks exactly like
 * a whole sub-system vanishing — so the guard counts archived panels as present,
 * but ONLY while the property is actually changing. That bound exists because an
 * unbounded relaxation had already disarmed the guard permanently: an archive is
 * never evicted, so once a project had archived a four-plus-panel property, every
 * later `panels: []` save passed for ever, including the reload defect the guard
 * was built for (81 panels → {} → 19 in three saves).
 *
 * 🚨 AND THE BOUND WAS A STRING COMPARISON. `switchingProperty` was
 * `storedKey !== arch.activeSiteKey`, so ANY difference in the key counted as a
 * property change — including a difference that is not one.
 *
 * A site key is DERIVED FROM COORDINATES, and those coordinates drift. The
 * repo's own model says so in as many words: `nearestSamePropertyKey` exists
 * precisely because "the key being looked up was re-derived from a coordinate
 * that drifts", and a user returning to a property the archive genuinely held
 * missed it and got the destructive branch for a design sitting right there
 * under a neighbouring key. `sitesAreSameProperty` is the authority on whether
 * two keys are one property: identical, or within `SITE_MATCH_RADIUS_M`.
 *
 * So re-picking THE SAME HOUSE — a fresh geocode, a slightly different pin, a
 * Pick House click a metre off the last one — produced a new key, and the guard
 * read that as a property change and stood down. A `panels: []` save at the same
 * property then went through, which is the exact shape of the defect the guard
 * exists to refuse. The relaxation was strictly wider than intended, in the
 * direction of losing data.
 *
 * 🚨 THE FIX IS NARROWING, SO THE FALSE-REFUSAL SIDE IS PINNED TOO. A guard that
 * refuses a legitimate address change is worse than the bug it prevents: the
 * archive would then never reach the database and the NEXT save really would lose
 * it. Both directions are asserted below, and neither case would pass on the
 * other's implementation.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL. `switchingProperty` reads the stored
 * `activeSiteKey` back out of the row with its own query, so the behaviour only
 * exists across a real database round trip. PGlite — PostgreSQL in-process, no
 * daemon, no credentials — with the real migrations in numeric order.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// ── The real database, shimmed to Neon's tagged-template shape ──────────────
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

const { upsertLayout, __resetSiteArchivesProbeForTests } = await import('@/lib/db/projects');
const { layoutRefusalCode } = await import('@/lib/db/core');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { sitesAreSameProperty, SITE_MATCH_RADIUS_M } = await import('@/lib/design/siteDesignModel');

// ── The real migrations, in numeric order. Same two honest adaptations the
//    sibling postgres suite documents: pgcrypto (PGlite ships no extension, and
//    gen_random_uuid() is core from 13) and five `projects` columns the product
//    uses that no migration file creates.
const MIGRATION_DIR = join(process.cwd(), 'lib', 'migrations');
const COLUMNS_NO_MIGRATION_CREATES: ReadonlyArray<[string, string]> = [
  ['city', 'TEXT'],
  ['engineering_seed', 'JSONB'],
  ['engineering_config', 'JSONB'],
  ['engineering_updated_at', 'TIMESTAMPTZ'],
  ['no_itc', 'BOOLEAN DEFAULT FALSE'],
];

async function applyRealMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATION_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATION_DIR, f), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g,
        '-- pgcrypto omitted: gen_random_uuid() is core Postgres from 13 onwards');
    try { await pg.exec(sql); } catch { /* unrelated subsystems; layouts/projects unaffected */ }
  }
  for (const [name, type] of COLUMNS_NO_MIGRATION_CREATES) {
    await pg.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${name} ${type};`);
  }
}

// ── Melvin, and a drifted pin on the very same roof ─────────────────────────
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };

/** Roughly two metres north — a re-geocode of the same house, not a new one. */
const MELVIN_DRIFTED = { lat: MELVIN.lat + 0.000018, lng: MELVIN.lng };

/** 5 Melvin Drive: a genuinely different property. */
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };

const KEY_A       = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_DRIFTED = siteKeyFromCoords(MELVIN_DRIFTED.lat, MELVIN_DRIFTED.lng, PROJECT);
const KEY_NEIGHBOUR = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);

const panel = (id: string, at = MELVIN) => ({
  id, planeId: 'melvin-r0', lat: at.lat, lng: at.lng, wattage: 400, systemType: 'roof',
});
const plane = (id: string, key: string, at = MELVIN) => ({
  id, siteKey: key, pitch: 20, azimuth: 180,
  vertices: [
    { lat: at.lat, lng: at.lng },
    { lat: at.lat + 0.0001, lng: at.lng },
    { lat: at.lat + 0.0001, lng: at.lng + 0.0001 },
  ],
});

const TWELVE = Array.from({ length: 12 }, (_, i) => panel(`melvin-p${i}`));

function save(panels: unknown[], activeSiteKey: string, extra: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT,
    userId: USER_ID,
    systemType: 'roof' as const,
    panels: panels as never,
    roofPlanes: [plane('melvin-r0', activeSiteKey)] as never,
    obstructions: [] as never,
    measurements: [] as never,
    siteArchives: {
      version: 1,
      activeSiteKey,
      // A four-plus-panel archived property — the shape that made the
      // unbounded relaxation permanent.
      sites: { [KEY_A]: { panels: TWELVE, roofPlanes: [plane('melvin-r0', KEY_A)] } },
      nativeGeometry: {},
      deletions: { sites: {} },
    } as never,
    mapCenter: MELVIN,
    mapZoom: 19,
    totalPanels: panels.length,
    systemSizeKw: panels.length * 0.4,
    ...extra,
  };
}

async function storedPanelCount(): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT coalesce(jsonb_array_length(panels), 0)::int AS n
     FROM layouts WHERE project_id = $1 AND user_id = $2`, [PROJECT, USER_ID]);
  return r.rows[0]?.n ?? 0;
}

async function seed() {
  await db.exec(`DELETE FROM layouts; DELETE FROM projects;`);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type)
     VALUES ($1,$2,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL 62040',$3,$4,'roof')`,
    [PROJECT, USER_ID, MELVIN.lat, MELVIN.lng],
  );
  __resetSiteArchivesProbeForTests();
  // A real design on the row, at Melvin, so there is something to lose.
  await upsertLayout(save(TWELVE, KEY_A) as never);
  expect(await storedPanelCount()).toBe(12);
}

beforeAll(async () => {
  db = await PGlite.create();
  await applyRealMigrations(db);
});
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the fixture really models a drift, not a move', () => {
  it('the drifted key is a DIFFERENT string', () => {
    // Without this the whole file is vacuous: if the key were identical the old
    // `!==` comparison would already have answered correctly.
    expect(KEY_DRIFTED).not.toBe(KEY_A);
  });

  it('...but the same property, by the repo\'s own authority', () => {
    expect(sitesAreSameProperty(KEY_A, KEY_DRIFTED)).toBe(true);
    // And comfortably inside the radius, not borderline.
    expect(SITE_MATCH_RADIUS_M).toBeGreaterThan(3);
  });

  it('and the neighbour is genuinely a different property', () => {
    expect(sitesAreSameProperty(KEY_A, KEY_NEIGHBOUR)).toBe(false);
  });
});

describe('🚨 a drifted key must NOT disarm the wipe guard', () => {
  it('🚨 emptying the array under a drifted key is still refused', async () => {
    // The defect: `storedKey !== activeSiteKey` was true, so archived panels
    // counted as present and this save went through — deleting a twelve-panel
    // roof at the property the user was still standing on.
    let code: string | null = null;
    try {
      await upsertLayout(save([], KEY_DRIFTED) as never);
    } catch (e) {
      code = layoutRefusalCode(e as Error);
    }
    expect(code, 'a same-property save that empties the roof was accepted')
      .toBe('LAYOUT_SUBSYSTEM_WIPE');
    expect(await storedPanelCount(), 'the roof was destroyed anyway').toBe(12);
  });

  it('and so is emptying it under the SAME key — the case that always worked', async () => {
    // The positive control for the control: this was correct before and must
    // stay correct, or the fix could be "refuse everything".
    let code: string | null = null;
    try {
      await upsertLayout(save([], KEY_A) as never);
    } catch (e) {
      code = layoutRefusalCode(e as Error);
    }
    expect(code).toBe('LAYOUT_SUBSYSTEM_WIPE');
    expect(await storedPanelCount()).toBe(12);
  });
});

describe('🚨 but a REAL property change must still go through', () => {
  it('🚨 moving to the neighbour with an empty active array is accepted', async () => {
    // 🚨 THE DIRECTION THAT MATTERS MOST. A guard that refuses a legitimate
    // address change is worse than the bug it prevents: the archive never
    // reaches the database, so the NEXT save loses it for real. This case fails
    // on a naive "always refuse" fix and on a fix that compares properties the
    // wrong way round.
    await upsertLayout(save([], KEY_NEIGHBOUR) as never);
    expect(await storedPanelCount(),
      'a genuine property change was refused — the archive will never be stored')
      .toBe(0);

    const r = await db.query<{ k: string }>(
      `SELECT site_archives ->> 'activeSiteKey' AS k FROM layouts
       WHERE project_id = $1 AND user_id = $2`, [PROJECT, USER_ID]);
    expect(r.rows[0]?.k, 'the archive did not record the new property')
      .toBe(KEY_NEIGHBOUR);
  });

  it('a first archive on a row with no stored key is accepted', async () => {
    // Nothing to contradict, and refusing would block the very first property
    // change a project ever makes.
    await db.query(
      `UPDATE layouts SET site_archives = NULL WHERE project_id = $1 AND user_id = $2`,
      [PROJECT, USER_ID]);
    await upsertLayout(save([], KEY_NEIGHBOUR) as never);
    expect(await storedPanelCount()).toBe(0);
  });

  it('a non-empty save is never touched by any of this', async () => {
    // The guard only ever looks at a save that removes a whole sub-system.
    await upsertLayout(save(TWELVE.slice(0, 5), KEY_DRIFTED) as never);
    expect(await storedPanelCount()).toBe(5);
  });
});
