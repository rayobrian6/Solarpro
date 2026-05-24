import type {
  GeometryIntelligenceReportV1,
  GeometryIntelligenceRiskCategory,
  GeometryReviewUrgency,
} from './geometryIntelligence';

export type GeometryReviewLifecycleStateV1 = 'review_not_recommended' | 'review_recommended' | 'review_required' | 'blocker_review';
export type GeometryReviewPriorityV1 = 'none' | 'low' | 'medium' | 'high' | 'blocker';
export type GeometryReviewQueueV1 =
  | 'no_review_queue'
  | 'geometry_review_queue'
  | 'readiness_trust_review_queue'
  | 'topology_investigation_queue'
  | 'blocker_review_queue';

export interface GeometryReviewReasonV1 {
  code: string;
  category: GeometryIntelligenceRiskCategory | 'low_trust_score' | 'discrepancy_severity' | 'review_urgency';
  message: string;
  affectedEntities: string[];
}

export interface GeometryReviewRecommendationV1 {
  schemaVersion: 'geometry_review_recommendation_v1';
  mode: 'deterministic_review_workflow_foundation';
  sourceSurveyId: string;
  sourceIntelligenceHash: string;
  recommendationHash: string;
  lifecycleState: GeometryReviewLifecycleStateV1;
  priority: GeometryReviewPriorityV1;
  queue: GeometryReviewQueueV1;
  sourceUrgency: GeometryReviewUrgency;
  reviewRecommended: boolean;
  reviewRequired: boolean;
  blockerReview: boolean;
  topologyInvestigationRecommended: boolean;
  reasons: GeometryReviewReasonV1[];
  recommendedActions: string[];
  noAuthorityEnforcement: {
    readOnly: true;
    automaticApprovalAllowed: false;
    autoCorrectionAllowed: false;
    canonicalGeometryMutationAllowed: false;
    cadMutationAllowed: false;
    cadSolverExecutionAllowed: false;
    persistenceAllowed: false;
    readinessPromotionAllowed: false;
  };
  deterministicNotes: string[];
}

export interface GeometryReviewQueueSummaryV1 {
  schemaVersion: 'geometry_review_queue_summary_v1';
  mode: 'deterministic_review_queue_summary';
  sourceRecommendationCount: number;
  summaryHash: string;
  lifecycleStateCounts: Record<GeometryReviewLifecycleStateV1, number>;
  priorityCounts: Record<GeometryReviewPriorityV1, number>;
  queueCounts: Record<GeometryReviewQueueV1, number>;
  topologyInvestigationRecommendedCount: number;
  blockerReviewCount: number;
  reviewRequiredCount: number;
  reviewRecommendedCount: number;
  topReasonCodes: Array<{ code: string; count: number }>;
  noAuthorityEnforcement: GeometryReviewRecommendationV1['noAuthorityEnforcement'];
}

