# BRAIDON WS-2 — Q-CABLE PROCUREMENT CLOSURE

Continues from `7c09fa9d`. The IQ8A grounding closure, the Illinois state
propagation, the Madison County jurisdiction, WS-1 grounding topology, WS-4
racking architecture and migration 117 are untouched and re-asserted below.

---

## 0. THE HEADLINE FINDING

**`Q-12-RAW-300` — the raw-stock SKU the brief expected to close this — is not
manufacturer-established, and it is not the manufacturer's method.**

It appears in NO archived Enphase document. The archived, hash-bound
`IOM-00068-3.0-EN` (sha256 `65167d4d…`, Rev 3.0 May 2026, North America) tables
the listed IQ Cable variants and enumerates every IQ Cable accessory, and names
no bulk / raw / reel / spool cable stock product at all — those words do not
occur in its bytes. Its documented method for an arbitrary-length segment is:

> §4.4 "Cut each segment of cable to meet your planned needs."
> §6.4 "To transition between cable types, install an IQ Field Wireable Connector pair."

Two unit traps sit on that SKU, and both are now pinned by test:

* the catalog itself describes it as **300 METRES** (~984 ft), not 300 feet — a
  reader taking "300" off the SKU name understates a purchase threefold;
* the purchase unit for the listed cable is a **BOX OF CONNECTOR SECTIONS**
  (240 for `Q-12-10-240`), not a footage.

So the resolution **rejects** the raw-stock SKU and buys the listed cable, cut to
length and joined with the documented field-wireable pair. The brief's
illustrative "1 × 300 ft, 275.8 ft remaining" would have been wrong on the
product, the unit and the arithmetic.

---

## 1. WS-2A — PRODUCT-CHAIN TRACE (SOURCE MAP)

| Procurement fact | Source of truth | Value on the live design |
|---|---|---|
| Selected trunk system | `TRUNK_CABLE_SYSTEMS[Enphase]` | IQ Q-Cable |
| Connector architecture | `TrunkCableSystem.connectorArchitecture` (WS-1) | `iq-q-cable-drop-connector` |
| Selected cable SKU | `resolveTrunkCablePlan` → `plan.cable.sku` | `Q-12-10-240` |
| Drop-connector spacing | `TrunkCableSpec.connectorSpacingFt` | 4.25 ft (1.3 m) |
| Branch topology | `electrical.qcableTopology` (`buildQCableTopology`) | 3 branches, 31 drops |
| Branch module counts | `qcableTopology.branches[].moduleCount` | 11 / 10 / 10 |
| Existing trunk lengths | `procurementSufficiency.perBranch[].procurementLengthFt` | 54 / 49 / 49 ft |
| As-routed installed path | `perBranch[].designedInstalledLengthFt` | 64 / 63.2 / 39.3 ft |
| Sub-array bridge | `qcableTopology.bridgeRequirements` | 1 × 29.3 ft on B2 @ drop 9 |
| Raw stock record | `TrunkCableSystem.rawCable` | `Q-12-RAW-300`, **`unverified-catalog`** |
| Package (stock unit) | archived IOM §3.1 cable table | 240 connector sections per box |
| Field-wireable connectors | archived IOM §6.4/§6.5 | `Q-CONN-10M` / `Q-CONN-10F` |
| Terminator | archived IOM §3.1 + §6.5 | `Q-TERM-10`, **2 per branch circuit** |
| Sealing cap | archived IOM §6.5 | `Q-SEAL-10`, 1 per unused connector |
| Cable support | archived IOM §6.4/§6.5 | `Q-CLIP-100`, support ≤ 6 ft |
| Junction-box transition | archived IOM §3.2 "Other items" | **no Enphase SKU** — a generic component |
| Slack / service-loop allowance | archived IOM §4.4 | instruction only, **no published number** ⇒ allowance 0 |
| Installation document | `enphaseFieldTerminationEvidence` | `IOM-00068-3.0-EN` Rev 3.0, sha256 `65167d4d…` |
| BOM | `bomForPermit` §5f.3 | consumes `electrical.qcableProcurement` |
| Procurement engine | `resolveQCableProcurement` (new) | `electrical.qcableProcurement` |
| Branch allocation | `procurementSufficiency.perBranch` | the SAME rows every sheet prints |

No procurement fact is derived from renderer wording, a product name, a reseller
listing or a search result.

---

