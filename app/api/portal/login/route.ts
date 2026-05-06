import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { signPortalToken, makePortalCookie, PORTAL_COOKIE_NAME, PORTAL_COOKIE_MAX_AGE } from '@/lib/portalAuth';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Rate limit: 10 attempts per 60s per IP (brute-force protection)
  const rl = await checkRateLimit('portal_login', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many login attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!rawEmail || rawEmail.length > 254) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // Look up client by email — a homeowner may have multiple projects
    // We match on clients.email (case-insensitive)
    const clients = await sql`
      SELECT id, name, email
      FROM clients
      WHERE LOWER(email) = ${rawEmail}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    // Always return the same response to prevent email enumeration
    if (clients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'If an account was found, you are now logged in.',
      });
    }

    const client = clients[0];
    const token  = signPortalToken({
      clientId: client.id,
      email:    client.email,
      name:     client.name,
    });

    const res = NextResponse.json({
      success: true,
      message: 'Logged in.',
      name:    client.name,
    });

    // Set portal session cookie (Path=/, HttpOnly — must cover /api/portal/* paths)
    res.headers.append(
      'Set-Cookie',
      makePortalCookie(token)
    );

    return res;
  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/login]', e);
  }
}