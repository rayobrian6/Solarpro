# Structured Engineering Signals V1 Report

Structured Engineering Signals V1 adds a deterministic Engineering Intelligence layer that converts canonical survey evidence and deterministic metadata into structured signals before requirements, decisions, CAD-readiness metadata, and output-impact inspection consume the result. The implemented flow is `canonical evidence -> structured engineering signals -> requirements -> decisions -> outputs`; the signal layer does not inspect images, run OCR, run CV, infer geometry, classify visual content, create CAD primitives, make engineering decisions, or trigger autonomous regeneration.

## Implemented signal model

The signal model is defined in `lib/engineeringIntelligence/signalTypes.ts` and built by `lib/engineeringIntelligence/signalExtraction.ts`. Each `StructuredEngineeringSignal` records a stable `id`, registry `signal_type`, category, status, deterministic confidence score and band, source classifications, explicit evidence/photo/survey ids, derived-from lineage, dependency nodes, requirement impacts, decision impacts, CAD impacts, stale impacts, invalidation events, generation time, deterministic hash, explanation, blocking reasons, and partial reasons. Status values are constrained to `confirmed`, `partial`, `blocked`, `missing`, and `not_applicable`.

The signal registry in `lib/engineeringIntelligence/signalRegistry.ts` covers all required initial V1 signals across utility/electrical, roof/structural, routing, ESS, ground/trench, and survey-quality categories. Confidence is deterministic and based on explicit evidence count, explicit survey field support, deterministic grouping clusters, grouped CAD-readiness context, metadata completeness, and invalidation participation. The score is never presented as AI confidence.

## Truth boundaries

Signals are derived only from canonical manifest rows, explicit survey field data, deterministic photo grouping metadata, grouped CAD-readiness context, CAD-readiness metadata, invalidation metadata, propagation metadata, and project/survey ids. Missing truth remains visible through `missing`, `blocked`, `partial`, and `not_applicable` states. Optional contexts such as ESS, attic access, trench path, detached structure, subpanel, and disconnect remain `not_applicable` when explicit context is absent rather than being fabricated.

## Requirement and CAD integration

`lib/survey/evidence/engineeringRequirements.ts` now accepts an optional `StructuredEngineeringSignalSummary`, maps signals into requirement evaluations, records linked signal ids/types/statuses, and allows requirements to be satisfied by confirmed structured signals when metadata is sufficient. CAD readiness in `lib/engineeringIntelligence/cadReadiness.ts` consumes structured signals and exposes `structuredSignalIds`, `unresolvedAssumptions`, and `defaultPolicyFallbacks` per flag. It also adds `ESS-location-ready` and differentiates explicit canonical evidence, explicit field signals, deterministic structured signals, unresolved assumptions, and default policy fallbacks.

## UI workspaces

The Engineering Intelligence project workspace now renders Structured Engineering Signals, Signal Provenance, Signal Dependency Graph, Signal-to-Requirement Mapping, Signal Confidence Breakdown, Signal Blocking Reasons, Signal Invalidations, and Signal Stale Impacts. These workspaces are runtime inspection surfaces rather than analytics dashboards. They show why each signal exists, why it is partial/blocked/missing, what evidence contributed, what requirements/CAD readiness flags it impacts, and which invalidation/stale/fallback records participate.

## Regression coverage

`lib/engineeringIntelligence/signalExtraction.test.ts` covers sparse surveys, exterior-only surveys, missing MSP, missing roof context, interrupted traversal, duplicate timestamp metadata, detached structure context, trench context, ESS context, invalidation participation, stale signal propagation, deterministic reruns, hash stability, dependency graph stability, confidence stability, and CAD readiness fallback visibility.
