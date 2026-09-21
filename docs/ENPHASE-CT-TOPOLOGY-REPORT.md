# Enphase CT / metering topology — consolidated report

**Date:** 2026-09-21 · **Status:** REPORT ONLY. No CT or interconnection code has
been written. Nothing below has been implemented.

Sources: Enphase IQ Gateway / IQ Gateway-M installation manuals, the "Installing
Consumption CTs" tech brief, the Current Transformer installation guide, the IQ
Combiner 6C and IQ Gateway datasheets, the IQ Battery comparison page, and
TEB-00282. Repo claims below were re-verified directly against the source tree,
and one research claim was found wrong and is corrected in §2.

---

## 1. Manufacturer truth

### 1.1 Terminology — "Envoy 6C" does not exist

There is no Enphase product called an Envoy 6C. The product is the **IQ Combiner
6C** (`X-IQ-AM1-240-6C`), an enclosure that *contains* an integrated **IQ
Gateway**. "Envoy" is the retired name for the gateway (Envoy → Envoy-S → IQ
Envoy → IQ Gateway); some distributor listings still read "IQ Combiner 6C with
Envoy Gateway", which is the likely origin of the term.

The 4th-generation hierarchy:

```
IQ Combiner 6C        enclosure: PV + DER busbars, breakers, DER relay,
                      integrated load controller, INTEGRATED CTs, integrated IQ Gateway
  IQ Meter Collar     Form 2S meter-socket adapter: MID relay + integrated consumption meter
  IQ Battery 10C/10CS AC battery, four grid-forming / neutral-forming microinverters
```

The **IQ System Controller is not part of 4th gen.** TEB-00282: *"IQ Battery
10C/10CS and IQ Combiner 6C do not work with any variants of the IQ System
Controller."* The 6C quick-install guide says a collar with the 6C "enables
multi-mode (grid-forming) installations, eliminating the need for the IQ System
Controller."

### 1.2 The three current channels (PV-only)

| channel | device | measures |
|---|---|---|
| **P1 production** | CT-200-SOLID, solid-core, revenue-grade ANSI C12.20 class 0.5 | PV branch current only |
| **C1 / C2 consumption** | CT-200-SPLIT or CT-200-CLAMP, one per ungrounded leg | depends entirely on WHERE they sit |
| **C3** | battery CT | storage metering, **not** a third consumption CT |

IQ Gateway datasheet: *"Metering ports: Up to two Consumption CTs, one Production
CT, and one battery CT (for IQ Battery 5P)."* That is an authoritative CT-count
limit. The same datasheet makes **Load with solar** a *requirement* for export
limiting.

### 1.3 The whole PV-only question is one decision

What current physically passes through the consumption CTs — and therefore which
meter mode is arithmetically correct.

**LOAD WITH SOLAR** (legacy label "Net"). CTs between the utility meter and the
main load centre, upstream of the PV backfeed breaker. They carry **net service
current** (`I_load − I_PV`), signed, going negative on export.
→ grid import/export is **measured**; consumption is **derived** = net grid + production.

**LOAD ONLY** (legacy "Total (Gross)"). CTs between the main load centre and the
loads, downstream of where PV lands. They carry **total load current**, always
positive.
→ gross consumption is **measured**; grid import/export is **derived** = consumption − production.

Enphase states the rule verbatim (IQ Gateway-M manual):

> "If the circuit that passes through the consumption CTs includes load with
> solar production, leave the type set to Net. If the circuit that passes through
> the consumption CTs includes load only, change the type to Total (Gross)."

### 1.4 THE SPECIFIC QUESTION ASKED: consumption CTs downstream of a supply-side interconnection

**Answer: Load Only, and it is the only valid mode.**

When PV interconnects on the **supply side** (NEC 705.11) or at the meter, the
service conductors *downstream* of the tap carry only household load current —
PV never flows through them; it flows from the tap node either into the load bus
or back upstream to the grid. Consumption CTs placed there legitimately measure
gross load.

Enphase, "Installing Consumption CTs": *"Total – If the solar array is line side
connected or if the solar production CT is installed on a separate circuit from
the consumption CTs, then select Total."*

**When it becomes invalid:** the moment any load is fed *ahead* of the
consumption CTs, or any PV lands *downstream* of them. A mixed
supply-side + breaker-backfeed system is the classic failure — the CTs then read
neither gross load nor net grid, and **neither mode is correct**. There is no
third mode. The correct product behaviour is to refuse, not to pick one.

