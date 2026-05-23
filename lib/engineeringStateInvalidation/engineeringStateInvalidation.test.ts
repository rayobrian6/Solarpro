import { describe, expect, it } from 'vitest';

import type { CADModel } from '@/lib/cad/types';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { PermitInput } from '@/lib/permit/types';
import { buildDocumentProvenanceBundle } from '@/lib/documentProvenance';
import { buildRenderContext } from '@/lib/drafting/renderContext';
import { buildEngineeringDecisionProvenanceBundle, buildDecisionAwareBOMMetadata, buildDecisionAwareSLDMetadata } from '@/lib/engineeringDecisionProvenance';
import { buildEngineeringRequirementEvaluation } from '@/lib/survey/evidence/engineeringRequirements';
import { buildProjectSurveyEvidenceHygiene } from '@/lib/survey/evidence/sessionGrouping';
import {
  assertEngineeringStateAuditGuards,
  buildEngineeringStateRegistry,
  buildEngineeringStateSnapshot,
  buildEngineeringStateTimeline,
  buildEngineeringStateTransitionHistory,
  buildPersistentEngineeringStateGraph,
  buildInvalidationLineageMetadata,
  buildInvalidationTrigger,
  buildSelectiveRegenerationPlan,
  diffEngineeringStateSnapshots,
  engineeringStateSnapshotReference,
  invalidateEngineeringState,
  runEngineeringStateAuditGuards,
  staleMetadataForState,
  type EngineeringStateRecord,
  type PersistentEngineeringStateGraph,
} from './index';

const generatedAt = '2026-05-23T11:00:00.000Z';
const baseTime = Date.parse('2026-05-23T10:00:00.000Z');

function survey(index: number): SiteSurvey {
  const submittedAt = new Date(baseTime + index * 60_000).toISOString();
  return {
    id: `survey-state-${index}`,
    clientId: 'client-state-1',
    projectId: 'project-state-1',
    createdBy: 'tech-state-1',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '789 State Trace Ave',
    surveyData: { schemaVersion: '2.0', photos: [], siteOverview: { inspectorName: 'State Tech' } },
    inspectorName: 'State Tech',
    notes: null,
    externalSurveyId: `external-state-${index}`,
    deliveryId: `delivery-state-${index}`,
    fileCount: 4,
  };
}

function repeatedFiles(surveyId: string): SiteSurveyFile[] {
  return [
    { id: `${surveyId}-main-panel`, surveyId, fileUrl: `https://storage.example/${surveyId}/main-panel.jpg`, fileType: 'photo', label: 'Main Panel Photo', filename: 'main-panel.jpg', mimeType: 'image/jpeg', createdAt: generatedAt },
    { id: `${surveyId}-meter`, surveyId, fileUrl: `https://storage.example/${surveyId}/meter.jpg`, fileType: 'photo', label: 'Meter Photo', filename: 'meter.jpg', mimeType: 'image/jpeg', createdAt: generatedAt },
    { id: `${surveyId}-roof`, surveyId, fileUrl: `https://storage.example/${surveyId}/roof-plane.jpg`, fileType: 'photo', label: 'roof_overview', filename: 'roof-plane.jpg', mimeType: 'image/jpeg', createdAt: generatedAt },
    { id: `${surveyId}-overview`, surveyId, fileUrl: `https://storage.example/${surveyId}/site-overview.jpg`, fileType: 'photo', label: 'Site Overview Photo', filename: 'site-overview.jpg', mimeType: 'image/jpeg', createdAt: generatedAt },
  ];
}

