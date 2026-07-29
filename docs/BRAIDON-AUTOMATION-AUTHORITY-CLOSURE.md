# Braidon — Automation Authority Closure

Closure document for the AUTOMATION AUTHORITY CLOSURE campaign
(`docs/AUTOMATION-AUTHORITY-CLOSURE-DIRECTIVE.md`, Ray's mandate 2026-07-27).

- Baseline: `dev @ a6a225ae` (engine closure) — artifact
  `PermitPackage-BRAIDON M PILLA — Solar TEST (9).html`, PDS-0B05747F0E8A,
  24 sheets, **7 gates / 19 requirements / 0 advisories**
- Passes: AAC-0 (source-path audit) → AAC-1 (resolver framework) → AAC-2
  (canonical equipment + designer) → AAC-3 (AHJ/code + environmental) → AAC-4
  (electrical + Q-Cable) → AAC-5 (structural separation + gate lifecycle) →
  AAC-6 (Braidon acceptance + compaction) → **AAC-7 (this closure)**
- Live project: `4030b664-bebe-433b-a11c-cda05ead2f7d` —
  "BRAIDON M PILLA — Solar", 3 MELVIN DR APT A, GRANITE CITY, IL 62040
- Commit: the single campaign commit on `dev` — "Automation authority closure:
  resolver lifecycle, live retrieval providers, deterministic engines,
  permit-profile compaction" (113 files, +25 748 / −477). Its hash is
  **`HASH_PLACEHOLDER`** (recorded by the one-line follow-up commit below — a
  document cannot contain the hash of the commit that contains it).

---

## §1 — What changed, in one paragraph

The engine used to DETECT blockers and print them. It now RESOLVES what it can
before the registry is built. A bounded resolution lifecycle runs ahead of the
pure snapshot build: derive → persist evidence → invalidate → recompute →
retrieve → recompute → repeat to stability → freeze → render. Two live
requirements now clear automatically with archived evidence and audit
references (EQUIPMENT-IDENTITY-CONFLICT, ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED),
seven more are blocked ONLY on a pending Ray action that the engine names
exactly, and the permit artifact dropped from 25 internal sheets to a 14-page
AHJ submittal without removing a single requirement from the registry. Nothing
was fabricated, nothing licensed was auto-approved, and an unknown code still
fails closed into `RG-UNMAPPED`.

---

## §2 — Source-path findings (AAC-0 summary)

Full document: `docs/AAC-SOURCE-PATH-AUDIT.md` (20 traced paths, every claim
`file:line`-anchored). The findings that drove the build:

| # | Finding | Consequence |
|---|---|---|
| 1 | Of the 19 live requirements, **9 were structurally unconditional** — fired from a hardcoded literal, a dead path or a field-name mismatch, not from project data | `_projectAuthorityVerified = false` literal; IBC/IRC/IFC editions hardcoded `null`; `verifiedBy`/`sourceHash` hardcoded `null`; `ENGINEERING-REVIEW-PENDING` pushed with no `if` |
| 2 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `-APPLICABILITY-GAP` and `FASTENER-ASSEMBLY-UNVERIFIED` were **one predicate wearing three names** (`if (!rtCleared)`) | WS-8 separation: the fastener code no longer echoes the capacity document |
| 3 | **Two providers already existed in-repo and were never called from the permit path** — `lib/jurisdictions/ahjRegistry.ts` (SunSpec AHJ Registry, returns IBC/IRC/IFC and discards them at the mapper) and `lib/enrichment/propertyEnricher.ts` (ATTOM → Census → Nominatim) | WS-3 wired both behind DI provider interfaces |
| 4 | `CONDUIT-FILL-PENDING` was a computation that **already ran correctly** and was discarded by three misspelled field reads (`fillPercent` vs `fillPct`, `conduitFillPercent` vs `conduitFillPct`) | WS-7: the requirement is absent from the live registry today |
| 5 | The permit POST **never read `projects.selected_equipment`** — the canonical store was not the canonical authority; module identity came from the posted fleet | WS-2 canonical selection authority + precedence lattice |
| 6 | `resolutionOptions()` was a **static list of four labels** that enumerated nothing | WS-5 deterministic topology + option-space evaluation |
| 7 | `evaluateDocumentApplicability`'s 4th parameter (`registryFacts`) was `null` at **every** call site, making the `AUTHORITATIVE` verdict unreachable | WS-8 `documentRegistryFacts` threaded from `racking-documents@v1` |
| 8 | The GET self-heal path called `generatePermitHTML(savedInput)` with **no** `snapshotAuthority` — a regenerated preview silently used fail-soft defaults | fixed in the permit route |
| 9 | `releaseGates.deriveRequirementStatus`: `resolved: true` without a `resolutionAuditRef` stays OPEN | **the contract every resolver had to satisfy** — no clear without a written audit reference |

---

## §3 — Files changed

### New — resolver framework (`lib/permit/snapshot/resolution/`)
`types.ts` · `registry.ts` · `lifecycle.ts` · `evidence.ts` · `resolvers.ts` ·
`derived.ts` · `equipmentSelection.ts` · `datasheetBinding.ts` ·
`jurisdictionAuthority.ts` · `jurisdictionResolvers.ts` ·
`environmentalRetrieval.ts` · `structuralDocuments.ts` ·
`structuralResolvers.ts` · `railSelection.ts` · `index.ts`

### New — authority providers (`lib/providers/`, dependency-injected)
`types.ts` · `property/{types,censusPropertyProvider,fixtures}.ts` ·
`jurisdiction/{types,sunspecCodeProvider,fixtures}.ts` ·
`climateHazard/{types,asceHazardProvider,fixtures}.ts` ·
`documentRetrieval/{types,httpDocumentProvider,fixtures}.ts`

### New — engines and stores
`lib/permit/snapshot/qcableTopology.ts` (WS-5, 991 lines) ·
`lib/permit/snapshot/conduitFillAuthority.ts` (WS-7) ·
`lib/permit/snapshot/documentAuthority.ts` ·
`lib/permit/snapshot/siteDesignLoads.ts` ·
`lib/permit/plansetProfile.ts` (WS-10) ·
`lib/personnel/{types,store}.ts` (WS-6) ·
`lib/engineeringReview/{types,store}.ts` (WS-9)

### New — operator surfaces
`app/admin/personnel/page.tsx` + `app/api/admin/personnel/route.ts` ·
`app/admin/engineering-review/page.tsx` + `app/api/admin/engineering-review/route.ts`

### New — migrations
`lib/migrations/115_project_personnel_roles.sql` ·
`lib/migrations/116_engineering_review_records.sql`

### Modified — permit engine
`lib/permit/generatePermit.ts` · `snapshot/authorityInputs.ts` · `snapshot/build.ts` ·
`snapshot/types.ts` · `snapshot/codeAuthority.ts` · `snapshot/environmentalAuthority.ts` ·
`snapshot/structuralAuthority.ts` · `snapshot/projectAuthority.ts` ·
`snapshot/projectAuthorityProjection.ts` · `snapshot/procurementSufficiency.ts` ·
`snapshot/equipmentProjection.ts` · `snapshot/computeSystemProjection.ts` ·
`snapshot/releaseGates.ts` · `utils/bomForPermit.ts` · `utils/releaseStatusBlock.ts` ·
`utils/structuralBanner.ts` · `sheetManifest.ts` · `plansetManifest.ts` ·
`sections/{coverSheet,arrayPages,certPages,compliancePages,datasheetAppendix,structuralPages}.ts`

### Modified — data, drafting, reconciliation, migrations governance
`lib/reconciliation/reconcile.ts` + `types.ts` · `lib/documents/registry.ts` ·
`lib/jurisdictions/{ahjRegistry,ahj-national}.ts` · `lib/enrichment/propertyEnricher.ts` ·
`lib/equipment/trunkCable.ts` · `lib/bom/deriveRunLengths.ts` ·
`lib/drafting/{sheetComposition,templates/roof,templates/ground,templates/fence}.ts` ·
`lib/migrations/{runner,targetedRegistryDeployment}.ts` ·
`app/api/engineering/permit/route.ts` · `app/api/admin/migrations/route.ts` ·
`app/admin/system-tools/migrations/page.tsx` · `.env.example`

### Tests + harnesses
New: `tests/planset/aac-ws1-resolver-lifecycle.test.ts` ·
`aac-ws2-canonical-equipment-designer.test.ts` · `aac-ws3-ws4-ahj-environmental.test.ts` ·
`aac-ws5-ws7-qcable-conduit.test.ts` · `aac-ws8-ws9-structural-lifecycle.test.ts` ·
`aac-ws10-planset-profile.test.ts`.
Modified: 11 existing planset tests, `tests/targetedRegistryDeployment.test.ts`,
`tests/phase1a-migration-governance.test.ts`, and the rendered-truth harnesses
`scripts/planset-evidence-{bar,ep,ppc}.mjs` (§8).

Totals: 56 tracked files modified (+3 249 / −477) and 49 new files.

---

## §4 — Schema changes

### Migration 115 — `project_personnel_roles` (**awaiting Ray**)
Creates `personnel_roles` (org roster: role, name, licence, licence state,
active) and `project_personnel_assignments` (per-project role assignment with
`superseded_at` history). Roles are DISTINCT: `designer`, `preparer`,
`reviewer`, `engineer_of_record`, `approving_engineer`. Only the first three are
auto-populatable; the licensed roles can never be filled by the engine.
Idempotent plain DDL, no `DO $$`, no destructive statement, no seed row.

### Migration 116 — `engineering_review_records` (**awaiting Ray**)
Creates `engineering_review_records`: reviewer identity + licence + licence
state, `reviewed_snapshot_digest`, scope statement, approval timestamp. A review
only covers the digest it names. No row is ever created by the engine.

Both are governed through the existing targeted console
(`REGISTRY_SEQUENCE = ['113','114','115','116']`, run **113 → 114 → 115 → 116**),
verified by `tests/targetedRegistryDeployment.test.ts` and
`tests/planset/aac-ws8-ws9-structural-lifecycle.test.ts` static analysis.
Migrations 113 (`manufacturer_document_registry`) and 114
(`equipment_reconciliation_audit` + `snapshot_digest_invalidations`) are
**already applied on production** (ledger: 2026-07-22, human actor).

### Snapshot additions (no table — the snapshot rides in `permit_input.json`)
`snapshot.resolutionAuthority` (canonicalEquipment, projectLegalAuthority,
codeAdoptionAuthority, environmentalRetrieval, projectPersonnel,
moduleDatasheetBinding, structuralDocumentRetrieval, rackingAssemblySelection,
framingRetrieval, engineeringReview, cableExtensionSolutions) ·
`electrical.qcableTopology` + `electrical.procurementSufficiency.solutionEvaluation`
(per-branch drops, transitions, cable ends, extension requirement, option space) ·
`electrical.conduitFillAuthority` · `structural.env.environmentalLoadAuthority`
now carries its retrieval record · per-requirement `payload.resolutionEvidence[]`,
`lastResolutionAttempt`, `retryability`, `residualMode`.

### Live table writes performed by the resolvers
`manufacturer_document_registry` (racking installation manual, RT-MINI II
stamped PE letter, ASCE-7 climate-hazard dataset — the first two land
`unverified` by design), `equipment_reconciliation_audit` (+ the paired
`snapshot_digest_invalidations` rows), and — new in AAC-7 — the superseded
per-subsystem mirrors in `projects.selected_equipment.subSystems` and
`projects.engineering_config.subSystems` (§8a).

---

## §5 — Resolver map

**Stage order per iteration:** DERIVED (pure, in-build) → RETRIEVAL (async,
pre-build) → recompute → repeat to stability (bound 3) → freeze.

### DERIVED stage (`lib/permit/snapshot/resolution/derived.ts`) — pure
| Resolver | Requirement codes | Mode | Live status |
|---|---|---|---|
| `conduit-fill@v1` | CONDUIT-FILL-PENDING | AUTO_DERIVED | **not emitted** (NEC Ch.9 Table 1 result now read correctly) |
| `route-length@v1` | ROUTE-LENGTH-ESTIMATE | AUTO_DERIVED → FIELD_VERIFICATION | OPEN — genuine field measurement |
| `raceway-authority@v1` | FEEDER-RACEWAY-AUTHORITY · BRANCH-RACEWAY-AUTHORITY · RACEWAY-SEGMENT-CONFLICT | AUTO_DERIVED | **not emitted** |
| `qcable-topology@v1` | (topology object) | AUTO_DERIVED | resolved — 31 drops, per-branch paths |
| `qcable-solution@v1` | QCABLE-PROCUREMENT-INSUFFICIENT | AUTO_DERIVED | OPEN — option space evaluated, no viable option |

### RETRIEVAL stage (`resolvers.ts`, `jurisdictionResolvers.ts`, `structuralResolvers.ts`) — async
| Resolver | Requirement codes | Mode | Live status |
|---|---|---|---|
| `project-authority-key@v1` | (infrastructure) | AUTO_DERIVED | resolved |
| `digest-invalidation-ledger@v1` | (infrastructure) | AUTO_DERIVED | resolved |
| `canonical-equipment-selection@v1` | EQUIPMENT-IDENTITY-CONFLICT | AUTO_DERIVED | **CLEARED** |
| `module-datasheet-binding@v1` | MODULE-EXACT-DATASHEET-PENDING | AUTO_DERIVED → AUTO_RETRIEVED | OPEN — RANGE-COVERED, binding missing |
| `project-personnel-designer@v1` | DESIGNER-OF-RECORD-MISSING | AUTO_DERIVED | OPEN — migration 115 absent |
| `racking-assembly-selection@v1` | PENDING-RACKING-ASSEMBLY-SELECTION | AUTO_DERIVED → OPERATOR_CONFIRMATION | OPEN — rail genuinely unselected |
| `engineering-review-record@v1` | (infrastructure) | AUTO_DERIVED | OPEN — migration 116 absent |
| `project-authority@v1` | PROJECT-AUTHORITY-UNVERIFIED | AUTO_RETRIEVED | OPEN — APN unconfirmed (no ATTOM key) |
| `code-authority@v1` | CODE-AUTHORITY-INCOMPLETE | AUTO_RETRIEVED | OPEN — `AHJ_REGISTRY_TOKEN` unset |
| `racking-capacity-document@v1` | RACKING-CAPACITY-SOURCE-NOT-ARCHIVED · -APPLICABILITY-GAP · FASTENER-ASSEMBLY-UNVERIFIED | AUTO_RETRIEVED | registry lookup — no verified row yet |
| `framing-capacity-document@v1` | FRAMING-AUTHORITY-UNVERIFIED | AUTO_RETRIEVED | OPEN → PROFESSIONAL_APPROVAL |
| `climate-hazard-document@v1` | ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED | AUTO_RETRIEVED | archived-document cache hit |
| `environmental-load-authority@v1` | ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED | AUTO_RETRIEVED | **CLEARED** |
| `cable-extension-solutions@v1` | QCABLE-PROCUREMENT-INSUFFICIENT (document half) | AUTO_RETRIEVED | no SKU selected |
| `racking-documents@v1` | the three racking codes + EQUIPMENT-DOCUMENT-APPLICABILITY | AUTO_RETRIEVED | retrieved + hashed + archived `unverified` |
| `framing-capacity-retrieval@v1` | FRAMING-AUTHORITY-UNVERIFIED | AUTO_RETRIEVED | NOT-RETRIEVABLE (building-specific) |

Live execution order (16 resolvers, 1 iteration, stabilized, bound 3, **0
invariant violations**, 31 evidence records, 6 invalidations) is recorded
verbatim in `docs/evidence/aac7-braidon-live-closure.json`.

**Gates:** RG-1 PROJECT_AND_AHJ_AUTHORITY · RG-2 EQUIPMENT_RECONCILIATION ·
RG-3 ENVIRONMENTAL_LOAD_AUTHORITY · RG-4 STRUCTURAL_ASSEMBLY_AUTHORITY ·
RG-5 ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE · RG-6 QCABLE_SYSTEM_CLOSURE ·
RG-7 PROFESSIONAL_RELEASE · **RG-UNMAPPED** (fail-closed sink — an undeclared
code lands here and blocks every axis).

---

## §6 — Authority providers and environment

| Provider | Source | Env var | Behaviour without it |
|---|---|---|---|
| `censusPropertyProvider` | ATTOM → **US Census Geocoder** → Nominatim | `ATTOM_API_KEY` (optional) | Census still verifies address + county + FIPS + boundary (confidence 0.90); **only ATTOM can confirm an APN**, so the APN field stays `unverified-derived` and never guesses |
| `sunspecCodeProvider` | SunSpec / Orange Button AHJ Registry (`ahjregistry.myorangebutton.com`) | `AHJ_REGISTRY_TOKEN` (**required**) | RETRYABLE failure naming the exact URL and the exact reason; the sourceless `ahj-national` table may **not** substitute |
| `asceHazardProvider` | `gis.asce.org` ASCE 7 ImageServers + USGS ASCE7-22 design maps + USGS 3DEP | none (public) — kill switch `CLIMATE_HAZARD_RETRIEVAL_DISABLED=1` | disabled ⇒ NOT_CONFIGURED with the operator action; never a substituted default |
| `httpDocumentProvider` | manufacturer PDFs (fetch → SHA-256 → archive) | kill switch `AAC_DOCUMENT_RETRIEVAL=0`; auto-off under vitest | fixture provider in tests; live archival lands `unverified` for an operator verify-click |

Every provider is injected through `lib/providers/types.ts`, has an
`isConfigured()`, and ships a deterministic fixture double. **Fixture proof and
live-retrieval proof are labelled separately everywhere in the evidence.**

---

## §7 — Braidon before / after (LIVE, not fixture)

Source: `docs/evidence/aac7-braidon-live-closure.json` (two consecutive live
lifecycle runs, 2026-07-29) and `docs/evidence/aac6-braidon-live-acceptance.json`.

### 7.1 Gates

| Gate | Directive baseline (24-sheet artifact) | Live BEFORE (no lifecycle, current name) | Live AFTER |
|---|---|---|---|
| RG-1 PROJECT & AHJ AUTHORITY | OPEN (3) | OPEN (2) | OPEN (2) |
| RG-2 EQUIPMENT RECONCILIATION | OPEN (2) | OPEN (2) | OPEN (1) |
| RG-3 ENVIRONMENTAL LOAD AUTHORITY | OPEN (1) | OPEN (1) | **CLEARED (0)** |
| RG-4 STRUCTURAL ASSEMBLY AUTHORITY | OPEN (6) | OPEN (5) | OPEN (5) |
| RG-5 ELECTRICAL FIELD & CALC CLOSURE | OPEN (3) | OPEN (2) | OPEN (2) |
| RG-6 Q-CABLE SYSTEM CLOSURE | OPEN (2) | OPEN (2) | OPEN (2) |
| RG-7 PROFESSIONAL RELEASE | OPEN (2) | OPEN (2) | OPEN (2) |
| **TOTAL** | **7 open / 19** | **7 open / 16** | **6 open / 14** |

Projected floor once the pending Ray actions land: **4 gates / 6 requirements**
(RG-4 framing judgement · RG-5 two field measurements · RG-6 extension SKU +
grounding judgement · RG-7 licensed review). The directive's "approximately 3
gates / 4-5 requirements" is one gate away and the directive forbids forcing it.

### 7.2 Requirements — 19 → 14, with disposition

| # | Requirement | Baseline | Now | Disposition · evidence |
|---|---|---|---|---|
| 1 | EQUIPMENT-IDENTITY-CONFLICT | open | **CLEARED** | AUTO_DERIVED · `canonical-equipment-selection@v1` · auditRef `equipment_reconciliation_audit#ebf0a515…` + `provenance:projects.selected_equipment.panelId`. Qcells 400 W canonical everywhere; REC 405 W survives only as superseded audit history |
| 2 | ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED | open | **CLEARED** | AUTO_RETRIEVED · `environmental-load-authority@v1` · `climate_hazard_dataset` sha256 `cedb14f7917ad39b` archived VERIFIED from gis.asce.org (`w2022_mri700`, `s2022_RiskCategory2`) + USGS. Gate RG-3 OPEN → CLEARED |
| 3 | PROJECT-NAME-NONPRODUCTION | open | **gone** | OPERATOR — Ray renamed the project 2026-07-27. Never auto-renamed |
| 4 | CONDUIT-FILL-PENDING | open | **not emitted** | AUTO_DERIVED (WS-7) — the NEC Ch.9 Table 1 computation always ran; three misspelled field reads discarded it |
| 5 | FEEDER-RACEWAY-AUTHORITY | (not in the 19) | **not emitted** | AUTO_DERIVED · `raceway-authority@v1` from the canonical segment objects |
| 6 | BRANCH-RACEWAY-AUTHORITY | (not in the 19) | **not emitted** | as (5) |
| 7 | RACEWAY-SEGMENT-CONFLICT | (not in the 19) | **not emitted** | as (5) |
| 8 | FASTENER-ASSEMBLY-UNVERIFIED | open | **not emitted** | WS-8 — the `_capGated` echo deleted; the mount base is verified (lag + count + embedment + ICC-ES ESR-3575) independently of the rail document |
| 9 | CODE-AUTHORITY-INCOMPLETE | open | OPEN | AUTO_RETRIEVED · FAILED with the exact source: *"AHJ_REGISTRY_TOKEN is not set — the SunSpec/Orange Button AHJ Registry was NOT queried."* **Blocked only on the token** |
| 10 | PROJECT-AUTHORITY-UNVERIFIED | open | OPEN | AUTO_RETRIEVED · address/boundary/AHJ/fire **verified** by Census (`authority:project-legal#38fb560e070167c8`, confidence 0.90); refuses to clear on *"apn: the posted APN was not confirmed against a parcel source"*. **Blocked only on `ATTOM_API_KEY`** |
| 11 | MODULE-EXACT-DATASHEET-PENDING | open | OPEN | AUTO_DERIVED→AUTO_RETRIEVED · RANGE-COVERED: the on-file 385–405 W series sheet covers the selected 400 W but no registry binding names the exact-wattage column. **Blocked only on one registry binding** |
| 12 | DESIGNER-OF-RECORD-MISSING | open | OPEN | AUTO_DERIVED · FAILED: `42P01 relation "personnel_roles" does not exist`. No vendor default substituted. **Blocked only on migration 115 + one designer assignment** |
| 13 | RACKING-CAPACITY-SOURCE-NOT-ARCHIVED | open | OPEN | AUTO_RETRIEVED · the RT-MINI II stamped PE letter was fetched, hashed (`73a74973091ca698`) and archived `unverified`. **Blocked only on the registry verify-click + the RT-MINI vs RT-MINI II confirmation** |
| 14 | RACKING-CAPACITY-APPLICABILITY-GAP | open | OPEN | as (13) |
| 15 | EQUIPMENT-DOCUMENT-APPLICABILITY | open | OPEN | as (13); the RT-MINI installation manual is archived (`2f6035586e948758`) |
| 16 | PENDING-RACKING-ASSEMBLY-SELECTION | open | OPEN | AUTO_DERIVED→OPERATOR_CONFIRMATION · all three stores probed, no rail recorded. Span-screened shortlist at 48″: IronRidge XR100, IronRidge XR1000, Unirac SME Rail, Unirac SolarMount Rail. **A design + procurement decision, not a derivation** |
| 17 | QCABLE-PROCUREMENT-INSUFFICIENT | open | OPEN | AUTO_DERIVED · the WS-5 engine evaluated **13 options** (stock-as-ordered, alternate listed variants, raw stock + field connectors, dead-drop, rebranch) across the live topology: 152 ft procured vs the 166.5 ft designed-installed path = **24.2 ft short** on branches br-1/br-2, and *"1 sub-array/roof-plane bridge totalling 29.3 ft exceeds the 4.25 ft molded connector pitch, so molded cable alone cannot complete the path … none complete."* **Blocked on selecting a VERIFIED listed extension SKU or accepting a route revision** |
| 18 | ROUTE-LENGTH-ESTIMATE | open | OPEN | **GENUINE FIELD_VERIFICATION** — the as-built conduit route is not in CAD or survey |
| 19 | TAP-CONDUCTOR-LENGTH-PENDING | open | OPEN | **GENUINE FIELD_VERIFICATION** — actual tap length at the service |
| 20 | FRAMING-AUTHORITY-UNVERIFIED | open | OPEN | **GENUINE PROFESSIONAL_APPROVAL** — no building-specific framing document is publicly retrievable for an existing stick-framed residence; the engine says so and stops |
| 21 | QCABLE-GROUNDING-AUTHORITY-UNVERIFIED | open | OPEN | **GENUINE PROFESSIONAL_APPROVAL** |
| 22 | ENGINEERING-REVIEW-PENDING | open | OPEN | **GENUINE PROFESSIONAL_APPROVAL** — digest-bound licensed review; migration 116 provides the record, never the approval |

The baseline's **19** are rows 1–4 and 8–22 (RG-1 3 · RG-2 2 · RG-3 1 · RG-4 6 ·
RG-5 3 · RG-6 2 · RG-7 2, per `docs/AAC-SOURCE-PATH-AUDIT.md` §2). Rows 5–7 were
never among them — they are additional codes the same `raceway-authority@v1`
derivation now keeps silent. Of the 19: **five are silent** (3, 4, 8 plus the
two cleared, 1 and 2), leaving **14 open**.

