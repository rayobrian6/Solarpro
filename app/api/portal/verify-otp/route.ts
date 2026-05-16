/**
 * POST /api/portal/verify-otp
 *
 * Step 2 of the 2-factor portal login flow:
 *   • Validate email + code
 *   • Rate-limit by IP (separate bucket from /login)
 *   • Hash the submitted code and look it up in portal_otp_tokens
 *   • Verify: not expired, not already used
 *   • Mark used_at = NOW()
 *   • Issue JWT portal session cookie
 */
import { NextRequest, NextResponse }      from 'next/server';
import crypto                             from 'crypto';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp }    from '@/lib/rateLimiter';
import {
  signPortalToken,
  makePortalCookie,
} from '@/lib/portalAuth';

export const maxDuration = 30;
export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function POST(req: NextRequest) {
  // Stricter rate limit for verify step: 10 attempts per 15 minutes per IP
  // (brute-forcing a 6-digit code needs ~500k attempts; 10/15min blocks that)
  const rl = await checkRateLimit('portal_verify_otp', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please wait 15 minutes.' },
      { status: 429 }
    );
  }

  try {
    const body     = await req.json();
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawCode  = typeof body?.code  === 'string' ? body.code.trim().replace(/\s/g, '') : '';

    if (!rawEmail || !rawCode) {
      return NextResponse.json(
        { success: false, error: 'Email and code are required.' },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(rawCode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid code format. Please enter the 6-digit code from your email.' },
        { status: 400 }
      );
    }

    const sql      = await getDbReady();
    const codeHash = hashOtp(rawCode);

    // Join portal_otp_tokens with clients so we can verify the email in one query.
    // This prevents an attacker from using a stolen OTP hash with a different email.
    const rows = await sql`
      SELECT
        t.id         AS token_id,
        c.id         AS client_id,
        c.email,
        c.name,
        t.expires_at,
        t.used_at
      FROM   portal_otp_tokens  t
      JOIN   clients             c ON c.id = t.client_id
      WHERE  t.code_hash  = ${codeHash}
        AND  LOWER(c.email) = ${rawEmail}
        AND  c.deleted_at IS NULL
      LIMIT 1
    `;

    // Generic error — never reveal the specific reason to the client
    const genericError = { success: false, error: 'Invalid or expired code. Please request a new one.' };

    if (rows.length === 0) {
      return NextResponse.json(genericError, { status: 401 });
    }

    const row = rows[0];

    // Already used?
    if (row.used_at !== null) {
      return NextResponse.json(genericError, { status: 401 });
    }

    // Expired?
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json(genericError, { status: 401 });
    }

    // Mark token consumed (single-use)
    await sql`
      UPDATE portal_otp_tokens
      SET    used_at = NOW()
      WHERE  id = ${row.token_id}
    `;

    // Issue portal session JWT cookie
    const token = signPortalToken({
      clientId: row.client_id,
      email:    row.email,
      name:     row.name,
    });

    const response = NextResponse.json({
      success: true,
      message: 'Logged in.',
      name:    row.name,
    });

    response.headers.append('Set-Cookie', makePortalCookie(token));
    return response;

  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/verify-otp]', e);
  }
}
