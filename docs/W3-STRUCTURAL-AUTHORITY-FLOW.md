# W3 STRUCTURAL AUTHORITY-FLOW AUDIT — BEFORE state

**Date:** 2026-07-21 · **Branch:** dev · **HEAD:** `e3a54bf2` · **Deliverable:** W3 §13 (before/after
structural authority-flow report). **Mandate:** `docs/W3-DIRECTIVE.md`. **Companions:**
`docs/DATA-AUTHORITY-AUDIT.md` (07-19 register, P/N items), `docs/AUTHORITY-FLOW-AUDIT-PLANSET.md`
(07-20 electrical/W1 audit). **Reference project:** BRAIDON (GreenLancer feedback planset;
`_tmp_braidon_w21.snapshot.json`).

Every file:line below was opened and confirmed at `e3a54bf2`. This is the BEFORE section; the AFTER
section is appended when W3 lands snapshot-owned structural objects.

---

## 0. Executive summary

W1/W2 made ELECTRICAL truth canonical (computeSystem → snapshot → sheets). STRUCTURAL truth is still
created **outside** the snapshot in at least **four independent stacks that do not reconcile**:

1. **The V4 engine** (`lib/structural-engine-v4.ts`, `runStructuralCalcV4`) — the real engine of
   record, run once in `generatePermit.ts:405`, producing loads/reactions/capacities + a geometry-driven
   `calcRackingBOM`. Its result is flattened into `compliance.structural.{wind,snow,rafter,attachment}`.
2. **The drawing templates** (`lib/drafting/templates/roof.ts`, `ground.ts`, `fence.ts` +
   `lib/drafting/sheetComposition.ts`) — place modules, feet, rails and setbacks from **CAD geometry +
   local literals**, never from the engine result. Wind defaults to **90** on the PV-3 path while every
   HTML sheet defaults to **115** (the "115-vs-90 disagreement").
3. **The HTML structural sheets** (`lib/permit/sections/structuralPages.ts`, `certPages.ts`) — read
   `compliance.structural` but ALSO re-implement a complete fence wind/embedment engine inline and print
   three different acceptance thresholds (SF **1.0 / 1.5 / 2.0**).
4. **A third racking-BOM path** (`lib/bom-system-profiles.ts` `deriveStructuralBOM`, used by the SCHED
   hardware schedule) that is not the V4 `calcRackingBOM` the PV-4C/mounting sheets and permit BOM use.

The snapshot's `structural` block (`lib/permit/snapshot/build.ts:463-486`) is a **read-only mirror** of
`compliance.structural`; it carries `attachmentCount/railTotalFt/railCount/spliceCount = null` and
explicitly records in `gaps` that attachment/rail coordinates and rail totals are not snapshot-owned.
So NO renderer today reads structural truth from the snapshot; the snapshot merely observes it.

Because equipment stores disagree on the SAME SKU (RT-MINI uplift **600 allowable** vs **900 ultimate**;
wind **180** vs **150**) and Braidon has **no verified roof framing**, the honest end-state for Braidon
is `PENDING STRUCTURAL ENGINEERING REVIEW`.

**Total violation sites catalogued: 71** (see §Violation inventory summary).

---

## 1. Module placement / geometry (module polygons, dims, orientation, row/col)

Truth is created in **five** independent places; no frozen instance list of module footprints exists.

- `lib/permit/snapshot/build.ts:148-165` — snapshot `geometry.modules` built from `project.panelPositions`
  (lat/lng/row/col/orientation only — **no polygon, no footprint dims per instance**) and
  `geometry.roofPlanes` from `cad.roof.planes`. Provenance `'project.panelPositions + cad.roof.planes'`.
  `gaps` (:431-435) states "module footprints (record dims × coordinates) not yet snapshot-owned (V8
  deferred to W3)". → flows to: nothing structural yet (observational).
- `lib/drafting/templates/roof.ts:149-150` — `panelLenIn = project.panelLengthIn || 66`,
  `panelWidIn = project.panelWidthIn || 40` (generic module size). Module rectangles drawn at these dims
  (:919-920 `panLenPx/panWidPx`), rotated per plane, one polygon per placed position (draw loop
  :917-1094). → flows to: **PV-1/PV-2 drawn array footprint, and the NEW-ARRAY-AREA stat** (N-1).
- `lib/permit/sections/sitePlan.ts:73-74` — same `|| 66 / || 40` generic fallback; nearest-neighbour
  spacing INFERENCE when `panelWidthIn` unset (:360). → flows to: site-plan module blocks.
- `lib/permit/sections/arrayPages.ts:468-469` — `legacyL = project.panelLengthIn || 66`,
  `legacyW = project.panelWidthIn || 40` used to recompute fire-setback coverage; watts `|| 400`
  (:322, :339). → flows to: **PV-1B geometry + 18"-vs-36" fire band**.
- `lib/permit/utils/structuralInput.ts:94-96` — per-sub dims from `arrayLayout` (correct: equipment-db
  via §1.1 map), `rowCount/colCount` (:98-99), orientation (:97). This is the ONE good per-sub source but
  it feeds only the ENGINE, not the drawings. → flows to: V4 dead-load area.

Orientation/row/col: `snapshot.geometry.modules[].{row,col,orientation}` (build.ts:156) exist but are
copied verbatim from `panelPositions`; the drawings derive their own grid from framing lines
(roof.ts:729-779) rather than the row/col authority.

**Braidon reality:** snapshot has 31 module instances across 2 planes (12 @ pitch 16.5°/az 0°, 19 @
pitch 18.2°/az 180°); equipment record dims are 70.9×41.7 in (Q.PEAK DUO 400W), but the drawings will
read `project.panelLengthIn/WidthIn` and can fall to 66×40 — a live dims-source split.

---

## 2. Roof planes, fire setbacks, pathways, obstructions, usable-area

Setbacks/pathways are **sheet-generated offsets**, not canonical polygons (directive §3 violation).

- `lib/permit/snapshot/build.ts:198-206, 428-435` — `geometry.roofPlanes` carries only
  `pitchDeg/azimuthDeg/moduleCount` per plane (from `cad.roof.planes`); NO polygon, framing direction,
  edges, setbacks, pathways, obstructions, or usable-area. `gaps` (:431-432): "setback/pathway polygons
  remain sheet-computed until W3".
- `lib/permit/utils/fireSetback.ts` — `resolveFireSetbackIn` / `arrayCoverageFrac`: the shared rule that
  DECIDES the 18"-vs-36" band. Good that it is shared, but it is a per-sheet computation over module
  geometry, not a stored polygon. Consumed by `arrayPages.ts:15,453-489`, `sitePlan.ts`,
  `sheetComposition.ts` (`_covPitch`, :410).
- `lib/drafting/templates/roof.ts:169-170` — attachment/setback offset chain
  `... || project.attachmentSpacing || 48`; roof.ts:219 comment "AHJ-supplied value always wins" but the
  fallback is a literal band. Setback bands drawn as red-hatched offsets in the plan pass.
- `lib/permit/sections/arrayPages.ts:507-510` — ridge fire-setback text + `36" access pathway per AHJ`
  **literal** (not AHJ-sourced). IFC 2021 §1204.2.1.1 printed literally.
- `lib/permit/sections/sitePlan.ts` — legend hardcodes setback text against the computed band (prior
  audit sitePlan:636 class; the site legend narrates a fixed band string).
- `lib/drafting/sheetComposition.ts:333` groundClearIn `|| 18`, `:330-331` tiltDeg `|| 20` / azimuth
  `|| 180` defaults substitute for missing plane geometry.

Obstructions: placed from `cad` vents/obstructions in the drawing layer only; no snapshot object.
Usable-area polygon: does not exist anywhere — each sheet re-derives coverage from module bboxes.

