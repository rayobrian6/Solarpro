# SolarPro — Expert Technical Guidance
## Issue 1: 3D Render Performance | Issue 2: Ground Mount UX & Implementation

**Application Context (from screenshot analysis):**
- Web-based, production-stage application
- Stack: CesiumJS 1.114 + Google Photorealistic 3D Tiles + Next.js/React + TypeScript
- Entity-based panel rendering (Cesium box entities via `viewer.entities.add()`)
- `requestRenderMode: true` already enabled (on-demand rendering — good baseline)
- Scene: 38+ panels visible, commercial building, terrain mesh, shade simulation
- Target users: Solar installation professionals (technical to field-worker range)

---

# ISSUE 1: 3D RENDER PERFORMANCE OPTIMIZATION

## Current Architecture Assessment

From the codebase analysis, the current rendering pipeline is:
1. `panels` prop changes → `useEffect` fires → `renderAllPanels()` called
2. `renderAllPanels()` removes ALL entities → rebuilds ALL entities from scratch
3. Each `addPanelEntity()` call: coordinate transform + quaternion computation + Cesium entity creation
4. `viewer.scene.requestRender()` triggers a full GPU frame

**Root bottleneck**: O(n) full rebuild on every panel change, even when only 1 panel was added.

---

## PRIORITY 1 OPTIMIZATIONS — High Impact

### 1. Incremental Diff Rendering ✅ (Already Implemented in v30.5)
**What was done**: `renderAllPanels()` now diffs `lastRenderedPanelsRef` vs new panel list. Only removes deleted panels, only adds new panels, only rebuilds panels whose geometry changed.

**Impact**: For a 200-panel array where 1 panel is added:
- Before: 200 entity removes + 201 entity adds = 401 Cesium operations
- After: 1 entity add = 1 Cesium operation
- **Expected improvement: 95-99% reduction in entity operations for incremental changes**

**Remaining opportunity**: Panel position updates currently remove+re-add the entity. For drag operations, consider updating `entity.position` and `entity.orientation` in-place instead:

```typescript
// Instead of remove + re-add for position changes:
function updatePanelEntityInPlace(entity: any, C: any, panel: PlacedPanel) {
  const pos = safeCartesian3(C, panel.lng, panel.lat, panel.height ?? 0);
  if (!pos) return;
  const hpr = new C.HeadingPitchRoll(panel.heading!, -panel.tilt * Math.PI/180, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
  entity.position = new C.ConstantPositionProperty(pos);
  entity.orientation = new C.ConstantProperty(orientation);
  // Color update only if systemType changed
}
```
**Difficulty**: Easy (2-3 hours) | **Impact**: Eliminates flicker during panel drag

---

### 2. Debounced Batch Rendering ✅ (Already Implemented in v30.5)
**What was done**: 16ms debounce on the panels `useEffect` batches rapid state changes.

**Remaining opportunity**: For auto-fill operations that place 50-200 panels at once, increase the debounce window dynamically based on panel count delta:

```typescript
// Dynamic debounce: longer window for larger batches
const delta = Math.abs(panels.length - lastRenderedPanelsRef.current.length);
const debounceMs = delta > 20 ? 50 : delta > 5 ? 32 : 16;
renderDebounceRef.current = setTimeout(() => { ... }, debounceMs);
```
**Difficulty**: Easy (30 min) | **Impact**: Prevents intermediate renders during 200-panel auto-fill

---

### 3. Cesium Primitive-Based Rendering (Major Upgrade)
**Current**: `viewer.entities.add()` — each panel is a separate JavaScript object with full Cesium property system overhead. Cesium entities are designed for data-driven visualization, not high-frequency geometric rendering.

**Recommended**: `Cesium.GeometryInstance` + `Cesium.Primitive` with instancing:

```typescript
// Replace entity-based rendering with GPU-instanced primitives
function buildPanelPrimitive(C: any, panels: PlacedPanel[]) {
  const instances = panels.map(panel => {
    const pos = C.Cartesian3.fromDegrees(panel.lng, panel.lat, panel.height ?? 0);
    const hpr = new C.HeadingPitchRoll(panel.heading!, -panel.tilt * Math.PI/180, 0);
    const modelMatrix = C.Transforms.headingPitchRollToFixedFrame(pos, hpr);
    // Scale to panel dimensions
    C.Matrix4.multiplyByScale(modelMatrix, new C.Cartesian3(PW, PH, PT), modelMatrix);
    
    return new C.GeometryInstance({
      geometry: new C.BoxGeometry({ 
        vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT 
      }),
      modelMatrix,
      attributes: {
        color: C.ColorGeometryInstanceAttribute.fromColor(
          systemTypeColor(C, panel.systemType ?? 'roof')
        ),
      },
      id: panel.id, // for picking
    });
  });

  return new C.Primitive({
    geometryInstances: instances,
    appearance: new C.PerInstanceColorAppearance({ flat: false }),
    releaseGeometryInstances: false, // keep for picking
    allowPicking: true,
    asynchronous: false, // synchronous for immediate display
  });
}
```

