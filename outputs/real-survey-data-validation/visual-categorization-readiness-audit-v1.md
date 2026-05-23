# Visual Categorization Readiness Audit V1

Controlled Visual Categorization Pilot V1 — audit-first, non-spatial, non-geometric, review-only.

Repository: `rayobrian6/Solarpro`  
Branch audited: `dev`  
Audit scope: existing visual/image categorization logic, runtime/image dependencies, ingestion truth paths, assisted evidence runtime integration, and boundary risks.  
Implementation status at time of this report: no visual categorization runtime implementation has been added for this directive.

## Executive conclusion

The safest implementation path is a very small governed assisted-evidence runtime that emits only review-required, non-authoritative `possible_*_photo` category candidates through the existing assisted evidence adapter and candidate normalization lifecycle. The pilot must not reuse or activate legacy `lib/vision` detection/aggregation artifacts, must not call any vision service, must not inspect or produce geometry, must not influence CAD, engineering requirements, recommendations, workflows, or canonical survey evidence, and must not bypass `createReviewRequiredCandidates()`.

The repository already has canonical survey evidence category logic and survey ingestion truth paths. Those systems classify submitted labels and survey slot keys into canonical survey evidence categories, but they do not perform image-byte visual categorization in the active survey ingestion or canonical manifest path. The repository also contains legacy/roadmap vision artifacts under `lib/vision` and roadmap text describing YOLO-style inference; these are risk artifacts for this pilot and must remain excluded. Existing survey ingestion has an explicit prohibited-boundary quarantine that prevents CV/vision inference after file persistence, and a regression test asserts that file-present surveys do not call vision inference even when `VISION_SERVICE_URL` is configured.

## Evidence gathered

Raw audit evidence was captured under `outputs/real-survey-data-validation/visual-categorization-audit-v1/`, including dependency scans, source usage scans, risk scans, assisted evidence runtime excerpts, survey ingestion excerpts, current boundary guard contents, and focused vision-risk scans. Key evidence files include `dependency-scan.txt`, `source-usage-scan.txt`, `risk-scan.txt`, `assisted-evidence-runtime.txt`, `survey-ingestion-evidence.txt`, `current-assisted-boundary-guard.txt`, `current-key-evidence.txt`, `vision-risk-focused-scan.txt`, and `vision-risk-source-excerpts.txt`.

The dependency scan verified existing image/PDF/OCR-related packages in `package.json` and `package-lock.json`, including `sharp`, `canvas`, `html2canvas`, `jspdf`, `pdf-parse`, `pdfjs-dist`, `tesseract.js`, and transitive `text-segmentation`. The top-level package scan did not find direct package entries for OpenCV, TensorFlow, ONNX, YOLO, or MediaPipe. This is only a dependency finding; source-level risk artifacts still exist and are documented below.

## What already exists

The canonical survey evidence category registry already defines deterministic submitted-label categories such as `main_service_panel`, `subpanel`, `meter`, `disconnect`, `grounding`, `utility_connection`, `roof_plane`, `roof_edge`, `ridge`, `attic`, `rafters`, `obstructions`, `roof_surface`, `detached_structures`, `trench_path`, `battery_location`, `inverter_location`, `gateway_location`, `garage_interior_wall`, `attic_access`, `utility_access`, `overview`, `duplicate`, `blurry`, `unusable`, and `uncategorized`. The functions `normalizeSurveyEvidenceCategory()` and `inferSurveyEvidenceCategoryFromText()` normalize submitted labels and text into these canonical categories. This is an existing deterministic label/text mapper, not an image-byte visual classifier.

The survey ingestion path already extracts `SurveyV2Payload.photos` into file records. In `lib/survey/ingest/transformLayer.ts`, each v2 photo uses `photo.url`, `photo.id`, and the submitted `photo.category` survey slot key. The transform writes the category as file metadata and uses the tag or category only to create a filename. In `lib/survey/ingest/ingestPipeline.ts`, files are persisted into `site_survey_files`; the comment states that the category is the v2 survey slot key and that the pipeline should never guess from filename for v2 payloads. A filename guess helper exists only as fallback for older partner payloads where category is null.

