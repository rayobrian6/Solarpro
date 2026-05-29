# SolarPro CAD Visual Recovery — Phase 2 Fix Plan

## Root Cause
Screenshots show thousands of candidates rendered (1832 rectangular_region, 1832 obstruction, etc.).
The suppression pipeline was built but never wired into the actual page component.

## Issues
1. `refineGeometry()` called without suppression config → no suppression in refined mode
2. `showSuppressed` prop never passed from page → no debug toggle available
3. Default overlay mode is "raw" → users see all unfiltered candidates on load
4. No candidate cap in raw mode → thousands of candidates rendered
5. Raw mode has no gating at all → every persisted candidate with drawable geometry is rendered

## Fix Tasks
- [ ] Wire DEFAULT_SUPPRESSION_CONFIG into refineGeometry() call in page.tsx
- [ ] Add showSuppressed state + toggle to the page
- [ ] Pass showSuppressed to PhotoVisionOverlayRenderer
- [ ] Add raw mode candidate cap (max ~50 per file, with warning)
- [ ] Change default overlayMode to "refined"
- [ ] Update PhotoVisionOverlayRenderer to cap raw candidates
- [ ] Test + verify build
- [ ] Push to dev
