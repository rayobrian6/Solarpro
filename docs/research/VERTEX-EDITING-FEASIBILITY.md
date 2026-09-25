# VERTEX-EDITING FEASIBILITY — AUDIT

**Date:** 2026-09-25 · **Scope:** READ-ONLY audit. No product source changed.
**Question:** another agent reported that `VertexHandles.tsx` is built, tested, imported and
never mounted, and that SolarPro cannot move a roof vertex, drag an edge, split a face or
merge two faces. Verify that before costing anything, then cost it.

---

## 0. VERDICT UP FRONT

**The claim HOLDS.** Every part of it is true, and the situation is worse than reported in
three ways the original claim did not reach.

**But the conclusion people will want to draw from it — "the component is written, just
mount it" — is FALSE.** The component cannot be mounted as written. Its pick math is
kilometres wrong off-nadir, half its geometry math is already proven defective by another
test in this repo, its unmount cleanup is a no-op, it installs a competing Cesium event
handler, and it takes no pointer ownership. Mounting it ships a proven-defective path while
all 40 of its tests stay green.

**Cost: LARGE, not bounded.** The smallest genuinely useful subset is in §7.

---

## 1. THE CLAIM, CHECKED LINE BY LINE

| Claim | Verdict | Evidence |
|---|---|---|
| `components/3d/editing/VertexHandles.tsx` exists | **TRUE** | 317 lines; barrel-exported at `components/3d/editing/index.ts:1-2` |
| It is unit-tested | **TRUE, but see §3** | `tests/vertexHandles.test.ts`, 541 lines, ~40 cases |
| Imported at `SolarEngine3D.tsx:312` | **TRUE** | exact line |
| Never mounted — zero `<VertexHandles` JSX | **TRUE** | repo-wide grep finds the string only in `components/3d/editing/DESIGN.md:63,177`, a doc comment in `lib/3d/vertexHandlesMath.ts:50`, and `docs/research/COMPETITOR-RESEARCH-LEDGER.md` |
| Cannot move a roof vertex | **TRUE** | no gesture anywhere moves a single geometry vertex |
| Cannot drag an edge | **TRUE** | no edge gesture exists |
| Cannot split a face | **TRUE** | no `splitFace`/`splitPlane` anywhere in `components/` or `lib/` |
| Cannot merge two faces | **TRUE** | no `mergeFace`/`mergePlane`; the only `mergeFacet` is in `lib/jurisdictions/legalGeography.ts`, unrelated |
| Aurora and Solargraf can do all four | **NOT RE-VERIFIED HERE** | sourced from `docs/research/COMPETITOR-RESEARCH-LEDGER.md`; in-repo research, taken as given |

An in-repo audit already reached the same finding independently:
`docs/research/GESTURE-OWNERSHIP-MAP.md:194-210` — *"Handler C — `VertexHandles` — DECLARED
BUT NOT MOUNTED (dead at runtime)"*.

### Three things the claim did not reach

**(a) There is more dead integration than the import.**
`SolarEngine3D.tsx:313-317` also imports `applyVertexMove`, `rebuildGableFaces`,
`rebuildHipFaces` and `VertexTargetSpec` — **all four are unused**. `vertexSpecsRef`
(`:2311`) is declared and never read or written. The `vertexSpecs` state (`:2312`) is
written at `:11646` (block), `:12010` (tree) and `:12520` (clear) and **never read by
anything**.

**(b) Gable and hip never register a spec at all.**
`setVertexSpecs` has exactly three call sites, and two of them are block and tree. So even
if the component were mounted today, **two of the four advertised primitive types would
show no handles**.

**(c) `vertexSpecs` is the wrong data source for the feature people want.**
It describes Block/Tree primitives the user drew with the in-canvas tools. The roof faces
that matter — the ones that feed pitch, panels, the BOM and the permit — live in
`roofPlanes` / building `sections`. Nothing builds a vertex spec from those. "Move a roof
vertex" is not one wiring step away from what exists; the spec source for it does not exist.

---

## 2. WHAT `VertexHandles` ACTUALLY DOES

**Props** (`VertexHandlesProps`, `:32-73`): `viewer`, `C` (the Cesium namespace), `specs:
VertexTargetSpec[]`, `enabled: boolean`, `onVertexUpdate(specId, vertexIdx, newLat,
newLng)`, and optional `onDragStart`, `onDragEnd`, `onDimensionReadout`.

