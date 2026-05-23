# Assisted Metadata Sandbox Design V1 Report

Generated: 2026-05-23T19:53:12.499Z

## Design decision

Bounded evidence assistance must be implemented as a quarantine-and-candidate system, not as an extension of canonical survey evidence. The sandbox is allowed to inspect a copy or controlled reference of a raw upload only in a future sprint, produce candidate metadata, and store that candidate metadata with explicit non-authoritative status. The sandbox must not call Engineering Intelligence runtime functions that mark evidence satisfied, confirmed, ready, authoritative, preferred, or workflow-actionable.

## Required data model

A future assisted evidence candidate should include source project id, survey id when available, source file id or upload key, source content hash if a storage service already provides one, candidate id, candidate type, candidate value, confidence label, confidence score if deterministic, tool family, tool version, thresholds, generatedAt, invalidation inputs, reviewer status, reviewer id, reviewedAt, accepted canonical mapping when applicable, and an immutable provenance log. The status vocabulary should include candidate_generated, review_required, accepted_by_reviewer, rejected_by_reviewer, superseded_by_source_change, superseded_by_tool_change, and expired.

## Permitted future candidate types

Safe future candidates include blur/darkness/glare quality warnings, EXIF/dimensions/orientation metadata, duplicate/similarity candidates, text-region-presence flags, routing continuity hints, utility/electrical hint categories, roof-edge hint annotations for review only, and upload quality triage. These candidates may help a human find gaps or request better photos. They must not assert equipment identity, roof geometry, structural suitability, interconnection correctness, setback compliance, CAD geometry, or permit readiness.

## Unsafe future tools and paths

Unsafe paths for Bounded Evidence Assistance V1 include reusing app/api/ocr/route.ts, app/api/bill-upload/route.ts, app/api/debug/ocr/route.ts, app/api/debug/bill/route.ts, lib/billClaudeExtractor.ts, OpenAI Vision, Google Vision, Claude image extraction, YOLO/Supervision object detection, OpenCV segmentation, TensorFlow/PyTorch/ONNX models, MediaPipe, perceptual hashing as canonical duplicate truth, roof segmentation, geometry extraction, autonomous CAD generation, and hidden remediation that updates canonical evidence. These may be research topics later, but not V1 plug-ins.

## Boundary rules

The sandbox must be the only module allowed to run future image-byte tooling. All candidate output must be explicitly labeled non_authoritative and review_required. Candidate output must not be imported by lib/survey/evidence/manifest.ts, lib/survey/evidence/engineeringRequirements.ts, lib/engineeringIntelligence/signalExtraction.ts, lib/engineeringIntelligence/contextResolution.ts, lib/engineeringIntelligence/cadReadiness.ts, lib/engineeringIntelligence/recommendationEngine.ts, or lib/engineeringIntelligence/workflowOrchestration.ts except through a reviewed/accepted projection layer. The reviewed projection layer must produce explicit, traceable human-reviewed evidence state, not implicit tool truth.

## Invalidation model

Candidate metadata must be invalidated when the source file changes, source upload key changes, candidate tool version changes, thresholds change, canonical evidence category mapping changes, reviewer rejects the candidate, survey session dedupe changes the canonical representative, or a higher-priority reviewed evidence record supersedes the candidate. Invalidated candidates may remain in audit history but must disappear from active review recommendations.

## Required scans/tests

Before implementation, add boundary scans that fail on OCR/CV/ML imports outside the sandbox, fail if candidate metadata appears in requirementSatisfied logic, fail if candidate metadata can mark CAD readiness ready, fail if candidate metadata can create confirmed structured signals, fail if any debug OCR route is imported by engineering evidence modules, and fail if a route writes assisted outputs directly into canonical survey evidence tables.
