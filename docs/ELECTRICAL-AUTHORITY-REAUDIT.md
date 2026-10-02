# Electrical authority — re-audit after implementation

**Date:** 2026-10-01
**Baseline:** `a0e28745` (`docs/ELECTRICAL-AUTHORITY-MAP.md`, the pre-implementation audit)
**Head at re-audit:** `07f5503c` on `dev`
**Commits in the correction:** `bc190bd9` · `cdebde10` · `411b8f70` · `27ce3e59` · `07f5503c`

Ray's instruction: *"Re-run the electrical authority audit after implementation. For every electrical
fact answer: 1. Who owns it? 2. Where is it persisted? 3. Who may write it? 4. Which production
surfaces consume it? 5. Can another persisted field disagree and win? The acceptable answer to #5 is
NO. If a legacy mirror still exists: identify it as legacy, prove it cannot win, document removal
path."*

This document is the written form of that answer. The **runtime** form is
`GET /api/dev/electrical-authority?projectId=…`, which prints the same five answers from the live
project — because a document can only go silently out of date, which is how three competing stores came
to exist while `docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md` said otherwise.
`tests/electricalAuthorityInspector.test.ts` holds the inspector's claims to the source.

---

## 1. The architecture, as it now stands

| Store | Owns | May NOT answer |
|---|---|---|
| `projects.service_topology` | the connection graph: service rating, branches, panels, domains, gateways, storage instances, generation panels, devices, POIs, interconnection, `solarCoupling` | which catalogue product was picked for a non-graph item |
| `projects.selected_equipment` | **which physical product** — panel, inverter, mounting, battery model | **how many** of anything; how it is connected |
| `projects.engineering_config` | explicit engineering **overrides** | anything it is not an override of |
| `layouts.total_panels` | how many PV modules the design places | anything electrical downstream of that |
| `engineering_runs.config_snapshot`, permit snapshots | immutable **historical** records | current project truth |
| `localStorage` | UI draft state | current project truth |

`lib/electrical/projectModel.ts` composes these. It persists nothing, reads no catalogue, and imports
no React — so the same inputs give the same answer on the server and in the browser, and no sequence of
component mounts can change it.

`lib/electrical/loadElectricalProject.ts` is the **assembly**: one query, one composition, one
revision. This was the gap the first implementation left — a pure resolver with each caller assembling
its own inputs is still three answers.

---

## 2. The five questions, per fact

### Service rating