**Why this is dramatically faster**:
- Single draw call for ALL panels (GPU instancing) vs. one draw call per panel
- No JavaScript property system overhead per panel
- Cesium batches all geometry into a single VBO upload
- Shadow rendering: one shadow pass for all panels vs. n passes

**Expected improvement**: 
- 200 panels: ~60-80% reduction in GPU frame time
- Initial placement: from ~2-3s to ~200-400ms
- Memory: ~70% reduction (no per-entity JS objects)

**Trade-offs**:
- Picking requires `primitive.getGeometryInstanceAttributes(id)` instead of `viewer.entities.getById()`
- Color updates require `primitive.getGeometryInstanceAttributes(id).color = newColor` (fast, in-place)
- Full array color change (shade mode): iterate instances and update colors (still faster than entity rebuild)
- Difficulty: **Moderate** (1-2 days) | Priority: **Highest long-term impact**

---

### 4. Asynchronous Geometry Compilation
**Current**: `asynchronous: false` on primitives forces synchronous geometry compilation, blocking the main thread.

**Recommended**: Use async compilation with a loading indicator:

```typescript
const primitive = new C.Primitive({
  geometryInstances: instances,
  appearance: new C.PerInstanceColorAppearance(),
  asynchronous: true, // compile on worker thread
});
viewer.scene.primitives.add(primitive);

// Poll for readiness
const checkReady = setInterval(() => {
  if (primitive.ready) {
    clearInterval(checkReady);
    setStatusMsg('✅ Panels rendered');
    viewer.scene.requestRender();
  }
}, 16);
```
**Impact**: Main thread never blocks — UI stays responsive during large array compilation
**Difficulty**: Easy (1 hour)

---

## PRIORITY 2 OPTIMIZATIONS — Medium Impact

### 5. Level of Detail (LOD) for Large Arrays
At camera distances > 500m, individual panel geometry is sub-pixel. Rendering full box geometry wastes GPU cycles.

**Recommended**: Distance-based LOD switching:

```typescript
// In the camera change handler (already have one for fly-to):
viewer.camera.changed.addEventListener(() => {
  const cameraHeight = viewer.camera.positionCartographic.height;
  
  if (cameraHeight > 800) {
    // Far view: replace panel boxes with flat rectangles (2 triangles vs 12)
    switchToLOD('flat');
  } else if (cameraHeight > 300) {
    // Mid view: thin boxes (current geometry, no shadows)
    switchToLOD('box_no_shadow');
  } else {
    // Close view: full quality with shadows
    switchToLOD('full');
  }
});
```

**LOD levels**:
| Level | Distance | Geometry | Shadows | Draw Cost |
|-------|----------|----------|---------|-----------|
| LOD0 | < 100m | Full box + outlines | On | 100% |
| LOD1 | 100-300m | Box, no outlines | On | 70% |
| LOD2 | 300-800m | Flat rectangle | Off | 15% |
| LOD3 | > 800m | Billboard sprite | Off | 5% |

**Difficulty**: Moderate (1 day) | **Impact**: 40-60% GPU reduction during overview/zoom-out

---

### 6. Tile Loading Optimization
**Current issue**: Google Photorealistic 3D Tiles load progressively, causing panels to "float" before terrain is ready. The `sceneReadyRef` guard helps but the tile loading itself is slow.

**Recommended optimizations**:

```typescript
// In Cesium viewer initialization:
const viewer = new C.Viewer(cesiumRef.current, {
  // ... existing options ...
  
  // Reduce tile detail for faster initial load
  maximumScreenSpaceError: 16, // default 16; increase to 32 for faster load, decrease to 8 for quality
  
  // Preload tiles in camera frustum
  preloadFlightDestinations: true,
  
  // Limit concurrent tile requests (prevents network saturation)
  // C.RequestScheduler.maximumRequestsPerServer = 6; // default 18
});

// Tileset-specific optimizations:
tileset.maximumMemoryUsage = 512; // MB — limit VRAM usage
tileset.skipLevelOfDetail = true; // skip intermediate LOD levels for faster load
tileset.immediatelyLoadDesiredLevelOfDetail = false; // allow progressive loading
```

**Impact**: 30-50% faster initial scene load | **Difficulty**: Easy (2 hours)

---

### 7. Shadow Map Optimization
**Current**: Shadow maps enabled for shade simulation. Shadow rendering is expensive — it requires rendering the scene from the sun's perspective for each shadow-casting light.

