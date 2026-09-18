# Roof Wizard UX — Design

> **Owner:** `roof-wizard` agent
> **Status:** design → implementation
> **Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §2
> **Aurora frames studied:** `frame_0080.jpg`, `frame_0095.jpg`, `frame_0100.jpg`, `frame_0110.jpg`

---

## 1. Aurora parity — what we're matching

A sticky stepper bar pinned to the top-center of the canvas during any
roof-drawing mode. Three numbered cards: `1 Mark roof edges` →
`2 Analyze roof structure` → `3 Adjust 3D model`. The **current** step
card is filled orange (`#ff8c00`–`#ff7e1a` family), inactive cards are
white with dark text. A small circular `×` button sits at the far right
and **cancels the whole flow** (returns to `select` mode). The bar is
visible across all three steps.

| Aurora element | Matched by | Notes |
| --- | --- | --- |
| Sticky top-center position | `<RoofWizard>` with `position: absolute; top: 16px; left: 50%; transform: translateX(-50%)` | inside the canvas-relative wrapper |
| 3 numbered cards | `WizardStep` array rendered as `<button>`s | number in 18px circle, label to the right |
| Active step is orange | filled gradient `linear-gradient(135deg,#ff8c00,#ff7e1a)`, white text, soft shadow | matches Solarpro brand |
| Inactive step is white | `background: #fff`, dark text | matches the Aurora frame |
| Hover affordance | `cursor: pointer` + slight lift on inactive | Aurora shows the cards are clickable |
| `×` cancel button | small circle, rightmost, neutral grey | calls `onCancel` |
| Visible across all 3 steps | `step` is a single piece of wizard state, not per-step UI | — |
| "Stays visible across all 3 steps" | wizard does not auto-hide on step transitions | the user can move back and forth |
| Live dimension readout (`45ft`, `41.3ft`) | **out of scope** for this slice | per agent.md, "vertex handles" + "segment arrows" are owned by other agents |
| Yellow ridge arrows / per-face colors | **out of scope** | same — owned by `vertex-handles` and `segment-arrows` agents |

**Parity bar target:** ≥ 80% visual + behavioral match on the **stepper
shell** specifically. Per-frame Aurora behavior (yellow arrows,
per-face color coding, live dimensions, draggable vertex handles) is
explicitly out of scope for this agent.

---

## 2. State machine

```
                 ┌──────────────────────┐
                 │     idle (hidden)    │◀──── onCancel / mode leaves
                 └──────────┬───────────┘
                            │ enter roof-draw mode
                            ▼
                 ┌──────────────────────┐
        ┌────────│   step 1: mark edges │────────┐
        │        └──────────┬───────────┘        │
   back │                   │ vertexCount≥min   │ cancel
        │                   ▼                    ▼
        │        ┌──────────────────────┐  (returns to idle,
        │        │ step 2: analyze      │   onCancel called)
        │        └──────────┬───────────┘
        │                   │ user clicks "Continue"
        │                   ▼
        │        ┌──────────────────────┐
        └───────▶│  step 3: adjust 3D   │
                 └──────────┬───────────┘
                            │ onCancel
                            ▼
                         (idle)
```

### State shape (pure data, no React, no Cesium)

```ts
type WizardStep = 'mark_edges' | 'analyze_structure' | 'adjust_3d';

type Vertex = { id: string; x: number; y: number };
type Segment = { id: string; a: string; b: string; normalDir: 1 | -1 };

type WizardState = {
  step: WizardStep;
  vertexCount: number;          // mirror of parent's "click count"
  segments: Segment[];          // proposed hips/ridges/valleys after analyze
  history: WizardState[];       // for back-navigation
  cancelled: boolean;
};
```

### Events

```ts
type WizardEvent =
  | { type: 'ENTER'; mode: RoofDrawMode }
  | { type: 'VERTEX_ADDED' }
  | { type: 'VERTEX_REMOVED' }
  | { type: 'CONTINUE' }                    // step 1 → 2, step 2 → 3
  | { type: 'BACK' }                        // step 2 → 1, step 3 → 2
  | { type: 'CANCEL' };
```

### Per-mode minimums

`minVerticesForStep2` is a function of the draw mode:

| Mode          | Min vertices for step 2 | Notes |
| ------------- | ----------------------- | ----- |
| `block`       | 2 | Solarpro block is 2-click |
| `roof_gable`  | 2 | 2 eave corners |
| `roof_hip`    | 2 | 2 eave corners |
| `roof`        | 3 | legacy polygon (3+ clicks) |

### Transitions

| Current step | Event          | Guard                          | Next step        | Side effects |
| ------------ | -------------- | ------------------------------ | ---------------- | ------------ |
| (any)        | `ENTER`        | mode is a roof-draw mode       | `mark_edges`     | reset vertexCount, history, segments |
| (any)        | `CANCEL`       | always                         | (idle, hide bar) | set `cancelled = true`, call `onCancel` |
| `mark_edges` | `VERTEX_ADDED` | vertexCount < min              | `mark_edges`     | vertexCount++ |
| `mark_edges` | `VERTEX_ADDED` | vertexCount ≥ min              | `mark_edges`     | vertexCount++; **arm** auto-advance |
| `mark_edges` | `CONTINUE`     | always                         | `analyze_structure` | push history |
| `mark_edges` | `BACK`         | history.length > 0             | previous step    | pop history |
| `analyze_structure` | `CONTINUE` | always                    | `adjust_3d`      | push history |
| `analyze_structure` | `BACK`    | always                    | `mark_edges`     | pop history |
| `adjust_3d`  | `BACK`         | always                         | `analyze_structure` | pop history |

