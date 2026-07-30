# BRAIDON PLANSET 14 — REGRESSION REPAIR

Two blocking regressions in `PermitPackage-BRAIDON M PILLA — Solar TEST (14).html`
(snapshot `PDS-EBDB128380CB`, DESIGN_REVIEW, 16 sheets, 6 gates, 16 requirements,
~20 `Unknown` projections) are repaired, plus the vent-provenance question.

Planset 13 remains the accepted jurisdictional and visual baseline until a new
artifact is reviewed. Madison County Building & Zoning remains the AHJ; Granite
City remains the mailing locality only. Migration 117 is untouched.

---

## 1. REPAIR B — CANONICAL STATE PROPAGATION

### 1.1 Root cause

Planset 13 printed `Illinois`. Planset 14 printed `Unknown` in 20 places: the
title block on all 16 sheets, the cover `CITY/STATE` cell, the cover vicinity-map
address chip, the governing-code `<state> AMENDMENTS` row and the PE-1 project
table — on a project whose address is `3 MELVIN DR APT A, GRANITE CITY, IL 62040`
and whose project record carries `state: 'IL'`.

**This was never a jurisdiction problem.** The AHJ determination was correct on
both packages.

Thirteen renderers read `compliance.jurisdiction.state`. That record is computed
**client-side** by `getJurisdictionInfo()` on the Engineering page and then frozen
into the posted `permit_input`. Run without an address it returns the literal
sentinel `state: 'Unknown'`, `stateCode: 'UNKNOWN'` (`lib/jurisdiction.ts:200`).
Verified on the stored `permit_input.json` for the Planset 14 generation
(`upload_date 2026-07-30T17:48:54Z`):

```
compliance.jurisdiction.state      = "Unknown"
compliance.jurisdiction.stateCode  = "UNKNOWN"
compliance.jurisdiction.ahj        = "City of Granite City Building & Zoning"   (stale)
project.state                      = "IL"        ← the canonical value, two fields away
project.address                    = "3 MELVIN DR APT A, GRANITE CITY, IL 62040"
```

