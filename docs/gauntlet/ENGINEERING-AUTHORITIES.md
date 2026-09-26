# Duplicated engineering authorities — read-only sweep, 2026-09-26

100 agents, 0 errors. Eight constant families. **246 copies mapped, 28 confirmed
defects, 18 killed** by a two-lens adversarial pass (is it wrong against the
PUBLISHED STANDARD, and does it reach an output). **20 of the 28 are in the UNSAFE
direction** — less conservative than the code.

The rule the sweep was given, and which it kept proving: **check each copy against
the standard, never against the other copy. Two agreeing copies can both be wrong.**

| Family | Copies | Confirmed | Killed |
|---|---|---|---|
| voltage-drop | 14 | 3 | 3 |
| conduit-fill | 21 | 1 | 3 |
| ocpd-breaker | 38 | 5 | 1 |
| rooftop-adder | 36 | 5 | 1 |
| grounding | 29 | 3 | 3 |
| battery-pcs | 35 | 5 | 1 |
| structural-constants | 29 | 2 | 4 |
| module-inverter-limits | 44 | 4 | 2 |


---

## voltage-drop

> VOLTAGE DROP has NINE implementations in this repo and FOURTEEN declarations of the constants they depend on. The resistance data splits into two sub-families: a K=12.9 Ω·cmil/ft + circular-mils form (lib/computed-system.ts:735, lib/segment-schedule.ts:369, lib/engineering-automation.ts:448) and an ohms-per-1000-ft table form (lib/equipment-db.ts:2488 read by lib/manufacturer-specs.ts:168, lib/sld-professional-renderer.ts:4343, lib/segment-builder.ts:156, app/engineering/core/stringSystem.ts:189). GOOD NEWS FIRST, so it is on the record: every circular-mils value in all three K-based copies is CORRECT against NEC Chapter 9 Table 8 (4110 / 6530 / 10380 / 16510 / 26240 / 41740 / 52620 / 66360 / 83690 / 105600 / 133100 / 167800 / 211600), K=12.9 for copper at 75 °C is correct and reproduces Table 8 to within 0.5% from #6 up, the #6-through-#4/0 rows of every ohms/kFT copy match Table 8 exactly, and lib/electrical/routeLengthBound.ts:77 states the NEC informational-note recommendations (3% branch, 3% feeder, 5% combined) correctly with the right citations. The DC and AC paths use the same formula and the same 2× round-trip factor, which is right for every 1Ø circuit this engine builds. The defects are elsewhere. The worst is that the DC and AC paths do NOT use the same VOLTAGE basis: SegmentScheduleInput has no DC voltage field at all, so segment-schedule divides a DC string's drop by the 240 V AC service voltage, and that number then OVERWRITES the correct string-Vmp number computed-system already computed. The second worst is Rule 2 in its purest form: two conductor selectors exist, computed-system's gates on voltage drop and segment-schedule's does not, and segment-schedule's ampacity-only pick overwrites the other. Third, the ohms/kFT copies are all cited to 'NEC Ch.9 Table 8 (Cu, stranded)' and four of thirteen rows are not that column in any of them — the copies that AGREE are wrong together at #8 AWG. Fourth, the single resistance table that decides the printed MAXIMUM ONE-WAY LENGTH stops at #2/0 and skips #3 AWG, so three of the thirteen gauges the engine can select have no resistance at all. Verdict: this family is NOT single-sourced, four of its copies are wrong against the published table, two of them decide what gets installed and printed, and the 3%/5% limit is restated in ten places of which exactly one knows the branch/feeder split. Fallbacks, assessed per Rule 4: `?? 10380` (computed-system:750, segment-schedule:384) is UNREACHABLE today because every gauge handed in comes from an AWG_ORDER whose keys match the map exactly — a latent hazard, not a defect; `|| 83690` (engineering-automation:451) is likewise unreachable because that function's gaugeOrder is clamped to 14…1; `?? 1.24` (sld-professional-renderer:4339) substitutes #10's resistance for any unparsed gauge and would be 24×–34× high on a kcmil conductor, but nothing puts a kcmil gauge in a tag row today; `?? 0.0608` (segment-builder:173) and `?? 1.0` (stringSystem:194) sit in dead files. None of these five provably equals what the surrounding logic would choose — they are fabricated absences — but only manufacturer-specs.ts:175's `return 0` is reachable and material, and it is reported below.

### A DC string's voltage drop is printed as a percentage of 240 V — the AC service voltage — because segment-schedule has no DC voltage input, and that number overwrites the correct one

`lib/segment-schedule.ts`:788 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** On every string-inverter or optimizer job, the DC string run row on E-1 and PV-4B prints a voltage-drop percentage ~2.6× the real one, and the volts column beside it no longer divides into it. Worse, lib/permit/snapshot/electricalProjection.ts:1762 grades that row with gradeVoltageDropPolicy, and 'ARRAY_TO_JBOX' does not match the feeder regex in vdLimitPctForSegment (routeLengthBound.ts:163), so it is graded as a BRANCH: 2% design target, 3% recommendation. Worked case — a 200 ft #10 AWG DC string at 18 A: drop = 18 × 12.9 × 200 × 2 / 10380 = 8.95 V. True percentage against a 620 V string = 1.44% (well inside the 2% target). Printed = 8.95/240 = 3.73%, which routeLengthBound.ts:152-158 renders as 'EXCEEDS NEC 210.19(A) Informational Note 4 — 3.73% > 3.0%' with `definitiveFailure: true` and `compliant: false` — a blocking compliance failure, printed on a stamped sheet, against a code section that does not apply to a DC PV source circuit, on a design whose real drop is 1.44%. At 150 ft the same string prints 2.80% and E-1 reads 'CODE COMPLIANT — 2.0% DESIGN TARGET EXCEEDED' where the truth is 1.08%. Micro jobs are unaffected (ARRAY_TO_JBOX is the 240 V AC branch there, and ROOF_RUN has no mapping so it keeps computed-system's correct DC basis).

**Smallest repair.** Add `systemVoltageDC` (string Vmp, or Voc where a max-voltage basis is intended) to SegmentScheduleInput; pass it at lines 788 and 811 instead of `sysV`; have lib/permit/utils/computedRuns.ts and app/engineering/page.tsx populate it from the same `strings[0].stringVmp` computed-system already uses. Also back-populate `run.voltageDropVolts` alongside `run.voltageDropPct` at computed-system.ts:2530 so the two columns cannot disagree, and make vdLimitPctForSegment classify DC source circuits explicitly rather than defaulting them to the AC branch rule.

### 🔥 The conductor that ships is chosen with NO voltage-drop check: segment-schedule's ampacity-only autoSizeGauge overwrites computed-system's voltage-drop-gated selection

`lib/segment-schedule.ts`:397 — copies disagree: `True`, wrong vs standard: `False`

**Consequence.** Worked case — a 120 ft AC feeder at 32 A, 240 V, 2% design target (lib/permit/utils/computedRuns.ts:278): ampacity-only sizing returns #8 AWG (50 A at 75 °C ≥ 32 × 1.25 = 40 A). Voltage drop on #8 = 32 × 12.9 × 120 × 2 / 16510 = 6.0 V = 2.50%, over the 2% target. computed-system's autoSizeWire would have bumped to #6 (1.57%). segment-schedule keeps #8, and because `run.conductorBundle` and `run.conductorCallout` are also overwritten, the BOM (computed-system.ts:2830 'Wire by gauge — derived from segmentSchedule conductorBundle[]') ORDERS #8 and the sheet PRINTS #8. The package then contradicts itself: the segment row carries voltageDropPass = false → overallPass = false, which surfaces as `pass:false` on the SLD conductor schedule (lib/sld-professional-renderer.ts:3900) and a red dot in the engineering UI (app/engineering/page.tsx:13032), while E-1's own conclusion for the same feeder passes it (see the limit finding below). The design's stated 2% target is unenforceable on every principal run, and the wire that is purchased is the smaller one.

