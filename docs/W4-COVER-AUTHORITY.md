# W4 §3 / §4 / §12 — Project / Cover Authority, Legacy-Cover Deletion, Issue States

Status: implemented (W4 Round-2, workstream B). `npx tsc --noEmit` clean;
`npx vitest run tests/planset` 500/500 green.

This document records the §3 before/after authority flow, the §4 buildPermitCoverSheet
deletion evidence, and the §12 issue-state machine + ISSUED-FOR-PERMIT gate.

---

## §3 — Canonical project / cover authority

### Before

Project-facing content on the cover, title block and certification sheets was read
directly from `input.project.*` / `input.compliance.jurisdiction.*` / a 4-source
equipment resolver, and the cover computed its **own** sheet index inline
(`buildSheetManifest(...)`). A **second, snapshot-blind** cover authority existed in
`lib/permit/buildPermitCoverSheet.ts` (+ the dormant React `components/permit/CoverSheet.tsx`)
that hardcoded vendor / EOR defaults (`SolarPro Engineering`, `IronRidge XR100`,
`SolarPro Engineering Engine`), a fixed `PERMIT_SHEET_INDEX`, and literal code editions
(`IBC 2021`, `ASCE 7-22`, `IFC = NEC 2023 ? 2024 : 2021`). Nothing derived the project
*issue state*; the cover printed a hardcoded **"REV A — ISSUED FOR PERMIT"** even on an
unreviewed set.

### After — one record, one accessor

```
buildPermitDesignSnapshot (build.ts)
  └─ buildProjectAuthority(...)  ──►  snapshot.projectAuthority : ProjectAuthorityRecord
        • identity: projectName, customer, address, city/state/zip, parcelApn
        • ahjName  ← snapshot.codeAuthority.ahjName (single source)
        • utilityName, systemType, capacities {dcKw, acKw, moduleCount}
        • equipmentSummary ← snapshot.equipment.* (versioned records; NO vendor default)
        • designer / contractor  (missing ⇒ null — NO "SolarPro Engineering Engine")
        • issueState  ← deriveIssueState(permitReadiness.blockers, review, digest, gate)
        • issuedForPermitGate ← evaluateIssuedForPermitGate(...)  (each precondition)
        • revisionHistory (rev A description = the DERIVED issue state)
        • sheetIndex  ← computePlansetManifest(input, cad)   (the ACTUAL manifest)
        • governingCodesRef ← reference to codeAuthority (NO edition literal — V11)
        • generalNotes, fieldProvenance, provenance

Renderers read ONLY through the accessor:
  projectAuthorityProjection.ts  (projectProjectAuthority / …FromInput)
    ├─ coverSheet.ts   (pageCoverSheet)   — project info, system info, sheet index,
    │                                       issue status, equipment summary
    ├─ titleBlock.ts   (every sheet)      — AHJ, utility, APN, module, inverter,
    │                                       issue status, snapshot id + digest
    └─ certPages.ts    (CERT / PE-1)      — AHJ (tagged), single-sourced identity
```

**Tags for the closer's truth matrix** — `projectAuthorityProjection.tag(field)` emits
`<span data-project-field="<field>">…</span>` (value escaped). Tagged on the sheets:
`ahj`, `utility`, `system-type`, `module-model`, `inverter-model`, `issue-status`,
`snapshot-id`, `digest` (plus `project-name`, `customer`, `address`, `apn`, `designer`).
The title block carries the full set on **every** sheet (via `subScopedInput`'s spread of
`_snapshot`), so the matrix can prove cross-sheet identity + single-sourcing.

**Fail-closed** — an absent snapshot yields an empty projection whose values are all
`PENDING`; no fabricated default is ever printed. `computePlansetManifest` is the SAME
builder `generatePermit` mirrors, so the cover never holds an independent index.

**Enforcement** — new blocking validators:
- **V33** — issue-state derivation consistency: `projectAuthority.issueState` must equal
  `deriveIssueState()` over the same `permitReadiness.blockers` + review record.
- **V34** — ISSUED-FOR-PERMIT gate integrity (see §12).
- **V35** — cover single-sourcing: sheet index is the generated manifest; governing-codes
  ref carries no edition literal; equipment summary matches the snapshot equipment
  records; AHJ equals `codeAuthority.ahjName`.

---

## §4 — Retire `buildPermitCoverSheet` (deletion evidence)

### Caller inventory (before)

| Caller | Resolution |
|---|---|
| `lib/engineering/artifactBuilders.ts` → `buildAllArtifacts()` (only code caller) | **Removed.** The pipeline no longer emits a standalone `permit_cover_sheet` HTML artifact. |
| `app/api/engineering/permit-preview/route.ts` (claimed in the file header) | **Stale claim** — the route reads `permit_planset.html` (the canonical planset) and never imported the builder. No change needed. |
| `components/permit/CoverSheet.tsx` (React, `PermitCoverData`) | **Dead** (zero importers) — a second dormant cover authority. **Deleted.** |

