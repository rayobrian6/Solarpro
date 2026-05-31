/**
 * SAM 2 Segmentation Client — HTTP client for the SAM 2 Python service.
 *
 * Calls the SAM 2 FastAPI service (deployed on Render) to perform
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
 *   - Retry with exponential backoff for 502/503 (cold start on Render)
 *   - Poll-based warm-up: waits for model_loaded=true before proceeding
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
 * Maximum number of retry attempts for 502/503 responses.
 * Render returns 502 while the SAM2 service is cold-starting (model download + load).
 * With 4 retries and exponential backoff starting at 15s, total wait = 15+30+60+120 = 225s,
 * which fits within the 300s Vercel function maxDuration.
 */
const SAM2_MAX_RETRIES = 4;

/** Initial backoff delay in milliseconds for retry after 502/503. */
const SAM2_RETRY_BACKOFF_INITIAL_MS = 15_000;

/** Maximum backoff delay cap in milliseconds. */
const SAM2_RETRY_BACKOFF_CAP_MS = 120_000;

/**
 * How long to poll /health waiting for model_loaded=true.
 * Set to 180s to allow for full model download + load on Render cold start.
 */
const SAM2_WARMUP_POLL_TIMEOUT_MS = 180_000;

/** Interval between /health polls while waiting for warm-up. */
const SAM2_WARMUP_POLL_INTERVAL_MS = 5_000;

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
  /** Model info from the service response. */
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
  console.info(`[SAM2] Health check: GET ${serviceURL}/health (timeout=10s)`);

  try {
    const response = await fetch(`${serviceURL}/health`, {
      signal: AbortSignal.timeout(10_000),
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
// Warm-up: poll /health until model is loaded (BLOCKING, with timeout)
// ---------------------------------------------------------------------------

/**
 * Wait for the SAM 2 service to finish loading its model.
 *
 * On Render cold starts, the SAM 2 service must download the model from
 * HuggingFace and load it into memory. During this time, ALL requests
 * (including /segment) return 502 Bad Gateway from Render's proxy.
 *
 * This function polls the /health endpoint until model_loaded=true,
 * giving the service time to finish loading. It is designed to be called
 * BEFORE the segmentation loop starts, so that the model is warm when
 * the real requests arrive.
 *
 * @returns HealthResponse if model is loaded, null if timeout or unreachable
 */
export async function waitForSAM2Warm(
  deadlineOverride?: number,
): Promise<SAM2HealthResponse | null> {
  if (!isSAM2Enabled()) return null;

  const serviceURL = getSAM2ServiceURL();
  // Use the caller-provided deadline if given, otherwise fall back to the default timeout
  const deadline = deadlineOverride ?? (Date.now() + SAM2_WARMUP_POLL_TIMEOUT_MS);
  const effectiveTimeoutMs = deadline - Date.now();
  let attempt = 0;

  console.info(
    `[SAM2] Warm-up: polling /health until model_loaded=true (timeout=${Math.max(0, Math.round(effectiveTimeoutMs / 1000))}s, interval=${SAM2_WARMUP_POLL_INTERVAL_MS / 1000}s)`,
  );

  while (Date.now() < deadline) {
    attempt++;

    try {
      const response = await fetch(`${serviceURL}/health`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const data = (await response.json()) as SAM2HealthResponse;

        if (data.model_loaded) {
          const elapsedMs = SAM2_WARMUP_POLL_TIMEOUT_MS - (deadline - Date.now());
          console.info(
            `[SAM2] Warm-up: model LOADED after ${attempt} polls (~${elapsedMs / 1000}s) — model_id=${data.model_id} device=${data.device} uptime=${data.uptime_seconds}s`,
          );
          return data;
        }

        console.info(
          `[SAM2] Warm-up: poll #${attempt} — service reachable but model_loaded=false (status=${data.status}), waiting...`,
        );
      } else {
        // 502/503 — Render proxy can't reach the service yet (cold start)
        console.info(
          `[SAM2] Warm-up: poll #${attempt} — HTTP ${response.status} (service still starting), waiting...`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.info(
        `[SAM2] Warm-up: poll #${attempt} — unreachable (${message}), waiting...`,
      );
    }

    // Wait before next poll
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const sleepMs = Math.min(SAM2_WARMUP_POLL_INTERVAL_MS, remainingMs);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  const totalWaitMs = effectiveTimeoutMs;
  console.warn(
    `[SAM2] Warm-up: TIMEOUT after ${attempt} polls over ${totalWaitMs / 1000}s — model NOT loaded, SAM 2 will likely fail`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// Fire-and-forget warm-up (triggers model loading on cold start)
// ---------------------------------------------------------------------------

/**
 * Send a non-blocking warm-up request to the SAM 2 service.
 *
 * On Render cold starts, the SAM 2 model must be downloaded from HuggingFace
 * and loaded into memory. A health check alone does NOT trigger model loading.
 * By sending a tiny 1x1 white PNG to the /segment endpoint, we force the
 * model to start loading immediately.
 *
 * This function is intentionally fire-and-forget (returns void, not Promise).
 * Call it as early as possible in the API route handler — the model will be
 * loading in the background while auth/validation/DB queries run.
 *
 * NOTE: This is a SUPPLEMENT to waitForSAM2Warm(), which polls /health.
 * The warm-up ping triggers model loading; waitForSAM2Warm() confirms it's ready.
 * Use both: call warmupSAM2Service() early, then waitForSAM2Warm() before
 * the segmentation loop.
 */
export function warmupSAM2Service(): void {
  if (!isSAM2Enabled()) return;

  const serviceURL = getSAM2ServiceURL();

  // Send a tiny 1x1 PNG to /segment to trigger model loading.
  // This is fire-and-forget — the response (or 502) is logged but not awaited.
  const t0 = Date.now();
  console.info(`[SAM2] Warm-up ping: sending tiny image to /segment to trigger model loading`);

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
  url.searchParams.set('min_area_fraction', '0.5'); // Max allowed by Pydantic (le=0.5), rejects tiny masks
  url.searchParams.set('max_masks', '1');            // Minimize processing

  // Fire-and-forget: we don't await this, and we handle 502 gracefully
  fetch(url.toString(), {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120_000), // Allow up to 2min for cold start
  })
    .then((response) => {
      const elapsedMs = Date.now() - t0;
      if (response.ok) {
        console.info(`[SAM2] Warm-up ping: complete in ${elapsedMs}ms — model should be loaded now`);
      } else {
        // 502 is expected during cold start — the request still triggered model loading
        console.info(
          `[SAM2] Warm-up ping: HTTP ${response.status} in ${elapsedMs}ms — ` +
          (response.status === 502 || response.status === 503
            ? 'expected during cold start, model loading triggered'
            : 'unexpected error'),
        );
      }
    })
    .catch((error) => {
      const elapsedMs = Date.now() - t0;
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
      console.info(
        `[SAM2] Warm-up ping: ${isTimeout ? 'TIMEOUT' : 'FAILED'} in ${elapsedMs}ms — ` +
        'model loading may still be in progress on server',
      );
    });
}

// ---------------------------------------------------------------------------
// Retry helper for 502/503 (Render cold start)
// ---------------------------------------------------------------------------

/**
 * Fetch with retry for 502/503 responses.
 *
 * On Render, when the SAM2 service is cold-starting, the Render proxy
 * returns 502 Bad Gateway for ALL requests until the service is ready.
 * This function retries with exponential backoff when it encounters 502/503,
 * giving the service time to finish loading.
 *
 * @param url - URL to fetch
 * @param init - Fetch init options
 * @param maxRetries - Maximum retry attempts (default: SAM2_MAX_RETRIES)
 * @returns The fetch Response (possibly after retries), or throws on non-retryable errors
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number = SAM2_MAX_RETRIES,
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // If response is OK or a client error (4xx), return immediately
      // Only retry on 502 (Bad Gateway) and 503 (Service Unavailable)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // 502/503 — likely cold start, retry with backoff
      if (response.status === 502 || response.status === 503) {
        lastResponse = response;

        if (attempt < maxRetries) {
          const backoffMs = Math.min(
            SAM2_RETRY_BACKOFF_INITIAL_MS * Math.pow(2, attempt),
            SAM2_RETRY_BACKOFF_CAP_MS,
          );
          const totalRetriesRemaining = maxRetries - attempt;
          console.warn(
            `[SAM2] HTTP ${response.status} on attempt ${attempt + 1}/${maxRetries + 1} — ` +
            `retrying in ${backoffMs / 1000}s (${totalRetriesRemaining} retries remaining)`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Final attempt failed — return the 502/503 response
        console.warn(
          `[SAM2] HTTP ${response.status} on FINAL attempt ${attempt + 1}/${maxRetries + 1} — giving up`,
        );
        return response;
      }

      // Other 5xx errors — don't retry
      return response;

    } catch (error) {
      // Network-level error (not a response) — could be DNS, timeout, etc.
      // Retry once for transient network issues
      if (attempt < maxRetries) {
        const backoffMs = Math.min(
          SAM2_RETRY_BACKOFF_INITIAL_MS * Math.pow(2, attempt),
          SAM2_RETRY_BACKOFF_CAP_MS,
        );
        console.warn(
          `[SAM2] Network error on attempt ${attempt + 1}/${maxRetries + 1}: ${error instanceof Error ? error.message : String(error)} — ` +
          `retrying in ${backoffMs / 1000}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      throw error;
    }
  }

  // Should not reach here, but just in case
  if (lastResponse) return lastResponse;
  throw new Error('[SAM2] fetchWithRetry: exhausted retries with no response');
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
 * Handles 502/503 from Render cold starts with automatic retry
 * using exponential backoff (up to 4 retries, ~225s total wait).
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
    `[SAM2] Service call: POST ${serviceURL}/segment — imageSize=${imageBytesSize} bytes (${(imageBytesSize / 1024).toFixed(1)}KB) minAreaFraction=${minAreaFraction} maxMasks=${maxMasks} timeout=${SAM2_TIMEOUT_MS}ms maxRetries=${SAM2_MAX_RETRIES}`,
  );

  try {
    // Create form data with the image
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(imageBytes)]);
    formData.append('file', imageBlob, 'image.jpg');

    const url = new URL(`${serviceURL}/segment`);
    url.searchParams.set('min_area_fraction', String(minAreaFraction));
    url.searchParams.set('max_masks', String(maxMasks));
    url.searchParams.set('roof_only', 'true'); // Filter out sky/ground/tree masks on the Python side

    // Use fetchWithRetry to handle 502/503 from Render cold start
    const response = await fetchWithRetry(url.toString(), {
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

/**
 * Roof-relevant segmentation classes — masks with these class hints are
 * useful for geometry reconstruction. All other classes (sky, ground, tree)
 * are filtered out when roof_only=true (the default on the Python side).
 *
 * This set is also used on the TypeScript side to double-filter: even if
 * the Python service returns a non-roof mask (e.g. due to a stale deploy),
 * the worker will drop it here.
 */
export const ROOF_RELEVANT_SEGMENTATION_CLASSES: ReadonlySet<import('../../types').SegmentationClass> =
  new Set(['roof', 'wall', 'obstruction', 'equipment'] as const);

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
  tree: 'tree', // Vegetation detected by green ratio + position heuristic
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