**Smallest repair.** Give autoSizeGauge the length, circuit voltage and limit and make the loop `if (effectiveAmpacity >= requiredAmpacity && calcVoltageDrop(...) <= maxVDropPct)`, so the one selector that survives back-population enforces the same rule the discarded one did. Then retire computed-system's autoSizeWire/autoSizeOpenAirWire voltage-drop branch, or stop the back-population from overwriting a gauge that was chosen against more constraints than the replacement was.

### 🔥 The resistance table that decides the printed MAXIMUM ONE-WAY LENGTH stops at #2/0 and skips #3 AWG, so three selectable gauges silently return a voltage drop of zero

`lib/equipment-db.ts`:2487 — copies disagree: `True`, wrong vs standard: `False`

**Consequence.** A #3/0 or #4/0 AC service feeder, or a #3 AWG feeder, makes routeLengthBound return state 'unbounded' (routeLengthBound.ts:236-247), so `r.designMaxOneWayFt` and `r.designLengthNote` are never set (permit/snapshot/build.ts:2263-2265), no 'MAXIMUM ONE-WAY LENGTH n FT AT 3% Vd' note prints, and the ROUTE-LENGTH-ESTIMATE requirement stays BLOCKING — the entire mechanism built to close packages without an attic walk fails for the three largest gauges the engine can select, which are precisely the long service runs it was built for. Separately, if a field measurement lands on such a run, routeVoltageDropRecalc returns null and the sheet's voltage-drop cell flips from a printed percentage to 'PENDING' (lib/permit/sections/electricalPages.ts:1071). And in electrical-calc's AC path, `startingGauge: normalizeGauge(str.wireGauge)` / `manualGaugeOverride` for #3, #3/0 or #4/0 gives `AWG_ORDER.indexOf(startGauge) === -1`, so lib/wire-autosizer.ts:158 resets the search to index 2 (#10 AWG) and the designer's stated conductor is never evaluated; the search then cannot reach past #2/0 and falls through to lines 244-260, which return '#2/0 AWG' with `ampacityPass: false, voltageDropPass: false` — a conductor reported as selected while flagged FAILED.

**Smallest repair.** Populate the shared Table 8 module with every row Table 8 has and have manufacturer-specs read it, so the resistance roster and lib/segment-schedule.ts:276's selection roster are the same list. Make calcVoltageDrop return null (not 0) for an unresolvable gauge so wire-autosizer.ts:187 cannot convert a refusal into a pass, and drop the '#3 AWG'-shaped holes from manufacturer-specs.AWG_ORDER.


---

## conduit-fill

> The conduit-fill family is NEC Chapter 9 Table 4 (raceway TOTAL interior areas) and Table 1 (allowable fill as a percentage of that total: 53% for one conductor, 31% for two, 40% for over two). lib/nec/chapter9.ts is genuinely canonical and genuinely CORRECT — I checked all 50 Table 4 entries against the published table and re-derived them from the published interior diameters, and fillLimitPct returns the right three percentages; the four main engines (computed-system, segment-schedule, segment-builder, manufacturer-specs/electrical-calc) all route through it now. But there are 21 further copies of a Table 1 or Table 4 constant, and three of them are live DECIDING copies that are wrong against the published standard. The worst is lib/engineering-automation.ts:142-169, whose conduit-area table is not NEC Table 4 for any material (1/2\" = 0.078 in2 against EMT's 0.304 — an implied interior diameter of 0.315\" where EMT's is 0.622\") and whose Table 1 limit is keyed by raceway MATERIAL instead of conductor count, handing PVC Sch 40 a 53% allowance where the code gives 40%; that function selects the trade size and prints the fill percentage onto the auto-generated SLG document served by /api/engineering/auto-configure. Second, lib/engineering/reportGenerator.ts picks a conduit trade size from an ampacity bracket with no area, no percentage and no conductor count at all, and its answer reaches an equipment-schedule line item, a rendered SLD SVG and the Engineering tab, disagreeing with the Chapter 9 engine's answer for the same feeder by one trade size on every job. Third, lib/segment-builder.ts still carries a Table 5 copy that is 15-20% low for every size #1 AWG and up and feeds it into the canonical selector — but its output is provably consumed by nothing, so it is a loaded gun, not a shipped defect. The 2.5x shape the brief warned about does recur, in a mutated form: engineering-automation reports percent-of-allowance under the name of NEC fill, so a raceway legally at the 40% limit prints as 100%.

### 🔥 reportGenerator picks the conduit trade size from an ampacity bracket with no area, no fill percentage and no conductor count — and that size is printed on an SLD and bought as an equipment-schedule line

`C:/Users/Ray/Solarpro Claude/repo/lib/engineering/reportGenerator.ts`:29 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** generateEngineeringReport is live on three routes — app/api/engineering/generate/route.ts:11, app/api/engineering/report/route.ts:11, app/api/engineering/preliminary/route.ts:29 — plus lib/engineering/syncPipeline.ts:19. dcConduitSize/acConduitSize (lines 294, 296) then reach: the EQUIPMENT SCHEDULE, where the conduit trade size IS the line item's `model` and `specs` (lines 472-484) — that is the conduit a crew orders; the rendered single-line-diagram SVG, which prints `acConduit` as a wire label (lib/engineering/artifactBuilders.ts:159); the saved engineering artifact text (artifactBuilders.ts:70/73 and app/api/engineering/save-outputs/route.ts:410/413); and the customer-visible Engineering tab (components/engineering/EngineeringTab.tsx:215/224). Because app/engineering/page.tsx:6224/6227 populates the identical two fields from the Chapter 9 engine instead, one project yields two different conduit trade sizes on two different surfaces — the AC feeder above prints 3/4" EMT from the engine and 1" EMT on the equipment schedule and the SLD. The AC side over-buys one trade size (cost, not safety). The DC side is the unsafe one: a >=5-string design gets a 3/4" EMT printed and scheduled at 43.5% fill against the 40% limit, and no amount of downstream checking catches it because the number never passed through a fill calculation. The `?? '3/4" EMT'` and `?? '1" EMT'` fallbacks at artifactBuilders.ts:70/73/159 and save-outputs/route.ts:410/413 are fabricated absences — they are arbitrary trade sizes, not what the surrounding logic would choose, and they print on the SLD when the engine produced nothing.

**Smallest repair.** Delete the `conduit` column from both bracket tables. Build the actual bundle (stringCount x 2 DC conductors + EGC on the DC side; 2 hots + neutral + EGC on the AC side), sum Table 5 areas from chapter9's CONDUCTOR_AREA_IN2, and call selectSmallestConduit(type, area, count). Replace the `?? '3/4" EMT'` / `?? '1" EMT'` print fallbacks with 'PENDING' so an unestablished raceway cannot be drawn as a real one.


---

## ocpd-breaker

> This family is the NEC 240.6(A) standard-OCPD ladder plus the NEC 705.12(B)(3)(2) 120% busbar allowance and the NEC 705.11 supply-side rule. lib/electrical/stdSizes.ts IS canonical and IS correct — all 30 rows from 15 A to 1200 A match 240.6(A) exactly, and about twenty call sites genuinely delegate to it. But it is not alone: four more re-typed 240.6 ladders survive (manufacturer-specs.ts capped at 400 A, rules-engine.ts at 200 A, stringSystem.ts at 125 A, plus a 2-pole subset in segment-schedule.ts that clamps at 200 A), and — worse — the exact rounding rule stdSizes.ts line 16 explicitly forbids, `Math.ceil(x/5)*5`, is still live in eight places, three of which DECIDE the OCPD printed on a sheet and shipped on a BOM. On the interconnection side the arithmetic is in fifteen places; the six that matter most (computed-system, electrical-calc, computed-multi-system, bom-engine, the SLD renderer, the permit projection) all implement `backfeed + main <= bus * 1.2` correctly and agree. The defects are at the edges: two survey-side copies define "120% rule passes" as "maxBackfeed > 0" — they AGREE with each other and are BOTH WRONG, because neither ever compares the design's actual backfeed; three live copies substitute `mainPanelAmps * 0.2` for `bus * 1.2 - main`, one of which decides whether an engineering report specifies a supply-side tap; and one survey prefill fabricates the solar breaker as exactly the allowance, making its NEC 705.12 recommendation a tautology that can never fail while reporting `confidence: 'high', source: 'nec'`. NEC 705.11's 10-ft tap limit is the clean result: one constant, one authority, correct. NEC 705.12(B)(3)(1) (the alternative sum-of-breakers-excluding-the-main path) is not implemented anywhere, which is conservative, not a defect.

### 🔥 The banned Math.ceil(amps/5)*5 OCPD rounding is still live in eight places, and on the preliminary route it is the ONLY thing that sizes the AC OCPD that reaches the SLD, the BOM and the report

`app/api/engineering/preliminary/route.ts`:337 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** On /api/engineering/preliminary the value is not a fallback — line 337 is the only OCPD computation, and line 338 sets `backfeedAmps = acOCPD`. It then flows to renderSLDProfessional (line 422), which prints it as the 'AC OCPD (125%)' row on the preliminary single-line diagram, and to generateBOMV4 (line 378), where lib/bom-engine-v4.ts:2091 uses it as `ocpdForEgc` (EGC size), :2125 as `gecOcpd`, and :2296 emits the BOM line '55A 2-Pole Breaker (spare)' with Square D part number 'QO55-SPARE'. A 10 kW preliminary quote therefore ships a drawing and a priced BOM naming a 55 A breaker that Square D does not make. The installer buys the real next size (60 A) while the conductor and EGC were sized to 55 A; at 25 kW the gap is 130 A specified vs 150 A installed, where autoSizeGauge picks #1 AWG (145 A at 75 °C) for 130 A but a 150 A breaker requires #1/0 — the installed conductor is then under-protected. On /api/engineering/sld the same formula fires whenever computeSystem throws (route.ts:762-770 sets systemModel = null), and because resolvedBackfeedAmps defaults to resolvedAcOCPD it also drives the 120% row and the breaker callout on that degraded sheet.

**Smallest repair.** Replace every Math.ceil(x/5)*5 and Math.ceil(x/10)*10 OCPD expression with nextStandardOcpd from lib/electrical/stdSizes. In preliminary/route.ts:337 that is a one-line substitution. For the two SLD routes, decide whether an absent engine value should be recomputed at all — pdf/route.ts:301 already argues (for panelBusRating) that a caller with no value must not get a fabricated one; the same reasoning applies to acOCPD. Add a source-scanning guard that fails on /Math\.ceil\([^)]*\/ *(5|10)\) *\* *(5|10)/ in any file that also mentions OCPD or breaker.

