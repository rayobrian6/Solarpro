// ============================================================================
// lib/vision/workerResultConverter.test.ts
//
// BLOCKER 7: Hard verification tests for worker result conversion
//
// Tests:
//   1. Coordinate normalization (0-1000 → 0.0-1.0, top-left → center origin)
//   2. Confidence normalization (0-100 → 0.0-1.0)
//   3. No double normalization (this is the ONLY conversion point)
//   4. referenceImageUrl populated correctly
//   5. Filter out failed file results
//   6. Preserve metadata (fileUrl, fileId, filename, etc.)
//   7. resolveReferenceImageUrl priority chain
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  convertWorkerResultToPhotoVisionResults,
  enrichPhotoContextWithSurveyData,
  resolveReferenceImageUrl,
} from './workerResultConverter';
import type {
  OpenSourcePhotoVisionRunResult,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionCandidate,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

// ============================================================================
// Test Fixtures — complete mock objects satisfying strict TypeScript interfaces
// ============================================================================

function makeCandidate(overrides: Partial<OpenSourcePhotoVisionCandidate> = {}): OpenSourcePhotoVisionCandidate {
  return {
    candidateId: 'cand1',
    surveyId: 'survey123',
    fileId: 'file1',
    fileUrl: 'https://example.com/photo.jpg',
    filename: 'photo.jpg',
    candidateType: 'vent',
    candidateCategory: 'roof_context',
    confidence: 85,
    summary: 'Vent detected',
    payload: {},
    region: {
      coordinateSystem: 'normalized_image_0_1000',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    },
    limitations: [],
    reviewStatus: 'review_required',
    nonAuthoritative: true,
    toolName: 'yolov8',
    toolVersion: '1.0.0',
    runHash: 'hash123',
    deterministicHash: 'dethash1',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFileResult(overrides: Partial<OpenSourcePhotoVisionFileResult> = {}): OpenSourcePhotoVisionFileResult {
  return {
    surveyId: 'survey123',
    fileId: 'file1',
    fileUrl: 'https://example.com/photo.jpg',
    filename: 'photo.jpg',
    analyzed: true,
    error: null,
    metadata: {
      widthPx: 1920,
      heightPx: 1080,
      format: 'jpeg',
      byteSize: 500000,
      sha256: 'abc123',
      dominantBrightness: 128,
      sharpnessScore: 75,
      qualityScore: 80,
    },
    thumbnailDataUrl: null,
    edgeSummary: null,
    candidates: [makeCandidate()],
    limitations: [],
    runHash: 'hash123',
    extractionMethod: 'none',
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<OpenSourcePhotoVisionRunResult> = {}): OpenSourcePhotoVisionRunResult {
  return {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: 'survey123',
    projectId: 'proj123',
    toolName: 'yolov8',
    toolVersion: '1.0.0',
    createdAt: '2024-01-01T00:00:00Z',
    processedCount: 1,
    failedCount: 0,
    candidateCount: 1,
    runHash: 'hash123',
    files: [makeFileResult()],
    candidates: [makeCandidate()],
    availability: {
      opencv: 'available',
      yoloSupervision: 'available',
      tesseract: 'available',
      pythonWorker: 'available',
    },
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      canonicalMutationAllowed: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
    },
    limitations: [],
    ...overrides,
  };
}

// ============================================================================
// Coordinate Normalization
// ============================================================================

describe('workerResultConverter: Coordinate Normalization', () => {
  it('should convert worker coordinates (0-1000) to VisionBoundingBox (0.0-1.0) with center origin', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({
          region: {
            coordinateSystem: 'normalized_image_0_1000',
            x: 100,
            y: 100,
            width: 200,
            height: 200,
          },
        })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results).toHaveLength(1);

    const detection = results[0].inferenceResult.detections[0];
    expect(detection.bbox.x).toBe(0.2); // (100 + 200/2) / 1000 = 0.2
    expect(detection.bbox.y).toBe(0.2); // (100 + 200/2) / 1000 = 0.2
    expect(detection.bbox.width).toBe(0.2); // 200 / 1000 = 0.2
    expect(detection.bbox.height).toBe(0.2); // 200 / 1000 = 0.2
  });

  it('should correctly normalize bbox at top-left corner (0,0)', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({
          region: {
            coordinateSystem: 'normalized_image_0_1000',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
        })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    const detection = results[0].inferenceResult.detections[0];

    // Center origin: top-left bbox at (0,0) with 100x100 → center at (0.05, 0.05)
    expect(detection.bbox.x).toBe(0.05);
    expect(detection.bbox.y).toBe(0.05);
  });

  it('should correctly normalize bbox at bottom-right corner (900,900)', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({
          region: {
            coordinateSystem: 'normalized_image_0_1000',
            x: 900,
            y: 900,
            width: 100,
            height: 100,
          },
        })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    const detection = results[0].inferenceResult.detections[0];

    // Center origin: bottom-right bbox at (900,900) with 100x100 → center at (0.95, 0.95)
    expect(detection.bbox.x).toBeCloseTo(0.95, 10);
    expect(detection.bbox.y).toBeCloseTo(0.95, 10);
  });
});

