# Registry-to-Document Pipeline Flow Map v1

## Flow map overview

This document maps the current deterministic flow from survey ingestion through canonical evidence, provenance, registry evaluation, engineering bridge, document generators, and future CAD pathways. It is a flow audit only. It does not introduce OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, or engineering sizing changes.

## Stage 1: Survey ingestion

| Field | Current flow |
| --- | --- |
| Inputs | `site_surveys`, `site_survey_files`, `project_physical_data`, project files/photos, survey technician metadata, timestamps, file labels, filenames, file URLs |
| Outputs | Raw survey payloads, normalized survey payloads, enriched survey payloads, physical field summaries, raw photo/file history |
| Truth source | Immutable audit/history layer only; not downstream engineering truth |
| Fallback behavior | `fromPhysicalData()` can rebuild survey context from legacy `project_physical_data` and project file photos; downstream adapter can build legacy raw-photo fallback manifest if no canonical manifest is supplied |
| Legacy assumptions | Photo labels/slot keys imply useful categories; physical data fields can patch permit inputs; enriched photo counts can summarize report photo availability |
| Duplicated logic | Photo category counting exists outside canonical evidence registry; physical survey enrichment can separately derive permit patches |
| Unused registry outputs | All registry outputs are unavailable at this stage until canonical manifest/provenance are built |
| Raw upload leakage risks | Photo counts and photo category counts may be mistaken for engineering readiness if not explicitly labeled audit/history |

## Stage 2: Canonical evidence normalization

| Field | Current flow |
| --- | --- |
| Inputs | Survey file metadata, survey sessions, raw upload descriptors, project id, survey ids, timestamps, labels, duplicate-group candidates |
| Outputs | `SurveyEvidenceManifest`, `ProjectSurveyEvidenceHygieneManifest`, `evidenceHygiene.canonicalManifest`, duplicate groups, session summaries, coverage, warnings |
| Truth source | `evidenceHygiene.canonicalManifest` is downstream engineering evidence truth when present |
| Fallback behavior | `collectEngineeringSurveyEvidence()` builds a `legacy_raw_photos_fallback` manifest only when no canonical manifest is provided |
| Legacy assumptions | Older consumers may still expect photo arrays/categories instead of canonical representative evidence |
| Duplicated logic | Category summaries and photo counts can still be computed outside canonical manifest in reports/UI |
| Unused registry outputs | Requirement-level readiness and provenance are not produced until registry evaluation |
| Raw upload leakage risks | If fallback manifests are consumed as if canonical, raw photos can re-enter document logic; current adapter labels this truth source explicitly |

## Stage 3: Duplicate hygiene

| Field | Current flow |
| --- | --- |
| Inputs | Repeated survey sessions, file metadata, labels, filenames, created-at values, project context |
| Outputs | Canonical representatives, duplicate groups, duplicate group sizes, duplicate-collapsed notes, session lineage |
| Truth source | Canonical representative records, not raw duplicate upload count |
| Fallback behavior | If no duplicate-group context is passed, traceability can be rebuilt from manifest only and lose project-level duplicate group detail; registry bridge now accepts traceability override to avoid that loss |
| Legacy assumptions | Raw upload count remains useful for audit and UX display, but not for satisfaction counts |
| Duplicated logic | Older photo array displays can still show duplicates outside registry evaluation |
| Unused registry outputs | Duplicate-collapsed status is used in registry/permit validation but not in SLD, BOM, standalone plan-set, proposals, or engineering reports |
| Raw upload leakage risks | Low in registry path; moderate in detached report/photo-count surfaces |

## Stage 4: Provenance and traceability generation

| Field | Current flow |
| --- | --- |
| Inputs | Canonical manifest, duplicate groups, sessions, evidence truth source label |
| Outputs | `SurveyEvidenceTraceabilityBundle`, canonical evidence provenance records, requirement traceability records, survey lineage records |
| Truth source | Canonical manifest plus deterministic lineage bundle |
| Fallback behavior | Traceability can be built over whichever manifest is supplied, including explicit legacy fallback manifests |
| Legacy assumptions | Document generators generally do not require provenance envelopes today |
| Duplicated logic | Permit validation independently formats provenance rows; no shared document provenance renderer exists |
| Unused registry outputs | Most provenance fields do not reach SLD, BOM, standalone plan-set, proposal, report, or calculation outputs |
| Raw upload leakage risks | Raw upload counts are visible as audit-only lineage values; risk arises if another generator uses them as readiness counts |

## Stage 5: Engineering Requirement Registry evaluation

