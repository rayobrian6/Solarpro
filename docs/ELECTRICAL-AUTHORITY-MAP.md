# THE ELECTRICAL AUTHORITY MAP

**Audit date:** 2026-10-01 · **Against:** `origin/dev` at `d2a8acb8` · **Status:** audit complete,
implementation NOT started.

Ray, after live-testing the saved 400 A Tesla project:

> The same persisted project currently shows contradictory states simultaneously. System Config
> says `TESLA ecosystem applied` but on the same screen: Brand: Enphase IQ8, Topology: MICRO,
> Inverters: 37 microinverters… the generated SLD still shows an Enphase microinverter array, an
> Enphase AC combiner and a legacy solar AC disconnect, while simultaneously showing two Gateway 3,
> four PW3 and a 400 A service topology. That is a release-blocking contradiction.

> First identify why multiple authorities exist. This must be solved at the project-model level.

This document is the answer to the first half. It is the map, before any implementation.

---

## 0. HOW THIS WAS PRODUCED, AND WHAT IS VERIFIED

Eight independent read-only audits, one per authority dimension, then a synthesis pass and a
completeness critic. Every claim below carries a `file:line`.

🚨 **Claims marked ✔ were re-checked by hand in the main session.** The rest come from the audit
and carry its evidence but not a second pair of eyes. The distinction matters: several findings
are accusations against code written the day before, and those are exactly the ones a tired
auditor is most likely to get wrong in either direction.

---

## 1. THE SHORT ANSWER

**There is no project-level electrical model.** There are *three persisted JSONB stores plus two
snapshot tables*, each holding an overlapping subset of the same facts, written by different
surfaces, with no reconciliation and no precedence:

| Store | Written by | Holds |
|---|---|---|
| `projects.selected_equipment` | Design Studio pick, 5 further routes | panel, inverter, battery, counts, per-sub `topology` |
| `projects.engineering_config` | the engineering page | the whole config incl. every electrical scalar |
| `projects.service_topology` | the Service Topology tab only | the graph |
| `engineering_seed` | bill upload / preliminary | a complete *default* Enphase micro design |
| `engineering_runs.config_snapshot` | every calculate | a verbatim copy of the config |

…plus `localStorage eng-config-<id>`, a verbatim sixth copy, never version-checked
(`app/engineering/page.tsx:2695`, restored `:2246`).

The Service Topology graph is the newest of these and the only one that models the system as a
graph. **It reaches almost nothing.** ✔ Verified:

- `readServiceTopology` has **exactly two production callers** — `app/api/engineering/sld/route.ts:129`
  and `app/api/projects/[id]/service-topology/route.ts:37`. Everything else that imports it is a test.
- `app/api/engineering/permit/route.ts` — **0** references to `serviceTopology` or `solarCoupling`.
- `lib/bom-engine-v4.ts` — **0** references to `serviceTopology`.
- `app/api/engineering/sld/pdf/route.ts` — **0** references.

So the graph draws one sheet, on one tab, in one browser session, and nothing else in the product
has heard of it.

---

## 2. CORRECTIONS TO WHAT THIS PROJECT PREVIOUSLY CLAIMED

🚨 These are mine, from the three preceding commits. They were reported as done and were not.

**(a) "BOM / pricing / permit / equipment schedule all consume the same physical instances."**
✔ **False in production.** `bomFromServiceTopology`, `pricedQuantitiesFromBom`,
`reconcileQuantities` and `legacyServiceScalars` have **test-only callers**
(`lib/bom/topologyBom.ts`, `lib/electrical/topologyEquipment.ts:206`,
`lib/electrical/topologyAuthoring.ts:815`). `tests/topologyReachesEveryOutput.test.ts` passes
because it calls those functions directly — it never drives the production BOM or permit path. A
passing guard that proves the function works, not that anything calls it. This is the
`a-passing-guard-can-be-blind` shape, self-inflicted.

