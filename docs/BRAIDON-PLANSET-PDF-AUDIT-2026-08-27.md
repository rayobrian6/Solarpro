# Braidon M Pilla — Issued PDF Audit (2026-08-27)

**Artifact audited:** `PermitPackage-BRAIDON M PILLA  Solar.pdf` — 19 pages, ANSI B 11″×17″,
produced by Chromium/Skia m147 on 2026-08-27 (browser print path, **not** the Phase-1 24×18
vector export).
**Snapshot:** `PDS-F3C08A712EE4` · schema 1.0.0 · SHA-256 `f3c08a712ee45418bdf4…`
**Method:** full text extraction (PyMuPDF) + every one of the 19 sheets rendered at 150 dpi and
read visually. No code changed; nothing regenerated.

**Package self-declares:** 5 open release gates / 12 unresolved requirements / 0 advisories /
NOT FOR PERMIT SUBMISSION.

---

## 0. What is already correct

Stated up front because it bounds the work. The release machinery is behaving: **nothing in this
package claims a pass it has not earned.** Spot-checks that reconcile exactly:

| Check | Result |
|---|---|
| Branch currents vs DS-2 (IQ8A max continuous 1.45 A) | 11×1.45 = 15.95 → **16.0 A** ✓; 10×1.45 = **14.5 A** ✓ |
| Max micros per 20 A branch | DS-2 says **11**; B1 carries 11 ✓ |
| AC output | 31 × 349 VA = **10.82 kW**, ÷240 V = **45.1 A** ✓ |
| Shared-raceway ampacity | 40 × 0.80 × 0.96 = **30.72 A** vs 20 A required ✓ |
| Feeder ampacity | #6 THWN-2 → 65 A (75 °C) vs 56.3 A continuous ✓ |
| Uplift per attachment | 53.47 psf × 0.6 × 11.817 ft² = **379 lb** ✓ |
| Σ-reaction closure (§8) | uplift / snow / dead / tributary all reconcile at ×1.337 ✓ |
| Conduit + wire footages | every BOM run = Σ length × conductors × 1.15, arithmetic exact ✓ |
| IFC 18″ ridge exception | array = 606.69 / 2024.06 = **30.0 % ≤ 33 %** ✓ |

---

## 1. The 12 requirements the package already knows about

Grouped by **who can actually close them** — this is the real critical path.

### 1A. External / human — one phone call blocks four sheets' worth of citations
- **CODE-AUTHORITY (Madison County).** NEC, IBC, IRC and IFC all print **PENDING**. This is the
  correct, honest behaviour (no inference), but it means every code citation on every sheet is
  unresolved, five placards are withheld, and the fire setbacks are "PROVISIONAL BASIS".
  See `madison-county-code-adoption` — the codified ordinance says **NEC 2005** while the county
  code official's own state filing says **NFPA 70 2023**. Call **Scott A. Rose, (618) 296-4667**;
  ask for the editions *and* the ordinance number. Note NEC 2005 predates rapid shutdown entirely,
  so the answer materially changes PV-5.

### 1B. Ray's design / procurement decisions — no document will ever arrive for these
- **PENDING-RACKING-ASSEMBLY-SELECTION.** No rail/splice SKU is recorded anywhere. Span-screened
  candidates printed: IronRidge XR100 (96″), XR1000 (84″), Unirac SME (78″), Unirac SolarMount (72″).
  Pinning the rail clears **exactly one of the six** structural requirements (`rackingAssembly.ts:628`
  fuses `-SOURCE-NOT-ARCHIVED` and `-APPLICABILITY-GAP` into one `if`).
- **FASTENER-ASSEMBLY-UNVERIFIED.** The only cited source, ICC-ES **ESR-3575**, is a *flashing /
  water-resistance* report and carries no fastener or capacity authority. The 600 lb ASD allowable
  is therefore unbacked, so PV-4C prints `CAP = PENDING`, `SF = PEND.` and asserts no attachment pass.
- **EQUIPMENT-DOCUMENT-APPLICABILITY.** On file is the **RT-MINI II** manual; the selected mount is
  **RT-MINI**. Per the earlier audit, Roof Tech publishes no gen-1 letter — this may be genuinely
  unacquirable, in which case the resolution is to *switch the selected mount to RT-MINI II*, not to
  hunt for a document.
