import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

function isAdmin(role?: string) {
  return role === 'admin' || role === 'super_admin';
}

// GET /api/admin/users?search=&page=&limit=
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const page   = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;

  const sql = getDb();

  const [rows, countRows] = await Promise.all([
    search
      ? sql`SELECT id, name, email, company, plan, subscription_status, trial_starts_at,
                   trial_ends_at, is_free_pass, free_pass_note, role, created_at, updated_at
            FROM users
            WHERE name ILIKE ${'%' + search + '%'} OR email ILIKE ${'%' + search + '%'}
               OR company ILIKE ${'%' + search + '%'}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      : sql`SELECT id, name, email, company, plan, subscription_status, trial_starts_at,
                   trial_ends_at, is_free_pass, free_pass_note, role, created_at, updated_at
            FROM users
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    search
      ? sql`SELECT COUNT(*)::int AS total FROM users
            WHERE name ILIKE ${'%' + search + '%'} OR email ILIKE ${'%' + search + '%'}
               OR company ILIKE ${'%' + search + '%'}`
      : sql`SELECT COUNT(*)::int AS total FROM users`,
  ]);

  return NextResponse.json({
    success: true,
    data: rows,
    total: countRows[0].total,
    page,
    limit,
  });
}

// PATCH /api/admin/users — edit user fields
export async function PATCH(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { userId, action, ...fields } = body;
  if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });

  const sql = getDb();

  switch (action) {
    case 'grant_free_pass':
      await sql`UPDATE users SET is_free_pass=true, subscription_status='free_pass',
                  plan='contractor', trial_ends_at='2099-12-31 23:59:59+00',
                  free_pass_note=${fields.note || 'Admin granted free pass'}, updated_at=NOW()
                WHERE id=${userId}`;
      break;
    case 'suspend':
      await sql`UPDATE users SET subscription_status='suspended', updated_at=NOW() WHERE id=${userId}`;
      break;
    case 'unsuspend':
      await sql`UPDATE users SET subscription_status='trialing', updated_at=NOW() WHERE id=${userId}`;
      break;
    case 'reset_trial':
      await sql`UPDATE users SET subscription_status='trialing',
                  trial_starts_at=NOW(), trial_ends_at=NOW() + INTERVAL '14 days',
                  updated_at=NOW()
                WHERE id=${userId}`;
      break;
    case 'set_role':
      if (!['user','admin','super_admin'].includes(fields.role)) {
        return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
      }
      await sql`UPDATE users SET role=${fields.role}, updated_at=NOW() WHERE id=${userId}`;
      break;
    case 'set_plan':
      await sql`UPDATE users SET plan=${fields.plan}, subscription_status=${fields.status || 'active'},
                  updated_at=NOW()
                WHERE id=${userId}`;
      break;
    case 'update':
      await sql`UPDATE users SET
                  name=${fields.name}, company=${fields.company},
                  updated_at=NOW()
                WHERE id=${userId}`;
      break;
    default:
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }

  const updated = await sql`SELECT id, name, email, company, plan, subscription_status,
                                    trial_ends_at, is_free_pass, role, updated_at
                             FROM users WHERE id=${userId}`;
  return NextResponse.json({ success: true, data: updated[0] });
}

// DELETE /api/admin/users?id=xxx
export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden — super_admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('id');
  if (!userId) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

  const sql = getDb();
  await sql`DELETE FROM users WHERE id=${userId}`;
  return NextResponse.json({ success: true });
}