**When the boundary falls inside utility-sealed equipment:** in a combined
meter-main, the line side is frequently utility-sealed, so the Load-With-Solar
boundary is physically unreachable without a utility visit. Enphase's own site
assessment gates the physical placement: each conductor needs ≥2.0 in of
accessible length, must be smaller than 350 MCM THWN / 350 MCM XHHW / 4/0 RHW (or
a busbar under 0.75 in thick), with ≥0.75 in clearance. *"If the main electrical
meter is installed in a separate enclosure from the main service panel, you can
probably install consumption CTs without any additional electrical wiring."*

### 1.5 In 4th gen the field CT largely disappears

* **IQ Combiner 6C** — factory-installed solid-core CTs: production (±0.5%),
  2× battery (±0.5%), 2× backfeed (±2.5%), 2× load-controller (±0.5%). *"Does not
  require field wiring."*
* **IQ Meter Collar** — sits behind the utility watt-hour meter, i.e. **exactly at
  the Load-With-Solar boundary**, with an integrated consumption meter (±0.5%)
  and zero field CT work. Where the utility will not approve a collar on its own
  socket, Enphase's documented fallback is a separate non-utility meter socket
  with a jumper cover.

**This is the architectural point.** "Which CT, where" is the wrong question for
a 4th-gen system. The right question is *which equipment owns the measurement at
each boundary* — and for the 6C + collar the answer is "the equipment does, and
there is no field CT at all". A model built only around field CTs cannot
represent the current generation.

---

## 2. What SolarPro implements today

### 2.1 Current transformers: nothing

Verified by direct grep. `currentTransformer`, `productionCT`, `consumptionCT`,
`ctPolarity`, `ctDirection`, `meteringMode`: **zero files each**. The phrase
"current transformer" appears in no source file. `transformer` appears in `lib/`
only as the adjective "transformerless" on inverter rows.

> A naive grep for `ctRatio`/`ctMode` reports ~171 hits and looks like a CT
> model. Every one is `aspe-ctRatio` or `dete-ctMode`. With word boundaries:
> zero. Worth recording, because it is exactly how an audit talks itself into
> believing a model exists.

There is no measurement boundary, no direction, no polarity, no aperture, no
phase association, no accessibility check, and nothing that validates whether a
CT can physically be placed where a design needs it.

### 2.2 What exists instead: one boolean, answered in eight places

`hasProductionMeter` is computed at `lib/permit/utils/sldAdapter.ts:307`
(`project.productionMeter !== false`), declared on the renderer input at
`lib/sld-professional-renderer.ts:335` — **and never read**. `grep -c` in the
renderer returns 1, the declaration. A metering flag is accepted and thrown away,
while the utility meter symbol is drawn unconditionally by other logic.

`IntegratedFunctions.metering` (`lib/equipment/integratedBos.ts:36`) is a bare
boolean whose only reader is `roleSummary()`, which turns it into the **word**
"Metering" on the cover sheet and PV-4A. That word is the entire metering content
of the permit package.

The real CT engineering data — accuracy classes, CT counts, which are
factory-fitted — exists as prose in `lib/data/equipment/bos-devices-research.json`,
which **is imported by nothing**. Catalogue presence, not implementation.

### 2.3 Enphase 4th generation

`lib/equipment/integratedBos.ts` is a genuine design authority and is well built:
`resolveIntegratedEquipment()` governs whether an integral AC disconnecting means
exists (NEC 690.13), whether a second gateway reaches the BOM, and the
branch-slot overflow warning. Every planset sheet and the Diagram-tab SLD route
bottom out in it.

Four hard findings sit on top:

**(a) The IQ Combiner 6C is never auto-selected in production — and the tests
cannot see it.** Every Enphase IQ8 row in `lib/equipment-db.ts` declares
`compatibleWith: ['enphase-iq-combiner-5', …]`, so `resolveCompatibleCombiner`
returns the 5C and the `?? getBosDevice('enphase-iq-combiner-6c')` fallback never
fires. `tests/planset/integrated-bos.test.ts` asserts "IQ Combiner 6C" six times
— and its fixture never passes `compatibleCombinerIds`, so it exercises *only*
the fallback branch. I verified this myself. It is not cosmetic: the **5C is
main-lug with no integral PV disconnect and the 6C has one**, so the sheet's
NEC 690.13 statement changes.