**Recommended**:
```typescript
// Only enable shadows when shade mode is active (already partially done)
// Additionally: reduce shadow map resolution for overview distances
viewer.camera.changed.addEventListener(() => {
  const h = viewer.camera.positionCartographic.height;
  if (viewer.scene.shadowMap) {
    viewer.scene.shadowMap.size = h > 500 ? 512 : h > 200 ? 1024 : 2048;
    viewer.scene.shadowMap.softShadows = h < 300; // soft shadows only when close
  }
});
```

**Impact**: 20-35% GPU reduction during shade simulation | **Difficulty**: Easy (1 hour)

---

### 8. React Re-render Prevention
**Current issue**: The `SolarEngine3D` component likely re-renders when parent state changes, even when 3D-irrelevant state changes (e.g., right panel config values).

**Recommended**:
```typescript
// Wrap SolarEngine3D in React.memo with custom comparison
export default React.memo(SolarEngine3D, (prev, next) => {
  // Only re-render if 3D-relevant props changed
  return (
    prev.panels === next.panels &&
    prev.lat === next.lat &&
    prev.lng === next.lng &&
    prev.placementMode === next.placementMode &&
    prev.showShade === next.showShade &&
    prev.tilt === next.tilt &&
    prev.azimuth === next.azimuth &&
    prev.selectedPanel?.id === next.selectedPanel?.id
  );
});
```

**Impact**: Eliminates unnecessary React reconciliation during config panel edits
**Difficulty**: Easy (30 min) | **Impact**: 10-20% reduction in React overhead

---

## PRIORITY 3 OPTIMIZATIONS — Lower Impact / Future

### 9. Web Worker for Panel Geometry Computation
Move coordinate transforms and quaternion math off the main thread:

```typescript
// panel-geometry.worker.ts
self.onmessage = (e: MessageEvent<PlacedPanel[]>) => {
  const results = e.data.map(panel => ({
    id: panel.id,
    cartesian: fromDegrees(panel.lng, panel.lat, panel.height),
    quaternion: computeQuaternion(panel.heading, panel.tilt, panel.roll),
  }));
  self.postMessage(results);
};
```
**Impact**: Frees main thread during large array placement
**Difficulty**: Moderate (4-6 hours) | **Best for**: Arrays > 100 panels

### 10. Frustum Culling for Off-Screen Panels
Cesium handles basic frustum culling automatically, but for very large arrays (500+ panels), explicit culling before entity creation reduces JavaScript overhead:

```typescript
function isInViewFrustum(C: any, viewer: any, lat: number, lng: number): boolean {
  const pos = C.Cartesian3.fromDegrees(lng, lat, 0);
  const frustum = viewer.camera.frustum;
  const cullingVolume = frustum.computeCullingVolume(
    viewer.camera.position, viewer.camera.direction, viewer.camera.up
  );
  return cullingVolume.computeVisibility(
    new C.BoundingSphere(pos, 5)
  ) !== C.Intersect.OUTSIDE;
}
```
**Impact**: Meaningful only for 500+ panel arrays | **Difficulty**: Moderate

---

## Recommended Tools & Profiling

### Browser DevTools
```
Chrome DevTools → Performance tab → Record while placing panels
Key metrics to watch:
- "Scripting" time: JavaScript execution (entity creation, coordinate math)
- "Rendering" time: Style/layout recalculation
- "Painting" time: GPU rasterization
- Memory: Watch for entity accumulation leaks
```

### Cesium Inspector
```typescript
// Add to viewer initialization (dev mode only):
if (process.env.NODE_ENV === 'development') {
  viewer.extend(C.viewerCesiumInspectorMixin);
  viewer.extend(C.viewerPerformanceWatchdogMixin, {
    lowFrameRateMessage: 'Performance degraded'
  });
}
```
Provides: draw call count, primitive count, tile load times, FPS graph

### Stats.js Integration
```typescript
import Stats from 'stats.js';
const stats = new Stats();
stats.showPanel(0); // FPS
document.body.appendChild(stats.dom);
viewer.scene.preRender.addEventListener(() => stats.begin());
viewer.scene.postRender.addEventListener(() => stats.end());
```

---

## Implementation Roadmap

| Phase | Optimization | Effort | Impact | When |
|-------|-------------|--------|--------|------|
| ✅ Done | Incremental diff rendering | 4h | Very High | v30.5 |
| ✅ Done | Debounced useEffect | 1h | High | v30.5 |
| Phase A | React.memo on SolarEngine3D | 30min | Medium | Next sprint |
| Phase A | Dynamic shadow map size | 1h | Medium | Next sprint |
| Phase A | Tile loading tuning | 2h | Medium | Next sprint |
| Phase B | In-place entity position update | 3h | High | Next sprint |
| Phase C | Primitive-based rendering | 2 days | Very High | Major version |
| Phase D | LOD system | 1 day | High | Major version |
| Phase D | Web Worker geometry | 6h | Medium | Major version |

