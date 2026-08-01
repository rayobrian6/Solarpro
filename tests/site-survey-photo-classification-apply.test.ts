import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';

const mockGetUserFromRequest = vi.fn();
const mockGetSiteSurveyById = vi.fn();
const mockGetSiteSurveyFiles = vi.fn();
const mockUpdateSiteSurveyFileLabels = vi.fn();
const mockDiagnoseSiteSurveyFileLabelUpdateMatches = vi.fn();
const mockAnalyzeSurveyPhotosOpenSource = vi.fn();

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: mockGetUserFromRequest,
}));

vi.mock('@/lib/db-neon', () => ({
  getSiteSurveyById: mockGetSiteSurveyById,
  getSiteSurveyFiles: mockGetSiteSurveyFiles,
  isValidUUID: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  updateSiteSurveyFileLabels: mockUpdateSiteSurveyFileLabels,
  diagnoseSiteSurveyFileLabelUpdateMatches: mockDiagnoseSiteSurveyFileLabelUpdateMatches,
}));

vi.mock('@/lib/siteSurvey/photoIntelligence', () => ({
  analyzeSurveyPhotosOpenSource: mockAnalyzeSurveyPhotosOpenSource,
}));

const surveyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const survey: SiteSurvey = {
  id: surveyId,
  clientId: '33333333-3333-4333-8333-333333333333',
  projectId: '44444444-4444-4444-8444-444444444444',
  createdBy: userId,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'completed',
  source: 'project_handoff',
  addressSnapshot: null,
  surveyData: { schemaVersion: '2.0', photos: [] },
  inspectorName: 'Field Tech',
  notes: null,
  externalSurveyId: null,
  deliveryId: null,
};

function file(id: string, label: string | null, filename: string): SiteSurveyFile {
  return {
    id,
    surveyId,
    fileUrl: `https://cdn.example.test/${filename}`,
    fileType: 'photo',
    label,
    filename,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function request(items: Array<{ fileId: string; acceptedCategory: string }>) {
  return new NextRequest(`https://solarpro.test/api/site-surveys/${surveyId}/photo-classification-preview/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

describe('site survey photo classification apply route', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUserFromRequest.mockReset();
    mockGetSiteSurveyById.mockReset();
    mockGetSiteSurveyFiles.mockReset();
    mockUpdateSiteSurveyFileLabels.mockReset();
    mockDiagnoseSiteSurveyFileLabelUpdateMatches.mockReset();
    mockAnalyzeSurveyPhotosOpenSource.mockReset();

    mockGetUserFromRequest.mockReturnValue({ id: userId });
    mockGetSiteSurveyById.mockResolvedValue(survey);
    mockDiagnoseSiteSurveyFileLabelUpdateMatches.mockResolvedValue([]);
    mockAnalyzeSurveyPhotosOpenSource.mockResolvedValue([]);
  });

  it('persists reviewed labels and recomputes canonical manifest from refreshed DB rows', async () => {
    const before = [
      file('file-meter', null, 'meter.jpg'),
      file('file-overview', null, 'overview.jpg'),
    ];
    const after = [
      file('file-meter', 'meter', 'meter.jpg'),
      file('file-overview', 'overview', 'overview.jpg'),
    ];

    mockGetSiteSurveyFiles
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    mockUpdateSiteSurveyFileLabels.mockResolvedValue(after);

    const { POST } = await import('@/app/api/site-surveys/[surveyId]/photo-classification-preview/apply/route');
    const response = await POST(
      request([
        { fileId: 'file-meter', acceptedCategory: 'Utility Meter' },
        { fileId: 'file-overview', acceptedCategory: 'Site Overview' },
      ]),
      { params: Promise.resolve({ surveyId }) },
    );
    const json = await response.json();

    expect(json.success).toBe(true);
    expect(mockUpdateSiteSurveyFileLabels).toHaveBeenCalledWith(surveyId, userId, [
      { fileId: 'file-meter', label: 'meter' },
      { fileId: 'file-overview', label: 'overview' },
    ]);
    expect(json.data.appliedCount).toBe(2);
    expect(json.data.diagnostics.canonicalCounts.classifiedItems).toBe(2);
    expect(json.data.diagnostics.canonicalCounts.promotedAiReviewedCount).toBe(2);
    expect(json.data.refreshedDetail.evidenceManifest.coverage.find((group: { category: string }) => group.category === 'meter').count).toBe(1);
    expect(json.data.refreshedDetail.evidenceManifest.coverage.find((group: { category: string }) => group.category === 'overview').count).toBe(1);
  });

  it('fails loudly when reviewed labels match candidate files but no DB rows are updated', async () => {
    const unchanged = [
      file('file-meter', null, 'meter.jpg'),
      file('file-overview', null, 'overview.jpg'),
    ];

    mockGetSiteSurveyFiles.mockResolvedValue(unchanged);
    mockUpdateSiteSurveyFileLabels.mockResolvedValue([]);
    mockDiagnoseSiteSurveyFileLabelUpdateMatches.mockResolvedValue([
      {
        fileId: 'file-meter',
        requestedSurveyId: surveyId,
        requestedUserId: userId,
        fileRowExists: true,
        fileBelongsToRequestedSurvey: true,
        linkedSurveyRowExists: true,
        linkedClientRowExists: true,
        clientBelongsToAuthenticatedUser: false,
        updatePredicateWouldMatch: false,
        actualSurveyId: surveyId,
        linkedClientId: survey.clientId,
        linkedClientUserId: 'other-user',
        currentLabel: null,
      },
      {
        fileId: 'file-overview',
        requestedSurveyId: surveyId,
        requestedUserId: userId,
        fileRowExists: false,
        fileBelongsToRequestedSurvey: false,
        linkedSurveyRowExists: false,
        linkedClientRowExists: false,
        clientBelongsToAuthenticatedUser: false,
        updatePredicateWouldMatch: false,
        actualSurveyId: null,
        linkedClientId: null,
        linkedClientUserId: null,
        currentLabel: null,
      },
    ]);

    const { POST } = await import('@/app/api/site-surveys/[surveyId]/photo-classification-preview/apply/route');
    const response = await POST(
      request([
        { fileId: 'file-meter', acceptedCategory: 'Utility Meter' },
        { fileId: 'file-overview', acceptedCategory: 'Site Overview' },
      ]),
      { params: Promise.resolve({ surveyId }) },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain('No survey file labels were updated');
    expect(json.diagnostics.requestedCount).toBe(2);
    expect(json.diagnostics.acceptedCount).toBe(2);
    expect(json.diagnostics.updateCount).toBe(2);
    expect(json.diagnostics.updatedCount).toBe(0);
    expect(json.diagnostics.requestReceived).toBe(true);
    expect(json.diagnostics.unmatchedFileIds).toEqual(['file-meter', 'file-overview']);
    expect(mockDiagnoseSiteSurveyFileLabelUpdateMatches).toHaveBeenCalledWith(
      surveyId,
      userId,
      ['file-meter', 'file-overview'],
    );
    expect(json.diagnostics.rowMatchDiagnostics).toEqual([
      expect.objectContaining({
        fileId: 'file-meter',
        clientBelongsToAuthenticatedUser: false,
        updatePredicateWouldMatch: false,
      }),
      expect.objectContaining({
        fileId: 'file-overview',
        fileRowExists: false,
        updatePredicateWouldMatch: false,
      }),
    ]);
    expect(json.diagnostics.normalizedUpdates).toEqual([
      { fileId: 'file-meter', label: 'meter' },
      { fileId: 'file-overview', label: 'overview' },
    ]);
  });
});
