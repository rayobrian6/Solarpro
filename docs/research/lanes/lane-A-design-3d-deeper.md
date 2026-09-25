# Lane A (deeper) — Design / 3D roof modelling

Research pass 2026-09-25. Scope: the 90/10 correction question only — when automation gets
the roof 90% right, how fast can an installer fix the last 10%? Principles already captured by
the shallow pass (contextual UI, visual sizing, direct manipulation, keyboard shortcuts, linked
pitch units, manual correction after automation, fewer persistent panels, provenance/confidence)
are **deliberately not repeated**. Everything below is new.

## SUMMARY — new principles only

1. **Derived geometry must never be editable.** Aurora's hips/ridges/valleys are *outputs* of (eave ring + per-edge pitch + per-edge height). Aurora's own trainer says "I do not recommend clicking and dragging the dotted lines" — dragging an output silently rewrites inputs. Editing an output is the anti-pattern.
2. **The leapfrog: make the drag solve for the input.** Nobody does this. If a user drags an eave onto the photo line, solve for the pitch that puts it there and name the input that changed.
3. **Derived geometry is a diagnostic for input error.** Aurora teaches "if the valley isn't 45°, the two adjacent tilts differ". Software should compute that, not make users learn to eyeball it.
4. **A correctness ledger you burn down.** Solargraf paints not-yet-correct facets **red**; the count visibly drops as you fix them. Wrongness is enumerated, not discovered.
5. **A mandatory accept-or-fix gate after automation.** "Confirm site model" states a written checklist and offers exactly two buttons: *Fix site model* / *Design solar*.
6. **Publish the failure taxonomy and walk it in order.** Solargraf names "the three main culprits" and stages them: roof lines → pitch/azimuth → internal vertical walls.
7. **Give every auto-derived value a visible tell.** The azimuth arrow points downslope; if it points *at the ridge*, that facet is wrong — visible at a glance, no measuring.
8. **Model by subtraction from an over-complete solid.** N nodes → N pitched faces; you *unpitch* the ones that don't exist. A gable is a hip minus two faces.
9. **Every destructive op needs a named semantic inverse, not just undo.** Unpitch ↔ Make Pitched.
10. **Kind conversion in place beats delete-and-redraw.** pitched↔flat; dormer→roof (which then permits nesting and setbacks).
11. **Overlap *is* the merge gesture.** Drag one section onto another, release — valleys re-solve from relative heights. No boolean UI.
12. **Handles with explicitly different degrees of freedom.** Dormer = anchor + 2-DOF far node + 1-DOF sliding middle node. The constrained handle cannot be misused.
13. **Scope escalation inline at the property** — "Apply To All Edges in Roof" — replaces multi-select for the common case.
14. **An abandoned trace is a persistent, resumable object**, not discarded work.
15. **Edge semantic type is a colour-coded toggle** (white / yellow=azimuth / purple=internal wall).

---

