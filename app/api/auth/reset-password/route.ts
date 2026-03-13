export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDbReady } from '@/lib/db-neon';
import { hashPassword, clearSessionCookie } from '@/lib/auth';

// ── Helper: ensure password_reset_tokens table exists ────────────────────────
async function ensureTable(sql: Awaited<ReturnType<typeof getDbReady>>): Promise<'ok' | 'missing'> {
  try {
    await sql`SELECT 1 FROM password_reset_tokens LIMIT 0`;
    return 'ok';
  } catch (e: any) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('undefined table')) {
      return 'missing';
    }
    throw e; // unexpected DB error — re-throw
  }
}

// ── POST: submit new password with reset token ────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, password } = body;

    // Input validation
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

    const rawToken = token.trim();
    console.log(`[password-reset] POST — token length: ${rawToken.length}`);

    const sql = await getDbReady();

    // 0. Table existence check
    const tableStatus = await ensureTable(sql);
    if (tableStatus === 'missing') {
      console.error('[password-reset] POST — password_reset_tokens table missing. Run /api/migrate.');
      return NextResponse.json(
        { success: false, error: 'Password reset is not yet configured on this server. Please contact support.' },
        { status: 503 }
      );
    }

    // 1. Hash the incoming raw token (SHA-256)
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    console.log(`[password-reset] POST — computed hash prefix: ${tokenHash.substring(0, 16)}...`);

    // 2. Look up the token record
    const tokenRows = await sql`
      SELECT id, user_id, expires_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    if (tokenRows.length === 0) {
      console.log('[password-reset] POST — token not found (invalid or already used)');
      return NextResponse.json(
        { success: false, error: 'This reset link is invalid or has already been used.' },
        { status: 400 }
      );
    }

    const tokenRecord = tokenRows[0];

    // 3. Check expiration
    const expiresAt = new Date(tokenRecord.expires_at);
    const msRemaining = expiresAt.getTime() - Date.now();
    console.log(`[password-reset] POST — token found, expires in ${Math.round(msRemaining / 1000)}s`);

    if (msRemaining <= 0) {
      console.log('[password-reset] POST — token expired, cleaning up');
      await sql`DELETE FROM password_reset_tokens WHERE id = ${tokenRecord.id}`;
      return NextResponse.json(
        { success: false, error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // 4. Hash the new password with bcrypt (cost 12)
    const passwordHash = await hashPassword(password);

    // 5. Update the user's password
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash},
          updated_at    = NOW()
      WHERE id = ${tokenRecord.user_id}
    `;
    console.log(`[password-reset] POST — password updated for userId=${tokenRecord.user_id}`);

    // 6. Delete the used token (single-use enforcement)
    await sql`DELETE FROM password_reset_tokens WHERE id = ${tokenRecord.id}`;

    // 7. Invalidate existing session cookie (JWT — no server-side session table)
    const clearCookie = clearSessionCookie();

    console.log(`[password-reset] POST — reset complete for userId=${tokenRecord.user_id}`);

    return NextResponse.json(
      { success: true },
      {
        status: 200,
        headers: { 'Set-Cookie': clearCookie },
      }
    );

  } catch (error: any) {
    console.error('[password-reset] POST error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

// ── GET: validate token — used by reset page on mount ────────────────────────
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');

    if (!token || token.trim().length === 0) {
      return NextResponse.json(
        { valid: false, error: 'Token is required.' },
        { status: 400 }
      );
    }

    const rawToken = token.trim();
    console.log(`[password-reset] GET validate — token length: ${rawToken.length}`);

    const sql = await getDbReady();

    // Table existence check — gives a clear error instead of a generic 500
    const tableStatus = await ensureTable(sql);
    if (tableStatus === 'missing') {
      console.error('[password-reset] GET — password_reset_tokens table missing. Run /api/migrate.');
      return NextResponse.json(
        { valid: false, error: 'Password reset is not yet configured on this server. Please contact support.' },
        { status: 503 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    console.log(`[password-reset] GET validate — computed hash prefix: ${tokenHash.substring(0, 16)}...`);

    const rows = await sql`
      SELECT id, expires_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      console.log('[password-reset] GET validate — token not found in DB');
      return NextResponse.json({ valid: false, error: 'Invalid or already used reset link.' });
    }

    const expiresAt = new Date(rows[0].expires_at);
    const msRemaining = expiresAt.getTime() - Date.now();
    console.log(`[password-reset] GET validate — token found, expires in ${Math.round(msRemaining / 1000)}s`);

    if (msRemaining <= 0) {
      console.log('[password-reset] GET validate — token expired');
      return NextResponse.json({ valid: false, error: 'This reset link has expired. Please request a new one.' });
    }

    return NextResponse.json({ valid: true });

  } catch (error: any) {
    console.error('[password-reset] GET validate error:', error?.message);
    return NextResponse.json(
      { valid: false, error: 'Server error validating token. Please try again.' },
      { status: 500 }
    );
  }
}