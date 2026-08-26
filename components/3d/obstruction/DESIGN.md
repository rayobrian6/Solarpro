# Obstruction Primitive — Design

> **Agent:** `obstruction-primitive`
> **Aurora reference:** `frame_0070.jpg` (right panel "Add Obstruction") +
> `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §1 (right panel tools) and TIER 1 #7
> (Obstruction primitive: chimneys, vents, dormers, etc.)
> **Aurora parity bar:** *"Add Obstruction tool in the right panel. Click
> places a small block (e.g. 0.6m × 0.6m × 1.0m, configurable) at the click
> point. No roof. Renders as a small white/dark prism. Used for chimneys,
> vents, dormers, etc."*

## 1. What Aurora does (visual analysis of frames 70 & 140)

The right panel in Aurora has a single "Add Obstruction" entry under
Site-Model mode. It is a *click-to-place* tool (no footprint tracing) that
drops a small rectangular prism wherever the user clicks. From the panel
icon (a small block glyph) and the visual size in the 3D view, the default
prism is roughly the size of a chimney or a vent stack — about 60cm × 60cm
on the ground and roughly 1m tall.

| Property                 | Observed value                                              |
| ------------------------ | ----------------------------------------------------------- |
| Click-to-place           | yes — no footprint tracing                                  |
| Default footprint (W×D)  | ≈ 0.6 m × 0.6 m (chimney-class)                             |
| Default height           | ≈ 1.0 m (chimney-class)                                     |
| Footprint shape          | axis-aligned rectangle, **centered** on the click point     |
| Top                      | closed (it's a real prism, not just a vertical box outline) |
| Bottom                   | open (sits on the roof)                                     |
| Material                 | light / dark prism, reads as a solid object                 |
| Drag handles             | none in the Aurora clip — placed and forgotten              |
| Dimensional controls     | not visible in the clip, but the parity bar says configurable |

> **Decision: single-click placement, not footprint tracing.** Aurora
> shows a click-to-place "block" tool, not the multi-corner line-trace
> that the v64 Block primitive uses. The two primitives are visually
> similar but the interaction is different — Aurora's "Add Obstruction"
> is a **fixed-size** primitive, the Block is a **variable-size** primitive.

## 2. What "Aurora parity" means here

The "Add Obstruction" tool is the **fixed-size variant** of the v64 Block
primitive. From the user's perspective:

- I pick the tool. (one click on the right panel.)
- I click the roof where the chimney should go. (one click on the canvas.)
- A small white prism appears at the click point. (immediate feedback.)
- That's it — no other clicks, no right-click to finalize, no drag.

The primitive exists to **mark the roof accurately** for downstream
processes (panel layout, panel exclusion, shade analysis) without forcing
the user to draw an arbitrary polygon for every chimney.

### 2.1 Sizing defaults

- Width (east-west): 0.6 m — typical brick chimney is ~0.5–0.7m wide.
- Depth (north-south): 0.6 m — same.
- Height: 1.0 m — typical residential chimney stands ~0.6–1.2m above the
  roof, ~2–4ft. 1.0m is the canonical midpoint and matches Aurora's clip.

The defaults are **configurable** via the right-panel input strip
(per the parity bar). Clamps are conservative:

| Dimension | Min  | Max  | Reason                                         |
| --------- | ---- | ---- | ---------------------------------------------- |
| Width     | 0.2m | 3.0m | smaller than 20cm degenerates; bigger is a shed |
| Depth     | 0.2m | 3.0m | same                                           |
| Height    | 0.3m | 5.0m | shorter than 30cm is a roof stain, not a feature; taller is a tower |

### 2.2 Panel exclusion

Aurora doesn't show the keep-out behavior, but the existing v47
`PlacedObstruction` already routes the obstruction through
`removeObstructedPanels(panels, obstructions)`. To stay consistent with
that filter, the new primitive must also remove overlapping panels.

**Behavior change vs. the v47 red-sphere marker:** the v47 marker
excluded panels within a *circular* `radiusM = 0.75` m. The new
primitive excludes panels inside the *rectangular* footprint (the same
rectangle the user can see on the roof). This is a strict improvement
— the keep-out shape now matches the visible shape, instead of a sphere
that's invisible to the user but used for exclusion.

## 3. Architecture

```
components/3d/obstruction/
├── DESIGN.md          ← this file
├── dimensions.ts      ← constants + pure math (no React, no Cesium)
└── index.ts           ← barrel re-export
```

The slice has **one** minimal touchpoint in `components/3d/SolarEngine3D.tsx`:
the existing `handleObstructionClick` is replaced (it already places a
red sphere — wrong shape for the parity bar), and a new branch in the
3D Primitives right-panel input block exposes the three dimension
sliders. The label in the toolbar entry is changed from "Obstruct" to
"Obstruction" to match Aurora's "Add Obstruction" wording.

### 3.1 `dimensions.ts` (pure)

Exports:

| Symbol                                                | Purpose                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `DEFAULT_OBSTRUCTION_FOOTPRINT_W_M`                   | The single source of truth for default width (0.6 m).            |
| `DEFAULT_OBSTRUCTION_FOOTPRINT_D_M`                   | Single source of truth for default depth (0.6 m).                |
| `DEFAULT_OBSTRUCTION_HEIGHT_M`                       | Single source of truth for default height (1.0 m).               |
| `MIN_OBSTRUCTION_FOOTPRINT_M`                         | Floor for width/depth (0.2 m).                                   |
| `MAX_OBSTRUCTION_FOOTPRINT_M`                         | Ceiling for width/depth (3.0 m).                                 |
| `MIN_OBSTRUCTION_HEIGHT_M`                            | Floor for height (0.3 m).                                        |
| `MAX_OBSTRUCTION_HEIGHT_M`                            | Ceiling for height (5.0 m).                                      |
| `clampObstructionFootprint(widthM, depthM)`           | Returns `{ widthM, depthM }` both clamped to the safe range.     |
| `clampObstructionHeight(heightM)`                     | Returns the height clamped to the safe range.                    |
| `buildObstructionFootprint(centerLat, centerLng, …)`  | Returns the 4 corner {lat,lng} points of the centered rectangle. |
| `obstructionFootprintAreaM2(widthM, depthM)`          | `width * depth` — for the info box.                              |
| `obstructionFootprintDiagonalM(widthM, depthM)`       | `sqrt(w² + d²)` — for label debug.                               |
| `pointInsideObstructionRectangle(pt, center, w, d)`   | Boolean test: is the point (lat,lng) inside the rectangle?       |

All functions are pure. No Cesium, no React, no DOM. Unit-tested in
`tests/obstruction.test.ts`.

### 3.2 `index.ts` (barrel)

```ts
export {
  DEFAULT_OBSTRUCTION_FOOTPRINT_W_M,
  DEFAULT_OBSTRUCTION_FOOTPRINT_D_M,
  DEFAULT_OBSTRUCTION_HEIGHT_M,
  MIN_OBSTRUCTION_FOOTPRINT_M,
  MAX_OBSTRUCTION_FOOTPRINT_M,
  MIN_OBSTRUCTION_HEIGHT_M,
  MAX_OBSTRUCTION_HEIGHT_M,
  clampObstructionFootprint,
  clampObstructionHeight,
  buildObstructionFootprint,
  obstructionFootprintAreaM2,
  obstructionFootprintDiagonalM,
  pointInsideObstructionRectangle,
} from './dimensions';
```

### 3.3 The touchpoint in `SolarEngine3D.tsx`

1. **Import** the new math from `./obstruction`.
2. **Add 3 state variables** for the dimension sliders:
   - `newObstructionWidthM` (default 0.6)
   - `newObstructionDepthM` (default 0.6)
   - `newObstructionHeightM` (default 1.0)
3. **Replace `handleObstructionClick`** with a block-style placement:
   - Pick the lat/lng (same as today)
   - Build the 4-corner polygon via `buildObstructionFootprint(...)`
   - Convert each corner to a `Cesium.Cartesian3` (per-position height)
   - Add a `PolygonGraphics` with `extrudedHeight: newObstructionHeightM`
   - Add a `PlacedObstruction` to `obstructionsRef` with the new `widthM`/`depthM` fields
4. **Add a new "Add Obstruction" right-panel input block** that exposes
   the three dimension sliders when `placementMode === 'obstruction'`,
   plus a "Reset to 0.6×0.6×1.0m" quick-action button and a "Clear"
   button.
5. **Update the toolbar entry** label from "Obstruct" to "Obstruction"
   to match Aurora's "Add Obstruction" wording, and update the tooltip.

The existing `PlacedObstruction` type gets two new **optional** fields
(`widthM`, `depthM`); the existing `radiusM` field stays for backward
compatibility with any persisted state from the v47 era.

The existing `removeObstructedPanels(panels, obstructions)` filter in
`lib/surfaceGeometry3D.ts` is extended: if an obstruction has
`widthM` and `depthM` set, use the rectangle test; otherwise fall back
to the legacy `radiusM` circle.

## 4. Visual & behavioural spec

| Behaviour                | Spec                                                           |
| ------------------------ | -------------------------------------------------------------- |
| Click-to-place           | one click → prism appears (no finalize)                        |
| Footprint shape          | axis-aligned rectangle centered on click point                  |
| Default W × D × H        | 0.6 m × 0.6 m × 1.0 m                                          |
| Color (top)              | light gray (`#f5f5f5` @ 0.92 alpha) — matches the Block primitive so the two read as siblings |
| Color (outline)          | dark gray (`#2a2a2a`, 2 px)                                    |
| Top closed               | yes — the prism has a real top                                  |
| Bottom closed            | no — sits flush on the roof                                     |
| Walls                    | per-position height, vertical extrudes                          |
| Panel exclusion          | any panel whose center falls inside the rectangle is removed   |
| Label                    | small "⚠ Chimney 0.6×0.6×1.0m" label on the prism, 11px sans  |
| Cleanup                  | clear button in the right-panel context overlay                |
| Out of range lat/lng     | rejected with the same `isValidCoord` guard the other primitives use |

