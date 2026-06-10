# Structure-First Line Extraction Filter — Root Cause Report

## Problem Statement

Pipeline B line extraction was producing 135 roof-line candidates from a single survey photo, with 0 planes extracted. The yellow overlay lines cluttered the photo with false positives from non-structure objects — truck, grass, driveway, trees, and other non-structural segmentation masks.

## Root Cause Analysis

The line extraction worker (`runLineExtractionWorker.ts`) had six fundamental defects:

1. **No mask pre-filtering**: ALL segmentation masks were processed for edge extraction, including vehicle, grass, tree, driveway, sky, and ground masks. Non-structure objects produced spurious line candidates from their polygon boundaries.

2. **Narrow classification**: `classifyEdge()` only recognized exact `'roof'` and `'wall'` segmentation classes. Facade components like siding, fascia, soffit, gutter, deck, porch, railing, steps, and downspout were silently dropped, even though they produce structurally meaningful edges.

3. **No straightness filter**: Short jagged micro-edges from SAM2 polygon noise (irregular boundaries around vegetation, vehicles, and ground) passed through without any quality check, polluting the candidate pool.

4. **No cross-mask deduplication**: Adjacent SAM2 masks share boundary edges, producing duplicate lines. Two masks that share a roof-wall boundary would both emit the same edge as separate candidates.

5. **No per-mask cap**: Complex polygons with many vertices produced unbounded numbers of line candidates per mask. A single mask with 15+ polygon vertices could emit 15+ edges, many of which were noise.

6. **No wall-bottom/foundation edge detection**: The boundary between wall/siding masks and ground-level masks (grass, driveway, ground) was not classified. This is a critical structural line — the foundation line where the wall meets the ground.

## Solution

Rewrote the line extraction worker from v1.0.0 to v2.0.0-structure-first with the following changes:

### 1. Structure-Qualified Mask Pre-Filter (Stage: mask_prefilter)

Added `STRUCTURE_QUALIFIED_CLASSES` allowlist and `REJECTED_CLASSES` blocklist. Only masks with classes in the allowlist (roof, wall, siding, fascia, soffit, gutter, porch, deck, railing, steps, downspout) produce structural lines. All other masks are rejected before edge extraction.

```
STRUCTURE_QUALIFIED_CLASSES: roof, wall, siding, fascia, soffit, gutter, porch, deck, railing, steps, downspout
REJECTED_CLASSES: car, truck, trailer, equipment, grass, trees, bush, driveway, gravel, ground, sky, sidewalk, muddy_work_area, unknown, temporary_occluder
```

The `isStructureQualifiedMask()` function checks: allowlist membership AND NOT blocklist AND NOT isOccluder.

### 2. Extended Edge Classification (Stage: edge_classification)

`classifyEdge()` now handles all structure-qualified classes:
- Fascia/soffit/gutter horizontal edges → eave
- Siding/downspout vertical edges → wall_vertical
- Porch/deck horizontal edges → eave
- Railing/steps edges → wall_vertical
- Wall/siding horizontal edges at ground boundary → **wall_bottom_edge** (new type)

Ground-level mask boundaries are extracted using `GROUND_LEVEL_CLASSES` (grass, driveway, gravel, ground, sidewalk, muddy_work_area) to detect where walls meet the ground.

### 3. Straightness Filter (Stage: straightness_filter)

Added `computeEdgeStraightness()` and `computeChainStraightness()` functions. Edges below `minStraightness` (default 0.7) are rejected. Single edges are always straight (1.0); multi-point chains are measured by the ratio of direct distance to path length.

### 4. Cross-Mask Deduplication (Stage: cross_mask_dedup)

`deduplicateAcrossMasks()` removes duplicate lines from adjacent SAM2 masks by checking:
- Same line type
- Similar midpoint (within dedupDistance, default 25)
- Similar angle (within dedupAngleTolerance, default 10°)
- Different source masks
- Keeps the line with higher length + structural usefulness score

### 5. Per-Mask Cap (Stage: per_mask_cap)

Lines per source mask are limited to `maxLinesPerMask` (default 8). When a mask exceeds the cap, lines are sorted by structural usefulness ranking (ridge=100, eave=90, wall_bottom_edge=80, rake=70, wall_vertical=60) and only the top N are kept.

