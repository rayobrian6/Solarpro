import { describe, expect, it } from 'vitest';
import { buildCADReadinessMetadata } from './cadReadiness';
import { buildEngineeringContextResolution } from './contextResolution';
import { buildDeterministicPhotoGrouping, type DeterministicPhotoGroupingModel } from './photoGrouping';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalSummary, StructuredEngineeringSignalType } from './signalTypes';
import type { SurveyEvidenceCategory, SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';

const generatedAt = '2025-01-01T00:00:00.000Z';

function item(category: SurveyEvidenceCategory, index: number): SurveyEvidenceItem {
  return {
    evidenceId: `evidence:${category}:${index}`,
    projectId: 'project-contexts',
    surveyId: 'survey-contexts',
    siteSurveyFileId: `file:${index}`,
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
    surveyTechnician: 'Tech Contexts',
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
    projectId: 'project-contexts',
    surveyId: 'survey-contexts',
    generatedAt,
    sourceOfTruth: 'site_surveys+site_survey_files',
    surveyTechnician: 'Tech Contexts',
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

function grouping(inputManifest: SurveyEvidenceManifest): DeterministicPhotoGroupingModel {
  return buildDeterministicPhotoGrouping({ projectId: inputManifest.projectId, canonicalManifest: inputManifest, generatedAt });
}

function signal(type: StructuredEngineeringSignalType, status: StructuredEngineeringSignal['status'], evidenceIds: string[], extra: Partial<StructuredEngineeringSignal> = {}): StructuredEngineeringSignal {
  return {
    id: `signal:${type}${extra.id ? `:${extra.id}` : ''}`,
    signal_type: type,
    category: extra.category ?? 'utility_electrical',
    status,
    confidence: extra.confidence ?? { score: status === 'confirmed' ? 90 : status === 'partial' ? 50 : 10, band: status === 'confirmed' ? 'high' : status === 'partial' ? 'medium' : 'low', factors: [`fixture:${status}`] },
    sources: extra.sources ?? ['canonical_evidence'],
    sourceEvidenceIds: evidenceIds,
    sourcePhotoIds: extra.sourcePhotoIds ?? [],
    sourceSurveyIds: extra.sourceSurveyIds ?? ['survey-contexts'],
    derivedFrom: extra.derivedFrom ?? [],
    dependencyNodes: extra.dependencyNodes ?? evidenceIds.map(id => `canonicalEvidence:${id}`),
    requirementImpacts: extra.requirementImpacts ?? ['main_service_panel'],
    decisionImpacts: extra.decisionImpacts ?? ['fixture_decision'],
    cadImpacts: extra.cadImpacts ?? ['routing-ready'],
    staleImpacts: extra.staleImpacts ?? [],
    invalidatedBy: extra.invalidatedBy ?? [],
    generatedAt,
    deterministicHash: `hash:${type}:${status}:${evidenceIds.join('|')}`,
    explanation: extra.explanation ?? `fixture ${type}`,
    blockingReasons: extra.blockingReasons ?? [],
    partialReasons: extra.partialReasons ?? [],
  };
}

function summary(signals: StructuredEngineeringSignal[]): StructuredEngineeringSignalSummary {
  return {
    modelVersion: 'structured_engineering_signals_v1',
    generatedAt,
    projectId: 'project-contexts',
    surveyId: 'survey-contexts',
    source: signals.length ? 'canonical_evidence_and_metadata' : 'not_loaded',
    signals,
    satisfiedSignals: signals.filter(row => row.status === 'confirmed'),
    partialSignals: signals.filter(row => row.status === 'partial'),
    blockedSignals: signals.filter(row => row.status === 'blocked'),
    missingSignals: signals.filter(row => row.status === 'missing'),
    notApplicableSignals: signals.filter(row => row.status === 'not_applicable'),
    requirementMappings: [],
    cadReadinessMappings: [],
    dependencyGraph: { nodes: [], edges: [] },
    staleImpacts: [],
    fallbackParticipation: [],
    deterministicNotes: ['fixture summary'],
    prohibitedRuntimeBehavior: [],
  };
}

describe('Engineering Context Resolution V1', () => {
  it('builds authoritative and preferred contexts from structured signals without inspecting imagery', () => {
    const inputManifest = manifest(['main_service_panel', 'utility_connection', 'meter', 'inverter_location']);
    const structuredSignals = summary([
      signal('main_service_panel_present', 'confirmed', ['evidence:msp'], { requirementImpacts: ['main_service_panel'] }),
      signal('interconnection_zone_known', 'confirmed', ['evidence:interconnection'], { requirementImpacts: ['main_service_panel'] }),
      signal('electrical_equipment_cluster_present', 'confirmed', ['evidence:cluster'], { requirementImpacts: ['main_service_panel'] }),
      signal('utility_meter_present', 'confirmed', ['evidence:meter'], { requirementImpacts: ['utility_meter'] }),
      signal('routing_continuity_present', 'confirmed', ['evidence:routing'], { category: 'routing', cadImpacts: ['routing-ready'] }),
    ]);

    const contexts = buildEngineeringContextResolution({ canonicalManifest: inputManifest, structuredSignals, photoGrouping: grouping(inputManifest), cadReadiness: buildCADReadinessMetadata({ canonicalManifest: inputManifest, structuredSignals }), generatedAt });
    const msp = contexts.contexts.find(context => context.contextType === 'preferred_msp_context');
    const routing = contexts.contexts.find(context => context.contextType === 'preferred_routing_context');

    expect(contexts.modelVersion).toBe('engineering_context_resolution_v1');
    expect(msp?.status).toBe('authoritative');
    expect(msp?.sourceSignalIds).toContain('signal:main_service_panel_present');
    expect(msp?.supportingSignalIds).toEqual(expect.arrayContaining(['signal:interconnection_zone_known', 'signal:electrical_equipment_cluster_present']));
    expect(routing?.status).toBe('preferred');
    expect(contexts.cadReadinessMappings.find(row => row.flagId === 'routing-ready')?.contextIds).toEqual(expect.arrayContaining(['context:preferred_msp_context', 'context:preferred_routing_context']));
    expect(contexts.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no text extraction runtime over survey imagery', 'no computer-vision runtime dependency', 'no operator-free plan-output creation']));
  });

  it('preserves competing structured signals instead of silently selecting a winner', () => {
    const structuredSignals = summary([
      signal('main_service_panel_present', 'confirmed', ['evidence:shared-service'], { id: 'primary' }),
      signal('interconnection_zone_known', 'confirmed', ['evidence:shared-service'], { id: 'support' }),
    ]);

    const contexts = buildEngineeringContextResolution({ structuredSignals, generatedAt });
    const msp = contexts.contexts.find(context => context.contextType === 'preferred_msp_context');

    expect(msp?.status).toBe('conflicting');
    expect(msp?.competingSignalIds).toEqual(expect.arrayContaining(['signal:main_service_panel_present:primary', 'signal:interconnection_zone_known:support']));
    expect(contexts.conflicts.find(conflict => conflict.contextId === 'context:preferred_msp_context')?.deterministicResolutionPolicy).toContain('Preserve conflict metadata');
  });

  it('keeps fallback-dependent partial contexts visible with confidence penalties', () => {
    const fallbackSummary = summary([
      signal('roof_plane_context_present', 'partial', ['evidence:roof-plane'], { category: 'roof_structural', requirementImpacts: ['roof_overview'], cadImpacts: ['roof-plane-ready'] }),
    ]);
    fallbackSummary.fallbackParticipation = [{ signalId: 'signal:roof_plane_context_present', fallback: 'default_roof_review_policy', deterministicReason: 'fixture fallback remains review-visible' }];
    const contexts = buildEngineeringContextResolution({ structuredSignals: fallbackSummary, generatedAt });
    const roofPlane = contexts.contexts.find(context => context.contextType === 'preferred_roof_plane_context');

    expect(roofPlane?.status).toBe('partial');
    expect(roofPlane?.fallbackLineage.length).toBeGreaterThan(0);
    expect(roofPlane?.fallbackConfidencePenalties).toEqual(expect.arrayContaining([
      expect.stringContaining('fallback penalty applied:structured-signal-fallback:signal:roof_plane_context_present:default_roof_review_policy'),
    ]));
    expect(contexts.fallbackParticipation.some(row => row.contextId === 'context:preferred_roof_plane_context')).toBe(true);
  });

  it('distinguishes explicit-primary blocked contexts from truly not-applicable optional contexts', () => {
    const supportingOnly = buildEngineeringContextResolution({
      structuredSignals: summary([
        signal('trench_context_present', 'confirmed', ['evidence:trench-context'], { category: 'ground_trench', requirementImpacts: ['structural_access'], cadImpacts: ['trench-route-ready'] }),
        signal('detached_structure_route_candidate', 'confirmed', ['evidence:detached-route'], { category: 'ground_trench', requirementImpacts: ['structural_access'], cadImpacts: ['detached-structure-ready'] }),
      ]),
      generatedAt,
    });
    const allNotApplicable = buildEngineeringContextResolution({
      structuredSignals: summary([
        signal('trench_path_explicit', 'not_applicable', [], { category: 'ground_trench', requirementImpacts: ['structural_access'], cadImpacts: ['trench-route-ready'] }),
      ]),
      generatedAt,
    });

    expect(supportingOnly.contexts.find(context => context.contextType === 'preferred_trench_context')?.status).toBe('blocked');
    expect(supportingOnly.contexts.find(context => context.contextType === 'preferred_detached_structure_context')?.status).toBe('blocked');
    expect(allNotApplicable.contexts.find(context => context.contextType === 'preferred_trench_context')?.status).toBe('not_applicable');
  });

  it('annotates CAD readiness with linked resolved context states without promoting readiness into truth', () => {
    const structuredSignals = summary([
      signal('main_service_panel_present', 'confirmed', ['evidence:msp'], { requirementImpacts: ['main_service_panel'] }),
      signal('interconnection_zone_known', 'confirmed', ['evidence:interconnection'], { requirementImpacts: ['main_service_panel'] }),
    ]);
    const contextResolution = buildEngineeringContextResolution({ structuredSignals, generatedAt });
    const readiness = buildCADReadinessMetadata({ structuredSignals, contextResolution });
    const routing = readiness.flags.find(flag => flag.flagId === 'routing-ready');

    expect(routing?.resolvedContextIds).toContain('context:preferred_msp_context');
    expect(routing?.authoritativeContextIds).toContain('context:preferred_msp_context');
    expect(routing?.contextStatuses).toEqual(expect.arrayContaining([{ contextId: 'context:preferred_msp_context', status: 'authoritative' }]));
    expect(routing?.deterministicReason).toContain('resolved contexts');
  });
});
