# 3D Camera Presets — Aurora Parity

**Owner:** `camera-tilt` agent
**Status:** shipped (Tilted Aerial default)
**Source of truth:** `lib/3d/cameraPresets.ts`

---

## Goal

Match Aurora's 3D view pose so users see roof slopes, trees, and context in
a single frame, rather than staring straight down at a flat rooftop.

> "The 3D view is **tilted, not top-down** — like a 45° camera angle."
> — AURORA_ANALYSIS §4 (frames 130, 140, 142)

The 45° pitch is a deliberate UX choice: at -90° the user sees a 2D plan
view (no roof shape, no tree shadows, no context). At -45° they see the
roof as a 3D object, the tree spheres as trees, the satellite imagery as
ground, and the surrounding buildings as buildings.

---

## The presets

| Preset             | Heading | Pitch         | Range (default) | Use case                              |
| ------------------ | ------- | ------------- | --------------- | ------------------------------------- |
| `TILTED_AERIAL_VIEW` | π (180°) | -π/4 (-45°)  | 150m            | **Default.** Aurora parity.           |
| `TOP_DOWN_VIEW`      | 0        | -π/2 (-90°) | 150m            | Orthographic layout / irradiance map. |

### Heading convention

- `heading = 0` → camera position is **north** of target → look direction is **south**.
- `heading = π` → camera position is **south** of target → look direction is **north**.

Solarpro's existing `orbitRef` uses heading = π for the "fly-in looks NORTH"
behavior (see SolarEngine3D.tsx:522, 1371, 2006). The new presets preserve
that convention so the look direction on first load still faces north.

### Pitch convention

Cesium convention: 0 = horizontal, -π/2 = straight down. So:
- `pitch = 0` → camera at the same height as target, looking horizontally.
- `pitch = -π/4` → camera 45° above the target's horizon.
- `pitch = -π/2` → camera directly above the target, looking down.

`TILTED_AERIAL_VIEW` uses -π/4 because that's what Aurora does (AURORA_ANALYSIS
§4: "like a 45° camera angle"). -π/2 is reserved for the strict top-down
view, which is a deliberate user choice (e.g. measuring roof area), not the
default.

### Range

`range` is the camera's distance from the target in meters. The default
150m frames a typical residential lot at -45° pitch (Aurora's frame_140 /
frame_142 show the building filling most of the viewport with surrounding
trees visible). Callers can override the range via
`computeRangeFromBounds(spanM)` if the building footprint is known:

```ts
const spanM = Math.max(eastWestSpan, northSouthSpan);
flyToPreset(orbitRef.current, applyOrbitRef.current, TILTED_AERIAL_VIEW, {
  target: { lat, lng, height: groundElev },
  rangeOverride: computeRangeFromBounds(spanM),
});
```

The formula is `max(50, spanM * 1.4)` — the same formula already used by
`fitCameraToRoofPlanes` in SolarEngine3D.tsx:2244. The 1.4× padding leaves
~30% margin around the building, and the 50m minimum keeps tiny structures
(small sheds) from being zoomed so far in that the rest of the lot falls
off-screen.

---

## Why a single source of truth?

Before this file, the default camera pose was hardcoded in **five** places
inside SolarEngine3D.tsx, each with subtly different values:

| Location                       | pitch   | radius |
| ------------------------------ | ------- | ------ |
| `orbitRef` initial state (522) | -1.134  | 150    |
| Address-change fly (1372)      | -1.134  | 150/300|
| Initial boot (2006)            | -1.134  | 150    |
| `fitCameraToRoofPlanes` no panels (2235) | -1.134  | 150    |
| `fitCameraToRoofPlanes` with panels (2247) | -1.222 (-70°) | varies |

(-1.134 rad = -65°, -1.222 rad = -70° — both *more* top-down than Aurora's -45°.)

Every call site that wanted to "reset" the camera had its own slightly
different default. Changing one meant finding all five. The presets file
fixes that — one constant, five call sites that import the same value.

---

## User interaction

The tilted aerial view is just the **initial pose**. The user can still:

- **Rotate** (left-drag) — orbits around the target.
- **Pan** (right-drag or middle-drag) — translates the target.
- **Zoom** (mouse wheel) — adjusts `radius` (range).
- **Reset View** button → returns to `TILTED_AERIAL_VIEW` at the current
  target, with the same 45° pitch.

The existing `applyOrbit` controller in SolarEngine3D.tsx preserves all
this. The presets only define the resting pose; the user controls override
it freely until the next "reset" or address change.

---

## Integration

`SolarEngine3D.tsx` was touched in **four** spots, each replacing a
hardcoded `pitch: -1.134` with `TILTED_AERIAL_VIEW.pitch`:

1. **`orbitRef` initial state (line 522)** — the default state when the
   viewer mounts before any address arrives.
2. **Address-change fly (line 1372)** — when the user enters a new address,
   the camera snaps to the new site at the tilted-aerial default.
3. **Initial boot after terrain sample (line 2006)** — the canonical
   "viewer's first frame" pose once the Cesium terrain is ready.
4. **`fitCameraToRoofPlanes` (line 2235, 2247)** — the Reset View button.
   Now both branches (with/without panels) use the same -45° pitch. The
   radius is overridden by `computeRangeFromBounds(spanM)` when there are
   panels to frame.

`fitCameraToRoofPlanes` with panels previously pitched to -70° (more
top-down). It now uses -45° to match Aurora's reset behavior — the user
can still pitch up to top-down via drag if they want a plan view.

---

## Tests

`tests/cameraPresets.test.ts` covers:

- `TILTED_AERIAL_VIEW.pitch === -π/4` (Aurora parity pin)
- `TILTED_AERIAL_VIEW.heading === π` (preserves existing look-north behavior)
- `TOP_DOWN_VIEW.pitch === -π/2`
- `computeRangeFromBounds` matches the existing `fitCameraToRoofPlanes`
  formula across a range of spans
- `computeRangeFromBounds` rejects non-finite / negative input defensively
- `flyToPreset` mutates the orbit state in place and calls `applyOrbit`
  exactly once
- `flyToPreset` honors `target` and `rangeOverride` options
- `buildCesiumCameraView` produces a sensible Cesium `Camera.setView` input
  (camera south of target for tilted aerial, directly above for top-down)

27/27 green.

---

## Future work (out of scope for this agent)

- **Camera flyTo animation** — `flyToPreset` is an instant snap today. The
  `animate: true` option is wired into the signature but not implemented;
  a future agent can layer Cesium `camera.flyTo` on top of the orbit state
  update for smooth transitions. The orbit state still gets updated at the
  start so user drags mid-flight behave correctly.
- **Per-project preset memory** — currently the default is the same for
  every project. Persisting the user's last-pitch/heading/range per project
  in the project state would let them return to a familiar view on reload.
- **Aurora "View Compass" overlay** — Aurora's bottom-left has a compass
  that rotates with the camera. Solarpro has a compass already; tying it
  to the camera heading in real time is a Design phase polish item.
