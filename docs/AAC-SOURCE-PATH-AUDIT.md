# AAC-0 — Source-Path Audit & Resolution-Mode Matrix

Deliverable 1 of the AUTOMATION AUTHORITY CLOSURE campaign
(`docs/AUTOMATION-AUTHORITY-CLOSURE-DIRECTIVE.md`).

- Baseline: `dev @ a6a225ae`
- Artifact audited: `PermitPackage-BRAIDON M PILLA — Solar TEST (9).html`
  (PDS-0B05747F0E8A, 24 sheets, **7 gates / 19 requirements / 0 advisories**)
- Method: static trace of the actual implementation. Every claim below carries a
  `file:line` anchor. No speculative architecture. No live DB was queried
  (see §3.2 for why that matters and what it blocks).
- Scope: READ-ONLY. This document is the only file this pass creates.

---

## §0 — The finding in one paragraph

The engine is not missing resolvers because resolvers are hard. It is missing
them because **the one async resolution stage that exists
(`resolveSnapshotAuthorityInputs`) is a document *lookup*, never a *retrieval*,
never a *derivation*, and never a *loop***. Of the 19 live requirements, **9 are
structurally unconditional** — they fire from a hardcoded literal, a dead code
path, or a field-name mismatch, not from project data. Three more (`RACKING-
CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP`, `FASTENER-
ASSEMBLY-UNVERIFIED`) are one predicate wearing three names. Two providers that
would clear two more requirements **already exist in-repo and are simply not
called from the permit path** (`lib/jurisdictions/ahjRegistry.ts`,
`lib/enrichment/propertyEnricher.ts`). One requirement (`CONDUIT-FILL-PENDING`)
is a computation that **already runs correctly** and is then discarded by three
misspelled field reads. The honest end-state after automation is **3–4 gates /
4–5 requirements**, and it is reachable.

---

## §1 — The twenty source-path traces

### Path 1 — User equipment selection

| | |
|---|---|
| Canonical store | `projects.selected_equipment` JSONB (migration 101). Shape: `lib/system/selectedEquipment.ts:34-53` (`SelectedEquipment`: `panelId/panel/inverterId/inverter/mountingId/mounting/batteryId/batteries/source/subSystems/schemaVersion`). |
| Writers | Design Studio persist → `/api/production` (`source: 'design'`); Engineering save-config → `/api/engineering/save-config` (`source: 'engineering'`). Contract at `selectedEquipment.ts:6-19`. |
| Design→Eng | `applyPanelToEngineeringConfig` (`selectedEquipment.ts:119-172`) re-pins `inverters[].strings[].panelId`, scoped per `subSystemKey`. |
| Eng→Design | `reconcileFromEngineeringConfig` (`selectedEquipment.ts:230-297`) — `dominantPanelId` vote (`:201-215`) at N≤1, `derivePrimaryMirror(map)` at N>1. |
| Where authority is CREATED | Only here and in the DB row. |
| Where merely displayed | Everywhere downstream. |

**Critical:** the permit POST **never reads `selected_equipment`**. The whole
design arrives in the request body (`app/api/engineering/permit/route.ts:311`).
The snapshot's module identity is derived from
`system.inverters[].strings[].panelModel` (`lib/permit/snapshot/build.ts:130-133`),
fuzzy-matched against `SOLAR_PANELS` (`build.ts:60-64`, `:141`). The canonical
store is therefore **not** the canonical authority in the permit path — the
posted fleet is.

### Path 2 — Fleet / default equipment

`getEquipmentContext(input, cad)` (`@/lib/system`) is the fallback when the fleet
carries no strings (`build.ts:133`, `:169`). `getInverterTopology` →
`topologyToLegacy` decides MICRO/STRING/OPTIMIZER (`build.ts:126-127`).
Equipment specs resolve from the static `lib/equipment-db.ts` catalogs
(`SOLAR_PANELS`, `MICROINVERTERS`, `STRING_INVERTERS`) and
`lib/mounting-hardware-db.ts` (`getMountingSystemById`, `build.ts:206`).
`provenance.source` is stamped `'equipment-db'` or `'project-scalars'`
(`build.ts:164`) — the one place the snapshot records *which* layer won.

### Path 3 — Subsystem records

`proj.subSystems[key].panelId` — a per-subsystem equipment map
(`lib/system/subSystemEquipment.ts`, mirrored by `lib/system/subSystemMirror.ts`).
Persisted both in `engineering_config.subSystems` (doctrine owner) and
`selected_equipment.subSystems` (`lib/db/projects.ts:527-547`, per-key
`jsonb_set` deep merge; `:763-770` names engineering_config as the owner).
The permit route self-heals a lost map from `engineering_config`
(`route.ts:600-608`).

**This is the second competing authority.** `build.ts:680-687` cross-checks
`getPanelById(sub.panelId)` against `modules[0].catalogId` and, on divergence,
pushes a conflict string — Braidon's `rec-alpha-pure-405` vs the fleet's
Q.PEAK DUO 400 W.

### Path 4 — Legacy migration values

`lib/db/projects.ts:565-613` — the **P0-11 "recompute-if-contradicts" mirror
repair**: `design_electrical.subSystems[]` blocks whose `panelId` contradicts the
`subSystems` map are re-aligned to the authoritative id, logged
`[design_electrical-mirror] P0-11`. This is the only automatic equipment
reconciliation anywhere in the codebase, it lives in the DB layer, and it
**does not run in the permit path**.

### Path 5 — Snapshot construction

`buildPermitDesignSnapshot(input, cad, opts)` — `lib/permit/snapshot/build.ts:66-121`
(signature), 1620 lines. Pure, synchronous, deterministic. **One production
caller**: `lib/permit/generatePermit.ts:1043`.

The `opts` bundle (`build.ts:70-120`) is the entire async-evidence surface:
`capacityDocument`, `projectJurisdiction`, `manufacturerDocumentsArchived`,
`digestInvalidatedByLedger`, `framingCapacityDocument`, `framingEngineerReview`,
`framingReviewDigest`, `framingProjectApplicabilityKey`,
`cableExtensionSolutions`, `qcableServiceLoopAllowance`, `environmentalSource`,
`groundingDocumentEvidence`. **Every one defaults to the blocker-firing state.**

Three of these slots are never populated by any caller:
`framingEngineerReview` / `framingReviewDigest` (`generatePermit.ts:1043-1065`
omits them) and `groundingDocumentEvidence` (`build.ts:115-120` accepts it;
nothing resolves it). They are pre-shaped, unwired resolver sockets.

### Path 6 — BOM

`generateBOMForPermit` (`lib/permit/utils/bomForPermit.ts:515`), run twice:
once pre-snapshot (`generatePermit.ts:1020`) and once snapshot-aware after the
grounding-authority correction (`generatePermit.ts:1080+`). Procurement
classification: `classifyProcurementAuthority` (`bomForPermit.ts:1384`),
`applyProcurementAuthority` (`:1557`), `isOrderableForProcurement` (`:1697`),
`buildProcurementApproval` (`:1702`), `orderableProcurementExport` (`:1802`) /
`nonOrderableProcurementExport` (`:1809`). Stable identity via content-derived
`bomLineId` (W1-A). Any `quantitySource === 'route-derived'` row is forced
non-orderable while `ROUTE-LENGTH-ESTIMATE` is open (`bomForPermit.ts:1198`).

### Path 7 — Procurement projection

`lib/permit/snapshot/procurementSufficiency.ts` (291 lines).
`buildProcurementSufficiency` called at `build.ts:863`.
Threshold: `Σ designedInstalledLengthFt + allowance` (`:219-221`);
supply: `Σ procurementLengthFt` (drop-count basis);
`insufficient = raw && clearedBySolutionId == null` (`:248`).
`resolutionOptions()` (`:35-49`) is a **static list of four labels** — it
enumerates nothing and evaluates nothing. `evaluateCableExtensionClearance`
(`:74-131`) is a 13-condition *validator*, not a generator.

### Path 8 — Datasheet registry / binding

**Two disconnected systems.**

1. **Static, in-repo:** `lib/manufacturer-assets-db.ts` (419 lines) —
   `getManufacturerAsset(equipmentId, category)`, `evaluateDocumentApplicability`
   (`:326-410`), `documentProductFromAsset` (`:297`), `_VERSION_TOKEN` (`:290`).
   This is what actually drives `MODULE-EXACT-DATASHEET-PENDING` and
   `EQUIPMENT-DOCUMENT-APPLICABILITY` today.
2. **DB registry (migration 113, unrun):** `lib/documents/registry.ts` —
   `createDocument` (`:130`), `findVerifiedDocument` (`:232`),
   `pickVerifiedDocument` (`:257-317`), plus four resolver adapters
   (`resolveRackingCapacityDocument :362`, `resolveFramingCapacityDocument :418`,
   `resolveClimateHazardDocument :483`, `resolveCableExtensionSolutions :538`).
   One table: `manufacturer_document_registry`.

**The two never meet.** `evaluateDocumentApplicability` accepts a 4th param
`registryFacts?: DocumentRegistryFacts` that unlocks the `AUTHORITATIVE` verdict
(`manufacturer-assets-db.ts:330-352`); **every production call site passes `null`
or omits it** — `structuralAuthority.ts:883`, `build.ts:1565`,
`structuralPages.ts:78`, `datasheetAppendix.ts:93`, `compliancePages.ts:1218`,
`sheetComposition.ts:479`, `roof.ts:2058`. `AUTHORITATIVE` is unreachable.

`createDocument` performs **no fetch, no hashing, no archival** — it stores an
operator-asserted `archivedInRepo: true` + a client-supplied `sha256`
(`app/api/admin/document-registry/rt-mini/route.ts:132-133`). There is no
ingestion path in the repo.

### Path 9 — Calculation inputs

Engine of record = `runElectricalCalc` (`build.ts:8-11`); `computeSystem` runs in
**shadow** via `buildComputeSystemShadow` (`lib/permit/utils/computedRuns.ts`),
projected by `lib/permit/snapshot/computeSystemProjection.ts` (86 lines).
Structural: V4 runs stashed on `input._structuralRuns` by `generatePermit`
(`build.ts:693`), consumed by `buildStructuralAuthority` (`build.ts:721`).
Conductors: `buildConductorAuthority` (`build.ts:124`).
Thermal: `getDesignTemps(lat, lng, state)` (`build.ts:664`).

**Defect (see Path 20 / RG-5):** `computeSystemProjection.ts:53-58` reads
`conduitRow?.fillPercent ?? feeder?.conduitFillPercent`. The real fields are
`ConduitScheduleRow.fillPct` (`computed-system.ts:340`) and
`RunSegment.conduitFillPct` (`computed-system.ts:186`). The row predicate
(`computeSystemProjection.ts:30-32`, keyed on `r.contains ?? r.segments`) matches
no field that exists on `ConduitScheduleRow`. So a correctly computed NEC Ch.9
Table 1 fill is discarded and re-reported as PENDING.

### Path 10 — Drawing annotations

Sheets are snapshot projections (`lib/permit/snapshot/read.ts` — `getSnapshot` /
`peekSnapshot`), per the W2–W6 waves and the ECD campaign.

**Renderer-side authority determination still exists** and violates WS-9:
`lib/permit/sections/compliancePages.ts:1212-1247`,
`lib/permit/sections/datasheetAppendix.ts:60-117`,
`lib/permit/sections/structuralPages.ts:73-78` all call
`getManufacturerAsset(...)` and `evaluateDocumentApplicability(...)` **inside the
render pass**, re-deciding document applicability the snapshot already decided.
This is the concrete instance of "the renderer must not retrieve authority".

### Path 11 — Evidence records

Evidence lives in three places, none of them append-only:

1. **Snapshot fields** — `CableExtensionDocumentEvidence` (`types.ts:427`),
   `ProcurementSufficiency.clearance {cleared, missing[], reasons[]}` (`:542-543`),
   `RackingCapacityDocumentEvidence` (`rackingAssembly.ts:107`),
   `FramingCapacityDocumentEvidence` (`framingAuthority.ts`),
   `EnvironmentalLoadSourceEvidence` (`environmentalAuthority.ts:25-48`),
   `GroundingDocumentEvidence` (`groundingAuthority.ts:108`),
   `CodeAuthorityRecord.sourceHash/verifiedBy/verifiedAtIso` (`codeAuthority.ts:78-86`).