## LEDGER

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | verdict | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3D roof modelling | Aurora | SmartRoof Workshop (93 min) | `6c7eYT49vl0` | n/a (Aurora training) | official (Aurora trainer) | 93 min — full transcript (3,610 lines) + 72 scene frames, 6 read in full | 06:30 90° snap; 07:14–08:16 escape/resume trace; 09:07 node+line drag in edit mode; 09:30–10:18 structure-scope move/rotate/Ctrl+C/V/Delete; 11:48 apply-to-all-faces; 16:30–17:10 plane-projection model; 22:04–22:57 unpitch↔make pitched; 25:17–26:12 delete-and-start-again vs convert; 31:12–32:57 dormer 3-handle recipe; 35:19–35:45 fold purple marker; 48:42–49:18 dormer→roof conversion; 51:03–51:37 drag-to-merge; **66:03–67:42 "I do not recommend clicking and dragging the dotted lines"**; 70:18 drag edge lines; 73:01–73:58 valley re-solves from eave height; 78:38–81:21 diagnose pitch from valley angle | Draw one closed eave ring → tool projects a plane per edge at default 20°/9.8 ft → interior lines appear where planes intersect → correct by editing per-edge pitch & height; folds/dormers inserted from a green "Edit Roof" banner | Interior geometry always re-solves live; three reversal routes (inverse button, Ctrl+Z, Delete); resumable unfinished trace; drag-to-merge with auto-valleys; dormer handles have distinct DOF; apply-to-all-faces checkbox | **Vendor tells users not to use its own direct manipulation** — dragging an eave line changes edge heights unpredictably ("you don't have a lot of control over what changes"). Delete-and-start-again is taught *before* convert. First mis-clicked edge poisons 90° snapping for the whole trace. No self-intersection guard shown | Diagnose visually (valley not 45° ⇒ tilts differ), then type two numbers: pitch, then eave height one at a time | No edge/vertex drag at all; per-face pitch via number box + ± steppers with an eave/ridge anchor | STEAL (solve-for-input), ADAPT (folds, apply-to-all) | HIGH | HIGH | MED | candidates 1,3,4,6 |
| 3D roof modelling | Aurora | SmartRoof Training — Advanced 3D Modeling | `KxoclvoNc8c` | n/a | official (Aurora CS team) | 53 min — full transcript (1,369 lines) + 36 frames, 1 read in full | 04:04–04:28 angle snapping; 16:39–16:46 shift-click group select two faces; 17:01–17:10 pitch nudge by scroll wheel / up-arrow 1° at a time; 19:02 node count = slope count; 19:29–19:57 unpitch, undo, make-pitched, Delete/Backspace; 20:12–20:48 three ways to set eave height | 10 worked residential examples, easy→advanced; each: observe in Map Split, trace, unpitch the faces that don't exist, fix pitch, lift height | Shift-click multi-select then set pitch on both; scroll-wheel 1° nudge; three modalities for eave height with guidance on when to use each; frame confirms an **"Apply To All Edges in Roof"** checkbox and a numerically editable edge Length in the EDGE & FACE inspector | Correcting pitch still means reading a ruler measurement and typing it; no indication of which faces are suspect | Group-select same-pitch faces to avoid repeating the edit | Single scalar `selectedFaceId`; no shift-click, no box select; no apply-to-all | STEAL (multi-select + apply-to-all) | HIGH | HIGH | LOW | candidate 4 |
| 3D roof modelling | Aurora | SmartRoof training — modelling best practices | `oVuMUmybd0s` | n/a | official (Aurora trainer) | 41 min — full transcript (1,038 lines) + 36 frames, 1 read in full | 01:50 90° snap; 08:07–08:48 node count = face count; 12:46 orange dotted alignment lines; 13:33 drag a fold into place; 23:51–24:02 **dormer cursor turns red outside the roof, blue inside**; 24:25 "whiskers" middle handles; 35:22 & 38:44 deliberate overlap ⇒ merge + auto valley; 36:44 click face + Delete; 37:07 white arrow → red on hover → drag eave; 39:03–39:14 **shift-select three faces, one Delete** | Trace → delete/unpitch invented faces → insert folds & dormers → set heights so valleys land correctly | Illegal dormer placement is **prevented at hover time** by a red/blue cursor, not rejected after the click with an error; three wrong faces removed in two actions; valley created by pulling an eave | Overlap-to-merge is undocumented folklore — you must know to deliberately overlap | Draw simple rectangles piece by piece and let them merge, rather than tracing one complex polygon | No multi-select; no merge; self-intersection caught only at finalize, and not at all for standalone traced faces | STEAL (hover-time legality), ADAPT (multi-select delete) | HIGH | HIGH | MED | candidates 2,5 |
| 3D roof modelling | Solargraf | Solargraf 3D Design Tool webinar | `Sd8lBvcmVdc` | n/a | official (Solargraf trainer "Angelica") | 40 min — full transcript (958 lines) + 30 frames, 2 read in full | 09:43 undo/redo/delete/**clear all**/split screen; 11:20–11:38 "checking for false positives or drawing in roof lines that are missing"; 11:52 select tool hotkey **S**; 11:57–12:05 click line → highlights blue → **Delete Roof Edge**; 12:28–12:49 pen tool must start and end on existing topology, Shift = precise; 16:05–17:26 **Fix Site Model**; 16:53–17:18 "Solargraf is going to highlight and illustrate to you that there's parts of this model that are not accurate"; 18:41–18:56 per-facet pitch slider + **Apply New Pitch To All**; 19:26–20:46 azimuth arrow points at the ridge ⇒ facet is wrong; rotate to fix; red count drops; 21:24–22:44 **Verify Walls** — click a roof line to add an internal vertical wall, un-click to remove | Detect roof outline → Render 3D → **Confirm site model** (accept or fix) → Fix Site Model returns to the 2D line graph → fix lines → verify azimuths → verify walls → Render 3D | The whole correction path is a **named, staged wizard** with its own explanatory panel per stage; incorrect facets painted red and burned down; every roof line carries a semantic type as a colour (white / yellow=azimuth / purple=internal wall) toggled by clicking; delete-roof-edge is a first-class named operation | **"Clear all" sits in the toolbar directly beside "delete"** — redo-everything is a peer of fix-one-thing; re-render is global, there is no scoped rebuild; correction forces a round trip back to 2D | Mess with it in 2D, re-render, repeat; trainer notes you would not normally re-render between each change | No verification gate, no red/suspect state, no staged triage, no edge type toggle; **but** SolarPro has a scoped `rebuildFromParameters` that Solargraf lacks | STEAL (confirm gate, red ledger, failure taxonomy, edge-type toggle); REJECT (clear-all adjacency) | HIGH | HIGH | LOW–MED | candidates 2,5 |
| 3D roof modelling | Solargraf | Solargraf onboarding / designing walkthrough | `KNMbxIB3X-c` | n/a | operator-led (reseller + Solargraf staff, live Q&A) | 32 min — full transcript (615 lines), keyword-mined | 11:32–11:39 live parallel/perpendicular inference guides while tracing; 12:02–12:10 **correcting a wrong auto-pitch requires going back to 2D**; 14:30–14:46 Ctrl+C / Ctrl+V of obstructions "like a normal text file"; 15:49–16:08 building height from ground, numeric; 15:22 LiDAR unavailable outside the US ⇒ everything is manual | Real reseller session in India with no LiDAR — the full manual path | Copy/paste of placed objects; live inference guides during the trace | Pitch correction is a mode round trip to 2D; copy/paste demonstrated only for obstructions, never for roof geometry | Accept the 2D round trip | Ctrl+D duplicates obstructions only; no clipboard, no geometry copy/paste | BACKLOG (geometry clipboard) | MED | MED | MED | backlog |
| 3D roof modelling | Solargraf | long-form Solargraf session | `d_AVB0T2WTU` | n/a | unknown | **0 min — DOWNLOAD FAILED** | — | — | — | — | — | — | n/a | n/a | n/a | n/a | `yt-dlp` exit 1: "This video is not available". Not watched. Recorded as a failed row, not a gap in conclusions |
| 3D roof modelling | OpenSolar | Support docs: "Different Edge Types", "How to design in Manual mode" | `support.opensolar.com/hc/en-us/articles/4406938905113`, `.../13251322728975` | n/a | official | 0 min video — **help centre returned HTTP 403 to WebFetch**; content known only from search-result extracts | — | Place pins on each roof corner → generate structure → **arrow handles** fine-tune dimensions and angles → **Edit Slope Individually** when slopes are inconsistent → classify each edge as gutter / ridge / valley / rake | Edges carry an explicit semantic **type** the user sets, and that typing drives production maths — converges with Solargraf's coloured line types | Unverified beyond search extracts; could not read primary source | — | No edge typing; walls are derived, not declared | ADAPT (edge typing) — **needs first-hand verification** | MED | MED | MED | blocked on 403; would need a logged-in session or a video |
| 3D roof modelling | Aurora | Help Centre: "Design using edit roof mode", "SmartRoof Best Practices" | `help.aurorasolar.com/hc/en-us/articles/21295970356243`, `.../360034501014` | n/a | official | 0 min — **HTTP 403 to WebFetch** | — | — | Search extracts corroborate drag-interior-edges and the edge & face pop-ups seen in video frames | Could not read primary source | — | — | corroborating only | n/a | n/a | n/a | blocked on 403; video evidence substitutes |