- **MODULE-EXACT-DATASHEET-PENDING.** DS-1 carries a red banner: "NO GOVERNED MODULE DATASHEET ON
  FILE". Register + verify the live Q CELLS row (see `canonical-module-document-authority` —
  FAMILY_COVERED clears; the exact-400 W datasheet is not a real requirement).

> ⚠️ Three of the 12 **can never clear as coded** — no writer exists for the field their predicate
> reads (`FASTENER-ASSEMBLY-UNVERIFIED`, `EQUIPMENT-DOCUMENT-APPLICABILITY`,
> `TAP-CONDUCTOR-LENGTH-PENDING`). See `braidon-release-gate-audit`. Supplying the paperwork will
> **not** move the counter until the writers exist.

### 1C. Field measurement
- **ROUTE-LENGTH-ESTIMATE** — 4 of 5 project-owned runs have no routed geometry: `ROOF_RUN`,
  `BRANCH_HOMERUN_RUN`, `COMBINER_TO_DISCO_RUN`, `DISCO_TO_METER_RUN`. (`BRANCH_RUN` is
  geometry-derived and is not blocked; `MSP_TO_UTILITY_RUN` is utility-owned and excluded.)
- **TAP-CONDUCTOR-LENGTH-PENDING** — the ≤10-ft tap rule is unmeasured. See **N5** below: it is
  worse than "unknown".

### 1D. PE
- **Framing capacity** — 2×6 @ 24″ O.C. / ~12 ft span / DF-L is **operator-entered observation**,
  not authority. No utilization is asserted anywhere, correctly.
- **Digest-bound approval** — PE-1 is an unsigned placeholder. Remember: *a PE approval moves the
  digest it approves* (D44) — record it in PASS 2, never as a design patch.

---

## 2. Defects the package does **not** know about

These survive every gate. Numbered `N#` for tracking.

### 🚨 N1 — The module resolves to a generic 400 W record, not the Q CELLS ML-G10+ 400
Four independent tells, all consistent with each other and none consistent with the named module:

| Quantity | Printed in this package | Q.PEAK DUO BLK ML-G10+ 400 (published) |
|---|---|---|
| Module size (PV-3 callout 1) | **70.9″ × 41.7″** | 73.98″ × 41.14″ (1879 × 1045 mm) |
| Voc / Isc (E-1, SCHED) | **41.6 V / 12.26 A** | ≈ 45.4 V / ≈ 11.2 A |
| Module dead load (PV-4C) | **2.4 psf** ⇒ ≈ 49 lb/module | ≈ 46 lb ⇒ ≈ 2.15 psf |
| Array actual area (PV-1) | **636.48 ft²** = 31 × (70.9×41.7)/144 exactly | ≈ 655 ft² |

The array area is the smoking gun — it is the generic footprint to two decimals. **Consequence:**
tributary area (11.817 ft²), every per-attachment reaction, the 30.0 % roof-coverage figure that
earns the IFC 18″ ridge exception, and the dead-load psf are all computed on the wrong geometry.

The 2.4 psf ⇒ ~49 lb figure is the signature of the documented **`|| 50` fallback** (`panelWeightLbs`
reads `.weightLbs`; `SolarPanel` declares `.weight`) — same field-name bug class as the CAD
`.lengthIn` defect. **D55 is still live in this build.**

**And it has an electrical consequence:** Voc 41.6 V implies Vmp ≈ 34 V. DS-2 — *in this same
package* — gives the IQ8A MPPT window as **36–45 V**. As printed, the module sits below the
microinverter's tracking range. Either the module data is wrong (most likely) or the pairing is.
This must be resolved before a PE puts a seal on it.

### 🚨 N2 — Two of the three datasheets don't show what they claim
- **DS-1** reproduces **page 1** of the Qcells datasheet — the marketing page. It contains **zero
  electrical specifications**. An AHJ cannot verify Voc, Isc, dimensions or weight from this package.
- **DS-3** SOURCE line cites *"p.9-20 (Part B Bracket Installation cross-sections; rafter attach
  ~p.11, deck attach ~p.12/p.20)"* — the page actually reproduced is **page 7**, and only one page,
  not twelve.