## 2. WS-2B — `Q-12-RAW-300` COMPATIBILITY REPORT

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Manufacturer | Enphase (claimed by the catalog) | `trunkCable.ts` |
| 2 | Product family | claimed bulk IQ Cable stock | catalog only |
| 3 | Orderable stock length | catalog says **300 m ≈ 984 ft** — never 300 ft | catalog description |
| 4 | Region | not stated | — |
| 5 | Voltage / current rating | not stated | — |
| 6 | Conductor configuration | 12 AWG claimed | catalog |
| 7 | Connector architecture | not stated | — |
| 8 | Field-termination eligibility | **not established** | no archived document |
| 9 | Compatible field-wireable connector | — | — |
| 10 | Compatible terminator | — | — |
| 11 | Compatible sealing cap | — | — |
| 12 | Compatible j-box transition | — | — |
| 13 | Cut / installation constraints | — | — |
| 14 | Branch-circuit compatibility | **not established** | — |
| 15 | Listing / certification | **not established** | — |
| 16 | Applicable installation manual | **none** | the archived IOM does not name the product |
| 17 | Document revision | n/a | — |
| 18 | Archived evidence hash | **none** | — |

**Verdict: REJECTED.** Marked `verificationState: 'unverified-catalog'` in the
catalog with the reason recorded; it may be REPORTED (and is, on PV-4B.1) and may
never be purchased against or used to satisfy a length deficit.

**Next valid option, evaluated automatically:** the listed cable itself
(`Q-12-10-240`), which the archived manual both tables with its packaging and
instructs the installer to cut and terminate.

---

## 3. WS-2D — BRANCH-ALLOCATION REPORT

Nothing is netted across branches. A Q-Cable branch is one continuous run, so a
surplus on one branch cannot supply another.

| Branch | Ordered | Required installed | Shortage | Surplus | Allocated |
|---|---|---|---|---|---|
| B1 | 54 ft | 64 ft | **10.0 ft** | — | 3 × 4.25 ft section = 12.8 ft |
| B2 | 49 ft | 63.2 ft | **14.2 ft** | — | 4 × 4.25 ft section = 17.0 ft |
| B3 | 49 ft | 39.3 ft | — | **9.7 ft (NOT redistributable)** | none |

```
AGGREGATE FOOTAGE          166.5 + 0 allowance − 152 = 14.5 ft
TOPOLOGY-CONSTRAINED       B1 10.0 + B2 14.2        = 24.2 ft   ← GOVERNS
NON-REDISTRIBUTABLE SURPLUS                            9.7 ft
```

24.2 − 9.7 = 14.5: netting them reproduces the aggregate figure, which is exactly
the error the rule exists to prevent. Both figures are carried; the
topology-constrained one governs; the surplus is retained as non-redistributable.

Allocations are **whole connector sections** — the cable is cut at a connector, so
a fractional foot is not a purchasable increment. Each allocation therefore lands
on or above its own branch's shortage and never below it.

---

## 4. WS-2E — ACCESSORY CALCULATION

Every quantity comes from an actual branch modification and an archived per-unit
rule. No generic quantities.

| SKU | Qty | Derived from | Evidence section |
|---|---|---|---|
| `Q-CONN-10M` | 3 | 1 join on B1 + 2 on B2 (1 cable join + 1 sub-array bridge) | §6.4 + §6.5 |
| `Q-CONN-10F` | 3 | matched pair for the same joins | §6.4 + §6.5 |
| `Q-TERM-10` | 6 | 2 per branch circuit × 3 branches | §3.1 + §6.5 |
| `Q-SEAL-10` | 15 | 8 unused molded connectors + 7 on the newly allocated sections | §6.5 |
| `Q-CLIP-100` | 28 | support every 6 ft over the 166.5 ft installed path | §6.4 + §6.5 |
| junction-box transition | — | **no Enphase SKU exists**; §3.2 lists the AC junction box as a generic "other item" alongside screwdrivers and a voltmeter | §3.2 |

The j-box is therefore not a missing accessory SKU — it is not a manufacturer
accessory at all, and it is recorded as such rather than left as a silent gap.

---

## 5. WS-2F — PROCUREMENT QUANTITY