**Directive §3 blocker not implemented:** "If roof geometry or required setback authority is missing or
contradictory, generation must block permit-ready status." No such structural-geometry blocker exists;
`permitReadiness.blockers` (build.ts:496-510) covers only ROUTE-LENGTH, EQUIPMENT-IDENTITY, and
ENGINEERING-REVIEW.

---

## 3. Rails (counts / lengths / spans / splices)

Rail truth is created **three** times and is NOT snapshot-carried (`snapshot.structural.railTotalFt =
railCount = spliceCount = null`, build.ts:466-468).

- **Engine (geometry-derived, correct math):** `lib/structural-engine-v4.ts` `calcRackingBOM` (:894-1045)
  — `railSectionLenFt = rail.spliceIntervalIn/12 ?? 14` (:908), `railsPerRun = ceil(railLengthFt /
  railSectionLenFt)` (:910), `railQty = railsPerRun · geometry.railCount` (:911), splices
  `max(0, railsPerRun−1)·railCount` (:914-915). Rail span/cantilever check `analyzeRail`: cantilever
  `min(span/3, rail.maxCantileverIn)` (:662), `utilization = M_demand / rail.momentCapacityInLbs` (:676),
  span check vs `rail.maxSpanIn` (:679-681). → flows to: PV-4C rail check, permit BOM rail rows.
- **Permit BOM wrapper:** `lib/permit/utils/bomForPermit.ts:582-584` uses V4's `rackingBOM` as
  `roofRackingBOM`; but if absent, GUESSES `railSections = ... || Math.ceil(totalPanels/2)` (:633) and
  `attachmentCount || Math.ceil(totalPanels*1.2)` (:632). → flows to: BOM schedule.
- **Drawn rails (renderer-invented):** `lib/drafting/templates/roof.ts:1014-1094` — two rail lines per
  module row at 25%/75% points, feet stepped at `railFootOcIn = 48` hardcode (:174, :1049
  `stride = (48/12·FT)/rafStep`), end-cantilever guard 18" (:1027, :1076). **These drawn rails have no
  relationship to the engine's rail count/length.** → flows to: PV-1/PV-2 and PV-3 drawn rails.
- **Third schedule path:** `lib/bom-system-profiles.ts:109 deriveStructuralBOM` (+ `:70` fence railCount
  from `CADFenceModel.railCount`, `:240` fenceCAD default "2 rails") — used by SCHED
  (`structuralPages.ts:943 renderHardwareSchedule`, invoked :1447). Not the V4 `calcRackingBOM`.

No rail carries an ID, coordinates, supported-module refs, or provenance anywhere. Directive §5
(canonical rail objects) is entirely unbuilt. `snapshot.equipment.rail = null` (build.ts:425; Braidon
confirms `equipment.rail: null` despite RT-MINI being rail-based).

---

## 4. Attachments / mounts (positions, spacing, counts, tributary, reactions, capacity, SF)

Independent calculators: **the V4 engine, the drawings, the permit BOM, and per-sub subSystemSheets** —
four, plus a dead v3 path.

