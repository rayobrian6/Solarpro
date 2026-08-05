# SOLARPRO — SYSTEM-WIDE AUTHORITY PROPAGATION AUDIT

**Phase type:** audit only. No source code, migration, test, database or artifact was modified.
**Date:** 2026-08-05
**Runtime access:** live Neon `neondb`, **read-only session pinned and verified** (`SHOW default_transaction_read_only` = `on` before every probe; `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` also applied).
**Live evidence:** 5 read-only probes + 4 full live permit generations (3 profiles + a 2-pass determinism proof).

---

## 0. SECURITY PRECONDITION — STILL BLOCKED

The production Neon owner credential is **still unrotated**.

| Check | Result |
|---|---|
| `.db_url` password SHA-256 (first 12) | `a40357903308` |
| `KNOWN_COMPROMISED_FINGERPRINTS` entry (`lib/security/secretScan.ts:52`) | `a40357903308` |
| Match | **TRUE — byte-identical to the burned credential** |
| DB user | `neondb_owner` (unchanged) |
| `.db_url` mtime | 2026-06-06 12:02:08 (unchanged since discovery) |

**Consequence for this phase:** every runtime claim below was obtained through a read-only session. **No write was attempted or performed.** Three requirements (`CODE-AUTHORITY-INCOMPLETE`, `DESIGNER-OF-RECORD-MISSING`, `MODULE-EXACT-DATASHEET-PENDING`) plus the three racking document-verification items cannot be closed until writes are permitted, which requires rotation first.

### Two credential-handling defects found during this audit

1. **I printed the live connection string into this session's transcript.** My redaction regex anchored on `^postgres`, but `.db_url` begins with a UTF-8 BOM, so the pattern did not match and the raw line printed. This duplicates an exposure that has been public in git history since `b583829a` (2026-03-05); it does not create a new one. All subsequent probes used fingerprint comparison only.
2. **`_tmp_rr_live_regen.ts:12` (untracked scratch, repo root) contains the live password as a hardcoded literal.** It is untracked so the commit guard never sees it, but it sits inside the repository working tree. `lib/security/secretScan.ts` only scans tracked/staged content.

---

## 1. EXECUTIVE VERDICT

**The problem is NOT systemic in the way the brief anticipated.**

The canonical-authority architecture is real and, in the majority of chains, correctly plumbed end to end. Nine of the twelve open Braidon requirements are **honest** — the authority is genuinely absent, or genuinely requires a human act (field measurement, operator selection, licensed judgment, government evidence). Those are not software defects and no repair will close them.

What the audit *did* find is a **tightly clustered failure in one domain — racking / manufacturer-document authority — plus eleven discrete, individually-scoped defects elsewhere.** The racking cluster has the exact shape the brief predicted: *archived, hashed, correct documents exist in persistence and the consumer does not use them, preferring a hardcoded literal and a stale static asset.*

### Confirmed broken chains

| Chain | Status |
|---|---|
| Racking capacity provenance | **BROKEN** — hardcoded fallback asserts "not archived / hash null / jurisdiction KY" while two archived, SHA-256'd PE letters (the **Illinois** variants) sit in `manufacturer_document_registry` |
| Racking installation document identity | **BROKEN** — static asset cites the RT-MINI **II** manual for a selected RT-MINI; the version-exact RT-MINI manual is archived and hashed in the registry and is not consulted |
| Document jurisdiction stamping | **BROKEN** — all four registry rows carry `jurisdiction_boundary = "City of Granite City Building & Zoning"`, the **mailing city**, not the canonical legal AHJ (Madison County). Verifying these documents would still fail the clearance check |
| Document verification regime | **BROKEN (inconsistent)** — the environmental resolver marks its own evidence `verified` with a null verifier; the structural resolver correctly refuses to self-verify. Same table, same column, opposite policies |
| Module datasheet applicability | **BROKEN (contradictory)** — the same snapshot simultaneously reports the module datasheet `APPLICABLE / applicabilityVerified: true` and `MODULE-EXACT-DATASHEET-PENDING` |
| Download filename identity | **BROKEN** — the browser overrides the server's correct `Content-Disposition` with the stale `engineering_config` mirror |
| `blocking-validators` gate precondition | **BROKEN (mislabelled)** — reports "blocking snapshot violation(s) present" while the real validator returns **zero** |
| Rail selection persistence | **BROKEN (absent)** — no field exists anywhere to store an operator's rail decision |
| Artifact byte-stability | **BROKEN** — RS-1 renders moving resolver instants; identical designs produce different HTML |

### Chains verified INTACT

Project identity (server side), AHJ / municipal-boundary resolution, environmental load authority, digest determinism, review-coverage refusal logic, invalidation-ledger time semantics, structural BOM sourcing, tap-conductor length ownership, framing capacity honesty, requirement→gate aggregation, hidden-blocker coverage.

### Evidence basis

- **Live-runtime proven:** the 12-requirement ledger, all gate/registry counts, sheet counts, digests, every database row cited, digest determinism, artifact byte-instability, validator-vs-gate contradiction, rail-selection probes, environmental precedence.
- **Source-only (marked `SOURCE-ONLY — RUNTIME UNVERIFIED`):** the client-side download filename (requires a browser session), and the behaviour of the racking clearance path *after* a document is verified (requires a write).

---

## 2. REPOSITORY AND RUNTIME BASELINE

| Item | Verified value |
|---|---|
| Repository path | `C:/Users/Ray/Solarpro Claude/repo` |
| Current branch | `dev` |
| Current HEAD | `b6572ed9f6423a56b9cd92710372f7b05c42ef37` |
| `origin/dev` HEAD | `b6572ed9` — **identical**, 0 ahead / 0 behind |
| Working tree — tracked | **clean** (0 modified tracked files) |
| Working tree — untracked | 425 entries, all `_tmp_*` scratch + `.claude/` |
| Permit engine version | `PLANSET_ENGINE_VERSION = 47500` (`lib/permit/constants.ts:728`) |
| Braidon project ID | `4030b664-bebe-433b-a11c-cda05ead2f7d` |
| `projects.name` (canonical) | `BRAIDON M PILLA — Solar` |
| `engineering_config.projectName` (mirror) | `BRAIDON M PILLA — Solar TEST` ← **stale** |
| Release state | `PENDING ENGINEERING REVIEW` |
| Open root gates | **5** — RG-1, RG-2, RG-4, RG-5, RG-7 |
| Unresolved requirements | **12** |
| Advisories | 0 |
| Gate distribution | RG-1:1 · RG-2:1 · RG-4:6 · RG-5:2 · RG-7:2 = **12** ✔ matches brief exactly |

### Per-profile snapshot identity (one live resolver lifecycle, three renders)

| Profile | Snapshot ID | Digest | Sheets |
|---|---|---|---|
| `design-review` | `PDS-E66832646EAC` | `e66832646eac5bac151c3a41773bf3921be69b5899d6519a8262ac2dacdcd407` | **19** |
| `permit` | `PDS-7C60F89EB894` | `7c60f89eb894008c72e76a11c8b22a5e7eaf073310851ce468a7afd686597282` | **18** |
| `full` | `PDS-78B1A50C4565` | `78b1a50c4565c245de256c48ff1903eab01dba40410a666ec21054835e1adbf8` | **25** |

Sheet counts were taken from the **title block** (`SHEET n OF N`), not `<div class="page">`. Title-block `N` agrees with the counted sheet-ID count on all three profiles.

`full` sheet set: `PV-0 RS-1 RS-1.1 RS-1.2 PV-1 PV-1B PV-3 PV-4C PV-4C.1 E-1 PV-4A PV-4B PV-4B.1 PV-5 PV-6 SCHED SCHED-2 SCHED-3 SCHED-4 APP-A DS-1 DS-2 DS-3 CERT PE-1`

This is the correct applicable set for a roof-mount project. No fence / ground-mount / tracker sheets are expected or missing.

### Persistence census (read-only)

91 tables. Rows relevant to this audit:

| Table | Rows (all) | Rows (Braidon) |
|---|---|---|
| `ahj_registry` | 2 | — |
| `manufacturer_assets` | 89 | — |
| `manufacturer_document_registry` | 4 | — |
| `personnel_roles` | **0** | — |
| `project_personnel_assignments` | **0** | 0 |
| `engineering_review_records` | **0** | 0 |
| `field_route_measurements` | **0** | 0 |
| `snapshot_digest_invalidations` | 22 | **22** |
| `equipment_reconciliation_audit` | 11 | 11 |
| `organizations` | 1 | — |
| `users` | 81 (3 with `org_id`) | — |

Migrations 108–118 all recorded `applied`. **Correction to earlier notes: migration 115's tables `personnel_roles` and `project_personnel_assignments` both EXIST** with the full expected column set; they are simply empty. The earlier "missing table" note is stale.

---

## 3. COMPLETE TWELVE-REQUIREMENT LEDGER

Captured from the real `projectReleaseGates(snap)` over the live `full` snapshot. Registry size = 12, unresolved = 12, blocking = 12, advisory = 0. Every entry has `resolved: false`, `resolutionAuditRef: null`.

---

### 3.1 `CODE-AUTHORITY-INCOMPLETE` — RG-1 · `PENDING_AUTHORITY` · blocking

- **Title:** Adopted code editions not established from an archived AHJ adoption document
- **Authority path:** `codeAuthority.editions` · **Provenance:** `snapshot build (permitReadiness)`
- **Sheets:** PV-0, CERT, PE-1 · **Role:** admin

| Stage | Braidon value |
|---|---|
| Persistence — `ahj_registry.il-madison-county` | `nec_edition='2020'`, `ibc/irc/ifc_edition = NULL`, `provenance='seeded-unprovenanced'`, `source_url=NULL`, `source_sha256=NULL`, `verified_by=NULL` |
| Persistence — `ahj_registry.il-madison-granite-city` | identical NULL pattern |
| Resolver — `code-adoption-composite` | 2 recorded attempts, both `NO_COVERAGE`: no internal row for IL/Madison **and** `AHJ_REGISTRY_TOKEN is not set — the SunSpec/Orange Button registry was NOT queried` |
| Snapshot | `editions.ibc/irc/ifc = { edition: null, source: 'unknown' }`, note: *"no AHJ adoption authority for this code family — edition left null (no inference)"* |
| Gate / registry / renderer | consistent — prints PENDING |

