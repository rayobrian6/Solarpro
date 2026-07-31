# PPC Root-Cause Map — Final Projection / Procurement Authority Corrective Pass

Phase 0 forensic audit. Baseline dev `41225032`. Directive:
`docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md`.
Audit target: `~/Downloads/PermitPackage-BRAIDON M PILLA — Solar TEST (6).html`
(PDS-2CF4E96E35E5, 21 sheets, 19 blocking / 0 advisory).
READ-ONLY pass: no code changed.

---

## 0. Live-vs-stale verdict

**Every one of Ray's 10 findings is LIVE AT HEAD.** None is a stale-delivery artifact.

Method: regenerated the full planset at HEAD through the frozen-fixture harness
`scripts/braidon-fixture-regen.ts` (reads `tests/fixtures/braidon-original-audit-fixture.ts`,
zero mutable DB rows) and diffed the finding-relevant literals against the delivered (6) HTML.

| | delivered (6) | HEAD fixture regen |
|---|---|---|
| snapshot | PDS-2CF4E96E35E5 | PDS-D307252768B7 (digest `d307252768b7…`) |
| sheets | 21 | 21 |
| blocking / advisory | 19 / 0 | 15 / 0 |

Literal parity (occurrence counts, HEAD regen vs (6)):

| finding | literal | (6) | HEAD | live? |
|---|---|---|---|---|
| §1 | `with circuit conductors` | 4 | 4 | LIVE |
| §1 | `#12 AWG Cu EGC` | 4 | 4 | LIVE |
| §2 | `DEFICIT PAYLOAD` | 2 | 1 | LIVE (see below) |
| §3 | `O.C. MAX` | 5 | 5 | LIVE |
| §3 | `48" O.C. MAX` | 3 | 3 | LIVE |
| §4 | `5/16` | 7 | 7 | LIVE |
| §4 | `EMBEDMENT` / `2.5"` | 7 | 7 | LIVE |
| §4 | `PILOT HOLE: 7/32" DIA` (contradicts authority) | 1 | 1 | LIVE |
| §4 | `ON FILE` uppercase = PV-3 citation (already gated) | 1 | 1 | n/a — gated |
| §5 | `RT-MINI-01` | 1 | 1 | LIVE |
| §6 | `PASS` | 38 | 38 | LIVE |
| §6 | `705.12` | 12 | 12 | LIVE |
| §7 | `AC Disconnect (ground bus)` + `#10 AWG bare Cu` | 1 | 1 | LIVE |
| §8 | sealing-cap `QUANTITY PENDING` w/ Qty `0` | 1 | 1 | LIVE |
| §9 | `Q-12-10-240` trunk row, no row state | 1 | 1 | LIVE |
| §9 | `166.5` / `14.5 ft deficit` | 22 | **0** | **input-driven only** |
| §10 | `APPROVED DESIGN` | 1 | 1 | LIVE |

**The two divergences are both informative, not stale-delivery:**

1. `DEFICIT PAYLOAD` 2 → 1. In (6) BOTH `QCABLE-PROCUREMENT-INSUFFICIENT` (legitimately)
   and `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` (wrongly) render the box. At HEAD the
   procurement blocker does not fire, so **the only DEFICIT PAYLOAD box in the entire
   HEAD package is the wrong one, bolted to a blocker that has no deficit.** This is a
   cleaner reproduction of §2 than the delivered package.
2. §9's deficit numbers (166.5 / 152 / 14.5 ft) are absent at HEAD because the fixture's
   Q-Cable path does not trip the sufficiency gate. §9's **structural** defect — the
   SCHED-2 trunk-cable row carries no row-level procurement state — reproduces fully at
   HEAD (row 29: `Enphase · Q-12-10-240 · 31 · ea`, bare). Only the specific ft figures
   require the live DB row.

### Registry reconciliation: 19 (live) vs 15 (HEAD fixture)

HEAD's 15 are a **strict subset** of (6)'s 19 — no code present at HEAD is missing from
(6), so there is no drift in the registry itself. The 4 extras are all live-input-driven:

| # | code (delivered order) | at HEAD? | why extra |
|---|---|---|---|
| 1 | `EQUIPMENT-IDENTITY-CONFLICT` | no | live row: `subSystems.roof.panelId='rec-alpha-pure-405'` vs fleet Q CELLS. **Operator-only** per standing rule; never auto-resolved (`build.ts:1011`, `:1073`) |
| 2 | `FRAMING-AUTHORITY-UNVERIFIED` | yes | |
| 3 | `PENDING-RACKING-ASSEMBLY-SELECTION` | yes | |
| 4 | `FASTENER-ASSEMBLY-UNVERIFIED` | yes | |
| 5 | `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` | yes | |
| 6 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` | yes | |
| 7 | `RACKING-CAPACITY-APPLICABILITY-GAP` | yes | |
| 8 | `ROUTE-LENGTH-ESTIMATE` | yes | |
| 9 | `CONDUIT-FILL-PENDING` | yes | |
| 10 | `TAP-CONDUCTOR-LENGTH-PENDING` | yes | |
| 11 | `QCABLE-PROCUREMENT-INSUFFICIENT` | **no** | live geometry yields a 14.5 ft deficit; fixture path does not. `build.ts:1141` |
| 12 | `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` | yes | |
| 13 | `CODE-AUTHORITY-INCOMPLETE` | yes | |
| 14 | `EQUIPMENT-DOCUMENT-APPLICABILITY` | yes | |
| 15 | `PROJECT-AUTHORITY-UNVERIFIED` | yes | |
| 16 | `PROJECT-NAME-NONPRODUCTION` | **no** | live `projectName` contains "TEST"; the fixture name does not (`build.ts:1030`) |
| 17 | `DESIGNER-OF-RECORD-MISSING` | **no** | live project has no designer assigned (`build.ts:1031`) |
| 18 | `MODULE-EXACT-DATASHEET-PENDING` | yes | |
| 19 | `ENGINEERING-REVIEW-PENDING` | yes | |

**Consequence for the repair pass:** §2 and §9 must be verified against a
**procurement-insufficient** input as well as the frozen fixture, or their gates will
pass vacuously. Recommend a second fixture variant (or a targeted unit test) that trips
`QCABLE-PROCUREMENT-INSUFFICIENT`; do NOT change the frozen acceptance fixture.

---

## 1. Per-finding root cause

### §1 — E-1 asserts an installed open-air EGC
**Classification: legacy projection (the literal lives in the PROJECTION, not the renderer)
+ one ungated renderer-local note block.**

There are **three** surfaces. One was patched; two were not.

| # | surface | file:line | state |
|---|---|---|---|
| a | E-1 sectioned physical schedule, `bonding` column, ×3 branch rows | `lib/permit/snapshot/electricalProjection.ts:932` (rendered by `lib/permit/sections/electricalPages.ts:146`) | **UNPATCHED — this is the "other surface"** |
| b | E-1 "GROUNDING & BONDING REQUIREMENTS" notes 2 + 3 | `lib/permit/sections/electricalPages.ts:1185`, `:1186` | **UNPATCHED** |
| c | SLD conductor label | `lib/permit/utils/sldAdapter.ts:257` → `'EGC: PENDING MFR AUTHORITY'` | already patched |

**(a) is the primary defect.** `projectE1PhysicalSchedule()`
(`electricalProjection.ts:882`) builds the per-branch trunk section at lines 901–932 and
sets:

```ts
bonding: egc ? `${egc} Cu EGC (NEC 250.122 @ ${b.ocpdA}A) — with circuit conductors` : null,
```

where `egc` (line 903) comes straight off the raw canonical objects
`electrical.groundingObjects[purpose='branch-egc'].conductorSize`. This builder **never
consults the grounding authority.** The correct fail-closed accessor
`projectOpenAirBranchGrounding()` exists 500 lines above in the same file
(`electricalProjection.ts:381`) and already returns
`renderLabel: 'GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY'` plus
`nonOrderable`/`bomRowState` — the E-1 section builder simply bypasses it.

Net effect: E-1 prints `PENDING MANUFACTURER AUTHORITY` in its prose block and
`#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors` in its schedule, on the
same sheet.

**(b)** is a hardcoded note list. Note 1 was gated in an earlier pass (reads
`structural.rackingAssembly` and renders `PENDING RACKING ASSEMBLY SELECTION`,
`electricalPages.ts:1178–1183`). Notes 2 and 3 were left alone:

```
2. Equipment grounding conductor (EGC): ${_ic.feederEgcGauge} bare Cu min. per NEC 250.122 and 690.45.
3. EGC routed with circuit conductors in same raceway per NEC 690.43(A).
```

Note 3 is doubly wrong: it asserts a **raceway** method for a **free-air** branch section.
Note 2 pulls the **feeder** EGC gauge and presents it as the project-wide EGC minimum —
collapsing two of the six objects Ray requires kept separate.

**Why the earlier patch missed it (harness gap).** `scripts/planset-evidence-bar.mjs:286`
gate `groundingNoAssertionWhilePending` tests only for:
`/SEPARATE\s+(EQUIPMENT GROUNDING CONDUCTOR|EGC)/i`, `/SEPARATE\s+#?\d+[^.]{0,40}EGC/i`,
`/no (separate |additional )?EGC (is )?required/i`. It has no assertion against an
**installed-EGC** phrasing, so `— with circuit conductors` passes cleanly. The new gate
must be written against the assertion class, not a phrase list.

Only render site for `bonding` is `electricalPages.ts:146` — a single choke point.

### §2 — RS-1 renders the wrong blocker payload template
**Classification: template-selection defect. Worse than code-prefix matching — there is
no selection at all.**

`lib/permit/sections/reviewStatus.ts:89–104`, `payloadBlock(r)`. It is invoked
unconditionally for every registry row at `reviewStatus.ts:121`. The **only** predicate is
line 91:

```ts
const p = r.payload;
if (!p || typeof p !== 'object') return '';
```

It is **not keyed on `r.code`** — not on a `QCABLE` prefix, not on a schema tag, not on
anything. There is exactly **one** hardcoded payload template in the codebase and it is
the Q-Cable **procurement-deficit** template. Any blocker carrying any structured payload
gets it, with `?? '—'` swallowing every absent field.