2. **Registry-record derived** — `deriveEvidenceReferences`
   (`releaseGates.ts:695-709`) synthesises `authority:` / `provenance:` /
   `document:` / `sha256:` / `assembly:` strings from the blocker payload.
3. **DB** — `equipment_reconciliation_audit` + `snapshot_digest_invalidations`
   (migration 114, unrun).

The snapshot itself has **no table**. It survives only as the `_snapshot` key
inside `permit_input.json`, upserted on `(project_id, user_id, file_name)` —
one row per project+user, overwritten every generation, **no history**
(`route.ts:1444-1459`). Post-build mutation is impossible: the snapshot is
`deepFreeze`d at `generatePermit.ts:1073`.

### Path 12 — Environmental inputs

`buildEnvironmentalLoadAuthority` (`environmentalAuthority.ts:123`),
`environmentalSourceVerified` (`:86-104`, nine-condition fail-closed AND),
`EnvironmentalLoadAuthority` record shape (`types.ts:903-930`), stored at
`snapshot.structural.env.environmentalLoadAuthority` (`types.ts:885`).

**Where the printed wind/snow actually comes from today:** the permit POST route
calls `searchAhj({stateCode, city, county})` and **the static AHJ table WINS over
the project value** — `route.ts:684-685` (`_ahjWins` at `:676-682`):
```
body.project.ahjWindSpeedMph  = ar.windSpeedMph;
body.project.ahjGroundSnowPsf = ar.groundSnowLoadPsf;
```
`ar` is a hand-typed row in `lib/jurisdictions/ahj-national.ts` (factory defaults
`windSpeedMph:115, groundSnowLoadPsf:0` at `:91-92`) with **no source, no date,
no hash**. Renderer fallbacks still hardcode 115/0
(`lib/drafting/sheetComposition.ts:337,393-394,532`;
`lib/drafting/templates/fence.ts:528,1211`). Even the live AHJ registry client
refuses to supply these values, correctly (`ahjRegistry.ts:134-138`: "Wind/snow/
seismic belong to the site (ASCE 7 by lat/lng), not the AHJ").

### Path 13 — Location normalization

- Fields: `lat`/`lng` (`lib/permit/types.ts:175-176`), `county` (`:253`),
  `apn` (`:260`, `:726`).
- Geocoding: `lib/geocode.ts:84-105` — US Census Geocoder onelineaddress with a
  Nominatim fallback. Returns **only** `{lat, lng, displayName}`. No county, no
  FIPS, no municipality, no APN.
- County/city are operator-posted or postally inferred. `zip2fips.json` /
  `countyNames.json` exist but are consumed only by the lead-network map routes,
  never by the permit path.
- **`lib/permit/snapshot/coordinateAuthority.ts` is NOT geo normalization** — it
  is the drawing affine-transform authority (feet, `registration-ft` frame,
  `checkRenderParity`). No lat/lng or address appears in it.
- **An unused provider exists:** `lib/enrichment/propertyEnricher.ts` —
  ATTOM (`ATTOM_API_KEY`) → Census → Nominatim chain returning `parcel_id`,
  `county`, `fips_code`, `census_tract`, `formatted_address`, `owner_name`
  (`:40-60`). Its only caller is `lib/enrichment/enrichmentOrchestrator.ts:154`
  (lead enrichment). **The permit path never calls it.**

### Path 14 — AHJ / code records

`buildCodeAuthority` + `resolveAhjRecord` (`codeAuthority.ts:122-146`), called
`build.ts:901-907`. Record shape `codeAuthority.ts:59-94`.
`verificationStatus` computed `:207-217`.

Three hardcoded stubs make `verified` **unreachable**:
- `codeAuthority.ts:199-201` — IBC / IRC / IFC editions hardcoded `null`
  (the AHJ table carries no such fields), so `incompleteEditions` is never empty.
- `codeAuthority.ts:212-213` — `verifiedBy` and `sourceHash` hardcoded `null`.
- `codeAuthority.ts:242-251` — `effectiveDate`, `expirationDate`,
  `sourceDocument`, `sourceRevision`, `sourceDate` all hardcoded `null`; they are
  not even threaded through `CodeAuthorityBuildArgs` (`:148-164`).

`AhjRecord` (`ahj-national.ts:10-66`): 4,029 records (≈177 curated + ≈4,025
expanded, merged curated-wins at `:4606-4623`), keyed **state + county + city**
(no ZIP or lat/lng index — `searchAhj` accepts `zipCode` and never uses it,
`:4628`). Carries `necVersion`, `windSpeedMph`, `groundSnowLoadPsf`,
`seismicDesignCategory`, and a 3-value `dataProvenance` tag — **no adoption
ordinance URL, no effective date, no retrieval timestamp, no hash**.

**A live provider already exists and is not called from the permit path:**
`lib/jurisdictions/ahjRegistry.ts` — SunSpec / Orange Button AHJ Registry,
`POST https://ahjregistry.myorangebutton.com/api/v1/ahj/`,
`Authorization: Token ${AHJ_REGISTRY_TOKEN}`, 8 s timeout, null-on-any-failure
(`:153-187`), pure exported mapper `mapRegistryToAhjRecord` (`:71`),
`isRegistryConfigured()` (`:187`). Its **only** caller is
`app/api/engineering/ahj-lookup/route.ts:79`.

The registry payload carries `ElectricCode`, `FireCode`, `BuildingCode`,
`ResidentialCode` (`ahjRegistry.ts:14-15`). The mapper extracts **only NEC**
(`obNecYear(r.ElectricCode)`, `:83`) because `AhjRecord` has nowhere to put the
others. **The exact three editions RG-1 is blocked on are already in the upstream
response and are being discarded at `ahjRegistry.ts:83`.**

### Path 15 — Q-Cable branch / geometry inputs

`deriveBranchCablePaths` — `lib/bom/deriveRunLengths.ts:396-435`
(helper `nearestNeighbourPathFt` `:361-388`, result type `:345-356`).
Inputs: `(branches: {branchId, branchLabel, moduleCount, moduleCentersFt[]}[],
connectorSpacingFt, wasteFactor)`. **No drop coordinates, no trunk route, no
roof-plane transitions.** Pure, deterministic, digest-safe.

Two different bases, and the asymmetry *is* the deficit:
```
designed    = round1(nearestNeighbourTour(moduleCenters) + leadIn)   // geometry
procurement = ceil(drops × connectorSpacing × 1.15)                  // drop count
```
Called once: `build.ts:811` (inside `if (isMicro && branches.length > 0)`, `:783`);
centroids per branch `:804-810`; pitch from `resolveTrunkCablePlan(...)`
`:797-801`; results patch the `BRANCH_RUN` segment taxonomy `:874-890`.

**Catalog reachability gap.** `lib/equipment/trunkCable.ts:66-86` exposes exactly
**two** Enphase SKUs (`Q-12-10-240` @ 4.25 ft portrait, `Q-12-17-240` @ 6.56 ft
landscape), selected by orientation alone (`:202-204`).
`lib/data/equipment/trunk-cable-enphase.json:18-158` contains **seven** cable
variants (4.25 / 4.9 / 6.56 / 6.9 / 7.5 / 8.2 / 9.1 ft), plus `Q-12-RAW-300`
(300 m unterminated, `:132-139`), field-wireable connectors `Q-CONN-10M/10F`
(`:141-158`), `Q-TERM-10`, `Q-SEAL-10`, and a documented `spliceInstallRule`
(`:203-212`). `trunkCable.ts:84` acknowledges the omission in a comment.
**The alternate-stock solution space the directive demands the engine evaluate is
already in the repo, unreachable from the resolver.**

### Path 16 — System configuration + personnel roles

`app/engineering/page.tsx:526` initialises `config` with `designer: ''` — a
transient client form field, rendered at `:9444` in Project Information, echoed
to the permit body at `:3564`, `:6380`, `:7996`, `:13222`.
`:7189` auto-fills `'SolarPro Engineer'` only on an explicit auto-fill click.

**No persisted designer column exists anywhere.** A grep of every `.sql` in the
repo for `designer|prepared_by|engineer_of_record|eor_` returns **zero matches**.
`app/settings/page.tsx` has no designer/EOR/license field. `organizations`
(`lib/migrations/016_organizations.sql:14`) has `name`/`owner_id`/`plan` only;
`contractor_profiles` (`044_contractor_profiles.sql:13`) is capability tags and
service territory; `users` has `name/email/role/org_id`. The only adjacent
persisted field is `preparedBy` inside a proposal's `data_json`
(`app/api/proposals/route.ts:134,166`) — never read by the permit path.

The permit route reads `designer` only from the request body and deliberately
leaves it blank rather than defaulting to the vendor
(`route.ts:1181-1198` — a teardown P1 fix; do not undo it).

### Path 17 — Release-requirement construction

`build.ts:1003-1273` — one IIFE, one `push()` closure (`:1046-1072`), one
`registry: PermitReadinessBlocker[]`. Static per-code `META` table `:1020-1044`.
Severity comes from `classifyBlockerSeverity` (`severityPolicy.ts`), never from
the emitter (`build.ts:1050-1055`). Back-compat blocking list single-sourced at
`:1269-1271`.

Emission sites, in order: `ROUTE-LENGTH-ESTIMATE :1077` ·
`EQUIPMENT-IDENTITY-CONFLICT :1084` · `FEEDER-RACEWAY-AUTHORITY :1088` ·
`CONDUIT-FILL-PENDING :1095` · `BRANCH-RACEWAY-AUTHORITY :1117` ·
`RACEWAY-SEGMENT-CONFLICT :1133` · `TAP-CONDUCTOR-LENGTH-PENDING :1143` ·
`QCABLE-PROCUREMENT-INSUFFICIENT :1156` · `QCABLE-GROUNDING-AUTHORITY-UNVERIFIED :1169` ·
`structAuth.blockers :1208` · `rackingAssembly gaps :1216` ·
`CODE-AUTHORITY-INCOMPLETE :1225` · `PROJECT-AUTHORITY-UNVERIFIED :1233` ·
`PROJECT-NAME-NONPRODUCTION :1242` · `DESIGNER-OF-RECORD-MISSING :1246` ·
`collectEquipmentDocumentBlockers :1252` · `ENGINEERING-REVIEW-PENDING :1262`.

**`ENGINEERING-REVIEW-PENDING` has no `if`** — it is pushed unconditionally
(`:1261-1263`), matching the hardcoded `certification.engineeringReviewApproved:
false` at `:1610`.

### Path 18 — Seven-gate aggregation

`lib/permit/snapshot/releaseGates.ts` (1255 lines). Pure projection at read; not
stored, so no digest churn (`:29-35`). `RELEASE_GATE_DEFINITIONS` `:211-294`
(7 gates + the fail-closed `RG-UNMAPPED` sink). `REQUIREMENT_DECLARATIONS`
`:323-546` (code → gateId + findingType + title + `affects`).
`deriveReleaseGateModel` `:764-934`. Read seam `projectReleaseGates` `:944`.

Fail-closed properties worth preserving: an undeclared code lands in
`RG-UNMAPPED` and blocks every axis (`:785-788`); `resolved: true` without a
`resolutionAuditRef` stays OPEN (`deriveRequirementStatus :685-691`).
**That last rule is the contract the resolver framework must satisfy: an
auto-resolved requirement MUST write an audit reference, or it will not clear.**

### Path 19 — Planset generation

`generatePermitHTML(input, storedSldSvg, snapshotAuthority)`
(`generatePermit.ts:60-68`), invoked at `route.ts:1410`.
Sheet list: `lib/permit/sheetManifest.ts:109-151`.
POST phase order (`route.ts`):

| Lines | Phase |
|---|---|
| 307–320 | auth; `body = await req.json()`; `projectId = body.projectId ?? project.projectId` |
| 321–464 | DB gap-fill: Client_Profile hub, `canonical_snapshot`, `system_type` + latest layout |
| 466–480 | hard gate: 0 panels → 422 `ENGINEERING_MODEL_STALE` |
| 528–629 | derive inverters/strings from `engineering_config` / `design_electrical`; hybrid sub self-heal |
| **652–717** | **AHJ auto-populate from the static table — DB WINS over the project value** |
| 718–796 | geocode, aerial, parcel → `enrichedBody` |
| 832–1051 | site-survey integration, canonical building model |
| 1052–1135 | roof-geometry gate (422 unless `?draft=true`) |
| 1148–1401 | APN backfill, aerial re-center, Nearmap/OSM, obstruction sweep, deskew, edge-snap |
| **1409** | **`resolveSnapshotAuthorityInputs(enrichedBody)` — the ONLY resolution step** |
| 1410 | `generatePermitHTML(...)` → sync build → freeze → render |
| 1413–1511 | persist `permit_planset.html` + `permit_input.json`; return HTML or PDF |

Everything before 1409 is **input enrichment**, not evidence resolution, and it
mutates `body`/`enrichedBody` in place.

**Asymmetry to fix:** the GET self-heal path calls
`generatePermitHTML(savedInput)` with **no** `snapshotAuthority`
(`route.ts:218`) — a regenerated preview silently uses the fail-soft defaults.

### Path 20 — Snapshot freezing / digest

`lib/permit/snapshot/digest.ts`: `canonicalJson` (recursive key sort, drops
`undefined`, `:9`), `computeSnapshotDigest` (SHA-256 over the body with
`meta.digest`/`meta.snapshotId` removed, `:28`), `snapshotIdFromDigest`
(`'PDS-' + digest[0..12].toUpperCase()`, `:36`), `contentRevision` (`:44`),
`deepFreeze` (`:49`).

Sequence at `generatePermit.ts:1043-1077`: build → `validatePermitDesignSnapshot`
(70 `V*` invariants in `validate.ts`) → throw `SnapshotValidationError` on any
blocking violation → `deepFreeze` → `input._snapshot = snapshot`.

`snapshot.meta.designVersionId` is **always null** — the opt exists
(`build.ts:71`, written `:1396`) and `generatePermit.ts:1044` passes only
`projectId`.

---

## §2 — THE REQUIREMENT MATRIX

Legend for **Mode**: the directive's five classes —
`AUTO_DERIVED` · `AUTO_RETRIEVED` · `OPERATOR_CONFIRMATION` ·
`FIELD_VERIFICATION` · `PROFESSIONAL_APPROVAL`.

### RG-1 · PROJECT & AHJ AUTHORITY (3)

#### 2.1 CODE-AUTHORITY-INCOMPLETE

| Field | Finding |
|---|---|
| Root gate | RG-1 `PROJECT_AND_AHJ_AUTHORITY` (`releaseGates.ts:327-330`, `PENDING_AUTHORITY`) |
| Builder | `build.ts:1220-1229`; record `buildCodeAuthority` (`codeAuthority.ts:122-146`), called `build.ts:901-907` |
| Source inputs | `ahj-national.ts` record (state+county+city key) → `necVersion`, `localAmendments`, `website`; ASCE edition from the structural engine basis |
| Blocking condition | `codeAuthority.verificationStatus !== 'verified'`. `verified` requires **empty `incompleteEditions` AND `verifiedBy` AND `sourceHash`** (`codeAuthority.ts:207-217`). IBC/IRC/IFC hardcoded null (`:199-201`); `verifiedBy`/`sourceHash` hardcoded null (`:212-213`). **Unreachable — fires on 100 % of projects.** |
| Resolver exists? | **PARTIAL — yes, unwired.** `lib/jurisdictions/ahjRegistry.ts:153` `lookupAhjFromRegistry` returns `BuildingCode`/`FireCode`/`ResidentialCode`/`ElectricCode` per lat/lng. `mapRegistryToAhjRecord:83` extracts NEC only and discards the rest. No `ahj_code_adoption` document resolver exists, though the class is already declared (`lib/documents/types.ts:19`). |
| Invoked in generation path? | **No.** Only `app/api/engineering/ahj-lookup/route.ts:79`. |
| Evidence persists where | `snapshot.codeAuthority` (`types.ts:1048`) already has every field: `effectiveDate`, `sourceDocument`, `officialSource`, `sourceRevision`, `sourceDate`, `sourceHash`, `verifiedBy`, `verifiedAtIso`, `recordProvenance`. Durable copy → `manufacturer_document_registry` class `'ahj_code_adoption'` (**needs migration 113 run**). |
| Renderer wrongly deciding? | No — sheets read `snapshot.codeAuthority` (W4-A literal sweep). |
| **Correct mode** | **AUTO_RETRIEVED** (OPERATOR_CONFIRMATION only for boundary conflicts / disagreeing sources) |
| Insertion point | `resolveSnapshotAuthorityInputs` → new `resolveCodeAdoptionAuthority(coords, address)`; extend `CodeAuthorityBuildArgs` (`codeAuthority.ts:148-164`) to accept per-kind editions + provenance + `verifiedBy`/`sourceHash`. |
| Downstream invalidation | Every sheet's code literals (PV-0/CERT/PE-1/PV-4A), fire setbacks (IFC), structural basis (ASCE), `PLANSET_ENGINE_VERSION` digest. A coordinate or AHJ change must invalidate the record. |

#### 2.2 PROJECT-AUTHORITY-UNVERIFIED

| Field | Finding |
|---|---|
| Root gate | RG-1, `PENDING_AUTHORITY` (`releaseGates.ts:333-336`) |
| Builder | `build.ts:1232-1236`; record `buildProjectAuthority` → `projectAuthority.ts:405-415` |
| Source inputs | `proj.address / city / county / apn`, `codeAuthority.ahjName` |
| Blocking condition | `!_projectAuthorityVerified && (address ‖ city ‖ county ‖ ahjName)`, and **`_projectAuthorityVerified` is the literal `false` at `build.ts:1001`**. Unconditional. |
| Resolver exists? | **YES, unwired.** `lib/enrichment/propertyEnricher.ts:285 enrichProperty` — ATTOM → Census → Nominatim, returns `parcel_id`, `county`, `fips_code`, `census_tract`, `formatted_address`, `owner_name`, `provider_used`. |
| Invoked in generation path? | **No** — only `enrichmentOrchestrator.ts:154` (lead enrichment). |
| Evidence persists where | `snapshot.projectAuthority` per-field states already exist (`'verified' \| 'unverified-derived' \| 'unknown'`). Durable copy: a new provenance row or `manufacturer_document_registry`. Note `persistPropertyEnrichment` (`propertyEnricher.ts:233`) already writes to the lead-side enrichment table. |
| Renderer wrongly deciding? | No |
| **Correct mode** | **AUTO_RETRIEVED** (OPERATOR_CONFIRMATION for incorporated/unincorporated ambiguity or disagreeing sources) |
| Insertion point | `authorityInputs.ts` → `resolveProjectLegalAuthority(...)` → `buildProjectAuthority({ authorityVerified, perField })` |
| Downstream invalidation | AHJ resolution (county drives `resolveAhjRecord`), fire authority, APN on PV-0/PV-1, code authority. |

#### 2.3 PROJECT-NAME-NONPRODUCTION — **honest classification**

| Field | Finding |
|---|---|
| Root gate | RG-1, `ADMINISTRATIVE_HOLD` (`releaseGates.ts:339-342`) |
| Builder | `build.ts:1241-1243` |
| Blocking condition | `/\bTEST\b/i.test(proj.projectName)` — the live project is literally named `BRAIDON M PILLA — Solar TEST` |
| Source | `projects.name`, operator-owned (`lib/db/projects.ts:372`) |
| Resolver exists? | n/a |
| **Correct mode — honest answer** | **NOT AUTO_DERIVED.** The engine cannot invent a production name and must never rename a user's project. As currently scoped this is a genuine **ADMINISTRATIVE / OPERATOR** action: one field edit. |
| **The legitimate root-cause fix** | The permit's *project identity* should not be the CRM display label at all. Bind the permit identity to the **verified property + client record** (address, APN, owner) resolved by 2.2 — then the CRM label is metadata, and the requirement's predicate becomes "the permit identity is not established from a verified record", which 2.2 already answers. This is a **re-sourcing**, not a demotion: the requirement stays in the registry with the same severity. |
| **Recommendation** | Implement the re-sourcing; **retain** the label check as a distinct child that goes `NOT_APPLICABLE` (with a `NOT-APPLICABLE:` audit ref per `releaseGates.ts:677`) once the identity derives from the verified record. Flag to Ray as a decision — if he prefers the label itself to gate, it remains and clears with one rename. |
| Prediction | REMAINS unless Ray renames or approves the re-sourcing. |

### RG-2 · EQUIPMENT RECONCILIATION (2)

#### 2.4 EQUIPMENT-IDENTITY-CONFLICT

| Field | Finding |
|---|---|
| Root gate | RG-2, `TECHNICAL_CONFLICT` (`releaseGates.ts:347-350`) |
| Builder | `build.ts:1084` (`for (const c of equipmentIdentityConflicts) push(...)`); conflicts computed `build.ts:680-687` |
| Source inputs | `proj.subSystems[k].panelId` (→ `getPanelById`) **vs** `modules[0].catalogId` (fuzzy-matched from `system.inverters[].strings[].panelModel`) |
| Blocking condition | `mapped.id !== modules[0].catalogId`. Braidon: `rec-alpha-pure-405` vs `qcells-peak-duo-400`. |
| Resolver exists? | **YES.** `reconcileEquipmentIdentity` (`lib/reconciliation/reconcile.ts:77`) — writes `equipment_reconciliation_audit`, updates `projects.selected_equipment`, and inserts **two** `snapshot_digest_invalidations` rows (scope `snapshot` + `engineering_approval`). Exposed at `POST /api/admin/reconciliation` (`route.ts:72`), UI `app/admin/reconciliation/page.tsx`. |
| Invoked in generation path? | **No.** Full call graph: def, admin POST, tests. The permit path touches reconciliation read-only (`authorityInputs.ts:102 listActiveInvalidations`). |
| Dead code | `lib/reconciliation/conflicts.ts` — `detectConflictFromSources:33`, `collectModuleConflicts:50` have **zero production callers**; `build.ts:680-687` re-implements the same classification inline. |
| Evidence persists where | `equipment_reconciliation_audit` (migration 114, **unrun**) + `projects.selected_equipment`. Fail-soft path needed. |
| Renderer wrongly deciding? | No |
| **Correct mode** | **AUTO_DERIVED.** Per WS-2, an explicit user selection outranks a generated subsystem record. This is not "two genuinely active authoritative selections" — it is one live fleet selection and one stale mirror. It stays `OPERATOR_CONFIRMATION` **only** when two *explicit user* selections disagree. |
| Insertion point | A new pre-build **canonical-equipment resolver** in the resolver stage, ahead of `authorityInputs`: rank sources (explicit user selection > fleet strings > subsystem map > legacy `design_electrical` mirror > BOM/procurement > previously bound datasheets), persist the winner + supersede the loser, write the audit ref, invalidate dependents. Note the existing precedent: `lib/db/projects.ts:565-613` already does exactly this repair one layer down. |
| Downstream invalidation | modules[0] → all specs → conductor sizing → structural loads → BOM → datasheet binding → `MODULE-EXACT-DATASHEET-PENDING` → digest. **This resolver must run FIRST in the lifecycle and force a full recompute.** |

#### 2.5 MODULE-EXACT-DATASHEET-PENDING

| Field | Finding |
|---|---|
| Root gate | RG-2, `PENDING_DOCUMENT` (`releaseGates.ts:353-356`) |
| Builder | `collectEquipmentDocumentBlockers` → `equipmentProjection.ts:265`, pushed `build.ts:1252-1258` |
| Source inputs | `str.panelModel` per string → `getManufacturerAsset(rec.id, 'module_spec')` (**static asset DB, not the registry**) |
| Blocking condition | `resolveModuleDatasheetExactness(...).stateLabel === 'FAMILY-DATASHEET-PENDING'`, reached at `equipmentProjection.ts:209` **when the doc title matches `WATT_RANGE_RE = /(\d{3,4})\s*[–—-]\s*(\d{3,4})\s*W/i` with `hi > lo`** (`:186`). |
| The actual Braidon data | `manufacturer-assets-db.ts:71` — `module_spec:qcells-peak-duo-400`, `docTitle: "Qcells Q.PEAK DUO BLK ML-G10+ 385-405W Datasheet"`, `verified: true`, official Qcells PDF. **The selected 400 W is inside 385–405 W.** The selected wattage is never compared against `[lo, hi]` — a 400 W module with a "385–405 W" sheet and a 400 W module with a "500–600 W" sheet are treated identically. |
| Resolver exists? | No. Also note: a module with **no** datasheet emits nothing (`:203`) — the check is inverted in effect. |
| Invoked? | n/a |
| Evidence persists where | Static asset record needs `coversWattsLo/Hi` + an exact-wattage page/column reference; durable binding → `manufacturer_document_registry` class `module_datasheet` (migration 113). |
| Renderer wrongly deciding? | **Yes** — `datasheetAppendix.ts:60` re-computes exactness at render (`{ moduleExactness: exact }`). |
| **Correct mode** | **AUTO_DERIVED + AUTO_RETRIEVED.** Derived: parse the range and confirm the selected wattage falls inside it; that is the manufacturer's own exact-wattage source (Qcells publishes one series sheet with a per-wattage column). Retrieved: bind the registry record naming the page/column. Only a genuinely absent or non-covering document is `PENDING_DOCUMENT`. |
| Insertion point | Extend `resolveModuleDatasheetExactness` (`equipmentProjection.ts:186-215`) to compare `[lo,hi]` against the selected watts, and add a registry-backed binding resolver in the resolver stage. |
| Downstream invalidation | APP-A / DS-n appendix, SCHED, PV-3 module specs. |

*(`EQUIPMENT-DOCUMENT-UNVERIFIED` — RG-2's third declared child — is advisory
(`severityPolicy.ts:358-365`, NO_IMPACT) and is **not active** on Braidon, hence
0 advisories. Its condition, `equipmentProjection.ts:239-244`, is
`asset.verified === false` for a resolved micro; the IQ8A asset is verified.)*

### RG-3 · ENVIRONMENTAL LOAD AUTHORITY (1)

#### 2.6 ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED

| Field | Finding |
|---|---|
| Root gate | RG-3, `PENDING_AUTHORITY` (`releaseGates.ts:366-369`) |
| Builder | `structuralAuthority.ts:899-911`; record `buildEnvironmentalLoadAuthority` (`environmentalAuthority.ts:123`) |
| Source inputs | `proj.ahjWindSpeedMph` / `ahjGroundSnowPsf` — **overwritten by the static AHJ table at `route.ts:684-685`**; `proj.windExposure`, `proj.riskCategory`; `opts.environmentalSource` |
| Blocking condition | `verificationStatus !== 'verified'`, where verified = the nine-condition AND in `environmentalSourceVerified` (`:86-104`), including `currencyConfirmedAtIso`. `opts.environmentalSource` is null on live (`authorityInputs.ts:145-151` fail-soft). Unconditional today. |
| Resolver exists? | **Lookup only.** `resolveClimateHazardDocument` (`documents/registry.ts:483`) finds an already-archived `climate_hazard_dataset` row. **No retrieval provider exists** — nothing queries the ASCE 7 Hazard Tool. |
| Invoked? | Yes (`authorityInputs.ts:145`) — and always returns null (migration 113 unrun + nothing archived). |
| Evidence persists where | `snapshot.structural.env.environmentalLoadAuthority` (`types.ts:885,903-930`) — already has `sourceDocumentId`, `sourceDataset`, `sourceVersionOrDate`, `lookupTimestampIso`, `operatorOverrides[]`, `coordinates`, `addressUsed`, `evidenceRef`. Durable → `manufacturer_document_registry` class `climate_hazard_dataset` (**migration 113**). |
| Renderer wrongly deciding? | **Yes, weakly** — `sheetComposition.ts:337,393-394,532` and `templates/fence.ts:528,1211` still carry 115 mph / 0 psf literal fallbacks. |
| **Correct mode** | **AUTO_RETRIEVED** |
| Insertion point | New `ClimateHazardProvider` (DI, `isConfigured()` + `getHazards(lat,lng,riskCategory)`) modelled on `AerialGeometryProvider` (`lib/siteSurveys/aerialGeometry/types.ts:68-77`), called from `authorityInputs.ts`; result archived as a registry document and projected through the **existing** `EnvironmentalLoadSourceEvidence` shape. |
| Downstream invalidation | Wind/snow → structural V4 → utilization → PE-1 → PV-4C → fence engine → digest. **A coordinate change must invalidate the record** (mandated test). |
| Note | The record model already satisfies WS-4 completely. Only the *retrieval* and *archival* are missing. Do not rebuild the record. |

### RG-4 · STRUCTURAL ASSEMBLY AUTHORITY (6)

#### 2.7 FRAMING-AUTHORITY-UNVERIFIED

| Field | Finding |
|---|---|
| Root gate | RG-4, `PENDING_AUTHORITY` (`releaseGates.ts:377-380`) |
| Builder | `structuralAuthority.ts:795-805`, condition `a.engine.engineeringReviewRequired` → `structuralEngine.ts:184` → collapses to `!framingVerified` → `isFramingVerified(capacityAuthority)` (`:40-42,55`) |
| Source inputs | `resolveFramingCapacityAuthority({documentEvidence, reviewEvidence, currentDigest, projectApplicabilityKey})` (`framingAuthority.ts:189-243`) |
| Blocking condition | Path A (document): 8-condition AND — class ∈ `{truss_design_drawing, manufacturer_structural_calc, stamped_structural_analysis}`, verified/current/archived/sha256, `hasFramingCapacityClaim`, applicability covers the project key. Path B (engineer review): requires `reviewedSnapshotDigest === currentDigest` + `reviewerLicense` — **dead on live**, `generatePermit.ts:1043-1065` never passes `framingEngineerReview`/`framingReviewDigest`. |
| Operator/field entry | Explicitly **cannot** clear it. `buildFramingObservation` (`:56-89`) tags every row `source:'operator-entered'`; `observedSourceLabel` (`:107-114`) renders `SOURCE: FIELD MEASUREMENT — NOT CAPACITY-VERIFIED`. `geometryComplete` (`:69`) is computed and never read by the gate. |
| Resolver exists? | Lookup only (`resolveFramingCapacityDocument`, `documents/registry.ts:418`), wired `authorityInputs.ts:115`. Path B has no wiring at all. |
| Evidence persists where | `manufacturer_document_registry` (migration 113) + a future engineer-review record (**no table exists**). |
| Renderer wrongly deciding? | No |
| **Correct mode** | **Split.** (a) **AUTO_RETRIEVED** where a truss design drawing / manufacturer structural calc exists for the building. (b) **PROFESSIONAL_APPROVAL** for stick-framed existing residences with no such document — this is licensed judgement, correctly. (c) An intermediate **AUTO_DERIVED** tier is legitimate and currently missing: a prescriptive IRC/AWC span check over the already-captured `FramingObservation` geometry, which can establish capacity where the span table covers the case, without a PE. |
| Insertion point | Wire path B (`framingEngineerReview` + `framingReviewDigest` through `authorityInputs` → `generatePermit`), then add the prescriptive-span tier as a third `resolveFramingCapacityAuthority` path. |
| Downstream invalidation | PE-1 applicability, PV-4C, structural utilization, `engineeringReviewRequired`. |
| Prediction | **REMAINS on Braidon** (PROFESSIONAL_APPROVAL) unless the prescriptive tier covers the observed framing. |

#### 2.8 PENDING-RACKING-ASSEMBLY-SELECTION

| Field | Finding |
|---|---|
| Root gate | RG-4, `PENDING_SELECTION` (`releaseGates.ts:381-384`) |
| Builder | `structuralAuthority.ts:830-840` |
| Blocking condition | `_railUnpinned ‖ _assemblyPending`. `_railUnpinned` = `mixedManufacturer && railSku == null && (railModel == null ‖ /PENDING/i)`. **`railSku` is the literal `null` at `rackingAssembly.ts:569`** (as is `mountSku` at `:566`) — no code path ever populates them. `_assemblyPending` = `assemblyVerification.overall === 'pending'` (`:558-560`), which for RT-MINI depends on `rtCleared` — i.e. on the missing capacity **document**. |
| Catalog reality | `lib/mounting-hardware-db.ts` `RailSpec` (`:77-91`) has model/alloy/moment/shear/maxSpan/cantilever/spliceInterval/iccEsReport — **no `partNumber`/`sku`**. `HardwareKit.railSplice` is free-text. `equipment-db.ts:174-205 RackingSystem` likewise has no part number. The mount record names an **acceptable set**, not a rail: `mounting-hardware-db.ts:624` — *"Rail/splice SKU PENDING RACKING ASSEMBLY SELECTION — paired rail system; specify a listed rail/splice SKU (IronRidge XR100/XR1000, UniRac SFM, or Pegasus)"*. Of those four, Pegasus has no record at all and "UniRac SFM" matches neither `unirac-solarmount` nor `unirac-sme`. |
| Resolver exists? | No |
| **Correct mode** | **Two requirements wearing one name.** The `_assemblyPending` leg is a duplicate of 2.9/2.10 (AUTO_RETRIEVED) and must be separated. The `_railUnpinned` leg is a genuine **design selection**: the engine *can* deterministically select a rail from `maxSpanIn` / `momentCapacityInLbs` vs the computed span and load (XR100 96″, XR1000 84″, SolarMount 72″, SME 78″), which makes it **AUTO_DERIVED with a documented selection rule + operator override**. It cannot produce an orderable SKU until part numbers are added to the catalog. |
| **Ray decision required** | Does the engine get to select the rail family? It already sizes conductors and OCPD; selecting a rail from published span tables is the same class of act. Recommend **yes**, with the selection recorded as an engine decision with its basis, overridable by the designer. |
| Insertion point | Split the predicate in `structuralAuthority.ts:830-840`; add a `resolveRackingAssemblySelection` deriving rail + splice from span/load; add `partNumber` to `RailSpec` and `HardwareKit.railSplice`. |
| Downstream invalidation | Structural BOM (rails, splices, T-bolts), SCHED, PV-3, procurement orderability. |

#### 2.9 RACKING-CAPACITY-SOURCE-NOT-ARCHIVED · 2.10 RACKING-CAPACITY-APPLICABILITY-GAP

**These are one predicate.** `rackingAssembly.ts:446-463` pushes **both** under the
single condition `if (!rtCleared)` inside `if (isRtMini)` (`:328`, `:383`).
They are not independently determined and they clear from the identical document.

| Field | Finding |
|---|---|
| Root gate | RG-4; `PENDING_DOCUMENT` (`:391-394`) and `PENDING_AUTHORITY` (`:395-398`) respectively — a type split the code does not have |
| Blocking condition | `evaluateRackingCapacityClearance(ctx, ev).cleared !== true` (`:161-225`, `:371-381`) — ~15 conditions on ONE registry document: class ∈ `{structural_pe_letter, evaluation_report}`, `hasStructuralCapacityClaim`, verified/current/archived/sha256≥16, plus every §9 field (`exactModel === ctx.mountModel`, `fastenerModel`, `fastenerCount>0`, `substrate`, `rafterDeckCondition`, `embedmentIn>0`, `railLFootAssembly`, `loadBasis` matching `/allowable\|asd/i`, non-empty `adjustmentFactors`, `jurisdiction`, `asdAllowableLbs>0`) |
| The document | **Known and named in code**: `rackingAssembly.ts:403` cites `design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/`, currently `archivedInRepo: false`, `documentHash: null` (`:396-402`) |
| Coupling trap | `ctx.requiredRail = railModel` (`:377`) is null for RT-MINI, so the rail cross-check at `:207-209` is skipped, **but `evidence.railLFootAssembly` remains mandatory** (`:206`) — the document must name a rail assembly the project has not selected. Fix alongside 2.8. |
| Resolver exists? | Lookup only (`resolveRackingCapacityDocument`, `documents/registry.ts:362`), wired `authorityInputs.ts:82`. No retrieval/ingestion. |
| Evidence persists where | `manufacturer_document_registry` (**migration 113 required**) |
| Renderer wrongly deciding? | **Yes** — `structuralPages.ts:73-78` re-evaluates applicability at render |
| **Correct mode** | **AUTO_RETRIEVED** (one manufacturer PDF, URL already known) |
| Insertion point | A document **ingestion** resolver: fetch → hash → archive → extract §9 claims → `createDocument`. The RT-MINI ingestion API (`app/api/admin/document-registry/rt-mini/route.ts:81`) already defines the target field set (`REQUIRED_FIELDS :63-67`) but requires an operator to type them. |
| Consolidation | **Collapse 2.10 into 2.9** or give them genuinely different predicates. Two codes from one `if` is a count inflation the RGM model faithfully reproduces. |
| Downstream invalidation | Attachment capacity → utilization → PE-1 → structural BOM → 2.11. |

#### 2.11 FASTENER-ASSEMBLY-UNVERIFIED

| Field | Finding |
|---|---|
| Root gate | RG-4, `PENDING_AUTHORITY` (`releaseGates.ts:385-388`) |
| Builder | `structuralAuthority.ts:850-874` |
| Blocking condition | `_fastenerVerified = !_capGated && assemblyVerification.fastener === 'verified' && !!_fastenerSource`. For RT-MINI **`assemblyVerification.fastener` is already `'verified'`** (lagBolt + `fastenersPerMount:2` + `fastenerEmbedmentIn:2.5`, `mounting-hardware-db.ts:608-626`) and `_fastenerSource` is non-null (`iccEsReport: 'ICC-ES ESR-3575'`, `:616`). **So it fires purely because `_capGated` is true** (`:850-856`) — a pure downstream echo of 2.9/2.10. |
| Contradiction | `severityPolicy.ts:92-104` and the comment at `structuralAuthority.ts:841-849` both assert this is *"mount-BASE hardware, verifiable independent of the rail selection"*. The code makes it a function of the missing rail-capacity document. |
| Resolver exists? | Same document as 2.9 |
| **Correct mode** | **AUTO_RETRIEVED** — clears with the same RT-MINI PE letter |
| Insertion point | Either delete the `_capGated` term (making it genuinely independent, as documented) or merge it into 2.9. Recommend the former: ESR-3575 is already an archivable authority for the mount base. |
| Downstream invalidation | Fastener BOM, PV-4C, PE-1 |

#### 2.12 EQUIPMENT-DOCUMENT-APPLICABILITY

| Field | Finding |
|---|---|
| Root gate | RG-4, `PENDING_DOCUMENT` (`releaseGates.ts:399-402`) |
| Builder | `structuralAuthority.ts:881-889` |
| Blocking condition | `evaluateDocumentApplicability(ctx.mountSystem.model, getManufacturerAsset(id,'racking_detail'), null).applicabilityVerified === false`. Engine at `manufacturer-assets-db.ts:326-410`: parses a trailing product-version token (`_VERSION_TOKEN :290` — Roman numerals, `vN.N`, `Gen N`) and returns `PENDING_APPLICABILITY` (`:408`) when the selected model is the base product but the document names a different version. |
| The actual Braidon data | Selected `RT-MINI`; asset `racking_detail:rooftech-mini` has `docTitle: "Roof Tech RT-MINI II Installation Manual (Jun 2025)"` (`manufacturer-assets-db.ts:35`). The same record's `notes` **already names the legacy standalone RT-MINI manual URL** (Jan 2021, 33 pp, "also verified"). |
| Resolver exists? | Two clearing paths exist in code: an asset whose title matches the model version (`:386-390`), or a `verified DocumentApplicabilityAlias` (`:398-405`). **`DocumentApplicabilityAlias` (`:174`) has no store, no persistence, and no production caller** — the 4th param is `null` at every call site. |
| **Correct mode** | **AUTO_RETRIEVED** — archive the version-matching legacy manual (URL known) or persist a verified alias/supersession record |
| Renderer wrongly deciding? | **Yes** — `datasheetAppendix.ts:93`, `compliancePages.ts:1218`, `structuralPages.ts:78` all re-evaluate at render |
| Insertion point | Ingestion resolver + an alias store (a `document_applicability_alias` class in the registry, or a `supersedes/supersededBy` pair already present in `createDocument`'s predecessor logic, `documents/registry.ts:155`) |
| Downstream invalidation | APP-A / DS-n page selection, PV-3 detail citation, PV-5 citation |

### RG-5 · ELECTRICAL FIELD & CALCULATION CLOSURE (3)

#### 2.13 ROUTE-LENGTH-ESTIMATE

| Field | Finding |
|---|---|
| Root gate | RG-5, `FIELD_VERIFICATION` (`releaseGates.ts:469-476`) |
| Builder | `build.ts:1076-1079` |
| Blocking condition | `routeSegments.some(r => r.lengthSource !== 'cad-route' && r.lengthSource !== 'field-measurement')` — and **`lengthSource` is the hardcoded literal `'cad-derived-estimate'` at `build.ts:394`** for every segment. No code path ever assigns the two accepted values. Unconditional by construction. |
| Truth being lost | The **branch** section IS true geometry — `branchCablePaths` carry `lengthProvenance: 'geometry-derived'` (`deriveRunLengths.ts:406-420`) — and the gate lumps it in with the un-routed feeder/service runs. |
| Resolver exists? | No routed-conduit geometry object exists. The CAD carries module/equipment positions, not a physical raceway path around obstructions. |
| Evidence persists where | `snapshot.electrical.routeSegments[].lengthSource` (already typed) |
| Renderer wrongly deciding? | No — but the consequence is broad: `bomForPermit.ts:1198` forces every `route-derived` row non-orderable while this is open |
| **Correct mode** | **Per-segment split.** `AUTO_DERIVED` for geometry-derived branch segments (set `lengthSource` truthfully); **FIELD_VERIFICATION** for feeder/service segments genuinely absent from CAD. |
| Insertion point | Make `build.ts:394` per-segment truthful; scope the `:1076` predicate to the segments that genuinely lack routed geometry; extend the `affects` clause accordingly. |
| Downstream invalidation | Voltage drop, conductor/raceway footage, BOM orderability |
| Prediction | **REMAINS, materially narrowed** (feeder + service only) |

#### 2.14 CONDUIT-FILL-PENDING — **the clearest defect in the set**

| Field | Finding |
|---|---|
| Root gate | RG-5, `FIELD_VERIFICATION` (`releaseGates.ts:477-483`) — **misclassified** |
| Builder | `build.ts:1094-1097`, condition `cs && (elec?.conduitFill as any)?.fillPercent == null` |
| Does the calculation exist? | **Yes, twice, and one of them runs in the permit path.** (a) `lib/electrical-calc.ts:1040-1075` — NEC Ch.9 Tables 1/4/5, `fillPercent`, `passes = ≤40`, `ConduitFillResult` type `:228`. (b) `lib/computed-system.ts` — conductor areas `:637`, conduit areas `:654`, per-run `RunSegment.conduitFillPct` `:186`, `conduitFillPass` `:201`, violation emission citing "NEC Chapter 9 Table 1" `:2157-2163`, back-populated `:2271`, surfaced on `ConduitScheduleRow.fillPct` `:340,:2416` and `physicalRaceway.fillPct` `:2320,:2397`. |
| Why it fires anyway | **Four field-name mismatches in one projection** (verified by direct read). `computeSystemProjection.ts:53-58`: `conduitFill: { fillPercent: conduitRow?.fillPercent ?? feeder?.conduitFillPercent, passes: conduitRow?.passes ?? feeder?.overallPass }`. (1) `conduitRow` is found by `String(r?.contains ?? r?.segments ?? '')` (`:30-32`) — `ConduitScheduleRow` (`computed-system.ts:330-345`) has **neither** `contains` nor `segments` (it has `raceway/from/to`), so the find always returns null. (2) The row field is **`fillPct`**, not `fillPercent`. (3) The fallback reads `conduitFillPercent`; `feeder` is `runMap['COMBINER_TO_DISCO_RUN']`, a `RunSegment`, whose field is **`conduitFillPct`** (`computed-system.ts:186`). (4) `passes` reads `conduitRow?.passes`; the row field is **`pass`**. Same bug class at `build.ts:401` (`r.conduitFillPercent`), which nulls `routeSegments[].fillPct` too. The legacy path set it correctly (`generatePermit.ts:827-834`) but that result is shadow-only and overwritten at `:939`. |
| Resolver exists / invoked? | **The calculation exists AND is invoked.** Its result is discarded. |
| Evidence persists where | `snapshot.electrical.conduitFill` (already typed) |
| Renderer wrongly deciding? | No |
| **Correct mode** | **AUTO_DERIVED** (WS-7 is explicit: *"an unexecuted calculation is never field verification"* — here it is worse, the calculation *was* executed) |
| Insertion point | `computeSystemProjection.ts:30-32` and `:53-58`; `build.ts:401`. Then reclassify the requirement declaration from `FIELD_VERIFICATION` to a calculated result. |
| Downstream invalidation | PV-4A / PV-4B fill cells, derating, raceway schedule |
| Prediction | **CLEARS** |

#### 2.15 TAP-CONDUCTOR-LENGTH-PENDING

| Field | Finding |
|---|---|
| Root gate | RG-5, `FIELD_VERIFICATION` (`releaseGates.ts:484-489`) |
| Builder | `build.ts:1141-1145` |
| Blocking condition | any `tap-conductors` service-topology object with a `constraints[].state === 'pending'` — and **the constraint is hardcoded `state:'pending'` at `build.ts:525-530`**, inside `if (isSupply)` (`:518`), with `lengthFt: null, lengthSource:'unknown'` (`:524`). Fires on every supply-side design; load-side designs never create the object. |
| Derivable from geometry? | **No.** The run is tap point → fused AC disconnect on the **existing** service, whose physical positions are not in the CAD model. `supplySideTap.ts:82-88` shows the entire existing-service picture is survey-only. |
| Resolver exists? | No. `buildSupplySideTapConnectionAuthority` (`supplySideTap.ts:72+`) reads `tapObj.lengthFt` (`:95`, always null) and records the unresolved fact (`:115`). |
| **Correct mode** | **FIELD_VERIFICATION — legitimate.** With one honest improvement: the site-survey capture protocol (`docs/SITE-SURVEY-CAPTURE-PROTOCOL.md`) could carry a measured tap length, which would make it **AUTO_DERIVED from survey** for surveyed projects. |
| Insertion point | Add a survey field + a `resolveTapConductorLength` that reads it; keep FIELD_VERIFICATION when absent. |
| Prediction | **REMAINS on Braidon** |

### RG-6 · Q-CABLE SYSTEM CLOSURE (2)

#### 2.16 QCABLE-PROCUREMENT-INSUFFICIENT

| Field | Finding |
|---|---|
| Root gate | RG-6, `VERIFIED_DEFICIENCY` (`releaseGates.ts:516-522`) |
| Builder | `build.ts:1152-1160`; engine `procurementSufficiency.ts:219-248` |
| Blocking condition | `Σ procurementLengthFt < Σ designedInstalledLengthFt + allowance`, and `clearedBySolutionId == null`. Allowance is 0 with provenance `'no-allowance-authority-recorded'` (`:209-217`); `authorityInputs.ts:158` hardcodes it null. |
| Root cause of the deficit | The two sides use **different bases** (Path 15): designed = nearest-neighbour geometric tour + lead-in; procurement = `drops × pitch × 1.15`. Row transitions exceed the connector pitch, so geometry outruns a drop-count estimate even with 15 % waste. |
| Does the engine evaluate options? | **No.** `resolutionOptions()` (`:35-49`) is a static list of four labels. `evaluateCableExtensionClearance` (`:74-131`) is a validator. **`resolveCableExtensionSolutions` (`documents/registry.ts:538-561`) declares `out`, awaits the document, `continue`s on null, and never calls `out.push(...)` — it returns `[]` unconditionally.** Plus `:543` early-returns `[]` when no SKUs are selected. Structurally dead. |
| The solution space that already exists in data | `lib/data/equipment/trunk-cable-enphase.json:18-158` — five additional connector pitches (4.9, 6.9, 7.5, 8.2, 9.1 ft), `Q-12-RAW-300` raw cable, `Q-CONN-10M/10F` field-wireable connectors, `Q-TERM-10`, `Q-SEAL-10`, and a documented `spliceInstallRule` (`:203-212`). `trunkCable.ts:202-204` reaches **two** of them. |
| Resolver exists / invoked? | Lookup wired (`authorityInputs.ts:130`), returns `[]` always |
| Evidence persists where | `snapshot.electrical.procurementSufficiency` (`types.ts:542-543`) already carries `clearance {cleared, missing[], reasons[]}` and `clearedBySolutionId` |
| Renderer wrongly deciding? | No |
| **Correct mode** | **AUTO_DERIVED.** The directive is exactly right: the engine must *evaluate* — alternate listed pitch, listed extension, raw cable + listed field-wireable connectors, cable-end relocation, branch reassignment, rebranch — and produce a complete solution or a precise unresolved reason. |
| Insertion point | A real **Q-Cable topology + procurement engine** consuming the full JSON catalog: emit the deterministic topology object WS-5 specifies (branch id, ordered modules, drop coords, inter-module segments, row/array transitions, homerun transition, service-loop allowance, dead-drop, cable ends, terminators, sealing caps, extension requirements, installed vs procurement length, stock configuration, geometry coverage, confidence, field-dependent portion). Procurement then *consumes* the topology; the gate *inspects* completed resolution. |
| Downstream invalidation | Q-Cable BOM lines, orderability, PV-4B, E-1, SCHED |
| Prediction | **CLEARS** (a determinate solution exists in catalog data) |
| Test guard | No Braidon constants in production code — the 31 drops / 166.5 vs 152 / 14.5 ft figures are *outputs*, not inputs. |

#### 2.17 QCABLE-GROUNDING-AUTHORITY-UNVERIFIED

| Field | Finding |
|---|---|
| Root gate | RG-6, `PENDING_AUTHORITY` (`releaseGates.ts:523-529`) |
| Builder | `build.ts:1167-1201`; engine `groundingAuthority.ts:425-543`, blocking at `:520-522` |
| Three-outcome model | `NO_SEPARATE_EGC_REQUIRED` (A) · `SEPARATE_EGC_REQUIRED` (B) · `PENDING_MANUFACTURER_AUTHORITY` (C), `:52-55`. `outcomeFromDocument(doc, applicability)` (`:286-297`) admits **only** the document + its applicability verdict — the conductor-count inference is structurally unexpressible, not merely forbidden. Equipment facts attach afterwards as descriptive data with `conductorCountIsNonDeterminative: true` (`:500-503`). |
| Blocking condition | verified/current/archived + hash ≥16, `statedGroundingMethod` ∈ the two enum values, non-empty `sectionOrPage`, **`applicability.scope === 'exact-sku'`**, exact (non-substring, `exactlyCovers :178-182`) coverage of micro SKU + cable SKU + module SKU + mounting/bonding system, jurisdiction match or `'ALL US NEC JURISDICTIONS'` (`:220-263`) |
| Resolver exists? | **No.** `opts.groundingDocumentEvidence` (`build.ts:115-120`) is accepted by the build and resolved by nobody — `authorityInputs.ts` has no such field and `generatePermit.ts:1043-1065` never passes one. A pre-shaped, unwired socket. |
| Evidence persists where | `snapshot.electrical.openAirGroundingAuthority` + `manufacturer_document_registry` (**migration 113**) |
| Renderer wrongly deciding? | No — grounding was single-sourced in ECD §6/§7 |
| **Correct mode** | **AUTO_RETRIEVED**, with a real risk of legitimate failure |
| **Risk flag (highest in the set)** | The `exact-sku` scope requirement may be unsatisfiable: Enphase publishes *family* documents (IQ8 series install manual, Q Cable technical brief). If no document explicitly names `Q-12-10-240` + `IQ8A-72-2-US` + the module + the mount, retrieval fails honestly and this becomes **OPERATOR_CONFIRMATION / PROFESSIONAL_APPROVAL**. Do **not** relax `exact-sku` to clear a count. Report the precise retrieval failure instead. |
| Insertion point | Wire `groundingDocumentEvidence` through `authorityInputs.ts` (mirroring `resolveClimateHazardDocument`) + an ingestion resolver for the Enphase installation document. |
| Downstream invalidation | EGC quantity + orderability, E-1 grounding rows, PV-1B, PV-4B, SCHED |
| Prediction | **CLEARS IF the document exists at exact-SKU scope; otherwise REMAINS with a precise, evidenced retrieval failure.** |

### RG-7 · PROFESSIONAL RELEASE (2)

#### 2.18 DESIGNER-OF-RECORD-MISSING

| Field | Finding |
|---|---|
| Root gate | RG-7, `ADMINISTRATIVE_HOLD` (`releaseGates.ts:533-536`) |
| Builder | `build.ts:1245-1248` — `if (!(proj.designer && String(proj.designer).trim()))` |
| Source inputs | `PermitInput.project.designer` (`lib/permit/types.ts:160`, `:784`) — client form field only |
| Blocking condition | Empty string. `route.ts:1181-1198` deliberately leaves it blank (vendor-name default was a teardown P1 — **do not undo**). |
| Resolver exists? | **No, and there is nowhere to store the answer.** Zero `.sql` matches for `designer|prepared_by|engineer_of_record|eor_` across all migrations. No settings field. Only `preparedBy` in a proposal's `data_json`, never read here. |
| Evidence persists where | **NEW MIGRATION REQUIRED** — a personnel-roles store (org-level defaults + per-project overrides) covering WS-6's five distinct roles: designer, preparer, reviewer, engineer of record, approving engineer. |
| Renderer wrongly deciding? | Related: `page.tsx:15011` gates the CERT sheet on `!!config.designer` |
| **Correct mode** | **AUTO_DERIVED** once the store exists — the designer is a configuration fact, and asking for it per-project is exactly the "never ask the user for information the platform knows" violation. |
| Insertion point | New migration + `resolveProjectPersonnel(projectId, orgId)` in the resolver stage → populates project record, snapshot, title blocks, CERT, review records, planset metadata. |
| **Hard boundary** | It must **never** fabricate an EOR, PE, signature, seal, or digest approval. A configured *designer* clears only the designer role. |
| Downstream invalidation | PV-0 title block, CERT, issue-state gate (`build.ts:1299-1303`) |
| Prediction | **CLEARS** |

#### 2.19 ENGINEERING-REVIEW-PENDING

| Field | Finding |
|---|---|
| Root gate | RG-7, `PROFESSIONAL_RELEASE` (`releaseGates.ts:542-545`) |
| Builder | `build.ts:1261-1263` — **unconditional, no `if`** |
| Source inputs | `certification.engineeringReviewApproved`, hardcoded `false` at `build.ts:1610`; `_paReview = null` at `:1296` |
| Record shape | `false \| { reviewedDigest: string; approvedAtIso: string }` (`types.ts:1254`); consumed `certPages.ts:45-50` (requires `reviewedDigest === s.meta.digest`), validated `validate.ts:640`, gates V13 `generatePermit.ts:1301` |
| Resolver exists? | **No table, no API, no UI.** Grep of `app/api` for `engineeringReviewApproved` / `reviewedDigest` → zero. (`_tmp_approve.ts` in the repo root is an unrelated one-off aerial roof-plane promotion script.) |
| Evidence persists where | **NEW MIGRATION REQUIRED** — a digest-bound engineering-review/approval record |
| **Correct mode** | **PROFESSIONAL_APPROVAL — legitimate and permanent** |
| The real defect | It is currently **structurally unclearable**. WS-6/WS-9 must build the record + approval API so a PE *can* clear it. An unclearable requirement is not honesty, it is a missing feature. |
| Downstream invalidation | Any digest change invalidates coverage — that is the point, and `snapshot_digest_invalidations` already models it. |
| Prediction | **REMAINS on Braidon** (correctly — no PE has approved this set) |

---

## §3 — Operational constraints the implementation must respect

### 3.1 Migrations 113 / 114 are WRITTEN but NOT RUN

- `lib/migrations/113_manufacturer_document_registry.sql` — `manufacturer_document_registry` (25 cols, 6 indexes incl. the resolver hot path `(document_class, equipment_id, status, verification_state)`).
- `lib/migrations/114_equipment_reconciliation_audit.sql` — `equipment_reconciliation_audit` (14 cols) **and** `snapshot_digest_invalidations` (11 cols incl. `superseded_at`/`superseded_by`).
- Deployment wrapper: `lib/migrations/targetedRegistryDeployment.ts:34-39`, `REGISTRY_SEQUENCE = ['113','114']`; UI `app/admin/system-tools/migrations/page.tsx`.
- **Standing rule (memory):** run via the governed console, **113 then 114**.

**Resolvers that depend on them:** 2.1 (code adoption doc), 2.4 (reconciliation
audit + invalidation ledger), 2.5 (module datasheet binding), 2.6 (climate hazard
doc), 2.7 (framing doc), 2.9/2.10/2.11 (racking capacity doc), 2.12 (applicability
alias), 2.16 (cable extension doc), 2.17 (grounding doc). **Nine of nineteen.**

**Fail-soft contract (must be preserved and extended):** `lib/documents/registry.ts`
and `lib/reconciliation/reconcile.ts` contain **zero** error handling — no
try/catch, no `42P01` guard (repo-wide search for `42P01`: no hits). Every
function throws the raw Postgres error. The permit path is safe **only** because
`authorityInputs.ts` individually wraps each call (`:91-95`, `:104-106`,
`:120-122`, `:134-136`, `:149-151`). The admin APIs are deliberately fail-loud
(`handleRouteDbError`).

**Every new resolver MUST follow the `authorityInputs.ts` pattern**: individual
try/catch, fail-soft to the blocker-firing state, never a bare `true`. Note the
one deliberate fail-*hard* direction: `digestInvalidatedByLedger` catches to
`true` (`:105`) because unknown must not satisfy a gate.

### 3.2 The duplicate live BRAIDON rows — how the pipeline actually selects one

**There is no name lookup anywhere in the permit path.** Selection is purely a
client-supplied UUID:

- `route.ts:320` — `const projectId = body.projectId || project.projectId`; every DB read is `WHERE id = ${projectId}`.
- If `projectId` is absent/non-UUID, **every DB block is skipped** and the permit generates from the POSTed body alone (POST does not 400 on a missing projectId; GET does, `route.ts:165`).
- UI: `page.tsx:8162` posts `permitInput` whose `projectId: currentProjectId || undefined` is set at `:8093`. `currentProjectId` has three writers — `?projectId=` query param (`:1089`, `:1101`), `?fileId=` reverse hydration (`:2181`), reset to null (`:8738`).
- The URL value comes from the project selector (`page.tsx:8846-8857`: `router.push('/engineering?projectId=' + p.id)`, also writing `localStorage['eng:lastProjectId']`), and a bare `/engineering` auto-redirects from that localStorage key (`:2128-2136`).
- Selector list: `/api/projects` → `lib/db/projects.ts:122 getProjectsByUser` → `WHERE user_id AND deleted_at IS NULL ORDER BY updated_at DESC` (`:133-166`). **No dedupe, no name grouping.** Three duplicate BRAIDON rows render as three visually identical entries; only the kW badge (`page.tsx:8866`) may differ.
- **No `designVersionId`, no `project_versions` join, no latest-wins tie-break at the project level.** Latest-wins ordering exists only *below* the project row (`layouts`, productions, proposals — all `ORDER BY updated_at DESC LIMIT 1`).

**Consequence for live acceptance:** the deployed app generates from whichever
UUID was last clicked in that browser. To identify the row deterministically:
read `snapshot.meta.projectId` from the artifact, **or** find the `projects` row
whose `project_files` entries named `permit_planset.html` / `permit_input.json`
are freshest (`route.ts:1421,1444`, upserted on `(project_id, user_id, file_name)`).

**Action for AAC:** before Braidon acceptance, pin the row. Recommended minimal
change: pass `designVersionId` into `buildPermitDesignSnapshot`
(`generatePermit.ts:1044` currently passes only `projectId`) so `meta.designVersionId`
stops being null, and surface `projectId` + `updated_at` in the selector so a
duplicate is distinguishable. **Do not** add a name-based lookup.

### 3.3 External providers — what exists, what is plausible, what must be fixtured

| Need | Provider status | Env key |
|---|---|---|
| AHJ + adopted codes | **Built, unwired to permit:** `lib/jurisdictions/ahjRegistry.ts` (SunSpec / Orange Button, NREL-founded — the registry Aurora / SolarAPP+ use). Returns `ElectricCode`/`FireCode`/`BuildingCode`/`ResidentialCode`. Mapper discards 3 of 4 at `:83`. | `AHJ_REGISTRY_TOKEN` (free from support@sunspec.org; **absent from `.env.example`**) |
| Property / APN / county / boundary | **Built, unwired to permit:** `lib/enrichment/propertyEnricher.ts` — ATTOM → Census Geocoder → Nominatim | `ATTOM_API_KEY` (present in `.env.example`) |
| Environmental hazards | **Not built.** ASCE 7 Hazard Tool (`asce7hazardtool.online`) is the correct authority; NOAA/ATC alternatives exist. Note `NREL_API_KEY` is already provisioned for other NREL services. | new key needed |
| Aerial / imagery | Nearmap (`NEARMAP_API_KEY`), Google Solar (`GOOGLE_SOLAR_API_KEY`), EagleView (`EAGLEVIEW_*`) — all already wired | existing |
| Manufacturer documents | No fetch/ingestion path anywhere. `createDocument` stores an operator-asserted archival claim. | n/a |

**DI pattern to copy** — `lib/siteSurveys/aerialGeometry/types.ts:68-77`:
```ts
export interface AerialGeometryProvider {
  readonly name: AerialGeometrySourceName;
  isConfigured(): boolean;
  getRoofFacets(req: AerialGeometryRequest): Promise<AerialRoofResult | null>;
}
```
with `eagleViewProvider.ts` / `mockProvider.ts` implementations and a neutral
result type carrying `source` + `reportId` + `imageryDate` for provenance.
Token caching precedent: `eagleViewProvider.ts:43-75`.
**Quota discipline precedent (mandatory reading before adding a metered
provider):** `lib/aerial/nearmapCache.ts` — DB-backed, **fail-closed** (cache
unreadable ⇒ no live fetch), negative caching, one canonical radius, a
`NEARMAP_AI_CACHE_ONLY=1` freeze switch. Standing rule from the quota incident:
**metered externals never fail open.**

**Must be DI-fixtured in tests:** every provider above. Tests must clearly
distinguish *fixture proof* from *live retrieval proof*, and the anti-vacuity
cases are non-negotiable — a sourceless default cannot clear
(`CODE-AUTHORITY-INCOMPLETE`), utility territory is not AHJ proof, empty evidence
cannot clear (`ENVIRONMENTAL-...`), a coordinate change invalidates, a superseded
equipment record cannot re-enter, an uncalled resolver cannot finalize a blocker.

### 3.4 The PROJECT-NAME-NONPRODUCTION question — answered honestly

See §2.3. **The requirement is correctly ADMINISTRATIVE and non-automatic as
currently scoped.** The engine must not rename a user's project, and there is no
determinable production name to derive. The legitimate automation is to
*re-source the permit's project identity* to the verified property + client
record (which §2.2's resolver produces), after which the CRM label is not the
permit identity and the child goes `NOT_APPLICABLE` with a recorded audit
reference. That is a root-cause consolidation, not a blocker→advisory demotion.
**Ray decision required** before implementing; the safe default is to leave the
requirement gating and let one rename clear it.

---

## §4 — Honest expected end-state

### 4.1 Per-requirement prediction

| # | Requirement | Gate | Mode | Resolver exists? | Invoked? | Prediction |
|---|---|---|---|---|---|---|
| 1 | CODE-AUTHORITY-INCOMPLETE | RG-1 | AUTO_RETRIEVED | partial (ahjRegistry, NEC only) | **no** | **CLEARS** (needs token + provenance record) |
| 2 | PROJECT-AUTHORITY-UNVERIFIED | RG-1 | AUTO_RETRIEVED | **yes** (propertyEnricher) | **no** | **CLEARS** |
| 3 | PROJECT-NAME-NONPRODUCTION | RG-1 | ADMINISTRATIVE | n/a | n/a | **REMAINS** (1 operator edit; or N/A after identity re-sourcing) |
| 4 | EQUIPMENT-IDENTITY-CONFLICT | RG-2 | AUTO_DERIVED | **yes** (reconcile.ts) | **no** | **CLEARS** |
| 5 | MODULE-EXACT-DATASHEET-PENDING | RG-2 | AUTO_DERIVED + AUTO_RETRIEVED | no | n/a | **CLEARS** (400 W is inside 385–405 W) |
| 6 | ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED | RG-3 | AUTO_RETRIEVED | lookup only | yes → null | **CLEARS** (needs ASCE provider) |
| 7 | FRAMING-AUTHORITY-UNVERIFIED | RG-4 | PROFESSIONAL_APPROVAL (+AUTO tiers) | lookup only; path B dead | partial | **REMAINS** |
| 8 | PENDING-RACKING-ASSEMBLY-SELECTION | RG-4 | AUTO_DERIVED (rail) + duplicate of #9 | no | n/a | **CLEARS pending Ray's rail ruling** |
| 9 | RACKING-CAPACITY-SOURCE-NOT-ARCHIVED | RG-4 | AUTO_RETRIEVED | lookup only | yes → null | **CLEARS** |
| 10 | RACKING-CAPACITY-APPLICABILITY-GAP | RG-4 | AUTO_RETRIEVED (same predicate as #9) | same | same | **CLEARS / merge into #9** |
| 11 | FASTENER-ASSEMBLY-UNVERIFIED | RG-4 | AUTO_RETRIEVED (echo of #9) | same | same | **CLEARS** |
| 12 | EQUIPMENT-DOCUMENT-APPLICABILITY | RG-4 | AUTO_RETRIEVED | alias type exists, no store | no | **CLEARS** |
| 13 | ROUTE-LENGTH-ESTIMATE | RG-5 | AUTO_DERIVED (branch) + FIELD_VERIFICATION (feeder) | no | n/a | **REMAINS, narrowed** |
| 14 | CONDUIT-FILL-PENDING | RG-5 | AUTO_DERIVED | **calculation exists AND runs** | yes, result discarded | **CLEARS** |
| 15 | TAP-CONDUCTOR-LENGTH-PENDING | RG-5 | FIELD_VERIFICATION | no | n/a | **REMAINS** |
| 16 | QCABLE-PROCUREMENT-INSUFFICIENT | RG-6 | AUTO_DERIVED | dead (`no out.push`) | yes → `[]` | **CLEARS** |
| 17 | QCABLE-GROUNDING-AUTHORITY-UNVERIFIED | RG-6 | AUTO_RETRIEVED | **no** (unwired socket) | **no** | **CLEARS IF exact-SKU doc exists; else REMAINS** |
| 18 | DESIGNER-OF-RECORD-MISSING | RG-7 | AUTO_DERIVED | no store anywhere | n/a | **CLEARS** (new migration) |
| 19 | ENGINEERING-REVIEW-PENDING | RG-7 | PROFESSIONAL_APPROVAL | **no table/API at all** | n/a | **REMAINS** (and must become *clearable*) |

Counts: **AUTO_DERIVED 6 · AUTO_RETRIEVED 8 · split 2 · ADMINISTRATIVE 1 ·
FIELD_VERIFICATION 1 · PROFESSIONAL_APPROVAL 1.**

### 4.2 Expected gate movement

| Gate | Now | After | Remaining children |
|---|---|---|---|
| RG-1 PROJECT & AHJ AUTHORITY | OPEN (3) | **OPEN (1)** | PROJECT-NAME-NONPRODUCTION (admin, 1 edit) |
| RG-2 EQUIPMENT RECONCILIATION | OPEN (2) | **CLEARED** | — |
| RG-3 ENVIRONMENTAL LOAD AUTHORITY | OPEN (1) | **CLEARED** | — |
| RG-4 STRUCTURAL ASSEMBLY AUTHORITY | OPEN (6) | **OPEN (1)** | FRAMING-AUTHORITY-UNVERIFIED |
| RG-5 ELECTRICAL CLOSURE | OPEN (3) | **OPEN (2)** | ROUTE-LENGTH-ESTIMATE (narrowed), TAP-CONDUCTOR-LENGTH-PENDING |
| RG-6 Q-CABLE SYSTEM CLOSURE | OPEN (2) | **CLEARED** (or 1 if the grounding doc does not exist) | — |
| RG-7 PROFESSIONAL RELEASE | OPEN (2) | **OPEN (1)** | ENGINEERING-REVIEW-PENDING |

**7 gates / 19 requirements → 4 gates / 5 requirements.**
After Ray renames the project: **3 gates / 4 requirements.**
Worst credible case (grounding doc unobtainable at exact-SKU scope):
**5 gates / 6 requirements.**

This lands on the directive's "approximately 3 gates / 4-5 requirements" without
forcing a count. **Every remaining requirement is defensible:** one operator
keystroke, one licensed structural judgement, two genuine physical measurements,
one PE signature.

### 4.3 What each survivor proves cannot be auto-resolved

- **PROJECT-NAME-NONPRODUCTION** — there is no derivable production name; the engine must not rename the user's project. (Or: N/A after identity re-sourcing.)
- **FRAMING-AUTHORITY-UNVERIFIED** — for an existing stick-framed residence with no truss drawing, member capacity is licensed judgement. Operator entry is observation by explicit ruling (`framingAuthority.ts:4-15,86,107-114`).
- **ROUTE-LENGTH-ESTIMATE** (feeder/service only) — no routed-conduit geometry exists in CAD; the physical path around obstructions is not derivable from module positions.
- **TAP-CONDUCTOR-LENGTH-PENDING** — the existing service's physical layout is not in any model; NEC 705.11(C) needs a real measurement.
- **ENGINEERING-REVIEW-PENDING** — a digest-bound PE approval. The engine must never fabricate it.

---

## §5 — Resolver-framework seam (the no-duplicate rule)

**Do not build a new framework. Extend the three abstractions that already exist.**

### Seam 1 — the async resolution stage: `resolveSnapshotAuthorityInputs`

`lib/permit/snapshot/authorityInputs.ts:70` · called once at
`app/api/engineering/permit/route.ts:1409` · threaded into
`buildPermitDesignSnapshot(input, cad, opts)` at `generatePermit.ts:1043-1065`.

This is already: one async chokepoint · one call site · purely additive opts ·
per-read try/catch · fail-soft to the blocker-firing default · digest-byte-identical
when unresolved.

**Extend it into `resolveSnapshotAuthority(input, deps)`** where `deps` is the DI
provider bundle (AHJ registry, property, climate hazard, document ingestion —
all `isConfigured()`-gated, all fixturable). Same fail-soft discipline; add the
`RequirementResolutionState` record per resolver.

**Two wiring gaps to close first:** `groundingDocumentEvidence` and
`framingEngineerReview`/`framingReviewDigest` are accepted by the build and
resolved by nobody. And `route.ts:218` (GET self-heal) calls `generatePermitHTML`
with **no** authority bundle — fix that asymmetry or a regenerated preview will
disagree with the POST artifact.

### Seam 2 — the clearance-evaluator contract

Already a de-facto interface across five modules:

```
evaluateX(ctx: XContext, evidence: XEvidence | null | undefined)
  => { cleared: boolean; missing: string[]; reasons: string[] }
```

- `evaluateRackingCapacityClearance` — `rackingAssembly.ts:161` (ctx `:135`, evidence `:107`)
- `evaluateCableExtensionClearance` — `procurementSufficiency.ts:74` (ctx `:51`)
- `pickVerifiedDocument` — `documents/registry.ts:257` (the pure DB-side twin)
- **variant shapes to normalise:** `resolveFramingCapacityAuthority` (`framingAuthority.ts:189`) returns `FramingCapacityAuthority | null`; `environmentalSourceVerified` (`environmentalAuthority.ts:86`) returns a bare `boolean`; `verifyGroundingDocumentApplicability` (`groundingAuthority.ts:201`) returns a domain verdict.

Every evidence object already carries the same verification quintet
(`verificationState === 'verified'`, `status === 'current'`, `archivedInRepo`,
`sha256`, a domain claim boolean) plus an applicability key match.

**`{cleared, missing[], reasons[]}` IS `RequirementResolutionState`'s core.**
Normalise the three variants onto it and add the five directive fields the shape
lacks: `resolutionMode`, `resolverId`, `confidence`, `retryability`
(`RETRYABLE | NON_RETRYABLE | REQUIRES_INPUT`), `lastResolutionAttempt` +
`lastResolutionResult` (`RESOLVED | FAILED | SKIPPED | NOT_ATTEMPTED`).
`missing[]`/`reasons[]` already serve as `requiredInputs` / `blockingReason`.

### Seam 3 — the invalidation ledger

`snapshot_digest_invalidations` (migration 114 `:63-82`: `project_id, digest,
snapshot_id, scope, engineering_approval_ref, reason, invalidated_by,
invalidated_at, superseded_at, superseded_by`). Written by
`reconcileEquipmentIdentity` (`reconcile.ts:173-180`, two scopes per
reconciliation); read by `listActiveInvalidations` (`:214-222`); consumed at
`authorityInputs.ts:102` → `build.ts:1329` → `projectAuthority.ts:209,251`.

**This is the lifecycle's invalidation half, already built.** The resolver
framework writes here when a resolution invalidates dependents; the
recompute/retry loop reads here to decide whether to re-run.

### Seam 4 — the registry's clearing contract

`deriveRequirementStatus` (`releaseGates.ts:685-691`): `resolved: true` **without**
a `resolutionAuditRef` stays OPEN. `NOT_APPLICABLE_AUDIT_PREFIX = 'NOT-APPLICABLE:'`
(`:677`).

**Binding on every auto-resolver:** flipping `resolved` requires writing an audit
reference naming the resolver, its inputs, its evidence, and its timestamp.
This single existing rule enforces the directive's "empty evidence / truthy flags
are never proof" for free — do not weaken it.

### The lifecycle, expressed on these seams

```
POST route
  └─ resolveSnapshotAuthority(input, deps)              ← Seam 1, extended
       1. AUTO_DERIVED pass   (equipment canon, designer, conduit fill,
                               Q-Cable topology, rail selection)
       2. persist results + evidence + audit refs        ← Seam 4
       3. write invalidations for affected dependents    ← Seam 3
       4. recompute affected engines
       5. AUTO_RETRIEVED pass (AHJ/codes, property, climate hazard,
                               manufacturer documents)
       6. persist retrieved authority + source evidence  ← Seam 4
       7. recompute; repeat 1-6 to stability (bounded, N ≤ 3)
  └─ buildPermitDesignSnapshot(input, cad, opts)         ← registry built LAST
  └─ validate → deepFreeze → render                      ← renderer consumes only
```

**Bounded loop:** the recompute is the expensive part. Iterate at most 3 times
and record `lastResolutionAttempt` per resolver so a non-converging resolver is
visible rather than silently looping. A requirement whose resolver was never
called must **not** be finalized as unresolved — that is a mandated test.

**Renderer discipline (WS-9):** delete the render-time
`getManufacturerAsset` / `evaluateDocumentApplicability` calls at
`compliancePages.ts:1212-1247`, `datasheetAppendix.ts:60-117`,
`structuralPages.ts:73-78`, `sheetComposition.ts:479`, `roof.ts:2058` and project
the snapshot's already-decided verdict instead.

---

## §6 — Implementation plan (campaign dependency order)

Ordering follows the directive: audit → framework → equipment → designer →
AHJ/code → environmental → electrical → Q-Cable → structural → gate lifecycle →
Braidon → compaction → validation → commit.

### AAC-1 · Resolver framework (build FIRST)
**Owns:** `lib/permit/snapshot/authorityInputs.ts` (→ resolver stage),
new `lib/permit/snapshot/resolution/` (mode enum, `RequirementResolutionState`,
lifecycle runner, provider DI bundle), `lib/permit/snapshot/types.ts` (state
records), `lib/permit/generatePermit.ts` (thread the bundle),
`app/api/engineering/permit/route.ts:218` (GET-path asymmetry).
**Normalises:** the three variant evaluators onto `{cleared, missing[], reasons[]}`.
**Wires:** the two dead sockets (`groundingDocumentEvidence`,
`framingEngineerReview`/`framingReviewDigest`).
**Migration:** none (resolution state rides in snapshot fields + `permit_input.json`).
**Tests:** 8 lifecycle cases incl. uncalled-resolver-cannot-finalize, bounded
loop, renderer-cannot-mutate.

### AAC-2 · Canonical equipment (WS-2) + designer (WS-6)
**Owns:** new `lib/permit/snapshot/resolution/equipmentCanon.ts`;
`lib/reconciliation/reconcile.ts` + `conflicts.ts` (revive the dead detector,
delete the inline duplicate at `build.ts:680-687`); `lib/system/selectedEquipment.ts`;
`lib/permit/snapshot/build.ts:680-687,1084`; new personnel-roles module;
`app/engineering/page.tsx` (role fields); `app/settings/page.tsx` (org defaults).
**Migration:** **NEW** — `personnel_roles` (org default + per-project override,
five distinct roles). Depends on 114 for the reconciliation audit (fail-soft).
**Clears:** #4, #18. Enables #5.
**Tests:** 7 equipment cases (two-active-selections still conflicts; superseded
cannot re-enter) + 6 designer cases (never populates EOR/PE).

### AAC-3 · AHJ/code (WS-3) + environmental (WS-4)
**Owns:** `lib/jurisdictions/ahjRegistry.ts:83` (retain IBC/IRC/IFC — do not
discard); `AhjRecord` extension or a new `CodeAdoptionRecord`;
`lib/permit/snapshot/codeAuthority.ts:148-164,199-201,212-213,242-251`;
new `lib/providers/climateHazard/` (DI, ASCE 7 Hazard Tool);
`lib/enrichment/propertyEnricher.ts` (permit-path adapter);
`lib/permit/snapshot/build.ts:1001` (`_projectAuthorityVerified`);
`app/api/engineering/permit/route.ts:652-717` (stop the sourceless table from
winning); renderer literal sweep (`sheetComposition.ts:337,393-394,532`,
`templates/fence.ts:528,1211`).
**Migration:** requires **113 run**. Env: `AHJ_REGISTRY_TOKEN` (add to
`.env.example`), climate-hazard key.
**Clears:** #1, #2, #6.
**Tests:** 7 AHJ (sourceless default cannot clear; utility ≠ AHJ proof) +
6 environmental (empty evidence cannot clear; coordinate change invalidates).
Provider DI fixtures mandatory; label fixture-proof vs live-proof.

### AAC-4 · Electrical closure (WS-7) + Q-Cable engine (WS-5)
**Owns:** `lib/permit/snapshot/computeSystemProjection.ts:30-32,53-58`;
`lib/permit/snapshot/build.ts:394,401,1076-1079`;
`lib/equipment/trunkCable.ts` (reach the full catalog);
`lib/data/equipment/trunk-cable-enphase.json` (consume);
`lib/bom/deriveRunLengths.ts` (topology object);
`lib/permit/snapshot/procurementSufficiency.ts:35-49` (real option evaluation);
`lib/documents/registry.ts:538-561` (**the missing `out.push`**).
**Migration:** 113 for the extension/grounding documents.
**Clears:** #14, #16; narrows #13. #17 attempted (may fail honestly).
**Tests:** 12 Q-Cable (sufficient-in-aggregate-but-invalid-per-branch; rebranch
resolution; **no Braidon constants in production code**).

### AAC-5 · Structural separation (WS-8) + gate lifecycle (WS-9)
**Owns:** `lib/permit/snapshot/rackingAssembly.ts:446-463,556-569`
(split/merge the one-`if`-two-codes; populate `railSku`/`mountSku`);
`lib/permit/snapshot/structuralAuthority.ts:830-840,850-874,881-889`
(remove the `_capGated` echo; split the selection leg);
`lib/mounting-hardware-db.ts` (rail/splice part numbers);
`lib/manufacturer-assets-db.ts` (alias store + registry-facts wiring);
`lib/permit/snapshot/framingAuthority.ts` (prescriptive-span tier);
`lib/permit/snapshot/releaseGates.ts` (declaration corrections);
`lib/permit/snapshot/build.ts:1261-1263` (make ENGINEERING-REVIEW conditional);
the five renderer files that re-decide applicability.
**Migration:** **NEW** — engineering-review/approval record (digest-bound), so
#19 becomes clearable. Plus 113 for the RT-MINI PE letter + alias.
**Clears:** #8, #9, #10, #11, #12.
**Tests:** anti-vacuity — a document naming a different version cannot clear; a
selection-typed blocker cannot be satisfied by a document.

### AAC-6 · Braidon acceptance + compaction (WS-10)
**Preconditions:** Ray runs 113 then 114 via the governed console; the live
project row is pinned (§3.2); `AHJ_REGISTRY_TOKEN` provisioned; stale-Vercel-deploy
check before any review regen (standing rule).
**Compaction (ONLY after automation works):** keep PV-0 (compressed), PV-1,
PV-1B, PV-3, PV-4C, PV-4C.1, E-1, PV-4A, PV-4B, PV-5 merged with PV-6, one
compact major-equipment schedule when required, PE-1 when applicable. Remove from
the core set: RS-1/.1/.2, SCHED-2/3/4, APP-A, empty CERT. Move DS-1..3 to a
manufacturer attachment appendix. Owns `lib/permit/sheetManifest.ts:109-151`,
`lib/permit/plansetManifest.ts`, the RS-1 sections.
**Invariant:** removing a page must never remove a requirement from the registry
(mandated test) — the RGM's `RG-UNMAPPED` sink already fails closed if it does.

### AAC-7 · Validation + closure doc + commit
Targeted resolver tests · failure-mode · anti-vacuity · DB/migration tests ·
typecheck · lint · full suite · production build · live Braidon regeneration ·
before/after gate + requirement + sheet counts · evidence per auto-cleared
requirement · exact evidence per remaining blocker.
Closure doc: `docs/BRAIDON-AUTOMATION-AUTHORITY-CLOSURE.md`. Separate commit on
`dev`. **Never report unexecuted tests as passing.**

### Migration summary

| Migration | Status | Needed by |
|---|---|---|
| 113 `manufacturer_document_registry` | written, **NOT RUN** | AAC-3, AAC-4, AAC-5 (9 of 19 requirements) |
| 114 `equipment_reconciliation_audit` + `snapshot_digest_invalidations` | written, **NOT RUN** | AAC-2 (audit trail; ledger already read fail-soft) |
| **NEW** personnel roles | to write | AAC-2 (#18) |
| **NEW** engineering-review approval record | to write | AAC-5 (#19 clearable) |

Every resolver depending on 113/114 must fail soft to the blocker-firing state so
the campaign is verifiable **before** Ray runs them, per the `authorityInputs.ts`
precedent.

---

## §7 — Defects found in passing (fix, do not work around)

1. `computeSystemProjection.ts:53-58` + `:30-32` + `build.ts:401` — a computed
   NEC Ch.9 conduit fill is discarded by three field-name mismatches, then
   re-reported as a field-verification blocker. **The single highest-value fix in
   the campaign.**
2. `documents/registry.ts:538-561` — `resolveCableExtensionSolutions` declares
   `const out: CableExtensionSolution[] = []`, awaits `findVerifiedDocument`,
   `continue`s when it is null, and **never calls `out.push(...)` on any path**
   (the trailing comment says "Today: skip (fail-closed)"). It returns `[]` under
   all inputs — verified by direct read. The blocker it gates is therefore
   unclearable through any wired path.
3. `rackingAssembly.ts:446-463` — one `if (!rtCleared)` emits two codes with two
   different declared finding types.
4. `structuralAuthority.ts:850-874` — `FASTENER-ASSEMBLY-UNVERIFIED` is documented
   as independent and implemented as a pure echo of `_capGated`.
5. `ahjRegistry.ts:83` — `BuildingCode`, `FireCode`, `ResidentialCode` are received
   and discarded; they are exactly what RG-1 is blocked on.
6. `lib/reconciliation/conflicts.ts` — `detectConflictFromSources` /
   `collectModuleConflicts` have zero production callers; `build.ts:680-687`
   re-implements them inline.
7. `manufacturer-assets-db.ts:330-352` — the `AUTHORITATIVE` verdict is unreachable
   because all seven call sites pass `null` for `registryFacts`.
8. `DocumentApplicabilityAlias` (`manufacturer-assets-db.ts:174`) — a type with no
   store and no caller.
9. `equipmentProjection.ts:186-215` — `MODULE-EXACT-DATASHEET-PENDING` never
   compares the selected wattage against the parsed range, and a module with **no**
   datasheet emits nothing.
10. `generatePermit.ts:1044` — `designVersionId` is never passed, so
    `snapshot.meta.designVersionId` is always null; with duplicate live project
    rows this removes the only post-hoc way to identify the generating design.
11. `route.ts:218` — the GET self-heal path regenerates with no `snapshotAuthority`,
    silently using fail-soft defaults.
12. Renderer-side authority determination survives in `compliancePages.ts:1212-1247`,
    `datasheetAppendix.ts:60-117`, `structuralPages.ts:73-78`,
    `sheetComposition.ts:479`, `roof.ts:2058`.
</content>
</invoke>
