# MOVE VERTEX — ARCHITECTURE

**Date:** 2026-09-25 · **Scope:** READ-ONLY design. No product source changed.
**Predecessor:** `docs/research/VERTEX-EDITING-FEASIBILITY.md` — read it first. This document
does **not** build on `components/3d/editing/VertexHandles.tsx`. See §10 for what of it, if
anything, survives.

---

## 0. VERDICT UP FRONT

**Move-vertex is WELL-POSED — but only for a face that is not owned by a building section,
and only if the move is constrained to the face's own plane.** Both qualifiers are load-bearing
and both are derived below from code, not from taste.

The three things people will guess wrong:

1. **`resolvePlacementPoint(viewer, C, screenPos, 'roof')` is the wrong tool for the DRAG.**
   Its roof branch is **ring-bounded** — it returns `null` the instant the cursor leaves the
   face's current outline, which is half of what a vertex drag is. It is right for its own
   question and must not be stretched to this one. §2.
2. **The grab must not be a `scene.pick` of a rendered handle.** `drillPick`/`scene.pick`
   return **zero hits under software WebGL** — the configuration the acceptance suite runs in —
   and the repo has already paid for that lesson twice. §2.
3. **`repositionPanelsForPlanes` must NOT be called on a vertex move.** It is a *rigid* map
   anchored on the face's ring centroid; a vertex drag moves the centroid, so it would
   translate the entire array sideways. §6.

The smallest correct first increment is in §8. It is roughly 200 lines inside
`components/3d/SolarEngine3D.tsx` plus three small exports, and it ships a gesture that is
undoable, persisted, and honest about panels.

---

## 1. WHERE A ROOF VERTEX LIVES CANONICALLY

### 1.1 The record

`RoofPlane` is declared once, at `types/index.ts:445-571`. Two fields carry corners:

| field | line | what it is |
|---|---|---|
| `vertices: {lat,lng}[]` | `types/index.ts:447` | the **plan-view** ring. No height. What `lib/cad/buildCADFromSurvey.ts` and `lib/cad/roof/roofCAD.ts` draw as plan polygons and setback bands. |
| `polygon3D: {x,y,z}[]` | `types/index.ts:522` | the **ECEF** ring, mathematically planar, lifted `SURFACE_OFFSET_M` (0.12 m) along the normal. What the renderer and panel placement use. |

They are **two projections of one ring**, and the relationship is written down and defended:
`lib/roofPlane3D.ts:833-868` — `vertices` is taken from `polygon3D` **un-lifted** along the
normal, because taking it from the lifted points slid each face down-slope by
`offset·sin(tilt)` and **split a gable ridge by twice that** (10.8 cm at 6:12) on the permit
site plan.

So: **the ECEF ring is the master and the lat/lng ring is derived from it.** A vertex edit
writes `polygon3D` and lets `vertices` fall out of the un-lift. Writing `vertices` directly and
back-projecting is how the ridge split happens again.

`vertices` is in `SIGNED_FIELDS` (`lib/roofPlanesSignature.ts:49`), so a vertex move **does**
trigger the autosave. `polygon3D`, `origin3D`, `ecefFrame3D` are **not** signed — they ride
along in the payload, which is fine here because `vertices` always moves with them on this
gesture. (It is *not* fine for a pure-height edit; that gap is real and pre-existing —
`docs/SOLARPRO-3D-INTERACTION-MODEL.md:535-560` documents it. A vertex move does not make it
worse and does not fix it.)

### 1.2 Is the vertex first-class? It depends on the face — and this is the whole design

**Standalone face — YES, first-class.** A face with neither `sectionId` nor `section`
(`types/index.ts:525-538`) has no parameters behind it. Its ring *is* the model. Mark Plane,
the 3D trace tool, the flat-trace rebuild and Google Solar detection all produce these. **Move
vertex is trivially well-posed here: the ring is the canonical record and there is nothing
else for it to disagree with.**

**Section-owned face — NO, derived.** `types/index.ts:530-532` states it: *"Present means the
face is DERIVED from `section` and is rebuilt from it."* The chain is
`RoofSectionRecord.footprint` + `eaveHeightM` + `pitchDeg`/`facePitchDeg` →
`layoutSectionFaces` (`lib/3d/buildingSection.ts:531`) → `buildSectionRoofPlanes`
(`lib/3d/buildingSection.ts:788`) → the `RoofPlane[]`. A face corner is not independently
addressable:

- an **eave** corner of `slopeA` is a *footprint* corner, shared with `slopeB`. Moving it is a
  footprint edit that moves two faces;
- a **ridge** corner is solved, not stored:
  `rise = span·tanA·tanB/(tanA+tanB)` (`types/index.ts:416-424`). There is no ridge vertex to
  move — there is a span and two pitches that imply one.

So on a section face, "move this corner" has **no expression in the canonical model**. The repo
already has the ruling for what happens when a gesture produces corners that are not
expressible as a `(footprint, pitch)` pair: `RoofPlane.sectionFaceReshaped`
(`types/index.ts:540-560`). The face declares it is no longer parametric, and
`applySectionEdit` then **refuses** to rebuild its section
(`SECTION_FACES_RESHAPED`, `lib/3d/buildingSection.ts:171-172`) rather than silently choosing
one of the two geometries — the exact silent-revert defect that comment records.

**Ruling for this design:** a vertex drag on a section face is a *defection from the parametric
model*. That is a decision the installer must be shown and must choose, not one a drag makes
by accident. **Increment 1 therefore refuses section-owned faces and says why.** This is not a
limitation to apologise for — it is the thing SolarPro wins on. "Rebuild one section, keep the
rest" only stays true if the section noun keeps meaning something.

Faces already carrying `sectionFaceReshaped: true` have *already* defected and
`applySectionEdit` already refuses them. They are the obvious increment 2 and require no new
ruling.

### 1.3 What "the real edit" is, stated precisely

> Replace corner `i` of a standalone face's **ECEF** ring with a new point **lying in that
> face's own plane**, then rebuild the face from the new ring through the one plane-building
> authority, and emit the complete result on the one reshape channel.

---

## 2. SCREEN ↔ WORLD — THE ONE CORRECT PATH

Two different questions, two different answers. Conflating them is how this goes wrong.

