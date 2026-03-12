import { NextRequest, NextResponse } from 'next/server';
import {
  getDbReady, verifyPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email?.trim() || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    // ── DB with cold-start retry ─────────────────────────────────────────
    // getDbReady() fires a SELECT 1 probe with up to 3 retries (1s/2s/4s
    // backoff) to handle Neon compute cold starts. If the DB is already
    // warm this adds ~0ms overhead. If cold, the probe wakes the node so
    // the auth query below lands on a live connection.
    const sql = await getDbReady();

    // ── Fetch user ───────────────────────────────────────────────────────
    // Role is fetched but NOT put in JWT
    const rows = await sql`
      SELECT id, name, email, password_hash, company, phone, role
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const user = rows[0];

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // JWT contains ONLY identity — role is NOT included
    const sessionUser: SessionUser = {
      id:      user.id,
      name:    user.name,
      email:   user.email,
      company: user.company || undefined,
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    // Return role in response body for client UI use, but NOT in JWT
    return NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: user.role || 'user' } } },
      {
        status: 200,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    const msg = error?.message || String(error);

    // ── Config error: DATABASE_URL missing ──────────────────────────────
    // This is a genuine misconfiguration — tell the admin clearly.
    if (error instanceof DbConfigError || msg.includes('DATABASE_URL')) {
      console.error('\n[/api/auth/login] DATABASE_URL not configured:');
      console.error(' ', msg);
      console.error('  -> Add DATABASE_URL to your Vercel environment variables.\n');
      return NextResponse.json(
        {
          success: false,
          error: 'Database not configured. Contact your administrator.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // ── Transient error: cold start / network timeout ────────────────────
    // getDbReady() already retried 3x — if we still land here, the DB is
    // genuinely unreachable right now. Tell the client to retry shortly.
    if (isTransientDbError(error)) {
      console.warn('[/api/auth/login] DB temporarily unreachable after retries:', msg);
      return NextResponse.json(
        {
          success: false,
          error: 'Server is starting up — please wait a moment and try again.',
          code: 'DB_STARTING',
          retryAfterMs: 3000,
        },
        {
          status: 503,
          headers: { 'Retry-After': '3' },
        }
      );
    }

    // ── Unexpected error ─────────────────────────────────────────────────
    console.error('[/api/auth/login] Unexpected login error:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}