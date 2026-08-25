# AUDIT REPORT — BRAIDON M PILLA (micro / Enphase IQ8A / 31 Qcells)
Repo `C:\Users\Ray\Solarpro Claude\repo` · HEAD · read-only pass · 2026-08-24

---

## Executive result

- **5 root gates confirmed?** **YES** — RG-1, RG-2, RG-4, RG-5, RG-7 open; RG-3 and RG-6 cleared; RG-UNMAPPED empty.
- **12 requirements confirmed?** **YES** — arithmetic closes structurally, not coincidentally (proof below).
- **legitimate external/human blockers: 6** — CODE-AUTHORITY-INCOMPLETE, MODULE-EXACT-DATASHEET-PENDING, FRAMING-AUTHORITY-UNVERIFIED, RACKING-CAPACITY-APPLICABILITY-GAP, DESIGNER-OF-RECORD-MISSING, ENGINEERING-REVIEW-PENDING.
- **legitimate design/field blockers: 3** — PENDING-RACKING-ASSEMBLY-SELECTION (design), ROUTE-LENGTH-ESTIMATE (field), TAP-CONDUCTOR-LENGTH-PENDING (field).
- **likely SolarPro automation/data-flow defects: 5** — requirements whose legitimate clear path is broken by SolarPro code: FASTENER-ASSEMBLY-UNVERIFIED, EQUIPMENT-DOCUMENT-APPLICABILITY, TAP-CONDUCTOR-LENGTH-PENDING, CODE-AUTHORITY-INCOMPLETE, RACKING-CAPACITY-SOURCE-NOT-ARCHIVED. (Three of these — FASTENER, EQUIPMENT-DOCUMENT-APPLICABILITY, TAP — have **no writer at all** for the field their predicate reads.)
- **likely stale/duplicate requirements: 1** — RACKING-CAPACITY-SOURCE-NOT-ARCHIVED is the *same boolean* as RACKING-CAPACITY-APPLICABILITY-GAP (`lib/permit/snapshot/rackingAssembly.ts:628`, pushes at `:633` and `:647`). The declared split at `lib/permit/snapshot/releaseGates.ts:505-510` was never implemented. **RG-4's count of 6 is inflated by one; the honest headline is 11 distinct facts.**
- **definite code/data defects discovered: 66** (registered D1–D66 below, every one cited).

**Three corrections to the handed-down ground truth (all probe artifacts, not engine defects):**
1. `module_datasheet` is a **`document_class` value**, not a table — `lib/documents/types.ts:10`. The governing table `manufacturer_document_registry` exists (migration 113). No migration is missing.
2. `document_jurisdiction_authority` is not a table any migration creates. `lib/migrations/119_document_jurisdiction_authority.sql:35-36` only adds `manufacturer_document_registry.jurisdiction_authority_id`, and that column **is present live**. **Migration 119 is effectively applied**; the four NULL ids are its documented no-backfill policy (`119…sql:26-31`).
3. `MSP_TO_UTILITY_RUN`'s `"excluded": null` was a field-name artifact. The D1 utility-owned exclusion is live (`lib/permit/snapshot/build.ts:674-681`; flag set at `lib/computed-system.ts:1886`) and renders (`_tmp_audit_planset.html:1590`).

---

## The 12 requirements

| # | Code | Gate | Sev | Authority path | Originating fact | Emitter (file:line) | Affected sheets | Clear condition (exact) | Class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | CODE-AUTHORITY-INCOMPLETE | RG-1 | blocking | `codeAuthority.editions` | Madison County IBC/IRC/IFC adoption never retrieved; both `ahj_registry` rows `seeded-unprovenanced` | `build.ts:2237-2246` | NOT ESTABLISHED | `codeAuthority.verificationStatus === 'verified'` ⇔ `incompleteEditions.length===0 && verifiedBy && sourceHash` (`lib/permit/snapshot/codeAuthority.ts:380, 391-394`); IBC/IRC/IFC come **only** from `adoptFor()` (`:336-341`), whose only supplier is `code-authority@v1` (`lib/permit/snapshot/resolution/jurisdictionResolvers.ts:493`) | EXTERNAL |
| 2 | MODULE-EXACT-DATASHEET-PENDING | RG-2 | blocking | `snapshot.moduleDocumentAuthority` | Zero `module_datasheet`-class rows exist; nothing in the repo has ever written one | `lib/permit/snapshot/equipmentProjection.ts:473-533` | NOT ESTABLISHED | `applicability.clears` ⇔ state ∈ {EXACT_VARIANT, FAMILY_COVERED} (`lib/permit/snapshot/moduleDocumentAuthority.ts:290-304`), read at `resolution/datasheetBinding.ts:125-127` | EXTERNAL (human verifier required by policy, `lib/documents/registry.ts:115-117`) |
| 3 | FRAMING-AUTHORITY-UNVERIFIED | RG-4 | blocking | `structural.framingCapacityAuthority` | No truss design drawing / stamped analysis on file; `engineering_review_records` empty | `lib/permit/snapshot/structuralAuthority.ts:879-889` | PV-4C, PV-3, PE-1, CERT | `resolveFramingCapacityAuthority` non-null via doc path (`lib/permit/snapshot/framingAuthority.ts:195-202`) or digest-bound review (`:221-225`) | PROFESSIONAL |
| 4 | PENDING-RACKING-ASSEMBLY-SELECTION | RG-4 | blocking | `rackingAssembly.railSelection` | No rail SKU pinned; 4 span-screened candidates, `partNumberAvailability: none-in-catalog` | `structuralAuthority.ts:931-943` | PV-4C, PV-3, PE-1, CERT | `deriveRailSelection().state !== 'unselected'` (`resolution/railSelection.ts:284-312`) + audit ref (`build.ts:1978`) | DESIGN |
| 5 | FASTENER-ASSEMBLY-UNVERIFIED | RG-4 | blocking | `rackingAssembly.fastenerVerification` | Cited source is ESR-3575, a flashing/water-resistance report | `structuralAuthority.ts:980-984` | PV-4C, PV-3, PE-1, CERT | `resolveFastenerVerification(...).verified` over `ra.datasheetSource ?? ra.capacitySource` (`lib/permit/snapshot/structuralProjection.ts:494-511`) — **both are compiled-in catalog strings, no writer exists** | **NONE — dead** |
| 6 | EQUIPMENT-DOCUMENT-APPLICABILITY | RG-4 | blocking | `snapshot (document)` ← default, no META entry | Static asset `docTitle` names "RT-MINI II"; selected mount is "RT-MINI" | `structuralAuthority.ts:993-1007` | **`[]`** (defect D28) | `evaluateDocumentApplicability(...).applicabilityVerified` (`lib/manufacturer-assets-db.ts:386-418`) — the only non-source-edit exit needs `aliasEvidence`, hardcoded `null` at `structuralAuthority.ts:1001` and `build.ts:2749`, **with no producer anywhere** | **NONE — dead** |
| 7 | RACKING-CAPACITY-SOURCE-NOT-ARCHIVED | RG-4 | blocking | `rackingAssembly.capacityProvenance` | `extracted_claims` NULL on all 3 structural rows ⇒ pre-filtered out | `rackingAssembly.ts:633-646` (inside `if (!rtCleared)` `:628`) | PV-4C, PV-3, PE-1, CERT | `evaluateRackingCapacityClearance(...).cleared === true` (`rackingAssembly.ts:233-322`) | EXTERNAL |
| 8 | RACKING-CAPACITY-APPLICABILITY-GAP | RG-4 | blocking | `rackingAssembly.capacityProvenance` | Roof Tech publishes no gen-1 RT-MINI PE letter (`resolution/structuralDocuments.ts:74`) | `rackingAssembly.ts:647-660` — **same `if`** | PV-4C, PV-3, PE-1, CERT | **identical boolean to #7** | EXTERNAL |
| 9 | ROUTE-LENGTH-ESTIMATE | RG-5 | blocking | `electrical.routeSegments[].lengthSource` | 4 of 5 project-owned runs have no routed CAD geometry | `build.ts:1988-2019`; 2nd emitter `resolution/derived.ts:162-217` | PV-1, PV-4B, E-1, SCHED | every REQUIRED segment's `lengthSource ∈ {'cad-route','field-measurement','field-verified'}` (`lib/fieldMeasurement/resolver.ts:256, 270-272`); the only VERIFIED writer is `build.ts:1538` | FIELD |
| 10 | TAP-CONDUCTOR-LENGTH-PENDING | RG-5 | blocking | `electrical.serviceTopology[svc-tap-conductors].constraints` | Supply-side NEC 705.11 tap; existing-service run in no CAD model | `build.ts:2079-2083` | PV-4B, E-1 | no `tap-conductors` constraint in `state:'pending'` — **the state is an unconditional literal at `build.ts:914`; grep for `state: 'pass'`/`'fail'` over `lib/` returns zero** | FIELD — **dead** |
| 11 | DESIGNER-OF-RECORD-MISSING | RG-7 | blocking | `project.designer` | `personnel_roles` = 0 rows | `build.ts:2262-2265` | NOT ESTABLISHED | `proj.designer` truthy — set directly, by assignment (`lib/personnel/store.ts:330-365`), or by an org default (`:144-146`) propagated at `resolution/resolvers.ts:970` | AUTO (after one admin config write) |
| 12 | ENGINEERING-REVIEW-PENDING | RG-7 | blocking | `certification.engineeringReviewApproved` | `engineering_review_records` = 0 rows | `build.ts:2879-2927` via `reviewCoverage.ts:131-197` | NOT ESTABLISHED | all 9 conditions of `decideReviewCoverage`, decisively `reviewedDigest === build.meta.digest` (`lib/permit/snapshot/reviewCoverage.ts:170`) | PROFESSIONAL |