Two distinct payload schemas are produced upstream in `lib/permit/snapshot/build.ts`:
- `QCABLE-PROCUREMENT-INSUFFICIENT` → `procurementInsufficiencyPayload(ps)` (`build.ts:1149`)
  — carries `selectedQCableSku`, `connectorDropSpacingFt`, `totalDesignedInstalledFt`,
  `requiredServiceLoopAllowanceFt`, `procurementLengthFt`, `deficitFt`, `perBranchPaths`,
  `affectedBranchIds`, `resolutionOptions`.
- `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` → inline object (`build.ts:1163–1185`) — carries
  `outcome`, `selectedMicroinverterSku`, `selectedCableAssemblySku`, `selectedModuleSku`,
  `selectedMountingBondingSystem`, `projectJurisdiction`,
  `equipmentInsulationClassification`, `cableConductorConstruction`, `cableConductorCount`,
  `conductorCountIsNonDeterminative`, `documentId`, `documentHash`,
  `documentSectionOrPage`, `applicabilityVerification`, `necBasis`,
  `rackingModuleBondingRequirement`, `candidateQuantityFt`, `bomRowState`,
  `verificationStatus`.

The grounding payload shares **exactly one** field name with the template
(`verificationStatus`). Everything else falls to `—`. Rendered at HEAD:

```
DEFICIT PAYLOAD: SKU — @ —ft drop · designed —ft + allowance —ft () vs procurement —ft
⇒ deficit — ft · branches · affected — · mfr-doc authority null
· status pending-manufacturer-authority · resolution:
```

Note `mfr-doc authority null` is itself a hardcoded literal string `null` at
`reviewStatus.ts:103` — it is not even reading a field.

The grounding payload is already **rich and correctly shaped**. No upstream work needed:
this is purely a dispatch defect at the render layer.

### §3 — unsupported "maximum spacing" language
**Classification: stale renderer-local literals in a SECOND rendering stack that the
canonical spacing pass never reached.**

The canonical object exists and is correct:
`lib/permit/snapshot/structuralProjection.ts:112–166`, `SpacingAuthority` /
`projectSpacingAuthority()`. Its own header comment (lines 103–111) claims:

> ONE spacing object projected identically onto PV-3 / PV-4C / APP-A / PE-1 … no sheet may
> call the design spacing the "maximum allowed" … "MAXIMUM ALLOWED" language appears ONLY
> when verificationState === 'verified'.

It is already wired into the structural projection at `structuralProjection.ts:302`
(`_base.spacingAuthority = projectSpacingAuthority(_base)`), so **every renderer can reach
it today** via `projectStructuralFromInput(input).spacingAuthority`. (The convenience
wrapper `projectSpacingAuthorityFromInput` at `:169` has **zero call sites**.)

Actual consumers — **four sheets, not the two the directive assumes**:

| sheet | read | emit | enclosing fn |
|---|---|---|---|
| PV-4C.1 | `structuralPages.ts:775` | **`:978`** (only verbatim `designLabel`+`statusLabel` emitter) | `pageStructuralRoof` `:673`, part-2 |
| PV-4C | `structuralPages.ts:775` | `:857` | `pageStructuralRoof` `:673`, part-1 |
| APP-A | `compliancePages.ts:1101` | `:1118–1130` | `pageSpecSheetReference` `:806` |
| PE-1 | `certPages.ts:635` | `:683` | `pagePELetterRoof` `:556` |

**PV-3 and PV-1 are not wired.** Every offending emitter lives in `lib/drafting/` — a
separate CAD/drafting stack. `grep spacingAuthority lib/drafting` ⇒ **0 hits**.

The 3 rendered `48" O.C. MAX` occurrences all trace to **one** expression,
`lib/drafting/sheetComposition.ts:722` (`_attachDisplay`), emitted at three sites:

| emit | code | sheet |
|---|---|---|
| `sheetComposition.ts:753` | `{ label: 'ATTACH SPACING', value: _attachDisplay }` | **PV-1** |
| `sheetComposition.ts:760` | `{ label: 'ATTACH SPACING', value: _attachDisplay, bold: true }` | **PV-3** |
| `sheetComposition.ts:809` | `` `ATTACHMENT DETAIL — … | ATTACH: ${_attachDisplay}` `` | **PV-3** header |

```ts
const _railless = /RAIL-?LESS|RT[- ]?APEX|E[ -]?MOUNT ?AIR/i.test(d.mountSys);
const _attachDisplay = _railless ? '48" O.C. STAGGERED' : `${d.attachSpacing}" O.C. MAX`;   // :722
const _attachInto    = _railless ? 'direct-attach mounts @ 48" O.C. staggered'
                                 : `L-foot @ ${d.attachSpacing}" O.C.`;                     // :723
```
Note `:722`/`:723` also carry **hardcoded `48"` literals** on the rail-less branch,
independent of any authority.

Plus, in `lib/drafting/templates/roof.ts`, fn `drawRoofStructural` (`:2002`) ⇒ PV-3:
- `:2422` — `ftToFtIn(attachSp/12) + ' ATTACH. O.C. MAX'` → `4'-0" ATTACH. O.C. MAX`
- `:2494` — `` `ATTACH. SPACING: ${ftToFtIn(attachSp/12)} O.C. MAX.` ``

and ungated (no "MAX" word) spacing assertions in `drawRoofPlan` (`:157`) ⇒ PV-1:
`:1649` (general note 3B), `:1773` (legend), `:1887–1888` (callout), plus
`sheetComposition.ts:783` (`_attachInto`, PV-1 callout ⑤).

**The root cause is the descriptor field itself.** `lib/drafting/sheetComposition.ts:504–507`
(fn `getRoofData` `:386`):
```ts
attachSpacing: (_ca?.maxAllowedSpacing as number)
  || (p?.attachmentSpacing as number)
  || _mountSel?.mount?.maxSpacingIn
  || 48,
```
The value is sourced from a legacy field literally named **`maxAllowedSpacing`**, then
operator input, then a racking rated max, then a hardcoded `48`. It carries "maximum
allowed" semantics **in its own field name** and no `verificationState`. Every downstream
`O.C. MAX` string is a faithful render of a mis-modelled field.

`roof.ts` is subtler and shows the fix is cheap: at `:2027` it **already calls**
`projectStructural(ctx?.snapshot)` — but at `:2029–2033` takes only `.attachmentSpacingIn`
and falls through to `?? 48`, never touching `.spacingAuthority`. Snapshot access is
already present; only the field read is wrong.

**The repair pattern also already exists in `getRoofData`**: `conduitType` at
`sheetComposition.ts:512` reads `input._snapshot` via `canonicalConduitType()`.

**Same-sheet unit inconsistency (worth fixing while in here):** PV-3 prints `4'-0"`
(`roof.ts:2422`, `:2494`) and `48"` (`sheetComposition.ts:760`) for the same value, inches
apart on the sheet.

**Latent, not in this render** (will regress the gate on other sheets):
`lib/permit/sections/validationPage.ts:119`, `:612` (VAL-1) read
`canonical.structure.attachSpacingIn` — default `|| 48` at `lib/permit/utils/canonical.ts:310`.
DEAD, do not fix: `lib/permit_gen.mjs:447`, `:583`.

Residual: `structuralPages.ts:978` PV-4C.1 note 6 renders `MAXIMUM` inside an explicitly
negating clause — `"(design value; MAXIMUM ALLOWED needs a verified source)"`. Truthful
today, but a naive package-wide MAX/MAXIMUM gate will flag it. Whitelist by construction
(allow only inside the canonical `statusLabel`) or reword.

**Sheet-ID attribution bug found in passing:** `sheetComposition.ts:798` declares
`sheetId: isPlan ? 'PV-2' : 'PV-3'`, but the permit consumer of the plan composition is
`pageRoofPlan` (`lib/permit/sections/arrayPages.ts:33`) whose title block is **PV-1**
(`arrayPages.ts:62`). `PV-2` is only real in the standalone CAD path
(`lib/drafting/renderPlanSet.ts:195`). Any sheet-scoped gate keyed on that `sheetId` will
target the wrong sheet.

### §4 — unverified fastener + RT-MINI II authority on PV-3
**Classification: same root cause as §3 — the `lib/drafting` PV-3 stack is not wired to
FastenerAssemblyAuthority / EquipmentDocumentApplicability.**

**The authorities:**
- `FastenerAssembly` — `lib/permit/snapshot/structuralProjection.ts:340`; accessor
  `projectFastenerAssembly(input)` **`:384`**; `FASTENER_NON_ORDERABLE_LABEL` `:376`;
  verification rule `:414–417`; `const nonOrderable = verification !== 'verified'` **`:423`**.
  Backing record `lib/permit/snapshot/rackingAssembly.ts:408`, `:585`; snapshot type
  `lib/permit/snapshot/types.ts:668`.
- `EquipmentDocumentApplicability` — accessor `evaluateDocumentApplicability()`
  **`lib/manufacturer-assets-db.ts:232`**; contract comment `:170`; RT-MINI record `:37`
  (`docTitle: "Roof Tech RT-MINI II Installation Manual (Jun 2025)"`, `model: "RT-MINI-T"`).
- **Blockers are pushed in `lib/permit/snapshot/structuralAuthority.ts`, not `build.ts`:**
  `FASTENER-ASSEMBLY-UNVERIFIED` at **`:869`**, `EQUIPMENT-DOCUMENT-APPLICABILITY` at
  **`:885`**. Severity wiring `snapshot/severityPolicy.ts:101`, `:111` (both blocking);
  registry `snapshot/projectAuthority.ts:73`, `:74`.

