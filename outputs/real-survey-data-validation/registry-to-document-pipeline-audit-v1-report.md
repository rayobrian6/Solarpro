# Registry-to-Document Pipeline Audit v1 Report

## Scope and method

This audit maps the current flow from survey truth, canonical evidence, provenance, traceability, and Engineering Requirement Registry v1 into the document and engineering pipelines in the `dev` branch after commit `d5f0a82 Add engineering requirement registry v1`. This is an architectural flow audit and normalization report only. No OpenCV, OCR, YOLO, semantic inference, image-byte inspection, CAD generation, or engineering sizing changes were implemented.

The audit inspected the survey evidence foundation, engineering requirement registry, engineering bridge, permit generator, validation page, plan-set route, SLD routes, BOM route, engineering calculation/report routes, proposal routes, drafting/CAD render contracts, and admin/project summary surfaces. The key inventory artifacts used during the audit were generated under `outputs/registry_doc_audit/` during the local review.

## Executive classification

The current repository has one mature registry-aware document surface: permit validation. The registry is also exposed through the engineering survey evidence adapter and the survey detail UI. Most other engineering and document generators remain detached from the registry and are driven by design snapshots, request bodies, computed system models, CAD models, project physical data, stored proposal snapshots, or renderer-local defaults. This is expected for a first registry layer, but it means the registry is not yet the common document dependency graph.

| Target | Classification | Evidence influence today | Registry/provenance status |
| --- | --- | --- | --- |
| Permit route `/api/engineering/permit` | Partially registry-driven | Uses project survey context, canonical manifest when present, engineering survey evidence, and registry-backed validation page; still enriches from legacy physical survey pipeline and design body | Registry reaches `surveyEvidence` and VAL-1 validation; provenance does not bind every sheet |
| Permit validation page `lib/permit/sections/validationPage.ts` | Fully registry-driven for evidence readiness display | Renders requirement status, missing analysis, provenance, traceability, duplicate hygiene, and inactive future flags | Best current consumer of registry and provenance |
| Permit plan-set sheet rendering `generatePermitHTML()` | Partially registry-aware but mostly CAD/design driven | Receives `input.surveyEvidence`; most sheets read canonical permit input, CAD model, BOM, SLD, and project/design data | Registry appears mainly on validation sheet, not as preconditions for all sheet content |
| Standalone plan-set route `/api/engineering/plan-set` | Detached from evidence system | Builds `ComputedSystem`, `PermitSystemModel`, and sheet inputs from request/project/design values | No `canonicalManifest`, `requirementEvaluation`, or provenance consumption found |
| SLD route `/api/engineering/sld` | Legacy/design-model driven | Uses request body, sizing engine, string config, `computeSystem`, and `PermitSystemModel` | No registry or evidence provenance bindings found |
| SLD PDF route `/api/engineering/sld/pdf` | Legacy/body-driven renderer | Converts request/build input to `SLDProfessionalInput`, renders SVG/PDF | No registry or canonical evidence consumption found |
| BOM route `/api/engineering/bom` | Legacy/body/catalog/structural-profile driven | Uses body values, V4 BOM engine, sizing result adapters, structural profiles, distributor pricing | No registry, canonical evidence, or requirement provenance consumption found |
| Permit BOM integration | CAD/design driven | `generateBOMForPermit(input, cad)` uses permit input and CADModel | Not registry-bound; fallback BOM paths are explicit but not evidence-linked |
| Engineering calculations `/api/engineering/calculate` | Legacy/body-driven | Runs electrical and structural engines from request body and defaults/fallbacks | No registry or canonical evidence consumption found |
| Engineering report `/api/engineering/report` and `/api/engineering/generate` | Legacy design snapshot + physical-data driven | Uses layout/design snapshot and `project_physical_data`; optional enriched survey photo counts appear as report section | No registry evaluation or canonical evidence provenance in report output |
| Proposal generation `/api/proposals` and proposal PDF | Detached from survey evidence | Uses project snapshot, layout, production, pricing snapshot, utility rate, canonical proposal builder | No registry, canonical evidence, or survey provenance influence found |
| Document rendering core | Mixed | Permit validation renders registry; drafting renderer uses `RenderContext` with `CADModel` and optional utility/engineering data | Render context has no evidence/provenance slot today |
| Admin/project summaries | Mostly detached; topography page documents pipeline | Project/admin pages show stages and topography metadata; survey detail UI shows registry | No broad registry consumption in admin summaries beyond survey/topography documentation |
| Future CAD pathways | Deterministic CAD abstractions exist but not registry-bound | `CADModel`, `RenderContext`, `buildCADFromSurvey`, and drafting validation provide future interfaces | Missing evidence-to-layout and requirement-to-geometry bindings |

