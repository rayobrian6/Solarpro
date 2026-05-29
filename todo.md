# Fix Survey Page UI & Get Real Roof Geometry Working

## Problem
The survey page is overwhelming with too many overlapping geometry sections, confusing labels, and no actual roof polygon shapes. The user said "There is soooo much going on here and none of it feels right. This is absolute shit."

## Plan

### 1. Consolidate geometry UI into ONE clean overlay section
- [x] Create new RoofGeometrySection component (clean, single section)
- [x] Replace 3 separate geometry sections with one unified section
- [x] Remove 711 lines of dead OpenSourcePhotoVisionPassPanel code
- [x] Clean up unused imports
- [x] Fix type errors (sourcePipeline → provenance.sourcePipeline, confidence scale)

### 2. Make Pipeline B runnable from the UI
- [ ] Add a clear "Generate Roof Geometry" button to the unified section that triggers Pipeline B
- [ ] Show progress/status inline
- [ ] When Pipeline B completes, the overlay should automatically show polygon shapes

### 3. Push and verify
- [ ] Push changes to GitHub
- [ ] Verify Vercel deployment
