import { describe, expect, it } from 'vitest';

import { runGeometryCorpusReplay, runGeometryCorpusReplayItem } from './geometryCorpusReplay';
import { buildGeometryReviewQueueSummary, buildGeometryReviewRecommendation } from './geometryReviewWorkflow';
import { professionalExpandedSurveyFixtures } from './professionalSurveyExpandedFixtures';

const replayInputs = professionalExpandedSurveyFixtures.map(fixture => ({
  corpusItemId: fixture.id,
  label: fixture.description,
  rawSurvey: fixture.raw,
}));

describe('Geometry Corpus Replay and Human Review Workflow Foundation', () => {
  it('runs deterministic replay across expanded fixtures without authority promotion', () => {
    const replay = runGeometryCorpusReplay('expanded-fixtures-v1', replayInputs);
    const repeated = runGeometryCorpusReplay('expanded-fixtures-v1', replayInputs);

    expect(replay.schemaVersion).toBe('geometry_corpus_replay_report_v1');
    expect(replay.mode).toBe('deterministic_replay_safe_geometry_trust_operations');
    expect(replay.replayHash).toBe(repeated.replayHash);
    expect(replay.corpusItemCount).toBe(professionalExpandedSurveyFixtures.length);
    expect(new Set(replay.itemHashes).size).toBe(replay.itemHashes.length);
    expect(replay.noAuthorityEnforcement).toEqual({
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
    });
    expect(replay.items.every(item => item.reviewRecommendation.noAuthorityEnforcement.persistenceAllowed === false)).toBe(true);
    expect(replay.items.every(item => item.comparisonReport.mode === 'comparison_only')).toBe(true);
  });

  it('summarizes trust distributions, risk recurrence, topology degradation, and review queues', () => {
    const replay = runGeometryCorpusReplay('expanded-fixtures-v1', replayInputs);

    expect(replay.summaries.confidenceDistributions.geometryConfidenceScore.max).toBe(100);
    expect(replay.summaries.confidenceDistributions.readinessTrustScore.min).toBeLessThan(60);
    expect(replay.summaries.recurringRisks.highestFrequencyRiskCategories.length).toBeGreaterThan(0);
    expect(replay.summaries.readinessDowngrades.readinessTrustBelow90Count).toBeGreaterThan(0);
    expect(replay.summaries.topologyDegradation.unstableItemCount).toBeGreaterThan(0);
    expect(replay.summaries.reviewQueue.reviewRecommendedCount).toBeGreaterThan(0);
    expect(replay.summaries.reviewQueue.blockerReviewCount).toBeGreaterThan(0);
    expect(replay.summaries.operationalInsight.recurringGeometryRiskCategories.length).toBeGreaterThan(0);
    expect(replay.summaries.trustCalibration.automationBoundary).toBe('no_authority_promotion_recommended');
  });

  it('classifies review recommendations with explainable lifecycle and queue primitives', () => {
    const replay = runGeometryCorpusReplay('expanded-fixtures-v1', replayInputs);
    const blocker = replay.items.find(item => item.corpusItemId === 'bad_self_intersecting_polygon');
    const clean = replay.items.find(item => item.corpusItemId === 'clean_roof');

    expect(blocker?.reviewRecommendation.lifecycleState).toBe('blocker_review');
    expect(blocker?.reviewRecommendation.priority).toBe('blocker');
    expect(blocker?.reviewRecommendation.queue).toBe('blocker_review_queue');
    expect(blocker?.reviewRecommendation.blockerReview).toBe(true);
    expect(blocker?.reviewRecommendation.topologyInvestigationRecommended).toBe(true);
    expect(blocker?.reviewRecommendation.reasons.length).toBeGreaterThan(0);
    expect(clean?.reviewRecommendation.lifecycleState).toBe('review_not_recommended');
    expect(clean?.reviewRecommendation.queue).toBe('no_review_queue');
    expect(clean?.reviewRecommendation.reviewRecommended).toBe(false);
  });

  it('keeps replay item execution deterministic and does not mutate raw corpus inputs', () => {
    const input = replayInputs.find(item => item.corpusItemId === 'duplicate_roof_planes');
    expect(input).toBeDefined();
    const before = JSON.stringify(input?.rawSurvey);
    const result = runGeometryCorpusReplayItem(input!);
    const repeated = runGeometryCorpusReplayItem(input!);
    const recommendation = buildGeometryReviewRecommendation(result.intelligence);
    const queueSummary = buildGeometryReviewQueueSummary([recommendation]);

    expect(result.itemHash).toBe(repeated.itemHash);
    expect(recommendation.recommendationHash).toBe(result.reviewRecommendation.recommendationHash);
    expect(queueSummary.sourceRecommendationCount).toBe(1);
    expect(queueSummary.summaryHash).toBe(buildGeometryReviewQueueSummary([recommendation]).summaryHash);
    expect(JSON.stringify(input?.rawSurvey)).toBe(before);
    expect(result.cadReadiness.authorityFlags.cadMutationAllowed).toBe(false);
    expect(result.intelligence.noAuthorityEnforcement.cadSolverExecutionAllowed).toBe(false);
  });
});
