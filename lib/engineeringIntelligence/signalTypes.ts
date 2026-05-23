import type { CADReadinessFlagId } from './cadReadiness';
import type { EngineeringStaleClass } from './propagationGraph';
import type { DeterministicClusterConfidence, DeterministicClusterType } from './photoGrouping';
import type { EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';

export type StructuredEngineeringSignalStatus = 'confirmed' | 'partial' | 'blocked' | 'missing' | 'not_applicable';

export type StructuredEngineeringSignalCategory =
  | 'utility_electrical'
  | 'roof_structural'
  | 'routing'
  | 'ess'
  | 'ground_trench'
  | 'survey_quality';

export type StructuredEngineeringSignalSource =
  | 'canonical_evidence'
  | 'canonical_manifest_summary'
  | 'canonical_evidence_metadata'
  | 'survey_field_evidence'
  | 'deterministic_grouping_metadata'
  | 'requirement_evaluation'
  | 'cad_readiness_metadata'
  | 'invalidation_propagation_metadata'
  | 'project_metadata';

export type StructuredEngineeringSignalConfidenceBand = 'none' | 'low' | 'medium' | 'high';

export interface StructuredEngineeringSignalConfidence {
  score: number;
  band: StructuredEngineeringSignalConfidenceBand;
  factors: string[];
}

export type StructuredEngineeringSignalType =
  | 'utility_meter_present'
  | 'utility_meter_side_known'
  | 'main_service_panel_present'
  | 'main_disconnect_present'
  | 'subpanel_present'
  | 'interconnection_zone_known'
  | 'electrical_equipment_cluster_present'
  | 'inverter_location_candidate_present'
  | 'garage_interior_wall_present'
  | 'utility_access_context_present'
  | 'roof_plane_context_present'
  | 'roof_edge_context_present'
  | 'ridge_context_present'
  | 'obstruction_context_present'
  | 'roof_surface_context_present'
  | 'attic_access_confirmed'
  | 'framing_context_present'
  | 'structural_access_context_present'
  | 'roof_layout_candidate_present'
  | 'conduit_route_candidate_present'
  | 'routing_continuity_present'
  | 'exterior_wall_route_candidate'
  | 'attic_route_candidate'
  | 'utility_to_inverter_route_candidate'
  | 'inverter_to_msp_route_candidate'
  | 'ess_location_candidate_present'
  | 'battery_wall_candidate_present'
  | 'energy_storage_context_present'
  | 'trench_path_explicit'
  | 'trench_context_present'
  | 'detached_structure_present'
  | 'detached_structure_route_candidate'
  | 'survey_traversal_complete'
  | 'survey_sequence_continuity_good'
  | 'metadata_completeness_sufficient'
  | 'evidence_grouping_stable'
  | 'photo_cluster_confidence_high';

export interface StructuredEngineeringSignal {
  id: string;
  signal_type: StructuredEngineeringSignalType;
  category: StructuredEngineeringSignalCategory;
  status: StructuredEngineeringSignalStatus;
  confidence: StructuredEngineeringSignalConfidence;
  sources: StructuredEngineeringSignalSource[];
  sourceEvidenceIds: string[];
  sourcePhotoIds: string[];
  sourceSurveyIds: string[];
  derivedFrom: string[];
  dependencyNodes: string[];
  requirementImpacts: EngineeringRequirementId[];
  decisionImpacts: string[];
  cadImpacts: CADReadinessFlagId[];
  staleImpacts: EngineeringStaleClass[];
  invalidatedBy: string[];
  generatedAt: string;
  deterministicHash: string;
  explanation: string;
  blockingReasons: string[];
  partialReasons: string[];
}

export interface StructuredEngineeringSignalDefinition {
  signalType: StructuredEngineeringSignalType;
  category: StructuredEngineeringSignalCategory;
  label: string;
  evidenceCategories: SurveyEvidenceCategory[];
  anyEvidenceCategories?: SurveyEvidenceCategory[];
  fieldSignals?: string[];
  clusterTypes?: DeterministicClusterType[];
  groupedReadinessContextIds?: string[];
  requirementImpacts: EngineeringRequirementId[];
  decisionImpacts: string[];
  cadImpacts: CADReadinessFlagId[];
  sourceHints: StructuredEngineeringSignalSource[];
  notApplicableWhenAbsent?: boolean;
  minimumEvidenceCount?: number;
  minimumClusterCount?: number;
  highConfidenceCluster?: DeterministicClusterConfidence;
  explanation: string;
  missingReason: string;
}

export interface StructuredEngineeringSignalSummary {
  modelVersion: 'structured_engineering_signals_v1';
  generatedAt: string;
  projectId: string | null;
  surveyId: string | null;
  source: 'canonical_evidence_and_metadata' | 'not_loaded';
  signals: StructuredEngineeringSignal[];
  satisfiedSignals: StructuredEngineeringSignal[];
  partialSignals: StructuredEngineeringSignal[];
  blockedSignals: StructuredEngineeringSignal[];
  missingSignals: StructuredEngineeringSignal[];
  notApplicableSignals: StructuredEngineeringSignal[];
  requirementMappings: Array<{
    requirementId: EngineeringRequirementId;
    signalIds: string[];
    confirmedSignalIds: string[];
    partialSignalIds: string[];
    missingSignalIds: string[];
  }>;
  cadReadinessMappings: Array<{
    flagId: CADReadinessFlagId;
    signalIds: string[];
    confirmedSignalIds: string[];
    partialSignalIds: string[];
    blockedSignalIds: string[];
  }>;
  dependencyGraph: {
    nodes: Array<{ nodeId: string; label: string; nodeType: 'signal' | 'evidence' | 'requirement' | 'cad_readiness' | 'grouping' | 'invalidation'; status: string }>;
    edges: Array<{ edgeId: string; sourceNodeId: string; targetNodeId: string; edgeType: 'derived_from' | 'impacts_requirement' | 'impacts_cad_readiness' | 'invalidated_by' | 'depends_on'; deterministicReason: string }>;
  };
  staleImpacts: Array<{ signalId: string; staleClasses: EngineeringStaleClass[]; invalidatedBy: string[] }>;
  fallbackParticipation: Array<{ signalId: string; fallback: string; deterministicReason: string }>;
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}
