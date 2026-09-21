# Battery electrical authority — audit and manufacturer truth

**Date:** 2026-09-21 · **Status:** AUDIT + VERIFIED MANUFACTURER DATA. **No battery code written.**

---

## 1. The defect: one field carrying three physical quantities

`batteryBackfeedA` is read as three different things:

| site | read as |
|---|---|
| `computed-system.ts:513` (declaration) | a **breaker rating** — "from equipment-db `backfeedBreakerA`" |
| `electrical-calc.ts:856` | a **breaker rating**, summed into busbar loading |
| `computed-system.ts:1993` | a **current** — `nextStandardOCPD(input.batteryBackfeedA)` only makes sense on a current |
| `computed-system.ts:1977` | **continuous output current** — `batteryContinuousOutputA ?? input.batteryBackfeedA` |

A value is sized *up* to an OCPD in one place and summed *as* an OCPD in another.
`batteryContinuousOutputA` already exists as a separate field and is then collapsed
into the same one by a `??`.

## 2. Eight fabrication sites, pointing in opposite directions

| site | invents | reaches |
|---|---|---|
| `electrical-calc.ts:855` | **0 A** | NEC 705.12(B) 120% check |
| `computed-system.ts:1409` | **0 A** | `interconnectionPass` |
| `equipment-db.ts:4052` | **0 A** | unknown battery id |
| `equipment-db.ts:4054` | **0 A** | catalogued battery with no `backfeedBreakerA` |
| `generatePermit.ts:371` | **20 A/unit** | mutates `project.batteryBackfeedA` |
| `sldAdapter.ts:313` | **20 A/unit** | the drawing |
| `sld-professional-renderer.ts:2479` | **20 A** | the drawing again |
| `generatePermit.ts:365` + 4 others | **5.0 kWh** | compliance pages, site plan, SLD |

**The drawing invents a battery backfeed breaker. The compliance calculation used 0.** The
0 is the permissive direction — a smaller backfeed makes the 120 % rule easier to pass, so
the two fabrications do not cancel; they make the drawing stricter than the calculation
that clears the design.

Refinement to my first report, from reading the actual call: the `20 A` sites are not all
"per unit". `calcBatteryBackfeedAmps` is gateway-aware and returns a **flat** 20 A for an
Enphase fleet; `generatePermit.ts` and `sldAdapter.ts` compute `20 × count` unconditionally;
`sld-professional-renderer.ts` falls back to a flat `?? 20`. Four aggregation models, §3b.

## 3. 🚨 The model itself is wrong for the IQ Battery 10C

Verified from Enphase documentation (§4). **The battery OCPDs never land on the dwelling's
main load-centre busbar at all.**

The 40 A / 80 A battery breakers live **inside the IQ Combiner 6C**, on its internal
200 A DER busbar. What appears on the main panel is a *single* feeder/backfeed breaker for
the combiner — maximum 125 A, 100 A continuous.

So `batteryBackfeedA × quantity` added to the main-panel busbar sum is not a wrong number.
It is the wrong *model*. `20 A × count` is wrong, and so would `40 A × count` have been.

### 🚨 Correction to my own earlier wording: "invariant with battery count" was too strong

I previously wrote that the combiner's main-panel backfeed "does not vary with battery
count." **That overstates it, and replacing one bad formula with a constant would be the
same mistake in the other direction.**

Battery count changes the **branch architecture** — one unit on a 40 A branch, two on a
shared 80 A branch, more than two only with PCS oversubscription, additional branch
positions where supported. Branch architecture changes branch OCPD and the aggregate DER
contribution, and the combiner's feeder/backfeed OCPD is sized from the **applicable
aggregate DER/load architecture**, bounded at 125 A. So count *can* propagate upward — it
simply does not propagate **linearly**, and it does not propagate as a battery property.

The correct statement is:

* **INVALID:** `mainBusContribution = batteryBackfeedA × batteryQuantity`
* **ALSO INVALID:** `mainBackfeedA = constant, regardless of quantity`
* **CORRECT:** count → branch architecture → branch OCPD → aggregate DER → combiner
  feeder OCPD (≤ 125 A) → service calculation. A **step function through documented
  architecture rules**, not a formula.

Enphase publishes no table mapping battery quantity directly to a main-panel backfeed
breaker size; 125 A is stated only as a maximum. So the combiner feeder OCPD is a
**selected/generated value bounded by the architecture**, and the service calculation must
consume *it* — never an individual battery's current.

## 3a. The electrical layers

Every consumer must name which layer it needs. These are different physical quantities and
must not share a field.

