# Aurora 2017 "reDesigned" — Frame-by-Frame Analysis

**Source:** `C:\Users\carpe\Downloads\auroa .mp4` (4:53, 1920×1032, 30fps)
**Frames extracted:** 147 JPGs at 1 frame per 2s → `C:\Users\carpe\.mimax-agent\projects\aurora_frames\`
**Tutor video:** "First Look: Aurora reDesigned" (frames 0–46 are the YouTube playback; frames 50+ are the live app)

> Purpose: set the bar for Solarpro's 3D design surface. The 3D blocks work we
> just pushed (Block / Gable / Hip / Tree + 3D Primitives panel) closes the
> **draw primitives** gap. This doc maps everything else Aurora does that we
> don't, so we can prioritize the next stages.

---

## 1. UI Shell (consistent across all Aurora screens)

### Top bar
```
[aurora logo]  Map   Projects   Database   Help                    Aurora Designer ▼
[New UI Project] [Save] [Undo] [Redo]     [Details ▼] [LiDAR | Street View] [Google ▼]   [Save]
```

### 2D / 3D pill toggle (top-left of canvas)
- Two buttons: `2D` and `3D`. The active one is filled dark.

### Left sidebar
- Project name with avatar (e.g. "Joe Solar")
- Top-level nav:
  - **Consumption** — utility info form (full page replacement)
  - **Site Model** (active during 2D/3D drawing) — this is the canvas view
  - **Design** (active when designing) — sub-items: System Design, Performance, Pricing, Financing, Documents

### Right sidebar — **context-sensitive**
- **Site Model** mode: Draw Roof (K), Draw Tree (T), Add Obstruction, Measurements, Ruler
- **Design** mode: Auto Design (A), Solar Panels, Inverter, BOS Components, String Modules (S), Connect (C), Walkway (H), Roof Face Info, Ruler
- **LiDAR active**: Lift Roofs, Flatten Roofs

### Bottom-left — floating control strip
- Compass / north arrow
- Zoom +/-
- Layer toggle buttons

### Bottom-right (Design mode only)
- Status readout: `Modules: 0`, `System Size (STC): 0 kW`, `Impact Price: $ —`

### Bottom-center toast area
- `LiDAR is running...` (transient)
- `Irradiance Map was queued`
- `Toggle Irradiance Map (I)`

---

## 2. The 3-Step Roof Wizard (frames 80, 95, 100, 110)

This is the single biggest UX pattern Solarpro is missing. When you click **Draw Roof**, a sticky stepper appears at the top of the canvas:

```
[1 Mark roof edges]  [2 Analyze roof structure]  [3 Adjust 3D model]  [×]
                      ^^^^^^
                      (current step is highlighted orange)
