import { enrichSurvey } from './enrichSurvey';
import { buildGeometryComparisonReport, type GeometryComparisonReportV1 } from './geometryComparisonAdapter';
import { buildGeometryIntelligenceReport, type GeometryIntelligenceReportV1 } from './geometryIntelligence';
import { buildGeometryReviewQueueSummary, buildGeometryReviewRecommendation, type GeometryReviewQueueSummaryV1, type GeometryReviewRecommendationV1 } from './geometryReviewWorkflow';
import { normalizeSurvey } from './normalizeSurvey';
import {
  buildCanonicalSurveyGeometry,
  buildSurveyCADReadiness,
  parseProfessionalSiteSurvey,
  type CanonicalSurveyGeometryV1,
  type ProfessionalSiteSurveyEvidenceBundleV1,
  type SurveyCADReadinessV1,
} from './professionalSurveyParser';
import type { RawSurveyPayload } from './types';

export interface GeometryCorpusReplayItemInputV1 {
  corpusItemId: string;
  label?: string;
  rawSurvey: RawSurveyPayload;
}

export interface GeometryCorpusReplayItemResultV1 {
  schemaVersion: 'geometry_corpus_replay_item_v1';
  corpusItemId: string;
  label: string | null;
  sourceSurveyId: string;
  evidence: ProfessionalSiteSurveyEvidenceBundleV1;
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  comparisonReport: GeometryComparisonReportV1;
  intelligence: GeometryIntelligenceReportV1;
  reviewRecommendation: GeometryReviewRecommendationV1;
  itemHash: string;
  noAuthorityEnforcement: GeometryCorpusNoAuthorityEnforcementV1;
}

export interface GeometryCorpusReplayReportV1 {
  schemaVersion: 'geometry_corpus_replay_report_v1';
  mode: 'deterministic_replay_safe_geometry_trust_operations';
  corpusId: string;
  corpusItemCount: number;
  replayHash: string;
  itemHashes: string[];
  summaries: {
    replay: GeometryReplaySummaryV1;
    confidenceDistributions: GeometryReplayConfidenceDistributionsV1;
    discrepancyDistributions: GeometryReplayDiscrepancyDistributionsV1;
    topologyDegradation: GeometryReplayTopologyDegradationSummaryV1;
    recurringRisks: GeometryReplayRecurringRiskSummaryV1;
    readinessDowngrades: GeometryReplayReadinessDowngradeSummaryV1;
    integrityTrend: GeometryReplayIntegrityTrendSummaryV1;
    reviewQueue: GeometryReviewQueueSummaryV1;
    trustCalibration: GeometryTrustCalibrationReportV1;
    operationalInsight: GeometryOperationalInsightReportV1;
  };
  items: GeometryCorpusReplayItemResultV1[];
  noAuthorityEnforcement: GeometryCorpusNoAuthorityEnforcementV1;
  deterministicNotes: string[];
}

export interface GeometryReplaySummaryV1 {
  cleanItemCount: number;
  reviewRecommendedItemCount: number;
  reviewRequiredItemCount: number;
  blockerItemCount: number;
  cadReadyButReviewRecommendedCount: number;
  nativeBlockedCount: number;
  averageScores: GeometryScoreSummaryV1;
}

export interface GeometryScoreSummaryV1 {
  geometryConfidenceScore: number;
  topologyIntegrityScore: number;
  readinessTrustScore: number;
  discrepancySeverityScore: number;
}

export interface GeometryReplayConfidenceDistributionsV1 {
  geometryConfidenceScore: ScoreDistributionV1;
  topologyIntegrityScore: ScoreDistributionV1;
  readinessTrustScore: ScoreDistributionV1;
  discrepancySeverityScore: ScoreDistributionV1;
}

export interface ScoreDistributionV1 {
  min: number;
  max: number;
  average: number;
  bands: Record<'0_34' | '35_59' | '60_81' | '82_89' | '90_100', number>;
}