export function buildGeometryReviewRecommendation(report: GeometryIntelligenceReportV1): GeometryReviewRecommendationV1 {
  const reasons = buildReasons(report);
  const topologyInvestigationRecommended = report.risks.some(risk =>
    risk.category === 'topology_disagreement'
    || risk.category === 'unsupported_polygon_structures'
    || risk.category === 'overlapping_geometry'
    || risk.category === 'near_zero_geometry_projections',
  ) || report.summaries.topologyConfidenceDegradation.length > 0;
  const lifecycleState = classifyLifecycleState(report);
  const priority = classifyPriority(report, topologyInvestigationRecommended);
  const queue = selectQueue(report, lifecycleState, topologyInvestigationRecommended);
  const withoutHash = {
    schemaVersion: 'geometry_review_recommendation_v1' as const,
    mode: 'deterministic_review_workflow_foundation' as const,
    sourceSurveyId: report.sourceSurveyId,
    sourceIntelligenceHash: report.intelligenceHash,
    lifecycleState,
    priority,
    queue,
    sourceUrgency: report.classification.reviewUrgency,
    reviewRecommended: lifecycleState !== 'review_not_recommended',
    reviewRequired: lifecycleState === 'review_required' || lifecycleState === 'blocker_review',
    blockerReview: lifecycleState === 'blocker_review',
    topologyInvestigationRecommended,
    reasons,
    recommendedActions: deterministicUnique([
      ...report.summaries.reviewActions,
      ...(topologyInvestigationRecommended ? ['Investigate topology instability before using geometry for CAD authority decisions.'] : []),
      ...(lifecycleState === 'blocker_review' ? ['Block downstream CAD authority promotion until human geometry review resolves blocker risks.'] : []),
    ]).slice(0, 8),
    noAuthorityEnforcement: noAuthorityEnforcement(),
    deterministicNotes: [
      'Review recommendation is derived deterministically from GeometryIntelligenceReportV1.',
      'Recommendation queues are operator workflow hints only and do not approve, correct, persist, or promote geometry.',
      'Blocker review prevents trust escalation in review logic only; it does not mutate CAD, canonical geometry, readiness, or downstream systems.',
    ],
  };

  return { ...withoutHash, recommendationHash: deterministicHash(withoutHash) };
}

export function buildGeometryReviewQueueSummary(recommendations: GeometryReviewRecommendationV1[]): GeometryReviewQueueSummaryV1 {
  const sorted = [...recommendations].sort((a, b) => a.sourceSurveyId.localeCompare(b.sourceSurveyId));
  const lifecycleStateCounts = countBy(sorted, ['review_not_recommended', 'review_recommended', 'review_required', 'blocker_review'] as const, item => item.lifecycleState);
  const priorityCounts = countBy(sorted, ['none', 'low', 'medium', 'high', 'blocker'] as const, item => item.priority);
  const queueCounts = countBy(sorted, [
    'no_review_queue',
    'geometry_review_queue',
    'readiness_trust_review_queue',
    'topology_investigation_queue',
    'blocker_review_queue',
  ] as const, item => item.queue);
  const topReasonCodes = topCounts(sorted.flatMap(item => item.reasons.map(reason => reason.code)), 8);
  const withoutHash = {
    schemaVersion: 'geometry_review_queue_summary_v1' as const,
    mode: 'deterministic_review_queue_summary' as const,
    sourceRecommendationCount: sorted.length,
    lifecycleStateCounts,
    priorityCounts,
    queueCounts,
    topologyInvestigationRecommendedCount: sorted.filter(item => item.topologyInvestigationRecommended).length,
    blockerReviewCount: sorted.filter(item => item.blockerReview).length,
    reviewRequiredCount: sorted.filter(item => item.reviewRequired).length,
    reviewRecommendedCount: sorted.filter(item => item.reviewRecommended).length,
    topReasonCodes,
    noAuthorityEnforcement: noAuthorityEnforcement(),
  };
  return { ...withoutHash, summaryHash: deterministicHash(withoutHash) };
}

function classifyLifecycleState(report: GeometryIntelligenceReportV1): GeometryReviewLifecycleStateV1 {
  if (report.classification.reviewUrgency === 'blocker_review' || report.classification.geometryRisk === 'critical') return 'blocker_review';
  if (report.classification.reviewUrgency === 'priority_review' || report.classification.geometryRisk === 'high') return 'review_required';
  if (report.classification.reviewUrgency === 'routine_review' || report.classification.geometryRisk === 'moderate') return 'review_recommended';
  if (Math.min(report.scores.geometryConfidenceScore, report.scores.topologyIntegrityScore, report.scores.readinessTrustScore) < 90) return 'review_recommended';
  return 'review_not_recommended';
}

