/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createReviewedEvidenceProjection, type AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import { createGeometryCandidateDemoCandidates } from '@/lib/assistedEvidenceSources';
import type { AssistedEvidenceSourceContext } from '@/lib/assistedEvidenceSources';
import { GeometryCandidateReviewWorkspace } from '@/app/admin/engineering-intelligence/components';

function sourceContext(): AssistedEvidenceSourceContext {
  return {
    sourceFileId: 'review-workspace-source-image-001',
    sourceUploadKey: 'uploads/review-workspace/possible-obstruction-source-001.png',
    projectId: 'project-review-workspace-001',
    surveyId: 'survey-review-workspace-001',
    toolRunId: 'geometry-review-workspace-run-001',
    toolConfigHash: 'geometry-review-workspace-config-v1',
    sourceMetadataHash: 'geometry-review-workspace-source-hash-v1',
    createdAt: '2025-06-01T00:00:00.000Z',
    createdBy: 'geometry-review-workspace-test',
  };
}

async function buildGeometryCandidate(overrides: Partial<AssistedEvidenceCandidate> = {}): Promise<AssistedEvidenceCandidate> {
  const result = await createGeometryCandidateDemoCandidates({
    sourceContext: sourceContext(),
    sourceContextText: 'roof source image with possible vent obstruction review context',
  });
  const candidate = result.candidates[0];
  if (!candidate) throw new Error('Expected geometry candidate fixture');
  return {
    ...candidate,
    ...overrides,
    candidatePayload: {
      ...candidate.candidatePayload,
      ...(overrides.candidatePayload ?? {}),
    },
  };
}

describe('GeometryCandidateReviewWorkspace', () => {
  it('renders possible obstruction geometry candidates as non-authoritative review-only context with required provenance fields', async () => {
    const candidate = await buildGeometryCandidate();
    const projection = createReviewedEvidenceProjection(candidate, {
      reviewerId: 'reviewer-ui-001',
      reviewedAt: '2025-06-01T01:00:00.000Z',
      acceptedFields: ['possible_obstruction_candidate'],
      reviewNotes: ['Projection only; not canonical geometry, not CAD input, and not engineering authority.'],
    });

    render(<GeometryCandidateReviewWorkspace sandbox={{ candidates: [candidate], projections: [projection], warning: 'fixture only' }} />);

    expect(screen.getByText('Geometry Candidate Review Workspace V1')).toBeInTheDocument();
    for (const label of ['GEOMETRY CANDIDATE', 'REVIEW REQUIRED', 'NON-AUTHORITATIVE', 'NOT CAD INPUT', 'NOT ENGINEERING TRUTH', 'NOT CANONICAL GEOMETRY']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    for (const requiredText of [
      candidate.candidateId,
      'possible_obstruction_candidate',
      candidate.sourceUploadKey,
      String(candidate.candidatePayload.sourceImageLineageRef),
      `${candidate.toolName}@${candidate.toolVersion}`,
      String(candidate.candidatePayload.runtimePayloadHash),
      candidate.deterministicHash,
      String(candidate.candidatePayload.boundaryPolicyVersion),
      `${projection.projectionStatus}:${projection.canonicalParticipationStatus}`,
      'Projection only; not canonical geometry, not CAD input, and not engineering authority.',
    ]) {
      expect(screen.getAllByText(requiredText).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByText('Projection-only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('true').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Downstream authority').length).toBeGreaterThan(0);
    expect(screen.getAllByText('false').length).toBeGreaterThan(0);
  });

  it('surfaces stale indicators as candidate-only metadata without CAD, engineering, workflow, or recommendation authority', async () => {
    const candidate = await buildGeometryCandidate({
      candidatePayload: {
        reviewWorkspaceCurrentState: {
          sourceMetadataHash: 'changed-source-metadata-hash',
          runtimePayloadHash: 'changed-runtime-payload-hash',
          boundaryPolicyVersion: 'changed-boundary-policy-version',
          reviewStateHash: 'changed-review-state-hash',
        },
      },
    });

    render(<GeometryCandidateReviewWorkspace sandbox={{ candidates: [candidate], projections: [], warning: 'fixture only' }} />);

    for (const staleClass of ['candidate_source_stale', 'candidate_runtime_stale', 'candidate_policy_stale', 'candidate_review_stale']) {
      expect(screen.getByText(staleClass)).toBeInTheDocument();
    }

    expect(screen.getByText('Stale state is review visibility metadata only. It does not invalidate CAD, does not invalidate engineering, does not trigger recommendations, and does not create workflows.')).toBeInTheDocument();
    expect(screen.getAllByText('CAD invalidation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Engineering invalidation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Workflow/recommendation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('false').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('false/false').length).toBeGreaterThan(0);
  });

  it('exposes only disabled audited accept/reject controls and no unsafe CAD, engineering, workflow, recommendation, or canonical mutation controls', async () => {
    const candidate = await buildGeometryCandidate();

    render(<GeometryCandidateReviewWorkspace sandbox={{ candidates: [candidate], projections: [], warning: 'fixture only' }} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['accept_for_review_projection', 'reject_candidate']);
    for (const button of buttons) expect(button).toBeDisabled();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    const controls = buttons.map(element => element.textContent?.toLowerCase() ?? '');
    for (const forbiddenAction of [
      'draw geometry',
      'edit roof plane',
      'create cad',
      'create setback',
      'place obstruction',
      'mark cad ready',
      'satisfy requirement',
      'regenerate engineering',
      'create workflow',
      'trigger recommendation',
      'mutate canonical',
    ]) {
      expect(controls.some(control => control.includes(forbiddenAction))).toBe(false);
    }

    expect(screen.getByText('Audited review action path V1 · projection-only · deterministic DTO preview')).toBeInTheDocument();
    expect(screen.getAllByText('deterministic_dto_only_v1').length).toBeGreaterThan(0);
    expect(screen.getByText('not_actionable_for_review_projection')).toBeInTheDocument();
    expect(screen.getByText('NO LIVE DB WRITE')).toBeInTheDocument();
    expect(screen.getByText('NO DOWNSTREAM AUTHORITY')).toBeInTheDocument();
  });

  it('filters out non-geometry candidates from the dedicated review workspace', async () => {
    const geometryCandidate = await buildGeometryCandidate();
    const nonGeometryCandidate: AssistedEvidenceCandidate = {
      ...geometryCandidate,
      candidateId: 'metadata-candidate-not-rendered',
      candidateType: 'photo_quality_candidate',
      candidateCategory: 'quality',
      toolName: 'metadata-fixture-adapter',
      candidatePayload: {
        ...geometryCandidate.candidatePayload,
        label: 'photo_quality_candidate',
      },
    };

    render(<GeometryCandidateReviewWorkspace sandbox={{ candidates: [nonGeometryCandidate, geometryCandidate], projections: [], warning: 'fixture only' }} />);

    expect(screen.queryByText('metadata-candidate-not-rendered')).not.toBeInTheDocument();
    expect(screen.getAllByText(geometryCandidate.candidateId).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Geometry candidates').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });
});
