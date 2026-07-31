# EP Closeout — Root-Cause Map (Phase 0 forensic audit)

Status: Phase 0 (forensic, READ-ONLY) complete 2026-07-23. Baseline `903e14cd`.
Audit target: `PermitPackage-BRAIDON M PILLA — Solar TEST (4).html` (PDS-D673915D8021,
digest `d673915d802162cfd180`, 21 sheets, DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION).
Directive: `docs/ELECTRICAL-PROCUREMENT-CLOSEOUT-DIRECTIVE.md` (§1–§19).

All file:line anchors are HEAD `903e14cd`. No code changed in this phase.

---

## 0. Live-vs-stale methodology + verdict

**How "live at HEAD" was established (the way the closeout harness regenerates):**
`scripts/braidon-fixture-regen.ts` runs the FULL permit engine (`generatePermitHTML`) over
the immutable in-repo `tests/fixtures/braidon-original-audit-fixture.ts` — **zero mutable
DB rows**, deterministic at HEAD. This is the same regeneration the closeout evidence
harness (`scripts/planset-evidence-co.mjs`) consumes.

- HEAD regen → `_ep0_head.html` + `_ep0_head.snapshot.json`, snapshot **PDS-27C8B1270466**,
  digest `27c8b1270466bc158806`.
- Delivered target → snapshot **PDS-D673915D8021**, digest `d673915d802162cfd180`.

**The digests differ, but the two are NOT the same code state vs input.** The delivered
file is the **live-DB Braidon project** ("BRAIDON M PILLA — Solar TEST", real APN
`17-2-20-13-04-401-003`, Asphalt Shingle, 110 MPH, 20 PSF); the HEAD regen is the frozen
fixture ("BRAIDON — original GreenLancer audit", APN PENDING, Composition Shingle, 115 MPH,
0 PSF). A normalized full-file diff (snapshot-id/digest masked) yields **567 differing
lines, ALL input-driven** (project name, APN, AHJ suffix, roof material, wind/snow, date,
designer, and 2 input-specific blockers) — **not one differing line is a §1–§19 defect fix.**

**System design inputs are identical** across both: 12.40 kW DC, 31 modules, IQ8A micro,
Q.PEAK DUO BLK ML-G10+ 400W, branches 11/10/10, supply-side 705.11 tap.

**VERDICT: every §1–§19 finding reproduces at HEAD (LIVE-AT-HEAD).** The delivered file is
"stale" only in snapshot-id/digest identity (different project instance + it predates or
differs by the framing-gate commit `903e14cd`). The substantive electrical / procurement /
language / layout defects render **identically** in the HEAD frozen-fixture regen. Defect
literal counts across the two files match (e.g. `#12 THWN-2` 10/10, `705.12` 9/9, EMT
callouts identical, `48" max O.C.` 4/4, `per AHJ`, `IBC PENDING`, `COMPLIES` 1/1,
`PENDING VERIFIED FASTENER ASSEMBLY` 3/3). **None of the §1–§19 items has been fixed.**

Prior-round CO gates all pass at HEAD (`planset-evidence-co.mjs` 20/20) — the EP findings
are the finer-grained defects those gates do not cover (what the schedules *render*, not
just whether the canonical objects *exist*).

**Only item not reproducing as its literal form:** §8's exact "14 ft" string (HEAD shows
"22"); the underlying defect (an unbacked DC wire+run row) DOES reproduce. Historical
strings the directive references that are already gone at HEAD: Q-Cable `3×95=285 ft`,
`23 ft` length. See per-finding entries.

---

## Per-finding entries

Legend — Classification ∈ {stale fallback, merged field, local calculation,
incomplete projection, missing canonical object, validator gap, layout}. All LIVE-AT-HEAD
unless noted.

### §1 — E-1 does not consume the sectioned branch model
- **Rendered evidence (E-1 SVG, `_ep0_head.html`):** branch conductor label
  `#12 AWG THWN-2`; shared home-run label `#12 AWG THWN-2 / 1×#10 GRN EGC / IN 1-1/4" PVC
  Sch 80 (3 BRANCHES SHARED)`. Canonical BOM says the home-run is `#10 AWG THWN-2
  (BRANCH_HOMERUN_RUN)` with **6 current-carrying conductors** (`RW-BRANCH-HOMERUN` ccc=6).
  The graphic prints `#12` (branch gauge) for the shared run and "3 BRANCHES SHARED" instead
  of the 6-CCC inventory.
