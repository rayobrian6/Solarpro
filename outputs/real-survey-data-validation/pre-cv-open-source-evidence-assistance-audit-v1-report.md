# Pre-CV / Open-Source Evidence Assistance Audit V1 Report

Generated: 2026-05-23T19:53:12.499Z
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Recommendation

GO WITH GUARDS for Bounded Computer Vision / Open-Source Evidence Assistance V1.

The system is not ready for direct CV/OCR integration into engineering state, requirement satisfaction, CAD readiness, recommendations, or workflow orchestration. It is ready to design a bounded assistance layer only if the layer is quarantined, candidate-only, review-required, provenance-linked, confidence-labeled, invalidatable, and blocked from canonical evidence mutation until a human reviewer accepts or translates the candidate into explicit canonical survey evidence metadata.

## Verified audit scope

The audit covered Engineering Intelligence, survey evidence manifests, canonical evidence hydration, duplicate hygiene, deterministic photo grouping, structured signals, context resolution, CAD readiness, recommendation ranking, workflow orchestration, UI-adjacent references, active upload routes, bill OCR routes, debug routes, dependencies, scripts, and tests. The audit added scan/report artifacts only and did not add OpenCV, OCR, YOLO, TensorFlow, PyTorch, MediaPipe, ONNX, image-byte inspection, perceptual hashing, semantic classification, object detection, roof segmentation, geometry extraction, autonomous CAD generation, or autonomous engineering decisions.

## Scan evidence

The audit scan examined 578 files and found 7361 references across OCR/CV/image-byte/upload/canonical-mutation keyword categories. It found 191 direct runtime findings, concentrated in utility bill OCR/debug/test/dependency paths. Package-level image/OCR dependencies are @types/pdf-parse@^1.1.5, exif-reader@^2.0.3, pdf-parse@^2.4.5, sharp@^0.34.5, tesseract.js@^7.0.0.

## Existing image/CV/OCR inventory

| File | Classification | VerifiedEvidence | BoundaryDecision |
| --- | --- | --- | --- |
| app/api/ocr/route.ts | active production path | Tesseract CLI/WASM OCR endpoint used internally by bill upload; direct createWorker/recognize references found at lines 324, 326, and 339. | Do not reuse for engineering evidence assistance. Fence from survey/canonical evidence workflows. |
| app/api/bill-upload/route.ts | active production path | Utility-bill parser with pdf-parse, pdftotext, Tesseract, OpenAI Vision, Google Vision, and Claude image extraction references; scan found 31 OCR/text-extraction runtime references. | Treat as legacy/business intake OCR, not engineering evidence. Must not write engineering truth. |
| app/api/portal/bill-upload/route.ts | active production path | Portal wrapper that forwards bill files into /api/bill-upload and writes bill upload stages. | Indirectly reaches bill OCR. Keep out of engineering evidence assistance. |
| app/api/survey/upload-photo/route.ts | active production path | Survey photo upload stores validated image files and upload keys; uses arrayBuffer/Buffer/writeFile for storage only; no OCR/CV import found. | Safe as raw evidence ingress only if future assistance reads from quarantine, not canonical truth. |
| app/api/project-files/route.ts | active production path | Project-file upload/download handles image MIME validation, magic bytes, and storage; no OCR/CV import found. | Storage-only handling is acceptable; assisted metadata must not be produced here. |
| app/api/site-surveys/[surveyId]/route.ts | active production path | Hydrates survey evidence manifest via buildSurveyEvidenceManifest. | Canonical manifest boundary; only reviewed/explicit metadata should reach here. |
| app/api/debug/ocr/route.ts | reachable debug route | Debug endpoint with pdftotext, pdf-parse, Tesseract CLI, and OpenAI Vision fallback. | High-risk debug surface; must not become evidence-assistance path. Gate, isolate, or disable before V1. |
| app/api/debug/bill/route.ts | reachable debug route | Debug endpoint for bill extraction with pdftotext, pdf-parse, Tesseract CLI, and OpenAI Vision fallback. | High-risk debug surface; keep separate from engineering evidence. |
| lib/billClaudeExtractor.ts | active utility-bill helper | Claude vision utility-bill extraction helper discovered by grep; invoked by bill upload/intake paths. | Unsafe for engineering evidence assistance because it is an external vision/LLM extraction path. |
| lib/intake/utilityBillIntelligence.ts | active intake helper | Selects Claude image or bill pipeline based on MIME/API key and projects utility-bill intelligence. | Business-intake path only; no canonical engineering evidence promotion. |

## Active prohibited paths

No active prohibited Engineering Intelligence path was verified. The active prohibited-adjacent runtime paths are existing business/diagnostic OCR and vision routes, especially app/api/ocr/route.ts, app/api/bill-upload/route.ts, app/api/debug/ocr/route.ts, app/api/debug/bill/route.ts, lib/billClaudeExtractor.ts, and lib/intake/utilityBillIntelligence.ts. They are prohibited as sources for engineering evidence assistance unless they are redesigned behind the future sandbox and stripped of direct canonical influence. Existing survey photo/project file upload routes read file bytes for validation/storage, but no OCR/CV/ML runtime was verified there.

## Safe future plug-in points

The safest future plug-in point is after raw upload/storage and before canonical manifest mutation: an assisted-evidence sandbox that receives a raw file reference, creates candidate metadata only, records provenance and tool version, marks outputs review_required, and exposes candidates to a reviewer. The next safest integration surface is UI review context in the Engineering Intelligence workspace, where candidates can be displayed as non-authoritative hints next to canonical evidence gaps. The canonical manifest, requirement registry, signal extraction, context resolution, CAD readiness, recommendation engine, and workflow orchestration should consume only accepted/reviewed evidence state, not raw candidate outputs.

## Boundaries required before GO

The required guards are: a separate assisted_metadata_candidate model; no writes into SurveyEvidenceManifest items; no direct requirementSatisfied changes; no direct CAD readiness promotion; no direct structured-signal confirmed state; no direct authoritative/preferred context state; no workflow queue auto-action beyond human review; no hidden debug/utility OCR route reuse; no cloud-vision/LLM vision reuse for engineering evidence V1; no image-byte analysis outside a single sandbox module; deterministic invalidation of candidates when source files, tool versions, thresholds, or reviewer decisions change; and audit logs for every candidate and reviewer action.

## Readiness assessment

The Engineering Intelligence architecture is review-visible and deterministic enough to accept candidate metadata as long as candidates remain non-authoritative. Existing utility-bill OCR/vision paths create material risk because they normalize the presence of OCR/vision code in active routes. Therefore the recommendation is GO WITH GUARDS, not full GO. Without the guards, the answer becomes NO-GO because candidate metadata could be mistaken for canonical truth or because existing OCR/debug routes could be reused improperly.

Validation status at report generation: pending. Required commands are npm run check:engineering-boundaries, npm run check:topology, npm run type-check, npm test, npm run build, and npm run lint. Final validation results are recorded in the delivery response after execution.