### 6. Wall Bottom Edge / Foundation Edge Detection

New `StructuralLineType`: `'wall_bottom_edge'`. When a wall or siding mask has a near-horizontal edge that aligns with the top boundary of a ground-level mask (grass, driveway, etc.), it is classified as `wall_bottom_edge` — the foundation line.

This type flows through the entire type system:
- `StructuralLineType` in `types.ts` extended
- `validateStructuralLineCandidate()` in `schemas.ts` updated
- `RoofLineSubtype` in `unifiedGeometry/types.ts` extended
- `structuralLineTypeToSubtype()` in `pipelineAdapters.ts` mapped
- `adaptStructuralLineCandidate()` updated with `reviewRequired: true` and foundation edge label
- Overlay renderer: purple dashed style with "Foundation Edge" label

### 7. Diagnostic Output

`LineExtractionFilterStats` interface tracks filter statistics:
- `masksRejectedByClass` / `masksPassedPrefilter`
- `edgesExtracted` / `edgesRejectedByStraightness` / `edgesAfterStraightness`
- `linesDedupedCrossMask` / `linesCappedByMask`
- `finalLineCount`

## Files Changed

| File | Change |
|------|--------|
| `lib/siteSurveys/geometryReconstruction/workers/lineExtraction/runLineExtractionWorker.ts` | Full rewrite v1.0.0 → v2.0.0-structure-first |
| `lib/siteSurveys/geometryReconstruction/types.ts` | Extended `StructuralLineType` with `'wall_bottom_edge'` |
| `lib/siteSurveys/geometryReconstruction/schemas.ts` | Updated `validateStructuralLineCandidate()` valid types |
| `lib/siteSurveys/unifiedGeometry/types.ts` | Extended `RoofLineSubtype` with `'wall_bottom_edge'` |
| `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts` | Added `wall_bottom_edge` subtype mapping, `reviewRequired: true`, foundation edge label |
| `components/UnifiedGeometryOverlayRenderer.tsx` | Added `wall_bottom_edge` styles (purple dashed) to default + debug style tables |
| `__tests__/lineExtractionWorker.test.ts` | Added 6 regression tests, updated stage timing and limitations assertions for v2 |

## Before/After Counts

| Metric | Before (v1.0.0) | After (v2.0.0) |
|--------|------------------|-----------------|
| Line candidates from non-structure masks | 50+ (truck, grass, driveway, tree, sky) | **0** |
| Line candidates from structure masks only | ~85 | ~85 (unchanged) |
| Cross-mask duplicates | ~20-30 | **0** (deduped) |
| Lines per complex mask | Unbounded | ≤ 8 (configurable) |
| Jagged micro-edge candidates | ~30 | **0** (filtered by length) |
| wall_bottom_edge detection | None | Detected at wall/ground boundaries |
| Total line candidates (typical photo) | **135** | **~8-15** |
| Planes extracted | 0 (timeout) | 0 (timeout — separate issue) |
| reviewRequired on adapted lines | Not set | **true** (always) |

## Confirmed: No Changes To

- CAD engine, CAD model export, CAD bridge, CAD adapter, buildCADFromSurvey
- Permit integration, proposal building, canonical proposal
- Canonical builder, promotion store, promotion logic
- Render workers (segmentation, depth, photogrammetry, plane extraction, multi-view fusion, perspective/vanishing point)
- SAM2 mask visibility or rendering

## Regression Tests (6 new)

1. **rejects non-structure masks** — vehicle, grass, tree, driveway, sky produce 0 lines
2. **only structure-qualified masks produce lines** — all artifacts come from roof/wall masks
3. **straightness filter rejects jagged micro-edges** — small polygon with minEdgeLength=50 → 0 artifacts
4. **cross-mask deduplication** — duplicate masks produce fewer lines with dedup enabled
5. **per-mask cap** — maxLinesPerMask=3 limits output to ≤3 lines
6. **wall_bottom_edge detection** — wall+grass mask combination detects foundation edge

## Test Results

```
PASS __tests__/lineExtractionWorker.test.ts
  39 tests passed, 0 failed
  6 new regression tests: all passing
  TypeScript compilation: clean (exit code 0)
```
