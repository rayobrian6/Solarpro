import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getProjectsByUser } from '@/lib/db-neon';
import { buildEngineeringIntelligenceWorkspace } from '@/lib/engineeringIntelligence';
import { acceptCandidate, createCandidate, markReviewRequired } from '@/lib/assistedEvidence';
import { createGeometryCandidateDemoCandidates, generateMetadataFixtureCandidates, generateMetadataRuntimeCandidates, generateOcrFixtureCandidates } from '@/lib/assistedEvidenceSources';
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
  GeometryCandidateReviewWorkspace,
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
  const assistedEvidenceSandbox = await buildAssistedEvidenceSandboxPanel();

  return (
    <WorkspaceShell
      model={model}
      title="Engineering Intelligence Workspace"
      subtitle="Deterministic internal/admin workspace for engineering-state health, canonical evidence lineage, requirements, decisions, stale-state tracking, snapshots, dependency graphs, regeneration planning, audit guards, and real project selection."
    >
      <ProjectIntelligencePicker projects={projectList.projects} loadState={projectList.loadState} />
      <EngineeringHealthDashboard health={model.health} />
      <AssistedEvidenceSandboxWorkspace sandbox={assistedEvidenceSandbox} />
      <GeometryCandidateReviewWorkspace sandbox={assistedEvidenceSandbox} />
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


async function buildAssistedEvidenceSandboxPanel() {
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
  const sourceContext = {
    sourceFileId: 'fixture-source-open-source-1',
    sourceUploadKey: 'fixtures/assisted-evidence-sources/fixture-source-open-source-1.jpg',
    projectId: 'fixture-project-assisted',
    surveyId: 'fixture-survey-assisted',
    toolRunId: 'fixture-source-run-1',
    toolConfigHash: 'fixture-source-config-v1',
    sourceMetadataHash: 'fixture-source-metadata-hash-v1',
    createdAt: '2025-01-03T00:00:00.000Z',
    createdBy: 'engineering-intelligence-demo',
  };
  const metadataFixtures = generateMetadataFixtureCandidates(sourceContext, {
    fixtureId: 'admin-metadata-fixture-1',
    imageWidth: 800,
    imageHeight: 600,
    orientationHint: 'landscape',
    duplicateGroupHint: 'possible-admin-fixture-duplicate',
    signals: [
      { signalId: 'admin-metadata-signal-low-resolution', field: 'possible_low_resolution_photo', value: '800x600', confidence: 0.37, limitationRefs: ['fixture-dimensions-only'] },
      { signalId: 'admin-metadata-signal-duplicate', field: 'possible_duplicate_photo', value: true, confidence: 0.42, limitationRefs: ['filename-similarity-only'] },
    ],
  });
  const ocrFixtures = generateOcrFixtureCandidates(sourceContext, {
    fixtureId: 'admin-ocr-fixture-1',
    textRegionCount: 2,
    signals: [
      { signalId: 'admin-ocr-signal-meter-label', field: 'possible_meter_label_text', text: 'METER FIXTURE 123', confidence: 0.46, limitationRefs: ['fixture-text-only'] },
      { signalId: 'admin-ocr-signal-equipment-label', field: 'possible_equipment_label_text', text: 'INV-1 FIXTURE', confidence: 0.51, limitationRefs: ['fixture-text-only'] },
    ],
  });
  const runtimeContext = {
    sourceFileId: 'runtime-source-open-source-1',
    sourceUploadKey: 'runtime/assisted-evidence-sources/runtime-source-open-source-1.png',
    projectId: 'fixture-project-assisted',
    surveyId: 'fixture-survey-assisted',
    toolRunId: 'metadata-runtime-run-1',
    toolConfigHash: 'metadata-runtime-config-v1',
    sourceMetadataHash: 'metadata-runtime-source-hash-v1',
    createdAt: '2025-01-04T00:00:00.000Z',
    createdBy: 'engineering-intelligence-demo',
  };
  const runtimeMetadata = await generateMetadataRuntimeCandidates(runtimeContext, new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
    0, 0, 0, 12, 73, 68, 65, 84, 8, 153, 99, 248, 207, 192, 0, 0,
    3, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]));
  const geometryContext = {
    sourceFileId: 'geometry-runtime-source-image-1',
    sourceUploadKey: 'runtime/assisted-evidence-sources/roof-obstruction-review-source-1.png',
    projectId: 'fixture-project-assisted',
    surveyId: 'fixture-survey-assisted',
    toolRunId: 'geometry-runtime-run-1',
    toolConfigHash: 'geometry-runtime-config-v1',
    sourceMetadataHash: 'geometry-runtime-source-hash-v1',
    createdAt: '2025-01-05T00:00:00.000Z',
    createdBy: 'engineering-intelligence-demo',
  };
  const geometryRuntime = await createGeometryCandidateDemoCandidates({
    sourceContext: geometryContext,
    sourceContextText: 'roof overview source image with possible vent obstruction review context',
  });
  return {
    candidates: [candidate, accepted.candidate, ...metadataFixtures.candidates, ...ocrFixtures.candidates, ...runtimeMetadata.candidates, ...geometryRuntime.candidates],
    projections: [accepted.projection],
    warning: 'FIXTURE AND RUNTIME PILOT DATA ONLY: candidate metadata is non-authoritative, review-required, and cannot affect engineering truth. Geometry candidates are review-only source-image context and are not CAD input, roof-plane truth, setbacks, NEC authority, layout input, workflow input, or recommendation input.',
  };
}