- **Spacing (esp. 48"):**
  - Engine RESOLVES spacing by iterating down from `mount.maxSpacingIn` until SF ≥ MIN_ATTACHMENT_SF
    (`structural-engine-v4.ts:580,617`); result stored as `attachment.maxAllowedSpacing`
    (`generatePermit.ts:471`).
  - `snapshot.structural.attachmentSpacingIn` = `(struct.attachment).maxAllowedSpacing`
    (build.ts:466) — Braidon = **48**.
  - Drawn feet ignore the engine value: `roof.ts:174 railFootOcIn = 48` (hardcode); offset chain
    `roof.ts:169-170 ... || 48`; `sheetComposition.ts:463-468 ... || 48`. So the drawn feet O.C. and the
    printed ATTACH SPACING can disagree.
- **Counts:** engine `mountCount = mountsPerRail · railCount`, `mountsPerRail = ceil(railLengthIn/
  spacing)+1` (`structural-engine-v4.ts:631-632`). BOM fallback `ceil(panels*1.2)` (bomForPermit.ts:632).
  `snapshot.structural.attachmentCount = project.attachmentCount ?? null` (build.ts:465) — **null for
  Braidon** (engine count not propagated to the snapshot).
- **Tributary area:** engine `tribAreaFt2 = (spacingIn · railSpacingIn/2)/144`
  (`structural-engine-v4.ts:600,614,623`). Not stored per-attachment.
- **Reactions:** uplift `asdUpliftDemandLbs = 0.6·W·A` (`attachmentCapacity.ts:71-76`, called
  `structural-engine-v4.ts:615/624`); ground pile uplift/downward/lateral (`:801-804`,
  `lateral = uplift·0.3`). Reported only as scalars on `compliance.structural.attachment`.
- **Capacity:** `allowableUpliftLbs(mount.upliftCapacityLbs, mount.capacityBasis)`
  (`attachmentCapacity.ts:58-64`, Ω=3.0 :41), called `structural-engine-v4.ts:583`. `generatePermit.ts:470`
  re-derives `lagBoltCapacity = upliftPerMount · (safetyFactor || 2)` — injects a **"2" multiplier**
  fallback outside the engine.
- **Safety factor:** engine `sf = allowableCap/upliftPerMount`, PASS ≥ `MIN_ATTACHMENT_SF = 1.0`
  (`attachmentCapacity.ts:51`; `structural-engine-v4.ts:617,1300`). Ground uses `≥ 1.5`
  (`structural-engine-v4.ts:813`).
- **Independent per-sub calculator:** `lib/permit/sections/subSystemSheets.ts:338-343` re-derives
  `lagBoltCapacity = upliftPerMountLbs · safetyFactor` and reads `ml.safetyFactor` directly.
- **Dead engine path:** `lib/structural-engine-v3.ts:521,568-570` reads `mount.upliftCapacityLbs` RAW,
  ignores `capacityBasis`, applies flat `/1.5` (double-reduces an allowable-basis mount). Confirmed no
  live importers — but the code remains.

No attachment carries an ID, coordinate, substrate/framing member, or provenance. Directive §6
(canonical attachment objects) unbuilt. Drawings place feet by their own geometry (roof.ts:1068-1094),
so "the data table, structural calculation, BOM and drawing all reference the same attachment IDs"
(§6) is false today.

---

## 5. Structural environmental values (wind / exposure / snow / risk / ASCE) — the 115-vs-90 fight

**Wind speed — the central contradiction:**

| Site | file:line | Default | Prints on |
|---|---|---|---|
| Drawing PV-3/roof structural detail | `lib/drafting/templates/roof.ts:1990` | **90** | PV-3 `WIND ... MPH` (:2323), `WIND LOAD ... ASCE 7-22` (:2427) |
| Drawing fence detail | `lib/drafting/templates/fence.ts:522-523, 1203` | **115** | fence sheets |
| Drawing ground | `lib/drafting/templates/ground.ts:877` (site→ahj→…) | 0→ | ground sheets |
| sheetComposition fence/ground data | `lib/drafting/sheetComposition.ts:300,346,472` | **115** | data zones (`... || 115`) |
| Cover sheet | `lib/permit/sections/coverSheet.ts:312` | (blank) reads `project.ahjWindSpeedMph||windSpeedMph` | cover design-loads |
| Legacy cover artifact | `lib/permit/buildPermitCoverSheet.ts:122` | **115** | (secondary path) |
| Canonical fill | `lib/permit/generatePermit.ts:353` | **115** ("ASCE 7-22 code minimum") | feeds engine + sheets |
| Structural input | `lib/permit/utils/structuralInput.ts:36` | `canonical.site.windSpeed || 115` | engine |
| Engine fence rated | `lib/structural-engine-v4.ts:1079` | `RATED_WIND_MPH = 115` | fence pass gate |
| Snapshot mirror | `lib/permit/snapshot/build.ts:470` | `(struct.wind).windSpeed ?? project.windSpeedMph ?? null` | evidence |

→ Because `generatePermit.ts:340-354` back-propagates `canonical.site.windSpeed` onto
`project.windSpeedMph` ONLY when unset, and `roof.ts:1990` defaults to **90** while everything else
defaults to **115**, a project with no AHJ wind can print 90 on PV-3 and 115 on the cover/fence/data
zones. **Braidon evidence** (`docs/evidence/braidon-w2.1.planset-evidence.json`) already flags
`structural.loads.windSpeedMph` as a cross-sheet DISAGREEMENT.

**Exposure category:**
- Engine input `structuralInput.ts:72-75` coerces `canonical.site.exposureCategory || 'C'`.
- `structuralPages.ts:135 || 'C'`, `:429 || 'C'`, `:649 || '—'` (roof reads engine, ground/fence default C).
- `sheetComposition.ts` fence data zone forces `Cf = 1.3 (ASCE 7-22 §29)` **literal** (:497, :508) and
  `Kz`/exposure-C assumptions regardless of engine result.
- `certPages.ts:238,326,430` print `Exposure Category ${exposure}` off `compliance.structural`.

**Snow:**
- Engine `calcRoofSnowLoad` (`structural-engine-v4.ts:403-417`) with `Ce=1.0`(:406), `Ct=1.0`(:407),
  `Is=1.0`(:408), `0.7` flat-roof factor (:413), `Cs = pitch≤5?1:cos(pitch)`(:411) — all literals.
- `snapshot.structural.loads.snowPsf = (struct.snow).groundSnowLoad ?? null` (build.ts:472). Braidon = **0**.
- Cover reads `project.ahjGroundSnowPsf ?? groundSnowPsf` (`coverSheet.ts:314`); separate chain from
  the engine snow. `buildPermitCoverSheet.ts:125 ?? 0`.
- `sheetComposition.ts:347 snowPsf = ahjGroundSnowPsf || 0` (direct AHJ read, bypasses engine).

**Risk category:** `certPages.ts:239` prints `Risk Category — II (Residential)` **hardcoded** (no
authority object). No `riskCategory` field anywhere in the snapshot or engine input.

**ASCE edition:** `'ASCE 7-22'` is a literal on ~90 sites (roof.ts:2427, fence.ts, ground.ts:1095,
sheetComposition.ts:497/508/529/539/562/617/655, structuralPages.ts:351/591/871, certPages, etc.).
Per directive §7, W3 must route these through the snapshot code-authority interface (final population is
W4) — today none of them read a code-authority field.

---

## 6. Safety-factor / utilization thresholds (the 1.0-vs-2.0 conflict)

The engine has ONE coherent rule set, but the SHEETS print **three different printed thresholds** and
narrate 2.0 beside a 1.0 test.

- **Canonical rule:** `lib/structural/attachmentCapacity.ts:51 MIN_ATTACHMENT_SF = 1.0` (demand and
  capacity both ASD; margin lives inside the allowable). Engine PASS at `≥1.0`
  (`structural-engine-v4.ts:617`); ground piles `≥1.5` (`:813`) — a legitimately different limit state.
- **Printed "2.0" that contradicts the 1.0 test:**
  - `structuralPages.ts:871` — "…minimum safety factor of **2.0**" (lag bolt prose) directly ABOVE the
    actual test at `:881,:887` which uses `MIN_ATTACHMENT_SF` (=1.0). Self-contradictory on one sheet.
  - `structuralPages.ts:591` — ground "…safety factor of **2.0** against pile withdrawal" prose, while
    the pass test at `:607` uses `MIN_ATTACHMENT_SF`.
- **Printed "1.5":**
  - `structuralPages.ts:370,372` — fence "minimum safety factor of **1.5** (overturning)".
  - `certPages.ts:308` — fence PE letter "Safety Factor (Overturning) … (min. **1.5** req.)".
  - `structural-engine-v4.ts:813` ground `≥1.5`; `certPages.ts:412`/`structuralPages.ts:607` ground use
    `MIN_ATTACHMENT_SF` (1.0) — so ground itself is inconsistent (engine 1.5 vs sheet prints 1.0 bar).
- **Printed "1.0" (correct bar):** `certPages.ts:412,575`, `structuralPages.ts:607,881,887` all use
  `MIN_ATTACHMENT_SF.toFixed(1)` = "1.0".
- **Utilization:** engine `overallUtil = max(bending,shear,deflection)`, PASS `≤1.0`
  (`structural-engine-v4.ts:536,558`; truss :470; rail :679). Sheets print `utilizationRatio ≤ 1.0`
  colouring (`structuralPages.ts:745,752,880`; certPages.ts:567; snapshot passes test build.ts:478-479).
- **"2" multiplier injected outside the engine:** `generatePermit.ts:470` `lagBoltCapacity =
  upliftPerMountLbs · (safetyFactor || 2)` and `subSystemSheets.ts:342` same pattern.

Per directive §9 each check must name demand/capacity/ratio/threshold/source and print identically
everywhere. Today the same lag-bolt check is narrated with three different minimum-SF numbers.

---

## 7. Structural BOM rows (geometry-derived vs entered/estimated)

Three producers, no reconciliation, plus guess fallbacks.

- **V4 `calcRackingBOM`** (`structural-engine-v4.ts:894-1045`) — geometry-driven per-mount/per-panel:
  rails :908-911, splices :914-915, mounts `mountLayout.mountCount` :918, mid/end clamps
  `geometry.total{Mid,End}Clamps` :921-922, ground lugs `ceil(panels/2)` :925, lag bolts
  `mountQty·fastenersPerMount` :928-929, T-bolts :933, flashing (if `!selfFlashing`) :938-941, bonding
  clips `= totalPanels` :944. → flows to: permit BOM (via bomForPermit), PV-4C/mounting detail.
- **Permit BOM guess fallbacks:** `bomForPermit.ts:632` `attachmentCount || ceil(panels*1.2)`,
  `:633` `railSections || ceil(panels/2)`. Used when `roofRackingBOM` is absent → NOT geometry-derived.
- **SCHED third path:** `bom-system-profiles.ts:109 deriveStructuralBOM` (fence sections
  `ceil(len/8)` :277, `ceil(panels/2)` :315; SolFence 8-ft `SECTION_WIDTH_FT = 8` :270), consumed by
  `structuralPages.ts:943 renderHardwareSchedule`. This can disagree with the V4 rackingBOM the BOM
  schedule uses.
- **Ground pile spacing contradiction:** drawing/data zone uses **20 ft** PLP bay
  (`sheetComposition.ts:340-342`, `structuralPages.ts:1038` "Speck PLP POWER DRIVE") while the fence/
  ground BOM profiles pile at **8 ft** section width (bom-system-profiles.ts:270); DATA register P/N
  note "ground BOM piles at 8-ft vs 20-ft PLP bays on the drawing".
- `snapshot.structural.{railTotalFt,railCount,spliceCount} = null` (build.ts:466-468) — structural BOM
  quantities are NOT snapshot-carried. Directive §10 (BOM rows must carry source object IDs) unbuilt.

---

## 8. Renderer → sheet map (file + entry function) — STRUCTURAL portions

Active pipeline is `generatePermit.ts:57 generatePermitHTML`; page array assembled at `:1125-1168`;
structural authority computed once at `:397-477` (V4) → `compliance.structural`.

| Sheet | Renderer file | Entry function : line | Structural input source |
|---|---|---|---|
| PV-1 / PV-2 (roof/site plan) | `lib/permit/sections/arrayPages.ts` | `pageArrayPrimary:624` → `pageRoofPlan:23` → drafting `lib/drafting/templates/roof.ts` `drawRoofPlan:138` | CAD geometry + `project.panel*` literals (66/40) |
| PV-1B (physical array geometry) | `lib/permit/sections/arrayPages.ts` | `pageArrayGeometry:132` | CAD geometry + fleet strings; fire band recomputed :453-489 |
| PV-3 (attachment/racking cross-section) | `lib/permit/sections/structuralPages.ts` | `pageStructuralPrimary:1464` → `pageRoofStructural:29` → drafting `roof.ts drawRoofStructural:1946` | CAD + manufacturer-asset; **wind 90 default :1990**; NOT engine |
| PV-4C (structural calcs) | `lib/permit/sections/structuralPages.ts` | `pageStructural:929` → `pageStructuralRoof:637` / `pageStructuralGround:422` / `pageStructuralFence:121` | `compliance.structural`; fence variant recomputes ASCE §29.4 inline |
| SCHED (racking/structural schedule) | `lib/permit/sections/structuralPages.ts` | `pageEquipmentSchedule:1237` → `renderHardwareSchedule:943` | `deriveStructuralBOM` + `input.layout` scalars (NOT engine rackingBOM) |
| CERT (certification) | `lib/permit/sections/certPages.ts` | `pageEngineerCert:47` | `compliance.structural.rafter.utilizationRatio` (:72) gates banner |
| PE-1 (PE structural letter) | `lib/permit/sections/certPages.ts` | `pagePELetter:629` (single); `pagePELetterRoof:449` / `pagePELetterGround:344` / `pagePELetterFence:244` | `compliance.structural.{wind,rafter,attachment}` + `getMountingSystemById`; mount default `'IronRidge XR100'` :517 |
| Cover structural summary | `lib/permit/sections/coverSheet.ts` | `pageCoverSheet:29` (rows :312-334) | `project.ahjWindSpeedMph/windExposure/ahjGroundSnowPsf` scalars |

Secondary/parallel structural renderers NOT in the main permit pipeline (standalone
`/api/engineering/plan-set` route, `route.ts:36,39,707,757`): `lib/plan-set/structural-sheet.ts`
(`buildStructuralSheet`), `lib/plan-set/mounting-details-sheet.ts` (`buildMountingDetailsSheet`),
and `lib/permit/buildPermitCoverSheet.ts:710` (`buildPermitCoverSheetArtifact`). These carry their own
`structuralStatus = 'PASS'` (route.ts:453) and 115/0 defaults — a second, divergent structural surface.

---

## 9. Existing racking assembly data (SKUs) + rail-less vs railed

**Stores:**
- `lib/mounting-hardware-db.ts` — the STRUCTURAL store. `MountingSystemSpec` :157-190
  (`RailSpec` :59-73 momentCapacity/maxSpan/spliceInterval; `MountSpec` :75-102 uplift/capacityBasis/
  fasteners/embed/maxSpacing/iccEsReport/selfFlashing; top-level maxWind/maxSnow :176-179; provenance =
  free-text `engineeringDataSource` + `lastUpdated` :188-189). SKUs: `ironridge-xr100:297` (uplift 500
  allowable :323, ESR-2962), `rooftech-mini:543` (uplift **600 allowable** :564-565, 2 fasteners, embed
  2.5, maxSpacing 48, wind 180/snow 90 :588-589, ESR-3575), `ground-dual-post-driven:1601` (uplift 8000,
  no capacityBasis). Resolvers `getMountingSystemById:2683`, `resolveMountingSystemId:2735`.
  **`solfence-8ft` is ABSENT** → `getMountingSystemById('solfence-8ft')` returns `undefined`; any
  IronRidge fallback is imposed by callers, e.g. `structuralInput.ts:100 || 'ironridge-xr100'`.
- `lib/equipment-db.ts` — `RackingSystem` :171-200, `getRackingById:2463`. `solfence-8ft:2404`
  (**maxWind 115 / maxSnow 113** :2410 — the ONLY branded SolFence rating). `rooftech-mini:2375`
  (**maxWind 150 / maxSnow 45** :2381, discrete loadModel, `upliftCapacity:450` lbf/bolt :2394).
  **No Speck PLP / POWER DRIVE structural record** — PLP exists only as geometry constants in
  `lib/3d/ground/groundMountRealityEngine.ts` (`PLP_BAY_SPAN_M=6.10:272`, header "SP3284 RevE":89) with
  NO wind/snow/uplift rating.
- `lib/equipment/integratedBos.ts` — BOS "brains" (IQ Combiner 6C/5C/4C :78-116, AC combiner panels
  :185-208); electrical only, no racking data. Permit wrapper `lib/permit/utils/integratedEquipment.ts:34-74`.

**RT-MINI capacity conflict across stores (same SKU):**

| Store | file:line | Uplift | Wind/Snow | Basis field |
|---|---|---|---|---|
| mounting-hardware-db (authority) | `:564 / :588-589` | **600** lb/pad allowable | 180 / 90 | `capacityBasis:'allowable'` |
| equipment-registry-v4 | `:2574 / :2579 / :2567-2568` | **900** (2×450) | 150 / 45 | none |
| equipment-registry (legacy) | `:1024` | 450/bolt (→900) | 150 / — | none |
| equipment-db | `:2394 / :2381` | 450/bolt (→900) | 150 / 45 | none |

→ ~1.5× uplift discrepancy and 180-vs-150 wind on ONE mount; only the authority store carries a basis.

**Rail-less vs railed:** NO contradiction found. All decision sites use the same predicate and exclude
RT-MINI (it is RAILED): `bom-engine-v4.ts:317` `RAIL_LESS_ROOF_RACKING = new Set([])` (empty),
`roof.ts:159` + `:1978` regex `/RAIL-?LESS|RT[- ]?APEX|E[ -]?MOUNT ?AIR/`, `sheetComposition.ts:679`
same regex. Registry topology tags agree (`equipment-registry-v4.ts:2563-2571 ROOF_RAIL_BASED
requiresRail:true`). One asymmetry (not a contradiction): `equipment-db RackingSystem` has no
`requiresRail` field, so drawing paths rely on the name regex there while BOM v4 reads
`structuralSpecs.requiresRail`.

**Datasheet-revision / verified / capacity-source field:** ABSENT as a structured field in every
racking store. Only `lib/data/manufacturer-assets/roof_racking.json` carries `verified` + doc revision,
but it governs page-image ASSETS, not capacity values — disconnected. This is the core gap for the
directive §4 versioned racking assembly record.

---

## 10. Braidon structural data available (provenance + framing gaps)

From `_tmp_braidon_w21.snapshot.json`:

- **Roof planes:** 2 planes, `cad.roof.planes`-sourced pitch **16.5° / 18.2°**, azimuth 0/180, 31
  modules (12 + 19). Provenance `'project.panelPositions + cad.roof.planes'`. No polygon/edges/framing
  direction. Confidence not recorded.
- **Mount:** `rooftech-mini` RT-MINI, `verified:true`, uplift **600 allowable**, 2 fasteners 5/16",
  embed 2.5", maxSpacing 48, ESR-3575, self-flashing. `equipment.rail: null` (rail-based mount, no rail
  record).
