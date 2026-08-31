# Release-integrity continuation — N35 / N36

**2026-08-30. Branch `dev`, `de5c2850..8ef694ef`. Digest `8d7fcfa38d9a25ef8775e398`
unchanged throughout.**

---

## What was closed

### §12 — the rendered-authority claim audit (N35 `2aaf03c2`)

The audit sweeps the ARTIFACT, not the source, because two defects this campaign
found were invisible in source: the NEC operator attribution, and an explanatory
comment of mine that leaked into the sheet from inside a template literal.

It found the last false-attribution surface, and it was an **asymmetry** rather
than a sentence — printed side by side in the same title block on all 21 sheets:

```
NEC 2020                 <- state-adoption-table, zero evidence
IBC PER AHJ ADOPTION     <- honest: family governs, year deferred
```

A reviewer reads that as *"the NEC edition is settled and the I-codes are not"*.
Both are equally unprovenanced. The N26 producer inventory puts **5 of 6 NEC
producers at zero adoption evidence**, with **1,757 jurisdictions where they
disagree**, and `necVersions.ts` carries its only provenance in a header comment.

**Root cause.** `labelOf` consulted the edition SOURCE only when the edition was
null, to choose between two wordings for "unknown". A present edition printed
bare — so an unprovenanced state-table year rendered *identically* to one
retrieved from the AHJ with a citation and a source hash. The projection already
held the discriminator; it never used it on the branch that mattered.

| source | renders | why |
|---|---|---|
| `ahj-registry-retrieval` | `NEC 2020` | real retrieval: sourcesQueried + sourceHash |
| record `verificationStatus: 'verified'` | `NEC 2020` | an ARCHIVED ADOPTION DOCUMENT |
| `state-adoption-table` | `NEC 2020 (DESIGN BASIS)` | a stated basis, not an adoption |
| `project-record-unprovenanced` | `NEC 2020 (DESIGN BASIS)` | the ex-`operator-entry` class |
| `ahj-record` | `NEC 2020 (DESIGN BASIS)` | 0 of 4,016 rows provenanced |
| ASCE `structural-engine-basis` | `ASCE 7-22` | self-describing — the engine RAN under it |

Four consumers rebuilt the strip from the raw token, printing a labelled I-code
and a raw NEC year in ONE sentence (`${_cpF.ibcLabel} • NEC ${necVer}`), and one
asserted *"the adopted edition of the National Electrical Code (NEC 2020)"* —
equating our design basis with the AHJ's adoption. All four now read the label.

**Edition SELECTION is unchanged.** Precedence is untouched, exactly as when
`project-record-unprovenanced` replaced the false `operator-entry`. What changed
is the claim made about the value, not the value.

### §5 — the fire audit could not observe its own defect (N36 `8ef694ef`)

Refreshing the fire artifacts surfaced a defect in the **instrument**. §6
compared two constants declared inside the script itself and reported *"agree
today: YES — but from TWO independent literals"*. It never read the codebase,
and both claims were already false: N29 had consolidated both call sites.

Two bugs in my own check, **both caught by mutation, neither by reading it**:

1. **Name presence is not use.** The check grepped the file for
   `resolveHipValleySetbackIn`. The IMPORT LINE contains that name, so replacing
   the call with `= 1.5` still passed.
2. **A backspace in the regex.** Through a shell heredoc, `\b` became a real
   0x08 byte, so the pattern matched nothing and the stray check reported 0
   against a literal demonstrably on line 872.

Also removed a `catch { return '' }` around the file read — it turned
"unreadable" into "call site absent", the same absent-is-passing shape.

Mutation-proven: clean `3/3, 0 strays, SINGLE PRODUCER` → mutated `2/3, 1 stray,
DIVERGENCE` → reverted `3/3, 0 strays, SINGLE PRODUCER`.

---

## Product state (measured, not asserted)

| fact | value |
|---|---|
| pathway printed vs drawn, disagreements | **0 of 4,016** (was 502 before N28) |
| ridge / valley / hip / eave | national constants in jurisdiction-shaped columns |
| `roofSetbackInches` | `UNPROVENANCED_LEGACY` — varies, 0/4,016 with evidence |
| material false-attribution phrases rendered | **0** |
| honest classifications rendered | 48 MODELED, 59 SOLARPRO_POLICY |
| tagged editions asserting with no disclosed basis | **0** |

The 9 remaining bare `NEC 2020` strings are genuine citation/calc-basis contexts
(`CALC BASIS`, `Analysis basis`, `evaluated against`, `PER NEC 2020 ARTICLE
690`). None asserts an adoption; qualifying every citation would be noise.

## Verification

- digest `8d7fcfa38d9a25ef8775e398` **unchanged** (route-parity harness). The
  earlier `424f3576…` reading was the harness run WITHOUT `--as-route`, i.e. a
  different scenario, not drift.
- suite **10,617 passing**, same 4 pre-existing failures (3 golden-path CAD,
  1 distributor pricing). `tsc` clean. `npm run build` succeeds.
- 21 sheets rendered under print media; `.tb-codes` overflow **0 of 21**, wraps
  to 3 lines inside its box, visually confirmed on PV-0.

## Still open

- §3 ridge/valley/eave producer-consumer sweep (census done; classification
  stands, no behavioural divergence to quantify)
- N4 discovery executor · N6 route-level integration test · N7 digest versioning
  · N8 canonical-AHJ cutover · N21 scope-aware `AhjRecord`
- `evaluator.ts:246` generic-setback `?? 18` default, which contradicts its own
  column (36 × 3,514 / 18 × 502)
