# HANDOFF — System Config Gauntlet (2026-10-03)

Branch: `claude/quirky-pasteur-iqi5aq` (fast-forwarded from `master` onto `origin/dev` @ `4375ba3`,
then this session's commits). Base for every claim below is `dev` @ `4375ba3`.

> **Deployed commit: NOT ESTABLISHED from this session.** The container's network policy refuses
> `solarpro.solutions`, `www.solarpro.solutions` and `solarpro-dev.vercel.app` (CONNECT 403), so
> `/api/version` could not be read. Every "live" statement Ray made was taken as describing a build
> at or after `4375ba3` ("Inverter: None" honoured — which is exactly what that commit does). The first
> thing the next session should do is read `/api/version` (or the Vercel dashboard) for the deployment
> Ray is looking at, before trusting any "LIVE" claim in either direction.

## Standing Rules (the ones this work touched)
- Never push to `master`. This branch is pushed for review only; nothing was deployed.
- R2 three-check suite before every commit/push: `tsc` 0 errors · `eslint` 0 errors on changed files ·
  `vitest` — full deterministic run compared test-by-test against a clean `dev` baseline.
- R5: no geometry artifact touched. R3 terminology kept ("website", "app").
- AGENTS.md R6/R7 vs. this session's harness: the harness designated `claude/quirky-pasteur-iqi5aq`
  as the push target; R7 names `james-dev`. Recent `dev` history (including `feat:` commits) is
  authored `rayobrian6`, and `.harness/secrets/james-git.env` does not exist in this environment, so
  commits are authored `rayobrian6` with a `Co-Authored-By` trailer — **JAMES attribution on the
  `feat:` commits (R6) could not be applied** and is flagged here rather than faked.
- Status vocabulary (Ray's): ACTIVE · IMPLEMENTED · PRODUCTION-PATH PROVEN · ADVERSARIAL PROVEN · DEV ·
  LIVE ACCEPTED. **Nothing here is LIVE ACCEPTED — Ray owns that.**

## Status ledger — the 15-step execution order

| # | Step | Status | Proof |
|---|---|---|---|
| 1 | Live array-loss: 37 × 440 W / 16.28 kW from Design, inverter stays NONE | **ADVERSARIAL PROVEN** · browser-verified (Ray's-job e2e: summary, requested sheet, module record after autosave + reload) | `tests/designArrayReachesTheSheet.postgres.test.ts` (8, both SLD routes, Ray's resolved row + the stale page body); restoring `\|\| 20`/`\|\| 400` with the projection off → 6/8 red |
| 2 | PW3 string/MPPT path | **ADVERSARIAL PROVEN** (derivation; page = sheet = 9/9/9/8/2 in the browser) · landing **IMPLEMENTED** | `tests/pageEngineAgreesOnDcCoupledStrings.test.ts` (control: old 600 V input sizes past 550 V); 9/9/9/8/2 = 37 within 529.9 V; per-unit landing question + sheet semantics (step 10) |
| 3 | Design → System Config contract | **ADVERSARIAL PROVEN** | `lib/electrical/pvArrayDesign.ts` + `tests/pvArrayDesign.test.ts` (17, incl. source guards on the page) |
| 4 | System Config information architecture | **PRODUCTION-PATH PROVEN** · browser-verified | five-card interview; `tests/systemConfigAnswersReachTheSheet.postgres.test.ts`; `e2e/system-config-interview.spec.ts` 4/4 on `next build` + local PostgreSQL |
| 5 | Service questionnaire (200 A → 400 A → custom) | **ADVERSARIAL PROVEN** | `tests/systemConfigInterview.test.ts` mutations M1/M5; round trip through PUT/GET/SLD |
| 6 | Capability-driven equipment questions | **ADVERSARIAL PROVEN** | mutations M2/M3 (micros never asked about DC coupling; no DC option without `pvInput`) |
| 7 | Connection / backup / interconnection questions writing the graph | **PRODUCTION-PATH PROVEN** | answer → real PUT → reload → canonical model LOAD_SIDE → SLD "LOAD SIDE TAP"; M4 (batteries never split evenly) |
| 8 | Auto / Guided / Manual | **ADVERSARIAL PROVEN** (component) | one engineering state (the interview takes no mode); Manual opens every card, Guided opens only the card with the NEXT question and marks it, Auto opens what still needs something — `tests/systemConfigModes.component.test.tsx`, mutation red; factory fleet cannot persist before hydration (`tests/factoryDefaultCannotPersistBeforeHydration.test.ts`) |
| 9 | Engineering Summary / Intelligence consume engineered facts | **PRODUCTION-PATH PROVEN** (facts) | `summaryFacts` — PV inverter NONE, ESS output separate (46.08 kW / 192 A on Ray's job); assistant context from the same facts |
| 10 | SLD cleanup | **ADVERSARIAL PROVEN** | title block + subtitle precise; storage named from the graph; DC landing drawn only where decided; compact top-down DC-coupled layout (`41ed4b9`: PV on top, one column per system, service equipment between; 24 layout tests, 11 mutants red) with every non-DC sheet pinned byte-for-byte (`55e1a7a`, 17 goldens). Ray's sheet re-rendered through the route after the merge: 37 × 440 W, 9/9/9/8/2 at 529.9 V |
| 11 | BOM / permit / planset / pricing consistency | BOM **ADVERSARIAL PROVEN** · permit **NOT CHANGED — needs Ray** · pricing unchanged (already Design) | `e0bbac2`: BOM orders/prices 37 × 440 W, no PV inverter line on DC-coupled (13 tests, 11 mutants red). Permit compares and logs only — see Pending #0 |
| 12 | Remove Service Topology from normal navigation | **NOT DONE — by rule** | System Config is not at parity yet (see Pending) and Ray has not live-accepted. The tab stays. |
| 13 | Simple 200 A regression | **ADVERSARIAL PROVEN** | the 200 A house asks only interconnection + utility disconnect; no systems/backup/distribution questions |
| 14 | Brand-family regression | **ADVERSARIAL PROVEN** | `tests/brandFamiliesSurviveTheArrayProjection.postgres.test.ts` (30): micro, string, AC-coupled ×2, PW3 beside a string inverter, DC-coupled, plain 200 A, control |
| 15 | Three-phase structural regression | **ADVERSARIAL PROVEN** | `tests/threePhaseIsNotCoercedToResidential.test.ts` (26) + wizard (8); 9 mutations red |

## What Was Done
(see commit messages for the full reasoning; each names its proof)
- `140bccf` the array on the sheet is the array Design placed — `pvArrayDesign.ts`, canonical
  projection of module count + identity onto both SLD routes, 422 PV_ARRAY_INPUT_REQUIRED instead of
  `|| 20` / `|| 400`; the page's `totalPanels`/`totalKw` are the Design array; the page's engine gets the
  coupling and the storage's DC window.
- `133b43c` the page's engine and the sheet derive the same strings.
- `1c2fb44` System Config becomes the installer's interview (`systemConfigInterview.ts`,
  `systemConfigAnswers.ts`, `SystemConfigInterview.tsx`); the defaulted "Max PV (120% rule)" strip and
  its block removed; panel manufacturer on the graph.
- `bb9d79c` Engineering Summary / Intelligence state the engineered project.
- `bf2d356` DC-coupled sheet: PV and storage separate; storage named from the graph; landing drawn
  only where decided.
- `9fa3009` three-phase / commercial representable, never coerced (agent).
- `c2ab94c` brand families through both SLD routes; AC-coupled inverter name and stale micro count
  fixed (agent).
- `85535c6` one electrical-system vocabulary; exported micro count is the engine's.
- `3c5983a` available fault current asked; `7f426de` existing service equipment stated and verified.
- `522f069` (found in the browser) strings are not stated until something is chosen for them to land
  on; "No storage" → "None selected"; `e2e/system-config-interview.spec.ts`.
- `e0bbac2` (agent, reviewed) the BOM orders and prices the array Design placed; DC-coupled jobs get no
  PV-inverter line; the permit compares and logs only (digest-frozen).
- `5109e3e` (found in the browser) one partitioner for strings on a battery's PV inputs — the page
  calls the SLD route's own derivation (9 / 9 / 9 / 8 / 2), not computeSystem's 7 / 7 / 7 / 7 / 9; the
  server's sizing no longer silently sizes the compatibility gate's substitute module.
- `801e28f` the Ray's-job browser test (summary, requested sheet, module record after autosave + reload).
- `55e1a7a` / `41ed4b9` (agent, reviewed) compact top-down layout for the DC-coupled service section;
  every non-DC sheet pinned byte-for-byte first.
- `c01df5d` Guided leads one question at a time; Auto and Manual over the same answers.
- `c0a0273` (found in the browser, on Ray's job) **an inverter gate can no longer replace the module
  Design placed.** The production page swapped Design's 440 W module for a 620 W one (panel gate vs a
  migration-default "enphase" brand on a job with no PV inverter), the autosave wrote it over
  `selected_equipment`, and the sheet drew 37 × 620 W / 22.94 kW as a microinverter path. Fixed at the
  writers (moduleAuthority rule for the auto-heal / recommendation / banner; no brand hints and the
  array's module in the DC-coupled SLD request; strings derived against the storage window) and the
  consumers (projection drops brand hints on DC-coupled / storage-only; a recorded module that disagrees
  with the placed wattage FAILS in System Config instead of drawing silently).

## Live-browser findings this session (the tests were green; the browser was not)
| Finding | Where it was seen | Fix |
|---|---|---|
| Summary stated "PV STRINGS 2 (20 / 17) · SolarPro calculation" with no inverter chosen | fresh 37-module project | `522f069` |
| Module record rewritten 440 W → 620 W by the panel auto-heal + save-config write-back | Ray's job, after first autosave | `c0a0273` (writer) |
| SLD drew 37 × 620 W, 22.94 kW, "1 STRING — 1 MODULES", Voc 0.0 V, MICROINVERTERS runs on a DC-coupled job | Ray's job, the sheet the page requested | `c0a0273` (projection drops brand hints) |
| System Config strings 20 / 17 vs the sheet's 9 / 9 / 9 / 8 / 2 | Ray's job | `c0a0273` (page derives against the storage window) |

## Current State
- Branch `claude/quirky-pasteur-iqi5aq`, pushed for review (never `master`, nothing deployed).
- Full vitest at `801e28f` (clean snapshot, `--no-file-parallelism`): **19 failed / 16571 passed** — the
  19 are test-for-test the clean `dev` @ `4375ba3` baseline's (dev: 19 failed / 16411 passed). Commits
  after it (`55e1a7a`, `41ed4b9`, `c01df5d`) ran their own and every renderer-reaching suite (335 + 5).
- `tsc --noEmit --skipLibCheck` 0 errors; eslint 0 errors on every changed file.
- Browser: `e2e/system-config-interview.spec.ts` 4/4 on `next build` + `SOLARPRO_LOCAL_PG=1`
  (README procedure; the container's Playwright needs `executablePath: '/opt/pw-browsers/chromium'`).

## Pending Work (priority order)
0. **RAY DECISION — the permit states the wrong DC size, and fixing it moves the digest.**
   `app/engineering/page.tsx:9493` (and its copy at `:17792`) posts
   `totalDcKw = placed modules × (first string's module watts, else 0.4 kW)`. On Ray's DC-coupled job
   (no fleet strings) that is **37 × 0.4 = 14.80 kW**; the Design array is **16.28 kW**. The posted DC
   size, module identity and count all enter `canonicalDigestBody`, so correcting it changes the digest
   of every permit regenerated afterwards (an approved one would need re-approval). The fix is one line —
   `totalDcKw: pvArray.dcStcKw ?? totalKw` (plus the module identity from `pvModule`) — and is held for
   Ray's go-ahead with an approval-ledger plan. The permit route now LOGS the disagreement
   (`comparePermitArrayWithDesign`), it does not correct it.
1. **Ray's live acceptance** of System Config on his job — nothing is LIVE ACCEPTED.
1a. **Projects an earlier auto-heal already rewrote.** `c0a0273` stops new rewrites and makes an
   affected project SAY so (design.module-conflict fails, naming both modules) — it does not pick a
   winner. Ray's real project should be opened once: if System Config shows the conflict, re-select the
   module in Design. A bulk repair would need the original module from an audit trail SolarPro does not
   keep for `selected_equipment`; not attempted.
1b. `subSystems.<key>.ecosystemBrand` is stamped `'enphase'` with `source: 'migration'` on projects
   that never chose a brand. It is now inert on DC-coupled / storage-only jobs (no brand hints reach the
   route); on an AC-coupled job a stale brand hint can still drive the route's brand override — the
   AC-coupled arm of Rule Eleven asserts the inverter id but not the brand. Same class, not yet closed.
2. **Parity gaps that keep the Service Topology tab** (step 12): per-system gateway / expansion choice,
   per-system storage-landing override in the UI (the writer supports it), the four disconnect roles,
   NEC 220 load model, meter-collar-permitted as its own utility fact. Until these exist in System Config,
   removing the tab would remove capability.
3. Vmp/Imp still fall back to the string engine's defaults for a legacy request that names a module
   without them (the projection and the page always supply them). Remove the default once no caller can
   reach it.
4. String partition is length-first (9/9/9/8/2); a balanced partition (8/8/7/7/7) is a cross-brand
   change for Ray to rule on.
5. The page's `writeTopology` PUTs the hydrated (active) graph, so a System Config edit bakes today's
   catalogue facts into the row. Pre-existing for every page-side graph edit; a patch-based PUT would
   keep the as-issued bytes.
6. `lib/system/buildInverterConfig.ts` `DEFAULT_PANEL_ID_FENCE = 'nexus-ps-mnb108-440w'` names no
   catalogue row (the SolFence module is `panel-fence-ps1`).

## Architecture Notes
- **One physical array:** `resolvePvArrayDesign` (isomorphic). Browser: `pvArray` memo in the page;
  server: `LoadedElectricalProject.pvArray`. Count: placed modules > layout total > SystemDefinition >
  (no Design at all) the string assignment. Identity: `selected_equipment.panelId` > Design Studio's
  module > (neither) the strings; a dangling id fails closed.
- **System Config writes owners, it is not one:** answers are pure functions over the service graph
  (`systemConfigAnswers.ts`) persisted through `PUT /api/projects/[id]/service-topology`; the PV
  coupling records through `POST /api/engineering/electrical-architecture` (provenance USER_SELECTED).
- **Relevance lives in one tested place:** `buildSystemConfigInterview` decides what is asked,
  answered (with source) and what blocks release; the UI renders it.

## Next Steps
1. Establish the deployed commit (see top).
2. Ray walks his job through System Config in the browser; reopen any slice his browser disagrees with.
3. Close the parity gaps in Pending #2, then (only after Ray accepts) move Service Topology out of the
   normal navigation into a developer/advanced surface.
