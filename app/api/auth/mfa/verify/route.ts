// app/api/auth/mfa/verify/route.ts
// MFA verification endpoint — called during login for MFA-enrolled users.
// Supports POL-SEC-009 (Password & Authentication Policy)
//
// FLOW:
//   1. Login route verifies password → issues short-lived MFA pending cookie
//   2. Frontend prompts user for TOTP code → calls this endpoint
//   3. This endpoint validates TOTP/recovery code against MFA pending cookie
//   4. On success: issues full session cookie, clears MFA pending cookie

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyMFAPendingToken, signToken, COOKIE_NAME, COOKIE_MAX_AGE, SessionUser,
  MFA_PENDING_COOKIE,
} from '@/lib/auth';
import { getDbWithRetry } from '@/lib/db-ready';
import { verifyTOTPCode, decryptTOTPSecret, verifyRecoveryCode } from '@/lib/mfa';
import { auditAuth, auditSecurity } from '@/lib/auditLog';
import { getClientIp, checkRateLimit } from '@/lib/rateLimiter';
import { isProduction } from '@/lib/env';

// ─── POST /api/auth/mfa/verify ────────────────────────────────────────────
// Verify a TOTP code or recovery code for an MFA-enrolled user.
// This endpoint is called after successful password authentication
// when the user has MFA enabled.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit('mfa_verify', ip);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // ── Extract MFA pending token from cookie ───────────────────────────
  // This is the short-lived token issued by the login route after
  // password verification succeeded. It identifies the user but does
  // NOT grant application access (mfa_pending = true flag).
  const mfaCookie = req.cookies.get(MFA_PENDING_COOKIE)?.value;
  if (!mfaCookie) {
    return NextResponse.json(
      { error: 'MFA session expired. Please log in again.' },
      { status: 401 }
    );
  }

  const mfaPending = verifyMFAPendingToken(mfaCookie);
  if (!mfaPending) {
    return NextResponse.json(
      { error: 'MFA session expired or invalid. Please log in again.' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const { code, recovery_code } = body;

    const sql = await getDbWithRetry();
    const rows = await sql`
      SELECT id, name, email, company, role, mfa_enabled, mfa_secret_encrypted, mfa_method
      FROM users WHERE id = ${mfaPending.id}
    `;
    const dbUser = rows[0] as any;

    if (!dbUser?.mfa_enabled) {
      return NextResponse.json(
        { error: 'MFA is not enabled for this account' },
        { status: 400 }
      );
    }

    // ─── Recovery code verification (atomic consume) ──────────────
    // Race-condition fix: SELECT candidate hashes, match in JS (timing-safe),
    // then atomically UPDATE WHERE id=X AND used=false RETURNING id.
    // If RETURNING returns nothing, another concurrent request already consumed it.
    if (recovery_code) {
      try {
        const recoveryRows = await sql`
          SELECT id, code_hash FROM mfa_recovery_codes
          WHERE user_id = ${mfaPending.id} AND used = false
        `;

        let matchedRowId: number | null = null;

        for (const row of recoveryRows as any[]) {
          if (verifyRecoveryCode(recovery_code, row.code_hash)) {
            matchedRowId = row.id;
            break; // Stop after first match — codes are unique
          }
        }

        if (matchedRowId !== null) {
          // Atomically mark recovery code as used.
          // WHERE used = false prevents double-use if another request
          // consumed this code between our SELECT and UPDATE.
          const consumeResult = await sql`
            UPDATE mfa_recovery_codes
            SET used = true, used_at = NOW()
            WHERE id = ${matchedRowId}
              AND user_id = ${mfaPending.id}
              AND used = false
            RETURNING id
          `;

          if ((consumeResult as any[]).length === 0) {
            // Code was consumed by a concurrent request between SELECT and UPDATE
            await auditAuth(
              'mfa_recovery_code_failed',
              `MFA recovery code race condition — code already consumed for user ${dbUser.email}`,
              { actor_id: mfaPending.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/verify' },
              { method: 'recovery_code', reason: 'already_consumed' },
            );
            return NextResponse.json(
              { error: 'Recovery code already used. Please try another or log in again.' },
              { status: 400 },
            );
          }

          await auditAuth(
            'mfa_recovery_code_used',
            `MFA recovery code used for user ${dbUser.email}`,
            { actor_id: mfaPending.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/verify' },
            { method: 'recovery_code' },
          );

          // Issue full session on recovery code success
          const sessionUser: SessionUser = {
            id: dbUser.id, name: dbUser.name, email: dbUser.email,
            company: dbUser.company || undefined,
          };
          const token = signToken(sessionUser);
          const response = NextResponse.json({
            success: true,
            message: 'Recovery code accepted. Please enroll a new authenticator device.',
            should_reenroll: true,
            data: { user: { ...sessionUser, role: dbUser.role } },
          });
          response.cookies.set(COOKIE_NAME, token, {
            httpOnly: true, secure: isProduction(),
            sameSite: 'lax' as const, path: '/', maxAge: COOKIE_MAX_AGE,
          });
          // Clear MFA pending cookie
          response.cookies.set(MFA_PENDING_COOKIE, '', { path: '/api/auth/mfa', maxAge: 0 });
          return response;
        }
      } catch {
        // mfa_recovery_codes table might not exist yet
        console.warn('[MFA_VERIFY] Recovery codes table not available');
      }

      await auditAuth(
        'mfa_recovery_code_failed',
        `Invalid recovery code for user ${dbUser.email}`,
        { actor_id: mfaPending.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/verify' },
        { method: 'recovery_code' },
      );

      return NextResponse.json({ error: 'Invalid recovery code' }, { status: 400 });
    }

    // ─── TOTP verification ──────────────────────────────────────────
    if (!code || typeof code !== 'string' || code.length !== 6) {
      return NextResponse.json({ error: 'A 6-digit code is required' }, { status: 400 });
    }

    if (!dbUser.mfa_secret_encrypted) {
      return NextResponse.json(
        { error: 'MFA secret not found. Please re-enroll.' },
        { status: 400 }
      );
    }

    const secret = decryptTOTPSecret(dbUser.mfa_secret_encrypted);
    const valid = verifyTOTPCode(secret, code);

    if (!valid) {
      await auditAuth(
        'mfa_challenge_failure',
        `MFA verification failed for user ${dbUser.email}`,
        { actor_id: mfaPending.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/verify' },
        { method: 'totp' },
      );

      // Invalidate MFA pending token after too many failures
      await auditSecurity(
        'mfa_failure',
        `MFA TOTP failure for ${dbUser.email}`,
        { actor_id: mfaPending.id, actor_email: dbUser.email, ip_address: ip },
      );

      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    // ── MFA verification successful ───────────────────────────────────
    // Update last verified timestamp
    await sql`
      UPDATE users SET mfa_verified_at = NOW() WHERE id = ${mfaPending.id}
    `;

    await auditAuth(
      'mfa_challenge_success',
      `MFA verification successful for user ${dbUser.email}`,
      { actor_id: mfaPending.id, actor_email: dbUser.email, actor_role: dbUser.role, ip_address: ip, request_path: '/api/auth/mfa/verify' },
      { method: 'totp' },
    );

    // Issue full session token — MFA is complete, user is fully authenticated
    const sessionUser: SessionUser = {
      id: dbUser.id, name: dbUser.name, email: dbUser.email,
      company: dbUser.company || undefined,
    };
    const token = signToken(sessionUser);
    const response = NextResponse.json({
      success: true,
      message: 'MFA verification successful.',
      data: { user: { ...sessionUser, role: dbUser.role } },
    });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true, secure: isProduction(),
      sameSite: 'lax' as const, path: '/', maxAge: COOKIE_MAX_AGE,
    });
    // Clear MFA pending cookie (single-use)
    response.cookies.set(MFA_PENDING_COOKIE, '', { path: '/api/auth/mfa', maxAge: 0 });

    return response;

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MFA_VERIFY_ERROR]', msg);
    return NextResponse.json({ error: 'MFA verification failed' }, { status: 500 });
  }
}
