#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'outputs', 'real-survey-data-validation');
const scanPath = path.join(OUT, 'pre-cv-open-source-evidence-assistance-audit-v1-scan.json');
const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
const generatedAt = new Date().toISOString();

function write(name, body) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), body.trimEnd() + '\n');
}

function classification(file) {
  return scan.classifications.find((entry) => entry.file === file) ?? null;
}

function table(rows, headers) {
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => escape(row[header])).join(' | ')} |`),
  ].join('\n');
}

const runtimeRows = [
  ['app/api/ocr/route.ts', 'active production path', 'Tesseract CLI/WASM OCR endpoint used internally by bill upload; direct createWorker/recognize references found at lines 324, 326, and 339.', 'Do not reuse for engineering evidence assistance. Fence from survey/canonical evidence workflows.'],
  ['app/api/bill-upload/route.ts', 'active production path', 'Utility-bill parser with pdf-parse, pdftotext, Tesseract, OpenAI Vision, Google Vision, and Claude image extraction references; scan found 31 OCR/text-extraction runtime references.', 'Treat as legacy/business intake OCR, not engineering evidence. Must not write engineering truth.'],
  ['app/api/portal/bill-upload/route.ts', 'active production path', 'Portal wrapper that forwards bill files into /api/bill-upload and writes bill upload stages.', 'Indirectly reaches bill OCR. Keep out of engineering evidence assistance.'],
  ['app/api/survey/upload-photo/route.ts', 'active production path', 'Survey photo upload stores validated image files and upload keys; uses arrayBuffer/Buffer/writeFile for storage only; no OCR/CV import found.', 'Safe as raw evidence ingress only if future assistance reads from quarantine, not canonical truth.'],
  ['app/api/project-files/route.ts', 'active production path', 'Project-file upload/download handles image MIME validation, magic bytes, and storage; no OCR/CV import found.', 'Storage-only handling is acceptable; assisted metadata must not be produced here.'],
  ['app/api/site-surveys/[surveyId]/route.ts', 'active production path', 'Hydrates survey evidence manifest via buildSurveyEvidenceManifest.', 'Canonical manifest boundary; only reviewed/explicit metadata should reach here.'],
  ['app/api/debug/ocr/route.ts', 'reachable debug route', 'Debug endpoint with pdftotext, pdf-parse, Tesseract CLI, and OpenAI Vision fallback.', 'High-risk debug surface; must not become evidence-assistance path. Gate, isolate, or disable before V1.'],
  ['app/api/debug/bill/route.ts', 'reachable debug route', 'Debug endpoint for bill extraction with pdftotext, pdf-parse, Tesseract CLI, and OpenAI Vision fallback.', 'High-risk debug surface; keep separate from engineering evidence.'],
  ['lib/billClaudeExtractor.ts', 'active utility-bill helper', 'Claude vision utility-bill extraction helper discovered by grep; invoked by bill upload/intake paths.', 'Unsafe for engineering evidence assistance because it is an external vision/LLM extraction path.'],
  ['lib/intake/utilityBillIntelligence.ts', 'active intake helper', 'Selects Claude image or bill pipeline based on MIME/API key and projects utility-bill intelligence.', 'Business-intake path only; no canonical engineering evidence promotion.'],
].map(([File, Classification, VerifiedEvidence, BoundaryDecision]) => ({ File, Classification, VerifiedEvidence, BoundaryDecision }));

const boundaryRows = [
  ['lib/survey/evidence/manifest.ts', 'Builds deterministic SurveyEvidenceManifest from survey rows/files; documents openSourceBoundaries as future-only entries.', 'Good plug-in boundary after quarantine/review only. Do not let candidates mutate manifest items or summary counts.'],
  ['lib/survey/evidence/sessionGrouping.ts', 'Builds duplicate hygiene and canonical project manifest using metadata fingerprints; explicit note says no image bytes/perceptual hash are used.', 'Candidate similarity may be attached as non-authoritative metadata only, never as canonical duplicate collapse input without review.'],
  ['lib/survey/evidence/engineeringRequirements.ts', 'Requirement satisfaction is based on canonical evidence policies; future capabilities include supportsOCR flags but requirements use canonical evidence and registry policy.', 'Assisted metadata cannot satisfy requirements directly. Human review must create/confirm canonical evidence before requirement impact.'],
  ['lib/survey/evidence/fieldOrchestration.ts', 'Technician workflow items explicitly state deterministic category satisfaction and no image-byte inspection; report metadata includes no OpenCV/OCR/YOLO runtime.', 'Safe planning surface for future hints; not a runtime analysis surface.'],
  ['lib/engineeringIntelligence/photoGrouping.ts', 'Groups photos by canonical manifest metadata, timestamps, filenames, submitted category, dimensions/orientation metadata, and stable ids; states no OCR/OpenCV/YOLO/ML.', 'Future EXIF/orientation candidates can feed a quarantine table; current grouping should remain deterministic and metadata-only.'],
  ['lib/engineeringIntelligence/signalExtraction.ts', 'Structured signals are deterministic projections of canonical evidence rows, explicit fields, grouping metadata, CAD readiness metadata, and invalidation metadata; states no image-byte or visual inference.', 'Candidate metadata may be shown as review context only, not as confirmed signals.'],
  ['lib/engineeringIntelligence/contextResolution.ts', 'Context resolution arbitrates structured signals and canonical ids; states no text/vision extraction, pixel inspection, geometry inference, or autonomous decisions.', 'Assisted metadata must never become authoritative/preferred context without review.'],
  ['lib/engineeringIntelligence/cadReadiness.ts', 'Readiness comes from canonical evidence categories, explicit survey physical fields, and structured signals; promotion is constrained when explicit primary evidence is required.', 'Candidate hints cannot mark CAD readiness ready. They may create review-required warnings.'],
  ['lib/engineeringIntelligence/recommendationEngine.ts', 'Recommendation output includes explicit no OpenCV/cv2 and no TensorFlow/PyTorch/YOLO/vision-runtime boundaries.', 'Recommendations may point to missing evidence review but must not call assistance runtime.'],
  ['lib/engineeringIntelligence/workflowOrchestration.ts', 'Workflow orchestration output includes explicit no OpenCV/cv2 and no TensorFlow/PyTorch/YOLO/vision-runtime boundaries.', 'Workflow actions may queue human review, not assisted mutation.'],
].map(([File, VerifiedBoundary, FutureIntegrationRule]) => ({ File, VerifiedBoundary, FutureIntegrationRule }));

const depsRows = Object.entries(scan.packageDependencies).map(([Dependency, Version]) => ({ Dependency, Version, AuditClassification: /tesseract/i.test(Dependency) ? 'OCR runtime dependency present' : /sharp/i.test(Dependency) ? 'Image-processing dependency present' : /exif/i.test(Dependency) ? 'Image metadata dependency present' : 'Image/OCR adjacent dependency present' }));

const engineeringBoundaryExamples = scan.engineeringBoundaryFindings.map((finding) => ({ File: `${finding.file}:${finding.line}`, Token: finding.token, Text: finding.text, Classification: /no |future|must not|documented|not activated/i.test(finding.text) ? 'boundary declaration / future-only note, not active runtime import' : 'review manually' }));

const validationBlock = `Validation status at report generation: pending. Required commands are npm run check:engineering-boundaries, npm run check:topology, npm run type-check, npm test, npm run build, and npm run lint. Final validation results are recorded in the delivery response after execution.`;

write('existing-image-runtime-inventory-v1-report.md', `# Existing Image Runtime Inventory V1 Report

