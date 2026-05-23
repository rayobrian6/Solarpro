import { describe, expect, it } from 'vitest';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import { hydrateProjectEngineeringIntelligence } from './projectHydration';
import { buildEngineeringRecommendations } from './recommendationEngine';
import { buildEngineeringWorkflowOrchestration } from './workflowOrchestration';
import { rankEngineeringWorkflows } from './workflowQueues';
import { scoreEngineeringWorkflow } from './workflowScoring';
import { simulateEngineeringScenario, type EngineeringScenarioOperation } from './scenarioSimulation';

const generatedAt = '2025-01-01T00:00:00.000Z';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-workflow-1',
    clientId: 'client-workflow-1',
    projectId: 'project-workflow-1',
    createdBy: 'user-workflow-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Workflow Way',
    surveyData: { systemType: 'roof', geometry: {}, structural: {}, electrical: {} },
    inspectorName: 'Field Tech',
    notes: 'Workflow fixture.',
    externalSurveyId: null,
    deliveryId: null,
    ...overrides,
  };
}

function file(id: string, label: string, surveyId = 'survey-workflow-1', createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId, fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedSparseFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-workflow-1',
    generatedAt,
    sources: [{ survey: survey(), files: [file('file-overview', 'site_overview'), file('file-roof', 'roof_overview')] }],
  });
}

function hydratedFallbackFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-workflow-1',
    generatedAt,
    sources: [{
      survey: survey({
        surveyData: {
          systemType: 'roof',
          geometry: { usableAreaSqFt: 510, roofPlanes: [{ id: 'plane-a', azimuth: 180, pitch: 27, area: 510 }] },
          structural: { roofMaterial: 'composition shingle', roofPitch: '27' },
          electrical: { interconnectionPoint: 'unknown' },
        },
      }),
      files: [file('file-overview', 'site_overview'), file('file-meter', 'utility_meter'), file('file-roof', 'roof_overview'), file('file-obstruction', 'roof_obstruction')],
    }],
  });
}

function scenario(hydrated: ReturnType<typeof hydratedSparseFixture>, scenarioId: string, operations: EngineeringScenarioOperation[]) {
  return simulateEngineeringScenario({
    scenarioId,
    scenarioType: 'evidence_change',
    projectId: hydrated.projectId,
    surveyId: hydrated.canonicalSurveyId,
    generatedAt,
    operations,
    canonicalManifest: null,
    surveyEvidence: hydrated.surveyEvidence,
    baselineCADReadiness: hydrated.cadReadiness,
    baselinePhotoGrouping: hydrated.photoGrouping,
    baselineStructuredSignals: hydrated.structuredSignals,
    baselineContextResolution: hydrated.contextResolution,
    invalidationResult: hydrated.invalidationResult,
    persistentGraph: hydrated.stateGraph,
    snapshots: hydrated.snapshots,
    existingRegenerationPlans: hydrated.regenerationPlans,
  });
}

function recommendationsAndWorkflows(hydrated: ReturnType<typeof hydratedSparseFixture>, simulations = [] as ReturnType<typeof scenario>[]) {
  const recommendations = buildEngineeringRecommendations({
    projectId: hydrated.projectId,
    surveyId: hydrated.canonicalSurveyId,
    generatedAt,
    cadReadiness: hydrated.cadReadiness,
    photoGrouping: hydrated.photoGrouping,
    structuredSignals: hydrated.structuredSignals,
    contextResolution: hydrated.contextResolution,
    invalidationPropagation: hydrated.invalidationPropagation,
    regenerationPlan: hydrated.regenerationPlanV1,
    scenarioSimulations: simulations,
  });
  const workflows = buildEngineeringWorkflowOrchestration({
    projectId: hydrated.projectId,
    surveyId: hydrated.canonicalSurveyId,
    generatedAt,
    recommendations,
    cadReadiness: hydrated.cadReadiness,
    structuredSignals: hydrated.structuredSignals,
    contextResolution: hydrated.contextResolution,
    invalidationPropagation: hydrated.invalidationPropagation,
    regenerationPlan: hydrated.regenerationPlanV1,
    scenarioSimulations: simulations,
  });
  return { recommendations, workflows };
}

