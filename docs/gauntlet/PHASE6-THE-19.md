# Phase 6 — burning down the last 19

Phase 5 drove the VERIFIED backlog from 80 to 19 and landed on `dev`. Phase 6 spends the
19. No discovery campaign was run: every item traces to `ENGINEERING-AUTHORITIES.md`,
`PLATFORM-FINDINGS.md` or the migration block of `LEDGER.md`.

**VERIFIED REMAINING: 19 → 4, and all four are R8** — Ray's migration decision, gated on
him and on nothing else. Every engineering, marketplace and procurement finding of the 19 is
shipped.

Branch `phase5-fixes`, worktree `../repo-phase5`. Isolation held, then became cooperation:
the peer session's 35 modified files were left alone until that session confirmed in writing
which line ranges its own hunks touch and handed over the one finding inside them.

---

## Where the 19 went

| Lane | At start | SHIPPED | NEEDS RAY | Peer-blocked | Remaining |
|---|---|---|---|---|---|
| Engineering authorities | 13 | 13 | 0 | 0 | 0 |
| Marketplace | 1 | 1 | 0 | 0 | 0 |
| Procurement / BOM | 1 | 1 | 0 | 0 | 0 |
| Migrations (R8) | 4 | 0 | 4 | 0 | 4 |
| **TOTAL** | **19** | **15** | **4** | **0** | **4** |

