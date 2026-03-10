import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { redirect } from 'next/navigation';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Server-side admin auth check.
 * Call at the top of every admin page/layout.
 * Redirects to /dashboard if not admin/super_admin.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get('solarpro_session')?.value;
  if (!token) redirect('/auth/login');

  const user = verifyToken(token);
  if (!user) redirect('/auth/login');

  if (user.role !== 'admin' && user.role !== 'super_admin') {
    redirect('/dashboard');
  }

  return {
    id:    user.id,
    name:  user.name,
    email: user.email,
    role:  user.role ?? 'user',
  };
}

export function isAdmin(role?: string): boolean {
  return role === 'admin' || role === 'super_admin';
}
