# PLANSET 17 — PROJECTION AND RENDERING CLOSURE

**Date:** 2026-07-31 · **Branch:** `dev` · **Starting commit:** `1d2d7922` · **Ending commit:** `f944906a`

> **STATUS: D1, D2 and D3 are CLOSED, verified in a regenerated artifact, and pushed.**
> **D4 (wiring the canonical font pack) is NOT implemented** — the pack is built and hashed,
> but no `@font-face` is emitted and 179 source sites still request host fonts.
> **WS-5 remains blocked** until D4 lands and a re-baselined artifact proves the full result.

| Defect | Status | Commit |
|---|---|---|
| D2 — false project-wide `#10 AWG` EGC minimum | **CLOSED**, artifact-proven | `b108164b` |
| D3 — SCHED omitted 38 of 48 BOM rows | **CLOSED**, artifact-proven | `f088e72a` |
| D1 — utility-owned run counted as field work | **CLOSED**, artifact-proven | `f944906a` |
| D4 — canonical font pack wiring | **built, not wired** | `9c6d9103` (pack only) |

---

## 0. THE HEADLINE FINDING (carried forward) — D3'S PREMISE WAS WRONG

The brief stated fittings "are derived only for `RW-BRANCH-HOMERUN`". They were not.
`emitRacewayConduitBom` loops over every derived physical raceway and always did — in the
FULL profile all three project-owned raceways appear 13 times each with 15 fitting rows.

**The defect was COMPOSITION.** 48 canonical BOM rows; the full profile rendered all 48, the
permit **and design-review** profiles rendered **10**. Thirty-eight procurement lines never
reached the artifact a reviewer holds, and the compact profiles emitted no population total
to compare against — the omission was invisible from the sheet itself.

Building the prescribed `RacewayProcurementResolution` would have added a second derivation
of already-correct data and shipped the defect. The brief's later correction ("The fix is
pagination/composition, not a second procurement derivation") is what was implemented.

---

## 1. D3 — SCHED CONTINUATION AND ARTIFACT COMPLETENESS

### Root cause — three pieces, all of which had to move together

| # | Site | What it did |
|---|---|---|
| 1 | `sheetManifest.ts` compact branch | dropped `SCHED-2/3/4` from the sheet index |
| 2 | `generatePermit.ts:1431` | `...(_compact ? [] : …)` suppressed the continuation PAGES |
| 3 | `structuralPages.ts:2277` | overrode the continuation label to point at the in-app record |

Piece 3 is worth naming: *"ITEMS n–m — FULL PROCUREMENT BILL OF MATERIALS IN THE PROJECT
RECORD (SNAPSHOT-BOUND; NOT A PERMIT DOCUMENT)"* was true about where the rows lived and
false about the schedule being complete. Pointing a reviewer at an in-app record is not a
substitute for printing the schedule.

The original exclusion was reasoned as *"the permit needs ONE major-equipment schedule …
Nothing here decides truth: every requirement these sheets used to print is still in the
snapshot registry."* That holds for the REVIEW sheets it was written about. It does not hold
for the BOM, because procurement lines are not requirements — they are the schedule itself.

### Canonical-to-rendered reconciliation

| | before | after |
|---|---|---|
| Canonical BOM rows | 48 | 48 |
| Rendered — full | 48 | **48** |
| Rendered — permit | 10 | **48** |
| Rendered — design-review | 10 | **48** |
| Duplicate row ids | 0 | **0** |
| Missing row ids | **38** (compact) | **0** |
| Fitting rows (`Raco/Allied`) | 4 compact / 15 full | **15 everywhere** |
| `RW-BRANCH-HOMERUN` refs (design-review) | 11 | **13** |
| `RW-COMBINER_TO_DISCO_RUN` refs | 3 | **13** |
| `RW-DISCO_TO_METER_RUN` refs | 3 | **13** |

### Sheet counts

```text
design-review  16 → 19   (+ SCHED-2, SCHED-3, SCHED-4)
permit         15 → 18   (+ SCHED-2, SCHED-3, SCHED-4)
full           25 → 25   (unchanged — it always carried them)
```

Open gates 5 and unresolved requirements 14 are **unchanged**. This is a composition repair;
no requirement was resolved or suppressed.

### Tests that had encoded the defect

