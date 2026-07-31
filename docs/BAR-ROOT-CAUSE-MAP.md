# BAR — Blocker & Authority Reconciliation: Phase 0 Forensic Root-Cause Map

Phase 0 (READ-ONLY audit). Baseline `9ea52f22` (dev HEAD). Audit target:
`PermitPackage-BRAIDON M PILLA — Solar TEST (5).html` — snapshot **PDS-937E0289544B**,
21 sheets, generated 2026-07-25 (`SP-PERMIT-BRAIDONMPILL-7252026`).

## Live-vs-stale verdict — (5).html is LIVE AT HEAD

(5).html reflects HEAD `9ea52f22` code, NOT a stale pre-HEAD deploy:

- Contains `QCABLE-PROCUREMENT-INSUFFICIENT` (rendered on RS-1 + PV-4B + BOM). That
  blocker code exists ONLY as of HEAD `9ea52f22` (the Q-Cable sufficiency gate). A
  pre-QCABLE build could not emit it.
- Contains `FRAMING-AUTHORITY-UNVERIFIED` (added `903e14cd`) with the observation-vs-capacity language.
- `CONDUIT-FILL-PENDING` / `TAP-CONDUCTOR-LENGTH-PENDING` render as **BLOCKING** (the §17 severity promotion) — HEAD behavior.
- Snapshot label date = 2026-07-25 = today.

⇒ The task's "(5) may predate the QCABLE gate" branch is FALSE. The 17-vs-18 question
is live and real. No saved snapshot dump in-repo matches PDS-937E0289544B (all
`_tmp_*.snapshot.json` and `docs/evidence/*` carry different snapshot IDs / older
designs), so a value-diff regen from the live DB is still owed in a later phase; the
code-path reasoning below is dispositive for classification.

---

## §1 — 17 vs 18 blocker count  →  CLASSIFICATION: NOT a cross-surface mismatch; the missing 18th is SUPPRESSED by §2

**Rendered evidence.** Every surface in (5).html agrees at **17 BLOCKING / 0 ADVISORY**:
cover banner "NOT FOR PERMIT SUBMISSION — 17 OPEN RELEASE BLOCKERS"; RS-1 header "17
OPEN RELEASE BLOCKERS", summary "BLOCKING 17 ADVISORY 0", derived issue state "PENDING
ENGINEERING REVIEW"; `braidon-ep-evidence-live.json` `blockingCount: 17`. No surface
in (5).html says 18. No RS-1 rendering cap; no domain-map drop.

**Exact rendered multiset (17), by RS-1 domain section:**

| # | Code | Domain section |
|---|------|----------------|
| 1 | EQUIPMENT-IDENTITY-CONFLICT | EQUIPMENT — 1 |
| 2 | FRAMING-AUTHORITY-UNVERIFIED | STRUCTURAL — 5 |
| 3 | PENDING-RACKING-ASSEMBLY-SELECTION | STRUCTURAL |
| 4 | FASTENER-ASSEMBLY-UNVERIFIED | STRUCTURAL |
| 5 | RACKING-CAPACITY-SOURCE-NOT-ARCHIVED | STRUCTURAL |
| 6 | RACKING-CAPACITY-APPLICABILITY-GAP | STRUCTURAL |
| 7 | ROUTE-LENGTH-ESTIMATE | ELECTRICAL — 4 |
| 8 | CONDUIT-FILL-PENDING | ELECTRICAL |
| 9 | TAP-CONDUCTOR-LENGTH-PENDING | ELECTRICAL |
| 10 | QCABLE-PROCUREMENT-INSUFFICIENT | ELECTRICAL |
| 11 | CODE-AUTHORITY-INCOMPLETE | CODE AUTHORITY — 1 |
| 12 | EQUIPMENT-DOCUMENT-APPLICABILITY | PROJECT/DOCUMENT — 5 |
| 13 | PROJECT-AUTHORITY-UNVERIFIED | PROJECT/DOCUMENT |
| 14 | PROJECT-NAME-NONPRODUCTION | PROJECT/DOCUMENT |
| 15 | DESIGNER-OF-RECORD-MISSING | PROJECT/DOCUMENT |
| 16 | MODULE-EXACT-DATASHEET-PENDING | PROJECT/DOCUMENT |
| 17 | ENGINEERING-REVIEW-PENDING | ENGINEERING REVIEW — 1 |

