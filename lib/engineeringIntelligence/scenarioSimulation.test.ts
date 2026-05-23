import { describe, expect, it } from 'vitest';
import { hydrateProjectEngineeringIntelligence } from './projectHydration';
import { simulateEngineeringScenario } from './scenarioSimulation';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db-neon';
import type { EngineeringScenarioOperation } from './scenarioSimulation';

const generatedAt = '2025-01-01T00:00:00.000Z';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-scenario-1',
    clientId: 'client-1',
    projectId: 'project-scenario-1',
    createdBy: 'user-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Scenario Way',
    surveyData: {
      systemType: 'roof',
      geometry: { usableAreaSqFt: 510, roofPlanes: [{ id: 'plane-a', azimuth: 180, pitch: 27, area: 510 }] },
      structural: { rafterSpacingIn: 24, rafterSize: '2x6', roofMaterial: 'composition shingle', roofPitch: '27', atticAccess: true },
      electrical: { mainPanelRatingAmps: 200, busbarRatingAmps: 225, breakerSpacesAvailable: 4, interconnectionPoint: 'load-side breaker', panelBrand: 'Square D' },
    },
    inspectorName: 'Field Tech',
    notes: 'Scenario survey fixture.',
    externalSurveyId: null,
    deliveryId: null,
    ...overrides,
  };
}

function file(id: string, label: string, createdAt = '2024-12-31T20:15:00.000Z'): SiteSurveyFile {
  return { id, surveyId: 'survey-scenario-1', fileUrl: `https://example.test/${id}.jpg`, fileType: 'photo', label, filename: `${label}.jpg`, mimeType: 'image/jpeg', createdAt };
}

function hydratedFixture() {
  return hydrateProjectEngineeringIntelligence({
    projectId: 'project-scenario-1',
    generatedAt,
    sources: [{ survey: survey(), files: [file('file-site-overview', 'site_overview'), file('file-meter', 'utility_meter'), file('file-main-panel', 'main_panel'), file('file-roof-overview', 'roof_overview'), file('file-obstruction', 'roof_obstruction'), file('file-attic', 'attic_rafters')] }],
  });
}

function simulate(operations: EngineeringScenarioOperation[]) {
  const hydrated = hydratedFixture();
  return {
    hydrated,
    result: simulateEngineeringScenario({
      scenarioId: 'scenario:test',
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
      registry: hydrated.snapshots[1]?.stateRefs ? undefined : undefined,
      invalidationResult: hydrated.invalidationResult,
      persistentGraph: hydrated.stateGraph,
      snapshots: hydrated.snapshots,
      existingRegenerationPlans: hydrated.regenerationPlans,
    }),
  };
}

describe('Engineering Scenario Simulation V1', () => {
  it('runs in read-only sandbox mode and preserves deterministic replay stability', () => {
    const hydrated = hydratedFixture();
    const operations: EngineeringScenarioOperation[] = [{ operationId: 'remove-main-panel', operationType: 'remove_evidence', evidenceIds: [hydrated.surveyEvidence?.photos.find(photo => photo.category === 'main_service_panel')?.id ?? 'missing'], deterministicReason: 'What if MSP evidence was removed?' }];
    const input = {
      scenarioId: 'scenario:replay',
      scenarioType: 'evidence_change' as const,
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
    };
    const first = simulateEngineeringScenario(input);
    const second = simulateEngineeringScenario(input);

    expect(first.mode).toBe('read_only_sandbox');
    expect(first.productionImmutability.preserved).toBe(true);
    expect(first.productionImmutability.baselineHashBefore).toBe(first.productionImmutability.baselineHashAfter);
    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(first.hypothetical.structuredSignals.signals.map(signal => signal.deterministicHash)).toEqual(second.hypothetical.structuredSignals.signals.map(signal => signal.deterministicHash));
    expect(hydrated.structuredSignals).toBe(input.baselineStructuredSignals);
    expect(first.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no OCR', 'no autonomous CAD generation', 'no production engineering state mutation']));
  });

  it('forecasts signal invalidation, context impact, stale propagation, regeneration candidates, and snapshot deltas', () => {
    const { result } = simulate([
      { operationId: 'invalidate-msp-signal', operationType: 'invalidate_signal', signalTypes: ['main_service_panel_present'], deterministicReason: 'What if MSP signal became invalid?' },
      { operationId: 'block-msp-context', operationType: 'invalidate_context', contextTypes: ['preferred_msp_context'], deterministicReason: 'What if preferred MSP context was blocked?' },
    ]);

    expect(result.affectedSignalIds).toContain('signal:main_service_panel_present');
    expect(result.affectedContextIds).toContain('context:preferred_msp_context');
    expect(result.unresolvedStateChanges.length).toBeGreaterThan(0);
    expect(result.hypothetical.invalidationPropagation.deterministicNotes.join(' ')).toContain('No OCR');
    expect(result.hypothetical.regenerationPlan.deterministicNotes.join(' ')).toContain('never regenerates');
    expect(result.hypothetical.snapshotDelta.entries.length).toBeGreaterThan(0);
    expect(result.dependencyTraversalPaths).toEqual([...result.dependencyTraversalPaths].sort((a, b) => a.pathId.localeCompare(b.pathId)));
  });

  it('preserves fallback/conflict visibility for hypothetical conflict introduction and fallback removal', () => {
    const { result } = simulate([
      { operationId: 'conflict-routing', operationType: 'introduce_signal_conflict', signalTypes: ['routing_continuity_present'], deterministicReason: 'What if routing continuity became unstable?' },
      { operationId: 'remove-context-fallback', operationType: 'remove_fallback', contextTypes: ['preferred_routing_context'], deterministicReason: 'What if routing fallback were disallowed?' },
      { operationId: 'force-cad-blocked', operationType: 'set_cad_readiness', flagIds: ['routing-ready'], status: 'blocked', deterministicReason: 'What if routing CAD readiness became blocked?' },
    ]);

    expect(result.deltas.some(delta => delta.entityType === 'signal' && delta.entityId === 'signal:routing_continuity_present')).toBe(true);
    expect(result.deltas.some(delta => delta.entityType === 'cad_readiness' && delta.entityId === 'routing-ready')).toBe(true);
    expect(result.hypothetical.cadReadiness.blockedFlags).toContain('routing-ready');
    expect(result.confidenceDeltas.some(row => row.entityId === 'signal:routing_continuity_present')).toBe(true);
  });
});