function evidenceFromDuplicateHygiene(count = 4): EngineeringSurveyEvidence {
  const surveys = Array.from({ length: count }, (_, index) => {
    const s = survey(index + 1);
    return { survey: s, files: repeatedFiles(s.id) };
  });
  const hygiene = buildProjectSurveyEvidenceHygiene({ projectId: 'project-state-1', surveys, generatedAt });
  const requirementEvaluation = buildEngineeringRequirementEvaluation({ canonicalManifest: hygiene.canonicalManifest, traceability: hygiene.traceability });
  return {
    projectId: 'project-state-1',
    surveyId: hygiene.canonicalSurveyId ?? `survey-state-${count}`,
    photos: hygiene.canonicalManifest.items.map(item => ({ id: item.evidenceId, projectId: item.projectId ?? 'project-state-1', surveyId: item.surveyId, fileUrl: item.fileUrl, fileId: item.siteSurveyFileId ?? undefined, sourceCategory: 'other', category: item.category, confidence: 0.9 })),
    rawPhotoCount: hygiene.rawEvidenceCount,
    canonicalEvidenceCount: hygiene.canonicalEvidenceCount,
    evidenceTruthSource: 'canonical_manifest_v1',
    traceability: hygiene.traceability,
    requirementEvaluation,
    missingCategories: requirementEvaluation.blockedRequirements.flatMap(requirement => requirement.requiredEvidenceCategories),
    completeness: requirementEvaluation.completeness,
    blockers: [],
    warnings: [],
    fieldEvidence: { hasPhysicalData: true, hasRoofGeometry: true, hasElectricalData: true, hasStructuralData: true, roofPlaneCount: 1, obstructionCount: 0, usableAreaSqFt: 500, mainPanelRatingAmps: 200, busbarRatingAmps: 225, interconnectionPoint: 'main_panel', rafterSize: '2x6', rafterSpacingInches: 24, roofMaterial: 'composition_shingle', roofPitchDegrees: 20 },
    source: { pipelineVersion: 1, normalizedAt: generatedAt },
  };
}

function mockCad(): CADModel {
  return {
    systemType: 'roof', version: 'test-cad-state-v1', roof: { planes: [{ id: 'roof-plane-1', polygon: [], usablePolygon: [], pitch: 20, azimuth: 180, areaSqM: 50, setbacks: { eaveM: 0.46, ridgeM: 0.46, rakeM: 0.46 }, panels: [], dimensions: { widthM: 10, heightM: 5, panelCountX: 5, panelCountY: 2 } }], totalPanels: 10, setbackIn: 18, ridgeSetbackIn: 18 }, totalPanels: 10, totalDcKw: 4, panelWidthM: 1, panelHeightM: 1.7, originLat: 34, originLng: -118, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5, width: 10, height: 5, cx: 5, cy: 2.5 }, dimensions: [{ id: 'overall-width', type: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0, valueFt: 32.8, label: 'Overall Width', level: 3 }], electricalNodes: [{ id: 'msp', type: 'panel', x: 1, y: 1, label: 'MSP' } as any], solveMs: 5, warnings: [],
  };
}