**The 18th = `WIND-SNOW-AUTHORITY-UNRESOLVED`, ABSENT because it is suppressed.**
- Registered at `structuralAuthority.ts:851-854`, fired only when `!ctx.windAuthoritative || !ctx.snowAuthoritative`.
- Pushed into the registry unconditionally at `build.ts:1040` (`for (const sb of structAuth.blockers) push(...)`).
- Its code matches `/^…|WIND|SNOW/` in `classifyBlockerDomain` (`projectAuthority.ts:90`) ⇒ maps to **structural** ⇒ it WOULD render on RS-1 if present. It is not present, so it is not in the live registry at all.
- The frozen-fixture registry (`docs/evidence/braidon-active-blocker-registry.json`, PDS-69A79CD87335) DOES include `WIND-SNOW-AUTHORITY-UNRESOLVED` (the fixture has no operator wind/snow). That is almost certainly the basis of the "18" claim.

**Chain.** `build.ts:669-670` sets `windAuthoritative = proj.ahjWindSpeedMph != null;
snowAuthoritative = proj.ahjGroundSnowPsf != null`. The live Braidon design has operator-entered
`ahjWindSpeedMph = 110` and `ahjGroundSnowPsf = 20` ⇒ both flags true ⇒ the WIND-SNOW
blocker is suppressed ⇒ 17. The count discrepancy is therefore a **symptom of §2**, not an
independent bug: on the live design the honest count SHOULD be 18 (the wind/snow authority
is not actually verified — see §2), but the current code clears the blocker the moment an
operator types a number.

**Repair seam.** Do not add a render-side fix. §1 is closed by §2: replace the
non-null-field authoritative test with a provenance-gated `EnvironmentalLoadAuthority`
record. When operator-entered-without-verified-source no longer counts as authoritative,
`ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` fires and the rendered count becomes 18 — matching
the truth. Add a rendered multiset-equality gate (cover == RS-1 == evidence JSON == issue gate).

---

## §2 — Environmental load authority  →  CLASSIFICATION: authority-suppression bug (real defect; extends WIND-SNOW-AUTHORITY-UNRESOLVED)

**Rendered evidence.** PV-4C prints "Design Wind Speed (Vult) 110 mph · Exposure Category
Cat. C · Velocity Pressure (qz) 22.3 …", "Ground Snow Load (pg) 20 psf · Roof Snow Load
(ps) 13.4 psf", "Risk Category —" as **design criteria with no source/provenance line and
no blocker**. `buildEnv` (`structuralAuthority.ts:695-697`) labels the wind source
"canonical project/AHJ wind authority" the instant `windAuthoritative` is true — i.e. a
bare operator entry is dressed as verified AHJ authority.

**Provenance the records currently carry.** `StructuralEnv.windSpeedSource` is a string that
is EITHER "canonical project/AHJ wind authority" (any non-null operator value) OR
"code-minimum default … UNVERIFIED". There is NO source document, dataset, version/date,
lookup timestamp, coordinates/address, operator-override flag, or verification-status field.
The `provenance` blob is a static note. This is exactly the FramingObservation-vs-Capacity
problem (operator entry treated as verified) applied to wind/snow.

**Overlap with WIND-SNOW-AUTHORITY-UNRESOLVED (extend, do NOT duplicate).**
`WIND-SNOW-AUTHORITY-UNRESOLVED` fires ONLY in the null-field / code-minimum-default case.
The gap is the **operator-entered-without-provenance** case, which the existing blocker
never covers. `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` must SUBSUME the old code:
fire whenever wind OR snow OR exposure/risk lacks a verified archived source — including
when a value is present but operator-posted. Recommended: rename/retire
`WIND-SNOW-AUTHORITY-UNRESOLVED` → `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` at the single
emitter (`structuralAuthority.ts:851`), keep it structural-domain, keep the null-field case
as one of its branches. Values stay in the preliminary analysis but are never labeled
"canonical … authority" without a provenance record.

