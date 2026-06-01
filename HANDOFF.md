# HANDOFF — MiDaS Depth Upgrade (Stages 1–4 Complete + Visualization Utility)

**Date:** 2025-06-01  
**Branch:** `dev` (latest commit `af54a28`)  
**Render Deploy:** `dep-d8ee7e77f7vs73d36qt0` (LIVE)

---

## What Was Done

All four stages of the MiDaS/DPT depth estimation upgrade are **complete and verified**:

### Stage 1: Python `/depth` Endpoint ✅
- Added MiDaS/DPT depth model (`Intel/dpt-swinv2-tiny-256`) to the SAM2 Python service
- New POST `/depth` endpoint: accepts image, returns base64-encoded float32 depth grid
- Graceful loading: service still serves `/segment` even if MiDaS fails to load
- Config via env vars: `MIDAS_ENABLED`, `MIDAS_MODEL_ID`, `MIDAS_MAX_IMAGE_DIM`, `MIDAS_OUTPUT_RESOLUTION`
- File: `sam2-service/main.py` (heavily modified)

### Stage 2: Render Deployment ✅
- Both models (SAM2 + MiDaS) coexist in ~740MB RAM on Render Standard (4GB)
- Deploy `dep-d8ee7e77f7vs73d36qt0` is LIVE
- `/health` confirms: `model_loaded: true, depth_model_loaded: true`
- Render API used to set env vars (render.yaml does NOT update existing services)
- Auto-deploy is OFF — must manually trigger via Render API

### Stage 3: TypeScript Integration ✅
- New `midasClient.ts`: HTTP client for `/depth` endpoint with retry/backoff/graceful null
- Updated `runDepthWorker.ts`: MiDaS primary path, heuristic fallback
  - Worker is now `async` (network I/O)
  - Inverts MiDaS output via `1.0 - value` to match convention (high=far)
  - MiDaS confidence: 60+15+5=80 (vs heuristic 35+20+10=65)
  - Version bumped to `2.0.0-depth-midas`
  - `DepthWorkerInput.imageBytes?: Buffer` for MiDaS inference
  - `DepthWorkerOutput.usedMidas: boolean`
- Updated `runFullPipeline.ts`: depth stage uses `asyncStageTimer`
- All 6023 tests pass, 0 regressions

### Stage 4: End-to-End Verification ✅
- `/depth` on Render: 2.1s processing, correct depth ordering (sky≈0.0, ground≈0.99 raw)
- `/segment` on Render: 37s, 4 masks — no regression from MiDaS addition
- TypeScript base64 decode + inversion pipeline verified locally
- Full data path works: Python → base64 → HTTP → TypeScript decode → invert → DepthMap artifact

### Bonus: Depth Map Visualization Utility ✅
- New `depthMapDecode.ts`: decode, statistics, heatmap visualization pipeline
  - `decodeDepthMap(depthMap)`: base64 → Float32Array roundtrip
  - `computeDepthStats(grid)`: min/max/mean/median/p25/p75/nearZeroFraction/nearOneFraction
  - `depthGridToRGBA(grid, w, h, options)`: heatmap RGBA generation (inferno + viridis colormaps)
  - `rgbaToBase64PNG(rgba, w, h)`: minimal PNG encoder with CRC32 (Node.js server-side)
  - `depthMapToHeatmapDataURL(depthMap, options)`: one-stop DepthMap → PNG data URL (default 4x upscale)
- Barrel exports updated in `depth/index.ts`
- 27 tests in `depthMapDecode.test.ts` (all pass)
- Three-check suite: tsc 0, eslint 0 errors, vitest 6050 pass

### Bonus: Depth Quality Report Utility ✅
- New `depthQualityReport.ts`: structured quality assessment for depth data
  - `generateDepthQualityReport(depthMap, usedMidas, confidence)`: grade A-F across 5 dimensions
    - Range quality: is depth well-distributed?
    - Sky separation: is sky/ground bimodality clear?
    - Noise quality: are there artifacts or flat regions?
    - Confidence quality: is worker confidence high?
    - Coverage quality: are most pixels meaningful?
  - `isDepthUsableFor(report, purpose)`: quick check for plane_extraction, sky_detection, multi_view_fusion, visualization
  - Weighted scoring: confidence 25%, range 25%, sky 20%, noise 15%, coverage 15%
  - Recommendation engine: suggests MiDaS upgrade when heuristic produces poor quality
