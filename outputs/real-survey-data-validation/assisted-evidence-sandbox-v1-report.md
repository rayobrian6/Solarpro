# Assisted Evidence Sandbox Architecture V1 Report

## Scope

This phase implements containment only. It adds a deterministic `lib/assistedEvidence/` namespace for non-authoritative candidate metadata, review-required lifecycle transitions, reviewed projections, sandbox guard functions, a boundary scan, regression coverage, and a review-only Engineering Intelligence admin panel. It does not add OpenCV, OCR runtime, Tesseract usage, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, image-byte analysis, perceptual hashing, semantic scene classification, object detection, roof segmentation, geometry extraction, autonomous CAD generation, autonomous regeneration, LLM image interpretation, or direct CV-to-canonical evidence mutation.

## Candidate Lifecycle

`AssistedEvidenceCandidate` records are created by `createCandidate()` from deterministic fixture/manual metadata only. New candidates are always `nonAuthoritative: true` and `reviewRequired: true`. The lifecycle supports `created`, `review_required`, `accepted_by_reviewer`, `rejected_by_reviewer`, `superseded`, and `invalidated`. `markReviewRequired()` moves candidates into quarantine. `invalidateCandidate()` marks candidates inactive and prevents downstream projection. `supersedeCandidate()` preserves the original candidate while linking it to a replacement candidate id.

## Candidate Model

The model includes candidate id, source file id, source upload key, project id, survey id, candidate type/category/status, confidence, tool name/version/run id, tool config hash, source metadata hash, payload, summary, claims, limitations, provenance, and deterministic hash. Supported candidate types are metadata-only placeholders for future assistance: photo quality, orientation, duplicate similarity, text region, utility scene, electrical scene, roof edge, routing continuity, trench context, ESS context, and detached structure candidates.

## Determinism

Candidate and projection hashes use stable key ordering via `stableStringify()` and SHA-256 over explicit metadata fields. Tests verify replay stability when claim order, limitation order, and payload key order change.

## No Direct Canonical Mutation Guarantee

Candidates cannot satisfy requirements, cannot influence CAD readiness, cannot influence recommendations, cannot create workflow items, and cannot mutate canonical survey evidence. Guard functions return explicit false values for those paths. The only downstream artifact produced in this phase is a `ReviewedEvidenceProjection`, and that projection is eligible for future explicit mapping only.
