# HANDOFF — MiDaS Depth Upgrade + Photogrammetry + Polygon Fidelity (Stages 1–7 Complete)

**Date:** 2025-06-04  
**Branch:** `dev` (latest commit `4eac403`)  
**Render Deploy:** LIVE with v2.2.0 (polygon fidelity fix + SAM2 small model)

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

### Stage 5: Depth-Augmented Plane Extraction Integration ✅
- **`runPlaneExtractionWorker.ts`** refactored to v2.0.0-plane-extraction-depth
  - Two code paths in main worker:
    1. **Depth-augmented path** (when `depthMaps` array provided in input):
       - Calls `extractDepthPlanes()` for each DepthMap
       - Maps `DepthPlaneCandidate` to `RoofPlaneCandidate` (orientation='slanted') or `WallPlaneCandidate` (orientation='vertical')
       - Parameter estimation helpers: `estimateDepthRoofParameters()` (slope, aspect, normal from gradient + bounds center) and `estimateDepthWallParameters()` (height, facing, normal from vertical extent + horizontal position)
       - Confidence blending: `blendConfidence()` — 70/30 depth/heuristic with MiDaS, 50/50 without
       - Overlap detection: `depthPlaneOverlapsMask()` — AABB overlap test between depth plane bounds [0,1] and mask.maskBounds [0,1000]
       - Tracks `processedMaskIds` to avoid duplicating candidates already covered by depth
    2. **Heuristic-only path** (no depth maps): extracted into `runHeuristicExtraction()` helper — identical logic to original worker
  - Fallback: heuristic masks not covered by any depth plane still become candidates
  - Added `PLANE_EXTRACTION_LIMITATIONS_DEPTH` (separate from heuristic limitations)
  - `PlaneExtractionWorkerInput` expanded with optional `depthMaps?`, `usedMidas?`, `config?` fields
  - `runPlaneExtractionFromReconstructionInput()` updated with optional `depthMaps?` and `usedMidas?` parameters
- **`runFullPipeline.ts`** Stage 5 updated
  - Extracts `depthMaps` from depth artifacts after Stage 4
  - Determines `usedMidas` flag from depth map confidence levels
  - Passes both to `runPlaneExtractionFromReconstructionInput()`
- **`planeExtractionWorker.test.ts`** — 2 existing tests fixed + 9 new depth-specific tests
  - Fixed: limitations test (flexible check for 'heuristic'/'flood-fill'/'depth gradient')
  - Fixed: stage timings test (checks for 'heuristic_extraction' or 'depth_extraction')
  - New: depth-augmented path activation, artifact types, roof slope/aspect, wall height/facing, depth-specific limitations, heuristic blending, fallback for unprocessed masks, heuristic-only path still works, minConfidence in depth path, usedMidas confidence blending
- Three-check suite: tsc 0, eslint 0 errors, vitest 6163 pass

### Stage 6: Runtime Bug Fixes — 504 Timeout + Artifact Accumulation ✅
Three critical fixes for the 504 timeout and runtime issues reported by the user:

1. **ARTIFACT ACCUMULATION FIX**: The \`site_survey_geometry_reconstruction_artifacts\` table was never cleaned between pipeline runs, causing 142 depth maps from only 2 photos (old artifacts accumulated across runs while the \`unified_geometry_artifacts\` table WAS cleaned).
   - Added \`deleteArtifactsBySurvey()\` in \`lib/db/geometryReconstruction.ts\` — deletes all old reconstruction artifacts for a survey before persisting new ones
   - Called in the start route before batch insert: \`const deletedReconCount = await deleteArtifactsBySurvey(surveyId)\`

2. **BATCH DB INSERT**: Replaced one-by-one \`insertReconstructionArtifact()\` loop with \`insertReconstructionArtifactsBatch()\` using PostgreSQL \`UNNEST\`. This reduces DB round-trips from ~328 (164 artifacts × 2 queries each: auth check + insert) to ~3 (1 auth + 1 delete + 1 batch insert). Estimated savings: 30-60s per pipeline run.
   - New function in \`lib/db/geometryReconstruction.ts\`: builds parallel arrays for job_id, survey_id, file_id, etc. and inserts via \`SELECT * FROM unnest(...)\` 
   - Fallback: if batch insert fails, falls back to single inserts for resilience
   - The mock pipeline path still uses single inserts (only a handful of artifacts, not a bottleneck)

3. **DEPTH-AUGMENTED LOGGING**: Added comprehensive logging to the plane extraction worker and start route to verify the depth path is executing and to debug 504 timeouts:
   - Start route: per-stage timing summary in logs (\`segmentation=37200ms(4 artifacts), line_extraction=12ms(16 artifacts), ...\`)
   - Start route: batch insert timing (\`Batch inserted 164/164 reconstruction artifacts in 2.3s\`)
   - Start route: unified table adaptation timing
   - Plane extraction: entry log showing roofMasks, wallMasks, hasDepthMaps, depthMapCount, usedMidas
   - Plane extraction: per depth-map processing log with fileId, dimensions, confidence
   - Plane extraction: per depth-map extraction result (slanted/vertical/far/horizontal counts)
   - Plane extraction: depth-augmented path summary with total depth-derived planes and timing
   - Plane extraction: final worker summary with roof/wall counts and all stage timings
   - Safety cap: max 10 depth maps processed (protects against future N-photo runs)

- Three-check suite: tsc 0, eslint 0 errors, vitest 6163 pass
- Commit: \`b4a03e8\` pushed to dev

---

## Architecture

```
Pipeline Stage 4: Depth Estimation
┌──────────────────────────────────────────────────────┐
│ runDepthFromReconstructionInput()                     │
│   for each sourcePhoto:                               │
│     fetchImageBytes(photo.fileUrl) ──→ Buffer         │
│     runDepthWorker({imageBytes, masks, vps})          │
│       │                                               │
│       ├─ MiDaS path (if enabled + bytes):             │
│       │   estimateDepthWithMidas(bytes, 64)           │
│       │     → POST /depth (midasClient.ts)            │
│       │     → decode base64 → Float32Array            │
│       │     → invertMidasDepth(): 1.0 - value        │
│       │     → confidence: 60-80%                      │
│       │                                               │
│       └─ Heuristic fallback (otherwise):              │
│           generateDepthGrid(64, masks, vps)           │
│           → class priors + gradient + VP correct      │
│           → confidence: 35-65%                        │
│                                                       │
│     → DepthMap artifact (base64 encoded)              │
└──────────────────────────────────────────────────────┘

Pipeline Stage 5: Plane Extraction (depth-augmented)
┌──────────────────────────────────────────────────────┐
│ runPlaneExtractionFromReconstructionInput(            │
│   input, masks, lines, vps, depthMaps?, usedMidas?   │
│ )                                                     │
│   if depthMaps provided:                              │
│     for each depthMap:                                │
│       extractDepthPlanes(depthMap, usedMidas)         │
│       for each DepthPlaneCandidate:                   │
│         orientation='slanted' → RoofPlaneCandidate    │
│           estimateDepthRoofParameters(slope,aspect,n) │
│         orientation='vertical' → WallPlaneCandidate   │
│           estimateDepthWallParameters(height,facing,n)│
│         blend with overlapping heuristic mask:        │
│           MiDaS: 70% depth + 30% heuristic           │
│           non-MiDaS: 50% depth + 50% heuristic        │
│     unprocessed heuristic masks → fallback candidates │
│   else:                                               │
│     runHeuristicExtraction() (original path)          │
└──────────────────────────────────────────────────────┘
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
| `lib/.../runFullPipeline.ts` | Pipeline: depth stage uses asyncStageTimer; Stage 5 passes depthMaps+usedMidas | Yes (Stage 3+5) |
| `__tests__/depthWorker.test.ts` | Tests updated for async worker | Yes (Stage 3) |
| `__tests__/depthMapDecode.test.ts` | Tests for decode/stats/heatmap/PNG | **NEW** (Bonus) |
| `__tests__/depthQualityReport.test.ts` | Tests for quality report + usability | **NEW** (Bonus) |
| `__tests__/depthCache.test.ts` | Tests for LRU cache + TTL + stats | **NEW** (Bonus) |
| `__tests__/depthPlaneExtraction.test.ts` | Tests for plane extraction (46 tests) | **NEW** (Bonus) |
| `lib/.../workers/planeExtraction/runPlaneExtractionWorker.ts` | Plane extraction: depth-augmented + heuristic fallback | Yes (Stage 5) |
| `__tests__/planeExtractionWorker.test.ts` | Tests for plane extraction worker (2 fixed + 9 new) | Yes (Stage 5) |

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