**Blocked ONLY by a pending Ray action:** 9, 10, 11, 12, 13, 14, 15, 16, 17 —
nine of the fourteen. **Genuinely remaining:** 18, 19, 20, 21, 22 — five.

### 7.3 Sheets

| Package | Sheets | Sheet index |
|---|---|---|
| Directive baseline artifact | 24 | PV-0 · RS-1(.1,.2) · PV-1 · PV-1B · PV-3 · PV-4C(.1) · E-1 · PV-4A · PV-4B · PV-5 · PV-6 · SCHED(-2,-3,-4) · APP-A · DS-1..3 · CERT · PE-1 |
| Live FULL profile (internal) | 25 | the same + RS-1.3 |
| **Live PERMIT profile (the AHJ submittal)** | **14** | PV-0 · PV-1 · PV-1B · PV-3 · PV-4C · PV-4C.1 · E-1 · PV-4A · PV-4B · PV-5 · SCHED · DS-1 · DS-2 · DS-3 |

11 core drawing sheets + a 3-page manufacturer attachment appendix. Repeated
package-status language: **209 → 74 occurrences (−64.6 %)**; sheets repeating
the package headline 25 → 13. The registry, the BOM and every requirement are
**identical under both profiles** — removing a page never removes a requirement
(`tests/planset/aac-ws10-planset-profile.test.ts`).

