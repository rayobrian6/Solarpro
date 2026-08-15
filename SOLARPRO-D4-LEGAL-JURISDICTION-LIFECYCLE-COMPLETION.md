# SOLARPRO — D4 LEGAL-JURISDICTION LIFECYCLE COMPLETION

**Scope:** D4 only. **Date:** 2026-08-05 · **Branch:** `dev` · **Baseline HEAD:** `d56b5377`

---

## 1. EXECUTIVE VERDICT

### `D4 SOURCE COMPLETE — LIVE DATA SECURITY BLOCKED`

The discarded-patch defect and the dependency-graph defect are both repaired, and the complete legal-AHJ chain is now proven end to end **against the real resolver lifecycle** — not a hand-built bundle, which is exactly what would have hidden this.

**Live Braidon now resolves `verified` legitimately**, from a genuine US Census Geocoder boundary determination, with `project-authority@v1` provenance.

Live data correction remains blocked: the credential is unrotated, so migration 119 is not applied and the four registry rows are untouched. All seven prior repairs are preserved. Braidon is unchanged at **12 unresolved / 5 open gates**.

> **The defect was worse than diagnosed.** The brief described the symptom as the right AHJ with the wrong provenance. The failing regression test showed more: with a genuinely Granite-City-posted record, the derived resolver returns **`il-madison-granite-city`** — the *wrong authority entirely*. Live only looked correct because the stored `permit_input.json` already carried a corrected `ahjRecordId` from an earlier run. The verified value was being discarded either way; the live symptom simply happened to be benign.

---

## 2. REPOSITORY BASELINE

| Item | Value |
|---|---|
| Repository | `C:/Users/Ray/Solarpro Claude/repo` |
| Branch | `dev` |
| HEAD at start | `d56b5377` |
| `origin/dev` at start | `d56b5377` — **0 ahead / 0 behind** |
| Tracked changes at start | **none** |
| Permit engine | 47500 |

## 3. SECURITY STATUS

**Credential: NOT ROTATED.** Verified by fingerprint comparison using the repository's own algorithm; no credential, connection string or fingerprint value appears in this report. `.db_url` carries a UTF-8 BOM and every probe strips it and matches the scheme position-independently.

**No database write of any kind was performed.** Read-only sessions were pinned with `default_transaction_read_only = on` and verified with `SHOW` before querying. Migration 119 not applied; no row corrected; no document verified; no designer, rail, measurement or review created.

---

## 4. THE DISCARDED-PATCH DEFECT (confirmed independently)

`lib/permit/snapshot/resolution/lifecycle.ts` applies **only declared keys**:

```ts
for (const k of r.produces) {
  if (!(k in outcome.patch)) continue;
  const next = outcome.patch[k];
  if (!sameValue(before[k], next)) changedKeys.push(k);
  bag[k] = next;
}
```

`project-authority@v1` declared `produces: ['projectLegalAuthority']` while its outcome patch contained `{ projectLegalAuthority, legalJurisdiction }`. The verified boundary determination was therefore dropped on **every run**, with no error, no warning and no evidence anywhere. The bundle kept the derived value from `project-authority-key@v1` — and because the archival gate requires `verified`, no document could ever be archived under the correct authority.

### Survey of every production resolver

Before enabling any global enforcement I checked whether other resolvers had the same shape:

| Resolver | Verdict |
|---|---|
| `project-authority@v1` | **⚠ VIOLATION — `legalJurisdiction`** (the D4 bug) |
| `engineering-review-record@v1` | *false positive* — `reviewerName`, `reviewerLicense`, `licenseState`, `approvedAtIso` are fields of the **nested** `framingEngineerReview` object, which *is* declared. My first-pass regex broke at the first `}`; verified by reading the source. |
| All 14 others | clean |

**Exactly one genuine violation across the entire resolver set**, which is what made global enforcement safe rather than test-only.

## 5. THE DEPENDENCY-GRAPH DEFECT

