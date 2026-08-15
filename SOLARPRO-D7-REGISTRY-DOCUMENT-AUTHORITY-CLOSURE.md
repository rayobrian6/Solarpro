# SOLARPRO — D7 REGISTRY DOCUMENT AUTHORITY AND PRECEDENCE

**Scope:** D7 only. **Date:** 2026-08-05 · **Branch:** `dev` · **Baseline HEAD:** `34bc84cb`

---

## 1. EXECUTIVE VERDICT

### `D7 SOURCE COMPLETE — LIVE DATA SECURITY BLOCKED`

The canonical document object is now present in the consumer's input, the four-tier precedence is implemented, and — the point of the whole exercise — **identity, custody and applicability always describe the same document.**

Live Braidon now selects `doc-rooftech-rtmini-install-manual-2f6035586e94`, the **version-exact RT-MINI** document, with *its own* title and *its own* hash, as a **`REGISTRY_CANDIDATE`** — visible and citable, and explicitly **not authoritative**, because it is `unverified`.

Braidon is unchanged at **12 unresolved / 5 gates**, correctly: making the right document visible is not the same as verifying it. All seven prior repairs and D4 are preserved.

---

## 2. THE DEFECT, AS IT ACTUALLY STOOD (live, before the change)

`buildEquipmentDocumentAuthority` received registry **facts** (archive state, hash, status) but never registry document **identity**. It resolved the static `manufacturer_assets` entry for the equipment, then attached whatever facts sat under the same `category:equipmentId` key.

Those are two different documents whenever the asset and the registry disagree — and on live Braidon they did:

```
entry.documentTitle    "Roof Tech RT-MINI II Installation Manual (Jun 2025)"   ← static asset
entry.sourceUrl        …/Installation-Manual-RT-MINI-II.pdf                    ← static asset
registryFacts.sha256   2f6035586e948758ff1892f2775a1a69…                       ← RT-MINI manual
registryFactsPresent   true
```

That SHA-256 belongs to `doc-rooftech-rtmini-install-manual-2f6035586e94`, the **RT-MINI** document. One object asserted that the RT-MINI **II** manual has the RT-MINI manual's hash. A citation built from `documentTitle` + `sha256` would have been false in a way no reader could detect.

**This was not a precedence `if`.** The canonical document was absent from the consumer's input entirely, so the version-exact RT-MINI manual was structurally invisible while the II asset spoke for it.

### The existing guard could not catch it

`structuralResolvers.ts` already refused to hand a non-version-exact document's facts to an asset:

```ts
// Only the VERSION-EXACT document may supply facts for this asset …
if (!a.coversSelectedModel) continue;
```

That guard is correct and is retained. It checks that the **document** covers the selected model. It cannot check that the **asset the facts are being attached to** is the same document — which is exactly the gap. The RT-MINI manual legitimately covers RT-MINI, so its facts were attached to `racking_detail:rooftech-mini`, whose static asset is the II manual. A comment recording this now sits beside the guard.

---

## 3. THE REPAIR

### `RegistryDocumentIdentity` — a document as the registry records it

Nineteen fields: `documentId`, `documentClass`, `manufacturerOrIssuer`, `equipmentId`, **`equipmentModelApplicability`** (the field that keeps RT-MINI and RT-MINI II apart), `title`, `revision`, `documentDate`, `sourceUrl`, `archivedFileIdentity`, `archivedInRepo`, `sha256`, `status`, `verificationState`, `verificationActor`, `verificationActorKind`, `verificationBasis`, `jurisdictionAuthorityId` (the D4 binding), `jurisdictionBoundary`. Every field describes **one row**.

### `selectEquipmentDocument` — the precedence, pure and total

| Tier | Condition | Authoritative |
|---|---|---|
| `REGISTRY_AUTHORITY` | verified + current + archived + hashed + **product-exact** | **yes** |
| `REGISTRY_CANDIDATE` | archived + hashed, not withdrawn, not yet authoritative | no |
| `STATIC_ASSET` | the legacy render cache | no |
| `UNAVAILABLE` | nothing on file — stated, not implied by nulls | no |

