# Semantic Mask Metadata Safety Patch Report

## Root cause of the previous overlay chaos

The failure was not caused by SAM2 mask rendering itself. The restored baseline showed SAM2 masks rendering cleanly, with the house/roof/tree/truck masks remaining visually usable. The chaos risk was at the adapter/renderer boundary:

1. Semantic segmentation classes were allowed to influence `geometryClass` instead of remaining mask metadata. In the restored code, `adaptSemanticSegmentationMask()` could map semantic masks into `electrical_node` and `obstruction`; prior failed work likely expanded that pattern further so non-geometry classes could enter structural or CAD-relevant rendering paths.
2. The overlay renderer trusted polygon vertices after simple normalized `0..1000 -> 0..100` conversion. It did not clamp out-of-bounds coordinates, reject NaN/Infinity, reject collapsed polygons, or reject malformed full-image diagonal spans before drawing SVG polygons.
3. Plane-like geometry classes derive filled polygons from bboxes, so any accidental semantic-to-structural mapping can make a harmless mask/bbox render like roof/wall/consensus geometry.
4. The safe fix is therefore to keep new semantics as review metadata only and harden the overlay renderer against malformed polygon input. No geometry reconstruction, CAD, permit, canonical-model, or promotion logic was changed.

## Exact files changed

- `lib/siteSurveys/unifiedGeometry/types.ts`
  - Added optional review-only semantic metadata fields: `semanticClass`, `sceneRole`, `isStructure`, `isTemporaryOccluder`, `isVegetation`, `isGroundSurface`, `cadRelevance`, `reviewRequired`.
  - Added `SemanticSceneRole` and `SemanticCadRelevance` types.
- `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts`
  - Changed semantic segmentation adaptation so every `semantic_segmentation_mask` remains `geometryClass: 'segmentation_mask'`.
  - Preserves semantic identity as metadata only.
  - Truck/car/trailer/person/ladder-style occluders remain mask metadata, not geometry.
  - Roof/wall semantic masks are marked `isStructure` with `cadRelevance: 'existing_pipeline_only'`, but are not promoted to `roof_plane` or `wall_plane`.
- `components/UnifiedGeometryOverlayRenderer.tsx`
  - Added polygon sanitation for overlay rendering only.
  - Rejects polygons with fewer than 3 valid points, NaN/Infinity coordinates, collapsed points, non-background area > 95%, and out-of-bounds malformed near-full-image spans.
  - Clamps valid polygon points to normalized image bounds before converting to SVG percent coordinates.
  - Emits a development debug warning instead of rendering invalid polygons.
- `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts`
  - Added regression coverage proving semantic masks such as `truck`, `driveway`, `window`, `utility_meter`, `roof`, and `wall` remain `segmentation_mask` artifacts and do not map to `roof_plane`, `wall_plane`, `roof_line`, or `consensus_plane`.

## Screenshot comparison

Reference screenshots inspected from the restored baseline handoff:

- `Screenshot_2026-06-02_123106.png`: SAM2 segmentation overlay remains clean enough to inspect the source photo. Truck is visually isolated in front of the house, and house/roof masks are stable. No giant diagonal polygon or out-of-bounds overlay is visible.
- `Screenshot_2026-06-02_123113.png`: Paired baseline/reference image also shows no giant diagonal or photo-escaping overlay artifact.

No browser/deployment screenshot was captured from a running app in this sandbox because the task patch is local and validation was performed at the adapter/renderer/test level. The renderer guard is deterministic: invalid polygons now return `null` and are skipped rather than drawn.

## Validation results

- TypeScript compile: `npm run type-check` passed after dependency installation.
- Targeted tests: `npm test -- lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts __tests__/overlayCoordinateConversion.test.ts __tests__/segmentationWorker.test.ts` passed.
- Test count: 3 test files passed, 127 tests passed.
- Scope review: changed files are limited to unified geometry types, unified adapter, overlay renderer, and tests. No CAD, permit, canonical model, promotion, or geometry reconstruction worker files were changed.

## Rollback plan

This patch is isolated on branch `semantic-mask-metadata-safety`. To roll it back:

```bash
git checkout dev
git branch -D semantic-mask-metadata-safety
```

If already merged or cherry-picked, revert the commit:

```bash
git revert <semantic-mask-metadata-safety-commit-sha>
```

Because no database migration, CAD logic, canonical model logic, promotion logic, permit generation, or geometry reconstruction worker logic was changed, rollback is a normal source revert only.