Legend: Fully registry-driven means the current output is directly derived from `EngineeringRequirementEvaluationSummary`. Partially registry-driven means the registry is attached or rendered somewhere but does not govern the whole pipeline. Legacy field-driven means project/layout/body/physical-data fields drive output. Raw survey/photo dependent means normalized survey photo counts or legacy photo arrays can influence output. Detached means no current evidence/registry/provenance dependency was found.

## Full pipeline mapping

### Survey ingestion

Survey ingestion currently begins with survey application data written to `site_surveys`, `site_survey_files`, and legacy `project_physical_data`. The immutable audit/history layer consists of those survey rows, raw upload file records, timestamps, labels, filenames, file URLs, survey technician metadata, and physical-data fields. The current system also has legacy helpers such as `fromPhysicalData()`, `normalizeSurvey()`, and `enrichSurvey()` that can reconstruct an enriched survey from `project_physical_data` and project file photos.

Inputs are site survey rows, site survey file rows, project physical data rows, project file photos, and project identifiers. Outputs are raw survey payloads, normalized site survey structures, enriched survey structures, and later canonical evidence manifests. The truth source at this stage is audit/history, not downstream engineering truth. Fallback behavior exists: when canonical project evidence hygiene is not available, `collectEngineeringSurveyEvidence()` can build a manifest from normalized survey photos and labels. That fallback is explicitly labeled as `legacy_raw_photos_fallback`, but it is still a raw-photo-derived bridge and should remain transitional.

Legacy assumptions include photo slot/category labels being meaningful, project physical data being suitable for field-level engineering context, and enriched survey photo counts being useful for report visibility. Raw upload leakage risk exists wherever downstream documents use raw photo count or photo category count as a readiness signal rather than as audit-only context. The current registry work reduced this in permit validation, but engineering reports still expose enriched photo counts detached from canonical provenance.

### Canonical evidence normalization

Canonical normalization is represented by `SurveyEvidenceManifest`, project hygiene in `buildProjectSurveyEvidenceHygiene()`, and `evidenceHygiene.canonicalManifest`. Duplicate collapse is deterministic and metadata based. The canonical manifest produces canonical evidence representatives, coverage, required missing categories, warnings, and bridge summaries. Project-level hygiene also keeps sessions and duplicate groups.

Inputs are survey file metadata, survey sessions, raw upload descriptors, and existing normalized/enriched survey context. Outputs are `canonicalManifest`, duplicate groups, session summaries, traceability bundles, and canonical evidence item records. The truth source for engineering evidence is `evidenceHygiene.canonicalManifest` when available. Fallback behavior remains the legacy raw-photo fallback in `collectEngineeringSurveyEvidence()` when no canonical manifest is passed. Duplicated logic exists in older photo/category count summaries and field-data report sections that do not consume the canonical manifest.

Unused registry outputs at this stage include requirement-level usage domains, permit usage descriptors, failed metadata rules, and requirement-level provenance records; these are available but not carried to most non-validation document generators.

### Provenance generation

Provenance is built by `buildSurveyEvidenceTraceability()` and preserved through `ProjectSurveyEvidenceHygieneManifest`. The registry bridge was updated to accept a traceability override so duplicate group provenance survives into requirement evaluation. Provenance records identify canonical evidence ids, originating survey ids, duplicate status, canonical representative status, and requirement traceability details.

