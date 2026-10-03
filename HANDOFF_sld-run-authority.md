# HANDOFF — SLD run authority: canonical electrical runs, terminal-to-terminal drawing (2026-10-03)

## Standing Rules
- Push target: `dev` (Ray's instruction for this work). Never `master`. `feat:` commits authored AND committed as JAMES.
- Three checks before a push: `tsc --noEmit` 0 errors, eslint 0 errors on changed files, affected vitest green.
- Ray (binding): "DO NOT SIZE CONDUCTORS IN THE RENDERER… Do not use `wireGaugeForOcpd()`." The chain is
  FACTS → CANONICAL ELECTRICAL RUN → CONDUCTOR + RACEWAY SIZING ENGINE → ENGINEERED RUN RESULT → SLD, and the
  same result feeds the conductor schedule, BOM, permit and readiness. A missing input is NOT EVALUATED and
  named — never a fabricated size.
- "Device artwork owns terminal coordinates. The engineered run owns source + destination terminal. The
  renderer connects them." Panelboards / switchboards / service sections may keep the rectangle.

## What Was Done
1. **`lib/electrical/electricalRuns.ts` — the canonical run.**
   - `deriveServiceRuns(topology)`: one run per real conductor the service graph owns, terminal to terminal —
     DER circuits (storage / generation units into their generation panel, controller panelboard or backed-up
     panel), generation feeders (panel main lugs → `feedsNodeId`), backup feeders (controller LOAD_OUT → each
     backed-up panel's main), service branch feeders split at every in-line device (FEEDER → LINE, LOAD → GRID_IN).
   - `engineerRun(spec, env)`: NEC 310.16 with 110.14(C) (lower termination; unlisted ≤ 100 A ⇒ 60 °C column),
     310.15(B)(1) ambient, 310.15(C)(1) CCC, 705.28(B) 125 %, 705.12(B)(1)(a)/(b) for a feeder with DER at its
     supply end, 240.4(B) next size up, 240.4(D), 250.122(A)/(B), Ch. 9 Tables 1/4/5 fill, Table 8 voltage drop
     (with upsizing). Every input carries provenance; a missing one lands in `missingInputs` (`key`, `need`, `run`).
   - `runEnvironmentFrom(facts)`: the ONE environment builder (site state → `siteDesignHighC`, null not the
     national default; the project's recorded raceway type, no default; copper THWN-2 as SolarPro's design basis
     for new AC conductors; 2 % AC VD target; optional recorded run lengths and catalogue terminal facts).
   - `runCallout`, `runScheduleCells`, `runTags` (E-/G-/B-/F-n), `runReadiness` — the one wording.
2. **Consumers (none sizes anything):**
   - SLD renderer: schedule band rows from the runs; borrowed-gauge storage rows, "SIZE FOR N A" rows and the
     stored breaker-gauge row are gone; DC-coupled graph calc block names the runs; no runs passed ⇒ engineered
     from `NO_FACTS_RUN_ENVIRONMENT` (all NOT EVALUATED); overflow rows are stated, not cut.
   - SLD + SLD PDF routes engineer the runs; the page posts the site state to SLD / PDF / BOM.
   - BOM: `bomLinesFromRuns` — requirement lines (same words), quantity PENDING without lengths, unpriced.
   - Permit PV-4B: `serviceRunRowsHtml` — same runs, same tags and words.
   - Engineering Readiness: "N of M runs engineered" + each missing fact once with its run count.
3. **Terminal-to-terminal drawing (compact DC-coupled layout):**
   - `DeviceIllustration.terminals` (fractions of the drawn body) + `illustrationTerminal` / `illustrationBody`.
     Powerwall 3: `BATTERY_AC` bottom, `PV_DC_IN` top. Gateway 3: `GRID_IN@L/@R` flanks, `DER_IN` top, `LOAD_OUT` bottom.
   - Powerwalls and Gateways with that art are drawn FRAMELESS (`drawDevice`): art + words beside it.
   - Each storage circuit runs from its own unit's AC terminal to its OWN breaker position on the generation
     panel (no shared collector). Generation feeder → gateway `DER_IN`; backup feeder `LOAD_OUT` → MSP main;
     branch feeder → gateway `GRID_IN` on the flank facing the service, through the isolation switch's anchors;
     DC trunk → `PV_DC_IN` of exactly the landed units. A dot marks every landing.
   - Each conductor carries its run's callout; engineered feeder callouts are headed by the run's name
     (GENERATION / BACKUP / SERVICE BRANCH FEEDER).

Ray's job (IL, EMT): PW3 circuits `2 #4 CU THWN-2 + #10 EGC`, raceway waiting on the PW3 neutral fact;
generation feeders `2 #1 CU THWN-2 + #6 EGC`; backup and branch feeders `2 #3/0 CU THWN-2 + #3/0 N + #6 EGC`
in `2" EMT` (25.5 % fill).

## Current State
- Branch `dev`. Foundation pushed at 35fa6c1; drawing commit follows it.
- tsc 0; eslint 0 errors on changed files; 4139 affected tests green; postgres route tests green.
- Pre-existing failures (fail on the previous `dev` HEAD too, not touched here):
  `tests/ctPlacementReachesEveryArtefact.test.ts` ×2, `tests/planset/aac-ws1-resolver-lifecycle.test.ts` ×1.
- Mutation proofs: 10 engine guards, 7 drawing guards — each restored defect turns its test red.

## Files Modified
| File | Role |
|---|---|
| `lib/electrical/electricalRuns.ts` | canonical run: derivation, sizing engine, environment, wording, readiness |
| `lib/permit/utils/designTemps.ts` | `siteDesignHighC` — strict design high (null when the state is unknown) |
| `lib/sld-professional-renderer.ts` | schedule band / calc block from runs; frameless devices; terminal routing; callouts |
| `lib/sld-device-illustrations.ts` | art-owned terminal tables + placement helpers |
| `app/api/engineering/sld/route.ts`, `sld/pdf/route.ts`, `bom/route.ts` | engineer the runs, pass / list them |
| `lib/bom/topologyBom.ts` | `bomLinesFromRuns` |
| `lib/permit/sections/electricalPages.ts` | PV-4B canonical run rows |
| `components/engineering/systemConfig/EngineeringReadinessPanel.tsx`, `app/engineering/page.tsx` | readiness; payload state |
| `tests/electricalRuns*.test.ts`, `tests/sldTerminalToTerminal.test.ts`, `tests/conductorRunsReadiness.component.test.tsx` | new tests |

## Pending Work (priority order)
1. **Manufacturer terminal facts.** The catalogue does not record the Powerwall 3's AC neutral or terminal
   temperature listing. Search snippets of Tesla's manual indicate a neutral terminal (10–4 AWG) and 90 °C AC
   conductors, but the primary pages are blocked from this environment, so nothing was encoded. Recording them
   (`terminalFacts` via the catalogue) engineers the PW3 raceways — and #6 instead of #4 only if BOTH ends are
   listed 75 °C (the generation panel's breaker too).
2. **Run lengths have no writer.** Voltage drop is NOT EVALUATED and BOM footage PENDING on every graph run
   until a length can be recorded per run (`runLengthsFt` in the environment is ready for it).
3. The **column layout** (AC-coupled / other graph sheets) still draws boxes and prints no run callouts on the
   drawing (its schedule rows are canonical). Ray's coming screenshot refines the geometry.
4. `sizeAggregationPanel` still recommends a feeder gauge from `wireGaugeForOcpd`, written to
   `outputConductorGauge` by the presets and quoted in ServiceNodeInspector; nothing prints it any more.
5. Non-graph renderer paths (micro multi-lane, the shared system tail, the legacy BUI battery) still fall back to
   `wireGaugeForOcpd`; computeSystem still builds the defaulted BATTERY_TO_BUI / BUI_TO_MSP pair (excluded from
   the graph-job schedule).
6. Not derived yet: service-entrance conductors; the common-aggregation isolation device → POI legs.
7. Aluminum conductors: the engine holds copper tables only (aluminum ⇒ NOT EVALUATED).

## Architecture Notes
- The renderer imports the engine only to engineer from NO facts when handed none; it never sizes with facts.
- `runTags` order = run order; the SLD schedule, PV-4B and readiness share it.
- A frameless device's `terminal(id, facing)` comes from the art's table; a boxed device falls back to its edge.

## Next Steps
1. Ray confirms copper THWN-2 as the new-conductor basis and the 110.14(C) 60 °C outcome (#4 PW3 circuits).
2. Record the PW3 neutral / terminal listing from the installation manual (catalogue `terminalFacts`).
3. A run-length writer (System Config) → voltage drop + BOM footage.
4. Apply terminal-to-terminal + callouts to the column layout after Ray's screenshot.