- **Chain:** `pageSingleLineDiagram` (E-1, `electricalPages.ts:868`) → body = `generateLiveSLD`
  (`sldAdapter.ts`). SLD branch `conductorCallout = `${b.wireGauge} THWN-2`` at
  **`sldAdapter.ts:166`**, `b.wireGauge` from `buildConductorAuthority().microBranches` →
  `conductorAuthority.microBranchRow` **`conductorAuthority.ts:193,201`**:
  `wireGauge = wireGaugeForOcpd(ocpdAmps)` (20A→#12), `conductorCallout = "#12 AWG THWN-2 + EGC"`.
  The raceway TYPE/SIZE for the home-run IS projected from the canonical `_snapHomerun`
  (`sldAdapter.ts:205-213`), but the conductor GAUGE/COUNT are the legacy branch calc, not the
  canonical `BRANCH_RUN` (open-air Q-cable) / `BRANCH_HOMERUN_RUN` (#10, ccc=6) segment objects.
  Those objects exist in the snapshot but E-1 never reads their conductor fields.
- **Where the 6-CCC inventory lives vs what renders:** snapshot
  `electrical.physicalRaceways[RW-BRANCH-HOMERUN]` = `{scc:3, currentCarryingCount:6,
  conductorCount:7, size:1-1/4", type:PVC Sch 80}` and `routeSegments[BRANCH_HOMERUN_RUN]` =
  `{gauge:#10 AWG, cnt:2, scc:3, oneWayFt:18}`. E-1's SVG renders `#12` + "3 branches shared".
- **Blank-fill-PASS cells:** the branch/home-run rows on E-1/SCHED render an unconditional
  verdict (§2). E-1's data zone is the SVG (no fill/verdict columns for non-hybrid);
  the "blank fill cells render PASS" defect is realized on SCHED (see §2).
- **Classification:** incomplete projection (raceway type/size canonical; conductor gauge/count
  legacy) + local calculation (`microBranchRow` OCPD-sizes a fictitious #12 THWN branch).

### §2 — Fail closed on E-1 pending values (tri-state)
- **Rendered evidence:** SCHED AC Branch Circuit Schedule rows render Status `&check;`
  (unconditional ✓) for every branch: `#12 AWG THWN-2 + EGC | 25A (#12) | ✓`
  (`structuralPages.ts:1561,1579,1594`). No PENDING path — a blank/pending required value
  still prints ✓.
- **Existing tri-state machinery to unify with:** PV-4B already has correct per-cell tri-state
  ternaries — Conduit Fill status `electricalPages.ts:594` (`fillPct==null?PENDING:≤40?✓PASS:✗FAIL`),
  Voltage-Drop status `:614`, tap 705.11(C) state `:739,743` (`pending/pass/fail`). PV-4A's
  busbar cell is tri-state `:257,709`. **But these are DUPLICATED inline per cell — there is no
  single shared tri-state result object**, and the SCHED branch Status (`&check;`) and the
  §9 supply-side "COMPLIES" bypass it entirely.
- **Chain:** the ✓ literal is hardcoded in `structuralPages.ts:1561/1579/1594`
  (`_schedAcRows` / `_schedSubWireBlock`); it does not read any pass/fail/pending state.
- **Classification:** validator gap (no shared tri-state projection; unconditional ✓ verdicts coexist).

### §3 — Remove the last EMT literals
- **Rendered evidence (identical delivered/HEAD):** PV-1 conduit-run callout
  `… — CAD-DERIVED ESTIMATE — FIELD VERIFY — EMT`; PV-3 callout bubble 6
  `EMT CONDUIT — see conductor schedule`. (Other "EMT" hits are inside base64 datasheet
  image blobs — ignore.) Canonical feeder raceway is **PVC Sch 80** — PV-1/PV-3 contradict
  E-1/PV-4B/SCHED.
- **Chain:** drafting layer `lib/drafting/sheetComposition.ts:491`
  `conduitType: ((p?.conduitType as string) || 'EMT').toUpperCase()` — renderer-local EMT
  DEFAULT. Consumed at `:753` (PV-1 bubble 4 sub = `${routeProvenanceLabel(...)} — ${d.conduitType}`)
  and `:763` (PV-3 bubble 6 = `d.conduitType + ' CONDUIT'`). This drafting path never reads the
  canonical raceway projection (`projectRacewayDescriptor` / `_snapFeed.raceway`). Secondary EMT
  defaults live in `sldAdapter.ts:194` (`dcConduitType: project.conduitType ?? 'EMT'`) and
  `:203` (`acConduitType: _snapFeed.raceway ?? project.conduitType ?? 'EMT'` — masked by PVC for
  Braidon but still a live fallback).
- **Classification:** stale fallback (renderer-local `'EMT'` default in the drafting layer,
  unwired to the canonical raceway accessor).

### §4 — PV-4A uses the RS-1 blocker registry
- **Rendered evidence:** PV-4A compliance card counts (`_elecErrorCount` blocking /
  `_elecWarnCount` pending) diverge from RS-1's registry count (RS-1: 12 at HEAD / 14 delivered).
- **Chain:** `pageNECCompliance` (PV-4A, `electricalPages.ts:133`) re-derives its own counts
  `:188-208` from a **hardcoded local allowlist** `_ELEC_BLOCKER_CODES` (`:189-192`) filtered
  from the registry, PLUS locally computed `_elecPending` items (feeder holes, fill, tap, pairing).
  Defects: (a) the allowlist code `TAP-LENGTH-PENDING` does **not** match the real registry code
  `TAP-CONDUCTOR-LENGTH-PENDING` → the blocking tap item is **downgraded** to a locally-derived
  "pending" (`_tapPending`, `:197-199`); (b) `CONDUIT-FILL-PENDING` counts as blocking AND is
  re-added as a pending item via `_feedA.fillPct==null` (`:196`) → **duplicated**; (c) the
  equipment/racking/framing/code blockers are dropped (electrical-only filter). It never consumes
  the canonical registry multiset.
- **Classification:** incomplete projection + local calculation (sheet-local re-derivation from a
  stale hardcoded code subset, not the canonical registry).

### §5 — PV-4A branch conductor honesty
- **Rendered evidence:** PV-4A AC Branch Circuit Schedule rows: `B1/B2/B3 | 10–11 ×
  microinverter | … | #12 AWG THWN-2 + EGC | IQ Combiner` (`electricalPages.ts:329-339`,
  cell `${b.conductorCallout}` `:336`, terminates `:337`). Implies a #12 THWN conductor
  micro→combiner — the exact defect §5 forbids.
- **Chain:** same `buildConductorAuthority().microBranches[].conductorCallout` root as §1
  (`conductorAuthority.ts:201`). The branch table mixes device rating fields with a fabricated
  conductor field.
- **Classification:** local calculation (fabricated per-branch THWN conductor). Repair: option
  (B) — drop conductor/raceway fields, keep device count / operating / continuous / OCPD / mfr
  branch limit; OR option (A) sectioned physical schedule (Q-Cable / transition / shared raceway).
- **Note (cross-sheet):** the same `conductorCallout`/`wireGauge` #12 row is rendered on FOUR
  sheets — PV-4A (`:336`), PV-4B (`:543`), SCHED (`structuralPages.ts:1560`), E-1 SVG
  (`sldAdapter.ts:166`). One fix at the authority source clears all four.

### §6 — Q Cable as a listed cable assembly
- **Rendered evidence:** PV-4B rows `#12 AWG THWN-2` conductor / `FREE AIR (Q-CABLE / TC-ER)`
  conduit; E-1 branch `#12 AWG THWN-2`; SCHED `#12 AWG THWN-2 + EGC`. The **listed assembly
  DOES exist but only in the BOM**: SCHED-2 item #29 `trunk cable · Enphase · IQ Q-Cable
  (portrait) … Part No Q-12-10-240 · Qty 31 ea`, with #27 sealing cap (Q-SEAL-10), #28
  terminator (Q-TERM-10). Drop count **31 = deviceCount** ("one connector-drop per device").
- **Chain:** PV-4B conductor `${b.wireGauge} THWN-2` (`electricalPages.ts:543`) from
  `wireGaugeForOcpd` (#12). The listed SKU `Q-12-10-240` is produced only by the V4 BOM engine
  (`bomForPermit.ts:727 generateBOMV4`, category `trunk_cable`), **not** in the canonical
  snapshot. **No `QcableSegment` / `ListedCableAssembly` type exists in
  `lib/permit/snapshot/types.ts`** — the trunk is modelled only as a `RouteSegmentRecord`
  (`BRANCH_RUN`) whose `electricalFunction` is a free-text string.
- **Classification:** missing canonical object (no listed-assembly type) + local calculation
  (sheets print generic OCPD-derived #12 THWN instead of the assembly the BOM already knows).

### §7 — Reconcile Q Cable lengths
- **Rendered evidence / which number is real:** two divergent heuristics, neither
  coordinate-derived. **68 ft** (×3) on PV-4B branch rows = `BRANCH_RUN.oneWayFt`
  (`lengthSource="cad-derived-estimate"`), whose true origin is `lib/bom/deriveRunLengths.ts:179-182`
  = **Σ plane widths × slack** (a plane-width heuristic, NOT a per-drop coordinate sum).
  **≈152 ft** in the BOM #29 description = `1 drop per micro @ 4.25 ft pitch × 31 × ~waste`
  (pitch × device-count heuristic, marked "≈"). **`3×95=285` and `23 ft` are ABSENT at HEAD
  (stale-fixed).** The two live numbers disagree (3×68=204 vs 152) and never reconcile.
- **Geometric derivation available?** Module/attachment XY coordinates DO exist in the snapshot
  (`canonicalXY`/`sheetXY` on layout objects; `coordinateAuthority.ts`), and `deriveRunLengths`
  uses real XY distance only for downstream runs (array-centroid→MSP). **The branch/trunk cable
  path is NOT derived from micro coordinates** — the geometry is available but unused for the trunk.
- **Classification:** local calculation / incomplete projection (two engines, two heuristics,
  no coordinate-derived cable path, no reconciliation).

### §8 — Remove the unbacked module DC wire row
- **Rendered evidence (REPRODUCES as a defect; literal number changed):** SCHED "Solar Modules"
  table emits a DC Wire + Run(ft) column per micro-paired module. **Delivered:** `#10 AWG / 14`.
  **HEAD:** `10 AWG / 22`. Nearest canonical object `ROOF_RUN` is `oneWayFt:25 / #10 AWG USE-2`
  — matching neither 14 nor 22.
- **Chain:** `structuralPages.ts:1642-1643` renders `${str.wireGauge}` / `${str.wireLength}`
  iterating `system.inverters[].strings[]` — the **legacy per-string design payload**, no
  canonical DC/module segment.
- **Honest note:** the closeout's "did not reproduce" is true **only for the literal "14 ft"**;
  the DEFECT (a field-installed DC gauge/length row on a 1:1 micro topology with no canonical DC
  segment) reproduces in both files, drifting 14→22 precisely because it reads stale
  `str.wireLength`.
- **Classification:** missing canonical object + stale fallback.

### §9 — No supply-side COMPLIES while the tap rule is pending
- **Rendered evidence:** PV-4B Service & Interconnection step 5 — "Supply-Side Connection —
  NEC 705.11" → Result **`COMPLIES`** (`_ep0_head.html`, single COMPLIES occurrence). On the
  SAME sheet the tap-conductors row shows `PENDING (length unknown)` and the narrative says
  `PENDING — length unknown … tap-conductor length not measured (FIELD-VERIFY ≤10 ft)`.
- **Chain:** hardcoded literal `COMPLIES` at **`electricalPages.ts:706`**, gated only by
  `_lcSupply = _ic.isSupplySide` (`:683`), NOT on any tap-rule verification. The honest tap
  705.11(C) state is derived separately two tables below (`:723,738-743` from
  `svc-tap-conductors` constraint `state:"pending"`).
- **Classification:** validator gap (COMPLIES literal decoupled from the tap 705.11(C) pending state).

### §10 — Normalize design vs procurement lengths
- **Rendered evidence:** every PV-4B length traces to a `lengthSource="cad-derived-estimate"`
  segment, but the tables print bare numbers. `68 ft` (BRANCH_RUN), `18 ft` (BRANCH_HOMERUN_RUN),
  `20 ft` ×several (feeder = COMBINER_TO_DISCO_RUN), all **unlabeled**. Only ONE narrative sentence
  (`:753`, supply-side interpretation) labels a length "CAD-derived estimate". BOM prints
  procurement footage with derived-from notes (`21/23/18 ft` conduit, `121/125/41 ft` wire,
  `≈152 ft` trunk). Feeder VD text: "0.37% over a 20 ft conductor run" (feeder.oneWayFt=20).
- **Chain:** the canonical fields the directive names (geometricDesignLength, estimatedFieldLength,
  verifiedFieldLength, calculationLength, procurementLength, wasteFactor, lengthSource,
  verificationState) do NOT exist as a taxonomy; there is one `oneWayFt` + `lengthSource` per
  segment, surfaced inconsistently (one narrative label; a page banner at `:1047`; bare cells
  everywhere else).
- **Classification:** incomplete projection (single length field, `lengthSource` not projected
  per cell; no design/calc/procurement taxonomy).

### §11 — Unselected racking parts are not BOM authority
- **Rendered evidence (SCHED-3, orderable rows with mfr + part number):**
  `#34 end clamp · Roof Tech · RT-MINI End Clamp · qty 8`; `#35 grounding · RT-MINI Bond Clip ·
  qty 31`; `#36 l foot · RT-MINI · qty 64`; `#38 mid clamp · RT-MINI Mid Clamp · qty 60`;
  `#39 mount hardware · T-BOLT-38 · qty 64`; `#40 racking · RT-MINI-01 · 1 lot`. Only
  `#41 rail · TBD` and `#42 splice` carry the pending sentinel. Snapshot `railSku=null`.
- **Chain:** rows come from `calcRackingBOM` in **`lib/structural-engine-v4.ts:963-1040`**
  (Derived-From = `structuralEngine.rackingBOM`), consumed via `bomForPermit.ts:590-660`.
  `T-BOLT-38` is a hardcoded literal at `:1027`; clamps/L-foot/bonding are ungated. The **only**
  distinction encoded is rail-based vs rail-less (`isRailBased`); the rail-pending state is written
  **only onto the rail/splice rows** (`:963-975`). The assembly-dependent clamps/T-bolt (which
  cannot be specified until the exact rail is chosen) print as confirmed orderable rows.
  (Note: the parallel `structuralBom.ts::deriveStructuralBom` `:97-177` DOES gate rail/splice/clamp
  behind `if (railed)` — but it does not feed SCHED-3; the V4 path does, ungated.)
- **Classification:** missing canonical object / validator gap (no confirmed-base vs
  assembly-dependent vs unselected-candidate taxonomy; no railSku gate on the V4 clamp/bolt rows).

### §12 — RT-MINI vs RT-MINI II document applicability
- **Rendered evidence (3×):** PV-3 `ATTACHMENT PER ROOF TECH RT-MINI … DOCUMENTATION ON FILE:
  Roof Tech RT-MINI II Installation Manual (Jun 2025) — p.9-20`; DS-3 `SOURCE: Roof Tech
  RT-MINI II Installation Manual (Jun 2025)`; APP-A citation band. Selected mount
  `mountModel="RT-MINI"`, `mountSku=null`.
- **Chain:** single manufacturer-assets record **`lib/manufacturer-assets-db.ts:35`**
  (`racking_detail:rooftech-mini`) merges `model:"RT-MINI"` with
  `docTitle:"Roof Tech RT-MINI II Installation Manual (Jun 2025)"` and an RT-MINI-II sourceUrl;
  reconciliation is a free-text `notes` assumption. Consumers: `datasheetAppendix.ts:84,122,151`
  (DS-3/APP-A), `structuralPages.ts:56-63` (PV-3). `getManufacturerAsset(mountId,'racking_detail')`
  matches on equipmentId/category only; `verified:true` means URL-fetched, NOT applicable to the
  selected legacy RT-MINI. No SKU↔document product-version gate. Concrete discrepancy: the cited
  RT-MINI II manual specifies M5 screws (`install-tools-racking.json:172`) while the assembly's
  fastener is 5/16"/M8.
- **Classification:** missing canonical object (no applicability-verification object) + merged
  field (one record conflates two product versions).

### §13 — Fastener authority explicit in RS-1
- **Rendered evidence (3×, PE-1/APP-A/SCHED-CERT):** `PENDING VERIFIED FASTENER ASSEMBLY`.
  RS-1 renders `12 OPEN RELEASE BLOCKERS` (HEAD) / `14` (delivered). **No FASTENER blocker code
  exists in the registry** (verified: 0 of 12 active codes match /FASTEN/).
- **Chain:** the string is a projected `certLabel` at **`structuralProjection.ts:326-328`**
  (`projectFastenerAssembly`, verification `unverified` because `capacityGated` from the
  RACKING-CAPACITY-* blockers, even though `assemblyVerification.fastener==="verified"`).
  Rendered by `compliancePages.ts:1100` (APP-A), `certPages.ts:629` (PE-1/CERT),
  `structuralPages.ts:942/1355`. It is a downstream label of the fastener-verification state,
  backed by no dedicated blocker code — a **visible pending authority outside the registry**.
- **Count resolution (15 vs 14):** HEAD is internally consistent at **12** (registry 12 blocking,
  RS-1 renders 12). The directive's 15/14 come from the STALE delivered/report states
  (`_delivered.html` RS-1 = 14, driven by the live-DB input carrying `EQUIPMENT-IDENTITY-CONFLICT`
  and lacking `WIND-SNOW-AUTHORITY-UNRESOLVED`; the "15" was an earlier report tally that counted
  the un-registered fastener pending as a 15th). **The discrepancy is exactly the one visible
  pending authority (fastener) that is not a registry entry**, plus stale-registry drift.
- **Classification:** incomplete projection / validator gap (bare fastener label with no registry
  code) + stale fallback (15/14/12 count divergence is delivered-vs-HEAD registry drift).

### §14 — Remove unsupported "maximum spacing"
- **Rendered evidence (4× "48 … O.C."):** PV-4C `6. Spacing: 48" max O.C. along rail, verified
  per structural analysis above.`; PE-1 `Attachment Spacing 48" max O.C.`; APP-A `Max Attach
  Spacing 48" O.C.`; PV-3 `48" O.C.` (design). "max"/"Max Allowed"/"verified" asserted while
  rail/capacity/applicability are unverified.
- **Chain:** four ad-hoc per-sheet resolution chains all bottoming out in a hardcoded `48`:
  `structuralPages.ts:744-747` (PV-4C, `… || 48`, rendered `:947` "max O.C. … verified per
  structural analysis above"; also `:707/:831` "Max Allowed Spacing"), `certPages.ts:621-623/678`
  (PE-1), `compliancePages.ts:1111-1118` (APP-A), authority default `structuralAuthority.ts:596`.
  No typed spacing-authority object separating design spacing vs maximum-verified spacing vs source
  document; design (48) and rated-max (48) coincide so the conflation is invisible but the labels
  disagree.
- **Classification:** missing canonical object + stale/hardcoded fallback + merged field.

### §15 — Provisional fire-setback language
- **Rendered evidence:** PV-1 `FIRE SETBACKS — 3' ridge · 18" hip/valley · 3' access pathway —
  IFC §1204.2 per AHJ`; PV-1B `• 36" access pathway per AHJ`. Same sheets' title blocks print
  `IFC PENDING` — direct contradiction.
- **Chain:** PV-1 callout `sheetComposition.ts:751` (`… — IFC §1204.2 per AHJ` hardcoded suffix);
  PV-1B `arrayPages.ts:528`. Setback geometry is a valid local calc (`fireSetback.ts:12`
  `resolveFireSetbackIn`), but the `IFC §1204.2 per AHJ` citation is an unconditional literal that
  never reads `codeAuthority.editions.ifc` (which is `null`/`verificationStatus:'incomplete'` at
  `codeAuthority.ts:201,214`). `sitePlan.ts:636` also hardcodes an `18" FIRE SETBACK` legend
  (unused aerial path).
- **Classification:** incomplete projection (IFC-unverified state exists, unprojected) + hardcoded
  literal.

### §16 — No load-side labels on supply-side systems
- **Rendered evidence (PV-5, supply-side design):** L-12 `DUAL POWER SUPPLY … PER CODE(S): NEC
  2020 705.10 / 705.12(B)(2)`; L-15 `PHOTOVOLTAIC SYSTEM CONNECTED … UTILITY-INTERACTIVE …
  705.10 / 705.12`; L-14 `… 705.11 / 705.12(A)` (merged). The true load-side backfed-breaker
  placard L-11 (`705.12(B)(2)(3)(b)`) IS correctly suppressed (N/A).
- **Chain:** `fieldLabels.selectFieldLabels` (`fieldLabels.ts:112`) applicability map `REQUIRED_WHEN`
  (`:59-79`): backfed-breaker `!c.isSupply` (`:70`) and line-side-tap `c.isSupply` (`:73`) are
  topology-driven (correct), but `dual-power-source-inverter-output: ()=>true` (`:71`) and
  `photovoltaic-system-connected: ()=>true` (`:74`) are **unconditional**. `isSupply` is available
  (`:120`) but not applied to these. The code strings are merged literals in
  `lib/data/placards/field-placards-research.json:223,256` (705.10/705.11/705.12 bundled).
- **Classification:** validator gap (incomplete topology gating) + merged field (bundled codeRefs).

### §17 — Computational basis vs adopted code authority
- **Rendered evidence (cover PV-0 ENGINEERING SUMMARY):** `… designed per NEC 2020, ASCE 7-22,
  IBC PENDING, and applicable local amendments.` — one merged clause; asserts design authorship
  against a pending/unknown IBC edition; omits IRC/IFC from the sentence.
- **Chain:** `coverSheet.ts:602-603` single template string; `ibcVer = cp.ibc ?? 'PENDING'`
  (`:49`), `necVer`/`asceVer` (`:48/:52`). Computational basis (NEC/ASCE — editions the engine
  ran) and adopted jurisdictional authority (IBC unknown→PENDING) are concatenated.
- **Classification:** merged field (basis + adopted authority in one "designed per" list;
  pending edition asserted as a design basis).

### §18 — RS-1 legibility
- **Rendered evidence:** RS-1 renders 12 blockers in 5 domain groups on ONE page; core blocker
  text at **6–6.5 px** — CODE `6.5px` (`reviewStatus.ts:77`), ISSUE `6.5px` (`:78`), RESOLUTION
  `6.3px` (`:79`), SHEETS `6px` (`:80`), severity badge `6px` (`:44`), domain header `7px` (`:89`).
  Banner 13px (`:123`). **No RS-1.1 continuation** — `pageReviewStatus` (`:47`) joins all domains
  into one `.page` (`:111`) with no overflow-to-second-sheet; `page-content` is `overflow:hidden`
  (`generatePermit.ts:1475`) so a larger registry clips silently. Pagefit passes (belowBy −0.19in)
  only because text is squeezed to 6 px.
- **Classification:** layout (density/pagination — text below the ~7.5–8 px legibility floor,
  no continuation sheet).

### §19 — Eliminate the residual cover overflow
- **Rendered evidence:** sheet-level pagefit passes (PV-0 belowBy −0.09in, clipped=false, worst
  `sec f1 :: CONSTRUCTION NOTES`). The ~4 px overrun is an INTERNAL clip inside the left column's
  nested `overflow:hidden` container that the sheet-level tool does not surface.
- **Chain:** PV-0 `.page.cover-compact` (`generatePermit.ts:1388-1403`, height 11in, overflow:hidden)
  → `.page-body` grid `2fr 1fr` (`:1409-1417`, overflow:hidden, **no `flex:1` giveback**) →
  left `.col-stack` (`coverSheet.ts:468`) of 8 `.sec` blocks ending in `<div class="sec f1">`
  CONSTRUCTION NOTES (`coverSheet.ts:617`, `.f1{flex:1}` `:2198`). Summed min-content height of the
  8 sections + `.cover-compact` gaps exceeds the grid-row height by ~4 px; ancestors are
  `overflow:hidden` with no scroll and no `.page-body` `flex:1`, so the bottom of CONSTRUCTION NOTES
  is clipped rather than reflowed. `.cover-compact` scoping already fights this to within ~4 px.
- **§19 tooling gap:** `scripts/planset-pagefit.mjs` measures the lowest non-SVG descendant vs the
  PAGE box only; it cannot see a clip inside a nested `overflow:hidden` element. Needs
  element-level overflow detection (element ID, bbox, printable box, overflow amount).
- **Classification:** layout.

---

## REPAIR PLAN — 4 parallel workstreams

### WS-A — §1–§5: E-1 / PV-4A / branch-section model (electrical schedules)
- **Root:** `conductorAuthority.ts:193-201 microBranchRow` fabricates a #12 THWN branch
  conductor that four sheets print. Replace the branch conductor representation with projections
  of the canonical `BRANCH_RUN` (open-air Q-cable listed assembly) + `BRANCH_HOMERUN_RUN` (#10,
  ccc=6) segment objects. E-1 SVG (`sldAdapter.ts:166`) must read canonical gauge/count, not
  `b.wireGauge`; render the shared home-run as 6 CCC.
- **§2:** introduce ONE shared tri-state compliance result object (PASS/FAIL/PENDING-REVIEW),
  consumed by SCHED branch Status (`structuralPages.ts:1561/1579/1594`), PV-4B fill/VD cells,
  PV-4A busbar, E-1; retire the unconditional `&check;`.
- **§3:** delete the `'EMT'` default in `sheetComposition.ts:491`; route `:753/:763` (and
  `sldAdapter.ts:194/203`) through the canonical raceway accessor.
- **§4:** PV-4A (`electricalPages.ts:188-232`) must consume the canonical registry multiset
  (domain filter allowed), not the hardcoded `_ELEC_BLOCKER_CODES` allowlist; fix the
  `TAP-LENGTH-PENDING`↔`TAP-CONDUCTOR-LENGTH-PENDING` mismatch; stop duplicating conduit fill.
- **§5:** PV-4A branch table (`electricalPages.ts:329-339`) → option B (rating summary, no
  conductor/raceway fields) or option A (sectioned physical schedule).
- **Shared-file conflict:** `electricalPages.ts` (PV-4A/PV-4B/E-1 all here), `conductorAuthority.ts`,
  `sldAdapter.ts`, `sheetComposition.ts`, and `structuralPages.ts` (SCHED branch table — also
  touched by WS-C). Coordinate the SCHED branch-schedule edit and the shared tri-state object
  with WS-C.

### WS-B — §6–§10: Q Cable / lengths / DC row / supply-side / length taxonomy
- **§6:** add a canonical `ListedCableAssembly`/`QcableSegment` type to
  `lib/permit/snapshot/types.ts`; populate it in the snapshot build from the same source the V4
  BOM uses (`Q-12-10-240`, 31 drops); project it on PV-4B/E-1/SCHED/BOM/APP-A instead of generic
  #12 THWN.
- **§7:** derive the trunk cable path from module/micro coordinates (available via
  `coordinateAuthority`); reconcile the 68 ft (plane-width, `deriveRunLengths.ts:179-182`) and
  152 ft (pitch heuristic, `bomForPermit.ts` V4) into one designed-installed length + drop count +
  procurement length; BOM sums it, evidence recomputes.
- **§8:** remove the DC wire+run row for micro topology in `structuralPages.ts:1642-1643`
  (reads legacy `str.wireLength`); show factory leads / connector type from the verified module
  record, or nothing, unless a canonical DC segment exists.
- **§9:** split the PV-4B step-5 hardcoded `COMPLIES` (`electricalPages.ts:706`) into
  "INTERCONNECTION METHOD: SUPPLY-SIDE TAP — SELECTED" + "INSTALLATION COMPLIANCE: PENDING —
  TAP-CONDUCTOR LENGTH NOT VERIFIED"; gate on the tap 705.11(C) constraint state.
- **§10:** add the length taxonomy (design/estimated/verified/calc/procurement + wasteFactor +
  lengthSource + verificationState); project the right one per sheet with a per-cell label.
- **Shared-file conflict:** `electricalPages.ts` (PV-4B — also WS-A), `bomForPermit.ts`,
  `deriveRunLengths.ts`, `snapshot/types.ts` + `snapshot/build.ts` + `electricalProjection.ts`,
  `structuralPages.ts` (§8 SCHED module table — also WS-C). Heavy `snapshot/*` overlap with WS-C/D.

### WS-C — §11–§14: procurement / documents (racking, fastener, spacing)
- **§11:** add a confirmed-base vs assembly-dependent vs unselected-candidate taxonomy to
  `calcRackingBOM` (`structural-engine-v4.ts:963-1040`); gate clamp/T-bolt/L-foot/splice/bonding
  rows on `railSku != null`; render "PENDING RACKING ASSEMBLY SELECTION" and exclude from
  procurement totals until selected.
- **§12:** add a SKU↔document applicability-verification object; split the merged
  `manufacturer-assets-db.ts:35` record (model RT-MINI vs docTitle RT-MINI II); until verified,
  fire an EQUIPMENT-DOCUMENT-APPLICABILITY blocker and omit/mark DS-3 non-authoritative
  (`datasheetAppendix.ts:84-151`, `structuralPages.ts:56-63`).
- **§13:** register the fastener-pending as a blocker (child of PENDING-RACKING-ASSEMBLY-SELECTION
  or its own FASTENER-ASSEMBLY-UNVERIFIED); source the `certLabel`
  (`structuralProjection.ts:326-328`) from the registry so cover/RS-1/PV-3/PV-4C.1/SCHED/PE-1/
  evidence agree; deterministic counts.
- **§14:** add a canonical spacing-authority object (design spacing / maximum-verified spacing /
  source document / roof zone / load conditions / verification state); replace the four hardcoded
  `48` chains (`structuralPages.ts:747`, `certPages.ts:621`, `compliancePages.ts:1116`,
  `structuralAuthority.ts:596`); render "DESIGN ATTACHMENT SPACING: 48 IN. O.C." + "PENDING
  STRUCTURAL VERIFICATION"; drop "max O.C. … verified" wording until a verified source exists.
- **Shared-file conflict:** `structuralPages.ts` (PV-3/PV-4C/SCHED — also WS-A §2/§8 and WS-B §8),
  `structuralAuthority.ts` / `structuralProjection.ts` / `rackingAssembly.ts` (snapshot),
  `compliancePages.ts` (APP-A — also WS-D §16), `certPages.ts` (PE-1 — also WS-D), `bomForPermit.ts`
  (also WS-B). Registry additions (§12/§13) touch `snapshot/validate.ts` + `severityPolicy.ts`.

### WS-D — §15–§19: language / labels / layout
- **§15:** replace the `IFC §1204.2 per AHJ` hardcoded suffix (`sheetComposition.ts:751`,
  `arrayPages.ts:528`) with "PROVISIONAL FIRE SETBACK BASIS — PENDING AHJ / IFC VERIFICATION"
  driven by `codeAuthority.editions.ifc` state; separate modeled geometry / assumed basis /
  verified requirement.
- **§16:** gate `dual-power-source-inverter-output` and `photovoltaic-system-connected`
  (`fieldLabels.ts:71,74`) by `isSupply`; split the merged 705.10/705.11/705.12 codeRefs in
  `field-placards-research.json:223,256` so load-side-only 705.12 clauses don't render on
  supply-side.
- **§17:** split the cover "designed per" clause (`coverSheet.ts:602-603`) into "ELECTRICAL
  CALCULATION BASIS: NEC 2020 / STRUCTURAL COMPUTATIONAL BASIS: ASCE 7-22 / AHJ-ADOPTED
  IBC-IRC-IFC EDITIONS: PENDING VERIFICATION".
- **§18:** increase RS-1 effective text size (`reviewStatus.ts:77-80,44,89`); add RS-1.1
  continuation pagination in `pageReviewStatus` (`:47,111`); never abbreviate authority
  paths/resolution actions.
- **§19:** recompose the cover left column at the component level (`coverSheet.ts:617` CONSTRUCTION
  NOTES `.sec.f1` + `.page-body`/`.col-stack` spacing, `generatePermit.ts:1409-1417`); add
  element-level overflow geometry validation to `planset-pagefit.mjs` (report element ID, bbox,
  printable box, overflow amount; require zero meaningful overflow).
- **Shared-file conflict:** `sheetComposition.ts` (§15 — also WS-A §3), `arrayPages.ts` (PV-5 labels
  §16 + PV-1B §15), `compliancePages.ts` (APP-A — also WS-C), `coverSheet.ts` (§17/§19),
  `certPages.ts` (also WS-C §13/§14), `generatePermit.ts` CSS (§18/§19), `planset-pagefit.mjs`.

### Cross-workstream shared-file hot spots (serialize edits)
- **`lib/permit/sections/electricalPages.ts`** — WS-A (PV-4A/E-1) + WS-B (PV-4B). Single file,
  three sheets.
- **`lib/permit/sections/structuralPages.ts`** — WS-A (§2 SCHED branch Status) + WS-B (§8 SCHED
  module table) + WS-C (§11 SCHED-3, §14 PV-3/PV-4C). Highest-contention file.
- **`lib/drafting/sheetComposition.ts`** — WS-A (§3 EMT) + WS-D (§15 fire setback).
- **`lib/permit/sections/compliancePages.ts`** — WS-C (§13/§14 APP-A) + WS-D (§16).
- **`lib/permit/sections/certPages.ts`** — WS-C (§13/§14 PE-1) + WS-D.
- **`lib/permit/utils/bomForPermit.ts`** — WS-B (§6/§7) + WS-C (§11).
- **`lib/permit/snapshot/{types,build,validate,severityPolicy}.ts`** — WS-B (§6/§10 new types) +
  WS-C (§12/§13 new blockers). Land the type/registry additions first, then the projections.

---

## Deliverable status (Phase 0)
- HEAD regen: `_ep0_head.html` + `_ep0_head.snapshot.json` (PDS-27C8B1270466).
- Closeout gates at HEAD: `planset-evidence-co.mjs` 20/20 pass (prior-round CO gates).
- Page-fit: `_ep0_pagefit.json` — 21 sheets, 0 sheet-level clips (§19 is a sub-sheet internal clip).
- Blocker registry (HEAD fixture): 12 active, all blocking; no FASTENER code.
- Live-vs-stale: delivered = live-DB Braidon (14 blockers, real APN/roof); HEAD = frozen fixture
  (12 blockers). All §1–§19 defects reproduce at HEAD.

---

## AFTER — closeout resolution (2026-07-24)

Every §1–§19 finding is fixed at its canonical source and guarded by a permanent rendered gate in
`scripts/planset-evidence-ep.mjs` (20/20 both original-fixture and live-DB modes). Baseline
`903e14cd` framing gate preserved unchanged (7 tests green).

| §  | BEFORE (defect at HEAD `903e14cd`) | AFTER (canonical fix) | Guarding EP gate |
|----|-------------------------------------|-----------------------|------------------|
| §1 | E-1 SVG prints `#12` for the shared home-run + "3 branches shared" | E-1 renders `projectE1PhysicalSchedule` canonical sections; SVG prints `6#10 THWN-2` | 1, 2 |
| §2 | SCHED branch Status prints unconditional `✓`; per-cell tri-state duplicated | one shared `evaluateCompliance` tri-state (fail-closed); E-1 sections never PASS while pending | 3 |
| §3 | `sheetComposition.ts` `\|\| 'EMT'` renderer default on PV-1/PV-3 | `canonicalConduitType` routes through the raceway accessor; no live EMT literal (PVC) | 4 |
| §4 | PV-4A re-derives counts from a hardcoded `_ELEC_BLOCKER_CODES` allowlist; `TAP-LENGTH-PENDING` mismatch | PV-4A consumes the canonical registry electrical subset; exact `TAP-CONDUCTOR-LENGTH-PENDING` | 5 |
| §5 | PV-4A branch table shows `#12 AWG THWN-2 → IQ Combiner` | option-B AC Branch Circuit Rating Summary (no conductor/raceway column) | 6 |
| §6 | PV-4B labels free-air Q-Cable `#12 AWG THWN-2` | canonical `ListedCableAssembly` (Enphase Q-12-10-240) projected on PV-4B/E-1/SCHED/BOM | 6 |
| §7 | PV-4B 3×68≠152 BOM (two heuristics, never reconciled) | geometry-derived per-branch cable paths; drops (31=1/micro) reconcile; proc = ceil(31×4.25×1.15)=152 | 7 |
| §8 | SCHED module table emits an unbacked `#10 AWG / N ft` DC wire+run row | micro topology has no canonical DC segment ⇒ no DC wire row | 8 |
| §9 | PV-4B step-5 hardcoded `COMPLIES` decoupled from the tap 705.11(C) pending state | method SELECTED + install compliance PENDING (gated on tap constraint); zero bare COMPLIES | 9 |
| §10 | bare unlabeled lengths (68/18/20 ft); single `oneWayFt` field | length taxonomy (design/calc/procurement + waste + provenance + verificationState); per-cell labels | 10 |
| §11 | SCHED-3 orderable clamp/T-bolt/L-foot rows while rail unpinned | assembly-dependent rows PENDING RACKING ASSEMBLY SELECTION, non-orderable, excluded from totals | 11 |
| §12 | DS-3/APP-A cite RT-MINI II manual for the selected RT-MINI mount | `evaluateDocumentApplicability` ⇒ unverified; DS-3 non-authoritative; EQUIPMENT-DOCUMENT-APPLICABILITY blocker | 12 |
| §13 | `PENDING VERIFIED FASTENER ASSEMBLY` visible but not a registry code (15/14/12 drift) | FASTENER-ASSEMBLY-UNVERIFIED blocking registry entry; label sourced from the registry; 14 blocking | 13 |
| §14 | PV-3/PV-4C/APP-A call 48" O.C. the "maximum allowed … verified" | DESIGN ATTACHMENT SPACING: 48 IN. O.C. + PENDING STRUCTURAL VERIFICATION; no unverified "max allowed" | 14 |
| §15 | PV-1/PV-1B `IFC §1204.2 per AHJ` while IFC unverified | PROVISIONAL FIRE SETBACK BASIS — PENDING AHJ / IFC VERIFICATION; no bare "per AHJ" | 15 |
| §16 | PV-5 renders load-side 705.12 placards on a 705.11 supply-side set | label applicability topology-gated; back-fed-breaker placard (705.12(D)(2)(3)(b)) N/A on supply-side | 16 |
| §17 | Cover "designed per NEC 2020, ASCE 7-22, IBC PENDING" (pending edition asserted as design basis) | CALC BASIS: NEC/ASCE split from AHJ-ADOPTED IBC/IRC/IFC: PENDING VERIFICATION | 17 |
| §18 | RS-1 core text 6–6.5px, no continuation | RS-1 blocker text 8.7px; every active code printed; RS-1.1 scaffolding (not needed at 14) | 18 |
| §19 | cover left column ~4px internal clip (sub-sheet, invisible to page-box scan) | cover-compact + cert-compact component-level recomposition; live long-address clip (10px) + CERT footer (3px) resolved; internal-clip scan gate | 19 |

**Count resolution (§13):** the frozen fixture and the live-DB Braidon both now carry **14 blocking**
(adds FRAMING-AUTHORITY-UNVERIFIED, FASTENER-ASSEMBLY-UNVERIFIED, EQUIPMENT-DOCUMENT-APPLICABILITY);
0 warnings. RS-1, PV-4A, cover banner and evidence agree.

**§19 live-only finding (this closeout):** the frozen fixture passed page-fit at HEAD, but the
live-DB Braidon (real long address) wrapped the ENGINEERING SUMMARY 1–2 extra lines, clipping the
bottom of CONSTRUCTION NOTES ~10.1px inside `.page-body` and the CERT date/footer ~3.1px inside
`.page-content`. Fixed at the component level (`coverSheet.ts` line-height 1.32→1.22; cover-compact
note density; cert-compact per-field rhythm) — both modes now internal-clipped=0.