`racking-documents@v1` declared `requiredInputs: ['projectJurisdiction', 'capacityDocument']` while its archival step consumed `ctx.authority.legalJurisdiction`. Two consequences: a change to the real legal jurisdiction did not re-dirty the document resolver, and the stale mailing-derived value still looked like a legitimate archival input.

---

## 6–7. SOURCE AND LIFECYCLE-CONTRACT REPAIR

**`project-authority@v1`** → `produces: ['projectLegalAuthority', 'legalJurisdiction']`.

All outcome paths were inspected. The three that construct the record (verified boundary · confirmation-required conflict · partially-unverified retrieval) all patch `legalJurisdiction`. The two early-exit paths — **no provider injected** and **retrieval failed** — deliberately do **not** patch it, and that is the correct posture: this resolver could not determine a boundary, so it must not speak. Because the lifecycle skips keys absent from the patch (`if (!(k in outcome.patch)) continue`), omitting it leaves the derived value intact. Patching `null` there would destroy a usable (if unverified) authority and leave the name-comparison fallback with nothing to compare.

**`racking-documents@v1`** → `requiredInputs: ['legalJurisdiction', 'capacityDocument']`. `projectJurisdiction` is **not** retained here: it has no non-archival use in this resolver, and keeping it would leave precisely the hidden fallback D4 exists to remove.

**The surgical archival guard is preserved unchanged.** Retrieval proceeds without a legal jurisdiction; attempt, hash and soft-404 evidence are all preserved; only the archival write is refused, with `archival.attempted === false` and a named reason.

**Stable-identity comparison preserved.** `ahjRecordId` governs when both sides carry one; the normalised name path survives only for pre-119 rows.

**Mailing city preserved separately.** `mailingCity: 'GRANITE CITY'` on the authority; `projectJurisdiction` retains the posted mailing-derived string for compatibility, and is no longer an archival dependency.

## 10. UNDECLARED-PATCH-KEY PROTECTION

Added at the lifecycle seam itself (`lifecycle.ts`), not test-only. Every key present in an outcome patch but absent from `produces` is recorded as a resolver-contract violation and merged into `outcome.invariantViolations`:

```
resolver <id>: patched undeclared bundle key '<k>' — it was DISCARDED.
Add it to this resolver's `produces` declaration.
```

Dropping remains the correct *behaviour* — `produces` is the dependency graph, and honouring an undeclared write would corrupt it. What changed is that the drop is now **reported**. Backed by a test that runs every production resolver and asserts zero violations — the assertion that would have caught this bug on the day it shipped.

---

## 8–9. LIFECYCLE PROOFS — `tests/planset/r7-d4-lifecycle-propagation.test.ts` (10 tests)

Written **before** the fix and confirmed failing on all seven substantive assertions. Fixture: posted record says `City of Granite City Building & Zoning` with the stale `ahjId: 'il-icc'`; the Census fixture returns no incorporated place and `unincorporated: true`.

**Positive — the verified value survives the handoff**
- bundle carries `il-madison-county` / `Madison County Building & Zoning` / `county` / `unincorporated: true` / `mailingCity: GRANITE CITY` / `verified`
- **provenance is `project-authority@v1`, not `project-authority-key@v1`** — the assertion that distinguishes a boundary determination from a table lookup. Asserting ids alone would prove nothing, because the derived resolver can produce the same ids.
- posted `projectJurisdiction` is retained and is *not* the legal authority

**Document resolver**
- archival identity is `il-madison-county` / `Madison County Building & Zoning`
- fails if it were `il-icc`, `il-madison-granite-city`, any Granite City name, or an unverified authority
- `racking-documents@v1` **declares** `legalJurisdiction` and no longer declares `projectJurisdiction`
- `project-authority@v1` **declares** `legalJurisdiction`

