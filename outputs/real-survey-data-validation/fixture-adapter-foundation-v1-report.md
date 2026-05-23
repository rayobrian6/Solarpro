# Fixture Adapter Foundation V1 Report

## Scope

This phase adds deterministic fixture-only adapter infrastructure for open-source assisted evidence sources. The adapters are intentionally limited to static fixture payloads and do not execute OCR, computer vision, image processing, object detection, segmentation, geometry extraction, roof interpretation, CAD integration, workflow automation, or engineering recommendation logic.

The foundation exists to prove the safe route from a governed source tool to a review-required assisted evidence candidate before any real runtime integration is considered.

## Files Added

The fixture adapter foundation is implemented under `lib/assistedEvidenceSources/` with the following files:

- `candidateAdapterTypes.ts` defines source context, raw fixture payloads, normalized candidate payloads, and adapter result contracts.
- `candidateAdapterContracts.ts` defines adapter aliases and invariant statements, including the explicit future geometry placeholder type of `never`.
- `candidateConfidenceRules.ts` clamps confidence values into the safe `0..1` range without upgrading weak evidence.
- `candidateNormalization.ts` sorts claims and limitations deterministically, adds fixture-only limitations, binds registry provenance, converts normalized payloads to assisted evidence candidate input, and routes candidate creation through `createCandidate()` followed by `markReviewRequired()`.
- `metadataFixtureAdapter.ts` converts static metadata-like fixture signals into orientation, quality, and duplicate-hygiene candidates.
- `ocrFixtureAdapter.ts` converts static OCR-like fixture text signals into text-region candidates without invoking any OCR runtime.
- `index.ts` exports the source foundation through a single namespace barrel.

## Adapter Flow

The supported flow is deliberately narrow:

`registered fixture tool -> raw fixture payload -> adapter normalization -> normalized candidate payload -> toCreateCandidateInput() -> createCandidate() -> markReviewRequired() -> review queue surface`

Adapters do not write project state, do not write canonical evidence, do not satisfy engineering requirements, do not create CAD readiness, do not influence recommendations, and do not start workflow orchestration. They only create quarantined assisted evidence candidates that require human review.

## Metadata Fixture Adapter

`fixture-image-metadata-adapter@1.0.0` accepts static metadata fixture fields such as image width, image height, orientation hint, duplicate group hint, and declared fixture signals. It can emit only the registry-approved candidate types:

- `orientation_candidate`
- `photo_quality_candidate`
- `duplicate_similarity_candidate`

The adapter does not read image bytes, decode images, calculate perceptual hashes, inspect pixels, or compare real photos. Its duplicate, orientation, and quality outputs are fixture-only candidate hints and are labeled as non-authoritative and review-required.

## OCR Fixture Adapter

`fixture-ocr-text-adapter@1.0.0` accepts static OCR-like fixture text signals and can emit only `text_region_candidate` outputs. It does not import or execute Tesseract, OCR workers, OpenCV, TensorFlow, ONNX, model weights, native binaries, or browser image APIs. The text values are fixture strings used to validate candidate lifecycle behavior only.

## Confidence Rules

Candidate and claim confidences are normalized with deterministic clamping. Non-finite values become `0`; values below `0` become `0`; values above `1` become `1`; finite values inside range are rounded to four decimal places. When multiple weak signals are combined, the foundation preserves the lowest confidence instead of upgrading uncertainty.

## Provenance and Determinism

Generated candidates include registry hashes, runtime category, runtime boundary, fixture-only flags, deterministic input references, tool version, tool run ID, tool config hash, source metadata hash, source file ID, upload key, project ID, and survey ID. Claims, limitations, and deterministic input references are sorted for replay stability. Targeted tests confirm deterministic generation for both metadata and OCR-like fixture adapters.

## Admin Surfacing

The Engineering Intelligence admin sandbox now surfaces fixture source candidates in the existing assisted evidence review-only panel. The UI labels fixture candidates as `FIXTURE DATA · NON-AUTHORITATIVE · REVIEW REQUIRED` and continues to show candidate type, confidence, source tool, source file, upload key, limitations, and provenance data. No reviewer automation, canonical mapping, or engineering truth promotion is added in this phase.

## Non-Authority Guarantee

Fixture adapter outputs remain assisted evidence candidates only. They are not canonical survey evidence, not accepted evidence projections unless explicitly reviewed in a separate lifecycle path, not engineering requirements, not CAD readiness metadata, not recommendations, and not workflow actions. This phase prepares the structure for future controlled pilots without enabling real runtime authority.