The canonical evidence manifest already builds evidence items from `site_surveys`, `site_survey_files`, and submitted payload photo data. In `lib/survey/evidence/manifest.ts`, `buildEvidenceItem()` maps `input.file.label` or `payloadPhoto.category` through `classifySubmittedEvidenceCategory()`. It records `image.widthPx`, `image.heightPx`, and `image.orientation` as null in this manifest path, stores quality scores as null, records `aiExtractionStatus: 'not_started'`, and adds a processing history note that photo quality and duplicate analysis are not processed in v1. For classified files, the history note says the submitted category was mapped to an evidence category. This is submitted-label classification, not visual image analysis.

The survey ingestion pipeline already contains a prohibited-boundary quarantine. After file persistence, it logs that the vision/CV pipeline is disabled by the canonical survey evidence boundary when files are present. A regression test in `lib/survey/ingest/ingestPipeline.test.ts` configures `VISION_SERVICE_URL`, stubs `fetch`, and asserts that file-present surveys persist without calling vision inference.

The assisted evidence sandbox already exists and provides the correct lifecycle primitives. `createCandidate()` creates deterministic, non-authoritative, review-required candidates with bounded confidence. `markReviewRequired()` enforces the review-required candidate status. `createReviewRequiredCandidates()` in `lib/assistedEvidenceSources/candidateNormalization.ts` routes normalized adapter payloads through `createCandidate()` and `markReviewRequired()`. Review projection code creates reviewed projections only from review-required candidates and marks them `eligible_for_mapping`; it does not automatically mutate canonical evidence. Sandbox guards explicitly return false for satisfying requirements, influencing CAD readiness, influencing recommendations, creating workflow items, and automatic canonical mutation.

The governed open-source runtime registry already contains enabled runtime pilots for `sharp-metadata-runtime@0.34.5` and `tesseract-js-ocr-runtime@7.0.0`. The type system already includes an `OpenSourceRuntimeCategory` value named `visual_categorization_candidate`, but `openSourceToolValidation.ts` currently rejects that runtime category because the prior pilot only approved metadata and OCR. This provides an intentional approval gate for the visual pilot.

## Existing image categorization and tagging behavior

Survey photo categorization currently comes from submitted survey slot keys, submitted labels, tags, file labels, or older filename fallback heuristics. `classifySubmittedEvidenceCategory()` first tries exact normalization via `normalizeSurveyEvidenceCategory()` and then falls back to text inference via `inferSurveyEvidenceCategoryFromText()`. It can infer categories from tokens such as meter, attic, obstruction, chimney, skylight, vent, ground, service panel, and roof. This is string-based categorization and must not be treated as image understanding.

Equipment, roof, electrical, and utility-style tagging exists as deterministic category mapping from submitted text and manifest metadata. Utility bill handling and OCR-adjacent paths exist elsewhere in the repository, but those are outside this pilot and must not be duplicated. Existing OCR runtime work is text extraction only; the visual pilot must not reuse OCR text signals to make authoritative visual or engineering conclusions.

Document/image distinction exists primarily through upload routes, MIME/file metadata, survey file records, and manifest handling. No audited active canonical path performs generalized image-byte scene classification for survey evidence.

## Runtime and dependency findings

The safe reusable runtime infrastructure is the assisted evidence source adapter pattern, not legacy or external CV code. Existing safe dependencies for the visual pilot include built-in deterministic byte hashing and potentially existing metadata-only infrastructure for provenance and hash calculation. The audit did not verify any approved direct OpenCV, TensorFlow, ONNX, YOLO, or MediaPipe dependency in `package.json` for this pilot.

