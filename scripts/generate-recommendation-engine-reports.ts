import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import { hydrateProjectEngineeringIntelligence } from '@/lib/engineeringIntelligence/projectHydration';
import { buildEngineeringRecommendations, type EngineeringRecommendation, type EngineeringRecommendationSummary } from '@/lib/engineeringIntelligence';
import { simulateEngineeringScenario, type EngineeringScenarioOperation } from '@/lib/engineeringIntelligence/scenarioSimulation';

const generatedAt = '2025-01-01T00:00:00.000Z';
const outputDir = 'outputs/real-survey-data-validation';

function survey(): SiteSurvey {
  return {
    id: 'survey-recommendation-report-1',
    clientId: 'client-recommendation-report-1',
    projectId: 'project-recommendation-report-1',
    createdBy: 'user-recommendation-report-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '789 Deterministic Recommendation Ave',
    surveyData: {
      systemType: 'roof',
      geometry: { usableAreaSqFt: 480, roofPlanes: [{ id: 'plane-a', azimuth: 180, pitch: 24, area: 480 }] },
      structural: { roofMaterial: 'composition shingle', roofPitch: '24', atticAccess: false },
      electrical: { interconnectionPoint: 'unknown' },
    },
    inspectorName: 'Field Tech',
    notes: 'Recommendation report fixture using deterministic runtime builders with intentional survey gaps.',
    externalSurveyId: null,
    deliveryId: null,
  };
}