| Field | Current flow |
| --- | --- |
| Inputs | `canonicalManifest`, `SurveyEvidenceTraceabilityBundle`, centralized registry definitions |
| Outputs | `EngineeringRequirementEvaluationSummary`, satisfied/missing/partial/blocked/informational/inactive/all requirement arrays, reasoning paths, failed metadata rules, confidence source, provenance records |
| Truth source | `engineering_requirement_registry_v1` from canonical evidence and provenance only |
| Fallback behavior | Evaluation is deterministic even with empty or fallback manifests; inactive future flags do not affect readiness/completeness |
| Legacy assumptions | Registry semantics are not yet globally consumed by all engineering routes |
| Duplicated logic | Category/readiness assumptions remain in SLD, BOM, calculation, report, proposal, and standalone plan-set paths |
| Unused registry outputs | `permitUsage`, `engineeringUsage`, `readinessImpact`, `missingSeverity`, `confidencePolicy`, `failedMetadataRules`, evidence ids, provenance records are mostly unused outside permit validation |
| Raw upload leakage risks | Low inside registry evaluator; it counts canonical evidence ids, not raw uploads |

## Stage 6: Engineering survey evidence adapter

| Field | Current flow |
| --- | --- |
| Inputs | Enriched survey, canonical manifest option, duplicate groups, sessions, normalized timestamp |
| Outputs | `EngineeringSurveyEvidence`, `manifestV1`, `traceability`, `requirementEvaluation`, canonical photo evidence array, blockers, warnings, field evidence summary |
| Truth source | Canonical manifest when supplied; explicit `legacy_raw_photos_fallback` otherwise |
| Fallback behavior | Builds manifest from normalized photo metadata if canonical manifest is absent |
| Legacy assumptions | `photos` array remains part of adapter output for permit/CAD assumptions; field evidence still summarized from enriched survey values |
| Duplicated logic | Missing categories are derived from blocked requirements, but field-evidence and photo rows still have separate summaries |
| Unused registry outputs | Adapter exposes full evaluation, but most consumers ignore it except permit validation |
| Raw upload leakage risks | Explicitly labeled fallback; risk if callers do not pass canonical manifest or ignore `evidenceTruthSource` |

## Stage 7: Engineering bridge

| Field | Current flow |
| --- | --- |
| Inputs | Canonical manifest and optional traceability override |
| Outputs | Bridge counts, readiness, completeness, confidence, warnings, missing categories, requirement evaluation |
| Truth source | Registry evaluation over canonical manifest/provenance |
| Fallback behavior | Builds traceability internally only if no override is supplied |
| Legacy assumptions | Bridge still exposes count-style fields for compatibility |
| Duplicated logic | Count-style readiness summaries coexist with registry evaluation arrays |
| Unused registry outputs | Downstream consumers often read only readiness/completeness/counts, not requirement detail |
| Raw upload leakage risks | Low when canonical manifest and traceability override are supplied |

## Stage 8: Permit generation route

| Field | Current flow |
| --- | --- |
| Inputs | Permit body, project DB rows, Client_Profile.json, layout/design data, aerial data, stored SLD SVG, project physical data, survey context, canonical evidence hygiene |
| Outputs | `permit_planset.html`, optional PDF, permit sheets, validation page, project file artifact |
| Truth source | Mixed: CADModel for geometry, canonical permit input for plan-set fields, stored SLD for E-1 when present, registry evaluation for survey evidence validation |
| Fallback behavior | Survey enrichment is non-critical; no physical data skips survey enrichment; aerial fetch errors are non-critical; stored SLD absence shows fallback message; BOM failure renders without generated BOM; PDF failure can return HTML |
| Legacy assumptions | `permitIntegration(enriched)` patches survey physical fields; design pipeline wins for many fields; raw/enriched survey fields can backfill only when design fields absent |
| Duplicated logic | Survey field patching and registry evidence validation coexist without a single requirement-to-field dependency graph |
| Unused registry outputs | Registry does not yet gate or annotate each permit sheet; mostly rendered on validation sheet |
| Raw upload leakage risks | Low for readiness; moderate for legacy survey enrichment if raw-photo fallback manifest is used and not reviewed |

## Stage 9: Permit document rendering

| Field | Current flow |
| --- | --- |
| Inputs | `PermitInput`, `CADModel`, `RenderContext`, optional stored SLD SVG, generated BOM, canonical permit structure, `surveyEvidence` |
| Outputs | 15-sheet permit HTML including validation summary, PDF through `generatePdfFromHtml()` |
| Truth source | Sheet-specific: CADModel, canonical permit fields, BOM, stored SLD, AHJ/design data, registry only on validation page |
| Fallback behavior | Page renderers use display defaults; validation page renders no-evidence warning if no `surveyEvidence`; equipment schedule can render no-BOM message |
| Legacy assumptions | CAD and canonical permit fields are sufficient for most sheets regardless of evidence registry state |
| Duplicated logic | Geometry validation and evidence validation are separate; no requirement-to-sheet bindings |
| Unused registry outputs | Most sheet renderers do not consume requirement ids, provenance, or failed metadata rules |
| Raw upload leakage risks | Validation page explicitly labels audit-only raw upload counts; other sheets do not use raw counts directly based on inspected references |

