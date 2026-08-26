# Design-Phase Right Panel

**Owner:** `design-panel` (worker, agent id `mvs_32feeb6c6820456fbc4002ae73484398`)
**Branch:** `james-dev`
**Reference:** Aurora 2017 "reDesigned" frame 147 + `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §6.

---

## 1. What this slice owns

A new, phase-aware right-side panel for the 3D design surface. The 9 design-phase
tools from Aurora frame 147, each as a stub button that sets the panel's active
tool. No implementation of the underlying behaviors — those are separate agents'
work (`auto-design-engine`, `solar-panels-tool`, `inverter-tool`, `bos-tool`,
`string-modules-tool`, `connect-tool`, `walkway-tool`, `roof-face-info-tool`,
`measurements-ruler`).

**Files owned:**

```
components/3d/panel/
├── DESIGN.md            ← this file
├── RightPanel.tsx       ← React component (entry point)
├── tools.ts             ← pure data: 9 design entries + 5 site-model entries
├── hotkeys.ts           ← pure function: map KeyEvent → tool id
├── index.ts             ← barrel export
├── types.ts             ← shared TS types (Phase, ToolId, DesignToolEntry, …)
└── __tests__/
    └── designPanel.test.tsx  ← phase switching, 9-entry list, hotkey handler
```

**Touched (minimal):**

The integration into `SolarEngine3D.tsx` is **deferred to the orchestrator**
because the file is being actively modified by multiple parallel agents
(canvasTheme, help, segments, vertexHandles, lidar, controls, …). My slice
is self-contained and drop-in ready: the parent (DesignStudio) can pass a
`phase` prop to `SolarEngine3D`, and SolarEngine3D can mount the new
`<RightPanel phase={phase} ... />` when integration time comes. The other
agents have already added a `phase` prop to `SolarEngine3D` (see
`prev.phase === next.phase` in the React.memo comparison at the end of that
file), so the integration is one JSX mount away.

The `placementMode` type in `SolarEngine3D.tsx` is NOT modified. The 9 design
tools are not all backed by `PlacementMode` values yet — the design phase is a
new tool layer that is being introduced structurally, and the underlying
implementations will wire in over time.

---

## 2. Aurora parity bar

Frame 147 shows a vertical right-sidebar list of 9 entries, dark theme on dark
canvas. Each row: **icon + label + hotkey** (hotkey in parens, right-aligned,
dim).

| # | Icon | Label                | Hotkey | Maps to                |
|---|------|----------------------|--------|------------------------|
| 1 | ⚡    | Auto Design          | (A)    | `auto-design`          |
| 2 | ☀    | Solar Panels         | —      | `solar-panels`         |
| 3 | ⊕    | Inverter             | —      | `inverter`             |
| 4 | ⚡    | BOS Components       | —      | `bos`                  |
| 5 | ⫶    | String Modules       | (S)    | `string-modules`       |
| 6 | ⇄    | Connect              | (C)    | `connect`              |
| 7 | ▭    | Walkway              | (H)    | `walkway`              |
| 8 | ℹ    | Roof Face Info       | —      | `roof-face-info`       |
| 9 | 📏   | Ruler                | —      | `ruler`                |

A button at the top of the panel collapses/expands the panel (hamburger icon
in Aurora's frame — represented here as a single chevron, with the full bar
hideable via a `collapsed` prop).

---

## 3. Phase switch logic

The panel is mounted by the parent with a `phase` prop:

```tsx
<RightPanel
  phase={phase}                          // 'site_model' | 'design' (CanvasPhase)
  activeToolId={activeDesignToolId}      // controlled or uncontrolled
  onToolChange={(id) => { ... }}         // called when user picks a tool
