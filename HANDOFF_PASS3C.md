# SolarPro — Pass 3C Handoff Document

## Thread Context

This document provides complete context for continuing SolarPro development in a new thread. It captures the full state of the codebase, the rules that must be followed, the architecture, the deployed services, and the history of what was done and why.

---

## 1. PROJECT OVERVIEW

**SolarPro** is a solar roof analysis application that reconstructs 3D roof geometry from photos using AI segmentation and line extraction. The system has two main processing pipelines:

- **Pipeline A**: Traditional survey → CAD → permit generation (authoritative, production)
- **Pipeline B**: AI-driven segmentation → line extraction → vanishing points → depth estimation → plane extraction → multi-view fusion → photogrammetry (review-only, non-authoritative)

All current work is on **Pipeline B** — improving segmentation quality and line extraction for roof geometry reconstruction.

---

## 2. ARCHITECTURE

### 2.1 Stack
- **Frontend**: Next.js 14 on Vercel
- **Database**: Neon PostgreSQL (serverless)
- **SAM2 Service**: Python FastAPI microservice on Render running Meta's SAM 2.1 model (`facebook/sam2.1-hiera-small`) on CPU
- **Geometry Worker**: Node.js background worker on Render that polls Neon DB for queued jobs
- **Main App**: Next.js API routes on Render

### 2.2 Render Services
| Service | ID | Root Dir | Branch |
|---------|-----|----------|--------|
| sam2-segmentation | `srv-d8djpc3bc2fs73emup10` | `sam2-service` | dev |
| geometry-reconstruction-worker | `srv-d8fq3nm7r5hc73acdbeg` | `./` | dev |
| Solarpro (Next.js) | `srv-d89ukf37uimc739tots0` | `./` | dev |

### 2.3 Render API
- **Base URL**: `https://api.render.com/v1/`
- **Auth**: Bearer token `rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz`
- **Key endpoints**:
  - List services: `GET /services`
  - Service details: `GET /services/{id}`
  - Trigger deploy: `POST /services/{id}/deploys`
  - List deploys: `GET /services/{id}/deploys?limit=N`
  - Get env vars: `GET /services/{id}/env-vars`
  - Update env var: `PUT /services/{id}/env-vars/{key}` with `{"value": "..."}`
  - All services auto-deploy from the `dev` branch on push

### 2.4 Vercel
- **Project**: `solarpro-dev` (prj_dOD6O0A02qEqR2xipZebIIBkL2WD)
- **GitHub repoId**: 1173887298
- Auto-deploys from `dev` branch

### 2.5 GitHub
- **Repo**: `rayobrian6/Solarpro`
- **Branch**: Always push to `dev`
- **Push URL**: `https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git`

---

## 3. STANDING RULES — NEVER VIOLATE

These rules were explicitly set by the user and must be followed in ALL future work:

### 3.1 Protected Code Areas — DO NOT MODIFY
1. **CAD generation** — any file with "cad" in the path or name
2. **Permit generation** — any file with "permit" in the path or name
3. **Canonical builder** — any file with "canonical" in the path or name
4. **Promotion logic** — any file with "promot" in the path or name
5. **Worker architecture** — the polling/queue infrastructure, not the processing logic inside workers

### 3.2 Segmentation Rules
1. **Do NOT add new semantic classes** — the current taxonomy (roof, wall, sky, ground, tree, chimney, vent_pipe, skylight, etc.) is locked
2. **Do NOT broaden thresholds to create more masks** — bias toward fewer, higher-quality masks
3. **Bias toward false negatives over false positives for roof penetrations** — it's worse to misclassify a tree fragment as "chimney" than to miss a real chimney
4. **Do NOT treat SAM2 masks as geometry** — masks are class-agnostic region hints, NOT authoritative geometry. They feed into line extraction which produces review-only structural line candidates

### 3.3 Git Rules
1. **ALWAYS push to `dev` branch** — never push to master directly
2. **Use `gh` CLI** or `x-access-token:$GITHUB_TOKEN` for GitHub operations
3. **Descriptive commit messages** — include pass number, what was fixed, and why

### 3.4 Type System Rules
1. **NormalizedPoint** requires `{x, y, coordinateSystem: 'normalized_image_0_1000'}` — the `coordinateSystem` field is MANDATORY, not optional
2. **LineSegment** requires `{start: NormalizedPoint, end: NormalizedPoint, length, angleDeg}` — all four fields are required
3. Any line extraction output missing these fields will crash downstream rendering

