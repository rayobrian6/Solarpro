# SolarPro Auto Fill Roof Placement Audit & Repair

## Phase 1: Audit Row Placement Tool
- [x] Find `handleRowClick` function (lines 1830-1889)
- [x] Trace how it projects onto roof plane
  - Uses `getWorldPosition(screenPos)` to get Cartesian3 of click point
  - Uses `computeSurfaceNormal(screenPos, cartesian)` to derive tilt/azimuth from 3D tiles
  - Interpolates along world-space row vector in Cartesian3
  - Converts back to lat/lng/height via `Cartographic.fromCartesian`
- [x] Document how it respects roof boundaries
  - Row tool relies on user clicking ON the roof surface
  - It does NOT clip to roof polygon — user's clicks define the row
  - It uses actual terrain/3D tiles elevation (not metadata)
- [x] Document azimuth alignment
  - Uses `computeSurfaceNormal` which samples neighbors in 8 directions
  - Heading derived from world-space row vector projected to ENU frame
- [x] Document edge clipping
  - No polygon clipping — panels placed along user-defined row only
  - Count = floor(rowLength / panelSpacing)

## Phase 2: Audit Auto Fill Tool
- [x] Find `handleAutoRoof` function (lines 2194-2220)
- [x] Trace `fillRoofSegmentWithPanels` current logic (lines 2227-2400)
  - PRIMARY PATH: Uses seg.googlePanels (Google pre-computed positions)
  - FALLBACK PATH: Azimuth-rotated grid + polygon clipping
- [x] Identify discrepancies vs Row tool
  - Auto Fill uses LAT/LNG MATH with segment metadata
  - Row tool uses CARTESIAN3 world-space with actual terrain elevation
  - Auto Fill derives tilt/azimuth from segment metadata
  - Row tool derives tilt/azimuth from actual 3D surface sampling
- [x] Find where panel count inflation occurs
  - Auto Fill fills ALL eligible segments (not just selected)
  - PRIMARY PATH may have no googlePanels → falls back to grid
  - FALLBACK grid may generate more panels than roof actually fits
  - Polygon clipping uses convexHull but may not be accurate

## Phase 3: Identify Root Causes
- [x] Determine why 456 panels generated
  - Auto Fill fills ALL eligible segments (not selected)
  - `maxPanels` per segment is IGNORED
  - Fallback grid has no upper bound
- [x] Check if googlePanels is being used
  - PRIMARY PATH exists but googlePanels may be empty
  - If Solar API fails or returns no panels, falls back to grid
- [x] Check coordinate system mismatch
  - Auto Fill uses lat/lng math with segment metadata
  - Row tool uses Cartesian3 world-space with terrain sampling
  - This is acceptable if segment metadata is accurate
- [x] Check polygon clipping failure
  - Clipping exists but convexHull may be larger than actual roof
  - No max panel count enforcement

## Phase 4: Implement Fix
- [x] Align Auto Fill with Row tool logic
  - FALLBACK PATH now uses C.Cartesian3.fromDegrees + ENU ridge/slope vectors (mirrors finalizeRow())
  - Panel positions converted via C.Cartographic.fromCartesian (same as Row tool)
- [x] Use same roof plane projection
  - ENU frame at segment center, ridge/slope direction vectors from azimuth
- [x] Use same polygon clipping
  - Ray-casting point-in-polygon against seg.convexHull
- [x] Apply setbacks
  - 0.5m SETBACK from roof edges in fallback path
  - maxPanels enforcement (area-based realistic limit per segment)

## Phase 5: Validate
- [x] TypeScript compile — 0 errors
- [x] Build — clean
- [x] Panel count sanity check — maxPanels enforced per segment
- [ ] Git push