**Negative — retrieval survives, archival does not** (no property provider)
- retrieval runs; every attempt carries an address and a verdict; at least one genuine `RETRIEVED` with a SHA-256
- `archival.attempted === false`, `documentId` null, failure matches `ARCHIVAL REFUSED`, operator action names the legal AHJ
- the bundle is **not** falsely upgraded — stays unverified, provenance `project-authority-key@v1`

**Dependency rerun** is proven by declaration rather than by source ordering: `requiredInputs` contains `legalJurisdiction`, so the lifecycle re-dirties the document resolver when it changes.

## 11. MIGRATION 119

**Unmodified and NOT applied.** The source audit found it complete for this phase's needs. No backfill, no row correction, no verification-state change.

## 12. LIVE BRAIDON LEGAL-JURISDICTION OUTPUT (read-only)

```
ahjRecordId        il-madison-county
ahjName            Madison County Building & Zoning
jurisdictionType   county
stateCode          IL
county             Madison County
unincorporated     true
mailingCity        GRANITE CITY
verificationState  verified
provenance.source  project-authority@v1
provenance.ref     authority:project-legal#38fb560e070167c8
provenance.basis   US Census Geocoder matched the address and returned NO incorporated place,
                   only the minor civil division "Nameoki township" — the parcel is
                   UNINCORPORATED and the COUNTY is the building AHJ of record, regardless of
                   the mailing city on the address.

projectJurisdiction  "City of Granite City Building & Zoning"   ← retained, no longer archival
```

`verified` is reported because the real resolver contract legitimately established it: a live boundary determination from an official source, not a forced state. The property-identity provider was available all along — the verified value was simply being discarded before it reached the bundle.

## 13. EXISTING REGISTRY ROWS

**Untouched.** All four still carry `jurisdiction_boundary = 'City of Granite City Building & Zoning'`; the three Roof Tech rows remain `unverified`. Correcting them is a governed data act blocked on rotation.

## 14–15. TWELVE-REQUIREMENT AND GATE STATE

**Before: 12 unresolved / 5 gates. After: 12 unresolved / 5 gates. Closed: none. Opened: none.**

All twelve unchanged: `CODE-AUTHORITY-INCOMPLETE`, `MODULE-EXACT-DATASHEET-PENDING`, `FRAMING-AUTHORITY-UNVERIFIED`, `PENDING-RACKING-ASSEMBLY-SELECTION`, `FASTENER-ASSEMBLY-UNVERIFIED`, `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP`, `EQUIPMENT-DOCUMENT-APPLICABILITY`, `ROUTE-LENGTH-ESTIMATE`, `TAP-CONDUCTOR-LENGTH-PENDING`, `DESIGNER-OF-RECORD-MISSING`, `ENGINEERING-REVIEW-PENDING`. Gates RG-1:1 · RG-2:1 · RG-4:6 · RG-5:2 · RG-7:2. Sheets 19 / 18 / 25.

This repair closes nothing, and should not: it makes the correct authority *reachable*; the requirements need data writes and external acts.

---

## DIGEST AND BYTE PROOFS — **the repair is NOT digest-neutral, and both were run**

The digest **moved**: `08f2e90703d5…` → `935bd313f601…` (full).

**Why, precisely.** `legalJurisdiction` reaches the snapshot only as a recorded-input *key* inside `permitReadiness.registry[].payload.resolutionEvidence[].inputs` (stringified `"[object]"`). The digest moved because `racking-documents@v1`'s declared `requiredInputs` changed from `projectJurisdiction` to `legalJurisdiction`, and the resolver's recorded inputs are part of the design record. That is a legitimate, material change to the dependency contract — and it is deterministic: no timestamp or wall-clock value rides along.

Two live passes with real wall-clock separation:

```
A digest = B digest = 935bd313f601d9518e551b10a0e89b669aafeb025938f67ead6e4ea424969df7
DIGEST STABLE            = true
HTML byte-identical      = true
run-instants still moving in the snapshot = 28   (D9 preserved — audit data intact, artifact clean)
```