```

### Step 1: Mark roof edges
- Click vertices to define the roof outline (polyline of segments)
- Each segment shows: vertex circles at each end, a connecting line, and a **yellow ridge-direction arrow** in the middle of each segment showing the slope's normal direction
- Segments are color-coded: red, yellow, green, blue outlines so you can see which segments belong to the same face
- The bottom edge shows live dimensions in feet (`45ft`, `41.3ft`) as you draw

### Step 2: Analyze roof structure
- Aurora's algorithm proposes which edges are hips/ridges/valleys
- The yellow arrows flip to indicate the inferred direction
- You can click an arrow to flip its direction if the algorithm guessed wrong

### Step 3: Adjust 3D model
- Switches to a 3D perspective view
- Draggable vertex handles on every corner to fine-tune
- Slope arrows become the new 3D roof faces

This wizard is **sticky** — it stays visible across all three steps and the × button cancels the whole flow.

---

## 3. Site Model Mode — 2D Satellite (frame 115)

- Background: high-res Google satellite imagery
- Drawn roof segments float over the imagery with colored outlines
- Each segment has a **yellow ridge-direction arrow** in its middle
- **Tree placement cursor:** a large light-blue circle (~30ft diameter) follows the mouse — gives you a sense of the actual tree footprint before you click
- Right panel tools visible
- `2D` button is active; `3D` available to swap

---

## 4. Site Model Mode — 3D Tilted Aerial (frames 130, 140, 142)

The 3D view is **tilted, not top-down** — like a 45° camera angle. This is a critical UX choice for roof work: you see the slopes, the trees, and the surrounding context all at once.

### 3D scene contents
- **Building walls:** flat white extruded prisms
- **Roof edges:** thick orange outlines (the eaves/hips/ridges are highlighted in orange)
- **Roof surfaces:** dark brown
- **Trees:** solid green spheres on brown trunks (decorative, low-poly, but consistent)
- **Conifer trees** in some scenes: green cone on brown trunk (for variation)
- **Drape:** Google satellite imagery clipped to the building footprint polygon

### LiDAR Properties panel (frames 130, 135)
Floating panel top-left:
```
LiDAR Properties
┌─────────────────────┐
│ Style:    [Mesh ▼]  │   ← Mesh or Point Cloud
│ [✓] Textured        │   ← Toggle satellite texture on elevation
│ X Offset: [-9.7 ft] ↕│
│ Y Offset: [ 1.6 ft] ↕│
│ Z Offset: [ 0   ft] ↕│
└─────────────────────┘
```
The LiDAR mesh shows as a rainbow elevation (blue=low → red=high) draped over the satellite. X/Y/Z offset sliders let you nudge the LiDAR data into alignment with the imagery (registration issue common with USGS LiDAR).

### Right panel (LiDAR active)
- `Lift Roofs` — auto-lift the drawn roof segments up to the LiDAR height
- `Flatten Roofs` — flatten segments to the average height

---

## 5. Create Design Modal (frame 145)

When you click the green checkmark / Save on a Site Model, you get a centered modal:

```
┌──────────────────────────────┐
│       Create Design          │
│                              │
│  Name:     [Design 1      ] │
│  Cost $/W: [4.00          ] │
│                              │
│           [Cancel] [Create]  │
└──────────────────────────────┘
```

This is the **project → design** hierarchy boundary. A project can have N designs. Each design has its own $/W pricing used for ROI calcs.

---

## 6. Design Phase (frame 147) — the main work surface

After Create, the canvas switches to a **dark theme with grid** (visually distinct from the light satellite Site Model view). The same building+trees state carries over, but in dark.

### Right panel — full design toolset
```
⚡ Auto Design         (A)  — auto-place panels on the roof
☀  Solar Panels             — manual panel placement
⊕  Inverter                 — inverter placement
⚡ BOS Components            — balance-of-system
⫶  String Modules      (S)  — group panels into strings
⇄  Connect             (C)  — DC string-to-inverter wiring
▭  Walkway             (H)  — code-required walkways on flat roofs
ℹ  Roof Face Info            — per-face pitch/azimuth/area readout
📏  Ruler                    — measure on canvas
```

### Bottom-right status
```
Modules:         0
System Size (STC): 0 kW
Impact Price:    $ —
```

### Bottom-center hint
> "Add modules and components to your roof from the sidebar, or use Auto Design."

---

## 7. Solarpro Gap Analysis

### ✅ What Solarpro already has (closed this session)

| Aurora feature            | Solarpro equivalent                              | Commit  |
| ------------------------- | ------------------------------------------------ | ------- |
| Draw roof (any polygon)   | `block` (line-trace polygon → 3D prism)          | `f692372c` |
| Gable roof                | `roof_gable` (2 eave corners → 2 sloped faces)   | `fa9b517f` |
| Hip roof                  | `roof_hip` (4 eave corners → 4 sloped faces)      | `d28fcf96` |
| Tree primitive            | `tree` (sphere on cylinder trunk)                | `4ae7439d` |
| Adjust eave height        | Drag handle + 3D Primitives input panel          | `4a6edea5` |
| Roof pitch input          | 3D Primitives input panel slider                 | `4a6edea5` |

### ❌ Gaps — prioritized for next stages

#### TIER 1 — UX parity (1–2 stages each, high impact, low risk)

1. **3-step roof wizard stepper** (Aurora §2)
   - Sticky bar at top of canvas during any roof draw mode
   - 1: Mark edges (current) → 2: Analyze → 3: Adjust
   - Currently Solarpro has single-step (click, click, finalize). The wizard is more guided and forgiving.

2. **Vertex handles for editing drawn blocks/roofs**
   - Currently: draw, then it's frozen. Resize via drag handle on block height only.
   - Aurora: every vertex is a draggable handle. Click vertex → drag → footprint updates in real time.
   - Needs: `Dragger` Cesium primitives or our own polyline drag handler.

3. **Per-segment normal arrows**
   - Yellow arrows showing ridge direction on each segment
   - Cheap to add (`BillboardCollection` with arrow SVG, or simple `polyline` with arrow material)

4. **Segment color coding**
   - Each face of a roof has a different outline color (red/yellow/green/blue)
   - Easy: pass color into PolygonGraphics outline per face

5. **Tilted aerial 3D default view**
   - Currently Solarpro 3D opens close to top-down
   - Aurora uses ~45° tilt. One Cesium camera setup change: `viewer.camera.lookAt(target, heading, pitch=-45°, range=200)`

6. **Tree placement 2D cursor** (large circle preview)
   - Currently single click → 1.8m sphere appears
   - Aurora shows the circle first, sized to the tree's actual canopy radius. Free UX win.

7. **Obstruction primitive**
   - Aurora's "Add Obstruction" tool: chimneys, vents, dormers, etc.
   - Reuses our block primitive with a fixed height, no roof. Trivial.

#### TIER 2 — Major features (1 epic each)

8. **LiDAR data integration**
   - Load `.las` / `.laz` files
   - Render as Mesh or Point Cloud (Cesium has `PointPrimitiveCollection` and `Primitive` mesh)
   - X/Y/Z offset controls
   - Textured vs raw toggle
   - This is the **single biggest visual differentiator** Aurora has. Multi-week build.

9. **Design-phase right panel restructure**
   - Auto Design / Solar Panels / Inverter / BOS / String Modules / Connect / Walkway / Roof Face Info / Ruler
   - Currently Solarpro has a flat `Tools` list. Need to:
     - Add a "Design" mode (separate from Site Model)
     - Add the 9 entries above
     - Many of these are placeholders for future work (panel layout, stringing, inverter selection) but the structure matters

10. **Measurements + Ruler tools**
    - Click two points → distance readout
    - Ruler = draggable, persistent measurement
    - Need a `Measurement` entity layer

#### TIER 3 — Polish (1 session each)

11. **Save / Undo / Redo buttons** in top bar
12. **Lift Roofs / Flatten Roofs** quick actions
13. **Bottom-right status panel** (Module count, System Size, $/W)
14. **Irradiance Map toggle** with toast feedback
15. **Help / Instructions panel** in left sidebar
16. **Consumption profile screen** (full-page form, currently Solarpro has this partially)
17. **Multi-source map toggle** (Details ▼ / LiDAR / Street View / source picker)
18. **Create Design modal** (Name + Cost $/W)
19. **Dark canvas for Design phase** (separate from light Site Model)
20. **Undo/redo state history** (in-memory ring buffer of primitive additions/removals)

---

## 8. Recommended next stage

**The single highest-leverage next stage is TIER 1 items 1–4 + 6** — all doable
in one stage, all pure UX wins, no new data sources:

> **Stage 6: Roof drawing UX overhaul**
> 1. Wizard stepper bar (3 steps) during any roof draw
> 2. Vertex handles for in-place footprint editing
> 3. Per-segment normal arrows (yellow) for ridge direction
> 4. Segment color coding (per-face outline color)
> 5. 2D tree placement preview circle
>
> **Effort:** 1 stage, ~500 LOC, ~30 unit tests for the editor state machine
> **Risk:** Medium — vertex drag math is the trickiest part
> **Impact:** Transforms the 3D experience from "draw and forget" to "iterative design"

After Stage 6, LiDAR (TIER 2 #8) becomes the obvious next epic.

---

## Appendix: Frame index

| Frame | Content |
| ----- | ------- |
| 0–46  | YouTube playback of the tutorial (not Aurora UI) |
| 50    | Consumption Profile page (utility info form) |
| 60    | 2D satellite initial state (no roof yet) |
| 70    | Draw Roof mode with wizard step 1 active |
| 80    | Wizard step 1: marking roof edges, segments visible |
| 90    | Zoomed in on roof edges with vertex circles |
| 95    | Live dimension readout (45ft) |
| 100   | Two roof segments drawn with yellow arrows |
| 110   | Multiple roof segments (red/yellow/green/blue) |
| 115   | Draw Tree mode active (large light blue circle cursor) |
| 120   | Tree placed (small green dot) |
| 125   | 3D view with LiDAR loading ("LiDAR is running..." toast) |
| 130   | LiDAR rainbow elevation mesh + green tree spheres |
| 135   | LiDAR view, different X/Y offset, roofs visible underneath |
| 140   | Clean 3D view: white walls, orange roof edges, brown roof, green tree spheres |
| 142   | Same with conifer tree (cone) on left |
| 145   | Create Design modal (Name + Cost $/W) |
| 147   | Design phase: dark grid canvas, full right panel |

---

**Handoff doc per AGENTS.md §6.** Awaiting ship-it before commit.
