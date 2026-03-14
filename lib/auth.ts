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
  console.log('DATABASE_URL loaded:', !!url);
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
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
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

export function verifyToken(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as Record<string, any>;
    // Explicitly extract ONLY identity fields — discard any role/subscription
    // fields that may exist in old JWTs issued before this fix.
    if (!decoded?.id || !decoded?.email) return null;
    return {
      id:      String(decoded.id),
      name:    String(decoded.name || decoded.email),
      email:   String(decoded.email),
      company: decoded.company ? String(decoded.company) : undefined,
      // role is intentionally NOT extracted — always read from DB
    };
  } catch {
    return null;
  }
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDevSessionUser } = require('@/lib/dev-auth') as typeof import('@/lib/dev-auth');
    const devUser = getDevSessionUser(req.headers);
    if (devUser) return devUser;
  } catch {
    // If dev-auth module fails for any reason, fall through to normal auth
  }

  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}