**The sentinel is truthy.** Every `|| '—'` renderer fallback walked past it, and
so did the permit route's own repair, `if (!body.compliance.jurisdiction.state)
body.compliance.jurisdiction.state = sc` (`app/api/engineering/permit/route.ts`).
Nothing failed; the canonical state was simply never consulted.

### 1.2 State propagation source map

| Stage | Field | Planset 14 value | Now |
|---|---|---|---|
| Project address | `project.address` | `…, GRANITE CITY, IL 62040` | unchanged |
| Postal parser | *(none existed for the permit path)* | — | `parsePostalStateCode()` |
| Project record | `project.state` | `IL` | unchanged (leads) |
| Compliance jurisdiction | `compliance.jurisdiction.state` | **`Unknown`** | repaired in `generatePermitHTML` |
| Boundary determination | Census place layer | unincorporated | unchanged |
| AHJ authority object | `codeAuthority.ahjName` | Madison County | unchanged |
| Internal AHJ registry | `ahj-national` `stateCode`/`stateName` | `IL` / `Illinois` | offered as a candidate |
| Snapshot schema | `projectAuthority.stateCode` | `IL` (present, unread) | + **`stateName`** + `stateAuthority` trace |
| Planset title block | `compliance.jurisdiction.state` | **`Unknown`** ×16 | `projectProjectStateFromInput()` |
| Governing-code table | `${state} AMENDMENTS` | **`Unknown AMENDMENTS`** | `Illinois AMENDMENTS` |
| PE-1 | `compliance.jurisdiction.state` | **`Unknown`** | canonical, tagged |
| CERT / PE-1F / PE-1G / PE-1R | same | same | canonical |
| Validation sheet | same | same | canonical (+ AHJ single-sourced) |
| Interconnection page | `state.toUpperCase()` vs `'IL'` profiles | **silently matched nothing** | `stateCode` |
| Manufacturer-doc jurisdiction | `codeAuthority.ahjName` | Madison County | unchanged |
| Requirement evidence | grounding `selection.jurisdiction` | Madison County | unchanged |

The interconnection lookup is a second, previously-invisible defect the same
field caused: it uppercased the **display name** and compared it against profiles
keyed by two-letter code, so every Illinois project fell through to the generic
PTO roadmap. It now consumes the canonical code.

### 1.3 Canonical model

`lib/permit/snapshot/locationAuthority.ts` (new) — pure, total, one derivation:

```
stateCode: 'IL'        stateName: 'Illinois'
```

* `normalizeStateCode()` — accepts a code in any case or a full state name;
  **rejects** `Unknown`, `UNKNOWN`, `N/A`, `NA`, `TBD`, `PENDING`, `—`, `-`,
  `None`, `null`, `?`, blank, and any two-letter token that is not a state.
* `parsePostalStateCode()` — anchored on the postal shape (state token
  immediately before a 5(+4)-digit ZIP, else the final comma-separated token,
  else a spelled-out name), so `MELVIN DR` never makes a project Delaware.
* `resolveProjectStateAuthority()` — precedence `project.state` →
  postal address → bound AHJ record → posted compliance jurisdiction. Records
  every candidate, the winning source, the basis sentence and any conflict.
  No input ⇒ `null`, never a default jurisdiction and never `Unknown`.

`projectAuthority` now freezes **both forms** plus the derivation trace
(`stateAuthority`), and `projectAuthorityProjection` exposes the one accessor —
`projectProjectStateFromInput()` — that every sheet reads. A null state displays
`—`. Values are tagged `data-project-field="state-name"` / `"state-code"` so the
truth matrix and the render invariant can find them.

`generatePermitHTML` additionally **repairs the posted record in place** whenever
it disagrees with the canonical state, so a frozen input never carries a sentinel
beside the real value.

### 1.4 The invariants

**V46 (snapshot, blocking)** — fires when:
* a US postal address carries a recognized two-letter code but the frozen project
  location reports no state;
* `stateCode` is present and `stateName` is absent (or the reverse);
* either form carries an `Unknown`-class sentinel;
* two **authoritative** sources (project record / postal address / AHJ registry)
  name different states.

A disagreement from the client-computed `compliance.jurisdiction` is reported as
`deferred`, not blocking: no sheet reads it, generation repairs it, and refusing
to generate over a stale client field would be the same mistake in reverse.
An address that genuinely carries no state leaves the record null and does **not**
fire — null prints `—`, which is honest.

**V47 (render, blocking)** — over the assembled sheets: no tagged state
projection may be an `Unknown`-class sentinel; none may disagree with the frozen
record; none may print `—` while the record knows the state; and no two sheets
may print different states.

Neither invariant references this project.

---

## 2. REPAIR A — THE IQ8A PRODUCT-GROUNDING CLOSURE

### 2.1 Why the verdict was pending

The archived evidence was already exactly applicable: `IOM-00068-3.0-EN`
(sha256 `65167d4d8abd81867575a7f467b68fe0155e5b954fc0077876da2729a284208e`),
Revision 3.0 May 2026, North America, naming `IQ8A-72-2-US` (§8.4) and
`Q-12-10-240` / part `840-00387` (§6.4/§8), with module and mounting scope
explicitly `NOT_APPLICABLE`. The verdict stayed `not-applicable` for exactly one
reason, recorded verbatim by the resolver:

```
the selected connector architecture: nothing is selected on the project to verify the claim against
```

`build.ts` passed `connectorArchitecture: null` into the grounding selection.

### 2.2 Connector-architecture derivation trace

```
TRUNK_CABLE_SYSTEMS[Enphase]
  .connectorArchitecture = 'iq-q-cable-drop-connector'      ← NEW, canonical, per brand
        │  (the same object that already supplies the branch system, the connector
        │   family, the terminator, the field-wireable connector pair, the sealing
        │   cap, the splice-install rule and the raw-cable stock)
        ▼
