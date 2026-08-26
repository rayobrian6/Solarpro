# Help/Instructions Panel — Design

**Owner:** help-panel agent
**Aurora parity target:** §1 UI Shell — `INSTRUCTIONS` panel in left sidebar
**Reference frame:** `C:\Users\carpe\.mimax-agent\projects\aurora_frames\frame_0070.jpg`
**Status:** Designed → implementing

---

## 1. What Aurora does (parity bar)

In Aurora's left sidebar, under the project / nav items, there is an
`INSTRUCTIONS` section (frame 70, frame 115). The text is **context-aware** —
it changes based on which tool/mode the user is currently in:

| Active mode            | Help text shown                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Site Model (no primitives) | "Draw the roof with a Site Model, then click on this place to add a new system design"       |
| Block                  | "Click the corners of the building footprint. Right-click or press Enter to finish."             |
| Gable                  | "Click the two eave corners. The ridge runs along the long edge."                               |
| Hip                    | "Click the four eave corners in order (counter-clockwise preferred)."                            |
| Tree                   | "Click to place a tree. The tree canopy is shown as a blue preview."                            |
| Wizard step 1 (mark)   | "Click to add vertices. Press Enter to finish, or click the ✓ button."                           |

Visually (frame 70):
- **Position:** bottom of the left sidebar, below the project / nav
- **Header:** small uppercase `INSTRUCTIONS` label, gray, with a `+` expand/collapse affordance on the right
- **Body:** ~2–3 lines of lighter-gray text, plain prose
- **Style:** minimalist, no border, no background — the text just *is* there

## 2. Solarpro reality (today)

We have a `components/3d/SolarEngine3D.tsx` and a typed `PlacementMode`
union with 25+ values. **No help text exists anywhere.** Users have to guess
what each tool does. This is the worst first-impression gap in the app
right now.

## 3. Proposed Solarpro design

### 3.1 Files owned

```
components/3d/help/
  ├─ HelpPanel.tsx          # React component, mounts the panel
  ├─ helpText.ts            # HELP_TEXT_BY_MODE lookup table (single source of truth)
  └─ DESIGN.md              # this doc
tests/
  └─ helpPanel.test.ts      # lookup completeness + mapping tests
```

`components/3d/SolarEngine3D.tsx` is **touched minimally** to import and
mount `<HelpPanel placementMode={placementMode} ... />` in the existing
left sidebar / instructions region.

### 3.2 Lookup table — `HELP_TEXT_BY_MODE`

Single exported constant, a `Record<HelpMode, string>` where `HelpMode` is a
narrow union of the modes that need help text. This is the **single source
of truth** — copywriters can update it without touching the component.

**Coverage rule:** every `PlacementMode` from `SolarEngine3D.tsx` that has a
real user-facing interaction must have an entry. Modes that don't apply
(get stale, internal) get a graceful fallback.

**Covered modes (target):**

| Mode                | Source        | Help text                                                                                |
| ------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `select` (default)  | (default)     | "Click an object to select it. Use shift-click to select multiple."                       |
| `block`             | Aurora parity | "Click the corners of the building footprint. Right-click or press Enter to finish."      |
| `roof_gable`        | Aurora parity | "Click the two eave corners. The ridge runs along the long edge."                        |
| `roof_hip`          | Aurora parity | "Click the four eave corners in order (counter-clockwise preferred)."                     |
| `tree`              | Aurora parity | "Click to place a tree. The tree canopy is shown as a blue preview."                      |
| `obstruction`       | (Solarpro)    | "Click to place an obstruction (chimney, vent, dormer). Right-click to cancel."           |
| `roof`              | (Solarpro)    | "Click roof vertices to outline a roof face. Right-click or Enter to finish."             |
| `plane3d`           | (Solarpro)    | "Click to mark roof edges. Right-click to finalize the plane."                            |
| `mark_plane`        | (Solarpro)    | "Click to add vertices. Press Enter to finish, or click the ✓ button."                    |
| `wizard_mark`       | Aurora parity | "Click to add vertices. Press Enter to finish, or click the ✓ button."                    |
| `wizard_analyze`    | Aurora parity | "Click any yellow arrow to flip its ridge direction if it looks wrong."                  |
| `wizard_adjust`     | Aurora parity | "Drag the white handles to fine-tune vertex positions in 3D."                             |
| `auto_roof`         | (Solarpro)    | "Click a roof face to auto-fill it with panels using the selected layout."                |
| `ground`            | (Solarpro)    | "Click along the ground to set the array boundary. Right-click to finish."                |
| `ground_array`      | (Solarpro)    | "Click to add array rows. The engine spaces them to avoid inter-row shading."             |
| `fence`             | (Solarpro)    | "Click along the fence line to set section breaks. Right-click to finish."                |
| `measure`           | (Solarpro)    | "Click two points to measure distance. Press Esc to clear."                              |
| `ruler`             | (Solarpro)    | "Drag the ruler to reposition. Press R to rotate 90°."                                    |
| `pick_house`        | (Solarpro)    | "Click the building you want to design for. We'll crop to that footprint."                |
| `surface_select`    | (Solarpro)    | "Click a roof surface to select it for editing."                                          |
| `set_direction`     | (Solarpro)    | "Drag the arrow to set the panel array direction (azimuth)."                              |
| `set_origin`        | (Solarpro)    | "Click the point where the array should start."                                           |
| `design_auto`       | (Solarpro)    | "Click anywhere on the roof to auto-place panels with the optimal layout."                |
| `design_panels`     | (Solarpro)    | "Click to manually place a panel. Right-click to cancel."                                 |
| `design_inverter`   | (Solarpro)    | "Click to place an inverter near the array. Right-click to cancel."                       |
| `design_bos`        | (Solarpro)    | "Click to place a BOS component (combiner, disconnect). Right-click to cancel."           |
| `design_string`     | (Solarpro)    | "Click panels in order to group them into a string. Press Enter to finish."               |
| `design_connect`    | (Solarpro)    | "Click panels to wire them to the inverter. Press Enter to finish."                       |
| `design_walkway`    | (Solarpro)    | "Click a flat roof face to add a code-required walkway path."                             |
| `design_faceinfo`   | (Solarpro)    | "Hover a roof face to see pitch, azimuth, and usable area."                               |
| `idle`              | Aurora parity | "Draw the roof with a Site Model, then click on this place to add a new system design."   |