The `CONTINUE` button is the explicit user gesture to advance. The
auto-arm is a separate signal: the parent (SolarEngine3D) flips the
auto-advance on when the user has placed enough vertices, the wizard
UI shows a subtle "Continue →" hint. **The wizard never advances
without a user gesture** — this is Aurora's behavior: the user is
always in control of when to leave a step.

---

## 3. Components

| File | Purpose |
| --- | --- |
| `wizardMachine.ts` | Pure reducer: `(state, event) => state`. No React. 100% testable in Vitest. |
| `RoofWizard.tsx` | React component: receives `mode`, `vertexCount`, callbacks. Renders the stepper. Hosts the reducer. |
| `index.ts` | Public exports: `{ RoofWizard, wizardMachine, types }` |
| `DESIGN.md` | This file |
| `../tests/wizard.test.ts` | State machine unit tests (lives in the project-wide `tests/` dir, per agent.md) |

---

## 4. UI anatomy (matches Aurora frame 0080)

```
                  ╔════════════════╗  ╔════════════════╗  ╔════════════════╗   ╭───╮
                  ║  1  Mark roof  ║  ║ 2  Analyze roof║  ║ 3  Adjust 3D   ║   │ × │
                  ║      edges     ║  ║   structure    ║  ║     model      ║   ╰───╯
                  ╚════════════════╝  ╚════════════════╝  ╚════════════════╝
                       ↑ active (orange)
```

- Each step is a rounded white card (24×80 px) with a numbered circle
  (18 px diameter) on the left and a 2-line label on the right.
- Active card: `background: linear-gradient(135deg,#ff8c00,#ff7e1a)`,
  `color: #fff`, `box-shadow: 0 4px 14px rgba(255,140,0,0.35)`.
- Inactive card: `background: #fff`, `color: #1a1a1a`,
  `border: 1px solid rgba(0,0,0,0.06)`, slight `box-shadow`.
- Inactive cards are buttons — click to jump forward (Aurora allows
  revisiting completed steps).
- `×` button: 28 px circle, `background: rgba(0,0,0,0.06)`,
  `color: #555`, hover darkens.
- Sticky position: `position: absolute; top: 16px; left: 50%;
  transform: translateX(-50%); z-index: 50`.
- Cards are 10 px apart. Total bar width ~600 px. Hides itself
  gracefully on narrow viewports (flex-wrap).

### Per-step "Continue" affordance

Each step card shows a small `→` chevron at the right edge when the
user **can** advance from that step:

- Step 1: `→` appears when `vertexCount >= minVerticesForStep2(mode)`.
- Step 2: `→` always visible (the user is the one who decides to
  accept the analysis).
- Step 3: no `→` — terminal step until the user clicks `×` to finish.

Clicking the active card while the `→` is shown is equivalent to
`CONTINUE`. This matches Aurora's "click the card to advance" feel.

---

## 5. Integration with SolarEngine3D

The wizard is mounted as a **single import + single JSX line** in
`SolarEngine3D.tsx`, inside the existing canvas-relative wrapper
(line 9250) just after the cesium div. The wizard reads:

- `placementMode` (already a prop) — to know if a roof-draw mode is active
- `blockPtCount`, `gablePtCount`, `hipPtCount` (already state) — to
  compute `vertexCount` for the current mode

And calls back:

- `onPlacementModeChange('select')` — when the user clicks `×` or
  finishes step 3

The wizard does **not** own the drawing, the vertex handles, the
arrows, or the colors. It is a UX shell, not a controller. The actual
geometry pipeline is untouched.

---

## 6. Testing strategy

`tests/wizard.test.ts` covers the state machine end-to-end:

1. `ENTER` from idle → state is `mark_edges`, vertexCount 0.
2. `ENTER` with a non-roof mode → state stays `idle`.
3. `VERTEX_ADDED` increments counter up to `minVertices`.
4. `CONTINUE` from step 1 → step 2; vertexCount preserved.
5. `BACK` from step 2 → step 1.
6. `CONTINUE` from step 2 → step 3.
7. `CANCEL` from any step → cancelled=true, step resets to `idle`.
8. `BACK` from step 1 with empty history is a no-op.
9. `VERTEX_REMOVED` decrements (for undo).
10. Per-mode min vertex check (`block`=2, `gable`=2, `hip`=2, `roof`=3).
11. Re-entering after cancel resets state cleanly.
12. History snapshot is restored on `BACK`.

Vitest is already wired (`vitest.config.ts`, `npm test`). No new
deps needed.

---

## 7. Out of scope (deferred to other agents)

Per agent.md **Don't own** list:

- Vertex handles (drag to reshape) — `vertex-handles` agent
- Segment arrows (yellow ridge direction) — `vertex-handles` / `segment-arrows`
- Per-face segment colors — `vertex-handles`
- Tree placement 2D cursor — separate ticket
- Obstruction primitive — separate ticket

The wizard is the **shell**. The drawing mechanics remain in
SolarEngine3D and other agents' components.
