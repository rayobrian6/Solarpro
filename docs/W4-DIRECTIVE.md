# W4 Directive — Project/AHJ/Code Authority, Legacy-Path Removal, Document Authority, Final Bypass Cleanup

Status: ACTIVE 2026-07-21. W3.1 (`ab4bc180`) APPROVED; W3 CLOSED. Ray's W4 mandate, verbatim contract.

## W3.1 acceptance notes (binding context)

- Immutable original Braidon fixture + separate live evidence approved.
- Reconstructed plane vertices/edge types accepted ONLY as deterministic test-fixture
  geometry. Evidence must CONTINUE stating they were not recovered from the original
  historical snapshot and do not prove exact historical roof geometry.
- Canonical coordinate system, snapshot-carried transforms, V26–V31 zero-delta approved.
- lib/plan-set containment approved as INTERIM only.
- RT-MINI provenance blockers correct and must remain blocking. No 600 lb ASD capacity
  may be treated as permit-authoritative until its exact source document and assembly
  applicability are archived and verified. 900 lb ultimate records remain prohibited
  from ASD allowable-capacity checks.

## 1. Canonical AHJ and code authority

Create versioned project-jurisdiction authority records containing: AHJ identity;
jurisdiction type; state/county/city; utility; adopted NEC edition; adopted IBC
edition; adopted IRC edition; adopted IFC edition; adopted ASCE edition or structural
standard basis; local amendments; effective date; expiration/supersession date where
known; source document or official source; source revision/date; source hash when
archived; verification status; verified by; verification timestamp; applicability notes.

Do not use generic state defaults when a local AHJ governs. Do not silently infer
missing editions. When authoritative code adoption is incomplete, the planset may
render for review but must block permit-ready status with a named
CODE-AUTHORITY-INCOMPLETE blocker.

## 2. Activate V11 as blocking

V11 must prove: every displayed code edition comes from the same snapshot
code-authority record; title blocks, cover, notes, electrical sheets, structural
sheets, labels, certificates and engineering letters print identical editions; no
renderer contains literal NEC/IBC/IRC/IFC/ASCE editions; no sheet independently
substitutes a newer or older edition; local amendments are attached to the applicable
code record; the code authority is verified and current for the project jurisdiction.
The existing 2023-versus-2020 NEC disagreement must be eliminated.

## 3. Canonical project and cover authority

Refactor all project-facing content to read only from PermitDesignSnapshot: project
name; customer; installation address; parcel/APN; AHJ; utility; system type; system
capacities; equipment summary; designer; contractor; engineer-review status; issue
status; revision history; sheet index; governing codes; general notes.

No cover or title-block renderer may insert vendor defaults, stale equipment, default
engineer names, independent sheet indexes or generic code editions. Missing authority
must fail closed or display an explicit pending-review state.

## 4. Retire buildPermitCoverSheet

Remove the legacy buildPermitCoverSheet path after any legitimate presentation behavior
has been migrated into snapshot projections. Prove: it has no remaining callers; it
cannot be reached through an API route, worker, admin page or test-only production
branch; its vendor-EOR defaults are deleted; its independent sheet-index logic is
deleted; its equipment and code defaults are deleted. Do not leave a second dormant
cover authority available for future accidental reuse.

## 5. Delete the dead buildSLD implementation

The retired buildSLD body in electricalPages must be removed. Before deletion, verify
no reachable path uses it. All SLD rendering must consume the canonical snapshot
electrical topology and segment IDs. Add tests proving: only the canonical SLD renderer
is reachable; no stored SVG, fabricated inline SLD or legacy builder can bypass
snapshot validation; every SLD carries snapshot ID, schema version and digest.

## 6. Permanently resolve lib/plan-set/*

The interim LEGACY PATH — NOT FOR PERMIT containment must be replaced. Audit every
caller and choose one permanent outcome:

A. Convert: route through PermitDesignSnapshot; require the same validators; use the
   same title-block identity and digest; eliminate its independent structuralStatus and
   compliance decisions. — or —
B. Delete: migrate any unique non-authority visualization functionality; remove the API
   route and unused implementation; update engineering/admin pages to use the canonical
   generator.

Do not retain two production planset generators. Provide a caller inventory and
rationale for convert versus delete.

## 7. Equipment-identity reconciliation authority