`aac-ws10-planset-profile.test.ts` asserted `not.toContain('CONTINUED ON NEXT SHEET')` —
which the truncation **satisfied**, because `structuralPages.ts:1631-1635` swapped the label
for compact profiles. It was pinning the defect, not protecting a contract. Three assertions
rewritten to prove the continuation is **accurate** rather than forbidden; the sheet-count
ceiling moved 16 → 20 because the permit set is compact by dropping the review registry,
PV-6, APP-A and CERT placeholders — not by dropping procurement rows.

New gate `tests/planset/d3-sched-bom-reconciliation.test.ts` states the invariant against the
**rendered** artifact: the set of BOM row ids on the sheets equals the canonical set, exactly
once each, under every profile; all three project-owned raceways appear; no row references
the utility-owned run; the sheet index agrees with the rendered continuations; the schedule
conclusion appears exactly once; and no continuation is emitted when the count is zero.

**Non-vacuity proven** against the accepted Planset 17 artifact itself: it renders 10 BOM
rows and 4 fitting rows where the repaired package renders 48 and 15 — the reconciliation
test would have flagged **38 missing rows**.

---

## 2. D1 — EXPLICIT ROUTE OWNERSHIP AND APPLICABILITY

### Source map

`isUtilityOwned: true` is set on the MSP → utility run by **two** producers —
`computed-system.ts:1886` and `segment-builder.ts:582` — and the raceway/BOM layers honour it
(`computed-system.ts:2434` skips it when building `physicalRaceways`, which is why it
correctly has no raceway object). The snapshot's run→record mapper never copied it, so the
fact **died at the snapshot boundary**, and two independent counters treated all six segments
as one population.

### The model

```ts
type RouteOwnership = 'PROJECT_OWNED' | 'UTILITY_OWNED';
type RouteAuthorityApplicability = 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE';
```

Carried on `RouteSegmentRecord` with a stated `routeApplicabilityReason`. Every consumer
reads it **fail-closed** as `?? 'REQUIRED'`, so a record with no decision counts as the
installer's responsibility rather than being silently excused. Exclusion is never inferred
from a missing raceway (a project run with no raceway is a **defect**, not an exclusion) and
never from the segment id.

### Both counters, fixed together

`build.ts:1663` reaches the **permit** set through the per-sheet release banner;
`resolution/derived.ts:155` appears only on the **full/internal** set. Repairing one alone
ships a permit package that reads correctly beside an internal package that contradicts it.

### Route counts

| | before | after |
|---|---|---|
| Rendered claim | `5 of 6 electrical run(s)` | `4 of 5 PROJECT-OWNED electrical run(s)` |
| Project-owned unresolved | — | **4** |
| Project-owned geometry-derived | — | **1** |
| Utility-owned excluded | 0 (counted as project) | **1** |
| `"5 of 6"` occurrences | 3 profiles | **0** |

Live wording now reads:

```text
4 of 5 PROJECT-OWNED electrical run(s) … require a field-measured route: ROOF_RUN,
BRANCH_HOMERUN_RUN, COMBINER_TO_DISCO_RUN, DISCO_TO_METER_RUN. 1 run(s) ARE geometry-derived
and are not blocked: BRANCH_RUN. 1 run(s) are EXCLUDED from project route authority:
MSP_TO_UTILITY_RUN (utility-owned service equipment).
```

and the resolver agrees: `1 of 5 PROJECT-OWNED segment(s) are derived from real geometry`.
The excluded population is published in the resolver `inputs` so it is auditable rather than
merely absent. Gates 5 / requirements 14 unchanged — the utility run was never the sole
holder of `ROUTE-LENGTH-ESTIMATE`, so correcting the count corrects a false statement
without resolving a real requirement.

### The false-pass test I wrote in the WS-3 pass, rewritten

`ws3-conduit-authority.test.ts:113-125` keyed the exclusion on a `/MSP_TO_UTILITY/` **name
regex** — the exact product-name topology inference the standing rules prohibit — and carried
`if (!utility) return;`, a silent early return that would have evaporated the assertion if
the id ever changed while still reporting green. It now resolves the segment by its ownership
field, asserts the segment exists, and fails when ownership is undefined.

`tests/planset/d1-route-ownership.test.ts` adds 13 gates, including one proving the
classification survives **renaming** the segment — i.e. that it is data-driven.

