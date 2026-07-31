import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { verifyTokenWithMeta, isSessionStale } from '@/lib/auth';
// Import directly from db-ready (not db-neon) to avoid pulling the entire 2244-line
// db-neon.ts + utility-rules.ts (1341 lines) into auth-related route bundles.
// db-ready.ts exports only the connection/retry primitives needed here.
import { getDbWithRetry } from '@/lib/db-ready';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'super_admin';
};

// ─── In-memory role cache ────────────────────────────────────────────────────
// Caches DB role lookups for 60 seconds per function instance.
// Eliminates one DB round-trip per admin API request on warm instances.
// Security: role changes propagate within 60s max (cache TTL).
// This cache is per-Vercel-function-instance (module scope) — not shared globally.
interface RoleCacheEntry {
  user: AdminUser;
  passwordChangedAt: string | null; // for session-invalidation check on cache hits
  expiresAt: number;
}
const _roleCache = new Map<string, RoleCacheEntry>();
const ROLE_CACHE_TTL_MS = 60_000; // 60 seconds

function getRoleCached(userId: string): RoleCacheEntry | null {
  const entry = _roleCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _roleCache.delete(userId);
    return null;
  }
  return entry;
}

function setRoleCached(user: AdminUser, passwordChangedAt: string | null): void {
  _roleCache.set(user.id, { user, passwordChangedAt, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
}

/**
 * Best-effort fetch of role + password_changed_at. Falls back to a query
 * without password_changed_at if migration 094 isn't applied yet (so admins
 * are never locked out pre-migration). Returns null on user-not-found; rethrows
 * connection errors to the caller's existing handling.
 */
async function fetchAdminRow(
  sql: Awaited<ReturnType<typeof getDbWithRetry>>,
  userId: string,
): Promise<{ id: string; name: string; email: string; role: string; password_changed_at: string | null } | null> {
  try {
    const rows = await sql`
      SELECT id, name, email, role, password_changed_at
      FROM users WHERE id = ${userId} LIMIT 1
    `;
    return (rows[0] as any) ?? null;
  } catch (e: unknown) {
    const msg = ((e as Error)?.message || '').toLowerCase();
    if (msg.includes('column') && msg.includes('does not exist')) {
      const rows = await sql`SELECT id, name, email, role FROM users WHERE id = ${userId} LIMIT 1`;
      const r = rows[0] as any;
      return r ? { ...r, password_changed_at: null } : null;
    }
    throw e;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export function isAdminRole(role?: string | null): role is 'admin' | 'super_admin' {
  return role === 'admin' || role === 'super_admin';
}

/**
 * SERVER COMPONENT admin guard (Next.js 14 — cookies() is synchronous).
 * Role is NEVER read from JWT — always fetched from DB.
 * Uses getDbReady() with retry to handle Vercel cold starts after deployment.
 */
export async function requireAdmin(): Promise<AdminUser> {
  // Next.js 14: cookies() is synchronous — no await
  const cookieStore = await cookies();
  const token = cookieStore.get('solarpro_session')?.value;

  if (!token) {
    console.log('[requireAdmin] No session cookie — redirecting to login');
    redirect('/auth/login');
  }

  const jwtMeta = verifyTokenWithMeta(token);
  if (!jwtMeta?.user?.id) {
    console.log('[requireAdmin] Invalid/expired JWT — redirecting to login');
    redirect('/auth/login');
  }
  const jwtUser = jwtMeta.user;

  console.debug('[requireAdmin] JWT identity verified:', { id: jwtUser.id });

  // Fetch role from DB — this is the ONLY source of truth for role
  let dbUser: { id: string; name: string; email: string; role: string; password_changed_at: string | null } | null = null;
  let dbError: string | null = null;

  try {
    const sql = await getDbWithRetry();
    dbUser = await fetchAdminRow(sql, jwtUser.id);
    if (!dbUser) dbError = 'User not found in DB';
  } catch (e: unknown) {
    dbError = `DB error: ${(e as Error).message}`;
  }

  console.log('[requireAdmin] DB lookup result:', { dbUser: dbUser ? { id: dbUser.id, role: dbUser.role } : null, dbError });

  if (!dbUser) {
    console.log('[requireAdmin] DB user not found — redirecting to login. Error:', dbError);
    redirect('/auth/login');
  }

  // Session invalidation (migration 094): reject a token issued before the
  // user's last password change so a reset logs out other devices.
  if (isSessionStale(jwtMeta.iat, dbUser.password_changed_at)) {
    console.log('[requireAdmin] Token predates password change — redirecting to login');
    redirect('/auth/login');
  }

  const role = dbUser.role;
  console.log('[requireAdmin] DB role:', role, '| isAdmin:', isAdminRole(role));

  if (!isAdminRole(role)) {
    console.log('[requireAdmin] Role not admin/super_admin — redirecting to dashboard. Role was:', role);
    redirect('/dashboard');
  }

  console.log('[requireAdmin] ✅ Access granted for userId:', dbUser.id, 'role:', role);

  return {
    id:    dbUser.id,
    name:  dbUser.name,
    email: dbUser.email,
    role:  role as 'admin' | 'super_admin',
  };
}

/**
 * API ROUTE admin guard.
 * Role is NEVER read from JWT — always fetched from DB (or 60s in-memory cache).
 * Uses getDbReady() with retry to handle Vercel cold starts after deployment.
 *
 * PERF: In-memory role cache (60s TTL) eliminates the per-request DB round-trip
 * on warm function instances. Cache is per-Vercel-function-instance (module scope).
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminUser | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;

  const jwtMeta = verifyTokenWithMeta(match[1]);
  if (!jwtMeta?.user?.id) return null;
  const jwtUser = jwtMeta.user;

  // Check in-memory cache first — avoids DB hit on warm instances. Still enforce
  // session invalidation (migration 094) using the cached password_changed_at.
  const cached = getRoleCached(jwtUser.id);
  if (cached) {
    if (isSessionStale(jwtMeta.iat, cached.passwordChangedAt)) return null;
    return cached.user;
  }

  try {
    const sql = await getDbWithRetry();
    const dbUser = await fetchAdminRow(sql, jwtUser.id);
    if (!dbUser) return null;

    // Reject a token issued before the user's last password change.
    if (isSessionStale(jwtMeta.iat, dbUser.password_changed_at)) return null;
    if (!isAdminRole(dbUser.role)) return null;

    const adminUser: AdminUser = {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role:  dbUser.role as 'admin' | 'super_admin',
    };

    // Cache the result for 60 seconds
    setRoleCached(adminUser, dbUser.password_changed_at);
    return adminUser;
  } catch {
    return null;
  }
}