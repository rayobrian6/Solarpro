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
import { planWorkzone, WORKZONE_TILE_CEILING } from '@/lib/aerial/workzonePlan';

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
const paidCalls: Array<{
  lat: number; lng: number; widthPx?: number; heightPx?: number; zoom?: number;
}> = [];
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
      paidCalls.push({
        lat, lng, widthPx: opts?.widthPx, heightPx: opts?.heightPx, zoom: opts?.zoom,
      });
      if (!paidAnswer) return paidAnswer;
      // 🚨 THE DOUBLE ANSWERS THE QUESTION IT WAS ASKED. A stub that returned one fixed size for
      // every request would store two layers with identical bounds, and the ring/containment
      // arithmetic the renderer depends on would never be exercised. The real fetcher returns the
      // frame it was asked for, at the zoom that answered, so this does too.
      const a = paidAnswer as Record<string, number | string>;
      return {
        ...a,
        imageWidth: opts?.widthPx ?? a.imageWidth,
        imageHeight: opts?.heightPx ?? a.imageHeight,
        zoom: opts?.zoom ?? a.zoom,
        tilesFetched: Math.ceil(((opts?.widthPx ?? 256) / 256) + 1)
          * Math.ceil(((opts?.heightPx ?? 256) / 256) + 1),
      };
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

    // 🚨 THE ROUTE ASKS FOR EXACTLY WHAT THE PLANNER PLANNED, AND NOT ONE FRAME MORE.
    //
    // This used to assert a single 1440x810 frame. Ray rejected that extent live — "conceptually
    // this is approximately project property + nearby neighborhood context rather than one tiny
    // 1440x810 card" — so the bound moved from a hard-coded pair of numbers to `planWorkzone`,
    // which sizes each layer in metres and caps each one with a tile budget. The assertion moved
    // with it: the requested frames must BE the plan, which is itself pinned, extent and cost,
    // in tests/workzoneIsBoundedAndPriced.test.ts.
    const plan = planWorkzone(SITE.lat, SITE.lng)!;
    expect(plan.layers.map(l => l.role)).toEqual(['core', 'context']);
    expect(paidCalls.length,
      'one acquisition made a different number of paid requests than the plan has layers')
      .toBe(plan.layers.length);
    for (let i = 0; i < plan.layers.length; i++) {
      expect(paidCalls[i].lat).toBeCloseTo(SITE.lat, 9);
      expect(paidCalls[i].lng).toBeCloseTo(SITE.lng, 9);
      expect(paidCalls[i].widthPx, `layer ${i} is not the planned frame`).toBe(plan.layers[i].widthPx);
      expect(paidCalls[i].heightPx).toBe(plan.layers[i].heightPx);
    }
    // The CORE keeps the fetcher's 21→20→19 coverage ladder (no explicit zoom); the CONTEXT is
    // defined by its zoom and asks for exactly one, so it can never silently buy a 4x band.
    expect(paidCalls[0].zoom, 'the core lost its coverage fallback ladder').toBeUndefined();
    expect(paidCalls[1].zoom, 'the context did not pin its zoom').toBe(plan.layers[1].zoom);
    // And the whole acquisition is inside the ceiling that holds at every latitude.
    expect(plan.totalTiles).toBeLessThanOrEqual(WORKZONE_TILE_CEILING);
    expect(acq.body.tilesPaid).toBeGreaterThan(0);
    expect(acq.body.tileCeiling).toBe(WORKZONE_TILE_CEILING);
    expect(acq.body.acquiredRoles).toEqual(['core', 'context']);

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
      `four Native ↔ Nearmap round trips cost ${paidCalls.length} paid requests instead of `
      + 'the ones already made').toBe(plan.layers.length);
  });

  it('🚨 serves back EVERY layer, and the ring encloses the design core', async () => {
    paidAnswer = goodAerial;
    await call('POST', WITH_ADDRESS);
    const r = await call('GET', WITH_ADDRESS);

    expect(r.body.layers, 'the workzone came back without its layers').toBeTruthy();
    expect(r.body.layers.map((l: { role: string }) => l.role)).toEqual(['core', 'context']);

    const core = r.body.layers[0], ctx = r.body.layers[1];
    // Each layer carries its OWN rectangle and its OWN computed resolution. A shared one would put
    // the coarse pixels over the fine ones, or claim design resolution for the neighbourhood.
    expect(core.bounds.west).toBeGreaterThan(ctx.bounds.west);
    expect(core.bounds.east).toBeLessThan(ctx.bounds.east);
    expect(core.bounds.south).toBeGreaterThan(ctx.bounds.south);
    expect(core.bounds.north).toBeLessThan(ctx.bounds.north);
    expect(core.resolutionCmPerPx).toBeLessThan(ctx.resolutionCmPerPx);
    expect(core.zoom).toBeGreaterThan(ctx.zoom);
    // The top-level single image is the CORE — the design surface, not whichever was stored first.
    expect(r.body.zoom).toBe(core.zoom);
    expect(r.body.bounds).toEqual(core.bounds);
    // Nothing left to buy, so nothing is offered.
    expect(r.body.expandableRoles).toEqual([]);
  });

  it('🚨 a workzone bought BEFORE layers existed is honoured, never re-bought', async () => {
    // The legacy shape: one image, four top-level fields, no `layers`. It is paid for. Reading it
    // as "no imagery" would buy the whole workzone again on the next toggle, which is the one
    // outcome the cost invariant forbids.
    const legacy = Buffer.from(JSON.stringify({
      imageSource: 'nearmap', imageBase64: TINY,
      imageWidth: 1440, imageHeight: 810, zoom: 21,
      lat: SITE.lat, lng: SITE.lng, acquiredAt: '2026-01-02T03:04:05.000Z',
    }), 'utf8');
    await db.query(
      `INSERT INTO project_files
         (project_id, user_id, file_name, file_type, file_size, mime_type, file_data)
       VALUES ($1,$2,'aerial_workzone.json','aerial_workzone',$3,'application/json',$4)`,
      [WITH_ADDRESS, USER_ID, legacy.length, legacy]);

    paidAnswer = goodAerial;
    const r = await call('GET', WITH_ADDRESS);
    expect(r.body.available, 'a paid-for legacy workzone read as absent').toBe(true);
    expect(r.body.layers.map((l: { role: string }) => l.role)).toEqual(['core']);
    expect(r.body.imageDataUrl).toBe(TINY);
    expect(paidCalls.length, 'reading a legacy workzone bought imagery').toBe(0);

    // 🚨 AND A PLAIN POST DOES NOT TOP IT UP. Ray: "Never silently extend the paid workzone."
    const plain = await call('POST', WITH_ADDRESS);
    expect(plain.body.acquired).toBe(false);
    expect(plain.body.acquisition).toBe('reused');
    expect(paidCalls.length, 'a mode switch silently widened the paid area').toBe(0);
    // It SAYS what more is available, and what that would cost, without buying it.
    expect(plain.body.expandableRoles).toEqual(['context']);
    expect(plain.body.expandCost).toContain('paid tile GETs');
  });

  it('🚨 the explicit expansion buys the ring ONLY, and keeps the core it already owns', async () => {
    const legacy = Buffer.from(JSON.stringify({
      imageSource: 'nearmap', imageBase64: TINY,
      imageWidth: 1440, imageHeight: 810, zoom: 21,
      lat: SITE.lat, lng: SITE.lng, acquiredAt: '2026-01-02T03:04:05.000Z',
    }), 'utf8');
    await db.query(
      `INSERT INTO project_files
         (project_id, user_id, file_name, file_type, file_size, mime_type, file_data)
       VALUES ($1,$2,'aerial_workzone.json','aerial_workzone',$3,'application/json',$4)`,
      [WITH_ADDRESS, USER_ID, legacy.length, legacy]);

    paidAnswer = goodAerial;
    const mod = await import('@/app/api/projects/[id]/aerial-reference/route');
    const res = await mod.POST(
      new Request(`http://t/api/projects/${WITH_ADDRESS}/aerial-reference`, {
        method: 'POST', body: JSON.stringify({ expand: true }),
        headers: { 'content-type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ id: WITH_ADDRESS }) });
    const body = await res.json();

    expect(body.acquired).toBe(true);
    expect(body.acquisition).toBe('expanded');
    expect(body.acquiredRoles, 'an expansion re-bought the core it already owned').toEqual(['context']);
    expect(paidCalls.length, 'an expansion cost more than the one missing layer').toBe(1);

    // The core that was already paid for is still there, with its own original 1440x810 frame.
    const after = await call('GET', WITH_ADDRESS);
    expect(after.body.layers.map((l: { role: string }) => l.role)).toEqual(['core', 'context']);
    expect(after.body.layers[0].widthPx, 'the expansion overwrote the paid-for core').toBe(1440);
    expect(after.body.layers[0].heightPx).toBe(810);
    expect(after.body.expandableRoles).toEqual([]);
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

    // 🚨 AND IT STOPPED AT THE FIRST REFUSAL. The core is what a design surface needs; if that is
    // refused there is nothing to surround, so the context ring is never requested. One grid's
    // worth of refused requests, not two.
    expect(paidCalls.length, 'a refused core still went on to request the context ring').toBe(1);

    // And the next attempt is allowed to try again — a refusal is not a permanent verdict. The
    // storm protection lives in `fetchNearmapStaticAerial`'s own 15-minute refusal memory.
    paidAnswer = goodAerial;
    const ok = await call('POST', WITH_ADDRESS);
    expect(ok.body.acquired).toBe(true);
    expect(paidCalls.length).toBe(1 + planWorkzone(SITE.lat, SITE.lng)!.layers.length);
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