---

## 3. D2 — ARTIFACT PROOF (the outstanding item from the last pass)

The uploaded Planset 17 predated `b108164b` and still showed the false wording. Regenerated
under the current font baseline:

```text
design-review : 0 occurrences
permit        : 0 occurrences
full          : 0 occurrences
```

probed case-insensitively for `DC EGC minimum`, `EGC minimum: #?N AWG` and
`10 AWG per NEC 690.45`. The replacement renders:

```text
Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking,
module frames, and enclosures shall be bonded per NEC 690.43. Equipment grounding and
bonding conductors are SEGMENT-SPECIFIC — no project-wide EGC minimum applies. See PV-4B and
PV-4B.1 for the governing per-segment schedule (branch #12 AWG; feeder #10 AWG). The selected
microinverter product authority establishes NO SEPARATE EGC REQUIRED for the array circuits.
```

Preserved: IQ8A `NO_SEPARATE_EGC_REQUIRED`; branch #12 AWG Cu; feeder #10 AWG Cu.

---

## 4. VALIDATION (true exit codes, captured before any formatting)

| Check | Result | Exit |
|---|---|---|
| Typecheck | clean | **0** |
| Lint (full) | 0 errors | **0** |
| Full suite | **8969 passed / 0 failed** (489 skipped, 398 files) | **0** |
| `d3-sched-bom-reconciliation` | passed | **0** |
| `d1-route-ownership` | passed | **0** |
| `ws3-conduit-authority` (rewritten) | passed | **0** |
| `aac-ws10-planset-profile` (rewritten) | passed | **0** |
| `conductor-authority` (D2 probe) | passed | **0** |
| Pagefit design-review (19 sheets) | clipped=0 internal=0 h=0 | **0** |
| Pagefit permit (18 sheets) | clipped=0 internal=0 h=0 | **0** |
| Pagefit full (25 sheets) | clipped=0 internal=0 h=0 | **0** |
| Live regeneration | 19 / 18 / 25 sheets · 5 gates · 14 reqs · 0 advisories | **0** |

### Evidence harnesses — exit code captured directly, not through a pipe

| Harness | Score | Exit | Baseline | Verdict |
|---|---|---|---|---|
| `bar-wse` | 36/36 | 0 | 36/36 | unchanged |
| `bar` | 12/14 | 2 | 12/14 | pre-existing |
| `co` | 20/20 | 0 | 20/20 | unchanged |
| `ecd` | — | 2 | failing | pre-existing |
| `ep` | 21/22 | 2 | 21/22 | pre-existing |
| `ppc` | 18/18 | 0 | 18/18 | unchanged |
| `rgm` | 17/17 | 0 | 17/17 | unchanged |
| `rp` | 20/20 | 0 | 20/20 | unchanged |
| `w3` | — | 2 | failing | pre-existing |
| `w4` | — | 2 | failing | pre-existing |
| `planset-evidence` | — | 0 | — | unchanged |

**No harness regressed.** `ecd`, `w3` and `w4` remain open debt, unrelated to routes,
grounding or BOM composition.

**Not run this pass** (stated rather than implied): production build, Chromium PDF render,
visual inspection of the six sheets and the new SCHED continuations. Those belong with the
D4 re-baseline, since D4 changes every glyph advance and the geometry would have to be
re-inspected afterwards regardless.

### One flake, recorded rather than quietly re-run

`qcable-grounding-authority.test.ts` failed once with *"gate 6: chained bar-wse: 0/0 checks
pass"*. It is **not** a D1 regression: `bar-wse` passes 36/36 standalone on both the live and
fixture packages with D1 applied, and the test passes on re-run and in the final full-suite
run. The chain spawns a harness that itself spawns Chromium; under full-suite parallelism it
can return no results. A stash-and-rerun appeared to exonerate D1 but was equally
inconclusive — the flake simply did not recur.

---

## 5. D4 — NOT IMPLEMENTED

Font Pack `1.0.0` is built, subset, hashed and committed (`9c6d9103`), but **nothing imports
it**: no `@font-face` is emitted and `--sans`/`--mono` still request host Arial / Courier New.

