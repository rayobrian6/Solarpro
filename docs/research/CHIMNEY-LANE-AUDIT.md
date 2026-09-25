# CHIMNEY LANE — FORENSIC AUDIT

**Date:** 2026-09-25 · **Branch:** `dev` @ `ebf85566` · **Mode:** READ-ONLY. No product source was
edited, nothing was committed, no test suite and no Playwright run was executed.

**Method.** Code and state only. Per the standing finding that software WebGL does not rasterise the
Cesium scene, no screenshot was consulted and none would have been evidence. Every verdict below is
sourced to a file and line on this working tree. Where I could not find code, I say so as an
**absence of evidence** and name where I looked.

**Scope reminder.** A chimney is `space: 'roof'` — it stands on a roof FACE. That is what makes it a
different animal from the tree lane, which has had the attention: a tree resolves against the ground
sphere and occupies no roof area; a chimney resolves against a canonical roof face, occupies roof
area, and must follow that face when the face moves.

---

## 1. THE EIGHT-LINK VERDICT

| # | Link | Verdict | The decisive evidence |
|---|---|---|---|
| 1 | Roof click → a chimney record exists | **WORKS** | `lib/3d/obstructionPresets.ts:117-122` (preset present), `SolarEngine3D.tsx:16766-16793` (chip rendered from the table), `SolarEngine3D.tsx:13606-13704` (handler), `e2e/object-geometry-acceptance.spec.ts:378-440` (real palette click, real canvas click, record asserted) |
| 2 | Face-local footprint | **BROKEN** | `components/3d/obstruction/dimensions.ts:167-168` says the rectangle is *"axis-aligned (sides run east-west and north-south, **not rotated to the roof slope**)"*; `SolarEngine3D.tsx:12317-12320` puts all four corners at the single altitude `part.bottomAltitudeM` |
| 3 | Height above the roof | **WORKS** | `SolarEngine3D.tsx:12305` `baseAltitudeM: obs.height`; `lib/3d/obstructionGeometry.ts:219` `topAltitudeM: base + heightM`; `SolarEngine3D.tsx:12337` `extrudedHeight: part.topAltitudeM` |
| 4 | It follows a roof edit | **BROKEN** | `lib/3d/sectionEditing.ts` and `lib/3d/buildingSection.ts` contain **zero** occurrences of "obstruct"; `SolarEngine3D.tsx:5991-6012` repositions panels only. No re-binding code exists. |
| 5 | Panel exclusion | **BROKEN** | Two authorities. `lib/surfaceGeometry3D.ts:874-899` (centre-point, **zero clearance**) is what runs at placement; `lib/3d/panelKeepOut.ts:104-168` (footprint-vs-footprint, chimney 0.45 m) runs only on a re-layout |
| 6 | Shade | **WORKS** | `lib/shade/canonicalShadeScene.ts:286-306` admits it as `kind: 'roofObject'`; `:338` excludes only the FACE, never what stands on it; a default chimney's rise is 1.20 m against a 0.5 m gate |
| 7 | Persistence | **WORKS** | Migration 122 column; `app/api/projects/[id]/layout/route.ts:43,109`; `lib/db/projects.ts:1314-1320` (whole-object `JSON.stringify`, no field whitelist); `lib/db/core.ts:486` |
| 8 | Delete / undo / redo | **MOSTLY WORKS — one real hole** | `lib/design/deletionAuthority.ts:817-823`, `useSiteDesign.ts:875-921`, `SolarEngine3D.tsx:2913`. **Hole:** a placement that culls no panels pushes no undo step (`SolarEngine3D.tsx:13497-13500`) |

---

## 2. LINK BY LINK

### 1 — Roof click → a chimney record exists · **WORKS**

`chimney` is a first-class row in the preset table, `lib/3d/obstructionPresets.ts:117-122`:

```
id: 'chimney', label: 'Chimney', icon: '🏠',
widthM: 0.9, depthM: 0.6, heightM: 1.2, round: false, space: 'roof',
minFootprintM: 0.25, maxFootprintM: 3.0, minHeightM: 0.15, maxHeightM: 8.0,
```

