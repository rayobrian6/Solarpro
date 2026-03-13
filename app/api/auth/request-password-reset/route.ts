export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDbReady } from '@/lib/db-neon';
import { sendPasswordResetEmail } from '@/lib/email';

// Always return the same response regardless of whether the email exists.
// This prevents user enumeration attacks.
const SUCCESS_RESPONSE = {
  success: true,
  message: 'If the email exists, a reset link has been sent.',
};

// ── Helper: ensure password_reset_tokens table exists ────────────────────────
// Mirrors the same guard in reset-password/route.ts.
// If the table is missing (Migration 012 not yet run) we return a clear 503
// instead of the generic "An unexpected error occurred" 500.
async function ensureTable(sql: Awaited<ReturnType<typeof getDbReady>>): Promise<'ok' | 'missing'> {
  try {
    await sql`SELECT 1 FROM password_reset_tokens LIMIT 0`;
    return 'ok';
  } catch (e: any) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('undefined table')) {
      return 'missing';
    }
    throw e; // unexpected DB error — re-throw so caller's catch block handles it
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Still return success shape to avoid email enumeration via error messages
      return NextResponse.json(SUCCESS_RESPONSE);
    }

    const sql = await getDbReady();

    // 0. Table existence check — gives a clear error instead of a generic 500
    //    if Migration 012 (password_reset_tokens) has not been run yet.
    const tableStatus = await ensureTable(sql);
    if (tableStatus === 'missing') {
      console.error('[password-reset] POST — password_reset_tokens table missing. Run /api/migrate to create it.');
      return NextResponse.json(
        { success: false, error: 'Password reset is not yet configured on this server. Please contact support.' },
        { status: 503 }
      );
    }

    // 1. Look up user by email — do NOT reveal existence to caller
    const users = await sql`
      SELECT id, email, name
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (users.length === 0) {
      // User doesn't exist — return success anyway (security: no enumeration)
      console.log(`[password-reset] Request for unknown email: ${email} — returning success silently`);
      return NextResponse.json(SUCCESS_RESPONSE);
    }

    const user = users[0];

    // 2. Delete any existing (possibly expired) tokens for this user to keep table clean
    await sql`
      DELETE FROM password_reset_tokens
      WHERE user_id = ${user.id}
    `;

    // 3. Generate a cryptographically secure random token (32 bytes = 64 hex chars)
    const rawToken = crypto.randomBytes(32).toString('hex');

    // 4. Hash the token before storing (SHA-256 — fast, no salt needed for tokens)
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 5. Store hashed token with 1-hour expiration
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${tokenHash}, ${expiresAt.toISOString()})
    `;

    // 6. Send email with the RAW token in the URL (never the hash)
    // Log the URL being used so we can verify it in Vercel logs
    const appUrlForLogging = process.env.NEXT_PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_BASE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://solarpro-v31.vercel.app');
    console.log(`[password-reset] Sending reset email to userId=${user.id} — base URL: ${appUrlForLogging}`);

    const emailResult = await sendPasswordResetEmail(user.email, rawToken);

    if (!emailResult.success) {
      console.error(`[password-reset] Email send failed for userId=${user.id}:`, emailResult.error);
      // Don't expose email failure to client — return success to avoid enumeration
    } else {
      console.log(`[password-reset] Reset email sent successfully to userId=${user.id}`);
    }

    return NextResponse.json(SUCCESS_RESPONSE);

  } catch (error: any) {
    console.error('[password-reset] request-password-reset unexpected error:', error?.message, error?.stack);
    // Return generic error — not the success message — only for unexpected server errors
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}