However, the repository contains `lib/vision/types.ts`, `lib/vision/visionAggregator.ts`, and `lib/vision/confidenceGate.ts`. Source comments and roadmap entries describe YOLOv8 detections, bounding boxes, `VisionDetection`, `VisionInferenceResult`, `/vision/infer`, and `VISION_SERVICE_URL`. `lib/system/visionPatch.ts` imports types from `lib/vision/types.ts`. These artifacts represent hidden or legacy CV risk surfaces for the controlled visual categorization pilot. They must not be used by this pilot, and boundary guards should explicitly prevent imports from `lib/vision` by assisted evidence visual runtime files.

The presence of these `lib/vision` files does not change the safe path: the controlled visual categorization pilot must be a separate governed assisted-evidence runtime and must not activate object detection, detection aggregation, bounding boxes, spatial nodes, obstruction nodes, plane correction, or any external vision service.

## Existing ingestion truth paths

The ingestion truth path is `SurveyV2Payload.photos` to transform output files to `site_survey_files` to canonical survey evidence manifest. For v2 surveys, the submitted survey category is preserved as the file label. The canonical manifest maps submitted categories and labels into survey evidence categories and records provenance. The pilot must preserve this truth path and must not create a parallel ingestion system, a parallel metadata system, a parallel OCR system, a parallel review system, or a parallel canonical evidence mapping system.

Any visual categorization result must live as assisted evidence candidate output tied to source context/provenance. It must not write to `site_survey_files.label`, must not update survey payload photo categories, must not update canonical evidence manifest categories, and must not become a canonical survey evidence category without an explicit future mapping step outside this pilot.

## Existing assisted evidence/runtime integration

The correct integration path is the governed runtime registry, runtime adapter, runtime bridge, deterministic normalization, and candidate lifecycle. Existing adapters import `createReviewRequiredCandidates()` and return `CandidateAdapterResult`. Existing candidate normalization builds candidate inputs with runtime metadata, provenance, limitation references, and deterministic candidate ordering.

A visual runtime can safely reuse the source context, registry validation, candidate normalization, deterministic candidate hashing, review-required lifecycle, and sandbox guards. It should not duplicate candidate creation, review state handling, provenance handling, runtime registry validation, hashing, or acceptance/projection lifecycle.

## Hidden CV determination

The audit did not find an approved active visual categorization runtime in the assisted evidence registry. It did find legacy or roadmap CV artifacts under `lib/vision` and roadmap text describing YOLOv8 inference. It also found explicit future-only OpenCV/YOLO/Detectron2/Open3D/FreeCAD boundary declarations in survey evidence manifests and related tests. The survey ingestion pipeline currently disables CV/vision inference after file persistence, and tests assert this boundary.

Therefore the answer is nuanced: there is no approved governed visual categorization runtime for this pilot yet, and active survey ingestion is guarded against calling vision inference; however, hidden or legacy CV risk surfaces do exist in source files and must be treated as forbidden for the pilot unless separately audited and explicitly approved in a future directive. This pilot must not import, call, wrap, or normalize outputs from `lib/vision`.

## What can be reused safely

The visual pilot can safely reuse the existing assisted evidence runtime source architecture, including runtime registry definitions, validation functions after explicit visual approval changes, source context, adapter contracts, deterministic normalization helpers, deterministic hashes, provenance and limitation fields, candidate lifecycle, review projection lifecycle, and sandbox guards.

It can safely reuse existing upload/source identifiers and source context metadata only for provenance. It can also reuse existing metadata/OCR runtime patterns as implementation examples, but not their candidate semantics. It may use deterministic, local, server-side byte-level and filename/source-context heuristics only if they remain non-spatial, non-geometric, confidence-bounded, and review-required. It may map those weak signals only to the allowed `possible_*_photo` labels.

## What must never be duplicated

The pilot must never duplicate canonical survey evidence category mapping, survey ingestion, file persistence, manifest construction, metadata runtime infrastructure, OCR runtime infrastructure, review systems, candidate lifecycle, provenance tracking, canonical evidence mapping, engineering requirements, CAD readiness, recommendation engines, or workflow orchestration. It must also never duplicate or reintroduce legacy vision service clients, object-detection pipelines, segmentation pipelines, geometry extractors, or remote inference services.

