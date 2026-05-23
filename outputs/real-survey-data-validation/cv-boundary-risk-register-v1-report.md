# CV Boundary Risk Register V1 Report

Generated: 2026-05-23T19:53:12.499Z
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Risk register

| Risk | Evidence | Severity | Disposition |
| --- | --- | --- | --- |
| Existing utility-bill OCR reused for engineering evidence | app/api/ocr/route.ts and app/api/bill-upload/route.ts contain active Tesseract/OCR/vision paths. | High | Do not reuse. Create a separate future sandbox with candidate-only output. |
| Reachable debug OCR endpoints become hidden evidence paths | app/api/debug/ocr/route.ts and app/api/debug/bill/route.ts contain pdftotext, pdf-parse, Tesseract, and OpenAI Vision references. | High | Gate, isolate, or disable before assistance V1; fail scans if imported by evidence modules. |
| Candidate metadata satisfies requirements without review | Requirement registry currently uses canonical evidence policies; future OCR flags are documented but inactive. | High | Add tests that candidate metadata cannot set requirementSatisfied or confidenceSource canonical. |
| Candidate metadata promotes CAD readiness | cadReadiness.ts promotes only canonical categories, explicit survey fields, and structured signals with explicit-primary constraints. | High | Keep candidates outside readiness inputs until accepted by reviewer. |
| Perceptual hash or image similarity collapses canonical evidence incorrectly | sessionGrouping.ts currently notes no image bytes or perceptual hash used. | Medium | Similarity can be duplicate_candidate_only until reviewer accepts. |
| Cloud vision/LLM image path leaks into evidence assistance | OpenAI Vision, Google Vision, and Claude image extraction references exist in bill/debug/intake paths. | High | Exclude cloud vision/LLM vision from V1 open-source bounded assistance. |
| Future OpenCV/Yolo/ML roadmap references misread as active capability | Engineering boundary findings are mostly no-runtime or future-only declarations. | Medium | Keep reports explicit; improve scan categories if implemented later. |
| Upload storage byte reads confused with image analysis | survey upload/project-file routes use arrayBuffer/Buffer/writeFile for validation/storage. | Medium | Classify as storage-only; sandbox must be separate. |
| Assistance bypasses reviewer via workflow orchestration | workflowOrchestration.ts has deterministic no-vision runtime boundaries. | High | Workflow can queue review only, not mutate engineering state. |
| Debug/test-only routes remain publicly reachable | Scan classifies debug OCR routes as reachable-debug-route. | Medium | Require auth/admin gating validation before production CV assistance. |

## Fixes made in this audit

This audit added scan/report artifacts only. It did not change runtime behavior, dependencies, route handlers, canonical evidence logic, requirement evaluation, Engineering Intelligence scoring, CAD readiness, recommendations, workflow orchestration, or UI state mutation.

## Deferred risks

Deferred risks include formal auth review of debug routes, explicit automated tests for candidate-to-requirement isolation, explicit automated tests for candidate-to-CAD-readiness isolation, future creation of a candidate metadata schema, and future scan hardening to distinguish guardrail text from direct runtime imports automatically.

## Recommendation

GO WITH GUARDS. The current architecture has adequate deterministic boundaries to host a future candidate-only sandbox, but the existing OCR/vision/bill/debug paths are too risky to reuse and must remain fenced. If candidate metadata is allowed to affect canonical evidence, requirements, CAD readiness, recommendations, or workflow orchestration before review, the recommendation changes to NO-GO.
