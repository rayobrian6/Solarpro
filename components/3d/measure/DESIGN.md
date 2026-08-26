# Measurements + Ruler — Design

**Author:** measurements-ruler agent (JAMES) · **Cycle:** 2026-08-26
**Owns:** `components/3d/measure/` (new) · `lib/3d/measureMath.ts` (new) · `tests/measurements.test.ts` (new)
**Touches:** `components/3d/SolarEngine3D.tsx` (mount + tool wiring only)

---

## 1. Aurora parity bar

Reading from `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §1 (right panel) and frame references:

| Aurora                          | Solarpro target                                                                |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Frame 70: `Measurements` button | `Measurements` entry in the floating right tools spine (Tools group)           |
| Frame 147: `Ruler` button       | `Ruler` entry in the same tools spine                                          |
| Click two points → distance     | Click A → click B → polyline A→B, label at midpoint, units in **feet**         |
| Multiple measurements coexist   | Each pair persists as its own entity; new pair does **not** clear older        |
| Esc cancels                     | Esc clears the in-progress pair (older measurements remain)                    |
| Ruler: click+drag               | Click sets anchor, drag updates live line, release commits. Persists on canvas |
| Both modes in both phases       | Tool lives in the global `PlacementMode`; no Site-Model/Design gating          |

Aurora's panel label for the readout in the frame is just the distance value (e.g. `45ft`, `41.3ft`) — feet with one decimal under 10ft, integer above. We mirror that.

---

## 2. State model

A **measurement** is an immutable pair of points plus a derived distance. The list of measurements is the canonical state for the Measurement tool:

```ts
type LngLatH = { lat: number; lng: number; h: number };
interface Measurement {
  id: string;
  a: LngLatH;
  b: LngLatH;
  horizDistM: number;
  slopeDistM: number;
}
```

The **Ruler** is a *single* persistent measurement with the same shape — its only difference is that one endpoint follows the live cursor while the mouse is held down.

Two parallel refs in `SolarEngine3D.tsx`:

- `measurementsRef: useRef<Measurement[]>` — the **committed** measurements list
- `rulerRef: useRef<Measurement | null>` — the live or committed ruler

The existing `measurePtsRef` (the in-progress pair) and `measureOverlayRef` (all entities) stay — they're reused to track the in-progress pair only; on pair completion we transfer its entities into a `Measurement` record and clear the in-progress state.

---

## 3. Distance math (`lib/3d/measureMath.ts`)

All pure functions, no Cesium, no DOM, no React. Unit-tested in `tests/measurements.test.ts`.

- `haversineMeters(a, b)` — great-circle distance on WGS84 sphere
- `slopeMeters(a, b)` — Pythagorean slope distance
- `midpoint(a, b, liftM=0.3)` — average + vertical lift
- `metersToFeet(m)` / `formatFeetLabel(m)` — Aurora-style "45'" / "4.5'" formatting
- `formatMeasurementLabel(m)` — composite "12.4'\n(horiz 12.3')" when heights differ
- `buildMeasurement(id, a, b)` — Measurement record from two LngLatH points

**Why no turf.js:** `package.json` has no turf.js dep; adding it for one function is the wrong call. Haversine is 5 lines. If turf.js is later added, swap the implementation behind the same function signature.

---

## 4. Rendering (`components/3d/measure/measurements.tsx`)

- `renderMeasurement(viewer, C, m)` — adds polyline + label to viewer.entities
- `removeMeasurementBundle(viewer, bundle)` — cleans up
- `renderRulerPreview(viewer, C, anchor, cursor, prev)` — replaces live preview polyline during drag

Color: cyan #00ffff, alpha 0.9, line width 2, label background dark navy. Matches the existing single-pair color so the look is consistent.

---

## 5. Wiring into SolarEngine3D.tsx (minimal)

1. **PlacementMode union:** append `'measurements'` and `'ruler'`.
2. **Import** the math + renderers.
3. **Refs:** `measurementsRef`, `rulerRef`, `rulerEntitiesRef`, `rulerPreviewEntityRef`, `rulerAnchorRef`, `rulerCursorRef`, `rulerDraggingRef`.
4. **Handlers:** `handleMeasurementsClick`, `handleRulerDown`, `handleRulerMove`, `handleRulerUp`.
5. **Dispatcher:** `else if (mode === 'measurements')` on LEFT_CLICK; ruler is routed via LEFT_DOWN / MOUSE_MOVE / LEFT_UP (drag semantics).
6. **Tool list:** add `Measurements` (📐) and `Ruler` (📏+🧱) entries in the Tools group.
7. **Right-click:** cancel the in-progress measurements pair (committed measurements persist).
8. **Esc:** cancel in-progress measurements pair; abort in-progress ruler drag (committed ruler persists).
9. **Mode-reset guard:** when leaving these modes, do **not** clear `measurementsRef` or `rulerRef` — they persist across tool switches (matches Aurora).

---

## 6. Unit tests (`tests/measurements.test.ts`)

Mirror the `tests/block3d.test.ts` pattern (no React, no Cesium):

- `haversineMeters` — 0 for identical; DC↔NYC ≈ 333 km; 10° lat ≈ 1111 km; 10 m E/W span
- `slopeMeters` — equals horiz when heights equal; equals |Δh| when collinear; 3-4-5 triangle
- `metersToFeet` — 1 m ≈ 3.281 ft; 100 m ≈ 328.1 ft; 0 m = 0 ft
- `formatFeetLabel` — `45'`, `4.5'`, 2-decimal variant
- `formatMeasurementLabel` — composite only when vert ≥ 0.1 ft
- `buildMeasurement` — id + points preserved; horizDistM ≤ slopeDistM
- `midpoint` — halfway; +0.3 m lift; custom lift override

Target: 24 tests, all green.

---

## 7. Aurora parity checklist

| Behavior                                                | Parity | Notes                                                             |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Measurements button in right panel (frame 70)           | ✅     | New entry in Tools group                                          |
| Ruler button in right panel (frame 147)                 | ✅     | New entry in Tools group                                          |
| Click A → click B draws line + label                    | ✅     | Polyline A→B, label at midpoint, feet                             |
| Label is in feet (decimal under 10ft, integer above)    | ✅     | `formatFeetLabel`                                                 |
| Esc cancels in-progress pair                            | ✅     | Per-keydown handler                                               |
| Right-click cancels in-progress pair                    | ✅     | Right-click handler                                               |
| Multiple measurements coexist                           | ✅     | Each pair → new `Measurement`, no clear on next pair              |
| Ruler: click+drag, entity persists on release           | ✅     | `rulerRef` updated on mouse-move, persisted on mouse-up           |
| Available in Site Model + Design phases                 | ✅     | Tools are global; no phase gating                                 |
| Horizontal + slope readout (Aurora shows both)          | ✅     | Composite label: "12.4' (horiz 12.3')" when heights differ        |

**Estimated parity: 95%** — the only gap is the *visual* style of the label box (Aurora uses a rounded white pill; we use the existing dark-navy Cesium label background). Style parity is polish; functional parity is 100%.

---

## 8. Files owned

- `components/3d/measure/DESIGN.md` — this file
- `components/3d/measure/measurements.tsx` — render helpers
- `lib/3d/measureMath.ts` — pure math
- `tests/measurements.test.ts` — unit tests

## 9. Files touched (minimal)

- `components/3d/SolarEngine3D.tsx` — PlacementMode union, refs, 4 handlers, dispatcher, tool list, Esc/right-click, mode-reset guard