### Proof the count closes to exactly 12 under exactly 5 open gates

1. **One requirement per registry record, one gate per requirement.** `lib/permit/snapshot/releaseGates.ts:1060-1105` pushes exactly one row per `input.registry` entry with `gateId = decl?.gateId ?? UNMAPPED_GATE_ID`. Gates are built by *filtering* that list (`:1120-1122`) — there is no second assignment path, so a code cannot appear under two gates.
2. **Enforced.** `verifyOnePrimaryGate` (`:1350-1367`) and `verifyGateCounts` (`:1371-1413`, `Σ gate children === requirements.length` at `:1405`).
3. **Live rollup:** RG-1 1 + RG-2 1 + RG-3 0 + RG-4 6 + RG-5 2 + RG-6 0 + RG-7 2 + RG-UNMAPPED 0 = **12**, matching `summary.unresolvedRequirementCount = 12`. Gates with ≥1 unresolved child = RG-1, RG-2, RG-4, RG-5, RG-7 = **5 open**, matching `openGateCount = 5`.
4. **No undeclared emitter is hiding.** Hand-diffing the 42 codes in `REQUIREMENT_DECLARATIONS` (`releaseGates.ts:354-832`) against every code literal in every emitter (`build.ts`, `structuralAuthority.ts`, `rackingAssembly.ts`, `equipmentProjection.ts`, `qcableProcurement.ts`, `groundingAuthority.ts`, `bom/tigoRsdCompanions.ts`, `resolution/derived.ts`, `resolution/resolvers.ts`) yields **42 declared / 0 emittable-but-undeclared**.
5. **Caveat (D63/D66):** `validateReleaseGateMap` never inspects an emitter (`releaseGates.ts:1498-1535` iterates declarations only), five `push()` sites are dynamically coded (`build.ts:2112, 2142, 2225, 2233, 2274` — `structAuth.blockers[].code` is a bare `string`, `structuralAuthority.ts:842`), and `projectAuthority.ts:57` carries a dead map entry `RACEWAY-BONDING-AUTHORITY`. The closure is true today but is not compiler- or runtime-enforced.

---

## 1. AHJ authority findings

**Verdict: primarily a real data-acquisition gap — but the operator remediation path is non-functional even after correct research.**

The blocker fires from one predicate (`build.ts:2237`), and the complete clear condition is: `code-authority@v1` must obtain a `RetrievedCodeAdoption` with `conflicts.length === 0` and non-null `nec`, `ibc`, `irc`, `ifc`. ASCE never participates (see D7).

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D1** | **The registry query is keyed on the mailing city.** `code-authority@v1` passes `city: str(p.city)` = `"GRANITE CITY"` while the verified boundary determination (`unincorporated: true`, confidence 0.9) is in hand on the bundle. `matchRegistryRows` is city-first, so `allMatches = [il-madison-granite-city]` and the canonical `il-madison-county` row is **never inspected** — the provider filters only `allMatches`. **Verifying the canonical county row would still return `NO_COVERAGE`.** | `jurisdictionResolvers.ts:523-525`; `lib/jurisdictions/internalAhjRegistry.ts:152-164`, `:323-324` | propagation/reconciliation repair |
| **D2** | `code-authority@v1` declares `requiredInputs: ['projectLegalAuthority','projectJurisdiction']` and **not** `'legalJurisdiction'`, so a jurisdiction correction cannot re-dirty it (`lifecycle.ts:382` tests declared inputs only). | `jurisdictionResolvers.ts:492` | propagation/reconciliation repair |
| **D3** | The failure-path seed **write** targets `il-madison-county` while the **query** hits `il-madison-granite-city` — 331 enrichment attempts on the county row, 264 of whose notes name the city row. | `jurisdictionResolvers.ts:534-555` | propagation/reconciliation repair |
| **D4** | The blocker's own printed remediation — *"Archive + verify the AHJ adoption ordinance (W4-D)"* — **has no implementation.** `documentClass: 'ahj_code_adoption'` has exactly two hits repo-wide: the enum and a comment. No resolver queries it. An operator following the instruction changes nothing. | `build.ts:1919`; `lib/documents/types.ts:19` | registry/release-gate repair |
| **D5** | `providerConfigured: true` in the evidence can never be `false` (composite `.some()` over a provider that hard-returns `true`), and sits beside a `failureReason` saying the token is unset. | `jurisdictionResolvers.ts:507`; `internalAhjRegistry.ts:315`, `:385` | registry/release-gate repair |
| **D6** | `engine-default` is re-labelled `structural-engine-basis` one hop downstream; the basis string changes from *"…stated as a default"* to *"…the engine computed under"*. The stronger claim is the one that reaches the sheets. | `codeAuthority.ts:352-357`, `:373-377` vs `lib/permit/snapshot/asceAuthority.ts:144-150` | source-of-truth repair |
| **D7** | **ASCE rank-1 is type-excluded, not merely absent.** `RetrievedCodeAdoption.editions` has no `asce` member (`lib/jurisdictions/ahjRegistry.ts:98`); the builder omits ASCE deliberately (`jurisdictionAuthority.ts:416-426`, `void args.asceEngineBasis`); `ahj_registry` has no `asce_edition` column (`117_ahj_registry.sql:48-52`); the operator API accepts four editions (`app/api/admin/ahj-registry/route.ts:90`). ⇒ `adoptedEdition` permanently null ⇒ `conflict` (`asceAuthority.ts:113`, needs both) **permanently `false`**. `conflict`/`conflictDetail` have **zero consumers** repo-wide. The D13 conflict test injects `registryField: 'StructuralCode'`, a value the real builder never emits, and never imports `buildCodeAdoptionAuthority` (`tests/planset/r7-d13-asce-edition-authority.test.ts:42-61`) — 9/9 green and vacuous for the branch it protects. **This is the D8 pattern verbatim.** | as cited | source-of-truth repair |
| **D8** | The **verified** archived hazard document names its edition (`sourceVersionOrDate: "ASCE 7-22"`, sha `cedb14f7…`), and the ASCE decision cannot read it — `resolveAsceEditionAuthority` reads only `environmentalRetrieval?.edition`. The better the evidence, the weaker the reported provenance. | `asceAuthority.ts:111`; `resolvers.ts:369` | propagation/reconciliation repair |
| **D9** | **Nothing recomputes if the adopted IBC names a different ASCE edition.** No IBC→ASCE mapping exists; `StructuralInputV4` has no edition field (grep `edition` in `lib/structural-engine-v4.ts` → 0); coefficients are literal to 7-22 (`:382, 407, 432, 454, 1465`); the engine runs once, before the snapshot build; no resolver declares `codeAdoptionAuthority` as a `requiredInput`; the declared invalidation is prose the lifecycle only logs (`lifecycle.ts:372-384`). The edition on the sheets is a **label over a fixed computation**. | as cited | source-of-truth repair |
| **D10** | `Admin → AHJ Registry`, named in the operator action, **does not exist** — API only. Its id derivation would create a *third* row rather than upgrading the seeded one unless `body.id` is supplied. | `internalAhjRegistry.ts:332-334`; `app/api/admin/ahj-registry/route.ts:101` | registry/release-gate repair + data acquisition problem |
| **D11** | `mapRegistryToAhjRecord` retains IBC/IRC/IFC into an `AhjRecord` no code-authority consumer reads; its only caller returns it to the browser and writes nothing. Latent. | `lib/jurisdictions/ahjRegistry.ts:207-209`, `:237`, `:309`; `app/api/engineering/ahj-lookup/route.ts:79-87` | propagation/reconciliation repair (latent) |
| **D12** | Fence/ground templates hardcode `DESIGN CODE: 'ASCE 7-22 / IBC 2021'`, which would print a fabricated IBC year while `editions.ibc` is null. Not on BRAIDON's path. | `lib/drafting/sheetComposition.ts:628`, `:719` | rendering-only repair (latent) |

**Correct behaviour, do not "fix":** the `seeded-unprovenanced` rows can never clear under any path — `rowCarriesAdoptionEvidence` requires provenance + sourceUrl + sha256 + verifier/retrieval + ≥1 edition (`internalAhjRegistry.ts:171-177`). That refusal is the design.

