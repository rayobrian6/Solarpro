# GESTURE OWNERSHIP MAP — SolarPro 3D engine

READ-ONLY forensic audit. Every claim below carries a `file:line` citation and was read
out of the working tree, not recalled. Anything I could not establish from the source is
marked **UNKNOWN** rather than guessed.

Audit date: 2026-09-25. Engine file: `components/3d/SolarEngine3D.tsx` (17,766 lines).

---

## 0. THE HEADLINE — THE BRIEF'S PREMISE IS WRONG, AND THE REPAIR MUST NOT FOLLOW IT

The task brief supposes the live defect is that "nothing ever disables the camera
controller while the placement drag owns the pointer", and points at
`scene.screenSpaceCameraController`.

**Cesium's `screenSpaceCameraController` is not the camera authority in this product and
has not been since boot.** It is switched off — completely and permanently — once, during
viewer init, and is never touched again anywhere in the repository:

`components/3d/SolarEngine3D.tsx:3624-3635`
```ts
      // ── 1. Disable Cesium's built-in camera input ────────────────────────────
      try {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableInputs     = false;   // disables all Cesium mouse/touch handling
        ctrl.enableRotate     = false;
        ctrl.enableTilt       = false;
        ctrl.enableZoom       = false;
        ctrl.enableLook       = false;
        ctrl.enableTranslate  = false;
        // Keep collision detection off so we can tilt past 90°
        ctrl.enableCollisionDetection = false;
      } catch (e) { addLog('WARN', `ctrl disable: ${(e as Error).message}`); }
```

A repo-wide grep for `screenSpaceCameraController|enableRotate|enableTranslate|enableTilt|
enableZoom|enableLook|enableInputs` (excluding `node_modules`) returns **exactly these
seven lines and nothing else**. There is no other reader, no other writer, no restore.

The reason is documented in the 37 comment lines immediately above
(`SolarEngine3D.tsx:3587-3622`): Cesium's controller is calibrated for planet-scale
navigation and misbehaves at roof altitude, so the product replaced it with a **custom
turntable orbit controller** built on raw DOM pointer events
(`SolarEngine3D.tsx:3763-3928`).

The engine states this explicitly at the declaration of the real gate,
`SolarEngine3D.tsx:2152-2157`:

```ts
  // v62: true while a grab-to-move/rotate is in progress. The CUSTOM camera handler
  // (DOM pointermove orbit/pan, set up in boot) checks this and bails, so dragging an
  // array doesn't also pan/orbit the camera. (Cesium's built-in controller is fully
  // disabled here, so toggling its enable flags does nothing — this is the real gate.)
  const arrayManipRef = useRef<boolean>(false);
```

**Consequence for the P0 repair: setting `enableRotate = false` (or any sibling flag)
during the tree drag would be a no-op — it would change nothing, the camera would still
move, and the fix would appear to fail for reasons nobody could see.** The one and only
camera-ownership token in this codebase is `arrayManipRef`.

### Where the custom camera actually yields

`SolarEngine3D.tsx:3815-3820` — the single check that stops the camera:
```ts
        const handleDragMove = (ev: PointerEvent | MouseEvent) => {
          if (!orbit.dragging) return;
          // v62: an array grab is active → don't move the camera (let the array
          // manipulation own the drag). Without this the left-drag PANS the camera
          // while the array also rotates/moves — the cause of the "shear".
          if (arrayManipRef.current) return;
```

Left-drag pans the orbit target (`:3830-3844`); right/middle-drag orbits (`:3846-3861`).
So a left-button drag with `arrayManipRef === false` **pans the map**.

### The live defect, located exactly

`SolarEngine3D.tsx:7406-7420` — the site-object size drag arms **without taking camera
ownership**. Compare it with its three siblings, which all do:

| Gesture | Arms at | Takes camera? |
|---|---|---|
| Block height drag | `:7168` | **YES** — `arrayManipRef.current = true` at `:7173` |
| Array rotate | `:7442` | **YES** — `:7443` |
| Array move | `:7452` | **YES** — `:7453` |
| **Site-object size drag** | **`:7411`** | **NO — the assignment is simply absent** |

```ts
      if (modeRef.current === 'tree' || modeRef.current === 'obstruction') {
        const pre = presetFor(obstructionPresetRef.current);
        if (pre.space === 'site') {
          const at = resolvePlacementPoint(viewer, C, event.position, 'site');
          if (at) {
            objectSizeDragRef.current = {
              lat: at.lat, lng: at.lng,
              screenX: event.position.x, screenY: event.position.y,
              dragged: false,
            };
            setObjectDragAnchor({ lat: at.lat, lng: at.lng });
          }
        }
        return;
      }
```

