import type { CADReadinessFlagId } from './cadReadiness';
import type { EngineeringContextType } from './contextTypes';
import type { EngineeringScenarioSimulationResult } from './scenarioSimulation';
import type { StructuredEngineeringSignalType } from './signalTypes';
import type { EngineeringStaleClass, PropagationTraversalPath } from './propagationGraph';

export type EngineeringRecommendationType =
  | 'collect_msp_photo'
  | 'collect_disconnect_photo'
  | 'collect_attic_photo'
  | 'collect_roof_edge_context'
  | 'collect_routing_context'
  | 'collect_trench_path'
  | 'collect_detached_structure_context'
  | 'collect_ess_wall_context'
  | 'resolve_conflicting_context'
  | 'resolve_routing_ambiguity'
  | 'resolve_roof_context'
  | 'resolve_electrical_context'
  | 'improve_traversal_continuity'
  | 'improve_grouping_stability'
  | 'reduce_fallback_dependency'
  | 'resolve_blocked_requirement'
  | 'reduce_stale_outputs'
  | 'improve_context_authority'
  | 'improve_cad_readiness'
  | 'stabilize_dependency_chain'
  | 'simulate_msp_confirmation'
  | 'simulate_roof_context_improvement'
  | 'simulate_routing_confirmation'
  | 'simulate_trench_resolution';

export type EngineeringRecommendationCategory = 'survey' | 'quality' | 'engineering' | 'simulation';
export type EngineeringRecommendationPriority = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type EngineeringRecommendationSeverity = 'blocked' | 'review_required' | 'stale_risk' | 'quality_gap' | 'guidance';
export type EngineeringRecommendationConfidence = 'none' | 'low' | 'medium' | 'high';

export interface EngineeringRecommendationScoreBreakdown {
  staleImpactCount: number;
  affectedOutputCount: number;
  invalidationPropagationDepth: number;
  blockedRequirementCount: number;
  cadReadinessImpact: number;
  conflictSeverity: number;
  fallbackParticipation: number;
  unresolvedDependencyCount: number;
  dependencyTraversalCentrality: number;
  contextAuthorityWeakness: number;
  scenarioSimulationImpact: number;
  expectedReadinessGain: number;
  expectedConfidenceGain: number;
  deterministicScore: number;
  deterministicReason: string;
}

export interface EngineeringRecommendation {
  recommendationId: string;
  recommendationType: EngineeringRecommendationType;
  category: EngineeringRecommendationCategory;
  priority: EngineeringRecommendationPriority;
  severity: EngineeringRecommendationSeverity;
  confidence: EngineeringRecommendationConfidence;
  explanation: string;
  affectedEvidenceIds: string[];
  affectedSignalIds: string[];
  affectedSignalTypes: StructuredEngineeringSignalType[];
  affectedContextIds: string[];
  affectedContextTypes: EngineeringContextType[];
  affectedRequirementIds: string[];
  affectedDecisionIds: string[];
  affectedOutputIds: string[];
  staleImpactParticipation: Array<{ entityId: string; staleClasses: EngineeringStaleClass[]; deterministicReason: string }>;
  invalidationParticipation: string[];
  regenerationParticipation: string[];
  fallbackParticipation: string[];
  conflictParticipation: string[];
  dependencyTraversal: PropagationTraversalPath[];
  cadReadinessImpact: CADReadinessFlagId[];
  expectedConfidenceGain: number;
  expectedReadinessGain: number;
  unresolvedStatesPreserved: string[];
  uncertaintyNotes: string[];
  safetyNotes: string[];
  scoreBreakdown: EngineeringRecommendationScoreBreakdown;
  deterministicScore: number;
  deterministicHash: string;
}

export interface EngineeringRecommendationEngineInput {
  projectId?: string | null;
  surveyId?: string | null;
  generatedAt?: string;
  cadReadiness?: import('./cadReadiness').CADReadinessMetadataModel | null;
  photoGrouping?: import('./photoGrouping').DeterministicPhotoGroupingModel | null;
  structuredSignals?: import('./signalTypes').StructuredEngineeringSignalSummary | null;
  contextResolution?: import('./contextTypes').EngineeringContextResolutionSummary | null;
  invalidationPropagation?: import('./invalidationEngine').EngineeringInvalidationPropagationResult | null;
  regenerationPlan?: import('./regenerationPlanner').EngineeringRegenerationPlanV1 | null;
  scenarioSimulations?: EngineeringScenarioSimulationResult[] | null;
  maxRecommendations?: number;
}

export interface EngineeringRecommendationSummary {
  modelVersion: 'engineering_recommendations_v1';
  projectId: string | null;
  surveyId: string | null;
  generatedAt: string;
  mode: 'deterministic_guidance_only';
  recommendations: EngineeringRecommendation[];
  highestValueNextActions: EngineeringRecommendation[];
  surveyRecommendations: EngineeringRecommendation[];
  conflictResolutionRecommendations: EngineeringRecommendation[];
  fallbackReductionRecommendations: EngineeringRecommendation[];
  cadReadinessRecommendations: EngineeringRecommendation[];
  simulationBackedRecommendations: EngineeringRecommendation[];
  dependencyRiskRecommendations: EngineeringRecommendation[];
  staleImpactRecommendations: EngineeringRecommendation[];
  confidenceBreakdown: Array<{ recommendationId: string; confidence: EngineeringRecommendationConfidence; expectedConfidenceGain: number; expectedReadinessGain: number; deterministicScore: number; uncertaintyNotes: string[] }>;
  unresolvedStatesPreserved: string[];
  deterministicHash: string;
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}
