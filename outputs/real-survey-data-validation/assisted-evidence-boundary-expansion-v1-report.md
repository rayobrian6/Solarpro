# Assisted Evidence Boundary Expansion V1 Report

## Scope

This phase expands the assisted evidence boundary guard so the new `lib/assistedEvidenceSources/` namespace is checked alongside the existing `lib/assistedEvidence/` sandbox. The expansion is designed to enforce the first safe execution phase: registry and fixture adapters only, with no real OCR/CV/image-processing runtime and no influence over canonical engineering outputs.

## Script Updated

`scripts/check-assisted-evidence-boundaries.js` now scans both assisted evidence namespaces and continues to inspect canonical and Engineering Intelligence boundary targets. The successful boundary run reports scanned file counts for assisted evidence files, assisted evidence source files, and canonical/Engineering Intelligence files.

## Source Namespace Containment

The new guard prevents `lib/assistedEvidenceSources/` from importing or mutating canonical and engineering layers. Forbidden source imports include canonical survey evidence, engineering signal extraction, context resolution, CAD readiness, recommendation engine, workflow orchestration, calculation, and regeneration modules.

This keeps source adapters upstream of the review queue only. Adapter code can normalize fixture payloads and route to the assisted evidence lifecycle, but it cannot reach downstream truth, CAD, recommendation, or workflow systems.

## Runtime Prohibition Coverage

The expanded guard scans assisted evidence files and source adapter files for prohibited runtime patterns, including:

- Tesseract and OCR worker execution patterns.
- OpenCV and OpenCV JavaScript packages.
- YOLO and Ultralytics object detection patterns.
- TensorFlow and TensorFlow.js patterns.
- PyTorch runtime references while avoiding unrelated false positives such as `flat_torch`.
- ONNX runtime references.
- MediaPipe runtime references.
- Image-byte analysis APIs such as `getImageData`, pixel data inspection, image decoding, `arrayBuffer()`, `Buffer.from()`, and direct file reads.
- Perceptual hashing patterns.
- Semantic scene classification, object detection, roof segmentation, and geometry extraction phrases.

The guard also blocks direct canonical mutation signals, canonical mutation opt-in values, SQL mutation patterns, and database insert/upsert/delete/update contexts.

## Adapter Routing Enforcement

Fixture adapter files and the shared normalization bridge are checked to ensure candidate generation routes through the safe lifecycle. Adapter generation must use either direct `createCandidate()` and `markReviewRequired()` calls or the shared `createReviewRequiredCandidates()` helper. This preserves the required quarantine semantics for all generated candidates.

## False-Positive Controls

The script was adjusted to avoid blocking safe deterministic hashing and schema declarations. It does not treat SHA-256 `.update()` as a database update. It does not treat schema fields such as `requiresImageBytes: false` as image-byte analysis. It allows negative tests that intentionally assert rejection of unsafe values such as `canonicalMutationAllowed: true` when those values appear inside `expect(...).toThrow(...)` assertions. Type-only adapter contract files are not treated as runtime execution files.

## Passing Boundary Result

The expanded guard passed after implementation with the following result:

```text
Assisted evidence boundary guard passed. Scanned 8 assistedEvidence files, 12 assistedEvidenceSources files, and 7 canonical/Engineering Intelligence boundary files.
```

## Safety Guarantee

The boundary expansion enforces that fixture source code cannot introduce real OCR/CV runtime, cannot inspect image bytes, cannot perform object detection or geometry extraction, cannot mutate canonical evidence, cannot write database state, cannot satisfy engineering requirements, cannot create CAD readiness, cannot influence recommendations, and cannot orchestrate workflows. It supports only review-required assisted evidence candidate generation from registered fixture sources.
