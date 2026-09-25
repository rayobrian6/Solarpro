# Conductor Authority Verification — app vs planset

Read-only verification pass, 2026-09-25. Every claim from the research agent was
treated as UNVERIFIED and re-derived from the code. Numbers below are computed,
not reasoned about.

---

## Verdict table

| # | Claim | Verdict |
|---|---|---|
| 1 | Six live VD implementations, two constants, three disagreeing resistance tables | **PARTLY CONFIRMED** — 7 implementations exist, 4 distinct resistance sources, but only **2 are reachable on a user-facing path** and they agree to **0.007 percentage points**. No 3-phase (1.732) or aluminium (21.2) constant exists anywhere. |
| 2 | Two disagreeing cold-temperature datasets feed NEC 690.7 | **CONFIRMED — the most serious finding.** 50 of 51 states disagree; up to **16 °C**. App and planset use different tables. |
| 3 | `conductorAuthority` never read by the engineering page ⇒ app and planset print different numbers | **REFUTED AS STATED.** The import is genuinely absent, but that is not the mechanism. `conductorAuthority` does not compute VD at all — it reads `compliance.electrical.acVoltageDrop`. App and planset run the **same function**. They diverge on **inputs** (length + thermal), not on formula. |
| 4 | `string-generator.ts` exists but has no UI | **REFUTED.** Live on `/api/engineering/calculate`, which the engineering page calls. |
| 5 | `permitReadiness` accepts a FAIL via truthiness | **CONFIRMED IN CODE, UNREACHABLE IN PRODUCT.** The bug is real at `app/engineering/page.tsx:8611`. The array it lives in is **never rendered** — dead. The snapshot's real `permitReadiness` (build.ts) is verdict-based and correct. |
| 6 | ~2,300 lines of dead electrical code | **CONFIRMED, and the real figure is larger** — ~2,430 lines strictly dead plus ~1,080 reachable only by direct HTTP with no client. |

---

## Claim 3 — the decisive answer (app vs planset)

### Which function produces the number the ENGINEERING PAGE displays?

The only voltage drop **rendered** on the engineering page is the Conduit &
Conductor Schedule column `V-Drop`:

- `app/engineering/page.tsx:12421` (dark schedule) and `:14227` (print schedule)
  read `cs.conduitSchedule[].voltageDrop`.
- `lib/computed-system.ts:2675` builds that cell as `` `${run.voltageDropPct.toFixed(1)}%` ``.
- `lib/computed-system.ts:2555` — `run.voltageDropPct = seg.voltageDropPct` — the
  segment schedule **overwrites** the autosizer's value, so the final authority is
- `lib/segment-schedule.ts:362` `calcVoltageDrop`, called at `:504`.

### Which function produces the number the PLANSET prints?

- `lib/permit/generatePermit.ts:1117-1128` — **`runElectricalCalc` is SHADOW-ONLY**
  (Ray, W2.1). Its mapped result is stashed on `_legacyElectricalShadow` and feeds
  nothing.
- `lib/permit/generatePermit.ts:1171` — `input.compliance.electrical = mapComputedSystemToCompliance(csFull, …)`.
- `lib/permit/snapshot/computeSystemProjection.ts:63` — `acVoltageDrop: feeder?.voltageDropPct`.
- `csFull` comes from `buildComputeSystemShadow` → `buildComputedRunsForPermit`
  (`lib/permit/utils/computedRuns.ts:318`, `:96`, `:249`) → **the same `computeSystem`**.
- The sheet cell: `lib/permit/sections/electricalPages.ts:988` prints
  `_feed.voltageDropPct` from `projectCanonicalFeeder`
  (`lib/permit/snapshot/electricalProjection.ts:95`), which resolves to the same
  feeder run's `voltageDropPct`.

### Are they the same function?

**Yes. Identical function, identical constant (K = 12.9 Ω·cmil/ft), identical
circular-mil table.** There is no formula divergence between the app and the
stamped planset. The research agent's framing ("the app is lying or the planset
is wrong") does not survive contact with the code.

### So where do they actually diverge? — the inputs

| Input | Engineering page | Planset |
|---|---|---|
| Run lengths | **Estimated geometry** — `app/engineering/page.tsx:2985`, comment: `derivedFrom: 'estimated-geometry' (not CAD model)` | **CAD-routed** — `deriveRunLengths(cad)`, `lib/permit/utils/computedRuns.ts:96, 249` |
| Rooftop temp adder | `30 °C` (`page.tsx:2980`) | `33 °C` legacy / `33` roof, `0` ground+fence (`computedRuns.ts:262-266`) |
| Ambient | `min(autoDetected.designTempMax, 40)` (`page.tsx:2975`) | `getDesignTemps(...).ashrae2pctHighC` (`computedRuns.ts:245`) |
| Cold design temp | `compliance.autoDetected.designTempMin` ← **`lib/jurisdiction.ts`** (`page.tsx:2970`) | `project.designTempMin ?? getDesignTemps(...).ashraeExtremeLowC` ← **`lib/permit/utils/designTemps.ts`** (`computedRuns.ts:246`) |

