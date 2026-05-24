import { describe, expect, it } from 'vitest';
import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import {
  acceptGeometryCandidateReviewAction,
  rejectGeometryCandidateReviewAction,
  submitGeometryCandidateReviewAction,
} from '@/lib/assistedEvidenceSources';
import { createGeometryCandidateDemoCandidates } from '@/lib/assistedEvidenceSources';
import type { AssistedEvidenceSourceContext } from '@/lib/assistedEvidenceSources';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'file-action-v1',
  sourceUploadKey: 'uploads/action-v1/source.png',
  projectId: 'project-action-v1',
  surveyId: 'survey-action-v1',
  toolRunId: 'tool-run-action-v1',
  toolConfigHash: 'tool-config-action-v1',
  sourceMetadataHash: 'source-meta-action-v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'geometry-review-action-test',
};

async function geometryCandidate(): Promise<AssistedEvidenceCandidate> {
  const result = await createGeometryCandidateDemoCandidates({
    sourceContext,
    sourceContextText: 'Action audit path V1 fixture: review-required possible obstruction candidate.',
  });
  return result.candidates[0];
}

describe('geometry candidate review action audit path v1', () => {
  it('accepts only as a reviewed projection with full audit metadata and no downstream authority', async () => {
    const candidate = await geometryCandidate();
    const result = acceptGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-1',
      reviewerDisplayLabel: 'Reviewer One',
      reviewedAt: '2026-01-02T00:00:00.000Z',
      reviewNote: 'Accept as projection only.',
    });

    expect(result.candidate.candidateStatus).toBe('accepted_by_reviewer');
    expect(result.projection).not.toBeNull();
    expect(result.projection?.projectionPayload).toEqual({ possible_obstruction_candidate: 'source_image_review_context_only' });
    expect(result.projection?.canonicalParticipationStatus).toBe('eligible_for_mapping');
    expect(result.audit).toMatchObject({
      actionType: 'accept_for_review_projection',
      persistenceMode: 'deterministic_dto_only_v1',
      candidateId: candidate.candidateId,
      candidateType: 'possible_obstruction_candidate',
      candidateHash: candidate.deterministicHash,
      runtimeName: 'deterministic-geometry-adjacency-runtime',
      runtimeVersion: '1.0.0',
      sourceImageReference: sourceContext.sourceUploadKey,
      reviewerId: 'reviewer-1',
      reviewerDisplayLabel: 'Reviewer One',
      reviewTimestamp: '2026-01-02T00:00:00.000Z',
      reviewNote: 'Accept as projection only.',
      priorReviewState: 'review_required',
      resultingReviewState: 'accepted_by_reviewer',
      rejectionReason: null,
    });
    expect(result.audit.runtimePayloadHash).toBe(candidate.candidatePayload.runtimePayloadHash);
    expect(result.audit.sourceLineageRef).toBe(candidate.candidatePayload.sourceImageLineageRef);
    expect(result.audit.boundaryPolicyVersion).toBe('geometry_candidate_boundary_v1');
    expect(result.audit.reviewedProjectionId).toBe(result.projection?.projectionId);
    expect(result.audit.reviewedProjectionHash).toBe(result.projection?.deterministicHash);
    expect(result.audit.authorityFlags).toEqual({
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      roofPlaneMutationAllowed: false,
      setbackMutationAllowed: false,
      layoutMutationAllowed: false,
      engineeringInfluenceAllowed: false,
      necInfluenceAllowed: false,
      workflowInfluenceAllowed: false,
      recommendationInfluenceAllowed: false,
      downstreamAuthority: false,
    });
  });

  it('rejects with required rejection reason and without creating a projection', async () => {
    const candidate = await geometryCandidate();
    const result = rejectGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-2',
      reviewerDisplayLabel: 'Reviewer Two',
      reviewedAt: '2026-01-03T00:00:00.000Z',
      reviewNote: 'Reject in assisted evidence review only.',
      rejectionReason: 'not_actionable_for_review_projection',
    });

    expect(result.candidate.candidateStatus).toBe('rejected_by_reviewer');
    expect(result.projection).toBeNull();
    expect(result.audit.actionType).toBe('reject_candidate');
    expect(result.audit.resultingReviewState).toBe('rejected_by_reviewer');
    expect(result.audit.reviewedProjectionId).toBeNull();
    expect(result.audit.reviewedProjectionHash).toBeNull();
    expect(result.audit.rejectionReason).toBe('not_actionable_for_review_projection');
    expect(result.audit.authorityFlags.cadMutationAllowed).toBe(false);
    expect(result.audit.authorityFlags.engineeringInfluenceAllowed).toBe(false);
    expect(result.audit.authorityFlags.workflowInfluenceAllowed).toBe(false);
    expect(result.audit.authorityFlags.recommendationInfluenceAllowed).toBe(false);
  });

  it('rejects unsupported actions, missing rejection reasons, non-geometry candidates, and unreviewable candidates', async () => {
    const candidate = await geometryCandidate();
    expect(() => submitGeometryCandidateReviewAction(candidate, {
      actionType: 'unsupported_action' as 'accept_for_review_projection',
      reviewerId: 'reviewer-3',
      reviewedAt: '2026-01-04T00:00:00.000Z',
    })).toThrow(/Unsupported geometry candidate review action/i);

    expect(() => rejectGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-3',
      reviewedAt: '2026-01-04T00:00:00.000Z',
    })).toThrow(/rejection reason/i);

    const nonGeometryCandidate: AssistedEvidenceCandidate = {
      ...candidate,
      candidateId: 'non-geometry-action-candidate',
      candidateType: 'photo_quality_candidate',
      candidateCategory: 'quality',
      toolName: 'metadata-fixture-adapter',
      deterministicHash: 'non-geometry-action-hash',
    };
    expect(() => acceptGeometryCandidateReviewAction(nonGeometryCandidate, {
      reviewerId: 'reviewer-3',
      reviewedAt: '2026-01-04T00:00:00.000Z',
    })).toThrow(/possible_obstruction_candidate/i);

    const alreadyAccepted = acceptGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-3',
      reviewedAt: '2026-01-04T00:00:00.000Z',
      reviewNote: 'First accept.',
    }).candidate;
    expect(() => rejectGeometryCandidateReviewAction(alreadyAccepted, {
      reviewerId: 'reviewer-4',
      reviewedAt: '2026-01-05T00:00:00.000Z',
      rejectionReason: 'already_reviewed',
    })).toThrow(/review_required status/i);
  });
});
