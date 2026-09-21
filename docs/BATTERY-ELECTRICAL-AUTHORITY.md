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

**The drawing says 20 A per battery. The compliance calculation used 0.** The 0 is the
permissive direction — a smaller backfeed makes the 120% rule easier to pass.

## 3. 🚨 The model itself is wrong for the IQ Battery 10C

Verified from Enphase documentation (§4). **The battery OCPDs never land on the dwelling's
main load-centre busbar at all.**

The 40 A / 80 A battery breakers live **inside the IQ Combiner 6C**, on its internal
200 A DER busbar. What appears on the main panel is a *single* backfeed breaker for the
combiner — **maximum 125 A, 100 A continuous — and that value does not vary with battery
count.**

So `batteryBackfeedA × quantity` added to the main-panel busbar sum is not a wrong number.
It is the wrong *model*. `20 A × count` is wrong, and so would `40 A × count` have been.

Enphase publishes **no** table mapping battery quantity to a main-panel backfeed breaker
size; 125 A is stated only as a maximum. The combiner backfeed breaker is therefore a
**designer input bounded at 125 A**, not a derived product of battery count.

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

Separate the manufacturer facts from the derived design quantities:

```
MANUFACTURER (per product record)     DERIVED (per design)
  ratedContinuousOutputKva              branchCircuitOcpdA      per BRANCH, not per unit
  maxContinuousDischargeKw              unitsPerBranch
  ratedOutputCurrentA        29.5 A     pcsRequired             > 2 per 80 A branch
  ratedNeutralCurrentA                  arrayRatedKva           pins at 30.72 kVA
  peakOutputCurrentA                    combinerBackfeedBreakerA  designer input, <= 125 A
  usableCapacityKwh          == total   conductorAwg
  permittedBranchOcpdA       40 | 80
  maxUnitsPerBranch          2 | 4 PCS
  requiresCombiner           6C only
```

`batteryBackfeedA` should be **retired**, not repaired — it cannot mean all of
"rated output current", "branch OCPD" and "main-panel busbar contribution" at once, and
for this product the third of those is not a battery property at all.

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
3. A battery-count → main-panel backfeed-breaker table (only the 125 A maximum).
4. The numeric per-unit continuous current under oversubscription.