### 2.1 The PRESS — "which vertex did the user grab?"

**Not `scene.pick` / `drillPick`.** `SolarEngine3D.tsx:12447-12456` records the measurement:

> *"`drillPick` is a GPU read, and measured on chromium-software-webgl — the configuration the
> acceptance suite runs in … it returns ZERO hits for a tree standing in plain view."*

and `:2853-2857` says the same about face selection. A handle picked by rasterisation is
unreachable from any browser spec and unreachable on any machine without a usable GPU.
`docs/SOLARPRO-3D-INTERACTION-MODEL.md:377-378` independently flags that `VertexHandles` uses
`scene.pick`, so its handles are also occluded by the Building extrusion — invisible in the one
mode you would use them in.

**The correct grab is geometric, and the authority already exists:**

```
lib/3d/placementIntersection.ts:411  intersectRayWithSphere(rayOrigin, rayDirection, centre, radius)
```

Its own header (`:385-408`) is this exact argument, written for obstruction selection. One
bounding sphere per candidate vertex, centred on that vertex's ECEF position; nearest hit along
`viewer.camera.getPickRay(event.position)` wins. **Note carefully:** this is a *handle-sized*
sphere at a *known ECEF centre*. It has nothing to do with `pickRayToLatLng`'s
sphere-of-the-equatorial-radius (`lib/3d/vertexHandlesMath.ts:370`), which approximates *the
Earth* and is 146 m–4.8 km wrong. Do not let the word "sphere" blur the two.

Sphere radius should equal the drawn handle: `radius = (pixelSize/2) · metresPerPixel(distance)`,
so the grab target is exactly as big as the dot the user is aiming at, at every zoom. A fixed
metric radius is acceptable as a first cut and will feel wrong when zoomed out.

### 2.2 The DRAG — "where on the roof is the cursor now?"

**`resolvePlacementPoint(viewer, C, screenPos, 'roof')` (`SolarEngine3D.tsx:8017`) is the wrong
tool here, and the reason is specific.** Its roof branch calls `nearestFaceAlongRay`
(`:8150`) → `intersectRayWithFace` (`lib/3d/placementIntersection.ts:205`) which ends in:

```ts
const ring = ringInFaceFrame(face);
if (!pointInRing2D(pu, pv, ring, opts.padM ?? 0)) return null;   // :231-232
```

It is **bounded by the face's current outline** (plus a deliberate 0.25 m pad). Dragging a
corner outward — which is half of every vertex edit anyone will ever perform — leaves the ring
and gets `null`. That is not a bug in `resolvePlacementPoint`; the bound is what makes it
correct for "which face did the user point at". It is simply answering a different question.

**The correct drag target is the intersection of the pick ray with the face's INFINITE plane,
and the engine already does exactly this for the panel-array grab:**

```
SolarEngine3D.tsx:7591   const plane = C.Plane.fromPointNormal(cen, N);
SolarEngine3D.tsx:7595   const hit = ray ? C.IntersectionTests.rayPlane(ray, plane) : null;
SolarEngine3D.tsx:7650   const hit = C.IntersectionTests.rayPlane(ray, drag.plane);
```

`C.Plane.fromPointNormal` + `C.IntersectionTests.rayPlane` is **exact ECEF plane arithmetic**.
There is no ellipsoid involved, no `metersPerDeg`, no latitude dependence, nothing to be wrong
about off-nadir. It is the established, in-product, proven precedent for "drag a thing across a
roof face" and it is the right answer here.

Build the plane from the face's own record:
`C.Plane.fromPointNormal(new C.Cartesian3(origin3D.x, …), new C.Cartesian3(ecefFrame3D.n.x, …))`.

### 2.3 The rule, stated plainly

> **No ECEF sphere approximation, no `metresPerDegree` scaling, and no dependence on anything
> having been rasterised is acceptable anywhere on this path.**
>
> `pickRayToLatLng` (`lib/3d/vertexHandlesMath.ts:370`) violates the first. `scene.pick` /
> `drillPick` violate the third. Both are excluded. Everything in §2.1–2.2 is exact ECEF
> geometry against records the design already holds, which is the standard
> `resolvePlacementPoint` established (`SolarEngine3D.tsx:8005-8010`) and the standard this
> gesture inherits even though it does not call that function.

---

## 3. LOCAL COORDINATE AUTHORITY

**The authority is `RoofPlane.ecefFrame3D` (`types/index.ts:566-570`) together with
`RoofPlane.origin3D` (`types/index.ts:520`). `localFrame3D` is its ENU mirror, and it is not
the authority.**

Proof, not assertion: `lib/surfaceGeometry3D.ts:540` — `const hasOwnFrame = Boolean(plane.origin3D && plane.ecefFrame3D);`
and `:545-556` feed `origin3D` + `ecefFrame3D` straight into the grid build; `:469-474` places
the deck from `geom.ecefFrame3D.n` and `geom.origin3D`. `localFrame3D` appears nowhere in that
path. The cost of getting this backwards is already written into the codebase at
`SolarEngine3D.tsx:520-536`: emitting a new `origin3D`/`normal3D` while keeping the old
`ecefFrame3D` placed panels **with a new origin on a stale triad** — a wedge that goes below
the deck once the plane rotates by ~0.48°, and that foreshortens the usable extent by `cos²(Δ)`,
removing whole rows and therefore moving panel count, kW and the BOM.

### 3.1 The move is expressed as `(Δu, Δv, 0)` in that frame — and the zero is the design

Take the grabbed corner `P₀` and the ray-plane hit `P₁`. Express the delta in the face's own
ECEF basis:

```
d   = P₁ − P₀
Δu  = d · ecefFrame3D.u
Δv  = d · ecefFrame3D.v
Δn  = d · ecefFrame3D.n        ← identically 0, by construction, because P₁ was
                                 produced by intersecting the ray with THIS plane
P₁' = P₀ + u·Δu + v·Δv
```

**Constraining `Δn = 0` — i.e. keeping the drag in the face's own plane — is the single most
important decision in this design.** Four independent consequences:

1. **Pitch and azimuth cannot move.** All corners stay coplanar, so `computePlaneFromPoints3D`
   (`lib/roofPlane3D.ts:346`) recovers the identical normal via Newell, and `frame.tiltDeg` /
   `frame.azimuthDeg` are unchanged. An outline edit must not silently re-quote the permit's
   pitch. Pitch has one owner and it is not this gesture.
2. **A free (out-of-plane) drag would produce a non-planar ring, and Newell's method
   (`lib/roofPlane3D.ts:367-386`) would absorb the excursion by tilting the WHOLE face by a
   fraction of it.** A diffuse error with no single culprit, on a field
   (`plane.pitch`) that reaches the planset and the structural engine.
3. **`deriveAzimuthsFromSharedEdges` exists** (used at `SolarEngine3D.tsx:5813`) *because*
   per-face azimuth derivation returns SOUTH for both halves of a gable. Letting a vertex drag
   re-fit a normal invites exactly that class of answer.
4. **Every surviving panel stays exactly on the deck.** This is what makes the panel policy in
   §6 cheap and honest: no repositioning is required, only an in/out test.

The frame's own `u` axis is `cross(normal, radialUp)` — the eave (`lib/roofPlane3D.ts:431-434`)
— so `Δu` is "along the eave" and `Δv` is "up/down slope". That is exactly the vocabulary the
dimension readout should speak.

---

## 4. POINTER OWNERSHIP

### 4.1 The owner name

**`'vertex-move'`.** Added to the union at `components/3d/SolarEngine3D.tsx:2186-2188`:

```ts
const pointerOwnerRef = useRef<
  'array-move' | 'array-rotate' | 'block-height' | 'object-size' | 'vertex-move' | null
>(null);
```

### 4.2 Where it claims

Inside the **LEFT_DOWN** path, **only after a handle sphere has actually been hit and the face
and vertex index have resolved.** This mirrors the shape
`tests/pointerGestureAuthority.test.ts` already enforces for `object-size`:

> *"the claim escaped the `if (at)` guard — an unresolved press would freeze the map"*

A press that resolves no vertex starts no drag, so it must not freeze the camera: there would
be no gesture for LEFT_UP to end and the user's only recovery is a reload
(`SolarEngine3D.tsx:7570-7576`).

Concretely: a `vertexDragDown(event)` plain function called from the **existing** LEFT_DOWN
registration at `SolarEngine3D.tsx:7512-7599`, placed immediately after `blockResizeDown(event)`
and guarded the same way (`if (vertexDragRef.current) return;`).

### 4.3 Where it releases

Nowhere new. The existing **LEFT_UP** registration (`SolarEngine3D.tsx:7671-7733`) already
wraps its whole body in `try { … } finally { releasePointer(); }` and
`tests/pointerGestureAuthority.test.ts` fails the build if that shape is lost. The vertex
commit goes **inside that `try`**, as the first branch, alongside
`if (blockResizeRef.current) { blockResizeUp(); return; }`.

It must **also** be cleared at the three existing abandon sites, each of which already has a
named guard in that test file:

| site | line | what to add |
|---|---|---|
| tool change | `SolarEngine3D.tsx:2515-2530` | `if (vertexDragRef.current) cancelVertexDrag();` before `releasePointer()` |
| Escape | `SolarEngine3D.tsx:11137-11141` | `cancelVertexDrag();` beside `cancelObjectSizeDrag()`, **before** the early returns |
| full reset | `SolarEngine3D.tsx:12566-12572` | `cancelVertexDrag();` beside `cancelObjectSizeDrag()` |

`cancelVertexDrag()` must restore the pre-drag render (§5.4) as well as null the ref —
`VertexHandles` stored `originalLat`/`originalLng` and never read them
(`docs/SOLARPRO-3D-INTERACTION-MODEL.md:386-388`); reading them is what gives Escape-cancel for
free.

**None of the above may be a new assertion-free addition.** The existing guards name gestures
by string, so a vertex gesture that skipped these sites would **not** fail the build. Three new
cases must be added to `tests/pointerGestureAuthority.test.ts` — see §9.

### 4.4 Why the gesture must live in the engine's own handlers, not in a child component

Three reasons, in increasing order of how expensive it is to learn them the other way:

1. **Reachability.** `claimPointer` / `releasePointer` are closures inside `SolarEngine3D`
   (`:2190`, `:2199`) and `arrayManipRef` (`:2157`) is local to it. A child can only get them
   as props, which works and is the weaker option.
2. **The guard is scoped by LOCATION, on purpose.**
   `tests/pointerGestureAuthority.test.ts` asserts `arrayManipRef.current = true` appears
   **exactly once in `SolarEngine3D.tsx`**, and separately walks every other file under
   `components/3d/` and fails if one that registers `ScreenSpaceEventType.LEFT_DOWN` is
   *mounted*. Its own comment states the rule: *"a pointer drag belongs in the engine's own
   handlers, where `claimPointer` is reachable and where the counts above can see it."* A drag
   written in a sibling is invisible to the first assertion and only caught by the second —
   which is a tripwire, not a home.
3. **`setInputAction` is an overwrite, not an append.** A second
   `ScreenSpaceEventHandler` on the same canvas does not replace the engine's registrations
   (proven against the installed Cesium in `tests/screenSpaceHandlerRegistration.test.ts:46`) —
   **both fire**. A vertex press would also run the select / panel-array / block-height
   LEFT_DOWN logic in the same event. `SolarEngine3D.tsx:7248-7256` records the inverse of this
   lesson: registering the same trio twice on *one* handler silently killed the block-height
   drag, and the fix was to make the three a plain-function trio called from the surviving
   registrations. **That is the exact shape the vertex gesture must adopt.**

So: **`vertexDragDown` / `vertexDragMove` / `vertexDragUp` are three plain functions declared
inside `setupClickHandler` (`SolarEngine3D.tsx:7233`), called from the existing LEFT_DOWN
(`:7512`), MOUSE_MOVE (`:7601`) and LEFT_UP (`:7671`) registrations.** No new handler, no new
mounted component that takes a press, no new hole in the guard.

### 4.5 Arm threshold

Copy the array grab's 6 px gate (`SolarEngine3D.tsx:7636-7648`) verbatim in spirit: the drag
does not move anything until the cursor has travelled 6 px, and it **re-baselines** at that
moment so there is no jump. Without it, a *click* on a corner dot moves that corner —
`docs/SOLARPRO-3D-INTERACTION-MODEL.md:374-376` names this as one of the four things wrong with
`VertexHandles`.

