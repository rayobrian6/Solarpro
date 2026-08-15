# CANONICAL MODULE DOCUMENT AUTHORITY — CLOSURE

**Branch:** `dev` · **Base:** `40fc5973`

> **If a future renderer, gate, BOM exporter or API needs to know whether the
> selected module datasheet is applicable, what does it consume?**
>
> **`snapshot.moduleDocumentAuthority[<moduleModel>]`** — a frozen
> `ModuleDatasheetApplicabilityAuthority`. Read `.clears` for the verdict,
> `.state` for the five-state detail, `.basis` for the sentence to print.
> Where a snapshot is not in hand, call
> `evaluateModuleDatasheetApplicability({ selected, document })` from
> `lib/permit/snapshot/moduleDocumentAuthority.ts`. There is no second answer.

---

## 1 · Authority ownership

### Before

| Fact | Owner *before* |
|---|---|
| module applicability verdict | **four independent deciders** (below) |
| "does this document cover 400 W?" | `resolveModuleDatasheetExactness` — regex over a **static asset's marketing title** |
| "is a document bound?" | presence of `registryLookup.boundDocumentId` |
| document selection | `pickVerifiedDocument` — `equipment_model_applicability LIKE '%<model>%'` |
| DS-1 wording | DS-1, re-running the title helper with **no** binding |
| verification policy | `createDocument` (strict) **and** `setVerification` (permissive) |

**The four independent decision points:**

1. `equipmentProjection.resolveModuleDatasheetExactness()` — `WATT_SET_RE` /
   `WATT_RANGE_RE` over `asset.docTitle`; returned `EXACT` from the mere presence
   of a bound id.
2. `equipmentProjection.collectEquipmentDocumentBlockers()` — emitted
   `MODULE-EXACT-DATASHEET-PENDING` from its own reading of #1.
3. `resolution/datasheetBinding.evaluateModuleDatasheetBinding()` — re-ran #1.
4. `sections/datasheetAppendix` (DS-1) — re-ran #1 with no binding, so it could
   never see coverage and always printed *"Attach the exact 400 W datasheet"*.

Underneath all four, `pickVerifiedDocument` had `requireStructuralCapacity`,
`requireFramingCapacity` and `requireEnvironmentalHazard` gates — and **nothing
at all** for module datasheets. A verified, archived, hashed, loosely
model-matched row cleared the requirement with no proof it covered the selection.

### After

| Fact | Owner *after* |
|---|---|
| registry document identity, archived bytes, SHA-256 | document registry (`lib/documents/registry`) |
| verification actor / kind / basis | **`validateVerificationTransition`** — one policy, all callers |
| product family, equipment ids, models, variants, wattages, evidence location | **`extractedClaims.module`** (governed structured claims) |
| selected module id / model / watts | canonical equipment authority |
| **final applicability verdict** | **`evaluateModuleDatasheetApplicability`** |
| gate state, DS-1 state, BOM state, digest | **projection only** |

---

## 2 · The canonical result

`lib/permit/snapshot/moduleDocumentAuthority.ts` →
`ModuleDatasheetApplicabilityAuthority`, carrying the selected identity, the
registry row (id, class, title, SHA-256, archive/status), the governed
verification (state, actor, basis), the verdict, the covered range/wattages/
models, the evidence location, the refusals and the printable basis.

**States:** `EXACT_VARIANT` · `FAMILY_COVERED` · `NOT_COVERED` ·
`EVIDENCE_INCOMPLETE` · `NO_DOCUMENT`. **`EXACT_VARIANT` and `FAMILY_COVERED`
both clear** — a family document that explicitly includes the selection *is* the
manufacturer's source for it. The old rule that only a single-wattage PDF counted
was a requirement SolarPro invented, and it is gone.

**The nine-point clearance contract** is enforced in one function, over **one
registry row** — condition 9 ("no component borrowed from a different row") holds
structurally, because the evaluator takes a single `RegistryDocument` rather than
assembling one.