It is reachable. The chip row is built by `OBSTRUCTION_PRESETS.map(pr => …)` at
`SolarEngine3D.tsx:16766`, so every row in the table gets a button with
`data-testid="obstruction-preset-chimney"` (`:16770`). Pressing it writes both the ref and the state
and arms `placementMode: 'obstruction'` (`:16781-16783`) — the "two places each holding half of what
is armed" defect is closed.

The button can be *pressed*. The Tools flyout is raised to `OVERLAY_Z.MENU` while a group is open
(`SolarEngine3D.tsx:15756`), which is the fix for the z-index defect that produced the original
"Chimney may also not be wired end-to-end" report — recorded in the source itself at
`SolarEngine3D.tsx:15742-15748`: *"That is the owner's chimney report, and it was never about
chimneys: Chimney is a type inside the Obstruction tool, and the Obstruction BUTTON could not be
pressed."*

The click resolves against canonical geometry, not the depth buffer:
`SolarEngine3D.tsx:13608` → `resolvePlacementPoint(… 'roof')` → `:8136`
`nearestFaceAlongRay(ray.origin, ray.direction, faces, { padM: 0.25 })`. That needs nothing
rasterised, which is why this link survives software WebGL.

The record is stamped with the chosen noun and the CLICKED face, not the selected one
(`SolarEngine3D.tsx:13681-13704`): `type: preset.id`, `space: preset.space`,
`planeId: preset.space === 'roof' ? (spot.planeId ?? undefined) : undefined`. A roof object that
resolves a point but binds no face is refused outright (`:13624-13630`).

**The `dormer` question — chimney does NOT share it.** `dormer` appears in the
`ObstructionPresetId` union (`obstructionPresets.ts:36`), in `PlacedObstruction['type']`
(`types/index.ts:604`), in `DEFAULT_CLEARANCE_M` (`panelKeepOut.ts:112`), and in the site-model
tool tooltip *"Mark a chimney, vent, or dormer that blocks panels"*
(`components/3d/panel/tools.ts:121`) — but it has **no row in `OBSTRUCTION_PRESETS`**, so no chip is
rendered and it can never be placed. `chimney` has a row. The coverage test at
`tests/obstructionPlacementAuthority.test.ts:333-341` iterates presets → clearances, i.e. the
*forward* direction only; nothing asserts that every canonical `type` has a preset, which is why the
`dormer` gap is silent. Not a chimney defect, but it is the same missing assertion.

### 2 — Face-local footprint · **BROKEN**

The footprint is built in the **ground frame** and is not draped, not rotated, and not projected onto
the face. `components/3d/obstruction/dimensions.ts:165-199` builds four lat/lng corners by adding
±half-width in metres-per-degree, and its own docstring states the defect plainly at `:167-168`:

> The rectangle is **axis-aligned** (sides run east-west and north-south, not rotated to the roof
> slope).

The draw call then places all four of those corners at **one** altitude —
`SolarEngine3D.tsx:12317-12320`:

```
const footprint = buildObstructionFootprint(obs.lat, obs.lng, part.widthM, part.depthM);
const polyPositions = [footprint.sw, footprint.se, footprint.ne, footprint.nw]
  .map(c => safeCartesian3(C, c.lng, c.lat, part.bottomAltitudeM))
```

So the chimney's base is a horizontal rectangle at the click altitude. Two consequences on a pitched
face:

- **It does not sit on the roof.** For the 0.9 × 0.6 m preset on a 6:12 (26.6°) slope running
  north-south, the deck rises 0.3 · tan 26.6° = **0.15 m** over the up-slope half. The base sinks
  15 cm into the roof on one side and floats 15 cm above it on the other. At the preset's own
  `maxFootprintM` of 3.0 m on a 45° face that becomes ±1.5 m.