- **Loads:** wind **115** (the code-minimum DEFAULT, not an AHJ value — flagged as a cross-sheet
  disagreement in `braidon-w2.1.planset-evidence.json`), exposure **C**, snow **0**. Source
  `'structural-engine-v4'`.
- **Governing:** utilization 0.392, safetyFactor 1.487, passes true — but computed against DEFAULT
  framing: `structuralInput.ts:35 roofPitch`, `:38 rafterSize || '2x6'`, `:39 rafterSpacing || 24`,
  `:83-89 species → 'Douglas Fir-Larch'` default; 24" spacing auto-detects TRUSS
  (`structural-engine-v4.ts:436`) and looks up `TRUSS_CAPACITY_PSF ?? 45` (:446). **Braidon supplies NO
  verified rafter size/spacing/species/span** → the "truss capacity" and utilization are computed off
  defaults, exactly the "unsupported truss capacity" the directive §8 forbids.
- **Attachment/rail objects:** `attachmentCount/railTotalFt/railCount/spliceCount = null`; snapshot
  `structural.gaps` records both W3 deferrals.
- **Existing blockers (permitReadiness.ready=false):** ROUTE-LENGTH-ESTIMATE, EQUIPMENT-IDENTITY-CONFLICT
  (`subSystems.roof.panelId='rec-alpha-pure-405'` REC 405W vs fleet `Q.PEAK DUO 400W`),
  ENGINEERING-REVIEW-PENDING.