**First break:** the canonical system has no adopted IBC/IRC/IFC edition for Madison County, and the one external source that could supply it was never queried because its token is unset.

**Classification: `AUTHORITY_GENUINELY_ABSENT`** → requires **government/AHJ evidence** (an archived adoption ordinance) or an `AHJ_REGISTRY_TOKEN`.
**Problem type:** Data + Configuration. No code defect. The refusal to infer is correct behaviour.

> **Adjacent finding (not this requirement):** the NEC 2020 edition that *is* present came from the **static file** `lib/jurisdictions/ahj-national.ts` (`provenance.ref = "ahj-national:il-madison-county"`), **not** from the `ahj_registry` table — which independently holds `nec_edition='2020'` under a different provenance. See §6 duplicate inventory.

---

### 3.2 `MODULE-EXACT-DATASHEET-PENDING` — RG-2 · `PENDING_DOCUMENT` · blocking

- **Authority path:** `equipment-db(module) → manufacturer-assets-db#module_spec:qcells-peak-duo-400`
- **Provenance:** `equipmentProjection`, ref `qcells-peak-duo-400` · **Sheets:** DS-1 · **Role:** operator

| Stage | Braidon value |
|---|---|
| Selection | `qcells-peak-duo-400`, `Q.PEAK DUO BLK ML-G10+ 400W`, 400 W |
| `manufacturer_assets` row | `module_spec:qcells-peak-duo-400`, `model = "Q.PEAK DUO 400W"`, `doc_title = "Qcells Q.PEAK DUO BLK ML-G10+ 385-405W Datasheet"`, `page_ref = "full"`, `verified = true`, **no sha256 column exists on this table** |
| `manufacturer_document_registry` | **no module row at all** (4 rows: 1 climate, 3 Roof Tech) |
| Snapshot — `equipmentDocumentAuthority` | `state: "APPLICABLE"`, `applicabilityVerified: true`, `archived: true`, `authoritative: false`, `registryFactsPresent: false`, reason *"The on-file document matches the asset product version (no version conflation)"* |
| Snapshot — `permitReadiness.registry` | `MODULE-EXACT-DATASHEET-PENDING` — *"the on-file document is the 385–405 W family datasheet, not the exact 400 W sheet"* |

**First break: the snapshot itself.** Two evaluators over the same asset reach **opposite verdicts** in the same frozen snapshot. `equipmentDocumentAuthority` compares `manufacturer_assets.model` ("Q.PEAK DUO 400W") against the selected model and finds no version conflation → APPLICABLE, verified. `equipmentProjection` reads `doc_title` and finds a family range → PENDING.

**Classification: `CONSUMER_WIRING_FAILURE`** (confirmed software defect — two evaluators, one document, contradictory conclusions), **compounded by** `LEGITIMATE_OPERATOR_DECISION_REQUIRED` for the underlying document question.

**Does a valid Q CELLS document exist?** Yes — an archived, verified static asset. **Does it explicitly cover the 400 W variant?** The asset's `model` field says "Q.PEAK DUO 400W"; the `doc_title` says the sheet spans 385–405 W. **A 400 W-only PDF is NOT proven necessary.** What is missing is a canonical, hashed representation of *model-family applicability* (an explicit "this document covers 385/390/395/400/405 W" claim with a page/column reference). `allBound` can be vacuously true because `registryFactsPresent: false` — the binding is asserted against a hash-less asset. No exact-page or exact-column requirement is enforced anywhere.

**Problem type:** Code (the contradiction) + Data (no registry row, no hash, no family-applicability claim).

---

### 3.3 `FRAMING-AUTHORITY-UNVERIFIED` — RG-4 · `PENDING_AUTHORITY` · blocking

- **Authority path:** `structural (structural-engine-v4 objects)` · **Provenance:** `structuralAuthority`
- **Sheets:** PV-4C, PV-3, PE-1, CERT · **Role:** operator

| Stage | Braidon value |
|---|---|
| Observation (`projects.engineering_config`) | `framingType: truss`, `rafterSize: 2x6`, `rafterSpan: 12`, `rafterSpacing: 24`, `rafterSpecies: Douglas Fir-Larch` |
| Snapshot `structural.framingObservation` | present |
| Snapshot `structural.framingCapacityAuthority` | **`null`** |
| Snapshot `structural.checks[chk-framing-capacity]` | `demand: null`, `capacity: null`, `dcRatio: null`, **`passes: null`** |
| `structural.governing` | `passes: null` |

**First break:** none — this chain is **correct end to end**. Geometry is present and correctly classified as *observation*; capacity is `null` and the check refuses to return a verdict. The prohibition on merging framing geometry with verified framing capacity is **honoured**.

**Classification: `LEGITIMATE_LICENSED_AUTHORITY_REQUIRED`.**
**Problem type:** Licensed professional action (project-specific structural review, or an archived truss design drawing / manufacturer capacity calculation).

---

### 3.4 `PENDING-RACKING-ASSEMBLY-SELECTION` — RG-4 · `PENDING_SELECTION` · blocking

- **Authority path:** `structural (structural-engine-v4 objects)` · **Provenance:** `structuralAuthority`
- **Sheets:** PV-4C, PV-3, PE-1, CERT · **Role:** designer

The `rackingAssemblySelection` resolver (`lib/permit/snapshot/resolution/railSelection.ts`) probes **three** persistence paths. Live verdict:

| Probe path | Present | Note (verbatim from the live snapshot) |
|---|---|---|
| `project.railId \| project.railModel \| project.railSku` | **false** | *"PermitInput.project carries mountingSystemId only — no rail field is defined on the type."* |
| `projects.selected_equipment.rail*` | **false** | *"SelectedEquipment carries panel / inverter / mounting / battery. No rail slot exists in the contract."* |
| `mounting-hardware-db[rooftech-mini].rail` | **false** | *"The mount's OWN rail spec… absent for a mixed-manufacturer mount."* |

Verdict `state: "unselected"`, `requiredSpanIn: 48`, `partNumberAvailability: "none-in-catalog"`, 4 span-screened eligible candidates (IronRidge XR100 96", XR1000 84", Unirac SME 78", Unirac SolarMount 72").

**First break: persistence.** The decision is genuinely open **and there is no field anywhere in which an operator could record it.** The resolver produces a correct shortlist; nothing can consume a selection because no selection can be stored.

**Classification: `LEGITIMATE_OPERATOR_DECISION_REQUIRED` + `PERSISTENCE_FAILURE`** (confirmed software defect: no persisted selection path exists).
**Problem type:** Operator decision **blocked by** missing code (schema + write path).

---

### 3.5 `FASTENER-ASSEMBLY-UNVERIFIED` — RG-4 · `PENDING_AUTHORITY` · blocking

- **Message:** *"the only cited source (ICC-ES ESR-3575) is a flashing / water-resistance evaluation report, which carries no fastener-installation authority."*

| Stage | Braidon value |
|---|---|
| Canonical assembly `capacitySource` | `"Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023"` |
| Canonical assembly `iccEsReport` / `ul2703ListingBasis` / `datasheetSource` | all `"ICC-ES ESR-3575"` |
| Same record's `notes[]` | *"ESR-3575 is a flashing / water-resistance report and carries no structural value"* |
| Registry — version-exact installation manual | **`doc-rooftech-rtmini-install-manual-2f6035586e94` EXISTS**, `archived_in_repo: true`, `sha256: 2f6035586e94…`, `equipment_model_applicability: "RT-MINI"`, `verification_state: **unverified**` |

**First break: consumer.** The fastener verifier is never handed the installation authority, because the only archived installation manual for the *selected* product is `unverified` and therefore invisible to `findVerifiedDocument` (which requires `verification_state = 'verified'`).

**Classification: `RETRIEVAL_FAILURE`** — the authority exists in persistence, archived and hashed, and is not retrieved. Underlying gate is an operator verification act that no workflow currently drives.
**Problem type:** Data (unverified row) + Code (the structured `capacitySource` field names a document its own notes disqualify — see D6).

---

### 3.6 `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` — RG-4 · `PENDING_DOCUMENT` · blocking

- **Provenance:** `rackingAssembly.structuralAuthorityGaps`
- **Message:** *"cites a Roof Tech PE structural letter that is NOT archived in-repo (documentHash null)."*

**This claim is false against live persistence.**

| Source | State |
|---|---|
| `lib/permit/snapshot/rackingAssembly.ts:396-403` (hardcoded) | `documentHash: null`, `archivedInRepo: false`, hashNote *"no PDF/datasheet file exists in this repository (searched docs/, public/, assets, _tesla_docs)"* |
| `manufacturer_document_registry` row 1 | `doc-rooftech-rtmini2-pe-letter-3b9a2a9588d2` · ASCE **7-10** · `archived_in_repo: **true**` · `sha256: 3b9a2a9588d237af…` · `RT_Mini_II_ASCE_7-10_IL.pdf` |
| `manufacturer_document_registry` row 2 | `doc-rooftech-rtmini2-pe-letter-73a74973091c` · ASCE **7-16** · `archived_in_repo: **true**` · `sha256: 73a74973091ca698…` · `RT_Mini_II_ASCE_7-16_IL.pdf` |
| Both rows | `verification_state: **unverified**` |

**First break: consumer.** `buildRackingAssembly` emits a hardcoded "not archived" literal whenever `opts.capacityDocument` is absent. It is absent because the registry rows are `unverified`, so `findVerifiedDocument` refuses them. The rendered sheet therefore asserts a fact — *"no PDF exists in this repository"* — that the database contradicts.

**Classification: `CONSUMER_WIRING_FAILURE`** (hardcoded fallback asserts a false negative about persistence state).
**Problem type:** Code + Data.

---

### 3.7 `RACKING-CAPACITY-APPLICABILITY-GAP` — RG-4 · `PENDING_AUTHORITY` · blocking

- **Message:** *"the PE-letter jurisdiction (ASCE 7-10, **KY**) is not confirmed for the project AHJ."*

**Two independent falsehoods in this message.**

