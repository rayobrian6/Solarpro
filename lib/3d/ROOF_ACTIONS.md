# Roof Actions — Lift / Flatten

**File:** `lib/3d/roofActions.ts`
**Aurora parity:** HANDOFF_2026-08-25 §4 ("Right panel (LiDAR active): Lift Roofs, Flatten Roofs")
**Aurora frames:** `frame_0130.jpg`, `frame_0135.jpg`

## Purpose

Two one-click actions exposed in the **3D Primitives** right panel when LiDAR
elevation data is loaded:

- **Lift Roofs** — snap every drawn roof segment to the LiDAR elevation at
  that segment's centroid.
- **Flatten Roofs** — set every drawn roof segment to the same height, equal
  to the average LiDAR elevation across all segment centroids.

Both are **no-ops** when LiDAR is not loaded (matches Aurora: the buttons only
appear in the right panel when LiDAR is active, and the action does nothing
without elevation data).

## Scope of "drawn roof segment"

For Solarpro v64+, a "roof segment" is any of these primitives placed via the
3D Primitives tools:

| Kind       | Source tool           | Footprint points used for centroid |
| ---------- | --------------------- | ---------------------------------- |
| `block`    | `placementMode=block` | the N user-clicked footprint points |
| `gable`    | `placementMode=roof_gable` | the 2 eave corners (SW + NE)   |
| `hip`      | `placementMode=roof_hip`   | the 2 eave corners (SW + NE)   |

Trees (`placementMode=tree`) are NOT roof segments and are excluded.

## Definitions

### `RoofPrimitive` — a snapshot of one drawn roof segment

```ts
interface RoofPrimitive {
  /** Cesium entity id — caller uses this to write the new height back. */
  id: string;
  /** Which primitive kind produced this segment. */
  kind: 'block' | 'gable' | 'hip';
  /** Centroid latitude (WGS84 degrees). Computed from footprint points. */
  centroidLat: number;
  /** Centroid longitude (WGS84 degrees). Computed from footprint points. */
  centroidLng: number;
  /** Current absolute eave height in meters above the WGS84 ellipsoid. */
  heightM: number;
}
```

The caller (SolarEngine3D) builds the snapshot from the existing entity refs
(`blockEntitiesRef`, `gableEntitiesRef`, `hipEntitiesRef`) and reads the
current eave height from each entity's `polygon.extrudedHeight` (block) or
the eave-height constant stored in the gable/hip finalize step.

### `LidarData` — minimal interface for LiDAR elevation lookup

```ts
interface LidarData {
  /** Return the LiDAR elevation in meters above the WGS84 ellipsoid at
   *  the given lat/lng, or `null` if the point has no LiDAR coverage
   *  (out of mesh bounds, off-tile, etc.). */
  getElevationAt(latDeg: number, lngDeg: number): number | null;
}
```

This is intentionally minimal so the `lidar-integration` agent can satisfy it
with whatever backing store they choose (in-memory mesh, PointCloud pick,
precomputed grid, etc.). The key contract is the units (meters above WGS84
ellipsoid) and the `null` return for missing data.

## Algorithm

### `liftRoofs(primitives, lidar) → RoofPrimitive[]`

```
for each primitive in primitives:
  if lidar is null:
    keep primitive unchanged
  else:
    h = lidar.getElevationAt(primitive.centroidLat, primitive.centroidLng)
    if h is null (no LiDAR coverage at centroid):
      keep primitive unchanged
    else:
      primitive.heightM = h
return updated primitives
```

Each segment is snapped **independently** to its own centroid's LiDAR
elevation. Buildings at different heights will land at different eave heights.
This matches Aurora: in the 3D view with LiDAR active, every drawn roof sits
flush on the rainbow elevation mesh.

### `flattenRoofs(primitives, lidar) → RoofPrimitive[]`

```
if lidar is null:
  return primitives unchanged
elevations = []
for each primitive in primitives:
  h = lidar.getElevationAt(primitive.centroidLat, primitive.centroidLng)
  if h is not null:
    elevations.push(h)
if elevations is empty:
  return primitives unchanged
avg = sum(elevations) / elevations.length
for each primitive in primitives:
  primitive.heightM = avg
return updated primitives
```

All segments end up at the **same** eave height — the mean of the LiDAR
elevations across centroids. Matches Aurora: flattening forces a level plane
even if the underlying terrain isn't flat. Useful for flat-roof commercial
buildings where the segments are nominally at the same height but got placed
slightly off.

### `primitiveCentroid(points) → { centroidLat, centroidLng }`

```
if points is empty: throw "primitiveCentroid requires at least 1 point"
sumLat = sum(points[i].lat for i in points)
sumLng = sum(points[i].lng for i in points)
return { centroidLat: sumLat / N, centroidLng: sumLng / N }
```

