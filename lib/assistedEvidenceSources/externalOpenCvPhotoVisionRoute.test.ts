import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  runExternalOpenCvPhotoVisionPass: vi.fn(),
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun: vi.fn(),
}));
const { runExternalOpenCvPhotoVisionPass, replaceOpenSourcePhotoVisionCandidatesForSurveyRun } = mocks;

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: () => ({ id: 'user-1' }),
}));

vi.mock('@/lib/db-neon', () => ({
  getSiteSurveyById: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', projectId: 'project-1' })),
  getSiteSurveyFiles: vi.fn(async () => [{ id: '22222222-2222-4222-8222-222222222222', fileType: 'photo', fileUrl: 'https://example.test/roof.jpg', filename: 'roof.jpg', mimeType: 'image/jpeg' }]),
  isValidUUID: vi.fn(() => true),
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun: mocks.replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun: vi.fn((run) => ({ runHash: run.runHash, candidateCount: run.candidateCount, authority: run.authority, availability: run.availability })),
}));

vi.mock('@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient', () => ({
  runExternalOpenCvPhotoVisionPass: mocks.runExternalOpenCvPhotoVisionPass,
}));

import { POST } from '../../app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/route';

describe('open-source photo vision pass API route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unavailable diagnostics without persisting fake candidates when external worker is down', async () => {
    runExternalOpenCvPhotoVisionPass.mockResolvedValueOnce({
      available: false,
      reason: 'external_worker_url_not_configured',
      health: null,
    });

    const res = await POST(new NextRequest('https://solarpro.test/api/site-surveys/11111111-1111-4111-8111-111111111111/open-source-photo-vision-pass', { method: 'POST' }), { params: { surveyId: '11111111-1111-4111-8111-111111111111' } });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.detail).toBe('external_worker_url_not_configured');
    expect(json.meta).toMatchObject({
      externalWorker: true,
      workerUnavailable: true,
      sourceImageBytesProcessed: false,
      reviewOnly: true,
      canonicalGeometryMutationPerformed: false,
      cadMutationPerformed: false,
      permitGenerationTriggered: false,
      bomMutationPerformed: false,
      engineeringWorkflowMutationPerformed: false,
    });
    expect(json.data.summary.candidateCount).toBe(0);
    expect(replaceOpenSourcePhotoVisionCandidatesForSurveyRun).not.toHaveBeenCalled();
  });

  it('persists only returned external review candidates through the existing store when worker is available', async () => {
    const run = {
      schemaVersion: 'open_source_photo_vision_run_v1',
      surveyId: '11111111-1111-4111-8111-111111111111',
      projectId: 'project-1',
      toolName: 'external-opencv-photo-vision-worker',
      toolVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      processedCount: 1,
      failedCount: 0,
      candidateCount: 1,
      runHash: 'runhash',
      files: [],
      candidates: [{ candidateType: 'object_detection', payload: { stage: 'stage_2_yolo_supervision_semantic_detection', sourceModel: 'yolov8n.pt' }, nonAuthoritative: true, reviewStatus: 'review_required' }],
      availability: { opencv: 'available:4.10.0', yoloSupervision: 'available:yolov8n.pt:8.3.55', yolo: 'available:yolov8n.pt:8.3.55', supervision: 'available:0.25.1', tesseract: 'unavailable_stage_3_not_implemented_in_this_pass', pythonWorker: 'available_external_docker_worker' },
      authority: { reviewOnly: true, nonAuthoritative: true, canonicalMutationAllowed: false, cadMutationAllowed: false, permitGenerationAllowed: false, bomMutationAllowed: false, engineeringWorkflowMutationAllowed: false },
      limitations: ['REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'],
    };
    const stored = { schemaVersion: 'open_source_photo_vision_stored_bundle_v1', candidateCount: 1, candidates: [], authority: run.authority };
    runExternalOpenCvPhotoVisionPass.mockResolvedValueOnce({ available: true, health: { status: 'ok' }, run });
    replaceOpenSourcePhotoVisionCandidatesForSurveyRun.mockResolvedValueOnce(stored);

    const res = await POST(new NextRequest('https://solarpro.test/api/site-surveys/11111111-1111-4111-8111-111111111111/open-source-photo-vision-pass', { method: 'POST' }), { params: { surveyId: '11111111-1111-4111-8111-111111111111' } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.summary).toMatchObject({ processedFileCount: 1, failedFileCount: 0, candidateCount: 1, runHash: 'runhash' });
    expect(json.data.summary.candidateTypeCounts).toMatchObject({ object_detection: 1 });
    expect(json.data.summary.unavailableDiagnostics).not.toContain('yoloSupervision: unavailable_stage_2_not_implemented');
    expect(json.meta).toMatchObject({ externalWorker: true, workerUnavailable: false, sourceImageBytesProcessed: true, cadMutationPerformed: false, bomMutationPerformed: false });
    expect(replaceOpenSourcePhotoVisionCandidatesForSurveyRun).toHaveBeenCalledTimes(1);
    expect(replaceOpenSourcePhotoVisionCandidatesForSurveyRun.mock.calls[0][2]).toBe(run);
  });
});
