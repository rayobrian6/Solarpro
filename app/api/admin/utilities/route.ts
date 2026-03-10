import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

function isAdmin(role?: string) { return role === 'admin' || role === 'super_admin'; }

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const sql = getDb();
  const rows = await sql`SELECT * FROM utility_policies ORDER BY country, state, utility_name`;
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { utility_name, state, country='US', net_metering=true, interconnection_limit_kw, buyback_rate, rate_structure, notes } = body;
  if (!utility_name || !state) return NextResponse.json({ success: false, error: 'utility_name and state required' }, { status: 400 });

  const sql = getDb();
  const rows = await sql`
    INSERT INTO utility_policies (utility_name, state, country, net_metering, interconnection_limit_kw, buyback_rate, rate_structure, notes)
    VALUES (${utility_name}, ${state}, ${country}, ${net_metering}, ${interconnection_limit_kw||null}, ${buyback_rate||null}, ${rate_structure||null}, ${notes||null})
    RETURNING *
  `;
  return NextResponse.json({ success: true, data: rows[0] });
}

export async function PATCH(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...f } = body;
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

  const sql = getDb();
  await sql`UPDATE utility_policies SET
    utility_name=${f.utility_name}, state=${f.state}, net_metering=${f.net_metering},
    interconnection_limit_kw=${f.interconnection_limit_kw||null}, buyback_rate=${f.buyback_rate||null},
    rate_structure=${f.rate_structure||null}, notes=${f.notes||null}, updated_at=NOW()
    WHERE id=${id}`;
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

  const sql = getDb();
  await sql`DELETE FROM utility_policies WHERE id=${id}`;
  return NextResponse.json({ success: true });
}