---

## THE 90/10 CORRECTION SCORECARD

Actions to fix **one** wrong thing, counted from a selected, already-built model. "Actions" = discrete
clicks/keypresses/drags, excluding camera moves. Lower is better. **✗ = impossible, must redo.**

| Correction task | Aurora SmartRoof | Solargraf | SolarPro today |
|---|---|---|---|
| **Delete one face the detector invented** | **2** — click face, `Delete` (also: sidebar *Unpitch*) | **3** — `S`, click line, *Delete Roof Edge* | **2** — click face, `Delete` / 🗑 button. Tombstoned, fully undoable |
| **Delete three invented faces** | **4** — shift-click ×3, `Delete` once | **9** — three separate cycles | **6** — three separate cycles (no multi-select) |
| **Undo that deletion** | **1** — *Make Pitched*, or `Ctrl+Z`, or re-add | **1** — `Ctrl+Z` | **1** — `Ctrl+Z` (undo also lifts the tombstone) |
| **Correct a wrong pitch on one face** | **3** — click face, click pitch field, scroll/↑ (1°/tick, live) | **3** — `S`, click facet, drag slider | **2–3** — click face, type or ± stepper. **Plus an eave/ridge anchor toggle neither competitor has** |
| **Set that pitch on every face** | **2** — tick *apply to all faces*, type | **2** — *Apply New Pitch To All*, type | **2** — section-wide pitch field (but it silently clears every per-face override) |
| **Correct a wrong azimuth on one facet** | n/a (derived from the edge) | **3** — `S`, click facet, rotate handle; arrow shows the error | **3** — shed sections only, via `shedAzimuthDeg`; no handle, no arrow |
| **Move one misplaced vertex** | **2** — double-click to enter edit mode, drag node | **2** — click point, drag (Shift = precise) | **✗ IMPOSSIBLE.** `VertexHandles.tsx` is written, tested, imported at `SolarEngine3D.tsx:312` and **never mounted** — zero `<VertexHandles` in the repo |
| **Move one eave/edge line 2 ft** | **2** — click edge, type Height/Length in EDGE & FACE. Dragging exists but **the vendor says do not use it** | **1** — left-click-drag the line | **✗ IMPOSSIBLE.** No edge handles. Only whole-section ±1 ft, or a whole-model Square Up / Stitch |
| **Split one face into two** | **2** — pick fold type, click position (then a draggable purple marker) | **3** — pen tool from existing point to existing point | **✗ IMPOSSIBLE.** No split/cut/divide anywhere. `RIDGED_ROOF_NEEDS_FOUR_CORNERS` tells you to re-trace as separate sections |
| **Merge two faces / sections** | **1** — drag one onto the other, release; valleys auto-solve | **3** — delete the roof line between them | **✗ IMPOSSIBLE.** Stitch is vertical-only and never merges faces |
| **Change roof kind without redrawing** | **2** — right-click, *convert pitched↔flat* / *dormer→roof* | n/a | **1** — change `kind` on the section (shed then demands an azimuth) |
| **Rebuild ONE section, keep the rest** | **✗** — delete the structure and redraw | **✗** — Render 3D is global | **1 — `rebuildFromParameters`.** Scoped, face-ids stable so panels survive, its own undo step. **SolarPro wins outright; neither competitor has this** |
| **Refuse to silently destroy hand-reshaped work** | **✗** — no protection | **✗** — no protection | **`SECTION_FACES_RESHAPED`** refusal blocks the edit until you explicitly rebuild. **SolarPro wins outright** |
| **Catch a self-intersecting (bow-tie) trace** | **✗** — none observed | **✗** — none observed | **Partial win** — full O(n²) `segmentsCross` at section build. **But** standalone `mark_plane`/`plane3d` faces skip it entirely, and nothing checks during the trace |
| **Know which faces are probably wrong** | **✗** — you must eyeball valley angles | **Red facets + a count you burn down** | **✗** — nothing marks suspect geometry |
| **Gate before proceeding on a bad model** | **✗** | **"Confirm site model": Fix site model / Design solar** | **✗** |

