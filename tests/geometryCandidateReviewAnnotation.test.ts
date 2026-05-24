import { describe, expect, it } from 'vitest';
import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import {
  acceptGeometryCandidateReviewAction,
  buildGeometryCandidateReviewAnnotation,
  createGeometryCandidateDemoCandidates,
} from '@/lib/assistedEvidenceSources';
import type { AssistedEvidenceSourceContext } from '@/lib/assistedEvidenceSources';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'file-annotation-v1',
  sourceUploadKey: 'uploads/annotation-v1/source.png',
  projectId: 'project-annotation-v1',
  surveyId: 'survey-annotation-v1',
  toolRunId: 'tool-run-annotation-v1',
  toolConfigHash: 'tool-config-annotation-v1',
  sourceMetadataHash: 'source-meta-annotation-v1',
  createdAt: '2026-01-10T00:00:00.000Z',
  createdBy: 'geometry-review-annotation-test',
};

async function geometryCandidate(): Promise<AssistedEvidenceCandidate> {
  const result = await createGeometryCandidateDemoCandidates({
    sourceContext,
    sourceContextText: 'Annotation V1 fixture: review-required possible obstruction candidate.',
  });
  return result.candidates[0];
}

describe('geometry candidate review annotation v1', () => {
  it('builds a deterministic DTO-only annotation with provenance and no state or projection changes', async () => {
    const candidate = await geometryCandidate();
    const annotation = buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-annotation-1',
      reviewerDisplayLabel: '  Annotation Reviewer  ',
      reviewedAt: '2026-01-10T01:00:00.000Z',
      annotationNote: '  Needs closer visual review before any action.  ',
      reviewerConfidence: 0.72,
      tags: ['needs-zoom', ' possible-obstruction ', 'needs-zoom', ''],
    });
    const replay = buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-annotation-1',
      reviewerDisplayLabel: '  Annotation Reviewer  ',
      reviewedAt: '2026-01-10T01:00:00.000Z',
      annotationNote: '  Needs closer visual review before any action.  ',
      reviewerConfidence: 0.72,
      tags: ['needs-zoom', ' possible-obstruction ', 'needs-zoom', ''],
    });

    expect(annotation).toEqual(replay);
    expect(annotation.candidate).toBe(candidate);
    expect(annotation.projection).toBeNull();
    expect(annotation.audit.annotationSchemaVersion).toBe('geometry_candidate_review_annotation_v1');
    expect(annotation.audit.persistenceMode).toBe('deterministic_dto_only_v1');
    expect(annotation.audit.annotationHash).toMatch(/^[0-9a-f]{8}$/);
    expect(annotation.audit.candidateId).toBe(candidate.candidateId);
    expect(annotation.audit.candidateType).toBe('possible_obstruction_candidate');
    expect(annotation.audit.candidateHash).toBe(candidate.deterministicHash);
    expect(annotation.audit.sourceImageReference).toBe(sourceContext.sourceUploadKey);
    expect(annotation.audit.sourceLineageRef).toBe(candidate.candidatePayload.sourceImageLineageRef);
    expect(annotation.audit.runtimePayloadHash).toBe(candidate.candidatePayload.runtimePayloadHash);
    expect(annotation.audit.boundaryPolicyVersion).toBe('geometry_candidate_boundary_v1');
    expect(annotation.audit.reviewerDisplayLabel).toBe('Annotation Reviewer');
    expect(annotation.audit.annotationNote).toBe('Needs closer visual review before any action.');
    expect(annotation.audit.reviewerConfidence).toBe(0.72);
    expect(annotation.audit.tags).toEqual(['needs-zoom', 'possible-obstruction']);
    expect(annotation.audit.priorReviewState).toBe('review_required');
    expect(annotation.audit.resultingReviewState).toBe('review_required');
    expect(annotation.audit.projectionCreated).toBe(false);
    expect(annotation.audit.reviewedProjectionId).toBeNull();
    expect(annotation.audit.reviewedProjectionHash).toBeNull();
    expect(annotation.audit.authorityFlags).toEqual({
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

  it('supports confidence-only and tag-only annotation content while remaining DTO-only', async () => {
    const candidate = await geometryCandidate();
    const confidenceOnly = buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-confidence-only',
      reviewedAt: '2026-01-10T02:00:00.000Z',
      reviewerConfidence: 0,
    });
    const tagOnly = buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-tag-only',
      reviewedAt: '2026-01-10T03:00:00.000Z',
      tags: ['field-check'],
    });

    expect(confidenceOnly.audit.annotationNote).toBeNull();
    expect(confidenceOnly.audit.reviewerConfidence).toBe(0);
    expect(confidenceOnly.audit.tags).toEqual([]);
    expect(confidenceOnly.projection).toBeNull();
    expect(tagOnly.audit.annotationNote).toBeNull();
    expect(tagOnly.audit.reviewerConfidence).toBeNull();
    expect(tagOnly.audit.tags).toEqual(['field-check']);
    expect(tagOnly.audit.authorityFlags.downstreamAuthority).toBe(false);
  });

  it('rejects missing metadata, invalid confidence, non-geometry candidates, and unreviewable candidates', async () => {
    const candidate = await geometryCandidate();

    expect(() => buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: '   ',
      reviewedAt: '2026-01-10T04:00:00.000Z',
      annotationNote: 'Missing reviewer.',
    })).toThrow(/reviewerId/i);

    expect(() => buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-missing-time',
      reviewedAt: '   ',
      annotationNote: 'Missing timestamp.',
    })).toThrow(/timestamp/i);

    expect(() => buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-empty-content',
      reviewedAt: '2026-01-10T04:00:00.000Z',
      annotationNote: '   ',
      tags: ['   '],
    })).toThrow(/requires a note/i);

    expect(() => buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-low-confidence',
      reviewedAt: '2026-01-10T04:00:00.000Z',
      reviewerConfidence: -0.1,
    })).toThrow(/between 0 and 1/i);

    expect(() => buildGeometryCandidateReviewAnnotation(candidate, {
      reviewerId: 'reviewer-high-confidence',
      reviewedAt: '2026-01-10T04:00:00.000Z',
      reviewerConfidence: 1.1,
    })).toThrow(/between 0 and 1/i);

    const nonGeometryCandidate: AssistedEvidenceCandidate = {
      ...candidate,
      candidateId: 'non-geometry-annotation-candidate',
      candidateType: 'photo_quality_candidate',
      candidateCategory: 'quality',
      toolName: 'metadata-fixture-adapter',
      deterministicHash: 'non-geometry-annotation-hash',
    };
    expect(() => buildGeometryCandidateReviewAnnotation(nonGeometryCandidate, {
      reviewerId: 'reviewer-non-geometry',
      reviewedAt: '2026-01-10T05:00:00.000Z',
      annotationNote: 'Non-geometry annotation should fail.',
    })).toThrow(/possible_obstruction_candidate/i);

    const alreadyAccepted = acceptGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-annotation-accepted',
      reviewedAt: '2026-01-10T06:00:00.000Z',
    }).candidate;
    expect(() => buildGeometryCandidateReviewAnnotation(alreadyAccepted, {
      reviewerId: 'reviewer-unreviewable',
      reviewedAt: '2026-01-10T07:00:00.000Z',
      annotationNote: 'Already accepted candidate should fail.',
    })).toThrow(/review_required status/i);
  });
});