7. **Plane extraction now depth-augmented** (completed this session): `runPlaneExtractionWorker.ts` v2.0.0 integrates `extractDepthPlanes()` when DepthMap artifacts are available. Two code paths: depth-augmented (primary) and heuristic-only (fallback). Confidence blending: 70/30 depth/heuristic with MiDaS, 50/50 without. Heuristic masks not covered by depth planes still pass through as fallback candidates.

8. **Sandbox disk full**: The workspace hit 100% disk during this session. `sam2-service/__pycache__/` is untracked and can be cleaned. Large model downloads are the main culprit.

---

## Next Steps (Recommended Priority Order)

1. **Set `MIDAS_SERVICE_URL` in the Next.js/Vercel environment** — This activates the MiDaS path in production. Without it, the depth worker stays on heuristic.

2. ~~**Upgrade plane extraction to consume DepthMap data**~~ ✅ DONE (Stage 5)

3. ~~**Fix artifact accumulation + batch DB insert**~~ ✅ DONE (Stage 6) — `deleteArtifactsBySurvey()` cleanup + `insertReconstructionArtifactsBatch()` reduces 328 DB queries to ~3. Comprehensive logging added for 504 debugging.

4. ~~**Fix polygon fidelity for line extraction**~~ ✅ DONE (Phase E) — CHAIN_APPROX_NONE, epsilon 1.0, max edge length 50px. Line extraction improved from 21 to 66 lines. Deployed as v2.2.0 on Render Standard.

5. **Test the pipeline end-to-end after the fixes** — The user reported a 504 timeout. After the batch insert, accumulation, and polygon fidelity fixes, the pipeline should produce better results. Need the user to re-run "Generate Roof Geometry" and verify:
   - No 504 timeout (faster DB writes)
   - Correct artifact counts (2 depth maps from 2 photos, not 142)
   - Depth-augmented path executing (check Vercel logs for `[PlaneExtraction]` entries)
   - Reasonable plane counts (more than 2 roof planes expected with depth augmentation)
   - Better line extraction (66 lines vs 21 before)
   - Photogrammetry artifacts present (sfm_point_cloud + mesh)

6. **Retry Render Pro plan upgrade** — The Pro plan (5, 4GB/2CPU) was reverted to Standard because it caused 5 consecutive `update_failed` deploys. Options: (a) try upgrading again now that fresh code is deployed on Standard, (b) delete & recreate the service on Pro plan, (c) contact Render support about the hardware migration failure.

7. **Depth map visualization UI component** — `depthMapDecode.ts` provides `depthMapToHeatmapDataURL()` which produces a PNG data URL. Next step is a React component that renders the heatmap overlay on the source photo.

8. **3D mesh visualization UI component** — `MeshArtifact` now contains vertices and triangles. A React component (e.g., Three.js or react-three-fiber) could render the mesh for visual verification.

9. **Larger MiDaS model** — `Intel/dpt-swinv2-tiny-256` is 41MB. The `Intel/dpt-swinv2-large-256` (213MB) would give better accuracy but may push RAM usage over limits on Render Standard. Test on Render Pro first.

10. ~~**Multi-view depth consistency**~~ ✅ DONE (Stage 7) — `depthFusion.ts` aligns and merges depth maps using scale-shift alignment via plane correspondences. Will be upgraded to proper SfM when camera poses become available.

11. **Consider moving pipeline to background job** — The current architecture runs the entire pipeline synchronously in the Vercel serverless function (maxDuration=300s). If SAM2 cold starts + MiDaS + DB writes continue to cause timeouts, the pipeline should be moved to a background worker (e.g., Inngest, Trigger.dev, or a dedicated Render worker service) that posts results when complete, rather than blocking the HTTP request.

