# Meter-side PV interconnection — research + SLD authority audit

**Status:** research complete, pipeline audit complete, **no interconnection code written yet.**
**Basis:** branch `dev`, HEAD `1902eccc`.

This document exists so the research and the audit survive independently of whatever is built next.
Ray's instruction was explicit: audit the pipeline *before* adding another dropdown value, and treat
independent answers to one physical question as an architectural finding rather than a place to add
a copy.

---

## PART 1 — THE HARDWARE

### 1.1 Milbank K4977 family — verified first-hand from Milbank

🚨 **Read directly out of Milbank's own product catalogue (p.117), not from a reseller:**

> *"Replaces the load or line side slide-in nut assembly on Milbank 200 Amps sockets. Allows for a
> 100 Amps tap location in addition to the #6-350 kcmil load-side connector. K5022 includes safety
> barrier extensions for applications over 300 VAC. Three lugs per kit."*
>
> `K4977-INT` — Internal Hex · `K4977-EXT` — External Hex · `K5022-INT` — Internal Hex (set of 4 with barrier)

And from Milbank's own spec sheet for K4977-INT (document 1028693), read first-hand:

| | |
|---|---|
| Marketing description | Tap Connector Kit Internal Hex Slide Nut With 14-1/0 Box Connector 300 Volt Maximum 3 Per Kit |
| Conductor range | **12 AWG – 1/0 AWG** (body stamped `1/0-12 AL`, `1/0-14 CU`) |
| Voltage rating | **Up to 300 VAC** |
| Temperature | 75 °C |
| Material | Aluminium · mechanical · slide-nut mount |
| **Standard** | 🚨 **"Non UL Listed"** |

🚨 **THE MANUFACTURER CONTRADICTS THE RESELLERS.** A distributor describes this kit as *"a UL-listed
double-lug assembly"*. Milbank's own spec sheet says **Non UL Listed**. Anything SolarPro asserts
about listing must come from the manufacturer record, and the difference is exactly why utility and
AHJ approval is not optional here.

Milbank's own note, on the spec sheet:

> *"Please consult serving utility for their requirements prior to ordering or installing, as
> specifications and approvals vary by utility and may require local electrical inspector approval."*

### 1.2 🚨 The two axes that the phrase "line-side tap" destroys

This is the single most important modelling fact in this document.

| axis | values | what it is |
|---|---|---|
| **Socket lug position** | line side **of the meter** · load side **of the meter** | a metering-equipment fact |
| **NEC article** | **705.11** supply side *of the service disconnecting means* · **705.12** load side | the code fact |

They are **independent**. In the ordinary topology —
service → socket line lugs → meter → socket load lugs → service-entrance conductors → **main service
disconnect** — *both* sets of socket lugs are upstream of the service disconnecting means. So a
K4977 tap at **either** position is a **705.11 supply-side connection**. There is no busbar and no
120 % calculation.

Milbank's phrase *"load-side connector"*, and a distributor title like *"Load Side Tap Connector Kit"*,
mean **load side of the meter**. They do **not** mean 705.12. Any code that keys off the substring
`load` will classify this device exactly wrong — and today's code does precisely that (Part 2).

The one arrangement that breaks the rule is equipment whose tapped terminals sit *downstream* of a
service disconnecting means (some meter-main combinations). That must be read off the specific
enclosure, never assumed.

### 1.3 Compatibility — what Milbank states, and what it does not

**Stated:** Milbank **200 A** sockets, replacing the slide-in nut assembly; drive style must match
the socket's existing hardware (INT vs EXT); **K5022** above 300 VAC.

**Not stated by Milbank, and therefore UNRESOLVED — the app must not assert these:**
ring vs ringless · lever vs horn bypass · 320/400 A sockets · single- vs multi-position ·
any non-Milbank socket. 100 A Milbank sockets use a different block entirely (BL7474 / Z904486-AO),
so the kit is not scoped to them.

A competing product, Square D `ARP00118` "Lug Kit for Meter Socket", was **discontinued 30 June 2023
and per Schneider has not been replaced** — evidence that this is a manufacturer-specific method,
not a generic one.

### 1.4 The other methods are NOT interchangeable

| method | where, in NEC terms | what implements it | key constraint |
|---|---|---|---|
| **Meter-socket internal tap lug** (Milbank K4977) | 705.11 supply side, at either socket lug | manufacturer kit replacing a factory nut assembly | 200 A Milbank sockets; ≤300 V; **non-UL-listed**; utility approval |
| **Conventional supply-side tap** | 705.11, on the service conductors | insulated multi-tap connectors in a trough/gutter/j-box | a *separate enclosure*; 705.11(B) ≥ 6 AWG Cu / 4 AWG Al; new service disconnect |
| **Meter socket adapter / collar** (ConnectDER, Enphase IQ Meter Collar, Tesla Backup Switch) | 705.11 supply side — **series device in the service path**, not a tap | listed adapter between meter and socket, OCPD **inside the collar** | per-utility **approved-product list**; combined rating 200 A (load-side-of-meter) / 190 A (line-side-of-meter) |
| **Factory solar-ready socket / meter-main** | **either** — depends on the product | factory DER lug, sub-feed terminals, or backfed breaker | e.g. Square D SR69064A enables 705.11; Eaton load-side solar-ready is 705.12(B) |
| **Load-side backfed breaker** | 705.12(B) | breaker on the panel busbar | the 120 % rule |

