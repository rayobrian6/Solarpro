# Bottom-Right Status Panel — Design

> **Owner:** `status-panel` agent
> **Status:** design → implementation
> **Aurora reference:** `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §6
> **Aurora frames studied:** `frame_0147.jpg`

---

## 1. Aurora parity — what we're matching

A small floating panel pinned to the **bottom-right** of the 3D canvas,
visible only in Design phase. Three rows of `label: value` pairs, each
on its own line, right-aligned, with a fixed-width label column so the
values stack into a clean vertical column.

Aurora frame 0147 shows it like this:

```
Modules:               0
System Size (STC):    0 kW
Impact Price:        $ —
```

| Aurora element                      | Matched by                                       | Notes |
| ----------------------------------- | ------------------------------------------------ | ----- |
| Bottom-right placement              | `<StatusPanel>` with `position: absolute; bottom: 8px; right: 8px` | sits **above** the existing "last log" bar so the log is still readable |
| Three labeled rows                  | `StatusPanel` renders exactly three `<Row>`s     | labels are `Modules:`, `System Size (STC):`, `Impact Price:` — verbatim |
| Right-aligned value column          | `display: grid; grid-template-columns: 1fr auto` | labels on the left, values right-justified in a fixed gutter |
| Live Modules count                  | bound to `panels.length`                         | "0" when no panels placed, integer once any are placed |
| System Size (STC)                   | `modules × moduleWattage` / 1000 in kW           | one decimal place; 0 → `0 kW` |
| Impact Price                        | `modules × moduleWattage × costPerWatt`          | whole dollars, no cents; 0 → `$ —` (Aurora dash placeholder) |
| Dark-on-dark theme                  | `rgba(0,0,0,0.55)` background, `#ddd` text       | matches the dark Design phase canvas + matches the "last log" bar's tone |
| Small, low-attention typography     | `fontSize: 11`, `fontFamily: system-ui, sans-serif` | Aurora's is similar — small enough to never compete with the canvas |
| No background border, no shadow     | borderless translucent box                       | matches Aurora's flat floating feel |
| "Collapse" chevron on the right     | **out of scope for this slice**                  | not in the agent.md parity list; the three rows are the parity bar |
| Bottom-center hint                  | **out of scope**                                 | owned by the design-shell agent |

**Parity bar target:** ≥ 95% visual + behavioral match on the three
rows + their values. The collapse chevron and any future
"expand-to-show-BOM" affordance is explicitly out of scope for this
agent — that's the design-panel's job.

---

## 2. Inputs and pure math

The component is **display-only**. All math is pure and lives in
`statusMath.ts` so it is unit-testable without React, Cesium, or a
DOM.

### Input shape

```ts
/**
 * The data the status panel needs. The parent (SolarEngine3D via the
 * design-panel integration) supplies the count; the hook and the
 * defaults supply the rest.
 *
 * - `modules`        — live count of placed solar panels
 * - `moduleWattage`  — STC watts per module; Solarpro default 400W
 * - `costPerWatt`    — $/W from the Create Design modal; defaults to
 *                      DEFAULT_COST_PER_WATT when the modal hasn't
 *                      been used yet
 */
export interface DesignTotals {
  modules: number;
  moduleWattage: number;   // STC watts per module
  costPerWatt: number;     // dollars per watt
}
```

### Constants

```ts
/** Solarpro default STC wattage per module. Matches the equipment-db
 *  default (REC Alpha 400 / Q.PEAK DUO ML-G10+ 400) used when the
 *  user has not chosen a specific module. */
export const DEFAULT_MODULE_WATTAGE = 400;

/** Default $/W when the user has not yet created a Design (no
 *  costPerWatt recorded). Matches Aurora's "—" placeholder. */
export const DEFAULT_COST_PER_WATT = 0;
```

### Formulas (pure)

```ts
/** System size in kW STC, 1 decimal place. */
export function computeSystemSizeKw(
  modules: number,
  moduleWattage: number = DEFAULT_MODULE_WATTAGE
): number {
  return Math.round((modules * moduleWattage) / 100) / 10; // (modules*W)/1000 with 1dp
}

/** Impact price in whole dollars. Returns null when no modules are
 *  placed (Aurora shows "—" instead of $0). */
export function computeImpactPrice(
  modules: number,
  moduleWattage: number = DEFAULT_MODULE_WATTAGE,
  costPerWatt: number = DEFAULT_COST_PER_WATT
): number | null {
  if (modules <= 0) return null;
  return Math.round(modules * moduleWattage * costPerWatt);
}
```

