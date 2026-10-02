# SolarPro — the ACTUAL production Engineering data chain, and where it breaks

**Date:** 2026-10-02 · **Commit traced:** `82b33d9d` on `dev` · **Live dev deployment:** `solarpro-dev.vercel.app`

This is a trace of what exists, not a proposal. Every claim carries `file:line`. Nothing here
redesigns anything.

**How to read it:** each stage lists what comes in, where it came from, what it computes, what goes
out, who consumes that output, and — the point of the document — **where the next stage ignores the
output and reads an older store, a fallback, a default, or the HTTP request body instead.**

A *break* means precisely: **upstream produced an engineered value, and a downstream stage did not
use it.**

> ⚠️ **Verification status.** Everything marked ✅ was read directly in the source for this document.
> A deeper multi-agent trace of the same chain was still running when this was written; its findings
> will extend, not replace, what is below. Nothing unverified is asserted as fact.

---

## 0. The stores — because every break is a store being read out of turn

| store | column / location | what it legitimately owns |
|---|---|---|
| **Service topology** | `projects.service_topology` (JSONB) | the connection graph: service rating, branches, panelboards, backup domains, gateways, storage instances, generation panels, points of interconnection |
| **Equipment selection** | `projects.selected_equipment` (JSONB) | which catalogue products are chosen |
| **Engineering config** | `projects.engineering_config` (JSONB) | the page's working config — **including `inverters[]` with `strings[]`**, i.e. the string assignment |
| **Layout** | `layouts.total_panels`, `layouts.panels[]` | how many modules and where they are |
| Engineering runs / reports | `engineering_runs`, `engineering_reports` | historical snapshots |
| Production / proposal snapshots | `productions.data_json`, `proposals.data_json` | historical snapshots |
| Browser | `localStorage['eng-config-<projectId>']` | unsaved working state |

**Canonical composition:** `lib/electrical/loadElectricalProject.ts` → `lib/electrical/projectModel.ts`.
One query over the first three columns plus the layout count, composed by a pure resolver.

---

## 1. SYSTEM CONFIG / EQUIPMENT SELECTION — "WHAT equipment"

**In:** user clicks in the System Config tab; an ecosystem "Apply" in
`components/engineering/EcosystemPicker.tsx`; `DEFAULT_CONFIG` as initial React state
(`app/engineering/page.tsx:638`).

**Computes:** which products are selected; `lib/system/sizingEngine.ts` sizes the inverter fleet and
**upsizes within the same brand** when one unit cannot carry the array.

**Out:**
- `projects.selected_equipment` — `inverter{id}`, `inverterId`, `batteries[]`, `batteryCount`, `panelId`
- `projects.engineering_config` — the whole page config, **including `inverters[].strings[].panelCount`**
  (the committed string assignment), via `app/api/engineering/save-config/route.ts:155`

**Consumed by:** the canonical model; the page itself; every POST payload the page builds.

### ✅ BREAK 1.1 — System Config and Service Topology never meet (CRITICAL)

This is the direct answer to *"why can System Config auto-apply equipment correctly, but that
equipment later fights Topology and survives into the SLD?"*

- `EcosystemPicker.tsx` contains **zero** references to `service-topology`, `svcTopology` or
  `writeServiceTopology`. ✅ The picker cannot see the graph.
- **Exactly one** link exists in the entire System Config tab: the `pvCoupledToStorage` prop at
  `app/engineering/page.tsx:11233`, which only *suppresses the auto-pick* when the storage publishes
  PV DC inputs. ✅
- Nothing in the equipment write path revisits the graph, and nothing in the graph write path
  revisits the equipment.

**There is no engineering stage between them.** Equipment selection writes column A, topology writes
column B, and until very recently nothing compared them. The outputs' shortest path to "what system
is this?" ran back through the page's React state — i.e. the equipment store — so **equipment won by
default, not by precedence.**

### ✅ BREAK 1.2 — a derived value was written into the owner's slot (CRITICAL — the live failure)

At commit `921b23a7`, `lib/electrical/projectModel.ts:223` reached `else if (hasExternalInverter)`
*before* the DC-capable check and returned
`canonicalizationPatch = { solarCoupling: 'ac-coupled-inverter' }`; `app/api/engineering/sld/route.ts:229`
called `persistElectricalCanonicalization`, **which writes it to the graph**. ✅

So every *Generate SLD* click recorded an architecture onto the project — derived from an inverter
the picker had auto-selected. It then read back as *"Recorded on the project by the designer."*
Three automatic steps produced a fact that the system then protected.

*(Now fixed: a recorded coupling carrying no `provenance.architecture` is re-tested against the
evidence instead of obeyed. But the chain lesson stands: **a projection written into an owner's slot
becomes indistinguishable from a decision.**)*

---

## 2. SERVICE TOPOLOGY — "HOW it is connected"

**In:** `components/engineering/ServiceTopologyWizard.tsx` → `PUT /api/projects/[id]/service-topology`.

**Computes:** `evaluateServiceTopology()` (`lib/electrical/serviceTopology.ts:1284`) produces real
engineering conclusions — 120 % busbar checks, DER isolation coverage, ampacity, each
`PASS | FAIL | NOT_EVALUATED`.

**Out:** the stored graph, plus a `TopologyEvaluation`.

### ✅ BREAK 2.1 — the topology's engineering conclusions reach NO professional output (CRITICAL)

`evaluateServiceTopology` is consumed by exactly two places: ✅

- `app/api/projects/[id]/service-topology/route.ts:44,150` — **the wizard's own screen**
- `lib/electrical/topologyOverview.ts:560` — a display projection

**Not** the SLD route, **not** the BOM route, **not** the permit, **not** the compliance calculation.

Worse: `lib/sld-professional-renderer.ts:3040` **accepts** `evaluation?: TopologyEvaluation` — and
`app/api/engineering/sld/route.ts` contains **zero occurrences of `evaluation`**. ✅ The renderer has
a parameter for the topology's verdicts that the route never fills. The permit route and
`lib/permit/snapshot/build.ts` never reference it at all. ✅

Consequence: the stage that actually evaluates the service graph produces conclusions that no sheet,
parts list or permit ever sees. The renderer's overlay logic is compensating for their absence.

---

## 3. ELECTRICAL SIZING / CALCULATION

**In:** `app/api/engineering/calculate/route.ts` — historically **everything from the POST body**;
`lib/computed-system.ts#computeSystem` likewise.

**Computes:** NEC 690.7 string sizing, conductor runs, OCPD, the 120 % busbar arithmetic, the
equipment schedule and `bomQuantities`.

**Out:** `runs[]` / `runMap`, `strings[]`, `equipmentSchedule[]`, `bomQuantities`,
`interconnectionPass`.

### ✅ BREAK 3.1 — TWO string engines divide the same array differently (CRITICAL)

For **37 modules, 9-module maximum**:

| engine | result | sum |
|---|---|---|
| `lib/string-generator.ts:476-500` | `[9, 9, 9, 8, 2]` | 37 ✅ |
| `lib/computed-system.ts:1231-1232` | `floor(37/5)=7` ×4, last `37−28=9` → `[7,7,7,7,9]` | 37 ✅ |

Both sum correctly — but they are **different physical designs**, and which one a surface sees
depends on which engine answered. The committed installer layout (`10/9/9/9`, from
`engineering_config.inverters[].strings[]`) is a **third** partition.

### ✅ BREAK 3.2 — the summary triple cannot encode a real layout (CRITICAL)

`(totalStrings, panelsPerString, lastStringPanels)` can only express *"first N−1 at P, last at L."*
It cannot represent `10/9/9/9` or `9/9/9/8/2`. Three call sites collapse `strings[]` to
`[0]` and `[last]`, discarding the middle. The SLD array box printed
**`4 STRINGS × 10 MODULES` = 40** under `37 × 440W`. ✅

### ✅ BREAK 3.3 — `computeSystem` could not be told the architecture (CRITICAL)

`ComputedSystemInput` had **no architecture field**: only `topology: 'string' | 'micro' | 'optimizer'`,
all three of which describe a standalone PV inverter. ✅ So a DC-coupled job built that inverter's
conductor runs, disconnects and schedule rows, and consumers deleted them downstream *if they knew to.*

---

## 4. COMPLIANCE

**In:** `app/api/engineering/calculate/route.ts`, `app/api/engineering/rules/route.ts`.

### ⚠️ BREAK 4.1 — the sizing tab was silent for DC-coupled jobs (was CRITICAL, now fixed)

`calculate/route.ts` gated its NEC 690.7 generator on `if (firstStr && firstInv)`. `firstInv` is
absent *by design* on a DC-coupled job, so the tab produced **nothing** while the drawing showed five
strings. The route also had **no `projectId` at all** — everything it knew came from the page.

---

## 5. SLD / BOM / PERMIT / PLANSET / PRICING — consumers that decided things

### ✅ BREAK 5.1 — the SLD took its architecture from the request body (CRITICAL)

`topologyType`, `inverterModel`, `inverterManufacturer`, `inverterId`, `batteryCount`,
`mainPanelAmps`, `interconnection` all arrived in the POST body — i.e. the page's React state — and
were used verbatim. The canonical model was loaded in the same handler and consulted for only a few
of them.

### ✅ BREAK 5.2 — the permit reads the phantom inverter's conductor as its AC wiring (CRITICAL)

`lib/plan-set/permit-system-model.ts:134-137` reads
`runMap['DISCO_TO_METER_RUN'] ?? runMap['INV_TO_DISCO_RUN']` as the package's AC conductor. ✅
`lib/permit/snapshot/build.ts:441-443` does the same via `_computeSystem`, set at
`lib/permit/generatePermit.ts:1182`. ✅

The SLD renderer's suppression of those runs is **renderer-local** — the permit never consulted it.
A sealed drawing therefore carried the conductor of equipment that is not in the design.

### ✅ BREAK 5.3 — outputs invented real products (CRITICAL)

- `app/api/engineering/sld/route.ts` defaulted `inverterManufacturer`/`inverterModel` to
  **`Fronius` / `Primo 8.2-1`** — keyed off `body.topologyType ?? 'STRING_INVERTER'`, itself invented. ✅
- `app/api/engineering/bom/route.ts:304` read **`body.inverterId ?? 'fronius-primo-8.2'`** — a real
  catalogue product on the **bill of materials**. ✅

### ✅ BREAK 5.4 — a site survey overwrote the engineered design (CRITICAL)

`app/api/engineering/permit/route.ts` listed `interconnectionMethod`, `mainPanelAmps` and
`panelBusRating` in `SURVEY_WINS_FIELDS`. ✅ Roof type, pitch, rafters, panel brand and meter are
measurements and the survey rightly wins. Supply-side vs load-side is a **connection decision** that
decides whether NEC 705.11 or 705.12(B) governs the package.

### ✅ BREAK 5.5 — `?? 'LOAD_SIDE'` chose which article of the code applies (CRITICAL)

Seven-plus sites, including `lib/computed-system.ts:1532,3222` and `lib/bom-engine-v4.ts:1761,2299,3203`. ✅
A project that never recorded its point of interconnection had 705.12(B) applied silently — and in
the BOM it decided whether a **backfed breaker was quoted**. `app/api/engineering/preliminary/route.ts`
hardcoded `MICROINVERTER` + `LOAD_SIDE` and **persisted them into an upserted engineering report**. ✅

### ✅ BREAK 5.6 — an old snapshot could resurrect retired equipment (CRITICAL)

`lib/db/projects.ts:65` promoted `selectedInverter` from `productions.data_json` whenever
`!base.selectedInverter`. ✅ That test cannot distinguish *"this project records NO separate
inverter"* from *"nobody has said"* — so a DC-coupled design whose inverter was deliberately retired
got one handed back from a store the authority table does not even list.

### ✅ BREAK 5.7 — a control wrote the wrong fact (CRITICAL)

Three distinct facts the graph keeps separate:

```
aggregate service rating   400 A   topology.service.ratedAmps
panelboard busbar          200 A   topology.panels[i].busbarRatingA
panelboard main / OCPD     200 A   topology.panels[i].mainBreakerA
```

A control labelled **“Main Panel (Amps)”** bound to the *aggregate* produces
`400 × 1.2 − 400 = 80 A` of allowable PV where MSP #1's real answer is `200 × 1.2 − 200 = 40 A` — a
**permissive** result on a safety calculation. ✅

---

## 6. THE SIMPLE 200 A PATH vs THE 400 A PATH

Same engine, same stores. The difference is entirely in what the wizard asks.

### ✅ Every question a simple job faces today

`components/engineering/ServiceTopologyWizard.tsx`:

| line | question | gated? |
|---|---|---|
| 161 | What is the service size? | always |
| 193 | How is this *N* A service distributed? | always |
| 223 | Which panels are backed up? | always |
| 248 | **The stack in each backup domain** | always — *internal vocabulary* |
| 369 | How are the battery AC circuits combined before the gateway? | `domains.length > 0` |
| 475 | How does the new solar connect? | always |
| **500** | **“How do these systems connect to the service?”** (independent / combined / custom) | ✅ **NO GATE** |
| 539 | Point of connection (per domain) | per domain |
| 679 | Where does the utility's safety switch go? | always |
| 749 | **Disconnecting means — four separate roles** | always — *internal vocabulary* |

**Line 500 is Ray's example, confirmed:** there is no `domains.length > 1` condition anywhere near
it. ✅ A 200 A house with one MSP and one Gateway is asked to choose how its *systems* interconnect
when it has exactly one.

Three of the ten questions use internal graph vocabulary (*backup domain*, *DER arrangement*,
*disconnecting means*) in the primary UI.

---

## 7. THE CHAIN, AS IT ACTUALLY RUNS

```
USER INPUT
   ↓
EQUIPMENT SELECTION ──────────────► selected_equipment + engineering_config
   │   (never reads the graph — one suppression prop excepted)
   ↓
SERVICE TOPOLOGY ────────────────► service_topology  ──► evaluateServiceTopology()
   │   (never reads the equipment store)                        │
   │                                                            ✗ consumed by NOBODY downstream
   ↓
ELECTRICAL SIZING  ◄── POST body (page React state), not the stores
   │   two string engines, different partitions
   ↓
COMPLIANCE ◄── the same body
   ↓
OUTPUTS (SLD · BOM · PERMIT · PLANSET · PRICING)
       ◄── POST body for architecture
       ◄── productions/proposals snapshots for equipment
       ◄── `?? 'LOAD_SIDE'`, `?? 'fronius-primo-8.2'`, `?? 'STRING_INVERTER'` for the rest
```

**The shape of the defect:** the chain is not a chain. Stages 1 and 2 write sibling columns and never
consult each other; stage 2's conclusions are consumed by its own screen only; stages 3–5 are fed by
the page's React state rather than by the stores the earlier stages wrote. Each output therefore
re-decides what the system is, from whichever store it happens to know.

---

## 8. WHAT THE REPAIR HAS TO BE (not done here — stated so the shape is clear)

1. **A stage between Equipment and Topology.** Recording a connection decision must be able to
   supersede an equipment selection, and that supersession must be a recorded act — not a silent
   overwrite in either direction.
2. **`evaluateServiceTopology`'s conclusions must reach the outputs.** The renderer already has the
   parameter.
3. **One canonical string assignment** — module identities, destination device, MPPT input — produced
   once and consumed by sizing, SLD, conductor schedule, equipment schedule and permit.
4. **No stage may read the POST body for an architecture fact** when a `projectId` is present.
5. **Absence must stay absent.** `UNRESOLVED` / `NONE` are states; `NOT EVALUATED — reason / owner`
   is the output, never a plausible substitute.
6. **The wizard asks what the system's shape warrants** — the questions gate on domain and panel
   counts, and internal vocabulary moves to Advanced.


<br>

# PART II — THE DEEP TRACE

*Added 2026-10-02, after Part I. Part I was written by hand in one pass; Part II is a 56-agent trace of the same chain, each stage read independently and every finding then handed to a separate agent told to refute it.*

**It did not replace Part I. It corrected Part I in three places and found that seven repairs already reported as done are incomplete in production right now.** Those two sections come first, because they are the parts that change what you do next.

| | |
|---|---|
| Agents | 56 (7 stage traces -> 49 adversarial verifications) |
| Tool calls | 1,503 |
| Verifications | **48 of 49 stand**, 1 refuted |
| Breaks found | **159** — 110 critical, 41 major, 8 minor |
| Agent errors | 0 |

---

## 9. How to read the confidence marks

Not every line below carries the same weight, and the difference matters more than the finding count does.

| Mark | Meaning |
|---|---|
| **[READ]** | I opened the file and read the lines myself for this document. Highest confidence. |
| **[VERIFIED]** | One agent found it, a second agent was told to refute it and could not. The refuter quotes the source. |
| **[ASSERTED]** | One agent reported it and no second agent tested it. Treat as a lead, not a fact. |
| **[CORRECTED]** | An agent claimed it, I checked, and the claim was wrong or imprecise. The corrected statement is given. |

Of the 159 breaks, 49 carry **[VERIFIED]**, 6 carry **[READ]** (section 11), and the remainder are **[ASSERTED]** — one agent, untested. I have not re-read 110 critical findings by hand and I am not going to claim I did.

**The one refutation is instructive.** An agent reported that the permit engine hard-defaults the NEC edition to 2020 (`lib/permit/generatePermit.ts:952-956`). The literal is real. But the refuter traced its single consumer: `runElectricalCalc`, which that same file declares **shadow-only** at `:1129-1133` — its result is stashed for a parity matrix and reaches no sheet, no BOM and no snapshot. The deciding engine, `computeSystem`, takes the edition at `lib/permit/utils/computedRuns.ts:281` as `?? null` and honours absence (`lib/computed-system.ts:1061-1074`: a non-4-digit edition yields `_necYear = null` and a basis string saying *"adopted edition not established"*). **The literal is inert.** A real expression in a dead path is not a defect, and that distinction is why the verify stage exists.

---

## 10. CORRECTIONS TO PART I

### 10.1 — "Two string engines" was wrong. There are four partitioners, and a fifth 690.7 implementation. [VERIFIED]

Part I said two engines divide the array and gave `[9,9,9,8,2]` against `[7,7,7,7,9]`. The refuter derived all four partitions for your 37-module job from source:

| Engine | Site | 37 modules becomes |
|---|---|---|
| `computed-system` | `lib/computed-system.ts:1270-1271` | `ceil(37/9)=5` strings, `floor(37/5)=7` -> **[7,7,7,7,9]** |
| `string-generator` | `lib/string-generator.ts:476-554` | **[9,9,9,9,1]** + a below-minimum warning |
| `sizingEngine` | `lib/system/sizingEngine.ts:1758-1782` | `ceil` fair-share over 5 slots -> **[8,8,7,7,7]** |
| `reportGenerator` | `lib/engineering/reportGenerator.ts:272-296` | uniform `5 x 9` = **45 modules implied under a 37-module heading** |
| *(5th, 690.7 only)* | `lib/engineering/reportGenerator.ts:210` | a fifth independent NEC 690.7 string-length implementation, writes `engineering_reports`, never reconciled |

**And my `[9,9,9,8,2]` was wrong — here is exactly why, because the reason is the real finding. [READ]** `lib/string-generator.ts:490` rebalances the short last string only if `lastFull - 1 >= minPanelsPerString && naiveRemainder + 1 >= minPanelsPerString`. With 37 modules at 9 per string: `naiveRemainder = 1`, `lastFull = 9`. My figure assumed the rebalance fires, which needs `minPanelsPerString <= 2`. But `minPanelsPerString` is not a constant — `:131` defines it as `ceil(mppt_min_V / vmpCorrected)`, and for a generic string inverter `lib/system/brandCapabilities/genericString.ts:44` sets it to **8**. So `2 >= 8` is false, the guard fails, and the else branch at `:494-498` pushes the 1-panel string **and emits a warning that the string is below the electrical minimum**.

> The engine knows the partition it just produced is electrically invalid, says so in a warning, and ships it anyway. That is worse than the disagreement I originally reported.

Because the bound is derived from MPPT minimum voltage, the four engines disagree *more* the further the inverter is from generic — they do not share the bound.

### 10.2 — A reconciliation channel DOES exist, and the SLD route is the one caller that skips it. [VERIFIED]

Part I said "nothing reconciles them." That was wrong, and the truth is far more actionable. `configStringPanelCounts` shipped as v61.7: `lib/computed-system.ts:1254-1257` promotes it to `authStringCounts` and `:1292-1294` prefers it per string; `lib/string-generator.ts:546-554` clears and replaces its own partition with it.

**Two callers pass it.** `app/engineering/page.tsx:3573-3575` (`fleet.flatMap(inv => inv.strings.map(s => s.panelCount))`) and `app/api/engineering/calculate/route.ts:266-281`.

**The SLD route does not.** `app/api/engineering/sld/route.ts:1018-1110` builds the whole `csInput` literal with `totalStrings: resolvedTotalStrings` at `:1031` and no `configStringPanelCounts` — zero hits for the identifier in the file. So in one request the route hands `computeSystem` the reconciled string **count** and lets it equal-divide the **distribution**, while handing the renderer the sizing engine's distribution (`stringPanelCounts` from `layoutStrings`, `:855-860`, forwarded `:1244-1245`). `cs` then feeds `buildPermitSystemModel` at `:1121`.

> **One route, one request, two partitions of the same 37 modules.** The fix is to pass one existing parameter, not to build an engine. Your committed 10/9/9/9 is already the authority — it just is not handed over on this path.

### 10.3 — Part I 2.1 was right and is worse than stated. [VERIFIED]

Part I found `evaluateServiceTopology` reaches no professional output. Confirmed, and extended: `lib/electrical/architectureGate.ts:21` refuses **only** on the coupling conflict, so the topology evaluator's own `FAIL` and `NOT_EVALUATED` conclusions gate nothing at all. Separately, `components/engineering/ServiceTopologyBuilder.tsx:128` — the route computes the evaluation server-side *specifically to prevent drift*, and **both clients discard it and recompute.**

---

## 11. THE SEVEN REPAIRS THAT ARE INCOMPLETE IN PRODUCTION

**Every item in this section I read in source myself. [READ]** These are repairs I have already reported to you as done. They are done on one path and live on another.

### 11.1 — The exported PDF still fabricates a Fronius Primo 8.2-1

`app/api/engineering/sld/pdf/route.ts:253-258`:

```ts
    // Default manufacturer based on topology
    const topoForDefaultPdf = String(body.topologyType ?? 'STRING_INVERTER');
    if (!inverterManufacturer) {
      inverterManufacturer = topoForDefaultPdf === 'MICROINVERTER' ? 'Enphase' : 'Fronius';
    }
    if (!inverterModel) inverterModel = 'Primo 8.2-1';
```

I removed this invention from the SVG route and from the BOM route. **I did not remove it from the PDF route — and the PDF is the artifact that leaves the building.** Note `?? 'STRING_INVERTER'` on the line above it: the PDF also *defaults the topology* to the exact phantom architecture the gauntlet is about.

The same route carries three more, all **[VERIFIED]**: it never calls `computeSystem` or `buildPermitSystemModel` at all (`:306`), so the printed sheet carries no engine values; it skips the whole Rule Eleven canonical-architecture override the SVG route performs (`:193`); and its battery gate omits two of the four fields the SVG route checks and never forwards `batteryCount` (`:384`). There is also a `Math.ceil(x / 5) * 5` OCPD at `:260-262` that the file's own comment says `lib/electrical/stdSizes.ts` forbids, because 55/65/75/85/95 A are not NEC 240.6(A) ratings.

> **The SVG route and the PDF route are two drawings of the same job, and only one of them was repaired.**

### 11.2 — I introduced `UNRESOLVED`, and the 705.12(B) evaluator has no branch for it

`lib/electrical-calc.ts:953` onward. The method resolves, then four branches:

```ts
  const icMethod: InterconnectionMethod = input.interconnection?.method ?? 'LOAD_SIDE';
  ...
  if (icMethod === 'LOAD_SIDE') {            // :972
  } else if (icMethod === 'SUPPLY_SIDE_TAP') {   // :1003
  } else if (icMethod === 'MAIN_BREAKER_DERATE') { // :1017
  } else if (icMethod === 'PANEL_UPGRADE') {      // :1049
  }                                          // and no else
```

`'UNRESOLVED'` is not null, so `??` does not fire; it then matches no branch. The result:

- `interconnectionPasses` stays at its `:964` initialiser, `false`
- `maxAllowedSolarBreaker` stays **0**
- `interconnectionMessage`, `interconnectionNecRef` and `interconnectionLabel` stay **empty strings**
- **no issue is pushed** to `interconnectionIssues` or `allErrors` — every push lives inside the four branches
- the remediation list at `:1110` is gated `icMethod === 'LOAD_SIDE'`, so an unresolved job gets **no alternatives either**

**Correcting the agent here:** it reported "the result is still PASS." The function itself returns `passes: false` (`:1141`, `:1157`). The danger is not a PASS from this function — it is that the refusal is **silent**: no code reference, no message, no issue, no remediation, and a `maxAllowed` of 0. Any surface that renders the issue list sees a clean interconnection section, and any consumer that reads absence-of-errors as success reports PASS. At least one does: `app/api/engineering/permit/route.ts:728` synthesises `overallStatus: 'PASS'` when the request carries no compliance block. [VERIFIED]

**And this engine is live, which the refutation in section 9 does not excuse. [READ]** `runElectricalCalc` is shadow-only *inside `generatePermit.ts`*. Its non-shadow callers:

| Caller | Surface |
|---|---|
| `app/api/engineering/calculate/route.ts:395` | the Compliance / sizing tab |
| `lib/rules-engine.ts:252` | the rules engine |
| `lib/computed-plan.ts:928` | the computed plan |

> Same engine, two statuses: **shadow on the permit path, authoritative on the compliance path.** A reader who learns "it is shadow-only" from the permit file will draw exactly the wrong conclusion about the Compliance tab.

`UNRESOLVED` needs an explicit branch that returns `NOT_EVALUATED` with a reason — which is what Rule Six asked for and what I did not finish.

### 11.3 — `pvCoupledToStorage`, the one link I identified, fails open

`app/engineering/page.tsx:11233-11237` — the single connection between System Config and the service graph, the line Part I cited:

```tsx
  pvCoupledToStorage={
    electrical?.solarCoupling === 'dc-coupled-storage'
    || (svcTopology?.storage ?? []).some(
         u => u.role === 'inverter-unit' && !!u.pvInputLimits)
  }
```

Both operands are optional-chained. If the canonical model fails to load **and** the topology read fails, this evaluates to `false` — *"PV is not coupled to storage"* — which re-enables the string-inverter auto-pick in `EcosystemPicker`. And the topology read is explicitly fail-open: `page.tsx:1217-1219` sets `svcTopology` to `null` on a throw or on `!data.available`.

> **A failed read produces the permissive answer, and the permissive answer is the original live failure.** The guard against your defect is armed by a successful network call.

### 11.4 — An architecture retirement cannot clear the inverter from `subSystems`

**Correcting the agent on mechanism.** It reported that `lib/system/subSystemMirror.ts:290` "writes the retired inverter straight back in the same UPDATE." Line 290 is not a write-back, it is a guard:

```ts
  if (idOrNull(patch.panelId as string)) out.panelId = patch.panelId;
  if (idOrNull(patch.inverterId as string)) out.inverterId = patch.inverterId;   // :290
  ...
  if (patch.batteryId === '' || (patch.batteryId == null && patch.batteryCount === 0 && 'batteryCount' in patch)) {
    out.batteryId = null; // explicit clear                                       // :292-294
    out.batteryCount = 0;
  }
```

**The real defect is the asymmetry, and it is just as serious.** `batteryId` has an explicit-clear branch that recognises a deliberate `null`. `inverterId` has none — `idOrNull(null)` is falsy, so `out.inverterId` is simply never set, and the `subSystems` entry **keeps the retired inverter untouched**. The effect the agent described is real; it arrives by omission rather than by write-back.

That matches the same agent's separately-reported break at `app/engineering/page.tsx:3280` **[VERIFIED]**: the retirement clears `engineering_config.inverters` but not `engineering_config.subSystems`, and the page re-synthesises the retired inverter from the map via `synthesizeFleetFromSubEquipment`. **This is the precise mechanism by which my own retirement repair can be undone.**

### 11.5 — The equipment schedule prints a layout that contradicts the module count two rows above it

`lib/sld-professional-renderer.ts:6048-6049` and `:6082-6083`, the string branch:

```ts
  const pp2 = input.panelsPerString ?? Math.round(input.totalModules/Math.max(input.totalStrings,1));
  ...
  ['Total Modules', `${input.totalModules}`],      // :6082  -> 37
  ['Strings',       `${input.totalStrings} × ${pp2} panels`],  // :6083  -> 4 × 9 panels
```

`Total Modules` prints **37** correctly. The row beneath it prints **4 × 9 panels**, which is 36. For your committed 10/9/9/9 the schedule contradicts itself on the same sheet, because `panelsPerString` is a single scalar and **cannot express 10/9/9/9** — Part I 3.2, reaching the drawing.

> Rule Fourteen is still live, in a form worse than a wrong total: the permit reader is given two numbers and no way to know which one the installer meant.

### 11.6 — `?? 'LOAD_SIDE'` survives in five places, and one of them defaults to the opposite article

Part I 5.5 is not closed. The dense cluster, all in one input builder — `app/api/engineering/sld/route.ts:1080-1084` **[READ]**:

```ts
  mainPanelAmps:          Number(body.mainPanelAmps ?? 200),                  // :1080
  panelBusRating:         Number(body.panelBusRating ?? body.mainPanelAmps ?? 200),  // :1082
  interconnectionMethod:  String(body.interconnection ?? ... ?? 'LOAD_SIDE'),  // :1083
```

Four defects in four lines: the service rating fabricated as 200; the busbar **falling back to `mainPanelAmps`**, which is the Main Panel conflation that produced your permissive 80 A; and the code article chosen by `??`.

Also live: `:1195` (same file), three sites on the sealed permit via `lib/permit/utils/interconnectionRule.ts:37`, and — pointing the other way — `app/api/engineering/save-outputs/route.ts:513`, where the outbound text files default the interconnection to **SUPPLY-SIDE TAP**. [VERIFIED]

> **Two defaults, opposite articles of the code, same project.** One surface assumes 705.12(B), another assumes 705.11. Whichever is right, one of them is printing the wrong code basis.

---

### 11.7 — My BOM guard cannot fire, because the client fills the absence one hop upstream

**This is the worst of the seven, and it is the clearest. [READ]**

I removed the invented inverter from the BOM route and wrote this in the source:

```ts
// Ray: outputs "must never guess missing equipment / invent an inverter". Absence stays
// absent; the engine already handles a project with no standalone inverter, and the BOM shows
// the gap rather than filling it.
let resolvedInverterId: string = typeof body.inverterId === 'string' && body.inverterId.trim()
  ? body.inverterId.trim()
  : '';                                        // app/api/engineering/bom/route.ts:316-318
```

The client that calls it, `app/engineering/page.tsx:7691-7693`:

```tsx
  inverterId: firstInv?.type === 'micro'
    ? (MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id ?? MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
    : (firstInv?.inverterId || 'fronius-primo-8.2'),
```

**The browser never sends an empty string.** `body.inverterId` is always a non-empty catalogue
id, so `resolvedInverterId` is never `''`, so the `if (!resolvedInverterId)` warning below it
can never execute. **The guard is unreachable code and the comment above it is false in
production.** A DC-coupled job — the correct state being no standalone inverter — still gets a
Fronius Primo 8.2 onto the parts list, exactly as before the repair. The micro arm is the same
defect in a second spelling: a stale id substitutes `MICROINVERTERS[0]`, whatever happens to sit
at index 0 of the catalogue.

> This is the specific lesson of the whole gauntlet turned on my own work. I verified the repair
> by reading the route and by running a test that posts no inverter id. **The real application
> never posts no inverter id.** A guard tested only by a caller that does not exist in production
> is a guard that has never run — the blind-guard shape, and I wrote one.

It also explains why Part I's §5.3 looked closed and was not: I checked the server and never
followed the caller. Same error as 11.1, where I checked the SVG route and never opened the PDF
route.

---

## 12. Every break belongs to one of five patterns

159 breaks is not 159 problems. Sorted by mechanism, the chain has five, and each has a different repair:

### Pattern A — An owner exists; the consumer reads a mirror instead

The authority was built, shipped, and left unwired. **Nine channels with zero production callers:**

| Built authority | Site | Callers |
|---|---|---|
| `legacyServiceScalars` — the sanctioned graph->scalar projection | `lib/electrical/topologyAuthoring.ts:815` | **0** |
| `acSourcesFromTopology` — the sanctioned 705.12(B) battery contribution | — | **0** |
| `buildServiceTopologyGraph` — documented replacement for the drawing's service half | `lib/sld/serviceTopologyGraph.ts:91` | **0** |
| `PermitSystemModel` — *"the single source of truth bridge"* | `lib/sld-professional-renderer.ts:649` | reaches the renderer, **never read** |
| `ComputedSystem.bomQuantities` | `lib/bom-engine-v4.ts:131` | produced, merged, posted, forwarded, declared — **0 readers** |
| `electricalRevision` on the permit input | `app/api/engineering/permit/route.ts:850` | **0** — so a graph change cannot move the digest |
| the canonical module count | `app/api/engineering/bom/route.ts:395` | **0 consumers anywhere in the repo** |
| `electrical-calc`'s *"canonical engineeringModel, single source of truth"* | `lib/electrical-calc.ts:476` | **0 live** |
| `configStringPanelCounts` on the SLD path | `app/api/engineering/sld/route.ts:1018-1110` | 2 callers elsewhere, **0 here** |

**This is the cheapest pattern to fix and the most expensive to leave.** Nothing needs designing — the owner exists and is correct. The consumer is reading the wrong thing. It also explains the shape of your whole gauntlet: every one of these is a case where somebody built the right answer and nobody connected it.

### Pattern B — Absence is filled with a literal instead of being reported

Your standard is that outputs must never guess. The literals still in the chain: `fronius-primo-8.2` / `Primo 8.2-1`, `200` A service (eight sites on the permit alone), `20` modules, `2` strings, `8.0` kW system size, a `40 A` disconnect, `#10 AWG` EGC, `10 A` module Isc, `30 A` of invented ampacity, a `400 W` panel assumption, a UL listing from a default literal, `Square D`, and `POWERWALL 3` as the name of every DC-coupled storage product.

Two of these are on a **purchase order** (`bomForPermit.ts:206` resolves the inverter by substring match on a free-text model string; `:830` sizes the DC OCPD from the fabricated Isc) and one is on a **sealed permit** (`page.tsx:9090`, the UL listing).

### Pattern C — One name, two meanings

| Name | Meaning A | Meaning B |
|---|---|---|
| `mainPanelAmps` | the panelboard's **main breaker** (the page) | the **aggregate service** (the server) — `sld/route.ts:1080` |
| `serviceTopology` | `projects.service_topology`, the real graph | `snapshot.electrical.serviceTopology`, a synthetic chain built from scalars |
| `/api/engineering/topology` | the service connection graph | a different "topology" entirely, which defaults the inverter to a named product |
| `batteryCount` | the graph's storage instances | `engineering_config`'s sidebar scalar |

The first row is the one that produced your permissive 80 A. It is still live on the SLD route.

### Pattern D — A refusal is downgraded to a permissive default

The most dangerous pattern, because every instance fails toward *approved*: `?? 'LOAD_SIDE'` (5 sites); `UNRESOLVED` matching no branch (section 11.2); a supply-side tap **forcing** `interconnectionPass = true` and discarding the engine's conclusion (`permit-system-model.ts:250`); a missing DC run making the ampacity check **PASS** and inventing 30 A (`:241`); `overallStatus: 'PASS'` synthesised when no compliance block arrives (`permit/route.ts:728`); inapplicable checks emitted as severity `pass` and printing `✓ PASS` on the planset (`rules-engine.ts:288`); `NOT_EVALUATED` computed and then dropped at the HTTP boundary (`rules/route.ts:43`); and **VAL-1, the permit's own compliance gate, reading no compliance verdict and printing ALL CHECKS PASSED over an uncomputed rafter** (`validationPage.ts:147`).

> On a DC-coupled design the rules engine evaluates **no DC rule at all** and returns PASS (`lib/rules-engine.ts:282`). That is your job.

### Pattern E — The sheet is corrected at render time instead of built correctly

`lib/sld-professional-renderer.ts:2951` deletes already-built rows and already-computed runs; `:8764` sizes EGCs, conductors and OCPDs itself instead of consuming them; `:6014` re-decides the 705.12(B) 120% verdict the engine already reached; `:6295` fabricates conductor-schedule rows and stamps them PASS; `:6049` re-multiplies strings × panels.

This is the render-time-correction law in your memory, in the SLD. The renderer compensates because it was never handed the conclusions — Part I 2.1 and section 10.3 are the cause, and this pattern is the symptom.

---

## 13. THE FULL CHAIN, STAGE BY STAGE

*For each stage: what it is, what comes in and from where, what it calculates, what goes out and who consumes it, then every broken handoff. Breaks are **[VERIFIED]** where a refuter confirmed them, otherwise **[ASSERTED]**.*

---

### 13.1 SYSTEM CONFIG / EQUIPMENT SELECTION

*18 breaks — 7 verified by a refuter.*

#### What this stage is

System Config is the "WHAT equipment" stage and it lives almost entirely in `app/engineering/page.tsx` React state (`config: ProjectConfig`, seeded from `defaultProject` at page.tsx:616-648) persisted to ONE store: `projects.engineering_config` via POST /api/engineering/save-config (page.tsx:2815, route.ts:152-161), mirrored synchronously to `localStorage['eng-config-<projectId>']` (page.tsx:2765). Three writers decide equipment inside it: `EcosystemPicker.handleApply` → the page's `onApply` (page.tsx:11238-11483), `sizeSystemFromBrand` + `applySizingRecommendation` (page.tsx:3970, 4525-4789), and `rebuildFleetsPerSub` for hybrids (page.tsx:4926-5030); all three write `config.inverters[]` (with `strings[]`) and `config.subSystems[key].inverterId/topology/ecosystemBrand`. The only equipment that reaches the CANONICAL store `projects.selected_equipment` is the PANEL, the BATTERY and the `subSystems` map — `reconcileFromEngineeringConfig` deliberately refuses to write the inverter flat (lib/system/selectedEquipment.ts:223-228, 247-296), so on a single-subsystem project the inverter System Config chose is invisible to `loadElectricalProject` yet is posted verbatim to the SLD and BOM from React state. System Config reads the service topology in exactly TWO places — `pvCoupledToStorage` on the picker (page.tsx:11233-11237) and the architecture-conflict banner (page.tsx:11583-11613) — and in neither does the graph gate or override an equipment decision; `SizingInput` (lib/system/sizingEngine.ts:77-164) has no coupling, no service, no interconnection field at all, and `smartDefaults.getDefaultBrand(systemType)` picks a brand from the mount type alone.

#### Data in

| Field | Where it comes from |
|---|---|
| `config.inverters[] (InverterConfig: id, inverterId, type, strings[], optimizerPeripheralId, deviceRatioOverride, subSystemKey)` | projects.engineering_config.inverters — restored at app/engineering/page.tsx:2098-2127 (`...savedConfig`); initial value from `defaultProject` = `[newInverter('string')]` → `STRING_INVERTERS[0]?.id ?? 'se-7600h'`, 1 string × 10 panels (page.tsx:573-619) |
| `config.subSystems{roof\|ground\|fence}.{inverterId, topology, ecosystemBrand, panelId, batteryId, batteryCount, batteryKwhPerUnit, mountingId, trenchRunLengthFt}` | projects.engineering_config.subSystems, normalized through `ensureSubSystemShape` at the hydration boundary (page.tsx:1879-1882); synthesized from legacy scalars when absent |
| `canonicalPanelId` | projects.selected_equipment.panel.id via GET /api/projects/[id] → `getProjectWithDetails` (lib/db/production.ts:233, 278) → `p.selectedPanel?.id` (page.tsx:1374). Falls back to productions.data_json.selectedPanel with NO guard (lib/db/production.ts:205, 278) |
| `projectCombinerId` | projects.selected_equipment.combinerSelection (lib/combinerSelection/service.ts:57 COMBINER_SELECTION_KEY), read via the CombinerSelector / combiner-selection route |
| `svcTopology (ServiceTopology: service.ratedAmps, panels[].mainBreakerA/busbarRatingA, storage[], pointsOfInterconnection[], solarCoupling)` | projects.service_topology via GET /api/projects/[id]/service-topology (page.tsx:1206-1223). Fail-open: a throw or `!data.available` sets it to null (page.tsx:1217-1219) |
| `electrical (ElectricalProjectModel) — solarCoupling, hasExternalInverter, externalInverterId, architectureResolutionRequired, architectureChoices, serviceRatedAmps, storage` | client-side `resolveElectricalProject({ topology: svcTopology, selectedEquipment: { inverterId: config.inverters[0]?.inverterId } })` — app/engineering/page.tsx:3084-3093. Composed from engineering_config, NOT from projects.selected_equipment |
| `systemPanelCount / resolvedPanelCount` | layouts.panels.length > layouts.total_panels > engineering_seed.panel_count (page.tsx:1845-1852, lib/system/panelCountSource.ts) |
| `layout.panels[].systemType\|placementType (per-sub membership stamps)` | layouts.panels — classified into `_hydExpectedBySub` / `subSystemCounts` (page.tsx:1864-1871) |
| `kit: ResolvedBrandEquipment (panels, stringInverters, microinverters, optimizers, batteries, atsUnits, backupInterfaces, monitoringGateways, evChargers, compatibleRacking)` | in-process catalogue only — `resolveBrandEquipment(brand)` over lib/equipment-db.ts + lib/mounting-hardware-db.ts (lib/system/brandProfiles/resolveBrandEquipment.ts:19-37, 127). Reads NO project store and NO topology |
| `combinerChoices` | `listCombiners(expandedBrand)` over lib/equipment/integratedBos.ts, gated on the host passing `currentCombinerId` (EcosystemPicker.tsx:156, 163-166) |
| `controlMode / systemConfigLocks` | projects.control_mode and projects.system_config_locks (page.tsx:1389-1392) |
| `config.mainPanelAmps / panelBusRating / interconnectionMethod` | projects.engineering_config (defaults 200 / 200 / 'UNRESOLVED' at page.tsx:626, 646). Never seeded from projects.service_topology — only written toward it (page.tsx:9384-9404) |
| `retiredInverterFleet` | projects.engineering_config.retiredInverterFleet, written server-side by app/api/engineering/electrical-architecture/route.ts:200-216 — read by nothing in the page |

#### What it calculates

- Ecosystem kit resolution: `resolveBrandEquipment(brand)` groups the catalogue by ecosystem tag and returns the kit (lib/system/brandProfiles/resolveBrandEquipment.ts:127)
- Auto-selection of a kit default: first microinverter → first string inverter → first optimizer, and first battery when the toggle is on — SUPPRESSED when `pvCoupledToStorage` (EcosystemPicker.tsx:171-190). No Envoy/combiner default, ever (EcosystemPicker.tsx:168-170)
- Inverter TYPE classification on apply: `isMicro`/`isOptimizer` against the kit → `'micro'|'optimizer'|'string'` (page.tsx:11242-11244)
- Optimizer-peripheral → central-inverter resolution: stores the brand profile's highest-tier `supportedInverterModels[last].equipmentDbId` as `inverterId` and the peripheral as `optimizerPeripheralId` (page.tsx:11255-11312)
- Micro fleet collapse: on applying a micro ecosystem the whole fleet collapses to ONE micro entry carrying the total panel count (page.tsx:11271-11299)
- Electrical normalization of strings[] after an inverter swap: `electricallyNormalizeInverterConfig` rebuilds 1×N violations before commit (page.tsx:11429-11437)
- Whole-project sizing: `sizeSystemFromBrand` → topology family, inverter model+qty, MPPT string allocation, battery pack count, panel-compatibility gate verdict, feasibility report (lib/system/sizingEngine.ts:2372)
- Brand inference for the sizing call: `getBrandProfileByInverterId(primary.inverterId)?.id` → `STRING_INVERTERS.ecosystemBrand` → micro safety-net 'enphase' → `config.selectedBrand` (page.tsx:3936-3957)
- DC/AC-ratio circuit-breaker: drops `selectedInverterId` from the sizing call when the current ratio < 1.0 so the engine auto-tiers from scratch (page.tsx:3994-4004)
- Per-sub hybrid fleet rebuild: `buildSubFleetForKey` per present sub, brand DERIVED from the sub's own inverter (never the stored `ecosystemBrand` tag) (page.tsx:4926-4983)
- Empty-fleet synthesis: `synthesizeFleetFromSubEquipment(key, subSystems[key], count)` recreates a one-inverter fleet from the map when a present sub's partitioned fleet is empty (page.tsx:3269-3291)
- User-intent locks: `userHasEditedInverters`, `isUserControlled`, `defaultsApplied`, `defaultsAppliedBySubSystem` — all computed and persisted in engineering_config (page.tsx:11425, 4668, 5014-5020)
- Battery metadata expansion on apply: `getBatteryById` → batteryBrand/batteryModel/batteryKwh (PER-UNIT), only when `batteryEnabled` (page.tsx:11324-11336)
- `buildCalcPayload`: turns config.inverters[] into the compliance payload — per-type device counts, MPPT/Voc/Isc specs from the catalogue, `pvArray` from `canonicalPanelId` + layout count, and the `interconnection` block (page.tsx:6329-6558)

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `projects.engineering_config (whole ProjectConfig incl. inverters[].strings[], subSystems map, schemaVersion:2)` | app/api/engineering/save-config/route.ts:152-161 (the UPDATE); re-read on load at app/engineering/page.tsx:2098. NOT read by the canonical model — lib/electrical/loadElectricalProject.ts:215-221 reads it for PRESENCE only and passes `engineeringConfig: null` to the resolver at line 243 |
| `localStorage['eng-config-<projectId>']` | app/engineering/page.tsx:2317-2337 — the restore path when projects.engineering_config is absent |
| `projects.selected_equipment.{panelId, panel, batteryId, batteries, batteryCount, batteryKwh}` | `reconcileFromEngineeringConfig` → `upsertSelectedEquipment` (app/api/engineering/save-config/route.ts:176-182); read back by `rowToProject`/`hydrateCanonicalEquipment` (lib/db/core.ts:290-323) and by `selectedEquipmentView` (lib/electrical/loadElectricalProject.ts:103-124) |
| `projects.selected_equipment.subSystems[key].{inverterId, topology, ecosystemBrand, panelId, batteryId, batteryCount, batteryKwhPerUnit}` | `reconcileFromEngineeringConfig` map passthrough (lib/system/selectedEquipment.ts:287-294) → `upsertSelectedEquipment` jsonb_set (lib/db/projects.ts:582-593). At >1 entries it is then DERIVED into the flat `selected_equipment.inverterId` (lib/db/projects.ts:551-565, lib/system/subSystemMirror.ts:256-270) — the only path by which System Config's inverter becomes canonical |
| `projects.selected_equipment.combinerSelection` | POST /api/projects/[id]/combiner-selection from the ecosystem apply (page.tsx:11363-11367) and from CombinerSelector; read by `readStoredCombinerSelection` in the SLD route (sld/route.ts:125-129), the BOM route (bom/route.ts:294-298) and the permit route |
| `POST /api/engineering/calculate body: { projectId, topologyType, electrical:{ inverters[], pvArray, mainPanelAmps, interconnection:{method,busRating,mainBreaker}, batteryBackfeedA, batteryCount, generator*, ats*, backupInterface* }, structural }` | app/api/engineering/calculate/route.ts:367-395 → `runElectricalCalc` (spread verbatim as `...electrical`) |
| `POST /api/engineering/sld body: { topologyType, inverterModel, inverterManufacturer, inverterId, deviceCount, totalStrings, acOutputKw, inverterMaxDcV/maxDcVoltage/mppt*, panelModel/Watts/Voc/Isc, mainPanelAmps, interconnection, selectedCombinerId, combinerId, sources[] }` | app/api/engineering/sld/route.ts — the hybrid lane branch at :392-440 and the single-lane renderer below it; the SLD SVG, its PDF export and the plan set embed |
| `POST /api/engineering/bom body: { inverterId, optimizerId, inverterCount, deviceCount, panelId, moduleCount, rackingId, batteryId, batteryCount, topologyType, interconnectionMethod, panelBusRating, mainPanelAmps, runs, bomQuantities }` | app/api/engineering/bom/route.ts:316-342, 365-415 → bom-engine-v4 → the purchase order / planset BOM sheet |
| `hybridSldSources: SLDSourceBranch[] (per-sub inverterModel, inverterManufacturer, inverterCount, topologyType, acOutputKw, acOCPD, combinerLabel, panelModel…)` | page.tsx:7410 and 15073 → sld/route.ts:392 `sanitizeClientSourceBranches` → the multi-lane renderer (lib/permit/utils/sldAdapter.ts:829-877) |
| `config.combinerId (engineering_config)` | posted as `combinerId` at page.tsx:7286 → `resolveIntegratedEquipment` override path, ranked BELOW the recorded selection |
| `config.retiredInverterFleet` | NOBODY — written by app/api/engineering/electrical-architecture/route.ts:200-208 and read by no reader in app/, lib/ or components/ |
| `electrical (client ElectricalProjectModel)` | the System Config architecture banner + resolution buttons (page.tsx:11583-11613), the topology badge (page.tsx:9427-9434), `topoType` in the SLD payload (page.tsx:7198-7206), and the picker's `pvCoupledToStorage` (page.tsx:11233-11237) |

#### Broken handoffs

##### 13.1.1 — [CRITICAL] The page composes the canonical electrical model from engineering_config, the server composes it from selected_equipment — two answers to "is there a separate PV inverter"

`app/engineering/page.tsx:3088`

- **Upstream produced:** projects.selected_equipment.inverter.id / .inverterId, read by the ONE reader `readExternalInverterIdentity` (lib/electrical/inverterIdentity.ts:53-97) and projected as `model.hasExternalInverter` / `externalInverterId` (lib/electrical/projectModel.ts:286-287)
- **Downstream used instead:** `setElectrical(resolveElectricalProject({ topology: svcTopology, selectedEquipment: { inverterId: config.inverters[0]?.inverterId ?? null, inverterType: config.inverters[0]?.type ?? null, moduleCount: totalPanels } }))` — and no `equipmentProvenance`, no `legacyInverter`
- **Consequence:** The System Config architecture badge, the AUTO_SUGGESTED_LEGACY banner and the two resolution buttons (page.tsx:11583-11613) are all derived from engineering_config. If `config.inverters` is populated but selected_equipment records no inverter, the page offers Ray a resolution the server will not corroborate; in the reverse case (inverter in selected_equipment, empty fleet) the page never shows the conflict at all while /api/engineering/sld refuses with 409. The server's provenance is only ever fetched when the CLIENT model already says unresolved (page.tsx:9409-9410), so the server's verdict cannot reach the screen on its own.

##### 13.1.2 — [CRITICAL] The whole canonical architecture projection in the SLD route is gated on the project having a service graph

`app/api/engineering/sld/route.ts:152`

- **Upstream produced:** `loadElectricalProject` returns a full model for a graph-less project too — `composeElectricalProject` handles `topology === null` and still sets `externalInverterId` from projects.selected_equipment and runs `architectureRefusal`
- **Downstream used instead:** `if (_loaded?.model.topology) { … }` — every projection (topologyType, inverterId, inverterModel, mainPanelAmps, interconnection, batteryCount, batteryBackfeedA, the 409 architecture gate) lives inside this block
- **Consequence:** Any project where projects.service_topology is NULL — i.e. every project before the designer builds the graph — draws its permit-grade SLD entirely from the POST body: `topologyType: topoType` (page.tsx:7198-7206), `inverterModel: invData ? ... : 'String Inverter'` (page.tsx:7255), `mainPanelAmps: config.mainPanelAmps`, `interconnection: config.interconnectionMethod ?? 'LOAD_SIDE'` (page.tsx:7388). This is the mechanism by which System Config equipment survives into the SLD with nothing able to supersede it.

##### 13.1.3 — [CRITICAL] On the ac-coupled arm the SLD route overrides only `inverterId`, leaving the page's `inverterModel`, `inverterManufacturer` and `topologyType` as posted

`app/api/engineering/sld/route.ts:293`

- **Upstream produced:** `_model.externalInverterId` and `_model.solarCoupling === 'ac-coupled-inverter'` from the canonical model — the same block overwrites all three fields as a SET on the dc-coupled and storage-only arms (lines 280-283, 295-298)
- **Downstream used instead:** `} else if (_model.solarCoupling === 'ac-coupled-inverter') { if (_model.externalInverterId) body.inverterId = _model.externalInverterId; }` — `body.inverterModel`, `body.inverterManufacturer` and `body.topologyType` are never touched
- **Consequence:** The overwhelmingly common architecture is the one Rule Eleven does not cover. Because `reconcileFromEngineeringConfig` deliberately never writes the inverter flat (lib/system/selectedEquipment.ts:223-228), `_model.externalInverterId` is normally null for an ecosystem-applied project, so NOTHING is projected and the sheet names, labels and draws the inverter System Config auto-applied — exactly the equipment that should have been superseded.

##### 13.1.4 — [CRITICAL] The hybrid `sources` branch takes every lane's equipment verbatim from the request body and returns before any canonical equipment projection

`app/api/engineering/sld/route.ts:392`

- **Upstream produced:** `_model.solarCoupling` / `_model.externalInverterId` from projects.selected_equipment + projects.service_topology, already loaded at line 151
- **Downstream used instead:** `const _sources = sanitizeClientSourceBranches(body.sources)` — which copies `inverterManufacturer: str(b?.inverterManufacturer)`, `inverterModel: str(b?.inverterModel)`, `inverterCount: num(b?.inverterCount)`, `topologyType: str(b?.topologyType)` straight off the POST body (lib/permit/utils/sldAdapter.ts:840, 849-851), then `topologyType: String(body.topologyType ?? 'HYBRID_MULTI_SOURCE')` at route.ts:425, and the branch RETURNS
- **Consequence:** On every hybrid (roof+ground / roof+fence) job the per-lane inverter identity on the drawing is System Config's `config.subSystems[key].inverterId`, laundered through `computedMulti` → `hybridSldSources` (page.tsx:3749-3753, 7410). The architecture-field override set is scalar-only, so a hybrid lane can never be corrected from the canonical model.

##### 13.1.5 — [CRITICAL] An architecture retirement writes inverterId:null and the subsystem-mirror derivation writes the retired inverter straight back in the same UPDATE

`lib/system/subSystemMirror.ts:290`

- **Upstream produced:** `equipmentPatch.inverter = null; equipmentPatch.inverterId = null;` — the installer's recorded retirement of the separate PV inverter (lib/electrical/architectureResolution.ts:105-107), written via `upsertSelectedEquipment` at app/api/engineering/electrical-architecture/route.ts:148
- **Downstream used instead:** `if (idOrNull(patch.inverterId as string)) out.inverterId = patch.inverterId;` — `subSystemEntryFromFlatEquipmentPatch` has an explicit-clear branch for `batteryId` (lines 292-294) but NONE for `inverterId`, so the retirement is dropped from the map entry; `upsertSelectedEquipment` then runs `flatPatch = { ...flatPatch, ...deriveSelectedEquipmentFlatFromMirror(mirror) }` (lib/db/projects.ts:564) which re-emits `out.inverterId = mirror.inverterId` (subSystemMirror.ts:259) from the untouched map
- **Consequence:** On any project whose selected_equipment is a v2 envelope with >1 subSystems entries (every hybrid), resolving the architecture to dc-coupled-storage persists `inverter: null` but `inverterId: <the retired id>` in the same statement. `readExternalInverterIdentity` falls through the null object to the flat key (inverterIdentity.ts:72-78) and reports SELECTED, so the model resolves `hasExternalInverter` true again, the conflict Ray just answered re-raises itself, and the retired inverter is canonical.

##### 13.1.6 — [CRITICAL] The architecture retirement clears engineering_config.inverters but not engineering_config.subSystems, and the page re-synthesizes the retired inverter from the map

`app/engineering/page.tsx:3280`

- **Upstream produced:** `cfg.inverters = []` persisted server-side (app/api/engineering/electrical-architecture/route.ts:209) plus `setConfig(prev => ({ ...prev, inverters: [] }))` client-side (page.tsx:3164) — the retirement of the separate PV inverter from design authority
- **Downstream used instead:** `const synth = synthesizeFleetFromSubEquipment(key, subMap[key], subSystemCounts[key]);` where `subMap = (config as any).subSystems` — `config.subSystems[key].inverterId` / `.topology` / `.ecosystemBrand` are never cleared by the retirement, and the hydration gates explicitly preserve them ("equipment choices survive in subSystems map", page.tsx:1922)
- **Consequence:** On a hybrid project the retired inverter is recomputed into a fleet on the very next render, flows into `computedMulti` (page.tsx:3704-3718) → `hybridSldSources` → the SLD POST body, and the next autosave writes the synthesized fleet back into engineering_config. Ray clicks an answer that un-answers itself — the exact failure mode the route's own comment at lines 150-166 says it was written to prevent.

##### 13.1.7 — [CRITICAL] The BOM payload invents `fronius-primo-8.2` client-side, making the server's "no equipment may appear from absence" guard unreachable

`app/engineering/page.tsx:7693`

- **Upstream produced:** The canonical state "this project has NO separate PV inverter" — `readExternalInverterIdentity` state NONE, and an empty `config.inverters` after an architecture retirement. app/api/engineering/bom/route.ts:305-322 removed its own `?? 'fronius-primo-8.2'` precisely so absence stays absent
- **Downstream used instead:** `inverterId: firstInv?.type === 'micro' ? (MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id ?? MICROINVERTERS[0]?.id ?? 'enphase-iq8plus') : (firstInv?.inverterId || 'fronius-primo-8.2')`
- **Consequence:** A real catalogue inverter goes onto the bill of materials — the list somebody orders from — for any project with no inverter fleet, and the route's `if (!resolvedInverterId) console.warn('[BOM ROUTE] no inverter id was supplied…')` (bom/route.ts:319-322) can never fire from this client. The micro arm is the same defect with a different product: an unmatched micro id becomes `MICROINVERTERS[0]` / `enphase-iq8plus`.

##### 13.1.8 — [CRITICAL] The BOM route consults the canonical model for service amps, interconnection and battery count but takes the inverter identity from the POST body

`app/api/engineering/bom/route.ts:316`

- **Upstream produced:** `_electrical.model.externalInverterId` and `_electrical.model.solarCoupling`, loaded at bom/route.ts:192-193 and already used to override `body.batteryCount` (:219), `body.mainPanelAmps` (:244) and `body.interconnectionMethod` (:264)
- **Downstream used instead:** `let resolvedInverterId: string = typeof body.inverterId === 'string' && body.inverterId.trim() ? body.inverterId.trim() : '';` — then `inverterId: resolvedInverterId` into the engine input (:365)
- **Consequence:** The route proves it can project canonical values and then declines to project the one that decides which inverter is quoted, how many optimizers are counted, and which ecosystem BOS lines are generated. System Config's pick is the BOM's inverter, unconditionally, even when the model holds a different one or none.

##### 13.1.9 — [CRITICAL] The compliance/calculate route loads the canonical model but runs NEC 705.12(B) on the page's own busbar and interconnection scalars

`app/api/engineering/calculate/route.ts:368`

- **Upstream produced:** `_loaded.model.serviceRatedAmps`, `_loaded.model.topology.panels[i].busbarRatingA` / `.mainBreakerA`, and `interconnectionMethodScalar(_loaded.model.topology)` — all reachable from the model loaded at calculate/route.ts:91-94, and all three ARE projected by the SLD route (sld/route.ts:211-237) and the BOM route (bom/route.ts:244, 264)
- **Downstream used instead:** `const electricalInput: ElectricalCalcInput = { ...electrical, … }` — spreading the body's `interconnection: { method: config.interconnectionMethod ?? 'LOAD_SIDE', busRating: config.panelBusRating ?? 200, mainBreaker: config.mainPanelAmps ?? 200 }` (built at app/engineering/page.tsx:6512-6516). The route uses the model for `solarCoupling` and `dcStringLimits` only
- **Consequence:** The Electrical Sizing tab's 120% busbar verdict, the backfed-breaker sizing and the NEC article selected (705.12(B) vs 705.11) come from engineering_config while the SLD and BOM for the same project come from the graph. The same project certifies one busbar result on the tab and a different one on the sheet, and `?? 200` fabricates a 200 A busbar for any project whose stored config predates the key.

##### 13.1.10 — [CRITICAL] System Config never seeds `config.interconnectionMethod` from the service graph's POI relationship

`app/engineering/page.tsx:6513`

- **Upstream produced:** `topology.pointsOfInterconnection[].relationship` and its projection `interconnectionMethodScalar(topology)` (lib/electrical/loadElectricalProject.ts:270-301), which returns null for an unresolved POI precisely so no NEC article is handed out by a `??`
- **Downstream used instead:** `method: config.interconnectionMethod ?? 'LOAD_SIDE'` — and the same expression at page.tsx:3558, 3723 (computeMultiSystem), 3787/3831 (the CT/metering composer), 7388 (SLD), 7821 (BOM), 8995. The 13 writers of `config.interconnectionMethod` are the UI radio (page.tsx:12827) and hydration from engineering_config / engineering_runs / snapshots (page.tsx:1673, 2471, 2483) — never the graph
- **Consequence:** A graph that records a supply-side tap is ignored by everything the page computes locally: `computeMultiSystem` aggregates a hybrid against LOAD_SIDE, the consumption-CT clamp location is chosen for the wrong side, and the busbar display at page.tsx:10889/12806 recommends against the wrong article. Only the SLD and BOM routes correct it, and only when a graph exists.

##### 13.1.11 — [CRITICAL] GET /api/projects/[id] resurrects a retired inverter and a stale snapshot panel from productions.data_json with no identity guard

`lib/db/production.ts:278`

- **Upstream produced:** `selected_equipment.inverter = null` / `inverterId = null` — a RECORDED NONE. The sibling reader `enrichProjectRow` guards exactly this with `readExternalInverterIdentity` + `mayBackfillExternalInverter` (lib/db/projects.ts:80-88, 114-122), and lib/electrical/inverterIdentity.ts:16-18 names this store "THE DANGEROUS ONE"
- **Downstream used instead:** `selectedPanel: canonEq.selectedPanel ?? selectedPanel, selectedInverter: canonEq.selectedInverter ?? selectedInverter` — where the locals are `dj.selectedPanel` / `dj.selectedInverter` off productions.data_json (lib/db/production.ts:205-206), and `hydrateCanonicalEquipment` turns the recorded `null` into `undefined` (lib/db/core.ts:315) so the `??` fires
- **Consequence:** This is the route the engineering page itself calls on every project load (page.tsx:1365). A DC-coupled project whose inverter was deliberately retired is handed one back from an old production snapshot, and `canonicalPanelId` can be set from a snapshot panel rather than the canonical store — the gap-filler the guard two files over was written to close.

##### 13.1.12 — [CRITICAL] The canonical-panel reconcile force-re-pins every string onto `canonicalPanelId`, which may have come from a production/proposal snapshot

`app/engineering/page.tsx:2895`

- **Upstream produced:** The engineering panel choice persisted as `engineering_config.inverters[].strings[].panelId` (and mirrored into `subSystems[key].panelId`)
- **Downstream used instead:** `setConfig(prev => (applyPanelToEngineeringConfig(prev, canonId, _cpScopeKey) as unknown as ProjectConfig | null) ?? prev)` — documented at page.tsx:2875-2877 as acting "ABOVE the saved engineering_config", with `canonId = canonicalPanelId` sourced from `p.selectedPanel?.id` (page.tsx:1374)
- **Consequence:** When `p.selectedPanel` was backfilled from productions.data_json / proposals.data_json (the break above), a stale snapshot panel silently overwrites the engineer's panel on every string, the 800 ms autosave persists it to engineering_config, and the save-config write-back then promotes it into selected_equipment — so the wrong module model reaches the BOM, the planset module schedule and the panel count arithmetic.

##### 13.1.13 — [CRITICAL] The sizing engine has no architecture input, so it recommends a standalone PV inverter on a DC-coupled project and AUTO mode writes it in

`lib/system/sizingEngine.ts:77`

- **Upstream produced:** `electrical.solarCoupling === 'dc-coupled-storage'` — composed on the page at line 3085 and used to suppress the picker's inverter DEFAULT at page.tsx:11233-11237
- **Downstream used instead:** `sizeSystemFromBrand({ systemType, panelCount, panelWattage, panelVoc, panelVmp, panelIsc, panelTempCoeffVoc, panelId, optimizerMaxOutputCurrent, selectedBrand, selectedInverterId, batteryEnabled, batteryMode, batteryGoal, batteryTargetKwh, batteryDesiredUnits })` (page.tsx:3970-4014) — `SizingInput` declares no coupling, no service, no interconnection and no topology field at all
- **Consequence:** The EcosystemPicker guard removes the default but not the engine. On a DC-coupled job the recommendation panel still proposes a PV inverter, and in AUTO mode the auto-apply watcher fires `applySizingRecommendation(rec)` (page.tsx:5413) which writes `inverters: newInverters` and `subSystems[key].inverterId = primaryModel.equipmentDbId` (page.tsx:4730-4744) — re-creating the architecture the resolution retired, in the two stores that resurrect it.

##### 13.1.14 — [CRITICAL] `pvCoupledToStorage` fails open: a failed service-topology read re-enables the inverter auto-default that caused the original live failure

`app/engineering/page.tsx:11233`

- **Upstream produced:** `projects.service_topology` — the recorded `solarCoupling` and the storage units that publish `pvInputLimits`
- **Downstream used instead:** `pvCoupledToStorage={ electrical?.solarCoupling === 'dc-coupled-storage' || (svcTopology?.storage ?? []).some(u => u.role === 'inverter-unit' && !!u.pvInputLimits) }` — both arms resolve from `svcTopology`, which is set to `null` on any throw or on `!data.available` (page.tsx:1215-1219), making the whole expression `false`
- **Consequence:** One dropped GET and the picker auto-selects `kit.microinverters[0] ?? kit.stringInverters[0] ?? kit.optimizers[0]` again (EcosystemPicker.tsx:182-187). Clicking Apply then records an invented inverter as the installer's decision on a four-Powerwall job — the precise failure the prop's own 19-line comment (EcosystemPicker.tsx:111-130) documents.

##### 13.1.15 — [MAJOR] System Config's service scalars cannot express the 400 A / two-MSP path, and default both to 200

`app/engineering/page.tsx:6514`

- **Upstream produced:** Three distinct graph facts the page already separates for DISPLAY — `electrical.serviceRatedAmps` (400 A aggregate), `panels[0].busbarRatingA`, `panels[0].mainBreakerA` (page.tsx:9338-9354)
- **Downstream used instead:** `busRating: config.panelBusRating ?? 200, mainBreaker: config.mainPanelAmps ?? 200` in buildCalcPayload, and `{ mainPanelAmps: config.mainPanelAmps ?? 200, busRating: config.panelBusRating ?? config.mainPanelAmps ?? 200 }` into `computeMultiSystem` (page.tsx:3721-3723) — one scalar pair, no per-panelboard dimension
- **Consequence:** On a 400 A / two-gateway site the second MSP has no representation in anything System Config emits: both panelboards are computed as one 200 A busbar, and `defaultProject`'s `mainPanelAmps: 200, panelBusRating: 200` (page.tsx:626, 646) are fabricated values no designer stated. The simple 200 A / one-MSP path works only because the default happens to be right.

##### 13.1.16 — [MAJOR] The localStorage mirror is written before the stale-fleet autosave guard, so the DB's refusal is undone by the fallback restore

`app/engineering/page.tsx:2765`

- **Upstream produced:** The autosave guard's engineered refusal to persist a placeholder fleet — `if (_asIsPlaceholder) { console.warn('[AUTO-SAVE BLOCKED: STALE INVERTER CONFIG]' …); return; }` (page.tsx:2779-2793)
- **Downstream used instead:** `window.localStorage.setItem(\`eng-config-${currentProjectId}\`, JSON.stringify(config))` — executed 14 lines ABOVE the guard, unconditionally and with no placeholder check
- **Consequence:** The 1×10 `newString()` placeholder the database deliberately refused is kept in the browser and is the config restored at page.tsx:2327 whenever projects.engineering_config is absent, so a project re-opens with a 10-panel fleet against a 37-panel layout and the sizing engine is driven from it.

##### 13.1.17 — [MINOR] `engineering_config.retiredInverterFleet` is written and read by nobody

`app/api/engineering/electrical-architecture/route.ts:200`

- **Upstream produced:** `cfg.retiredInverterFleet = { retiredAt, retiredBecause, moduleCount, inverters: retiredStrings }` — the per-string module assignment the installer committed (10/9/9/9), preserved explicitly so it is not "deleted in silence"
- **Downstream used instead:** Nothing. No reader of `retiredInverterFleet` exists in app/, lib/ or components/; the re-derivation against the storage DC input window is "reported rather than performed" but no surface reports it
- **Consequence:** The string assignment is retained as dead JSON. The designer is told the lengths will be re-derived against the real endpoint and no surface shows the retired assignment, so the only record of what was retired is invisible to the page that has to rebuild it.

##### 13.1.18 — [MINOR] `config.combinerId` remains a second override of the combiner the project recorded, and is still posted with every drawing

`app/engineering/page.tsx:7286`

- **Upstream produced:** `projects.selected_equipment.combinerSelection` — the installer's recorded Envoy/combiner pick, written by CombinerSelector and by the ecosystem apply (page.tsx:11363-11367) and read from the store by the SLD, BOM and permit routes
- **Downstream used instead:** `combinerId: config.combinerId || undefined` — an engineering_config-resident override sent alongside the authoritative `selectedCombinerId: projectCombinerId || undefined`
- **Consequence:** Two fields naming one device travel in the same payload. `resolveIntegratedEquipment` ranks the session override below the recorded selection (page.tsx:14918-14921), so today the store wins — but a legacy project still carrying `config.combinerId` keeps a live second writer for a fact the BOM and permit read from one store, and nothing invalidates it when the recorded selection changes.

---

### 13.2 SERVICE TOPOLOGY

*17 breaks — 7 verified by a refuter.*

#### What this stage is

SERVICE TOPOLOGY is the only stage in SolarPro that models the service as a GRAPH rather than a scalar: an aggregate `service.ratedAmps`, N `branches[]`, N `panels[]` (each with its own `busbarRatingA`/`mainBreakerA`), N `domains[]` (one gateway each), `storage[]` instances with roles (inverter-unit vs energy-expansion), `generation[]`, `aggregationPanels[]`, `pointsOfInterconnection[]`, `devices[]` (four disconnect roles with in-line placement), `solarCoupling`, an optional `loads` model, and an `interconnection` context. It is authored by `components/engineering/ServiceTopologyWizard.tsx` (six steps; from step 2 onward it mutates a real `ServiceTopology` via the pure functions in `lib/electrical/topologyAuthoring.ts` + `topologyPresets.ts` — there is no second draft model), held by `components/engineering/ServiceTopologyBuilder.tsx`, and persisted WHOLE by `PUT /api/projects/[id]/service-topology` into `projects.service_topology` (JSONB, schemaVersion 4, self-healing `ADD COLUMN IF NOT EXISTS` at lib/db/serviceTopology.ts:608). The read path (`parseServiceTopology(raw,'active')`) shape-checks every node, refuses to coerce unknown enum members, and re-hydrates manufacturer facts from the catalogue, reporting what moved in `refreshes`. `evaluateServiceTopology()` then produces ~40 PASS / FAIL / NOT_EVALUATED checks including the per-panel NEC 705.12(B) verdict, SCCR chain, bonding, DER isolation coverage and POI governing article — and this is the stage's central break: those conclusions are consumed by the Service Topology screen, by one printed text line on the permit schedule, and by the SLD's schedule-row overlay, but they GATE nothing. The only production gate (`architectureRefusal`, 409) keys off `model.conflicts` for `SOLAR_COUPLING_UNRESOLVED` only, so a topology with a FAIL on the busbar rule, on `service.branch-sum`, or on DER isolation still produces an SLD, a BOM, a priced proposal and a permit package — and those four surfaces re-derive the same NEC 705.12(B) answer from `body.panelBusRating`/`body.mainPanelAmps` scalars instead of from the panels the graph holds.

#### Data in

| Field | Where it comes from |
|---|---|
| `serviceAmps (→ service.ratedAmps)` | ServiceTopologyWizard local state, seeded from `initial?.service.ratedAmps ?? 400` — components/engineering/ServiceTopologyWizard.tsx:69; choices from SERVICE_SIZE_CHOICES lib/electrical/topologyPresets.ts:29, or a free-text number at ServiceTopologyWizard.tsx:173 |
| `phase / voltage (→ service.phase, service.voltage)` | ServiceTopologyWizard.tsx:70 and :84 (`voltage` is DERIVED from phase in the component: 480/208/240) — no store supplies either |
| `distribution preset id + customBranches` | ServiceTopologyWizard.tsx:71-72 local state ONLY. Never persisted — DISTRIBUTION_PRESETS (topologyPresets.ts:60) decides branch count, then the id is discarded; a reloaded graph cannot say which preset built it (wizard re-entry hardcodes `distribution='two-main-panels'`) |
| `branches[].ratedAmps + panels[].busbarRatingA + panels[].mainBreakerA` | COMPUTED, not input: `presetBranchAmps(serviceAmps, count)` → `addPanel(t,{busbarRatingA: per, mainBreakerA: per})` — lib/electrical/topologyPresets.ts:126-133 |
| `gatewayProductId (→ domains[].gateway.productId)` | CATALOGUE DEFAULT, not a project store: `GATEWAYS()[0]?.id` from BACKUP_INTERFACES — components/engineering/ServiceTopologyWizard.tsx:37,75. `projects.selected_equipment.backupInterfaceId` is never consulted |
| `storageProductIds / expansionProductIds (→ storage[])` | CATALOGUE DEFAULT: `INVERTING()[0]?.id` / `EXPANSIONS()[0]?.id` from BATTERIES — ServiceTopologyWizard.tsx:38-39,259-260. `selected_equipment.batteries[0].id` is never consulted |
| `gateway.continuousRatingA, mainBreakerA, sccrA, internalPanelboard; storage[].continuousOutputA, ocpdA, usableKwh, pvInputLimits` | lib/equipment-db.ts via `buildDomainFromCatalogue` — lib/electrical/topologyAuthoring.ts:174; re-resolved on every active read by `hydrateTopologyFromCatalogue` — lib/db/serviceTopology.ts:586 |
| `domains[].storageConnection` | ServiceTopologyWizard.tsx:400-422 (site-wide radio) or :623-639 (per-domain select). Default is `'unresolved'` from topologyAuthoring.ts (no silent default) |
| `interconnection.derArrangement + aggregationPanels[] + pointsOfInterconnection[]` | `applyDerArrangement` / `applyPerSystemGenerationPanels` driven by ServiceTopologyWizard.tsx:503-526 and :628-634 — lib/electrical/topologyPresets.ts:366,526 |
| `devices[] (4 disconnect roles + der-isolation-disconnect)` | ServiceTopologyWizard.tsx:752-781 (DISCONNECT_ROLES, topologyPresets.ts:662) and :682-704 (`applyIsolationArrangement`, topologyPresets.ts:290). `ratedAmps` for the role checkboxes is `draft.service.ratedAmps` (ServiceTopologyWizard.tsx:764) — the AGGREGATE, not the branch |
| `solarCoupling` | ServiceTopologyWizard.tsx:485 (`setSolarCoupling`), OR `POST /api/engineering/electrical-architecture` (app/api/engineering/electrical-architecture/route.ts:116), OR `persistElectricalCanonicalization` writing a DERIVED value (lib/electrical/loadElectricalProject.ts:335) |
| `interconnection.meterCollarPermitted` | ServiceTopologyWizard.tsx:88 via the `meterCollarPermitted` prop — but the only caller that passes it is ServiceTopologyBuilder.tsx:403, which passes `topology.interconnection.meterCollarPermitted` (itself). The empty-project mount at ServiceTopologyBuilder.tsx:191 passes nothing → `null`. No AHJ/utility store writes it |
| `interconnection.utilityId` | NOWHERE in production. `createServiceTopology` accepts it (lib/electrical/topologyAuthoring.ts:34,54) but `buildServiceFromPreset` passes only ratedAmps/voltage/phase (topologyPresets.ts:117-119). Always null; the utility lives in `engineering_config.utilityId` (app/engineering/page.tsx:647) |
| `interconnection.multiGatewayMeteringDoc` | NOWHERE in production. Only lib/electrical/fixtures/tesla400aTwoGateway.ts:376 calls `teslaMultiGatewayDocState()` (lib/electrical/adapters/tesla.ts:62) |
| `existing graph for re-entry (`initial`)` | GET /api/projects/[id]/service-topology → readServiceTopology → projects.service_topology, handed down at ServiceTopologyBuilder.tsx:128 → :402 |
| `loads (LoadModel) / calculatedServiceDemandA` | components/engineering/ServiceNodeInspector.tsx (`setLoadModel`/`setPanelLoad`, topologyAuthoring.ts:724,729) only — the wizard never asks |

#### What it calculates

- Materialises the graph from the distribution answer: `buildServiceFromPreset` creates the service, N equal branches (`presetBranchAmps` = ratedAmps/count, floored, remainder left UNALLOCATED on purpose) and one panel per branch with busbar=main=branch rating, then RECORDS the feed as `branches[].panelIds` rather than leaving ordinal inference — lib/electrical/topologyPresets.ts:115-136
- One backup domain per backed-up panel, on the branch that feeds it, and removal of domains whose panel was un-ticked — components/engineering/ServiceTopologyWizard.tsx:93-119
- Resolves catalogue facts onto instances once at authoring time (`buildDomainFromCatalogue`) and re-resolves them on every active read (`hydrateTopologyFromCatalogue`), returning `refreshes[]` = every manufacturer number that moved since the project was authored — lib/electrical/topologyAuthoring.ts:174, lib/db/serviceTopology.ts:586-592
- `summariseStorage`: inverter-unit count, expansion count (NEVER folded in), Σ continuous AC output of inverting units only, Σ usable kWh of all units, and per-domain splits — lib/electrical/serviceTopology.ts:950
- `resolveDemands`: service / per-branch / per-domain calculated demand from the load model, with `unmodelledPanelIds` so a partial load model makes the sum UNKNOWN rather than smaller — lib/electrical/serviceTopology.ts:1040
- `deriveBonding`: neutral-ground bond location — lib/electrical/serviceTopology.ts:1240
- `sizeAggregationPanel`: the generation panel's input OCPDs and standard output OCPD from the sources that feed it — lib/electrical/serviceTopology.ts:1116
- `governingArticleFor(poi.relationship)`: the NEC article (705.12(B) vs 705.11 vs manufacturer listing vs none) — lib/electrical/serviceTopology.ts:588
- `evaluateServiceTopology`: ~40 checks with conclusion PASS/FAIL/NOT_EVALUATED + `requires[]` tokens + citation, folded by `foldConclusions` into `overall`. Includes the per-panel NEC 705.12(B) verdict `maxLoadSideBackfeedA(p.busbarRatingA, p.mainBreakerA)` scoped `domain:<id>` (serviceTopology.ts:1565-1573), `service.branch-sum`, `service.demand`, `branch.ocpd`, `domain.gateway-passthrough`, `domain.panel-rating`, `aggregation.landing/busbar/island-integrity/sccr/output-ocpd/selection`, `sccr.chain`, `bonding.location`, `device.role-combination`, `device.inline-rating`, `device.selection`, `interconnection.meter-collar/der-isolation/arrangement/der-isolation-coverage/isolation-accepted`, `poi.relationship`, `pv.coupling`, `pv.dc-input`, `metering.multi-gateway` — lib/electrical/serviceTopology.ts:1284-2121
- `equipmentQuantities` / `equipmentInstancesFromTopology` / `acSourcesFromTopology` / `reconcileQuantities`: product id → instance count, and the AC-source set an expansion must not appear in — lib/electrical/topologyEquipment.ts:70,156,171,206
- `legacyServiceScalars`: the SANCTIONED projection of the graph onto `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps` from `panels[0]`, plus `panelsNotRepresented` — lib/electrical/topologyAuthoring.ts:815
- `buildServiceOverview` (topologyOverview.ts:556) and `serviceTopologyReleaseReadiness` (lib/permit/utils/serviceTopologySchedule.ts:385): the overview/allocation and the split of NOT_EVALUATED into blocking requirements vs OPTIONAL (OPTIONAL_REQUIREMENT_TOKENS = {'loads.model'})
- `electricalRevision(model)`: the name of this electrical state, stamped on generated artefacts — lib/electrical/revision.ts

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `projects.service_topology = {schemaVersion:4, topology:ServiceTopology, updatedAt, refreshes:[]}` | lib/db/serviceTopology.ts:614-629 (writeServiceTopology) → read by lib/electrical/loadElectricalProject.ts:154,197 (the one server assembly) and by app/api/projects/[id]/service-topology/route.ts:37 |
| `PUT response {success, topology, evaluation:{overall,checks}, equipmentQuantities}` | NOBODY reads `evaluation` or `equipmentQuantities` — components/engineering/ServiceTopologyBuilder.tsx:151 reads only `data.success`/`data.error` |
| `GET response {available, schemaVersion, updatedAt, topology, evaluation, equipmentQuantities}` | ServiceTopologyBuilder.tsx:128 and app/engineering/page.tsx:1215-1217 read ONLY `data.topology`; both then RECOMPUTE the evaluation client-side (ServiceTopologyBuilder.tsx:171, ServiceTopologyPanel.tsx:74,76). `refreshes` is not even returned by the route (route.ts:45-60) |
| `model.topology (whole graph)` | app/api/engineering/sld/route.ts:197 → `body.serviceTopology`; app/api/engineering/sld/pdf/route.ts:196; app/api/engineering/permit/route.ts:845 → `body.project.serviceTopology`; app/api/engineering/bom/route.ts:622 → `bomFromServiceTopology` |
| `model.serviceRatedAmps (aggregate)` | app/api/engineering/sld/route.ts:218, app/api/engineering/bom/route.ts:244, app/api/engineering/sld/pdf/route.ts:206 — all three overwrite `body.mainPanelAmps` with it. app/api/engineering/permit/route.ts does NOT |
| `model.storage.invertingUnitCount` | app/api/engineering/sld/route.ts:258 and app/api/engineering/bom/route.ts:219 overwrite `body.batteryCount`. app/api/engineering/calculate/route.ts does NOT (route.ts:378 takes the body's) |
| `interconnectionMethodScalar(topology) → {value,basis} \| null` | app/api/engineering/sld/route.ts:226-237, bom/route.ts:257-264, sld/pdf/route.ts:209-214, permit/route.ts:810-821. Returns null (projects nothing) for an unresolved/mixed POI — lib/electrical/loadElectricalProject.ts:270-301 |
| `domains[].storageConnection === 'der-aggregation-panel' ⇒ zero storage on the MSP busbar` | app/api/engineering/sld/route.ts:340-343 sets `body.batteryBackfeedA = 0`. One of the few places an engineered topology conclusion actually reaches a downstream number |
| `evaluation.checks (PASS/FAIL/NOT_EVALUATED)` | components/engineering/ServiceTopologyPanel.tsx:93 (display), lib/electrical/topologyOverview.ts:560 (needs-input screen), lib/sld-professional-renderer.ts:4253 → `overlayServiceTopologyRows` (schedule rows + the '120% Rule' / 'NEC Reference' cells, renderer lines 3011-3017) and `renderTopologyServiceSection` (renderer:5340), lib/permit/utils/serviceTopologySchedule.ts:394 → one printed 'ENGINEERING INPUT REQUIRED' line (lib/permit/sections/structuralPages.ts:1572). NOTHING gates on them |
| `ReleaseReadiness.releaseReady / .drawable / .failures / .indeterminate / .optional` | NOBODY in production — lib/permit/sections/structuralPages.ts:1575 reads only `.requirements` (lib/permit/utils/serviceTopologySchedule.ts:485 computes the rest for tests) |
| `legacyServiceScalars(topology) → {mainPanelAmps, mainPanelBusAmps, mainBreakerAmps, panelsNotRepresented}` | NOBODY — only tests/topologyAuthoredThenAgreesEverywhere.postgres.test.ts:236 |
| `acSourcesFromTopology(topology)` | NOBODY — zero callers outside its own definition at lib/electrical/topologyEquipment.ts:171 |
| `buildServiceTopologyGraph(topology, evaluation) → ServiceSldGraph` | NOBODY — zero callers outside lib/sld/serviceTopologyGraph.ts:91, although docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md names it 'the replacement for the service part of the drawing' |
| `equipmentQuantities / equipmentInstancesFromTopology` | lib/bom/topologyBom.ts:103 (BOM lines + pricing) and lib/permit/utils/serviceTopologySchedule.ts:319 (the permit schedule). Instances with no `productId` — every wizard-built panelboard and every disconnect — are dropped at lib/bom/topologyBom.ts:109 |
| `topology.loads / resolveDemands().serviceA` | UI only (ServiceNodeInspector.tsx:115,612,701; ServiceTopologyMap.tsx:97; ServiceTopologyPanel.tsx:78) and evaluateServiceTopology. No server/permit/SLD/BOM consumer |
| `refreshes[] (manufacturer facts corrected on read)` | lib/electrical/authorityInspector.ts:338 only (the dev endpoint /api/dev/electrical-authority). Never shown to an operator |

#### Broken handoffs

##### 13.2.1 — [CRITICAL] The 120% busbar rule is computed from the sidebar's `panelBusRating` scalar, never from `panels[].busbarRatingA` — and `legacyServiceScalars`, the sanctioned projection, has zero production callers

`app/api/engineering/sld/route.ts:1192`

- **Upstream produced:** `panels[0].busbarRatingA = 200` and `panels[0].mainBreakerA = 200`, written by `addPanel(t,{busbarRatingA: per, mainBreakerA: per})` at lib/electrical/topologyPresets.ts:130, and projected by `legacyServiceScalars` → `{mainPanelAmps: p.busbarRatingA, mainPanelBusAmps: p.busbarRatingA, mainBreakerAmps: p.mainBreakerA}` at lib/electrical/topologyAuthoring.ts:815-828
- **Downstream used instead:** `panelBusRating: Number(body.panelBusRating ?? body.mainPanelAmps) || 200` — and the page always posts `panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200` (app/engineering/page.tsx:7392), where `panelBusRating: 200` is a hardcoded DEFAULT_CONFIG value (app/engineering/page.tsx:646). `legacyServiceScalars` is called only by tests/topologyAuthoredThenAgreesEverywhere.postgres.test.ts:236
- **Consequence:** The busbar base for NEC 705.12(B) on the SLD, the BOM (lib/bom-engine-v4.ts:1910,3303 `busRating = input.panelBusRating ?? input.mainPanelAmps ?? 200`), the stamped permit (lib/permit/snapshot/build.ts:3121) and the PDF export (app/api/engineering/sld/pdf/route.ts:394) is a UI scalar that defaults to 200 regardless of what the graph holds. The graph's own per-panel verdict (`domain.busbar-705-12`, lib/electrical/serviceTopology.ts:1565) is computed correctly and is not the number anything is sized or purchased against. The page itself derives `panelBusRatingForDisplay` from `_primaryPanel?.busbarRatingA` (app/engineering/page.tsx:9348) — for DISPLAY ONLY; the posted payload ignores it.

##### 13.2.2 — [CRITICAL] `mainPanelAmps` means the panel's MAIN BREAKER in the page and the AGGREGATE SERVICE on the server — so the 120% formula subtracts a 400 A main from a 200 A bus

`app/api/engineering/sld/route.ts:1080`

- **Upstream produced:** Two distinct facts the graph keeps separate: `service.ratedAmps = 400` (the aggregate) and `panels[0].mainBreakerA = 200` (the MSP main). app/engineering/page.tsx:9383-9396 writes `config.mainPanelAmps` from the PANEL's main breaker and explicitly refuses to let that control touch the aggregate (page.tsx:9324-9332).
- **Downstream used instead:** `body.mainPanelAmps = _model.serviceRatedAmps` (app/api/engineering/sld/route.ts:218; same at bom/route.ts:244, sld/pdf/route.ts:206), then `mainPanelAmps: Number(body.mainPanelAmps ?? 200)` into `computeSystem`, which evaluates `(totalBackfeedA + input.mainPanelAmps) <= (input.panelBusRating * 1.2)` at lib/computed-system.ts:1692 and prints `... + 400A main = ...A > 120% of 200A bus (240A max)` at lib/computed-system.ts:1702
- **Consequence:** On Ray's 400 A / 2×200 A job the allowance becomes `maxLoadSideBackfeedA(200, 400) = 200*1.2 - 400 = -160 A` (lib/nec/rule705_12.ts:31-33, no clamp), so the printed 705.12(B) panel and PASS/FAIL verdict are computed against a 400 A main breaker that exists nowhere in the design. This is precisely the inversion the page's own comment at app/engineering/page.tsx:9326-9328 warns about, reintroduced on the server.

##### 13.2.3 — [CRITICAL] The permit SNAPSHOT — the immutable released record — builds its own synthetic `serviceTopology` from scalars and never reads the real graph the permit route just attached

`lib/permit/snapshot/build.ts:863`

- **Upstream produced:** `body.project.serviceTopology = _m.topology` — the whole graph: 2 branches, 2 panelboards with their own busbar/main, 2 domains each with a gateway, 4 storage instances with roles, 2 per-system generation panels, 2 in-line per-path isolation switches, the POI relationships (app/api/engineering/permit/route.ts:845)
- **Downstream used instead:** `const serviceTopology: ServiceTopologyObject[] = (() => { const method = String(proj.interconnectionMethod ?? 'LOAD_SIDE'); ... const mainA = proj.mainPanelAmps ?? proj.mainBreakerA ?? null; ... })()` — a hand-built single-service chain (svc-combiner → svc-combiner-loadbreak → svc-tap-conductors → svc-fused-ocpd → MSP) with `provenance: { source: 'computeSystem topology (combiner)' }`. Zero occurrences of `proj.serviceTopology` anywhere in lib/permit/snapshot/build.ts.
- **Consequence:** The released snapshot cannot prove which of two MSPs a package was about, records one disconnect where the design has two in-line per-path switches, and carries a name collision (`snapshot.electrical.serviceTopology` ≠ `projects.service_topology`) that lib/permit/sections/electricalPages.ts:1561 then reads as if it were the canonical graph. Classified MUST MIGRATE in docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md and still open.

##### 13.2.4 — [CRITICAL] The snapshot's point of interconnection — method, busbar, main breaker — comes entirely from the HTTP request body

`lib/permit/snapshot/build.ts:3120`

- **Upstream produced:** `pointsOfInterconnection[].relationship` with its governed article from `governingArticleFor` (lib/electrical/serviceTopology.ts:588), plus `panels[].busbarRatingA` / `panels[].mainBreakerA` per panel
- **Downstream used instead:** `poi: { method: proj.interconnectionMethod ?? 'LOAD_SIDE', busbarA: proj.panelBusRating ?? proj.mainPanelAmps ?? null, mainBreakerA: proj.mainPanelAmps ?? null, rulePasses: (elec?.busbar as any)?.passes ?? null }`
- **Consequence:** `resolveInterconnection` (lib/permit/sections/electricalPages.ts:89-95) projects exactly these onto PV-4A / E-1 / the cover sheet as `busA`, `mainA`, `busLimit = busA*1.2`, `maxBackfeedA`, and the blocker message at build.ts:2679 prints the arithmetic `(${_bus}A bus x 120%) - ${_main}A main`. The stamped NEC article and the stamped busbar verdict are therefore decided by the posted scalars, not by the graph — and `?? 'LOAD_SIDE'` hands out 705.12(B) to any project whose POI nobody classified.

##### 13.2.5 — [CRITICAL] `?? 'LOAD_SIDE'` still hands out NEC 705.12(B) wherever the graph's POI is `'unresolved'`

`app/api/engineering/sld/route.ts:1195`

- **Upstream produced:** `pointsOfInterconnection[].relationship === 'unresolved'` — a deliberate member that exists to refuse the guess; `interconnectionMethodScalar` returns null for it so the caller projects NOTHING (lib/electrical/loadElectricalProject.ts:276,295). The topology also emits `poi.relationship` NOT_EVALUATED (serviceTopology.ts:1857).
- **Downstream used instead:** `const raw = String(body.interconnection ?? body.interconnectionType ?? 'LOAD_SIDE'); if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap'` — and the same default at sld/route.ts:463, :1083, :1125, app/api/engineering/sld/pdf/route.ts:370, app/api/engineering/bom/route.ts:529, lib/permit/utils/sldAdapter.ts:198, lib/permit/snapshot/build.ts:864, lib/bom-engine-v4.ts:1900
- **Consequence:** An unclassified point of interconnection is drawn as a load-side tap, selects 705.12(B) and the 120% allowance, and makes the BOM buy a backfed breaker (lib/bom-engine-v4.ts:1908) instead of the 705.11 supply-side hardware. The renderer reads it at lib/sld-professional-renderer.ts:4240-4243 (`isLoadSide = intercon.includes('load')`). The projection added for the resolved case never closed the unresolved case.

##### 13.2.6 — [CRITICAL] `evaluateServiceTopology`'s FAIL and NOT_EVALUATED conclusions gate nothing — only the coupling conflict refuses

`lib/electrical/architectureGate.ts:21`

- **Upstream produced:** PASS / FAIL / NOT_EVALUATED per check, folded into `overall`, with `requires[]` and a citation: `domain.busbar-705-12` FAIL, `service.branch-sum` FAIL ('two 200 A panels are not automatically valid on a 400 A service'), `interconnection.der-isolation` FAIL, `aggregation.landing` FAIL ('the storage has nowhere to land'), `sccr.chain` FAIL, `bonding.location` FAIL, `storage.expansion-has-a-host` FAIL (lib/electrical/serviceTopology.ts:1317,1534,1571,1516,1645,1671,1614)
- **Downstream used instead:** `architectureRefusal(model, revision)` is the only production gate, and `architectureResolutionRequired = conflicts.some(c => c.code === 'SOLAR_COUPLING_UNRESOLVED')` (lib/electrical/projectModel.ts:631). The checks reach a sheet only as text: `readiness.requirements.map(esc).join(' · ')` at lib/permit/sections/structuralPages.ts:1575, and `.releaseReady` / `.failures` / `.drawable` (lib/permit/utils/serviceTopologySchedule.ts:485) have no production reader at all.
- **Consequence:** A project whose own engineering says the busbar allowance is EXCEEDED, or whose two 200 A branches do not fit the recorded service, or whose storage lands in a generation panel that does not exist, still returns 200 from /api/engineering/sld, /sld/pdf, /bom and /permit — a printable, attachable, submittable permit-grade artefact. The refusal pattern Ray required for the architecture conflict was never extended to the topology's own FAILs.

##### 13.2.7 — [CRITICAL] The 705.12(B) battery contribution is still `resolveBatteryBranch(batteryId, batteryCount)` on the Compliance path; `acSourcesFromTopology` — the sanctioned replacement — has zero callers

`app/api/engineering/calculate/route.ts:378`

- **Upstream produced:** `summariseStorage` / `acSourcesFromTopology`: 2 inverter-units contributing AC and 2 energy-expansions contributing NONE, with per-domain splits (lib/electrical/serviceTopology.ts:950, lib/electrical/topologyEquipment.ts:171)
- **Downstream used instead:** `batteryCount: electrical.batteryCount ?? 0` straight from the request body into `runElectricalCalc`, which does `resolveBatteryBranch(input.batteryId, input.batteryCount)` (lib/electrical-calc.ts:935-940) and then `maxLoadSideBackfeedA(icBusRating, icMainBreaker)` where `icBusRating = input.interconnection?.busRating ?? input.mainPanelAmps` (lib/electrical-calc.ts:954-955,978). `acSourcesFromTopology` has no caller outside its definition.
- **Consequence:** The Compliance tab — unlike /sld and /bom, which do overwrite `body.batteryCount` from the graph — resolves four INVERTING units from a graph that holds two inverters plus two DC expansions: four backfeed breakers, twice the AC busbar contribution, 54 kWh attributed to four Powerwalls. docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md calls this 'the one that is wrong, not merely narrow' and lists it as migration step 1; it is unstarted.

##### 13.2.8 — [CRITICAL] `selected_equipment.batteryCount` is rewritten from the sidebar's config on every save and served as the project's battery count — the graph's instances never reach it

`lib/system/selectedEquipment.ts:273`

- **Upstream produced:** `storage[]` instances with roles — the model's `storage.invertingUnitCount` / `expansionUnitCount`, provenance 'Counted from the physical instances in the connection graph' (lib/electrical/projectModel.ts:564-577)
- **Downstream used instead:** `patch.batteryCount = effBatteryCount` where `effBatteryCount = typeof cfg.batteryCount === 'number' ? cfg.batteryCount : 0` (lib/system/selectedEquipment.ts:264) — written on every /api/engineering/save-config; and `POST /api/projects/[id]/equipment` writes `patch.batteryCount = batteryCount` from the request body (app/api/projects/[id]/equipment/route.ts:62). The project GET then serves `batteryCount: typeof selEq.batteryCount === 'number' ? selEq.batteryCount : undefined` (lib/db/core.ts:318 → lib/db/production.ts:282).
- **Consequence:** The PUT at app/api/projects/[id]/service-topology/route.ts:113 never rebuilds this mirror, so `STORAGE_COUNT_MIRROR_STALE` (lib/electrical/projectModel.ts:583) fires on every read and is explicitly non-blocking (projectModel.ts:629-632). Every surface reading `project.batteryCount` — the cover sheet, the site plan, pricing/proposal — gets the sidebar's number. And `effBatteryCount === 0 && curCount > 0` at selectedEquipment.ts:279 CLEARS `selected_equipment.batteries` for a storage design authored only in the graph.

##### 13.2.9 — [CRITICAL] The permit route logs that the graph owns `mainPanelAmps` / `panelBusRating` and then projects neither

`app/api/engineering/permit/route.ts:1415`

- **Upstream produced:** `model.serviceRatedAmps` (= `service.ratedAmps`) and `panels[].busbarRatingA` / `panels[].mainBreakerA`, both already loaded into `_m` at permit/route.ts:795
- **Downstream used instead:** `for (const observed of ['mainPanelAmps','panelBusRating','interconnectionMethod']) { if (pp[observed] != null && pp[observed] !== ep[observed]) console.warn(...) }` — a log line only. Grep of app/api/engineering/permit/route.ts for `mainPanelAmps` returns only comments (1300,1301,1402) and this loop; `_m.serviceRatedAmps` is used only inside a console.log at :856. The package keeps `ep[observed]` — the POST body.
- **Consequence:** The sealed package's service rating is whatever the page posted. `lib/permit/sections/sitePlan.ts:74` prints `(E) MAIN SERVICE PANEL ${project.mainPanelAmps || 200}A`, `lib/permit/sections/coverSheet.ts:83` takes `svcAmps = project.mainPanelAmps`, `lib/permit/utils/sldAdapter.ts:153,344,348` passes `mainAmps = project.mainPanelAmps ?? 200` and `panelBusRating: project.panelBusRating ?? mainAmps`. The comment at permit/route.ts:1402-1404 asserts 'owned by the service graph, which the SLD, BOM and PDF already project from' — true only for `mainPanelAmps`, and this route is not one of them.

##### 13.2.10 — [CRITICAL] Topology-authored panelboards and disconnects buy nothing, and their `device.selection` / `aggregation.selection` NOT_EVALUATED never reaches the BOM

`lib/bom/topologyBom.ts:109`

- **Upstream produced:** `panels[]` (2 × 200 A MSP) and `devices[]` (2 × in-line utility isolation switch at 200 A each, plus the four disconnect roles) — the wizard creates all of them with NO `productId` (lib/electrical/topologyPresets.ts:130, :325-333; ServiceTopologyWizard.tsx:760-767). The engineering says so explicitly: `device.selection` 'The requirement is established … and no catalogue part has been selected' (lib/electrical/serviceTopology.ts:1717) and `aggregation.selection` (serviceTopology.ts:2027).
- **Downstream used instead:** `if (!i.productId) continue;  // described, not selected — not orderable, not a line` — so no line, no quantity, and `reconcileQuantities` compares nothing. The legacy path separately buys one AC disconnect from the interconnection method (lib/bom-engine-v4.ts:1908).
- **Consequence:** A 400 A job with two independently isolated 200 A paths quotes ONE disconnect and ZERO panelboards, and the BOM response carries no 'selection required' signal — the only surface that says a part is missing is the permit schedule's ENGINEERING INPUT REQUIRED text line. Ray's output-consistency law ('there must not be drawing = 2, BOM = 1') holds only for products that already have a catalogue id.

##### 13.2.11 — [MAJOR] `buildServiceTopologyGraph` — the documented replacement for the service half of the drawing — has zero production callers

`lib/sld/serviceTopologyGraph.ts:91`

- **Upstream produced:** A full `ServiceSldGraph` (nodes, edges, per-domain groupings, run segments, `validationErrors`, notes) derived from the graph and its evaluation, with the bonding taken from `deriveBonding` 'so the drawing and the engineering cannot differ about it' (serviceTopologyGraph.ts:188)
- **Downstream used instead:** Nothing. The renderer instead uses its own `renderTopologyServiceSection` (lib/sld-professional-renderer.ts:3064, called at :5340) and `overlayServiceTopologyRows` (:2919). docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md names `lib/sld/serviceTopologyGraph.ts` as 'the replacement for the service part of the drawing' in two separate rows.
- **Consequence:** Two independent renderings of the same graph exist; the one with `validationErrors` and the shared bonding derivation is dead, and the live one is a 2000-line section inside the professional renderer. Any fix applied to the dead module reaches no sheet — the same 'helper-level fiction' shape Ray called out for `bomFromServiceTopology` before it was wired.

##### 13.2.12 — [MAJOR] The route computes the evaluation server-side specifically to prevent drift, and both clients discard it and recompute

`components/engineering/ServiceTopologyBuilder.tsx:128`

- **Upstream produced:** `evaluation: { overall, checks, bonding, storageSummary }` and `equipmentQuantities`, computed from the STORED graph at app/api/projects/[id]/service-topology/route.ts:44-59 with the stated reason 'Computed here, from the stored graph, so the screen and the store cannot drift' (route.ts:51)
- **Downstream used instead:** `if (data?.success && data.available) setTopology(data.topology as ServiceTopology); else setTopology(null);` — and app/engineering/page.tsx:1215-1217 does the same. The screen then recomputes: `buildServiceOverview(topology)` (ServiceTopologyBuilder.tsx:171), `evaluateServiceTopology(topology)` and `equipmentQuantities(topology)` (ServiceTopologyPanel.tsx:74,76).
- **Consequence:** The anti-drift mechanism is inert: the browser evaluates its own in-memory copy, including unsaved edits, so the screen can show conclusions for a graph the store does not hold. The GET also never returns `refreshes`, so the 'manufacturer facts corrected on read' provenance proof reaches only the dev inspector (lib/electrical/authorityInspector.ts:338).

##### 13.2.13 — [MAJOR] The browser's copy of the canonical model is built from a narrower input set, so the sidebar can never raise the storage-count conflict

`app/engineering/page.tsx:3085`

- **Upstream produced:** `resolveElectricalProject` raises `STORAGE_COUNT_MIRROR_STALE` when `selectedEquipment.batteryCount` disagrees with the graph's instances, and classifies the external inverter from `equipmentProvenance` + `legacyInverter` (lib/electrical/projectModel.ts:580-593; assembled server-side at lib/electrical/loadElectricalProject.ts:229-246)
- **Downstream used instead:** `resolveElectricalProject({ topology: svcTopology, selectedEquipment: { inverterId: config.inverters[0]?.inverterId ?? null, inverterType: config.inverters[0]?.type ?? null, moduleCount: totalPanels } })` — no `batteryCount`, no `equipmentProvenance`, no `legacyInverter`, no `engineeringConfig`
- **Consequence:** Two instances of the same resolver answer differently for the same project: the server reports a stale battery mirror and an inverter origin, the sidebar reports neither. The page compensates by fetching the origin separately from /api/engineering/electrical-architecture (page.tsx:9414), but the count conflict is simply invisible in the UI — the operator is never told the number the proposal will price is not the number the graph holds.

##### 13.2.14 — [MAJOR] `interconnection.utilityId` and `interconnection.multiGatewayMeteringDoc` have no production writer; the Tesla adapter that was built to set the latter is unreachable

`lib/electrical/topologyAuthoring.ts:54`

- **Upstream produced:** `createServiceTopology` accepts `utilityId` (topologyAuthoring.ts:34) and the type documents `multiGatewayMeteringDoc` as 'set by the adapter, not by this file' (lib/electrical/serviceTopology.ts:855). `lib/electrical/adapters/tesla.ts:62` `teslaMultiGatewayDocState()` reads the real catalogue row at lib/manufacturer-assets-db.ts:123 and names the Tesla 'Multiple Backup Gateways on a Single Site' application note and exactly what it governs.
- **Downstream used instead:** `utilityId: opts.utilityId ?? null` — and `buildServiceFromPreset` passes only `{ratedAmps, voltage, phase}` (lib/electrical/topologyPresets.ts:117-119), so it is always null. `teslaMultiGatewayDocState` and `buildTeslaDomain` are called only by lib/electrical/fixtures/tesla400aTwoGateway.ts:376 and tests/serviceTopologyIsAGraph.test.ts:427.
- **Consequence:** Every real two-gateway project reports the GENERIC branch of `metering.multi-gateway` — 'This site has 2 gateways and no manufacturer document has been registered' (serviceTopology.ts:2107) — instead of naming the document, its source and what it governs, which is what Ray asked the state to carry. And the graph's own utility slot stays empty while the utility lives in `engineering_config.utilityId` (app/engineering/page.tsx:647), so `externalDerIsolationRequired`/`meterCollarPermitted` can only ever be typed by hand (ServiceTopologyWizard.tsx:548-559, 662-665) rather than resolved from the AHJ/utility layer.

##### 13.2.15 — [MAJOR] The topology's load model is never read by the permit, which prints 'Not provided' unconditionally

`lib/permit/sections/electricalPages.ts:1549`

- **Upstream produced:** `topology.loads` (method ∈ {standard-220-part-iii, optional-220-82, existing-dwelling-220-87, engineer-supplied}, per-panel `calculatedDemandA`, basis) and `resolveDemands(topology).serviceA` / `.branchA` / `.domainBackedUpA`, with `load.calculation` PASS and `service.demand` PASS/FAIL against the rating (lib/electrical/serviceTopology.ts:1040, :1352-1399)
- **Downstream used instead:** `<td>Dwelling Load Calculation</td><td>Not provided — no verified dwelling load inputs on file. ...</td><td class="tr fw9">N/A</td>` — a hardcoded row. `resolveDemands` has no caller outside the four Service Topology UI components and `evaluateServiceTopology`.
- **Consequence:** An engineer-supplied load calculation entered through the node inspector produces PASS conclusions on the Service Topology screen and prints 'Not provided / N/A' on the permit's PV-4A step table. The permit's Step 2 'Service Rating' row beside it uses `${mainA}A main / ${busA}A busbar` from the posted scalars (electricalPages.ts:1550), so the one sheet states both a missing calculation and a service rating the graph was never asked about.

##### 13.2.16 — [MAJOR] The wizard's 'Create this service' persists nothing; the graph exists only in React until a separate Save is pressed

`components/engineering/ServiceTopologyBuilder.tsx:191`

- **Upstream produced:** A complete `ServiceTopology` handed to `onBuilt(draft)` by the wizard's finish button, labelled 'Create this service' (components/engineering/ServiceTopologyWizard.tsx:802-805)
- **Downstream used instead:** `onBuilt={t => { setTopology(t); setSelectedId('service'); setMode('edit'); setBeforeEdit(null); }}` — local state only; the PUT happens solely in `save()` at ServiceTopologyBuilder.tsx:141-158, behind the separate 'Save changes' button at :378. The guided-edit mount does the same (`onBuilt={t => { setTopology(t); setGuided(false); }}`, :404).
- **Consequence:** A designer who completes all six wizard steps and navigates away has no service topology on the project — and every downstream surface then takes the legacy single-service path (app/api/engineering/permit/route.ts:863 'no service graph on this project — the legacy single-service path draws it, as before'), silently. The button's label asserts a creation the click does not perform.

##### 13.2.17 — [MINOR] `/api/engineering/topology` is a different 'topology' entirely and defaults the inverter to a named product

`app/api/engineering/topology/route.ts:35`

- **Upstream produced:** Nothing from this stage — but the name collides with it, and the project's architecture authority is `service_topology.solarCoupling` resolved through `loadElectricalProject`
- **Downstream used instead:** `inverterId: body.inverterId ?? body.newInverterId ?? 'fronius-primo-8.2'`, `moduleCount: Number(...) || 20`, `stringCount: ... || 2` → `resolveTopology(ctx)`; the route never reads `projects.service_topology` and never calls `loadElectricalProject`
- **Consequence:** A caller that reaches this route for 'the topology' gets an equipment-family answer derived from a fabricated Fronius inverter, 20 modules and 2 strings when the body is thin — with no relation to, and no check against, the project's recorded service graph or coupling. The naming makes it easy to mistake for the service-topology authority.

---

### 13.3 ELECTRICAL SIZING / CALCULATION

*21 breaks — 7 verified by a refuter.*

#### What this stage is

The "Electrical Sizing / Calculation" stage is not one engine — it is four independent string/sizing engines plus one AC/compliance engine, and the one HTTP route named `/api/engineering/calculate` runs only two of them. `app/api/engineering/calculate/route.ts` is driven almost entirely by the POST body assembled in `app/engineering/page.tsx:6329` (`buildCalcPayload`): it reads the canonical model at route.ts:87-106 but consumes exactly one field from it (`solarCoupling`, and only to build `_dcLimits`), then runs `generateStringConfig` (lib/string-generator.ts:278) for the DC strings and `runElectricalCalc` (lib/electrical-calc.ts:518) for the AC side. `computeSystem` (lib/computed-system.ts:1052) is NEVER called by this route; it runs in three other places — the page memo (page.tsx:3374-3628 via computeMultiSystem), the SLD route (sld/route.ts:1117) and the permit run builder (lib/permit/utils/computedRuns.ts:341) — each with a different string-layout input. `lib/system/sizingEngine.ts:1472` (`distributeStrings`) is a third partition that overrides the SLD's labels, and `lib/engineering/reportGenerator.ts:268-295` is a fourth that feeds the stored report's equipment schedule. For 37 modules at a 9-module ceiling the four engines produce [7,7,7,7,9], [9,9,9,9,1], [8,8,7,7,7] and a uniform 5x9 (=45 modules), all from the same inputs, and no stage reconciles them.

#### Data in

| Field | Where it comes from |
|---|---|
| `electrical.inverters[] (type, acOutputKw, maxDcVoltage, mpptVoltageMin/Max, mpptChannels, maxInputCurrentPerMppt, maxParallelStringsPerMppt, nominalDcVoltage, maxPanelsPerString, integratedDcDisconnect)` | HTTP body only — app/engineering/page.tsx:6386-6416 (buildCalcPayload), read at app/api/engineering/calculate/route.ts:141,187-232. Equipment-db lookup is CLIENT-side (getInvById). |
| `electrical.inverters[].strings[].panelCount / panelVoc / panelVmp / panelIsc / panelImp / panelWatts / tempCoeffVoc / tempCoeffIsc / maxSeriesFuseRating` | HTTP body — page.tsx:6417-6437 from config.inverters[].strings[] (localStorage eng-config-<projectId> / projects.engineering_config). Read at route.ts:155,175-184,237-241,266-268. |
| `electrical.pvArray { moduleCount, panelVoc, panelVmp, panelIsc, panelImp, panelWatts, tempCoeffVoc, tempCoeffVmp, maxSeriesFuseRating }` | HTTP body — page.tsx:6470-6484, built from canonicalPanelId (projects.selected_equipment) + totalPanels. Read at route.ts:166-171; used ONLY when `_dcLimits` is non-null (route.ts:171,244). |
| `electrical.mainPanelAmps, electrical.interconnection {method, busRating, mainBreaker}` | HTTP body — page.tsx:6500 and page.tsx:6512-6516 (`config.interconnectionMethod ?? 'LOAD_SIDE'`, `config.panelBusRating ?? 200`). Spread into ElectricalCalcInput unmodified at route.ts:368; the route never mentions mainPanelAmps or interconnection anywhere. |
| `electrical.batteryBackfeedA / batteryCount / batteryContinuousOutputA / batteryModel / batteryManufacturer` | HTTP body — page.tsx:6518-6524 (equipment-db lookups done client-side). Read at route.ts:377-381 with `?? 0`. |
| `electrical.generatorKw / generatorOutputBreakerA / atsAmpRating / backupInterfaceMaxA / hasEnphaseIQSC3` | HTTP body — page.tsx:6526-6557. Read at route.ts:383-393. |
| `body.topologyType` | HTTP body — page.tsx:6452-6455,6491 (derived from config.inverters[0].type). Read at route.ts:49-66 to force inv.type='optimizer'. |
| `body.recommendedLayout.stringPanelCounts` | HTTP body — page.tsx:6444-6449, from `sizingRecommendation` (lib/system/sizingEngine.ts:2372), which page.tsx:3911-3912 documents as DISPLAY-ONLY. Read at route.ts:310,323. |
| `body.projectId` | HTTP body — page.tsx:6496 (`currentProjectId`). Read at route.ts:87-91. |
| `projects.service_topology (the connection graph)` | lib/electrical/loadElectricalProject.ts:154,197 -> parseServiceTopology. Reaches route.ts:94 as `_loaded.model.topology` and is passed ONLY to `dcStringLimits`. |
| `model.solarCoupling` | lib/electrical/projectModel.ts:148, loaded at route.ts:93 into `_canonicalCoupling`. ASSIGNED AND NEVER READ AGAIN in route.ts. |
| `model.serviceRatedAmps (projects.service_topology -> service.ratedAmps)` | lib/electrical/projectModel.ts:617,664. Available on `_loaded.model` at route.ts:92 — never read by this route. |
| `model.moduleCount (layouts.total_panels)` | lib/electrical/loadElectricalProject.ts:157-158,212 -> projectModel.ts:190. Available at route.ts:92 — never read by this route. |
| `model.storage / model.conflicts / model.hasExternalInverter / model.externalInverterId` | lib/electrical/projectModel.ts:152-154,181,192. Available at route.ts:92 — never read by this route. |
| `designTempMin / designTempMax (thermal basis)` | ROUTE-OWNED: lib/permit/utils/designTemps.ts getThermalDesignBasis, called at route.ts:122-129 from body.lat/lng/state/address + body.designTempMinOverrideC. Overwrites any posted value at route.ts:372-373. This one input is correctly centralized. |
| `necVersion, groundSnowLoad, windSpeed, jurisdiction` | lib/jurisdiction.ts getJurisdictionInfo/getGroundSnowLoad/getDesignWindSpeed at route.ts:113,130-131, keyed on `state \|\| parseStateFromAddress(address)` (route.ts:110). |
| `ComputedSystemInput.totalStrings + configStringPanelCounts (computeSystem's string layout, page path)` | app/engineering/page.tsx:3567-3575 — `fleet.reduce(inv.strings.length)` and `fleet.flatMap(inv.strings.map(s => s.panelCount))`. |
| `ComputedSystemInput.totalPanels (page path)` | app/engineering/page.tsx:3381 (`csPanels`) = `systemPanelCount > 0 ? systemPanelCount : totalPanels` (page.tsx:3642) — the CAD/layout count, a DIFFERENT source from configStringPanelCounts above. |
| `ComputedSystemInput.totalStrings (SLD path)` | app/api/engineering/sld/route.ts:1031 = `resolvedTotalStrings` (sld/route.ts:880-882) = `layoutStrings.length` from sizeSystemFromBrand, else stringResult.totalStrings. `body.totalStrings` sent by page.tsx:7237 is read only for the hybrid branch at sld/route.ts:439. |
| `ComputedSystemInput (permit path)` | lib/permit/utils/computedRuns.ts:242-243 — sets `topology` and `totalPanels` and NOTHING about strings; no totalStrings, no configStringPanelCounts. |
| `BOM input.stringCount` | app/api/engineering/bom/route.ts:400 = `Number(body.stringCount) \|\| 2`; body.stringCount from app/engineering/page.tsx:7726 = `sizingRecommendation?.strings?.length ?? config.inverters.reduce(inv.strings.length)`. |

#### What it calculates

- NEC 690.7(A) cold-Voc correction: `tempCorrectionFactor = 1 + (tempCoeffVoc/100)*(designTempMin-25)`; `vocCorrected = voc * factor` — lib/string-generator.ts:293-295 and INDEPENDENTLY at lib/computed-system.ts:1164-1166 and lib/system/sizingEngine.ts:1588-1589 and lib/engineering/reportGenerator.ts:258-259.
- String-length bounds: `maxPanelsPerString = floor(inverterMaxDcVoltage / vocCorrected)` (lib/string-generator.ts:250 via stringSizingBounds; lib/computed-system.ts:1169) vs `floor(maxDcVoltage * 0.99 / vocColdPerPanel)` (lib/system/sizingEngine.ts:1594). `minPanelsPerString = ceil(mpptVoltageMin / vmpHot)` with HOT_CELL_TEMP_C=75 (lib/string-generator.ts:244,254) — computeSystem has no minimum at all.
- String partition (four different algorithms): current-aware descending search + naive fill + remainder rebalance + slot packing (lib/string-generator.ts:402-540); equal division `floor(total/stringCount)` with the remainder on the LAST string (lib/computed-system.ts:1270-1271); round-robin MPPT-slot fair-share `ceil(panelsLeft/slotsRemaining)` capped at maxPPS (lib/system/sizingEngine.ts:1758-1782); uniform `ceil(panelCount/panelsPerString)` (lib/engineering/reportGenerator.ts:288).
- MPPT allocation + feasibility: distributeStringsAcrossMpptsSafely with operating current `stringPowerW / nominalDcVoltage` capped at the optimizer rating (lib/string-generator.ts:612-638); violations MPPT_CURRENT_EXCEEDED / MPPT_ALLOCATION_INVALID become errors, others warnings (lib/string-generator.ts:670-683).
- Topology-aware per-string design current: optimizer -> optimizer rated cap (NEC 690.8(A)(2), default 15.0 A); string/hybrid -> `iscCorrected * 1.25` (NEC 690.8(A)(1)) — lib/string-generator.ts:578-588 and lib/computed-system.ts:1282-1304. Note computeSystem applies an Isc temperature factor at ambientTempC (computed-system.ts:1299-1300) that string-generator deliberately omits (string-generator.ts:311).
- NEC 690.9(B) string OCPD `nextStandardOCPD(designCurrent * 1.25)` and NEC 690.8(B) `dcWireAmpacity = designCurrent * 1.25` — lib/string-generator.ts:804-807, lib/computed-system.ts:1306.
- AC side (runElectricalCalc): per-inverter AC current, acContinuousCurrentA, feeder OCPD, conductor gauge + ampacity derating, voltage drop, conduit fill, EGC, rapid-shutdown gate, and the NEC 705.12(B) 120% busbar evaluation — lib/electrical-calc.ts:518-1713, interconnection resolved at :952-1020.
- computeSystem additionally builds: RunSegment[] + runMap, segmentSchedule, physicalRaceways, conduitSchedule, equipmentSchedule, bomQuantities, gatewayInstances, backfeedBreakerAmps (sum of real NEC 240.6(A) breakers, computed-system.ts:1525-1529), interconnectionPass/Refusal/Unresolved, and the segment-model (`segments`) — lib/computed-system.ts:3101-3338.
- Overall status aggregation with explicit NOT-EVALUATED instead of a defaulted PASS — app/api/engineering/calculate/route.ts:454-465 via lib/engineering/engineeringStatus.ts.

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `stringConfig { totalStrings, panelsPerString, lastStringPanels, maxPanelsPerString, minPanelsPerString, recommendedPanelsPerString, designTempMin, tempCorrectionFactor, vocCorrected, vmpCorrected, stringVoc, stringVmp, stringIsc, totalDcPower, totalDcVoltageMax, totalDcCurrentMax, ocpdPerString, dcWireAmpacity, combinerType, combinerLabel, mpptChannels[], dcAcRatio, warnings, errors, isValid }` | app/engineering/page.tsx:7209 (`compliance.stringConfig`) for the SLD payload fallbacks at page.tsx:7237,7254; and page.tsx:6672-6674 for the persisted engineering_run. NOTE the per-string array is NOT emitted — only strings[0] and strings[last] projections (route.ts:488-499). |
| `stringConfig.strings[] (full GeneratedString[] with per-string panelsInString / stringVoc / mpptChannel)` | NOBODY — it exists inside lib/string-generator.ts:686-745 and is collapsed to two scalars at app/api/engineering/calculate/route.ts:488-489 before the response is built. |
| `stringConfigError` | NOBODY — emitted at app/api/engineering/calculate/route.ts:524; no read in app/, lib/ or components/. |
| `electrical (ElectricalCalcResult: status, errors[], warnings[], inverters[], busbar, conduitFill, acSizing, interconnection, subSystems[], summary, engineeringModel)` | app/engineering/page.tsx only (`compliance.electrical`) — status badge, ValidationPanel, and as FALLBACKS at page.tsx:7217,7220 and page.tsx:6677,6680,6682. No server route consumes it; the SLD, BOM, permit and planset routes never call /api/engineering/calculate. |
| `electrical.engineeringModel ("Canonical engineeringModel — single source of truth for all downstream modules", lib/electrical-calc.ts:476)` | lib/computed-plan.ts:329,988,1063 only — and `computePlan()` (lib/computed-plan.ts:895) has ZERO callers in app/, lib/, components/ or tests/. |
| `overallStatus / statusNotEvaluated / statusBasis` | app/engineering/page.tsx status badge + components/engineering/ValidationPanel.tsx:67. |
| `autoDetected { stateCode, necVersion, designTempMin, designTempMax, groundSnowLoad, windSpeed, utilityId, ahjId }` | app/engineering/page.tsx:3415-3416,3442-3443 (`compliance.autoDetected` feeds ComputedSystemInput.designTempMin/ambientTempC) and page.tsx:6878-6885 (the /api/engineering/rules payload). This is the one output that is correctly re-consumed upstream. |
| `ComputedSystem.strings[] (StringCalc: panelCount, stringVoc, stringVmp, stringIsc, ocpdAmps, voltagePass)` | app/engineering/page.tsx:7254 (dcOCPD on the SLD payload), lib/plan-set/permit-system-model.ts:256 (`strings: finalStrings`), and the page's own tables. |
| `ComputedSystem.runs[] / runMap / segmentSchedule / physicalRaceways / conduitSchedule` | app/engineering/page.tsx:3846 legacyRunsView() -> sld body.runs (page.tsx:7407), bom body.runs (page.tsx:7825), save-outputs (page.tsx:6747); server-side lib/permit/utils/computedRuns.ts:341-359 returns cs.runs for the permit/BOM footage; lib/bom-engine-v4.ts:1569,1598,2617,3097 reads input.runs. |
| `ComputedSystem.bomQuantities (panels, inverters, acCombiner, trunkCable, trunkCableTerminators, acBranchOcpd, dcDisconnect, dcOcpd, acDisconnect, productionMeter, conduitEMT/PVC, wire10/8/6/4AWG, railSections, midClamps, endClamps, lFeet, lagBolts, flashings)` | NOBODY. page.tsx:7827 sends it, app/api/engineering/bom/route.ts:534 forwards it, lib/bom-engine-v4.ts:131 declares a 6-key subset — and no line of lib/bom-engine-v4.ts ever reads `bomQuantities`. |
| `ComputedSystem.equipmentSchedule (EquipmentScheduleRow[]: tag, description, manufacturer, model, qty, rating, necReference)` | app/engineering/page.tsx:15713 ONLY (the page's own table). The planset/permit BOM CSV reads a differently-shaped `report.equipmentSchedule` built by lib/engineering/reportGenerator.ts:129 (lib/engineering/artifactBuilders.ts:106-120). |
| `ComputedSystem.segments / segmentIssues / segmentInterconnectionPass` | NOBODY — attested in the repo itself: lib/segment-builder.ts:87-88 "leaves computeSystem and NO sheet, route, component or test reads it"; lib/nec/ampacity.ts:100-103 repeats it. |
| `ComputedSystem.interconnectionRefusal / interconnectionUnresolved / batteryRefusal` | lib/plan-set/permit-system-model.ts and the snapshot projection on the single-system path. DROPPED on the hybrid path — lib/computed-multi-system.ts:507-581 carries interconnectionPass, interconnectionUnresolved and batteryRefusal but never interconnectionRefusal. |
| `SystemSizingResult.strings[] (SizedString: panelCount, mpptIndex, inverterIndex, modelIndex) from lib/system/sizingEngine.ts:2372` | app/api/engineering/sld/route.ts:855-860 (overrides stringPanelCounts/panelsPerString/lastStringPanels) -> renderer input at sld/route.ts:1244-1245; app/engineering/page.tsx:4360-4364 (recommendedDisplayConfig) and page.tsx:7726 (the BOM's stringCount). |

#### Broken handoffs

##### 13.3.1 — [CRITICAL] Four engines partition the same array four different ways; nothing reconciles them

`lib/computed-system.ts:1270`

- **Upstream produced:** lib/string-generator.ts:476-554 builds an explicit `stringPanelCounts` array (current-aware search + slot packing + remainder rebalance) and lib/system/sizingEngine.ts:1758-1782 builds `SizedString[]` by MPPT-slot fair-share
- **Downstream used instead:** `panelsPerString = Math.floor(input.totalPanels / stringCount); lastStringPanels = input.totalPanels - panelsPerString * (stringCount - 1);` (lib/computed-system.ts:1270-1271) — equal division with the whole remainder on the last string
- **Consequence:** 37 modules with a 9-module ceiling: computeSystem -> [7,7,7,7,9]; string-generator -> [9,9,9,9,1]; sizingEngine -> [8,8,7,7,7]; reportGenerator -> uniform 5x9 = 45 modules. Max string Voc is 489 V on three of them and 434 V on the fourth, so the NEC 690.7 verdict, the printed panels-per-string and the DC conductor count differ by engine for one array. Verified numerically.

##### 13.3.2 — [CRITICAL] The calculate route loads the canonical electrical project and consumes one field of it

`app/api/engineering/calculate/route.ts:93`

- **Upstream produced:** `loadElectricalProject(body.projectId, user.id)` returns model.solarCoupling, model.serviceRatedAmps, model.moduleCount, model.storage, model.conflicts, model.hasExternalInverter, model.externalInverterId + a revision (lib/electrical/projectModel.ts:144-202)
- **Downstream used instead:** `_canonicalCoupling = _loaded.model.solarCoupling;` (route.ts:93) is assigned and never read again; only `_dcLimits = dcStringLimits(_loaded.model.topology, _loaded.model.solarCoupling)` (route.ts:94) is used. Everything else sizes from `body.electrical`
- **Consequence:** The Electrical Sizing tab sizes against the page's React state while the drawing, BOM and permit size against the graph. The graph's service rating, the layout's module count, the graph's battery instances and the model's recorded conflicts are all invisible to the engine that produces the compliance verdict — this is the mechanism by which System Config equipment survives Topology.

##### 13.3.3 — [CRITICAL] The 120% busbar rule is evaluated on the POST body in calculate and on the graph everywhere else (the 200 A vs 400 A split)

`lib/electrical-calc.ts:954`

- **Upstream produced:** `model.serviceRatedAmps` from projects.service_topology -> service.ratedAmps (lib/electrical/projectModel.ts:617,664)
- **Downstream used instead:** `const icBusRating = input.interconnection?.busRating ?? input.mainPanelAmps;` (lib/electrical-calc.ts:954), fed from `busRating: config.panelBusRating ?? 200` and `mainPanelAmps: config.mainPanelAmps` (app/engineering/page.tsx:6514,6500). The calculate route contains ZERO references to mainPanelAmps or interconnection — they pass through `...electrical` untouched at route.ts:368
- **Consequence:** app/api/engineering/sld/route.ts:218, app/api/engineering/sld/pdf/route.ts:206 and app/api/engineering/bom/route.ts:244 all execute `body.mainPanelAmps = _model.serviceRatedAmps`. The calculate route does not. On a 400 A service whose page config still reads 200 A (or the reverse), the compliance tab's 120% PASS/FAIL is computed on a different busbar than the SLD, BOM and permit — one project, two verdicts, and the tab is the one an engineer trusts before generating.

##### 13.3.4 — [CRITICAL] The NEC article for the interconnection is chosen by `??` on the compliance path, while every other surface projects it from the graph

`app/engineering/page.tsx:6513`

- **Upstream produced:** `interconnectionMethodScalar(topology)` (lib/electrical/loadElectricalProject.ts:270-301), which maps pointsOfInterconnection[].relationship and returns NULL for 'unresolved', 'manufacturer-integrated' and 'meter-collar' precisely so no article is invented
- **Downstream used instead:** `method: config.interconnectionMethod ?? 'LOAD_SIDE'` (page.tsx:6513) then `input.interconnection?.method ?? 'LOAD_SIDE'` (lib/electrical-calc.ts:953) — two coalescing defaults in series
- **Consequence:** interconnectionMethodScalar is called by sld/route.ts:226, sld/pdf/route.ts:209, bom/route.ts:257 and permit/route.ts:810 — never by calculate. A project whose POI is 'unresolved' or 'supply-side' is given NEC 705.12(B), the 120% busbar allowance and a backfed breaker on the compliance tab, which is exactly what loadElectricalProject.ts:260-266 says must never happen.

##### 13.3.5 — [CRITICAL] The SLD hands computeSystem a string COUNT but not the string LAYOUT it is about to draw

`app/api/engineering/sld/route.ts:1031`

- **Upstream produced:** `stringPanelCounts` — the real per-string layout, taken from sizeSystemFromBrand at sld/route.ts:855-860 and sent to the renderer at sld/route.ts:1244-1245
- **Downstream used instead:** `totalStrings: !isMicro ? resolvedTotalStrings : undefined` (sld/route.ts:1031) — `configStringPanelCounts` is never set on csInput, so lib/computed-system.ts:1270-1271 re-derives the partition by equal division
- **Consequence:** The sheet labels the strings with the sizing engine's layout while cs.strings[].stringVoc (the NEC 690.7 check, computed-system.ts:1295,1321-1331) is computed on equally-divided strings. A real [12,12,6] becomes [10,10,10] in the check: the 690.7 gate is applied to a 10-panel string that is installed with 12. The page already passes configStringPanelCounts (page.tsx:3573-3575); the route that produces the drawing does not.

##### 13.3.6 — [CRITICAL] The permit run builder gives computeSystem no string information at all

`lib/permit/utils/computedRuns.ts:243`

- **Upstream produced:** The design's committed string layout (projects.engineering_config.inverters[].strings[] / layouts.panels[]) and the sizing engine's SizedString[]
- **Downstream used instead:** csInput carries only `topology` and `totalPanels` (computedRuns.ts:242-243) — no `totalStrings`, no `configStringPanelCounts` — so computeSystem falls to `stringCount = Math.ceil(input.totalPanels / maxPanelsPerString)` (computed-system.ts:1268)
- **Consequence:** The stamped package's DC string count, per-string Voc, string OCPD quantity and DC conductor counts are a fifth independent answer, derived from Voc physics alone with none of the MPPT-slot or current constraints the other engines apply. A design the sizing engine laid out as 4 strings can be run, scheduled and ordered as 5 by the permit.

##### 13.3.7 — [CRITICAL] ComputedSystem.bomQuantities is produced, merged, posted, forwarded and declared — and read by nothing

`lib/bom-engine-v4.ts:131`

- **Upstream produced:** `bomQuantities` with 20 engineered quantities (lib/computed-system.ts:3101-3137), merged across subsystems at lib/computed-multi-system.ts:475-481, posted at app/engineering/page.tsx:7827, forwarded at app/api/engineering/bom/route.ts:534
- **Downstream used instead:** `bomQuantities?: { wire10AWG?, wire8AWG?, wire6AWG?, wire4AWG?, conduitEMT?, conduitPVC? }` (lib/bom-engine-v4.ts:131-138) — declared with the comment "When provided, these are used DIRECTLY for wire line items (guarantees exact match with summary cards)", and there is no read of `bomQuantities` anywhere in lib/bom-engine-v4.ts
- **Consequence:** Every engineered BOM quantity — dcOcpd (= stringCount), dcDisconnect, acCombiner, trunkCable, acBranchOcpd, the DC-coupled zero-suppressions at computed-system.ts:3115-3121, and the wire/conduit footage the comment promises — is discarded. The BOM re-derives all of it from body scalars and `input.runs`. The summary cards and the purchase list cannot match, by construction.

##### 13.3.8 — [CRITICAL] The BOM's string count comes from a recommendation the user may never have applied, behind a `|| 2` default

`app/engineering/page.tsx:7726`

- **Upstream produced:** `cs.stringCount` (the engineered count the drawing used, computed-system.ts:3229) and `stringConfig.totalStrings` (the compliance engine's count, route.ts:487)
- **Downstream used instead:** `stringCount: firstInv?.type === 'micro' ? 0 : (sizingRecommendation?.strings?.length ?? config.inverters.reduce((s, inv) => s + inv.strings.length, 0))` (page.tsx:7726), landing on `stringCount: Number(body.stringCount) || 2` (app/api/engineering/bom/route.ts:400)
- **Consequence:** page.tsx:3911-3912 documents sizingRecommendation as "DISPLAY-ONLY ... does NOT mutate config", yet it is preferred over the applied config. That number becomes purchased quantity: `input.stringCount * 2` is the NEC 690.31 connector/RSD line at lib/bom-engine-v4.ts:2304 and :3540, and `effectiveRows` at :944. An un-applied recommendation, or a `|| 2` on an absent field, orders hardware.

##### 13.3.9 — [CRITICAL] A field-name mismatch makes the persisted engineering_run mix two engines' string answers

`app/engineering/page.tsx:6671`

- **Upstream produced:** The route emits `totalStrings: stringConfig.totalStrings` (app/api/engineering/calculate/route.ts:487). There is no `stringCount` key anywhere in the emitted stringConfig object (route.ts:486-523)
- **Downstream used instead:** `stringCount: calcData?.stringConfig?.stringCount ?? computedSystem.strings?.length ?? 1` (page.tsx:6671) — permanently undefined, so it always falls through to computeSystem — while the line below it, `panelsPerString: calcData?.stringConfig?.panelsPerString` (page.tsx:6672), DOES resolve and comes from string-generator's strings[0]
- **Consequence:** The saved record (engineering_runs via /api/engineering/save-outputs) pairs computeSystem's string COUNT with string-generator's panels-per-STRING. For the verified 37-module case that is stringCount 5 x panelsPerString 9 = 45 modules recorded for a 37-module job, and stringVoc (page.tsx:6673) is string-generator's first string while the count beside it is not.

##### 13.3.10 — [CRITICAL] computeSystem's totalAcKw ignores inverterCount while its AC current does not

`lib/computed-system.ts:1156`

- **Upstream produced:** `input.inverterCount` — "physical inverter units" (computed-system.ts:530), set to `Math.max(1, fleet.length)` at app/engineering/page.tsx:3401 and used correctly for current at computed-system.ts:1487
- **Downstream used instead:** `const totalAcKw = isMicro ? (input.totalPanels / input.inverterModulesPerDevice) * input.inverterAcKw : input.inverterAcKw;` (computed-system.ts:1156-1158) — the per-unit rating, unmultiplied, for string/optimizer
- **Consequence:** For 2 x 7.6 kW with 37 x 400 W: the same object reports totalAcKw = 7.6 kW, acOutputCurrentA = 63.3 A (which IS 15.2 kW at 240 V) and dcAcRatio = 1.95, while /api/engineering/calculate computes 0.97 from the fleet sum (route.ts:513-519). cs.totalAcKw is what page.tsx:7211 sends as the SLD's acOutputKw. Verified numerically.

##### 13.3.11 — [CRITICAL] The hybrid aggregate drops interconnectionRefusal, turning "not evaluated" into FAIL

`lib/computed-multi-system.ts:539`

- **Upstream produced:** `interconnectionRefusal: _interconnectionRefusal` (lib/computed-system.ts:3252) — documented at computed-system.ts:364-370: "Non-null => interconnectionPass is false because the rule could not be applied, NOT because the design failed it. A consumer that prints a verdict must print this instead."
- **Downstream used instead:** The aggregate facade at lib/computed-multi-system.ts:507-581 carries `interconnectionPass`, `interconnectionUnresolved` (:579) and `batteryRefusal` (:580) — and never `interconnectionRefusal`
- **Consequence:** On any hybrid (roof + ground, roof + fence) a 120% rule that could not be evaluated arrives downstream as interconnectionPass=false with no reason attached, so the sheet and the sidebar print FAIL where the engine said NOT EVALUATED. The single-system path propagates it correctly; only the hybrid loses it.

##### 13.3.12 — [MAJOR] The sizing engine applies a 0.99 voltage derate the other two engines do not, so they disagree on maxPanelsPerString

`lib/system/sizingEngine.ts:1594`

- **Upstream produced:** `maxPanelsPerString = Math.floor(args.inverterMaxDcVoltage / vocCorrected)` — lib/string-generator.ts:250 (stringSizingBounds, explicitly extracted so "the page can call the SAME code") and lib/computed-system.ts:1169
- **Downstream used instead:** `const vocSafeCeiling = Math.floor((eq.maxDcVoltage * 0.99) / vocColdPerPanel);` (lib/system/sizingEngine.ts:1594)
- **Consequence:** At 600 V max DC with a 49.6 V / -0.27%/degC module at -10 degC (vocCorrected 54.29 V), string-generator and computeSystem both allow 11 panels per string and the sizing engine allows 10. The sizing engine's number is what writes the layout the SLD draws (sld/route.ts:855-860) and what the Apply button applies, so the engine that commits the design is more restrictive than the engine that validates it. Verified numerically.

##### 13.3.13 — [MAJOR] The hybrid aggregate reports a summed stringCount beside the first subsystem's panelsPerString

`lib/computed-multi-system.ts:519`

- **Upstream produced:** Each subsystem's own `stringCount`, `panelsPerString`, `lastStringPanels` and `maxPanelsPerString` from its own computeSystem pass (computed-multi-system.ts:296-302)
- **Downstream used instead:** `stringCount: stringSubs.reduce((s, x) => s + x.cs.stringCount, 0)` (:518) paired with `panelsPerString: firstString?.panelsPerString ?? primary.cs.panelsPerString` (:519) and `maxPanelsPerString: firstString?.maxPanelsPerString` (:521)
- **Consequence:** On a roof + ground hybrid the aggregate reports (roof strings + ground strings) x (roof panels per string). Any consumer that multiplies the two scalars — and the SLD and the saved run both carry them as a pair — gets a module count that belongs to no array on the site.

##### 13.3.14 — [MAJOR] The segment model is computed and consumed by nothing — the repo says so itself

`lib/computed-system.ts:3337`

- **Upstream produced:** `segments`, `segmentIssues`, `segmentInterconnectionPass` — described at computed-system.ts:412-413 as the "Canonical segment model — single source of truth for SLD, BOM, conductor schedule" and assigned at :3336-3338
- **Downstream used instead:** Nothing. lib/segment-builder.ts:87-88: "this file's sizing output (`segments`, `segmentIssues`, `segmentInterconnectionPass`) leaves computeSystem and NO sheet, route, component or test reads it"; repeated at lib/nec/ampacity.ts:100-103. computed-multi-system.ts:570-571 sets both to undefined at N>1
- **Consequence:** A whole conductor-sizing authority runs on every computeSystem call and is discarded. It is the third ampacity implementation in the codebase (segment-builder had a 26-50 degC ambient ladder returning 0.64 at 43 degC where the code table gives 0.87) and it is one wiring change away from being believed.

##### 13.3.15 — [MAJOR] electrical-calc's "canonical engineeringModel, single source of truth for all downstream modules" has no live consumer

`lib/electrical-calc.ts:476`

- **Upstream produced:** `engineeringModel: engineeringModelData` with validation (lib/electrical-calc.ts:1555-1582, returned at :1622)
- **Downstream used instead:** Only lib/computed-plan.ts:329,988,1063-1064 reads it, and `computePlan()` (lib/computed-plan.ts:895) has zero callers — `grep -rn "computePlan("` over app/, lib/, components/ and tests/ returns nothing outside the file itself. The only production import from computed-plan.ts is `getAhjsByState` (app/engineering/page.tsx:200)
- **Consequence:** The AC engine's declared canonical model is dead. Every downstream surface re-derives AC conductors, OCPD and the busbar from computeSystem or from body scalars instead, which is why the two engines can disagree about the same feeder.

##### 13.3.16 — [MAJOR] computeSystem's equipmentSchedule never reaches a professional output; the planset builds a second one

`lib/engineering/reportGenerator.ts:129`

- **Upstream produced:** `equipmentSchedule: EquipmentScheduleRow[]` with tag / manufacturer / model / qty / rating / necReference (lib/computed-system.ts:2923, returned :3258)
- **Downstream used instead:** `const equipmentSchedule = generateEquipmentSchedule(snapshot, electrical);` (lib/engineering/reportGenerator.ts:129) builds a differently-shaped `{panels[], inverters[], mounting[], electrical[], batteries[]}`, and that is what the planset BOM CSV reads at lib/engineering/artifactBuilders.ts:106-120
- **Consequence:** cs.equipmentSchedule is rendered only by app/engineering/page.tsx:15713. The schedule a plan reviewer reads is generated from a snapshot by a function with its own string sizing (reportGenerator.ts:268-295), so the equipment table on the sheet and the equipment table on the screen are two independent derivations.

##### 13.3.17 — [MAJOR] reportGenerator re-derives a uniform string layout that overstates the module count

`lib/engineering/reportGenerator.ts:288`

- **Upstream produced:** The committed per-string layout and the engineered partitions from string-generator / computeSystem / sizingEngine
- **Downstream used instead:** `panelsPerString = necMaxPerString; ... panelsPerString = Math.min(panelsPerString, targetPanels); ... stringCount = Math.ceil(snap.panelCount / panelsPerString);` (reportGenerator.ts:272-288) with every string reported at the same length (`stringVoc = panelVoc * panelsPerString`, :294)
- **Consequence:** 37 modules, 600 V max DC, mpptVoltageMax 600, 49.6 V module at -10 degC: panelsPerString=10, stringCount=4, implied modules 10 x 4 = 40 on a 37-module job. This is the same class of error app/api/engineering/sld/route.ts:796-798 records as having "printed 40 modules on a 37-module sheet", still live on the stored-report path. Verified numerically.

##### 13.3.18 — [CRITICAL] The compliance engine's module count is the posted fleet sum, never the layout

`app/api/engineering/calculate/route.ts:242`

- **Upstream produced:** `model.moduleCount` from layouts.total_panels (lib/electrical/loadElectricalProject.ts:157-158,212 -> projectModel.ts:190), described there as a value the sheet's array table moves with
- **Downstream used instead:** `const totalModules = _fleetModules > 0 ? _fleetModules : (_dcLimits && _pvArray ? _pvArray.moduleCount : 0);` (route.ts:242-244), where `_fleetModules` sums `body.electrical.inverters[].strings[].panelCount` (route.ts:237-241). layouts.total_panels is loaded on the same request and never consulted
- **Consequence:** When the CAD layout and the config string list disagree — the case page.tsx:3377-3380 explicitly expects ("the config-derived totalPanels is stale") — the compliance tab sizes the array at the config's count while computeSystem sizes it at the layout's (page.tsx:3381). The DC/AC ratio, totalDcPower and every NEC 690.7 total on the tab belong to a different array than the drawing's.

##### 13.3.19 — [CRITICAL] One ComputedSystem object can carry a module count and a string layout that disagree, and the only guard is dev-only

`app/engineering/page.tsx:3381`

- **Upstream produced:** `configStringPanelCounts: fleet.flatMap(inv => inv.strings.map(s => s.panelCount))` (page.tsx:3573-3575) — from config.inverters
- **Downstream used instead:** `totalPanels: csPanels` (page.tsx:3381), i.e. `systemPanelCount > 0 ? systemPanelCount : totalPanels` (page.tsx:3642) — from CAD/layout. lib/computed-system.ts:1155 computes `totalDcKw` from input.totalPanels while :1292-1294 builds the strings from authStringCounts, with no reconciliation
- **Consequence:** cs.totalDcKw, cs.bomQuantities.panels and all the racking quantities (computed-system.ts:3123-3137) come from the layout count while sum(cs.strings[].panelCount) comes from the config — one object, two array sizes. The guardrail that detects it (page.tsx:3863-3894) returns immediately unless NODE_ENV === 'development' (:3864), so in production the mismatch is silent.

##### 13.3.20 — [MINOR] bomQuantities.inverters is hardcoded to 1 for every string and optimizer design

`lib/computed-system.ts:3103`

- **Upstream produced:** `input.inverterCount` — physical inverter units (computed-system.ts:530), correctly echoed on the equipment schedule at computed-system.ts:3302 (`inverterCount: isMicro ? microDeviceCount : physicalInverterUnits`)
- **Downstream used instead:** `inverters: isMicro ? microDeviceCount : 1,` (lib/computed-system.ts:3103)
- **Consequence:** A 2- or 3-unit string/optimizer design reports one inverter in bomQuantities while the equipment schedule in the same object reports the real count. The quantity is currently harmless only because nothing reads bomQuantities at all (see the bom-engine-v4.ts:131 finding) — wiring that field up would ship a one-inverter BOM for a two-inverter job.

##### 13.3.21 — [MINOR] generateStringConfig accepts the NEC edition and never uses it; the route never sends it

`lib/string-generator.ts:284`

- **Upstream produced:** `jurisdiction.necVersion` — resolved from the AHJ at app/api/engineering/calculate/route.ts:113 and passed to runElectricalCalc at route.ts:375
- **Downstream used instead:** `necVersion = '2020'` is destructured at lib/string-generator.ts:284 and appears nowhere else in the file; the generateStringConfig call at route.ts:270-282 omits the field entirely
- **Consequence:** The DC string generator's code basis is a literal '2020' regardless of the adopted edition, so its NEC 690.7/690.8/690.9 derivations are edition-blind while the AC engine beside it is edition-aware (electrical-calc.ts:1227,1248,1262). No numeric effect today because the parameter is unread — it is an advertised input that cannot be reached.

---

### 13.4 COMPLIANCE

*24 breaks — 7 verified by a refuter.*

#### What this stage is

COMPLIANCE EVALUATION is not one stage — it is FOUR independent evaluations that never reconcile. (1) `POST /api/engineering/calculate` (app/api/engineering/calculate/route.ts) resolves a route-owned thermal basis + jurisdiction, runs `generateStringConfig` (NEC 690.7), `runElectricalCalc` (lib/electrical-calc.ts) and `runStructuralCalcV4`, then folds engine outcomes through `resolveOverallStatus` (lib/engineering/engineeringStatus.ts:181) into `overallStatus | null` + `statusNotEvaluated` + `statusBasis`. (2) In the SAME `Promise.all` 800 ms later-debounced call (app/engineering/page.tsx:6855-6890), `POST /api/engineering/rules` runs `runRulesEngine` (lib/rules-engine.ts:249), which re-runs `runElectricalCalc` a SECOND time on the client's posted temperatures and runs the deprecated/quarantined V1 `runStructuralCalc` (lib/structural-calc.ts) — and its `overallStatus` is what paints the Compliance tab's headline badge (page.tsx:14587). (3) The permit (lib/permit/generatePermit.ts:1152-1200) DISCARDS the page's `compliance.electrical` as provenance-only and recomputes everything with `computeSystem` (lib/computed-system.ts), then (4) VAL-1 (lib/permit/sections/validationPage.ts) runs a twelfth, unrelated set of presence checks and never reads any compliance verdict at all. Critically, the ONE evaluator in this codebase that correctly produces PASS/FAIL/NOT_EVALUATED per panel and per POI — `evaluateServiceTopology` (lib/electrical/serviceTopology.ts:1468-1573) — is excluded from every compliance verdict: `/api/projects/[id]/service-topology` ships `evaluation` and page.tsx:1214-1217 reads only `data.topology`. NOT_EVALUATED is produced correctly in four places and collapsed into PASS in at least six.

#### Data in

| Field | Where it comes from |
|---|---|
| `electrical.inverters[] (+.strings[]: panelId, panelCount, panelVoc/Vmp/Isc/Imp, panelWatts, tempCoeffVoc, maxSeriesFuseRating, wireGauge, wireLength) and inverter maxDcVoltage / mpptVoltageMin\|Max / mpptChannels / maxInputCurrentPerMppt / acOutputKw / type` | HTTP REQUEST BODY ONLY — built by buildCalcPayload from React state `config.inverters` + equipment-db lookups, app/engineering/page.tsx:6497-6498. Never read from projects.engineering_config or projects.selected_equipment by this route. |
| `electrical.pvArray {moduleCount, panelVoc, panelVmp, panelIsc, panelImp, panelWatts, tempCoeffVoc, maxSeriesFuseRating}` | request body; consumed only when _dcLimits is non-null — app/api/engineering/calculate/route.ts:166-171, 244 |
| `electrical.mainPanelAmps` | config.mainPanelAmps (React state) — app/engineering/page.tsx:6500 |
| `electrical.interconnection {method, busRating, mainBreaker}` | app/engineering/page.tsx:6512-6516 — `method: config.interconnectionMethod ?? 'LOAD_SIDE'`, `busRating: config.panelBusRating ?? 200`, `mainBreaker: config.mainPanelAmps ?? 200`. config default is the literal string 'UNRESOLVED' (page.tsx:646). |
| `electrical.rooftopTempAdder` | HARDCODED `config.systemType === 'roof' ? 30 : 0` — app/engineering/page.tsx:6504; passed through at app/api/engineering/calculate/route.ts:374 |
| `electrical.batteryBackfeedA / batteryCount / batteryContinuousOutputA / batteryModel / batteryManufacturer` | calcBatteryBackfeedAmps(config.batteryId, config.batteryCount) + getBatteryById — app/engineering/page.tsx:6518-6525 (React state + lib/equipment-db), NOT projects.service_topology storage instances |
| `electrical.generatorKw / generatorOutputBreakerA / atsAmpRating / backupInterfaceMaxA / hasEnphaseIQSC3` | config.generatorId/atsId lookups in equipment-db — app/engineering/page.tsx:6527-6545; passed to the engine at app/api/engineering/calculate/route.ts:383-393 |
| `body.topologyType` | `calcPayloadTopologyType` on the page — app/engineering/page.tsx:6490; read at app/api/engineering/calculate/route.ts:49-52 to force inverter type to 'optimizer' |
| `body.projectId` | app/engineering/page.tsx:6496 — the ONLY handle this route has on the database |
| `body.recommendedLayout.stringPanelCounts` | app/engineering/page.tsx:6491; read at app/api/engineering/calculate/route.ts:310, 323-325 |
| `body.designTempMinOverrideC / body.project.designTempMin` | request body only — app/api/engineering/calculate/route.ts:118-121. No production writer was found for either key. |
| `body.structural (whole block)` | buildCalcPayload (page React state + projectLayout); mapped by buildStructuralInputV4 at app/api/engineering/calculate/route.ts:406 |
| `body.address / state / utilityId / ahjId` | config.* — app/engineering/page.tsx:6486-6489; route.ts:43, 110-113 |
| `model.solarCoupling and dcStringLimits(topology, solarCoupling)` | projects.service_topology + projects.selected_equipment + projects.engineering_config + layouts.total_panels, via loadElectricalProject (lib/electrical/loadElectricalProject.ts:148-169) — app/api/engineering/calculate/route.ts:87-106. THESE TWO VALUES ARE THE ONLY THING THE CANONICAL MODEL CONTRIBUTES TO COMPLIANCE. |
| `thermalBasis {minDesignTempC, maxDesignTempC}` | getThermalDesignBasis({lat,lng,state,address,designTempMinOverrideC}) — lib/permit/utils/designTemps.ts:122-149, called at app/api/engineering/calculate/route.ts:122-129 |
| `jurisdiction {necVersion, ahj, estimatedPermitFee}, groundSnowLoad, windSpeed` | lib/jurisdiction.ts getJurisdictionInfo/getGroundSnowLoad/getDesignWindSpeed — app/api/engineering/calculate/route.ts:113, 130-131 |
| `RULES ROUTE: electrical (same payload) with designTempMin / designTempMax / rooftopTempAdder / necVersion REPLACED client-side` | app/engineering/page.tsx:6878-6885 — resolveDesignTempMinC(compliance.autoDetected, config.state) and compliance.jurisdiction?.necVersion, i.e. the PREVIOUS /calculate response (the two fetches run in parallel at page.tsx:6855) |
| `RULES ROUTE: engineeringMode, overrides[]` | page React state — app/engineering/page.tsx:6887-6888; app/api/engineering/rules/route.ts:30 |

#### What it calculates

- app/api/engineering/calculate/route.ts:122-129 — ONE thermal design basis per request (minDesignTempC / maxDesignTempC), and deliberately OVERWRITES the client's values at 372-373 so 'the engine and the stamped plan set cannot run at two different temperatures'
- app/api/engineering/calculate/route.ts:49-66 — v57.5 'topology guard': rewrites every `inverters[].type` to 'optimizer' when `body.topologyType` says so, explicitly to make the NEC 690.7 Voc check be skipped
- app/api/engineering/calculate/route.ts:210-232 — DC window selection: `_dcLimits` (storage-published PV input, same projection the SLD consumes) when DC-coupled, else `firstInv.maxDcVoltage ?? 600` / `mpptVoltageMax ?? 600`
- app/api/engineering/calculate/route.ts:270-282 — generateStringConfig: NEC 690.7 cold-Voc correction, totalStrings, panelsPerString, vocCorrected/vmpCorrected, ocpdPerString, dcWireAmpacity, mpptChannels allocation, isValid + errors/warnings
- app/api/engineering/calculate/route.ts:302-337 — optimizer merge advisory appended to stringConfig.warnings when MPPT_CURRENT_EXCEEDED
- lib/electrical-calc.ts:518-1700 (runElectricalCalc) — per-string Voc/Isc/maxCurrentNEC/OCPD (690.8/690.9), DC + AC conductor auto-size and voltage drop (310.15/215.2), conduit fill (Ch.9 Table 1), EGC (250.122), acSizing steps 1-7 (705.60/240.6/690.13/310.16), subSystems[] roof/ground/fence
- lib/electrical-calc.ts:952-1108 — THE 705.12(B)/705.11 INTERCONNECTION VERDICT: icMethod/icBusRating/icMainBreaker/icSolarBreaker, maxLoadSideBackfeedA, four method branches, and the E-BATTERY-BACKFEED-UNRESOLVED hard refusal at 1086-1107
- lib/electrical-calc.ts:1429-1431 — electrical status: PASS is the INITIALISER; FAIL iff allErrors.length>0, WARNING iff allWarnings.length>0
- app/api/engineering/calculate/route.ts:406-433 — runStructuralCalcV4 (whole project) + runSubSystemStructural (per roof/ground/fence); a thrown engine is forced to a FAIL with severity 'error' (413-417)
- app/api/engineering/calculate/route.ts:454-465 — resolveOverallStatus fold: `notEvaluated(electrical ? 'engine-error' : 'no-input')`, producing `overallStatus: null` for NOT EVALUATED. lib/engineering/engineeringStatus.ts:197-221 implements 'a known failure outranks an unknown'
- lib/rules-engine.ts:249-371 (runRulesEngine) — re-runs runElectricalCalc on the posted basis, runs the V1 runStructuralCalc + resolveStructural auto-resolution, emits 8 rule functions (NEC 690.7/690.8/705.12/310 VD×2/Ch.9 fill/690.12 RSD, ASCE attachment spacing/rafter bending), errorCount/warningCount/autoFixCount, overallStatus (358), overallConclusion + indeterminate (363-369), dependencyChain
- lib/engineering/engineeringStatus.ts:108-113 (foldConclusions) and 122-124 (conclusionSeverity) — the shared PASS/FAIL/NOT_EVALUATED vocabulary; NOT_EVALUATED paints as 'warning' because that is the loudest the legacy severity scale can say

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `overallStatus: 'PASS'\|'WARNING'\|'FAIL'\|null` | app/engineering/page.tsx:7070-7090 (re-folded with the per-subsystem structural runs), 9563 (permit-readiness `ok: !!(compliance.overallStatus)`), 9597-9604 (ComplianceSummaryBar), 9758+9767 (header chip); posted to the permit at page.tsx:9108 as `compliance.overallStatus` where NO permit sheet reads it (grep: only the type declaration lib/permit/types.ts:444) |
| `statusNotEvaluated: Array<{engine, reason}>` | app/engineering/page.tsx:7059 (re-fold input) then 7089 (re-assigned) — and NOBODY. No JSX in page.tsx or components/engineering reads it. |
| `statusBasis: string` | app/engineering/page.tsx:7090 — then NOBODY |
| `electrical: ElectricalCalcResult (status, errors[], warnings[], infos[], inverters[], busbar, conduitFill, interconnection, acSizing, subSystems[], summary)` | page.tsx setCompliance → Compliance tab (14540-14571), Electrical Sizing tab, logDecision (7097-7109); posted to the permit (page.tsx:9108) where it is re-labelled `_clientElectrical` provenance and OVERWRITTEN at lib/permit/generatePermit.ts:1183 |
| `electrical.status` | app/engineering/page.tsx:6736 → save-outputs `compliance.electricalStatus` → app/api/engineering/save-outputs/route.ts:517 (ENGINEERING REPORT text file). NOT consumed by the permit. |
| `electrical.interconnection {method, methodLabel, busRating, mainBreaker, solarBreakerRequired, maxAllowedSolarBreaker, passes, necReference, message, alternatives[], issues[]}` | app/engineering/page.tsx:7106-7109 (logDecision `ic.passes ? 'PASS' : 'FAIL'`); lib/rules-engine.ts:314-324 re-reads `electricalResult.interconnection?.method ?? 'LOAD_SIDE'` |
| `electrical.acSizing {ocpdAmps, conductorGauge, conduitSize, groundingConductor, ...}` | app/engineering/page.tsx:7097-7105 (NEC Steps 1-7 decision log), 7221-7223 (SLD payload fallbacks); lib/permit/utils/sldAdapter.ts:148-150, 377-378 |
| `stringConfig {totalStrings, panelsPerString, vocCorrected, stringVoc, ocpdPerString, mpptChannels[], dcAcRatio, warnings[], errors[], isValid}` | app/engineering/page.tsx:7290 (`const sc = compliance.stringConfig`) → the SLD payload's totalStrings/dcOCPD fallbacks. `isValid` and `errors` are consumed by NOBODY in any status fold. |
| `stringConfigError: string\|null` | NOBODY — returned at route.ts:524, no reader found in app/ or components/ |
| `structural (V4 + subSystems + subSystemMeta)` | app/engineering/page.tsx:6900-7010 (remapped to the V1-display shape), 7073-7083 (per-sub engines in the fold); posted to the permit (9108) and then re-computed server-side at lib/permit/generatePermit.ts (runStructuralCalcV4) |
| `jurisdiction {necVersion, ahj, estimatedPermitFee}` | app/engineering/page.tsx:6735 (save-outputs), 6884 (the RULES payload's necVersion), 9775-9781 (NEC chip), 6742-6744 (permit.ahj/estimatedFee) |
| `autoDetected {stateCode, necVersion, designTempMin, designTempMax, groundSnowLoad, windSpeed}` | resolveDesignTempMinC at 8 call sites — app/engineering/page.tsx:1613, 1746, 2044, 2230, 2605, 4144, 4846, 6878 |
| `RULES: overallStatus` | app/engineering/page.tsx:14587 `<StatusBadge status={rulesResult.overallStatus} size="lg" />` (the Compliance tab headline), 9599, 9758, 9767; posted to the permit as rulesResult.overallStatus (lib/permit/types.ts:458) and read by NOBODY there |
| `RULES: rules[] {ruleId, category, severity, conclusion?, requires?, necReference, asceReference, value, limit, autoFixed}` | app/engineering/page.tsx:14612+ per-rule cards; lib/permit/sections/structuralPages.ts:182→502-513 (FENCE sheet) and 529→748-759 (GROUND sheet) unfiltered, 779-780→1288-1299 (ROOF sheet, with rafter/uplift/attach rows filtered OUT). PV-4A explicitly RETIRED it — lib/permit/sections/electricalPages.ts:746-760. |
| `RULES: overallConclusion: EngineeringConclusion, indeterminate: Array<{ruleId, requires[]}>` | NOBODY — computed at lib/rules-engine.ts:363-369 and NOT serialized by app/api/engineering/rules/route.ts:43-54 |
| `RULES: structuralAutoResolutions[], dependencyChain[], electricalResult, structuralResult` | page.tsx:14605-14611 (dependencyChain chips); lib/permit/sections/structuralPages.ts:1303-1314 (autoResolutions, only when permitOptions.includeInternalValidation === true) |
| `(nothing)` | NOBODY — no compliance verdict is persisted anywhere: migrations/009_engineering_runs.sql:9-60 has no status column, and engineering_reports.status (lib/engineering/db-engineering.ts:18) is a lifecycle value set unconditionally to 'complete' at lib/engineering/reportGenerator.ts:143 |

#### Broken handoffs

##### 13.4.1 — [CRITICAL] 'UNRESOLVED' matches no branch of the 705.12(B) evaluator — the rule is silently skipped and the result is still PASS

`lib/electrical-calc.ts:953`

- **Upstream produced:** config.interconnectionMethod defaults to the literal string 'UNRESOLVED' (app/engineering/page.tsx:646, with the comment 'The service topology owns this'), and buildCalcPayload sends it verbatim because `?? 'LOAD_SIDE'` only catches null/undefined (page.tsx:6513)
- **Downstream used instead:** `const icMethod: InterconnectionMethod = input.interconnection?.method ?? 'LOAD_SIDE';` — then the chain `if (icMethod === 'LOAD_SIDE') … else if ('SUPPLY_SIDE_TAP') … else if ('MAIN_BREAKER_DERATE') … else if ('PANEL_UPGRADE')` (lines 972/1003/1017/1049) has NO `else`
- **Consequence:** On every project whose POI nobody has classified — the DEFAULT state — NEC 705.12(B) is never evaluated, nothing is pushed to allErrors/allWarnings, and `status` at line 1429-1431 comes out PASS. The result object carries `passes: false`, `methodLabel: ''`, `message: ''`, `maxAllowedSolarBreaker: 0` (lines 1134-1147), so the decision log at page.tsx:7108 prints 'Interconnection: : FAIL — ' while the badge says PASS.

##### 13.4.2 — [CRITICAL] The permit collapses UNRESOLVED into LOAD_SIDE before computeSystem can refuse it, making the engine's own NOT_EVALUATED unreachable

`lib/permit/utils/computedRuns.ts:322`

- **Upstream produced:** lib/computed-system.ts:1554-1561 defines `_interconUnresolved = !_interconRecorded` (treating '', null and 'UNRESOLVED' as absent) and 1670-1688 pushes `INTERCONNECTION_METHOD_UNRESOLVED` with severity 'error', under the banner '?? LOAD_SIDE DECIDED WHICH ARTICLE OF THE CODE APPLIES'
- **Downstream used instead:** `interconnectionMethod: interconnectionRuleOf(input.project.interconnectionMethod) === '705.11' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE',` — and interconnectionRuleOf (lib/permit/utils/interconnectionRule.ts:29-31) returns '705.12(B)' for null, '' and 'UNRESOLVED'
- **Consequence:** `_interconUnresolved` is ALWAYS false on the permit path, so the refusal the engine was fixed to emit can never fire. PV-4A prints a 120% busbar PASS and a 705.12 backfeed note for a project whose point of interconnection has never been recorded. The same collapse is repeated for the compliance projection at lib/permit/generatePermit.ts:1186 (`input.project.interconnectionMethod ?? 'LOAD_SIDE'`).

##### 13.4.3 — [CRITICAL] Compliance and the rules engine derate conductors with two different rooftop temperature adders in the same request

`app/engineering/page.tsx:6504`

- **Upstream produced:** lib/nec/rooftopAdder.ts:98-106 — `rooftopAmbientAdderC` returns adderC 0 for NEC 2020/2023 because 310.15(B)(3)(c) was deleted for PV by NEC 2017 690.31(A); the page already uses it for the ComputedSystem path (page.tsx:3454) and for the /rules payload (page.tsx:6881)
- **Downstream used instead:** `rooftopTempAdder: config.systemType === 'roof' ? 30 : 0,` in buildCalcPayload, passed through unchanged at app/api/engineering/calculate/route.ts:374 (`electrical.rooftopTempAdder ?? 35`)
- **Consequence:** On a roof job in any NEC 2020/2023 jurisdiction, /api/engineering/calculate sizes DC and AC conductors at ambient+30 °C while /api/engineering/rules sizes the SAME conductors at ambient+0 °C — two gauges, two ampacities and two voltage drops shown side by side on the Compliance tab, and the gauge is a BOM quantity.

##### 13.4.4 — [CRITICAL] The rules engine re-runs the electrical engine on the client's posted thermal basis and its own -10 °C / 2023 defaults, not the route-owned authority

`lib/rules-engine.ts:254`

- **Upstream produced:** app/api/engineering/calculate/route.ts:122-129 resolves `thermalBasis = getThermalDesignBasis({lat, lng, state, address, designTempMinOverrideC})` and deliberately overwrites the client's values at 372-373: 'Thermal basis is route-owned … so the engine and the stamped plan set cannot run at two different temperatures'
- **Downstream used instead:** `designTempMin: (input.electrical as any).designTempMin ?? -10, designTempMax: … ?? 40, rooftopTempAdder: … ?? 30, necVersion: … ?? '2023'` — and app/api/engineering/rules/route.ts:30-39 applies no thermal or jurisdiction authority of its own
- **Consequence:** The AHJ / project design-low override (`designTempMinOverrideC`) and the lat/lng station-level ASHRAE value never reach the rules engine's NEC 690.7 check — the page sends only `{state}` (page.tsx:6880). On the first run of a session `compliance.jurisdiction` is empty, so `necVersion: … ?? null` meets `?? '2023'` and the rules engine asserts NEC 2023 regardless of the adopted edition. The headline Compliance badge (page.tsx:14587) is this engine's verdict.

##### 13.4.5 — [CRITICAL] The service graph's per-panel 705.12(B) / SCCR / load-calculation conclusions are shipped by the API and thrown away by the page, and are absent from every compliance fold

`app/engineering/page.tsx:1214`

- **Upstream produced:** app/api/projects/[id]/service-topology/route.ts:44 + 52-57 returns `evaluation: { overall, checks, bonding, storageSummary }` from `evaluateServiceTopology` — which evaluates NEC 705.12(B) PER PANEL and PER DOMAIN off `panel.busbarRatingA` / `panel.mainBreakerA` (lib/electrical/serviceTopology.ts:1465-1575) and emits a real NOT_EVALUATED naming `panel.busbarRatingA` / `domain.storageConnection` when the rating is absent
- **Downstream used instead:** `const t = data?.success && data.available ? (data.topology as ServiceTopologyForPage) : null; setSvcTopology(t);` — `data.evaluation` is never read
- **Consequence:** The only correct, graph-aware 705.12(B) evaluator in the codebase is invisible to the Compliance tab, to `resolveOverallStatus` (route.ts:457-464 folds only `electrical` and `structural`) and to the page's re-fold (page.tsx:7055-7092, which folds only `server` and `structural:<key>`). A project whose busbar rating was never recorded shows NOT_EVALUATED on the Service Topology tab and PASS on the Compliance tab at the same moment.

##### 13.4.6 — [CRITICAL] The permit synthesizes `overallStatus: 'PASS'` when the request carries no compliance block

`app/api/engineering/permit/route.ts:728`

- **Upstream produced:** lib/engineering/engineeringStatus.ts:19-26 exists specifically to kill this shape: 'const electricalStatus = electricalResult?.status ?? "PASS" … An engine that never ran was reported as compliant.' The calculate route now answers `null`.
- **Downstream used instead:** `if (!body.compliance) { body.compliance = { overallStatus: 'PASS', jurisdiction: { … } }; }`
- **Consequence:** Any permit generated without the engineering page having run (direct API call, a stale client, a mobile/survey-side caller) is stamped with a fabricated PASS on the artefact that goes to the AHJ. The same block was already stripped of its hardcoded NEC '2020' literal for exactly this reason (comment at 740-744); the status literal survived.

##### 13.4.7 — [CRITICAL] The QUARANTINED V1 structural engine runs in production on every compliance run, and its ASCE rows print on the fence and ground planset sheets

`lib/rules-engine.ts:7`

- **Upstream produced:** lib/structural-calc.ts:5-14 — '@deprecated V1 — QUARANTINED … NO LIVE CALLERS … The stale "Used by: siteSurvey/engineeringIntegration, rules-engine" note was wrong — grep confirms neither imports this. DO NOT WIRE THIS BACK IN.' The structural engine of record is V4 (app/api/engineering/calculate/route.ts:407).
- **Downstream used instead:** `import { StructuralInput, runStructuralCalc, StructuralCalcResult } from './structural-calc';` — called at lib/rules-engine.ts:261, reached by app/api/engineering/rules/route.ts:39, which app/engineering/page.tsx:6862 calls on every debounced config change
- **Consequence:** V1's ASCE_RAFTER_BENDING and ASCE_ATTACHMENT_SPACING results feed `rulesResult.overallStatus` (the Compliance tab headline, page.tsx:14587) and are rendered UNFILTERED on the permit's FENCE sheet (lib/permit/sections/structuralPages.ts:182 → 502-513) and GROUND sheet (529 → 748-759). The ROOF sheet already found and filtered this contamination ('73% PASS vs 89%/145%, 370/984 lbs vs 210/500 lbs on one package', 779-780); fence and ground were never fixed.

##### 13.4.8 — [CRITICAL] A posted `topologyType` string disables the NEC 690.7 Voc check — while the SLD route refuses the same input

`app/api/engineering/calculate/route.ts:49`

- **Upstream produced:** app/api/engineering/sld/route.ts:260-300 enforces 'RULE ELEVEN — THE DRAWING TAKES NO ARCHITECTURE FROM THE UI': it OVERWRITES body.topologyType / inverterId / inverterModel from `loadElectricalProject`'s canonical model and logs the disagreement
- **Downstream used instead:** `const bodyTopologyType = String(body.topologyType ?? '').toUpperCase(); … electrical.inverters.map(inv => inv.type === 'optimizer' ? inv : { ...inv, type: 'optimizer' })` — and the route reads the canonical model (87-106) ONLY for `solarCoupling` and `dcStringLimits`
- **Consequence:** The compliance route lets the page's React state decide whether NEC 690.7(A) applies at all (`isOptimizerTopology` → 'topology guard' → 690.7 Voc check skipped in both route.ts:148-151 and lib/rules-engine.ts:277-291). The drawing refuses the same posted architecture; the compliance verdict accepts it. This is the 'System Config auto-applies equipment that then survives into the SLD' pattern, with the roles inverted: the SLD is now the strict surface and compliance is the permissive one.

##### 13.4.9 — [CRITICAL] An infeasible NEC 690.7 string layout never reaches the overall verdict

`app/api/engineering/calculate/route.ts:457`

- **Upstream produced:** `stringConfig` from generateStringConfig carries `isValid`, `errors[]` and `mpptAllocation.violations[]` including MPPT_CURRENT_EXCEEDED (route.ts:302-309), and `stringConfigError` records a thrown generator (route.ts:344) specifically so 'the client can show "string sizing failed" instead of treating a null stringConfig as "not applicable"'
- **Downstream used instead:** `resolveOverallStatus({ electrical: …, structural: … })` — stringConfig is not an engine in the fold, and `stringConfigError` has no reader anywhere in app/ or components/
- **Consequence:** A design whose strings cannot be allocated to the inverter's MPPT channels, or whose string generation threw outright, returns `overallStatus: 'PASS'` as long as runElectricalCalc and runStructuralCalcV4 both pass. The sizing engine's own verdict is the one thing the compliance verdict does not include.

##### 13.4.10 — [CRITICAL] NOT EVALUATED is collapsed into the rules engine's PASS by the page's own badges

`app/engineering/page.tsx:9603`

- **Upstream produced:** `overallStatus: null` + `statusNotEvaluated` from resolveOverallStatus (lib/engineering/engineeringStatus.ts:210-216: 'Nothing failed, but something did not run: the evaluation is incomplete')
- **Downstream used instead:** ComplianceSummaryBar: `const a = compliance.overallStatus; const b = rulesResult?.overallStatus; … return a || b || 'PASS';` — and the header chip twice: `const s = compliance.overallStatus || rulesResult?.overallStatus;` (page.tsx:9758, 9767)
- **Consequence:** `rulesResult.overallStatus` is typed 'PASS'|'WARNING'|'FAIL' and can never be null (lib/rules-engine.ts:358), so a route verdict of NOT EVALUATED is overwritten by the rules engine's PASS on the Overall segment and on the header chip. This is the same `?? 'PASS'` the client-side fold at page.tsx:7020-7050 was rewritten to remove — it survives two blocks lower.

##### 13.4.11 — [CRITICAL] The rules engine's NOT_EVALUATED conclusion is computed, never produced, and dropped at the HTTP boundary

`app/api/engineering/rules/route.ts:43`

- **Upstream produced:** lib/rules-engine.ts:363-369 computes `overallConclusion = foldConclusions(asChecks)` and `indeterminate = rules.filter(r => r.conclusion === 'NOT_EVALUATED')`, declared at 80-91 as 'The engineering answer, separate from the presentation one'
- **Downstream used instead:** The route returns only `{ overallStatus, errorCount, warningCount, autoFixCount, overrideCount, rules, electricalResult, structuralResult, structuralAutoResolutions, dependencyChain }` — `overallConclusion` and `indeterminate` are omitted
- **Consequence:** The client can only ever read `overallStatus`, which by construction cannot express 'incomplete'. Worse, the vocabulary has NO PRODUCERS: `conclusion:` appears exactly once in lib/rules-engine.ts (line 363, the derivation), so no rule function ever sets it, `indeterminate` is always [], and `overallConclusion` can never be NOT_EVALUATED. The whole NOT_EVALUATED channel in the rules engine is dead.

##### 13.4.12 — [CRITICAL] On a DC-coupled design the rules engine evaluates no DC rule at all and returns PASS

`lib/rules-engine.ts:282`

- **Upstream produced:** app/api/engineering/calculate/route.ts:157-173 establishes that '`firstInv` IS LEGITIMATELY ABSENT ON A DC-COUPLED JOB' and opens the string generator against `electrical.pvArray` + the storage's published PV window (`_dcLimits`, route.ts:210-217)
- **Downstream used instead:** `electricalResult.inverters?.forEach(inv => inv.strings?.forEach(str => { … ruleNEC690_7 … ruleNEC690_8 … ruleVoltageDrop … }))` — an empty inverters[] means the loop body never runs
- **Consequence:** On a Powerwall-3-style DC-coupled job the rules engine fires NO 690.7, NO 690.8 and NO DC voltage-drop rule; `errorCount` is 0 and `overallStatus` at line 358 is PASS. The Compliance tab's headline badge (page.tsx:14587) prints a green stamp for a design whose DC side was never checked.

##### 13.4.13 — [CRITICAL] ruleNEC690_7 applies inverter[0]/string[0] specs to every string and defaults the inverter maximum to 480 V

`lib/rules-engine.ts:293`

- **Upstream produced:** app/api/engineering/calculate/route.ts:210-232 selects the DC window from the device the strings actually land on — `_dcLimits.maxDcVoltage` (the SAME projection the SLD route consumes, so 'the sizing tab and the sheet cannot disagree about one device'), else `firstInv.maxDcVoltage ?? 600`
- **Downstream used instead:** `ruleNEC690_7(str.vocSTC/(str.panelCount||1), str.panelCount, input.electrical.inverters[0]?.strings[0]?.tempCoeffVoc ?? -0.26, (input.electrical as any).designTempMin ?? -10, input.electrical.inverters[0]?.maxDcVoltage ?? 480)`
- **Consequence:** Four defects in one call: inverter[0]'s maxDcVoltage and string[0]'s tempCoeffVoc govern EVERY string of EVERY inverter on a hybrid or mixed-module design; the -0.26 coefficient default disagrees with the route's -0.27 (route.ts:181); the 480 V default disagrees with the route's 600 V (route.ts:219), the SLD payload's 600 V (page.tsx:7294-7297) and the permit payload's 480 V (page.tsx:9086) — four defaults for one device limit; and `_dcLimits` never reaches this rule, so a DC-coupled array is tested against 480 V instead of the storage's published 550 V window.

##### 13.4.14 — [CRITICAL] VAL-1, the permit's own compliance gate, reads no compliance verdict and prints ALL CHECKS PASSED over an uncomputed rafter

`lib/permit/sections/validationPage.ts:147`

- **Upstream produced:** `compliance.overallStatus` (page.tsx:9108) and the real V4 rafter result; the sheet's own type union is `type CheckStatus = 'PASS' | 'FAIL' | 'PENDING' | 'N/A'` (line 82)
- **Downstream used instead:** `if (_u == null) return 'WARN' as CheckStatus;` — then `const failCount = checks.filter(c => c.status === 'FAIL').length; const pendingCount = checks.filter(c => c.status === 'PENDING').length; const overallStatus = failCount > 0 ? … : pendingCount > 0 ? … : 'ALL CHECKS PASSED';` (186-193)
- **Consequence:** 'WARN' is outside the union, so it is counted as neither FAIL nor PENDING: a package whose rafter utilization never computed prints 'ALL CHECKS PASSED' in green on the AHJ-facing validation sheet, and the sub-caption claims N/N checks passed (line 395). The same sheet hardcodes PASS for every ground-mount structural method (line 145) and for the Cross-Contamination Check (line 180), and reads `compliance.overallStatus` nowhere — it is a 12-item presence audit standing in for the engineering verdict.

##### 13.4.15 — [CRITICAL] The outbound permit/engineering text files default the interconnection to SUPPLY-SIDE TAP — the opposite article to the permit route's LOAD_SIDE default

`app/api/engineering/save-outputs/route.ts:513`

- **Upstream produced:** app/engineering/page.tsx:6716 records `interconnection: config.interconnectionMethod ?? null` precisely so UNRESOLVED survives — 'supply-side and load-side are materially different permits — different NEC article (705.11 vs 705.12(B)) … so this invented a topology nobody chose and then made it stick'
- **Downstream used instead:** `\`  Interconnection:        ${elec.interconnection ?? 'Supply-Side Tap'}\`` — at line 513 (ENGINEERING REPORT) and line 624 (PERMIT PACKAGE)
- **Consequence:** The null the page was fixed to preserve is turned into 'Supply-Side Tap' (NEC 705.11) on both outbound text artefacts, while app/api/engineering/permit/route.ts + computedRuns.ts:322 turn the same null into LOAD_SIDE (NEC 705.12(B)) on the planset. One unresolved project, two documents, two opposite code articles. Compounding: lines 516 and 622 default the NEC edition to 'NEC 2020' — the exact skeleton literal the permit route removed for being published as an operator attestation (permit/route.ts:740-744).

##### 13.4.16 — [CRITICAL] The 400 A / two-MSP path is structurally unevaluable: the compliance engine takes one bus rating and one interconnection

`lib/electrical-calc.ts:126`

- **Upstream produced:** lib/electrical/serviceTopology.ts:265-285 + 1465-1575 model `panels[]` each with its own `busbarRatingA` and `mainBreakerA` and evaluate 705.12(B) per panel and per backup domain ('each gateway is its own point of connection', line 1479); lib/electrical/loadElectricalProject.ts:270-301 refuses to project a single scalar when the POIs are genuinely different relationships
- **Downstream used instead:** `export interface ElectricalCalcInput { … mainPanelAmps: number; … interconnection?: InterconnectionInput; }` — one scalar, one object; fed by `busRating: config.panelBusRating ?? 200, mainBreaker: config.mainPanelAmps ?? 200` (app/engineering/page.tsx:6514-6515) and, on the permit path, `panelBusRating: input.project.panelBusRating || input.project.mainPanelAmps || 200` (lib/permit/utils/computedRuns.ts:292-293)
- **Consequence:** On Ray's real 400 A / two-gateway job the compliance tab runs ONE 120% check against ONE bus rating that may be a literal 200 A guess, and reports a verdict for a busbar that does not exist in the design. The simple 200 A / one-MSP path and the 400 A / two-system path are not the same chain with fewer questions — the 400 A path has no representation in the compliance engine's input type at all.

##### 13.4.17 — [CRITICAL] Inapplicable checks are emitted as severity 'pass' and print '✓ PASS' on the planset

`lib/rules-engine.ts:288`

- **Upstream produced:** lib/engineering/engineeringStatus.ts:84 + 122-124 provide exactly the vocabulary for this ('NOT_EVALUATED IS NOT A SOFT FAIL AND NOT A SOFT PASS'), and `RuleResult.conclusion` + `requires` exist on the type (lib/rules-engine.ts:33-35)
- **Downstream used instead:** `rules.push({ ruleId: 'NEC_690_7_VOLTAGE', …, severity: 'pass', title: 'NEC 690.7 Voltage — Optimizer (N/A)', … } as any)` and the same shape at line 316-320 for 'NEC 705.12 Busbar Rule — N/A (Supply-Side Tap)' — neither sets `conclusion`
- **Consequence:** lib/permit/utils/helpers.ts:211-217 `statusLabel('pass')` renders '✓ PASS', so the fence and ground structural sheets and the per-rule UI cards show a green PASS for a rule that was never applicable. `foldConclusions` then folds both into conclusion PASS (line 363), and because that mapping is `r.severity === 'error' ? 'FAIL' : 'PASS'`, a genuine severity 'warning' — e.g. 'String Voc within 5% of inverter max' (line 154-157) — also folds to PASS.

##### 13.4.18 — [MAJOR] The permit discards the engineering page's electrical compliance and recomputes with a different engine; the two statuses can disagree

`lib/permit/generatePermit.ts:1183`

- **Upstream produced:** `compliance.electrical` — the full ElectricalCalcResult including `status`, `errors[]` (with E-BATTERY-BACKFEED-UNRESOLVED) and the 705.12(B) `interconnection` verdict — posted at app/engineering/page.tsx:9108
- **Downstream used instead:** `input.compliance.electrical = mapComputedSystemToCompliance(csFull, { busRatingA: …, mainBreakerA: …, interconnectionMethod: … });` after the page's block is demoted to `_clientElectrical` provenance at lines 720-727 ('client-posted compliance.electrical is NEVER engineering authority')
- **Consequence:** The permit's electrical status is `cs.errorCount > 0 ? 'FAIL' : cs.warningCount > 0 ? 'WARNING' : 'PASS'` (lib/permit/snapshot/computeSystemProjection.ts:116) from computeSystem's issue list, which is a different rule set from runElectricalCalc's. The intent is defensible, but the consequence is that the page's Compliance tab and the permit's PV-4A are two engines with no parity gate on `status`: the page can read FAIL and the package PASS for the same design. PV-4A compounds this by RETIRING the rules-engine results entirely (lib/permit/sections/electricalPages.ts:746-760) while the fence/ground structural sheets still print them.

##### 13.4.19 — [MAJOR] statusNotEvaluated and statusBasis are computed, stored on React state, and rendered nowhere

`app/engineering/page.tsx:7089`

- **Upstream produced:** app/api/engineering/calculate/route.ts:470-473 ships `statusNotEvaluated` with the comment 'Present whenever overallStatus is null: which engines produced no verdict and why. A consumer must not read a null status as a pass', plus `statusBasis` (472)
- **Downstream used instead:** `calcData.statusNotEvaluated = _folded.notEvaluated; calcData.statusBasis = _folded.basis;` — the fields are declared on the compliance type (page.tsx:332-334) and assigned here; no JSX in app/engineering/page.tsx or components/engineering reads either
- **Consequence:** A null overall status renders as a bare em-dash (page.tsx:9616) or as the inert word 'Compliance' on the header chip (page.tsx:9770) with no indication of WHICH engine did not run or WHY. The user sees absence, not a reason — so the honest value is indistinguishable on screen from 'nothing has been calculated yet'.

##### 13.4.20 — [MAJOR] The engineering page carries a second StatusBadge that cannot paint NOT_EVALUATED

`app/engineering/page.tsx:651`

- **Upstream produced:** components/engineering/StatusBadge.tsx:14-21 accepts `'PASS' | 'WARNING' | 'FAIL' | 'NOT_EVALUATED' | null` and renders NOT_EVALUATED as a distinct amber-bordered 'NOT EVALUATED' badge, explicitly because 'NOT_EVALUATED IS A STATUS, NOT A QUIET null'
- **Downstream used instead:** `function StatusBadge({ status }: { status: 'PASS' | 'WARNING' | 'FAIL' | null; … })` — a local duplicate whose cfg map has only PASS/WARNING/FAIL, so anything falsy renders the grey 'Not calculated' text
- **Consequence:** Every badge on the engineering page (14245 structural, 14587 rules headline, 18834) uses the local copy, so NOT_EVALUATED cannot be shown there at all — it degrades to the same grey 'Not calculated' as a run that never happened. The component that knows how to say it exists and is unreachable from this page.

##### 13.4.21 — [MAJOR] The Compliance tab's headline badge is the rules engine's verdict, not the compliance route's

`app/engineering/page.tsx:14587`

- **Upstream produced:** `calcData.overallStatus` / `statusBasis` from resolveOverallStatus, re-folded at page.tsx:7086-7090 with the per-subsystem structural runs so it 'can therefore only ESCALATE … There is no path back up to PASS'
- **Downstream used instead:** `<StatusBadge status={rulesResult.overallStatus} size="lg" />`
- **Consequence:** The large, authoritative-looking badge at the top of the NEC/ASCE card is `errorCount>0?'FAIL':warningCount>0?'WARNING':'PASS'` from lib/rules-engine.ts:358 — computed by the second engine, on a one-cycle-stale thermal basis, with the V1 structural engine, and incapable of expressing NOT EVALUATED. The carefully folded verdict appears only on the smaller rail segment and the header chip, both of which then collapse it (see the `a || b || 'PASS'` break).

##### 13.4.22 — [MAJOR] The rules payload's NEC edition and design temperatures come from the previous response, in a parallel fetch

`app/engineering/page.tsx:6878`

- **Upstream produced:** `calcData.autoDetected.designTempMin/designTempMax` and `calcData.jurisdiction.necVersion` — resolved fresh by app/api/engineering/calculate/route.ts:122-131 for THIS request
- **Downstream used instead:** `designTempMin: resolveDesignTempMinC(compliance.autoDetected, config.state), designTempMax: (compliance.autoDetected as any)?.designTempMax ?? …, necVersion: compliance.jurisdiction?.necVersion ?? null` — read from the `compliance` state object inside a `Promise.all` that fires both fetches simultaneously (page.tsx:6855-6890)
- **Consequence:** The rules engine is always evaluated on the PREVIOUS run's jurisdiction and thermal basis. Change the address or the state and the two halves of the Compliance tab disagree for one full cycle; on the very first run `compliance` is empty, so necVersion posts null and lib/rules-engine.ts:257 substitutes '2023', and `rooftopAmbientAdderC({ necEdition: null })` decides the ampacity adder from an unestablished edition.

##### 13.4.23 — [MINOR] No compliance verdict is persisted anywhere in the database

`migrations/009_engineering_runs.sql:9`

- **Upstream produced:** `overallStatus`, `statusNotEvaluated`, `statusBasis`, `electrical.status`, `structural.status` and `rulesResult.overallStatus` — a complete verdict set, every 800 ms
- **Downstream used instead:** The engineering_runs DDL has columns for system_size_kw, panel_id, interconnection_method, wire_gauge, string_config and calc_outputs — and no status column of any kind. `calc_outputs` receives `{ electrical: elec, structural, compliance, runs }` (app/api/engineering/save-outputs/route.ts:437) where `compliance` is the four-field summary built at page.tsx:6735-6738, which omits overallStatus entirely. engineering_reports.status (lib/engineering/db-engineering.ts:18) is a lifecycle value set unconditionally to 'complete' (lib/engineering/reportGenerator.ts:143).
- **Consequence:** The compliance verdict is unrecoverable after a page reload: nothing can answer 'was this design compliant when it was quoted / permitted / ordered?' A restored run rehydrates equipment, strings and the interconnection method but not the conclusion they were judged by, so the next consumer re-derives it from whatever the config now says.

##### 13.4.24 — [MAJOR] A fifth independent NEC 690.7 string-length implementation writes engineering_reports and is never reconciled with the compliance verdict

`lib/engineering/reportGenerator.ts:210`

- **Upstream produced:** `stringConfig` from generateStringConfig at app/api/engineering/calculate/route.ts:270-282 — panelsPerString, totalStrings, vocCorrected, ocpdPerString, dcWireAmpacity, isValid
- **Downstream used instead:** `generateElectricalEngineering(snap, pd)` re-derives panelsPerString / stringCount / stringVocCorrected / dcWireGauge / stringFuseAmps / dcDisconnectAmps from a DesignSnapshot using `inverter?.maxDcVoltage || 600`, `mpptVoltageMax || 550` and its own coldVocFactor (lines 237-255), with panel specs themselves estimated (`panel.voc || panel.wattage / 8.5`, line 218)
- **Consequence:** A second string layout — computed from estimated panel specs and its own inverter defaults — is persisted into engineering_reports.report_data alongside `status: 'complete'`, with no comparison against the compliance route's committed layout and no path for its disagreement to surface. The file's own comment acknowledges the consequence of this function SETTING those fields: 'the report recommended shorter strings and therefore MORE strings, more MPPT channels and sometimes another inverter than the design needs — a price the customer pays.'

---

### 13.5 SLD OUTPUT (SVG + PDF)

*30 breaks — 7 verified by a refuter.*

#### What this stage is

The SLD stage has three independent entry points into ONE renderer (`lib/sld-professional-renderer.ts:4097 renderSLDProfessional`): `app/api/engineering/sld/route.ts:1319` (Diagram tab, single-lane), `app/api/engineering/sld/route.ts:490` (hybrid multi-lane), and `app/api/engineering/sld/pdf/route.ts:450` (the exported PDF) — plus a fourth assembly for the planset at `lib/permit/utils/sldAdapter.ts:948`. The SVG route is the only one that behaves like a consumer: it reads the canonical model via `loadElectricalProject` (route.ts:151), refuses an unresolved architecture with 409 (route.ts:174-180), and overwrites the request body's architecture fields as a set (route.ts:197-357) before calling `computeSystem` ONCE (route.ts:1117) and flattening eight engine values through `buildPermitSystemModel` (route.ts:1121, 1148-1155). But the flattening is the whole bridge: `systemModel` is handed to the renderer at `route.ts:1305` and the string `systemModel` appears in the renderer exactly once — the type declaration at `lib/sld-professional-renderer.ts:649`. It is never read. Everything the engine concluded that was not hand-copied into a flat scalar (the NEC 705.12(B) verdict, ampacity pass/fail, voltage pass/fail, issues, per-string layout, total DC kW) is re-decided inside the renderer from the scalars, and the renderer itself still sizes EGCs, conductors, OCPDs, AC disconnects and microinverter branch counts. The PDF route never calls `computeSystem` or `buildPermitSystemModel` at all and still fabricates a Fronius Primo 8.2-1, which the SVG route explicitly removed.

#### Data in

| Field | Where it comes from |
|---|---|
| `projectId` | request body → app/engineering/page.tsx:7280; gate at app/api/engineering/sld/route.ts:123 isReadableProjectId |
| `serviceTopology (the connection graph)` | projects.service_topology via lib/electrical/loadElectricalProject.ts:154 → route.ts:197-199 (body.serviceTopology OVERWRITTEN, never posted) |
| `solarCoupling` | model.solarCoupling, lib/electrical/projectModel.ts:340-526 → route.ts:276-299 (_canonicalCoupling, route.ts:325) |
| `serviceRatedAmps → body.mainPanelAmps` | projects.service_topology service.ratedAmps, lib/electrical/projectModel.ts:617 → route.ts:211-219 |
| `interconnection / interconnectionType / interconnectionMethod` | interconnectionMethodScalar(topology), lib/electrical/loadElectricalProject.ts:270-301 → route.ts:226-237 |
| `batteryCount` | model.storage.invertingUnitCount (graph instances), lib/electrical/projectModel.ts:565 → route.ts:258 |
| `batteryBackfeedA` | topology.domains[].storageConnection + storage[].ocpdA → route.ts:340-349 |
| `inverterMaxDcV / maxDcVoltage / mpptVoltageMin / mpptVoltageMax / maxInputCurrentPerMppt / mpptChannels` | dcStringLimits(topology, coupling) on DC-coupled only, route.ts:326-338; otherwise request body (page.tsx:7288-7294) |
| `inverterId` | model.externalInverterId on ac-coupled-inverter, route.ts:293; else request body page.tsx:7275-7277 |
| `electricalRevision` | electricalRevision(model), lib/electrical/loadElectricalProject.ts:248 → route.ts:357 |
| `selectedCombinerId` | projects.selected_equipment.combinerSelection via readStoredCombinerSelection, route.ts:125-129 (store read outranks the posted copy) |
| `topologyType` | REQUEST BODY (app/engineering/page.tsx:7198-7206 topoType); overwritten only for dc-coupled/storage-only at route.ts:280/295; otherwise survives to route.ts:600 _bodyTopologyType |
| `totalModules` | REQUEST BODY totalPanels (app/engineering/page.tsx:7235) → route.ts:559 `Number(body.totalModules) \|\| 20` |
| `totalStrings` | REQUEST BODY cs.stringCount (app/engineering/page.tsx:7237) — NOT READ on the single-lane path; route.ts:880 recomputes resolvedTotalStrings |
| `panelVoc / panelIsc / panelVmp / panelImp / panelWatts / panelModel` | REQUEST BODY from equipment-db lookup (page.tsx:7247-7250, 7298-7299) → route.ts:560-564 with literal fallbacks 49.6/10.18/41.8/9.57/400 |
| `selectedBrand / selectedInverterId / panelId / systemType` | REQUEST BODY (page.tsx:7434-7437) → route.ts:642-645 → sizeSystemFromBrand (route.ts:649) |
| `runs (RunSegment[])` | REQUEST BODY cs.runs / legacyRunsView() (page.tsx:7407) — DISCARDED unless computeSystem throws (route.ts:1138); the route's own computeSystem output is used (route.ts:1118) |
| `microBranches` | REQUEST BODY cs.microBranches, micro only (page.tsx:7413) → route.ts:1230 |
| `batteryId / generatorId / backupInterfaceId / atsAmpRating` | REQUEST BODY from engineering config equipment ids (page.tsx:7342-7398) → route.ts:946-951 equipment-db spec lookups |
| `lat / lng / state / address / designTempMinOverrideC` | REQUEST BODY → getThermalDesignBasis, route.ts:570-578 |
| `necVersion (adopted edition)` | getJurisdictionInfo(address\|\|state), route.ts:584-594 — NOT the posted body.necVersion (page.tsx:7383 is ignored) |
| `buildInput.* (PDF route)` | HTTP request body only: `const buildInput = body.buildInput ?? body`, app/api/engineering/sld/pdf/route.ts:139 |
| `sources[] (hybrid lanes: topologyType, inverterModel, inverterCount, totalModules, totalStrings, panelsPerString, acOCPD, backfeedAmps, dcOCPD, egcGauge, optimizerQty, combinerLabel, deviceCount, microBranches, runs)` | HTTP request body, validated-but-not-overridden by sanitizeClientSourceBranches, lib/permit/utils/sldAdapter.ts:837-874 → route.ts:392 |

#### What it calculates

- Reads projects.service_topology / selected_equipment / engineering_config / layouts.total_panels in one query and composes the canonical model (loadElectricalProject.ts:153-168)
- REFUSES with HTTP 409 ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION when model.architectureResolutionRequired (route.ts:174-180; pdf/route.ts:185-191)
- Overwrites body.serviceTopology, mainPanelAmps, interconnection*, batteryCount, batteryBackfeedA, topologyType, inverterId/inverterModel and the DC input window from the canonical model (route.ts:197-349) — SVG route ONLY
- Persists the one-time solarCoupling canonicalization (route.ts:377 → loadElectricalProject.ts:319-346)
- Re-runs the sizing engine: sizeSystemFromBrand (route.ts:649) and overrides body.topologyType with sizingResult.topology (route.ts:694-737)
- Re-generates the string layout: generateStringConfig (route.ts:829) then overrides string count / panels-per-string from the sizing engine's layoutStrings (route.ts:855-871)
- Resolves the integrated BOS combiner/gateway with the same resolver the permit uses: resolveIntegratedEquipment + planLandingDevice (route.ts:896-937)
- Composes the CT/metering drawing via resolveDesignMetering / sldGatewayFieldsOf (route.ts:1286-1299) and hybridLaneMetering for lanes (route.ts:410)
- Calls computeSystem ONCE and builds PermitSystemModel (route.ts:1117-1130), then flattens 8 values: acOcpdAmps, backfeedBreakerAmps, dcWireGauge, acWireGauge, egcGauge, stringOcpdAmps, stringVoc, stringIsc (route.ts:1148-1155)
- Renders a 2304×1728 (ANSI C 24×18 in) SVG and, on the PDF route, wraps it in HTML with the canonical embedded font pack and prints via Puppeteer/Chromium (pdf/route.ts:466-476)
- Inside the renderer, RE-DECIDES: the NEC 705.12(B) 120% verdict (5966, 6014, 8706), total DC kW (4271), panels-per-string (5806, 6049), microinverter branch counts (4528, 4629, 5754, 6055), EGC sizes via getEGCSize (7642, 7732, 7873, 8112, 8210, 8764), conductor gauges via wireGaugeForOcpd (7271, 7430, 7481, 7495, 7636, 8205), OCPDs via necNextStandardOcpd (5767, 6650, 6964, 7267), the AC disconnect device via resolveAcDisconnect (2347) and DER aggregation panel sizing via sizeAggregationPanel (3388, 3735)
- SUPPRESSES rather than never-builds: deletes already-built schedule rows (overlayServiceTopologyRows, 2919-3036), filters already-computed engine runs out of the conductor schedule (6189-6193), and blocks the micro path after it was selected (4156)

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `SVG string (image/svg+xml, 2304×1728)` | app/engineering/page.tsx:7498 setSldSvg → rendered at page.tsx:15254; persisted by app/api/engineering/save-outputs/route.ts:177-187 as a project_files row (fileName SLD_<name>.svg, content = the SVG) |
| `X-System-Model: 'computed' \| 'fallback'` | NOBODY — no reader in app/ or lib/ (route.ts:1329) |
| `X-Layout-Source, X-Sld-Degraded` | NOBODY (route.ts:1330-1331) |
| `X-Electrical-Revision` | app/engineering/page.tsx:7446 _sldRevisionRef (raw-SVG path only) |
| `electricalRevision (JSON)` | app/engineering/page.tsx:7453 → setSldRevision (7499) → sldFreshness at page.tsx:3192 |
| `architecture {resolved, source, topologyTypeUsed, topologyTypePosted, overrodeRequestBody}` | NOBODY in production code — reporting-only (route.ts:1371-1379) |
| `resolvedValues {acOCPD, backfeedAmps, dcWireGauge, acWireGauge, egcGauge, dcOCPD}` | NOBODY — the page reads only data.svg and data.electricalRevision (page.tsx:7453-7454) |
| `stringConfig / microConfig / layoutSource / sldDegraded / topology` | NOBODY (route.ts:1381-1407) |
| `HTTP 409 {code:'ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION', conflicts, choices, resolveWith}` | app/engineering/page.tsx:7464 _sldBlockRef → the Diagram tab's refusal banner |
| `application/pdf (SLD-<project>-<ts>.pdf)` | browser download, app/engineering/page.tsx:14974 |
| `PermitSystemModel (systemModel)` | NOBODY — lib/sld-professional-renderer.ts:649 is the only occurrence of the identifier in the renderer; it is a type declaration, not a read |

#### Broken handoffs

##### 13.5.1 — [CRITICAL] PermitSystemModel reaches the renderer and is never read — the entire 'single source of truth bridge' is dead

`lib/sld-professional-renderer.ts:649`

- **Upstream produced:** buildPermitSystemModel(cs, {...}) at app/api/engineering/sld/route.ts:1121, passed in as `systemModel: systemModel ?? undefined` (route.ts:1305). Its own header reads 'passed to ALL sheet builders. No individual sheet ever re-derives NEC values' (lib/plan-set/permit-system-model.ts:8-9).
- **Downstream used instead:** `systemModel?: import('./plan-set/permit-system-model').PermitSystemModel;` — the ONLY occurrence of the string `systemModel` in all 8834 lines of the renderer. Zero reads. Every value survives only if the route hand-copied it into a flat scalar at route.ts:1148-1155.
- **Consequence:** interconnectionPass, dcAmpacityPass, voltagePass, dcAmpacity, maxAllowedBackfeed, issuesSummary, isValid, errorCount, totalDcKw, totalAcKw, dcAcRatio, tempCorrectionFactor, stringVmp, inverterMaxDcV, ambientTempC, rooftopTempAdderC, strings[] and acBranchOcpdAmps are computed by the engine on every SLD request and discarded. The sheet then re-derives the ones it prints from the scalars.

##### 13.5.2 — [CRITICAL] The NEC 705.12(B) 120% verdict is re-decided by the renderer; the engine's verdict is never passed

`lib/sld-professional-renderer.ts:6014`

- **Upstream produced:** `const interconnectionPass = _interconUnresolved ? false : _isSupplySideTap ? true : (totalBackfeedA + input.mainPanelAmps) <= (input.panelBusRating * 1.2)` (lib/computed-system.ts:1688-1692), surfaced as systemModel.interconnectionPass (lib/plan-set/permit-system-model.ts:250). The renderer has an input for exactly this: `poiRulePasses` — 'When provided, the renderer PRINTS it — it never re-decides' (renderer:424-427).
- **Downstream used instead:** `['120% Rule',`${(input.poiRulePasses ?? ((input.panelBusRating ?? input.mainPanelAmps)*1.2 >= input.mainPanelAmps+input.backfeedAmps)) ? 'PASS ✓':'FAIL ✗'}`]` — and `poiRulePasses` is set by ONE writer in the repo, lib/permit/utils/sldAdapter.ts:349 (the planset). Neither app/api/engineering/sld/route.ts nor app/api/engineering/sld/pdf/route.ts sets it. Same re-derivation at renderer:5966 and 8706.
- **Consequence:** A project whose point of interconnection is unresolved gets interconnectionPass=false plus an INTERCONNECTION_METHOD_UNRESOLVED error from the engine (computed-system.ts:1670-1686), and the Diagram tab and the exported PDF print '120% Rule PASS ✓' anyway from local arithmetic. The planset E-1 for the same project prints the engine's verdict. Two artefacts, one project, opposite NEC 705.12(B) conclusions.

##### 13.5.3 — [CRITICAL] The exported PDF still fabricates a Fronius Primo 8.2-1 — the exact invention the SVG route removed

`app/api/engineering/sld/pdf/route.ts:253`

- **Upstream produced:** app/api/engineering/sld/route.ts:545-550 replaced this with `inverterModel = unselectedInverterLabel()` and logs 'the sheet says INVERTER NOT SELECTED rather than naming a product nobody chose'; the renderer detects that marker and prints it in red (renderer:4429-4432).
- **Downstream used instead:** `const topoForDefaultPdf = String(body.topologyType ?? 'STRING_INVERTER'); if (!inverterManufacturer) { inverterManufacturer = topoForDefaultPdf === 'MICROINVERTER' ? 'Enphase' : 'Fronius'; } if (!inverterModel) inverterModel = 'Primo 8.2-1';`
- **Consequence:** A real manufacturer and a real model number appear in the nameplate position of the PDF that gets attached to a permit submission, for a project that selected no inverter. Worse, line 254 reads `body.topologyType` while every other line reads `buildInput.topologyType` (275, 314) — a caller that posts {buildInput:{...}} always lands on the 'Fronius' arm regardless of its real topology.

##### 13.5.4 — [CRITICAL] The PDF route never calls computeSystem or buildPermitSystemModel — the printed sheet carries no engine values at all

`app/api/engineering/sld/pdf/route.ts:306`

- **Upstream produced:** The SVG route's `cs = computeSystem(csInput)` (route.ts:1117) → systemModel.acOcpdAmps / acWireGauge / egcGauge / backfeedBreakerAmps / stringOcpdAmps / stringVoc / stringIsc (route.ts:1148-1155).
- **Downstream used instead:** The entire `const input: SLDProfessionalInput = {...}` is built from `buildInput` (the HTTP body) with literals: `acWireGauge: String(buildInput.acWireGauge ?? buildInput.wireGauge ?? '#8 AWG')` (358), `dcWireGauge: ... ?? '#10 AWG'` (351), `dcOCPD: Number(buildInput.dcOCPD) || 20` (353), `acOCPD = Number(buildInput.acOCPD) || nextStandardOcpd(acOutputAmps * 1.25)` (265). There is NO `egcGauge` key and NO `systemModel` key in the object at all.
- **Consequence:** With no `egcGauge` the renderer falls through to `?? '#10 AWG'` (renderer:4227) and prints a #10 equipment grounding conductor on the exported sheet whatever NEC 250.122 requires for the actual OCPD. Every conductor, OCPD and backfeed figure on the printed PDF is whatever the browser posted, never an engine result.

##### 13.5.5 — [CRITICAL] The PDF route skips the whole RULE ELEVEN architecture overwrite the SVG route performs

`app/api/engineering/sld/pdf/route.ts:193`

- **Upstream produced:** app/api/engineering/sld/route.ts:276-349 overwrites, as a set, `body.topologyType`, deletes `body.inverterModel/inverterManufacturer/inverterId` on dc-coupled-storage and storage-only, sets `body.batteryCount = _model.storage.invertingUnitCount`, sets `body.batteryBackfeedA`, and replaces the DC input window from `dcStringLimits(_model.topology, _model.solarCoupling)`.
- **Downstream used instead:** The PDF route's `if (_m?.topology) { ... }` block sets only three things: `buildInput.serviceTopology` (196-198), `buildInput.mainPanelAmps` (206) and the three interconnection spellings (211-213). `topologyType: String(buildInput.topologyType ?? 'STRING_INVERTER')` (314) and the fabricated inverter (253-258) ride straight through.
- **Consequence:** On a DC-coupled job the exported PDF's topologyType and inverter model are the page's React state, and the batteries' published PV input window is never substituted for the phantom inverter's defaults. The sheet only looks correct because the renderer suppresses the inverter downstream (renderer:4155-4156) — which is the 'suppress it afterwards' pattern route.ts:1366-1368 explicitly names as forbidden.

##### 13.5.6 — [CRITICAL] layouts.total_panels is loaded and then ignored; the module count on the drawing defaults to 20

`app/api/engineering/sld/route.ts:559`

- **Upstream produced:** `(SELECT lo.total_panels FROM layouts lo WHERE lo.project_id = p.id ORDER BY lo.updated_at DESC LIMIT 1) AS total_panels` (lib/electrical/loadElectricalProject.ts:157), composed onto the model as `moduleCount` (loadElectricalProject.ts:212, projectModel.ts:667, projectModel.ts:190).
- **Downstream used instead:** `const totalModules = Number(body.totalModules) || 20;` — the canonical `_loaded.model.moduleCount` is never projected onto `body.totalModules`, unlike mainPanelAmps (route.ts:218), batteryCount (258) and the interconnection (234-236). The PDF route is worse: `totalModules: Number(buildInput.totalModules) || 20` and `totalStrings: Number(buildInput.totalStrings) || 2` (pdf/route.ts:345-346).
- **Consequence:** A request that omits or zeroes totalModules draws a 20-module array, and totalModules then drives totalDcKw (renderer:4271), the subtitle (renderer:4290), the MODULES title-block row (6484), the EQUIPMENT SCHEDULE 'Total Modules' row (6053/6082), computeSystem's totalPanels (route.ts:1028) and the micro device count (renderer:4428). The project's real array quantity sits in the row the route already read.

##### 13.5.7 — [CRITICAL] A microinverter system's EGC is hard-coded #10 AWG, because the model's EGC comes only from the DC string run

`lib/plan-set/permit-system-model.ts:146`

- **Upstream produced:** computeSystem emits the micro AC feeder as COMBINER_TO_DISCO_RUN / BRANCH_RUN with its own NEC 250.122 `egcGauge` (lib/computed-system.ts:1841 for BRANCH_RUN; a micro system emits NO DC_STRING_RUN — that id is created only in the string branch, computed-system.ts:2019).
- **Downstream used instead:** `const egcGauge = dcRun?.egcGauge ?? '#10 AWG';` where `dcRun = cs.runMap?.['DC_STRING_RUN'] ?? cs.runs?.find(r => r.id === 'DC_STRING_RUN')` (permit-system-model.ts:133). Micro ⇒ dcRun undefined ⇒ '#10 AWG'. That literal then becomes `resolvedEgcGauge = systemModel?.egcGauge ?? '#8 AWG'` (route.ts:1152) → `input.egcGauge`, and at renderer:4224 `input.egcGauge ?? dcStringRun?.egcGauge ?? acFeederRun?.egcGauge` the literal WINS over the feeder's real EGC.
- **Consequence:** Every microinverter SLD prints a #10 AWG equipment grounding conductor on the feeder callouts (renderer:6277-6278), the conduit schedule and the 'System EGC' row (renderer:8764), regardless of the feeder OCPD. A 100 A micro feeder needs #8 under NEC 250.122; the sheet says #10, and the error is in the unsafe direction.

##### 13.5.8 — [CRITICAL] BRANCH_RUN is read into a variable and never used, so no micro AC conductor can reach the model

`lib/plan-set/permit-system-model.ts:137`

- **Upstream produced:** `makeRunSegment('BRANCH_RUN', 'BRANCH RUN (AC Trunk)', 'MICROINVERTERS', 'AC COMBINER', {...})` with wireGauge, egcGauge, ocpdAmps, ampacity and pass/fail (lib/computed-system.ts:1841).
- **Downstream used instead:** `const branchRun = cs.runMap?.['BRANCH_RUN'] ?? cs.runs?.find(r => r.id === 'BRANCH_RUN');` — declared and then referenced NOWHERE else in the file. The AC lookup at 134-136 tries only DISCO_TO_METER_RUN, INV_TO_DISCO_RUN and COMBINER_TO_DISCO_RUN, so `acWireGauge = acRun?.wireGauge ?? '#8 AWG'` (145) and `acBranchOcpdAmps: cs.acBranchOcpdAmps ?? 0` are all the model has.
- **Consequence:** The engine's branch-circuit conductor and its NEC verdict are computed and thrown away on every micro job, and the model's acWireGauge silently becomes the literal '#8 AWG' whenever none of the three named AC runs exists.

##### 13.5.9 — [CRITICAL] The AC OCPD becomes the DC string OCPD when there are no strings

`lib/plan-set/permit-system-model.ts:168`

- **Upstream produced:** cs.strings[].ocpdAmps — the NEC 690.8(B) string OCPD; and cs.acOcpdAmps — the NEC 690.8 AC output OCPD. Two different quantities on two different circuits.
- **Downstream used instead:** `const stringOcpdAmps = firstString?.ocpdAmps ?? cs.acOcpdAmps ?? 20;` and then `dcOcpdAmps: dcRun?.ocpdAmps ?? stringOcpdAmps` (239). On micro (cs.strings empty) stringOcpdAmps silently becomes the whole system's AC OCPD — e.g. 60 A reported as a DC string OCPD.
- **Consequence:** PermitSystemModel.stringOcpdAmps and dcOcpdAmps carry an AC feeder rating labelled as a DC overcurrent device. The SVG route masks it with `isMicro ? 0 : ...` (route.ts:1153, 1300), so the defect is invisible there and live for any other consumer of the same model — and the model is documented as the one place sheets may read NEC values from.

##### 13.5.10 — [CRITICAL] A missing DC run makes the ampacity check PASS and invents 30 A of ampacity

`lib/plan-set/permit-system-model.ts:241`

- **Upstream produced:** `dcRun.effectiveAmpacity` and `dcRun.ampacityPass` — the engine's derated-ampacity verdict on the DC string run (lib/computed-system.ts:2019-2033).
- **Downstream used instead:** `dcAmpacity: dcRun?.effectiveAmpacity ?? 30,` / `dcAmpacityPass: dcRun?.ampacityPass ?? true,`
- **Consequence:** Absence of the run is reported as a passing ampacity check with a fabricated 30 A. Ray's own law in this repo is 'No physical path → no conductor run → no engineering check → no FAIL row' (route.ts:991) — this is the mirror-image failure: no run, no check, and a PASS printed anyway. Same class at renderer:6223 `pass:r.overallPass??true`.

##### 13.5.11 — [CRITICAL] A supply-side tap forces interconnectionPass true, discarding the engine's conclusion

`lib/plan-set/permit-system-model.ts:250`

- **Upstream produced:** `cs.interconnectionPass`, which already handles the supply-side case itself: `_isSupplySideTap ? true : ...` (lib/computed-system.ts:1690-1691), and which is deliberately FALSE with an attached `interconnectionRefusal` when the method is unresolved (computed-system.ts:1688-1689).
- **Downstream used instead:** `interconnectionPass: isSupplySide ? true : cs.interconnectionPass,` where `isSupplySide = interconRaw.toUpperCase().includes('SUPPLY')` and `interconRaw = overrides?.interconnectionMethod ?? 'load-side'` (157-158) — a string match on an override, overriding the engine.
- **Consequence:** The model's own 705.12(B) field can report PASS for a reason the engine did not conclude, and the `?? 'load-side'` default assigns the 120% article to a project whose POI nobody classified — exactly what interconnectionMethodScalar (loadElectricalProject.ts:252-301) exists to refuse.

##### 13.5.12 — [CRITICAL] The page's engineered string count and per-string panel counts are posted and ignored; the route re-derives the layout

`app/api/engineering/sld/route.ts:880`

- **Upstream produced:** app/engineering/page.tsx:7237 posts `totalStrings: cs.isString ? cs.stringCount : ...`, and the page's computeSystem was given the real layout: `totalStrings: fleet.reduce((s, inv) => s + inv.strings.length, 0)` (page.tsx:3567-3569) and `configStringPanelCounts: fleet.flatMap(inv => inv.strings.map(s => s.panelCount))` (page.tsx:3573-3575).
- **Downstream used instead:** `const resolvedTotalStrings = !isMicro ? (layoutStrings ? layoutStrings.length : (stringResult?.totalStrings ?? 1)) : 0;` — from sizeSystemFromBrand (route.ts:649) or the route's own generateStringConfig (route.ts:829). `body.totalStrings` is read at exactly one place in the file, the multi-lane branch (route.ts:439), and `configStringPanelCounts` does not appear in either SLD route at all.
- **Consequence:** The installer's applied string configuration is replaced by a physics re-derivation, and resolvedTotalStrings is then fed back into computeSystem as `totalStrings` (route.ts:1031) — so the drawing's Voc checks, conductor counts and 'Number of Strings' row describe a layout the engineering page does not show. This is the same defect page.txt:3562-3566 fixed on the page side ('the UI SLD display shows a different string count than the user's applied configuration').

##### 13.5.13 — [CRITICAL] The catalogue datasheet's single-unit backfeed overrides the graph's recorded busbar contribution of zero

`app/api/engineering/sld/route.ts:968`

- **Upstream produced:** route.ts:340-343 sets `body.batteryBackfeedA = 0` with the log 'storage backfeed on the service panel busbar = 0 — every system lands in its own generation panel, which feeds its gateway', and route.ts:344-348 sets the graph's recorded fleet SUM `_units.reduce((n, u) => n + (u.ocpdA as number), 0)`.
- **Downstream used instead:** `const _batBackfeedA = _batSpec?.backfeedBreakerA ?? (body.batteryBackfeedA ? Number(body.batteryBackfeedA) : undefined);` where `_batSpec = getBatteryById(body.batteryId)` (route.ts:949). The catalogue value is FIRST, so it wins; and even on the fallback arm the graph's `0` is falsy and becomes undefined.
- **Consequence:** _batBackfeedA goes into computeSystem (route.ts:1089) and onto the sheet (route.ts:1211, renderer:6076 'Batt. Backfeed … NEC 705.12(B)'). On a 400 A / two-gateway job whose storage lands in DER aggregation panels the graph says nothing of the storage reaches the MSP busbar; the sheet instead loads the busbar with one Powerwall's 60 A datasheet breaker — a per-unit catalogue number standing in for a recorded fleet connection, changing the 120% row on a permit drawing.

##### 13.5.14 — [CRITICAL] The micro branch count handed to the engine is always NaN — Number() of an array

`app/api/engineering/sld/route.ts:1084`

- **Upstream produced:** app/engineering/page.tsx:7413 posts `microBranches: cs.isMicro ? cs.microBranches : undefined` — the engine's branch PLAN, an array of MicroBranch objects with deviceCount, ocpdAmps and conductorCallout.
- **Downstream used instead:** `branchCount: isMicro ? (Number(body.microBranches) || Number(body.branchCount) || undefined) : undefined,` — `Number([{...},{...}])` is NaN, which is falsy; `body.branchCount` is never posted by page.tsx. The expression evaluates to undefined on every real request. The intent was plainly `.length` (compare route.ts:901 `Array.isArray(body.microBranches) ? body.microBranches.length : 0`).
- **Consequence:** computeSystem re-derives the branch count from scratch on every SLD request instead of consuming the plan the page already computed, so the drawing's branch circuits can differ from the sidebar's. The renderer then adds a third answer: `input.microBranches?.length ?? microBranchCount(md, input.inverterModel)` (renderer:4528, 4629, 5754, 6055) — and the route only forwards microBranches when ITS OWN isMicro is true (route.ts:1230), which the topology override at route.ts:714-719 can turn on for a request that posted no branches at all.

##### 13.5.15 — [CRITICAL] The EQUIPMENT SCHEDULE still multiplies strings × panels-per-string, reproducing the 37-modules-printed-as-40 defect

`lib/sld-professional-renderer.ts:6049`

- **Upstream produced:** `stringPanelCounts` — 'THE ACTUAL MODULE COUNT OF EVERY STRING, in order… When this is present it is the layout' (renderer:507-517), built by app/api/engineering/sld/route.ts:847-849 / 859-860 and passed at route.ts:1244.
- **Downstream used instead:** `const pp2 = input.panelsPerString ?? Math.round(input.totalModules/Math.max(input.totalStrings,1));` then `['Strings',`${input.totalStrings} × ${pp2} panels`]` (6083). `stringPanelCounts` is read at exactly ONE place in the renderer, the PV array box (4462-4463). The DC SYSTEM CALCULATIONS panel repeats the lossy pair at 5806 and prints it at 5832.
- **Consequence:** On Ray's 10/9/9/9 array the PV array box correctly reads '4 STRINGS — 10/9/9/9 MODULES' while the EQUIPMENT SCHEDULE on the same sheet reads 'Strings 4 × 10 panels' — 40 modules, three panels more than the 'Total Modules 37' row directly above it. The repair at 4449-4470 landed on one of three readers.

##### 13.5.16 — [CRITICAL] The hybrid multi-lane path takes the entire per-lane architecture from the request body with no canonical override

`app/api/engineering/sld/route.ts:392`

- **Upstream produced:** `_canonicalCoupling = _model.solarCoupling` (route.ts:325), plus the per-field projections of serviceRatedAmps, batteryCount, batteryBackfeedA, the DC input window and the inverter identity (route.ts:197-349).
- **Downstream used instead:** `const _sources = sanitizeClientSourceBranches(body.sources);` — which validates types only and preserves `topologyType`, `inverterManufacturer`, `inverterModel`, `inverterCount`, `totalModules`, `totalStrings`, `panelsPerString`, `acOCPD`, `backfeedAmps`, `dcOCPD`, `egcGauge`, `optimizerQty`, `combinerLabel`, `deviceCount`, `microBranches` and `runs` per lane (lib/permit/utils/sldAdapter.ts:837-874). `_canonicalCoupling` is never referenced inside the multi-lane block (391-513), and the block RETURNS at 493/502 before computeSystem (1117) or buildPermitSystemModel (1121) ever run.
- **Consequence:** A hybrid project's architecture, equipment and quantities are 100% whatever the browser posted — no engine pass, no PermitSystemModel, no DC string-limit substitution, no rooftop-adder or thermal-basis gate. `mainPanelAmps: Number(body.mainPanelAmps) || 200` (457) and `interconnection: ... ?? 'LOAD_SIDE'` (463) also sit in this path. The route's own header claims 'computeSystem() is called ONCE. All electrical values come from the engine' (route.ts:9-11); for a hybrid it is called zero times.

##### 13.5.17 — [CRITICAL] 'POWERWALL 3' is hard-coded as the name of every DC-coupled storage product

`lib/sld-professional-renderer.ts:4282`

- **Upstream produced:** `input.serviceTopology.storage[]` carries each unit's real `label`/`productId` — the renderer itself uses them two lines away (`${ids.length} × ${set[0]}` at renderer:2930, `_tbInverting[0]?.label` at 6488).
- **Downstream used instead:** `const _archLabel = _couplingIsDc ? 'PV DC COUPLED TO POWERWALL 3' : ...` — repeated verbatim in the title block (`['TOPOLOGY', _tbDc ? 'PV DC COUPLED TO POWERWALL 3' : ...]`, 6470) and in the schedule overlay (`replace('Microinverters', [['PV Coupling', 'DC — to Powerwall 3 PV inputs']])`, 2979).
- **Consequence:** The two places a plan reviewer reads first — the sheet subtitle and the title block TOPOLOGY row — name a Tesla Powerwall 3 on any DC-coupled design, including a SolarEdge Energy Hub, FranklinWH, EG4 or Sol-Ark job. The device's real label is in scope and used elsewhere on the same sheet.

##### 13.5.18 — [CRITICAL] The sheet is corrected at render time rather than built correctly: already-built rows and already-computed runs are deleted

`lib/sld-professional-renderer.ts:2951`

- **Upstream produced:** On a project with a service graph, route.ts:276-299 already overwrote topologyType and deleted the inverter identity, and the model already knows the coupling (projectModel.ts:340-526).
- **Downstream used instead:** `const replace = (label: string, next: [string, string][]) => { const i = out.findIndex(r => r[0] === label); if (i < 0) return; out.splice(i, 1, ...next); };` — then 20 calls deleting rows by their English LABEL: `replace('Microinverters', …)`, `replace('Branch Circuits', [])`, `replace('Inverter Mfr.', [])`, `replace('AC Combiner', [])`, `replace('DC Disconnect', [])`, `replace('Bus Rating', [])`, `replace('Batt. Backfeed', [])` (2957-3034). Matched with `_scheduleExcluded = new Set([... (_couplingIsDc ? ['DC_DISCO_TO_INV_RUN','INV_TO_DISCO_RUN','DISCO_TO_METER_RUN'] : [])])` (6189-6192), which filters engine runs the engine was just asked to compute, and `const isMicro = !_couplingIsDc && (...)` (4156), which cancels a micro path after it was chosen.
- **Consequence:** Correctness depends on a string label matching and on every future row being remembered — the comment at 2991-2998 records exactly that failure ('This block already removed the AC one and left "DC Disconnect — 25A Fused" standing one line away'). The route's own response field documents why this is forbidden: 'the RENDERER also suppresses the inverter — which is precisely the "suppress it downstream" pattern Ray forbade' (route.ts:1366-1368). Three suppression layers, each discoverable only by reading a finished sheet.

##### 13.5.19 — [CRITICAL] The renderer sizes EGCs, conductors and OCPDs itself instead of consuming them

`lib/sld-professional-renderer.ts:8764`

- **Upstream produced:** systemModel.egcGauge / acWireGauge / acOcpdAmps / backfeedBreakerAmps from the engine's NEC 250.122 and 690.8 passes (permit-system-model.ts:242-253), flattened at route.ts:1148-1152.
- **Downstream used instead:** `['System EGC', input.egcGauge ?? getEGCSize(sysDiscoA)]` — plus `getEGCSize(...)` at 7642, 7732, 7873, 7902, 7924, 7948, 7968, 8112, 8210; `wireGaugeForOcpd(...)` at 7271, 7430, 7481, 7495, 7636, 8205; `necNextStandardOcpd(...)` at 5767, 6650, 6964, 7267; `resolveAcDisconnect({requiredAmps: ocpd, targetAmps: ocpd, fused: fusedTapOcpd})` at 2347; `sizeAggregationPanel(t, agg)` at 3388 and 3735.
- **Consequence:** The sheet carries NEC-sized conductors and grounding conductors the engine never produced and the BOM therefore never buys. The hybrid lanes are entirely in this regime (7271-7990), because that path never runs the engine at all.

##### 13.5.20 — [CRITICAL] The degraded conductor schedule fabricates rows and stamps them PASS

`lib/sld-professional-renderer.ts:6295`

- **Upstream produced:** computeSystem's RunSegment list with real conduitFillPct, continuousCurrent, voltageDropPct, onewayLengthFt and overallPass (lib/computed-system.ts:1797-2033).
- **Downstream used instead:** When `input.runs` is empty the renderer hand-builds the table: `{id:'D-1',from:'PV ARRAY',to:'ROOF J-BOX',conductors:`${resolvedDcWire} USE-2 + 1×#${egcNum} GRN`,conduit:'OPEN AIR',fill:0,amp:0,ocpd:input.dcOCPD,vdrop:0,len:0,pass:true}` and five siblings (6295-6303), plus `conduit:`${input.dcConduitType??'EMT'} 3/4"`` (6296, 6301), `ocpd: input.branchOcpdAmps ?? 20` (6256, 6266) and `pass: true` on every fabricated row (6250, 6256, 6266).
- **Consequence:** A CONDUIT & CONDUCTOR SCHEDULE headed 'NEC 310 / NEC CHAPTER 9 TABLE 1' (6128) prints run ids, a 3/4" raceway, 0 ft lengths, 0% fill, 0% voltage drop and a PASS column for circuits nothing sized. The comment at 6227-6230 records that the canned numbers were removed because 'an AHJ could (and did) try to reproduce' them; the PASS column and the 3/4" literal survived.

##### 13.5.21 — [MAJOR] The multi-source sheet refers the reviewer to a 'STORAGE SINGLE-LINE' that this path never produces

`lib/sld-professional-renderer.ts:8310`

- **Upstream produced:** `renderTopologyServiceSection` — the only renderer of the full service graph — is called at exactly one place, renderer:5340, inside the SINGLE-LANE sheet.
- **Downstream used instead:** `NOTE: THIS SHEET DRAWS ${drawn.label.toUpperCase()} AND THE PV SOURCES. THE ${serviceRatingLabelSld(t)} SERVICE TOPOLOGY IS DRAWN IN FULL ON THE STORAGE SINGLE-LINE AND LISTED IN THE SERVICE EQUIPMENT SCHEDULE.`
- **Consequence:** On a hybrid project with a service graph, the one sheet the Diagram tab and the PDF export produce tells a plan reviewer that the panelboards, the backup controllers and the utility isolation switches it is NOT drawing appear on another drawing. No such drawing exists on either path.

##### 13.5.22 — [MAJOR] The multi-lane sheet draws the battery from the legacy scalars while holding the graph that supersedes them

`lib/sld-professional-renderer.ts:8175`

- **Upstream produced:** `input.serviceTopology.storage[]` with role, label, ocpdA, continuousOutputA and usable kWh — read three lines earlier for the panel rating (`_mlPanelAmps = _mlPanel?.busbarRatingA ?? input.mainPanelAmps`, 8155) and used by the schedule overlay to replace the battery block wholesale (2919, 3025-3032).
- **Downstream used instead:** `if (input.hasBattery) { … renderBattery(xBUI, batCY, batModel, input.batteryKwh ?? 0, input.batteryBackfeedA ?? 0, …) }` with `const batModel = input.batteryModel || (input.batteryKwh ? `${input.batteryKwh} kWh Battery` : 'BATTERY STORAGE')` (8189) and `input.atsAmpRating ?? 200` for the backup interface (8181).
- **Consequence:** The hybrid drawing shows one generic battery sized from the posted scalars while the equipment schedule beside it lists the graph's real units — the contradiction the comment at 3018-3024 says the schedule overlay was written to end ('a project carrying two Powerwalls in its service graph and hasBattery: false in its scalars'). Only the schedule was fixed; the drawing was not.

##### 13.5.23 — [MAJOR] The renderer recomputes total DC kW from the module count instead of using the engine's

`lib/sld-professional-renderer.ts:4271`

- **Upstream produced:** `cs.totalDcKw` → `systemModel.totalDcKw` (permit-system-model.ts:222), and `stringResult.totalDcPower` which the route itself uses for the DC/AC ratio (route.ts:1301).
- **Downstream used instead:** `const dcKw = input.totalModules * input.panelWatts / 1000;` — used for the DC SIZE title-block row (6471), 'Total DC Power' in both calculation panels (5786, 5839) and the DC/AC ratio fallback `calcDcAcRatio(dcKw, input.acOutputKw)` (5825).
- **Consequence:** The sheet's system size is derived from two scalars that each have literal fallbacks (`totalModules || 20` at route.ts:559, `panelWatts || 400` at 564), so a request missing either prints 8.00 kW DC rather than the engine's figure, and the DC/AC ratio printed beside it is computed from that number.

##### 13.5.24 — [MAJOR] The engine's own thermal and string results are bypassed for the route's second derivation

`app/api/engineering/sld/route.ts:1247`

- **Upstream produced:** `cs.strings[0].vocCorrected` / `.stringVmp` / `.tempCorrectionFactor` and `cs.dcAcRatio`, surfaced as systemModel.vocCorrected (permit-system-model.ts:229), stringVmp (166), tempCorrectionFactor (230) and dcAcRatio (224).
- **Downstream used instead:** `vocCorrected: stringResult?.vocCorrected,` / `stringVmp: stringResult ? (stringResult.strings[0]?.stringVmp ?? …) : undefined,` / `dcAcRatio: isMicro ? undefined : (stringResult ? calcDcAcRatio(stringResult.totalDcPower / 1000, acOutputKw) : undefined)` (route.ts:1248-1301) — all from the route's own `generateStringConfig` call (route.ts:829), which was given a DIFFERENT string count than computeSystem (compare route.ts:830 `totalModules` with route.ts:1031 `resolvedTotalStrings`) and a different inverter spec set.
- **Consequence:** The 'Voc Corrected' and 'String Voc × 1.25' rows the AHJ reads under the NEC 690.7 heading (renderer:5831, 5835) come from the route's second string generator, not from the engine whose runs are printed in the conduit schedule on the same sheet. One sheet, two derivations of the same correction.

##### 13.5.25 — [MAJOR] The engine's validation summary never reaches the sheet

`lib/plan-set/permit-system-model.ts:263`

- **Upstream produced:** `issuesSummary: (cs.issues ?? []).filter(i => i.severity !== 'info').map(i => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`)` (206-208), plus isValid/errorCount/warningCount (260-262) — the field's own comment says 'human-readable for C-1 sheet' (108).
- **Downstream used instead:** Nothing. `systemModel` is unread in the renderer (renderer:649), and the route copies only numbers out of it (route.ts:1148-1155). The only warnings the sheet can show are `stringConfigWarnings: stringResult?.warnings` (route.ts:1302) — the route's OTHER string generator's warnings.
- **Consequence:** INTERCONNECTION_METHOD_UNRESOLVED and every other engine error is logged server-side (computed-system.ts:1677) and omitted from the drawing. A sheet generated from a design the engine marked invalid looks identical to one generated from a valid design.

##### 13.5.26 — [MAJOR] mainPanelAmps still falls back to a fabricated 200 A in all three input builders

`app/api/engineering/sld/route.ts:1191`

- **Upstream produced:** `body.mainPanelAmps = _model.serviceRatedAmps` when and only when the graph records a rating (route.ts:211-219); with no recorded rating the route deliberately projects nothing so that `serviceRatingLabel` prints 'SERVICE RATING REQUIRED' (route.ts:208-210).
- **Downstream used instead:** `mainPanelAmps: Number(body.mainPanelAmps) || 200,` — repeated at route.ts:457 (multi-lane), route.ts:1080/1082/1122/1123 (into computeSystem and the model) and pdf/route.ts:363. route.ts:993-996 already identifies this as the live hazard ('Projecting the graph's service rating onto mainPanelAmps means that fallback now fires on every project with a service graph').
- **Consequence:** A project with no service graph draws a 200 A service, a 200 A main breaker and a 240 A busbar allowance it was never measured for; those three numbers then drive the 120% row the renderer re-decides at 6014. The honest 'SERVICE RATING REQUIRED' outcome is only reachable through the serviceTopology branch (renderer:6492).

##### 13.5.27 — [MAJOR] The PDF route's battery gate omits two of the four fields the SVG route checks, and never forwards batteryCount

`app/api/engineering/sld/pdf/route.ts:384`

- **Upstream produced:** app/api/engineering/sld/route.ts:1206 `hasBattery: !!(body.hasBattery || body.batteryModel || body.batteryKwh || body.batteryBrand || (body.batteryCount && Number(body.batteryCount) > 0))`, with batteryCount itself projected from the graph at route.ts:258 and forwarded at route.ts:1210.
- **Downstream used instead:** `hasBattery: !!(buildInput.hasBattery || buildInput.batteryModel || buildInput.batteryKwh),` — and the object has no `batteryCount` key at all (compare 385-395), nor `batteryBrand`, `generatorBrand/Model/Kw`, `atsBrand/Model/AmpRating`, `hasBackupPanel`, `backupInterface*`, `hasEnphaseIQSC3`, `egcGauge`, `stringPanelCounts`, `systemModel`, `combinerSelectionIsDecided` for lanes, or `serviceTopology`-derived storage.
- **Consequence:** A project carrying storage only in its service graph exports a PDF whose equipment schedule says 'Battery Storage NONE' and whose diagram draws no battery, while the Diagram tab for the same project draws it. The exported sheet is also missing the generator, ATS, backup panel and backup interface rows the on-screen sheet prints.

##### 13.5.28 — [MAJOR] The saved SLD file carries no electrical revision, so a stored drawing can never be shown stale

`app/api/engineering/save-outputs/route.ts:184`

- **Upstream produced:** `body.electricalRevision = _loaded.revision` (route.ts:357), returned as `electricalRevision` in the JSON body (route.ts:1358) and as the `X-Electrical-Revision` header (route.ts:1339-1341), with the rule quoted at route.ts:1351-1354 ('the UI must identify the drawing as stale rather than silently presenting it as current').
- **Downstream used instead:** `content: sldSvg,` — the upsertFile call writes the SVG into project_files with fileName/fileType/mimeType/notes and no revision column. On the client the revision lives only in `_sldRevisionRef.current` (page.tsx:7446, 7453) and `setSldRevision` (7499), both session state.
- **Consequence:** A reload, a new tab or any other consumer that reads the stored SLD_<name>.svg has no way to compare it against the project's live electrical revision, so `sldFreshness` (page.tsx:3192) can only ever answer for a drawing generated in the current session. The revision is computed, transmitted twice and dropped at the only place the drawing is durable.

##### 13.5.29 — [MINOR] The combiner falls back to a literal device name when nothing resolved

`lib/sld-professional-renderer.ts:6063`

- **Upstream produced:** `_bosLabel` from `planLandingDevice(_bosPlan)` with `_bosPlan` from the shared `resolveIntegratedEquipment` resolver, and `combinerSelectionIsDecided: combinerBasisIsDecided(_bosPlan.combinerBasis ?? 'unresolved-default')` (route.ts:930-931, 1274).
- **Downstream used instead:** `['AC Combiner',combinerScheduleCell(esc(input.combinerLabel??'IQ Combiner'), input.combinerSelectionIsDecided)]` — and the diagram label `combinerLabel: isMicro ? (_bosLabel ?? 'IQ Combiner') : stringResult?.combinerLabel` (route.ts:1261). The string path's fallback is `esc(input.combinerLabel??(input.combinerType??'Direct'))` (renderer:6089).
- **Consequence:** A micro design whose combiner nothing resolved is labelled 'IQ Combiner' — a brand-family name with no model — in both the diagram nameplate and the equipment schedule. The '⚠ NOT SELECTED' qualifier only attaches when combinerSelectionIsDecided is explicitly false, and the PDF route's hybrid path never computes it per lane (pdf/route.ts:432-433 passes only the ids).

##### 13.5.30 — [MINOR] Three response headers and seven JSON fields built to prove the engine ran have no readers

`app/api/engineering/sld/route.ts:1329`

- **Upstream produced:** `'X-System-Model': systemModel ? 'computed' : 'fallback'`, `'X-Layout-Source'`, `'X-Sld-Degraded'` (1329-1331) and `architecture{}` (1371-1379), `layoutSource`, `sldDegraded`, `topology`, `stringConfig`, `microConfig`, `resolvedValues` (1381-1416).
- **Downstream used instead:** app/engineering/page.tsx:7441-7455 reads exactly two things: `res.headers.get('X-Electrical-Revision')` and `data.svg` / `data.electricalRevision`. No production reader exists for the rest.
- **Consequence:** Whether a given sheet was drawn from the engine or from a degraded body fallback is observable only in the server log. The `architecture{}` block was added specifically to make Rule Eleven 'testable, and… a disagreement visible to any caller instead of only to the server log' (route.ts:1366-1370) — no caller looks at it.

---

### 13.6 BOM / PERMIT / PRICING

*31 breaks — 7 verified by a refuter.*

#### What this stage is

This stage is four CONSUMERS that are supposed to read the engineered result and instead re-assemble it: /api/engineering/bom (the only one that actually consults the canonical model), /api/engineering/permit → lib/permit/generatePermit.ts → lib/permit/snapshot/build.ts (the sealed package), /api/engineering/save-outputs (the archived BOM_*.csv a purchaser opens), and the pricing chain (lib/pricingEngine.ts for estimates, lib/proposal/buildCanonicalProposal.ts for the customer price). The BOM route is the mature one: it calls loadElectricalProject (route.ts:193), refuses an unresolved architecture (route.ts:201-206), projects the graph's battery count and service rating onto the posted scalars (route.ts:219, 244), projects interconnectionMethodScalar (route.ts:264), adds bomFromServiceTopology lines and runs reconcileQuantities (route.ts:623, 678) — and still takes module count, string count, inverter identity, panel id, racking id, attachment count and every wire length straight off the HTTP body with literal defaults. The PERMIT route loads the same canonical model (route.ts:795) and consumes only three things from it: interconnectionMethod (route.ts:819), the graph object onto body.project.serviceTopology (route.ts:845), and electricalRevision (route.ts:850) — it never projects serviceRatedAmps, never projects storage.invertingUnitCount, never projects externalInverterId, and lib/permit/snapshot/build.ts contains ZERO references to proj.serviceTopology or electricalRevision, so the graph is absent from the snapshot and from its SHA-256 digest while a sheet (structuralPages.ts:1523) renders directly from it. Pricing is the cleanest break of all: lib/proposal/buildCanonicalProposal.ts:639 prices the job as storedCashPrice or systemSizeKw × $/W, there is not one reference to a battery, gateway, inverter or BOM cost anywhere in lib/proposal/, and the BOM's own priced totalBomCost (bom/route.ts:1044) has no consumer outside the Engineering page's own cards.

#### Data in

| Field | Where it comes from |
|---|---|
| `model (ElectricalProjectModel: topology, solarCoupling, externalInverterId, serviceRatedAmps, storage.*, moduleCount, conflicts) + revision` | lib/electrical/loadElectricalProject.ts:148 loadElectricalProject — called by app/api/engineering/bom/route.ts:193 and app/api/engineering/permit/route.ts:795. Reads projects.service_topology, projects.selected_equipment, projects.engineering_config and layouts.total_panels in one statement (loadElectricalProject.ts:153-165) |
| `body.moduleCount / body.totalPanels` | HTTP request body — app/engineering/page.tsx:7719 posts `systemPanelCount > 0 ? systemPanelCount : totalPanels` (client React state); read at app/api/engineering/bom/route.ts:395 |
| `body.stringCount` | HTTP request body — app/engineering/page.tsx:7726 `sizingRecommendation?.strings?.length ?? config.inverters.reduce(...)` (engineering_config.inverters[].strings[]); read at app/api/engineering/bom/route.ts:400 |
| `body.inverterId / body.optimizerId` | HTTP request body — app/engineering/page.tsx:7691-7699; read at app/api/engineering/bom/route.ts:316 |
| `body.panelId` | HTTP request body — app/engineering/page.tsx:7712-7714; read at app/api/engineering/bom/route.ts:394 |
| `body.rackingId / body.mountingSystemId / roofData.mountingSystemId` | HTTP request body — app/engineering/page.tsx:7651-7653; read at app/api/engineering/bom/route.ts:387-391 |
| `body.mainPanelAmps / body.panelBusRating` | projects.engineering_config.mainPanelAmps via app/engineering/page.tsx:7797 and 7823; read at app/api/engineering/bom/route.ts:504, 531 — overwritten from the graph at route.ts:244 only when _m.topology exists AND _m.serviceRatedAmps !== null |
| `body.batteryCount / body.batteryId` | projects.engineering_config.batteryCount via app/engineering/page.tsx:7803; overwritten from the graph at app/api/engineering/bom/route.ts:219 (`body.batteryCount = _canonical`) |
| `body.interconnectionMethod` | projects.engineering_config.interconnectionMethod via app/engineering/page.tsx:7821 (`?? 'LOAD_SIDE'`); overwritten from the graph at app/api/engineering/bom/route.ts:264 only when interconnectionMethodScalar returns non-null |
| `body.selectedCombinerId` | projects.selected_equipment.combinerSelection, re-read server-side via lib/combinerSelection/storedRead at app/api/engineering/bom/route.ts:294 and app/api/engineering/permit/route.ts:484 |
| `distributor_prices rows (part_number, category, unit_cost)` | Neon table distributor_prices — app/api/engineering/bom/route.ts:926-933 |
| `PermitInput.system.totalPanels / totalDcKw / totalAcKw / inverters[] / topology` | HTTP request body — app/engineering/page.tsx:9073-9107; guarded for 0 only at app/api/engineering/permit/route.ts:696 |
| `PermitInput.project.mainPanelAmps / panelBusRating / interconnectionMethod / batteryCount / batteryBackfeedA` | projects.engineering_config via app/engineering/page.tsx:8963, 9000, 8995, 9022, 9024 |
| `projects.engineering_config.inverters (backfill) then layouts.design_electrical.strings (backfill)` | app/api/engineering/permit/route.ts:934-936 and 944-948; gated by the canonical coupling at route.ts:918-927 |
| `projects.engineering_config.subSystems (hybrid self-heal)` | app/api/engineering/permit/route.ts:990-995 |
| `project_physical_data (panel_rating_amps, busbar_rating_amps, interconnection_point, …)` | app/api/engineering/permit/route.ts:1325-1342 → lib/siteSurvey/permitIntegration; mainPanelAmps/panelBusRating/interconnectionMethod reported but NOT applied (route.ts:1415-1421) |
| `projects.canonical_snapshot` | app/api/engineering/permit/route.ts:558-566 via checkPipelineGuard — log only, never blocks (route.ts:567-574) |
| `CADModel (cad.totalPanels, cad.totalDcKw, cad.hybrid.sections)` | lib/cad/canonicalBridge canonicalToCADInputs; consumed at lib/permit/utils/bomForPermit.ts:561-562, 288-289 |
| `input.panelCount, input.layoutSystemSizeKw, input.storedCashPrice, input.*PricePerWatt` | proposals.data_json / projects.cost_estimate via app/api/proposals/[id]/pdf/route.ts:233, app/proposals/page.tsx:1488 → lib/proposal/buildCanonicalProposal.ts:344-348, 639 |
| `layout.panels[] / layout.systemSizeKw` | layouts row via app/api/production/route.ts:250, 309, 553, 628 → calculateItemizedPrice / calculateFinalPrice |
| `pricing_config row` | lib/db/pricing.ts rowToPricingConfig → lib/pricingEngine.ts:159; falls back to lib/pricingEngine.ts:111 DEFAULT_CONFIG |

#### What it calculates

- BOM route: corrects body.batteryCount to _m.storage.invertingUnitCount (route.ts:213-219), body.mainPanelAmps to _m.serviceRatedAmps (route.ts:237-244), body.interconnectionMethod to interconnectionMethodScalar (route.ts:257-264); refuses 409 on an unresolved architecture (route.ts:201-206)
- BOM route: caps inverterCount against physical maxima — ceil(modules/25) for optimizer topology, ceil(strings/2) for string topology (route.ts:414-469)
- BOM route: derives acWireGauge from acOCPD when the client sends none (route.ts:474-481)
- generateBOMV4: the whole electrical BOM — stages 1-6, conductors, conduit, OCPD, labels; evaluates NEC 705.12(B) with busRating = panelBusRating ?? mainPanelAmps ?? 200 and mainBreakerA = mainPanelAmps ?? 200 (lib/bom-engine-v4.ts:1910-1957, 3303-3337), subtracting resolveBatteryBranch's busbar contribution
- BOM route: folds bomFromServiceTopology lines into the V4 result by manufacturer|model identity, letting the graph's instance count overwrite the engine's quantity (route.ts:641-667), then runs reconcileQuantities and reports disagreements (route.ts:678)
- BOM route: derives panelWattage = round(systemKw*1000/moduleCount) (default 400) and re-runs sizeSystemFromBrand — a SECOND brand/topology derivation from body.inverterId (route.ts:772-787)
- BOM route: deriveStructuralBOMForSubsystems for fence/ground/hybrid partitions (route.ts:707-714), then injectStructuralIntoV4 with V4_OWNED_CATEGORIES dedup (route.ts:85-143)
- applyDistributorPricing: stamps unitCost/totalCost per line — DB override → static catalog → CATEGORY_FALLBACK_PRICES → zero (lib/bom/distributorPricing.ts:808-847, 864-924)
- Permit route: projects interconnectionMethodScalar onto project.interconnectionMethod (route.ts:810-821); writes the canonical graph (plus canonicalizationPatch) onto body.project.serviceTopology (route.ts:845-847); writes electricalRevision (route.ts:850); refuses 409 on architectureRefusal (route.ts:830-836) and on any model conflict (route.ts:878-891)
- Permit route: backfills system.inverters from engineering_config then layouts.design_electrical, SKIPPED when the canonical coupling is dc-coupled-storage or storage-only (route.ts:918-967); normalizes inverter.type to micro|string|optimizer (route.ts:1024-1037)
- generatePermit: runs electrical-calc with necVersion defaulted to '2020', mainPanelAmps || 200, busRating = panelBusRating || mainPanelAmps || 200, wireLength || 50 (lib/permit/generatePermit.ts:952-1014)
- generateBOMForPermit: resolves the inverter by substring match on the free-text model string (bomForPermit.ts:167-209), re-derives stringCount/inverterCount/totalPanels, re-runs runStructuralCalcV4 for rail and mount counts (bomForPermit.ts:680-706), then calls generateBOMV4 a SECOND time with its own input (bomForPermit.ts:713-849)
- buildPermitDesignSnapshot: synthesizes its own electrical.serviceTopology object array from proj.interconnectionMethod, cs.* and proj.mainPanelAmps (build.ts:863-...), records electrical.poi {method, busbarA, mainBreakerA, backfeedA, rulePasses} (build.ts:3119-3125), and emits the NEC-705-12B-EXCEEDED blocker with the printed arithmetic (build.ts:2668-2684)
- computeSnapshotDigest: SHA-256 over canonical JSON of the whole snapshot minus meta.digest/snapshotId and run instants (lib/permit/snapshot/digest.ts:209-224)
- projectCanonicalFeeder: the one feeder raceway/size/VD/gauge/OCPD projection, with explicit hole reporting and no fallback literals (lib/permit/snapshot/electricalProjection.ts:59-130)
- serviceTopologyScheduleRows / serviceTopologyProcurement: one row per physical graph instance plus summarised order quantities (lib/permit/utils/serviceTopologySchedule.ts:317-346)
- buildCanonicalProposal: resolvedSystemSizeKw = panelCount × wattage / 1000, effectiveFinal = storedCashPrice > 0 ? storedCashPrice : round(systemSizeW × livePpw), ITC, net cost, payback (lib/proposal/buildCanonicalProposal.ts:360-362, 637-642, 743-752)
- calculateItemizedPrice / calculateFinalPrice: price = panelCount × $/panel or systemSizeKw × $/W, whichever method is higher (lib/pricingEngine.ts:260-330, 347-369)

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `bom: BOMGenerationResultV4 { items[] (partNumber, quantity, unitCost, totalCost, necReference, derivedFrom), stages[], topology, warnings, complianceNotes, totalCost }` | app/engineering/page.tsx:7957-7965 setBom() — the BOM tab, the CSV/markdown export (bom/route.ts:977-986), and nothing else; the permit builds its own (lib/permit/generatePermit.ts:1260) |
| `electrical: { revision, coupling, storageUnits, expansionUnits, gateways, generationPanels, topologyBomLines, quantityDisagreements, conflicts }` | app/engineering/page.tsx BOM tab display only — NOBODY on the permit, planset or pricing path |
| `pricing: { totalBomCost, catalogMatches, overrideMatches, fallbackMatches, unpriced, pricingApplied }` | app/engineering/page.tsx:7968, 9779, 10407, 10420, 12466, 15370 (cards and KPI tiles). NOBODY in lib/pricingEngine.ts, lib/proposal/ or app/api/proposals/* |
| `BOM_<client>.csv (Stage,Category,Manufacturer,Model,Part Number,Qty,Unit,Unit Cost,Total Cost,NEC Ref,Notes)` | project_files row written at app/api/engineering/save-outputs/route.ts:193-203 — the purchaser's file; built verbatim from body.bomItems (route.ts:117, 192) |
| `Permit_Packet_<client>.txt` | project_files row — app/api/engineering/save-outputs/route.ts:207+; body text built at route.ts:598-640 |
| `PermitInput.bom: PermitBOMItem[]` | lib/permit/generatePermit.ts:1262 → pageEquipmentSchedule (SCHED/PV-6 sheets), computePlansetManifest sheet index, and buildDecisionAwareBOMMetadata (generatePermit.ts:1264) |
| `PermitDesignSnapshot { meta.digest, meta.snapshotId, electrical.{feeder, poi, serviceTopology, routeSegments, conductors, groundingObjects, branches}, equipment, structural, bom, codeAuthority, releaseGates }` | lib/permit/snapshot/validate.ts (fail-closed), every sheet via peekSnapshot + projectCanonicalFeeder, lib/permit/snapshot/releaseGates.ts, the engineering-review digest binding, project_files permit_input.json |
| `Permit PDF / HTML (the sealed planset) + PermitDesignSnapshot digest` | project_files, the AHJ submittal, the stamping engineer, and engineering_review coverage keyed on meta.digest |
| `body.project.electricalRevision` | NOBODY — zero references to electricalRevision anywhere under lib/permit/ |
| `CanonicalProposal { gross_system_cost, systemCost, pricePerWatt, netCost, itcAmount, paybackYears, monthlyBillChart, proj25 }` | app/proposals/view/[id]/page.tsx:428, app/api/proposals/[id]/pdf/route.ts:233, app/api/proposals/[id]/send-email/route.ts:98, proposals.data_json |
| `costEstimate { grossCost, totalBeforeCredit, cashPrice, pricePerWatt, netCost }` | app/api/production/route.ts:403, 456, 563, 693 → productions.data_json / projects.cost_estimate → buildCanonicalProposal.storedCashPrice |
| `model.moduleCount (layouts.total_panels, canonical)` | NOBODY — only lib/electrical/authorityInspector.ts:284 prints it and lib/electrical/revision.ts fingerprints it; no BOM, permit, planset or pricing surface reads it |

#### Broken handoffs

##### 13.6.1 — [CRITICAL] The canonical service graph never reaches the permit snapshot or its digest

`lib/permit/snapshot/build.ts:863`

- **Upstream produced:** loadElectricalProject returns model.topology (the connection graph: service.ratedAmps, branches[].ratedAmps, panelboards, gateways, storage instances) and the permit route writes it onto body.project.serviceTopology at app/api/engineering/permit/route.ts:845-847
- **Downstream used instead:** build.ts synthesizes its own array: `const serviceTopology: ServiceTopologyObject[] = (() => { const method = String(proj.interconnectionMethod ?? 'LOAD_SIDE'); … const mainA = proj.mainPanelAmps ?? proj.mainBreakerA ?? null; …` — grep for `proj.serviceTopology` in lib/permit/snapshot/build.ts returns ZERO hits
- **Consequence:** The sealed snapshot — the thing that is validated fail-closed, deep-frozen, digested and bound to an engineering review — contains no graph-derived fact. A 400 A service with two 200 A MSPs, two gateways and four Powerwalls is represented in the snapshot as one service built from two engineering_config scalars. Meanwhile structuralPages.ts:1523 renders a 'Service Topology & Backup Domains — physical instances' table straight from the graph, so the package carries a sheet whose content is outside its own digest.

##### 13.6.2 — [CRITICAL] electricalRevision is stamped on the permit input and has zero readers, so a graph change cannot move the digest

`app/api/engineering/permit/route.ts:850`

- **Upstream produced:** electricalRevision(model) — the fingerprint of the electrical state, which lib/electrical/revision.ts:58 builds over storage.invertingUnits, coupling, service rating and module count
- **Downstream used instead:** `(body.project as { electricalRevision?: string }).electricalRevision = _electrical!.revision;` — grep for `electricalRevision` across lib/permit/ returns nothing, and canonicalDigestBody (lib/permit/snapshot/digest.ts:209) hashes only the snapshot, which never received it
- **Consequence:** Editing projects.service_topology — adding the second MSP, the second gateway, two more Powerwalls — produces a byte-identical snapshot digest. A digest-bound PE approval therefore survives a service-architecture change it never saw, which is the exact failure the digest binding exists to prevent.

##### 13.6.3 — [CRITICAL] The sealed permit takes the battery count from engineering_config; the SLD and the BOM take it from the graph

`app/api/engineering/permit/route.ts:857`

- **Upstream produced:** model.storage.invertingUnitCount — the count of AC-producing storage cabinets in the graph. app/api/engineering/bom/route.ts:219 applies it (`body.batteryCount = _canonical`) and app/api/engineering/sld/route.ts:258 applies it (`body.batteryCount = _model.storage.invertingUnitCount`)
- **Downstream used instead:** the permit route only logs it — `+ \` storage=${_m.storage.invertingUnitCount}\`` — while the value actually used is app/engineering/page.tsx:9022 `batteryCount: batteryEnabled ? config.batteryCount : 0`, read at lib/permit/generatePermit.ts:1004 `batteryCount: input.project.batteryCount ?? 0` and lib/permit/utils/bomForPermit.ts:846 `batteryCount: project.batteryCount`
- **Consequence:** Three artefacts, one project, and the sealed one is the outlier: the Diagram and the BOM order 4 Powerwalls from the graph while the permit's equipment schedule and its NEC 705.12(B) battery-branch term use the stale engineering_config scalar. The 120% allowance is computed from the wrong number of batteries, so the stamped busbar verdict certifies an allowance the real battery branch has already spent.

##### 13.6.4 — [CRITICAL] The permit never projects the graph's service rating; eight sites fabricate 200 A instead

`lib/permit/generatePermit.ts:982`

- **Upstream produced:** model.serviceRatedAmps = topology.service.ratedAmps (lib/electrical/projectModel.ts:617), loaded at app/api/engineering/permit/route.ts:795. app/api/engineering/bom/route.ts:244 projects it (`body.mainPanelAmps = _m.serviceRatedAmps`)
- **Downstream used instead:** `mainPanelAmps: input.project.mainPanelAmps || 200` — and the same literal at generatePermit.ts:962 and :1000, lib/permit/utils/bomForPermit.ts:564, lib/permit/utils/computedRuns.ts:292-293, lib/permit/utils/sldAdapter.ts:153, lib/permit/sections/compliancePages.ts:401 and :662, lib/permit/sections/sitePlan.ts:74
- **Consequence:** On a 400 A job the sealed permit sizes conductors, the busbar allowance, the backfed breaker and the MSP callout against a 200 A service, and prints '200A — EXISTING' on the site plan. lib/electrical/authorityInspector.ts:135-137 asserts that on the permit path mainPanelAmps 'travels on only as the derived compatibility projection' — nothing on that path derives it, so the documented safety claim is false.

##### 13.6.5 — [CRITICAL] The permit BOM resolves the inverter — the thing that gets purchased — by substring match on a free-text model string

`lib/permit/utils/bomForPermit.ts:206`

- **Upstream produced:** model.externalInverterId — the catalogue id of the project's separate AC inverter, with externalInverterOrigin recording whether the installer actually chose it (lib/electrical/projectModel.ts:154, 163)
- **Downstream used instead:** `const byModelContains = EQUIPMENT_REGISTRY_V4.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase())); return byModelContains;` — fed from `resolveRegistryEntry(firstInv?.model, firstInv?.manufacturer)` at bomForPermit.ts:543, i.e. PermitInput.system.inverters[0].model
- **Consequence:** The inverter on the permit's equipment schedule is whichever registry row's model string happens to overlap the posted text. The file's own comment at bomForPermit.ts:190-197 concedes this ('They REMAIN for inverters and accessories… removing the tiers blind broke 37 tests… i.e. it silently changed which hardware is ordered. ⚠ NAMED FOLLOW-UP'). The canonical id is in memory in the same request and is never passed.

##### 13.6.6 — [CRITICAL] The electrical engine behind the permit hard-defaults the NEC edition to 2020

`lib/permit/generatePermit.ts:953`

- **Upstream produced:** lib/permit/snapshot/codeAuthority.ts:482-508 resolves the NEC edition through a tiered, provenanced hierarchy (AHJ registry record → compliance.jurisdiction.necVersion → state adoption table), and app/api/engineering/permit/route.ts:731-734 and :742-745 deliberately removed the skeleton '2020' literal because it was being reported as operator entry
- **Downstream used instead:** `const necVersion: '2017' | '2020' | '2023' = _rawNec === '2017' ? '2017' : _rawNec === '2023' ? '2023' : '2020';`
- **Consequence:** The engine that produces the stamped conductor, OCPD and rapid-shutdown conclusions applies NEC 2020 on every project whose jurisdiction states no edition, while codeAuthority may be disclosing 2023 on the same sheet set. One package, two code bases, and the one that decided the numbers is the one chosen by a fallback.

##### 13.6.7 — [CRITICAL] An unresolved point of interconnection becomes LOAD_SIDE (NEC 705.12(B)) in three places on the sealed permit

`lib/permit/utils/interconnectionRule.ts:37`

- **Upstream produced:** interconnectionMethodScalar (lib/electrical/loadElectricalProject.ts:270-301) returns null for an unresolved, mixed, manufacturer-integrated or meter-collar POI precisely so no article is assigned, and the permit route honours that by projecting nothing (route.ts:822-824)
- **Downstream used instead:** `return interconnectionRuleOf(raw) === '705.11' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE';` — with an absent method this returns 'LOAD_SIDE'. Same literal at lib/permit/snapshot/build.ts:864 `String(proj.interconnectionMethod ?? 'LOAD_SIDE')` and build.ts:3120 `method: proj.interconnectionMethod ?? 'LOAD_SIDE'`
- **Consequence:** A project whose POI nobody has classified is handed NEC 705.12(B), the 120% busbar allowance and a backfed breaker — on the snapshot's poi.method, on the synthesized serviceTopology objects, and in the permit BOM's hardware selection. loadElectricalProject.ts:260-266 states the rule this violates verbatim: 'LOAD_SIDE is not a harmless default.'

##### 13.6.8 — [CRITICAL] The permit BOM sizes the DC OCPD from a fabricated 10 A module Isc

`lib/permit/utils/bomForPermit.ts:830`

- **Upstream produced:** the module's published short-circuit current from the catalogue record (lib/equipment-db SOLAR_PANELS), reachable through the resolved panelId
- **Downstream used instead:** `: necNextStandardOcpd((firstStr?.panelIsc || 10) * 1.56)` — and the page posts a different invention for the same fact at app/engineering/page.tsx:9102 `panelIsc: panel?.isc || 12.26`
- **Consequence:** Two fabricated values for one manufacturer fact, 10 A and 12.26 A, produce two different standard fuse ratings for the DC strings. Whichever fires, the string fuse printed on the sealed permit and placed on the purchase order was sized from a literal rather than from the module that is being installed.

##### 13.6.9 — [CRITICAL] A UL listing is asserted on the sealed permit from a default literal

`app/engineering/page.tsx:9090`

- **Upstream produced:** the inverter record's own ulListing field from the equipment catalogue (getInvById / getMicroinverterById on the line above)
- **Downstream used instead:** `ulListing: invData?.ulListing || 'UL 1741',`
- **Consequence:** An inverter whose catalogue row carries no listing field is presented to the AHJ as UL 1741 listed. A listing claim is the single statement an inspector relies on most and it is being manufactured by a `||`.

##### 13.6.10 — [CRITICAL] A legacy inverter id silently becomes the catalogue's first microinverter on both the permit and the BOM

`app/engineering/page.tsx:9084`

- **Upstream produced:** model.externalInverterId plus model.externalInverterOrigin, which exists specifically to say whether the installer chose this device (projectModel.ts:156-163)
- **Downstream used instead:** `? (getMicroinverterById(inv.inverterId) ?? MICROINVERTERS[0])` on the permit payload, and `(MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id ?? MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')` on the BOM payload at page.tsx:7692
- **Consequence:** A config holding a stale non-micro id (the comment names 'se-7600h') ships whatever product happens to sit at index 0 of MICROINVERTERS onto the permit equipment schedule and onto the BOM an installer orders from. app/api/engineering/bom/route.ts:305-315 removed exactly this class of substitution server-side ('NO EQUIPMENT MAY APPEAR FROM ABSENCE') and the client reinstates it one hop upstream.

##### 13.6.11 — [CRITICAL] The BOM's inverter identity still comes from the request body, and the client fills absence with a real catalogue product

`app/engineering/page.tsx:7693`

- **Upstream produced:** model.hasExternalInverter / model.externalInverterId — on a DC-coupled or storage-only project the correct state is NO standalone inverter (projectModel.ts:151-154)
- **Downstream used instead:** `: (firstInv?.inverterId || 'fronius-primo-8.2'),` posted to /api/engineering/bom, which reads it unchanged at app/api/engineering/bom/route.ts:316 `typeof body.inverterId === 'string' && body.inverterId.trim() ? body.inverterId.trim() : ''`
- **Consequence:** The server-side `?? 'fronius-primo-8.2'` was removed from the BOM route with the note 'a line on the list somebody orders from', and the identical literal is still in the client. A DC-coupled job gets a Fronius Primo 8.2 quoted, and the route has no way to tell a real selection from the substitute.

##### 13.6.12 — [CRITICAL] The graph's equipment lines and the reconciliation that proves them never run on the permit path

`lib/permit/utils/bomForPermit.ts:849`

- **Upstream produced:** bomFromServiceTopology(topology) — the backup gateways, per-system generation/combiner panels, inline utility isolation switches and Powerwall expansions that exist only as graph relationships — plus reconcileQuantities, which proves the lines agree with the graph (applied at app/api/engineering/bom/route.ts:623, 678)
- **Downstream used instead:** `const v4Result = generateBOMV4(v4Input);` — a repo-wide grep shows bomFromServiceTopology / reconcileQuantities / pricedQuantitiesFromBom have exactly ONE production caller, app/api/engineering/bom/route.ts
- **Consequence:** The permit's SCHED/equipment schedule omits every device the graph owns, while serviceTopologyProcurement (serviceTopologySchedule.ts:317) prints those same devices with order quantities on a structural page of the same package. Two procurement tables in one sealed set, from two authorities, with no reconciliation between them — the 'drawing = 2, BOM = 1' condition, inside one document.

##### 13.6.13 — [CRITICAL] The archived BOM the purchaser opens is the client's React state, with no canonical read and no staleness guard

`app/api/engineering/save-outputs/route.ts:192`

- **Upstream produced:** the reconciled, graph-corrected, architecture-gated BOM produced by /api/engineering/bom (including quantityDisagreements and the 409 refusal on an unresolved architecture)
- **Downstream used instead:** `const bomCsv = buildBomCsv(bomItems);` where bomItems is destructured off the request body at route.ts:117 and posted as `bomItems: bom` from app/engineering/page.tsx:6740. grep for loadElectricalProject / architectureRefusal / reconcileQuantities / service_topology in save-outputs/route.ts returns 0 hits
- **Consequence:** BOM_<client>.csv — described in the file's own comment as 'the file the purchaser actually opens' — is written from whatever the BOM tab last rendered. setBom is called in exactly one place (page.tsx:7965) and there is no `_bomSig` equivalent of the SLD's staleness signature (page.tsx:2982-2983), so changing the inverter drops the stale SLD and keeps the stale BOM. The purchase-order artefact is the one with no guard.

##### 13.6.14 — [CRITICAL] The BOM's module count comes from the body; the canonical module count has no consumer anywhere in the repo

`app/api/engineering/bom/route.ts:395`

- **Upstream produced:** model.moduleCount, read from layouts.total_panels (loadElectricalProject.ts:212-213) and documented at projectModel.ts:183-190 as 'a real electrical fact besides: the DC string sizing and the array table on the sheet both move with it'
- **Downstream used instead:** `moduleCount: Number(body.moduleCount) || Number(body.totalPanels) || 0,` — and on the permit side `const guardPanels = body.system?.totalPanels ?? 0` (permit/route.ts:696) and `const totalPanels = cad.totalPanels || system.totalPanels || 0` (bomForPermit.ts:561). A repo-wide grep finds no consumer of model.moduleCount outside authorityInspector.ts:284 and revision.ts
- **Consequence:** The panel quantity on the BOM, on the sealed permit's array table and in every structural derivation is the client's systemPanelCount, never layouts.total_panels. The permit's only check is non-zero (route.ts:697), so a 36-panel design can ship a 72-panel sheet set and parts list with no disagreement reported. The canonical count is computed and exposed for this purpose and read by nobody.

##### 13.6.15 — [CRITICAL] String count on the BOM defaults to 2

`app/api/engineering/bom/route.ts:400`

- **Upstream produced:** the engineered string structure in projects.engineering_config.inverters[].strings[], posted as a real sum at app/engineering/page.tsx:7726
- **Downstream used instead:** `stringCount: Number(body.stringCount) || 2,`
- **Consequence:** A payload that omits stringCount — or sends 0 for a non-micro topology — gets a two-string system. stringCount feeds generateBOMV4's DC conductor runs, string fuses, combiner selection and the inverterCount guards at route.ts:460-467, so the wire footage and fuse quantities on the parts list come from a literal.

##### 13.6.16 — [CRITICAL] Racking, the panel SKU and the attachment count on the BOM are invented when the real value is absent

`app/engineering/page.tsx:7652`

- **Upstream produced:** the project's recorded mounting system (config.mountingId → projects.engineering_config), the designer's panel selection (firstStr.panelId), and the structural engine's own mount and rail counts (compliance.structural.mountLayout.mountCount / arrayGeometry.railCount)
- **Downstream used instead:** `? (rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100')`; `panelId: … : defaultPanelForSystemType(config.systemType)` (page.tsx:7712-7714); `attachmentCount: … ?? Math.ceil(totalPanels / 2)` (page.tsx:7780); `railSections: … ?? Math.ceil(totalPanels / 4)` (page.tsx:7783); and server-side `attachmentCount: … : 12` / `railSections: … : 4` (bom/route.ts:492-495)
- **Consequence:** Four purchase-order quantities and two SKUs from defaults: an IronRidge XR100 rail system quoted for a project that never chose it, a panel SKU chosen by system type, and roof attachment and rail counts estimated at one per two panels / one per four panels when the structural engine has not run. lib/permit/utils/bomForPermit.ts:759-765 retired these same renderer guesses on the permit side with the words 'never a fabricated quantity'; the BOM path still has them.

##### 13.6.17 — [CRITICAL] The 400 A path: the graph's SERVICE rating is projected onto the field the engine treats as the backfed panel's MAIN BREAKER

`app/api/engineering/bom/route.ts:244`

- **Upstream produced:** model.serviceRatedAmps = topology.service.ratedAmps — 400 on a 400 A service whose two branches are rated 200 A each (lib/electrical/serviceTopology.ts:1301-1319 models exactly this)
- **Downstream used instead:** `body.mainPanelAmps = _m.serviceRatedAmps;` which lib/bom-engine-v4.ts:1911 and :3304 consume as `const mainAmps = input.mainPanelAmps ?? 200;` and pass as `mainBreakerA: mainAmps` into resolveLoadSideBackfeedBreaker, alongside `busRating = input.panelBusRating ?? …` which stays at the posted 200
- **Consequence:** On the two-MSP path the 120% calculation becomes 200 × 1.2 − 400 = −160 A, so the PV allowance is negative and the backfed breaker is mis-sized or refused — on the same project where the permit computes it from 200 A and passes. The simple 200 A path only works because the service rating and the MSP main breaker happen to be the same number; the projection is wrong in both cases and only visible in one.

##### 13.6.18 — [CRITICAL] The archived permit packet fabricates the panel model and the inverter topology

`app/api/engineering/save-outputs/route.ts:615`

- **Upstream produced:** the resolved panel record (manufacturer + model + watts) and the resolved inverter type on the canonical model and in the catalogue
- **Downstream used instead:** `  Panel Model:            ${p.panelModel ?? 'Generic 400W Monocrystalline'}`,` and `  Inverter Type:          ${p.inverterType ?? 'String'}`,` (route.ts:615-616)
- **Consequence:** A file headed 'PERMIT PACKAGE' is archived to the project's Client Files naming a module that does not exist and asserting a string topology on what may be a microinverter job. Both fields are posted from the page and both have a literal behind them.

##### 13.6.19 — [CRITICAL] Wire footage, conduit length and OCPD on the parts list fall back to literals

`app/api/engineering/bom/route.ts:482`

- **Upstream produced:** the per-segment run lengths the wire-sizing engine derives from real geometry (ComputedSystem.runs / deriveRunLengths(cad)), which the permit path does use at lib/permit/utils/bomForPermit.ts:616-626
- **Downstream used instead:** `dcWireLength: Number(body.dcWireLength) || 50,` (route.ts:482), `acWireLength: Number(body.acWireLength) || 60,` (route.ts:484), `dcOCPD: Number(body.dcOCPD) || 20,` (route.ts:516), and on the permit side `|| project.wireLength || 50` / `|| 60` (bomForPermit.ts:625-626) plus `wireLength: input.project.wireLength || 50` into the voltage-drop engine (generatePermit.ts:988)
- **Consequence:** Conductor and conduit footage on a purchase order, and the DC OCPD, come from 50 ft / 60 ft / 20 A literals when the geometry has not been derived. The voltage drop printed on the permit is computed over a 50 ft default run.

##### 13.6.20 — [CRITICAL] The permit's fallback BOM ships an equipment schedule with no part numbers and a 40 A disconnect guess

`lib/permit/utils/bomForPermit.ts:339`

- **Upstream produced:** the catalogue part numbers the V4 registry resolves, and the conductor authority's real AC feeder OCPD (_auth.acFeeder.ocpdAmps, bomForPermit.ts:570)
- **Downstream used instead:** `const ocpd = acKw > 0 ? necNextStandardOcpd(acKw * 1000 / 240 * 1.25) : 40;` with `partNumber: '—'` and `manufacturer: '—'` on every line (bomForPermit.ts:301, 323, 344-346). Reached whenever resolveRegistryEntry misses and no per-sub inverter resolves (bomForPermit.ts:856-858)
- **Consequence:** A permit equipment schedule with em-dashes where the SKUs belong and a 40 A AC disconnect chosen because the AC kW was zero. Nothing orderable, and nothing in the package says the schedule is a fallback.

##### 13.6.21 — [CRITICAL] Pricing never reads an equipment count — the proposal price is kW × $/W and the graph has no pricing consumer

`lib/proposal/buildCanonicalProposal.ts:639`

- **Upstream produced:** model.storage.invertingUnitCount, expansionUnitCount, gatewayCount and perSystemGenerationPanelCount from the graph, plus the BOM's reconciled, distributor-priced totalBomCost
- **Downstream used instead:** `const baseCashPrice = input.storedCashPrice > 0 ? input.storedCashPrice : liveCalculatedPrice;` where `liveCalculatedPrice = Math.round(systemSizeW * livePpw)` (line 638) and livePpw falls back to DEFAULT_PPW { roof: 3.10, ground: 2.35, fence: 4.25, carport: 3.75 } (lines 167-172, 630-635). grep for batteryCount / batteryCost / storageCost / inverterCount across lib/proposal/ returns ZERO hits
- **Consequence:** A four-Powerwall job and a battery-free job of the same kW quote the same price unless a human typed storedCashPrice. lib/electrical/authorityInspector.ts:116 names this as the open work — 'Migrate the proposal/production capacity readers onto model.storage.invertingUnitCount' — and it is still open. The answer to 'does pricing read the graph's instance counts or a catalogue scalar' is neither: it reads a kW scalar.

##### 13.6.22 — [CRITICAL] The BOM's priced total is computed, displayed and then discarded

`app/api/engineering/bom/route.ts:1044`

- **Upstream produced:** pricingResult.totalBomCost — the sum of DB-override and distributor-catalog unit costs across every reconciled BOM line (applyDistributorPricing, lib/bom/distributorPricing.ts:864-924)
- **Downstream used instead:** nothing downstream consumes it. Its only readers are app/engineering/page.tsx:7968, 9779, 10407, 10420, 12466, 15370 — cards and KPI tiles. lib/pricingEngine.ts and lib/proposal/ compute cost from `watts * cfg.equipmentCostPerWatt` (pricingEngine.ts:223, 359) and panelCount × $/panel instead
- **Consequence:** The system has a real, line-item hardware cost for the exact equipment the graph specifies, and the customer price is computed from a $/W constant that cannot see it. The estimator's screen and the customer's proposal are two unrelated numbers for the same job.

##### 13.6.23 — [CRITICAL] The canonical BOM path does not exist for the permit: generateBOMV4 is called twice per project with two different inputs

`lib/permit/generatePermit.ts:1260`

- **Upstream produced:** the BOMGenerationResultV4 that /api/engineering/bom produced — graph-corrected battery count, graph-projected service rating, graph-projected interconnection method, folded topology lines, reconciled quantities
- **Downstream used instead:** `const generatedBOM = generateBOMForPermit(input, cad);` which assembles its own BOMGenerationInputV4 at lib/permit/utils/bomForPermit.ts:713-847 from PermitInput + CADModel and calls generateBOMV4 again (bomForPermit.ts:849), then a second time in pass 2 at generatePermit.ts:1428
- **Consequence:** Two independent BOM assemblies for one project with no comparison between them. The engineering BOM tab, the archived CSV and the sealed permit's SCHED pages can each list different quantities and different hardware, and only the engineering path has the reconciliation that would catch it.

##### 13.6.24 — [CRITICAL] The BOM route re-derives brand and topology from the posted inverter id, after the canonical model already answered

`app/api/engineering/bom/route.ts:777`

- **Upstream produced:** model.solarCoupling and model.hasExternalInverter — the project's one recorded answer about the PV architecture, with provenance (projectModel.ts:147-154)
- **Downstream used instead:** `sizingResult = sizeSystemFromBrand({ … selectedInverterId: input.inverterId, batteryEnabled: batteryEnabledFlag, batteryMode: body.batteryMode === 'manual' ? 'manual' : 'auto', batteryGoal: (body.batteryGoal ?? 'backup'), … })` with `const panelWattage = input.moduleCount > 0 ? Math.max(50, Math.round((input.systemKw * 1000) / input.moduleCount)) : 400;` (route.ts:772-774)
- **Consequence:** A second topology and brand determination, keyed off the posted inverter id and a panel wattage back-derived from systemKw (which itself defaults to 8.0 at route.ts:470, giving 400 W when moduleCount is 0). Its verdict drives shouldStripMicroItems, which DELETES micro-only lines from the merged BOM (route.ts:804-837) — so a stale inverter id can remove real hardware from the parts list.

##### 13.6.25 — [CRITICAL] System size on the BOM defaults to 8.0 kW

`app/api/engineering/bom/route.ts:470`

- **Upstream produced:** the real DC capacity, derivable from the resolved panel record × model.moduleCount
- **Downstream used instead:** `systemKw: Number(body.systemKw) || 8.0,`
- **Consequence:** An absent systemKw yields an 8 kW system, which then sets panelWattage (route.ts:773) and, through `((input.acOutputKw ?? input.systemKw) * 1000 / (input.acVoltage ?? 240)) * 1.25` (bom-engine-v4.ts:1943, 3336), the derived backfeed breaker rating when no OCPD was posted. A fabricated capacity sizes an OCPD on a parts list.

##### 13.6.26 — [CRITICAL] Module electrical parameters on the sealed permit come from literals when the catalogue row is thin

`app/engineering/page.tsx:9101`

- **Upstream produced:** the module's published watts, Voc and Isc from lib/equipment-db SOLAR_PANELS, resolved by getPanelById on the line above
- **Downstream used instead:** `panelWatts: panel?.watts || 400, panelVoc: panel?.voc || 41.6, panelIsc: panel?.isc || 12.26,` — and the system DC capacity the same way at page.tsx:9074 `((getPanelById(_pw0.panelId) as any)?.watts ?? 400) / 1000 … : 0.4`
- **Consequence:** Voc sets the maximum string length against the cold-temperature correction, Isc sets the DC conductor ampacity and the string fuse, and watts sets the system capacity printed on the cover sheet. All three are manufactured by `||` on the sealed permit, and the resulting string sizing is presented as engineered.

##### 13.6.27 — [CRITICAL] Fence and ground structural quantities on the BOM are UI constants labelled as estimates

`app/engineering/page.tsx:7851`

- **Upstream produced:** the structural engine's own analyses — compliance.structural.groundMountAnalysis.pileCount / pileSpacingFt / pileEmbedmentFt, and the designed fence geometry
- **Downstream used instead:** `const postSpacingFt = 8; const postEmbedFt = 3; const railCount = 2;` plus `const panelWidthFt = 3.28; const panelHeightFt = 5.5;` (page.tsx:7852-7856), and on the ground branch `?? 10` / `?? 4` / `pileCount: gma?.pileCount ?? pilesPerRow * 2` / `railsPerRow: 2` / `groundClearanceFt: 2` / `const panelWidthIn = 41.7` (page.tsx:7894-7919). The comment at 7844 states `derivedFrom: 'estimated-ui-defaults' (not CAD geometry)`
- **Consequence:** Post counts, pile counts, embedment depths and rail counts on the fence/ground purchase order are derived from fenceCAD defaults and a 41.7-inch assumed panel width, not from the designed array or the structural run. These same numbers also drive the structural sheets.

##### 13.6.28 — [MAJOR] The pipeline guard that would catch a missing canonical snapshot never blocks

`app/api/engineering/permit/route.ts:567`

- **Upstream produced:** projects.canonical_snapshot, evaluated by checkPipelineGuard (route.ts:565-566)
- **Downstream used instead:** `if (guardResult) { // Log the warning but do NOT hard-block … console.warn('[PERMIT_PIPELINE_GUARD]', { projectId, status: 'PIPELINE_NOT_EXECUTED — canonicalSnapshot missing or incomplete', note: "Proceeding with permit route's own validation chain" }); }`
- **Consequence:** A permit package generates for a project whose canonical pipeline never ran, with only a server log to show it. The stated reason — 'permit has its own validation that will catch missing data' — is the same validation that accepts `|| 200`, `?? 'LOAD_SIDE'` and `: '2020'` as values.

##### 13.6.29 — [MAJOR] Unmatched BOM lines are priced from generic per-category figures

`lib/bom/distributorPricing.ts:835`

- **Upstream produced:** the exact catalogue part number on each reconciled BOM line, matched against distributor_prices and the static catalog (distributorPricing.ts:816-832)
- **Downstream used instead:** `const fallback = CATEGORY_FALLBACK_PRICES[item.category]; if (fallback) { … return { unitCost: fallback.unitCost, source: 'fallback' }; }` — e.g. `battery: { unitCost: 4200.00 }`, `string_inverter: { unitCost: 1500.00 }`, `gateway: { unitCost: 690.00 }`, `combiner: { unitCost: 900.00 }` (distributorPricing.ts:685-711)
- **Consequence:** A Powerwall 3 that no catalog row matched is costed at a generic $4,200 and summed into totalBomCost indistinguishably from a real price. The fallbackMatches count is reported separately (bom/route.ts:1047) but the dollar figure the estimator reads does not separate priced from guessed.

##### 13.6.30 — [MAJOR] The production route back-derives system size from a 400 W panel assumption before pricing it

`app/api/production/route.ts:309`

- **Upstream produced:** layouts.system_size_kw written by the layout save path, and the resolved panel record's actual wattage
- **Downstream used instead:** `systemSizeKw: systemDef.systemSizeKw ?? (systemDef.panels?.length ?? 0) * 0.4,` — repeated at route.ts:628
- **Consequence:** When the layout row carries no size, the kW that calculateFinalPrice multiplies by $/W is panel count × 400 W. The resulting cashPrice is written to productions.data_json / projects.cost_estimate and becomes buildCanonicalProposal's storedCashPrice, so a 440 W design is quoted as if it were 400 W.

##### 13.6.31 — [MAJOR] The datasheet pages resolve the inverter by model string, so a mismatch prints PENDING instead of the project's equipment

`lib/permit/snapshot/equipmentProjection.ts:106`

- **Upstream produced:** model.externalInverterId, the catalogue record id
- **Downstream used instead:** `const rec = fuzzMicro(model);` where fuzzMicro matches on `e.model.toLowerCase().trim().replace(/\s+/g, ' ') === m` against PermitInput.system.inverters[0].model (equipmentProjection.ts:89-92, called from lib/permit/sections/compliancePages.ts:1056)
- **Consequence:** APP-A's spec-sheet reference table renders every manufacturer value as 'pending' when the posted model string does not match the catalogue exactly, even though the catalogue id that would resolve it is in memory in the same request. The projection is honest about the gap, but the gap is self-inflicted.

---

### 13.7 THE 200 A PATH vs THE 400 A PATH

*18 breaks — 7 verified by a refuter.*

#### What this stage is

There is exactly ONE authoring path in production and it is the 400 A / two-system one. `ServiceTopologyWizard` runs the same six unconditional steps for every job: it opens defaulted to `serviceAmps = 400` (ServiceTopologyWizard.tsx:69) and `distribution = 'two-main-panels'` (line 71), so a 200 A one-MSP house must actively *undo* the complex shape before it can describe itself, and it is then asked four multi-system questions that have exactly one meaningful answer on one branch — "How do these systems connect to the service?" (lines 500-526), "Where does the utility's safety switch go?" (679-704), the site-wide "applies to all N systems" generation-panel radio (369-445) and a per-domain point-of-connection select that duplicates it (598-658). Only three places in the whole chain branch on system count at all: `topology.domains.length > 1` for the multi-gateway metering document (serviceTopology.ts:2098, topologyOverview.ts:601, serviceTopologyGraph.ts:405, sld-professional-renderer.ts:3343), `sheetWidth(g.domains.length)` (renderServiceTopologySvg.ts:61), and the wizard's own "applies to all N systems" caption (383). Everything else — the DER-arrangement requirement, the isolation-arrangement question, the four disconnect roles, the fault-current requirement, the SERVICE DISTRIBUTION box on the sheet — is emitted identically for one branch and for three. There is NO single-system fixture: `lib/electrical/fixtures/` contains one file, and its only one-domain shape is `collapseToSingleGateway`, documented at line 48-49 as "Set true to reproduce the defect". The deeper finding is that the simple path is not merely over-asked, it is the HIDING PLACE for the chain's worst break: `project.mainPanelAmps ?? 200` is read as the NEC 705.12(B) busbar base by ten production surfaces, and `200` is the simple path's correct answer — so on a 200 A/one-MSP house the defect is invisible, and on the 400 A/two-MSP job the SLD and BOM are handed the 400 A SERVICE rating as the 200 A panel's BUSBAR rating, doubling the permitted backfeed.

#### Data in

| Field | Where it comes from |
|---|---|
| `service.ratedAmps` | ServiceTopologyWizard step 1 → buildServiceFromPreset → createServiceTopology → projects.service_topology (components/engineering/ServiceTopologyWizard.tsx:69,82-85; lib/electrical/topologyPresets.ts:117-119) |
| `distribution (preset id: one-main-panel / two-main-panels / three-main-panels / custom)` | ServiceTopologyWizard local React state ONLY — never persisted to any column (components/engineering/ServiceTopologyWizard.tsx:71,196-208) |
| `branches[].ratedAmps, panels[].busbarRatingA, panels[].mainBreakerA` | buildServiceFromPreset: per = presetBranchAmps(serviceAmps, count) (lib/electrical/topologyPresets.ts:126-133) |
| `panels[].backedUp` | ServiceTopologyWizard step 3 checkbox → updatePanel (components/engineering/ServiceTopologyWizard.tsx:231-232) |
| `domains[] (one per backed-up panel, on that panel's branch)` | ServiceTopologyWizard.materialiseDomains (components/engineering/ServiceTopologyWizard.tsx:93-119) |
| `domains[].gateway.productId, domains[].storageUnitIds` | ServiceTopologyWizard step 4 selects → setDomainEquipment (components/engineering/ServiceTopologyWizard.tsx:268-272,291-332) |
| `domains[].storageConnection` | ServiceTopologyWizard step 4 site-wide radio (369-445) AND step 5 per-domain select (623-650) — two controls for the same field |
| `solarCoupling` | ServiceTopologyWizard step 5 radio → setSolarCoupling (components/engineering/ServiceTopologyWizard.tsx:478-493) |
| `interconnection.derArrangement` | ServiceTopologyWizard step 5 radio → applyDerArrangement (components/engineering/ServiceTopologyWizard.tsx:503-526; lib/electrical/topologyPresets.ts:366-460) |
| `interconnection.meterCollarPermitted` | ServiceTopologyWizard select ONLY (546-559), ServiceNodeInspector.tsx:375-380, ServiceTopologyBuilder.tsx:623-626. No jurisdiction/utility authority writes it anywhere; the empty-state wizard is mounted WITHOUT the prop (ServiceTopologyBuilder.tsx:191) so it is always null on a new design |
| `interconnection.externalDerIsolationRequired` | ServiceTopologyWizard checkbox (661-665), ServiceNodeInspector.tsx:409-413, ServiceTopologyBuilder.tsx:642-644 — all three are two-state checkboxes over a three-state field |
| `devices[] (der-isolation-disconnect)` | applyIsolationArrangement via step 6 radio (lib/electrical/topologyPresets.ts:290-349) AND the DISCONNECT_ROLES checkbox on the same screen (components/engineering/ServiceTopologyWizard.tsx:752-781) |
| `service.availableFaultCurrentA` | NOT ASKED by the wizard at any step; ServiceNodeInspector only. Required unconditionally by sccr.chain (lib/electrical/serviceTopology.ts:1630-1640) |
| `layouts.total_panels` | loadElectricalProject.ts:157-158 (newest layouts row), used for exactly one decision: moduleCount === 0 ⇒ storage-only (projectModel.ts:524-531) |
| `selected_equipment.inverter / batteries[0].id / batteryCount` | selectedEquipmentView (lib/electrical/loadElectricalProject.ts:103-124) — written by the System Config ecosystem apply path (app/engineering/page.tsx:11238-11340) |
| `engineering_config` | loadElectricalProject.ts:215-221 — read FOR ITS PRESENCE ONLY; resolveElectricalProject is called with engineeringConfig: null (line 243) |
| `body.electrical.inverters[].strings[], body.mainPanelAmps, body.topologyType` | the HTTP POST body from app/engineering/page.tsx — app/api/engineering/calculate/route.ts:42-54; app/api/engineering/sld/route.ts:1080-1083; app/api/engineering/bom/route.ts:504,531 |
| `localStorage['eng-config-<projectId>']` | app/engineering/page.tsx:2317-2338 and 2358-2368 — a fallback SOURCE for the page config and for batteryEnabled, which then decides what the page POSTs |

#### What it calculates

- buildServiceFromPreset: count = preset.branches ?? customBranches; per = Math.floor(serviceAmps / count); one branch + one panel per count, each rated `per`, with branch.panelIds recorded (lib/electrical/topologyPresets.ts:115-136). This is the ONLY place the two paths diverge in the data, and the divergence is a single integer.
- materialiseDomains: one BackupDomain per panel where backedUp === true, on the branch whose panelIds contains it; domains whose panel was un-ticked are removed (ServiceTopologyWizard.tsx:93-119). Naturally count-driven — 1 domain for the simple job, 2 for Ray's.
- applyPerSystemGenerationPanels: one DerAggregationPanel per domain, inputs = that domain's inverter-units, feedsNodeId = that domain's gateway, sized by recommendAggregationRatings, plus a POI per domain with relationship 'manufacturer-integrated' (lib/electrical/topologyPresets.ts:526-615). Looks for an existing POI before creating one (594-611).
- applyDerArrangement('independent-branch'): one POI per domain, relationship derived from storageConnection ('backed-up-panel-busbar'→'load-side-busbar', 'gateway-panelboard'→'manufacturer-integrated', anything else→'unresolved') (lib/electrical/topologyPresets.ts:377-397). Does NOT look for an existing POI and removes nothing.
- applyIsolationArrangement: removes every existing der-isolation-disconnect, then either one service-rated device or one device per BRANCH with inlineOnNodeId = that branch's gateway and ratedAmps = branch.ratedAmps (lib/electrical/topologyPresets.ts:290-349).
- evaluateServiceTopology: ~30 checks. Count-gated: metering.multi-gateway (serviceTopology.ts:2098). NOT count-gated and therefore identical on both paths: interconnection.arrangement (gated only on derSources(topology).length > 0, line 1781), interconnection.der-isolation + coverage + isolation-accepted (1742-1846), sccr.chain (1630-1640), bonding.location (1663-1674), device.selection per device (1716-1723), domain.busbar-705-12 per panel using maxLoadSideBackfeedA(p.busbarRatingA, p.mainBreakerA) (1565-1573).
- serviceTopologyReleaseReadiness: blocking = NOT_EVALUATED checks minus the one optional token 'loads.model' (serviceTopologySchedule.ts:399; OPTIONAL_REQUIREMENT_TOKENS = new Set(['loads.model']) at serviceTopology.ts:926), then one requirement sentence per token; releaseReady = blocking.length === 0 && failures.length === 0 (line 485).
- legacyServiceScalars: the sanctioned graph→scalar projection — mainPanelAmps = panels[0].busbarRatingA, mainBreakerAmps = panels[0].mainBreakerA, panelsNotRepresented = panels.length - 1 (lib/electrical/topologyAuthoring.ts:815-828). Computed correctly and called by nothing in production.

#### Data out, and who consumes it

| Field | Consumed by |
|---|---|
| `ServiceTopology (service, branches[], panels[], domains[], storage[], devices[], aggregationPanels[], pointsOfInterconnection[], interconnection, solarCoupling)` | PUT from ServiceTopologyBuilder.save → projects.service_topology; read back by lib/electrical/loadElectricalProject.ts:197 → parseServiceTopology → resolveElectricalProject |
| `model.serviceRatedAmps (= topology.service.ratedAmps, lib/electrical/projectModel.ts:617)` | app/api/engineering/sld/route.ts:218 and app/api/engineering/bom/route.ts:244 — both assign it to body.mainPanelAmps, which downstream treats as the PANEL busbar. NOT consumed by the permit route (app/api/engineering/permit/route.ts:807-865 projects only interconnectionMethod, serviceTopology and electricalRevision) |
| `model.storage.{invertingUnitCount, expansionUnitCount, gatewayCount, perSystemGenerationPanelCount}` | app/api/engineering/sld/route.ts:258 (body.batteryCount) and app/api/engineering/bom/route.ts:219; equipmentInstancesFromTopology → bomFromServiceTopology → reconcileQuantities (app/api/engineering/bom/route.ts:620-678) |
| `ServiceOverview.summary.{systemCount, systemsLabel, branchCount, panelCount, domainCount, gatewayCount, isolationSwitchCount}` | components/engineering/ServiceTopologyBuilder.tsx summary bar and ServiceTopologyMap ONLY (lib/electrical/topologyOverview.ts:671-700). No route, no sheet and no BOM reads systemCount |
| `ReleaseReadiness.{drawable, releaseReady, requirements[], failures[]}` | lib/permit/sections/structuralPages.ts:1526 (schedule rows) and the permit result |
| `legacyServiceScalars(topology).{mainPanelAmps, mainPanelBusAmps, mainBreakerAmps, panelsNotRepresented}` | NOBODY. The only importer is tests/topologyAuthoredThenAgreesEverywhere.postgres.test.ts:236-237 |
| `DISTRIBUTION_PRESETS selection ('one-main-panel' vs 'two-main-panels')` | NOBODY after the branch/panel objects are built. It is wizard-local state (ServiceTopologyWizard.tsx:71) and is never persisted, so re-entering the wizard on a saved one-MSP job shows 'two-main-panels' selected again |

#### Broken handoffs

##### 13.7.1 — [CRITICAL] The SERVICE rating is projected onto the PANEL BUSBAR scalar, doubling the NEC 705.12(B) allowance on the 400 A path

`app/api/engineering/sld/route.ts:218`

- **Upstream produced:** topology.panels[] = [{busbarRatingA: 200, mainBreakerA: 200}, {busbarRatingA: 200, mainBreakerA: 200}] and topology.service.ratedAmps = 400. The graph's own check uses the PANEL: `maxLoadSideBackfeedA(p.busbarRatingA, p.mainBreakerA)` (lib/electrical/serviceTopology.ts:1566). lib/electrical/topologyAuthoring.ts:824 exposes the correct projection `mainPanelAmps: p?.busbarRatingA ?? null`.
- **Downstream used instead:** `body.mainPanelAmps = _model.serviceRatedAmps;` (sld/route.ts:218; identical at bom/route.ts:244), then `panelBusRating: Number(body.panelBusRating ?? body.mainPanelAmps ?? 200)` (sld/route.ts:1082, 458, 1192; bom/route.ts:531) and `mainPanelBusAmps: Number(body.panelBusRating ?? body.mainPanelAmps ?? 200)` / `mainPanelBreakerAmps: Number(body.mainPanelAmps ?? 200)` (sld/route.ts:1122-1123). The engine then computes `const busRating = input.panelBusRating ?? input.mainPanelAmps ?? 200; const mainAmps = input.mainPanelAmps ?? 200;` (lib/bom-engine-v4.ts:1910-1911 and 3303-3304).
- **Consequence:** On Ray's 400 A / two 200 A MSP job the 120% panel on E-1 and the BOM's compliance note are computed as 400 A bus with a 400 A main — 80 A of permitted backfeed instead of the true 40 A. A design that FAILS 705.12(B) prints PASS on a sheet an AHJ reads, and the breaker purchased is sized against an allowance that does not exist. On the simple 200 A / one-MSP path service.ratedAmps === panels[0].busbarRatingA === 200, so the identical code is accidentally right — which is why this has survived.

##### 13.7.2 — [CRITICAL] `?? 'LOAD_SIDE'` still hands out NEC 705.12(B) when the graph deliberately refuses to name an article — and Ray's real job is exactly that case

`app/api/engineering/sld/route.ts:1083`

- **Upstream produced:** pointsOfInterconnection[].relationship = 'manufacturer-integrated' (buildRaysIntendedJob sets storageConnection: 'gateway-panelboard' → fixture line 324-325). interconnectionMethodScalar maps 'manufacturer-integrated' → null on purpose: "Projecting either scalar would assert an article the graph deliberately declines to name" (lib/electrical/loadElectricalProject.ts:287), and returns null (line 295).
- **Downstream used instead:** `interconnectionMethod: String(body.interconnection ?? body.interconnectionType ?? body.interconnectionMethod ?? 'LOAD_SIDE')` (sld/route.ts:1083), and again at 1125-1127 for buildPermitSystemModel. lib/bom-engine-v4.ts:1900-1903 then sets isLoadSide and runs the 120% busbar block.
- **Consequence:** Because the route's projection at line 234-236 fires only when the scalar is non-null, the fallback is reached on every project whose POI is 'manufacturer-integrated', 'meter-collar' or 'unresolved' — including Ray's actual 400 A job and any simple house interconnecting at a meter collar. The sheet and BOM assert NEC 705.12(B) and a backfed-breaker arrangement on a design the graph says is governed by the manufacturer's listing or by 705.11.

##### 13.7.3 — [CRITICAL] The permit package never projects the service rating, so the cover sheet, site plan, compliance pages and permit BOM all run on `|| 200` while the SLD in the same package says 400

`app/api/engineering/permit/route.ts:838`

- **Upstream produced:** model.serviceRatedAmps = 400 and model.storage.gatewayCount = 2, logged by this very route at line 856-860. The route writes `body.project.serviceTopology = _m.topology` (845-847) and `electricalRevision` (850), and projects interconnectionMethod (819-821).
- **Downstream used instead:** No assignment to `body.project.mainPanelAmps` anywhere in the block. The permit sheets then read: `const svcAmps = project.mainPanelAmps || null` (lib/permit/sections/coverSheet.ts:83); `${project.mainPanelAmps || 200}A` on the MSP site-plan tag (lib/permit/sections/sitePlan.ts:74); `const mainAW = project.mainPanelAmps || 200` (lib/permit/sections/compliancePages.ts:401 and 662); `const mainPanelA = project.mainPanelAmps || 200` (lib/permit/utils/bomForPermit.ts:338, 564); `panelBusRating: input.project.panelBusRating || input.project.mainPanelAmps || 200, mainPanelAmps: input.project.mainPanelAmps || 200` (lib/permit/utils/computedRuns.ts:292-293); `mainPanelAmps: input.project.mainPanelAmps || 200` and `busRating: panelBusRating, mainBreaker: input.project.mainPanelAmps || panelBusRating` (lib/permit/generatePermit.ts:982, 999-1000).
- **Consequence:** One sealed package contains two service ratings: the SLD drawn from the graph at 400 A, the cover sheet / site plan / compliance pages / permit BOM at 200 A (or blank). The site plan prints ONE MSP tag on a two-MSP job. This is the output-consistency law broken inside a single artefact, and again the simple path cannot reveal it because 200 is its real answer.

##### 13.7.4 — [CRITICAL] `legacyServiceScalars` — the one sanctioned graph→scalar projection — has zero production consumers

`lib/electrical/topologyAuthoring.ts:815`

- **Upstream produced:** `{ mainPanelAmps: p?.busbarRatingA ?? null, mainPanelBusAmps: p?.busbarRatingA ?? null, mainBreakerAmps: p?.mainBreakerA ?? null, panelsNotRepresented: Math.max(0, (t?.panels?.length ?? 0) - 1) }` — including the explicit signal that the scalar is incomplete on a multi-panel job.
- **Downstream used instead:** Nothing. `grep -rn legacyServiceScalars` over the repo returns the definition and tests/topologyAuthoredThenAgreesEverywhere.postgres.test.ts:236-237 only. Every production consumer instead reads `project.mainPanelAmps ?? 200` / `|| 200` (the ten sites listed in the break above) or is handed `service.ratedAmps` by sld/route.ts:218 and bom/route.ts:244.
- **Consequence:** The correct answer is computed and discarded, which is why two different wrong values (the `|| 200` fallback and the service rating) both reach professional outputs. `panelsNotRepresented > 0` would have flagged every two-MSP job as un-describable by a scalar; nothing ever asks it.

##### 13.7.5 — [CRITICAL] The wizard's interconnection step appends a DUPLICATE point of interconnection, ignoring the one the generation-panel step already engineered

`lib/electrical/topologyPresets.ts:387`

- **Upstream produced:** applyPerSystemGenerationPanels (step 4's generation-panel radio) created one POI per domain with `relationship: 'manufacturer-integrated'`, derNodeId = the generation panel, connectedToNodeId = that domain's gateway — and it explicitly looks for an existing POI first (lib/electrical/topologyPresets.ts:594-611).
- **Downstream used instead:** applyDerArrangement('independent-branch') loops the domains and calls `addPointOfInterconnection(next, {... relationship, ...})` with no existence check (topologyPresets.ts:387-392), and `relationship` resolves to `'unresolved'` because storageConnection is now 'der-aggregation-panel' (lines 380-383 map only 'backed-up-panel-busbar' and 'gateway-panelboard'). addPointOfInterconnection appends unconditionally: `return { topology: { ...t, pointsOfInterconnection: [...existing, poi] }, poi }` (lib/electrical/topologyAuthoring.ts:598). applyDerArrangement removes nothing before adding, unlike applyPerSystemGenerationPanels (549-551) and applyIsolationArrangement (296-298).
- **Consequence:** Answering step 5 after step 4 — the order the wizard enforces — doubles the POI count and reintroduces an 'unresolved' relationship beside the resolved one. The permit then prints "INTERCONNECTION ARRANGEMENT REQUIRED — POINT OF INTERCONNECTION" (lib/permit/utils/serviceTopologySchedule.ts:431-433) on a job whose arrangement was just recorded, releaseReady goes false, and the SLD draws two points of interconnection per system. Toggling the arrangement radio back and forth adds two more each time.

##### 13.7.6 — [CRITICAL] Every disconnect the wizard creates is rated at the SERVICE rating, ignoring the branch and device ratings the graph already engineered

`components/engineering/ServiceTopologyWizard.tsx:763`

- **Upstream produced:** branches[].ratedAmps = 200 per path (topologyPresets.ts:126-133), and lib/electrical/serviceTopology.ts:1689-1706 computes each device's real requirement from the node it interrupts via `inlineRequirementA(topology, dev.inlineOnNodeId)`. applyIsolationArrangement('one-per-path') correctly uses `ratedAmps: b.ratedAmps` (topologyPresets.ts:328).
- **Downstream used instead:** `ratedAmps: draft.service.ratedAmps` — applied identically to all four DISCONNECT_ROLES, including gateway-isolation and ess-disconnect (ServiceTopologyWizard.tsx:760-767).
- **Consequence:** On the 400 A job, ticking the roles produces a 400 A ESS disconnect for a 60 A Powerwall breaker, a 400 A gateway isolation on a 200 A path, and a 400 A non-inline utility isolation device — the exact thing Ray forbade ("Do not invent a common 400 A knife-blade switch ... merely because the service is 400 A", quoted in this file at 674-678). Those ratings are scheduled, drawn and bought. On the simple path the same code writes 200 A, which is plausible, so the defect never surfaces there.

##### 13.7.7 — [CRITICAL] The three-state `externalDerIsolationRequired` is bound to a two-state checkbox; an untick writes a definite `false` that SILENCES three authority checks

`components/engineering/ServiceTopologyWizard.tsx:661`

- **Upstream produced:** `externalDerIsolationRequired: boolean | null` (lib/electrical/serviceTopology.ts:824), where null means "not resolved for this jurisdiction" and produces a NOT_EVALUATED check naming the token (serviceTopology.ts:1742-1745).
- **Downstream used instead:** `checked={draft.interconnection.externalDerIsolationRequired === true} onChange={e => setInterconnection(draft, { externalDerIsolationRequired: e.target.checked })}` — identical at ServiceNodeInspector.tsx:409-413 and ServiceTopologyBuilder.tsx:642-644. A tick-then-untick writes `false`, which is indistinguishable from a utility ruling.
- **Consequence:** With `false`, serviceTopology.ts pushes NO `interconnection.der-isolation` check at all (the `else if (ic.externalDerIsolationRequired)` at 1746 is skipped and the null branch cannot fire), and the whole coverage/acceptance block is gated out by `if (sources.length > 0 && ic.externalDerIsolationRequired !== false)` (line 1806) — removing interconnection.der-isolation-coverage AND interconnection.isolation-accepted. A design with a knife switch drawn on it ships with no DER-isolation finding and no "JURISDICTION / UTILITY ACCEPTANCE REQUIRED" line. This is most likely on the simple path, where ComEd's 200 A exception makes the operator reach for that checkbox.

##### 13.7.8 — [CRITICAL] Gateway multiplicity is computed only for microinverter systems, so the BOM's gateway count ignores `domains.length`

`lib/equipment/integratedBos.ts:1001`

- **Upstream produced:** model.storage.gatewayCount = topology.domains.length = 2 (lib/electrical/projectModel.ts:567), and equipmentInstancesFromTopology emits one 'gateway' instance per domain (lib/electrical/topologyEquipment.ts:75-80).
- **Downstream used instead:** `function withSingleSystemMultiplicity(plan, ctx) { if (!ctx.isMicro) return plan; ...` (integratedBos.ts:1000-1006), and the count is then solved from Enphase branch sources, not domains (`gatewayMultiplicityForPlan(plan, ctx.branchSources ...)`, line 1002). With no multiplicity stamped, `planGatewayCount` falls back to `planLandingDevice(plan) ? 1 : 0` (integratedBos.ts:1012), and bom-engine-v4.ts:3907 reads `Math.max(1, plan.gatewayMultiplicity?.count ?? 1)`.
- **Consequence:** On a Tesla / string-coupled two-gateway job the integrated-BOS plan reports ONE gateway no matter what the graph holds; the cover-sheet tag row that says "SHARED PANEL FOR THE N GATEWAY OUTPUTS" (lib/permit/sections/coverSheet.ts:357-358) and the compliance page multiplicity note (compliancePages.ts:736) therefore describe a one-gateway site. The graph's own count only reaches the BOM through the separate bomFromServiceTopology merge (app/api/engineering/bom/route.ts:620-674), so the two halves of the same BOM disagree about how many gateways exist.

##### 13.7.9 — [MAJOR] "How do these systems connect to the service?" is asked unconditionally, and its unanswered state blocks the drawing on a one-system house

`components/engineering/ServiceTopologyWizard.tsx:500`

- **Upstream produced:** topology.branches.length === 1 and topology.domains.length === 1. describeArrangementFor even composes the correct sentence for it — `n === 1 ? '' : 's'` at lib/electrical/topologyPresets.ts:232 — so the data knows there is one system.
- **Downstream used instead:** The heading and `DER_ARRANGEMENT_CHOICES.map(...)` render with no guard on draft.branches.length or draft.domains.length (ServiceTopologyWizard.tsx:500-526), offering 'Independent systems' / 'One combined generation panel' / 'Custom'. The check behind it is gated only on DER source count: `const sources = derSources(topology); if (sources.length > 0) { ... unknown('interconnection.arrangement', ..., ['interconnection.derArrangement']) }` (lib/electrical/serviceTopology.ts:1780-1794).
- **Consequence:** A 200 A / one MSP / one Gateway house is asked how two systems combine — a question with one possible answer — and until it answers, serviceTopologyReleaseReadiness pushes "DESIGN DECISION REQUIRED — DER INTERCONNECTION ARRANGEMENT" (lib/permit/utils/serviceTopologySchedule.ts:428-430) into `blocking`, so `releaseReady` is false (line 485). 'loads.model' is the ONLY optional token (serviceTopology.ts:926), so nothing else lets it through.

##### 13.7.10 — [MAJOR] The isolation-arrangement radio can never show as selected on a single-branch service, in both the wizard and the inspector

`components/engineering/ServiceTopologyWizard.tsx:684`

- **Upstream produced:** applyIsolationArrangement('one-per-path') on a one-branch topology creates exactly ONE device, with `inlineOnNodeId` set to that branch's gateway and `ratedAmps: b.ratedAmps` (lib/electrical/topologyPresets.ts:320-333).
- **Downstream used instead:** `const selected = choice.id === 'one-per-path' ? isolators.length > 1 && isolators.every(d => !!d.inlineOnNodeId) : isolators.length === 1 && !isolators[0].inlineOnNodeId;` — ServiceTopologyWizard.tsx:684-686, duplicated verbatim at ServiceNodeInspector.tsx:435-437.
- **Consequence:** With one branch, 'one-per-path' fails `isolators.length > 1` and 'common-service' fails `!inlineOnNodeId`, so BOTH radios render unchecked after the operator has chosen one. The answer is in the graph and the screen says nothing was answered; the operator re-clicks, and applyIsolationArrangement deletes and rebuilds the device each time, churning the device id. The accompanying note is also wrong for one branch: "Utility / AHJ acceptance of 1 independent isolation switches (one per path) rather than a single common device is not established" (topologyPresets.ts:344-347).

##### 13.7.11 — [MAJOR] The disconnect-role checkbox silently answers the isolation-arrangement question that sits above it on the same screen

`components/engineering/ServiceTopologyWizard.tsx:757`

- **Upstream produced:** applyIsolationArrangement is the authority for der-isolation-disconnect devices: it removes every existing isolator before building the chosen arrangement, so that "two arrangements both present would be two answers" (lib/electrical/topologyPresets.ts:295-298).
- **Downstream used instead:** The DISCONNECT_ROLES checkbox for role 'der-isolation-disconnect' calls `addProtectiveDevice(draft, { label: spec.label, roles: [spec.role], ratedAmps: draft.service.ratedAmps, ... })` with no inlineOnNodeId and no removal (ServiceTopologyWizard.tsx:757-767).
- **Consequence:** On the simple path, ticking that checkbox creates one non-inline, service-rated isolator — which makes the 'common-service' radio above read as selected (`isolators.length === 1 && !inlineOnNodeId`), so a role checkbox has answered the arrangement question by side effect. On the 400 A path it ADDS a third isolator beside the two inline ones, and `interconnection.isolation-accepted` then reports the design as "3 separate devices" (lib/electrical/serviceTopology.ts:1828-1831) while the arrangement radio deselects.

##### 13.7.12 — [MAJOR] The wizard opens defaulted to the complex job: 400 A and two main panels

`components/engineering/ServiceTopologyWizard.tsx:69`

- **Upstream produced:** Nothing upstream — this is where the service is first stated. SERVICE_SIZE_CHOICES offers [100,125,150,200,320,400,600,800] (lib/electrical/topologyPresets.ts:29) and DISTRIBUTION_PRESETS leads with 'one-main-panel' (topologyPresets.ts:61-67).
- **Downstream used instead:** `useState(initial?.service.ratedAmps ?? 400)` (line 69) and `useState('two-main-panels')` (line 71). Step 2 then describes "Two 200 A service branches, each feeding its own 200 A main panel" as the pre-selected arrangement, and pressing Next materialises it.
- **Consequence:** A 200 A one-MSP house that advances through the wizard without changing both defaults gets a 400 A service with two 200 A branches and two panels built and persisted. Because `distribution` is wizard-local state that is never saved, re-entering guided setup on a saved one-MSP job again shows 'two-main-panels' selected. The simple path's first two answers must both be corrections.

##### 13.7.13 — [MAJOR] The SERVICE DISTRIBUTION enclosure is drawn on every sheet, including a one-branch service that has none

`lib/sld-professional-renderer.ts:3574`

- **Upstream produced:** topology.branches.length === 1, topology.panels.length === 1 — the engineered fact that the service lands directly in the MSP. The graph models no distribution enclosure object at all.
- **Downstream used instead:** `const dist = drawBox('service-distribution', cxDist, opts.busY, W_DIST, distLines);` with no branch-count guard (sld-professional-renderer.ts:3574), labelled from `{ t: `${ex ? 'EXISTING ' : ''}${serviceRatingLabelSld(t)} SERVICE ${ex ? 'EQUIPMENT' : 'DISTRIBUTION'}` }` and `{ t: `${t.branches.length} SERVICE BRANCH${t.branches.length === 1 ? '' : 'ES'}` }` (3559-3563). The same node is added unconditionally in the graph builder: `const distribution = add({ id: 'service-distribution', type: 'SERVICE_DISTRIBUTION', ... qty: topology.branches.length })` (lib/sld/serviceTopologyGraph.ts:206-211).
- **Consequence:** A simple one-MSP sheet shows a "200 A SERVICE DISTRIBUTION / 1 SERVICE BRANCH" enclosure upstream of the MSP it is also drawing — two enclosures where one exists, with a feeder between them that is not installed. The label is correct only on the existing-equipment case the comment at 3552-3557 was written for.

##### 13.7.14 — [MAJOR] The compliance / sizing tab takes the architecture from the POST body and never compares it with the canonical coupling it just loaded

`app/api/engineering/calculate/route.ts:49`

- **Upstream produced:** The route loads the canonical model and keeps `_canonicalCoupling = _loaded.model.solarCoupling` plus `_dcLimits = dcStringLimits(...)` (lines 89-99).
- **Downstream used instead:** `let electrical = body.electrical;` (line 54) and `const bodyTopologyType = String(body.topologyType ?? '').toUpperCase();` (line 49), which then force `type: 'optimizer'` onto every inverter the body carries (55-65). `_canonicalCoupling` is never compared with `bodyTopologyType`, and the catch at 100-105 states the contract outright: "A read failure leaves the posted body in charge, which is today's behaviour."
- **Consequence:** The sidebar's sizing and compliance numbers are computed from the page's React state — exactly the store projectModel.ts:33 declares to be "UI draft only; never project authority" and which app/engineering/page.tsx:2317-2338 will even restore from localStorage['eng-config-<projectId>'] when the DB has no config. A DC-coupled Tesla graph can size against an optimizer topology on this tab while the SLD draws the batteries' DC inputs.

##### 13.7.15 — [CRITICAL] There is no single-system fixture; the only one-domain shape in the repo is labelled a defect reproduction

`lib/electrical/fixtures/tesla400aTwoGateway.ts:48`

- **Upstream produced:** `domainIntents` always returns two intents — `[mk('domain-a','System 1'), mk('domain-b','System 2')]` (line 140) — and `service.ratedAmps: 400` is hard-coded (line 340).
- **Downstream used instead:** The only way to get one domain is `/** Set true to reproduce the defect: everything collapsed onto ONE gateway and ONE panel. */ collapseToSingleGateway?: boolean;` (lines 48-49), which still leaves a 400 A service and relabels the branch "400 A service path 1" feeding a 200 A panel (lines 207-212). lib/electrical/fixtures/ contains this one file.
- **Consequence:** Nothing in the suite exercises a legitimate 200 A / one-MSP / one-Gateway job end to end, so every count-blind code path above is unconstrained for it — and the one shape that resembles it is asserted to be wrong. `grep` over tests/ shows all fifteen consumers of this fixture building the two-system case.

##### 13.7.16 — [MAJOR] The empty-state wizard is mounted without the project's meter-collar authority, and nothing in the codebase ever supplies it

`components/engineering/ServiceTopologyBuilder.tsx:191`

- **Upstream produced:** The prop exists for exactly this: "Known constraints from the project authority, applied before the operator can choose wrongly" (ServiceTopologyWizard.tsx:48-49), and the edit-mode mount does pass it: `meterCollarPermitted={topology.interconnection.meterCollarPermitted}` (ServiceTopologyBuilder.tsx:403).
- **Downstream used instead:** `<ServiceTopologyWizard onBuilt={t => {...}} />` with no meterCollarPermitted (ServiceTopologyBuilder.tsx:191-193), so the default `meterCollarPermitted = null` (ServiceTopologyWizard.tsx:64) is written into the new graph by `setDraft(setInterconnection(built.topology, { meterCollarPermitted }))` (line 88). Across lib, app and components, the only writers of this field are the wizard select, ServiceNodeInspector.tsx:377 and ServiceTopologyBuilder.tsx:625 — no jurisdiction, utility or AHJ record feeds it.
- **Consequence:** A meter-collar / Backup Switch interconnection is the normal arrangement on a 200 A single-MSP house, so the simple path's defining question starts as 'Not established' on every new project and must be answered by hand, with no authority behind the answer. Selecting the collar then produces a POI whose relationship maps to null in interconnectionMethodScalar, which drops the project into the `?? 'LOAD_SIDE'` fallback above.

##### 13.7.17 — [MAJOR] The wizard's six questions do not include the one input the readiness gate demands first

`components/engineering/ServiceTopologyWizard.tsx:41`

- **Upstream produced:** `sccr.chain` is pushed unconditionally and names its token: `unknown('sccr.chain', 'site', 'Fault-current compatibility', ..., ['service.availableFaultCurrentA'], 'NEC 110.9 / 110.24')` (lib/electrical/serviceTopology.ts:1636-1640), and every device, gateway and panel in the chain is then checked against it (1631-1634).
- **Downstream used instead:** `const STEPS = ['Service', 'Distribution', 'Backup', 'Equipment', 'Interconnection', 'Disconnects'];` (line 41) — availableFaultCurrentA appears in no step. It is reachable only through ServiceNodeInspector in Advanced.
- **Consequence:** Both paths finish "Create this service" and land immediately on "NOT EVALUATED — AVAILABLE FAULT CURRENT REQUIRED" (lib/permit/utils/serviceTopologySchedule.ts:409-411), which is blocking. On the simple path this is the first thing the operator sees after being asked four questions that did not apply to their job.

##### 13.7.18 — [MAJOR] Every disconnect role the wizard offers immediately becomes a blocking "equipment selection required" the wizard cannot clear

`components/engineering/ServiceTopologyWizard.tsx:752`

- **Upstream produced:** serviceTopology.ts:1716-1722 emits one `device.selection` NOT_EVALUATED per device with no productId, requiring ['device.productId'] — correct behaviour ("A calculated minimum rating is not a purchase").
- **Downstream used instead:** The DISCONNECT_ROLES checkboxes create devices with label, roles, ratedAmps, lockableOpen, visibleOpen and locationNote and no productId (ServiceTopologyWizard.tsx:760-767), and the wizard exposes no catalogue field at any step. The only part input is `data-testid={`ic-product-${d.id}`}` in ServiceNodeInspector.tsx:577-582.
- **Consequence:** Ticking the four roles on a simple house adds four blocking requirement lines ("NOT EVALUATED — DISCONNECT / SWITCH EQUIPMENT SELECTION REQUIRED", serviceTopologySchedule.ts:451-453) that the guided flow has no control to answer, so the simple path is forced into Advanced to finish what the wizard started.

---

## 14. What the deep trace says about repair order

Not a redesign — an order. Nothing here adds a source of truth or removes an engineering path.

**First, because they are live defects on outbound documents:** the PDF route's Fronius (11.1), the `UNRESOLVED` branch (11.2), the fail-open link (11.3), the `subSystems` asymmetry (11.4), the self-contradicting schedule (11.5), the five `?? 'LOAD_SIDE'` sites the one `SUPPLY-SIDE TAP` default (11.6), and the unreachable BOM guard (11.7).

**Second, Pattern A — wire the nine owners that already exist.** Every one is a consumer change. `configStringPanelCounts` on the SLD route is the whole of item 4 of the gauntlet: the canonical string engine does not need building, because your committed 10/9/9/9 is already the authority and `computed-system.ts:1292-1294` already prefers it. It just is not handed over.

**Third, Pattern D — every refusal that currently resolves to permissive.** This is Rule Six finished properly: `NONE / UNKNOWN / SELECTED / CONFLICT` needs a branch in each evaluator, not just a value in the model.

**Fourth, Pattern C — the four name collisions.** `mainPanelAmps` on the SLD route first, since it is the one that already produced a permissive safety result.

**Fifth, Pattern E — stop the renderer deciding.** This is only safe after 10.3: the renderer compensates because nothing hands it conclusions. Remove the compensation before the conclusions arrive and the sheets get worse, not better.

**Item 6 of the gauntlet, the simple-job UX, is section 13.7** and it is larger than the one ungated question Part I found: the wizard **opens defaulted to 400 A and two main panels** (`ServiceTopologyWizard.tsx:69`), its three-state isolation flag is bound to a two-state checkbox so an untick writes a definite `false` that silences three authority checks (`:661`), every disconnect it creates is rated at the **service** rating rather than the branch rating it already engineered (`:763`), and *"Create this service"* persists nothing until a separate Save (`ServiceTopologyBuilder.tsx:191`). There is also **no single-system fixture in the repo** — the only one-domain shape is labelled a defect reproduction (`tesla400aTwoGateway.ts:48`), which is why the simple path keeps regressing unnoticed.

---

*Part II ends here. Nothing in it has been implemented. Seven items in section 11 are live defects I previously reported as repaired, and they are the only part of this document I would act on without discussing first.*

<br>

# PART III — THE REPAIR LEDGER

*Opened 2026-10-02, when Ray said: "Stop auditing — execute the engineering chain repair."*

Status vocabulary, as specified:

| Status | Means |
|---|---|
| **OPEN** | Not started, or started and not landed. |
| **IMPLEMENTED** | The code change is in and `tsc` is clean. Proves nothing on its own. |
| **PRODUCTION PATH PROVEN** | A test drives the real caller — the route handler, with the body the browser actually sends — and the artefact it returns is asserted. |
| **ADVERSARIAL PROVEN** | The defect was restored byte-for-byte and the guard turned RED. |
| **LIVE ACCEPTED** | Ray saw it correct in his own browser. **I do not set this.** |

> **Nothing below is marked LIVE ACCEPTED.** Every row stops at ADVERSARIAL PROVEN, which is as far as I am allowed to take it.

## Phase 1 — the seven live repairs

| # | Repair | Status | Adversarial proof |
|---|---|---|---|
| 11.1 | The exported PDF fabricated a `Fronius Primo 8.2-1` and defaulted `topologyType` to `STRING_INVERTER`. Both SLD routes now call ONE `projectCanonicalArchitecture`. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.2 | `UNRESOLVED` matched no branch of the 705.12(B) evaluator and refused in silence. Now an explicit `NOT_EVALUATED` with reason / required input / authority / blocked calculation. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.2b | The permit's own normaliser collapsed every unmappable state into `LOAD_SIDE`. `UNRESOLVED` / `MANUFACTURER_INTEGRATED` / `METER_COLLAR` are now preserved. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.3 | `pvCoupledToStorage` failed OPEN — a dropped fetch re-armed the auto-pick. The read is now tri-state and suppresses on ignorance. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.4 | The subsystem mirror had no explicit clear for an inverter, so a retirement left it in place. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.4b | The retirement route cleared `engineering_config.inverters` but not `.subSystems`, which the page re-synthesises a fleet from. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.4c | A THIRD snapshot promotion (`lib/db/production.ts`) was unguarded. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.5 | The equipment schedule printed `4 × 9 panels` under `Total Modules 37`. It now states the real per-string array, or says `REQUIRES RE-DERIVATION`. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.5b | The SLD route was the one caller that did not pass `configStringPanelCounts`, so `computeSystem` equal-divided while the renderer got the real array. Now gated on the assignment being ACTIVE, summing to the module count **and fitting the DC window** — see §1 below, where my first version shipped the retired assignment. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |
| 11.6 | `?? 'LOAD_SIDE'` closed at the SLD/PDF/BOM input builders, `generatePermit`, `sldAdapter` and the normaliser. **The three sealed-snapshot sites are deliberately FROZEN** — closing them rotates `meta.digest` and retires live PE approvals. See §2 below. | **PARTLY — see §2** | covered by 11.2b's mutation |
| 11.7 | The browser refilled the absence the BOM route had been taught to keep, making the server guard unreachable. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |

And the invariant that the whole of 11.1 exists to hold:

| Invariant | Status | Adversarial proof |
|---|---|---|
| The SVG route and the PDF route call the SAME canonical projection — a partial second copy cannot exist. | **ADVERSARIAL PROVEN** | ✅ guard went RED (+1) |

**Mutation run: 11 restored defects, 11 turned the guard red.** All repairs verified back in place afterwards (9/9).

## 🚨 THREE THINGS THE REGRESSION RUN CAUGHT, AFTER THE MUTATION RUN WAS GREEN

The seven repairs were implemented, production-path proven and adversarially proven. Then the
wider suite ran, and three existing guards failed. All three were right.

### 1. I passed the retired 10/9/9/9 assignment to the engine — the exact thing you forbade

`tests/liveSldFailure.postgres.test.ts` failed with:

```
String Voc × 1.25 is 672.9 V, above the Powerwall 3's 550 V PV input maximum
```

Wiring `configStringPanelCounts` (11.5b) handed `computeSystem` the recorded assignment, and my
guard checked only that it **summed to 37**. It does — 10+9+9+9 — and its first string is a
10-module string that prints 672.9 V against a 550 V DC input. You said it in the instruction:

> "RETIRED assignment → history only → may not become active by being passed to computeSystem."

A sum is not compatibility. The gate now also checks every string against the DC window the
canonical projection established — from the **storage** on a DC-coupled job, via `dcStringLimits`,
on the same NEC 690.7 `× 1.25` basis the sheet prints. An assignment with any string over the
limit is refused, logged as `STRING ASSIGNMENT REQUIRES RE-DERIVATION`, and the engine re-derives
against the real endpoint. **Status: ADVERSARIAL PROVEN** — the pre-existing guard is the proof,
and it went red before the gate and green after.

### 2. Closing `?? 'LOAD_SIDE'` in the SEALED SNAPSHOT moves `meta.digest` — and that retires every live PE approval

`tests/permitStandaloneGateway.test.ts` lost three of its four HEAD digests. The fourth, which
records `SUPPLY_SIDE_TAP`, did not move — so only designs that **never stated an interconnection**
are affected, which is exactly the population whose sealed record is currently wrong.

`canonicalDigestBody` hashes everything except `meta.digest`, `meta.snapshotId` and
`resolverAttemptEvidence`. `findActiveApproval` matches on an EXACT digest. So the same unchanged
design rebuilds to a new hash, finds no approval row, and drops to **PENDING ENGINEERING REVIEW**.

Your own rule on this is explicit: accept a one-time global digest rotation **and** plan the
approval-ledger migration deliberately — *never as a side effect of another repair.*

**So I stopped.** Three sites in `lib/permit/snapshot/build.ts` now call a local
`digestFrozenInterconnectionToken` that reproduces the pre-repair bytes, with the whole reason
written into the source above it. Everything else is closed.

| Surface | `?? 'LOAD_SIDE'` | Status |
|---|---|---|
| `sld/route.ts` (×4), `sld/pdf/route.ts`, `bom/route.ts` | closed | **ADVERSARIAL PROVEN** |
| `permitInterconnectionToken` — the normaliser all permit consumers ask | closed | **ADVERSARIAL PROVEN** |
| `generatePermit.ts` → `mapComputedSystemToCompliance` (the deciding engine's input) | closed | **PRODUCTION PATH PROVEN** |
| `generatePermit.ts` → the `=== 'supply-side' ? 705.11 : 705.12(B)` binary | closed (three-way) | **IMPLEMENTED** |
| `sldAdapter.ts` — what the permit DRAWS | closed | **PRODUCTION PATH PROVEN** |
| **`snapshot/build.ts` ×3 — the sealed, digested record** | **FROZEN** | **OPEN — needs your decision** |

> **The consequence, stated plainly: a released permit for a design with no recorded point of
> interconnection still reads LOAD_SIDE and still cites NEC 705.12(B).** Nothing downstream of
> that file believes it any more. The sealed record does. Closing it is a one-line change plus a
> digest rotation and an approval-ledger migration, and that is your call, not mine.

### 3. Removing the default changed what the permit DRAWS, not just what it says

Three more assertions in the same file failed with `CONS (MODE TBD)` where they expected
`CONS (NET)`, and then with a null consumption-CT placement.

Both are correct, and both were **unreachable** before. The consumption CTs clamp *relative to the
point of interconnection*, so `lib/equipment/designMetering.ts:257` refuses to place them when the
boundary is `'unresolved'`, and `currentTransformers.ts:712` has the sentence written for it —
*"the interconnection side is not established, so no metering mode follows from it."* With absence
collapsed to `LOAD_SIDE`, the CTs were drawn at a **guessed** location carrying the label
`DEFAULT PER INTERCONNECTION — FIELD VERIFY`, and the schedule asserted NET.

I did not edit those expectations to go green. That test's subject is the standalone gateway, and
it depended on a default it never meant to assert — so its precondition is now **written down**
(`interconnectionMethod: 'LOAD_SIDE'`), it tests the gateway again, and the absence case got its
own test in the repair suite instead. Two other assertions there hardcoded
`interconnectionRaw: 'LOAD_SIDE'` on one side of a *consistency* comparison while the other side
read the project — agreeing only because both were the same guess. Both sides now go through one
normaliser.

**Still OPEN from this:** a design with no recorded interconnection now draws no consumption CT
and prints `MODE TBD`, which is honest but silent. Your standard is that every NEEDS INPUT
explains what, why, who and what it blocks — so this should print a NEEDS-INPUT row rather than an
absence. Not done.

## Phase 2 — Pattern A, owner by owner

Ray's method, per owner: confirm it represents the intended semantic fact, connect the real
consumer, remove the competing read, prove the old path cannot win.

| Owner | Status | What happened |
|---|---|---|
| `configStringPanelCounts` | **ADVERSARIAL PROVEN** | 11.5b. The SLD route was the one caller that skipped it. Now gated on active + sums + **fits the DC window**. |
| **canonical module count** (`ElectricalProjectModel.moduleCount`) | **ADVERSARIAL PROVEN** | Zero consumers anywhere in the repo while `/api/engineering/bom` sized the parts list from `body.moduleCount \|\| body.totalPanels`. The route already held the model. Both spellings are now projected from it, a disagreement is logged, and a project with no layout count has **nothing invented**. Proof posts a deliberately stale `20` against a 37-module design; the mutation that stops projecting turns it red (exit 1), and the repair green (exit 0). |
| `TopologyEvaluation` | **OPEN — and my Part I claim was overstated** | Part I §2.1 said the topology's conclusions "reach no professional output". **Not accurate.** `lib/sld-professional-renderer.ts:4253` computes `evaluateServiceTopology` itself and uses it at `:5342`, `:6018` and `:6142` (the schedule-row overlay). What is true is narrower and still serious: the conclusions **gate nothing** — `architectureGate.ts:21` refuses only on the coupling conflict, so a FAIL on the busbar rule, on `service.branch-sum` or on DER isolation still produces an SLD, a BOM, a priced proposal and a permit. Making a FAIL block a drawing is a real behavioural decision, so it is not something I am doing unilaterally at the end of a repair pass. |
| `PermitSystemModel` | **OPEN** | reported as reaching the renderer and never being read — the "single source of truth bridge". Next. |
| `ComputedSystem.bomQuantities` | **OPEN** | produced, merged, posted, forwarded, declared; zero readers. |
| `electricalRevision` on the permit input | **OPEN — digest hazard** | zero readers, so a graph change cannot move the permit digest. Giving it a reader may itself rotate the digest — same constraint as §2 above. Needs the same deliberate decision. |
| `legacyServiceScalars` | **OPEN — do not flatten** | the sanctioned graph→scalar projection, zero callers. Ray: `panelsNotRepresented > 0` must be respected; a 400 A / 2 × 200 A service **cannot** be described by one `mainPanelAmps`, so the consumer gets migrated rather than the graph flattened. |
| `acSourcesFromTopology` | **OPEN** | zero callers; the Compliance path still uses `resolveBatteryBranch(batteryId, batteryCount)`. |
| `buildServiceTopologyGraph` | **OPEN** | zero callers; documented replacement for the drawing's service half. |

## What the repair actually changed, in one place

| New / changed | Why |
|---|---|
| `lib/electrical/canonicalSldProjection.ts` *(new)* | The ONE projection. The SVG route lost 211 inline lines; the PDF route lost its partial copy. Both now call it with the same arguments. |
| `lib/electrical/fixtures/normalResidence200a.ts` *(new)* | **SolarPro had no fixture for an ordinary house.** `lib/electrical/fixtures/` held one file — the 400 A job — and its only one-domain shape is documented "Set true to reproduce the defect". Every electrical guard was written against the hardest site in the product. |
| `tests/engineeringChainRepair.postgres.test.ts` *(new)* | 21 tests through real route handlers on real PostgreSQL, with the body the browser sends. |
| `InterconnectionMethod` + `isNecEvaluableInterconnection` | The unmappable states are in the TYPE, so an evaluator cannot silently inherit the LOAD_SIDE branch. Widening it made the compiler name four consumers that had assumed two code bases. |
| `InterconnectionResult.conclusion` / `.notEvaluated` | `passes: false` cannot distinguish "the rule ran and failed" from "the rule could not run". |
| `busbarRule: 'not-evaluated'` | This field is read as the CODE BASIS. Labelling an unevaluated interconnection `120%` asserts an article nobody established. |

## Guards I had to CHANGE, and why that is not cheating

Four existing guards went red on a correct change. Every one of them pinned a TOKEN'S LOCATION rather than the requirement:

| Guard | What it pinned | Why it broke | What it asserts now |
|---|---|---|---|
| `electricalAuthorityInspector` — PDF consumes the graph | `loadElectricalProject`, `serviceTopology:`, `buildInput.mainPanelAmps = `, `interconnectionMethodScalar` **inline in the PDF route** | the tokens moved into the shared module | the shared module does the whole job (ten assertions, including the four the partial copy was missing) **and** both routes call it |
| `electricalAuthorityInspector` — no route fabricates | the same tokens per route | same | each surface either calls the projection or does it itself |
| `electricalAuthorityLifecycle` — the load effect | a regex containing `{ setSvcTopology(null); setElectrical(null); return; }` verbatim, and the literal `setSvcTopology(t);` | the effect gained a third state | the effect is LOCATED by its fetch, and asserted on its dependencies and its writes |
| `legacyArchitectureProvenance` — one DC-window derivation | `@/lib/electrical/dcStringLimits` imported **by the SLD route** | it is imported by the projection now | the projection imports it and both routes reach it |

> **The first two of those were GREEN while the exported PDF drew a string inverter for a DC-coupled project.** A token-presence guard cannot see that two copies of a projection disagree. That is the lesson, and it is why the replacements assert ONE implementation rather than N copies of a token.

## Still OPEN

| Item | Status | Note |
|---|---|---|
| Phase 2 — wire the remaining Pattern A owners | **IN PROGRESS** | see the Phase 2 table below. |
| Phase 3 — the remaining permissive collapses | **OPEN** | missing compliance block → PASS; missing DC run → PASS; inapplicable → `✓ PASS`; VAL-1 printing ALL CHECKS PASSED. |
| Phase 4 — `aggregateServiceRatingA` / `panelBusbarRatingA` / `panelMainBreakerA` | **OPEN** | the `mainPanelAmps` collision is still live at `sld/route.ts` — the busbar still falls back to it. Fixture A records all three separately so the repair has something to prove against. |
| Phase 5 — make the renderers dumb | **OPEN** | deliberately after Phase 2. Removing the renderer's compensation before the conclusions reach it makes the sheets worse, not better. |
| Phase 6 — the normal 200 A experience | **PARTLY** | the fixture exists (Fixture A). The wizard's 400 A/two-panel default, the ungated multi-system question, the tri-state isolation flag on a checkbox, service-derived disconnect ratings, and "Create this service" not persisting are all still OPEN. |
| `page.tsx` — ~15 remaining `config.interconnectionMethod ?? 'LOAD_SIDE'` payload sites | **OPEN** | these read a field that now defaults to `'UNRESOLVED'`, so the `??` fires only for legacy configs. Lower risk than the output-authority sites already closed, and next. |
| `MICROINVERTERS[0]` as the seed for an inverter the user just ADDED | **OPEN, by judgment** | `page.tsx` `newInverter('micro')` and the topology switch need a starting model for a device the user explicitly created. That is a design-time seed on an explicit click, not an output filling an absence — so I left it and am telling you rather than quietly including it. |

> A malformed compliance payload reports **503 DB_STARTING**: `normalizeGauge(undefined)` throws inside the engine and `handleRouteDbError` classifies everything non-config as "database starting". Found while writing Fixture A's test. Not fixed — it is a diagnosability defect, not an engineering one, and it is listed so it is not lost.