**(b) `prohibitedPvEquipmentFor` enforces the coupling.** ✔ **Dead.** One occurrence in the repo:
its own definition at `lib/electrical/serviceTopology.ts:663`. The list of equipment a DC-coupled
design may not contain is never consulted by anything.

**(c) The sidebar now defers to the coupling.** ✔ **Only while the Service Topology tab is open.**
`ServiceTopologyBuilder` is mounted inside `{activeTab === 'service' ? … : null}`
(`app/engineering/page.tsx:12486`), and its `onTopologyChange` is the **only** writer of
`svcTopology` (verified: the identifier appears at `:1159, 9010, 9022-9029, 18132` and nowhere
else). On every other tab, and after every reload until you visit that tab, `svcTopology` is
`null` and the badge falls back to `config.inverters[0].type === 'micro' ? 'MICROINVERTER'`
(`:9012`). **This is the same conditional-mount defect as `show3D`**, already recorded in
`render-time-correction-is-not-geometry.md`, repeated.

**(d) The PV-to-battery assignment is modelled.** ✔ `setStoragePvInput` is written only by
`tests/raysRealFourHundredAmpJob.test.ts:984`; `addGenerationUnit` only by
`tests/derAggregationAndInterconnection.test.ts`. On a real DC-coupled job no PV can be assigned
to a Powerwall at all, so the per-unit STC check at `serviceTopology.ts:1999` can never fire
outside a test.

---

## 3. WHY THE LIVE PROJECT LOOKS THE WAY IT DOES

Ranked by directness to the reported screen. Each is a distinct mechanism; the screen needs
several of them at once, which is why it survived a green suite.

### 3.1 The kill-switch is optional, and nullable ✔

`lib/sld-professional-renderer.ts:4109` — `isMicro = !_couplingIsDc && (…)`. The Enphase chain is
suppressed **only** when `solarCoupling === 'dc-coupled-storage'`. But `:5240` drops the legacy
*service tail* on the graph's mere **presence**. Two different tests, one sheet.

So a project with a graph and `solarCoupling === null` renders **exactly the reported sheet**:
Enphase array + Enphase combiner + AC disconnect, beside 2 × Gateway 3, 4 × PW3 and a 400 A
service. Three ways to get a null coupling:

1. the graph was saved before schema v4 (`lib/db/serviceTopology.ts:85`) — **Ray's project**;
2. the wizard radio was never touched (`ServiceTopologyWizard.tsx:427`, which prints "Not selected");
3. the inspector radio was never touched (`ServiceNodeInspector.tsx:357`) — a *second* writer of
   the same switch, in a different pane.

### 3.2 There is a second, harder kill-switch nobody knew about ✔

`lib/db/serviceTopology.ts:422-423`:

```ts
const ratedAmps = numOrNull(service?.ratedAmps);
if (ratedAmps === null) return null;      // ← the WHOLE graph, discarded on read
```

A saved graph with no service rating reloads as **no graph at all**, dropping the project straight
into the all-scalars state. Nothing surfaces this; it looks identical to never having built one.

### 3.3 `config.inverters[].type` is a live second authority, and nothing reconciles it

The stored contradiction the sheet prints. `lib/electrical/serviceTopology.ts:1974` reports only
the *absence* of a coupling — a recorded coupling emits `pass()` and is never compared against the
equipment list. The save layer cannot even see the conflict: `subSystemMirror.ts:465` records
"inverter/topology per-inverter — null = unrepresentable" and `:150` treats null as compatible.

### 3.4 "TESLA ecosystem applied" is a write-once label

`config.ecosystemBrand` is written at `app/engineering/page.tsx:10725, 10750, 10913, 11458` —
and **not** by `applySizingRecommendation`, which writes `selectedBrand` (`:4462`) and
`subSystems[].ecosystemBrand` (`:4538`) instead. Any resize, heal or per-sub rebuild after a Tesla
apply leaves that row asserting a brand nothing else agrees with.

### 3.5 Every bill-upload project is *born* Enphase micro ✔

`app/api/engineering/preliminary/route.ts:43` —

