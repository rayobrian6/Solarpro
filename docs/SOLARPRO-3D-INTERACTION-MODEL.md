# SolarPro 3D — the consolidated interaction model

**Date:** 2026-09-21 · **Status:** PROPOSAL, **post-adversary**. Four Step-0
defects are fixed and shipped (§9); nothing else here is built.

> 🚨 **§0 — WHAT THE ADVERSARY OVERTURNED.** Five adversaries plus a synthesis
> attacked this document. Their verdict: *not safe to start at §10 step 1 as
> written.* Seven of my claims were factually wrong; the corrections are folded
> into the sections below and listed here so nothing is quietly rewritten.
>
> 1. **The biggest finding in the whole exercise was not in this document.**
>    `applyBuildingShape` was the unfixed caller of the SURFACE_OFFSET_M
>    double-lift — a live, cumulative, *persisted* corruption of the plan record
>    the permit site plan reads. I measured it: **5.39 cm of plan slide and
>    10.73 cm of eave ratchet per press at 6:12, linear in the number of
>    presses.** Fixed as Step 0b (§9(5)).
> 2. **§11 was backwards.** I said a pure height edit is unsigned and silently
>    dropped by the autosave. False: `applyBuildingShape` re-derives the
>    outline, re-measures orientation and emits `vertices`, `pitch` and
>    `azimuth` — all three signed — so the save *fires*. It was not losing the
>    edit; it was persisting a corrupted one. Diagnosing a bug that was not
>    there is exactly what hid the one that was.
> 3. **§1's table was wrong about the same function.** "The outline is the
>    input" — it is not; the input is the render-lifted cache. So the claim that
>    all five writers preserve the footprint *by construction* was false: one of
>    them moved it every press.
> 4. **§3's "single drillPick" is not a thing.** There are two pick mechanisms,
>    and `pickRoofFaceAtScreen` is deliberately *not* a scene pick — that is the
>    fix for the defect Ray personally reported ("I can see the planes but
>    cannot select them"), because a marked-but-unpanelled face renders as one
>    polyline with no polygon to hit. Merging them naively re-ships it.
> 5. **§10 step 1 is not implementable as written.** `lib/3d/faceHitTest.ts` has
>    zero imports and cannot see a scene or depth buffer; the occlusion test
>    belongs in `pickRoofFaceAtScreen`, which owns the viewer, and `pickFaces`
>    already returns `distanceM` per hit as the seam.
> 6. **§11's section seeding named the wrong tolerance and a graph that does not
>    exist.** `buildWalls` computes a per-edge boolean and never records which
>    face matched, so connected components is new code; and 0.35 m is documented
>    in that very file as the *wrong* number for grouping — 1.6 m exists because
>    at 0.35 m "both came out SOUTH" on every hand trace. On fallback roofs the
>    0.35 m graph has no edges at all, so every face becomes its own section.
> 7. **§11's "no migration needed" is false as written.** There is no free-form
>    layout JSON: the layout route destructures the body explicitly and warns
>    that a field missing from that destructure "is dropped with no error". A
>    top-level `sections` array is silently discarded. A `sectionId` **on each
>    RoofPlane** does survive, because `roofPlanes` is passed through whole.
> 8. **§4 and §8 overstated `onRoofPlanesStitched`.** Its handler is a `map` over
>    existing planes, so an update whose id is not already in `roofPlanes` is
>    discarded *and still logged as success*. It cannot create. Gable/Hip/Block
>    create, so §8's prescription would produce a handler that fires and changes
>    nothing. Deletion has **no channel at all** — no `onRoofPlaneDeleted`
>    exists — so §4's DELETE has no canonical path to assemble from.
>
> Surviving intact under attack: §2(a)'s algebra, §2(b), §2(d), §6 in full, §7's
> "never mounted", §8's dead-code inventory, and §9(2)–(3).

> Eight UX workers audited this. One adversary attacked their findings. This
> document is **not** a concatenation of the nine — it is my synthesis, and where
> I overrule a worker I say so and give the evidence. Every load-bearing claim
> below I re-verified myself against the source; claims I could not verify are
> marked **UNVERIFIED** and are not allowed to carry weight.

---

## 1. The one-sentence diagnosis

**The user's unit of thought has no name in the system.**

Ray's sentence is *"that garage needs to move six feet left."* `RoofPlane`
(`types/index.ts`) carries `id`, `vertices`, `pitch`, `azimuth`, `siteKey`,
`adjacentPlaneIds` — and no `buildingId`, `sectionId` or `groupId`. The thing he
sees as "the garage" is **emergent at render time** from `buildWalls`'s 0.35 m
shared-edge test (`lib/3d/buildingExtrusion.ts`) and is discarded on the next
frame.

So every control in the product is forced to be scoped to **one face** or **all
faces** — because those are the only two sets the data model can name. That is
the Gulf of Execution in its purest form: the intention has no expressible form
in the system's vocabulary, and no rearrangement of buttons can close it.

And the verb is missing too. A repo-wide search for
`translatePlane|movePlaneBy|offsetPlane|translateFace|moveFace|moveBuilding`
returns **nothing**. All five writers to roof geometry preserve the plan-view
footprint by construction:

| writer | what it may change |
|---|---|
| `rebuildFlatTracedPlanes` | eave height only |
| `squareUpTracedFaces` | straightening; refuses any corner move > 1.5 m |
| `applyBuildingShape` | re-derives from `rf.polygon3D` — **the outline is the input** |
| `stitchRoofVertices` | corner averaging within 1.6 m |
| `lib/3d/abutment.ts` | vertical only, by stated rule |

`translateArrayBy` moves `panelsRef` and nothing else. **The user cannot move a
mis-placed garage. Not in N steps — not at all.** The only path is
delete-and-retrace across two disjoint editors with zero reversible steps.

**Therefore: no UX proposal is acceptable that does not create the section noun
and the horizontal transform. Everything else is decoration on a system that
cannot express the user's sentence.**

---

## 2. What I am overruling, and why

**(a) I reject "the scoped wall edit re-datums against the global."** Two workers
called this defect (a) and ranked it first. The adversary is right and they are
wrong: in `applyBuildingShape` the global **cancels**. `prevWall =
wallHeightRef.current`, `wall = shape.wallHeightM ?? prevWall`, `groundM = lowest
- prevWall` → new eave `= lowest + (nextWall − prevWall)`, and `adjustBuilding`
computes `nextWall = effectiveWallM + delta.wall` off the same global. The WALLS
stepper performs a **correct relative move** of the scoped face. This inverts the
build order: **HEIGHT is the safer handle, PITCH is the dangerous one** (pitch is
applied absolutely from a global that prior scoped edits have polluted, and it
rewrites azimuth as a side effect).

**(b) I reject "second click descends into the face."** Two workers proposed it.
Shipped behaviour is the **opposite** — a second click on a selected face
**deselects** it, in both selection paths, and the product teaches this in two
visible strings (`· click it again to deselect`). Inverting a gesture the product
documents on screen is not a UX improvement, it is a second contract. **Descent
stays on double-click**, which already means "drill" for panel arrays.

**(c) I reject "gate the corrective tools with `isHandModelledFace` to protect
Google."** This was proposed as Step 0 and it is backwards. Square Up, Stitch and
Shape reach Google faces **today** and work; gating them removes a working
capability from the protected path — itself a regression — and on a mixed roof it
splits `joinSharedCorners` and Stitch's 1.6 m clustering, tearing a hand-traced
addition away from the Google ridge it shares. **The real breach is the unscoped
ALL-FACES default of the pitch/wall steppers**, which rewrites Google `pitch`,
`azimuth` and geometry and persists it — both fields are in `SIGNED_FIELDS`.
Close *that*.

**(d) I reject "BULK-snapshot `RoofPlane[]` — assembly, not invention."**
Serializability was never the obstacle; **the type is**. `SceneState` is
`{ primitives, selectedId, view }` and `Primitive` is a closed six-member union
with no roof face. This is a `types.ts` schema change plus a migration of how
`SceneState` is produced. Price it honestly (§6).

**(e) I reject "`arrayManipRef` and the block drag are proven precedents to copy
verbatim."** See §9 — the block drag was **dead code**. I verified it and fixed
it. `arrayManipRef` and `dragRef.armed` are genuinely proven; the block drag was
not, and a proposal was about to copy it as a template.

---

## 3. The selection hierarchy

**SITE (context) › SECTION › FACE | WALL › PANEL**

`SITE` is `RoofPlane.siteKey` — property identity, a breadcrumb, never a click
target. `BUILDING` is **not** a separate noun: a detached garage is still a
section from the user's side, and "building 1 vs building 2" is a distinction Ray
has not asked for. One new noun buys the whole brief; a second buys nothing yet.

**Descent and ascent**

| gesture | meaning |
|---|---|
| click | select at **section** level |
| click the same thing again | **deselect** — unchanged from today |
| double-click | descend one level (section → face/wall → panel) |
| Alt+click | jump straight to the deepest thing under the cursor |
| click a *different* section | restart at section level there |
| click empty space | clear everything, including drill state |
| Tab / Shift+Tab | cycle siblings at the current level |

Escape is **not** a level-up key. It is already an unconditional global cancel —
it cancels ground arrays, clears panel selection, empties the measure/row/plane
point buffers, aborts an in-progress Block trace and removes its preview
entities. Overloading it would make a half-drawn trace vanish when the user meant
"step up one level". A breadcrumb click is the ascent affordance instead.

**A breadcrumb is mandatory, not decoration.** `3 Melvin Dr › Garage › South
Face`. A drill hierarchy without one is invisible state — the same mode error the
🏚 Building toggle already commits.

**Day-one behaviour is identical to today, which is what makes this safe for
Google.** A face with no `sectionId` — every face today — is a section of exactly
itself. Level 1 and level 2 collapse, so the first click still selects one face.
The section level only becomes meaningful once sections exist, and creating them
is fallback-only work.

### Walls

A wall is **a grip, not an object**. `WallQuad` carries `{faceId, edgeIndex}` and
the entity is already named `[BUILD3D-WALL] ${faceId}#${edgeIndex}` — **the
identity is already there**; only the matcher refuses it
(`name.startsWith('[BUILD3D-ROOF] ')`). Selecting a wall selects it visually,
names its owning face (*"Wall · south eave of Garage › Face A · 8 ft 2 in"*), and
exposes exactly one operation — HEIGHT — which mutates that **face's** eave. It
cannot drift, because the wall is regenerated from the face it just moved.

### Panel priority — the honest statement

Building **OFF**: panel wins the click. Building **ON**: the roof face behind the
panel wins, because `drillPick(…, 8)` returns the `[BUILD3D-ROOF]` polygon from
behind and the branch returns on it. This is now recorded by E2E tests and the
source comment that denied it has been corrected (§9).

**Target:** one resolver, `resolveSelectTarget(viewer, screenPos) →
{kind:'wall'|'roof'|'panel'|'none', …}`, returning a discriminated hit from the
**single** `drillPick` it already performs, with panels winning over roof
surfaces in **both** modes. Hover pre-highlight must call the *same* function —
if hover and click can disagree, the pre-highlight is a lie, which is worse than
no pre-highlight.

---

## 4. Direct manipulation

Every gesture ends in the same pipeline:

```
user gesture → canonical mutation → validation → derived rebuild → render → persistence
```

**Render and persistence are already solved** for anything routed through
`RoofPlaneReshapeUpdate` → `onRoofPlanesStitched` → `setRoofPlanes` →
autosave. That channel already carries `vertices`, `pitch`, `azimuth`,
`polygon3D`, `origin3D`, `normal3D`, `ecefFrame3D` and `localFrame3D` together,
with comments recording two production bugs caused by emitting an incomplete
reshape. **Every new gesture emits a complete update through that one channel.**
The missing legs are exactly three: the horizontal transform, a validation stage,
and the section noun.

| # | gesture | mutation | status |
|---|---|---|---|
| 1 | **MOVE** — drag the section body, arms at 6 px | `translateFacesBy(faceIds, {dNorthM, dEastM})` | **NEW** — ~40 lines; the metre↔degree conversion already exists twice |
| 2 | **HEIGHT** — vertical handle on the section centroid / wall top | `setEaveHeight(faceIds, eaveM)` — scoped `applyBuildingShape` | corrected mutation, no new noun. **Blocked on the signature gap (§5)** |
| 3 | **PITCH** — hinge grip **on the eave edge** | `setFacePitch(faceId, deg)` | corrected mutation. Needs an explicit azimuth policy first |
| 4 | **FOOTPRINT** — corner + edge-midpoint handles | `reshapeFaceRing(faceId, ring)` | needs a *rewritten* VertexHandles (§7) |
| 5 | **ROTATE** — ⟳ knob, section only | `rotateSectionBy(faceIds, rad, pivot)` | last. A **face** must never rotate freely |
| 6 | **DELETE** | `deleteSection` / `deleteFace`, cascading panels | must confirm by naming what goes |

**Why the hinge lives on the eave:** `roofPlaneFromFootprint` anchors there —
*"A person tracing a roof knows the EAVE height, not the centre height"*. The
edge that does not move is the edge that is pinned. Norman's mapping, for free.
Read out **degrees and rise-over-run** — "26° · 6:12". Installers think in 12ths;
the product currently only speaks degrees.

**Why a face must not rotate:** azimuth is derived from the relationship *between*
faces — `deriveAzimuthsFromSharedEdges` exists precisely because per-face
derivation returned SOUTH for both halves of a gable. Spinning one face produces a
roof that cannot be built and an azimuth the engine will immediately re-derive
against.

**Shared corners propagate by default.** Two faces sharing a corner within 1.6 m —
Stitch's existing tolerance — move together, with Alt to detach, announced live:
*"2 corners moving together · Alt to detach"*. Silent propagation is magic; silent
non-propagation is a hole in the roof.

### 🚨 A policy question only Ray can answer

`lib/3d/abutment.ts` states: *"Horizontal position is NEVER touched — the
plan-view footprint the user traced is theirs, and only the height it sits at is
inferred."* A worker proposed reading this as "never **by inference**", leaving an
explicit gesture free to move it. **That reading is not obviously what the file
says, and it is the single most consequential rule in this proposal.** I am not
willing to reinterpret it in a subagent's prose. It needs an explicit ruling:

> *May an explicit user gesture move a traced footprint horizontally, while
> inference remains forbidden?*

If yes, the rule gets restated in the new module's header in the same voice. If
no, MOVE cannot be built and this whole proposal reduces to legibility work.

---

## 5. Camera vs editing

**The briefed premise was inverted and it makes the problem worse.** SolarPro does
**not** orbit on left-drag: `orbit.dragButton === 0` → **pan**; right/middle →
orbit. Cesium's own controller is fully disabled. The v52.2 comment names the
change and its reason (GIS/Google-Maps convention).

This matters because **pan and move are visually identical for the first frame** —
in both, the thing under the cursor follows the mouse. An orbit announces itself
instantly; a pan does not. So arbitration cannot rely on "it looks different".

| input | nothing selected | selected, cursor off it | selected, cursor **on** it |
|---|---|---|---|
| Left-drag | pan | pan | **MOVE** (arms at 6 px) |
| Right / middle-drag | orbit | orbit | **orbit — always** |
| Space + left-drag | pan | pan | **pan** (forces camera over a selection) |
| Wheel | zoom | zoom | zoom |
| Shift during move | — | — | lock to the section's dominant axis |
| Alt during move | — | — | suspend snapping |
| Arrows | — | — | nudge 0.1 m (Shift 0.5 m) in the section's frame |

Three of the four guarantees already exist in the file: the 6 px arm threshold
(`dragRef.armed`, with a comment naming the bug it fixed), the camera freeze
(`if (arrayManipRef.current) return;` at the top of the camera handler, with a
comment naming the "shear" bug it fixed), and its reset on tool change. This is
assembly, not invention. Rename `arrayManipRef` → `editManipRef`; it is no longer
array-specific.

**Caveats I must write down rather than promise around:**

* *"Right-drag is always safe"* holds **in select mode only**. Right-click
  finalises a trace in `plane`/`plane3d` mode.
* **Laptop reality:** orbit is right/middle-drag only and unreachable on touch,
  and the wheel handler ignores `deltaY` magnitude and `ctrlKey` — a fixed 15 %
  per event across dozens of trackpad events. **Every "zoom in to disambiguate"
  recovery is unperformable on a laptop until the wheel is normalised.** That is a
  prerequisite, not a polish item.
* **`pickFace` has no occlusion test** — only parallel-rejection and `t <= 0`.
  From a tilted camera the ray to ground *behind* the house crosses a roof polygon
  first, so clicking the lawn behind the house selects a roof face instead of
  clearing. **"Click empty space to clear" is load-bearing in this proposal and
  does not currently work from the default camera.**

**If only one thing from this section ships, ship the cursor change** — a
four-way move cursor the moment the pointer enters the selection body. It
converts an invisible mode boundary into a visible one, continuously, at the
exact place the decision is made.

**Do not add a "Move mode" to the tool picker.** It is already at Hick's-Law
saturation (25 `PlacementMode` values, ~20 exposed) and grouped by implementation
verb rather than user task. The point of direct manipulation is that selecting
the object *is* entering the mode.

---

## 6. Undo — the blocker

**Undo covers nothing.** `historyStoreRef` is seeded with
`createEmptySceneState()` and is never dispatched to, never `replaceState`d,
never `markSaved`. `cursor` is permanently 0, so `canUndo` is permanently false
and both buttons render permanently disabled. There is no Ctrl+Z binding
anywhere.

It is worse than inert — it is a **false status display**. It tells the user
"nothing to undo, everything saved" while the 3 s autosave writes their geometry
edits to Postgres. And `onSave` is `async () => {}` while the toolbar calls
`store.markSaved()` on the resolved promise, so Save clears the dirty highlight
and reports success for a no-op.

**Is the existing history store the wrong abstraction? Yes — and I will say it
plainly.** `PrimitiveKind` is `block|gable|hip|tree|obstruction|panels`. There is
no roof face, and the reducer's `MOVE` case explicitly refuses vertex-bearing
kinds. Wiring `dispatch` would compile and undo nothing. **Geometry coverage is
0 %, and the type contract forbids covering it.**

**What I propose instead:** a history authority over **the canonical persisted
payload**, not over `SceneState.primitives` — snapshot
`{roofPlanes, panels, obstructions, measurements}`, the four things
`saveLayoutToDB` writes. One entry per **committed gesture**, on mouse-**up**,
never per mouse-move. The ring buffer is 50; tens of faces × 50 is negligible.

The store's *mechanics* (ring buffer, cursor, dirty tracking, the Buttons UI) are
sound and reusable. Its *domain model* is not. Either widen the union to include a
roof-face kind or — better — make the store generic over the persisted payload
and let `SceneState` remain the primitive-scene concern it was built for.

**Until an Undo press demonstrably restores a Square Up on a real roof, no drag
gesture ships.** Shneiderman's third condition for direct manipulation is "rapid
incremental **reversible** operations". A mode error with no undo is a data-loss
event, and today's roof-plane delete is a 16-pixel ✕ with no confirm, 10 px from a
benign accordion toggle, with no warning on tab close.

---

## 7. `VertexHandles` — reuse the shell, rewrite the commit

It is complete, tested, imported and **never mounted**. Its shell is right in one
respect: refs-not-state, so a long drag causes no React re-render. It is wrong in
four that matter, and mounting it as-is ships all four:

1. **No camera freeze.** No `arrayManipRef` equivalent — a drag would pan the
   camera simultaneously, reproducing the documented "shear" bug verbatim.
2. **No arm threshold.** `MOUSE_MOVE` moves the vertex on pixel one, so a *click*
   on a corner dot moves that corner. The array grab's 6 px gate exists for
   exactly this.
3. **`scene.pick`, not `drillPick`** — handles are occluded by the Building
   extrusion, i.e. invisible in the one mode where you would use them.
4. **Renderer-first commit.** It mutates `polygon.hierarchy.positions` directly
   and its own DESIGN.md §10 lists persistence as out of scope. That is
   acceptable *during* the drag (a 60 Hz canonical rebuild would be absurd) and
   **not** acceptable at drop. `LEFT_UP` must call `reshapeFaceRing` and go
   through `onRoofPlanesStitched`. **Write that split into the code**, or the next
   reader copies the header comment.

Directly reusable: `MIN_EDGE_LENGTH_M = 0.5`, `adjacentVertexIndices`,
`validateVertexMove`, the live `dimensionReadoutFt`, and the captured
`originalLat`/`originalLng` — which it stores and **never reads**. Finishing that
gives Esc-cancel for free.

---

## 8. Renderer-only Gable / Hip / Block, and the sidebar's second authority

**Gable / Hip / Block emit Cesium entities only** — `viewer.entities.add({ id:
'gable-face-a-…' })`. No `RoofPlane` is ever produced. `vertexSpecs` is written
and never read. So the renderer-only anti-pattern is **already shipping, in the
exact tools a user reaches for when Google has no coverage**. Classification:
**incomplete migration, not intentional preview.** They must either emit through
`onRoofPlanesStitched` like every other writer, or be labelled as massing
previews that produce no design — but they cannot keep looking like roof
modelling tools while producing nothing the engine can see.

**The sidebar is a live second authority.** The Slope slider and Direction
buttons write the scalars `pitch`/`azimuth` and nothing else;
`resolvePlaneGeometry` returns `'own-frame-and-polygon'` for any traced face and
**never reads `plane.pitch`**. No effect rebuilds 3D geometry on a `roofPlanes`
change.

And this is **not cosmetic**: `plane.pitch` *is* an engineering input —
`lib/structural/roofSlopeAuthority.ts` reads
`[p.pitch, p.slopeDeg, p.pitchDegrees, p.tilt].find(isSlope)`, and DesignStudio's
own stitch handler states the rule: *everything downstream — the planset, the
structural engine, the production model — reads `plane.pitch`*. A user dragging a
slider in a collapsed accordion **changes the structural slope basis and moves no
geometry**. That slider must route to `setFacePitch` or become a read-only
readout. It cannot keep writing a scalar the 3D model ignores.

Two more scope lies to close with it: the per-face PITCH/WALLS readouts always
show the **global** value (they read `buildingOverrides`, whose setter is never
called), and `adjustBuilding` writes the global **unconditionally**, outside the
scope branch — so editing one face moves the baseline for every future edit.

**A collision to resolve before any inspector code is written:**
`components/3d/panel/RightPanel.tsx` is complete, tested, absolutely positioned
10 px from the sidebar's edge, **not imported**, and its tool list already
contains `{ id: 'roof-face-info', label: 'Roof Face Info' }`. `StatusPanel` is
imported and mounted but gated on `isDesignPhase`, which DesignStudio never
passes. Two right-hand panels already claim the inspector's job and neither
renders.

---

## 9. Step 0 — three defects found and fixed while writing this

These were false system images: the code did one thing and said another. All
three are fixed, mutation-proved against the pre-fix source, and covered by
`tests/screenSpaceHandlerRegistration.test.ts` (8 tests).

**(1) 🚨 The block height drag was dead code — and a proposal named it
"INTERACTION PRECEDENT, COMPLETE AND WORKING · copy it verbatim".**
`setupClickHandler` creates **one** `ScreenSpaceEventHandler` and registered
`LEFT_DOWN`, `MOUSE_MOVE` and `LEFT_UP` **twice** on it — the block trio, then
the panel-array trio. Cesium's `setInputAction` is a plain assignment
(`this._inputEvents[key] = action`), verified against the installed Cesium in the
test, not from memory. The array trio **replaced** the block trio, so
`blockResizeRef` was never written and the drag, its camera freeze and its
`suppressClickRef` were all unreachable — while the comment above them read
*"Runs BEFORE the existing panel-array LEFT_DOWN"*. Fixed by making the three
plain functions that the surviving handlers call, so they now really do run
first. **The guard matters more than the fix: any third gesture trio added the
obvious way would have silently deleted the panel-array grab.**

**(2) 🚨 The Building-mode scope message was exactly inverted — and I caused it.**
`selectRoofFace` writes `selectedFaceIdRef.current` **synchronously**; the
message then re-read that ref to choose its wording, so it reported the state it
had just moved *to*. Selecting a face announced *"Face deselected — Walls and
Pitch now apply to the whole building"*; deselecting announced *"Face selected"*.
This is the **only** scope feedback Building mode has, so the user was told the
exact opposite of which faces the controls would touch. It was correct before
commit `25d3db46` — my face-selection fix — because `setSelectedFaceId` is a
React setter and the ref still held the old value. Making the ref write
synchronous was right; not re-checking its readers was not. Fixed by capturing
`toggledOff` before the call, exactly as the sibling path always did.

**(3) The Building branch never cleared the panel selection.** Its sibling calls
`clearPanelSelection()` first; this one did not. So with Building ON a panel
array and a roof face were both selected, and the arrow keys — gated on
`selectedPanelIdsRef` alone — moved the **array** while the chip claimed face
scope. Fixed to match the sibling.

**(4) A false comment, corrected rather than deleted.** The branch claimed *"a
click that lands on a panel still falls through to the panel logic below."* It
does not — E2E records that with Building ON, a panel click selects the roof face
behind it. The comment now records the truth and marks it as **recorded, not
endorsed**: resolving the routing difference is §3's job.

**(5) 🚨 STEP 0b — `applyBuildingShape` was corrupting the permit plan record,
cumulatively, on every press. Found by the adversary, measured by me, fixed.**

`collectRoofRenderables` returns RENDER points. Both its branches are lifted
`SURFACE_OFFSET_M` along the face normal — the live branch reads
`plane3DCesiumPtsMap`, written from `built.frame.projectedPts` at the bottom of
`applyBuildingShape` itself; the fallback branch reads the stored `polygon3D`,
which `lib/roofPlane3D.ts:743` sets to `projPts` under a comment stating *"the
lift stays where it belongs — polygon3D, origin3D and the frame keep it"*.

A normal is not vertical. Projecting those points to lat/lng and feeding them to
`roofPlaneFromFootprint` — which correctly lifts a *genuinely raw* outline —
applied the offset a second time, and the result was written straight back into
the same cache, so presses compounded. Measured against the real library at 6:12:

| presses | plan slide | eave ratchet |
|---|---|---|
| 1 | 5.39 cm | 10.73 cm |
| 3 | 16.18 cm | 32.18 cm |
| 5 | 26.97 cm | 53.63 cm |

Exactly `0.12·sin(tilt)` and `0.12·cos(tilt)` per press, linear. `vertices` and
`pitch` are both in `SIGNED_FIELDS`, so this was not a rendering artefact — the
autosave fired and persisted it into the plan record the permit site plan and the
CAD engine read. A gable's two halves carry opposite azimuths, so they slide
apart and the shared ridge **splits by twice the drift**; `joinSharedCorners`'
1.5 m tolerance is why nothing downstream ever objected.

`lib/roofPlane3D.ts:626-650` already documents this exact class and names the
callers that were fixed — `buildRoofPlane3D`, Stitch, Square Up. This one was not
on that list. Fixed by un-lifting along each face's own normal before the plan
record is taken. `tests/applyBuildingShapeDatum.test.ts` (6) reproduces the
defect numerically, proves it is cumulative, and proves twenty presses now move
the record by **less than a millimetre**.

This affects **both providers identically** — `collectRoofRenderables` has no
source filter — so it is a fix on the Google path too, not a change to it.

---

## 10. Build order

Each step is independently verifiable and leaves the product no worse.

| # | step | why here |
|---|---|---|
| **0** | ~~duplicate handler registrations · inverted scope message · panel/face co-selection~~ | **DONE** (§9) |
| **0b** | ~~`applyBuildingShape` double-lift~~ | **DONE** (§9(5)). A live persisted corruption outranks every planned item. |
| 1 | Normalise the wheel handler; add the occlusion test **in `pickRoofFaceAtScreen`**, not in `faceHitTest.ts` — that module has zero imports and cannot see a scene; `pickFaces` already returns `distanceM` as the seam | Every recovery gesture below assumes zoom works and empty-click clears. Neither does. |
| 2 | One `resolveSelectTarget`; wall selection; panel priority in both modes; hover pre-highlight through the **same** function | Removes the last false system images. No geometry touched. |
| 3 | Close the unscoped ALL-FACES rewrite; give `applyBuildingShape` an explicit azimuth policy | The real Google breach. Must precede any new writer. |
| 4 | **The history authority over the canonical payload**, + fix `onSave` | Nothing reversible ships before this. §6. |
| 5 | `sectionId` + `BuildingSection`, **including `SIGNED_FIELDS`** and a reload story | §11. The noun. |
| 6 | The validation stage | Must exist before a gesture can produce an invalid roof. |
| 7 | **MOVE** — and prove its undo on a real roof | The verb. Gated on the §4 ruling. |
| 8 | HEIGHT, then FOOTPRINT, then PITCH, then ROTATE | Ordered by the §2(a) correction: height is safest, pitch is not. |

---

## 11. 🚨 The migration trap, which the repo already documents

`lib/roofPlanesSignature.ts` states it in its own header:

> *"ADDING A PERSISTED, USER-EDITABLE FIELD TO `RoofPlane` MEANS ADDING IT HERE.
> If you don't, edits to that field will not trigger a save and will be lost on
> reload — the exact bug this module exists to prevent."*

`SIGNED_FIELDS` is `id, vertices, pitch, azimuth, orientation, edgeTypes, source,
confirmed, siteKey`. It does **not** contain `sectionId`. So grouping three faces
into "Garage" would ride in the payload and **never trigger a save**.

**And the same gap is live today.** A pure height edit changes only
`polygon3D` / `origin3D` / `ecefFrame3D` — `vertices`, `pitch` and `azimuth` are
all unchanged, because the outline and orientation are re-used. None of those
derived fields are signed, so the autosave's `if (sig === lastSaved) return;`
drops it, and `adjustBuilding` does not re-lay panels either. **The WALLS steppers
can already lose a height edit on reload.** Attaching a nicer grip to that
mutation would ship a handle whose edits vanish.

This is the highest-risk item in the migration and also the cheapest to get
right: one line plus a test update, guarded by
`satisfies readonly (keyof RoofPlane)[]` and an existing test.

**Section seeding:** propose sections from the connected components of
`buildWalls`'s existing 0.35 m shared-edge graph — faces joined by shared edges
are one candidate section. The emergent grouping becomes a **suggestion**, never
the authority: confirmable, renameable, overridable. Gestalt proximity is exactly
what makes the user read those faces as one object, so the guess is good — and it
must still be theirs to reject. If the sections array lives inside the layout JSON
beside `roofPlanes`, **no DB migration is needed**.

---

## 12. Open questions I will not answer for Ray

1. **The `abutment.ts` horizontal-position ruling** (§4). Blocks MOVE entirely.
2. **Gable / Hip / Block**: finish the migration to real `RoofPlane`s, or relabel
   them as massing previews? (§8)
3. **Two unmounted right-hand panels** (§8) — which one is the inspector?
4. **UNVERIFIED:** the frame cost of hover pre-highlight on a Photorealistic 3D
   Tiles scene. This needs a measurement on a `solar_api` project, not an
   assertion, and it is the one item here that could regress the Google path by
   cost rather than by correctness.
