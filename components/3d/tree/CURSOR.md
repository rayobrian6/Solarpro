# Tree Placement 2D Cursor — Design

> **Agent:** `tree-cursor` (2D Tree Cursor)
> **Aurora reference:** `frame_0115.jpg` + `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §3
> **Aurora parity bar:** *"a translucent light-blue circle (~30ft diameter) follows the mouse — gives you a sense of the actual tree footprint before you click"*

## 1. What Aurora does (visual analysis of frame 115)

In `frame_0115.jpg` the cursor is a **single, fully-closed circle** floating above the satellite imagery, centered on the mouse pointer:

| Property            | Observed value                                            |
| ------------------- | --------------------------------------------------------- |
| Color               | light blue (`~#a8d4ec` — pale sky blue)                   |
| Fill opacity        | translucent — roughly 35–45% alpha (you can see imagery through it) |
| Outline             | subtle, slightly darker than the fill (a few % darker)     |
| Outline width       | thin (1–2 px) — not a heavy ring                          |
| Diameter            | ~30 ft (≈ 9.1 m, ≈ 4.57 m radius)                         |
| Behaviour           | follows mouse 1:1, no lag, no fade-in/out                 |
| Above/below surface | lays flat on the terrain (no tilt, no z-offset animation) |
| Non-placeable area  | not visible in the frame; Aurora treats anywhere-on-imagery as placeable for the tree tool |

## 2. What "Aurora parity" means here

The cursor is **the tree's actual footprint preview**, not a fixed-size reticle. When the user moves the mouse, they see exactly where the canopy will land before clicking. This is the entire point of the feature: spatial pre-visualization, not decoration.

For Solarpro:

- The tree primitive (already shipped, v64 in `SolarEngine3D.tsx:7027`) uses a **`foliageRadiusM = 1.8`** (≈ 5.9 ft radius, ≈ 11.8 ft diameter).
- Aurora's actual tree in the video is larger (~15 ft radius), but **we are matching the cursor to OUR tree primitive**, not Aurora's specific tree. The principle is *"circle = canopy footprint"*; the size is whatever the primitive is.
- The constant **`DEFAULT_TREE_CANOPY_RADIUS_M = 1.8`** is exported from `canopy.ts` and consumed by:
  - `TreeCursor.tsx` — to size the preview ellipse.
  - The future obstruction-detection pass — to test whether the cursor footprint overlaps a no-place region (out of scope here, but the constant is the single source of truth so that work can import it without re-hardcoding).

> **Decision: match the footprint, not the absolute size.** A user placing a 1.8 m tree and seeing a 4.6 m cursor would feel deceived. Cursor diameter = tree canopy diameter, always.

## 3. Architecture

```
components/3d/tree/
├── CURSOR.md          ← this file
├── canopy.ts          ← constants + pure math (no React, no Cesium)
├── TreeCursor.tsx     ← React component: Cesium ellipse entity + mouse handler
└── index.ts           ← barrel export
```

The slice has **one** minimal touchpoint in `components/3d/SolarEngine3D.tsx`: the `<TreeCursor />` component is mounted once at the top-level JSX, and is only *visually* active when the prop `active === true`. The tree placement mode itself (`placementMode === 'tree'`) is the source of truth for that flag.

### 3.1 `canopy.ts` (pure)

Exports:

| Symbol                              | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `DEFAULT_TREE_CANOPY_RADIUS_M`      | The single source of truth for tree canopy radius (meters, 1.8).  |
| `canopyDiameterM(radiusM)`          | Convenience: `2 * radiusM`.                                        |
| `canopyRadiusInFeet(radiusM)`       | Aurora-style feet readout (3.28084 m/ft).                          |
| `canopyFootprintAreaM2(radiusM)`    | `π * r²` — used by future obstruction tests.                       |
| `canopyRadiusToEllipseAxes(radiusM)`| `{ semiMajorAxis, semiMinorAxis }` for the Cesium EllipseGraphics. |

All of these are pure functions of the radius. No Cesium import, no DOM. Unit-tested in `tests/treeCursor.test.ts`.

### 3.2 `TreeCursor.tsx` (React + Cesium)

```tsx
<TreeCursor
  viewer={viewerRef.current}        // Cesium Viewer (or null while booting)
  active={placementMode === 'tree'} // show the cursor only in tree mode
  canopyRadiusM={DEFAULT_TREE_CANOPY_RADIUS_M}
/>
```

Behaviour:

1. When `active` flips `false → true`:
   - Resolve `(window as any).Cesium` (the same pattern used everywhere in `SolarEngine3D.tsx`).
   - Create a `ScreenSpaceEventHandler` on `viewer.scene.canvas`.
   - Add an `ellipse` Cesium entity with:
     - `semiMajorAxis = semiMinorAxis = canopyRadiusM` (a circle)
     - `material = Color.fromCssColorString('#a8d4ec').withAlpha(0.42)` (light blue, translucent)
     - `outline = true`, `outlineColor = '#7fb8d8'`, `outlineWidth = 2`
     - `height = 0`, `heightReference = CLAMP_TO_GROUND` (drapes on terrain)
   - On every `MOUSE_MOVE` event, run the same `getWorldPosition` chain the rest of the engine uses (3D tiles → terrain → ellipsoid) and update the entity's `position` to the resulting `Cartographic` lat/lng.
   - If picking fails (mouse over the sky / off-globe), hide the entity (`entity.show = false`).

