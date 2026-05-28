# Geometrical Refinement Layer — Task Tracker

## Build: Refinement Pipeline
- [x] Create `lib/assistedEvidenceSources/geometryRefinement.ts` — core refinement logic
  - [x] Noise filtering (no geometry, tiny boxes, giant boxes, out-of-bounds)
  - [x] IoU-based deduplication/merging
  - [x] Geometry classification (roof/wall/equipment/obstruction/ground_noise/text_label/unknown)
  - [x] Geometry scoring (area, aspect ratio, edge density, position, confidence, type)
- [x] Create `__tests__/geometryRefinement.test.ts` — tests
- [x] Run tests and fix any failures

## Build: UI Integration
- [x] Add "Refined Geometry Preview" overlay mode to `PhotoVisionOverlayRenderer.tsx`
- [x] Add overlay mode toggle (Raw / Refined) to `OpenSourcePhotoVisionPassPanel`
- [x] Ensure refined overlay renders separately from raw candidates

## Final
- [x] TypeScript check
- [ ] Commit and push