1. **The archived documents are the ILLINOIS variants.** `archived_file_identity` = `…/RT_Mini_II_ASCE_7-10_**IL**.pdf` and `…/RT_Mini_II_ASCE_7-16_**IL**.pdf`. The "KY" claim is a hardcoded string at `lib/permit/snapshot/rackingAssembly.ts:391, 405, 437` (`'RT-MINI II ASCE 7-10 (KY)'`, `'Source basis = ASCE 7-10, Kentucky'`, `'(ASCE 7-10, KY)'`). The registry's `applicability_notes` repeats "The 7-10 (KY) issue…" — **and the ASCE 7-16 row carries the 7-10 row's note verbatim**, a copy-paste provenance error.
2. **A latent trap that would survive verification.** All four registry rows carry `jurisdiction_boundary = "City of Granite City Building & Zoning"` — the **mailing city**, not the canonical legal AHJ. `evaluateRackingCapacityClearance` (`rackingAssembly.ts:217`) fails on `norm(evidence.jurisdiction) !== norm(ctx.projectJurisdiction)`. Canonical `codeAuthority.ahjName = "Madison County Building & Zoning"`. **Verifying these documents would NOT clear this requirement** — the jurisdiction comparison would still fail.

The stamping origin is `lib/permit/snapshot/resolution/structuralResolvers.ts:245`:
```
jurisdictionBoundary: ctx.authority.projectJurisdiction ?? (stateCode ? `US-${stateCode}` : null)
```
which resolved to the mailing-city AHJ at archival time.

**Classification: `PROVENANCE_LOSS`** (hardcoded jurisdiction contradicting the archived evidence) **+ `PERSISTENCE_FAILURE`** (documents stamped with the wrong AHJ).
**Problem type:** Code + Data.

---

### 3.8 `EQUIPMENT-DOCUMENT-APPLICABILITY` — RG-4 · `PENDING_DOCUMENT` · blocking

- **Authority path:** `snapshot (document)` · **Provenance:** `structuralAuthority` · **Sheets:** `[]` (none)
- **Message:** *"cited RT-MINI II covers a different product version than the selected mount RT-MINI."*

| Owner | Value |
|---|---|
| Selected mount | `rooftech-mini` / **RT-MINI** |
| Static asset `racking_detail:rooftech-mini` | `source_url = …/Installation-Manual-**RT-MINI-II**.pdf`, `doc_title = "Roof Tech RT-MINI **II** Installation Manual (Jun 2025)"` |
| Registry `doc-rooftech-rtmini-install-manual-2f6035586e94` | `"Roof Tech **RT-MINI** Installation Manual (Jan 2021)"`, correct URL, `archived_in_repo: true`, `sha256` present, `verification_state: unverified` |
| Snapshot `equipmentDocumentAuthority[racking_detail:rooftech-mini]` | `documentTitle: "Roof Tech RT-MINI II Installation Manual (Jun 2025)"`, `state: PENDING_APPLICABILITY` |

The registry's own `applicability_notes` on the correct row states the case exactly: *"the on-file asset cites the RT-MINI II manual for a selected RT-MINI, and the correct fix is the version-exact document, not a cross-reference."*

**First break: consumer.** The snapshot reads the **static asset**; the version-exact registry document exists, is archived and hashed, and is never reached.

**Classification: `DOCUMENT_IDENTITY_MISMATCH` + `LEGACY_PRECEDENCE_FAILURE`** (static `manufacturer_assets` overrides the resolver-capable `manufacturer_document_registry`).
**Problem type:** Code (precedence) + Data (unverified row).

> Note: `affectedSheets` is **empty** for this requirement while the other five RG-4 items list `PV-4C, PV-3, PE-1, CERT`. A blocking document-applicability gap with no affected sheet means no sheet is obliged to display it.

---

### 3.9 `ROUTE-LENGTH-ESTIMATE` — RG-5 · `FIELD_VERIFICATION` · blocking

- **Authority path:** `electrical.routeSegments[].lengthSource` · **Sheets:** PV-1, PV-4B, E-1, SCHED

Live route ledger:

| Segment | From → To | Ownership | ft | `lengthSource` |
|---|---|---|---|---|
| `ROOF_RUN` | PV ARRAY → MICROINVERTERS | PROJECT_OWNED | 15 | `cad-derived-estimate` |
| `BRANCH_RUN` | MICROINVERTERS → AC COMBINER | PROJECT_OWNED | **64** | **`cad-route` / geometry-derived** ✔ not blocked |
| `BRANCH_HOMERUN_RUN` | ROOF JBOX → AC COMBINER | PROJECT_OWNED | 18 | `cad-derived-estimate` |
| `COMBINER_TO_DISCO_RUN` | AC COMBINER → AC DISCONNECT | PROJECT_OWNED | 20 | `cad-derived-estimate` |
| `DISCO_TO_METER_RUN` | AC DISCONNECT → MSP | PROJECT_OWNED | 15 | `cad-derived-estimate` |
| `MSP_TO_UTILITY_RUN` | MSP → UTILITY METER | **UTILITY_OWNED** | — | **EXCLUDED** (utility-owned service equipment) |

`field_route_measurements` = **0 rows** (table exists, migration 118 applied).

**Current policy:** a CAD-derived estimate is rejected as route authority; only routed geometry or a field measurement satisfies it. `BRANCH_RUN` demonstrates the policy works — geometry-derived, not blocked. The requirement names only the 4 genuinely un-routed runs and explicitly excludes the utility segment.

**First break:** none — the chain is correct. The runs are genuinely unmeasured.

**Classification: `LEGITIMATE_FIELD_AUTHORITY_REQUIRED`.**
**Problem type:** Field input. **Policy consequence (reported, not changed):** because estimates are release-critical rather than informational, four field measurements are required before RG-5 can clear. That is a defensible policy; it is also the single largest remaining field burden on this project.

---

### 3.10 `TAP-CONDUCTOR-LENGTH-PENDING` — RG-5 · `FIELD_VERIFICATION` · blocking

- **Authority path:** `electrical.serviceTopology[svc-tap-conductors].constraints` · **Sheets:** PV-4B, E-1

**The brief's suspicion is disproven.** `DISCO_TO_METER_RUN` (15 ft estimate) is **not** being treated as the tap-conductor segment. The canonical edge that owns the tap length is a distinct object, `svc-tap-conductors`, with `lengthFt: null`, `lengthSource: 'unknown'`, and constraint `NEC-705.11(C)-TAP-10FT { limitFt: 10, state: 'pending' }`.

Live topology chain (export direction): `svc-combiner → svc-combiner-loadbreak → svc-rsd-initiator → svc-tap-conductors → svc-fused-ocpd → svc-tap-point → svc-meter → svc-service-disconnect`.

Supply-side connection record: `#6 AWG Cu`, NSI Polaris `IPLD350-3`, `tapConductorLengthFt: null`, `tapConductorLengthAuthority: "unknown"`, `verificationStatus: "unverified"`, 8 named unresolved facts, `candidateLabel: "CANDIDATE CONNECTOR — VERIFY EXISTING SERVICE CONDUCTOR AND LUG COMPATIBILITY"`.

**Classification: `LEGITIMATE_FIELD_AUTHORITY_REQUIRED`.** The length is not known, not derivable, and not stored elsewhere.

> **Separate confirmed defect (D10).** `svc-tap-conductors.description` reads *"Tap point → fused AC disconnect"* — the physically correct NEC span — but its graph edges are `upstreamObjectId: svc-rsd-initiator`, `downstreamObjectId: svc-fused-ocpd`, while `svc-fused-ocpd.downstreamObjectId = svc-tap-point`. The object is therefore wired on the **PV side** of the fused disconnect, not between the tap point and the disconnect. No wrong number is produced today (the length is null), but any future length derivation that walks the graph would attach it to the wrong span. Source: `lib/permit/snapshot/build.ts:798-813, 829-830`.

---

### 3.11 `DESIGNER-OF-RECORD-MISSING` — RG-7 · `ADMINISTRATIVE_HOLD` · blocking

- **Authority path:** `project.designer` · **Sheets:** PV-0, CERT · **Role:** admin

| Owner | Value |
|---|---|
| `personnel_roles` | **0 rows** (table exists, migration 115 applied) |
| `project_personnel_assignments` | **0 rows** |
| `projects.engineering_config.designer` | `""` |
| Snapshot `projectAuthority.designer` | `""` |
| Resolver `project-personnel-designer@v1` | reads the store, finds nothing, writes nothing |

**Every owner agrees.** No retrieval, projection or precedence defect. A write path exists (`app/api/admin/personnel/route.ts`, `upsertPersonnel`, `assignProjectPersonnel`).

**Classification: `LEGITIMATE_OPERATOR_DECISION_REQUIRED`** — an admin must name a real person and org scope.
**Problem type:** Operator decision, **currently blocked by the unrotated credential** (the write cannot be performed).

> **Release consequence, confirmed live:** `issuedForPermitGate` precondition `project-identity-valid` is `false`. V37 (`lib/permit/snapshot/validate.ts:735-749`) blocks a production/issued state while the designer is blank. Braidon is **not** "ready the moment a PE approves" — the designer must land first, and assigning one **moves the design digest** (it is project authority), so any approval must cover the post-designer digest.

---

### 3.12 `ENGINEERING-REVIEW-PENDING` — RG-7 · `PROFESSIONAL_RELEASE` · blocking

- **Authority path:** `certification.engineeringReviewApproved` · **Sheets:** CERT, PE-1

`engineering_review_records` = **0 rows globally** (table exists, migration 116 applied, full column set present including `snapshot_digest`, `reviewer_license`, `scope_statement`, `superseded_at`).

Live snapshot `certification` = `{ engineeringReviewApproved: false, engineer: null }`.

**Classification: `LEGITIMATE_LICENSED_AUTHORITY_REQUIRED`.**
**Problem type:** Licensed professional action.

---

## 4. AUTHORITY-DOMAIN MAPS

### 4.1 Project identity — **INTACT server-side, BROKEN client-side**

```
projects.name ("BRAIDON M PILLA — Solar")   [CANONICAL]
   ↓ permit/POST route.ts:581-600 (MCC §2 override)  ✔
project.projectName → snapshot.projectAuthority.projectName ✔ "BRAIDON M PILLA — Solar"
   ↓
cover / title blocks / release summary / CERT / document-control id  ✔
   ↓
GET  route.ts:327  safeProjectName = projectRow.name          ✔ canonical
POST route.ts:1671 safeProjectName = project.projectName      ✔ canonical (post-override)
   ↓
app/engineering/page.tsx:8188  a.download = `PermitPackage-${config.projectName}…`  ✘ STALE MIRROR
app/engineering/page.tsx:13309 a.download = `SLD-${config.projectName}.pdf`         ✘ STALE MIRROR
```

