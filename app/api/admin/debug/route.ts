import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// Temporary debug endpoint — remove after fixing admin access
export async function GET(req: NextRequest) {
  const jwtUser = getUserFromRequest(req);

  if (!jwtUser) {
    return NextResponse.json({
      status: 'no_session',
      message: 'No valid session cookie found',
      cookie: req.headers.get('cookie')?.includes('solarpro_session') ? 'cookie_present_but_invalid' : 'no_cookie',
    });
  }

  // Check DB role
  let dbRole = 'unknown';
  let dbFound = false;
  try {
    const sql = getDb();
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${jwtUser.id} LIMIT 1`;
    if (rows.length > 0) {
      dbRole = rows[0].role ?? 'null';
      dbFound = true;
    }
  } catch (e: any) {
    dbRole = `db_error: ${e.message}`;
  }

  return NextResponse.json({
    status: 'ok',
    jwtUser: {
      id: jwtUser.id,
      email: jwtUser.email,
      name: jwtUser.name,
      role: jwtUser.role ?? 'not_in_jwt',
    },
    dbRole,
    dbFound,
    isAdmin: dbRole === 'admin' || dbRole === 'super_admin',
    message: dbRole === 'admin' || dbRole === 'super_admin'
      ? '✅ You should have admin access'
      : `❌ DB role is "${dbRole}" — not admin/super_admin`,
  });
}