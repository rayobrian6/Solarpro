import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { getDbWithRetry, getDbDirect, DbConfigError } from '@/lib/db-ready';
export { DbConfigError } from '@/lib/db-ready';

type SqlExecutor = NeonQueryFunction<false, false>;

// Lazy getter — only throws at runtime, NOT at build time
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return secret;
}

/**
 * F-13 — admin override email (closes hardcoded `carpenterjames88@gmail.com`).
 *
 * Returns the admin override email from ADMIN_OVERRIDE_EMAIL env var, or throws
 * if missing. Fail-closed: a missing env var is a configuration error, NOT an
 * excuse to ship a hardcoded default. This is a security choice — a regression
 * here would re-leak the email into source.
 *
 * Used by the /api/migrate route's free-pass grant. The email was previously
 * hardcoded in app/api/migrate/route.ts (F-13 from AI-AGENT-README §11) —
 * moving it to env makes rotation, team-member onboarding, and the audit trail
 * real config actions instead of code changes.
 *
 * @throws if ADMIN_OVERRIDE_EMAIL is missing, empty, or whitespace-only.
 * @returns the trimmed email value.
 */
export function getAdminOverrideEmail(): string {
  const email = process.env.ADMIN_OVERRIDE_EMAIL;
  if (!email || typeof email !== 'string' || email.trim() === '') {
    throw new Error(
      'ADMIN_OVERRIDE_EMAIL env var is required. ' +
      'Set it in Vercel env vars (project solarpro-v31, all environments) and ' +
      'in .env.local for dev. See AI-AGENT-README.md §6 for details.'
    );
  }
  return email.trim();
}

export const COOKIE_NAME    = 'solarpro_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Returns a Neon SQL executor with retry/backoff for cold-start resilience.
 * Replaces the old getDb() which threw immediately on any connection error.
 *
 * Used by the login route — retries up to 3x with exponential backoff so
 * that transient Neon cold-start errors don't surface as "Database not
 * configured" to the end user.
 */
export async function getDbReady(): Promise<SqlExecutor> {
  return getDbWithRetry();
}

/**
 * Synchronous DB getter for routes that don't need retry logic.
 * Kept for backward compatibility with non-auth routes.
 * Throws immediately if DATABASE_URL is missing.
 */
export function getDb(): SqlExecutor {
  const url = process.env.DATABASE_URL;
  // DATABASE_URL presence verified at startup
  if (!url || url === 'YOUR_NEON_DATABASE_URL_HERE') {
    console.error(
      '\n[getDb] DATABASE_URL is not configured.\n' +
      '  -> Open solarpro/.env.local and set DATABASE_URL to your Neon connection string.\n' +
      '  -> Get it from: https://console.neon.tech -> your project -> Connection string\n'
    );
    throw new DbConfigError('DATABASE_URL is not set. Check .env.local — see console for instructions.');
  }
  return neon(url) as SqlExecutor;
}

