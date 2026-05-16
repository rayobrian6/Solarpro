// ============================================================================
// GET /api/admin/debug/auth-status
//
// Diagnostic endpoint for login instability issues.
//
// Performs a full auth cycle check in a single request:
//   1. Verify JWT_SECRET is set and stable
//   2. Check DATABASE_URL is configured
//   3. Look up user by email (optional ?email= param)
//   4. Verify password hash (optional ?password= param — dev only, never use in prod)
//   5. Verify cookie is present in request
//   6. Check for duplicate user rows
//   7. Sign + verify a test JWT to confirm secret is self-consistent
//
// Returns:
//   {
//     "jwtSecretSet":     true,
//     "jwtSecretFingerprint": "len=64_head=abcd_tail=efgh_sum=1234",
//     "jwtSignVerifyOk": true,
//     "databaseUrlSet":  true,
//     "cookiePresent":   true,
//     "userExists":      true,       // only if ?email= provided
//     "duplicateUsers":  false,      // only if ?email= provided
//     "passwordValid":   true,       // only if ?email= + ?password= provided (dev only)
//     "cookieName":      "solarpro_session",
//     "cookieOptions": { httpOnly, secure, sameSite, path, maxAge },
//     "nodeEnv":         "production"
//   }
//
// GATE: requireAdminApi()
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { signToken, verifyToken, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import bcrypt from 'bcryptjs';

function secretFingerprint(secret: string): string {
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

  const url   = new URL(req.url);
  const email = url.searchParams.get('email') ?? null;
  // password check is ONLY available in non-production environments
  const password = process.env.NODE_ENV !== 'production'
    ? url.searchParams.get('password') ?? null
    : null;

  const result: Record<string, unknown> = {
    nodeEnv:         process.env.NODE_ENV ?? 'unknown',
    cookieName:      COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   COOKIE_MAX_AGE,
    },
  };

  // ── 1. JWT_SECRET check ────────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET ?? '';
  result.jwtSecretSet         = !!jwtSecret;
  result.jwtSecretFingerprint = secretFingerprint(jwtSecret);

  // ── 2. JWT sign/verify self-consistency ───────────────────────────────────
  try {
    const testToken = signToken({ id: 'debug-test', name: 'Debug', email: 'debug@test.internal' });
    const decoded   = verifyToken(testToken);
    result.jwtSignVerifyOk = !!decoded && decoded.id === 'debug-test';
  } catch (e) {
    result.jwtSignVerifyOk = false;
    result.jwtSignVerifyError = (e as Error)?.message;
  }

  // ── 3. DATABASE_URL check ─────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL ?? '';
  result.databaseUrlSet = !!dbUrl && dbUrl !== 'YOUR_NEON_DATABASE_URL_HERE';

  // ── 4. Cookie presence ────────────────────────────────────────────────────
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookieMatch  = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  result.cookiePresent = !!cookieMatch;

  if (cookieMatch) {
    // Verify the cookie JWT is valid
    const decoded = verifyToken(cookieMatch[1]);
    result.cookieJwtValid = !!decoded;
    if (decoded) {
      result.cookieUserId = decoded.id;
    }
  }

  // ── 5. User lookup (optional — requires ?email=) ──────────────────────────
  if (email) {
    try {
      const sql = await getDbReady();

      // Check for the user
      const rows = await sql`
        SELECT id, email, name, role, password_hash
        FROM users
        WHERE email = ${email.toLowerCase().trim()}
        ORDER BY created_at ASC
      `;

      result.userExists = rows.length > 0;
      result.duplicateUsers = rows.length > 1;
      result.userCount  = rows.length;

      if (rows.length > 0) {
        result.userId = rows[0].id;
        result.userRole = rows[0].role;
        // Check if password_hash looks valid (bcrypt hashes start with $2b$ or $2a$)
        const hash = rows[0].password_hash ?? '';
        result.passwordHashPresent = !!hash;
        result.passwordHashLooksValid = hash.startsWith('$2b$') || hash.startsWith('$2a$');
        result.passwordHashLength = hash.length;

        // ── 6. Password verify (non-prod only, optional) ────────────────────
        if (password && process.env.NODE_ENV !== 'production') {
          try {
            result.passwordValid = await bcrypt.compare(password, hash);
          } catch (e) {
            result.passwordValid = false;
            result.passwordVerifyError = (e as Error)?.message;
          }
        }
      }

      // ── 7. Check for auth failure log indicators (session table) ──────────
      // Check if solardog_conversations table exists (proxy for DB health)
      try {
        await sql`SELECT 1 FROM solardog_conversations LIMIT 0`;
        result.dbTablesHealthy = true;
      } catch {
        result.dbTablesHealthy = false;
        result.dbTablesNote = 'Run /api/migrate to create missing tables';
      }

    } catch (e) {
      result.userLookupError = (e as Error)?.message;
      result.userExists = null;
    }
  }

  // ── 8. Summary ────────────────────────────────────────────────────────────
  const issues: string[] = [];
  if (!result.jwtSecretSet)    issues.push('JWT_SECRET is not set — tokens will fail');
  if (!result.jwtSignVerifyOk) issues.push('JWT sign/verify failed — secret may be corrupted or mismatched');
  if (!result.databaseUrlSet)  issues.push('DATABASE_URL is not configured');
  if (result.duplicateUsers)   issues.push(`Duplicate users found for ${email} — this causes auth instability`);
  if (result.passwordHashLooksValid === false) issues.push('password_hash does not look like a valid bcrypt hash');

  result.issues     = issues;
  result.ok         = issues.length === 0;
  result.checkedAt  = new Date().toISOString();

  console.log('[AUTH_STATUS_DEBUG] admin check completed', {
    ok:            result.ok,
    jwtOk:         result.jwtSignVerifyOk,
    dbSet:         result.databaseUrlSet,
    cookie:        result.cookiePresent,
    emailChecked:  email ?? 'none',
    issues:        issues,
  });

  return NextResponse.json(result, { status: 200 });
}