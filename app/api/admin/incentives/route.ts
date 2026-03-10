import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

function isAdmin(role?: string) { return role === 'admin' || role === 'super_admin'; }

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const sql = getDb();
  const rows = await sql`SELECT * FROM incentive_overrides ORDER BY country, state, program_name`;
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { country='US', state, utility, program_name, type, value, value_type='percent', start_date, end_date, active=true, notes } = body;
  if (!program_name || !type || value == null) return NextResponse.json({ success: false, error: 'program_name, type, value required' }, { status: 400 });

  const sql = getDb();
  const rows = await sql`
    INSERT INTO incentive_overrides (country, state, utility, program_name, type, value, value_type, start_date, end_date, active, notes, created_by)
    VALUES (${country}, ${state||null}, ${utility||null}, ${program_name}, ${type}, ${value}, ${value_type}, ${start_date||null}, ${end_date||null}, ${active}, ${notes||null}, ${user.email})
    RETURNING *
  `;
  return NextResponse.json({ success: true, data: rows[0] });
}

export async function PATCH(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

  const sql = getDb();
  await sql`UPDATE incentive_overrides SET
    program_name=${fields.program_name}, type=${fields.type}, value=${fields.value},
    value_type=${fields.value_type}, state=${fields.state||null}, utility=${fields.utility||null},
    active=${fields.active}, notes=${fields.notes||null}, updated_at=NOW()
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
  await sql`DELETE FROM incentive_overrides WHERE id=${id}`;
  return NextResponse.json({ success: true });
}
