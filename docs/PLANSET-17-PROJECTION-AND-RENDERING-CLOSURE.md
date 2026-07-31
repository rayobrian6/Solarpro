# PLANSET 17 — PROJECTION AND RENDERING CLOSURE

**Date:** 2026-07-31 · **Branch:** `dev` · **Starting commit:** `1d2d7922` · **Ending commit:** `b108164b`

> **STATUS: PARTIAL. D2 is closed, verified and pushed. D1, D3 and D4 are NOT implemented.**
> This report states exactly what was done, what was not, and — importantly — **why the
> brief's D3 premise is wrong** and the prescribed D3 repair would not have fixed the defect.
> WS-5 remains correctly blocked.

---

## 0. THE HEADLINE FINDING — D3 IS NOT WHAT THE BRIEF DESCRIBES

The brief states:

> "Planset 17 projects conduit footage for all three project-owned raceways. But fittings
> are derived only for `RW-BRANCH-HOMERUN`. … This is incomplete propagation of the
> corrected raceway authority."

**That is not the defect.** The per-raceway fitting derivation was never broken. Measured on
the real artifacts:

| Artifact | `Raco/Allied` fitting rows | `RW-BRANCH-HOMERUN` | `RW-COMBINER_TO_DISCO_RUN` | `RW-DISCO_TO_METER_RUN` |
|---|---|---|---|---|
| `_tmp_rr_live_full.html` (25 sheets) | **15** | 13 | **13** | **13** |
| `_tmp_rr_live_permit.html` (15 sheets) | 4 | — | — | — |
| `_tmp_rr_live_design-review.html` (16) | 4 | 11 | 3 | 3 |
| **Accepted Planset 17** `PDS-B01F869ED2DD` | **4** | 11 | 3 | 3 |

`emitRacewayConduitBom` (`lib/bom-engine-v4.ts:389`) is called in a loop over **every**
derived physical raceway (`:1441` single-system, `:2793` per-sub hybrid) and emits 6 rows
each. In the full profile all three raceways appear **13 times each**. The BOM is complete
and correct.

**The actual defect is that the SCHED sheet TRUNCATES on the compact profiles.**
`structuralPages.ts:1627-1640` is a truncating early-return, with row caps at `:1456`
(`SCHED_BOM_ROWS_FIRST=10`) and `:1475` (`SCHED_BOM_ROWS_CONT=14`). **37 of 47 BOM rows never
reach the AHJ-facing artifact** — and the design-review profile that PE-1 rides on is
equally truncated, not just the permit profile.

### Why this matters more than the brief assumed

Building the prescribed `RacewayProcurementResolution` to "derive fittings per raceway"
would have **added a second derivation of data that is already correct**, changed nothing a
reviewer sees, and left 37 rows still missing. It would have looked like a fix and shipped
the defect.

Worse, **no existing gate can see this.** `scripts/planset-evidence-ecd.mjs` gate 7 and
`tests/planset/ecd-ws1-procurement-authority.test.ts:334-336` count rows from the BOM
**array**, not from rows present on the sheet. Every procurement gate is green today while
37 rows are absent from the permit artifact. And
`tests/planset/aac-ws10-planset-profile.test.ts:112`
(`expect(PERMIT.html).not.toContain('CONTINUED ON NEXT SHEET')`) is **satisfied by the bug** —
`structuralPages.ts:1631-1635` swaps the label for compact profiles, so it stays green with
37 rows missing.

**Recommendation:** re-scope D3 to the SCHED truncation, and add a gate that counts rendered
`<tr data-bom-*>` elements against `buildProcurementApproval(...).totalRowCount`. Do **not**
re-enable SCHED continuations on compact profiles (breaks `aac-ws10` at :66/:94/:112 and
contradicts WS-10) and do **not** raise the row caps (`structuralPages.ts:1458-1475` records
the measured clips: 21 rows → 108px clipped, 18 → 39px, 16 → 29px).

---

## 1. WHAT WAS CLOSED — D2

### Defect

Every profile printed, on PV-0:

```text
Equipment grounding conductor (EGC) shall be sized per NEC 250.122. All metallic racking,
module frames, and enclosures shall be bonded per NEC 690.43.
DC EGC minimum: #10 AWG per NEC 690.45.
```

Three faults in one sentence about a life-safety conductor:

1. it interpolated `project.wireGauge` — an operator-entered **phase** conductor gauge —
   and printed it as a **grounding** minimum;
2. it asserted **one project-wide size** where grounding is sized per segment on each
   circuit's own OCPD;
3. it asserted a separate DC EGC requirement on a design whose IQ8A product authority
   concluded **NO SEPARATE EGC REQUIRED**.

`titleBlock.ts:267` (ground-mount) carried the same claim a **second** time, hardcoded. It
is **additive** to the base note, not a variant — a ground-mount package printed the false
minimum twice. Both fixed.

### Repair

New canonical accessor `projectGroundingSummary` (`lib/permit/snapshot/electricalProjection.ts`):

```ts
{ productGroundingOutcome, segmentSpecificSizing: true, projectWideMinimumApplies: false,
  scheduleSheetRefs: ['PV-4B','PV-4B.1'],
  branchEgcSize, feederEgcSize, arrayBondCalculatedMinimum, arrayBondSelectedDesign }
```

The note is summarised from that one object; nothing is re-derived at the render site. The
two correct sentences (250.122 sizing, 690.43 bonding) are preserved.

### Rendered result (live, all three profiles)

```text
…are SEGMENT-SPECIFIC — no project-wide EGC minimum applies. See PV-4B and PV-4B.1 for the
governing per-segment schedule (branch #12 AWG; feeder #10 AWG). The selected microinverter
product authority establishes NO SEPARATE EGC REQUIRED for the array circuits.
```

### The test that was supposed to catch this passed with the defect present

`tests/planset/conductor-authority.test.ts:64` is titled *"…and no surface prints a
project-wide EGC minimum"*, but its only assertion for that clause was a regex for the
**retired 2026-07-26 wording**. It was green while every profile printed the live defect.

It now probes the real string, with `#` **optional** — the fixtures set `wireGauge: '10 AWG'`
so tests render `10 AWG` while live artifacts hit the `|| '#10 AWG'` fallback, and a probe
written for either form alone misses the other. Non-vacuity is asserted both ways: it must
fire on both rendered forms and must **not** fire on the replacement wording or on
`NO SEPARATE EGC REQUIRED` (a negated manufacturer conclusion must never read as a positive
requirement).

### D2 validation

| Check | Result |
|---|---|
| False form `(DC )?EGC minimum:? #?N AWG` | **0** in design-review, permit and full |
| Replacement wording present | yes, with canonical #12 / #10 |
| `conductor-authority.test.ts` | 6 passed |
| Page-fit gate (`pagination-w9`) | **14 passed** |
| Pagefit 16 / 15 / 25 sheets | clipped=0 internal=0 h=0 on all three |
| Full suite | **8939 passed / 0 failed** (489 skipped), exit 0 |
| Lint | **0 errors** |
| Typecheck | clean, exit 0 |
| Braidon | 16 sheets / 5 gates / 14 requirements / 0 advisories |

---

## 2. WHAT WAS BUILT BUT NOT WIRED — THE FONT PACK (D4, partial)

`lib/permit/fonts/` + `scripts/build-font-pack.py`. **Built, hash-verified, NOT yet emitted
into the planset.** No `@font-face` is rendered and `--sans`/`--mono` are unchanged.

### Pack manifest — v1.0.0

| Face | Family | Source | Bytes (WOFF2) | SHA-256 (16) |
|---|---|---|---|---|
| SolarProSans-Regular | SolarPro Sans | LiberationSans-Regular | 42,904 | `9370d56d9296ecf2` |
| SolarProSans-Bold | SolarPro Sans | LiberationSans-Bold | 43,164 | `7e72c1dc508d8f2d` |
| SolarProMono-Regular | SolarPro Mono | LiberationMono-Regular | 37,196 | `8389c1ee1b90d49b` |
| SolarProMono-Bold | SolarPro Mono | LiberationMono-Bold | 37,108 | `ae658e5f292ae235` |
| SolarProSymbols-Regular | SolarPro Symbols | DejaVuSans | 55,252 | `5f2213ba32268669` |