🚨 **The collar is a series device, not a tap.** Drawing it as a tap is wrong. And the ConnectDER
model-number tokens "Load Side"/"Line Side" again refer to the **billing meter**, not the service
disconnect — the same trap as Milbank's.

**Utility approval is per-utility AND per-model AND per-installation.** Ameren Illinois publishes an
approved list with states including *"Under Review"* and *"Presently no products approved"*; SCE runs
an approved-product programme and installs the adapter itself; APS requires the collar disconnect to
be labelled **"NOT SERVICE EQUIPMENT"**. This cannot be a boolean.

---

## PART 2 — WHAT SOLARPRO DOES TODAY

### 2.1 Six independent representations of one physical question

| where | representation |
|---|---|
| `lib/electrical-calc.ts:29` | `InterconnectionMethod` = `LOAD_SIDE` \| `SUPPLY_SIDE_TAP` \| `MAIN_BREAKER_DERATE` \| `PANEL_UPGRADE` |
| `lib/computed-plan.ts:48`, `lib/engineering-helpers.ts:122` | the same union **retyped inline**, twice, not imported |
| `lib/segment-model.ts:48` | `enum InterconnectionType` = `BACKFED_BREAKER` \| `LOAD_SIDE_TAP` \| `SUPPLY_SIDE_TAP` \| `LINE_SIDE_TAP` — **different members** |
| `lib/siteSurvey/types.ts:140` | `InterconnectionPoint` = `main_panel` \| `sub_panel` \| `load_side` \| `supply_side` \| `unknown` |
| `lib/survey/v2/types.ts:89` | **another** `InterconnectionPoint`, `''` instead of `unknown` |
| `lib/sld-professional-renderer.ts:333` | a free-form `interconnection: string` |

🚨 **A category error at the root.** `LOAD_SIDE` and `SUPPLY_SIDE_TAP` are **topologies**;
`MAIN_BREAKER_DERATE` and `PANEL_UPGRADE` are **remedies** for making a load-side connection comply
with 705.12(B). Mixing them into one enum is why a meter-socket lug has nowhere to go: it is a
topology, and the slot is already half-occupied by remedies.

And `InterconnectionPoint` mixes a **location** (main panel / sub panel) with a **topology**
(load side / supply side).

### 2.2 Three substring matchers decide the drawing, and they disagree

```ts
// lib/computed-system.ts:2864 — method → segment-builder enum
if (raw === 'SUPPLY_SIDE_TAP' || raw.includes('SUPPLY') || raw.includes('LINE')) → SUPPLY_SIDE_TAP
else if (raw === 'BACKFED_BREAKER' || raw.includes('BACKFED') || raw.includes('BREAKER')) → BACKFED_BREAKER
else → LOAD_SIDE_TAP

// lib/sld-professional-renderer.ts:1912 AND :3560 — twice, single-lane and multi-lane
const intercon   = String(input.interconnection ?? '').toLowerCase();
const isLoadSide = intercon.includes('load');
const isSupplySide = intercon.includes('supply') || intercon.includes('line');
const isBackfed  = !isLoadSide && !isSupplySide;
```

**Measured by rendering the real SLD** (`renderSLDProfessional`, string-inverter fixture):

```
"LOAD_SIDE"                    -> LOAD-SIDE TAP drawn, BACKFEED breaker drawn, 705.12 cited
"SUPPLY_SIDE_TAP"              -> SUPPLY-SIDE TAP drawn, LINE-SIDE TAP drawn, 705.11 cited
"MAIN_BREAKER_DERATE"          -> BACKFEED breaker drawn, 705.12 cited
"PANEL_UPGRADE"                -> BACKFEED breaker drawn, 705.12 cited
"METER_SOCKET_TAP_LUG"         -> BACKFEED breaker drawn, 705.12 cited
"MILBANK_METER_SOCKET_TAP_LUG" -> BACKFEED breaker drawn, 705.12 cited
"METER_COLLAR"                 -> BACKFEED breaker drawn, 705.12 cited
"SOLAR_READY_METER_SOCKET"     -> BACKFEED breaker drawn, 705.12 cited
"LINE_SIDE_TAP"                -> SUPPLY-SIDE TAP drawn, LINE-SIDE TAP drawn, 705.11 cited
"Load side tap, inline fused"  -> BOTH tap types drawn, BOTH 705.11 AND 705.12 cited
""                             -> BACKFEED breaker drawn, 705.12 cited
"unknown"                      -> BACKFEED breaker drawn, 705.12 cited
```

