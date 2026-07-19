export const dynamic    = 'force-dynamic';
export const revalidate = 0;
export const runtime    = 'nodejs';
// Explicit maxDuration prevents Vercel from killing this function during
// DB cold-start retries. Auth routes need up to ~9s for retries + query.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import {
  getDbReady, verifyPassword, signToken, COOKIE_NAME, COOKIE_MAX_AGE, SessionUser,
  signMFAPendingToken, MFA_PENDING_COOKIE, MFA_PENDING_MAX_AGE,
  signMFAEnrollmentPendingToken, MFA_ENROLLMENT_PENDING_COOKIE, MFA_ENROLLMENT_PENDING_MAX_AGE,
} from '@/lib/auth';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { auditAuth, auditSecurity } from '@/lib/auditLog';
import { isMFARequiredButNotEnabled } from '@/lib/mfa';

// PHASE 5: Log auth secret fingerprint on first invocation (not the secret itself)
// This confirms the secret is stable and consistent across deployments.
let _secretFingerprintLogged = false;
function logSecretFingerprint() {
  if (_secretFingerprintLogged) return;
  _secretFingerprintLogged = true;
  try {
    const secret = process.env.JWT_SECRET || '';
    // Simple fingerprint: length + first 4 chars + last 4 chars + char sum mod 9999
    const charSum = secret.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 9999;
    const fingerprint = `len=${secret.length}_head=${secret.substring(0,4)}_tail=${secret.slice(-4)}_sum=${charSum}`;
    // Secret fingerprint computed (not logged in production)
  } catch {
    // Fingerprint computation failed
  }
}

