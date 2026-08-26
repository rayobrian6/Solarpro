# Create Design Modal — Design

> **Owner:** `create-design-modal` agent
> **Status:** design → implementation
> **Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §5
> **Aurora frames studied:** `frame_0143.jpg`, `frame_0145.jpg`

---

## 1. Aurora parity — what we're matching

When the user clicks the green checkmark / Save on a Site Model, Aurora
shows a centered modal overlay with two fields, Cancel + Create buttons,
and a dimmed backdrop. The Create gesture turns the project into a
**Design entity** (a project can have N designs, each with its own
`$/W` cost used for ROI). After Create, the canvas switches to Design
phase.

| Aurora element                              | Matched by                                                                                          | Notes |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| Centered overlay over the 3D canvas         | `<CreateDesignModal open onClose onCreate>` mounted at the page level (z-index 9999)                | sits above Cesium |
| Dimmed backdrop with subtle blur            | `position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px)`                | matches `FeedbackModal` convention |
| Modal card: white, rounded, soft shadow     | `background: #fff; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.45)`                      | Aurora frame 143, 145 |
| Modal width                                 | `width: 320px; max-width: calc(100vw - 32px)`                                                        | ~280–320px on Aurora frames |
| Title `Create Design`                       | `<h2>` style: `font-size: 16px; font-weight: 700; color: #1a1a1a; margin: 0 0 16px`                   | centered, dark, bold |
| Form: `Name: [______]`                      | `<label>Name</label><input type="text">` row, label right-aligned, input ~200px wide                 | focus ring on input |
| Form: `Cost $/W: [4.00]`                    | `<label>Cost $/W</label><input type="number" step="0.01" min="0">` row, same layout                 | default `4.00` |
| Cancel link (text-only, neutral)            | `<button>` with `background: transparent; color: #555`                                              | Aurora uses text-link style |
| Create button (green, prominent)            | `<button>` with `background: linear-gradient(135deg,#14b8a6,#0d9488); color: #fff`                  | matches Solarpro's brand teal |
| Backdrop click closes the modal             | backdrop `onClick` calls `onClose`                                                                   | — |
| Esc key closes the modal                   | `useEffect` adds `keydown` listener that calls `onClose` on `Escape`                                 | standard modal UX |
| On Create: builds a Design entity           | `createDesign({...})` writes a `Design` record (id, projectId, name, costPerWatt, createdAt, active) | localStorage stub today; TODO API |
| Default name `Design 1`                     | `suggestDesignName(existingDesigns)` returns `Design ${count+1}`                                     | auto-increment |

**Parity bar target:** ≥ 95% visual match on the modal + 100% on the
`Design 1 / 4.00` default + 100% on the Create→Design-entity flow.

### Explicit non-goals for this slice

- **Design phase right panel** — owned by `design-panel` (different agent).
- **Dark canvas for Design phase** — separate ticket.
- **Multi-step flow** — Aurora's Create Design modal is single-step; we match that.

---

## 2. Data model

```ts
export interface Design {
  id: string;
  projectId: string;
  name: string;
  costPerWatt: number;
  createdAt: string;
  active: boolean;
}

export interface DesignDraft {
  name: string;
  costPerWatt: number;
}
```

### Validation rules

| Field        | Rule                               | Error message                     |
| ------------ | ---------------------------------- | --------------------------------- |
| `name`       | trimmed length ≥ 1, ≤ 80           | "Name is required" / "Name is too long" |
| `costPerWatt`| finite, > 0, ≤ 100                 | "Cost must be greater than 0"     |

---

## 3. Storage (localStorage stub)

```ts
const STORAGE_KEY = 'solarpro.designs.v1';
```

**Why localStorage:** No `/api/designs` endpoint exists in the repo
(verified via grep on `app/api/`). When the API ships, swap the body of
`appendDesign` for a `fetch('/api/designs', { method: 'POST' })` call.
The interface stays identical so the modal and call sites don't change.

**TODO** (left in source):
```ts
// TODO(api): replace with POST /api/designs when the endpoint ships.
```

---

## 4. Components / files

| File | Purpose |
| --- | --- |
| `Design.ts` | Types, validation, storage helpers |
| `CreateDesignModal.tsx` | React component — modal UI, form state, submit handler |
| `index.ts` | Public exports |
| `DESIGN.md` | This file |
| `tests/createDesignModal.test.ts` | Unit tests for pure helpers |
| `tests/createDesignModal.component.test.tsx` | Unit tests for React component |

### Public component contract

```tsx
<CreateDesignModal
  open={boolean}
  onClose={() => void}
  onCreate={(design: Design) => void}
  projectId={string}
  existingDesigns?: Design[]}
/>
```

---

## 5. Visual specs (matches frame 145)

```
┌──────────────────────────────────┐
│            Create Design         │
│   Name:        [Design 1      ]  │
│   Cost $/W:    [4.00          ]  │
│                  [Cancel] [Create]   │
└──────────────────────────────────┘
```

- Backdrop: `position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px)`
- Modal: `position: relative; background: #fff; width: 320px; max-width: calc(100vw - 32px); border-radius: 8px; padding: 20px 24px; box-shadow: 0 12px 40px rgba(0,0,0,0.45)`
- Create button: `background: linear-gradient(135deg, #14b8a6, #0d9488); color: #fff`

---

## 6. Minimal touch to `SolarEngine3D.tsx`

Per agent.md, the modal is triggered from a Save checkmark. The current
`SolarEngine3D.tsx` has per-mode Finish buttons (block / fence / ground
array) but **no project-level Save checkmark**. Adding a new prop
`onCreateDesign?: () => void` and a single floating "Save → Create Design"
button at the top-right of the canvas is the minimum viable trigger.

---

## 7. Testing strategy

`tests/createDesignModal.test.ts` (pure helpers) +
`tests/createDesignModal.component.test.tsx` (React component, jsdom)
cover validation, default values, submit flow, dismiss paths, storage.

---

## 8. Out of scope (deferred to other agents)

- Design phase right panel (`design-panel`)
- Dark canvas for Design phase (separate ticket)
- The actual `/api/designs` endpoint + DB schema (TODO in `appendDesign`)
- Phase switching after Create (parent's responsibility — out of scope)