// ============================================================================
// Confidence Normalization
// ============================================================================

describe('workerResultConverter: Confidence Normalization', () => {
  it('should normalize confidence from worker (0-100) to VisionDetection (0.0-1.0)', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({ confidence: 85 })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results[0].inferenceResult.detections[0].confidence).toBe(0.85);
  });

  it('should handle confidence 0', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({ confidence: 0 })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results[0].inferenceResult.detections[0].confidence).toBe(0.0);
  });

  it('should handle confidence 100', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({ confidence: 100 })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results[0].inferenceResult.detections[0].confidence).toBe(1.0);
  });
});

// ============================================================================
// No Double Normalization
// ============================================================================

describe('workerResultConverter: No Double Normalization', () => {
  it('should produce correct 0.0-1.0 float coordinates in ONE step (this is the ONLY conversion)', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        candidates: [makeCandidate({
          confidence: 85,
          region: {
            coordinateSystem: 'normalized_image_0_1000',
            x: 250,
            y: 250,
            width: 500,
            height: 500,
          },
        })],
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    const bbox = results[0].inferenceResult.detections[0].bbox;

    // Worker input: x=250, y=250, w=500, h=500 (0-1000)
    // Expected output: x=0.5, y=0.5, w=0.5, h=0.5 (0.0-1.0, center origin)
    expect(bbox.x).toBe(0.5);
    expect(bbox.y).toBe(0.5);
    expect(bbox.width).toBe(0.5);
    expect(bbox.height).toBe(0.5);

    // Verify type is number (not string, not integer)
    expect(typeof bbox.x).toBe('number');
    expect(typeof bbox.width).toBe('number');

    // Verify range is strictly 0.0-1.0
    expect(bbox.x).toBeGreaterThanOrEqual(0.0);
    expect(bbox.x).toBeLessThanOrEqual(1.0);
    expect(bbox.y).toBeGreaterThanOrEqual(0.0);
    expect(bbox.y).toBeLessThanOrEqual(1.0);
  });
});

// ============================================================================
// Failed File Filtering
// ============================================================================

describe('workerResultConverter: Failed File Filtering', () => {
  it('should skip files that failed to analyze', () => {
    const workerResult = makeRunResult({
      processedCount: 2,
      failedCount: 1,
      files: [
        makeFileResult({
          fileId: 'file1',
          fileUrl: 'https://example.com/photo1.jpg',
          analyzed: true,
          error: null,
          candidates: [makeCandidate()],
        }),
        makeFileResult({
          fileId: 'file2',
          fileUrl: 'https://example.com/photo2.jpg',
          analyzed: false,
          error: 'Download failed',
          candidates: [],
        }),
      ],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results).toHaveLength(1);
    expect(results[0].fileId).toBe('file1');
  });
});

// ============================================================================
// Metadata Preservation
// ============================================================================

describe('workerResultConverter: Metadata Preservation', () => {
  it('should preserve fileUrl, fileId, filename, and imageDims', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({
        fileId: 'file1',
        fileUrl: 'https://example.com/photo.jpg',
        filename: 'photo.jpg',
        metadata: {
          widthPx: 1920,
          heightPx: 1080,
          format: 'jpeg',
          byteSize: 500000,
          sha256: 'abc123',
          dominantBrightness: 128,
          sharpnessScore: 75,
          qualityScore: 80,
        },
      })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.fileId).toBe('file1');
    expect(result.fileUrl).toBe('https://example.com/photo.jpg');
    expect(result.photoContext.fileUrl).toBe('https://example.com/photo.jpg');
    expect(result.photoContext.imageDims).toEqual({ width: 1920, height: 1080 });
  });
});

// ============================================================================
// referenceImageUrl
// ============================================================================

describe('workerResultConverter: referenceImageUrl', () => {
  it('should initialize referenceImageUrl as null in PhotoContext', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({ candidates: [] })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');
    expect(results[0].photoContext.referenceImageUrl).toBe(null);
  });
});