- Barrel exports updated in `depth/index.ts`
- 24 tests in `depthQualityReport.test.ts` (all pass)
- Three-check suite: tsc 0, eslint 0 errors, vitest 6074 pass

### Bonus: Depth Map LRU Cache ✅
- New `depthCache.ts`: in-memory LRU cache for DepthMap artifacts
  - `DepthCache` class with configurable `maxSize` (default 100) and `ttlMs` (default 30 min)
  - Keyed by `(fileId, modelVersion)` — same photo with different model = cache miss
  - Stats tracking: hits/misses/evictions/hitRate for monitoring
  - `purgeExpired()` for explicit TTL cleanup
  - Global singleton: `getGlobalDepthCache()` / `resetGlobalDepthCache()`
- Integrated into `runDepthFromReconstructionInput()`:
  - Checks cache before fetching image or calling MiDaS
  - Stores DepthMap artifacts after successful inference
  - Cache hit skips both image fetch AND MiDaS HTTP call
  - Added `afterEach(resetGlobalDepthCache)` to depth worker tests
- 33 tests in `depthCache.test.ts` covering LRU eviction, TTL, stats, singleton
- Three-check suite: tsc 0, eslint 0 errors, vitest 6107 pass

### Bonus: Depth-Aware Plane Extraction ✅
- New `depthPlaneExtraction.ts`: identifies roof planes from DepthMap artifacts
  - `extractDepthPlanes(depthMap, usedMidas, options)`: flood-fill segmentation + gradient analysis
  - Pipeline: compute gradient → detect edges → flood-fill segment → classify orientation → score confidence → merge similar → sort by area
  - Orientation classification: `'horizontal'` (ground), `'slanted'` (roof), `'vertical'` (wall), `'far'` (sky)
  - Confidence scoring: depth quality * 0.3 + area bonus + consistency bonus + MiDaS bonus + orientation bonus
  - Optional merging of adjacent planes with similar depth and same orientation
  - Uses depth gradient (central differences) for edge detection
  - Depth quality report integrated per-plane for downstream filtering
  - Authority envelope: review-only, non-authoritative
- Barrel exports updated in `depth/index.ts`
- 46 tests in `depthPlaneExtraction.test.ts` covering extraction, orientation, edges, segmentation, confidence, options, edge cases, integration, and 64x64 grids (all pass)
- Three-check suite: tsc 0, eslint 0 errors, vitest 6153 pass

---

## Architecture

```
Pipeline Stage 4: Depth Estimation
┌─────────────────────────────────────────────────┐
│ runDepthFromReconstructionInput()               │
│   for each sourcePhoto:                         │
│     fetchImageBytes(photo.fileUrl) ──→ Buffer   │
│     runDepthWorker({imageBytes, masks, vps})    │
│       │                                         │
│       ├─ MiDaS path (if enabled + bytes):       │
│       │   estimateDepthWithMidas(bytes, 64)      │
│       │     → POST /depth (midasClient.ts)      │
│       │     → decode base64 → Float32Array       │
│       │     → invertMidasDepth(): 1.0 - value   │
│       │     → confidence: 60-80%                │
│       │                                         │
│       └─ Heuristic fallback (otherwise):        │
│           generateDepthGrid(64, masks, vps)     │
│           → class priors + gradient + VP correct │
│           → confidence: 35-65%                  │
│                                                 │
│     → DepthMap artifact (base64 encoded)        │
└─────────────────────────────────────────────────┘
```

### Depth Convention (CRITICAL — both paths consistent)
- **Higher values = farther from camera** (sky ≈ 0.9–1.0, ground ≈ 0.01–0.15)
- **Lower values = closer to camera**
- MiDaS raw output is inverse depth (high=near) → inverted via `1.0 - value`
- Heuristic was already in this convention (sky=0.9, ground=0.15)
- Downstream consumers see the same ordering regardless of source

---

## Key Files

