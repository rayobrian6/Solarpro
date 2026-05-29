# SolarPro Real Roof Geometry Extraction — Implementation Plan

## Part 1: Rewrite openSourcePhotoVisionWorker.ts
- [x] Replace `analyzePixels()` (96×96) with real contour extraction from `roofGeometryExtractor.ts` (512×512)
- [x] Replace `buildCandidates()` (fake index-parity + fabricated confidence) with real contour-based candidates
- [x] Integrate OpenAI Vision geometry when OPENAI_API_KEY is available
- [x] Add polygon vertex data to candidate payloads for polygon rendering
- [x] Update edge summary metrics from new extraction pipeline
- [x] Add `extractionMethod` tracking to file results

## Part 2: Fix the segmentation worker
- [x] Replace NOT_IMPLEMENTED `generateHeuristicPolygon()` with real contour extraction
- [x] Replace NOT_IMPLEMENTED `heuristicConfidence()` with real confidence from contour analysis
- [x] Wire mask cleanup pipeline (Douglas-Peucker) into segmentation output
- [x] Map `ContourClassification` to `SegmentationClass`

## Part 3: Validation
- [ ] Run typecheck (`npx tsc --noEmit`)
- [ ] Run tests (`npx vitest run`)
- [ ] Update existing test for new pipeline
- [ ] Push to GitHub
