/**
 * POST /api/portal/login
 *
 * Step 1 of the 2-factor portal login flow:
 *   • Validate email format
 *   • Rate-limit by IP
 *   • If client found: generate a 6-digit OTP, hash it with SHA-256, store in
 *     portal_otp_tokens (expires 10 minutes), send via Resend
 *   • Always return { success: true } to prevent email enumeration
 *
 * Step 2 is handled by /api/portal/verify-otp
 */
import { NextRequest, NextResponse }       from 'next/server';
import crypto                              from 'crypto';
import { getDbReady, handleRouteDbError }  from '@/lib/db-neon';
import { checkRateLimit, getClientIp }     from '@/lib/rateLimiter';
import { sendPortalOtpEmail }              from '@/lib/email';

export const maxDuration = 30;
export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';

const OTP_TTL_MINUTES = 10;

/** Constant-time safe 6-digit OTP */
function generateOtp(): string {
  // crypto.randomInt is CSPRNG — not Math.random()
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 attempts per 60s per IP
  const rl = await checkRateLimit('portal_login', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many login attempts. Please wait and try again.' },
      { status: 429 }
    );
  }

  try {
    const body     = await req.json();
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!rawEmail || rawEmail.length > 254) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // Look up client by email — always respond identically to prevent enumeration
    const clients = await sql`
      SELECT id, name, email
      FROM   clients
      WHERE  LOWER(email) = ${rawEmail}
        AND  deleted_at IS NULL
      LIMIT 1
    `;

    if (clients.length > 0) {
      const client     = clients[0];
      const code       = generateOtp();
      const codeHash   = hashOtp(code);
      const expiresAt  = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      // Expire any prior unused codes for this client (one-at-a-time policy)
      await sql`
        UPDATE portal_otp_tokens
        SET    used_at = NOW()
        WHERE  client_id = ${client.id}
          AND  used_at IS NULL
          AND  expires_at > NOW()
      `;

      // Insert new OTP row
      await sql`
        INSERT INTO portal_otp_tokens (client_id, code_hash, expires_at)
        VALUES (${client.id}, ${codeHash}, ${expiresAt})
      `;

      // Fire email — non-fatal; if it fails we still return success=true
      // so the rate-limiter is the only protection needed
      void sendPortalOtpEmail({
        to:        client.email,
        name:      client.name,
        code,
        expiresIn: `${OTP_TTL_MINUTES} minutes`,
      }).catch(err => console.error('[portal/login] OTP email error:', err));
    }

    // Always return the same shape — never reveal whether the email exists
    return NextResponse.json({
      success: true,
      message: 'If an account was found, a login code has been sent to your email.',
    });

  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/login]', e);
  }
}