resolveTrunkCablePlan({brand:'Enphase', orientation:'portrait', …})
  → plan.cable.sku = 'Q-12-10-240'   plan.system.connectorArchitecture
        ▼
ListedCableAssembly.connectorArchitecture                    ← NEW field on the snapshot
        ▼
resolveOpenAirGroundingAuthority({ selection: { cableSku, connectorArchitecture } })
        ▼
verifyGroundingDocumentApplicability → connectorArchitectures dimension MATCHES
        ▼
outcomeFromDocument → NO_SEPARATE_EGC_REQUIRED
```

Not hardcoded to Braidon. Not inferred from a display string, a product name or a
document title. **No default**: a micro brand with no catalogued trunk system
yields `null` and the authority stays pending. `integrated-mc4` is a separate,
non-equivalent architecture id and the evidence accessor returns `null` for it.
The resolved architecture is now also recorded on the authority record as
`selectedConnectorArchitecture` so a reviewer can see what the document was
tested against.

Every catalogued brand carries its own architecture id
(`ap-ac-bus-drop-connector`, `hoymiles-ac-trunk-modular`,
`nep-bdm-molded-t-trunk`), asserted distinct.

### 2.3 Authority separation — preserved and asserted

| Item | State |
|---|---|
| IQ8A **product** grounding | `NO_SEPARATE_EGC_REQUIRED` — closed |
| `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` | **closed** |
| `PENDING-RACKING-ASSEMBLY-SELECTION` | **open** |
| `EQUIPMENT-DOCUMENT-APPLICABILITY` | **open** |
| `gnd-array-bond.bondingMethod` | `null` |
| `gnd-array-bond.manufacturerEvidenceId` | `null` |
| `gnd-array-bond` calculated minimum | `#12 AWG Cu` (NEC 250.122 @ 20 A) |
| `gnd-array-bond` selected design | `#10 AWG Cu` (project-design-standard) |
| Rail selection | `railSku: null`, `railModel: PENDING …` |
| IQ8A microinverter EGC | not created |
| Root gate count | unchanged at 6 (other children keep their gates open) |

### 2.4 The eight refactored tests

The earlier experimental flip broke eight tests. Each asserted "the outcome is
PENDING" by reading the **live** package — a fact about the evidence archive, not
a safety property. Each is now pointed at a **synthetic pending fixture**
(`tests/fixtures/synthetic-pending-grounding.ts`), pending for one precise,
named, verifiable reason, with every other applicability dimension matching, so
the specificity contract is exercised rather than weakened. Pending is
manufactured through the build's own `groundingDocumentEvidence` socket — the
live project is never forced back to pending.

| # | Test | Property it actually guards | Fixture |
|---|---|---|---|
| 1 | `ppc §1 — open-air branch rows render the NON-ASSERTION label` | while pending, every branch row renders the non-assertion label and no size / `with circuit conductors` / `PASS` / `250.122` | `wrongConnectorArchitecture`, and asserts the failure names the connector-architecture dimension |
| 2 | `ppc §2 — the GROUNDING blocker renders Ray's full field list` | the grounding payload component renders its twelve fields | same |
| 3 | `ppc §7 — the projected graph gives every object an id, raceway, length` | while pending: FREE AIR, no borrowed conduit, no size, no length, `design-quantity-non-orderable` | same |
| 4 | `ppc §9 — the DEFICIT component renders on the RIGHT blocker only` | two payload templates on one sheet, each only for its own blocker | same, applied to the procurement-insufficient input |
| 5 | `ecd W1-A — the two rows with NO ordinal id` | content-derived `bomLineId` covers a row with no ordinal id | the candidate open-air EGC row exists only while pending |
| 6 | `ecd W1-A — the cross-object reference is a REAL row id` | same row, id ≠ part number | same |
| 7 | `rgm §5 — payload detail box keyed by canonical schema` | the component is selected by declared schema | `wrongConnectorArchitecture` package |
| 8 | `tac WS-17 — nothing is dropped` | a gated sheet states its remainder with a pointer | rewritten to read the expectation from the banner model, **plus** a new non-vacuous case on the pending package |