// ============================================================================
// enrichPhotoContextWithSurveyData
// ============================================================================

describe('workerResultConverter: enrichPhotoContextWithSurveyData', () => {
  it('should populate PhotoContext with GPS, azimuth, pitch, label, roofPlaneId', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({ candidates: [] })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');

    enrichPhotoContextWithSurveyData(results[0], {
      fileId: 'file1',
      lat: 40.7128,
      lng: -74.0060,
      azimuth: 45.5,
      pitch: -10.0,
      label: 'East-Facing',
      roofPlaneId: 'plane123',
      referenceImageUrl: 'https://example.com/ref.jpg',
    });

    const ctx = results[0].photoContext;
    expect(ctx.lat).toBe(40.7128);
    expect(ctx.lng).toBe(-74.0060);
    expect(ctx.azimuth).toBe(45.5);
    expect(ctx.pitch).toBe(-10.0);
    expect(ctx.label).toBe('East-Facing');
    expect(ctx.roofPlaneId).toBe('plane123');
    expect(ctx.referenceImageUrl).toBe('https://example.com/ref.jpg');
  });

  it('should not enrich if fileId does not match', () => {
    const workerResult = makeRunResult({
      files: [makeFileResult({ candidates: [] })],
    });

    const results = convertWorkerResultToPhotoVisionResults(workerResult, 'proj123');

    enrichPhotoContextWithSurveyData(results[0], {
      fileId: 'file2', // Different fileId
      lat: 40.7128,
      lng: -74.0060,
      azimuth: 45.5,
      pitch: -10.0,
      label: 'East-Facing',
      roofPlaneId: 'plane123',
      referenceImageUrl: 'https://example.com/ref.jpg',
    });

    const ctx = results[0].photoContext;
    expect(ctx.lat).toBe(null);
    expect(ctx.lng).toBe(null);
  });
});

// ============================================================================
// resolveReferenceImageUrl Priority Chain
// ============================================================================

describe('workerResultConverter: resolveReferenceImageUrl Priority Chain', () => {
  it('should prioritize roof plane reference image (priority 1)', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: { 'plane123': 'https://example.com/plane-ref.jpg' },
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: 'https://example.com/cad.jpg',
      orthographicArtifactUrl: 'https://example.com/ortho.jpg',
      surveySelectedReferenceUrl: 'https://example.com/survey-ref.jpg',
    });

    expect(url).toBe('https://example.com/plane-ref.jpg');
  });

  it('should fall back to CAD/SVG raster (priority 2)', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: {},
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: 'https://example.com/cad.jpg',
      orthographicArtifactUrl: 'https://example.com/ortho.jpg',
      surveySelectedReferenceUrl: 'https://example.com/survey-ref.jpg',
    });

    expect(url).toBe('https://example.com/cad.jpg');
  });

  it('should fall back to orthographic artifact (priority 3)', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: {},
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: null,
      orthographicArtifactUrl: 'https://example.com/ortho.jpg',
      surveySelectedReferenceUrl: 'https://example.com/survey-ref.jpg',
    });

    expect(url).toBe('https://example.com/ortho.jpg');
  });

  it('should fall back to survey-selected reference photo (priority 4)', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: {},
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: null,
      orthographicArtifactUrl: null,
      surveySelectedReferenceUrl: 'https://example.com/survey-ref.jpg',
    });

    expect(url).toBe('https://example.com/survey-ref.jpg');
  });

  it('should return null if no reference image is available (priority 5)', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: {},
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: null,
      orthographicArtifactUrl: null,
      surveySelectedReferenceUrl: null,
    });

    expect(url).toBe(null);
  });

  it('should handle roofPlaneId mismatch in roofPlaneReferenceImages', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: { 'plane456': 'https://example.com/plane456.jpg' },
      roofPlaneId: 'plane123', // Different ID
      cadSvgRasterUrl: 'https://example.com/cad.jpg',
      orthographicArtifactUrl: null,
      surveySelectedReferenceUrl: null,
    });

    expect(url).toBe('https://example.com/cad.jpg'); // Falls back to priority 2
  });

  it('should handle empty string URLs as null', () => {
    const url = resolveReferenceImageUrl({
      roofPlaneReferenceImages: {},
      roofPlaneId: 'plane123',
      cadSvgRasterUrl: '',
      orthographicArtifactUrl: '   ',
      surveySelectedReferenceUrl: null,
    });

    expect(url).toBe(null);
  });
});