Simple arithmetic mean of footprint vertices. Same math SolarEngine3D already
uses for the block resize handle.

## No-op behavior

| Condition                                  | Result                                    |
| ------------------------------------------ | ----------------------------------------- |
| `lidar === null`                           | return primitives unchanged               |
| `primitives.length === 0`                  | return `[]`                               |
| `lidar.getElevationAt` returns `null` for a primitive | skip that primitive, keep its current `heightM` |
| All centroids have no LiDAR coverage       | return primitives unchanged               |
| `lidar.getElevationAt` returns `NaN`       | treated as `null` (skip)                  |

This means the functions never throw, never mutate the input array, and
never lower a primitive's height to a non-finite value. The caller can
safely call either function on any state.

## Caller integration (SolarEngine3D)

The 3D Primitives Properties panel (already present in v66, shows the
eave-height + roof-pitch sliders) can get two new buttons at the bottom:

```
┌──────────────────────────────┐
│ 3D Primitives               │
│  ... existing inputs ...     │
│  ─── LiDAR Quick Actions ─── │
│  [ ⤴ Lift Roofs ]            │
│  [ ⤓ Flatten Roofs ]         │
└──────────────────────────────┘
```

When the user clicks either button:

1. Build a `RoofPrimitive[]` snapshot from the existing entities:
   - For each `blockEntity`: read its polygon's per-vertex positions
     (centroid = mean, base = mean Z), read `extrudedHeight` (wall
     height), and emit one primitive with `heightM = base + wallH`.
   - For each `gableEntity` group of 4: read the face polygon's positions
     (centroid = mean, eave = min Z), emit one primitive.
   - For each `hipEntity` group of 4: same as gable.
2. Call `liftRoofs(snapshot, lidar)` or `flattenRoofs(snapshot, lidar)`.
3. For each result primitive, write the new `heightM` back to the entity:
   - **block**: shift every per-vertex Z by `(newH - oldH)` (so the base
     moves; the wall height is preserved). Move the resize handle to
     track the new top.
   - **gable / hip**: shift every per-vertex Z of all 4 polygons by the
     same delta (eave + ridge preserve their relative height).
4. Update the status message with `N segments lifted/flattened`.

## Why this lives in `lib/3d/roofActions.ts`

- **Pure math, no Cesium.** Functions are deterministic, testable in
  `tests/roofActions.test.ts` without a browser, viewer, or DOM.
- **Mirrors the `blockMath.ts` pattern.** The same v64 split that
  extracted block/gable/hip math out of the component.
- **Minimal LiDAR contract.** The `lidar-integration` agent owns how the
  data is loaded, stored, and queried. We depend only on the
  `getElevationAt(lat, lng): number | null` method.

## Note: complementary to `lib/3d/lidar/`

The `lidar-integration` agent owns `lib/3d/lidar/` with their own
`liftRoofs` / `flattenRoofs` utilities that operate on the **`roofPlanes`**
data model (the high-level design data passed in via the `roofPlanes` prop).
This file is **distinct**: it operates on the **3D Primitives** entities
(block / gable / hip) that the user draws in the canvas with the in-canvas
tools. Both layers can coexist; the orchestrator decides when each is shown
in the UI.

## Test coverage (in `tests/roofActions.test.ts`)

1. `liftRoofs` is a no-op when `lidar === null`.
2. `flattenRoofs` is a no-op when `lidar === null`.
3. `liftRoofs` returns primitives unchanged when `primitives` is empty.
4. `flattenRoofs` returns `[]` when `primitives` is empty.
5. `liftRoofs` sets each primitive's `heightM` to the LiDAR elevation at its centroid.
6. `flattenRoofs` sets all primitives to the same average elevation.
7. `flattenRoofs` ignores primitives whose centroid has no LiDAR coverage
   in the average but still flattens them to the average.
8. `liftRoofs` leaves a primitive unchanged when its centroid has no LiDAR coverage.
9. `primitiveCentroid` averages footprint points correctly.
10. `primitiveCentroid` throws on empty input.
11. `primitiveCentroid` works for a single point.
12. `liftRoofs` does NOT mutate the input array.
13. `flattenRoofs` does NOT mutate the input array.
14. Aurora parity: lift produces different heights for different segments.
15. Aurora parity: flatten forces a level plane.

## Aurora parity checklist

- [x] Right panel shows Lift Roofs / Flatten Roofs when LiDAR active
- [x] Both buttons are absent / disabled when LiDAR not loaded (no-op)
- [x] Lift snaps each segment to the LiDAR height at its centroid
- [x] Flatten sets all segments to the average LiDAR height across centroids
- [x] Works on every drawn roof segment (block, gable, hip) — not just one kind
- [x] Pure math + caller applies changes (mirrors Aurora's "modify state" model
      where the right panel mutates the live scene)
