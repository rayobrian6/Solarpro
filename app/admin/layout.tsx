import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, getDb } from '@/lib/auth';
import AdminShell from './AdminShell';

export const metadata = { title: 'SolarPro Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Step 1: Get cookie — Next.js 14 cookies() is synchronous
  const cookieStore = cookies();
  const token = cookieStore.get('solarpro_session')?.value;

  console.log('[AdminLayout] token present:', !!token);

  if (!token) {
    console.log('[AdminLayout] No token — redirecting to login');
    redirect('/auth/login?redirect=/admin');
  }

  // Step 2: Verify JWT — extract identity only (no role in JWT)
  const jwtUser = verifyToken(token);
  console.log('[AdminLayout] jwtUser:', jwtUser ? { id: jwtUser.id, email: jwtUser.email } : null);

  if (!jwtUser?.id) {
    console.log('[AdminLayout] Invalid JWT — redirecting to login');
    redirect('/auth/login?redirect=/admin');
  }

  // Step 3: Fetch role from DB — DB is the ONLY source of truth for role
  let dbRole: string | null = null;
  let dbName: string = jwtUser.name || '';
  let dbEmail: string = jwtUser.email || '';
  let dbId: string = jwtUser.id;

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE id = ${jwtUser.id}
      LIMIT 1
    `;

    console.log('[AdminLayout] DB rows found:', rows.length);

    if (rows.length > 0) {
      dbRole  = rows[0].role ?? 'user';
      dbName  = rows[0].name ?? jwtUser.name;
      dbEmail = rows[0].email ?? jwtUser.email;
      dbId    = rows[0].id ?? jwtUser.id;
    }
  } catch (e: any) {
    console.error('[AdminLayout] DB error:', e.message);
    // Don't redirect on DB error — show error state instead
    dbRole = null;
  }

  console.log('[AdminLayout] dbRole:', dbRole);

  // Step 4: Check role
  if (dbRole !== 'admin' && dbRole !== 'super_admin') {
    console.log('[AdminLayout] Role check failed — role is:', dbRole, '— redirecting to dashboard');
    redirect('/dashboard');
  }

  console.log('[AdminLayout] ✅ Access granted:', dbEmail, 'role:', dbRole);

  const admin = {
    id:    dbId,
    name:  dbName,
    email: dbEmail,
    role:  dbRole as 'admin' | 'super_admin',
  };

  return <AdminShell admin={admin}>{children}</AdminShell>;
}