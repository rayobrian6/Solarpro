# Repair-Pass Root-Cause Map — Phase 0 Forensic Audit

Date: 2026-07-22. Author: Phase 0 (forensic, READ-ONLY).
Audit target (the evidence): `C:\Users\Ray\Downloads\PermitPackage-BRAIDON M PILLA — Solar TEST (2).html`
— snapshot **PDS-310F43D87A27** (digest `310f43d87a27…`), file mtime 2026-07-22 19:01.
Repo: `C:\Users\Ray\Solarpro Claude\repo` branch `dev` HEAD `d201ea21` (committed 2026-07-22 17:53,
"Post-campaign correction: cross-sheet truth reconciliation").
Project: BRAIDON M PILLA — Solar TEST, Granite City IL 62040 (project id `4030b664…`).
Design: pure Enphase **IQ8A** micro roof, 31 × Qcells **Q.PEAK DUO BLK ML-G10+ 400W**, 12.40 kW DC, RT-MINI mount.

---

## 0. Master finding — why the package contradicts the "fixes"

**The delivered package is a PRE-`d201ea21` deploy.** Its file mtime (19:01) is *after* the commit
(17:53), but that timestamp is the **download** time, not the generation time. Ray downloaded from the
deployed app, which at that moment was still running an **older commit** (Vercel deploy lag — the exact
"Ray saw OLD output + doubted the work / NOT DEPLOYED" pattern in prior handoffs).

Proof by value diff (I regenerated a package at current HEAD from the same live DB via
`_tmp_braidon_regen.ts` → `_tmp_HEAD_regen.html`, snapshot **PDS-7FFB99730144**, and diffed against the
flattened delivered text):

| Value | Delivered (PDS-310…) | HEAD regen (PDS-7FFB…) | Meaning |
|---|---|---|---|
| Per-attachment uplift reaction | **369 lb** (×5) | **404 lb** (×45) | d201ea21 raised wind pressure |
| IQ8A max continuous current (elsewhere) | 1.46 only | derived 1.45 appears | pre-d201ea21 datasheet path |
| PE-1 attachment safety factor | **1.63** | 1.49 (gone) | arithmetic of the higher uplift |
| Design wind speed | **110 mph** | **115 mph** | authority change (W4 campaign) |
| Roof obstructions on PV-1 | "3 obstruction(s) (NEARMAP AI)" + VENT×3 | "NO ROOF OBSTRUCTIONS MODELED" | Nearmap input drift |

Because the delivered package predates the commit, **every genuine d201ea21 fix is absent from it**, and
the prior agent's green report (written against HEAD) legitimately shows different numbers than the
package. **The report was not lying; it described a build the package was never generated from.**

**But the correction was also incomplete.** `d201ea21` corrected the *canonical snapshot/engine objects*
(issue-state, reaction schedule, capacity gate, tap objects, feeder projection) but left the
**renderer-local literals and parallel/legacy emitters** that read stale or duplicated sources. Those
reproduce **identically in my HEAD regen** and are the true live defects. The binding spec it claimed to
satisfy is `docs/POST-CAMPAIGN-CORRECTION-2026-07-22.md` (dated 00:52); §1/§5/§8/§9 largely landed,
**§2/§3/§4/§6/§10 did not** (see per-finding entries).

**Snapshot digest note:** `snapshot/digest.ts` is a deterministic content-hash (SHA-256 over canonical
JSON, no timestamp). Digests differ across regens only because **inputs drift** (wind 110→115, Nearmap
obstruction count, module resolution). Digest equality is therefore not a usable identity test here;
value diffs are. No saved artifact matches PDS-310…; the delivered build's exact commit is older than any
frozen snapshot in-repo.

---

## Legend
Chain = DB/source → authority record → engine → snapshot field → projection accessor → renderer (file:line) → validator.
Status = **LIVE** (reproduces in HEAD regen) / **STALE** (fixed or changed at HEAD; only in the older delivered build) / **PARTIAL** (partly fixed at HEAD).

---

## W1 — ELECTRICAL