The browser's `a.download` **overrides** the server's correct `Content-Disposition`. The downloaded file is named `PermitPackage-BRAIDON M PILLA — Solar TEST.pdf` while the document inside is correctly identified.
`SOURCE-ONLY — RUNTIME UNVERIFIED` (needs a browser session to observe the saved filename).

**Competing owner still live in the database:** `projects.engineering_config.projectName = "BRAIDON M PILLA — Solar TEST"`. It does not round-trip; renaming the project never rewrites it.

### 4.2 Location / parcel / AHJ / code — **INTACT**

```
address "3 MELVIN DR APT A, GRANITE CITY, IL 62040"
   ↓ coordinateAuthority → lat 38.7061678 / lng -90.0461651
   ↓ locationAuthority → municipal boundary: NOT incorporated
   ↓ ahj match method "county-unincorporated"
codeAuthority.ahjRecordId = "il-madison-county"   ✔  ahjName "Madison County Building & Zoning"
codeAuthority.city        = "Unincorporated"      ✔  (LEGAL)
projectAuthority.city     = "GRANITE CITY"        ✔  (MAILING)
projectAuthority.parcelApn = "17-2-20-13-04-401-003"  ✔ authorityVerification.apn = "verified"
```

Mailing city and legal AHJ are correctly distinguished and do **not** contradict each other in the snapshot. The APN is bound despite `engineering_config.apn` being empty — it comes from the parcel authority, not the config mirror.

**Editions:** NEC 2020 (`ahj-national` static file), IBC/IRC/IFC `null` with explicit no-inference notes, ASCE `7-22`.

**Defect surfaced here:** the AHJ contradiction **does** persist inside the document registry — all four rows stamp `jurisdiction_boundary = "City of Granite City Building & Zoning"`. The snapshot is right; the archived evidence is stamped with the mailing-city AHJ.

### 4.3 Environmental — **INTACT (canonical values win)**

| Fact | Legacy owner (`engineering_config`) | Canonical owner | Snapshot value | Winner |
|---|---|---|---|---|
| Wind speed | `windSpeed: 115` | ASCE 7-22 700-yr MRI raster | **107.533 mph**, `windSpeedBasis: verified-source` | ✔ canonical |
| Ground snow | `groundSnowLoad: 20` | ASCE 7-22 dataset | **23.284 psf**, `snowLoadBasis: verified-source` | ✔ canonical |
| Exposure | `windExposure: C` | — | `C` | operator (no competing owner) |
| Mean roof height | `meanRoofHeight: 15` | — | `15 ft` | operator |
| Seismic | — | dataset `seismicSdc: "D"`, Ss 0.61, S1 0.18 | single owner | ✔ |

`sourceDocumentId: cedb14f7-917a-539b-a68a-f08f08b64d13` links the values to the archived registry row. **No duplicate seismic owner, no hardcoded fallback, no fixture value in production, no `Unknown` winning on truthiness.** RG-3 is CLEARED and the clearance is evidence-backed.

**Caveat (D5):** the document RG-3 clears on is **self-verified** — `jurisdictionResolvers.ts:711` writes `verificationState: 'verified'` with `reviewer: record.resolverId` and no human verifier (`verified_by: null` in the live row).

**Provenance inconsistency (D13):** the same snapshot reports the ASCE edition from two different sources — `codeAuthority.editions.asce.source = "structural-engine-basis"` vs `structural.env.codeAuthority.source = "ahj-record"`.

### 4.4 Personnel / professional review / digest — **INTACT (all refusals honest)**

`issuedForPermitGate` live preconditions:

| Precondition | Satisfied | Detail |
|---|---|---|
| `project-identity-valid` | ✘ | *"project name contains "TEST" or the designer/engineer-of-record is blank (§15d)"* |
| `blocking-validators` | ✘ | *"blocking snapshot violation(s) present"* ← **FALSE, see D2** |
| `equipment-identity` | ✔ | no conflict |
| `code-authority` | ✘ | unverified / incomplete |
| `manufacturer-documents` | ✘ | archival state not resolved |
| `structural-applicability` | ✘ | not established |
| `engineer-review-current-digest` | ✘ | no approved review covering the current digest |
| `signature-seal` | ✘ | not satisfied |

`decideReviewCoverage` (`lib/permit/snapshot/reviewCoverage.ts:131-195`) refuses on nine independent named grounds and fails closed on an unreadable store. `invalidationApplies` (`:98-128`) treats a null-digest ledger row as invalidating only approvals made **at or before** its timestamp — **not a permanent one-way latch**. ✔ repair holds.

### 4.5 Racking — see §8 (full calibration trace)

---

## 5. FIRST-BREAK TABLE

