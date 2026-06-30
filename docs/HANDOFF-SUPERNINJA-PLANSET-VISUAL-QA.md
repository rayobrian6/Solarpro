# SuperNinja Task — Planset visual QA pass (all 16 sheets)

**Owner:** SuperNinja · **Branch:** `dev` (auto-deploys to solarpro-dev.vercel.app)
**Scope:** Visual quality of the generated permit planset. NO coordinate/data pipeline work
(Claude is fixing a system-wide panel-coordinate corruption bug in parallel — stay out of
the aerial centering / lat-lng / `layouts` save path / DesignStudio coordinate code).
**Date handed off:** 2026-06-30

Your PV-2B real-roof branch-colored redesign shipped (`8f2c369d`) and looks good. Next: a
full visual-quality pass over the planset, fixing the rough edges Ray has flagged plus
anything else that reads as unprofessional.

## Known issues to fix

1. **PV-2 label overlaps** (`lib/drafting/templates/roof.ts`, the `drawRoofPlan` renderer):
   - "VERIFY IN FIELD" dimension text overlaps the bottom row of modules.
   - "ROOF ARRAY PLAN" caption overlaps the scale bar (bottom-left).
   - Fix the collisions — nudge labels clear of modules/scale bar, or move them to margins.
   - Do the same overlap audit on PV-2B (your sheet) and the fence/ground variants.

2. **Title-block glyph rendering — INVESTIGATE then fix if real.** In Ray's screenshots the
   title-block labels read as "8HEET / 8CALE / PE 8EAL / 8YSTEM / A8CE 7-22 / FLA8HING /
   8HINGLE" and "316 S.S." as "318 8.8." i.e. capital **S (and sometimes 6) rendering as 8**.
   It may be screenshot blur (a 6→8 wouldn't be a font bug), OR a real font/glyph issue at the
   small bold-condensed title-block size.
   - Generate the permit HTML and render the title block at high zoom (see Verify below).
   - If "S" actually renders as "8" in the PDF/HTML at 100%, it's a font-embedding / glyph
     problem — find the font stack used for `.title-block` / `.sheet-id` / small-caps labels in
     `lib/permit/**` (generatePermit.ts inline CSS, utils/titleBlock.ts) and fix (swap font,
     fix weight, or fix a CSS letter-spacing/transform that's mangling the glyph). If it's only
     screenshot blur, say so and move on — don't invent a fix.

3. **General sheet QA** across PV-0..PV-5, PV-2B, PV-3, PV-4A/B/C, PV-5, certs, SLD: scan each
   for clipped text, overlapping callouts, misaligned tables, empty/placeholder sections (e.g.
   the "UTILITY ANALYSIS" block on PV-3 looked empty/cut), and inconsistent type sizing. Fix
   what's clearly broken; list anything ambiguous for Ray rather than guessing.

## Where the planset is built
- Engine: `app/api/engineering/permit/route.ts` → `lib/permit/generatePermit.ts generatePermitHTML()`.
- Sheets: `lib/permit/sections/**` (arrayPages.ts = PV-2/2B, electricalPages.ts, coverSheet.ts,
  sitePlan.ts = PV-1, structuralPages.ts, etc.).
- Roof drawing: `lib/drafting/templates/roof.ts` (drawRoofPlan) + `lib/permit/utils/drawing.ts`.
- ⚠ Do NOT touch `sitePlan.ts` aerial centering or `app/api/engineering/permit/route.ts` lines
  ~550-600 / ~997 (the aerial fetch + re-center) — Claude owns those this session. Coordinate
  with Ray before editing route.ts.

## Verify (no DB/auth/PDF needed)
- Generate the full permit HTML from the fixture: `generatePermitHTML(roofProject)` with
  `test-fixtures/roofProject.ts` (see `tests/_smoke_generate.test.ts`). Write a tiny `tsx`
  script that writes the HTML to a file.
- Screenshot sheets with Playwright via Edge (no chromium binary installed):
  `chromium.launch({ channel: 'msedge' })`, find the `.page` whose text contains the sheet
  title, `element.screenshot()`. Zoom the title block to confirm the glyph issue.
- Gates: `npx tsc --noEmit` clean; `npx vitest run tests/_smoke_generate.test.ts tests/planset/`
  green. Attach before/after screenshots of each fixed sheet for Ray.

## Definition of done
- PV-2 label overlaps gone; PV-2B/other plans checked for the same.
- Glyph issue either fixed (with a screenshot proving S renders correctly) or explicitly
  confirmed to be screenshot blur with evidence.
- A short list of any remaining ambiguous visual issues for Ray to weigh in on.
- tsc clean, smoke + planset tests green, before/after screenshots attached.