```
panelWatts: 440,  panelId: 'qcells-peak-duo-400',   // a 400 W panel
inverterId: 'enphase-iq8plus', topologyType: 'MICROINVERTER', mainPanelAmps: 200,
```

Persisted as a structurally normal design. An ecosystem apply never rewrites the seed. Note the
wattage and the panel id disagree with each other in the literal itself.

### 3.6 An invented identity is read back as evidence

`app/engineering/page.tsx:3190` yields `'Enphase'/'IQ8+'` whenever `getInvById` misses — which the
stored `{type:'micro', inverterId:'se-7600h'}` shape guarantees — and
`lib/permit/utils/helpers.ts:298` then treats those strings as proof the design is micro.
`lib/permit/snapshot/resolution/equipmentSelection.ts:27` states product-name topology inference is
PROHIBITED.

### 3.7 Two `resolveTopology`s with opposite defaults

`lib/permit/utils/helpers.ts:309` → `'MICRO'`; `lib/topology-manager.ts:426` → `'STRING_INVERTER'`.
A third copy at `lib/system/systemDefinition.ts:336` omits `helpers.ts:300`'s
Sol-Ark/SMA/Fronius/Growatt/Huawei line, while `lib/system/systemAccessors.ts:74` *prefers* its
answer. The permit sheets can say MICROINVERTER while the BOM buys DC string wire.

### 3.8 The counts are each one of several answers

- **"37 microinverters"** — four re-derivations over three different panel counts
  (`lib/computed-system.ts:1312`, `page.tsx:6979`, `page.tsx:7345`, `helpers.ts:324` which returns
  `totalPanels` outright).
- **"4 AC branches"** — three (`computed-system.ts:1370` devices ÷ breaker-derived max;
  `lib/permit/utils/branching.ts:80` modules ÷ 13; `bom-engine-v4.ts:928` = rows). Every renderer
  call site omits the `manufacturer` argument that makes `microMaxPerBranch` correct.

---

## 4. THE REST OF THE MAP

Severity: **C** = two live authorities can disagree · **S** = a copy can go stale ·
**F** = an invented default · **OK**.

### 4.1 Existing service facts

| Fact | Should own | Competing today | |
|---|---|---|---|
| Service rating | `topology.service.ratedAmps` | `config.mainPanelAmps` (still an editable select at `page.tsx:10489`), `project_physical_data.panel_rating_amps`/`main_panel_rating_amps`, `engineering_runs.main_panel_rating`, `report_data.electrical.mainPanelBusAmps`, `\|\| 200` in every route | **C** |
| Busbar rating | `topology.panels[].busbarRatingA` | `config.panelBusRating`; `panel_rating_amps` (migration 013 calls it the bus) vs `busbar_rating_amps` (**written by nobody**); `?? mainPanelAmps` in ~8 readers; `normalizeSurvey.ts:579` proxies bus := main | **C** |
| Main breaker | `topology.panels[].mainBreakerA` | everything reading `mainPanelAmps` as the main (`electrical-calc.ts:954` sets *both* from it); phantom columns `site_conditions.main_breaker_amps`, `project_physical_data.main_breaker_amps` (no migration creates either) | **C** |
| bus ↔ main laundering | — | `engineering_runs.main_panel_rating` is **written from the busbar** (`page.tsx:6441`) and **read back as the main breaker** (`:2398`, and two more restore routes). One save→reload turns a fabricated 200 into a recorded measurement | **C** |
| Manufacturer | `existingEquipment.manufacturer` | `config.mainPanelBrand` seeded `'Square D'` at `page.tsx:617`; `sitePlan.ts:74` prints `'EXISTING'` | **C** |
| Voltage | `topology.service.voltage` | non-nullable, so "unknown" is unrepresentable; `db/serviceTopology.ts:456` coerces absent → 240 **on read**; `const acVoltage = 240` in 6 more places | **C** |
| Phase | `topology.service.phase` | `db/serviceTopology.ts:457` coerces anything unrecognised → `split-240`; second vocabulary `run.phase === '1Ø'` | **C/F** |
| Available fault current | `service.availableFaultCurrentA` | single owner, never defaulted — **the best-behaved fact in the repo**. Reaches no permit sheet only because the graph never arrives | **S** |
| Device/gateway SCCR | `devices[].sccrA`, `gateway.sccrA` | ✔ **no writer** (the inspector writes `existingEquipment`, `panel` and `aggregationPanel` SCCR at `:232, :682, :963` but only *displays* device SCCR at `:531`). `equipment-db.ts sccrOptionsA` has no consumer | **F** |

