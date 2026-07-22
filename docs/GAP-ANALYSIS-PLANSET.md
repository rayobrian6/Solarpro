# Planset Gap Analysis — SolarPro vs. Professional (Wyssling) Standard

**Date:** 2026-06-17
**Goal:** Make SolarPro's generated planset professional/permit-grade — the #1 selling factor to bring contractors in. (PE seal is handled externally; this analysis covers only what software must deliver.)

**Compared:**
- **SolarPro output:** `PermitPackage-Ray Test New - Roof Mount (4).html` — 16 sheets (rural Franklin test project, fusion-engine geometry)
- **Gold standard:** `Jaffree Athman 08-12-25 V2 Sealed.pdf` — Wyssling Consulting, PE-sealed, 26 pages (incl. ~16 datasheet pages)

---

## Verdict

SolarPro already produces the *right* document: same ANSI-B sheet taxonomy (PV-0…PV-5), real system data, a real drawn roof plan (facets/ridge/eave/fire-setbacks/dimensions), a real one-line (E-1), conductor schedule, labels, equipment schedule, an attachment cross-section (PV-3), and even a structural letter (PE-1) + validation gate (VAL-1). The **document engine is ~80% there.** The gap to "professional" is **engineering correctness + a few depth items**, not layout.

---

## TIER 1 — CRITICAL (these make the set look broken; fix first)

All in the **structural calc sheet (PV-4C)** — the numbers are empty/zeroed/failing:

1. **Design wind speed prints `— mph`** (HTML ~line 2223). The cover sheet says 115 MPH but the structural sheet shows a blank. A pro set never shows an empty load input. → wire the design wind speed into the structural engine's PV-4C output.
2. **Rafter analysis is zeroed out:** Bending Moment `0 ft-lbs`, Allowable Moment `0 ft-lbs`, Deflection `0.000" / 0.000"` (~lines 2246-2249) — yet Utilization shows 69%. The rafter bending/deflection calc isn't producing real numbers. → compute real rafter moment/allowable/deflection, or the sheet must not display zeroed rows.
3. **Lag-bolt safety factor 1.91 < 2.0 minimum** (~line 2259), rendered as a fail (470 lb uplift ÷ 900 lb capacity). Either the uplift/tributary inputs are wrong or attachment spacing must tighten so it passes. → resolve so it genuinely PASSES (Wyssling proves this with #14 lag = 229 lb/in × 2" embedment + 48" o.c.).
4. **Cross-sheet data inconsistency:** snow load = **25 PSF on PV-0** but **20 PSF on PV-4C** (and PE-1 letter says 20). Wind = 115 on PV-0 but `—` on PV-4C. → single source of truth for design criteria so every sheet agrees.

> Why Tier 1 first: a contractor glancing at "— mph", "0 ft-lbs", and a red 1.91 safety factor immediately distrusts the whole set. These are software bugs in the structural engine, high-impact, and self-contained.

## TIER 2 — DEPTH (match pro rigor)

5. **Conductor/conduit ampacity schedule (PV-4A/4B):** Wyssling shows a 9-row raceway table with full **NEC 310.15 derating math** — base ampacity @90°C, temp-correction factor (0.91), >3-conductor fill adjustment, adjusted-vs-max current, and EGC sizing per run. SolarPro's schedule has circuit/conductor/ampacity/OCPD/Vdrop/conduit/length but appears to skip the explicit derating columns. → add the derating math columns.
6. **Backfeed / 120% busbar calc (NEC 705.12(D)):** Wyssling computes it explicitly (200A × 1.20 − 150A main = 90A allowable backfeed). SolarPro shows **"705.12(B) REQUIRES REVIEW"** / "N/A — Supply-Side Tap" instead of a number. → compute the busbar math when panel/main-breaker data is present (this is partly a survey-data dependency — the calc should run when the data exists, and clearly state what's missing when it doesn't).
7. **Per-roof-plane geometry table (PV-2):** Wyssling breaks the array into sub-arrays with per-plane **module count / azimuth / tilt / truss** + roof-coverage % (e.g. 4 planes: 3/21/3/3 modules, az 180/180/180/270, tilt 29/29/10/36). SolarPro currently shows a **single plane / single azimuth (270°)**. → emit a per-plane table. (Ties into the canonical/fusion geometry — the harder, longer item.)

## TIER 3 — POLISH

8. **Equipment datasheets:** Wyssling bundles ~16 pages of OEM cut-sheets (Jinko, Enphase, Unirac). SolarPro has APP-A (a spec *summary*). → optionally attach real datasheet PDFs for the selected equipment.
9. **Signature/seal blocks:** SolarPro's CERT/PE-1 blocks are placeholders — **expected and fine** (seal is applied externally). No action.

---

## Recommended attack order

1. **Tier 1 structural-calc fixes** (wind speed, rafter math, safety factor, single-source design criteria) — biggest credibility win, self-contained engine work. Source: `lib/structural-engine-v2.ts` / `lib/engineering/reportGenerator.ts` (and the PV-4C composition).
2. **Tier 2 #5 + #6** (conductor derating table, busbar backfeed calc) — depth that matches Wyssling's electrical rigor.
3. **Tier 2 #7** (per-plane geometry table) — needs canonical multi-plane data; coordinate with the fusion geometry track.
4. **Tier 3** as polish.

Verify every engineering-math change by RUNNING the engine with real numbers (not just tsc) — these feed a permit set.