### A SECOND full NEC 240.6 ladder capped at 400 A drives sizeAcBranch — and lib/electrical-calc.ts imports both ladders under names differing only in letter case

`lib/manufacturer-specs.ts`:122 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** sizeAcBranch().ocpdAmps is the AC OCPD the engineering page's Electrical tab reports and the per-inverter/per-sub/POI aggregate value at lib/electrical-calc.ts:874, :1454 and :1551. Above 400 A continuous (96 kW at 240 V, or a 208/480 V three-phase commercial design — lib/roadmapRE26.ts:438 names Sungrow, SolarEdge, Fronius and the Sol-Ark 30K-3P-208V as the 208/480 V 3-phase line) that engine returns a rating in 10 A steps that no manufacturer lists, while totalInterconnectionBackfeedA in the very same file rounds the same current to a real 240.6 size. The two numbers then disagree on one sheet. The direction is oversize-but-unorderable rather than undersize, so the immediate risk is a drawing calling out a device that cannot be bought and a busbar sum computed from a fictitious rating.

**Smallest repair.** Delete STANDARD_OCPD_SIZES and nextStandardOCPD from lib/manufacturer-specs.ts and re-export nextStandardOcpd from lib/electrical/stdSizes under the old name, the way lib/permit/utils/helpers.ts:637-645 and lib/equipment/integratedBos.ts:848 already do. Then remove the now-duplicate import in lib/electrical-calc.ts so only one spelling exists in that file. While there, extend NEC_STANDARD_OCPD with 1600/2000/2500/3000/4000/5000/6000 and drop the Math.ceil(amps/100)*100 tail in stdSizes.ts:26, which returns 1300 A where 240.6(A) says 1600 A.

### The engineering report picks load-side vs supply-side from busbar × 0.2, with one field standing in for both the busbar and the main breaker and a fabricated 200 A when the survey is silent

`lib/engineering/reportGenerator.ts`:263 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** interconnectionType (line 265-268) is the report's stated interconnection method whenever the field tech left pd.interconnection_point blank, and 'supply-side' is not a label — it is a different scope of work. Downstream, SUPPLY_SIDE_TAP in lib/bom-engine-v4.ts:1876-1891 deletes the backfed breaker and adds three NSI Polaris IPLD350-3 insulated multi-tap connectors plus a fused AC disconnect that must now BE the OCPD, and lib/computed-system.ts:1582-1589 imposes the 705.11(C) ≤10 ft placement constraint on the disconnect. So a derated-main service gets quoted and drawn for a utility-coordinated line-side tap it does not need. The `?? 200` compounds it: with no survey data the rule runs on an invented busbar, and unlike app/api/engineering/sld/pdf/route.ts:296-302 — which explicitly refuses to fabricate panelBusRating because 'a caller that genuinely has no value must NOT get a fabricated one' — this path states the conclusion anyway.

**Smallest repair.** Take the busbar rating and the main breaker as two inputs and call the same helper lib/electrical-calc.ts:976 uses, or import a single exported maxLoadSideBackfeedA(busA, mainA). When panel_rating_amps is absent, return the interconnection type as unresolved rather than deriving it from 200 A — the report already has a complianceNotes channel (line 271-276) to say so.

### 🔥 The survey's NEC 705.12 interconnection recommendation is a tautology: it fabricates the solar breaker as exactly the 120% allowance, so 'high confidence, source: nec' can never fail

`lib/survey/prefillComputations.ts`:167 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** components/survey/StepElectrical.tsx:161-167 renders the result as a RecommendationValue with confidence 'high' and source 'nec', mapped through necToSurveyMap (line 153-158) into the survey's interconnection_point chip the surveyor accepts. Every surveyed panel therefore gets 'Load Side, high confidence' attributed to the NEC, together with a derivation string (line 178) quoting real-looking arithmetic — '200A bus × 1.2 = 240A - 200A main = 40A max solar. Need 40A breaker.' — where the 40 A 'need' was manufactured to match the 40 A limit. That chip is the field-captured interconnection point that lib/engineering/reportGenerator.ts:264 and lib/system/electricalFromSurvey.ts:297 then treat as inspector-captured ground truth, ahead of their own checks. A guard that cannot fail is worse than no guard, because the three downstream consumers trust it more than their own arithmetic.

**Smallest repair.** Require the solar breaker: if the caller cannot supply it, return confidence 'low' with source 'ecosystem' and a derivation saying the check is pending, the way the no-panel-data branch at line 155-164 already does. Have StepElectrical pass the design's backfeed breaker when a system size exists, and stop defaulting mainBreaker to busRating — ask for the main breaker as its own survey field, since the whole allowance turns on the difference between the two.

### 🔥 The BOM caps the backfeed breaker with raw arithmetic instead of the 240.6 ladder, so a BOM line and a Square D part number can name a breaker that does not exist

`lib/bom-engine-v4.ts`:1857 — copies disagree: `False`, wrong vs standard: `True`

**Consequence.** A 320 A service with a 200 A main — a common commercial-residential meter-main — produces the BOM line '184A Backfeed Breaker, QO184' and the compliance note 'NEC 705.12(B): Backfeed breaker 184A — 120% rule: (320A × 1.2) − 200A = 184A max' (line 1872-1874), plus the same figure in the item description that the permit package prints. No such device exists, so the installer buys the nearest one. Rounding UP to 200 A puts 200 + 200 = 400 A on a 384 A allowance — the design the BOM certified as compliant now violates 705.12(B)(3)(2). Rounding down to 175 A is safe but silently changes the PV breaker the drawing calls out. Either way the BOM priced a part number that cannot be ordered.