Voltage drop is exactly linear in length, so **the app/planset VD ratio equals the
length ratio**. The snapshot already records this as a deliberate, classified
divergence: `lib/permit/snapshot/build.ts:1152` emits parity check
`'feeder V-drop (%)'` with `agree: false`, classification
`'intentional-supersession'`, resolution *"canonical routed segment length
(route-length authority) replaces the legacy flat project-level length"*.

**This is a known, documented, intentional difference — not an undiscovered defect.**
It is also gated: an estimated length raises the blocking
`ROUTE-LENGTH-ESTIMATE` blocker (`build.ts:2281`), so a package built on the app's
estimated lengths cannot reach permit-ready.

### The one genuinely undocumented app-side divergence

The page holds a **second** AC voltage drop that nobody compared:

- `app/engineering/page.tsx:6455` — `setCompliance(calcData)`, the response of
  `/api/engineering/calculate`.
- That route runs `runElectricalCalc` (`lib/electrical-calc.ts`) →
  `lib/wire-autosizer.ts:181,265` → `lib/manufacturer-specs.ts:179` `calcVoltageDrop`,
  which uses `equipment-db` `dcResistance` (NEC Ch.9 Table 8, **stranded**).
- That number is **never rendered as a number**. It is used for exactly two things:
  - `page.tsx:7599` — auto-fix trigger: `if (!cs.isMicro && compliance.electrical?.acVoltageDrop > 3)` **upgrades the wire gauge**;
  - `page.tsx:8482` — the assistant's chat text states it as "Voltage drop is X%".

So the app **acts** on a VD computed by one engine while **displaying** a VD
computed by another. The planset discards both of those and recomputes with
computeSystem. Numerically the two app engines are within 0.007 pp (below), so
this is a hygiene defect, not a wrong-number defect.

### Numbers — 10 AWG copper, 150 ft one-way, 20 A, 240 V

| Source | R (Ω/kft) | V-drop | VD % | 3 % crossover length |
|---|---|---|---|---|
| `computed-system.ts:797` / `segment-schedule.ts:376` — K = 12.9 Ω·cmil/ft ÷ 10 380 cmil | 1.24277 | 7.457 V | **3.1069 %** | 144.84 ft |
| `manufacturer-specs.ts:192` via `equipment-db.ts:2490` `dcResistance` (NEC T8 stranded) | 1.24 | 7.440 V | **3.1000 %** | 145.16 ft |
| `stringSystem.ts:189` inline table | 1.24 | 7.440 V | **3.1000 %** | 145.16 ft |
| `segment-builder.ts:187` inline table (NEC T8 **solid**) | 1.21 | 7.260 V | **3.0250 %** | 148.76 ft |

**App displayed vs planset printed: 3.1069 % vs 3.1069 % — the same number for the
same inputs.** The full spread across every implementation in the codebase is
0.082 pp (2.7 % relative), and the only pair that can both be reached in one
package (`computed-system` engine vs `manufacturer-specs` gate/recalc) differ by
**0.0069 pp** — 0.22 % relative.

---

## Claim 1 — every implementation, with reachability