---

## §8 — AAC-7 defect fixes

### 8a — Repeat-generation audit churn (the reconciliation never reconciled)

**Root cause.** `reconcileEquipmentIdentity` wrote the winning value to
`projects.selected_equipment.<key>` **only**. The superseded record lives in
`engineering_config.subSystems.roof.panelId` (the doctrine owner of the
per-subsystem map) and in the `selected_equipment.subSystems` mirror of it, so
every generation re-detected the identical divergence and appended another
immutable audit row plus two `snapshot_digest_invalidations` rows. Two
consecutive live runs could disagree about the registry because run 1 changed
what run 2 read.

**Fix — both halves, because the machinery needs both.**

1. *The write.* `reconcileEquipmentIdentity` accepts
   `knownSnapshot.realign: MirrorRealignment[]` and re-aligns those exact
   mirrors **inside the same transaction** — `selected_equipment.subSystems`
   folded into the object already being written, `engineering_config.subSystems`
   through a guarded `jsonb_set(..., create_missing = false)` with an
   `IS DISTINCT FROM` predicate, so it can only ever CORRECT an existing
   contradicting record: it never creates a subsystem entry, never invents a
   field, and is a no-op once aligned. The re-aligned paths and their previous
   values are recorded in the audit row (`previous_values.realignedMirrors`) and
   returned on the result. This is the repair the DB layer already performs one
   level down (the P0-11 "recompute-if-contradicts" mirror repair,
   `lib/db/projects.ts:565-613`), lifted into the reconciliation transaction.
   It is deliberately **not** a blanket re-alignment: per-subsystem equipment is
   a first-class product feature, so only the records the precedence verdict
   actually superseded are touched.
