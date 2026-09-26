/**
 * tests/distributorPriceOverridesAreWritable.test.ts
 *
 * `distributor_prices` COULD ONLY EVER HOLD MIGRATION 015's 22 SEED ROWS.
 *
 * It is the top-priority price authority for every BOM dollar figure, the $/W
 * KPI and the BOM Cost tile — and the admin page is the only UI for it. Two
 * independent defects meant nothing could be written through that UI:
 *
 *   1. WIRE FORMAT. The page sent camelCase (`partNumber`/`unitCost`); the route
 *      requires snake_case, so every Add/Edit failed with "part_number is
 *      required". DELETE was the mirror image: the page sent `?id=<uuid>` and the
 *      route read a JSON body, so `await req.json()` threw on the bodyless
 *      request and every delete returned 400 "Invalid JSON body".
 *
 *   2. AND EVEN WITH THE FORMAT FIXED, THE WRITE ITSELF 500'd. The upsert used
 *      `ON CONFLICT (COALESCE(user_id::text, '000…'), UPPER(part_number))`.
 *      Migration 015 — the ONLY migration that touches this table — creates three
 *      plain `CREATE INDEX` partial indexes and NO unique index or constraint.
 *      Postgres rejects that statement with 42P10, and because it THROWS rather
 *      than returning no row, the `row ?? (plain INSERT)` fallback sitting
 *      underneath it (and the comment advertising it) was unreachable.
 *
 * So an installer with a real CED contract price for a Powerwall 3 or an IQ8+
 * could never enter it, and every BOM total, every $/W figure and every exported
 * BOM CSV was priced off the Q1-2025 static catalog.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL. It builds the table from migration 015 as
 * shipped, in PostgreSQL (PGlite, in-process), and runs the shipped handlers
 * against it. A mocked database cannot tell you that an arbiter index is
 * missing — that is the entire defect, and it is invisible to a regex.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NextResponse, type NextRequest } from 'next/server';

const ROOT = join(__dirname, '..');
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
/** Migration 015 as shipped — the table, its indexes, its trigger and its seeds. */
const MIGRATION_015 = readFileSync(join(ROOT, 'lib', 'migrations', '015_distributor_prices.sql'), 'utf8');

let db: PGlite;

/**
 * A `sql` tagged template over PGlite with the same call signature the routes
 * use (`await sql`…`` → rows array). Values become $1…$n, so the casts the
 * route writes (`::uuid`, `::date`) are exercised exactly as shipped.
 *
 * ⚠ FIXTURE DETAIL, NOT A PRODUCT BEHAVIOUR: string and NULL parameters are
 * bound with an explicit TEXT oid. PGlite's extended protocol leaves parameter
 * types unspecified, and this repo's shipped filter idiom —
 * `(${x} IS NULL OR col = ${x})`, used in this route and in a dozen other admin
 * routes — is indeterminate that way (42P08 "could not determine data type of
 * parameter $2"). The Neon HTTP driver these routes actually run on hands
 * parameters over as text. Binding text here reproduces the production driver
 * rather than papering over anything: numbers and buffers are still left
 * unspecified so the column type drives inference exactly as it does live.
 */
const TEXT_OID = 25;
function pgliteSql() {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) text += `$${i + 1}`;
    });
    const paramTypes = values.map(v => (v === null || typeof v === 'string' ? TEXT_OID : 0));
    const res = await db.query(text, values as never[], { paramTypes });
    return (res.rows ?? []) as Record<string, unknown>[];
  };
}

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: vi.fn(async () => ({ id: ADMIN_ID, email: 'admin@test', role: 'admin' })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/adminActivityLog', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => pgliteSql()),
  // The real predicate, not a permissive stub — the route's id validation is
  // part of the contract under test.
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  // 🚨 SURFACE THE DATABASE ERROR. The shipped handler collapses everything to
  // a 503; if this mock did the same, a 42P10 would be indistinguishable from a
  // cold start and the defect this file exists to catch would read as flaky.
  handleRouteDbError: (tag: string, err: unknown) =>
    NextResponse.json(
      { success: false, error: `${tag} ${(err as Error)?.message ?? String(err)}` },
      { status: 500 },
    ),
}));

// Imported AFTER the mocks so the route binds to them.
const { GET, POST, DELETE } = await import('@/app/api/admin/distributor-prices/route');