- **It is never rotated to the roof.** A chimney on a house whose ridge runs NE–SW is drawn with its
  sides due east–west and due north–south. Wrong in plan, and it propagates to the keep-out, which
  uses the same axis-aligned rectangle (`panelKeepOut.ts:127-136`, `surfaceGeometry3D.ts:889-896`).

Note the top face IS correct — a real chimney is a vertical prism with a horizontal top, so
`topAltitudeM = base + heightM` is the right shape. The defect is entirely in how the base is seated.

**Secondary, small, but real: a 12 cm render lift leaks into the placement datum.**
`collectRoofRenderables` tags fit-derived faces `cornersPlanLiftM: SURFACE_OFFSET_M`
(`SolarEngine3D.tsx:5200`, `SURFACE_OFFSET_M = 0.12` at `lib/roofPlane3D.ts:41`) and canonical
`vertices`-derived faces `cornersPlanLiftM: 0` (`:5296`). The obstruction path maps renderables into
`IntersectFace` at `SolarEngine3D.tsx:8129-8131` **without consuming `cornersPlanLiftM`**, so a
chimney placed on a rendered face sits 12 cm proud of the deck and one placed on a restored face sits
on it. That is a datum inconsistency of 12 cm between two branches of the same function. It happens
to cancel against `DEFAULT_MODULE_STACK_M = 0.12` (`lib/roofMountDatum.ts:72`) in the shade
calculation, which is luck, not design.

### 3 — Height above the roof · **WORKS**

Measured from the roof surface at the click point, and the `extrudedHeight`-is-an-altitude trap is
closed with the fix documented in place.

`obs.height` is an **altitude**, set from the ray/face intersection at
`SolarEngine3D.tsx:8101` (`const height = isFinite(carto.height) ? carto.height : groundElevM`). It
is the roof deck's ellipsoidal altitude at the clicked point, not a ground datum and not a height.

`drawObstructionEntity` passes it as the BASE (`SolarEngine3D.tsx:12305`):
`baseAltitudeM: obs.height` — under a comment naming exactly this trap. `buildObstructionGeometry`
then emits `topAltitudeM: base + heightM` (`lib/3d/obstructionGeometry.ts:219`), and the draw call
passes **that** to Cesium (`SolarEngine3D.tsx:12337`): `extrudedHeight: part.topAltitudeM`.

So: **base = roof altitude at the click point; top = that + the object's own height.** A 1.2 m
chimney at a 150 m property is drawn 150.0 → 151.2, not 1.2 → 150.0.

This is the one link with a test that reads the ACTUAL Cesium state rather than a library's
arithmetic — `e2e/object-geometry-acceptance.spec.ts:432-438` pulls `extrudedHeight` and the
polygon's positions back out of the live entity collection and asserts
`extrudedHeightM - baseAltitudeM ≈ rec.heightM`. That assertion would fail loudly if the datum
regressed.

### 4 — It follows a roof edit · **BROKEN (absence of evidence, searched thoroughly)**

**No re-binding code exists.** `types/index.ts:633-636` declares the intent —

> `planeId` … *Kept so the object can follow the surface it belongs to rather than floating at a
> world coordinate when that surface moves.*

— and nothing acts on it.

Where I looked:
- `grep -c obstruct` over `lib/3d/sectionEditing.ts` → **0**. Over `lib/3d/buildingSection.ts` → **0**.
  These are the two modules that own pitch, wall height, pad and ridge edits.
- `adoptGeometryOutcome`, the single funnel every section edit and face-pitch edit passes through
  (`SolarEngine3D.tsx:5917-6021`), redraws faces, publishes the canonical array, and then explicitly
  brings the **panels** along at `:5991-6012` via `repositionPanelsForPlanes`. There is no analogous
  call for obstructions, and no obstruction is mentioned anywhere in the function.
- Every writer of the obstruction list in the engine: `obstructionsRef.current =` appears at exactly
  three places — `:2758` (restore from DB), `:13491` (commit a placement), `:17629` (inspector patch).
  None is a geometry-change handler.
