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
