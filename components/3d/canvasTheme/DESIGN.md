# Dark Canvas Theme — Design

> **Owner:** `dark-canvas` agent
> **Status:** design → implementation
> **Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §6 ("Design Phase — dark theme with grid (visually distinct from the light satellite Site Model view)")
> **Aurora frame studied:** `aurora_frames/frame_0147.jpg`

---

## 1. Aurora parity — what we're matching

Frame 147 of the Aurora 2017 "reDesigned" capture shows the canvas *after* the
user clicks Save on a Site Model and the project transitions into Design phase.
Two things change visually:

1. **Background flips from light satellite to dark navy** with a subtle white
   grid overlay. The dark color matches a deep inkwell tone — close to
   `#1a1a2e`.
2. **The grid is two-tiered** — fine ~10px subdivision + a brighter ~50px major
   grid. The lines are low-opacity white (`rgba(255,255,255,~0.04–0.10)`),
   just enough to read the structure but not so loud they compete with the
   building outlines drawn on top.

The Site Model view (frames 115, 130, 140, 142) keeps the full Google
satellite imagery — no dark overlay, no grid. The transition is the visual
cue that the project has moved from "drawing the roof" to "designing the
system".

| Aurora element                       | Matched by (this slice)                                    | Owned by     |
| ------------------------------------ | ---------------------------------------------------------- | ------------ |
| Dark navy background                 | `DARK_THEME.background = rgba(26, 26, 46, 0.75)`           | **dark-canvas** (this agent) |
| 50px major grid + 10px minor grid    | `DARK_THEME.gridBackgroundImage` (stacked linear-gradients) | **dark-canvas** (this agent) |
| Phase switch (Site Model ↔ Design)   | `phase: 'site_model' \| 'design'` prop + `CanvasTheme` component | **dark-canvas** (this agent) |
| Imagery fading in Design phase       | map-sources will dim Cesium globe/imagery via a `data-canvas-phase` attribute this agent exposes | **map-sources** (not this agent) |
| Building outlines / trees visible on dark canvas | Cesium scene rendering; map-sources' imagery dim makes this work | **map-sources** (not this agent) |
| Right-side design toolset            | already exists in `DesignStudio.tsx`                       | **design-panel** (not this agent) |

**Parity bar target:** ≥ 80% match on the *theme + grid + phase switch*
specifically. The imagery dimming and entity-visibility trade-off are
**explicitly** owned by the `map-sources` agent and are out of scope for this
slice. The hook (`data-canvas-phase` attribute on the overlay div) is in
place so `map-sources` can read the phase without coupling to this agent's
internal state.

---

## 2. Visual spec

### 2.1 Dark theme palette

| Token                      | Value                          | Source |
| -------------------------- | ------------------------------ | ------ |
| `background`               | `rgba(26, 26, 46, 0.75)`       | `#1a1a2e` per agent.md + 75% alpha so Cesium entities stay readable |
| `grid-major-line`          | `rgba(255, 255, 255, 0.10)`    | Aurora frame 147 — visible but quiet |
| `grid-minor-line`          | `rgba(255, 255, 255, 0.04)`    | Same — subdivision of the major grid |
| `grid-major-spacing`       | `50px`                         | agent.md says "maybe 50px" — confirmed by frame 147 |
| `grid-minor-spacing`       | `10px`                         | 5 subdivisions per major cell |
| `z-index` (above Cesium)   | `5`                            | sits above the Cesium canvas but below the legend / wizard overlays (which are at z-index 20 / unset) |
| `pointer-events`           | `none`                         | must not block Cesium pick events |

### 2.2 Light theme (Site Model — no overlay)

| Token                | Value         |
| -------------------- | ------------- |
| `background`         | `transparent`  |
| `gridBackgroundImage`| `none`         |

The `CanvasTheme` component **returns `null`** in Site Model phase. The
Cesium globe + Google satellite imagery show through unchanged.

### 2.3 Phase → theme mapping

```ts
phase = 'site_model' → LIGHT_THEME (no overlay rendered)
phase = 'design'      → DARK_THEME  (dark + grid overlay rendered)
```

`CanvasPhase = 'site_model' | 'design'` — both are required. The
`CANVAS_PHASES` tuple is exported for runtime validation (e.g. zod schema
boundary checks in `DesignStudio`).

### 2.4 CSS class

Each theme has a class name so the styles can be overridden by a parent
stylesheet if needed (e.g. for a storybook canvas):

