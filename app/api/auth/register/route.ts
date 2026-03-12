import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  hashPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';
import { getDbReady, DbConfigError , handleRouteDbError } from '@/lib/db-neon';
import { isTransientDbError } from '@/lib/db-ready';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, company, phone } = body;

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Full name is required.' }, { status: 400 });
    }
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Valid email is required.' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

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

    // JWT contains ONLY identity — role is NOT included
    const sessionUser: SessionUser = {
      id:      userId,
      name:    name.trim(),
      email:   email.toLowerCase().trim(),
      company: company?.trim() || undefined,
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    return NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: 'user' } } },
      {
        status: 201,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    // Config error — DATABASE_URL missing
    if (error instanceof DbConfigError) {
      console.error('[/api/auth/register] DATABASE_URL not configured:', error.message);
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
      console.warn('[/api/auth/register] DB temporarily unreachable:', error.message);
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