import { requireAdmin } from '@/lib/adminAuth';
import AdminShell from './AdminShell';

export const metadata = { title: 'SolarPro Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}