- The only consumer of `obs.planeId` in `lib/` or `components/` outside the shade scene is a status
  string: `SolarEngine3D.tsx:13484`
  `const where = obs.planeId ? 'on the roof face you clicked' : 'on the site';`

**Consequence.** Raise a section's eave by a foot, or re-pitch a face, after marking a chimney: the
face moves, the panels move with it, and the chimney stays at its old `height` — which is an absolute
altitude. It ends up buried in the roof or floating above it, and the shade scene inherits the stale
altitude (`canonicalShadeScene.ts:288`, `base = o.height`), so the production number is computed
against a chimney that is no longer where the roof is. Face ids are deterministic across a section
rebuild (documented at `SolarEngine3D.tsx:5873`), so the *binding* survives — only the geometry goes
stale. That makes a fix tractable: the id is still good, the altitude needs recomputing from the
rebuilt face.

`e2e/building-section-editing.spec.ts` mentions obstructions but does not place one and then edit the
face under it, so this is not covered.

### 5 — Panel exclusion · **BROKEN. TWO AUTHORITIES, AND THE WEAKER ONE IS THE ONE THAT RUNS.**

Both exist. They disagree. Name them:

**(A) `removeObstructedPanels` — `lib/surfaceGeometry3D.ts:874-912`.** Panel **CENTRE** inside the
footprint. **No clearance term at all** — it never reads `clearanceM` and never consults
`DEFAULT_CLEARANCE_M`:

```
return Math.abs(dxM) <= obs.widthM / 2 + 0.001 &&
       Math.abs(dyM) <= obs.depthM / 2 + 0.001;
```

**(B) `filterPanelsByKeepOut` — `lib/3d/panelKeepOut.ts:154-190`.** Footprint against footprint, plus
a type-specific clearance (`DEFAULT_CLEARANCE_M`, `:104-115`, chimney **0.45 m** vs vent 0.15 m),
with a real module half-extent that falls back to 1.134 × 1.722 m rather than to zero (`:141-145`).

**Which one runs, and when:**

| Moment | Filter | Line |
|---|---|---|
| The user marks a chimney on an existing array | **(A)** | `SolarEngine3D.tsx:13494` `removeObstructedPanels(panelsRef.current, [obs])` |
| Any 3D layout is generated (auto_roof, plane3d, surface_select, add_row, extend_row, single, ground, fence) | **(B)** | `lib/3d/controlLayer.ts:561` |
| 2D Auto Layout / Fill Roof | **(B)** | `DesignStudio.tsx:4249, 4326, 4396` |
| The user edits the chimney in the inspector | **neither** | `SolarEngine3D.tsx:17611-17635` — the patch redraws and re-saves; it never re-filters panels |

Quantified for the 0.9 × 0.6 m chimney preset with its 0.45 m clearance and a standard
1.134 × 1.722 m module:

- **(A)** removes a panel only if its centre is within **±0.451 m E–W, ±0.301 m N–S**. Acceptance
  area for a panel centre: **0.54 m²**.
- **(B)** removes it if its centre is within **±1.467 m, ±1.611 m**. Acceptance area: **9.45 m²**.

That is a **17× difference**. At a ~1.15 m column pitch and ~1.74 m row pitch, (B) clears a roughly
2 × 2 block of modules off a chimney; (A) clears **zero or one**. Modules are left standing across
the flue, with no flashing clearance, and nothing on screen says so.

And the UI promises (B). `SolarEngine3D.tsx:16797` prints, before the click:

> `Panels keep {(DEFAULT_CLEARANCE_M[obstructionPresetId] ?? 0.15).toFixed(2)} m clear of it.`

— i.e. **"Panels keep 0.45 m clear of it"** — and then places the object through a filter that keeps
them 0.00 m clear.

Two saving graces, neither sufficient: (i) the chimney's `space` is `'roof'`, so it is not wrongly
skipped the way a tree would be (`surfaceGeometry3D.ts:883`, `panelKeepOut.ts:156`); (ii) if the user
later re-runs Auto Layout or Fill Roof, authority (B) runs and the right panels do come out. The
defect is confined to — and complete within — the "mark a chimney on a finished array" workflow,
which is the normal one.

