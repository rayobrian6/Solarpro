import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const rows = await sql`SELECT * FROM utility_policies ORDER BY state, utility_name`;
    return NextResponse.json({ success: true, utilities: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const b = await req.json();
    const rows = await sql`
      INSERT INTO utility_policies
        (utility_name, state, country, net_metering, interconnection_limit_kw, buyback_rate, rate_structure, notes)
      VALUES
        (${b.utility_name}, ${b.state}, ${b.country ?? 'US'},
         ${b.net_metering ?? true}, ${b.interconnection_limit_kw ?? null},
         ${b.buyback_rate ?? null}, ${b.rate_structure ?? null}, ${b.notes ?? null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, utility: rows[0] });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
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
      UPDATE utility_policies SET
        utility_name             = COALESCE(${b.utility_name             ?? null}, utility_name),
        state                    = COALESCE(${b.state                    ?? null}, state),
        country                  = COALESCE(${b.country                  ?? null}, country),
        net_metering             = COALESCE(${b.net_metering             ?? null}, net_metering),
        interconnection_limit_kw = COALESCE(${b.interconnection_limit_kw ?? null}, interconnection_limit_kw),
        buyback_rate             = COALESCE(${b.buyback_rate             ?? null}, buyback_rate),
        rate_structure           = COALESCE(${b.rate_structure           ?? null}, rate_structure),
        notes                    = COALESCE(${b.notes                    ?? null}, notes),
        updated_at               = NOW()
      WHERE id = ${b.id}
    `;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    await sql`DELETE FROM utility_policies WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}