# Assisted Evidence Guardrails V1 Report

## Boundary Rules

Candidate metadata must not be imported into or consumed directly by canonical evidence modules or Engineering Intelligence runtime modules. The boundary guard scans the required canonical/runtime files and fails if they import or mention `assistedEvidence`. The future allowed bridge remains `ReviewedEvidenceProjection -> explicit reviewed mapping layer -> canonical evidence / survey metadata`, and that mapping layer is not implemented in this phase.

## Boundary Script

`scripts/check-assisted-evidence-boundaries.js` enforces assisted evidence containment. The npm script `check:assisted-evidence-boundaries` runs the scan. The guard checks that `lib/assistedEvidence/` does not introduce Tesseract, OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, image-byte analysis, perceptual hashing, semantic scene classification, object detection, roof segmentation, geometry extraction, direct canonical mutation, direct requirement satisfaction, direct CAD readiness promotion, recommendation generation, or workflow orchestration.

## UI Guardrail

The Engineering Intelligence admin page now includes a review-only Assisted Evidence Sandbox panel. It displays candidates, review-required counts, accepted/rejected/invalidated counts, limitations, provenance, and reviewed projections. It shows the warning: “Candidate metadata is non-authoritative and does not affect engineering truth until reviewed and explicitly mapped.” The panel uses deterministic fixture metadata only and performs no canonical promotion.

## Prohibited Runtime Confirmation

No new CV/OCR/image-processing dependency was added. No runtime image intelligence was implemented. No image bytes are inspected by the assisted evidence namespace. No OCR, object detection, scene classification, segmentation, geometry extraction, CAD generation, autonomous engineering decision, autonomous regeneration, or LLM image interpretation was introduced.

## Future Allowed Integration Path

Future bounded open-source evidence assistance may write candidate metadata only into this sandbox namespace. Candidates must remain non-authoritative, review-required, provenance-linked, confidence-labeled, invalidatable, and blocked from canonical mutation until a reviewer accepts fields into a reviewed projection and a future explicit mapping layer is separately implemented and guarded.