Descriptor fields, `lib/drafting/sheetComposition.ts` (fn `getRoofData` `:386`), raw
`mounting-hardware-db` reads at `:459–465`, no authority:
```ts
lagSpec:   `${_fracIn(_lagDiaIn)}" DIA × ${_lagLenIn}" ${_lagType}`,   // :508
embedSpec: `${_embedIn}" MIN THREAD EMBEDMENT`,                        // :509
```
Twin raw reads in `lib/drafting/templates/roof.ts:2042–2048` (`lagLabelD`).

**Neither drafting file imports `projectFastenerAssembly`, `FastenerAssembly`,
`FASTENER_NON_ORDERABLE_LABEL`, nor `evaluateDocumentApplicability`.** They read the raw
`mounting-hardware-db` record and print unconditionally.

Ungated PV-3 emitters — `lib/drafting/sheetComposition.ts` (fn `roofComposition` `:707`):
`:508`, `:509`, `:761` (`LAG BOLT` row), `:762` (`EMBEDMENT` row), `:788` (callout ③),
`:789` (callout ④ `FLASHING`).

Ungated PV-3 emitters — `lib/drafting/templates/roof.ts` (fn `drawRoofStructural` `:2002`),
all rendering into the one PV-3 SVG:

| rendered | emitter | note |
|---|---|---|
| `2.5" MIN EMBED` | `:2361` | |
| `5/16" DIA × 3.5" STRUCTURAL WOOD SCREW` (leader ④) | `:2371` | |
| `ALPHASEAL BUTYL FLASHING (SELF-SEAL)` | `:2372` | hardcoded product name |
| `2.5" MIN. EMBED` | `:2427` | |
| torque value | `:2437` | `_lagDiaD <= 0.3125 ? '8–12 FT-LBS' : '15–20 FT-LBS'` — **fabricated from diameter, no source** |
| pilot diameter | `:2438` | `_lagDiaD <= 0.3125 ? '7/32"' : '1/4"'` — **fabricated** |
| `LAG BOLT: … , 316 SS` | `:2441` | **also asserts a coating**, while `FastenerAssembly.material` is honestly `null` (`structuralProjection.ts:409`) |
| `EMBEDMENT: 2.5" MIN INTO RAFTER` | `:2442` | |
| `PILOT HOLE: 7/32" DIA — RAFTER CENTER` | `:2443` | **contradicts the authority — see below** |
| `DRIVE TORQUE: 8–12 FT-LBS — NO OVERDRIVE` | `:2444` | |
| `FLASHING: MFR FLASHING — ALL PENETRATIONS` | `:2445` | |
| `BONDING: UL 2703 INTEGRATED — NEC 690.43` | `:2446` | |
| WATERPROOFING notes 1–6 (`SEALANT AT EVERY LAG`, `1-1/2" MIN EDGE DISTANCE`, …) | `:2449–2454` | |
| `MIN. LAG THREAD EMBEDMENT INTO RAFTER: 2.5".` | `:2492` | |
| `LAG BOLT: 5/16" DIA × 3.5" STRUCTURAL WOOD SCREW.` | `:2493` | |
| `CROSS-SECTION SCHEMATIC — VERIFY … EMBEDMENT IN FIELD — NTS` | `:2512` | |

