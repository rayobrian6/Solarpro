import { describe, expect, it } from 'vitest';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import { hydrateProjectEngineeringIntelligence } from './projectHydration';
import { buildEngineeringRecommendations } from './recommendationEngine';
import { rankEngineeringRecommendations } from './recommendationRanking';
import { scoreEngineeringRecommendation } from './recommendationScoring';
import { simulateEngineeringScenario, type EngineeringScenarioOperation } from './scenarioSimulation';

const generatedAt = '2025-01-01T00:00:00.000Z';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-recommendation-1',
    clientId: 'client-1',
    projectId: 'project-recommendation-1',
    createdBy: 'user-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Recommendation Way',
    surveyData: { systemType: 'roof', geometry: {}, structural: {}, electrical: {} },
    inspectorName: 'Field Tech',
    notes: 'Recommendation fixture.',
    externalSurveyId: null,
    deliveryId: null,
    ...overrides,
  };
}

function file(id: string, label: string, surveyId = 'survey-recommendation-1', createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId, fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedSparseFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-recommendation-1',
    generatedAt,
    sources: [{ survey: survey(), files: [file('file-overview', 'site_overview'), file('file-roof', 'roof_overview')] }],
  });
}

function hydratedFallbackFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-recommendation-1',
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

describe('Engineering Recommendation System V1', () => {
  it('ranks missing MSP evidence and sparse survey gaps without mutating state', () => {
    const hydrated = hydratedSparseFixture();
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
    });

    expect(recommendations.mode).toBe('deterministic_guidance_only');
    expect(recommendations.recommendations.length).toBeGreaterThan(0);
    expect(recommendations.recommendations.some(recommendation => recommendation.recommendationType === 'collect_msp_photo')).toBe(true);
    expect(recommendations.recommendations.some(recommendation => recommendation.recommendationType === 'collect_trench_path')).toBe(true);
    expect(recommendations.recommendations.some(recommendation => recommendation.cadReadinessImpact.includes('trench-route-ready'))).toBe(true);
    expect(recommendations.unresolvedStatesPreserved.length).toBeGreaterThan(0);
    expect(recommendations.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no OCR', 'no autonomous CAD generation', 'no hidden confidence boosting']));
    expect(hydrated.structuredSignals.signals.length).toBeGreaterThan(0);
  });

  it('preserves conflicts, fallback participation, blocked CAD readiness, stale propagation, and simulation-backed ranking', () => {
    const hydrated = hydratedFallbackFixture();
    const simulations = [
      scenario(hydrated, 'scenario:recommendation:conflict-routing', [
        { operationId: 'conflict-routing', operationType: 'introduce_signal_conflict', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity conflicted?' },
        { operationId: 'remove-routing-fallback', operationType: 'remove_fallback', contextTypes: ['preferred_routing_context'], deterministicReason: 'What if routing fallback were unavailable?' },
        { operationId: 'block-routing-cad', operationType: 'set_cad_readiness', flagIds: ['routing-ready'], status: 'blocked', deterministicReason: 'What if routing CAD readiness were blocked?' },
      ]),
      scenario(hydrated, 'scenario:recommendation:msp-confirmation', [
        { operationId: 'strengthen-msp', operationType: 'strengthen_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if MSP evidence improved?' },
      ]),
    ];

    const first = buildEngineeringRecommendations({
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
    const second = buildEngineeringRecommendations({
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

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.recommendations.map(recommendation => recommendation.recommendationId)).toEqual(second.recommendations.map(recommendation => recommendation.recommendationId));
    expect(first.simulationBackedRecommendations.length).toBeGreaterThan(0);
    expect(first.fallbackReductionRecommendations.length).toBeGreaterThan(0);
    expect(first.cadReadinessRecommendations.length).toBeGreaterThan(0);
    expect(first.staleImpactRecommendations.length).toBeGreaterThan(0);
    expect(first.dependencyRiskRecommendations.length).toBeGreaterThan(0);
    expect(first.recommendations.some(recommendation => recommendation.conflictParticipation.length > 0)).toBe(true);
    expect(first.recommendations.some(recommendation => recommendation.scoreBreakdown.scenarioSimulationImpact > 0)).toBe(true);
    expect(first.recommendations).toEqual(rankEngineeringRecommendations(first.recommendations));
  });

  it('keeps scoring stable and tie-breaking deterministic', () => {
    const score = scoreEngineeringRecommendation({
      staleImpactCount: 1,
      affectedOutputCount: 2,
      invalidationPropagationDepth: 3,
      blockedRequirementCount: 4,
      cadReadinessImpact: 5,
      conflictSeverity: 6,
      fallbackParticipation: 7,
      unresolvedDependencyCount: 8,
      dependencyTraversalCentrality: 9,
      contextAuthorityWeakness: 1,
      scenarioSimulationImpact: 2,
      expectedReadinessGain: 0.5,
      expectedConfidenceGain: 0.25,
      deterministicReason: 'fixed scoring fixture',
    });

    expect(score.deterministicScore).toBe(1 * 10 + 2 * 8 + 3 * 5 + 4 * 9 + 5 * 7 + 6 * 10 + 7 * 6 + 8 * 7 + 9 * 4 + 1 * 6 + 2 * 8 + 10 + 5);

    const hydrated = hydratedSparseFixture();
    const recommendations = buildEngineeringRecommendations({
      projectId: hydrated.projectId,
      surveyId: hydrated.canonicalSurveyId,
      generatedAt,
      cadReadiness: hydrated.cadReadiness,
      structuredSignals: hydrated.structuredSignals,
      contextResolution: hydrated.contextResolution,
      invalidationPropagation: hydrated.invalidationPropagation,
      regenerationPlan: hydrated.regenerationPlanV1,
    });
    const tied = recommendations.recommendations.slice(0, 2).map(recommendation => ({ ...recommendation, deterministicScore: 100, scoreBreakdown: { ...recommendation.scoreBreakdown, deterministicScore: 100 } }));
    expect(rankEngineeringRecommendations(tied).map(recommendation => recommendation.recommendationId)).toEqual([...tied].sort((a, b) => a.category.localeCompare(b.category) || a.recommendationType.localeCompare(b.recommendationType) || a.recommendationId.localeCompare(b.recommendationId)).map(recommendation => recommendation.recommendationId));
  });
});
