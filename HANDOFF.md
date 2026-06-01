# HANDOFF — MiDaS Depth Upgrade (Stages 1–4 Complete)

**Date:** 2025-06-01  
**Branch:** `dev` (commit `9201fbe`)  
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
| `lib/.../workers/depth/runDepthWorker.ts` | Depth worker: MiDaS primary, heuristic fallback | Yes (Stage 3) |
| `lib/.../workers/depth/index.ts` | Barrel exports including midasClient | Yes (Stage 3) |
| `lib/.../runFullPipeline.ts` | Pipeline: depth stage uses asyncStageTimer | Yes (Stage 3) |
| `__tests__/depthWorker.test.ts` | Tests updated for async worker | Yes (Stage 3) |

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

7. **Plane extraction doesn't consume DepthMap yet**: The downstream `runPlaneExtractionWorker.ts` is heuristic-based and doesn't decode depth data. This is the natural next upgrade target.

8. **Sandbox disk full**: The workspace hit 100% disk during this session. `sam2-service/__pycache__/` is untracked and can be cleaned. Large model downloads are the main culprit.

---

## Next Steps (Recommended Priority Order)

1. **Set `MIDAS_SERVICE_URL` in the Next.js/Vercel environment** — This activates the MiDaS path in production. Without it, the depth worker stays on heuristic.

2. **Upgrade plane extraction to consume DepthMap data** — The depth artifacts are now much richer (MiDaS confidence 60-80% vs heuristic 35-65%). Plane extraction can use depth gradients to identify roof planes more accurately.

3. **Depth map visualization** — Add a UI component that decodes and renders the depth grid as a heatmap overlay on the source photo. This would make the depth data visible for review.

4. **Larger MiDaS model** — `Intel/dpt-swinv2-tiny-256` is 41MB. The `Intel/dpt-swinv2-large-256` (213MB) would give better accuracy but may push RAM usage over limits on Render Standard. Test on Render Pro first.

5. **Depth map caching** — Currently each pipeline run re-estimates depth. Cache DepthMap artifacts keyed by (fileId, model version) to avoid redundant inference.

6. **Multi-view depth consistency** — When multiple photos overlap, fuse their depth maps using the existing multi-view fusion stage. This is a natural extension of the pipeline architecture.

---

## Standing Rules

- **Never push to master** — always dev
- **Three-check suite before every push**: `tsc --noEmit`, `eslint`, `vitest run`
- **Push with x-access-token**: `git push https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git`
- **No feature branches** — work directly on dev
- **All artifacts are REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY**

---

*End of handoff document. All four stages complete. Ready for next session.*