### 4.6 Mode gate

A new `PlacementMode` member — `'vertex'` — added to the union at `SolarEngine3D.tsx:426`.
Not `'select'`: that mode already owns click-to-select, the panel-array grab, the rotate knob
and the block handle on the same LEFT_DOWN, and adding a fifth consumer to one press is how
gestures start stealing each other's clicks.

---

## 5. WHAT RE-DERIVES ON A VERTEX MOVE — AND WHAT SILENTLY WILL NOT

### 5.1 The channel

**`RoofPlaneReshapeUpdate` → `onRoofPlanesStitched` is the correct channel, and it is correct
for a reason stronger than convenience.** The shape (`SolarEngine3D.tsx:494-542`) is declared
**once**, and every field on it was added after a specific production defect:

| field | why it is there |
|---|---|
| `vertices` | the plan ring — and the only **signed** geometry field, so it is what schedules the save |
| `polygon3D`, `origin3D`, `normal3D` | so reload rebuilds the reshaped outline, not the pre-reshape one |
| `pitch`, `azimuth` | added after the roof changed under a stale `plane.pitch` and **the permit quoted the wrong pitch permanently** (`:510-517`) |
| `localFrame3D` | the ENU mirror |
| `ecefFrame3D` | added after panels were placed with a new origin on an **old triad** — the `cos²(Δ)` wedge that reaches panel count, kW and BOM (`:520-536`) |

The consumer (`components/design/DesignStudio.tsx:5494-5570`) already does four things a vertex
move needs and would otherwise have to re-invent:

- `site.recordGeometry('Reshape roof')` **before** adopting — §7;
- `enrichRoofPlaneWithLECS(...)` — recomputes `centroidLat/Lng`, `verticesLocal`,
  `roofEdgeAngleDeg` (`lib/roofGeometry.ts:822-838`);
- carries `pitch`/`azimuth`/`ecefFrame3D` onto the plane (`:5527-5538`);
- sets `sectionFaceReshaped` **only if the ring actually moved**, via `reshapeMovedIt`
  (`DesignStudio.tsx:573-586`). Increment 1 refuses section faces, so this is a no-op today —
  and it is exactly the machinery increment 2 needs, already built and already guarded.

`tests/reshapeKeepsPitch.test.ts:104` pins the emitter count at **four**
(`expect(ENGINE.match(/RoofPlaneReshapeUpdate\[\] = \[\];/g)).toHaveLength(4)`). A vertex commit
makes it **five**. That number must be changed deliberately, in the same commit, with the new
emitter named — that is what the assertion is for.

### 5.2 🚨 WHAT THE CHANNEL DOES NOT COVER — `area` AND `usableArea`

**`RoofPlaneReshapeUpdate` carries no `area` and no `usableArea`, `DesignStudio`'s handler does
not recompute them, and `enrichRoofPlaneWithLECS` does not either** (`lib/roofGeometry.ts:830-837`
returns centroid, `verticesLocal`, `centroidLocal`, `roofEdgeAngleDeg` — and nothing else).

So after **any** reshape — Square Up and Stitch included, today, right now —
`plane.area` and `plane.usableArea` keep their pre-reshape values. For a vertex move, whose
entire purpose is to change the outline, that is not a rounding error: shrink a face by a third
and its stored area does not move at all.

Consumers I confirmed:

- `lib/siteSurvey/enrichSurvey.ts:246` — `planes.reduce((best,p) => p.area > best.area ? p : best)`
  picks the **primary plane** by area;
- `lib/siteSurvey/enrichSurvey.ts:347` — area-based usable-area estimate when no polygon is
  available;
- `lib/3d/footprintToRoofPlane.ts:216, 328, 406` — `slopeAreaM2: plane.area`.

`lib/cad/canonicalBridge.ts:400-411` **rescales the projected polygon to match `areaSqM`** — I
traced that to `plane.areaSqM` on the *canonical* plane type, not directly to
`RoofPlane.area`, so I am **not** claiming that specific chain is affected. I could not close
that trace within this pass and am flagging it rather than asserting it.

