import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findActiveJobForSurvey: vi.fn(),
  countActiveJobsForUser: vi.fn(),
  getExternalOpenCvWorkerUrl: vi.fn(),
  fetchHealth: vi.fn(),
  createAndSubmitJob: vi.fn(),
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun: vi.fn(),
}));

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

vi.mock('@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager', () => ({
  createAndSubmitJob: mocks.createAndSubmitJob,
  getJob: vi.fn(),
  findActiveJobForSurvey: mocks.findActiveJobForSurvey,
  countActiveJobsForUser: mocks.countActiveJobsForUser,
  cancelJob: vi.fn(),
  markStaleJobsFailed: vi.fn(),
  updatePhotoLabelsFromCandidates: vi.fn(),
}));

vi.mock('@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient', () => ({
  getExternalOpenCvWorkerUrl: mocks.getExternalOpenCvWorkerUrl,
  fetchHealth: mocks.fetchHealth,
  runExternalOpenCvPhotoVisionPass: vi.fn(),
}));

vi.mock('@/lib/vision/workerResultConverter', () => ({
  convertWorkerResultToPhotoVisionResults: vi.fn(() => []),
  enrichPhotoContextWithSurveyData: vi.fn(),
  resolveReferenceImageUrl: vi.fn(() => null),
}));

vi.mock('@/lib/vision/visionAggregator', () => ({
  aggregateVisionResults: vi.fn(async () => ({
    photosProcessed: 0,
    rawDetectionCount: 0,
    obstructions: [],
    electricalNodes: [],
    planeCorrections: [],
    classCounts: {},
    hasHighConfidenceDetections: false,
    log: [],
  })),
}));

import { POST } from '../../app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/route';

describe('open-source photo vision pass API route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unavailable diagnostics without persisting fake candidates when external worker is down', async () => {
    // No existing active job
    mocks.findActiveJobForSurvey.mockResolvedValueOnce(null);
    // Under rate limit
    mocks.countActiveJobsForUser.mockResolvedValueOnce(0);
    // Worker URL not configured → 503
    mocks.getExternalOpenCvWorkerUrl.mockReturnValueOnce(null);

    const res = await POST(new NextRequest('https://solarpro.test/api/site-surveys/11111111-1111-4111-8111-111111111111/open-source-photo-vision-pass', { method: 'POST' }), { params: Promise.resolve({ surveyId: '11111111-1111-4111-8111-111111111111' }) });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
    expect(mocks.replaceOpenSourcePhotoVisionCandidatesForSurveyRun).not.toHaveBeenCalled();
  });

  it('creates and submits an async job when worker is available', async () => {
    // No existing active job
    mocks.findActiveJobForSurvey.mockResolvedValueOnce(null);
    // Under rate limit
    mocks.countActiveJobsForUser.mockResolvedValueOnce(0);
    // Worker URL configured and healthy
    mocks.getExternalOpenCvWorkerUrl.mockReturnValueOnce('https://worker.test');
    mocks.fetchHealth.mockResolvedValueOnce({ status: 'ok' });
    // Job creation succeeds
    mocks.createAndSubmitJob.mockResolvedValueOnce({
      job: { jobId: 'job-1', surveyId: '11111111-1111-4111-8111-111111111111', totalPhotoFiles: 1, totalBatches: 1 },
      renderSubmitOk: true,
      renderError: null,
    });

    const res = await POST(new NextRequest('https://solarpro.test/api/site-surveys/11111111-1111-4111-8111-111111111111/open-source-photo-vision-pass', { method: 'POST' }), { params: Promise.resolve({ surveyId: '11111111-1111-4111-8111-111111111111' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.jobId).toBe('job-1');
    expect(mocks.createAndSubmitJob).toHaveBeenCalledTimes(1);
  });
});