Two of the nine Phase-5 **NEEDS RAY** items were also answered from the repo rather than
sent to Ray, per the standing rule that something the repo, spec or schema already decides
is not a product decision: **R12** (`stage_changed_at`) and **R15** (`distributor_prices`
unique index). **R14** (#3 AWG) shipped as a resolvability fix without changing what the
sizer recommends. That leaves **R13** (lender-term columns) as the only open one-word
decision, plus R8.

---

## The commits

| Commit | What |
|---|---|
| `61492fb5` | The **six findings that were blocked** on the peer's uncommitted files, re-audited against their rewritten versions first: a hard 40 °C ambient clamp that credited more ampacity than the site's own ASHRAE authority allows in AZ and NV; three different rooftop-adder values for one roof run, all moot under an edition that deleted the rule; **ten** `designTempMin: -10` literals (not eight — a single-space grep undercounted, and the test caught it); the SLD route throwing away the hot half of the thermal authority; the standalone SLD route never passing `batteryCount`, so a step function was evaluated at one unit and printed "120% Rule PASS ✓" where the answer is FAIL; and the battery counted twice on the single-lane E-1 panel. Plus `#3 AWG` made resolvable |
| `30dd6e69` | A DC string's voltage drop computed as a percentage of **240 V**, the AC service voltage; the conductor that actually ships chosen with **no voltage-drop check** at all; and the rooftop adder applied to the open-air runs the table never covered while withheld from the on-roof raceways it did — the scope exactly inverted |
| `efaa90c1` | 🚨 The **lead-claim refund race**: the loser of a contested claim was told the truth, the money moved once, and the winner stopped being refunded |
| `319972db` | 🚨 A company could hold exactly **one** category-wide price override — the second silently ate the first, with a 200 response and no error. Plus the two investigation suites that answered R12 and R15 from the schema |
| `920449bb` | 🚨 The survey's 705.12 recommendation was a **tautology** — `ceil(B × 0.2)` and `B × 1.2 − M` are the same number when main equals bus, so "high confidence, source: nec" could never fail. And the battery branch authority published a conductor floor (`#4 AWG` for an 80 A branch) that **nothing read**, so the schedule printed #8 AWG under an 80 A breaker |
| `557fbaa6` | 🚨 A saved engineering run **could not say which equipment built it**, so reopening one silently re-equipped the design with catalogue defaults — and every downstream artefact was then computed from equipment nobody chose, beside a stored BOM CSV describing the equipment that was |

---

## What the last three found that the findings did not say

**The survey tautology is sharper than recorded, and the missing field was the other one.**
The finding blamed a fabricated solar breaker. That is half of it: `panelRating` is the
**main** rating (`normalizeSurvey` reads it as `mainPanelRatingAmps`), so the field the
survey never had was the **busbar**, and two layers manufactured the other number by
assuming equality — the step read the main as the bus and set the main equal to it, and the
normalizer substituted the main for a missing bus, under a comment whose inequality was
backwards. Either direction collapses the allowance to `0.2 × main`, which is exactly what
the prefill fabricated. `busbarRating` is now a surveyed field with its own chip, not
required, blank meaning **not recorded**.

**An unwritten column does not read NULL.** The equipment-identity fix assumed that never
writing `inverter_qty` left it null. `inverter_qty INTEGER DEFAULT 1` means **every run ever
saved stored a 1** — one inverter asserted for every multi-inverter design. The test found
that, not the audit. NULL is now passed explicitly to bypass the default, because the count
belongs to the topology-plus-capacity authority and not to a column.

**A repair reached the next defect, again.** Consuming `minConductorAwg` as a floor exposed
that the battery run segment is gated on `input.batteryBackfeedA` while the busbar total is
computed from `batteryIds` — so a design that passes ids but not the scalar gets **no
battery run segment at all**. Recorded, not fixed: it is in a peer-owned file.

---

## The last one — the BOM's 120% allowance had no battery term

`lib/bom-engine-v4.ts` computed, in two duplicated blocks:

```
const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
```

with no term for any other source, while `batteryId` and `batteryCount` sat on the same
input used only for a line quantity. 705.12(B)(3)(2) is a **sum** over every device other
than the main, so a battery branch spends the allowance the PV breaker draws on — and
`computed-system`, the permit's engine, counts it. The same package therefore carried a
stamped busbar verdict **including** the battery beside a BOM note asserting an allowance the
battery had already spent, and bought a breaker sized for PV alone. A 200 A bus with a 200 A
main has 40 A; two IQ Battery 10C units are an 80 A branch, which overruns all of it. The BOM
printed `120% rule: (200A × 1.2) − 200A = 40A max` anyway.

**It is not a one-line subtraction, and that is the part the finding did not say.**
`backfeedAmps` means different things to different callers — `bomForPermit` passes the
conductor authority's AC feeder OCPD (PV only), while the page's SLD payload sends
`cs.backfeedBreakerAmps` (PV **plus** storage). Subtracting the battery while sizing against
a figure that already includes it would double-count: too small a breaker, and a violation
warning on a compliant design. So the split is **asserted** by the caller through a new
`pvOnlyBackfeedA`, and when it is not established the resolver returns `evaluated: false` and
the BOM prints `NEC 705.12(B) NOT EVALUATED` instead of a verdict. The breaker is still
sized — what is withheld is the certification, not the part.

Shipped in `10a015b4`. The allowance comes from `maxLoadSideBackfeedA` in
`lib/nec/rule705_12.ts`, so no copy of that arithmetic was added, and a test asserts the new
file does not re-inline it. The battery contribution comes from `resolveBatteryBranch` — the
manufacturer's step function — read by the engine from the ids it already had, so no caller
needed a battery field and no quantity is inferred from a device count.

**How it got unblocked.** That file is one of 35 the peer session is mid-edit in, so it was
left alone. The peer confirmed its own hunks sit at ~1443–1466, ~2872–2912 and ~3808–3970 —
neither 120% block — and handed the finding over, asking for the version that reads the
authority rather than recomputing the rule. The helper went in a **new** file so there is
nothing in their file to conflict with beyond one import and one call per block.

---

## Proof discipline

Every fix in this phase was red-proved by restoring the **original bytes** with
`git checkout HEAD -- <path>`, never a retyped mutation, and the failures are quoted in each
commit message. Counts: the survey/battery lane 5 red then 3 red then 1 red across three
separate restores; the BOM battery-term lane **7 of 15 red**, with the defect quoted straight
out of the run (`120% rule: (200A × 1.2) − 200A = 40A max` printed beside an 80 A battery
branch); the equipment-identity lane **8 of 13 red**, each naming its own defect
("the selected panel is still not recorded on the run: expected null to be
'panel-fence-ps1'", "rapid shutdown OFF still restores as ON", "'grid-tied' is not a
SystemType and must not be invented").

Two assertions were caught being **blind** and rewritten rather than counted:

- A `PROXY` check on stripped source would have passed on a comment; it now reads the
  runtime log string, and the companion claim about an inverted inequality reads the **raw**
  source, because stripping the comment it lives in would make that assertion pass whatever
  the file says.
- A battery-floor suite that only queried the catalogue would have passed against the
  defect. It now drives the real engine and asserts the **conduit schedule text**, which is
  what printed `2#8 AWG THWN-2`.

Fixtures are chosen so no default can impersonate a pass: the equipment-identity suite uses
a **fence** system (because `'grid-tied'` would overwrite it), **two** inverters (because 1
is the coalesced default), and rapid shutdown **off** (because the column defaults to true).

---

## Regression at the end of the phase

- `tsc --noEmit`: **0 errors**.
- `tests/planset` + `tests/goldens`: **2909 / 2909 across 206 files**.
- The siteSurvey folder and survey-evidence suites: **238 / 238**.
- The battery, OCPD-ladder, Enphase-branch, combiner and engine-parity lanes: **75 / 75**.
- The six suites touching the engineering run record: **63 / 63**.
- `tests/security/secret-guard.test.ts`: **12 / 12** before every push.

### Two operational notes, both of which nearly produced a false green

**A full-repo `tsc` failed twice with `Zone Allocation failed` at 1.8 GB while 8 GB of
physical RAM was free.** Measured cause: **committed bytes 47,040 MB of a 49,067 MB limit**,
with four `next dev` servers from the main checkout holding ~15.7 GB between them. The limit
is the Windows commit charge, not RAM, so `--max-old-space-size` changes nothing; a narrowed
`tsconfig` that `extends` the real one and `include`s only the changed files is the way
through. Those four servers are not this session's and not the peer's — three predate both
— so **neither session killed them**; it is Ray's call.

**A vitest run reported `168 passed (200)` with ZERO failures while 32 files had silently
never run**, their worker forks having died with `spawn UNKNOWN` (errno -4094). A passing run
that proves nothing is worse than a red one. `--maxWorkers=3` restored 206/206 — and then
the peer session pointed out that **Ray's standing single-worker rule for this machine covers
vitest, not only Playwright**. It does: the rule is recorded as
`vitest --maxWorkers=1`, and the same memory note says `--maxWorkers 3` "reliably dies" when
agents are running. Using 3 was wrong even though it produced true numbers, so **every final
regression figure in this document was re-run at `--maxWorkers=1 --pool=threads`** with
`NODE_OPTIONS=--max-old-space-size=2048`, and they match. The lesson kept: diff the files that
ran against the files requested, every time — `lib/bom-master-task.test.ts` was requested in
the BOM regression and is in `vitest.config.ts`'s exclude list, so it did not run and is not
evidence.