> **Why `null` for the empty-price case, not `0`?**
> Aurora shows `$ —` when no design exists. The component treats
> `null` as the dash placeholder. Passing `0` is fine and renders
> `$ 0` (an explicit zero, which is the correct post-Design behavior
> — once a design exists with 0 panels, show the literal zero).

### Display formatters

```ts
/** "1,234 kW" with thousands separators, 1dp. */
export function formatSystemSizeKw(kw: number): string;

/** "$ 12,345" or "$ —" when null. */
export function formatImpactPrice(usd: number | null): string;

/** Plain integer with thousands separators. */
export function formatModuleCount(n: number): string;
```

These exist as pure functions so the test file can verify "1000
modules → 1,000" without rendering React.

---

## 3. Hook

```ts
/**
 * useDesignTotals — derive display values from a DesignTotals input.
 * Returns pre-formatted strings ready to drop into the panel.
 *
 * Defaults `moduleWattage` and `costPerWatt` to the Solarpro / Aurora
 * defaults when omitted, so callers in flight (e.g. the design-panel
 * agent before their modal lands) can pass just `{ modules: 0 }`.
 */
export interface DesignTotalsView {
  modulesLabel: string;       // "0" or "1,234"
  systemSizeLabel: string;    // "0 kW" or "412.8 kW"
  impactPriceLabel: string;   // "$ —" or "$ 12,345"
  systemSizeKw: number;       // raw for downstream consumers
  impactPriceUsd: number | null;
}

export function useDesignTotals(input: Partial<DesignTotals>): DesignTotalsView;
```

The hook is intentionally tiny. It's a thin wrapper around the pure
math + formatters so the component can be a one-liner render. It does
**not** subscribe to any context or store — the parent decides where
the data comes from. When the design-panel agent's modal lands, they
wire the input from their design-state store; for now, the parent
passes `{ modules: 0 }` and the defaults take over.

---

## 4. Components

| File                 | Purpose |
| -------------------- | ------- |
| `statusMath.ts`      | Pure math + formatters + constants. No React, no Cesium. 100% unit-testable. |
| `StatusPanel.tsx`    | React component: receives `modules`, `moduleWattage`, `costPerWatt`. Renders the three rows. |
| `useDesignTotals.ts` | The hook. Pure JS, returns the display strings. |
| `index.ts`           | Public exports: `{ StatusPanel, useDesignTotals, DEFAULT_MODULE_WATTAGE, DEFAULT_COST_PER_WATT, DesignTotals, DesignTotalsView }` |
| `DESIGN.md`          | This file |
| `../tests/statusPanel.test.ts` | Unit tests (lives in the project-wide `tests/` dir) |

---

## 5. UI anatomy (matches Aurora frame 0147)

```
                                          ┌───────────────────────┐
                                          │  Modules:           0 │
                                          │  System Size (STC): 0 kW │
                                          │  Impact Price:      $ — │
                                          └───────────────────────┘
                                                                       ▲
                                                          bottom: 8px, right: 8px
```

- A `display: grid` with two columns: `1fr` (labels) and `auto` (values).
- Labels: `color: #aaa`, `fontSize: 11`, `fontWeight: 500`.
- Values: `color: #ddd`, `fontSize: 11`, `fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'` (so digits align in a column).
- Container: `background: rgba(0,0,0,0.55)`, `borderRadius: 5`, `padding: '6px 10px'`, `zIndex: 40` (sits below the wizard's `zIndex: 50` and the legend's `zIndex: 50`).
- Position: `position: absolute; bottom: 28px; right: 8px;` — sits **above** the "last log" bar (which is at `bottom: 8px`) so both are visible.
- Renders only when `visible !== false` (default `true`). The SolarEngine3D mount sets `visible={isDesignPhase}` once the design-panel agent lands their phase gate; for now, always visible.

### Aurora-isms preserved

