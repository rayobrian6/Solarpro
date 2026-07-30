# ECD Phase 0 — Root-Cause Map (Final Planset Engine Closure)

Status: FORENSIC AUDIT COMPLETE 2026-07-26. Read-only pass over dev @ `8cf77c8e`.
Checklist = the 9 findings of `docs/ENGINE-CLOSURE-DIRECTIVE.md`. No code changed.

---

## 0. Live-vs-stale determination

**VERDICT: the artifact is LIVE at HEAD. Every one of the 9 findings reproduces
from source at `8cf77c8e`. Nothing here is a stale-deploy artifact.**

| | Live artifact | HEAD regen (fixture) |
|---|---|---|
| File | `C:\Users\Ray\Downloads\PermitPackage-BRAIDON M PILLA — Solar TEST (8).html` (1,930,349 B) | `scripts/braidon-rgm-regen.ts <out> --insufficient --identity` |
| Snapshot | `PDS-2BA7FB9D0E2D` | `PDS-E45473DCFF1C` |
| Sheets | 23 | 23 |
| Gates / requirements / advisories | 7 / 19 / 0 | 7 / 18 / 0 |
| BOM strings | `36 of 48`, `47 line items`, `44 items are required`, `12 EXCLUDED` | **identical, byte-for-byte** |
| Rendered row tags | `data-bom-orderable="true"` ×35, `="false"` ×12 | identical |

Requirement-code set diff (live − regen) = **exactly one code:
`EQUIPMENT-IDENTITY-CONFLICT`**. That is an operator-entered-DB condition
(standing rule: EQUIPMENT-IDENTITY-CONFLICT is operator-only) which the frozen
fixture does not carry. Snapshot IDs/digests differ because the inputs differ
(real project record vs. frozen fixture) — not because the engine differs.

Reproduction harness written for this pass: `_tmp_ecd_bomdump.ts` (repo root,
untracked, follows the existing `_tmp_*` convention). It calls the public
`generatePermitHTML` and then dumps `input.bom` row metadata + both
`buildProcurementApproval` framings. Output archived at
`…/scratchpad/bomdump.txt`.

---

## §1 BOM population arithmetic — CONFIRMED, ARITHMETIC FULLY EXPLAINED

**Classification: two counters over two different row populations, plus a third
counter on an orthogonal axis. Off-by-one = exactly one skipped-category row.**

### The measured truth (from `_tmp_ecd_bomdump.ts`, HEAD)

```
FULL BOM rows                                             = 48
SCHED-rendered rows (after BOM_SKIP_CATEGORIES)           = 47
buildProcurementApproval(FULL)      total=48 orderable=36 excluded=12
buildProcurementApproval(SCHED-FILTERED) total=47 orderable=35 excluded=12
orderableProcurementExport(FULL) rows                     = 36
SKIPPED row: solar_panel | Q.PEAK DUO BLK ML-G10+ 400W | qty 31 ea
             nonOrderable=undefined  quantityState=undefined  → counted ORDERABLE
required !== false over the 47 rendered rows              = 44
```

### The three divergent counters and their exact emitters

| Rendered string | Value | Emitter | Population it counts |
|---|---|---|---|
| `TOTAL LINE ITEMS (THIS SCHEDULE, ALL ROWS INCLUDING PENDING)` | **47** | `lib/permit/sections/structuralPages.ts:1581` → `flat.length` | rows **after** `BOM_SKIP_CATEGORIES` (renderer-local) |
| `AUTHORITATIVE PROCUREMENT TOTAL — ORDERABLE ROWS ONLY (FULL BOM)` (table row) + `data-procurement-total` | **36** | `structuralPages.ts:1578,1585,1590` → `buildProcurementApproval(bom)` | the **full 48-row** BOM |
| `…ORDERABLE ROWS ONLY: 36 of 48 BOM line items. 12 EXCLUDED …` (prose) | **36 / 48 / 12** | `structuralPages.ts:1629-1633` → same `_proc` object | the **full 48-row** BOM |
| `This system BOM contains 47 line items across 5 stages` | **47 / 5** | `structuralPages.ts:1603` → `flat.length`, `Object.keys(grouped).length` | rendered rows (renderer-local) |
| `44 items are required per NEC / manufacturer specification` | **44** | `structuralPages.ts:1599,1604` → `bomItems.filter(i => i.required !== false).length` | **orthogonal axis** (required-vs-optional), not procurement state |

### Root cause (precise)

1. `buildProcurementApproval` (`lib/permit/utils/bomForPermit.ts:1091`) is the
   single derived counter and it is **correct on its own terms** — but it is
   called on `bom` (all 48), while the table it prints under is built from
   `bomItems = bom.filter(i => !BOM_SKIP_CATEGORIES.has(i.category))`
   (`structuralPages.ts:1458`; `BOM_SKIP_CATEGORIES = {'solar_panel','panels','inverters'}`
   at `:1413`).
2. In this design exactly **one** row falls in that skip set (the `solar_panel`
   row; the microinverter row is category `microinverter`, not `inverters`).
   Hence 48 − 47 = 1 and 36 − 35 = 1. **The off-by-one IS the module row**, and
   it is silently counted as ORDERABLE because it carries neither
   `nonOrderable` nor `quantityState`.
3. `TOTAL LINE ITEMS = flat.length` and `This system BOM contains N line items`
   are the **renderer-local counters** the directive bans; they are computed
   from the slice the table happens to show, not from the row-state model.
4. The comment at `structuralPages.ts:1574-1577` explicitly *chose* full-BOM
   scope for the procurement total, to avoid a "second narrower total". The
   defect is that the neighbouring counters were never moved to the same scope,
   so the sheet prints two scopes side by side with no label distinguishing them.
5. `44 items are required` is a `required` (NEC-required vs optional) count.
   Only 3 rows are `required:false` (Q-CONN-10M, Q-CONN-10F, Q-SEAL-10). It has
   nothing to do with orderability and reads as a procurement claim — §10.

### Evidence anchors

* `structuralPages.ts:1413,1450-1460,1578-1605,1619-1641`
* `bomForPermit.ts:1086-1148` (`isOrderableForProcurement`, `buildProcurementApproval`)
* Rendered: `data-bom-orderable="true"`×35 + `="false"`×12 = 47 in-table rows,
  against a printed "36 of 48" — **the rendered rows themselves disprove the
  printed total.**

---

## §2 ProcurementAuthorityState — CONFIRMED MISSING; three overlapping mechanisms exist

**Classification: no per-row authority-state model exists. Three partially
overlapping mechanisms, on two sides of a type boundary.**

### Mechanism 1 — `PermitBOMItem.nonOrderable` (+ `nonOrderableReason`)
`lib/permit/utils/bomForPermit.ts:84-91`. Boolean. Set by: fastener-assembly
authority, open-air grounding authority, racking-assembly gating
(`_rackingLotState`, `lib/bom-engine-v4.ts:560-590`), Q-Cable procurement
sufficiency. Semantics: "authority unverified — design quantity only."

