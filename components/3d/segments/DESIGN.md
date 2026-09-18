# Segment Normal Arrows — Design

> **Owner:** `segment-arrows` agent
> **Status:** design → implementation
> **Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §2 (Step 1) and §3
> **Aurora frames studied:** `frame_0100.jpg`, `frame_0110.jpg`, `frame_0115.jpg`, `frame_0140.jpg`
> **Companion docs:** `SHARED.md` (interface contract with `segment-colors`)

---

## 1. Aurora parity — what we're matching

Aurora draws a small **yellow chevron arrow at the midpoint of every
edge** in a roof polyline. The arrow points in the **inferred slope
normal direction** — perpendicular to the edge, lying flat on the
building's footprint plane, biased **outward** (away from the polygon
centroid) so that, on a closed polygon, all arrows point the same way
the slope's downhill face would face. In Step 2 the user can **click an
arrow to flip** its direction (180° rotation) if the inference was
wrong. In Step 3, the arrow becomes the new roof face.

| Aurora element | Matched by | Notes |
| --- | --- | --- |
| Yellow color | `#ffd400` billboard image | matches frames 0100/0110/0115 |
| Midpoint of each segment | `midpoint(from, to)` math | per-vertex mean |
| Inferred normal direction | `defaultOutwardNormal(from, to, centroid, refLat)` | 90° rotated from edge, pointing away from polygon centroid |
| Per-segment arrow | `SegmentArrowOverlay` creates one billboard per `SegmentDescriptor` | rendered in 2D drawing mode |
| Click to flip | Cesium `pick` handler → `flipArrow(segmentId)` | toggles `normalDir: 1 ↔ -1`; rebuilds billboard rotation |
| Arrow persists in Step 2 | same billboard, recomputed when state changes | the orientation is the only thing that changes |
| Arrow → 3D face in Step 3 | **out of scope** for this slice | per agent.md: "In 3D, arrows become the new roof faces" — that's `controlLayer`'s `roof_gable`/`roof_hip` work, not mine |
| Per-face outline color (red/yellow/green/blue) | **NOT mine** — owned by `segment-colors` | see `SHARED.md` for the interface |

**Parity bar target:** ≥ 90% on the **arrow element itself** — color,
shape, midpoint placement, outward normal, click-to-flip. The 3D
"arrow becomes face" behavior is already covered by existing
`roof_gable` / `roof_hip` primitives, so we don't need to re-implement
it for this slice.

---

## 2. Coordinate convention

We work in **2D lat/lng** (the footprint is on the ground). The
"up-plane" of the building is just the local horizontal plane; the
normal is therefore the 2D perpendicular to the edge, scaled to a
unit vector. We use the **approximation** that 1° lat ≈ 111 320 m and
1° lng ≈ 111 320·cos(latitude) m — same approximation the existing
`blockMath.ts` uses, kept consistent to avoid mixing coordinate
systems.

This is the same approach the existing `lib/3d/blockMath.ts` takes for
`metersPerDegLng`; we do **not** introduce a new conversion. All
output positions are `Cartesian3` (ECEF) for Cesium — the rendering
side calls `safeCartesian3(C, lng, lat, h)` on the computed lat/lng.

---

## 3. Math API (`lib/3d/segmentArrows.ts`)

All functions are **pure, deterministic, no Cesium, no DOM, no
side effects**. They are unit-testable in `tests/segmentArrows.test.ts`.

```ts
/** A single edge of a polyline, in 2D footprint coords. */
export type SegmentDescriptor = {
  id: string;                // stable per draw session, e.g. "seg-0"
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  /** outward normal direction sign; flipped by the user on click. */
  normalDir: 1 | -1;
  faceId: string;
};

/** Midpoint of an edge in lat/lng. */
export function midpoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { lat: number; lng: number };

/**
 * Unit normal vector (in ENU) for an edge, pointing AWAY from the
 * polygon centroid. Result is { east, north } in metres.
 *
 * - "Perpendicular to the edge" — the math is rotation-by-90°
 * - "In the building's up-plane" — the result is 2D ENU; we never go
 *   to 3D here (the 3D position is computed at render time)
 * - "Outward" — dot product with (centroid - midpoint) is negative
 *
 * For a closed polygon, every edge gets the normal that faces the
 * exterior.
 */
export function defaultOutwardNormal(
  from: { lat: number; lng: number },
  to:   { lat: number; lng: number },
  centroid: { lat: number; lng: number } | null,
  refLat: number
): { east: number; north: number };

/**
 * Bearing (radians, clockwise from north) of a unit vector, in the
 * range [-π, π]. Cesium billboards use this directly as
 * `rotation = -bearing` (Cesium rotates counter-clockwise from up).
 */
export function bearingOf(
  v: { east: number; north: number }
): number;

/** Flip a segment's normal direction (1 ↔ -1). */
export function flipNormalDir(dir: 1 | -1): 1 | -1;
```