function req(url: string, init?: { method?: string; body?: unknown }): NextRequest {
  return {
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    method: init?.method ?? 'GET',
    json: async () => {
      if (init?.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return init.body;
    },
  } as unknown as NextRequest;
}

const ENDPOINT = 'http://localhost/api/admin/distributor-prices';

beforeAll(async () => {
  db = new PGlite();
  // `distributor_prices.user_id` references users(id); nothing here reads more
  // than the id, so the rest of the users table is not needed.
  await db.exec('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  await db.query('INSERT INTO users (id) VALUES ($1)', [COMPANY_ID]);
  // MIGRATION 015 AS SHIPPED — including its 21 seed rows. A hand-built stand-in
  // would not reproduce the missing arbiter, which is the whole point.
  await db.exec(MIGRATION_015);
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  // Full reset, re-seeded from the migration — tests here edit platform rows in
  // place, so leaving the seeds alone would make the suite order-dependent.
  await db.query('DELETE FROM distributor_prices');
  await db.exec(MIGRATION_015);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('🚨 the table this route upserts into has no unique index', () => {
  it('migration 015 created the table with ZERO unique indexes or constraints', async () => {
    const idx = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'distributor_prices'`,
    );
    const defs = idx.rows.map(r => r.indexdef);
    // Only the PK. No unique index on (user_id, part_number) in any form, so
    // `ON CONFLICT (COALESCE(user_id::text, …), UPPER(part_number))` can never
    // find an arbiter. The fix must not depend on one.
    const uniques = defs.filter(d => /CREATE UNIQUE INDEX/i.test(d));
    expect(uniques).toHaveLength(1);
    expect(uniques[0]).toMatch(/distributor_prices_pkey/);
    // ...and the one unique index is on `id` alone, so it cannot serve as the
    // arbiter for a (user scope, part number) upsert.
    expect(uniques[0]).toMatch(/\(id\)/);
    expect(uniques[0]).not.toMatch(/part_number/i);

    const constraints = await db.query<{ contype: string }>(
      `SELECT contype FROM pg_constraint WHERE conrelid = 'distributor_prices'::regclass
         AND contype IN ('u', 'x')`,
    );
    expect(constraints.rows).toHaveLength(0);
  });

  it('the platform seed rows are present (21 of them, not 22)', async () => {
    const r = await db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM distributor_prices WHERE user_id IS NULL',
    );
    // 4 panels + 5 string inverters + 4 hybrids + 2 micros + 3 optimizers
    // + 3 batteries = 21. The Phase-4 finding said 22; counted from the file it
    // is 21. Pinned here so the number stops being repeated wrongly.
    expect(Number(r.rows[0].n)).toBe(21);
  });
});

describe('🚨 POST accepts the snake_case wire format and actually writes', () => {
  it('saves a brand-new company override for a SEEDED SKU without a unique index', async () => {
    const res = await POST(req(ENDPOINT, {
      method: 'POST',
      // Exactly the keys app/admin/distributor-prices/page.tsx now sends,
      // plus the company scope.
      body: { part_number: 'PW3-US', category: 'battery', unit_cost: 7100, source: 'CED', user_id: COMPANY_ID },
    }));
    const json = await res.json();

    // Before the repair this was 500 "there is no unique or exclusion
    // constraint matching the ON CONFLICT specification".
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.override.unitCost).toBeCloseTo(7100, 2);

    const rows = await db.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM distributor_prices WHERE user_id = $1 AND part_number = 'PW3-US'`,
      [COMPANY_ID],
    );
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].unit_cost)).toBeCloseTo(7100, 2);
  });

  it('a second save of the same key UPDATES — it does not duplicate the row', async () => {
    const body = { part_number: 'PW3-US', category: 'battery', source: 'CED', user_id: COMPANY_ID };
    expect((await POST(req(ENDPOINT, { method: 'POST', body: { ...body, unit_cost: 7100 } }))).status).toBe(200);
    expect((await POST(req(ENDPOINT, { method: 'POST', body: { ...body, unit_cost: 6950 } }))).status).toBe(200);

    const rows = await db.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM distributor_prices WHERE user_id = $1 AND part_number = 'PW3-US'`,
      [COMPANY_ID],
    );
    // One row, at the newest price. Two rows would leave the reader's ORDER BY
    // deciding which contract price a project is billed at.
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].unit_cost)).toBeCloseTo(6950, 2);
  });

  it('the company row does NOT collide with the platform seed for the same SKU', async () => {
    await POST(req(ENDPOINT, {
      method: 'POST',
      body: { part_number: 'PW3-US', category: 'battery', unit_cost: 7100, user_id: COMPANY_ID },
    }));
    const rows = await db.query<{ user_id: string | null; unit_cost: string }>(
      `SELECT user_id, unit_cost FROM distributor_prices WHERE part_number = 'PW3-US' ORDER BY user_id NULLS LAST`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(Number(rows.rows[0].unit_cost)).toBeCloseTo(7100, 2); // company
    expect(rows.rows[1].user_id).toBeNull();
    expect(Number(rows.rows[1].unit_cost)).toBeCloseTo(8280, 2); // untouched seed
  });

  it('a platform-scope save keys on user_id IS NULL and edits the seed in place', async () => {
    const res = await POST(req(ENDPOINT, {
      method: 'POST',
      body: { part_number: 'IQ8PLUS-72-2-US', category: 'microinverter', unit_cost: 149.5 },
    }));
    expect(res.status).toBe(200);
    const rows = await db.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM distributor_prices WHERE user_id IS NULL AND part_number = 'IQ8PLUS-72-2-US'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].unit_cost)).toBeCloseTo(149.5, 2);
  });

  it('part-number matching is case-insensitive, as the reader is', async () => {
    await POST(req(ENDPOINT, { method: 'POST', body: { part_number: 'pw3-us', category: 'battery', unit_cost: 7000, user_id: COMPANY_ID } }));
    await POST(req(ENDPOINT, { method: 'POST', body: { part_number: 'PW3-US', category: 'battery', unit_cost: 7200, user_id: COMPANY_ID } }));
    const rows = await db.query(
      `SELECT id FROM distributor_prices WHERE user_id = $1 AND UPPER(part_number) = 'PW3-US'`,
      [COMPANY_ID],
    );
    // The BOM reader uppercases part numbers, so two casings of one SKU would be
    // two competing overrides for the same thing.
    expect(rows.rows).toHaveLength(1);
  });

  it('camelCase is REJECTED — there is one wire format, not two', async () => {
    const res = await POST(req(ENDPOINT, {
      method: 'POST',
      body: { partNumber: 'PW3-US', category: 'battery', unitCost: 7100 },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/part_number is required/);
  });
});

describe('🚨 DELETE reads the id from the query string', () => {
  async function seedCompanyRow(): Promise<string> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO distributor_prices (user_id, part_number, category, unit_cost, source)
       VALUES ($1, 'PW3-US', 'battery', 7100, 'CED') RETURNING id`,
      [COMPANY_ID],
    );
    return r.rows[0].id;
  }

  it('soft-deletes on ?id=<uuid> with NO request body', async () => {
    const id = await seedCompanyRow();
    // The page's trash button sends exactly this: no body at all.
    const res = await DELETE(req(`${ENDPOINT}?id=${id}`, { method: 'DELETE' }));
    const json = await res.json();

    // Before the repair: 400 "Invalid JSON body", every single time.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deactivated).toBe(true);

    const rows = await db.query<{ active: boolean }>('SELECT active FROM distributor_prices WHERE id = $1', [id]);
    expect(rows.rows[0].active).toBe(false);
  });

  it('hard-deletes on ?id=<uuid>&hard=true', async () => {
    const id = await seedCompanyRow();
    const res = await DELETE(req(`${ENDPOINT}?id=${id}&hard=true`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect((await res.json()).hard).toBe(true);
    const rows = await db.query('SELECT id FROM distributor_prices WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(0);
  });

  it('a JSON body still works, for any caller that already sends one', async () => {
    const id = await seedCompanyRow();
    const res = await DELETE(req(ENDPOINT, { method: 'DELETE', body: { id } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('still refuses a missing id and a non-uuid id', async () => {
    expect((await DELETE(req(ENDPOINT, { method: 'DELETE' }))).status).toBe(400);
    const bad = await DELETE(req(`${ENDPOINT}?id=not-a-uuid`, { method: 'DELETE' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Invalid id format/);
  });
});

describe('🚨 GET gives the admin page a shape it can render', () => {
  it('sends category fallbacks under `categoryFallbacks`, as a Record', async () => {
    const json = await (await GET(req(ENDPOINT))).json();
    expect(json.error).toBeUndefined();
    expect(json.success).toBe(true);
    // The page normalises this Record into its own array; it must stay a Record
    // under this exact key or that normalisation silently yields [].
    expect(Array.isArray(json.categoryFallbacks)).toBe(false);
    expect(typeof json.categoryFallbacks).toBe('object');
    expect(Object.keys(json.categoryFallbacks).length).toBeGreaterThan(10);
    expect(json.categoryFallbacks.battery.unitCost).toBeGreaterThan(0);
  });

  it('every catalog row carries a RESOLVED unitCost, so no cell renders NaN', async () => {
    const json = await (await GET(req(ENDPOINT))).json();
    expect(json.catalog.length).toBeGreaterThan(0);
    for (const e of json.catalog) {
      expect(Number.isFinite(e.unitCost), `${e.partNumber} has no resolved unitCost`).toBe(true);
      expect(e.unitCost).toBeGreaterThan(0);
    }
    // The avg-cost stat is a plain mean over this field; it was NaN because
    // `unitCost` was never emitted at all.
    const avg = json.catalog.reduce((s: number, e: { unitCost: number }) => s + e.unitCost, 0) / json.catalog.length;
    expect(Number.isFinite(avg)).toBe(true);

    // Panels are stored as $/W; the resolved figure must be per-PANEL dollars,
    // not the raw $/W number.
    const panel = json.catalog.find((e: { partNumber: string }) => e.partNumber === 'Q.PEAK DUO BLK ML-G10+400');
    expect(panel.unitCost).toBeGreaterThan(50);
  });

  it('a company override written through POST comes back in `overrides`', async () => {
    await POST(req(ENDPOINT, {
      method: 'POST',
      body: { part_number: 'PW3-US', category: 'battery', unit_cost: 7100, user_id: COMPANY_ID },
    }));
    const json = await (await GET(req(`${ENDPOINT}?user_id=${COMPANY_ID}`))).json();
    const mine = json.overrides.filter((o: { userId: string | null }) => o.userId === COMPANY_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0].unitCost).toBeCloseTo(7100, 2);
  });
});
