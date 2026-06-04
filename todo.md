# Pass 3C Fixes — Segmentation Stability / Artifact Validity Patch

## Fixes — ALL APPLIED
- [x] Fix 1: Add angleDeg + coordinateSystem to inferWallBottomEdge
- [x] Fix 2: Tighten roof penetration classifier (bias toward false negatives)
- [x] Fix 3: Add polygon topology validation (self-intersection rejection)
- [x] Fix 4: Raise MIN_MASK_AREA_FRACTION 0.002 → 0.003
- [x] Fix 5: Remove window/door/garage_door from WALL_FOUNDATION_OCCLUDER_CLASSES
- [x] Fix 6: Fix snap_tolerance + minimum corner spacing + topology validation

## Tests — ALL PASSING
- [x] Unit test: self-intersecting polygon rejection (9 Python tests)
- [x] Unit test: inferred wall bottom edge has all required fields (3 TS tests)
- [x] Regression test: tree/noise fragments do not classify as chimney/vent/skylight (5 Python tests)
- [x] Regression test: windows/doors do not act as foundation occluders (5 TS tests)
- [x] TypeScript compiles cleanly (tsc --noEmit = 0 errors)
- [x] Python syntax valid (ast.parse OK)
- [ ] Before/after artifact count comparison
- [ ] Before/after screenshot comparison

## Deploy — IN PROGRESS
- [ ] Commit and push to dev
- [ ] Deploy SAM2 service + geometry worker
- [ ] Update Render env vars
- [ ] Verify no CAD/permit/canonical/promotion/worker architecture changes
