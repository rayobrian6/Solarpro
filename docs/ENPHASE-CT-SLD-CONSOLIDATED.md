# CT / metering / SLD — consolidated report

**Date:** 2026-09-21 · **Status:** AUDIT COMPLETE.

> **2026-09-25 — IMPLEMENTED.** The authority is `lib/equipment/currentTransformers.ts`
> (ae0b89af) plus the consumption-CT **location** vocabulary
> (`ConsumptionCtLocation`: `sec-line-side-of-main` · `between-tap-and-main` ·
> `main-breaker-load-side`, `consumptionCtBoundaryFor`, `defaultConsumptionCtLocation`).
> ONE composer, `lib/equipment/designMetering.ts` (`resolveDesignMetering`), feeds the
> engineering SLD, the SLD PDF, the permit E-1/E-1.1, PV-4A, both BOMs and the
> engineering page. Default placement from the interconnection: supply-side tap →
> between the tap and the main (Total); load-side → service conductors ahead of the
> main (Net) — printed "DEFAULT — FIELD VERIFY"; the designer can record another
> (`ProjectConfig.consumptionCtLocation`). The snapshot records only an explicit
> choice (`electrical.meteringTopology`), so no existing digest moves. Hybrid
> (multi-lane) SLDs do not draw CTs yet. The text below is the pre-implementation audit.
Supersedes `docs/ENPHASE-CT-TOPOLOGY-REPORT.md` where they differ. Six agents
(four auditors, two adversaries); every claim below was re-verified by me
against the source tree before being written down.

---

## 0. Corrections to what I previously reported

**(a) "The IQ Combiner 6C is never auto-selected in production." — WRONG, and
the truth is worse.** `compatibleCombinerIds` is supplied from exactly two
places: `lib/permit/utils/integratedEquipment.ts:90` and
`app/api/engineering/sld/route.ts:523`. Three other callers of
`resolveIntegratedEquipment` do **not** supply it — `lib/bom-engine-v4.ts:1331`,
`lib/bom-engine-v4.ts:2713`, and `lib/equipment/integratedBos.ts:471` — so they
fall through to `?? getBosDevice('enphase-iq-combiner-6c')`
(`integratedBos.ts:370`).

> **The BOM ships the 6C while the drawings print the 5C.**

Not cosmetic: the 6C declares `disconnect: true` and the 5C does not, and
`providesAcDisconnect` drives the **NEC 690.13** statement on the compliance and
electrical pages. One permit package can contradict itself about whether an
integral AC disconnecting means exists.

**(b) "`/api/engineering/enphase` is on a live path, which makes the wrong SKUs
worse." — HALF WRONG.** The route *is* fetched (`app/engineering/page.tsx:7060`,
`:7272`; my correction of the first audit was right). But its **output is dead**:
both call sites use only `.length` in a `logDecision` string, which pushes into a
50-entry React array that is never persisted. So `ENV-IQ-C4C-240`,
`ENV-IQ-C4-240` and `maxMicroinverters: 600` never reach a BOM, drawing,
snapshot or permit. **P3 data hygiene, not P1.** It must not displace (a).

---

## 1. Manufacturer truth

Unchanged from `ENPHASE-CT-TOPOLOGY-REPORT.md` §1 and still the baseline: no
"Envoy 6C" (it is the **IQ Combiner 6C** containing an integrated IQ Gateway);
Load With Solar vs Load Only is arithmetic, not preference; a supply-side tap
puts only load current downstream, so **Load Only is correct there**; 4th
generation largely **removes the field CT** (6C factory CTs, "does not require
field wiring"; IQ Meter Collar metering integrated at the Load-With-Solar
boundary).

**One rule sharpened.** "Supply-side + breaker backfeed ⇒ refuse" must **not**
be encoded as a label rule. The governing question is which conductors each CT
encircles and which DER sources sit on each side. A mixed system is invalid
*when* load is fed ahead of the consumption CTs or PV lands behind them — which
usually follows from that arrangement but is not implied by the labels.

## 2. Current SolarPro behaviour

**There is no CT domain.** `currentTransformer`, `productionCT`, `consumptionCT`,
`ctPolarity`, `ctDirection`, `meteringMode` and the phrase "current transformer"
each return **zero files** repo-wide. Two traps for the next auditor: `\bCT\b`
matches *Connecticut* and street suffixes in ~50 files, and `LOAD_ONLY` at
`scripts/planset-evidence-ecd.mjs:468` is a regex variable holding
`/705\.12|705\.13/`, not a metering mode.

**"Is there a production meter" has seven representations and the only one
carrying real utility data cannot reach anything.** `lib/utility-rules.ts` and
`data/utilities/*.json` declare `requiresProductionMeter` per utility (Ameren,
ComEd, PG&E, SCE, Duke, PSEG = true). `lib/bom-engine-v4.ts:1804` and `:3067`
gate an Itron meter line on it. But `app/api/engineering/bom/route.ts:340` reads
`body.requiresProductionMeter ?? false`, **the engineering page never sends that
key** (verified: zero occurrences in `page.tsx`), and
`lib/permit/utils/bomForPermit.ts:809` hard-codes `false`. Both gates are
unreachable. Meanwhile `computed-system.ts:2563` pushes a METER-1 row
unconditionally and the renderer draws UTILITY METER unconditionally.

**SolarPro always says there is a meter, never because a datum said so.**

Dead modules found in passing: `lib/computed-plan.ts` — ~1000 lines headed
"Single Canonical Source of Truth" whose `computePlan()` has **zero callers**;
`lib/permit_gen.mjs`, which renders "Production Meter ✓ Installed", has zero
importers.

## 3. Why the SLD prints Electrical PASS with no CT topology