**Recommendation:** add `area` (and `usableArea`) to `RoofPlaneReshapeUpdate` and emit
`built.plane.area` from every emitter. `buildRoofPlane3D` already computes it correctly
(`lib/roofPlane3D.ts:875-876`, shoelace in the plane's own UV basis). This is a two-line fix to
a pre-existing defect and a vertex move should not ship without it.

### 5.3 What else silently will not re-derive

| # | thing | status |
|---|---|---|
| 1 | **Panel layout** | `setRoofPlanes` replaces the geometry; panels are not re-laid or culled on this channel. **§6 is the answer.** |
| 2 | **Shade** | `runShadeAnalysis` is driven by a button (`SolarEngine3D.tsx:695`, `onRunShadeAnalysis`), never by a geometry change. A moved vertex keeps the old `annualShadeFactor` on every panel indefinitely, and `lib/pvwatts.ts` turns that into a production derate. **Not fixable on this gesture** — stale shade after *any* geometry edit is a standing product issue. The honest minimum is to say so in the status line when the face carries panels with shade factors. |
| 3 | **The section record** | Not reachable in increment 1 — section faces are refused (§1.2). Increment 2 must set `sectionFaceReshaped`, which `DesignStudio.tsx:5566` already does. |
| 4 | **The permit snapshot digest** | A vertex move that genuinely changes the outline **should** move the digest and retire live PE approvals. That is correct. The two failure modes either side of it are the danger: moving the digest for a renderer-only edit that never reached the data model, or failing to move it for a real one. Because `vertices` is signed and the commit is canonical, this design lands on the correct side of both. |
| 5 | **`planeHeightAtCenterMeters`** | `buildRoofPlane3D` writes `0.0` as a deliberate "use origin3D instead" sentinel (`lib/roofPlane3D.ts:898`, and `lib/surfaceGeometry3D.ts:529-534` documents the `??` trap it caused). The commit must **not** overwrite an existing plane's value with the rebuilt `0.0` unless it was already 0. |
| 6 | **`id`** | `buildRoofPlane3D` mints a fresh `uuidv4()` (`lib/roofPlane3D.ts:881`). **The commit MUST override it with the face's existing id.** A new id orphans every panel (`PlacedPanel.planeId`, `types/index.ts:337`), breaks `sectionFaceId` determinism and makes the deletion ledger blind. This is the single easiest way to destroy a design with this feature. |

---

## 6. PANEL POLICY — **CULL**, and here is why it is the only honest one

**Recommendation: CULL. Snapshot first, remove panels whose centre is no longer on the face,
report the count, never silently re-lay and never silently leave them hanging.**

### Why not re-lay

`docs/research/` and the memory record both carry Ray's position: rearranging or deleting
design panels to tidy a drawing is forbidden, and a full re-layout destroys every manual
adjustment. A vertex nudge of 20 cm must not re-shuffle an array the installer spent ten
minutes positioning. Re-lay is a *bigger* edit than the one the user performed, which is the
definition of a surprising tool.

### Why not "reposition"

**`repositionPanelsForPlanes` (`lib/3d/sectionEditing.ts:1561`) must not be called here.** It
maps each panel through `(u,v)` in the old frame to `(u,v)` in the new one, anchored on
`ringCentroid` (`:1541`) — deliberately, because `origin3D` moves when the fit changes. That is
exactly right for a **rigid** motion (a section translating or changing height) and exactly
wrong for a **non-rigid** one: dragging one corner *moves the ring centroid*, so every panel on
the face would translate by the centroid delta. Nobody asked for the array to slide.

### Why not refuse

Refusing an edit because the face carries panels makes the feature useless on precisely the
faces that matter — automation gets the roof 90% right and then you lay panels; the 10% fix
comes after, not before.

### Why cull works, and why it is cheap here

Because §3 constrains the drag to the face's own plane, **the plane does not move**. Every panel
that is still inside the new ring is still exactly on the deck, at exactly its old
`lat`/`lng`/`height`, with the correct mount stack. There is nothing to reposition. The whole
policy reduces to one ring test per panel, and the exported authority for that already exists:

```
lib/3d/placementIntersection.ts:185  ringInFaceFrame(face)
lib/3d/placementIntersection.ts:140  pointInRing2D(u, v, ring, padM)
```

These are the same two functions `resolvePlacementPoint` uses to decide whether a click landed
on a face, so "is this panel on this face" and "did the user click this face" get **one**
answer. (`pointOnFace` at `lib/3d/sectionEditing.ts:1481` is the same test with a 0.35 m
tolerance, but it is **private** — not exported. Use the `placementIntersection` pair, with a
pad of about 0.35 m so a panel half over the eave counts as on the roof, which is the tolerance
`sectionEditing` chose and defended.)

### The mechanics

1. **Snapshot first.** Call `onPanelsAboutToBeCulled?.('Move roof corner')`
   (`SolarEngine3D.tsx:706`, wired to `site.recordPanelCull` at `DesignStudio.tsx:5486`) **before**
   removing anything. Its own comment records why: marking a vent culled modules with no history
   step, and deleting the vent did not bring them back (`:697-705`). A cull with no undo is the
   defect, not the cull.
2. Compute the survivors against the **new** ring, remove the rest, `onPanelsChange(survivors)`.
3. **Say it.** Status line: *"Corner moved · 3 modules removed (Undo to restore)"*. Silence is
   the failure mode the requirement names.
4. If the cull would remove **every** panel on the face, still do it — but say *"all 14 modules
   removed"*, which is loud enough that a mis-drag is obvious.

---

## 7. UNDO — EXACTLY ONE ENTRY PER DRAG

### The facts

- `recordGeometry` is at `components/design/useSiteDesign.ts:341` (**not** `lib/design/`; that
  path does not exist). It snapshots `roofPlanesRef.current` *plus* the native-disposition
  decision *plus* the deletion ledger, on every step.
- It is called from exactly three places, all in `components/design/DesignStudio.tsx`:
  `:5382` (`'Add roof face'`), `:5469` (`onRoofGeometryReplaced`, with `meta.coalesceKey`),
  `:5499` (`'Reshape roof'`, the `onRoofPlanesStitched` handler).
- `SolarEngine3D` has **no write handle on the undo stack at all** — it receives only
  `onUndoGeometry` / `onRedoGeometry` / `canUndoGeometry` / `undoGeometryLabel` for its toolbar
  (`:726-728`).
- Therefore **the only undoable geometry channel out of the engine is
  `onRoofPlanesStitched`**, and its handler already calls `recordGeometry` *before* adopting
  (`DesignStudio.tsx:5499` then `:5510`) — the snapshot-first-then-adopt ordering the file
  states explicitly at `:5466-5469`.

### The design

**One `RoofPlaneReshapeUpdate[]` of length 1, emitted once, from `vertexDragUp` only.**

- **Nothing canonical is written during MOUSE_MOVE.** Per-frame emission would call
  `recordGeometry` at 60 Hz and put hundreds of entries on the stack for one drag, each of
  which deep-copies the whole `RoofPlane[]`.
- The drag preview is **renderer-only**: update the Cesium entity for the face and the handle
  positions, and nothing else. `docs/SOLARPRO-3D-INTERACTION-MODEL.md:379-383` states the
  split — renderer-only during the drag is *correct*; renderer-only at drop is not. **Write the
  split into the code**, or the next reader copies the header comment and ships a renderer-only
  edit.
- On LEFT_UP: if the drag never armed (under 6 px) → restore and emit nothing. If the final
  ring is identical to the start ring within `RESHAPE_MOVED_EPS_DEG` → emit nothing. **A no-op
  drag must not put an entry on the undo stack**, for the same reason Square Up marking
  unmoved faces as reshaped was a defect (`DesignStudio.tsx:5542-5552`).
- **No `coalesceKey`.** Coalescing exists for a stepper the user holds down (`:5469`). Two
  separate corner drags are two separate edits and must undo separately.
- The panel cull records its own step via `onPanelsAboutToBeCulled` **before** the geometry
  record, so Undo walks back: panels restored, then geometry restored.

**One caveat to state honestly:** `applyRestoredGeometry` (`useSiteDesign.ts:378-400`) calls
`repositionPanelsForPlanes` on undo. For a vertex move that is the same rigid-map problem as
§6 — it would translate surviving panels by the centroid delta when the ring comes back. The
cull path snapshots panels separately (`recordPanelCull`), so whether the undo of a vertex move
is *exactly* clean depends on which of those two paths wins. **I could not fully close that
interaction in this pass. It must be exercised on a real roof before the gesture ships**, and
it is the single most likely place for this feature to be subtly wrong.

---

## 8. THE SMALLEST CORRECT FIRST INCREMENT

> **Move ONE existing corner of ONE already-selected, STANDALONE roof plane, in that plane,
> committed once on release.**

**In scope:** handle rendering for the selected face only · geometric grab · in-plane drag ·
6 px arm · live dimension readout · Escape cancel · one canonical commit · panel cull with a
snapshot · one undo entry.

**Out of scope, explicitly:** add vertex · delete vertex · edge drag · edge-midpoint handle ·
split · merge · rotate · Block / Gable / Hip / Tree primitives · section-owned faces ·
shared-corner propagation between faces · multi-select · out-of-plane movement.

**Shared-corner propagation is deliberately out.** `docs/SOLARPRO-3D-INTERACTION-MODEL.md:245-248`
argues corners within Stitch's 1.6 m tolerance should move together, and it is right that
*silent non-propagation is a hole in the roof*. But propagation multiplies the commit from one
face to N, needs an Alt-to-detach affordance and a live announcement, and doubles the surface
of the first increment. **Increment 1 moves one corner of one face and the status line says so**
— *"1 corner · this face only"* — so the non-propagation is visible rather than silent. That is
the honest small version.

### Step by step

**Step 1 — `'vertex'` mode.** `SolarEngine3D.tsx:426` — add to the `PlacementMode` union. Add
the toolbar button and the single-key shortcut through the existing one-map mechanism
(`:427-445`). Nothing else.

**Step 2 — handle rendering, engine-side, no new mounted component.** When
`modeRef.current === 'vertex'` and `selectedFaceIdRef.current` (`:1291`) names a face, draw one
Cesium Point per corner of that face's `plane3DCesiumPtsMap.current.get(id)` ring. Follow the
`SegmentArrowOverlay` precedent (`lib/3d/segmentArrows.ts`, held in `segmentArrowOverlayRef` and
cleared on tool change at `:11129`) — a factory in `lib/3d/`, created once at viewer init,
**not** a React component. Cleanup is `viewer.entities.remove(e)` on each entity, not
`e.viewer?.entities?.remove(e)` — that optional chain short-circuits and leaks every handle
(`VertexHandles.tsx:291`, defect D4 in the feasibility audit).

**Step 3 — `vertexDragDown(event)`** inside `setupClickHandler` (`:7233`), called from the
existing LEFT_DOWN (`:7512`) right after `blockResizeDown(event)`:

```
if (vertexDragRef.current) return;
if (modeRef.current !== 'vertex') return;
const faceId = selectedFaceIdRef.current;                  if (!faceId) return;
const plane  = roofPlanesRef.current.find(p => p.id === faceId);
if (!plane || plane.sectionId || plane.section) {          // §1.2 — refuse, and say why
  setStatusMsg('This face belongs to a building section — edit the section, or detach it first');
  return;
}
if (!plane.origin3D || !plane.ecefFrame3D || (plane.polygon3D?.length ?? 0) < 3) return;
const ray = viewer.camera.getPickRay(event.position);      if (!ray) return;
// nearest handle sphere along the ray — lib/3d/placementIntersection.ts:411
const grabbed = nearestVertexAlongRay(ray, plane.polygon3D, handleRadiusM);
if (!grabbed) return;                                      // ← claim NOTHING on a miss
vertexDragRef.current = {
  faceId, index: grabbed.index,
  ring0: plane.polygon3D.map(p => ({...p})),                // for Escape and for no-op detection
  cesiumPlane: C.Plane.fromPointNormal(originCart, normalCart),
  armed: false, moved: false, downX: event.position.x, downY: event.position.y,
};
claimPointer('vertex-move');                                // ← INSIDE the resolved guard
```

**Step 4 — `vertexDragMove(event)`**, called from the existing MOUSE_MOVE (`:7601`) as the
first branch, mirroring `if (blockResizeRef.current) { blockResizeMove(event); return; }`:
6 px arm and re-baseline (`:7636-7648`); then
`C.IntersectionTests.rayPlane(ray, drag.cesiumPlane)`; then validate (§8.1); then update
**only** the Cesium entity and the handle position; then the dimension readout.
`lib/3d/vertexHandlesMath.ts:126 dimensionReadoutFt` is reusable as-is — it is pure
unit formatting with no geometry in it.

**Step 5 — `vertexDragUp()`**, called from inside the existing LEFT_UP `try` (`:7684`) as the
first branch. This is the whole commit and it follows `applyBuildingShape`'s emitter
(`SolarEngine3D.tsx:5818-5872`) exactly:

```
1. if (!drag.armed || !drag.moved || ringUnchanged) { restoreRender(); return; }
2. newRing = ring0 with [index] replaced by the final in-plane point
3. built = buildRoofPlane3D(newRing, { surfaceOffsetM: 0 })   // ← 0: the points are ALREADY lifted
4. built.id = faceId                                          // ← MUST. see §5.3 #6
5. re-render: remove plane3DEntityMap entities, renderPlane3DEntity(...), then set
   plane3DEntityMap / plane3DFrameMap / plane3DCesiumPtsMap for faceId
6. panel cull (§6): onPanelsAboutToBeCulled('Move roof corner'); onPanelsChange(survivors)
7. onRoofPlanesStitched?.([{ id, vertices, localFrame3D, polygon3D, origin3D, normal3D,
                             pitch, azimuth, ecefFrame3D /*, area — §5.2 */ }])
8. status line: corner moved + modules removed
```

**`surfaceOffsetM: 0` at step 3 is not optional.** `lib/roofPlane3D.ts:335-342` records what
happens without it: Stitch re-fit its own `projectedPts` and floated the roof — and every panel
on it — 12 cm higher **per press**, a ratchet with no obvious cause.

**Step 6 — the three abandon sites** (§4.3) and their three new test cases (§9).

**Step 7 — `tests/reshapeKeepsPitch.test.ts:104`**: `toHaveLength(4)` → `toHaveLength(5)`, in
the same commit, with the fifth emitter named in the test's own comment block (`:9`, `:63`).

### 8.1 Validation

**Do not use `validateVertexMove` (`lib/3d/vertexHandlesMath.ts:154`).** It takes a
`VertexTargetSpec` describing a Block/Gable/Hip/Tree primitive, works in lat/lng, and has no
self-intersection test at all. The three checks that matter, all in the face's own `(u,v)`
plane where they are exact:

1. **Minimum edge length.** Both neighbours must stay ≥ `MIN_SECTION_EDGE_M` (0.5 m,
   `lib/3d/buildingSection.ts:110`) away. Clamp rather than refuse, so the drag feels
   continuous. Use the section constant, not `vertexHandlesMath`'s own `MIN_EDGE_LENGTH_M`
   (`:26`) which happens to be the same number from a different authority.
2. **No self-intersection.** The new ring must stay simple. `segmentsCross` exists
   (`lib/3d/buildingSection.ts:280`) and is **private**; `validateSection` uses it at `:440` to
   raise `FOOTPRINT_SELF_INTERSECTING`. Export it (or a `ringIsSimple(pts2D)` wrapper beside
   it) rather than writing a third copy. Refuse the frame — hold the corner at its last valid
   position — rather than committing a bow-tie.
3. **Minimum area.** Reject a move that would drop the face's UV area below a small floor, so a
   drag cannot collapse a face to a sliver that then divides by zero somewhere downstream.

Refusals are shown live in the status line during the drag and the corner simply does not
follow the cursor — the standard direct-manipulation feedback.

---

## 9. THE TESTS THAT WOULD PROVE IT

Pure-math tests first; they are the ones that can actually fail for the right reason.

| # | file | what it proves |
|---|---|---|
| 1 | new `tests/vertexMoveGeometry.test.ts` | **The in-plane invariant.** Build a real 6:12 face at Granite City latitude (38.7°N, **not** lat 0 — that is the exact trap `tests/vertexHandles.test.ts:475-489` fell into). Move a corner. Assert `pitch` and `azimuth` are unchanged to 1e-6, `ecefFrame3D.n` is unchanged, `area` changed by the expected shoelace amount, and the id is preserved. |
| 2 | same file | **Out-of-plane is impossible by construction.** Assert `(P₁ − P₀) · n == 0` for a swept set of camera rays, including steeply off-nadir ones. This is the case `pickRayToLatLng` would fail by 4.8 km and its own tests could not see. |
| 3 | same file | **`surfaceOffsetM: 0` is passed.** Re-fit the same ring ten times; assert the face's height does not ratchet. This is the 12 cm-per-press bug, pinned. |
| 4 | new `tests/vertexMoveValidation.test.ts` | Min-edge clamp at `MIN_SECTION_EDGE_M`; self-intersection refused (drag corner 0 of a rectangle past corner 2); min-area refused. |
| 5 | new `tests/vertexMovePanelPolicy.test.ts` | Panels outside the new ring are culled, panels inside are **byte-identical** (not repositioned), the count is reported, and `onPanelsAboutToBeCulled` is called **before** the removal. |
| 6 | `tests/pointerGestureAuthority.test.ts` (extend) | `claimPointer('vertex-move')` exists; the claim is **inside** the resolved-grab guard (same shape as the existing `object-size` case at its `if (at)` assertion); the tool-change, Escape and full-reset regions each name `cancelVertexDrag()`. **Without these three the guard stays blind to this gesture.** |
| 7 | `tests/pointerGestureAuthority.test.ts` | The `'VertexHandles specifically is still NOT mounted'` case must **stay green**, because this design does not mount it. If it ever goes red, someone took the shortcut. |
| 8 | `tests/reshapeKeepsPitch.test.ts` | Emitter count 4 → 5, and the new emitter carries all of `vertices`, `pitch`, `azimuth`, `localFrame3D`, `ecefFrame3D`, `polygon3D`, `origin3D`, `normal3D`. |
| 9 | new case in `tests/roofPlanesSignature.test.ts` | A moved corner changes the signature (it does — `vertices` is signed at `lib/roofPlanesSignature.ts:49`) — pinned, so nobody "optimises" the commit into writing only `polygon3D` and silently loses every edit on reload. |
| 10 | E2E, **last and least** | A browser spec must drive this through a `__solarEngineE2E` hook (`SolarEngine3D.tsx:2858`), not through real mouse events, because handles cannot be picked under software WebGL. That is a harness limit, not a product one. Do not let a green E2E stand in for tests 1–3. |

---

## 10. WHAT OF `VertexHandles` SURVIVES — EVIDENCE, NOT SENTIMENT

Nothing structural. Three small pieces are individually correct and reusable **as functions**:

| piece | location | verdict |
|---|---|---|
| `dimensionReadoutFt` | `lib/3d/vertexHandlesMath.ts:126` | **Reusable.** Pure unit formatting, no geometry. |
| `MIN_BLOCK_VERTICES` | `:29` | Trivially correct; not needed here. |
| refs-not-state during the drag | `VertexHandles.tsx` shell | **The idea is right** (a long drag must cause no React re-render) and it is already how every engine gesture works. Take the idea, not the file. |

Everything else is excluded with a reason: `pickRayToLatLng` (`:370`) approximates the Earth as
a sphere of the equatorial radius; `rebuildGableFaces` / `rebuildHipFaces` /
`gableEaveCornersFromSpec` (`:235`) are **proven defective** by
`tests/buildingSectionMutation.test.ts` (DEFECT 1) while `tests/vertexHandles.test.ts` still
asserts them correct on axis-aligned fixtures; `validateVertexMove` (`:154`) describes
primitives, not roof faces, and has no self-intersection test; the component's own
`ScreenSpaceEventHandler` (`VertexHandles.tsx:175`) is a second competing registration; its
unmount cleanup (`:291`) leaks every entity.

**`components/3d/editing/VertexHandles.tsx` is not mounted by this design and
`tests/pointerGestureAuthority.test.ts`'s guard against mounting it stays in force.**

---

## 11. WHERE THIS SITS IN THE STANDING RULINGS

`lib/3d/geometryMutationPolicy.ts` (Ray, 2026-09-21) is the governing rule and it **permits
this gesture explicitly**:

> *"An explicit user gesture MAY move a traced footprint horizontally … INFERENCE AND AUTOMATIC
> RECONCILIATION MUST NEVER SILENTLY MOVE THE USER'S TRACED PLAN GEOMETRY."*

A vertex drag declares itself:

```ts
evaluateGeometryMutation({
  operation: 'move roof corner',
  authorship: 'user-authored',      // a person's gesture whose WHOLE MEANING is this change
  effect:     'moves-footprint',
})   // → allowed
```

The module's header adds the caveat this design must satisfy rather than assume:

> *"The ruling permits the gesture; it does not say the gesture is ready. Horizontal movement
> stays unbuilt until the section / volume authority, undo, validation and the persistence path
> can carry it safely."*

Against that list, for a **standalone** face: the section authority is satisfied by *refusing*
section faces (§1.2); undo is satisfied by §7 with the one open caveat named there; validation
is §8.1; persistence is satisfied because `vertices` is signed (§5.1). For a **section** face,
none of it is satisfied — which is the same conclusion §1.2 reached from the geometry, arrived
at from the policy side.

The call site should be real, not decorative: `vertexDragDown` calls
`evaluateGeometryMutation` and refuses on `!allowed`, so the rule is enforced where the gesture
is, and `verdict.reason` goes into the diagnostic log as the audit record the module intends.

---

## 12. FILE INDEX

| Path | Role in this design |
|---|---|
| `types/index.ts:445-571` | `RoofPlane` — `vertices:447`, `polygon3D:522`, `origin3D:520`, `sectionId:532`, `section:538`, `sectionFaceReshaped:560`, `ecefFrame3D:566` |
| `types/index.ts:394-439` | `RoofSectionRecord` — why a section face's corner is not addressable |
| `lib/roofPlane3D.ts:825` | **`buildRoofPlane3D`** — the one rebuild authority. `:833-868` the un-lift rule; `:881` the uuid trap; `:335-342` the `surfaceOffsetM: 0` rule |
| `lib/roofPlane3D.ts:346` | `computePlaneFromPoints3D` — Newell fit; why non-planar input tilts the whole face |
| `lib/3d/placementIntersection.ts:411` | **`intersectRayWithSphere`** — the GPU-free grab |
| `lib/3d/placementIntersection.ts:140,185` | `pointInRing2D` / `ringInFaceFrame` — the cull test |
| `lib/3d/placementIntersection.ts:205-232` | `intersectRayWithFace` — **the ring bound** that makes `resolvePlacementPoint` wrong for the drag |
| `lib/3d/buildingSection.ts:110` | `MIN_SECTION_EDGE_M` = 0.5 m |
| `lib/3d/buildingSection.ts:280,440` | `segmentsCross` (private) — the self-intersection test to export |
| `lib/3d/geometryMutationPolicy.ts` | Ray's 2026-09-21 ruling; `evaluateGeometryMutation` |
| `lib/3d/sectionEditing.ts:1561` | `repositionPanelsForPlanes` — **must NOT be called** on a vertex move |
| `lib/surfaceGeometry3D.ts:540-556` | proof that `origin3D` + `ecefFrame3D` is the placement frame authority |
| `lib/roofPlanesSignature.ts:47-72` | `SIGNED_FIELDS` — `vertices` is signed, so the edit persists |
| `lib/roofGeometry.ts:822-838` | `enrichRoofPlaneWithLECS` — what it recomputes, and that **`area` is not on the list** |
| `components/3d/SolarEngine3D.tsx:426` | `PlacementMode` — add `'vertex'` |
| `components/3d/SolarEngine3D.tsx:494-542` | `RoofPlaneReshapeUpdate` — the commit shape |
| `components/3d/SolarEngine3D.tsx:2157-2201` | `arrayManipRef` / `pointerOwnerRef` / `claimPointer` / `releasePointer` |
| `components/3d/SolarEngine3D.tsx:2515-2530` · `:11137-11141` · `:12566-12572` | the three abandon sites |
| `components/3d/SolarEngine3D.tsx:7233-7256` | `setupClickHandler` and the plain-function-trio precedent |
| `components/3d/SolarEngine3D.tsx:7512-7599` · `:7601-7669` · `:7671-7733` | LEFT_DOWN · MOUSE_MOVE · LEFT_UP — where the three functions hang |
| `components/3d/SolarEngine3D.tsx:7591-7595`, `:7636-7650` | `Plane.fromPointNormal` + `IntersectionTests.rayPlane`, and the 6 px arm |
| `components/3d/SolarEngine3D.tsx:5818-5872` | `applyBuildingShape`'s emitter — the template for the commit |
| `components/3d/SolarEngine3D.tsx:5173-5260` | `liveRenderedFaces` / `collectRoofRenderables` — where the live ECEF ring lives |
| `components/3d/SolarEngine3D.tsx:8017` | `resolvePlacementPoint` — the rule to honour, the function not to call |
| `components/3d/SolarEngine3D.tsx:12447-12456` · `:2853-2857` | the software-WebGL `drillPick` measurement |
| `components/design/DesignStudio.tsx:5494-5570` | the `onRoofPlanesStitched` consumer |
| `components/design/DesignStudio.tsx:573-586` | `reshapeMovedIt` |
| `components/design/useSiteDesign.ts:341` | `recordGeometry` — the undo authority (note: `components/`, not `lib/`) |
| `components/design/useSiteDesign.ts:378-400` | `applyRestoredGeometry` — the open undo caveat (§7) |
| `tests/pointerGestureAuthority.test.ts` | the build-failing pointer guard; three cases to add |
| `tests/reshapeKeepsPitch.test.ts:104` | emitter count 4 → 5 |
| `docs/SOLARPRO-3D-INTERACTION-MODEL.md:210-268, 364-390, 516-560` | prior interaction model; the FOOTPRINT row, the `VertexHandles` critique, the signature trap |
| `docs/research/VERTEX-EDITING-FEASIBILITY.md` | why the existing component is not the starting point |
