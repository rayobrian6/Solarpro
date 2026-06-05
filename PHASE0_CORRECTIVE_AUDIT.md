# Phase 0 Corrective Audit — SolarPro Unified Geometry Overlay

**Audit Date:** 2025-01-24  
**Scope:** Why does the visible overlay still show semantic contamination after Phase 0 implementation?  
**Method:** Read-only code audit. No code changes. No implementation proposals.  
**Constraint:** Do NOT defend Phase 0. Do NOT propose fixes. Audit only.

---

## PART 1: Visible Overlay Pipeline Map

Complete trace from photo upload through to the label shown in the UI.

### Stage 1: Segmentation (Pipeline B Worker)

**File:** `lib/siteSurveys/geometryReconstruction/workers/segmentation/runSegmentationWorker.ts`

Photo enters the segmentation worker. Two parallel sub-pipelines produce masks:

**Sub-pipeline A — SAM2:**
- SAM2 Python service produces class-agnostic masks
- Python service sends `classHint` strings (position-based heuristics, NOT semantic understanding)
- `segmentWithSAM2()` in `sam2Client.ts` receives masks with `classHint`
- `mapSAM2ClassHint()` does a **simple string lookup** in `SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS` table
- When hint not found AND `PHASE0_BACKGROUND_CLASS` enabled → returns `'background'`
- When hint not found AND `PHASE0_BACKGROUND_CLASS` disabled → returns `null` (mask is **skipped entirely**)
- **Result:** Each SAM2 mask gets a `segmentationClass` like `'roof'`, `'wall'`, `'sky'`, `'tree'`, `'background'`

**Sub-pipeline B — Canny:**
- `extractRoofGeometry()` in `roofGeometryExtractor.ts` processes the photo at 512×512
- Color quantization (27 colors) → connected component labeling → Suzuki-Abe contour extraction
- `classifyAndScoreContour()` classifies each contour by color + position + geometry
- **CRITICAL FALLBACK:** Unknown upper-half contours:
  - `PHASE0_CANNY_BACKGROUND_FIX` ON → `'background'` at confidence 20
  - `PHASE0_CANNY_BACKGROUND_FIX` OFF → `'probable_roof_plane'` at confidence 35
- Contour classifications are mapped via `CONTOUR_TO_SEGMENTATION_CLASS`:
  - `probable_roof_plane` → `'roof'`
  - `background` → `'background'`
  - etc.
- **Result:** Each Canny mask gets a `segmentationClass` like `'roof'`, `'wall'`, `'background'`

### Stage 2: Mask Filtering & Enhancement

**File:** `runSegmentationWorker.ts`

- `SOLAR_RELEVANT_SEGMENTATION_CLASSES` filter determines which SAM2 masks are kept
- Background class is NOT in this set but gets special handling when `PHASE0_BACKGROUND_CLASS` is on
- Phase 0 background masks bypass the `minConfidence` filter (intentionally below default 30)
- `computeGeometryParticipation()` sets `excludeFromGeometry=true` for sky masks exceeding area threshold
- `suppressWeakStructureMasks()` sets `excludeFromGeometry=true` on weak structure masks
- **KEY:** Masks with `excludeFromGeometry=true` are STILL included in output `SemanticSegmentationMask[]`

### Stage 3: Artifact Adaptation (Pipeline Adapters)

**File:** `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts`

Pipeline A and Pipeline B artifacts are adapted into `UnifiedGeometryArtifact` instances:

**For Pipeline A (Photo Vision):**
- `adaptPhotoVisionCandidate()`: uses `PIPELINE_A_CLASS_MAP[candidate.candidateType]` for `geometryClass`
- **`PIPELINE_A_CLASS_MAP` maps `rectangular_region_candidate → 'roof_plane'` UNCONDITIONALLY**
- Also maps `wall_plane_candidate → 'wall_plane'`, etc.
- Creates bbox-derived polygon for roof_plane and wall_plane types
- Stamps with `RAW_EVIDENCE_AUTHORITY`

**For Pipeline B (Segmentation masks):**
- `adaptSemanticSegmentationMask()`: PRESERVES `artifact.segmentationClass` as the label
- Sets `geometryClass: 'segmentation_mask'`
- Passes through `excludeFromGeometry` as-is
- Computes `isOccluder`, `isVegetation`, `isGroundSurface`, `sceneRole`, `cadRelevance`
- Stamps with `RAW_EVIDENCE_AUTHORITY`

**For Pipeline B (Roof plane candidates):**
- `adaptRoofPlaneCandidate()`: maps to `geometryClass: 'roof_plane'`, `planeType: 'roof'`
- Stamps with `RAW_EVIDENCE_AUTHORITY`

**CRITICAL:** None of the adapters check Phase 0 flags or re-classify artifacts. The classification from Stage 1 is baked in permanently.

### Stage 4: Storage (Unified Artifact Store)

**File:** `lib/siteSurveys/unifiedGeometry/unifiedArtifactStore.ts`

