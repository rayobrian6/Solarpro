// ============================================================
// app/api/admin/distributor-prices/route.ts
// ────────────────────────────────────────────────────────────
// CRUD API for admin-managed distributor price overrides.
//
// GET    /api/admin/distributor-prices
//   ?user_id=<uuid>   — filter by company (omit for global/platform defaults)
//   ?category=<str>   — filter by category
//   ?part_number=<str>— filter by part number
//   ?active=true|false— filter by active status (default: true)
//
// POST   /api/admin/distributor-prices
//   Body (snake_case — see the note above the parser): { id?, user_id?,
//        part_number, category?, label?, unit_cost, source?, price_date?, notes? }
//   Creates or updates. With `id` it updates that row; without one it keys on
//   (user scope, UPPER(part_number)). UPDATE-then-INSERT, not ON CONFLICT —
//   this table has no unique index. See the block comment at the write.
//
// DELETE /api/admin/distributor-prices?id=<uuid>[&hard=true]
//   ?id=<uuid>             — soft-delete (sets active=false)
//   ?id=<uuid>&hard=true   — hard delete (removes row)
//   A JSON body { id, hard? } is accepted as a fallback, but the query string wins.
//
// PATCH  /api/admin/distributor-prices — reactivate a soft-deleted override
//   Body: { id }
//
// GET    /api/admin/distributor-prices/catalog
//   Returns the full static catalog from distributorPricing.ts (read-only).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  DISTRIBUTOR_PRICE_CATALOG,
  CATEGORY_FALLBACK_PRICES,
  resolveUnitCost,
  type DistributorPriceOverride,
} from '@/lib/bom/distributorPricing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId     = searchParams.get('user_id')     || null;
  const category   = searchParams.get('category')    || null;
  const partNumber = searchParams.get('part_number') || null;
  const activeOnly = searchParams.get('active') !== 'false'; // default true

  // Validate user_id query param if provided
  if (userId && !isValidUUID(userId)) {
    return NextResponse.json({ success: false, error: 'Invalid user_id format.' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // Build dynamic WHERE clauses
    // Neon sql`` handles parameterization; we build fragments conditionally.
    const rows = await sql`
      SELECT
        id, user_id, part_number, category, label,
        unit_cost, source, price_date, notes, active,
        created_at, updated_at
      FROM distributor_prices
      WHERE
        (${activeOnly} = FALSE OR active = TRUE)
        AND (${userId}     IS NULL OR user_id     = ${userId}::uuid)
        AND (${category}   IS NULL OR category    = ${category})
        AND (${partNumber} IS NULL OR UPPER(part_number) = UPPER(${partNumber ?? ''}))
      ORDER BY
        CASE WHEN user_id IS NULL THEN 0 ELSE 1 END,
        category NULLS LAST,
        part_number
    `;

    return NextResponse.json({
      success: true,
      overrides: rows.map(r => ({
        id:          r.id,
        userId:      r.user_id,
        partNumber:  r.part_number,
        category:    r.category,
        label:       r.label,
        unitCost:    Number(r.unit_cost),
        source:      r.source,
        priceDate:   r.price_date,
        notes:       r.notes,
        active:      r.active,
        createdAt:   r.created_at,
        updatedAt:   r.updated_at,
      })),
      count: rows.length,
      // Also include the static catalog for reference.
      // `unitCost` is the RESOLVED per-unit dollar figure the BOM engine would
      // actually use for this SKU (for solar panels, netPrice is $/W, so the
      // per-panel figure only exists once resolveUnitCost has multiplied it by
      // the module wattage). The admin catalog table and the "Avg Catalog Cost"
      // stat both read it; without it every catalog row rendered `$NaN`.
      catalog: DISTRIBUTOR_PRICE_CATALOG.map(e => ({
        partNumber: e.partNumber,
        description: e.description,
        category: e.category,
        unit: e.unit,
        listPrice: e.listPrice,
        netPrice: e.category === 'solar_panel'
          ? null // per-panel pricing handled in distributorPricing.ts
          : e.netPrice,
        unitCost: resolveUnitCost(e.partNumber, e.category),
        source: e.source,
        asOf: e.asOf,
      })),
      categoryFallbacks: CATEGORY_FALLBACK_PRICES,
    });

  } catch (err) {
    return handleRouteDbError('[admin/distributor-prices GET]', err);
  }
}

// ─── POST (upsert) ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  // ── Rate limiting ──
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  // 🚨 WIRE FORMAT IS snake_case — the column names, and what this file's header
  // comment has always documented. app/admin/distributor-prices/page.tsx used to
  // send camelCase (`partNumber`/`unitCost`), so every Add/Edit in the ONLY UI
  // for this table failed with "part_number is required" and `distributor_prices`
  // could never hold anything but migration 015's 21 seed rows. The page now
  // sends snake_case; this parser is deliberately NOT tolerant of camelCase, so
  // that a page regression fails loudly in the contract test instead of silently.
  let body: {
    id?: string;
    user_id?: string;
    part_number?: string;
    category?: string;
    label?: string;
    unit_cost?: number;
    source?: string;
    price_date?: string;
    notes?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  if (!body.part_number || body.part_number.trim() === '') {
    return NextResponse.json({ success: false, error: 'part_number is required' }, { status: 400 });
  }
  if (body.unit_cost === undefined || body.unit_cost === null || isNaN(Number(body.unit_cost))) {
    return NextResponse.json({ success: false, error: 'unit_cost is required and must be a number' }, { status: 400 });
  }
  if (Number(body.unit_cost) < 0) {
    return NextResponse.json({ success: false, error: 'unit_cost must be >= 0' }, { status: 400 });
  }
  if (body.part_number === '*' && !body.category) {
    return NextResponse.json({ success: false, error: 'category is required when part_number is "*"' }, { status: 400 });
  }

  // ── UUID validation on optional user_id ──
  if (body.user_id && !isValidUUID(body.user_id)) {
    return NextResponse.json({ success: false, error: 'Invalid user_id format.' }, { status: 400 });
  }

  // ── UUID validation on optional id (edit of an existing override) ──
  if (body.id && !isValidUUID(body.id)) {
    return NextResponse.json({ success: false, error: 'Invalid id format.' }, { status: 400 });
  }

  // ── Field length caps ──
  if (body.part_number.trim().length > 100) {
    return NextResponse.json({ success: false, error: 'part_number must be 100 characters or fewer.' }, { status: 400 });
  }
  if (body.category && body.category.length > 100) {
    return NextResponse.json({ success: false, error: 'category must be 100 characters or fewer.' }, { status: 400 });
  }
  if (body.label && body.label.length > 200) {
    return NextResponse.json({ success: false, error: 'label must be 200 characters or fewer.' }, { status: 400 });
  }
  if (body.source && body.source.length > 200) {
    return NextResponse.json({ success: false, error: 'source must be 200 characters or fewer.' }, { status: 400 });
  }
  if (body.notes && body.notes.length > 2000) {
    return NextResponse.json({ success: false, error: 'notes must be 2000 characters or fewer.' }, { status: 400 });
  }

  const partNumber = body.part_number.trim();
  const userId     = body.user_id     || null;
  const category   = body.category   || null;
  const label      = body.label      || null;
  const unitCost   = Number(body.unit_cost);
  const source     = body.source     || 'Custom';
  const priceDate  = body.price_date || null;
  const notes      = body.notes      || null;

  try {
    const sql = await getDbReady();

    // ══════════════════════════════════════════════════════════════════════════
    // 🚨 UPDATE-THEN-INSERT, **NOT** `ON CONFLICT`.
    //
    // This used to be `ON CONFLICT (COALESCE(user_id::text, '000…'),
    // UPPER(part_number)) DO UPDATE` — against an arbiter that does not exist.
    // Migration 015 (the ONLY migration that touches this table) creates three
    // plain `CREATE INDEX` partial indexes and no unique index or constraint at
    // all, so Postgres rejected the statement with 42P10 ("there is no unique or
    // exclusion constraint matching the ON CONFLICT specification"). That is a
    // THROWN error, not a null row, so the `row ?? (plain INSERT)` fallback that
    // sat underneath it (and the comment advertising it) was unreachable dead
    // code and every save 500'd.
    //
    // Requiring the index would require a migration. Two statements need none:
    // UPDATE every row matching the logical key (same user scope + same part
    // number, case-insensitively) and INSERT only when nothing matched.
    //
    // Updating ALL matching rows is deliberate: the absence of a unique index
    // means duplicates may already exist, and leaving them at different prices
    // would make the reader's precedence order the thing that decides the
    // number. After this, every duplicate of a key carries the same cost.
    //
    // Not atomic (the Neon HTTP driver has no interactive transaction), so two
    // simultaneous first-time saves of the same SKU can both insert. The worst
    // case is a duplicate row at the value both writers asked for, and the next
    // save collapses them. A lost or incorrect price is not reachable this way.
    // ══════════════════════════════════════════════════════════════════════════

    const updated = body.id
      // Explicit edit of a known row — key on the id so renaming the part number
      // MOVES the override instead of orphaning the old row beside a new one.
      ? await sql`
          UPDATE distributor_prices
          SET part_number = ${partNumber},
              user_id     = ${userId}::uuid,
              category    = ${category},
              label       = ${label},
              unit_cost   = ${unitCost},
              source      = ${source},
              price_date  = ${priceDate}::date,
              notes       = ${notes},
              active      = TRUE,
              updated_at  = now()
          WHERE id = ${body.id}::uuid
          RETURNING *
        `
      : await sql`
          UPDATE distributor_prices
          SET category   = ${category},
              label      = ${label},
              unit_cost  = ${unitCost},
              source     = ${source},
              price_date = ${priceDate}::date,
              notes      = ${notes},
              active     = TRUE,
              updated_at = now()
          WHERE UPPER(part_number) = UPPER(${partNumber})
            AND (
              (${userId}::uuid IS NULL AND user_id IS NULL)
              OR user_id = ${userId}::uuid
            )
            -- 🚨 A WILDCARD ROW IS KEYED ON ITS CATEGORY, NOT ON '*'.
            --
            -- buildOverrideMaps in lib/bom/distributorPricing.ts keys a normal row
            -- on UPPER(part_number) and a '*' row on category — two different maps,
            -- so ('*', battery) and ('*', optimizer) are two DIFFERENT keys that
            -- must both be able to exist.
            --
            -- Without this term the logical key of the UPDATE was part_number
            -- alone, and since EVERY category-wide override carries the same
            -- part_number, saving a second one MATCHED THE FIRST and rewrote its
            -- category. So a company could hold exactly ONE category-wide
            -- override, and adding a second silently repurposed the previous one —
            -- not deactivated, not superseded, just gone, with a 200 response.
            -- tests/distributorPriceBusinessKey.postgres.test.ts section 5 measures
            -- it, and goes red on this one clause.
            --
            -- NOTE: no backtick may appear in this comment. It sits inside a tagged
            -- template literal, so a backtick here terminates the SQL string and the
            -- file stops parsing.
            AND (part_number <> '*' OR category IS NOT DISTINCT FROM ${category})
          RETURNING *
        `;

    const result = updated[0] ?? (await sql`
      INSERT INTO distributor_prices
        (user_id, part_number, category, label, unit_cost, source, price_date, notes, active)
      VALUES
        (${userId}::uuid, ${partNumber}, ${category}, ${label}, ${unitCost}, ${source}, ${priceDate}::date, ${notes}, TRUE)
      RETURNING *
    `)[0];

    await logAdminAction({ adminId: admin.id, action: 'distributor_price_upsert', metadata: {
      partNumber,
      unitCost,
      userId,
      source,
    } });

    return NextResponse.json({
      success: true,
      override: {
        id:         result.id,
        userId:     result.user_id,
        partNumber: result.part_number,
        category:   result.category,
        label:      result.label,
        unitCost:   Number(result.unit_cost),
        source:     result.source,
        priceDate:  result.price_date,
        notes:      result.notes,
        active:     result.active,
        createdAt:  result.created_at,
        updatedAt:  result.updated_at,
      },
    });

  } catch (err) {
    return handleRouteDbError('[admin/distributor-prices POST]', err);
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  // ── Rate limiting ──
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  // 🚨 THE ID COMES FROM THE QUERY STRING. A DELETE from fetch() carries no
  // body unless one is explicitly supplied, and the admin page's trash button
  // sends `?id=<uuid>` with no body at all — so `await req.json()` threw and
  // EVERY delete returned 400 "Invalid JSON body". The JSON body is kept as an
  // optional fallback for any caller that already sends one.
  const { searchParams } = new URL(req.url);
  let body: { id?: string; hard?: boolean } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed as { id?: string; hard?: boolean };
  } catch {
    // No body (or not JSON) — the query string is the authority below.
  }

  const id   = searchParams.get('id') || body.id || null;
  const hard = searchParams.get('hard') === 'true' || body.hard === true;

  if (!id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  // ── UUID validation ──
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id format.' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    if (hard) {
      // Hard delete — permanently removes row
      await sql`DELETE FROM distributor_prices WHERE id = ${id}::uuid`;
      await logAdminAction({ adminId: admin.id, action: 'distributor_price_hard_delete', metadata: { id } });
      return NextResponse.json({ success: true, deleted: true, hard: true });
    } else {
      // Soft delete — sets active=false
      const [row] = await sql`
        UPDATE distributor_prices
        SET active = FALSE, updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id, part_number, active
      `;
      if (!row) {
        return NextResponse.json({ success: false, error: 'Price override not found' }, { status: 404 });
      }
      await logAdminAction({ adminId: admin.id, action: 'distributor_price_soft_delete', metadata: { id, partNumber: row.part_number } });
      return NextResponse.json({ success: true, deleted: false, deactivated: true, id: row.id });
    }

  } catch (err) {
    return handleRouteDbError('[admin/distributor-prices DELETE]', err);
  }
}

// ─── PATCH — reactivate a soft-deleted override ───────────────────────────────

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  // ── Rate limiting ──
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  // ── UUID validation ──
  if (!isValidUUID(body.id)) {
    return NextResponse.json({ success: false, error: 'Invalid id format.' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    const [row] = await sql`
      UPDATE distributor_prices
      SET active = TRUE, updated_at = now()
      WHERE id = ${body.id}::uuid
      RETURNING id, part_number, active
    `;

    if (!row) {
      return NextResponse.json({ success: false, error: 'Price override not found' }, { status: 404 });
    }

    await logAdminAction({ adminId: admin.id, action: 'distributor_price_reactivate', metadata: { id: body.id, partNumber: row.part_number } });

    return NextResponse.json({ success: true, reactivated: true, id: row.id });

  } catch (err) {
    return handleRouteDbError('[admin/distributor-prices PATCH]', err);
  }
}