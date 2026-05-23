# CAD Readiness Metadata v1 Report

## Scope

This report documents the CAD-readiness metadata model added for Engineering Intelligence. The implementation adds deterministic readiness flags for CAD-adjacent project completeness without generating CAD, layouts, geometry, or drawings.

## Implemented model

The implementation is in `lib/engineeringIntelligence/cadReadiness.ts`. It exports `buildCADReadinessMetadata()`, which returns model version `cad_readiness_metadata_v1`. The model evaluates five readiness flags: `roof-plane-ready`, `routing-ready`, `setback-ready`, `trench-route-ready`, and `detached-structure-ready`.

Each flag reports a status of `ready`, `partial`, `blocked`, or `not_applicable`, along with satisfied canonical categories, missing categories, explicit survey signals, and a deterministic reason. Current evaluation derives status from canonical evidence manifest categories and explicit engineering survey field evidence only.

## Deterministic inputs

The metadata model can consume a canonical `SurveyEvidenceManifest` and/or `EngineeringSurveyEvidence`. It extracts canonical categories from manifest items and evidence photos. It extracts explicit field signals from already-normalized survey evidence, such as roof geometry presence, roof plane count, roof pitch, roof material, obstruction count, usable area, electrical data presence, interconnection point, and main panel rating.

## Boundary guarantees

CAD readiness is metadata only. It does not call a CAD engine, generate geometry, inspect image bytes, run OCR, run OpenCV, run YOLO, infer semantics from photos, or hallucinate missing dimensions. Trench and detached-structure readiness remain blocked unless explicit canonical categories are present; they are not inferred from generic exterior photos.

## UI integration

The project Engineering Intelligence route now renders `CADReadinessWorkspace`, which summarizes ready, partial, and blocked flags, displays each flag with satisfied/missing categories and explicit survey signals, and lists prohibited runtime behavior.

## Regression coverage

`lib/engineeringIntelligence/cadReadiness.test.ts` validates ready statuses from canonical categories plus explicit survey signals, blocked statuses for trench/detached readiness when explicit categories are absent, and the prohibited runtime behavior declarations that prevent autonomous CAD, CV, OCR, YOLO, image-byte analysis, and hallucinated geometry.
