/**
 * tests/versionHistoryIsNotNoise.postgres.test.ts
 *
 * A VERSION THAT RECORDS NO CHANGE IS NOT HISTORY.
 *
 * `POST /api/projects/[id]/layout` writes a full-fidelity snapshot to
 * `project_versions` on EVERY save, unconditionally. The route's own comment
 * accepts the size — "the dropped fields are about a dozen numbers per panel,
 * ~11 KB for a 55-panel design. A snapshot that cannot restore the design it
 * snapshots is not worth that" — and says plainly that "the honest place to bound
 * version growth is a retention policy, not a lossy record that looks complete."
 *
 * That was the right call when nobody could see the versions. It is not any more:
 * the design-history panel now lists them, and it is the recovery path for a
 * stale-write refusal, which discards the losing tab's edit. A list of two hundred
 * identical entries is not a way back — it is a way to pick the wrong one
 * confidently, which is the failure the panel was built to prevent.
 *
 * 🚨 THIS FILE MEASURES FIRST. Before adding any rule, it establishes from a real
 * database how many versions a real sequence of saves produces, and specifically
 * whether a save that changes NOTHING produces one. If the answer is no, the
 * non-destructive half of the problem does not exist and the whole question is
 * retention — which is a decision about how long a person's history is worth
 * keeping, and not one to take unilaterally.
 *
 * 🚨 REAL SQL, real route handler, real migrations. A claim about how many rows
 * accumulate cannot be made from reading code: the count depends on what the
 * route does per request and on what the INSERT's own subquery computes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

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
  syncProjectPipeline: async () => ({
    panelCount: 0, artifactsWritten: 0, wasRebuilt: false, errors: [], files: [],
  }),
}));

const { POST } = await import('@/app/api/projects/[id]/layout/route');
const { siteKeyFromCoords } = await import('@/lib/siteIdentity');
const { __resetSiteArchivesProbeForTests } = await import('@/lib/db/projects');

// The real migrations, same two honest adaptations the sibling postgres suites
// document: pgcrypto (PGlite ships no extension; gen_random_uuid() is core from
// 13) and five `projects` columns no migration file creates.
const MIGRATION_DIR = join(process.cwd(), 'lib', 'migrations');
const COLUMNS_NO_MIGRATION_CREATES: ReadonlyArray<[string, string]> = [
  ['city', 'TEXT'],
  ['engineering_seed', 'JSONB'],
  ['engineering_config', 'JSONB'],
  ['engineering_updated_at', 'TIMESTAMPTZ'],
  ['no_itc', 'BOOLEAN DEFAULT FALSE'],
];

async function applyRealMigrations(pg: PGlite): Promise<void> {
  for (const f of readdirSync(MIGRATION_DIR).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATION_DIR, f), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- pgcrypto omitted');
    try { await pg.exec(sql); } catch { /* unrelated subsystems */ }
  }
  for (const [n, t] of COLUMNS_NO_MIGRATION_CREATES) {
    await pg.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${n} ${t};`);
  }
}

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const KEY = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);

const panel = (id: string) => ({
  id, planeId: 'melvin-r0', lat: MELVIN.lat, lng: MELVIN.lng,
  height: 180, wattage: 400, systemType: 'roof',
});
const plane = () => ({
  id: 'melvin-r0', siteKey: KEY, pitch: 20, azimuth: 180,
  vertices: [
    { lat: MELVIN.lat, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng },
    { lat: MELVIN.lat + 0.0001, lng: MELVIN.lng + 0.0001 },
  ],
});

function body(panels: unknown[]) {
  return {
    panels,
    roofPlanes: [plane()],
    obstructions: [],
    measurements: [],
    siteArchives: { version: 1, activeSiteKey: KEY, sites: {}, nativeGeometry: {}, deletions: { sites: {} } },
    mapCenter: MELVIN,
    mapZoom: 19,
    systemType: 'roof',
  };
}

async function post(payload: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/projects/${PROJECT}/layout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return POST(req as never, { params: Promise.resolve({ id: PROJECT }) } as never);
}

async function versionCount(): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM project_versions WHERE project_id = $1`, [PROJECT]);
  return r.rows[0]?.n ?? 0;
}

async function versionRows() {
  const r = await db.query<{ version_number: number; panels_count: number; change_summary: string }>(
    `SELECT version_number, panels_count, change_summary FROM project_versions
     WHERE project_id = $1 ORDER BY version_number`, [PROJECT]);
  return r.rows;
}

beforeAll(async () => {
  db = await PGlite.create();
  await applyRealMigrations(db);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`DELETE FROM project_versions; DELETE FROM layouts; DELETE FROM projects;`);
  await db.query(
    `INSERT INTO projects (id, user_id, name, address, lat, lng, system_type)
     VALUES ($1,$2,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL 62040',$3,$4,'roof')`,
    [PROJECT, USER_ID, MELVIN.lat, MELVIN.lng],
  );
  __resetSiteArchivesProbeForTests();
});

const TWELVE = Array.from({ length: 12 }, (_, i) => panel(`melvin-p${i}`));