Generated: ${generatedAt}
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Executive inventory

The audit found existing image/OCR/text-extraction runtime in SolarPro, but the active runtime is concentrated in utility-bill and diagnostic routes rather than the Engineering Intelligence canonical evidence stack. The scan covered ${scan.scannedFileCount} files and produced ${scan.findingCount} token findings. It identified ${scan.directRuntimeFindingCount} direct runtime findings and dependency references for ${Object.keys(scan.packageDependencies).join(', ') || 'none'}.

The active OCR/vision paths are not appropriate plug-in points for bounded engineering evidence assistance. They exist for utility-bill intake and debugging, include Tesseract, pdftotext/pdf-parse, OpenAI Vision, Google Vision, and Claude image extraction references, and should remain fenced from survey evidence, requirement satisfaction, CAD readiness, recommendation ranking, and workflow orchestration.

## Dependency inventory

${table(depsRows, ['Dependency', 'Version', 'AuditClassification'])}

## Runtime and route inventory

${table(runtimeRows, ['File', 'Classification', 'VerifiedEvidence', 'BoundaryDecision'])}

## Engineering boundary keyword findings

The raw scan reported ${scan.engineeringBoundaryRuntimeRiskCount} engineering-boundary keyword findings. Manual review classifies the examples as explicit guardrail or future-only text, not active Engineering Intelligence OCR/CV runtime imports. The current boundary scan remains important because these text references could otherwise mask future runtime imports if not continuously monitored.

