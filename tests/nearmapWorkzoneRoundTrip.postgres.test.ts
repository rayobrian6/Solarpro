// ═══════════════════════════════════════════════════════════════════════════
// 🚨 address → acquire → persist → reload → reuse. AGAINST A REAL POSTGRES.
//
// Ray: "Your environment lacked NEARMAP_API_KEY and DATABASE_URL, so the actual
// address → acquire → persist → reload → reuse chain is not accepted yet."
//
// Half of that is fixable here and half is not, and the difference is stated rather than blurred:
//
//   · THE DATABASE IS REAL. PGlite is PostgreSQL 16 compiled to WASM, running in-process with no
//     credential. The `projects` and `project_files` DDL is the shipped DDL, extracted from the
//     migration and the migrate route rather than retyped, and the route's own SQL runs against
//     it — the INSERT, the ON CONFLICT, the reads.
//   · THE PAID FETCH IS A COUNTED DOUBLE. There is no NEARMAP_API_KEY here and buying imagery in
//     a test would be wrong even if there were. `fetchNearmapStaticAerial` is mocked and every
//     call is COUNTED, which is the point: the cost invariant is "how many times was the paid
//     thing called", and a counter answers that exactly.
//
// So what this proves is the CHAIN and the COST. What it cannot prove is that Nearmap's servers
// answer, which is Ray's Dev round trip.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const WITH_ADDRESS = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const NO_ADDRESS = '5140c775-cfcf-4440-b22d-de16fbe3f3e8';

const SITE = { lat: 38.6657, lng: -90.2266 };

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,…) text. */
function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
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
  }) as unknown as never;
}

/** 🚨 THE METER. Every call to the paid fetcher lands here and nowhere else. */
const paidCalls: Array<{ lat: number; lng: number; widthPx?: number; heightPx?: number }> = [];
let paidAnswer: unknown = null;

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
let currentUser: { id: string } | null = { id: USER_ID };
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => currentUser,
}));
vi.mock('@/lib/aerial/nearmap', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    fetchNearmapStaticAerial: async (lat: number, lng: number, opts: Record<string, number>) => {
      paidCalls.push({ lat, lng, widthPx: opts?.widthPx, heightPx: opts?.heightPx });
      return paidAnswer;
    },
  };
});

const MIGRATE_ROUTE = read('app', 'api', 'migrate', 'route.ts');
function inlineTableDdl(table: string): string {
  const at = MIGRATE_ROUTE.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (at < 0) {
    throw new Error(`app/api/migrate/route.ts no longer creates ${table}; find its new home `
      + 'before trusting this fixture.');
  }
  let depth = 0;
  const open = MIGRATE_ROUTE.indexOf('(', at);
  for (let j = open; j < MIGRATE_ROUTE.length; j++) {
    if (MIGRATE_ROUTE[j] === '(') depth++;
    else if (MIGRATE_ROUTE[j] === ')') { depth--; if (depth === 0) return MIGRATE_ROUTE.slice(at, j + 1); }
  }
  throw new Error(`unbalanced DDL for ${table}`);
}
const noConcurrently = (s: string) => s.replace(/CONCURRENTLY/gi, '');

/** A 1x1 JPEG as a data URL — enough to be a real `imageBase64`, nothing more. */
const TINY = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(noConcurrently(read('lib', 'migrations', '002_project_coordinates.sql')));
  await db.exec(inlineTableDdl('project_files'));
  await db.exec(`ALTER TABLE project_files
    ADD CONSTRAINT project_files_project_user_name_unique UNIQUE (project_id, user_id, file_name)`);
  // `projects.user_id` is a plain UUID with no foreign key, and 001 does not create `users`,
  // so ownership is exercised by the id alone — which is exactly what the route checks.
});

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  paidCalls.length = 0;
  paidAnswer = null;
  currentUser = { id: USER_ID };
  await db.exec('DELETE FROM project_files');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, lat, lng)
     VALUES ($1, $2, 'With address', 'lead', 'roof', '778 Mildred Ave', $3, $4)`,
    [WITH_ADDRESS, USER_ID, SITE.lat, SITE.lng]);
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type)
     VALUES ($1, $2, 'No address', 'lead', 'roof')`,
    [NO_ADDRESS, USER_ID]);
});

/** Drive the route exactly as Next would. */
async function call(method: 'GET' | 'POST', projectId: string) {
  const mod = await import('@/app/api/projects/[id]/aerial-reference/route');
  const req = new Request(`http://t/api/projects/${projectId}/aerial-reference`, { method });
  const res = await (method === 'GET' ? mod.GET : mod.POST)(
    req as never, { params: Promise.resolve({ id: projectId }) });
  return { status: res.status, body: await res.json() };
}

const goodAerial = {
  imageBase64: TINY, imageWidth: 1440, imageHeight: 810, zoom: 21, tileCount: 42,
};

describe('🚨 nothing is bought before the address gate passes', () => {
  it('a project with no resolved location acquires NOTHING and says why', async () => {
    paidAnswer = goodAerial;
    const r = await call('POST', NO_ADDRESS);
    expect(r.body.available).toBe(false);
    expect(r.body.code).toBe('no-address');
    expect(r.body.reason).toBe('Select a project address to load Nearmap imagery.');
    expect(paidCalls.length,
      'imagery was requested for a project with no address — "Do not make an imagery request '
      + 'before the location gate passes"').toBe(0);
  });

  it("someone else's project acquires nothing", async () => {
    paidAnswer = goodAerial;
    currentUser = { id: OTHER_USER };
    const r = await call('POST', WITH_ADDRESS);
    expect(r.body.available).toBe(false);
    expect(r.body.code).toBe('no-project');
    expect(paidCalls.length).toBe(0);
  });

  it('an unauthenticated caller acquires nothing', async () => {
    paidAnswer = goodAerial;
    currentUser = null;
    const r = await call('POST', WITH_ADDRESS);
    expect(r.status).toBe(401);
    expect(paidCalls.length).toBe(0);
  });
});

