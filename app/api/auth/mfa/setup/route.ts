// app/api/auth/mfa/setup/route.ts
// MFA enrollment endpoint for TOTP-based multi-factor authentication.
// Supports POL-SEC-009 (Password & Authentication Policy)
//
// FLOW:
//   POST — Generate TOTP secret, store encrypted secret, return enrollment URI
//          Recovery codes are NOT generated here (timing fix — see PUT)
//   PUT  — Verify first TOTP code, generate recovery codes, enable MFA,
//          issue full session (for enrollment-required flow), clear enrollment cookie
//
// RECOVERY CODE TIMING FIX:
//   Previously, recovery codes were generated on POST (before TOTP proof-of-possession).
//   If the user abandoned enrollment, valid recovery codes sat in the DB unused but valid.
//   Now recovery codes are generated on PUT (after TOTP verification succeeds), ensuring
//   they are only created when the user has proven possession of the TOTP secret.

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserFromRequest, verifyMFAEnrollmentPendingToken,
  MFA_ENROLLMENT_PENDING_COOKIE,
  signToken, COOKIE_NAME, COOKIE_MAX_AGE, SessionUser,
} from '@/lib/auth';
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
import { isProduction } from '@/lib/env';

const TOTP_DIGITS = 6;

/**
 * Resolves the authenticated user for MFA setup.
 * Accepts either:
 *   1. A full session cookie (solarpro_session) — normal in-app enrollment
 *   2. An MFA enrollment pending cookie (solarpro_mfa_enroll_pending) — enrollment-required flow
 *
 * The enrollment pending cookie is a RESTRICTED credential that ONLY authorizes
 * MFA setup. It does NOT grant access to any other API or page.
 */
function getUserForMFASetup(req: NextRequest): { id: string; name: string; email: string; company?: string; role?: string; source: 'session' | 'enrollment_pending' } | null {
  // Try full session first (normal in-app enrollment)
  const sessionUser = getUserFromRequest(req);
  if (sessionUser?.id) {
    return { ...sessionUser, source: 'session' };
  }

  // Try MFA enrollment pending token (enrollment-required flow)
  const enrollCookie = req.cookies.get(MFA_ENROLLMENT_PENDING_COOKIE)?.value;
  if (enrollCookie) {
    const enrollUser = verifyMFAEnrollmentPendingToken(enrollCookie);
    if (enrollUser?.id) {
      return { ...enrollUser, source: 'enrollment_pending' };
    }
  }

  return null;
}



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

  const user = getUserForMFASetup(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required for MFA setup' }, { status: 401 });
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

    // Store encrypted TOTP secret (MFA not yet enabled — requires verification)
    // Recovery codes are NOT generated here — they are generated on PUT after
    // TOTP proof-of-possession. This fixes the timing issue where codes were
    // previously created before the user verified their authenticator.
    await sql`
      UPDATE users SET
        mfa_secret_encrypted = ${encryptedSecret},
        mfa_method = 'totp'
      WHERE id = ${user.id}
    `;

    // Clean up any stale recovery codes from a previous abandoned setup attempt
    try {
      await sql`
        DELETE FROM mfa_recovery_codes
        WHERE user_id = ${user.id} AND used = false
      `;
    } catch {
      // mfa_recovery_codes table might not exist yet — non-critical
      console.warn('[MFA_SETUP] Could not clean up stale recovery codes — table may not exist');
    }

    await auditAuth(
      'mfa_setup_initiated',
      `MFA enrollment initiated for user ${dbUser.email}`,
      { actor_id: user.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/setup' },
      { mfa_method: 'totp' },
    );

    // Return the TOTP URI and secret (NO recovery codes yet)
    // Recovery codes are returned after PUT verifies TOTP proof-of-possession
    return NextResponse.json({
      uri,
      secret,          // Shown for manual entry if QR scan fails
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

  const user = getUserForMFASetup(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required for MFA setup' }, { status: 401 });
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

    // ── Generate recovery codes AFTER TOTP proof-of-possession ──────
    // Timing fix: recovery codes are only created after the user has
    // successfully verified a TOTP code, proving they control the authenticator.
    // This prevents abandoned setup attempts from leaving valid codes in the DB.
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = recoveryCodes.map(hashRecoveryCode);

    // Store hashed recovery codes in mfa_recovery_codes table
    try {
      // Clean up any stale codes first (abandoned previous setup)
      await sql`
        DELETE FROM mfa_recovery_codes
        WHERE user_id = ${user.id} AND used = false
      `;
      for (const codeHash of hashedRecoveryCodes) {
        await sql`
          INSERT INTO mfa_recovery_codes (user_id, code_hash, used, created_at)
          VALUES (${user.id}, ${codeHash}, false, NOW())
        `;
      }
    } catch {
      // If mfa_recovery_codes table doesn't exist yet, log warning
      // The migration 100 should create this table
      console.warn('[MFA_SETUP] Recovery codes table not found — run migration 100');
    }

    await auditAuth(
      'mfa_enabled',
      `MFA successfully enabled for user ${dbUser.email}`,
      { actor_id: user.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/setup' },
      { mfa_method: 'totp' },
    );

    const response = NextResponse.json({
      success: true,
      message: 'MFA has been enabled for your account.',
      recovery_codes: recoveryCodes,  // ⚠️ Shown only once — frontend must display and prompt save
    });

    // ── For enrollment-required flow: issue full session + clear enrollment cookie ──
    if (user.source === 'enrollment_pending') {
      // Issue a full session cookie so the user can access the application
      const sessionUser: SessionUser = {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        company: dbUser.company || undefined,
      };
      const token = signToken(sessionUser);
      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'lax' as const,
        path: '/',
        maxAge: COOKIE_MAX_AGE,
      });

      // Clear the enrollment pending cookie (single-use, no longer needed)
      response.cookies.set(MFA_ENROLLMENT_PENDING_COOKIE, '', {
        path: '/api/auth/mfa',
        maxAge: 0,
      });
    }

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MFA_SETUP_VERIFY_ERROR]', msg);
    return NextResponse.json({ error: 'MFA verification failed' }, { status: 500 });
  }
}
