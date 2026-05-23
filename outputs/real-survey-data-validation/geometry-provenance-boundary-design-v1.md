# Geometry Provenance and Boundary Design V1

## Purpose

This document defines a future provenance and boundary design for geometry-adjacent assistance. It is planning only. It does not add geometry extraction, roof detection, object detection, segmentation, CAD mutation, NEC mutation, topology mutation, route inference, structural inference, or engineering authority.

The design assumes that future geometry-adjacent assistance can exist only as review-required assisted evidence candidates. The provenance model must make it impossible to confuse a candidate with canonical geometry, CAD truth, engineering truth, or plan-set truth.

## Provenance Layers

A safe future geometry-assistance system requires separate provenance layers. The first layer is source provenance: the original file, survey evidence item, photo, document, or spatial dataset used as input. The second layer is runtime provenance: runtime name, runtime version, dependency manifest, model or algorithm identifier, parameter set, input hashes, and output hashes. The third layer is candidate provenance: candidate ID, label, confidence, limitations, normalized payload hash, candidate source context, and candidate lifecycle status. The fourth layer is review provenance: reviewer identity, review timestamp, accepted/rejected/needs-more-evidence state, reviewer notes, and reviewer confidence annotation. The fifth layer is projection provenance: non-authoritative reviewed projection metadata. A sixth canonicalization provenance layer should exist only if a future deterministic canonicalization workflow is separately approved.

These layers must remain separated. Runtime provenance must not become review provenance. Candidate provenance must not become canonical provenance. Projection provenance must not mutate CAD, engineering, topology, or plan-set state.

## Candidate Lineage Requirements

Every future geometry candidate must contain lineage references to source evidence IDs, source file hashes, normalized metadata hashes, runtime payload hashes, and boundary-policy version. If a candidate is generated from multiple inputs, every input must be listed. If an input includes spatial metadata, the coordinate system, projection origin, units, and transformation assumptions must be recorded. If an input lacks reliable coordinate metadata, the candidate must explicitly declare `coordinate_reference_unverified` and must not contain measurable geometry.

Lineage must be stable across replay. Candidate IDs may be generated deterministically from source evidence ID, runtime version, label, normalized payload hash, and boundary-policy version. If nondeterministic inference is ever introduced, the candidate must include a nondeterminism marker and must be excluded from deterministic engineering authority.

## Replay Bundle Requirements

A future geometry replay bundle should include `runtimeName`, `runtimeVersion`, `runtimeCategory`, `boundaryPolicyVersion`, `sourceEvidenceIds`, `sourceFileHashes`, `sourceMetadataHash`, `inputByteHashes`, `inputNormalizationVersion`, `runtimeParameterHash`, `dependencyManifestHash`, `modelHash` where applicable, `outputPayloadHash`, `candidateNormalizationHash`, and `candidateIds`. Replay must be candidate-only. Replay must not call CAD, layout, routing, topology, engineering, BOM, production, or rendering code.

Replay comparison should produce only audit outcomes such as `payload_match`, `payload_changed`, `runtime_unavailable`, `dependency_mismatch`, `model_hash_mismatch`, `source_missing`, or `policy_changed`. A replay mismatch should mark candidates stale or requiring review; it must not regenerate canonical geometry or engineering outputs.

## Confidence Handling

Future geometry confidence must be a candidate display attribute only. Runtime confidence should be bounded and method-specific. It must not be used as canonical confidence, requirement satisfaction, engineering certainty, CAD readiness, routing confidence, structural adequacy, or production accuracy. Confidence should be accompanied by limitation references and a confidence basis, such as source quality, runtime signal consistency, or reviewer annotation. The platform must distinguish runtime confidence from reviewer disposition and from deterministic engineering validation.

Confidence thresholds may be used to hide low-confidence candidates from default views only if the candidates remain available in audit logs. Confidence thresholds must not delete candidates, skip required evidence, create workflow items, or change engineering state.

## Geometry Candidate Lifecycle

The future lifecycle should follow the existing assisted-evidence pattern. A runtime emits candidate payloads through a registry-approved bridge. The bridge asserts allowed candidate types. Candidate creation uses review-required lifecycle helpers. Candidates begin in `review_required` status and are non-authoritative. A reviewer can accept, reject, or annotate the candidate. Acceptance creates a reviewed projection only. Rejection records reviewer disposition and blocks the candidate from later authority. Projection is not canonical mutation.

If a future canonicalization workflow is ever approved, it must be separate from candidate acceptance. It must require explicit reviewer selection of a target canonical field, before/after values, deterministic validation, conflict checks, stale-impact preview, and confirmation. The workflow must produce a canonical change event and must invalidate downstream outputs. This design does not implement that workflow.

## Forbidden Mutation Paths

