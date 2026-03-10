import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { verifyToken, getDb } from '@/lib/auth';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'super_admin';
};

/**
 * Check if a role string is an admin role.
 */
export function isAdminRole(role?: string | null): role is 'admin' | 'super_admin' {
  return role === 'admin' || role === 'super_admin';
}

/**
 * Fetch the current user's role from the database.
 * Returns null if user not found or DB error.
 */
async function fetchDbUser(userId: string): Promise<{ id: string; name: string; email: string; role: string } | null> {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0] as { id: string; name: string; email: string; role: string };
  } catch {
    return null;
  }
}

/**
 * SERVER COMPONENT admin guard (Next.js 14 — cookies() is synchronous).
 *
 * Flow:
 *   1. Read JWT from cookie → extract user.id (identity only, no role)
 *   2. Query DB for current role
 *   3. Redirect if not admin/super_admin
 *
 * Role is NEVER read from the JWT.
 */
export async function requireAdmin(): Promise<AdminUser> {
  // Next.js 14: cookies() is synchronous — no await
  const cookieStore = cookies();
  const token = cookieStore.get('solarpro_session')?.value;
  if (!token) redirect('/auth/login');

  const jwtUser = verifyToken(token);
  if (!jwtUser?.id) redirect('/auth/login');

  // Always fetch role from DB — never trust JWT for role
  const dbUser = await fetchDbUser(jwtUser.id);
  if (!dbUser) redirect('/auth/login');

  if (!isAdminRole(dbUser.role)) {
    redirect('/dashboard');
  }

  return {
    id:    dbUser.id,
    name:  dbUser.name,
    email: dbUser.email,
    role:  dbUser.role as 'admin' | 'super_admin',
  };
}

/**
 * API ROUTE admin guard.
 *
 * Flow:
 *   1. Read JWT from cookie header → extract user.id (identity only, no role)
 *   2. Query DB for current role
 *   3. Return null if not admin/super_admin (caller returns 403)
 *
 * Role is NEVER read from the JWT.
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminUser | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;

  const jwtUser = verifyToken(match[1]);
  if (!jwtUser?.id) return null;

  // Always fetch role from DB — never trust JWT for role
  const dbUser = await fetchDbUser(jwtUser.id);
  if (!dbUser) return null;

  if (!isAdminRole(dbUser.role)) return null;

  return {
    id:    dbUser.id,
    name:  dbUser.name,
    email: dbUser.email,
    role:  dbUser.role as 'admin' | 'super_admin',
  };
}