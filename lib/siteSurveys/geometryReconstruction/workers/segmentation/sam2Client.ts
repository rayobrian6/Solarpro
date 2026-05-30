/**
 * SAM 2 Segmentation Client — HTTP client for the SAM 2 Python service.
 *
 * Calls the SAM 2 FastAPI service (deployed on Render GPU) to perform
 * real image segmentation using Meta's SAM 2.1 model. Falls back to
 * the existing Canny edge detection pipeline if the service is
 * unavailable, unreachable, or returns an error.
 *
 * Architecture:
 *   - POST /segment → returns polygon masks with class hints
 *   - GET /health → checks service readiness
 *   - Graceful degradation: any failure → return null, caller uses Canny
 *   - Configurable via SAM2_SERVICE_URL env var
 *   - Timeout: 180s per image (GPU inference ~1-2s, CPU ~30-45s, plus cold-start overhead)
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { NormalizedPoint } from '../../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Request timeout in milliseconds. CPU inference can take ~40s on Starter plan, plus cold-start overhead. */
const SAM2_TIMEOUT_MS = 180_000;

/**
 * Read the SAM 2 service URL from the environment at call time.
 * This is a function (not a module-level constant) so that tests
 * can change the env var and have it take effect immediately.
 */
function getSAM2ServiceURL(): string {
  return process.env.SAM2_SERVICE_URL ?? '';
}

/** Whether SAM 2 is enabled (service URL is configured). Read at call time. */
export function isSAM2Enabled(): boolean {
  return getSAM2ServiceURL().length > 0;
}

/**
 * @deprecated Use isSAM2Enabled() for testability.
 * Kept as a module-level constant for any code that imported it.
 */
export const SAM2_ENABLED = (process.env.SAM2_SERVICE_URL ?? '').length > 0;

// ---------------------------------------------------------------------------
// Response types (mirror Python Pydantic models)
// ---------------------------------------------------------------------------

interface SAM2PolygonPoint {
  x: number;
  y: number;
}

interface SAM2SegmentationMask {
  mask_index: number;
  polygon: SAM2PolygonPoint[];
  area: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  confidence: number;
  stability_score: number;
  class_hint: string;
  point_count: number;
}

interface SAM2SegmentResponse {
  success: boolean;
  masks: SAM2SegmentationMask[];
  mask_count: number;
  image_width: number;
  image_height: number;
  processing_time_ms: number;
  model_info: {
    model_id: string;
    device: string;
    cuda_available: boolean;
    model_type: string;
    inference_resolution?: string;
  };
  error?: string;
}