- `writeUnifiedArtifact()` uses `ON CONFLICT (id) DO NOTHING` — idempotent but does NOT update existing records
- `writeUnifiedArtifacts()` batch writes with concurrency=20, batch_size=500
- Each adapted artifact gets a NEW UUID — re-running pipeline creates new artifacts ALONGSIDE old ones
- `deleteUnifiedArtifactsByPipeline()` and `deleteUnifiedArtifactsBySurvey()` exist but are NEVER called automatically when flags change
- **Result:** Old artifacts with wrong classifications persist in the `unified_geometry_artifacts` table indefinitely

### Stage 5: API Bundle (Route Handler)

**File:** `app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts`

Two paths to serve artifacts:

**PRIMARY path:**
- Queries `unified_geometry_artifacts` table via `getUnifiedArtifactsForSurvey()`
- Only used if `hasPipelineArtifacts` is true (has photo_vision or geometry_recon artifacts)
- Returns whatever is stored — including stale pre-Phase-0 artifacts
- Response includes `source: 'unified_table'`

**FALLBACK path:**
- Queries source tables directly: `getOpenSourcePhotoVisionCandidatesBySurvey()` and `getArtifactsBySurvey()`
- Calls `adaptPhotoVisionBundle()` and `adaptGeometryReconBundle()` from pipelineAdapters
- Re-adapts OLD source artifacts using the same unconditional class maps
- Response includes `source: 'fallback_adaptation'`

**CRITICAL:** Neither path applies Phase 0 gates or re-classification. The `BundleBuilder` uses `minConfidence: 0` and `includeMocks: true` — ALL artifacts included.

### Stage 6: Overlay Renderer (React Component)

**File:** `components/UnifiedGeometryOverlayRenderer.tsx`

The renderer determines what the user actually sees:

**Color selection priority (per artifact):**
1. Per-segmentationClass color from `SEGMENTATION_CLASS_COLORS` (most specific)
2. Per-backend color from `SEGMENTATION_BACKEND_COLORS` (SAM2 vs Canny)
3. Per-geometryClass default from `GEOMETRY_CLASS_OVERLAY_COLORS`

**What determines the visible label:**
- For `geometryClass === 'segmentation_mask'`: the `segmentationClass` field determines color AND tooltip label
- For `geometryClass === 'roof_plane'`: green fill/stroke, "Roof Plane" label
- For `geometryClass === 'wall_plane'`: cyan fill/stroke, "Wall Plane" label

**`excludeFromGeometry` handling:**
- Artifacts with `excludeFromGeometry === true` get: reduced fill opacity (0.04), dashed stroke (4,4)
- They are NOT suppressed from display — they still render visibly
- Tooltip shows orange "EXCLUDED" badge
- The artifact is still colored by its (potentially wrong) `segmentationClass` or `geometryClass`

**Confidence filtering:**
- Only `roof_line` artifacts have a confidence filter in the renderer (60 default, 40 debug)
- All other artifact types are shown regardless of confidence (API already sets minConfidence: 0)

**Result:** The renderer trusts `artifact.segmentationClass` and `artifact.geometryClass` as-is. No re-classification. No Phase 0 gate checks. Low-confidence artifacts render with full visual weight except for the subtle `excludeFromGeometry` styling.

### Complete Pipeline Diagram

```
Photo Upload
    │
    ▼
┌─────────────────────────────────────────────┐
│ SEGMENTATION WORKER                          │
│  ├─ SAM2: classHint → mapSAM2ClassHint()    │  ← PHASE0_BACKGROUND_CLASS here
│  │   → segmentationClass ('roof','wall',etc)│
│  ├─ Canny: classifyAndScoreContour()         │  ← PHASE0_CANNY_BACKGROUND_FIX here
│  │   → CONTOUR_TO_SEGMENTATION_CLASS         │
│  │   → segmentationClass ('roof','wall',etc)│
│  └─ Both: excludeFromGeometry on some masks │
└──────────────┬──────────────────────────────┘
               │ SemanticSegmentationMask[]
               ▼
┌─────────────────────────────────────────────┐
│ PIPELINE ADAPTERS                            │
│  ├─ adaptSemanticSegmentationMask()          │
│  │   PRESERVES segmentationClass             │  ← No Phase 0 check
│  │   sets geometryClass='segmentation_mask'  │
│  ├─ adaptPhotoVisionCandidate()              │
│  │   PIPELINE_A_CLASS_MAP UNCONDITIONAL      │  ← No Phase 0 check
│  │   rectangular_region → 'roof_plane'       │
│  └─ All stamp RAW_EVIDENCE_AUTHORITY         │
└──────────────┬──────────────────────────────┘
               │ UnifiedGeometryArtifact[]
               ▼
┌─────────────────────────────────────────────┐
│ UNIFIED ARTIFACT STORE                       │
│  writeUnifiedArtifact()                      │
│  ON CONFLICT (id) DO NOTHING                 │  ← No update of existing records
│  New UUID each time → old persist alongside  │
│  delete functions EXIST but NEVER auto-called│
└──────────────┬──────────────────────────────┘
               │ Persisted in unified_geometry_artifacts table
               ▼
┌─────────────────────────────────────────────┐
│ BUNDLE API ROUTE                             │
│  PRIMARY: read from unified table             │  ← Returns stale data as-is
│  FALLBACK: re-adapt from source tables       │  ← Re-applies wrong class maps
│  minConfidence: 0, includeMocks: true        │  ← No filtering
│  No Phase 0 gates in either path             │
└──────────────┬──────────────────────────────┘
               │ UnifiedGeometryBundle JSON
               ▼
┌─────────────────────────────────────────────┐
│ OVERLAY RENDERER (React/SVG)                 │
│  Color by: segmentationClass > backend >     │
│            geometryClass                      │
│  excludeFromGeometry → reduced opacity +     │
│    dashed stroke, NOT suppressed             │
│  No confidence filter except roof_line       │  ← Everything renders
│  No re-classification or Phase 0 gates       │
│  TRUSTS artifact labels as-is                │
└─────────────────────────────────────────────┘
               │
               ▼
          USER SEES WRONG LABELS
    (sky=roof, vehicles=structure, edges=solar)
```