**Chain / seam.** `build.ts:669-670` (authoritative test) → new `EnvironmentalLoadAuthority`
record on the snapshot (fields per directive §2) → `buildEnv` sources the label + verification
state from it → PV-0/PV-4C/PE-1/RS-1/evidence all read the same state. Tests: verified
source, operator override, missing source, stale source.

---

## §3 — False SCHED compliance conclusion  →  CLASSIFICATION: ungated positive-compliance claim (real defect)

**Rendered evidence.** SCHED page conclusion: "All equipment is UL-listed; wire sizing
verified per NEC 690.8 with derating; equipment complies with NEC 2020 and UL 1741 /
61730 / 2703." Also a black **"VERIFIED"** badge on the DC/AC wire-sizing chain block.
Both assert global compliance while 17 blockers are active (racking, fastener, RT-MINI
capacity, doc applicability, module datasheet, conduit fill, Q-Cable sufficiency, eng review).

**Chain.** Emitter `structuralPages.ts:1840` (conclusion) and `:1818-1825` (VERIFIED badge).
The only dynamic input is `_cpEq.nec` (the NEC edition string) — the sentence is otherwise a
hardcoded PASS. It never reads `permitReadiness.registry` or the derived issue state.

**Repair seam.** Derive the conclusion from the registry/issue-state: while any blocking item
exists, render "DESIGN REVIEW PACKAGE / COMPLIANCE NOT YET ESTABLISHED / SEE RS-1 FOR ACTIVE
RELEASE BLOCKERS"; emit the positive conclusion + VERIFIED badge only when every applicable
authority/calculation passed. Add a gate: no global PASS/compliance/VERIFIED language while
blocking items exist. (File `structuralPages.ts` — also touched by §2 render + §6.)

---

## §4 — Shared-raceway ampacity evidence  →  CLASSIFICATION: under-projected authority (data exists, projected as a lone scalar)

**Rendered evidence.** E-1 shows "690.31(C) open air · derate 0.96 · 16.0A op · 20.0A cont ·
20A OCPD". A single bare "0.96" multiplier with no itemization; the six-CCC 1-1/4" PVC
home-run's conductor-count adjustment (0.80) is not shown beside it.

**Chain.** `computed-system.ts` already computes ALL factors: `getTempDerating(ambientC)`
(0.96 for 30-35 °C) at `:566`, `getConduitDerating(conductorCount)` (6 CCC → 0.80) at
`:582`, and the `WireRun` carries `conductorCount`, `currentCarryingCount`, `tempCorrectionFactor`,
`deratingBasis` ("6 CCC → 0.80 (NEC 310.15(C)(1))"), base ampacity, effective ampacity. But
`electricalProjection.ts:646` projects only `deratingFactor: num(branchSeg?.tempDeratingFactor)`
— one scalar — and `electricalPages.ts:148` renders it bare (`· derate ${x.deratingFactor.toFixed(2)}`).

**Repair seam.** Project a full canonical `AmpacityAdjustmentResult` (material, insulation
rating, size, base table ampacity, terminal-temp limit, CCC count, conductor-count adjustment,
ambient temp + correction, rooftop adder when applicable, corrected ampacity, final allowable,
required continuous, pass/fail/pending, NEC refs, provenance) from the data already in
computed-system; render every factor on E-1/PV-4A/PV-4B identically; missing input → PENDING
never PASS. (Files `electricalProjection.ts`, `electricalPages.ts`, `computeSystemProjection.ts`.)

---

## §5 — Q-Cable grounding authority  →  CLASSIFICATION: (B) separate EGC required; E-1 asserts it but BOM does not quantify the open-air branch length (real gap)

**In-repo manufacturer authority (dispositive, not a guess).** `lib/equipment/trunkCable.ts:69`
— Enphase Q Cable `Q-12-10-240` is `conductors: 2` (`soldBy: 'drop'`, 4.25 ft connector
spacing). **Two conductors = line + neutral; NO integrated equipment grounding conductor.**
Therefore the listed Q-Cable assembly does NOT bond the branch — a **separate EGC is required**
(directive option **B**), run in the open air alongside the branch trunk.

