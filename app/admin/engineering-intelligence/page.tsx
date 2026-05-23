import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getProjectsByUser } from '@/lib/db-neon';
import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import { acceptCandidate, createCandidate, markReviewRequired } from '@/lib/assistedEvidence';
import type { Project } from '@/types';
import {
  AssistedEvidenceSandboxWorkspace,
  AuditGuardWorkspace,
  CADReadinessEscalationsWorkspace,
  CanonicalEvidenceWorkspace,
  DecisionWorkspace,
  DependencyGraphViewer,
  DependencyRiskEscalationsWorkspace,
  EngineeringHealthDashboard,
  EngineeringReviewQueueWorkspace,
  EngineeringWorkflowOrchestrationWorkspace,
  ProjectIntelligencePicker,
  ConflictResolutionQueueWorkspace,
  RegenerationApprovalQueueWorkspace,
  RegenerationPlanningWorkspace,
  RequirementWorkspace,
  FallbackRiskQueueWorkspace,
  InstallBlockerQueueWorkspace,
  PermitReadinessQueueWorkspace,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
  SurveyFollowUpQueueWorkspace,
  WorkflowSimulationImpactsWorkspace,
  WorkspaceShell,
} from './components';

export const metadata = {
  title: 'Engineering Intelligence | SolarPro Admin',
};

export default async function EngineeringIntelligencePage() {
  const token = cookies().get('solarpro_session')?.value;
  const sessionUser = token ? verifyToken(token) : null;
  const projectList = await loadProjectPickerRecords(sessionUser?.id);
  const model = buildEngineeringIntelligenceWorkspace();

  return (
    <WorkspaceShell
      model={model}
      title="Engineering Intelligence Workspace"
      subtitle="Deterministic internal/admin workspace for engineering-state health, canonical evidence lineage, requirements, decisions, stale-state tracking, snapshots, dependency graphs, regeneration planning, audit guards, and real project selection."
    >
      <ProjectIntelligencePicker projects={projectList.projects} loadState={projectList.loadState} />
      <EngineeringHealthDashboard health={model.health} />
      <AssistedEvidenceSandboxWorkspace sandbox={buildAssistedEvidenceSandboxPanel()} />
      <EngineeringWorkflowOrchestrationWorkspace orchestration={model.workflowOrchestration} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <SurveyFollowUpQueueWorkspace orchestration={model.workflowOrchestration} />
        <EngineeringReviewQueueWorkspace orchestration={model.workflowOrchestration} />
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <ConflictResolutionQueueWorkspace orchestration={model.workflowOrchestration} />
        <FallbackRiskQueueWorkspace orchestration={model.workflowOrchestration} />
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <CADReadinessEscalationsWorkspace orchestration={model.workflowOrchestration} />
        <PermitReadinessQueueWorkspace orchestration={model.workflowOrchestration} />
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <InstallBlockerQueueWorkspace orchestration={model.workflowOrchestration} />
        <RegenerationApprovalQueueWorkspace orchestration={model.workflowOrchestration} />
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <DependencyRiskEscalationsWorkspace orchestration={model.workflowOrchestration} />
        <WorkflowSimulationImpactsWorkspace orchestration={model.workflowOrchestration} />
      </div>
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

async function loadProjectPickerRecords(userId: string | undefined): Promise<{ projects: Project[]; loadState: 'loaded' | 'unauthenticated' | 'load_error' }> {
  if (!userId) return { projects: [], loadState: 'unauthenticated' };
  try {
    const projects = await getProjectsByUser(userId);
    return { projects, loadState: 'loaded' };
  } catch (error) {
    console.warn('[EngineeringIntelligencePage] Project picker load failed:', error instanceof Error ? error.message : String(error));
    return { projects: [], loadState: 'load_error' };
  }
}


function buildAssistedEvidenceSandboxPanel() {
  const candidate = markReviewRequired(createCandidate({
    sourceFileId: 'fixture-assisted-file-1',
    sourceUploadKey: 'fixtures/assisted-evidence/manual-roof-edge.jpg',
    projectId: 'fixture-project-assisted',
    surveyId: 'fixture-survey-assisted',
    candidateType: 'roof_edge_candidate',
    candidateCategory: 'roof_context',
    candidateConfidence: 0.72,
    toolName: 'manual-fixture-assisted-evidence',
    toolVersion: '1.0.0',
    toolRunId: 'manual-fixture-run-1',
    toolConfigHash: 'manual-config-v1',
    sourceMetadataHash: 'manual-source-metadata-v1',
    candidatePayload: { suggestedCategory: 'roof_edge', note: 'deterministic fixture metadata only' },
    candidateSummary: 'Manual fixture candidate for sandbox review demonstration; not canonical evidence.',
    candidateClaims: [
      { claimId: 'fixture-claim-roof-edge', field: 'suggestedCategory', value: 'roof_edge', confidence: 0.72, limitationRefs: ['fixture-only', 'review-required'] },
    ],
    candidateLimitations: ['fixture-only', 'no-image-processing', 'review-required', 'non-authoritative'],
    createdAt: '2025-01-01T00:00:00.000Z',
    provenance: {
      source: 'manual_fixture',
      createdBy: 'engineering-intelligence-demo',
      deterministicInputs: ['sourceFileId', 'candidatePayload', 'createdAt'],
      notes: ['Candidate metadata is manually seeded for review UI only.', 'No image bytes are inspected.'],
    },
  }));
  const accepted = acceptCandidate(candidate, {
    reviewerId: 'fixture-reviewer',
    reviewedAt: '2025-01-02T00:00:00.000Z',
    acceptedFields: ['suggestedCategory'],
    reviewNotes: ['Accepted into reviewed projection fixture only; no canonical mapping performed.'],
  });
  return {
    candidates: [candidate, accepted.candidate],
    projections: [accepted.projection],
    warning: 'Candidate metadata is non-authoritative and does not affect engineering truth until reviewed and explicitly mapped.',
  };
}
