# SuperNinja Task — Planset/Server Bug Fixes (post-2026-06-29 generate)

**Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev` (never master) · Next.js + TS.
**Context:** A real permit generated successfully (project `4030b664-bebe-433b-a11c-cda05ead2f7d`,
3 Melvin Dr, Granite City IL, 52 modules / 4 roof planes). The geometry pipeline is now CORRECT —
the server log proves it: `panelPositionCount: 52`, `source=GPS` on all 4 planes, `Centering on
array`, `PERMIT DRAFT/LEGACY proceeding`, `PLANSET GENERATED`. The bugs below are the REMAINING
defects the same log exposed. Fix them without breaking the things in the **DO NOT REGRESS** list.

Run from repo root. Verify with: `npx tsc --noEmit` (clean), `npm test` (green),
`NODE_OPTIONS=--max-old-space-size=4096 npm run build` (the bigger heap avoids the OOM/exit-137
the sandbox hit last time). DO NOT touch `app/engineering/page.tsx` — a battery split-memo refactor
is being done there in parallel; you'd collide.

---

## BUG 1 — 🔴 Structural calc crashes → PV-4C runs on blanks (field-name mismatch)

**Evidence (log):** `[PLANSET] Server-side structural V4 failed (non-critical): Cannot read
properties of undefined (reading 'designWindSpeedMph')`.

**Root cause (confirmed):** `lib/structural-engine-v4.ts` `runStructuralCalcV4` returns a
`StructuralResultV4` whose interface names the fields **`wind`** and **`snow`** (see the interface,
`wind: WindAnalysis; snow: SnowAnalysis;`). But the consumer in
`lib/permit/generatePermit.ts` reads the WRONG names:
- line ~329: `const wa = structResult.windAnalysis;`  → `undefined` (should be `structResult.wind`)
- line ~330: `const sa = structResult.snowAnalysis;`  → `undefined` (should be `structResult.snow`)

(`rafterAnalysis` and `mountLayout` are read with the correct names, which is why only wind/snow
broke.) The first deref (`wa.designWindSpeedMph`, line ~336) throws; the try/catch swallows it, so
PV-4C shows defaults instead of real ASCE 7-22 wind/snow numbers.

**Fix:** in `lib/permit/generatePermit.ts`, change `structResult.windAnalysis` → `structResult.wind`
and `structResult.snowAnalysis` → `structResult.snow`. Then verify every subsequent `wa.*` / `sa.*`
field used (lines ~336-345: `designWindSpeedMph`, `velocityPressurePsf`, `netUpliftPressurePsf`;
`groundSnowLoadPsf`, `roofSnowLoadPsf`) exists on `WindAnalysis` / `SnowAnalysis` (they do — built
at structural-engine-v4 ~1193 and ~1206).

**Acceptance:** regenerate → log shows `[PLANSET] Server-side structural V4 computed rafter
bending: …` (the SUCCESS line) and NO "failed". PV-4C sheet shows real wind speed (110 mph here),
roof snow, rafter bending demand/capacity, utilization — not zeros/dashes.

---

## BUG 2 — 🟠 SLD AC current is wrong (`acOutputAmps=1`)

**Evidence (log):** `[SLD INPUT TRUTH] … acOutputAmps=1` for a 52-microinverter system (should be
~50A: 52 × IQ8A ~0.24 kW AC ≈ 12.5 kW → 12500/240 ≈ 52A).

**Root cause:** `lib/permit/utils/sldAdapter.ts:38`
`const acOutputAmps = acOutputKw > 0 ? Math.round(acOutputKw * 1000 / 240) : 0;` — `acOutputKw` here
is the PER-DEVICE micro output (~0.24 kW → rounds to 1A), not the SYSTEM total. Trace where
`acOutputKw` comes from in sldAdapter and feed it the **system total AC** (for micros:
`totalPanels × perMicroAcKw`, or `input.system.totalAcKw` which generatePermit already computes —
see generatePermit.ts ~149-163). This also feeds `acOCPD` (sldAdapter:53), so fixing it corrects
the SLD's OCPD/conductor sizing.

**Acceptance:** regenerate → `acOutputAmps` ≈ 50A (system total), and the E-1 SLD shows a realistic
AC OCPD (e.g. 60A) and conductor, not a 1A-derived size.

**Watch:** don't double-count — `input.system.totalAcKw` is already micro-aware in generatePermit
(`isMicro ? totalPanels * inv0.acOutputKw : summed`). Prefer reading that, not re-deriving.

---

## BUG 3 — 🟡 Survey enrichment silently skipped (missing DB column)

**Evidence (log):** `[permit/survey] Survey pipeline error (non-critical): column "setback_notes"
does not exist`.

**Root cause:** `app/api/engineering/permit/route.ts` ~line 659 `SELECT … access_notes,
mounting_notes, setback_notes …` FROM `project_physical_data`, but `setback_notes` (and possibly
`access_notes` / `mounting_notes`) was never created — no migration in `lib/migrations/` defines it.
So the whole survey-enrichment block throws and is caught as non-critical → survey notes/evidence
never reach the planset.

**Fix (choose the correct one — verify first):**
1. If those columns ARE consumed downstream (grep `setback_notes`, `access_notes`, `mounting_notes`
   across `lib/siteSurvey/`, `fromPhysicalData.ts`): add an **idempotent** migration in
   `lib/migrations/NNN_*.sql` — `ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS
   setback_notes TEXT;` (and any other missing ones). Migrations run via Admin → System Tools
   (idempotent, no DO blocks). Ray must run it.
2. If they're NOT consumed, remove the missing column(s) from the SELECT list so the query stops
   throwing.

**Acceptance:** regenerate → no "column … does not exist"; `[permit/survey]` proceeds (logs
completeness/sheetData) instead of erroring.

---

## BUG 4 — 🟢 Cleanup (trivial): misleading SLD log label

`lib/sld-professional-renderer.ts:2059` logs `[SLD BATTERY MISSING AT STAGE RENDERER]` inside the
`hasBattery=TRUE` branch (the battery IS rendered — see `battery-ac: 180×170` later in the log).
Rename to something accurate (e.g. `[SLD BATTERY RENDERED]`). The real missing case is line 1973
(`hasBattery=false`). No behavior change.

**Optional (low priority):** the battery kWh is shown as TOTAL on the SLD (`15 kWh` = 3 units × 5)
but PER-UNIT in the PV-1 equipment legend (`5.0 kWh`). Not wrong, but inconsistent — consider
labeling the SLD "15 kWh (3 × 5.0)" for clarity. Source: `sldAdapter.ts:79`.

---

## NOT A BUG — do not "fix"
- **Azimuth `(8)`** in the data tables: `arrayPages.ts` computes `compassDir = 'S'` correctly
  (lines 173, 327, 393). The `(8)` is the letter **S** at low screenshot resolution (already
  confirmed a misread once). Just verify the data row renders a compass LETTER, not an octant index.

---

## ⛔ DO NOT REGRESS — this session just fixed all of these; keep them working

Run a generate of project `4030b664…` (3 Melvin Dr) BEFORE and AFTER your changes and diff the log.
The following MUST remain true:
- `[PERMIT INPUT] panelPositionCount: 52 … hasPanelPositions: true` — real panels reach the permit.
- `[PANEL GRID GENERATED] roofCAD … source=GPS` on every plane — PV-2 draws REAL panels, not a grid.
  → DO NOT modify `lib/cad/roof/roofCAD.ts` (the gpsPanels path / rawPlanes branch) or
  `lib/cad/adapter.ts`.
- `[permit/aerial] Centering on array` — aerial centers on the array.
  → DO NOT modify `chooseAerialCenter` or the `_arrayCenter` block (`lib/permit/sections/sitePlan.ts`,
  `route.ts` ~553).
- `[PERMIT DRAFT/LEGACY] Proceeding without CanonicalBuildingModel` — generation works WITHOUT a
  promoted canonical model.
  → DO NOT re-tighten the `CANONICAL_ROOF_GEOMETRY_REQUIRED` gate / `hasRealDesignRoofGeometry`
  (`route.ts` ~840). A roof project with real roofPlanes+panels must never 422.
- **PV-2 ≠ PV-2B.** PV-2B must stay the string-layout schematic (`schematicGridSvg`).
  → DO NOT reintroduce `drawingEngine.getArrayPlanFromCAD` into `pageArrayGeometry`
  (`lib/permit/sections/arrayPages.ts`).
- **Design Studio is OFF LIMITS:** `components/3d/SolarEngine3D.tsx`,
  `components/design/DesignStudio.tsx`, `app/design/page.tsx` — the stitch/snap/setback/auto-layout
  fixes AND the `window.__solarE2E` test hook live there. Do not touch.
- **Engineering page is OFF LIMITS:** `app/engineering/page.tsx` — battery-count fix + an in-flight
  split-memo refactor. Do not touch.
- Existing tests stay green: `tests/planset/`, `tests/roofCADCanonicalPanels.test.ts`,
  `tests/chooseAerialCenter.test.ts`, `tests/permitRoofGeometryGate.test.ts`,
  `tests/_smoke_generate.test.ts`, and the e2e harness.

## Deliverables
- Fixes for BUG 1–3 (+ BUG 4 cleanup), each a focused commit on `dev` with a clear message.
- A unit test for BUG 1: feed `generatePermitHTML` the roof fixture (extend
  `tests/_smoke_generate.test.ts` or add `tests/planset/structural-wiring.test.ts`) and assert the
  generated HTML contains real structural values / that `runStructuralCalcV4`'s `wind`/`snow` are
  consumed (no "structural V4 failed"). For BUG 2, assert sldAdapter computes acOutputAmps from the
  system total for a micro system.
- `npx tsc --noEmit` clean; `npm test` green; `NODE_OPTIONS=--max-old-space-size=4096 npm run build`
  succeeds.
- Files you'll touch: `lib/permit/generatePermit.ts`, `lib/permit/utils/sldAdapter.ts`,
  `app/api/engineering/permit/route.ts` (+ a migration) or the survey lib, `lib/sld-professional-renderer.ts`.
  NONE of the OFF-LIMITS files above.