### 6 — Shade · **WORKS. The 0.5 m finding is real and does NOT drop real chimneys.**

The chimney reaches the occluder model. `DesignStudio.tsx:4750` reads
`placedObstructionsRef.current` and `:4765-4771` passes it wholesale to `buildShadeScene`.
`canonicalShadeScene.ts:286-306` admits any obstruction with finite coordinates, computes
`topM = base + rise` where `base = o.height` (the roof altitude) and
`radiusM = max(radiusM, widthM/2, depthM/2)`, and classifies it `kind: 'roofObject'` because
`type !== 'tree'` and `space !== 'site'` (`:290`, `:303`).

**Verifying the recorded finding.** `MIN_OCCLUDER_RISE_M = 0.5` at `canonicalShadeScene.ts:131`, and
the gate is at `:356-357`:

```
const rise = o.topM - panelTopM;
if (!(rise > MIN_OCCLUDER_RISE_M)) continue;
```

The finding is accurate but the wording "rise < 0.5 m" is easy to mis-read: **`rise` is measured
against the PANEL TOP, not against the object's own height.** For a chimney:

- `topM` = deck + 0.12 (render lift, §2) + 1.20 = deck + 1.32
- `panelTopM` = deck + `DEFAULT_MODULE_STACK_M` = deck + 0.12 (`lib/roofMountDatum.ts:72`)
- **rise = 1.20 m**, comfortably above the 0.5 m gate.

A typical real chimney is taller still: US code requires ≥ 3 ft (0.91 m) above the penetration, so
every real chimney clears the gate with margin. **Real chimneys are not being silently dropped.**
What the gate drops — correctly — is the vent (0.25 m), vent pipe (0.35 m), plumbing stack (0.45 m)
and skylight (0.12 m). The only chimney it would drop is one dialled down to the preset's
`minHeightM` of 0.15 m, which is not a chimney.

The face-exclusion rule is right and was written for this exact case
(`canonicalShadeScene.ts:329-338`): only `kind === 'building'` occluders are excluded by matching
`planeId`, never objects standing on that face. The comment says so —
*"BUT A CHIMNEY ON THAT FACE MOST CERTAINLY DOES … Only the FACE itself is excluded, never what
stands on it."*

One caveat that is not a defect but should be known: shade is **manually triggered**.
`runShadeAnalysis` (`DesignStudio.tsx:4748`) is reachable only from `onRunShadeAnalysis`
(`:5485`) and the E2E hook (`:2212`). Placing, editing or deleting a chimney does not re-run it. The
production derate therefore reflects whatever the chimney was at the last time somebody pressed the
button.

### 7 — Persistence · **WORKS**

Column: migration 122 adds `layouts.obstructions JSONB NULL`
(`lib/migrations/122_layout_obstructions_measurements.sql`).

Chain, end to end:
- Engine reports, does not save — one emit effect, not per-mutation-site (`SolarEngine3D.tsx:2723-2725`).
- Studio sends it in the payload; route destructures it (`app/api/projects/[id]/layout/route.ts:43`)
  and merges with `?? existingLayout?.obstructions` (`:109`), so `[]` can genuinely clear.
- DB writes the object whole — `lib/db/projects.ts:1314-1320`,
  `SET obstructions = ${JSON.stringify(data.obstructions)}::jsonb`. **No field whitelist and no
  per-field serializer**, which is what lets `planeId`, `space`, `clearanceM` and all three
  dimensions survive. I looked specifically for a projection/pick step and there is none.
- DB reads it back — `lib/db/core.ts:486`.
- Restore re-applies once, keyed on prop **identity** not on emptiness
  (`SolarEngine3D.tsx:2750-2761`) — the cross-site-contamination fix — and a separate effect redraws
  from `stage` rather than from a ref, so a cold load whose DB restore beats Cesium still draws
  (`:2776-2799`).
