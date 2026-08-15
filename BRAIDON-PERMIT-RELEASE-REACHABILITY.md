# BRAIDON PERMIT RELEASE REACHABILITY — ROOT CAUSE AND REPAIR

**Date:** 2026-08-04 · **Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev`
**Baseline commit:** `c9862ab9319a574b2658e624de9945ecf5158e58` (== `origin/dev` at start)

---

## 1. Executive verdict

The ISSUED-FOR-PERMIT release state was **structurally unreachable for every project in the
system**, by five independent defects stacked on the same code path. No amount of document
archival, field measurement, equipment reconciliation, racking selection or PE review could ever
have released a package, because the release gate could not evaluate to `true` under **any**
runtime state whatsoever.

The prior audit's headline finding (`engineerReviewCoversCurrentDigest: false` hardcoded in
`lib/permit/snapshot/build.ts`) is **CONFIRMED** — and was the least of it. Beneath it sat a
circularity that made the whole approval concept inoperative: **the snapshot digest covered the
projection of the approval itself**, so recording an approval for digest `D` produced a snapshot
whose digest was `D′ ≠ D`. The test every consumer applies — `reviewedDigest === meta.digest` —
was therefore unsatisfiable for any approval that has ever been or could ever be recorded.

The earlier diagnosis that "zero of the 14 unresolved requirements are software defects" is
**wrong**. At minimum `ENGINEERING-REVIEW-PENDING` was a software defect: a requirement whose
closure condition could not be reached by any workflow.

**After the repair,** a controlled project with complete authority and a valid current-digest
licensed approval reaches `ISSUED FOR PERMIT` with **0 open requirements and all 8 gate
preconditions satisfied**, proven end-to-end through the real engine. Missing, stale, revoked,
superseded, digest-mismatched, unlicensed, unscoped and ledger-invalidated approvals all fail
closed, each with a named reason.

**Braidon itself correctly remains `PENDING ENGINEERING REVIEW`** — it has no PE approval, and
manufacturing one would have made the live truth-state a lie. What changed for Braidon is that
its blocker is now *only* the genuinely absent approval; previously it was **also** permanently
latched false by 22 stale ledger rows that nothing could ever clear.

**Phase status: BLOCKED** on the acceptance condition "every machine-closable Braidon requirement
is closed" — see §12. The release-authority repair itself is complete, tested, and verified.

---

## 2. Baseline state (before repair)

Reproduced with `npx tsx _tmp_pr_baseline.ts` (harness reads the DB URL from `../.db_url`; no
credential is embedded in it).

| | design-review | permit | full |
|---|---|---|---|
| Snapshot | `PDS-A12887F9B4F0` | `PDS-C29DD1DDC547` | `PDS-2876AB34343A` |
| Digest | `a12887f9b4f0b4fd…` | `c29dd1ddc547ab97…` | `2876ab34343a7fa4…` |
| Sheets | 19 | 18 | 25 |
| Open release gates | 5 | 5 | 5 |
| Unresolved requirements | 14 | 14 | 14 |
| Release state | PENDING ENGINEERING REVIEW | PENDING ENGINEERING REVIEW | PENDING ENGINEERING REVIEW |

- **Project:** `BRAIDON M PILLA — Solar` (`projects.name`), id `4030b664-bebe-433b-a11c-cda05ead2f7d`
  — but `engineering_config.projectName` is **`BRAIDON M PILLA — Solar TEST`**, and the permit path
  reads the config copy.
- **Review records:** `engineering_review_records` exists (migration 116 applied 2026-07-29);
  **0 rows for this project**. Reviewer identity: none. Review type: none.
- **Migration 118** (`118_field_route_measurements.sql`) **IS applied** — 2026-08-03T20:58:19Z, by a
  human actor. Tables `field_route_measurements` + `field_route_measurement_events` exist, **0 rows**
  for Braidon. (A prior session note claiming it was unrun is stale.)
- **Invalidation ledger:** 22 ACTIVE `snapshot_digest_invalidations` rows, all `digest = NULL`,
  all `superseded_at = NULL`, written 2026-07-28/29 by repeated equipment reconciliations.
- **Gate:** 7 of 8 preconditions failing; only `equipment-identity` passed. The review precondition
  reported *"review invalidated by a snapshot_digest_invalidations ledger entry"*.
- **Artifacts:** `_tmp_pr_baseline_{design-review,permit,full}.html` + `.snapshot.json`,
  `_tmp_pr_baseline_summary.json`.

---

## 3. Root cause

Five defects, all on the release path, all mutually reinforcing.

### RC-1 — `engineerReviewCoversCurrentDigest: false` hardcoded
`lib/permit/snapshot/build.ts:2169` (pre-repair), comment *"no review record at build"*.
Stale since AAC WS-9 wired the coverage record **24 lines above it**. The gate precondition could
never be satisfied.

### RC-2 — `signatureSealSatisfied: false` hardcoded
`build.ts:2176`, comment *"certification.engineer === null at build"*. Also untrue since WS-9:
`certification.engineer` is populated from the same coverage record at `build.ts:2555`. A second
permanently-unsatisfiable precondition.

### RC-3 — `currentDigest: ''` passed to `buildProjectAuthority`
`build.ts:2262`, comment *"review === null ⇒ digest unused"*. Once WS-9 started supplying a review,
this was no longer true: a 64-hex `reviewedDigest` never equals `''`, so `deriveIssueState`
classified **every real approval as a digest MISMATCH** and returned `REVISED` —
*"prior approval invalidated by a design change"* — for a design that had not changed.
**Supplying a legitimate PE approval actively made the package look worse.**

### RC-4 — the digest covered the approval (the deep one)
`computeSnapshotDigest` hashes the entire snapshot except `meta.digest`/`meta.snapshotId`. The
approval projection lives **inside** that hash: `certification.engineeringReviewApproved`,
`certification.engineer`, `projectAuthority.issueState` / `issueStateBasis` / `engineerReviewStatus`
/ `revisionHistory[0].description` / `sheetIndex` (the RS-1.n QA sheets shrink when the review
requirement closes), the `permitReadiness` registry entry, and `resolutionAuthority.engineeringReview`.

Therefore **recording an approval of `D` produced a snapshot whose digest was `D′ ≠ D`**, and
`reviewedDigest === meta.digest` — the identical test applied by `validate` V33/V34, `certPages`,
`plansetProfile.certificationIsCompleted` and `peLetterIdentity` — was unsatisfiable for every
approval that could ever exist. Signing a document changed the document it signed.

Measured before the repair (`_tmp_pr_circular.ts`):
```
UNREVIEWED   digest = 5c2b292749de7ca2…
REVIEWED(D1) digest = 9a1a93de5a246a14…   D1 === D2 ? false   ⇒ UNREACHABLE (circular)
issueState   = REVISED   reviewStatus = "STALE — prior approval invalidated by a design change"
```

### RC-5 — the authority ledger was a permanent one-way latch
`digestInvalidationLedgerResolver` (`resolution/resolvers.ts`) read
`listActiveInvalidations(projectId)` — **project-scoped, not digest-scoped** — and returned
`invalidated = rows.length > 0`. The writer (`lib/reconciliation/reconcile.ts:204-217`) records
`digest: null`, and **`superseded_at` is written nowhere in the codebase** (it appears only in the
`SELECT` filter at `reconcile.ts:399`). So one equipment reconciliation blocked every future
approval on that project *forever*. Braidon carries 22 such rows. Even with RC-1…RC-4 fixed,
`reviewCovers = … && !digestInvalidatedByLedger` would still have been false.

### RC-6 (found during repair) — V13 was a render-level hardcode of the same assumption
`generatePermit.ts` required the literal `PENDING ENGINEERING REVIEW` on **every** CERT/PE-1 sheet
unconditionally, with `offendingValue: false` baked in. It was written when approval was impossible,
so "always pending" and "matches the record" were the same assertion. Once approval became
reachable, this **threw a blocking SnapshotValidationError on every approved package** — the engine
refused to emit the artifact the approval exists to release.

### RC-7 (found during repair) — the EOR identity was never printed
`certPages.ts` `_peSigBlock()` and the CERT "PREPARED BY" block emitted blank rules
(`NAME: ______`, `PE LICENSE #: ______`, `STATE OF LICENSURE: ______`, `Date of Certification: ______`)
in **every** state, because `certification.engineer` was always `null`. This is the reported
"blank designer and Engineer-of-Record information".

