# SolarPro Auto Fill Fix — v31.3/v31.4
**Date:** 2026-03-09 | **Build:** v31.4 (auto-incremented from v31.3)

---

## What Was Fixed

### BUG-AF-1 + BUG-AF-4: Google Panel Positions (PRIMARY PATH)
**Problem:** `fillRoofSegmentWithPanels()` ignored `seg.googlePanels` entirely and used a flawed bounding-box grid, generating 1801 panels on a residential roof (should be 15-30).

**Fix:** New primary path uses `seg.googlePanels` directly:
```typescript
if (googlePanels.length > 0) {
  for (const gp of googlePanels) {
    // Use Google's exact lat/lng for each panel
    // Compute height via azimuth-projected slope offset
    // Map PORTRAIT/LANDSCAPE string to PanelOrientation type
    addPanelEntity(viewer, C, panel);
  }
  return panels; // done — no grid needed
}
```
Google Solar API already provides perfectly placed panel positions per segment. These are now used as the authoritative source.

---

### BUG-AF-2: Grid Rotation Mismatch (FALLBACK PATH)
**Problem:** Fallback grid used axis-aligned bounding box dimensions but rotated by azimuth → panels scattered diagonally outside roof for non-cardinal azimuths.

**Fix:** Fallback path now projects all 4 BB corners into the azimuth-rotated frame to compute correct `roofW` × `roofH`, then generates the grid in that frame:
```typescript
// Project BB corners into rotated frame
const r = dE * ridgeE + dN * ridgeN;  // along-ridge
const s = dE * slopeE + dN * slopeN;  // along-slope
// Grid sized to rotated-frame extent, not axis-aligned BB
```
Plus **point-in-polygon clipping** against `seg.convexHull` discards any panel outside the actual roof polygon.

---

### BUG-AF-3: Elevation Race Condition
**Problem:** `cesiumGroundElevRef.current` is populated asynchronously by terrain sampling. If Auto Fill runs before sampling completes, `geoidOff = 0` → panels placed at Google orthometric elevation (~30m underground in Cesium).

**Fix:**
```typescript
// Before (broken):
const geoidOff = cesiumGroundElevRef.current > 0
  ? cesiumGroundElevRef.current - (twinRef.current?.elevation ?? 0)
  : 0;  // ← BUG: 0 means panels underground

// After (fixed):
const geoidOff = cesiumGroundElevRef.current > 0
  ? cesiumGroundElevRef.current - (twinRef.current?.elevation ?? 0)
  : OHIO_GEOID_UNDULATION;  // ← -33.5m safe fallback for CONUS
```

---

### Orientation Fix
Both primary and fallback paths now respect `panelOrientationRef.current` (user's portrait/landscape selection). Auto Fill uses the correct panel dimensions for the selected orientation.

---

## Expected Results After Fix

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| Panel count (residential) | 1801 | 15–30 |
| Panel visibility | Mostly underground | Correctly above roof |
| Panel placement | Scattered across BB | Inside roof polygon only |
| Non-cardinal azimuths | Diagonal scatter | Aligned to roof slope |
| Orientation | Always portrait | Respects user setting |

---

## Systems Not Modified
- `onPanelsChange()` callback ✅
- `setPanelCount()` ✅
- `systemType: 'roof'` classification ✅
- Engineering pipeline inputs ✅
- Proposal generation ✅
- BOM generation ✅
- Manual panel placement (roof/ground/fence/row/plane modes) ✅