| Face | Family | Bytes | SHA-256 (16) |
|---|---|---|---|
| SolarProSans-Regular | SolarPro Sans | 42,904 | `9370d56d9296ecf2` |
| SolarProSans-Bold | SolarPro Sans | 43,164 | `7e72c1dc508d8f2d` |
| SolarProMono-Regular | SolarPro Mono | 37,196 | `8389c1ee1b90d49b` |
| SolarProMono-Bold | SolarPro Mono | 37,108 | `ae658e5f292ae235` |
| SolarProSymbols-Regular | SolarPro Symbols | 55,252 | `5f2213ba32268669` |

215,624 bytes → 287,498 base64, ≈ +16 % on the artifact. `SolarPro Symbols` covers the six
codepoints Liberation lacks (`⇒ ▶ ◀ ⚠ ⚡ ✓`), subset so it can never win a Latin glyph.

### Measured scope of the remaining migration

```text
source sites requesting a host font (lib/**/*.ts)   179
Arial references in the generated artifact          177
Courier references                                    2
bare `font-family:monospace` sites                   53
```

**It was deliberately not started with the remaining budget.** A partial migration is the
specific failure the acceptance standard names — *"CSS fonts changed while SVGs still use
Arial"* — and it would be invisible to the page-fit gate, which skips everything inside
`<svg>` (`pagination-probe.mjs:263`/`:272`). Bare `monospace` measures 8.4 % narrower than
Courier New, so drift on those 53 sites can never trip an overflow gate; it silently
mis-sets column widths.

### Remaining D4 checklist

1. emit `@font-face` from `fontPackData.ts`; repoint `--sans`/`--mono` to the canonical families;
2. migrate all 179 source sites (SVG attributes included) to canonical tokens;
3. bump `PLANSET_ENGINE_VERSION` (`lib/permit/constants.ts:716`) — without it the route keeps
   serving stored artifacts with the old stylesheet;
4. record `fontPack{version, faces[{family, sha256, bytes}]}` in snapshot meta;
5. fail authoritative rendering closed on hash or fingerprint mismatch, after `document.fonts.ready`;
6. add the symbol-face test proving it carries **no** Latin coverage;
7. mark the `wkhtmltopdf` path `NON-AUTHORITATIVE PREVIEW` and bar it from release/pagefit;
8. invert the CI font gate — after embedding, a host with **no** Arial is the supported case,
   but `ci.yml:244-253` currently hard-exits on it;
9. re-baseline page-fit, geometry fingerprints, artifact hashes and goldens; then run the
   production build, PDF render and visual inspection that were deferred here.

---

## 6. BEFORE / AFTER

```text
Starting commit                 9c6d9103
Ending commit                   f944906a
Rendering-pack version          unchanged (font pack built, NOT wired)

Sheet count  design-review      16 → 19
             permit             15 → 18
             full               25 → 25
Open gates                      5 → 5
Unresolved requirements         14 → 14

Canonical BOM rows              48
Rendered SCHED BOM rows         10 → 48   (all profiles)
Missing rendered row ids        38 → 0
Duplicate rendered row ids      0 → 0
Canonical fitting rows          15
Rendered fitting rows           4 → 15
Raceways represented            1 of 3 → 3 of 3 (13 refs each)

Project-owned unresolved routes 4
Project-owned geometry-derived  1
Utility-owned excluded routes   0 → 1
"5 of 6 electrical runs"        3 profiles → 0

False project-wide EGC wording  0 (all three profiles)
IQ8A grounding outcome          NO_SEPARATE_EGC_REQUIRED
Branch EGC                      #12 AWG Cu
Feeder EGCs                     #10 AWG Cu

Incorrect EMT projections       0    (WS-3 preserved)
Incorrect 3/4-inch projections  0    (WS-3 preserved)
Page clipping                   0    (19 / 18 / 25 sheets)
Internal clipping               0

Inline SVG Arial refs           177 → 177   (D4 not started)
Bare monospace sites            53  → 53    (D4 not started)

Full suite                      8969 passed / 0 failed (exit 0)
Lint                            0 errors (exit 0)
Typecheck                       exit 0
Production build                NOT RUN — deferred to the D4 re-baseline
PDF engine                      unchanged; fallback still unmarked (D4)
Push                            origin/dev 0 ahead / 0 behind at f944906a
```

**WS-5 remains blocked** on D4.