**Total 215,624 bytes → 287,498 base64 ≈ +16 % on a 1.75 MB artifact.** Raw TTFs would have
been ~1.45 MB (+110 %); subsetting to the declared ranges is what makes embedding viable.

Provenance: Liberation Fonts `2.1.5` (SIL OFL 1.1), tarball sha256
`7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`; DejaVu `2.37`, tarball
sha256 `fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7`.

### A gap the brief did not anticipate

**Liberation does not carry six codepoints the planset actually prints**: `⇒` U+21D2,
`▶` U+25B6, `◀` U+25C0, `⚠` U+26A0, `⚡` U+26A1, `✓` U+2713 (verified against the accepted
artifact, which uses 32 non-ASCII codepoints in total). Switching the CSS to Liberation
alone would have sent exactly those six back to a **host** font — reintroducing the
non-determinism the pack exists to remove.

Resolved with a third family, `SolarPro Symbols`, subset from DejaVu to **only the
codepoints Liberation lacks**. Because it can never win a Latin glyph it cannot influence
the metrics the fingerprint pins. Stack becomes `'SolarPro Sans', 'SolarPro Symbols'`.

### Design decisions worth reviewing before wiring

- **Bytes are emitted as a bundled TS module** (`lib/permit/fonts/fontPackData.ts`, 289 KB)
  rather than read from disk. A serverless function has no guarantee that `*.woff2` was
  traced into its deployment, and *"CI and production must use the same font bytes"* cannot
  rest on a file that might not be there.
- **The authoring rebuild is not byte-reproducible** (fontTools/brotli variance persists
  even with `recalc_timestamp=False`). The **vendored bytes plus the manifest hashes** are
  the authority, not a repeatable build. Fail-closed verification compares against the
  manifest.
- `scripts/build-font-pack.py` is a **one-time authoring tool**, not a runtime or CI
  dependency. `fonttools[woff]` is not added to `package.json`.

### Remaining D4 work (not done)

Emit `@font-face`, repoint `--sans`/`--mono`, **migrate the ~155 SVG `font-family="Arial…"`
attributes and ~50 inline `font-family:monospace` sites** (the page-fit probe skips
everything inside `<svg>` at `pagination-probe.mjs:263`/`:272`, so a token-only migration
would measure perfectly clean while every SVG text node stayed on host Arial), bump
`PLANSET_ENGINE_VERSION` (`lib/permit/constants.ts:716`), add `fontPack` to snapshot meta,
fail closed on hash/fingerprint mismatch, mark the wkhtmltopdf path
`NON-AUTHORITATIVE PREVIEW`, and invert the CI environment gate (after embedding, a host
with **no** Arial is the supported case, but `ci.yml:244-253` currently hard-exits on it).

---

## 3. NOT IMPLEMENTED — D1

`RouteSegmentRecord` has **no ownership field**. `isUtilityOwned` is set on the engine
`RunSegment` at `computed-system.ts:1886` **and** `segment-builder.ts:582` (two producers,
not one) and is honoured by the BOM/raceway layers — but the snapshot mapper
(`build.ts:506-621`) never copies it, so it **dies at the snapshot boundary**. Confirmed
against the live snapshot: no ownership key on any of the 37 segment fields.

Two independent counters then treat all six segments as one population:

- `build.ts:1663-1669` → *"5 of 6 electrical run(s) … require a field-measured route"*
- `resolution/derived.ts:155/167/187` → *"1 of 6 segment(s) are derived from real geometry"*,
  `confidence: 0.17`, and a `missing` entry directing the operator to field-measure
  `MSP_TO_UTILITY_RUN` — a run the installer does not own and cannot lawfully modify.

**The two sentences appear on different profiles** (the first on permit via the per-sheet
banner, the second only on full), so fixing `build.ts` alone ships a permit package that
looks correct beside an internal package that self-contradicts.