**What it renders:** `return null`. No JSX. It adds one Cesium Point entity per vertex
directly into `viewer.entities`, with id `vertex-handle-${specId}-${i}`, and tags each
entity with `__specId` / `__vertexIdx`.

**What it does on drag:** it constructs **its own** `new
C.ScreenSpaceEventHandler(viewer.scene.canvas)` (`:175`) and registers LEFT_DOWN,
MOUSE_MOVE and LEFT_UP on it. LEFT_DOWN `scene.pick`s a `vertex-handle-` entity and arms a
ref. MOUSE_MOVE converts the cursor to lat/lng via `pickRayToLatLng`, runs
`validateVertexMove`, moves the handle entity, then calls `onVertexUpdate(...)`.

**What it would mutate:** *nothing, by itself.* The actual geometry write is delegated to
`onVertexUpdate`, **a prop that does not exist anywhere in the repo**. The file header
states the intent plainly: *"the parent receives the new vertex via onVertexUpdate and
updates the affected entity's polygon hierarchy directly."*

### The authority question — the one that decides safety

**It writes geometry through neither authority. It manipulates Cesium entities directly and
delegates the real mutation to an unwritten callback.** The design as documented
(`components/3d/editing/DESIGN.md:60-67`) is renderer-only: update the *entity's polygon
hierarchy*. That is exactly the forbidden shape in this codebase. Whether mounting it is
safe depends entirely on a handler that has never been written, and the component imposes
no constraint on where that handler writes.

### Defects inside the component itself

**D1 — `pickRayToLatLng` intersects a SPHERE, not the WGS84 ellipsoid. FATAL.**
`lib/3d/vertexHandlesMath.ts:370` sets `const R = 6_378_137` — the equatorial semi-major
axis — and solves the ray against a sphere of that radius. The real surface is below that
sphere everywhere except the equator:

| latitude | sphere sits this far above the true surface |
|---|---|
| 0° | 0 m |
| 25° | 3,819 m |
| **38.7° (Granite City)** | **8,360 m** |
| 45° | 10,692 m |
| 60° | 16,039 m |

The horizontal error is that offset times the tangent of the camera's off-nadir angle. At
38.7°N:

| off-nadir | horizontal error |
|---|---|
| 1° | **146 m** |
| 5° | **731 m** |
| 15° | **2,240 m** |
| 30° | **4,827 m** |
| 45° | **8,360 m** |

The vertex lands correctly only when the camera is exactly nadir and the cursor is exactly
at screen centre. This is the same class of defect as the geodetic-vs-geocentric "up"
finding. **And the unit test cannot see it — see §3.**

**D2 — No camera freeze.** The component has no access to `arrayManipRef`, `claimPointer`
or any camera concept. `docs/research/GESTURE-OWNERSHIP-MAP.md:414` already records this:
*"Would be defective — but the component is never mounted… If it is ever wired up it ships
the identical bug."* That is the P0 that has now shipped three times.

**D3 — A second `ScreenSpaceEventHandler` on the same canvas.** It does *not* delete
`setupClickHandler`'s registrations — `setInputAction` is per-handler-object, proven
against the installed Cesium in `tests/screenSpaceHandlerRegistration.test.ts:46` — but
both handlers fire. A vertex press would also run the select / panel-array / block-height
LEFT_DOWN logic in the same event.

**D4 — The unmount cleanup is a no-op.** `:291` calls
`h.entity.viewer?.entities?.remove(h.entity)`. A Cesium `Entity` has no `.viewer` property
(it has `entityCollection`), so the optional chain short-circuits and **every handle entity
leaks** on unmount.

**D5 — Gable/hip "vertex move" is really a bounding-box resize.**
`gableEaveCornersFromSpec` (`vertexHandlesMath.ts:235`) rebuilds all four corners from
min/max lat and min/max lng. Moving one corner therefore moves the other three, and the
result can only ever be axis-aligned. See §3 for the test that already proves this wrong.

**D6 — MOUSE_MOVE never checks `enabled`.** Harmless in practice (the drag only arms in
LEFT_DOWN, which does check), but it means a disabled editor still runs work per frame.

---

## 3. WHAT THE TESTS ACTUALLY PROVE

**They test `lib/3d/vertexHandlesMath.ts`. They do not touch `VertexHandles.tsx` at all.**
There is no render, no jsdom mount, no Cesium double. Zero of the 40 cases exercise the
component.