12. **Proper Delaunay triangulation** — Current meshing uses convex-hull + fan triangulation, which may miss concavities. A proper Delaunay triangulation library (e.g., delaunator) would produce better meshes.

13. **Spatial index for k-NN** — Statistical outlier removal uses O(n²) brute-force nearest neighbor. For larger point clouds, add a KD-tree or grid-based spatial index.

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


---

## Phase E: Polygon Fidelity Improvement — Fix Sloppy Lines (Complete)

### Problem
SAM2 polygon outlines were too coarse for line extraction. The root causes were:

1. **`CHAIN_APPROX_SIMPLE` in `findContours`**: OpenCV's `CHAIN_APPROX_SIMPLE` compresses horizontal, vertical, and diagonal segments, keeping only endpoints. This collapsed long straight edges into just 2 points, making a 200px+ roof edge into a single polygon segment.

2. **Douglas-Peucker epsilon too aggressive**: The default epsilon of 2.0 pixels (later changed to 5.0 via env var) was too high, removing important detail from polygon outlines. For line extraction, every vertex matters.

3. **No edge length constraint**: Even after simplification, polygon edges could be arbitrarily long (200px+ observed), which directly translated to missing or imprecise structural lines.

### Fix (3-step polygon pipeline in `mask_to_polygon()`)

**Step 1**: Switch `findContours` from `CHAIN_APPROX_SIMPLE` to `CHAIN_APPROX_NONE`, preserving every contour pixel before simplification.

**Step 2**: Lower Douglas-Peucker epsilon from 2.0 (default) to 1.0 pixel. This retains more detail while still reducing point count from the raw contour. Configurable via `SAM2_DOUGLAS_PEUCKER_EPSILON` env var.

**Step 3**: New `_subdivide_long_edges()` function — after simplification, any polygon edge longer than `MAX_POLYGON_EDGE_LENGTH` (default 50px, env-overridable via `SAM2_MAX_POLYGON_EDGE_LENGTH`) is subdivided by interpolating intermediate points at equal intervals along the edge.

### Key Code Changes (`sam2-service/main.py`)

```python
MAX_POLYGON_EDGE_LENGTH = int(os.environ.get("SAM2_MAX_POLYGON_EDGE_LENGTH", "50"))
DOUGLAS_PEUCKER_EPSILON = float(os.environ.get("SAM2_DOUGLAS_PEUCKER_EPSILON", "1.0"))

def _subdivide_long_edges(points: list[dict], max_length: float) -> list[dict]:
    if max_length <= 0 or len(points) < 2:
        return points
    result: list[dict] = []
    n = len(points)
    for i in range(n):
        p1 = points[i]
        p2 = points[(i + 1) % n]
        result.append(p1)
        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        length = (dx * dx + dy * dy) ** 0.5
        if length > max_length:
            num_segments = max(2, int(length / max_length + 0.5))
            for j in range(1, num_segments):
                t = j / num_segments
                result.append({"x": p1["x"] + dx * t, "y": p1["y"] + dy * t})
    return result

def mask_to_polygon(mask_bin, epsilon=DOUGLAS_PEUCKER_EPSILON):
    mask_uint8 = (mask_bin * 255).astype(np.uint8) if mask_bin.dtype != np.uint8 else mask_bin
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours: return []
    best_contour = max(contours, key=cv2.contourArea)
    simplified = cv2.approxPolyDP(best_contour, epsilon, closed=True)
    if len(simplified) < MIN_POLYGON_POINTS: return []
    points = [{"x": float(pt[0][0]), "y": float(pt[0][1])} for pt in simplified]
    points = _subdivide_long_edges(points, MAX_POLYGON_EDGE_LENGTH)
    return points
```

### Before/After Comparison

| Metric | Before (v2.1.0) | After (v2.2.0) |
|--------|-----------------|-----------------|
| Total polygon points (4 masks) | 106 | 230 |
| Max edge length | 227px | 62px |
| Edges > 100px | 4 | 0 |
| Edges > 200px | 1 | 0 |
| Lines extractable | 21 | 66 |
| Ridge lines | 1 | 11 |
| Eave lines | 6 | 17 |
| Rake lines | 10 | 5 |
| Wall vertical lines | 4 | 33 |