**Smallest repair.** `const backfeedAmps = Math.min(requestedBreaker, prevStandardOcpd(maxPVBreaker));` using prevStandardOcpd from lib/electrical/stdSizes (already imported at line 34 alongside nextStandardOcpd, and already used for exactly this purpose in lib/electrical-calc.ts:961). Apply to both 1857 and 3185. Keep maxPVBreaker unrounded for the warning text so the note still states the true allowance.


---

## rooftop-adder

> TWO families, and they behave very differently. (1) THE DESIGN AMBIENT is genuinely single-sourced and I am reporting that as a clean result: one table (lib/permit/utils/designTemps.ts:26-42), one resolver (getThermalDesignBasis), and lib/jurisdiction.ts:323 is a documented value-free delegate to it. Every live entry point reads it. Its defects are all at CONSUMERS, not a second table. (2) THE ROOFTOP TEMPERATURE ADDER is the opposite: ~15 value copies carrying THREE different numbers (33, 30, 35) and SIX mutually contradictory applicability rules, none of which is the published table. NEC 310.15(B)(3)(c) is a FOUR-ROW lookup on height above roof — 33 °C at 0-1/2 in, 22 °C at 1/2-3.5 in, 17 °C at 3.5-12 in, 14 °C at 12-36 in — scoped to CIRCULAR RACEWAYS exposed to sunlight, and deleted for PV by NEC 2017 690.31(A). Not one copy in this repo takes a height; every copy is a flat scalar. 33 is the worst-case row (defensible); 30 and 35 match NO row. The edition gate exists exactly once (computed-system.ts:982) and reads `input.necEdition`, a field ComputedSystemInput does not declare and NO caller sets — so it is permanently false. The result is the same inversion as the 310.16 defect: the copy that PRINTS the basis is gated (and prints "no rooftop adder applied"), while the copy that SELECTS the conductor adds 33 °C unconditionally — and adds it to the OPEN-AIR runs the table never covered while withholding it from the on-roof RACEWAYS it did cover. Verdict: a large, live defect family with printed-vs-installed divergence on every project and a 33 °C adder reaching ground- and fence-mount BOMs.

### The rooftop adder is applied to the OPEN-AIR runs the table never covered and withheld from the on-roof RACEWAYS it did cover — the scope is exactly inverted, in three sizing files

`lib/segment-schedule.ts`:578 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** buildSegmentSchedule's output is the back-population source for the installed conductor: lib/computed-system.ts:2466-2468 overwrites `run.conductorBundle`, `run.conductorCallout`, `run.conduitSize` from it. So the DC string callout printed on E-1/PV-4B and the conductor quantities on the permit BOM are derived at ambient+adder for the free-air run, and at bare ambient for the on-roof conduit — the reverse of the code. A 4-string array (8 CCC → 0.70 count adjustment) at IL ambient 33 °C: with the adder, 40 A × 0.70 × 0.58 = 16.2 A < 18.75 A required → upsized to #8; without it, 40 A × 0.70 × 0.96 = 26.9 A → #10 passes. One extra gauge on the ordered wire, on the wrong segment.

**Smallest repair.** Move the roof/raceway/edition decision into one function that returns the effective ambient per segment id, and call it from segment-schedule.ts:677/703/772/798, computed-system.ts:1602/1648/1801 and makeRunSegment — keying on the segment's own `isOpenAir`/`raceway` field rather than on which branch of the topology `if` the code is in.

### A 33 °C rooftop adder is applied to GROUND- and FENCE-mount projects on the live planset path, while the same plan set prints 'no rooftop temperature adder applies'

`lib/permit/utils/computedRuns.ts`:102 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** Every ground- and fence-mount permit package is generated with a 33 °C rooftop adder baked into the conductor sizing and the BOM, while PV-4A prints, from lib/permit/sections/electricalPages.ts:1019 and :1025, 'No rooftop temperature adder applies — ground-mounted system (NEC 310.15(B)(3)(c) N/A)' and 'Note: Rooftop temperature adder (NEC 310.15(B)(3)(c)) does NOT apply'. The sheet says one thing; the wire on the truck is sized for another. For a 4-string ground array at IL ambient 33 °C this is #8 ordered where #10 is compliant (0.58 vs 0.96 correction factor) — a BOM line, a price, and a printed callout.

**Smallest repair.** Make the unscoped fallback 0, not 33, and have buildComputeSystemShadow and bomForPermit.ts:794 pass the project's resolved system type (both already have it — bomForPermit computes `key` at :505) plus the adopted NEC edition.

### Three different adder values (33 / 30 / 35) for the same physical roof run across the three live entry paths

`app/engineering/page.tsx`:3064 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** The Design Studio and the stamped plan set derate the same roof DC run at different temperatures. IL ambient 33 °C: Design Studio 33+30 = 63 °C → 0.65 (lib/nec/ampacity.ts:128); plan set 33+33 = 66 °C → 0.58 (:129). AZ ambient 43 °C: 43+30 = 73 → 0.50 (:130) vs 43+33 = 76 → 0.41 (:131), an 18% ampacity difference that flips the gauge on any run with a count adjustment. The user sees one conductor on screen and a different one on the permit sheet for the same job.

**Smallest repair.** One exported function — `rooftopAmbientAdderC({ systemType, necEdition, heightAboveRoofIn })` — returning the real four-row table (33/22/17/14) or 0 when the adopted edition is 2017 or later, and delete the eight literals.

### 🔥 A hard 40 °C clamp on the design ambient, justified by a comment that misdescribes the field — LESS conservative than the site's own ASHRAE authority in AZ and NV

`app/engineering/page.tsx`:3061 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** UNSAFE DIRECTION. In Arizona and Nevada the Design Studio credits more ampacity than the code allows at the site's own design ambient — 0.91 instead of 0.87 bare, and with the 30 °C adder 70 °C → 0.58 instead of 73 °C → 0.50, a 16% over-credit. Because app/engineering/page.tsx:2960 states this memo feeds the SLD, BOM, Electrical, Conduit and Permit modules, an under-derated feeder or DC home run can be quoted, drawn and sold. (The per-route /api/engineering/calculate path overwrites designTempMin/Max at :287-291, so the clamp does not reach the server-side engine — but it does reach everything the client renders.)

**Smallest repair.** Drop the Math.min and the `?? 40`; read `getThermalDesignBasis({ lat, lng, state }).maxDesignTempC` directly, exactly as designTempMin already does two lines above at :3055-3056. Correct the comment at :3058 — autoDetected.designTempMax is the air ambient.

### 🔥 The SLD route resolves the thermal authority, uses its cold side, and throws its hot side away for a flat 30 °C

`app/api/engineering/sld/route.ts`:717 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** UNSAFE DIRECTION. An SLD request without an explicit ambient is sized at 30 °C → factor 1.00 (lib/nec/ampacity.ts:109) where an IL job should use 33 °C → 0.96 and an AZ job 43 °C → 0.87. The route returns `runs: computedRuns` at :861, so its conductor schedule under-derates relative to the permit set built from computedRuns' ASHRAE value — the same job, two conductor schedules. A ground-mount SLD request that omits the adder also gets a 30 °C rooftop adder it should not have.

**Smallest repair.** `ambientTempC: Number(body.ambientTempC ?? _sldThermal.maxDesignTempC)`, and scope :718 to `_systemType === 'roof'` with the edition gate.


---

## grounding