## Safest integration path

The safest integration path is a new server-only assisted evidence source adapter and bridge under `lib/assistedEvidenceSources/`, using the existing registry-governed runtime pattern. The runtime should register a single governed visual categorization runtime with a narrow runtime category of `visual_categorization_candidate`. Validation should approve this category only for the named non-spatial runtime, only with `serverOnly: true`, `reviewRequired: true`, `canonicalMutationAllowed: false`, no model weights, no native object detection framework, no external network calls, and the existing `server_adapter_contract` boundary.

The adapter should emit normalized candidates through `createReviewRequiredCandidates()` only. The bridge should obtain a validated registry tool through `getRegisteredOpenSourceTool()`, assert the allowed candidate type, extract deterministic runtime payload, and return candidates. The runtime payload should include deterministic input hashes, runtime metadata, confidence, weak source-signal details, candidate labels, and limitations. It should not include bounding boxes, polygons, coordinates, dimensions interpreted as geometry, detected objects, roof edges, setbacks, conduit routes, obstruction maps, NEC conclusions, CAD readiness, or engineering recommendations.

## Safest runtime category

The safest runtime category is the existing `visual_categorization_candidate` category, but only after `openSourceToolValidation.ts` is expanded from the prior metadata/OCR-only gate to a visual-pilot gate with explicit restrictions. It should not use `future_geometry_placeholder` and must not use any blocked geometry boundary. The allowed runtime boundary should remain `server_adapter_contract`.

## Safest candidate categories and labels

The safest candidate type is a new narrow non-spatial candidate type such as `visual_category_candidate`, rather than reusing geometry-adjacent existing types such as `roof_edge_candidate`, `routing_continuity_candidate`, `trench_context_candidate`, or other context types that could be misread as engineering evidence. The candidate payload label set should be restricted to exactly the user-approved labels: `possible_roof_photo`, `possible_attic_photo`, `possible_msp_photo`, `possible_inverter_photo`, `possible_meter_photo`, `possible_equipment_label_photo`, `possible_utility_bill_photo`, `possible_site_overview_photo`, and `possible_obstruction_photo`.

These labels must remain candidate labels only. They must not become canonical categories, engineering facts, geometry truth, equipment confirmations, CAD inputs, or workflow triggers. Candidate confidence must be bounded to `[0, 1]`, and low-confidence or unsupported images should yield no authoritative output or only clearly limited review-required candidates.

## Boundary guards that must expand before or during implementation

`scripts/check-assisted-evidence-boundaries.js` must expand to fail loudly on visual categorization risks. Required guard coverage includes object detection imports, segmentation imports, geometry extraction imports, OpenCV/cv2 escalation, YOLO/Ultralytics escalation, TensorFlow escalation, ONNX escalation, MediaPipe escalation, Detectron/segmentation escalation, imports from `lib/vision` in assisted evidence runtime files, external vision-service calls such as `/vision/infer` or `VISION_SERVICE_URL`, bounding box/polygon/coordinate outputs, roof edge or setback detection, conduit path detection, obstruction spatial mapping, CAD influence, engineering influence, recommendation influence, workflow influence, canonical mutation, runtime bypassing `createCandidate()`/`createReviewRequiredCandidates()`, and runtime bypassing `markReviewRequired()`/`createReviewRequiredCandidates()`.

The guard should also ensure visual runtime files do not write to canonical survey ingestion or manifest files and do not import engineering intelligence, CAD, recommendation, workflow, or project physical data mutation modules.

## Approval to proceed

Implementation may proceed only under the safe path above. The audit supports a smallest viable pilot if and only if it remains registry-governed, server-side only, deterministic, provenance-preserved, confidence-bounded, non-spatial, non-geometric, non-authoritative, review-required, and isolated from canonical mutation and engineering/CAD/recommendation/workflow systems.