## 5. Test plan

`tests/obstruction.test.ts` (pure math, no Cesium, no DOM):

- Defaults are exactly 0.6 / 0.6 / 1.0 (Aurora parity bar literal).
- `clampObstructionFootprint(0.1, 50)` clamps both into the safe range.
- `clampObstructionHeight(-2)` clamps to 0.3; `clampObstructionHeight(99)` clamps to 5.0.
- `buildObstructionFootprint(...)` returns 4 corner points ordered consistently.
- The 4 corner points are equidistant from the center in each axis.
- `pointInsideObstructionRectangle(...)` returns true for a point at the center.
- `pointInsideObstructionRectangle(...)` returns false for a point far outside.
- A 0.6 × 0.6 m footprint covers an area of 0.36 m² exactly.
- A 0.6 × 0.6 m footprint has a diagonal of `0.6 * sqrt(2) ≈ 0.849 m`.

## 6. Out of scope (deferred)

- **Drag-to-resize** for an already-placed obstruction. Aurora doesn't
  show one either; parity is "click to place, done".
- **Roof-following** (the prism snaps to the roof slope). Aurora's
  obstruction prism sits on the drape flat, same as ours.
- **Multi-point footprint** (L-shaped chimneys). Aurora uses a single
  rectangle; the parity bar says "a small block". Future work, defer.