${table(engineeringBoundaryExamples.slice(0, 30), ['File', 'Token', 'Text', 'Classification'])}

## Inventory conclusion

SolarPro already has active OCR/vision-style code, but it is utility-bill specific and not a safe reusable foundation for Engineering Intelligence evidence assistance. Engineering Intelligence and survey-evidence modules currently rely on canonical rows, explicit survey fields, deterministic metadata, and review-visible states. No direct OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, perceptual hashing, semantic scene classification, object detection, roof segmentation, geometry extraction, or autonomous CAD generation runtime was verified in the Engineering Intelligence/survey evidence path during this audit.

${validationBlock}
`);

write('pre-cv-open-source-evidence-assistance-audit-v1-report.md', `# Pre-CV / Open-Source Evidence Assistance Audit V1 Report

Generated: ${generatedAt}
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Recommendation

GO WITH GUARDS for Bounded Computer Vision / Open-Source Evidence Assistance V1.

The system is not ready for direct CV/OCR integration into engineering state, requirement satisfaction, CAD readiness, recommendations, or workflow orchestration. It is ready to design a bounded assistance layer only if the layer is quarantined, candidate-only, review-required, provenance-linked, confidence-labeled, invalidatable, and blocked from canonical evidence mutation until a human reviewer accepts or translates the candidate into explicit canonical survey evidence metadata.

## Verified audit scope

The audit covered Engineering Intelligence, survey evidence manifests, canonical evidence hydration, duplicate hygiene, deterministic photo grouping, structured signals, context resolution, CAD readiness, recommendation ranking, workflow orchestration, UI-adjacent references, active upload routes, bill OCR routes, debug routes, dependencies, scripts, and tests. The audit added scan/report artifacts only and did not add OpenCV, OCR, YOLO, TensorFlow, PyTorch, MediaPipe, ONNX, image-byte inspection, perceptual hashing, semantic classification, object detection, roof segmentation, geometry extraction, autonomous CAD generation, or autonomous engineering decisions.

## Scan evidence

The audit scan examined ${scan.scannedFileCount} files and found ${scan.findingCount} references across OCR/CV/image-byte/upload/canonical-mutation keyword categories. It found ${scan.directRuntimeFindingCount} direct runtime findings, concentrated in utility bill OCR/debug/test/dependency paths. Package-level image/OCR dependencies are ${Object.entries(scan.packageDependencies).map(([name, version]) => `${name}@${version}`).join(', ')}.

## Existing image/CV/OCR inventory

${table(runtimeRows, ['File', 'Classification', 'VerifiedEvidence', 'BoundaryDecision'])}

## Active prohibited paths

No active prohibited Engineering Intelligence path was verified. The active prohibited-adjacent runtime paths are existing business/diagnostic OCR and vision routes, especially app/api/ocr/route.ts, app/api/bill-upload/route.ts, app/api/debug/ocr/route.ts, app/api/debug/bill/route.ts, lib/billClaudeExtractor.ts, and lib/intake/utilityBillIntelligence.ts. They are prohibited as sources for engineering evidence assistance unless they are redesigned behind the future sandbox and stripped of direct canonical influence. Existing survey photo/project file upload routes read file bytes for validation/storage, but no OCR/CV/ML runtime was verified there.

## Safe future plug-in points

The safest future plug-in point is after raw upload/storage and before canonical manifest mutation: an assisted-evidence sandbox that receives a raw file reference, creates candidate metadata only, records provenance and tool version, marks outputs review_required, and exposes candidates to a reviewer. The next safest integration surface is UI review context in the Engineering Intelligence workspace, where candidates can be displayed as non-authoritative hints next to canonical evidence gaps. The canonical manifest, requirement registry, signal extraction, context resolution, CAD readiness, recommendation engine, and workflow orchestration should consume only accepted/reviewed evidence state, not raw candidate outputs.

## Boundaries required before GO