**`PASS` is the initialiser, not a conclusion.** `lib/electrical-calc.ts:1304`:

```ts
let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
if (allErrors.length > 0) status = 'FAIL';
else if (allWarnings.length > 0) status = 'WARNING';
```

Every electrical verdict in the app means "no enumerated check objected". No CT
check is enumerated, so **the absence of a CT model is indistinguishable from
compliance.** The sheet's only electrical verdict cell is the 120% rule — an
inequality over four numbers (bus rating, main breaker, PV backfeed, battery
backfeed) at `sld-professional-renderer.ts:2979`, `:3001`, `:4340`. CTs are not
an input to it, so wrong, missing, sealed-away or arithmetically impossible CT
arrangements all print PASS.

Four further vacuities, all verified:

1. **The engine not running is reported as PASS.**
   `app/api/engineering/calculate/route.ts:328` —
   `const electricalStatus = electricalResult?.status ?? 'PASS';`
2. **🚨 The 120% check is disarmed for the DEFAULT configuration of every
   system.** `computed-system.ts:2863` defaults `interconnectionMethod` to
   `'LOAD_SIDE'`, whose `else` branch maps it to `LOAD_SIDE_TAP`; and
   `segment-builder.ts:424` raises `NEC_705_12B_120PCT_VIOLATION` **only** under
   `BACKFED_BREAKER`, with `interconnectionPass` initialised `true` at `:421`.
   A real load-side tap *is* subject to 705.12(B). This is larger than the known
   micro-only gap and it affects micro designs too.
3. **Choosing supply-side switches the gate off**, in three places
   (`electrical-calc.ts:906-912`, `computed-system.ts:1413`,
   `sld-professional-renderer.ts:4340`).
4. **A failed check is upgraded to PASS.** `electrical-calc.ts:950` —
   `interconnectionPasses = true; // Method is valid — just needs action`, after
   pushing a warning for a required main-breaker replacement.

Also: `lib/permit/sections/validationPage.ts:157` prints **"Electrical Data
Verified: PASS"** for `totalPanels > 0 && inverterModel !== '—'`.

**Interconnection substring matchers: five, not three** —
`computed-system.ts:2864`, renderer `:1912` and `:3560`,
`snapshot/build.ts:854`, `sld/pdf/route.ts:204`, plus a sixth normalizer at
`sld/route.ts:743`. And `lib/engineering/reportGenerator.ts:267` maps survey
value `sub_panel` to **`'supply-side'`**, which is backwards — a sub-panel
connection is load-side, 705.12.

## 4. Missing authority

Which conductors each measurement device encircles, and which DER sources sit on
each side. Everything else — mode, NEC article, validity, what the SLD draws —
is derivable from that, and from nothing currently in the repo.

## 5. Proposed canonical model

As in `ENPHASE-CT-TOPOLOGY-REPORT.md` §4: `MeasurementChannel` +
`MeasurementBoundary`, with
`realisation: FIELD_CT | EQUIPMENT_INTEGRATED | UTILITY_METER | UNKNOWN` so the
6C and Meter Collar (zero field CTs) are first-class. **Mode is DERIVED, never
selected**, and returns `INDETERMINATE` (refuse) when load sits ahead of the
consumption boundary or PV lands behind it. Direction is an electrical property,
never a renderer rotation. Enphase rules live in an Enphase ruleset, not in the
core types.

**It cannot be built on top of interconnection as it stands** — six enums and
five substring matchers. They must be co-validated.

## 6. Implementation sequence

**Stage 0 — independently proven, needs no new model.** None of these depend on
the CT architecture and all reach a permit today:

- **0a (P0)** `lib/permit/generatePermit.ts:361-371` battery fabrication — the
  comment *"Do NOT fabricate battery data"* sits eleven lines above
  `project.batteryKwh = 5.0` and `batteryBackfeedA = 20 * count`, and
  `batteryBackfeedA` feeds the 705.12(B) calculation. The IQ Battery 10C is in
  no catalogue, so every 10C project lands exactly there.
  **NEW: `lib/permit/utils/sldAdapter.ts:313` is a SECOND, independent copy of
  the same 20 A-per-unit fabrication.** Fixing one leaves the other.
- **0b** Make `bom-engine-v4.ts:1331`, `:2713` and `integratedBos.ts:471` pass
  `compatibleCombinerIds` so BOM and drawings resolve one device (§0a above).
- **0c** Fix the `requiresProductionMeter` wiring or delete the gate — do not
  leave a utility data column that reaches nothing.
- **0d** `computed-system.ts:2561` hard-coded `'IQ Combiner 4C'`.
- **0e** `tests/planset/integrated-bos.test.ts` fixture must carry
  `compatibleCombinerIds`. Expect it to fail: the drawing path selects the 5C.
- **0f** `reportGenerator.ts:267` `sub_panel` → load-side, not supply-side.

Then: types only → equipment-integrated metering → derive mode → co-validate
with interconnection and storage → SLD input model → rendering → snapshot last.

## 7. Migration / legacy

`hasProductionMeter` is **dead**, so replacing it regresses nothing.
The snapshot is the constraint: `lib/permit/snapshot/build.ts:1109` is the single
metering line, and adding metering content **moves every digest and retires live
PE approvals** — removing a `null` leaf moves it exactly as adding a field does.
It goes last, through the documented snapshot-shape procedure.

`equipment-db`'s IQ8 `compatibleWith` rows are **manufacturer data**; correcting
5C→6C needs Enphase's real compatibility matrix, not a guess. Note the
manufacturer constraint the repo cannot express at all: the 6C does **not** work
with any IQ System Controller.

Legacy projects have no CT data. They must resolve to `UNKNOWN`, and `UNKNOWN`
must not render as a confident drawing.