## Stage 10: Standalone plan-set route

| Field | Current flow |
| --- | --- |
| Inputs | Request body/project/design values, computed system input, AHJ lookup, fire setbacks, equipment enrichment |
| Outputs | Plan-set HTML/PDF project files and response metadata |
| Truth source | `computeSystem()` and `PermitSystemModel`; route body/design values |
| Fallback behavior | Compute failure uses fallback values; equipment enrichment failure non-critical; display defaults such as “Per plan” |
| Legacy assumptions | Design model values are sufficient; no evidence readiness dependency |
| Duplicated logic | Separate from permit plan-set generator; has its own sheet construction path detached from registry |
| Unused registry outputs | All registry outputs unused |
| Raw upload leakage risks | No raw survey dependency found, but also no canonical evidence protection |

## Stage 11: SLD generation

| Field | Current flow |
| --- | --- |
| Inputs | Request body, selected brand/inverter, topology, module counts, string counts, interconnection fields, sizing result, `computeSystem()` |
| Outputs | SVG SLD, optional PDF SLD, route metadata |
| Truth source | Body values, sizing engine, string config, `PermitSystemModel` |
| Fallback behavior | Defaults manufacturer/model by topology; falls back to body values when sizing unavailable; PDF route falls back to SVG/HTML path |
| Legacy assumptions | Electrical service assumptions can be rendered without registry evidence for panel/meter/disconnect/subpanel |
| Duplicated logic | Interconnection/topology normalization exists independent of registry requirements |
| Unused registry outputs | All registry/provenance outputs unused |
| Raw upload leakage risks | No direct raw upload use found; evidence disconnect risk remains |

## Stage 12: BOM generation

| Field | Current flow |
| --- | --- |
| Inputs | Request body, equipment ids, topology, module count, string count, CADModel for permit BOM path, structural profiles, sizing result, distributor pricing |
| Outputs | BOM JSON, CSV, Markdown, permit equipment schedule items, pricing summary |
| Truth source | V4 BOM engine, structural profile logic, sizing adapters, catalog/pricing data, CADModel in permit path |
| Fallback behavior | Catalog fallback, EcoFlow fallback, unpriced BOM fallback, no-BOM display fallback |
| Legacy assumptions | Component requirements are driven by system design and equipment catalogs, not evidence registry |
| Duplicated logic | Equipment/component readiness is independent of requirement readiness |
| Unused registry outputs | All registry/provenance outputs unused |
| Raw upload leakage risks | No direct raw upload use found; no evidence provenance attached to BOM items |

## Stage 13: Engineering calculations

| Field | Current flow |
| --- | --- |
| Inputs | Request body, selected equipment/topology, jurisdiction helpers, string config, structural input |
| Outputs | Electrical and structural calculation results, warnings |
| Truth source | Calculation engines and request fields |
| Fallback behavior | Safe/current defaults, string generation warning fallback, structural warning fallback |
| Legacy assumptions | Calculation can proceed independently from evidence completeness |
| Duplicated logic | Readiness/requirement sufficiency is not consulted before calculations |
| Unused registry outputs | All registry outputs unused |
| Raw upload leakage risks | No direct raw upload use found; calculations are detached from evidence system |

## Stage 14: Engineering report generation

| Field | Current flow |
| --- | --- |
| Inputs | Project, layout, design snapshot, project physical data, optional enriched survey |
| Outputs | Engineering report JSON, engineering artifacts, optional site photos section |
| Truth source | Design snapshot and `project_physical_data`; optional enriched survey photo counts |
| Fallback behavior | Default panel/inverter specs; typical structural defaults; optional omission of photo section |
| Legacy assumptions | Physical data and photo counts are sufficient report context; no registry provenance required |
| Duplicated logic | Report required documents and photo availability duplicate registry concepts without consuming registry ids |
| Unused registry outputs | All registry outputs unused |
| Raw upload leakage risks | Site photo counts come from enriched survey rather than canonical evidence; risk is informational-count overinterpretation |

## Stage 15: Proposal generation and proposal PDF