The required guards are: a separate assisted_metadata_candidate model; no writes into SurveyEvidenceManifest items; no direct requirementSatisfied changes; no direct CAD readiness promotion; no direct structured-signal confirmed state; no direct authoritative/preferred context state; no workflow queue auto-action beyond human review; no hidden debug/utility OCR route reuse; no cloud-vision/LLM vision reuse for engineering evidence V1; no image-byte analysis outside a single sandbox module; deterministic invalidation of candidates when source files, tool versions, thresholds, or reviewer decisions change; and audit logs for every candidate and reviewer action.

## Readiness assessment

The Engineering Intelligence architecture is review-visible and deterministic enough to accept candidate metadata as long as candidates remain non-authoritative. Existing utility-bill OCR/vision paths create material risk because they normalize the presence of OCR/vision code in active routes. Therefore the recommendation is GO WITH GUARDS, not full GO. Without the guards, the answer becomes NO-GO because candidate metadata could be mistaken for canonical truth or because existing OCR/debug routes could be reused improperly.

${validationBlock}
`);

write('assisted-metadata-sandbox-design-v1-report.md', `# Assisted Metadata Sandbox Design V1 Report

Generated: ${generatedAt}

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
`);

write('assisted-evidence-review-workflow-v1-report.md', `# Assisted Evidence Review Workflow V1 Report

Generated: ${generatedAt}

## Review objective

The review workflow must convert non-authoritative candidate metadata into explicit reviewer decisions without allowing hidden state mutation. Assistance can reduce reviewer effort by surfacing quality problems and likely evidence categories, but a human must decide whether any candidate becomes canonical metadata, a rejected hint, a request for additional field evidence, or a note with no engineering effect.

## Required workflow states

The workflow should begin when a raw upload exists and the candidate sandbox emits candidate_generated records. Every candidate immediately enters review_required. A reviewer can mark it accepted_by_reviewer, rejected_by_reviewer, needs_recapture, duplicate_candidate_only, informational_only, or superseded. Only accepted_by_reviewer may create or update an explicit reviewed metadata record, and that reviewed record must preserve the candidate id and reviewer id in provenance. Rejected, informational, and duplicate-only candidates must never influence requirement satisfaction.

## Reviewer UI requirements

The UI should show the raw image/file reference, candidate type, candidate confidence label, tool version, source file id, candidate age, invalidation status, and exactly which engineering requirement or capture category would remain blocked unless a reviewer acts. It should not show candidates as truth. The wording should use candidate, hint, possible, needs review, and not verified. It must avoid confirmed, detected, measured, code compliant, CAD ready, engineering approved, or satisfied unless the value comes from reviewed canonical evidence.

## Canonical influence rules

Reviewer acceptance may create explicit metadata such as reviewed category, reviewed quality flag, reviewed duplicate relation, reviewed text-region-present flag, or reviewed recapture request. Reviewer acceptance must not fabricate roof planes, meter ratings, panel ratings, breaker sizes, route lengths, set-back dimensions, structural spans, or CAD geometry. If a candidate suggests a requirement may be satisfied, the requirement remains missing or review_required until canonical evidence metadata and any required explicit survey fields are present.

## Workflow orchestration impact

Deterministic workflow orchestration may queue a human review action when candidate metadata exists, candidate quality is poor, a required evidence category remains missing, or an invalidated candidate needs re-review. It must not queue autonomous CAD regeneration, automatic permitting updates, automatic requirement satisfaction, or hidden evidence promotion. The workflow action should name the candidate ids and blocked requirements, not mutate them.

## Audit trail

Every reviewer action must append immutable provenance containing reviewer id, timestamp, source candidate id, previous status, new status, reason, and any canonical evidence id affected. The review trail must be visible in Engineering Intelligence and report exports. Candidate-to-canonical mappings must be diffable and invalidatable so a later source-file or tool-version change can show why a prior decision remains valid or must be reviewed again.
`);

write('cv-boundary-risk-register-v1-report.md', `# CV Boundary Risk Register V1 Report

Generated: ${generatedAt}
Scan source: outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-scan.json

## Risk register

