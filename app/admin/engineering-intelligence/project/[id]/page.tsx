import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { hydrateProjectEngineeringIntelligenceFromDb, buildEngineeringIntelligenceWorkspace, buildCADReadinessMetadata } from '@/lib/engineeringIntelligence';
import { buildDeterministicPhotoGrouping } from '@/lib/engineeringIntelligence/photoGrouping';
import { buildFieldEvidenceOrchestrationModel } from '@/lib/survey/evidence/fieldOrchestration';
import {
  AuditGuardWorkspace,
  CADReadinessWorkspace,
  CanonicalEvidenceWorkspace,
  DecisionWorkspace,
  DependencyGraphViewer,
  EngineeringHealthDashboard,
  FieldEvidenceOrchestrationWorkspace,
  PhotoGroupingWorkspace,
  ProjectHydrationSummary,
  RegenerationPlanningWorkspace,
  RequirementWorkspace,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
  WorkspaceShell,
} from '../../components';

export const metadata = {
  title: 'Project Engineering Intelligence | SolarPro Admin',
};

export default async function ProjectEngineeringIntelligencePage({ params }: { params: { id: string } }) {
  const token = cookies().get('solarpro_session')?.value;
  const sessionUser = token ? verifyToken(token) : null;
  const hasValidProjectId = isValidUUID(params.id);
  const hydration = !hasValidProjectId
    ? invalidProjectHydration(params.id)
    : sessionUser?.id
      ? await hydrateProjectEngineeringIntelligenceFromDb({ projectId: params.id, userId: sessionUser.id })
      : emptyProjectHydration(params.id);
  const model = hydration.workspace;
  const fieldEvidenceOrchestration = buildFieldEvidenceOrchestrationModel();

  return (
    <WorkspaceShell
      model={model}
      title={`Project Engineering Intelligence: ${params.id}`}
      subtitle="Project-scoped deterministic workspace hydrated from real survey evidence, state graph snapshots, invalidation metadata, and regeneration planning when project survey records are available. Empty states remain explicit and non-fabricated."
    >
      <ProjectHydrationSummary hydration={hydration} />
      <EngineeringHealthDashboard health={model.health} />
      <CanonicalEvidenceWorkspace groups={model.evidenceGroups} />
      <RequirementWorkspace requirements={model.requirements} />
      <DecisionWorkspace decisions={model.decisions} />
      <StaleInvalidationWorkspace stale={model.staleInvalidation} />
      <SnapshotTimelineWorkspace snapshots={model.snapshots} />
      <DependencyGraphViewer graph={model.graph} />
      <RegenerationPlanningWorkspace planning={model.regenerationPlanning} />
      <CADReadinessWorkspace readiness={hydration.cadReadiness} />
      <PhotoGroupingWorkspace grouping={model.photoGrouping} />
      <FieldEvidenceOrchestrationWorkspace orchestration={fieldEvidenceOrchestration} />
      <AuditGuardWorkspace audit={model.auditGuards} />
    </WorkspaceShell>
  );
}

function invalidProjectHydration(projectId: string) {
  const cadReadiness = buildCADReadinessMetadata({ projectId });
  const photoGrouping = buildDeterministicPhotoGrouping({ projectId, readinessFlags: cadReadiness.flags, generatedAt: new Date(0).toISOString() });
  const workspaceInput = { projectId, cadReadiness, photoGrouping };
  const workspace = buildEngineeringIntelligenceWorkspace(workspaceInput);
  return {
    projectId,
    generatedAt: new Date(0).toISOString(),
    source: 'not_loaded' as const,
    surveyCount: 0,
    canonicalSurveyId: null,
    surveyEvidence: null,
    workspaceInput,
    workspace,
    stateGraph: null,
    snapshots: [],
    invalidationResult: null,
    regenerationPlans: [],
    cadReadiness,
    photoGrouping,
    deterministicNotes: [
      'Project engineering hydration did not run because the route parameter is not a valid project UUID.',
      'Use the Project Intelligence Picker or an existing project/survey/permit/engineering entry point to open a real project id.',
      'Workspace remains registry/empty-state and does not synthesize project evidence, graph edges, snapshots, invalidation history, or CAD metadata.',
    ],
  };
}

function emptyProjectHydration(projectId: string) {
  const cadReadiness = buildCADReadinessMetadata({ projectId });
  const photoGrouping = buildDeterministicPhotoGrouping({ projectId, readinessFlags: cadReadiness.flags, generatedAt: new Date(0).toISOString() });
  const workspaceInput = { projectId, cadReadiness, photoGrouping };
  const workspace = buildEngineeringIntelligenceWorkspace(workspaceInput);
  return {
    projectId,
    generatedAt: new Date(0).toISOString(),
    source: 'not_loaded' as const,
    surveyCount: 0,
    canonicalSurveyId: null,
    surveyEvidence: null,
    workspaceInput,
    workspace,
    stateGraph: null,
    snapshots: [],
    invalidationResult: null,
    regenerationPlans: [],
    cadReadiness,
    photoGrouping,
    deterministicNotes: [
      'Project engineering hydration did not run because no valid admin session user was available in this route render.',
      'Workspace remains registry/empty-state and does not synthesize project evidence or engineering state.',
    ],
  };
}