- Site switch archives and restores them with the bundle (`useSiteDesign.ts:596`, `:853`), proven live
  by `e2e/site-switch.spec.ts:135,145,158`.

A placement also *triggers* a save: `obstructions` is in `SIGNED_DESIGN_PARAMS`, so the layout
signature moves when one is placed, edited or deleted
(`tests/designEntityPersistence.test.ts:50-80`).

### 8 — Delete / undo / redo · **MOSTLY WORKS — one real hole**

**Delete works everywhere it should.**
- Plan: `lib/design/deletionAuthority.ts:817-823` (`scope: 'obstruction'`, refuses an id that is no
  longer in the design) and `:824-834` (`scope: 'obstructions'`, Clear All, which is a planned
  deletion rather than the raw setter it used to be).
- State: `useSiteDesign.ts:906-908` filters it out of `placedObstructions`.
- Tombstone: `:920` `withTombstones(...)`, so a later restore cannot resurrect it —
  `admitObstructions` refuses it on every reconstruction path
  (`deletionAuthority.ts:353-364`, `useSiteDesign.ts:1006-1011`).
- Scene: `SolarEngine3D.tsx:2913` `removeObstructionEntities(viewer, deletion.obstructionIds)`,
  driven by an explicit token, never by inferring absence from a prop.
- Shade: the occluder is built from the live list each run, so it is gone on the next run — but see
  the manual-trigger caveat in §6.
- Panel exclusion: gone too, since the same list feeds it. **The panels it culled do not come back**
  on a delete; only Undo restores them.
- Reachable from both the inspector (`:17704` `obstruction-delete`) and Clear All (`:16907`), and via
  the Delete key with a selected object (`:11019-11023`). Selection itself survives software WebGL:
  `pickObstructionAtScreen` falls back from the dead `drillPick` to a bounding-sphere ray test
  (`:12416-12470`).

**Undo works for a deletion.** `useSiteDesign.ts:875-891` pushes a snapshot that carries the
obstructions and the panels *before* the delete, and `undoGeometry` restores both
(`:462-477`, `restoreSiteEntities`).

**🚨 THE HOLE — a placement that culls nothing is not undoable.**
`SolarEngine3D.tsx:13497-13500`:

```
if (removed > 0) {
  onPanelsAboutToBeCulled?.(`Mark ${preset.label.toLowerCase()}`);
  …
```

`onPanelsAboutToBeCulled` → `recordPanelCull` (`useSiteDesign.ts:957-967`) is the **only** history
push on the placement path. When `removed === 0` no snapshot is taken, so Ctrl+Z after marking a
chimney does not remove it. And because link 5's weak placement-time filter makes `removed === 0` the
*common* outcome for a chimney, this fires most of the time. The tool's own tooltip
(`SolarEngine3D.tsx:15714`) ends: *"Panels under it are removed, and Undo brings them back."* Both
halves of that sentence are load-bearing and both are usually false for a chimney today.

The object can still be deleted (that path is sound), so nothing is unrecoverable — but "Undo" does
not mean what it says.

---

## 3. THE SINGLE WORST DEFECT

**Link 5: the chimney is placed through the weaker of two panel-exclusion authorities, and that one
applies no clearance at all.**

`commitPlacedObstruction` (`SolarEngine3D.tsx:13494`) calls `removeObstructedPanels`
(`lib/surfaceGeometry3D.ts:874-912`) — a panel-**centre** test with no clearance term — while the
product's real authority, `filterPanelsByKeepOut` (`lib/3d/panelKeepOut.ts:154-190`) with the
chimney's type-specific 0.45 m, runs only when a layout is *regenerated*.

Why this one and not link 4 or link 2:

- It is **silent and physical**. Modules are left standing across a masonry flue with no flashing
  clearance. The panel count, the string design, the BOM and the permit drawing all take the wrong
  number, and nothing on screen indicates anything is off.
- The UI **actively promises the opposite**, one line above the click: *"Panels keep 0.45 m clear of
  it"* (`SolarEngine3D.tsx:16797`).