| # | Requirement | Gate | First stage where truth breaks | Classification |
|---|---|---|---|---|
| 1 | `CODE-AUTHORITY-INCOMPLETE` | RG-1 | *Nothing breaks* — canonical value absent at source | `AUTHORITY_GENUINELY_ABSENT` |
| 2 | `MODULE-EXACT-DATASHEET-PENDING` | RG-2 | **Snapshot** — two evaluators, opposite verdicts | `CONSUMER_WIRING_FAILURE` |
| 3 | `FRAMING-AUTHORITY-UNVERIFIED` | RG-4 | *Nothing breaks* | `LEGITIMATE_LICENSED_AUTHORITY_REQUIRED` |
| 4 | `PENDING-RACKING-ASSEMBLY-SELECTION` | RG-4 | **Persistence** — no field exists to hold the decision | `LEGITIMATE_OPERATOR_DECISION_REQUIRED` + `PERSISTENCE_FAILURE` |
| 5 | `FASTENER-ASSEMBLY-UNVERIFIED` | RG-4 | **Retrieval** — archived manual invisible (`unverified`) | `RETRIEVAL_FAILURE` |
| 6 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` | RG-4 | **Consumer** — hardcoded "not archived" vs 2 hashed rows | `CONSUMER_WIRING_FAILURE` |
| 7 | `RACKING-CAPACITY-APPLICABILITY-GAP` | RG-4 | **Consumer + Persistence** — hardcoded "KY" vs archived IL; rows stamped with mailing-city AHJ | `PROVENANCE_LOSS` + `PERSISTENCE_FAILURE` |
| 8 | `EQUIPMENT-DOCUMENT-APPLICABILITY` | RG-4 | **Consumer** — static asset beats registry document | `DOCUMENT_IDENTITY_MISMATCH` + `LEGACY_PRECEDENCE_FAILURE` |
| 9 | `ROUTE-LENGTH-ESTIMATE` | RG-5 | *Nothing breaks* | `LEGITIMATE_FIELD_AUTHORITY_REQUIRED` |
| 10 | `TAP-CONDUCTOR-LENGTH-PENDING` | RG-5 | *Nothing breaks* (graph mis-wiring is latent) | `LEGITIMATE_FIELD_AUTHORITY_REQUIRED` |
| 11 | `DESIGNER-OF-RECORD-MISSING` | RG-7 | *Nothing breaks* | `LEGITIMATE_OPERATOR_DECISION_REQUIRED` |
| 12 | `ENGINEERING-REVIEW-PENDING` | RG-7 | *Nothing breaks* | `LEGITIMATE_LICENSED_AUTHORITY_REQUIRED` |

**Shared root causes** (individual identity preserved per the brief):
- **Root A — document verification never happens.** #5, #6, #7, #8 all trace to three archived, hashed Roof Tech registry rows sitting at `verification_state: 'unverified'`. One verification act on the correct rows plausibly moves all four.
- **Root B — hardcoded racking-capacity literals.** #6, #7 share the same hardcoded block (`rackingAssembly.ts:388-445`).
- **Root C — no rail persistence.** #4 alone, but it also keeps `sourceCoversRail: false` in #7.

---

## 6. DUPLICATE-AUTHORITY INVENTORY

| Fact | Intended canonical owner | Competing owner(s) | Current precedence | Duplicate kind | Divergence risk | Recommended rule |
|---|---|---|---|---|---|---|
| Project name | `projects.name` | `projects.engineering_config.projectName` (**live value differs**) | Canonical wins server-side; **mirror wins in the browser download filename** | Stale legacy authority | **HIGH — realised today** | Never read the mirror; delete the field or make it a computed projection |
| AHJ id | `codeAuthority.ahjRecordId` (`il-madison-county`) | `engineering_config.ahjId = "il-icc"` | Canonical wins | Stale legacy authority | MEDIUM | Retire `engineering_config.ahjId` |
| NEC edition | `ahj_registry` (DB, migration 117) | `lib/jurisdictions/ahj-national.ts` (static, 4 029 records) | **Static file wins** (`provenance.ref = ahj-national:…`) | Independent catalog | MEDIUM | DB registry should win when a row exists; static is the fallback |
| ASCE edition | `codeAuthority.editions.asce` | `structural.env.codeAuthority` | Both present, **different `source` strings** | Renderer/projection copy | LOW | Single projection |
| Wind / snow | `environmentalLoadAuthority` (ASCE 7-22 doc) | `engineering_config.windSpeed/groundSnowLoad` | ✔ Canonical wins | Stale legacy authority | LOW (working) | Keep; retire the config fields |
| Exposure / roof height | `engineering_config` | — | Operator entry | — | LOW | Promote to authority record with provenance |
| Module datasheet | `manufacturer_document_registry` (hashed) | `manufacturer_assets` (**no hash column**) | **Asset wins; registry has no module row** | Independent catalog | **HIGH** | Registry is authority; asset becomes a render cache |
| Racking installation doc | `manufacturer_document_registry` | `manufacturer_assets.racking_detail:rooftech-mini` (**cites the wrong version**) | **Asset wins** | Stale legacy authority | **HIGH — realised today** | Registry wins when a row exists |
| Racking capacity source | `manufacturer_document_registry` (2 hashed PE letters) | Hardcoded literal in `rackingAssembly.ts:388-445` | **Hardcode wins** | Hardcoded fallback | **HIGH — realised today** | Registry wins; literal becomes an unavailable-state, not a claim |
| Rail identity | *(none exists)* | — | — | Missing owner | **HIGH** | Create the canonical slot |
| Route lengths | `electrical.routeSegments[].oneWayFt` | `engineering_config.wireLength = 60`, `trenchRunLengthFt`, `generatorWireLength` | ✔ Canonical wins | Stale legacy authority | LOW | Retire the config fields |
| Tap length | `serviceTopology[svc-tap-conductors].lengthFt` | `supplySideTapConnection.tapConductorLengthFt` | Both `null`, consistent | Compatibility projection | LOW | Single owner |
| Designer | `personnel_roles` / `project_personnel_assignments` | `engineering_config.designer`, `projectAuthority.designer` | All blank, consistent | Compatibility projection | LOW | Keep projection read-only |
| Review status | `engineering_review_records` | `certification.engineeringReviewApproved` | ✔ Projection of the record | Compatibility projection | LOW | Correct as-is |
| Release status | `deriveReleaseGateModel` | `permitReadiness.registry` | Registry feeds the gates | Cache | LOW | Correct as-is |
| Document verification | `verification_state` column | **two writer policies** (self-verify vs never-verify) | Depends on which resolver wrote the row | Independent calculation | **HIGH** | One policy for the whole table |

---

## 7. CONSUMER-CONSISTENCY MATRIX

`✔` = uses the canonical authority · `✘` = wrong/independent/hardcoded · `–` = not applicable

| Authority | Gate | Requirement registry | Calculation | BOM | Procurement | Schedule | Renderer |
|---|---|---|---|---|---|---|---|
| Project name | ✔ | ✔ | – | – | – | ✔ | ✔ server / **✘ browser filename** |
| AHJ + code editions | ✔ | ✔ | ✔ | – | – | – | ✔ |
| Environmental loads | ✔ | ✔ | ✔ | – | – | – | ✔ |
| Racking assembly (identity) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Racking **capacity source** | ✔ | ✔ | **✘ hardcoded** | – | – | – | **✘ hardcoded** |
| Racking installation doc | ✔ | ✔ | – | – | – | – | **✘ static asset** |
| Module datasheet | ✔ | **✘ contradicts `equipmentDocumentAuthority`** | – | ✔ | ✔ | ✔ | ✔ |
| Rail selection | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Route lengths | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Tap length | ✔ | ✔ | ✔ | – | – | ✔ | ✔ |
| Designer | ✔ | ✔ | – | – | – | – | ✔ |
| Review / digest | **✘ `blocking-validators` mislabelled** | ✔ | – | – | – | – | ✔ |

**Structural BOM is a model consumer.** `lib/permit/snapshot/structuralBom.ts:130-207` destructures the canonical `rackingAssembly` and reads it for every line — rails, splices, mounts, lag bolts, T-bolts, mid/end clamps. No independent reconstruction, no legacy read, no string parsing. `bomReconciliation.ok = true` across five object-vs-engine checks (mounts 64/64, fasteners 128/128, bonding 31/31, rails 16/16, splices 8/8). The PENDING state propagates correctly: `orderable: false`, `procurementClass: 'B'`, `skuDisplayAllowed: false`, `manufacturerDisplayAllowed: false`.

> **Design observation (not a live defect):** the PENDING banner sentence is used as the *value* of `partNumber`. A procurement export reading `partNumber` would emit `"PENDING RACKING ASSEMBLY SELECTION — rail/splice SKU not specified · NOT FOR PERMIT SUBMISSION"` as a part number. It is currently defended by `orderable: false`, but the field contract is a human sentence in a machine slot.

---

## 8. RACKING CALIBRATION TRACE

### Verdict

> **The canonical racking assembly is COMPLETE for identity and geometry, GENUINELY INCOMPLETE for the rail SKU, and COMPLETE-UPSTREAM-BUT-LOST-DOWNSTREAM for capacity and document authority.**

Three different answers for three different sub-domains. The assembly is **not** fragmented — `RackingAssemblyRecordExt` is a single, well-formed canonical record that every consumer reads.

### Canonical assembly (live)

| Field | Value |
|---|---|
| `assemblyId` | `assembly-rooftech-mini` |
| `mountManufacturer` / `mountModel` | Roof Tech / **RT-MINI** |
| `mountSku` | `null` |
| `railManufacturer` / `railModel` / `railSku` | `null` / **PENDING banner** / `null` |
| `splice` | **PENDING banner** |
| `midClamp` / `endClamp` | RT-MINI Mid Clamp / RT-MINI End Clamp |
| `lFootOrAdapter` / `tBoltFastener` | Roof Tech L-Foot / Rail T-bolt |
| `screwLagModel` | 5/16" (8 mm/M8) structural wood screw ~3.5" (90 mm), 2/pad, no pilot hole |
| `groundingBonding` | RT-MINI Bond Clip |
| `architectureType` | `rail-paired` · `mixedManufacturer: true` · `assemblySupported: true` |
| `attachmentMode` / `fastenersPerMount` / `attachmentSpacingSourceIn` | rafter / 2 / 48" |
| `publishedCapacityAllowableLbs` / `capacityBasis` | **600** / `allowable` |
| `capacitySource` | **`"Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023"`** ← contradicted by the record's own notes |
| `iccEsReport` / `ul2703ListingBasis` / `datasheetSource` | all `ICC-ES ESR-3575` |
| `fastenerElementsComplete` | `true` |
| `provenance` | `mounting-hardware-db` / `rooftech-mini` |

### Producer

`buildRackingAssembly(system: MountingSystemSpec, opts?)` — `lib/permit/snapshot/rackingAssembly.ts:300`.
Pure and deterministic. Composes **one** `mounting-hardware-db` record (`rooftech-mini`) plus an **optional** verified capacity document. It does **not** compose multiple catalog records. It consumes the `rackingAssemblySelection` resolver's verdict only indirectly (the verdict rides on the snapshot; the record's `railModel` is set from `system.rail`, which is absent).

### Persistence

| What | Where | State |
|---|---|---|
| Mount selection | `projects.engineering_config.mountingId = "rooftech-mini"` | ✔ persisted |
| Rail selection | **nowhere** | ✘ no field on `PermitInput.project`, none in `projects.selected_equipment`, none on the mount record |
| Capacity document | `manufacturer_document_registry` × 2 (archived, hashed) | ✔ persisted, **`unverified`** |
| Installation document | `manufacturer_document_registry` × 1 (archived, hashed) | ✔ persisted, **`unverified`** |
| Free-text fields in use | `hardware.railSplice` compatibility statement | prose, correctly used only for screening |

The resolver produces a **shortlist with no persisted selection**, and **no real API/UI write path exists** for a rail.

### Snapshot

The assembly is frozen **once** in `build.ts:2504` (`structural.rackingAssembly`) and re-referenced (not rebuilt) at `:1080`, `:1137`, `:2075`, `:2517`. Authority IDs survive. `capacityProvenance` and `structuralAuthorityGaps` ride along and are digest-relevant. No field is dropped, renamed or overwritten by defaults.

### Consumers

| Consumer | File | Reads | Canonical? | Independent rebuild? | Legacy read? | Fallback? |
|---|---|---|---|---|---|---|
| Structural calculations | `structuralEngine.ts` | `publishedCapacityAllowableLbs` | ✔ | ✘ | ✘ | ✘ |
| Structural details | `structuralProjection.ts` | full record | ✔ | ✘ | ✘ | ✘ |
| Bonding | `rackingBonding.ts:58` | `assembly` | ✔ | ✘ | ✘ | ✘ |
| BOM | `structuralBom.ts:130-207` | full record | ✔ | ✘ | ✘ | ✘ |
| Procurement | `procurementSufficiency.ts` | `orderable`/`procurementClass` | ✔ | ✘ | ✘ | ✘ |
| Equipment schedules | `electricalPages.ts:1471` | `_snap.structural.rackingAssembly` | ✔ | ✘ | ✘ | ✘ |
| Compliance pages | `compliancePages.ts:1153` | `_spSpec.rackingAssembly` | ✔ | ✘ | ✘ | ✘ |
| Datasheet appendix | `datasheetAppendix.ts:43` | `rackingAssembly?.railSku` | ✔ | ✘ | ✘ | ✘ |
| RS-1 | `reviewStatus.ts:148` | `structuralAuthorityGaps` | ✔ | ✘ | ✘ | ✘ |
| Release gates | `releaseGates.ts` | registry codes | ✔ | ✘ | ✘ | ✘ |
| **Capacity provenance** | `rackingAssembly.ts:388-445` | **hardcoded literal** | **✘** | — | — | **✘ YES** |

**Every consumer of the assembly record is correctly wired.** The single failure is inside the producer: the capacity-provenance block asserts hardcoded values instead of the registry.

### Document identity

| Document | Registry id | Archived | SHA-256 | Verification | Reaches the consumer? |
|---|---|---|---|---|---|
| RT-MINI installation manual (Jan 2021) | `doc-rooftech-rtmini-install-manual-2f6035586e94` | ✔ | `2f6035586e94…` | **unverified** | **✘** |
| RT-MINI **II** installation manual (Jun 2025) | *(none — static asset only)* | asset | none | `verified: true` (asset flag) | **✔ — and it is the WRONG version** |
| RT-MINI II PE letter, ASCE 7-10 (**IL**) | `doc-rooftech-rtmini2-pe-letter-3b9a2a9588d2` | ✔ | `3b9a2a9588d2…` | **unverified** | **✘** |
| RT-MINI II PE letter, ASCE 7-16 (**IL**) | `doc-rooftech-rtmini2-pe-letter-73a74973091c` | ✔ | `73a74973091c…` | **unverified** | **✘** |
| ICC-ES ESR-3575 | *(referenced by label only)* | ✘ | none | — | **✔ — cited as `capacitySource` despite carrying no structural authority** |

- Correct document retrieved? **No.**
- Correct identity reaches the snapshot? **No.**
- Archive/hash facts applied to the same document? **No** — the hardcoded block claims `documentHash: null` for documents that have hashes.
- Static asset overrides the resolver-selected document? **Yes.**
- Fastener verifier receives the installation authority? **No.**
- Capacity evaluator receives the structural capacity authority? **No.**
- Product/version applicability preserved? **Partially** — the registry records it correctly (`RT-MINI` vs `RT-MINI II`); the consumer never reads it.

---

## 9. DOCUMENT-IDENTITY TRACE

| Layer | Module (Q CELLS) | Racking install | Racking capacity | Climate hazard |
|---|---|---|---|---|
| Static asset | `module_spec:qcells-peak-duo-400`, 385–405 W family, **no hash** | `racking_detail:rooftech-mini` → **RT-MINI II** manual | — | — |
| Registry row | **none** | `…rtmini-install-manual-2f60…` (RT-MINI) | 2 PE letters (IL) | `cedb14f7-…` |
| Archived / hashed | asset only, no hash | ✔ `2f6035586e94…` | ✔ `3b9a…` / `73a7…` | ✔ `cedb14f7917a…` |
| `verification_state` | n/a | **unverified** | **unverified** | **verified** (self, `verified_by: null`) |
| `jurisdiction_boundary` | n/a | *City of Granite City* ✘ | *City of Granite City* ✘ | *City of Granite City* ✘ |
| Resolver result | APPLICABLE (asset) | PENDING_APPLICABILITY | not cleared | cleared |
| Consumed by | DS-1, BOM, schedules | equipmentDocumentAuthority | hardcoded literal | `environmentalLoadAuthority` |

**The single most consequential row-level fact:** every archived document in this system is stamped with the **mailing-city** AHJ, while the canonical legal AHJ is Madison County. Any clearance evaluator that compares document jurisdiction to project jurisdiction will fail — even after an operator verifies the documents.

---

## 10. DIGEST AND REVIEW VERIFICATION — PRESERVED REPAIRS

| # | Repair | Current file · function | Regression test | Runtime path satisfies? |
|---|---|---|---|---|
| 1 | `engineerReviewCoversCurrentDigest` not hardcoded false | `build.ts:2739` ← `_decision.covers` (`:2218` is a default on the no-review path) | `prr-release-reachability` | ✔ **holds** |
| 2 | `signatureSealSatisfied` not hardcoded false | `build.ts:2740` ← `_decision.signatureSealSatisfied` | same | ✔ **holds** |
| 3 | Current digest supplied to project authority | `build.ts:2734` `currentDigest: digest` | same | ✔ **holds** |
| 4 | Approval does not change the digest it approves | `build.ts:2733` `review: _decision.covers ? { reviewedDigest: digest } : null` — two-pass build | `prr-release-reachability` | ✔ **holds** |
| 5 | Design-affecting changes invalidate approval | `reviewCoverage.ts:168-175` digest mismatch → refuse | `prr-release-reachability` | ✔ **holds** |
| 6 | No-op regeneration preserves approval | digest stability (below) | `la-*` determinism | ✔ **PROVEN LIVE** |
| 7 | Invalidation ledger not a one-way latch | `reviewCoverage.ts:115-125` — null-digest rows invalidate only approvals at/before `invalidated_at` | `mcc-*` | ✔ **holds** |
| 8 | Approved package doesn't violate pending-review language | `generatePermit.ts:1658-1716` (V13, state-conditional) | V13 tests | ✔ **holds** |
| 9 | Engineer-of-Record identity renders when approved | V13 licence-number check | V13 tests | ✔ **holds** |
| 10 | A controlled project can reach ISSUED FOR PERMIT | `evaluateIssuedForPermitGate` two-pass | `prr-release-reachability` | ✔ **holds** |
| 11 | Resolver clearance not overwritten by hardcoded `resolved: false` | `build.ts:1864` `resolved: _resState?.cleared === true && !!_resState?.resolutionAuditRef?.trim()` | `mcc-*` | ✔ **holds** |
| 12 | Audit refs don't introduce wall-clock digest nondeterminism | `digest.ts` projection excludes run instants | `la-*` | ✔ **PROVEN LIVE** |
| 13 | Real registry construction tested | `aac-ws1-resolver-lifecycle`, `aac-ws8-ws9-structural-lifecycle` | — | ⚠ **only 2 of 275 test files** |
| 14 | Permit generation uses canonical `projects.name` | `permit/route.ts:581-600` | `la-canonical-name-route` | ✔ **holds (server)**; ✘ browser filename |
| 15 | Stale `engineering_config.projectName` doesn't override | same | same | ✔ **holds** |
| 16 | APN provenance preserved | `projectAuthority.parcelApn` + `authorityVerification.apn` | — | ✔ **holds** |
| 17 | Mailing city ≠ legal AHJ no longer contradict | `codeAuthority.city` vs `projectAuthority.city` | `aac-ws3-ws4` | ✔ **holds in the snapshot**; ✘ **still contradicts in the document registry** |
| 18 | Braidon resolves to Madison County | `ahjMatchMethod: "county-unincorporated"` | `aac-ws3-ws4` | ✔ **holds** |
| 19 | Missing `organization_members` doesn't block `users.org_id` fallback | `lib/personnel/store.ts` | `la-field-measurement-reachability` | ✔ holds (`SOURCE-ONLY` — table absent, fallback not exercised) |
| 20 | Field-measurement read/write not preempted | `lib/fieldMeasurement/*` | `la-field-measurement-reachability` | ✔ holds (`SOURCE-ONLY` — 0 rows) |
| 21 | Resolver attempt timestamps remain as audit data | 31 run-instants present in the snapshot | `la-*` | ✔ **PROVEN LIVE** |
| 22 | …but excluded from the signed projection | digest stable while 28 of them move | `la-*` | ✔ **PROVEN LIVE** |
| 23 | Material document identities/hashes remain digest-relevant | `capacityProvenance` in the record | `p13-ws4-racking-assembly` | ✔ holds |
| 24 | Repeated unchanged live regeneration → stable digest | below | `la-*` | ✔ **PROVEN LIVE** |
| 25 | Issued-package GET is read-only | `permit/route.ts:272+`, `lib/db/readOnlySql.ts` | `issued-package-read-immutability` | ✔ **holds** |

### Live determinism proof (two full passes, 3 s apart, real resolver lifecycle each time)

```
A digest = 78b1a50c4565c245de256c48ff1903eab01dba40410a666ec21054835e1adbf8
B digest = 78b1a50c4565c245de256c48ff1903eab01dba40410a666ec21054835e1adbf8
DIGEST STABLE            = true      ✔
run-instants in authority: A=87 B=87 | differing = 86   (they genuinely still move)
run-instants in snapshot : A=31 B=31 | MOVED     = 28
snapshot leaf diffs      = 28  (all …payload.lastResolutionAttempt / resolutionEvidence[].atIso)
HTML byte-identical      = FALSE
HTML differing lines     = 9 of 5201  (all RS-1 requirement rows)
```

**The digest repair is proven live.** The digest is stable *because* the projection excludes the instants, not because the instants stopped moving.

**But the artifact is not byte-stable (D9).** RS-1 renders `lastResolutionAttempt` / `resolutionEvidence[].atIso` directly, so two regenerations of an identical design produce different HTML. This violates the standing rule that no sub-second instant belongs in the artifact. Consequence: an issued package's stored bytes can never be byte-compared against a regeneration, even when the design is provably unchanged.

**No regressions found in any of the 25 preserved repairs.**

---

## 11. HIDDEN BLOCKER INVENTORY

The real validator was run over the live Braidon snapshot:

```
validatePermitDesignSnapshot(snap) → total violations = 0 (blocking 0, deferred 0)
validations with NO ledger entry   = 0
```

**No authority-domain blocker is hidden from the ledger.** `validate.ts:544` explicitly enforces this: a blocking racking-capacity gap not surfaced as a permit-readiness blocker is itself a violation.

However, **seven generation-blocking invariants throw from `generatePermitHTML` and are not part of `validatePermitDesignSnapshot`, therefore have no requirement-ledger representation:**

| Invariant | Site | What it blocks |
|---|---|---|
| V36 | `generatePermit.ts:1578` | dangling cross-sheet reference to an omitted sheet |
| V12 | `:1595` | a sheet missing the snapshot stamp |
| V47 | `:1658` | sheets displaying conflicting state code / state name |
| V13 | `:1716` | certification sheet contradicting the approval state |
| V29 | `:1732` | a rendered `data-object-id` with no canonical snapshot object |
| V30/V31 | `:1764` | render-parity: canonical object omitted / placement delta |

All seven pass for Braidon today (generation succeeded). They are **render-integrity QA**, not operator-resolvable authority gaps, so their absence from the ledger is defensible — but they *are* release-blocking and belong in this inventory. **None is incorrectly release-blocking; none is a hidden authority gap.**

---

## 12. TEST-GAP INVENTORY

| Metric | Count |
|---|---|
| Test files total | 275 |
| Files exercising the real `generatePermitHTML` | 89 |
| Files exercising the real `resolveSnapshotAuthorityInputs` (resolver lifecycle) | **2** |
| Files exercising the real permit route handler | **7** |
| Files containing `resolved: true` object literals | 8 |

**The resolver lifecycle — the producer of every authority in this system — is exercised end to end by 2 of 275 test files** (`tests/planset/aac-ws1-resolver-lifecycle.test.ts`, `tests/planset/aac-ws8-ws9-structural-lifecycle.test.ts`).

### Tests that can pass while production is broken

| Gap | Why it hides defects | Missing regression level |
|---|---|---|
| `manufacturer_document_registry` ↔ `buildRackingAssembly` seam | No test asserts that an **archived, hashed, verified** registry row actually replaces the hardcoded `documentHash: null` block. All racking tests supply `capacityDocument` as a literal or omit it. | **Integration** over a seeded registry, asserting the hardcoded literal never renders when a matching verified row exists |
| Static-asset vs registry precedence | No test asserts the registry wins over `manufacturer_assets` for the same equipment | **Integration**, both sources populated with conflicting versions |
| Document `jurisdiction_boundary` | No test asserts a document written by `structuralResolvers` carries the **legal AHJ**, not the mailing city | **Service-level**, resolver → registry row |
| `equipmentDocumentAuthority` vs `equipmentProjection` | No test asserts the two evaluators agree about the same document | **Unit** cross-check over one asset |
| `blocking-validators` gate precondition | No test asserts the precondition matches `validatePermitDesignSnapshot`'s actual output | **Unit** over `deriveIssuedForPermitGate` |
| Artifact byte-stability | 89 tests render HTML; none asserts two renders of the same design are byte-identical | **Integration**, two renders, byte compare |
| Download filename | 7 route tests check `Content-Disposition`; **zero** cover the client-side `a.download` override | **E2E** (Playwright) on the real download |
| Rail persistence | Tests assert the *shortlist*; none asserts a selection can be **stored and read back** | **Integration** once a slot exists |
| Digest-scoped invalidation | The `row.digest` branch of `invalidationApplies` is covered by literals only; **all 22 live rows have `digest: NULL`**, so the branch is dead in production | **Integration** over a real reconciliation write |

### `resolved: true` literals

Present in 8 files. These are **legitimate** where they construct a *cleared* fixture to test downstream aggregation. The defect class the brief warns about — a hand-built object bypassing the resolver — is real here only in that **no test builds the registry through `resolveSnapshotAuthorityInputs` and then asserts the `resolved` flag**, except in the 2 lifecycle files.

---

## 13. GENUINE EXTERNAL-AUTHORITY INVENTORY

Requirements that **no code change can close**:

| Requirement | Needs | Who |
|---|---|---|
| `CODE-AUTHORITY-INCOMPLETE` | **Government/AHJ evidence** — archived Madison County adoption ordinance for IBC/IRC/IFC (or an `AHJ_REGISTRY_TOKEN` to query SunSpec) | Operator + AHJ |
| `ROUTE-LENGTH-ESTIMATE` | **Field evidence** — 4 measured lengths: `ROOF_RUN`, `BRANCH_HOMERUN_RUN`, `COMBINER_TO_DISCO_RUN`, `DISCO_TO_METER_RUN` | Field crew |
| `TAP-CONDUCTOR-LENGTH-PENDING` | **Field evidence** — tap-conductor run, confirm ≤ 10 ft (NEC 705.11(C)) | Field crew |
| `DESIGNER-OF-RECORD-MISSING` | **Operator selection** — name a real designer + org scope | Admin |
| `PENDING-RACKING-ASSEMBLY-SELECTION` | **Operator selection** — choose among XR100 / XR1000 / SME / SolarMount, **plus a distributor SKU** (the catalog has no rail part number) | Designer |
| `FRAMING-AUTHORITY-UNVERIFIED` | **Licensed professional action** — project-specific structural review, or an archived truss design drawing / manufacturer capacity calculation | PE |
| `ENGINEERING-REVIEW-PENDING` | **Licensed professional action** — approval bound to the current digest, with name, licence number, licence state and a scope statement | PE |
| Document verification (×3 Roof Tech rows) | **Operator selection** — a registry act promoting archived rows to `verified` | Admin/registrar |

**Nine of twelve requirements are genuine.** Only #2 (module) and #5–#8 (racking documents) carry a software component, and even those have an external act underneath.

---

## 14. CONFIRMED SOFTWARE DEFECT INVENTORY

### D1 — Download filename uses the stale project-name mirror
- **Domain:** project identity
- **File / function:** `app/engineering/page.tsx:8188` (permit) and `:13309` (SLD) — `a.download = \`PermitPackage-${config.projectName …}\``
- **Broken handoff:** canonical `projects.name` → browser download filename
- **Downstream impact:** the saved file is named `…— Solar TEST.pdf`; the server's correct `Content-Disposition` is discarded by `a.download`
- **Requirements affected:** none directly (identity gate passes on the designer, not the name)
- **Correct owner:** `projects.name`
- **Repair boundary:** client download handler only. Do not touch the route.
- `SOURCE-ONLY — RUNTIME UNVERIFIED`

### D2 — `blocking-validators` gate precondition reports a falsehood
- **Domain:** release gate
- **File / function:** `lib/permit/snapshot/build.ts:2737-2738` — `blockingValidatorsPass: _permitReadiness.blockers.filter(b => classifyBlockerDomain(b.code) !== 'review').length === 0`
- **Broken handoff:** `validatePermitDesignSnapshot` → `issuedForPermitGate`
- **Downstream impact:** the gate renders *"blocking snapshot violation(s) present"* while the real validator returns **0**. It restates the requirement registry under a name that means something else, duplicating what `code-authority`, `structural-applicability` and `manufacturer-documents` already report. Because `generatePermit.ts:1289-1295` throws on real violations, this precondition can *never* mean what its label says.
- **Requirements affected:** none (fails closed today)
- **Correct owner:** `blockingViolations(validatePermitDesignSnapshot(snap))`
- **Repair boundary:** either rename the precondition to what it measures, or wire it to the validator. One line + label.

### D3 — Hardcoded racking capacity provenance contradicts persistence
- **Domain:** racking / document authority
- **File / function:** `lib/permit/snapshot/rackingAssembly.ts:388-445` (`buildRackingAssembly`, RT-MINI branch)
- **Broken handoff:** `manufacturer_document_registry` → `capacityProvenance.sourceDocument`
- **Downstream impact:** asserts `documentHash: null`, `archivedInRepo: false`, and *"no PDF/datasheet file exists in this repository"* while two archived, SHA-256'd PE letters exist. Printed on PV-4C, PV-3, PE-1, CERT.
- **Requirements affected:** `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP`
- **Correct owner:** `manufacturer_document_registry`
- **Repair boundary:** the fallback must describe an *unavailable* state, never assert a negative fact about persistence.

### D4 — Documents stamped with the mailing-city AHJ, not the legal AHJ
- **Domain:** document authority / jurisdiction
- **File / function:** `lib/permit/snapshot/resolution/structuralResolvers.ts:245` — `jurisdictionBoundary: ctx.authority.projectJurisdiction ?? …`; same pattern in `jurisdictionResolvers.ts`
- **Broken handoff:** `codeAuthority.ahjName` (Madison County) → `manufacturer_document_registry.jurisdiction_boundary` (City of Granite City)
- **Downstream impact:** **all four live rows are mis-stamped.** `evaluateRackingCapacityClearance` (`rackingAssembly.ts:217`) compares document jurisdiction to project jurisdiction, so verifying these documents **would still fail**. This is a latent trap that will consume an operator's verification act and produce no clearance.
- **Requirements affected:** `RACKING-CAPACITY-APPLICABILITY-GAP` (and blocks the fix for #5, #6, #8)
- **Correct owner:** `codeAuthority.ahjName` / `ahjRecordId`
- **Repair boundary:** the resolver's jurisdiction source + a data correction for the four existing rows (**requires a write — blocked on rotation**)

### D5 — Two contradictory document-verification regimes
- **Domain:** document authority
- **Files:** `jurisdictionResolvers.ts:711` writes `verificationState: 'verified'`, `reviewer: record.resolverId`; `structuralResolvers.ts:251` writes `verificationState: 'unverified'` with the comment *"Retrieval establishes existence + bytes, never applicability."*
- **Downstream impact:** RG-3 clears on a **self-verified** document with `verified_by: null`; RG-4 stays open because the structural resolver honestly refuses to self-verify. `createDocument` (`registry.ts:121`) only requires `archivedInRepo && sha256` for `'verified'` — no human verifier is enforced.
- **Requirements affected:** RG-3 clearance integrity; #5, #6, #7, #8 remain open
- **Correct owner:** one policy for the `verification_state` column
- **Repair boundary:** policy decision + whichever resolver changes. **This is the highest-leverage single decision in the audit.**

### D6 — `capacitySource` names a document its own record disqualifies
- **Domain:** racking
- **File:** `lib/permit/snapshot/rackingAssembly.ts` (record assembly)
- **Impact:** `capacitySource = "Roof Tech RT-MINI ICC-ES ESR-3575 Rev 2023"`, `iccEsReport`/`ul2703ListingBasis`/`datasheetSource` all `ESR-3575`, while `notes[]` on the same record states ESR-3575 *"carries no structural value"* and `FASTENER-ASSEMBLY-UNVERIFIED` fires for exactly that reason. Any consumer reading the structured field (rather than parsing prose) cites a disqualified document.
- **Requirements affected:** `FASTENER-ASSEMBLY-UNVERIFIED`
- **Repair boundary:** field semantics — split *listing basis* from *capacity source*.

### D7 — Static asset overrides the registry document
- **Domain:** document authority
- **File:** `equipmentDocumentAuthority` construction in `lib/permit/snapshot/build.ts` / `documentAuthority.ts`
- **Impact:** `racking_detail:rooftech-mini` (static, cites **RT-MINI II**) wins over `doc-rooftech-rtmini-install-manual-2f60…` (registry, correct **RT-MINI**, archived + hashed)
- **Requirements affected:** `EQUIPMENT-DOCUMENT-APPLICABILITY`, `FASTENER-ASSEMBLY-UNVERIFIED`
- **Repair boundary:** precedence rule — registry wins when a row exists; asset becomes a render cache.

### D8 — Module datasheet: two evaluators, opposite verdicts
- **Domain:** equipment document
- **Files:** `equipmentDocumentAuthority` (→ `APPLICABLE`, `applicabilityVerified: true`) vs `equipmentProjection` (→ `MODULE-EXACT-DATASHEET-PENDING`)
- **Impact:** the same frozen snapshot presents the module datasheet as both verified-applicable and pending. `registryFactsPresent: false` — the applicability decision rests on a hash-less asset. `allBound` can be vacuously true.
- **Requirements affected:** `MODULE-EXACT-DATASHEET-PENDING`
- **Repair boundary:** one applicability evaluator; add an explicit model-family applicability claim with page/column evidence.

### D9 — Rendered artifact is not byte-stable
- **Domain:** artifact identity
- **File:** `lib/permit/sections/reviewStatus.ts` (RS-1 renders `lastResolutionAttempt` / `resolutionEvidence[].atIso`)
- **Impact:** 9 differing lines per regeneration; the digest is stable but the bytes are not. An issued package can never be byte-verified against a re-render.
- **Requirements affected:** none directly
- **Repair boundary:** RS-1 rendering only — the digest exclusion is already correct.

### D10 — `svc-tap-conductors` graph edges contradict its own description
- **Domain:** electrical topology
- **File:** `lib/permit/snapshot/build.ts:798-813` (and `:829-830`)
- **Impact:** described as *"Tap point → fused AC disconnect"*, wired as `rsd-initiator → tap-conductors → fused-ocpd → tap-point`. The object owning the ≤ 10 ft constraint is not the edge between the two endpoints it names. Latent: no wrong number today (length null).
- **Requirements affected:** `TAP-CONDUCTOR-LENGTH-PENDING` (future derivation)
- **Repair boundary:** topology edges only. **Digest-affecting.**

### D11 — Invalidation ledger records no digest
- **Domain:** review / digest
- **File:** `lib/fieldMeasurement/production.ts:37` hardcodes `digest = null, snapshot_id = null`; `lib/reconciliation/reconcile.ts:291` passes through whatever the record holds (null in practice)
- **Impact:** **all 22 live Braidon rows have `digest: NULL` and `snapshot_id: NULL`.** The digest-scoped branch of `invalidationApplies` (`reviewCoverage.ts:108`) is dead in production; the ledger works only as a timestamp watermark. `superseded_at` is never consulted. Fails closed, so no unsafe behaviour — but no per-digest granularity is possible.
- **Requirements affected:** none today
- **Repair boundary:** the writers.

### D12 — No persistence slot for a rail selection
- **Domain:** racking
- **Files:** `PermitInput.project` type; `SelectedEquipment` contract; `projects.selected_equipment`
- **Impact:** an operator cannot record a rail decision. Confirmed by the resolver's own three probes, all `present: false`.
- **Requirements affected:** `PENDING-RACKING-ASSEMBLY-SELECTION` (permanently unresolvable without this)
- **Repair boundary:** schema + write path + UI. **Digest-affecting.**

### D13 — ASCE edition reports two different provenances
- **Domain:** code authority
- **Impact:** `codeAuthority.editions.asce.source = "structural-engine-basis"` vs `structural.env.codeAuthority.source = "ahj-record"` in the same snapshot.
- **Repair boundary:** single projection.

### D14 — `…Iso` fields hold locale date strings
- **Domain:** provenance formatting
- **Impact:** `meta.generatedAtIso = "8/5/2026"`, `registry[].createdAtIso = "8/5/2026"`. The name promises ISO-8601; the value is a US locale date. It is **date-only and jurisdiction-zone**, which is *correct* for digest determinism — but the field name misrepresents the format and invites a consumer to `Date.parse` it.
- **Repair boundary:** naming only. Do **not** change the value — it is load-bearing for digest stability.

---

## 15. DEPENDENCY GRAPH FOR IMPLEMENTATION

Ordered so that no repair invalidates a downstream authority or a PE-reviewed digest already established by an earlier one.

```
  [0]  ROTATE THE NEON CREDENTIAL                                  ← blocks every write below
        │
        ├─► [1] D5  decide ONE document-verification policy         (policy; no digest impact)
        │        │
        │        └─► [2] D4  jurisdiction stamping + correct 4 rows (DATA WRITE)
        │                 │
        │                 └─► [3] D3 + D6 + D7  registry beats hardcode & static asset
        │                          │            (digest-affecting: capacityProvenance changes)
        │                          │
        │                          └─► [4] verify the 3 Roof Tech rows (OPERATOR ACT)
        │                                   → plausibly closes #5, #6, #7, #8
        │
        ├─► [5] D12 rail persistence slot   (digest-affecting: railSku enters the record)
        │        └─► [6] operator selects a rail → closes #4, improves #7 sourceCoversRail
        │
        ├─► [7] D8  single module-applicability evaluator (digest-affecting)
        │
        └─► [8] DESIGNER assignment (OPERATOR ACT)  ← moves the digest; must precede any PE approval
                 └─► [9] FIELD MEASUREMENTS ×5      ← moves the digest
                          └─► [10] PE REVIEW bound to the FINAL digest   ← must be last
```

**Independent of the above (no digest impact, may be done any time):**
`D1` filename · `D2` gate label · `D9` RS-1 byte-stability · `D11` ledger digest · `D13` ASCE provenance · `D14` field naming

**Critical ordering rule:** every digest-affecting repair (`[3]`, `[5]`, `[7]`, `[8]`, `[9]`) must land **before** the PE review. A PE approval taken today would be invalidated by any of them.

---

## 16. PROPOSED IMPLEMENTATION WORKSTREAMS

### WS-1 · Document verification policy (unblocks the whole racking cluster)
- **Target:** one policy for `manufacturer_document_registry.verification_state`
- **Files:** `lib/documents/registry.ts` (`createDocument`, `setVerification`), `resolution/jurisdictionResolvers.ts:711`, `resolution/structuralResolvers.ts:251`
- **Authority preserved:** the registry as sole document authority
- **Consumers to rewire:** none (policy only)
- **Regression tests:** service-level — a resolver-created document may never be `verified` without a named verifier; `createDocument` rejects `verified` with a null `verified_by`
- **Live Braidon proof:** RG-3's clearance must survive (or be re-established through a legitimate verification)
- **Requirements affected:** none directly; unblocks #5–#8

### WS-2 · Jurisdiction stamping (**requires rotation**)
- **Target:** documents stamped with the legal AHJ
- **Files:** `structuralResolvers.ts:245`, `jurisdictionResolvers.ts`; data correction for 4 rows
- **Authority preserved:** `codeAuthority.ahjRecordId` / `ahjName`
- **Consumers to rewire:** `evaluateRackingCapacityClearance` jurisdiction comparison
- **Regression tests:** service-level, resolver → row, asserting Madison County (not Granite City) for an unincorporated address
- **Live proof:** the four live rows read back with the correct AHJ
- **Requirements affected:** `RACKING-CAPACITY-APPLICABILITY-GAP`

### WS-3 · Registry beats hardcode and static asset
- **Target:** remove the hardcoded capacity-provenance literal; make the registry win over `manufacturer_assets`
- **Files:** `rackingAssembly.ts:388-445`, `equipmentDocumentAuthority` construction in `build.ts` / `documentAuthority.ts`, `structuralBom.ts` (no change expected)
- **Authority preserved:** `RackingAssemblyRecordExt` (unchanged shape), `manufacturer_document_registry`
- **Consumers to rewire:** capacity provenance, fastener verifier, installation-document identity
- **Regression tests:** **integration over a seeded registry** — the hardcoded literal must never render when a matching verified row exists; the registry document must beat a conflicting static asset
- **Live proof:** PV-4C / PE-1 cite the archived IL PE letter with its SHA-256, and the RT-MINI (not II) manual
- **Requirements affected:** #5, #6, #7, #8 · **digest-affecting**

### WS-4 · Rail selection persistence
- **Target:** a canonical slot for a rail selection + a real write path
- **Files:** `PermitInput.project` type, `SelectedEquipment` contract, `projects.selected_equipment`, an application service, the picker UI, `railSelection.ts` probes
- **Authority preserved:** `railSelection` verdict shape (already correct)
- **Consumers to rewire:** none — every consumer already reads `rackingAssembly.railSku` / `railModel`
- **Regression tests:** integration — a selection is stored, read back, and reaches the BOM `partNumber` as an orderable SKU
- **Live proof:** the three probes report `present: true` for the chosen path
- **Requirements affected:** #4 · **digest-affecting**

### WS-5 · Single module-applicability evaluator
- **Target:** one verdict for the module datasheet; explicit family-range applicability with page/column evidence
- **Files:** `equipmentProjection.ts`, `documentAuthority.ts`, `resolution/datasheetBinding.ts`
- **Authority preserved:** `moduleDatasheetBinding`
- **Consumers to rewire:** DS-1, BOM, equipment schedule, `allBound`
- **Regression tests:** unit cross-check — the two evaluators must agree; `allBound` must be false when `registryFactsPresent` is false
- **Live proof:** the snapshot no longer reports `APPLICABLE` and `PENDING` for the same document
- **Requirements affected:** #2 · **digest-affecting**

### WS-6 · Non-digest correctness sweep
- **Target:** D1, D2, D9, D11, D13, D14
- **Files:** `app/engineering/page.tsx:8188,13309`; `build.ts:2737`; `sections/reviewStatus.ts`; `fieldMeasurement/production.ts:37`; ASCE projection; `…Iso` field names
- **Authority preserved:** all — none of these changes the digest
- **Regression tests:** E2E on the download filename; unit on the gate precondition; **integration asserting two renders of one design are byte-identical**
- **Live proof:** two live regenerations produce byte-identical HTML
- **Requirements affected:** none — correctness and diagnosability only

### WS-7 · Topology edge correction
- **Target:** D10 — wire `svc-tap-conductors` between `svc-tap-point` and `svc-fused-ocpd`
- **Files:** `build.ts:798-813, 829-830`
- **Regression tests:** unit on the service-topology graph; assert the constraint-owning edge spans the two objects its description names
- **Requirements affected:** none today · **digest-affecting**

### WS-8 · External-authority closure (not software)
Designer assignment · 5 field measurements · AHJ adoption ordinance or `AHJ_REGISTRY_TOKEN` · rail selection + distributor SKU · document verification acts · PE review bound to the final digest.

---

## 17. STOP/GO RECOMMENDATION

## `PARTIAL GO — SPECIFIC DOMAINS PROVEN, OTHERS REQUIRE MORE RUNTIME EVIDENCE`

**GO — proven, ready for an implementation prompt now:**
- WS-1 document verification policy (D5) — both writers read, both policies quoted
- WS-3 registry beats hardcode/static asset (D3, D6, D7) — hardcoded literals located to the line; contradicting registry rows dumped with hashes
- WS-4 rail persistence (D12) — the resolver's own three probes prove no slot exists
- WS-5 module evaluator (D8) — both verdicts captured from one live snapshot
- WS-6 non-digest sweep (D1, D2, D9, D11, D13, D14) — each defect has a line number and a live measurement
- WS-7 topology edges (D10) — construction site read

**BLOCKED — cannot proceed regardless of evidence:**
- WS-2 jurisdiction stamping requires a **write**, which requires **credential rotation**. The code fix can be written; the four existing rows cannot be corrected.

**REQUIRES MORE RUNTIME EVIDENCE:**
- The behaviour of `evaluateRackingCapacityClearance` **after** a document is verified is `SOURCE-ONLY`. I can read the nine-condition gate but cannot prove which conditions a real verified row satisfies without performing a verification write. **Do not assume WS-3 alone closes #5–#8** — WS-2 must land first, or the jurisdiction comparison will still fail.
- D1 (download filename) is `SOURCE-ONLY`. The code path is unambiguous, but no browser session confirmed the saved filename.

### Honest bottom line

The brief's hypothesis — that authority is being silently discarded system-wide — is **not** what the evidence shows. Eleven of thirteen authority chains are correctly plumbed, the digest machinery is provably sound, and nine of twelve Braidon requirements are honest external gaps that no repair will close.

The defects are **concentrated**: one document-verification policy inconsistency, one hardcoded provenance block, one static-asset precedence rule, and one mis-stamped jurisdiction column between them account for four of the six software-implicated requirements. Fixing those four things — in the order above — is the highest-value work available.

**Reducing Braidon's count from 12 is mostly not a software problem.** It is a designer, five field measurements, an AHJ ordinance, a rail choice, three verification clicks, and a PE signature — in that order, with the PE last, because everything before it moves the digest.

---

*No code, database, migration, test or artifact was modified during this audit. Nothing was committed or pushed.*