| File | Role | Changed? |
|------|------|----------|
| `sam2-service/main.py` | Python service: `/segment` + `/depth` endpoints | Yes (Stage 1) |
| `sam2-service/Dockerfile` | Added `transformers>=4.37.0` pip install | Yes (Stage 1) |
| `sam2-service/render.yaml` | MiDaS env vars (reference only — use API for actual) | Yes (Stage 1) |
| `lib/.../workers/depth/midasClient.ts` | HTTP client for `/depth` endpoint | **NEW** (Stage 3) |
| `lib/.../workers/depth/depthMapDecode.ts` | Decode, stats, heatmap visualization | **NEW** (Bonus) |
| `lib/.../workers/depth/depthQualityReport.ts` | Quality assessment (grade A-F) + usability checks | **NEW** (Bonus) |
| `lib/.../workers/depth/depthCache.ts` | LRU cache with TTL + stats | **NEW** (Bonus) |
| `lib/.../workers/depth/depthPlaneExtraction.ts` | Flood-fill plane extraction + orientation classification | **NEW** (Bonus) |
| `lib/.../workers/depth/runDepthWorker.ts` | Depth worker: MiDaS primary, heuristic fallback + cache | Yes (Stage 3+Bonus) |
| `lib/.../workers/depth/index.ts` | Barrel exports including midasClient + depthMapDecode | Yes (Stage 3+Bonus) |
| `lib/.../runFullPipeline.ts` | Pipeline: depth stage uses asyncStageTimer | Yes (Stage 3) |
| `__tests__/depthWorker.test.ts` | Tests updated for async worker | Yes (Stage 3) |
| `__tests__/depthMapDecode.test.ts` | Tests for decode/stats/heatmap/PNG | **NEW** (Bonus) |
| `__tests__/depthQualityReport.test.ts` | Tests for quality report + usability | **NEW** (Bonus) |
| `__tests__/depthCache.test.ts` | Tests for LRU cache + TTL + stats | **NEW** (Bonus) |
| `__tests__/depthPlaneExtraction.test.ts` | Tests for plane extraction (46 tests) | **NEW** (Bonus) |

---

## Environment Variables

### Render Service (set via API, NOT render.yaml)
| Variable | Value | Notes |
|----------|-------|-------|
| `MIDAS_ENABLED` | `true` | Set to `false` to disable MiDaS |
| `MIDAS_MODEL_ID` | `Intel/dpt-swinv2-tiny-256` | HuggingFace model ID |
| `MIDAS_MAX_IMAGE_DIM` | `256` | Max input dimension (resize before inference) |
| `MIDAS_OUTPUT_RESOLUTION` | `64` | Depth grid resolution (matches heuristic) |
| `SAM2_SERVICE_URL` | (set) | Used by TS midasClient as fallback URL |

### TypeScript (Next.js / Vercel)
| Variable | Value | Notes |
|----------|-------|-------|
| `MIDAS_SERVICE_URL` | `https://sam2-segmentation.onrender.com` | Primary URL for MiDaS client |
| `SAM2_SERVICE_URL` | `https://sam2-segmentation.onrender.com` | Fallback if MIDAS_SERVICE_URL unset |

**If `MIDAS_SERVICE_URL` (or `SAM2_SERVICE_URL`) is not set, the depth worker silently falls back to heuristic — no error, no crash.**

---

## Render Service Details

- **Service ID:** `srv-d8djpc3bc2fs73emup10`
- **URL:** `https://sam2-segmentation.onrender.com`
- **API Key:** `rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz`
- **Plan:** Standard (~4GB RAM, CPU-only)
- **Auto-deploy:** OFF
- **Current deploy:** `dep-d8ee7e77f7vs73d36qt0`

### Triggering a New Deploy
```bash
curl -X POST "https://api.render.com/v1/services/srv-d8djpc3bc2fs73emup10/deploys" \
  -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
  -H "Content-Type: application/json" \
  -d '{"clearBuildCache": false}'
```

### Setting Env Vars via API
```bash
# PUT to update env var — render.yaml does NOT update existing services!
curl -X PUT "https://api.render.com/v1/services/srv-d8djpc3bc2fs73emup10/env-vars" \
  -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
  -H "Content-Type: application/json" \
  -d '{"envVar": {"key": "MIDAS_ENABLED", "value": "true"}}'
```

---

## Known Issues & Gotchas

1. **Render cold starts**: First request after idle takes 30-60s. Both `/depth` and `/segment` are affected. The midasClient has retry with backoff (2 retries, 10-30s backoff).

2. **MiDaS is CPU-only on Render**: ~2-5s inference per image. Not a bottleneck (SAM2 takes 35-40s).

3. **Depth is NOT metric**: MiDaS produces normalized relative inverse depth. Values are in [0,1] and represent ordering only, not distance in meters.

4. **Image fetch for MiDaS**: `runDepthFromReconstructionInput` fetches image bytes from `photo.fileUrl` with a 15s timeout. If the fetch fails, it falls back to heuristic. The URL must be publicly accessible or the fetch will fail.

5. **render.yaml env vars don't update existing services**: Must use Render API PUT endpoint. This is a Render platform behavior, not a bug in our code.