**Gaps that will force `PENDING STRUCTURAL ENGINEERING REVIEW` for Braidon (directive §12):**
1. Unverified roof framing (size/spacing/species/span all defaulted → fabricated truss capacity).
2. Wind = 115 default (no AHJ authority); snow = 0 unverified; risk category not carried.
3. No canonical rail objects and no attachment coordinates/objects (drawings self-place).
4. `solfence`-style mount-record gap does not bite Braidon (roof RT-MINI resolves), but the RT-MINI
   uplift store conflict (600 vs 900) means the capacity number is not single-sourced.
5. Module-identity conflict already blocking (carry-forward electrical/equipment blocker).

---

## Violation inventory summary

| # | Category | Sites | Key files (file:line) |
|---|---|---:|---|
| 1 | Module placement/geometry (dims outside snapshot; generic 66/40) | 6 | build.ts:148-165; roof.ts:149-150,919-920; sitePlan.ts:73-74,360; arrayPages.ts:468-469,322,339; structuralInput.ts:94-99 |
| 2 | Roof planes/setbacks/pathways/usable-area (sheet-generated offsets) | 7 | build.ts:198-206; fireSetback.ts; roof.ts:169-170,219; arrayPages.ts:507-510; sitePlan legend; sheetComposition.ts:330-333 |
| 3 | Rails (3 producers, none snapshot-carried) | 6 | structural-engine-v4.ts:894-915,662-681; bomForPermit.ts:582-584,633; roof.ts:1014-1094,174; bom-system-profiles.ts:109,70; build.ts:425,466-468 |
| 4 | Attachments/mounts (spacing/count/reactions/capacity/SF, 4 calculators) | 10 | structural-engine-v4.ts:580,600-632,617,1300; roof.ts:174,1068-1094; bomForPermit.ts:632; generatePermit.ts:470-471; subSystemSheets.ts:338-343; structural-engine-v3.ts:521,568-570 |
| 5 | Structural environmental values (wind 90-vs-115, exposure, snow, risk, ASCE) | 14 | roof.ts:1990,2323,2427; fence.ts:522-523,1203; ground.ts:877; sheetComposition.ts:300,346,472,497,508,347; coverSheet.ts:312,314; generatePermit.ts:340-354; structuralInput.ts:36,72-75; structural-engine-v4.ts:403-417,1079; certPages.ts:239; build.ts:470-472 |
| 6 | Safety-factor / utilization thresholds (1.0 vs 1.5 vs 2.0) | 9 | attachmentCapacity.ts:51; structuralPages.ts:370,372,591,871,881,887,607; certPages.ts:308,412,575; structural-engine-v4.ts:617,813; generatePermit.ts:470; subSystemSheets.ts:342 |
| 7 | Structural BOM (3 paths + guesses + 8-vs-20 pile spacing) | 6 | structural-engine-v4.ts:894-944; bomForPermit.ts:632-633; bom-system-profiles.ts:109,270,277,315; structuralPages.ts:943,1038; sheetComposition.ts:340-342; build.ts:466-468 |
| 8 | Renderer entry points (structural sheets) | 8 | arrayPages.ts:23,132,624; structuralPages.ts:121,929,1237,1464; certPages.ts:47,244,344,449,629; coverSheet.ts:29; roof.ts:138,1946; + secondary plan-set/structural-sheet.ts, buildPermitCoverSheet.ts:710 |
| 9 | Racking assembly stores + SKU capacity conflicts | 5 | mounting-hardware-db.ts:157-190,543-589 (solfence absent); equipment-db.ts:2375-2410; equipment-registry-v4.ts:2567-2579; groundMountRealityEngine.ts:272 (no PLP rating); roof_racking.json (verified disconnected) |
| 10 | Braidon framing/geometry gaps (force PENDING review) | — | snapshot structural/geometry gaps; structuralInput.ts:35-39,83-89; structural-engine-v4.ts:436,446 |
| | **TOTAL** | **71** | |

---

## Recommended canonical object seams (where snapshot builders should source each authority)

1. **Module geometry → `snapshot.geometry.modules[]` with footprint polygons.** Seam: extend
   `build.ts:148-165` to compute each instance's polygon from the resolved equipment record dims
   (`resolvePanelSpecs` via the §1.1 map, as `structuralInput.ts:94-96` already does) × its
   lat/lng/orientation — NEVER `project.panelLengthIn||66`. Retire the `||66/40` fallbacks in
   `roof.ts:149-150`, `sitePlan.ts:73-74`, `arrayPages.ts:468-469`; drawings read the polygon.
2. **Roof planes + setbacks/pathways/usable-area → `snapshot.geometry.roofPlanes[]` (add polygon, pitch,
   azimuth, framing dir/spacing, edges) + `snapshot.geometry.setbacks/pathways/usableArea` canonical
   polygons.** Seam: promote `fireSetback.resolveFireSetbackIn` output to stored polygons in `build.ts`;
   add a permitReadiness blocker when plane geometry or required setback authority is missing
   (directive §3). Drawings and `sheetComposition` read the polygons, not `||48` offsets.
3. **Rail objects → `snapshot.structural.rails[]` (id, planeId, start/end, length, stockLen, spans,
   splices, supported module IDs, attachment IDs, span limit, utilization, provenance).** Single source:
   V4 `calcRackingBOM` + `analyzeRail` (`structural-engine-v4.ts:894-1045,662-681`). Delete the drawn-rail
   invention (`roof.ts:1014-1094`) — draw from rail objects — and the `bom-system-profiles`
   `deriveStructuralBOM` rail path for roof.
4. **Attachment objects → `snapshot.structural.attachments[]` (id, railId, planeId, coordinate, zone,
   member, method, fastener model/count, embedment, tributary, reactions, allowable capacity, SF,
   provenance).** Single source: V4 engine mount loop (`structural-engine-v4.ts:600-632`). Feet placement
   in `roof.ts:1068-1094` reads coordinates. Retire the `generatePermit.ts:470 · (safetyFactor||2)` and
   `subSystemSheets.ts:342` re-derivations and the dead v3 path.
5. **Environmental authority → `snapshot.structural.loads` (add ultimateWindSpeed + source, exposure,
   riskCategory, groundSnow, roofSnow, ASCE edition ref via code-authority interface, C&C zones,
   uplift/downforce pressures, provenance).** Single source: `canonical.site` → V4 engine → snapshot.
   Delete the `roof.ts:1990 ?? 90` default (make it read the snapshot), collapse every `||115` /`||'C'`
   /`||0` sheet fallback to the snapshot value; add a wind/snow-authority-missing blocker (directive §7,§12).
6. **One acceptance rule per check → `snapshot.structural.checks[]` (demand, capacity, D/C, SF,
   threshold, limitState, pass, source).** Single source: `attachmentCapacity.MIN_ATTACHMENT_SF` (roof
   lag = 1.0), ground pile = 1.5 as a distinct named limit state; fence overturning = 1.5. Replace the
   prose literals `structuralPages.ts:591,871` (2.0) and reconcile ground `certPages.ts:412` /
   `structuralPages.ts:607` so the printed bar matches the engine's `:813` 1.5.