### 4.2 Storage

| Fact | Should own | Competing | |
|---|---|---|---|
| Powerwall count | `topology.storage[]` | `selected_equipment.batteryCount`, `.batteries[]`, `subSystems[].batteryCount`, `engineering_config.batteryCount` (default 0), localStorage, snapshot `equipmentSummary.batteryCount`, a DesignStudio `useState(1)`. The two write paths never call each other | **C** |
| "has a battery at all" | — | six incompatible predicates; a **non-persisted React toggle** decides whether the battery reaches the permit | **C** |
| Gateway count | `domains[].gateway` | `config.backupInterfaceId` (BOM always buys 1) and `plan.gatewayMultiplicity.count` — **a different fact under the same type name**. Every sheet printing "GATEWAYS (n)" reads the Enphase one | **C** |
| Commissioned output | `storage[].outputConfigKw` | **no UI writer**, and `setDomainEquipment` (`topologyAuthoring.ts:399`) silently rebuilds at the catalogue top row, deleting it and `pvDcStcKw` | **F** |
| Total kWh | graph sum | `page.tsx:9026` sums inverter-units only; `helpers.ts:91` multiplies a per-unit scalar. Three numbers | **C** |
| Aggregate AC | `resolveBatteryBranch` (genuinely consolidated) | `serviceTopology.ts:943` `if (acs.length === 0) return 0` — a domain whose storage ids fail to resolve **PASSES** its 120% check at 0 A | **C** |
| Expansions | `storage[]` role | no scalar can express them — which is exactly why folding a legacy `batteryCount` into the graph would put 6 Powerwalls' backfeed on a 4-Powerwall job | **OK** |

### 4.3 Interconnection

- **Load-side vs supply-side**: `config.interconnectionMethod` (`'LOAD_SIDE'` literal in ~20
  places), two snapshot twins, `project_physical_data.interconnection_point`, and **five different
  substring predicates**. A third vocabulary hides under the colliding name `interconnectionType`,
  typed `'load-side'` in one module (`lib/engineering/types.ts:233`) and `'Load Side Tap'` in
  another (`lib/segment-model.ts:237`) — so `segment-builder.ts:408`'s `===` can never match what
  `page.tsx:14456` puts there. **C**
- **Three `PoiRelationship` members the scalar predicates cannot express**:
  `manufacturer-integrated`, `meter-collar`, `unresolved` contain none of "load"/"supply"/"line",
  so `renderer:4195` classifies them as **BACKFED**. `topologyPresets.ts:581` sets
  `manufacturer-integrated` on **every generation-panel job** — i.e. on Ray's. **C**
- **`applyDerArrangement` appends instead of replacing** (`topologyPresets.ts:363`), unlike
  `applyIsolationArrangement:294`. Three radio clicks leave 5 POIs and a stale aggregation panel. **C**
- **Which panel a branch feeds**: two fallbacks with **opposite** predicates
  (`serviceTopologyGraph.ts:340` first *non*-backed-up panel; `renderer:7848` first backed-up). **F**
- **Sub-panel / MSP count never becomes a panel.** `hasSubPanel`/`subPanelRatingAmps` flow survey →
  normalise → report → hydration and **never** into `topology.panels[]`. **Genuinely absent.**
- **Per-unit assignment does not exist.** `domains[].storageUnitIds` is only ever rebuilt
  wholesale; there is no "move this Powerwall to Domain B". **Genuinely absent.**

