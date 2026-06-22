# Ground-Mount & Fence (SolFence) Accuracy Audit — SolarPro Engineering Pipeline

**Date:** 2026-06-20 · **Run:** wf_1b1ca836-b77 (40 agents, 6 mount-type dimensions + adversarial verify + synthesis)
**Findings:** 61 total (50 ground, 34 fence). **8 CRITICAL, 16 HIGH, 30 confirmed (high confidence).**

---

## 1. Executive Summary

**The pipeline is roof-correct and roof-only at the load-bearing layer.** `systemType` propagates through the *upper* layers (design snapshot, sizing, BOM routing of `groundData`/`fenceData`) but **collapses to roof at every structural engine and at the report/permit path** — the exact layers that produce stamped engineering.

- **GROUND** gets a roof rafter/lag result. The real ground engine (`analyzeGroundMount`, V4) is **dead code from the app** — the page never sets `installationType`, so `/calculate` defaults to `'roof_residential'` (`calculate/route.ts:291`). Even if reached, it's fed roof wind (roof Kz at mean roof height, Fig 29.4-7 roof-solar GCp, hardcoded `'corner'` zone), fake lateral (`uplift×0.3`), and unsourced round-number pile capacities (8000/12000/5000) mislabeled "ASCE 7-22."
- **FENCE** has **zero structural representation anywhere.** `InstallationType` has no `'fence'` member (`types.ts:46-52`); V3/V4 have zero fence branches. A SolFence job receives roof rafter math; its "structural" numbers (3 ft post embed, 8 ft spacing) are fabricated UI defaults presented as engineered fact.
- **BOM** routes `groundData`/`fenceData` to line items and suppresses roof rails, but bypasses the real ground engine, force-adds per-module RSD to ground (NEC 690.12(B)(2) exemption ignored), emits a duplicate grounding electrode, has **no NEC 300.5 trench/burial**, **zero concrete volume** for piers, and **no footing** for fence posts.

**Bottom line: a ground or fence project today silently receives a roof structural stamp with fabricated mount geometry. This must not be treated as engineered output until a mount-type-branched engine exists.**

---

## 2. Highest-leverage sequencing (from the audit)
1. Map `systemType → installationType` in the structural payload — unlocks the existing V4 ground engine (one change). *Necessary, not sufficient — the V4 ground engine itself is flawed (below).*
2. Gate rafter analysis + branch wind/snow coefficients in V4 so the unlocked ground path is physically correct.
3. Suppress RSD on ground, fix duplicate grounding, add NEC 300.5 trench (BOM correctness, low effort).
4. Add a `fence` `InstallationType` + `analyzeFence` (vertical-barrier wind + post embedment) — net-new; SolFence has no engineering at all today.

## 3. Confirmed CRITICAL (8)
1. Structural payload omits `installationType` → every ground/fence runs the roof path (`page.tsx:4301-4340` → `calculate/route.ts:291`).
2. Live structural tab runs roof-only V3 for ground & fence (`page.tsx:4499-4527` → `structural-v2/route.ts` → V3).
3. V4 (only engine with ground logic) never told it's ground/fence; defaults `roof_residential`.
4. `/api/engineering/structural` runs V1 roof engine, no ground/fence branch.
5. Engineering report emits roof-only structural for ground AND fence (`reportGenerator.ts:320-388`).
6. Fence has no structural representation — `InstallationType` lacks `'fence'` (`types.ts:46-52`).
7. Fence: no vertical-barrier wind / post-embedment / infill case.
8. V4 wind hardcodes roof height + `'corner'` + Fig 29.4-7 roof-solar GCp for every system, fed into the pile calc (`structural-engine-v4.ts:967-978`).
9. BOM route bypasses the real ground engine; uses client fabricated geometry (`bom/route.ts:336-343`).

## 4. UNIFIED ENGINE REQUIREMENTS (must hold for roof/ground/fence)
1. **Mount type as a first-class input** — union incl. roof, ground (single/dual-post/driven-pile/helical/concrete), fence; branch ALL load cases. No path defaults to `roof_residential` for ground/fence.
2. **Single entry point, no dead engines** — retire V1/V3, one engine called by page + /calculate + BOM + report with the real mount type.
3. **Wind branches by mount** — roof zones; ground = exposed-terrain Kz at array height + open-structure coefficients + row-position/GCR; fence = ASCE Ch.29 freestanding-wall (full sail).
4. **Ground foundation engineering** — embedment from lateral load + soil class (IBC 1807.3), real `soilType`, frame/column/beam, overturning, lateral vs `pileCapacityLateralLbs`. No unsourced pile literals.
5. **Fence structural (net-new)** — `analyzeFence`: full-face wind, cantilever post overturning/bending, embedment vs moment+frost+soil, panel-as-infill load to posts.
6. **Snow branches** — roof slope-reduced; ground/tilted basis with drift; snow term added to pile downward demand (currently omitted).
7. **Jurisdiction-driven frost depth + soil** — auto-derived like wind/snow already are, not defaulted to 36".
8. **Single NEC engine with mount rules** — RSD suppressed for ground (690.12(B)(2)); NEC 300.5 underground PVC + burial; NEC 250.32 aux electrode at detached structure; direct-burial conductor; correct electrode count.
9. **Real run lengths** — DC/AC from actual array-to-service distance (trench), not roof 50/60 ft.
10. **Single geometry source** — pile/post counts/spacing/embed/tilt from CAD via the engine, not UI literals; placeholders flagged "estimated."
11. **Mount-aware BOM** — piles/footings/concrete-volume (ground), posts/rails/infill/post-footing (fence), rails/flashing (roof); read selected mounting from DB; adapter preserves the non-roof spec.
12. **Single grounding source** — one electrode system; dedup covers ground rod/wire/clamp.
13. **Sizing/layout feedback** — ingest groundTilt/rowSpacing/GCR + fenceHeight/fenceLine; persist rowSpacing/groundHeight in SystemDefinition.
14. **Brand coverage** — expand `supportedSystemTypes` for fence, or force a fence-capable brand, so non-EcoFlow/Enphase don't hard-error.

*(Full roof-assumption-leak table with 19 file:line fixes in the workflow result.)*

---

## ⚠️ LIABILITY NOTE
Ground foundation/embedment and fence post-overturning are **PE-stamped structural engineering**. The formulas for the unified engine (IBC 1807.3 lateral embedment, soil bearing, overturning) should be **validated by a licensed structural/PE** before their output is presented as engineered fact. Until then, ground/fence structural results should be labeled **"ESTIMATE — not engineered"** so no roof-stamped ground/fence design is submitted to an AHJ.
