# Phase 5 — burn-down of the VERIFIED backlog

Phase 4 bought the findings. Phase 5 spends them. No new discovery campaign was run;
every item below traces to `PLATFORM-FINDINGS.md`, `ENGINEERING-AUTHORITIES.md` or the
migration block of `LEDGER.md`.

**VERIFIED REMAINING: 80 → 19.**

> 🚨 **CORRECTION, 2026-09-26.** When I first wrote this table, three of the 61 were
> counted as shipped and were **not**. The CRM lane built `applyStageChange` and handed
> off two one-line caller changes that nobody applied — so signing a proposal still
> wrote `projects.stage`, a column that does not exist, and creating one still advanced
> only the legacy column. And Campaign Intel was credited to the marketplace lane, but
> `analytics/route.ts` was never in that lane's file set, so it was never touched. Found
> by verifying my own report before writing the UX changelog rather than trusting it.
> Fixed in `3cddb98d`; the totals below are now true. **Shipped was 58 at the time of
> writing and is 61 now.** A handoff nobody picks up is not a shipped fix, and the count
> is the one thing in this document that must not be generous.

Branch: `phase5-fixes`, worktree `../repo-phase5`, 15 commits off `ca61ad98`.
Isolation was real: the peer session's 11 dirty files were never touched, and this
branch was built in its own worktree with `node_modules` junctioned.

---

## Counting the start

| Source | At start | Note |
|---|---|---|
| `PLATFORM-FINDINGS.md` | 50 | 53 confirmed − 3 already fixed in Phase 4 |
| `ENGINEERING-AUTHORITIES.md` | 26 | 28 confirmed − 2 already fixed/escalated |
| Migration block of `LEDGER.md` | 4 | 003, 027, the `running` row, 042 |
| **Total** | **80** | |

---

## Terminal states

