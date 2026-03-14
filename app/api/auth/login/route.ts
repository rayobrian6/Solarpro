export const dynamic    = 'force-dynamic';
export const revalidate = 0;
export const runtime    = 'nodejs';
// Explicit maxDuration prevents Vercel from killing this function during
// DB cold-start retries. Auth routes need up to ~9s for retries + query.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import {
  getDbReady, verifyPassword, signToken, COOKIE_NAME, COOKIE_MAX_AGE, SessionUser
} from '@/lib/auth';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';

// PHASE 5: Log auth secret fingerprint on first invocation (not the secret itself)
// This confirms the secret is stable and consistent across deployments.
let _secretFingerprintLogged = false;
function logSecretFingerprint() {
  if (_secretFingerprintLogged) return;
  _secretFingerprintLogged = true;
  try {
    const secret = process.env.JWT_SECRET || '';
    // Simple fingerprint: length + first 4 chars + last 4 chars + char sum mod 9999
    const charSum = secret.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 9999;
    const fingerprint = `len=${secret.length}_head=${secret.substring(0,4)}_tail=${secret.slice(-4)}_sum=${charSum}`;
    console.log(`[AUTH_SECRET_FINGERPRINT] ${fingerprint} env=${process.env.NODE_ENV}`);
  } catch {
    console.log('[AUTH_SECRET_FINGERPRINT] ERROR computing fingerprint');
  }
}

export async function POST(req: NextRequest) {
  logSecretFingerprint();
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email?.trim() || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    // ── DB with cold-start retry ──────────────────────────────────────────
    const sql = await getDbReady();

    // ── Fetch user ────────────────────────────────────────────────────────
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

    // ── FIX: Use response.cookies.set() — the Next.js 14 App Router
    // canonical API. Using headers: { 'Set-Cookie': string } is unreliable
    // on Vercel because the edge proxy merges response headers AFTER the
    // function returns, and the raw Set-Cookie header can be silently
    // dropped or corrupted during that merge. response.cookies.set() goes
    // through the Next.js ResponseCookies API which is handled correctly
    // by the runtime before the proxy layer touches the response.
    const response = NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: user.role || 'user' } } },
      { status: 200 }
    );

    const cookieOptions = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path:     '/',
      maxAge:   COOKIE_MAX_AGE, // 30 days in seconds
      // domain intentionally omitted — let browser derive from request origin
    };

    response.cookies.set(COOKIE_NAME, token, cookieOptions);

    // PHASE 1: Structured cookie diagnostic log
    const setCookieHeader = response.headers.get('set-cookie');
    console.log('[AUTH_COOKIE_SET]', JSON.stringify({
      cookieName:          COOKIE_NAME,
      hasSetCookieHeader:  !!setCookieHeader,
      setCookiePreview:    setCookieHeader ? setCookieHeader.substring(0, 120) : 'MISSING',
      secure:              cookieOptions.secure,
      sameSite:            cookieOptions.sameSite,
      path:                cookieOptions.path,
      domain:              'omitted',
      maxAge:              cookieOptions.maxAge,
      nodeEnv:             process.env.NODE_ENV,
    }));

    console.log(`[AUTH_LOGIN_SUCCESS] user=${sessionUser.email} cookie=${COOKIE_NAME} set via response.cookies.set()`);

    return response;

  } catch (error: any) {
    const msg = error?.message || String(error);

    if (error instanceof DbConfigError) {
      console.error('[AUTH_DB_CONFIG_ERROR] /api/auth/login: DATABASE_URL not configured:', msg);
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error. Please contact your administrator.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    const classified = isTransientDbError(error) ? 'transient' : 'unknown-defaulting-to-transient';
    console.warn(`[AUTH_DB_STARTING] /api/auth/login: DB error [${classified}]:`, msg);
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
}