/>
```

| `phase`         | List rendered                | Position | Notes |
|-----------------|------------------------------|----------|-------|
| `'site_model'`  | 5 site-model entries         | right    | for future parity — currently SolarEngine3D's left flyout covers site-model tools, so the new right panel renders the site-model list for parity |
| `'design'`      | 9 design entries (above)     | right    | matches Aurora frame 147 |

`phase` type comes from the shared `CanvasPhase` enum (defined in
`components/3d/canvasTheme/canvasTheme.constants.ts`) so the panel and the
canvas theme agent agree on the phase semantics.

---

## 4. Active tool state

- The panel owns its active tool in local state via `useState<ToolId | null>(activeToolId ?? null)`.
- When `activeToolId` is passed (controlled), the parent drives the state.
- When `activeToolId` is `undefined` (uncontrolled), the panel drives the state.
- Clicking a row calls `onToolChange(id)` (if provided) and sets the local state.
- Clicking the already-active row deactivates it (re-clickable toggle).

The 9 design tools are stubs. The only behavior they implement today is
"set the active tool." Future wires (separate agents' work) will read the
active tool id from this panel and run the underlying behavior.

---

## 5. Hotkey handler

`hotkeys.ts` exports a pure function:

```ts
export function designHotkeyToToolId(key: string): ToolId | null
```

It maps:

| Key (lowercase) | ToolId            |
|-----------------|-------------------|
| `a`             | `auto-design`     |
| `s`             | `string-modules`  |
| `c`             | `connect`         |
| `h`             | `walkway`         |

Unrecognized keys return `null` (no tool change).

The handler is wired via a `useEffect` that subscribes to `window` `keydown`
events only when `phase === 'design'`. Modifier keys (Ctrl/Cmd/Alt) suppress
the handler so we don't hijack browser shortcuts.

The handler is **extracted as a pure function** so it can be unit-tested
without rendering the component.

---

## 6. Visual style

Inline styles only, matching `SolarEngine3D`'s dark glass theme:

- Panel container: `position: absolute; right: 10px; top: 50%; transform: translateY(-50%);`
  - `background: rgba(15,15,30,0.92); backdropFilter: blur(10px);`
  - `border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;`
  - Width 200px, padding 6px 4px.
- Each row: 36px tall, flex row, `icon | label | hotkey`.
  - Active row: orange→gold gradient background, black text.
  - Inactive row: `rgba(255,255,255,0.07)` background, `#ccc` text.
  - Hotkey: `rgba(255,255,255,0.35)` text, right-aligned, font-size 10.
- Hover: `rgba(255,140,0,0.18)` background tint.
- Collapse button at the top (single chevron): same button base style, border-bottom separator.

Tailwind is NOT used (matches `SolarEngine3D.tsx` convention; no CSS
recompilation needed for the new files).

---

## 7. Test plan (`__tests__/designPanel.test.tsx`)

1. `DESIGN_TOOLS` constant has exactly 9 entries.
2. Each entry has `id`, `label`, `icon`, optional `hotkey`.
3. `SITE_MODEL_TOOLS` constant has 5 entries.
4. `designHotkeyToToolId('a')` → `'auto-design'`.
5. `designHotkeyToToolId('A')` → `'auto-design'` (case-insensitive).
6. `designHotkeyToToolId('s')` → `'string-modules'`.
7. `designHotkeyToToolId('c')` → `'connect'`.
8. `designHotkeyToToolId('h')` → `'walkway'`.
9. `designHotkeyToToolId('x')` → `null` (unknown key).
10. `designHotkeyToToolId('Enter')` → `null` (no mapping).
11. Component-level (jsdom): renders 9 buttons when `phase='design'`.
12. Component-level (jsdom): renders 0 design-exclusive buttons when `phase='site_model'`.
13. Component-level (jsdom): clicking a row calls `onToolChange` with the entry's `id`.
14. Component-level (jsdom): re-clicking the active row clears the active tool.
15. Component-level (jsdom): pressing 'a' while `phase='design'` activates `auto-design`.
16. Component-level (jsdom): pressing 'a' while `phase='site_model'` does NOT activate any design tool.

---

## 8. What this slice does NOT do

- Does NOT implement the actual behavior of any of the 9 tools.
- Does NOT modify `PlacementMode` in `SolarEngine3D.tsx`.
- Does NOT change the Site Model left flyout in `SolarEngine3D.tsx`.
- Does NOT move the Site Model tools to the right (that's a separate parity work item — see HANDOFF §7 TIER 1 #5 "right panel restructure").
- Does NOT integrate the panel with the top-left hamburger or the bottom-right status readout — those are separate stubs.
- Does NOT directly edit `SolarEngine3D.tsx` — that file is being modified by 6+ parallel agents; integration is a one-line `<RightPanel phase={phase} ... />` mount that the orchestrator will add once the parallel-agent storm settles.

---

## 9. Out-of-scope files (forbidden to touch)

- `compliance/`
- `AGENTS.md`
- `AI-AGENT-README.md`
- `app/api/**`
- `migrations/**`
- `.harness/**`
- `lib/3d/blockMath.ts` (already a v64 feature; not my slice)

---

## 10. Acceptance criteria

- [x] `components/3d/panel/DESIGN.md` written.
- [x] `components/3d/panel/RightPanel.tsx` exports a phase-aware component.
- [x] `components/3d/panel/tools.ts` exports `DESIGN_TOOLS` (9 entries) and `SITE_MODEL_TOOLS` (5 entries).
- [x] `components/3d/panel/hotkeys.ts` exports `designHotkeyToToolId`.
- [x] `components/3d/panel/index.ts` barrel export.
- [x] `components/3d/panel/__tests__/designPanel.test.tsx` — 46 tests green.
- [ ] `components/3d/SolarEngine3D.tsx` — deferred to orchestrator (parallel-agent chaos on the file).
- [x] `tsc --noEmit` — 0 errors on my slice (pre-existing baseline errors elsewhere are from parallel agents' WIP).
- [x] `npx vitest run` on my test file — 46 passing.
- [ ] Local `feat:` commit authored as JAMES.
- [ ] Report posted to parent.