**Would they catch it writing to the wrong authority? No — they cannot.** The authority
write is `onVertexUpdate`, a prop. No test supplies one, calls one, or asserts anything
about where geometry lands. The entire integration surface — the part that decides whether
this creates renderer-only geometry — is untested by construction.

### The `pickRayToLatLng` tests are the exact anti-pattern this project has been bitten by

`tests/vertexHandles.test.ts:475-489` defines its own mock:

```js
const cartographicFromCartesian = (c) => {
  const R = Math.sqrt(c.x*c.x + c.y*c.y + c.z*c.z);
  return { latitude: Math.asin(c.z/R), longitude: Math.atan2(c.y,c.x), height: R - 6_378_137 };
};
```

That is **a sphere of radius 6,378,137 — the same sphere the function under test assumes.**
The test asserts the function's own arithmetic against itself. Production passes
`C.Cartographic.fromCartesian`, which is **ellipsoidal**. So the suite is permanently green
on a function that is 146 m to 4.8 km wrong in the product. The fixtures are also all at
lat 0 / lng 0, where the sphere and the ellipsoid coincide exactly — the one latitude at
which the bug is invisible.

### Two suites in this repo disagree about the same function, and the vertex one is wrong

`tests/buildingSectionMutation.test.ts` — DEFECT 1 — **imports and runs
`rebuildGableFaces` and proves it defective**: for a house at 30° bearing, the bbox
normalisation returns a ridge at 0° or 90° (`bearingGap180(...) > 20`) and inflates the
footprint by ~35%. It names the replacement authority: `buildSectionRoofPlanes` in
`lib/3d/buildingSection.ts`.

`tests/vertexHandles.test.ts` still asserts `rebuildGableFaces` correct — because every one
of its fixtures is axis-aligned (`GABLE_LAT0/LAT1`, `GABLE_LNG0/LNG1` form a north-aligned
rectangle), so the defect cannot appear.

**`rebuildGableFaces`, `rebuildHipFaces` and `gableEaveCornersFromSpec` are superseded by
proof.** Any vertex-editing work that calls them reintroduces a defect this repo has
already closed.

---

## 4. WHY IT WAS NEVER MOUNTED — THE HISTORY IS EXPLICIT, NOT SILENT

`git log --oneline -- components/3d/editing/VertexHandles.tsx` returns exactly one commit:

> **`9ad20b67`** — *feat(3d): vertex handles for in-place footprint editing (Block / Gable /
> Hip / Tree)* — Wed Aug 26 2026, author **JAMES**

Its own message contains the answer:

> *"Hand-off: parent commit (other agent) already includes the integration in
> SolarEngine3D.tsx (imports, state, callback, setVertexSpecs pushes, clear-button filters,
> `<VertexHandles>` render element)."*

**That hand-off assertion was false.** `git show 9ad20b67 -- components/3d/SolarEngine3D.tsx`
is +51 lines and contains **only** the LiDAR "Lift Roofs / Flatten Roofs" buttons. No
`<VertexHandles>`. The import at `:312`, the `vertexSpecs` state and the `setVertexSpecs`
pushes came from other commits in the same parallel drop (`8368fda8`, `652665b6`,
`7240cbf3`). The render element was written by nobody.

**`git log -S '<VertexHandles' --all`** returns only `9ad20b67` (which introduced the string
in `DESIGN.md`, not in source) and `122fca83` (the research ledger). **The JSX has never
existed in a `.tsx` file in any commit. Nothing was removed — it was never written.**

The same commit claims *"Aurora parity: 100%"* against a five-item checklist, and *"Test
results: 63 passed — vitest run green… tsc clean, lint ✔"*. All of that was true of a
feature that does not exist at runtime. This is a cross-agent integration hand-off that no
agent owned, from the drop already catalogued as *James's 3D drop — 62 defects*.

---

## 5. WHAT MOUNTING WOULD REQUIRE — CONCRETE CHECKLIST

**State it must be given**
- `viewer` = `viewerRef.current`; `C` = `(window as any).Cesium`. Both are refs, so the
  mount must sit in a render that happens after viewer init.
- `specs` — **must be built from `roofPlanesRef.current` / the section records, not from
  `vertexSpecs`.** That builder does not exist. `vertexSpecs` covers only Block and Tree,
  and nothing reads it.
- `enabled` — see the mode gate below.

