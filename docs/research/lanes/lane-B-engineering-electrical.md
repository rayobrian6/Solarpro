# Lane B — Engineering / Electrical UX

Research worker lane B. UX mining for SolarPro, not a market report.
Date: 2026-09-25. 13 sources genuinely watched (frames + transcripts under
`C:\Users\Ray\Solarpro Claude\tools\watch\<videoId>\`). SolarPro side read from
code, not assumed.

---

## SUMMARY — transferable interaction principles

1. **Show the consequence of a choice inside the choice.** HelioScope's conductor
   dropdown lists every gauge annotated with the voltage drop it would produce
   (`10 AWG (Copper), 0.2%` … `14 AWG (Copper), 0.6%`). Picking a wire is a
   decision, not data entry.
2. **A violation must be a navigable object, not a string.** Aurora's Components
   view is an indented electrical tree where each node carries a return arrow
   that jumps back to that exact object in the layout.
3. **Warnings sit next to the field that caused them, and the fix link sits next
   to the warning.** HelioScope: `String Sizing [9] to [9]` → ⓘ `Low Vmp at High
   Temperatures` → `set from temperature`. Three lines, one column.
4. **Name the failure mode in physical terms, not only a code section.**
   "Low Vmp at High Temperatures" tells an installer what to change.
5. **Auto-computed values need a named escape hatch AND a named way back.**
   `set manually` ↔ `set from temperature`. Override is first-class and reversible.
6. **Validate during the gesture, gate the commit.** Solargraf validates on every
   panel hover while drawing a string and will not let you close an invalid one;
   Aurora colours the string red/green/yellow as you drag.
7. **Print the rule's work on the sheet: givens → symbolic formula → substituted
   values → result → one sentence of why.** Solargraf's `INTERCONNECTION 120%
   RULE` block ends with "CALCULATION ENSURES BUS IS SAFE REGARDLESS OF LOADS".
8. **Cite provenance, not just the number.** HelioScope names the ASHRAE station
   *and its distance* (`Kansas City Downtown Ap (1.5 mi)`) as a hyperlink.
9. **The SLD should be a live view of the design, not a generated artifact.**
10. **Let topology be edited as layers, not symbols** (`+ add combiners`,
    `+ add recombiners`, `remove`).
11. **Surface the cost of a choice** — HelioScope counts the modules orphaned by
    a string length that does not divide evenly.
12. **Encode the shop's standards once, at org level**, and let them constrain
    every future auto-generation (Solargraf: allowed conduit types, minimum
    conduit size, excluded breaker sizes).
13. **Hide engineering behind an outcome** where the audience is not an engineer
    (Aurora storage: "100% of loads, 5 days", not kWh and topology).

---

## LEDGER

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | STEAL/ADAPT/REJECT/BACKLOG | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SLD generation | Solargraf (Enphase) | Electrical Design: How to Create AC System Setup & SLD Generation | `Wle9G_eepIc` | n/a (2025-26 era UI) | official | 4:17 full, 24 frames | 0:30 auto-string; 1:14 j-box; 1:33 combiner; 2:05 MSP; 2:26 tie-in; 3:12 generate; 3:52 PNG/DWG | stage bar Roof › Solar › Battery › **Electrical** › Permit; assemble AC components in order (j-box → combiner → PV disconnect → subpanel → MSP) → set tie-in + main/bus rating → Generate line diagram | Component assembly *is* the SLD authoring; tie-in method a 3-way enum (load-side / line-side / split-bus); MPU is a toggle with upgraded specs; sheet prints 120% rule and temperature-corrected Voc/Isc **with the symbolic formula**; electrical notes cite `NEC 2023 705.12(B)(2)` and `NEC 690.47`; auto `AC wire details` table incl. Min EMT/PVC/RMC; exports PNG **and DWG** | Generation is a 20–30 s async job, not live; admits "currently 240 V single-phase residential only" | none needed | SLD **does** print DC/AC calc panels, a 120% block, and a conduit+conductor schedule (`lib/sld-professional-renderer.ts`, 4,640 lines of SVG strings). No DWG/DXF export. No raceway-size-by-type table. | STEAL (the "why" sentence + min-conduit-per-raceway-type table); ADAPT (DWG/DXF) | HIGH | HIGH | LOW for the sentence; MED for DXF | Candidate 4, 6 |
| Stringing | Solargraf | Manual and auto stringing (string inverters) | `K5Wea5GERpo` | n/a | official | 2:26 full, 25 frames | 0:24 shortcut **B**; 0:41 target DC:AC; 1:43 live validation; 1:57 "validations show pass" | click stringing icon (or key B) → auto (pick inverter, optimizer, RSD, **target DC:AC ratio**) or manual (hover panel-by-panel) → connect string to inverter → Calculate | **Validation runs on every hover while drawing**; exceeding max panels shows an error and you "move your cursor back over the extra panels until all validations show pass" — the commit is gated on PASS; UI explains the DC:AC tradeoff (clipping) inline; auto-string claims to honour manufacturer rules | Manual stringing requires a clean non-overlapping gesture; jumping between panels is discouraged, i.e. the gesture is fragile | draw slowly in a clean line | `lib/string-generator.ts` (859 lines) is the real engine but **has no UI**. The only user-facing string sizing is a 40-line inline recompute in `app/engineering/page.tsx:10880` with silent fallbacks (`\|\| 600`, `\|\| 100`, `\|\| 41.8`). No drawing gesture, no live validation. | STEAL | HIGH | HIGH | MED | Candidate 2 |
| Org config | Solargraf | How to Configure Electrical & Permitting Settings | `Pj9EuXHNbB8` | n/a | official | 2:52 full, 30 frames | 0:46 conduit types; 0:59 min conduit size; 1:09 excluded breakers; 1:19 permit settings; 2:05 signature | Settings › Design › Electrical and Permit Settings — **one-time** org config applied to all future designs | Shop standards constrain the generator: allowed AC conduit types "based on your region or standards", minimum conduit size (0.75 in → nothing smaller is ever used), **breaker sizes to exclude** (never appear in any SLD); permit side toggles optional sheets, injects custom notes per named sheet (PV2, PV6), auto-applies an uploaded signature image | Settings are buried three levels deep; no per-project override shown | — | No org-level electrical standards object exists. `lib/electrical/stdSizes.ts` exposes the full NEC OCPD ladder unconstrained; conduit type is a per-project field. | **STEAL** | HIGH | HIGH | LOW | Candidate 3 |
| Plan-check detail | Solargraf | How to Add Location and Description Details to Electrical Components | `7SJsqHG4soI` | n/a | official | 2:31 full, 30 frames | 0:25 two fields; 0:41 location enum; 0:58 description; 1:40 PV1/PV2 legend; 2:01 under the symbol on SLD | click any electrical component → set **Location** (interior/exterior) + **Description** (free text) → both render on the plan set | One entry, two renderings aimed at the plan checker: Location lands in the **legend** on PV1/PV2; Description prints **beneath the symbol** on the SLD/3-line. Rationale stated as "some AHJs require clear documentation showing where equipment is installed" | Fields are optional, so the AHJ-driven need is easy to skip | installers type "east wall outside" | Component location/description is not a field. SLD labels come from equipment records. | ADAPT | MED | MED | LOW | Backlog |
| Stringing + validation + SLD | Aurora Solar | Engineering - string inverters | `ZD4TfdUcW50` | n/a | official | 5:54 full, 30 frames | 1:50 red/green/yellow; 2:29 connect; 2:31 **anchors like conduit runs**; 4:42 Components view; 4:50 **NEC violations**; 5:04 **return arrow**; 5:16 line diagram; 5:38 DXF | design → autofill modules → place inverter → string (drag across modules) → connect (with anchors) → add BOS → **Components** (electrical tree + violations) → **Line Diagram** → DXF | **String colour is live validity**: red = invalid length for the inverter's DC input, green = acceptable, yellow = at max. Connections carry **anchors "just like conduit runs"**, so run length is drawn geometry. Components view = "an electrical tree of your system design" and "Aurora will put up any **NEC code violations** or **system design best practice errors**" — two severity classes. **Every tree node has a return arrow that jumps back to the layout at that specific point.** Line diagram has an editable ground path. DXF export with **layer selection**. | Violation text carries no NEC citation (see verbatim below); the line diagram is a separate mode from the layout | — | Violations are a flat red list `[CODE] message → suggestion` in the electrical tab plus a rules accordion in the compliance tab. **No deep-link from a violation to the offending object.** No electrical tree. No drawn conductor geometry — `wireLength` is a typed number per string. | **STEAL** (return arrow + tree); ADAPT (colour-as-validity) | HIGH | HIGH | MED | Candidate 1, 2 |
| Micro branch sizing | Aurora Solar | Engineering - Micro-inverters | `wWr7naUrlhY` | n/a | official | 3:04 full, 14 frames | 1:19 colours keyed to **20 A trunk cable ampacity**; 2:21 anchors | same flow, micro variant: parallel "groups" instead of strings, then a load centre | The constraint that drives the colour is **named as the physical limiting component** — "invalid group length based on a 20 amp trunk cable ampacity" | Defers everything else to the string video | — | Micro branch limit exists in the SLD as `Max Micros/Branch (NEC 690.8)` but there is no drawing-time feedback. | ADAPT | MED | MED | LOW | Candidate 2 |
| Optimizer rules | Aurora Solar | Engineering - DC Optimizers | `pkirWQXOczQ` | n/a | official | 3:02 full, 11 frames | 1:33 red = "either the optimizer manufacturer's stringing rules **or** the inverter's DC input" | same flow, optimizer variant | Two independent rule sources (manufacturer stringing rules, inverter DC window) collapse into one colour the user reads at a glance | Which of the two rules was violated is not disclosed at drag time | — | `lib/electrical-calc.ts` **skips Voc temperature correction entirely for optimizer topology** (`isOptimizerTopo` guard, v47.412) — so the optimizer path has *less* checking than Aurora's, not more. | ADAPT | MED | MED | LOW | Candidate 2 |
| SLD entry point | Aurora Solar | Generating a Single Line Diagram | `rjup7KJ5g3U` | n/a | official | 0:21 full, 10 frames | 0:05 Documents › Line Diagram | SLD lives under **Documents**, created as a new document | Clear IA: the SLD is a document artifact | Trivially short; no detail | — | SolarPro SLD is a tab in the engineering page and a `/api/engineering/sld` route. | REJECT (no transferable detail) | LOW | LOW | — | Watched, no action |
| Storage | Aurora Solar | Introducing Battery Storage | `T-ya6_lvEF8` | n/a | official | 5:50, 25 frames, **no captions published** — frames only | 0:45 Storage Packages; 0:53 Saver/Average/Power; 4:49 confirm modal | Consumption → Storage → pick one of three pre-configured packages → confirm → flows into pricing and proposal | Storage is expressed as **outcomes a homeowner understands**: `8 kWh — 25% — 5 Hrs` (Saver), `17 kWh — 50% — 2 Days` (Average), `100% — 5 Days` (Power), derived from the consumption profile. Confirm modal states exactly what happens next ("automatically added in the pricing section and reflected in the proposals") | **This is a sales tool, not an engineering tool** — no topology, no critical-loads panel, no backup class. A frame at ~4:57 captures their own red toast: `Error! System Design Engine failed to initialize` | — | Battery panel is model + units + kWh/unit, with `~Est. Backup %` and `~Est. Runtime h` explicitly marked "UI only" (`page.tsx:9366`), plus one electrical line `+{n}A bus load (NEC 705.12B)`. **No storage topology UI at all** — no whole/partial backup, no critical-loads panel sizing, no PCS / NEC 705.13 (`PCS` and `ESS`: zero hits in repo). SLD *does* draw battery, BUI, backup sub-panel, gen + ATS well. | ADAPT the outcome framing; the **engineering** storage UI is white space in every product watched | HIGH | HIGH | MED | Candidate 5 |
| Electrical design | HelioScope (Folsom Labs / Aurora) | Electrical Design in HelioScope | `fS6ZXUnMuog` | n/a | official | 1:23 full, 15 frames | 0:18 count **or** target DC:AC; 0:33 SLD as editing surface; 0:46 **source information**; 0:54 set manually; 1:01 set from temperature; 1:06 size conductors by voltage drop | pick inverter by search → count or DC:AC ratio → SLD view → add/remove topology layers → inspect string calc → size conductors | Inverter count is settable **by targeting a DC:AC ratio** (1.41). The **SLD is the editing surface**: "we go from strings to combiners to recombiners — I can remove whichever **layer** of that I want". `source information` reveals how stringing was calculated from temperature. `set manually` ↔ `set from temperature` override pair. Conductors sized against a voltage-drop target. Stringing direction "up and down or along racking". | Electrical is a modal step you "save and exit" | — | Inverter count is manual. No layer-level topology editing. SLD is a rendered artifact. No "show your work" affordance in the UI. | **STEAL** (source information + override pair) | HIGH | HIGH | MED | Candidate 1, 6 |
| Full commercial workflow | HelioScope | HelioScope Webinar Training (Vittawin Srifong) | `hxWGSVqdJ4o` | n/a | **operator** (third-party practitioner, not vendor) | 62:01, 36 frames + 1,807 caption cues | 26:26 "**updates dynamically**"; 26:58 1.9% VD; 27:02 12→8 AWG; 27:06 0.7% VD; 27:32 ASHRAE range; 28:14 set manually; 28:25 **orphaned modules**; 33:36 ⓘ **Low Vmp at High Temperatures**; 33:44 set from temperature → new range 11–19 | full commercial design end-to-end: site → mechanical → keepouts → **electrical** (wiring zones, combiners, conductors, string range) → simulate | The complete decision loop in one breath: *"I can see I've got about a 1.9 percent voltage drop, so maybe I want to make that a little bigger — set that from 12 AWG to 8 AWG, bring that down to a 0.7 percent voltage drop, and you can see it updates in the single line diagram."* SLD "updates dynamically… if I change any of those things this will change with it". Tool **names its own output a recommendation**: "you don't have to stay in this range… this is just a recommendation from these temperatures." Surfaces the **cost**: "about five modules that are not being [used] — the total number of modules on my rooftop is not evenly divisible by nine." Warning → fix link are adjacent. | Wiring topology assigned by dragging field segments between zones (discoverability hint is a permanent instruction label: "Drag and drop field segments to change how the array is wired together") | Operator accepts orphaned modules as a trade; sets single-value string ranges (9 to 9) rather than using the suggested range | No live SLD. VD appears only as a result column in a conduit schedule (red above 3%) and as a band on the multi-lane SLD. **Six live voltage-drop implementations** disagree (two physical constants, three resistance tables that differ at #14/#12/#10). No orphaned-module readout. | **STEAL** | HIGH | HIGH | MED | Candidate 1, 6 |
| Commercial quickstart | HelioScope | 5 Minute Commercial Solar Design in HelioScope | `UTgre4il4Fo` | n/a | official | 4:25, 36 frames | 3:06 define inverter; 3:20 "add and remove combiner boxes and **see how the stringing was calculated**" | 5-minute end-to-end commercial | Independently re-confirms the two headline behaviours: layer add/remove on the schematic, and a visible stringing derivation | Marketing-paced; little depth | — | (as above) | (corroboration) | — | — | — | Corroborating source |
| Design + stringing | OpenSolar (via GSES) | OpenSolar: Advanced Studio Design Training (Module 2/3) | `r9htS7Tq9yY` | n/a | official training partner | 20:23, 36 frames + 573 cues | 7:17 + inverter; 7:40 + stringing; 7:44 "just clicking through the panels like so"; 7:58 + battery | add inverter from list → `+ stringing` → click through panels → repeat per string → optionally add battery | Very low friction; stringing is three clicks | **Electrical depth is shallow.** No validation feedback, no voltage drop, no conductor sizing, no SLD anywhere in a 20-minute advanced design module. Battery is "add in a battery if you like" | — | SolarPro's electrical engine is far deeper than OpenSolar's. | REJECT — but a useful negative control: OpenSolar is not the bar | LOW | LOW | — | Watched; sets the floor |

### Verbatim artifacts captured (load-bearing)

Aurora inline violation, Components view (`ZD4TfdUcW50` @ 5:00):

```
Max. possible continuous output current (32.0A) is above disconnect current rating (30A)
```

Five parts: named computed quantity · its value · the comparison · the limiting
device · its rating. **No NEC citation.**

Solargraf SLD calculation blocks (`Wle9G_eepIc` @ 3:52, sheet is 3446×2230 px):

```
INTERCONNECTION 120% RULE (MAIN PANEL)
  UTILITY FEED + TOTAL BACKFEED
        200A + 35A = 235A
        LESS OR EQUAL TO
        BUS RATING x 120%
        200A x 120% = 240A
  CALCULATION ENSURES BUS IS SAFE REGARDLESS OF LOADS

EXTREME CASE MODULE OUTPUT (HANWHA Q CELLS Q.PEAK DUO ML-G10 410)
  Isc(25°C) = 11.22A,  Tisc = 0.040%/°C
  Isc(T) = Isc(25°C) x [1 + Tisc x (T-25°C)]
  Isc(0°C) = 11.11A,   Isc(71°C) = 11.25A
  Voc(25°C) = 45.13V,  Tvoc = -0.270%/°C
  Voc(T) = Voc(25°C) x [1 + Tvoc x (T-25°C)]
  Voc(0°C) = 48.18V,   Voc(81°C) = 44.40V
```

Solargraf electrical notes (same sheet) — note the **edition-qualified** citation:

```
4) PV BREAKER SHALL BE FURTHEST POSITION AWAY FROM MAIN BREAKER
   AS PER NEC 2023 705.12(B)(2)