1. **Owner:** `service_topology.service.ratedAmps`; `engineering_config.serviceRatedAmpsOverride` outranks it when explicitly set.
2. **Persisted:** `projects.service_topology → topology.service.ratedAmps`.
3. **Writers:** `app/api/projects/[id]/service-topology/route.ts`.
4. **Consumers:** engineering page + sidebar, SLD route, permit route, BOM route (and pricing, through the BOM's lines).
5. **Can another field disagree and win?** **No, now.** It could before: `mainPanelAmps ... || 200` in the BOM, SLD and SLD-PDF routes fabricated a 200 A service *and accepted a posted 200 over the graph's 400*. The canonical rating is projected onto the scalar in the BOM and SLD routes (`27ce3e59`, `07f5503c`), which is the arrangement `SERVICE-TOPOLOGY-SCALAR-AUDIT.md` already sanctions. **Not cosmetic:** diffing the real BOM route at 200 A vs 400 A moves the NEC 705.12(B) backfeed breaker from QO80 to QO40 — a stale scalar was sizing the breaker that protects the busbar. Guarded by *"a POSTed 200 A does not beat the graph's 400 A service"*, proven against the restored defect.
   - **Legacy mirror:** `PermitInput.project.mainPanelAmps` and `app/api/engineering/sld/pdf/route.ts:288`. The first is a derived compatibility projection by design. **The PDF route is NOT yet migrated — see Finding F-3.**

### Selected inverter architecture

1. **Owner:** `selected_equipment.inverter` — and only *which product*.
2. **Persisted:** `projects.selected_equipment.inverter`.
3. **Writers:** the equipment route, save-config, the layout route on a designer change.
4. **Consumers:** all four surfaces.
5. **Disagree and win?** **No.** `cdebde10` removed the three load-path substitutions (`MICROINVERTERS[0]`, the seed's first-row-of-matching-catalogue, and the `'Enphase'/'IQ8+'` identity). "No separate inverter" is a state the model represents. A DC-coupled graph beside an explicit inverter raises a **conflict** rather than one side winning.
   - **Legacy mirror:** `engineering_config.inverters[]` / `layouts.design_electrical.strings[]`, read by the permit route's backfill. **Cannot win:** the backfill is skipped entirely when the canonical coupling is `dc-coupled-storage` or `storage-only`. Proven by *"the PERMIT ROUTE does not backfill it onto the package"* (mutation 14), which was run against the restored defect and failed correctly. **Removal path:** the backfill exists to repair a stale POST from the Engineering page; once the page posts from the canonical model it has nothing to repair.

### `solarCoupling`

1. **Owner:** `service_topology.solarCoupling`.
2. **Persisted:** `projects.service_topology → topology.solarCoupling`.
3. **Writers:** the service-topology route; plus `persistElectricalCanonicalization`, which writes **once** per project and only when there is no conflict.
4. **Consumers:** all four surfaces, and the renderer via the coupling it is handed.
5. **Disagree and win?** **No.** Recorded coupling wins over derivation; derivation happens only when nothing is recorded and the evidence is sufficient; where evidence is insufficient **nothing is derived**. Mutation 4 proves the derivation **stops** once persisted (provenance flips from `derived` to `service-topology`, patch becomes null).

### Storage unit / Gateway / generation-panel quantity

1. **Owner:** `service_topology` — multiplicity is a property of the graph.
2. **Persisted:** `topology.storage[]`, `topology.domains[].gateway`, `topology.aggregationPanels[]`.
3. **Writers:** the service-topology route.
4. **Consumers:** all four surfaces; `lib/bom/topologyBom.ts` → distributor pricing.
5. **Disagree and win?** **No, now.** The BOM route took `batteryCount` off the request. It now takes `storage.invertingUnitCount` from the graph, and `reconcileQuantities` **proves** the lines agree rather than assuming it.
   - **Legacy mirror:** `selected_equipment.batteryCount`. **Cannot win:** used only to raise a conflict against the graph's instance count. **Removal path:** migrate the proposal/production capacity readers onto `model.storage.invertingUnitCount`, then stop writing the column.

### Interconnection method

1. **Owner:** `pointsOfInterconnection[].relationship` + `interconnection.derArrangement`.
2. **Persisted:** `topology.pointsOfInterconnection` / `topology.interconnection`.
3. **Writers:** the service-topology route.
4. **Consumers:** BOM route, SLD route, `governingArticleFor`.
5. **Disagree and win?** **No, now — and this was a live finding.** `bom-engine-v4.ts` (3 sites) and the SLD route (4 sites) read a string scalar and defaulted it `?? 'LOAD_SIDE'`. **`LOAD_SIDE` is not a neutral default: it selects NEC 705.12(B), the 120% busbar allowance and a backfed breaker.** The graph has an explicit `'unresolved'` relationship whose stated purpose is to refuse exactly that guess, and a `??` was overriding it. `interconnectionMethodScalar()` now projects a recorded relationship and returns **null** for `unresolved`, for `manufacturer-integrated`/`meter-collar` (governed by a listing, not an article), and for **mixed** relationships — one scalar cannot describe two arrangements. Eight tests, including the unresolved refusal.

### PV module count

1. **Owner:** `layouts.total_panels`.
2. **Persisted:** the newest `layouts` row.
3. **Writers:** the layout route / Design Studio save.
4. **Consumers:** all four surfaces (it decides the storage-only coupling case and enters the revision).
5. **Disagree and win?** No. **Found during this work:** it was an input the resolver *consumed* and never *exposed*, so `electricalRevision` could not see it — 72 modules and 36 modules produced the same revision and a 72-module sheet kept a green CURRENT badge. The model returns it now.

### Electrical revision / generated-SLD freshness

1. **Owner:** derived — `lib/electrical/revision.ts`, a pure function of the model.
2. **Persisted:** nowhere. There is nothing to forget to bump.
3. **Writers:** nobody.
4. **Consumers:** SLD route (stamps), permit route (stamps), BOM route (reports), engineering page (compares).
5. **Disagree and win?** No. Freshness is decided by comparing **revisions**, never times.
   - **Legacy mirror:** an artifact's `updated_at`. **Cannot win:** never consulted for freshness. A timestamp says when a file was written, not what it was written *from* — which is why a sheet can be newer than the change that invalidated it and still be wrong.

---

## 3. Findings still open, each with proof it cannot reach the canonical model

Recorded rather than fixed, because each is outside the authority slice and Ray's standing instruction
is *"Do not add unrelated features"* / *"Stop electrical expansion after acceptance."*

### F-1 — The permit route's own `topology: 'microinverter'` default
`app/api/engineering/permit/route.ts:757`. Reached only when the client POSTs **no** `system` object at
all. **Cannot reach the canonical model:** the model never reads `body.system.topology`; it reads the
graph and `selected_equipment`. The architecture on the sheet comes from `project.serviceTopology`,
which is now written. **Removal path:** delete the synthesized default and refuse a payload with no
system, once the page posts from the canonical model.

### F-2 — Stale-micro-id substitution in the page
`app/engineering/page.tsx` (4 sites): an inverter entry with `type: 'micro'` but a stale non-micro
`inverterId` (e.g. `'se-7600h'` left by a topology switch) resolves to the catalogue default micro.
Documented as deliberate — it was added because requiring the id to resolve hid the CT control on
exactly those designs while the BOM substituted anyway. **Cannot reach the canonical model:** the model
takes `inverterId` and asks only *is there one*; a stale micro id gives `hasExternalInverter: true`,
which is correct either way. It affects display and BOM detail, not the architecture. **This is still a
real defect of a different kind** — a type/id *mismatch* resolved by substitution instead of surfaced —
and belongs with the CT/metering slice, not this one.

### F-3 — `app/api/engineering/sld/pdf/route.ts` — **FOUND AND FIXED IN THIS RE-AUDIT**
This route had **zero** references to the service graph, so "Export PDF" drew the legacy
single-service tail for Ray's 400 A job while the Diagram tab — reading the same project — drew two
200 A systems, two Gateways and four Powerwalls. **Two rendering entry points, one project, two
drawings**, and the exported one is what reaches an AHJ. It also carried both fabrications the sweep
found elsewhere (`mainPanelAmps ... || 200` and `?? 'LOAD_SIDE'`).

Now migrated: it loads the canonical model, hands the graph to the renderer, projects the service
rating and the interconnection method, and logs conflicts. Guarded by
*"the SLD PDF route consumes the graph too — two renderers, one drawing"* and
*"no migrated route fabricates a service rating or an interconnection article"*.

### F-4 — `engineering_seed` still carries Enphase / 200 A / MICROINVERTER defaults
`app/api/engineering/preliminary/route.ts:44-60`. It writes `projects.engineering_seed`. **Partly
addressed:** the page's restore of `seed.sldSvg` no longer presents that sheet as current (it reports
UNSTAMPED). **Not addressed:** the seed's equipment defaults themselves, for a *preliminary estimate* on
a project with no design. **Cannot reach the canonical model:** the model never reads
`engineering_seed`. **Removal path:** have the preliminary estimate carry its assumptions as labelled
estimates rather than writing them where a later reader can mistake them for selections.

### F-5 — `svcTopology` React state has two fill paths
The project-keyed load and the builder's `onTopologyChange`. **Not a second authority:** both reflect
the store, the builder also persists, and a reload re-reads. This is the UI draft state Ray explicitly
permitted. Worth noting only because a builder edit can briefly lead the store.

---

## 4. What changed about the answer to question 5

At `a0e28745` the answer was **yes** for the service rating, the inverter architecture, the coupling,
the storage count and the interconnection method — five facts where a second persisted field could
disagree and win, with no reconciliation and no precedence.

At head the answer is **no** for all five, on every migrated production surface: engineering page +
sidebar, SLD route, **SLD PDF route**, permit route, BOM route + pricing.

The honest residue: F-1, F-2, F-4 and F-5 are still present, and each is shown above to be unable to
reach the canonical model. None of them can make a second persisted field win a fact the model owns.

---

## 5. Mutation coverage

| # | Mutation | Where proven |
|---|---|---|
| 1 | Pure Enphase stays pure Enphase | `electricalAuthorityProductionPaths.postgres` |
| 2 | DC-coupled Tesla fabricates no inverter | same, + BOM route orders no Enphase |
| 3 | Tesla + legitimate AC-coupled Enphase stays valid | same, + permit does not refuse it |
| 4 | Unambiguous legacy canonicalises **once** and persists | same — derivation proven to STOP |
| 5 | Contradictory legacy ⇒ explicit conflict | same, + permit returns 409 naming both claims |
| 6 | Missing service rating preserves the graph | same, + BOM still orders correctly |
| 7 | Tab switching cannot change the interpretation | `electricalAuthorityLifecycle` — source guard proven against the real `bc190bd9` bytes |
| 8 | Save → reload unchanged | `…ProductionPaths` — whole model byte-compared, revision stable across a rewrite |
| 9 | 4 PW3 → 2 PW3 everywhere | same — model, revision, BOM route, pricing, inspector |
| 10 | DC-coupled → AC-coupled | same — and it is NOT a conflict when both stores move |
| 11 | Generate, change, go stale | same + `electricalRevision` |
| 12 | Delete / recreate duplicates nothing | same |
| 13 | The real 400 A job through every surface | same — 400 A, 4 PW3, 2 GW, 2 gen panels, 54 kWh, 192 A, DC-coupled |
| 14 | A stale legacy mirror cannot override canonical | same — three attack vectors |

**Not proven in that file, and said so in the file itself:** mutation 13's rendered-sheet half
(`professionalSldConsumesTheServiceGraph`) and the permit package's rendered schedule
(`permitScheduleConsumesTheTopology`). A test that looks like it covers a mutation and does not is worse
than an absent one, because it is believed.

---

## 6. Guards proven against restored defects

Every guard written for this correction was run against the defect it exists for and seen to **fail**:

| Guard | Defect restored | Result |
|---|---|---|
| permit backfill gate | `_noExternalInverter && false` | red — "backfilled a legacy Enphase array onto a DC-coupled Tesla job" |
| BOM double count | identity match → partNumber-only | red — "expected 8 to be 4" |
| service-rating projection | removed `body.mainPanelAmps = …` | red — "expected '40A 2-pole backfeed breaker…' to contain 'bus: 400A'" |
| lifecycle source guard | n/a — asserted against real `bc190bd9` bytes | the prior file matches the defect patterns; the project-keyed load is absent there |

**Two of these guards were blind when first written**, and restoring the defect is what found it:

- Deleting the BOM's canonical count override did **not** fail the Powerwall-quantity assertion — the
  service-graph merge corrected that line afterwards. The assertion now reads the engine's own
  `batteryCount`-derived lines, where the override actually earns its place (`resolveBatteryBranch`
  sizes the battery branch OCPD from it).
- The service-rating test first asserted that no line *described* a "200 A service" — a phrase nothing
  emits. Probing the real route at both ratings found the observable that moves.

---

## 6a. What rendering the sheet found that no assertion could

The SLD was rendered from the real job and **looked at** (rasterised with Arial substituted, or the
PNG lies about text width by ~29%). Two defects surfaced that every assertion in the SLD suites
passed straight over, both now fixed and guarded (`6163ae28`):

### The sheet contradicted its own conductor schedule
The conduit & conductor schedule branched only on `isMicro`, so a DC-coupled job fell into the STRING
rows and printed `ROOF J-BOX → DC DISCO`, `INVERTER → AC DISCO`, `AC DISCO → MSP` — **three runs
between four devices that are nowhere on the drawing above them**. The picture showed two 200 A
systems landing in generation panels; its own schedule described a single string inverter feeding a
disconnect. `_couplingIsDc` was already resolved thousands of lines earlier; the schedule never asked.

The guard checks both directions — an AC-coupled sheet must still get its inverter and disconnect
runs, or the fix is just a different defect.

### The generation-feeder callout was not beside its conductor
`fx = gb.left - 6` anchored the label to the generation panel's **left edge** while the conductor runs
from its **centre** — about 130 uu of white space between the words and the line. It read as an orphan
label nearer the service-path tag than the feeder. It stays on the left (the right-hand placement
collided with the branch-feeder jog corridor last slice); only the anchor changed.

## 6b. Browser verification — and where it stops

Run against `next dev` with the Browser pane:

- **`GET /engineering` → 200.** The page compiles and renders with the staleness banner, the
  `electricalRevision` import, the freshness `useMemo` and the new ref — a real signal, since those
  edits are inside a 19,000-line client component.
- **`GET /api/dev/electrical-authority` → 401 "Not authenticated".** The route compiles, is
  registered, passes its development gate (it did not 404), and refuses an unauthenticated read.

**This working copy has no `DATABASE_URL` and no `JWT_SECRET`** — only `.env.example` is present. So
there is no session to establish and no project to load, and the acceptance criteria that matter
(Ray's real 400 A project showing TESLA in the sidebar, the SLD matching it, the interpretation not
moving across tabs) **cannot be exercised here**. That is the `NEEDS RAY — LIVE PROJECT ACCEPTANCE`
gate, and it is the only gate in that state.

## 7. Verification state

- `npx tsc --noEmit` — **0 errors**
- `npx eslint` on changed files — **0 errors** (pre-existing `no-console` warnings only)
- Electrical suites — **215+ passing** across `electricalProjectModel`, `electricalRevision`,
  `electricalAuthorityProductionPaths.postgres`, `electricalAuthorityInspector`,
  `electricalAuthorityLifecycle`, `raysRealFourHundredAmpJob`, `noInventedEquipment`,
  `topologyReachesEveryOutput`, `topologyAuthoredThenAgreesEverywhere.postgres`
- Full regression — see the session report
- **Live acceptance — NEEDS RAY.**

---

# Addendum — Ray's live acceptance found real defects (2026-10-02)

The first re-audit closed with `NEEDS RAY — LIVE PROJECT ACCEPTANCE`. He ran it, and it **failed**.
The SLD showed Enphase; he changed the ecosystem to Tesla to clear it; SolarPro then drew a STRING
INVERTER sheet with a "Tesla Solar Inverter 5.7kW" he never selected, no generation panels, and 50 A
OCPD on every Powerwall.

This addendum records what that proved, including the parts that were **my own defects introduced by
the authority work itself**.

## A-1 — A saved instance was a frozen copy of the catalogue

`topologyAuthoring.ts:242` resolves manufacturer facts onto an instance when it is BUILT. Correct, and
it is what keeps the graph catalogue-free. What was missing: **nothing ever re-resolved them**. One
cause, two faces:

- `ocpdA` stayed 50. Repairing "the canonical equipment authority, not SLD text" achieves nothing if
  the authority is never consulted again.
- `pvInputLimits` was **absent** — the field postdates the project, and the parser omits it
  all-or-none. `takesPvOnDc` tests exactly that field, so the model could **never** derive
  `dc-coupled-storage` for a legacy project, and fell through to "an inverter is selected ⇒
  ac-coupled". It also emitted a canonicalization patch, so generating once would have **recorded the
  wrong architecture permanently**.

Fixed by `lib/electrical/hydrateInstances.ts`, applied in the one read path.

## A-2 — The ecosystem picker auto-selected an inverter nobody chose

Traced end to end with the sizing engine executed: `EcosystemPicker.tsx:152` auto-selects
`kit.stringInverters[0]` with no click → `tesla-solar-inverter-3p8k` → `sizingEngine.ts:1129` silently
upsizes it to 2 × 5.7 kW = 11.40 kW → written to config → autosaved. The picker file already stated the
rule, for the Envoy: *"a default recorded by an apply would read as the installer's decision on every
sheet."*

## A-3 — Branch ordering decided the architecture

`else if (hasExternalInverter)` sat **above** the DC branch, so when both were true the ORDER decided
it. Now a conflict with no patch, proven symmetric in six adversarial cases.

## A-4 — 🚨 The canonical migration CAUSED a defect

`sld/route.ts` read `atsAmpRating ?? mainPanelAmps`. Projecting the graph's service rating onto
`mainPanelAmps` meant that fallback fired on every project with a graph — manufacturing a 400 A
transfer switch, sizing its feeder, failing ampacity, and printing `ATS_TO_MSP_RUN … ✗ FAIL` for a
device nobody has. **A fabrication downstream of a correction is the correction's problem.**

## A-5 — The calculation blocks described a different system than the drawing

`AC OUTPUT 11.40 kW`, `AC Output Amps 24 A`, `DC/AC 1.43`, `Tap OCPD 60 A FUSED DISCO` — all from the
phantom inverter, on a sheet whose title block read PV DC COUPLED TO POWERWALL 3. Found in **three**
places, one at a time, by re-reading the rendered sheet after each fix; the subtitle was last.

**DC/AC ratio was retired, not re-based.** It measures clipping at a dedicated PV inverter; there is
none. It now reads `N/A — DC COUPLED`, with the governing limit stated beneath it:
`PV vs ESS DC input — 16.28 kW / 80.0 kW published`.

## A-6 — Two more found only by rendering the sheet and reading it

- The conductor schedule listed `DC DISCONNECT → STRING INVERTER → AC DISCONNECT` (a **second**
  schedule, fed by the sizing engine, which had not learned about coupling). Excluding those left it
  with ONE row, so the storage-side runs are now built from the graph — and a conductor SolarPro has
  not sized reads `SIZE FOR 200 A — NOT EVALUATED` rather than borrowing the PV circuit's #6 AWG.
- The equipment schedule still listed `DC Disconnect — 25A Fused`, one line away from the AC
  disconnect the DC-coupled block already removed.

## A-7 — A claimed landing with no panel

`storageConnection: 'der-aggregation-panel'` makes the busbar check PASS because the storage "left".
Nothing checked that it **arrived**. Reachable in production: the wizard creates the panels with the
answer, but the inspector and the panel let an operator set the arrangement alone — which is the path
an EXISTING project takes. Now a FAIL naming what is missing.

## Provenance — the four classes

`parseServiceTopology(raw, mode)` where mode is `'active' | 'as-issued' | 'as-sent'`:

| mode | manufacturer facts | why |
|---|---|---|
| `active` (default) | refreshed, and itemised in `refreshes` | a correction must reach the editable project |
| `as-issued` | untouched | an issued drawing stays traceable to the data it was issued with |
| `as-sent` | untouched | validating a payload and storing something else is a different act |

Proven both directions on the same stored bytes: as-issued returns `ocpdA 50` with no `pvInputLimits`;
active returns `60` with the limits restored and itemises `ocpdA 50→60` four times.

## Blast radius — measured, after Ray's "must not change other brands and other scenarios"

Exactly **one** catalogue row publishes `pvInput` / `outputConfigurations` / `internalPanelboard`: the
Tesla Powerwall 3 (and Gateway 3). The conflict branch is PW3-only by construction; the numeric refresh
is gated on a verified manufacturer TABLE (a bare scalar does not outrank a saved value); the gateway
refresh is purely additive; the picker prop defaults undefined; the renderer changes are gated on
`_couplingIsDc`. The ATS fix is universal and removes an invention, not a capability.

## Guards proven by restoring the defect

| defect restored | result |
|---|---|
| ATS fabricated from the service rating | red — "contains 'ATS_TO_MSP_RUN' for a project with no transfer switch" |
| calc band's coupling flag forced false | red — all three calculation guards together |
| `pvInputLimits` hydration removed | red — **16 tests**, the entire live failure returns |
| numeric refresh gate forced false | red — "the stale 50 A OCPD reached the drawing" |
| `hasExternalInverter` precedence restored | red — incl. "expected 'written' to be 'nothing-to-do'" (the poisoning resumes) |
| ecosystem auto-select restored | red — names `tesla-solar-inverter-3p8k` |
| wizard radio stops creating panels | red — 2 |
| landing check removed | red — "a design whose storage lands nowhere reported no failure at all" |
| BOM identity match → partNumber only | red — "expected 8 to be 4" |
| service-rating projection removed | red — 40 A breaker where 80 A belongs |

## Still open

- **§11 root.** The architecture DECISIONS now come from the canonical model (interconnection, ATS,
  service rating, storage counts and backfeed). `computeSystem` still *computes* a PV-inverter chain
  for a DC-coupled job; its outputs are suppressed or replaced at the point of use rather than never
  produced. Honest statement: the symptoms are cut, the root is not.
- **Ray's project still has no generation panels in its graph.** The wizard now asks the question
  properly and the inspector can set it, and A-7 makes the half-answered state fail loudly — but the
  panels appear only when he answers. A migration that created them would be inventing equipment.
- `EcosystemPicker`'s battery default (visible, toggleable, no demonstrated defect) — recorded, not
  changed.
