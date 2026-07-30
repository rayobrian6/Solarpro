# Hybrid Planset — VISUAL handoff (read before touching any sheet)

## The mandate (do not misread this)
Ray judges the planset **by how it LOOKS**, not by code correctness. "It renders
without error" and "the data is right" are NOT the bar. The bar is: **does each
sheet look like a professional CAD permit drawing that FILLS the page.** Weak
visuals = failure, even if the numbers are correct.

## The only valid verification (fixtures are worthless here)
Golden test fixtures DO NOT match the real Stowell data. Example: the golden
fixture ground array renders a clean grid, but the REAL Stowell ground renders a
diagonal cascade. So:
1. Regenerate the REAL Stowell planset (the same path Ray downloads —
   `PermitPackage-AMY M STOWELL — Solar (N).html`). Ask Ray how he generates it
   if unknown (design studio → generate, or a script/URL).
2. Render every sheet with Playwright and LOOK at each PNG:
   - Script pattern (already used): a `.mjs` IN the repo (so `playwright`
     resolves), `chromium.launch()`, `goto('file:///'+encodeURI(SRC))`, selector
     `#sp-sheets > .page`, screenshot each `.page` → `pN.png`. See `_tmp_shoot4.mjs`.
   - Then Read the PNGs. Judge the LOOK.
3. Never claim a sheet is fixed off a fixture render.

## STATUS 2026-07-13 (session 587a0645) — geometry sheets FILLED
The three geometry sheets below are now dense multi-viewport CAD sheets, verified
on a real Stowell regen (not fixtures). Root cause was a canvas-aspect letterbox
(a wide/thin drawing auto-fit into a tall zone leaves 48–75% void) plus the
drawing owning only ~40% of its own canvas. Fix pattern (reuse it):
1. Make the SVG canvas TALL to match the ~1.15–1.20 draw-zone aspect (ground
   plan 460→880, fence plan 520→840 — the roof template already did this).
2. STACK full-width viewports so a wide/thin object stops leaving void:
   - **PV-1G / PV-1BG** (`drawGroundArray`): A top-view module layout · B row-
     spacing side elevation · C typical pile section · right GROUND MOUNT NOTES
     panel. Now full-width; the redundant internal ARRAY SCHEDULE was removed
     (the outer PV-1G ARRAY DATA / PV-1BG per-sub frame already carries it).
   - **PV-1BF** (`drawFencePlan`): top-down run (upper 0.34) + TYPICAL FENCE
     SECTION (driven post + 90° vertical modules + embedment) filling the rest.
Commits: `5e4f81d7` diagonal→grid · `773f5383` ground fill · `6b0420b8` fence
fill · `ab908a79` electrical single-source (off-mandate, committed separately
per Ray). **Not pushed yet.** Regen: `_tmp_stowell_regen.ts <out.html>` then
`_tmp_shoot5.mjs <src> <outdir>`.
Minor remaining voids: PV-1G's OUTER ARRAY DATA/CALLOUT column lower ~40% is
still white (a `composeDrawPage` matter, not `drawGroundArray`); PV-1BF section
has emptyish left/right thirds.

## Known VISUAL problems in the real (4).html (2026-07-13) — HISTORICAL, now fixed
- **PV-1G ground array — REGRESSION (from commit af3d3fed).** Drew a diagonal
  staircase of overlapping panels; badge said "ARRAY 1 — 16 ROWS × 1". Cause:
  drawGroundArray drew the raw per-panel CAD coords (Stowell stores ground panels
  as a staggered/diagonal sequence, not a grid). **STAGED FIX (uncommitted in
  ground.ts panelRectsFor): draw the normalized rowCount×panelsPerRow grid
  instead of raw coords.** NOT visually verified against the real regen — verify
  it draws a clean 2×8 that FILLS the draw zone, then commit. Even after: the
  sheet is likely still too empty — scale the array up + add density.
- **PV-1BF fence top-down — visually weak.** A thin ~1cm horizontal strip in a
  mostly-empty canvas. Data is correct (module ticks, 62'-9" length, auto-fit),
  but it does not FILL the sheet. Needs: much larger drawing, property/setback
  context frame, richer dimensioning, so it reads as a real site plan — not a
  hairline in whitespace.
- **PV-1BG ground geometry — same emptiness class.** Verify + fix.
- **General geometry-sheet disease:** big empty canvases, small/thin drawings.
  Every geometry sheet must scale its content to fill the draw zone with
  professional CAD density (context, dims, labels), not center a tiny figure.

## What is actually GOOD — do NOT re-touch (regressions came from over-reach)
- Fence ELEVATION (PV-1F): Ray acknowledged it — vertical modules, driven pile.
- Fence TOP-DOWN data (ticks, matching 62'-9" length) — the DATA is right; only
  the SIZE/density is weak.
- Per-sub SLD equipment + fail-loud "⚠ INVERTER NOT SELECTED" (commit 1fe02b05):
  greps confirm `× Inverter`/`0W`/`gps-array`/`NEC NEC` gone; real per-lane
  equipment renders.
- BOM per-sub + PV-6 per-sub (MICROINVERTERS — ROOF/GROUND/FENCE ×48/16/17) +
  MAX DC 788V (commit 78646c22).
- Per-sub kW from panels×watts + roof count guard (commit 0f3ff501).
- RT-MINI roof-leak fix on ground (greps: RT-MINI only on roof now = correct).

## Process failures to NOT repeat
- Verified visual changes against synthetic fixtures instead of the real planset.
- Called near-empty / thin drawings "fine" — apply Ray's bar: it must LOOK good.
- Trusted subagent self-reports of "verified" without re-rendering the real sheet.

## Commit trail this session (dev)
ceb58be7 fence elev · af3d3fed ground (RT-MINI good, array-draw REGRESSED) ·
1fe02b05 per-sub SLD + top-downs · 78646c22 BOM/PV-6 per-sub · 0f3ff501 per-sub kW.
Uncommitted: ground.ts panelRectsFor diagonal→grid fix (verify then commit).
