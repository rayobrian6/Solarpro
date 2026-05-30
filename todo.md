# Fix Roof Geometry Overlays — Fourth Rewrite

## Problem
The overlays show 829 roof planes, 2935 roof lines, 2711 segmentation masks —
thousands of tiny garbage regions from color quantization, not the actual shape
of the home.

## Root Causes (identified)
1. QUANT_LEVELS=6 (216 colors) too fine — creates hundreds of tiny regions
2. MIN_REGION_AREA=500 too small — lets noise through
3. MERGE_SMALL_REGION_THRESHOLD=0.003 barely filters anything
4. Connected component labeling too strict — requires exact color match
5. Classification classifies every tiny region instead of only large structural ones
6. Hough line detection produces garbage lines from edges in every texture region

## Fix Plan
- [x] Analyze root causes (above)
- [x] Rewrite extractor: coarse quantization (3 levels = 27 colors), heavy blur (sigma=3.0),
      larger minimum area (2% of image), fewer total regions (max 12)
- [x] Run three-check suite (tsc, eslint, vitest) — all 5912 tests pass
- [x] Commit and push to dev (78fa9f8)

## Status
Committed as 78fa9f8 on dev branch. All 5912 tests pass.
Pushed to GitHub. Preview at https://solarpro-v31.vercel.app
Re-run Pipeline B on survey 3021741c-5c96-48f6-bf1a-188bc1aa7f5d to see new overlays.