---

## PART 2: Phase 0 Impact Matrix

Which Phase 0 components affect which system surface.

| Phase 0 Component | Overlay Display | Canonical Promotion | CAD Export | Metadata Only |
|---|---|---|---|---|
| `PHASE0_BACKGROUND_CLASS` | **YES** — changes SAM2 classification at pipeline execution time for NEW runs only | Indirect — background masks at conf 20 won't promote (below threshold) | No | No |
| `PHASE0_CANNY_BACKGROUND_FIX` | **YES** — changes Canny fallback classification at pipeline execution time for NEW runs only | Indirect — background at conf 20 won't promote | No | No |
| `PHASE0_DEPTH_CONTRADICTION` + `_ENABLED` | **NO** — only affects canonical promotion | **YES** — blocks promotion of contradicted artifacts | **YES** — prevents contradicted geometry from reaching CAD | No |
| `PHASE0_CANONICAL_GEOMETRY_GATE` | **NO** — only affects canonical promotion | **YES** — requires geometry presence for promotion | **YES** — ensures only geometrically-valid artifacts reach CAD | No |
| `PHASE0_CONTRADICTION_PROMOTION_GATE` | **NO** — only affects canonical promotion | **YES** — blocks promotion if contradiction reports exist | **YES** — prevents contradicted geometry from reaching CAD | No |
| `PHASE0_CANONICAL_MIN_CONFIDENCE` + `_THRESHOLD` | **NO** — only affects canonical promotion | **YES** — sets minimum confidence for promotion (default 55) | **YES** — ensures only confident artifacts reach CAD | No |
| `PIPELINE_A_CLASS_MAP` (unconditional `rectangular_region_candidate → roof_plane`) | **YES** — determines geometryClass for Pipeline A artifacts | Indirect — wrong geometryClass may affect promotion logic | **YES** — wrong geometryClass flows to CAD if promoted | No |
| `PIPELINE_B_CLASS_MAP` (candidate → geometry mapping) | **YES** — determines geometryClass for Pipeline B plane/line artifacts | Indirect | **YES** | No |
| `excludeFromGeometry` flag | **PARTIAL** — reduces opacity + dashed stroke, but artifact STILL VISIBLE with wrong label | **YES** — excluded masks don't participate in geometry stages | **YES** — excluded masks not used in CAD | No |
| `minConfidence: 0` in bundle API | **YES** — all artifacts pass through regardless of confidence | N/A (API concern) | N/A | No |
| `ON CONFLICT DO NOTHING` in artifact store | **YES** — stale artifacts persist alongside new ones | **Indirect** — stale raw_evidence with wrong labels drags bundle authority down | No | No |

### Key Finding

**4 of 6 Phase 0 flags are POST-CLASSIFICATION gates that only affect canonical promotion.** They have ZERO effect on the overlay because the overlay shows ALL artifacts including `raw_evidence`. The overlay displays whatever `segmentationClass` and `geometryClass` were baked in during pipeline execution. If artifacts were created before Phase 0 flags were enabled, the overlay will show the original (incorrect) classifications forever.

Only `PHASE0_BACKGROUND_CLASS` and `PHASE0_CANNY_BACKGROUND_FIX` affect classification itself — but only for NEW pipeline executions. They do NOT retroactively fix existing artifacts.

---

## PART 3: Root Cause Analysis — 10 Hypotheses with Likelihood Scores

### H1: Stale Artifacts in Unified Table (Pre-Phase-0 Classification)

**Likelihood: 95%** — Confirmed by code

`writeUnifiedArtifact()` uses `ON CONFLICT (id) DO NOTHING`. Each adapted artifact gets a new UUID. Re-running the pipeline creates NEW artifacts alongside OLD ones. The bundle API reads from the unified table and returns ALL artifacts including those created before Phase 0 flags were enabled. No automatic cleanup or invalidation when flags change.

**Evidence:** `unifiedArtifactStore.ts` — `writeUnifiedArtifact()` SQL uses `ON CONFLICT (id) DO NOTHING`; `writeUnifiedArtifacts()` generates new UUIDs via `crypto.randomUUID()`; `deleteUnifiedArtifactsBySurvey()` exists but is never called automatically.

### H2: FALLBACK Path Re-adapts Old Source Artifacts

**Likelihood: 85%** — Confirmed by code