### Render Deploy Notes

- Version bumped from 2.1.0 → 2.2.0 to trigger fresh deploy
- Commits: `dd68c8b` (main fix) + `4eac403` (version bump)
- **Pro plan upgrade was reverted to Standard** — upgrading from Standard ($25, 2GB/1CPU) to Pro ($85, 4GB/2CPU) caused 5 consecutive `update_failed` deploys. The Docker build succeeded every time, but the instance swap phase failed. Root cause: Render platform issue with hardware migration when changing instance types. After reverting to Standard plan via API, deploy succeeded.
- If Pro plan is still desired, options: (a) try upgrading again now that fresh code is deployed on Standard, (b) delete & recreate the service on Pro plan, (c) contact Render support.

### Environment Variables (updated in render.yaml)

| Variable | Old Value | New Value |
|----------|-----------|-----------|
| `SAM2_DOUGLAS_PEUCKER_EPSILON` | `"2.0"` | `"1.0"` |
| `SAM2_MAX_POLYGON_EDGE_LENGTH` | (not set) | `"50"` |

---

## Stage 7: Photogrammetry — Multi-View 3D Reconstruction (Complete)

### Overview

Pipeline Stage 7 produces `MeshArtifact` and `SfMPointCloud` artifacts from depth maps, segmentation masks, and plane candidates. The pipeline is:

1. **Depth Unprojection** (`depthUnprojection.ts`): Convert 2D depth grid → 3D point cloud via pinhole camera model
2. **Depth Fusion** (`depthFusion.ts`): Align and merge multi-view point clouds using scale-shift alignment
3. **Meshing** (`meshFromDepth.ts`): RANSAC plane fitting + convex-hull triangulation → triangle mesh

All outputs carry the `REVIEW_ONLY_AUTHORITY` envelope — this is NOT CAD geometry.

### depthUnprojection.ts — Depth Map → 3D Point Cloud

Converts a 2D depth grid into a 3D point cloud using the pinhole camera model:

```
X_cam = (u - cx) * depth / fx
Y_cam = (v - cy) * depth / fy
Z_cam = depth
```

Key features:
- `CameraIntrinsics` / `CameraExtrinsics` interfaces for full camera model
- `intrinsicsFromFOV(fovH, fovV, w, h)` — derive intrinsics from field-of-view angles
- `defaultPhoneIntrinsics(w, h)` — 65°H × 50°V typical smartphone camera
- Per-point normal estimation from depth gradient (central differences → cross product of surface tangents)
- Per-point segmentation class assignment via point-in-polygon test against mask polygons
- Downsample factor for sparse point clouds
- Scale-shift parameters for relative (MiDaS) depth alignment
- Extrinsics transform: `P_world = R * P_cam + T`

Exported functions:
- `unprojectDepthMap(depthMap, intrinsics, extrinsics?, masks?, options?)` → `UnprojectionResult`
- `unprojectDepthMapDefault(depthMap, masks?, options?)` — convenience with default phone intrinsics
- `intrinsicsFromFOV(fovH, fovV, w, h)` → `CameraIntrinsics`
- `defaultPhoneIntrinsics(w, h, fovH?, fovV?)` → `CameraIntrinsics`

Types: `Point3D`, `UnprojectionResult`, `UnprojectionOptions`, `CameraIntrinsics`, `CameraExtrinsics`

### depthFusion.ts — Multi-View Depth Alignment & Merge

Aligns and merges depth maps from multiple photos into a single consistent 3D point cloud.

Key challenges with monocular depth:
1. MiDaS depth is relative (affine-invariant) — different scale/shift per image
2. No multi-view consistency — overlapping regions may have different depth values
3. No camera poses — no known relative rotation/translation between views

Approach (pragmatic, no SfM required):
1. Per-view unprojection using assumed camera intrinsics
2. Scale-shift alignment using segmentation-based correspondences (same roof plane seen from two views → depth alignment)
3. Point cloud merge with voxel-grid filtering for consistency
4. Outlier removal (statistical outlier detection)

