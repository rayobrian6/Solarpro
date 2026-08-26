# LiDAR Integration — Design

**Status:** v1.0 — Aurora parity
**Owner:** `lidar-integration` agent
**Scope:** `lib/3d/lidar/` (new) + minimal touch of `components/3d/SolarEngine3D.tsx`
**Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §4, frames 0125 / 0130 / 0135

---

## 1. Goal

Match Aurora's "LiDAR Properties" panel and elevation rendering inside the Solarpro
3D design surface. Aurora's LiDAR is the single biggest visual differentiator it has
over a flat-shaded satellite view — a rainbow-colored DSM (digital surface model)
overlaid on the imagery lets designers see real roof heights, tree canopies, and
terrain shape.

The panel (top-left) and the "right-panel actions" (`Lift Roofs` / `Flatten Roofs`)
are the two Aurora surfaces we mirror. The textured-vs-raw toggle and the X/Y/Z
offset nudges are the two Aurora controls we implement.

---

## 2. Aurora parity bar (from agent.md)

> Floating panel top-left: Style (Mesh | Point Cloud), Textured (checkbox),
> X Offset (ft, ±), Y Offset (ft, ±), Z Offset (ft, ±).
> LiDAR elevation rendered as rainbow mesh (blue=low → red=high).
> "LiDAR is running..." toast during load.
> Right panel gains "Lift Roofs" + "Flatten Roofs" actions when LiDAR is active.

---

## 3. File format support

| Format | Support | Notes |
| ------ | ------- | ----- |
| LAS 1.0/1.1/1.2/1.3 | ✅ | 227-byte public header. Parser covers point data formats 0, 1, 2, 3. |
| LAS 1.4 | ✅ | 375-byte header, uint64 point count. Same point-data formats 0–3. |
| LAZ (compressed) | ❌ (out of scope v1) | Requires zstd decompressor + chunked VLR parsing. |
| COPC | ❌ (out of scope v1) | Hierarchical, needs HTTP range requests. |

**Library choice:** no new dependency. The LAS 1.x header is a documented binary
format that fits in ~150 lines of TypeScript. Adding a dependency for ~30 fields
of little-endian binary reads is not justified.

**Point Data formats covered:** 0, 1, 2, 3 (covers all USGS 3DEP data).

---

## 4. Module layout

```
lib/3d/lidar/
├── DESIGN.md                  ← this file
├── types.ts                   ← LiDARPoint, LiDARDataset, LiDARStyle, LiDAROffset
├── colorRamp.ts               ← rainbow elevation ramp + normalization (pure)
├── offsetTransform.ts         ← X/Y/Z offset application in feet (pure)
├── lasParser.ts               ← minimal LAS 1.0–1.4 parser (pure, no DOM)
├── meshBuilder.ts             ← point cloud → grid-binned mesh (pure)
├── pointCloudRenderer.ts      ← Cesium PointPrimitiveCollection wrapper
├── meshRenderer.ts            ← Cesium Primitive (per-vertex color) wrapper
├── lidarController.ts         ← owns dataset + style + offset; mounts/unmounts renderers
├── LiDARPropertiesPanel.tsx   ← React UI (floating top-left)
├── useLiDARState.ts           ← React hook for parent components
├── liftRoofs.ts               ← Lift Roofs + Flatten Roofs actions
└── loadLiDAR.ts               ← File picker → dataset loader (async, with progress)
```

### Pure vs. Cesium-coupled split

Files marked **(pure)** contain only TypeScript math — no DOM, no Cesium, no
React. Files marked **Cesium** are loaded only client-side via dynamic imports
in `lidarController.ts`.

---

## 5. Data model

```ts
// types.ts
export interface LiDARPoint {
  x: number;  // easting (meters)
  y: number;  // northing (meters)
  z: number;  // elevation (meters above WGS84 ellipsoid)
  classification?: number;
  r?: number; g?: number; b?: number;
}

export interface LiDARDataset {
  source: string;
  centroidLat: number;
  centroidLng: number;
  points: LiDARPoint[];
  bounds: LiDARBounds;
  count: number;
  crs: 'local-enu';
}

export type LiDARStyle = 'mesh' | 'pointCloud';
export interface LiDAROffset { x: number; y: number; z: number; /* feet */ }
export interface LiDARState {
  dataset: LiDARDataset | null;
  style: LiDARStyle;
  textured: boolean;
  offset: LiDAROffset;
  isLoading: boolean;
  error: string | null;
}
```

---

## 6. Color ramp

Aurora's rainbow ramp goes blue → cyan → green → yellow → orange → red, blue
at the minimum Z and red at the maximum Z (frame 130). The exact stops are
the standard MATLAB-style "jet" colormap.

Implementation: piecewise-linear interpolator in HSL space (H from 240° to 0°,
S = 1, L = 0.5).

