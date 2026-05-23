import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import {
  AuditGuardWorkspace,
  EngineeringHealthDashboard,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
  WorkspaceShell,
} from '../components';

export const metadata = {
  title: 'Engineering Snapshot Timeline | SolarPro Admin',
};

export default function EngineeringIntelligenceSnapshotsPage() {
  const model = buildEngineeringIntelligenceWorkspace();

  return (
    <WorkspaceShell
      model={model}
      title="Engineering Snapshot Timeline"
      subtitle="Durable snapshot timeline surface for snapshot ids, snapshot hashes, diffs, invalidation events, valid/stale transitions, and dependency changes."
    >
      <EngineeringHealthDashboard health={model.health} />
      <SnapshotTimelineWorkspace snapshots={model.snapshots} />
      <StaleInvalidationWorkspace stale={model.staleInvalidation} />
      <AuditGuardWorkspace audit={model.auditGuards} />
    </WorkspaceShell>
  );
}