### 4.4 Derived NEC values

Every one of these has a canonical implementation **and** inline copies:

| Rule | Canonical | Copies |
|---|---|---|
| 705.12(B) allowance | `lib/nec/rule705_12.ts:31` | ~20 inline, incl. `electricalFromSurvey.ts:262` `passes: true // don't fail on missing data` — **unknown → PASS**, which the engineering model explicitly forbids |
| EGC size | `manufacturer-specs.ts:201` | `segment-schedule.ts:290` back-populates **over** the canonical one at `computed-system.ts:2713` |
| DC string fuse 690.9(B) | `conductorAuthority.ts:241` | uncapped in 4 places |
| Micro branch OCPD | — none | `{20,30}` ladder vs the full 240.6(A) ladder → 30 A vs 25 A on one package |
| Service-entrance ampacity | — | `segment-schedule.ts:1113` sets `effectiveAmpacity = serviceAmps` with deratings pinned to 1.0, so `ampacityPass` is a **tautology** |
| 240.6(A) ladder | `electrical/stdSizes.ts:23` | `segment-schedule.ts:274` has a short ladder with `?? 200` *below* the request; `rules-engine.ts:172` `/5` yields non-standard 55/65/75 |

### 4.5 Projections

- **Permit input declares a graph field with 0 writers** — `PermitInput.project.serviceTopology`
  (`lib/permit/types.ts:214`) has 2 readers, no writer. `sldAdapter.ts:343` hands the renderer null.
- **The PDF export has no graph** and coalesces `mainPanelAmps || 200`. Screen and its own PDF differ.
- **The multi-lane (hybrid) sheet returns at `renderer:4056` before `_couplingIsDc` is computed at
  `:4108`**, and `singleSystemLane:6300` hardcodes `'MICROINVERTER'`.
- **`ecosystemTopology`, the field the renderer calls canonical, has one writer**
  (`sld/route.ts:1009`) out of five input builders — so on the permit, PDF, preliminary and hybrid
  paths the anti-contamination precedence is inert.
- **`plansetManifest.ts:63` selects which drawings the AHJ receives** from the MICRO-defaulting
  resolver.
- **A second hard-coded Enphase parts catalogue** at `app/api/engineering/enphase/route.ts:109`,
  where the combiner model *and* the gateway count are both chosen from the AC branch count — one
  of the three answers above.

---

## 5. WHAT THE MODEL HAS TO BECOME

Not a new store. The requirement is **one fact → one owner**, and the owners mostly already exist.

1. **`solarCoupling` must stop being optional.** A project has an answer or it has an explicit
   unresolved state that *blocks* rendering an architecture — never a null that each consumer fills
   in differently. And it must be one field, not a wizard radio and an inspector radio.
2. **A graph must not be silently discarded on read** (`db/serviceTopology.ts:422`), and a project
   with both a graph and a contradicting equipment selection must **canonicalise with provenance or
   raise a conflict** — Ray's Mutation E. Never silently mix.
3. **`svcTopology` must be loaded by the page, not by a tab.** A conditional mount is not a model.
4. **The graph must reach the permit, the BOM, pricing and the PDF** — the four surfaces that have
   never heard of it — and the functions written for that purpose must acquire production callers
   or be deleted.
5. **System Config owns *what*; Service Topology owns *how it is connected*.** Shared facts are
   displayed in topology as `400 A — from System Configuration [Edit]`, reading the same field, not
   a copy.

---

## 6. STILL TO DETERMINE

- Whether Ray's saved project holds an Enphase `selected_equipment` **or** only hits the
  `MICROINVERTERS[0]` fallback — decides whether canonicalisation needs a conflict UI or just a
  fallback removal. Needs his database; cannot be answered from fixtures.
- `site_conditions` is SELECTed by `app/api/projects/[id]/site-conditions/route.ts:47` with nine
  columns that exist in no migration — the `sql-columns-that-never-existed` pattern, live, and
  unrelated to this campaign but worth its own ticket.