2. *The read.* `canonical-equipment-selection@v1` now distinguishes a PERSISTED
   store from the POSTED REQUEST BODY (`isPersistedStorePath`). When no
   persisted store diverges, the resolver re-pins the posted input in memory and
   **writes nothing**, clearing by citing the audit row the original
   reconciliation already wrote (`findAppliedReconciliation`). A stale value in
   a request payload is not something a reconciliation can or should persist.

**Live proof** (`docs/evidence/aac7-braidon-live-closure.json`):

| | run 1 | run 2 |
|---|---|---|
| `equipment_reconciliation_audit` rows written | 1 | **0** |
| `snapshot_digest_invalidations` rows written | 2 | **0** |
| `canonicalEquipment.superseded` | 3 records (both DB mirrors + the posted body) | **1** (the posted body only) |
| `canonicalEquipment.corroborating` | 1 path | **3 paths** (both DB mirrors now agree) |
| `canonicalEquipment.reconciliation` | auditId `ebf0a515…`, 2 invalidations | **null** |
| open requirement set | 14 | **14, identical** |
| gate set / sheet indexes | — | **identical** |
| `engineering_config.subSystems.roof.panelId` | `rec-alpha-pure-405` → `qcells-peak-duo-400` | unchanged |

Unit proof: `tests/planset/aac-ws2-canonical-equipment-designer.test.ts` §E2b —
six cases, including "run 2 writes NOTHING" (the transactional writer is scripted
to THROW, so a clear proves it was never called), "two consecutive runs produce
the identical requirement set", and the anti-vacuity case "a mirror that is
GENUINELY ACTIVE is never re-aligned away" (two active explicit selections ⇒ no
reconciliation, no re-alignment, operator confirmation).