---

## 4. KEY FILES AND THEIR ROLES

### 4.1 SAM2 Service (Python)
**`sam2-service/main.py`** (~2400+ lines) — The central SAM2 inference service:
- **Lines 1-170**: Constants, env vars, thresholds
  - `MIN_MASK_AREA_FRACTION = 0.003` (was 0.002, raised in Pass 3C to filter noise)
  - `CLASSIFIER_GREEN_RATIO_TREE = 0.35`
  - `CLASSIFIER_TEXTURE_ROOF_MAX = 15` (smooth surface threshold)
  - `CLASSIFIER_TEXTURE_TREE_MIN = 20` (textured surface threshold)
  - `CLASSIFIER_BRIGHTNESS_SKY_V_MIN = 200`, `DARK_V_MAX = 100`, `GRAY_S_MAX = 30`, `SKY_STD_V_MAX = 12`
- **Lines 681-720**: `_segments_intersect()` + `_polygon_is_simple()` — self-intersection detection (Pass 3C addition)
- **Lines 725-830**: `_refine_polygon_with_contour()` — contour-aware corner snapping with safeguards (snap_tolerance=5.0, min_corner_spacing=8.0, self-intersection rejection)
- **Lines 897-1300**: `classify_mask_region()` — heuristic classifier that assigns semantic classes to SAM2 masks
  - Uses position (norm_y_center), area (norm_area), aspect ratio, green_ratio, brightness stats, texture score, stability score
  - Composite signals: `is_smooth_surface`, `is_textured_surface`, `is_bright_surface`, `is_low_saturation`, `is_uniform_surface`
  - Black TPO roof detection (Pass 3A.1): very dark, very low saturation, smooth
  - White TPO roof detection: very bright, very low saturation, smooth, slight texture (std_v > 8)
  - Roof penetration detection (Pass 3C): chimney, vent_pipe, skylight — TIGHTENED with stability_score > 0.90/0.92/0.88, requires smooth surface, low saturation
- **Lines 1300+**: API endpoints, mask generation, polygon extraction

**`sam2-service/test_pass3c_fixes.py`** — Pass 3C unit tests (15 tests):
- 9 tests for self-intersecting polygon rejection
- 5 tests for tree/noise classification regression
- 1 test for MIN_MASK_AREA_FRACTION default value

**`sam2-service/Dockerfile`** — Docker build for Render deployment
**`sam2-service/entrypoint.sh`** — Entrypoint that downloads SAM2 checkpoints
**`sam2-service/onnx_sam2_amg.py`** — ONNX-based SAM2 inference (alternative backend)

### 4.2 Line Extraction Worker (TypeScript)
**`lib/siteSurveys/geometryReconstruction/workers/lineExtraction/runLineExtractionWorker.ts`** (~1300+ lines):
- **Lines 60-80**: `LINE_EXTRACTION_WORKER_VERSION = '3.1.0-tuning-pass-3b'` (should be updated on next pass)
- **Lines 80-120**: Class sets — `STRUCTURAL_LINE_CLASSES`, `REJECTED_CLASSES`, `WALL_CLASSES`
- **Lines 121-136**: `WALL_FOUNDATION_OCCLUDER_CLASSES` — now EXCLUDES window/door/garage_door (Pass 3C fix). Contains: car, truck, trailer, bushes, fence, tree, trees, vegetation_touching_structure, porch, deck, steps, railing, trash_can, person, ladder, tools, temporary_materials, ac_unit
- **Lines 182-186**: `LineSegment` interface — requires `start: NormalizedPoint, end: NormalizedPoint, length, angleDeg`
- **Lines 1045-1170**: `inferWallBottomEdge()` — infers foundation lines behind occluders. Returns `LineSegment & {lineType, maskSupport}`. Now includes `angleDeg: 0` and `coordinateSystem: 'normalized_image_0_1000'` (Pass 3C fix)
- **Lines 1181+**: `runLineExtractionWorker()` — main entry point

**`lib/siteSurveys/geometryReconstruction/workers/lineExtraction/runLineExtractionWorker.test.ts`** — Pass 3C unit tests (8 tests):
- 3 tests for wall bottom edge required fields
- 5 tests for window/door occluder exclusion

