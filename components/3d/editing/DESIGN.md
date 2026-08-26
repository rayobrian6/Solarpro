# Vertex Handles — Design Doc

> **Feature:** In-place footprint editing of drawn 3D primitives (Block, Gable, Hip, Tree). Each vertex becomes a draggable handle. Drag → footprint updates in real time. Matches Aurora 2017 §2 Step 3 ("Adjust 3D model").
>
> **Owner:** `vertex-handles` agent
> **Scope:** `components/3d/editing/`, `lib/3d/vertexHandlesMath.ts`, minimal touch in `components/3d/SolarEngine3D.tsx`

---

## 1. Aurora parity check

| Aurora behavior | Frame | Solarpro status before | Status after this feature |
|---|---|---|---|
| Vertex circle at every footprint corner | frame_0090 | ❌ none | ✅ all 4 entity types |
| Click + drag a vertex | frame_0095, frame_0110 | ❌ frozen footprint | ✅ real-time update |
| 3D roof face updates as eave moves | frame_0140 | ❌ n/a | ✅ gable + hip |
| Live dimension readout while dragging | frame_0095 (`41.3ft`) | ❌ none | ✅ in status bar |
| Vertex visible in 3D view too | frame_0140 | ❌ n/a | ✅ same handle entity in 3D |

**Parity target: 100% on the listed items.** Aurora's wizard stepper / color-coded segments / yellow ridge arrows are owned by other agents and out of scope here.

---

## 2. Which entity types get handles

| Entity | Drag mode | Vertex count | Vertex location | Notes |
|---|---|---|---|---|
| `block` (line-trace prism) | per-point | N (any polygon) | each footprint point at its `h` (per-position height) | polygon can be L, T, U, etc. |
| `roof_gable` (2 sloped faces) | per-eave-corner | 4 | 4 eave corners at `eaveHeightM` | ridge recomputed from centroid |
| `roof_hip` (4 sloped faces) | per-eave-corner | 4 | 4 eave corners at `eaveHeightM` | ridge + setback recomputed |
| `tree` (foliage + trunk) | whole-position | 1 | the tree's (lat, lng) at ground | both trunk + foliage follow |

**Out of scope this round:** ridge endpoints (gable/hip), hip setback endpoints. Aurora doesn't drag those — Step 3 only adjusts the eave. The ridge and setback are derived.

---

## 3. Visual handle (the "small circle")

Mirroring Aurora's vertex markers in frame_0090 / frame_0095:

```
- filled black circle (Cesium Billboard / Point primitive)
- white outline (2 px)
- pixelSize: 12 (constant — Cesium Point primitive is screen-space sized)
- disableDepthTestDistance: Number.POSITIVE_INFINITY (always on top of geometry)
- position: at the vertex's (lat, lng, h) in world space
```

Hover state: scale to 14 px and tint orange (`#ff8c00`). Cesium's `Point` doesn't natively animate, so the integration layer swaps the entity color/material on `MOUSE_MOVE`.

Tree handle is the same primitive; only the *count* differs (1).

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ SolarEngine3D.tsx (minimal edits)                              │
│   • keeps blockEntitiesRef, gableEntitiesRef, hipEntitiesRef,  │
│     treeEntitiesRef as today                                   │
│   • NEW: builds a list of VertexSpec objects from those refs   │
│   • NEW: <VertexHandles viewer={viewer}                        │
│                       specs={specs}                            │
│                       onUpdate={handleVertexUpdate} />          │
│   • handleVertexUpdate(idx, newLat, newLng) →                  │
│       updates the affected entity's footprint polygon          │
│       (and recomputes gable/hip faces if needed)               │
└────────────────┬───────────────────────────────────────────────┘
                 │ specs (id, type, vertices[]), onUpdate callback
                 ▼
┌────────────────────────────────────────────────────────────────┐
│ components/3d/editing/VertexHandles.tsx                        │
│   • on mount/sync: build one Cesium Point per vertex per spec  │
│   • on drag: read screen pos → pick ray → lat/lng              │
│              → call onUpdate                                   │
│   • uses ScreenSpaceEventHandler (LEFT_DOWN/MOVE/UP)            │
│   • pure render — no React state for drag (refs only)          │
└────────────────┬───────────────────────────────────────────────┘
                 │ pure math (no Cesium)
                 ▼