1) ALL GROUNDING TO COMPLY WITH NEC 690.47.
```

Auto `AC wire details` table columns:
`Wire | Min Ampacity | Live | Neutral | Ground | Min EMT | Min PVC | Min RMC`

HelioScope `String Calculations` disclosure panel (`fS6ZXUnMuog` @ 0:50):

```
ASHRAE Site                 Kansas City Downtown Ap (1.5 mi)   ← hyperlink
Extreme Temps               -19.1°C (min) to 38.4°C (max)
                            ── Max Power ──   ── Open Circuit ──
Module Voltages             Tmax 38.4°C | STC 25°C | STC 25°C | Tmin -19.1°C
                                 38.2V  |   38.2V  |   47.8V  |   47.8V
Inverter Voltages           Vmin-mpp 150V | Vmax-mpp 800V | Vmax 1,000V
Recommended String Lengths  Min 4 (152.8V)  |  Max 20 (956.3V)
Source: Kansas City Downtown Ap        [set manually] [show details]
```

HelioScope conductor picker — **every option annotated with its own consequence**
(tooltip: `Combiner ↔ Recombiner (Line Losses are at STC)`):

```
… 1 AWG (Copper), 0.0%   2 AWG (Copper), 0.0%   3 AWG (Copper), 0.0%
  4 AWG (Copper), 0.1%   6 AWG (Copper), 0.1%   8 AWG (Copper), 0.2%
 10 AWG (Copper), 0.2%  12 AWG (Copper), 0.4%  14 AWG (Copper), 0.6%
 1000 MCM (Aluminum), 0.0% …                    (Cu and Al families)
