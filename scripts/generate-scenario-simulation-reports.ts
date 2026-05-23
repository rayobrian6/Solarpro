import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hydrateProjectEngineeringIntelligence } from '@/lib/engineeringIntelligence/projectHydration';
import { simulateEngineeringScenario, type EngineeringScenarioOperation, type EngineeringScenarioSimulationResult } from '@/lib/engineeringIntelligence/scenarioSimulation';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';

const generatedAt = '2025-01-01T00:00:00.000Z';
const outputDir = 'outputs/real-survey-data-validation';

function survey(): SiteSurvey {
  return {
    id: 'survey-scenario-report-1',
    clientId: 'client-report-1',
    projectId: 'project-scenario-report-1',
    createdBy: 'user-report-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '456 Deterministic Scenario Ave',
    surveyData: {
      systemType: 'roof',
      geometry: { usableAreaSqFt: 510, roofPlanes: [{ id: 'plane-a', azimuth: 180, pitch: 27, area: 510 }] },
      structural: { rafterSpacingIn: 24, rafterSize: '2x6', roofMaterial: 'composition shingle', roofPitch: '27', atticAccess: true },
      electrical: { mainPanelRatingAmps: 200, busbarRatingAmps: 225, breakerSpacesAvailable: 4, interconnectionPoint: 'load-side breaker', panelBrand: 'Square D' },
    },
    inspectorName: 'Field Tech',
    notes: 'Scenario report fixture using real deterministic runtime builders.',
    externalSurveyId: null,
    deliveryId: null,
  };
}

function file(id: string, label: string, createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId: 'survey-scenario-report-1', fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-scenario-report-1',
    generatedAt,
    sources: [{
      survey: survey(),
      files: [
        file('file-site-overview', 'site_overview'),
        file('file-meter', 'utility_meter'),
        file('file-main-panel', 'main_panel'),
        file('file-roof-overview', 'roof_overview'),
        file('file-obstruction', 'roof_obstruction'),
        file('file-attic', 'attic_rafters'),
      ],
    }],
  });
}

function runScenario(scenarioId: string, operations: EngineeringScenarioOperation[]) {
  const hydrated = hydratedFixture();
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

const evidenceRemoval = runScenario('scenario:report:evidence-removal', [
  { operationId: 'remove-main-panel-evidence', operationType: 'remove_evidence', evidenceIds: ['file-main-panel'], deterministicReason: 'What if main service panel evidence were unavailable?' },
]);

const signalContextInvalidation = runScenario('scenario:report:signal-context-invalidation', [
  { operationId: 'invalidate-msp-signal', operationType: 'invalidate_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if the MSP signal became invalid?' },
  { operationId: 'block-msp-context', operationType: 'invalidate_context', contextTypes: ['preferred_msp_context'], deterministicReason: 'What if preferred MSP context could no longer be trusted?' },
]);

const conflictFallbackCad = runScenario('scenario:report:conflict-fallback-cad', [
  { operationId: 'conflict-routing', operationType: 'introduce_signal_conflict', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity became conflicting?' },
  { operationId: 'remove-routing-fallback', operationType: 'remove_fallback', contextTypes: ['preferred_routing_context'], deterministicReason: 'What if routing fallback were unavailable?' },
  { operationId: 'force-routing-cad-blocked', operationType: 'set_cad_readiness', flagIds: ['routing-ready'], status: 'blocked', deterministicReason: 'What if routing CAD readiness were blocked?' },
]);

const scenarios = [evidenceRemoval, signalContextInvalidation, conflictFallbackCad];

function list(values: unknown[] | undefined, empty = '_none_') {
  if (!values || values.length === 0) return empty;
  return values.map(value => `- ${String(value)}`).join('\n');
}

function scenarioSummary(result: EngineeringScenarioSimulationResult) {
  return `### ${result.scenarioId}\n\n- Mode: ${result.mode}\n- Deterministic hash: \`${result.deterministicHash}\`\n- Production immutability preserved: ${result.productionImmutability.preserved}\n- Baseline hash before: \`${result.productionImmutability.baselineHashBefore}\`\n- Baseline hash after: \`${result.productionImmutability.baselineHashAfter}\`\n- Operations: ${result.operations.map(op => op.operationId).join(', ') || 'none'}\n- Delta rows: ${result.deltas.length}\n- Affected evidence ids: ${result.affectedEvidenceIds.join(', ') || 'none'}\n- Affected signal ids: ${result.affectedSignalIds.join(', ') || 'none'}\n- Affected context ids: ${result.affectedContextIds.join(', ') || 'none'}\n- Affected requirement ids: ${result.affectedRequirementIds.join(', ') || 'none'}\n- Affected decision ids: ${result.affectedDecisionIds.join(', ') || 'none'}\n- Affected output ids: ${result.affectedOutputIds.join(', ') || 'none'}\n- Regeneration candidates: ${result.regenerationCandidateIds.join(', ') || 'none'}\n- Dependency traversal paths: ${result.dependencyTraversalPaths.length}\n`;
}

function deltaRows(result: EngineeringScenarioSimulationResult) {
  if (!result.deltas.length) return '_No hypothetical deltas produced._';
  return result.deltas.map(delta => `- ${delta.deltaId}: ${delta.entityType} ${delta.entityId} ${delta.previousStatus} → ${delta.simulatedStatus}; stale=${delta.staleClass}; reason=${delta.deterministicReason}`).join('\n');
}

function confidenceRows(result: EngineeringScenarioSimulationResult) {
  if (!result.confidenceDeltas.length) return '_No confidence deltas produced._';
  return result.confidenceDeltas.map(row => `- ${row.entityType} ${row.entityId}: ${row.previousScore} → ${row.simulatedScore} (delta ${row.delta}); ${row.deterministicReason}`).join('\n');
}

function write(name: string, body: string) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, name), body);
}

