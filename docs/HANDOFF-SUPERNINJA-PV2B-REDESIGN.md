# SuperNinja Task — Redesign PV-2B as a real-roof, branch-colored circuit plan

**Owner:** SuperNinja · **Branch:** `dev` (auto-deploys to solarpro-dev.vercel.app)
**Scope:** ONE sheet — PV-2B "Array Geometry & String Layout". Visual redesign only.
**Date handed off:** 2026-06-30

---

## The problem (what Ray sees)

PV-2B currently renders a flat 2-row × 26-column **schematic stick grid** that:
1. Fills only the **top ~250px** of a fixed **1200×700** SVG canvas → the bottom
   ~450px is dead white space. Because the SVG scales-to-fit, the whole grid shrinks
   to a tiny strip at the top. Looks unprofessional ("dog shit", per Ray).
2. Ignores the real roof. PV-2 (the sheet right before it) already renders a
   beautiful real 4-plane hip roof with the modules in their true positions, so the
   abstract grid on PV-2B looks especially weak by comparison.

The **data is already correct** (a prior fix this session, commit `2d42c73d`): the sheet
now reads `4 AC Branches`, cells `B1..B4`, and a correct `BRANCH LEGEND` (4 branches ×
13 × 440W). **Do not regress that** — see "Coordination" below.

## The target (Ray approved this direction)

Make PV-2B show the **real roof geometry — the same array as PV-2 — but with each PV
module shaded by its AC branch** (B1, B2, B3, B4), plus the branch legend. This is the
permit-standard "circuit / string layout" sheet:
- PV-2 = roof plan with **fire setbacks + dimensions + callouts** (leave it alone).
- PV-2B = **same roof, modules colored by branch + branch legend, NO dimension callouts**.
The branch coloring is what makes them genuinely distinct (see the duplication warning
in Coordination).

## Where the code lives

- **Sheet generator:** `lib/permit/sections/arrayPages.ts` → `pageArrayGeometry(input, cad, pageNum, totalPages)` (~line 134).
  - Current draw: builds `schematicGridSvg` (~line 304) → `agDrawSvg` (~line 322) → rendered in the 78% "draw-zone" of the return block (~line 373-431).
  - The 22% "data-zone" (ARRAY PARAMETERS table, BRANCH LEGEND, FIRE SETBACKS, NOTES) is **correct — keep it**.
- **Branch → panel mapping (already computed):** `panelStringMap` at `arrayPages.ts:189-192`
  maps each `panel.id` → branch index `0..3` (even split, `ceil(totalPanels / totalStrings)`
  per branch). `totalStrings` for micro = `ceil(totalPanels/16)` (line 137). Color palette =
  `stringColors` (line 186). **Reuse these — the grid and legend already agree with them.**
- **PV-2's real-roof renderer (what to reuse):** PV-2 (`pageRoofPlan`, arrayPages.ts:18)
  calls `getPrimaryView('roof_plan', cad, input, ctx)` → `drawingEngine.getArrayPlanFromCAD`
  (`lib/drafting/composers/index.ts:235`) → `drawRoofPlan` (`lib/drafting/templates/roof.ts`).
  - Modules are drawn at **`roof.ts:178-186`** — each module is one `<rect ... fill="#1b3f74" .../>`
    with a **hardcoded navy fill**. This is the single line you need to make branch-aware.

## Implementation plan (suggested — adapt as needed)

1. **Add an optional per-panel color map to the roof renderer.** Thread an optional
   `panelColorById?: Map<string,string>` (or `branchByPanelId`) param through
   `getArrayPlanFromCAD` → `drawRoofPlan`. At `roof.ts:186`, use
   `panelColorById?.get(p.id) ?? '#1b3f74'` for the module fill (keep the dark frame).
   When the map is absent, behavior is byte-identical to today (PV-2 unaffected).
