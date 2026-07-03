// app/api/auth/mfa/setup/route.ts
// MFA enrollment endpoint for TOTP-based multi-factor authentication.
// Supports POL-SEC-009 (Password & Authentication Policy)
//
// FLOW:
//   POST — Generate TOTP secret, return enrollment URI + recovery codes
//   PUT  — Verify first TOTP code to complete enrollment (enable MFA)

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbWithRetry } from '@/lib/db-ready';
import {
  generateTOTPSecret,
  encryptTOTPSecret,
  generateTOTPUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTOTPCode,
  decryptTOTPSecret,
} from '@/lib/mfa';
import { auditAuth } from '@/lib/auditLog';
import { getClientIp, checkRateLimit } from '@/lib/rateLimiter';

const TOTP_DIGITS = 6;

// ─── POST /api/auth/mfa/setup ────────────────────────────────────────────
// Step 1: Generate a new TOTP secret and return the enrollment URI.
// The user scans this URI with their authenticator app.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit('mfa_setup', ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many MFA setup attempts. Please wait before trying again.' },
      { status: 429 }
    );
  }

  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const sql = await getDbWithRetry();

    // Fetch current user state
    const rows = await sql`
      SELECT id, email, role, mfa_enabled FROM users WHERE id = ${user.id}
    `;
    const dbUser = rows[0] as any;
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (dbUser.mfa_enabled) {
      return NextResponse.json(
        { error: 'MFA is already enabled. Disable it first to re-enroll.' },
        { status: 400 }
      );
    }

    // Generate new TOTP secret
    const secret = generateTOTPSecret();
    const encryptedSecret = encryptTOTPSecret(secret);
    const uri = generateTOTPUri(secret, dbUser.email);

    // Generate recovery codes (single-use, one-way hashed for storage)
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = recoveryCodes.map(hashRecoveryCode);

    // Store encrypted TOTP secret (MFA not yet enabled — requires verification)
    await sql`
      UPDATE users SET
        mfa_secret_encrypted = ${encryptedSecret},
        mfa_method = 'totp'
      WHERE id = ${user.id}
    `;

    // Store hashed recovery codes in mfa_recovery_codes table
    try {
      for (const codeHash of hashedRecoveryCodes) {
        await sql`
          INSERT INTO mfa_recovery_codes (user_id, code_hash, used, created_at)
          VALUES (${user.id}, ${codeHash}, false, NOW())
        `;
      }
    } catch {
      // If mfa_recovery_codes table doesn't exist yet, log warning
      // The migration 024 should create this table
      console.warn('[MFA_SETUP] Recovery codes table not found — run migration 024');
    }

    await auditAuth(
      'mfa_setup_initiated',
      `MFA enrollment initiated for user ${dbUser.email}`,
      { actor_id: user.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/setup' },
      { mfa_method: 'totp' },
    );

    // Return the TOTP URI and recovery codes
    // ⚠️ Recovery codes are shown only once — user must save them
    return NextResponse.json({
      uri,
      secret,          // Shown for manual entry if QR scan fails
      recovery_codes: recoveryCodes,  // ⚠️ Show only once!
      message: 'Scan the QR code with your authenticator app, then verify with a code to complete setup.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MFA_SETUP_ERROR]', msg);
    return NextResponse.json({ error: 'MFA setup failed' }, { status: 500 });
  }
}

// ─── PUT /api/auth/mfa/setup ────────────────────────────────────────────
// Step 2: Verify the first TOTP code to complete MFA enrollment.
// Only after this step is MFA actually enabled on the account.
export async function PUT(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit('mfa_setup', ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many MFA setup attempts. Please wait before trying again.' },
      { status: 429 }
    );
  }

  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { code } = body;

    if (!code || typeof code !== 'string' || code.length !== TOTP_DIGITS) {
      return NextResponse.json(
        { error: `A ${TOTP_DIGITS}-digit code is required` },
        { status: 400 }
      );
    }

    const sql = await getDbWithRetry();
    const rows = await sql`
      SELECT id, email, role, mfa_enabled, mfa_secret_encrypted
      FROM users WHERE id = ${user.id}
    `;
    const dbUser = rows[0] as any;

    if (!dbUser?.mfa_secret_encrypted) {
      return NextResponse.json(
        { error: 'MFA setup not initiated. Call POST first.' },
        { status: 400 }
      );
    }

    if (dbUser.mfa_enabled) {
      return NextResponse.json({ error: 'MFA is already enabled.' }, { status: 400 });
    }

    // Decrypt and verify TOTP code
    const secret = decryptTOTPSecret(dbUser.mfa_secret_encrypted);
    const valid = verifyTOTPCode(secret, code);

    if (!valid) {
      await auditAuth(
        'mfa_challenge_failure',
        `MFA verification failed during enrollment for ${dbUser.email}`,
        { actor_id: user.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/setup' },
      );
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    // Enable MFA on the account
    await sql`
      UPDATE users SET
        mfa_enabled = true,
        mfa_enrolled_at = NOW(),
        mfa_verified_at = NOW()
      WHERE id = ${user.id}
    `;

    await auditAuth(
      'mfa_enabled',
      `MFA successfully enabled for user ${dbUser.email}`,
      { actor_id: user.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/setup' },
      { mfa_method: 'totp' },
    );

    return NextResponse.json({
      success: true,
      message: 'MFA has been enabled for your account.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MFA_SETUP_VERIFY_ERROR]', msg);
    return NextResponse.json({ error: 'MFA verification failed' }, { status: 500 });
  }
}