Inputs are the canonical manifest, duplicate groups, sessions, and truth source label. Outputs are `SurveyEvidenceTraceabilityBundle`, `CanonicalEvidenceProvenanceRecord`, `RequirementEvidenceTraceabilityRecord`, and survey lineage records. The truth source is the canonical evidence manifest plus deterministic lineage records. Fallback behavior is a traceability bundle over whichever manifest is provided, including the explicit legacy fallback manifest.

The main provenance survival gap is not inside the survey evidence layer; it is downstream. Provenance is visible in permit validation and survey UI, but not in standalone SLD, BOM, plan-set, proposal, engineering calculation, or engineering report artifacts as a first-class document provenance object.

### Requirement registry evaluation

`buildEngineeringRequirementEvaluation()` evaluates all registry definitions from canonical evidence plus traceability. It normalizes satisfied, missing, partially satisfied, blocked, informational, inactive, and all requirements. It also carries reasoning paths, failed metadata rules, duplicate-collapsed status, canonical evidence ids, originating surveys, provenance records, and traceability records.

Inputs are `canonicalManifest` and `SurveyEvidenceTraceabilityBundle`. Outputs are `EngineeringRequirementEvaluationSummary` and individual requirement evaluations. The truth source is `engineering_requirement_registry_v1`, based on canonical evidence and provenance only. Fallback behavior is limited to whatever manifest the caller supplies; if the caller supplies a legacy fallback manifest, the evaluator still behaves deterministically and labels the evidence truth source through the surrounding adapter. Future capability flags are informational only.

Unused registry outputs across document pipelines include requirement-level `permitUsage`, `engineeringUsage`, `readinessImpact`, `missingSeverity`, `failedMetadataRules`, `confidencePolicy`, and requirement provenance. Permit validation renders many of these; other generators do not.

### Engineering bridge

`buildSurveyEvidenceEngineeringBridge()` now exposes registry evaluation and derives bridge readiness/completeness/confidence from it. It can accept an existing traceability bundle, preventing duplicate provenance loss. `collectEngineeringSurveyEvidence()` consumes the bridge and exposes `requirementEvaluation` to permit input.

Inputs are canonical manifest, optional traceability override, duplicate groups, sessions, and enriched survey physical fields. Outputs are engineering evidence counts, readiness, completeness, blockers, warnings, `manifestV1`, traceability, and requirement evaluation. Truth source is canonical manifest when available. Fallback behavior remains explicit legacy raw photo fallback when canonical manifest is absent.

Legacy assumptions still present include field evidence summaries such as roof geometry, electrical data, structural data, and photo arrays being useful for permit/CAD assumptions. The bridge itself is registry-aware, but document consumers must choose to use it.

### Permit generation

`/api/engineering/permit` is the most registry-connected generator. It loads project data, backfills client profile data, checks pipeline guard, fetches aerial data, optionally loads stored SLD SVG, then runs survey enrichment. During survey enrichment it obtains `getProjectSurveyContext(projectId)`, extracts `evidenceHygiene.canonicalManifest`, calls `collectEngineeringSurveyEvidence(enriched, { canonicalManifest, evidenceDuplicateGroups, sessions })`, attaches `enrichedBody.surveyEvidence`, then calls legacy `permitIntegration(enriched)` to patch survey fields into permit input where allowed.

`generatePermitHTML()` then builds canonical permit input, runs the existing deterministic CAD engine, derives run lengths, builds a render context, optionally injects BOM, assembles sheets, and passes `input.surveyEvidence` to the validation page. The validation page renders registry status, missing analysis, provenance, traceability, duplicate hygiene, and inactive flags.

Inputs include permit body, project profile, layout/design data, stored SLD, aerial roof data, survey physical data, canonical evidence hygiene, and registry-derived engineering survey evidence. Outputs include saved `permit_planset.html`, optional PDF, sheet HTML, validation summary, and project file artifacts. Truth sources are mixed: CADModel for geometry, canonical permit input for plan-set fields, `surveyEvidence.requirementEvaluation` for evidence readiness display, and stored project files for saved permit/SLD. Fallback behavior includes non-critical survey enrichment failure, no evidence warning rendering, aerial fetch fallback, stored SLD fallback message, BOM generation fallback, and legacy survey field patches.

