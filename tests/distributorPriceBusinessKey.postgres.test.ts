/**
 * tests/distributorPriceBusinessKey.postgres.test.ts
 *
 * WHAT IS THE REAL BUSINESS KEY OF `distributor_prices`, AND WOULD THE OBVIOUS
 * UNIQUE INDEX DESTROY VALID DATA?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `tests/distributorPriceOverridesAreWritable.test.ts` established that the
 * table has NO unique index at all, so the shipped `ON CONFLICT` raised 42P10
 * and every admin save 500'd. That was repaired without an index
 * (UPDATE-then-INSERT), which leaves "add a unique index" as optional
 * hardening — and hardening against the WRONG key silently deletes real prices.
 *
 * So this file does not assume a key. It measures one, from the two things that
 * are allowed to define it:
 *
 *   1. THE COLUMNS THE TABLE ACTUALLY HAS (migration 015, read from
 *      information_schema — not from the file's comments).
 *   2. THE COLUMNS THE READER ACTUALLY KEYS ON (`buildOverrideMaps` in
 *      lib/bom/distributorPricing.ts, called through the real export).
 *
 * 🚨 THE READER IS THE AUTHORITY, AND IT KEYS ON TWO DIFFERENT SHAPES.
 * `buildOverrideMaps` keys a normal row on `UPPER(part_number)` and a wildcard
 * row (`part_number = '*'`) on `category`. Any unique index that does not make
 * that same split is wrong, and §3 below measures exactly what it costs.
 *
 * 🚨 AND A COLUMN THE READER IGNORES MUST NOT ENTER THE KEY. `source` (the
 * distributor) and `price_date` (the price-sheet date) are real columns, and the
 * reader reads NEITHER. So widening the key to admit two ACTIVE rows that differ
 * only by supplier or date does not preserve information — it makes the resolved
 * price depend on row order, which is the `buildOverrideMaps` "first row wins"
 * hazard its own docblock warns about. Supplier and date survive as HISTORY
 * (`active = FALSE`), which is why every index below is partial on `active`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Would this index reject that row?" and "does a UNIQUE index constrain NULL
 * user_id at all?" are PostgreSQL questions. The second one is the trap: a plain
 * unique index treats NULLs as distinct, so an index on `(user_id, …)` does not
 * constrain the platform-default rows — the ones migration 015 seeds — and
 * appears to work while enforcing nothing where it matters. A regex cannot see
 * that. PGlite is PostgreSQL 16 in-process, no daemon and no credentials.
 *
 * NOTHING HERE MIGRATES ANYTHING. Every database is in-memory and disposable,
 * no migration file is written, and no index is added to the product.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NextResponse, type NextRequest } from 'next/server';

const ROOT = join(__dirname, '..');
const ADMIN_ID   = '11111111-1111-4111-8111-111111111111';
const COMPANY_A  = '22222222-2222-4222-8222-222222222222';
const COMPANY_B  = '33333333-3333-4333-8333-333333333333';

/** Migration 015 as shipped — the table, its indexes, its trigger and its seeds. */
const MIGRATION_015 = readFileSync(
  join(ROOT, 'lib', 'migrations', '015_distributor_prices.sql'), 'utf8');

let db: PGlite;

/** Same Neon-shaped shim and TEXT-oid binding as
 *  tests/distributorPriceOverridesAreWritable.test.ts — see its docblock. */
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
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: (tag: string, err: unknown) =>
    NextResponse.json(
      { success: false, error: `${tag} ${(err as Error)?.message ?? String(err)}` },
      { status: 500 },
    ),
}));

const { POST } = await import('@/app/api/admin/distributor-prices/route');
const { applyDistributorPricing } = await import('@/lib/bom/distributorPricing');

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

// ── The two candidate keys, as DDL ──────────────────────────────────────────
//
// Stated here as constants so they are reviewed once, and applied to a THROWAWAY
// database in §3/§4 rather than to the fixture the rest of the file measures.