**Honest residue.** The snapshot DIGEST still differs between two consecutive
runs. The only deltas are retrieval timestamps — `retrievedAtIso`,
`resolutionEvidence[].atIso`, `lastResolutionAttempt` — which are the record of
WHEN authority was retrieved and cannot be frozen without lying about it. Every
substantive field, the registry, the gates and both sheet indexes are identical.

### 8b — Stale `cable-extension-solutions@v1` wording

The resolver reported *"the deterministic Q-Cable topology/procurement engine …
is not implemented yet (AAC-4)"* — untrue since AAC-4. It now states the real
state: no listed extension product is selected, so there is no extension
DOCUMENT for that resolver to resolve, and the alternate-stock / raw-stock /
dead-drop / rebranch option space **is** evaluated deterministically — by
`qcable-solution@v1`, which owns the requirement and states the governing
unresolved reason. Verified in the live output (§7.2 row 17).

### 8c — BAR harness gate 8 (racking-assembly vocabulary)

Gate 8 ("unverified fasteners are NON-ORDERABLE") derived its truth from
`assemblyVerification.overall !== 'verified'` and asserted that
`FASTENER-ASSEMBLY-UNVERIFIED` appears on RS-1. After the WS-8 separation that
code legitimately leaves the registry when the mount base is verified and the
open question is the rail-capacity DOCUMENT — so the gate demanded a code that
is no longer emitted, and would have been "fixable" by re-bundling the
requirements the campaign just separated.