### Deletions

- `lib/permit/buildPermitCoverSheet.ts` — **deleted** (mapReportToPermitCover /
  renderPermitCoverHTML / buildPermitCoverSheetArtifact + its vendor-EOR defaults,
  independent `PERMIT_SHEET_INDEX`, and hardcoded `NEC/IBC/IFC/ASCE` editions gone).
- `components/permit/CoverSheet.tsx` — **deleted** (dormant duplicate cover renderer).

### Proof (test: `tests/planset/project-authority-w4.test.ts` → "deletion proof")

- `lib/permit/buildPermitCoverSheet.ts` does not exist.
- `components/permit/CoverSheet.tsx` does not exist.
- A repo walk of `app/ lib/ components/ scripts/` finds **zero** imports of the builder
  and zero calls to `buildPermitCoverSheetArtifact` / `renderPermitCoverHTML` /
  `mapReportToPermitCover`.
- `lib/engineering/artifactBuilders.ts` emits **no** `permit_cover_sheet` artifact.
- The only residual string is a historical note in `scripts/planset-evidence-w3.mjs`
  (a comment in a W3 evidence generator — not an importer).

### Consumer kept working

`getTopographyState.ts` gates its "permit exists" signal on
`file_type IN ('permit_cover_sheet','permit_planset')`. The canonical planset writes
`permit_planset` (`app/api/engineering/permit/route.ts`), so the signal is preserved via
`permit_planset`; the query is unchanged (it still lists the legacy type for old rows).

There is now exactly **one** cover authority: `pageCoverSheet` (the PermitDesignSnapshot
planset), reachable only through `/api/engineering/permit` → `permit_planset.html`.

---

## §12 — Certification & issue-state authority

### Issue-state machine (`deriveIssueState`, pure)

Enum (exact): `DESIGN DRAFT`, `PENDING ELECTRICAL REVIEW`, `PENDING STRUCTURAL REVIEW`,
`PENDING ENGINEERING REVIEW`, `REVIEWED`, `PERMIT-READY`, `ISSUED FOR PERMIT`, `REVISED`.

Derivation (blockers classified by domain via `classifyBlockerDomain`; the
`ENGINEERING-REVIEW-PENDING` marker is the *review* lane, not an authority gap):

1. no modules ⇒ **DESIGN DRAFT**
2. a review exists but its `reviewedDigest` ≠ current digest ⇒ **REVISED**
   (prior approval invalidated by a design change)
3. no current-digest review:
   - only electrical gaps ⇒ **PENDING ELECTRICAL REVIEW**
   - only structural gaps ⇒ **PENDING STRUCTURAL REVIEW**
   - code / equipment / document / multiple domains / clean ⇒ **PENDING ENGINEERING REVIEW**
4. current-digest review + gate passes ⇒ **ISSUED FOR PERMIT**
5. current-digest review + no authority gaps ⇒ **PERMIT-READY**
6. current-digest review + residual gaps ⇒ **REVIEWED**

At **build** time the certification record is always absent (the D-6 gate), so production
lands in a `DESIGN DRAFT` / `PENDING …` state; the pure function is unit-tested across all
8 states + the digest-invalidation case.

### ISSUED-FOR-PERMIT gate (`evaluateIssuedForPermitGate`, pure — each precondition reported)

`pass` requires **all** of:
1. all blocking validators pass
2. equipment identity reconciled (no `EQUIPMENT-IDENTITY-CONFLICT`)
3. code authority verified + current
4. required manufacturer documents archived
5. structural applicability established
6. engineer review references the current snapshot digest
7. signature / seal satisfied

Each precondition is reported as `{ id, label, satisfied, detail }`. A digest change
invalidates a prior approval unless a new review covers that digest
(`engineerReviewCoversCurrentDigest`), and `digestInvalidatedByLedger` (from the
`snapshot_digest_invalidations` ledger) forces that precondition false.

CERT / PE-1 remain gated by the existing `certificationGateBanner` (unchanged). The issue
state prints on the cover (SYSTEM INFORMATION + REVISIONS) and every title block
(`data-project-field="issue-status"`).

### Closer hooks (documented, not wired)

- **Manufacturer-document archival** (`gateInput.manufacturerDocumentsArchived`) is an
  async `lib/documents` DB read — passed as `null` at build ⇒ the gate precondition is
  *not satisfied*. Wire the documents-registry read to resolve it.
- **Digest-invalidation ledger** (`snapshot_digest_invalidations`,
  `lib/reconciliation` `InvalidationRecord`) — `gateInput.digestInvalidatedByLedger` and a
  populated `review` record must be supplied from the DB. Until then `buildProjectAuthority`
  is called with `review = null` (certification is always absent at build), so no live
  approval is asserted.