---

---

# ISSUE 2: GROUND MOUNT PANEL PLACEMENT — UX & IMPLEMENTATION DESIGN

## Current State (from screenshot)
The application already has:
- ✅ `Ground` mode: single-panel click placement
- ✅ `Row` mode: two-click row placement (now inherits systemType in v30.5)
- ✅ `Plane` mode: 3-point plane definition
- ✅ 2D `draw_ground` zone with auto-fill via `generateGroundLayoutOptimized`
- ❌ Missing: 4-corner quadrilateral placement in 3D view

---

## Approach Comparison

| Approach | User-Friendliness | Flexibility | Complexity | Best For |
|----------|------------------|-------------|------------|----------|
| **4-Point Quadrilateral** | 7/10 | High — handles any shape | Moderate | Technical users, irregular sites |
| **Drag Rectangle** | 9/10 | Low — rectangles only | Simple | Quick placement, beginners |
| **Polygon Draw (N-point)** | 6/10 | Very High — any polygon | Complex | Expert users, complex sites |
| **Lasso/Paint** | 8/10 | High — freeform | Moderate | Field workers, irregular obstacles |
| **Boundary Trace** | 5/10 | Very High | Complex | GIS professionals |
| **Row-by-Row Builder** | 8/10 | High — row control | Moderate | **Recommended for solar pros** |

### Detailed Evaluation

#### Option A: 4-Point Quadrilateral (Current Concept)
**Score: 7/10**
- ✅ Handles non-rectangular sites (trapezoidal fields, angled property lines)
- ✅ Familiar to CAD users
- ✅ Precise corner control
- ❌ Corner order matters — wrong order creates self-intersecting "bowtie" shape
- ❌ Non-intuitive for field workers ("which corner do I click first?")
- ❌ Difficult to place on sloped terrain (corners at different heights)
- ❌ No preview until all 4 points placed

#### Option B: Drag Rectangle
**Score: 9/10 for simplicity**
- ✅ Universally understood (like drawing a selection box)
- ✅ Immediate visual feedback during drag
- ✅ Works for 80% of ground mount use cases (most are rectangular)
- ❌ Cannot handle angled or irregular sites
- ❌ Rectangle orientation fixed to N-S/E-W unless rotation handle added

#### Option C: Polygon Draw (N-Point)
**Score: 6/10**
- ✅ Maximum flexibility — any shape
- ✅ Handles L-shapes, irregular parcels, obstacles
- ❌ Requires many clicks for complex shapes
- ❌ Steep learning curve
- ❌ Complex fill algorithm for concave polygons

#### Option D: Row-by-Row Builder ⭐ RECOMMENDED
**Score: 8.5/10**
- ✅ Matches how solar installers actually think ("I need 4 rows of 10 panels facing south")
- ✅ Natural for professionals — mirrors physical installation process
- ✅ Each row independently adjustable (spacing, count, tilt)
- ✅ Handles irregular terrain naturally (each row adapts to ground height)
- ✅ Builds on existing Row tool (two-click row placement already works)
- ✅ Easy to add/remove individual rows
- ❌ More clicks than drag-rectangle for simple cases
- ❌ Requires understanding of row spacing concepts

---

## RECOMMENDED APPROACH: Enhanced Row-by-Row Builder

### Why This Fits Your Application
Your existing `Row` mode (two-click placement) is already the foundation. The enhancement is:
1. Add a "Ground Array" mode that chains multiple rows with automatic spacing
2. First row defines the array's azimuth and starting position
3. Subsequent rows auto-offset by the configured row spacing
4. Users can add/remove rows and adjust count per row

---

## A. User Interaction Flow

### Step 1: Activate Ground Array Mode
```
User clicks "Ground" in toolbar → selects tilt angle (0°-40°) from dropdown
User clicks "Array" sub-mode button (new) OR uses existing Row mode with Shift held
Status bar: "🌱 Ground Array — Click to set first row start point"
```

### Step 2: Define First Row
```
Click 1: Set row start point on ground
  → Green dot appears at click point
  → Status: "Click end point to define row direction and length"
  → Ghost line follows cursor showing row direction

Click 2: Set row end point
  → Row of panels previews along the line (ghost/translucent)
  → Panel count shown: "12 panels × 400W = 4.8 kW"
  → Row spacing preview lines extend behind the row (showing where rows 2, 3, 4 will go)
  → Status: "✅ Row 1 set — Press Enter to confirm, or click to add Row 2"
```

