# SolarPro Auto Fill — Diagnostic Report
**Version:** v31.2 | **Date:** 2026-03-09

---

## SCREENSHOT ANALYSIS

The screenshot shows panels rendering as large blue rectangles scattered across roof faces at incorrect positions. Panel count shows 1801 panels / 792.4 kW — far more than a residential roof should have. This confirms panels are being generated outside valid roof boundaries.

---

## ROOT CAUSE ANALYSIS — 5 Critical Bugs

### BUG-AF-1: NO POLYGON CLIPPING (CRITICAL)
**Location:** `fillRoofSegmentWithPanels()` — no point-in-polygon test  
**Issue:** The function generates a rectangular grid over the **axis-aligned bounding box** and places ALL panels regardless of whether they fall inside the actual roof polygon. `seg.convexHull` and `seg.polygon` are stored in the segment data but **never used** in `fillRoofSegmentWithPanels`.

**Impact:** For a typical residential roof with 6 segments, the bounding box of each segment is much larger than the actual roof face. A 52m × 44m bounding box generates 989 panels, while the actual roof face might only fit 15-20 panels.

**Evidence:** Screenshot shows 1801 panels — a residential roof should have 20-40 panels maximum.

---

### BUG-AF-2: GRID ROTATION MISMATCH (CRITICAL)
**Location:** `fillRoofSegmentWithPanels()` lines ~2238-2248  
**Issue:** `bbW` and `bbH` are computed from the **axis-aligned** bounding box (lat/lng degrees × meters/degree). The grid is then **rotated by azimuth** using `dE/dN` direction vectors. This creates a fundamental mismatch:

- The bounding box dimensions are in the **lat/lng frame** (N-S × E-W)
- The grid is placed in the **azimuth-rotated frame** (along-ridge × along-slope)
- For non-cardinal azimuths (e.g., SE=135°, SW=225°), the rotated grid extends **far outside** the bounding box

**Example:** For az=135° (SE-facing), the grid is rotated 45° but sized for the axis-aligned box → panels scatter diagonally across neighboring properties.

---

### BUG-AF-3: ELEVATION TIMING RACE CONDITION (CRITICAL)
**Location:** `fillRoofSegmentWithPanels()` lines ~2253-2258  
**Issue:** 
```js
const geoidOff = cesiumGroundElevRef.current > 0
  ? cesiumGroundElevRef.current - (twinRef.current?.elevation ?? 0)
  : 0;
```
`cesiumGroundElevRef` is populated by terrain sampling in `boot()` which is **asynchronous**. If `handleAutoRoof` is called before terrain sampling completes:
- `cesiumGroundElevRef.current = 0` → `geoidOff = 0`
- `segElev = googleOrthometricElev` (e.g., 155m)
- Cesium expects **ellipsoidal height** (~185m for CONUS, ~30m higher)
- **Result:** All panels appear 30m underground, invisible in the scene

**Fallback path:** If `cesiumGroundElevRef = 0`, `geoidOff = 0`, panels use raw Google orthometric elevation → wrong coordinate system → panels underground.

---

### BUG-AF-4: GOOGLE PANELS NOT USED (HIGH)
**Location:** `fillRoofSegmentWithPanels()` — `seg.googlePanels` never accessed  
**Issue:** The Google Solar API provides **pre-computed panel positions** (`solarPotential.solarPanels`) with exact lat/lng for each panel, already correctly placed on the roof surface. These are stored in `seg.googlePanels` but `fillRoofSegmentWithPanels` ignores them entirely and recomputes from scratch using the flawed bounding-box approach.

**Impact:** The most accurate data source (Google's own panel placement) is completely unused.

---

### BUG-AF-5: PANEL DIMENSIONS INCLUDE SPACING PADDING (LOW)
**Location:** `fillRoofSegmentWithPanels()` line ~2231  
```js
const panelW = PW + 0.05;  // 1.184m
const panelH = PH + 0.10;  // 1.822m
```
The spacing padding is applied to the **grid step** (correct) but the visual panel entity uses `PW`/`PH` (correct). This is actually fine — it just adds 5cm/10cm gap between panels. **Not a bug.**

---

## FIX STRATEGY

### Primary Path: Use Google's Pre-Computed Panel Positions
Google Solar API already provides exact panel lat/lng positions per segment. These are stored in `seg.googlePanels`. Use them directly:
1. For each `googlePanel` in `seg.googlePanels`, compute Cesium height = `seg.elevation + geoidOffset`
2. Apply `PANEL_OFFSET` above the surface
3. Use `seg.pitchDegrees` and `seg.azimuthDegrees` for panel orientation
4. This gives perfectly placed panels matching Google's roof analysis

### Fallback Path: Polygon-Clipped Grid (when googlePanels is empty)
1. Generate grid in **azimuth-rotated coordinate frame** (not bounding-box frame)
2. Test each panel center against `seg.convexHull` using point-in-polygon
3. Discard panels outside the polygon
4. Use correct geoid offset with fallback to OHIO_GEOID_UNDULATION constant

### Elevation Fix
Always use: `segElev = seg.elevation + geoidOffset`  
Where `geoidOffset = cesiumGroundElevRef.current > 0 ? (cesiumGroundElevRef.current - twinRef.current.elevation) : OHIO_GEOID_UNDULATION`  
The `OHIO_GEOID_UNDULATION` constant (~-29m for CONUS) is already defined in the file as a safe fallback.

---

## SYSTEMS NOT MODIFIED
- Panel classification (systemType: 'roof') ✅
- `onPanelsChange()` callback ✅  
- `setPanelCount()` ✅
- Engineering pipeline inputs ✅
- Proposal generation ✅
- BOM generation ✅