**Canonical grounding objects agree.** `build.ts:283-291` pushes one `groundingObjects` record
per branch: `purpose: 'branch-egc', required: true, method: 'conductor', conductorSize: branchRun.egcGauge`
(#10), `codeBasis: 'NEC 250.122'`. So the model already says: separate #10 Cu EGC, per branch, open-air.

**Rendered evidence.** E-1 correctly prints "ENPHASE Q CABLE (TC-ER) 1×#10 GRN EGC OPEN AIR —
NEC 690.31(C)". BOM rows present: `THWN2-GRN-12 21 ft (BRANCH_HOMERUN_RUN)` and `THWN2-GRN-10
41 ft (COMBINER_TO_DISCO/DISCO_TO_METER)`. **There is NO BOM line for the open-air branch-length
EGC** — the ~166.5 ft of open-air branch trunk (the same designed-installed path as the Q-Cable)
has no green-EGC footage. E-1 asserts an open-air EGC the BOM never quantifies.

**Repair seam.** Model exactly one result = (B). Derive the open-air branch EGC length from the
branch cable paths (`electrical.branchCablePaths`, Σ ≈ 166.5 ft), add a #10 GRN open-air EGC BOM
line, and show it consistently on PV-1B / E-1 / PV-4B. Gate: separate-EGC language requires a
matching route + BOM quantity. (Files: `build.ts` grounding, `bomForPermit.ts` EGC rows,
`electricalPages.ts` / `sldAdapter.ts` E-1.)

---

## §6 — Unverified fasteners shown as orderable  →  CLASSIFICATION: verified-only display not enforced (real defect)

**Rendered evidence.** SCHED/PV-3 print "Fastener: 5/16" (8mm/M8) structural wood screw, ~3.5"
(90mm) — 2 per pad, no pilot hole, minimum 2.5" embedment into rafter" — full diameter / length /
embedment / count — while `FASTENER-ASSEMBLY-UNVERIFIED` blocks. Qty ≈ 128 (attachments × 2/pad)
appears as an ordinary BOM quantity.

**Chain.** `projectFastenerAssembly` (`structuralProjection.ts:355-415`) computes
`verification` ('unverified' when `capacityGated`) but `descParts` (`:390-399`) unconditionally
includes diameter/length/qty-per-mount/embedment; the only concession is appending "· UNVERIFIED
(source document not archived)" (`:404`). The BOM attachment/screw quantity
(`bomForPermit.ts:657 attachmentCount`) flows into procurement totals unmarked.

**Repair seam.** While `verification !== 'verified'`: emit the calculated attachment quantity as
"DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY", exclude it from
authoritative procurement totals, and suppress manufacturer/SKU/diameter/length/coating/capacity
display; auto-regenerate the exact row when FastenerAssembly verifies. Test: unverified fasteners
cannot become orderable. (Files `structuralProjection.ts`, `structuralPages.ts`, `bomForPermit.ts`.)

---

## §7 — Sealing caps / terminators from branchCount, not topology  →  CLASSIFICATION: topology-independent quantity (real defect)

**Rendered evidence.** BOM: "Enphase Q Cable Sealing Cap (unused connector) — service-loop unused
drops (1 per AC branch)" and "Enphase Q Cable Terminator (branch end, single-use) — 1 per AC branch
end". 3 branches ⇒ 3 caps, 3 terminators — a per-branch constant, not derived from real objects.

**Chain.** `bomForPermit.ts:631-633` passes `branchCount = electrical.branches.length` (3) to the
V4 engine, which multiplies caps/terminators by branch count (comment `:627-630` "qty tracks the
REAL branch count (3 → 3)"). SKUs `Q-SEAL-10` / `Q-TERM-10` (`types.ts:273-275`,
`build.ts:802 terminatorSku`). The selected cable pieces (`trunkCable.ts` Q-12-10-240, 4.25 ft
connector spacing, sold by drop) and the drop occupancy (31 modules / 31 micros / **31 occupied
drops**, per `braidon-ep-evidence-live.json` `dropCount:31` and the QCABLE payload B1 11d / B2 10d /
B3 10d) are never consulted to count UNUSED drops.

**Repair seam.** Model separately: branch terminator (actual cable ends), unused connector/drop,
unused-connector sealing cap (from cable-piece connector inventory minus 31 occupied drops), branch
starting/ending connector. Caps = actual unused connector objects; terminators = actual required
cable-end objects; connectors = occupied drops. BOM + evidence list source object IDs per cap /
terminator. Gate: cap quantity must be topology-derived, not branchCount. (Files `bomForPermit.ts`,
`bom-engine-v4.ts`, `build.ts` connectors, `types.ts`.)

---

## §8 — Stale E-1 open-air legend  →  CLASSIFICATION: hardcoded legend literal (real defect)

**Rendered evidence.** E-1 SVG legend entry: "Open Air — PV Wire/THWN-2 (NEC 690.31)". The actual
open-air branch sections are the listed Enphase Q Cable (TC-ER) assembly, not generic PV Wire/THWN-2.

**Chain.** `lib/sld-professional-renderer.ts:2551` and `:3838` — a static legend array literal
`{dash:'10,5', stroke:GRN, label:'Open Air — PV Wire/THWN-2 (NEC 690.31)'}`. Not derived from the
canonical wiring-method / segment objects on the sheet.

**Repair seam.** Generate legend entries from the canonical wiring-method objects present
(`electrical.routeSegments` + `listedCableAssembly`): open-air micro branch ⇒ exact Q-Cable
identity; only show generic PV Wire/THWN-2 if such a method exists in the topology. Semantic gate:
legend entries == displayed-segment wiring methods. (File `sld-professional-renderer.ts`.)

---

## REPAIR PLAN — two parallel workstreams

### WS-G — Governance / authority (§1, §2, §3, §6)
- **§2 (root)** `build.ts:669-670`, `structuralAuthority.ts:694-712,851`, new `EnvironmentalLoadAuthority` record in `types.ts`, PV-4C/PE-1 render in `structuralPages.ts`. Extend (not duplicate) WIND-SNOW → ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED.
- **§1** rides on §2: once §2 lands, live count → 18; add rendered multiset-equality gate across cover/RS-1/evidence/issue-gate. No standalone render fix.
- **§3** `structuralPages.ts:1840` + `:1818-1825`: gate the SCHED conclusion + VERIFIED badge on the registry/issue-state.
- **§6** `structuralProjection.ts:390-404`, `structuralPages.ts` fastener render, `bomForPermit.ts:657`: verified-only display + NON-ORDERABLE design-quantity.

### WS-E — Electrical (§4, §5, §7, §8)
- **§4** `electricalProjection.ts:646` + `computeSystemProjection.ts` + `electricalPages.ts:148`: project + render full `AmpacityAdjustmentResult`.
- **§5** `build.ts:283-291` grounding, `bomForPermit.ts` EGC rows, `electricalPages.ts`/`sldAdapter.ts` E-1: add open-air branch EGC BOM footage (Σ branch paths ≈ 166.5 ft); authority = Q-Cable is 2-conductor / no integrated EGC (`trunkCable.ts:69`).
- **§7** `bomForPermit.ts:631-633`, `bom-engine-v4.ts`, `build.ts:802`, `types.ts:273-275`: caps/terminators from cable-piece connector inventory + 31 occupied drops, not branchCount.
- **§8** `sld-professional-renderer.ts:2551,3838`: legend from canonical wiring-method objects.

### Shared-file conflict notes (sequence to avoid clobbering)
- **`build.ts`** — WS-G §2 (`:669`) + WS-E §5 (`:283`) [+ §1 registry `:920-1104`]. Coordinate: land §2's ctx/authoritative change and §5's grounding change in one build.ts pass or serialize.
- **`structuralPages.ts`** — WS-G §2 (PV-4C wind), §3 (`:1840`), §6 (fastener). All WS-G — single-workstream, no cross-stream conflict.
- **`bomForPermit.ts`** — WS-E §5 (EGC rows) + §7 (caps qty) + WS-G §6 (attachment qty `:657`). Cross-stream: reserve distinct row emitters; §6 (structural) vs §5/§7 (electrical) touch different sections but same file — serialize the commit or split by function.
- **`types.ts`** — WS-G §2 (EnvironmentalLoadAuthority) + WS-E §7 (connector objects). Additive; low conflict.
- **`electricalPages.ts`** — WS-E §4 (`:148`) + §5 (E-1 EGC). Same workstream.

### Boundaries reaffirmed
Dev only; separate commit; no HTML patching; no fabricated wind/snow sources, grounding
authority, fastener SKUs, or manufacturer evidence; never auto-reconcile Braidon; no blocker
weakening; PRESERVE the framing-authority (`903e14cd`) and Q-Cable sufficiency (`9ea52f22`) gates.

---

## AFTER — closed state (2026-07-25, both modes rendered, 14/14 gates)

Rendered on the frozen fixture (`PDS-CD0F6377533F`, 14 blocking) and the live Braidon design
(`PDS-8910EFAC2AB8`, 18 blocking), 21 sheets each. Harness
`scripts/planset-evidence-bar.mjs` (gates 4/5/6/7/9/10/11 chained to `…-bar-wse.mjs`) exits 0
in BOTH modes; report-equals-rendered 0 mismatches; page-fit 0 clipping.

| § | BEFORE (audited) | AFTER (shipped) | Honest residual |
|---|---|---|---|
| §1 | 17 everywhere; the 18th suppressed the moment an operator typed a number | Live rendered **18 blocking / 0 advisory**, multiset identical across registry / RS-1 rows / RS-1 header / RS-1 summary / cover banner / evidence JSON / issue-state gate (gate 1) | — |
| §2 | 110 mph / Exp C / 20 psf printed as design criteria; `windSpeedSource` said "canonical project/AHJ wind authority" for a bare operator entry; no provenance fields | `EnvironmentalLoadAuthority` on `structural.env` with per-field basis, operator overrides, coordinates/address, source doc/dataset/version, lookup timestamp, verification status, project/AHJ, evidence ref. Async `resolveClimateHazardDocument` threaded through `opts.environmentalSource`. `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` blocking; PV-4C wind + snow + conclusion and PE-1 all carry the state tag | **UNVERIFIED (operator-entered)** — no archived, currency-reviewed climate-hazard source exists; resolver returns null and nothing is fabricated to clear it. Also fixed: an operator/AHJ 20 psf was being replaced by an engine 0 psf (`canonical.ts` snow fallback now symmetric with wind) |
| §3 | "All equipment is UL-listed … complies with NEC 2020 and UL 1741 / 61730 / 2703" + a black `VERIFIED` badge, with 17 blockers active | SCHED conclusion + badge derived from the registry / issue state; renders DESIGN REVIEW PACKAGE / COMPLIANCE NOT YET ESTABLISHED / SEE RS-1 while any blocker is active (gate 3 bans global PASS/compliance/VERIFIED language) | — |
| §4 | E-1 printed a bare `derate 0.96`; the 6-CCC 0.80 adjustment was never shown | Canonical `AmpacityAdjustmentResult` per section, itemized on E-1 + PV-4A + PV-4B: 6 CCC #10 Cu THWN-2 90 °C, base 40 A (310.16) × 0.80 (310.15(C)(1)) × 0.96 (310.15(B)(1)) = 30.72 A corrected; min(30.72, 35 A @ 75 °C terminal, 110.14(C)) ⇒ 30.72 A allowable vs 20 A required ⇒ **PASS** | `DISCO_TO_METER_RUN` and `svc-tap-conductors` are **PENDING** (missing required-continuous / tap authority) — never PASS (gate 5) |
| §5 | E-1 asserted a separate open-air EGC the BOM never quantified | Result **B (separate conductor)** from the in-repo SKU record (Q-12-10-240 = 2 conductors, no integrated EGC). Route = 3 branch objects on `BRANCH_RUN`; length Σ BranchCablePath 64.0 + 63.2 + 39.3 = **166.5 ft** × 1.15 waste = **192 ft** BOM (`GRN-OPENAIR-12`), stated identically on E-1 / PV-1B / PV-4B / BOM (gates 6, 7) | Length is CAD-derived (field-verify), as labeled |
| §6 | ~128 fasteners with full diameter / length / embedment while `FASTENER-ASSEMBLY-UNVERIFIED` blocked | Quantity retained as `DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY`, `data-fastener-orderable="false"`, excluded from procurement totals, all manufacturer/SKU/diameter/length/coating/capacity display suppressed; the exact row regenerates when the assembly verifies (gate 8) | Assembly verification is **pending** (railSku / capacitySource / spanSource pending) |
| §7 | 3 caps + 3 terminators as "1 per AC branch" | Objects modeled separately. Terminators = **3 enumerated cable-end objects** (B1-END, B2-END, B3-END), justified by the far-end object not by branch count. Connectors = **31 occupied drops** (11/10/10) read from the branch objects | Sealing caps = **PENDING**: Q Cable is procured by drop (31 drops = 31 micros ⇒ 0 surplus connectors) and the resolver models no fixed-length sections, so unused connectors are not determinate. The row prints QUANTITY PENDING with its derivation rather than a fabricated count; gate 9 accepts that recorded state and fails any per-branch quantity |
| §8 | Static legend literal `Open Air — PV Wire/THWN-2 (NEC 690.31)` | Legend generated from the wiring-method objects on the sheet: `Open Air — ENPHASE Q CABLE (TC-ER)` (Q-12-10-240, 2 conductors, UL 9703 / 690.31(C)); in-conduit THWN-2 entry only when a non-FREE_AIR segment exists; no DC-in-conduit entry and no generic PV Wire on an all-micro sheet (gate 11) | — |

### Visual integrity found while shooting the sheets (gate 13's blind spot)

The page-fit validator scans VERTICAL overflow, so three horizontal defects only showed up
in the per-sheet PNGs and were fixed:

1. **RS-1** — the CODE column was `table-layout:fixed` + `white-space:nowrap`, so a long code
   overran the ISSUE text instead of widening its own cell. Worst case is the new
   39-character `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED`; five pre-existing codes were
   already overrunning. Codes now wrap at their hyphens inside the cell.
2. **RS-1** — the STATUS column (52px) was narrower than the severity badge, so `BLOCKING`
   bled over the first character of every code. Now 66px.
3. **E-1** — `.sld-page` replaced `.page`'s padding wholesale, discarding the 1.72in
   title-block reservation. Harmless while E-1 held only the centred SLD, but the physical
   conductor/raceway schedule, the shared-raceway ampacity chain and the grounding note ran
   the full 17in and slid 152px under the title block, making the COMPLIANCE column
   unreadable. `.sld-page` now reserves the same strip; the schedule table also became
   `table-layout:fixed` (its declared widths sum to 100%) with wrapping headers.

A horizontal-clip probe (any inline content painted outside its own cell, plus any table or
svg extending under the title-block strip) reports 0 findings on all 21 sheets in both modes.

### Live blocker multiset (18, `PDS-8910EFAC2AB8`)

`CODE-AUTHORITY-INCOMPLETE`, `CONDUIT-FILL-PENDING`, `DESIGNER-OF-RECORD-MISSING`,
`ENGINEERING-REVIEW-PENDING`, **`ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED`**,
`EQUIPMENT-DOCUMENT-APPLICABILITY`, `EQUIPMENT-IDENTITY-CONFLICT`,
`FASTENER-ASSEMBLY-UNVERIFIED`, `FRAMING-AUTHORITY-UNVERIFIED`,
`MODULE-EXACT-DATASHEET-PENDING`, `PENDING-RACKING-ASSEMBLY-SELECTION`,
`PROJECT-AUTHORITY-UNVERIFIED`, `PROJECT-NAME-NONPRODUCTION`,
`QCABLE-PROCUREMENT-INSUFFICIENT`, `RACKING-CAPACITY-APPLICABILITY-GAP`,
`RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `ROUTE-LENGTH-ESTIMATE`,
`TAP-CONDUCTOR-LENGTH-PENDING` — all blocking, 0 advisory. Exactly one code added versus the
audited package; none removed. The framing-authority (`903e14cd`) and Q-Cable sufficiency
(`9ea52f22`) blockers are intact.