┌────────────────────────────────────────────────────────────────┐
│ lib/3d/vertexHandlesMath.ts                                    │
│   • pickRayToLatLng helper                                     │
│   • vertexDistanceM / footprintBBoxM                           │
│   • validateVertexMove (clamp / reject degenerate)             │
│   • rebuildGableFootprint (eave corners → all face positions)  │
│   • rebuildHipFootprint (eave corners → all face positions)    │
│   • dimensionReadoutFt (live "41.3 ft" string)                 │
└────────────────────────────────────────────────────────────────┘
```

**Why split math from component:** the math is pure (no Cesium objects) and is what the gauntlet tests guard. The component is small (~150 LOC) and the Cesium interaction is best reviewed visually.

---

## 5. Drag math (cartographic → ground ray intersection)

For each `MOUSE_MOVE` during a drag:

```ts
const ray = viewer.camera.getPickRay(screenPos); // Cartesian3 ray
// 1) Try globe.pick first — gives the satellite drape height
let cartesian = viewer.scene.globe.pick(ray, viewer.scene);
// 2) Fall back to ellipsoid (pure WGS84)
if (!cartesian) {
  const ellipsoid = viewer.scene.globe.ellipsoid ?? Cesium.Ellipsoid.WGS84;
  const interval = Cesium.IntersectionTests.rayEllipsoid(ray, ellipsoid);
  if (interval) cartesian = Cesium.Ray.getPoint(ray, interval.start, new Cesium.Cartesian3());
}
if (!cartesian) return; // ray pointed at sky
const carto = Cesium.Cartographic.fromCartesian(cartesian);
const lat = Cesium.Math.toDegrees(carto.latitude);
const lng = Cesium.Math.toDegrees(carto.longitude);
```

This matches the existing `getWorldPosition()` helper in SolarEngine3D (line ~4363). The math helper exposes a pure version that takes a mocked ray.

**Per-vertex Z handling:**
- **Block** uses `perPositionHeight: true`, so each footprint point has its own height. Drag updates only lat/lng; the original `h` is preserved. This keeps the prism's bottom flush with the drape.
- **Gable / Hip** have all 4 eave corners at the same `eaveHeightM`. Drag updates only lat/lng; `eaveHeightM` is preserved. Ridge is recomputed from the new centroid.
- **Tree** moves the whole (lat, lng). `trunkHeightM` and `foliageRadiusM` are preserved.

---

## 6. What stays updated during a drag

For each entity type:

| Entity | What changes on `onUpdate(vertexIdx, newLat, newLng)` |
|---|---|
| `block` | `prismEntity.polygon.hierarchy.positions` ← rebuilt Cartesian3[] from updated footprint |
| `gable` | All 4 face entities' `polygon.hierarchy.positions` ← rebuilt via `rebuildGableFaces(sw, ne, eaveHeightM, pitchDeg)` |
| `hip` | All 4 face entities' `polygon.hierarchy.positions` ← rebuilt via `rebuildHipFaces(sw, ne, eaveHeightM, pitchDeg)` |
| `tree` | `trunkEntity.position` and `foliageEntity.position` ← new Cartesian3 at new (lat, lng, h) |

**Hand-off back to parent:** the `onUpdate` callback returns the new footprint vertices so the parent can keep its ref in sync. Without this, the next drag would revert to the old position.

**Existing handles stay accurate:**
- The orange drag-to-resize box on top of a Block (`block-handle-*`) is at the centroid — it doesn't move when a vertex is dragged. Correct: it tracks height, not footprint.
- The tree has no extra handle.

**Live dimension readout:** `setStatusMsg(\`↔ Edge: ${dimensionReadoutFt(best)}\`)`. Aurora shows in feet to 1 decimal; we match.

---

## 7. Validation / clamping

| Constraint | What happens | Why |
|---|---|---|
| Min edge length 0.5 m | if drag would collapse a polygon edge below 0.5 m, reject the move | matches existing gable/hip placement guard |
| Footprint must remain ≥ 3 vertices | block edit rejected if it would drop below 3 corners | a polygon needs ≥ 3 points |
| Lat/lng within [-90, 90] / [-180, 180] | reject | isValidCoord |
| Globe pick fails (ray to sky) | silently no-op for that frame | rare — orbit camera tilt usually keeps the globe under the cursor |

`validateVertexMove(spec, vertexIdx, newLat, newLng)` returns either the accepted `{lat, lng}` or `null` (rejected). The component re-renders the handle at the accepted position on the next frame.

---

## 8. Display state (when are handles visible?)

Handles render whenever a primitive exists and `placementMode === 'select'`. Aurora's wizard step 3 is the dedicated "Adjust" view, but in Solarpro's current UX, `select` is the closest equivalent (the user is no longer placing). When a user picks `Block` / `Gable` / `Hip` / `Tree` to start placing a new one, handles for the *previously placed* primitives of that same type are hidden (cleaner canvas) and the next-placed primitive's handles show once placement finishes.

This matches Aurora frame_0090 / frame_0095 where the wizard is in Step 3 — no active draw, all handles visible for editing.

---

## 9. File-level plan

| File | Status | Purpose |
|---|---|---|
| `components/3d/editing/DESIGN.md` | NEW | this doc |
| `lib/3d/vertexHandlesMath.ts` | NEW | pure math (vertexDistance, rebuildGableFaces, rebuildHipFaces, validateVertexMove, dimensionReadoutFt, pickRayToLatLng) |
| `components/3d/editing/VertexHandles.tsx` | NEW | React component: render handles, hook drag handler, call onUpdate |
| `components/3d/editing/index.ts` | NEW | re-export the component for clean import path |
| `tests/vertexHandles.test.ts` | NEW | unit tests for the math (40 tests) |
| `components/3d/SolarEngine3D.tsx` | MINIMAL EDIT | build `specs` list + wire `<VertexHandles>` + `handleVertexUpdate` callback |

No other files touched. No packages added. No changes to `compliance/`, `AGENTS.md`, or anything outside the 3D design surface.

---

## 10. Out of scope (explicit)

- Aurora's 3-step wizard stepper → owned by `roof-wizard` agent
- Per-segment ridge arrows (yellow) → owned by another
- Per-face segment color coding → owned by another
- Tilted aerial default 3D view → owned by another
- Tree 2D placement preview circle → owned by another
- Obstruction primitive → owned by another
- Saving / persistence of vertex edits to DB → not in any Aurora frame; out of scope until a frame proves otherwise