### 4.3 Type Definitions
**`lib/siteSurveys/geometryReconstruction/types.ts`**:
- `NormalizedPoint`: `{x, y, coordinateSystem: 'normalized_image_0_1000'}` — MANDATORY coordinateSystem
- `NormalizedRegion`: `{x, y, width, height, coordinateSystem: 'normalized_image_0_1000'}`
- `SegmentationClass`: Union of ~33 literal string types (roof, wall, chimney, vent_pipe, skylight, etc.)
- `SemanticSegmentationMask`: Full mask artifact with `authority`, `limitations`, `maskBounds`, `polygon`, etc.
- `StructuralLineCandidate`: Line candidate with `lineType`, `maskSupport`, `confidence`, etc.

**`lib/siteSurveys/geometryReconstruction/schemas.ts`** — Zod validation schemas (uses SEGMENTATION_CLASSES from types.ts)

### 4.4 SAM2 Client
**`lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client.ts`**:
- `SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS` — maps SAM2 heuristic class names to TypeScript SegmentationClass
- `SOLAR_RELEVANT_SEGMENTATION_CLASSES` — which classes matter for solar analysis

---

## 5. PASS HISTORY — WHAT WAS DONE AND WHY

### Pass 3A.1 — Black TPO Roof Detection
- **Problem**: Black TPO/PVC flat roofs (very dark, very low saturation, very smooth) were being misclassified as "obstruction" or "shadow" instead of "roof"
- **Fix**: Added black TPO detection branch in `classify_mask_region()` that checks for very dark (mean_v < 100), very low saturation (mean_s < 30), smooth (texture_score < 15), and large area
- **Result**: Black TPO roofs now correctly classify as "roof"

### Pass 3B — Geometry Fidelity
- **Problem**: Polygon boundaries drifted from actual roof edges due to aggressive Douglas-Peucker simplification
- **Fix**: Lowered `DOUGLAS_PEUCKER_EPSILON` from 0.7 → 0.5, lowered `MAX_POLYGON_EDGE_LENGTH` from 35 → 25, added contour-aware corner snapping via `_refine_polygon_with_contour()`, added wall foundation line inference via `inferWallBottomEdge()`, added chimney/vent_pipe/skylight classes
- **Result**: More faithful polygon boundaries, wall foundation lines inferred behind occluders

### Pass 3C — Segmentation Stability / Artifact Validity Patch (CURRENT)
- **Problem**: User reported surreal rendering artifacts after Pass 3B deployment — trees growing from roof, purple-outlined car, neon cat shapes
- **Root cause audit identified 6 bugs**:
  1. `inferWallBottomEdge` missing `angleDeg` and `coordinateSystem` fields → downstream rendering crash/corruption
  2. Roof penetration classifier too loose → tree fragments, shadow patches classified as chimney/skylight → rendered as geometry on roof
  3. `_refine_polygon_with_contour` creating self-intersecting polygons → surreal rendering (bowtie polygons → neon shapes)
  4. `MIN_MASK_AREA_FRACTION` too low (0.002) → noise masks pass through → tree-on-roof artifacts
  5. `WALL_FOUNDATION_OCCLUDER_CLASSES` included window/door/garage_door → windows treated as occluders blocking foundation line → bad wall geometry
  6. `snap_tolerance=3.0` too aggressive → snapping to pixel-noise corners → jagged/dense vertex clusters → self-intersection

- **6 Fixes Applied**:
  1. Added `angleDeg: 0` and `coordinateSystem: 'normalized_image_0_1000'` to `inferWallBottomEdge` results
  2. Tightened roof penetration classifier: chimney requires `is_smooth_surface`, `stability_score > 0.90`, `is_low_saturation`; vent_pipe requires `norm_area < 0.002`, `aspect_ratio 0.75-1.4`, `is_smooth_surface`, `stability_score > 0.92`; skylight requires `is_uniform_surface`, `stability_score > 0.88`
  3. Added `_polygon_is_simple()` validation — rejects refinement that creates self-intersecting polygons
  4. Raised `MIN_MASK_AREA_FRACTION` from 0.002 → 0.003
  5. Removed window/door/garage_door from `WALL_FOUNDATION_OCCLUDER_CLASSES`
  6. Raised `snap_tolerance` from 3.0 → 5.0, added `min_corner_spacing=8.0`