### Mechanism 2 — `PermitBOMItem.quantityState` (+ `quantityStateLabel`)
`bomForPermit.ts:92-96`. `'established' | 'pending'`. Set only by the sealing-cap
row today. Semantics: "the count itself is unknown."

### Mechanism 3 — `StructuralBomRow.procurementClass` A/B/C/D
`lib/permit/snapshot/structuralBom.ts:41-68` and the mirror
`ProcurementClass` in `lib/structural-engine-v4.ts:251,1116-1172`.
Carries `orderable`, `manufacturerDisplayAllowed`, `skuDisplayAllowed`,
`nonOrderableReason`, `procurementClassLabel`. Labels:
`A VERIFIED — ORDERABLE / B DESIGN QUANTITY — NON-ORDERABLE … / C CANDIDATE — NOT SELECTED / D EXCLUDED FROM TOTALS`.

**Critical seam:** mechanism 3 lives on the SNAPSHOT-side structural row type and
**never reaches `PermitBOMItem`** — verified empirically: the `procurementClass`
column is empty on all 48 rendered rows. It is flattened to the boolean
`nonOrderable` when the structural rows are emitted into the V4 BOM. This is the
same "flag-propagation loss across a type boundary" already documented in
`scripts/ppc-artifacts.ts:358-364`; the PPC pass fixed the *loss* by re-deriving a
boolean, not by carrying the class.

### The mandated five states vs. what exists

| Mandated | Exists today as | Gap |
|---|---|---|
| A VERIFIED_ORDERABLE | implicit: `!nonOrderable && quantityState!=='pending'`; class `A` | **fail-OPEN**: an unflagged row is assumed verified (`bomForPermit.ts:1039-1041` states this explicitly) |
| B ESTIMATED_FIELD_VERIFY | **does not exist anywhere** | the whole of §3 |
| C CANDIDATE_NON_ORDERABLE | `nonOrderable:true`; classes `B`+`C` (merged on the way out) | candidate-vs-design-qty distinction is lost at the boundary |
| D QUANTITY_PENDING | `quantityState:'pending'` | present, single-use |
| E EXCLUDED_NOT_APPLICABLE | class `D` only; no `PermitBOMItem` representation | rows are simply not emitted instead |

### Consolidation requirement (no fourth flag system)

The repair must introduce **one** field — `authorityState` on `PermitBOMItem` —
and make the three existing mechanisms **derivations of it, then delete them as
inputs**:

* `procurementClass` A/B/C/D becomes the *structural producer's* input to the
  classifier, mapped `A→VERIFIED_ORDERABLE`, `B→CANDIDATE_NON_ORDERABLE`,
  `C→CANDIDATE_NON_ORDERABLE`, `D→EXCLUDED_NOT_APPLICABLE`. Keep
  `StructuralBomRow.procurementClass` (it is the reconciliation authority and is
  serialized into the snapshot digest) but make `StructuralBomRow.orderable`
  a **projection of the new state**, not an independent boolean.
* `nonOrderable` and `quantityState` become **computed getters / back-compat
  projections** of `authorityState` (`nonOrderable === state is C or D-ish`,
  `quantityState === 'pending' ⇔ state D`). Every renderer that reads them today
  (`structuralPages.ts:1540-1550`, `buildProcurementApproval`) keeps working; no
  renderer gains a new branch.
* `isOrderableForProcurement` becomes `state === 'VERIFIED_ORDERABLE'` — a
  **fail-CLOSED** switch instead of today's "no flags ⇒ verified". This is the
  single change that flips the module row, the conduit rows, the fitting rows,
  the Q-CONN rows and IPLD350-3 in one place.
* The five state counters (`totalRowCount`, `verifiedOrderableCount`,
  `estimatedFieldVerifyCount`, `candidateNonOrderableCount`,
  `quantityPendingCount`, `excludedCount`) live on the `ProcurementApproval`
  object — the existing one, extended — so there is still exactly one counter
  producer.

Field inventory currently present on rows (48-row union, measured):
`category, derivedFrom, description, formula, id, manufacturer, model,
necReference, nonOrderable, nonOrderableReason, notes, partNumber, quantity,
quantityState, quantityStateLabel, required, stageId, stageLabel, subSystem,
totalCost, unit, unitCost`. **Absent and required by §2:** `bomLineId`,
`itemIdentity`, `quantityUnit` (only `unit`), `authorityState`, `orderable`,
`exportable`, `quantitySource`, `authoritySource`, `verificationStatus`,
`blockingRequirementCodes`, `affectedRouteIds`, `affectedEquipmentIds`,
`resolutionAction`, `evidenceReferences`, `snapshotId`, `snapshotDigest`.

---

## §3 Route-dependent reclassification — CONFIRMED; 21 rows currently mis-stated

**Classification: the authority model ALREADY declares the dependency; only the
BOM row-state consumer is missing.**

`lib/permit/snapshot/releaseGates.ts:469-476` already says, verbatim, that
`ROUTE-LENGTH-ESTIMATE` (gate **RG-5**, findingType `FIELD_VERIFICATION`)
`affects` — *"Voltage-drop results and the procurement conductor / raceway
FOOTAGE (length-dependent results only)."* The requirement is OPEN in this
package. Nothing consumes that `affects` string on the BOM side.

### The route-dependent rows currently rendered VERIFIED_ORDERABLE

All emitted with `required=true`, no `nonOrderable`, no `quantityState`:

| # (dump) | Row | Qty | id | Emitter |
|---|---|---|---|---|
| 4,5,6 | 1-1/4" PVC Sch 80 Conduit ×3 raceways | 21 / 23 / 18 **ft** | 0014, 0020, 0026 | `lib/bom-engine-v4.ts:385-390` (`emitRacewayConduitBom`) — `Σ segment length × 1.15` |
| 7,12,17 | PVC Coupling ×3 | 2 / 2 / 1 ea | 0015, 0021, 0027 | `bom-engine-v4.ts:392-397` — `ceil(ft/10)-1` |
| 8,13,18 | PVC Connector ×3 | 2 ea each | 0016, 0022, 0028 | `bom-engine-v4.ts:399-403` |
| 9,14,19 | One-Hole Strap ×3 | 4 / 4 / 3 ea | 0017, 0023, 0029 | `bom-engine-v4.ts:405-410` — `ceil(ft/10)+1` |
| 10,15,20 | Insulated Bushing ×3 | 2 ea each | 0018, 0024, 0030 | `bom-engine-v4.ts:412-416` |
| 11,16,21 | 90° Sweep ×3 | 2 ea each | 0019, 0025, 0031 | `bom-engine-v4.ts:418-422` — literally `"rough-in allowance; exact bend count pending field routing"` |
| 31,32 | #6 / #10 THWN-2 hots | 121 / 125 **ft** | 0010, 0011 | `bom-engine-v4.ts:495-501` (`emitAcConductorBom`) |
| 33,34 | #10 / #12 THWN-2 Green EGC | 41 / 21 **ft** | 0012, 0013 | `bom-engine-v4.ts:503-507` |