When the unified table has no pipeline artifacts (or `hasPipelineArtifacts` is false), the bundle API falls back to querying source tables directly and re-adapting them via `pipelineAdapters.ts`. The adapters apply the same unconditional class maps (`PIPELINE_A_CLASS_MAP`, `PIPELINE_B_CLASS_MAP`) without checking Phase 0 flags. Old source artifacts with wrong `candidateType` values get mapped to wrong `geometryClass` values.

**Evidence:** `bundle/route.ts` — FALLBACK path calls `adaptPhotoVisionBundle()` and `adaptGeometryReconBundle()`; `pipelineAdapters.ts` — `PIPELINE_A_CLASS_MAP` is a static lookup with no conditional logic.

### H3: PIPELINE_A_CLASS_MAP Unconditional `rectangular_region_candidate → roof_plane`

**Likelihood: 80%** — Confirmed by code

Any Pipeline A artifact with `candidateType === 'rectangular_region_candidate'` is mapped to `geometryClass: 'roof_plane'` unconditionally. This means any rectangular region detected by Photo Vision — including vehicles, sheds, boxes, ground patches — becomes a "Roof Plane" in the overlay. The renderer then shows it with green fill and "Roof Plane" label.

**Evidence:** `pipelineAdapters.ts` — `PIPELINE_A_CLASS_MAP = { rectangular_region_candidate: 'roof_plane', wall_plane_candidate: 'wall_plane', ... }`; `adaptPhotoVisionCandidate()` uses `PIPELINE_A_CLASS_MAP[candidate.candidateType] ?? 'unknown'`.

### H4: Canny Fallback Bug — Unknown Upper-Half Contours Default to `probable_roof_plane`

**Likelihood: 75%** — Confirmed by code, partially mitigated by Phase 0 flag

When `PHASE0_CANNY_BACKGROUND_FIX` is OFF, `classifyAndScoreContour()` routes any unclassifiable contour in the upper half of the image to `'probable_roof_plane'` at confidence 35. This is the single largest source of false positive contamination from the Canny sub-pipeline. Phase 0 fixes this for NEW runs, but existing artifacts retain the old classification.

**Evidence:** `roofGeometryExtractor.ts` — the fallback branch at the end of `classifyAndScoreContour()`: `else if (normArea > 0.01 && normYCenter < 0.5)` → `classification = 'probable_roof_plane'` at confidence 35 (or `'background'` at 20 if flag enabled).

### H5: `excludeFromGeometry` Not Suppressed in Overlay

**Likelihood: 70%** — Confirmed by code

Masks with `excludeFromGeometry === true` (sky exceeding area threshold, weak structures) still render in the overlay. They get reduced opacity (0.04) and dashed stroke (4,4), but they are still VISIBLE and still display their (potentially wrong) `segmentationClass` label in the tooltip. The user sees a dashed region colored by its original classification — which may be incorrect.

**Evidence:** `UnifiedGeometryOverlayRenderer.tsx` — the `isExcludedFromGeometry` check: `const excludedFillOpacity = isExcludedFromGeometry ? 0.04 : undefined;` and `const excludedStrokeDash = isExcludedFromGeometry ? '4,4' : undefined;`. No code path removes or hides the artifact.

### H6: Bundle API `minConfidence: 0` Passes All Artifacts

**Likelihood: 65%** — Confirmed by code, compound effect with H1/H4

The bundle API route sets `minConfidence: 0` in the `BundleBuilder`, meaning ALL artifacts pass through regardless of confidence score. Low-confidence false positives (like the Canny `probable_roof_plane` at confidence 35) are served to the overlay. The overlay renderer only applies confidence filtering for `roof_line` artifacts (threshold 60), not for polygons or segmentation masks.

**Evidence:** `bundle/route.ts` — `minConfidence: 0`; `UnifiedGeometryOverlayRenderer.tsx` — confidence filter only for `geometryClass === 'roof_line'`.

### H7: SAM2 Class Hints Are Position-Based Heuristics, Not Semantic Understanding

**Likelihood: 60%** — Confirmed by code, systemic issue

The SAM2 Python service provides `classHint` strings that are based on position heuristics (e.g., "upper region = roof candidate"), not actual semantic understanding of image content. `mapSAM2ClassHint()` is a simple string lookup table. When the heuristic is wrong (e.g., a vehicle in the upper half gets hint "roof"), the classification is wrong. Phase 0's `PHASE0_BACKGROUND_CLASS` routes unclassifiable hints to `'background'`, but this is a blanket fallback — it doesn't fix misclassified hints that DO have a mapping.

**Evidence:** `sam2Client.ts` — `mapSAM2ClassHint()` looks up `SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS[hint]`; Python service sends `roof_only=true` to filter non-roof masks but the classHint itself is position-based.

### H8: Dual-Write Accumulation (New UUIDs Alongside Old)

**Likelihood: 55%** — Confirmed by code, compound with H1

Each pipeline run generates new UUIDs for adapted artifacts. Since `writeUnifiedArtifact()` does `ON CONFLICT (id) DO NOTHING` (and each artifact gets a fresh UUID), old artifacts are never overwritten. The unified table accumulates artifacts from every pipeline run. The bundle API returns ALL of them. The overlay shows ALL of them. Over time, the overlay becomes more cluttered with wrong classifications, not less.

