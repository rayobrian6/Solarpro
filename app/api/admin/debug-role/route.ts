import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/debug-role
 * Diagnostic endpoint — returns JWT identity and DB role.
 * Does NOT require admin access so it can be used to diagnose auth issues.
 */
export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);

  if (!match) {
    return NextResponse.json({
      jwt_user_id: null,
      db_role: null,
      is_admin: false,
      error: 'No solarpro_session cookie found — not logged in',
    });
  }

  const jwtUser = verifyToken(match[1]);
  if (!jwtUser?.id) {
    return NextResponse.json({
      jwt_user_id: null,
      db_role: null,
      is_admin: false,
      error: 'Cookie present but JWT is invalid or expired — please log out and log back in',
    });
  }

  // Fetch role from DB
  let db_role: string | null = null;
  let db_email: string | null = null;
  let db_name: string | null = null;
  let db_error: string | null = null;

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, role FROM users WHERE id = ${jwtUser.id} LIMIT 1
    `;
    if (rows.length > 0) {
      db_role  = rows[0].role ?? 'user';
      db_email = rows[0].email;
      db_name  = rows[0].name;
    } else {
      db_error = 'User not found in database';
    }
  } catch (e: any) {
    db_error = `DB error: ${e.message}`;
  }

  const is_admin = db_role === 'admin' || db_role === 'super_admin';

  return NextResponse.json({
    jwt_user_id:  jwtUser.id,
    jwt_email:    jwtUser.email,
    jwt_name:     jwtUser.name,
    jwt_has_role: 'role' in jwtUser ? (jwtUser as any).role : '(not present — correct)',
    db_role,
    db_email,
    db_name,
    is_admin,
    db_error,
    message: is_admin
      ? `✅ DB role is "${db_role}" — admin access will be granted`
      : `❌ DB role is "${db_role}" — not admin/super_admin. Run /api/admin/set-roles?secret=YOUR_SECRET to fix.`,
  });
}