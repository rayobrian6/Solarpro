import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Server-side admin auth check (Next.js 14 compatible).
 * Always re-fetches role from DB so stale JWTs (pre-migration) still work.
 * Redirects to /dashboard if not admin/super_admin.
 */
export async function requireAdmin(): Promise<AdminUser> {
  // Next.js 14: cookies() is synchronous (no await)
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

    if (role !== 'admin' && role !== 'super_admin') {
      redirect('/dashboard');
    }

    return {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role,
    };
  } catch {
    // Fallback to JWT role if DB is unreachable
    const role = user.role ?? 'user';
    if (role !== 'admin' && role !== 'super_admin') {
      redirect('/dashboard');
    }
    return {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role,
    };
  }
}

export function isAdmin(role?: string): boolean {
  return role === 'admin' || role === 'super_admin';
}