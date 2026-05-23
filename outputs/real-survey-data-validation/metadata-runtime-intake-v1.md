# Metadata Runtime Intake V1

## Selected runtime

The selected runtime for this phase is the already-registered `sharp-metadata-runtime` version `0.34.5`, backed by the existing `sharp` dependency. No new package is introduced by the survey ingestion alignment bridge.

## Selection rationale

The audit found that SolarPro already completed the first controlled image metadata runtime pilot. That pilot registered `sharp-metadata-runtime@0.34.5` in the governed open-source tool registry and constrained runtime execution to `lib/assistedEvidenceSources/metadataRuntimeAdapter.ts`. Reusing that adapter is safer than introducing a new runtime because the registry status, adapter contract, deterministic normalization, review-required candidate creation, and boundary tests already exist.

`sharp` is suitable for this specific phase because it can read basic image metadata such as width, height, format, orientation, density, alpha presence, profile presence, page count, and EXIF presence without performing OCR, object detection, roof interpretation, segmentation, geometry extraction, or semantic classification. The selected adapter uses these fields only to create non-authoritative candidate signals.

## Accepted candidate signal envelope

The runtime intake accepts only the existing metadata adapter signal set: `possible_image_orientation`, `possible_low_resolution_photo`, `possible_large_image_file`, `possible_missing_exif_metadata`, `possible_invalid_photo_dimensions`, and `possible_duplicate_photo`. These remain review-required assisted-evidence candidates. They do not update `site_surveys`, `site_survey_files`, `project_physical_data`, `SurveyEvidenceManifest`, CAD readiness, engineering requirements, recommendations, or workflows.

The master directive also allowed `possible_blurry_photo`, but audit alignment takes precedence over signal expansion. Because no existing canonical blur score processor was found, the survey bridge does not create blur candidates. Instead it reports `possible_blurry_photo:no-existing-blur-score-to-reuse` in `omittedRuntimeSignals` so reviewers can see that blur was considered and intentionally not generated.

## Rejected alternatives and prohibited escalation

No OCR package, Tesseract integration, OpenCV integration, TensorFlow integration, YOLO integration, ONNX integration, MediaPipe integration, PyTorch integration, image segmentation package, object detection package, semantic classifier, roof interpretation library, geometry extractor, or CAD-adjacent inference runtime was selected. Those categories are outside this phase and are explicitly blocked by the expanded assisted-evidence boundary guard.

No duplicate metadata parser was selected. The bridge does not add an EXIF parser, does not implement custom image dimension parsing, and does not add a second hashing/fingerprinting subsystem. It delegates metadata extraction to the existing governed adapter and source identity hashing to the existing `deterministicHash()` implementation.

## Runtime contract

The permitted runtime flow is `registered runtime -> governed adapter -> deterministic normalization -> createCandidate()/createReviewRequiredCandidates() -> markReviewRequired() -> review-only surfacing`. The survey ingestion alignment bridge preserves this contract by delegating to `generateMetadataRuntimeCandidates()` instead of importing `sharp` directly or creating candidates independently.

## Intake decision

Approved for this phase: reuse existing `sharp-metadata-runtime@0.34.5` through the governed metadata adapter only. Not approved: new packages, new ingestion flows, canonical mutation, database mutation, CAD influence, engineering inference, recommendation influence, workflow influence, OCR, CV escalation, geometry extraction, semantic classification, or hidden duplicate metadata/blur/hash systems.