describe('the fixture really exercises the version writer', () => {
  it('one save produces one version, numbered from 1', async () => {
    const res = await post(body(TWELVE));
    expect(res.status).toBe(200);
    // The write is fire-and-forget (`.catch` on a floating promise), so give the
    // microtask queue a turn before counting. Asserted rather than assumed: a
    // count of 0 here would make every case below vacuous.
    await new Promise(r => setTimeout(r, 50));
    expect(await versionCount(), 'no version was written at all').toBe(1);
    expect((await versionRows())[0].version_number).toBe(1);
  });

  it('a save that CHANGES something produces a second version', async () => {
    await post(body(TWELVE));
    await new Promise(r => setTimeout(r, 50));
    await post(body(TWELVE.slice(0, 7)));
    await new Promise(r => setTimeout(r, 50));
    const rows = await versionRows();
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.panels_count)).toEqual([12, 7]);
  });
});

describe('🚨 what a REDUNDANT save costs the history', () => {
  it('🚨 MEASURED: identical saves in a row', async () => {
    // 🚨 THE MEASUREMENT THIS FILE EXISTS FOR, and it is deliberately not
    // asserted as a requirement yet. Whether an unchanged save should write a
    // version is a judgement; how many it DOES write is a fact, and the fact has
    // to come first.
    //
    // Five byte-identical payloads, as an autosave burst or a beacon firing after
    // a save would produce.
    for (let i = 0; i < 5; i++) {
      await post(body(TWELVE));
      await new Promise(r => setTimeout(r, 30));
    }
    const n = await versionCount();
    const rows = await versionRows();

    // Recorded in the assertion message so the number is visible in CI output
    // rather than only in a comment that can rot.
    expect(n, `five identical saves produced ${n} version(s); panel counts ` +
      `${JSON.stringify(rows.map(r => r.panels_count))}`)
      .toBeGreaterThan(0);

    // 🚨 THE REQUIREMENT. A save that changes nothing is not a version. It is
    // noise in the one list a person consults to recover from a refusal, and the
    // panel that lists them is now the documented recovery path for
    // LAYOUT_STALE_WRITE — which discards the losing tab's edit.
    expect(n, `five identical saves wrote ${n} snapshots — the design history is ` +
      'unusable as a recovery tool when it is mostly duplicates')
      .toBe(1);
  });

  it('and a change AFTER redundant saves is still recorded', async () => {
    // The complement, and the case a naive "skip if a version exists" would
    // break: suppressing duplicates must not suppress the next real change.
    await post(body(TWELVE));
    await new Promise(r => setTimeout(r, 30));
    await post(body(TWELVE));
    await new Promise(r => setTimeout(r, 30));
    await post(body(TWELVE.slice(0, 3)));
    await new Promise(r => setTimeout(r, 50));

    const rows = await versionRows();
    expect(rows.map(r => r.panels_count),
      'the real change after a duplicate was swallowed')
      .toEqual([12, 3]);
  });

  it('🚨 and the suppressed call still RETURNS the version that says it', async () => {
    // 🚨 THE CONTRACT, which a mutation found unguarded. `saveProjectVersion`
    // returns a `ProjectVersion`, and when it suppresses a duplicate there is
    // still a correct answer: the newest version already records exactly this.
    // Returning undefined instead broke nothing today only because both callers
    // ignore the result — the layout route treats it as fire-and-forget and the
    // restore route only needs it not to throw. A future caller reading
    // `.versionNumber` off it would get a crash, in a path that fires on every
    // save, and nothing would have objected.
    const { saveProjectVersion } = await import('@/lib/db/versions');
    const snapshot = {
      projectId: PROJECT, projectName: 'x',
      layout: { panels: TWELVE, updatedAt: '2026-01-01T00:00:00.000Z' },
      savedAt: '2026-01-01T00:00:00.000Z',
    };
    const first = await saveProjectVersion({
      projectId: PROJECT, userId: USER_ID, snapshot, panelsCount: 12, systemSizeKw: 4.8,
    });
    expect(first.versionNumber).toBe(1);

    // The same content, with both volatile fields DIFFERENT — which is exactly
    // what the next real save looks like.
    const again = await saveProjectVersion({
      projectId: PROJECT, userId: USER_ID, panelsCount: 12, systemSizeKw: 4.8,
      snapshot: {
        ...snapshot,
        layout: { panels: TWELVE, updatedAt: '2026-06-06T12:34:56.789Z' },
        savedAt: '2026-06-06T12:34:56.789Z',
      },
    });
    expect(again, 'the suppressed call returned nothing').toBeTruthy();
    expect(again.versionNumber, 'the suppressed call did not return the version that records this')
      .toBe(1);
    expect(again.id).toBe(first.id);
    expect(await versionCount(), 'a duplicate was written after all').toBe(1);
  });

  it('returning to an EARLIER state is a change, not a duplicate', async () => {
    // A → B → A. The last save matches version 1 but not the newest version, and
    // it is a genuine edit: the user undid something and that is worth recording.
    // A rule that compared against any existing version rather than the newest
    // would lose it.
    await post(body(TWELVE));
    await new Promise(r => setTimeout(r, 30));
    await post(body(TWELVE.slice(0, 5)));
    await new Promise(r => setTimeout(r, 30));
    await post(body(TWELVE));
    await new Promise(r => setTimeout(r, 50));

    expect((await versionRows()).map(r => r.panels_count)).toEqual([12, 5, 12]);
  });
});