The gate now uses the **renderer's own** three-term predicate (capacity-gated OR
the mount's own fastener element unverified OR no withdrawal-capacity source) —
the same one `projectFastenerAssembly` uses to decide `nonOrderable` — and
asserts that while non-orderable the RS surface discloses the requirement that
GOVERNS it, in whichever of the two separated vocabularies owns it. Silence in
both remains a failure. Result on the real package: `verification=unverified
capacityGated=true flagged=true label=true specLeaks=none
governing=RACKING-CAPACITY-SOURCE-NOT-ARCHIVED,RACKING-CAPACITY-APPLICABILITY-GAP
governingOnRs1=(both)` — **strictly more asserted than before, not less**.

The identical drift was found and fixed in two sibling harnesses:
- **EP gate 13** (`visible-pending-authority-in-registry`) — same governing-code
  set; nothing may render as pending without a registered requirement behind it.
- **PPC gate 5** (`pending-fastener-renders-no-exact-instruction`) — had gone
  *vacuous* (it skipped itself) exactly when it had something to check.

**EP gate 21** was also repaired, for a different reason: it hardcoded "the
frozen fixture is SUFFICIENT, the live design is SHORT", which was the
AGGREGATE-only sufficiency engine's answer. The WS-5 engine evaluates PER
BRANCH, and the frozen fixture is the textbook case the campaign exists to
catch — 152 ft ordered vs 140.5 ft designed is sufficient in aggregate while
branch B2 (58.3 ft designed vs 49 ft procured) is 9.3 ft short. Asserting the
old expectation would have demanded the engine go back to hiding a real
per-branch deficit. The mode expectation is replaced by the engine's own verdict
plus two non-vacuity requirements: the per-branch basis must be populated, and
an insufficiency must NAME the branches it comes from.

