# Metadata Runtime Boundary V1 Report

## Scope

This report documents the boundary protections added for the first controlled metadata runtime pilot. The boundary guard now permits the selected metadata runtime only in the approved adapter file while continuing to block OCR, computer vision, semantic interpretation, geometry, canonical mutation, database mutation, engineering inference, CAD readiness influence, recommendation influence, and workflow orchestration.

## Approved Runtime Import

`scripts/check-assisted-evidence-boundaries.js` now defines `APPROVED_METADATA_RUNTIME_IMPORT_FILES` and `APPROVED_METADATA_RUNTIME_IMPORTS`. The only approved metadata runtime import is `sharp`, and the only approved file importing it is `lib/assistedEvidenceSources/metadataRuntimeAdapter.ts`.

If `sharp` is imported from another application, admin, canonical, engineering, recommendation, workflow, or unrelated source file, the boundary guard fails loudly.

## Adapter Routing Enforcement

The boundary guard now treats both `*FixtureAdapter.ts` and `*RuntimeAdapter.ts` as adapter files. Adapter files must route candidate generation through either direct `createCandidate()` and `markReviewRequired()` calls or the shared `createReviewRequiredCandidates()` helper. This prevents runtime output from bypassing the assisted evidence lifecycle and review-required quarantine.

## Runtime Escalation Protection

The guard continues to scan assisted evidence and assisted evidence source files for prohibited runtime and escalation patterns. It blocks Tesseract/OCR worker execution, OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, image-byte analysis APIs, perceptual hashing, semantic scene classification, direct canonical mutation, canonical mutation opt-in, SQL mutation patterns, and database insert/upsert/delete/update contexts.

The selected runtime is allowed only because it is contained to metadata extraction in a single approved adapter. The boundary policy does not allow that runtime to become a general image understanding layer.

## Source Namespace Protection

The source namespace remains blocked from importing canonical survey evidence, engineering signal extraction, context resolution, CAD readiness, recommendation engine, workflow orchestration, calculation, and regeneration modules. This prevents runtime candidates from directly influencing downstream engineering truth or operational workflow layers.

## Passing Boundary Result

The expanded boundary guard passed with runtime import containment enabled:

```text
Assisted evidence boundary guard passed. Scanned 8 assistedEvidence files, 13 assistedEvidenceSources files, and 7 canonical/Engineering Intelligence boundary files.
```

## Safety Result

The runtime pilot can inspect image bytes only inside the approved metadata adapter. It cannot perform OCR, model inference, semantic classification, object detection, segmentation, geometry extraction, canonical mutation, CAD readiness generation, recommendation generation, workflow generation, or database mutation. Its only output path is review-required assisted evidence candidates.