| # | Location | Constant / resistance source | Reachable? |
|---|---|---|---|
| 1 | `lib/computed-system.ts:781` `calcVoltageDrop` (`autoSizeWire`) | K = 12.9 Ω·cmil/ft + inline CMIL table (`:793-798`) | **LIVE** — gauge selection on both paths. Its VD value is then overwritten by #2 at `:2555`. |
| 2 | `lib/segment-schedule.ts:362` `calcVoltageDrop`, called `:504` | **identical** K = 12.9 + identical CMIL table | **LIVE — THE CANONICAL NUMBER.** Engineering-page schedule cell *and* planset feeder VD. |
| 3 | `lib/manufacturer-specs.ts:179` `calcVoltageDrop` | `equipment-db.ts:2488-2497` `dcResistance` (NEC T8 stranded: 3.14 / 1.98 / 1.24) | **LIVE, 3 consumers:** `wire-autosizer.ts:181,265,394,442` (→ `/api/engineering/calculate` → app auto-fix + assistant text); `lib/permit/snapshot/routeVoltageDropRecalc.ts:52` (WS-5 field-measurement recalc, **writes the permit run's VD**); `lib/electrical/routeLengthBound.ts:224` (the `ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND` blocking gate). |
| 4 | `lib/segment-builder.ts:177` `calcVoltageDrop` | inline table, NEC T8 **solid** copper (3.07 / 1.93 / 1.21); voltage hardcoded `240` at `:294,330,379,417` | **DEAD OUTPUT.** `buildSegments` runs (`computed-system.ts:3044`) but `cs.segments` / `cs.segmentIssues` have **zero consumers** outside tests. |
| 5 | `app/engineering/core/stringSystem.ts:182` `calcVoltageDrop` | inline table (3.14 / 1.98 / 1.24) | **DEAD.** Only `app/engineering/core/systemFactory.ts:11` imports it, and `systemFactory` has no importer except `lib/engineering-core.test.ts`. |
| 6 | `lib/engineering-automation.ts:436-442` (inline, not a function) | K = 12.9 + inline circular-mil map; **voltage hardcoded to 240 V** (`:440`) | **ORPHANED.** Reachable only via `/api/engineering/{assist,auto-configure,override,slg/generate}` — **no client in the repo calls any of those four routes.** |
| 7 | `lib/permit/snapshot/routeVoltageDropRecalc.ts:52` | delegates to #3 | **LIVE on the permit path** (see below). |

`lib/rules-engine.ts:147` `ruleVoltageDrop` and
`lib/permit/snapshot/electricalProjection.ts:589` `gradeVoltageDrop` are **graders**,
not calculators — they consume a percentage, they do not compute one. Correctly
excluded.

### What is actually wrong in claim 1's territory

The dangerous pairing is **not** app vs planset. It is **inside the permit path**:

> The permit's canonical VD is computed by `segment-schedule` (K = 12.9), but when a
> field measurement lands, `applyFieldMeasurements.ts:77,85` **overwrites**
> `run.voltageDropPct` with a value from `routeVoltageDropRecalc` → `manufacturer-specs`
> (NEC T8 stranded). And the blocking `ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND` gate
> (`routeLengthBound.ts:224`) bounds the run with the **third** source.

So one package can print an engine VD from table A, a field-measured VD from
table B, and be graded against a maximum length derived from table B while the
engine's own arithmetic crosses the limit at a different length. For
#10 / 20 A / 240 V / 3 %: engine crosses at **144.84 ft**, the gate's bound is
**145 ft** (floored). The gate is **0.22 % permissive relative to the number it is
grading**. Small, but it is a gate that can pass a run the engine says fails.

There is **no** 1.732 three-phase factor and **no** 21.2 aluminium K-factor
anywhere in `lib/`, `app/` or `components/`. That part of the claim is fabricated.

---

## Claim 2 — the cold-temperature datasets (CONFIRMED, and the worst finding)

Two tables, both live, both feeding NEC 690.7(A) cold-Voc correction:

- **A — `lib/jurisdiction.ts:377` `getDesignTemperatures(stateCode)`.** Consumed by
  `app/api/engineering/calculate/route.ts:68`, then
  - `:143,167` → `string-generator` (the 690.7 string builder), and
  - `:418` → `autoDetected.designTempMin` → `app/engineering/page.tsx:2970` →
    `computeSystem.designTempMin` → the app's 690.7 Voc check.
- **B — `lib/permit/utils/designTemps.ts:27` `STATE_TEMPS`.** Consumed by
  `generatePermit.ts:963`, `computedRuns.ts:246`, `build.ts:2977`,
  `sldAdapter.ts:450`, `fieldLabels.ts:417` — i.e. **the stamped planset**.

**Measured disagreement: 50 of 51 states differ. Only GA agrees.**

| State | app (`jurisdiction.ts`) | planset (`designTemps.ts`) | Δ |
|---|---|---|---|
| AK | −24 °C | −40 °C | **16 °C** |
| NV | −2 °C | −12 °C | **10 °C** |
| AZ | 0 °C | −8 °C | 8 °C |
| WY | −22 °C | −29 °C | 7 °C |
| CA / HI / MA / ME / NY | −1 / 16 / −14 / −20 / −20 | −7 / 10 / −20 / −26 / −26 | 6 °C |
| **IL** | **−21 °C** | **−23 °C** | **2 °C** |
| FL / MO / NM / TX | −4 / −20 / −18 / −11 | −2 / −19 / −16 / −10 | app is *colder* (1–2 °C) |

`jurisdiction.ts` cites ASHRAE **2005**; `designTemps.ts` cites ASHRAE **2021**.
They are different vintages of the same quantity, never reconciled.

### Impact, computed

Across the 33 distinct `(Voc, tempCoeffVoc)` pairs in `lib/equipment-db.ts` × 51
states = 1,683 combinations, the two tables give a **different maximum series
string length at a 600 V limit in 194 cases — 11.5 %.**

Illinois specifically (Braidon's state), 3 of 33 module types flip:

| Voc | tempCoeffVoc | app max string | planset max string |
|---|---|---|---|
| 40.95 V | −0.27 %/°C | **13 modules** | **12 modules** |
| 40.92 V | −0.27 %/°C | **13 modules** | **12 modules** |
| 41.20 V | −0.26 %/°C | **13 modules** | **12 modules** |

That is a designer building a 13-module string in the app on a design the stamped
planset computes as exceeding 600 V. In AK/NV the gap is 10–16 °C and the flip
rate is near-universal for common modules.

There is also a **third** value in play: the literal `-10` appears as a
`designTempMin` default at `app/engineering/page.tsx:447, 1451, 1571, 1864, 2050,
2385, 2970, 3580, 4282, 6247, 8076` and at `app/api/engineering/sld/route.ts:239`.
The permit path explicitly retired this regime — `build.ts:1178` records the parity
entry *"legacy flat −10 °C regime (retired W2)"* — but it is still the app's
pre-calculation default and the SLD route's fallback.

---

## Claim 4 — `string-generator.ts` has no UI (REFUTED)

`lib/string-generator.ts` (859 lines) is imported at
`app/api/engineering/calculate/route.ts:13` and driven at `:75-130` for
string/optimizer topologies. The engineering page POSTs to that route at
`app/engineering/page.tsx:6236` and `:7526`, and stores the response at `:6455`.
It is reachable from the UI on every Calculate. Also exercised by
`lib/panel-compatibility.ts`, `lib/system/mpptAllocator.ts`,
`lib/system/sizingEngine.ts`, `lib/system/feasibilityEvaluator.ts`.

---

## Claim 5 — `permitReadiness` truthiness (CONFIRMED in code, DEAD in product)

`app/engineering/page.tsx:8608-8614`:

```ts
{
  key: 'compliance',
  label: 'Compliance Check Run',
  ok: !!(compliance.overallStatus),   // <-- 'FAIL' is truthy
  value: compliance.overallStatus || undefined,
  ...
}
```

`compliance.overallStatus` is `'PASS' | 'WARNING' | 'FAIL' | null`
(`lib/engineering/engineeringStatus.ts:75`). `'FAIL'` satisfies `!!`, so the row
scores `ok: true` and `permitIsReady` (`:8619`) can reach 100 % over a FAILING
compliance verdict.

**But the array is never rendered.** `permitReadiness`, `permitReadyCount`,
`permitTotalCount`, `permitIsReady` and `permitPct` appear only at `:8526` and
`:8617-8620` — no JSX consumes any of them. The readiness ring the user actually
sees (`:15405`, `:15519`) is driven by `_readyPct` / `_doneCount` from the sheet
manifest, not from this array. So the bug is latent, not live.

The **real** `permitReadiness` — the one on the snapshot — is verdict-based
throughout and does **not** have this defect:
`lib/permit/snapshot/build.ts:2341` (`!_feederRacewayResolved`), `:2352`
(`!conduitFillEvaluation.cleared`), `:2444` (`_t.state === 'fail'`), `:2629`
(`_busbar?.passes === false`), `:2754` (`ready: blockers.length === 0`). It is
hardened with explicit fail-closed comments (`:2167-2178`) against exactly this
class of bug.

---

## Claim 6 — dead electrical code (CONFIRMED, figure is larger)

**Strictly dead — no production consumer at all:**

| File | Lines |
|---|---|
| `app/engineering/core/stringSystem.ts` | 382 |
| `app/engineering/core/microSystem.ts` | 252 |
| `app/engineering/core/systemFactory.ts` | 215 |
| `lib/segment-builder.ts` (runs, but `cs.segments` has zero readers) | 588 |
| **subtotal** | **1,437** |

**Orphaned — live HTTP endpoint, no client in the repo:**

| File | Lines |
|---|---|
| `lib/engineering-automation.ts` | 767 |
| `app/api/engineering/assist/route.ts` | 61 |
| `app/api/engineering/auto-configure/route.ts` | 84 |
| `app/api/engineering/override/route.ts` | 87 |
| `app/api/engineering/slg/generate/route.ts` | 82 |
| **subtotal** | **1,081** |

**Shadow-only by ruling (not dead — deliberately retained for the parity matrix):**
`lib/electrical-calc.ts` (1,711) + `lib/wire-autosizer.ts` (683) on the permit path.
Both are still **live** on the app path via `/api/engineering/calculate`, so they
cannot simply be deleted.

Total genuinely removable: **~2,518 lines**, close to the claimed 2,300.

---

## 🚨 Digest-impact flags (read before any repair)

Project rule: a change to the permit snapshot's **shape or content** moves the
digest and retires live PE approvals.

| Proposed repair | Digest impact | Ruling needed? |
|---|---|---|
| Reconcile `jurisdiction.ts` → `designTemps.ts` (make the app use the planset table) | **NONE** — `jurisdiction.ts` values never reach the snapshot; the snapshot's `designTempMin` is `proj.designTempMin ?? designTemps.ashraeExtremeLowC` (`build.ts:2977`). Every designed number in the app changes, but no digest moves. | **No.** This is the safe direction and should be the first repair. |
| Change `designTemps.ts` `STATE_TEMPS` | **MOVES THE DIGEST** — feeds `snapshot.thermal`, every corrected Voc, every derated ampacity. | **Yes — ruling required.** |
| Unify `computed-system`/`segment-schedule` K = 12.9 onto the NEC T8 table | **MOVES THE DIGEST** — `electrical.routeSegments[].voltageDropPct` and `electrical.feeder.voltageDropPct` shift by ~0.22 %. | **Yes — ruling required.** |
| Make `routeVoltageDropRecalc` + `routeLengthBound` use the **engine's** K = 12.9 instead of `manufacturer-specs` | **MOVES THE DIGEST** on any project with a field measurement or a bounded run. | **Yes — ruling required.** |
| Fix `page.tsx:8611` truthiness | **None** — app-only, and the code is unrendered. | No. |
| Delete the dead modules in Claim 6 | **None** if `cs.segments` / `segmentIssues` / `segmentInterconnectionPass` are removed from the `ComputedSystem` return type — verify they are absent from the snapshot before deleting. | Verify first. |

---

## Ranked repair list

1. **Cold-temperature dataset reconciliation (Claim 2).** 50 states, up to 16 °C,
   11.5 % of module×state combinations produce a different legal string length.
   Point `app/api/engineering/calculate/route.ts` at
   `lib/permit/utils/getThermalDesignBasis` and delete `getDesignTemperatures` from
   `lib/jurisdiction.ts`. **Zero digest impact.** This is the only finding that can
   put a designer on a string length the stamped set says is illegal.
2. **Kill the `-10 °C` literal defaults** (11 sites in `page.tsx`, 1 in
   `app/api/engineering/sld/route.ts:239`). The permit path retired this regime;
   the app did not. Zero digest impact.
3. **One resistance authority for the permit path.** `segment-schedule` (K = 12.9),
   `routeVoltageDropRecalc` and `routeLengthBound` (NEC T8) must not disagree
   inside one package. Needs a digest ruling; pick one and state the basis on the
   sheet.
4. **Delete the dead modules** (`app/engineering/core/*`, `lib/segment-builder.ts`).
   `segment-builder` is the one implementation with a genuinely different physical
   basis (solid copper, 240 V hardcoded on DC runs) — leaving it in place is the
   real hazard, because a future wiring of `cs.segments` would silently import a
   third answer.
5. **Retire or wire up `lib/engineering-automation.ts`** and its four orphan
   routes. Its VD block hardcodes 240 V and duplicates K = 12.9.
6. **Fix `page.tsx:8611`** (`ok: compliance.overallStatus === 'PASS'`) or delete the
   unrendered `permitReadiness` array outright. Latent, but it is the exact defect
   class the snapshot's readiness builder was hardened against.

---

## What did not survive contact with the code

- **"The app and the planset print different voltage drops from different code with
  different constants."** They print the same number from the same function with
  the same constant. The length/thermal divergence is real, documented, classified
  `intentional-supersession` (`build.ts:1152`), and gated by
  `ROUTE-LENGTH-ESTIMATE`.
- **"`conductorAuthority` is never read."** It is read by 17 call sites across
  `electricalPages`, `structuralPages`, `compliancePages`, `sldAdapter`,
  `bomForPermit`, `integratedEquipment`, `fieldLabels`, `hybridReadiness` and
  `snapshot/build`. It never computes a voltage drop; it reads
  `compliance.electrical.acVoltageDrop` (`conductorAuthority.ts:278`).
- **"Two different physical constants (1.732 / 21.2)."** Neither exists in the
  codebase.
- **"`string-generator.ts` has no UI."** It runs on every Calculate.
- **"`permitReadiness` accepts a FAIL."** The snapshot's does not. The app's copy
  does, and renders nothing.
