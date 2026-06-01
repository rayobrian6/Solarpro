/**
 * MiDaS Depth Estimation Client — HTTP client for the MiDaS/DPT Python service.
 *
 * Calls the depth estimation endpoint on the SAM2 service (which now also
 * hosts MiDaS) to perform real monocular depth estimation using Intel's
 * DPT-SwinV2-Tiny model. Falls back to the existing heuristic depth worker
 * if the service is unavailable or returns an error.
 *
 * Architecture:
 *   - POST /depth → returns base64-encoded float32 depth grid
 *   - GET /health → checks service readiness (reports depth_model_loaded)
 *   - Graceful degradation: any failure → return null, caller uses heuristic
 *   - Configurable via MIDAS_SERVICE_URL env var (defaults to SAM2_SERVICE_URL)
 *   - Timeout: 30s per image (CPU inference ~3-5s on Render Standard)
 *   - Retry with exponential backoff for 502/503 (cold start on Render)
 *
 * The depth endpoint is on the SAME service as SAM2 segmentation
 * (https://sam2-segmentation.onrender.com) — no separate deployment needed.
 * Both models (SAM2 + MiDaS) coexist in ~740MB RAM on Render Standard (4GB).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Request timeout for depth estimation. MiDaS CPU inference takes ~3-5s, much faster than SAM2. */
const MIDAS_TIMEOUT_MS = 30_000;

/**
 * Maximum retry attempts for 502/503 responses.
 * MiDaS is on the same service as SAM2, so cold starts are shared.
 * With 2 retries and backoff starting at 10s, total wait = 10+20 = 30s,
 * well within the pipeline timeout.
 */
const MIDAS_MAX_RETRIES = 2;

/** Initial backoff delay for retry after 502/503. */
const MIDAS_RETRY_BACKOFF_INITIAL_MS = 10_000;

/** Maximum backoff delay cap. */
const MIDAS_RETRY_BACKOFF_CAP_MS = 30_000;

/**
 * Read the depth service URL from the environment at call time.
 * Falls back to SAM2_SERVICE_URL since both endpoints are on the same service.
 * This function approach (not module-level constant) allows tests to override.
 */
function getMidasServiceURL(): string {
  return process.env.MIDAS_SERVICE_URL ?? process.env.SAM2_SERVICE_URL ?? '';
}

/** Whether MiDaS depth estimation is enabled. Read at call time. */
export function isMidasEnabled(): boolean {
  return getMidasServiceURL().length > 0;
}

// ---------------------------------------------------------------------------
// Response types (mirror Python Pydantic models)
// ---------------------------------------------------------------------------

interface MidasDepthResponse {
  success: boolean;
  depth_data: string; // base64-encoded float32 depth grid
  width: number;
  height: number;
  depth_metric: string; // "normalized_relative"
  image_width: number;
  image_height: number;
  processing_time_ms: number;
  model_info: {
    model_id: string;
    device: string;
    cuda_available: boolean;
    model_type: string;
    inference_resolution: string;
    output_resolution: string;
  };
  error?: string;
}