**(b) `lib/computed-system.ts:2561` hard-codes `model: 'IQ Combiner 4C'`** for
every microinverter system while setting `manufacturer: input.inverterManufacturer`.
A non-Enphase micro system is labelled with an Enphase combiner, and Enphase jobs
get the superseded 4C.

**(c) `app/api/engineering/enphase/route.ts` carries wrong manufacturer data on a
live path.** `maxMicroinverters: 600` at `:95` and `:102` — Enphase states *"Number
of microinverters polled: Up to 300"*. `ENV-IQ-C4C-240` (`:111`) and
`ENV-IQ-C4-240` (`:119`) are not Enphase part numbers; the repo's own research
file calls `ENV-IQ-C4C-240` *"a fabricated/non-existent SKU"*, and the same string
sits in `lib/equipment-registry-v4.ts:680` and `:746`.

> **Correction to the research.** One challenger reported that nothing fetches
> `/api/engineering/enphase`. That is wrong — `app/engineering/page.tsx:7060` and
> `:7272` both do. The route is on a production path, which makes these worse,
> not moot.

**(d) The IQ Battery 10C is absent as a product**, and absence is filled with a
guess. `lib/permit/generatePermit.ts:361-371`:

```ts
// ... Do NOT fabricate battery data.
} else if (project.batteryCount && project.batteryCount > 0 && !project.batteryKwh) {
  project.batteryKwh = 5.0;
}
if (project.batteryCount && project.batteryCount > 0 && !project.batteryBackfeedA) {
  const backfeedPerUnit = 20; // A
  project.batteryBackfeedA = backfeedPerUnit * project.batteryCount;
}
```

The comment forbids it and eleven lines later the code does it.
**`batteryBackfeedA` feeds the NEC 705.12(B) 120 % busbar calculation.** Because
the 10C is in no catalogue, any project specifying one lands in exactly this
branch and is permitted at 5.0 kWh / 20 A per unit. This is the same
"absence becomes a confident number" family as the elevation defect closed
earlier today, but the number reaches a **code-compliance calculation on a permit
drawing**. **P0.**

The IQ Meter Collar is modelled as a `BosDevice` record — a name and a role
summary. Nothing represents that it *is* a measurement boundary.

---

## 3. Gaps

1. **No CT domain at all.** Not a weak model — none.
2. **No measurement boundary concept.** Nothing in SolarPro can express "what is
   measured, by which device, around which conductors, at what electrical
   boundary, in which direction". Without it, Load Only vs Load With Solar cannot
   be decided, checked or drawn.
3. **No equipment-integrated metering concept**, so 4th-gen Enphase — where the
   6C and the collar *are* the meters — cannot be represented at all.
4. **Interconnection method is six independent representations with three
   substring matchers** (see `docs/INTERCONNECTION-AUTHORITY-AUDIT.md`). CT mode
   depends on interconnection topology; the topology is not reliably known.
5. **Nothing can refuse.** The mixed supply-side + backfeed case where neither CT
   mode is correct has no representation, so it cannot be detected.
6. **Provenance stops at the permit.** The snapshot has no metering or CT content.
7. **Equipment data errors on live paths** (§2.3 b, c) and **a fabricated battery
   input to a 705.12(B) calculation** (§2.3 d).

---

## 4. Proposed canonical model — for discussion, not yet built

```
MeasurementChannel
  purpose            PRODUCTION | CONSUMPTION | STORAGE | BACKFEED | LOAD_CONTROL
  measuredQuantity   what current this channel integrates
  boundary           MeasurementBoundary
  realisation        FIELD_CT | EQUIPMENT_INTEGRATED | UTILITY_METER | UNKNOWN
  device             CT part / integrated device / null
  accuracyClass      e.g. ANSI C12.20 class 0.5 | ±2.5% | UNKNOWN

MeasurementBoundary            WHERE, electrically — not where on the drawing
  node                 SERVICE_ENTRANCE | METER_SOCKET_LINE | METER_SOCKET_LOAD |
                       MAIN_BREAKER_LOAD | LOAD_FEEDER | PV_BRANCH | STORAGE_BRANCH
  relativeToInterconnection  UPSTREAM | DOWNSTREAM | AT
  conductors           which ungrounded conductors, and how many
  ownership            UTILITY_SEALED | INSTALLER_ACCESSIBLE | EQUIPMENT_INTERNAL
  accessible           true | false | UNKNOWN   (aperture, length, clearance)

Direction              an ELECTRICAL property: which way positive current flows
                       relative to the source. NEVER an SVG rotation.

MeteringConfiguration  per manufacturer/system
  mode                 LOAD_ONLY | LOAD_WITH_SOLAR | NOT_APPLICABLE | INDETERMINATE
  derivedQuantities    which values are computed rather than measured
```