// ── Password helpers ─────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// isLegacyHash — detect non-bcrypt password_hash values stored in DB.
//
// Known legacy formats:
//   1. "salt_hex:hash_hex" — custom SHA-512 scheme from pre-v47 data import.
//      Format: <32-hex-salt>:<128-hex-hash>  total length = 161 chars.
//   2. "__SOLARPRO_MUST_RESET__" — sentinel set by migrate/route.ts for
//      pre-seeded users who have never set a real password.
//   3. Any other non-bcrypt string (no $2a$/$2b$ prefix or wrong length).
//
// bcrypt hashes always start with "$2a$", "$2b$", or "$2y$" and are 60 chars.
// ---------------------------------------------------------------------------
export function isLegacyHash(hash: string | null | undefined): boolean {
  if (!hash) return false;

  // ---------------------------------------------------------------------------
  // SAFETY NET: bcrypt cost=4 hashes are NEVER produced by real password flows.
  // We hash real passwords at cost 10 or 12.  A $2b$04$ hash is overwhelmingly
  // our old placeholder (bcrypt.hash('__SOLARPRO_MUST_RESET__', 4)) written by
  // an earlier version of the migration script.  Detecting this here means the
  // login route returns LEGACY_HASH_RESET_REQUIRED (with a clear "use Forgot
  // Password" message) even if Migration 030 / free-pass repair hasn't run yet.
  // This is the permanent safety net — independent of any migration.
  // ---------------------------------------------------------------------------
  if (/^\$2[aby]\$04\$/.test(hash) && hash.length === 60) return true;

  // Valid bcrypt: starts with $2a$, $2b$, $2y$ and is exactly 60 chars
  if (/^\$2[aby]\$\d{2}\$/.test(hash) && hash.length === 60) return false;
  // Valid argon2: starts with $argon2
  if (hash.startsWith('$argon2')) return false;
  // Everything else is legacy / invalid
  return true;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// ---------------------------------------------------------------------------
// verifyPassword — bcrypt.compare with legacy hash detection.
//
// Overload 1 (default):  returns boolean (backward-compatible)
// Overload 2 (extended): returns { valid, requiresReset?, hashFormat }
//
// If the stored hash is a legacy/non-bcrypt format:
//   - Returns valid=false, requiresReset=true
//   - NEVER silently resets the password
//   - Login route uses requiresReset to show a friendly "please reset" message
// ---------------------------------------------------------------------------
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean>;
export async function verifyPassword(
  password: string,
  hash: string,
  opts: { extended: true },
): Promise<{ valid: boolean; requiresReset?: boolean; hashFormat: string }>;
export async function verifyPassword(
  password: string,
  hash: string,
  opts?: { extended?: boolean },
): Promise<boolean | { valid: boolean; requiresReset?: boolean; hashFormat: string }> {
  // Detect legacy hash BEFORE calling bcrypt (bcrypt throws on invalid hash strings)
  if (isLegacyHash(hash)) {
    const hashFormat = hash === '__SOLARPRO_MUST_RESET__'
      ? 'sentinel'
      : /^\$2[aby]\$04\$/.test(hash) && hash.length === 60
      ? 'cost4_bcrypt_sentinel'   // bcrypt-of-sentinel from old migration script
      : /^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(hash)
      ? 'legacy_salt_sha512'
      : 'unknown_legacy';

    if (opts?.extended) {
      return { valid: false, requiresReset: true, hashFormat };
    }
    return false;
  }

  const valid = await bcrypt.compare(password, hash);

  if (opts?.extended) {
    return { valid, hashFormat: 'bcrypt' };
  }
  return valid;
}

// ── JWT / Session ─────────────────────────────────────────────────────────────
// JWT contains ONLY identity — id, name, email, company.
// Role is NEVER stored in the JWT. Always fetch from DB.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  company?: string;
  // role intentionally omitted — always read from DB
}

export function signToken(user: SessionUser): string {
  // Only sign identity fields — no role, no subscription data
  const payload: SessionUser = {
    id:      user.id,
    name:    user.name,
    email:   user.email,
    company: user.company,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}

/**
 * Signs a short-lived "MFA pending" token.
 * Issued after successful password verification when MFA is enabled.
 * This token ONLY authorizes the holder to complete MFA verification —
 * it does NOT grant application access (mfa_pending = true flag).
 *
 * Lifetime: 5 minutes (generous for TOTP entry + clock skew).
 */
export const MFA_PENDING_COOKIE = 'solarpro_mfa_pending';
export const MFA_PENDING_MAX_AGE = 60 * 5; // 5 minutes

export function signMFAPendingToken(user: SessionUser & { role: string; mfa_method: string }): string {
  const payload = {
    id:         user.id,
    name:       user.name,
    email:      user.email,
    company:    user.company,
    mfa_pending: true,
    role:        user.role,
    mfa_method:  user.mfa_method,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '5m' });
}

/**
 * Verifies an MFA pending token. Returns the payload if valid and
 * the mfa_pending flag is set; returns null otherwise.
 */
export interface MFAPendingPayload extends SessionUser {
  mfa_pending: boolean;
  role: string;
  mfa_method: string;
}

export function verifyMFAPendingToken(token: string): MFAPendingPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as Record<string, any>;
    if (!decoded?.id || !decoded?.email || !decoded?.mfa_pending) return null;
    return {
      id:          String(decoded.id),
      name:        String(decoded.name || decoded.email),
      email:       String(decoded.email),
      company:     decoded.company ? String(decoded.company) : undefined,
      mfa_pending: true,
      role:        String(decoded.role || ''),
      mfa_method:  String(decoded.mfa_method || 'totp'),
    };
  } catch {
    return null;
  }
}

/**
 * MFA Enrollment Pending Token — restricted credential for MFA enrollment flow.
 *
 * PURPOSE:
 *   When an admin/staff user without MFA logs in, the server returns
 *   MFA_ENROLLMENT_REQUIRED and issues this token instead of a full session.
 *   This token ONLY authorizes MFA enrollment endpoints — it does NOT grant
 *   application access to projects, settings, billing, admin APIs, or account data.
 *
 * SECURITY:
 *   - httpOnly, Secure (production), sameSite=lax
 *   - 10-minute TTL (generous for QR scan + authenticator setup)
 *   - mfa_enrollment_pending flag distinguishes from full session
 *   - Invalidated after successful enrollment (cookie cleared by server)
 *   - Cannot be used to access any endpoint except /api/auth/mfa/setup
 *   - Cannot be used to authenticate to /api/auth/me or any other route
 *
 *   This is NOT a session — it is a restricted enrollment credential.
 */
