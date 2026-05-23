import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import {
  AuditGuardWorkspace,
  CanonicalEvidenceWorkspace,
  DecisionWorkspace,
  DependencyGraphViewer,
  EngineeringHealthDashboard,
  RegenerationPlanningWorkspace,
  RequirementWorkspace,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
  WorkspaceShell,
} from './components';

export const metadata = {
  title: 'Engineering Intelligence | SolarPro Admin',
};

export default function EngineeringIntelligencePage() {
  const model = buildEngineeringIntelligenceWorkspace();

  return (
    <WorkspaceShell
      model={model}
      title="Engineering Intelligence Workspace"
      subtitle="Deterministic internal/admin workspace for engineering-state health, canonical evidence lineage, requirements, decisions, stale-state tracking, snapshots, dependency graphs, regeneration planning, and audit guards."
    >
      <EngineeringHealthDashboard health={model.health} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <CanonicalEvidenceWorkspace groups={model.evidenceGroups} />
        <RequirementWorkspace requirements={model.requirements} />
      </div>
      <DecisionWorkspace decisions={model.decisions} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <StaleInvalidationWorkspace stale={model.staleInvalidation} />
        <SnapshotTimelineWorkspace snapshots={model.snapshots} />
      </div>
      <DependencyGraphViewer graph={model.graph} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <RegenerationPlanningWorkspace planning={model.regenerationPlanning} />
        <AuditGuardWorkspace audit={model.auditGuards} />
      </div>
    </WorkspaceShell>
  );
}