**Identity rule:** the stable catalogue id is primary; model strings are matched
by **exact normalised equality**, never substring. `familyCovered` requires the
selected model to *start with* the document's stated `productFamily`.

---

## 3 · Module claim schema

Added to `ExtractedEngineeringClaims` as `module`: manufacturer, productFamily,
equipmentIdsCovered, modelsCovered, variantsCovered, wattagesCovered,
explicitWattageRange, electricalMechanicalSpecificationsPresent, evidence
(page/table/row/column/section), applicabilityBasis.

**No migration.** `extracted_claims` is a JSON `TEXT` column (migration 113)
parsed by `parseClaims`, so the shape expanded with zero DB change — audited
before writing any SQL.

---

## 4 · Registry selection contract

`DocumentResolverCriteria` gains `selectedWatts` and
`requireModuleDatasheetCoverage`. Under that flag `pickVerifiedDocument` demands
module claims, an evidence location, electrical+mechanical specs, product/family
coverage (id → exact model → family prefix) **and** wattage coverage (list, range
or per-variant). The model substring remains a **candidate filter only**.

The resolver keeps the **whole row** — identity, hash, verification, verifier and
claims travel together into the evaluator. It is never reduced to `{ id, sha256 }`
before authority is determined.

---

## 5 · Verification policy (D5 completion)

`validateVerificationTransition` is the single owner. `createDocument` calls it;
`setVerification` calls it; the admin PATCH route supplies the governed evidence
it requires.

**The hole it closes:** `setVerification` previously required only "archived and
hashed" and took a bare `verifiedBy` string — no actor kind, no basis, no
machine-verifiable-class restriction. The entire D5 policy could be bypassed by
creating a document unverified and PATCHing it to verified. Fixing only the admin
route would have left the domain function permissive to the next caller.

`setVerification` now takes `actorKind` with **no default** — an automated caller
cannot silently claim a human verification.

**Verification ≠ applicability.** Both must pass; neither implies the other. A
test asserts exactly this on one row.

---

## 6 · Downstream consumers — all projection-only

| Consumer | Now |
|---|---|
| `moduleDatasheetBinding` | projects `applicability`; `moduleSourceIsEstablished` = `applicability.clears` |
| `snapshot.moduleDocumentAuthority` | the frozen map, same object instances as the binding rows |
| readiness registry / RG-2 | blocker emitted from the canonical verdict; `authorityPath` names it |
| DS-1 | prints `MODULE_APPLICABILITY_HEADLINE[state]`, **fails closed** when no authority is attached |
| APP-A / equipmentDocumentAuthority | unchanged path, reads the frozen snapshot region |
| BOM / procurement | keys off the requirement code, which is now canonical-derived |
| digest / approval | the authority is snapshot content, so a change moves the digest |

`resolveModuleDatasheetExactness` survives **only** to supply the static asset's
title and source URL for presentation. It can no longer clear anything: the
binding passes it `null`, and the blocker path ignores it entirely.

---

## 7 · Renderer attribute defect (separate, rendering-only)

46 call sites across 6 renderer sources emitted
`style="font-family:"SolarPro Mono","SolarPro Symbols";…"` — double quotes inside
a double-quoted attribute, so the parser closes `style` at the first inner quote.

Fixed at source: `CSS_FONT_SANS_STACK` / `CSS_FONT_MONO_STACK` /
`CSS_FONT_SYMBOLS_STACK` / `CSS_FONT_SANS_UI_STACK` in `fonts/fontPack.ts` spell
the families with **single** quotes. All 50 occurrences replaced (46 + 4 in a
7th file found by the sweep). One replacement landed in a single-quoted string
where `${…}` would have emitted literally — caught and converted to a template
literal.

`MALFORMED_STYLE_FONT_FAMILY_RE` is exported so the regression test and any
future audit share one definition. The test proves the detector catches the
shipped defect, that generated HTML is clean, and that **no renderer source can
re-introduce the construction**.

---

## 8 · Tests added