---

## 4. Call-path map

```
recordEngineeringReview()                      lib/engineeringReview/store.ts
  └─ engineering_review_records                migration 116 (applied 2026-07-29)

resolveEngineeringReviewCoverage(projectId, priorDigest)   store.ts:131
  └─ findActiveApproval()                      SQL filters decision='approved'
                                               AND superseded_at IS NULL AND digest=exact
  └─ EngineeringReviewCoverage                 lib/engineeringReview/types.ts

engineeringReviewRecordResolver                resolution/structuralResolvers.ts
digestInvalidationLedgerResolver               resolution/resolvers.ts:128   ← RC-5
  └─ listActiveInvalidations(projectId)        lib/reconciliation/reconcile.ts:395

resolveSnapshotAuthorityInputs()               snapshot/authorityInputs.ts:49
  └─ SnapshotAuthorityInputs                   resolution/types.ts:218

generatePermitHTML()                           permit/generatePermit.ts
  └─ buildPermitDesignSnapshot(input, cad, opts)        snapshot/build.ts
       PASS 1 (review-neutral)
         ├─ permitReadiness registry           build.ts ~2099   ENGINEERING-REVIEW-PENDING
         ├─ _paGateInput                       build.ts ~2169   ← RC-1, RC-2
         ├─ _paArgs → buildProjectAuthority()  build.ts ~2262   ← RC-3
         │    ├─ evaluateIssuedForPermitGate() projectAuthority.ts:224
         │    └─ deriveIssueState()            projectAuthority.ts:137
         ├─ certification                      build.ts ~2585
         └─ computeSnapshotDigest()            snapshot/digest.ts:28   ← RC-4
       PASS 2 (after the design digest exists)                     ← THE REPAIR
         └─ decideReviewCoverage()             snapshot/reviewCoverage.ts  [NEW]
              ├─ invalidationApplies()         digest- and time-scoped   ← fixes RC-5
              └─ rebuild projectAuthority / certification / registry / sheetIndex

  └─ validatePermitDesignSnapshot()            snapshot/validate.ts   V33 / V34
  └─ V13 render invariant                      generatePermit.ts      ← RC-6
  └─ certPages / peLetterIdentity              sections/certPages.ts  ← RC-7
```