**Fallback rule:** `HelpPanel` always has a value. If the active mode isn't in
the table (e.g. an internal mode), it shows a generic "Pick a tool from the
sidebar to begin" message. No `undefined` leaks.

### 3.3 Component contract

```ts
type HelpMode = keyof typeof HELP_TEXT_BY_MODE;

interface HelpPanelProps {
  /** Active mode from SolarEngine3D's PlacementMode union. */
  placementMode: string;
  /** Optional count-state suffix to enrich the text (e.g. "3 vertices placed"). */
  context?: { pointsPlaced?: number; selectedCount?: number; ... };
  /** When true (default), the panel renders the header + body. */
  showHeader?: boolean;
  /** When true, the panel starts collapsed — user clicks '+' to expand. */
  defaultCollapsed?: boolean;
  /** Optional className for the wrapping div (left sidebar slot). */
  className?: string;
}
```

### 3.4 Visual layout (Aurora-aligned)

A single `<div>` styled to match Aurora's left-sidebar treatment:
- Width: 100% of the left sidebar (panel-agnostic)
- Header: 10px uppercase `#6b7280` text "INSTRUCTIONS", letter-spacing 1.5px
- `+` / `–` toggle on the right; clicking collapses body to a single 1-line
  summary, expands back to full
- Body: 12px `#9ca3af` text, line-height 1.4, max 3 short sentences
- No background, no border (matches Aurora exactly)

### 3.5 Accessibility

- `<button aria-expanded={collapsed}>` for the header toggle
- `aria-live="polite"` on the body so screen readers re-announce when the
  mode changes
- Color contrast: body text `#9ca3af` on the dark sidebar background passes
  WCAG AA (4.5:1+)

### 3.6 Out of scope (intentionally)

- **Wizard stepper bar** at the top of the canvas — that's a separate epic
  (3-step Roof Wizard). The help panel just *describes* what step 1/2/3 do.
- **LiDAR / properties panels** — different surface, owned by other agents.
- **Right-side design tools** — the design-panel agent owns those.
- **Bottom-right status bar** — separate component.

## 4. Acceptance criteria (gauntlet slice)

- [ ] `HELP_TEXT_BY_MODE` exports at least the 5+ Aurora-parity modes
      (block, gable, hip, tree, wizard) + every real `PlacementMode` from
      `SolarEngine3D.tsx`
- [ ] `HelpPanel` renders the active mode's text
- [ ] `HelpPanel` always renders a fallback when mode is unknown — never
      blank
- [ ] `HelpPanel` collapse/expand works (button toggles aria-expanded +
      body visibility)
- [ ] `tsc --noEmit` clean on the slice
- [ ] `next lint` clean on the slice
- [ ] `vitest run tests/helpPanel.test.ts` ≥ 8 tests pass:
      - lookup has all required keys
      - mapping is correct for the 5 Aurora modes
      - fallback works for unknown mode
      - collapse toggle works
      - aria-live present
      - non-empty for every known mode
      - no `TODO` / `TBD` in any help text (Aurora polish bar)

## 5. Risk

- **Low.** Pure presentation. No state mutation, no Cesium/Three.js, no
  new types. The only integration risk is the placement of the import in
  `SolarEngine3D.tsx` — keep that touch minimal.