---

## 7. Offset transform

X/Y offsets are in **feet** (Aurora UI), Z offset is in **feet**. LiDAR data is
in **meters** (USGS 3DEP). Conversion: 1 ft = 0.3048 m.

- X offset: shifts east (+)
- Y offset: shifts north (+)
- Z offset: vertical shift up (+)

Survey-grade reprojection is a follow-up stage.

---

## 8. Point cloud → mesh conversion

The mesh view is a "DSM raster" — a 2D grid of cells, each containing the
mean Z of the points that fell in that cell.

Algorithm:
1. Determine the bounding box of the points.
2. Pick a grid resolution (default: 256 × 256 max).
3. Bin the points into cells, computing the mean Z per cell.
4. Empty cells get a smoothed value from the 4-neighborhood, falling back
   to the dataset mean.
5. Return vertices/colors/indices arrays for Cesium.

---

## 9. Renderers

### 9.1 Point cloud renderer

Uses Cesium's `PointPrimitiveCollection`. Each LiDAR point becomes a
`PointPrimitive` with a per-vertex color (from the color ramp).

### 9.2 Mesh renderer

Uses Cesium's `Primitive` API with one `GeometryInstance` per quad. Per-quad
color via `PerInstanceColorAppearance` (mean of the 4 vertex colors).

Textured mode = alpha 0.4 (satellite shows through).
Raw mode     = alpha 0.85 (opaque rainbow).

### 9.3 Controller

```ts
export interface LiDARController {
  setDataset(ds: LiDARDataset | null): void;
  setStyle(style: LiDARStyle): void;
  setOffset(offset: LiDAROffset): void;
  setTextured(on: boolean): void;
  destroy(): void;
}

export function createLiDARController(
  viewer: any,
  initialState: LiDARState,
): LiDARController;
```

---

## 10. UI (LiDARPropertiesPanel)

Floating top-left panel, matches Aurora's design (frame 125):
- Header "LiDAR Properties" (green pill)
- Style: dropdown (Mesh | Point Cloud)
- Textured: checkbox
- X/Y/Z Offset: numeric input + ± steppers (in feet)
- Lift Roofs / Flatten Roofs: action buttons (in panel for v1; Aurora puts
  them in the right panel which is out of v1 scope)
- Footer: file name + point count + "Load .las File" button

Toast: `"LiDAR is running..."` banner shown during file load.

---

## 11. Lift Roofs / Flatten Roofs

- `liftRoofs`:  for each roof plane, sample LiDAR Z values inside the
                 plane's bbox and pick the highest-K mean.
- `flattenRoofs`: same sampling, but use the median Z.

Bounding-box sample for v1. Polygon-clip upgrade is a follow-up.

---

## 12. Integration points in SolarEngine3D.tsx

Minimal touch — three additions:
1. **Imports** for the LiDAR module.
2. **State hook + controller** in the component body.
3. **JSX** for the panel + toast at the end of the return.

---

## 13. Tests (`tests/lidar.test.ts`)

Pure unit tests, no Cesium, no DOM:
1. LAS parser — happy path (LAS 1.2 with 100 points)
2. LAS parser — bad signature rejected
3. LAS parser — point formats 0, 1, 2, 3 all work
4. LAS parser — sub-sampling at maxPoints
5. LAS parser — bounds correctly computed
6. LAS parser — NaN-producing points dropped silently
7. Color ramp — endpoints (blue, red) + midpoint (green)
8. Color ramp — alpha helper
9. Color ramp — normalize clamps
10. Offset transform — 1 ft = 0.3048 m exactly
11. Offset transform — X/Y/Z independent
12. Offset transform — empty array is no-op
13. Offset transform — zero offset is identity
14. Offset transform — clampOffset
15. Mesh builder — regular grid produces correct cell count
16. Mesh builder — sparse data has no NaN
17. Mesh builder — vertex/index counts
18. Mesh builder — textured vs raw alpha difference
19. Lift Roofs — plane over high-Z point cluster lifts the plane
20. Lift Roofs — no points → plane unchanged
21. Lift Roofs — empty roofPlanes → empty array
22. Flatten Roofs — uses median
23. Lift Roofs / Flatten Roofs — includes Z offset
24. Type exports — DEFAULT_LIDAR_STATE has the right shape
25. loadLiDAR — loadLiDARFromBuffer stamps centroid

Target: ≥ 25 tests, all green.

---

## 14. What we are NOT doing (v1)

- **LAZ / COPC loading** — see §3. Will be a follow-up stage.
- **Waveform data (point formats 6/7/8)** — out of scope; rejected with clear error.
- **Survey-grade reprojection** — offset is a simple meter shift.
- **Multi-file dataset merging** — one file at a time.
