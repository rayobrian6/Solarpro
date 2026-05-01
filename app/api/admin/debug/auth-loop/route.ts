// ============================================================================
// GET /api/admin/debug/auth-loop
//
// The sharpest possible diagnostic for the "login succeeds then instantly
// bounces back to /login" class of bug. Performs the entire sign -> verify
// cycle in a single request and reports whether it succeeded. If sign works
// but verify fails in the same function invocation, the JWT_SECRET is
// self-inconsistent at runtime (unlikely), schema version drift, or a
// mismatched algorithm. If sign/verify both work but real login still
// bounces, the bug is in cookie transmission (Set-Cookie header lost,
// cross-domain issue, Secure/SameSite misconfig, etc), NOT in the secret.
//
// GATE: requireAdminApi()
//
// ALSO: returns a STABLE fingerprint of the JWT_SECRET (length + first/last
// 4 chars + sum mod 9999). The fingerprint is deterministic per secret, but
// cryptographically useless on its own -- you cannot recover the secret
// from it. Safe to return to an admin caller.
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { signToken, verifyToken } from '@/lib/auth';

function fingerprint(secret: string): string {
  if (!secret) return 'EMPTY';
  const sum = secret.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 9999;
  return `len=${secret.length}_head=${secret.slice(0, 4)}_tail=${secret.slice(-4)}_sum=${sum}`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const secret = process.env.JWT_SECRET || '';
  const fp     = fingerprint(secret);

  // Sign a test token for a fake user
  const testUser = {
    id:      'debug-loop-user-id',
    name:    'Debug',
    email:   'debug@solarpro.solutions',
    company: undefined,
  };

  let signedToken: string;
  let signError: string | null = null;
  try {
    signedToken = signToken(testUser);
  } catch (err) {
    signedToken = '';
    signError = (err as Error)?.message || 'sign failed';
  }

  // Attempt verify IN THE SAME REQUEST -- same process, same env
  let verified: unknown = null;
  let verifyError: string | null = null;
  if (signedToken) {
    try {
      verified = verifyToken(signedToken);
    } catch (err) {
      verifyError = (err as Error)?.message || 'verify threw';
    }
  }

  // Also verify the caller's REAL session cookie -- if this fails but the
  // fake one works, the caller's cookie was signed with a different secret
  // (e.g. before a JWT_SECRET rotation)
  const realCookie = req.headers.get('cookie') || '';
  const realMatch  = realCookie.match(/solarpro_session=([^;]+)/);
  const realToken  = realMatch ? realMatch[1] : null;
  let realVerified: unknown = null;
  let realVerifyError: string | null = null;
  if (realToken) {
    try {
      realVerified = verifyToken(realToken);
    } catch (err) {
      realVerifyError = (err as Error)?.message || 'real verify threw';
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp_utc: new Date().toISOString(),
    secret: {
      present:     !!secret,
      fingerprint: fp,
      // NO value returned
    },
    roundtrip_test: {
      sign_ok:        !!signedToken,
      sign_error:     signError,
      verify_ok:      verified !== null,
      verify_error:   verifyError,
      // first 16 chars of token (header + start of payload) - safe because
      // all we learn is the algorithm + issuer metadata
      token_preview:  signedToken.slice(0, 16),
    },
    caller_cookie_test: {
      cookie_present:  !!realToken,
      verify_ok:       realVerified !== null,
      verify_error:    realVerifyError,
      // Safe: we already auth'd the caller, so we can confirm their own id
      verified_id:     realVerified && typeof realVerified === 'object' && 'id' in realVerified
                         ? String((realVerified as { id: unknown }).id)
                         : null,
    },
    env: {
      NODE_ENV:              process.env.NODE_ENV || null,
      VERCEL_ENV:            process.env.VERCEL_ENV || null,
      VERCEL_REGION:         process.env.VERCEL_REGION || null,
      VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    },
    caller_role: admin.role,
  });
}