- **"Add Obstruction" type picker** (vent vs chimney vs dormer). The
  parity bar treats them as one primitive with one shape. We
  preserve the v47 `type` field on `PlacedObstruction` so a future
  type-picker UI can read it.

## 7. Risks & mitigations

| Risk                                                                        | Mitigation                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `widthM`/`depthM` field on `PlacedObstruction` confuses the v47 radius flow  | Fields are **optional**; `removeObstructedPanels` falls back to `radiusM` if absent |
| Cesium `PolygonGraphics` with `perPositionHeight: true` z-fights with drape | Same fix as the v64 Block primitive: per-position-height extrudes from each click elevation up; bottom open so the drape shows through |
| Persistent state (DB / URL) has `radiusM`-only obstructions                 | `removeObstructedPanels` keeps the radius path as the default when `widthM`/`depthM` are undefined |
| The right-panel input strip blows up vertical layout                        | Reuse the same inline slider pattern as `newBlockEaveHeightM`; it's been proven to fit |
| The user clicks an already-placed obstruction                               | Cesium will create a new entity; the existing `obstructionsRef` push is idempotent for the click flow |
| The change to `handleObstructionClick` is a behavior break vs. v47          | The v47 "red sphere + radius" was a half-implementation (the toolbar tip says "Mark a rectangular area" — the code never delivered that). The new behavior matches the *intended* description and Aurora's parity bar. Documented in this DESIGN.md. |

## 8. Aurora parity verdict

| Aurora feature                                  | Status                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| Right panel "Add Obstruction" entry             | already present, label being corrected to "Obstruction" |
| Click-to-place (no footprint tracing)           | new — single click places a fixed-size prism      |
| Default 0.6 m × 0.6 m × 1.0 m                  | new — matches the parity bar                      |
| Configurable width / depth / height             | new — three right-panel sliders                   |
| White / dark prism rendering                    | new — uses the same `#f5f5f5` family as Block     |
| Used for chimneys, vents, dormers               | new — same primitive, no type picker (deferred)   |
| Panel exclusion                                 | existing — extended to use the rectangle          |

**Parity: 100% of the parity bar literal met. No downscoping.**
