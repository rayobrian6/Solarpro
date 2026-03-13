export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  getDbReady, verifyPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';

// v47.9: Explicit maxDuration prevents Vercel from killing this function during
// DB cold-start retries. Auth routes need up to ~9s for 5 probe retries + query.
// Default Vercel Hobby timeout is 10s — far too short. 30s is safe for all plans.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // -- Startup env guard (logged once per cold start) --------------------------
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasJwtSecret   = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length > 10;
  console.log(`[DATABASE_URL_PRESENT] present=${hasDatabaseUrl} length=${process.env.DATABASE_URL?.length ?? 0}`);
  console.log(`[JWT_SECRET_PRESENT] present=${hasJwtSecret} length=${process.env.JWT_SECRET?.length ?? 0}`);

  console.log('[AUTH_LOGIN_REQUEST] POST /api/auth/login received');

  // -- Cookie check ------------------------------------------------------------
  const existingCookie = req.cookies.get('solarpro_session');
  if (existingCookie) {
    console.log('[AUTH_COOKIE_PRESENT] Existing session cookie found on login request (will be replaced)');
  } else {
    console.log('[AUTH_COOKIE_MISSING] No existing session cookie on login request (expected for fresh login)');
  }

  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email?.trim() || !password) {
      console.warn('[AUTH_LOGIN_FAILURE] Missing email or password in request body');
      return NextResponse.json(
        { success: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    console.log(`[AUTH_LOGIN_REQUEST] Attempting login for: ${email.toLowerCase().trim()}`);

    // -- DB with cold-start retry -----------------------------------------------
    // v47.9: getDbReady() uses module-level singleton + warm-cache flag.
    // On warm instances: returns cached executor instantly (~0ms).
    // On cold start: retries SELECT 1 probe up to 5x with 300ms/600ms/1200ms/2400ms/4800ms backoff.
    // Total budget ~9s, well under maxDuration=30.
    console.log('[AUTH_SESSION_CHECK] Acquiring DB connection for login');
    const sql = await getDbReady();

    // -- Fetch user -------------------------------------------------------------
    // Role is fetched but NOT put in JWT
    const rows = await sql`
      SELECT id, name, email, password_hash, company, phone, role, tos_accepted_at, tos_version
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (rows.length === 0) {
      console.warn(`[AUTH_LOGIN_FAILURE] No user found for email: ${email.toLowerCase().trim()}`);
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const user = rows[0];

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      console.warn(`[AUTH_LOGIN_FAILURE] Password verification failed for userId=${user.id}`);
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // JWT contains ONLY identity -- role is NOT included
    const sessionUser: SessionUser = {
      id:      user.id,
      name:    user.name,
      email:   user.email,
      company: user.company || undefined,
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    const tosAccepted = !!user.tos_accepted_at;
    console.log(`[AUTH_LOGIN_SUCCESS] Login successful for userId=${user.id} email=${user.email} tosAccepted=${tosAccepted}`);

    // Return role + ToS status in response body for client UI use, but NOT in JWT
    return NextResponse.json(
      {
        success: true,
        data: {
          user: {
            ...sessionUser,
            role: user.role || 'user',
            tos_accepted: tosAccepted,
            tos_version:  user.tos_version ?? null,
          },
        },
        // Redirect hint: if ToS not yet accepted, client should send user to /terms
        tos_redirect: tosAccepted ? null : '/terms?required=1',
      },
      {
        status: 200,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    const msg = error?.message || String(error);

    // -- Config error: DATABASE_URL genuinely missing ---------------------------
    // ONLY DbConfigError (thrown by getDatabaseUrl()) is a true config error.
    // Do NOT check msg.includes('DATABASE_URL') -- that can match Neon connection
    // string errors during cold start and incorrectly show "Database not configured."
    if (error instanceof DbConfigError) {
      console.error('[AUTH_LOGIN_FAILURE] [AUTH_DB_CONFIG_ERROR] /api/auth/login: DATABASE_URL not configured:', msg);
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error. Please contact your administrator.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // -- All other errors: cold start / network / unknown ----------------------
    // getDbReady() already retried 5x. Any remaining error is either a transient
    // Neon cold-start error or an unknown error. In both cases return DB_STARTING
    // so the login page retries instead of showing an error banner.
    //
    // SAFE DEFAULT: returning DB_STARTING for unknown errors is always better
    // than showing "Login failed" or "Database not configured" for a cold start.
    const classified = isTransientDbError(error) ? 'transient' : 'unknown-defaulting-to-transient';
    console.warn(`[AUTH_LOGIN_FAILURE] [AUTH_DB_STARTING] /api/auth/login: DB error [${classified}]:`, msg);
    return NextResponse.json(
      {
        success: false,
        error: 'Server is starting up -- please wait a moment and try again.',
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