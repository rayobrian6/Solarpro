import { describe, expect, it } from 'vitest';
import { buildCADReadinessMetadata } from './cadReadiness';
import { buildDeterministicPhotoGrouping, type DeterministicPhotoGroupingModel, type EvidenceClusterModel, type GroupedCADReadinessContext } from './photoGrouping';
import { buildStructuredEngineeringSignals } from './signalExtraction';
import type { EngineeringInvalidationResult } from '@/lib/engineeringStateInvalidation';
import type { SurveyEvidenceCategory, SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';

const generatedAt = '2025-01-01T00:00:00.000Z';

function item(category: SurveyEvidenceCategory, index: number): SurveyEvidenceItem {
  return {
    evidenceId: `evidence-${index}-${category}`,
    projectId: 'project-signals',
    surveyId: 'survey-signals',
    siteSurveyFileId: `file-${index}`,
    projectFileId: null,
    fileUrl: `https://example.test/${index}-${category}.jpg`,
    blobKey: null,
    filename: `${String(index).padStart(2, '0')}-${category}.jpg`,
    mimeType: 'image/jpeg',
    submittedCategory: category,
    category,
    domain: 'site',
    processingStatus: 'uploaded',
    evidenceConfidence: 'medium',
    evidenceSource: 'site_survey_files',
    captureTimestamp: new Date(Date.parse(generatedAt) + index * 60_000).toISOString(),
    surveyTechnician: 'Tech Signals',
    image: { widthPx: 1600, heightPx: 1200, orientation: 'landscape' },
    quality: { blurScore: null, duplicateScore: null, warnings: [] },
    sceneGroup: null,
    processingHistory: [],
    aiExtractionStatus: 'not_started',
    engineeringUsageReferences: [],
  };
}

function manifest(categories: SurveyEvidenceCategory[]): SurveyEvidenceManifest {
  return {
    manifestVersion: 1,
    projectId: 'project-signals',
    surveyId: 'survey-signals',
    generatedAt,
    sourceOfTruth: 'site_surveys+site_survey_files',
    surveyTechnician: 'Tech Signals',
    items: categories.map(item),
    coverage: [],
    requiredMissing: [],
    warnings: [],
    summary: {
      totalItems: categories.length,
      classifiedItems: categories.length,
      qualityCheckedItems: 0,
      duplicateCheckedItems: 0,
      aiProcessedItems: 0,
      engineeringReviewedItems: 0,
      permitConsumedItems: 0,
      confidence: categories.length > 3 ? 'high' : 'medium',
      completeness: categories.length ? 'sufficient' : 'missing',
    },
    openSourceBoundaries: { webRuntime: [], pythonWorker: [], futureOnly: [] },
  };
}

function cluster(clusterId: string, clusterType: EvidenceClusterModel['clusterType'], categories: SurveyEvidenceCategory[], evidenceIds: string[]): EvidenceClusterModel {
  return {
    clusterId,
    clusterType,
    label: clusterId,
    evidenceIds,
    categories,
    sequenceStart: 0,
    sequenceEnd: Math.max(0, evidenceIds.length - 1),
    clusterConfidence: 'metadata_only_high',
    clusterBoundaryReasons: ['fixture boundary'],
    clusterTransitionReasons: ['fixture transition'],
    metadataCompletenessScore: 1,
    readinessPromotionContext: ['metadata fixture only'],
  };
}

function readinessContext(contextId: string, supportingClusterIds: string[], status: GroupedCADReadinessContext['status'] = 'ready'): GroupedCADReadinessContext {
  return {
    contextId,
    label: contextId,
    status,
    linkedReadinessFlagIds: ['routing-ready'],
    supportingClusterIds,
    blockingReasons: status === 'ready' ? [] : ['fixture blocking reason'],
    deterministicReason: 'fixture grouped readiness context; no image content is inspected',
  };
}

function groupingFor(inputManifest: SurveyEvidenceManifest, extra: Partial<DeterministicPhotoGroupingModel> = {}): DeterministicPhotoGroupingModel {
  const base = buildDeterministicPhotoGrouping({ projectId: inputManifest.projectId, canonicalManifest: inputManifest, generatedAt });
  return { ...base, ...extra };
}

function signal(summary: ReturnType<typeof buildStructuredEngineeringSignals>, type: string) {
  const found = summary.signals.find(entry => entry.signal_type === type);
  expect(found, `signal ${type} should exist`).toBeTruthy();
  return found!;
}

function invalidationFor(evidenceId: string): EngineeringInvalidationResult {
  return {
    resultId: 'invalidation:signals',
    generatedAt,
    trigger: {
      triggerId: 'trigger:signals',
      triggerType: 'canonical_evidence_changed',
      changedCanonicalEvidenceIds: [evidenceId],
      changedRequirementIds: [],
      changedDecisionIds: [],
      changedDependencyNodeIds: [],
      triggeredAt: generatedAt,
      deterministicReason: 'fixture invalidation',
    },
    affectedStateIds: ['state:signals'],
    unaffectedStateIds: [],
    updatedStateRecords: [],
    deterministicHash: 'hash:signals',
    deterministicNotes: ['fixture invalidation'],
    auditGuards: [],
    invalidationEvents: [{
      eventId: 'event:signals:evidence',
      stateId: 'state:signals',
      staleStatus: 'stale',
      invalidationReason: 'fixture evidence changed',
      triggeringDependencyIds: [`canonicalEvidence:${evidenceId}`],
      triggeringRequirementIds: ['main_service_panel'],
      triggeringDecisionIds: ['decision:service_panel_rating'],
      triggeringCanonicalEvidenceIds: [evidenceId],
      impactedDownstreamStateIds: ['state:signals'],
      lastValidGenerationHash: 'generation',
      lastValidProvenanceHash: 'provenance',
      invalidatedAt: generatedAt,
      deterministicNotes: ['event fixture'],
    }],
  };
}

describe('Structured Engineering Signals V1', () => {
  it('keeps sparse surveys missing/blocked without fabricating engineering truth', () => {
    const summary = buildStructuredEngineeringSignals({ generatedAt });

    expect(summary.source).toBe('not_loaded');
    expect(summary.signals.length).toBeGreaterThan(30);
    expect(signal(summary, 'main_service_panel_present').status).toBe('missing');
    expect(signal(summary, 'routing_continuity_present').status).toBe('missing');
    expect(signal(summary, 'metadata_completeness_sufficient').status).toBe('missing');
    expect(summary.fallbackParticipation.some(row => row.signalId === 'signal:routing_continuity_present')).toBe(true);
    expect(summary.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no OCR', 'no CV classification', 'no image-byte inspection', 'no autonomous CAD generation']));
  });

  it('extracts confirmed and partial signals from canonical evidence plus deterministic grouping metadata', () => {
    const inputManifest = manifest(['main_service_panel', 'meter', 'utility_connection', 'inverter_location', 'roof_plane', 'roof_edge', 'roof_surface']);
    const ids = new Map(inputManifest.items.map(row => [row.category, row.evidenceId]));
    const clusters = [
      cluster('cluster:electrical', 'electrical_evidence', ['main_service_panel', 'meter'], [ids.get('main_service_panel')!, ids.get('meter')!]),
      cluster('cluster:utility', 'utility_evidence', ['meter', 'utility_connection'], [ids.get('meter')!, ids.get('utility_connection')!]),
      cluster('cluster:routing', 'routing_continuity', ['utility_connection', 'inverter_location'], [ids.get('utility_connection')!, ids.get('inverter_location')!]),
      cluster('cluster:roof', 'roof_side_candidate', ['roof_plane', 'roof_edge', 'roof_surface'], [ids.get('roof_plane')!, ids.get('roof_edge')!, ids.get('roof_surface')!]),
    ];
    const grouping = groupingFor(inputManifest, {
      evidenceClusters: clusters,
      electricalEvidenceGroups: [clusters[0]],
      utilityEvidenceGroups: [clusters[1]],
      routingContinuityGroups: [clusters[2]],
      roofSideCandidateGroups: [clusters[3]],
      groupedCADReadiness: [readinessContext('grouped-readiness:route-continuity', ['cluster:routing'])],
      metadataCompletenessScores: inputManifest.items.map(row => ({ evidenceId: row.evidenceId, score: 1, missingFields: [] })),
    });

    const summary = buildStructuredEngineeringSignals({ canonicalManifest: inputManifest, photoGrouping: grouping, generatedAt });

    expect(signal(summary, 'main_service_panel_present').status).toBe('confirmed');
    expect(signal(summary, 'electrical_equipment_cluster_present').status).toBe('confirmed');
    expect(signal(summary, 'routing_continuity_present').status).toBe('confirmed');
    expect(signal(summary, 'roof_layout_candidate_present').status).toBe('confirmed');
    expect(signal(summary, 'survey_traversal_complete').status).toBe('confirmed');
    expect(signal(summary, 'metadata_completeness_sufficient').status).toBe('confirmed');
    expect(signal(summary, 'routing_continuity_present').dependencyNodes).toEqual(expect.arrayContaining(['photoGrouping:cluster:routing', 'groupedReadiness:grouped-readiness:route-continuity']));
    expect(summary.requirementMappings.find(row => row.requirementId === 'main_service_panel')?.confirmedSignalIds).toContain('signal:main_service_panel_present');
    expect(summary.cadReadinessMappings.find(row => row.flagId === 'routing-ready')?.confirmedSignalIds).toContain('signal:routing_continuity_present');
  });

  it('covers exterior-only, ESS, trench, detached, interrupted traversal, and duplicate timestamp metadata cases deterministically', () => {
    const exteriorOnly = manifest(['overview', 'utility_access']);
    const exteriorGrouping = groupingFor(exteriorOnly, {
      sequenceBreakpoints: [{ breakpointId: 'break:duplicate-timestamp', afterSequenceIndex: 0, beforeEvidenceId: exteriorOnly.items[0].evidenceId, afterEvidenceId: exteriorOnly.items[1].evidenceId, reason: 'duplicate timestamp fixture' }],
      metadataCompletenessScores: exteriorOnly.items.map(row => ({ evidenceId: row.evidenceId, score: 0.5, missingFields: ['captureTimestamp'] })),
    });
    const exteriorSummary = buildStructuredEngineeringSignals({ canonicalManifest: exteriorOnly, photoGrouping: exteriorGrouping, generatedAt });
    expect(signal(exteriorSummary, 'main_service_panel_present').status).toBe('missing');
    expect(signal(exteriorSummary, 'roof_plane_context_present').status).toBe('missing');
    expect(signal(exteriorSummary, 'survey_sequence_continuity_good').status).toBe('partial');
    expect(signal(exteriorSummary, 'metadata_completeness_sufficient').status).toBe('partial');

    const contextManifest = manifest(['battery_location', 'garage_interior_wall', 'trench_path', 'detached_structures', 'overview']);
    const contextIds = new Map(contextManifest.items.map(row => [row.category, row.evidenceId]));
    const detached = cluster('cluster:detached', 'detached_structure_candidate', ['detached_structures'], [contextIds.get('detached_structures')!]);
    const trench = cluster('cluster:trench', 'ground_mount_candidate', ['trench_path'], [contextIds.get('trench_path')!]);
    const contextSummary = buildStructuredEngineeringSignals({
      canonicalManifest: contextManifest,
      photoGrouping: groupingFor(contextManifest, {
        evidenceClusters: [detached, trench],
        detachedStructureGroups: [detached],
        groundMountCandidateGroups: [trench],
        metadataCompletenessScores: contextManifest.items.map(row => ({ evidenceId: row.evidenceId, score: 1, missingFields: [] })),
      }),
      generatedAt,
    });

    expect(signal(contextSummary, 'ess_location_candidate_present').status).toBe('confirmed');
    expect(signal(contextSummary, 'battery_wall_candidate_present').status).toBe('confirmed');
    expect(signal(contextSummary, 'trench_path_explicit').status).toBe('confirmed');
    expect(signal(contextSummary, 'trench_context_present').status).toBe('confirmed');
    expect(signal(contextSummary, 'detached_structure_present').status).toBe('confirmed');
    expect(signal(contextSummary, 'detached_structure_route_candidate').status).toBe('confirmed');
  });

  it('propagates invalidation participation and keeps deterministic hashes stable across reruns', () => {
    const inputManifest = manifest(['main_service_panel', 'meter']);
    const targetEvidence = inputManifest.items.find(row => row.category === 'main_service_panel')!.evidenceId;
    const grouping = groupingFor(inputManifest);
    const first = buildStructuredEngineeringSignals({ canonicalManifest: inputManifest, photoGrouping: grouping, invalidationResult: invalidationFor(targetEvidence), generatedAt });
    const second = buildStructuredEngineeringSignals({ canonicalManifest: inputManifest, photoGrouping: grouping, invalidationResult: invalidationFor(targetEvidence), generatedAt });
    const msp = signal(first, 'main_service_panel_present');

    expect(msp.invalidatedBy).toEqual(['event:signals:evidence']);
    expect(msp.staleImpacts).toEqual(['INVALIDATED']);
    expect(msp.confidence.score).toBeLessThanOrEqual(0.4);
    expect(signal(second, 'main_service_panel_present').deterministicHash).toBe(msp.deterministicHash);
    expect(first.dependencyGraph.edges).toEqual(second.dependencyGraph.edges);
    expect(first.signals.map(entry => [entry.id, entry.confidence.score])).toEqual(second.signals.map(entry => [entry.id, entry.confidence.score]));
  });

  it('feeds CAD readiness without hiding unresolved assumptions or default policy fallbacks', () => {
    const inputManifest = manifest(['main_service_panel', 'meter', 'roof_plane']);
    const grouping = groupingFor(inputManifest);
    const signals = buildStructuredEngineeringSignals({ canonicalManifest: inputManifest, photoGrouping: grouping, generatedAt });
    const readiness = buildCADReadinessMetadata({ canonicalManifest: inputManifest, structuredSignals: signals });
    const routing = readiness.flags.find(flag => flag.flagId === 'routing-ready');

    expect(routing?.structuredSignalIds).toEqual(expect.arrayContaining(['signal:main_service_panel_present', 'signal:utility_meter_present']));
    expect(routing?.status).toBe('ready');
    expect(routing?.unresolvedAssumptions).toEqual([]);

    const blockedManifest = manifest(['roof_plane']);
    const blockedSignals = buildStructuredEngineeringSignals({ canonicalManifest: blockedManifest, photoGrouping: groupingFor(blockedManifest), generatedAt });
    const blockedReadiness = buildCADReadinessMetadata({ canonicalManifest: blockedManifest, structuredSignals: blockedSignals });
    const blockedRouting = blockedReadiness.flags.find(flag => flag.flagId === 'routing-ready');
    const ess = blockedReadiness.flags.find(flag => flag.flagId === 'ESS-location-ready');

    expect(blockedRouting?.status).toBe('blocked');
    expect(blockedRouting?.unresolvedAssumptions.length).toBeGreaterThan(0);
    expect(blockedRouting?.defaultPolicyFallbacks).toEqual(expect.arrayContaining(['routing-ready:default_policy_requires_manual_review_until_explicit_truth_is_supplied']));
    expect(ess?.status).toBe('not_applicable');
    expect(ess?.structuredSignalIds).toEqual(expect.arrayContaining(['signal:ess_location_candidate_present', 'signal:battery_wall_candidate_present', 'signal:energy_storage_context_present']));
  });
});
