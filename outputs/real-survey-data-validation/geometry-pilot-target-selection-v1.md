# Geometry Pilot Target Selection V1

This document records the required pre-implementation target selection for the first controlled geometry-adjacent evidence pilot. It was produced before implementing runtime code for this phase. The scope is deliberately narrow: review-only, non-authoritative, provenance-preserved candidate evidence. No roof generation, CAD generation, autonomous geometry extraction, setback generation, routing authority, autonomous spatial engineering, CAD mutation, layout mutation, NEC mutation, or engineering mutation is permitted.

## Governance sources re-audited

The target selection re-audited the four geometry governance reports in `outputs/real-survey-data-validation/`: `geometry-governance-readiness-audit-v1.md`, `future-geometry-containment-architecture-v1.md`, `geometry-provenance-boundary-design-v1.md`, and `geometry-ui-lineage-planning-v1.md`. The reports consistently require that geometry-adjacent assistance remain review-required, non-authoritative, provenance-rich, replayable, and isolated from deterministic CAD, layout, roof-plane, topology, routing, NEC, structural, BOM, production, workflow, recommendation, and plan-set systems.

The reports also state that the safest initial geometry payloads should avoid measurable geometry and should avoid coordinates, polygons, bounding boxes, roof edges, route polylines, obstruction footprints, roof planes, azimuth, tilt, pitch, setbacks, and CAD model fields unless a later schema and guard expansion is separately approved. They recommend a one-way boundary from runtime payload to review-required assisted evidence candidate, with acceptance producing projection-only lineage rather than canonical geometry.

## Candidate categories considered

The allowed categories for this phase were `possible_roof_edge_candidate`, `possible_obstruction_candidate`, and `possible_ridge_candidate`. `possible_roof_edge_candidate` was not selected because roof-edge hints are closest to canonical roof geometry, usable-area calculations, roof-plane boundaries, eaves/rakes, setbacks, panel layout, and CAD roof-plane generation. Even a coarse roof-edge hint could be misread as roof geometry authority.

`possible_ridge_candidate` was not selected because ridge hints are close to roof pitch, plane adjacency, ridge setbacks, fire access logic, and roof topology. The governance reports repeatedly identify ridge and valley concepts as high-risk because they can be confused with code-related geometry.

`possible_obstruction_candidate` was selected as the safest V1 target. It can be constrained to a non-measuring, coarse source-image review hint that says only that a source image may contain obstruction-like visual context requiring human review. The pilot must not emit an obstruction map, CAD obstruction, obstruction footprint, radius, exclusion zone, panel filter, shade loss, production loss, setback, or roof-plane mutation. Its value is limited to review visibility and source-image triage.

## Selected pilot target

The selected V1 category is `possible_obstruction_candidate` only. No other geometry candidate category is implemented in this pilot.

The selected candidate type is intended to represent a review-required assisted evidence candidate. It is not canonical geometry, not CAD input, not engineering authority, not NEC authority, not routing authority, not structural authority, not BOM input, not plan-set input, not workflow input, and not recommendation input.

## Safest non-authoritative signal source

The safest V1 signal source is deterministic source-context normalization combined with a stable byte hash of the supplied image bytes. The runtime may inspect neither pixels nor image geometry. It may not decode images, extract coordinates, calculate edges, segment objects, run object detection, infer roof planes, infer obstruction footprints, call cloud services, call native CV libraries, or use model weights. The source-context text can contain bounded words such as `obstruction`, `vent`, `skylight`, `chimney`, `satellite`, or `pipe`, and the byte hash provides replay identity only. If source-context text does not contain an obstruction-like term, the V1 runtime returns no candidates rather than forcing a geometry fallback.

This is intentionally weaker than real geometry intelligence. That weakness is the safety property of the pilot: it validates governance, candidate lifecycle, provenance, replayability, UI labeling, and boundary checks without implementing autonomous spatial extraction.

## Safest review-only insertion point

The safest insertion point is under `lib/assistedEvidenceSources`, using the existing governed runtime adapter and bridge pattern. Candidate creation must flow through the existing `createReviewRequiredCandidates()` helper, which itself routes through `createCandidate()` and `markReviewRequired()`. The runtime must be registered in the open-source assisted evidence tool registry with server-only execution, review-required lifecycle, canonical mutation disabled, deterministic replay hash requirements, and a candidate-type allowlist restricted to `possible_obstruction_candidate`.

The pilot must not import `lib/cad`, `lib/drafting`, `lib/plan-set`, `lib/engineering`, `lib/engineeringIntelligence`, `lib/system/conduitRouting`, `lib/bom`, `lib/topology-engine`, `lib/roofGeometry`, `lib/planeEngine`, `lib/panelLayout`, `lib/panelLayoutOptimized`, `lib/placementEngine`, rendering components, database clients, or survey mutation modules.

## Safest provenance lineage path

The safest provenance path is source image to runtime payload to normalized candidate to review-required assisted evidence candidate to optional reviewed projection. Every candidate must preserve source file ID, source upload key, project ID, survey ID, runtime identifier, runtime version, tool run ID, tool configuration hash, source metadata hash, runtime payload hash, deterministic input references, creation timestamp, confidence, limitation references, candidate lineage, and review state.

Candidate IDs and deterministic hashes remain produced by the assisted evidence lifecycle. Runtime payload hashes are deterministic for the same image bytes and source-context text. Accepted review results remain reviewed projections only; they do not map to canonical geometry automatically.

## Safest invalidation behavior

The safest invalidation behavior is metadata-only candidate invalidation visibility. Source evidence changes, source metadata hash changes, runtime version changes, runtime payload hash changes, tool configuration hash changes, or boundary policy changes may mark the candidate stale or requiring review. Candidate invalidation does not invalidate CAD, engineering, NEC, layout, routing, BOM, structural, topology, production, workflow, recommendation, or plan-set outputs.

## Safest stale propagation behavior

The safest stale propagation classes for this pilot are candidate-only classes: `candidate_source_stale`, `candidate_runtime_stale`, `candidate_policy_stale`, and `candidate_review_stale`. The pilot must not produce `canonical_geometry_stale`, `cad_output_stale`, `engineering_output_stale`, `route_output_stale`, `bom_output_stale`, `workflow_stale`, `recommendation_stale`, or `plan_set_output_stale`. Stale propagation may create review visibility but not regeneration instructions.

## Implementation decision

Proceed with exactly one V1 candidate category: `possible_obstruction_candidate`. Implement a deterministic, adapter-contained, server-only, registry-governed runtime that emits review-required non-authoritative candidates only when bounded source-context text indicates obstruction-like review context. The runtime must preserve source-image lineage, deterministic hashes, confidence, runtime metadata, and candidate limitations. It must not emit coordinates, bounding boxes, polygons, obstruction maps, footprints, roof edges, setbacks, CAD fields, layout fields, NEC fields, routing fields, or engineering facts.