/** The obvious key, and the one Ray warned about: owner + part number, whole table. */
const NAIVE_INDEX =
  `CREATE UNIQUE INDEX uq_dp_naive
     ON distributor_prices (user_id, UPPER(part_number))`;

/** The key the READER implies: scope + part for normal rows, scope + category for
 *  wildcards, among ACTIVE rows only, with NULL owner folded to a sentinel so the
 *  platform-default rows are constrained too. */
const CORRECT_INDEXES = [
  `CREATE UNIQUE INDEX uq_dp_part
     ON distributor_prices (
       COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
       UPPER(part_number)
     )
     WHERE active AND part_number <> '*'`,
  `CREATE UNIQUE INDEX uq_dp_category
     ON distributor_prices (
       COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
       category
     )
     WHERE active AND part_number = '*'`,
];

/** A fresh database carrying migration 015 and nothing else. */
async function freshDb(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT)`);
  await pg.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1,'A','a@e.st','x'), ($2,'B','b@e.st','x')
     ON CONFLICT (id) DO NOTHING`, [COMPANY_A, COMPANY_B]);
  await pg.exec(MIGRATION_015);
  return pg;
}

beforeAll(async () => { db = await freshDb(); }, 180_000);
afterAll(async () => { await db?.close(); });

/** Back to migration 015's seeds only. */
beforeEach(async () => {
  await db.query(`DELETE FROM distributor_prices WHERE user_id IS NOT NULL`);
  await db.query(`DELETE FROM distributor_prices WHERE part_number = '*'`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. WHAT THE TABLE MODELS — ASKED OF THE DATABASE
// ═══════════════════════════════════════════════════════════════════════════
//
// Ray's question, literally: does this table model a supplier? a region? a tier
// or quantity break? an effective date? a per-company owner? Each answer below
// comes from information_schema, so a renamed or dropped column fails here
// rather than quietly changing the conclusion.

describe('what distributor_prices actually models', () => {
  async function columns(): Promise<Set<string>> {
    const r = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'distributor_prices'`);
    return new Set(r.rows.map(x => x.column_name));
  }

  it('it models a per-company OWNER, and the owner is NULLABLE (NULL = platform default)', async () => {
    expect((await columns()).has('user_id')).toBe(true);
    const r = await db.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'distributor_prices' AND column_name = 'user_id'`);
    expect(r.rows[0]?.is_nullable).toBe('YES');
    // And migration 015's own seeds ARE the platform defaults.
    const seeds = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices WHERE user_id IS NULL`);
    expect(seeds.rows[0].n).toBeGreaterThan(0);
  });

  it('it models a SUPPLIER (`source`) and an EFFECTIVE DATE (`price_date`)', async () => {
    const cols = await columns();
    expect(cols.has('source')).toBe(true);
    expect(cols.has('price_date')).toBe(true);
  });

  it('it models SOFT DELETE (`active`), so superseded prices are retained as history', async () => {
    expect((await columns()).has('active')).toBe(true);
  });

  it('🚨 but it models NO TIER, QUANTITY BREAK or REGION at all', async () => {
    const cols = await columns();
    for (const absent of [
      'tier', 'price_tier', 'quantity_break', 'min_quantity', 'min_qty', 'qty_break',
      'region', 'location', 'branch', 'warehouse', 'territory', 'zone',
      'effective_from', 'effective_to', 'valid_from', 'valid_to',
    ]) {
      expect(cols.has(absent),
        `distributor_prices.${absent} now EXISTS — the table models more than it did and ` +
        'the business key must be re-derived before any unique index is added').toBe(false);
    }
  });

  it('and migration 015 ships NO unique index or constraint — the starting point', async () => {
    const idx = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'distributor_prices' AND indexdef ILIKE '%UNIQUE%'`);
    // The PRIMARY KEY on id is a constraint-backed index, not a business key.
    const business = idx.rows.filter(r => !/\(id\)/.test(r.indexdef));
    expect(business, 'a unique business index now exists — re-read this file').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. WHAT THE READER KEYS ON — THE ACTUAL AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════
//
// No database needed: this is the shipped resolver, called directly. It decides
// what "the same price" means, and therefore what uniqueness may collapse.

describe('the reader’s key, measured through applyDistributorPricing', () => {
  const panel = {
    id: 'p', stageId: 'array', stageLabel: '', category: 'solar_panel',
    manufacturer: 'Q', model: 'Q.PEAK 400W', partNumber: 'PW3-US',
    description: '', quantity: 1, unit: 'ea', derivedFrom: '', required: true,
  } as never;
  const battery = { ...(panel as object), id: 'b', category: 'battery', partNumber: 'NOT-IN-CATALOG-1' } as never;

  it('🚨 TWO ACTIVE ROWS FOR ONE PART NUMBER ARE THE PRECEDENCE MECHANISM — per-company wins over platform', () => {
    // Highest-priority first, exactly as the route that feeds it orders them.
    const res = applyDistributorPricing([panel], [
      { partNumber: 'PW3-US', category: 'battery', unitCost: 7000 }, // company row
      { partNumber: 'PW3-US', category: 'battery', unitCost: 8280 }, // platform row
    ]);
    expect(res.items[0].unitCost).toBe(7000);
    // So `user_id` MUST be part of the key: a key without it would delete one of
    // these two rows and destroy the override.
  });

  it('a WILDCARD row is keyed on CATEGORY, not on part number', () => {
    const res = applyDistributorPricing([battery], [
      { partNumber: '*', category: 'battery', unitCost: 111 },
    ]);
    expect(res.items[0].unitCost).toBe(111);
    expect(res.overrideMatches).toBe(1);
  });

  it('🚨 so two wildcard rows for DIFFERENT categories are two DIFFERENT keys, both live at once', () => {
    const other = { ...(battery as object), id: 'o', category: 'optimizer' } as never;
    const res = applyDistributorPricing([battery, other], [
      { partNumber: '*', category: 'battery',   unitCost: 111 },
      { partNumber: '*', category: 'optimizer', unitCost: 222 },
    ]);
    expect(res.items.map(i => i.unitCost)).toEqual([111, 222]);
  });

  it('and the reader reads NEITHER `source` NOR `price_date` — so neither may enter the key', () => {
    // Two rows differing only by supplier/date are indistinguishable to the
    // resolver: it takes the FIRST. Admitting both as active would make the
    // price depend on row order.
    const res = applyDistributorPricing([battery], [
      { partNumber: 'NOT-IN-CATALOG-1', category: 'battery', unitCost: 900 },
      { partNumber: 'NOT-IN-CATALOG-1', category: 'battery', unitCost: 100 },
    ]);
    expect(res.items[0].unitCost).toBe(900);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 🚨 THE NAIVE KEY, APPLIED — WHAT IT REJECTS AND WHAT IT FAILS TO CATCH
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a unique index on (user_id, UPPER(part_number)) over the whole table', () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await freshDb(); await pg.exec(NAIVE_INDEX); }, 180_000);
  afterAll(async () => { await pg?.close(); });

  it('REJECTS a company’s second category-wide override — real data, refused', async () => {
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, category, unit_cost)
       VALUES ($1, '*', 'battery', 111)`, [COMPANY_A]);
    // A perfectly legitimate second wildcard: same company, DIFFERENT category.
    // The reader keys these on category and holds both (§2). The index sees one
    // part_number, '*', twice.
    await expect(pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, category, unit_cost)
       VALUES ($1, '*', 'optimizer', 222)`, [COMPANY_A]),
    ).rejects.toThrow(/duplicate key value|unique constraint/i);
  });

  it('REJECTS a superseded price kept as history beside its replacement', async () => {
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost, source, price_date, active)
       VALUES ($1, 'PW3-US', 8280, 'CED', '2025-01-15', FALSE)`, [COMPANY_B]);
    // The soft-delete pattern's whole point: the old row stays, deactivated.
    await expect(pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost, source, price_date, active)
       VALUES ($1, 'PW3-US', 7900, 'Soligent', '2026-07-01', TRUE)`, [COMPANY_B]),
    ).rejects.toThrow(/duplicate key value|unique constraint/i);
  });

  it('🚨 AND IT CONSTRAINS NOTHING WHERE IT MATTERS — NULL user_id is DISTINCT, so platform rows duplicate freely', async () => {
    // Migration 015's own 21 seeds are all user_id NULL. A plain unique index
    // treats each NULL as distinct, so the index that appears to protect the
    // table does not protect the rows the table actually ships with.
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost)
       VALUES (NULL, 'PW3-US', 1)`);
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost)
       VALUES (NULL, 'PW3-US', 2)`);
    const n = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices
        WHERE user_id IS NULL AND part_number = 'PW3-US'`);
    // Three: migration 015's seed plus the two just inserted.
    expect(n.rows[0].n).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE KEY THE READER IMPLIES — ACCEPTS WHAT IS VALID, REJECTS WHAT IS NOT
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 POSITIVE CONTROL. Without this section every rejection in §3 is equally
// explained by "any unique index breaks this table".

describe('the scope-split key, applied to the same rows', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await freshDb();
    for (const ddl of CORRECT_INDEXES) await pg.exec(ddl);
  }, 180_000);
  afterAll(async () => { await pg?.close(); });

  it('the indexes apply to migration 015 as shipped — so the seeds carry no duplicate under this key', async () => {
    const idx = await pg.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'distributor_prices'
        AND indexname IN ('uq_dp_part','uq_dp_category')`);
    expect(idx.rows.map(r => r.indexname).sort()).toEqual(['uq_dp_category', 'uq_dp_part']);
  });

  it('ACCEPTS a company’s many category-wide overrides', async () => {
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, category, unit_cost)
       VALUES ($1,'*','battery',111), ($1,'*','optimizer',222), ($1,'*','racking',33)`,
      [COMPANY_A]);
    const n = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices WHERE user_id = $1 AND part_number = '*'`,
      [COMPANY_A]);
    expect(n.rows[0].n).toBe(3);
  });

  it('ACCEPTS a per-company row beside the platform default for the same SKU — the precedence mechanism survives', async () => {
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost)
       VALUES ($1,'PW3-US',7000)`, [COMPANY_A]);
    const n = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices
        WHERE part_number = 'PW3-US' AND active`);
    expect(n.rows[0].n).toBe(2); // the seed (platform) + COMPANY_A's override
  });

  it('ACCEPTS superseded history beside the live price (partial on `active`)', async () => {
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost, source, price_date, active)
       VALUES ($1,'IQ8M-72-2-US',172,'CED','2025-01-15',FALSE),
              ($1,'IQ8M-72-2-US',166,'Soligent','2026-07-01',FALSE)`, [COMPANY_B]);
    await pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost, source, price_date, active)
       VALUES ($1,'IQ8M-72-2-US',158,'CED','2026-09-01',TRUE)`, [COMPANY_B]);
    const n = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices
        WHERE user_id = $1 AND part_number = 'IQ8M-72-2-US'`, [COMPANY_B]);
    expect(n.rows[0].n).toBe(3);
  });

  it('🚨 REJECTS two ACTIVE prices for one SKU in one scope — the case the reader cannot resolve', async () => {
    await expect(pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost, source)
       VALUES ($1,'SG8K-D-US',1100,'CED'), ($1,'SG8K-D-US',1050,'Soligent')`, [COMPANY_A]),
    ).rejects.toThrow(/duplicate key value|unique constraint/i);
  });

  it('🚨 AND REJECTS a duplicate PLATFORM row — the NULL-owner case the naive index missed', async () => {
    await expect(pg.query(
      `INSERT INTO distributor_prices (user_id, part_number, unit_cost)
       VALUES (NULL, 'pw3-us', 1)`),   // lower case: UPPER() in the index catches it
    ).rejects.toThrow(/duplicate key value|unique constraint/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. 🚨 THE WRITE PATH'S KEY — THE DEFECT THIS FILE FOUND, AND ITS REPAIR
// ═══════════════════════════════════════════════════════════════════════════
//
// 🚨 THIS CONTRADICTED THE FRAMING OF THE QUESTION. "An index is optional
// hardening" is true of the DATABASE. It was NOT true of the WRITE PATH: the
// repaired POST keyed its UPDATE on (user scope, UPPER(part_number)) with NO
// category term. Every category-wide override carries the SAME part_number,
// `'*'`, so the second one MATCHED THE FIRST and rewrote its `category`.
//
// So a company could hold exactly ONE category-wide override, and adding a
// second silently repurposed the previous one — not deactivated, not superseded,
// just gone, with a 200 response and no index involved.
//
// The route now carries the category term. Restore route.ts to HEAD~ and the
// first case below goes red on `rows.rows.length` — 1 where 2 is required.

describe('the POST route keys a wildcard row on its CATEGORY', () => {
  it('🚨 two category-wide overrides for one company both survive', async () => {
    const first = await POST(req(ENDPOINT, { method: 'POST', body: {
      user_id: COMPANY_A, part_number: '*', category: 'battery',
      unit_cost: 111, label: 'all batteries',
    } }));
    expect(first.status).toBe(200);

    const second = await POST(req(ENDPOINT, { method: 'POST', body: {
      user_id: COMPANY_A, part_number: '*', category: 'optimizer',
      unit_cost: 222, label: 'all optimizers',
    } }));
    expect(second.status).toBe(200);

    const rows = await db.query<{ category: string; unit_cost: string }>(
      `SELECT category, unit_cost FROM distributor_prices
        WHERE user_id = $1 AND part_number = '*' ORDER BY category`, [COMPANY_A]);

    expect(rows.rows.length,
      'the second wildcard save overwrote the first instead of inserting — the ' +
      'category term is missing from the keyless UPDATE in the POST handler').toBe(2);
    expect(rows.rows.map(r => r.category)).toEqual(['battery', 'optimizer']);
    expect(rows.rows.map(r => Number(r.unit_cost))).toEqual([111, 222]);

    // And BOTH are now visible to the reader, which keys them on category.
    const mk = (category: string) => ({
      id: category, stageId: 'array', stageLabel: '', category,
      manufacturer: '', model: '', partNumber: `NOT-IN-CATALOG-${category}`,
      description: '', quantity: 1, unit: 'ea', derivedFrom: '', required: true,
    } as never);
    const res = applyDistributorPricing([mk('battery'), mk('optimizer')], rows.rows.map(r => ({
      partNumber: '*', category: r.category, unitCost: Number(r.unit_cost),
    })));
    expect(res.overrideMatches).toBe(2);
    expect(res.items.map(i => i.unitCost)).toEqual([111, 222]);
  });

  it('re-saving the SAME category still UPDATES in place — it does not add a duplicate', async () => {
    for (const cost of [111, 150]) {
      const r = await POST(req(ENDPOINT, { method: 'POST', body: {
        user_id: COMPANY_A, part_number: '*', category: 'battery', unit_cost: cost,
      } }));
      expect(r.status).toBe(200);
    }
    const rows = await db.query<{ n: number; unit_cost: string }>(
      `SELECT count(*)::int AS n, max(unit_cost) AS unit_cost FROM distributor_prices
        WHERE user_id = $1 AND part_number = '*' AND category = 'battery'`, [COMPANY_A]);
    expect(rows.rows[0].n).toBe(1);
    expect(Number(rows.rows[0].unit_cost)).toBe(150);
  });

  it('a normal SKU save keys on the part number, and keeps the platform row beside it', async () => {
    const res = await POST(req(ENDPOINT, { method: 'POST', body: {
      user_id: COMPANY_A, part_number: 'PW3-US', unit_cost: 7000, source: 'CED',
    } }));
    expect(res.status).toBe(200);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM distributor_prices
        WHERE part_number = 'PW3-US' AND active`);
    // The company row AND migration 015's platform seed — both retained.
    expect(rows.rows[0].n).toBe(2);
  });
});