6. **Depth convention**: Higher values = farther. MiDaS raw output is inverted. If you ever change the model or the convention, check `invertMidasDepth()` in `runDepthWorker.ts`.

7. **Plane extraction integration pending**: The `depthPlaneExtraction.ts` utility now provides depth-aware plane detection, but the downstream `runPlaneExtractionWorker.ts` still uses the heuristic approach. Integration is the natural next step — replace or augment the heuristic with `extractDepthPlanes()` output.

8. **Sandbox disk full**: The workspace hit 100% disk during this session. `sam2-service/__pycache__/` is untracked and can be cleaned. Large model downloads are the main culprit.

---

## Next Steps (Recommended Priority Order)

1. **Set `MIDAS_SERVICE_URL` in the Next.js/Vercel environment** — This activates the MiDaS path in production. Without it, the depth worker stays on heuristic.

2. **Upgrade plane extraction to consume DepthMap data** ✅ Backend utility done — `depthPlaneExtraction.ts` provides `extractDepthPlanes()` which uses flood-fill segmentation, gradient edge detection, and orientation classification. Next step would be integrating this into `runPlaneExtractionWorker.ts` to replace or augment the existing heuristic approach.

3. **Depth map visualization UI component** ✅ Backend utility done — `depthMapDecode.ts` provides `depthMapToHeatmapDataURL()` which produces a PNG data URL. Next step is a React component that renders the heatmap overlay on the source photo (see `DepthHeatmapOverlay` sketch below).

4. **Larger MiDaS model** — `Intel/dpt-swinv2-tiny-256` is 41MB. The `Intel/dpt-swinv2-large-256` (213MB) would give better accuracy but may push RAM usage over limits on Render Standard. Test on Render Pro first.

5. **Depth map caching** ✅ Backend cache done — `depthCache.ts` provides LRU with TTL. Next step would be persistent storage (Redis/SQLite) for cross-process persistence, but the in-memory cache already avoids redundant MiDaS calls within a pipeline run.

6. **Multi-view depth consistency** — When multiple photos overlap, fuse their depth maps using the existing multi-view fusion stage. This is a natural extension of the pipeline architecture.

### depthMapDecode API Quick Reference

```typescript
import {
  decodeDepthMap,            // DepthMap → Float32Array
  computeDepthStats,         // Float32Array → DepthStatistics
  depthGridToRGBA,           // Float32Array → Uint8ClampedArray (RGBA heatmap)
  rgbaToBase64PNG,           // RGBA → base64 PNG data URL (Node.js only)
  depthMapToHeatmapDataURL,  // DepthMap → PNG data URL (one-stop)
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';

// Example: produce a heatmap overlay from a DepthMap artifact
const dataURL = depthMapToHeatmapDataURL(depthMap, {
  colormap: 'inferno',  // or 'viridis'
  alpha: 180,           // transparency (0-255)
  scale: 4,             // upscale factor (64→256px default)
  normalize: true,      // normalize to [0,1] before coloring
});
// Use as <img src={dataURL} /> or CSS background
```

### depthQualityReport API Quick Reference

```typescript
import {
  generateDepthQualityReport,  // DepthMap → DepthQualityReport (grade A-F)
  isDepthUsableFor,            // (report, purpose) → boolean
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';

// Example: assess depth quality
const report = generateDepthQualityReport(depthMap, true, 75);
console.log(report.grade);     // 'A' | 'B' | 'C' | 'D' | 'F'
console.log(report.score);     // 0-100
console.log(report.summary);   // Human-readable description
console.log(report.recommendations); // String[] of actionable suggestions

// Example: check if depth is usable for plane extraction
if (isDepthUsableFor(report, 'plane_extraction')) {
  // Safe to use depth for roof plane identification
}
```

### depthCache API Quick Reference

```typescript
import {
  DepthCache,
  getGlobalDepthCache,
  resetGlobalDepthCache,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';

// Use the global singleton (recommended)
const cache = getGlobalDepthCache();

// Or create a custom instance
const customCache = new DepthCache({ maxSize: 50, ttlMs: 600_000 }); // 10 min TTL

// Cache stats
console.log(cache.getStats());
// { size: 3, maxSize: 100, hits: 12, misses: 5, evictions: 0, hitRate: 0.706 }

// The cache is automatically used by runDepthFromReconstructionInput()
// — cache hits skip both image fetch and MiDaS inference
```

### depthPlaneExtraction API Quick Reference

