import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
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
  expiresAt: number;
}
const _roleCache = new Map<string, RoleCacheEntry>();
const ROLE_CACHE_TTL_MS = 60_000; // 60 seconds

function getRoleCached(userId: string): AdminUser | null {
  const entry = _roleCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _roleCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setRoleCached(user: AdminUser): void {
  _roleCache.set(user.id, { user, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
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
  const cookieStore = cookies();
  const token = cookieStore.get('solarpro_session')?.value;

  if (!token) {
    console.log('[requireAdmin] No session cookie — redirecting to login');
    redirect('/auth/login');
  }

  const jwtUser = verifyToken(token);
  if (!jwtUser?.id) {
    console.log('[requireAdmin] Invalid/expired JWT — redirecting to login');
    redirect('/auth/login');
  }

  console.debug('[requireAdmin] JWT identity verified:', { id: jwtUser.id });

  // Fetch role from DB — this is the ONLY source of truth for role
  let dbUser: { id: string; name: string; email: string; role: string } | null = null;
  let dbError: string | null = null;

  try {
    const sql = await getDbWithRetry();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${jwtUser.id}
      LIMIT 1
    `;
    if (rows.length > 0) {
      dbUser = rows[0] as { id: string; name: string; email: string; role: string };
    } else {
      dbError = 'User not found in DB';
    }
  } catch (e: unknown) {
    dbError = `DB error: ${(e as Error).message}`;
  }

  console.log('[requireAdmin] DB lookup result:', { dbUser: dbUser ? { id: dbUser.id, role: dbUser.role } : null, dbError });

  if (!dbUser) {
    console.log('[requireAdmin] DB user not found — redirecting to login. Error:', dbError);
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

  const jwtUser = verifyToken(match[1]);
  if (!jwtUser?.id) return null;

  // Check in-memory cache first — avoids DB hit on warm instances
  const cached = getRoleCached(jwtUser.id);
  if (cached) return cached;

  try {
    const sql = await getDbWithRetry();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${jwtUser.id}
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const dbUser = rows[0] as { id: string; name: string; email: string; role: string };
    if (!isAdminRole(dbUser.role)) return null;

    const adminUser: AdminUser = {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role:  dbUser.role as 'admin' | 'super_admin',
    };

    // Cache the result for 60 seconds
    setRoleCached(adminUser);
    return adminUser;
  } catch {
    return null;
  }
}