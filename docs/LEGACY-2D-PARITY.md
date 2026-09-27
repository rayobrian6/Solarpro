# Legacy 2D → Precision Design: capability inventory and retirement gate

**Status: INVENTORY ONLY. Nothing has been removed, and the `🗺️ 2D Map` button stays.**

Ray's instruction, verbatim:

> "This Precision Design environment is the likely replacement for the old separate 2D editor.
> Inventory the legacy 2D functionality and migrate it into this unified workspace... **Do not
> remove the old button until parity is proven. But stop extending the legacy 2D environment.**"

So this file is the list, and the rule that comes with it: **no new capability goes into the 2D
branch.** A row below moves to `yes` when the capability exists in the 3D/Precision Design studio
and a test says so — not when it looks similar.

Line numbers are as of `dev` at the commit that added this file. They will drift; the capability
names will not.

---

## Where the 2D environment actually is

There is **one** 2D design environment, and it is a conditional branch inside one component.
There is no second route and no second canvas component.

| | |
|---|---|
| The switch | `components/design/DesignStudio.tsx` — `show3D` state, and the `🌐 3D View` / `🗺️ 2D Map` button |
| The conditional mount | `show3D ? <SolarEngine3D …> : <canvas …>` — the 2D branch is the `else` |
| The renderer | `drawCanvas` — one ~740-line function that paints tiles, planes, setbacks, panels, measurements and chrome |
| Its own projection | a **private copy** of Web Mercator inside `DesignStudio.tsx`, duplicating `lib/map/webMercator.ts` |

Because `show3D` is a **conditional mount**, everything the 3D engine holds in refs is discarded on
a switch and rebuilt on the way back. That is already load-bearing for the imagery mode's cleanup.

---

## The retirement gate

These are the capabilities that exist **only** in 2D. Every one must be closed, or explicitly
ruled unnecessary by Ray, before the button can go.

| # | Only-in-2D capability | Why it blocks |
|---|---|---|
| **D2** | **Tag a traced plane** — trace an arbitrary N-gon, then declare its pitch and azimuth in a dialog (compass picker, 0-45° slope, rise/12 label) and place panels on it | This is the *rural / no-3D-coverage* path. The 3D tracing tools need pickable 3D corners or produce building **sections** (footprint + wall + ridge), not one free-form face. Without this, an address with no mesh has no way to author a roof plane. **The single biggest blocker.** |
| **D3** | Draw an arbitrary **ground polygon** | The engine never emits one, so the ground-fill branch below is unreachable |
| **D4** | Draw a **fence line** polyline | Same: 3D places fence panels but never records the traced run |
| **F6/F7** | Auto Layout over a traced **ground polygon** or **fence run** | Depend on D3/D4; the 3D routing short-circuits to a roof fill before these branches are reached |
| **F8** | Ground-mount row spacing from tilt + panel height (inter-row shade clearance) | Unreachable in 3D. ⚠ Before porting, read `a-ui-slider-is-not-a-physical-quantity`: a roof **gap** and a ground **pitch** are different quantities and were conflated once, at a cost of 43% of a year |
| **G1** | See the Nearmap-AI detected **keep-out polygons** | **Verified:** `keepOutZones` is never passed to `SolarEngine3D`. It is used to filter panels, so the keep-outs *act* in 3D but are *invisible* there. The 📐 toggle for them sits in the shared sidebar and draws nothing in 3D |
| **H1** | **Roof edges coloured by type** — ridge / eave / hip / valley / rake / wall, dashed when unconfirmed | **Verified:** `edgeTypes` has **0 occurrences** in `SolarEngine3D.tsx`. The data survives and the permit sheets draw it, but a reviewer can only *see* it in 2D |
| **B2** | Free pan/zoom over a **Nearmap tile pyramid**, tiles bought on demand | Precision Design deliberately replaces this with a bounded, pre-paid workzone. This is a **rule change, not a gap** — but it is a capability Ray currently has and would lose, so it is his call, not mine |
| **B4** | Google Solar **HD RGB** (~10 cm) as a backdrop | No HD toggle exists in 3D |
| **C5** | **Graphic scale bar** | **Verified:** nothing matching a scale bar exists under `components/3d/` |
| **I1–I5** | CAD debug overlay, validation overlay (roof polygon + CAD bbox + panel centres in one frame), per-panel strategy label, **module identity/size debug badge**, to-scale panel legend | I2 is the "do the three coordinate systems agree" check and I4 is the readout that catches *"the layout was fitted for a different module"*. Both are diagnostics the 3D studio has no equivalent of |
| **J5** | The bill-analysis "Recommended System Size" banner | Pure JSX, lives inside the 2D branch only |

## Already at parity, or 3D is ahead

Pan, cursor-anchored wheel zoom, compass, address search, Escape-cancels-trace, panel
select/multi-select, delete with deletion authority, roof Auto Layout / Fill Roof / Optimize,
orientation and racking settings, fire-setback bands and AHJ inputs, plane confirm / per-plane
override / re-layout, Nearmap aerial roof detect, save / autosave / version history, BOM export,
Clear and Start Over.

**3D is strictly ahead** on: dragging and nudging a placed panel (2D cannot), placing and editing
obstructions at real size with clearances (2D has none), Pick House, and **measurement** — the 2D
measure tool is ephemeral and never persisted, while the 3D one writes through
`onMeasurementsChange`. Retiring 2D *removes* a measurement that silently never saved.

Hand-editing a plane's Slope and Direction (H3) is a special case: those sliders exist **only** for
frameless faces, and frameless faces come **only** from D2. Close D2 properly — a traced footprint
that gets a real 3D frame — and H3 retires with it rather than being ported.

---

## One live collision, worth knowing now

The 2D branch's keyboard shortcuts (`V / R / G / F / M`, Delete/Backspace, Escape) are registered
on **`window`**, not inside the 2D branch. The 3D engine has its own `TOOL_SHORTCUTS` including
`r f g m v`. Both listeners are live at once, so **in 3D mode those keys arm a 3D tool *and*
silently set the 2D `drawingMode`.** Harmless today because nothing in 3D reads `drawingMode` — but
it is a real double-binding and it disappears when the branch does.

## Code health that retires with the branch

- The **private Web-Mercator copy** inside `DesignStudio.tsx` — `lib/map/webMercator.ts` is already
  the canonical one.
- `lib/map/tileCache.ts` / `lib/map/tileKey.ts` — keep only if B2 is kept.
- Dead siblings with zero importers: `DesignHeader`, `DesignSidebar`, `DesignToolbar`,
  `ViewOptionsMenu`, `RoofEditPanel`, `ProductionPanel`, `ShadeAnalysisPanel`.
  ⚠ `ViewOptionsMenu.tsx` contains a **second** 2D/3D toggle that would survive a careless cleanup.

---

## Order of work, if Ray wants it done

1. **D2** — give the 3D trace a "no 3D coverage" path: trace the footprint on the imagery plane,
   declare pitch + azimuth, and build a face that carries a real 3D frame. This unblocks rural
   addresses and retires H3 at the same time.
2. **D3 + D4 → F6 + F7 + F8** — emit the traced ground polygon and fence run from the engine, then
   the layout branches that depend on them.
3. **G1 + H1** — render what the product already knows: keep-out polygons and typed roof edges.
4. **I2 + I4** — the two diagnostics that catch coordinate-system and module-size disagreements.
5. **C5, J5, B4** — scale bar, banner, HD backdrop.
6. **B2** — Ray's decision: bounded paid workzone (today) vs free tile browsing (2D).