7. **Structural BOM → derive every row from snapshot module/rail/attachment/splice/clamp/bonding objects,
   each row carrying source object IDs.** Single source: V4 `calcRackingBOM` for ALL structural sheets;
   retire `bom-system-profiles.deriveStructuralBOM` for roof and the `bomForPermit.ts:632-633` guesses;
   reconcile the 8-vs-20 ft pile spacing to the PLP bay authority.
8. **Versioned racking assembly record → `snapshot.equipment.racking` (mount+rail+clamp+fastener+splice
   SKUs, capacity source + datasheet revision + verified, UL 2703 basis, compatible module thickness).**
   Seam: unify the RT-MINI capacity conflict onto `mounting-hardware-db` (600 allowable), add a structured
   revision/verified/source field (bind to `roof_racking.json`), add a `solfence-8ft` mounting-hardware-db
   record (currently absent → IronRidge fallback), and add a Speck PLP structural rating record (currently
   geometry-only). Block permit-ready on unsupported mixed-manufacturer assemblies (directive §4,§12).

---

## AFTER (W3 Phase B — landed 2026-07-21, dev, uncommitted)

Phase A2 built the snapshot-owned structural objects (module instances, roof-plane objects with
setback polygons, rail/attachment objects, `env`, `checks`, `engine`, `rackingAssembly`,
permit-readiness blockers). **Phase B made every canonical-path structural renderer a PROJECTION of
them.** Seam = `lib/permit/snapshot/structuralProjection.ts` (read/format layer, mirrors
`computeSystemProjection`) + `RenderContext.snapshot` (threaded in `generatePermit.ts` so drawing
templates project too) + `lib/permit/utils/structuralBanner.ts` (one §12 banner wired to
`permitReadiness`). Honest formatters (`fmt`/`fmtStr` → em-dash) mean missing authority renders `—`,
never a fabricated number.

### Resolution by audit category (BEFORE → AFTER)