**Evidence:** `unifiedArtifactStore.ts` — artifact IDs are `crypto.randomUUID()` generated at adaptation time; SQL is `INSERT ... ON CONFLICT (id) DO NOTHING`.

### H9: Vegetation Confusion — SAM2 Cannot Distinguish Tree Canopy from Roof

**Likelihood: 50%** — Architectural limitation, not a bug per se

SAM2 is class-agnostic and relies on `classHint` from the Python service for classification. Tree canopy adjacent to or overhanging a roof will get a `classHint` based on position, not semantics. If the Python service says "upper region = roof", tree canopy in the upper half gets classified as `'roof'`. Phase 0 doesn't address this because it only provides a background fallback — it doesn't add semantic disambiguation.

**Evidence:** `sam2Client.ts` — `mapSAM2ClassHint()` has entries for `'tree'` → `'tree'` but if the classHint is wrong (says "roof"), it maps to `'roof'` instead. The `SEGMENTATION_CLASS_COLORS` in the renderer has separate entries for `'tree'` (green) and `'roof'` (green) — they'd look similar anyway.

### H10: Renderer Trusts All Labels Without Validation

**Likelihood: 45%** — Confirmed by code, but this is by design (renderer should be a display layer)

The overlay renderer performs no validation or sanity checking on artifact labels. It does not check for impossible geometry (e.g., a "roof" polygon covering 90% of the image including the bottom half). It does not cross-reference `geometryClass` against `segmentationClass`. It does not check authority state. It is a pure display layer that renders whatever the API gives it.

**Evidence:** `UnifiedGeometryOverlayRenderer.tsx` — the color selection logic simply looks up `SEGMENTATION_CLASS_COLORS[artifact.segmentationClass]` or `GEOMETRY_CLASS_OVERLAY_COLORS[artifact.geometryClass]` with no validation; the `sanitizePolygonVertices()` function only validates geometry coordinates, not semantic correctness.

---

## PART 4: Cache/Invalidation Audit

### Artifact Persistence Layers

| Layer | Location | Invalidation Mechanism | Automatic on Flag Change? |
|---|---|---|---|
| Unified geometry artifacts table | PostgreSQL `unified_geometry_artifacts` | `deleteUnifiedArtifactsBySurvey()` / `deleteUnifiedArtifactsByPipeline()` | **NO** — never called automatically |
| Pipeline A source candidates | PostgreSQL (photo_vision_candidates table) | Per-survey deletion on re-run | Partial — re-run overwrites, but old adapted artifacts in unified table persist |
| Pipeline B source artifacts | PostgreSQL (geometry_reconstruction_artifacts table) | Per-survey deletion on re-run | Partial — same as above |
| Bundle API response | Server-side (Next.js route handler) | No caching — computed per request | N/A — no caching, but stale source data means stale response |
| Overlay renderer (client) | React component state | Re-render on data fetch | N/A — renderer displays whatever the API returns |

### Invalidation Gap Analysis

1. **No flag-change hook:** When `PHASE0_BACKGROUND_CLASS` or `PHASE0_CANNY_BACKGROUND_FIX` is toggled, no code path invalidates or re-classifies existing artifacts. The flags are read at call time during pipeline execution only.

2. **No cascade deletion:** Re-running the segmentation worker writes new artifacts but doesn't delete old unified table entries. `deleteUnifiedArtifactsByPipeline()` exists but is never invoked.

3. **No version stamping:** Artifacts don't carry a "phase" or "flag state" version. There's no way to distinguish an artifact created with Phase 0 flags ON from one created with flags OFF.

4. **FALLBACK path bypasses unified table entirely:** If unified table has no pipeline artifacts, the FALLBACK path re-reads from source tables and re-adapts on every API call. This means even if you clean the unified table, the FALLBACK path will re-create wrong classifications from old source data.

5. **No conditional re-adaptation:** Pipeline adapters don't check Phase 0 flags. Even if the flags are now ON, the adapters apply the same static class maps regardless. The only place flags matter is during pipeline execution (new mask generation).

6. **Bundle API `minConfidence: 0`:** No confidence-based filtering means even artifacts below any reasonable threshold are served. The renderer applies no polygon/mask confidence filter (only roof_line).

### Invalidation Sequence Required (Audit Finding, Not Implementation)

For the overlay to reflect Phase 0 corrections, ALL of the following would need to happen:
1. Delete existing unified artifacts for the survey
2. Re-run the segmentation pipeline WITH Phase 0 flags enabled
3. Ensure the FALLBACK path is never hit (unified table must have pipeline artifacts after step 2)
4. Ensure no old source artifacts remain that could be re-adapted incorrectly

Currently, NONE of these steps happen automatically. Step 1 requires manual intervention (calling `deleteUnifiedArtifactsBySurvey()`). Step 3 is fragile — if the unified table write fails, the FALLBACK path will re-adapt old data.

---

## PART 5: Label Ownership Matrix

For each visible label in the overlay, trace back to the originating component and code location.