Nine pending conditions are available and all verified to produce
`PENDING_MANUFACTURER_AUTHORITY` with the blocker pushed: missing / unknown /
wrong connector architecture, wrong micro SKU, wrong cable SKU, wrong region,
missing archived hash, superseded revision, family-scope-only claim.

### 2.5 One scanner defect surfaced by the closure

`gate 1` of `planset-evidence-ppc.mjs` (and its identical predicate in the unit
test) flagged the **closed** rendering as an installed-EGC assertion:

```
OPEN-AIR GROUNDING METHOD: LISTED INTEGRATED METHOD … — NO ADDITIONAL OPEN-AIR EGC INSTALLED IN THIS SECTION
```

The negation window allowed exactly one qualifier word between the negator and
the noun, so `open-air` made the scanner read the statement as its own opposite.
The window is now a bounded run (≤3 qualifiers), with two new non-vacuity probes:
the same qualifier words in a **positive** statement must still be caught, and the
honest closed rendering must not be. Fixed in both places so they cannot drift.

---

## 3. VENT GEOMETRY PROVENANCE

The fourth obstruction on Planset 14 is **legitimate**. Traced, not assumed:

| Question | Answer |
|---|---|
| Obstruction id | `nm-obs-66` — index 66, the **last** entry of `project.roofObstructions` |
| Type / description | `vent` — `"vent pipe (aerial vision — field verify)"` |
| Source | the aerial-vision sweep (`detectAerialVisionObstructions`), which appends **after** the Nearmap AI set |
| Nearmap contribution | 66 records (53 Vent + 9 A/C + 3 chimney + 1 satellite); cache row for this parcel unchanged since **2026-07-08**, survey **2026-02-27** |
| Coordinates | 38.7061454, −90.0463647 (4-vertex polygon) |
| Dimensions | radius capped at the per-type vent cap 0.30 m; clearance 0.15 m |
| Roof-plane binding | `e723bc07-5d55-48c5-9c58-dabcc746fd83` — 21.7 m², **0 modules** |
| Clearance impact | none on module placement or fire access (host plane carries no modules) |
| Existed before Planset 14? | not in the Planset 13 input; **not in the current live input either** |
| Duplicate merge? | **No** — pairwise separations 2.71 / 5.46 / 9.55 / 15.01 m; nearest pair 2.71 m |
| Stale record / fallback? | **No** — no CAD or obstruction-geometry code changed between the two code points (`16bf47a4..b49d7333` touched only the PV-1 deck-mount note text in the roof template) |

**Finding worth Ray's attention:** the aerial-vision sweep is a live model call
that runs per generate, so the obstruction set is **not deterministic between
generates**. It produced one extra vent on the Planset 14 generate and **none**
on the live generate of 2026-07-30 18:58 UTC — the current live package plots
three. That is a real nondeterminism in a geometry input, not a defect introduced
by this repair, and it is flagged rather than fixed here.

A geometry-identity test was added anyway (`obstruction-geometry-identity.test.ts`):
distinct features stay distinct, ids are unique, off-roof records are dropped, a
duplicated feature is visible to the identity scan rather than silently merged,
and a vision-sourced record keeps its field-verify provenance.

---

## 4. LIVE ACCEPTANCE REPORT

Both runs are the route-faithful regeneration (`_tmp_rr_live_regen.ts`) over the
**same** stored `permit_input.json`, one resolver lifecycle, live providers.

> The stored input was overwritten by a fresh app generate at
> `2026-07-30T18:58:14Z` **during** this work (67 → 66 obstructions; the client
> wrote `Illinois` on that run instead of `Unknown`). Both rows below use that
> current input, so the comparison is apples-to-apples. The `Unknown` regression
> is therefore no longer reproducible from the live input — which is exactly the
> point: the sentinel is intermittent, and the repair makes it irrelevant.