export interface GeometryReplayDiscrepancyDistributionsV1 {
  severityCounts: Record<'info' | 'warning' | 'error', number>;
  observationCategoryCounts: Record<string, number>;
  discrepancyClusterCount: number;
  surveysWithDiscrepancies: number;
  likelyNativeFalsePositiveCount: number;
  likelyNativeFalseNegativeCount: number;
}

export interface GeometryReplayTopologyDegradationSummaryV1 {
  unstableItemCount: number;
  overlappingPairCount: number;
  duplicateEdgePolygonCount: number;
  selfIntersectingPolygonCount: number;
  invalidPolygonCount: number;
  clippingFailureCount: number;
  degradationNotes: string[];
}

export interface GeometryReplayRecurringRiskSummaryV1 {
  riskCategoryCounts: Record<string, number>;
  highestFrequencyRiskCategories: Array<{ category: string; count: number }>;
  failureClusters: Array<{ cluster: string; corpusItemIds: string[]; count: number }>;
}

export interface GeometryReplayReadinessDowngradeSummaryV1 {
  readinessStatusCounts: Record<'cad_ready' | 'review_required' | 'blocked', number>;
  downgradeCauseCounts: Record<string, number>;
  cadReadyTrustDegradedCount: number;
  readinessTrustBelow90Count: number;
  readinessTrustBelow60Count: number;
}

export interface GeometryReplayIntegrityTrendSummaryV1 {
  stableHighTrustCount: number;
  topologyStableButReadinessDegradedCount: number;
  topologyUnstableCount: number;
  averageTopologyMinusReadinessTrustGap: number;
  trendNotes: string[];
}

export interface GeometryTrustCalibrationReportV1 {
  schemaVersion: 'geometry_trust_calibration_report_v1';
  calibrationMode: 'replay_explainability_consistency_only';
  confidenceStability: string;
  discrepancyConsistency: string;
  severityCalibration: string;
  reviewRecommendationQuality: string;
  observations: string[];
  automationBoundary: 'no_authority_promotion_recommended';
}

export interface GeometryOperationalInsightReportV1 {
  schemaVersion: 'geometry_operational_insight_report_v1';
  confidenceDistributionSummary: string;
  recurringGeometryRiskCategories: string[];
  reviewQueueDistribution: GeometryReviewQueueSummaryV1['queueCounts'];
  topologyInstabilityFrequency: number;
  discrepancyHotSpots: Array<{ category: string; count: number }>;
  reviewUrgencyPatterns: GeometryReviewQueueSummaryV1['priorityCounts'];
}

export interface GeometryCorpusNoAuthorityEnforcementV1 {
  replayOnly: true;
  readOnly: true;
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  cadSolverExecutionAllowed: false;
  persistenceAllowed: false;
  readinessPromotionAllowed: false;
  engineeringAuthorityAllowed: false;
  automaticApprovalAllowed: false;
  autoCorrectionAllowed: false;
}

