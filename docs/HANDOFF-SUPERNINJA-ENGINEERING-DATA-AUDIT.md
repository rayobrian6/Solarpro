# SuperNinja Task — Planset engineering-data accuracy audit (non-geometry sheets)

**Owner:** SuperNinja · **Branch:** `dev` (auto-deploys to solarpro-dev.vercel.app)
**Date handed off:** 2026-06-30

## Goal
Make the **engineering data** on the planset submission-grade. Your last pass fixed the
*visual* layout (overlaps, glyphs). This pass is about the **numbers and content** being
correct and complete on every non-geometry sheet — the stuff an AHJ plan-checker or PE
actually reads. Find wrong/placeholder/stubbed values and fix them.

## ⚠ STAY OUT OF (Claude + Ray own these this session)
Do **not** touch the roof/aerial geometry + coordinate pipeline:
- `lib/permit/sections/sitePlan.ts` (PV-1 aerial / centering)
- `lib/permit/sections/arrayPages.ts` (PV-2 roof plan, PV-2B)
- `app/api/engineering/permit/route.ts` aerial/geocode/center code
- `lib/roofGeometry.ts`, `lib/drafting/templates/roof.ts`, `components/design/**`,
  `components/3d/**`, the `layouts` panel/roofPlane coordinates.
If a data fix seems to require touching these, flag it for Ray instead of editing.

## Scope — audit + fix these sheets/sections
Engine: `app/api/engineering/permit/route.ts` → `lib/permit/generatePermitHTML()`; sections
in `lib/permit/sections/**`. Test fixture: `test-fixtures/roofProject.ts` (micro roof).

1. **PV-3 — Attachment / structural detail** (`structuralPages.ts`): lag bolt spec, embedment,
   rafter size/spacing, attachment spacing vs uplift, flashing, hardware, wind/snow values.
   Confirm the uplift/allowable numbers are computed from the real ASCE 7-22 loads + AHJ, not
   hardcoded. (Memory flagged a truss SF/bending stub — verify it's real now.)
2. **PV-4A — NEC compliance** (`electricalPages.ts`): every code check (NEC 690.8, 690.12,
   705.11/705.12, 310 voltage drop, conductor fill, rapid shutdown, 690.13 disconnect). Verify
   each PASS/result is actually computed from the system, the code citations are correct, and
   nothing is a placeholder "0 / N/A" that should have a value. (Note: the false ELEC-FAIL
   °F/°C derate was fixed earlier — verify voltage-drop / conductor sizing reads sane now.)
3. **PV-4B — Conductor schedule**: every conductor run (PV source/output, AC branch, EGC,
   GEC), gauge, ampacity, OCPD, conduit fill %, derating. Cross-check against the inverter/
   string config and NEC 690.8/310.15. Micro vs string must differ correctly.
4. **PV-4C — Structural calcs**: dead/live/snow/wind load combos, member checks, safety
   factor. No "0 ft-lbs / 45 ft-lbs" stubs — confirm the load model is real.
5. **Equipment schedule** (the equipment-list sheet) + **BOM** (Bill of Materials): part
   numbers, quantities, ratings match the actual selected equipment. Confirm micro count,
   combiner/terminator counts, breaker/disconnect ratings, and (per Claude's recent fix)
   that **no battery appears unless one is explicitly selected** — don't regress that.
6. **Cover sheet (PV-0) data + sheet index**: system summary (kW DC/AC, module/inverter,
   utility, AHJ, codes) all consistent with the rest of the set.

## Method
- For each sheet, trace where each value comes from (the section builder + its inputs) and
  confirm it's derived, not hardcoded/placeholder. List every wrong/suspect value with the
  file:line and the correct value, then fix.
- Cross-sheet consistency: kW, module count, inverter model, branch/string count, and AHJ
  wind/snow must be identical everywhere they appear.
- Where a value genuinely can't be computed yet (missing input), make it render an honest
  "—" / "see [sheet]" rather than a misleading zero, and note it for Ray.

## Verify (no DB/auth needed)
- `generatePermitHTML(roofProject)` from `tests/_smoke_generate.test.ts`; screenshot sheets
  with Playwright via Edge (`chromium.launch({ channel: 'msedge' })`).
- Add/extend tests under `tests/planset/` asserting the corrected values (e.g. a conductor
  ampacity, a voltage-drop %, the micro branch count, no-battery-when-disabled).
- Gates: `npx tsc --noEmit` clean; `npx vitest run tests/_smoke_generate.test.ts tests/planset/`
  green. Attach before/after screenshots + a list of every value you changed.

## Definition of done
- A written list of every data defect found (sheet, file:line, old → new), with fixes applied.
- Cross-sheet values consistent; no misleading placeholder zeros.
- tsc clean, smoke + planset tests green, screenshots attached. Bump PLANSET_ENGINE_VERSION
  in `lib/permit/constants.ts` (currently 47347 → next) so cached plansets regenerate.
