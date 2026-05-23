import type { CADReadinessFlagId } from './cadReadiness';
import type { EngineeringContextType } from './contextTypes';
import type { EngineeringStaleClass, PropagationTraversalPath } from './propagationGraph';
import type { StructuredEngineeringSignalType } from './signalTypes';
import type { EngineeringRecommendation, EngineeringRecommendationConfidence } from './recommendationTypes';

export type EngineeringWorkflowType =
  | 'collect_missing_electrical_evidence'
  | 'collect_missing_structural_evidence'
  | 'collect_missing_routing_evidence'
  | 'improve_traversal_continuity'
  | 'validate_detached_structure'
  | 'validate_trench_context'
  | 'review_stale_outputs'
  | 'review_invalidated_contexts'
  | 'approve_regeneration_scope'
  | 'review_fallback_heavy_design'
  | 'resolve_context_conflicts'
  | 'stabilize_dependency_chain'
  | 'investigate_conflicting_contexts'
  | 'investigate_low_confidence_contexts'
  | 'validate_dependency_risk'
  | 'validate_context_authority'
  | 'resolve_permit_blockers'
  | 'validate_interconnection_context'
  | 'validate_setback_context'
  | 'validate_utility_requirements'
  | 'verify_equipment_location'
  | 'verify_trench_route'
  | 'verify_conduit_path'
  | 'verify_structural_access';

export type EngineeringWorkflowCategory = 'survey_ops' | 'engineering_ops' | 'qa_ops' | 'permit_ops' | 'install_ops';
export type EngineeringWorkflowPriority = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type EngineeringWorkflowSeverity = 'blocked' | 'escalation' | 'review_required' | 'stale_risk' | 'quality_gap' | 'guidance';
export type EngineeringWorkflowStatus = 'pending' | 'requires_review' | 'blocked' | 'escalated' | 'simulated' | 'deferred' | 'resolved' | 'invalidated';
export type EngineeringWorkflowReviewerRole = 'survey_ops' | 'field_technician' | 'project_engineer' | 'qa_reviewer' | 'permit_coordinator' | 'install_coordinator';

export interface EngineeringWorkflowScoreBreakdown {
  staleImpactSeverity: number;
  affectedOutputCount: number;
  invalidationPropagationDepth: number;
  blockedRequirementCount: number;
  cadReadinessImpact: number;
  conflictSeverity: number;
  fallbackParticipation: number;
  unresolvedDependencyCount: number;
  recommendationRanking: number;
  simulationImpact: number;
  dependencyTraversalCentrality: number;
  confidenceDegradation: number;
  permitReadinessImpact: number;
  installReadinessImpact: number;
  deterministicScore: number;
  deterministicReason: string;
}

export interface EngineeringWorkflowSimulationOutcome {
  scenarioIds: string[];
  hypotheticalRemediationOutcomes: string[];
  hypotheticalConfidenceImprovement: number;
  hypotheticalCADReadinessImprovement: number;
  hypotheticalStaleReduction: number;
  deterministicReason: string;
}

export interface EngineeringWorkflowItem {
  workflowId: string;
  workflowType: EngineeringWorkflowType;
  category: EngineeringWorkflowCategory;
  priority: EngineeringWorkflowPriority;
  severity: EngineeringWorkflowSeverity;
  status: EngineeringWorkflowStatus;
  deterministicScore: number;
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
  blockingImpacts: string[];
  escalationReason: string;
  recommendedReviewerRole: EngineeringWorkflowReviewerRole;
  recommendedTechnicianAction: string;
  sourceRecommendationIds: string[];
  sourceRecommendationTypes: string[];
  simulationOutcome: EngineeringWorkflowSimulationOutcome;
  unresolvedStatesPreserved: string[];
  safetyNotes: string[];
  scoreBreakdown: EngineeringWorkflowScoreBreakdown;
  deterministicHash: string;
}

export interface EngineeringWorkflowOrchestrationInput {
  projectId?: string | null;
  surveyId?: string | null;
  generatedAt?: string;
  recommendations?: import('./recommendationTypes').EngineeringRecommendationSummary | null;
  cadReadiness?: import('./cadReadiness').CADReadinessMetadataModel | null;
  structuredSignals?: import('./signalTypes').StructuredEngineeringSignalSummary | null;
  contextResolution?: import('./contextTypes').EngineeringContextResolutionSummary | null;
  invalidationPropagation?: import('./invalidationEngine').EngineeringInvalidationPropagationResult | null;
  regenerationPlan?: import('./regenerationPlanner').EngineeringRegenerationPlanV1 | null;
  scenarioSimulations?: import('./scenarioSimulation').EngineeringScenarioSimulationResult[] | null;
  maxWorkflows?: number;
}

export interface EngineeringWorkflowQueueSummary {
  queueId: string;
  label: string;
  category: EngineeringWorkflowCategory | 'mixed';
  workflows: EngineeringWorkflowItem[];
  deterministicReason: string;
}

export interface EngineeringWorkflowOrchestrationSummary {
  modelVersion: 'engineering_workflow_orchestration_v1';
  projectId: string | null;
  surveyId: string | null;
  generatedAt: string;
  mode: 'deterministic_orchestration_review_only';
  workflows: EngineeringWorkflowItem[];
  highestPriorityWorkflows: EngineeringWorkflowItem[];
  surveyFollowUpQueue: EngineeringWorkflowItem[];
  engineeringReviewQueue: EngineeringWorkflowItem[];
  conflictResolutionQueue: EngineeringWorkflowItem[];
  fallbackRiskQueue: EngineeringWorkflowItem[];
  cadReadinessEscalations: EngineeringWorkflowItem[];
  permitReadinessQueue: EngineeringWorkflowItem[];
  installBlockerQueue: EngineeringWorkflowItem[];
  regenerationApprovalQueue: EngineeringWorkflowItem[];
  dependencyRiskEscalations: EngineeringWorkflowItem[];
  workflowSimulationImpacts: EngineeringWorkflowItem[];
  queueSummaries: EngineeringWorkflowQueueSummary[];
  unresolvedStatesPreserved: string[];
  deterministicHash: string;
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}

export type WorkflowSourceRecommendation = Pick<EngineeringRecommendation,
  | 'recommendationId'
  | 'recommendationType'
  | 'category'
  | 'priority'
  | 'severity'
  | 'confidence'
  | 'explanation'
  | 'affectedEvidenceIds'
  | 'affectedSignalIds'
  | 'affectedSignalTypes'
  | 'affectedContextIds'
  | 'affectedContextTypes'
  | 'affectedRequirementIds'
  | 'affectedDecisionIds'
  | 'affectedOutputIds'
  | 'staleImpactParticipation'
  | 'invalidationParticipation'
  | 'regenerationParticipation'
  | 'fallbackParticipation'
  | 'conflictParticipation'
  | 'dependencyTraversal'
  | 'cadReadinessImpact'
  | 'expectedConfidenceGain'
  | 'expectedReadinessGain'
  | 'unresolvedStatesPreserved'
  | 'uncertaintyNotes'
  | 'safetyNotes'
  | 'deterministicScore'
>;
