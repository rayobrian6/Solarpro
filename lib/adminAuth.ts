import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * SERVER COMPONENT auth guard (Next.js 14 — cookies() is synchronous).
 * Always re-fetches role from DB so stale JWTs work after role migration.
 * Redirects to /auth/login or /dashboard if not authorized.
 */
export async function requireAdmin(): Promise<AdminUser> {
  // Next.js 14: cookies() is synchronous — no await
  const cookieStore = cookies();
  const token = cookieStore.get('solarpro_session')?.value;
  if (!token) redirect('/auth/login');

  const user = verifyToken(token);
  if (!user) redirect('/auth/login');

  // Always re-fetch role from DB — JWT may be stale (pre-migration)
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;

    if (rows.length === 0) redirect('/auth/login');

    const dbUser = rows[0];
    const role = dbUser.role ?? 'user';

    if (!isAdminRole(role)) redirect('/dashboard');

    return {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role,
    };
  } catch {
    // Fallback to JWT role if DB is unreachable
    const role = user.role ?? 'user';
    if (!isAdminRole(role)) redirect('/dashboard');
    return {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role,
    };
  }
}

/**
 * API ROUTE auth guard.
 * Re-fetches role from DB so stale JWTs work after role migration.
 * Returns AdminUser or null (caller handles the 403 response).
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminUser | null> {
  // Parse JWT from cookie header
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;

  const user = verifyToken(match[1]);
  if (!user) return null;

  // Re-fetch role from DB — JWT may be stale
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const dbUser = rows[0];
    const role = dbUser.role ?? 'user';
    if (!isAdminRole(role)) return null;

    return {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role,
    };
  } catch {
    // Fallback to JWT role
    const role = user.role ?? 'user';
    if (!isAdminRole(role)) return null;
    return {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role,
    };
  }
}