> GROUNDING AND BONDING is the most duplicated constant family left in this repo. NEC Table 250.122 (EGC vs OCPD) exists as SEVEN independent implementations — six hand-written ladders plus one inline 3-rung ternary written twice — and only ONE of them (lib/manufacturer-specs.ts:150 getEGCSize) matches the published table through 800 A. Three copies (segment-schedule, wire-autosizer, computed-system) flatten to #2 AWG above 400 A where the table keeps stepping to #1 / #1/0 / #2/0; app/engineering/core/stringSystem.ts flattens to #4 above 300 A; lib/segment-builder.ts returns #14 AWG at a 20 A OCPD where the table requires #12 — the same wrong-direction shape as the `size * 15` invention that was just fixed, at the single most common PV branch OCPD; and bom-engine-v4's inline ternary flattens to #6 above 100 A, so a 300 A feeder is BILLED #6 where the table requires #4. Every one of these is a flat region at the top of a lookup table — rule 3 exactly. NEC Table 250.66 (grounding-electrode conductor) is worse: it has THREE copies that DISAGREE WITH EACH OTHER AT EVERY RUNG, and none is indexed on the quantity Table 250.66 is actually indexed on (the largest ungrounded service-entrance conductor) — all three index on OCPD amps, and all three ignore 250.66(A), which caps a rod-only GEC at #6 Cu. Separately, the rule deciding WHETHER a new electrode is required was fixed in one bom-engine-v4 emitter and left unfixed in the other, so a hybrid job's BOM buys a phantom ground rod + 50 ft GEC while the plan set prints "no separate grounding electrode conductor or new electrode is added". Verdict: the family is genuinely defective, the authoritative copy is correct, and the existing guard test (tests/necAmpacityIsSingleSourced.test.ts:212-245) exercises only two of the seven copies — six are unguarded, and its source scan walks `lib/` only, so anything under `app/` is invisible to it.

### 🔥 Table 250.66 GEC rule has three copies that DISAGREE AT EVERY RUNG — and none is indexed on what Table 250.66 is indexed on

`lib/bom-engine-v4.ts`:2127 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** The live copy bills a purchased BOM line: `${gecGauge} Bare Copper GEC`, 50 ft, necReference 'NEC 250.66' (lines 2131 and 3349), plus a printed compliance note `NEC 250.52(A)(5): 5/8"x8ft copper-clad ground rod + acorn clamp + ${gecGauge} GEC (50ft) required` (lines 2141, 3352). On a 200 A service that is 50 ft of #2 bare copper — four gauge steps and several hundred dollars above the #6 that 250.66(A) caps a rod-only GEC at. On a service larger than 350 kcmil the same line is UNDERSIZED against the table. The dead copy in computed-plan.ts would produce a different gauge for the same job, so any future rewiring to it silently changes the purchased wire.

**Smallest repair.** Add lib/nec/table250_66.ts keyed on the largest ungrounded service-entrance conductor (with the kcmil bands), expose gecSizeForServiceConductor(size) plus a separate ROD_ONLY_GEC_MAX = '#6 AWG' implementing 250.66(A). Have bom-engine-v4 pass the service conductor size (segment-schedule.ts:894-900 already derives one) instead of an OCPD, and clamp to #6 when the only electrode is the rod it just added. Delete gecSizeForOcpd from computed-plan.ts.

### 🔥 bom-engine-v4's inline EGC ternary is a 3-rung stand-in for an 11-rung table, flat #6 AWG above 100 A — and it bills the wire

`lib/bom-engine-v4.ts`:2094 — copies disagree: `False`, wrong vs standard: `True`

**Consequence.** Both sites emit a purchased BOM line — `${egcGauge} green THWN-2 equipment grounding conductor — NEC 250.122`, ft, necReference 'NEC 690.43 / 250.122' (lines 2097-2098 and 3335-3336) — on the design-studio fallback path (no sized runs). Below the flat region the effect is an over-buy: a 20 A feeder gets #10 where #12 is the minimum. Above it the effect is a code violation on a purchased and installed conductor: a 300 A AC feeder ships #6 where NEC 250.122 requires #4, and the line cites 250.122 as its authority. Same shape as the `size * 15` defect — a wrong number made credible by a correct-looking citation.

**Smallest repair.** Replace both ternaries with getEGCSize(ocpdForEgc) imported from '@/lib/manufacturer-specs' (or a new lib/nec/table250_122.ts), exactly as lib/permit/utils/conductorAuthority.ts:202 already does.

### The grounding-electrode requirement rule was fixed in one BOM emitter and left unfixed in the other — the hybrid BOM contradicts the plan set

`lib/bom-engine-v4.ts`:3322 — copies disagree: `True`, wrong vs standard: `False`

**Consequence.** On any hybrid project (more than one subsystem present with subSystemCounts set) the BOM ships a 5/8" x 8 ft copper-clad ground rod, an acorn clamp and 50 ft of bare copper GEC that the design does not call for, and prints 'NEC 250.52(A)(5): ... required' as a compliance note — while the permit package's own electrical sheet states in print that no new electrode or GEC is added. A purchased line, a crew instruction and a stamped drawing that contradict each other on grounding, from one rule that exists twice and was fixed once.

**Smallest repair.** Wrap lines 3338-3353 in the same `if (input.requiresGroundingElectrode === true)` gate, or better extract one emitGroundingElectrodeSystem(input) helper used by both emitters so the gate cannot be present in one and absent in the other. Add a test that the hybrid path emits zero ground_rod / GEC rows when requiresGroundingElectrode is unset.


---

## battery-pcs