What that table says:

1. 🚨 **Every meter-side method renders as a backfed breaker citing NEC 705.12** — the wrong
   topology *and* the wrong code article. A Milbank lug is a **705.11** connection.
2. 🚨 **`PANEL_UPGRADE` disagrees with itself across the app**: `computed-system` maps it to
   `LOAD_SIDE_TAP`, the renderer draws a backfed breaker. Two parts of one application, one input,
   two answers.
3. 🚨 **`'inline'` contains `'line'`**, so a free-text label produces a self-contradictory drawing
   citing two mutually exclusive articles.
4. 🚨 **An unknown interconnection renders a confident, specific, wrong drawing.** `''` and
   `'unknown'` both become a backfed breaker with 705.12.

### 2.3 Silent defaults that choose a topology

| where | code |
|---|---|
| `app/api/engineering/sld/route.ts:649` | `String(body.interconnection ?? body.interconnectionType ?? body.interconnectionMethod ?? 'LOAD_SIDE')` — **three field names**, then a default |
| `lib/permit/snapshot/build.ts:2946` | `String(proj.interconnectionMethod ?? 'LOAD_SIDE')` |
| `lib/computed-system.ts:2863` | `String(input.interconnectionMethod ?? 'LOAD_SIDE')` |

### 2.4 The canonical segment builder is microinverter-only

`lib/segment-model.ts`'s enum carries the comment *"Must be respected by segment generation and SLD
rendering."* Measured, by calling `buildSegments` directly:

```
topology 'string' :  Backfed Breaker -> 0 segments; interconnectionPass = true
                     Load Side Tap   -> 0 segments; interconnectionPass = true
                     Supply Side Tap -> 0 segments; interconnectionPass = true
                     Line Side Tap   -> 0 segments; interconnectionPass = true

topology 'micro'  :  Backfed Breaker -> 5 segments  (BACKFED_BREAKER_SEGMENT)
                     Load Side Tap   -> 5 segments  (LOAD_SIDE_TAP_SEGMENT)
                     Supply Side Tap -> 5 segments  (SUPPLY_SIDE_TAP_SEGMENT)
                     Line Side Tap   -> 5 segments  (SUPPLY_SIDE_TAP_SEGMENT)   ← collapsed
```

The source says why, in its own words:

```
// ============================================================
// STRING INVERTER TOPOLOGY (TODO)
// ============================================================
// String inverter segments will be added in next phase
```

Consequences:

1. 🚨 **`interconnectionPass` is a vacuous `true` for every string-inverter design.** It is computed
   as *"no 705.12(B) violation issue was raised"*, and the 120 % check lives inside the micro
   branch, so no issue can ever be raised. A safety flag that cannot fail.
2. 🚨 **`LINE_SIDE_TAP` and `SUPPLY_SIDE_TAP` emit an identical segment** — a distinction the model
   claims and does not keep.
3. `lib/topology-engine.ts` contains **zero** occurrences of "interconnection". It always draws a
   backfeed.

### 2.5 And a fourth place recomputes it

`lib/engineering/reportGenerator.ts:265` derives the interconnection from the 120 % arithmetic and
then overrides it from the survey point:

```ts
const _necCalcInterconnection = backfeedBreakerAmps <= (mainPanelBusAmps * 0.2) ? 'load-side' : 'supply-side';
```

Topology **inferred from OCPD**, which is the mirror image of the rule Ray has already had to state
once: *"system DC nameplate is not automatically the governing current for the AC interconnection."*

---

## PART 3 — WHAT THIS MEANS FOR THE MODEL

Not implemented yet, recorded so the next step starts from the evidence.

The audit says the model must separate at least four things that are currently one string:

1. **Electrical position** relative to the service disconnecting means — `SUPPLY_SIDE` (705.11) or
   `LOAD_SIDE` (705.12). This governs the code article, whether the 120 % rule applies, and the
   705.11(B) conductor floor.
2. **Point of connection** — the physical place: meter-socket line lugs, meter-socket load lugs,
   service conductors in a trough, a meter socket adapter, a panel breaker, factory sub-feed
   terminals. *Not* the same axis as (1).
3. **Hardware** — manufacturer, model, kit, ratings, listing status, conductor range, voltage limit.
   A Milbank K4977-INT is an implementation of (1)+(2), not a fifth value of an enum.
4. **Resolution state** — compatibility with the known service/meter equipment, and utility/AHJ
   approval, each of which may legitimately be **UNRESOLVED**. Unknown must stay unknown.

And a remedy axis (`MAIN_BREAKER_DERATE`, `BUSBAR_UPGRADE`) has to come out of the topology enum,
because it is an answer to a different question.

🚨 **Sequencing note.** Ray's later instruction stands: do not implement Add-A-Lug as a selectable
topology yet. The Enphase CT topology research may determine that a given Enphase architecture is
not valid with a given meter-side interconnection, and the interconnection model and the CT model
have to be co-validated rather than built as two validators that can contradict each other.
