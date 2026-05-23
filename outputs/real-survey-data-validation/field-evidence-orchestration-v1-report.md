# Field Evidence Orchestration v1 Report

## Scope

This report documents the deterministic field evidence orchestration model added for partner survey and mobile workflows. The model is metadata for survey capture ordering and evidence completeness. It does not inspect image bytes, run computer vision, infer scene semantics, or act as an AI copilot.

## Implemented model

The implementation is in `lib/survey/evidence/fieldOrchestration.ts`. It exports `buildFieldEvidenceOrchestrationModel()` and `fieldEvidenceStepForCategory(category)`. The model version is `field_evidence_orchestration_v1`, and the movement logic is explicitly `technician_movement_order`.

The workflow follows technician movement rather than random uploaded photo order. The encoded sequence is exterior overview, utility service, main service equipment, routing path, attic/structural area, roof planes and obstructions, detached structures, ESS/battery, and ground mount/trench. Each step includes movement zone metadata, group ID, technician instruction, capture items, backtracking rationale, and completion signals.

## Canonical groups

The orchestration model includes the required canonical field evidence groups: Utility, Electrical, Roof, Structural, Routing, Detached Structures, ESS / Battery, and Ground Mount / Trench. Capture items map to canonical evidence categories such as overview, utility access, meter, utility connection, main service panel, disconnect, grounding, subpanel, inverter location, garage interior wall, trench path, attic access, rafters, attic, roof plane, roof edge, ridge, obstructions, roof surface, detached structures, battery location, and gateway location.

## Engineering and CAD-readiness linkage

Each capture item includes geometry traceability notes, engineering usage notes, and CAD-readiness signal names. These are declarative metadata only. They help downstream UI and validation layers explain why evidence was requested and which engineering/CAD-readiness contexts it may support, without generating CAD or inferring geometry from photos.

## Prohibited runtime behavior

The model explicitly declares that it does not introduce AI copilot runtime, OpenCV runtime, OCR runtime, YOLO runtime, semantic inference, image-byte analysis, autonomous CAD generation, or autonomous regeneration. Future capabilities can be represented only as metadata and are not activated by this model.

## Regression coverage

`lib/survey/evidence/fieldOrchestration.test.ts` validates deterministic movement ordering, movement zones, canonical group labels, readiness-relevant categories, required capture items, category-to-step mapping, and prohibited runtime behavior declarations.
