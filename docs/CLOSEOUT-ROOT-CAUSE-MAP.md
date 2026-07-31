# Closeout Pass — Root-Cause Map (Phase 0 Forensic Audit)

Baseline `3a06cc80` (dev). Audit target: `PermitPackage-BRAIDON M PILLA — Solar TEST (3).html`
(snapshot **PDS-1DDC4EDE238C**, digest `1ddc4ede238c…`, 20 sheets). Read-only; no code changed.
Companion to `docs/CLOSEOUT-PASS-DIRECTIVE.md` (Ray's 18 sections).

---

## 0. Live-vs-stale verdict for (3).html

**(3).html is a STALE DEPLOY of commit `d201ea21` (HEAD's direct parent), not current-code output.**

Evidence:

| Fact | Value |
|---|---|
| (3) snapshot digest | `1ddc4ede238c…` |
| HEAD regen — frozen fixture (`scripts/braidon-fixture-regen.ts`) | `PDS-F047C1DED872` |
| HEAD regen — live DB row (`_tmp_braidon_regen.ts`, project 4030b664) | `PDS-8E6B472DD4B4` |
| HEAD commit time | 2026-07-22 **23:06:13** −0500 |
| (3).html file mtime | 2026-07-22 **23:28:18** (22 min after commit) |

The design inputs match the frozen fixture exactly (31 modules, 12.40 kW DC, Enphase IQ8A,
branches 11/10/10), so the digest differences are **code-version**, not design, differences.
A per-finding value-diff of (3) against BOTH HEAD regens shows (3) is byte-equivalent on 16 of
18 findings and diverges on exactly two:

* **§1** — (3) prints a `27.5%` busbar-fill PASS number; **neither HEAD path emits it.**
* **§13** — (3) prints `56% utilization` + `55 psf`; **neither HEAD path emits them** (HEAD-live
  shows `32%` for the same paragraph but with the SAME unsupported "adequate" verdict — see §13).

`git show d201ea21:lib/permit/sections/structuralPages.ts` confirms lines 803/838/940 (the
`${utilization}%` emitter) are byte-identical to HEAD; HEAD 3a06cc80 wrapped them in a NEW
"engineering-review-required" indeterminate gate (visible in `git diff HEAD~1 HEAD`). d201ea21
therefore renders `56%`; HEAD renders "NO FRAMING PASS/FAIL CONCLUSION ISSUED". (3) shows `56%`
⇒ (3) came from the d201ea21 Vercel deploy that had not yet rebuilt when Ray generated it 22 min
after the HEAD commit. Same failure mode the previous audit found for (2).html.

**Consequence for classification:** the two suppressions in HEAD (§1 busbar-%, §13 util-%) are the
ONLY things the final commit changed for these findings. **All 18 directive findings otherwise
reproduce identically at HEAD** — the repair campaign added canonical authority objects but left the
renderers emitting legacy literals/fallbacks beside them. Braidon looks repaired only where the last
commit gated two numbers; the underlying contradictions are live at HEAD.

### Reproduce-at-HEAD matrix (signature counts; HEAD = live-DB / fixture)

| § | Signature | (3) | HEAD-live | HEAD-fix | Live at HEAD? |
|---|---|---|---|---|---|
| 1 | `27.5%` busbar-fill PASS | 2 | 0 | 0 | **NO (fixed)** — busbar *text* still duplicated (see §1) |
| 1 | duplicated "busbar rule" literals | 7 | 6 | 6 | yes |
| 2 | `Conduit type: EMT` note vs PVC segment | 1 | 1 | 1 | **yes** |
| 3/4 | branch `1-1/4" PVC Sch 80` (merged run) | 7 | 7 | 7 | **yes** |
| 5 | `#10` on BRANCH_RUN vs `#12` schedule | 1 | 1 | 1 | **yes** |
| 6 | `conduit — all runs` roll-up | 1 | 1 | 1 | **yes** |
| 7 | `NEC 358` on PVC rows | 5 | 5 | 4 | **yes** |
| 8 | E-1 DC-conductor legend on micro job | 1 | 1 | 1 | **yes** |
| 9 | fused tap OCPD + utility disconnect (2 devices) | 10/1 | 10/1 | 10/1 | **yes** |
| 10 | DS-4 XR100 page + banner-only | 6/9 | 6/9 | 6/9 | **yes** |
| 11 | `DIRECT-ATTACH MOUNT` | 1 | 1 | 1 | **yes** |
| 12 | PE-1 `lag bolt / 5/16" / stainless` | 19 | 19 | 19 | **yes** |
| 13 | `56% utilization` / `55 psf` | 4/1 | 0 | 0 | **NO (fixed)** |
| 13 | "confirms…adequate capacity" paragraph | 3 | 3 | 2 | **yes** |
| 16 | `Issued for permit review` | 1 | 1 | 1 | **yes** |
| 17 | `CONDUIT-FILL-PENDING` advisory | 2 | 2 | 2 | **yes** |

`§8 "#10 AWG + 14-ft module row"` and `§2 "conduit route — EMT" callout` do **NOT** reproduce at HEAD
(honest — see those entries).

---

## Per-finding entries

Chain notation: input → engine → snapshot → projection → renderer(file:line) → BOM → validator.

### §1 — PV-4A legacy electrical path
* **Rendered evidence:** (3): `705.12 Busbar Rule … 27.5% … PASS`. HEAD: busbar text remains (~6×) but as
  supply-side "705.12(B) applies only to load-side / does not apply"; no 27.5% PASS.
* **Chain:** `snapshot.electrical.poi.rulePasses` → `resolveInterconnection()` (`electricalPages.ts:60-105`)
  → `_ic.isSupplySide`/`passes120` → `pageNECCompliance()` (returns `electricalPages.ts:219`). The 27.5%
  PASS row is inside the **load-side** branch (`electricalPages.ts:688-689,739-745`) which does not render
  for supply-side ⇒ killed at HEAD.
* **What still runs:** (a) six **hard-coded English busbar sentences** at `electricalPages.ts:262,275,377,392,686,734`
  (duplicated, not sourced from one accessor); (b) the legacy `input.rulesResult` advisory table
  `electricalPages.ts:230-257` (still emits a 705.12 advisory row if any upstream legacy engine sets `rulesResult`);
  (c) improper fallback `electricalPages.ts:75` — `passes120 = rulePasses ?? (feederOcpd <= maxBackfeedA)`
  synthesizes a boolean when the snapshot value is null (`build.ts:996` sets `rulePasses: busbar.passes ?? null`).
* **Classification:** stale projection (mostly cleaned) + **renderer-local literal** (duplicated busbar text) + **improper fallback** (`:75`).
* **Live-vs-stale:** 27.5% PASS = **fixed at HEAD / stale in (3)**; duplicated busbar literals + `:75` fallback = **live at HEAD**.
* **Repair seam:** hoist the supply/load-side sentences into one helper on `InterconnectionResolution`; drop the `:75`
  recompute so a null `rulePasses` renders PENDING; retire/guard the `rulesResult` advisory table.

### §2 — PV-1 PVC-vs-EMT contradiction
* **Rendered evidence:** construction note "**Conduit type: EMT.** All conduit supports per NEC 358.30 (EMT) or
  NEC 352.30 (PVC)…" beside canonical `1-1/4" PVC Sch 80` on the schedule/BOM.
* **Chain:** `titleBlock.ts:203` prints `Conduit type: ${project.conduitType || 'EMT'}`. `project.conduitType`
  (raw legacy DB field) is unset here → falls back to `'EMT'`; the canonical electrical segments independently
  resolve `PVC Sch 80` (segment schedule / `sldAdapter.ts:199-202`). Two authorities, one physical run.
* **The specific "conduit route — EMT" PV-1 callout the directive named does NOT reproduce** — W1b replaced the
  old `'3/4" EMT'` literal in `sldAdapter.ts:68-71` with a projection of the BRANCH_RUN raceway. `sitePlan.ts` /
  `arrayPages.ts` carry no raceway annotation. Honest: that exact callout is stale.
* **Classification:** **improper fallback / renderer-local literal** (`titleBlock.ts:203` reads legacy `project.conduitType`, not the canonical route accessor). Same pattern at `electricalPages.ts:472,485,500,543` (`project.conduitType || 'EMT'`).
* **Live-vs-stale:** live at HEAD (construction-note contradiction).
* **Repair seam:** `titleBlock.ts:203` + `electricalPages.ts:472,485,500,543` — read one canonical route-description accessor
  (per physical segment) instead of `project.conduitType || 'EMT'`; package gate: reject >1 raceway type/size for one segment ID.

### §3 / §4 — Branch route sections & the 1-1/4" branch raceway engine result  ⟵ KEY ENGINE ANSWER
* **Rendered evidence:** E-1 / PV-4B describe the AC branch home-run as `1-1/4" PVC Sch 80` in-conduit; snapshot
  `routeSegments`: `ROOF_RUN = FREE_AIR` but `BRANCH_RUN = PVC Sch 80, 1-1/4"`.
* **Mechanism (the §4 answer): (b) a SHARED-raceway truth + project-level raceway-type propagation — NOT a feeder
  bleed, NOT an accidental fallback.** The jbox→combiner trunk is ONE physical raceway carrying all three branches'
  conductors bundled: `segment-schedule.ts:581-596` builds `JBOX_TO_COMBINER` with `3×BLK + 3×RED + 1×GRN = 7 × #10`
  (6 current-carrying). `calcConduitSize()` on that 7-conductor area (~0.148 in²) → **1-1/4"** is the smallest legal
  PVC Sch 80 (deliberate, correct). Type `PVC_SCH80` from `input.conduitType` (`segment-schedule.ts:589`).
* **The actual defect — a MERGED BRANCH_RUN.** `computed-system.ts:1398-1427` first builds BRANCH_RUN as **open-air**
  (`conduitType:'NONE'`, `isOpenAir:true` — the micro→jbox Q-cable trunk). Back-population then **overwrites** it from
  the conduit segment: `computed-system.ts:2146-2151` (`run.conduitType = seg.raceway==='OPEN_AIR' ? … : 'PVC Sch 80'`,
  `run.isOpenAir = false`). One RunSegment now conflates two physically distinct runs (open-air micro trunk + jbox→combiner
  conduit). `sldAdapter.ts:202-204` reads `_snapBranch.raceway = PVC Sch 80` → E-1 labels the open-air home-run as in-conduit.
* **Missing authority fields:** BRANCH_RUN carries no `physicalRacewayId`, `sharedCircuitCount`, `minimumCodeRacewaySize`
  (the `RunSegment` interface `computed-system.ts:99-148` has none) — it is a merged whole-branch description; consumers
  cannot distinguish 3 shared circuits in one raceway from 3 separate raceways.
* **Classification:** **missing canonical object** (no per-physical-raceway object; open-air trunk + conduit share one RunSegment) → merged/stale projection on E-1.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `computed-system.ts:2146-2151` — stop stamping the conduit's type/`isOpenAir` onto the open-air BRANCH_RUN;
  model the micro trunk (open-air) and the jbox→combiner conduit as two RunSegments, each with `physicalRacewayId` +
  `sharedCircuitCount` + `minimumCodeRacewaySize`. Validators V16 (`build.ts:227-236`) and `FEEDER-RACEWAY-AUTHORITY`/
  `CONDUIT-FILL-PENDING` (`build.ts:679,685`) only inspect the feeder — add a branch-raceway coverage gate.

### §5 — Branch wire quantities vs BOM
* **Rendered evidence:** BOM row 18 `#10 AWG THWN-2 — AC wiring (BRANCH_RUN, COMBINER_TO_DISCO_RUN, DISCO_TO_METER_RUN) = 198 ft`;
  row 19 `#12 AWG (BRANCH_RUN) = 79 ft`; row 29 `#10 Green EGC = 52 ft (acWireLength × 1.15)`; PV-4A schedule prints branch `#12`.
* **Chain / root causes:**
  1. **One merged run, not 3 branches.** `computed-system.ts:1398-1416` emits a single `BRANCH_RUN` with one scalar
     `onewayLengthFt` (68 ft) and `conductorCount:2`; `branchCount` (3) is used only to distribute micros for the plan
     (`:1211`), never multiplied into footage. → **missing canonical object.** Seam: `computed-system.ts:1385-1416`.
  2. **Branch gauge #10 (route/BOM) vs #12 (schedule).** computeSystem sizes the run from `microBranches[0].branchCurrentA`
     (`:1249`, first branch only) via `autoSizeOpenAirWire(…, '#10 AWG')` (`:1389-1396`, #10 floor); the canonical
     conductor objects (`snapshot.electrical.conductors[c-2/c-4/c-6]`) say `#12`, read by the schedule at
     `electricalPages.ts:342`. → **duplicated authority + incorrect engine calc.**
  3. **BOM merges branch HOT with feeder EGC by gauge.** `bom-engine-v4.ts:2386-2417` sums footage per gauge across all runs
     → branch #10 (157 ft) + feeder #10 EGCs (41 ft) = 198-ft row. → **lossy projection** (per-segment identity erased).
  4. **Second, independent EGC emitter.** `bom-engine-v4.ts:1535-1541` (dup `:2698-2701`) pushes a Stage-5 "structural"
     `#10 Green EGC = acWireLength × 1.15 = 52 ft`, EGC billed twice on two bases. → **duplicated authority.**
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `computed-system.ts:1385-1416` (per-branch runs / Σ footage); collapse branch gauge onto conductor
  authority; delete the flat structural EGC row (`bom-engine-v4.ts:1535,2698`); stop gauge-keyed re-merge in `:2386-2417`.

### §6 — "all runs" conduit → physical raceway objects
* **Rendered evidence:** `1-1/4" PVC Sch 80 Conduit … conduit — all runs = 120 ft`.
* **Chain:** `bom-engine-v4.ts:2419-2435` — `conduitMap` keyed only by `type-size`; every raceway with that key sums into
  ONE line literally described `` `${size}" ${type} conduit — all runs` `` (`:2433`). Fittings (couplings/connectors/straps/
  bushings) derived once from a single `totalConduitFt` + project-level `input.conduitType/conduitSizeInch` (`:2452-2491`);
  no per-raceway counts, no bend/elbow line.
* **Classification:** **missing canonical object** (raceways not first-class BOM objects) / duplicated-authority collapse.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `bom-engine-v4.ts:2419-2491` — iterate physical raceways individually (each with own type/size/length),
  emit conduit + couplings + straps + bends per raceway; label each quantity with its raceway id.

### §7 — Raceway code references (NEC 358 on PVC)
* **Rendered evidence:** PVC Sch 80 conduit/fitting rows cite `NEC 358` / `358.30` (EMT-only) instead of `NEC 352`.
* **Chain:** the raceway `type` flows into the description correctly, but the NEC article is a **hard-coded string constant**
  independent of type: `bom-engine-v4.ts:2434` and `:2449` (`'NEC 358'`), fittings `:2468,2471,2476,2486` (`'NEC 358.30'`);
  second builder twins at `:1074,1099,1146,1153,1166-1167,1176`. `RunSegment.raceway` carries the type but no NEC-article
  field is consumed.
* **Classification:** **renderer-local (BOM-aggregator) literal.**
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** map the article from raceway type (`EMT→358, PVC→352, RMC→344, LFMC→350, FMC→348`) at
  `bom-engine-v4.ts:2434/2449` (+ the `358.30` fittings + the 1074/1099 twins). Also fix the mixed literal in `titleBlock.ts:203`.

### §8 — Unused string/DC authority (pure 1:1 micro)
* **Rendered evidence:** E-1 legend still lists `DC Conductor in Conduit (USE-2/PV Wire)` on a micro job with no DC string objects.
* **Chain:** `sld-professional-renderer.ts:2526` (`renderSLDProfessional`) and `:3799` (`renderSLDMultiLane`) push the DC legend
  entry **unconditionally**, even though `isMicro` is already computed (`:1676-1678`) and the battery/gen/ATS entries in the
  same arrays ARE gated (`:2527-2529,3800`).
* **Honest correction:** the directive's **"generic #10 AWG + 14-ft module-table row" does NOT reproduce at HEAD** — the DC
  String Schedule rows (`electricalPages.ts:309-318,481,539`) render only when `dcStrings` is non-empty (empty on micro).
  The one legit `#10 FREE_AIR` segment (`ROOF_RUN`, 25 ft) is the factory MC4 module lead, correctly open-air.
* **Classification:** **renderer-local literal + missing topology gate** (E-1 legend only).
* **Live-vs-stale:** DC legend = live at HEAD; #10/14-ft module row = does not reproduce (stale recollection).
* **Repair seam:** `sld-professional-renderer.ts:2526` + `:3799` — `...(!isMicro ? [ {DC Conductor…} ] : [])` (or gate on a DC route segment).

### §9 — Service-topology physical order (one device or two?)
* **Rendered evidence:** PV-6 lists `FUSED AC DISCONNECT — SUPPLY-SIDE TAP OCPD` (×10 refs) and a separate
  `UTILITY-ACCESSIBLE AC DISCONNECT (LOCKABLE)` (×1).
* **Chain:** `build.ts` serviceTopology IIFE (`:374-433`) pushes **two** device objects unconditionally for supply-side:
  `svc-fused-ocpd` (`:406-411`, provenance `computeSystem tap OCPD`) and `svc-utility-disconnect` (`:412-417`, provenance
  `interconnection requirements`), **both carrying the same `ocpdRatingA = feederOcpd`**. Projected as two PV-6 rows by
  `compliancePages.ts:633-634` (utility row gated `if (_util)`).
* **What the design supports:** nothing distinguishes them — `svc-utility-disconnect` is fabricated from `isSupply===true`
  alone; no project field asserts a separate lockable disconnect. In a residential 705.11 tap the fused AC disconnect *is*
  the utility-accessible lockable means → risk of a phantom duplicate device on schedule/BOM.
* **Classification:** **missing project evidence** (fabricated device) / potential duplicate.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `build.ts:412-417` — gate `svc-utility-disconnect` on a real project flag (e.g. `proj.utilityLockableDisconnect`)
  or fold it into `svc-fused-ocpd` as a dual-role attribute when no separate device is specified.

### §10 — Unselected DS-4 XR100 datasheet
* **Rendered evidence:** full-page IronRidge XR100 spec image (`data-sheet-id="DS-4" data-ds-rail="pending"`) with a banner
  "RAIL NOT YET SELECTED — datasheet shown for reference only … IronRidge XR100 Rail is NOT the specified rail…".
* **Chain:** `datasheetAppendix.ts:93-105` pushes the page whenever the **mount's registry-v4 entry** exposes a rail default
  (`getRegistryEntryV4(mountId).requiredAccessories.find(category==='rail')` with `defaultManufacturer && defaultModel`,
  hard-set for RT-MINI at `equipment-registry-v4.ts:2629` = `IronRidge XR100 Rail 168"`) AND a `rail_spec` asset exists
  (`:100-103`). `_railPending` (`:39`, `!rackingAssembly?.railSku`) toggles ONLY the banner (`:123,130-134`), never the render.
* **Classification:** **improper fallback / validator coverage gap** — a datasheet appears authoritative without being selected
  by the snapshot; RP-C's banner is present but the authoritative-looking page remains.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** gate the push at `datasheetAppendix.ts:104` on `!_railPending` (omit until `railSku` pinned), or replace the
  spec image with a text-only placeholder. Ray's stated preference: omit-or-much-stronger-label.

### §11 — RT-MINI terminology "DIRECT-ATTACH MOUNT"
* **Rendered evidence:** PV-3 callout #2 `DIRECT-ATTACH MOUNT` (canonical `mountTopology` is `rail_paired`).
* **Chain:** `drafting/sheetComposition.ts:744` — `label: /RT[- ]?MINI|RAIL-?LESS|ROOF ?TECH/i.test(d.mountSys) ?
  'DIRECT-ATTACH MOUNT' : 'MOUNTING RAIL'` (and `:745` for callout #3). A **name-based regex** on the uppercased mount name
  (`getRoofData`, `:448-475`). The canonical `mountTopology:'rail_paired'` (`mounting-hardware-db.ts:585`, `classifyMountTopology`
  `:2779`) is never read — `equipmentProjection.ts` exposes no topology accessor. Same file at `:700-702` already excludes
  RT-MINI from rail-less spacing (sourced comment: RT-MINI is rail-based), so `:744` re-introduces the exact bug.
* **Classification:** **renderer-local literal via name-based inference** that ignores canonical `mountTopology`.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `sheetComposition.ts:744-745` — drive the label from canonical topology → `RAIL-PAIRED ROOF ATTACHMENT BASE`
  for `rail_paired`; retire the name regex; add an equipment topology accessor.

### §12 — Fastener authority
* **Rendered evidence:** APP-A correctly shows `5/16" (8mm/M8) structural wood screw, ~3.5" (90mm) — 2 per pad, no pilot hole`
  (`data-app-a-field="fastener"`); PE-1 and PV-4C still print generic `Lag bolt w/ flashing … 5/16" min … 2.5" into rafter …
  Stainless Steel`.
* **Chain:** a canonical FastenerAssembly EXISTS — source `mounting-hardware-db.ts:612,626,609`, projected as
  `rackingAssembly.screwLagModel` + per-attachment `fastenerModel ×31`; **APP-A projects it correctly**. PE-1 instead uses
  renderer-local literals: `certPages.ts:667` (`Lag bolt w/ flashing`), `:674` (`${lagDia}" min.`), `:675` (`Stainless Steel`),
  where `lagDia/lagEmbed` come from a *different* legacy mount object (`getMountingSystemById` `:620`, adapter `mounting/adapter.ts:228-231`,
  numeric only). PV-4C repeats it: `structuralPages.ts:847,883-884,901-905` (+ literals `:750-751`). `PENDING VERIFIED FASTENER ASSEMBLY`
  appears **0×** — no unverified gate.
* **Classification:** **duplicated authority / stale projection** (canonical object exists, unconsumed by PE-1/PV-4C).
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** point `certPages.ts:667,674-675` + `structuralPages.ts:847,883-884,901-905` at `rackingAssembly.screwLagModel` /
  `fastenerModel` (as APP-A does); add a `PENDING VERIFIED FASTENER ASSEMBLY` gate when unverified.

### §13 — Unsupported framing adequacy
* **Rendered evidence:** HEAD PV-4C DEAD-LOAD paragraph: "The governing bending check at **32%** *confirms the existing framing
  has adequate capacity*…" (target(3): `56%`; live-DB: `32%` — same unsupported verdict). The framing card, interpretation and
  conclusion elsewhere on the sheet correctly print UNVERIFIED / REVIEW REQUIRED.
* **Chain:** `structuralPages.ts:833-841` — the "DEAD LOAD INTERPRETATION" `<div>` is **not** wrapped in the `_reviewRequired`
  gate; it renders unconditionally off legacy `structural.rafter.utilizationRatio` (`_utilRatio`), emitting
  `_utilRatio <= 1.0 ? 'confirms the existing framing has adequate capacity' : …` (`:838-840`). This is a pass-style verdict
  from the same code-default `utilizationRatio` the rest of the sheet disowns.
* **HEAD-fixed portions (honest):** `55 psf`, `56% utilization`, `12-ft span` are **gone** at HEAD — commit 3a06cc80 wrapped the
  `${utilization}%` emitter (`:803,838,940`) in an indeterminate gate → "ENGINEERING REVIEW REQUIRED — NO FRAMING PASS/FAIL
  CONCLUSION ISSUED". The lone "12 ft" hit is the torque note `8-12 ft-lbs`; "span" appears only in the honest UNVERIFIED conclusion.
* **Blocker:** `STRUCTURAL-FRAMING-UNVERIFIED` / `engineeringReviewRequired:true` fire correctly (snapshot); the `:837-840` sentence just escapes the gate.
* **Classification:** **validator coverage gap** (renderer-local literal outside the `_reviewRequired` gate).
* **Live-vs-stale:** `56%/55psf` = fixed at HEAD / stale in (3); "adequate capacity" paragraph = **live at HEAD**.
* **Repair seam:** `structuralPages.ts:837-840` — gate the "adequate capacity" sentence on `!_reviewRequired` and null-guard `_utilRatio`,
  mirroring the already-gated paragraph at `:938-940`.

### §14 — Screening-envelope honesty  (NO DEFECT)
* **Rendered evidence:** PV-4C reconciliation footer (`structuralPages.ts:1103,1121-1123`) states "Uplift = ASD 0.6·W net C&C over
  the per-mount tributary", "CONSERVATIVE SCREENING ENVELOPE … GOVERNING corner (ASCE 7 Zone 3) pressure applied UNIFORMLY …
  not an exact per-position zone/tributary distribution", Zone column = `corner`, area ratio Σ tributary 756.288 ft² vs footprint
  636.461 ft² = **×1.188** (snapshot `ratio:1.188`).
* **Note:** the directive's "1.106" is this same conservative area ratio; the actual computed value is **1.188**. Honesty preserved,
  ASD stated, corner-zone governing pressure stated, ratio >1 stated. **No change needed.**

### §15 — Hidden print clipping
* **Method:** Playwright render at 17×11 (96 px/in); per `.page` (17in×11in, `overflow:hidden`, printable box ≈14.72in × 10.56in
  after the 2.0in title-block strip + 0.16in bottom padding), measured the lowest non-SVG descendant vs the printable bottom.
  SVG-internal elements excluded (map bleed is intentional). Identical results on HEAD-live and (3).
* **Confirmed clipped (content below printable box):**

  | Sheet | Overflow below printable bottom | Clipped element |
  |---|---|---|
  | PV-0 | ~2.4 in | VICINITY MAP + PROJECT-INFO column (`sec f1`) |
  | PV-4C | ~4.8 in | `PAGE CONCLUSION — ROOF STRUCTURAL ANALYSIS` (`structuralPages.ts:946`) |
  | SCHED | ~1.0 in | `PAGE CONCLUSION — EQUIPMENT SCHEDULE` (`structuralPages.ts:1650`) |
  | CERT | ~1.4 in | cert-footer legal text (`certPages.ts` footer) |
  | PV-4B | ~0.9 in | `PAGE CONCLUSION — CONDUCTOR & CONDUIT SCHEDULE` (`electricalPages.ts:837`) |

* **Ray's list `{PV-0, PV-4C, PV-4B, SCHED, CERT}` reproduces EXACTLY — no more, no fewer.** All other sheets sit within ~0.3in
  (the container filling to the outline). Map sheets PV-1/PV-2 show large SVG overflow that is intentional aerial bleed, not content clipping.
* **Root cause:** `.page{overflow:hidden}` + content taller than 10.56in; the appended "PAGE CONCLUSION" summary blocks + CERT footer
  + PV-0 vicinity/info columns exceed the fixed 11in page and are silently hidden. `constants.ts:401` even comments that "the table
  sat after the page conclusion and fell entirely past the page bottom". The 20==20 page-count gate cannot see it (no new page is created).
* **Classification:** validator coverage gap (no geometry-based page-fit gate) + layout composition.
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** true geometry page-fit validator (content bbox vs printable bbox, excluding title-block strip, failing on any
  non-SVG element below the printable box). Recompose: PV-0 (reduce vicinity/site sections, all map/address visible); PV-4C
  (reaction rows → formal continuation/appendix, keep summary+governing checks); PV-4B/SCHED (compact/remove duplicated conclusions);
  CERT (shorten or formally continue footer). Every continuation carries sheet id + title block + manifest entry + digest.

### §16 — "Issued for permit review"
* **Rendered evidence:** cover ENGINEERING SUMMARY: "…**Issued for permit review** — requires PE review and wet stamp before AHJ submission."
* **Chain:** `coverSheet.ts:596` — hard-coded literal. The correct accessor `issueStateLabel(input)` (`certPages.ts:55` → 
  `projectProjectAuthorityFromInput(input).issueStatus` = `PENDING ENGINEERING REVIEW`) already exists and is used at
  `certPages.ts:108` and even in coverSheet's own info row (`coverSheet.ts:438`, `pa.issueStatus`) — but the ENGINEERING SUMMARY
  paragraph ignores it. d201ea21's "issue-state reconciliation" fixed certPages and the cover info row but MISSED `:596`.
* **Classification:** **renderer-local literal.**
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** `coverSheet.ts:596` — replace the literal with `${escapeH(issueStateLabel(input))}` / `pa.issueStatus`
  ("PREPARED FOR ENGINEERING REVIEW — NOT FOR PERMIT SUBMISSION").

### §17 — Promote permit-critical advisories to blockers
* **Rendered evidence / chain:** three codes are emitted as `severity:'warning'`:
  * `CONDUIT-FILL-PENDING` — `build.ts:637` META + `:685-687` push (comment: "Emit it as an ADVISORY blocker").
  * `TAP-CONDUCTOR-LENGTH-PENDING` — `build.ts:638` META + `:692-695` push (comment: "advisory blocker").
  * `MODULE-EXACT-DATASHEET-PENDING` — `equipmentProjection.ts:265-266`.
  `deriveIssueState` (`projectAuthority.ts:129-171`) counts every blocker's domain as an authority gap regardless of severity, so
  these do currently keep the project out of ISSUED-FOR-PERMIT — but they are labeled advisory, and the directive requires them BLOCKING.
* **Classification:** **severity-policy / validator coverage gap.**
* **Live-vs-stale:** live at HEAD.
* **Repair seam:** flip `severity:'warning'→'blocking'` at `build.ts:637-638` + `equipmentProjection.ts:266` (conditioned on the fact
  actually affecting safety/procurement/permit acceptance), and add explicit severity-policy tests.

### §18 — Keep legitimate blockers  (SATISFIED at HEAD)
* All legit codes exist as `severity:'blocking'` in `build.ts` META (`:634-643`): `ROUTE-LENGTH-ESTIMATE`,
  `EQUIPMENT-IDENTITY-CONFLICT` (REC-405-vs-Qcells-400), `PROJECT-NAME-NONPRODUCTION` (TEST name), `DESIGNER-OF-RECORD-MISSING`,
  `CODE-AUTHORITY-INCOMPLETE`, `PROJECT-AUTHORITY-UNVERIFIED`, `ENGINEERING-REVIEW-PENDING`, + structural (`STRUCTURAL-FRAMING-UNVERIFIED`,
  `PENDING-RACKING-ASSEMBLY-SELECTION`, `WIND-SNOW-AUTHORITY-UNRESOLVED`, `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`,
  `RACKING-CAPACITY-APPLICABILITY-GAP`).
* **Snapshot blocker sets at HEAD:** fixture regen = 9 blockers; live-DB regen = 11 (adds `EQUIPMENT-IDENTITY-CONFLICT`,
  `PROJECT-NAME-NONPRODUCTION`, `DESIGNER-OF-RECORD-MISSING` because the live "TEST" row triggers them). **The live-DB "0 blocking"
  line in the harness log is the SNAPSHOT-VALIDATOR (V-gate) count, not permitReadiness blockers** — do not read it as suppressed blockers.
* **No defect.** Keep as-is; the §17 promotions must not weaken these.

---

## REPAIR PLAN (grouped for parallel implementation)

### A. Electrical (§1, §2, §3/§4, §9) — engine + electrical renderers
Order: **§3/§4 FIRST** (it is upstream of §2, §5, §6, §7, §8).
1. `computed-system.ts:2146-2151` + `1385-1416` + `1398-1427` — split the merged BRANCH_RUN into (open-air micro trunk) and
   (jbox→combiner shared conduit); add `physicalRacewayId`, `sharedCircuitCount`, `minimumCodeRacewaySize`, per-branch footage;
   stop overwriting `isOpenAir`. Extend `RunSegment` interface (`:99-148`).
2. `titleBlock.ts:203` + `electricalPages.ts:472,485,500,543` — one canonical route-description accessor (per §3/§4 raceway objects),
   drop `project.conduitType || 'EMT'`; package gate rejecting >1 raceway type/size per segment id (§2).
3. `electricalPages.ts:75` (drop recompute), `:262,275,377,392,686,734` (single busbar-text helper), `:230-257` (retire legacy `rulesResult`) (§1).
4. `build.ts:412-417` — evidence-gate `svc-utility-disconnect` (§9).
* **Shared-file conflicts:** `electricalPages.ts` touched by §1, §2, §5 (schedule read), §15 (PV-4B clip line 837) — one owner.
  `computed-system.ts` touched by §3/§4 AND BOM §5 — sequence A before B. `build.ts` touched by §9 (electrical) AND §17 (governance).

### B. BOM (§5, §6, §7, §8) — `bom-engine-v4.ts` (+ E-1 renderer)
Depends on A's per-raceway objects.
1. `bom-engine-v4.ts:2419-2491` — iterate physical raceways (per-raceway conduit + couplings + straps + bends); retire `— all runs` (§6).
2. `bom-engine-v4.ts:2434,2449,2468,2471,2476,2486` + twins `1074,1099,1146…` — NEC article from raceway type, not `'NEC 358'` (§7).
3. `bom-engine-v4.ts:2386-2417` (stop gauge-keyed re-merge; carry segment identity) + delete flat structural EGC `:1535,2698`; branch gauge
   from conductor authority not the RunSegment (§5).
4. `sld-professional-renderer.ts:2526,3799` — gate DC-conductor legend on `!isMicro` (§8).
* **Shared-file conflicts:** `bom-engine-v4.ts` is the single most-contended file (§5+§6+§7) — one owner, sequential edits.
  `sld-professional-renderer.ts` (§8) is independent.

### C. Structural (§10, §11, §12, §13; §14 no-op) — structural renderers + drafting
1. `datasheetAppendix.ts:104` — gate/omit DS-4 XR100 until `railSku` pinned (§10).
2. `drafting/sheetComposition.ts:744-745` — label from canonical `mountTopology`; add equipment topology accessor (§11).
3. `certPages.ts:667,674-675` + `structuralPages.ts:847,883-884,901-905` — project `rackingAssembly.screwLagModel`/`fastenerModel`;
   add PENDING-VERIFIED-FASTENER gate (§12).
4. `structuralPages.ts:837-840` — gate the "adequate capacity" sentence on `!_reviewRequired` (§13).
* **Shared-file conflicts:** `structuralPages.ts` touched by §12, §13 AND layout §15 (clip lines 946/1650) — one owner.
  `certPages.ts` touched by §12 (fastener) AND governance §16-adjacent (issue-state already correct there).

### D. Layout (§15, §16) — page composition + geometry gate
1. Build the true geometry page-fit validator (Playwright/DOM: non-SVG content bbox vs printable bbox, excluding title-block strip).
2. Recompose PV-0, PV-4C (`structuralPages.ts:946`), SCHED (`:1650`), PV-4B (`electricalPages.ts:837`), CERT (footer) — continuation
   sheets with full title block + manifest entry + digest (§15).
3. `coverSheet.ts:596` — issue-state accessor (§16).
* **Shared-file conflicts:** §15's edits to `structuralPages.ts`/`electricalPages.ts` collide with C(§12/§13) and A(§1) — layout must
  merge AFTER those renderers settle, or share the owner. `coverSheet.ts` (§16) independent.

### E. Governance (§17, §18) — blocker registry + severity policy
1. `build.ts:637-638` + `equipmentProjection.ts:266` — promote the three advisories to `blocking` (§17); severity-policy tests.
2. §18 — no change; add a regression test that the §17 promotions do not suppress the 9/11 legit blockers.
* **Shared-file conflicts:** `build.ts` touched by §9 (cluster A) AND §17 (cluster E) — coordinate one owner for `build.ts`.

### Cross-cluster dependency summary
* **A(§3/§4) → B(§5,§6,§7) → §2:** per-raceway objects must exist before BOM iterates them and before the route accessor is single-sourced.
* **A(§3/§4) → B(§8-adjacent open-air):** the open-air trunk split feeds the DC/open-air rendering.
* **`build.ts` shared by A(§9) + E(§17):** single owner.
* **`electricalPages.ts` shared by A(§1,§2) + B(§5 read) + D(§15):** single owner, sequence A→B→D.
* **`structuralPages.ts` shared by C(§12,§13) + D(§15):** single owner, sequence C→D.
* **`titleBlock.ts:203` (§2) also emits the §7 mixed NEC 358/352 literal** — fix both in one edit.

## Regeneration artifacts (this audit)
* `_tmp_head_verify.html` / `.snapshot.json` — HEAD frozen-fixture regen (PDS-F047C1DED872).
* `_tmp_head_live.html` / `.snapshot.json` — HEAD live-DB regen (PDS-8E6B472DD4B4).
* Target: `C:\Users\Ray\Downloads\PermitPackage-BRAIDON M PILLA — Solar TEST (3).html` (PDS-1DDC4EDE238C).
* Clip measurement harness (scratchpad): `measure_clip.mjs`.

---

## AFTER — closeout outcomes (per section)

Closeout commit on `dev`. Verified on the regenerated live package **PDS-00E105F58C2C**
(21 sheets) and the frozen fixture **PDS-B7FBCEEDBD28** by `scripts/planset-evidence-co.mjs`
(**20/20 gates, both modes**), `scripts/planset-pagefit.mjs` (21 sheets, 0 clipped), and the
object-derived artifacts in `docs/evidence/`.

| § | BEFORE (live at HEAD) | AFTER (this closeout) | Evidence |
|---|---|---|---|
| 1 | duplicated busbar literals + `:75` synthesized-pass fallback | PV-4A projects snapshot compliance; `120% BUSBAR RULE N/A`; PENDING never PASS; legacy rules-detail table retired | gate 1/2; electrical-closeout-0723 |
| 2 | `Conduit type: EMT` note vs PVC segment | one route-description accessor; no `\|\| 'EMT'`; PV-1 note = canonical raceway | gate 3; braidon-electrical-segment-graph |
| 3/4 | merged whole-branch `1-1/4" PVC` run; no per-raceway object | `BRANCH_RUN` open-air Q-Cable **split from** `BRANCH_HOMERUN_RUN` shared conduit; 3 `physicalRaceways[]` with `sharedCircuitCount`/`minimumCodeRacewaySize`/fill | gate 4; braidon-physical-raceway-graph |
| 5 | `#10 AWG — AC wiring (…)=198 ft` merged; double-billed EGC | per-segment object-derived feet (#10=125, #6=121); one shared EGC/raceway; no orphan/merged row | gate 5; braidon-branch-conductor-reconciliation |
| 6 | `conduit — all runs = 120 ft` roll-up | per-raceway material/couplings/straps labelled to its raceway id; **0** "all runs" | gate 6; braidon-physical-raceway-graph |
| 7 | `NEC 358` on PVC rows | article from raceway type (PVC→352); 0 snapshot mismatch, 0 rendered PVC-cites-358 | gate 7 |
| 8 | E-1 DC-conductor legend on a micro job | DC legend gated on `!isMicro`; 0 DC rows without a DC segment | gate 8 |
| 9 | fused tap OCPD + fabricated utility disconnect (2 devices) | ONE listed **dual-purpose** fused disconnect; 8-object physical-order chain; separate disconnect only when project specifies | gate 9; braidon-service-device-topology |
| 10 | DS-4 XR100 authoritative page + banner-only | DS-4 **omitted** while `railSku` unpinned; XR100 appears only as a pending-selection example | gate 10; braidon-racking-fastener-state |
| 11 | `DIRECT-ATTACH MOUNT` | `RAIL-PAIRED ROOF ATTACHMENT BASE` from canonical `mountTopology` | gate 11 |
| 12 | PE-1 generic `lag bolt / 5/16" / stainless` | one fastener object identical on APP-A/PE-1/SCHED; PE-1 `PENDING VERIFIED FASTENER ASSEMBLY` | gate 12; braidon-racking-fastener-state |
| 13 | `56%/55psf` (stale) + live "adequate capacity" paragraph outside the gate | capacity/utilization/adequate gated on `_reviewRequired`; **UNVERIFIED framing → NOT VERIFIED, no verdict** (fixture); operator-verified framing still shows capacity (established structural contract — archived-document authority is the recommended stronger future gate) | gate 13; braidon-framing-authority |
| 14 | (no defect) | preserved: `CONSERVATIVE SCREENING ENVELOPE`, GOVERNING corner, ASD, ratio ×1.106, "NOT an exact per-position … geometry" | gate 14; braidon-screening-envelope |
| 15 | PV-0/PV-4C/SCHED/PV-4B/CERT clipped under `overflow:hidden` | TRUE geometry page-fit gate; PV-4C.1 continuation; **21 sheets, 0 clipped** | gate 15; braidon-page-fit-report |
| 16 | `Issued for permit review` | `DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION`; issue-status = `PENDING ENGINEERING REVIEW` everywhere | gate 18 |
| 17 | 3 permit-critical codes `severity:'warning'` | promoted to **blocking** (conduit-fill, tap-conductor-length, module-exact-datasheet); severity policy | gate 19; severity-policy-gate19 |
| 18 | (satisfied) | legit blockers preserved — live registry **14 blocking / 0 advisory** (fixture 12); promotions do not suppress them | gate 19; blocker-preservation-s18 |

**Note on §13 / live-DB framing (deviation, honest):** the binding audit target is the
fixture (framing genuinely unverified → renders NOT VERIFIED, gate 13 strict). The live DB
row 4030b664 carries complete operator-entered framing (truss / 2x6 / 24" / Douglas Fir-Larch /
12 ft) which the established structural contract (`isFramingVerified`, snapshot-w3-structural)
treats as verified, so the live package renders the modeled capacity. Gate 13 is conditioned on
the snapshot's *unverified* state (per the directive's exact wording "unverified framing cannot
display capacity") and is not weakened. Requiring an **archived** structural-authority document
(not just typed dimensions) is the recommended stronger future gate; it was not reversed here to
avoid re-litigating the committed structural contract under this pass.