## 16–17. PRESERVATION AND NEW TESTS

Focused set of 27 files (the seven-repair set + both D4 suites):

```
Test Files  27 passed (27)      Tests  592 passed (592)
```

D1 · D2 · D3 · D5 · D6 · D9 · D10 all green. Resolver-lifecycle, jurisdiction-resolver and racking-document-retrieval suites all green.

New: `r7-d4-lifecycle-propagation.test.ts` (10 tests) alongside the existing `r7-d4-legal-jurisdiction.test.ts` (11 evaluator tests).

> **One existing assertion was updated.** `aac-ws3-ws4-ahj-environmental.test.ts` asserted `projectAuthorityResolver.produces` **exactly equals** `['projectLegalAuthority']` — it pinned the defective declaration. It now asserts `['projectLegalAuthority', 'legalJurisdiction']`, with a comment recording why. This is the only existing test touched.

## 18–20. GATES

| Gate | Baseline | Result |
|---|---|---|
| Full suite | 430 files / 9802 tests | **431 files / 9812 tests pass · 17 skipped · 0 FAILURES** |
| TypeScript | clean | **clean** (exit 0) |
| Production build | ✓ | **✓ Compiled successfully · 91/91 static pages · exit 0** |

## 21–23. COMMIT, PUSH, PARITY

| | |
|---|---|
| Baseline HEAD | `d56b5377` |
| **Code commit** | **`634a1bc5`** — *Declare what you patch: the verified legal jurisdiction was being discarded by the lifecycle* |
| Report-only follow-up | recorded below |
| Push | `d56b5377..634a1bc5  dev -> dev` → `github.com/rayobrian6/Solarpro` |
| HEAD after fetch | `634a1bc5` |
| `origin/dev` after fetch | `634a1bc5` |
| Divergence | **0 ahead / 0 behind — `HEAD == origin/dev`** |
| Committed-secret guard | 12/12 pass |

**Code commits across the D4 work:** `7afade1c` (canonical authority + archival gate + migration 119) and `634a1bc5` (this lifecycle completion). **Report-only:** `95ec7133`, `d56b5377`, and the follow-up recording these hashes.

**Not committed:** all `_tmp_*` scratch and harness output (untracked, no embedded secret) and `next-env.d.ts` (build artifact, restored).

## 24. EXACT REMAINING DEFECTS

Untouched this phase, as instructed:

| Defect | Requirement | Location | Next action |
|---|---|---|---|
| **D7** | #5, #8 | `documentAuthority.ts` `buildEquipmentDocumentAuthority` | Pass full registry document identity as a 4th parameter; four-tier precedence |
| **D8** | #2 | `equipmentProjection.ts:212-257`; `datasheetBinding.ts:129-136` | One evaluator; registry facts + page/table/column evidence; no vacuous `allBound` |
| **D11** | release authority | `fieldMeasurement/production.ts`; `reconciliation/reconcile.ts` | One server-side prior-snapshot reader; record the **pre-change** digest |
| **D12** | #4 | `SelectedEquipment`, `railSelection.ts`, `structuralBom.ts` | Migration + service + API + UI; fix the phantom `storedRecord` cast |
| **D13** | none | `codeAuthority.editions.asce` vs `structural.env.codeAuthority` | One projected ASCE identity |
| **D14** | none | `meta.generatedAtIso`, `registry[].createdAtIso` | Separate issue date from generation instant; remove the `new Date()` fallback |

**Plus D4's data half, still blocked:** rotate → apply 119 → correct the four rows transactionally with before/after capture. **Do this before spending any document-verification act.**

---

## STATUS

### `D4 SOURCE COMPLETE — LIVE DATA SECURITY BLOCKED`

*No database write was performed. No requirement was closed. No code edition, route measurement, tap length, designer, document evidence, rail selection or PE approval was fabricated. The `verified` state was established by a real boundary determination, not forced.*