2. When `active` flips `true → false` (user picks another tool, presses Esc → `onPlacementModeChange('select')`):
   - Remove the entity.
   - Destroy the `ScreenSpaceEventHandler`.
   - All teardown is wrapped in `try/catch` so a Cesium-throwing unload never leaks a ghost cursor.

3. **No state, no React re-renders on mouse move.** The cursor's position is mutated via the entity's `position` property (Cesium supports live updates on entity properties), not via React state. This is critical: a naive `setState` per mousemove would tank the frame rate.

4. **No additional `<div>` overlay.** The cursor is *in the Cesium scene* so it co-registers with the terrain as the user tilts/orbits the camera. A DOM overlay would drift when the camera moves.

### 3.3 The mount point in `SolarEngine3D.tsx`

Single insertion, top of the existing JSX, before the first context island:

```tsx
{/* v65 (tree-cursor): 2D footprint preview while in tree placement mode */}
<TreeCursor
  viewer={viewerRef.current}
  active={placementMode === 'tree'}
  canopyRadiusM={DEFAULT_TREE_CANOPY_RADIUS_M}
/>
```

`viewerRef.current` may be `null` while Cesium is still booting; the component handles that gracefully (no-op until viewer + Cesium are both available).

That's the **only** change to `SolarEngine3D.tsx`. The existing `handleTreeClick` is unchanged — the click still creates a tree at the picked lat/lng; the cursor is purely preview, the click flow is unchanged.

## 4. Visual & behavioural spec

| Behaviour                          | Spec                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| Color (fill)                       | `#a8d4ec` (light blue) at 0.42 alpha                                |
| Color (outline)                    | `#7fb8d8` (slightly darker) at 0.95 alpha, 2 px width               |
| Diameter                           | `2 × DEFAULT_TREE_CANOPY_RADIUS_M` = 3.6 m (≈ 11.8 ft)              |
| Drape mode                         | `CLAMP_TO_GROUND` — lays flat on terrain                            |
| Position update rate               | every `MOUSE_MOVE` (Cesium throttles to display refresh)            |
| Off-globe / no-pick behaviour      | entity hidden (no ghost ring floating in the sky)                   |
| React re-renders on mouse move     | **0** — entity position is mutated directly                         |
| Cleanup on unmount                 | remove entity + destroy handler; survives Cesium reload             |

## 5. Test plan

`tests/treeCursor.test.ts` (pure math, no Cesium, no DOM):

- `DEFAULT_TREE_CANOPY_RADIUS_M` is exactly `1.8` (matches `SolarEngine3D.tsx:7027`).
- `canopyDiameterM(1.8) === 3.6`.
- `canopyRadiusInFeet(1.8)` ≈ 5.9055.
- `canopyFootprintAreaM2(1.8)` ≈ `π * 1.8²` ≈ 10.1787 m².
- `canopyRadiusToEllipseAxes(1.8)` returns `{ semiMajorAxis: 1.8, semiMinorAxis: 1.8 }`.
- Configurable radius: `canopyDiameterM(2.5) === 5.0` (so future tree species / obstructions can override).
- Non-negativity: negative or zero radius is rejected with a deterministic `RangeError` (prevents the Cesium ellipse from drawing inside-out).

## 6. Out of scope (deferred)

- The "non-placeable area" red ring — requires a placeable-region overlay that doesn't exist yet. Once obstruction detection is built, the cursor component will accept a `disabled: boolean` prop and switch to a red ring. **Defer.**
- A second, larger "shade zone" ring around the canopy — Aurora's trees also cast a shade ring. Not in the frame-115 analysis, defer.
- Animated fade-in on mode enter — micro-polish, defer.

## 7. Risks & mitigations

| Risk                                                                                   | Mitigation                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Cesium not loaded on the `window` yet when the component mounts                        | `TreeCursor` re-checks `(window as any).Cesium` on every effect; no-op until available.   |
| Race between `viewerRef.current` being set and Cesium being initialised                 | Same as above — guarded effect, runs again on next render.                                |
| `MOUSE_MOVE` firing 60×/s storms React                                                  | Entity properties mutated in place, not via state. Zero React re-renders.                |
| Tool switch leaves a ghost ring                                                        | Cleanup effect runs on `active` change AND on component unmount (belt + braces).         |
| Cursor conflicts with the existing `setupHoverHandler` (lat/lng readout)               | That handler only writes to `setStatusMsg` — no scene mutation — so they coexist.         |
