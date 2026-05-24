import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runGeometryCorpusReplay } from '../lib/siteSurvey/geometryCorpusReplay';
import { professionalExpandedSurveyFixtures } from '../lib/siteSurvey/professionalSurveyExpandedFixtures';

const outputDir = join(process.cwd(), 'outputs', 'real-survey-data-validation');
mkdirSync(outputDir, { recursive: true });

const replay = runGeometryCorpusReplay('expanded-professional-survey-fixtures-v1', professionalExpandedSurveyFixtures.map(fixture => ({
  corpusItemId: fixture.id,
  label: fixture.description,
  rawSurvey: fixture.raw,
})));

writeFileSync(join(outputDir, 'geometry-corpus-replay-report-v1.json'), `${JSON.stringify(replay, null, 2)}\n`);
writeFileSync(join(outputDir, 'geometry-replay-intelligence-report-v1.md'), replayIntelligenceMarkdown(replay));
writeFileSync(join(outputDir, 'geometry-review-workflow-report-v1.md'), reviewWorkflowMarkdown(replay));
writeFileSync(join(outputDir, 'geometry-trust-calibration-report-v1.md'), trustCalibrationMarkdown(replay));
writeFileSync(join(outputDir, 'geometry-operational-insight-report-v1.md'), operationalInsightMarkdown(replay));
writeFileSync(join(outputDir, 'geometry-corpus-replay-summary-v1.md'), summaryMarkdown(replay));

console.log(JSON.stringify({
  corpusId: replay.corpusId,
  corpusItemCount: replay.corpusItemCount,
  replayHash: replay.replayHash,
  reviewRecommendedCount: replay.summaries.reviewQueue.reviewRecommendedCount,
  blockerReviewCount: replay.summaries.reviewQueue.blockerReviewCount,
  topologyInstabilityFrequency: replay.summaries.operationalInsight.topologyInstabilityFrequency,
}, null, 2));

function replayIntelligenceMarkdown(report: ReturnType<typeof runGeometryCorpusReplay>): string {
  const s = report.summaries;
  return `# Geometry Replay Intelligence Report V1\n\nCorpus replay ran ${report.corpusItemCount} fixture-driven survey items through parser, canonical geometry, CAD readiness, OSS comparison, geometry intelligence, and review recommendation logic. The replay hash is \`${report.replayHash}\`, and all replay outputs are non-authoritative and replay-only.\n\n## Replay Findings\n\nAverage geometry confidence was ${s.replay.averageScores.geometryConfidenceScore}, average topology integrity was ${s.replay.averageScores.topologyIntegrityScore}, average readiness trust was ${s.replay.averageScores.readinessTrustScore}, and average discrepancy severity was ${s.replay.averageScores.discrepancySeverityScore}. ${s.replay.cleanItemCount} item(s) were clean with no review recommendation, ${s.replay.reviewRecommendedItemCount} item(s) entered review, ${s.replay.reviewRequiredItemCount} item(s) required review, and ${s.replay.blockerItemCount} item(s) required blocker review.\n\n## Confidence Distributions\n\n\`geometryConfidenceScore\`: ${JSON.stringify(s.confidenceDistributions.geometryConfidenceScore)}\n\n\`topologyIntegrityScore\`: ${JSON.stringify(s.confidenceDistributions.topologyIntegrityScore)}\n\n\`readinessTrustScore\`: ${JSON.stringify(s.confidenceDistributions.readinessTrustScore)}\n\n\`discrepancySeverityScore\`: ${JSON.stringify(s.confidenceDistributions.discrepancySeverityScore)}\n\n## Discrepancy Distribution\n\nDiscrepancy severity counts were ${JSON.stringify(s.discrepancyDistributions.severityCounts)}. Observation category counts were ${JSON.stringify(s.discrepancyDistributions.observationCategoryCounts)}. The replay surfaced ${s.discrepancyDistributions.likelyNativeFalsePositiveCount} likely native false-positive tracking note(s) and ${s.discrepancyDistributions.likelyNativeFalseNegativeCount} likely native false-negative tracking note(s).\n\n## Recurring Risks\n\nTop recurring geometry risk categories were ${s.recurringRisks.highestFrequencyRiskCategories.map(item => `${item.category} (${item.count})`).join(', ') || 'none'}. Failure clusters were ${s.recurringRisks.failureClusters.map(item => `${item.cluster} [${item.count}]`).join(', ') || 'none'}.\n`;
}

