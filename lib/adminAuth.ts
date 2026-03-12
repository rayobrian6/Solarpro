import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'super_admin';
};

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

  console.log('[requireAdmin] JWT identity:', { id: jwtUser.id, email: jwtUser.email });

  // Fetch role from DB — this is the ONLY source of truth for role
  let dbUser: { id: string; name: string; email: string; role: string } | null = null;
  let dbError: string | null = null;

  try {
    const sql = await getDbReady();
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
  } catch (e: any) {
    dbError = `DB error: ${e.message}`;
  }

  console.log('[requireAdmin] DB lookup result:', { dbUser: dbUser ? { id: dbUser.id, email: dbUser.email, role: dbUser.role } : null, dbError });

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

  console.log('[requireAdmin] ✅ Access granted for', dbUser.email, 'role:', role);

  return {
    id:    dbUser.id,
    name:  dbUser.name,
    email: dbUser.email,
    role:  role as 'admin' | 'super_admin',
  };
}

/**
 * API ROUTE admin guard.
 * Role is NEVER read from JWT — always fetched from DB.
 * Uses getDbReady() with retry to handle Vercel cold starts after deployment.
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminUser | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;

  const jwtUser = verifyToken(match[1]);
  if (!jwtUser?.id) return null;

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${jwtUser.id}
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const dbUser = rows[0] as { id: string; name: string; email: string; role: string };
    if (!isAdminRole(dbUser.role)) return null;

    return {
      id:    dbUser.id,
      name:  dbUser.name,
      email: dbUser.email,
      role:  dbUser.role as 'admin' | 'super_admin',
    };
  } catch {
    return null;
  }
}