**Where in the render tree**
Alongside `<TreeCursor … />` at `SolarEngine3D.tsx:~15204` — the existing precedent for a
null-rendering Cesium-side component mounted inside the engine's JSX under a live-viewer
guard.

**Which mode gates it**
The component's own doc says `placementMode === 'select'`. That is the wrong gate:
`'select'` already owns click-to-select, the panel-array grab and the block handle on
LEFT_DOWN. Add a new member to `PlacementMode` (`SolarEngine3D.tsx:426`) — `'vertex'` — so
the gesture has a mode of its own and the existing LEFT_DOWN consumers are not competing
for the same press.

**Escape / tool-change**
The drag state must be cleared and the pointer released at all three existing reset sites,
each of which already has a named guard in `tests/pointerGestureAuthority.test.ts`:
1. **tool change** — `SolarEngine3D.tsx:2515-2530` (`blockResizeRef … cancelObjectSizeDrag();
   suppressClickRef.current = false; releasePointer();`)
2. **Escape** — `:11137-11141`, which calls `cancelObjectSizeDrag(); releasePointer();`
   *first, before the early returns*
3. **full reset** — `:12566-12572`

The existing assertions name the existing gestures by string, so a vertex gesture that skips
these three sites would **not** fail the build unless new assertions are added.

**Pointer ownership — the critical part**
- **Owner name: `'vertex-move'`.** It must be added to the union at
  `SolarEngine3D.tsx:2186-2188`:
  `'array-move' | 'array-rotate' | 'block-height' | 'object-size' | null`.
