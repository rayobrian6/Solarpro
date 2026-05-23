import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { EngineeringInvalidationResult } from '@/lib/engineeringStateInvalidation';
import type { SurveyEvidenceCategory, SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import { STRUCTURED_ENGINEERING_SIGNAL_REGISTRY } from './signalRegistry';
import type { CADReadinessFlag, CADReadinessFlagId, CADReadinessMetadataModel } from './cadReadiness';
import type { DeterministicPhotoGroupingModel, EvidenceClusterModel } from './photoGrouping';
import type { EngineeringInvalidationPropagationResult } from './invalidationEngine';
import type {
  StructuredEngineeringSignal,
  StructuredEngineeringSignalConfidence,
  StructuredEngineeringSignalDefinition,
  StructuredEngineeringSignalSource,
  StructuredEngineeringSignalStatus,
  StructuredEngineeringSignalSummary,
} from './signalTypes';

export interface BuildStructuredEngineeringSignalsInput {
  projectId?: string | null;
  surveyId?: string | null;
  canonicalManifest?: SurveyEvidenceManifest | null;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  photoGrouping?: DeterministicPhotoGroupingModel | null;
  cadReadiness?: CADReadinessMetadataModel | null;
  invalidationResult?: EngineeringInvalidationResult | null;
  invalidationPropagation?: EngineeringInvalidationPropagationResult | null;
  generatedAt?: string;
}

export function buildStructuredEngineeringSignals(input: BuildStructuredEngineeringSignalsInput = {}): StructuredEngineeringSignalSummary {
  const generatedAt = input.generatedAt ?? input.canonicalManifest?.generatedAt ?? input.surveyEvidence?.source.normalizedAt ?? new Date(0).toISOString();
  const manifest = input.canonicalManifest ?? null;
  const items = [...(manifest?.items ?? [])].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const signals = STRUCTURED_ENGINEERING_SIGNAL_REGISTRY.map(definition => evaluateSignal(definition, {
    ...input,
    generatedAt,
    canonicalManifest: manifest,
    manifestItems: items,
  })).sort((a, b) => a.id.localeCompare(b.id));

  const requirementMappings = buildRequirementMappings(signals);
  const cadReadinessMappings = buildCADMappings(signals, input.cadReadiness?.flags ?? []);
  const dependencyGraph = buildSignalDependencyGraph(signals);
  const staleImpacts = signals.map(signal => ({ signalId: signal.id, staleClasses: signal.staleImpacts, invalidatedBy: signal.invalidatedBy }));
  const fallbackParticipation = signals.flatMap(signal => {
    if (signal.status === 'missing' || signal.status === 'blocked') {
      return signal.cadImpacts.map(flagId => ({
        signalId: signal.id,
        fallback: `cad_readiness:${flagId}:unresolved_assumption_or_default_policy`,
        deterministicReason: `${signal.signal_type} is ${signal.status}; downstream readiness must show unresolved truth instead of promoting assumptions.`,
      }));
    }
    return [];
  }).sort((a, b) => `${a.signalId}:${a.fallback}`.localeCompare(`${b.signalId}:${b.fallback}`));

  return {
    modelVersion: 'structured_engineering_signals_v1',
    generatedAt,
    projectId: input.projectId ?? manifest?.projectId ?? input.surveyEvidence?.projectId ?? null,
    surveyId: input.surveyId ?? manifest?.surveyId ?? input.surveyEvidence?.surveyId ?? null,
    source: manifest && items.length > 0 ? 'canonical_evidence_and_metadata' : 'not_loaded',
    signals,
    satisfiedSignals: signals.filter(signal => signal.status === 'confirmed'),
    partialSignals: signals.filter(signal => signal.status === 'partial'),
    blockedSignals: signals.filter(signal => signal.status === 'blocked'),
    missingSignals: signals.filter(signal => signal.status === 'missing'),
    notApplicableSignals: signals.filter(signal => signal.status === 'not_applicable'),
    requirementMappings,
    cadReadinessMappings,
    dependencyGraph,
    staleImpacts,
    fallbackParticipation,
    deterministicNotes: [
      `Structured Engineering Signals V1 evaluated ${signals.length} registry signal(s).`,
      'Signals are deterministic projections of canonical evidence rows, explicit survey fields, deterministic grouping metadata, CAD readiness metadata, and invalidation metadata.',
      'Signals do not inspect image bytes, read visual content, infer geometry, classify scenes, generate CAD, or make autonomous engineering decisions.',
      'Missing, blocked, partial, and not_applicable states remain visible and are not promoted into engineering truth.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function evaluateSignal(
  definition: StructuredEngineeringSignalDefinition,
  input: BuildStructuredEngineeringSignalsInput & { generatedAt: string; manifestItems: SurveyEvidenceItem[]; canonicalManifest: SurveyEvidenceManifest | null },
): StructuredEngineeringSignal {
  const evidence = evidenceForDefinition(definition, input.manifestItems);
  const clusters = clustersForDefinition(definition, input.photoGrouping ?? null);
  const groupedContexts = (input.photoGrouping?.groupedCADReadiness ?? []).filter(context => definition.groupedReadinessContextIds?.includes(context.contextId));
  const fieldSignals = presentFieldSignals(definition.fieldSignals ?? [], input.surveyEvidence ?? null);
  const missingEvidenceCount = Math.max((definition.minimumEvidenceCount ?? 1) - evidence.length, 0);
  const missingClusterCount = Math.max((definition.minimumClusterCount ?? 0) - clusters.length, 0);
  const hasEvidence = evidence.length >= (definition.minimumEvidenceCount ?? 1) || fieldSignals.length > 0;
  const hasClusters = clusters.length >= (definition.minimumClusterCount ?? 0);
  const hasGroupingContext = !definition.groupedReadinessContextIds?.length || groupedContexts.some(context => context.status === 'ready' || context.status === 'partial');
  const qualityStatus = evaluateQualitySignal(definition, input);
  const status = qualityStatus ?? statusFor({ definition, hasEvidence, hasClusters, hasGroupingContext, missingEvidenceCount, missingClusterCount, manifestItems: input.manifestItems });
  const invalidationEvents = input.invalidationResult?.invalidationEvents ?? [];
  const sourceEvidenceIds = sortText(evidence.map(item => item.evidenceId));
  const invalidatedBy = sortText([
    ...invalidationEvents.filter(event => event.triggeringCanonicalEvidenceIds.some(id => sourceEvidenceIds.includes(id))).map(event => event.eventId),
    ...(input.invalidationPropagation?.sourceNodeIds ?? []).filter(id => sourceEvidenceIds.some(evidenceId => id.includes(evidenceId))),
  ]);
  const dependencyNodes = sortText([
    ...sourceEvidenceIds.map(id => `canonicalEvidence:${id}`),
    ...definition.requirementImpacts.map(id => `requirement:${id}`),
    ...definition.cadImpacts.map(id => `cadReadiness:${id}`),
    ...clusters.map(cluster => `photoGrouping:${cluster.clusterId}`),
    ...groupedContexts.map(context => `groupedReadiness:${context.contextId}`),
  ]);
  const sources = sourcesFor(definition, evidence, clusters, fieldSignals, groupedContexts, input);
  const confidence = confidenceFor({ definition, status, evidence, clusters, fieldSignals, groupedContexts, manifestItems: input.manifestItems, invalidatedBy });
  const blockingReasons = blockingReasonsFor(definition, status, missingEvidenceCount, missingClusterCount, hasGroupingContext, input.manifestItems);
  const partialReasons = partialReasonsFor(status, evidence, clusters, fieldSignals, groupedContexts, input.manifestItems);
  const id = `signal:${definition.signalType}`;
  const signalCore = {
    id,
    signal_type: definition.signalType,
    category: definition.category,
    status,
    confidence,
    sources,
    sourceEvidenceIds,
    sourcePhotoIds: sourceEvidenceIds,
    sourceSurveyIds: sortText([...evidence.map(item => item.surveyId), ...(input.canonicalManifest?.surveyId ? [input.canonicalManifest.surveyId] : [])]),
    derivedFrom: sortText([
      ...sourceEvidenceIds.map(id => `canonical_manifest:item:${id}`),
      ...clusters.map(cluster => `deterministic_photo_grouping:${cluster.clusterId}`),
      ...fieldSignals,
      ...(input.canonicalManifest ? ['canonical_manifest:summary'] : []),
    ]),
    dependencyNodes,
    requirementImpacts: definition.requirementImpacts,
    decisionImpacts: definition.decisionImpacts,
    cadImpacts: definition.cadImpacts,
    staleImpacts: invalidatedBy.length ? ['INVALIDATED' as const] : status === 'blocked' ? ['BLOCKED' as const] : status === 'partial' ? ['PARTIAL' as const] : status === 'missing' ? ['NOT_LOADED' as const] : ['VALID' as const],
    invalidatedBy,
    generatedAt: input.generatedAt,
    explanation: explanationFor(definition, status, evidence, clusters, fieldSignals),
    blockingReasons,
    partialReasons,
  };
  return {
    ...signalCore,
    deterministicHash: stableHash(signalCore),
  };
}

function evidenceForDefinition(definition: StructuredEngineeringSignalDefinition, items: SurveyEvidenceItem[]): SurveyEvidenceItem[] {
  const categories = new Set<SurveyEvidenceCategory>([...definition.evidenceCategories, ...(definition.anyEvidenceCategories ?? [])]);
  return items.filter(item => categories.has(item.category)).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

function clustersForDefinition(definition: StructuredEngineeringSignalDefinition, grouping: DeterministicPhotoGroupingModel | null): EvidenceClusterModel[] {
  if (!grouping || !definition.clusterTypes?.length) return [];
  return grouping.evidenceClusters.filter(cluster => definition.clusterTypes?.includes(cluster.clusterType)).sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}

function statusFor(input: {
  definition: StructuredEngineeringSignalDefinition;
  hasEvidence: boolean;
  hasClusters: boolean;
  hasGroupingContext: boolean;
  missingEvidenceCount: number;
  missingClusterCount: number;
  manifestItems: SurveyEvidenceItem[];
}): StructuredEngineeringSignalStatus {
  if (input.manifestItems.length === 0) return 'missing';
  if (!input.hasEvidence && input.definition.notApplicableWhenAbsent) return 'not_applicable';
  if (!input.hasEvidence && input.definition.evidenceCategories.length > 0) return 'missing';
  if (!input.hasClusters || !input.hasGroupingContext) return input.hasEvidence ? 'partial' : 'blocked';
  if (input.missingEvidenceCount === 0 && input.missingClusterCount === 0) return 'confirmed';
  if (input.hasEvidence || input.hasClusters) return 'partial';
  return 'missing';
}

function evaluateQualitySignal(definition: StructuredEngineeringSignalDefinition, input: BuildStructuredEngineeringSignalsInput & { manifestItems: SurveyEvidenceItem[] }): StructuredEngineeringSignalStatus | null {
  const grouping = input.photoGrouping ?? null;
  if (definition.signalType === 'survey_traversal_complete') {
    if (input.manifestItems.length === 0) return 'missing';
    return grouping && grouping.surveyTraversalOrder.length === input.manifestItems.length ? 'confirmed' : 'partial';
  }
  if (definition.signalType === 'survey_sequence_continuity_good') {
    if (!grouping || grouping.surveyTraversalOrder.length === 0) return 'missing';
    return grouping.sequenceBreakpoints.length === 0 ? 'confirmed' : grouping.sequenceBreakpoints.length <= Math.max(1, Math.floor(grouping.surveyTraversalOrder.length / 3)) ? 'partial' : 'blocked';
  }
  if (definition.signalType === 'metadata_completeness_sufficient') {
    if (!grouping || grouping.metadataCompletenessScores.length === 0) return 'missing';
    const avg = average(grouping.metadataCompletenessScores.map(score => score.score));
    return avg >= 0.7 ? 'confirmed' : avg >= 0.45 ? 'partial' : 'blocked';
  }
  if (definition.signalType === 'evidence_grouping_stable') {
    if (!grouping || grouping.evidenceClusters.length === 0) return 'missing';
    return grouping.evidenceClusters.some(cluster => cluster.evidenceIds.length > 1) ? 'confirmed' : 'partial';
  }
  if (definition.signalType === 'photo_cluster_confidence_high') {
    if (!grouping || grouping.evidenceClusters.length === 0) return 'missing';
    return grouping.evidenceClusters.some(cluster => cluster.clusterConfidence === 'metadata_only_high') ? 'confirmed' : 'partial';
  }
  return null;
}

function presentFieldSignals(fieldSignals: string[], evidence: EngineeringSurveyEvidence | null): string[] {
  if (!evidence) return [];
  return fieldSignals.filter(signal => {
    const key = signal.replace('fieldEvidence.', '') as keyof EngineeringSurveyEvidence['fieldEvidence'];
    const value = evidence.fieldEvidence[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    return Boolean(value && value !== 'unknown');
  }).sort();
}

function sourcesFor(
  definition: StructuredEngineeringSignalDefinition,
  evidence: SurveyEvidenceItem[],
  clusters: EvidenceClusterModel[],
  fieldSignals: string[],
  groupedContexts: Array<{ contextId: string }>,
  input: BuildStructuredEngineeringSignalsInput,
): StructuredEngineeringSignalSource[] {
  const sources = new Set<StructuredEngineeringSignalSource>(definition.sourceHints);
  if (evidence.length) sources.add('canonical_evidence');
  if (evidence.some(item => item.captureTimestamp || item.filename || item.submittedCategory || item.siteSurveyFileId)) sources.add('canonical_evidence_metadata');
  if (clusters.length || groupedContexts.length) sources.add('deterministic_grouping_metadata');
  if (fieldSignals.length) sources.add('survey_field_evidence');
  if (input.cadReadiness) sources.add('cad_readiness_metadata');
  if (input.invalidationResult || input.invalidationPropagation) sources.add('invalidation_propagation_metadata');
  if (input.projectId || input.canonicalManifest?.projectId) sources.add('project_metadata');
  return sortText([...sources]) as StructuredEngineeringSignalSource[];
}

function confidenceFor(input: {
  definition: StructuredEngineeringSignalDefinition;
  status: StructuredEngineeringSignalStatus;
  evidence: SurveyEvidenceItem[];
  clusters: EvidenceClusterModel[];
  fieldSignals: string[];
  groupedContexts: Array<{ contextId: string; status: string }>;
  manifestItems: SurveyEvidenceItem[];
  invalidatedBy: string[];
}): StructuredEngineeringSignalConfidence {
  if (input.status === 'missing' || input.status === 'blocked') {
    return { score: 0, band: 'none', factors: [input.definition.missingReason] };
  }
  if (input.status === 'not_applicable') {
    return { score: 0, band: 'none', factors: ['Signal is not applicable because explicit evidence for this optional context is absent.'] };
  }
  let score = 0.25;
  const factors: string[] = ['deterministic registry evaluation'];
  if (input.evidence.length > 0) {
    score += Math.min(0.3, input.evidence.length * 0.08);
    factors.push(`${input.evidence.length} canonical evidence row(s)`);
  }
  if (input.fieldSignals.length > 0) {
    score += 0.15;
    factors.push(`${input.fieldSignals.length} explicit survey field signal(s)`);
  }
  if (input.clusters.length > 0) {
    score += input.clusters.some(cluster => cluster.clusterConfidence === 'metadata_only_high') ? 0.2 : 0.1;
    factors.push(`${input.clusters.length} deterministic grouping cluster(s)`);
  }
  if (input.groupedContexts.length > 0) {
    score += 0.1;
    factors.push(`${input.groupedContexts.length} grouped CAD readiness context(s)`);
  }
  const completeness = metadataCompleteness(input.evidence.length ? input.evidence : input.manifestItems);
  if (completeness >= 0.7) {
    score += 0.1;
    factors.push('metadata completeness sufficient');
  } else if (completeness > 0) {
    factors.push('metadata completeness partial');
  }
  if (input.invalidatedBy.length > 0) {
    score = Math.min(score, 0.4);
    factors.push('confidence capped because signal participates in invalidation metadata');
  }
  if (input.status === 'partial') score = Math.min(score, 0.62);
  const finalScore = Number(Math.max(0, Math.min(1, score)).toFixed(2));
  return { score: finalScore, band: finalScore >= 0.75 ? 'high' : finalScore >= 0.45 ? 'medium' : finalScore > 0 ? 'low' : 'none', factors: sortText(factors) };
}

function blockingReasonsFor(definition: StructuredEngineeringSignalDefinition, status: StructuredEngineeringSignalStatus, missingEvidenceCount: number, missingClusterCount: number, hasGroupingContext: boolean, items: SurveyEvidenceItem[]): string[] {
  if (!['blocked', 'missing'].includes(status)) return [];
  const reasons = [definition.missingReason];
  if (items.length === 0) reasons.push('No canonical manifest evidence rows were supplied.');
  if (missingEvidenceCount > 0 && definition.evidenceCategories.length > 0) reasons.push(`Missing ${missingEvidenceCount} required explicit evidence row(s) from categories: ${definition.evidenceCategories.join(', ')}.`);
  if (missingClusterCount > 0) reasons.push(`Missing ${missingClusterCount} required deterministic grouping cluster(s).`);
  if (!hasGroupingContext) reasons.push(`Required grouped readiness context is absent or blocked: ${(definition.groupedReadinessContextIds ?? []).join(', ')}.`);
  return sortText(reasons);
}

function partialReasonsFor(status: StructuredEngineeringSignalStatus, evidence: SurveyEvidenceItem[], clusters: EvidenceClusterModel[], fieldSignals: string[], groupedContexts: Array<{ contextId: string; status: string }>, items: SurveyEvidenceItem[]): string[] {
  if (status !== 'partial') return [];
  const reasons = ['Signal has some explicit support but does not meet all deterministic confirmation criteria.'];
  if (evidence.length > 0) reasons.push(`Explicit evidence rows: ${evidence.map(item => item.evidenceId).join(', ')}.`);
  if (clusters.length > 0) reasons.push(`Grouping clusters: ${clusters.map(cluster => cluster.clusterId).join(', ')}.`);
  if (fieldSignals.length > 0) reasons.push(`Explicit field signals: ${fieldSignals.join(', ')}.`);
  if (groupedContexts.some(context => context.status !== 'ready')) reasons.push('One or more grouped readiness contexts remains partial/blocked.');
  if (metadataCompleteness(items) < 0.7) reasons.push('Canonical metadata completeness is below sufficient threshold.');
  return sortText(reasons);
}

function explanationFor(definition: StructuredEngineeringSignalDefinition, status: StructuredEngineeringSignalStatus, evidence: SurveyEvidenceItem[], clusters: EvidenceClusterModel[], fieldSignals: string[]): string {
  if (status === 'confirmed') return `${definition.explanation} Confirmed by ${evidence.length} evidence row(s), ${clusters.length} grouping cluster(s), and ${fieldSignals.length} explicit field signal(s).`;
  if (status === 'partial') return `${definition.explanation} Partially supported; unresolved evidence/grouping/metadata remains visible.`;
  if (status === 'not_applicable') return `${definition.label} is not applicable in V1 because the optional explicit context is absent.`;
  return definition.missingReason;
}

function buildRequirementMappings(signals: StructuredEngineeringSignal[]) {
  const requirementIds = sortText([...new Set(signals.flatMap(signal => signal.requirementImpacts))]);
  return requirementIds.map(requirementId => {
    const linked = signals.filter(signal => signal.requirementImpacts.includes(requirementId));
    return {
      requirementId,
      signalIds: linked.map(signal => signal.id).sort(),
      confirmedSignalIds: linked.filter(signal => signal.status === 'confirmed').map(signal => signal.id).sort(),
      partialSignalIds: linked.filter(signal => signal.status === 'partial').map(signal => signal.id).sort(),
      missingSignalIds: linked.filter(signal => signal.status === 'missing' || signal.status === 'blocked').map(signal => signal.id).sort(),
    };
  });
}

function buildCADMappings(signals: StructuredEngineeringSignal[], flags: CADReadinessFlag[]) {
  const flagIds = sortText([...new Set([...signals.flatMap(signal => signal.cadImpacts), ...flags.map(flag => flag.flagId)])]) as CADReadinessFlagId[];
  return flagIds.map(flagId => {
    const linked = signals.filter(signal => signal.cadImpacts.includes(flagId));
    return {
      flagId,
      signalIds: linked.map(signal => signal.id).sort(),
      confirmedSignalIds: linked.filter(signal => signal.status === 'confirmed').map(signal => signal.id).sort(),
      partialSignalIds: linked.filter(signal => signal.status === 'partial').map(signal => signal.id).sort(),
      blockedSignalIds: linked.filter(signal => signal.status === 'missing' || signal.status === 'blocked').map(signal => signal.id).sort(),
    };
  });
}

function buildSignalDependencyGraph(signals: StructuredEngineeringSignal[]): StructuredEngineeringSignalSummary['dependencyGraph'] {
  const nodes = new Map<string, { nodeId: string; label: string; nodeType: 'signal' | 'evidence' | 'requirement' | 'cad_readiness' | 'grouping' | 'invalidation'; status: string }>();
  const edges: StructuredEngineeringSignalSummary['dependencyGraph']['edges'] = [];
  for (const signal of signals) {
    nodes.set(signal.id, { nodeId: signal.id, label: signal.signal_type, nodeType: 'signal', status: signal.status });
    for (const evidenceId of signal.sourceEvidenceIds) {
      const nodeId = `canonicalEvidence:${evidenceId}`;
      nodes.set(nodeId, { nodeId, label: evidenceId, nodeType: 'evidence', status: 'source' });
      edges.push({ edgeId: `edge:${nodeId}->${signal.id}`, sourceNodeId: nodeId, targetNodeId: signal.id, edgeType: 'derived_from', deterministicReason: 'Signal derives from explicit canonical evidence id.' });
    }
    for (const nodeId of signal.dependencyNodes.filter(id => id.startsWith('photoGrouping:') || id.startsWith('groupedReadiness:'))) {
      nodes.set(nodeId, { nodeId, label: nodeId, nodeType: 'grouping', status: 'metadata_context' });
      edges.push({ edgeId: `edge:${nodeId}->${signal.id}`, sourceNodeId: nodeId, targetNodeId: signal.id, edgeType: 'depends_on', deterministicReason: 'Signal depends on deterministic grouping metadata only.' });
    }
    for (const requirementId of signal.requirementImpacts) {
      const nodeId = `requirement:${requirementId}`;
      nodes.set(nodeId, { nodeId, label: requirementId, nodeType: 'requirement', status: 'mapped' });
      edges.push({ edgeId: `edge:${signal.id}->${nodeId}`, sourceNodeId: signal.id, targetNodeId: nodeId, edgeType: 'impacts_requirement', deterministicReason: 'Signal is mapped to requirement hydration/readiness context.' });
    }
    for (const flagId of signal.cadImpacts) {
      const nodeId = `cadReadiness:${flagId}`;
      nodes.set(nodeId, { nodeId, label: flagId, nodeType: 'cad_readiness', status: 'mapped' });
      edges.push({ edgeId: `edge:${signal.id}->${nodeId}`, sourceNodeId: signal.id, targetNodeId: nodeId, edgeType: 'impacts_cad_readiness', deterministicReason: 'Signal is mapped to CAD readiness context.' });
    }
    for (const invalidationId of signal.invalidatedBy) {
      const nodeId = `invalidation:${invalidationId}`;
      nodes.set(nodeId, { nodeId, label: invalidationId, nodeType: 'invalidation', status: 'invalidates' });
      edges.push({ edgeId: `edge:${nodeId}->${signal.id}`, sourceNodeId: nodeId, targetNodeId: signal.id, edgeType: 'invalidated_by', deterministicReason: 'Signal source evidence participates in deterministic invalidation metadata.' });
    }
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    edges: edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
  };
}

function metadataCompleteness(items: SurveyEvidenceItem[]): number {
  if (!items.length) return 0;
  return average(items.map(item => {
    const fields = [item.fileUrl, item.filename, item.mimeType, item.captureTimestamp, item.submittedCategory, item.siteSurveyFileId, item.surveyTechnician];
    return fields.filter(Boolean).length / fields.length;
  }));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function sortText<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function stableHash(value: unknown): string {
  const json = JSON.stringify(sortStable(value));
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `seh_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortStable(nested)]));
  }
  return value;
}

function prohibitedRuntimeBehavior() {
  return [
    'no OCR',
    'no CV classification',
    'no image-byte inspection',
    'no visual-context interpretation',
    'no hallucinated roof geometry',
    'no autonomous CAD generation',
    'no autonomous engineering decisions',
    'no autonomous regeneration',
  ];
}