**21 rows.** Six of them (the sweeps) carry the directive's own trigger phrase
*"rough-in allowance / exact bend count pending"* in their rendered description
while being counted in the authoritative orderable total.

Additional latent defect found in the same family:
`r.onewayLengthFt ?? 30` — a **fabricated 30 ft default** silently substitutes
for a missing route length, at **four** sites:
`bom-engine-v4.ts:351` (raceway derivation), `:477` (`emitAcConductorBom`),
`:1270` and `:2642` (legacy whole-system paths). It does not fire on Braidon
(all segments carry lengths) but it is a fabricate-on-absence path in a
length-authority chain and should die in WS-1.

Row 35 (`GRN-OPENAIR-12`, 162 ft) is the one route-derived row already correctly
`nonOrderable` — but for the *grounding-authority* reason, not the route reason.

---

## §4 Q-CONN-10M / Q-CONN-10F — CONFIRMED; emitter is the trunk resolver path

**Classification: emitted by the brand-agnostic trunk-cable plan, currently
ORDERABLE, no CableExtensionSolution object exists in the codebase.**

* SKUs: `lib/equipment/trunkCable.ts:73-74` (Enphase catalog entry
  `connectors.male/.female`).
* Emitter: `lib/bom-engine-v4.ts:880-889`, inside `if (plan.splicePairs > 0)`.
  `plan` = `resolveTrunkCablePlan({… subArrayCount, spliceAtRows …})`. Braidon
  has 1 sub-array/plane bridge ⇒ `splicePairs = 1` ⇒ qty 1 each.
* Current row state: `id` `bom-v4-0004` / `0005`, qty 1 ea, `required=false`
  (renders an `OPT` badge), **no `nonOrderable`, no `quantityState`** ⇒
  `data-bom-orderable="true"` in the artifact ⇒ inside the 36 and inside
  `orderableProcurementExport`.
* Rendered `derivedFrom`: `"1 sub-array/plane bridge(s); rows use continuous
  cable + service loop (cheapest)"` — an installation-intent statement.
* Occurrences package-wide: **2** (SCHED only). They do **not** appear on PV-4B
  or in the QCABLE-PROCUREMENT-INSUFFICIENT block, so the artifact does not
  *textually* claim they solve the 14.5 ft deficit — but they are the only
  connector hardware in the package and they sit in the orderable total while a
  cable-extension solution is required and unselected.
* `CableExtensionSolution` — the type **exists as a threading slot only**:
  `SnapshotAuthorityInputs.cableExtensionSolutions` is plumbed through
  `generatePermit.ts:1058` and is always `[]`. No selection record, no SKU
  binding, no BOM-line binding.

---

## §5 IPLD350-3 Polaris tap connector — CONFIRMED; hardcoded caveat inside the description

**Classification: a single literal emitter; the "verify" caveat is prose inside
the row's own description string, with no authority object behind it.**

* Emitter: `lib/bom-engine-v4.ts:2829-2832` (the `else if (isSupplySideTap)`
  branch of the interconnection switch). Qty **3** (`'L1+L2+N = 3'`),
  `required=true`, NEC ref `705.11(C)`, `derivedFrom` `perSystem (supply-side tap)`,
  id `bom-v4-0034`.
* The caveat source is the **6th positional argument** (the description):
  `"…(1 per conductor: L1/L2/N). Verify lug range against actual service conductor size."`
  — `bom-engine-v4.ts:2831`. Verbatim in the artifact.
* Rendered state: `data-bom-orderable="true" data-bom-quantity-state="established"`,
  qty 3 — inside the 36, inside the export.
* A second, dead-for-this-design emitter at `bom-engine-v4.ts:1579-1583` (legacy
  whole-system path) carries the **same literal** — both must be repaired or the
  string reappears on the other code path.
* Truck-stock spare emitters: `bom-engine-v4.ts:1962-1963` and `:3035-3036`
  (excluded from `$/W`, but they name the same SKU as if selected).
* `SupplySideTapConnectionAuthority` — **does not exist**. Nothing records the
  existing service-conductor material/size/insulation/count, so "verify lug
  range" is the only representation of an unknown.

---

## §6 Grounding segment identity — CONFIRMED; the canonical objects are unique, the PROJECTIONS collapse them

**Classification: identity loss in two projection sites, not in the model.
`gnd-br-1` is a PHYSICAL segment id being used as the GROUPED-authority identity,
and simultaneously reused as the tag on three physical rows.**

### The canonical model is correct
`lib/permit/snapshot/build.ts:305-315` creates **one `GroundingRecord` per
branch**: `groundingId: \`gnd-${b.branchId}\`` over `branches` whose ids are
`br-1 / br-2 / br-3` (`build.ts:281`). So the snapshot holds **gnd-br-1,
gnd-br-2, gnd-br-3** — three unique physical objects.

### Collapse site A — PV-4B (the grouped authority row)
`lib/permit/snapshot/electricalProjection.ts:494-500,518`:

```ts
const _branchEgcIds = objs.filter(g => g.purpose === 'branch-egc').map(g => g.groundingId);
let _branchEgcEmitted = false;
for (const g of objs) {
  if (g.purpose === 'branch-egc') { if (_branchEgcEmitted) continue; _branchEgcEmitted = true; }
  …
  out.push({ groundingSegmentId: g.groundingId,   // ← the FIRST record's id
             groundingId: g.groundingId, purpose: 'branch-egc', … });
```