describe('Engineering Workflow Orchestration V1', () => {
  it('creates survey follow-up, permit, install, CAD, and unresolved-state queues for sparse surveys', () => {
    const hydrated = hydratedSparseFixture();
    const { workflows } = recommendationsAndWorkflows(hydrated);

    expect(workflows.mode).toBe('deterministic_orchestration_review_only');
    expect(workflows.workflows.length).toBeGreaterThan(0);
    expect(workflows.surveyFollowUpQueue.some(workflow => workflow.workflowType === 'collect_missing_electrical_evidence')).toBe(true);
    expect(workflows.surveyFollowUpQueue.some(workflow => workflow.workflowType === 'validate_trench_context')).toBe(true);
    expect(workflows.permitReadinessQueue.some(workflow => workflow.workflowType === 'resolve_permit_blockers')).toBe(true);
    expect(workflows.installBlockerQueue.some(workflow => workflow.workflowType === 'verify_trench_route')).toBe(true);
    expect(workflows.cadReadinessEscalations.some(workflow => workflow.cadReadinessImpact.includes('trench-route-ready'))).toBe(true);
    expect(workflows.unresolvedStatesPreserved.length).toBeGreaterThan(0);
    expect(workflows.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no automatic workflow execution', 'no automatic conflict resolution', 'no autonomous regeneration']));
    expect(workflows.workflows.every(workflow => workflow.status !== 'resolved')).toBe(true);
  });

  it('preserves conflicts, fallbacks, stale propagation, regeneration approval, dependency centrality, and deterministic queue ranking', () => {
    const hydrated = hydratedFallbackFixture();
    const simulations = [
      scenario(hydrated, 'scenario:workflow:conflict-routing', [
        { operationId: 'conflict-routing', operationType: 'introduce_signal_conflict', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity conflicted?' },
        { operationId: 'remove-routing-fallback', operationType: 'remove_fallback', contextTypes: ['preferred_routing_context'], deterministicReason: 'What if routing fallback were unavailable?' },
        { operationId: 'block-routing-cad', operationType: 'set_cad_readiness', flagIds: ['routing-ready'], status: 'blocked', deterministicReason: 'What if routing CAD readiness were blocked?' },
      ]),
      scenario(hydrated, 'scenario:workflow:msp-confirmation', [
        { operationId: 'strengthen-msp', operationType: 'strengthen_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if MSP evidence improved?' },
      ]),
    ];

    const first = recommendationsAndWorkflows(hydrated, simulations).workflows;
    const second = recommendationsAndWorkflows(hydrated, simulations).workflows;

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.workflows.map(workflow => workflow.workflowId)).toEqual(second.workflows.map(workflow => workflow.workflowId));
    expect(first.workflows).toEqual(rankEngineeringWorkflows(first.workflows));
    expect(first.conflictResolutionQueue.length).toBeGreaterThan(0);
    expect(first.fallbackRiskQueue.length).toBeGreaterThan(0);
    expect(first.regenerationApprovalQueue.length).toBeGreaterThan(0);
    expect(first.dependencyRiskEscalations.length).toBeGreaterThan(0);
    expect(first.workflowSimulationImpacts.length).toBeGreaterThan(0);
    expect(first.highestPriorityWorkflows.some(workflow => workflow.simulationOutcome.scenarioIds.length > 0)).toBe(true);
    expect(first.workflows.some(workflow => workflow.scoreBreakdown.dependencyTraversalCentrality > 0)).toBe(true);
    expect(first.workflows.some(workflow => workflow.scoreBreakdown.conflictSeverity > 0)).toBe(true);
    expect(first.workflows.some(workflow => workflow.scoreBreakdown.fallbackParticipation > 0)).toBe(true);
    expect(first.workflows.some(workflow => workflow.status === 'escalated' || workflow.status === 'blocked' || workflow.status === 'simulated')).toBe(true);
  });

  it('uses stable transparent scoring and never auto-resolves workflow state', () => {
    const score = scoreEngineeringWorkflow({
      staleImpactSeverity: 1,
      affectedOutputCount: 2,
      invalidationPropagationDepth: 3,
      blockedRequirementCount: 4,
      cadReadinessImpact: 5,
      conflictSeverity: 6,
      fallbackParticipation: 7,
      unresolvedDependencyCount: 8,
      recommendationRanking: 9,
      simulationImpact: 10,
      dependencyTraversalCentrality: 11,
      confidenceDegradation: 0.5,
      permitReadinessImpact: 12,
      installReadinessImpact: 13,
      deterministicReason: 'fixed workflow score fixture',
    });

    expect(score.deterministicScore).toBe(1 * 11 + 2 * 8 + 3 * 5 + 4 * 10 + 5 * 8 + 6 * 10 + 7 * 6 + 8 * 7 + 9 * 4 + 10 * 8 + 11 * 4 + 10 + 12 * 9 + 13 * 7);

    const hydrated = hydratedSparseFixture();
    const { workflows } = recommendationsAndWorkflows(hydrated);
    expect(workflows.workflows.every(workflow => !['resolved', 'invalidated'].includes(workflow.status))).toBe(true);
    expect(workflows.workflows.every(workflow => workflow.safetyNotes.some(note => note.includes('must not auto-run')))).toBe(true);
    expect(workflows.queueSummaries.map(queue => queue.queueId)).toEqual([
      'engineering_workflow_orchestration',
      'survey_follow_up_queue',
      'engineering_review_queue',
      'conflict_resolution_queue',
      'fallback_risk_queue',
      'cad_readiness_escalations',
      'permit_readiness_queue',
      'install_blocker_queue',
      'regeneration_approval_queue',
      'dependency_risk_escalations',
      'workflow_simulation_impacts',
    ]);
  });
});