| | Before (`b49d7333`) | After |
|---|---|---|
| Snapshot ID | `PDS-D476ECA7BD9B` | `PDS-6E5372928F5D` |
| Sheet count (design-review) | 16 | **16** |
| Open gates | 6 | **6** |
| Unresolved requirements | 16 | **15** |
| IQ8A product-grounding outcome | `PENDING_MANUFACTURER_AUTHORITY` | **`NO_SEPARATE_EGC_REQUIRED`** |
| IQ8A evidence verdict | `not-applicable` | **`applicable`** (0 failures) |
| Connector architecture | *(absent)* | **`iq-q-cable-drop-connector`** |
| Bound document / hash | — | `IOM-00068-3.0-EN` / `65167d4d…` |
| `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` | open | **closed** |
| `PENDING-RACKING-ASSEMBLY-SELECTION` | open | **open** |
| `EQUIPMENT-DOCUMENT-APPLICABILITY` | open | **open** |
| State code | `IL` | `IL` |
| State name (frozen record) | **`undefined`** | **`Illinois`** |
| AHJ name | Madison County Building & Zoning | **unchanged** |
| Title-block state text | `Illinois` (untagged, from the client field) | **`Illinois`** (canonical, tagged) |
| PE-1 state text | `Illinois` | **`Illinois`** |
| Tagged state projections | 0 | **18**, all `Illinois` |
| Visible incorrect `Unknown` projections | 0 on this input, **20 on Planset 14** | **0** |
| `gnd-array-bond` minimum / selected | `#12 AWG` / `#10 AWG` | **unchanged** |
| `gnd-array-bond.bondingMethod` | `null` | **`null`** |
| Deck-only attachment | prohibited | **prohibited** (`DECK-MOUNT` absent) |
| Vent obstruction provenance | 3 plotted | **3 plotted** (identical) |
| Page clipping (16-sheet) | 0 | **0** |
| Page clipping (26-sheet full) | 0 | **0** |

Registry diff: `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED` closed; **nothing opened**.

The full/internal profile is **26** sheets, not 25 (`RS-1` paginates to `RS-1.3`
on this registry). Reported as measured.

---

## 5. TEST COMMANDS AND ACTUAL RESULTS

```bash
npx tsc --noEmit                                   # clean
npx vitest run                                     # 8871 passed | 8 failed | 489 skipped (9368)
```

The 8 failures are **pre-existing at `b49d7333`** and untouched by this work
(verified by stashing and re-running): 5 × `phase1a-migration-governance`
(the manifest still expects a highest prefix of 116; migration 117 landed in
`27abfb42`), 2 × assisted-evidence boundary-guard adapters, 1 × crew-calendar
`weekStart`. Baseline before this change: 8824 passed | 8 failed.

| Required item | Command | Result |
|---|---|---|
| 1 Connector-architecture derivation | `vitest run tests/planset/qcable-connector-architecture-closure.test.ts` | **19/19** |
| 2 Integrated-MC4 mismatch | same file, §3 | **4/4** |
| 3 Eight refactored pending-render tests | `ppc-ws1…` **35/35**, `ecd-ws1…` **35/35**, `release-gate-rendering-rgm` **38/38**, `tac-ws17…` **13/13** | all pass |
| 4 Evidence-specificity suite | `vitest run tests/planset/p13-evidence-specificity.test.ts` | pass |
| 5 IQ8A live closure | closure test §4 + live regen | **`NO_SEPARATE_EGC_REQUIRED`** |
| 6 Grounding authority separation | closure test §5 + `p13-ws1-grounding-topology` | pass |
| 7 Canonical state normalization | `state-propagation-regression.test.ts` §1 | pass |
| 8 Postal-state propagation | §2–§4 | pass |
| 9 AHJ / project-state consistency | §3, §5 | pass |
| 10 Snapshot anti-`Unknown` invariant (V46) | §5 | pass |
| 11 Title-block state projection | §7 | pass |
| 12 PE-1 state projection | §7 | pass |
| 13 Governing-code state projection | §7 | pass |
| 14 Vent geometry provenance | `obstruction-geometry-identity.test.ts` | **6/6** |
| 15 Full planset suite | `vitest run` | as above |
| 16 Typecheck | `tsc --noEmit` | clean |
| 17 Evidence harnesses | see below | no regression; `ppc` **improved** |
| 18 Pagefit — 16-sheet design review | `node scripts/planset-pagefit.mjs` | `sheets=16 clipped=0 … sheet-specific-fails=0` |
| 19 Pagefit — full/internal | same | `sheets=26 clipped=0 … sheet-specific-fails=0` |
| 20 Production build | `npm run build` | **exit 0** |
| 21 Live Braidon regeneration | `_tmp_rr_live_regen.ts` | 16 / 6 / **15** |
| 22 Chromium print/PDF render | `planset-pagefit --png`, print-media PDF | 16 sheet PNGs + 2.4 MB PDF |