Product-exact candidates rank ahead of non-exact ones, so the closest real document is the one cited. A candidate is preferred over a static asset even when not product-exact: a hashed row of record is more honest than an unhashed asset. What it is *not* is authoritative, and `coversSelectedModelExactly` reports the difference.

### `SelectedDocumentAuthority` — one document, whole

`entry.selectedDocument` carries the selection with a `selectionReason` a reviewer can act on. The legacy `assetId` / `documentTitle` / `sourceUrl` fields are **retained** so no consumer breaks; they describe the *asset*, which is not necessarily the document of record. Anything citing a document reads `selectedDocument`.

### Facts may only describe the selected document

```ts
const factsForSelection =
  selected.tier === 'REGISTRY_AUTHORITY' || selected.tier === 'REGISTRY_CANDIDATE'
    ? { archivedInRepo: selected.archivedInRepo, sha256: selected.sha256, status: selected.status }
    : (candidates && candidates.length ? null : facts);
```

When a registry document wins, its **own** custody is used. When the static asset wins, there is no custody to report and `null` is the honest answer — **an asset has no hash.** A static asset can no longer inherit another document's `documentId`, `sha256`, archive state, verification or applicability.

### Producer

`racking-documents@v1` now emits `documentRegistryIdentities` alongside `documentRegistryFacts`, reading each archived row back through `getDocument` for its registry-recorded identity. Unlike facts, identities are **not** filtered by `coversSelectedModel`: a document covering a different product is a real, citable candidate, and hiding it is what left the version-exact manual invisible.

Threaded through `resolution/types.ts` → `lifecycle.ts` (null seed) → `build.ts` → `generatePermit.ts` → `buildEquipmentDocumentAuthority`.

---

## 4. LIVE BRAIDON RESULT (read-only)

```
racking_detail:rooftech-mini
  selectedDocument.tier            REGISTRY_CANDIDATE
  selectedDocument.authoritative   false
  selectedDocument.documentId      doc-rooftech-rtmini-install-manual-2f6035586e94
  selectedDocument.title           Roof Tech RT-MINI Installation Manual (Jan 2021)
  selectedDocument.sha256          2f6035586e948758ff18…
  selectedDocument.documentProduct RT-MINI          coversSelectedModelExactly = true
  selectedDocument.verificationState  unverified
  selectionReason  archived registry document, NOT authoritative — verification is
                   'unverified', not 'verified'
```

**The version-exact RT-MINI manual is now the selection, with its own title beside its own hash.** The RT-MINI II asset no longer speaks for it.

`module_spec` and `inverter_spec` correctly report `STATIC_ASSET`, `sha256: null`, `authoritative: false`, with the honest reason that no registry document is on file. Both also report `coversSelectedModelExactly: false` — `"Q.PEAK DUO 400W"` is not `"Q.PEAK DUO BLK ML-G10+ 400W"`, and `"IQ8A Microinverter (IQ8A-72-2-US)"` is not `"IQ8A"`. That is D8's territory and was left alone; the legacy `applicability` verdict is unchanged.

---

## 5. TWELVE-REQUIREMENT AND GATE STATE

**Before: 12 / 5. After: 12 / 5. Closed: none. Opened: none.** Sheets 19 / 18 / 25.

`EQUIPMENT-DOCUMENT-APPLICABILITY` and `FASTENER-ASSEMBLY-UNVERIFIED` remain open, correctly: the version-exact document is now *selected and visible*, but it is `unverified`, so it is a candidate. Closing them needs a verification act, which needs a DB write, which needs rotation — and D4's jurisdiction correction must land first or the clearance still fails.

## 6. DIGEST AND BYTE PROOFS — the repair is NOT digest-neutral, and both were run

