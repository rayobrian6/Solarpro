import { NextRequest, NextResponse } from 'next/server';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';
import { signToken } from '@/lib/auth';
import { requireAdminApi } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/impersonate
 * Body: { token: string }
 *
 * Validates a one-time impersonation token, sets a session cookie for the target user,
 * and returns a redirect URL to /dashboard with an impersonation flag.
 *
 * BUG-21-03 FIX: Changed from GET to POST — prevents token leakage in server logs,
 * browser history, and Referer headers. POST is required for state-changing operations
 * (setting a session cookie) to prevent CSRF and comply with HTTP semantics.
 *
 * NOTE: Removed GET handler entirely. Frontend must send a POST request with
 * { token } in the JSON body instead of a query-string redirect link.
 */
export async function POST(req: NextRequest) {
  // SECURITY: Require admin authentication
  const adminCheck = await requireAdminApi(req);
  if (!adminCheck) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  let token: string | undefined;
  try {
    const body = await req.json();
    token = typeof body?.token === 'string' ? body.token : undefined;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!token || token.trim() === '') {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  // BUG-21-03 FIX: Sanitise token — only allow hex characters (matches crypto.randomBytes hex output)
  if (!/^[0-9a-f]{96}$/.test(token)) {
    return NextResponse.json({ success: false, error: 'Invalid token format' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

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

    // Mark token as used atomically — prevents race-condition double-use
    const updated = await sql`
      UPDATE admin_impersonation_tokens
      SET used = true
      WHERE id = ${row.id} AND used = false
      RETURNING id
    `;
    if (updated.length === 0) {
      // Another request already consumed this token
      return NextResponse.json({ success: false, error: 'Token already used' }, { status: 401 });
    }

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

    // Return the session token — frontend sets the cookie or redirects as needed
    // BUG-21-03 FIX: Added secure: true so cookie is only sent over HTTPS
    const response = NextResponse.json({
      success: true,
      redirectTo: '/dashboard?impersonating=1',
    });
    response.cookies.set('solarpro_session', sessionToken, {
      httpOnly: true,
      secure:   true,   // BUG-21-03 FIX: Cookie must only be sent over HTTPS
      sameSite: 'lax',
      path:     '/',
      maxAge:   60 * 60, // 1 hour impersonation session
    });

    return response;
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/impersonate/route.ts]', e);
  }
}