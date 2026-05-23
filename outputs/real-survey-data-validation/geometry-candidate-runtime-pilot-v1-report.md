# Geometry Candidate Runtime Pilot V1 Report

This report documents the first controlled geometry-adjacent assisted evidence runtime pilot. The pilot is review-only, non-authoritative, candidate-only, and non-mutating. It intentionally does not implement roof generation, CAD generation, autonomous geometry extraction, setback generation, routing authority, NEC interpretation, panel layout influence, or autonomous spatial engineering. The implementation validates the governed runtime pathway for a single geometry-adjacent candidate class while preserving deterministic engineering truth isolation.

## Implemented pilot category

The pilot implements exactly one category: `possible_obstruction_candidate`. No `possible_roof_edge_candidate` runtime, `possible_ridge_candidate` runtime, roof-plane runtime, setback runtime, routing runtime, CAD runtime, panel-layout runtime, NEC runtime, obstruction-map runtime, segmentation runtime, object-detection runtime, or autonomous geometry extraction runtime was implemented.

`possible_obstruction_candidate` was selected because it can be constrained to source-image review triage. The candidate says only that a source image has obstruction-like review context and should be reviewed by a human. It does not identify the obstruction, measure the obstruction, locate the obstruction, create an obstruction footprint, create an exclusion zone, create a setback, filter panels, estimate shade loss, mutate CAD, mutate roof planes, mutate layout, satisfy requirements, influence NEC, or modify engineering truth.

## Runtime namespace and adapter containment

The pilot is implemented under `lib/assistedEvidenceSources` using an adapter-contained runtime pattern:

- `geometryCandidateTypes.ts` defines the runtime constants, the single allowed label, explicit limitation references, runtime payload schema, source-image lineage fields, and candidate-only stale propagation classes.
- `geometryCandidateRuntimeAdapter.ts` performs deterministic source-context normalization and source image byte hashing, normalizes runtime signals into assisted evidence candidate payloads, and routes candidate creation through `createReviewRequiredCandidates()`.
- `geometryCandidateRuntimeBridge.ts` resolves the registered runtime tool, asserts that the registry allows `possible_obstruction_candidate`, extracts a runtime payload, and delegates candidate generation to the adapter.

The runtime is server-side only and registered as `deterministic-geometry-adjacency-runtime` version `1.0.0` under the `geometry_adjacency_candidate` runtime category. Registry validation requires server adapter contract execution, `enabled_for_runtime_pilot` status, server-only execution, no browser execution, no native binaries, no model weights, deterministic runtime payload hash support, allowed candidate type restricted to `possible_obstruction_candidate`, and allowed candidate category restricted to `roof_context`.

## Deliberately weak signal source

The V1 signal source is deliberately weak as a safety control. It uses deterministic source-context normalization and stable hashing of supplied image bytes. The runtime does not decode pixels, does not inspect image geometry, does not read EXIF geometry, does not calculate edges, does not segment images, does not detect objects, does not infer roof planes, does not infer obstruction footprints, does not call cloud inference, and does not use OpenCV, YOLO, TensorFlow, ONNX, MediaPipe, Detectron, model weights, native CV libraries, or hidden network calls.

A candidate is emitted only when bounded source-context text contains obstruction-like words such as `obstruction`, `chimney`, `skylight`, `vent`, `pipe`, `satellite`, `dish`, `hvac`, or `roof jack`. If those terms are absent, the runtime emits no geometry candidate. This behavior prevents a fallback pathway from manufacturing spatial claims when no bounded review context exists.

## Candidate payload safety

Generated candidates include `nonAuthoritative: true`, `reviewRequired: true`, `candidateOnly: true`, and `projectionOnlyOnReview: true`. Candidate payloads preserve the runtime payload hash, boundary policy version, source image lineage reference, evidence basis, review region descriptor, limitation references, and stale propagation metadata.

The runtime does not emit active measurable geometry fields. It does not emit `boundingBox`, `bbox`, `polygon`, `coordinates`, `polyline`, `roofEdge`, `ridgeLine`, `valleyLine`, `plane`, `azimuth`, `tilt`, `pitch`, `setback`, `obstructionMap`, `conduitPath`, `routeLength`, `attachmentSpacing`, `rafter`, `truss`, or `cadModel`. It also does not emit CAD readiness, engineering requirement satisfaction, NEC authority, recommendation actions, workflow actions, or canonical mutation payloads.

The candidate summary explicitly states that the output is a review-required possible obstruction candidate from source image context and is not CAD input, not canonical geometry, and not engineering authority.

## Provenance and replayability

Every generated candidate preserves source-context provenance supplied by the assisted evidence source context: source file ID, source upload key, project ID, survey ID, tool run ID, tool configuration hash, source metadata hash, creation timestamp, and creator. Runtime provenance includes the runtime tool name, version, runtime category, runtime payload hash, source image byte hash, source-context text hash, deterministic input references, and boundary policy version.

The runtime payload hash is stable for the same image bytes and source-context text. Candidate deterministic hashes remain produced by the assisted evidence candidate lifecycle. This provides replayability while avoiding any claim that the runtime has created geometry truth.

## Review lifecycle

Candidate generation is routed through `createReviewRequiredCandidates()`, which uses the existing assisted evidence candidate lifecycle and marks every generated candidate review-required. Acceptance remains projection-only through the existing reviewed evidence projection path. Acceptance does not create canonical evidence, does not mutate CAD, does not mutate roof planes, does not create setbacks, does not satisfy engineering requirements, does not influence recommendations, and does not trigger workflow actions.

## Validation evidence at report time

The targeted geometry runtime suite `npm test -- lib/assistedEvidenceSources/geometryCandidateRuntimeAdapter.test.ts` passed with 9 tests. The assisted evidence boundary guard `npm run check:assisted-evidence-boundaries` passed after the guard was expanded to distinguish explicit negative-policy text from active geometry outputs. Full required validation logs are captured separately in this delivery.
