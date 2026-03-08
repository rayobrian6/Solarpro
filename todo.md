# SolarPro Panel Visibility + Count Verification + Setback Visualization

## Phase 1: Deep Audit (read-only)
- [x] Trace full Auto Fill execution path with terrainReady=TRUE
- [x] Check what segElev value is computed for this location
  - cesiumGroundElevRef = googleGroundElev + OHIO_GEOID_UNDULATION (EllipsoidTerrainProvider returns 0)
  - For Illinois: ~180m - 33.5m = ~146.5m (correct Cesium ellipsoidal)
  - segElev = 146.5 + heightAboveGround (e.g. 3m) = ~149.5m ✓
- [x] Verify googlePanels vs fallback path being used
  - PRIMARY PATH: uses seg.googlePanels if available
  - FALLBACK PATH: Cartesian3 grid if googlePanels empty
- [x] Check panel entity position vs camera view frustum
  - disableDepthTestDistance=POSITIVE_INFINITY ensures always visible
  - depthTestAgainstTerrain=false set globally
- [x] Audit 45-panel count math for garage roof
  - 45 panels × 440W = 19.8 kW (or 50 × 400W = 20kW)
  - Single garage fits 6-10 panels; 45 panels = multiple segments or large roof
  - Count is from ALL eligible segments (not just garage)
- [x] Check setback zone rendering in 3D (existing code)
  - No setback visualization existed — added in v31.9
- [x] Identify all risks before any changes

## Phase 2: Fix Panel Visibility
- [x] Added rich AUTO/FILL debug logging to trace exact execution path
  - handleAutoRoof logs: segment count, cesiumGroundElev, eligible segs
  - fillRoofSegmentWithPanels logs: groundElev, hAG, segElev, path taken, placed/skipped counts
- [x] Debug panel now shows panelCount + lastLog for real-time visibility
- [x] Elevation formula verified: cesiumGroundElevRef + heightAboveGround = correct

## Phase 3: Verify Panel Count
- [x] Calculated realistic panel count for garage roof
  - Single-car (18x20ft): 6-10 panels
  - Double-car (20x20ft): 8-12 panels
  - 45 panels requires ~120m² roof (multiple segments)
- [x] maxPanels enforcement in place (seg.maxPanels from calcUsableArea)

## Phase 4: Setback Visualization in 3D
- [x] Added setback polygon overlay on selected roof segment
  - Cyan dashed polyline showing buildable area boundary
  - Inset from convexHull/polygon by SETBACK_M = 0.5m
  - Only shown when placementMode === 'auto_roof'
  - Triggered by drawOverlays() when mode changes

## Phase 5: Validate
- [x] TypeScript compile — zero errors
- [x] Build clean — zero errors
- [ ] ZIP + git push