- It is the **root of the link-8 hole** as well: `removed === 0` is why the undo snapshot is skipped.
- It is the **regression the codebase already fixed once and left half-done**. The header of
  `panelKeepOut.ts:31-38` says in terms: *"AND BOTH EXISTING TESTS USED THE PANEL CENTRE… A vent
  removed a panel roughly one time in five and the other four times the layout put a module straight
  through it."* The new authority was written, wired into `controlLayer` and into all three studio
  call sites — and the **manual placement path was not converted**. The one entry point the fix was
  named for is the one it did not reach.

The fix is one line of call-site surgery, not a redesign: `commitPlacedObstruction` should call
`filterPanelsByKeepOut` like everything else does.

---

## 4. WHICH LINKS ARE GENUINELY FINE — DO NOT SPEND EFFORT RE-PROVING THESE

**Link 1 (reachability and record creation).** Fully closed and *correctly* tested.
`e2e/object-geometry-acceptance.spec.ts:378-440` arms the real palette control with a non-forced
click (`armTool`, `:177-188` — the comment explains why `force` would hide the defect), clicks the
real canvas at a projected roof-face centroid, and asserts the record exists, is `type: 'chimney'`,
and bound to the clicked plane's id. That is product behaviour, not library arithmetic. The z-index
defect that caused the original report is closed at `SolarEngine3D.tsx:15756`.

**Link 3 (the extrusion datum).** Closed, and the test reads Cesium's own state.
`drawnParts` (`e2e/object-geometry-acceptance.spec.ts:204-247`) pulls `polygon.extrudedHeight` and
the hierarchy positions out of the live entity collection; the assertion at `:434-438` proves
`top − base == heightM` against the record. This is exactly the class of test the project has been
missing elsewhere, and it is present here.

**Link 6 (shade).** Closed, with a positive control.
`tests/canonicalShade.test.ts:130-133` proves the chimney's top comes from the roof and not the
ground; `:155-164` proves it is in the panel's horizon **by source id, not by bearing** — the comment
at `:157-158` records that a bearing match had previously found the roof and called it a chimney;
`:184-196` proves the panel's own face does not shade it **and** includes a positive control (the
same module, told it belongs to no face, IS shaded by that roof), which is what stops the assertion
passing for the wrong reason. The 0.5 m gate does not touch real chimneys (§6).

**Link 7 (persistence).** Closed. The chain has a named test per hop
(`tests/designEntityPersistence.test.ts:98-140`) and, more importantly, the DB layer stringifies the
whole object — there is no field-by-field serializer to drop `planeId` or `clearanceM`. Site-switch
archive/restore is proven live in `e2e/site-switch.spec.ts`.

**Link 8 (delete), excluding the placement-undo hole.** The tombstone ledger, the scene teardown, the
one-shot save authorization and the undo snapshot for deletions are all real and all wired. Only the
"placement pushed no history when it culled nothing" branch needs work, and it is three lines.

---

## 5. WHAT THE EXISTING TESTS WOULD ACTUALLY CATCH