export function runGeometryCorpusReplay(
  corpusId: string,
  corpusItems: GeometryCorpusReplayItemInputV1[],
): GeometryCorpusReplayReportV1 {
  const items = [...corpusItems]
    .sort((a, b) => a.corpusItemId.localeCompare(b.corpusItemId))
    .map(runGeometryCorpusReplayItem);
  const reviewQueue = buildGeometryReviewQueueSummary(items.map(item => item.reviewRecommendation));
  const confidenceDistributions = buildConfidenceDistributions(items);
  const discrepancyDistributions = buildDiscrepancyDistributions(items);
  const topologyDegradation = buildTopologyDegradationSummary(items);
  const recurringRisks = buildRecurringRiskSummary(items);
  const readinessDowngrades = buildReadinessDowngradeSummary(items);
  const integrityTrend = buildIntegrityTrendSummary(items);
  const replay = buildReplaySummary(items);
  const trustCalibration = buildTrustCalibrationReport(items, replay, discrepancyDistributions, topologyDegradation, reviewQueue);
  const operationalInsight = buildOperationalInsightReport(confidenceDistributions, recurringRisks, reviewQueue, topologyDegradation, discrepancyDistributions);
  const withoutHash = {
    schemaVersion: 'geometry_corpus_replay_report_v1' as const,
    mode: 'deterministic_replay_safe_geometry_trust_operations' as const,
    corpusId,
    corpusItemCount: items.length,
    itemHashes: items.map(item => item.itemHash),
    summaries: {
      replay,
      confidenceDistributions,
      discrepancyDistributions,
      topologyDegradation,
      recurringRisks,
      readinessDowngrades,
      integrityTrend,
      reviewQueue,
      trustCalibration,
      operationalInsight,
    },
    items,
    noAuthorityEnforcement: noAuthorityEnforcement(),
    deterministicNotes: [
      'Corpus replay runs parser, canonical geometry, CAD readiness, comparison adapter, geometry intelligence, and review recommendation logic in memory only.',
      'Replay outputs are deterministic summaries for calibration and human review orchestration; they do not persist or promote geometry authority.',
      'Replay does not mutate canonical geometry, CAD previews, readiness states, or downstream engineering/permit/BOM systems.',
      'Trust calibration observations improve explainability and consistency only; they are not automation thresholds.',
    ],
  };
  return { ...withoutHash, replayHash: deterministicHash(withoutHash) };
}

export function runGeometryCorpusReplayItem(input: GeometryCorpusReplayItemInputV1): GeometryCorpusReplayItemResultV1 {
  const normalized = normalizeSurvey(input.rawSurvey);
  const enriched = enrichSurvey(normalized);
  const evidence = parseProfessionalSiteSurvey(enriched);
  const canonicalGeometry = buildCanonicalSurveyGeometry(enriched, evidence);
  const cadReadiness = buildSurveyCADReadiness(enriched, evidence, canonicalGeometry);
  const comparisonReport = normalizeReplayComparisonTiming(buildGeometryComparisonReport(canonicalGeometry));
  const intelligence = buildGeometryIntelligenceReport({ evidence, canonicalGeometry, cadReadiness, comparisonReport });
  const reviewRecommendation = buildGeometryReviewRecommendation(intelligence);
  const withoutHash = {
    schemaVersion: 'geometry_corpus_replay_item_v1' as const,
    corpusItemId: input.corpusItemId,
    label: input.label ?? null,
    sourceSurveyId: evidence.surveyId,
    sourceHashes: {
      bundleHash: evidence.bundleHash,
      geometryHash: canonicalGeometry.geometryHash,
      readinessHash: cadReadiness.readinessHash,
      comparisonHash: comparisonReport.resultHash,
      intelligenceHash: intelligence.intelligenceHash,
      recommendationHash: reviewRecommendation.recommendationHash,
    },
    noAuthorityEnforcement: noAuthorityEnforcement(),
  };
  return {
    schemaVersion: 'geometry_corpus_replay_item_v1',
    corpusItemId: input.corpusItemId,
    label: input.label ?? null,
    sourceSurveyId: evidence.surveyId,
    evidence,
    canonicalGeometry,
    cadReadiness,
    comparisonReport,
    intelligence,
    reviewRecommendation,
    itemHash: deterministicHash(withoutHash),
    noAuthorityEnforcement: noAuthorityEnforcement(),
  };
}

function buildReplaySummary(items: GeometryCorpusReplayItemResultV1[]): GeometryReplaySummaryV1 {
  return {
    cleanItemCount: items.filter(item => item.intelligence.classification.geometryRisk === 'low' && item.reviewRecommendation.lifecycleState === 'review_not_recommended').length,
    reviewRecommendedItemCount: items.filter(item => item.reviewRecommendation.reviewRecommended).length,
    reviewRequiredItemCount: items.filter(item => item.reviewRecommendation.reviewRequired).length,
    blockerItemCount: items.filter(item => item.reviewRecommendation.blockerReview).length,
    cadReadyButReviewRecommendedCount: items.filter(item => item.cadReadiness.readinessStatus === 'cad_ready' && item.reviewRecommendation.reviewRecommended).length,
    nativeBlockedCount: items.filter(item => item.cadReadiness.readinessStatus === 'blocked').length,
    averageScores: {
      geometryConfidenceScore: average(items.map(item => item.intelligence.scores.geometryConfidenceScore)),
      topologyIntegrityScore: average(items.map(item => item.intelligence.scores.topologyIntegrityScore)),
      readinessTrustScore: average(items.map(item => item.intelligence.scores.readinessTrustScore)),
      discrepancySeverityScore: average(items.map(item => item.intelligence.scores.discrepancySeverityScore)),
    },
  };
}

