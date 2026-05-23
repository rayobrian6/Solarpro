import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import type { SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import type { StructuredEngineeringSignalSummary } from './signalTypes';
import type { EngineeringContextResolutionSummary, EngineeringContextStatus } from './contextTypes';

export type CADReadinessFlagId =
  | 'roof-plane-ready'
  | 'routing-ready'
  | 'setback-ready'
  | 'trench-route-ready'
  | 'detached-structure-ready'
  | 'ESS-location-ready';

export type CADReadinessStatus = 'ready' | 'partial' | 'blocked' | 'not_applicable';

export interface CADReadinessFlag {
  flagId: CADReadinessFlagId;
  status: CADReadinessStatus;
  satisfiedCategories: SurveyEvidenceCategory[];
  missingCategories: SurveyEvidenceCategory[];
  explicitSurveySignals: string[];
  structuredSignalIds: string[];
  unresolvedAssumptions: string[];
  defaultPolicyFallbacks: string[];
  deterministicReason: string;
  resolvedContextIds: string[];
  authoritativeContextIds: string[];
  preferredContextIds: string[];
  partialContextIds: string[];
  conflictingContextIds: string[];
  blockedContextIds: string[];
  unresolvedContextIds: string[];
  fallbackDependentContextIds: string[];
  contextStatuses: Array<{ contextId: string; status: EngineeringContextStatus }>;
}

export interface CADReadinessMetadataModel {
  modelVersion: 'cad_readiness_metadata_v1';
  projectId: string | null;
  surveyId: string | null;
  flags: CADReadinessFlag[];
  readyFlags: CADReadinessFlagId[];
  blockedFlags: CADReadinessFlagId[];
  partialFlags: CADReadinessFlagId[];
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}

interface CADReadinessRule {
  flagId: CADReadinessFlagId;
  requiredAnyCategories: SurveyEvidenceCategory[];
  supportiveCategories: SurveyEvidenceCategory[];
  surveySignal: (evidence: EngineeringSurveyEvidence | null | undefined) => string[];
  signalTypes: string[];
  reason: string;
  requireExplicitPrimaryForStructuredSignalPromotion?: boolean;
}

const RULES: CADReadinessRule[] = [
  {
    flagId: 'roof-plane-ready',
    requiredAnyCategories: ['roof_plane'],
    supportiveCategories: ['ridge', 'roof_edge', 'roof_surface', 'attic_access', 'rafters'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if (evidence?.fieldEvidence.hasRoofGeometry) signals.push('fieldEvidence.hasRoofGeometry');
      if ((evidence?.fieldEvidence.roofPlaneCount ?? 0) > 0) signals.push(`fieldEvidence.roofPlaneCount:${evidence?.fieldEvidence.roofPlaneCount}`);
      if (evidence?.fieldEvidence.roofPitchDegrees !== null && evidence?.fieldEvidence.roofPitchDegrees !== undefined) signals.push('fieldEvidence.roofPitchDegrees');
      if (evidence?.fieldEvidence.roofMaterial) signals.push('fieldEvidence.roofMaterial');
      return signals;
    },
    signalTypes: ['roof_plane_context_present', 'roof_surface_context_present', 'roof_layout_candidate_present', 'structural_access_context_present'],
    reason: 'Roof-plane readiness requires explicit roof-plane canonical evidence or explicit roof geometry fields, with supporting ridge/edge/surface/framing context when available.',
  },
  {
    flagId: 'routing-ready',
    requiredAnyCategories: ['main_service_panel', 'meter', 'utility_connection', 'disconnect', 'inverter_location', 'garage_interior_wall'],
    supportiveCategories: ['grounding', 'subpanel', 'utility_access', 'battery_location', 'gateway_location'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if (evidence?.fieldEvidence.hasElectricalData) signals.push('fieldEvidence.hasElectricalData');
      if (evidence?.fieldEvidence.interconnectionPoint) signals.push(`fieldEvidence.interconnectionPoint:${evidence.fieldEvidence.interconnectionPoint}`);
      if (evidence?.fieldEvidence.mainPanelRatingAmps !== null && evidence?.fieldEvidence.mainPanelRatingAmps !== undefined) signals.push('fieldEvidence.mainPanelRatingAmps');
      return signals;
    },
    signalTypes: ['routing_continuity_present', 'utility_to_inverter_route_candidate', 'inverter_to_msp_route_candidate', 'electrical_equipment_cluster_present', 'main_service_panel_present'],
    reason: 'Routing readiness requires explicit electrical/service evidence, deterministic route-continuity metadata, or explicit interconnection fields sufficient to trace route context.',
  },
  {
    flagId: 'setback-ready',
    requiredAnyCategories: ['roof_edge', 'ridge', 'obstructions'],
    supportiveCategories: ['roof_plane', 'roof_surface'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if ((evidence?.fieldEvidence.obstructionCount ?? 0) > 0) signals.push(`fieldEvidence.obstructionCount:${evidence?.fieldEvidence.obstructionCount}`);
      if (evidence?.fieldEvidence.usableAreaSqFt !== null && evidence?.fieldEvidence.usableAreaSqFt !== undefined) signals.push('fieldEvidence.usableAreaSqFt');
      return signals;
    },
    signalTypes: ['roof_edge_context_present', 'ridge_context_present', 'obstruction_context_present', 'roof_layout_candidate_present'],
    reason: 'Setback readiness requires explicit edge/ridge/obstruction categories or explicit usable-area/obstruction survey fields.',
  },
  {
    flagId: 'trench-route-ready',
    requiredAnyCategories: ['trench_path'],
    supportiveCategories: ['overview', 'utility_access', 'utility_connection', 'detached_structures'],
    surveySignal: () => [],
    signalTypes: ['trench_path_explicit', 'trench_context_present', 'detached_structure_route_candidate'],
    reason: 'Trench-route readiness requires explicit trench-path evidence; it is never inferred from generic exterior photos alone.',
    requireExplicitPrimaryForStructuredSignalPromotion: true,
  },
  {
    flagId: 'detached-structure-ready',
    requiredAnyCategories: ['detached_structures'],
    supportiveCategories: ['overview', 'roof_plane', 'trench_path'],
    surveySignal: () => [],
    signalTypes: ['detached_structure_present', 'detached_structure_route_candidate'],
    reason: 'Detached-structure readiness requires explicit detached-structure evidence or remains blocked/not applicable depending project scope.',
    requireExplicitPrimaryForStructuredSignalPromotion: true,
  },
  {
    flagId: 'ESS-location-ready',
    requiredAnyCategories: ['battery_location', 'garage_interior_wall', 'gateway_location'],
    supportiveCategories: ['overview', 'utility_access', 'inverter_location'],
    surveySignal: () => [],
    signalTypes: ['ess_location_candidate_present', 'battery_wall_candidate_present', 'energy_storage_context_present', 'garage_interior_wall_present'],
    reason: 'ESS location readiness requires explicit battery, gateway, or garage-wall evidence; storage location is not inferred from generic site photos.',
  },
];

export function buildCADReadinessMetadata(input: {
  projectId?: string | null;
  surveyId?: string | null;
  canonicalManifest?: SurveyEvidenceManifest | null;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  structuredSignals?: StructuredEngineeringSignalSummary | null;
  contextResolution?: EngineeringContextResolutionSummary | null;
} = {}): CADReadinessMetadataModel {
  const categories = categoriesFrom(input.canonicalManifest, input.surveyEvidence);
  const flags = RULES.map(rule => evaluateRule(rule, categories, input.surveyEvidence, input.structuredSignals ?? null, input.contextResolution ?? null));
  return {
    modelVersion: 'cad_readiness_metadata_v1',
    projectId: input.projectId ?? input.canonicalManifest?.projectId ?? input.surveyEvidence?.projectId ?? null,
    surveyId: input.surveyId ?? input.canonicalManifest?.surveyId ?? input.surveyEvidence?.surveyId ?? null,
    flags,
    readyFlags: flags.filter(flag => flag.status === 'ready').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    blockedFlags: flags.filter(flag => flag.status === 'blocked').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    partialFlags: flags.filter(flag => flag.status === 'partial').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    deterministicNotes: [
      'CAD readiness metadata is deterministic metadata only; it does not run CAD generation.',
      'Readiness differentiates explicit canonical evidence, deterministic structured signals, unresolved assumptions, and default policy fallbacks.',
      'Readiness is derived from canonical evidence categories, explicit survey physical fields, and structured engineering signals only.',
      'Pixel inspection, text extraction over imagery, computer-vision runtime dependencies, semantic visual interpretation, and fabricated geometry are not used.',
    ],
    prohibitedRuntimeBehavior: [
      'no operator-free plan-output creation',
      'no pixel inspection or image-byte inspection',
      'no text extraction runtime over survey imagery',
      'no computer-vision runtime dependency',
      'no vision model runtime dependency',
      'no geometry fabrication',
    ],
  };
}

function evaluateRule(
  rule: CADReadinessRule,
  categories: SurveyEvidenceCategory[],
  evidence: EngineeringSurveyEvidence | null | undefined,
  structuredSignals: StructuredEngineeringSignalSummary | null,
  contextResolution: EngineeringContextResolutionSummary | null,
): CADReadinessFlag {
  const categorySet = new Set(categories);
  const satisfiedRequired = rule.requiredAnyCategories.filter(category => categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const supportive = rule.supportiveCategories.filter(category => categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const signals = rule.surveySignal(evidence).sort((a, b) => a.localeCompare(b));
  const linkedSignals = (structuredSignals?.signals ?? []).filter(signal => signal.cadImpacts.includes(rule.flagId));
  const confirmedSignalIds = linkedSignals.filter(signal => signal.status === 'confirmed').map(signal => signal.id).sort((a, b) => a.localeCompare(b));
  const partialSignalIds = linkedSignals.filter(signal => signal.status === 'partial').map(signal => signal.id).sort((a, b) => a.localeCompare(b));
  const blockedSignalIds = linkedSignals.filter(signal => signal.status === 'blocked' || signal.status === 'missing').map(signal => signal.id).sort((a, b) => a.localeCompare(b));
  const notApplicableSignalIds = linkedSignals.filter(signal => signal.status === 'not_applicable').map(signal => signal.id).sort((a, b) => a.localeCompare(b));
  const missingCategories = rule.requiredAnyCategories.filter(category => !categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const linkedContexts = (contextResolution?.contexts ?? [])
    .filter(context => context.cadReadinessImpacts.includes(rule.flagId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const resolvedContextIds = linkedContexts.map(context => context.id);
  const authoritativeContextIds = linkedContexts.filter(context => context.status === 'authoritative').map(context => context.id);
  const preferredContextIds = linkedContexts.filter(context => context.status === 'preferred').map(context => context.id);
  const partialContextIds = linkedContexts.filter(context => context.status === 'partial').map(context => context.id);
  const conflictingContextIds = linkedContexts.filter(context => context.status === 'conflicting').map(context => context.id);
  const blockedContextIds = linkedContexts.filter(context => context.status === 'blocked').map(context => context.id);
  const unresolvedContextIds = linkedContexts.filter(context => context.status === 'unresolved').map(context => context.id);
  const fallbackDependentContextIds = linkedContexts.filter(context => context.fallbackLineage.length > 0).map(context => context.id);
  const contextStatuses = linkedContexts.map(context => ({ contextId: context.id, status: context.status }));
  const hasPrimary = satisfiedRequired.length > 0;
  const hasExplicitSignal = signals.length > 0;
  const hasConfirmedStructuredSignal = confirmedSignalIds.length > 0;
  const hasPartialStructuredSignal = partialSignalIds.length > 0;
  const structuredSignalsCanPromote = !rule.requireExplicitPrimaryForStructuredSignalPromotion || hasPrimary;
  const confirmedStructuredSignalsCanPromote = hasConfirmedStructuredSignal && structuredSignalsCanPromote;
  const partialStructuredSignalsCanPromote = hasPartialStructuredSignal && structuredSignalsCanPromote;
  const allLinkedSignalsNotApplicable = linkedSignals.length > 0 && linkedSignals.length === notApplicableSignalIds.length;
  const status: CADReadinessStatus = hasPrimary && (supportive.length > 0 || hasExplicitSignal || confirmedStructuredSignalsCanPromote)
    ? 'ready'
    : confirmedStructuredSignalsCanPromote && (hasPrimary || hasExplicitSignal)
      ? 'ready'
      : hasPrimary || hasExplicitSignal || confirmedStructuredSignalsCanPromote || partialStructuredSignalsCanPromote
        ? 'partial'
        : allLinkedSignalsNotApplicable
          ? 'not_applicable'
          : 'blocked';
  const structuredSignalIds = [...confirmedSignalIds, ...partialSignalIds, ...blockedSignalIds, ...notApplicableSignalIds].sort((a, b) => a.localeCompare(b));
  const unresolvedAssumptions = status === 'ready' && conflictingContextIds.length === 0 && blockedContextIds.length === 0 && unresolvedContextIds.length === 0
    ? []
    : [
        ...missingCategories.map(category => `missing explicit category:${category}`),
        ...blockedSignalIds.map(signalId => `blocked structured signal:${signalId}`),
        ...conflictingContextIds.map(contextId => `conflicting resolved context:${contextId}`),
        ...blockedContextIds.map(contextId => `blocked resolved context:${contextId}`),
        ...unresolvedContextIds.map(contextId => `unresolved resolved context:${contextId}`),
      ].sort((a, b) => a.localeCompare(b));
  const defaultPolicyFallbacks = unresolvedAssumptions.length > 0 || fallbackDependentContextIds.length > 0
    ? [
        ...(unresolvedAssumptions.length > 0 ? [`${rule.flagId}:default_policy_requires_manual_review_until_explicit_truth_is_supplied`] : []),
        ...fallbackDependentContextIds.map(contextId => `${rule.flagId}:resolved_context_fallback_dependency:${contextId}`),
      ].sort((a, b) => a.localeCompare(b))
    : [];

  return {
    flagId: rule.flagId,
    status,
    satisfiedCategories: [...satisfiedRequired, ...supportive].sort((a, b) => a.localeCompare(b)),
    missingCategories,
    explicitSurveySignals: signals,
    structuredSignalIds,
    unresolvedAssumptions,
    defaultPolicyFallbacks,
    deterministicReason: `${rule.reason} Status ${status} from explicit categories [${[...satisfiedRequired, ...supportive].sort((a, b) => a.localeCompare(b)).join(', ') || 'none'}], explicit survey signals [${signals.join(', ') || 'none'}], structured signals [${structuredSignalIds.join(', ') || 'none'}], and resolved contexts [${resolvedContextIds.join(', ') || 'none'}].`,
    resolvedContextIds,
    authoritativeContextIds,
    preferredContextIds,
    partialContextIds,
    conflictingContextIds,
    blockedContextIds,
    unresolvedContextIds,
    fallbackDependentContextIds,
    contextStatuses,
  };
}

function categoriesFrom(
  manifest: SurveyEvidenceManifest | null | undefined,
  evidence: EngineeringSurveyEvidence | null | undefined,
): SurveyEvidenceCategory[] {
  return Array.from(new Set([
    ...(manifest?.items.map(item => item.category) ?? []),
    ...(evidence?.photos.map(photo => photo.category) ?? []),
  ])).sort((a, b) => a.localeCompare(b));
}
