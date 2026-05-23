import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import {
  DependencyGraphViewer,
  RegenerationPlanningWorkspace,
  RequirementWorkspace,
  DecisionWorkspace,
  WorkspaceShell,
} from '../components';

export const metadata = {
  title: 'Engineering Dependency Graph | SolarPro Admin',
};

export default function EngineeringIntelligenceGraphPage() {
  const model = buildEngineeringIntelligenceWorkspace();

  return (
    <WorkspaceShell
      model={model}
      title="Engineering Dependency Graph"
      subtitle="Deterministic graph viewer for evidence, requirements, decisions, render contexts, document sections, stale outputs, and regeneration plans."
    >
      <DependencyGraphViewer graph={model.graph} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <RequirementWorkspace requirements={model.requirements} />
        <DecisionWorkspace decisions={model.decisions} />
      </div>
      <RegenerationPlanningWorkspace planning={model.regenerationPlanning} />
    </WorkspaceShell>
  );
}