The primary drift finding is that registry status is visible on VAL-1 but does not yet provide explicit requirement-to-sheet binding for PV-1/PV-2/PV-3/SCHED/E-1. A permit can render with missing or partial evidence as long as other validation gates pass; that behavior may be acceptable, but the output should eventually show document provenance per sheet.

### SLD generation

`/api/engineering/sld` uses request body values, selected brand/inverter data, sizing engine output when available, string configuration, `computeSystem()`, and `PermitSystemModel`. It renders through `renderSLDProfessional()`. `/api/engineering/sld/pdf` builds a similar renderer input and exports SVG/PDF.

Inputs are request body fields, topology, selected equipment, module counts, string counts, interconnection fields, and computed system models. Outputs are SLD SVG, optional PDF, and response metadata. Truth source is the request/computed system model path, not canonical survey evidence. Fallback behavior includes body-value fallback when sizing is not available, default manufacturer/model choices based on topology, computeSystem fallback values, and SVG fallback if PDF generation fails.

No registry or canonical evidence consumption was found. This means current SLDs do not know whether the main service panel, utility meter, disconnect, subpanel, or battery-location evidence requirements are satisfied. They also do not carry evidence provenance for electrical assumptions.

### Standalone plan-set generation

`/api/engineering/plan-set` is a separate plan-set route that builds a permit-grade PDF from engineering data. It uses `computeSystem()`, `PermitSystemModel`, sheet builders under `lib/plan-set`, AHJ lookup, fire setbacks, equipment schedule enrichment, and PDF conversion. It is not the same as `generatePermitHTML()` under `lib/permit`, although both produce plan-set-like documents.

Inputs are request body/project/design values, layout values, computed system inputs, AHJ/fire setback data, and equipment/BOM enrichment. Outputs are plan-set HTML/PDF project files. Truth source is the computed system model and route body. Fallback behavior includes compute-system failure fallback values, display fallbacks such as “Per plan,” and V4 equipment enrichment fallback.

No registry, canonical manifest, survey evidence, or provenance consumption was found in this standalone route. It is detached from the new evidence system and should be treated as legacy/design-model driven until bridged.

### BOM generation

`/api/engineering/bom` runs `generateBOMV4()`, structural BOM derivation, sizing result adapters, EcoFlow fallback behavior, distributor pricing, CSV/Markdown formatting, and JSON response assembly. Permit BOM integration separately calls `generateBOMForPermit(input, cad)` from the permit generator.

Inputs are request body system fields, equipment ids, module counts, string counts, topology, structural system type, sizing results, catalog data, distributor pricing overrides, and CADModel in the permit integration path. Outputs are BOM line items, pricing summaries, CSV/Markdown/JSON, and permit schedule rows. Truth source is body/catalog/sizing/CAD profile logic, not survey evidence. Fallback behavior includes catalog fallback, structural profile fallback, EcoFlow fallback, unpriced BOM fallback, and no-BOM rendering messages.

No registry or canonical evidence consumption was found. Requirement drift exists because equipment/BOM readiness can be produced even if requirement registry says service equipment evidence is missing or partial. The current BOM pipeline has no requirement-to-component provenance.

### Engineering calculations

`/api/engineering/calculate` runs electrical and structural calculations from request body inputs, string configuration, jurisdiction helpers, topology guards, and structural engine fallbacks. The user explicitly required no engineering sizing changes, and none were made.

Inputs are request body electrical/structural values, jurisdiction-derived environmental values, selected equipment/topology, and defaults. Outputs are calculation results and warnings. Truth source is request body plus calculation engines. Fallback behavior includes safe defaults, string generation warnings, and structural fallback warnings.

No registry, canonical evidence, or provenance consumption was found. Requirement drift exists if calculations proceed based on request/body field values without evidence satisfaction for relevant electrical/structural requirements. This audit does not recommend blocking calculations now; it recommends recording evidence dependency metadata around calculations later.

### Engineering report generation