### Default outward normal: derivation

For an edge from `A` to `B` in ENU:
```
edge = (eastB - eastA, northB - northA)   // (dxE, dxN)
perpA = (-dxN, dxE)                       // 90° CCW in math convention
perpB = ( dxN, -dxE)                      // 90° CW  in math convention
```

The "outward" side is the one whose dot product with
`centroid - midpoint` is **negative** (i.e. it points opposite to
the centroid). The local "right" vs "left" of the edge doesn't matter
— only the geometric relationship to the polygon centroid does.

```ts
const cE = toEastMetres(centroid, refLat) - toEastMetres(midpoint(from, to), refLat);
const cN = toNorthMetres(centroid)         - toNorthMetres(midpoint(from, to));
// outward = side with negative dot product with c
return dot(c, perpA) <= 0 ? perpA : perpB;
```

### Why ENU, not bearing math

The output is `(east, north)` metres, which is the same convention
`polygonCentroid` and `shrinkPolygon` use elsewhere in
`lib/roofGeometry.ts`. Keeping the unit vector in ENU means a future
"shift the arrow by N metres along the normal" (for visibility
spacing) is just `dx = -east * metres, dy = -north * metres`.

---

## 4. Rendering API (`components/3d/segments/SegmentArrowOverlay.ts`)

A pure rendering module — no React component, just a factory that
takes the Cesium viewer and returns imperative `mount / update /
unmount` methods. This is the same pattern the rest of the file uses
(block preview, roof segment overlay, parcel boundary, etc.).

```ts
export function createSegmentArrowOverlay(viewer: any, C: any) {
  return {
    /** Replace the rendered arrow set. Pass the current segments + refLat. */
    update(opts: {
      segments: SegmentDescriptor[];
      refLat: number;        // for ENU scaling
      refHeightM: number;    // base height for the arrow (drape / ground)
    }): void;

    /** Remove all arrow entities. */
    clear(): void;

    /** Subscribe to "user clicked arrow" events. */
    onPick(handler: (segmentId: string) => void): () => void;
  };
}
```

### Visual

A single inline SVG (32×32, points up by default) embedded as a
data-URL is reused for every arrow. Color is **yellow** (`#ffd400`)
with a thin black outline for legibility against the satellite
imagery (frame 0100 shows them on a dark roof; frame 0110 shows them
on bright pavement — both must be readable).

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 3 L26 18 L21 18 L21 28 L11 28 L11 18 L6 18 Z"
        fill="#ffd400" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