- **DS-2** is correct (IQ8 p.2 spec table, IQ8A-72-2-US column) and is what the other two should look like.

### 🚨 N3 — Snow per attachment is stated twice, differently, on the same sheet
PV-4C "SNOW ANALYSIS" box: **111 lbs**. PV-4C attachment reaction schedule: **185 lb**.
185 is right (15.626 psf × 11.817 ft² = 184.6). 111 has no derivation anywhere on the sheet.

### 🚨 N4 — Attachment gravity demand omits racking and electrical dead load
Reaction schedule `DEAD = 28 lb` ⇒ **2.371 psf**. The dead-load table publishes **2.9 PSF** total
(2.4 modules + 0.4 racking + 0.2 electrical). The §8 reconciliation confirms it:
1509.049 lb ÷ 636.461 ft² = 2.371 psf. The rails and conduit never reach the reactions, so
`DOWN D+S` is understated by ~19 % of the dead component. (Uplift is unaffected/conservative —
0.6D reduces uplift — so the exposure is gravity only.)

### 🚨 N5 — The supply-side tap run is modelled twice, and the CAD estimate already busts the 10-ft rule
| Object | Endpoints | Length |
|---|---|---|
| `DISCO_TO_METER_RUN` | FUSED DISCONNECT → SERVICE / TAP | **15 ft** (CAD estimate), 3×#6 |
| `svc-tap-conductors` | SUPPLY-SIDE TAP POINT → FUSED AC DISCONNECT | **PENDING**, #6, ≤10 ft gate |

Same two endpoints, opposite order. Either these are duplicates (in which case the BOM
double-counts ~18 ft of conduit, its fittings and 3 conductors), or they are the same conductors and
**the 15 ft estimate is direct evidence that the ≤10 ft tap rule fails**. Today the engine prints
"length unknown" in one row and "15 ft" in the row above it and notices nothing.

### N6 — BOM line 30 orders 31 boxes of Q-Cable
Description: *"ORDER 1 × Q-12-10-240 — box of 240 connector sections … 1020 ft purchased"*.
QTY column: **31 ea**. A procurement export off the QTY column orders 31 boxes.

### N7 — Two Soladeck junction boxes, one drawn
BOM line 27 `0786-41` QTY **2**, derived from `runSegments.to=JUNCTION BOX`. PV-1B and E-1 both show
a single roof J-box taking all three branches.

### N8 — IQ8A AC output stated three ways
349 W (E-1) · 0.35 kW (SCHED) · **0.366 kW** (BOM line 1). Per DS-2: 349 VA continuous / 366 VA peak.
The BOM description silently uses peak; the system total (10.82 kW) uses continuous.

### 🚨 N9 — The rapid-shutdown placard is simultaneously withheld and released
On PV-5, all three at once:
1. `rapid-shutdown-building-placard — NEC §690.12(D)/690.56(C)` is listed in the red box
   **"5 PLACARDS PENDING CODE AUTHORITY — NOT RELEASED FOR PROCUREMENT / INSTALLATION"**;
2. the centre-column placard states it *"satisfies … the rapid-shutdown building placard
   (NEC 690.56(C))"* and prints the red RSD band ready to install;
3. BOM line 45 orders `LABEL-RSD` **qty 1** as a verified-orderable row.

Meanwhile L-1/L-2/L-3 are all marked **N/A** in the label schedule. Four answers, one safety label.

### N10 — Rapid shutdown voltage threshold contradicts itself
Cover note 12: *"reduce array conductors to ≤ 30V within 30 seconds"*.
PV-4A methodology table: *"Array-level: ≤ 80V within 30s"*.
Both are real NEC values (outside vs inside the array boundary) but the sheets never distinguish
them. Cover note 12 also cites **690.56(B)** for the initiator location — that is the plaque
section; initiator location is 690.12(C).

### N11 — Raw hazard values leak to print
Wind prints as **107.533 MPH** on PV-0 and three times on PV-3, but as **108 mph** on PV-4C and PE-1.
Ground snow prints as **23.284 PSF** everywhere, including the cover design-criteria table.
Three decimals on a design wind speed reads as a machine artifact to a plan reviewer.