```

HelioScope inline warning + adjacent fix (`hxWGSVqdJ4o` @ 33:36):

```
Stringing
   String Sizing  [ 9 ] to [ 9 ]
 ⓘ Low Vmp at High Temperatures
   set from temperature | show details
```

---

## SOLARPRO'S EQUIVALENT — audited from code

Read from `C:\Users\Ray\Solarpro Claude\repo`. What SolarPro actually does today:

**Strong, and ahead of the competitors in places.**
- The SLD (`lib\sld-professional-renderer.ts`, 4,640 lines) **does print real
  calculations**: `DC SYSTEM CALCULATIONS` (Voc corrected, String Voc × 1.25,
  Isc × 1.25), `AC SYSTEM CALCULATIONS` with a full 120% block (Bus Rating, PV
  Breaker, Batt. Backfeed, Total Backfeed, Bus 120% Limit, `120% Rule PASS ✓`),
  a `CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / CH.9 TABLE 1` band, and on the
  multi-lane path a `MAX VOLTAGE DROP CALCULATION` band whose footnote carries
  the formula `VD% = 2·L·I·R / (1000·Vbase)`.
- The **planset** is more rigorous than any competitor sheet watched.
  `lib\permit\snapshot\electricalProjection.ts:1321` `ampacityChainLines()` emits
  every factor: `base 55A (90°C col.) ×0.80 (6 CCC) ×0.87 amb 41°C = 38.28A
  allow (75°C cap 50A) req 30.00A cont · PASS`.
- `lib\electrical\routeLengthBound.ts` cleanly separates SolarPro's **design
  target** (2%/3%) from the **NEC recommendation** (3%/3%/5%) with the correct
  citations and the note that NEC 90.5(C) makes informational notes
  unenforceable — better discipline than anything the competitors show.
- `routeVoltageDropRecalc.ts` **refuses rather than guesses**, and on success
  prints the derivation.
- `lib\rules-engine.ts` enumerates passes (7 rules, each with `necReference`) and
  supports overrides with justification.
- The electrical tab already has a **`120% Busbar Violation — Resolution Options
  (NEC 705)`** panel with a one-click **"Apply Supply-Side Tap →"**. That is a
  genuine "tell them what to change" affordance and it beats Aurora's plain
  tooltip.

**Weak, and the gap is where Lane B's value sits.**
- **Six live voltage-drop implementations**, two physical constants
  (12.9 Ω·cmil/ft vs Ch.9 Table 8), three resistance tables that disagree at
  #14/#12/#10. Two engines run per page view (`computed-system.ts` in the
  browser, `electrical-calc.ts` on the server) and share no VD, ampacity or
  conduit function. `conductorAuthority` (the permit truth) is **never read by
  `app/engineering/page.tsx`** — the app and the planset show different numbers.
- **Two disagreeing cold-temperature datasets** (`permit/utils/designTemps.ts`
  ASHRAE 2021 vs `jurisdiction.ts:376` ASHRAE 2005) feeding NEC 690.7 Voc
  correction, plus an in-file admission that `maxTemp` is in °F while consumers
  read it as °C.
- **String sizing has no UI for its own engine.** `lib\string-generator.ts`
  (859 lines) runs server-side; the user sees a 40-line inline recompute with
  silent fallbacks.
- **Violations are not navigable.** No deep-link from an issue to the object.
- **Nothing blocks.** `permitReadiness` checks `!!(compliance.overallStatus)` —
  a `FAIL` satisfies the row. Tab gating is by subscription plan.
- **No violation annotation on the diagram** — a 120% failure is a red `FAIL ✗`
  in a table cell and the PDF still exports.
- **No storage topology UI** (`ESS`, `PCS`: zero hits).
- **~2.3k lines of dead electrical code**: `sld-wiring-engine.ts` (697, zero
  refs), `sld-emblem-contracts.ts` (759), `app/engineering/core/*` (849),
  `engineering-automation.ts` + 4 uncalled API routes.

---

## TOP CANDIDATES FOR SOLARPRO

### 1. Make every violation a navigable object (Aurora's return arrow)
- **Build:** give every issue emitted by `electrical-calc.ts` / `rules-engine.ts`
  a `target: { kind: 'string'|'inverter'|'run'|'panel', id }`, and render a jump
  control on each row in the electrical and compliance tabs that selects that
  object and scrolls the config tab to it. The issue objects already carry
  `code`, `value`, `limit`, `necReference`, `suggestion` — only the target is
  missing.
- **Beats what we have:** today the user reads `[E-VOC-EXCEED] String 1-1:
  Corrected Voc (612.3V) exceeds…` and must find string 1-1 by hand among the
  config inputs.
- **Bounded:** additive field on an existing type; no engine change; no
  digest/snapshot impact (UI-layer only — keep it out of the permit snapshot).
- **Proof:** for each of the 6 electrical issue codes, assert the emitted issue
  carries a resolvable target id, and that clicking it focuses that control.

### 2. Live validity feedback while stringing (Aurora colour + Solargraf hover gate)
- **Build:** in the string editor, colour the in-progress string red / green /
  yellow against the limiting rule, and name the limiter in a one-line readout
  ("at max: inverter DC input 600 V" / "20 A trunk cable ampacity"). Gate commit
  on green/yellow.
- **Beats what we have:** SolarPro computes Voc/OCPD *after* the fact via
  `/api/engineering/calculate`; the user learns a string is invalid on the next
  render, in a list, elsewhere on the page.
- **Bounded:** wire the existing inline `String Sizing (NEC 690.7)` box's
  `maxPPS`/`minPPS` to the editor — but fix it to call `string-generator.ts`
  rather than recomputing with `|| 600` fallbacks.
- **Proof:** harness a design whose N+1th panel exceeds `maxDcVoltage` and assert
  the colour state flips at exactly N, and that the fallback defaults are gone.

### 3. Org-level electrical standards (Solargraf's one-time config)
- **Build:** an org settings object — allowed conduit types, minimum conduit
  trade size, excluded OCPD sizes, preferred conductor material — that
  constrains `stdSizes.ts` / `wire-autosizer.ts` / `chapter9.ts` selection.
- **Beats what we have:** the generator currently proposes anything on the NEC
  ladder; installers get sizes they do not stock and silently hand-edit.
- **Bounded:** a filter applied to existing ladder functions
  (`boundedLadder()` already exists in `stdSizes.ts`).
- **Proof:** with `minConduitIn = 0.75` and `excludedOcpd = [35]`, assert no
  generated SLD, BOM or schedule emits a 1/2" conduit or a 35 A breaker.
- ⚠ **Digest caution:** this changes generated planset content. Read
  [[digest-moves-retire-pe-approvals]] before shipping — new fields in the
  snapshot move the digest and retire live PE approvals.

### 4. Print the "why" sentence and the symbolic formula on the SLD
- **Build:** each calculation panel already prints givens and results; add (a)
  the symbolic formula line, and (b) one plain sentence of intent — e.g. under
  the 120% block, "calculation ensures the busbar is safe regardless of loads".
- **Beats what we have:** SolarPro prints `Bus 120% Limit 240 A` and
  `120% Rule PASS ✓` but never the relation. A plan checker reading Solargraf's
  sheet can verify without knowing the tool; ours they must trust.
- **Bounded:** static text in `sld-professional-renderer.ts` panels.
- **Proof:** regenerate the Braidon planset and screenshot the SLD page — per
  [[hybrid-planset-visual-mandate]], Ray judges by how the sheet **looks**.
- ⚠ **Digest caution:** same as #3 — this is snapshot-visible content.

### 5. Storage topology as a real engineering surface (white space — nobody has it)
- **Build:** backup class (whole-home / partial / grid-tied-no-backup), critical
  loads panel with a load list, AC- vs DC-coupled as an explicit decision, and
  battery disconnect sizing. Feed the existing `busbarContributionA` path.
- **Beats what we have:** SolarPro's storage electrical surface is one line,
  `+30A bus load (NEC 705.12B)`. Aurora's is a sales tier picker. Solargraf asks
  the installer to *type* backup class into the permit form — which is exactly
  the derived answer SolarPro could defend.
- **Bounded-ish:** MED. The SLD already draws BUI, backup sub-panel and gen/ATS,
  so the rendering half exists.
- **Proof:** a partial-backup design must produce a critical-loads sub-panel on
  the SLD and a busbar total that includes the battery breaker.
- **Note:** this is the highest-value *product* gap found, and it is the one
  place where no competitor watched sets a bar. Recommend BACKLOG-with-intent,
  not this cycle — it is larger than the other five.

### 6. Consequence-annotated conductor choice + one voltage-drop authority
- **Build:** (a) collapse the six VD implementations onto one function — the
  Ch.9 Table 8 path in `manufacturer-specs.ts:179`, already used by the permit
  recalc — and delete the 12.9 Ω·cmil/ft copies in `computed-system.ts`,
  `segment-schedule.ts`, `segment-builder.ts`; then (b) render the gauge picker
  with each option's resulting VD%, as HelioScope does.
- **Beats what we have:** today the app and the planset can print different
  voltage drops for the same run, and the user picks a gauge blind.
- **Bounded:** (a) is a pure consolidation with an existing correct target; (b)
  is a render change over an already-computed set.
- **Proof:** a harness that, for every gauge in the ladder, asserts the app's VD
  equals `routeVoltageDropRecalc`'s VD for the same run — currently it will not.
- **Do (a) before (b).** Annotating a picker with numbers from a disagreeing
  implementation would ship the defect into the user's decision.

---

## EXIT CRITERIA STATUS

1. **≥2 materially relevant products — MET.** Four watched: Aurora Solar,
   Solargraf, HelioScope, OpenSolar.
2. **≥1 official/training source — MET.** 11 of 13 are vendor-official
   (AuroraSolarInc, Solargraf, Folsom Labs channels); `r9htS7Tq9yY` is an
   official OpenSolar training partner (GSES).
3. **≥1 real user/operator source — MET, but thinly.** `hxWGSVqdJ4o` is a
   62-minute third-party practitioner running HelioScope end-to-end, hitting a
   real warning and working around it — genuine operator evidence. **However the
   installer-complaint hunt largely FAILED**: forums.mikeholt.com returned HTTP
   403 on both threads, reddit.com is blocked to this agent's user-agent, and
   the comparison pages that surfaced (SurgePV, solarscope.io, Energyscape) are
   **competitor marketing and were not used as evidence**. YouTube comments on
   the Aurora engineering video number two and are worthless. Claims seen in
   those marketing pages — e.g. "NEC 690.8 conductor-sizing errors cause 30–40%
   of solar permit rejections" — are **unverified vendor assertions and are not
   carried into this lane's conclusions.**
4. **Core workflow captured end-to-end — MET.** Three independent full chains:
   Solargraf (stringing → AC component assembly → SLD → permit settings),
   Aurora (autofill → string → connect → BOS → Components/violations → line
   diagram → DXF), HelioScope (inverter → wiring zones → conductors → string
   range → simulate).
5. **Findings repeating — MET.** Three independently confirmed convergences:
   (a) live validity feedback during the stringing gesture appears in both
   Aurora (colour) and Solargraf (hover-gated PASS); (b) HelioScope's layer
   add/remove and visible stringing derivation confirmed in three separate
   videos (`fS6ZXUnMuog`, `UTgre4il4Fo`, `hxWGSVqdJ4o`); (c) the
   override/return-to-auto pair (`set manually` ↔ `set from temperature`)
   confirmed in two.
6. **Opportunities triaged — MET.** Every ledger row carries a
   STEAL/ADAPT/REJECT/BACKLOG call with impact, value and risk.
7. **SolarPro equivalent audited — MET.** Read from code: `app/engineering/`,
   `lib/electrical/`, `lib/sld-*`, `lib/electrical-calc.ts`,
   `lib/computed-system.ts`, `lib/permit/snapshot/*`, with import-trace
   reachability and ~2.3k lines of dead electrical code identified.
8. **Candidates shipped or explicitly backlogged — NOT MET.** Six candidates are
   specified with proofs, but **nothing has been shipped or entered into a
   backlog** — this lane is research only, and the hard rules forbid editing
   product source. Candidates 3 and 4 additionally need a digest-impact ruling
   before they can be scheduled.

### Verdict

**The lane is NOT saturated.** Criterion 8 is unmet outright and criterion 3 is
met only by a single operator source. Two specific gaps remain worth a further
pass:

- **Real installer complaint evidence.** Mike Holt and Reddit were inaccessible
  to this agent. Someone with browser access should mine
  `forums.mikeholt.com/threads/pv-design-software.149104/` and
  `/threads/one-line-software.146036/` directly — those are practising
  electricians discussing exactly this lane's subject.
- **Storage/ESS design tooling.** No current dedicated storage-design tool was
  found or watched. Aurora's storage module is a sales tier picker. Candidate 5
  is therefore recommended on white-space reasoning, not on competitive
  evidence, and should be validated before it is scheduled.
