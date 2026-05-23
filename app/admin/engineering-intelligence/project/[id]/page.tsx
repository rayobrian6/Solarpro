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
} from '../../components';

export const metadata = {
  title: 'Project Engineering Intelligence | SolarPro Admin',
};

export default function ProjectEngineeringIntelligencePage({ params }: { params: { id: string } }) {
  const model = buildEngineeringIntelligenceWorkspace({ projectId: params.id });

  return (
    <WorkspaceShell
      model={model}
      title={`Project Engineering Intelligence: ${params.id}`}
      subtitle="Project-scoped deterministic workspace. Until a persisted project snapshot is supplied by backend state, panels show explicit registry/empty-state data rather than fabricated project status."
    >
      <EngineeringHealthDashboard health={model.health} />
      <CanonicalEvidenceWorkspace groups={model.evidenceGroups} />
      <RequirementWorkspace requirements={model.requirements} />
      <DecisionWorkspace decisions={model.decisions} />
      <StaleInvalidationWorkspace stale={model.staleInvalidation} />
      <SnapshotTimelineWorkspace snapshots={model.snapshots} />
      <DependencyGraphViewer graph={model.graph} />
      <RegenerationPlanningWorkspace planning={model.regenerationPlanning} />
      <AuditGuardWorkspace audit={model.auditGuards} />
    </WorkspaceShell>
  );
}