**Where the competitors also fail the test** (leapfrog room):
- Aurora's direct manipulation of the single most common correction is so unpredictable that **the vendor's own trainer instructs users not to use it** (66:46–67:26). Nobody has "drag the line, and the software solves for the input that puts it there".
- Aurora teaches **delete-and-start-again as option 1** for a wrong roof type (25:17), with convert only as option 2.
- Solargraf puts **"clear all" directly beside "delete"** in the toolbar (09:43) — redo-everything is a peer of fix-one-thing, exactly the failure we must not copy.
- Neither product can rebuild one section in place, and neither protects hand edits from being overwritten.

**The honest headline:** SolarPro is at parity or better on *destructive* and *structural* correction
(delete one face, rebuild one section, refuse to clobber hand work, validate geometry) and is at
**zero** on *shape* correction. There is exactly one live geometry drag handle in the entire engine
(block wall height at `SolarEngine3D.tsx:7258–7403`), and it does not even record undo history.

---

## TOP CANDIDATES FOR SOLARPRO

### 1. Mount the vertex handles that are already built
**Build:** `components/3d/editing/VertexHandles.tsx` (318 lines) and `lib/3d/vertexHandlesMath.ts`
(394 lines, unit-tested) are complete, imported at `SolarEngine3D.tsx:312`, and **never rendered**.
Mount it, and extend `VertexTargetType` beyond `block|gable|hip|tree` to cover a `RoofPlane` face,
routing through the already-declared-but-never-called `SectionEdit.footprint` hook at
`lib/3d/sectionEditing.ts:305`.
**Why it beats what we have:** today a misplaced corner cannot be moved at all — the only remedy is
re-tracing the section, which mints new face ids and orphans every panel on it. Both competitors do
this in 2 actions.
**Bounded:** the component, the math and the tests exist. The work is mounting, one new target type,
and one new caller passing `footprint`.
**Proof:** drag a corner 2 ft; the section re-solves; `Ctrl+Z` restores it; panels on the face keep
their `planeId`; a drag that would create a bow-tie is refused with `FOOTPRINT_SELF_INTERSECTING`.

