import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-neon';
import { signToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/impersonate?token=xxx
 * Validates a one-time impersonation token, sets a session cookie for the target user,
 * and redirects to /dashboard with an impersonation flag.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  try {
    const sql = getDb();

    // Look up the token — must be unused and not expired
    const rows = await sql`
      SELECT t.id, t.admin_id, t.target_id, t.used, t.expires_at,
             u.id AS uid, u.name, u.email, u.company, u.role
      FROM admin_impersonation_tokens t
      JOIN users u ON u.id = t.target_id
      WHERE t.token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const row = rows[0];

    if (row.used) {
      return NextResponse.json({ success: false, error: 'Token already used' }, { status: 401 });
    }

    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'Token expired' }, { status: 401 });
    }

    // Mark token as used
    await sql`UPDATE admin_impersonation_tokens SET used = true WHERE id = ${row.id}`;

    // Create a JWT for the target user
    const sessionPayload = {
      id:      row.uid,
      name:    row.name,
      email:   row.email,
      company: row.company,
      // Embed impersonation metadata in the token
      _impersonated: true,
      _adminId: row.admin_id,
    };

    const sessionToken = signToken(sessionPayload);

    // Set the session cookie and redirect to dashboard
    const response = NextResponse.redirect(new URL('/dashboard?impersonating=1', req.url));
    response.cookies.set('solarpro_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour impersonation session
    });

    return response;
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}