```
INDIVIDUAL BATTERY        manufacturer output characteristics
                          rated continuous kVA · rated output current · usable kWh
        │
BATTERY BRANCH            units on THIS branch → conductor → branch OCPD
                          → PCS / oversubscription rules
        │
IQ COMBINER 6C DER BUS    PV branches + battery branch(es) + other DER/load functions
                          (200 A DER busbar, 160 A DER, 100 A PV busbar)
        │
COMBINER FEEDER/BACKFEED  one selected/generated feeder OCPD, ≤ 125 A
                          (≤ 100 A continuous)
        │
MAIN SERVICE / DISTRIBUTION   NEC 705 interconnection calculation
```

**The service calculation consumes the combiner feeder/backfeed architecture. It never
consumes individual battery current.**

## 3b. 🚨 FOUR aggregation models coexist today, and one arbitrates by `Math.max`

This is worse than the single overloaded field I reported. The repo does not have one wrong
rule for "how much does the battery add" — it has four, and they disagree with each other
for the same Enphase fleet.

| # | site | rule | for 3 × Enphase 5P |
|---|---|---|---|
| 1 | `app/engineering/page.tsx:171-179` `calcBatteryBackfeedAmps` | `requiresGateway ? breakerA : breakerA × count` | **20 A** |
| 2 | `lib/computed-system.ts:1403` reduce over `computeBatteryBusImpact` | sum `backfeedBreakerA` per battery **id** — no gateway awareness | **60 A** |
| 3 | `lib/permit/generatePermit.ts:369-372` | `20 × batteryCount`, unconditional, and it **mutates `project.batteryBackfeedA`** | **60 A** |
| 4 | `…/sldAdapter.ts:313` | `(batteryCount ?? 1) × 20`, unconditional | **60 A** |
| — | `lib/sld-professional-renderer.ts:2479` | `input.batteryBackfeedA ?? 20` — flat | **20 A** |

And `computed-system.ts:1406` reconciles model 1 against model 2 with:

```ts
const batteryBusImpactA = Math.max(batteryBusImpactFromIds, input.batteryBackfeedA ?? 0);
```

**`Math.max` of two disagreeing models is not an authority.** It is "take whichever number
isn't zero", and it happens to resolve in the conservative direction only by accident of
which model is larger.

**One thing the repo already half-knows:** `requiresGateway` on the battery record is
*exactly* the layer boundary in §3a — it is the codebase recognising that some products
aggregate below the main panel before backfeeding it. It is a boolean side-note consulted
by **one** of the four models. Promoting it into an explicit architecture layer is the fix;
it does not have to be invented from nothing.

## 3c. Classification — which layer each consumer actually needs

Per the rule *if two consumers need different physical quantities, give them different
authoritative quantities*:

| consumer | reads today | layer it actually needs |
|---|---|---|
| `electrical-calc.ts:855` → NEC 705.12(B) 120 % busbar | `batteryBackfeedA ?? 0` | **combiner feeder OCPD** (or the battery branch OCPD only when the branch lands on the main panel directly) |
| `computed-system.ts:1403-1410` → `interconnectionPass` | `max(Σ per-id, batteryBackfeedA ?? 0)` | **combiner feeder OCPD** |
| `computed-system.ts:1976` → `autoSizeWire` for `BATTERY_TO_BUI_RUN` | `batteryContinuousOutputA ?? batteryBackfeedA` | **battery branch continuous current** (per branch, not per unit) |
| `computed-system.ts:1997` → `nextStandardOCPD(...)` + EGC | `batteryBackfeedA` | **battery branch OCPD** — and it must be *selected from the architecture rules*, never sized up from a current |
| SLD renderer "`{n}A BATT` · NEC 705.12(B)" breaker at the MSP | `?? 20` | **combiner feeder OCPD** — and for a 10C the symbol is drawing a breaker that does not exist at that location |
| Permit/BOM battery pages | `20 × count`, `5.0 kWh` | **manufacturer facts**: model number, rated kVA, usable kWh |
| AHJ storage-threshold checks | `batteryKwh` | **aggregate usable kWh** |

Two consumers on that list need a quantity that **is not a battery property at all** — and
one of them (`nextStandardOCPD`) is *deriving* an OCPD by rounding a value that the other
sites are *summing* as though it already were one. That is the overload, stated precisely.

## 4. Verified manufacturer data — IQ Battery 10C / 10CS

Sources: **DSH-00565-9.0-EN-2026-02-26** (10C datasheet), **DSH-00674-3.0-EN-2026-03-05**
(10CS), **TEB-00282-4.0-EN** (Feb 2026, EES planning), **QIG 140-00379-02 v2.0**,
**DSH-00585-3.0** (IQ Combiner 6C). Where the QIG and the datasheet differ, the datasheet
is newer and wins.