That single omission fully explains **both** reported symptoms, and the second one is
worse than "the camera drifts":

1. **The camera moves.** `arrayManipRef` stays `false`, so `handleDragMove` at `:3820`
   does not bail, and the left-drag pans the orbit target.

2. **The tree does not land where the user aimed — and this is a *consequence* of (1),
   not a separate bug.** Commit at `:7549` re-resolves placement from the **screen
   pixel**, not from the lat/lng captured at press:
   ```ts
          handleObstructionClick(viewer, C, { x: sz.screenX, y: sz.screenY });
   ```
   `sz.screenX/screenY` were recorded under the press-time camera (`:7413`). By mouse-up
   the camera has panned, so that same pixel now projects onto a **different ground
   point**. The anchor lat/lng at `:7412` is captured but only used for the radius maths;
   the placement itself is re-derived from a pixel whose meaning has changed underneath it.

3. **The committed size is also wrong.** The radius at `:7473-7477` is measured from
   `sz.lat/sz.lng` (press-time ground point) to `resolvePlacementPoint(... event.endPosition ...)`
   (the cursor's ground point under the *panned* camera). Because the pan uses
   Google-Maps "scene follows the cursor" semantics (`:3835-3844`), the ground under the
   cursor partially tracks the cursor, so the measured radius **under-reports** the drag.
   Fixing the camera ownership fixes the size as a side effect.

**Therefore the repair is a one-token change of the same shape as `:7173` / `:7443` /
`:7453`, plus the matching release on every exit path.** No new mechanism is needed, and
none should be invented. See §6.

---

## 1. EVERY `setInputAction` REGISTRATION IN THE REPOSITORY

Five `ScreenSpaceEventHandler` objects are constructed in product code. All five are built
on **the same canvas**, `viewer.scene.canvas`. A sixth handler — Cesium's own
`viewer.screenSpaceEventHandler` — also exists and is partially disarmed.

### Handler A — `setupClickHandler`'s handler (the main gesture handler)

Constructed `SolarEngine3D.tsx:7104`, stored in `handlerRef.current` at `:7105`.
Destroyed at `:7099` (re-entry guard, so a second `setupClickHandler` call cannot leak)
and at `:14892` (unmount/teardown). Called exactly once from the viewer-init effect at
`:4130` — so **every closure here is mount-frozen** (this is why the reads go through
refs; see `tests/mountFrozenClosure.test.ts`).

Immediately before constructing it, `:7102` removes Cesium's built-in double-click:
```ts
    try { viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); } catch {}
```

| # | Line | Event type | Modifier | What it owns |
|---|---|---|---|---|
| A1 | `:7278` → closes `:7348` | `LEFT_CLICK` | none | Per-mode click dispatch (22 modes) |
| A2 | `:7351` → closes `:7355` | `LEFT_CLICK` | `SHIFT` | Multi-select toggle, `select` mode only |
| A3 | `:7360` → closes `:7371` | `LEFT_DOUBLE_CLICK` | none | Drill into array, `select` mode only |
| A4 | `:7377` → closes `:7455` | `LEFT_DOWN` | none | Block-handle drag, size drag, array grab |
| A5 | `:7457` → closes `:7525` | `MOUSE_MOVE` | none | Drives whichever drag A4 armed |
| A6 | `:7527` → closes `:7568` | `LEFT_UP` | none | Commits whichever drag A4 armed |
| A7 | `:7570` → closes `:7619` | `RIGHT_CLICK` | none | Finalize/cancel per mode |

**No slot is registered twice.** A1 and A2 are both `LEFT_CLICK` but A2 carries
`C.KeyboardEventModifier.SHIFT`, which is a different key in Cesium's map
(`getInputEventKey(type, modifier)`), so this is legal and both survive. Seven distinct
slots, seven registrations.

This is the **repaired** state of a defect that was live earlier: the block-height trio
used to be registered separately on this same handler and was silently deleted by the
array trio. The fix was to demote the block trio to **plain functions** called from
inside the surviving registrations — `blockResizeDown` (`:7121`), `blockResizeMove`
(`:7181`), `blockResizeUp` (`:7224`), invoked at `:7398`, `:7458`, `:7528`. The comment at
`:7112-7120` records this. **Any repair must follow the same rule: add branches inside
A4/A5/A6, never a new registration.**

### Handler B — `setupHoverHandler`'s handler

Constructed `SolarEngine3D.tsx:7623`. One registration:

| # | Line | Event type | Modifier | What it owns |
|---|---|---|---|---|
| B1 | `:7624` → closes `:7644` | `MOUSE_MOVE` | none | Cursor lat/lng/height readout; returns early in `select` mode (`:7626`) |

**Lifecycle defect (pre-existing, not the P0):** this handler is assigned to a local
`const handler` (`:7623`) and is **never stored in a ref and never destroyed**. `:7099`
and `:14892` only destroy `handlerRef.current`, which is Handler A. If
`setupHoverHandler` ever ran twice, the first handler would leak with its listeners still
attached. It is currently called exactly once (`:4131`), so this is latent, not live.

### Handler C — `VertexHandles` — **DECLARED BUT NOT MOUNTED (dead at runtime)**

Constructed `components/3d/editing/VertexHandles.tsx:175`, stored at `:176`, destroyed in
the effect cleanup at `:284-287`. Three registrations on one handler, all distinct slots:

| # | Line | Event type | Modifier | What it owns |
|---|---|---|---|---|
| C1 | `:179` → closes `:211` | `LEFT_DOWN` | none | Pick a `vertex-handle-*`, start a vertex drag |
| C2 | `:214` → closes `:262` | `MOUSE_MOVE` | none | Move the vertex, live readout |
| C3 | `:265` → closes `:281` | `LEFT_UP` | none | Finalize, restore handle visual |

**This component is imported at `SolarEngine3D.tsx:312` and never rendered.** A repo-wide
grep for `VertexHandles` outside its own file returns only the import (`:312`), a comment
(`:311`), the barrel re-export (`components/3d/editing/index.ts:1-2`) and two doc
comments in `lib/3d/vertexHandlesMath.ts`. **There is no `<VertexHandles …>` JSX anywhere
in the repository.** So Handler C does not exist at runtime today, and the camera bug it
carries (§4) is latent-on-revival rather than live.

### Handler D — `TreeCursor` — **MOUNTED AND LIVE**

Constructed `components/3d/tree/TreeCursor.tsx:180`, stored at `:221`, destroyed by
`teardown()` in the effect cleanup (`:223-225`, `:238-243`). Rendered at
`SolarEngine3D.tsx:15204`.

| # | Line | Event type | Modifier | What it owns |
|---|---|---|---|---|
| D1 | `:181` → closes `:212` | `MOUSE_MOVE` | none | Moves the canopy preview entity; pins it to `anchorRef` while a drag anchor is set |

Read-only with respect to gestures — it mutates a preview entity and never touches
`arrayManipRef`, drag state or the camera. Correctly so.

### Handler E — `SegmentArrowOverlay` — **MOUNTED AND LIVE**

Constructed `components/3d/segments/SegmentArrowOverlay.ts:117`, destroyed in `clear()`
at `:101-104`. Created at `SolarEngine3D.tsx:3550`. Rebuilt on **every** `update()` call
(`:114-117`) — `clear()` runs first, so exactly one instance exists at a time.

| # | Line | Event type | Modifier | What it owns |
|---|---|---|---|---|
| E1 | `:118` → closes `:130` | `LEFT_CLICK` | none | Pick a segment arrow, flip its normal |

### Handler F — Cesium's own `viewer.screenSpaceEventHandler`

Not constructed by product code; owned by the `Viewer`. Only touched at
`SolarEngine3D.tsx:7102`, which removes its `LEFT_DOUBLE_CLICK` action.

### Same-canvas coexistence (legal — all of them fire)

Because these are **separate handler objects**, registrations on the same event type do
not overwrite each other; Cesium dispatches to each handler independently.

| Event type | Handlers that receive it at runtime |
|---|---|
| `MOUSE_MOVE` | A5, B1, **D1** — three live handlers |
| `LEFT_CLICK` | A1, **E1** — two live handlers |
| `LEFT_DOWN` / `LEFT_UP` | A4 / A6 only (C1/C3 would join if `VertexHandles` were ever mounted) |
| `LEFT_DOUBLE_CLICK` | A3 (Cesium's own removed at `:7102`) |
| `RIGHT_CLICK` | A7 |

**Duplicate-slot defects found: ZERO.** No event-type + modifier pair is registered twice
on any single handler object.

---

## 2. EVERY PLACE THE CAMERA CONTROLLER IS TOUCHED

### 2a. `scene.screenSpaceCameraController` — one site, permanent, never restored

`SolarEngine3D.tsx:3626-3634`. All six enable flags plus `enableCollisionDetection` are
set `false` during viewer init. **Nothing re-enables them, anywhere, ever.**

Is this an "unrestored camera" risk? **No — it is the intended permanent state**, and
restoring any of these flags would be a regression, because Cesium's controller would then
fight the custom orbit controller for the same pointer stream. The whole custom controller
(`:3587-3928`) exists on the premise that it is off. Documented at `:3603-3604` and again
at `:2155-2156`.

The `try/catch` at `:3625/:3635` means that if this assignment ever threw, the flags would
stay `true` and Cesium's controller would run *alongside* the custom one — logged as a
`WARN` only. That is a theoretical double-camera path, not the reported defect.

### 2b. `arrayManipRef` — the real camera-ownership token

Declared `SolarEngine3D.tsx:2157`. Read at exactly one place: `:3820`, inside
`handleDragMove`. Written at six places:

| Line | Value | Context | Release guaranteed? |
|---|---|---|---|
| `:7173` | `true` | `blockResizeDown` arms the block-height drag | **YES** — `:7274` is inside a `finally` (`:7272-7275`) |
| `:7274` | `false` | `blockResizeUp` `finally` block | — |
| `:7443` | `true` | Array **rotate** arms | Conditional — see risk R1 |
| `:7453` | `true` | Array **move** arms | Conditional — see risk R1 |
| `:7557` | `false` | `LEFT_UP`, array-drag branch | — |
| `:2442` | `false` | Tool-change effect — "never leave the camera frozen on tool change" | Backstop |
| `:12352` | `false` | Full reset routine | Backstop |

### Unrestored-camera risks

**R1 — `LEFT_UP` returns before the reset on two paths (low severity today, HIGH after the repair).**
`SolarEngine3D.tsx:7527-7557`:
```ts
    handler.setInputAction(() => {
      if (blockResizeRef.current) { blockResizeUp(); return; }   // :7528 — safe, finally
      const sz = objectSizeDragRef.current;
      if (sz) { …; return; }                                     // :7543-7552 — returns, no reset
      const drag = dragRef.current;
      if (!drag) return;                                         // :7554-7555 — returns, no reset
      dragRef.current = null;
      arrayManipRef.current = false;                             // :7557 — only reached here
```
Today the `sz` branch (`:7544-7552`) is harmless *precisely because* the size drag never
took the camera. **The moment the repair sets `arrayManipRef = true` at `:7411`, this
`return` at `:7551` becomes a permanent camera freeze** unless the release is added inside
that branch. This is the single most likely way to turn the P0 into a worse P0.

**R2 — `LEFT_UP` is delivered on the canvas, not the document.**
Verified against the **installed** Cesium (`node_modules/cesium/Build/Cesium/Cesium.js`,
function `ZCt`), not from memory:
```js
sn.supportsPointerEvents()
  ? (wu(e,"pointerdown",t,BCt), wu(e,"pointerup",t,CSe),
     wu(e,"pointermove",t,FCt), wu(e,"pointercancel",t,CSe))
  : (wu(e,"mousedown",t,ESe), wu(e,"mouseup",n,TSe), wu(e,"mousemove",n,SSe), …)
```
where `t = e._element` (the canvas) and `n = document`. On the pointer-events path — every
modern browser — **`pointerup` is bound to the canvas, not the document.** A release
outside the canvas would therefore not deliver `LEFT_UP` at all.

It is rescued, *accidentally*, by the custom camera controller: `:3797` calls
`cesiumCanvas.setPointerCapture(ev.pointerId)` on `pointerdown`, which retargets the whole
pointer stream to the canvas, so Cesium's canvas-bound `pointerup` still fires off-canvas.
**That call is wrapped in a bare `try {} catch {}`** (`:3797`) — if pointer capture is
unavailable or throws, an off-canvas release silently delivers no `LEFT_UP`, and any drag
that took the camera keeps it until a tool change (`:2442`) or a reset (`:12352`).
Cesium does map `pointercancel` to the same handler (`CSe` above), which covers the
cancel case.

**R3 — `MOUSE_MOVE` (A5) has no top-level `try/catch`.** `:7457-7525`. The `LEFT_CLICK`
handler wraps its whole body (`:7279`/`:7345`) and `blockResizeMove` wraps its own
(`:7184`/`:7220`), but the size-drag branch (`:7467-7485`) and the array-drag branch
(`:7487-7524`) are bare. A throw from `resolvePlacementPoint` or the Cesium ray maths
escapes into Cesium's dispatcher. It does not by itself strand `arrayManipRef` — the drag
stays armed and the next `LEFT_UP` still releases it — but it will spam and can leave the
gesture half-applied.

**R4 — `objectSizeDragRef` is missing from both reset lists.** `objectSizeDragRef` occurs
at only five lines: `:2334` (declaration), `:7411`, `:7467`, `:7543`, `:7545`. It is
**absent from the tool-change reset** (`:2425-2447`, which clears `dragRef` at `:2433`,
`blockResizeRef` at `:2440`, `suppressClickRef` at `:2441`, `arrayManipRef` at `:2442`)
and **absent from the full reset** (`:12349-12356`, which clears `dragRef`,
`blockResizeRef`, `arrayManipRef`, `suppressClickRef`, and all three ruler refs).
An abandoned size drag therefore survives a tool change and keeps swallowing `MOUSE_MOVE`
and `LEFT_UP` in the next tool (`:7467`, `:7543` both branch before the array logic).
This is **exactly the defect the comment at `:2434-2439` says was fixed for
`blockResizeRef`** — and the same omission was repeated for the newer ref. After the
repair it is also a camera-freeze path.

**R5 — ordering note in the array branch is actually correct.** At `:7556-7557`
`arrayManipRef` is released *before* the unguarded commit calls at `:7558-7566`
(`onPanelsChange`, `showRotateHandle`). A throw there loses the commit but **not** the
camera. This ordering is deliberate-looking and should be preserved.

---

## 3. MODE-BY-MODE OWNERSHIP TABLE

`PlacementMode` is declared at `SolarEngine3D.tsx:426` — 25 members. (A second, unrelated
`PlacementMode` exists at `lib/3d/controlLayer.ts:82` with 8 members; it describes panel
*fill* strategies and is not the tool state used by these handlers. Do not confuse them.)

The `LEFT_DOWN` handler (A4, `:7377-7455`) resolves in this fixed order:
1. `suppressClickRef.current = false` — all modes (`:7393`)
2. `blockResizeDown(event)` — **all modes**, arms only on a `block-handle-*` pick (`:7398`, guard `:7128`)
3. if armed → `return` (`:7399`)
4. if mode is `tree` or `obstruction` **and** preset `space === 'site'` → arm size drag; **`return` unconditionally** (`:7406-7420`)
5. if mode !== `select` → `return` (`:7422`)
6. `select` → rotate handle (`:7434-7445`) or array body (`:7448-7454`)

"Camera during drag" is decided by `arrayManipRef` alone (`:3820`). **Camera LIVE during a
drag means the map pans under the gesture.**

| Mode (`:426`) | `LEFT_DOWN` owner | `MOUSE_MOVE` owner | `LEFT_UP` owner | `LEFT_CLICK` owner | Camera during drag |
|---|---|---|---|---|---|
| `select` | A4 — block handle (`:7398`), else array rotate (`:7442`) / move (`:7452`) | A5 — block (`:7458`), else array (`:7487`) | A6 — block (`:7528`), else array (`:7554`) | A1 → `handleSelectClick` (`:7285`); SHIFT→A2; dbl→A3 | **FROZEN ✓** (`:7173`/`:7443`/`:7453`) |
| `tree` | A4 — block handle, else **size drag** (`:7411`) | A5 — size drag (`:7467`) | A6 — size drag commit (`:7543`) | A1 → `handleObstructionClick` (`:7314`) | **LIVE ✗ — THE DEFECT** |
| `obstruction` | A4 — block handle, else **size drag** (`:7411`) | A5 — size drag (`:7467`) | A6 — size drag commit (`:7543`) | A1 → `handleObstructionClick` (`:7301`) | **LIVE ✗ — THE DEFECT** |
| `block` | A4 — block handle only (`:7398`) | A5 — block only (`:7458`) | A6 — block only (`:7528`) | A1 → `handleBlockClick` (`:7306`); A7 finalizes (`:7597`) | FROZEN ✓ on a handle drag; LIVE while tracing (correct — tracing is click-based) |
| `roof` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleRoofClick` (`:7286`) | LIVE (no drag gesture) |
| `ground` / `ground_array` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleGroundArrayClick` (`:7290`) | LIVE (no drag gesture) |
| `fence` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleFenceClick` (`:7291`); A7 finalizes (`:7583`) | LIVE (no drag gesture) |
| `plane` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handlePlaneClick` (`:7292`); A7 (`:7571`) | LIVE (no drag gesture) |
| `plane3d` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handlePlane3DClick` (`:7302`); A7 (`:7573`) | LIVE (no drag gesture) |
| `mark_plane` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handlePlane3DClick` (`:7303`); A7 (`:7576`) | LIVE (no drag gesture) |
| `row` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleRowClick` (`:7293`) | LIVE (no drag gesture) |
| `extend_row` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleExtendRowClick` (`:7298`) | LIVE (no drag gesture) |
| `add_row` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleAddRowClick` (`:7299`) | LIVE (no drag gesture) |
| `snap_panel` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleSnapPanelClick` (`:7300`) | LIVE (no drag gesture) |
| `surface_select` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleSurfaceSelectClick` (`:7297`) | LIVE (no drag gesture) |
| `measure` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleMeasureClick` (`:7294`); A7 clears (`:7588`) | LIVE (click-based, not a drag) |
| `measurements` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleMeasurementsClick` (`:7295`) | LIVE (click-based) |
| `set_direction` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleSetDirectionClick` (`:7304`) | LIVE (no drag gesture) |
| `set_origin` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleSetOriginClick` (`:7305`) | LIVE (no drag gesture) |
| `roof_gable` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleGableClick` (`:7307`); A7 cancels (`:7593`) | LIVE (no drag gesture) |
| `roof_hip` | A4 — block handle only | A5 — block only | A6 — block only | A1 → `handleHipClick` (`:7308`); A7 cancels (`:7595`) | LIVE (no drag gesture) |
| `pick_house` | A4 — block handle only | A5 — block only | A6 — block only | A1 inline block (`:7318-7344`) | LIVE (no drag gesture) |
| `auto_roof` | A4 — block handle only | A5 — block only | A6 — block only | **NONE** — fires from a `placementMode` effect, not a click (`:7315`) | LIVE (no drag gesture) |
| **`ruler`** | **NONE — see §4** | **NONE** | **NONE** | **NONE** | **N/A — the mode is inert** |

No cell is UNKNOWN. Every row was read off the actual guard conditions at `:7278-7568`.

---

## 4. EVERY COMPETING DRAG GESTURE

| Gesture | Arms | Camera ownership | Verdict |
|---|---|---|---|
| **Block height resize** | `:7168-7173` | `arrayManipRef = true` (`:7173`); released in a **`finally`** (`:7272-7275`) | **CORRECT — and the strongest of the three.** The `finally` means even a throw inside `blockResizeUp` hands the camera back. |
| **Array rotate** (⟳ handle) | `:7442-7443` | `true` at `:7443`; released at `:7557` | **CORRECT**, with the R1 caveat (release is not in a `finally`, and two `return`s precede it) |
| **Array move** (body drag) | `:7452-7453` | `true` at `:7453`; released at `:7557` | **CORRECT**, same caveat |
| **Site-object size drag (tree / obstruction)** | `:7411` | **NONE — never set, never released** | **DEFECTIVE — this is the live P0** |
| **Vertex drag** (`VertexHandles`) | `VertexHandles.tsx:195-200` | **NONE.** The component has no access to `arrayManipRef` and no camera concept anywhere in the file | **Would be defective — but the component is never mounted** (§1, Handler C), so this is latent, not live. If it is ever wired up it ships the identical bug. |
| **Ruler drag** (`ruler` mode) | Never | N/A | **THE GESTURE DOES NOT EXIST.** See below. |
| **Measure / measurements** | N/A | N/A | Click-based (`:7294`, `:7295`), not drags. No camera concern. |
| **Obstruction *move*** | — | — | **There is no such gesture.** No handler branch moves an existing obstruction. Placement is click/drag-to-create only. |
| Canvas render pump (`:4310-4316`) | `mousedown`/`pointerdown` | Sets only a local `dragActive` flag driving `requestRender` | Not a gesture. No camera authority. Correctly inert. |

### The ruler is dead code, and a comment in the handler asserts otherwise

`SolarEngine3D.tsx:7296` says:
```ts
        // ruler is routed via LEFT_DOWN / MOUSE_MOVE / LEFT_UP below (drag semantics)
```
**That statement is false.** `handleRulerDown` (`:11142`), `handleRulerMove` (`:11164`)
and `handleRulerUp` (`:11189`) are declared and **never called**. `grep -c handleRulerDown`
returns `2` — the declaration at `:11142` and the error string inside its own `catch` at
`:11160`. The same holds for the other two. I read A4 (`:7377-7455`), A5 (`:7457-7525`)
and A6 (`:7527-7568`) in full: there is **no ruler branch in any of them**.

Selecting the `ruler` tool therefore does nothing at all — no click path (`:7285-7314`
has no `ruler` arm either), no drag path. The refs are reset at `:12354-12356`, which is
the only thing that touches them outside their own dead functions. This is a separate
defect from the P0, but it is the same failure mode the repo has been bitten by before:
**a comment describing wiring that does not exist.**

---

## 5. THE EXISTING SOURCE GUARDS — WHAT THEY WOULD AND WOULD NOT CATCH

All three files are **source-text scanners**. They `readFileSync` the engine, strip
comments, slice a window between two anchor strings, and regex the slice. None of them
mounts the component, and only two assertions in one file touch a real Cesium object.

### `tests/screenSpaceHandlerRegistration.test.ts` (433 lines, 17 `it` blocks)

**Would catch:**
- A second registration of any `event + modifier` pair on Handler A. `:102-127` counts the
  `}, C.ScreenSpaceEventType.X[, C.KeyboardEventModifier.Y])` closers inside
  `setupClickHandler` and requires ≥5 distinct slots with zero duplicates. **This is the
  guard that keeps the repair honest** — adding a fourth `LEFT_DOWN` registration would
  fail here.
- The block trio being turned back into registrations (`:128-140` requires
  `const blockResizeDown/Move/Up =` plus the three call sites).
- Reordering `blockResizeDown` after the `select` mode guard (`:141`).
- `arrayManipRef.current = false` being deleted from the **tool-change** reset block
  (`:289-290`) — a regex match on the source, inside a ~900-char window anchored at
  `'if (dragRef.current) dragRef.current = null;'`.

**Genuinely executes Cesium** at `:46` (proves `setInputAction` overwrites) and `:235`
(proves a click pixel tolerance exists). Note `:65` is a **no-op** — its body is literally
`expect(true).toBe(true)`.

**Would NOT catch:** anything about camera ownership during a drag. The single
`arrayManipRef` assertion checks only that the literal string survives in the *tool-change*
block — a backstop path, not the gesture path. It says nothing about `:7411`, `:7443`,
`:7453`, `:7557` or `:3820`.

### `tests/placementAuthorityWiring.test.ts` (205 lines, 8 blocks)

100% text scanning; uses its own local comment stripper (`:37-38`), not the shared one.
**Would catch:** a placement handler calling `scene.pickPosition` directly instead of
`resolvePlacementPoint` (`:83`, `:90`); a silent failure branch with no `setStatusMsg`
(`:96`); a second entity-creation path bypassing `commitPlacedObstruction` (`:171`, `:195`).

**Would NOT catch:** anything in this audit. No camera concept, no drag concept, no
`arrayManipRef`. Notably it also would **not** catch the mis-landing, because it only
asserts that `handleObstructionClick` *calls* `resolvePlacementPoint` — not that the
screen point it is handed still means what it meant at press time.

### `tests/dragToSizeSiteObject.test.ts` (176 lines, 12 blocks)

This is the guard written **for the very gesture that is broken**, and it passes.

**Would catch:** a fourth registration (`:59` requires exactly one each of `LEFT_DOWN`,
`LEFT_UP`, `MOUSE_MOVE` in the window; `:69` requires exactly one
`new C.ScreenSpaceEventHandler(`); the arm moving after the `select` guard (`:95`); the
arm stealing the press from the block drag (`:110`); the clamp being replaced by invented
limits (`:128`); the 6 px threshold disappearing (`:134`); the commit not going through
`handleObstructionClick` at the anchor (`:139`); the drag state not being cleared on
mouse-up (`:148`).

**Would NOT catch the P0.** There is no assertion mentioning `arrayManipRef`,
`screenSpaceCameraController`, or any camera concept. `:139` even asserts the *exact line*
that produces the mis-landing —
`handleObstructionClick(viewer, C, { x: sz.screenX, y: sz.screenY })` — as **correct**,
because in isolation it is: the bug is that the camera moved underneath that pixel.

One flaw worth fixing while nearby, `:149-154`: `i` is computed from an
`indexOf(..., indexOf('LEFT_UP') - 4000)` anchor, then discarded with `void i;`. The slice
actually asserted on comes from `H.lastIndexOf(...)` and runs to the end of the
`setupClickHandler` window, so it is **not anchored to the `LEFT_UP` registration at all**
— a clear living in a later handler would satisfy it.

### Direct answers to the two questions asked

> **Would ANY existing test catch a camera controller that is never disabled during a placement drag?**

**No.** A grep across all of `tests/` and `e2e/` for
`screenSpaceCameraController|enableRotate|enableTranslate|enableTilt|enableZoom|enableLook|enableInputs`
returns **zero hits**. `arrayManipRef` appears three times, all in
`screenSpaceHandlerRegistration.test.ts` (`:19` and `:275` are comments; `:290` is the one
assertion, and it covers the tool-change backstop only). The seventeen production lines
that constitute the camera-ownership surface — `:2157`, `:3626-3632`, `:3820`, `:7173`,
`:7274`, `:7443`, `:7453`, `:7557`, `:2442`, `:12352` — are **entirely uncovered**.

`e2e/drag-to-size-tree.spec.ts` drives the real gesture with a real mouse and still misses
it: it asserts `type`, `widthM`, `depthM`, `canopyRadiusM` and object **count**, and
**never asserts a position**. Grepping that file for `lat|lng|position` returns nothing.
Its size assertion is a one-sided `toBeGreaterThan(6.5)` against a preset default of 6,
which the partially-cancelled radius (§0.3) still clears. So the only test that exercises
the live path is blind on both axes of the defect.

> **Would any catch a controller disabled and never restored?**

**No.** No test in the repository pairs a disable with its matching re-enable. The four
"clear" assertions that exist (`screenSpaceHandlerRegistration.test.ts:288`, `:290`,
`:291`; `dragToSizeSiteObject.test.ts:148-155`) are all regex matches confirming a literal
appears in one source window. None of them would notice a `return` added **above** the
reset — which is precisely risk R1, the most likely way to break this while fixing it.

---

## 6. THE MODEL TO COPY

**Yes — a correct pattern already exists in this file, and the repair should match it
rather than invent anything.**

The model is the **block height drag**: `blockResizeDown` / `blockResizeMove` /
`blockResizeUp` at `SolarEngine3D.tsx:7121`, `:7181`, `:7224`. It is the best of the three
working gestures because it is the only one whose release is in a `finally`.

Its five properties, in order of importance:

1. **Take the token on arm, in the same statement group that sets the drag state** —
   `:7168-7173`: `blockResizeRef.current = {…}; suppressClickRef.current = true;
   arrayManipRef.current = true;`
2. **Release it in a `finally`, not on the happy path** — `:7272-7275`. This is what the
   array drag does *not* do (`:7557` sits on the happy path after two `return`s), and it is
   the difference between a correct gesture and a nearly-correct one.
3. **Live as plain functions called from inside the existing A4/A5/A6 registrations**, never
   as new `setInputAction` calls — `:7398`, `:7458`, `:7528`. Enforced by
   `dragToSizeSiteObject.test.ts:59` and `screenSpaceHandlerRegistration.test.ts:102`.
4. **Branch first and `return`**, so exactly one gesture owns the pointer — `:7399`,
   `:7458`, `:7528`.
5. **Be listed in the tool-change reset** so an abandoned drag cannot survive —
   `blockResizeRef` at `:2440`, `arrayManipRef` at `:2442`.

Applying that model to the size drag means three things, not one:
- `arrayManipRef.current = true` beside `objectSizeDragRef.current = {…}` at `:7411`;
- the release inside the `sz` branch of `LEFT_UP` at `:7544-7552`, which **returns at
  `:7551` before ever reaching `:7557`** (risk R1 — this is the step that would otherwise
  freeze the map permanently), ideally in a `try/finally`;
- `objectSizeDragRef.current = null` added to the tool-change reset at `:2433-2442` and the
  full reset at `:12350-12352`, where it is currently missing (risk R4).

**Do not touch `scene.screenSpaceCameraController`.** It is off by design (§0) and
toggling it changes nothing.

---

## APPENDIX — files read

- `components/3d/SolarEngine3D.tsx` — `:426`, `:2142-2157`, `:2287-2293`, `:2334-2337`, `:2425-2447`, `:3550`, `:3587-3928`, `:4120-4140`, `:4275-4330`, `:7090-7644`, `:11130-11250`, `:12330-12365`, `:14892`, `:15204`
- `components/3d/editing/VertexHandles.tsx` — `:150-300`
- `components/3d/tree/TreeCursor.tsx` — `:165-250`
- `components/3d/segments/SegmentArrowOverlay.ts` — `:100-160`
- `components/3d/editing/index.ts`, `lib/3d/controlLayer.ts:75-120`
- `tests/screenSpaceHandlerRegistration.test.ts`, `tests/placementAuthorityWiring.test.ts`, `tests/dragToSizeSiteObject.test.ts`, `tests/mountFrozenClosure.test.ts`
- `e2e/drag-to-size-tree.spec.ts`
- `node_modules/cesium/Build/Cesium/Cesium.js` — listener-registration function `ZCt` (installed Cesium, verified not recalled)

No source file was modified. No tests were run. No git operations were performed.