interface MidasHealthResponse {
  status: string;
  model_loaded: boolean;
  device: string;
  model_id: string;
  cuda_available: boolean;
  uptime_seconds: number;
  depth_model_loaded: boolean;
  depth_model_id: string;
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Result of a MiDaS depth estimation call. */
export interface MidasDepthResult {
  /** Whether the MiDaS service was used successfully. */
  usedMidas: boolean;
  /** Depth grid as Float32Array (row-major, width × height). */
  depthGrid: Float32Array;
  /** Grid width (columns). */
  width: number;
  /** Grid height (rows). */
  height: number;
  /** Depth metric type — always "normalized_relative" for MiDaS. */
  depthMetric: string;
  /** Original image width. */
  imageWidth: number;
  /** Original image height. */
  imageHeight: number;
  /** Processing time reported by the service (ms). */
  processingTimeMs: number;
  /** Model info from the service response. */
  modelInfo: {
    modelId: string;
    device: string;
    cudaAvailable: boolean;
    inferenceResolution: string;
    outputResolution: string;
  } | null;
  /** Error message if MiDaS failed (for logging, not user-facing). */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Health check (reuses SAM2 health endpoint with depth_model_loaded field)
// ---------------------------------------------------------------------------

/**
 * Check if the depth model is loaded on the service.
 * Returns the health response if the depth model is loaded, null otherwise.
 */
export async function checkMidasHealth(): Promise<MidasHealthResponse | null> {
  if (!isMidasEnabled()) return null;

  const serviceURL = getMidasServiceURL();
  console.info(`[MiDaS] Health check: GET ${serviceURL}/health (timeout=10s)`);

  try {
    const response = await fetch(`${serviceURL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[MiDaS] Health check: FAILED — HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as MidasHealthResponse;
    console.info(
      `[MiDaS] Health check: OK — depth_model_loaded=${data.depth_model_loaded} model_id=${data.depth_model_id} status=${data.status}`,
    );
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[MiDaS] Health check: FAILED — ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retry helper for 502/503 (same pattern as SAM2 client)
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number = MIDAS_MAX_RETRIES,
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      if (response.status === 502 || response.status === 503) {
        lastResponse = response;

        if (attempt < maxRetries) {
          const backoffMs = Math.min(
            MIDAS_RETRY_BACKOFF_INITIAL_MS * Math.pow(2, attempt),
            MIDAS_RETRY_BACKOFF_CAP_MS,
          );
          console.warn(
            `[MiDaS] HTTP ${response.status} on attempt ${attempt + 1}/${maxRetries + 1} — retrying in ${backoffMs / 1000}s`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        return response;
      }

      return response;
    } catch (error) {
      if (attempt < maxRetries) {
        const backoffMs = Math.min(
          MIDAS_RETRY_BACKOFF_INITIAL_MS * Math.pow(2, attempt),
          MIDAS_RETRY_BACKOFF_CAP_MS,
        );
        console.warn(
          `[MiDaS] Network error on attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)} — retrying in ${backoffMs / 1000}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      throw error;
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error('[MiDaS] fetchWithRetry: exhausted retries with no response');
}

// ---------------------------------------------------------------------------
// Main depth estimation call
// ---------------------------------------------------------------------------

/**
 * Estimate monocular depth from an image using the MiDaS/DPT service.
 *
 * Sends image bytes to the /depth endpoint, receives a base64-encoded
 * float32 depth grid, and decodes it into a Float32Array.
 *
 * MiDaS produces normalized relative inverse depth:
 *   - Higher values = closer to camera
 *   - Lower values = farther from camera
 *   - Values are in [0, 1] range (normalized)
 *   - NOT metric depth (not in meters) — relative ordering only
 *
 * Handles 502/503 from Render cold starts with automatic retry.
 *
 * Returns null if the service is unavailable or returns an error —
 * the caller should fall back to heuristic depth estimation.
 *
 * @param imageBytes - Raw image bytes (JPEG/PNG/WebP)
 * @param outputResolution - Depth grid resolution (default 64, matches heuristic worker)
 */
export async function estimateDepthWithMidas(
  imageBytes: Buffer,
  outputResolution: number = 64,
): Promise<MidasDepthResult | null> {
  if (!isMidasEnabled()) return null;

  const t0 = Date.now();
  const imageBytesSize = imageBytes.length;
  const serviceURL = getMidasServiceURL();
  console.info(
    `[MiDaS] Service call: POST ${serviceURL}/depth — imageSize=${imageBytesSize} bytes (${(imageBytesSize / 1024).toFixed(1)}KB) outputResolution=${outputResolution} timeout=${MIDAS_TIMEOUT_MS}ms`,
  );

  try {
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(imageBytes)]);
    formData.append('file', imageBlob, 'image.jpg');

    const url = new URL(`${serviceURL}/depth`);
    url.searchParams.set('output_resolution', String(outputResolution));

    const response = await fetchWithRetry(url.toString(), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(MIDAS_TIMEOUT_MS),
    });

    const fetchElapsedMs = Date.now() - t0;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      console.warn(
        `[MiDaS] Service call: FAILED — HTTP ${response.status} in ${fetchElapsedMs}ms — ${errorBody}`,
      );
      return null;
    }

    const data = (await response.json()) as MidasDepthResponse;

    if (!data.success || data.error) {
      const totalElapsedMs = Date.now() - t0;
      console.warn(
        `[MiDaS] Service call: FAILED — service error in ${totalElapsedMs}ms (service_processing=${data.processing_time_ms}ms) — ${data.error ?? 'unknown'}`,
      );
      return null;
    }

    // Decode base64 depth grid → Float32Array
    const depthGrid = decodeBase64ToFloat32(data.depth_data, data.width * data.height);

    const totalElapsedMs = Date.now() - t0;
    console.info(
      `[MiDaS] Service call: OK — ${data.width}x${data.height} depth grid in ${totalElapsedMs}ms (service_processing=${data.processing_time_ms}ms) — model=${data.model_info?.model_id ?? 'unknown'} device=${data.model_info?.device ?? 'unknown'} image=${data.image_width}x${data.image_height}`,
    );

    return {
      usedMidas: true,
      depthGrid,
      width: data.width,
      height: data.height,
      depthMetric: data.depth_metric,
      imageWidth: data.image_width,
      imageHeight: data.image_height,
      processingTimeMs: data.processing_time_ms,
      modelInfo: data.model_info
        ? {
            modelId: data.model_info.model_id,
            device: data.model_info.device,
            cudaAvailable: data.model_info.cuda_available,
            inferenceResolution: data.model_info.inference_resolution,
            outputResolution: data.model_info.output_resolution,
          }
        : null,
      error: null,
    };
  } catch (error) {
    const elapsedMs = Date.now() - t0;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    console.warn(
      `[MiDaS] Service call: FAILED${isTimeout ? ' (TIMEOUT)' : ''} in ${elapsedMs}ms — ${message}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Base64 decoding utility
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string to a Float32Array of the expected length.
 *
 * The Python service encodes depth grids as:
 *   arr.astype(np.float32).tobytes() → base64.b64encode() → string
 *
 * This reverses the process: base64 string → binary bytes → Float32Array.
 */
function decodeBase64ToFloat32(base64Str: string, expectedLength: number): Float32Array {
  // Decode base64 to binary string, then to Uint8Array
  const binaryString = atob(base64Str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Interpret as Float32Array
  const float32 = new Float32Array(bytes.buffer);

  if (float32.length !== expectedLength) {
    console.warn(
      `[MiDaS] Depth grid length mismatch: expected ${expectedLength}, got ${float32.length}`,
    );
  }

  return float32;
}