| Lane | Verified at start | SHIPPED | NEEDS RAY | BACKLOGGED | REJECTED | Remaining |
|---|---|---|---|---|---|---|
| CRM / Operations | 6 | 6 | 1 (migration) | 0 | 0 | 0 |
| Proposal / Customer | 8 | 8 | 0 | 1 (A4 deeper) | 0 | 0 |
| Marketplace | 6 | 5 | 0 | 0 | 0 | 1 |
| Site Survey / Field | 3 | 3 | 0 | 0 | 0 | 0 |
| Homeowner Portal | 8 | 8 | 0 | 1 (referral half) | 0 | 0 |
| Admin / Operational health | 6 | 6 | 0 | 0 | 0 | 0 |
| Procurement / BOM | 7 | 6 | 1 (unique index) | 0 | 0 | 1 (peer) |
| Finance / Pricing | 4 | 4 | 1 (lender columns) | 0 | 0 | 0 |
| Enterprise / Multi-tenant | 2 | 2 | 1 (per-org pricing) | 0 | 0 | 0 |
| **Platform subtotal** | **50** | **48** | **4** | **2** | **0** | **2** |
| Engineering authorities | 26 | 13 | 1 (#3 AWG) | 0 | 0 | 13 |
| Migrations | 4 | 0 | 4 (R8) | 0 | 0 | 4 |
| **TOTAL** | **80** | **61** | **9** | **2** | **0** | **19** |

"Remaining" and "NEEDS RAY" overlap only where a finding has a shipped half and a
blocked half; those are counted once, in the column that describes what is still
outstanding.

---

## P0s eliminated

| What | Commit |
|---|---|
| Any logged-in user could edit or delete the panels **every organisation** designs with — one process-global catalog, no tenant key, session-only gate | `981c3b0a` |
| `GET /api/pricing` published the installer's labor cost, overhead and profit margin to the open internet | `981c3b0a` |
| A new portal file endpoint enforces ownership as a JOIN predicate, tested with the negative case first | `6fcc0ba8` |

The pricing one could not simply require auth: the homeowner share view fetches it with
no session and swallows the error, so a 401 would have silently re-quoted the customer
from hardcoded defaults. The payload was narrowed instead of the path.

---

## Unsafe-direction engineering findings eliminated — 13 of 26

| # | What | Commit |
|---|---|---|
| 1 | NEC Table 250.66 existed **three times, disagreeing at every rung**, all keyed on the OCPD — not on the service-entrance conductor the table is indexed on. Billed 50 ft of #2 where 250.66(A) caps a rod-only GEC at #6; undersized above 350 kcmil | `91945790` |
| 2 | The EGC ternary went **flat at #6 AWG above 100 A** — a 300 A feeder shipped #6 where 250.122 requires #4, citing 250.122 | `91945790` |
| 3 | The electrode gate existed on one BOM emitter and not the other, so every hybrid shipped a phantom rod + GEC and printed "required" while the plan set printed "not added" | `91945790` |
| 4 | The backfeed cap was raw arithmetic: a 320 A / 200 A service emitted `QO184`, a part Square D does not make | `91945790` |
| 5 | A DC string fuse above the module's own listed maximum — 25 A on a 20 A-max Trina Vertex S+ 435W — **purchased**, on a package that printed the 20 A limit two sheets earlier | `4d478fa7` |
| 6 | Conduit trade size from an **ampacity bracket** with no area, no fill %, no conductor count. DC side 43.5 % fill against the 40 % limit, on an equipment-schedule line a crew orders | `e965650a` |
| 7 | Load-side vs supply-side decided by `busbar × 0.2`, one field standing in for both busbar and main breaker, and a fabricated 200 A. `× 0.2` is not a rule the NEC states | `e965650a` |
| 8 | The string ceiling used a blanket Voc × 1.25 and a hard 20-panel clamp, so Florida was capped as if at −38 °C — more strings, more MPPTs, sometimes another inverter | `e965650a` |
| 9 | An unresolved battery got a **stamped 120 % PASS** from a sum missing the battery term, while `electrical-calc` refused on the same design | `dc271f39` |
| 10 | The panel-compatibility gate was **temperature-blind** — the engine held the design temperature and never passed it, so 40 states got the warmest row of Table 690.7(A) and a pairing over the micro's max DC input voltage stayed selected | `a5e3cb32` |
| 11 | A **second 240.6 ladder** capped at 400 A with a /10 tail, imported alongside the real one under names differing only by a capital letter | `46544803` |
| 12 | `nextStandardOcpd` **fabricated ratings above 1200 A** — 1250 A returned 1300 A where 240.6(A) says 1600 | `46544803` |
| 13 | Three selectable gauges returned a **voltage drop of zero**, and the autosizer's guard could not fire because the refusal already *was* 0 | `1d20185e` |

Found while collapsing these, not in the audit's list: a **sixth** copy of NEC 250.122
inside `computed-system.ts`, flat at #2 AWG above 400 A (`46544803`).

---

## Engineering findings still open — 13

Six are blocked by the peer session's uncommitted files and were deliberately not
touched:

| Finding | Blocking file |
|---|---|
| Three rooftop adder values (33 / 30 / 35) for one roof run | `app/engineering/page.tsx` |
| A hard 40 °C clamp on the design ambient, less conservative than ASHRAE in AZ/NV | `app/engineering/page.tsx` |
| Ten `designTempMin: -10` literals feeding the string sizer | `app/engineering/page.tsx` |
| The SLD route resolves the thermal authority and throws its hot side away for a flat 30 °C | `app/api/engineering/sld/route.ts` |
| The standalone SLD route never passes `batteryCount`, so a step function is evaluated at one unit | `app/api/engineering/sld/route.ts` |
| The battery is counted **twice** on the single-lane E-1 panel | `lib/sld-professional-renderer.ts` |
| The last 3 `Math.ceil(x/5)*5` OCPD sites | all three of the above |

Seven are available and simply not reached:

- A DC string's voltage drop printed as a percentage of **240 V AC**, and that number overwrites the correct one
- `segment-schedule`'s ampacity-only selector overwrites `computed-system`'s voltage-drop-gated one, so the wire that is *bought* was chosen with no voltage-drop check
- The rooftop adder's scope is **exactly inverted** — applied to open-air runs, withheld from on-roof raceways
- A 33 °C rooftop adder on **ground- and fence-mount** permits, while the same sheet prints "no rooftop adder applies"
- The survey's 705.12 recommendation is a **tautology**: it fabricates the solar breaker as exactly the 120 % allowance, so "high confidence, source: nec" can never fail
- The battery branch authority publishes `minConductorAwg: '#4 AWG'` for an 80 A branch and **nothing reads it** — the printed schedule says #8 on an 80 A OCPD
- The grounding-electrode requirement in `computed-plan`'s Stage 4 (partially addressed — its GEC now delegates)

The first three move the permit digest, which under R9 retires live PE approvals. That
is a deliberate sequencing choice, not an oversight.

---

## Migrations — unchanged, and still Ray's

No code shipped here. The forward-only recovery architecture Phase 5 asked for was not
built: it is gated on the same ledger decision R8 has always been gated on, and
guessing it would risk the one thing that cannot be un-risked — an environment whose
schema is indeterminate. The facts remain as Phase 4 left them:

- **003** is the first actual blocker, with `ADD CONSTRAINT IF NOT EXISTS` — valid in no PostgreSQL version, while 003's own header asserts it is
- exactly **two** migrations apply before the halt
- forcing past every failure gives **33 blockers of 120**
- **seven core tables** have no creation path in the scanned migrations; `proposals` is created by *nothing in the repo* while six migrations reference it
- editing an applied migration changes its checksum, and `CHECKSUM_CONFLICT` then halts the batch for every environment where it is recorded applied

What Phase 4 *did* fix stands: the batch no longer steps over an interrupted migration
and applies later files on top of an indeterminate schema (`f15aa257`), and the forced
dry-run's verdict is now actually read (`c26a56ea`).

One thing Phase 5 adds, from the procurement lane and worth recording next to the rest:
`distributor_prices` has **no unique index at all**, proven by executing the shipped
`ON CONFLICT` statement against real PostgreSQL — `42P10 there is no unique or exclusion
constraint matching the ON CONFLICT specification`. Because that *throws*, the
comment-documented "fallback INSERT" was unreachable dead code and every price save
500'd. Repaired without a migration (UPDATE-then-INSERT); the index remains available
as optional hardening, and it will **fail if duplicate rows already exist**, so it needs
a de-dup pass first.

---

## Proof discipline — what did not count

Phase 4's lesson was that a green test can be blind. Every fix in this phase was
red-proved by restoring the **original bytes** with `git checkout`, never by retyping a
mutation. Six assertions were measured green against the restored defect and are
recorded as **BLIND and not counted**:

| Assertion | Why it cannot discriminate |
|---|---|
| The 250.122 case in the OCPD suite | Exercises the canonical `getEGCSize`, which was always right; the sixth copy was module-private |
| "all six integration flags are plain booleans at runtime" | `typeof false` is `'boolean'` — the defect was in the *type* |
| The vault's "no id ⇒ no control" | The old glyph was an `<svg>`, so `queryByRole('link')` found nothing either way |
| The bill-upload label check | The old summary *also* normalised to "Utility Bill" — that was the defect's disguise |
| §4 of `stageClockMeasuresTheStage` | The module did not exist before, so nothing can be restored |
| "the finance APR is still treated as a decimal" | `financeApr` was always correct; kept because copying the APR row is how the 3000 % bug was written |

Two near-misses are worth more than the successes:

**My panel-gate suite was almost useless.** Restoring the original bytes turned only 1
of 7 cases red. Every temperature case passed *against the defect*, because they called
the gate directly **with** a `designTempMinC` — and the gate always honoured a
temperature it was given. The defect was that the engine never gave it one, so
supplying the option myself bypassed the entire bug. Fixed by driving the real
`sizeSystemFromBrand`, where the reproduction reads: *"produced the same
panel-compatibility verdict at −31 °C as at −2 °C"*.

**A worker's own guard was blind and it said so.** Its first behavioural test for the
fabricated-milestone defect was green with the defect restored, because the route calls
`void writeMicroStage(...)` — it returns before the row lands, so an immediate `SELECT`
saw an empty table either way, while the row arrived milliseconds later in the
customer's portal. Replaced with a call spy plus a settled re-read.

---

## Tests that were pinning defects

Three existing suites had to be re-aimed because they asserted the broken behaviour:

- `tests/goldens/wave2c-bom.test.ts` asserted **exactly one** ground rod against a
  hybrid fixture that never sets `requiresGroundingElectrode`, so it could not tell
  "one because it is de-duplicated" from "one because the gate is missing". Re-aimed to
  check both halves.
- `lib/proposal/renderProposalHTML.test.ts` had fixture `itcRate: 0.30` — a **decimal** —
  asserting `'30%'`. That test is why `fmtPct(itcRate * 100)` survived review.
- `tests/priority10-portal-vault-referral.test.ts` had **8** assertions pinning the
  referral defects.

---

## Regression at the end

| Suite | Result |
|---|---|
| `tests/planset` (the canonical set) | **2598 / 2601** |
| Typecheck | 1 error, **not ours** — see below |

The 3 planset failures are in 4 files and all have the same cause, and it is not this
branch's:

```
TypeError: buildHybridPermitMetering is not a function
  lib/permit/snapshot/build.ts:3144
```

`build.ts` was committed in `75a74099` importing `buildHybridPermitMetering` from
`lib/permit/utils/sldAdapter`, which does not export it at `ca61ad98` — the function
exists only in the peer session's **uncommitted** working copy. So on `dev` today:
every hybrid permit generation **throws at runtime**, and the repo does not typecheck.
That is the peer's file and the peer's fix; it is recorded rather than patched, because
editing a file another session is mid-edit in is how regression evidence gets polluted.

---

## What is not done, plainly

- **No browser/live proof was run.** The changes in this phase are engine, route and
  data-layer work with behavioural tests against real PostgreSQL and jsdom renders; the
  interactive surfaces that would warrant Playwright (Tree drag, panel elevation) were
  LIVE ACCEPTED in Phase 4 and were not touched. Two lanes — the survey Step-Photos
  repeatable slots and the portal vault link — have shipped endpoints and unshipped page
  wiring, and those specifically deserve a browser pass once wired.
- **13 engineering findings remain**, 6 of them peer-blocked.
- **The migration campaign did not advance**, by choice.
- **`phase5-fixes` is not pushed.** The push was refused by this session's permission
  layer; the branch is local and complete.