### 8d — PV-4C live-data internal clip: **documented, not fixed** (pre-existing)

`scripts/planset-pagefit.mjs` reports `INTERNAL-CLIP-V 26.4px` on PV-4C for the
LIVE project under BOTH profiles, identically. The clipped element is the
"CONTINUED ON PV-4C.1" pointer strip, the last block on the sheet.

**It pre-dates this campaign, and AAC-7 proved it.** The same live input
rendered with **no resolution lifecycle at all** — the pre-AAC engine path —
already clips PV-4C by **16.3 px**:

```
_tmp_aac7_live_before.html   PV-4C  INTERNAL-CLIP-V 16.3px   (no lifecycle)
_tmp_aac7_live_run1_full     PV-4C  INTERNAL-CLIP-V 26.4px
_tmp_aac7_live_run1_permit   PV-4C  INTERNAL-CLIP-V 26.4px
```

The extra ~10 px is the resolved environmental provenance now printing a real
retrieved source instead of a shorter "unverified" line — a truth improvement.
The frozen fixture does not reproduce the clip at all (24/24 and 14/14 sheets
clean, every harness gate 13/16/19/23 green): the live design carries **one more
reaction-schedule row** than the fixture, and the sheet's fit margin is one row.

**Why it is documented rather than fixed.** The only content-preserving fix is
to move a block between PV-4C and PV-4C.1 — reopening closed visual work the
directive explicitly forbids — and it would break the FULL profile's
byte-identity with the pre-WS-10 baseline (`712d70cb…`, 1 177 179 B), an
invariant re-verified in this pass. A data-dependent layout hack (shrinking
padding only when the row count is high) is worse than the 26 px. Recorded here
as a known **pre-existing live-data layout issue**; the clipped text is a
pointer line whose target sheet immediately follows, so no engineering content
is lost.

---

## §9 — Validation: commands and ACTUAL results

Full machine-readable record: `docs/evidence/aac7-validation-results.json`.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — 0 errors |
| `npx next build` | **PASS** — exit 0, all routes compiled |
| `npx vitest run tests/planset` | **PASS** — 89 files / **1 296 tests** |
| `npx vitest run tests/golden-path.test.ts` | **PASS** — 27 tests |
| `npx vitest run` (full suite) | 398 files: 377 passed / 4 failed / 17 skipped · 9 116 tests: **8 622 passed / 5 failed** / 489 skipped — **all 5 failures pre-existing** (below) |
| `npm run check:assisted-evidence-boundaries` | **PASS** |
| `npm run check:topology` | FAIL — **pre-existing**, unrelated files (documentProvenance / engineeringDecisionProvenance / survey-evidence cycles), untouched by this campaign |
| `npm run check:engineering-boundaries` | FAIL — **pre-existing**, `tests/planset/aerial-edge-snap.test.ts` `sharp()` image-byte analysis, untouched by this campaign |
| `npm run lint` | not the repo standard for this work (`next lint`); the three guards above are what this repo enforces |

