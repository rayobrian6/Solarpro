import type { EngineeringWorkflowItem, EngineeringWorkflowPriority, EngineeringWorkflowQueueSummary, EngineeringWorkflowSeverity, EngineeringWorkflowStatus } from './workflowTypes';

const severityRank: Record<EngineeringWorkflowSeverity, number> = {
  blocked: 6,
  escalation: 5,
  review_required: 4,
  stale_risk: 3,
  quality_gap: 2,
  guidance: 1,
};

const priorityRank: Record<EngineeringWorkflowPriority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

const statusRank: Record<EngineeringWorkflowStatus, number> = {
  blocked: 8,
  escalated: 7,
  requires_review: 6,
  simulated: 5,
  pending: 4,
  deferred: 3,
  invalidated: 2,
  resolved: 1,
};

export function rankEngineeringWorkflows(workflows: EngineeringWorkflowItem[]): EngineeringWorkflowItem[] {
  return [...workflows].sort((a, b) => {
    const score = b.deterministicScore - a.deterministicScore;
    if (score !== 0) return score;
    const severity = severityRank[b.severity] - severityRank[a.severity];
    if (severity !== 0) return severity;
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const category = a.category.localeCompare(b.category);
    if (category !== 0) return category;
    const type = a.workflowType.localeCompare(b.workflowType);
    if (type !== 0) return type;
    return a.workflowId.localeCompare(b.workflowId);
  });
}

export function workflowPriority(score: number, severity: EngineeringWorkflowSeverity): EngineeringWorkflowPriority {
  if (severity === 'blocked' && score >= 70) return 'critical';
  if (severity === 'blocked' || severity === 'escalation' || score >= 55) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 10) return 'low';
  return 'informational';
}

export function workflowStatus(input: {
  severity: EngineeringWorkflowSeverity;
  conflictCount: number;
  blockedCount: number;
  simulationCount: number;
  staleCount: number;
  unresolvedCount: number;
}): EngineeringWorkflowStatus {
  if (input.blockedCount > 0 || input.severity === 'blocked') return 'blocked';
  if (input.conflictCount > 0 || input.unresolvedCount > 2) return 'escalated';
  if (input.simulationCount > 0) return 'simulated';
  if (input.staleCount > 0 || input.unresolvedCount > 0) return 'requires_review';
  return 'pending';
}

export function buildWorkflowQueueSummaries(workflows: EngineeringWorkflowItem[]): EngineeringWorkflowQueueSummary[] {
  const ranked = rankEngineeringWorkflows(workflows);
  return [
    queue('engineering_workflow_orchestration', 'Engineering Workflow Orchestration', 'mixed', ranked, 'All deterministic workflow items in canonical rank order.'),
    queue('survey_follow_up_queue', 'Survey Follow-Up Queue', 'survey_ops', ranked.filter(workflow => workflow.category === 'survey_ops'), 'Survey operations queue contains explicit evidence and traversal follow-up workflows only.'),
    queue('engineering_review_queue', 'Engineering Review Queue', 'engineering_ops', ranked.filter(workflow => workflow.category === 'engineering_ops'), 'Engineering review queue contains stale, regeneration, fallback, conflict, and dependency-chain review workflows.'),
    queue('conflict_resolution_queue', 'Conflict Resolution Queue', 'mixed', ranked.filter(workflow => workflow.conflictParticipation.length > 0 || workflow.workflowType.includes('conflict')), 'Conflict queue preserves unresolved conflicts and does not auto-resolve contexts.'),
    queue('fallback_risk_queue', 'Fallback Risk Queue', 'mixed', ranked.filter(workflow => workflow.fallbackParticipation.length > 0 || workflow.workflowType === 'review_fallback_heavy_design'), 'Fallback queue exposes default-policy and fallback lineage for human review.'),
    queue('cad_readiness_escalations', 'CAD Readiness Escalations', 'mixed', ranked.filter(workflow => workflow.cadReadinessImpact.length > 0), 'CAD readiness queue exposes blocked or partial readiness impacts without generating CAD.'),
    queue('permit_readiness_queue', 'Permit Readiness Queue', 'permit_ops', ranked.filter(workflow => workflow.category === 'permit_ops'), 'Permit readiness queue exposes AHJ/utility/interconnection blockers without approving permits.'),
    queue('install_blocker_queue', 'Install Blocker Queue', 'install_ops', ranked.filter(workflow => workflow.category === 'install_ops'), 'Install blocker queue exposes field verification and placement blockers without scheduling execution.'),
    queue('regeneration_approval_queue', 'Regeneration Approval Queue', 'mixed', ranked.filter(workflow => workflow.regenerationParticipation.length > 0 || workflow.workflowType === 'approve_regeneration_scope'), 'Regeneration queue exposes candidate scope only and never triggers regeneration.'),
    queue('dependency_risk_escalations', 'Dependency Risk Escalations', 'mixed', ranked.filter(workflow => workflow.dependencyTraversal.length > 0 || workflow.workflowType === 'stabilize_dependency_chain' || workflow.workflowType === 'validate_dependency_risk'), 'Dependency risk queue exposes traversal centrality and downstream impact paths.'),
    queue('workflow_simulation_impacts', 'Workflow Simulation Impacts', 'mixed', ranked.filter(workflow => workflow.simulationOutcome.scenarioIds.length > 0), 'Simulation queue exposes hypothetical remediation outcomes from read-only scenario simulations.'),
  ];
}

function queue(queueId: string, label: string, category: EngineeringWorkflowQueueSummary['category'], workflows: EngineeringWorkflowItem[], deterministicReason: string): EngineeringWorkflowQueueSummary {
  return { queueId, label, category, workflows, deterministicReason };
}