| Test | What it really asserts | What it would NOT catch |
|---|---|---|
| `e2e/object-geometry-acceptance.spec.ts:378` | Real button, real click, real Cesium entity; record type, face binding, one polygon, and the extrusion datum | **Link 2.** `drawnParts` reads `h.positions[0]` only (`:219-221`) — one corner. All four corners share an altitude by construction, so the test passes on a footprint that is not on the pitched face at all. It also asserts nothing about panels, shade, persistence or undo. |
| `tests/obstructionPlacementAuthority.test.ts` | Genuine behavioural coverage of `filterPanelsByKeepOut`, including a stated mutation proof against the old centre test (`:69-76`), plus source-grep wiring guards on `controlLayer` and the three studio call sites | **Link 5 as shipped.** Every assertion is about authority (B). Nothing in the file mentions `removeObstructedPanels`, so the placement path's use of authority (A) is invisible to it. The wiring guard at `:214-219` counts studio call sites and would not notice the engine's own. |
| `tests/obstructionGeometry.test.ts` | Pure arithmetic of `buildObstructionGeometry` — that a chimney is one prism, base to base+height | It is the library's own arithmetic. It cannot see what the renderer does with the result, and it cannot see the ground-frame footprint, which is built in a different module. |
| `tests/canonicalShade.test.ts` | Real behaviour with a positive control — see §4 | It builds the chimney fixture by hand (`:80-83`) with a `planeId` already set. It does not prove that the product's placement path produces such a record, nor that the record is still accurate after a roof edit. |
| `tests/designEntityPersistence.test.ts` | Signature/round-trip behaviour + source-grep of each persistence hop | Source-grep hops are string matches; they prove the code is present, not that it runs. The behavioural half is a `JSON.parse(JSON.stringify(...))` identity — the library's own arithmetic. The live proof is in `e2e/site-switch.spec.ts`, not here. |
| `tests/toolFlyoutIsClickable.test.ts` | That the tool spine and the obstruction chips are not painted under another panel — the actual chimney report | Nothing downstream of the click. |
| `tests/placementAuthorityWiring.test.ts` | Source-grep that placement binds the CLICKED face, not the selected one, and resolves against the right space per type | Grep only. It would pass if the code were present but unreachable. |
| `e2e/building-section-editing.spec.ts` | Section pitch/height editing | **Link 4.** It never places an obstruction and then edits the face beneath it. There is no test anywhere that would catch the missing re-binding. |

---

## 6. ABSENCES OF EVIDENCE — WHERE I LOOKED AND FOUND NOTHING

1. **Code that re-binds an obstruction when its face moves.** Searched: `lib/3d/sectionEditing.ts`
   (0 hits for "obstruct"), `lib/3d/buildingSection.ts` (0 hits), `adoptGeometryOutcome`
   (`SolarEngine3D.tsx:5917-6021`), all three writers of `obstructionsRef.current`
   (`:2758`, `:13491`, `:17629`), and every `planeId` reference in `lib/` and `components/`
   co-occurring with an obstruction (one hit, a status string at `:13484`). **None exists.**
2. **A face-local or draped footprint builder.** Searched `components/3d/obstruction/`,
   `lib/3d/obstructionGeometry.ts`, `lib/3d/placementIntersection.ts`. `projectPointOntoFace` and
   `signedDistanceToFace` exist (`placementIntersection.ts:312-327`) and would be the right tools —
   **neither is called from the obstruction path.**
3. **A field whitelist or per-field serializer on the obstruction save.** Searched
   `lib/db/projects.ts`, `lib/db/core.ts`, `app/api/projects/[id]/layout/route.ts`. **None** — the
   object is stringified whole, which is why link 7 passes.
4. **An automatic shade re-run on obstruction change.** Searched every `runShadeAnalysis` reference
   in `DesignStudio.tsx` (`:141, 1065, 2212, 4748, 4813, 5485`). It is manual only. Not a defect,
   but it means link 5's and link 4's errors persist in the production number until someone presses
   the button.
5. **A second undo push on the placement path.** Searched `recordGeometry` / `recordPanelCull` /
   `pushSnapshot` around `commitPlacedObstruction`. `onPanelsAboutToBeCulled` at
   `SolarEngine3D.tsx:13500` is the only one, and it is inside `if (removed > 0)`.

---

## 7. NOTE ON ONE PIECE OF DEAD CODE

`handleObstructionClick` builds a footprint and four Cartesians at `SolarEngine3D.tsx:13662-13668`
and uses them **only** as a validity check (`if (polyPositions.length < 4) return`). The polygon that
is actually drawn is rebuilt independently inside `drawObstructionEntity` (`:12317-12320`). Harmless
today because both call the same builder with the same inputs, but it is a second place that computes
"the footprint", which is the shape of the drift this file has recorded against itself twice. Worth
deleting when link 2 is fixed, so the face-local builder has exactly one caller.