`/api/engineering/report` and `/api/engineering/generate` build `DesignSnapshot` from project/layout and generate an `EngineeringReport`. The generate route can run legacy site survey enrichment and pass `EnrichedSiteSurvey` to `generateEngineeringReport()`. The report generator uses project physical data for electrical/structural details and optionally creates a site photos section from `enrichedSurvey.derived.photoCounts`.

Inputs are project, layout, project physical data, optional enriched survey, and design snapshot. Outputs are engineering report JSON/artifacts. Truth source is design snapshot and physical-data fields. Fallback behavior includes default panel/inverter specs, typical structural defaults when no survey data exists, and optional omission of site photos when no photo counts exist.

This pipeline is raw-photo-count aware but not canonical-evidence aware. The site photos section is informational, but it is detached from canonical evidence ids, duplicate collapse, and requirement provenance. That is a raw upload leakage risk if anyone interprets the count as engineering completeness.

### Proposal generation

Proposal generation stores project snapshots with layout, production, pricing, and utility rate. Proposal PDF generation builds a canonical proposal from the saved project snapshot and renders proposal HTML/PDF. Proposal status routes update project stages.

Inputs are project/client/layout/production/cost data, pricing snapshot, utility rate, proposal row, branding, and saved proposal data JSON. Outputs are proposal rows, proposal HTML/PDF, share tokens, and status updates. Truth source is the proposal creation snapshot and canonical proposal builder, not survey evidence. Fallback behavior includes graceful use of cached proposal data, pricing snapshot fallback, inferred panel count from system size, and HTML fallback when PDF export fails.

No registry, canonical evidence, or provenance consumption was found. Survey evidence does not materially influence proposals today except indirectly if upstream layout/project values were manually or separately updated.

### Document rendering

Document rendering is split across permit HTML/PDF generation, standalone plan-set sheet builders, SLD renderer, proposal renderer, engineering artifact builders, and drafting renderers. Permit validation is registry-aware. Drafting renderers consume `RenderContext`, which currently contains `CADModel`, optional bill insights, and optional engineering data. `RenderContext` does not contain evidence provenance or requirement evaluation.

Inputs vary by renderer. Outputs are HTML, SVG, PDF, CSV, Markdown, and project files. Truth sources are renderer-specific: CADModel for drafting geometry, PermitSystemModel for SLD/plan-set electrical displays, proposal canonical data for proposal pages, and registry evaluation only for permit validation.

The missing abstraction is a document-level provenance envelope that every renderer can carry without changing engineering calculations.

### Future CAD pathways

The repository already has deterministic CAD and drafting abstractions: `generateCADLayout()`, `CADModel`, `adaptCADToDrafting()`, `RenderContext`, `renderPlanSet()`, and plan-set validation. There is also `buildCADFromSurvey()`, which bridges enriched survey geometry and field data into CAD input overrides, but it is based on `EnrichedSiteSurvey`, not canonical evidence or registry requirements.

Current systems can eventually support evidence-informed CAD and plan-set automation, but not yet in a registry-complete way. Missing pieces include canonical geometry evidence interfaces, requirement-to-geometry bindings, document provenance, evidence-to-layout relationships, and a typed dependency graph that says which document fields rely on which requirements and canonical evidence ids.

## Registry consumption audit by target

### Permit routes

Classification: Partially registry-driven.

`/api/engineering/permit` attaches registry-backed `surveyEvidence` when survey context exists. The validation sheet is registry-driven, but sheet generation itself is still powered by canonical permit input, CADModel, stored SLD, BOM, and legacy survey field patches. `GET /api/engineering/permit` serves saved permit HTML/PDF and performs version staleness checks; it does not recompute registry state.

### SLD routes

Classification: Legacy field-driven.

SLD routes consume request body, topology/sizing results, `computeSystem()`, `PermitSystemModel`, and renderer input. No registry, canonical evidence, or provenance references were found.

### Plan-set routes

Classification: Detached from evidence system for standalone `/api/engineering/plan-set`; partially registry-aware for permit plan-set via validation sheet.