**Definitive answers**

| Question | Answer |
|---|---|
| Is the value hardcoded? | **Yes** — three literals (`false`, `false`, `''`) at build.ts 2169/2176/2262 |
| Is valid review data already available? | **Yes** — `_reviewCoverage` at build.ts:1655, used 24 lines later |
| Is it discarded or ignored? | **Yes** — for the gate and the issue state; only `certification` consumed it |
| Could any runtime state make the condition true? | **No** — unreachable for every project, RC-1 alone, and independently by RC-4 and RC-5 |
| Was ISSUED FOR PERMIT reachable before? | **No** — proven in `PRR §3` |
| Multiple/conflicting release authorities? | **Yes** — the registry entry, `certification`, the gate and the issue state were decided by *different* predicates; a review of a foreign digest cleared the registry while the gate stayed false |
| Stale fallback paths overriding real coverage? | **Yes** — RC-5's project-scoped ledger latch overrode any real approval |

---

## 5. Why previous workstream acceptance failed to detect this

1. **The tests pinned the defect.** `tests/planset/aac-ws8-ws9-structural-lifecycle.test.ts`
   asserted that an approval naming an **arbitrary** digest (`'c'×64`, never the build's own) CLEARS
   the requirement and projects onto `certification`. That is the bug, written down as the contract.
   No test ever built a snapshot, took its digest, and fed *that* digest back as an approval — the
   one experiment that exposes the circularity in a single step.
2. **Half-migrations left stale comments that read as reasons.** WS-9 wired `_paReview` and
   `certification` but not the gate input or `currentDigest`. The literals it left behind carried
   comments (*"no review record at build"*, *"certification.engineer === null at build"*,
   *"review === null ⇒ digest unused"*) that were true when written and false afterwards. Each read
   as a justification rather than as a TODO.
3. **Fail-closed was treated as always-correct.** A precondition that is *permanently* false is
   indistinguishable from one that is *correctly* false unless something proves the true branch is
   reachable. Nothing did.
4. **"Requirement count went down" was the success metric.** Because the requirement can only close
   via an approval nobody could record, its persistence looked like honest engineering residue
   rather than a broken mechanism.
5. **The ledger latch was invisible from source.** `rows.length > 0` looks fail-closed and correct.
   Only the live data (22 never-superseded, digest-null rows) shows it is a permanent latch, and only
   a codebase-wide search shows `superseded_at` is never written.

---

## 6. Files changed

| File | Change |
|---|---|
| `lib/permit/snapshot/reviewCoverage.ts` | **NEW** — the single pure review-coverage decision + digest/time-scoped ledger rule |
| `lib/permit/snapshot/build.ts` | Two-pass build: review-neutral design digest, then the approval projection. Removes RC-1/2/3 |
| `lib/permit/generatePermit.ts` | V13 made two-sided (RC-6); threads `digestInvalidations` preserving `null` |
| `lib/permit/sections/certPages.ts` | `approvingEngineer()`; PE signature block + CERT "PREPARED BY" print the licensed identity (RC-7) |
| `lib/permit/snapshot/resolution/resolvers.ts` | Ledger resolver emits the ACTIVE ROWS, not just a count |
| `lib/permit/snapshot/resolution/types.ts` | `digestInvalidations` on the authority bundle |
| `lib/permit/snapshot/resolution/lifecycle.ts` | Honest `[]` seed (≠ `null` = unreadable) |
| `tests/planset/prr-release-reachability.test.ts` | **NEW** — 35 tests |
| `tests/planset/aac-ws8-ws9-structural-lifecycle.test.ts` | Corrected the test that pinned the defect |
| `tests/planset/aac-ws3-ws4-ahj-environmental.test.ts`, `ecd-ws1-procurement-authority.test.ts` | Bundle field added |

---

## 7. Release-authority repair

**The design digest identifies the DESIGN, not its approval state.**

`buildPermitDesignSnapshot` now runs in two passes. Pass 1 builds the snapshot exactly as if
unreviewed and digests it — that is the **design digest**, and for an unapproved package it is
**byte-identical** to what the function produced before. Pass 2 runs *after* the digest exists,
decides coverage against it, and projects the approval onto `certification`, the release registry,
the sheet manifest, the issue state and the gate. `meta.digest` does not move.

`decideReviewCoverage()` grants coverage only when **all** of these are positively established, and
names the refusal otherwise:

1. a coverage record exists and the store was readable
2. the store matched an ACTIVE, `approved`, non-superseded record (SQL-enforced)
3. the reviewer's role is LICENSED (`engineer_of_record` | `approving_engineer`)
4. the reviewer identity is complete — name **and** licence number **and** licence state
5. the approval carries a scope statement (never a bare boolean)
6. the approval names a valid 64-hex digest
7. that digest is EXACTLY this build's design digest
8. no active authority-ledger invalidation applies

`signatureSealSatisfied` is derived from the same record (named licensed professional + licence +
jurisdiction + explicit scope + exact bytes approved). The wet signature and seal rules stay blank
on the sheet — affixing a seal is a physical act.

**The ledger rule** (`invalidationApplies`) now matches what the writer says it means: a row that
*names* a digest invalidates an approval of that digest; a row with a **null** digest invalidates
approvals recorded **at or before** it (those are the approvals "tied to the old digest"); an
unreadable ledger invalidates everything; unorderable timestamps fail closed. Braidon's 22 rows
(≤ 2026-07-29) therefore no longer latch a new approval, but would still retire an older one.

No presentation-only override was added. No professional requirement was weakened.

---

## 8. Tests added

`tests/planset/prr-release-reachability.test.ts` — **35 tests, all passing.**

- **§1 review coverage (mandated 1–6 + extras):** no review; pending; rejected/withdrawn/superseded;
  unlicensed role; no scope statement; incomplete identity; foreign project; different digest;
  malformed digest; **valid current-digest approval ⇒ TRUE**; unreadable store; unreadable ledger.
- **§2 ledger:** row naming this digest invalidates; row naming another does not; digest-null row
  invalidates approvals at/before it; **does not** invalidate a newer review; unorderable timestamps
  fail closed; unreadable ledger invalidates; **the live Braidon 22-row shape no longer latches**.
- **§3 pre-repair unreachability (mandated 14):** with the old literals the gate cannot pass under
  any input; with decided values it does; with `currentDigest: ''` a real approval reads as REVISED.
- **§4 end-to-end through the real engine (mandated 7, 8, 9, 11, 12, 13):** approving does not move
  the digest; a valid approval reaches REVIEWED with both preconditions passing and the requirement
  closed; no review fails closed; a design change moves the digest, drops the approval and *states
  why*; a new approval for the new digest restores coverage; a stale ledger row cannot retire a
  newer approval but one naming the digest can; an unreadable ledger fails closed; the approved
  package names its approver.
- **§4b end-to-end ISSUED FOR PERMIT (mandated 10, 12):** see §9.
- **§5:** the frozen Braidon fixture is unchanged — still PENDING, still no certification.

---

## 9. Reachability proof

A controlled project (**not** Braidon) with every authority record supplied through the real
sockets, built by the real engine:

```
WITHOUT the review   1 open requirement:  ENGINEERING-REVIEW-PENDING
                     gate FAIL:           engineer-review-current-digest, signature-seal
                                          (exactly the two that were hardcoded false)
                     issueState:          PENDING ENGINEERING REVIEW

WITH a licensed approval of that exact design digest
                     digest:              1123b984912d3d90…  (UNCHANGED by approving)
                     issueState:          ISSUED FOR PERMIT
                     open requirements:   0
                     gate.pass:           true      (no unsatisfied preconditions)
                     certification:       { reviewedDigest: 1123b984…, approvedAtIso: … }
                                          engineer: Jordan Vale, PE · 062-071234 · IL
```

The fixture is a design whose authority *can* be complete today: a rail-less **Tesla Panel Mount
Comp Rafter** (no unselected rail SKU; its cited source is an installation manual, not a
flashing/water-resistance ESR, which is not fastener authority), **Tesla Solar Panel TSP-420** (one
of five catalog modules with an exact-wattage rather than family datasheet), and load-side
interconnection (no supply-side tap conductor whose length NEC 705.11(C) would require).

A design change (`rafterSize 2x10 → 2x6`) moves the digest, drops the approval, and returns
`gate.pass = false` with `certification.engineeringReviewApproved = false`.

---

## 10. Live Braidon before / after

| | BEFORE (`c9862ab9`) | AFTER (repair) |
|---|---|---|
| Snapshot (full) | `PDS-2876AB34343A` | `PDS-002967B48B6F` |
| Digest (full) | `2876ab34343a7fa4…` | `002967b48b6fcf4e…` |
| Sheets | 25 / 18 / 19 | 25 / 18 / 19 (unchanged) |
| Release state | PENDING ENGINEERING REVIEW | PENDING ENGINEERING REVIEW |
| Open release gates | 5 | 5 |
| Unresolved requirements | 14 | 14 |
| Review records | none | none |
| Review precondition reason | *"review invalidated by a snapshot_digest_invalidations ledger entry"* | *"no approved review covering the current digest"* |
| Artifact | `_tmp_pr_baseline_*.html` | `_tmp_pr_after_*.html`, `_tmp_pr_shots/braidon_full.pdf` |

**Every count change explained:** there are none. Braidon's gates and requirements are unchanged
because it has no PE approval and this repair resolved no new authority for it — which is the
correct and honest outcome.

**The digest changed** for one deliberate reason: the `ENGINEERING-REVIEW-PENDING` message is now
invariant to the coverage record. It previously appended the resolver's basis string (which names
the digest queried), which put approval state back inside the design digest — exactly the
circularity being removed.

