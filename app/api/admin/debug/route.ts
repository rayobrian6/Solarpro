import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getDbReady } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Legacy debug endpoint — redirects to debug-role
export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);

  if (!match) {
    return NextResponse.json({
      status: 'no_session',
      message: 'No solarpro_session cookie found',
    });
  }

  const jwtUser = verifyToken(match[1]);
  if (!jwtUser) {
    return NextResponse.json({
      status: 'invalid_token',
      message: 'Cookie present but token is invalid or expired',
    });
  }

  // Check DB role
  let dbRole = 'unknown';
  let dbFound = false;
  try {
    const sql = await getDbReady();
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${jwtUser.id} LIMIT 1`;
    if (rows.length > 0) {
      dbRole = rows[0].role ?? 'user';
      dbFound = true;
    }
  } catch (e: any) {
    dbRole = `db_error: ${e.message}`;
  }

  const isAdmin = dbRole === 'admin' || dbRole === 'super_admin';

  return NextResponse.json({
    status: 'ok',
    jwtUser: {
      id:    jwtUser.id,
      email: jwtUser.email,
      name:  jwtUser.name,
      note:  'role is no longer stored in JWT — DB is source of truth',
    },
    dbRole,
    dbFound,
    isAdmin,
    message: isAdmin
      ? `✅ DB role is "${dbRole}" — admin access granted`
      : `❌ DB role is "${dbRole}" — not admin/super_admin`,
  });
}