- **Claim:** inside the vertex LEFT_DOWN, **only after** the pick has confirmed a
  `vertex-handle-` entity *and* the spec and vertex resolved. This mirrors the shape the
  guard already enforces for `object-size` (*"the claim escaped the `if (at)` guard — an
  unresolved press would freeze the map"*). A press that resolves nothing must not freeze
  the camera, because there is then no gesture for LEFT_UP to end.
- **Release:** in the LEFT_UP `finally`, as `blockResizeUp` does.

**🚨 The authority does not reach the component's file.**
`claimPointer` / `releasePointer` are closures inside `SolarEngine3D`, `arrayManipRef` is
local to it, and `tests/pointerGestureAuthority.test.ts` reads **only**
`components/3d/SolarEngine3D.tsx` — it asserts `arrayManipRef.current = true` appears
exactly once *in that file*. **A vertex drag written inside `VertexHandles.tsx` is invisible
to the guard and could ship the same P0 a fourth time with a fully green build.**

Two ways out; the second is strongly preferred:
1. Pass `claimPointer` / `releasePointer` down as props. Works, but leaves the guard blind.
2. **Move the LEFT_DOWN / MOUSE_MOVE / LEFT_UP trio into `setupClickHandler`** as three
   plain functions called from the surviving registrations — exactly the shape `52747eee`
   established for the block drag — and reduce `VertexHandles` to a pure handle renderer.
   This also removes D3 (the second handler) and puts the gesture inside the one handler
   `screenSpaceHandlerRegistration.test.ts` audits.

Either way, the build-failing guard should be widened to cover `components/3d/editing/*`,
or the hole stays open for the next gesture.

---

## 6. UNDO

**The block-height drag is confirmed NOT undoable — and the cause is structural.**
`blockResizeMove` (`:7353`) and `blockResizeUp` (`:7370`) write only
`blockHeightOverridesRef.current.set(...)`. They never call `recordGeometry` and never emit
`onRoofPlanesStitched`.

**`recordGeometry` does not exist inside `SolarEngine3D`.** It is defined at
`components/design/useSiteDesign.ts:341` and called from exactly three places, all in
`components/design/DesignStudio.tsx`:
- `:5382` — `site.recordGeometry('Add roof face')`
- `:5469` — `site.recordGeometry(meta.label, meta.coalesceKey)` (the
  `onRoofGeometryReplaced` path; note the **snapshot-before-adopt** ordering comment)
- `:5499` — `site.recordGeometry('Reshape roof')`

`SolarEngine3D` receives only `onUndoGeometry` / `onRedoGeometry` / `canUndoGeometry` /
`undoGeometryLabel` for its toolbar buttons (`:15416`). It has no write handle on the undo
stack at all.

**So there is exactly one undoable geometry channel out of SolarEngine3D:**

```
SolarEngine3D → onRoofPlanesStitched(updates: RoofPlaneReshapeUpdate[])
              → DesignStudio.tsx:5497 → site.recordGeometry('Reshape roof') + setRoofPlanes(...)
```

Four emitters feed it today: flat-trace re-raise (`:1574`), Square Up (`:5638`), the
standalone face path (`:5818`) and Stitch (`:6429`). `tests/reshapeKeepsPitch.test.ts:104`
asserts **exactly four** (`RoofPlaneReshapeUpdate[] = [];` × 4), so a fifth emitter is a
deliberate, guarded change.

**A vertex drag is undoable only if it emits through that channel.** Requirements:
- **One record per completed drag, on LEFT_UP only** — never per MOUSE_MOVE frame, or a
  single drag puts hundreds of entries on the undo stack. `recordGeometry` takes a
  `coalesceKey` for exactly this (used at `DesignStudio:5469`).
- The record must be taken **before** the new geometry is adopted, per the
  snapshot-first-then-adopt rule the existing handler documents.

---

## 7. THE HONEST RISK

### What the channel already carries — the good news

`RoofPlaneReshapeUpdate` (`SolarEngine3D.tsx:494-543`) is complete for the face itself. Each
field was added after a specific defect, and all of them matter to a vertex move:

| field | why it is there |
|---|---|
| `vertices` | the lat/lng ring |
| `polygon3D`, `origin3D`, `normal3D` | so reload rebuilds the reshaped outline, not the pre-reshape one |
| `pitch`, `azimuth` | added after the roof changed under a stale `plane.pitch` and **the permit quoted the wrong pitch permanently** |
| `localFrame3D` | the 2D frame |
| `ecefFrame3D` | added after panels were placed with a new origin on an **old triad** — a wedge that goes negative at ~0.48° and removes whole rows via `cos²(Δ)` foreshortening, reaching panel count, kW and the BOM |

**This is the single strongest argument for routing a vertex drag through
`onRoofPlanesStitched` rather than inventing a path.** All of that re-derivation is already
solved and guarded.

### What would silently NOT re-derive

1. **Panel layout.** `setRoofPlanes` replaces the geometry; existing panels on that face are
   not re-laid or re-culled. Drag a vertex inward and panels hang off the new edge. A cull
   path exists (`onPanelsAboutToBeCulled` → `site.recordPanelCull`) but is **not** on this
   channel.
2. **Area, kW and the BOM.** Derived from the plane *and* from the panels. The plane updates,
   the panels do not, so the two disagree with nothing reporting it.
3. **Shade.** `runShadeAnalysis` is driven by a button (`onRunShadeAnalysis`), not by a
   geometry change. A moved vertex keeps the old shade factors indefinitely.
4. **The section record.** `lib/3d/buildingSection.ts` is the authority for gable/hip/flat
   sections (`buildSectionRoofPlanes`, `validateSection`, `replaceSectionFaces`,
   `sectionRecord`). Editing a face ring without going back through it desynchronises the
   section from its own faces — and `sectionsFromPlanes` is what reconstitutes sections on
   reload. Note also that `MIN_SECTION_EDGE_M` (0.5 m) and `validateSection`'s refusal codes
   are the *real* validator; `validateVertexMove` is a weaker parallel one that knows
   nothing about section kinds.
5. **The permit snapshot digest.** A vertex move that genuinely changes pitch/azimuth/area
   *should* move the digest and retire live PE approvals — that is correct behaviour. The
   danger is the two failure modes either side of it: moving the digest for a
   **renderer-only** edit that never reached the data model, or failing to move it for a
   real one.
6. **Persistence.** `tests/autosaveAdversarial.test.ts:326` asserts `vertexSpecs` / `trees` /
   `blocks` have **no** outbound callback to the studio, and `:458` asserts none of them are
   in `SIGNED_DESIGN_PARAMS` / `SIGNED_FIELDS`. Routing through `onRoofPlanesStitched` fixes
   persistence for **roof faces**. It does **not** fix it for Block / Gable / Hip / Tree
   primitives, and adding `onVertexSpecsChange` would fail that test *on purpose*.

---

## 8. VERDICT AND THE SMALLEST USEFUL SUBSET

### LARGE, not bounded

"It's already written, just mount it" is wrong. What exists is a renderer that draws points,
attached to a math library that is half superseded, wired to a callback nobody wrote,
pointed at data (`vertexSpecs`) that nothing reads and that does not describe roof faces.
The 40 green tests measure none of that.

### The smallest genuinely useful subset

**Move one existing vertex of one already-selected ROOF PLANE. No add, no delete, no edge
drag, no split, no merge, no Block/Gable/Hip/Tree.** That is the highest-value single
gesture and it is provable end to end.

1. Build handle specs from `roofPlanesRef.current` for the **currently selected plane only**
   (`selectedPlaneRef` / `selectedFaceIdRef`), not from `vertexSpecs`.
2. Keep `VertexHandles` as a **renderer only**. Delete its `ScreenSpaceEventHandler`. Fix
   the leaking cleanup (D4) while there.
3. Put LEFT_DOWN / MOUSE_MOVE / LEFT_UP inside `setupClickHandler` as three plain functions
   called from the surviving registrations — the shape `52747eee` established.
4. **Do not use `pickRayToLatLng`.** Use `resolvePlacementPoint(viewer, C, screenPos,
   'roof')` (`:8017`) — the canonical "where did the user point" authority, which already
   handles terrain, the ground datum and the diagnostic trail. Delete `pickRayToLatLng`, or
   fix it against the real ellipsoid so the next caller does not inherit D1.
5. `claimPointer('vertex-move')` inside the successful-pick guard; release in the LEFT_UP
   `finally`; add the gesture to all three reset sites **and** to
   `tests/pointerGestureAuthority.test.ts`.
6. On LEFT_UP only, rebuild the face through the canonical section/plane path and emit **one**
   `RoofPlaneReshapeUpdate` carrying `vertices`, `polygon3D`, `origin3D`, `normal3D`,
   `pitch`, `azimuth`, `localFrame3D` and `ecefFrame3D`. **Never** call `rebuildGableFaces`
   or `rebuildHipFaces`. Update `reshapeKeepsPitch.test.ts`'s `toHaveLength(4)` deliberately.
7. Decide and state the panel policy: either re-lay/cull the face's panels on commit, or
   refuse the edit while the face carries panels and say why. Silently leaving stale panels
   is the outcome that reaches the BOM and the permit.

### Independent of whether vertex editing ships

`rebuildGableFaces`, `rebuildHipFaces` and `gableEaveCornersFromSpec` should be deleted or
marked superseded now. `tests/buildingSectionMutation.test.ts` already proves them wrong;
`tests/vertexHandles.test.ts` still asserts them correct. Leaving two suites disagreeing
about the same function is how the wrong one gets copied.

---

## 9. FILE INDEX

| Path | Role |
|---|---|
| `components/3d/editing/VertexHandles.tsx` | the unmounted component (317 lines) |
| `components/3d/editing/index.ts` | barrel re-export |
| `components/3d/editing/DESIGN.md` | the original design doc; its integration plan was never executed |
| `lib/3d/vertexHandlesMath.ts` | the math; `pickRayToLatLng` (D1) and the gable/hip rebuilds are defective |
| `tests/vertexHandles.test.ts` | 40 green tests that cannot see either defect |
| `tests/buildingSectionMutation.test.ts` | **proves `rebuildGableFaces` wrong** (DEFECT 1) |
| `tests/pointerGestureAuthority.test.ts` | the build-failing pointer guard — scoped to `SolarEngine3D.tsx` only |
| `tests/screenSpaceHandlerRegistration.test.ts` | proves `setInputAction` overwrite semantics; audits one handler |
| `tests/reshapeKeepsPitch.test.ts` | pins the reshape contract and the emitter count at 4 |
| `tests/autosaveAdversarial.test.ts` | asserts `vertexSpecs` has no outbound callback and is unsigned |
| `components/3d/SolarEngine3D.tsx` | `:312-317` dead imports · `:426` PlacementMode · `:494` reshape contract · `:2186` pointer authority · `:2311-2312` dead state · `:7308-7409` block-height drag · `:8017` `resolvePlacementPoint` · `:11140` Escape · `:12571` reset · `:15204` TreeCursor mount precedent |
| `components/design/useSiteDesign.ts:341` | `recordGeometry` — the undo authority |
| `components/design/DesignStudio.tsx:5497-5499` | the one undoable channel from the engine |
| `lib/3d/buildingSection.ts` | the canonical section authority that supersedes the gable/hip rebuilds |
| `docs/research/GESTURE-OWNERSHIP-MAP.md:194-210, 414` | prior in-repo audit reaching the same finding |
