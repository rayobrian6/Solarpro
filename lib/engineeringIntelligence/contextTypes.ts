import type { EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import type { CADReadinessFlagId } from './cadReadiness';
import type { DeterministicPhotoGroupingModel } from './photoGrouping';
import type { EngineeringStaleClass } from './propagationGraph';
import type { StructuredEngineeringSignal, StructuredEngineeringSignalType } from './signalTypes';

export type EngineeringContextDomain = 'roof' | 'routing' | 'electrical' | 'ess' | 'utility' | 'ground_detached' | 'survey_quality';

export type EngineeringContextStatus = 'authoritative' | 'preferred' | 'partial' | 'conflicting' | 'blocked' | 'unresolved' | 'not_applicable';

export type EngineeringContextType =
  | 'preferred_roof_context'
  | 'preferred_roof_plane_context'
  | 'preferred_setback_context'
  | 'preferred_obstruction_context'
  | 'preferred_layout_context'
  | 'preferred_routing_context'
  | 'preferred_conduit_context'
  | 'preferred_attic_route_context'
  | 'preferred_exterior_route_context'
  | 'preferred_utility_to_inverter_context'
  | 'preferred_inverter_to_msp_context'
  | 'preferred_msp_context'
  | 'preferred_disconnect_context'
  | 'preferred_interconnection_context'
  | 'preferred_equipment_cluster_context'
  | 'preferred_ess_context'
  | 'preferred_battery_location_context'
  | 'preferred_utility_meter_context'
  | 'preferred_utility_access_context'
  | 'preferred_trench_context'
  | 'preferred_detached_structure_context'
  | 'preferred_traversal_context'
  | 'preferred_grouping_context'
  | 'preferred_metadata_context';

export interface EngineeringContextDefinition {
  contextType: EngineeringContextType;
  domain: EngineeringContextDomain;
  label: string;
  primarySignalTypes: StructuredEngineeringSignalType[];
  supportingSignalTypes: StructuredEngineeringSignalType[];
  conflictingSignalTypes: StructuredEngineeringSignalType[];
  cadImpacts: CADReadinessFlagId[];
  requirementImpacts: EngineeringRequirementId[];
  decisionImpacts: string[];
  affectedOutputs: string[];
  fallbackAllowed: boolean;
  explicitPrimaryRequired: boolean;
  optionalWhenPrimaryAbsent: boolean;
  deterministicPurpose: string;
}

export interface EngineeringContextConfidence {
  score: number;
  band: 'none' | 'low' | 'medium' | 'high';
  rank: number;
  factors: string[];
  penalties: string[];
}

export interface EngineeringContextConflict {
  conflictId: string;
  contextId: string;
  contextType: EngineeringContextType;
  domain: EngineeringContextDomain;
  competingContextIds: string[];
  competingSignalIds: string[];
  conflictReasoning: string[];
  deterministicResolutionPolicy: string;
}

export interface ResolvedEngineeringContext {
  id: string;
  contextType: EngineeringContextType;
  domain: EngineeringContextDomain;
  status: EngineeringContextStatus;
  sourceSignalIds: string[];
  supportingSignalIds: string[];
  competingSignalIds: string[];
  sourceEvidenceIds: string[];
  sourceMetadataIds: string[];
  dependencyLineage: string[];
  invalidationLineage: string[];
  staleImpactPropagation: EngineeringStaleClass[];
  regenerationParticipation: string[];
  affectedOutputs: string[];
  cadReadinessImpacts: CADReadinessFlagId[];
  requirementImpacts: EngineeringRequirementId[];
  decisionImpacts: string[];
  confidence: EngineeringContextConfidence;
  rankingReason: string;
  conflictReasoning: string[];
  fallbackLineage: string[];
  unresolvedDependencies: string[];
  fallbackConfidencePenalties: string[];
  deterministicHash: string;
}

export interface EngineeringContextDependencyGraph {
  nodes: Array<{ nodeId: string; label: string; nodeType: 'context' | 'signal' | 'evidence' | 'metadata' | 'cad_readiness' | 'requirement' | 'decision' | 'invalidation'; status: string }>;
  edges: Array<{ edgeId: string; sourceNodeId: string; targetNodeId: string; edgeType: 'derived_from' | 'supports' | 'competes_with' | 'impacts_cad_readiness' | 'impacts_requirement' | 'impacts_decision' | 'invalidated_by'; deterministicReason: string }>;
}

export interface EngineeringContextResolutionSummary {
  modelVersion: 'engineering_context_resolution_v1';
  generatedAt: string;
  projectId: string | null;
  surveyId: string | null;
  source: 'structured_engineering_signals' | 'not_loaded';
  contexts: ResolvedEngineeringContext[];
  authoritativeContexts: ResolvedEngineeringContext[];
  preferredContexts: ResolvedEngineeringContext[];
  partialContexts: ResolvedEngineeringContext[];
  conflictingContexts: ResolvedEngineeringContext[];
  blockedContexts: ResolvedEngineeringContext[];
  unresolvedContexts: ResolvedEngineeringContext[];
  notApplicableContexts: ResolvedEngineeringContext[];
  conflicts: EngineeringContextConflict[];
  fallbackParticipation: Array<{ contextId: string; fallback: string; deterministicReason: string }>;
  cadReadinessMappings: Array<{ flagId: CADReadinessFlagId; contextIds: string[]; authoritativeContextIds: string[]; preferredContextIds: string[]; partialContextIds: string[]; conflictingContextIds: string[]; blockedContextIds: string[]; unresolvedContextIds: string[] }>;
  dependencyGraph: EngineeringContextDependencyGraph;
  timeline: Array<{ eventId: string; contextId: string; status: EngineeringContextStatus; deterministicReason: string }>;
  staleImpacts: Array<{ contextId: string; staleClasses: EngineeringStaleClass[]; invalidatedBy: string[] }>;
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}

export type ContextSignalLookup = Map<StructuredEngineeringSignalType, StructuredEngineeringSignal[]>;

export type ContextPhotoGroupingInput = DeterministicPhotoGroupingModel | null;
