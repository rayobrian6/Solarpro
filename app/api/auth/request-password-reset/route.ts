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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Still return success shape to avoid email enumeration via error messages
      return NextResponse.json(SUCCESS_RESPONSE);
    }

    const sql = await getDbReady();

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
    const emailResult = await sendPasswordResetEmail(user.email, rawToken);

    if (!emailResult.success) {
      console.error(`[password-reset] Email send failed for userId=${user.id}:`, emailResult.error);
      // Don't expose email failure to client — return success to avoid enumeration
    } else {
      console.log(`[password-reset] Reset email sent to userId=${user.id}`);
    }

    return NextResponse.json(SUCCESS_RESPONSE);

  } catch (error: any) {
    console.error('[password-reset] request-password-reset error:', error?.message);
    // Return generic error — not the success message — only for unexpected server errors
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}