**ASCE 7-22 classification: DEFAULTED.** `source: "engine-default"`, `ref: null`, `adoptedEdition: null`, `computedEdition: null`; origin `ENGINE_DEFAULT_ASCE_EDITION = '7-22'` (`asceAuthority.ts:35`); a second independent hardcode drives the hazard query (`jurisdictionResolvers.ts:48`, used `:838`), and both providers echo the requested edition back (`lib/providers/climateHazard/asceHazardProvider.ts:288`). **All three authority ranks resolve to the same constant by construction.** Rendering is honest on BRAIDON — `IBC/IRC/IFC PENDING` × 20 each, `ASCE 7-22` × 20 (45 total occurrences; the lane's "49" is corrected), with **zero** occurrences of "default" anywhere in the document. *(Contested: the ahj lane said "D13 handled this"; challenge 2 refuted it four ways.)*

**External half:** the SunSpec endpoint is live (401, credentials not provided); `AHJ_REGISTRY_TOKEN` is unset and no `.env*` exists. Whether that registry carries IBC/IRC/IFC for `il-madison-county` is **NOT ESTABLISHED** and untestable without the free token. → **data acquisition problem / legitimate unresolved external authority.**

---

## 2. Module-datasheet findings

**Verdict: NOT a code defect, NOT a false requirement. A data-acquisition + registration gap, with two secondary defects.**

The governance lookup ran cleanly and returned empty: `registryLookup.attempted: true`, `boundDocumentId: null`, failure *"no governed module_datasheet registry document is on file"* — the `read.ok && doc === null` branch (`resolvers.ts:821-837`), not a swallowed transport error. The DS-1 image is a **render cache**, resolved by equipmentId+category from a compiled static array (`lib/manufacturer-assets-db.ts:140-152`), where `verified: true` means *the URL was fetched*, not that a document was verified (`:30`). DS-1 correctly fails closed and composes no verdict (`lib/permit/sections/datasheetAppendix.ts:72, 80-90`).

**FAMILY_COVERED clears — confirmed at HEAD.** An exact-wattage PDF is explicitly not required (`lib/permit/snapshot/moduleDocumentAuthority.ts:40-42, 284-289`). For this project a correctly-registered G10+ 385–405 W family sheet clears: `familyCovered` via prefix (`:244-245`) and `400 ∈ [385,405]` (`:273`).

**Exact evidence that would clear it** — one INSERT into `manufacturer_document_registry`, no migration, `extracted_claims` is already JSON:
`document_class='module_datasheet'`, `equipment_id='qcells-peak-duo-400'` (**required** — the `LIKE` leg fails because the selected model string contains `400W` and a natural applicability string does not, `lib/documents/registry.ts:386-388`), `archived_in_repo=true`, 64-hex `sha256` of the exact bytes, `status='current'`, `verification_state='verified'`, `verified_by` = **a human** (`registry.ts:115-117`), and `extracted_claims.module` carrying `productFamily` + `explicitWattageRange` (or `wattagesCovered` ∋ 400) + `electricalMechanicalSpecificationsPresent: true` + ≥1 `evidence` sub-field. Jurisdiction is **irrelevant here** — the module resolver passes no jurisdiction criterion (`resolvers.ts:812-818`), so the mailing-city problem does not touch this lane.

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D13** | **`NOT_COVERED` and `EVIDENCE_INCOMPLETE` are unreachable in production.** `pickVerifiedDocument` pre-filters with the same predicates the authority re-applies, so any rejected row arrives as `null` and is reported as *"no document on file"* — false in that case. The refusal list at `moduleDocumentAuthority.ts:209-212` can never print. Same class as D8. | `registry.ts:408-454` vs `moduleDocumentAuthority.ts:194-282`; single call site `resolvers.ts:822` | registry/release-gate repair |
| **D14** | Four divergent "Qcells datasheet" URLs — `lib/data/manufacturer-assets/modules.json:86`, `lib/equipment-db.ts:472` (different file), asset notes (different product family, L-G7.2), `lib/equipment/specSheets.ts:20-24` (**orphaned**, no importer). Two are on a distributor CDN. None is content-hashed. Registering the wrong one is a live risk. | as cited | propagation/reconciliation repair |
| **D15** | DS-1's sheet name and the cover index print the **asset's** model — `"Q CELLS Q.PEAK DUO 400W"` — beside a title block reading `"Q.PEAK DUO BLK ML-G10+ 400W"`. Two product names on one sheet. | `datasheetAppendix.ts:171`, `:270` | rendering-only repair |
| **D16** | Stale wording contradicting CMDA: `releaseGates.ts:407-409` titles it *"Exact-wattage module datasheet not on file (family/range page only)"* and `severityPolicy.ts:87-90` justifies it with *"an AHJ requires the exact-wattage datasheet"*. Both restate the rule CMDA retired. No test pins the title. | as cited | rendering-only repair (registry text) |
| **D17** | No `PUBLISHED_DOCUMENT_SOURCES` entry for any module (`resolution/structuralDocuments.ts:76-117` is three Roof Tech entries) and no module retrieval resolver — `moduleDatasheetBindingResolver` is read-only (`resolvers.ts:766-913`). `createDocument` is called from three files; **none writes a `module_datasheet` row.** | as cited | data acquisition problem |
| **D18** | `archived_in_repo` is a **caller assertion, not a verified fact** — no blob store exists, `archived_file_identity` is free text, and nothing re-checks `sha256` against retrievable bytes. | `structuralResolvers.ts:336`; `jurisdictionResolvers.ts:911` | registry/release-gate repair |
| **D19** | **Both governed verification UI paths are broken at HEAD.** The admin Verify button posts no notes ⇒ `verificationBasis` null ⇒ `validateVerificationTransition` throws ⇒ 400 (`app/admin/document-registry/page.tsx:44-49, 114`; `app/api/admin/document-registry/route.ts:80-82`; `lib/documents/registry.ts:215-217`). The rt-mini "verify immediately" checkbox never passes `verificationActor`/`ActorKind`/`Basis` and surfaces as a DB error (`app/api/admin/document-registry/rt-mini/route.ts:123-143`; `registry.ts:209-211`). | as cited | registry/release-gate repair |

**Automation ceiling (correct, do not repair):** machine retrieval could close the custody half (bytes + hash + archive), but `module_datasheet` is deliberately outside `MACHINE_VERIFIABLE_DOCUMENT_CLASSES` and `extractedClaims` may not be back-filled from the catalogue — *"that would make the document agree with the selection by construction"* (`lib/documents/types.ts:59-62`). → **legitimate unresolved external authority.**

---

## 3. Structural dependency graph (RG-4)

**Four independent roots, not six.**

```
[1] FRAMING-AUTHORITY-UNVERIFIED     ← framingCapacityDocument OR digest-bound PE review
                                       (touches nothing else in RG-4)
[2] PENDING-RACKING-ASSEMBLY-SELECTION ← projects.selected_equipment.railSelection
                                       (WS-8 split is genuinely present; gates nothing else)
[5]+[6] RACKING-CAPACITY-SOURCE-NOT-ARCHIVED  ┐ ONE boolean
        RACKING-CAPACITY-APPLICABILITY-GAP    ┘ rackingAssembly.ts:628
                                       HARD BLOCK: exactModel 'RT-MINI II' ≠ 'RT-MINI'
[4] EQUIPMENT-DOCUMENT-APPLICABILITY ──declared edge──▶ [3] FASTENER (test 3)
                                       edge is SHORT-CIRCUITED: test 2 (!src) returns first
```

### The four questions

**Q1 — rail SKU pinned + its verified assembly documents archived: how many of the six clear?**
**Exactly 1** — PENDING-RACKING-ASSEMBLY-SELECTION. `rtCleared` (`rackingAssembly.ts:517`) does not test rail pinning at all; FASTENER reads a catalog string; EQUIPMENT-DOCUMENT-APPLICABILITY reads an asset title; FRAMING reads a different authority. Pinning actually *adds* a constraint (`requiredRail` activates the `rail_lfoot_assembly` cross-check at `:279-281`).

**Q2 — exact RT-MINI fastener/capacity authority verified: which children collapse together?**
**RACKING-CAPACITY-SOURCE-NOT-ARCHIVED and RACKING-CAPACITY-APPLICABILITY-GAP collapse — 2 of 6 — because they are literally one `if`.** No input clears one and leaves the other. The separable data exists and is unused: `rtClearance.missing` already distinguishes archival fields (`archived_file`, `sha256`, `verification_state`, `status`) from applicability fields (`exact_model`, `substrate`, `rail_lfoot_assembly`, `jurisdiction`). **FASTENER-ASSEMBLY-UNVERIFIED does not collapse with them** — the `_capGated` echo was genuinely deleted (`structuralAuthority.ts:960-984`), and it cannot be cleared by the capacity document because its input is a catalog string.

**Q3 — verifying the two RT-MINI II PE letters: does anything clear? Does jurisdiction block?**
**0 of 6 clear. And jurisdiction does NOT block — this contradicts the prior SWAPA "D4" note and is the most important correction in this report.** *(Contested: lane `structural-six` and lane `cross-cutting` both partially asserted the old reading; challenge 1 executed a pure-function probe against HEAD and refuted it.)*

Ordered blockers:
1. **You cannot even click Verify today** — D19.
2. **The row is filtered out before any clearance evaluation.** `pickVerifiedDocument` requires `extractedClaims.structural.hasStructuralCapacityClaim === true` and `asdAllowableLbs > 0` (`lib/documents/registry.ts:455-459`); `extracted_claims` is NULL on all three structural rows, and `racking-documents@v1` creates rows with **no `extractedClaims` field at all** (`structuralResolvers.ts:325-353`). ⇒ `evaluateRackingCapacityClearance(ctx, null)` returns `missing: ['document']`; **jurisdiction is never evaluated.**
3. **`exact_model` is fatal and unfixable from the document side** — `"RT-MINI II"` vs `"RT-MINI"` (`rackingAssembly.ts:266-269`); Roof Tech publishes no gen-1 letter and no cross-reference (`structuralDocuments.ts:74, 119-130`).

**The jurisdiction trap points the opposite way.** Executed probe results:
- The mailing-city stamp **CLEARS**: a fully-claimed row stamped `"City of Granite City Building & Zoning"` with `exactModel: 'RT-MINI'` returns `cleared: true`. Both sides of the name comparison are the mailing city (`ctx.projectJurisdiction` ← `authority.projectJurisdiction` ← the posted record, `resolvers.ts:105-109`), so the check passes on the wrong authority — a latent **false clear** on a safety-adjacent gate.
- The **canonical** stamp **HIDES** the document: the selection filter is `dj.includes(jur)` with `jur` = the mailing city (`registry.ts:484-487`; criterion supplied at `resolvers.ts:284, 287`), so `"madison county building & zoning"` fails the substring test and the row is invisible.
- **This is live-armed.** `legalUsable` is true today, so the *next* document `racking-documents@v1` archives will be stamped canonically (`structuralResolvers.ts:344-345`) and excluded by the very filter meant to find it. Repairing the four rows' jurisdiction **in isolation is actively harmful** — it moves them from "rejected for missing claims" to "invisible".

**Q4 — is EQUIPMENT-DOCUMENT-APPLICABILITY correctly placed under RG-4? A duplicate? Why does it render nowhere?**
**Mis-filed, not a duplicate.** Three taxonomies disagree: `releaseGates.ts:512` says `gateId: 'RG-4'`; `projectAuthority.ts:75` says `domain: 'document'`; `structuralProjection.ts:211-229` omits it from `STRUCTURAL_BLOCKER_CODES`. So `isStruct` is false and there is no META entry, and it falls to the non-structural default at `build.ts:1952-1955`: `authorityPath: "snapshot (document)"`, `affectedSheets: []`, generic resolution text — while its five RG-4 siblings all got `STRUCT_DEFAULT`. Empty sheets is *documented* as package-wide (`plansetProfile.ts:169-171`) but `requirementAffectsSheet` returns `.some()` over an empty list (`:178`) ⇒ **false for every sheet**. It gates nothing, and the audited profile has no RS-1. The *fact* still renders twice (PV-3 chip, DS red box) — the *requirement row* is attributed to no sheet.

Not a duplicate of RACKING-CAPACITY-APPLICABILITY-GAP: different document (install manual vs stamped PE letter), different evaluator, and decisively different resolvability — a version-exact RT-MINI install manual **is** archived and hashed (`doc-rooftech-rtmini-install-manual-2f6035586e94`), whereas no RT-MINI capacity letter exists.

### Structural defect register

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D20** | **`assemblyVerification.overall` can never be `'verified'`** — `_vFastener` is a const `'pending'` compared under an `as string` cast that suppresses the always-false warning. Class-A procurement is dead code, racking bonding method is permanently gated, the projected assembly state is permanently pending. | `rackingAssembly.ts:778-782`; consumers `structuralBom.ts:295, 319`, `rackingBonding.ts:93`, `build.ts:1206`, `structuralProjection.ts:804` | propagation/reconciliation repair |
| **D21** | **EQUIPMENT-DOCUMENT-APPLICABILITY is dead.** `aliasEvidence` hardcoded `null` at both call sites; `DocumentApplicabilityAlias` has **no producer** (no table, migration, route or resolver); `registryFacts` can only *lower* `applicabilityVerified` (`manufacturer-assets-db.ts:358`); `rooftech-mini-ii` is not in the mount catalog. Only a source edit to `lib/manufacturer-assets-db.ts:35` can clear it — and the correct document is already named in that row's own `notes`. | `structuralAuthority.ts:1001`, `:171`; `build.ts:2749`; `manufacturer-assets-db.ts:174, 297-304, 386-418` | source-of-truth repair |
| **D22** | **FASTENER-ASSEMBLY-UNVERIFIED is dead.** Its cited source comes only from the static catalog (`'ICC-ES ESR-3575'`, `lib/mounting-hardware-db.ts:635-636`), both strings match the flashing-only regex, and `documentRoles.installationAuthority`/`fastenerAuthority` are unconditional `unfilledRole(...)` calls with no registry read. No registry act can move it. | `rackingAssembly.ts:854-856`, `:898-903`; `structuralProjection.ts:472-511` | propagation/reconciliation repair |
| **D23** | Two release requirements from one boolean; the declared AAC-5 split (`releaseGates.ts:505-510`) was never implemented. | `rackingAssembly.ts:628, 633, 647` | registry/release-gate repair |
| **D24** | D4 is **half-applied**: write side fixed, both reads still on the posted mailing city; the mailing city falsely clears and the canonical stamp hides the document. | `resolvers.ts:284, 287`; `registry.ts:484-487`; `rackingAssembly.ts:308-315` | propagation/reconciliation repair |
| **D25** | `projectJurisdictionAuthorityId` and `requiredSubstrate` are **never supplied** at the only production call site, so the D4 stable-id branch and the substrate cross-check are dead code. The D4 tests set them in their own helper — proving a path production cannot take. | `rackingAssembly.ts:192, 197, 273, 300, 508-515`; `tests/planset/r7-d4-legal-jurisdiction.test.ts:53` | propagation/reconciliation repair |
| **D26** | `extracted_claims` is **write-once at create**. `lib/documents/registry.ts` exports `createDocument`, `setVerification` and readers — no updater; the admin PATCH accepts only `{id, verification_state, notes}`. **The four live rows are unrepairable through any code path.** | `registry.ts:232, 323, 348-357`; `app/api/admin/document-registry/route.ts:69-82` | source-of-truth repair |
| **D27** | The AUTO_RETRIEVED path can never produce a document its own clearance evaluator accepts: the resolver archives with no `extractedClaims`, and the picker pre-filters on them. Also, this run reported `archived: 2` yet nothing changed — `_alreadyArchived` short-circuits on the content-derived id. | `structuralResolvers.ts:304, 311-322, 325-353`; `registry.ts:455-459` | registry/release-gate repair |
| **D28** | `affectedSheets: []` ⇒ the requirement gates no sheet (see Q4). | `build.ts:1952-1955`; `projectAuthority.ts:75`; `structuralProjection.ts:211-229`; `plansetProfile.ts:178` | registry/release-gate repair |
| **D29** | `structural-engine-v4.calcRackingBOM` decides rail-pending from the raw catalog (`!system.rail`) and is **blind to a D12 pin**, while `structuralBom.classifyStructuralBomRows` reads the canonical record. After a pin the two BOM stacks disagree on the same parts. The file comment asserts the opposite behaviour. | `structural-engine-v4.ts:1100-1139`; `structuralBom.ts:284-285`; `rackingAssembly.ts:440-442, 492-495` | propagation/reconciliation repair |
| **D30** | `bom-engine-v4` hardcodes `'PENDING-RACKING-ASSEMBLY-SELECTION'` into three `nonOrderableReason` strings from a module that never reads the registry. | `bom-engine-v4.ts:698, 703, 741` | propagation/reconciliation repair |
| **D31** | `"(SKU unpinned)"` asserted as unconditional literals inside the `!rtCleared` branch — false after a pin, and `explanation` is a **digested** field. | `rackingAssembly.ts:609, 613-619, 650-651` | rendering-only repair |
| **D32** | PV-3 renders `"DOCUMENT APPLICABILITY APPLICABILITY PENDING"` (literal prefix + chip text). | `lib/permit/sections/structuralPages.ts:98` | rendering-only repair |
| **D33** | `racking-capacity-document@v1` declares `FASTENER-ASSEMBLY-UNVERIFIED` among its `requirementCodes` but never feeds the fastener predicate. If it ever returns `cleared:true` with an audit ref, `build.ts:1978` stamps `resolved: true` on a record the emitter still pushes — a false clear beside a requirement that can never truly clear. | `resolvers.ts:272-276`; `build.ts:1978` | registry/release-gate repair |

**Genuinely unresolvable, do not chase:** FRAMING-AUTHORITY-UNVERIFIED (unpublished per-building truss design; a stamped analysis is a professional act — `structuralResolvers.ts:741-760`) and RACKING-CAPACITY-APPLICABILITY-GAP (`structuralDocuments.ts:66-75, 119-130`). Both **legitimate unresolved external authority.**

---

## 4. Electrical route findings

**Doctrine holds.** "An estimate may support provisional calculations but never satisfy release authority" is enforced at six independent layers — closure whitelist (`lib/fieldMeasurement/resolver.ts:270-272`), verification predicate (`types.ts:339-341`), voltage-drop conclusion (`electricalProjection.ts:544-622`), package route status cap (`:178, 187-189`), procurement (`bomForPermit.ts:1654-1671`), and V18 (`validate.ts:279-286`). Live render confirms three separated verdicts, none promoted (`_tmp_audit_planset.html:2997`).

**Arithmetic pinning "constant, not derivation":** `COMBINER_TO_DISCO_RUN = 20` requires `dFt ≈ 49.7` and `DISCO_TO_METER_RUN = 15` requires `dFt ≈ 20.1` from the *same* `dFt`. Impossible — both are the hardcoded fallback literals at `lib/computed-system.ts:1452-1453`. Neither touched the CAD model.

### ROOF_RUN — CORRECTED (contested)

Lane `electrical-two` recommended declaring ROOF_RUN `NOT_APPLICABLE` or retiring it as a "stale abstraction". **Challenge 3 refuted that recommendation and it is overridden.**

- ROOF_RUN and BRANCH_RUN are **different circuits on opposite sides of the inverter**: `'PV ARRAY'→'MICROINVERTERS'`, DC, `USE-2/PV Wire`, `isDC=true` (`lib/computed-system.ts:1474-1512`) vs `'MICROINVERTERS'→'AC COMBINER'`, AC, `THWN-2` (`:1518-1556`). The repo states the separation as a ruling at `computed-system.ts:2288-2294`, and no segment-schedule row back-populates ROOF_RUN (`:2295-2300`).
- The duplication was **real at engine 47420 and is already closed** — comparing `_tmp_head_live.snapshot.json` (ROOF_RUN = THWN-2 × 6, the AC branch bundle) against `_tmp_r7_after_full.snapshot.json` (USE-2 × 2) shows the §3/§4 split re-homed it.
- **ROOF_RUN carries a conductor that prints on the delivered sheet.** The array/racking bonding EGC anchors to it (`build.ts:1207-1251`) and its rendered length is read straight off the segment (`electricalProjection.ts:847`). Live: `_tmp_audit_planset.html:2729` prints `#10 AWG Cu · FREE AIR · **15 ft route-one-way**` with `data-grounding-installed-asserted="true"`.
- Marking it `NOT_APPLICABLE` would make the measurement API refuse it (`lib/fieldMeasurement/service.ts:265-275`) and the applier ignore it (`build.ts:1536`), **freezing a printed installed-conductor length at a CAD estimate with no reachable path to field verification.** Deleting it makes `segs.find(...)` return undefined and the length `null`.

**Corrected finding: keep ROOF_RUN and keep `ROUTE-LENGTH-ESTIMATE` naming it. Re-derive its length from the bonding-EGC route and give it a truthful `electricalFunction`.** The W4a ruling (`lib/bom-engine-v4.ts:1395-1407`) is scoped to the DC conductors only — *NOT ESTABLISHED* whether the IQ8A/module factory leads genuinely reach without field wire; that assertion cites no manufacturer document.

### TAP-CONDUCTOR-LENGTH-PENDING

The requirement itself is **legitimate** — BRAIDON is a supply-side NEC 705.11 interconnection, the refusal is honest, the render says `PENDING (length unknown)`, a guard forbids a `pass` without a length (`validate.ts:396`), and the dependent BOM row is correctly withheld. **But the gate is unreachable** (D34). *Possible duplication with `DISCO_TO_METER_RUN` (`computed-system.ts:1827-1829`, comment names both load-side and supply-side terminations) is* **NOT ESTABLISHED** *— it needs a designer ruling, not a code inference.*

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D34** | **TAP-CONDUCTOR-LENGTH-PENDING has no writer.** `state: 'pending'` is an unconditional literal; grep for `state: 'pass'`/`'fail'` over `lib/` returns zero; `serviceTopology` is built once and only read; no assignment to any topology object's `.lengthFt`/`.constraints` exists; no input socket exists; the WS-5 store maps only `routeSegments`. The type already admits `lengthSource: 'field-measurement'` — a schema designed for an answer no code path can deliver. | `build.ts:904-921` (esp. `:909, :914`); `types.ts:1002, 1010-1041`; `lib/fieldMeasurement/permitAccess.ts:205-225` | source-of-truth repair |
| **D35** | ROOF_RUN's length is derived by an **AC-eave-trunk heuristic** (`plane width × 0.6 × 1.15`, note string *"trunk cable along the eave"*) while it is spent as the DC-lead sizing basis and the bonding EGC's printed length. Stale provenance from the pre-47420 era. | `lib/bom/deriveRunLengths.ts:13-14, 173-177` | source-of-truth repair |
| **D36** | Two of the four named residual runs are described to the operator as *"electrical run"*: `computed-system.ts:1484` sets no `electricalFunction`, and `_elecFunction`'s regex tests `/DISCO_TO_(MSP\|TAP\|POI)/` against the live id `DISCO_TO_METER_RUN`. Half the field-measurement work order names nothing. | `build.ts:569-579`; `_tmp_audit_planset.html:1590` | rendering-only repair |
| **D37** | Every segment is stamped with one hardcoded provenance literal *"computeSystem runs (deriveRunLengths cad estimate)"* — false for the three fallback-literal runs. The type already admits `lengthSource: 'unknown'`, which V18 treats identically for gate purposes. | `build.ts:752`; `validate.ts:281` | source-of-truth repair |
| **D38** | `derivationNotes` are computed per segment and reach only three `console.log` calls; nothing reaches the snapshot. The artifact that would make D37 self-evident is discarded at the seam. | `deriveRunLengths.ts:112, 311`; `generatePermit.ts:387, 390, 411` | source-of-truth repair |
| **D39** | **The 1.15 slack is applied twice** on CAD-estimate runs — baked into `onewayLengthFt` (`deriveRunLengths.ts:44, 176-193`), then again as `_WASTE` (`bom-engine-v4.ts:324, 369, 529`). Live: 15.65 ft of centre-line ordered as **21 ft (1.34×)**, and every dependent fitting count inherits it. `describeLegacyEstimateProcurement`, written specifically to prevent this, has **zero callers**. | `routeProcurementPolicy.ts:98-108, 154-167`; `_tmp_audit_planset.html:3425` | propagation/reconciliation repair |
| **D40** | The emitter **fails open on an empty route set** — `if (_residual.length > 0)` — while the resolver ten lines away fails closed (`cleared = segs.length > 0 && residual.length === 0`). V18 does not catch it either. A design whose electrical model failed to build would ship with RG-5 route authority silently satisfied. | `build.ts:2001` vs `resolution/derived.ts:180`; `validate.ts:259, 281` | registry/release-gate repair |
| **D41** | Two length-source vocabularies; the pairs the system actually writes are in neither `ROUTE_LENGTH_AUTHORITY_PAIRS`, and the canonical mapper exists **only inside a test**. Latent. | `types.ts:308-312, 318-325, 383`; `build.ts:1538`; `tests/planset/ws5-field-measurement-reachability.test.ts:430-432` | source-of-truth repair (latent) |
| **D42** | The residual set is derived twice, independently, and `derived.ts:166-171` documents that the two sentences surface on different profiles. They agree only because both call the same named policy. | `build.ts:1991-2018` vs `derived.ts:172-179` | propagation/reconciliation repair |
| **D43** | The `branchCablePaths` patch updates `oneWayFt`/`calculationLengthFt`/`procurementLengthFt`/`lengthSource` but **never `voltageDropPct`**. Proof: `BRANCH_RUN.voltageDropPct = 0.08283006181759794` is byte-identical across engine 47420 (15 ft segment) and 47500 (64 ft segment). Magnitude of error **NOT ESTABLISHED**. | `build.ts:1464-1499` vs `:734, :1574` | propagation/reconciliation repair |
| — | `ROUTE_LENGTH_CLOSURE_POLICY.insufficientSources` names `'field-reported'`, but the applier writes `'operator-entry'`. Behaviour correct (fail-closed whitelist); the reviewable artifact does not name what it excludes. | `resolver.ts:258`; `build.ts:1538` | source-of-truth repair (documentation) |

---

## 5. Professional-release findings

**Two independent stores, genuinely distinct, deliberately so** — `LICENSED_ROLES` vs `AUTO_POPULATABLE_ROLES` (`lib/personnel/types.ts:25, 30`); the designer is a configuration identity, the review is a digest-bound licensed attestation. **Migrations 115 and 116 are APPLIED** — every in-code comment claiming otherwise (`lib/personnel/store.ts:7-9`, `lib/engineeringReview/store.ts:7-8`, `releaseGates.ts:807`) is stale, contradicted by live resolver evidence (`storeReadable: true` on both).

**D11 digest day-drift fix confirmed present at HEAD:** exclusion by PATH not key name (`digest.ts:105-114, 142`), `capturedAtIso` deliberately not key-excluded (`:97-100`), and `revisionHistory[].date` compared to `projectAuthority.issueDate` (`:126-127, 163-171`) — the exact trap named in the prior note, closed. The invalidation ledger read succeeded (`activeRowCount: 22`), so an approval recorded today post-dates all reconciliation rows.

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D44** | 🚨 **Recording an approval MOVES the design digest.** `engineeringReviewRecordResolver` emits `engineeringReview` + `framingEngineerReview` + `framingReviewDigest` **atomically**; the latter two clear `FRAMING-AUTHORITY-UNVERIFIED`, which changes `structural.framingCapacityAuthority`, the registry, `geometry.moduleInstances`/rail substrate, and `sheetIndex` — all inside `canonicalDigestBody`. So the approval's own digest `D` no longer matches the rebuilt `D″`, and ENGINEERING-REVIEW-PENDING stays open on the very build the approval enabled. **Every digest-stability test supplies `engineeringReview` alone**; `framingEngineerReview` is asserted non-null in zero tests. Unit tests pass while the live path is broken. | `structuralResolvers.ts:934-944`; `generatePermit.ts:1257-1258`; `structuralAuthority.ts:212-216, 879-887`; `digest.ts:209-216`; `tests/planset/prr-release-reachability.test.ts:318` | propagation/reconciliation repair |
| **D45** | 🚨 **The framing engineer-review digest check is TAUTOLOGICAL.** `reviewEvidence.reviewedSnapshotDigest` and `currentDigest` are both `coverage.reviewedDigest`, so `r.reviewedSnapshotDigest === input.currentDigest` is `x === x`. Since the coverage lookup key is the **prior** digest, **an approval of a superseded design clears a `safety: true` structural requirement** while the build correctly refuses to clear ENGINEERING-REVIEW-PENDING for the same record. Structurally identical to D8. | `framingAuthority.ts:158, 168-170, 224`; `structuralResolvers.ts:869, 938, 944`; `severityPolicy.ts:259-262` | source-of-truth repair |
| **D46** | **The 64-char digest the gate requires is printed nowhere.** The review page demands `/^[0-9a-f]{64}$/i` with no lookup; the title block prints `slice(0, 20)` (live: `1a88853f2436b7c74db1`); `generatePermit.ts:1320` logs 16. A licensed engineer reviewing the set cannot obtain the value. | `app/admin/engineering-review/page.tsx:73-74, 97-98`; `lib/permit/utils/titleBlock.ts:197` | registry/release-gate repair |
| **D47** | Recording a licensed engineer's approval requires a **platform admin** account (`requireAdminApi`, reviewer identity from the admin session) — or an admin types someone else's name and licence, defeating the attestation-integrity property the route claims. | `app/api/admin/engineering-review/route.ts:48, 74, 89, 98` | registry/release-gate repair |
| **D48** | PASS 2 mutates `certification`, `projectAuthority`, `resolutionAuthority.engineeringReview` and the registry entry **after** `meta.digest` is frozen, all inside `canonicalDigestBody`. Two in-repo contracts assert the opposite (*"an archived package still re-digests to its own `meta.digest`"*). No live caller today — zero production callers of `computeSnapshotDigest` outside `digest.ts`/`build.ts:2866`. | `build.ts:2866, 2918-2969`; `digest.ts:196-197`; `authorityProjection.ts:341` | propagation/reconciliation repair (latent) |
| **D49** | The requirement's title, message and resolution text all name **engineer-of-record**, but the clear condition reads only `project.designer`, and the resolver is *forbidden* from populating `engineer_of_record`. The operator is told to assign a role that cannot clear it. | `releaseGates.ts:805`; `build.ts:1922, 2262-2264`; `lib/personnel/types.ts:30` | registry/release-gate repair |
| **D50** | `DESIGNER-OF-RECORD-MISSING` is domained `'document'`, so it counts as a non-review authority gap and **double-fails** the ISSUED-FOR-PERMIT gate (`project-identity-valid` *and* `authority-gaps-cleared`) — one missing field presented as two independent problems, on a gate advertised as "workflow requirements, not engineering defects". | `projectAuthority.ts:82, 243-254`; `build.ts:2349, 2353-2355` | registry/release-gate repair |
| **D51** | 🚨 **PASS 2 sets `resolved = true` without a `resolutionAuditRef`.** `permitReadiness.ready` filters on the raw boolean while `deriveRequirementStatus` returns `'OPEN'` for exactly that shape. On the day an EOR approves, RS-1 prints **"CLEARED FOR ISSUE — NO OPEN RELEASE GATES"** (`reviewStatus.ts:833, 844`) beside `data-release-open-gate-count="1"` (`:857`). `verifyIssueStateAgreement` exists to catch this and never runs (D63). | `build.ts:2311-2314, 2920-2922`; `releaseGates.ts:971-977, 1487-1495` | registry/release-gate repair |

**Order dependency, proven:** assigning a designer moves the digest — `projectAuthority` is a PASS-1 digest member and only three of its leaves are excluded. **Operational rule: configure the designer FIRST, regenerate, THEN have the PE approve.** Documented nowhere today. → **legitimate unresolved external authority** (correct behaviour).

**Also flagged (policy, correctly implemented, but compounding):** `meta.engineVersion` is inside the design digest (`build.ts:2480`; pinned by `tests/planset/r7-d11-digest-scoped-invalidation.test.ts:88-92`), so every engine deploy retires every outstanding approval. Migration 116 stores `planset_engine_version` to distinguish this and nothing acts on it. → **legitimate unresolved external authority.**

**Checked clean:** the engine cannot approve (`resolverId: null`, `requirementCodes: []`, no INSERT in migration 116); both stores fail closed when unreadable; append-only supersession with unique partial indexes; licence expiry refused at approval time; `scopeStatement` mandatory; the ledger `null` sentinel survives the call site (`generatePermit.ts:1232` deliberately avoids `??`); V33/V34 re-derive over the same blockers.

---

## 6. Dead-load discrepancy (2.9 vs 3.0)

**Three answers, in order of importance.**

1. **`2.9` is the correct `toFixed(1)` of what the code computes.** `_addedRaw = 2.926626783133089458…`; not near a tie. **`3.0` is a rounding artifact** — the sum of three independently-rounded displays. Modules round up (+0.02902), racking rounds up (+0.04435), the total rounds down (−0.02663). Printing `3.0` would be *less* accurate.
2. **But the number being rounded is wrong.** On the engine's own mass model the added PV dead load is **2.570979811 → 2.6**, not 2.9.
3. **And the row beside it is on a different basis.** The two printed rows imply an existing-roof dead load of **17.370979811 − 2.926626783 = 14.444353028 PSF**, a number that exists nowhere; the truss check actually ran on **15.000**; the sheet's prose says **8–12**.

Canonical chain (independently recomputed, then verified against the sheet's own §8 reconciliation — `Σ dead expected 1509.049 = 2.371 × 636.461` and `Σ dead objects 2017.224 = 28.017 × 72`, both exact; solving backwards pins the module weight to `[49.989, 50.012]`):

```
31 × 50.000 lb modules + 31 × 4.000 lb racking = 1674.000 lb over 706.037222 ft² (bounding box)
pvDeadLoadPsf (RAW) = 2.370979811420077789…
  modules-only       = 2.195351677240812768…   → honest render 2.2
  racking (4 lb/mod) = 0.175628134179265021…   → honest render 0.2
rendered racking     = pv × 0.15 = 0.355646972 → 0.4     (2.025× the engine's own allowance)
```

**Rendered TOTAL ADDED is overstated by 0.355647 PSF (+13.833 %). Rendered COMBINED is understated by 0.200000 PSF (−1.138 %).**

| ID | Finding | Cite | Class |
|---|---|---|---|
| **D52** | `pvDeadLoadPsf` **already contains the racking**, yet the projection labels it "PV Modules" and adds an invented `× 0.15` "Racking / Rails" row on top. The correct decomposition (`moduleDeadLoadLbs = 1550`, `rackingDeadLoadLbs = 124`) exists one layer away and no renderer reads it. | `structural-engine-v4.ts:1439-1442`; `generatePermit.ts:637-638`; `structuralEngine.ts:174-175`; render `structuralPages.ts:888-889` | propagation/reconciliation repair |
| **D53** | COMBINED (`pv + 15`) and ADDED (`module + racking + 0.2`) share no arithmetic. The code comment shows this was known and left unreconciled on the same table. | `generatePermit.ts:636` / `structuralPages.ts:723` vs `:758-763` | propagation/reconciliation repair |
| **D54** | Existing-roof dead load is a **hardcoded 15.0 PSF**, never set on the permit path, **never printed**, and contradicted twice by the sheet's own prose ("typically 8–12 PSF"). It is load-bearing: it drives the truss branch (`:505`), the rafter branch (`:562`), the **rail** check (`:1470`) and the ballasted path (`:792`). **No release gate covers dead load at all** — zero dead-load tokens in the registry; wind and snow have a full `environmentalLoadAuthority`. | `structural-engine-v4.ts:485`; `lib/permit/utils/structuralInput.ts:76-109, 126-187`; `structuralPages.ts:892, 898-899` | source-of-truth repair + data acquisition problem (prose half: rendering-only repair) |
| **D55** | The engine used **50 lb**, not the module's 44.1 lb. **Root cause (new):** `panelWeightLbs` reads `(getPanelById(...) as any)?.weightLbs`, but `SolarPanel` declares **`weight`** — the `as any` cast suppresses the error, so the value is always `undefined` and `arrayLayout.ts:97` falls to `|| 50`. **Same field-name bug class as the CAD `.lengthIn` vs `.length` defect.** Overstates module dead load by +13.379 %. | `app/engineering/page.tsx:8051` (and `:15232`); `lib/equipment-db.ts:24, 468`; `lib/permit/utils/arrayLayout.ts:97-98` | source-of-truth repair |
| **D56** | `addedDeadLoadPsf` is computed on the **bounding box** (706.037 ft², includes weightless gaps) but reconciled against the **module footprint** (636.461 ft²). "Expected Σ dead" is 164.951 lb (9.854 %) below the array's physical weight. The expected column also uses the 3-dp value while the actual column uses the raw one. | `structural-engine-v4.ts:1441` vs `structuralAuthority.ts:292, 299-306, 570` | source-of-truth repair |
| **D57** | The engineering page reports **1.5 PSF** racking (hardcoded) and inverts the meaning of `totalDeadLoadPsf` (added-only vs combined). Three racking values for one design: 1.5 (UI), 0.356 (planset), 0.176 (engine). | `app/engineering/page.tsx:6224-6231`, rendered `:12770-12781` | propagation/reconciliation repair |
| **D58** | `keep-if-set` guards remain on the three dead-load fields while the equivalents for wind and attachment were deliberately removed. `generatePermit` mutates `input.compliance.structural`. Latent. | `generatePermit.ts:636-639`; cf. the removal rationale at `:586-589` | source-of-truth repair (latent) |
| **D59** | Fence and ground sheets render `structural.totalDeadLoadPsf` — the **roof run's** `pv + 15` — under "TOTAL ADDED DEAD LOAD … transferred to fence post foundations". Hybrid only. | `structuralPages.ts:223, 293, 490, 568`; `generatePermit.ts:574-575` | propagation/reconciliation repair |

**Two lane claims refuted (contested), corrected here:**
- **F-7's worked hazard cannot occur.** The engineering page writes to `compliance.structural.deadLoad.totalDeadLoadPsf` (nested, `page.tsx:6224` opens `deadLoad: {`); the guard and the renderer read the **top-level** field. The guards are still a real latent staleness risk; the illustrative scenario is not.
- **F-8's fence-only scenario is unreachable.** The structural block is gated on `if (needsCalc && (sysType === 'roof' || cad.hybrid))` (`generatePermit.ts:548`), so a fence-only project prints `—`. The **hybrid** half of F-8 stands.
- Lane precision was wrong in the 8th–10th decimal on four values and the 5th on the 44.1 lb figure; corrected above. No rendered digit changes. The lane's corroborating artifact `_tmp_head_live.snapshot.json` is a **different run** (`meta.digest 8e6b472d…`, `addedDeadLoadPsf 2.642`, zero snow) — not evidence about BRAIDON. The confirmation rests instead on the audit run's own printed reconciliation.

---

## 7. Test gaps

**The model to copy is `ROUTE-LENGTH-ESTIMATE`** — the only one of the 12 with a complete shape: emission-positive on the live state (`ws5-braidon-truth-state.test.ts:100-118`), clear on a **separate controlled identity** through the **real service** (`ws5-field-measurement-reachability.test.ts:53-62, 244-281`), recording ≠ verifying (`:214-218`), reopen paths (`:333-388`), and an anti-hand-mutation guard (`Object.isFrozen` + a throwing write, `:389-399`).

| ID | Gap | Cite | Class |
|---|---|---|---|
| **T1** | **TAP-CONDUCTOR-LENGTH-PENDING has no clear test and none could exist** (D34). `tar-tap-topology.test.ts:83-90` asserts it stays open — currently unfalsifiable. PRR §4b avoids it by switching to `LOAD_SIDE` (`prr-release-reachability.test.ts:477`). | as cited | source-of-truth repair (feature) |
| **T2** | The D4 tests exercise a branch production cannot reach — they set `projectJurisdictionAuthorityId` in their own helper while the only call site never supplies it (D25). **A test proving a path production does not take.** | `tests/planset/r7-d4-legal-jurisdiction.test.ts:49-54` vs `rackingAssembly.ts:508-515` | propagation/reconciliation repair |
| **T3** | **FASTENER-ASSEMBLY-UNVERIFIED has no clear proof at all.** `resolveFastenerVerification` is never exercised positively; the only "absent" assertion is on a hand-built record with `resolved = true` injected. PRR §4b picks a Tesla mount specifically to avoid it. | `release-gate-model-rgm.test.ts:433`; `prr-release-reachability.test.ts:441-444` | registry/release-gate repair (test) |
| **T4** | No test asserts any registry entry has non-empty `affectedSheets` on a **real** snapshot; the `> 0` check runs only on synthetic records hardcoding `['RS-1']`. D28 is unprotected. | `release-gate-model-rgm.test.ts:226, 711-784` | registry/release-gate repair (test) |
| **T5** | FRAMING and RAIL-SELECTION prove the whole upstream chain and **stop one hop short** of asserting the registry entry disappears. The D12 test's own title names the untested half. | `snapshot-w3-structural.test.ts:255-304`; `r7-d12-rail-selection-persistence.test.ts:220-228, 261-277` | registry/release-gate repair (test) |
| **T6** | **PRR's flagship assertion is vacuity-tolerant** — `expect(unresolved).toEqual(['ENGINEERING-REVIEW-PENDING'])` produces the same array if every emitter went silent. Its counterweight covers 11 of 12; the exception is EQUIPMENT-DOCUMENT-APPLICABILITY, whose only protection is three `p13-*`/`qcable-*` emission-positive tests. | `prr-release-reachability.test.ts:643-651` | registry/release-gate repair (test) |
| **T7** | `KNOWN_EMITTABLE_CODES` and `BRAIDON_19` are hand-maintained literals — already stale (`BRAIDON_19` still lists `CONDUIT-FILL-PENDING`, which no longer fires). `validateReleaseGateMap` never inspects an emitter. Derive both from a source scan. | `release-gate-model-rgm.test.ts:36-79`; `releaseGates.ts:1498-1535` | registry/release-gate repair (test) |
| **T8** | **Zero tests lock the dead-load table.** The only dead-load test asserts the absence of three legacy literals. Nothing asserts components-sum-to-total, combined-minus-added, or that racking matches the engine. | `tests/planset/data-accuracy-audit.test.ts:36-58` | registry/release-gate repair (test) |
| — | Conditional assertions that can silently no-op: `cmda-module-document-authority.test.ts:349-353` (the two most important renderer assertions vanish if the row stops clearing); five `if (…) return;` early exits in `r7-d12-…:96, 127, 154, 169, 298`; `code-authority-w4.test.ts:66-77`. | as cited | registry/release-gate repair (test) |

**Tests that pin the current unresolved state** (would need rewriting on genuine resolution): `blocker-preservation-s18.test.ts` (11-code literal + `every resolved === false`), `ws5-braidon-truth-state.test.ts` (**the correct pattern** — its header distinguishes workflow closure from project closure), `release-gate-model-rgm.test.ts:64-79`, `p13-ws4-racking-assembly.test.ts:141-146`, `p13-evidence-specificity.test.ts:212-214`, `qcable-connector-architecture-closure.test.ts:176-179`, `tar-tap-topology.test.ts:76-90`, `ecd-ws1-procurement-authority.test.ts:283-296` (witness-based — already down from three witnesses to two as the campaign succeeded).

---

## 8. Recommended repair order

No requirement is to be cleared by inference. Every item below is a code or data act with a stated clear condition.

**Tier 0 — safety / false-clear risk (do first)**

| # | Repair | Defects | Class |
|---|---|---|---|
| 1 | Consume the engineering-review record in **PASS 2**, after `meta.digest` is frozen; until then make `framingAuthority` branch 2 fail closed. One fix serves both: an approval must not move the digest it approves, and `currentDigest` must not be derived from the record being checked. | D44, D45 | propagation/reconciliation repair + source-of-truth repair |
| 2 | Pass the **canonical** `legalJurisdiction.{ahjName, ahjRecordId}` into both the document *selection* criterion (`resolvers.ts:284`) and the clearance *comparison* (thread `projectJurisdictionAuthorityId` + `requiredSubstrate` through `BuildRackingAssemblyOptions` → `rackingAssembly.ts:508-515`). **Do NOT repair the four rows' jurisdiction first** — in isolation that moves them from "rejected" to "invisible". | D24, D25 | propagation/reconciliation repair |
| 3 | Supply a `resolutionAuditRef` when PASS 2 sets `resolved = true` (or make `permitReadiness.ready` use `deriveRequirementStatus`). Prevents RS-1 printing "no open release gates" beside `open-gate-count=1`. | D51 | registry/release-gate repair |
| 4 | Remove `FASTENER-ASSEMBLY-UNVERIFIED` from `racking-capacity-document@v1`'s `requirementCodes`, or feed the fastener predicate from the capacity document. | D33 | registry/release-gate repair |

**Tier 1 — dead requirements (a gate that cannot close is worse than an open one)**

| # | Repair | Defects | Class |
|---|---|---|---|
| 5 | Give `TAP-CONDUCTOR-LENGTH-PENDING` a writer. Cheapest correct route: emit a `TAP_CONDUCTOR_RUN` route segment (`PROJECT_OWNED`/`REQUIRED`), link `svc-tap-conductors` to it, derive the constraint from `measuredLengthFt <= 10`. The DB needs no change (`118_field_route_measurements.sql:97` is unconstrained). First resolve the possible duplication with `DISCO_TO_METER_RUN` — **designer/engineer ruling required, NOT ESTABLISHED in code.** | D34 | source-of-truth repair |
| 6 | Wire `manufacturer_document_registry` into `ra.datasheetSource`/`capacitySource` (today `documentRoles.fastenerAuthority`/`installationAuthority` are unconditional `unfilledRole` calls). Until then, verifying any document cannot clear FASTENER. | D22 | propagation/reconciliation repair |
| 7 | Decide EQUIPMENT-DOCUMENT-APPLICABILITY from the archived registry document rather than the static asset's `docTitle` (the canonical `equipmentDocumentAuthority` region already does this and is bypassed by all three call sites). Either that, or implement a producer for `DocumentApplicabilityAlias`. The version-exact RT-MINI manual is already archived and hashed. | D21, and the 3-way duplication at `structuralAuthority.ts:171, 1001` + `build.ts:2681` | source-of-truth repair |
| 8 | Add an `extracted_claims` update path (or accept that repair = a new row) and fix both broken verification UI paths. | D26, D19 | source-of-truth repair + registry/release-gate repair |
| 9 | Fix `code-authority@v1` to key the registry query on the **verified boundary determination**, not the mailing city, and declare `legalJurisdiction` as a required input. **This is the prerequisite for the AHJ data acquisition to be worth doing.** | D1, D2, D3 | propagation/reconciliation repair |

**Tier 2 — arithmetic and numbers on the sheet**

| # | Repair | Defects | Class |
|---|---|---|---|
| 10 | Print the existing-roof PSF actually used; delete or reconcile the unsourced "8–12 PSF" prose; introduce a dead-load authority analogous to `environmentalLoadAuthority` (this would honestly add a **13th** requirement — the current 12 do not cover dead load). | D54 | source-of-truth repair + data acquisition problem + rendering-only repair |
| 11 | Project the dead-load rows off `structuralEngine`'s own `moduleDeadLoadLbs`/`rackingDeadLoadLbs`; delete the `× 0.15`; publish `existingRoofDeadLoadPsf` as its own row; assert `combined − added === existingRoof` and `module + racking === addedDeadLoadPsf`. | D52, D53 | propagation/reconciliation repair |
| 12 | Fix `.weightLbs` → `.weight` at `page.tsx:8051`/`:15232` **and** route `panelWeightLbs` through `resolveModuleIdentity()`; assert `engine.moduleDeadLoadLbs === panelCount × weight` and that no `\|\| 50` literal remains. | D55 | source-of-truth repair |
| 13 | Decompose the double-applied 1.15 slack; wire `describeLegacyEstimateProcurement` (zero callers today). | D39 | propagation/reconciliation repair |
| 14 | Single-denominator the dead-load PSF (module footprint, matching the reaction model); assert `addedDeadLoadPsf × area === totalSystemWeightLbs`. | D56 | source-of-truth repair |
| 15 | Re-derive ROOF_RUN's length from the bonding-EGC route and give it a truthful `electricalFunction`; fix the `DISCO_TO_METER_RUN` regex. **Keep the segment and keep the requirement naming it.** | D35, D36 | source-of-truth repair + rendering-only repair |
| 16 | Stop stamping one provenance literal on every segment; persist `derivationNotes`; patch `voltageDropPct` when `branchCablePaths` patches the length. | D37, D38, D43 | source-of-truth repair + propagation/reconciliation repair |

**Tier 3 — registry integrity**

| # | Repair | Defects | Class |
|---|---|---|---|
| 17 | Implement the declared §2.9/§2.10 split — `rtClearance.missing` already separates archival from applicability fields. | D23 | registry/release-gate repair |
| 18 | Give EQUIPMENT-DOCUMENT-APPLICABILITY a META entry (`sheets: ['PV-3','DS-3','APP-A']`) or classify it `structural`; add a build-level assertion that every registry entry has non-empty `affectedSheets`. | D28 | registry/release-gate repair |
| 19 | Fix `assemblyVerification.overall` (feed the projection's fastener verdict back, remove the `as string` cast) — class-A procurement, racking bonding method and the projected assembly state are all permanently capped today. | D20 | propagation/reconciliation repair |
| 20 | Give the async lifecycle the `owns` semantics the derived stage already has; a `SKIPPED` acknowledgement must not wipe a real clearance. | D60 (`lifecycle.ts:353-368` vs `derived.ts:440`; `structuralResolvers.ts:777-786`) | propagation/reconciliation repair |
| 21 | Key resolution states per **instance**, not per code (one `MODULE-EXACT-DATASHEET-PENDING` per module, one `EQUIPMENT-IDENTITY-CONFLICT` per pair). | D61 (`build.ts:1942, 1978-1979`; `releaseGates.ts:1044-1048`) | propagation/reconciliation repair |
| 22 | Run the RGM verification suite in production (`verifyNoUnmappedRequirements`, `verifyIssueStateAgreement`, `validateReleaseGateMap`) and surface `invariantViolations`; add the declared-vs-emittable diff as a test. Remove the dead `RACEWAY-BONDING-AUTHORITY` map entry. | D63, D64, D66 | registry/release-gate repair + propagation/reconciliation repair |
| 23 | Fail-close the empty-route-set emitter; single-source the residual derivation. | D40, D42 | registry/release-gate repair + propagation/reconciliation repair |
| 24 | Add `SEVERITY_POLICY` entries for the three RG-6 QCABLE codes (today they fail closed to ALL_AXES with an empty justification, contradicting their own `affects` text). | D62 | registry/release-gate repair |
| 25 | Retitle RG-2 per CMDA; fix the DS-1 model label; fix the PV-3 doubled chip; make the "(SKU unpinned)" literals conditional (that field is digested). | D16, D15, D32, D31 | rendering-only repair |
| 26 | Surface the full 64-char digest to the reviewer; add a licensed-reviewer authorization scope distinct from platform admin; correct or close the PASS-2 digest contract. | D46, D47, D48 | registry/release-gate repair + propagation/reconciliation repair |
| 27 | Retitle DESIGNER-OF-RECORD-MISSING to name only the designer; re-domain it out of `'document'`. | D49, D50 | registry/release-gate repair |
| 28 | Route the designer through `produces` rather than mutating `ctx.input.project`; make `code-authority@v1`'s `providerConfigured` informative. | D65, D5 | propagation/reconciliation repair + registry/release-gate repair |
| 29 | Close the test gaps in T1–T8 order. | T1–T8 | registry/release-gate repair |

**Tier 4 — data acquisition (do only after the paths above work)**

| # | Act | Class |
|---|---|---|
| 30 | Obtain `AHJ_REGISTRY_TOKEN` (free, `support@sunspec.org`) **and/or** obtain Madison County's IBC/IRC/IFC adoption ordinance and record it through a governed operator verification — **after** repair #9, otherwise the correct row is never inspected. Whether SunSpec carries these editions for `il-madison-county` is **NOT ESTABLISHED**. | data acquisition problem / legitimate unresolved external authority |
| 31 | Register + human-verify the Q CELLS G10+ 385–405 W family datasheet with the exact `extracted_claims.module` block specified in §2. Requires repair #8. | data acquisition problem |
| 32 | Seed one `personnel_roles` org-default designer row. Clears DESIGNER-OF-RECORD-MISSING for this and every future project. | data acquisition problem |
| 33 | Pin a rail SKU through `POST /api/projects/[id]/rail-selection`. Clears exactly one requirement. | design decision |
| 34 | Field-measure the four residual runs and verify each with separation of duties. Clears ROUTE-LENGTH-ESTIMATE. | legitimate unresolved external authority (field) |
| 35 | Obtain a stamped framing capacity document or a PE review; obtain a PE approval of the **post-designer, post-repair** digest. | legitimate unresolved external authority |
| — | **RACKING-CAPACITY-APPLICABILITY-GAP is not acquirable.** Roof Tech publishes no gen-1 RT-MINI stamped PE letter and no cross-reference statement (`structuralDocuments.ts:66-75, 119-130`). The only design-side resolutions are selecting a mount with published capacity authority, or a project-specific stamped analysis. | legitimate unresolved external authority |

### NOT ESTABLISHED (do not infer)

- Whether SunSpec/Orange Button carries IBC/IRC/IFC for `il-madison-county` (no token; no network probe of an authenticated endpoint was made).
- Whether `svc-tap-conductors` and `DISCO_TO_METER_RUN` are the same physical span. No code asserts or denies it; nothing traverses `upstream/downstreamObjectId`.
- `affectedSheets` / `authorityPath` for CODE-AUTHORITY-INCOMPLETE, MODULE-EXACT-DATASHEET-PENDING, DESIGNER-OF-RECORD-MISSING, ENGINEERING-REVIEW-PENDING — not captured in this pass.
- Whether the IQ8A + Q.PEAK factory leads genuinely reach without field-run DC conductor (asserted in prose at `bom-engine-v4.ts:1395-1402`, no cited manufacturer document).
- Whether any UI can set `roofDeadLoadPsf` (the only non-test setter is `app/api/engineering/calculate/subSystemStructural.ts:89`; no bound `.tsx` input found, but clients of that endpoint were not enumerated).
- Whether `compliance.jurisdiction.ahj` on the stored BRAIDON input could be corrected by an operator act — which would silently fix both jurisdiction reads with no code change. The stored `permit_input.json` was not read.
- Whether the `braidonOriginalAuditFixture` build emits the same 12 codes as the live regen (`blocker-preservation-s18` injects three of its states and runs the pure path).
- Magnitude of the `voltageDropPct` staleness in D43.
- Whether the `EQUIPMENT-DOCUMENT-APPLICABILITY` empty `affectedSheets` was a deliberate package-wide choice; two code comments point the other way, but it is not proved.