### 4.1 Identity
* Ordering SKU `IQBATTERY-10C-1P-NA`; **model number `B10CNC0708O`**.
* 🚨 Enphase: *"For all interconnection applications and permitting processes, ensure that
  the model number is used, not the ordering SKU."* **The planset must print the model
  number.**
* AC-coupled; four embedded **grid-forming, neutral-forming** microinverters
  (`IQ8BL` / `IQ8BN`).
* 10C and 10CS are **the same battery with a different cover** (`B10CSNC0708O`). Every
  electrical rating is identical.

### 4.2 Ratings — as separate facts, which is the point
| Enphase's own row | value |
|---|---|
| Rated (continuous) output **power** | **7.08 kVA** |
| Maximum continuous discharge rate | **7.08 kW** |
| Rated output **current** @240 V L-L | **29.5 A** |
| Rated **neutral** current @120 V L-N | 24 A |
| Peak output current | 56 A (3 s) / 44.8 A (10 s) |
| Total capacity | **10.0 kWh** |
| Usable capacity | **10.0 kWh** |
| Nominal voltage | 240 V (120/240 split), 211–264 V |

Three traps a design tool must not fall into:
1. **kVA and kW are different rows that happen to share 7.08.** Do not derive one from the
   other; do not apply a power factor between them.
2. **Total = usable = 10.0 kWh, deliberately.** The 2% safety reserve and 3% sustenance
   reserve are *already inside* the number. **Do not apply a depth-of-discharge derate.**
3. **29.5 A is conditional** — *"for the balanced 240 V L-L loads"*; unbalanced support is
   24 A at 120 V L-N with 5.5 A L-L.

**Peak output POWER is NOT published.** The widely-quoted "14.16 kVA peak" appears only on
reseller pages. It must not reach a planset.

### 4.3 OCPD and branch architecture
Datasheet, verbatim:
> "40 A OCPD requires a minimum of 8 AWG for one IQ Battery 10C
> or
> 80 A OCPD requires a minimum of 4 AWG for two or more IQ Battery 10C"

Footnote 8:
> "More than two IQ Battery 10C on a 4 AWG circuit protected by 80 A OCPD requires setting
> Power Control System: IQ Battery Oversubscription."

**Units are daisy-chained onto a shared branch, not one branch each** (QIG §8.1, §10.4).
So the contribution is **per branch circuit**, never per unit × quantity.

| units | battery branches | OCPD |
|---|---|---|
| 1 | 1 | 40 A (80 A also permitted) |
| 2 | 1 shared | 80 A |
| 3–4 | 2 | 2 × 80 A |
| 5–8 | 2, **PCS oversubscription required** | 2 × 80 A |

IQ Combiner 6C: PV busbar 100 A, **DER busbar 200 A**, max continuous battery current
2 × 59 A, **max continuous backfeed 100 A, max backfeed breaker 125 A**.

### 4.4 PCS — NEC 705.13
Required above two units per 80 A branch. Oversubscription *"increases the energy storage
capacity that can be installed for a given battery breaker rating by reducing the maximum
continuous current rating of the battery"* — **the breaker stays 80 A**; the array's rated
kVA is what changes, pinning at **30.72 kVA for 5–8 units** (= 2 × 80 A × 0.8 × 240 V).
System maximum: **8 units, 30.72 kW, 80 kWh**.

A separate PCS mode, *MPU avoidance with Feeder Control*, cites **705.12** and limits
backfeed into the main panel directly. Busbar Overload Control is **IQ8-only**.

Planset obligation: *"add a PCS disclaimer label at all PCS-enabled IQ Battery 10C units."*

### 4.5 System constraints the tool must respect
* 🚨 **The 10C works ONLY with the IQ Combiner 6C.** *"It does not work with IQ Gateway or
  Envoy S Metered."* Mandatory in all five documented configurations. **So selecting a 10C
  constrains the combiner — the battery and combiner decisions are coupled.**
* **IQ Meter Collar is required for backup / grid-forming, not for grid-tied.** It is an
  addition to the combiner, never an alternative. Labelled *"service entrance rated, not
  service equipment."*
* **No IQ System Controller variant works** with the 10C or the 6C (TEB-00282-4.0 §2.2).
  A secondary source claiming "3M compatible" is refuted by the primary document.
* Incompatible: IQ Battery 3T, 10T, 5P (*"in the future"*).
* PV-to-battery sizing: IQ6/IQ7 → 150% of battery rated kVA; IQ8 → 270%, capped at
  19.2 kVA by the combiner's 100 A PV busbar.

### 4.6 The legacy sibling — do not conflate
"IQ Battery 10" (`ENCHARGE-10-1P-NA`) is a different machine: **3.84 kVA, 16 A, one unit
per 20 A branch**, 12 × IQ8X-BAT, and it *does* pair with the IQ System Controller.
Conflating them picks a 20 A breaker for a 29.5 A device.