### W1a · PV-4A "1" EMT / 32.5% fill / 1.11% VD / PASS / 0 errors 0 warnings" vs PV-4B "1-1/4" PVC Sch 80 / fill PENDING / 20 ft / 0.37%"
- **Sheets:** PV-4A (`pageNECCompliance`) and PV-4B (`pageConductorSchedule`).
- **Chain (PV-4A):** app rules engine → `input.rulesResult` (a **pre-snapshot legacy projection**, carried on PermitInput) → rules table `electricalPages.ts:192-205` (embeds the "1" EMT / 32.5% / 1.11%" strings) → PASS summary `electricalPages.ts:174-188` reads `rulesResult.errorCount/warningCount/autoFixCount`. It counts **only legacy rules rows**; it never reads the canonical feeder's `hasHole/holes` (`electricalProjection.ts:95-100`) or serviceTopology PENDINGs, so PV-4B's PENDING fill/tap register as "0 errors". The VD remap patch `_remapVdRule` (`:132-143`) missed the 1.11% row (text didn't match the `/voltage drop/` regex); conduit size/fill have no remap.
- **Chain (PV-4B):** `computeSystem` COMBINER_TO_DISCO_RUN → feeder object `build.ts:850-858` (VD `:855`=0.37; raceway/size `:856`=PVC/1-1/4"; **fillPct `:857` reads legacy `elec.conduitFill.fillPercent`=null → PENDING**) → `projectCanonicalFeeder` `electricalProjection.ts:47-108` → `_feed` `electricalPages.ts:382` → fill `:520-526`, VD `:527-544`.
- **Classification:** stale-projection (PV-4A reads `rulesResult`) + improper-fallback (PV-4B fill reads legacy null field) + validator-coverage-gap (PASS summary checks a stale authority).
- **Status:** **LIVE.** *Harness caveat:* the regen harness does not populate `input.rulesResult`, and `electricalPages.ts:174` gates the card on `${rulesResult ? …}`, so the PV-4A card did not render in my regen. Code path is unchanged at HEAD; the deployed app populates `rulesResult`, so it renders. Confirmed live by source inspection.
- **Repair seam:** delete the PV-4A `rulesResult` table + summary; render PV-4A from the same `projectCanonicalFeeder`/electricalProjection the PV-4B/SCHED/BOM use. Give `fillPct` a real value or a blocking PENDING (never counted as 0 errors).

### W1b · E-1 feeder schedule (#6 + #10 in 1-1/4" PVC) vs E-1 diagram annotation (#12 + #10 in 3/4" EMT)
- **Sheet:** E-1 (`renderSLDProfessional` in `sld-professional-renderer.ts`).
- **Chain:** schedule feeder rows `:2831-2832` resolve `${resolvedAcCondType} ${resolvedAcConduit}` from `acFeederRun`/adapter (`sldAdapter.ts:195-196` = PVC 1-1/4", `:110-111` = #6) — snapshot-driven and correct. Diagram branch annotation `:1954` = renderer-local fallback literal `IN ${input.branchConduitSize ?? '3/4"'} EMT`, gauge `#12` from the 20 A micro-branch (`:1948-1953`).
- **Classification:** duplicated-authority + renderer-local-literal.
- **Status:** **LIVE.** *Honesty:* these are **two different circuits** (branch vs feeder), not one contradicted value — the defect is that E-1 draws them adjacently with no feeder/branch disambiguation and the branch label is a hardcoded `'3/4" EMT'`.
- **Repair seam:** source the SVG branch label from the snapshot branch segment; label the two rows explicitly "BRANCH" / "FEEDER".

### W1c · E-1 branch rows "OPEN AIR" vs PV-4B branch 60 ft in EMT
- **Chain (E-1):** hardcoded `conduit:'OPEN AIR'` `sld-professional-renderer.ts:2818/2826`; diagram `'OPEN_AIR'` `:1924` — renderer literals (Q Cable TC-ER is free-air rated, 690.31(C)). **Chain (PV-4B):** micro rows `electricalPages.ts:469-480`, conduit `:478`=`${project.conduitType||'EMT'}`, length `:479`=`${project.wireLength||'—'} ft`=flat 60 ft (the "60 ft for every circuit" bug flagged at `computedRuns.ts:11-14`).
- **Classification:** renderer-local-literal / improper-fallback (PV-4B applies the feeder run length to branch conductors; reads raw `project.*` not the canonical run).
- **Status:** **LIVE.**
- **Repair seam:** decide one branch wiring method (open-air Q-cable is correct for micros); drive both sheets from the same canonical branch run; stop reading `project.wireLength` for branch length.

### W1d · PV-4B "60 A" shown next to a VD computed at ~45 A
- **Chain:** engine sizes/derates the feeder at **operating** current `acOutputCurrentA≈45.1 A` (`computed-system.ts:1432-1442`, VD `calcVoltageDrop` `:655-707`, stored `continuousCurrent:acOutputCurrentA` `:1457`, `voltageDropPct` `:1463`) → `_feed.voltageDropPct`=0.37%. Renderer prints the **OCPD** in the VD table's Amps column: `electricalPages.ts:536`=`${_ic.feederOcpd||'—'}A`=60 A; operating current never displayed.
- **Classification:** renderer-local-literal (wrong field in the amps column). Engine calc is correct.
- **Status:** **LIVE.**
- **Repair seam:** print operating current (45.1 A) in the VD amps column, or add both columns "Operating A" and "OCPD A".

## W2 — TOPOLOGY

### W2a · PV-6 / E-1 conflate combiner load-break, fused tap disconnect, RSD initiator, utility disconnect
- **Chain:** the snapshot carries four canonical objects — `svc-tap-conductors`, `svc-fused-ocpd`, `svc-utility-disconnect`, `svc-service-disconnect` (`build.ts:342-383`). **Neither PV-6 nor E-1 projects them.** PV-6 `pageDisconnectDirectory` `compliancePages.ts:615-648` rebuilds `discos[]` from **raw `project.*` + `bos`** and merges the fused tap OCPD with the combiner integral load-break into one "PV AC DISCONNECT" row (`:617`). E-1 draws one system disco.
- **Classification:** missing-canonical-object + duplicated-authority.
- **Status:** **LIVE.**
- **Repair seam:** render PV-6 + E-1 disconnect roles from `snapshot.serviceTopology`; one row per canonical device.

### W2b · Tap-length (705.11(C) ≤10 ft) rule applied to the 60-ft downstream feeder
- **Chain:** the ≤10-ft rule is bound to the **tap-conductor object only** `build.ts:350-355` (`state:'pending'`, `lengthFt:null`), rendered `electricalPages.ts:649-682` (PENDING, explicitly separated from the 60-ft feeder segment). Validator V43 `validate.ts:325-348` blocks any "≤10 ft PASSES" without a known length.
- **Classification:** validator-coverage-gap **resolved in the snapshot path**; missing-project-evidence (tap length never measured → PENDING is honest). PV-6 directory still conflates roles (W2a).
- **Status:** **PARTIAL/STALE** — for PV-4B the conflation is fixed at HEAD; if the delivered package applied the rule to the 60-ft feeder that is the older build.
- **Repair seam:** measure/record tap length; keep PV-6 role separation (see W2a).

## W3 — DRAWING

### W3a · PV-1B "WIRED IN SERIES PER AC BRANCH" on a microinverter design
- **Chain:** hardcoded literal `roof.ts:1920` inside the `isBranchColorMode` caption block (`:1915-1923`): `'IQ8 MICROINVERTER (▪) UNDER EACH MODULE · WIRED IN SERIES PER AC BRANCH …'`. No authority read. Micros are **paralleled on an AC branch**, never DC-series.
- **Classification:** renderer-local-literal.
- **Status:** **LIVE.** d201ea21 §4 retitled the *sheet* to "AC BRANCH CIRCUIT LAYOUT" but missed this caption; `docs/POST-CAMPAIGN-CORRECTION-2026-07-22.md:28` lists it as an open item.
- **Repair seam:** replace with "paralleled on AC branch / Q-Cable" wording at `roof.ts:1920`.

### W3b · PV-1 shows BOTH "CAD-DERIVED ESTIMATE — FIELD VERIFY" AND "route field-verified"
- **Chain:** Label A (correct) = snapshot-flow: `build.ts:305` stamps `lengthSource:'cad-derived-estimate'` → `routeProvenanceLabel()` `electricalProjection.ts:113-118` → `roof.ts:1868/753`. Label B (wrong) = renderer-local literal `sheetComposition.ts:733` numbered callout `sub:\`route field-verified — ${d.conduitType}\``, ignores the snapshot.
- **Classification:** renderer-local-literal (Label B) vs snapshot-flow (Label A).
- **Status:** **LIVE.** d201ea21 §6 fixed the trench/JB path but not the callout table.
- **Repair seam:** source the `sheetComposition.ts:733` callout from `routeProvenanceLabel(snapshot)`.

## W4 — BOM

### W4a · #10/#12 USE-2 DC roof-wiring rows + DC labels in a pure-micro BOM
- **Sheet:** BOM / SCHED. Rendered rows: "#10 AWG USE-2 — DC roof wiring (open-air, panels to microinverters)" 104 ft, "#12 USE-2 …" 18 ft.
- **Chain:** DC rows emit in the **`else` branch of `if(isMicro)`** `bom-engine-v4.ts:619-664` (`:626` USE-2 home run, `:641-651` DC conduit, `:659` DC disco). Root cause: `topoCtx` is built **without `input.topologyType`** `bom-engine-v4.ts:401-410`; `resolveTopology` then falls to `STRING_INVERTER` on any inverter-id round-trip miss (`topology-manager.ts:425-427`), so `isMicro` is false and the DC branch runs, while Stage 1 still emits the micro via the `microDb` fallback. `bomForPermit.ts:475-476` already computes the authoritative `isMicro` but never passes it into `generateBOMV4`.
- **Classification:** improper-fallback (STRING_INVERTER default masks a resolution miss) + missing-canonical-object (design `topologyType` not propagated).
- **Status:** **LIVE** (USE-2 DC rows present in HEAD regen BOM).
- **Repair seam:** thread `input.topologyType`/`isMicro` into `generateBOMV4` topology resolution; make the STRING_INVERTER fallback blocking, not silent.

### W4b · 1-1/4" PVC "all runs" alongside 3/4" EMT fittings; note says "Conduit type: EMT"
- **Chain:** AC feeder runs sized from the canonical feeder (`bomForPermit.ts:535-538` → `_bomFeed.raceway/tradeSizeIn` = PVC 1-1/4") grouped `bom-engine-v4.ts:1023-1032`. DC-stage conduit falls to `input.conduitType ?? 'EMT'` / `?? '3/4'` `bom-engine-v4.ts:623-624` → "3/4" EMT" fittings. The general note "Conduit type: EMT" is a separate `project.conduitType` literal.
- **Classification:** duplicated-authority / improper-fallback. V41 `validate.ts:301-320` covers only the feeder projection, not DC-stage conduit or the AC/DC size contradiction.
- **Status:** **LIVE** (contingent on W4a firing; fixing W4a removes the DC rows).
- **Repair seam:** one conduit resolver for all stages; the "all runs" note must match actual per-run raceway.

## W5 — EQUIPMENT

### W5a · APP-A IQ8A (349 VA "Peak", 1.46 A, 96.5% CEC, 2.2 lb) contradicts the embedded datasheet (366 VA peak / 349 continuous, 1.45 A, 97.5%, 2.38 lb)
- **Chain:** `system.inverters[0].model="IQ8A"` → fuzzy `_dbFind` `compliancePages.ts:796-797` → equipment-db record `enphase-iq8a` `equipment-db.ts:2035-2057` → APP-A table `compliancePages.ts:993-1006`: `acOutputW:349` mislabeled "Peak" (`:996`), `acOutputCurrentMax:1.46` (`:997`), `cec_efficiency:96.5` (`:1002`), `weight:2.2` (`:1004`). The **embedded datasheet asset note** `manufacturer-assets-db.ts:105` carries the correct 366/349/97.5. **APP-A bypasses the snapshot**, which itself derives the correct continuous 349 VA / 1.454 A at `snapshot/build.ts:137-144`. **SKU:** record `enphase-iq8a` has **no `partNumber`**; the canonical `IQ8A-72-2-US` lives only in `equipment-registry-v4.ts:824` / `equipment/specSheets.ts:72` / `manufacturer-assets-db.ts:105` (BOM Stage-1 correctly prints IQ8A-72-2-US / 0.366 kW — a within-package contradiction with APP-A). Legacy `IQ8A-72-M-US` reconciled 07-22; sibling `enphase-iq8ac` still carries un-reconciled `IQ8AC-72-M-US` (`equipment-registry-v4.ts:871`).
- **Classification:** duplicated-authority (equipment-db raw vs embedded datasheet vs snapshot) + renderer mislabel ("Peak" on the continuous field) + missing-canonical-object (SKU-less record).
- **Status:** **LIVE** (APP-A prints 1.46/349/96.5/2.2 at HEAD; d201ea21 did not touch this path).
- **Repair seam:** fix the `enphase-iq8a` record (366 peak / label 349 as continuous / 1.45 / 97.5 / 2.38 / add partNumber IQ8A-72-2-US) **or** point APP-A at the snapshot micro projection.

### W5b · APP-A thermal −10 °C vs ASHRAE −23 °C elsewhere
- **Chain:** −10 = hardcoded fallback `compliancePages.ts:832` `project.designTempMin ?? -10` (used in 690.7 cold-Voc `:833-835/:928`). −23 = `designTemps.ts:29` `IL:[-23,33]` via `getDesignTemps().ashraeExtremeLowC`, used correctly by the same file at `:60` and `:562`.
- **Classification:** improper-fallback (APP-A alone hardcodes −10 instead of `getDesignTemps`).
- **Status:** **LIVE.**
- **Repair seam:** `compliancePages.ts:832` → `project.designTempMin ?? _temps.ashraeExtremeLowC`.

### W5c · DS-1 module page generic 385-415W range vs exact 400W
- **Chain:** `resolveEquipmentDatasheets` `datasheetAppendix.ts:48-51` → equipment-db `qcells-peak-duo-400` → `getManufacturerAsset(id,'module_spec')` → the only asset on file is the **series datasheet** (docTitle "…385-405W"; PNG band 395-415W) embedded `datasheetAppendix.ts:113`. No per-wattage crop.
- **Classification:** missing-project-evidence (no exact-model datasheet asset). **This is the only "405" in the package** — the source of Ray's "405" sightings, not a REC module.
- **Status:** **LIVE** (both builds).
- **Repair seam:** add a 400W-specific datasheet asset or crop; note the exact model on the page.

## W6 — RACKING

### W6a · "RAIL-PENDING-SELECTION" / "Compatible rail — PENDING SELECTION" / multiple rail families, while the IronRidge XR100 datasheet is embedded
- **Chain:** mount RT-MINI (`mounting-hardware-db.ts:576-638`) is `rail_based`/`rail_paired` **with no `rail` sub-object** → `rackingAssembly.ts:303` `railUnpinned=true` → `railDisplay=RAIL_PENDING` (`:342`), `splice=RAIL_PENDING` (`:545`); APP-A parallel string `compliancePages.ts:1032-1037`. Meanwhile DS appendix resolves a concrete rail from `equipment-registry-v4.requiredAccessories` (IronRidge XR100 168", `equipment-registry-v4.ts:2625-2629`) and embeds its datasheet (`datasheetAppendix.ts:84-95`). "Multiple families" text = `mounting-hardware-db.ts:624` railSplice list, matched by the multi-family regex `rackingAssembly.ts:308`.
- **Classification:** duplicated-authority + missing-canonical-object (rail identity split: mounting-hardware-db=none vs registry=XR100).
- **Status:** **LIVE.**
- **Repair seam:** single-source the rail SKU (pin XR100 into the mount record or make the registry accessory the authority the schedule reads); remove "or equivalent" per §10.

### W6b · Fastener contradictions: 5/16×3.5 wood screw vs 5/16×4 SS lag vs 3/8 note
- **Chain:** (1) `mounting-hardware-db.ts:626` lagBolt "5/16 … ~3.5" … 2 per pad" → snapshot `screwLagModel` `rackingAssembly.ts:551`; (2) duplicate hardcoded copy `rackingAssembly.ts:391`; (3) **APP-A fabricates "5/16" DIA × 4" Min. Stainless Steel"** — `compliancePages.ts:1017-1021` computes `_lagLen=ceil((embedment 2.5 + 1.5)*2)/2 = 4` and prints it `:1048`, contradicting the record's `fastenerLengthIn:3.5` / `fastenerType:'structural wood screw'` (`mounting-hardware-db.ts:611-612`); (4) 3/8" torque note + legacy `roof.ts:2009` hardcoded "3/8" lag" comment.
- **Classification:** duplicated-authority + renderer-local-literal + incorrect-engine-calculation (the `(embedment+1.5)` length formula invents a 4" SS lag).
- **Status:** **LIVE.** (§10 of the mandate explicitly names "5/16 × 4 lag" to reconcile.)
- **Repair seam:** delete the APP-A length/material formula; render the single canonical fastener record everywhere (PV-3 detail, APP-A, BOM, notes).

## W7 — STRUCTURAL

### W7a · All 64 attachments labeled "corner" zone
- **Chain:** engine literal `structural-engine-v4.ts:1253` `const roofZone='corner'` (deliberate governing-zone conservatism, comment `:1248-1252`, commit `4a096cdc5` 06-20) → `run.wind.roofZone` → `attachment.roofZone` `structuralAuthority.ts:484` → cell `structuralPages.ts:1025`. No per-attachment ASCE 7 zone map.
- **Classification:** missing-canonical-object / incorrect-engine-calculation (single-zone model shown per-attachment).
- **Status:** **LIVE.**
- **Repair seam:** compute per-position field/edge/corner zones (ASCE 7-22 C&C) or label the schedule "governing zone (corner) applied to all".

### W7b · All 64 attachments identical 11.0 ft² tributary
- **Chain:** `calcMountLayout` computes ONE `tributaryAreaPerMountFt2` `structural-engine-v4.ts:614/623/642`, broadcast to every attachment `structuralAuthority.ts:490`. End mounts charged a full interior tributary (comment `structuralEngine.ts:196-203`), so 64×11=704 > true 636.46.
- **Classification:** incorrect-engine-calculation (uniform, conservative, not per-position).
- **Status:** **LIVE.**
- **Repair seam:** per-position tributary (half-tributary at ends) or explicit "conservative uniform tributary" label.

### W7c · Identical 369 lb reaction (delivered) → 404 lb (HEAD) — the report-vs-package divergence
- **Chain:** reaction computed once, array-wide: `calcMountLayout` `structural-engine-v4.ts:624` `upliftPerMount = asdUpliftDemandLbs(netUpliftPsf, tribArea)`; `asdUpliftDemandLbs` = `0.6 × strengthUpliftPsf × tribArea` (`attachmentCapacity.ts:71`); `netUpliftPsf=|qz×GCp(−2.5)|` `structural-engine-v4.ts:1255`. Broadcast to all 64 `structuralAuthority.ts:491` → `structuralPages.ts:1030`.
- **The delta:** engine/wind formula is **byte-identical** across the delivered deploy (`repo-bisect@dfe63c9e`) and HEAD. The ONLY change is the **wind input pressure 55.95 → 61.15 psf** (369 = 0.6×55.95×11; 404 = 0.6×61.15×11), i.e. windSpeed/exposure resolution changed 110→115 mph via `structuralInput.ts:36/72` (the W4 AHJ/project-authority campaign). Evidence artifact `docs/evidence/braidon-attachment-reaction-reconciliation.json`: HEAD uplift 403.606, trib 11, 0.6W 36.691, SF 1.487.
- **Classification:** stale-projection / input-authority change (engine correct).
- **Status:** **STALE** (this is the master proof: report described HEAD=404, package is the older 369 deploy). Not a code defect in itself; the wind-input authority should be verified against AHJ.
- **Repair seam:** confirm the 115 mph / Exposure source is AHJ-verified (currently code-minimum default; see W10 blockers).

### W7d · Σ tributary 704 ft² vs roof 636.46 ft² called "RECONCILED" with a 3.0 band
- **Chain:** `reconcileReactions` `structuralEngine.ts:260`, tributary check `:322-329`, band `REACTION_CLOSURE_LOWER=0.98` / `REACTION_CLOSURE_UPPER=3.0` `:219-220`, verdict `structuralPages.ts:1044`. 704/636.46=1.106 ∈ [0.98,3.0] → RECONCILED.
- **Classification:** validator-coverage-gap (upper ceiling too loose — would pass ~2–3× object duplication).
- **Status:** **LIVE.** *Honesty:* for THIS package the reconciliation is **legitimate** (full-interior-tributary envelope → Σ≥area is expected; not lost load). The defect is only the loose ceiling as a general guard.
- **Repair seam:** tighten the upper band (e.g. tie to expected end-mount over-count ≈ perimeter fraction) while keeping the 0.98 floor.

## W8 — PE-1 BYPASS

### W8 · PE-1 prints 600 lb capacity / SF 1.63 / 45 psf truss / 12 ft span / 69% bending PASS / "adequate", while PV-4C says UNVERIFIED
- **Sheet / render path:** PE-1 = `pagePELetterRoof` `certPages.ts:549` (peLetter.ts holds only shared primitives `:42-71`).
- **The gate that half-reaches PE-1:**
  - The **certification-approval gate** `certificationApproved(input)` `certPages.ts:40` (read `:557`) is **new at HEAD** and now wraps the affirmative prose `:686` (`!approved ? _pePendingCertStatement() : <affirmative>`). The delivered build (`repo-bisect certPages.ts`) has **zero** `certificationApproved` and printed "…confirmed adequate (safety factor 1.63)" ungated — that is why the delivered PE-1 asserted adequacy vs PV-4C UNVERIFIED.
  - **The gap:** the §9 capacity gate `capacityGated` (`structuralProjection.ts:141`, `CAPACITY_GATE_BLOCKER_CODES:104`) reaches PV-4C (`structuralPages.ts:812-817/1013`) but PE-1's **Structural Analysis Results table** `certPages.ts:666-684` reads `lagCap=_attChk.capacity` (`:564`) and `safetyFact=_attChk.safetyFactor` (`:565`) and prints them **without consulting `capacityGated`** (`:680-681`). So even at HEAD PE-1 prints the unverified **600 lb** and an SF — only the prose is gated. This is why "600 lb" appears 8× in both builds.
- **Inputs are fabricated defaults, not project evidence:** 600 lb = RT-MINI DB allowable (UNVERIFIED, `rackingAssembly.ts:314-443`); **45 psf** = hardcoded default `structural-engine-v4.ts:446` `TRUSS_CAPACITY_PSF[spanKey] ?? 45`; **12 ft span** = default `structuralInput.ts:61` `|| 12` (PE-1 tags "(ASSUMED — FIELD VERIFY)" `:672/676`); **69% bending** = `bendUtil` computed off those defaults, and PE-1 reads the **legacy `compliance.structural.rafter.*`** `certPages.ts:570-599` instead of the snapshot's honest `chk-framing-capacity` (which returns `passes:null` when unverified, `structuralEngine.ts:118-139`).
- **"1.63" disappearance:** arithmetic, not the gate — SF=600/uplift = 600/369.3=1.63 (delivered), 600/403.6=1.49 (HEAD, W7c).
- **Classification:** gate/validator-coverage-gap (capacity gate misses the PE-1 results table) + missing-project-evidence (45/12 defaults) + improper-fallback (PE-1 reads legacy rafter object bypassing the honest null).
- **Status:** **LIVE** (prose gated at HEAD; the 600 lb / SF cells and the 45-psf/69% framing-adequacy conclusion still render).
- **Repair seam:** route PE-1's Structural Analysis Results table through `capacityGated` (PENDING when unverified); have PE-1 read the snapshot `chk-framing-capacity` (`passes:null`) not `compliance.structural.rafter.*`; gate the framing "adequate capacity" prose on real truss/span evidence.

## W9 — PAGINATION

### W9 · PV-4C overflows to two physical pages for one logical sheet
- **Chain:** every logical sheet is one fixed `.page` div `generatePermit.ts:1372-1388` (`width:17in; height:11in; overflow:hidden; page-break-after:always`); `.page-content` also `overflow:hidden` `:1438-1445`. No intra-sheet continuation. `pageStructuralRoof` `structuralPages.ts:659/754` stacks banner + 4-card grid + dead-load table + truss analysis + full reaction schedule `renderReactionSchedule` `:844` (`REACTION_ROW_CAP=40` `:1001/1017` + 5-row footer) + hardware schedule + SVG detail; intrinsic height > 11in, so Chromium's print paginator spills the surplus onto a second sheet. The 40-row schedule is new at HEAD (worsens it).
- **Classification:** renderer-local (layout). No page-fit validator.
- **Status:** **LIVE** (all values legitimate).
- **Repair seam:** split the reaction schedule onto its own SCHED page, cap rows with an explicit "continued" link, or add a page-fit check.

## W10 — BLOCKERS

### W10a · Visible banner shows only RT-MINI blockers, though IBC/IRC/IFC pending, tap length pending, conduit fill pending, route estimate, blank designer, TEST name, no approved review all exist
- **Chain:** ALL blockers are computed `build.ts:570-635` → `snapshot.permitReadiness` `build.ts:924` (Braidon set: `ROUTE-LENGTH-ESTIMATE`, `EQUIPMENT-IDENTITY-CONFLICT`, `FEEDER-RACEWAY-AUTHORITY`, RT-MINI `RACKING-CAPACITY-*` / `ATTACHMENT-CAPACITY-SOURCE-MISSING`, `CODE-AUTHORITY-INCOMPLETE`, `PROJECT-AUTHORITY-UNVERIFIED`, `ENGINEERING-REVIEW-PENDING`). **The banner ternary drops the rest:** `structuralBanner.ts:23` AND `certPages.ts:67` both do `(structuralBlockers.length ? structuralBlockers : blockers).slice(0,6)`, where `structuralBlockers = blockers.filter(STRUCTURAL_BLOCKER_CODES.has)` (`structuralProjection.ts:87-101/117`). RT-MINI codes are structural, so `structuralBlockers.length>0` forces the structural branch and every non-structural blocker becomes an unreachable fallback. Additionally **tap/fill PENDING, blank designer, TEST name never emit blocker codes** — they are schedule-cell literals (`PENDING`) or feed only the issue-state gate (`_projectIdentityValid` `build.ts:663-665`), so the banner never sees them.
- **Classification:** improper-fallback (ternary) + validator-coverage-gap (no check that the banner enumerates non-structural readiness) + missing blocker emission (designer/TEST/fill/tap).
- **Status:** **LIVE.**
- **Repair seam:** change the ternary to a **union** (structural + non-structural, deduped) and raise the slice cap; emit blocker codes for tap-length/fill PENDING and identity (blank designer / TEST name); render `permitReadiness.blockers` fully on VAL-1.

### W10b · REC-405W-vs-Qcells-400W conflict no longer visible — hidden, not reconciled
- **Chain:** detection is **live and byte-unchanged** (from `e3a54bf2`): `build.ts:459-465` compares `subSystems.roof.panelId='rec-alpha-pure-405'` (REC Group Alpha Pure-R 405W) against fleet module Qcells 400W and pushes `EQUIPMENT IDENTITY CONFLICT … operator reconciliation required (migration 110 territory)`. The conflict is pushed as blocker `EQUIPMENT-IDENTITY-CONFLICT` `build.ts:580`, into `geometry.gaps` `build.ts:840`, and into the issue-state gate `build.ts:671`/`projectAuthority.ts:219` (why the package prints PENDING, not ISSUED). **The HEAD regen snapshot `_violations` still contains this exact string** — the conflict is present in the current build.
- **Why invisible (suppression, NOT reconciliation):** (1) the W10a banner ternary drops `EQUIPMENT-IDENTITY-CONFLICT` (not a structural code); (2) `geometry.gaps` has **no renderer**; (3) no `validate.ts` check forces surfacing; APP-A's `⚠ EQUIPMENT COMPATIBILITY` `compliancePages.ts:972-988` only checks Voc/overpower on the resolved fleet module and cannot see the `panelId` mismatch. Every rendered module identity flows from the fleet (Qcells 400W, `build.ts:85-88`), so the package always showed Qcells; **REC-405 was only ever a blocker, never a rendered module.**
- **Not reconciled:** migration 110 is written-but-not-run (memory + `build.ts:93-95` comment); `lib/reconciliation/conflicts.ts:1-11` is a pure no-mutation detection surface; no code path removes the conflict. HEAD §12 states it is surfaced via operator workflow, "never auto-resolved".
- **Classification:** validator-coverage-gap + improper-fallback (computed-but-unrendered blocker; a missing renderer surface for a canonical readiness object).
- **Status:** **LIVE.**
- **Repair seam:** same as W10a (union banner) + render `geometry.gaps` / equipment-identity conflicts on a readiness sheet; run migration 110 to actually reconcile the DB `panelId`.

---

## Ray observations that do NOT fully reproduce (stated honestly)
1. **W7c "404 vs 369":** both are correct for their build — 404 is HEAD (report), 369 is the older delivered deploy. Not two live emitters; a deploy-lag artifact.
2. **W10b "conflict no longer visible":** correct that it is invisible, but because it is **suppressed (never reconciled)** — the conflict is still live in the HEAD snapshot; the visible "405" is only the DS-1 generic datasheet range (W5c). No renderer "hid a fixed thing," and no operator reconciliation occurred.
3. **W1b "feeder vs diagram contradiction":** these are two different circuits (branch #12/#10 EMT vs feeder #6/#10 PVC); the defect is disambiguation/labeling, not a single contradicted value.
4. **W2b "tap rule on the 60-ft feeder":** resolved at HEAD for PV-4B (tap isolated to its own object, PENDING); only PV-6's directory still conflates roles.
5. **W7d "704 vs 636 RECONCILED":** the reconciliation is legitimate for this package (conservative full-interior-tributary envelope); the finding is the loose 3.0 ceiling, not that this package is mis-reconciled.

---

## REPAIR PLAN (grouped by seam; ordered by dependency)

### Round 1 — Authority / engine (single-source the data)
- **A1 (W4a/W4b):** thread design `topologyType`/`isMicro` into `generateBOMV4` (`bom-engine-v4.ts:401-410`); make the STRING_INVERTER fallback blocking. Kills the DC USE-2 rows and the 3/4" EMT DC fittings in one change.
- **A2 (W5a):** correct the `enphase-iq8a` equipment-db record (366 peak / 349 continuous label / 1.45 A / 97.5% / 2.38 lb / add `partNumber:'IQ8A-72-2-US'`); reconcile sibling `enphase-iq8ac` SKU.
- **A3 (W7a):** per-position ASCE 7-22 C&C zone map in `structural-engine-v4.ts:1253` (or explicit "governing zone applied" label).
- **A4 (W7b):** per-position tributary (half at ends) in `calcMountLayout`.
- **A5 (W7c):** verify wind speed/exposure authority (115 mph currently code-minimum default) — feeds W8 SF.
- **A6 (W6a):** single-source the rail SKU (pin XR100 into the RT-MINI mount record or make `requiredAccessories` the authority the schedule reads).

### Round 2 — Snapshot / projection (surface the canonical objects)
- **B1 (W8):** route PE-1's Structural Analysis Results table (`certPages.ts:666-684`) through `capacityGated`; make PE-1 read snapshot `chk-framing-capacity` (`passes:null`) not legacy `compliance.structural.rafter.*`.
- **B2 (W2a):** render PV-6 + E-1 disconnect roles from `snapshot.serviceTopology` (retire `compliancePages.ts:615-648` `discos[]`).
- **B3 (W1a/W1c):** render PV-4A and E-1 branch/feeder rows from `projectCanonicalFeeder`/electricalProjection; give `fillPct` a real value or blocking PENDING; stop reading `project.wireLength/conduitType` for branch runs.
- **B4 (W5c):** add a 400W-specific module datasheet asset.

### Round 3 — Renderer literals (delete the parallel strings)
- **C1 (W3a):** `roof.ts:1920` "wired in series" → parallel AC-branch/Q-Cable wording.
- **C2 (W3b):** `sheetComposition.ts:733` callout → `routeProvenanceLabel(snapshot)`.
- **C3 (W5b):** `compliancePages.ts:832` −10 → `_temps.ashraeExtremeLowC`.
- **C4 (W6b):** delete APP-A fastener length/material formula `compliancePages.ts:1017-1048`; render the canonical fastener record; remove hardcoded 3/8" notes.
- **C5 (W1d):** print operating current (45.1 A), not OCPD, in the PV-4B VD amps column (`electricalPages.ts:536`).
- **C6 (W1b):** source E-1 SVG branch labels from the snapshot; label BRANCH vs FEEDER.

### Round 4 — Validators / gates (make truth enforceable)
- **D1 (W10a/W10b):** change the banner ternary (`structuralBanner.ts:23`, `certPages.ts:67`) from either/or to a **union**; raise slice cap; render `permitReadiness.blockers` + `geometry.gaps` fully.
- **D2:** emit blocker codes for tap-length PENDING, conduit-fill PENDING, blank designer, "TEST" project name.
- **D3:** new validators — micro⇒0 DC rows; APP-A scalar specs vs embedded datasheet; design-temp consistency; fastener consistency; rail-PENDING vs embedded rail datasheet; VD amps vs VD calc current; tighten W7d upper band.

### Round 5 — Layout
- **E1 (W9):** split the reaction schedule to its own SCHED page / cap rows with a continuation; add a page-fit check.

### Cross-workstream dependencies
- **A1 → W4b:** fixing topology removes both the DC rows and the DC conduit fittings.
- **A5 (wind) → W7c → W8 SF:** the SF number PE-1 prints is `600 / uplift`; the uplift depends on the wind authority, so B1 (gating PE-1) should land with A5.
- **D1 (banner union) → W10a AND W10b:** one ternary fix surfaces the equipment-identity conflict, code-authority, review-pending, and route-estimate blockers together.
- **B3 (electrical single-source) → W1a/W1b/W1c/W4b:** the PV-4A `rulesResult`, E-1 annotations, PV-6 directory and BOM conduit should all read the one `electricalProjection`/`serviceTopology` — do them as a set to avoid re-introducing a second emitter.
- **Migration 110 (W10b):** actually reconciling the REC-405 vs Qcells-400 DB `panelId` is an operator/DB action (not a code change); until run, D1 must keep the conflict visible.