| Visible Label | Color in Overlay | Originating Field | Set By (Code Location) | Phase 0 Aware? |
|---|---|---|---|---|
| "Roof" (green) | `#34d399` stroke, `rgba(52,211,153,0.15)` fill | `segmentationClass: 'roof'` | SAM2: `mapSAM2ClassHint()` in `sam2Client.ts` looking up `SAM2_CLASS_HINT_TO_SEGMENTATION_CLASS` / Canny: `classifyAndScoreContour()` → `CONTOUR_TO_SEGMENTATION_CLASS['probable_roof_plane']` in `runSegmentationWorker.ts` | Partially — SAM2: only if classHint is not found (routed to background); Canny: only the fallback branch |
| "Wall" (cyan) | `#06b6d4` stroke, `rgba(6,182,212,0.15)` fill | `segmentationClass: 'wall'` | SAM2: `mapSAM2ClassHint()` / Canny: `classifyAndScoreContour()` → `CONTOUR_TO_SEGMENTATION_CLASS['probable_wall_plane']` | No — no Phase 0 flag for wall misclassification |
| "Roof Plane" (green) | `#34d399` stroke, `rgba(52,211,153,0.15)` fill | `geometryClass: 'roof_plane'` | Pipeline A: `PIPELINE_A_CLASS_MAP['rectangular_region_candidate']` in `pipelineAdapters.ts` / Pipeline B: `PIPELINE_B_CLASS_MAP['roof_plane_candidate']` / `adaptRoofPlaneCandidate()` | **NO** — PIPELINE_A_CLASS_MAP is unconditional |
| "Wall Plane" (cyan) | `#06b6d4` stroke, `rgba(6,182,212,0.15)` fill | `geometryClass: 'wall_plane'` | Pipeline A: `PIPELINE_A_CLASS_MAP['wall_plane_candidate']` / Pipeline B: `PIPELINE_B_CLASS_MAP['wall_plane_candidate']` | **NO** — static map |
| "Sky" (light blue) | `#38bdf8` stroke, `rgba(56,189,248,0.06)` fill | `segmentationClass: 'sky'` | Canny: `classifyAndScoreContour()` → `probable_sky_region` → `CONTOUR_TO_SEGMENTATION_CLASS` | No — sky detection is color+position based, not Phase 0 gated |
| "Tree" (green) | `#22c55e` stroke, `rgba(34,197,94,0.14)` fill | `segmentationClass: 'tree'` | SAM2: `mapSAM2ClassHint()` — requires correct classHint from Python service | No — relies on Python service classHint accuracy |
| "Background" (gray) | `#d1d5db` stroke, `rgba(209,213,219,0.04)` fill | `segmentationClass: 'background'` | SAM2: `mapSAM2ClassHint()` when hint not found + `PHASE0_BACKGROUND_CLASS` enabled / Canny: `classifyAndScoreContour()` fallback when `PHASE0_CANNY_BACKGROUND_FIX` enabled | **YES** — only appears when Phase 0 flags are ON |
| "Obstruction" (pink) | `#f472b6` stroke, `rgba(244,114,182,0.10)` fill | `segmentationClass: 'obstruction'` | Canny: `classifyAndScoreContour()` → `probable_obstruction` | No |
| "Ground" (lime) | `#a3e635` stroke, `rgba(163,230,53,0.08)` fill | `segmentationClass: 'ground'` | Canny: `classifyAndScoreContour()` → `probable_ground_noise` → `CONTOUR_TO_SEGMENTATION_CLASS` | No |
| "Equipment" (purple) | `#c084fc` stroke, `rgba(192,132,252,0.10)` fill | `segmentationClass: 'equipment'` | Canny: `classifyAndScoreContour()` → `probable_equipment` | No |
| "Car" (gray) | `#6b7280` stroke, `rgba(107,114,128,0.04)` fill | `segmentationClass: 'car'` | SAM2: `mapSAM2ClassHint()` — requires correct classHint | No — relies on Python service |
| "?" (gray) | `#94a3b8` stroke, `rgba(148,163,184,0.06)` fill | `geometryClass: 'unknown'` | Pipeline A: `PIPELINE_A_CLASS_MAP` fallback (`?? 'unknown'`) | No |
| "Consensus" (teal) | `#2dd4bf` stroke, `rgba(45,212,191,0.12)` fill | `geometryClass: 'consensus_plane'` | Multi-view consensus pipeline | Indirect — consensus depends on input quality |

### Label Authority Chain

```
Python Service (classHint heuristics)
    → sam2Client.ts (mapSAM2ClassHint)
    → runSegmentationWorker.ts (CONTOUR_TO_SEGMENTATION_CLASS)
    → pipelineAdapters.ts (PIPELINE_A_CLASS_MAP, PIPELINE_B_CLASS_MAP, geometryClass assignment)
    → unifiedArtifactStore.ts (persists with ON CONFLICT DO NOTHING)
    → bundle/route.ts (reads ALL, no filtering)
    → UnifiedGeometryOverlayRenderer.tsx (renders as-is)
    → USER SEES LABEL
```

Every label the user sees was determined at Steps 1-3. Steps 4-7 are passive conduits that never re-evaluate or correct the classification.

---