interface SAM2HealthResponse {
  status: string;
  model_loaded: boolean;
  device: string;
  model_id: string;
  cuda_available: boolean;
  uptime_seconds: number;
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** A mask returned from SAM 2 segmentation, ready for Pipeline B consumption. */
export interface SAM2MaskResult {
  /** Unique index within this image's results. */
  maskIndex: number;
  /** Polygon outline in normalized image coordinates (0-1000). */
  polygon: NormalizedPoint[];
  /** Mask area in pixels². */
  area: number;
  /** Bounding box in normalized coordinates. */
  maskBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Confidence score (0-100), blended from SAM 2 IoU + stability. */
  confidence: number;
  /** SAM 2 stability score (0-1). */
  stabilityScore: number;
  /** Heuristic class hint: roof, wall, sky, ground, etc. */
  classHint: string;
  /** Number of polygon points after Douglas-Peucker simplification. */
  pointCount: number;
}

/** Result of a SAM 2 segmentation call. */
export interface SAM2SegmentationResult {
  /** Whether the SAM 2 service was used successfully. */
  usedSAM2: boolean;
  /** Masks from SAM 2 (empty if service unavailable). */
  masks: SAM2MaskResult[];
  /** Image dimensions from the service response. */
  imageWidth: number;
  imageHeight: number;
  /** Processing time reported by the service. */
  processingTimeMs: number;
  /** Model info from the service. */
  modelInfo: {
    modelId: string;
    device: string;
    cudaAvailable: boolean;
    inferenceResolution?: string;
  } | null;
  /** Error message if SAM 2 failed (for logging, not user-facing). */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Check if the SAM 2 service is healthy and model is loaded.
 * Returns null if the service is unreachable.
 */
export async function checkSAM2Health(): Promise<SAM2HealthResponse | null> {
  if (!isSAM2Enabled()) return null;

  const t0 = Date.now();
  const serviceURL = getSAM2ServiceURL();
  console.info(`[SAM2] Health check: GET ${serviceURL}/health (timeout=5s)`);

  try {
    const response = await fetch(`${serviceURL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    const elapsedMs = Date.now() - t0;

    if (!response.ok) {
      console.warn(`[SAM2] Health check: FAILED — HTTP ${response.status} in ${elapsedMs}ms`);
      return null;
    }

    const data = (await response.json()) as SAM2HealthResponse;
    console.info(
      `[SAM2] Health check: OK in ${elapsedMs}ms — status=${data.status} model_loaded=${data.model_loaded} device=${data.device} model_id=${data.model_id} uptime=${data.uptime_seconds}s`,
    );
    return data;
  } catch (error) {
    const elapsedMs = Date.now() - t0;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SAM2] Health check: FAILED in ${elapsedMs}ms — ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Warm-up (non-blocking, fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Send a non-blocking warm-up request to the SAM 2 service.
 *
 * On Render cold starts, the SAM 2 model must be downloaded from HuggingFace
 * and loaded into memory (~60-100s for sam2.1-hiera-large). A health check
 * alone does NOT trigger model loading. By sending a tiny 1x1 white PNG to
 * the /segment endpoint, we force the model to start loading immediately.
 *
 * This function is intentionally fire-and-forget (returns void, not Promise).
 * Call it as early as possible in the API route handler — the model will be
 * loading in the background while auth/validation/DB queries run. By the time
 * the actual segmentation call happens minutes later, the model may already
 * be warm, saving ~60-100s of cold-start latency.
 *
 * If the service is already warm, this is a no-op (the /segment call completes
 * in ~1-2s on GPU, ~30s on CPU, and the result is discarded).
 */
export function warmupSAM2Service(): void {
  if (!isSAM2Enabled()) return;

  const serviceURL = getSAM2ServiceURL();

  // Fire health check first to see current state
  const healthPromise = checkSAM2Health();

  // Chain: after health check, send a tiny warm-up segment request
  // regardless of health status (even if model_loaded=false, the /segment
  // call will trigger model loading on the server)
  void healthPromise.then(() => {
    const t0 = Date.now();
    console.info(`[SAM2] Warm-up: sending tiny image to /segment to trigger model loading`);

    // Minimal 1x1 white PNG (67 bytes) — smallest valid PNG
    const MINIMAL_PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // compressed data
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // 
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
      0x44, 0xae, 0x42, 0x60, 0x82,                    // 
    ]);

    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(MINIMAL_PNG)]);
    formData.append('file', imageBlob, 'warmup.png');

    const url = new URL(`${serviceURL}/segment`);
    url.searchParams.set('min_area_fraction', '0.99'); // Reject all masks from 1x1 image
    url.searchParams.set('max_masks', '1');            // Minimize processing

    fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(120_000), // Allow up to 2min for cold start
    })
      .then((response) => {
        const elapsedMs = Date.now() - t0;
        if (response.ok) {
          console.info(`[SAM2] Warm-up: complete in ${elapsedMs}ms — model should be loaded now`);
        } else {
          console.warn(`[SAM2] Warm-up: HTTP ${response.status} in ${elapsedMs}ms — model may still be loading`);
        }
      })
      .catch((error) => {
        const elapsedMs = Date.now() - t0;
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
        console.warn(`[SAM2] Warm-up: ${isTimeout ? 'TIMEOUT' : 'FAILED'} in ${elapsedMs}ms — ${error instanceof Error ? error.message : String(error)}`);
      });
  });
}

// ---------------------------------------------------------------------------
// Main segmentation call
// ---------------------------------------------------------------------------

/**
 * Segment an image using the SAM 2 service.
 *
 * Sends image bytes to the SAM 2 service, receives polygon masks,
 * and converts them to Pipeline B's normalized coordinate format.
 *
 * Returns null if the service is unavailable, unreachable, or returns
 * an error — the caller should fall back to Canny edge detection.
 *
 * @param imageBytes - Raw image bytes (JPEG/PNG/WebP)
 * @param minAreaFraction - Minimum mask area as fraction of image (default 0.02)
 * @param maxMasks - Maximum masks to return (default 20)
 */
export async function segmentWithSAM2(
  imageBytes: Buffer,
  minAreaFraction: number = 0.02,
  maxMasks: number = 20,
): Promise<SAM2SegmentationResult | null> {
  if (!isSAM2Enabled()) return null;

  const t0 = Date.now();
  const imageBytesSize = imageBytes.length;
  const serviceURL = getSAM2ServiceURL();
  console.info(
    `[SAM2] Service call: POST ${serviceURL}/segment — imageSize=${imageBytesSize} bytes (${(imageBytesSize / 1024).toFixed(1)}KB) minAreaFraction=${minAreaFraction} maxMasks=${maxMasks} timeout=${SAM2_TIMEOUT_MS}ms`,
  );

  try {
    // Create form data with the image
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(imageBytes)]);
    formData.append('file', imageBlob, 'image.jpg');

    const url = new URL(`${serviceURL}/segment`);
    url.searchParams.set('min_area_fraction', String(minAreaFraction));
    url.searchParams.set('max_masks', String(maxMasks));

    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(SAM2_TIMEOUT_MS),
    });

    const fetchElapsedMs = Date.now() - t0;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      console.warn(
        `[SAM2] Service call: FAILED — HTTP ${response.status} in ${fetchElapsedMs}ms — ${errorBody}`,
      );
      return null;
    }

    const data = (await response.json()) as SAM2SegmentResponse;

    if (!data.success || data.error) {
      const totalElapsedMs = Date.now() - t0;
      console.warn(
        `[SAM2] Service call: FAILED — service error in ${totalElapsedMs}ms (service_processing=${data.processing_time_ms}ms) — ${data.error ?? 'unknown'}`,
      );
      return null;
    }

    // Convert SAM 2 masks to Pipeline B normalized format
    const masks: SAM2MaskResult[] = data.masks.map((mask) => {
      const imgW = data.image_width;
      const imgH = data.image_height;

      // Convert polygon from pixel coords to normalized 0-1000
      const polygon: NormalizedPoint[] = mask.polygon.map((pt) => ({
        x: Math.round((pt.x / imgW) * 1000),
        y: Math.round((pt.y / imgH) * 1000),
        coordinateSystem: 'normalized_image_0_1000' as const,
      }));

      // Convert bbox from pixel coords to normalized 0-1000
      const [bx, by, bw, bh] = mask.bbox;
      const maskBounds = {
        x: Math.round((bx / imgW) * 1000),
        y: Math.round((by / imgH) * 1000),
        width: Math.round((bw / imgW) * 1000),
        height: Math.round((bh / imgH) * 1000),
      };

      return {
        maskIndex: mask.mask_index,
        polygon,
        area: mask.area,
        maskBounds,
        confidence: mask.confidence,
        stabilityScore: mask.stability_score,
        classHint: mask.class_hint,
        pointCount: mask.point_count,
      };
    });

    const totalElapsedMs = Date.now() - t0;
    console.info(
      `[SAM2] Service call: OK — ${masks.length} masks in ${totalElapsedMs}ms (service_processing=${data.processing_time_ms}ms) — model=${data.model_info?.model_id ?? 'unknown'} device=${data.model_info?.device ?? 'unknown'} image=${data.image_width}x${data.image_height}`,
    );

    return {
      usedSAM2: true,
      masks,
      imageWidth: data.image_width,
      imageHeight: data.image_height,
      processingTimeMs: data.processing_time_ms,
      modelInfo: data.model_info
        ? {
            modelId: data.model_info.model_id,
            device: data.model_info.device,
            cudaAvailable: data.model_info.cuda_available,
            inferenceResolution: data.model_info.inference_resolution,
          }
        : null,
      error: null,
    };
  } catch (error) {
    const elapsedMs = Date.now() - t0;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    console.warn(
      `[SAM2] Service call: FAILED${isTimeout ? ' (TIMEOUT)' : ''} in ${elapsedMs}ms — ${message}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Class hint mapping — SAM 2 class_hint → Pipeline B SegmentationClass
// ---------------------------------------------------------------------------

/** Maps SAM 2 heuristic class hints to Pipeline B SegmentationClass. */
const SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS: Record<
  string,
  import('../../types').SegmentationClass | null
> = {
  roof: 'roof',
  wall: 'wall',
  sky: 'sky',
  ground: 'ground',
  obstruction: 'obstruction',
  equipment: 'equipment',
  tree: 'tree', // SAM 2 doesn't produce this, but future fine-tuning might
  unknown: null,
};

/**
 * Map a SAM 2 class_hint to a Pipeline B SegmentationClass.
 * Returns null for unknown/unmapped classes.
 */
export function mapSAM2ClassHint(
  classHint: string,
): import('../../types').SegmentationClass | null {
  return SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS[classHint] ?? null;
}