- **23 Tests Added** (15 Python + 8 TypeScript) — ALL PASSING
- **Deployed**: Both SAM2 and geometry worker services live on commit `dbfeff3`
- **Render env var updated**: `SAM2_MIN_MASK_AREA_FRACTION=0.003`

---

## 6. KNOWN REMAINING ISSUES

These were reported by the user but not yet addressed:

1. **Plane boundaries drifting** — mask polygons still don't perfectly follow actual roof plane edges. Douglas-Peucker simplification still rounds corners even with epsilon=0.5. The contour-aware snapping helps but may need further tuning or a different approach (e.g., iterative endpoint fit, or treating the full contour as the polygon with selective decimation).

2. **Flat roof not truly coordinated** — polygon fidelity for flat/commercial roofs is low. The polygon often doesn't capture the true extent of the roof membrane.

3. **Missing vent pipes and chimney stacks** — small roof penetrations may still not be segmented. The tightened classifier (bias toward false negatives) means some real penetrations will be missed. This is the intended trade-off: it's better to miss a penetration than to hallucinate one.

4. **Windows, doors, items blocking wall foundation line** — windows and doors are no longer treated as occluders (Fix 5), but other items (ac_unit, bushes) still are. If there are false negatives where the wall foundation line isn't inferred behind legitimate occluders, the occluder list may need adjustment.

5. **Worker version string not updated** — `LINE_EXTRACTION_WORKER_VERSION` is still `'3.1.0-tuning-pass-3b'`. Should be updated to `'3.1.0-tuning-pass-3c'` or similar.

---

## 7. ENVIRONMENT VARIABLES

### SAM2 Service (`srv-d8djpc3bc2fs73emup10`)
| Var | Value | Notes |
|-----|-------|-------|
| `SAM2_MIN_MASK_AREA_FRACTION` | 0.003 | Raised from 0.002 in Pass 3C |
| `SAM2_MAX_MASKS` | 30 | Max masks per inference |
| `SAM2_PRED_IOU_THRESH` | 0.5 | Prediction IOU threshold |
| `SAM2_STABILITY_SCORE_THRESH` | 0.8 | Mask stability threshold |
| `SAM2_MAX_IMAGE_DIM` | 512 (CPU) / 2048 (GPU) | Max image dimension |
| `SAM2_CLASSIFIER_GREEN_RATIO_TREE` | 0.35 | Green ratio for tree classification |
| `SAM2_CLASSIFIER_TEXTURE_ROOF_MAX` | 15 | Texture threshold for smooth/roof |
| `SAM2_CLASSIFIER_TEXTURE_TREE_MIN` | 20 | Texture threshold for textured/tree |

### Geometry Worker (`srv-d8fq3nm7r5hc73acdbeg`)
Standard Node.js worker env vars. Connects to Neon PostgreSQL via `DATABASE_URL`.

---

## 8. HOW TO DEPLOY

1. **Commit and push to `dev`**:
   ```bash
   git add -A && git commit -m "Pass X: description"
   git push https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git dev
   ```

2. **Auto-deploy** triggers on push for both Render services and Vercel. If it doesn't, trigger manually:
   ```bash
   curl -X POST -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
     -H "Content-Type: application/json" \
     "https://api.render.com/v1/services/{SERVICE_ID}/deploys" -d '{}'
   ```

3. **Check deploy status**:
   ```bash
   curl -s -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
     "https://api.render.com/v1/services/{SERVICE_ID}/deploys?limit=1" | \
     python3 -c "import sys,json; ds=json.load(sys.stdin); print(ds[0]['deploy']['status'])"
   ```

4. **Update env vars** (requires redeploy after):
   ```bash
   curl -X PUT -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
     -H "Content-Type: application/json" \
     "https://api.render.com/v1/services/{SERVICE_ID}/env-vars/{KEY}" \
     -d '{"value": "new_value"}'
   ```

---

## 9. HOW TO RUN TESTS

### Python (SAM2 service)
```bash
cd /workspace/Solarpro/sam2-service
pip install numpy opencv-python-headless  # if not installed
python3 test_pass3c_fixes.py
```

### TypeScript (Vitest)
```bash
cd /workspace/Solarpro
npx vitest run lib/siteSurveys/geometryReconstruction/workers/lineExtraction/runLineExtractionWorker.test.ts --reporter=verbose
```