| Field | Current flow |
| --- | --- |
| Inputs | Project snapshot, layout, production, cost estimate, pricing config snapshot, utility rate, proposal row, branding |
| Outputs | Proposal DB rows, proposal snapshots, proposal HTML/PDF, share links |
| Truth source | Proposal creation snapshot and canonical proposal builder |
| Fallback behavior | Cached proposal data; pricing snapshot fallback; inferred panel count from system size; HTML fallback if PDF unavailable |
| Legacy assumptions | Proposal does not require site evidence readiness |
| Duplicated logic | Proposal readiness/status is disconnected from engineering registry readiness |
| Unused registry outputs | All registry/provenance outputs unused |
| Raw upload leakage risks | No direct raw upload use found; detached from evidence system |

## Stage 16: Admin and project summaries

| Field | Current flow |
| --- | --- |
| Inputs | Project status, admin metadata, survey detail data, topography documentation |
| Outputs | Admin/project pages, survey detail evidence viewer, topography pipeline cards |
| Truth source | Mixed UI state and project DB data; survey detail page uses canonical evidence hygiene when available |
| Fallback behavior | Survey detail page can display legacy raw photos fallback if hygiene canonical manifest is absent |
| Legacy assumptions | Stage labels and summary cards are not registry-derived globally |
| Duplicated logic | Topography documentation and survey UI describe evidence pipeline separately from admin project summaries |
| Unused registry outputs | General admin/project summaries do not consume most registry outputs |
| Raw upload leakage risks | Survey UI shows raw files as history; acceptable if kept separate from canonical truth |

## Stage 17: Future CAD and plan-set automation pathway

| Field | Current flow |
| --- | --- |
| Inputs | `EnrichedSiteSurvey`, `buildCADFromSurvey()` outputs, `generateCADLayout()` inputs, `CADModel`, `RenderContext`, drafting validation |
| Outputs | CAD input overrides, CADModel, drafting sheets, render context |
| Truth source | Existing CADModel/design input path; not canonical evidence registry |
| Fallback behavior | `buildCADFromSurvey()` can fallback origin to first roof vertex or return unknown origin; CAD solvers handle missing data gracefully |
| Legacy assumptions | Enriched survey geometry can feed CAD inputs without canonical evidence ids; CAD validation checks geometry shape, not evidence sufficiency |
| Duplicated logic | Survey-to-CAD bridge and registry requirement evaluation are parallel systems today |
| Unused registry outputs | Geometry/layout rendering does not consume requirement ids or evidence provenance |
| Raw upload leakage risks | Current bridge uses typed survey geometry, not image bytes; future integrations must avoid image-byte inference and normalize any external outputs before use |

## Normalized future flow recommendation

The deterministic future architecture should become:

`canonicalManifest` → `traceability` → `requirementEvaluation` → `DocumentProvenanceBundle` → `RequirementDocumentBinding` → `EngineeringDependencyGraph` → route-specific render context → artifact output.

This flow should remain additive. It should not change sizing calculations, infer geometry from images, or generate CAD from raw uploads. It should allow each document field, sheet, BOM item, SLD label, calculation result, and plan-set geometry input to cite one of three provenance states: canonical evidence-backed, design-model/default driven, or missing/unsupported evidence dependency.

## Current registry consumption classification matrix

| Pipeline | Classification | Notes |
| --- | --- | --- |
| Survey detail UI | Fully registry-driven for registry display | Uses `bridge.requirementEvaluation` directly |
| Engineering survey evidence adapter | Fully registry-driven for readiness/completeness | Falls back to legacy manifest only if canonical absent |
| Permit validation page | Fully registry-driven for evidence validation | Renders status, missing analysis, provenance, traceability |
| Permit route/generator | Partially registry-driven | Registry reaches validation sheet; rest mostly CAD/design driven |
| Standalone plan-set route | Detached from evidence system | No registry/canonical evidence references found |
| SLD route | Legacy field-driven | Body/sizing/compute model driven |
| SLD PDF route | Legacy body-driven | Renderer input driven |
| BOM route | Legacy field/catalog driven | No evidence provenance |
| Permit BOM schedule | CAD/design driven | No registry binding |
| Engineering calculations | Legacy field-driven | No registry dependency |
| Engineering report | Legacy field/raw-photo-count aware | Optional site photo counts, no canonical provenance |
| Proposal generation | Detached from evidence system | Project snapshot driven |
| Proposal PDF | Detached from evidence system | Canonical proposal data, no survey evidence |
| Admin project summaries | Mostly detached | Survey/topography pages document or show evidence; not broad consumption |
| Future CAD bridge | Partially survey-informed but not registry-bound | Uses enriched survey fields, not canonical evidence ids |

## Boundary statement

No runtime CV, OCR, YOLO, semantic inference, image-byte inspection, perceptual hashing, CAD generation, or engineering sizing logic was added by this audit. Existing CAD and drafting modules were inspected as current deterministic code paths, not modified or expanded.
