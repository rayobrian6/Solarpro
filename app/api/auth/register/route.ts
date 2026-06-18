export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  hashPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';
import { getDbReady, DbConfigError , handleRouteDbError } from '@/lib/db-neon';
import { isTransientDbError } from '@/lib/db-ready';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { checkHoneypot, isGibberish, isDisposableEmail } from '@/lib/signupGuard';

// v47.9: Explicit maxDuration for DB cold-start retry budget
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    // Rate limiting — prevent mass account creation
        const rl = await checkRateLimit('register', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many registration attempts. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const body = await req.json();

    // Honeypot check — hidden field that real users never see.
    // Bots that auto-fill all form fields will populate it.
    // Return 200 (not 400/429) so bots think they succeeded.
    if (checkHoneypot(body as Record<string, unknown>)) {
      console.warn(`[REGISTER_BOT] honeypot triggered ip=${getClientIp(req)}`);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Gibberish-name check — catches machine-generated name tokens
    // (e.g. "apRNkSYEBgLXMpWFmwYDu", "cVortUUXenbwHapcWGBXaL").
    // Must run BEFORE Zod parse so we can read the raw name string.
    // Silent 200 keeps bots from knowing they were detected.
    const rawName = typeof body?.name === 'string' ? body.name : '';
    if (isGibberish(rawName)) {
      console.warn(`[REGISTER_BOT] gibberish name="${rawName}" ip=${getClientIp(req)}`);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Disposable email check — catches throwaway inbox services.
    // Does NOT block free providers (gmail, yahoo, etc.) — many real installers
    // use personal email. Silent 200 same as honeypot/gibberish.
    const rawEmail = typeof body?.email === 'string' ? body.email : '';
    if (isDisposableEmail(rawEmail)) {
      console.warn(`[REGISTER_BOT] disposable email domain ip=${getClientIp(req)}`);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Zod schema validation (replaces manual checks)
    const { registerSchema, parseBody } = await import('@/lib/validation');
    const { data: parsed, error: validationError } = parseBody(registerSchema, body);
    if (validationError || !parsed) {
      const isTos = validationError?.includes('Terms of Service');
      return NextResponse.json(
        { success: false, error: validationError, ...(isTos ? { code: 'TOS_REQUIRED' } : {}) },
        { status: 400 }
      );
    }
    const { name, email, password, company, phone, tosAccepted } = parsed;

    // Capture client IP for ToS audit trail
    const tosIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null;

    // Use retry-aware DB getter to handle Neon cold starts after deployment
    const sql = await getDbReady();

    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase().trim()} LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists.' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();

    // Record ToS acceptance at signup if user checked the box.
    // Use the base INSERT (without tos columns) if Migration 010 hasn't run yet,
    // then update tos fields separately — this prevents a crash if the columns
    // don't exist yet in production.
    const tosAcceptedAt = tosAccepted ? new Date().toISOString() : null;
    const tosVersion    = tosAccepted ? 'v1.0' : null;

    await sql`
      INSERT INTO users (id, name, email, password_hash, company, phone, role, email_verified)
      VALUES (
        ${userId},
        ${name.trim()},
        ${email.toLowerCase().trim()},
        ${hashedPassword},
        ${company?.trim() || null},
        ${phone?.trim() || null},
        'user',
        false
      )
    `;

    // If this email was invited to an organization, auto-join it now and bill the
    // seat on the owner's subscription. Non-fatal — registration must never break.
    try {
      const inv = await sql`
        SELECT id, org_id FROM org_invites
        WHERE invited_email = ${email.toLowerCase().trim()}
          AND accepted_at IS NULL AND expires_at > now()
        ORDER BY expires_at DESC LIMIT 1
      `;
      if (inv[0]?.org_id) {
        await sql`UPDATE users SET org_id = ${inv[0].org_id}, org_role = 'member', updated_at = NOW() WHERE id = ${userId}`;
        await sql`UPDATE org_invites SET accepted_at = now() WHERE id = ${inv[0].id}`;
        const { syncSeatsForOrg } = await import('@/lib/stripe');
        await syncSeatsForOrg(inv[0].org_id as string);
      }
    } catch (inviteErr: unknown) {
      console.warn('[/api/auth/register] invite auto-accept skipped:', (inviteErr as Error)?.message);
    }

    // Attempt to record ToS acceptance — silently skip if columns don't exist yet
    if (tosAccepted) {
      try {
        await sql`
          UPDATE users
          SET tos_accepted_at = ${tosAcceptedAt},
              tos_version     = ${tosVersion},
              tos_ip          = ${tosIp},
              updated_at      = NOW()
          WHERE id = ${userId}
        `;
        console.log(`[TOS_ACCEPTED_AT_SIGNUP] userId=${userId} version=${tosVersion} ip=${tosIp}`);
      } catch (tosErr: unknown) {
        // Migration 010 not yet run — tos columns missing. Non-fatal: user can accept via /terms
        console.warn('[/api/auth/register] ToS columns not yet available (run migration):', (tosErr as Error)?.message);
      }
    }

    // JWT contains ONLY identity — role is NOT included
    const sessionUser: SessionUser = {
      id:      userId,
      name:    name.trim(),
      email:   email.toLowerCase().trim(),
      company: company?.trim() || undefined,
    };

    const token = signToken(sessionUser);

    // v47.161: Use response.cookies.set() — same as login route.
    // Raw Set-Cookie header can be silently dropped by Vercel's edge proxy.
    const response = NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: 'user' } } },
      { status: 201 }
    );
    response.cookies.set('solarpro_session', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path:     '/',
      maxAge:   60 * 60 * 24 * 30, // 30 days
    });
    return response;

  } catch (error: unknown) {
    // Config error — DATABASE_URL missing
    if (error instanceof DbConfigError) {
      console.error('[/api/auth/register] DATABASE_URL not configured:', (error as Error).message);
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error. Please contact your administrator.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // Transient error — cold start / network timeout
    if (isTransientDbError(error)) {
      console.warn('[/api/auth/register] DB temporarily unreachable:', (error as Error).message);
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

    console.error('[/api/auth/register] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create account. Please try again.' },
      { status: 500 }
    );
  }
}