The following paths must remain blocked by policy and future guards. Geometry candidate to canonical roof plane is forbidden. Geometry candidate to survey geometry is forbidden. Geometry candidate to enriched CAD-ready surface is forbidden. Geometry candidate to `CADModel` is forbidden. Geometry candidate to `DraftingInput` is forbidden. Geometry candidate to `SystemDefinition` is forbidden. Geometry candidate to `calcFireSetbacks` input or output is forbidden. Geometry candidate to `routeConduit` input or output is forbidden. Geometry candidate to `deriveRunLengths` or BOM data is forbidden. Geometry candidate to production estimate is forbidden. Geometry candidate to structural calculations or attachment spacing is forbidden. Geometry candidate to plan-set rendering is forbidden. Geometry candidate to topology mutation is forbidden. Geometry candidate to engineering requirement satisfaction is forbidden. Geometry candidate to recommendation or workflow creation is forbidden.

The audit identified specific existing authority surfaces that must be protected: `lib/cad/cadEngine.ts`, `lib/cad/roof/roofCAD.ts`, `lib/cad/buildCADFromSurvey.ts`, `lib/cad/mergeCADModels.ts`, `lib/cad/adapter.ts`, `lib/drafting/renderPlanSet.ts`, `lib/drafting/sheetComposition.ts`, `lib/plan-set/site-layout-sheet.ts`, `lib/plan-set/structural-sheet.ts`, `lib/engineering/fire-setbacks.ts`, `lib/system/conduitRouting.ts`, `lib/bom/deriveRunLengths.ts`, layout engines, and Engineering Intelligence CAD readiness builders.

## Geometry-to-Engineering Separation

Future geometry candidates must not be dependency graph nodes that satisfy engineering requirements. They may appear as candidate nodes in a separate assisted-evidence lane. Engineering dependency graphs may reference the existence of candidate lineage for transparency, but deterministic engineering decisions must depend only on canonical evidence, reviewed deterministic facts, or approved deterministic calculations. If a future reviewed projection is displayed near an engineering decision, the UI must label it as non-authoritative and not used for the decision unless a separate canonical evidence ID exists.

The separation rule should be: candidates can inform review, reviewed projections can inform human context, canonical facts can inform deterministic engineering, and deterministic engineering can inform CAD/readiness/plan-set outputs. Candidates must not skip layers.

## Invalidation Propagation

Future candidate invalidation must be local and explicit. If source evidence changes, candidates derived from that evidence become stale. If a runtime version changes, candidates from earlier versions become stale. If a boundary policy changes, candidates governed by the old policy become stale or review-required. If reviewer disposition changes, projections must be recalculated. None of these events should mutate CAD or engineering outputs automatically.

If a future canonicalization workflow is approved and a reviewed candidate is explicitly converted into canonical geometry, downstream invalidation must propagate to CAD readiness, generated CAD models, drafting inputs, plan-set outputs, production estimates, BOM outputs, structural assumptions, routing assumptions, topology snapshots, engineering decisions, recommendation artifacts, and workflow plans. The stale-impact preview must be visible before canonicalization and must be recorded after canonicalization.

## Boundary Guard Strategy

Boundary guards should enforce both import boundaries and payload boundaries. Import guards should prevent future geometry runtime files from importing CAD, layout, topology, engineering, BOM, plan-set, drafting, route, structural, production, and rendering modules. Payload guards should prevent geometry candidate payloads from containing fields that imply measurable geometry or authority before an approved schema exists. Lifecycle guards should ensure all candidates are review-required and non-authoritative. Registry guards should ensure a future geometry runtime category cannot be enabled unless it is server-only, review-required, canonical-mutation-disabled, replayable, and candidate-type-constrained.

Test guards should include negative tests proving that future candidates cannot satisfy requirements, cannot influence CAD readiness, cannot influence recommendations, cannot create workflow items, cannot mutate canonical evidence, cannot create CAD models, cannot call routing, cannot call setback calculations, cannot call topology, and cannot appear in plan-set outputs.

## Stale Impact Classes

Future geometry candidates should use explicit stale impact classes. `candidate_source_stale` means source evidence changed. `candidate_runtime_stale` means the runtime or dependency manifest changed. `candidate_policy_stale` means boundary policy changed. `candidate_review_stale` means reviewer disposition or review criteria changed. `canonical_geometry_stale` should be reserved for future canonicalization workflows and must not be produced by candidate generation. `cad_output_stale`, `engineering_output_stale`, `route_output_stale`, `bom_output_stale`, and `plan_set_output_stale` should occur only after canonical changes, not after candidate creation.

## Auditability Requirements

Future geometry assistance must produce inspectable audit records. The audit record should answer what source was used, what runtime produced the candidate, what version and dependencies were used, what payload was emitted, what limitations apply, who reviewed it, what projection was created, what canonical fields were untouched, and what downstream systems were not affected. The record should explicitly state that no CAD, engineering, routing, BOM, topology, or plan-set mutation occurred during candidate generation and review.

## Boundary Design Conclusion

The future-safe path is to treat geometry-adjacent assistance as an isolated, registry-governed, replayable, review-required candidate system. The existing deterministic geometry stack is already authoritative and must be protected from runtime candidate payloads. No geometry runtime should be implemented until these provenance and boundary controls are encoded in types, registry validation, boundary scripts, tests, UI labels, and validation reports.