| # | Category | Before sites | Resolution |
|---|---|---:|---|
| 1 | Module dims (generic 66/40) | 6 | **roof.ts:149-150 DELETED** → `projectStructural(ctx.snapshot).moduleHeightIn/WidthIn` (drawRoofPlan + drawRoofStructural); **arrayPages.ts:468-469 (PV-1B fire band)** + **compliancePages.ts:804-805 (APP-A spec)** → snapshot module instance dims. `structuralInput.ts:94-99` kept (the GOOD per-sub source that feeds the engine). `sitePlan.ts:73-74` = DEAD (pageSiteInformation/buildPv1Page **retired 2026-07-08**, see `lib/permit/index.ts:11`). Remaining: ground.ts:860-861 / fence.ts:729-730,1209-1210 — ground/fence drawing dims kept on project-scalar+guard (snapshot carries one FLEET module; wiring to it would regress hybrid per-sub dims — per-sub footprint authority is follow-on). |
| 2 | Roof planes / setbacks / pathways | 7 | Canonical `geometry.roofPlaneObjects` (polygon + fire-setback polygons from the slope-space engine) built in Phase A2. PV-1B coverage test projects module dims from the snapshot. Setback WIDTH authority carried on the plane object; drawn bands remain geo-registered (documented gap: pathway polygons pending true routed geometry — recorded in `geometry.gaps`). |
| 3 | Rails (invented 48" O.C. feet) | 6 | **roof.ts:174 `railFootOcIn = 48` DELETED** → `projectStructural(ctx.snapshot).attachmentSpacingIn` (engine-RESOLVED). Foot placement stays geo-registered onto the real rafter grid at the canonical O.C.; count reconciles with `structural.attachments` (V22). Snapshot attachment `xy` is V4-grid-frame (not lat/lng), so geo-registration is CAD; SPACING/COUNT/IDs are canonical — documented partial. |
| 4 | Attachments (spacing/capacity/`?? 2`) | 10 | **generatePermit.ts:477 `(safetyFactor || 2)` DELETED** → engine `mountCapacityLbs` allowable. PV-4C/PE-1 lag-bolt capacity/demand/SF project the snapshot `attachment-uplift` check. attachSpacing single-sourced on roof.ts (PV-1) + roof.ts (PV-3). |
| 5 | Environmental (90-vs-115, exp, snow, risk) | 14 | **roof.ts:1990 `?? 90` DELETED.** Every printed wind/exposure/snow/risk projects `structural.env` via `projectStructural(...)`: roof.ts (PV-1/PV-3 wind arrows + load callout), structuralPages PV-4C roof/ground/fence, certPages `_peSiteLoading` (incl. **Risk Category** — was hardcoded "II (Residential)"), coverSheet design-criteria rows, sheetComposition getFence/Ground/RoofData (`snapWind()`), fence.ts + ground.ts drawing wind. **Render-verified: PV-4C prints 115/115 (single-sourced; the 90-vs-115 disagreement is eliminated).** `fence.ts:79` (SolFence rated wind) kept — equipment rating, not design wind. |
| 6 | Safety-factor / threshold (1.0/1.5/2.0) | 9 | **§9 conflict fixed.** Roof lag prose (structuralPages ~889) DELETED "min. SF 2.0" → projects the `attachment-uplift` check threshold (MIN_ATTACHMENT_SF=1.0) + demand/capacity/SF/result. Ground pile "2.0 against pile withdrawal" → `GROUND_PILE_MIN_SF` (1.5, engine v4:813 limit state, printed consistently across card/prose/conclusion). Fence overturning SF projects the `fence-overturning` check threshold. certPages fence/roof PE thresholds projected. |
| 6b | **Inline fence wind engine RELOCATED** | 121-420 | **`pageStructuralFence` inline ASCE §29.4 math DELETED** → `lib/structural/fenceWindEngine.ts` `analyzeFenceWind()` (math unchanged: Kz/Kzt/Kd/Cf, velocity pressure, per-post force, overturning, Broms embedment). Fed into `snapshot.structural.checks` as `fence-overturning` (via `structuralAuthority.buildFenceChecks` + `build.ts` fence input); the segment table + PV-4C body PROJECT the engine result. |
| 7 | Structural BOM (3 paths) | 6 | Not re-plumbed in Phase B — `structural.railTotalFt/railCount/spliceCount/attachmentCount` now DERIVE from the canonical rail/attachment objects (Phase A2 build.ts). SCHED `deriveStructuralBOM` + the source-object-ID BOM (directive §10/§11) is a follow-on BOM campaign — remaining with justification. |
| §12 | Banner wiring | — | `structuralBanner()` reads `permitReadiness` (structural blocker subset). `structuralBannerHtml`/`Svg` printed on PV-0/PV-1/PV-1B/PV-3/PV-4C. CERT/PE reuse the EXISTING computed `certificationGateBanner`, now augmented with the canonical structural blocker reasons (kept the literal "PENDING ENGINEERING REVIEW" for V13/W1). Render-verified: banner present on PV-0/PV-1/PV-3/PV-4C. |

### Files changed (Phase B)

- `lib/permit/snapshot/structuralProjection.ts` (NEW) — projection/read + em-dash formatters + banner state.
- `lib/permit/utils/structuralBanner.ts` (NEW) — §12 banner (HTML + SVG), wired to permitReadiness.
- `lib/structural/fenceWindEngine.ts` (NEW) — relocated fence wind/overturning/embedment engine.
- `lib/permit/snapshot/structuralAuthority.ts` + `build.ts` — emit `fence-overturning` check from the relocated engine.
- `lib/drafting/renderContext.ts` + `lib/permit/generatePermit.ts` — thread the snapshot into RenderContext; delete the `(safetyFactor||2)` injection.
- `lib/drafting/templates/roof.ts` — module dims, O.C. spacing, wind all projected; 66/40, 48", ?? 90 deleted.
- `lib/drafting/templates/fence.ts` + `ground.ts` + `sheetComposition.ts` — wind single-sourced from snapshot env.
- `lib/permit/sections/structuralPages.ts` — PV-4C roof/ground/fence project env + checks; fence engine relocated; SF prose fixed; banner.
- `lib/permit/sections/certPages.ts` — CERT/PE env + risk + checks projected; gate augmented.
- `lib/permit/sections/coverSheet.ts` + `arrayPages.ts` + `compliancePages.ts` — env + module dims projected; banners added.

### Verification
`npx tsc --noEmit` clean · `npx vitest run tests/planset` = 46 files / 303 tests green · render sanity
(roof fixture) PV-0/PV-1/PV-3/PV-4C non-empty + populated + banner present + PV-4C wind 115/115.

---

## PARALLEL-PATH (directive §9 evidence flag)

**`lib/plan-set/*` is a LIVE, SEPARATE structural surface — NOT refactored in W3 (out of scope).**

- Entry route: `app/api/engineering/plan-set/route.ts` imports and renders
  `lib/plan-set/structural-sheet.ts` (`buildStructuralSheet`),
  `lib/plan-set/mounting-details-sheet.ts` (`buildMountingDetailsSheet`),
  plus cover/electrical/site/compliance/equipment sheets from `lib/plan-set/*`.
- Reachable from UI: `app/engineering/page.tsx` and `app/admin/topography/page.tsx` fetch
  `/api/engineering/plan-set`. **Status: LIVE.**
- `lib/permit/buildPermitCoverSheet.ts` (`buildPermitCoverSheetArtifact`, wind default 115) is reached
  via `lib/engineering/artifactBuilders.ts`. **Status: LIVE (artifact builder).**
- This path does NOT consume `PermitDesignSnapshot`; it carries its own `structuralStatus='PASS'`
  (route.ts:453) and 115/0 defaults — a second, divergent structural surface that the W3 evidence
  harness should flag. It was deliberately left untouched per the W3 boundary ("do NOT refactor it").
  Retiring/merging it onto the canonical snapshot is a follow-on campaign.

---

## AFTER (W3 Phase C — landed 2026-07-21, dev, uncommitted) — §10 BOM, §11 V10, §13 evidence

Phase C closes the directive: the structural BOM now derives from the canonical objects (§10), V10 is
an ACTIVE blocking validator (§11), and the evidence harness emits the cross-sheet TRUTH MATRIX and
exits non-zero on any disagreement or reconciliation failure (§13).

### §10 — BOM from physical objects (three producers unified)

- **New seam `lib/permit/snapshot/structuralBom.ts`** — `deriveStructuralBom(objects)` produces every
  structural/racking row (rails, mounts, splices, mid/end clamps, lag fasteners, T-bolts, bonding clips,
  ground lugs, flashing) from the snapshot `rails[]`, `attachments[]`, `moduleInstances[]` and
  `rackingAssembly`. **Each row carries source object IDs (`sourceObjectIds`) OR an auditable
  aggregation reference (`aggregation` + `objectCount`)** — never a renderer guess. **Mid/end clamps come
  from ACTUAL module adjacency**: mid = `Σ (modules_on_rail − 1)`, end = `2 × rails`.
- **`reconcileStructuralBom(rows, objects, v4)`** runs the §10 checklist (rails vs rail geometry; mounts
  vs attachment objects; splices vs rail segmentation; mid/end clamps vs module adjacency; fasteners vs
  attachment method; bonding vs module topology) AND cross-checks the historical V4 `calcRackingBOM`
  producer when the panel scope matches. Emitted on the snapshot as `structural.bom[]` +
  `structural.bomReconciliation`.
- **The three producers now project these quantities:** (1) V4 `calcRackingBOM` is the reconciliation
  TARGET — the snapshot rail/attachment objects derive from the same V4 run, and reconciliation asserts
  agreement; (2) `bomForPermit.ts:632-633` — the fabricated `Math.ceil(totalPanels*1.2)` /
  `Math.ceil(totalPanels/2)` guesses are **RETIRED**, replaced by the canonical mount/rail-object counts
  (operator value or honest 0 when no structural run — never a fabricated quantity); (3)
  `bom-system-profiles.deriveStructuralBOM` roof branch already returns empty (V4 owns roof), so it
  contributes no divergent roof quantity — fence/ground remain the documented estimate-path follow-on.
- **Hybrid scope caveat (honest):** on a hybrid the V4 roof run is roof-scoped while Phase-A2 objects
  span all sub-arrays, so the V4 cross-check is skipped (object-internal reconciliation only) and the
  caveat is recorded in `bomReconciliation.note`. Single-system roof (the clean case) uses the full
  `object-vs-engine` basis.

### §11 — V10 activated + related invariants (all BLOCKING, `lib/permit/snapshot/validate.ts`)

- **V10** (was a deferred stub) is now BLOCKING: `structural.bomReconciliation.ok` must hold; a rail-based
  assembly must carry object-derived rail + mount rows; every BOM row must carry source IDs or an
  aggregation reference. (The DRAWN==snapshot render equalities are enforced post-render by V12/V13 + the
  non-zero-exit evidence harness, since validate runs pre-render on the snapshot.)
- **V22 extended** — referential integrity: every attachment carries a rail AND roof-plane reference;
  every rail references ≥1 supported module, ≥1 attachment and a plane.
- **V25 (new)** — reaction honesty: an attachment uplift exceeding its allowable capacity must surface as
  a failed check + `STRUCTURAL-UTILIZATION-EXCEEDED` blocker, never a silent over-capacity (consistency
  invariant, not a physics hard-throw — §12 still renders for review).
- **V19–V24** (Phase A2) remain blocking: instance count, exact dims, array area, rail/attachment
  reconciliation, env single-source, framing honesty.

### §13 — evidence harness + cross-sheet truth matrix

- **New `scripts/planset-evidence-w3.mjs`** (invoked exactly like `planset-evidence.mjs`:
  `node scripts/planset-evidence-w3.mjs <html> <snapshot.json> [out]`). Emits
  `docs/evidence/braidon-w3.planset-evidence.json` with: structural schema-additions summary; the exact
  Braidon `rackingAssembly` record; canonical object counts; the attachment-ID→drawing-coordinate map
  (with the V4-grid-frame caveat recorded honestly); rail segmentation + splice evidence; the
  load/reaction/capacity report; the BOM-to-object reconciliation report; V10 + V19–V25 statuses; the
  grep/AST proof (a LIVE scan of `lib/drafting/templates/roof.ts` for `?? 90` / `|| 115` / `railFootOcIn
  = 48` / generic-66 literals — **0 hits**, comments stripped); the parallel-path flag; and the
  carried-forward electrical blockers (all visible).
- **Cross-sheet TRUTH MATRIX** — every §13 quantity parsed from the RENDERED sheets vs the snapshot:
  module count, module dims, array area, roof pitch, wind, exposure, snow, rail qty + length, attachment
  count + spacing, fastener spec, reaction, capacity, utilization/SF, structural BOM reconciliation.
  **Braidon result: 11 agree / 5 coverage / 0 disagree.** The 115-vs-90 fight is gone (wind prints 115
  on every sheet == `env.ultimateWindSpeedMph`); uplift 416 lb, capacity 600 lb, SF 1.44, spacing 48",
  exposure C, snow 0, fastener 5/16" all agree; the object-derived BOM reconciles.
- **Harness semantics:** exit NON-ZERO on any cross-sheet disagreement OR reconciliation failure, and
  FAIL if a not-ready / structural-blocked snapshot does not render the PENDING banner. The expected
  honest Braidon blockers are the CORRECT outcome: **ROUTE-LENGTH-ESTIMATE, EQUIPMENT-IDENTITY-CONFLICT
  (×2), WIND-SNOW-AUTHORITY-UNRESOLVED, ENGINEERING-REVIEW-PENDING** are asserted PRESENT and the
  **PENDING STRUCTURAL ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION** banner is asserted rendered.
  Harness exits **0**. (Braidon's live DB row is now a hybrid string system with verified framing, so
  `STRUCTURAL-FRAMING-UNVERIFIED` does not fire this generation — the banner is driven by the wind/snow
  authority + equipment-identity + route-length blockers, all honest and recorded; nothing is
  fabricated to green the evidence.)

### Verification (Phase C)
`npx tsc --noEmit` clean · `npx vitest run tests/planset` = 46 files / 307 tests green (adds §10/§11
BOM + reconciliation + validator tests) · `node scripts/planset-evidence-w3.mjs` exits **0** with the
truth matrix (0 disagree) and honest blockers recorded.

---

## AFTER (W3.1 §2 — CANONICAL COORDINATE AUTHORITY, landed 2026-07-21, dev, uncommitted)

W3.1 §2 unifies structural and drawing coordinates. **The pre-W3.1 frame split is
eliminated**: rails/attachments no longer live in an abstract V4 array-geometry grid while
module footprints live in plan-ft — every physical object (module footprints, rail
start/end, attachment points, roof-plane + setback polygons) is now expressed in ONE
canonical coordinate system, `CANONICAL_COORDINATE_SYSTEM_ID = 'CS-SITE-PLAN-FT'`
(equirectangular local feet, origin = array centroid, +x east / +y north, plan-projected,
NOT plan-rotated, NOT display-regularized).

### What landed
- **Canonical frame + per-object coordinate metadata.** Every `ModuleInstance`, `RailObject`,
  `AttachmentObject`, `RoofPlaneObject` carries `coord: CoordinateMeta`
  (`coordinateSystemId / units / sourceFrame / transformId / transformRevision /
  transformProvenance`). Rails + attachments are **co-located from the module centroids** in
  the same plan-ft frame (`structuralAuthority.buildRailsAndAttachments`) — lengths / counts /
  splices stay engine-of-record (V4); only the coordinate FRAME is unified.
- **Snapshot-carried transform authority.** `geometry.drawingTransforms[]` (a `DT-SITE`
  transform + per-plane `DT-<planeId>`), each with a 2×3 affine `matrix`, `params`
  (kind/rotationDeg/pivot), and a `transformDigest` (stable hash of matrix+params, exposed in
  evidence). `geometry.coordinateSystem` declares the canonical frame. Math lives in
  `lib/permit/snapshot/coordinateAuthority.ts` (applyAffine/composeAffine/planRotationAffine/
  transformDigestOf/buildDrawingTransform + the `checkRenderParity` render-parity checker).
- **Blocking invariants (validate.ts).** **V26** unified frame (all physical objects on the ONE
  canonical CS — split forbidden); **V27** complete coordinate metadata + resolvable transform
  reference + matching revision; **V28** transformDigest integrity (recompute == stored;
  `fromCoordinateSystemId` == canonical). **V29** (post-render, generatePermit) — no rendered
  physical object without a canonical object ID: every `data-object-id` drawn on a sheet must
  resolve to a snapshot object.
- **Rendered-object tagging.** `roof.ts` tags each drawn module `<rect>` with
  `data-object-id="mi-<panelId>"` (matches `moduleInstances[].instanceId`); the harness /
  V29 scan verify coverage. **Tolerance:** render-parity sheet tolerance = 0.5 sheet unit
  (renderers round coords to 0.1 px; the manifest stores 0.01-ft canonical values → sub-0.5
  is rounding noise), canonical-consumption tolerance = 0.01 ft.
- **Evidence.** `planset-evidence-w3.mjs` emits a `coordinateAuthority` block (canonical CS,
  the transforms w/ matrix + digest, and the live `data-object-id` render-parity coverage) +
  V26–V29 statuses.

### Corrective pass — full resolution of the §2 render seam (2026-07-21)

The identity-transform / procedural-rafter-grid interim was corrected per Ray's ruling
(count/spacing/ID parity is insufficient):

- **Geo-registration moved into the snapshot transform.** `DT-SITE` is now a real
  **plan-rotation** transform whose angle is the array's principal axis (PCA of the canonical
  module centroids about the array centroid), built at snapshot time with a content digest
  (`structuralAuthority.modulePlanCentroids` + `dominantAxisDeg`). (Axis-aligned arrays yield
  0° = identity, which is correct; rotated arrays like Braidon carry the real angle.)