`tests/planset/cmda-module-document-authority.test.ts` — **23 tests**
(§A weak evidence 1,2,3,4,4b,4c,7,8,9 · §B coverage 5,5b,6 + selection ·
§C verification 10,10b,10c + verification≠applicability ·
§D projection 11,12,13,13b,13c,14).

`tests/planset/cmda-renderer-attribute-quoting.test.ts` — **5 tests**.

**Existing tests updated, not weakened** — 13 failures across 4 files, every one
encoding the old `boundDocumentId ⇒ cleared` contract:

- `r7-d8-…` — fixtures now carry the canonical verdict; **added** `BOUND_ID_ONLY`
  proving the D8-era shape no longer clears. Wording assertions re-pointed to the
  canonical text and given a negative assertion that the title-derived family
  wording is gone.
- `aac-ws2-…` — offline now yields `NO-DOCUMENT` (was `RANGE-COVERED`, derived
  from a title with no document behind it); the clearing seam now supplies a
  fully governed row.
- `equipment-document-authority-w5` — DS-1 banner assertions re-pointed; **added**
  a negative assertion that DS-1 never demands a wattage-exact PDF.
- `prr-release-reachability` — `completeAuthority()` fixture states the canonical
  verdict.

**One real gap found while doing it:** DS-1 with no attached authority rendered
*clean*, presenting a generic sheet with no caveat. It now fails closed.

---

## 9 · Verification

| gate | result |
|---|---|
| new targeted tests | **28 / 28 pass** (23 + 5) |
| full suite | **443 files, 9992 tests pass**, 17 files / 490 skipped, **0 failed**, exit 0 |
| `npx tsc --noEmit` | **exit 0** |
| production build | first run crashed (`worker exited with code 3221226505`) — the known post-suite worker exhaustion; **clean rerun exit 0**. Both reported. |

---

## 10 · Braidon after a future governed Q CELLS record

Today Braidon has **no** governed `module_datasheet` row, so the canonical state
is `NO_DOCUMENT`, `MODULE-EXACT-DATASHEET-PENDING` stays open, and DS-1 prints
*"NO GOVERNED MODULE DATASHEET ON FILE"*. The false *"Attach the exact 400 W
datasheet"* wording is gone.

Once an operator registers the official Q CELLS Q.PEAK DUO BLK ML-G10+
385–405 W datasheet, verifies it through the governed policy, and records module
claims covering 400 W with an evidence location, Braidon will show
**`FAMILY_COVERED`** — the requirement clears, RG-2 reflects closure, DS-1 prints
*"OFFICIAL MODULE DATASHEET — FAMILY COVERAGE VERIFIED · Verified coverage:
385–405 W"*, the BOM module row becomes orderable, and the digest moves once.
This is proven end-to-end by §D tests 11 and 12 against a controlled fixture.

---

## 11 · Remaining live-data actions (none taken here)

1. **Create + verify the real Q CELLS registry row** — archive the PDF with its
   SHA-256, verify it through the governed policy (human actor + basis), and
   record the module claims. Not done: this phase changed no live data.
2. **Backfill module claims** for any other `module_datasheet` rows — without
   them those modules read `EVIDENCE_INCOMPLETE`, which is correct and honest.
3. Braidon selected equipment, rail, designer, measurements and engineering
   approval are all **unchanged**.

## 12 · Remaining risks

1. **Digests move once** — `moduleDocumentAuthority` is new snapshot content and
   the blocker wording changed. No test pinned an absolute digest.
2. **`electricalMechanicalSpecificationsPresent` is an operator assertion.** It is
   required, recorded and auditable, but the engine cannot verify it from bytes.
3. **`requireModuleDatasheetCoverage` is opt-in per call site.** `module-datasheet-
   binding@v1` passes it; a future caller that omits it gets the legacy
   candidate-filter behaviour. The canonical evaluator still refuses, so the
   verdict stays correct — but the SQL pre-filter would be looser.
4. **Family-prefix matching is a string prefix.** A document whose stated family
   is a prefix of an unrelated model would pass that one condition; wattage
   coverage and the evidence requirements still have to pass independently.