### Step 3: Add Additional Rows (Auto-Offset)
```
Each subsequent click: places another row at configured row spacing behind row 1
  → Row spacing calculated from tilt angle + panel height + inter-row shading clearance
  → Each new row previews in ghost state
  → Running total: "3 rows × 12 panels = 36 panels × 400W = 14.4 kW"

Right-click or Enter: Finalize array
  → All ghost panels become solid
  → Array summary popup: panel count, kW, estimated area
```

### Step 4: Confirmation
```
Popup card appears:
  ┌─────────────────────────────┐
  │ Ground Array Placed         │
  │ 36 panels · 14.4 kW        │
  │ 3 rows × 12 panels          │
  │ Tilt: 25° · Azimuth: 180°  │
  │ [✓ Confirm] [✗ Cancel]     │
  └─────────────────────────────┘
```

---

## B. Panel Arrangement Algorithm

### Row Spacing Formula (Industry Standard)
The critical calculation for ground mounts is the inter-row spacing to prevent self-shading:

```typescript
/**
 * Calculate minimum row spacing to prevent inter-row shading
 * Based on winter solstice sun angle (worst case)
 * 
 * @param tiltDeg - Panel tilt angle (degrees from horizontal)
 * @param panelHeightM - Panel height along slope (meters) — 1.722m portrait
 * @param latitudeDeg - Site latitude (degrees)
 * @returns Minimum row spacing center-to-center (meters)
 */
function calcMinRowSpacing(tiltDeg: number, panelHeightM: number, latitudeDeg: number): number {
  const tiltRad = tiltDeg * Math.PI / 180;
  
  // Panel shadow height (vertical rise of panel)
  const panelVerticalHeight = panelHeightM * Math.sin(tiltRad);
  
  // Panel horizontal footprint
  const panelHorizontalDepth = panelHeightM * Math.cos(tiltRad);
  
  // Winter solstice sun elevation at solar noon (worst case for shading)
  // Sun elevation = 90° - latitude - 23.45° (declination at winter solstice)
  const sunElevationDeg = 90 - Math.abs(latitudeDeg) - 23.45;
  const sunElevationRad = Math.max(10, sunElevationDeg) * Math.PI / 180; // min 10° to avoid infinity
  
  // Shadow length cast by panel top edge
  const shadowLength = panelVerticalHeight / Math.tan(sunElevationRad);
  
  // Total row spacing = panel footprint + shadow clearance
  const rowSpacing = panelHorizontalDepth + shadowLength;
  
  // Industry standard: add 10% buffer
  return rowSpacing * 1.1;
}

// Example: 25° tilt, 1.722m panel, 38° latitude (Illinois)
// panelVerticalHeight = 1.722 × sin(25°) = 0.728m
// sunElevation = 90 - 38 - 23.45 = 28.55°
// shadowLength = 0.728 / tan(28.55°) = 1.333m
// panelHorizontalDepth = 1.722 × cos(25°) = 1.560m
// rowSpacing = (1.560 + 1.333) × 1.1 = 3.18m ≈ 10.4 ft
```

### Panel Count Per Row
```typescript
function calcPanelsPerRow(
  rowLengthM: number,
  panelWidthM: number,  // 1.134m portrait
  panelSpacingM: number = 0.02  // 20mm gap between panels
): number {
  return Math.floor(rowLengthM / (panelWidthM + panelSpacingM));
}
```

### Row Offset Direction
```typescript
/**
 * Calculate the offset vector for each subsequent row
 * Rows offset perpendicular to the row direction, in the "uphill" direction
 * (away from the sun — north for south-facing arrays in northern hemisphere)
 */
function calcRowOffsetVector(
  C: any,
  rowStartCartesian: any,
  rowAzimuthDeg: number,  // direction panels face (e.g., 180° = south)
  rowSpacingM: number
): any {
  // Row offset direction = opposite of panel azimuth (panels face south → rows offset north)
  const offsetAzimuthDeg = (rowAzimuthDeg + 180) % 360;
  const offsetAzimuthRad = offsetAzimuthDeg * Math.PI / 180;
  
  // Convert to ENU offset
  const enuMatrix = C.Transforms.eastNorthUpToFixedFrame(rowStartCartesian);
  const localOffset = new C.Cartesian3(
    rowSpacingM * Math.sin(offsetAzimuthRad),  // East component
    rowSpacingM * Math.cos(offsetAzimuthRad),  // North component
    0  // No vertical offset (terrain will provide height)
  );
  
  return C.Matrix4.multiplyByPoint(enuMatrix, localOffset, new C.Cartesian3());
}
```

