# SolarPro CAD Visual Recovery — Phase 2 Fix Plan

## Root Cause
Screenshots show thousands of candidates rendered (1832 rectangular_region, 1832 obstruction, etc.).
The suppression pipeline was built but never wired into the actual page component.

## Issues
1. `refineGeometry()` called without suppression config → no suppression in refined mode
2. `showSuppressed` prop never passed from page → no debug toggle available
3. Default overlay mode is "raw" → users see all unfiltered candidates on load
4. No candidate cap in raw mode → thousands of candidates rendered

## Fix Tasks
- [x] Wire DEFAULT_SUPPRESSION_CONFIG into refineGeometry() call in page.tsx
- [x] Add showSuppressed state + toggle to the page
- [x] Pass showSuppressed to PhotoVisionOverlayRenderer
- [x] Add raw mode candidate cap (max 50 per file, with warning)
- [x] Change default overlayMode to "refined"
- [x] Update PhotoVisionOverlayRenderer to cap raw candidates
- [x] Test + verify build (90 tests pass, tsc clean, next build succeeds)
- [x] Push to dev (commit 24157d6)