### Evidence harnesses (same artifact, before vs after)

| Harness | Before | After |
|---|---|---|
| `bar` | 12/14 | 12/14 *(pre-existing: wind-snow provenance, report-equals-rendered)* |
| `bar-wse` | 36/36 | **36/36** |
| `co` | 20/20 | **20/20** |
| `ep` | 21/22 | 21/22 *(pre-existing: no-unselected-racking-orderable)* |
| `ppc` | 18/18 | **18/18** *(gate 1 repaired — see §2.5)* |
| `rgm` | 17/17 | **17/17** |
| `rp` | 20/20 | **20/20** |
| `w3` | 1 disagreement (`windSpeedMph` formatting) | identical |
| `w4` | 14/15 *(§15 utility-name)* | identical |
| `ecd` | builds its own model — regenerate via `scripts/ecd-artifacts.ts` before reading | unchanged |

---

## 6. CHANGED FILES

**New**
* `lib/permit/snapshot/locationAuthority.ts` — the canonical state authority
* `tests/fixtures/synthetic-pending-grounding.ts` — nine precise pending conditions
* `tests/planset/state-propagation-regression.test.ts` — 34 assertions
* `tests/planset/qcable-connector-architecture-closure.test.ts` — 19 assertions
* `tests/planset/obstruction-geometry-identity.test.ts` — 6 assertions

**Changed**
* `lib/equipment/trunkCable.ts` — `TrunkConnectorArchitecture` + one per brand
* `lib/permit/snapshot/types.ts` — `ListedCableAssembly.connectorArchitecture`
* `lib/permit/snapshot/build.ts` — architecture derived from the selected assembly;
  state candidates threaded into `buildProjectAuthority`
* `lib/permit/snapshot/groundingAuthority.ts` — `selectedConnectorArchitecture`
* `lib/permit/snapshot/projectAuthority.ts` — `stateName` + `stateAuthority` (schema 1.1.0)
* `lib/permit/snapshot/projectAuthorityProjection.ts` — the one state accessor + tags
* `lib/permit/snapshot/validate.ts` — **V46**
* `lib/permit/generatePermit.ts` — canonical repair of the posted record + **V47**
* `lib/permit/utils/titleBlock.ts`, `utils/peLetter.ts`,
  `sections/coverSheet.ts`, `sections/certPages.ts`, `sections/validationPage.ts`,
  `sections/interconnectionPage.ts` — consume the canonical projection
* `scripts/planset-evidence-ppc.mjs` — negation window + two non-vacuity probes
* the eight refactored tests + three cable fixtures + `snapshot-w1` fixture

---

## 7. WHAT REMAINS OPEN

* The 15 unresolved requirements above — unchanged except the one that closed.
* The aerial-vision sweep's run-to-run nondeterminism in the obstruction set (§3).
* Five stale `phase1a-migration-governance` assertions expecting a highest
  migration prefix of 116; migration 117 exists. Not touched — migration 117 is
  out of scope for this repair.
* WS-2 Q-Cable procurement — unblocked once this artifact is accepted.