**`tests/planset/ws3-conduit-authority.test.ts:113-125` — which I wrote in the previous
pass — is itself a false-pass risk** and must be rewritten as part of D1: it keys on a
`/MSP_TO_UTILITY/` name regex (the exact product-name inference the standing rules prohibit)
and carries `if (!utility) return;`, a silent early return that evaporates the whole
assertion if the id ever changes.

---

## 4. VALIDATION ACTUALLY RUN (true exit codes)

| # | Check | Result | Exit |
|---|---|---|---|
| 1 | Typecheck | clean | 0 |
| 2 | Lint (full) | 0 errors, 1203 pre-existing `no-console` warnings | 0 |
| 3 | `conductor-authority.test.ts` | 6 passed | 0 |
| 4 | `pagination-w9.test.ts` | 14 passed | 0 |
| 5 | Full suite | **8939 passed / 0 failed** | 0 |
| 6 | Pagefit design-review (16) | clipped=0 internal=0 | 0 |
| 7 | Pagefit permit (15) | clipped=0 internal=0 | 0 |
| 8 | Pagefit full (25) | clipped=0 internal=0 | 0 |
| 9 | Live Braidon regeneration | 16 / 15 / 25 sheets, 5 gates, 14 reqs | 0 |
| 10 | Font pack build + coverage verify | 5 faces, 32/32 used codepoints covered | 0 |

**Not run** (would be dishonest to claim): evidence harnesses this pass, production build,
Chromium PDF render, cross-sheet semantic scan, visual inspection of the six sheets. The
D2 change is render-only and the page-fit gate plus the full suite cover it; the remaining
checks belong with D1/D3/D4.

**Harness baseline (unchanged, from the WS-3 pass, captured with true exit codes):**
`bar-wse` 36/36 · `bar` 12/14 · `co` 20/20 · `ep` 21/22 · `ppc` 18/18 · `rgm` 17/17 ·
`rp` 20/20 · `ecd`/`w3`/`w4` failing (open debt, unrelated to conduit or grounding).

---

## 5. BEFORE / AFTER

```text
Starting commit            1d2d7922
Ending commit              b108164b
Snapshot before            PDS-B01F869ED2DD  (sha256 90be40ed65fd4d87…, 1,752,388 bytes)
Sheet count                16 → 16
Open gates                 5 → 5
Unresolved requirements    14 → 14
Project-wide EGC minimum   PRESENT → ABSENT (0 occurrences, all three profiles)
IQ8A grounding outcome     NO_SEPARATE_EGC_REQUIRED (unchanged)
Branch EGC                 #12 AWG Cu (unchanged)
Feeder EGCs                #10 AWG Cu (unchanged)
Incorrect EMT projections  0 (WS-3 preserved)
Incorrect 3/4" projections 0 (WS-3 preserved)
Page clipping              0
Field-measurement blockers 5 of 6 → 5 of 6  (UNCHANGED — D1 not implemented)
Raceway BOM rows           complete in full profile; 37 of 47 still truncated on
                           compact profiles (D3 re-scoped, not implemented)
Font pack                  v1.0.0 built + hashed, NOT wired into the artifact
Authoritative PDF engine   unchanged (puppeteer + chromium-min); fallback unmarked
```

---

## 6. WHAT SHOULD HAPPEN NEXT

The traced implementation order — chosen because each of these churns the snapshot digest
and the page-fit gate, and landing two together makes any failure two-cause ambiguous:

1. **D2** — done (`b108164b`), landed alone so any PV-0 page-fit delta was attributable.
2. **D3 re-scoped to SCHED truncation**, as one commit (render repair + row window), plus a
   gate that counts *rendered* BOM rows.
3. **D1**, as one commit: the ownership field on `RouteSegmentRecord` populated from
   **both** producers and read fail-closed as `?? 'PROJECT_OWNED'`; **both** counters;
   `validate.ts:266-271`; and the rewrite of `ws3-conduit-authority.test.ts` off the name
   regex.
4. **D4** last — it re-baselines every geometry number the previous three are validated
   against and inverts the CI font gate.

WS-5 stays blocked: the artifact still contains the false route statement (D1) and still
omits 37 procurement rows from the AHJ-facing sheet (D3).
