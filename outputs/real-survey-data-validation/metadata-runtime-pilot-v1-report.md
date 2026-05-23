# Metadata Runtime Pilot V1 Report

## Scope

This phase implements the first controlled real runtime under the governed assisted evidence framework. The runtime is strictly limited to image metadata and photo-quality candidate extraction. It does not implement OCR, computer vision, semantic image understanding, object detection, segmentation, roof interpretation, geometry extraction, engineering inference, CAD integration, recommendation influence, workflow influence, autonomous decisions, canonical evidence mutation, or network inference calls.

The only approved runtime flow is:

`registered metadata runtime -> adapter-contained metadata extraction -> deterministic normalized payload -> createCandidate() -> markReviewRequired() -> review-only admin surfacing`

## Runtime Intake

The selected runtime package is `sharp@0.34.5`, already pinned in the repository lockfile and licensed as Apache-2.0. It was selected because it is already present in the dependency graph, is widely maintained, supports server-side deterministic image metadata extraction, does not require model weights, does not perform network calls for metadata extraction, and can be contained behind a single server adapter. The pilot uses only `sharp(imageBytes, { failOn: 'none' }).metadata()` and does not invoke transform, analysis, segmentation, classification, recognition, or inference APIs.

The existing `exif-reader@2.0.3` package was considered because it is MIT licensed and already present, but it was not selected as the primary runtime because it only parses EXIF structures and does not provide the broader dimension/format metadata extraction needed for this pilot by itself. Browser APIs were rejected because the pilot must be server-safe and adapter-contained. Tesseract, OpenCV, TensorFlow, YOLO, ONNX, MediaPipe, and model-based tools were rejected because they exceed the metadata/photo-quality scope.

## Registered Runtime

The runtime is registered as `sharp-metadata-runtime@0.34.5` in `lib/assistedEvidenceSources/openSourceToolRegistry.ts`. Its registry definition uses license `Apache-2.0`, runtime category `image_metadata`, runtime boundary `server_adapter_contract`, deterministic replay support `runtime_payload_hash_required`, risk level `low`, enabled status `enabled_for_runtime_pilot`, server-only execution, no model weights, and review-required candidate generation. The registry continues to require `canonicalMutationAllowed: false`.

## Adapter Implementation

The runtime adapter is implemented in `lib/assistedEvidenceSources/metadataRuntimeAdapter.ts`. This is the only approved file importing `sharp`. The adapter extracts metadata from provided image bytes, normalizes format, width, height, orientation, density, EXIF presence, ICC/profile presence, alpha presence, page count, byte length, and a file-size bucket. It then derives deterministic candidate signals for orientation, invalid dimensions, low resolution, missing EXIF metadata, large image file size, and a metadata-only duplicate fingerprint.

The duplicate signal is not a perceptual hash and not an image comparison. It is a low-confidence metadata-only fingerprint intended solely for review queue hygiene.

## Determinism

The adapter produces stable candidate ordering by sorting runtime signals by `signalId` and relying on the shared candidate normalization bridge for candidate input ordering. Runtime payloads are hashed with deterministic stable stringify, and candidate creation is routed through the existing deterministic assisted evidence lifecycle. The same image bytes and source context produce the same normalized payloads, candidate order, candidate hashes, and review-required statuses.

## Review-Only Output

All runtime outputs are generated as non-authoritative assisted evidence candidates. The adapter calls `createReviewRequiredCandidates()`, which converts normalized payloads to `createCandidate()` inputs and then applies `markReviewRequired()`. The runtime output cannot create accepted projections, canonical evidence, engineering requirements, CAD readiness metadata, recommendations, or workflows.

## Admin Surfacing

The Engineering Intelligence assisted evidence sandbox now includes a deterministic runtime sample candidate set. Runtime candidates are labeled separately from fixture candidates as `RUNTIME DATA · NON-AUTHORITATIVE · REVIEW REQUIRED`. The panel displays candidate type, confidence, provenance, source runtime, source version, source file, upload key, and limitations.