The standalone plan-set route does not consume survey evidence. The permit plan-set generated by `generatePermitHTML()` can carry `surveyEvidence`, but most sheets do not bind their content to registry requirements.

### BOM routes

Classification: Legacy field-driven.

BOM route and permit BOM integration use request/system/CAD/catalog/sizing inputs. They do not consume registry requirements or evidence provenance.

### Engineering readiness

Classification: Partially registry-driven.

The survey evidence bridge now derives readiness/completeness/confidence from `EngineeringRequirementEvaluationSummary`. However, other engineering routes can still calculate, report, render SLDs, and generate BOMs independently from request/design data. Engineering readiness is registry-driven in the survey evidence domain, not globally enforced across all engineering pipelines.

### Proposal generation

Classification: Detached from evidence system.

Proposals are built from project snapshots, pricing, production, and layout values. No registry consumption found.

### Validation pages

Classification: Fully registry-driven for survey evidence validation.

`pageValidationSummary()` is the strongest consumer. It renders registry status, missing requirements, provenance, traceability, canonical evidence, duplicate hygiene, and inactive future flags. It also explicitly labels fallbacks and avoids manufacturing bridge counts from raw duplicated photo arrays.

### Report generators

Classification: Legacy field-driven/raw survey-photo aware.

Engineering report generation uses design snapshot and project physical data, with optional enriched survey photo counts. It does not consume canonical manifest or registry evaluation.

### Admin/project summaries

Classification: Mostly detached, with survey UI registry-aware.

Survey detail page renders canonical evidence hygiene, traceability, and registry evaluation. Topography/admin pages document the pipeline conceptually. General admin project summaries do not broadly consume registry outputs.

## CAD/plan-set readiness audit

Current systems are structurally capable of future evidence-informed CAD and evidence-informed plan-set automation because they already separate survey enrichment, CAD input bridging, CAD model solving, drafting render context, and sheet rendering. However, the evidence-to-document chain is incomplete.

Missing abstractions include a canonical geometry evidence layer that maps roof planes, meters, service equipment, disconnects, subpanels, battery locations, and structural access requirements to typed geometry or layout dependencies. `buildCADFromSurvey()` can construct CAD inputs from enriched survey fields, but it does not know which canonical evidence ids or registry requirements support each override. `RenderContext` can carry CAD and optional engineering data, but it has no document provenance or evidence dependency map. Plan-set validation validates CAD shape, not evidence sufficiency. Permit sheets do not declare which requirements support each visible section. BOM items do not link back to evidence or requirements. SLD electrical assumptions do not cite canonical service-equipment evidence.

The next deterministic layer should not generate CAD from images. It should define typed evidence-to-layout relationships, such as `RequirementDocumentBinding`, `DocumentEvidenceProvenance`, `EvidenceBackedGeometryInput`, and `EngineeringDependencyGraph`. These would allow CAD and documents to cite canonical evidence without adding image processing or changing sizing logic.

## Requirement drift audit

The following drift points were identified.

Hardcoded engineering assumptions remain in `designSnapshot.ts`, engineering report generation, SLD routes, calculation routes, BOM route fallbacks, and plan-set display fallbacks. Examples include default panel/inverter specs, default roof/system assumptions, default topology manufacturer/model selection, wind speed default behavior, body-value fallbacks, and structural report defaults. These may be reasonable product defaults, but they are not registry-scoped requirement decisions.

Requirement logic bypasses the registry in standalone plan-set generation, SLD generation, BOM generation, calculation routes, proposal generation, and engineering report generation. These routes can proceed without checking `requirementEvaluation.readiness`, `blockedRequirements`, or requirement provenance.

Document generation can infer readiness independently. Permit validation is registry-aware, but routes such as `/api/engineering/plan-set`, `/api/engineering/sld`, `/api/engineering/bom`, `/api/engineering/calculate`, `/api/engineering/report`, and proposal PDF generation do not use registry readiness as a dependency or document note.

Category assumptions are duplicated in legacy photo count sections, site survey enrichment, engineering report site photos, plan-set field fallbacks, and permit survey field evidence rows. The canonical registry now owns requirement semantics, but category counts still appear in some reports and UI surfaces as separate summaries.

