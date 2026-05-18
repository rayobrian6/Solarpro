import { requireAdmin } from '@/lib/adminAuth';
import { listProducers } from '@/lib/intelligence/registry';
import IntelligenceRunnerPanel from './IntelligenceRunnerPanel';

export const dynamic = 'force-dynamic';

export default async function AdminNetworkIntelligencePage() {
  const admin = await requireAdmin();
  const producers = listProducers();

  return (
    <IntelligenceRunnerPanel
      producers={producers}
      adminRole={admin.role}
      isSuperAdmin={admin.role === 'super_admin'}
    />
  );
}