## 5. What this implies for the domain model

Separate the manufacturer facts from the derived design quantities, and give each layer of
§3a its own name:

```
MANUFACTURER (per product record)     DERIVED (per design, per LAYER)
  ratedContinuousOutputKva              BRANCH:  unitsOnBranch
  maxContinuousDischargeKw                       branchOcpdA        selected, not computed
  ratedOutputCurrentA        29.5 A              branchContinuousA
  ratedNeutralCurrentA                           conductorAwg
  peakOutputCurrentA                             pcsRequired
  usableCapacityKwh          == total   DER BUS: aggregateDerA
  permittedBranchOcpdA       40 | 80    FEEDER:  combinerFeederOcpdA   <= 125 A
  maxUnitsPerBranch          2 | 4 PCS  SERVICE: busbarContributionA   == feeder OCPD
  requiresCombiner           6C only
```

`batteryBackfeedA` should be **retired**, not repaired — it cannot mean all of
"rated output current", "branch OCPD" and "main-panel busbar contribution" at once, and
for this product the third of those is not a battery property at all.

### 5a. 🚨 40 A / 80 A is an architecture rule, not quantity math

The one-unit → 40 A and two-or-more → 80 A relationship is a **manufacturer-supported
architecture**, published for a specific branch topology with a specific conductor. It must
be encoded as an Enphase 10C/6C architecture rule set, not as a generic formula that any
battery inherits. The rule set must express, at minimum:

| units on branch | branch OCPD | conductor | extra requirement |
|---|---|---|---|
| 1 | 40 A (80 A also permitted) | ≥ 8 AWG | — |
| 2 | 80 A | ≥ 4 AWG | — |
| > 2 on one 80 A branch | 80 A | ≥ 4 AWG | **PCS: IQ Battery Oversubscription** + a PCS disclaimer label at every unit |
| multiple branch positions | per branch | per branch | where the combiner supports it |

…and it must **refuse**, not extrapolate, for a unit count or a topology Enphase does not
document. A 9th unit has no rule; the answer is UNRESOLVED, not `80 × ceil(9/4)`.

**Before this is coded, the IQ Combiner 6C branch architecture must be validated against
current Enphase documentation** — specifically how many battery branch positions the 6C
supports, and whether a second 80 A branch is a documented configuration or an inference.
§7 item 5 records that as still open.

### 5b. The catalogue gap this all rests on

| id | model | `backfeedBreakerA` | `requiresGateway` | `maxContinuousOutputA` | `usableCapacityKwh` |
|---|---|---|---|---|---|
| `enphase-iq-battery-5p` | IQ Battery 5P | 20 | true | 16 | 5.0 |
| `enphase-iq-battery-10t` | IQ Battery 10T | 20 | true | 16 | 10.08 |
| `enphase-iq-battery-3t` | IQ Battery 3T | 15 | true | 5.3 | 3.36 |

**There is no IQ Battery 10C row at all.** That absence is the whole reason the 10C's
figures were being invented downstream — and the product is a currently-shipping SKU, so
the standing rule applies: *known supported SKU → fix the equipment authority; do not treat
an incomplete SolarPro catalogue as "unknown battery".*

Two of those rows also need manufacturer verification before they are trusted as the
template for the 10C: a single `backfeedBreakerA` scalar cannot express the 40/80 branch
rule, and the 10T's `maxContinuousOutputA: 16` against `usableCapacityKwh: 10.08` should be
checked against the 10T datasheet rather than copied from the 5P row it matches exactly.

## 6. Unresolved policy — the severity rule

Per the standing rule *severity follows consequence, not field name*:

* **`backfeedBreakerA` / branch OCPD unknown** → the 705.12(B) conclusion, conductor sizing
  and OCPD selection are **blocked**. Not 0, not 20 A.
* **`usableCapacityKwh` unknown** → warn and propagate unresolved, unless an AHJ storage
  threshold depends on it, in which case that particular calculation escalates.

## 7. Could not be established from manufacturer documentation

1. Peak/surge output **power** in kVA for the 10C.
2. Which device **executes** PCS control, stated explicitly (the integrated IQ Gateway is
   strongly implied, never named).
3. A battery-count → main-panel backfeed-breaker table (only the 125 A maximum). This is
   why §3's corrected statement stops at "sized from the applicable aggregate DER/load
   architecture" rather than giving a formula.
4. The numeric per-unit continuous current under oversubscription.
5. **How many battery branch positions the IQ Combiner 6C supports**, and whether a second
   80 A battery branch is a documented configuration. §5a's ">2 branches" row is therefore
   marked as requiring validation before it is coded — it must not be extrapolated from the
   200 A DER busbar arithmetic.