Registry outputs are ignored by most generators. The unused outputs include `permitUsage`, `engineeringUsage`, `readinessImpact`, `missingSeverity`, `confidencePolicy`, `failedMetadataRules`, requirement-level canonical evidence ids, and provenance records.

## Truth-boundary audit

The canonical evidence truth boundary is mostly preserved in the registry and permit validation path. `evidenceHygiene.canonicalManifest` is used as downstream engineering truth when available, duplicate groups are preserved through traceability override, and raw upload counts are labeled as audit-only in validation displays.

Raw uploads remain audit/history in the canonical evidence layer, but there are transitional leakage risks. `collectEngineeringSurveyEvidence()` can build a legacy fallback manifest from normalized survey photos when no canonical manifest is supplied. This fallback is explicit and labeled, not silent. Engineering report generation can display enriched survey photo counts without canonical evidence ids. Permit route logs raw photo count for audit. Survey detail UI may display raw files alongside canonical hygiene as history. These are acceptable if kept visibly labeled, but they should not become readiness inputs outside the registry.

Provenance survives into permit validation and survey UI. Provenance does not yet survive into SLD, BOM, standalone plan-set, proposal, engineering report, or calculation artifacts as a document-level envelope. No document generator was found silently using raw duplicated photo counts to inflate registry readiness after the previous registry work; existing permit validation tests already cover this behavior.

## Tests decision

No new regression tests were added for this audit because no runtime code path was changed and no new dangerous silent truth-boundary violation was introduced by this task. The audit did identify architectural drift and disconnected generators, but those are documented findings rather than newly introduced behavior. Existing focused tests already cover the most important known duplicate/raw-count hazard in permit validation: raw duplicated photo arrays do not manufacture canonical bridge counts.

## Future deterministic architecture recommendations

The next layer should be a deterministic document provenance and dependency architecture, not AI/CV/CAD automation.

Introduce a `DocumentProvenanceBundle` that can be attached to every generated artifact. It should include project id, document type, generator version, canonical evidence manifest id or generated timestamp, registry evaluation summary id or hash, requirement ids consumed, canonical evidence ids cited, fallback labels, and unsupported/missing dependency notes.

Introduce `RequirementDocumentBinding` definitions mapping registry requirements to document sections. For example, `main_service_panel` and `utility_meter` should bind to SLD interconnection/service sections, electrical permit validation, and equipment schedule assumptions; `roof_overview` should bind to site/array plan context; `structural_access` and `attic_access` should bind to structural pages and review warnings.

Introduce an `EngineeringDependencyGraph` that records field-level dependencies without changing calculation logic. A calculation result, BOM line item, SLD label, or plan-set sheet row should be able to say which input fields, requirement ids, and canonical evidence ids supported it, or explicitly state that it was design-model/default driven.

Extend `RenderContext` additively with optional `documentProvenance` and `requirementBindings`. Renderers should not calculate registry status themselves; they should only render already-computed deterministic provenance and bindings.

Introduce `EvidenceBackedGeometryInput` for future CAD pathways. This should map survey-derived geometry fields to canonical evidence ids and registry requirements. It must not inspect image bytes or infer geometry from images. It should only carry typed geometry submitted through deterministic survey fields or future external worker outputs that have already been normalized into canonical evidence.

Add route-level audit guards that emit warnings, not blockers, when major generators run detached from registry state. This keeps current product behavior stable while making evidence disconnection visible.

Avoid refactoring entire pipelines until a document dependency graph proves which fields need registry bindings. The first implementation should be additive metadata and reports, not calculation or rendering rewrites.

## Validation status

This report and the companion flow map were created as markdown audit deliverables. No focused regression tests were added because no runtime code changed and no new dangerous truth-boundary violation was introduced. `npm run type-check` passed with exit code `0`. `npm run build` passed with exit code `0`. The prohibited-boundary scan found only explicit audit statements and future-boundary language confirming that OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, perceptual hashing, and engineering sizing changes were not introduced.