```typescript
import {
  extractDepthPlanes,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';

import type {
  DepthPlaneCandidate,
  DepthPlaneOptions,
  DepthPlaneExtractionResult,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';

// Example: extract roof planes from a DepthMap
const result = extractDepthPlanes(depthMap, usedMidas, {
  depthThreshold: 0.12,   // flood-fill similarity (default 0.12)
  minAreaFraction: 0.02,  // minimum 2% of image (default 0.02)
  maxPlanes: 10,           // cap on results (default 10)
  mergeSimilar: 0.08,     // merge planes within 0.08 depth (default 0.08)
});

// Result structure
result.planes;          // DepthPlaneCandidate[], sorted by area (largest first)
result.edgeCount;       // number of depth discontinuity pixels
result.qualityReport;   // DepthQualityReport for the input depth
result.stats;           // DepthStatistics for the input depth
result.authority;       // { reviewOnly: true, ... }

// Each plane candidate
const plane = result.planes[0];
plane.id;                  // 'depth-plane-0'
plane.label;               // 'roof_plane_1' | 'sky_2' | 'ground_3' | 'wall_4'
plane.orientation;         // 'slanted' | 'far' | 'horizontal' | 'vertical'
plane.areaFraction;        // fraction of total pixels
plane.meanDepth;           // average depth value
plane.depthStdDev;         // depth consistency
plane.gradientMagnitude;   // steepness proxy
plane.confidence;          // 0-100
plane.bounds;              // { xMin, yMin, xMax, yMax } in [0,1]
plane.boundaryPolygon;    // NormalizedPoint[] in normalized_image_0_1000
plane.depthQuality;        // DepthQualityReport
```

### DepthStatistics Shape
```typescript
interface DepthStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;           // 25th percentile
  p75: number;           // 75th percentile
  nearZeroFraction: number;  // fraction < 0.05 (likely sky in MiDaS raw)
  nearOneFraction: number;   // fraction > 0.95 (likely sky in our convention)
  totalPixels: number;
}
```

---

## Render Health Check Fix (Session 2)

### Problem
Render's platform health check has a **5-second timeout** on `/health`. During SAM2 CPU inference (35-40s), the synchronous `amg.generate()` call blocked the FastAPI async event loop, making `/health` unresponsive. Render marked instances as `unhealthy` → `server_failed` events → instance restarts → 503/504 errors for clients.

Multiple `server_failed` events observed in Render API:
- `HTTP health check failed (timed out after 5 seconds)`
- `connection refused` (during instance restart)

### Fix
1. **ThreadPoolExecutor** for SAM2 and MiDaS inference — `amg.generate()` and `midas_pipe()` now run in a thread pool via `loop.run_in_executor()`, keeping the event loop responsive for health checks.
2. **Inference tracking** — `_inference_active` / `_inference_type` globals track whether inference is running. The `/health` endpoint reports these so monitoring distinguishes "busy but healthy" from "actually broken".
3. **Health status "busy"** — When inference is active, `/health` returns `status: "busy"` (not "ready") with `inference_active: true` and `inference_type: "segment"|"depth"`.
4. **Dockerfile HEALTHCHECK** — Updated to `timeout=15s` (from 10s), `retries=5` (from 3), and inner `urlopen timeout=10` for more resilience during model loading.

### Key Changes
- `sam2-service/main.py`: Added `import asyncio`, `ThreadPoolExecutor`, inference tracking globals, `run_in_executor()` in both `/segment` and `/depth`, updated `/health` response model and handler.
- `sam2-service/Dockerfile`: HEALTHCHECK timeout 10s→15s, retries 3→5, inner timeout 10s.

### Health Response Shape (Updated)
```json
{
  "status": "ready" | "loading" | "ready_depth_loading" | "busy",
  "model_loaded": true,
  "device": "cpu",
  "model_id": "facebook/sam2.1-hiera-tiny",
  "cuda_available": false,
  "uptime_seconds": 1234.5,
  "depth_model_loaded": true,
  "depth_model_id": "Intel/dpt-swinv2-tiny-256",
  "inference_active": false,
  "inference_type": ""
}
```

When `inference_active` is `true`, `status` will be `"busy"` and `inference_type` will be `"segment"` or `"depth"`.

---

## Standing Rules

- **Never push to master** — always dev
- **Three-check suite before every push**: `tsc --noEmit`, `eslint`, `vitest run`
- **Push with x-access-token**: `git push https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git`
- **No feature branches** — work directly on dev
- **All artifacts are REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY**

---

*End of handoff document. Stages 1–4 + health check fix complete. Ready for next session.*