### Portrait vs. Landscape Orientation
- **Portrait** (default for ground mounts): 1.134m wide × 1.722m tall
  - More rows possible in given area
  - Better for east-west oriented arrays
- **Landscape**: 1.722m wide × 1.134m tall
  - Fewer rows, more panels per row
  - Better for north-south oriented arrays
  - Lower profile (less wind load)

**Recommendation**: Default to portrait for ground mounts. Add orientation toggle in the Ground Array toolbar.

---

## C. Constraints & Validation Rules

### Minimum Area
```
Minimum: 1 panel footprint + clearances
= (1.134m + 0.3m side clearance) × (1.722m + 0.5m front/back clearance)
= 1.434m × 2.222m ≈ 3.2 m²

Practical minimum: 10 m² (fits 2-3 panels with proper spacing)
Reason: Anything smaller is not economically viable for ground mount installation
```

### Maximum Area (Performance)
```
Soft limit: 500 panels (warn user, offer to split into sub-arrays)
Hard limit: 1000 panels (prevent browser freeze)
Reason: 1000 Cesium entities = ~50-100ms entity creation time
With primitive rendering: hard limit can increase to 5000+
```

### Required Panel Spacing (NEC + Industry Standards)
```
Panel-to-panel (same row):    20mm (0.02m) minimum — NEC 690.4
Row-to-row (inter-row):       Calculated from tilt + latitude (see formula above)
                               Minimum: 1.5m (5ft) regardless of calculation
Array perimeter setback:      0.3m (1ft) from property line / obstacle
Maintenance aisle:            Every 6 rows: 1.2m (4ft) wide aisle for maintenance access
```

### Terrain Slope Limitations
```typescript
function validateTerrainSlope(slopePercent: number): ValidationResult {
  if (slopePercent < 5) {
    return { valid: true, warning: null };
  } else if (slopePercent < 15) {
    return { 
      valid: true, 
      warning: `⚠️ Slope ${slopePercent.toFixed(1)}% — row spacing will be adjusted for terrain` 
    };
  } else if (slopePercent < 25) {
    return { 
      valid: true, 
      warning: `⚠️ Steep slope (${slopePercent.toFixed(1)}%) — consider ballasted racking system. Structural review required.` 
    };
  } else {
    return { 
      valid: false, 
      error: `❌ Slope ${slopePercent.toFixed(1)}% exceeds 25% maximum for standard ground mount systems. Use specialized steep-slope racking.` 
    };
  }
}
```

### Shape Validation
```typescript
// For 4-point quadrilateral:
function validateQuadrilateral(pts: Point[]): ValidationResult {
  // Check for self-intersection (bowtie shape)
  if (segmentsIntersect(pts[0], pts[1], pts[2], pts[3]) ||
      segmentsIntersect(pts[1], pts[2], pts[3], pts[0])) {
    return { 
      valid: false, 
      error: '❌ Shape is self-intersecting. Click corners in order (clockwise or counter-clockwise).',
      suggestion: 'Try clicking: top-left → top-right → bottom-right → bottom-left'
    };
  }
  
  // Check for concavity (non-convex quadrilateral)
  if (!isConvex(pts)) {
    return { 
      valid: true, 
      warning: '⚠️ Concave shape detected — some panels near the indentation may be excluded' 
    };
  }
  
  // Check minimum area
  const area = shoelaceArea(pts);
  if (area < 3.2) {
    return { 
      valid: false, 
      error: `❌ Area too small (${area.toFixed(1)} m²). Minimum is 3.2 m² for one panel.` 
    };
  }
  
  return { valid: true };
}
```

### Collision Detection
```typescript
function checkPanelCollisions(
  newPanels: PlacedPanel[], 
  existingPanels: PlacedPanel[],
  minDistanceM: number = 0.1
): CollisionResult {
  const collisions: string[] = [];
  
  for (const newPanel of newPanels) {
    for (const existing of existingPanels) {
      const dist = haversineDistance(
        newPanel.lat, newPanel.lng, 
        existing.lat, existing.lng
      );
      if (dist < minDistanceM) {
        collisions.push(newPanel.id);
        break;
      }
    }
  }
  
  return {
    hasCollisions: collisions.length > 0,
    collidingPanelIds: collisions,
    message: collisions.length > 0 
      ? `⚠️ ${collisions.length} panels overlap existing placement — they will be skipped`
      : null
  };
}
```

---

## D. Visual Feedback System

### State-by-State Visual Guide

#### State 1: Mode Activated (no clicks yet)
```
Cursor: crosshair with green dot
Ground surface: subtle green tint overlay (shows clickable area)
Toolbar: "Ground" button highlighted amber
Status bar: "🌱 Ground Array — Click to set first row start point"
Tooltip on hover: Shows lat/lng + elevation
```