The digest moved: `935bd313f601…` → `a5c8364c8c58…` (full). Correctly — the *selected document identity* is a material design fact and now rides the snapshot.

```
A digest = B digest = a5c8364c8c58c6c9e05cd031dd6adf88e961815ad0622fb87f2d6c7538da7d67
DIGEST STABLE        = true
HTML byte-identical  = true
run-instants still moving in the snapshot = 28   (D9 preserved)
```

## 7. MIGRATIONS, WRITES, ROWS

**No migration created. No migration applied. No database write.** All four registry rows untouched; the three Roof Tech rows remain `unverified`. Read-only sessions pinned and verified throughout. Credential still unrotated — verified by fingerprint comparison, never printed.

## 8. TESTS, TYPESCRIPT, BUILD

| Gate | Baseline | Result |
|---|---|---|
| Preservation set (7 repairs + D4) | 27 files / 592 | **28 files / 612 tests pass** |
| Full suite | 431 files / 9812 | **432 files / 9832 tests pass · 17 skipped · 0 FAILURES** |
| TypeScript | clean | **clean** (exit 0) |
| Production build | ✓ | **✓ Compiled successfully · 91/91 static pages · exit 0** |

**New:** `tests/planset/r7-d7-registry-document-precedence.test.ts` — 20 tests covering all four tiers, the RT-MINI/RT-MINI II distinction, the identity-custody invariant (including the exact live shape as a regression), independence of authenticity from applicability, withdrawn/unhashed rejection, and determinism.

**One existing fixture updated:** `snapshot-w1.test.ts` hand-builds an `equipmentDocumentAuthority` region and needed the new `registryDocuments: {}` key. No assertion changed.

## 9. COMMIT, PUSH, PARITY

| | |
|---|---|
| Baseline HEAD | `34bc84cb` |
| **Code commit** | **`fd7c3716`** — *Select a document whole: identity, custody and applicability must describe the same row* |
| Report-only commits | `55117875`, plus the follow-up carrying this corrected table |
| Push | `34bc84cb..fd7c3716  dev -> dev` → `github.com/rayobrian6/Solarpro` |
| `origin/dev` after fetch | matches local HEAD, **0 ahead / 0 behind** |
| Committed-secret guard | 12/12 pass |

**Not committed:** all `_tmp_*` scratch and harness output (untracked; they read `.db_url` at runtime and embed no secret) and `next-env.d.ts` (build artifact, restored).

> A scripted edit wrote this table with the shell stripping every backticked value, leaving the hashes blank. Corrected here; the commit hashes above are the accurate record.

## 10. REMAINING DEFECTS

| Defect | Requirement | Location | Next action |
|---|---|---|---|
| **D8** | #2 | `equipmentProjection.ts:212-257`; `datasheetBinding.ts:129-136` | One evaluator; registry facts + page/table/column evidence; no vacuous `allBound`. **The `coversSelectedModelExactly: false` now visible on the module entry is the same fact from a different angle.** |
| **D11** | release authority | `fieldMeasurement/production.ts`; `reconciliation/reconcile.ts` | Server-side prior-snapshot reader; record the **pre-change** digest |
| **D12** | #4 | `SelectedEquipment`, `railSelection.ts`, `structuralBom.ts` | Migration + service + API + UI; fix the phantom `storedRecord` cast |
| **D13** | none | `codeAuthority.editions.asce` vs `structural.env.codeAuthority` | One projected ASCE identity |
| **D14** | none | `meta.generatedAtIso`, `registry[].createdAtIso` | Separate issue date from generation instant |

**Plus the blocked data acts:** rotate → apply migration 119 → correct the four rows' jurisdiction → *then* verify the RT-MINI manual. In that order; verifying before the jurisdiction correction still fails the clearance.

---

## STATUS

### `D7 SOURCE COMPLETE — LIVE DATA SECURITY BLOCKED`

*No database write was performed. No requirement was closed. No document was verified, and no document's identity, hash, verification or applicability was inherited from another.*