The three records are deliberately collapsed into **one** rendered authority
object (the comment at `:490-493` states the intent, and the intent is right per
the directive's preferred model) — but the grouped object is given **`gnd-br-1`**,
a physical segment's identity, instead of its own grouped-authority id. The
provenance string does list all three (`groundingObjects[gnd-br-1, gnd-br-2,
gnd-br-3]`, `:550`) — so the evidence knows about three, the identity says one.
Rendered by `lib/permit/sections/electricalPages.ts:389-401`
(`renderGroundingSegmentRows`).

### Collapse site B — E-1 (three physical rows, one id)
`electricalProjection.ts:1064-1066`:

```ts
const _oaSegmentId = _oaGnd.present ? (branchGnd[0]?.groundingId ?? 'GRN-OPENAIR-BRANCH') : null;
```

`_oaSegmentId` is computed **once** and stamped on **every** branch section at
`:1122` inside `branches.forEach(...)`. Rendered at
`electricalPages.ts:150-153`.

### Rendered evidence
`grep -o "gnd-br-[0-9]"` over the live artifact:
**`gnd-br-1` ×8, `gnd-br-2` ×0, `gnd-br-3` ×0.**
Three E-1 rows (B1, B2, B3 — each `data-grounding-segment-id="gnd-br-1"
data-grounding-pending="true"`) plus the PV-4B canonical block plus the
mono id echo on each. Rendered distinct grounding identities = 1; canonical
physical objects = 3. **Rendered count ≠ evidence count**, and gate 11
(physical grounding IDs unique) is unprovable as written because only one is
ever rendered.

### Note for WS-1 crossover
`GroundingSegment.bomLineId` (`electricalProjection.ts:546-548`) is
`` `GRN-OPENAIR-${size}` `` — that is a **part number**, not a BOM row id. The
"BOM line" pointer in the authority model already keys off part numbers because
no stable row id exists (see §Row-ID below).

---

## §7 PV-3 "BONDING UL 2703 INTEGRATED" — CONFIRMED; hardcoded literal that survives the pending gate

**Classification: a renderer-local string constant in the drafting stack. It is
NOT downstream of PPC's authority bundle; it never consults any authority.**

* Emitter: `lib/drafting/templates/roof.ts:2496` **and** `:2504` — the PV-3
  FASTENER & HARDWARE SCHEDULE `hwRows` array:
  `['BONDING', 'UL 2703 INTEGRATED — NEC 690.43']`, present in **both** the
  `_exactD === true` (verified assembly) branch **and** the
  `_exactD === false` (assembly pending) branch.
* Which branch fired on this artifact: the **pending** one — the same table
  prints `FASTENER ASSEMBLY: PENDING VERIFIED SELECTION`,
  `INSTALLATION DETAILS: NOT ESTABLISHED`,
  `EMBEDMENT / TORQUE / PILOT: WITHHELD — NO VERIFIED SOURCE`,
  `MATERIAL / COATING: WITHHELD — NO VERIFIED SOURCE` — and then asserts
  `BONDING: UL 2703 INTEGRATED`. (Artifact counts: `PENDING VERIFIED SELECTION`
  ×8, `WITHHELD — NO VERIFIED SOURCE` ×2.) The line immediately above it in the
  source is the PPC §4 comment explaining that torque/pilot were deleted for
  exactly this reason — the bonding row was missed in that sweep.
* Companion literals that must move with it:
  * `lib/drafting/sheetComposition.ts:833` — PV-3 callout ⑦
    `{ n: 7, label: 'BONDING JUMPER', sub: 'NEC 690.43' }` (the directive's
    banned "bonding jumper" phrasing), in the same `_exact === false` array whose
    siblings ③④ correctly degrade to "pending verified selection".
  * `lib/permit/sections/electricalPages.ts:1263` — SVG detail text
    `MODULE RAIL — BONDED (UL 2703)`.
  * `lib/permit/sections/compliancePages.ts:1141` — APP-A `UL Listing` row
    prints `'UL 2703'` unless `mount.ul2703Listed === false` (fail-open default).
* `RackingBondingAuthority` — **does not exist**. The nearest existing record is
  `lib/permit/snapshot/rackingAssembly.ts` (assembly selection / verification),
  which already knows `mountSku: null` and drives the class-B BOM rows — so the
  authority the bonding statement needs is *already computed*, just not consulted
  by the drafting stack. Standing rule from `scripts/ppc-artifacts.ts:325-327`
  applies: an authority projection is not landed until the `lib/drafting`
  descriptor consumes it.
* The bonding **requirement** is separately and correctly stated
  (`BONDING PER NEC 250 AND 690.43.` in the artifact) and must be preserved.

---

## §8 APP-A false global approval — CONFIRMED; literal sentence + a scrape-verification tick standing in for applicability

**Classification: hardcoded HTML sentence; check-mark bound to the wrong boolean;
applicability evaluated for only one of five document rows.**

### The sentence
`lib/permit/sections/compliancePages.ts:1204`, a bare literal inside the
"Manufacturer Data Sheets — On File" block:
`All equipment is CEC Listed, UL Listed, and approved for grid interconnection.`
No registry read, no requirement check, no gate. (A near-duplicate lives at
`lib/proposal/renderProposalHTML.ts:820` — sales collateral, out of scope for the
planset but worth flagging so a future sweep does not "fix" the wrong one.)

### The check-mark
`compliancePages.ts:1173` inside `_cite(...)`:
```ts
const mark = a.verified ? '✓ on file' : 'on file';
```
`a.verified` is `ManufacturerAsset.verified`, documented at
`lib/manufacturer-assets-db.ts:30` as *"true only when the source_url was fetched
+ confirmed"* — a **scrape/URL-availability** flag. It has no relationship to
applicability. Live artifact: **3 green `✓ on file` marks**, one of which sits on
the Racking row whose very next span reads
`— APPLICABILITY UNVERIFIED: the document covers Roof Tech RT-MINI II, NOT
VERIFIED for the selected RT-MINI`.

### Applicability coverage gap
`_cite()` evaluates applicability only when a `selectedModel` argument is passed
(`compliancePages.ts:1174-1176`: `selectedModel !== undefined ? evaluate… : null`).
Of the five rows built at `:1183-1198`, **only `Racking` passes one**. Module,
Inverter, Battery and AC-Combiner/Gateway rows are structurally incapable of
showing an applicability state.

### Document-state model gap
`evaluateDocumentApplicability` (`lib/manufacturer-assets-db.ts:232-280`) returns a
**binary** `DocumentApplicability.state: 'verified' | 'unverified'`. The directive's
seven states (ARCHIVED / APPLICABLE / VERIFIED / AUTHORITATIVE / SUPERSEDED /
NOT_APPLICABLE / PENDING_APPLICABILITY) do not exist as an enum anywhere. The
*ingredients* do exist, split across two subsystems:
`lib/documents/registry.ts` has `archivedInRepo`, `sha256`, `verificationState`,
and already enforces "a document cannot be verified unless it is archived with a
sha256" (`:120-122`) — i.e. the archived≠applicable distinction is half-built on
the registry side and absent on the asset side.

RT-MINI is the exact case the directive names: asset record
`racking_detail:rooftech-mini` (`manufacturer-assets-db.ts:35`) has
`verified: true` and `docTitle: "Roof Tech RT-MINI II Installation Manual"` with a
note that says *"RT-MINI is superseded by RT-MINI II"* — ARCHIVED yes,
APPLICABLE-TO-RT-MINI pending, AUTHORITATIVE no, and the sheet prints a green tick.

---

## §9 PV-5 "NEC 2020 705.11 / 705.12(A)" — CONFIRMED; the topology filter passes it *by design*

**Classification: a data-layer citation plus a deliberate special-case in the
side classifier. Not a renderer-local string — the sanitizer is working exactly
as coded.**

* Label source (data): `lib/data/placards/field-placards-research.json:256`,
  placard id `line-side-tap-warning`:
  `{ "code": "NEC 2020", "section": "705.11 / 705.12(A)" }`
  (the NEC 2023 sibling on the next line is correctly just `"705.11"`).
* Why the topology filter keeps it: `lib/permit/utils/fieldLabels.ts:120-127`
  ```ts
  function necSectionSide(part: string): 'supply' | 'load' | 'general' {
    if (/705\.11\b/.test(s)) return 'supply';
    if (/705\.12\(A\)/.test(s)) return 'supply';   // ← explicit special case
    if (/705\.13\b/.test(s)) return 'load';
    if (/705\.12/.test(s)) return 'load';
  ```
  with the comment at `:118`: *"705.12(A) was the 2017 supply-side ref"*.
  `filterSectionByTopology` (`:130-150`) therefore keeps **both** parts on a
  supply-side design and `resolveRef` (`:159-176`) prints
  `NEC ${necYear} ${necSection}` → **`NEC 2020 705.11 / 705.12(A)`**.
* This is the EP-era ruling being honoured. Ray's new ruling supersedes it: the
  citation is stamped with the **2020** edition, and in NEC 2020 `705.12` is the
  load-side article — so a 2020-stamped `705.12(A)` is a wrong-edition,
  wrong-side citation regardless of what it meant in 2017.
* Rendered occurrences: **2** (`PV-5` placard schedule — the mono label cell and
  the code-ref cell). Also echoed into
  `docs/evidence/braidon-label-topology-report.json:78`.
* Repair is two-sited and must be both, or it regresses: drop `/ 705.12(A)` from
  the NEC-2020 `codeRefs` entry **and** delete the `705.12(A) → supply`
  special-case (or scope it to `necYear === '2017'`), so no future placard row can
  reintroduce it. Then extend the existing package-wide topology/citation gate to
  cover PV-5 (it currently covers E-1 / PV-4A / PV-4B / SCHED / warning-label
  text but not the placard code-ref cells).

---

## §10 BOM summary from row states — CONFIRMED

Same emitter block as §1: `structuralPages.ts:1599-1613`. The three banned
claims are all present and all renderer-local:
* `47 line items across 5 stages` (`flat.length`, `Object.keys(grouped).length`)
* `44 items are required per NEC / manufacturer specification` (`required` axis)
* `All quantities are derived from CAD geometry and equipment registry — no
  manual estimates.` — flatly contradicted by 21 route-estimated rows (§3), 12
  excluded rows, and 6 rows whose own description says *"rough-in allowance;
  exact bend count pending field routing"*.

---

## Row-ID situation (inventory)

**There is no stable BOM row identity. `bomLineId` does not exist.**

* The field is `PermitBOMItem.id?: string` (`bomForPermit.ts:76`) — **optional**.
* Producer: `lib/bom-engine-v4.ts:521-524`
  ```ts
  let _idCounter = 0;
  function nextId(): string { return `bom-v4-${(++_idCounter).toString().padStart(4,'0')}`; }
  ```
  reset at `:669` and `:2094` (once per generate call).
* Consequences, all measured on this package:
  1. **Ordinal, not content-derived.** Ids are assignment-order sequence numbers.
     Inserting one row early renumbers every downstream row — the id is unusable
     as a cross-artifact key or an export line reference.
  2. **Gaps from post-filtering.** `bom-v4-0008` is absent from the final 48:
     the registry combiner row was emitted (taking 0008) and then dropped by
     `bomForPermit.ts:790` (`merged.filter(it => it.category !== 'combiner' …)`).
     A gap in a "unique final row IDs" multiset is a §12-gate-1 hazard.
  3. **Two of 48 rows have NO id at all** — the rows appended in `bomForPermit`
     *after* the V4 merge: the integrated combiner (`bomForPermit.ts:791-808`,
     `derivedFrom: 'integrated-bos resolver'`) and the open-air branch EGC
     (`bomForPermit.ts:855-895`). Neither passes through `nextId()`.
  4. Cross-object BOM references therefore key on **part number**, not row id —
     e.g. `GroundingSegment.bomLineId = 'GRN-OPENAIR-12'`
     (`electricalProjection.ts:546-548`). Part numbers are not unique in general
     (three separate PVC-conduit rows share a family and are disambiguated only
     by a raceway-id suffix baked into the part number at
     `bom-engine-v4.ts:386`).

§1's mandated "row-ID multiset reconciliation gate (rendered == evidence ==
export)" is therefore **not implementable today** — it needs a real
`bomLineId` first. That is the load-bearing prerequisite for WS-1.