### TypeScript type check
```bash
cd /workspace/Solarpro
npx tsc --noEmit --pretty
```

### Full test suite
```bash
cd /workspace/Solarpro
npx vitest run
```

---

## 10. EXACT STATE AT HANDOFF

- **Git commit**: `dbfeff3` on `dev` branch — "Pass 3C: Segmentation stability / artifact validity patch"
- **Render SAM2 service**: LIVE on `dbfeff3`
- **Render geometry worker**: LIVE on `dbfeff3`
- **Render env var `SAM2_MIN_MASK_AREA_FRACTION`**: `0.003`
- **Vercel**: auto-deploys from `dev` branch
- **Python tests**: 15/15 passing
- **TypeScript tests**: 8/8 passing
- **TypeScript compilation**: 0 errors
- **Files changed in Pass 3C**:
  - `sam2-service/main.py` (modified — 6 fixes)
  - `lib/.../runLineExtractionWorker.ts` (modified — 2 fixes + 2 exports for testing)
  - `sam2-service/test_pass3c_fixes.py` (new — 15 Python tests)
  - `lib/.../runLineExtractionWorker.test.ts` (new — 8 TypeScript tests)
- **No changes to**: CAD, permit generation, canonical builder, promotion logic, worker architecture

---

## 11. SUGGESTED NEXT STEPS

The user originally reported 4 concerns. Pass 3C fixed the surreal artifacts, but these underlying quality issues remain:

1. **Pass 3D — Polygon Boundary Fidelity**: The Douglas-Peucker simplification still rounds corners. Consider replacing the epsilon-based approach with a curvature-preserving simplification that prioritizes keeping high-curvature vertices and only decimates low-curvature runs. Could use the existing `_compute_curvature` output from `_refine_polygon_with_contour` to drive simplification instead of using it only for post-hoc snapping.

2. **Pass 3D — Flat Roof Coordination**: For commercial flat roofs, the polygon often doesn't capture the full extent. Consider using the mask's bounding box plus the original contour's extreme points to define the roof polygon for large, smooth, low-texture masks rather than relying on Douglas-Peucker which tends to round off corners.

3. **Pass 3D — Roof Penetration Recall**: The tightened classifier (false-negative bias) will miss some real penetrations. Consider adding a second-pass prompt-based approach where the geometry worker sends point prompts to SAM2 for known penetration locations (e.g., from prior surveys or from the line extraction output identifying potential penetration shadows).

4. **Version String Update**: `LINE_EXTRACTION_WORKER_VERSION` should be updated from `'3.1.0-tuning-pass-3b'` to `'3.1.0-tuning-pass-3c'` or similar.

---

## 12. HEURISTIC CLASSIFIER DECISION TREE (Reference)

The `classify_mask_region()` function in `sam2-service/main.py` follows this decision order:

```
1. Moss/algae: moderate green on structure (green 0.15-0.35)
2. High green + texture: definitely vegetation → grass/bushes/tree/vegetation_touching_structure
3. Moderate green + textured → bushes/tree
4. Black TPO roof: very dark + very low sat + smooth + large area → roof
5. White TPO roof: very bright + very low sat + smooth → roof
6. Sky: top of image + bright + uniform + desaturated
7. Ground: bottom of image → grass/driveway/sidewalk/ground
8. Tree (shape-based): middle height + moderate green or textured
9. Wall/facade: tall rectangle in middle of image
10. Facade elements: window (small, upper wall), door (small, lower wall), garage_door (lower wall, wide)
11. Roof penetration (TIGHTENED in Pass 3C):
    - Chimney: small, smooth, stable>0.90, low-sat, dark → chimney; bright → skylight
    - Vent pipe: very tiny (<0.002), circular (0.75-1.4), smooth, stable>0.92
    - Skylight: bright, low-sat, uniform, stable>0.88
12. Occluders: car, truck, etc.
13. Equipment: ac_unit, electrical, etc.
14. Condition flags: moss, algae, damaged_siding, etc.
15. Fallback: "unknown"
```

**Key principle**: Order matters. Earlier checks take priority. The roof detection (steps 4-5) runs BEFORE sky (step 6) to prevent flat roofs from being stolen by the sky check.

---

*Document generated at Pass 3C completion. All information current as of commit `dbfeff3` on `dev` branch.*