### N12 — PE-1 asserts an attachment the rest of the set withholds
PE-1: *"ATTACHMENT: structural wood screw w/ flashing"*, *"RAIL ORIENTATION: Perpendicular to
rafters"*. PV-3, same package: fastener assembly **PENDING VERIFIED SELECTION**, material / coating
/ embedment / torque **WITHHELD — NO VERIFIED SOURCE**. The one sheet a PE signs is the one that
over-claims.

### N13 — Roof pitch printed as a single averaged value
PE-1: **3.6:12 (16.5°)**. PV-1 plane table: tilts **17° / 18° / 18° / 19°** across four planes.
`3.6:12` is 16.7°, and it is an average of a multi-plane roof presented as if it were the roof.

### N14 — Cover sheet index order ≠ actual page order
The index lists PE-1 as the last drawing sheet, then DS-1/DS-2/DS-3 as appendix. The file is
DS-1 = 16, DS-2 = 17, DS-3 = 18, **PE-1 = 19**, and every title block agrees with the file.
The index is the wrong one.

### N15 — Same conductor set, two CCC counts
`COMBINER_TO_DISCO_RUN` (3×#6): **2 CCC**. `DISCO_TO_METER_RUN` (3×#6): **3 CCC**.
Both land on ×1.00 so there is no numeric consequence today — but a reviewer who spots it will ask,
and if either run ever gains a conductor the two rows will derate differently.

### N16 — A voltage drop computed from an input the sheet declares absent
`DISCO_TO_METER_RUN` prints `— op` / `— cont` for current, and **0.28 % / PROVISIONAL PASS** for
voltage drop in the same row.

### N17 — Label-sheet bookkeeping
- Header: *"8 OF 19 DATASET LABELS (7 DECALS · 1 CARD · 1 ON CARD/PLACARD)"* — the parenthetical sums to **9**.
- The required-labels grid shows **AC-SYS**; the label schedule shows **L-9** in the same slot.
  Nothing on the sheet connects the two names.
- **L-11** is the only row with a blank CODE REF.

### N18 — Placard colour specified two ways
Spec table: *"CAUTION header per ANSI Z535 (black on safety yellow)"*.
Signage note 4: *"red background, white lettering … reflective"*. Same placard.

### N19 — 12 of 31 modules face due north, and the production estimate ignores it
PV-1 plane table: Roof 1 = **12 modules @ azimuth 0°** (north), 17° tilt. Roof 2 = 19 @ 180°.
The production estimate is a flat **1,400 kWh/kW DC → 17,360 kWh/yr** with no azimuth weighting.
North-facing at 17° in Granite City runs roughly 75–80 % of south, so the estimate is materially
high for this design. Customer-facing.

### N20 — Verify the 1.15 slack is not applied twice (D39)
Every BOM conduit line = printed route × 1.15 (18→21, 20→23, 15→18) and the arithmetic is exact.
The open question is whether the **printed route** is already slacked. The prior audit found the raw
home-run at 15.65 ft printed as 18 ft — 15.65 × 1.15 = 18.0 exactly, which would make the ordered
21 ft **1.34×** the true run. Check the snapshot's raw segment length before ordering.

### N21 — DESIGNER is `—` on all 19 sheets
Prints as an em dash in every title block. A plan reviewer will ask who drew the set.

---

## 3. Visual / draftsmanship

Judged from the rendered sheets, not from "it renders correctly".

| # | Sheet | Finding |
|---|---|---|
| V1 | **E-1** | Top ~40 % of the drawing area is empty white; the entire SLD is compressed into a middle band; the three bottom data tables print well under 6 pt at 11×17. Both known defects are present — the dead band **and** the width-bound fit. |
| V2 | **PV-3** | Text collisions and clipping: `EMBEDMENT / TORQUE / PILO` overlapped by `WITHHELD — NO VERIFIED SOURCE`; structural note clipped mid-word — *"PENDING STRUCTURAL VERIFICATIC"*; waterproofing notes 3 & 4 overflow the box border; general note 6 reads *"DOCUMENT APPLICABILITY **APPLICABILITY** PENDING"*; bottom ~40 % empty. |
| V3 | **PV-1** | The interconnection callout text overlaps the M / MSP / AC-D / INV equipment blocks and is unreadable at print size; a wide empty band sits between the site map and the data rail; neighbouring buildings render as blank grey polygons. |
| V4 | **PV-1B** | Right column below NOTES is ~40 % empty; a VENT symbol sits directly on the ridge/hip intersection; modules at the left end appear to encroach the 18″ hip setback — **verify against `drawnPolygon`, never the raster.** |
| V5 | **PV-5** | Bottom-left third of the sheet is empty white. |
| V6 | **DS-1/2/3** | Reproduced pages are not scaled to fill the sheet; DS-1 leaves ~40 % of the width blank. |
| V7 | **PE-1** | The `RE: 3 MELVIN DR APT A…` line runs into the right border / data rail. |
| V8 | **SCHED-2 / SCHED-4** | Bottom quarter empty; BOM row 24's description block is ~15× the height of its neighbours and dominates the sheet. |
| V9 | **whole set** | Sheet size is **ANSI B 11″×17″ from a Chromium print**, not the Phase-1 24×18 vector export. Every legibility decision in the Phase-1 SLD work was made at 24×18; none of it holds here. |

---

## 4. Close-out plan

**Track A — unblocks the most sheets, costs one phone call**
1. Madison County code adoption: NEC / IBC / IRC / IFC editions + ordinance number →
   Scott A. Rose (618) 296-4667. Archive the adoption document (W4-D).
   *Do not repair the four rows' jurisdiction in isolation — the canonical stamp hides them and the
   mailing-city stamp false-clears. Fix `code-authority@v1`'s mailing-city query (D1) first.*

**Track B — Ray's decisions, no document will arrive**
2. Pin the rail / splice SKU (clears 1 of 6).
3. Decide RT-MINI vs RT-MINI II. Switching the selected mount to RT-MINI II is probably cheaper than
   chasing a gen-1 document that does not exist.
4. Register + verify the live Q CELLS module row.

**Track C — field, one site visit**
5. Measure the 4 named routes and the tap conductor. Confirm ≤10 ft — **and resolve N5 first**, or
   the measurement lands next to a contradictory 15 ft estimate.

**Track D — engine work, in priority order**
6. **N1** (module identity / `.weightLbs` fallback) — highest value: it moves geometry, dead load,
   reactions, roof coverage and the MPPT check at once.
7. **N5** (duplicate tap run) — a latent 705.11 violation hiding behind a "pending".
8. **N3 / N4** (snow 111-vs-185, dead load 2.371-vs-2.9) — two numbers a plan reviewer will find.
9. **N9 / N10** (RSD placard released-and-withheld; 30 V vs 80 V) — safety labelling.
10. **N2** (datasheet page selection + the p.9-20/p.7 citation).
11. **N6 / N7 / N8** (BOM quantities and the peak-vs-continuous basis).
12. **N11–N18, N21** (presentation and bookkeeping) — cheap, and they are what makes the set read
    as machine output rather than engineering.
13. **N19** — azimuth-weight the production estimate or stop printing it.
14. **V1–V9** — Phase 2 sheet-size engine, then re-cut at 24×18 and re-measure legibility.

**Track E — last**
15. PE review of existing framing, recorded in PASS 2 against the *then-current* digest.

---

*Read-only audit. No files in the engine were modified. Sheets rendered to
`scratchpad/braidon/p01–p19.png`; extracted text at `scratchpad/braidon/text.txt`.*

---

# PART 2 — SOURCE-OF-TRUTH REPAIRS (same day, 2026-08-27)

Every fix below was made at the data source, not at the renderer. Suite after: **10,067 passing**,
4 failures — all four verified pre-existing by re-running the same tests against `git stash`
(`lib/bom/distributorPricing` ×1, `tests/golden-path` CAD goldens ×3).

## The one requirement that CLOSED

`EQUIPMENT-DOCUMENT-APPLICABILITY` — 13 open → **12 open**, nothing newly opened.

The prior audit listed this as one of three requirements that "can never clear". That was wrong, and
the evidence was already in our own repo: the `racking_detail:rooftech-mini` row cited the **RT-MINI II**
manual for the selected gen-1 **RT-MINI**, and the row's own `notes` field already named the gen-1
manual as "also verified". It re-fetched clean (HTTP 200, application/pdf, 2,042,678 bytes, 33 pp,
Jan 2021) and is now the archived source of record — version-exact for the selected mount. Nothing
was relaxed: `evaluateDocumentApplicability` still rejects a version mismatch, now pinned against
synthetic fixtures instead of against live data being wrong.

## Data-source corrections

| # | Source of truth | Was | Now |
|---|---|---|---|
| N1 | `lib/equipment-db.ts` Qcells row | generic template — Voc 41.60 / Isc 12.26 / 70.9×41.7 in / 44.1 lb | datasheet — **45.24 / 11.05 / 74.0×41.1 / 48.5 lb** (ML-G10+ 395-415 Rev06, 400 W class) |
| N1 | `lib/equipment-registry-v4.ts` Qcells | a *third* spec set (Voc 49.6 / Isc 10.18) | same datasheet values |
| N1 | `lib/db.ts` Qcells | 1.740×1.024 m, η 22.4 % | 1.879×1.045 m, η 20.4 % |
| N8 | `equipment-registry-v4` IQ8A | 0.366 kW (peak), 1.53 A, η 97.0 | **0.349 kW continuous, 1.45 A, η 97.6** — 1.53 A would have FAILED the 20 A branch it passes on |
| N2 | `manufacturer-assets-db` Qcells | docTitle said 385-405 but the URL was the 395-415 sheet; archived image was page 1 (marketing, no specs) | one document end-to-end; archived image is **p.2, the spec table** |
| N2 | `manufacturer-assets-db` RT-MINI | RT-MINI II manual; pageRef cited pp.9-20 but archived p.7 | **gen-1 RT-MINI manual, p.15 rafter attachment**; citation matches the page |

## Precedence inversions — why a data fix could not reach the sheets

Five places put a **posted scalar ahead of the catalogue**, so correcting the record changed nothing
until each was fixed. All now follow the `utils/panelSpecs.ts` doctrine (resolved record first,
scalars last):

- `system/systemAccessors.ts` — the SystemDefinition carriage; fed both E-1 and SCHED
- `permit/utils/arrayLayout.ts` — the unscoped single-system path never consulted the catalogue at
  all; also the source of the "66.9×40.9 in taken from posted project scalars" warning
- `sections/compliancePages.ts` — twice: Voc/Isc, and panel weight (`|| 44` literal)
- `sections/structuralPages.ts` — the SCHED modules table read `str.panelVoc` raw
- `sections/arrayPages.ts` — the string legend's `|| 41.6` / `|| 12.26`

## Engine corrections

- **N4 dead load** — `generatePermit.ts` set `moduleLoadPsf = pvDeadLoadPsf` (which is already
  panel + racking), then invented `rackingLoadPsf` as a 15 % surcharge on top, then a hardcoded
  0.2 psf "electrical". Printed total was `1.15 × (true added dead) + 0.2`. PV-4C now projects the
  engine's two components and the total **is** the reaction basis: 2.11 + 0.18 = **2.29 PSF**, and
  28 lb ÷ 12.3 ft² = 2.29.
- **N3 snow** — `snowAtt` was still on the legacy path while `upliftAtt` had been migrated, so one
  sheet printed both 111 lbs and 185 lb. Now sourced from the same canonical attachment objects, and
  guarded so a no-snow site prints "—" rather than a computed-looking 0.
- **D54** — "typically 8–12 PSF" prose sat beside a total built on the engine's 15.0 PSF assumption.
  Now states the assumption actually used and labels it ASSUMED / not field-verified.
- **N5 tap conductors** — `state: 'pending'` was an unconditional literal; no `'pass'`/`'fail'`
  writer existed anywhere in `lib/`. Now written: a **field-measured** span ≤10 ft passes, >10 ft
  fails; when only the CAD estimate exists and it exceeds 10 ft, the constraint and the blocker carry
  an explicit warning instead of printing "length unknown" one row below a 15 ft estimate for the
  same span. An estimate never certifies **and never condemns** — only a measurement decides. The
  blocker predicate now fires on `fail` as well as `pending`, which it previously would not have.
- **N20 / D39 double slack** — `deriveRunLengths` applied 1.15 to produce the "route (one-way)"
  length and `bom-engine-v4` applied 1.15 again: ordered quantity was 1.32× the real run, and the
  printed route was not a length a crew could go and measure. Slack deleted at the route source; it
  now lives only in procurement.
- **N6** — the trunk-cable BOM row said "ORDER 1 × Q-12-10-240" in prose while QTY read **31 ea**
  (31 boxes ≈ 31,620 ft). Now **1 package**.
- **N7** — junction boxes counted every run ending at a JUNCTION BOX *or an AC COMBINER*, so the
  combiner was counted as a second Soladeck box. Now counts distinct junction-box nodes: **1**,
  matching PV-1B and E-1.
- **N9** — the rapid-shutdown placard was simultaneously withheld, printed as satisfied, and ordered
  in the BOM. The plaque now claims only 705.10 + 690.56(B) when the NEC edition is ungoverned, and
  the RSD band is marked NOT RELEASED (PREVIEW).
- **N11** — one rounding rule, in `siteDesignLoads`. The cover, PV-3 and the drafting descriptors no
  longer print 107.533 MPH beside PV-4C's 108. Numeric values untouched.
- **V2** — PV-3's label collision (`EMBEDMENT / TORQUE / PILO` running under its own value), the
  note clipped mid-word at "VERIFICATIC", and the roofing notes overflowing their border: labels
  sized to their column, notes word-wrapped, and the notes box sized to its wrapped contents.

## STILL OPEN — 12 requirements, and none of them is code

Nothing below can be closed from this repo. The package is ready for a PE to **review**; it is not
ready to **submit**, and it says so correctly on every sheet.

1. **CODE-AUTHORITY-INCOMPLETE** — Madison County NEC / IBC / IRC / IFC editions. One phone call:
   **Scott A. Rose, (618) 296-4667**. Also unblocks the five withheld placards and the fire-setback
   basis. Fix `code-authority@v1`'s mailing-city query (D1) before spending on AHJ data.
2. **PENDING-RACKING-ASSEMBLY-SELECTION** — you pick the rail / splice SKU. Clears 1 of 6.
3. **FASTENER-ASSEMBLY-UNVERIFIED**, **RACKING-CAPACITY-SOURCE-NOT-ARCHIVED**,
   **RACKING-CAPACITY-APPLICABILITY-GAP** — all three need the **Illinois RT-MINI P.E. letter from
   Roof Tech**. The manual references those letters (p.3) but they are not downloadable — guessed
   paths return the site's SPA catch-all (text/html, 3 KB, not a PDF). Useful fact from the manual:
   the P.E. letters assume min 7/16" OSB with 2×4 @ 24" o.c. and 2 shingle layers; this roof is
   5/8" OSB with 2×6 @ 24" o.c., inside that envelope on both counts.
4. **ROUTE-LENGTH-ESTIMATE** and **TAP-CONDUCTOR-LENGTH-PENDING** — one site visit: the 4 named runs
   plus the tap span. Read the N5 warning first — the modelled disconnect→service span already
   exceeds 10 ft, so the disconnect may need **relocating**, not just measuring.
5. **FRAMING-AUTHORITY-UNVERIFIED** and **ENGINEERING-REVIEW-PENDING** — the PE. Record in PASS 2
   against the then-current digest (D44: an approval moves the digest it approves).
6. **ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED** — an archived climate-hazard source for wind/snow.
7. **MODULE-EXACT-DATASHEET-PENDING** — register and verify the Qcells row in the governed registry.
   Per `canonical-module-document-authority`, FAMILY_COVERED clears this; a wattage-exact PDF is not
   a real requirement.
8. **PROJECT-AUTHORITY-UNVERIFIED** — project identity / designer of record.

## Not addressed

- The remaining page-composition items from Part 1: E-1's dead white band and sub-6 pt data rail, the
  large empty regions on PV-1 / PV-1B / PV-5 / SCHED, and DS pages not scaled to the sheet. These are
  the **Phase 2 sheet-size engine** — the package still renders at ANSI B 11×17 from a browser print,
  and every legibility decision in the Phase 1 SLD work was made at 24×18.
- **N19** — 12 of 31 modules face due north against a flat 1,400 kWh/kW production estimate. That is
  a design and customer-facing question, not a planset defect, and it changes a number the customer
  has already seen. Your call.
- Pre-existing and untouched: the `distributorPricing` catalogue-source test and the 3 CAD goldens.