describe('🚨 address → acquire → persist → reload → reuse', () => {
  it('acquires ONCE for the project, at its own coordinates, in one bounded frame', async () => {
    paidAnswer = goodAerial;

    // Nothing stored yet.
    const before = await call('GET', WITH_ADDRESS);
    expect(before.body.available).toBe(false);
    expect(paidCalls.length, 'a READ bought imagery').toBe(0);

    // ── ACQUIRE ─────────────────────────────────────────────────────────────
    const acq = await call('POST', WITH_ADDRESS);
    expect(acq.body.acquired, `acquisition failed: ${JSON.stringify(acq.body)}`).toBe(true);
    expect(paidCalls.length, 'the paid fetcher was called more than once for one acquisition').toBe(1);
    expect(paidCalls[0].lat).toBeCloseTo(SITE.lat, 9);
    expect(paidCalls[0].lng).toBeCloseTo(SITE.lng, 9);
    expect(paidCalls[0].widthPx, 'the workzone is not the bounded frame').toBe(1440);
    expect(paidCalls[0].heightPx).toBe(810);

    // ── PERSIST ─────────────────────────────────────────────────────────────
    const rows = await db.query(
      `SELECT file_name, file_type FROM project_files WHERE project_id = $1`, [WITH_ADDRESS]);
    expect(rows.rows.length, 'nothing was written, so a reload would buy it again').toBe(1);
    expect((rows.rows[0] as { file_name: string }).file_name).toBe('aerial_workzone.json');

    // ── RELOAD (a fresh GET is what a page reload does) ──────────────────────
    const after = await call('GET', WITH_ADDRESS);
    expect(after.body.available, 'the stored workzone was not served back').toBe(true);
    expect(after.body.source).toBe('nearmap');
    expect(after.body.imageDataUrl).toBe(TINY);
    expect(after.body.acquisition).toBe('reused');
    expect(after.body.bounds, 'the stored workzone came back without a rectangle').toBeTruthy();
    expect(after.body.bounds.north).toBeGreaterThan(SITE.lat);
    expect(after.body.bounds.south).toBeLessThan(SITE.lat);
    expect(after.body.resolutionCmPerPx).toBeGreaterThan(0);
    // R19: an acquisition time, never a capture date.
    expect(after.body.captureDateKnown).toBe(false);
    expect(after.body.captureDate).toBeNull();
    expect(after.body.acquiredAt, 'the record does not say when it was acquired').toBeTruthy();

    // ── REUSE: NOT ONE MORE PAID CALL, EVER ─────────────────────────────────
    // Native → Nearmap → Native → Nearmap is a sequence of reads plus, at most, a POST that finds
    // the workzone already there.
    for (let i = 0; i < 4; i++) {
      await call('GET', WITH_ADDRESS);
      const again = await call('POST', WITH_ADDRESS);
      expect(again.body.acquired).toBe(false);
      expect(again.body.acquisition).toBe('reused');
    }
    expect(paidCalls.length,
      `four Native ↔ Nearmap round trips cost ${paidCalls.length} paid acquisitions instead of `
      + 'the one that was already made').toBe(1);
  });

  it('🚨 a refusal is never stored and never substituted', async () => {
    // `fetchNearmapStaticAerial` returns null for a missing key, a remembered refusal, or a
    // genuine coverage gap. The product must say so — not store an empty record, and not show
    // another provider under a Nearmap label.
    paidAnswer = null;
    const r = await call('POST', WITH_ADDRESS);
    expect(r.body.acquired).toBe(false);
    expect(r.body.code).toBe('unavailable');
    expect(r.body.reason).toMatch(/[Nn]othing has been substituted/);
    const rows = await db.query(
      `SELECT 1 FROM project_files WHERE project_id = $1`, [WITH_ADDRESS]);
    expect(rows.rows.length, 'a failed acquisition wrote a record').toBe(0);

    // And the next attempt is allowed to try again — a refusal is not a permanent verdict. The
    // storm protection lives in `fetchNearmapStaticAerial`'s own 15-minute refusal memory.
    paidAnswer = goodAerial;
    const ok = await call('POST', WITH_ADDRESS);
    expect(ok.body.acquired).toBe(true);
    expect(paidCalls.length).toBe(2);
  });

  it('a corrupt stored record is not served as imagery', async () => {
    // The column is JSON written by this route, but a record that does not say `nearmap` — or has
    // no image, or no georeferencing — must not come back as the project's Nearmap workzone.
    const bad = Buffer.from(JSON.stringify({ imageSource: 'google', imageBase64: TINY }), 'utf8');
    await db.query(
      `INSERT INTO project_files (project_id, user_id, file_name, file_type, file_size, mime_type, file_data)
       VALUES ($1, $2, 'aerial_workzone.json', 'aerial_workzone', $3, 'application/json', $4)`,
      [WITH_ADDRESS, USER_ID, bad.length, bad]);
    const r = await call('GET', WITH_ADDRESS);
    expect(r.body.available,
      'a record whose provider is not Nearmap was served as the project’s Nearmap workzone')
      .toBe(false);
  });
});