function buildConfidenceDistributions(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayConfidenceDistributionsV1 {
  return {
    geometryConfidenceScore: scoreDistribution(items.map(item => item.intelligence.scores.geometryConfidenceScore)),
    topologyIntegrityScore: scoreDistribution(items.map(item => item.intelligence.scores.topologyIntegrityScore)),
    readinessTrustScore: scoreDistribution(items.map(item => item.intelligence.scores.readinessTrustScore)),
    discrepancySeverityScore: scoreDistribution(items.map(item => item.intelligence.scores.discrepancySeverityScore)),
  };
}

function buildDiscrepancyDistributions(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayDiscrepancyDistributionsV1 {
  return {
    severityCounts: countKnown(['info', 'warning', 'error'] as const, items.map(item => item.intelligence.classification.discrepancySeverity)),
    observationCategoryCounts: countStrings(items.flatMap(item => item.comparisonReport.observations.map(observation => observation.category))),
    discrepancyClusterCount: sum(items.map(item => item.intelligence.discrepancyClusters.length)),
    surveysWithDiscrepancies: items.filter(item => item.intelligence.discrepancyScores.length > 0).length,
    likelyNativeFalsePositiveCount: sum(items.map(item => item.intelligence.summaries.falsePositiveTracking.length)),
    likelyNativeFalseNegativeCount: sum(items.map(item => item.intelligence.summaries.falseNegativeTracking.length)),
  };
}

function buildTopologyDegradationSummary(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayTopologyDegradationSummaryV1 {
  const unstable = items.filter(item => item.comparisonReport.observations.some(observation => observation.category === 'topology_confidence_degradation') || item.comparisonReport.ossComparisonResult.overlappingPairCount > 0 || item.comparisonReport.ossComparisonResult.invalidPolygonCount > 0);
  return {
    unstableItemCount: unstable.length,
    overlappingPairCount: sum(items.map(item => item.comparisonReport.ossComparisonResult.overlappingPairCount)),
    duplicateEdgePolygonCount: sum(items.map(item => item.comparisonReport.ossComparisonResult.duplicateEdgePolygonCount)),
    selfIntersectingPolygonCount: sum(items.map(item => item.comparisonReport.ossComparisonResult.selfIntersectingPolygonCount)),
    invalidPolygonCount: sum(items.map(item => item.comparisonReport.ossComparisonResult.invalidPolygonCount)),
    clippingFailureCount: sum(items.map(item => item.comparisonReport.ossComparisonResult.clippingFailureCount)),
    degradationNotes: deterministicUnique(items.flatMap(item => item.intelligence.summaries.topologyConfidenceDegradation)).slice(0, 12),
  };
}

function buildRecurringRiskSummary(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayRecurringRiskSummaryV1 {
  const riskCategoryCounts = countStrings(items.flatMap(item => item.intelligence.risks.map(risk => risk.category)));
  const failureClusters = topCounts(items.map(item => item.intelligence.risks.map(risk => risk.category).sort().join('+') || 'no_risk'), 10)
    .filter(cluster => cluster.value !== 'no_risk')
    .map(cluster => ({
      cluster: cluster.value,
      corpusItemIds: items
        .filter(item => (item.intelligence.risks.map(risk => risk.category).sort().join('+') || 'no_risk') === cluster.value)
        .map(item => item.corpusItemId)
        .sort(),
      count: cluster.count,
    }));
  return {
    riskCategoryCounts,
    highestFrequencyRiskCategories: topCounts(Object.entries(riskCategoryCounts).flatMap(([category, count]) => Array.from({ length: count }, () => category)), 8)
      .map(item => ({ category: item.value, count: item.count })),
    failureClusters,
  };
}

function buildReadinessDowngradeSummary(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayReadinessDowngradeSummaryV1 {
  return {
    readinessStatusCounts: countKnown(['cad_ready', 'review_required', 'blocked'] as const, items.map(item => item.cadReadiness.readinessStatus)),
    downgradeCauseCounts: countStrings(items.flatMap(item => item.cadReadiness.requiredReviewItems.length > 0 ? item.cadReadiness.requiredReviewItems : item.cadReadiness.blockingIssues)),
    cadReadyTrustDegradedCount: items.filter(item => item.cadReadiness.readinessStatus === 'cad_ready' && item.intelligence.scores.readinessTrustScore < 90).length,
    readinessTrustBelow90Count: items.filter(item => item.intelligence.scores.readinessTrustScore < 90).length,
    readinessTrustBelow60Count: items.filter(item => item.intelligence.scores.readinessTrustScore < 60).length,
  };
}

function buildIntegrityTrendSummary(items: GeometryCorpusReplayItemResultV1[]): GeometryReplayIntegrityTrendSummaryV1 {
  const gaps = items.map(item => item.intelligence.scores.topologyIntegrityScore - item.intelligence.scores.readinessTrustScore);
  const topologyStableButReadinessDegraded = items.filter(item => item.intelligence.scores.topologyIntegrityScore >= 90 && item.intelligence.scores.readinessTrustScore < 90);
  return {
    stableHighTrustCount: items.filter(item => item.intelligence.scores.topologyIntegrityScore >= 90 && item.intelligence.scores.readinessTrustScore >= 90 && item.intelligence.scores.geometryConfidenceScore >= 90).length,
    topologyStableButReadinessDegradedCount: topologyStableButReadinessDegraded.length,
    topologyUnstableCount: items.filter(item => item.intelligence.scores.topologyIntegrityScore < 90).length,
    averageTopologyMinusReadinessTrustGap: average(gaps),
    trendNotes: [
      topologyStableButReadinessDegraded.length > 0
        ? `${topologyStableButReadinessDegraded.length} item(s) have stable topology but degraded readiness trust, indicating evidence completeness rather than polygon instability is the downgrade driver.`
        : 'No topology-stable/readiness-degraded split was observed in this replay.',
      items.some(item => item.intelligence.scores.topologyIntegrityScore < 90)
        ? 'Topology instability is concentrated in items with adapter observations or invalid canonical polygons.'
        : 'Topology integrity stayed high across the replay corpus.',
    ],
  };
}

function buildTrustCalibrationReport(
  items: GeometryCorpusReplayItemResultV1[],
  replay: GeometryReplaySummaryV1,
  discrepancy: GeometryReplayDiscrepancyDistributionsV1,
  topology: GeometryReplayTopologyDegradationSummaryV1,
  reviewQueue: GeometryReviewQueueSummaryV1,
): GeometryTrustCalibrationReportV1 {
  const stableHashCount = new Set(items.map(item => item.intelligence.intelligenceHash)).size;
  return {
    schemaVersion: 'geometry_trust_calibration_report_v1',
    calibrationMode: 'replay_explainability_consistency_only',
    confidenceStability: stableHashCount === items.length
      ? 'Replay produced unique deterministic intelligence hashes per corpus item with no hash collapse.'
      : 'Replay detected repeated intelligence hashes; inspect duplicate or intentionally identical corpus items before tuning thresholds.',
    discrepancyConsistency: discrepancy.surveysWithDiscrepancies === 0
      ? 'No discrepancy-bearing items appeared in this corpus; discrepancy calibration requires broader replay.'
      : `${discrepancy.surveysWithDiscrepancies} item(s) carried discrepancy signals across ${Object.keys(discrepancy.observationCategoryCounts).length} category type(s).`,
    severityCalibration: topology.unstableItemCount >= replay.blockerItemCount
      ? 'Topology degradation and blocker review counts are directionally aligned for review-first escalation.'
      : 'Some blocker reviews were driven by non-topology readiness/evidence risks, which is expected for evidence-completeness failures.',
    reviewRecommendationQuality: `${reviewQueue.reviewRecommendedCount} of ${items.length} replay item(s) entered a review queue; ${reviewQueue.blockerReviewCount} blocker item(s) remained explicit and non-authoritative.`,
    observations: [
      `Average geometry confidence=${replay.averageScores.geometryConfidenceScore}, topology integrity=${replay.averageScores.topologyIntegrityScore}, readiness trust=${replay.averageScores.readinessTrustScore}.`,
      `${replay.cadReadyButReviewRecommendedCount} CAD-ready item(s) still received review recommendations, preserving review-first trust behavior.`,
      `${discrepancy.likelyNativeFalsePositiveCount} likely native false-positive and ${discrepancy.likelyNativeFalseNegativeCount} likely native false-negative tracking note(s) were surfaced.`,
    ],
    automationBoundary: 'no_authority_promotion_recommended',
  };
}

function buildOperationalInsightReport(
  confidence: GeometryReplayConfidenceDistributionsV1,
  recurringRisks: GeometryReplayRecurringRiskSummaryV1,
  reviewQueue: GeometryReviewQueueSummaryV1,
  topology: GeometryReplayTopologyDegradationSummaryV1,
  discrepancy: GeometryReplayDiscrepancyDistributionsV1,
): GeometryOperationalInsightReportV1 {
  return {
    schemaVersion: 'geometry_operational_insight_report_v1',
    confidenceDistributionSummary: `Geometry confidence averaged ${confidence.geometryConfidenceScore.average}; topology integrity averaged ${confidence.topologyIntegrityScore.average}; readiness trust averaged ${confidence.readinessTrustScore.average}.`,
    recurringGeometryRiskCategories: recurringRisks.highestFrequencyRiskCategories.map(item => `${item.category}:${item.count}`),
    reviewQueueDistribution: reviewQueue.queueCounts,
    topologyInstabilityFrequency: topology.unstableItemCount,
    discrepancyHotSpots: topCounts(Object.entries(discrepancy.observationCategoryCounts).flatMap(([category, count]) => Array.from({ length: count }, () => category)), 8)
      .map(item => ({ category: item.value, count: item.count })),
    reviewUrgencyPatterns: reviewQueue.priorityCounts,
  };
}

function normalizeReplayComparisonTiming(report: GeometryComparisonReportV1): GeometryComparisonReportV1 {
  return { ...report, executionMs: 0 };
}

function scoreDistribution(values: number[]): ScoreDistributionV1 {
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    average: average(values),
    bands: {
      '0_34': values.filter(value => value <= 34).length,
      '35_59': values.filter(value => value >= 35 && value <= 59).length,
      '60_81': values.filter(value => value >= 60 && value <= 81).length,
      '82_89': values.filter(value => value >= 82 && value <= 89).length,
      '90_100': values.filter(value => value >= 90).length,
    },
  };
}

function noAuthorityEnforcement(): GeometryCorpusNoAuthorityEnforcementV1 {
  return {
    replayOnly: true,
    readOnly: true,
    canonicalGeometryMutationAllowed: false,
    cadMutationAllowed: false,
    cadSolverExecutionAllowed: false,
    persistenceAllowed: false,
    readinessPromotionAllowed: false,
    engineeringAuthorityAllowed: false,
    automaticApprovalAllowed: false,
    autoCorrectionAllowed: false,
  };
}

function countKnown<T extends string>(keys: readonly T[], values: T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function countStrings(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values.filter(Boolean).sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function topCounts(values: string[], limit: number): Array<{ value: string; count: number }> {
  const counts = countStrings(values);
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function deterministicUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((sum(values) / values.length).toFixed(2));
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