### 2. A red "not yet verified" facet state with a burn-down count
**Build:** surface `validateSection`'s refusals (it already returns *all* of them, not the first) as a
per-face red tint plus a counter, instead of a dismissable toast. Add cheap heuristics as additional
red triggers: mixed pitch within a section, a valley that is not 45° between equal-pitch neighbours,
a face smaller than a panel.
**Why it beats what we have:** SolarPro has the richest refusal vocabulary of the three (18 named
codes) and shows almost none of it. Solargraf's red-facet ledger is the single best idea in this lane.
**Bounded:** rendering plus a counter. No new geometry maths — the validators exist.
**Proof:** the documented bow-tie trace (NW-NE-SW-SE, 12×8 m) paints red before anything else
happens, and the count decrements as each is fixed.

### 3. Make the drag solve for the input (the leapfrog)
**Build:** when a user drags an eave or ridge line, do not move the line. Solve for the pitch (or eave
height, per the active anchor) that puts it where they dropped it, and show the change explicitly:
"pitch 22° → 26°".
**Why it beats what we have:** we have no edge drag at all, and Aurora — the market leader — has one
so unpredictable it tells users to avoid it. This is the clearest available leapfrog in the whole lane,
and it lands directly on SolarPro's existing strength: `PitchAnchor = 'eave' | 'ridge'` already decides
what is held and what moves.
**Bounded:** one gesture, one edge, reusing `previewFacePitch` for the live preview and
`applyFacePitchEdit` for the commit — both already exist with preview/commit separation.
**Proof:** drag the eave line onto the photo's eave; the pitch number changes, the ridge holds, one
undo reverts, and the readout names the input that moved.

### 4. "Apply to all faces in this section" + shift-click multi-select
**Build:** a checkbox inline beside the pitch field in `SectionInspector`, and shift-click accumulation
on face selection.
**Why it beats what we have:** both competitors have the scope-escalation checkbox; SolarPro has the
storage for it (`SectionEdit.facePitchDeg`) and a section-wide path that already clears overrides.
Today a four-face hip needs four separate edits. Selection is a scalar (`selectedFaceId`), so
multi-select is the enabling change for delete-three-faces too.
**Bounded:** one checkbox reusing an existing code path; selection becomes a `Set` the way
`selectedPanelIds` already is for panels.
**Proof:** set one face to 26°, tick the box, all faces read 26°, and a single `Ctrl+Z` reverts all of
them (the `coalesceKey` machinery already supports this).

