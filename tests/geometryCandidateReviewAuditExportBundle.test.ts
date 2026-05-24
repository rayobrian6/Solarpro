import { describe, expect, it } from 'vitest';
import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import {
  acceptGeometryCandidateReviewAction,
  buildGeometryCandidateReviewAuditExportBundle,
  createGeometryCandidateDemoCandidates,
} from '@/lib/assistedEvidenceSources';
import type { AssistedEvidenceSourceContext } from '@/lib/assistedEvidenceSources';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'file-export-v1',
  sourceUploadKey: 'uploads/export-v1/source.png',
  projectId: 'project-export-v1',
  surveyId: 'survey-export-v1',
  toolRunId: 'tool-run-export-v1',
  toolConfigHash: 'tool-config-export-v1',
  sourceMetadataHash: 'source-meta-export-v1',
  createdAt: '2026-01-06T00:00:00.000Z',
  createdBy: 'geometry-review-export-test',
};

async function geometryCandidate(): Promise<AssistedEvidenceCandidate> {
  const result = await createGeometryCandidateDemoCandidates({
    sourceContext,
    sourceContextText: 'Audit export bundle V1 fixture: review-required possible obstruction candidate.',
  });
  return result.candidates[0];
}

describe('geometry candidate review audit export bundle v1', () => {
  it('builds a deterministic DTO-only export bundle with provenance, stale visibility, lineage, and no authority', async () => {
    const candidate = await geometryCandidate();
    const bundle = buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-07T00:00:00.000Z',
      exportedBy: 'audit-exporter-1',
      exportReason: 'Reviewer handoff export.',
      staleVisibilityInput: {
        sourceMetadataHash: 'changed-source-meta-export-v1',
        runtimePayloadHash: 'changed-runtime-payload-export-v1',
        boundaryPolicyVersion: 'changed-policy-export-v1',
        reviewStateHash: 'changed-review-state-export-v1',
      },
      acceptPreview: {
        reviewerId: 'reviewer-export-accept',
        reviewerDisplayLabel: 'Export Accept Reviewer',
        reviewedAt: '2026-01-07T01:00:00.000Z',
        reviewNote: 'Preview accept for audit export only.',
      },
      rejectPreview: {
        reviewerId: 'reviewer-export-reject',
        reviewerDisplayLabel: 'Export Reject Reviewer',
        reviewedAt: '2026-01-07T02:00:00.000Z',
        reviewNote: 'Preview reject for audit export only.',
        rejectionReason: 'not_actionable_for_review_projection',
      },
      annotationPreview: {
        reviewerId: 'reviewer-export-annotation',
        reviewerDisplayLabel: 'Export Annotation Reviewer',
        reviewedAt: '2026-01-07T03:00:00.000Z',
        annotationNote: 'Preview annotation for audit export only.',
        reviewerConfidence: 0.81,
        tags: ['export-handoff', 'roof-context', 'possible-obstruction'],
      },
    });
    const replay = buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-07T00:00:00.000Z',
      exportedBy: 'audit-exporter-1',
      exportReason: 'Reviewer handoff export.',
      staleVisibilityInput: {
        sourceMetadataHash: 'changed-source-meta-export-v1',
        runtimePayloadHash: 'changed-runtime-payload-export-v1',
        boundaryPolicyVersion: 'changed-policy-export-v1',
        reviewStateHash: 'changed-review-state-export-v1',
      },
      acceptPreview: {
        reviewerId: 'reviewer-export-accept',
        reviewerDisplayLabel: 'Export Accept Reviewer',
        reviewedAt: '2026-01-07T01:00:00.000Z',
        reviewNote: 'Preview accept for audit export only.',
      },
      rejectPreview: {
        reviewerId: 'reviewer-export-reject',
        reviewerDisplayLabel: 'Export Reject Reviewer',
        reviewedAt: '2026-01-07T02:00:00.000Z',
        reviewNote: 'Preview reject for audit export only.',
        rejectionReason: 'not_actionable_for_review_projection',
      },
      annotationPreview: {
        reviewerId: 'reviewer-export-annotation',
        reviewerDisplayLabel: 'Export Annotation Reviewer',
        reviewedAt: '2026-01-07T03:00:00.000Z',
        annotationNote: 'Preview annotation for audit export only.',
        reviewerConfidence: 0.81,
        tags: ['export-handoff', 'roof-context', 'possible-obstruction'],
      },
    });

    expect(bundle).toEqual(replay);
    expect(bundle.exportSchemaVersion).toBe('geometry_candidate_review_audit_export_bundle_v1');
    expect(bundle.persistenceMode).toBe('deterministic_dto_only_v1');
    expect(bundle.exportHash).toMatch(/^[0-9a-f]{8}$/);
    expect(bundle.candidateId).toBe(candidate.candidateId);
    expect(bundle.candidateHash).toBe(candidate.deterministicHash);
    expect(bundle.sourceImageReference).toBe(sourceContext.sourceUploadKey);
    expect(bundle.sourceLineageRef).toBe(candidate.candidatePayload.sourceImageLineageRef);
    expect(bundle.runtimePayloadHash).toBe(candidate.candidatePayload.runtimePayloadHash);
    expect(bundle.boundaryPolicyVersion).toBe('geometry_candidate_boundary_v1');
    expect(bundle.candidateSnapshot).toMatchObject({
      candidateId: candidate.candidateId,
      candidateType: 'possible_obstruction_candidate',
      candidateCategory: 'roof_context',
      candidateStatus: 'review_required',
      reviewRequired: true,
      nonAuthoritative: true,
    });
    expect(bundle.staleVisibility.candidateOnly).toBe(true);
    expect(bundle.staleVisibility.staleClasses).toEqual([
      'candidate_policy_stale',
      'candidate_review_stale',
      'candidate_runtime_stale',
      'candidate_source_stale',
    ]);
    expect(bundle.staleVisibility.cadInvalidationAllowed).toBe(false);
    expect(bundle.staleVisibility.engineeringInvalidationAllowed).toBe(false);
    expect(bundle.lineage.dependencyRole).toBe('lineage_visibility_only');
    expect(bundle.lineage.downstreamAuthority).toBe(false);
    expect(bundle.lineage.allowedEdges).toEqual(['source_image_to_candidate', 'candidate_to_review_projection']);
    expect(bundle.reviewActionPreviews.accept?.actionType).toBe('accept_for_review_projection');
    expect(bundle.reviewActionPreviews.accept?.reviewedProjectionId).toMatch(/^aep_/);
    expect(bundle.reviewActionPreviews.reject?.actionType).toBe('reject_candidate');
    expect(bundle.reviewActionPreviews.reject?.reviewedProjectionId).toBeNull();
    expect(bundle.reviewActionPreviews.reject?.rejectionReason).toBe('not_actionable_for_review_projection');
    expect(bundle.reviewerAnnotationPreview?.annotationSchemaVersion).toBe('geometry_candidate_review_annotation_v1');
    expect(bundle.reviewerAnnotationPreview?.reviewerDisplayLabel).toBe('Export Annotation Reviewer');
    expect(bundle.reviewerAnnotationPreview?.annotationNote).toBe('Preview annotation for audit export only.');
    expect(bundle.reviewerAnnotationPreview?.reviewerConfidence).toBe(0.81);
    expect(bundle.reviewerAnnotationPreview?.tags).toEqual(['export-handoff', 'possible-obstruction', 'roof-context']);
    expect(bundle.reviewerAnnotationPreview?.priorReviewState).toBe('review_required');
    expect(bundle.reviewerAnnotationPreview?.resultingReviewState).toBe('review_required');
    expect(bundle.reviewerAnnotationPreview?.projectionCreated).toBe(false);
    expect(bundle.reviewerAnnotationPreview?.reviewedProjectionId).toBeNull();
    expect(bundle.reviewerAnnotationPreview?.authorityFlags.downstreamAuthority).toBe(false);
    expect(bundle.authorityFlags).toEqual({
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

  it('supports export without action previews while remaining DTO-only', async () => {
    const candidate = await geometryCandidate();
    const bundle = buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-08T00:00:00.000Z',
      exportedBy: 'audit-exporter-2',
    });

    expect(bundle.exportReason).toBeNull();
    expect(bundle.reviewActionPreviews.accept).toBeNull();
    expect(bundle.reviewActionPreviews.reject).toBeNull();
    expect(bundle.reviewerAnnotationPreview).toBeNull();
    expect(bundle.staleVisibility.staleClasses).toEqual([]);
    expect(bundle.staleVisibility.regenerationAllowed).toBe(false);
    expect(bundle.authorityFlags.downstreamAuthority).toBe(false);
  });

  it('rejects missing export metadata, missing reject preview reason, non-geometry candidates, and unreviewable candidates', async () => {
    const candidate = await geometryCandidate();

    expect(() => buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '   ',
      exportedBy: 'audit-exporter-3',
    })).toThrow(/exportedAt/i);

    expect(() => buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-09T00:00:00.000Z',
      exportedBy: '   ',
    })).toThrow(/exportedBy/i);

    expect(() => buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-09T00:00:00.000Z',
      exportedBy: 'audit-exporter-3',
      rejectPreview: {
        reviewerId: 'reviewer-export-reject-missing-reason',
        reviewedAt: '2026-01-09T01:00:00.000Z',
      },
    })).toThrow(/rejection reason/i);

    expect(() => buildGeometryCandidateReviewAuditExportBundle(candidate, {
      exportedAt: '2026-01-09T00:00:00.000Z',
      exportedBy: 'audit-exporter-3',
      annotationPreview: {
        reviewerId: 'reviewer-export-annotation-invalid',
        reviewedAt: '2026-01-09T01:30:00.000Z',
        reviewerConfidence: 1.2,
      },
    })).toThrow(/confidence/i);

    const nonGeometryCandidate: AssistedEvidenceCandidate = {
      ...candidate,
      candidateId: 'non-geometry-export-candidate',
      candidateType: 'photo_quality_candidate',
      candidateCategory: 'quality',
      toolName: 'metadata-fixture-adapter',
      deterministicHash: 'non-geometry-export-hash',
    };
    expect(() => buildGeometryCandidateReviewAuditExportBundle(nonGeometryCandidate, {
      exportedAt: '2026-01-09T00:00:00.000Z',
      exportedBy: 'audit-exporter-3',
    })).toThrow(/possible_obstruction_candidate/i);

    const alreadyAccepted = acceptGeometryCandidateReviewAction(candidate, {
      reviewerId: 'reviewer-export-accepted',
      reviewedAt: '2026-01-09T02:00:00.000Z',
    }).candidate;
    expect(() => buildGeometryCandidateReviewAuditExportBundle(alreadyAccepted, {
      exportedAt: '2026-01-09T03:00:00.000Z',
      exportedBy: 'audit-exporter-3',
    })).toThrow(/review_required status/i);
  });
});