- The label `System Size (STC):` is preserved verbatim with parentheses and the colon.
- The value column has a wider gutter than the label column's `1fr`, so labels visually right-pad with whitespace — matches the Aurora screenshot's left-side alignment of the colon.
- The empty state is `$ —` (en-dash, ASCII hyphen-minus in code), not `$ 0`, matching Aurora.

---

## 6. Integration with SolarEngine3D

Per agent.md, I touch `components/3d/SolarEngine3D.tsx` **minimally**:

1. **Add one prop** to the `Props` interface:
   ```ts
   /** v66: design-phase flag — gates the bottom-right status panel
    *  (Aurora frame 0147). When false, the panel is hidden. */
   isDesignPhase?: boolean;
   ```
2. **Add one import** at the top of the file:
   ```ts
   import { StatusPanel } from './status';
   ```
3. **Add one JSX line** in the bottom-right area of the canvas, just before the "Last log" bar:
   ```tsx
   {isDesignPhase ? <StatusPanel modules={panels.length} /> : null}
   ```

That is the entire touch surface — one prop, one import, one line of
JSX. The status panel is **always read-only** with respect to the
design state; it never mutates anything.

> **No `costPerWatt` / `moduleWattage` plumbing in SolarEngine3D.** The
> component uses the Solarpro defaults (400W, $0/W) until the
> design-panel agent wires the design-state context. That is a clean
> extension point for the design-panel agent: they add a `design` prop
> to SolarEngine3D, pass `costPerWatt={design.costPerWatt}` to the
> StatusPanel, and the math updates live.

---

## 7. Testing strategy

`tests/statusPanel.test.ts` covers the pure math + formatters + the
default constants:

1. `DEFAULT_MODULE_WATTAGE === 400`.
2. `DEFAULT_COST_PER_WATT === 0`.
3. `computeSystemSizeKw(0)` → `0`.
4. `computeSystemSizeKw(1)` → `0.4` (one 400W module).
5. `computeSystemSizeKw(10)` → `4` (ten 400W modules).
6. `computeSystemSizeKw(25, 400)` → `10`.
7. `computeSystemSizeKw(100, 400)` → `40`.
8. `computeSystemSizeKw(100, 0)` → `0` (degenerate wattage is safe).
9. `computeImpactPrice(0, 400, 4)` → `null` (Aurora "—" placeholder).
10. `computeImpactPrice(10, 400, 4)` → `16000` ($4/W × 4000W × 10 modules).
11. `computeImpactPrice(25, 400, 3.5)` → `35000`.
12. `computeImpactPrice(0, 0, 0)` → `null` (everything-zero falls back to dash).
13. `formatModuleCount(1234)` → `"1,234"`.
14. `formatModuleCount(0)` → `"0"`.
15. `formatSystemSizeKw(0.4)` → `"0.4 kW"`.
16. `formatSystemSizeKw(412.8)` → `"412.8 kW"`.
17. `formatImpactPrice(null)` → `"$ —"`.
18. `formatImpactPrice(0)` → `"$ 0"`.
19. `formatImpactPrice(16000)` → `"$ 16,000"`.

Plus a smoke test that the `StatusPanel` component renders the three
labels verbatim (`Modules:`, `System Size (STC):`, `Impact Price:`) and
the correct value strings for a sample input. The smoke test uses
`@testing-library/react` with the jsdom env, but the heavy lifting
is in the pure-math tests above.

Vitest is already wired (`vitest.config.ts`, `npm test`). No new
deps.

---

## 8. Out of scope (deferred to other agents)

- The **collapse chevron** and any "expand to show BOM" affordance —
  owned by the design-panel agent.
- The **bottom-center hint** ("Add modules and components...") — owned
  by the design-panel agent.
- The **Create Design modal** (Name + Cost $/W) — owned by the
  design-panel agent. Until that lands, the panel defaults to `$/W =
  0` and shows `$ —` for empty designs.
- The **dark canvas theme switch** between Site Model (light
  satellite) and Design (dark grid) — owned by the design-panel agent.
- The right-side **Design toolset** (Auto Design, Solar Panels,
  Inverter, BOS, etc.) — owned by the design-panel agent.

This agent ships the **status readout shell + math + hook + Aurora
parity on the three rows**. Wiring it into a real Design phase is the
design-panel agent's next step.