Exported functions:
- `fuseDepthMaps(depthMaps, masks, roofPlanes, wallPlanes, options?)` → `DepthFusionResult`
- `alignDepthMaps(depthA, depthB, planesA, planesB)` → `AlignmentParams` — solves `depthB = scale * depthA + shift` via least squares on matching plane mean depths
- `voxelGridFilter(points, voxelSize, mode?)` → `Point3D[]` — average or closest-to-center per voxel
- `removeStatisticalOutliers(points, neighbors?, stdMultiplier?)` → `Point3D[]` — k-NN outlier detection

Alignment model: `aligned_depth = depth * scale + shift`, solved via least squares on mean depths of planes with matching normals (cosine ≥ 0.85).

Types: `AlignmentParams`, `DepthFusionResult`, `DepthFusionOptions`

### meshFromDepth.ts — Plane-Based Meshing

Creates a lightweight triangle mesh from the fused 3D point cloud:

1. Cluster points by segmentation class (roof=1, wall=2, ground=5)
2. Fit planes to each cluster via iterative RANSAC (with PCA refit)
3. Project inlier points onto their fitted plane
4. Compute 2D Delaunay-like triangulation (convex hull + fan + interior insertion) within each plane's local frame
5. Lift 2D triangles back to 3D

Exported functions:
- `meshFromDepth(points, options?)` → `MeshFromDepthResult`
- `fitPlaneRansac(points, distanceThreshold?, maxIterations?, minInliers?)` → `FittedPlane | null`
- `triangulatePoints2D(points2D, maxEdgeLength?, minAngle?)` → `Triangle[]`

RANSAC procedure: Sample 3 random points → compute plane → count inliers → keep best → refit via PCA (eigenvector of smallest eigenvalue of covariance matrix).

Triangulation: Convex hull (Graham scan) → fan triangulation from first vertex → incremental interior point insertion (find containing triangle, split into 3 sub-triangles). Validation rejects degenerate triangles (zero area), long edges (> maxEdgeLength), and thin angles (< minAngle).

Types: `Triangle`, `FittedPlane`, `MeshPatch`, `MeshFromDepthResult`, `MeshFromDepthOptions`

### runPhotogrammetryWorker.ts — Worker Orchestration

Pipeline Stage 7 worker that wires together unprojection → fusion → meshing.

Two entry points:
- `runPhotogrammetryWorker(input)` — direct invocation with explicit inputs
- `runPhotogrammetryFromReconstructionInput(input, allArtifacts)` — called by `runFullPipeline.ts`, extracts depth maps, masks, and planes from accumulated artifacts

Output artifacts:
1. **`sfm_point_cloud`** (`SfMPointCloud`): Base64-encoded Float32Array of [x,y,z,...] points. Confidence: 30 base + 10/view + 0.3/point (capped 100).
2. **`mesh`** (`MeshArtifact`): Base64-encoded Float32 vertices + Uint32 triangles. Confidence: 20 base + 10/plane + 0.2/vertex + 5/view (capped 100).

Graceful skip: If no depth maps are provided, the worker returns empty artifacts (no crash).

Version: `1.0.0-photogrammetry-worker`

### New Artifact Types (types.ts)

```typescript
interface MeshArtifact {
  artifactType: 'mesh';
  id: string;
  verticesData: string;      // base64 Float32 [x,y,z,...]
  trianglesData: string;     // base64 Uint32 [v0,v1,v2,...]
  vertexCount: number;
  triangleCount: number;
  estimatedArea: number;     // relative depth units
  planeCount: number;
  sourceFileIds: string[];
  confidence: number;
  workerVersion: string;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

interface SfMPointCloud {
  artifactType: 'sfm_point_cloud';
  pointCount: number;
  pointsData: string;        // base64 Float32 [x,y,z,...]
  sourcePhotoCount: number;
  sourceFileIds: string[];
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}
```

Both types are added to the `GeometryReconstructionArtifact` union and the schema validators in `schemas.ts`.

### Pipeline Integration (runFullPipeline.ts)

Stage 7 is wired after Stage 6 (multi-view fusion) with a timeout check:

```typescript
// Stage 7: Photogrammetry
const photoGramResult = stageTimer('photogrammetry', () =>
  runPhotogrammetryFromReconstructionInput(input, allArtifacts),
);
const photoGramArtifacts = photoGramResult.result.artifacts;
allArtifacts.push(...photoGramArtifacts);
```

If the pipeline has exceeded its time budget after Stage 6, Stage 7 is skipped.

### Key Files

| File | Role | Status |
|------|------|--------|
| `lib/.../workers/photogrammetry/depthUnprojection.ts` | Depth map → 3D point cloud (pinhole model) | **NEW** |
| `lib/.../workers/photogrammetry/depthFusion.ts` | Multi-view alignment + merge + voxel filter + outlier removal | **NEW** |
| `lib/.../workers/photogrammetry/meshFromDepth.ts` | RANSAC plane fit + convex-hull triangulation → mesh | **NEW** |
| `lib/.../workers/photogrammetry/runPhotogrammetryWorker.ts` | Worker orchestration + artifact emission | **NEW** |
| `lib/.../workers/photogrammetry/index.ts` | Barrel exports | **NEW** |
| `lib/.../types.ts` | `MeshArtifact` + `SfMPointCloud` types added | Modified |
| `lib/.../schemas.ts` | `validateMeshArtifact()` + schema dispatch added | Modified |
| `lib/.../runFullPipeline.ts` | Stage 7 photogrammetry wired after Stage 6 | Modified |

### Photogrammetry API Quick Reference

```typescript
import {
  // Worker entry points
  runPhotogrammetryWorker,
  runPhotogrammetryFromReconstructionInput,

  // Unprojection
  unprojectDepthMap,
  unprojectDepthMapDefault,
  intrinsicsFromFOV,
  defaultPhoneIntrinsics,

  // Fusion
  fuseDepthMaps,
  alignDepthMaps,
  voxelGridFilter,
  removeStatisticalOutliers,

  // Meshing
  meshFromDepth,
  fitPlaneRansac,
  triangulatePoints2D,
} from '@/lib/siteSurveys/geometryReconstruction/workers/photogrammetry';

// Example: full pipeline
const result = runPhotogrammetryFromReconstructionInput(pipelineInput, allArtifacts);
console.log(result.fusedPointCount);      // e.g., 1200
console.log(result.meshVertexCount);      // e.g., 85
console.log(result.meshTriangleCount);    // e.g., 120
console.log(result.fittedPlaneCount);     // e.g., 3
console.log(result.artifacts.length);     // 2 (sfm_point_cloud + mesh)

// Example: unproject a single depth map
const unprojResult = unprojectDepthMapDefault(depthMap, masks, {
  downsampleFactor: 2,
  estimateNormals: true,
  assignSegClass: true,
});
console.log(unprojResult.validCount);     // e.g., 950
console.log(unprojResult.bounds);         // { xMin, yMin, zMin, xMax, yMax, zMax }

// Example: fit a plane to 3D points
const plane = fitPlaneRansac(points, 0.02, 200, 8);
if (plane) {
  console.log(plane.nx, plane.ny, plane.nz); // unit normal
  console.log(plane.d);                       // offset
  console.log(plane.inlierCount);             // e.g., 45
  console.log(plane.residualRms);            // e.g., 0.008
}
```

### Limitations

1. **Depth is relative, not metric**: All measurements (vertex positions, areas, edge lengths) are in normalized depth units, not meters. When SfM becomes available, this module will be upgraded to metric reconstruction.

2. **No camera poses**: Scale-shift alignment via plane correspondences is approximate. It relies on matching roof/wall planes across views by normal similarity (cosine ≥ 0.85). Without known camera extrinsics, multi-view consistency is limited.

3. **Convex-hull triangulation**: The triangulation approach (convex hull + fan + interior insertion) may miss concavities in roof surfaces. A proper Delaunay triangulation would be more robust but requires an external library.

4. **Brute-force k-NN**: Statistical outlier removal uses O(n²) brute-force nearest neighbor search. Acceptable for small clouds (<10K points) but will need a spatial index for larger datasets.