Design rules this must satisfy:

* **`mode` is derived, never chosen.** It follows from where the consumption
  boundary sits relative to the interconnection. If the arrangement puts load
  ahead of the CTs or PV behind them, the answer is `INDETERMINATE` and the
  design is refused — not defaulted.
* **`UNKNOWN` is a value.** Per the standing instruction: unknown must stay
  unknown and must never be rendered as a confident drawing.
* **Equipment-integrated metering is first-class**, so a 6C + collar system has
  zero field CTs and is still fully described.
* **Direction and polarity are electrical facts.** The SLD renders them; it must
  never be where they are decided.
* **Brand-aware, not Enphase-shaped.** Enphase is the implementation priority;
  SolarEdge, Tesla, FranklinWH, SMA and Generac exist only to keep Enphase
  assumptions out of the core types.
* **Co-validated with interconnection and storage.** One validator that sees all
  three, because CT mode, NEC article and PCS/backup behaviour are the same
  physical arrangement viewed three ways. Three independent validators can
  contradict each other; this one cannot.

---

## 5. Migration impact

| area | impact |
|---|---|
| `lib/equipment/integratedBos.ts` | extend `BosDevice` with integrated channels; **keep** the resolver — it is the one working authority |
| `lib/equipment-db.ts` | the IQ8 `compatibleWith` rows decide 5C vs 6C today; correcting them is a **manufacturer-data** change and needs Enphase's actual compatibility matrix, not a guess |
| `lib/permit/utils/sldAdapter.ts` | `hasProductionMeter` replaced by real channels; it is currently dead, so nothing regresses |
| `lib/sld-professional-renderer.ts` | renders channels and boundaries; must not infer them |
| `lib/permit/snapshot/*` | **digest-moving.** Adding metering content moves every digest and retires live PE approvals. Must go through the documented snapshot-shape procedure |
| `lib/computed-system.ts` | remove the hard-coded 4C; take the resolved device |
| `app/api/engineering/enphase/route.ts` | wrong SKUs and 2× polling limit, on a live path |
| `lib/permit/generatePermit.ts` | stop fabricating battery kWh / backfeed |
| Persistence | new columns or JSON; migration needs the five registrations |

---

## 6. Implementation sequence

**0 — before anything architectural**, because each is independently proven and
none needs the new model:

1. `generatePermit.ts` battery fabrication → refuse, do not invent (**P0**, feeds
   705.12(B)). *Held pending a product decision on whether this blocks a permit
   or warns.*
2. `computed-system.ts` hard-coded "IQ Combiner 4C".
3. `app/api/engineering/enphase/route.ts` — 600 → 300, and the two non-existent SKUs.
4. `tests/planset/integrated-bos.test.ts` — make the fixture carry
   `compatibleCombinerIds` so it exercises the production branch; expect it to
   fail, because production selects the 5C.

**1** Types only: `MeasurementChannel`, `MeasurementBoundary`, `MeteringConfiguration`,
with `UNKNOWN` everywhere it is honest. No consumers.

**2** Equipment-integrated metering for the 6C, the collar and the standalone
gateway, from `bos-devices-research.json` promoted into real typed data.

**3** Derive `mode` from interconnection topology; return `INDETERMINATE` where
neither mode is valid. Unit tests first, against the documented Enphase rule.

**4** Co-validation with interconnection and storage — one validator.

**5** SLD renders channels. Renderer reads; it never decides.

**6** Snapshot and permit, under the digest-shape procedure.

**7** Other brands, to keep the core honest.

The Add-A-Lug / meter-side interconnection research in
`docs/INTERCONNECTION-AUTHORITY-AUDIT.md` feeds step 3 and is **not** implemented
as a selectable topology before then. Any NEC article classification must be
derived from the actual service topology and equipment arrangement — not from a
new blanket rule keyed on the words "meter socket", "line side" or "load side".