${table([
  { Risk: 'Existing utility-bill OCR reused for engineering evidence', Evidence: 'app/api/ocr/route.ts and app/api/bill-upload/route.ts contain active Tesseract/OCR/vision paths.', Severity: 'High', Disposition: 'Do not reuse. Create a separate future sandbox with candidate-only output.' },
  { Risk: 'Reachable debug OCR endpoints become hidden evidence paths', Evidence: 'app/api/debug/ocr/route.ts and app/api/debug/bill/route.ts contain pdftotext, pdf-parse, Tesseract, and OpenAI Vision references.', Severity: 'High', Disposition: 'Gate, isolate, or disable before assistance V1; fail scans if imported by evidence modules.' },
  { Risk: 'Candidate metadata satisfies requirements without review', Evidence: 'Requirement registry currently uses canonical evidence policies; future OCR flags are documented but inactive.', Severity: 'High', Disposition: 'Add tests that candidate metadata cannot set requirementSatisfied or confidenceSource canonical.' },
  { Risk: 'Candidate metadata promotes CAD readiness', Evidence: 'cadReadiness.ts promotes only canonical categories, explicit survey fields, and structured signals with explicit-primary constraints.', Severity: 'High', Disposition: 'Keep candidates outside readiness inputs until accepted by reviewer.' },
  { Risk: 'Perceptual hash or image similarity collapses canonical evidence incorrectly', Evidence: 'sessionGrouping.ts currently notes no image bytes or perceptual hash used.', Severity: 'Medium', Disposition: 'Similarity can be duplicate_candidate_only until reviewer accepts.' },
  { Risk: 'Cloud vision/LLM image path leaks into evidence assistance', Evidence: 'OpenAI Vision, Google Vision, and Claude image extraction references exist in bill/debug/intake paths.', Severity: 'High', Disposition: 'Exclude cloud vision/LLM vision from V1 open-source bounded assistance.' },
  { Risk: 'Future OpenCV/Yolo/ML roadmap references misread as active capability', Evidence: 'Engineering boundary findings are mostly no-runtime or future-only declarations.', Severity: 'Medium', Disposition: 'Keep reports explicit; improve scan categories if implemented later.' },
  { Risk: 'Upload storage byte reads confused with image analysis', Evidence: 'survey upload/project-file routes use arrayBuffer/Buffer/writeFile for validation/storage.', Severity: 'Medium', Disposition: 'Classify as storage-only; sandbox must be separate.' },
  { Risk: 'Assistance bypasses reviewer via workflow orchestration', Evidence: 'workflowOrchestration.ts has deterministic no-vision runtime boundaries.', Severity: 'High', Disposition: 'Workflow can queue review only, not mutate engineering state.' },
  { Risk: 'Debug/test-only routes remain publicly reachable', Evidence: 'Scan classifies debug OCR routes as reachable-debug-route.', Severity: 'Medium', Disposition: 'Require auth/admin gating validation before production CV assistance.' },
], ['Risk', 'Evidence', 'Severity', 'Disposition'])}

## Fixes made in this audit

This audit added scan/report artifacts only. It did not change runtime behavior, dependencies, route handlers, canonical evidence logic, requirement evaluation, Engineering Intelligence scoring, CAD readiness, recommendations, workflow orchestration, or UI state mutation.

## Deferred risks

Deferred risks include formal auth review of debug routes, explicit automated tests for candidate-to-requirement isolation, explicit automated tests for candidate-to-CAD-readiness isolation, future creation of a candidate metadata schema, and future scan hardening to distinguish guardrail text from direct runtime imports automatically.

## Recommendation

GO WITH GUARDS. The current architecture has adequate deterministic boundaries to host a future candidate-only sandbox, but the existing OCR/vision/bill/debug paths are too risky to reuse and must remain fenced. If candidate metadata is allowed to affect canonical evidence, requirements, CAD readiness, recommendations, or workflow orchestration before review, the recommendation changes to NO-GO.
`);

console.log('Generated Pre-CV evidence assistance audit reports:');
console.log('- outputs/real-survey-data-validation/pre-cv-open-source-evidence-assistance-audit-v1-report.md');
console.log('- outputs/real-survey-data-validation/existing-image-runtime-inventory-v1-report.md');
console.log('- outputs/real-survey-data-validation/assisted-metadata-sandbox-design-v1-report.md');
console.log('- outputs/real-survey-data-validation/assisted-evidence-review-workflow-v1-report.md');
console.log('- outputs/real-survey-data-validation/cv-boundary-risk-register-v1-report.md');