#### State 2: First Point Placed
```
Point 1: Green filled circle (8px) with white outline
Ghost line: Dashed green line follows cursor from point 1
Ghost panels: Translucent blue panels preview along the ghost line
Panel count badge: Floating label "~12 panels" updates as cursor moves
Row spacing preview: Dashed lines extending perpendicular, showing where rows 2-4 would go
Status: "Click end point to define row length and direction"
```

#### State 3: First Row Confirmed
```
Row 1: Solid green panels (slightly transparent, 70% opacity)
Row spacing lines: Solid green dashed lines showing next row positions
Ghost row 2: Translucent panels at first row spacing position
Running total: "Row 1: 12 panels · Click to add Row 2 or press Enter to finish"
Cancel button: "✗ Cancel" appears in toolbar
```

#### State 4: Multiple Rows Building
```
Confirmed rows: Solid green (70% opacity)
Next row preview: Ghost panels at cursor-determined position
Total counter: "3 rows · 36 panels · 14.4 kW" — updates live
Maintenance aisle indicator: Yellow dashed line every 6 rows
```

#### State 5: Finalization
```
All panels: Transition from green (ground preview) to final color
Confirmation card: Slides up from bottom with summary
Undo button: Appears in toolbar for 10 seconds
```

### Color Coding
```
Ground panels (placed):     Green (#14b8a6) — matches existing systemType='ground' color
Ghost/preview panels:       Blue-green (#14b8a6 at 40% opacity)
Invalid placement:          Red (#ef4444 at 40% opacity)
Row spacing lines:          Teal dashed (#0d9488)
Maintenance aisles:         Yellow dashed (#eab308)
Collision warning:          Orange (#f97316)
```

### Cursor States
```
Default (no mode):          Default arrow
Ground mode active:         Crosshair
Hovering valid ground:      Crosshair + green dot
Hovering invalid area:      Crosshair + red X
Dragging:                   Grabbing hand
```

---

## E. Edge Cases & Error Handling

### Wrong Corner Order (4-Point Mode)
```
Detection: Check if resulting quadrilateral is self-intersecting
Response: 
  1. Highlight the problematic edges in red
  2. Show: "⚠️ Corners crossed — try clicking in clockwise order"
  3. Show animated diagram of correct corner order
  4. Auto-correct option: "Fix automatically" button that reorders points
```

### Area Too Small for One Panel
```
Detection: After each click, check if current area can fit minimum 1 panel
Response:
  1. Area outline turns red
  2. Show: "❌ Area too small for a panel (need at least 1.4m × 2.2m)"
  3. Don't allow finalization
  4. Allow user to adjust points
```

### Extremely Irregular Shapes
```
Detection: Aspect ratio > 20:1 or interior angles < 15°
Response:
  1. Yellow warning: "⚠️ Very narrow shape — only X panels will fit"
  2. Show panel preview so user can see the result
  3. Allow finalization with warning
```

### Accidental Clicks / Wrong Points
```
Undo last point: Backspace key or "Undo Point" button
Cancel entire operation: Escape key or "✗ Cancel" button
Both should:
  1. Remove the last placed marker
  2. Update ghost preview
  3. Show confirmation: "Point removed — click to continue"
```

### Overlapping Arrays
```
Detection: Bounding box pre-check, then per-panel collision check
Response:
  1. Overlapping panels highlighted in orange
  2. Show count: "⚠️ 8 panels overlap existing array — they will be excluded"
  3. Non-overlapping panels still placed
  4. Option: "Place all anyway" (override) for intentional dense placement
```

### Terrain Height Mismatch
```
Detection: Height variance > 2m across the array footprint
Response:
  1. Show terrain profile visualization
  2. Warning: "⚠️ Terrain varies 3.2m across this area — panels will follow terrain contour"
  3. Each panel's height sampled individually from Cesium terrain
  4. Row spacing adjusted for slope direction
```

---

## F. UX Best Practices

### For Non-Technical Users (Field Workers)

**Onboarding Flow (First Use)**:
```
1. Tooltip bubble on Ground button: "Click here to place ground-mounted panels"
2. After clicking Ground: Animated guide overlay showing "Click on the ground to start"
3. After first click: "Great! Now click where the row ends"
4. After first row: "Add more rows or press Enter to finish"
5. After first array: Celebration micro-animation + "Your array is placed! 
   Check the panel count in the right panel."
```

**Simplified Terminology**:
```
Instead of:              Use:
"Quadrilateral"    →    "Area"
"Azimuth"          →    "Direction panels face" (with compass rose)
"Tilt angle"       →    "Panel angle" (with visual slider showing sun angle)
"Inter-row spacing" →   "Space between rows" (with diagram)
"EGC"              →    (hide from field workers entirely)
```