---

## Export machinery (inventory)

* `orderableProcurementExport(items)` — `bomForPermit.ts:1156-1158`, a one-line
  wrapper over `buildProcurementApproval(...).orderableRows`.
* `isOrderableForProcurement(item)` — `bomForPermit.ts:1086-1088`.
* **Consumers: none in product code.** Full call-site census:
  `scripts/ppc-artifacts.ts` (evidence artifacts, lines 353/558/568/627/642-645)
  and `tests/planset/ppc-ws1-projection-procurement.test.ts`. There is no API
  route, no UI action, no CSV/PO writer. The "export" today is an evidence
  artifact only.
* Implication for §12 gates 18/19: they are satisfiable as **pure-function +
  evidence-artifact** gates. No product export surface has to be built (and none
  should be, under the §11 freeze) — but the artifacts must be regenerated so the
  gate is non-vacuous.

---

# REPAIR PLAN

Two parallel workstreams. WS-1 owns the row-state model and everything that
counts or orders. WS-2 owns identity, authority language and citations. They are
independently landable **except** at the four shared files listed at the end.

## WS-1 — BOM / procurement (§1, §2, §3, §4, §5, §10)

**W1-A. Row identity (prerequisite for everything else).**
Add `bomLineId: string` to `PermitBOMItem`, content-derived and stable
(`stage:category:partNumber[:racewayId|:subSystem]` normalized, with a collision
suffix), assigned by a **single** stamping pass at the end of
`generateBOMForPermit` so the two currently id-less rows are covered. Keep the
legacy ordinal `id` untouched for one release. Add the multiset invariant
(rendered ids == approval ids == export ids, no gaps, no dups).
Files: `lib/permit/utils/bomForPermit.ts`, `lib/bom-engine-v4.ts:521-524`.

**W1-B. `ProcurementAuthorityState` — the consolidation.**
Add `authorityState` (5-valued) + the §2 companion fields to `PermitBOMItem`.
Write ONE classifier `classifyProcurementAuthority(row, ctx)` in
`bomForPermit.ts`. Rewire:
* `isOrderableForProcurement` → `state === 'VERIFIED_ORDERABLE'` (fail-closed).
* `nonOrderable` / `quantityState` → derived projections, kept only for renderer
  back-compat; every *producer* write-site converted to set `authorityState`
  instead (`bom-engine-v4.ts:_rackingLotState`, the fastener block, the
  open-air-grounding block, the Q-Cable sufficiency block).
* `StructuralBomRow.procurementClass` A/B/C/D → mapped INTO the classifier as an
  input; `StructuralBomRow.orderable` becomes a projection of the mapped state.
  Do **not** add a parallel state field to `StructuralBomRow` — the class stays
  as the structural producer's vocabulary, the state is the single consumer-side
  truth.
Files: `lib/permit/utils/bomForPermit.ts`, `lib/bom-engine-v4.ts`,
`lib/permit/snapshot/structuralBom.ts`, `lib/structural-engine-v4.ts`,
`lib/permit/snapshot/types.ts`.