**The sharpest finding: PV-3 prints a pilot-hole requirement the authority explicitly
negates.** For RT-MINI, `rackingAssembly.ts:585` sets `pilotHoleRequired: false` (parsed
from the manual's "no pilot hole"), so `FastenerAssembly.pilotRuleLabel === 'no pilot hole'`.
PV-3 nonetheless prints `PILOT HOLE / 7/32" DIA — RAFTER CENTER` from a
diameter-conditional guess at `roof.ts:2438`. This is not merely an ungated instruction —
**it is an ungated instruction that directly contradicts the snapshot.**

**The correct gated treatment already exists in the other stack** and is broad:
`structuralPages.ts:953`, `:960`, `:970–973` (PV-4C.1 — `PENDING` SVG dims +
`FASTENER_NON_ORDERABLE_LABEL`); `:1388–1392` (SCHED hardware schedule, `_faNon`);
`compliancePages.ts:1102`, `:1106–1110`, `:1132–1133` (APP-A); `certPages.ts:676`,
`:683–685` (PE-1); `bomForPermit.ts:885`, `:893–902`; `titleBlock.ts:31–34`.
PV-3 got none of it.

**`EQUIPMENT-DOCUMENT-APPLICABILITY` is already handled on PV-3 — for the citation only.**
PV-3 GENERAL NOTE 1, emitted by `lib/permit/sections/structuralPages.ts:74` in
`pageRoofStructural` (`:44`), with the disclaimer appended at `:77–79`:
> `1. ATTACHMENT PER ROOF TECH RT-MINI MANUFACTURER DOCUMENTATION ON FILE: Roof Tech
> RT-MINI II Installation Manual (Jun 2025) — p.9-20 … DOCUMENT APPLICABILITY UNVERIFIED —
> the on-file RT-MINI II covers a different product version than the selected mount
> RT-MINI; NOT AUTHORITATIVE until a version-exact document or verified alias evidence is
> provided.`

So PV-3 simultaneously says "this document is not authoritative" and prints its exact
dimensions as requirements. `pageRoofStructural` is the **only** PV-3 code that touches an
authority, and only for this note — it never touches the fastener authority. §4 is
therefore "finish the gating", not "start it".

**Leak on the gated sheet:** `structuralPages.ts:977` (PV-4C.1 note 5) prints a bare
literal *between two properly gated lines* (`:970–973` and `:978`):
```
5. Torque: Per manufacturer specification (typically 8–12 ft-lbs for 5/16", 15–20 ft-lbs for 3/8").
```
This is the source of both `ft-lb` hits and 1 of the 7 `5/16` hits.

**Latent, not in this render:** `lib/permit/sections/validationPage.ts:119`, `:612` (VAL-1).

### §5 — SCHED-3 racking rows show manufacturers / SKUs
**Classification: FLAG-PROPAGATION LOSS across a type boundary — not a labeling gap. The
classification is already computed correctly upstream and then silently discarded.**

This is the most important correction to the working hypothesis. The racking engine
**already** classifies these rows.

`lib/structural-engine-v4.ts:240–249` — `RackingBOMRow` already carries **two** state flags:
```ts
export interface RackingBOMRow {
  qty: number; unit: string; description: string; partNumber: string | null;
  /** true ⇒ assembly-dependent part awaiting rail-assembly selection. */
  pending?: boolean;
  /** false ⇒ not an orderable procurement line (excluded from totals). */
  orderable?: boolean;
}
```

`lib/structural-engine-v4.ts:1080–1096` — `calcRackingBOM()` already gates the seven
assembly-dependent rows, keyed on `railUnpinned`:
```ts
const railUnpinned = isRailBased && !system.rail;             // :1080
if (railUnpinned) {
  const gate = (row: RackingBOMRow, part: string): void => {
    row.partNumber = null; row.pending = true; row.orderable = false;
    row.description = `${part} — PENDING RACKING ASSEMBLY SELECTION — assembly-dependent
                       on the unselected rail SKU · NOT FOR PERMIT SUBMISSION`;
  };
  gate(bom.rails, …); gate(bom.railSplices, …); gate(bom.lFeet, …); gate(bom.midClamps, …);
  gate(bom.endClamps, …); gate(bom.mountingBolts, …); gate(bom.bondingClips, …);   // :1089–1095
}
```
`railUnpinned === true` for this project: mount `rooftech-mini`
(`lib/mounting-hardware-db.ts:577`) is `systemType: 'rail_based'` (`:582`) with **no `rail:`
key**.

**Then the flags are thrown away.** `lib/bom-engine-v4.ts:567–576`, `emitRackingBOMInto()`:
```ts
const emitRB = (category, r: { qty; unit?; description; partNumber } | undefined, nec) => {
  if (!r || r.qty <= 0) return;
  items.push(addItem('structural', category, mfr,
    r.description, r.partNumber ?? 'TBD', r.description,
    Math.ceil(r.qty), 'ea', nec, 'structuralEngine.rackingBOM', 'calcRackingBOM', true, …));
```
The destructured parameter type does not even mention `pending` / `orderable`, and `mfr` is
passed **unconditionally**. Root causes, in order:

1. **`BOMLineItemV4` has no orderability field at all** (`lib/bom-types-v4.ts:23–46`), so
   `addItem()` (`bom-engine-v4.ts:3040–3080`) has nowhere to put the flags.
2. **`PermitInput['bom']` also does not declare `nonOrderable`**
   (`lib/permit/types.ts:426–451`) — which is why the renderer has to cast
   `(item as { nonOrderable?: boolean })` at `structuralPages.ts:1524`.
3. `nonOrderable` therefore only ever gets set in the **two** hand-written post-passes in
   `bomForPermit.ts` (§5d `:838–876` open-air EGC; §5e `:885–906` `lag_bolt`), which is why
   only 2 rows are tagged.
4. **Manufacturer leak**: `mfr` = `rackingEntry.manufacturer` (`bom-engine-v4.ts:1629`) /
   `_roofRB.manufacturer` (`:1570`), printed unconditionally at `structuralPages.ts:1518`.
   The renderer has **no orderability predicate on the Manufacturer or Part Number cells**
   — only on Qty (`:1524–1527`).

Rendered SCHED-3 at HEAD (rows 35–43) — note gated prose but bare, untagged Qty and an
intact `Roof Tech` manufacturer on every pending row:
```
#35 end clamp      | Roof Tech | End clamp — PENDING RACKING ASSEMBLY SELECTION …      | TBD | 8   | ea
#36 grounding      | Roof Tech | Module-frame bonding (UL 2703) — PENDING …            | TBD | 31  | ea
#37 l foot         | Roof Tech | L-foot / mount-to-rail adapter — PENDING …            | TBD | 64  | ea
#38 lag bolt       | —         | Roof attachment fastener — DESIGN QUANTITY — NON-ORD… | PENDING-FASTENER-VERIFICATION | 128 (DESIGN QTY — NOT ORDERABLE) | ea
#39 mid clamp      | Roof Tech | Mid clamp — PENDING …                                 | TBD | 60  | ea
#40 mount hardware | Roof Tech | Rail T-bolt / mount-to-rail bolt — PENDING …          | TBD | 64  | ea
#41 racking        | Roof Tech | RT-MINI Flush Mount … rail-based mount                | RT-MINI-01 | 1 | lot
#42 rail           | Roof Tech | Rail — PENDING …                                      | TBD | 20  | ea
#43 splice         | Roof Tech | Rail splice — PENDING …                               | TBD | 16  | ea
```
Row 38 (`lag bolt`) is the only correctly-rendered one — it went through a `bomForPermit`
post-pass rather than `emitRackingBOMInto`.

**Row-family map (Ray's A/B/C/D classification) — the separating predicate is `railUnpinned`:**

| family | rows | today | Ray's required class |
|---|---|---|---|
| mount base ("confirmed") | `racking` lot line, `RT-MINI-01` | mfr + SKU printed, **not** gated by `railUnpinned` (it is not in the `gate()` list) | **B** — Ray now requires this gated too. Note the snapshot itself already says `mountSku: null` (`lib/permit/snapshot/rackingAssembly.ts:566`) while the BOM prints `RT-MINI-01` from `lib/equipment-registry-v4.ts:2567` — a direct contradiction. |
| assembly-dependent | end/mid clamps, bonding clips, L-feet, mount bolts, rails, splices | **already `pending:true, orderable:false` upstream**; flags dropped at `bom-engine-v4.ts:567` | **B** — fix is propagation, not classification |
| already correct | `lag_bolt`, open-air EGC | non-orderable | correct |
| suppressed | `flashing` (qty 0, RT-MINI `selfFlashing`), `ground_lug`, `mounts` | dropped by `if (r.qty <= 0) return` / deliberately omitted (`bom-engine-v4.ts:557–559`) | n/a |

Verification record for the auto-regenerate requirement:
`RackingAssemblyRecordExt.assemblyVerification` (`rackingAssembly.ts:240–246`, computed
`:549–560`; `_vRailSku = rail?.model ? 'verified' : (railUnpinned ? 'pending' : 'unverified')`).

**Gap the directive does not yet have a home for:** there is **no computed authoritative
procurement total** to exclude rows from. `structuralPages.ts:1544–1548` emits only
`TOTAL LINE ITEMS = flat.length`, which **counts pending rows**. The exclusion at
`:1560–1570` is **prose only**, and because it filters on `nonOrderable` it currently
renders:

> *"2 line items carry a DESIGN QUANTITY ONLY and are EXCLUDED from the authoritative
> procurement totals pending verified authority (see RS-1): wire, lag bolt."*

**The 7 pending racking rows are absent from that sentence** — the package actively tells
the reader they are included. There is **no procurement-export path filtering on
orderability anywhere in `lib/`**. §5's "authoritative procurement total excludes every
pending row" and §9's "procurement-export gate" therefore require **creating** an
orderable-subset object, not just tagging rows.

Other prose-only exclusion assertions: `structuralProjection.ts:360–365`,
`groundingAuthority.ts:521` (`excludedFromProcurementTotals`), `bomForPermit.ts:85–88, 857,
896`, `electricalPages.ts:302, 894`.

Note: `deriveStructuralBom()` (`lib/permit/snapshot/structuralBom.ts:97–217`) does **not**
feed SCHED-3 — it is snapshot/reconciliation only (`reconcileStructuralBom` at `:222`
cross-checks it against `calcRackingBOM`), and its `StructuralBomRow` type (`:28–41`) has
no orderability field. Do not repair §5 there.

### §6 — SCHED branch "PASS" semantics
**Classification: labeling gap. The tri-state logic is correct; the column name and the
missing companion status lines are the defect.**

Emitter: `lib/permit/sections/structuralPages.ts:1656–1674`, `_schedBranchStatus()`. It is
already a genuine tri-state via `evaluateCompliance()` / `complianceBadge()`. Its `checks`
array contains **only** electrical-rating checks:
```
continuous ≤ OCPD (NEC 240.4)
devices ≤ mfr per-branch limit
OCPD ≤ mfr branch max
```
All three pass ⇒ `✓ PASS`. **There is no logic bug** — the badge is truthfully reporting
ampacity/device-rating. The lie is the generic column label.

The tri-state itself is canonical and sound: `lib/permit/snapshot/complianceState.ts:26`
`type TriState = 'PASS' | 'FAIL' | 'PENDING-REVIEW-REQUIRED'`; `evaluateCompliance()` `:85–106`
(FAIL dominates PENDING at `:99–101`); `COMPLIANCE_LABEL` `:110–114`; `complianceBadge()`
`:128–133`.

Column headers to rename (`AMPACITY / DEVICE-RATING RESULT`) and section titles to fix:
- `structuralPages.ts:1741` — single-system SCHED AC Branch Circuit Schedule header
- `structuralPages.ts:1739` — its section title, hardcoded
  `AC Branch Circuit Schedule &mdash; NEC 690.8(A) / 705.12` ← **also a §6 topology defect**
- `structuralPages.ts:1709` — per-sub (hybrid) variant header, `_schedSubWireBlock()`
- row emitters: `:1683–1688` (single) and `:1701–1705` (per-sub)
- `structuralPages.ts:1724`, `:1841` — DC-string variants (`_schedStringStatus` `:1675–1681`)
- `lib/permit/sections/electricalPages.ts:369` — PV-4A branch rating table
  (`pv4aBranchRatingTable` `:335–373`, own copy of the same pattern, badge at `:363`)

None of `"AMPACITY / DEVICE-RATING RESULT"`, `"ELECTRICAL RATING ONLY"`, or
`"OVERALL RELEASE"` exists anywhere in the repo — §6 is entirely unimplemented.

Contrast: **E-1's sectioned physical schedule already does this right** — it renders
`req 20.00A cont · PASS` *inside* the ampacity-chain cell and a separate honest
`PENDING — REVIEW REQ'D` in its status column (tri-state helper at
`electricalPages.ts:132`, colour map `:220`).

**What per-branch authority is actually derivable at HEAD (no fabrication):**

All three authorities are **already in scope at the branch-row call site** — no plumbing
needed for the global values (`_schedSnap = peekSnapshot(input)` `structuralPages.ts:1613`;
`_schedPS = _schedSnap?.electrical?.procurementSufficiency` `:1630`; blockers `:1619–1623`).

| authority | shape | per-branch? | honest per-branch render at HEAD? |
|---|---|---|---|
| route length | `routeVerificationStatus()` `electricalProjection.ts:159–177`, weakest-wins collapse at `:171`; there is exactly ONE `BRANCH_RUN` segment for all 3 branches (`BRANCH_SEGMENT_IDS` `:204`; `build.ts:863–879`) | **verification state = GLOBAL**; but `BranchCablePath.lengthProvenance: 'geometry-derived' \| 'estimated'` **is** per-branch (`types.ts:310`, populated `build.ts:806–812`, plus `derivation` `:312` / `provenance` `:313`) | **Per-branch length PROVENANCE: yes.** Per-branch verification STATE: **no** — `build.ts:878` hardcodes `'cad-derived-estimate'` on the single segment. Render one schedule-level route-authority line. |
| grounding | `GroundingAuthorityResult` `groundingAuthority.ts:307–366`, built `:412–530`; `appliesTo: 'open-air-microinverter-branch-cable-section'` `:309`; single `outcome` `:337` / `verificationStatus` `:338` / `renderLabel` `:341` / `bomRowState` `:359` | **GLOBAL, branch-SCOPED**: `branchIds[]` `:351` + `segmentIds[]` `:352`, populated `:513–514` | **Yes as a per-row line, but the SAME value on every branch.** Legitimate: for each branch in `branchIds`, print the one global outcome. A branch-*varying* grounding status would need new fields — do not fabricate. |
| procurement sufficiency | `ProcurementSufficiency` `types.ts:~400–430`, built `procurementSufficiency.ts:149–229`; `perBranch[{branchId,branchLabel,dropCount,designedInstalledLengthFt,procurementLengthFt}]` `:168–171`; `affectedBranchIds` `:186–192` | **GENUINELY PER-BRANCH** | **Yes, fully — no new fields.** Already consumed per-branch at `electricalPages.ts:899` and `reviewStatus.ts:102`. **Caveat: the Σ deficit is NOT apportioned per branch** — render "BRANCH AFFECTED / NOT AFFECTED", never "this branch is short by N ft". |
| overall release | registry-derived | global | `OVERALL RELEASE: BLOCKED` |

So: 1 genuinely per-branch (procurement), 1 uniform-but-branch-scoped (grounding),
1 provenance-only (route), 1 global. Do **not** invent per-branch route or grounding
verification states, and do **not** apportion the Q-Cable deficit per branch.

**NEC 705.12 on a supply-side project (`705.11` selected — 46 vs 12 occurrences).**

Topology selector to use: `resolveInterconnection(input, cad)`
`lib/permit/sections/electricalPages.ts:67–117`; the predicate is `:87`
`const isSupplySide = snap.project.interconnection.rule === '705.11';`, publishing
`necArticle` at `:101`. Canonical field set at `lib/permit/snapshot/build.ts:1405`.
Legacy string-sniffing accessor `isSupplySideInterconnection()`
(`lib/permit/utils/helpers.ts:162–170`) — used by `fieldLabels.ts:190`; prefer the
snapshot-backed one.

Classification of the 12 rendered `705.12` occurrences:

| sheet | emitter | verdict |
|---|---|---|
| SCHED | `structuralPages.ts:1739` — `AC Branch Circuit Schedule — NEC 690.8(A) / 705.12` | **INAPPLICABLE — hardcoded, no topology gate. Ray's §6 target.** |
| SCHED-3 | `structuralPages.ts:1559` — `Electrical items are sized per NEC 690.8, 705.12, 310.15 …` | **INAPPLICABLE — hardcoded BOM-summary literal.** |
| PV-0 note 17 | `lib/permit/utils/titleBlock.ts:235` | **INAPPLICABLE — unconditional** (contrast `:219–220`, which DOES branch correctly) |
| PV-0 note 18 | `titleBlock.ts:238` — `NEC 705.12(B)(2)(3)(e)` | **INAPPLICABLE — unconditional** |
| PV-5 L-11 | `lib/permit/utils/fieldLabels.ts:168` fallback → `NEC 2017 705.12(D)(2)(3)(b)` | **SANITIZER BYPASS BUG — see below** |
| PV-5 "PER CODE(S)" + L-14 | `fieldLabels.ts:164–165` → `NEC 2020 705.11 / 705.12(A)` | legitimate (`705.12(A)` classified `'supply'` at `:123`) |
| PV-0, PV-4A ×2, PV-4B ×2 | `titleBlock.ts:219`; `electricalPages.ts:624, 639, 1054, 1098` | legitimate — each explicitly states 705.12(B) does **not** apply |

**New defect found in passing — PV-5 topology sanitizer bypass.** `fieldLabels.ts` has a
correct topology filter (`necSectionSide()` `:120–127`, `filterSectionByTopology()`
`:131–145`, applied `:163–165`), but the fallback at `:168`:
```ts
return parts.join('  ·  ') || (codeRefs[0] ? `${codeRefs[0].code} ${codeRefs[0].section}` : '');
```
When the filter strips the *only* NEC clause and no IFC ref exists, it falls back to
**`codeRefs[0]` unfiltered**. Dataset entry `backfeed-breaker-do-not-relocate`
(`lib/data/placards/field-placards-research.json`) has
`codeRefs[0] = { code: 'NEC 2017', section: '705.12(D)(2)(3)(b)' }` → a load-side-only
clause prints on a supply-side design. The label's own `required` flag is correctly `false`
(side gate `:71–74, 81–85, 247`) — only the citation string leaks. Assign to WS-2 §6.

### §7 — legacy PV-4B project-level EGC row
**Classification: stale renderer-local hardcoded row + wrong-object field reuse.**

Emitter: `lib/permit/sections/electricalPages.ts:853–860` — a literal `<tr>` appended to
the PV-4B conductor schedule:

```html
<tr style="background:#fff">
  <td class="fw7">EGC</td>
  <td>Array</td><td>${_ic.isSupplySide ? 'AC Disconnect (ground bus)' : 'Main Panel'}</td>
  <td>${_ic.feederEgcGauge} bare Cu</td>
  <td>—</td><td>—</td><td>—</td>
  <td>${_feedConduit}</td>
  <td>${_feedLenTxt}</td>
</tr>
```

Rendered at HEAD:
`EGC | Array | AC Disconnect (ground bus) | #10 AWG bare Cu | — | — | — | PVC Sch 80 1-1/4" | 20 ft`

Why it "reconciles with nothing":
- `groundingSegmentId`: **absent** — it is not a canonical `GroundingSegment` at all.
- size: `_ic.feederEgcGauge` — the **feeder** EGC scalar, relabelled "Array → AC Disconnect".
- raceway `PVC Sch 80 1-1/4"` and length `20 ft` are `_feedConduit` / `_feedLenTxt` —
  **the immediately preceding feeder row's own values, reprinted verbatim.** The row
  inherits the feeder's physical run and presents it as a grounding run. That is the tell.
- ampacity / OCPD / VD are hardcoded `—`.

Delete and replace with projected `GroundingSegment` objects. Note `electrical.groundingObjects`
already exists with `purpose` discriminators (`branch-egc`, `gec`, …) and the open-air row
already renders a real id (`GRN-OPENAIR-12`) — so the canonical shape to project onto is in
place.

### §8 — sealing-cap quantity renders a certain zero
**Classification: type gap — the BOM row's `quantity` is `number`, so "PENDING" is
inexpressible; the code computes a hard 0 and prints it.**

Emitters: `lib/bom-engine-v4.ts:851–871` (single-system) and `:2228–2246` (per-sub hybrid).

```ts
const _orderedDrops    = plan.dropCount;
const _occupiedDrops   = trunkDeviceCount;                              // one drop per micro
const _establishedUnused = Math.max(0, _orderedDrops - _occupiedDrops); // 0 on a drop-count order
items.push(addItem('ac', 'sealing_cap', …,
  `… — QUANTITY PENDING (topology-derived, NOT 1-per-branch): …`,
  _establishedUnused, 'ea', …));
```

The **description** says `QUANTITY PENDING`; the **quantity argument** is a computed hard
`0`. Rendered SCHED-2 row 27: `Q-SEAL-10 | 0 | ea`. The reasoning in the comment is sound
(a drop-count order leaves zero *modelled* surplus) — but "zero modelled" is being printed
as "zero required", and field service-loop / dead-drop caps are explicitly unmodelled.

`nonOrderable` is **not** the right fix here: the row is not non-orderable, its quantity is
unknown. Needs a new state on the row type (e.g.
`quantityState: 'established' | 'pending'`) plus renderer support at
`structuralPages.ts:1524–1527`, so the cell can print `PENDING` or
`0 MODELED / FIELD QUANTITY PENDING`. The row currently renders only an `OPT` badge
(`structuralPages.ts:1507–1509`, from `required: false`) — which reads as "optional", not
"pending".

Terminators are a separate canonical type already and are correctly derived from
cable-end objects (`bom-engine-v4.ts:840–848`, ids `B1-END`…`B3-END`) — keep separate.

### §9 — Q-Cable BOM row itself carries no state
**Classification: labeling gap. Same mechanism as §5; row not enrolled.**

Emitter: `lib/bom-engine-v4.ts:820–824`:
```ts
items.push(addItem('ac', 'trunk_cable', system.brand, `${system.ecosystem}${orientLabel}`,
  cable.sku, `AC trunk — 1 drop per micro @ ${cable.connectorSpacingFt} ft pitch (≈${plan.approxFeet} ft procurement …)`,
  plan.dropCount, 'ea', 'NEC 690.31', 'one connector-drop per device', `${trunkDeviceCount} drops`, true));
```
Per-sub twin at `:2211`. Rendered SCHED-2 row 29: `Enphase | IQ Q-Cable (portrait) |
Q-12-10-240 | 31 | ea` — no `nonOrderable`, no deficit, no reason.

`bom-engine-v4.ts` has **no access to `procurementSufficiency`** (it is a pre-snapshot
engine). The correct seam is a **post-pass in `bomForPermit.ts`**, exactly mirroring §5e
(`bomForPermit.ts:885–899`): read `projectProcurementSufficiency(...)` /
`snapshot.electrical.procurementSufficiency`, and when `insufficient`, stamp the
`trunk_cable` row(s) with `nonOrderable: true` + a reason string carrying
`QCABLE-PROCUREMENT-INSUFFICIENT`, designed-installed ft, current base ft, deficit ft, and
`EXTENSION SOLUTION: NOT SELECTED`. Keep `Q-12-10-240` visible (Ray: keep the selected
cable identity).

### §10 — "APPROVED DESIGN" on PV-5
**Classification: labeling gap — a working issue-state accessor exists and PV-5 bypasses it.**

Three occurrences at HEAD; only one is the PV-5 literal Ray cites.

| # | sheet | emitter | rendered text |
|---|---|---|---|
| 1 | **PV-5** | **`lib/permit/sections/compliancePages.ts:435`** (inside the `note-bar` `:431–436`; PV-5 titleBlock `:428`) | `RATED VALUES ON THIS SHEET ARE SITE-COMPUTED FROM THE APPROVED DESIGN &mdash; DESIGN LOW TEMP ${tMinC}&deg;C (…)` — **Ray's primary target** |
| 2 | PV-5 | `lib/permit/sections/compliancePages.ts:495` | `2. Any deviation from the approved design shall be reported to the engineer of record.` |
| 3 | CERT | `lib/permit/sections/certPages.ts:225` | `… Any deviation from the approved design must be reported to the engineer of record prior to installation.` |

(2) and (3) are contractor-deviation boilerplate, but Ray's permanent gate 14 forbids
approved-design language package-wide while pending — a naive scan will flag all three.
Reword to "the design of record as issued for review" or gate them identically.

**Three additional emitters exist on code paths this project does not reach** and will
regress the gate on fence / ground-mount / other roof jobs — fix them in the same pass:
`certPages.ts:432` (fence PE letter), `:541` (ground PE letter), `:742` (roof PE letter
variant).

The second `SITE-COMPUTED` occurrence — `REQUIRED LABELS — 1 SITE-COMPUTED + 10 STANDARD
(12 OF 19 DATASET LABELS APPLY)` (`compliancePages.ts:443`) — is a legitimate label-count
and must not be touched. `lib/permit/utils/fieldLabels.ts` contains **no** approved-design
language: §10 is entirely `compliancePages.ts` + `certPages.ts`.

**A canonical, digest-bound issue-state machine already exists — PV-5 simply does not
import it.**

- states: `PROJECT_ISSUE_STATES` `lib/permit/snapshot/projectAuthority.ts:33–42`
  (`DESIGN DRAFT` … `ISSUED FOR PERMIT` | `REVISED`); type `:43`
- derivation: `deriveIssueState(ctx)` `projectAuthority.ts:136`ff — digest-bound
  (`reviewCoversCurrentDigest = ctx.review.reviewedDigest === ctx.currentDigest`, `:143`);
  a stale approval degrades to `REVISED` (`:153–157`)
- **the accessor**: `projectProjectAuthorityFromInput(input)`
  `lib/permit/snapshot/projectAuthorityProjection.ts:166–168` →
  `.issueStatus` (`:146`, interface `:59`, raw accessor `case 'issue-status'` `:121`)
- validator-enforced: `lib/permit/snapshot/validate.ts:657–659` (V33 stored ≠ derived),
  `:665–668` (V34 — `REVIEWED`/`PERMIT-READY`/`ISSUED FOR PERMIT` require a review bound to
  the current digest), `:671`, `:728–730` (V37)

Consumers today: `coverSheet.ts:17, 43, 47, 441, 595, 617, 718`; `certPages.ts:31` +
local wrapper `issueStateLabel(input)` `:55–58` used at `:108, 213`; `reviewStatus.ts:26,
68, 69, 173`; `titleBlock.ts:11, 70`.
**Non-consumers: `compliancePages.ts` (PV-5) — no such import anywhere in its import block
(lines 6–27); and `structuralPages.ts` (SCHED), which re-derives its own blocker gate from
`permitReadiness.registry` instead (`_schedHasBlockers` `:1619–1623`, used `:1883–1885`,
`:1900–1902`).**

So §10 = "route PV-5 through the existing accessor" for the authority, **plus one new thin
string helper**: there is no shared issue-state *language* function today. `coverSheet.ts:617`
and `structuralPages.ts:1901` each hand-roll the phrase "DESIGN REVIEW PACKAGE" from
different inputs. Ray's "one issue-state language accessor used by every sheet" therefore
needs a new formatter over the existing `issueStatus` — not a new authority.

---

## 2. Cross-cutting findings

1. **Two rendering stacks, one authority layer — THE headline finding.**
   `lib/permit/sections/*` is wired to the snapshot projections. `lib/drafting/*` (PV-1,
   PV-3 and the CAD templates) is fed a flat descriptor built at
   `lib/drafting/sheetComposition.ts:386–517` and is **not** wired:
   `grep spacingAuthority lib/drafting` ⇒ 0 hits; neither drafting file imports
   `projectFastenerAssembly` or `evaluateDocumentApplicability`. §3 and §4 are entirely
   this, and it explains why four consecutive authority campaigns all "landed" while PV-3
   kept lying.
   The fix is cheaper than it looks: `roof.ts:2027` **already calls**
   `projectStructural(ctx?.snapshot)` — it just reads the wrong field. Snapshot access
   exists; only the field reads and the descriptor type need changing.
   **Recommend a standing structural rule: an authority projection is not "landed" until
   the `lib/drafting` descriptor consumes it, and a grep of `lib/permit/sections` alone is
   never sufficient evidence.**

2. **Legacy field names encode the lie.** `_ca.maxAllowedSpacing`
   (`sheetComposition.ts:504`) is the §3 root cause. Renaming/retyping it to carry
   `SpacingAuthority` kills the whole finding class at the source.

3. **State computed then discarded at a type boundary.** §5 is not a missing
   classification — `calcRackingBOM` already sets `pending`/`orderable:false`
   (`structural-engine-v4.ts:1081–1096`) and `emitRackingBOMInto` drops them
   (`bom-engine-v4.ts:567–576`) because the intermediate type has no field for them.
   **Audit rule: any authority state that crosses `RackingBOMRow → BOMLineItemV4 →
   PermitBOMItem` must be declared on all three.** The renderer cast
   `(item as { nonOrderable?: boolean })` at `structuralPages.ts:1524` is the smell that
   marks this.

4. **Prose-only exclusions.** "EXCLUDED from the authoritative procurement totals" is
   asserted in prose at `structuralPages.ts:1567` and in row descriptions, but no computed
   orderable total or export subset exists anywhere in `lib/`. Worse, the sentence
   enumerates only the 2 tagged rows, which actively tells the reader the 7 pending racking
   rows are included. §5 gate 7 and §9 gate 13 cannot be honestly satisfied without
   building one.

5. **Fabricated-from-adjacent-value derivations.** `_torque` and `_pilot`
   (`roof.ts:2437–2438`) are derived from the fastener diameter with no source document —
   a pattern that manufactures authority out of an unrelated dimension. Worth a dedicated
   gate: no installation parameter may be derived from another dimension without a cited
   document.

6. **Harness gates written against phrase lists, not assertion classes.** The §1 miss
   (`planset-evidence-bar.mjs:286`) is the proof. New gates must assert on the *class*
   (any installed-EGC assertion; any exact fastener dimension; any orderable pending row),
   never on an enumerated set of strings.

---

## 3. REPAIR PLAN

Two parallel workstreams. **WS-1 electrical / grounding / BOM: §1, §2, §7, §8, §9.**
**WS-2 structural / procurement-language: §3, §4, §5, §6, §10.**

### WS-1 — electrical, grounding, BOM state

| step | change | files |
|---|---|---|
| 1.1 | §1a — `projectE1PhysicalSchedule()` branch section must consume `projectOpenAirBranchGrounding()`. When `outcome === 'PENDING_MANUFACTURER_AUTHORITY'`, `bonding` renders `OPEN-AIR GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY / INSTALLED OPEN-AIR EGC: NOT ASSERTED`. Never derive from `groundingObjects[].conductorSize` directly. | `lib/permit/snapshot/electricalProjection.ts:901–932` |
| 1.2 | §1b — gate E-1 grounding notes 2 + 3 on the same authority; note 3's raceway claim must not apply to the free-air section. Keep the 6 grounding objects distinct (do not print the feeder EGC as a project minimum). | `lib/permit/sections/electricalPages.ts:1185–1186` |
| 1.3 | §2 — replace the single hardcoded `payloadBlock` with **schema dispatch keyed on canonical blocker type**. Add a grounding payload template (micro SKU, Q-Cable SKU, authority result, verification state, applicable doc, doc hash, applicability, equipment classification, candidate EGC qty + orderability, resolution action, affected segment ids). Remove the hardcoded literal `null` at `:103`. | `lib/permit/sections/reviewStatus.ts:89–104, 121` |
| 1.4 | §7 — delete the hardcoded EGC `<tr>`; project canonical `GroundingSegment` rows. No grounding row renders without a `groundingSegmentId`. Stop reusing `_feedConduit` / `_feedLenTxt`. | `lib/permit/sections/electricalPages.ts:853–860` |
| 1.5 | §8 — add `quantityState: 'established' \| 'pending'` (or nullable quantity) to the BOM row type; set `pending` on sealing caps; render `PENDING` / `0 MODELED · FIELD QUANTITY PENDING`. Keep terminators separate. | `lib/permit/utils/bomForPermit.ts:80–95`; `lib/bom-engine-v4.ts:851–871`, `:2228–2246`; renderer `lib/permit/sections/structuralPages.ts:1524–1527` |
| 1.6 | §9 — new §5f post-pass in `bomForPermit.ts` mirroring §5e: on `procurementSufficiency.insufficient`, stamp `trunk_cable` rows `nonOrderable: true` + STATUS / REASON / DESIGNED-INSTALLED / CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT SELECTED. Keep the selected cable identity. | `lib/permit/utils/bomForPermit.ts` (after `:899`) |
| 1.7 | Tests + gates: installed-EGC-assertion class gate; blocker-code→payload-schema mapping test (every code); no-grounding-row-without-segmentId gate; pending-cap-cannot-render-certain-zero gate; insufficient-Q-Cable-row-non-orderable gate. Extend `scripts/planset-evidence-bar.mjs` (replace the phrase-list check at `:286`). | `tests/planset/*`, `scripts/planset-evidence-*.mjs` |

**WS-1 must also add a procurement-insufficient test input** (see §0) or 1.3/1.6 gates pass
vacuously on the frozen fixture. Do not modify
`tests/fixtures/braidon-original-audit-fixture.ts`.

### WS-2 — structural, procurement classification, language

| step | change | files |
|---|---|---|
| 2.1 | **§3/§4 foundation — thread the authorities into the drafting descriptor.** Replace `attachSpacing: number` with the canonical `SpacingAuthority` (already available as `projectStructuralFromInput(input).spacingAuthority`, wired at `structuralProjection.ts:302`); replace `lagSpec`/`embedSpec` with `FastenerAssembly` (`projectFastenerAssembly()` `structuralProjection.ts:384`) + `evaluateDocumentApplicability()` (`lib/manufacturer-assets-db.ts:232`). Follow the existing `conduitType` precedent at `:512`. **Retire the `_ca.maxAllowedSpacing` source** — the field name is the §3 root cause. In `roof.ts` the snapshot is already in hand at `:2027`; only the field read (`:2029–2033`, `:2042–2048`) is wrong. | `lib/drafting/sheetComposition.ts:390–400` (type), `:459–465`, `:504–509` (build); `lib/drafting/templates/roof.ts:2027–2048` |
| 2.2 | §3 — every spacing emitter renders `designLabel` + `statusLabel`. No MAX/MAXIMUM/allowable/approved spacing unless `verificationState === 'verified'`. Also kill the rail-less hardcoded `48"` literals and fix the same-sheet `4'-0"` vs `48"` unit split. | `lib/drafting/sheetComposition.ts:722, 723, 753, 760, 783, 809`; `lib/drafting/templates/roof.ts:2422, 2494`; PV-1 spacing assertions `roof.ts:1649, 1773, 1887–1888` |
| 2.3 | §4 — while fastener assembly or document applicability is unverified, print NO exact diameter / length / **embedment** / **torque** / **pilot** / **coating** / sealant / mfr instruction. Render the 4 required PENDING lines. **Delete the two fabricated diameter-conditional derivations** (`_torque` `:2437`, `_pilot` `:2438`) — they invent authority. Mirror the working PV-4C.1 / SCHED / APP-A / PE-1 pattern. | `lib/drafting/sheetComposition.ts:508, 509, 761, 762, 788, 789`; `lib/drafting/templates/roof.ts:2361, 2371, 2372, 2427, 2437, 2438, 2441–2446, 2449–2454, 2492, 2493, 2512` |
| 2.4 | §4 leak — gate `structuralPages.ts:977` (PV-4C.1 note 5) `8–12 ft-lbs / 15–20 ft-lbs`; it sits between two already-gated lines. | `lib/permit/sections/structuralPages.ts:977` |
| 2.4b | §3/§4 latent — VAL-1 spacing reads (`canonical.structure.attachSpacingIn`, default `|| 48` at `canonical.ts:310`). Fix or they regress the gate on other sheets. Also fix the `sheetId: 'PV-2'` mis-attribution at `sheetComposition.ts:798`. | `lib/permit/sections/validationPage.ts:119, 612`; `lib/drafting/sheetComposition.ts:798` |
| 2.5a | §5 **root fix — stop discarding the flags.** Add an orderability field to `BOMLineItemV4` and declare it on `PermitInput['bom']` (kills the renderer cast). Propagate `RackingBOMRow.pending` / `.orderable` through `emitRackingBOMInto` → `addItem` → `v4ToPermit`. | `lib/bom-types-v4.ts:23–46`; `lib/permit/types.ts:426–451`; `lib/bom-engine-v4.ts:560–586` (+ per-sub twin `:2775, :2790`), `:3040–3080`; `lib/permit/utils/bomForPermit.ts:156–179` |
| 2.5b | §5 — **withhold manufacturer + SKU on pending rows** (today `mfr` is passed unconditionally and the renderer has no predicate on those cells). Add the mount-base `racking` lot line to the `railUnpinned` gate list so `RT-MINI-01` is never an authoritative selected SKU (snapshot already says `mountSku: null`). | `lib/structural-engine-v4.ts:1081–1096` (extend `gate()` list); `lib/bom-engine-v4.ts:566–576`; renderer predicate on Manufacturer/Part Number cells `lib/permit/sections/structuralPages.ts:1518, 1520` |
| 2.6 | §5 — **build the authoritative procurement total / orderable export subset** (prose-only today; the current sentence at `:1567` names only `wire, lag bolt` and thereby asserts the 7 pending racking rows ARE included). Exclude every non-orderable and every `quantityState:'pending'` row; keep `TOTAL LINE ITEMS` as a distinct count. | `lib/permit/sections/structuralPages.ts:1544–1571` + a new orderable-subset projection |
| 2.7 | §6 — rename the branch Status column to `AMPACITY / DEVICE-RATING RESULT`; badge value `PASS — ELECTRICAL RATING ONLY`; add companion lines: route authority PENDING (schedule-level + per-branch length *provenance* only), grounding authority PENDING (naming `branchIds`, same value each row), procurement sufficiency AFFECTED/NOT AFFECTED (genuinely per-branch, **no per-branch ft apportionment**), `OVERALL RELEASE: BLOCKED`. All three authorities are already in scope at `:1613/:1630/:1619`. | `lib/permit/sections/structuralPages.ts:1683–1688, 1701–1712, 1724, 1741, 1841`; `lib/permit/sections/electricalPages.ts:335–373` |
| 2.8 | §6 — topology-driven code references via `resolveInterconnection().necArticle` (`electricalPages.ts:87, 101`). Gate the 4 unconditional emitters: `structuralPages.ts:1739` (section title), `:1559` (BOM summary), `titleBlock.ts:235`, `:238`. **Plus fix the `fieldLabels.ts:168` sanitizer-bypass fallback** (strips the only NEC clause then falls back to `codeRefs[0]` unfiltered → load-side `705.12(D)` on PV-5). Leave the 5 legitimate 705.12(B)-not-applicable statements. | `structuralPages.ts:1739, 1559`; `lib/permit/utils/titleBlock.ts:235, 238`; `lib/permit/utils/fieldLabels.ts:168` |
| 2.9 | §10 — route PV-5 through `projectProjectAuthorityFromInput(input).issueStatus` (`projectAuthorityProjection.ts:166/:146`) and add the **new shared issue-state language formatter** (none exists; `coverSheet.ts:617` and `structuralPages.ts:1901` hand-roll it). Render `SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED`. Reword the 2 contractor-deviation occurrences **and the 3 unreached PE-letter variants**. Leave `compliancePages.ts:443` (label count) alone. | `lib/permit/sections/compliancePages.ts:435, 495`; `lib/permit/sections/certPages.ts:225, 432, 541, 742`; new formatter beside `projectAuthorityProjection.ts` |
| 2.10 | Tests + gates: no-unsupported-MAX-spacing (whitelist the canonical `statusLabel` only); pending-fastener-cannot-render-exact-dims; unverified-RT-MINI-II-cannot-authorize; pending-racking-excluded-from-totals; no-candidate-SKU-in-totals; verified-selection-auto-regenerates; generic-PASS-cannot-hide-branch-blockers; supply-side-no-load-side-citations; no-approved-design-while-pending. | `tests/planset/*`, `scripts/planset-evidence-*.mjs` |

### Shared-file conflict notes and ownership decisions

Three files are touched by both workstreams. Ownership is assigned by **file**, not by
finding, wherever a split would produce merge churn:

1. **`lib/permit/sections/structuralPages.ts` — the real conflict.** WS-1 needs the BOM
   quantity-cell renderer (`:1524–1527`) and the BOM summary (`:1553–1571`) for §8. WS-2
   needs the SCHED branch tables (`:1683–1745`) for §6, the fastener note block (~`:970`)
   for §4, and the same BOM summary region (`:1544–1571`) for §5/§6.
   **Decision — split by line region with a hard boundary, and sequence the BOM region:**
   - WS-2 owns `:1–1000` (PV-3/PV-4C fastener + spacing) and `:1650–1900` (SCHED schedules).
   - The BOM region `:1490–1580` is **shared**. WS-1 lands **first** (small, mechanical:
     one new state in the quantity cell + one summary clause); WS-2's §5/§6 total-exclusion
     work rebases on it. WS-1's BOM-region edit must be a **separate commit** so WS-2 can
     rebase cleanly.
   - **Ray's question — SCHED branch-status to WS-2 and SCHED-2/3 BOM rows to WS-1?
     Answer: yes, with one amendment.** The split is correct, because the *root* edits
     diverge entirely: WS-1's §8/§9 roots are in `bom-engine-v4.ts` + `bomForPermit.ts`
     (WS-1-exclusive), and WS-2's §5 root is in `structuralBom.ts` (WS-2-exclusive).
     `structuralPages.ts` is only the shared *render* surface. The amendment: **§5's
     total-exclusion work (2.6) also lives in the shared BOM region**, so it must follow
     WS-1's 1.5, not precede it.
2. **`lib/permit/sections/electricalPages.ts` — assign entirely to WS-1.** WS-1 owns it for
   §1b (`:1185–1186`) and §7 (`:853–860`). §6's E-1 mfr-limit branch table
   (`:358–372`) and §6's 705.12 busbar block (`:1058`) are nominally WS-2 work but sit in
   a WS-1 file. **Move both into WS-1** (steps 1.2b / 1.4b) rather than splitting the file;
   WS-2 keeps the SCHED-side §6 work and the cross-package 705.12 sweep policy.
3. **`lib/permit/utils/bomForPermit.ts` — assign entirely to WS-1**, including the racking
   post-pass hook for §5. WS-2 supplies the racking classification *from*
   `structuralBom.ts` and WS-1 wires the post-pass. Rationale: §5d/§5e/§5f are one
   contiguous post-pass block; two workstreams editing consecutive post-passes in the same
   function will conflict on every line.

No conflict on: `electricalProjection.ts`, `reviewStatus.ts`, `bom-engine-v4.ts` (WS-1
only); `lib/drafting/sheetComposition.ts`, `lib/drafting/templates/roof.ts`,
`structuralBom.ts` (WS-2 only).

**Suggested landing order:** WS-1 1.1–1.4 and WS-2 2.1–2.4 fully parallel → WS-1 1.5/1.6
(BOM state, includes the shared-region commit) → WS-2 2.5–2.8 (rebased) → 2.9 → both 1.7 /
2.10 → closer (regen, 18 gates, deliverables).

---

## 4. Not reproducing / directive corrections (honest list)

1. **§4 torque literal `6-12 ft-lb` DOES NOT EXIST** anywhere in source or render. Actual:
   `8–12 FT-LBS` (en dash U+2013) at `lib/drafting/templates/roof.ts:2437`, and
   `8–12 ft-lbs` at `lib/permit/sections/structuralPages.ts:977`. Both are *fabricated from
   the fastener diameter*, which is the real defect.
2. **§4 `NO PILOT` DOES NOT EXIST in the render.** PV-3 prints the **opposite**:
   `PILOT HOLE: 7/32" DIA — RAFTER CENTER` (`roof.ts:2438`, `:2443`) — while the authority
   says `pilotHoleRequired: false` / `'no pilot hole'` (`rackingAssembly.ts:585`). Upgrade
   this from "ungated instruction" to **"ungated instruction contradicting the snapshot"**.
3. **§4 `on file` ×11 attributing PV-3 instructions to the RT-MINI II manual — DOES NOT
   REPRODUCE AS STATED.** Lowercase `on file` renders 10× and **none are on PV-3** (they are
   on the E-sheet, APP-A, CERT, PE-1 — all legitimate datasheet-availability statements).
   PV-3's citation is the **uppercase** `ON FILE`, exactly **1** occurrence
   (`structuralPages.ts:74`), and it **IS** applicability-gated (`:77–79`). The citation is
   gated; the instructions it purports to cite are not.
4. **§4 "2 screws per mount" screw counts — DO NOT REPRODUCE on PV-3.** There is no
   screw-count text on PV-3 at all. The `2 per pad` / `2 per mount × 64 mounts` strings
   (`mounting-hardware-db.ts:626`, `bomForPermit.ts:902`) are **already suppressed** by the
   fastener gate on APP-A. They appear only in stale pre-HEAD artifacts.
5. **§4 embedment count** — directive implies 7. Actual: `EMBEDMENT` uppercase renders 5×,
   lowercase `embedment` 5× (10 case-insensitive). One of the 7 `5/16` hits is an **HTML
   comment** in `compliancePages.ts`, not visible text.
6. **§4 new sub-finding** — `roof.ts:2441` asserts a `316 SS` **coating** while
   `FastenerAssembly.material` is an honest `null` (`structuralProjection.ts:409`). Add
   coating to the withheld-fields list.
7. **§3 the WS-C spacing pass reached FOUR sheets, not two** — PV-4C.1, PV-4C, APP-A **and
   PE-1**. `DESIGN ATTACHMENT SPACING` renders **1×**, not 2 (only PV-4C.1 prints it
   verbatim; the others print `designSpacingIn` + a verification tag).
   `PENDING STRUCTURAL VERIFICATION` renders 2× (PV-4C.1, APP-A); PV-4C and PE-1 use the
   abbreviated `PENDING VERIF.`.
8. **§3 residual** — PV-4C.1 note 6's `MAXIMUM ALLOWED` sits inside an explicitly negating
   clause and is currently truthful; a naive package-wide MAX gate will false-positive.
9. **§5 was NOT a labeling gap — it is a flag-propagation loss.** `RackingBOMRow.pending` /
   `.orderable` are **already set correctly** by `calcRackingBOM`
   (`lib/structural-engine-v4.ts:1081–1096`) and then **discarded** by
   `emitRackingBOMInto` (`lib/bom-engine-v4.ts:567–576`) because `BOMLineItemV4`
   (`lib/bom-types-v4.ts:23–46`) has no orderability field. This materially changes the fix.
10. **§5 "authoritative procurement total"** does not exist to be excluded from — only
    `TOTAL LINE ITEMS` (a count including pending rows) plus a prose note that currently
    names only `wire, lag bolt`, thereby **asserting the 7 pending racking rows ARE
    included**. Must be built, not corrected.
11. **§5 `IRONRIDGE` ×1 is a false positive** — it is inside an **HTML comment** in the
    racking-summary block ("The old static table printed IronRidge FlashFoot2 …"), not a
    data leak. Do not chase it.
12. **§2 selection mechanism** — the directive/prompt hypothesis was a code-prefix match on
    `'QCABLE'`. Actual: **no code-based selection whatsoever**; the sole predicate is
    "payload is a non-null object" (`reviewStatus.ts:91`).
13. **§6 per-branch route + grounding statuses are NOT per-branch-derivable at HEAD.** Route
    has per-branch *provenance* (`BranchCablePath.lengthProvenance`) but a single global
    verification state (`build.ts:878` hardcodes it). Grounding is one global outcome scoped
    by `branchIds`. Only procurement sufficiency genuinely varies. Also: **the Σ Q-Cable
    deficit is not apportioned per branch** — render AFFECTED / NOT AFFECTED, never
    "short by N ft" per branch.
14. **§6 new sub-finding — PV-5 topology sanitizer bypass** at `fieldLabels.ts:168`: the
    fallback returns `codeRefs[0]` **unfiltered** when the topology filter strips the only
    NEC clause, printing load-side `705.12(D)(2)(3)(b)` on a supply-side design.
15. **§7 raceway text** — directive quotes `1-1/4" PVC`; rendered text is
    `PVC Sch 80 1-1/4"`, and it is the **feeder's** `_feedConduit`/`_feedLenTxt` reprinted.
16. **§9 deficit figures do not reproduce on the frozen fixture** (166.5 / 152 / 14.5 ft →
    0 occurrences at HEAD) because `QCABLE-PROCUREMENT-INSUFFICIENT` does not fire there.
    The row-state defect does reproduce. A procurement-insufficient test input is required.
17. **§10** — 3 occurrences, only 1 is PV-5 (`compliancePages.ts:435`). The other 2 are
    contractor-deviation boilerplate; they trip gate 14 and need a decision. **Plus 3
    unreached PE-letter variants** (`certPages.ts:432`, `:541`, `:742`) that will regress
    the gate on fence / ground-mount jobs.
18. **Sheet-ID attribution bug** — `sheetComposition.ts:798` declares
    `sheetId: isPlan ? 'PV-2' : 'PV-3'` but the permit set renders that composition as
    **PV-1** (`arrayPages.ts:62`). Any sheet-scoped gate keyed on it targets the wrong sheet.
19. **Stale local artifacts — do not use as evidence.** `_tmp_head_live.html` and
    `_tmp_head_verify.html` are dated 07-23 and still contain pre-fix literals
    (`Lag bolt: 5/16" diameter minimum stainless steel`, `5/16" DIA. SS`) that no longer
    exist in source. Only `_tmp_braidon_original.html` (and this pass's regen) match HEAD.

---

## 5. AFTER — outcome per finding (closer, 2026-07-26)

Verified on the frozen fixture (`PDS-E17B052701C1`, 21 sheets, 15 blocking / 0
advisory) AND on a procurement-insufficient variant of the SAME design
(`PDS-FB5BCE6A6931`, 21 sheets, 16 blocking; Σ designed 140.5 ft + documented
allowance 26 ft = threshold 166.5 ft vs procurement 152 ft ⇒ 14.5 ft deficit).
`scripts/planset-evidence-ppc.mjs` = **18/18 gates pass in BOTH modes.**

| § | finding | AFTER |
|---|---|---|
| §1 | E-1 asserted an installed open-air EGC | **FIXED AT THE PROJECTION.** `projectE1PhysicalSchedule()` consumes `projectOpenAirBranchGrounding()`; every open-air branch row renders `OPEN-AIR GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY / INSTALLED OPEN-AIR EGC: NOT ASSERTED` (4 occurrences). `— with circuit conductors` = **0**. Outcomes A and B render their own honest results (synthetic-document tests), so the fix is "print what the authority established", not "always print PENDING". Notes 2 + 3 are authority-gated and domain-scoped; the feeder gauge is no longer presented as a project-wide minimum. Gate 1 is an assertion-CLASS scan with three non-vacuity probes. |
| §2 | RS-1 rendered the wrong blocker payload | **FIXED.** 36 codes declared in `BLOCKER_PAYLOAD_SCHEMA`; components dispatch on schema; unknown codes fail safe to generic. Frozen fixture: 15 rows, 0 `DEFICIT PAYLOAD` boxes. Insufficient input: 16 rows, exactly 1 deficit box and exactly 1 grounding box, on the right blockers. The hardcoded literal `null` is gone. |
| §3 | unsupported "maximum spacing" language | **FIXED AT THE DESCRIPTOR.** `O.C. MAX` = **0**; `MAXIMUM ALLOWED` = **0**; allowable/approved spacing = **0**. PV-1 and PV-3 both render `DESIGN ATTACHMENT SPACING: 48 IN. O.C.` + `PENDING STRUCTURAL VERIFICATION`. The `4'-0"` vs `48"` same-sheet unit split = 0. The legacy `maxAllowedSpacing` source is retired. |
| §4 | unverified fastener + RT-MINI II authority on PV-3 | **FIXED.** PV-3 renders all four mandated PENDING lines and the NON-AUTHORITATIVE banner; diameter / length / embedment / torque / pilot / coating / sealant-product / screw-count = **0 on PV-3**. The two FABRICATED diameter-keyed derivations (`_torque`, `_pilot`) are deleted from source. The detail still renders (bannered, not removed). Also fixed: the "Data Sheets — On File" racking citation now states applicability beside availability. |
| §5 | SCHED-3 racking rows showed manufacturers / SKUs | **FIXED AT THE TYPE BOUNDARY.** Canonical rows: **8 class B, 1 class C, 1 class D, 0 class A** — zero orderable while the assembly is unselected, and no row may display a manufacturer or SKU. `RT-MINI-01` as a rendered selected SKU = **0** (the registry racking LOT line is now gated too). A synthetic VERIFIED selection auto-regenerates all-class-A orderable rows through the same classifier, no code change. |
| §6 | SCHED branch "PASS" semantics | **FIXED.** Column = `AMPACITY / DEVICE-RATING RESULT`; a pass reads `PASS — ELECTRICAL RATING ONLY`; bare `✓ PASS` badge = 0. `BRANCH RELEASE STATUS` states route authority, grounding authority, procurement sufficiency and `OVERALL RELEASE: BLOCKED`. The two SCHEDULE-LEVEL authorities are stated once (repeating them read as N independent determinations); only genuinely per-branch facts are per-branch. The Σ deficit is never apportioned. Load-side-only citations on this supply-side design: `705.12(D)` 0, `705.12(B)(2)(3)(e)` 0, `705.13` 0, bare `per NEC 705.12` 0 — and the legitimate "705.12(B) does not apply" statements are preserved. |
| §7 | legacy PV-4B project-level EGC row | **DELETED.** `AC Disconnect (ground bus)` = 0. Replaced by canonical `GroundingSegment` objects, each with its own id, endpoints, raceway (or FREE AIR), length + provenance, NEC basis, authority state and BOM derivation. 11 rendered id tags, 7 distinct ids, 0 empty. Gate 10 carries a class probe fed the retired row. |
| §8 | sealing-cap quantity rendered a certain zero | **FIXED.** `quantityState: 'pending'` + `0 MODELED / FIELD QUANTITY PENDING`; the row is excluded from procurement approval. Terminators stay a separate ESTABLISHED type. |
| §9 | Q-Cable BOM row carried no state | **FIXED.** On the insufficient input the trunk row carries STATUS / REASON / DESIGNED-INSTALLED / ALLOWANCE / THRESHOLD / CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT SELECTED, is machine-tagged `data-bom-orderable="false"`, and KEEPS `Q-12-10-240`. **New in the closer:** the row originally stated only designed-vs-base, which read as arithmetically wrong once an allowance existed (`140.5 FT vs 152 FT ⇒ DEFICIT 14.5 FT`) — every term now shows. The AUTHORITATIVE PROCUREMENT TOTAL and the orderable export subset were **built** (they did not exist): 36 orderable of 48, 12 excluded, every exclusion named with part number, quantity and class. |
| §10 | "APPROVED DESIGN" on PV-5 | **FIXED.** Package-wide scan: approved design / approved plans / engineer approved / permit approved / construction approved = **0 each**. PV-5 renders `SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED`; the label-COUNT line is preserved. The CERT clause and the **three unreached PE-letter variants** (fence / ground / roof) route through `deviationReferenceLabel`, so gate 14 cannot regress on those designs. |

### Honest states carried forward (not defects — the truth of this design)

- Open-air grounding: **PENDING MANUFACTURER AUTHORITY**, installed EGC **NOT ASSERTED**, candidate quantity **NON-ORDERABLE**.
- Racking: **0 orderable rows** on the fixture (8B / 1C / 1D / 0A).
- Sealing caps: **0 MODELED / FIELD QUANTITY PENDING** — not a certain zero.
- The frozen fixture is **procurement-SUFFICIENT**; §9's numbers are proven on the second input, never asserted on the fixture.

### Known follow-ups (recorded, deliberately NOT done in this pass)

1. **HOME-RUN-EGC-PROMOTION.** The in-raceway home-run EGC renders as a PROJECTED id
   (`GRN-HOMERUN-RACEWAY-EGC`, from `routeSegments[BRANCH_HOMERUN_RUN].egcGauge`) — it is
   **not yet a first-class `GroundingRecord`** in `electrical.groundingObjects`. It
   reconciles today (own id, own raceway, own length, own NEC basis, own BOM derivation)
   and asserts nothing it cannot support, so it satisfies gate 10. Promoting it adds a
   canonical grounding record and therefore **changes the snapshot digest** — deliberately
   deferred, because a digest change late in a corrective pass invalidates every acceptance
   artifact the pass produced. Next action: add the record in `build.ts` beside the other
   grounding objects, then delete the projected fallback in `projectGroundingSegments`.
2. **GROUNDING-BOMLINEID-BACKREFERENCE.** No grounding object carries a RESOLVABLE BOM row
   id: the feeder-EGC object declares none, and the open-air object declares its own
   grounding-object id (`GRN-OPENAIR-12`) rather than a BOM row id. Both links are derived
   in `braidon-ppc-grounding-segment-bom-reconciliation.json` (by conductor identity and by
   authority label). Reconciliation is complete and unambiguous, but DERIVED is weaker
   evidence than gate 10 ultimately wants. Needs a BOM-id back-reference pass (BOM row ids
   are assigned after the snapshot is built).
3. **Live-DB evidence not regenerated.** The BRAIDON project still has 3+ duplicate rows,
   un-disambiguated. Every artifact in this pass is frozen-fixture-derived and says so; a
   live regen would silently pick one row.

### THE standing rule this pass adds

> **An authority projection is not "landed" until the `lib/drafting` descriptor consumes
> it, and a grep of `lib/permit/sections` alone is never sufficient evidence.**

That single gap — two rendering stacks, one authority layer — is why four consecutive
authority campaigns all "landed" while PV-3 kept printing exact fastener instructions and
`48" O.C. MAX`. `grep spacingAuthority lib/drafting` returned **0 hits** at baseline;
neither drafting file imported `projectFastenerAssembly` or
`evaluateDocumentApplicability`.

Two corollaries, both earned in this pass:

- **Gates must assert on the CLASS, never on a phrase list.** The §1 miss
  (`planset-evidence-bar.mjs` tested three "separate EGC" wordings) is the proof; the new
  gates carry non-vacuity probes, so a gate that cannot fire is itself a failure.
- **Any authority state that crosses a type boundary must be declared on every type it
  crosses.** §5's flags were computed correctly and then discarded because
  `BOMLineItemV4` had nowhere to put them; the renderer cast
  `(item as { nonOrderable?: boolean })` was the smell.