write('scenario-simulation-v1-report.md', `# Deterministic Engineering Scenario Simulation V1 Report\n\nGenerated at: ${generatedAt}\n\nThis report was generated from the Scenario Simulation V1 engine using the existing deterministic Engineering Intelligence runtime. The engine executed in read-only sandbox mode and did not mutate canonical survey evidence, production snapshots, requirements, decisions, outputs, or invalidation history.\n\n## Runtime Boundary\n\n${list(evidenceRemoval.prohibitedRuntimeBehavior)}\n\n## Scenario Summaries\n\n${scenarios.map(scenarioSummary).join('\n')}\n\n## Deterministic Explanations\n\n${scenarios.map(result => `### ${result.scenarioId}\n${list(result.deterministicExplanation)}`).join('\n\n')}\n`);

write('scenario-impact-analysis-v1-report.md', `# Scenario Impact Analysis V1 Report\n\nGenerated at: ${generatedAt}\n\nThis impact analysis summarizes hypothetical affected signals, contexts, requirements, outputs, stale propagation, regeneration forecast metadata, and dependency traversal. It is not production truth and does not represent completed regeneration.\n\n${scenarios.map(result => `## ${result.scenarioId}\n\n### Affected Outputs\n${list(result.affectedOutputIds)}\n\n### Stale Impacts\n${result.staleImpacts.length ? result.staleImpacts.map(impact => `- ${impact.entityId}: ${impact.staleClasses.join(', ')}; ${impact.deterministicReason}`).join('\n') : '_No stale impacts produced._'}\n\n### Regeneration Forecast\n- Candidate ids: ${result.regenerationCandidateIds.join(', ') || 'none'}\n- Review-required ids: ${result.hypothetical.regenerationPlan.reviewRequiredIds.join(', ') || 'none'}\n- Blocked dependency ids: ${result.hypothetical.regenerationPlan.blockedDependencyIds.join(', ') || 'none'}\n- Missing evidence ids: ${result.hypothetical.regenerationPlan.missingEvidenceIds.join(', ') || 'none'}\n\n### Dependency Traversal\n- Visited nodes: ${result.hypothetical.dependencyTraversal.visitedNodeIds.length}\n- Paths: ${result.dependencyTraversalPaths.length}\n- Cycle detected: ${result.hypothetical.dependencyTraversal.cycleDetected}\n- Truncated: ${result.hypothetical.dependencyTraversal.truncated}\n`).join('\n')}\n`);

write('hypothetical-state-delta-v1-report.md', `# Hypothetical State Delta V1 Report\n\nGenerated at: ${generatedAt}\n\nThis report enumerates production-vs-hypothetical deltas generated by Scenario Simulation V1. Every row is derived from deterministic metadata recomputation and explicit scenario operations; no production state is overwritten.\n\n${scenarios.map(result => `## ${result.scenarioId}\n\n### Delta Rows\n${deltaRows(result)}\n\n### Fallback Deltas\n${result.fallbackDeltas.length ? result.fallbackDeltas.map(delta => `- ${delta.deltaId}: ${delta.entityId}; ${delta.deterministicReason}`).join('\n') : '_No fallback deltas._'}\n\n### Conflict Deltas\n${result.conflictDeltas.length ? result.conflictDeltas.map(delta => `- ${delta.deltaId}: ${delta.entityId}; ${delta.deterministicReason}`).join('\n') : '_No conflict deltas._'}\n\n### Confidence Deltas\n${confidenceRows(result)}\n\n### Immutability Proof\n- Preserved: ${result.productionImmutability.preserved}\n- Before hash: \`${result.productionImmutability.baselineHashBefore}\`\n- After hash: \`${result.productionImmutability.baselineHashAfter}\`\n`).join('\n')}\n`);

console.log(`Generated ${scenarios.length} scenario simulations and reports in ${outputDir}`);
console.log(scenarios.map(result => `${result.scenarioId} ${result.deterministicHash}`).join('\n'));
