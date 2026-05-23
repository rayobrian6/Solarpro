# Metadata Runtime Boundary V1 Report

## Boundary expansion implemented

`scripts/check-assisted-evidence-boundaries.js` was expanded to protect the survey-aligned runtime pilot from uncontrolled runtime escalation and hidden canonical influence. The guard now scans assisted evidence modules, assisted evidence source modules, and canonical Engineering Intelligence boundary files.

## New protections

The guard blocks forbidden source imports from assisted evidence runtime namespaces into survey evidence, survey ingestion, survey database helpers, survey upload routes, engineering signal extraction, context resolution, CAD readiness, recommendations, workflow orchestration, calculations, and regeneration modules. This prevents runtime bypass of governed adapters and prevents assisted-evidence code from reaching canonical survey or engineering truth paths directly.

The guard blocks runtime/package escalation patterns including Tesseract, OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, raw image-byte analysis patterns, perceptual hashing, semantic scene classification, object detection, roof segmentation, and geometry extraction. These checks are intentionally broad and fail loudly if future work attempts to introduce OCR/CV/geometry behavior into the metadata runtime boundary.

The guard blocks canonical mutation patterns including direct calls to survey evidence manifest builders, engineering requirement evaluation, CAD readiness metadata builders, recommendation builders, workflow orchestration builders, SQL insert/update/delete patterns, explicit `canonicalMutationAllowed: true`, and database update patterns. It also blocks survey table mutation text patterns in assisted runtime code unless the file is the approved survey-alignment bridge documenting source identity.

The guard blocks duplicate blur, metadata, and hashing system patterns. Approved exceptions are limited: the existing core deterministic hash implementation in `lib/assistedEvidence/candidateRegistry.ts`, the existing metadata adapter's internal runtime payload hashing, the approved survey alignment bridge's source reference documentation, and safe test fixture references. These exceptions are deliberately file-scoped rather than global.

## Registration and adapter enforcement

Candidate-generating runtime files must resolve a registered open-source tool before execution or delegate to an approved registered runtime bridge. The survey ingestion bridge is permitted only because it delegates to `generateMetadataRuntimeCandidates()` and does not import runtime packages directly. Test files are excluded from runtime implementation enforcement so deterministic tests can call the bridge under test without being treated as production adapters.

## Canonical backflow scan

The guard continues scanning canonical/Engineering Intelligence boundary files and fails if those files import or consume assisted evidence runtime candidates directly. This preserves the one-way review-only boundary and prevents runtime output from becoming canonical engineering input without an explicit future governed review workflow.

## Validation result

After refinement, `npm run check:assisted-evidence-boundaries` passed and reported that it scanned eight assistedEvidence files, sixteen assistedEvidenceSources files, and seven canonical/Engineering Intelligence boundary files. This result confirms that the new bridge is inside the governed namespace and that current runtime code does not contain prohibited OCR, CV, geometry, canonical mutation, database mutation, duplicate metadata, duplicate blur, or duplicate hashing behavior outside approved boundaries.