## PART 6: Gap Analysis — Why the Screenshot Still Looks Wrong

### The Fundamental Gap

**Phase 0 implemented classification fixes and promotion gates, but the overlay shows PRE-CLASSIFICATION data from BEFORE Phase 0 was enabled.**

The overlay reads from stored artifact records. Those records contain `segmentationClass` and `geometryClass` values that were baked in during pipeline execution. Phase 0 flags only affect new pipeline executions — they do not retroactively update existing artifacts.

### Specific Symptom → Cause Mapping

| User-Reported Symptom | Root Cause | Code Evidence |
|---|---|---|
| Sky regions classified as roof | Canny fallback: upper-half unknown → `probable_roof_plane` (H4). Stale artifacts from pre-Phase-0 run (H1). | `roofGeometryExtractor.ts`: fallback branch `normYCenter < 0.5` → `'probable_roof_plane'` conf 35 |
| Vehicles as structures | `PIPELINE_A_CLASS_MAP` unconditionally maps `rectangular_region_candidate → roof_plane` (H3). A vehicle bounding box from Pipeline A becomes a "Roof Plane" | `pipelineAdapters.ts`: `PIPELINE_A_CLASS_MAP['rectangular_region_candidate'] = 'roof_plane'` |
| Roof edges as solar | `segmentationClass: 'roof'` from incorrect SAM2 classHint. Overlays show "Roof" (green) on edge regions that should be `fascia`, `soffit`, or `railing` | `sam2Client.ts`: classHint heuristics don't distinguish roof sub-structures |
| Vegetation confusion | SAM2 classHint heuristics can't distinguish tree canopy from roof surface (H9). `classHint` is position-based, not semantic | `sam2Client.ts`: Python service provides position-based hints |
| Floating walls / impossible geometry labels | `PIPELINE_A_CLASS_MAP` maps `wall_plane_candidate → wall_plane` without geometry validation (H3). Pipeline A bbox-derived polygons from `adaptPhotoVisionCandidate()` create rectangular "wall planes" that may not correspond to actual walls | `pipelineAdapters.ts`: `adaptPhotoVisionCandidate()` derives 4-vertex bbox polygon for wall_plane; `classifyAndScoreContour()` wall detection uses color+position heuristics that can misclassify |
| All of above persist after Phase 0 deployment | Stale artifacts (H1), dual-write accumulation (H8), no invalidation (Part 4), FALLBACK re-adaptation (H2) | `unifiedArtifactStore.ts`: `ON CONFLICT (id) DO NOTHING`; `bundle/route.ts`: FALLBACK path re-adapts old source data |

### Why Phase 0 Flags Don't Fix the Overlay

1. **`PHASE0_BACKGROUND_CLASS`** — Only affects new SAM2 masks during pipeline execution. Existing masks in the unified table still have their old `segmentationClass`. Even if you re-run the pipeline, old artifacts persist alongside new ones (dual-write accumulation, H8).

2. **`PHASE0_CANNY_BACKGROUND_FIX`** — Only affects new Canny contours during pipeline execution. Existing contours in the unified table still have `segmentationClass: 'roof'` from the old `probable_roof_plane` → `'roof'` mapping. Same dual-write issue.

3. **`PHASE0_DEPTH_CONTRADICTION` / `PHASE0_CANONICAL_GEOMETRY_GATE` / `PHASE0_CONTRADICTION_PROMOTION_GATE` / `PHASE0_CANONICAL_MIN_CONFIDENCE`** — These are ALL in `promotion.ts`. They only gate canonical promotion. The overlay shows ALL artifacts including `raw_evidence`. These flags have ZERO effect on what appears in the overlay.

4. **`excludeFromGeometry`** — Phase 0 sets this on more masks, but the renderer still shows them (with reduced opacity and dashed stroke). The mask still has its original (wrong) `segmentationClass` and displays with the wrong color.

### The Compound Effect

The overlay is wrong not because of a single bug, but because of a compound failure across multiple stages:

1. **Classification bugs** at pipeline execution time (Canny fallback, unconditional class maps, heuristic classHints) produce wrong `segmentationClass` and `geometryClass` values.
2. **No retroactive correction** — Phase 0 fixes classification for NEW runs but doesn't update existing stored artifacts.
3. **No cleanup** — Old artifacts persist alongside new ones due to `ON CONFLICT DO NOTHING` with new UUIDs.
4. **No filtering** — The bundle API serves everything at `minConfidence: 0`, and the renderer shows everything except low-confidence roof lines.
5. **No display suppression** — `excludeFromGeometry` only dims, doesn't hide. The wrong label and color still show.
6. **FALLBACK fragility** — Even if the unified table is cleaned, the FALLBACK path re-adapts old source data with the same wrong class maps.

---

## PART 7: Minimum Next Audit Target

### ONE Focused Investigation: Stale Artifact Reproduction

**What to investigate:** Whether the specific survey shown in the user's screenshot has artifacts in the `unified_geometry_artifacts` table that were created BEFORE Phase 0 flags were enabled, and whether those artifacts have the wrong `segmentationClass` / `geometryClass` values predicted by the hypotheses above.

