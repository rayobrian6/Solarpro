import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeometryReconstructionInput } from './types';

const runSegmentationFullOutputMock = vi.hoisted(() => vi.fn());
const runLineExtractionMock = vi.hoisted(() => vi.fn());
const estimateVanishingPointsMock = vi.hoisted(() => vi.fn());
const runDepthMock = vi.hoisted(() => vi.fn());
const runPlaneExtractionMock = vi.hoisted(() => vi.fn());
const runMultiViewFusionMock = vi.hoisted(() => vi.fn());
const runPhotogrammetryMock = vi.hoisted(() => vi.fn());

vi.mock('./workers/segmentation/runSegmentationWorker', () => ({
  runSegmentationFromReconstructionInput: vi.fn(),
  runSegmentationFullOutput: runSegmentationFullOutputMock,
  SEGMENTATION_WORKER_VERSION: 'test-segmentation-worker',
}));

vi.mock('./workers/lineExtraction/runLineExtractionWorker', () => ({
  runLineExtractionFromReconstructionInput: runLineExtractionMock,
}));

vi.mock('./workers/perspective/estimateVanishingPoints', () => ({
  estimateVanishingPointsFromReconstructionInput: estimateVanishingPointsMock,
}));

vi.mock('./workers/depth/runDepthWorker', () => ({
  runDepthFromReconstructionInput: runDepthMock,
}));

vi.mock('./workers/planeExtraction/runPlaneExtractionWorker', () => ({
  runPlaneExtractionFromReconstructionInput: runPlaneExtractionMock,
}));

vi.mock('./workers/multiViewFusion/runMultiViewFusion', () => ({
  runMultiViewFusionFromReconstructionInput: runMultiViewFusionMock,
}));

vi.mock('./workers/photogrammetry/runPhotogrammetryWorker', () => ({
  runPhotogrammetryFromReconstructionInput: runPhotogrammetryMock,
}));

import { runFullGeometryReconstructionPipeline } from './runFullPipeline';

describe('runFullGeometryReconstructionPipeline budget handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSegmentationFullOutputMock.mockResolvedValue({
      artifacts: [],
      stageTimings: {},
      workerVersion: 'test-segmentation-worker',
      imageBytesMap: {},
      backend: 'sam2',
      sam2PhotoCount: 0,
      failedPhotoCount: 0,
      skippedPhotoCount: 0,
      cannyPhotoCount: 0,
      sam2ModelInfo: null,
      photoResults: [],
      budgetExhaustedReason: null,
    });
    runLineExtractionMock.mockReturnValue([]);
    estimateVanishingPointsMock.mockReturnValue([]);
    runDepthMock.mockResolvedValue([]);
    runPlaneExtractionMock.mockReturnValue([]);
    runMultiViewFusionMock.mockReturnValue({ artifacts: [] });
    runPhotogrammetryMock.mockReturnValue({ artifacts: [] });
  });

  it('reserves downstream geometry time by constraining segmentation in full Pipeline B', async () => {
    const input: GeometryReconstructionInput = {
      surveyId: 'survey-1',
      pipeline: 'full',
      sourcePhotos: [
        {
          fileId: 'photo-1',
          fileUrl: 'https://example.com/photo.jpg',
          filename: 'photo.jpg',
          label: 'roof_plane',
        },
      ],
      config: {
        minConfidence: 42,
      },
    };

    await runFullGeometryReconstructionPipeline(input);

    expect(runSegmentationFullOutputMock).toHaveBeenCalledTimes(1);
    expect(runSegmentationFullOutputMock.mock.calls[0][0]).toMatchObject({
      surveyId: 'survey-1',
      pipeline: 'full',
      config: {
        minConfidence: 42,
        maxSam2Photos: 8,
        stageTimeoutMs: 150_000,
        minRemainingMsForSam2Attempt: 35_000,
      },
    });
  });
});