**The material change for Braidon** is the blocker *reason*. It was blocked by a ledger latch that
no action could clear; it is now blocked only by the genuinely absent approval. Braidon is now
capable of being released the moment a PE records one — which was not true before.

---

## 11. Updated Braidon gate ledger

5 open gates · 14 unresolved requirements.

| # | Requirement | Gate | Class | Release effect | Basis / exact runtime reason |
|---|---|---|---|---|---|
| 1 | `ROUTE-LENGTH-ESTIMATE` | RG-5 | FIELD_VERIFICATION | RELEASE_CRITICAL | 4 of 5 project-owned runs have no routed CAD geometry (ROOF_RUN, BRANCH_HOMERUN_RUN, COMBINER_TO_DISCO_RUN, DISCO_TO_METER_RUN). BRANCH_RUN *is* geometry-derived and not blocked; MSP_TO_UTILITY_RUN is correctly excluded (utility-owned). Migration 118 applied; `field_route_measurements` has 0 rows. Path is reachable end-to-end (WS-5). |
| 2 | `TAP-CONDUCTOR-LENGTH-PENDING` | RG-5 | FIELD_VERIFICATION | RELEASE_CRITICAL | Supply-side tap length unmeasured ⇒ NEC 705.11(C) ≤10 ft cannot be evaluated. Not derivable from canonical geometry: the tap point is inside existing service equipment. |
| 3 | `FRAMING-AUTHORITY-UNVERIFIED` | RG-4 | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL | No archived truss drawing / manufacturer calc / stamped analysis. Operator-entered geometry (2×6 @ 24" truss) is OBSERVATION, not capacity authority. |
| 4 | `PENDING-RACKING-ASSEMBLY-SELECTION` | RG-4 | MACHINE_CLOSABLE *(blocked on catalog data)* | RELEASE_CRITICAL | RT-MINI is a mixed-manufacturer assembly with no rail in the catalog, project record or equipment store. The engine correctly refuses to choose between manufacturers; it *does* bound the residual (IronRidge XR100/XR1000, Unirac SME/SolarMount). Closable by recording a rail SKU. |
| 5 | `FASTENER-ASSEMBLY-UNVERIFIED` | RG-4 | MACHINE_CLOSABLE *(blocked on catalog data)* | RELEASE_CRITICAL | Only cited source is ICC-ES **ESR-3575**, a flashing / water-resistance report, which carries no fastener-installation authority. **Proven closable**: the same code path clears when the mount's cited source is an installation manual (demonstrated with the Tesla Comp Rafter mount in §9). Needs a fastener-installation document reference on the RT-MINI catalog entry. |
| 6 | `EQUIPMENT-DOCUMENT-APPLICABILITY` | RG-2 | DOCUMENTATION_QUALITY | RELEASE_CRITICAL | Cited document covers **RT-MINI II**; selected mount is **RT-MINI**. No verified alias evidence. Version-exact document required. |
| 7 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` | RG-4 | DOCUMENTATION_QUALITY | RELEASE_CRITICAL | The 600 lb ASD allowable cites a Roof Tech PE structural letter not archived in-repo (`documentHash` null). |
| 8 | `RACKING-CAPACITY-APPLICABILITY-GAP` | RG-4 | DOCUMENTATION_QUALITY | RELEASE_CRITICAL | The 600 lb source is ASCE 7-10 / **KY** and does not cover the selected mixed-manufacturer paired rail; jurisdiction not confirmed for the project AHJ. |
| 9 | `CODE-AUTHORITY-INCOMPLETE` | RG-1 | MACHINE_CLOSABLE | RELEASE_CRITICAL | AHJ resolves **correctly** to *Madison County Building & Zoning* (the brief's "City of Granite City" finding is **stale — already fixed**). NEC 2020 is established; **IBC / IRC / IFC editions unknown**. Migration 117 (`ahj_registry`) is applied; the adoption record for this AHJ carries no building/residential/fire edition. |
| 10 | `PROJECT-AUTHORITY-UNVERIFIED` | RG-1 | MACHINE_CLOSABLE | RELEASE_CRITICAL | Address / APN / municipal boundary / AHJ / fire authority are operator-posted or postally inferred. `project-authority@v1` exists and its socket is wired; it returned no verification on this run. |
| 11 | `PROJECT-NAME-NONPRODUCTION` | RG-1 | MACHINE_CLOSABLE | RELEASE_CRITICAL | `engineering_config.projectName = "BRAIDON M PILLA — Solar TEST"` while `projects.name = "BRAIDON M PILLA — Solar"`. **The permit path reads the stale config copy rather than the canonical project row.** |
| 12 | `DESIGNER-OF-RECORD-MISSING` | RG-1 | MACHINE_CLOSABLE *(operator assignment)* | RELEASE_CRITICAL | `engineering_config.designer = ""`. Migration 115 declares `project_personnel_roles`, but **that table does not exist in the live database** despite the migration being recorded `applied` — see §17. |
| 13 | `MODULE-EXACT-DATASHEET-PENDING` | RG-2 | DOCUMENTATION_QUALITY | RELEASE_CRITICAL | On-file document is the 385–405 W **family** datasheet, not the exact 400 W sheet. The `module-datasheet-binding` resolver produces an authority record that **nothing consumes to close the requirement** — the blocker is emitted purely from the static asset library (`equipmentProjection.ts:307`). |
| 14 | `ENGINEERING-REVIEW-PENDING` | RG-7 | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL | No approved record covers the current design digest. **This was the software defect** (§3); the path is now reachable. |

---

## 12. Remaining machine-closable requirements — WHY THIS IS `BLOCKED`

Five of the fourteen are machine-closable and **were not closed in this pass**. Each is a distinct
repair that would have required either writing to Ray's production database or asserting
manufacturer/AHJ facts I have not verified:

| # | What must change | Where |
|---|---|---|
| 11 | Permit input must read the canonical `projects.name`, not `engineering_config.projectName` | permit route enrichment → `build.ts` `proj.projectName` |
| 12 | `project_personnel_roles` must actually exist (migration 115 is recorded applied but the table is absent), then the designer resolver can populate | migration 115 / `lib/personnel/store.ts` |
| 9 | AHJ registry adoption record for Madison County needs IBC/IRC/IFC editions | migration 117 data + `code-adoption@v1` |
| 10 | `project-authority@v1` must actually return verified fields for this address | `resolution/jurisdictionResolvers.ts` |
| 13 | `moduleDatasheetBinding.allBound` must be consumed to close the requirement | `equipmentProjection.ts` ← the same "produces an authority record nobody consumes" defect class as RC-1 |

Plus two catalog-data repairs (#4, #5) proven closable by the §9 fixture.

**I did not write to the production database.** Fixing #11/#12 by editing Ray's live project rows is
his call, not mine, and #9/#10/#13 are code repairs in other subsystems that this stop-the-line
change should not silently absorb.

---

## 13. Remaining field requirements

- **#1 `ROUTE-LENGTH-ESTIMATE`** — 4 named runs. Genuinely physical: no routed geometry exists in
  the CAD model for them. The measurement path is reachable end-to-end (migration 118 applied,
  service + RBAC + policy + 5 APIs + operator panel shipped in WS-5).
- **#2 `TAP-CONDUCTOR-LENGTH-PENDING`** — the supply-side tap run, inside existing service
  equipment. Not derivable from canonical geometry.

---

## 14. Remaining licensed-professional requirements

- **#3 `FRAMING-AUTHORITY-UNVERIFIED`** — existing-framing capacity requires a project-specific
  structural authority or a licensed-engineer review bound to the current digest.
- **#14 `ENGINEERING-REVIEW-PENDING`** — the PE approval itself. **Now recordable and now
  effective**, which is the point of this repair.

---

## 15. Permit-profile presentation changes

Verified by rendering the controlled project unapproved vs issued, per profile:

| Profile | State | Sheets | `NOT FOR PERMIT SUBMISSION` | `PENDING ENGINEERING REVIEW` |
|---|---|---|---|---|
| design-review | unapproved | 19 | ×6 | ×44 |
| design-review | **ISSUED** | 20 | **×3** | **×2** |
| permit | unapproved | 18 | ×3 | ×41 |
| permit | **ISSUED** | 20 | **×2** | **×2** |
| full | unapproved | 23 | ×12 | ×57 |
| full | **ISSUED** | 23 | **×2** | **×2** |

The QA worklist clears when the package is genuinely releasable — from 41 occurrences to 2 in the
permit profile (the residual 2 are the issue-state vocabulary in general notes, not sheet banners).

**Deliberately NOT changed:** the live Braidon permit profile still prints
`NOT FOR PERMIT SUBMISSION` ×15 and `PENDING ENGINEERING REVIEW` ×41. Braidon **is** not for permit
submission. Suppressing those labels on an unapproved package is precisely the forbidden
"convert a design-review package to a permit package through styling alone". The correct fix for
Braidon's banners is to close its requirements, not to stop printing them.

**Changed:** `ISSUED_FOR_PERMIT` now requires and *prints* the complete Engineer-of-Record identity
(§7, RC-7), and V13 enforces both directions — an unapproved CERT sheet must carry the pending gate,
and an approved one must name its approver and licence or the build fails.

---

## 16. Visual audit results

Rendered under **print media** at the 17×11 in envelope via
`node scripts/ws5-pdf-and-shots.mjs` (Chromium). Artifacts:
`_tmp_pr_shots/braidon_full.pdf` + 25 per-sheet PNGs; `_tmp_pr_shots/ctrl_issued.pdf` + 20 PNGs.

| Check | Result |
|---|---|
| All sheets present | ✅ 25/25 — PV-0, RS-1(.1/.2), PV-1, PV-1B, PV-3, PV-4C(.1), E-1, PV-4A, PV-4B(.1), PV-5, PV-6, SCHED(-2/-3/-4), APP-A, DS-1/2/3, CERT, PE-1 |
| **SLD complete, not clipped or split** | ✅ E-1 renders the full chain PV array → roof J-box → AC combiner → AC disconnect → MSP → utility meter, with EGC bus, 6 numbered callouts, legend, and 3 data tables (AC branch info / AC system calcs / equipment schedule). No clipping, no split. |
| **Structural engineering page complete** | ✅ PE-1 carries project info, PV parameters, existing roof construction, ASCE 7-22 analysis (wind 108 mph, snow 23.264 psf, SDC D, framing + lag-bolt sections), certification statement and PE-of-record block. |
| Cover sheet | ✅ PV-0 dense and complete: release banner, scope, system summary, design criteria, governing codes, engineering summary, 25-row sheet index, construction notes, project info, revisions, EOR block, vicinity map with aerial. |
| Cross-sheet references resolve | ✅ no dangling references (V36 enforces; build did not throw) |
| Title block repeats internal QA counts | ⚠️ title block carries `IBC PENDING · IRC PENDING · IFC PENDING` on every sheet. **Truthful** — those editions genuinely are unestablished (requirement #9) — but it is code-authority state, not a QA worklist. Resolves when #9 closes. |
| Designer identity | ❌ blank (`—`) on Braidon — requirement #12 |
| Engineer-of-Record presentation | ✅ correct in both directions: blank + PENDING placeholder on unapproved Braidon; **`Jordan Vale, PE / 062-071234 / IL / 2026-08-04` printed with the affirmative "LETTER OF STRUCTURAL COMPLIANCE"** on the issued controlled package, signature and seal rules left blank |
| Review state matches current digest | ✅ |
| Permit profile falsely claims approval | ✅ no — profile carries no PE-1, and `permitSubmissionPreviewState` marks it a non-submittable preview |
| Design-review profile distinguished | ✅ |
| Regeneration changes issue dates / drops review | ✅ no — digest and snapshot id are stable across rebuilds of the same design (`PRR §4` test 9) |
| Text/geometry clipping | ✅ none observed on the inspected sheets |
| Project name | ❌ prints `BRAIDON M PILLA — Solar TEST` — requirement #11 |

---

## 17. Migration status

| Migration | State | Note |
|---|---|---|
| 116 `engineering_review_records` | **applied** 2026-07-29 | table present, 0 rows for Braidon |
| 117 `ahj_registry` | **applied** 2026-07-30 | AHJ resolves correctly to Madison County; IBC/IRC/IFC editions absent |
| 118 `field_route_measurements` | **applied** 2026-08-03T20:58:19Z | `field_route_measurements` + `field_route_measurement_events` present, 0 rows for Braidon. **A prior session note saying this was unrun is stale.** |
| 115 `project_personnel_roles` | recorded **applied** 2026-07-29 — **but `project_personnel_roles` does not exist in the live database** | ⚠️ ledger/schema divergence. Needs investigation before the designer resolver can work. |

---

## 18–20. Verification

| Check | Result |
|---|---|
| TypeScript (`npx tsc --noEmit`) | ✅ exit 0 |
| Full test suite (`npx vitest run --maxWorkers 3`) | ✅ **419 files passed, 17 skipped · 9674 tests passed, 490 skipped, 0 failed** |
| Focused release-reachability tests | ✅ 35/35 |
| Migration verification | see §17 |
| Live Braidon generation | ✅ 3 profiles, 0 blocking violations |
| Visual render audit | ✅ §16 |
| Production build (`npm run build`) | ✅ Compiled successfully · 91/91 static pages. **Requires `NODE_OPTIONS=--max-old-space-size=8192` on this machine** — at the default heap the Next.js build worker dies with `0xC0000409` during static generation (environmental, not introduced here; unchanged by this repair). |

---

## 21–24. Commit / push / artifacts

- **Commit:** `61a16d332a098a75dcd2686440c4cf105a128d6f` — *"Make the permit-release state reachable,
  and the digest stop covering its own approval"* (12 files, +1720 / −90)
- **Push:** `c9862ab9..61a16d33  dev -> dev` → `https://github.com/rayobrian6/Solarpro.git`
- **`HEAD == origin/dev`:** ✅ both `61a16d332a098a75dcd2686440c4cf105a128d6f` after `git fetch --prune`
- **Final planset artifacts:**
  - `_tmp_pr_shots/braidon_full.pdf` (25 sheets) + `_tmp_pr_shots/braidon_full_shots/*.png`
  - `_tmp_pr_after_{design-review,permit,full}.html` + `.snapshot.json`
  - `_tmp_pr_shots/ctrl_issued.pdf` (20 sheets, the ISSUED-FOR-PERMIT proof) + per-sheet PNGs

### Reproduce

```bash
npx tsx _tmp_pr_baseline.ts                       # live Braidon, 3 profiles (TAG=after)
npx vitest run tests/planset/prr-release-reachability.test.ts
npx vitest run --maxWorkers 3                     # full suite
node scripts/ws5-pdf-and-shots.mjs _tmp_pr_after_full.html _tmp_pr_shots/braidon_full
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

---

## Standing notes

- **The leaked `neondb_owner` credential is STILL UNROTATED.** The harnesses added in this pass read
  it from `../.db_url` and never embed it. The pre-existing `_tmp_*` scratch harnesses in the working
  tree still contain it in plaintext; they are untracked and were not committed.
- **`.db_url` points at LIVE PRODUCTION.** Every database access in this pass was read-only.