- **Procedural rafter-grid placement DELETED.** `roof.ts` no longer generates feet from the
  rafter grid. Rail lines, attachment feet and splice markers are drawn as
  **`viewport ∘ DT-SITE(canonical)`** — the renderer fits its viewport (registration-ft →
  sheet-px, scale/paper/flip ONLY) by least squares from the drawn module anchors
  (`fitAffine`) and projects each canonical rail/attachment/splice coordinate through it. The
  canonical attachment coordinates + rail splice points are derived once, at build time, in
  `structuralAuthority.ts` (`RailObject.splicePointsXY`).
- **Live BLOCKING parity.** Each roof sheet emits a `<!--PLACEMENT-MANIFEST:…-->`; after
  render `generatePermit` runs `checkRenderParity` as a fail-closed invariant:
  **V31** drawn == `viewport∘DT-SITE(canonical)` within **0.5 sheet units** (+ renderer
  consumed the snapshot coordinate, no re-derivation), **V30** no canonical structural object
  omitted, **V29** no rendered object without a canonical ID. Verified live: 6 rails + 6
  splices + 30 feet placed, **max Δ = 0**. Wired into `planset-evidence-w3.mjs`
  (`coordinateAuthority.renderParity`, validators V29/V30/V31; harness fails closed on parity).

### Module polygons closed too (regularization moved into the snapshot build)
Module OUTLINES are now pure projections as well. The display trace-straightening
(azimuth orientation + cos-pitch foreshorten) is computed at **snapshot build time** and stored
as `ModuleInstance.drawnPolygon` (alongside the RAW `polygon`), with provenance. `roof.ts`
draws module outlines as **`viewport∘DT-SITE(drawnPolygon)`** (a `<polygon data-object-id="mi-…">`)
and deletes the in-renderer module regularization — **positions stay RAW canonical (no panel is
moved, dropped or re-placed;** Ray's standing rule). **V31 now covers modules**; module manifest
entries are enforced live (real render: 12 module polygons + 6 rails + 6 splices + 30 feet,
**max Δ = 0**). **V21 basis note:** the area invariant (V21) and Σ-area keep using the RAW
`polygon` (physical truth); `drawnPolygon` is display-only and is foreshortened, so it is NEVER
the area basis.

### ONE honest residual (recorded in `geometry.gaps` + `structural.gaps`, not faked green)
**Rail-less direct-mount products** (RT-APEX / E-Mount AIR / S-5 / EcoFasten) have **no canonical
attachment objects yet** (`buildRailsAndAttachments` derives rails/attachments only for
`rail_based`/`standing_seam`). Their per-module direct mounts are therefore drawn on the **legacy
path**, not projected from canonical, and this is recorded as a blocking gap (rail-less modules
still get V29 ID-coverage but not V31 coordinate parity). Deriving canonical rail-less mount
coordinates is the only remaining §2 follow-on.

### Verification (W3.1 §2)
`npx tsc --noEmit` clean · `npx vitest run tests/planset` = 49 files / 356 tests green (adds
`tests/planset/coordinate-authority.test.ts` — transform math incl. invert/fit, digest change,
`checkRenderParity` passing + violation classes + tolerance, unified-frame on the real
snapshot, V26/V28 tamper detection, **V21 basis (raw vs drawn polygon)**, and **LIVE
placement-manifest parity: real render pass + deliberately-perturbed V31 module/foot + V30
omission fail cases**) · `planset-evidence-w3.mjs` exposes the coordinate authority + transforms
(matrix/digest) + live render-parity (modules + rails + feet + splices, max Δ 0), V26–V31 PASS.