**W1-C. §1/§10 — one counter, one scope.**
Extend `ProcurementApproval` with the six canonical counters. Delete
`flat.length` and the `required !== false` count as *rendered claims*; make the
SCHED table's totals + the summary paragraph read the same approval object, over
the same population. Decide the population explicitly and label it (recommended:
full 48-row BOM everywhere, with the SCHED table stating "N of M rows shown here;
modules/inverters are scheduled above"). Kill `"All quantities are derived …
no manual estimates"` and the `44 items are required` sentence.
Files: `lib/permit/sections/structuralPages.ts:1413-1418, 1450-1460, 1567-1645`.

**W1-D. §3 — route dependency consumer.**
Read the OPEN `ROUTE-LENGTH-ESTIMATE` requirement (and its existing RG-5
`affects` declaration at `releaseGates.ts:469-476`) in the classifier; any row
whose quantity is route-derived → `ESTIMATED_FIELD_VERIFY`. Tag the emitters at
source with `quantitySource: 'route-derived'` / `affectedRouteIds` rather than
pattern-matching descriptions: `emitRacewayConduitBom` (all 6 row kinds) and
`emitAcConductorBom` (hots + EGCs). Delete the `?? 30` fabricated length at
`bom-engine-v4.ts:475`.
Files: `lib/bom-engine-v4.ts:373-431, 461-517`, `lib/permit/utils/bomForPermit.ts`.

**W1-E. §4 — Q-CONN + CableExtensionSolution.**
Define the `CableExtensionSolution` record (the `SnapshotAuthorityInputs` slot
already exists and is always `[]`). While none is selected, the two connector
rows classify `CANDIDATE_NON_ORDERABLE`; strip the installation-intent
`derivedFrom` prose; assert in test that they never appear in the export and
never in the deficit block.
Files: `lib/bom-engine-v4.ts:880-889`, `lib/permit/snapshot/authorityInputs.ts`,
`lib/permit/snapshot/build.ts`, `lib/permit/utils/bomForPermit.ts`.

**W1-F. §5 — Polaris tap + SupplySideTapConnectionAuthority.**
New authority record; until verified, IPLD350-3 → `CANDIDATE_NON_ORDERABLE` with
the mandated label. Remove the "Verify lug range…" caveat from the description
string in **both** emitters (`:2831` and `:1581`) — the state carries it now.
Decide the truck-stock spares (`:1962`, `:3035`) at the same time.
Files: `lib/bom-engine-v4.ts`, `lib/permit/snapshot/build.ts`,
`lib/permit/snapshot/types.ts`.

## WS-2 — authority / identity / language (§6, §7, §8, §9)

**W2-A. §6 — grounding identity.**
Give the grouped branch-EGC authority its **own** id (e.g.
`gnd-branch-egc-authority`, or the existing `GRN-OPENAIR-BRANCH` fallback
promoted to the primary), never `branchGnd[0].groundingId`. Emit the three
physical `gnd-br-1/2/3` objects on E-1 with their own ids, each referencing the
one grouped authority. Two edits:
`electricalProjection.ts:494-500,518` (grouped) and
`electricalProjection.ts:1064-1066,1122` (per-branch stamp).
Renderers already accept per-row ids (`electricalPages.ts:150-153, 389-401`).
Add: physical ids unique; grouped id not in the physical set; rendered count ==
evidence count.

**W2-B. §7 — RackingBondingAuthority.**
New record projecting the already-computed racking-assembly verification state
into a three-outcome bonding result. Consume it in the drafting stack — the
literal at `roof.ts:2496` **and** `:2504`, the callout at
`sheetComposition.ts:833`, the SVG text at `electricalPages.ts:1263`, and the
APP-A `UL Listing` row at `compliancePages.ts:1141`. Preserve the general NEC
250/690.43 bonding requirement text.

**W2-C. §8 — APP-A document states.**
Replace the sentence at `compliancePages.ts:1204` with the registry-derived
statement. Split the tick: availability (`a.verified`) and applicability
(`evaluateDocumentApplicability`) render as two distinct marks, and the green ✓
is reserved for APPLICABLE/AUTHORITATIVE. Pass `selectedModel` for **all five**
document rows, not just Racking. Widen `DocumentApplicability.state` from the
binary to the seven-state enum, sourcing ARCHIVED from
`lib/documents/registry.ts` (`archivedInRepo` + `sha256`) so archived ≠
applicable is structural, not prose.

**W2-D. §9 — PV-5 citation.**
Drop `/ 705.12(A)` from the NEC-2020 `codeRefs` entry in
`lib/data/placards/field-placards-research.json:256`; delete (or scope to 2017)
the `705.12(A) → supply` case in `fieldLabels.ts:123` and its comment at `:118`;
extend the topology/citation gate to the PV-5 placard code-ref cells and the
evidence JSON.

## Shared-file conflict notes

| File | WS-1 needs | WS-2 needs | Sequencing |
|---|---|---|---|
| `lib/permit/snapshot/types.ts` | `PermitBOMItem` §2 fields, `SupplySideTapConnectionAuthority`, `CableExtensionSolution` | `RackingBondingAuthority`, widened `DocumentApplicability` | **Land ONE combined types commit first** (both workstreams branch from it). Purely additive; no behaviour. |
| `lib/permit/snapshot/build.ts` | tap + cable-extension authority construction, requirement pushes | racking-bonding authority construction | Disjoint blocks; append in separate regions. Merge-order: WS-1 first (it also touches the Q-Cable sufficiency block already there). |
| `lib/permit/utils/bomForPermit.ts` | the whole classifier + approval object | §7 bonding row state must flow through the SAME classifier (the `grounding`/`mount_hardware` rows) | **WS-1 owns this file.** WS-2 must not write row flags here — it supplies an authority object and WS-1's classifier reads it. Hard rule, or §2's "no fourth flag system" is lost on day one. |
| `lib/permit/sections/structuralPages.ts` | SCHED totals/summary (`:1413-1645`) | the grounding-authority cell at `:1835-1884` (§6 wording) | Different regions of one file; low risk, but coordinate on a single rebase — this is the densest page-fit sheet and both edits change rendered length (gates 22/23). |
| `lib/bom-engine-v4.ts` | §3/§4/§5 emitters + id generator | none | WS-1 exclusive. |
| `lib/permit/snapshot/electricalProjection.ts` | none | §6 (two sites) | WS-2 exclusive. |
| `lib/drafting/templates/roof.ts`, `sheetComposition.ts`, `compliancePages.ts`, `fieldLabels.ts`, placards JSON, `manufacturer-assets-db.ts` | none | §7/§8/§9 | WS-2 exclusive. |

**Page-fit warning for both:** SCHED, PV-4B and PV-3 have near-zero printable
slack (documented repeatedly in-source at `structuralPages.ts:1624-1627`,
`electricalPages.ts:402-409`). Any state-label text added by WS-1 to the SCHED
exclusion block, or by WS-2 to the PV-4B grounding paragraph, must be re-measured
against gates 22/23 before commit.

## Not reproducing / honest gaps

* **`EQUIPMENT-IDENTITY-CONFLICT` is not reproducible from the frozen fixture.**
  It is present in the live 19-requirement set and absent from the HEAD fixture
  regen's 18. It is an operator-entered-DB condition, not an engine state; it
  affects only the requirement count, and per the standing rule it is
  operator-only. No §1-§9 finding depends on it. Any gate that asserts "19
  requirements" must be evaluated against the **live** artifact, not the fixture
  — the fixture's honest number is 18 in `--insufficient --identity` mode.
* **Gate 11 ("physical grounding IDs unique") is currently vacuous** — only one
  grounding id is ever rendered, so the uniqueness assertion cannot fail. It
  needs an anti-vacuity probe asserting `>= 3` distinct physical ids on this
  design.
* **§4's "connectors must never imply they solve the deficit"** does not
  currently reproduce as a *textual* claim: Q-CONN appears twice, SCHED-only, and
  is never mentioned in the QCABLE-PROCUREMENT-INSUFFICIENT block. The defect
  that does reproduce is that they are ORDERABLE and carry installation-intent
  prose. Stated so the repair is not over-scoped.
* **The proposal-side twin of the APP-A sentence**
  (`lib/proposal/renderProposalHTML.ts:820`) is out of planset scope and is NOT
  part of this pass — flagged only so it is not mistaken for the planset emitter.
* No PDF / PNG / page-fit measurement was performed in Phase 0 (audit only).

---

# AFTER — THE CLOSURE PASS RESULT (2026-07-27)

Status: **CLOSED**. Every finding above was repaired in WS-1 / WS-2 and verified
against the RENDERED package by the 24 permanent gates of
`scripts/planset-evidence-ecd.mjs` in all three acceptance modes (fixture /
insufficient / identity), each gate carrying an anti-vacuity probe from
`scripts/ecd-model-evidence.ts`. **24/24 gates pass · 24/24 probes fire · in all
three modes.**

Acceptance package: `PDS-76C0C5B56CEF`, 24 sheets, 48 BOM rows,
7 gates / 15 requirements / 0 advisories (fixture); 16 (insufficient); 17 (identity).

## AFTER column

| § | Finding (BEFORE) | AFTER | Where the truth now lives | Gate |
|---|---|---|---|---|
| §1 | Three counters over two populations plus an orthogonal axis; rendered "36 of 48" beneath 47 rendered rows | ONE counter over ONE population: **48 rows**, `47 shown here + 1 scheduled above`, every rendered row carrying its stable id | `buildProcurementApproval` (the only counter) then `structuralPages.ts` SCHED | 1, 3, 4, 5, 17 |
| §2 | No per-row authority state; three overlapping mechanisms across a type boundary; unflagged implies verified (fail-OPEN) | ONE `authorityState` per row, five values, **fail-CLOSED**: `isOrderableForProcurement` is `state === 'VERIFIED_ORDERABLE'`. `nonOrderable` / `quantityState` are now PROJECTIONS; `procurementClass` A/B/C/D is an INPUT to the one classifier | `ProcurementAuthorityRecord` (`lib/bom-types-v4.ts`) + `classifyProcurementAuthority` (`bomForPermit.ts`) | 2, 3 |
| §3 | 21 route-derived rows counted VERIFIED_ORDERABLE while `ROUTE-LENGTH-ESTIMATE` was OPEN; six carried "rough-in allowance; exact bend count pending" in their own description; `?? 30` fabricated default at 4 sites | 23 route-derived rows: **22 ESTIMATED_FIELD_VERIFY** (design quantity visible, labelled `EST — FIELD VERIFY`, out of every export), 1 held by a stronger authority (`QCABLE-GROUNDING-AUTHORITY-UNVERIFIED`), **0 orderable**. The `?? 30` default is dead; an absent length now yields `QUANTITY_PENDING` | emitters tag `quantitySource:'route-derived'` + `affectedRouteIds`; the classifier consumes RG-5 | 6, 7 |
| §4 | Q-CONN-10M / 10F ORDERABLE, inside the export, carrying installation-intent prose; `CableExtensionSolution` a threading slot always `[]` | Both **CANDIDATE_NON_ORDERABLE**; `CableExtensionSolution` is a real record with a six-condition promotion contract (`evaluateCableExtensionPromotion`); neither the deficit statement nor the sufficiency authority's resolution options names them | `bomForPermit.ts` classifier rule 3 escape hatch | 8, 9 |
| §5 | IPLD350-3 qty 3 ORDERABLE with the caveat as PROSE inside its own description; no authority object | **CANDIDATE_NON_ORDERABLE** with the mandated label; `SupplySideTapConnectionAuthority` records 8 unresolved facts; the retired caveat string is gone from BOTH emitters; the rule is **two-way** (a verified authority clears the pre-snapshot engine's candidate hint) | `lib/permit/snapshot/supplySideTap.ts` then `electrical.supplySideTapConnection` | 10 |
| §6 | `gnd-br-1` x8, `gnd-br-2` x0, `gnd-br-3` x0 — one physical identity doing duty as three physical rows AND as the grouped authority | **gnd-br-1/2/3 each render, uniquely**; the grouped node owns `gnd-branch-egc-authority` and is never counted physical; `GroundingSegment.bomLineId` is a real row id (the part number moved to `bomLinePartNumber`) | `electricalProjection.ts` (both collapse sites) | 11, 12 |
| §7 | `BONDING: UL 2703 INTEGRATED` printed in the assembly-PENDING branch, beside `FASTENER ASSEMBLY: PENDING VERIFIED SELECTION`; plus `BONDING JUMPER`, `MODULE RAIL — BONDED (UL 2703)`, and a fail-OPEN APP-A `UL 2703` row | `RackingBondingAuthority` yields `METHOD_PENDING_ASSEMBLY_SELECTION`; all four literals consume it; the general **NEC 250.134 / 690.43 bonding REQUIREMENT is preserved** and never gated by the method | `lib/permit/snapshot/rackingBonding.ts`, consumed at 6 render sites | 13 |
| §8 | Bare literal "All equipment is CEC Listed, UL Listed, and approved for grid interconnection"; a green tick bound to a SCRAPE flag; applicability evaluated for 1 of 5 document rows; binary state model | Registry-derived conclusion (`NOT_ESTABLISHED`, 7 open in-scope codes); **the tick is gone**; availability and applicability are separate chips; applicability evaluated for **every** row; **seven-state** document model with `ARCHIVED` as a companion availability chip only | `equipmentListingConclusion.ts` + the widened `DocumentApplicability` | 14, 15 |
| §9 | `NEC 2020 705.11 / 705.12(A)` on a supply-side design — wrong edition AND wrong side | The dataset entry no longer carries it **and** the `705.12(A) -> supply` special case is deleted, so neither path can reintroduce it. Supply-side labels cite `NEC 2020 705.11` only; the one load-side-only label is fully suppressed; every remaining 705.12 mention package-wide is an explicitly NEGATED contrast | `field-placards-research.json` + `fieldLabels.ts`; the gate now covers the PV-5 placard code-ref cells | 16 |
| §10 | "47 line items across 5 stages", "44 items are required…", "All quantities are derived… no manual estimates" | The **PROCUREMENT AUTHORITY SUMMARY**, every number from the same approval object, ending `PROCUREMENT READY: NO.` All three retired claims are absent package-wide | `structuralPages.ts` (`data-procurement-summary="state-derived"`) | 17 |
| Row-ID | No stable identity: optional ordinal `bom-v4-NNNN`, a gap at 0008, **two rows with no id at all** | `bomLineId` — content-derived, stable, stamped in ONE pass; **48/48 unique, 0 duplicates, 0 missing, 0 hash collisions** | `lib/bom/bomLineId.ts` | 1, 4, 5, 24 |
| Exports | `orderableProcurementExport` had **no consumers**; gates 18/19 unprovable | Two partitioning artifacts: **11 authoritative** + **37 excluded** = 48, disjoint, every excluded row visible on SCHED with its state and reason | `orderableProcurementExport` / `nonOrderableProcurementExport` | 18, 19 |

## Final procurement-state matrix (the ONE counter, three modes)

| mode | requirements | total | A VERIFIED_ORDERABLE | B ESTIMATED_FIELD_VERIFY | C CANDIDATE_NON_ORDERABLE | D QUANTITY_PENDING | E EXCLUDED_NOT_APPLICABLE | export | ready |
|---|---|---|---|---|---|---|---|---|---|
| fixture | 15 | 48 | 11 | 22 | 14 | 1 | 0 | 11 | NO |
| insufficient | 16 | 48 | 10 | 22 | 15 | 1 | 0 | 10 | NO |
| identity | 17 | 48 | 11 | 22 | 14 | 1 | 0 | 11 | NO |

`insufficient` minus `fixture`: the listed Q-Cable trunk assembly row leaves A for
C when the procurement deficit fires. `identity` minus `fixture`: both added
requirements are ADMINISTRATIVE holds with no procurement-axis impact, so no row
state moves.

## Population arithmetic — before, after

```
BEFORE (8cf77c8e, measured):  48 full BOM · 47 SCHED-rendered · printed "47 total",
                              "36 of 48", "12 EXCLUDED", "44 required", beneath
                              35 true + 12 false rendered row tags.  INVARIANT: BROKEN.

AFTER  (this pass, measured): 48 population = 11 A + 22 B + 14 C + 1 D + 0 E
                              display split = 47 shown here + 1 scheduled above
                              authoritative export = 11 · excluded = 37 · 11 + 37 = 48
                              INVARIANT: HELD (countsReconcile = true; the rendered,
                              evidence and export row-id multisets are equal).
```

The population did not change. What changed: one counter reports it, the display
split is stated and reconciled by row id, and the orderable count fell 36 to 11
because a row is orderable only when nothing open affects it (fail-CLOSED) rather
than whenever no flag happened to be set (fail-OPEN).

## Corrections to the audit's own numbers

* §3 said **21** route-dependent rows. The measured figure at the final state is
  **23** route-derived rows (22 `ESTIMATED_FIELD_VERIFY` + 1 held by
  `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED`). The audit's list folded two raceway
  rows into its "x3" groupings. No finding changes.
* §1's "the off-by-one IS the module row" is confirmed and now explicit: the
  module row is `CANDIDATE_NON_ORDERABLE` under the pre-existing
  `MODULE-EXACT-DATASHEET-PENDING` policy, and it is named with its row id in the
  SCHED population row as "scheduled above".

## Two additional defects found by the closure gates' own anti-vacuity probes

Both were one-way gates — states that could be entered and never left — found
while proving the gates non-vacuous, and both are fixed in this commit:

1. **The classifier read its own projection back as a producer fact.**
   `applyProcurementAuthority` writes `nonOrderable = true` as the back-compat
   projection of any non-A state; classifier rule 4 reads `row.nonOrderable ===
   true` as a PRODUCER declaration. Re-classifying an already-classified row
   therefore collapsed all 22 `ESTIMATED_FIELD_VERIFY` rows (and the
   `QUANTITY_PENDING` row) into `CANDIDATE_NON_ORDERABLE`, contradicting the
   documented idempotency contract and re-creating exactly the
   "projection becomes an input" defect §2 exists to kill. Fixed: the record now
   carries `producerNonOrderable` / `producerQuantityState`, and
   `producerViewOf(row)` restores the producer's declared values before every
   re-classification.
2. **The supply-side tap candidate hint was unconditional.**
   `bom-engine-v4` is a pre-snapshot engine and stamped
   `SUPPLY_SIDE_TAP_CONNECTOR_HINT` on the IPLD row unconditionally, while
   `bomForPermit`'s post-pass only handled the UNVERIFIED case — so a VERIFIED
   tap authority could never promote the row. §5's "until verified" had no
   `after`. Fixed: the post-pass clears the hint when the authority verifies, and
   the row then promotes through the classifier's normal path.

## Honest gaps carried forward (not defects)

* **`SUPERSEDED` / `AUTHORITATIVE` are reachable but unwired.** Both require
  `DocumentRegistryFacts` (`archivedInRepo` + `sha256` + `status`) from
  `lib/documents/registry.ts`, which is async/DB-backed; the synchronous render
  path does not supply them, and `evaluateDocumentApplicability` takes them as a
  pure argument and never guesses. Both states are PROVEN reachable by the
  gate-15 anti-vacuity probe. Today's honest output is `ARCHIVED` +
  `APPLICABLE` / `PENDING_APPLICABILITY`. **FUTURE WIRING**, recorded, not claimed.
* **`EQUIPMENT-IDENTITY-CONFLICT` remains live-only.** It is an operator-entered
  DB condition (standing rule: operator-only) and the frozen fixture cannot carry
  it. Identity mode reproduces 17 of the live 19 requirements
  (fixture 15 + `PROJECT-NAME-NONPRODUCTION` + `DESIGNER-OF-RECORD-MISSING`);
  live 19 = those 17 + `EQUIPMENT-IDENTITY-CONFLICT` +
  `QCABLE-PROCUREMENT-INSUFFICIENT`. No §1-§10 finding depends on it.
* **The proposal-side twin of the APP-A sentence**
  (`lib/proposal/renderProposalHTML.ts` — sales collateral) is DELIBERATELY out
  of planset scope and was NOT touched by this pass, exactly as Phase 0 flagged.
* **`scripts/planset-evidence-rp.mjs` is superseded and has 3 stale gates.**
  Gate 2 false-positives on the honest NEGATED wording "route length is a
  CAD-derived estimate (not field-verified…)" (already present at `8cf77c8e`);
  gates 13/14 predate the RGM release-gate redesign (RS-1 continuation sheets;
  the `ACTIVE RELEASE BLOCKERS` heading no longer exists). Its committed evidence
  artifact was already several passes stale. It is not in the mandated acceptance
  chain — RGM's 17 gates and this pass's 24 cover the same ground — so its
  artifact was left untouched rather than committed in a failing state. Its
  gate 18, which this pass DID break by passing an equipment-db scalar as the
  APP-A inverter identity, is fixed: the design's own inverter model is used.
