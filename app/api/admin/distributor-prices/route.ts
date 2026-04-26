// ============================================================
// app/api/admin/distributor-prices/route.ts
// ─────────────────────────────────────────────────────────────
// CRUD API for admin-managed distributor price overrides.
//
// GET    /api/admin/distributor-prices
//   ?user_id=<uuid>   — filter by company (omit for global/platform defaults)
//   ?category=<str>   — filter by category
//   ?part_number=<str>— filter by part number
//   ?active=true|false— filter by active status (default: true)
//
// POST   /api/admin/distributor-prices
//   Body: { user_id?, part_number, category?, label?, unit_cost, source?, price_date?, notes? }
//   Creates or updates (upsert on user_id+part_number).
//
// DELETE /api/admin/distributor-prices
//   Body: { id } — soft-delete (sets active=false)
//   Body: { id, hard: true } — hard delete (removes row)
//
// GET    /api/admin/distributor-prices/catalog
//   Returns the full static catalog from distributorPricing.ts (read-only).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import {
  DISTRIBUTOR_PRICE_CATALOG,
  CATEGORY_FALLBACK_PRICES,
  resolveUnitCost,
  type DistributorPriceOverride,
} from '@/lib/bom/distributorPricing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId     = searchParams.get('user_id')     || null;
  const category   = searchParams.get('category')    || null;
  const partNumber = searchParams.get('part_number') || null;
  const activeOnly = searchParams.get('active') !== 'false'; // default true

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
      // Also include the static catalog for reference
      catalog: DISTRIBUTOR_PRICE_CATALOG.map(e => ({
        partNumber: e.partNumber,
        description: e.description,
        category: e.category,
        unit: e.unit,
        listPrice: e.listPrice,
        netPrice: e.category === 'solar_panel'
          ? null // per-panel pricing handled in distributorPricing.ts
          : e.netPrice,
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

  let body: {
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

    // Upsert: conflict on (user_id, part_number) — NULL-safe via COALESCE
    const [row] = await sql`
      INSERT INTO distributor_prices
        (user_id, part_number, category, label, unit_cost, source, price_date, notes, active)
      VALUES
        (
          ${userId}::uuid,
          ${partNumber},
          ${category},
          ${label},
          ${unitCost},
          ${source},
          ${priceDate}::date,
          ${notes},
          TRUE
        )
      ON CONFLICT (
        COALESCE(user_id::text, '00000000-0000-0000-0000-000000000000'),
        UPPER(part_number)
      )
      DO UPDATE SET
        category   = EXCLUDED.category,
        label      = EXCLUDED.label,
        unit_cost  = EXCLUDED.unit_cost,
        source     = EXCLUDED.source,
        price_date = EXCLUDED.price_date,
        notes      = EXCLUDED.notes,
        active     = TRUE,
        updated_at = now()
      RETURNING *
    `;

    // Fallback: if ON CONFLICT failed (no unique index yet), do a plain INSERT
    const result = row ?? (await sql`
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

  let body: { id?: string; hard?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    if (body.hard) {
      // Hard delete — permanently removes row
      await sql`DELETE FROM distributor_prices WHERE id = ${body.id}::uuid`;
      await logAdminAction({ adminId: admin.id, action: 'distributor_price_hard_delete', metadata: { id: body.id } });
      return NextResponse.json({ success: true, deleted: true, hard: true });
    } else {
      // Soft delete — sets active=false
      const [row] = await sql`
        UPDATE distributor_prices
        SET active = FALSE, updated_at = now()
        WHERE id = ${body.id}::uuid
        RETURNING id, part_number, active
      `;
      if (!row) {
        return NextResponse.json({ success: false, error: 'Price override not found' }, { status: 404 });
      }
      await logAdminAction({ adminId: admin.id, action: 'distributor_price_soft_delete', metadata: { id: body.id, partNumber: row.part_number } });
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

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
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