Implement the operator reconciliation workflow for conflicting equipment records
(subsystem panel ID, fleet equipment, design equipment, stored permit equipment,
rendered equipment). The system must: identify every conflicting source; show current
values and provenance; require an explicit operator selection; require a reason; record
operator and timestamp; update canonical references transactionally; preserve previous
values in an audit record; invalidate old snapshot digests; invalidate calculations and
engineering approvals tied to the old digest; rebuild and validate a new snapshot.

No database table or timestamp may silently win. Do not automatically reconcile the
live Braidon project.

## 8. Canonical manufacturer-document authority

Create or complete a versioned document registry for: module datasheets;
inverter/microinverter datasheets; combiner documentation; racking installation
manuals; structural PE letters; evaluation reports; UL/listing documentation; utility
requirements; AHJ code-adoption documents.

Each record: manufacturer/issuer; equipment model applicability; document title;
revision/date; archived file identity; SHA-256; source; jurisdiction/applicability
boundary; superseded/current status; extracted engineering claims;
reviewer/verification state.

Engineering values may cite only verified documents that cover the exact selected
equipment and installation condition.

## 9. RT-MINI blocker workflow

Preserve RACKING-CAPACITY-SOURCE-NOT-ARCHIVED and RACKING-CAPACITY-APPLICABILITY-GAP.
Add the ingestion path needed to clear them when the real document is supplied. The
operator must be able to archive the exact source and connect it to: exact RT-MINI
model; fastener model and count; substrate; rafter/deck condition; embedment;
rail/L-foot assembly; load basis; adjustment factors; jurisdiction/applicability.
Uploading a generic Roof Tech brochure or flashing report must not clear the blocker.

## 10. Direct-mount coordinate authority

Close the remaining structural gap for rail-less/direct-mount products. Direct-mount
systems must have canonical attachment objects and coordinates just like rail-based
systems. Do not infer attachment locations only during rendering.

Required invariants: every direct-mount attachment has a canonical ID and coordinate;
every module references its supporting attachments; fastener count derives from
attachment objects; drawing positions equal transformed snapshot coordinates; BOM
quantities equal canonical attachment objects; missing direct-mount geometry blocks
permit-ready status.

## 11. Carry-forward electrical blockers

Preserve and, where the necessary authority now exists, resolve: ROUTE-LENGTH-ESTIMATE;
missing feeder raceway/conduit type; incomplete raceway-bonding authority;
EQUIPMENT-IDENTITY-CONFLICT. At minimum, populate feeder raceway type from
computeSystem when known and emit the corresponding raceway-bonding object. Do not
fabricate route geometry merely to remove ROUTE-LENGTH-ESTIMATE.

## 12. Certification and issue-state authority

CERT and PE-1 remain gated. Project issue states must be explicit: DESIGN DRAFT;
PENDING ELECTRICAL REVIEW; PENDING STRUCTURAL REVIEW; PENDING ENGINEERING REVIEW;
REVIEWED; PERMIT-READY; ISSUED FOR PERMIT; REVISED.

ISSUED FOR PERMIT only when: all blocking validators pass; equipment identity is
reconciled; code authority is verified; required manufacturer documents are archived;
structural applicability is established; engineer review references the current
snapshot digest; signature/seal requirements are satisfied. A digest change must
invalidate the issue state and prior approval unless a new review explicitly covers
that digest.

## 13. W4 acceptance evidence

Deliver: AHJ/code authority before-and-after report; versioned code-authority schema
and sample record; V11 activation evidence; proof of zero code-edition literals in
renderers; project/cover authority-flow report; buildPermitCoverSheet caller proof and
deletion evidence; buildSLD caller proof and deletion evidence; complete lib/plan-set
caller inventory; permanent convert-or-delete implementation; equipment reconciliation
workflow and tests; manufacturer-document registry and RT-MINI ingestion workflow;
direct-mount coordinate evidence; updated electrical blocker status; regenerated
immutable Braidon evidence; regenerated live Braidon evidence; cross-sheet truth matrix
proving agreement for: AHJ; utility; every code edition; system type; module model;
inverter model; racking assembly; project issue status; sheet index; snapshot ID/digest;
focused test results; full repository test results with no new failures; tsc result;
production build result.

The evidence harness must exit non-zero for any cross-sheet disagreement or reachable
authority bypass.

## 14. Boundaries

- Work on dev only. Commit W4 separately.
- Do not modify MFA. Do not modify migration governance.
- Do not patch rendered HTML.
- Do not clear unsupported blockers to make evidence green.
- Do not automatically alter production Braidon equipment records.
