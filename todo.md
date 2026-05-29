# Roof Geometry Extraction — Session Tasks

## 1. Fix Pipeline A Button Visibility
- [ ] Change `{!hasPipelineAData && (...)}` to always show the "Run Photo Vision (Bounding Boxes)" button
- [ ] Ensure the button is visually distinguishable (secondary style) but always accessible

## 2. Improve Pipeline B Output Quality — Roof Plane Detection
- [ ] Review Pipeline B workers to understand current heuristic output
- [ ] Enhance plane extraction worker to produce more realistic polygons
- [ ] Enhance line extraction worker to detect more roof lines with varied subtypes
- [ ] Improve segmentation worker to detect obstructions and segmentation masks
- [ ] Ensure overlay renderer renders all artifact types properly

## 3. Validate & Commit
- [ ] Run `npx tsc --noEmit`
- [ ] Run `npx eslint . --ext .ts,.tsx`
- [ ] Run `npx vitest run`
- [ ] Commit and push to dev