| Phase       | Class                          |
| ----------- | ------------------------------ |
| `site_model`| `solarpro-canvas--site-model`  |
| `design`    | `solarpro-canvas--design`      |

The class is applied alongside the inline style. The inline style is the
source of truth for the values; the class is a stable hook for downstream
agents (notably `map-sources`) and for E2E selectors.

---

## 3. Architecture & ownership

```
components/3d/
├── SolarEngine3D.tsx          ← touched minimally: +phase prop, +<CanvasTheme/>, +memo line
├── canvasTheme/               ← owned by this agent
│   ├── DESIGN.md              ← (this file)
│   ├── canvasTheme.constants.ts  ← pure: palette, grid, phase→theme map
│   ├── CanvasTheme.tsx        ← thin React wrapper, renders the overlay div
│   └── index.ts               ← barrel export
└── ...
```

### 3.1 `canvasTheme.constants.ts` — the testable surface

Pure data + pure functions. No React, no DOM, no Cesium. The unit tests
import from this file and verify:

- The palette values match the spec
- The grid CSS is a valid `linear-gradient(...)` background-image
- The major/minor grid spacing is 50px / 10px
- `getThemeForPhase('design')` returns the dark theme
- `getThemeForPhase('site_model')` returns the light theme
- `shouldRenderOverlay('design')` is `true` (and `false` for `'site_model'`)
- `phaseToThemeClass` returns the expected class names
- `CANVAS_PHASES` is a non-empty tuple with both phases

### 3.2 `CanvasTheme.tsx` — the React component

Thin wrapper. Reads `phase` from props, looks up the theme from the
constants, returns either `null` (site_model) or a single `<div>` overlay
(design). No state, no effects, no hooks. The grid is rendered as a CSS
`background-image` (stacked linear-gradients) per the agent.md suggestion.

The component also sets `data-canvas-phase={phase}` on the overlay div.
This is the integration hook for the `map-sources` agent — they can attach
a `MutationObserver` or a CSS attribute selector to dim the Cesium imagery
when the phase flips to `'design'`, without this agent having to know
anything about Cesium.

### 3.3 `SolarEngine3D.tsx` — minimal touch

Three additions, all in service of the phase prop:

1. **Import** `CanvasTheme` and `CanvasPhase` from `./canvasTheme`.
2. **Destructured prop** `phase = 'design' as CanvasPhase` — defaults to
   `'design'` because the current call site in `DesignStudio.tsx` always
   renders the 3D viewer once a design exists. When `DesignStudio` grows
   a project→design phase machine, it'll pass `'site_model'` from the
   site-modeling flow and `'design'` from the design flow.
3. **Render** `<CanvasTheme phase={phase} />` inside the outer wrapper
   `<div>`, placed as a sibling of the Cesium container.
4. **Memo comparator** — add `prev.phase === next.phase &&` so the wrapper
   re-renders when the phase flips.

That's the entire touch on `SolarEngine3D.tsx`. No CSS, no inline style
edits, no Cesium scene changes.

---

## 4. Out of scope (handed off to other agents)

- **Cesium imagery dimming in Design phase** — `map-sources` will read the
  `data-canvas-phase` attribute and adjust `imageryLayers` alpha +
  `scene.skyBox.show` accordingly. The visual result of full Aurora parity
  requires this hookup; without it, the satellite imagery is hidden by
  the 75%-alpha dark overlay but the Cesium globe edges may still bleed
  through.
- **Design Studio's right panel** — already exists in `DesignStudio.tsx`,
  not touched here.
- **Bottom-right status readout (Modules / System Size / Impact Price)** —
  owned by the `status` agent (their `components/3d/status/` folder is
  in flight).
- **Bottom-center hint text** — owned by the `status` agent.

---

## 5. Acceptance criteria

This slice is "done" when all of the following are true:

- [x] `CanvasTheme` component renders a dark + grid overlay when
  `phase='design'`
- [x] `CanvasTheme` renders `null` when `phase='site_model'`
- [x] Unit tests cover: the phase → theme mapping, the grid CSS, the
  palette values, the `shouldRenderOverlay` predicate
- [x] `tsc` + `lint` + `vitest run tests/canvasTheme.test.ts` all pass
  (the gauntlet on this slice)
- [x] DESIGN.md (this file) explains the Aurora parity bar, the
  palette, the phase switch, the architecture, and the handoffs