export async function POST(req: NextRequest) {
  logSecretFingerprint();
  try {
    // v48.6: Rate limiting — 5 req / 60s per IP (brute-force protection)
        const rl = await checkRateLimit('login', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many login attempts. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const body = await req.json();

    // ── Dev auth bypass (admin/admin → super_admin) ─────────────────────────
    // Cosmetic: lets you type into the login form instead of being auto-logged in.
    // Active only when DEV_AUTH_BYPASS=true AND VERCEL_ENV !== 'production'.
    // Checked BEFORE Zod validation so 'admin' (no @) is accepted.
    {
      const { isDevAuthAllowed, getDevMeResponse } = await import('@/lib/dev-auth');
      const rawEmail   = typeof body?.email   === 'string' ? body.email.toLowerCase().trim() : '';
      const rawPass    = typeof body?.password === 'string' ? body.password : '';
      if (isDevAuthAllowed() && rawEmail === 'admin' && rawPass === 'admin') {
        const token = await signToken({
          id:    'dev-user-bypass-001',
          email: 'admin@localhost',
          name:  'Admin (Dev Bypass)',
        } as SessionUser);
        const res = NextResponse.json(getDevMeResponse(), {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma':        'no-cache',
            'Expires':       '0',
          },
        });
        res.cookies.set(COOKIE_NAME, token, {
          httpOnly: true,
          secure:   process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path:     '/',
          maxAge:   COOKIE_MAX_AGE,
        });
        console.log('[DEV_AUTH_LOGIN] admin/admin accepted, super_admin session issued');
        return res;
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Zod schema validation
    const { loginSchema, parseBody } = await import('@/lib/validation');
    const { data: parsed, error: validationError } = parseBody(loginSchema, body);
    if (validationError || !parsed) {
      return NextResponse.json(
        { success: false, error: validationError || 'Email and password are required.' },
        { status: 400 }
      );
    }

    const { email, password } = parsed;

    // ── DB with cold-start retry ──────────────────────────────────────────
    const sql = await getDbReady();

    // ── Fetch user ────────────────────────────────────────────────────────
    const rows = await sql`
      SELECT id, name, email, password_hash, company, phone, role, is_free_pass,
             mfa_enabled, mfa_method
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (rows.length === 0) {
      // [AUTH_DEBUG] user not found
      console.log('[AUTH_DEBUG]', JSON.stringify({
        email:         email.toLowerCase().trim(),
        userFound:     false,
        hashPrefix:    null,
        hashLen:       0,
        hashFormat:    null,
        compareResult: false,
        requiresReset: false,
      }));
      // Compliance audit log: failed login attempt
      await auditAuth('login_failure', `Failed login attempt for ${email.toLowerCase().trim()}`, {
        actor_email: email.toLowerCase().trim(),
        ip_address: getClientIp(req),
        request_path: '/api/auth/login',
      }, { reason: 'user_not_found' });
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const user = rows[0];

    // [AUTH_DEBUG] structured log — temporary diagnostic (safe: no PII values, only metadata)
    const verifyResult = await verifyPassword(password, user.password_hash, { extended: true });
    console.log('[AUTH_DEBUG]', JSON.stringify({
      email:         user.email,
      userFound:     true,
      hashPrefix:    user.password_hash ? user.password_hash.slice(0, 10) : null,
      hashLen:       user.password_hash?.length ?? 0,
      hashFormat:    verifyResult.hashFormat,
      compareResult: verifyResult.valid,
      requiresReset: verifyResult.requiresReset ?? false,
    }));

    if (verifyResult.requiresReset) {
      // Legacy/non-bcrypt hash detected. User must reset their password.
      // DO NOT silently reset or block — return a clear, actionable message.
      return NextResponse.json(
        {
          success: false,
          error: 'Your account requires a password reset. Please use "Forgot Password" to set a new password.',
          code: 'LEGACY_HASH_RESET_REQUIRED',
        },
        { status: 401 }
      );
    }

    if (!verifyResult.valid) {
      // ── SAFETY NET B: free-pass orphaned hash ─────────────────────────────
      // If a free-pass user's password fails AND their hash is a valid-looking
      // bcrypt that isLegacyHash() cannot detect (e.g. bcrypt of a random
      // secret), they're permanently locked out with no path forward.
      //
      // Rule: free-pass accounts that have NEVER had a real user-initiated
      // password set should NOT silently return "Invalid email or password".
      // They should be directed to Forgot Password.
      //
      //
      // Safety Net B: only redirect to password reset if the hash is still
      // Detection heuristic: is_free_pass=true AND password_hash is still a
      // cost-10 placeholder (set by migration scripts). If the user has already
      // set a real bcrypt-12 password, a wrong password attempt returns the
      // standard "Invalid email or password" — not a forced reset.
      // ──────────────────────────────────────────────────────────────────────
      if (user.is_free_pass === true &&
          /^\$2[aby]\$10\$/.test(user.password_hash || '')) {
        console.warn('[AUTH_SAFETY_NET_B] Free-pass user failed password check — returning reset prompt instead of generic failure', {
          userId:      user.id,
          hashFormat:  verifyResult.hashFormat,
          hashPrefix:  user.password_hash?.slice(0, 10),
        });

        // Compliance audit log: free-pass account needs password reset
        await auditAuth('login_failure', `Free-pass account password reset required for ${user.email}`, {
          actor_id: user.id,
          actor_email: user.email,
          ip_address: getClientIp(req),
          request_path: '/api/auth/login',
        }, { reason: 'legacy_hash_reset_required', is_free_pass: true });

        return NextResponse.json(
          {
            success: false,
            error: 'Your account requires a password reset. Please use "Forgot Password" to set a new password.',
            code: 'LEGACY_HASH_RESET_REQUIRED',
          },
          { status: 401 }
        );
      }

      // Compliance audit log: failed login — invalid password
      await auditAuth('login_failure', `Failed login attempt for ${user.email}`, {
        actor_id: user.id,
        actor_email: user.email,
        ip_address: getClientIp(req),
        request_path: '/api/auth/login',
      }, { reason: 'invalid_password' });

      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // ── MFA enforcement check ──────────────────────────────────────────
    // Per POL-SEC-009, admin/staff accounts MUST have MFA enabled.
    // If MFA is required but not enabled, require enrollment before login.
    if (isMFARequiredButNotEnabled(user.role, user.mfa_enabled)) {
      // Compliance audit log: MFA enrollment required but not enabled
      await auditSecurity('mfa_enrollment_required', `MFA enrollment required for ${user.email} (role: ${user.role})`, {
        actor_id: user.id,
        actor_email: user.email,
        ip_address: getClientIp(req),
        request_path: '/api/auth/login',
      });

      // Issue a restricted enrollment pending credential.
      // This is NOT a full session — it only authorizes MFA enrollment.
      // The user cannot access projects, settings, billing, or any other API.
      const enrollToken = signMFAEnrollmentPendingToken({
        id: user.id, name: user.name, email: user.email,
        company: user.company || undefined, role: user.role,
      });
      const enrollResponse = NextResponse.json(
        {
          success: false,
          error: 'MFA enrollment is required for your account. Please enable MFA to continue.',
          code: 'MFA_ENROLLMENT_REQUIRED',
        },
        { status: 403 }
      );
      enrollResponse.cookies.set(MFA_ENROLLMENT_PENDING_COOKIE, enrollToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path:     '/api/auth/mfa',
        maxAge:   MFA_ENROLLMENT_PENDING_MAX_AGE,
      });
      return enrollResponse;
    }

    // If user has MFA enabled, require MFA verification after password success
    if (user.mfa_enabled) {
      // Compliance audit log: MFA challenge issued
      await auditAuth('mfa_challenge_issued', `MFA challenge issued for ${user.email}`, {
        actor_id: user.id,
        actor_email: user.email,
        ip_address: getClientIp(req),
        request_path: '/api/auth/login',
      }, { mfa_method: user.mfa_method || 'totp' });

      // Issue a short-lived MFA pending token so the verify route can identify the user.
      // This token does NOT grant application access (mfa_pending flag).
      const mfaToken = signMFAPendingToken({
        id: user.id, name: user.name, email: user.email,
        company: user.company || undefined, role: user.role, mfa_method: user.mfa_method || 'totp',
      });
      const mfaResponse = NextResponse.json(
        {
          success: false,
          error: 'MFA verification required.',
          code: 'MFA_REQUIRED',
          mfa_method: user.mfa_method || 'totp',
        },
        { status: 200 }
      );
      mfaResponse.cookies.set(MFA_PENDING_COOKIE, mfaToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path:     '/api/auth/mfa',
        maxAge:   MFA_PENDING_MAX_AGE,
      });
      return mfaResponse;
    }

    // JWT contains ONLY identity — role is NOT included
    const sessionUser: SessionUser = {
      id:      user.id,
      name:    user.name,
      email:   user.email,
      company: user.company || undefined,
    };

    const token = signToken(sessionUser);

    // Compliance audit log: successful login
    await auditAuth('login_success', `Successful login for ${sessionUser.email}`, {
      actor_id: sessionUser.id,
      actor_email: sessionUser.email,
      ip_address: getClientIp(req),
      request_path: '/api/auth/login',
    });

    // ── FIX: Use response.cookies.set() — the Next.js 14 App Router
    // canonical API. Using headers: { 'Set-Cookie': string } is unreliable
    // on Vercel because the edge proxy merges response headers AFTER the
    // function returns, and the raw Set-Cookie header can be silently
    // dropped or corrupted during that merge. response.cookies.set() goes
    // through the Next.js ResponseCookies API which is handled correctly
    // by the runtime before the proxy layer touches the response.
    const response = NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: user.role || 'user' } } },
      { status: 200 }
    );

    const cookieOptions = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path:     '/',
      maxAge:   COOKIE_MAX_AGE, // 30 days in seconds
      // domain intentionally omitted — let browser derive from request origin
    };

    response.cookies.set(COOKIE_NAME, token, cookieOptions);

    // PHASE 1: Structured cookie diagnostic log
    const setCookieHeader = response.headers.get('set-cookie');
    console.log('[AUTH_COOKIE_SET]', JSON.stringify({
      cookieName:          COOKIE_NAME,
      hasSetCookieHeader:  !!setCookieHeader,
      setCookiePresent:    setCookieHeader ? true : false,
      secure:              cookieOptions.secure,
      sameSite:            cookieOptions.sameSite,
      path:                cookieOptions.path,
      domain:              'omitted',
      maxAge:              cookieOptions.maxAge,
      nodeEnv:             process.env.NODE_ENV,
    }));

    // SECURITY FIX: Removed email from log — PII must not appear in server logs
    console.log(`[AUTH_LOGIN_SUCCESS] userId=${sessionUser.id} cookie=${COOKIE_NAME} set via response.cookies.set()`);

    return response;

  } catch (error: unknown) {
    const msg = (error as Error)?.message || String(error);

    if (error instanceof DbConfigError) {
      console.error('[AUTH_DB_CONFIG_ERROR] /api/auth/login: DATABASE_URL not configured:', msg);
      console.error(
        '[AUTH_DB_CONFIG_ERROR] Fix: Vercel Dashboard -> Project -> Settings -> Environment Variables\n' +
        '  -> Add: DATABASE_URL = <your Neon connection string>\n' +
        '  -> Add: JWT_SECRET = <random 64-char string>\n' +
        '  -> Check ALL THREE environments: Production, Preview, Development\n' +
        '  -> Then redeploy (env vars are NOT hot-reloaded)'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error — authentication database is not connected.',
          hint: 'DATABASE_URL and JWT_SECRET must be set in Vercel environment variables.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    const classified = isTransientDbError(error) ? 'transient' : 'unknown-defaulting-to-transient';
    console.warn(`[AUTH_DB_STARTING] /api/auth/login: DB error [${classified}]:`, msg);
    return NextResponse.json(
      {
        success: false,
        error: 'Server is starting up — please wait a moment and try again.',
        code: 'DB_STARTING',
        retryAfterMs: 3000,
      },
      {
        status: 503,
        headers: { 'Retry-After': '3' },
      }
    );
  }
}