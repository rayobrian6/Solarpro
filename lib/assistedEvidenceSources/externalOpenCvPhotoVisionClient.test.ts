import { afterEach, describe, expect, it, vi } from 'vitest';
import { runExternalOpenCvPhotoVisionPass } from './externalOpenCvPhotoVisionClient';
import type { SiteSurveyFile } from '@/lib/db/surveys';

const survey = { id: '11111111-1111-4111-8111-111111111111', projectId: 'project-1' };
const file = {
  id: '22222222-2222-4222-8222-222222222222',
  surveyId: survey.id,
  fileUrl: 'https://example.test/roof.jpg',
  filename: 'roof.jpg',
  fileType: 'photo',
  mimeType: 'image/jpeg',
  fileSize: 1234,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  label: null,
  aiLabel: null,
  aiConfidence: null,
  reviewedLabel: null,
  reviewStatus: 'pending',
  metadata: {},
} as unknown as SiteSurveyFile;

describe('external OpenCV photo vision client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailable without processing or persistence when worker URL is not configured', async () => {
    const outcome = await runExternalOpenCvPhotoVisionPass({ survey, files: [file], workerUrl: null });

    expect(outcome.available).toBe(false);
    if (outcome.available === false) {
      expect(outcome.reason).toBe('external_worker_url_not_configured');
      expect(outcome.health).toBeNull();
    }
  });

  it('normalizes external OpenCV results into deterministic review-only candidates', async () => {
    let postedJob: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          status: 'ok',
          toolName: 'external-opencv-photo-vision-worker',
          toolVersion: '0.1.0',
          tools: { opencv: { available: true, version: '4.10.0' }, yolo: { available: true, modelLoaded: true, model: 'yolov8n.pt' }, supervision: { available: true, version: '0.25.1' } },
          authority: { reviewOnly: true, nonAuthoritative: true },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      postedJob = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        schemaVersion: 'solarpro_external_photo_vision_result_v1',
        surveyId: survey.id,
        projectId: survey.projectId,
        toolName: 'external-opencv-photo-vision-worker',
        toolVersion: '0.1.0',
        createdAt: '2026-01-01T00:00:00.000Z',
        runHash: 'runhash123',
        files: [{
          surveyId: survey.id,
          fileId: file.id,
          fileUrl: file.fileUrl,
          filename: file.filename,
          analyzed: true,
          error: null,
          metadata: { widthPx: 100, heightPx: 80, format: 'image/jpeg', byteSize: 1234, sha256: 'abc123', dominantBrightness: 120, sharpnessScore: 44, qualityScore: 72 },
          thumbnailDataUrl: 'data:image/jpeg;base64,abcd',
          edgeSummary: { edgePixelRatio: 0.2, horizontalStrength: 0.5, verticalStrength: 0.25, diagonalStrength: 0.25, denseRegionCount: 1 },
          candidates: [{
            candidateId: 'worker-candidate-1',
            deterministicHash: 'deterministic-worker-hash',
            surveyId: survey.id,
            fileId: file.id,
            fileUrl: file.fileUrl,
            filename: file.filename,
            toolName: 'external-opencv-photo-vision-worker',
            toolVersion: '0.1.0',
            candidateType: 'dominant_line_candidate',
            candidateCategory: 'structure_context',
            confidence: 61,
            summary: 'External OpenCV Hough line candidate.',
            payload: { source: 'opencv_hough_lines_p', line: { x1: 0, y1: 100, x2: 1000, y2: 110, orientation: 'horizontal', strength: 0.8, coordinateSystem: 'normalized_image_0_1000' } },
            line: { x1: 0, y1: 100, x2: 1000, y2: 110, orientation: 'horizontal', strength: 0.8, coordinateSystem: 'normalized_image_0_1000' },
            limitations: ['REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'],
            reviewStatus: 'review_required',
            nonAuthoritative: true,
            runHash: 'runhash123',
            createdAt: '2026-01-01T00:00:00.000Z',
          }, {
            candidateId: 'worker-yolo-1',
            deterministicHash: 'deterministic-yolo-hash',
            surveyId: survey.id,
            fileId: file.id,
            fileUrl: file.fileUrl,
            filename: file.filename,
            toolName: 'external-yolo-supervision-worker',
            toolVersion: '8.3.55',
            candidateType: 'object_detection',
            candidateCategory: 'electrical_context',
            category: 'main_service_panel_candidate',
            confidence: 82,
            summary: 'YOLO/Supervision semantic main service panel candidate.',
            payload: { source: 'yolo_detection', sourceModel: 'yolov8n.pt', modelVersion: '8.3.55', rawClassName: 'tv', bbox: { x: 100, y: 200, width: 220, height: 300, coordinateSystem: 'normalized_image_0_1000' } },
            bbox: { x: 100, y: 200, width: 220, height: 300, coordinateSystem: 'normalized_image_0_1000' },
            limitations: ['Generic pretrained YOLO weights are not solar-specific', 'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'],
            reviewStatus: 'review_required',
            nonAuthoritative: true,
            runHash: 'runhash123',
            createdAt: '2026-01-01T00:00:00.000Z',
          }],
          limitations: ['REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'],
          runHash: 'runhash123',
        }],
        availability: { opencv: 'available:4.10.0', yoloSupervision: 'available:yolov8n.pt:8.3.55', yolo: 'available:yolov8n.pt:8.3.55', supervision: 'available:0.25.1', tesseract: 'unavailable_stage_3_not_implemented_in_this_worker', pythonWorker: 'available_external_docker_worker' },
        authority: { reviewOnly: true, nonAuthoritative: true, canonicalMutationAllowed: false, cadMutationAllowed: false, permitGenerationAllowed: false, bomMutationAllowed: false, engineeringWorkflowMutationAllowed: false },
        limitations: ['REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await runExternalOpenCvPhotoVisionPass({ survey, files: [file], workerUrl: 'https://worker.example', createdAt: '2026-01-01T00:00:00.000Z' });

    expect(outcome.available).toBe(true);
    if (outcome.available) {
      expect(outcome.run.toolName).toBe('external-opencv-photo-vision-worker');
      expect(outcome.run.toolVersion).toBe('0.1.0');
      expect(outcome.run.availability.opencv).toBe('available:4.10.0');
      expect(outcome.run.availability.yoloSupervision).toContain('available:yolov8n.pt');
      expect(outcome.run.availability.supervision).toBe('available:0.25.1');
      expect(outcome.run.authority).toMatchObject({
        reviewOnly: true,
        nonAuthoritative: true,
        canonicalMutationAllowed: false,
        cadMutationAllowed: false,
        permitGenerationAllowed: false,
        bomMutationAllowed: false,
        engineeringWorkflowMutationAllowed: false,
      });
      expect(outcome.run.files[0].thumbnailDataUrl).toContain('data:image/jpeg');
      expect(outcome.run.candidates[0]).toMatchObject({
        toolName: 'external-opencv-photo-vision-worker',
        candidateType: 'dominant_line_candidate',
        reviewStatus: 'review_required',
        nonAuthoritative: true,
        deterministicHash: 'deterministic-worker-hash',
      });
      expect(outcome.run.candidates[0].payload).toMatchObject({
        externalWorker: true,
        stage: 'stage_1_opencv_edges_lines_contours',
        sourceToolName: 'external-opencv-photo-vision-worker',
      });
      expect(outcome.run.candidates[1]).toMatchObject({
        toolName: 'external-yolo-supervision-worker',
        candidateType: 'object_detection',
        candidateCategory: 'electrical_context',
        reviewStatus: 'review_required',
        nonAuthoritative: true,
        deterministicHash: 'deterministic-yolo-hash',
      });
      expect(outcome.run.candidates[1].payload).toMatchObject({
        externalWorker: true,
        stage: 'stage_2_yolo_supervision_semantic_detection',
        sourceModel: 'yolov8n.pt',
        semanticCategory: 'main_service_panel_candidate',
        reviewRequired: true,
        region: { x: 100, y: 200, width: 220, height: 300, coordinateSystem: 'normalized_image_0_1000' },
      });
      expect(postedJob?.requestedTools).toEqual(['opencv_primitives', 'yolo_detection']);
    }
  });
});