function file(id: string, label: string, createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId: 'survey-recommendation-report-1', fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-recommendation-report-1',
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
  runScenario(hydrated, 'scenario:recommendation:msp-confirmation', [
    { operationId: 'strengthen-msp-signal', operationType: 'strengthen_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if explicit MSP confirmation were supplied?' },
  ]),
  runScenario(hydrated, 'scenario:recommendation:routing-confirmation', [
    { operationId: 'strengthen-routing-signal', operationType: 'strengthen_signal', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity were explicitly confirmed?' },
  ]),
  runScenario(hydrated, 'scenario:recommendation:trench-resolution', [
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

function list(values: unknown[] | undefined, empty = '_none_') {
  if (!values || values.length === 0) return empty;
  return values.map(value => `- ${String(value)}`).join('\n');
}

function recommendationBlock(recommendation: EngineeringRecommendation) {
  return `### ${recommendation.recommendationType}\n\n- Recommendation id: \`${recommendation.recommendationId}\`\n- Priority: ${recommendation.priority}\n- Severity: ${recommendation.severity}\n- Confidence: ${recommendation.confidence}\n- Deterministic score: ${recommendation.deterministicScore}\n- Deterministic hash: \`${recommendation.deterministicHash}\`\n- Expected confidence gain: ${recommendation.expectedConfidenceGain}\n- Expected readiness gain: ${recommendation.expectedReadinessGain}\n- Affected evidence: ${recommendation.affectedEvidenceIds.join(', ') || 'none'}\n- Affected signals: ${recommendation.affectedSignalIds.join(', ') || 'none'}\n- Affected contexts: ${recommendation.affectedContextIds.join(', ') || 'none'}\n- Affected requirements: ${recommendation.affectedRequirementIds.join(', ') || 'none'}\n- Affected decisions: ${recommendation.affectedDecisionIds.join(', ') || 'none'}\n- Affected outputs: ${recommendation.affectedOutputIds.join(', ') || 'none'}\n- CAD-readiness impact: ${recommendation.cadReadinessImpact.join(', ') || 'none'}\n\n${recommendation.explanation}\n\n#### Why it exists\n\n${recommendation.scoreBreakdown.deterministicReason}\n\n#### Uncertainty preserved\n\n${list(recommendation.uncertaintyNotes)}\n`;
}

function rankingRow(recommendation: EngineeringRecommendation) {
  const score = recommendation.scoreBreakdown;
  return `- ${recommendation.recommendationType}: score=${recommendation.deterministicScore}; stale=${score.staleImpactCount}; outputs=${score.affectedOutputCount}; depth=${score.invalidationPropagationDepth}; blockedRequirements=${score.blockedRequirementCount}; cad=${score.cadReadinessImpact}; conflicts=${score.conflictSeverity}; fallbacks=${score.fallbackParticipation}; unresolved=${score.unresolvedDependencyCount}; centrality=${score.dependencyTraversalCentrality}; scenario=${score.scenarioSimulationImpact}; confidenceGain=${score.expectedConfidenceGain}; readinessGain=${score.expectedReadinessGain}`;
}

function simulationRow(summary: EngineeringRecommendationSummary) {
  return summary.simulationBackedRecommendations.map(recommendation => `## ${recommendation.recommendationType}\n\n- Recommendation id: \`${recommendation.recommendationId}\`\n- Deterministic score: ${recommendation.deterministicScore}\n- Scenario impact score component: ${recommendation.scoreBreakdown.scenarioSimulationImpact}\n- Confidence gain: ${recommendation.expectedConfidenceGain}\n- Readiness gain: ${recommendation.expectedReadinessGain}\n- Invalidation participation: ${recommendation.invalidationParticipation.join(', ') || 'none'}\n- Regeneration participation: ${recommendation.regenerationParticipation.join(', ') || 'none'}\n- Fallback participation: ${recommendation.fallbackParticipation.join(', ') || 'none'}\n- Conflict participation: ${recommendation.conflictParticipation.join(', ') || 'none'}\n- Dependency paths: ${recommendation.dependencyTraversal.length}\n- CAD readiness impacts: ${recommendation.cadReadinessImpact.join(', ') || 'none'}\n\n### Unresolved-state preservation\n${list(recommendation.unresolvedStatesPreserved)}\n`).join('\n');
}

function write(name: string, body: string) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, name), body);
}

write('recommendation-engine-v1-report.md', `# Deterministic Engineering Recommendation Engine V1 Report\n\nGenerated at: ${generatedAt}\n\nThis report was generated from the deterministic Engineering Recommendation System V1. Recommendations are guidance only; they do not mutate production evidence, requirements, decisions, outputs, invalidation history, snapshots, CAD assets, or regeneration plans.\n\n## Runtime Boundary\n\n${list(recommendations.prohibitedRuntimeBehavior)}\n\n## Deterministic Notes\n\n${list(recommendations.deterministicNotes)}\n\n## Top Recommendations\n\n${recommendations.highestValueNextActions.map(recommendationBlock).join('\n')}\n\n## Unresolved States Preserved\n\n${list(recommendations.unresolvedStatesPreserved)}\n`);

write('recommendation-ranking-v1-report.md', `# Deterministic Recommendation Ranking V1 Report\n\nGenerated at: ${generatedAt}\n\nRanking is deterministic and uses explicit metadata counters only. Tie-breaking is stable by score, severity, priority, category, type, and id. No AI weights, randomness, hidden confidence boosting, or LLM reasoning are used.\n\n## Ranking Reasoning\n\n${recommendations.recommendations.map(rankingRow).join('\n')}\n\n## Recommendation Confidence Breakdown\n\n${recommendations.confidenceBreakdown.map(row => `- ${row.recommendationId}: confidence=${row.confidence}; expectedConfidenceGain=${row.expectedConfidenceGain}; expectedReadinessGain=${row.expectedReadinessGain}; score=${row.deterministicScore}; uncertainty=${row.uncertaintyNotes.join(' | ')}`).join('\n')}\n`);

write('recommendation-simulation-impact-v1-report.md', `# Recommendation Simulation Impact V1 Report\n\nGenerated at: ${generatedAt}\n\nSimulation-backed recommendations are derived from Scenario Simulation V1 sandbox deltas. They remain hypothetical guidance only and are not production truth.\n\n## Scenario Hashes\n\n${scenarios.map(scenario => `- ${scenario.scenarioId}: \`${scenario.deterministicHash}\`; deltas=${scenario.deltas.length}; confidenceDeltas=${scenario.confidenceDeltas.length}; outputs=${scenario.affectedOutputIds.length}`).join('\n')}\n\n## Simulation-Backed Recommendations\n\n${simulationRow(recommendations) || '_No simulation-backed recommendations generated._'}\n`);

console.log(`Generated ${recommendations.recommendations.length} recommendations and reports in ${outputDir}`);
console.log(`summaryHash=${recommendations.deterministicHash}`);
console.log(recommendations.highestValueNextActions.slice(0, 5).map(recommendation => `${recommendation.recommendationType} ${recommendation.deterministicScore} ${recommendation.deterministicHash}`).join('\n'));