### 5. Validate during the trace, not at finalize
**Build:** run the existing `segmentsCross` test against the in-progress ring on each mouse-move and
tint the rubber band red; extend it to `mark_plane` / `plane3d`, which today bypass `validateSection`
entirely.
**Why it beats what we have:** Aurora prevents an illegal dormer at *hover* time with a red/blue
cursor rather than erroring after the click. SolarPro catches the bow-tie only at section build, and
for standalone traced faces never — the exact gap the bow-tie comment documents as costing 38% of
roof area with `ok: true`.
**Bounded:** one existing predicate called from the trace loop, plus one colour.
**Proof:** the documented bow-tie goes red before the fourth click lands.

### 6. Insert Fold — the first split operation
**Build:** Aurora's flat fold, restricted to gable sections: one ridge-parallel horizontal cut,
positioned by a draggable marker, turning one face into face + flat top.
**Why it beats what we have:** SolarPro has no split of any kind and actively instructs users to
re-trace L-shapes as separate sections (`RIDGED_ROOF_NEEDS_FOUR_CORNERS`) — which is
"redo everything" as official guidance. Aurora does it in two actions.
**Bounded:** one fold type, one section kind, one degree of freedom. Defer pitched folds, vertical
folds and dormers.
**Proof:** a gable becomes gable + flat top; panels on the untouched face keep their `planeId`;
undo restores the single face.

**Defect found in passing (not a candidate, a bug):** the block wall-height drag
(`SolarEngine3D.tsx:7358 blockResizeUp`) writes `blockHeightOverridesRef` and the Cesium entity
directly and **never calls `recordGeometry`** — the one drag gesture in the product is not undoable,
and its result does not live in `roofPlanes`.

---

## EXIT CRITERIA STATUS

| # | Criterion | Status |
|---|---|---|
| 1 | ≥2 materially relevant products | **MET** — Aurora (3 trainings, 187 min) and Solargraf (2 sessions, 72 min), plus OpenSolar docs as corroboration |
| 2 | ≥1 official/training source | **MET** — all five watched videos are vendor-produced trainings by named trainers |
| 3 | ≥1 real user/operator source | **PARTIALLY MET** — `KNMbxIB3X-c` is a live reseller session with unscripted Q&A and a real no-LiDAR constraint, but it is still vendor-hosted. **No independent user forum, review or complaint thread was obtained.** Searches for practitioner complaints returned only vendor and SEO content, and both help centres returned HTTP 403 |
| 4 | Core workflow end-to-end | **MET** — Aurora traced→corrected→saved across 10+ worked examples; Solargraf detect→render→Confirm→Fix Site Model→verify azimuths→verify walls→re-render, including the trainer deliberately breaking a model to show the repair path |
| 5 | Findings repeating | **MET** — by the third Aurora video the node-count invariant, unpitch-to-subtract, Map Split verification and drag-to-merge were all recurring with nothing new; the last 20 minutes of the workshop added only worked repetitions |
| 6 | Opportunities triaged | **MET** — every ledger row carries a verdict and an RE+ impact rating |
| 7 | SolarPro equivalent audited | **MET** — audited from code across `SolarEngine3D.tsx`, `lib/3d/*` and `lib/design/deletionAuthority.ts`, with file+line citations; the headline finding (VertexHandles built and unmounted) is verified by the absence of any `<VertexHandles` JSX in the repo |
| 8 | Candidates shipped or backlogged | **NOT MET** — six candidates are specified with proof criteria, but **none is shipped or entered in a backlog**. This lane had read-only scope; landing them needs a separate decision |

**Plainly not met:** (8) — nothing shipped or backlogged. **Partially met:** (3) — vendor-adjacent
operator material only; no independent practitioner source was reachable. **Blocked:** Aurora and
OpenSolar help centres both return HTTP 403 to automated fetching, and `d_AVB0T2WTU` is no longer
available on YouTube; OpenSolar's edge-typing finding rests on search extracts and needs first-hand
verification before it is relied on.