2. **Build the map in `pageArrayGeometry`** from `panelStringMap` + `stringColors`
   (`stringColors[branchIdx % stringColors.length]`), then call the roof renderer the
   same way PV-2 does, passing the color map. Replace `agDrawSvg = schematicGridSvg`
   with this real-roof SVG.
   - ⚠ **Panel identity must match:** the renderer iterates `validPanels` (from
     `cad.roof.planes[].panels` / `project.panelPositions`). Confirm those panels carry
     the **same `id`** that `panelStringMap` is keyed on. If ids don't line up, key the
     map by stable position (row/col) instead, or assign branch by the same
     sorted-by-(row,col) order the grid uses (`sortedPanels`, line 190).
3. **Keep a graceful fallback.** If there is no usable roof model / no panel positions
   (e.g. a config-only system), fall back to the existing `schematicGridSvg` so the
   sheet never throws or goes blank. (Today's schematic is the fallback, not the primary.)
4. **Differentiate from PV-2.** On PV-2B: drop the fire-setback dimension lines and the
   PV-2 callout schedule; instead overlay a small **per-branch tint legend** on the
   drawing (or rely on the existing BRANCH LEGEND in the data-zone). Title stays
   "ARRAY GEOMETRY & STRING LAYOUT".
5. **Fit-to-frame.** Make the real-roof SVG fill the draw-zone like PV-2 does (PV-2
   already fits the roof to its frame). Eliminate the dead-space problem.

## Verify (no DB/auth/PDF needed)

A working local render loop (used to verify the data fix this session):
- **Generate the full permit HTML from a fixture:**
  `tests/_smoke_generate.test.ts` shows the call — `generatePermitHTML(roofProject)`
  with `test-fixtures/roofProject.ts` (already a 12-module micro roof). Write a tiny
  `tsx` script that writes the HTML to a file.
- **Screenshot the PV-2B `.page` with Playwright.** No chromium binary is installed —
  launch Edge: `chromium.launch({ channel: 'msedge' })`. Find the page whose text
  contains `PROFESSIONAL CAD ARRAY DIAGRAM` and `element.screenshot()` it.
- There is also `scripts/render-cad-preview.ts` (drives `drawRoofPlan` with mock
  fake-degree roof+panel data) — useful for iterating the roof renderer in isolation.
  ⚠ It uses "fake-degree" CAD encoding (1 unit ≈ 1 ft) — mock in that space, not real lat/lng.
- **Gates:** `npx tsc --noEmit` clean; `npx vitest run tests/_smoke_generate.test.ts tests/planset/`
  green (the smoke test asserts PV-2 and PV-2B both render). Add/adjust a test that
  asserts PV-2B contains branch-colored module fills (≥2 distinct `stringColors` hexes)
  and is NOT identical to PV-2.

## Coordination — READ THIS

- **Base off the latest `dev` HEAD** (≥ commit `2d42c73d`, "PV-2B micro branch labeling…").
  That commit added, in the SAME function you're editing: `cPrefix` (B/S prefix), the
  branch-derived `legendItems` for micro, and the `BRANCH LEGEND`/"Branch" headers.
  **Keep all of that** — it's the data-zone + labels. You are replacing the **draw-zone**
  (the schematic grid), not the legend/params.
- **Do not let PV-2 and PV-2B become literal duplicates.** They were duplicates once
  (fixed in commit `02599446` / see `memory: planset-audit`). The branch coloring +
  dropping PV-2's dimensions/callouts is what keeps them distinct. If they end up
  pixel-identical, the redesign failed.
- Claude (this session) is concurrently editing **`lib/permit/sections/sitePlan.ts`**
  (PV-1) and **`lib/drafting/templates/roof.ts`** label cleanups. If you also touch
  `roof.ts` (likely, for the color param), expect a possible small merge — coordinate via
  Ray, keep changes additive (an optional param), and pull before pushing.

## Definition of done

- PV-2B shows the **real roof** with modules **colored by AC branch**, fills the sheet,
  and has the branch legend. Visually distinct from PV-2. No dead white space.
- PV-2 unchanged (byte-identical when no color map is passed).
- `tsc` clean, smoke + planset tests green, a screenshot of the new PV-2B attached for Ray.
