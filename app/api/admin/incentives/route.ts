import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const rows = await sql`SELECT * FROM incentive_overrides ORDER BY created_at DESC`;
    return NextResponse.json({ success: true, incentives: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const b = await req.json();
    const rows = await sql`
      INSERT INTO incentive_overrides
        (country, state, utility, program_name, type, value, value_type, start_date, end_date, active, notes, created_by)
      VALUES
        (${b.country ?? 'US'}, ${b.state ?? null}, ${b.utility ?? null},
         ${b.program_name}, ${b.type}, ${b.value}, ${b.value_type ?? 'percent'},
         ${b.start_date ?? null}, ${b.end_date ?? null}, ${b.active ?? true},
         ${b.notes ?? null}, ${admin.email})
      RETURNING *
    `;
    return NextResponse.json({ success: true, incentive: rows[0] });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const b = await req.json();
    if (!b.id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    await sql`
      UPDATE incentive_overrides SET
        country      = COALESCE(${b.country      ?? null}, country),
        state        = COALESCE(${b.state        ?? null}, state),
        utility      = COALESCE(${b.utility      ?? null}, utility),
        program_name = COALESCE(${b.program_name ?? null}, program_name),
        type         = COALESCE(${b.type         ?? null}, type),
        value        = COALESCE(${b.value        ?? null}, value),
        value_type   = COALESCE(${b.value_type   ?? null}, value_type),
        start_date   = COALESCE(${b.start_date   ?? null}, start_date),
        end_date     = COALESCE(${b.end_date     ?? null}, end_date),
        active       = COALESCE(${b.active       ?? null}, active),
        notes        = COALESCE(${b.notes        ?? null}, notes),
        updated_at   = NOW()
      WHERE id = ${b.id}
    `;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    await sql`DELETE FROM incentive_overrides WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
  }
}