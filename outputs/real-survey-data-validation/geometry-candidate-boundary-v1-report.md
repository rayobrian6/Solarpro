# Geometry Candidate Boundary V1 Report

This report documents the boundary protections added for the controlled geometry-adjacent evidence pilot. The boundary design preserves the invariant that deterministic engineering truth and deterministic CAD authority remain isolated from probabilistic or assisted spatial review candidates.

## Boundary objective

The pilot is allowed to create review-required assisted evidence candidates only. It is not allowed to create or mutate roof planes, CAD models, drafting outputs, plan sets, panel layouts, setbacks, conduit routes, NEC interpretations, structural facts, BOM facts, engineering requirements, readiness states, workflow actions, recommendations, canonical evidence, or source survey records.

The boundary therefore protects two surfaces. First, runtime code must not import or call authority modules. Second, runtime payloads must not contain active measurable geometry fields that could be confused with CAD, roof, setback, route, or engineering truth.

## Import and authority isolation

`scripts/check-assisted-evidence-boundaries.js` was expanded so files containing `geometryCandidate` are checked against forbidden authority imports, including CAD, drafting, plan-set, engineering, Engineering Intelligence, conduit routing, BOM, topology engine, roof geometry, roof plane, plane engine, panel layout, placement engine, and 3D rendering component namespaces.

The runtime adapter imports only crypto hashing, candidate normalization, adapter types, and geometry candidate types. It does not import CAD, roof geometry, engineering, routing, NEC, BOM, topology, database mutation, survey mutation, or rendering modules.

## Runtime pattern protections

The assisted evidence boundary checker now fails loudly on prohibited geometry-adjacent patterns, including OpenCV, YOLO, TensorFlow, PyTorch, ONNX, MediaPipe, Detectron, segmentation, legacy vision service usage, spatial detection outputs, geometry authority mutations, active geometry measurable payload fields, image decoding, perceptual hashing, semantic scene classification, CAD readiness influence, engineering recommendation influence, workflow influence, direct canonical mutation, direct database mutation, and survey table mutation.

The checker still permits explicit negative-policy vocabulary in approved geometry pilot files, such as `no_segmentation`, `no_setback_generation`, and `setback_authority` inside limitation or forbidden-use arrays. This allowance is narrow and does not permit active fields like `setback:` or active authority calls like `calcFireSetbacks()`. The guard distinguishes documentation of forbidden uses from implementation of forbidden capabilities.

## Lifecycle enforcement

Geometry runtime adapter files are required to route candidate creation through the shared assisted evidence lifecycle. The implemented adapter calls `createReviewRequiredCandidates()`, which in turn routes through candidate creation and review-required marking. The boundary checker rejects geometry candidate runtimes that bypass the review-required assisted evidence candidate lifecycle.

The runtime bridge resolves the registered open-source runtime tool and calls `assertToolCanEmitCandidateType()` before candidate generation. Registry validation restricts the geometry runtime to `possible_obstruction_candidate` and `roof_context` only, and requires server-only, review-required, non-mutating, deterministic replay behavior.

## Payload protections

The implemented candidate payload does not contain active measurable geometry fields such as bounding boxes, polygons, coordinates, polylines, roof edges, ridge lines, roof planes, azimuth, tilt, pitch, setbacks, obstruction maps, conduit paths, route lengths, attachment spacing, rafters, trusses, or CAD models. It contains only review-context metadata, confidence, source image lineage, deterministic hashes, limitation references, and candidate-only stale propagation metadata.

Forbidden uses are listed as explicit safety metadata and include canonical geometry, canonical roof plane, CAD input, CAD obstruction, drafting input, layout input, panel filter, setback authority, engineering fact, NEC authority, routing authority, conductor sizing, structural authority, production estimate, BOM input, plan-set input, readiness state, workflow trigger, recommendation trigger, and canonical mutation.

## Invalidation and stale propagation boundary

The geometry candidate payload includes candidate-only stale propagation. Allowed stale classes are `candidate_source_stale`, `candidate_runtime_stale`, `candidate_policy_stale`, and `candidate_review_stale`. Forbidden stale classes are `canonical_geometry_stale`, `cad_output_stale`, `engineering_output_stale`, `route_output_stale`, `bom_output_stale`, and `plan_set_output_stale`.

Candidate stale metadata may create review visibility. It may not invalidate CAD, engineering, layout, routing, NEC, BOM, topology, structural, workflow, recommendation, production, or plan-set outputs. It may not enqueue regeneration.

## Boundary validation evidence

The expanded `npm run check:assisted-evidence-boundaries` command passed after the geometry guard was corrected to allow explicit negative-policy arrays while still rejecting active authority patterns. The targeted runtime tests also assert that generated candidates cannot satisfy requirements, cannot influence CAD readiness, cannot influence recommendations, cannot create workflow items, and cannot automatically mutate canonical evidence through reviewed projections.