5. **Single-scale depth**: The 64×64 depth grid resolution limits the level of geometric detail. Higher-resolution depth maps would produce denser, more accurate point clouds.


---

## Phase F: ONNX Batch Decoder Dimension Mismatch Fix (2025-06-01)

### Problem
Render deployment logs showed repeated ONNX Runtime errors every time the decoder was invoked:
```
batch decoder run failed (4 points). [ONNXRuntimeError] INVALID_ARGUMENT
Got invalid dimensions for input 'image_embeddings' for the following indices
index 0 Got 4 Expected 1
```

This caused 5 consecutive `update_failed` deploys on Render, blocking the Pro plan upgrade.

### Root Cause Analysis
The samexporter ONNX decoder (used for SAM 2.1 Hiera models) fundamentally does NOT support batching (num_labels > 1). Two approaches were tested:

1. **Feature tiling** (`np.repeat(feat, N, axis=0)`): Tiles encoder features from `(1, C, H, W)` → `(N, C, H, W)`, but encoder inputs have FIXED batch=1 in the ONNX graph. Error: "Got invalid dimensions for input 'image_embed' — Got N Expected 1"

2. **num_labels batching**: Passes encoder features as-is `(1, C, H, W)` and batches via the `num_labels` dimension on point/label/mask inputs. But `_embed_masks()` does `has_mask_input * mask_downscaling(input_mask)`, and ONNX Runtime's Mul node cannot broadcast a 1D tensor `(N,)` against a 4D tensor `(N, C, H, W)`. Error: "Attempting to broadcast an axis by a dimension other than 1. N by 64"

Both tiny (`sam2.1_hiera_tiny`) and small (`sam2.1_hiera_small`) model decoders have identical fixed-batch input shapes.

### Fix
At `__init__` time, the code now inspects the decoder's input shapes and detects fixed batch=1 on encoder feature inputs. When detected:

- Sets `self._decoder_batch_mode = "single"`
- Forces `self.points_per_batch = 1` (regardless of the `SAM2_POINTS_PER_BATCH` env var)
- `_safe_batch_size()` always returns 1
- `_decode_batch_points()` loops over `_decode_single_point()` directly — no batched ONNX call is attempted

This eliminates all ONNXRuntimeError spam while producing identical results (the fallback was single-point anyway, just with error spam and wasted failed batch attempts).

### Key Code Changes
| File | Change | Lines |
|------|--------|-------|
| `onnx_sam2_amg.py` (docstring) | Updated decoder I/O spec with fixed/dynamic dims, documented both batch failures | Top of file |
| `onnx_sam2_amg.py` (`__init__`) | Added `_decoder_batch_mode` detection + `points_per_batch=1` forcing | ~282-317 |
| `onnx_sam2_amg.py` (`_safe_batch_size`) | Returns 1 for "single" mode decoders | ~378-384 |
| `onnx_sam2_amg.py` (`_decode_batch_points`) | Loops over `_decode_single_point()` for "single" mode | ~587-626 |
| `onnx_sam2_amg.py` (`_decode_batch_via_num_labels`) | Marked unreachable, documented broadcast bug | ~628+ |

### Performance Impact
With `points_per_batch=1`, each decoder call processes 1 point. For a 9×9 grid (81 points), this means 81 decoder calls instead of ~20 batched calls. However:
- The decoder is lightweight (~7ms per call on CPU), so 81 calls ≈ 0.6s
- The encoder is the bottleneck (~2.5s), not the decoder
- The old code was ALSO doing 81 single-point calls — just after failing 20 batched calls first (with error spam)
- Net decoder time is actually FASTER (no wasted failed batch attempts)

### Render Deployment
After this fix is deployed, the Render logs should show:
- `WARNING: Decoder has fixed batch=1 on encoder inputs — batching NOT supported. Forcing points_per_batch=1 (was 4).`
- Zero `ONNXRuntimeError` / `INVALID_ARGUMENT` / `batch decoder run failed` errors
- Clean single-point decoding with `ONNX decoder: 81 points in 81 batches (batch_size=1)`

After a stable deploy on Standard plan, retry the Pro plan upgrade ($85, 4GB/2CPU).