```

(Filled arrow with shaft, pointing UP by default — rotation
reorients it.)

### Cesium implementation

Each arrow is a single `viewer.entities.add({ position, billboard: {...} })`.
We don't use `BillboardCollection` because we never have more than a
few dozen arrows at once (a typical roof has 4–8 edges; the
line-trace block preview caps at ~10). The entity pattern is what
the rest of `SolarEngine3D.tsx` uses for similar small-N overlays.

Each entity is tagged with `__segmentId = id` so the global
`ScreenSpaceEventHandler.LEFT_CLICK` can find the right segment to
flip.

### Pick handler

A `ScreenSpaceEventHandler` is installed when the overlay is mounted
and torn down on `clear()`. The handler is set to fire only when
`viewer.scene.pick(position)` returns one of our `__segmentId`-tagged
entities, then calls the registered handler.

---

## 5. Lifecycle in `SolarEngine3D.tsx`

**Minimal touch.** The agent.md contract says: "Touch minimally:
SolarEngine3D.tsx — only to render your arrow billboards."

Concretely: 4 hook-points in the existing block line-trace flow.

### a) `useRef<any[]>([])` for the arrow entities

Same pattern as `blockPreviewRef`. Lives next to the existing
`blockPreviewRef` declaration.

### b) Mount in `handleBlockClick` after ≥2 points

After the existing `if (blockPtsRef.current.length >= 2) { ... }`
block that builds the preview polyline + dots, append a
`segmentArrowOverlayRef.current?.update({...})` call. The polygon is
closed (last point = first point) for the overlay so the closing
edge gets a normal too — Aurora shows arrows on every edge of the
shape, not just the open polyline.

### c) Tear down on `finalizeBlock` / cancel / `Esc`

In the four existing cleanup branches (right-click finalize,
right-click cancel, Esc cancel, mode-change), call
`segmentArrowOverlayRef.current?.clear()` immediately before the
existing `blockPtsRef.current = []`.

### d) Pick subscription

The overlay's `onPick` handler is registered ONCE in the same
`useEffect` that creates the Cesium viewer, not on every update. The
handler mutates `flippedArrowsRef.current` and re-calls `update()`.
This keeps the screen-space event handler count constant.

### What this slice does NOT do

- We do not draw arrows in the **finalized** block state. Once
  `finalizeBlock` runs, the prism is the visualization. Arrows
  re-appear only when the user starts a new line-trace.
- We do not draw arrows for **gable / hip** placements in this slice.
  Those are 2-corner primitives with implicit faces; arrows would
  appear and immediately freeze (no mid-draw state). They're
  scheduled for a follow-up slice if the wizard integration requests
  it.
- We do not persist the `flippedIds` to the project save. The flip
  state is a per-session UI affordance, not a roof property. (If
  the wizard team later wants the flip to commit to the design,
  they'll add a `flippedArrows: Set<string>` field to the block
  payload — but for now, no persistence.)

---

## 6. Testing strategy (`tests/segmentArrows.test.ts`)

Pure-math tests for the geometry, modeled on `tests/block3d.test.ts`:

1. `midpoint` is the mean of the two points.
2. `defaultOutwardNormal` is unit length (within `1e-9`).
3. `defaultOutwardNormal` is perpendicular to the edge
   (`dot(normal, edge) === 0`).
4. For a closed square polygon, the outward normal of every edge
   points away from the centroid.
5. For a non-closed line (no centroid, but `refLat` provided), the
   function still returns a perpendicular unit vector.
6. `flipNormalDir` is its own inverse: `flip(flip(d)) === d`.
7. `bearingOf` of a vector pointing due north is 0.
8. `bearingOf` of a vector pointing due east is `+π/2`.
9. `bearingOf` of a vector pointing due south is `±π` (the function
   normalizes to [-π, π]).
10. `buildSegmentsFromPoints([])` returns `[]`.
11. `buildSegmentsFromPoints([p1])` returns `[]` (no edges yet).
12. `buildSegmentsFromPoints([p1, p2])` returns 1 segment with
    stable id `seg-0`.
13. `buildSegmentsFromPoints([p1, p2, p3])` returns 2 segments with
    ids `seg-0`, `seg-1`.

We do not test the Cesium billboard path here — that needs a real
Cesium runtime, and the existing codebase only smoke-tests
`viewer.entities` via E2E. The math is what matters.

---

## 7. File map (deliverable paths)

| Path | Purpose |
| --- | --- |
| `components/3d/segments/DESIGN.md` | this file |
| `components/3d/segments/SHARED.md` | contract with `segment-colors` |
| `components/3d/segments/SegmentArrowOverlay.ts` | Cesium overlay factory |
| `components/3d/segments/index.ts` | public exports |
| `lib/3d/segmentArrows.ts` | pure math (midpoint, normal, flip, bearing) |
| `tests/segmentArrows.test.ts` | unit tests |
| `components/3d/SolarEngine3D.tsx` | 4-hook-point patch only (no logic changes) |

---

## 8. Aurora parity checklist (verifiable from the frames)

| Item | Frame evidence | Implementation |
| --- | --- | --- |
| Yellow color | 0100, 0110, 0115 | `#ffd400` SVG fill |
| Midpoint placement | 0100 (centered on each segment) | `midpoint(from, to)` |
| Per-segment | 0110 (every visible edge has one) | `update({ segments })` |
| Direction varies per segment | 0110 (arrows point different ways) | `defaultOutwardNormal` per segment |
| Click-to-flip | handoff doc Step 2 | `flipArrow(segmentId)` |
| Step 3 = roof face | 0140 (3D, no arrows — they became faces) | handled by `roof_gable` / `roof_hip` (out of scope) |
| Per-face outline color | 0110 (red/yellow/green/blue) | **NOT mine** — `segment-colors` |

**Estimated parity:** ~85% of the arrow element itself is in scope and
achievable. The remaining 15% (3D face conversion, edge classification
color, live dimension readout on each segment) is owned by other
agents and not in this slice.