**The 5 pre-existing full-suite failures**, each proven pre-existing:
- `tests/phase1a-migration-governance.test.ts` ×2 — `file.fullPath` contains
  Windows `\` separators, asserted as `lib/migrations`. Stashing this file's
  campaign edits and re-running the BASELINE version produces **5** failures on
  this tree (the campaign's edits fix 3 of them by updating the migration counts
  to 113 files / highest prefix 116); the 2 separator failures are byte-identical
  to `a6a225ae` and are the documented Windows≠Linux class (CI runs Linux).
- `tests/priority5-crew-calendar.test.ts` ×1 — `weekStart()` timezone.
- `lib/assistedEvidenceSources/{metadataRuntimeAdapter,ocrRuntimeAdapter}.test.ts`
  ×2 — `spawnSync npm ENOENT` (Windows shell shim).

### Rendered-truth harnesses — every gate, at the final tree

| Harness | Modes | Result |
|---|---|---|
| RGM (release-gate model, 17 gates) | fixture · insufficient · identity | **17/17 ×3** |
| ECD (engine closure, 24 gates + anti-vacuity) | fixture · insufficient · identity | **24/24 ×3, anti-vacuity 24/24 ×3** |
| BAR (blocker & authority reconciliation, 14 gates) | original | **14/14** (gate 8 repaired, §8c) |
| BAR-WSE (chained electrical authority, 40 gates) | — | **40/40** |
| PPC (projection / procurement, 18 gates) | fixture | **18/18** (gate 5 de-vacuumed, §8c) |
| EP (electrical closeout, 22 gates) | original | **22/22** (gates 13 + 21 repaired, §8c) |
| CO (final closeout, 20 gates) | live | **20/20** |

### Regeneration determinism

The FULL profile requested four different ways — engine default,
`plansetProfile`, `permitOptions.plansetProfile`, `planSetOptions.plansetProfile`
— produces a **byte-identical** package with **no lifecycle and no DB**:

```
sha256 0767dd976840ec87…  bytes 1 177 179  digest 712d70cbf42aa35f…  sheets 24  registry 14   (×4)
```

That digest and byte count are exactly the pre-WS-10 (AAC-5) baseline: the
compaction added a profile, it did not change the internal package. The
regenerated fixture HTML is byte-identical to AAC-6's
(`sha256 5ec3103c37bfc706…`), confirming the AAC-7 defect fixes are
resolver/harness-only and render-neutral.

### Live regeneration (definitive)

Two consecutive full-lifecycle runs against the live Neon row and the real
`permit_input.json` — before/after, idempotence and page-fit all recorded in
`docs/evidence/aac7-braidon-live-closure.json`. Headline: **7 gates / 16
requirements → 6 gates / 14 requirements**, 25-sheet internal package → 14-page
permit submittal, 0 new audit rows on the second run, identical registries.

---

## §10 — Remaining legitimate work

### 10.1 Ray actions (each unblocks a named requirement)

1. **Set `AHJ_REGISTRY_TOKEN`** in the deployment environment (free token from
   support@sunspec.org) — clears the adopted-edition retrieval.
2. **Set `ATTOM_API_KEY`** — lets the APN be confirmed against the assessor
   record and clears PROJECT-AUTHORITY-UNVERIFIED.
3. **Run migrations 115 then 116** through the governed console (Admin → System
   Tools → Migrations), then set the designer in Admin → Personnel.
4. **In Admin → Document Registry:** verify the two archived Roof Tech documents
   (they land `unverified` by design) AND confirm whether the RT-MINI II stamped
   letter governs the installed RT-MINI hardware (or change the selection to
   RT-MINI II).
5. **Pin the rail/splice** for the RT-MINI assembly (eligible listed rails,
   span-screened at 48″: IronRidge XR100, IronRidge XR1000, Unirac SME Rail,
   Unirac SolarMount Rail).
6. **Register the exact Qcells 400 W datasheet binding** (the on-file document
   is the 385–405 W family sheet).
7. **Select a VERIFIED listed Q-Cable extension/jumper SKU** (24.2 ft deficit)
   or accept a route revision.

Requirements blocked **only** by the list above: CODE-AUTHORITY-INCOMPLETE (1) ·
PROJECT-AUTHORITY-UNVERIFIED (2) · DESIGNER-OF-RECORD-MISSING (3) ·
RACKING-CAPACITY-SOURCE-NOT-ARCHIVED, RACKING-CAPACITY-APPLICABILITY-GAP,
EQUIPMENT-DOCUMENT-APPLICABILITY (4) · PENDING-RACKING-ASSEMBLY-SELECTION (5) ·
MODULE-EXACT-DATASHEET-PENDING (6) · QCABLE-PROCUREMENT-INSUFFICIENT (7).

### 10.2 Genuinely remaining engineering work (no pending action can clear it)

| Requirement | Class | Why it cannot be automated |
|---|---|---|
| ROUTE-LENGTH-ESTIMATE | FIELD_VERIFICATION | the as-built conduit route exists in neither CAD nor survey |
| TAP-CONDUCTOR-LENGTH-PENDING | FIELD_VERIFICATION | actual tap length at the service is a physical measurement |
| FRAMING-AUTHORITY-UNVERIFIED | PROFESSIONAL_APPROVAL | no building-specific framing document is publicly retrievable for an existing stick-framed residence; a prescriptive IRC/AWC span tier is a legitimate FUTURE addition, not a fabrication |
| QCABLE-GROUNDING-AUTHORITY-UNVERIFIED | PROFESSIONAL_APPROVAL | licensed bonding/grounding judgement for the assembly |
| ENGINEERING-REVIEW-PENDING | PROFESSIONAL_APPROVAL | digest-bound licensed review, signature and seal. Migration 116 stores the RECORD; the engine never writes the approval |

### 10.3 Known issues carried forward
- PV-4C live-data internal clip, 26.4 px (§8d) — pre-existing at 16.3 px.
- `check:topology` / `check:engineering-boundaries` guard failures (§9) — both
  pre-existing and in files untouched by this campaign.

---

## §11 — Boundaries held

- **Nothing fabricated.** Every cleared requirement carries a source, a hash or
  an audit row. `deriveRequirementStatus` refuses `resolved` without a
  `resolutionAuditRef`, and `verifyClearedRequirementsHaveEvidence` is asserted
  in every lifecycle test.
- **Licensed work untouched.** No PE, EOR, signature, seal or digest approval is
  ever populated. `project-personnel-designer@v1` can fill only designer /
  preparer / reviewer; `engineering-review-record@v1` reads records and never
  writes one.
- **Unknown codes fail closed.** An undeclared requirement lands in
  `RG-UNMAPPED` and blocks every axis.
- **The renderer decides nothing.** It consumes the frozen snapshot; document
  applicability is decided once, in the build, from real registry facts.
- **Retrieval failures are never swallowed.** Each carries the exact source
  queried, the exact failure, retryability and the minimal operator action.
- **No Braidon-only code paths.** The live project's numbers appear only in test
  fixtures and evidence artifacts.
- **Migrations 115 / 116 await Ray.** The engine reports their absence as a
  precise retryable failure and substitutes nothing.