function permitInput(): PermitInput {
  return {
    project: { projectName: 'State Invalidation Project', clientName: 'State Client', address: '789 State Trace Ave', designer: 'SolarPro Test', date: '2026-05-23', notes: '', systemType: 'roof', mainPanelAmps: 200, mainPanelBrand: 'Square D', utilityMeter: 'utility-meter-1', utilityName: 'Test Utility', acDisconnect: true, dcDisconnect: true, productionMeter: false, rapidShutdown: true, conduitType: 'EMT', wireGauge: '#10 AWG', wireLength: 65, interconnectionMethod: 'LOAD_SIDE', panelBusRating: 225, ahjRoofSetbackIn: 18, ahjRidgeSetbackIn: 18, panelPositions: [{ id: 'panel-1', lat: 34, lng: -118, orientation: 'portrait' }], roofPlanes: [{ id: 'roof-1', vertices: [], azimuth: 180, area: 500 }] },
    system: { totalDcKw: 4, totalAcKw: 3.8, totalPanels: 10, dcAcRatio: 1.05, topology: 'string', inverters: [{ manufacturer: 'Enphase', model: 'IQ8', type: 'string', acOutputKw: 3.8, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741', strings: [{ label: 'PV-1', panelCount: 10, panelManufacturer: 'REC', panelModel: 'Alpha', panelWatts: 400, panelVoc: 48, panelIsc: 10.5, wireGauge: '#10 AWG', wireLength: 65, ocpd: 20 }] }] },
    codes: { nec: '2020', ibc: '2021', ifc: '2021', ahj: 'Test AHJ' },
    compliance: { overallStatus: 'PASS', jurisdiction: { state: 'CA', necVersion: '2020', ahj: 'Test AHJ' } },
    bom: [{ id: 'bom-ac-breaker', category: 'electrical', description: 'PV breaker', quantity: 1, unit: 'ea', source: 'electrical_v4', necReference: 'NEC 705.12', derivedFrom: 'sldAdapter' } as any],
  } as PermitInput;
}

function buildFixture() {
  const surveyEvidence = evidenceFromDuplicateHygiene();
  const cad = mockCad();
  const permit = permitInput();
  const decisionProvenance = buildEngineeringDecisionProvenanceBundle({ bundleId: 'permit:state.decision-provenance', generatedAt, surveyEvidence, cad, permitInput: permit, renderContextIds: ['renderContext:primary'], includeDocumentMetadataDecisions: true });
  const documentProvenance = buildDocumentProvenanceBundle({ documentId: 'permit:state', documentType: 'permit_package', generatedAt, surveyEvidence, cad, permitInput: permit, decisionProvenance, renderInputs: { inputKeys: ['PermitInput', 'EngineeringSurveyEvidence'], canonicalInputKeys: ['CanonicalInput', 'SurveyEvidenceManifest'], cadPrimitiveIds: ['cad:roof:model'], legacyFallbackKeys: [] } });
  const bomMetadata = buildDecisionAwareBOMMetadata({ bomItems: permit.bom, decisionBundle: decisionProvenance });
  const sldMetadata = buildDecisionAwareSLDMetadata({ decisionBundle: decisionProvenance });
  const registry = buildEngineeringStateRegistry({ registryId: 'permit:state.engineering-state', generatedAt, documentProvenance, decisionProvenance, dependencyGraph: documentProvenance.dependencyGraph, renderContextIds: ['renderContext:primary'], bomMetadata, sldMetadata });
  return { surveyEvidence, cad, permit, decisionProvenance, documentProvenance, bomMetadata, sldMetadata, registry };
}

function firstEvidenceForRequirement(surveyEvidence: EngineeringSurveyEvidence, requirementId: string): string {
  return surveyEvidence.requirementEvaluation.allRequirements.find(requirement => requirement.requirementId === requirementId)?.canonicalEvidenceIds[0] ?? '';
}

describe('engineering state invalidation v1', () => {
  it('invalidates MSP evidence dependency chains without invalidating unrelated roof-only outputs', () => {
    const fixture = buildFixture();
    const mspEvidence = firstEvidenceForRequirement(fixture.surveyEvidence, 'main_service_panel');
    const trigger = buildInvalidationTrigger({ triggerId: 'trigger:msp-evidence', triggerType: 'canonical_evidence_changed', changedCanonicalEvidenceIds: [mspEvidence], triggeredAt: generatedAt, deterministicReason: 'MSP canonical evidence changed.' });
    const result = invalidateEngineeringState({ resultId: 'result:msp-evidence', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });

    expect(result.affectedStateIds).toContain('state:decision:decision:conductor_sizing');
    expect(result.affectedStateIds).toContain('state:decision:decision:utility_interconnection_assumption');
    expect(result.affectedStateIds.some(id => id.includes('bomRow:bom-ac-breaker'))).toBe(true);
    expect(result.affectedStateIds.some(id => id.includes('decision:decision:layout_orientation_assumption'))).toBe(false);
    expect(result.unaffectedStateIds).toContain('state:decision:decision:layout_orientation_assumption');
    expect(result.invalidationEvents.every(event => event.triggeringCanonicalEvidenceIds.includes(mspEvidence) || event.triggeringDependencyIds.length > 0)).toBe(true);
  });

  it('keeps unrelated outputs current when utility meter evidence changes', () => {
    const fixture = buildFixture();
    const meterEvidence = firstEvidenceForRequirement(fixture.surveyEvidence, 'utility_meter');
    const trigger = buildInvalidationTrigger({ triggerId: 'trigger:meter-evidence', triggerType: 'canonical_evidence_changed', changedCanonicalEvidenceIds: [meterEvidence], triggeredAt: generatedAt });
    const result = invalidateEngineeringState({ resultId: 'result:meter-evidence', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });

    expect(result.affectedStateIds).toContain('state:decision:decision:utility_interconnection_assumption');
    expect(result.affectedStateIds).toContain('state:decision:decision:sld_metadata');
    expect(result.affectedStateIds).not.toContain('state:decision:decision:setback_assumption');
    expect(result.updatedStateRecords.find(record => record.stateId === 'state:decision:decision:setback_assumption')?.staleStatus).toBe('current');
  });

  it('does not treat duplicate raw upload count changes as invalidation hash changes', () => {
    const fixture = buildFixture();
    const duplicateOnly = { ...fixture.surveyEvidence, rawPhotoCount: fixture.surveyEvidence.rawPhotoCount + 100 } satisfies EngineeringSurveyEvidence;
    const decision = buildEngineeringDecisionProvenanceBundle({ bundleId: 'permit:state.decision-provenance', generatedAt, surveyEvidence: duplicateOnly, cad: fixture.cad, permitInput: fixture.permit, renderContextIds: ['renderContext:primary'], includeDocumentMetadataDecisions: true });
    const doc = buildDocumentProvenanceBundle({ documentId: 'permit:state', documentType: 'permit_package', generatedAt, surveyEvidence: duplicateOnly, cad: fixture.cad, permitInput: fixture.permit, decisionProvenance: decision, renderInputs: { inputKeys: ['PermitInput', 'EngineeringSurveyEvidence'], canonicalInputKeys: ['CanonicalInput', 'SurveyEvidenceManifest'], cadPrimitiveIds: ['cad:roof:model'], legacyFallbackKeys: [] } });
    const bomMetadata = buildDecisionAwareBOMMetadata({ bomItems: fixture.permit.bom, decisionBundle: decision });
    const sldMetadata = buildDecisionAwareSLDMetadata({ decisionBundle: decision });
    const registry = buildEngineeringStateRegistry({ registryId: 'permit:state.engineering-state', generatedAt, documentProvenance: doc, decisionProvenance: decision, dependencyGraph: doc.dependencyGraph, renderContextIds: ['renderContext:primary'], bomMetadata, sldMetadata });

    expect(registry.deterministicHash).toBe(fixture.registry.deterministicHash);
    expect(registry.provenanceHash).toBe(fixture.registry.provenanceHash);
    expect(registry.stateRecords.some(record => record.generationInputs.deterministicSources.some(source => /raw/i.test(source)))).toBe(false);
  });

  it('carries stale-state metadata through render contexts', () => {
    const fixture = buildFixture();
    const lineage = buildInvalidationLineageMetadata({ registry: fixture.registry });
    const renderRecord = fixture.registry.stateRecords.find(record => record.stateId === 'state:renderContext:renderContext:primary')!;
    const ctx = buildRenderContext(fixture.cad, { documentProvenance: fixture.documentProvenance, decisionProvenance: fixture.decisionProvenance, engineeringStateRegistry: fixture.registry, invalidationLineage: lineage, staleStateMetadata: staleMetadataForState(renderRecord) });

    expect(ctx.engineeringStateRegistry?.registryId).toBe(fixture.registry.registryId);
    expect(ctx.invalidationLineage?.stateRegistryId).toBe(fixture.registry.registryId);
    expect(ctx.staleStateMetadata?.staleStatus).toBe('current');
  });

  it('builds deterministic selective regeneration plans', () => {
    const fixture = buildFixture();
    const roofEvidence = firstEvidenceForRequirement(fixture.surveyEvidence, 'roof_overview');
    const trigger = buildInvalidationTrigger({ triggerId: 'trigger:roof-evidence', triggerType: 'canonical_evidence_changed', changedCanonicalEvidenceIds: [roofEvidence], triggeredAt: generatedAt });
    const first = invalidateEngineeringState({ resultId: 'result:roof-evidence', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const second = invalidateEngineeringState({ resultId: 'result:roof-evidence', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const firstPlan = buildSelectiveRegenerationPlan({ planId: 'plan:roof-evidence', generatedAt, invalidationResult: first, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const secondPlan = buildSelectiveRegenerationPlan({ planId: 'plan:roof-evidence', generatedAt, invalidationResult: second, dependencyGraph: fixture.documentProvenance.dependencyGraph });

    expect(first.deterministicHash).toBe(second.deterministicHash);
    expect(firstPlan.deterministicHash).toBe(secondPlan.deterministicHash);
    expect(firstPlan.affectedLayoutPrimitives.some(id => id.includes('geometry:roof-layout-context'))).toBe(true);
    expect(firstPlan.regenerationOrder).toEqual([...firstPlan.regenerationOrder].sort((a, b) => {
      const order = ['requirement_evaluation', 'dependency_graph_node', 'decision_provenance', 'engineering_calculation', 'layout_primitive', 'bom_row', 'sld_section', 'document_section', 'render_context', 'render_output'];
      const typeFor = (id: string) => fixture.registry.stateRecords.find(record => record.stateId === id)?.stateType ?? 'render_output';
      return order.indexOf(typeFor(a)) - order.indexOf(typeFor(b)) || a.localeCompare(b);
    }));
    expect(firstPlan.unchangedPreservedOutputs).toEqual(first.unaffectedStateIds);
  });

  it('audit guards fail on stale lineage violations', () => {
    const fixture = buildFixture();
    const base = fixture.registry.stateRecords.find(record => record.decisionIds.length > 0)!;
    const broken: EngineeringStateRecord = { ...base, staleStatus: 'stale', dependencyNodeIds: [], provenanceHash: '', dependencyHash: '', generationInputs: { ...base.generationInputs, deterministicSources: ['rawUploadCount'] } };
    const guards = runEngineeringStateAuditGuards({ records: [broken], renderOutputExpected: true });

    expect(guards.find(guard => guard.guardCode === 'regeneration_requires_provenance_lineage')?.passed).toBe(false);
    expect(guards.find(guard => guard.guardCode === 'regeneration_from_raw_uploads_blocked')?.passed).toBe(false);
    expect(() => assertEngineeringStateAuditGuards({ records: [broken], renderOutputExpected: true })).toThrow(/regeneration_requires_provenance_lineage/);
  });

  it('persists stable engineering state snapshots with identical-input determinism', () => {
    const fixture = buildFixture();
    const graph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:persistence', generatedAt, registry: fixture.registry, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const first = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:persistence:001', generatedAt, registry: fixture.registry, stateGraph: graph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });
    const second = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:persistence:001', generatedAt: '2026-05-24T00:00:00.000Z', registry: fixture.registry, stateGraph: graph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });

    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.hashVector.dependencyGraphHash).toBe(fixture.documentProvenance.dependencyGraph?.deterministicHash);
    expect(first.stateRefs).toEqual([...first.stateRefs].sort((a, b) => a.stateId.localeCompare(b.stateId)));
    expect(graph.nodes).toEqual([...graph.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId)));
  });

  it('persists dependency-change invalidation lineage and preserved outputs', () => {
    const fixture = buildFixture();
    const mspEvidence = firstEvidenceForRequirement(fixture.surveyEvidence, 'main_service_panel');
    const baselineGraph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:baseline', generatedAt, registry: fixture.registry, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const baselineSnapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:baseline', generatedAt, registry: fixture.registry, stateGraph: baselineGraph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });
    const trigger = buildInvalidationTrigger({ triggerId: 'trigger:persistence:msp', triggerType: 'canonical_evidence_changed', changedCanonicalEvidenceIds: [mspEvidence], triggeredAt: generatedAt });
    const invalidation = invalidateEngineeringState({ resultId: 'result:persistence:msp', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const updatedRegistry = { ...fixture.registry, stateRecords: invalidation.updatedStateRecords, stateIds: invalidation.updatedStateRecords.map(record => record.stateId).sort((a, b) => a.localeCompare(b)) };
    const invalidatedGraph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:invalidated', generatedAt, registry: updatedRegistry, dependencyGraph: fixture.documentProvenance.dependencyGraph, invalidationResult: invalidation });
    const invalidatedSnapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:invalidated', generatedAt, registry: updatedRegistry, stateGraph: invalidatedGraph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance, invalidationResult: invalidation, previousSnapshot: baselineSnapshot });
    const diff = diffEngineeringStateSnapshots(baselineSnapshot, invalidatedSnapshot);

    expect(invalidatedSnapshot.previousSnapshotHash).toBe(baselineSnapshot.snapshotHash);
    expect(invalidatedSnapshot.staleStateIds).toEqual(invalidation.affectedStateIds);
    expect(diff.preservedStateIds).toEqual(invalidation.unaffectedStateIds);
    expect(diff.entries).toEqual([...diff.entries].sort((a, b) => a.diffId.localeCompare(b.diffId)));
    expect(invalidatedGraph.edges.some(edge => edge.edgeType === 'invalidates_state')).toBe(true);
  });

  it('persists stale-state transitions and exposes deterministic timeline helpers', () => {
    const fixture = buildFixture();
    const roofEvidence = firstEvidenceForRequirement(fixture.surveyEvidence, 'roof_overview');
    const baselineGraph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:timeline:baseline', generatedAt, registry: fixture.registry, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const baselineSnapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:timeline:001', generatedAt, registry: fixture.registry, stateGraph: baselineGraph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });
    const trigger = buildInvalidationTrigger({ triggerId: 'trigger:timeline:roof', triggerType: 'canonical_evidence_changed', changedCanonicalEvidenceIds: [roofEvidence], triggeredAt: generatedAt });
    const invalidation = invalidateEngineeringState({ resultId: 'result:timeline:roof', generatedAt, registry: fixture.registry, trigger, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const updatedRegistry = { ...fixture.registry, stateRecords: invalidation.updatedStateRecords, stateIds: invalidation.updatedStateRecords.map(record => record.stateId).sort((a, b) => a.localeCompare(b)) };
    const invalidatedGraph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:timeline:invalidated', generatedAt, registry: updatedRegistry, dependencyGraph: fixture.documentProvenance.dependencyGraph, invalidationResult: invalidation });
    const invalidatedSnapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:timeline:002', generatedAt, registry: updatedRegistry, stateGraph: invalidatedGraph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance, invalidationResult: invalidation, previousSnapshot: baselineSnapshot });
    const diff = diffEngineeringStateSnapshots(baselineSnapshot, invalidatedSnapshot);
    const plan = buildSelectiveRegenerationPlan({ planId: 'plan:timeline:roof', generatedAt, invalidationResult: invalidation, dependencyGraph: fixture.documentProvenance.dependencyGraph, snapshotReference: engineeringStateSnapshotReference(invalidatedSnapshot) });
    const history = buildEngineeringStateTransitionHistory({ historyId: 'history:timeline', generatedAt, snapshots: [baselineSnapshot, invalidatedSnapshot], diffs: [diff], invalidationResults: [invalidation], regenerationPlans: [plan] });
    const timeline = buildEngineeringStateTimeline(history, [baselineSnapshot, invalidatedSnapshot]);

    expect(history.transitionEvents.some(event => event.eventType === 'snapshot_created')).toBe(true);
    expect(history.transitionEvents.some(event => event.eventType === 'state_invalidated')).toBe(true);
    expect(history.transitionEvents.some(event => event.eventType === 'stale_state_preserved')).toBe(true);
    expect(timeline.latestSnapshotId).toBe(invalidatedSnapshot.snapshotId);
    expect(timeline.latestValidSnapshotId).toBe(baselineSnapshot.snapshotId);
    expect(plan.snapshotReference?.snapshotHash).toBe(invalidatedSnapshot.snapshotHash);
  });

  it('carries snapshot references through provenance, render, lineage, and decision-aware metadata', () => {
    const fixture = buildFixture();
    const graph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:metadata', generatedAt, registry: fixture.registry, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const snapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:metadata', generatedAt, registry: fixture.registry, stateGraph: graph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });
    const snapshotRef = engineeringStateSnapshotReference(snapshot);
    const lineage = buildInvalidationLineageMetadata({ registry: fixture.registry, snapshotReference: snapshotRef });
    const documentProvenance = buildDocumentProvenanceBundle({ documentId: 'permit:state:snapshot-aware', documentType: 'permit_package', generatedAt, surveyEvidence: fixture.surveyEvidence, cad: fixture.cad, permitInput: fixture.permit, decisionProvenance: fixture.decisionProvenance, engineeringStateRegistry: fixture.registry, engineeringStateSnapshot: snapshotRef });
    const bomMetadata = buildDecisionAwareBOMMetadata({ bomItems: fixture.permit.bom, decisionBundle: fixture.decisionProvenance, engineeringStateSnapshot: snapshotRef });
    const sldMetadata = buildDecisionAwareSLDMetadata({ decisionBundle: fixture.decisionProvenance, engineeringStateSnapshot: snapshotRef });
    const ctx = buildRenderContext(fixture.cad, { documentProvenance, decisionProvenance: fixture.decisionProvenance, engineeringStateRegistry: fixture.registry, invalidationLineage: lineage });

    expect(documentProvenance.engineeringStateSnapshot?.snapshotHash).toBe(snapshot.snapshotHash);
    expect(ctx.engineeringStateSnapshot?.snapshotId).toBe(snapshot.snapshotId);
    expect(lineage.snapshotReference?.stateGraphId).toBe(graph.graphId);
    expect(bomMetadata[0].engineeringStateSnapshot?.snapshotHash).toBe(snapshot.snapshotHash);
    expect(sldMetadata.engineeringStateSnapshot?.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it('audit guards fail on orphaned persistent lineage and snapshot drift', () => {
    const fixture = buildFixture();
    const graph = buildPersistentEngineeringStateGraph({ graphId: 'state-graph:guard', generatedAt, registry: fixture.registry, dependencyGraph: fixture.documentProvenance.dependencyGraph });
    const snapshot = buildEngineeringStateSnapshot({ snapshotId: 'snapshot:guard', generatedAt, registry: fixture.registry, stateGraph: graph, dependencyGraph: fixture.documentProvenance.dependencyGraph, decisionProvenance: fixture.decisionProvenance });
    const orphanedGraph: PersistentEngineeringStateGraph = { ...graph, nodes: [{ ...graph.nodes[0], nodeKind: 'state_record', stateId: '', dependencyNodeIds: [], provenanceHash: '' }, ...graph.nodes.slice(1)] };
    const driftedSnapshot = { ...snapshot, snapshotHash: 'engineering-state-snapshot-corrupted' };
    const guards = runEngineeringStateAuditGuards({ records: fixture.registry.stateRecords, persistentGraph: orphanedGraph, snapshots: [driftedSnapshot] });

    expect(guards.find(guard => guard.guardCode === 'persistence_requires_provenance')?.passed).toBe(false);
    expect(guards.find(guard => guard.guardCode === 'persistent_graph_nodes_not_orphaned')?.passed).toBe(false);
    expect(guards.find(guard => guard.guardCode === 'snapshot_hash_not_drifted')?.passed).toBe(false);
  });

});
