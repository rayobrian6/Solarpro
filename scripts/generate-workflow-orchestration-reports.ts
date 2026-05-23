import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import { hydrateProjectEngineeringIntelligence } from '@/lib/engineeringIntelligence/projectHydration';
import {
  buildEngineeringRecommendations,
  buildEngineeringWorkflowOrchestration,
  type EngineeringWorkflowItem,
  type EngineeringWorkflowOrchestrationSummary,
} from '@/lib/engineeringIntelligence';
import { simulateEngineeringScenario, type EngineeringScenarioOperation } from '@/lib/engineeringIntelligence/scenarioSimulation';

const generatedAt = '2025-01-01T00:00:00.000Z';
const outputDir = 'outputs/real-survey-data-validation';

function survey(): SiteSurvey {
  return {
    id: 'survey-workflow-report-1',
    clientId: 'client-workflow-report-1',
    projectId: 'project-workflow-report-1',
    createdBy: 'user-workflow-report-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '915 Deterministic Workflow Ave',
    surveyData: {
      systemType: 'roof',
      geometry: { usableAreaSqFt: 480, roofPlanes: [{ id: 'plane-a', azimuth: 180, pitch: 24, area: 480 }] },
      structural: { roofMaterial: 'composition shingle', roofPitch: '24', atticAccess: false },
      electrical: { interconnectionPoint: 'unknown' },
    },
    inspectorName: 'Field Tech',
    notes: 'Workflow orchestration report fixture using deterministic runtime builders with intentional electrical, routing, structural, trench, fallback, and confidence gaps.',
    externalSurveyId: null,
    deliveryId: null,
  };
}

function file(id: string, label: string, createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId: 'survey-workflow-report-1', fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-workflow-report-1',
    generatedAt,
    sources: [{
      survey: survey(),
      files: [
        file('file-site-overview', 'site_overview'),
        file('file-meter', 'utility_meter'),
        file('file-roof-overview', 'roof_overview'),
        file('file-obstruction', 'roof_obstruction'),
      ],
    }],
  });
}

function runScenario(hydrated: ReturnType<typeof hydratedFixture>, scenarioId: string, operations: EngineeringScenarioOperation[]) {
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

const hydrated = hydratedFixture();
const scenarios = [
  runScenario(hydrated, 'scenario:workflow:msp-confirmation', [
    { operationId: 'strengthen-msp-signal', operationType: 'strengthen_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if explicit MSP confirmation were supplied?' },
  ]),
  runScenario(hydrated, 'scenario:workflow:routing-confirmation', [
    { operationId: 'strengthen-routing-signal', operationType: 'strengthen_signal', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity were explicitly confirmed?' },
  ]),
  runScenario(hydrated, 'scenario:workflow:trench-resolution', [
    { operationId: 'strengthen-trench-signal', operationType: 'strengthen_signal', signalTypes: ['trench_path_explicit'], deterministicReason: 'What if trench path evidence became explicit?' },
  ]),
];

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
  scenarioSimulations: scenarios,
});

const orchestration = buildEngineeringWorkflowOrchestration({
  projectId: hydrated.projectId,
  surveyId: hydrated.canonicalSurveyId,
  generatedAt,
  recommendations,
  cadReadiness: hydrated.cadReadiness,
  structuredSignals: hydrated.structuredSignals,
  contextResolution: hydrated.contextResolution,
  invalidationPropagation: hydrated.invalidationPropagation,
  regenerationPlan: hydrated.regenerationPlanV1,
  scenarioSimulations: scenarios,
});

function list(values: unknown[] | undefined, empty = '_none_') {
  if (!values || values.length === 0) return empty;
  return values.map(value => `- ${String(value)}`).join('\n');
}

function workflowBlock(workflow: EngineeringWorkflowItem) {
  return `### ${workflow.workflowType}\n\n- Workflow id: \`${workflow.workflowId}\`\n- Category: ${workflow.category}\n- Priority: ${workflow.priority}\n- Severity: ${workflow.severity}\n- Status: ${workflow.status}\n- Confidence: ${workflow.confidence}\n- Deterministic score: ${workflow.deterministicScore}\n- Deterministic hash: \`${workflow.deterministicHash}\`\n- Reviewer role: ${workflow.recommendedReviewerRole}\n- Technician action: ${workflow.recommendedTechnicianAction}\n- Escalation reason: ${workflow.escalationReason}\n- Affected evidence: ${workflow.affectedEvidenceIds.join(', ') || 'none'}\n- Affected signals: ${workflow.affectedSignalIds.join(', ') || 'none'}\n- Affected contexts: ${workflow.affectedContextIds.join(', ') || 'none'}\n- Affected requirements: ${workflow.affectedRequirementIds.join(', ') || 'none'}\n- Affected decisions: ${workflow.affectedDecisionIds.join(', ') || 'none'}\n- Affected outputs: ${workflow.affectedOutputIds.join(', ') || 'none'}\n- CAD-readiness impacts: ${workflow.cadReadinessImpact.join(', ') || 'none'}\n- Stale participation: ${workflow.staleImpactParticipation.map(item => `${item.entityId}:${item.staleClasses.join('|')}`).join(', ') || 'none'}\n- Invalidation participation: ${workflow.invalidationParticipation.join(', ') || 'none'}\n- Regeneration participation: ${workflow.regenerationParticipation.join(', ') || 'none'}\n- Fallback participation: ${workflow.fallbackParticipation.join(', ') || 'none'}\n- Conflict participation: ${workflow.conflictParticipation.join(', ') || 'none'}\n- Dependency traversal paths: ${workflow.dependencyTraversal.length}\n- Blocking impacts: ${workflow.blockingImpacts.join(', ') || 'none'}\n\n${workflow.explanation}\n\n#### Why it exists\n\n${workflow.scoreBreakdown.deterministicReason}\n\n#### Simulation-backed improvements\n\n- Scenario ids: ${workflow.simulationOutcome.scenarioIds.join(', ') || 'none'}\n- Hypothetical confidence improvement: ${workflow.simulationOutcome.hypotheticalConfidenceImprovement}\n- Hypothetical CAD-readiness improvement: ${workflow.simulationOutcome.hypotheticalCADReadinessImprovement}\n- Hypothetical stale reduction: ${workflow.simulationOutcome.hypotheticalStaleReduction}\n- Hypothetical outcomes: ${workflow.simulationOutcome.hypotheticalRemediationOutcomes.join(' | ') || 'none'}\n\n#### Unresolved-state preservation\n\n${list(workflow.unresolvedStatesPreserved)}\n`;
}

