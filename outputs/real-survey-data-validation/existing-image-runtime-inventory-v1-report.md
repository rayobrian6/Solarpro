# Existing Image Runtime Inventory V1 Report

Generated: 2026-05-23T19:53:12.499Z
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Executive inventory

The audit found existing image/OCR/text-extraction runtime in SolarPro, but the active runtime is concentrated in utility-bill and diagnostic routes rather than the Engineering Intelligence canonical evidence stack. The scan covered 578 files and produced 7361 token findings. It identified 191 direct runtime findings and dependency references for @types/pdf-parse, exif-reader, pdf-parse, sharp, tesseract.js.

The active OCR/vision paths are not appropriate plug-in points for bounded engineering evidence assistance. They exist for utility-bill intake and debugging, include Tesseract, pdftotext/pdf-parse, OpenAI Vision, Google Vision, and Claude image extraction references, and should remain fenced from survey evidence, requirement satisfaction, CAD readiness, recommendation ranking, and workflow orchestration.

## Dependency inventory

| Dependency | Version | AuditClassification |
| --- | --- | --- |
| @types/pdf-parse | ^1.1.5 | Image/OCR adjacent dependency present |
| exif-reader | ^2.0.3 | Image metadata dependency present |
| pdf-parse | ^2.4.5 | Image/OCR adjacent dependency present |
| sharp | ^0.34.5 | Image-processing dependency present |
| tesseract.js | ^7.0.0 | OCR runtime dependency present |

## Runtime and route inventory

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

## Engineering boundary keyword findings

The raw scan reported 21 engineering-boundary keyword findings. Manual review classifies the examples as explicit guardrail or future-only text, not active Engineering Intelligence OCR/CV runtime imports. The current boundary scan remains important because these text references could otherwise mask future runtime imports if not continuously monitored.

| File | Token | Text | Classification |
| --- | --- | --- | --- |
| lib/engineeringIntelligence/photoGrouping.ts:534 | opencv | 'no OpenCV', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/photoGrouping.ts:535 | yolo | 'no YOLO', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/photoGrouping.ts:536 | tensorflow | 'no TensorFlow', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/photoGrouping.ts:537 | pytorch | 'no PyTorch', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/recommendationEngine.ts:517 | opencv | 'no OpenCV or cv2', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/recommendationEngine.ts:518 | yolo | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/recommendationEngine.ts:518 | tensorflow | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/recommendationEngine.ts:518 | pytorch | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/scenarioSimulation.ts:520 | opencv | 'no OpenCV/cv2', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/scenarioSimulation.ts:521 | yolo | 'no TensorFlow/PyTorch/YOLO image inference', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/scenarioSimulation.ts:521 | tensorflow | 'no TensorFlow/PyTorch/YOLO image inference', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/scenarioSimulation.ts:521 | pytorch | 'no TensorFlow/PyTorch/YOLO image inference', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/workflowOrchestration.ts:315 | opencv | 'no OpenCV or cv2', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/workflowOrchestration.ts:316 | yolo | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/workflowOrchestration.ts:316 | tensorflow | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/engineeringIntelligence/workflowOrchestration.ts:316 | pytorch | 'no TensorFlow, PyTorch, YOLO, or vision-model runtime', | boundary declaration / future-only note, not active runtime import |
| lib/survey/evidence/fieldOrchestration.ts:258 | opencv | 'no OpenCV runtime', | boundary declaration / future-only note, not active runtime import |
| lib/survey/evidence/fieldOrchestration.ts:260 | yolo | 'no YOLO runtime', | boundary declaration / future-only note, not active runtime import |
| lib/survey/evidence/manifest.ts:239 | opencv | 'OpenCV blur/orientation/duplicate scoring', | review manually |
| lib/survey/evidence/manifest.ts:240 | yolo | 'YOLO/Supervision detection candidates', | review manually |
| lib/survey/evidence/sessionGrouping.ts:309 | opencv | pythonWorker: ['OpenCV blur/orientation/duplicate scoring'], | review manually |

## Inventory conclusion

SolarPro already has active OCR/vision-style code, but it is utility-bill specific and not a safe reusable foundation for Engineering Intelligence evidence assistance. Engineering Intelligence and survey-evidence modules currently rely on canonical rows, explicit survey fields, deterministic metadata, and review-visible states. No direct OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, perceptual hashing, semantic scene classification, object detection, roof segmentation, geometry extraction, or autonomous CAD generation runtime was verified in the Engineering Intelligence/survey evidence path during this audit.

Validation status at report generation: pending. Required commands are npm run check:engineering-boundaries, npm run check:topology, npm run type-check, npm test, npm run build, and npm run lint. Final validation results are recorded in the delivery response after execution.