function classifyPriority(report: GeometryIntelligenceReportV1, topologyInvestigationRecommended: boolean): GeometryReviewPriorityV1 {
  if (report.classification.reviewUrgency === 'blocker_review' || report.classification.geometryRisk === 'critical') return 'blocker';
  if (report.classification.reviewUrgency === 'priority_review' || report.classification.geometryRisk === 'high') return 'high';
  if (topologyInvestigationRecommended || report.classification.geometryRisk === 'moderate') return 'medium';
  if (Math.min(report.scores.geometryConfidenceScore, report.scores.topologyIntegrityScore, report.scores.readinessTrustScore) < 90) return 'low';
  return 'none';
}

function selectQueue(
  report: GeometryIntelligenceReportV1,
  lifecycleState: GeometryReviewLifecycleStateV1,
  topologyInvestigationRecommended: boolean,
): GeometryReviewQueueV1 {
  if (lifecycleState === 'blocker_review') return 'blocker_review_queue';
  if (topologyInvestigationRecommended) return 'topology_investigation_queue';
  if (report.scores.readinessTrustScore < 90 || report.risks.some(risk => risk.readinessImpact !== 'none')) return 'readiness_trust_review_queue';
  if (lifecycleState === 'review_required' || lifecycleState === 'review_recommended') return 'geometry_review_queue';
  return 'no_review_queue';
}

function buildReasons(report: GeometryIntelligenceReportV1): GeometryReviewReasonV1[] {
  const reasons: GeometryReviewReasonV1[] = report.risks.map(risk => ({
    code: `risk:${risk.category}:${risk.severity}`,
    category: risk.category,
    message: risk.evidenceSummary,
    affectedEntities: [...risk.affectedEntities].sort(),
  }));
  const minTrust = Math.min(report.scores.geometryConfidenceScore, report.scores.topologyIntegrityScore, report.scores.readinessTrustScore);
  if (minTrust < 90) {
    reasons.push({
      code: `score:min_trust_below_90:${trustBand(minTrust)}`,
      category: 'low_trust_score',
      message: `Minimum geometry trust score is ${minTrust}, so human review is recommended before increasing authority confidence.`,
      affectedEntities: [report.sourceSurveyId],
    });
  }
  if (report.scores.discrepancySeverityScore >= 12) {
    reasons.push({
      code: `discrepancy:${report.classification.discrepancySeverity}`,
      category: 'discrepancy_severity',
      message: `Discrepancy severity score is ${report.scores.discrepancySeverityScore}; review native-vs-OSS comparison notes.`,
      affectedEntities: report.discrepancyClusters.flatMap(cluster => cluster.affectedEntities).sort(),
    });
  }
  if (report.classification.reviewUrgency !== 'none') {
    reasons.push({
      code: `urgency:${report.classification.reviewUrgency}`,
      category: 'review_urgency',
      message: `Geometry intelligence classified review urgency as ${report.classification.reviewUrgency}.`,
      affectedEntities: [report.sourceSurveyId],
    });
  }
  return reasons.sort((a, b) => a.code.localeCompare(b.code));
}

function noAuthorityEnforcement(): GeometryReviewRecommendationV1['noAuthorityEnforcement'] {
  return {
    readOnly: true,
    automaticApprovalAllowed: false,
    autoCorrectionAllowed: false,
    canonicalGeometryMutationAllowed: false,
    cadMutationAllowed: false,
    cadSolverExecutionAllowed: false,
    persistenceAllowed: false,
    readinessPromotionAllowed: false,
  };
}

function trustBand(score: number): string {
  if (score < 35) return 'critical';
  if (score < 60) return 'high';
  if (score < 82) return 'moderate';
  return 'watch';
}

function countBy<T extends string, U>(values: readonly U[], keys: readonly T[], selector: (value: U) => T): Record<T, number> {
  const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;
  for (const value of values) counts[selector(value)] += 1;
  return counts;
}

function topCounts(values: string[], limit: number): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

function deterministicUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function deterministicHash(value: unknown): string {
  const json = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