export const MFA_ENROLLMENT_PENDING_COOKIE = 'solarpro_mfa_enroll_pending';
export const MFA_ENROLLMENT_PENDING_MAX_AGE = 60 * 10; // 10 minutes

export function signMFAEnrollmentPendingToken(user: SessionUser & { role: string }): string {
  const payload = {
    id:         user.id,
    name:       user.name,
    email:      user.email,
    company:    user.company,
    mfa_enrollment_pending: true,
    role:       user.role,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '10m' });
}

/**
 * Verifies an MFA enrollment pending token. Returns the payload if valid and
 * the mfa_enrollment_pending flag is set; returns null otherwise.
 */
export interface MFAEnrollmentPendingPayload extends SessionUser {
  mfa_enrollment_pending: boolean;
  role: string;
}

export function verifyMFAEnrollmentPendingToken(token: string): MFAEnrollmentPendingPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as Record<string, any>;
    if (!decoded?.id || !decoded?.email || !decoded?.mfa_enrollment_pending) return null;
    return {
      id:          String(decoded.id),
      name:        String(decoded.name || decoded.email),
      email:       String(decoded.email),
      company:     decoded.company ? String(decoded.company) : undefined,
      mfa_enrollment_pending: true,
      role:        String(decoded.role || ''),
    };
  } catch {
    return null;
  }
}

export function verifyToken(token: string): SessionUser | null {
  return verifyTokenWithMeta(token)?.user ?? null;
}

/**
 * Like verifyToken but also returns the token's issued-at (iat, seconds since
 * epoch). The iat is needed to enforce session invalidation on password reset:
 * a token issued BEFORE users.password_changed_at must be rejected. Returns null
 * for an invalid/expired token.
 */
export function verifyTokenWithMeta(token: string): { user: SessionUser; iat: number | null } | null {
  try {
    // SECURITY: explicitly restrict to HS256 — prevents alg:none and algorithm confusion attacks
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as Record<string, any>;
    // Explicitly extract ONLY identity fields — discard any role/subscription
    // fields that may exist in old JWTs issued before this fix.
    if (!decoded?.id || !decoded?.email) return null;
    return {
      user: {
        id:      String(decoded.id),
        name:    String(decoded.name || decoded.email),
        email:   String(decoded.email),
        company: decoded.company ? String(decoded.company) : undefined,
        // role is intentionally NOT extracted — always read from DB
      },
      iat: typeof decoded.iat === 'number' ? decoded.iat : null,
    };
  } catch {
    return null;
  }
}

/**
 * Session-invalidation check. Returns true when a token (by its iat) was issued
 * BEFORE the user's password was last changed — i.e. it predates a password
 * reset and must be rejected so other devices are logged out.
 *
 * Fails OPEN (returns false) when:
 *  - passwordChangedAt is null/absent (migration 094 pending, or never reset)
 *  - the token has no iat (can't determine — never lock a valid user out)
 * A small clock-skew grace prevents invalidating the fresh token minted right
 * after the reset itself.
 */
export function isSessionStale(
  iatSeconds: number | null | undefined,
  passwordChangedAt: string | Date | null | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  if (iatSeconds == null) return false;
  const changedMs = new Date(passwordChangedAt).getTime();
  if (Number.isNaN(changedMs)) return false;
  const SKEW_MS = 5000; // tolerate minor clock skew between token signing and DB clock
  return iatSeconds * 1000 < changedMs - SKEW_MS;
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
export function makeSessionCookie(token: string): string {
  const expires = new Date(Date.now() + COOKIE_MAX_AGE * 1000).toUTCString();
  // Add Secure flag in production (HTTPS) so the cookie is never sent over plain HTTP.
  // In local dev (http://localhost) we omit Secure so the cookie still works.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

// ── Get current user from request cookies ────────────────────────────────────
export function getUserFromRequest(req: Request): SessionUser | null {
  // Dev bypass — logs [DEV_AUTH_ACTIVE] if active (non-production only, explicit opt-in)
  // Falls through to normal JWT cookie validation in all production environments.
  // Uses dynamic import-style guard to avoid circular dependency issues at module load time.
  try {
    // Inline require replaced with module-level import to avoid eslint rule conflicts.
    // getDevSessionUser is imported at the top of this file via a lazy reference pattern.
    // Since lib/auth.ts is a Node.js module (never Edge), synchronous require is safe here.
    // We use the type-only import trick to avoid circular deps while still getting type safety.
    const devMod = require('./dev-auth') as typeof import('./dev-auth');
    const devUser = devMod.getDevSessionUser(req.headers as unknown as Headers);
    if (devUser) return devUser;
  } catch {
    // If dev-auth module fails for any reason, fall through to normal auth
  }

  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}