function priorityRow(workflow: EngineeringWorkflowItem) {
  const score = workflow.scoreBreakdown;
  return `- ${workflow.workflowType}: score=${workflow.deterministicScore}; priority=${workflow.priority}; severity=${workflow.severity}; status=${workflow.status}; stale=${score.staleImpactSeverity}; outputs=${score.affectedOutputCount}; depth=${score.invalidationPropagationDepth}; blockedRequirements=${score.blockedRequirementCount}; cad=${score.cadReadinessImpact}; conflicts=${score.conflictSeverity}; fallbacks=${score.fallbackParticipation}; unresolved=${score.unresolvedDependencyCount}; recommendationRank=${score.recommendationRanking}; simulation=${score.simulationImpact}; centrality=${score.dependencyTraversalCentrality}; confidenceDegradation=${score.confidenceDegradation}; permit=${score.permitReadinessImpact}; install=${score.installReadinessImpact}; escalation=${workflow.escalationReason}`;
}

function queueSection(summary: EngineeringWorkflowOrchestrationSummary) {
  return summary.queueSummaries.map(queue => `## ${queue.label}\n\n${queue.deterministicReason}\n\nWorkflow count: ${queue.workflows.length}\n\n${queue.workflows.slice(0, 12).map(workflow => `- ${workflow.workflowType} (${workflow.priority}/${workflow.status}) score=${workflow.deterministicScore} hash=${workflow.deterministicHash}`).join('\n') || '_No workflows in this queue._'}`).join('\n\n');
}

function write(name: string, body: string) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, name), body);
}

write('workflow-orchestration-v1-report.md', `# Deterministic Engineering Workflow Orchestration V1 Report\n\nGenerated at: ${generatedAt}\n\nThis report was generated from deterministic Workflow Orchestration V1. Workflows are explicit reviewable operations guidance only; they do not execute tasks, mutate workflow state, approve engineering, approve permits, generate CAD, regenerate outputs, promote contexts, or resolve conflicts.\n\n## Runtime Boundary\n\n${list(orchestration.prohibitedRuntimeBehavior)}\n\n## Deterministic Notes\n\n${list(orchestration.deterministicNotes)}\n\n## Highest-Priority Workflows\n\n${orchestration.highestPriorityWorkflows.map(workflowBlock).join('\n')}\n\n## Queue Summary\n\n${queueSection(orchestration)}\n\n## Unresolved States Preserved\n\n${list(orchestration.unresolvedStatesPreserved)}\n`);

write('workflow-priority-analysis-v1-report.md', `# Workflow Priority Analysis V1 Report\n\nGenerated at: ${generatedAt}\n\nPriority analysis is deterministic and uses only allowed scoring inputs: stale impact severity, affected output count, invalidation propagation depth, blocked requirement count, CAD-readiness impact, conflict severity, fallback participation, unresolved dependency count, recommendation ranking, simulation impact, dependency traversal centrality, confidence degradation, permit readiness impact, and install readiness impact.\n\n## Deterministic Ranking Rows\n\n${orchestration.workflows.map(priorityRow).join('\n')}\n`);

write('workflow-simulation-impact-v1-report.md', `# Workflow Simulation Impact V1 Report\n\nGenerated at: ${generatedAt}\n\nSimulation impacts are derived from Scenario Simulation V1 read-only sandbox artifacts. They are hypothetical remediation outcomes only and never mutate production evidence, contexts, decisions, outputs, readiness, workflow state, or regeneration scope.\n\n## Scenario Hashes\n\n${scenarios.map(scenario => `- ${scenario.scenarioId}: \`${scenario.deterministicHash}\`; deltas=${scenario.deltas.length}; confidenceDeltas=${scenario.confidenceDeltas.length}; outputs=${scenario.affectedOutputIds.length}; preserved=${scenario.productionImmutability.preserved}`).join('\n')}\n\n## Simulation-Linked Workflows\n\n${orchestration.workflowSimulationImpacts.map(workflowBlock).join('\n') || '_No simulation-linked workflows generated._'}\n`);

console.log(`Generated ${orchestration.workflows.length} workflows and reports in ${outputDir}`);
console.log(`workflowHash=${orchestration.deterministicHash}`);
console.log(orchestration.highestPriorityWorkflows.slice(0, 5).map(workflow => `${workflow.workflowType} ${workflow.deterministicScore} ${workflow.deterministicHash}`).join('\n'));
