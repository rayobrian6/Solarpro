# Irradiance Map Toggle — Design

**Feature:** Aurora 2017 reDesigned parity — irradiance map layer toggle
**Reference:** `aurora_frames/frame_0147.jpg` (Design phase canvas, dark grid)
**Spec:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §6 (Tier 3, gap #14)

---

## Aurora parity bar (what we must match)

From frame 147 and the analysis doc:

1. **Top-bar toggle button** with the literal tooltip text `Toggle Irradiance Map (I)`.
2. **(I) hotkey** — pressing `I` (case-insensitive) anywhere on the canvas triggers the same flow as clicking the toggle.
3. **Toast notification** "Irradiance Map was queued" — appears **top-right** of the canvas (not bottom-right like the global Toast), small dark text, auto-dismisses.
4. **Async computation** — the click/hotkey queues an async irradiance calculation. While it runs, the toggle is locked. When the calculation finishes, the overlay appears.
5. **Overlay on roof** — kWh/m²/year color ramp painted over the active roof planes.

Items 1–4 are the **UI/UX layer** owned by this slice. Item 5 (the actual roof color ramp rendering) is a **separate epic** — this slice ships a **placeholder overlay** (a small "Irradiance map ready" badge) that proves the state machine + UX flow end-to-end. The Cesium entity math for the color ramp is a follow-up.

---

## State machine

```
                    ┌──── (re-trigger ignored) ────┐
                    │                                │
                    ▼                                │
                ┌────────┐  tick(0ms)  ┌────────────┐ │ compute_done(2s stub)
                │  IDLE  │ ──────────► │  QUEUED    │ │   ┌──────────────┐
                │        │             │            │ │   ▼              │
                │ no ovl │             │ toast up   │ │ ┌──────────────┐ │
                └────┬───┘             │ toast tick │ │ │  COMPUTING   │◄┘
                     │                 └─────┬──────┘ │ │              │
                     │                       │        │ │ async stub   │
                     │              compute(2s stub) │ │ running      │
                     │                       │        │ └──────┬───────┘
                     │                       ▼        │        │
                     │                 ┌────────────┐ │        │
                     │                 │  COMPUTING │─┘        │
                     │                 │            │          │
                     │                 │ overlay    │          │
                     │                 │ pending   │          │
                     │                 └─────┬──────┘          │
                     │                       │                 │
                     │                       ▼                 │
                     │                ┌────────────┐           │
                     │                │  VISIBLE   │           │
                     │                │            │           │
                     │                │ overlay    │           │
                     │                │ rendered   │           │
                     │                └─────┬──────┘           │
                     │                      │                  │
                     └────────hide──────────┘                  │
                                                             │
            (from QUEUED / COMPUTING — clicking or (I) is a no-op,
             guarded by the `inFlight` flag in the store)
```

### Transitions

| From       | Event                         | To         | Side effect                                         |
| ---------- | ----------------------------- | ---------- | --------------------------------------------------- |
| `idle`     | `toggle()` (click or `I` key) | `queued`   | Push toast, fire `computeIrradiance()` stub         |
| `queued`   | (synchronous microtick)       | `computing`| (state-only)                                        |
| `computing`| `compute_done` (Promise res.) | `visible`  | Render `<IrradianceOverlay>` placeholder            |
| `visible`  | `toggle()` (click or `I` key) | `idle`     | Unmount overlay, clear toast                        |
| `*`        | `toggle()` while in flight    | (no-op)    | Guarded — debounce so spam doesn't queue duplicates |

### Re-trigger guard

The `inFlight` flag (`true` while state is `queued` or `computing`) is what makes the toggle "lock" once a request is queued. The Aurora behavior matches this — there's no way to abort or re-queue; you wait for the result, then toggle off.

---

## Toast queue

The "Irradiance Map was queued" notification is a **separate, single-purpose toast** for the irradiance flow only (not the global Toast system, which is at the bottom-right). It's owned by this slice and lives at the top-right of the canvas.

- **Position:** `fixed` top-right, just below the canvas top bar.
- **Visual:** small dark pill, `text-xs`, `bg-slate-900/90`, soft border.
- **Duration:** 3 seconds (auto-dismiss).
- **Queue:** single-slot — only one irradiance toast at a time. Re-triggering while visible is a no-op.

Why not reuse the global `useToast()`? The global Toast mounts at `bottom-6 right-6`; Aurora shows it at the **top-right** next to the toolbar button. Reusing the global system would force an awkward position override; cleaner to own a tiny local toast that exactly matches the Aurora placement.

---

## (I) hotkey handler

The existing `SolarEngine3D` already has a `keydown` listener bound to `window` (see `setupKeyboardHandler`, line ~6527). Minimal-touch approach: insert one branch into the existing `onKey` closure:

```ts
if ((e.key === 'i' || e.key === 'I') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
  e.preventDefault();
  useIrradianceStore.getState().toggle();
  return;
}
```

Guards:
- **`!e.repeat`** — auto-repeat is ignored (matches the `,` / `.` rotate-array pattern in the same handler).
- **`!e.ctrlKey && !e.metaKey && !e.altKey`** — bare `I` only; `Cmd+I` / `Ctrl+I` (Aurora's macOS "Italic" chord) falls through to the browser.
- **No focus check** — the existing handler doesn't gate on focus, so we don't either. (If the user is typing in an input, `e.key` will be a lowercase `i` and the toggle will fire — but that's the same behavior as Aurora, which is a global hotkey on the canvas surface.)

The toggle function reads from the Zustand store via `getState()` so it doesn't need React in the closure (no stale-state bugs across the keydown listener's lifetime).

---

## Async computation stub

`computeIrradiance()` in `irradianceStore.ts` is a `setTimeout(2000)` that resolves to a placeholder `IrradianceResult` object:

```ts
{
  computedAt: Date.now(),
  annualKwhPerM2: 1500,            // placeholder uniform value
  // Real impl (future epic) will populate a per-vertex grid
}
```

The 2-second delay matches "actually doing work" timing so the toast has time to be visible before the overlay appears. The shape of the result is the contract a future irradiance-engine epic will fulfil.

---

## Overlay (placeholder)

`<IrradianceOverlay />` renders only when `state === 'visible'`:

- A small floating badge in the top-right of the canvas (under the toolbar button), reading **"Irradiance map ready · {N} kWh/m²/yr (avg)"**.
- The actual Cesium entity coloring is owned by the future epic. This badge is the **proof-of-life** for the state machine.

---

## Files in this slice

```
components/3d/irradiance/
├── DESIGN.md                       this file
├── types.ts                        IrradianceState, IrradianceResult, IrradianceToast
├── irradianceStore.ts              Zustand store: state machine + compute stub
├── useIrradianceHotkey.ts          Hook exposing setupHotkey() + status helpers
├── IrradianceToggle.tsx            Toolbar button + tooltip
├── IrradianceToast.tsx             Top-right single-slot toast
├── IrradianceOverlay.tsx           Placeholder overlay when state=visible
└── index.ts                        Barrel export

tests/
└── irradiance.test.ts              Unit tests: state machine, hotkey guard, toast queue
```

### Minimal touch on `components/3d/SolarEngine3D.tsx`

Two surgical edits:
1. Add `import { IrradianceToggle, IrradianceToast, IrradianceOverlay, useIrradianceStore } from './irradiance';` near the top.
2. Mount the three children inside the return `<div>` (top-right anchor) and add the `(I)` branch to the `onKey` closure.

No prop changes, no state changes to the parent.

---

## Out of scope (future epics)

- Actual per-vertex kWh/m²/year computation (Solar API or on-device raytracer).
- Cesium entity overlay rendering the color ramp on the roof.
- Map-style legend (kWh/m²/yr scale, color stops).
- Caching / invalidation when roof geometry changes.
- API integration for real PVGIS / NREL irradiance data.

This slice is the **UI toggle contract** that all of the above will plug into. When the real computation lands, only `computeIrradiance()` in the store needs to swap from the 2s stub to the real call.