```
INSTALLED additional requirement   24.2 ft   (governing, per-branch — NOT an order quantity)
Purchase unit                      Q-12-10-240 — box of 240 connector sections @ 1.3 m (Portrait)
Usable length of one package       240 × 4.25 ft = 1020 ft
Sections required (whole job)      31 base + 7 allocated = 38
Packages required                  1
Packages beyond the base order     0        ← the shortfall costs no extra package
Total stock purchased              1020 ft
Installed path                     166.5 ft
EXPECTED REMAINING STOCK           853.5 ft
```

Packaging is applied ONCE, over the whole job. Computing packages for the
shortfall alone would order a second box for seven sections that fit inside the
box the base order already buys — a phantom purchase.

The remainder is ordinary stock left in the box: not a shortfall, and not waste
attributable to this design. `275.8 ft` (the brief's illustration) is explicitly
not produced, and a test asserts it never is.

Cut loss and service loops are included **only when governed**: the archived
manual instructs the installer to "allow extra length for slack" but publishes no
number, so the allowance stays **0 ft** with provenance
`no-allowance-authority-recorded`.

---

## 6. WS-2G — PROJECTION + SCHED CORRECTIONS

**BOM** (`bomForPermit` §5f.3): the trunk row is ORDERABLE and states the order,
the package, the sections, the remainder and the method; each accessory row
carries the canonical quantity, `quantityState: established`, and its evidence
section. The stale `CANDIDATE_NON_ORDERABLE` hint on the field-wireable
connectors is cleared — it existed because only an operator-selected extension
product could establish the splice method; the archived manual now states it.

**PV-4B.1**: one merged per-branch table (derivation **and** allocation) plus the
`Q-CABLE PROCUREMENT RESOLUTION — INSTALLED vs PURCHASED` block. Two stacked
tables overflowed the printable box by 164 px, so they were merged rather than
paginated.

**PV-4B**: the inline line states the order in packages and labels 24.2 ft as an
installed length.

### The two stale SCHED statements

**(a) Grounding.** SCHED printed:

```
GROUNDING AUTHORITY: PENDING MANUFACTURER AUTHORITY
```

Root cause: the predicate was `_gnd.verificationState !== 'verified'`, and that
field is a **prose sentence** (`'verified manufacturer document (exact-SKU
applicability confirmed)'`), so the test was true for **every** outcome. It now
keys on the OUTCOME and states each authority separately:

```
GROUNDING — IQ8A PRODUCT: NO SEPARATE EGC REQUIRED (verified manufacturer document IOM-00068-3.0-EN)
 · ARRAY/RACKING BONDING: METHOD PENDING (separate authority — UL 2703 assembly)
 · RACEWAY BONDING: per route-segment material
```

**(b) Apportionment.** SCHED printed "the Σ Q-Cable deficit is NOT apportioned per
branch". It now states the canonical allocation, from the resolution's own
numbers (no literal is typed):

```
Q-Cable: aggregate installed-length deficit 14.5 ft; the GOVERNING topology-constrained
requirement is 24.2 ft, allocated as B1 10 ft + B2 14.2 ft. The 9.7 ft surplus on B3 is
NOT redistributable under the current branch topology (a Q-Cable branch is one continuous run).
```

The per-branch cell no longer cites `QCABLE-PROCUREMENT-INSUFFICIENT` (a closed
requirement); it states the branch's own allocation.

---

## 7. REQUIREMENT REGISTRY

`QCABLE-PROCUREMENT-INSUFFICIENT` is **CLOSED**, and only because all ten
elements are established: compatible stock SKU · packaging · field-termination
method · connector SKUs · terminator/accessory SKUs · branch allocations ·
purchase quantity · expected remainder · BOM populated · evidence archived and
applicable.

Three **narrowly scoped** residual codes were added for the cases where one fact
is genuinely missing — so a missing accessory SKU can never masquerade as "the
whole cable procurement is unresolved":

```
QCABLE-STOCK-PACKAGING-UNVERIFIED
QCABLE-FIELD-CONNECTOR-SKU-MISSING
QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED
```

None is open on this design. Each is declared in `REQUIREMENT_DECLARATIONS`, keyed
in `BLOCKER_PAYLOAD_SCHEMA`, and owned by a REGISTERED derived resolver
(`qcable-procurement@v1`) — the framework refuses an AUTO_DERIVED declaration
whose resolver does not exist, and it caught exactly that during this work.

RG-6 (QCABLE_SYSTEM_CLOSURE) closed because its last open child closed. The count
was not forced: **15 → 14 requirements, 6 → 5 gates.**

---

## 8. LIVE BEFORE / AFTER

Same stored `permit_input.json`, route-faithful regeneration, one resolver
lifecycle, live providers.

| | Before (`7c09fa9d`) | After |
|---|---|---|
| Snapshot | `PDS-225ABFA9BA07` (Planset 15) | `PDS-84CB2ED3AAEE` |
| Sheets (design-review) | 16 | **16** |
| Open gates | 6 | **5** |
| Unresolved requirements | 15 | **14** |
| Selected Q-Cable SKU | `Q-12-10-240` | unchanged |
| Connector architecture | `iq-q-cable-drop-connector` | unchanged |
| Aggregate deficit | 14.5 ft | **14.5 ft** |
| Topology-constrained deficit | 24.2 ft | **24.2 ft** |
| B1 / B2 allocation | not allocated | **10.0 ft → 3 sections**; **14.2 ft → 4 sections** |
| B3 surplus | 9.7 ft | **9.7 ft, non-redistributable** |
| Selected stock SKU | none — "PENDING a VERIFIED listed extension" | **`Q-12-10-240`** (raw stock rejected) |
| Stock unit | — | **box of 240 connector sections = 1020 ft** |
| Packages purchased | — | **1** (0 beyond the base order) |
| Total stock purchased | — | **1020 ft** |
| Expected remaining stock | — | **853.5 ft** |
| `Q-CONN-10M` / `Q-CONN-10F` | 1 / 1, non-orderable candidate | **3 / 3, orderable** |
| `Q-TERM-10` | 3 | **6** (2 per branch circuit, per the manual) |
| `Q-SEAL-10` | 0, pending | **15, established** |
| `Q-CLIP-100` | absent | **28, established** |
| J-box transition | — | no Enphase SKU (generic component, recorded) |
| Compatibility verdict | — | **VERIFIED**, 0 unresolved |
| Evidence | — | `IOM-00068-3.0-EN#65167d4d8abd` |
| `QCABLE-PROCUREMENT-INSUFFICIENT` | OPEN | **CLOSED** |
| SCHED grounding line | `GROUNDING AUTHORITY: PENDING MANUFACTURER AUTHORITY` | separated, accurate |
| SCHED apportionment line | "NOT apportioned per branch" | canonical allocation |
| Grounding outcome | `NO_SEPARATE_EGC_REQUIRED` | **unchanged** |
| `gnd-array-bond` | #12 min / #10 selected / method null | **unchanged** |
| State / AHJ | IL · Illinois · Madison County | **unchanged**, 0 `Unknown` |
| Deck-only attachment | prohibited | **prohibited** (`DECK-MOUNT` absent) |
| Clipping (16 / 25 sheets) | 0 / 0 | **0 / 0** |

BOM rows added/changed: `Q-CLIP-100` (new, 28), `Q-SEAL-10` 0→15,
`Q-TERM-10` 3→6, `Q-CONN-10M/F` 1→3 each and promoted to orderable,
`Q-12-10-240` promoted to orderable with the order statement.

---

## 9. TEST COMMANDS AND ACTUAL RESULTS

```bash
npx tsc --noEmit                                   # clean
npx vitest run                                     # 8925 passed | 0 failed | 489 skipped (9414)
npm run build                                      # exit 0 — ✓ Compiled successfully
```

**The full suite is green for the first time in this campaign.** The eight
pre-existing failures are resolved, not silenced:

| Failure | Cause | Fix |
|---|---|---|
| 5 × `phase1a-migration-governance` | assertions still expected a highest migration prefix of 116 after 117 landed; two more compared Windows `\` paths against `lib/migrations` | `HIGHEST_GOVERNED_MIGRATION = '117'` named once; a `posix()` separator normalizer. Baseline / allowlist / single-use permit / ordering / checksum / audit behaviour untouched; **migration 117 itself is not modified or re-run** |
| 2 × assisted-evidence boundary guard | `execFileSync('npm', …)` cannot resolve `npm.cmd` on Windows → `spawnSync ENOENT` | invoke the guard script directly with `process.execPath` — same script, same assertion, no platform shim |
| 1 × `priority5-crew-calendar` | `new Date('2025-01-13')` parses as UTC midnight = Sunday in US Central, so `weekStart()` correctly returned the previous week | 16 date literals given an explicit local time (`T12:00:00`); the functions under test are local-time by design |

| Required item | Result |
|---|---|
| 1 Q-Cable catalog tests | `ws2-qcable-procurement` §1 — 5/5 |
| 2 Raw-stock compatibility | §1–§2 — rejected, reason recorded |
| 3 Field-termination | §2 — archived, hashed, exactly applicable |
| 4 Connector / terminator | §5 — quantities derived from branch changes |
| 5 Branch allocation | §3 — 14.5 / 24.2 / 10.0 / 14.2 / 9.7 all pinned |
| 6 Procurement quantity | §4 — integer packages, remainder reconciles |
| 7 BOM projection | §6 — trunk + 5 accessory rows |
| 8 SCHED projection | §6 — canonical apportionment, no stale sentence |
| 9 Requirement registry | §7 — closure requires all ten elements |
| 10 Existing grounding tests | `qcable-connector-architecture-closure` 19/19, `p13-*` green |
| 11 Evidence specificity | `p13-evidence-specificity` green |
| 12 Typecheck | clean |
| 13 Full planset suite | 1573/1573 |
| 14 Evidence harnesses | below |
| 15 Pagefit 16-sheet | `clipped=0 … sheet-specific-fails=0` |
| 16 Pagefit full | 25 sheets, `clipped=0` (26 on the unresolved variant, also 0) |
| 17 Production build | exit 0 |
| 18 Live regeneration | 16 / 5 / 14 |
| 19 Chromium PDF | 2.4 MB, 16 sheet PNGs |
| 20 Cross-sheet semantic scan | `rp` report-equals-rendered mismatches = 0; `ppc` gate 18 = 0 |

### Evidence harnesses (live artifact)

| Harness | Before (WS-1 baseline) | After |
|---|---|---|
| `bar` | 12/14 | **12/14** *(pre-existing: wind-snow provenance, report-equals-rendered)* |
| `bar-wse` | 36/36 | **36/36** |
| `co` | 20/20 | **20/20** |
| `ep` | 21/22 | **21/22** *(pre-existing: no-unselected-racking-orderable)* |
| `ppc` | 18/18 | **18/18** — and 18/18 on the UNRESOLVED artifact too |
| `rgm` | 17/17 | **17/17** |
| `rp` | 20/20 | **20/20**, 0 mismatches |
| `w3` / `w4` | 1 windSpeed formatting disagreement / 14/15 | identical |

Four harness gates were made **state-aware** rather than weakened: they described
what a package must say while the shortfall is UNANSWERED, and the measurement
(`ps.insufficient`) is not the same fact as the answer (`qcableProcurement`).
They now key on "short AND unanswered" and assert the resolved contract in the
other state. Each was verified to still pass on an artifact generated with the
field-termination authority REFUSED (`_tmp_unresolved_regen.ts`, the artifact-level
twin of `tests/fixtures/synthetic-unresolved-procurement.ts`).

### Two harness defects found and fixed

1. **`bar-wse` gate 7** flagged the sentence outcome A is *supposed* to print —
   `NO SEPARATE EGC REQUIRED` matched a bare `/SEPARATE EGC/` probe. The negation
   is now tested **per match** against the preceding text, with non-vacuity
   probes both ways.
2. **`bar-wse` contained three literal BACKSPACE bytes (0x08)** where regex
   word-boundary escapes belonged — including a pre-existing one in
   `(?<![A-Za-z-])VERIFIED\b`, which could therefore never match a word boundary.
   All three repaired. *(Cause: a non-raw heredoc. Same class as the standing
   PowerShell encoding hazard — worth adding to the standing rules.)*

---

## 10. WHAT REMAINS OPEN

* The 14 unresolved requirements above.
* `_schedTrunkBomNote` in `structuralPages.ts` is a **dead binding** — defined and
  never rendered (pre-existing). The procurement statement reaches the reviewer
  via PV-4B, PV-4B.1, the branch block and the BOM, so wiring it was not forced
  at the end of this pass; SCHED runs at zero printable slack and adding content
  needs its own pagefit pass.
* **Obstruction nondeterminism (carried forward, not addressed here):** aerial-vision
  obstruction extraction must not silently mutate canonical geometry during every
  planset generation. WS-2 does not touch generation orchestration, and no
  geometry regression was accepted — the obstruction count is unchanged.
* Next: **WS-3 conduit authority reconciliation.**