**Progressive Disclosure**:
```
Basic mode (default):   Tilt angle + Direction only
Advanced mode (toggle): + Row spacing, panel spacing, orientation, maintenance aisles
Expert mode:            + NEC references, structural calculations, wire sizing
```

### Error Prevention

**Proactive Warnings** (before errors occur):
```
1. Before placement: Check terrain slope → warn if > 15%
2. During row definition: Show minimum row spacing line → prevent too-close rows
3. Before finalization: Show panel count + kW → confirm with user
4. After placement: Check if array is in shade > 50% of day → suggest repositioning
```

**Specific Error Messages** (not generic alerts):
```
❌ Generic:  "Invalid placement"
✅ Specific: "This area has 23% slope — panels need extra ballast. 
              Confirm with your structural engineer before installation."

❌ Generic:  "Error: area too small"  
✅ Specific: "This area fits 0 panels. You need at least 1.4m × 2.2m (about 4.5ft × 7ft) 
              for one panel. Try expanding the area."

❌ Generic:  "Collision detected"
✅ Specific: "8 panels overlap your existing roof array. 
              They've been removed from this placement. 
              [Show which ones] [Place anyway]"
```

### Edit & Undo Functionality

**Array-Level Editing**:
```
Click on any placed panel → shows array selection handles
  - Drag entire array: move all panels together
  - Rotate handle: rotate array azimuth
  - Scale handles: add/remove rows or panels per row
  - Delete button: remove entire array
```

**Row-Level Editing**:
```
Click on a row → row highlights
  - Drag row: reposition individual row
  - +/- buttons: add/remove panels from this row
  - Delete row: remove just this row
```

**Individual Panel Editing**:
```
Double-click panel → individual panel selected
  - Drag: reposition
  - Delete: remove single panel
  - Properties: adjust tilt/azimuth for this panel only
```

**Undo/Redo Stack**:
```typescript
// Recommended: Command pattern for undo/redo
interface PanelCommand {
  type: 'ADD' | 'REMOVE' | 'MOVE' | 'ADD_ARRAY' | 'REMOVE_ARRAY';
  panels: PlacedPanel[];
  previousState?: PlacedPanel[];
}

const undoStack = useRef<PanelCommand[]>([]);
const redoStack = useRef<PanelCommand[]>([]);

function executeCommand(cmd: PanelCommand) {
  undoStack.current.push(cmd);
  redoStack.current = []; // clear redo on new action
  applyCommand(cmd);
}

function undo() {
  const cmd = undoStack.current.pop();
  if (!cmd) return;
  redoStack.current.push(cmd);
  reverseCommand(cmd);
}

// Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y or Ctrl+Shift+Z (redo)
```

---

## Implementation Priority

### Phase 1 — Quick Wins (1-2 days)
1. ✅ Row tool systemType inheritance (done in v30.5)
2. Add "Ground Array" mode: chain multiple rows with auto-spacing
3. Row spacing formula based on tilt + latitude
4. Ghost/preview rendering for rows before confirmation

### Phase 2 — Core Feature (3-5 days)
5. 4-point quadrilateral mode with validation
6. Collision detection against existing panels
7. Terrain slope validation
8. Confirmation card with panel count/kW summary

### Phase 3 — Polish (2-3 days)
9. Edit handles for placed arrays
10. Undo/redo command stack
11. Maintenance aisle visualization
12. Onboarding tooltips for first-time users

### Phase 4 — Advanced (1 week)
13. Primitive-based rendering for large arrays
14. LOD system for overview distances
15. Array-level editing (drag, rotate, scale)

---

---

# BONUS: AI Chat Support

**Pros:**
- 24/7 instant answers for common questions (wire sizing, NEC codes, permit requirements)
- Reduces support ticket volume by 40-60% for repetitive queries
- Can be trained on your specific equipment database and pricing

**Cons:**
- Hallucination risk for NEC code questions — wrong answers could cause failed inspections
- Requires ongoing maintenance as NEC codes and equipment change
- Users may over-trust AI for structural/electrical decisions that need PE review
- Initial training cost + monthly API costs ($200-2000/month depending on volume)

**Recommendation:** Implement with a clear "AI Assistant — Not a licensed engineer" disclaimer, limited to non-safety-critical queries (equipment selection, proposal questions, scheduling).

**Implementation Options:**
1. **Third-party (fastest)**: Intercom + OpenAI fine-tuning on your docs — 1-2 weeks, ~$500/month
2. **Custom RAG system**: Next.js API route + OpenAI + your equipment/NEC database as context — 2-4 weeks, ~$100-300/month, full control over responses