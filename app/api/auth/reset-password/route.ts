export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDbReady } from '@/lib/db-neon';
import { hashPassword, clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, password } = body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Reset token is required.' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'New password is required.' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters.' },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // ── 1. Hash the incoming raw token ────────────────────────────────────────
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    // ── 2. Look up the token record ───────────────────────────────────────────
    const tokenRows = await sql`
      SELECT id, user_id, expires_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    if (tokenRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'This reset link is invalid or has already been used.' },
        { status: 400 }
      );
    }

    const tokenRecord = tokenRows[0];

    // ── 3. Check expiration ───────────────────────────────────────────────────
    const expiresAt = new Date(tokenRecord.expires_at);
    if (Date.now() > expiresAt.getTime()) {
      // Clean up the expired token
      await sql`DELETE FROM password_reset_tokens WHERE id = ${tokenRecord.id}`;
      return NextResponse.json(
        { success: false, error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // ── 4. Hash the new password with bcrypt ──────────────────────────────────
    const passwordHash = await hashPassword(password);

    // ── 5. Update the user's password ─────────────────────────────────────────
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash},
          updated_at    = NOW()
      WHERE id = ${tokenRecord.user_id}
    `;

    // ── 6. Delete the used token (single-use enforcement) ─────────────────────
    await sql`
      DELETE FROM password_reset_tokens
      WHERE id = ${tokenRecord.id}
    `;

    // ── 7. Invalidate all existing sessions ───────────────────────────────────
    // We use JWT cookies so there's no server-side session table.
    // Clearing the cookie is handled client-side after redirect.
    // For extra security, we clear the cookie in the response header.
    const clearCookie = clearSessionCookie();

    console.log(`[password-reset] Password reset successful for userId=${tokenRecord.user_id}`);

    return NextResponse.json(
      { success: true },
      {
        status: 200,
        headers: { 'Set-Cookie': clearCookie },
      }
    );

  } catch (error: any) {
    console.error('[password-reset] reset-password error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

// ── Validate token endpoint (GET) — used by reset page to check token on load ──
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');

    if (!token || token.trim().length === 0) {
      return NextResponse.json(
        { valid: false, error: 'Token is required.' },
        { status: 400 }
      );
    }

    const sql = await getDbReady();
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const rows = await sql`
      SELECT id, expires_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ valid: false, error: 'Invalid or already used reset link.' });
    }

    const expiresAt = new Date(rows[0].expires_at);
    if (Date.now() > expiresAt.getTime()) {
      return NextResponse.json({ valid: false, error: 'This reset link has expired.' });
    }

    return NextResponse.json({ valid: true });

  } catch (error: any) {
    console.error('[password-reset] validate-token error:', error?.message);
    return NextResponse.json({ valid: false, error: 'Server error validating token.' }, { status: 500 });
  }
}