> The family is "how much does the battery add to the NEC 705.12(B) busbar total, and what current/conductor does its branch get". A real repair landed here on 2026-09-22: `resolveBatteryBranch` in lib/equipment-db.ts:4440 is now a genuine single authority for the busbar contribution, it transcribes the Enphase IQ Battery 10C branch step function correctly against DSH-00565-9.0 (1 unit → 40 A/#8 AWG; 2+ → 80 A/#4 AWG; 3–8 → 80 A + PCS oversubscription, refuse above 8), and the five disagreeing models the repo used to carry are now shims over it. So the busbar-contribution arithmetic itself is single-sourced and correct. The defects that remain are all at the AUTHORITY'S EDGES: (a) one live caller — the standalone SLD route — never passes `batteryCount` into computeSystem, so the authority is asked for the ONE-unit step of a step function and the 705.12(B) total silently loses 40–100 A in the permissive direction (proved: Franklin aPower 15 ×3 goes 185 A/FAIL → 85 A/PASS); (b) the authority publishes `minConductorAwg`, `ratedOutputCurrentA`, `pcsRequired`, `pcsMode` and `pcsLabelRequirement` and NOTHING reads any of them, so the battery branch conductor is still sized by a second copy (per-unit `maxContinuousOutputA`) and prints #8 AWG on an 80 A OCPD where Enphase says #4 AWG; (c) the combined PV+battery figure and the PV-only figure are carried in fields whose names do not say which is which (`project.pvBackfeedA` = PV+battery; `snap.electrical.feeder.ocpdA` = PV only), and three consumers read the wrong one — the E-1 panel double-counts the battery, PV-4A prints a 120% sum that cannot reproduce its own stamped verdict, and the BOM buys and 120%-caps the backfeed breaker from PV alone. On PCS specifically: NEC 705.13 has exactly ONE implementation (an unconditional info note in lib/electrical-calc.ts:1263) and nothing anywhere applies a PCS allowance or bypasses the 120% rule, so there is no inconsistent-bypass defect to report — but the Enphase PCS requirement the catalogue computes is dead, so a 3–8-unit 10C design and a 2-unit one emit byte-identical output and the datasheet's mandatory PCS disclaimer label never reaches a sheet.

### 🔥 The standalone SLD route never passes batteryCount, so the manufacturer's step function is evaluated at ONE unit — the 705.12(B) total loses 40–100 A in the permissive direction

`app/api/engineering/sld/route.ts`:732 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** Any design taken through /api/engineering/sld or /api/engineering/sld/pdf with more than one battery gets an E-1 single-line diagram whose printed 120% panel and PASS/FAIL verdict are computed from one battery instead of the fleet. A multi-battery job on a bus with modest headroom prints '120% Rule PASS ✓' where the correct answer is FAIL — the drawing an AHJ reads clears an interconnection that overloads the busbar. The permit path (lib/permit/utils/computedRuns.ts:287-288) does pass batteryCount, so the same design gets two different verdicts depending on which artifact you generate.

**Smallest repair.** Add `batteryCount: body.batteryCount ? Number(body.batteryCount) : undefined` to the csInput literal at app/api/engineering/sld/route.ts:730-732 (the value is already parsed at line 832). Better: make resolveBatteryBranch the only producer in that route — replace `_batBackfeedA` (655) with `resolveBatteryBranch({id:_batId, brand, model}, count).busbarContributionA` so the drawing and the engine cannot diverge. Best: make computed-system refuse when batteryIds is non-empty and batteryCount is absent, instead of silently defaulting the fleet to 1 — a step function with an unknown step is UNRESOLVED, not step 1.

### 🔥 The authority publishes minConductorAwg '#4 AWG' for an 80 A battery branch and nothing reads it — the printed conductor schedule says #8 AWG on an 80 A OCPD

`lib/computed-system.ts`:2076 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** A permit-grade conductor schedule, conduit schedule and BOM wire footage for #8 AWG on an 80 A battery branch — an undersized conductor that would fail plan review against the Enphase datasheet and, if built to the drawing, is protected 30 A above its ampacity. The same defect scales: any multi-unit AC-coupled battery gets a conductor sized for one unit and an OCPD sized for the fleet.

**Smallest repair.** Make the BATTERY_TO_BUI_RUN block in lib/computed-system.ts:2075-2140 consume the authority it already calls at 1481: take branchOcpdA for the OCPD, minConductorAwg as a FLOOR on autoSizeWire's result, and refuse rather than size when the resolution is unresolved. Retire the `batteryContinuousOutputA` input field (five producers, none authoritative) in favour of resolveBatteryBranch's ratedOutputCurrentA × units-on-branch. Add a guard asserting segment.wireGauge is never smaller than the resolution's minConductorAwg.

### 🔥 The BOM sizes and 120%-caps the purchased backfeed breaker from PV alone, in two duplicated blocks — and the cap can emit a breaker rating that is not an NEC 240.6(A) size

`lib/bom-engine-v4.ts`:1849 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** On every battery job the permit BOM/SCHED ships a backfeed breaker sized for PV only and asserts a 120% allowance that the battery has already consumed — the purchased hardware and the printed compliance note disagree with the stamped busbar verdict on the same package. On an oversized-PV job the BOM silently orders a non-existent part (QO65 / QO115) and calls it NEC 705.12(B) compliant instead of failing.

**Smallest repair.** Pass the battery's busbarContributionA into BOMInputV4 and subtract it in maxPVBreaker in BOTH blocks — or, better, collapse 1847-1874 and 3177-3198 into one helper and have it consume the snapshot's electrical.poi.backfeedA / rulePasses rather than recomputing the rule. Replace `Math.min(requestedBreaker, maxPVBreaker)` with `nextStandardBreaker`-constrained selection plus a hard failure when no standard size fits, so the BOM never emits a non-ladder rating as a part number.

### The battery is counted TWICE on the single-lane E-1 panel, because the same renderer holds two opposite conventions for input.backfeedAmps

`lib/sld-professional-renderer.ts`:3726 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** Every single-system E-1 sheet with a battery prints a 'PV Breaker' rating that is really PV+battery, and a 'Total Backfeed' that is PV+2×battery. On the permit path the PASS/FAIL cell is rescued by poiRulePasses, so the sheet shows a verdict its own printed arithmetic contradicts; on the standalone SLD route the verdict itself comes from the doubled figure and can print FAIL on a design that passes. Either way the numbers an AHJ checks off the sheet do not reconcile.

**Smallest repair.** Adopt the multi-lane convention everywhere: at 3726 use `pvBreakerAmps` as the total and label the battery row '(incl.)', OR give the renderer a genuinely PV-only field. The real fix is naming — `project.backfeedBreakerA` / `pvBackfeedA` / `solarBreakerRequired` all carry PV+battery in three places (generatePermit.ts:1195-1196, computeSystemProjection.ts:72, electrical-calc.ts:1137) while `snap.electrical.feeder.ocpdA` carries PV only. Split them into `pvBackfeedOcpdA` and `poiTotalBackfeedA` and let the type system stop this class.

### 🔥 An unresolved battery BLOCKS the 705.12(B) conclusion in electrical-calc but only console.warns in computed-system — and computed-system is the permit's engine

`lib/computed-system.ts`:1502 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** A design whose battery cannot be resolved (unknown id, free-text brand/model with no exact catalogue match, or a catalogue row with neither branchArchitecture nor a usable backfeedBreakerA) gets a stamped '120% RULE PASS' on PV-4A computed from a sum that is missing the battery term. The engineering page, running electrical-calc on the same design, correctly refuses with an actionable error. The permit — the artifact that goes to the AHJ — is the permissive one, which is the exact failure mode documented at computed-system.ts:1392-1404 for the PV term.

**Smallest repair.** Make computed-system carry the refusal in its result: add `batteryUnresolved`/`batteryRefusal` to ComputedSystem, force `interconnectionPass = false` (or a third 'unresolved' state) at 1514 when `_batteryUnresolved`, and map it to a BATTERY-BACKFEED-UNRESOLVED blocking release gate alongside the existing BATTERY-CAPACITY-UNRESOLVED entry at lib/permit/snapshot/build.ts:2109. The tri-state `rulePasses: boolean | null` already exists on the snapshot and PV-4A already renders null as PENDING — route the refusal into that null.


---

## structural-constants

> The structural-constant family (ASCE 7 wind Kz/Kzt/Kd/Ke, rooftop GCrn, snow Cs/Ce/Ct/Is, and wind/snow/seismic lookups by location) is duplicated far more than the wind "canonical" claim suggests: there are 8 live-or-dead copies of the velocity-pressure exposure coefficient, 5 of the rooftop pressure coefficient, 3 of the snow slope factor, 3 independent fence-wind implementations, and 4 competing location-based wind/snow sources plus 3 for seismic design category. lib/structural/asce7Wind.ts is NOT the deciding copy for wind: structural-engine-v4.ts (the engine of record) keeps a private getKz/calcVelocityPressure at lines 431-459 and uses it for the qz that drives net uplift and the attachment schedule, calling the canonical asce7Wind only for the derivation TEXT it prints (line 1482, `_qzRec`) — the exact wrong-copy-decides pattern from the NEC 310.16 defect, re-created. The two Kz copies agree numerically for every finite height and are BOTH WRONG the same way: the table stops at 40 ft and returns the 40-ft coefficient for everything above, while the product's own mean-roof-height control accepts 8-60 ft — at 60 ft Exposure C the standard gives Kz 1.13 and the code gives 1.04, understating qz, net uplift and the uplift per attachment by 8% in the unsafe direction, with no test anywhere asserting a Kz above 40 ft. A separate live engine (lib/structural-calc.ts, whose own header says it has "NO LIVE CALLERS" — false, /api/engineering/rules reaches it) carries a height-blind KZ_TABLE plus an invented exposure multiplier on GCp and prints its own PASS/FAIL attachment-spacing verdict on the same permit that V4 stamped, 33% apart. Verified CORRECT and not defects: Kd = 0.85 (8 copies, all agree, all match Table 26.6-1 for buildings and for solid freestanding walls), Ke = 1.0 (one copy), GCrn -1.5/-2.0/-2.5 with the 7-degree applicability check (one live copy, correct), and asce7Snow.ts's Cs curves and the 0.7 in pf (correct against Fig. 7.4-1 and §7.3).

### ✅ **FIXED** (`f800c971`) — 🔥 The Kz table goes FLAT at 40 ft in BOTH the canonical copy and the live private copy, while the product accepts mean roof heights to 60 ft

`lib/structural-engine-v4.ts`:438 — copies disagree: `False`, wrong vs standard: `True`

**Consequence.** On any building whose mean roof height is entered above 40 ft — a 4-to-6-storey commercial ballasted roof, or a 3-storey with a steep gable whose ASCE §26.3 eave+ridge average lands at 45-55 ft — qz is understated, and because netUplift = qz × |GCrn| and upliftPerMount = netUplift × tributary area, the entire chain understates by the same 4–11%. That reaches the sealed PV-4C attachment schedule (mount count and spacing), the racking BOM's mount and lag-bolt quantities, and the MOUNT_INSUFFICIENT_CAPACITY gate at structural-engine-v4.ts:1553 — a design that should trip the SF check passes it. The printed derivation on the sheet states 'Kz 1.04 … ASCE 7-22 Table 26.10-1, Exposure C at 60 ft mean roof height', which is a specific, checkable, wrong claim at the top of a stamped page.

**Smallest repair.** Extend both ladders to Table 26.10-1's full range (B/C/D at 40, 50, 60, 70, 80, 90, 100, 120, 140, 160 ft) — or better, implement Kz = 2.01(z/zg)^(2/α) with z_min = 15 ft and the α/zg pairs, since that reproduces the table exactly and cannot go flat. Then delete lib/structural-engine-v4.ts:431-459 and have analyzeRoofSystem take qz from the `_qzRec` it already computes at line 1482, so one function both decides and prints. Add a test that asserts Kz at 60 ft for each exposure against the published values (0.85 / 1.13 / 1.31) using literals, not a call to the function under test.

### ✅ **FIXED** (`7b4066db (recorded as R11, value unchanged)`) — 🔥 Exposure B Kz is 0.57 in the live/canonical copies and 0.70 in a second live copy; neither selects the Table 26.10-1 case, and the C&C case is the higher value

`lib/structural/asce7Wind.ts`:56 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** Exposure B is the default for suburban and wooded residential sites — the bulk of the pipeline. If Case 1 governs, every Exposure B roof design the engine of record produces understates qz, net uplift and uplift per attachment by 18.6%, which propagates to the PV-4C attachment schedule and the racking BOM. Independently of which case is right, the same permit prints two different Exposure B velocity pressures: /api/engineering/calculate (V4, Kz 0.57 → qz 14.46 psf at 108 mph, 15 ft) versus the /api/engineering/rules attachment-spacing row (V1, Kz 0.70 → qz 17.76 psf), a 23% split on a coefficient a plan reviewer reads off the sheet.

**Smallest repair.** Make the case an explicit, named parameter of velocityPressureCoefficient (e.g. `case: 'components-and-cladding' | 'mwfrs'`) defaulting to the C&C case for rooftop-solar and fence work, with the Table 26.10-1 note quoted in the basis string so the sheet discloses it; have a PE confirm the selection for Ch. 29 rooftop-solar before changing the number. Then delete lib/structural-calc.ts:226-230 and lib/structural-engine-v2.ts:228-232 and route both through the one function.


---

## module-inverter-limits

> The family is "module and inverter electrical limits": the NEC 690.7(A) cold-temperature Voc correction, the NEC 690.8(A)(1) 1.25 continuous-current factor and the combined 1.5625/1.56 OCPD factor, string-length ceilings, and the inverter max-DC-input-voltage / max-input-current checks. The 690.7 Voc correction alone exists in 15 places (11 live, 4 dead), the 690.8 OCPD factor in 9 places, and the string-length ceiling in 8. They do NOT agree. One live copy — lib/rules-engine.ts:112 — has the temperature delta SIGN INVERTED (`25 - designTempMin` instead of `designTempMin - 25`), so it computes a cold-weather voltage REDUCTION where the code requires an increase; on a 13-panel 600 V string it prints "NEC 690.7 PASS, 558 V" while lib/electrical-calc.ts:603 computes 731.5 V on the same string and raises an error. Separately, the permit engine's printed-and-purchased DC fuse is derived as Isc x 1.56 with no cap against the module's own maxSeriesFuseRating, so 15 catalog modules ship a fuse above their listed maximum, while lib/ocpd-resolver.ts — the engine's declared authority — explicitly caps it. Two more non-conservative fabrications drive real selections: a blanket x1.12 cold multiplier (the NEC Table 690.7(A) -1..-5 C row) in the panel-compatibility gate, reached with no design temperature at all, and ten remaining `designTempMin: -10` literals in the engineering page after two sibling sites in the same file were already repaired to the canonical ASHRAE basis. Verdict: five real defects, four of them in the unsafe direction, and in three of them the wrong copy is the deciding one. Two suspected sub-defects (1.56 vs 1.5625 rounding, and STC vs hot-corrected Isc as the OCPD basis) were checked numerically against every panel in the catalog and flip nothing today — I am reporting those as clean.

### 🔥 Permit-sheet and BOM DC fuse is derived as Isc x 1.56 with no cap against the module's own maxSeriesFuseRating — 15 catalog modules get a fuse above their listed maximum

`lib/permit/utils/conductorAuthority.ts`:216 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** A stamped permit package prints, and the BOM purchases, a 25 A DC string fuse for a module whose datasheet — reproduced two sheets earlier by lib/permit/sections/compliancePages.ts:1175, `Max Series Fuse Rating ... 20 A` — forbids anything above 20 A. The package therefore contradicts itself in print, which is a plan-review rejection on its own; and if it is built as drawn the module's internal bypass diodes and ribbon are protected at 125% of their rated fuse, so a reverse-current fault the 20 A fuse was listed to clear can run to 25 A instead. lib/permit/utils/bomForPermit.ts:816-820 makes this a purchased line item, not a display artifact: `dcOCPD` is the max ocpdAmps across the authority's strings, so the installer receives the oversized fuse.

**Smallest repair.** Carry maxSeriesFuseRating onto the conductor authority's DC string rows and apply the ocpd-resolver cap in one place: in lib/permit/utils/conductorAuthority.ts dcStringRow(), set `ocpdAmps = Math.min(necNextStandardOcpd(isc * 1.5625), str.maxSeriesFuseRating ?? Infinity)` and emit the wasCapped flag so the SCHED sheet can print the cap note the resolver already writes. Best is to stop re-deriving it at all — have dcStringRow project the engine's `str.ocpdResolution.ocpdRating` (already computed with the cap by lib/ocpd-resolver.ts via generatePermit.ts:823) and keep the Isc x 1.5625 product only as the printed derivation. Also drop the `?? 20` fuse defaults at lib/permit/generatePermit.ts:823/846/912 and app/api/engineering/sld/route.ts:322, which fabricate a 20 A limit for any module whose record does not resolve.

### 🔥 The panel-compatibility gate decides module swaps on a blanket x1.12 cold-Voc multiplier — the NEC Table 690.7(A) -1..-5 C row — because sizingEngine calls it with no design temperature, which also makes the equipment-DB temperature coefficient dead on that path

`lib/system/panelCompatibilityGate.ts`:142 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** On every site in the 40 states colder than -10 C, and on every site whose state does not resolve, the module/microinverter compatibility gate under-corrects Voc and lets a pairing through that exceeds the microinverter's rated maximum DC input voltage. Because the verdict lands on 'marginal' rather than 'incompatible', lib/system/sizingEngine.ts:2389 emits a soft PANEL_MARGINAL warning instead of taking the auto-swap branch at line 2233 that exists precisely to keep this out of the design — so the non-compliant module stays selected and flows into the saved layout, the BOM and the permit package. The permit engine then recomputes the same module on the real ASHRAE basis (lib/permit/utils/panelSpecs.ts via designTemps.ts) and gets a Voc above the inverter maximum, producing the red EQUIPMENT COMPATIBILITY banner at lib/permit/sections/compliancePages.ts:1231 on a design the designer was told was fine. Secondary effect: because designTempMinC is never supplied, the `tempCoeffVoc` field on all ~60 catalog modules is unreachable in this code path — the gate cannot tell a -0.236 %/C Maxeon from a -0.30 %/C Nexus.

**Smallest repair.** At lib/system/sizingEngine.ts:2231 pass the temperature the engine already holds: `evaluatePanelBrandCompatibility(panel, brand, { designTempMinC: input.designTempMin })`, and thread it through runPanelCompatibilityGate's signature. Then change DEFAULT_VOC_COLD_MULTIPLIER at lib/system/panelCompatibilityGate.ts:142 from 1.12 to 1.25 so the no-temperature fallback matches lib/permit/utils/panelSpecs.ts:141 and Table 690.7(A)'s conservative row — or, better, replace vocColdFactor() with an import of coldVocFactor() from lib/permit/utils/panelSpecs.ts (or move that function to a lib/nec/ module beside ampacity.ts and chapter9.ts) so there is one cold-Voc law with one fallback.

### 🔥 Ten `designTempMin: -10` literals remain in the engineering page feeding the string-layout sizer and the NEC rules engine, after two sibling sites in the same file were already repaired to the canonical ASHRAE basis — the deciding copies are the ones still wrong

`app/engineering/page.tsx`:6415 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** Two different design temperatures for one design, and the number the user is shown is not the number the layout was built on. The string layout the engineering page writes into the project (panels per string, string count, inverter unit count via lib/system/sizingEngine.ts:656 and :1588) is computed at -10 C; the permit set and /api/engineering/calculate recompute the same layout at the ASHRAE extreme low and reject it. Near the boundary that is a saved, quoted, ordered design whose strings are one panel too long for the inverter — an NEC 690.7(A) violation and an inverter-overvoltage risk. Line 6415 is worse than a stale default: it discards a correct value that is already in the payload, so the NEC rules verdict is evaluated 13 C warmer than the compliance calculation shown beside it on the same screen.

**Smallest repair.** Hoist one value in app/engineering/page.tsx — the same expression already used at line 3055, `compliance.autoDetected?.designTempMin ?? getThermalDesignBasis({ state: config.state || null }).minDesignTempC` — into a memo, and substitute it at all ten sites; delete the override on line 6415 so `payload.electrical.designTempMin` survives. Then make the engines refuse to invent one: lib/system/sizingEngine.ts:873 and :1531, lib/system/feasibilityEvaluator.ts:238 and lib/string-generator.ts:238 should treat designTempMin as required (or fall back to the conservative national default of -25 from designTemps.ts, never -10) so a missing temperature can never silently produce a warmer, longer string.

### 🔥 The engineering report's string-length ceiling uses a blanket Voc x 1.25 with a hard 20-panel clamp, ignoring the module coefficient and the site temperature entirely, and prints an uncorrected string Voc beside it

`lib/engineering/reportGenerator.ts`:214 — copies disagree: `True`, wrong vs standard: `True`

**Consequence.** lib/engineering/reportGenerator.ts is reached by four routes — app/api/engineering/generate/route.ts:146, app/api/engineering/report/route.ts:72, app/api/engineering/preliminary/route.ts:783, and lib/engineering/syncPipeline.ts:437/495 — and it SETS panelsPerString, stringCount, dcWireGauge, stringFuseAmps and dcDisconnectAmps on the stored engineering report. Two user-visible consequences. First, the limit is over-restrictive for warm sites: a Florida job (designTemps.ts FL -2 C, real factor ~1.07) is capped as if it were at -38 C, so the report recommends shorter strings and therefore more strings, more MPPT channels and sometimes another inverter than the design actually needs — a price the customer pays. Second, the 'DC Voltage' the report prints is the STC value, not the NEC 690.7(A) maximum system voltage, so a report can show 496 V against a 600 V inverter for a string whose real design maximum is 563 V; a reader checking the headroom is reading the wrong number.

**Smallest repair.** Give generateElectricalEngineering the thermal basis (the DesignSnapshot already carries stateCode — it is used for getNecVersion at line 272 — so `getThermalDesignBasis({ state: snap.stateCode })` is available) and replace `panelVoc * 1.25` with the shared cold-Voc law, falling back to x1.25 only when the module record has no tempCoeffVoc, exactly as lib/permit/utils/panelSpecs.ts:135 already does. Report `stringVoc` as the corrected value (or return both, labelled). The 20-panel clamp should come from the inverter/brand record's maxPanelsPerString, not a literal.


---

## Killed by verification — do NOT re-propose

- **Every ohms/kFT resistance table cites 'NEC Ch.9 Table 8 (Cu, stranded)' and four of its thirteen rows are not that column — and at #8 AWG all four copies agree and are all wrong** (`lib/sld-professional-renderer.ts`)
- **The voltage-drop limit is declared in ten places; exactly one knows the branch/feeder split, so the same feeder is graded at 2% by its segment row and 3% by the sheet that prints it** (`lib/permit/utils/computedRuns.ts`)
- **engineering-automation computes and persists a voltage drop against a hardcoded 240 V and cannot size above #1 AWG** (`lib/engineering-automation.ts`)
- **engineering-automation's conduit-area table is not NEC Table 4 for any raceway material — and it is the 100% denominator that selects the trade size and prints the fill** (`C:/Users/Ray/Solarpro Claude/repo/lib/engineering-automation.ts`)
- **The same function keys the NEC Table 1 fill limit on the raceway MATERIAL, giving PVC Sch 40 a 53% allowance where the code allows 40%** (`C:/Users/Ray/Solarpro Claude/repo/lib/engineering-automation.ts`)
- **segment-builder's Table 5 copy is 15-20% low for every size #1 AWG and up, and it feeds the canonical Table 1/Table 4 selector — dead today, one wiring change from selecting conduit** (`C:/Users/Ray/Solarpro Claude/repo/lib/segment-builder.ts`)
- **Two survey-side copies of the 120% rule both define 'passes' as 'there is any headroom at all' and never compare the design's actual backfeed — they agree, and both are wrong** (`lib/siteSurvey/enrichSurvey.ts`)
- **The adder's only code-edition gate reads a field nobody sets, so the PRINTED basis says 'no adder applied' while the SIZING adds 33 °C on every project** (`lib/computed-system.ts`)
- **Three live copies of Table 250.122 clamp at #2 AWG above 400 A, where the table keeps stepping to #1, #1/0 and #2/0** (`lib/segment-schedule.ts`)
- **segment-builder gives a 20 A OCPD a #14 AWG EGC — the #12 rung is simply missing** (`lib/segment-builder.ts`)
- **`?? '#10 AWG'` and `?? '#12'` fabricate an EGC size the surrounding logic could compute — and V45 skips exactly that case** (`lib/bom-engine-v4.ts`)
- **PV-4A prints a 120% sum that omits the battery while stamping a verdict that includes it — the sheet's own arithmetic contradicts its conclusion** (`lib/permit/sections/electricalPages.ts`)
- **structural-engine-v4 keeps a private Kz/qz duplicate: the private copy decides the uplift, the canonical copy only prints the derivation** (`lib/structural-engine-v4.ts`)
- **lib/structural-calc.ts is LIVE (its own header says it is not) and applies an invented exposure multiplier to GCp, printing a second attachment verdict 33% away from V4's** (`lib/structural-calc.ts`)
- **Three fence-wind implementations and two acceptance thresholds: VAL-1 and PV-4C can print opposite verdicts for the same fence, and Kz ignores the exposure category** (`lib/permit/sections/validationPage.ts`)
- **The IronRidge attachment check uses Cp = 1.0 where the repo's own GCrn is −2.5, calling it 'conservative per ASCE 7'** (`app/api/engineering/ironridge/route.ts`)
- **NEC 690.7 cold-Voc correction has its temperature delta SIGN INVERTED in the rules engine — it turns a cold-weather voltage RISE into a FALL, so the 690.7 check can never fail** (`lib/rules-engine.ts`)
- **The rules engine sizes the NEC 690.8(B) OCPD as Isc x 1.25, omitting the second 125% every other copy applies, and its own cap makes the error branch unreachable in AUTO mode** (`lib/rules-engine.ts`)