function reviewWorkflowMarkdown(report: ReturnType<typeof runGeometryCorpusReplay>): string {
  const q = report.summaries.reviewQueue;
  return `# Geometry Human Review Workflow Foundation Report V1\n\nThe replay generated deterministic review workflow recommendations for ${q.sourceRecommendationCount} item(s). This is workflow foundation only: no automatic approval, no auto-correction, no persistence, no CAD solver execution, no CAD mutation, and no readiness promotion.\n\n## Review Queue Summary\n\nLifecycle state counts: ${JSON.stringify(q.lifecycleStateCounts)}. Priority counts: ${JSON.stringify(q.priorityCounts)}. Queue counts: ${JSON.stringify(q.queueCounts)}.\n\n## Review Recommendation Quality\n\n${q.reviewRecommendedCount} item(s) were review recommended, ${q.reviewRequiredCount} item(s) were review required, ${q.blockerReviewCount} item(s) were blocker review, and ${q.topologyInvestigationRecommendedCount} item(s) received topology investigation recommendations.\n\n## Top Review Reasons\n\n${q.topReasonCodes.map(item => `- ${item.code}: ${item.count}`).join('\n') || 'No review reasons were produced.'}\n\n## Boundary Statement\n\nThe review lifecycle primitives are deterministic queueing hints. They do not approve geometry, correct geometry, persist authority, execute solvers, mutate CAD previews, mutate canonical geometry, or promote readiness.\n`;
}

function trustCalibrationMarkdown(report: ReturnType<typeof runGeometryCorpusReplay>): string {
  const c = report.summaries.trustCalibration;
  return `# Geometry Trust Calibration Report V1\n\nCalibration mode: \`${c.calibrationMode}\`. Automation boundary: \`${c.automationBoundary}\`.\n\n## Confidence Stability\n\n${c.confidenceStability}\n\n## Discrepancy Consistency\n\n${c.discrepancyConsistency}\n\n## Severity Calibration\n\n${c.severityCalibration}\n\n## Review Recommendation Quality\n\n${c.reviewRecommendationQuality}\n\n## Observations\n\n${c.observations.map(item => `- ${item}`).join('\n')}\n`;
}

function operationalInsightMarkdown(report: ReturnType<typeof runGeometryCorpusReplay>): string {
  const o = report.summaries.operationalInsight;
  return `# Geometry Operational Insight Report V1\n\n${o.confidenceDistributionSummary}\n\n## Recurring Geometry Risk Categories\n\n${o.recurringGeometryRiskCategories.map(item => `- ${item}`).join('\n') || 'No recurring risk categories were observed.'}\n\n## Review Queue Distribution\n\n${JSON.stringify(o.reviewQueueDistribution, null, 2)}\n\n## Topology Instability Frequency\n\n${o.topologyInstabilityFrequency} item(s) showed topology instability.\n\n## Discrepancy Hot Spots\n\n${o.discrepancyHotSpots.map(item => `- ${item.category}: ${item.count}`).join('\n') || 'No discrepancy hot spots were observed.'}\n\n## Review Urgency Patterns\n\n${JSON.stringify(o.reviewUrgencyPatterns, null, 2)}\n`;
}

function summaryMarkdown(report: ReturnType<typeof runGeometryCorpusReplay>): string {
  return `# Geometry Corpus Replay Summary V1\n\nReplay hash: \`${report.replayHash}\`\n\nCorpus item count: ${report.corpusItemCount}\n\nThe replay framework added reusable, deterministic infrastructure for running parser, canonical geometry, readiness evaluation, OSS comparison, geometry intelligence scoring, and human review recommendation generation across survey corpora. It remains replay-safe, read-only, non-authoritative, and does not mutate CAD, canonical geometry, readiness, persistence, or downstream engineering systems.\n\n## No-Authority Enforcement\n\n${JSON.stringify(report.noAuthorityEnforcement, null, 2)}\n`;
}