**Why this is the minimum target:** All other gaps (FALLBACK path, PIPELINE_A_CLASS_MAP, excludeFromGeometry rendering, etc.) are secondary to the primary question: "Are there literally wrong-labeled artifacts in the database right now?" If the answer is yes (and this audit strongly predicts it is), then the entire overlay contamination is explained by H1 + H4 + H3, and no further investigation is needed before deciding on remediation.

**How to investigate (audit only, no code changes):**
1. Query `unified_geometry_artifacts` for the survey shown in the screenshot
2. Check `created_at` timestamps — are there artifacts from before Phase 0 deployment?
3. Check `segmentationClass` and `geometryClass` values on those old artifacts — do they match the contamination pattern (sky→roof, vehicles→roof_plane, etc.)?
4. Check if `hasPipelineArtifacts` would cause the bundle API to use the PRIMARY or FALLBACK path
5. If FALLBACK path, check the source tables (`photo_vision_candidates`, `geometry_reconstruction_artifacts`) for the same survey — what `candidateType` values exist?

**This investigation requires:** Database access to the specific survey. No code changes. No feature branches. No implementation.

**What this investigation would confirm or deny:**
- Confirms H1 (stale artifacts) if old artifacts with wrong labels exist in the table
- Confirms H2 (FALLBACK re-adaptation) if the bundle API uses the FALLBACK path and source artifacts have wrong candidateType values
- Confirms H3 (PIPELINE_A_CLASS_MAP) if `rectangular_region_candidate` artifacts exist in the source tables that should not be roof
- Confirms H4 (Canny fallback) if old Canny artifacts have `segmentationClass: 'roof'` at low confidence (around 35)

**What this investigation would NOT do:**
- Propose implementation
- Make code changes
- Design a fix
- Branch off a feature branch
- Deploy anything

---

## Appendix A: File Inventory

All files read and analyzed during this audit:

1. `app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts` — Bundle API endpoint
2. `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts` — Pipeline A/B → Unified adaptation
3. `lib/siteSurveys/unifiedGeometry/bundleBuilder.ts` — Bundle assembly and filtering
4. `lib/siteSurveys/unifiedGeometry/unifiedArtifactStore.ts` — Artifact persistence
5. `lib/siteSurveys/geometryReconstruction/workers/segmentation/runSegmentationWorker.ts` — Segmentation pipeline
6. `lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client.ts` — SAM2 integration
7. `lib/siteSurveys/unifiedGeometry/promotion.ts` — Canonical promotion gates (Phase 0)
8. `lib/assistedEvidenceSources/roofGeometryExtractor.ts` — Canny classification origin
9. `components/UnifiedGeometryOverlayRenderer.tsx` — React overlay renderer

## Appendix B: Phase 0 Feature Flags — Complete Reference

| Flag | Default | Effect Location | Effect on Overlay |
|---|---|---|---|
| `PHASE0_BACKGROUND_CLASS` | OFF (empty) | `sam2Client.ts:mapSAM2ClassHint()` | Affects NEW SAM2 classification only — routes unmatched classHints to 'background' |
| `PHASE0_CANNY_BACKGROUND_FIX` | OFF (empty) | `roofGeometryExtractor.ts:classifyAndScoreContour()` | Affects NEW Canny classification only — routes unknown upper-half contours to 'background' at conf 20 |
| `PHASE0_DEPTH_CONTRADICTION` | OFF | `promotion.ts` | None — only affects canonical promotion |
| `PHASE0_DEPTH_CONTRADICTION_ENABLED` | OFF | `promotion.ts` | None — only affects canonical promotion |
| `PHASE0_CANONICAL_GEOMETRY_GATE` | OFF | `promotion.ts:assertCanonicalEligible()` | None — only affects canonical promotion |
| `PHASE0_CONTRADICTION_PROMOTION_GATE` | OFF | `promotion.ts:assertNoContradictionBlock()` | None — only affects canonical promotion |
| `PHASE0_CANONICAL_MIN_CONFIDENCE` | OFF | `promotion.ts:assertCanonicalEligible()` | None — only affects canonical promotion |
| `PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD` | 55 | `promotion.ts:getCanonicalMinConfidenceThreshold()` | None — only affects canonical promotion threshold |

## Appendix C: Key Code Paths That Bypass Phase 0

1. **`PIPELINE_A_CLASS_MAP`** — static unconditional mapping, no flag check
2. **`adaptPhotoVisionCandidate()`** — uses PIPELINE_A_CLASS_MAP without conditionals
3. **`adaptSemanticSegmentationMask()`** — preserves segmentationClass as-is, no re-evaluation
4. **Bundle API PRIMARY path** — reads from table, no re-classification
5. **Bundle API FALLBACK path** — re-adapts from source tables using same unconditional maps
6. **BundleBuilder** — `minConfidence: 0`, no Phase 0 gates
7. **UnifiedGeometryOverlayRenderer** — trusts all labels, only filters roof_line by confidence
8. **`writeUnifiedArtifact()`** — `ON CONFLICT DO NOTHING`, no update of existing records
9. **`excludeFromGeometry`** — renderer only dims, doesn't suppress

---

*End of audit. Read-only. No code changes. No implementation proposals. No feature branches.*
